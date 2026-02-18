---
title: "MuJoCoTypes - 핵심 데이터 구조"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "MuJoCoChaos"
tags: ["unreal", "MuJoCoChaos"]
---
# MuJoCoTypes - 핵심 데이터 구조

> Updated: 2025-12-17 — MuJoCoChaos 타입 시스템 문서화

## 🧭 Overview

MuJoCoTypes.h는 MuJoCo 스타일의 물리 시뮬레이션을 위한 **핵심 데이터 구조**를 정의합니다. Generalized Coordinates (일반화 좌표)를 기반으로 한 관절체 물리를 표현합니다.

**📂 위치:** `Plugins/MuJoCoChaos/Source/MuJoCoChaos/Public/MuJoCoTypes.h`

---

## 🧱 Type Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MuJoCoTypes Hierarchy                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Enums                                                                  │
│  ├── EJointType        (Fixed, Revolute, Prismatic, Spherical, Free)   │
│  ├── EActuatorType     (Force, Position, Velocity, Motor)              │
│  ├── EGeomType         (Sphere, Capsule, Box, Cylinder, Plane, Mesh)   │
│  ├── ESolverType       (PGS, TGS, Newton, XPBD)                        │
│  └── EIntegratorType   (Euler, RK4, Implicit)                          │
│                                                                         │
│  Primitives                                                             │
│  ├── FReal             (double precision floating point)               │
│  ├── FBodyInertia      (Mass, Inertia tensor, CoM)                     │
│  ├── FBodyTransform    (Position + Rotation)                           │
│  └── FBodyVelocity     (Linear + Angular velocity)                     │
│                                                                         │
│  Descriptors                                                            │
│  ├── FJointDesc        (Joint type, axis, limits, dynamics)            │
│  ├── FGeomDesc         (Collision geometry)                            │
│  ├── FActuatorDesc     (Actuator type, gains, limits)                  │
│  └── FContactInfo      (Contact detection result)                      │
│                                                                         │
│  Aggregates                                                             │
│  ├── FMuJoCoModel      (Static model data)                             │
│  ├── FMuJoCoState      (Dynamic simulation state)                      │
│  ├── FSimOptions       (Simulation parameters)                         │
│  └── FModelBuilder     (Fluent API for model construction)             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 Key Types

### 1. EJointType - 조인트 타입

```cpp
enum class EJointType : uint8
{
    Fixed,      // 0 DOF - 고정 연결
    Revolute,   // 1 DOF - 힌지 (회전)
    Prismatic,  // 1 DOF - 슬라이더 (이동)
    Spherical,  // 3 DOF - 볼 조인트 (쿼터니언)
    Free,       // 6 DOF - 자유 바디 (위치 + 쿼터니언)
};
```

#### 조인트별 qpos/qvel 차원

| 타입 | Nqpos | Nqvel | 설명 |
|------|-------|-------|------|
| Fixed | 0 | 0 | 고정 연결 |
| Revolute | 1 | 1 | 각도 (rad) |
| Prismatic | 1 | 1 | 변위 (cm) |
| Spherical | 4 | 3 | 쿼터니언 / 각속도 |
| Free | 7 | 6 | 위치+쿼터니언 / 선속도+각속도 |

### 2. FJointDesc - 조인트 기술자

```cpp
struct FJointDesc
{
    EJointType Type = EJointType::Revolute;
    int32 ParentBody = -1;      // 부모 바디 인덱스 (-1 = 월드)
    int32 ChildBody = 0;        // 자식 바디 인덱스

    FVector3d Axis = FVector3d(0, 0, 1);  // 회전/이동 축
    FVector3d AnchorParent;     // 부모 프레임의 앵커
    FVector3d AnchorChild;      // 자식 프레임의 앵커

    uint32 QposStart = 0;       // qpos 배열 시작 인덱스
    uint32 QvelStart = 0;       // qvel 배열 시작 인덱스
    uint32 NumDof = 1;          // 자유도

    // 한계
    FReal LimitLower = -PI;
    FReal LimitUpper = PI;
    bool bHasLimit = false;

    // 동역학 파라미터
    FReal Damping = 0.0;        // 점성 감쇠 (N·m·s/rad)
    FReal Stiffness = 0.0;      // 스프링 강성 (N·m/rad)
    FReal Friction = 0.0;       // 쿨롱 마찰 (N·m)
    FReal Armature = 0.0;       // 관성 증강 (kg·m²)

    // 유틸리티 함수
    static uint32 GetDofForType(EJointType Type);
    static uint32 GetQposForType(EJointType Type);
};
```

### 3. FBodyInertia - 바디 관성

```cpp
struct FBodyInertia
{
    FReal Mass = 1.0;
    FReal InvMass = 1.0;        // 1/Mass (캐시)

    FVector3d Inertia = FVector3d(1, 1, 1);     // 대각 관성 (Ixx, Iyy, Izz)
    FVector3d InvInertia = FVector3d(1, 1, 1);  // 역관성 (캐시)

    FVector3d LocalCOM = FVector3d::ZeroVector; // 로컬 질량 중심
};
```

### 4. FActuatorDesc - 액추에이터 기술자

```cpp
enum class EActuatorType : uint8
{
    Force,      // 직접 토크/힘 적용
    Position,   // PD 위치 제어
    Velocity,   // 속도 제어
    Motor,      // 모터 (역기전력 포함)
};

struct FActuatorDesc
{
    EActuatorType Type = EActuatorType::Force;
    int32 JointId = -1;         // 제어할 조인트

    FReal Gear = 1.0;           // 기어비
    FReal CtrlMin = -1.0;       // 제어 입력 최소값
    FReal CtrlMax = 1.0;        // 제어 입력 최대값
    FReal ForceMin = -1000.0;   // 출력 힘 최소값
    FReal ForceMax = 1000.0;    // 출력 힘 최대값

    // PD 제어 게인
    FReal Kp = 100.0;           // 비례 게인
    FReal Kv = 10.0;            // 미분 게인
};
```

### 5. FMuJoCoModel - 물리 모델

```cpp
struct FMuJoCoModel
{
    // ===== 차원 정보 =====
    uint32 Nq = 0;      // 일반화 위치 차원
    uint32 Nv = 0;      // 일반화 속도 차원
    uint32 Nu = 0;      // 액추에이터 수
    uint32 Nbody = 0;   // 바디 수
    uint32 Njnt = 0;    // 조인트 수
    uint32 Ngeom = 0;   // 지오메트리 수

    // ===== 바디 데이터 =====
    TArray<FBodyInertia> BodyInertia;    // 바디 관성 [Nbody]
    TArray<FBodyTransform> BodyLocalPose; // 로컬 포즈 [Nbody]
    TArray<int32> BodyParent;             // 부모 인덱스 [Nbody]

    // ===== 조인트/액추에이터 =====
    TArray<FJointDesc> Joints;            // 조인트 [Njnt]
    TArray<FActuatorDesc> Actuators;      // 액추에이터 [Nu]
    TArray<FGeomDesc> Geoms;              // 충돌 지오메트리 [Ngeom]

    // ===== 옵션 =====
    FSimOptions Options;

    // ===== 이름 매핑 =====
    TMap<FString, int32> BodyNames;
    TMap<FString, int32> JointNames;
    TMap<FString, int32> ActuatorNames;

    // ===== 제약/접촉 한계 =====
    uint32 MaxContacts = 100;
    uint32 MaxConstraints = 1000;
};
```

### 6. FMuJoCoState - 시뮬레이션 상태

```cpp
struct FMuJoCoState
{
    // ===== 일반화 좌표 =====
    TArray<FReal> Qpos;         // 일반화 위치 [Nq]
    TArray<FReal> Qvel;         // 일반화 속도 [Nv]
    TArray<FReal> Qacc;         // 일반화 가속도 [Nv]

    // ===== 제어/힘 =====
    TArray<FReal> Ctrl;         // 제어 입력 [Nu]
    TArray<FReal> QfrcBias;     // 편향력 (C + G) [Nv]
    TArray<FReal> QfrcApplied;  // 적용된 힘 [Nv]
    TArray<FReal> QfrcConstraint; // 제약력 [Nv]

    // ===== 월드 좌표 (순운동학 결과) =====
    TArray<FBodyTransform> Xpos; // 바디 월드 변환 [Nbody]
    TArray<FBodyVelocity> Xvel;  // 바디 월드 속도 [Nbody]
    TArray<FBodyForce> Xfrc;     // 바디 외부 힘 [Nbody]

    // ===== 접촉 =====
    TArray<FContactInfo> Contacts; // 활성 접촉
    uint32 NumContacts = 0;

    // ===== 솔버 정보 =====
    TArray<FSolverInfo> SolverInfo; // 솔버 통계

    // ===== 메서드 =====
    void Init(const FMuJoCoModel& Model, uint32 NumWorlds = 1);
    void Reset();
};
```

---

## 🔧 FModelBuilder - 모델 빌더

### Fluent API 패턴

```cpp
FMuJoCoModel Model = FModelBuilder()
    // 바디 추가
    .AddBody("world").SetMass(0.0)
    .AddBody("link1").SetParent(0).SetMass(1.0)
        .SetInertia(0.1, 0.1, 0.01)
        .SetLocalPosition(FVector3d(0, 0, -50))

    // 조인트 추가
    .AddJoint("hinge1")
        .SetJointType(EJointType::Revolute)
        .SetJointBodies(0, 1)
        .SetJointAxis(FVector3d(0, 1, 0))
        .SetJointLimits(-PI, PI)
        .SetJointDamping(0.1)

    // 액추에이터 추가
    .AddActuator("motor1")
        .SetActuatorType(EActuatorType::Force)
        .SetActuatorJoint(0)
        .SetActuatorForceRange(-100, 100)

    // 시뮬레이션 설정
    .SetTimestep(0.002)
    .SetGravity(FVector3d(0, 0, -981))
    .SetSolver(ESolverType::PGS)
    .SetIterations(100)

    .Build();
```

### 빌더 메서드 목록

| 카테고리 | 메서드 | 설명 |
|---------|--------|------|
| **바디** | `AddBody(name)` | 새 바디 추가 |
| | `SetParent(idx)` | 부모 바디 설정 |
| | `SetMass(m)` | 질량 설정 |
| | `SetInertia(Ixx, Iyy, Izz)` | 관성 텐서 설정 |
| | `SetLocalPosition(pos)` | 로컬 위치 설정 |
| | `SetCOM(com)` | 질량 중심 설정 |
| **조인트** | `AddJoint(name)` | 새 조인트 추가 |
| | `SetJointType(type)` | 조인트 타입 설정 |
| | `SetJointBodies(parent, child)` | 연결 바디 설정 |
| | `SetJointAxis(axis)` | 회전/이동 축 설정 |
| | `SetJointLimits(lo, hi)` | 한계값 설정 |
| | `SetJointDamping(d)` | 감쇠 계수 설정 |
| **액추에이터** | `AddActuator(name)` | 새 액추에이터 추가 |
| | `SetActuatorType(type)` | 액추에이터 타입 |
| | `SetActuatorJoint(idx)` | 제어할 조인트 |
| | `SetActuatorGains(Kp, Kv)` | PD 게인 설정 |
| **옵션** | `SetTimestep(dt)` | 시뮬레이션 dt |
| | `SetGravity(g)` | 중력 벡터 |
| | `SetSolver(type)` | 솔버 타입 |

---

## 📦 Predefined Models

### Models 네임스페이스

```cpp
namespace Models
{
    // 단일 진자
    FMuJoCoModel Pendulum(FReal Length = 100.0, FReal Mass = 1.0);

    // 이중 진자 (Acrobot)
    FMuJoCoModel DoublePendulum(
        FReal Length1 = 100.0, FReal Length2 = 100.0,
        FReal Mass1 = 1.0, FReal Mass2 = 1.0
    );

    // Cart-Pole (도립진자)
    FMuJoCoModel CartPole(
        FReal CartMass = 1.0,
        FReal PoleMass = 0.1,
        FReal PoleLength = 100.0
    );

    // N-링크 체인
    FMuJoCoModel Chain(
        uint32 NumLinks,
        FReal LinkLength = 50.0,
        FReal LinkMass = 1.0
    );
}
```

### 사용 예시

```cpp
// 단일 진자 모델 생성
FMuJoCoModel PendulumModel = Models::Pendulum(100.0, 1.0);

// 상태 초기화
FMuJoCoState State;
State.Init(PendulumModel, 1);

// 초기 각도 설정 (45도)
State.Qpos[0] = PI / 4.0;

// 제어 입력 (토크)
State.Ctrl[0] = 10.0;  // 10 N·m 토크
```

---

## 💡 Tips & Best Practices

### 단위 규약

| 물리량 | 단위 | 비고 |
|--------|------|------|
| 길이 | cm | UE 기본 단위 |
| 질량 | kg | SI 단위 |
| 시간 | s | SI 단위 |
| 각도 | rad | SI 단위 |
| 힘 | N | kg·cm/s² |
| 토크 | N·cm | kg·cm²/s² |

### 메모리 레이아웃

```
FMuJoCoState 메모리 레이아웃 (Pendulum 예시)
┌─────────────────────────────────────────────────────────────────┐
│ Qpos[0]    │ 조인트 0 각도 (rad)                                │
├─────────────────────────────────────────────────────────────────┤
│ Qvel[0]    │ 조인트 0 각속도 (rad/s)                            │
├─────────────────────────────────────────────────────────────────┤
│ Qacc[0]    │ 조인트 0 각가속도 (rad/s²)                         │
├─────────────────────────────────────────────────────────────────┤
│ Ctrl[0]    │ 액추에이터 0 입력 (-1 ~ 1 정규화)                  │
├─────────────────────────────────────────────────────────────────┤
│ Xpos[0]    │ 바디 0 월드 변환 (Position + Rotation)             │
│ Xpos[1]    │ 바디 1 월드 변환                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 일반적인 함정

**❌ 피해야 할 것:**
```cpp
// qpos와 qvel 차원 혼동
// Spherical joint: qpos=4 (쿼터니언), qvel=3 (각속도)
State.Qvel[3] = omega_w;  // 잘못! qvel은 3차원
```

**✅ 올바른 방법:**
```cpp
// FJointDesc의 QposStart/QvelStart 사용
const FJointDesc& Joint = Model.Joints[0];
State.Qpos[Joint.QposStart] = angle;
State.Qvel[Joint.QvelStart] = angular_velocity;
```

---

## 🔗 References

- `MuJoCoTypes.h:1-500` - 전체 타입 정의
- MuJoCo mjModel/mjData 구조 - 원본 설계 참조
- Featherstone notation - 공간 대수학 표기법
