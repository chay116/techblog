---
title: "Chaos Constraint Types Deep Dive"
date: "2025-12-09"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Physics"
tags: ["unreal", "Physics"]
engine_version: "** Unreal Engine 5.7"
---
# Chaos Constraint Types Deep Dive

## 🧭 개요

**Chaos Physics**에서 **Constraint (제약)**는 두 개 이상의 강체 간의 관계를 정의하는 핵심 시스템입니다. Joint, Spring, Suspension 등 다양한 제약 타입이 존재하며, 각각 특화된 물리적 행동을 구현합니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Constraint** | 두 Body 사이의 물리적 관계 정의 |
| **Joint** | 6-DOF 자유도 제어 (회전/이동 제한) |
| **Spring** | 탄성력 기반 연결 |
| **Suspension** | 차량용 서스펜션 시뮬레이션 |
| **Motor/Drive** | 목표 위치/속도로 구동하는 힘 |

---

## 🧱 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Chaos Constraint Architecture                             │
└─────────────────────────────────────────────────────────────────────────────────┘

  FPBDConstraintContainer (Base)
           │
           ├── FPBDJointConstraints
           │        │
           │        ├── 6-DOF Joint (Position + Rotation)
           │        ├── Linear Limits (X, Y, Z)
           │        ├── Angular Limits (Swing1, Swing2, Twist)
           │        ├── Motors/Drives
           │        └── Soft/Hard Limits
           │
           ├── FPBDSpringConstraints
           │        │
           │        ├── Linear Spring
           │        ├── Stiffness/Damping
           │        └── Rest Length
           │
           ├── FPBDSuspensionConstraints
           │        │
           │        ├── Wheel Attachment
           │        ├── Spring Rate
           │        ├── Damping
           │        └── Travel Limits
           │
           └── FPBDPositionConstraints
                    │
                    ├── Point-to-Point
                    └── Target Position Lock

```

---

## 📂 주요 소스 파일

| 파일 | 역할 |
|------|------|
| `Chaos/Public/Chaos/PBDJointConstraints.h` | Joint 제약 정의 |
| `Chaos/Public/Chaos/PBDSpringConstraints.h` | Spring 제약 정의 |
| `Chaos/Public/Chaos/PBDSuspensionConstraints.h` | Suspension 제약 정의 |
| `Chaos/Public/Chaos/PBDJointConstraintTypes.h` | Joint 타입 열거 |
| `Chaos/Public/Chaos/PBDJointConstraintData.h` | Joint 데이터 구조체 |
| `Engine/Classes/PhysicsEngine/ConstraintInstance.h` | UE 통합 레이어 |

---

## 🔷 Joint Constraints (관절 제약)

### 1. FPBDJointConstraints 구조

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           FPBDJointConstraints                                   │
│  (6-DOF 관절 시스템)                                                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                        Linear Constraints                                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                     │   │
│  │  │    X축      │  │    Y축      │  │    Z축      │                     │   │
│  │  │ - Free     │  │ - Free     │  │ - Free     │                     │   │
│  │  │ - Limited  │  │ - Limited  │  │ - Limited  │                     │   │
│  │  │ - Locked   │  │ - Locked   │  │ - Locked   │                     │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                     │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                       Angular Constraints                                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                     │   │
│  │  │   Swing1    │  │   Swing2    │  │   Twist     │                     │   │
│  │  │ (Y축 회전) │  │ (Z축 회전) │  │ (X축 회전) │                     │   │
│  │  │ - Free     │  │ - Free     │  │ - Free     │                     │   │
│  │  │ - Limited  │  │ - Limited  │  │ - Limited  │                     │   │
│  │  │ - Locked   │  │ - Locked   │  │ - Locked   │                     │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                     │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         Motors/Drives                                    │   │
│  │  - Position Drive: 목표 위치로 구동                                     │   │
│  │  - Velocity Drive: 목표 속도로 구동                                     │   │
│  │  - SLERP Drive: 구면 보간 회전                                          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2. Joint Motion Types

```cpp
// PBDJointConstraintTypes.h
enum class EJointMotionType : uint8
{
    Free,       // 자유 이동/회전
    Limited,    // 범위 내 제한
    Locked      // 완전 고정
};

// 각 축별 설정 예시
struct FJointSettings
{
    // Linear (이동)
    EJointMotionType LinearMotion[3];  // X, Y, Z
    FVector LinearLimit;                // 이동 제한 거리

    // Angular (회전)
    EJointMotionType AngularMotion[3]; // Swing1, Swing2, Twist
    float Swing1Limit;                  // 각도 (라디안)
    float Swing2Limit;
    float TwistLimit;
};
```

### 3. Soft vs Hard Limits

```
Hard Limit (강한 제한)                    Soft Limit (부드러운 제한)
        │                                          │
        │    ┌────────────────┐                   │    ╭────────────────╮
        │    │                │                   │   ╱                  ╲
 Force  │    │                │            Force  │  ╱                    ╲
        │    │                │                   │ ╱                      ╲
        │────┴────────────────┴───                │╱________________________╲
             Limit    Position                        Limit    Position

특징:                                     특징:
- 즉시 정지                              - 스프링처럼 작동
- 반발력 무한대                          - Stiffness로 강도 조절
- 물리적으로 단단한 벽                   - Damping으로 진동 감쇠
```

```cpp
// Soft Limit 설정
struct FSoftConstraintSettings
{
    bool bSoftLimit;           // Soft Limit 활성화
    float Stiffness;           // 스프링 강도 (N/m 또는 N*m/rad)
    float Damping;             // 감쇠 계수
    float Restitution;         // 반발 계수 (Hard Limit용)
    float ContactDistance;     // 제한 근처 활성화 거리
};
```

### 4. Motor/Drive 시스템

```cpp
// Position Target Drive
struct FJointDriveSettings
{
    // Linear Drive
    FVector LinearPositionTarget;      // 목표 위치
    FVector LinearVelocityTarget;      // 목표 속도
    float LinearDriveStiffness;        // 위치 스프링 강도
    float LinearDriveDamping;          // 속도 댐핑
    float LinearMaxForce;              // 최대 힘

    // Angular Drive
    FQuat AngularPositionTarget;       // 목표 회전
    FVector AngularVelocityTarget;     // 목표 각속도
    float AngularDriveStiffness;
    float AngularDriveDamping;
    float AngularMaxTorque;            // 최대 토크

    // Drive Mode
    EJointDriveMode DriveMode;         // SLERP vs Swing/Twist
};

enum class EJointDriveMode : uint8
{
    SLERP,      // 구면 선형 보간 (부드러운 회전)
    TwistSwing  // Twist/Swing 분리 구동
};
```

---

## 🔶 Spring Constraints (스프링 제약)

### FPBDSpringConstraints 구조

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          FPBDSpringConstraints                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│     Body A ●────────⟿⟿⟿⟿⟿⟿────────● Body B                                   │
│                   Spring                                                         │
│                                                                                  │
│  Parameters:                                                                     │
│    - RestLength: 자연 길이 (이 길이에서 힘 = 0)                                 │
│    - Stiffness: 스프링 상수 (k)                                                 │
│    - Damping: 감쇠 계수 (c)                                                     │
│                                                                                  │
│  Force = -k * (CurrentLength - RestLength) - c * RelativeVelocity               │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```cpp
// Spring Constraint 설정
struct FSpringConstraintSettings
{
    FVector LocalAnchorA;      // Body A의 로컬 연결점
    FVector LocalAnchorB;      // Body B의 로컬 연결점
    float RestLength;          // 자연 길이
    float Stiffness;           // 스프링 상수 (N/m)
    float Damping;             // 감쇠 계수 (N*s/m)
    float MinLength;           // 최소 길이 (선택)
    float MaxLength;           // 최대 길이 (선택)
};
```

---

## 🔷 Suspension Constraints (서스펜션 제약)

### FPBDSuspensionConstraints 구조

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       FPBDSuspensionConstraints                                  │
│  (차량 서스펜션 전용)                                                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│              Vehicle Body                                                        │
│           ┌──────────────┐                                                       │
│           │              │                                                       │
│     ┌─────┴─────┐  ┌─────┴─────┐                                               │
│     │           │  │           │                                               │
│     ⟿          ⟿  ⟿          ⟿  ← Suspension Springs                         │
│     │           │  │           │                                               │
│    (●)         (●)(●)         (●) ← Wheels                                     │
│                                                                                  │
│  Parameters per Suspension:                                                      │
│    - SpringRate: 스프링 강도 (N/m)                                              │
│    - DampingRatio: 감쇠 비율                                                    │
│    - MaxRaise: 최대 확장 거리                                                    │
│    - MaxDrop: 최대 압축 거리                                                     │
│    - SuspensionAxis: 서스펜션 축 방향                                           │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```cpp
// Suspension 설정
struct FSuspensionSettings
{
    FVector SuspensionAxis;         // 서스펜션 축 (보통 -Z)
    float MaxRaise;                 // 최대 확장 (리바운드)
    float MaxDrop;                  // 최대 압축
    float RestLength;               // 정지 상태 길이
    float SpringRate;               // 스프링 강도
    float SpringPreload;            // 초기 하중
    float DampingRatio;             // 감쇠 비율 (0-1, 1=임계감쇠)
    float CompressionDamping;       // 압축 감쇠
    float ReboundDamping;           // 리바운드 감쇠
};
```

---

## 🔶 Position Constraints (위치 제약)

### 기본 위치 제약

```cpp
// Point-to-Point Constraint
struct FPositionConstraintSettings
{
    FVector LocalAnchorA;
    FVector LocalAnchorB;
    float Stiffness;        // 강도 (높을수록 rigid)
    float Damping;          // 감쇠
};

// Point-to-World Constraint (한쪽만 고정)
struct FWorldPositionConstraint
{
    FVector WorldTarget;    // 월드 좌표 목표 위치
    FVector LocalAnchor;    // Body의 로컬 연결점
    float Stiffness;
    float Damping;
};
```

---

## 💡 UE 통합: FConstraintInstance

### Blueprint/에디터용 Constraint 설정

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           FConstraintInstance                                    │
│  (Physics Asset Editor에서 설정하는 Constraint)                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Profile Settings (FConstraintProfileProperties):                               │
│    ├── Linear Limits                                                            │
│    │     ├── XMotion: Free/Limited/Locked                                      │
│    │     ├── YMotion: Free/Limited/Locked                                      │
│    │     ├── ZMotion: Free/Limited/Locked                                      │
│    │     └── Limit: Distance (cm)                                              │
│    │                                                                            │
│    ├── Angular Limits                                                           │
│    │     ├── Swing1Motion + Swing1LimitAngle                                   │
│    │     ├── Swing2Motion + Swing2LimitAngle                                   │
│    │     └── TwistMotion + TwistLimitAngle                                     │
│    │                                                                            │
│    ├── Linear Drive                                                             │
│    │     ├── bEnablePositionDrive                                              │
│    │     ├── LinearPositionTarget                                              │
│    │     ├── LinearVelocityTarget                                              │
│    │     ├── LinearDriveSpring/Damping/MaxForce                                │
│    │                                                                            │
│    └── Angular Drive                                                            │
│          ├── AngularDriveMode: SLERP/TwistSwing                                │
│          ├── OrientationTarget                                                 │
│          ├── AngularVelocityTarget                                             │
│          └── AngularDriveSpring/Damping/MaxTorque                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## ⚙️ 제약 솔버 동작

### PBD (Position Based Dynamics) 솔버

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          PBD Constraint Solving                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  매 Physics Step:                                                               │
│                                                                                  │
│  1. Predict Positions                                                           │
│     │  X' = X + V * dt                                                         │
│     ↓                                                                           │
│  2. Solve Constraints (반복)                                                    │
│     │  for iteration in 0..NumIterations:                                      │
│     │      for each constraint:                                                │
│     │          ΔX = SolveConstraint(X')                                        │
│     │          X' += ΔX                                                        │
│     ↓                                                                           │
│  3. Update Velocities                                                           │
│     │  V = (X' - X) / dt                                                       │
│     ↓                                                                           │
│  4. Apply Position                                                              │
│        X = X'                                                                   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Constraint Priority (우선순위)

```cpp
// 제약 적용 순서
enum class EConstraintPriority
{
    Contact,        // 접촉 제약 (가장 먼저)
    Joint,          // 관절 제약
    Spring,         // 스프링 제약
    Suspension,     // 서스펜션
    Other           // 기타
};
```

---

## 🔧 실전 사용 예시

### 1. Blueprint에서 Physics Constraint 생성

```cpp
// Physics Constraint Component 사용
UPROPERTY(VisibleAnywhere)
UPhysicsConstraintComponent* ConstraintComp;

void AMyActor::SetupConstraint()
{
    ConstraintComp = CreateDefaultSubobject<UPhysicsConstraintComponent>(TEXT("Constraint"));

    // 연결할 컴포넌트 설정
    ConstraintComp->SetConstrainedComponents(
        MeshA, NAME_None,
        MeshB, NAME_None
    );

    // Linear 제한
    ConstraintComp->SetLinearXLimit(ELinearConstraintMotion::LCM_Locked, 0.f);
    ConstraintComp->SetLinearYLimit(ELinearConstraintMotion::LCM_Locked, 0.f);
    ConstraintComp->SetLinearZLimit(ELinearConstraintMotion::LCM_Limited, 50.f);

    // Angular 제한
    ConstraintComp->SetAngularSwing1Limit(EAngularConstraintMotion::ACM_Limited, 45.f);
    ConstraintComp->SetAngularSwing2Limit(EAngularConstraintMotion::ACM_Limited, 45.f);
    ConstraintComp->SetAngularTwistLimit(EAngularConstraintMotion::ACM_Locked, 0.f);
}
```

### 2. Motor Drive로 문 열기

```cpp
void ADoor::OpenDoor()
{
    // Angular Drive 설정
    ConstraintComp->SetAngularDriveMode(EAngularDriveMode::TwistAndSwing);

    // 목표 회전 설정 (90도 열림)
    FRotator TargetRotation = FRotator(0.f, 90.f, 0.f);
    ConstraintComp->SetAngularOrientationTarget(TargetRotation);

    // Drive 파라미터
    ConstraintComp->SetAngularDriveParams(
        1000.f,     // Spring (강도)
        100.f,      // Damping (감쇠)
        10000.f     // MaxForce (최대 토크)
    );
}
```

### 3. 체인 링크 생성

```cpp
void AChain::CreateChainLinks(int32 NumLinks)
{
    UStaticMeshComponent* PrevLink = nullptr;

    for (int32 i = 0; i < NumLinks; ++i)
    {
        // 링크 메시 생성
        UStaticMeshComponent* Link = NewObject<UStaticMeshComponent>(this);
        Link->SetStaticMesh(ChainLinkMesh);
        Link->SetSimulatePhysics(true);
        Link->SetWorldLocation(StartLocation + FVector(0, 0, -i * LinkSpacing));

        if (PrevLink)
        {
            // Constraint 생성
            UPhysicsConstraintComponent* Constraint = NewObject<UPhysicsConstraintComponent>(this);
            Constraint->SetConstrainedComponents(PrevLink, NAME_None, Link, NAME_None);

            // Ball-Socket Joint (모든 회전 자유)
            Constraint->SetLinearXLimit(LCM_Locked, 0);
            Constraint->SetLinearYLimit(LCM_Locked, 0);
            Constraint->SetLinearZLimit(LCM_Locked, 0);
            Constraint->SetAngularSwing1Limit(ACM_Free, 0);
            Constraint->SetAngularSwing2Limit(ACM_Free, 0);
            Constraint->SetAngularTwistLimit(ACM_Free, 0);
        }

        PrevLink = Link;
    }
}
```

---

## ⚡ 성능 고려사항

### 1. Iteration Count

```cpp
// 프로젝트 세팅 또는 런타임
// 높을수록 정확하지만 느림
p.Chaos.Solver.JointIterations = 8;      // 기본값
p.Chaos.Solver.JointPushOutIterations = 2;
```

### 2. Constraint 최적화

| 최적화 방법 | 설명 |
|------------|------|
| **Constraint 수 최소화** | 필요한 것만 사용 |
| **Soft Limit 사용** | Hard보다 안정적 |
| **적절한 Stiffness** | 너무 높으면 불안정 |
| **Island 분리** | 독립적인 시스템 분리 |

### 3. 일반적인 문제 및 해결

| 문제 | 원인 | 해결 |
|------|------|------|
| **Joint 진동** | Stiffness 과다 | Damping 증가 또는 Soft Limit |
| **분리됨** | Break Force 초과 | Force 증가 또는 무한대 설정 |
| **느린 반응** | Drive Stiffness 부족 | Spring 값 증가 |
| **불안정** | Mass 불균형 | Mass Scale 조정 |

---

## 🔗 관련 문서

- [Overview.md](Overview.md) - 물리 시스템 개요
- [Chaos_Complete_Architecture.md](Chaos_Complete_Architecture.md) - Chaos 전체 구조
- [Chaos_Vehicle_Physics_Deep_Dive.md](Chaos_Vehicle_Physics_Deep_Dive.md) - Vehicle Physics (Suspension 활용)
- [Chaos_Ragdoll_Physics.md](Chaos_Ragdoll_Physics.md) - Ragdoll (Joint 활용)

---

> 이 문서는 Chaos Physics의 Constraint 시스템을 설명합니다.