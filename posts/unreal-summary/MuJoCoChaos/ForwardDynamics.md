---
title: "ForwardDynamics - 순동역학 알고리즘"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "MuJoCoChaos"
tags: ["unreal", "MuJoCoChaos"]
---
# ForwardDynamics - 순동역학 알고리즘

> Updated: 2025-12-17 — Featherstone 알고리즘 구현 문서화

## 🧭 Overview

ForwardDynamics 모듈은 관절체(Articulated Body)의 **순동역학(Forward Dynamics)**을 계산합니다. 주어진 힘/토크로부터 가속도를 구하는 문제를 O(n) 복잡도로 해결합니다.

**📂 위치:** `Plugins/MuJoCoChaos/Source/MuJoCoChaos/Public/Dynamics/ForwardDynamics.h`

### 핵심 알고리즘

| 알고리즘 | 복잡도 | 용도 |
|---------|--------|------|
| **ABA** (Articulated Body Algorithm) | O(n) | 순동역학 (τ → q̈) |
| **RNEA** (Recursive Newton-Euler) | O(n) | 역동역학 (q̈ → τ) |
| **CRBA** (Composite Rigid Body) | O(n²) | 질량 행렬 M(q) |

---

## 🧱 Spatial Mathematics

### FSpatialVector - 6D 공간 벡터

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Spatial Vector (Plucker 좌표)                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Motion Vector (속도, 가속도)          Force Vector (힘, 모멘텀)         │
│  ┌─────────────┐                      ┌─────────────┐                   │
│  │  Angular ω  │ ← 회전 성분          │  Moment n   │ ← 모멘트          │
│  ├─────────────┤                      ├─────────────┤                   │
│  │  Linear v   │ ← 이동 성분          │  Force f    │ ← 힘              │
│  └─────────────┘                      └─────────────┘                   │
│                                                                         │
│  6D 벡터: [ω; v] 또는 [n; f]                                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

```cpp
struct FSpatialVector
{
    FVector3d Angular;  // 회전 성분 (ω 또는 n)
    FVector3d Linear;   // 이동 성분 (v 또는 f)

    // 운동량 교차곱 (Motion × Motion)
    // [ω₁; v₁] × [ω₂; v₂] = [ω₁×ω₂; ω₁×v₂ + v₁×ω₂]
    FSpatialVector CrossMotion(const FSpatialVector& Other) const;

    // 힘 교차곱 (Motion ×* Force)
    // [ω; v] ×* [n; f] = [ω×n + v×f; ω×f]
    FSpatialVector CrossForce(const FSpatialVector& Force) const;

    // 공간 내적 (Motion · Force)
    FReal Dot(const FSpatialVector& Force) const;
};
```

### FSpatialInertia - 6×6 공간 관성

```cpp
struct FSpatialInertia
{
    FReal Mass;
    FVector3d CoM;                // 질량 중심
    FMatrix RotationalInertia;    // 3×3 회전 관성

    // I * v 계산
    // [I·ω + m·c×v; m·v + m·c×ω]
    FSpatialVector Apply(const FSpatialVector& Motion) const;
};
```

### FSpatialTransform - 좌표 변환

```cpp
struct FSpatialTransform
{
    FMatrix Rotation;      // 3×3 회전 행렬 E
    FVector3d Translation; // 이동 벡터 r

    // Motion 변환: X·v = [E·ω; E·(v - r×ω)]
    FSpatialVector TransformMotion(const FSpatialVector& V) const;

    // Force 변환: X*·f = [E·(n - r×f); E·f]
    FSpatialVector TransformForce(const FSpatialVector& F) const;
};
```

---

## 🔄 ABA (Articulated Body Algorithm)

### 알고리즘 개요

순동역학 문제: **τ → q̈** (토크가 주어졌을 때 가속도 계산)

```
M(q)·q̈ + C(q, q̇) + G(q) = τ
⟹ q̈ = M⁻¹·(τ - C - G)
```

ABA는 질량 행렬 M을 명시적으로 구하지 않고 O(n)에 가속도를 계산합니다.

### 3-Pass 알고리즘

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ABA: 3-Pass Algorithm                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Pass 1: Forward Kinematics (루트 → 리프)                         │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │  for i = 1 to n:                                                 │   │
│  │      X_J[i] = jcalc(q[i])           // 조인트 변환               │   │
│  │      S[i] = motion_subspace(i)       // 운동 부분공간            │   │
│  │      v_J = S[i] * q̇[i]              // 조인트 속도               │   │
│  │      v[i] = X[i] * v[parent] + v_J   // 링크 속도               │   │
│  │      c[i] = v_J × v[i]               // 코리올리 항              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                            ↓                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Pass 2: Articulated Inertia (리프 → 루트)                        │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │  for i = n down to 1:                                            │   │
│  │      I_A[i] = I[i]                   // 초기화: 링크 관성         │   │
│  │      p_A[i] = v[i] ×* I_A * v[i]     // 편향력                   │   │
│  │                                                                  │   │
│  │      // 자식들로부터 관성 전파                                    │   │
│  │      for each child j of i:                                      │   │
│  │          U = I_A[j] * S[j]                                       │   │
│  │          D = S[j]ᵀ * U                // 유효 관성               │   │
│  │          u = τ[j] - S[j]ᵀ * p_A[j]   // 유효 힘                  │   │
│  │          I_a = I_A[j] - U*Uᵀ/D       // 관절 관성                │   │
│  │          p_a = p_A[j] + I_a*c[j] + U*u/D                         │   │
│  │          I_A[i] += Xᵀ * I_a * X                                  │   │
│  │          p_A[i] += Xᵀ * p_a                                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                            ↓                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Pass 3: Acceleration (루트 → 리프)                               │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │  a[0] = -gravity                     // 루트 가속도 = -중력      │   │
│  │  for i = 1 to n:                                                 │   │
│  │      a'[i] = X[i] * a[parent] + c[i] // 공간 가속도              │   │
│  │      q̈[i] = (u[i] - Uᵀ*a'[i]) / D[i] // 조인트 가속도            │   │
│  │      a[i] = a'[i] + S[i] * q̈[i]      // 링크 가속도              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  출력: q̈ (일반화 가속도)                                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 소스 코드

```cpp
void ComputeABA(
    const FMuJoCoModel& Model,
    FMuJoCoState& State,
    FForwardDynamicsContext& Context,
    const FVector3d& Gravity)
{
    const uint32 Nbody = Model.Nbody;

    // ===== Pass 1: Forward Kinematics =====
    for (uint32 i = 0; i < Nbody; ++i)
    {
        // 조인트 변환 및 속도 계산
        Context.X_J[i] = ComputeJointTransform(Joint, State.Qpos.GetData());
        Context.S[i] = ComputeJointMotionSubspace(Joint);

        FSpatialVector Vj = Context.S[i] * State.Qvel[Joint.QvelStart];

        if (ParentIdx >= 0)
            Context.V[i] = Context.X_J[i].TransformMotion(Context.V[ParentIdx]) + Vj;
        else
            Context.V[i] = Vj;

        Context.C[i] = Vj.CrossMotion(Context.V[i]);
    }

    // ===== Pass 2: Articulated Inertia (backward) =====
    for (int32 i = Nbody - 1; i >= 0; --i)
    {
        FSpatialVector pA = Context.I_A[i].Apply(Context.C[i]) +
                           Context.V[i].CrossForce(Context.I_A[i].Apply(Context.V[i]));

        FSpatialVector IS = Context.I_A[i].Apply(Context.S[i]);
        FReal D = Context.S[i].Dot(IS) + Joint.Armature;
        FReal U = Context.S[i].Dot(pA);

        Context.D[Joint.QvelStart] = D;
        Context.U[Joint.QvelStart] = U;
        Context.u[Joint.QvelStart] = State.QfrcApplied[Joint.QvelStart] - U;

        // 부모에게 관성 전파
        if (ParentIdx >= 0)
        {
            // I_A[parent] += X^T * (I_A - IS*IS^T/D) * X
            // p_A[parent] += X^T * p_a
        }
    }

    // ===== Pass 3: Acceleration (forward) =====
    for (uint32 i = 0; i < Nbody; ++i)
    {
        FSpatialVector ap = a_parent + Context.C[i];
        FSpatialVector IAap = Context.I_A[i].Apply(ap);
        FReal StIAap = Context.S[i].Dot(IAap);

        State.Qacc[QvelStart] = (Context.u[QvelStart] - StIAap) / Context.D[QvelStart];
    }
}
```

---

## 🔄 RNEA (Recursive Newton-Euler Algorithm)

### 역동역학 문제

**q̈ → τ** (가속도가 주어졌을 때 필요한 토크 계산)

```
τ = M(q)·q̈ + C(q, q̇) + G(q)
```

### 2-Pass 알고리즘

```
Pass 1 (Forward): 속도/가속도 전파
  v[i] = X[i] * v[parent] + S[i] * q̇[i]
  a[i] = X[i] * a[parent] + S[i] * q̈[i] + v[i] × S[i] * q̇[i]

Pass 2 (Backward): 힘 전파
  f[i] = I[i] * a[i] + v[i] ×* I[i] * v[i] - f_ext[i]
  τ[i] = S[i]ᵀ * f[i]
  f[parent] += Xᵀ[i] * f[i]
```

---

## 🔄 CRBA (Composite Rigid Body Algorithm)

### 질량 행렬 계산

**M(q)** 계산 (조인트 공간 관성 행렬)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CRBA: Mass Matrix Computation                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  // Pass 1: Composite Inertia (리프 → 루트)                             │
│  for i = n down to 1:                                                   │
│      I_c[i] = I[i]                                                      │
│      for each child j of i:                                             │
│          I_c[i] += Xᵀ[j] * I_c[j] * X[j]                               │
│                                                                         │
│  // Pass 2: Mass Matrix (대각 + 상삼각)                                 │
│  for i = 1 to n:                                                        │
│      F = I_c[i] * S[i]                                                  │
│      M[i,i] = S[i]ᵀ * F                 // 대각 원소                    │
│                                                                         │
│      j = i                                                              │
│      while parent[j] ≠ 0:                                               │
│          F = Xᵀ[j] * F                                                 │
│          j = parent[j]                                                  │
│          M[i,j] = S[j]ᵀ * F             // 상삼각 원소                  │
│          M[j,i] = M[i,j]                 // 대칭                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 💡 Tips & Performance

### 복잡도 비교

| 알고리즘 | 시간 복잡도 | 공간 복잡도 | 용도 |
|---------|------------|------------|------|
| ABA | O(n) | O(n) | 실시간 시뮬레이션 |
| RNEA | O(n) | O(n) | 역동역학, 제어 |
| CRBA | O(n²) | O(n²) | 질량 행렬 필요시 |

### 최적화 팁

**✅ 권장:**
```cpp
// 컨텍스트 재사용 (메모리 할당 최소화)
FForwardDynamicsContext Context;
Context.Initialize(Model);  // 한 번만 호출

for (int step = 0; step < NumSteps; ++step)
{
    Context.Reset();  // 값만 초기화
    ComputeABA(Model, State, Context, Gravity);
}
```

**❌ 피해야 할 것:**
```cpp
// 매 스텝마다 컨텍스트 생성 (비효율적)
for (int step = 0; step < NumSteps; ++step)
{
    FForwardDynamicsContext Context;
    Context.Initialize(Model);  // 매번 메모리 할당
    ComputeABA(Model, State, Context, Gravity);
}
```

### 수치 안정성

```cpp
// 특이점 방지: 유효 관성에 아마추어 추가
FReal D = Context.S[i].Dot(IS);
D += Joint.Armature;  // 정규화
D = FMath::Max(D, 1e-10);  // 0 방지
```

---

## 🔗 References

| 참조 | 설명 |
|------|------|
| Featherstone (2008) | "Rigid Body Dynamics Algorithms" - 원저 |
| MuJoCo Technical Notes | mujoco.org/book/computation |
| `ForwardDynamics.cpp:1-400` | 구현 소스 코드 |
