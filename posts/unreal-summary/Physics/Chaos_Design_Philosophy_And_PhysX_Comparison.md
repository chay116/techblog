---
title: "Chaos Design Philosophy & PhysX Comparison"
date: "2025-12-10"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Physics"
tags: ["unreal", "Physics"]
engine_version: "** Unreal Engine 5.7"
---
# Chaos Design Philosophy & PhysX Comparison

## 🧭 개요

**Chaos Physics**는 UE4.23에서 도입된 Epic Games의 자체 물리 엔진으로, NVIDIA PhysX를 대체합니다. 단순한 교체가 아닌 **완전히 재설계된 현대적 물리 시스템**으로, Data-Oriented Design, Island 기반 병렬화, 통합 물리 프레임워크를 핵심으로 합니다.

### 핵심 설계 원칙

| 원칙 | 설명 |
|------|------|
| **Performance First** | 데이터 지향 설계, SIMD 최적화 |
| **Parallelization Native** | Island 기반 독립적 병렬 처리 |
| **Unified Framework** | Rigid, Soft, Cloth, Destruction 통합 |
| **Open & Flexible** | 완전 오픈소스, 무제한 커스터마이징 |

---

## 🧱 PhysX 도입 배경 및 한계

### PhysX의 역사

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          PhysX 역사                                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  2004: Ageia Technologies 개발                                                  │
│    ↓                                                                            │
│  2008: NVIDIA 인수                                                              │
│    ↓                                                                            │
│  UE3 ~ UE4.22: Unreal Engine 기본 물리 엔진                                    │
│    ↓                                                                            │
│  UE4.23+: Chaos로 점진적 대체 시작                                             │
│    ↓                                                                            │
│  UE5+: Chaos 기본, PhysX 레거시 지원                                           │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### PhysX의 한계점

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          PhysX 한계점                                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. 제한된 확장성                                                               │
│     ├─ 대규모 파괴 시뮬레이션 성능 저하                                        │
│     ├─ 수백 개 이상의 동적 물체에서 병목                                       │
│     └─ 멀티코어 활용 제한적                                                    │
│                                                                                  │
│  2. 분리된 시스템                                                               │
│     ├─ Rigid Body, Cloth, Destruction 별도 관리                                │
│     ├─ 시스템 간 상호작용 복잡                                                 │
│     └─ 통합 최적화 어려움                                                      │
│                                                                                  │
│  3. 커스터마이징 제한                                                           │
│     ├─ 내부 로직 수정 불가 (바이너리)                                          │
│     ├─ 특수 물리 효과 구현 제약                                                │
│     └─ 디버깅 어려움                                                           │
│                                                                                  │
│  4. 라이센싱 이슈                                                               │
│     ├─ NVIDIA Gameworks 라이센스 복잡성                                        │
│     ├─ 플랫폼별 제약                                                           │
│     └─ Epic의 엔진 방향성과 충돌                                               │
│                                                                                  │
│  5. 노후화된 아키텍처                                                           │
│     ├─ 2000년대 초반 설계                                                      │
│     ├─ 현대 하드웨어 최적화 부족                                               │
│     └─ 메모리 레이아웃 비효율                                                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔷 Chaos의 핵심 설계 철학

### 1. Data-Oriented Design (DOD)

#### 개념

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Object-Oriented vs Data-Oriented                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PhysX (Object-Oriented / Array of Structures):                                 │
│                                                                                  │
│    Actor 0: [Pos0, Vel0, Mass0, Shape0, ...]                                   │
│        ↓ (메모리 점프)                                                          │
│    Actor 1: [Pos1, Vel1, Mass1, Shape1, ...]                                   │
│        ↓ (메모리 점프)                                                          │
│    Actor 2: [Pos2, Vel2, Mass2, Shape2, ...]                                   │
│                                                                                  │
│    문제: 캐시 미스 빈번, SIMD 활용 어려움                                       │
│                                                                                  │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                  │
│  Chaos (Data-Oriented / Structure of Arrays):                                   │
│                                                                                  │
│    Positions:  [Pos0, Pos1, Pos2, Pos3, Pos4, Pos5, ...]  ← 연속 메모리        │
│    Velocities: [Vel0, Vel1, Vel2, Vel3, Vel4, Vel5, ...]  ← 연속 메모리        │
│    Masses:     [M0,   M1,   M2,   M3,   M4,   M5,   ...]  ← 연속 메모리        │
│    Shapes:     [S0,   S1,   S2,   S3,   S4,   S5,   ...]                        │
│                                                                                  │
│    장점: 캐시 효율 극대화, SIMD 자연스러운 적용                                 │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 소스 코드 예시

**📂 위치:** `Engine/Source/Runtime/Experimental/Chaos/Public/Chaos/PBDRigidsSOAs.h`

```cpp
// Chaos의 Structure of Arrays 레이아웃
class FPBDRigidsSOAs : public FParticlesType
{
public:
    // 같은 속성끼리 연속 배열로 저장
    TParticleData<FVec3> XArray;          // 위치 배열
    TParticleData<FVec3> VArray;          // 속도 배열
    TParticleData<FRotation3> RArray;     // 회전 배열
    TParticleData<FVec3> WArray;          // 각속도 배열
    TParticleData<FReal> MArray;          // 질량 배열
    TParticleData<FReal> InvMArray;       // 역질량 배열
};
```

#### 성능 영향

| 측면 | PhysX (AOS) | Chaos (SOA) |
|------|-------------|-------------|
| **캐시 히트율** | ~40% | ~90% |
| **메모리 대역폭** | 낭비 많음 | 최적화됨 |
| **SIMD 활용** | 제한적 | 자연스러움 |
| **처리량** | 기준 | 2-4배 향상 |

---

### 2. Island 기반 병렬화

#### 개념

**Island**는 물리적으로 상호작용하는 물체들의 집합입니다. 서로 다른 Island는 독립적으로 시뮬레이션 가능합니다.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          Island 기반 병렬화                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  World 전체:                                                                    │
│                                                                                  │
│    ┌────────────────┐   ┌────────────────┐   ┌────────────────┐               │
│    │   Island 0     │   │   Island 1     │   │   Island 2     │               │
│    │  ┌──┐  ┌──┐   │   │  ┌──┐  ┌──┐   │   │  ┌──┐         │               │
│    │  │A ├──┤B │   │   │  │D │──│E │   │   │  │G │         │               │
│    │  └──┘  └┬─┘   │   │  └──┘  └┬─┘   │   │  └┬─┘         │               │
│    │         │     │   │         │     │   │   │           │               │
│    │       ┌─┴─┐   │   │       ┌─┴─┐   │   │  ┌┴──┐ ┌──┐  │               │
│    │       │ C │   │   │       │ F │   │   │  │ H ├─┤ I │  │               │
│    │       └───┘   │   │       └───┘   │   │  └───┘ └───┘  │               │
│    └────────────────┘   └────────────────┘   └────────────────┘               │
│           │                    │                    │                          │
│           ↓                    ↓                    ↓                          │
│      Thread 0             Thread 1             Thread 2                        │
│           │                    │                    │                          │
│           └────────────────────┼────────────────────┘                          │
│                                ↓                                               │
│                        동시 병렬 처리!                                         │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Island Manager

**📂 위치:** `Engine/Source/Runtime/Experimental/Chaos/Public/Chaos/Island/IslandManager.h`

```cpp
class FPBDIslandManager
{
public:
    // Island 관리
    void AddParticle(FGeometryParticleHandle* Particle);
    void RemoveParticle(FGeometryParticleHandle* Particle);

    // Island 병합 (충돌 발생 시)
    void MergeIslands(int32 IslandA, int32 IslandB);

    // Island 분리 (접촉 해제 시)
    void SplitIsland(int32 IslandId);

    // 병렬 처리
    void SolveIslandsParallel(FReal Dt);

private:
    TArray<FPBDIsland*> Islands;
    TMap<FGeometryParticleHandle*, int32> ParticleToIsland;
};
```

#### Sleep 시스템과의 연계

```
Island 상태 전이:

  [Active]  ←─────────────────────────────────────┐
      │                                           │
      │ 속도 < Threshold (N 프레임 연속)         │ 외부 충격 또는
      ↓                                           │ 다른 Active 접촉
  [Sleeping] ─────────────────────────────────────┘

  Sleeping Island = CPU 사용량 0
  → 수천 개 물체도 대부분 Sleep → 성능 유지
```

---

### 3. Position Based Dynamics (PBD)

#### PBD vs Impulse-Based (PhysX)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      솔버 방식 비교: PGS vs PBD                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PhysX (Projected Gauss-Seidel / Impulse-Based):                               │
│                                                                                  │
│    1. 힘/토크 적용                                                             │
│    2. 속도 계산 (F = ma → v = v + a*dt)                                        │
│    3. 제약 해결 (임펄스 기반)                                                  │
│       └─ 속도 수정 → 위치는 간접적                                             │
│    4. 위치 업데이트 (x = x + v*dt)                                             │
│                                                                                  │
│    특징: 물리적으로 정확, 파라미터 민감                                        │
│                                                                                  │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                  │
│  Chaos (Position Based Dynamics):                                               │
│                                                                                  │
│    1. 속도 적분 (예측)                                                         │
│       V_new = V_old + (F/M + g) * dt                                           │
│                                                                                  │
│    2. 위치 예측                                                                │
│       X_predicted = X + V_new * dt                                             │
│                                                                                  │
│    3. 제약 해결 (위치 기반) - N회 반복                                         │
│       for each constraint:                                                      │
│           ΔX = SolveConstraint(X_predicted)                                    │
│           X_predicted += ΔX                                                    │
│                                                                                  │
│    4. 속도 역계산                                                              │
│       V_new = (X_predicted - X) / dt                                           │
│                                                                                  │
│    5. 위치 확정                                                                │
│       X = X_predicted                                                          │
│                                                                                  │
│    특징: 안정적, 시각적으로 자연스러움, 파라미터 덜 민감                       │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### PBD 장점

| 특성 | 설명 |
|------|------|
| **안정성** | 큰 타임스텝에서도 안정 |
| **직관성** | 위치 직접 수정 → 결과 예측 용이 |
| **통합성** | Rigid, Soft, Cloth 동일 프레임워크 |
| **조절성** | Stiffness로 강도 직접 제어 |

---

### 4. ISPC (Intel SPMD Program Compiler) 활용

#### 개념

ISPC는 SIMD 코드를 자동 생성하는 컴파일러입니다.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          ISPC 활용                                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  일반 C++ 코드:                                                                 │
│                                                                                  │
│    for (int i = 0; i < N; ++i)                                                 │
│    {                                                                            │
│        Positions[i] += Velocities[i] * dt;  // 순차 처리                       │
│    }                                                                            │
│                                                                                  │
│    처리량: 1 입자/사이클                                                        │
│                                                                                  │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                  │
│  ISPC 코드:                                                                     │
│                                                                                  │
│    export void IntegratePositions(                                             │
│        uniform float* Positions,                                               │
│        uniform float* Velocities,                                              │
│        uniform float dt,                                                       │
│        uniform int N)                                                          │
│    {                                                                            │
│        foreach (i = 0 ... N)                                                   │
│        {                                                                        │
│            Positions[i] += Velocities[i] * dt;  // SIMD 병렬 처리             │
│        }                                                                        │
│    }                                                                            │
│                                                                                  │
│    처리량: 4-8 입자/사이클 (AVX2/AVX512)                                       │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Chaos에서의 ISPC 활용 영역

**📂 위치:** 다양한 Chaos 헤더 파일들

```cpp
#if INTEL_ISPC
// ISPC 데이터 레이아웃 검증
static_assert(sizeof(FImplicitSphere) == ExpectedSize, "ISPC layout mismatch");
#endif
```

- **충돌 검출**: GJK, EPA 알고리즘
- **제약 해결**: Contact/Joint Solver
- **적분**: 위치/속도 업데이트
- **Broad Phase**: AABB 테스트

---

### 5. Unified Physics Framework

#### 통합 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      Unified Chaos Framework                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│                        ┌─────────────────────────┐                              │
│                        │   FPBDRigidsSolver      │                              │
│                        │   (통합 솔버)           │                              │
│                        └───────────┬─────────────┘                              │
│                                    │                                            │
│          ┌─────────────┬───────────┼───────────┬─────────────┐                 │
│          │             │           │           │             │                 │
│          ↓             ↓           ↓           ↓             ↓                 │
│    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│    │  Rigid   │  │   Soft   │  │  Cloth   │  │Destruction│  │ Vehicle  │      │
│    │  Body    │  │   Body   │  │          │  │ (GC)      │  │          │      │
│    └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
│                                                                                  │
│    모든 물리 타입이:                                                           │
│      - 동일한 Island 시스템 사용                                               │
│      - 동일한 제약 해결기 사용                                                 │
│      - 상호 작용 가능                                                          │
│                                                                                  │
│    PhysX에서는:                                                                │
│      - Rigid Body ≠ Cloth (별도 SDK)                                          │
│      - Destruction = APEX (또 다른 SDK)                                        │
│      - 통합 최적화 불가                                                        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔶 PhysX vs Chaos 상세 비교

### 아키텍처 비교

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      아키텍처 비교                                               │
├──────────────────────┬────────────────────────┬─────────────────────────────────┤
│        항목          │        PhysX           │          Chaos                  │
├──────────────────────┼────────────────────────┼─────────────────────────────────┤
│ 솔버 알고리즘        │ PGS (임펄스 기반)      │ PBD (위치 기반)                 │
│ 메모리 레이아웃      │ AOS (객체별)           │ SOA (속성별)                    │
│ 병렬화 단위          │ Task (제한적)          │ Island (독립적)                 │
│ SIMD 최적화          │ 수동/제한적            │ ISPC 자동 생성                  │
│ 제약 해결            │ Gauss-Seidel (순차)    │ Gauss-Seidel + 병렬 Island     │
│ 통합 수준            │ 분리 (Rigid/Cloth/...) │ 완전 통합                       │
│ 소스 접근            │ 바이너리               │ 전체 오픈소스                   │
│ 파괴 시스템          │ APEX (별도)            │ Geometry Collection (내장)     │
├──────────────────────┴────────────────────────┴─────────────────────────────────┤
│                                                                                  │
│  결론: Chaos = 현대적 재설계, 확장성/성능/유연성 모두 우위                      │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 성능 비교

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          성능 메트릭 비교                                        │
├──────────────────────────────┬─────────────────┬────────────────────────────────┤
│           메트릭             │     PhysX       │           Chaos                │
├──────────────────────────────┼─────────────────┼────────────────────────────────┤
│ 최대 Rigid Body              │    ~1,000       │         10,000+                │
│ 최대 제약 조건               │   ~10,000       │        100,000+                │
│ 파괴 조각                    │     ~200        │         10,000+                │
│ Cloth 입자                   │    ~5,000       │         50,000+                │
│ 멀티코어 활용                │    ~60%         │          ~95%                  │
│ 메모리 효율                  │    기준         │         30% 개선               │
├──────────────────────────────┴─────────────────┴────────────────────────────────┤
│                                                                                  │
│  * 수치는 동일 하드웨어 기준 상대 비교                                          │
│  * 실제 성능은 씬 구성에 따라 다름                                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 기능 비교

| 기능 | PhysX | Chaos |
|------|-------|-------|
| **Rigid Body** | ✅ | ✅ |
| **Joints** | ✅ | ✅ |
| **Cloth** | ✅ (NvCloth) | ✅ (통합) |
| **Soft Body** | ❌ | ✅ |
| **Destruction** | ⚠️ (APEX) | ✅ (GC) |
| **Vehicle** | ✅ | ✅ |
| **Async Physics** | ⚠️ | ✅ |
| **Deterministic** | ⚠️ | ✅ |
| **Network Prediction** | ⚠️ | ✅ |

---

## 🔷 대규모 파괴 시뮬레이션

### Geometry Collection

Chaos의 핵심 기능 중 하나는 **대규모 파괴 시뮬레이션**입니다.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      Geometry Collection 파괴 시스템                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  파괴 전:                                                                       │
│                                                                                  │
│    ┌─────────────────────────────────┐                                         │
│    │                                 │                                         │
│    │      하나의 Rigid Body          │  ← 1개 Island                           │
│    │      (건물, 기둥 등)            │                                         │
│    │                                 │                                         │
│    └─────────────────────────────────┘                                         │
│                      │                                                          │
│                      │ 충격 (Impact)                                           │
│                      ↓                                                          │
│  파괴 후:                                                                       │
│                                                                                  │
│    ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                                   │
│    │ GC0 │ │ GC1 │ │ GC2 │ │ GC3 │ │ GC4 │  ...                              │
│    └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘                                   │
│       │       │       │       │       │                                        │
│       └───────┴───────┴───────┴───────┘                                        │
│                       │                                                          │
│                       ↓                                                          │
│           여러 Island로 자동 분리                                               │
│           → 병렬 처리 가능!                                                     │
│                                                                                  │
│  PhysX 문제:                                                                    │
│    - 수백 개 조각 → 성능 급락                                                  │
│    - 단일 시뮬레이션 → 병렬화 어려움                                           │
│                                                                                  │
│  Chaos 해결:                                                                    │
│    - 10,000개 이상 조각도 안정                                                  │
│    - Island 자동 분리 → 병렬 처리                                              │
│    - Clustering으로 계층적 분해                                                 │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**📂 위치:** `Engine/Source/Runtime/Experimental/Chaos/Public/Chaos/PBDRigidClustering.h`

---

## 🔶 커스터마이징 용이성

### 확장 포인트

```cpp
// 커스텀 제약 조건 구현 예시
class FMyCustomConstraint : public FPBDConstraintContainer
{
public:
    // 제약 해결 로직 오버라이드
    virtual void Apply(FReal Dt, const TArray<FPBDIsland*>& Islands) override
    {
        for (FPBDIsland* Island : Islands)
        {
            for (auto& Particle : Island->GetParticles())
            {
                // 커스텀 제약 적용
                ApplyMyConstraint(Particle, Dt);
            }
        }
    }

private:
    void ApplyMyConstraint(FGeometryParticleHandle* Particle, FReal Dt);
};

// 솔버에 등록
Solver->AddConstraintContainer(&MyConstraint);
```

### PhysX vs Chaos 커스터마이징 비교

| 작업 | PhysX | Chaos |
|------|-------|-------|
| **커스텀 제약 추가** | 불가능 (바이너리) | 가능 (소스 수정) |
| **솔버 파라미터 조정** | 제한적 API | 직접 수정 가능 |
| **새로운 물리 타입** | 불가능 | 프레임워크 확장 가능 |
| **디버깅** | 블랙박스 | 전체 소스 디버깅 |
| **성능 프로파일링** | 제한적 | Unreal Insights 통합 |

---

## 💡 마이그레이션 가이드

### PhysX → Chaos 전환 시 고려사항

| 영역 | 변경 사항 |
|------|----------|
| **API** | `PxRigidDynamic` → `FPBDRigidParticle` |
| **제약** | `PxJoint` → `FPBDJointConstraint` |
| **이벤트** | PhysX Callback → Chaos Delegates |
| **쿼리** | PhysX Scene Query → Chaos SQ |
| **파라미터** | 일부 튜닝 필요 (PBD 특성 고려) |

### 주의사항

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          마이그레이션 주의사항                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. 물리 동작 차이                                                              │
│     - PBD는 Impulse보다 "부드럽게" 느껴질 수 있음                              │
│     - Stiffness/Damping 재조정 필요                                            │
│                                                                                  │
│  2. 성능 특성 변화                                                              │
│     - 대규모 씬: Chaos 우위                                                    │
│     - 소규모 씬: 유사하거나 PhysX 약간 우위 가능                               │
│                                                                                  │
│  3. 디버깅 방식 변화                                                            │
│     - PhysX Visual Debugger → Unreal Insights / CVars                          │
│                                                                                  │
│  4. 네트워크 고려                                                               │
│     - Chaos는 Deterministic 지원 → 네트워크 예측 용이                          │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔗 관련 문서

- [Overview.md](Overview.md) - 물리 시스템 개요
- [Chaos_Complete_Architecture.md](Chaos_Complete_Architecture.md) - Chaos 전체 구조
- [Chaos_Threading_And_Synchronization.md](Chaos_Threading_And_Synchronization.md) - 스레딩 상세
- [Chaos_Island_And_Sleep_System.md](Chaos_Island_And_Sleep_System.md) - Island/Sleep 시스템

---

## 📚 참고 자료

### 소스 파일

| 파일 | 역할 |
|------|------|
| `Chaos/Public/Chaos/PBDRigidsSolver.h` | 메인 솔버 |
| `Chaos/Public/Chaos/PBDRigidsSOAs.h` | SOA 데이터 구조 |
| `Chaos/Public/Chaos/Island/IslandManager.h` | Island 관리 |
| `Chaos/Public/Chaos/Evolution/PBDRigidsEvolution.h` | 물리 진화 |

### 외부 자료

- GDC 2019: "Chaos Physics: A New Physics Engine for Games" - Epic Games
- UE5 Documentation: Physics System Overview

---

## 요약: Chaos의 3대 설계 원칙

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      Chaos 설계 철학 요약                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ╔═══════════════════════════════════════════════════════════════════════════╗ │
│  ║  1. PERFORMANCE FIRST                                                     ║ │
│  ║     └─ Data-Oriented Design (SOA)                                        ║ │
│  ║     └─ ISPC 자동 SIMD 최적화                                             ║ │
│  ║     └─ 캐시 친화적 메모리 레이아웃                                       ║ │
│  ╚═══════════════════════════════════════════════════════════════════════════╝ │
│                                                                                  │
│  ╔═══════════════════════════════════════════════════════════════════════════╗ │
│  ║  2. PARALLELIZATION NATIVE                                                ║ │
│  ║     └─ Island 기반 독립적 처리                                           ║ │
│  ║     └─ Lock-free 알고리즘                                                ║ │
│  ║     └─ 멀티코어 선형 확장                                                ║ │
│  ╚═══════════════════════════════════════════════════════════════════════════╝ │
│                                                                                  │
│  ╔═══════════════════════════════════════════════════════════════════════════╗ │
│  ║  3. UNIFIED & OPEN                                                        ║ │
│  ║     └─ Rigid, Soft, Cloth, Destruction 통합                              ║ │
│  ║     └─ 완전 오픈소스                                                     ║ │
│  ║     └─ 무제한 커스터마이징                                               ║ │
│  ╚═══════════════════════════════════════════════════════════════════════════╝ │
│                                                                                  │
│  결론: Chaos는 PhysX의 단순 대체가 아닌, 현대적 물리 엔진의 새로운 기준        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

> 이 문서는 Chaos Physics의 설계 철학과 PhysX와의 비교를 설명합니다.