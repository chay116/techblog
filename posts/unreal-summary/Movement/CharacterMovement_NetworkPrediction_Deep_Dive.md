---
title: "CharacterMovement Network Prediction Deep Dive"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Movement"
tags: ["unreal", "GameFramework", "Movement"]
---
# CharacterMovement Network Prediction Deep Dive

## 🧭 개요

Unreal Engine의 **CharacterMovementComponent 네트워크 예측 시스템**은 클라이언트-서버 아키텍처에서 **지연 시간(Latency)을 숨기고** 반응성 있는 캐릭터 이동을 제공하는 핵심 메커니즘입니다. 본 문서는 Client-Side Prediction, Server Reconciliation, Move Buffering의 내부 동작을 상세히 분석합니다.

**핵심 문제:**
- **네트워크 지연 (100~200ms RTT)**: 서버 응답을 기다리면 입력이 지연됨
- **패킷 손실 (1~5%)**: 일부 Move 패킷이 유실됨
- **대역폭 제한**: 초당 수십 개의 Move 전송 불가

**해결 전략:**
- **Client-Side Prediction**: 클라이언트가 즉시 이동을 예측 실행
- **ServerMove RPC**: 클라이언트 Move를 서버로 전송
- **ClientAdjustPosition**: 서버가 오차 발견 시 클라이언트 위치 보정
- **Move Replay**: 보정 후 저장된 Move를 재실행하여 부드러운 동기화

---

## 🏗️ 네트워크 예측 아키텍처

### 1. 전체 프로세스 흐름

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Frame N (Client)                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [1] Input Processing                                                   │
│      ├─ APlayerController::ProcessPlayerInput()                         │
│      ├─ APawn::AddMovementInput()                                       │
│      └─ UCharacterMovementComponent::ConsumeInputVector()               │
│            ↓                                                            │
│            Acceleration = InputVector * MaxAcceleration                  │
│                                                                         │
│  [2] Client-Side Prediction (Immediate Execution)                       │
│      ├─ UCharacterMovementComponent::PerformMovement(DeltaTime)         │
│      │    ├─ CalcVelocity() - 가속도 적용                               │
│      │    ├─ MoveUpdatedComponent() - 충돌 처리                         │
│      │    └─ UpdateComponentVelocity()                                  │
│      │                                                                  │
│      └─ Local Position Update:                                          │
│           OldLocation = (100, 200, 50)                                   │
│           NewLocation = (105, 205, 50)  // ← 즉시 이동 (지연 없음)       │
│                                                                         │
│  [3] FSavedMove_Character Creation                                      │
│      ├─ AllocateNewMove() - 메모리 풀에서 할당                          │
│      ├─ SavedMove->SetMoveFor(Character, DeltaTime, ...)                │
│      │    ├─ TimeStamp = CurrentServerTime                              │
│      │    ├─ Acceleration = (1.0, 0.5, 0)                               │
│      │    ├─ Location = (105, 205, 50)                                  │
│      │    ├─ Velocity = (500, 250, 0)                                   │
│      │    ├─ ControlRotation = (0, 45, 0)                               │
│      │    └─ CompressedFlags = JUMP | CROUCH                            │
│      │                                                                  │
│      └─ SavedMoves.Add(SavedMove) - 버퍼에 저장                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓ (비동기)
┌─────────────────────────────────────────────────────────────────────────┐
│                    RPC: Client → Server (Unreliable)                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ServerMove RPC Packet:                                                 │
│  ┌───────────────────────────────────────────────────────────────┐    │
│  │ FCharacterServerMovePackedBits                                │    │
│  ├───────────────────────────────────────────────────────────────┤    │
│  │  [New Move]                                                    │    │
│  │    TimeStamp: 10.523                                           │    │
│  │    Acceleration: FVector_NetQuantize10(1.0, 0.5, 0)            │    │
│  │    Location: FVector_NetQuantize100(105, 205, 50)              │    │
│  │    ControlRotation: FRotator(0, 45, 0)                         │    │
│  │    CompressedMoveFlags: 0b00011 (JUMP | CROUCH)                │    │
│  │    MovementMode: MOVE_Walking                                  │    │
│  │    MovementBase: FloorComponent (NetGUID)                      │    │
│  │                                                                │    │
│  │  [Pending Move] (Dual Move - 선택적)                           │    │
│  │    ... (이전 프레임 데이터)                                     │    │
│  │                                                                │    │
│  │  [Old Move] (중요한 미확인 Move - 선택적)                       │    │
│  │    ... (Ack 안 된 과거 Move)                                    │    │
│  └───────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  Bandwidth: ~50-150 bytes per RPC                                       │
│  Frequency: ~20-60 Hz (p.NetEnableMoveCombining 기반 조절)              │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓ (100ms RTT)
┌─────────────────────────────────────────────────────────────────────────┐
│                        Frame N+6 (Server)                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [4] Server Move Execution (Authority)                                  │
│      ├─ ServerMove_Implementation()                                    │
│      ├─ MoveAutonomous() - Move 검증 및 실행                            │
│      │    ├─ 타임스탬프 검증 (ClientTimeStamp <= ServerTime + Threshold)│
│      │    ├─ 체크: 가속도 크기 <= MaxAcceleration                       │
│      │    ├─ 체크: 이동 거리 <= MaxSpeed * DeltaTime * 1.5              │
│      │    └─ PerformMovement() - 서버에서 재실행                        │
│      │                                                                  │
│      └─ 결과:                                                           │
│           ClientLocation = (105, 205, 50)                                │
│           ServerLocation = (104.8, 204.9, 50)  // ← 약간 다름 (정상)    │
│                                                                         │
│  [5] Error Detection (오차 감지)                                        │
│      ├─ LocationDiff = |ClientLocation - ServerLocation|                │
│      │    = |(105, 205, 50) - (104.8, 204.9, 50)|                       │
│      │    = 0.22 units                                                  │
│      │                                                                  │
│      ├─ ErrorThreshold 체크:                                            │
│      │    - MOVE_Walking: 0.01 units (매우 엄격)                        │
│      │    - MOVE_Falling: 0.5 units                                     │
│      │    - MOVE_Flying: 1.0 units                                      │
│      │                                                                  │
│      └─ if (LocationDiff > Threshold) → ClientAdjustPosition RPC!       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓ (100ms RTT)
┌─────────────────────────────────────────────────────────────────────────┐
│                      Frame N+12 (Client - Correction)                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [6] ClientAdjustPosition RPC Received                                  │
│                                                                         │
│      FClientAdjustment:                                                 │
│        TimeStamp: 10.523 (서버가 처리한 Move의 타임스탬프)               │
│        NewLoc: (104.8, 204.9, 50)  // 서버 권위 위치                    │
│        NewVel: (498, 248, 0)        // 서버 권위 속도                    │
│        bAckGoodMove: false          // 오차 발견됨                       │
│                                                                         │
│  [7] Move Replay (재실행)                                                │
│      ├─ 현재 클라이언트 위치 강제 조정:                                  │
│      │    SetActorLocation(NewLoc)  // Hard snap to (104.8, 204.9, 50)  │
│      │    Velocity = NewVel                                             │
│      │                                                                  │
│      ├─ Replay Pending Moves (저장된 Move 재실행):                      │
│      │    for (FSavedMove* Move : SavedMoves)                           │
│      │    {                                                             │
│      │        if (Move->TimeStamp > AdjustmentTimeStamp)                │
│      │        {                                                         │
│      │            // Move N+1, N+2, ..., N+11을 다시 실행               │
│      │            PerformMovement(Move->DeltaTime);                     │
│      │        }                                                         │
│      │    }                                                             │
│      │                                                                  │
│      └─ 최종 위치:                                                       │
│           OldLocation = (120, 240, 50) (잘못된 예측)                     │
│           NewLocation = (119.8, 239.9, 50) (보정 후 정확한 위치)          │
│                                                                         │
│  [8] 시각적 보간 (Smoothing)                                             │
│      └─ SmoothClientPosition()                                          │
│           └─ Lerp(OldLocation, NewLocation, Alpha) - 부드러운 이동       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔥 핵심 구조체 분석

### 1. FSavedMove_Character - 클라이언트 Move 버퍼

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/GameFramework/CharacterMovementComponent.h`

```cpp
// CharacterMovementComponent.h (구현 부분은 .cpp에 있음)
class FSavedMove_Character
{
public:
    // 타임스탬프 (서버와 동기화)
    float TimeStamp;
    float DeltaTime;

    // 이동 입력 데이터
    FVector Acceleration;          // 입력 벡터 * MaxAcceleration
    FVector SavedLocation;         // Move 실행 후 위치
    FVector SavedVelocity;         // Move 실행 후 속도
    FRotator SavedControlRotation; // 시점 회전

    // 이동 상태
    uint8 CompressedFlags;         // JUMP, CROUCH 등 비트 플래그
    EMovementMode SavedMovementMode;
    TWeakObjectPtr<UPrimitiveComponent> MovementBase;
    FName MovementBaseBoneName;

    // 루트 모션 (애니메이션 기반 이동)
    TSharedPtr<FRootMotionSourceGroup> RootMotionSourceGroup;

    // Move 조합 최적화
    virtual bool CanCombineWith(const FSavedMove_Character* NewMove,
                                 ACharacter* Character,
                                 float MaxDelta) const
    {
        // 동일한 MovementBase, 동일한 MoveFlags일 때만 조합 가능
        return MovementBase == NewMove->MovementBase &&
               CompressedFlags == NewMove->CompressedFlags &&
               SavedMovementMode == NewMove->SavedMovementMode;
    }

    // RPC 직렬화
    virtual void PrepMoveFor(ACharacter* Character);
};
```

**사용 예시:**

```cpp
// 클라이언트에서 매 프레임 호출
FSavedMove_Character* NewMove = CharacterMovement->AllocateNewMove();
NewMove->SetMoveFor(Character, DeltaTime, Acceleration, Location, Velocity, ...);
CharacterMovement->SavedMoves.Add(NewMove);

// Move 조합 (대역폭 최적화)
if (SavedMoves.Num() > 1)
{
    FSavedMove_Character* LastMove = SavedMoves.Last();
    FSavedMove_Character* PrevMove = SavedMoves[SavedMoves.Num() - 2];

    if (LastMove->CanCombineWith(PrevMove, Character, MaxDelta))
    {
        // 두 Move를 하나로 합침 (RPC 절약)
        PrevMove->CombineWith(LastMove);
        SavedMoves.RemoveAt(SavedMoves.Num() - 1);
        FreeMove(LastMove);
    }
}
```

### 2. FCharacterNetworkMoveData - RPC 전송 데이터

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/GameFramework/CharacterMovementReplication.h:95-152`

```cpp
// CharacterMovementReplication.h:95
struct FCharacterNetworkMoveData
{
public:
    enum class ENetworkMoveType
    {
        NewMove,      // 최신 Move
        PendingMove,  // 직전 Move (Dual Move)
        OldMove       // 미확인 중요 Move (Redundancy)
    };

    ENetworkMoveType NetworkMoveType;

    // 기본 이동 데이터 (비트 패킹 최적화)
    float TimeStamp;                     // 32-bit
    FVector_NetQuantize10 Acceleration;  // 30-bit (각 축 10-bit, 0.1 단위)
    FVector_NetQuantize100 Location;     // 90-bit (각 축 30-bit, 0.01 단위)
    FRotator ControlRotation;            // 압축된 회전 (16-bit per axis)
    uint8 CompressedMoveFlags;           // 8-bit 플래그
    uint8 MovementMode;                  // 8-bit 모드

    UPrimitiveComponent* MovementBase;   // NetGUID (32-bit)
    FName MovementBaseBoneName;          // NetIndex (16-bit)

    // 직렬화 (비트 스트림으로 변환)
    virtual bool Serialize(UCharacterMovementComponent& CharacterMovement,
                          FArchive& Ar,
                          UPackageMap* PackageMap,
                          ENetworkMoveType MoveType)
    {
        // 비트 압축 직렬화
        Ar << TimeStamp;

        // Acceleration: 10-bit per component (0.1 단위 정밀도)
        Acceleration.NetSerialize(Ar, PackageMap, bOutSuccess);

        // Location: 100x 정밀도 (0.01 단위)
        Location.NetSerialize(Ar, PackageMap, bOutSuccess);

        // ControlRotation: 압축된 회전 (16-bit per axis)
        SerializeCompressedRotation(ControlRotation, Ar);

        // Flags: 비트 단위 직렬화
        Ar.SerializeBits(&CompressedMoveFlags, 8);
        Ar.SerializeBits(&MovementMode, 8);

        // MovementBase: NetGUID로 압축
        Ar << MovementBase;
        Ar << MovementBaseBoneName;

        return !Ar.IsError();
    }
};
```

**Bandwidth 계산:**

```cpp
// FCharacterNetworkMoveData 크기
float TimeStamp:                32 bits
FVector_NetQuantize10 Accel:    30 bits (10+10+10)
FVector_NetQuantize100 Loc:     90 bits (30+30+30)
FRotator ControlRotation:       48 bits (16+16+16 압축)
uint8 CompressedMoveFlags:      8 bits
uint8 MovementMode:             8 bits
MovementBase NetGUID:           32 bits
MovementBaseBoneName NetIndex:  16 bits
─────────────────────────────────────────
Total:                          264 bits = 33 bytes (이론적 최소)
실제 (헤더 포함):                ~50-80 bytes per Move
```

### 3. FClientAdjustment - 서버 보정 데이터

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/GameFramework/CharacterMovementReplication.h:252-290`

```cpp
// CharacterMovementReplication.h:252
struct FClientAdjustment
{
public:
    float TimeStamp;               // 보정할 Move의 타임스탬프
    float DeltaTime;               // Move 실행 시간
    FVector NewLoc;                // 서버 권위 위치
    FVector NewVel;                // 서버 권위 속도
    FRotator NewRot;               // 서버 권위 회전
    FVector GravityDirection;      // 중력 방향

    UPrimitiveComponent* NewBase;  // 서버 Movement Base
    FName NewBaseBoneName;

    bool bAckGoodMove;             // true = 오차 없음, false = 보정 필요
    bool bBaseRelativePosition;    // Location이 Base 상대 좌표인지
    bool bBaseRelativeVelocity;    // Velocity가 Base 상대인지
    uint8 MovementMode;            // 서버 MovementMode

    void Serialize(FArchive& Archive);
};
```

**서버 측 Adjustment 전송 로직:**

```cpp
// CharacterMovementComponent.cpp (서버)
void UCharacterMovementComponent::ServerMoveHandleClientError(
    float ClientTimeStamp,
    float DeltaTime,
    const FVector& Accel,
    const FVector& ClientWorldLocation,
    UPrimitiveComponent* ClientMovementBase,
    FName ClientBaseBoneName,
    uint8 ClientMovementMode)
{
    // 1. 클라이언트와 서버 위치 비교
    const FVector ServerLocation = UpdatedComponent->GetComponentLocation();
    const FVector LocationDiff = ClientWorldLocation - ServerLocation;
    const float LocationError = LocationDiff.Size();

    // 2. 허용 오차 체크
    const float AllowedError = GetAllowedPositionError(MovementMode);

    if (LocationError > AllowedError)
    {
        // 3. ClientAdjustPosition RPC 전송
        FClientAdjustment Adjustment;
        Adjustment.TimeStamp = ClientTimeStamp;
        Adjustment.DeltaTime = DeltaTime;
        Adjustment.NewLoc = ServerLocation;
        Adjustment.NewVel = Velocity;
        Adjustment.NewRot = UpdatedComponent->GetComponentRotation();
        Adjustment.bAckGoodMove = false;
        Adjustment.MovementMode = PackNetworkMovementMode();

        ClientAdjustPosition(
            Adjustment.TimeStamp,
            Adjustment.NewLoc,
            Adjustment.NewVel,
            Adjustment.NewBase,
            Adjustment.NewBaseBoneName,
            Adjustment.bHasBase,
            Adjustment.bBaseRelativePosition,
            Adjustment.MovementMode
        );
    }
    else
    {
        // 오차 허용 범위 내 - Good Move Ack
        ClientAckGoodMove(ClientTimeStamp);
    }
}
```

---

## 💡 실전 최적화 기법

### 1. Move Combining (Move 조합)

**문제:**
- 60 FPS 클라이언트 → 초당 60개 Move RPC
- 60 * 50 bytes = 3KB/s (업로드 대역폭 소모)

**해결책:**

```cpp
// CharacterMovementComponent.cpp
bool FSavedMove_Character::CanCombineWith(
    const FSavedMove_Character* NewMove,
    ACharacter* InCharacter,
    float MaxDelta) const
{
    // 조합 불가능 조건
    if (MovementMode != NewMove->MovementMode) return false;
    if (StartPackedMovementMode != NewMove->StartPackedMovementMode) return false;
    if (MovementBase != NewMove->MovementBase) return false;

    // 상태 변화가 있으면 조합 불가
    if (bPressedJump || NewMove->bPressedJump) return false;
    if (bWantsToCrouch != NewMove->bWantsToCrouch) return false;

    // DeltaTime 누적 제한 (최대 0.1초)
    if (DeltaTime + NewMove->DeltaTime > MaxDelta) return false;

    return true;  // 조합 가능
}

void FSavedMove_Character::CombineWith(
    const FSavedMove_Character* OldMove,
    ACharacter* InCharacter,
    APlayerController* PC,
    const FVector& OldStartLocation)
{
    // Move 합치기
    DeltaTime += OldMove->DeltaTime;

    // 최종 위치/속도만 유지
    SavedLocation = OldMove->SavedLocation;
    SavedVelocity = OldMove->SavedVelocity;
    SavedControlRotation = OldMove->SavedControlRotation;

    // Acceleration은 평균
    Acceleration = (Acceleration + OldMove->Acceleration) * 0.5f;
}
```

**효과:**
- 60 FPS → ~20 RPC/s (3배 감소)
- 3KB/s → 1KB/s 업로드 대역폭

### 2. Dual Move (이중 Move 전송)

**개념:**
- 하나의 RPC에 2개의 Move 포함 (NewMove + PendingMove)
- 서버는 두 Move를 순차 실행

**구현:**

```cpp
// CharacterMovementComponent.cpp
void UCharacterMovementComponent::CallServerMovePacked(
    const FSavedMove_Character* NewMove,
    const FSavedMove_Character* PendingMove,
    const FSavedMove_Character* OldMove)
{
    // FCharacterNetworkMoveDataContainer 생성
    FCharacterNetworkMoveDataContainer MoveDataContainer;

    // NewMove는 필수
    MoveDataContainer.NewMoveData->ClientFillNetworkMoveData(*NewMove,
        FCharacterNetworkMoveData::ENetworkMoveType::NewMove);

    // PendingMove 포함 (Dual Move)
    if (PendingMove)
    {
        MoveDataContainer.bHasPendingMove = true;
        MoveDataContainer.PendingMoveData->ClientFillNetworkMoveData(*PendingMove,
            FCharacterNetworkMoveData::ENetworkMoveType::PendingMove);
    }

    // OldMove 포함 (중요한 미확인 Move)
    if (OldMove)
    {
        MoveDataContainer.bHasOldMove = true;
        MoveDataContainer.OldMoveData->ClientFillNetworkMoveData(*OldMove,
            FCharacterNetworkMoveData::ENetworkMoveType::OldMove);
    }

    // RPC 전송
    ServerMovePacked(MoveDataContainer);
}
```

**서버 처리:**

```cpp
// 서버에서 Dual Move 처리
void UCharacterMovementComponent::ServerMovePacked_Implementation(
    const FCharacterServerMovePackedBits& PackedBits)
{
    FCharacterNetworkMoveDataContainer MoveDataContainer;

    // 역직렬화
    MoveDataContainer.Serialize(*this, Archive, PackageMap);

    // OldMove 먼저 처리 (중요한 과거 Move)
    if (MoveDataContainer.bHasOldMove)
    {
        MoveAutonomous(
            MoveDataContainer.OldMoveData->TimeStamp,
            MoveDataContainer.OldMoveData->DeltaTime,
            MoveDataContainer.OldMoveData->CompressedFlags,
            MoveDataContainer.OldMoveData->Acceleration
        );
    }

    // PendingMove 처리
    if (MoveDataContainer.bHasPendingMove)
    {
        MoveAutonomous(...);  // PendingMove 실행
    }

    // NewMove 처리 (최신 Move)
    MoveAutonomous(...);  // NewMove 실행

    // 오차 검증 및 Adjustment 전송
    ServerMoveHandleClientError(...);
}
```

### 3. Network Smoothing (시각적 보간)

**문제:**
- ClientAdjustPosition은 Hard Snap (급격한 위치 점프)
- 시각적으로 매우 거슬림

**해결책: Exponential Smoothing**

```cpp
// CharacterMovementComponent.cpp
void UCharacterMovementComponent::SmoothClientPosition(float DeltaSeconds)
{
    if (NetworkSmoothingMode == ENetworkSmoothingMode::Disabled)
    {
        return;  // Smoothing 비활성화
    }

    // 현재 위치와 목표 위치의 차이
    const FVector CurrentLocation = UpdatedComponent->GetComponentLocation();
    const FVector TargetLocation = ClientData->MeshTranslationOffset + GetComponentLocation();
    const FVector LocationDiff = TargetLocation - CurrentLocation;
    const float DistanceSq = LocationDiff.SizeSquared();

    // Smoothing 파라미터
    const float SmoothLocationTime = 0.1f;  // 100ms에 걸쳐 보간
    const float SmoothRotationTime = 0.05f; // 50ms에 걸쳐 보간

    if (DistanceSq > FMath::Square(0.01f))  // 1cm 이상 차이
    {
        // Exponential Decay Smoothing
        const float Alpha = FMath::Clamp(DeltaSeconds / SmoothLocationTime, 0.f, 1.f);
        const FVector NewLocation = FMath::Lerp(CurrentLocation, TargetLocation, Alpha);

        // 위치 업데이트 (부드러운 이동)
        UpdatedComponent->SetWorldLocation(NewLocation, false, nullptr, ETeleportType::TeleportPhysics);
    }

    // 회전도 동일하게 보간
    const FRotator CurrentRotation = UpdatedComponent->GetComponentRotation();
    const FRotator TargetRotation = ClientData->MeshRotationOffset + GetComponentRotation();
    const float RotAlpha = FMath::Clamp(DeltaSeconds / SmoothRotationTime, 0.f, 1.f);
    const FRotator NewRotation = FMath::Lerp(CurrentRotation, TargetRotation, RotAlpha);
    UpdatedComponent->SetWorldRotation(NewRotation, false, nullptr, ETeleportType::TeleportPhysics);
}
```

**효과:**
- Hard Snap → Smooth Transition (100ms Lerp)
- 시각적 끊김 현상 제거

---

## 🚨 일반적인 함정 및 해결책

### 문제 1: 과도한 ClientAdjustPosition (Rubber Banding)

**증상:**
```
LogNetPlayerMovement: Warning: Client/Server position mismatch (Server: 45.2 units away from Client)
LogNetPlayerMovement: Warning: ClientAdjustPosition called 15 times in 1 second!
```

**원인:**
- 클라이언트와 서버의 물리 시뮬레이션 차이
- 패킷 손실로 인한 Move 누락
- 부정확한 타임스탬프 동기화

**해결책 1: 오차 허용치 조정**

```cpp
// CharacterMovementComponent.cpp
float UCharacterMovementComponent::GetNetworkSimulatedSmoothLocationTime() const
{
    return FMath::Max(NetworkMinTimeBetweenClientAdjustments, NetworkMaxSmoothUpdateDistance);
}

float UCharacterMovementComponent::GetNetworkSimulatedSmoothRotationTime() const
{
    return FMath::Max(NetworkMinTimeBetweenClientAdjustmentsLargeCorrection, 0.05f);
}

// Config/DefaultEngine.ini에서 조정
[/Script/Engine.CharacterMovementComponent]
; 작은 오차는 무시 (기본: 0.01)
NetworkMaxSmoothUpdateDistance=0.05

; Adjustment 최소 간격 (기본: 0.1초)
NetworkMinTimeBetweenClientAdjustments=0.2
```

**해결책 2: Server Reconciliation Tolerance**

```cpp
// MyCharacterMovementComponent.cpp
float UMyCharacterMovementComponent::GetAllowedPositionError(EMovementMode MovementMode) const
{
    switch (MovementMode)
    {
    case MOVE_Walking:
        return 0.5f;  // 0.01 → 0.5 (50배 완화)
    case MOVE_Falling:
        return 2.0f;  // 0.5 → 2.0
    case MOVE_Flying:
        return 5.0f;  // 1.0 → 5.0
    default:
        return 1.0f;
    }
}
```

### 문제 2: 높은 Latency 환경에서의 Move Replay 지연

**증상:**
- 200ms RTT 환경에서 12프레임 이전 Move 재실행
- 클라이언트가 이미 크게 이동한 상태에서 보정

**해결책: Time Dilation (시간 늘리기)**

```cpp
// MyCharacterMovementComponent.cpp
void UMyCharacterMovementComponent::ClientAdjustPosition_Implementation(
    float TimeStamp,
    FVector NewLoc,
    FVector NewVel,
    UPrimitiveComponent* NewBase,
    FName NewBaseBoneName,
    bool bHasBase,
    bool bBaseRelativePosition,
    uint8 ServerMovementMode)
{
    // 표준 보정 처리
    Super::ClientAdjustPosition_Implementation(...);

    // Time Dilation 적용 (재실행 부담 감소)
    const float ReplayMoveCount = SavedMoves.Num();
    if (ReplayMoveCount > 10)
    {
        // 너무 많은 Move 재실행 → 시간을 늘려서 부담 감소
        CustomTimeDilation = 0.9f;  // 10% 느리게 (재실행 따라잡기)
    }
    else
    {
        CustomTimeDilation = 1.0f;  // 정상 속도
    }
}
```

### 문제 3: Packet Loss 환경에서의 Move 유실

**증상:**
- 3~5% 패킷 손실 환경
- 서버가 일부 Move를 받지 못함 → 클라이언트 뒤처짐

**해결책: Old Move Redundancy**

```cpp
// CharacterMovementComponent.cpp
void UCharacterMovementComponent::CallServerMovePacked(...)
{
    // 마지막으로 Ack 받은 Move 이후의 중요한 Move 재전송
    FSavedMove_Character* OldMove = nullptr;

    for (int32 i = 0; i < SavedMoves.Num(); ++i)
    {
        FSavedMove_Character* Move = SavedMoves[i];

        if (!Move->bAcknowledged && Move->bImportantMove)
        {
            OldMove = Move;  // 미확인 중요 Move 발견
            break;
        }
    }

    // OldMove를 RPC에 포함하여 재전송 (Redundancy)
    if (OldMove)
    {
        MoveDataContainer.bHasOldMove = true;
        MoveDataContainer.OldMoveData->ClientFillNetworkMoveData(*OldMove,
            FCharacterNetworkMoveData::ENetworkMoveType::OldMove);
    }
}
```

**중요 Move 판정:**

```cpp
bool FSavedMove_Character::IsImportantMove(const FSavedMovePtr& LastAckedMove) const
{
    // 점프, 착지, 모드 전환 등은 중요 Move
    if (bPressedJump) return true;
    if (StartPackedMovementMode != EndPackedMovementMode) return true;
    if (StartBase != EndBase) return true;  // Base 변경

    // 큰 위치 변화
    if (LastAckedMove.IsValid())
    {
        const float DistSq = (SavedLocation - LastAckedMove->SavedLocation).SizeSquared();
        if (DistSq > FMath::Square(500.f))  // 5m 이상 이동
        {
            return true;
        }
    }

    return false;
}
```

---

## 📊 성능 프로파일링

### 측정 지표

```cpp
// 네트워크 통계 출력
stat Net

// CharacterMovement 통계
stat CharacterMovement

// 출력 예시:
// Stat Net:
//   - InRate: 2.1 KB/s
//   - OutRate: 1.3 KB/s
//   - InPackets/s: 20
//   - OutPackets/s: 15
//   - Ping: 45ms
//
// Stat CharacterMovement:
//   - MovesPerSecond: 18
//   - AdjustmentsPerSecond: 0.2
//   - AvgMoveReplayCount: 3.5
```

### 최적화 체크리스트

```cpp
✅ Move Combining 활성화
  p.NetEnableMoveCombining=1

✅ Dual Move 사용
  p.NetUseClientTimestampForReplicatedTransform=1

✅ Smoothing 모드 설정
  NetworkSmoothingMode=ENetworkSmoothingMode::Exponential

✅ 오차 허용치 조정 (프로젝트별)
  NetworkMaxSmoothUpdateDistance=0.05

✅ Adjustment 빈도 제한
  NetworkMinTimeBetweenClientAdjustments=0.2

✅ Move 버퍼 크기 제한
  MaxSavedMoveCount=96  ; 기본값, 필요 시 조정
```

---

## 🔗 참조 자료

**소스 파일:**
- `Engine/Source/Runtime/Engine/Classes/GameFramework/CharacterMovementComponent.h`
- `Engine/Source/Runtime/Engine/Classes/GameFramework/CharacterMovementReplication.h:95-300`
- `Engine/Source/Runtime/Engine/Private/Components/CharacterMovementComponent.cpp`

**공식 문서:**
- [Character Movement Component](https://docs.unrealengine.com/5.7/en-US/character-movement-component-in-unreal-engine/)
- [Network Prediction](https://docs.unrealengine.com/5.7/en-US/client-server-model-for-multiplayer-in-unreal-engine/)

**CVar 레퍼런스:**
```ini
p.NetEnableMoveCombining          ; Move 조합 활성화
p.NetUsePackedMovementRPCs        ; 압축 RPC 사용
p.NetShowCorrections              ; Adjustment 시각화
p.NetCorrectionLifetime           ; Correction 표시 시간
```

---

> **마지막 업데이트:** 2025-01-22
>
> **핵심 철학:**
> CharacterMovement 네트워크 예측은 "반응성"과 "정확성"의 균형입니다.
> - Client-Side Prediction으로 **즉각적인 입력 반응**
> - Server Reconciliation으로 **권위적 상태 보장**
> - Network Smoothing으로 **시각적 부드러움**