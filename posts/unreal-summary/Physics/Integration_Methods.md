---
title: "Integration Methods (적분 방법)"
date: "2025-12-07"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Physics"
tags: ["unreal", "Physics"]
engine_version: "** Unreal Engine 5.7"
---
# Integration Methods (적분 방법)

## 🧭 개요

물리 시뮬레이션에서 **적분(Integration)**은 힘과 가속도로부터 속도와 위치를 계산하는 핵심 과정입니다. 적분 방법의 선택은 **안정성**, **정확도**, **성능** 사이의 트레이드오프를 결정합니다.

### 뉴턴의 운동 방정식

```
F = m * a        (힘 = 질량 × 가속도)
a = dv/dt        (가속도 = 속도의 시간 미분)
v = dx/dt        (속도 = 위치의 시간 미분)
```

**문제:** 연속적인 미분 방정식을 이산적인 시간 스텝(dt)으로 근사해야 함

---

## 🧱 적분 방법 비교

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Integration Methods Comparison                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   정확도 ↑                                                                       │
│      │                                                                           │
│      │     ┌──────────────────┐                                                 │
│      │     │   Runge-Kutta 4  │  ← 과학 시뮬레이션                              │
│      │     │   (RK4)          │                                                 │
│      │     └──────────────────┘                                                 │
│      │                                                                           │
│      │     ┌──────────────────┐                                                 │
│      │     │   Verlet         │  ← 분자 동역학, 일부 게임                       │
│      │     │   Integration    │                                                 │
│      │     └──────────────────┘                                                 │
│      │                                                                           │
│      │     ┌──────────────────┐                                                 │
│      │     │  Semi-Implicit   │  ← 🎮 게임 엔진 (Chaos, PhysX)                 │
│      │     │  Euler (Sympl.)  │                                                 │
│      │     └──────────────────┘                                                 │
│      │                                                                           │
│      │     ┌──────────────────┐                                                 │
│      │     │  Implicit Euler  │  ← 정적 해석, Cloth                            │
│      │     │                  │                                                 │
│      │     └──────────────────┘                                                 │
│      │                                                                           │
│      │     ┌──────────────────┐                                                 │
│      │     │  Explicit Euler  │  ← 교육용, 단순 테스트                          │
│      │     │                  │                                                 │
│      │     └──────────────────┘                                                 │
│      │                                                                           │
│      └────────────────────────────────────────────────────────────────→ 성능    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 방법별 요약표

| 방법 | 순서 | 수식 | 안정성 | 성능 | 용도 |
|------|------|------|--------|------|------|
| **Explicit Euler** | 현재 → 다음 | `v += a*dt`, `x += v_old*dt` | ❌ 불안정 | ⚡ 매우 빠름 | 교육용 |
| **Implicit Euler** | 미래 기준 계산 | 선형 시스템 풀이 필요 | ✅ 매우 안정 | 🐢 느림 | 정적 해석 |
| **Semi-Implicit Euler** | 속도 먼저 갱신 | `v += a*dt`, `x += v_new*dt` | ✅ 안정적 | ⚡ 빠름 | 🎮 **게임** |
| **Velocity Verlet** | 대칭 계산 | 아래 참조 | ✅ 매우 안정 | ⚡ 빠름 | 분자 동역학 |
| **RK4** | 4단계 추정 | 4회 평가 평균 | ✅ 정확 | 🐢 느림 | 과학 시뮬 |

---

## 🔷 1. Explicit Euler (명시적 오일러)

### 개념

**현재 상태**만을 사용하여 다음 상태를 계산합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Explicit Euler                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   시간: t ──────────────────────────────────> t + dt             │
│                                                                  │
│   현재 상태 (t):                                                 │
│   ┌──────────────────────┐                                      │
│   │ 위치: x              │                                      │
│   │ 속도: v              │ ──── 이 값들만 사용                  │
│   │ 가속도: a = F/m      │                                      │
│   └──────────────────────┘                                      │
│              │                                                   │
│              │  (현재 값으로 다음 계산)                          │
│              ↓                                                   │
│   다음 상태 (t + dt):                                            │
│   ┌──────────────────────┐                                      │
│   │ x_new = x + v * dt   │  ← 현재 속도 v 사용                  │
│   │ v_new = v + a * dt   │  ← 현재 가속도 a 사용                │
│   └──────────────────────┘                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 수식

```cpp
// Explicit Euler
x_new = x + v * dt;      // 위치 업데이트 (현재 속도 사용)
v_new = v + a * dt;      // 속도 업데이트 (현재 가속도 사용)
```

### 코드 예시

```cpp
void ExplicitEulerStep(FVector& Position, FVector& Velocity,
                       const FVector& Acceleration, float DeltaTime)
{
    // 순서 중요: 현재 속도로 위치 계산
    FVector OldVelocity = Velocity;

    Position += OldVelocity * DeltaTime;   // x += v * dt
    Velocity += Acceleration * DeltaTime;   // v += a * dt
}
```

### 문제점: 에너지 발산

```
       에너지
         │
         │                              ╱
         │                           ╱
         │                        ╱      ← 에너지가 계속 증가!
         │                     ╱
         │                  ╱
         │               ╱
         │            ╱
         │         ╱
    초기 │-------╱
    에너지│    ╱
         │ ╱
         └─────────────────────────────→ 시간

    단순 스프링-질량 시스템에서 Explicit Euler를 사용하면
    진동이 점점 커지다가 폭발함!
```

**원인:** 항상 현재 기울기(접선)로 다음 점을 예측하므로, 실제 궤적보다 바깥쪽으로 벗어남

---

## 🔶 2. Implicit Euler (암묵적 오일러)

### 개념

**미래 상태**를 기준으로 계산합니다. 아직 모르는 미래 값을 사용하므로 방정식을 풀어야 합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Implicit Euler                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   시간: t ──────────────────────────────────> t + dt             │
│                                                                  │
│   현재 상태 (t):          다음 상태 (t + dt):                    │
│   ┌──────────────┐        ┌──────────────┐                      │
│   │ 위치: x      │        │ 위치: x_new  │ ← 미지수!            │
│   │ 속도: v      │        │ 속도: v_new  │ ← 미지수!            │
│   └──────────────┘        └──────────────┘                      │
│                                  │                               │
│                                  │                               │
│                                  ↓                               │
│   방정식:                                                        │
│   ┌──────────────────────────────────────────┐                  │
│   │ x_new = x + v_new * dt                    │                  │
│   │ v_new = v + a(x_new, v_new) * dt          │  ← 미래의       │
│   │                                           │    힘/가속도    │
│   │ → 선형 시스템 (또는 비선형) 풀이 필요     │                  │
│   └──────────────────────────────────────────┘                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 수식

```cpp
// Implicit Euler (개념)
x_new = x + v_new * dt;              // v_new는 아직 모름
v_new = v + a(x_new, v_new) * dt;    // a도 x_new, v_new에 의존

// 스프링의 경우 (F = -k*x - c*v):
// v_new = v + (-k*x_new - c*v_new) * dt / m
// → (1 + c*dt/m) * v_new = v - k*x_new*dt/m
// → 연립 방정식 풀이 필요
```

### 선형 시스템 풀이

```cpp
// 스프링-댐퍼 시스템의 Implicit Euler
// 행렬 형태: A * [x_new, v_new]^T = b
void ImplicitEulerSpring(FVector& Position, FVector& Velocity,
                         float Stiffness, float Damping, float Mass, float DeltaTime)
{
    // 계수 계산
    float k = Stiffness;
    float c = Damping;
    float m = Mass;
    float dt = DeltaTime;

    // 행렬 A 구성
    // | 1       -dt    | | x_new |   | x |
    // | k*dt/m  1+c*dt/m | | v_new | = | v |

    float det = 1.0f + c*dt/m + k*dt*dt/m;  // 행렬식

    // 크래머 법칙으로 풀이
    FVector x_new = (Position + Velocity*dt + Position*c*dt/m) / det;
    FVector v_new = (Velocity - Position*k*dt/m) / det;

    Position = x_new;
    Velocity = v_new;
}
```

### 특징

```
       에너지
         │
    초기 │───────────────────────────────────
    에너지│         ╲
         │            ╲
         │               ╲
         │                  ╲            ← 에너지가 감소
         │                     ╲           (수치적 감쇠)
         │                        ╲
         │                           ╲
         └─────────────────────────────→ 시간

    매우 안정적이지만, 실제보다 에너지가 빠르게 사라짐
    → 진동이 빨리 멈추거나 움직임이 둔해 보임
```

**장점:** 절대 폭발하지 않음 (Unconditionally Stable)
**단점:** 선형 시스템 풀이 필요, 수치 감쇠로 인한 에너지 손실

---

## 🔷 3. Semi-Implicit Euler (반 암묵적 오일러) ⭐

### 개념 - 게임 엔진의 선택

**속도를 먼저 업데이트**하고, 그 **갱신된 속도**로 위치를 업데이트합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                  Semi-Implicit Euler (Symplectic)                │
│                      🎮 게임 엔진 표준                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   시간: t ──────────────────────────────────> t + dt             │
│                                                                  │
│   STEP 1: 속도 먼저 업데이트                                     │
│   ┌──────────────────────────────────────────┐                  │
│   │  v_new = v + a * dt                       │ ← 현재 가속도    │
│   └──────────────────────────────────────────┘                  │
│              │                                                   │
│              │ 갱신된 속도 사용!                                 │
│              ↓                                                   │
│   STEP 2: 위치 업데이트                                          │
│   ┌──────────────────────────────────────────┐                  │
│   │  x_new = x + v_new * dt                   │ ← 새 속도!      │
│   └──────────────────────────────────────────┘                  │
│                                                                  │
│   ⭐ 핵심: Explicit Euler와 비슷하지만,                          │
│          위치 계산에 "갱신된 속도"를 사용!                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Explicit vs Semi-Implicit 차이

```cpp
// ❌ Explicit Euler
v_new = v + a * dt;
x_new = x + v * dt;      // "이전" 속도 v 사용

// ✅ Semi-Implicit Euler
v_new = v + a * dt;
x_new = x + v_new * dt;  // "새로운" 속도 v_new 사용!
                         // 이 한 줄 차이가 안정성을 결정
```

### 코드 예시

```cpp
// Chaos Physics에서 사용하는 방식
void SemiImplicitEulerStep(FVector& Position, FVector& Velocity,
                           const FVector& Acceleration, float DeltaTime)
{
    // 1. 속도 먼저 업데이트
    Velocity += Acceleration * DeltaTime;   // v += a * dt

    // 2. 갱신된 속도로 위치 업데이트
    Position += Velocity * DeltaTime;       // x += v_new * dt
}

// 실제 Chaos 구현 (간략화)
// Engine/Source/Runtime/Experimental/Chaos/Private/Chaos/PBDRigidsEvolution.cpp
void FPBDRigidsEvolution::Integrate(FReal Dt)
{
    for (auto& Particle : Particles)
    {
        if (Particle.IsDynamic())
        {
            // 외력에 의한 가속도
            FVec3 Acceleration = Particle.GetAcceleration() + Gravity;

            // Semi-Implicit Euler
            FVec3 NewVelocity = Particle.GetV() + Acceleration * Dt;
            FVec3 NewPosition = Particle.GetX() + NewVelocity * Dt;

            Particle.SetV(NewVelocity);
            Particle.SetX(NewPosition);
        }
    }
}
```

### Symplectic 특성 (에너지 보존)

```
       에너지
         │
         │    ╱╲    ╱╲    ╱╲    ╱╲    ╱╲
    초기 │───╱──╲──╱──╲──╱──╲──╱──╲──╱──╲───
    에너지│  ╱    ╲╱    ╲╱    ╲╱    ╲╱    ╲
         │ ╱
         │╱
         │      ↑ 에너지가 진동하지만 평균은 보존!
         │
         └─────────────────────────────────→ 시간

    Symplectic Integrator의 특징:
    - 에너지가 정확히 보존되지는 않지만
    - 장시간 시뮬레이션해도 발산/수렴하지 않음
    - 위상 공간(Phase Space)의 부피를 보존
```

### 왜 게임에서 Semi-Implicit을 쓰는가?

| 이유 | 설명 |
|------|------|
| **안정성** | Explicit보다 훨씬 안정적, 큰 dt에서도 폭발 안 함 |
| **성능** | Implicit처럼 선형 시스템 풀이가 필요 없음 |
| **에너지 보존** | Symplectic하여 장시간 시뮬레이션에도 에너지 발산/감쇠 없음 |
| **단순성** | 구현이 매우 간단 (2줄) |
| **예측 가능** | 물리적으로 그럴듯한 결과 |

---

## 🔶 4. Velocity Verlet (속도 베를레)

### 개념

위치와 속도를 **대칭적으로** 계산하여 2차 정확도를 얻습니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Velocity Verlet                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   STEP 1: 위치 업데이트 (현재 속도 + 가속도 보정)                │
│   ┌──────────────────────────────────────────┐                  │
│   │  x_new = x + v*dt + 0.5*a*dt²             │                  │
│   └──────────────────────────────────────────┘                  │
│                                                                  │
│   STEP 2: 새 위치에서 가속도 계산                                │
│   ┌──────────────────────────────────────────┐                  │
│   │  a_new = F(x_new) / m                     │                  │
│   └──────────────────────────────────────────┘                  │
│                                                                  │
│   STEP 3: 속도 업데이트 (현재와 새 가속도의 평균)                │
│   ┌──────────────────────────────────────────┐                  │
│   │  v_new = v + 0.5*(a + a_new)*dt           │                  │
│   └──────────────────────────────────────────┘                  │
│                                                                  │
│   특징: 시간 대칭성 → 에너지 보존성 우수                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 코드 예시

```cpp
void VelocityVerletStep(FVector& Position, FVector& Velocity,
                        FVector& Acceleration, float Mass, float DeltaTime,
                        TFunction<FVector(const FVector&)> ComputeForce)
{
    float dt = DeltaTime;
    float dt2 = dt * dt;

    // Step 1: 위치 업데이트
    Position += Velocity * dt + 0.5f * Acceleration * dt2;

    // Step 2: 새 위치에서 힘/가속도 계산
    FVector Force = ComputeForce(Position);
    FVector NewAcceleration = Force / Mass;

    // Step 3: 속도 업데이트 (평균 가속도 사용)
    Velocity += 0.5f * (Acceleration + NewAcceleration) * dt;

    // 다음 스텝을 위해 가속도 저장
    Acceleration = NewAcceleration;
}
```

### 용도

- **분자 동역학 (Molecular Dynamics)**: LAMMPS, GROMACS 등
- **천체 역학**: N-body 시뮬레이션
- **일부 게임**: 정밀한 궤도 계산이 필요한 경우

---

## 🔷 5. Runge-Kutta 4 (RK4)

### 개념

4번의 기울기 평가를 통해 4차 정확도를 얻습니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Runge-Kutta 4 (RK4)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   t에서 t+dt까지의 변화를 4단계로 추정:                          │
│                                                                  │
│   k1 = f(t, y)                    ← 시작점의 기울기              │
│   k2 = f(t + dt/2, y + k1*dt/2)   ← 중간점 기울기 (k1 사용)      │
│   k3 = f(t + dt/2, y + k2*dt/2)   ← 중간점 기울기 (k2 사용)      │
│   k4 = f(t + dt, y + k3*dt)       ← 끝점 기울기 (k3 사용)        │
│                                                                  │
│   y_new = y + (k1 + 2*k2 + 2*k3 + k4) * dt / 6                   │
│                                                                  │
│        │                                                         │
│        │    k1   k2,k3   k4                                      │
│        │    ╱    ╱ ╲    ╲                                        │
│        │   ╱    ╱   ╲    ╲                                       │
│        │  ╱────╱─────╲────╲                                      │
│        │ ●════════════════●                                      │
│        │ t              t+dt                                     │
│        └─────────────────────→                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 코드 예시

```cpp
struct FPhysicsState
{
    FVector Position;
    FVector Velocity;
};

FPhysicsState RK4Step(const FPhysicsState& State, float Mass, float DeltaTime,
                      TFunction<FVector(const FVector&, const FVector&)> ComputeForce)
{
    auto Evaluate = [&](const FPhysicsState& S, float dt, const FPhysicsState& Derivative) -> FPhysicsState
    {
        FPhysicsState NewState;
        NewState.Position = S.Position + Derivative.Position * dt;
        NewState.Velocity = S.Velocity + Derivative.Velocity * dt;

        FPhysicsState D;
        D.Position = NewState.Velocity;
        D.Velocity = ComputeForce(NewState.Position, NewState.Velocity) / Mass;
        return D;
    };

    FPhysicsState k1 = Evaluate(State, 0.0f, FPhysicsState());
    FPhysicsState k2 = Evaluate(State, DeltaTime * 0.5f, k1);
    FPhysicsState k3 = Evaluate(State, DeltaTime * 0.5f, k2);
    FPhysicsState k4 = Evaluate(State, DeltaTime, k3);

    FPhysicsState Result;
    Result.Position = State.Position + (k1.Position + 2*k2.Position + 2*k3.Position + k4.Position) * DeltaTime / 6.0f;
    Result.Velocity = State.Velocity + (k1.Velocity + 2*k2.Velocity + 2*k3.Velocity + k4.Velocity) * DeltaTime / 6.0f;

    return Result;
}
```

### 게임에서 RK4를 잘 안 쓰는 이유

| 이유 | 설명 |
|------|------|
| **성능** | 프레임당 4번의 힘 계산 필요 |
| **충돌 처리** | 중간 단계에서 충돌 처리가 복잡 |
| **오버킬** | 게임의 dt(16~33ms)에서는 Semi-Implicit으로 충분 |
| **에너지 보존** | Symplectic하지 않아 장시간 시뮬레이션에서 에너지 드리프트 |

---

## 🔶 6. Position Based Dynamics (PBD)

### 개념

Chaos의 Constraint Solver가 사용하는 방식입니다. **속도 대신 위치를 직접 조작**합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                   Position Based Dynamics                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   전통적 방식:  힘 → 가속도 → 속도 → 위치                        │
│   PBD:         위치 직접 수정 → 속도 역계산                      │
│                                                                  │
│   알고리즘:                                                      │
│   1. 외력으로 예측 위치 계산 (Semi-Implicit)                     │
│      x_pred = x + v*dt + a*dt²                                   │
│                                                                  │
│   2. 제약 조건으로 위치 보정 (Iteration)                         │
│      for each constraint:                                        │
│          ΔX = ProjectConstraint(x_pred)                          │
│          x_pred += ΔX                                            │
│                                                                  │
│   3. 속도 역계산                                                 │
│      v_new = (x_pred - x) / dt                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Chaos에서의 PBD 흐름

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Chaos PBD Solver Flow                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                   │
│   │  Integrate   │ ──→ │  Collision   │ ──→ │   Solve      │                   │
│   │  Positions   │     │  Detection   │     │ Constraints  │                   │
│   │  (Predict)   │     │              │     │  (Iterate)   │                   │
│   └──────────────┘     └──────────────┘     └──────────────┘                   │
│          │                                          │                           │
│          │                                          ↓                           │
│          │                                  ┌──────────────┐                   │
│          │                                  │   Update     │                   │
│          └────────────────────────────────→ │  Velocities  │                   │
│                                             │   from Δx    │                   │
│                                             └──────────────┘                   │
│                                                                                  │
│   핵심: 위치를 직접 제약하므로 충돌/관절이 "확실히" 만족됨                      │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ 성능 및 정확도 비교

### 정량적 비교 (스프링-질량 시스템)

```
시뮬레이션: 스프링 상수 k=1000, 질량 m=1, dt=0.01s, 10초 시뮬레이션

방법             | 에너지 오차 (%) | 위상 오차 | 힘 평가 횟수/스텝 |
-----------------|-----------------|-----------|-------------------|
Explicit Euler   |     +847%       |   크다    |        1          |
Semi-Implicit    |      ±2%        |   작다    |        1          |
Velocity Verlet  |      ±0.1%      |  매우 작다|        1-2        |
RK4              |      ±0.01%     |  극소     |        4          |
Implicit Euler   |      -45%       |   작다    |    1 + 솔버       |
```

### dt 크기와 안정성

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Stability vs Time Step                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   dt ↑ (큰 타임스텝)                                                            │
│      │                                                                           │
│      │  ┌────────────────────────────────────────────────────────┐              │
│      │  │                    Implicit Euler                       │              │
│      │  │          (무조건 안정, 하지만 부정확)                   │              │
│      │  └────────────────────────────────────────────────────────┘              │
│      │                                                                           │
│      │  ┌────────────────────────────────────────────────────────┐              │
│      │  │                  Semi-Implicit Euler                    │              │
│      │  │            (조건부 안정, dt < 임계값)                   │ ← 게임       │
│      │  └────────────────────────────────────────────────────────┘              │
│      │                                                                           │
│      │  ┌─────────────────────────────────┐                                     │
│      │  │         Explicit Euler          │                                     │
│      │  │    (쉽게 불안정, dt 매우 작아야 함)                                   │
│      │  └─────────────────────────────────┘                                     │
│      │                                                                           │
│      └────────────────────────────────────────────────────────────→ 안정성     │
│                                                                                  │
│   게임에서 dt ≈ 16ms (60fps) 또는 33ms (30fps)                                  │
│   Semi-Implicit은 이 범위에서 대부분 안정적                                     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 💡 실전 가이드

### 언제 어떤 방법을 쓸까?

| 상황 | 추천 방법 | 이유 |
|------|-----------|------|
| 🎮 게임 물리 (일반) | Semi-Implicit Euler | 빠르고 안정적 |
| 🎮 게임 물리 (PBD 제약) | PBD + Semi-Implicit | Chaos 기본 |
| 🔬 과학 시뮬레이션 | RK4 또는 Verlet | 정확도 중요 |
| 👗 Cloth 시뮬레이션 | Implicit (XPBD) | 큰 dt에서 안정성 |
| 🌍 천체/궤도 | Velocity Verlet | 에너지 보존 |
| 📚 교육/학습 | Explicit Euler | 이해하기 쉬움 |

### Chaos 물리 설정에서의 적용

```cpp
// Chaos 물리 설정
// Engine/Source/Runtime/Experimental/Chaos/Public/Chaos/PBDRigidsEvolution.h

// 서브스테핑으로 안정성 확보
PhysicsSettings.SubstepCount = 4;  // dt를 4등분

// 솔버 반복 횟수
PhysicsSettings.SolverIterations = 8;  // PBD 제약 반복

// 충돌 마진
PhysicsSettings.CollisionMargin = 0.1f;  // cm 단위
```

---

## 🔗 관련 문서

- [Overview.md](Overview.md) - 물리 시스템 개요
- [Chaos_Deep_Dive.md](Chaos_Deep_Dive.md) - Chaos 솔버 상세
- [PBDSolver.md](PBDSolver.md) - PBD 솔버

---

## 📚 참고 자료

- Baraff & Witkin, "Physically Based Modeling" (SIGGRAPH Course)
- Müller et al., "Position Based Dynamics" (2006)
- Hairer et al., "Geometric Numerical Integration" (Springer)
- Game Physics Cookbook - Allen Chou

---

> 이 문서는 물리 시뮬레이션의 적분 방법을 설명합니다.