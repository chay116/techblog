---
title: "Chaos Network Physics Replication"
date: "2025-12-09"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Physics"
tags: ["unreal", "Physics"]
engine_version: "** Unreal Engine 5.7"
---
# Chaos Network Physics Replication

## 🧭 개요

**Network Physics Replication**은 멀티플레이어 게임에서 물리 시뮬레이션을 동기화하는 시스템입니다. 서버 권한 모델, 클라이언트 예측, 상태 보정을 통해 네트워크 지연에도 일관된 물리 경험을 제공합니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Server Authority** | 서버가 물리 시뮬레이션의 최종 권한 |
| **Client Prediction** | 클라이언트 로컬 물리 예측 |
| **State Reconciliation** | 서버-클라이언트 상태 보정 |
| **Replication Mode** | 동기화 방식 (Default, PredictiveInterp 등) |

---

## 🧱 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     Network Physics Replication Architecture                     │
└─────────────────────────────────────────────────────────────────────────────────┘

    Server                                          Client
  ┌──────────────────────┐                    ┌──────────────────────┐
  │                      │                    │                      │
  │  Physics Simulation  │                    │  Physics Prediction  │
  │  (Authoritative)     │                    │  (Local)             │
  │                      │                    │                      │
  │  ┌────────────────┐  │                    │  ┌────────────────┐  │
  │  │ FRigidBodyState│  │  ─── Replicate ──> │  │ FRigidBodyState│  │
  │  │ - Position     │  │      FRepMovement  │  │ - Position     │  │
  │  │ - Rotation     │  │                    │  │ - Rotation     │  │
  │  │ - LinearVel    │  │                    │  │ - LinearVel    │  │
  │  │ - AngularVel   │  │                    │  │ - AngularVel   │  │
  │  └────────────────┘  │                    │  └────────────────┘  │
  │                      │                    │          │           │
  │                      │                    │          ↓           │
  │                      │                    │  ┌────────────────┐  │
  │                      │                    │  │ Reconciliation │  │
  │                      │                    │  │ - Compare      │  │
  │                      │                    │  │ - Correct      │  │
  │                      │                    │  │ - Smooth       │  │
  │                      │                    │  └────────────────┘  │
  └──────────────────────┘                    └──────────────────────┘

```

---

## 📂 주요 소스 파일

| 파일 | 역할 |
|------|------|
| `Engine/Public/PhysicsReplication.h` | 물리 리플리케이션 시스템 |
| `Engine/Public/Net/RepMovement.h` | 이동 복제 구조체 |
| `Engine/Classes/GameFramework/MovementComponent.h` | 이동 컴포넌트 |
| `Engine/Private/PhysicsEngine/PhysicsReplication.cpp` | 구현 |
| `Chaos/Public/Chaos/Framework/PhysicsProxy.h` | 물리 프록시 |

---

## 🔷 Replication Modes

### EPhysicsReplicationMode

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         Physics Replication Modes                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. Default (기본)                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐    │
│  │  - 단순 상태 복제                                                      │    │
│  │  - 서버 상태를 직접 적용                                               │    │
│  │  - 네트워크 지연 시 끊김 발생                                          │    │
│  │  - 정적/느린 물체에 적합                                               │    │
│  └────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  2. PredictiveInterpolation (예측 보간)                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐    │
│  │  - 클라이언트 물리 예측 실행                                           │    │
│  │  - 서버 상태와 비교하여 보정                                           │    │
│  │  - 부드러운 움직임                                                     │    │
│  │  - 빠르게 움직이는 물체에 적합                                         │    │
│  └────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  3. Resimulation (재시뮬레이션)                                                 │
│  ┌────────────────────────────────────────────────────────────────────────┐    │
│  │  - 입력 복제 + 결정론적 시뮬레이션                                     │    │
│  │  - 오차 발생 시 롤백 & 재시뮬레이션                                    │    │
│  │  - 가장 정확하지만 비용 높음                                           │    │
│  │  - 경쟁 게임에 적합                                                    │    │
│  └────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔶 FRepMovement

### 복제 데이터 구조

```cpp
// RepMovement.h
USTRUCT()
struct FRepMovement
{
    GENERATED_BODY()

    // 위치
    UPROPERTY()
    FVector Location;

    // 회전 (압축됨)
    UPROPERTY()
    FRotator Rotation;

    // 선형 속도
    UPROPERTY()
    FVector LinearVelocity;

    // 각속도
    UPROPERTY()
    FVector AngularVelocity;

    // 복제 플래그
    UPROPERTY()
    uint8 bSimulatedPhysicSleep : 1;

    UPROPERTY()
    uint8 bRepPhysics : 1;

    // 서버 프레임 (동기화용)
    UPROPERTY()
    int32 ServerFrame;

    // 복제 모드
    UPROPERTY()
    EPhysicsReplicationMode ReplicationMode;
};
```

### FRigidBodyState

```cpp
// 강체 상태 (내부용)
struct FRigidBodyState
{
    FVector Position;           // 월드 위치
    FQuat Quaternion;           // 회전 쿼터니언
    FVector LinVel;             // 선형 속도
    FVector AngVel;             // 각속도
    uint8 Flags;                // 상태 플래그 (Sleep 등)

    // 비교 연산
    bool IsNearEqual(const FRigidBodyState& Other, float Tolerance) const;

    // 보간
    static FRigidBodyState Interpolate(
        const FRigidBodyState& A,
        const FRigidBodyState& B,
        float Alpha
    );
};
```

---

## 🔷 Reconciliation (상태 보정)

### 보정 전략

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         Reconciliation Strategies                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. Hard Snap (즉시 보정)                                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐    │
│  │                                                                        │    │
│  │  Client:  ●──────────────●                                            │    │
│  │                          │                                            │    │
│  │  Server:                 ○                                            │    │
│  │                          │                                            │    │
│  │  Result:  ●──────────────○ (즉시 이동)                                │    │
│  │                                                                        │    │
│  │  사용: 큰 오차, 정확도 중요                                           │    │
│  └────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  2. Soft Snap (부드러운 보정)                                                   │
│  ┌────────────────────────────────────────────────────────────────────────┐    │
│  │                                                                        │    │
│  │  Client:  ●──────────────●                                            │    │
│  │                          │↘                                           │    │
│  │  Server:                 ○  ↘                                         │    │
│  │                              ↘●──────→                                │    │
│  │                                                                        │    │
│  │  Result:  보간하여 점진적 이동                                        │    │
│  │                                                                        │    │
│  │  사용: 작은 오차, 시각적 부드러움 중요                                │    │
│  └────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  3. Velocity Correction (속도 보정)                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐    │
│  │                                                                        │    │
│  │  Client:  ●──────────────●→                                           │    │
│  │                          │                                            │    │
│  │  Server:                 ○→→→                                         │    │
│  │                                                                        │    │
│  │  Result:  속도를 조정하여 자연스럽게 수렴                             │    │
│  │                                                                        │    │
│  │  사용: 예측 보간 모드                                                 │    │
│  └────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 보정 파라미터

```cpp
// 물리 복제 설정
struct FPhysicsReplicationSettings
{
    // 위치 오차 임계값 (cm)
    float PositionErrorThreshold = 10.0f;

    // 회전 오차 임계값 (degree)
    float RotationErrorThreshold = 5.0f;

    // 속도 오차 임계값 (cm/s)
    float VelocityErrorThreshold = 100.0f;

    // Hard Snap 임계값 (이 이상이면 즉시 보정)
    float HardSnapThreshold = 100.0f;

    // 보정 보간 속도
    float CorrectionInterpSpeed = 10.0f;

    // 최대 보정 거리/프레임
    float MaxCorrectionPerFrame = 50.0f;
};
```

---

## 🔶 Client Prediction

### 클라이언트 예측 흐름

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         Client Prediction Flow                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Frame N:                                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  1. 입력 수집                                                           │   │
│  │     Input = {MoveForward, Jump, etc.}                                   │   │
│  │                                                                          │   │
│  │  2. 로컬 물리 시뮬레이션 (예측)                                        │   │
│  │     PredictedState = SimulatePhysics(CurrentState, Input, DeltaTime)   │   │
│  │                                                                          │   │
│  │  3. 입력을 서버로 전송                                                  │   │
│  │     Server.RPC_SendInput(Input, FrameNumber)                            │   │
│  │                                                                          │   │
│  │  4. 예측 상태 저장 (나중에 검증용)                                     │   │
│  │     PredictionHistory[FrameNumber] = PredictedState                     │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  Frame N+RTT (서버 응답 수신):                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  5. 서버 확정 상태 수신                                                 │   │
│  │     ServerState = Receive(FrameNumber)                                  │   │
│  │                                                                          │   │
│  │  6. 예측과 비교                                                         │   │
│  │     Error = Compare(PredictionHistory[FrameNumber], ServerState)        │   │
│  │                                                                          │   │
│  │  7. 오차가 크면 보정                                                    │   │
│  │     if (Error > Threshold)                                              │   │
│  │         Reconcile(ServerState)                                          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔷 Physics Proxy Replication

### FPhysicsProxy 복제

```cpp
// PhysicsProxy.h
class FPhysicsProxy
{
public:
    // 복제 상태 가져오기
    void GetReplicatedState(FRigidBodyState& OutState) const;

    // 복제 상태 적용
    void SetReplicatedState(const FRigidBodyState& InState);

    // 서버 프레임 번호
    int32 GetServerFrame() const { return ServerFrame; }
    void SetServerFrame(int32 Frame) { ServerFrame = Frame; }

    // 복제 모드
    EPhysicsReplicationMode GetReplicationMode() const;
    void SetReplicationMode(EPhysicsReplicationMode Mode);

private:
    int32 ServerFrame;
    EPhysicsReplicationMode ReplicationMode;
};
```

---

## 💡 실전 사용 예시

### 1. Actor 복제 설정

```cpp
// 물리 복제 Actor
UCLASS()
class APhysicsReplicatedActor : public AActor
{
    GENERATED_BODY()

public:
    APhysicsReplicatedActor();

    virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

    // 복제될 이동 데이터
    UPROPERTY(ReplicatedUsing=OnRep_ReplicatedMovement)
    FRepMovement ReplicatedMovement;

    UFUNCTION()
    void OnRep_ReplicatedMovement();

protected:
    UPROPERTY(VisibleAnywhere)
    UStaticMeshComponent* MeshComp;
};

// 구현
APhysicsReplicatedActor::APhysicsReplicatedActor()
{
    bReplicates = true;
    SetReplicateMovement(true);

    MeshComp = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
    MeshComp->SetSimulatePhysics(true);
    SetRootComponent(MeshComp);
}

void APhysicsReplicatedActor::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);

    DOREPLIFETIME_CONDITION(APhysicsReplicatedActor, ReplicatedMovement, COND_SimulatedOnly);
}

void APhysicsReplicatedActor::OnRep_ReplicatedMovement()
{
    // 클라이언트에서 복제된 상태 적용
    if (MeshComp)
    {
        FBodyInstance* BodyInstance = MeshComp->GetBodyInstance();
        if (BodyInstance)
        {
            // 보정 적용
            ApplyReplicatedMovement(ReplicatedMovement);
        }
    }
}
```

### 2. 복제 모드 설정

```cpp
void APhysicsReplicatedActor::BeginPlay()
{
    Super::BeginPlay();

    if (HasAuthority())
    {
        // 서버: 물리 시뮬레이션 실행
        MeshComp->SetSimulatePhysics(true);
    }
    else
    {
        // 클라이언트: 복제 모드에 따라 설정
        switch (ReplicationMode)
        {
        case EPhysicsReplicationMode::Default:
            // 물리 비활성화, 서버 상태만 적용
            MeshComp->SetSimulatePhysics(false);
            break;

        case EPhysicsReplicationMode::PredictiveInterpolation:
            // 로컬 예측 물리 활성화
            MeshComp->SetSimulatePhysics(true);
            break;

        case EPhysicsReplicationMode::Resimulation:
            // 재시뮬레이션용 설정
            MeshComp->SetSimulatePhysics(true);
            EnableResimulation();
            break;
        }
    }
}
```

### 3. 커스텀 보정 로직

```cpp
void APhysicsReplicatedActor::ApplyReplicatedMovement(const FRepMovement& NewMovement)
{
    FBodyInstance* BodyInstance = MeshComp->GetBodyInstance();
    if (!BodyInstance)
        return;

    // 현재 상태
    FTransform CurrentTransform = MeshComp->GetComponentTransform();
    FVector CurrentVelocity = BodyInstance->GetUnrealWorldVelocity();

    // 서버 상태
    FVector ServerLocation = NewMovement.Location;
    FRotator ServerRotation = NewMovement.Rotation;
    FVector ServerVelocity = NewMovement.LinearVelocity;

    // 오차 계산
    float PositionError = FVector::Distance(CurrentTransform.GetLocation(), ServerLocation);
    float RotationError = FMath::Abs((CurrentTransform.GetRotation().Rotator() - ServerRotation).GetNormalized().Yaw);

    // 보정 결정
    if (PositionError > HardSnapThreshold)
    {
        // Hard Snap: 즉시 이동
        MeshComp->SetWorldLocationAndRotation(ServerLocation, ServerRotation);
        BodyInstance->SetLinearVelocity(ServerVelocity, false);
        BodyInstance->SetAngularVelocityInRadians(NewMovement.AngularVelocity, false);
    }
    else if (PositionError > SoftSnapThreshold)
    {
        // Soft Snap: 보간
        FVector InterpolatedLocation = FMath::VInterpTo(
            CurrentTransform.GetLocation(),
            ServerLocation,
            GetWorld()->GetDeltaSeconds(),
            CorrectionInterpSpeed
        );

        MeshComp->SetWorldLocation(InterpolatedLocation);

        // 속도 보정
        FVector VelocityCorrection = (ServerLocation - CurrentTransform.GetLocation()) * VelocityCorrectionFactor;
        BodyInstance->SetLinearVelocity(ServerVelocity + VelocityCorrection, false);
    }
    // else: 오차가 작으면 무시
}
```

---

## ⚙️ 성능 및 네트워크 고려사항

### 1. 대역폭 최적화

```cpp
// 복제 빈도 조절
DOREPLIFETIME_CONDITION_NOTIFY(
    AMyActor,
    ReplicatedMovement,
    COND_SimulatedOnly,
    REPNOTIFY_OnChanged  // 변경 시에만 복제
);

// 압축 사용
UPROPERTY(Replicated)
FVector_NetQuantize Location;  // 압축된 벡터

UPROPERTY(Replicated)
FRotator_NetQuantize Rotation; // 압축된 회전

// 복제 우선순위
virtual float GetNetPriority(...) const override
{
    // 거리, 중요도에 따라 복제 빈도 조절
    return bIsImportant ? 3.0f : 1.0f;
}
```

### 2. Relevancy (관련성)

```cpp
// 복제 범위 제한
virtual bool IsNetRelevantFor(...) const override
{
    // 일정 거리 내 클라이언트에만 복제
    float Distance = FVector::Distance(GetActorLocation(), ViewLocation);
    return Distance < ReplicationRadius;
}
```

### 3. 관련 CVars

```cpp
// 물리 복제 디버깅
p.Net.PhysRepMode = 1                    // 복제 모드 (0=Default, 1=PredictiveInterp)
p.Net.PhysErrorCorrection = 1            // 오차 보정 활성화
p.Net.PhysErrorCorrectionRate = 0.5      // 보정 속도
p.Net.PhysHardSnapThreshold = 100        // Hard Snap 임계값 (cm)

// 디버그 시각화
p.Net.DrawPhysReplication = 1            // 복제 상태 시각화
```

---

## 🔧 일반적인 문제 및 해결

| 문제 | 원인 | 해결 |
|------|------|------|
| **물체가 튀어다님** | 잦은 Hard Snap | 임계값 조정, Soft Snap 사용 |
| **동기화 지연** | 높은 RTT | 예측 보간 모드 사용 |
| **위치 드리프트** | 부동소수점 오차 | 주기적 동기화 강제 |
| **대역폭 초과** | 과도한 복제 | 복제 빈도/정밀도 감소 |
| **물체 통과** | 서버-클라이언트 불일치 | 서버 권한 강화 |

---

## 🔗 관련 문서

- [Overview.md](Overview.md) - 물리 시스템 개요
- [Chaos_Substepping_And_Async_Physics.md](Chaos_Substepping_And_Async_Physics.md) - 비동기 물리
- [Chaos_Threading_And_Synchronization.md](Chaos_Threading_And_Synchronization.md) - 스레딩

---

> 이 문서는 Chaos Physics의 Network Replication 시스템을 설명합니다.