---
title: "Field System"
date: "2025-12-07"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Physics"
tags: ["unreal", "Physics"]
engine_version: "** Unreal Engine 5.7"
---
# Field System

## 🧭 개요

**Field System**은 공간 기반으로 물리 효과를 적용하는 시스템입니다. 주로 Geometry Collection 파괴, 폭발 효과, 물리 필드 등에 사용됩니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Field** | 공간의 각 점에서 값을 반환하는 함수 |
| **Field Node** | Field를 정의하는 노드 (위치, 연산 등) |
| **Field System Actor** | Field를 월드에 배치하는 액터 |
| **Target** | Field가 영향을 미치는 대상 (GC, 파티클 등) |

---

## 🧱 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          Field System Architecture                               │
└─────────────────────────────────────────────────────────────────────────────────┘

  UWorld
     │
     └── AFieldSystemActor
              │
              ├── UFieldSystemComponent
              │        │
              │        └── Field Commands ──────────────────────┐
              │                                                  │
              │                                                  ↓
              │                                    ┌─────────────────────────┐
              │                                    │    Field Evaluation     │
              │                                    │                         │
              │                                    │  For each Target Point: │
              │                                    │    Value = Field(P)     │
              │                                    └───────────┬─────────────┘
              │                                                │
              │                                                ↓
              │                              ┌─────────────────────────────────┐
              │                              │          Targets               │
              │                              │                                 │
              │                              │  ┌───────────────────────────┐ │
              │                              │  │ Geometry Collection       │ │
              │                              │  │ - External Strain        │ │
              │                              │  │ - Sleep/Wake             │ │
              │                              │  │ - Disable/Enable         │ │
              │                              │  │ - Kill (Remove)          │ │
              │                              │  └───────────────────────────┘ │
              │                              │                                 │
              │                              │  ┌───────────────────────────┐ │
              │                              │  │ Rigid Body Particles      │ │
              │                              │  │ - Linear/Angular Force   │ │
              │                              │  │ - Linear/Angular Velocity│ │
              │                              │  │ - Torque                  │ │
              │                              │  └───────────────────────────┘ │
              │                              │                                 │
              │                              │  ┌───────────────────────────┐ │
              │                              │  │ Cloth Particles           │ │
              │                              │  │ - External Force         │ │
              │                              │  └───────────────────────────┘ │
              │                              │                                 │
              │                              └─────────────────────────────────┘
              │
              └── UFieldSystemMetaData
                       │
                       └── 타겟 필터링, 커스텀 데이터
```

---

## 📂 주요 소스 파일

| 파일 | 역할 |
|------|------|
| `Engine/Public/Field/FieldSystemActor.h` | Field System Actor |
| `Engine/Public/Field/FieldSystemComponent.h` | Field System Component |
| `Engine/Public/Field/FieldSystemNodes.h` | Field Node 정의 |
| `Engine/Public/Field/FieldSystemCoreAlgo.h` | Field 계산 알고리즘 |
| `Experimental/Chaos/Public/Field/FieldSystem.h` | Chaos Field 통합 |

---

## 🔷 Field Node 계층

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Field Node Hierarchy                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  UFieldNodeBase                                                                  │
│       │                                                                         │
│       ├── UFieldNodeInt (정수 출력)                                             │
│       │     ├── UUniformInteger         : 균일 정수값                           │
│       │     └── URadialIntMask          : 방사형 정수 마스크                    │
│       │                                                                         │
│       ├── UFieldNodeFloat (실수 출력)                                           │
│       │     ├── UUniformScalar          : 균일 스칼라값                         │
│       │     ├── URadialFalloff          : 방사형 감쇠                           │
│       │     ├── UPlaneFalloff           : 평면 감쇠                             │
│       │     ├── UBoxFalloff             : 박스 감쇠                             │
│       │     ├── UNoiseField             : 노이즈 필드                           │
│       │     └── UWaveScalar             : 파동 스칼라                           │
│       │                                                                         │
│       ├── UFieldNodeVector (벡터 출력)                                          │
│       │     ├── UUniformVector          : 균일 벡터값                           │
│       │     ├── URadialVector           : 방사형 벡터 (폭발)                    │
│       │     └── URandomVector           : 랜덤 벡터                             │
│       │                                                                         │
│       └── Operators (연산자)                                                    │
│             ├── USumScalar              : 스칼라 합                             │
│             ├── USumVector              : 벡터 합                               │
│             ├── UCullingField           : 컬링 (조건부 적용)                    │
│             ├── UReturnResultsTerminal  : 결과 반환                             │
│             └── UToInteger/Float/Vector : 타입 변환                             │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔶 주요 Field Types

### 1. Radial Falloff (방사형 감쇠)

```cpp
// 폭발 효과용 방사형 필드
UCLASS()
class URadialFalloff : public UFieldNodeFloat
{
    UPROPERTY()
    float Magnitude;      // 최대 강도

    UPROPERTY()
    float MinRange;       // 최대 강도 유지 범위

    UPROPERTY()
    float MaxRange;       // 영향 범위 최대

    UPROPERTY()
    float Default;        // 범위 밖 기본값

    UPROPERTY()
    EFieldFalloffType Falloff;  // 감쇠 타입
    // - Linear, Inverse, Squared, Logarithmic

    UPROPERTY()
    FVector Position;     // 중심 위치
};
```

```
             Magnitude
                 │
          ┌──────┴──────┐
          │             │
          │    Max      │
     ─────┴─────────────┴─────────────────
          │             │             │
          │<-MinRange->│<--Falloff-->│
          │             │             │
          └─────────────┴─────────────┘
                              MaxRange
```

### 2. Radial Vector (방사형 벡터)

```cpp
// 폭발 밀어내기 효과
UCLASS()
class URadialVector : public UFieldNodeVector
{
    UPROPERTY()
    float Magnitude;      // 힘의 크기

    UPROPERTY()
    FVector Position;     // 중심 위치
};

// 결과: (P - Position).GetSafeNormal() * Magnitude
```

### 3. Plane Falloff (평면 감쇠)

```cpp
// 평면으로부터의 거리 기반 감쇠
UCLASS()
class UPlaneFalloff : public UFieldNodeFloat
{
    UPROPERTY()
    float Magnitude;

    UPROPERTY()
    float MinRange;

    UPROPERTY()
    float MaxRange;

    UPROPERTY()
    float Default;

    UPROPERTY()
    float Distance;       // 평면 위치

    UPROPERTY()
    FVector Position;     // 평면상의 점

    UPROPERTY()
    FVector Normal;       // 평면 법선
};
```

### 4. Noise Field (노이즈)

```cpp
// Perlin 노이즈 기반 필드
UCLASS()
class UNoiseField : public UFieldNodeFloat
{
    UPROPERTY()
    float MinRange;       // 출력 최소값

    UPROPERTY()
    float MaxRange;       // 출력 최대값

    UPROPERTY()
    FTransform Transform; // 노이즈 공간 변환
};
```

---

## 🔷 Field 타겟 타입

### Geometry Collection 타겟

| 타겟 | 설명 | 값 타입 |
|------|------|---------|
| `ExternalClusterStrain` | 외부 응력 (파괴 트리거) | Float |
| `InternalClusterStrain` | 내부 응력 | Float |
| `DisableThreshold` | 비활성화 임계값 | Float |
| `SleepingThreshold` | Sleep 임계값 | Float |
| `ExternalForce` | 외부 힘 | Vector |
| `ExternalTorque` | 외부 토크 | Vector |
| `DynamicState` | 상태 변경 | Int (Sleeping/Disabled) |
| `CollisionGroup` | 충돌 그룹 | Int |
| `ActivateDisabled` | 비활성 조각 활성화 | Bool |

### Rigid Body 타겟

| 타겟 | 설명 | 값 타입 |
|------|------|---------|
| `LinearForce` | 선형 힘 | Vector |
| `LinearVelocity` | 선형 속도 | Vector |
| `AngularVelocity` | 각속도 | Vector |
| `AngularTorque` | 각 토크 | Vector |

---

## 🔶 사용 예시

### 1. 폭발 효과 (Blueprint)

```
AFieldSystemActor
    │
    └── UFieldSystemComponent
          │
          ├── RadialFalloff (Strain 강도)
          │     Position: ExplosionLocation
          │     Magnitude: 1000000.0
          │     MinRange: 100.0
          │     MaxRange: 500.0
          │     Falloff: Squared
          │
          ├── RadialVector (밀어내기 힘)
          │     Position: ExplosionLocation
          │     Magnitude: 500000.0
          │
          └── Target: ExternalClusterStrain + LinearForce
```

### 2. C++ 폭발 구현

```cpp
void AExplosionActor::TriggerExplosion()
{
    // Field System Component 가져오기 또는 생성
    UFieldSystemComponent* FieldComp = FindComponentByClass<UFieldSystemComponent>();

    // 방사형 필드 생성
    URadialFalloff* RadialFalloff = NewObject<URadialFalloff>(this);
    RadialFalloff->SetRadialFalloff(
        Magnitude,            // 강도
        0.0f,                 // MinRange
        ExplosionRadius,      // MaxRange
        0.0f,                 // Default
        EFieldFalloffType::Linear,
        GetActorLocation()    // 중심 위치
    );

    // 방사형 벡터 (밀어내기)
    URadialVector* RadialVector = NewObject<URadialVector>(this);
    RadialVector->SetRadialVector(
        ForceMagnitude,
        GetActorLocation()
    );

    // 타겟에 적용
    FieldComp->ApplyStrainField(
        false,                           // Enabled
        EFieldPhysicsType::Field_ExternalClusterStrain,
        nullptr,                         // Meta data
        RadialFalloff                    // Field
    );

    FieldComp->ApplyLinearForce(
        false,
        FVector::ZeroVector,             // Direction (사용 안 함)
        0.0f,                            // Magnitude (사용 안 함)
        RadialVector                     // Field로 대체
    );
}
```

### 3. Geometry Collection 파괴 트리거

```cpp
// 특정 위치에서 GC 파괴
void ApplyDestructionField(UGeometryCollectionComponent* GCComp, FVector Location, float Damage)
{
    // 외부 Strain 필드 생성
    FFieldSystemCommand Command;

    // Radial Falloff로 영향 범위 설정
    TUniquePtr<FRadialFalloff> RadialFalloff = MakeUnique<FRadialFalloff>(
        Damage,               // Magnitude
        0.0f,                 // MinRange
        200.0f,               // MaxRange
        0.0f,                 // Default
        EFieldFalloffType::Linear,
        Location              // Position
    );

    // Field 명령 구성
    Command.TargetAttribute = EFieldPhysicsType::Field_ExternalClusterStrain;
    Command.RootNode = RadialFalloff.Get();

    // GC에 적용
    GCComp->ApplyExternalStrain(Location, RadialFalloff.Get());
}
```

---

## 🔷 Field 연산자

### 필드 결합

```cpp
// 여러 필드 합성
USumScalar* SumField = NewObject<USumScalar>(this);
SumField->SetSumScalar(
    1.0f,           // MagnitudeA
    FieldA,         // Scalar Field A
    1.0f,           // MagnitudeB
    FieldB,         // Scalar Field B
    EFieldOperationType::Add  // 연산 타입
);

// 연산 타입:
// - Add: A + B
// - Subtract: A - B
// - Multiply: A * B
// - Divide: A / B
```

### 컬링 (조건부 적용)

```cpp
// 특정 조건에서만 필드 적용
UCullingField* CullingField = NewObject<UCullingField>(this);
CullingField->SetCullingField(
    CullingInput,           // 컬링 조건 필드
    InputField,             // 적용할 필드
    EFieldCullingOperationType::Inside  // Inside/Outside
);
```

---

## ⚡ 성능 고려사항

### 1. Field 평가 최적화

```cpp
// 나쁜 예: 매 프레임 Field 생성
void Tick(float DeltaTime)
{
    URadialFalloff* Field = NewObject<URadialFalloff>(this);  // 매 프레임 생성!
    FieldComp->ApplyStrainField(..., Field);
}

// 좋은 예: Field 재사용
UPROPERTY()
URadialFalloff* CachedField;

void Tick(float DeltaTime)
{
    if (!CachedField)
    {
        CachedField = NewObject<URadialFalloff>(this);
        CachedField->SetRadialFalloff(...);
    }
    CachedField->Position = GetActorLocation();  // 위치만 업데이트
    FieldComp->ApplyStrainField(..., CachedField);
}
```

### 2. 영향 범위 제한

```cpp
// MaxRange를 적절히 설정하여 불필요한 계산 방지
RadialFalloff->MaxRange = MinimumRequiredRange;

// 컬링 필드로 대상 제한
UCullingField* Culling = NewObject<UCullingField>();
Culling->SetCullingField(DistanceCullingField, MainField, Inside);
```

---

## 💡 Tips & 디버깅

### 시각화

```cpp
// 에디터에서 Field 시각화
// Project Settings > Physics > Enable Field Visualization

// 런타임 디버그
DrawDebugSphere(World, FieldLocation, MaxRange, 32, FColor::Yellow);
```

### 일반적인 문제

| 문제 | 원인 | 해결 |
|------|------|------|
| GC가 안 부서짐 | Strain 값이 낮음 | Magnitude 증가 |
| 영향 범위가 이상함 | MinRange/MaxRange 설정 오류 | 값 확인 |
| 성능 저하 | 과도한 Field 평가 | Field 캐싱, 범위 제한 |

---

## 🔗 관련 문서

- [Overview.md](Overview.md) - 물리 시스템 개요
- [Chaos_Destruction_And_Geometry_Collection_Deep_Dive.md](Chaos_Destruction_And_Geometry_Collection_Deep_Dive.md) - 파괴 시스템

---

> 이 문서는 Field System의 구조와 사용법을 설명합니다.