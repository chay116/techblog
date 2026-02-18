---
title: "Chaos Ragdoll Physics"
date: "2025-12-09"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Physics"
tags: ["unreal", "Physics"]
engine_version: "** Unreal Engine 5.7"
---
# Chaos Ragdoll Physics

## 🧭 개요

**Ragdoll Physics**는 캐릭터의 사망, 넉백, 물리 기반 애니메이션을 구현하는 시스템입니다. Skeletal Mesh의 본(Bone)들을 물리 바디로 시뮬레이션하며, 제약(Constraint)으로 연결됩니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Physics Asset** | 물리 바디와 제약 정의 에셋 |
| **Body Instance** | 각 본의 물리 바디 |
| **Constraint Instance** | 본 간의 물리적 연결 |
| **Physical Animation** | 물리와 애니메이션 블렌드 |

---

## 🧱 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          Ragdoll Architecture                                    │
└─────────────────────────────────────────────────────────────────────────────────┘

  USkeletalMeshComponent
         │
         ├── UPhysicsAsset
         │        │
         │        ├── USkeletalBodySetup[] (각 본의 물리 바디)
         │        │        │
         │        │        ├── Bone Name
         │        │        ├── Collision Shapes (Sphere, Capsule, Box)
         │        │        ├── Physics Type (Default, Kinematic, Simulated)
         │        │        └── Physical Material
         │        │
         │        └── FConstraintInstance[] (본 간 제약)
         │                 │
         │                 ├── Constraint Bone 1, 2
         │                 ├── Linear Limits
         │                 ├── Angular Limits
         │                 └── Motor/Drive Settings
         │
         └── UPhysicalAnimationComponent (물리 애니메이션)
                  │
                  ├── Profile Settings
                  ├── Body Modifiers
                  └── Blend Weights

```

---

## 📂 주요 소스 파일

| 파일 | 역할 |
|------|------|
| `Engine/Classes/PhysicsEngine/PhysicsAsset.h` | Physics Asset 클래스 |
| `Engine/Classes/PhysicsEngine/BodySetup.h` | 바디 설정 |
| `Engine/Classes/PhysicsEngine/ConstraintInstance.h` | 제약 인스턴스 |
| `Engine/Classes/PhysicsEngine/PhysicalAnimationComponent.h` | 물리 애니메이션 |
| `Engine/Private/PhysicsEngine/BodyInstance.cpp` | 바디 인스턴스 구현 |

---

## 🔷 Physics Asset

### 구조

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            UPhysicsAsset                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Bodies (USkeletalBodySetup[]):                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  [0] Pelvis                                                             │   │
│  │      ├── Collision: Sphere (Radius: 15)                                │   │
│  │      ├── Mass: 10.0 kg                                                 │   │
│  │      └── Physics Type: Simulated                                       │   │
│  │                                                                         │   │
│  │  [1] Spine_01                                                          │   │
│  │      ├── Collision: Capsule (Radius: 12, HalfHeight: 10)              │   │
│  │      ├── Mass: 8.0 kg                                                  │   │
│  │      └── Physics Type: Simulated                                       │   │
│  │                                                                         │   │
│  │  [2] Head                                                              │   │
│  │      ├── Collision: Sphere (Radius: 10)                                │   │
│  │      ├── Mass: 5.0 kg                                                  │   │
│  │      └── Physics Type: Simulated                                       │   │
│  │                                                                         │   │
│  │  ... (팔, 다리 등)                                                     │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  Constraints (FConstraintInstance[]):                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  [0] Pelvis ←→ Spine_01                                                │   │
│  │      ├── Swing1: Limited (45°)                                         │   │
│  │      ├── Swing2: Limited (45°)                                         │   │
│  │      └── Twist: Limited (30°)                                          │   │
│  │                                                                         │   │
│  │  [1] Spine_01 ←→ Spine_02                                              │   │
│  │      └── Similar limits...                                             │   │
│  │                                                                         │   │
│  │  [2] Neck ←→ Head                                                      │   │
│  │      └── Limited rotation...                                           │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔶 Ragdoll 활성화

### 기본 활성화

```cpp
// 전체 Ragdoll 활성화
void EnableRagdoll(USkeletalMeshComponent* MeshComp)
{
    if (MeshComp)
    {
        // 모든 바디를 물리 시뮬레이션으로 전환
        MeshComp->SetAllBodiesSimulatePhysics(true);

        // 블렌드 모드 설정
        MeshComp->SetAllBodiesPhysicsBlendWeight(1.0f);

        // 충돌 활성화
        MeshComp->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);

        // 중력 활성화
        MeshComp->SetEnableGravity(true);
    }
}
```

### 부분 Ragdoll

```cpp
// 특정 본만 Ragdoll
void EnablePartialRagdoll(USkeletalMeshComponent* MeshComp, FName BoneName)
{
    if (MeshComp)
    {
        // 특정 본과 자식들만 물리 활성화
        MeshComp->SetAllBodiesBelowSimulatePhysics(BoneName, true);

        // 블렌드 웨이트 설정
        MeshComp->SetAllBodiesBelowPhysicsBlendWeight(BoneName, 1.0f);
    }
}

// 예: 상체만 Ragdoll
EnablePartialRagdoll(MeshComp, TEXT("Spine_01"));
```

---

## 🔷 Physical Animation Component

### 구조

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      UPhysicalAnimationComponent                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  역할: 물리 시뮬레이션과 애니메이션을 블렌드                                    │
│                                                                                  │
│  Profile Settings:                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  Strength           : 물리로 당기는 힘 (0~1, 높을수록 애니메이션 추종)  │   │
│  │  OrientationStrength: 회전 강도                                        │   │
│  │  VelocityStrength   : 속도 매칭 강도                                   │   │
│  │  PositionStrength   : 위치 매칭 강도                                   │   │
│  │  MaxLinearForce     : 최대 선형 힘                                     │   │
│  │  MaxAngularForce    : 최대 각 힘                                       │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  Body Modifiers:                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  본 이름 → 개별 설정 오버라이드                                        │   │
│  │    - Pelvis: Strength=0.8                                              │   │
│  │    - Head: Strength=0.5                                                │   │
│  │    - Hand_L/R: Strength=0.3                                            │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 사용 예시

```cpp
// Physical Animation Component 설정
void SetupPhysicalAnimation(ACharacter* Character)
{
    UPhysicalAnimationComponent* PhysAnimComp =
        Character->FindComponentByClass<UPhysicalAnimationComponent>();

    if (!PhysAnimComp)
    {
        PhysAnimComp = NewObject<UPhysicalAnimationComponent>(Character);
        PhysAnimComp->RegisterComponent();
    }

    // 전체 프로파일 설정
    FPhysicalAnimationProfile Profile;
    Profile.Strength = 0.7f;
    Profile.OrientationStrength = 0.5f;
    Profile.VelocityStrength = 0.5f;

    PhysAnimComp->ApplyPhysicalAnimationProfileBelow(
        TEXT("Pelvis"),   // 시작 본
        Profile           // 프로파일
    );

    // 특정 본 오버라이드
    FPhysicalAnimationProfile HeadProfile;
    HeadProfile.Strength = 0.3f;  // 머리는 더 느슨하게

    PhysAnimComp->ApplyPhysicalAnimationSettingsToBody(
        TEXT("Head"),
        HeadProfile
    );
}
```

---

## 🔶 Physics Blend

### 블렌드 웨이트

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          Physics Blend Weight                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  BlendWeight = 0.0 (애니메이션)     BlendWeight = 1.0 (물리)                   │
│                                                                                  │
│       ●                                    ●                                    │
│      /│\      ← 애니메이션 포즈           /│\      ← 물리 시뮬레이션           │
│       │                                   /  \                                  │
│      / \                                 /    \                                 │
│     /   \                               /      \                                │
│                                                                                  │
│  BlendWeight = 0.5 (절반 블렌드)                                               │
│                                                                                  │
│       ●                                                                         │
│      /│\      ← 애니메이션 + 물리 혼합                                         │
│      / \                                                                        │
│     /   \                                                                       │
│                                                                                  │
│  사용 사례:                                                                     │
│  - 0.0: 순수 애니메이션                                                        │
│  - 0.1~0.3: 미세한 물리 반응 (히트 리액션)                                     │
│  - 0.5: 물리 기반 이동 + 애니메이션 포즈                                       │
│  - 1.0: 완전한 Ragdoll                                                         │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 블렌드 전환

```cpp
// 부드러운 Ragdoll 전환
void BlendToRagdoll(USkeletalMeshComponent* MeshComp, float Duration)
{
    // 타이머로 점진적 전환
    float ElapsedTime = 0.f;
    FTimerHandle TimerHandle;

    GetWorld()->GetTimerManager().SetTimer(
        TimerHandle,
        [MeshComp, Duration, &ElapsedTime]()
        {
            ElapsedTime += 0.016f;  // ~60 FPS
            float Alpha = FMath::Clamp(ElapsedTime / Duration, 0.f, 1.f);

            MeshComp->SetAllBodiesPhysicsBlendWeight(Alpha);

            if (Alpha >= 1.f)
            {
                // 전환 완료
                MeshComp->SetAllBodiesSimulatePhysics(true);
            }
        },
        0.016f,
        true
    );
}
```

---

## 🔷 Constraint Settings

### 제약 설정

```cpp
// FConstraintInstance 주요 설정
struct FConstraintProfileProperties
{
    // Linear Limits
    ELinearConstraintMotion LinearXMotion;  // Free/Limited/Locked
    ELinearConstraintMotion LinearYMotion;
    ELinearConstraintMotion LinearZMotion;
    float LinearLimit;                       // 선형 제한 거리

    // Angular Limits
    EAngularConstraintMotion Swing1Motion;   // Y축 회전
    EAngularConstraintMotion Swing2Motion;   // Z축 회전
    EAngularConstraintMotion TwistMotion;    // X축 회전
    float Swing1LimitAngle;                  // 도 단위
    float Swing2LimitAngle;
    float TwistLimitAngle;

    // Soft Limits
    bool bSoftSwingLimit;
    float SwingLimitStiffness;
    float SwingLimitDamping;

    // Motor/Drive
    EAngularDriveMode AngularDriveMode;      // SLERP/TwistSwing
    FRotator AngularOrientationTarget;
    FVector AngularVelocityTarget;
    float AngularDriveStiffness;
    float AngularDriveDamping;
    float AngularMaxForce;
};
```

---

## 💡 실전 사용 예시

### 1. 사망 Ragdoll

```cpp
void AMyCharacter::Die()
{
    // 애니메이션 중지
    GetMesh()->SetAnimInstanceClass(nullptr);

    // Ragdoll 활성화
    GetMesh()->SetAllBodiesSimulatePhysics(true);
    GetMesh()->SetCollisionProfileName(TEXT("Ragdoll"));

    // 마지막 속도 유지
    FVector DeathVelocity = GetVelocity();
    GetMesh()->SetAllPhysicsLinearVelocity(DeathVelocity);

    // 충격 임펄스 (옵션)
    GetMesh()->AddImpulseAtLocation(
        DeathImpulse * 10000.f,
        HitLocation,
        HitBoneName
    );

    // Movement 비활성화
    GetCharacterMovement()->DisableMovement();
}
```

### 2. 히트 리액션

```cpp
void AMyCharacter::OnHit(FVector HitLocation, FVector HitNormal, float Damage)
{
    // 히트 본 찾기
    FName HitBone = GetClosestBone(HitLocation);

    // 물리 임펄스 적용
    FVector Impulse = -HitNormal * Damage * 100.f;
    GetMesh()->AddImpulseAtLocation(Impulse, HitLocation, HitBone);

    // 잠시 물리 블렌드 증가
    StartPhysicsBlend(HitBone, 0.3f, 0.5f);  // 30% 블렌드, 0.5초
}

void AMyCharacter::StartPhysicsBlend(FName BoneName, float Weight, float Duration)
{
    // Physical Animation으로 블렌드
    if (PhysicalAnimationComponent)
    {
        FPhysicalAnimationProfile Profile;
        Profile.Strength = 1.0f - Weight;  // 낮을수록 물리 영향 증가

        PhysicalAnimationComponent->ApplyPhysicalAnimationSettingsToBody(
            BoneName,
            Profile
        );

        // 타이머로 복원
        FTimerHandle Handle;
        GetWorldTimerManager().SetTimer(Handle, [this, BoneName]()
        {
            // 원래 설정으로 복원
            RestorePhysicsBlend(BoneName);
        }, Duration, false);
    }
}
```

### 3. 물리 기반 이동

```cpp
void AMyCharacter::SetupPhysicsBasedMovement()
{
    // 상체만 물리
    GetMesh()->SetAllBodiesBelowSimulatePhysics(TEXT("Spine_01"), true);
    GetMesh()->SetAllBodiesBelowPhysicsBlendWeight(TEXT("Spine_01"), 0.5f);

    // Physical Animation 설정
    if (PhysicalAnimationComponent)
    {
        FPhysicalAnimationProfile Profile;
        Profile.Strength = 0.5f;
        Profile.OrientationStrength = 0.8f;

        PhysicalAnimationComponent->ApplyPhysicalAnimationProfileBelow(
            TEXT("Spine_01"),
            Profile
        );
    }
}
```

---

## ⚙️ 성능 최적화

### 1. LOD 기반 Ragdoll

```cpp
void UpdateRagdollLOD(USkeletalMeshComponent* MeshComp, float Distance)
{
    if (Distance > 2000.f)
    {
        // 먼 거리: 단순화
        MeshComp->SetAllBodiesSimulatePhysics(false);
        // 애니메이션으로 전환
    }
    else if (Distance > 1000.f)
    {
        // 중간 거리: 주요 본만
        MeshComp->SetAllBodiesSimulatePhysics(false);
        MeshComp->SetBodySimulatePhysics(TEXT("Pelvis"), true);
        MeshComp->SetBodySimulatePhysics(TEXT("Spine_02"), true);
        MeshComp->SetBodySimulatePhysics(TEXT("Head"), true);
    }
    else
    {
        // 가까운 거리: 전체 Ragdoll
        MeshComp->SetAllBodiesSimulatePhysics(true);
    }
}
```

### 2. 관련 CVars

```cpp
// Ragdoll 디버그
p.Chaos.DebugDraw.Ragdoll = 1             // Ragdoll 시각화
p.RagdollAggregateThreshold = 4           // 집합 임계값

// 성능
p.SkeletalMesh.DisableRagdoll = 0         // Ragdoll 비활성화
p.RagdollPhysicsBlend.MaxDistance = 3000  // 최대 블렌드 거리
```

---

## 🔧 일반적인 문제 및 해결

| 문제 | 원인 | 해결 |
|------|------|------|
| **본이 이상하게 꺾임** | 제약 범위 초과 | Angular Limit 조정 |
| **떨림/진동** | Mass 불균형 | 본 간 Mass 비율 조정 |
| **바닥 통과** | 충돌 문제 | Collision Profile 확인 |
| **너무 느슨함** | 제약 약함 | Stiffness 증가 |
| **너무 뻣뻣함** | 제약 강함 | Damping 증가, Limit 확대 |

---

## 🔗 관련 문서

- [Overview.md](Overview.md) - 물리 시스템 개요
- [Chaos_Constraint_Types_Deep_Dive.md](Chaos_Constraint_Types_Deep_Dive.md) - 제약 시스템
- [Chaos_Physics_Materials.md](Chaos_Physics_Materials.md) - 물리 재질

---

> 이 문서는 Chaos Ragdoll Physics 시스템을 설명합니다.