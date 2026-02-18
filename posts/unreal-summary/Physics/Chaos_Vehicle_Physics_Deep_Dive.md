---
title: "Chaos Vehicle Physics Deep Dive"
date: "2025-12-09"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Physics"
tags: ["unreal", "Physics"]
engine_version: "** Unreal Engine 5.7"
---
# Chaos Vehicle Physics Deep Dive

## 🧭 개요

**Chaos Vehicle Physics**는 UE5에서 차량 물리 시뮬레이션을 담당하는 시스템입니다. 모듈형 아키텍처를 통해 휠, 서스펜션, 엔진, 변속기 등을 개별적으로 구성할 수 있습니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Wheeled Vehicle** | 바퀴 기반 차량 시뮬레이션 |
| **Suspension** | 서스펜션 스프링/댐퍼 시스템 |
| **Tire Model** | 타이어 마찰/그립 모델 |
| **Transmission** | 변속기/구동계 시뮬레이션 |
| **SimModule** | 모듈형 시뮬레이션 컴포넌트 |

---

## 🧱 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       Chaos Vehicle Architecture                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

  UChaosWheeledVehicleMovementComponent
         │
         ├── FSimpleWheeledVehicle (물리 시뮬레이션 컨테이너)
         │        │
         │        ├── FSimpleWheelSim[] (휠 시뮬레이션)
         │        │        │
         │        │        ├── Angular Velocity
         │        │        ├── Spin Torque
         │        │        ├── Brake Torque
         │        │        └── Wheel Radius/Width
         │        │
         │        ├── FSimpleSuspensionSim[] (서스펜션)
         │        │        │
         │        │        ├── Spring Rate
         │        │        ├── Damping
         │        │        └── Travel
         │        │
         │        ├── FSimpleTireSim[] (타이어)
         │        │        │
         │        │        ├── Friction Coefficient
         │        │        ├── Slip Angle
         │        │        └── Load
         │        │
         │        └── FSimpleEngineSim (엔진)
         │                 │
         │                 ├── Torque Curve
         │                 ├── RPM
         │                 └── Throttle Response
         │
         └── Modular SimModule System
                  │
                  ├── ISimulationModuleBase
                  ├── FWheelModule
                  ├── FSuspensionModule
                  ├── FEngineModule
                  └── FTransmissionModule

```

---

## 📂 주요 소스 파일

| 파일 | 역할 |
|------|------|
| `ChaosVehiclesCore/Public/SimpleVehicle.h` | 차량 컨테이너 |
| `ChaosVehicles/Public/ChaosWheeledVehicleMovementComponent.h` | 이동 컴포넌트 |
| `ChaosVehiclesCore/Public/WheelSystem.h` | 휠 시스템 |
| `ChaosVehiclesCore/Public/SuspensionSystem.h` | 서스펜션 시스템 |
| `ChaosVehiclesCore/Public/SimModule/SimulationModuleBase.h` | 모듈 기반 클래스 |

---

## 🔷 Wheel System

### FSimpleWheelSim 구조

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            FSimpleWheelSim                                       │
│  (단일 휠 시뮬레이션)                                                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Geometry:                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  Radius          : float    // 휠 반지름 (cm)                           │   │
│  │  Width           : float    // 휠 너비 (cm)                             │   │
│  │  Mass            : float    // 휠 질량 (kg)                             │   │
│  │  MomentOfInertia : float    // 관성 모멘트                              │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  Dynamics:                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  AngularVelocity : float    // 각속도 (rad/s)                           │   │
│  │  SpinTorque      : float    // 구동 토크 (N*m)                          │   │
│  │  BrakeTorque     : float    // 브레이크 토크 (N*m)                      │   │
│  │  DriveTorque     : float    // 엔진 전달 토크                           │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  State:                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  bInContact      : bool     // 지면 접촉 여부                           │   │
│  │  WheelPosition   : FVector  // 휠 월드 위치                             │   │
│  │  SurfaceNormal   : FVector  // 접촉면 법선                              │   │
│  │  SurfaceMaterial : UPhysicalMaterial*  // 표면 재질                     │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 휠 설정 예시

```cpp
// UChaosVehicleWheel 설정
UCLASS()
class UChaosVehicleWheel : public UObject
{
    GENERATED_BODY()

public:
    // 휠 지오메트리
    UPROPERTY(EditAnywhere, Category = Wheel)
    float WheelRadius = 35.0f;  // cm

    UPROPERTY(EditAnywhere, Category = Wheel)
    float WheelWidth = 20.0f;   // cm

    UPROPERTY(EditAnywhere, Category = Wheel)
    float WheelMass = 20.0f;    // kg

    // 휠 위치
    UPROPERTY(EditAnywhere, Category = Wheel)
    FVector WheelOffset;

    // 조향
    UPROPERTY(EditAnywhere, Category = Wheel)
    float MaxSteerAngle = 50.0f;  // degrees

    UPROPERTY(EditAnywhere, Category = Wheel)
    bool bAffectedBySteering = true;

    // 구동
    UPROPERTY(EditAnywhere, Category = Wheel)
    bool bAffectedByEngine = true;

    UPROPERTY(EditAnywhere, Category = Wheel)
    bool bAffectedByBrake = true;

    UPROPERTY(EditAnywhere, Category = Wheel)
    bool bAffectedByHandbrake = false;
};
```

---

## 🔶 Suspension System

### FSimpleSuspensionSim 구조

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          Suspension Diagram                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│           ┌───────────────────────────────────────┐                             │
│           │         Vehicle Body                  │                             │
│           └─────────────────┬─────────────────────┘                             │
│                             │                                                   │
│                             │ ← Suspension Mount Point                          │
│                             │                                                   │
│                      ┌──────┴──────┐                                            │
│                      │   Spring    │  ← RestLength                              │
│                      │   ⟿⟿⟿⟿⟿⟿   │     SpringRate (N/m)                       │
│                      │   ⟿⟿⟿⟿⟿⟿   │                                            │
│                      └──────┬──────┘                                            │
│                             │                                                   │
│                      ┌──────┴──────┐                                            │
│                      │   Damper    │  ← DampingRate (N*s/m)                     │
│                      │   ║═══║    │     CompressionDamping                     │
│                      │   ║═══║    │     ReboundDamping                         │
│                      └──────┬──────┘                                            │
│                             │                                                   │
│                        ┌────┴────┐                                              │
│                        │  Wheel  │                                              │
│                        │   (●)   │                                              │
│                        └─────────┘                                              │
│                                                                                  │
│  Travel Range:                                                                   │
│    MaxRaise (Rebound) ↑                                                         │
│    ─────────────────── RestLength                                               │
│    MaxDrop (Bump)     ↓                                                         │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 서스펜션 설정

```cpp
// 서스펜션 파라미터
struct FSuspensionSettings
{
    // 스프링
    float SpringRate = 25000.0f;        // N/m (강도)
    float SpringPreload = 0.0f;         // 초기 압축 (N)
    float RestLength = 50.0f;           // 정지 길이 (cm)

    // 트래블
    float MaxRaise = 10.0f;             // 최대 확장 (리바운드) (cm)
    float MaxDrop = 10.0f;              // 최대 압축 (범프) (cm)

    // 댐핑
    float DampingRatio = 0.5f;          // 감쇠비 (0-1, 1=임계)
    float CompressionDamping = 2000.0f; // 압축 댐핑 (N*s/m)
    float ReboundDamping = 2500.0f;     // 리바운드 댐핑 (N*s/m)

    // 축
    FVector SuspensionAxis = FVector(0, 0, -1);  // 서스펜션 방향
    FVector SuspensionForceOffset;               // 힘 적용 오프셋
};
```

---

## 🔷 Tire System

### 타이어 물리 모델

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Tire Force Model                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Lateral Force (옆힘) - Slip Angle 기반:                                        │
│                                                                                  │
│     Force │                                                                      │
│       ↑   │         ╭──────────────                                             │
│       │   │        ╱                                                            │
│       │   │       ╱                                                             │
│       │   │      ╱                                                              │
│       │   │     ╱   ← Peak Grip                                                 │
│       │   │    ╱                                                                │
│       │   │   ╱                                                                 │
│       └───┴──╱─────────────────────→ Slip Angle                                │
│           0°                    90°                                             │
│                                                                                  │
│  Longitudinal Force (앞힘) - Slip Ratio 기반:                                   │
│                                                                                  │
│     Force │                                                                      │
│       ↑   │      ╭─────────────────                                             │
│       │   │     ╱                                                               │
│       │   │    ╱   ← Peak Traction                                              │
│       │   │   ╱                                                                 │
│       └───┴──╱──────────────────────→ Slip Ratio                               │
│           0%                     100%                                           │
│                                                                                  │
│  Friction Circle (마찰 원):                                                     │
│                                                                                  │
│              Lateral                                                             │
│                 ↑                                                               │
│            ╭────┼────╮                                                          │
│          ╱      │      ╲                                                        │
│         │       │       │ ← Max Total Grip                                      │
│  ←──────┼───────┼───────┼──────→ Longitudinal                                  │
│         │       │       │                                                       │
│          ╲      │      ╱                                                        │
│            ╰────┼────╯                                                          │
│                 ↓                                                               │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 타이어 설정

```cpp
// 타이어 파라미터
struct FTireSettings
{
    // 마찰 계수
    float FrictionCoefficient = 1.0f;      // 기본 마찰
    float LateralFrictionMax = 1.0f;       // 최대 옆 마찰
    float LongitudinalFrictionMax = 1.0f;  // 최대 앞 마찰

    // 슬립
    float SlipThreshold = 0.1f;            // 슬립 시작 임계값
    float SkidThreshold = 0.5f;            // 스키드 임계값

    // 커브 파라미터
    FRuntimeFloatCurve LateralSlipGraph;   // Slip Angle → Force
    FRuntimeFloatCurve LongSlipGraph;      // Slip Ratio → Force

    // 로드 영향
    float CorneringStiffness = 1.0f;       // 코너링 강성
    float LoadSensitivity = 0.5f;          // 하중 민감도
};
```

---

## 🔶 Engine & Transmission

### 엔진 시스템

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Engine System                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Torque Curve:                                                                   │
│                                                                                  │
│   Torque │                                                                       │
│   (N*m)  │         ╭────────╮                                                   │
│     ↑    │        ╱          ╲                                                  │
│     400 ─┼───────╱            ╲                                                 │
│     300 ─┼──────╱              ╲                                                │
│     200 ─┼─────╱                ╲                                               │
│     100 ─┼────╱                  ╲                                              │
│          └────┴────┴────┴────┴────┴────→ RPM                                   │
│              1k   2k   3k   4k   5k   6k                                        │
│                                                                                  │
│  Parameters:                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  MaxTorque        = 500 N*m     // 최대 토크                            │   │
│  │  MaxRPM           = 7000        // 최대 RPM                             │   │
│  │  IdleRPM          = 1000        // 공회전 RPM                           │   │
│  │  EngineRevUpRate  = 5000        // RPM 상승 속도                        │   │
│  │  EngineRevDownRate= 2000        // RPM 하강 속도                        │   │
│  │  DifferentialRatio= 3.5         // 디퍼렌셜 기어비                      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 변속기 설정

```cpp
// 변속기 파라미터
struct FTransmissionSettings
{
    // 기어비
    TArray<float> GearRatios = {-3.0f, 0.0f, 3.0f, 2.0f, 1.5f, 1.2f, 1.0f};
    // Gear: Reverse, Neutral, 1st, 2nd, 3rd, 4th, 5th

    // 파이널 드라이브
    float FinalRatio = 3.5f;

    // 자동 변속
    bool bAutomatic = true;
    float UpShiftRPM = 5500.0f;      // 업시프트 RPM
    float DownShiftRPM = 2500.0f;    // 다운시프트 RPM
    float ShiftTime = 0.3f;          // 변속 시간 (초)

    // 클러치
    float ClutchStrength = 10.0f;    // 클러치 강도
    float ClutchSlip = 0.0f;         // 클러치 슬립률
};
```

---

## 🔷 SimModule Architecture

### 모듈형 시스템

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         SimModule Hierarchy                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ISimulationModuleBase (인터페이스)                                             │
│       │                                                                         │
│       ├── FWheelModule                                                          │
│       │     └── 휠 토크, 회전, 접지 처리                                       │
│       │                                                                         │
│       ├── FSuspensionModule                                                     │
│       │     └── 서스펜션 힘, 트래블 계산                                       │
│       │                                                                         │
│       ├── FTireModule                                                           │
│       │     └── 타이어 힘, 슬립 계산                                           │
│       │                                                                         │
│       ├── FEngineModule                                                         │
│       │     └── 엔진 토크, RPM 계산                                            │
│       │                                                                         │
│       ├── FTransmissionModule                                                   │
│       │     └── 기어비, 클러치 처리                                            │
│       │                                                                         │
│       ├── FSteeringModule                                                       │
│       │     └── 조향 각도 계산                                                 │
│       │                                                                         │
│       └── FAerodynamicsModule                                                   │
│             └── 공기저항, 다운포스                                              │
│                                                                                  │
│  각 모듈은 독립적으로:                                                          │
│  - Simulate(DeltaTime) 호출                                                     │
│  - 다른 모듈과 데이터 교환                                                      │
│  - 커스텀 구현 가능                                                             │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 💡 실전 사용 예시

### 1. 기본 차량 설정

```cpp
// 차량 Pawn
UCLASS()
class AMyVehicle : public APawn
{
    GENERATED_BODY()

public:
    AMyVehicle();

protected:
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly)
    UChaosWheeledVehicleMovementComponent* VehicleMovement;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly)
    USkeletalMeshComponent* VehicleMesh;
};

// 구현
AMyVehicle::AMyVehicle()
{
    VehicleMesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("VehicleMesh"));
    SetRootComponent(VehicleMesh);

    VehicleMovement = CreateDefaultSubobject<UChaosWheeledVehicleMovementComponent>(TEXT("VehicleMovement"));
    VehicleMovement->SetIsReplicated(true);

    // 휠 설정
    VehicleMovement->WheelSetups.SetNum(4);

    // 전륜 좌
    VehicleMovement->WheelSetups[0].WheelClass = UFrontWheel::StaticClass();
    VehicleMovement->WheelSetups[0].BoneName = TEXT("Wheel_FL");

    // 전륜 우
    VehicleMovement->WheelSetups[1].WheelClass = UFrontWheel::StaticClass();
    VehicleMovement->WheelSetups[1].BoneName = TEXT("Wheel_FR");

    // 후륜 좌
    VehicleMovement->WheelSetups[2].WheelClass = URearWheel::StaticClass();
    VehicleMovement->WheelSetups[2].BoneName = TEXT("Wheel_RL");

    // 후륜 우
    VehicleMovement->WheelSetups[3].WheelClass = URearWheel::StaticClass();
    VehicleMovement->WheelSetups[3].BoneName = TEXT("Wheel_RR");
}
```

### 2. 입력 처리

```cpp
void AMyVehicle::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);

    PlayerInputComponent->BindAxis("Throttle", this, &AMyVehicle::ApplyThrottle);
    PlayerInputComponent->BindAxis("Steer", this, &AMyVehicle::ApplySteering);
    PlayerInputComponent->BindAxis("Brake", this, &AMyVehicle::ApplyBrake);
    PlayerInputComponent->BindAction("Handbrake", IE_Pressed, this, &AMyVehicle::OnHandbrakePressed);
    PlayerInputComponent->BindAction("Handbrake", IE_Released, this, &AMyVehicle::OnHandbrakeReleased);
}

void AMyVehicle::ApplyThrottle(float Value)
{
    VehicleMovement->SetThrottleInput(Value);
}

void AMyVehicle::ApplySteering(float Value)
{
    VehicleMovement->SetSteeringInput(Value);
}

void AMyVehicle::ApplyBrake(float Value)
{
    VehicleMovement->SetBrakeInput(Value);
}

void AMyVehicle::OnHandbrakePressed()
{
    VehicleMovement->SetHandbrakeInput(true);
}

void AMyVehicle::OnHandbrakeReleased()
{
    VehicleMovement->SetHandbrakeInput(false);
}
```

### 3. 런타임 튜닝

```cpp
void AMyVehicle::TuneVehicle()
{
    // 서스펜션 조정
    for (int32 i = 0; i < VehicleMovement->Wheels.Num(); ++i)
    {
        if (UChaosVehicleWheel* Wheel = VehicleMovement->Wheels[i])
        {
            // 서스펜션 강화
            Wheel->SuspensionSpringRate = 30000.0f;
            Wheel->SuspensionDampingRatio = 0.7f;

            // 타이어 그립 증가
            Wheel->FrictionForceMultiplier = 1.5f;
        }
    }

    // 엔진 파워 업
    VehicleMovement->EngineSetup.MaxTorque = 700.0f;

    // 변경 적용
    VehicleMovement->RecreatePhysicsState();
}
```

---

## ⚙️ 성능 최적화

### 1. LOD 및 시뮬레이션 품질

```cpp
// 거리 기반 시뮬레이션 품질
void AMyVehicle::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    float DistanceToPlayer = GetDistanceToPlayer();

    if (DistanceToPlayer > 5000.0f)
    {
        // 먼 거리: 간소화된 물리
        VehicleMovement->SetSimulationEnabled(false);
        // 단순 보간 이동
    }
    else
    {
        VehicleMovement->SetSimulationEnabled(true);
    }
}
```

### 2. 관련 CVars

```cpp
// 차량 물리 디버그
p.Vehicle.ShowDebug = 1                    // 디버그 표시
p.Vehicle.ShowForces = 1                   // 힘 시각화
p.Vehicle.DrawWheelContacts = 1            // 휠 접촉점

// 시뮬레이션 품질
p.Vehicle.SuspensionIterations = 8         // 서스펜션 반복
p.Vehicle.TireIterations = 4               // 타이어 반복
```

---

## 🔧 일반적인 문제 및 해결

| 문제 | 원인 | 해결 |
|------|------|------|
| **차가 튀어오름** | 서스펜션 너무 강함 | SpringRate 감소, Damping 증가 |
| **미끄러짐 과다** | 타이어 그립 부족 | FrictionCoefficient 증가 |
| **가속 느림** | 토크/기어비 문제 | 토크 커브, 기어비 조정 |
| **조향 과민** | MaxSteerAngle 과다 | 값 감소, 조향 곡선 조정 |
| **롤오버** | 무게중심 높음 | COM 낮추기, 안티롤바 추가 |

---

## 🔗 관련 문서

- [Overview.md](Overview.md) - 물리 시스템 개요
- [Chaos_Constraint_Types_Deep_Dive.md](Chaos_Constraint_Types_Deep_Dive.md) - Suspension Constraint
- [Chaos_Physics_Materials.md](Chaos_Physics_Materials.md) - 표면 마찰

---

> 이 문서는 Chaos Vehicle Physics 시스템을 설명합니다.