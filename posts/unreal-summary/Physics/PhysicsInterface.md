---
title: "Physics Interface & FBodyInstance"
date: "2025-12-07"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Physics"
tags: ["unreal", "Physics"]
engine_version: "** Unreal Engine 5.7"
---
# Physics Interface & FBodyInstance

## 🧭 개요

**FBodyInstance**는 Unreal Engine에서 Game Thread와 Physics Thread를 연결하는 핵심 인터페이스입니다. `UPrimitiveComponent`의 물리 상태를 캡슐화하고 관리합니다.

---

## 🧱 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Physics Interface Architecture                            │
└─────────────────────────────────────────────────────────────────────────────────┘

  Game Thread                              Physics Thread
       │                                        │
       │  UPrimitiveComponent                   │
       │       │                                │
       │       └── FBodyInstance ─────────────────────> IPhysicsProxyBase
       │             │                          │            │
       │             ├── Transform              │            ├── FPBDRigidParticle
       │             ├── Velocity               │            ├── FGeometryParticle
       │             ├── Mass Properties        │            └── ...
       │             ├── Collision Settings     │
       │             └── Material               │
       │                                        │
       │  FPhysicsCommand ──────────────────────────> Physics Task Queue
       │  (Thread-safe 명령)                    │
       │                                        │
       └────────────────────────────────────────┘
```

---

## 📂 주요 소스 파일

| 파일 | 역할 |
|------|------|
| `Engine/Public/PhysicsEngine/BodyInstance.h` | FBodyInstance 정의 |
| `Engine/Private/PhysicsEngine/BodyInstance.cpp` | FBodyInstance 구현 |
| `Engine/Public/Physics/PhysicsInterfaceCore.h` | 물리 인터페이스 추상화 |
| `Engine/Private/PhysicsEngine/PhysScene_Chaos.cpp` | Chaos 씬 관리 |

---

## 🔷 FBodyInstance 상세

### 클래스 구조

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              FBodyInstance                                       │
│  (물리 바디의 Game Thread 표현)                                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Core Properties:                                                                │
│  ├── ObjectType : ECollisionChannel           // 충돌 채널                      │
│  ├── CollisionEnabled : ECollisionEnabled     // 충돌 활성화 상태               │
│  ├── CollisionResponses                       // 채널별 응답                    │
│  ├── bSimulatePhysics : bool                  // 물리 시뮬레이션 여부           │
│  ├── bEnableGravity : bool                    // 중력 적용 여부                 │
│  ├── bStartAwake : bool                       // 시작 시 깨어있음               │
│  └── bUseCCD : bool                           // CCD 사용 여부                  │
│                                                                                  │
│  Mass Properties:                                                                │
│  ├── MassInKgOverride : float                 // 질량 오버라이드 (kg)           │
│  ├── bOverrideMass : bool                     // 질량 오버라이드 사용           │
│  ├── LinearDamping : float                    // 선형 감쇠                      │
│  ├── AngularDamping : float                   // 각 감쇠                        │
│  ├── InertiaTensorScale : FVector             // 관성 텐서 스케일               │
│  └── COMNudge : FVector                       // 무게중심 오프셋                │
│                                                                                  │
│  Constraints:                                                                    │
│  ├── DOFMode : EDOFMode                       // 자유도 모드                    │
│  ├── bLockXTranslation/Y/Z : bool             // 이동 잠금                      │
│  ├── bLockXRotation/Y/Z : bool                // 회전 잠금                      │
│  └── CustomDOFPlaneNormal : FVector           // 커스텀 평면 법선               │
│                                                                                  │
│  Sleep Settings:                                                                 │
│  ├── SleepFamily : ESleepFamily               // Sleep 동작 타입                │
│  ├── CustomSleepThresholdMultiplier : float   // Sleep 임계값 배율              │
│  └── StabilizationThresholdMultiplier : float // 안정화 임계값 배율            │
│                                                                                  │
│  Advanced:                                                                       │
│  ├── PhysMaterialOverride : UPhysicalMaterial*  // 물리 재질 오버라이드        │
│  ├── MaxAngularVelocity : float               // 최대 각속도                    │
│  ├── MaxDepenetrationVelocity : float         // 최대 탈출 속도                 │
│  └── PositionSolverIterationCount : int       // 솔버 반복 횟수                 │
│                                                                                  │
│  Runtime State (Transient):                                                      │
│  ├── ActorHandle : FPhysicsActorHandle        // Chaos 파티클 핸들              │
│  └── OwnerComponent : UPrimitiveComponent*    // 소유 컴포넌트                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 주요 API

```cpp
// === 생성 및 초기화 ===

// 물리 바디 초기화
void InitBody(
    UBodySetup* Setup,                    // 충돌 형상 정의
    const FTransform& Transform,          // 초기 Transform
    UPrimitiveComponent* Owner,           // 소유 컴포넌트
    FPhysScene* PhysScene                 // 물리 씬
);

// 물리 바디 종료
void TermBody();

// === Transform ===

// Transform 설정 (Game Thread)
void SetBodyTransform(
    const FTransform& NewTransform,
    ETeleportType Teleport,
    bool bAutoWake = true
);

// Transform 가져오기
FTransform GetUnrealWorldTransform(bool bWithProjection = true) const;

// === 물리 시뮬레이션 ===

// 시뮬레이션 활성화/비활성화
void SetSimulatePhysics(bool bSimulate);

// 중력 설정
void SetEnableGravity(bool bGravity);

// Kinematic 타겟 설정
void SetKinematicTarget(const FTransform& NewTarget);

// === 힘/충격량 ===

// 힘 적용 (지속적)
void AddForce(const FVector& Force, bool bAllowSubstepping = true, bool bAccelChange = false);

// 위치에 힘 적용
void AddForceAtPosition(const FVector& Force, const FVector& Position, bool bAllowSubstepping = true);

// 충격량 적용 (순간적)
void AddImpulse(const FVector& Impulse, bool bVelChange = false);

// 위치에 충격량 적용
void AddImpulseAtPosition(const FVector& Impulse, const FVector& Position);

// 방사형 힘 적용
void AddRadialForce(const FVector& Origin, float Radius, float Strength, ERadialImpulseFalloff Falloff);

// 토크 적용
void AddTorqueInRadians(const FVector& Torque, bool bAllowSubstepping = true, bool bAccelChange = false);

// 각속도 충격량
void AddAngularImpulseInRadians(const FVector& AngularImpulse, bool bVelChange = false);

// === 속도 ===

// 선속도 설정/가져오기
void SetLinearVelocity(const FVector& NewVel, bool bAddToCurrent = false, bool bAutoWake = true);
FVector GetUnrealWorldVelocity() const;

// 각속도 설정/가져오기
void SetAngularVelocityInRadians(const FVector& NewAngVel, bool bAddToCurrent = false, bool bAutoWake = true);
FVector GetUnrealWorldAngularVelocityInRadians() const;

// 특정 위치의 속도
FVector GetUnrealWorldVelocityAtPoint(const FVector& Point) const;

// === 질량 ===

// 질량 설정/가져오기
void SetMassOverrideInKg(FName BoneName, float MassInKg, bool bOverrideMass = true);
float GetMass() const;

// 관성 텐서 가져오기
FVector GetInertiaTensor(FName BoneName = NAME_None) const;

// 무게중심 가져오기
FVector GetCOMPosition() const;

// === Sleep ===

// Sleep 상태 확인/설정
bool IsInstanceAwake() const;
void WakeInstance();
void PutInstanceToSleep();

// === 충돌 ===

// 충돌 활성화 설정
void SetCollisionEnabled(ECollisionEnabled::Type NewType);

// 채널 응답 설정
void SetResponseToChannel(ECollisionChannel Channel, ECollisionResponse Response);
void SetResponseToAllChannels(ECollisionResponse Response);

// 오브젝트 타입 설정
void SetObjectType(ECollisionChannel Channel);
```

---

## 🔶 UPrimitiveComponent 물리 통합

### 컴포넌트 계층

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    UPrimitiveComponent Physics Integration                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  UPrimitiveComponent                                                             │
│       │                                                                         │
│       ├── FBodyInstance BodyInstance;        // 단일 바디                       │
│       │                                                                         │
│       ├── OnComponentHit                     // 충돌 이벤트                     │
│       ├── OnComponentBeginOverlap            // 겹침 시작 이벤트                │
│       └── OnComponentEndOverlap              // 겹침 종료 이벤트                │
│                                                                                  │
│  UStaticMeshComponent                                                           │
│       │                                                                         │
│       └── UBodySetup* GetBodySetup()         // 정적 충돌 형상                  │
│                                                                                  │
│  USkeletalMeshComponent                                                         │
│       │                                                                         │
│       ├── TArray<FBodyInstance*> Bodies;     // 본별 바디                       │
│       └── UPhysicsAsset* PhysicsAsset;       // 물리 에셋                       │
│                                                                                  │
│  UGeometryCollectionComponent                                                   │
│       │                                                                         │
│       └── FGeometryCollectionPhysicsProxy    // GC 전용 프록시                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 물리 컴포넌트 설정 예시

```cpp
// StaticMeshComponent 물리 설정
UStaticMeshComponent* MeshComp = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));

// 시뮬레이션 활성화
MeshComp->SetSimulatePhysics(true);

// 충돌 설정
MeshComp->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
MeshComp->SetCollisionObjectType(ECC_PhysicsBody);
MeshComp->SetCollisionResponseToAllChannels(ECR_Block);
MeshComp->SetCollisionResponseToChannel(ECC_Pawn, ECR_Ignore);

// 물리 속성
MeshComp->SetMassOverrideInKg(NAME_None, 100.0f);
MeshComp->SetLinearDamping(0.01f);
MeshComp->SetAngularDamping(0.1f);
MeshComp->SetEnableGravity(true);

// CCD 활성화 (빠른 물체용)
MeshComp->BodyInstance.bUseCCD = true;

// 자유도 제한
MeshComp->BodyInstance.bLockZTranslation = true;
MeshComp->BodyInstance.bLockXRotation = true;
MeshComp->BodyInstance.bLockYRotation = true;
```

---

## 🔷 FPhysicsCommand - Thread-Safe 명령

### 명령 패턴

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         FPhysicsCommand Flow                                     │
└─────────────────────────────────────────────────────────────────────────────────┘

  Game Thread                              Physics Thread
       │                                        │
       │  SetBodyTransform(NewTransform)        │
       │       │                                │
       │       ↓                                │
       │  FPhysicsCommand::ExecuteWrite()       │
       │       │                                │
       │       └──> Command Queue ──────────────────> Execute on Physics Thread
       │                                        │            │
       │                                        │            ↓
       │                                        │     Update Particle
       │                                        │
       └────────────────────────────────────────┘
```

### 사용 예시

```cpp
// 안전한 물리 명령 실행
void SetBodyTransformSafe(FBodyInstance* Body, const FTransform& Transform)
{
    if (FPhysicsInterface::IsInGameThread())
    {
        // Game Thread에서 호출 - 명령 큐잉
        FPhysicsCommand::ExecuteWrite(Body->ActorHandle, [Transform](FPhysicsActorHandle& Handle)
        {
            Handle.GetGameThreadAPI().SetWorldTransform(Transform);
        });
    }
    else
    {
        // Physics Thread에서 호출 - 직접 실행
        Body->ActorHandle.GetPhysicsThreadAPI().SetWorldTransform(Transform);
    }
}

// 읽기 명령
FTransform GetBodyTransformSafe(FBodyInstance* Body)
{
    FTransform Result;
    FPhysicsCommand::ExecuteRead(Body->ActorHandle, [&Result](const FPhysicsActorHandle& Handle)
    {
        Result = Handle.GetGameThreadAPI().GetWorldTransform();
    });
    return Result;
}
```

---

## 🔶 물리 재질 (Physical Material)

### UPhysicalMaterial

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           UPhysicalMaterial                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Surface Properties:                                                             │
│  ├── Friction : float = 0.7f               // 마찰 계수 (0-1)                   │
│  ├── StaticFriction : float                // 정지 마찰 (옵션)                  │
│  ├── FrictionCombineMode : EFrictionCombine  // 마찰 결합 방식                  │
│  │                                                                              │
│  ├── Restitution : float = 0.3f            // 반발 계수 (0-1)                   │
│  ├── RestitutionCombineMode                // 반발 결합 방식                    │
│  │                                                                              │
│  └── Density : float = 1.0f                // 밀도 (g/cm³)                      │
│                                                                                  │
│  Destruction:                                                                    │
│  └── DestructibleDamageThreshold : float   // 파괴 임계값                       │
│                                                                                  │
│  Tire Friction:                                                                  │
│  └── TireFrictionScale : float             // 타이어 마찰 스케일                │
│                                                                                  │
│  Surface Types:                                                                  │
│  └── SurfaceType : EPhysicalSurface        // 표면 타입 (발소리 등)             │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 결합 모드

```cpp
enum EFrictionCombineMode
{
    Average,     // (A + B) / 2
    Min,         // min(A, B)
    Multiply,    // A * B
    Max          // max(A, B)
};
```

### 사용 예시

```cpp
// 물리 재질 생성 (에디터에서)
UPhysicalMaterial* IceMaterial = NewObject<UPhysicalMaterial>();
IceMaterial->Friction = 0.05f;          // 미끄러움
IceMaterial->Restitution = 0.1f;        // 낮은 반발
IceMaterial->SurfaceType = SurfaceType_Ice;

// 컴포넌트에 적용
MeshComponent->BodyInstance.SetPhysMaterialOverride(IceMaterial);

// 또는 머티리얼을 통해 적용
UMaterialInterface* Material = MeshComponent->GetMaterial(0);
Material->GetPhysicalMaterial();  // 머티리얼에 설정된 물리 재질
```

---

## ⚡ 성능 고려사항

### 1. 물리 객체 풀링

```cpp
// 나쁜 예: 반복적인 생성/파괴
void SpawnProjectile()
{
    AActor* Projectile = GetWorld()->SpawnActor<AProjectile>();
    Projectile->MeshComponent->SetSimulatePhysics(true);
}

// 좋은 예: 오브젝트 풀 사용
class AProjectilePool
{
    TArray<AProjectile*> Pool;

    AProjectile* GetProjectile()
    {
        for (AProjectile* P : Pool)
        {
            if (!P->IsActive())
            {
                P->Activate();
                return P;
            }
        }
        // 풀이 비었으면 확장
        return CreateNewProjectile();
    }
};
```

### 2. 적절한 Sleep 설정

```cpp
// 빠른 Sleep으로 CPU 절약
BodyInstance.SleepFamily = ESleepFamily::Normal;
BodyInstance.CustomSleepThresholdMultiplier = 1.0f;

// 민감한 물체는 Sleep 지연
BodyInstance.SleepFamily = ESleepFamily::Sensitive;
```

### 3. 최소한의 충돌 복잡도

```cpp
// 간단한 충돌 형상 사용
UBodySetup* BodySetup = StaticMesh->GetBodySetup();
BodySetup->CollisionTraceFlag = CTF_UseSimpleAsComplex;  // Simple만 사용
```

---

## 💡 Tips & 디버깅

### 디버그 시각화

```cpp
// 콘솔
show collision              // 충돌 형상 표시
p.VisualizeConstraints 1   // 제약 조건 시각화

// C++에서
DrawDebugBox(World, BodyInstance.GetUnrealWorldTransform().GetLocation(), ...);
```

### 일반적인 문제

| 문제 | 원인 | 해결 |
|------|------|------|
| 물체가 떨림 | 과도한 질량 비율 | 질량 조정, 솔버 반복 증가 |
| 물체가 통과됨 | CCD 비활성화 | `bUseCCD = true` |
| 느린 성능 | 과도한 물리 객체 | 풀링, Sleep 활용 |
| 불안정한 스택 | 솔버 반복 부족 | 반복 횟수 증가 |

---

## 🔗 관련 문서

- [Overview.md](Overview.md) - 물리 시스템 개요
- [Collision_And_SceneQuery.md](Collision_And_SceneQuery.md) - 충돌 및 쿼리
- [PhysicsAsset.md](PhysicsAsset.md) - 스켈레탈 메시 물리

---

> 이 문서는 FBodyInstance와 물리 인터페이스를 설명합니다.