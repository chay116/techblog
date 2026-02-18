---
title: "Soft Body Physics Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Physics"
tags: ["unreal", "Physics"]
---
# Soft Body Physics Deep Dive

## 🧭 개요

**Soft Body Physics**는 변형 가능한 물체(젤리, 천, 근육 등)를 시뮬레이션하는 시스템입니다.

### Rigid Body vs Soft Body

| 특징 | Rigid Body | Soft Body |
|------|-----------|-----------|
| **변형** | 변형 없음 (단단함) | 변형 가능 (부드러움) |
| **표현** | 6 DOF (위치 + 회전) | Vertex 단위 시뮬레이션 |
| **용도** | 상자, 돌, 자동차 | 젤리, 천, 풍선, 근육 |
| **연산량** | 낮음 (1개 객체 = 6 DOF) | 높음 (1개 객체 = N vertices × 3 DOF) |

---

## 🏗️ Soft Body Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Soft Body Component                         │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  Static Mesh / Skeletal Mesh                           │     │
│  │  (Original Geometry - Rest Pose)                       │     │
│  └───────────────────┬────────────────────────────────────┘     │
│                      │                                           │
│                      ▼                                           │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  Tetrahedral Mesh Generation                           │     │
│  │  - Surface Triangle → Volume Tetrahedron               │     │
│  │  - TetGen / Voxel-based                                │     │
│  └───────────────────┬────────────────────────────────────┘     │
└────────────────────────┼──────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Chaos Soft Body Solver                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Per-Vertex Simulation                                   │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │   │
│  │  │ Vertex 0    │  │ Vertex 1    │  │ Vertex N    │      │   │
│  │  │ - Position  │  │ - Position  │  │ - Position  │      │   │
│  │  │ - Velocity  │  │ - Velocity  │  │ - Velocity  │      │   │
│  │  │ - Mass      │  │ - Mass      │  │ - Mass      │      │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Constraint Solving (XPBD - Extended Position Based)     │   │
│  │  1. Edge Constraint (거리 유지)                          │   │
│  │  2. Volume Constraint (체적 보존)                        │   │
│  │  3. Bending Constraint (굽힘 저항)                       │   │
│  └──────────────────┬───────────────────────────────────────┘   │
│                     │                                            │
│  ┌──────────────────▼───────────────────────────────────────┐   │
│  │  Collision Detection & Response                          │   │
│  │  - Self Collision (자기 자신과 충돌)                      │   │
│  │  - External Collision (Rigid Body, World)                │   │
│  └──────────────────┬───────────────────────────────────────┘   │
└─────────────────────┼────────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Rendering (Mesh Update)                         │
│  - Deformed Vertex Positions → Render Mesh                      │
│  - Normal Recalculation                                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🧩 Tetrahedral Mesh (사면체 메쉬)

### Surface Mesh vs Tetrahedral Mesh

**Surface Mesh (렌더링용):**
```
   v1 ---- v2
   |  \    |
   |    \  |
   v3 ---- v4

Triangles: [v1,v2,v3], [v2,v3,v4]
```

**Tetrahedral Mesh (물리 시뮬레이션용):**
```
        v1
       /|\
      / | \
     /  |  \
    v2--+---v3
     \  |  /
      \ | /
       \|/
        v4

Tetrahedron: [v1, v2, v3, v4] (4개 vertex로 내부 체적 형성)
```

**📂 위치**: `Engine/Source/Runtime/Experimental/Chaos/Public/Chaos/Tetrahedron.h`

```cpp
struct FTetrahedron
{
    int32 V[4];              // 4개 Vertex 인덱스
    float RestVolume;        // 초기 체적
    FMatrix InvRestMatrix;   // 변형 계산용 역행렬
};
```

**왜 Tetrahedron을 사용하는가?**
- Triangle은 **2D 표면**만 표현 (체적 없음)
- Tetrahedron은 **3D 체적** 표현 가능
- 내부 압력, 체적 보존 시뮬레이션 가능

---

## 🔗 Constraint Types

### 1. **Edge Constraint (거리 제약)**

**목적**: 두 Vertex 간 거리 유지

```cpp
// Pseudo Code
void SolveEdgeConstraint(Vertex& V1, Vertex& V2, float RestLength, float Stiffness)
{
    FVector Delta = V2.Position - V1.Position;
    float CurrentLength = Delta.Size();
    float Error = CurrentLength - RestLength;

    FVector Correction = Delta.GetSafeNormal() * Error * 0.5f * Stiffness;
    V1.Position += Correction;
    V2.Position -= Correction;
}
```

**효과**: 물체가 늘어나거나 찌그러지지 않도록 유지

### 2. **Volume Constraint (체적 제약)**

**목적**: Tetrahedron의 체적 보존

```cpp
void SolveVolumeConstraint(FTetrahedron& Tet, float Stiffness)
{
    float CurrentVolume = CalculateTetrahedronVolume(Tet);
    float Error = CurrentVolume - Tet.RestVolume;

    // 4개 Vertex를 안쪽/바깥쪽으로 이동시켜 체적 복원
    FVector Correction = CalculateVolumeGradient(Tet) * Error * Stiffness;
    for (int i = 0; i < 4; ++i)
    {
        Vertices[Tet.V[i]].Position += Correction * Tet.InvRestMatrix[i];
    }
}
```

**효과**: 풍선이 부풀어 오르거나 꺼지는 효과 시뮬레이션

### 3. **Bending Constraint (굽힘 제약)**

**목적**: 평평한 표면이 접히지 않도록 저항

```cpp
void SolveBendingConstraint(Vertex& V1, Vertex& V2, Vertex& V3, Vertex& V4, float RestAngle)
{
    // V1-V2를 공유하는 두 Triangle: [V1,V2,V3], [V1,V2,V4]
    float CurrentAngle = CalculateDihedralAngle(V1, V2, V3, V4);
    float Error = CurrentAngle - RestAngle;

    // 4개 Vertex를 회전시켜 각도 복원
    ApplyBendingCorrection(V1, V2, V3, V4, Error * BendingStiffness);
}
```

**효과**: 천, 종이 등의 굽힘 저항 시뮬레이션

---

## 🧮 XPBD (Extended Position Based Dynamics)

**📂 위치**: `Engine/Source/Runtime/Experimental/Chaos/Public/Chaos/XPBDCorotatedConstraints.h`

### PBD vs XPBD

| 특징 | PBD (Position Based Dynamics) | XPBD |
|------|-------------------------------|------|
| **Timestep 의존성** | Stiffness가 dt에 의존 | dt-independent |
| **안정성** | 작은 dt 필요 | 큰 dt에서도 안정적 |
| **정확도** | Iteration 수에 민감 | Compliance 기반 (물리적 정확도 ↑) |

**핵심 개념: Compliance (유연성)**

```cpp
// XPBD Update
float Compliance = 1.0f / (Stiffness * dt * dt);  // dt-independent
float Lambda = -Error / (Compliance + SumInvMass);  // Lagrange Multiplier
ApplyCorrection(Lambda);
```

**Compliance 예시:**
- `Compliance = 0` → 완전 강체 (Rigid)
- `Compliance = 0.1` → 단단한 고무
- `Compliance = 10` → 부드러운 젤리

---

## 🎮 Soft Body Component 생성

### Blueprint

1. Actor에 **Soft Body Component** 추가
2. Static Mesh 할당 (Source Geometry)
3. **Generate Tetrahedral Mesh** 실행
4. **Physics Properties** 설정:
   - Stiffness: 1000 (단단함) ~ 10 (부드러움)
   - Damping: 0.01 (감쇠)
   - Pressure: 1000 (내부 압력 - 풍선 효과)

### C++ 예시

```cpp
UCLASS()
class AJellyActor : public AActor
{
    GENERATED_BODY()

public:
    UPROPERTY(VisibleAnywhere)
    UChaosSoftBodyComponent* SoftBodyComponent;

    AJellyActor()
    {
        SoftBodyComponent = CreateDefaultSubobject<UChaosSoftBodyComponent>(TEXT("SoftBody"));
        RootComponent = SoftBodyComponent;

        // Soft Body 설정
        SoftBodyComponent->EdgeStiffness = 100.0f;        // 거리 제약 강성
        SoftBodyComponent->VolumeStiffness = 1000.0f;     // 체적 보존 강성
        SoftBodyComponent->Damping = 0.05f;               // 감쇠 (진동 억제)
        SoftBodyComponent->bSelfCollide = true;           // 자기 충돌 활성화
    }

    // 외부 힘 적용
    void ApplyPoke(FVector Location, float Impulse)
    {
        SoftBodyComponent->AddImpulseAtLocation(FVector(0, 0, Impulse), Location);
    }
};
```

---

## 🔬 Collision Handling

### Self Collision (자기 충돌)

**문제**: Soft Body가 자기 자신과 겹칠 수 있음 (예: 주머니가 뒤집힘)

**해결:**
```cpp
// ChaosFlesh/Private/ChaosFlesh/FleshCollectionEngineUtility.cpp
void DetectSelfCollision()
{
    // Spatial Hash로 가까운 Vertex 쌍 찾기
    for (auto [V1, V2] : GetNearbyVertexPairs())
    {
        float Distance = (V1.Position - V2.Position).Size();
        if (Distance < SelfCollisionThickness)
        {
            // 두 Vertex를 밀어냄
            FVector Correction = (V2.Position - V1.Position).GetSafeNormal() *
                                 (SelfCollisionThickness - Distance) * 0.5f;
            V1.Position -= Correction;
            V2.Position += Correction;
        }
    }
}
```

### External Collision (외부 충돌)

```cpp
// Rigid Body와의 충돌
void SolveExternalCollision(FSoftBodyVertex& Vertex, const FRigidBody& Obstacle)
{
    // Penetration Depth 계산
    float Depth = CalculatePenetration(Vertex.Position, Obstacle);
    if (Depth > 0)
    {
        // 법선 방향으로 밀어냄
        FVector Normal = GetCollisionNormal(Vertex.Position, Obstacle);
        Vertex.Position += Normal * Depth;

        // 마찰력 적용
        FVector VelocityTangent = Vertex.Velocity - FVector::DotProduct(Vertex.Velocity, Normal) * Normal;
        Vertex.Velocity -= VelocityTangent * FrictionCoefficient;
    }
}
```

---

## 🚀 Performance Optimization

### 1. **LOD (Level of Detail)**

```cpp
// 멀리 있을 때 Tetrahedron 수 감소
if (DistanceToCamera > 10.0f)
{
    SoftBodyComponent->SetSimulationComplexity(ESimulationComplexity::Low);  // 50% vertices
}
else
{
    SoftBodyComponent->SetSimulationComplexity(ESimulationComplexity::High); // 100% vertices
}
```

### 2. **Substep Iteration**

```cpp
// Project Settings → Physics → Chaos
Chaos Solver Iterations = 5;            // Constraint 반복 횟수
Chaos Collision Iterations = 2;         // 충돌 해결 반복

// ↑ 높을수록 안정적이지만 느림
```

### 3. **GPU Acceleration (Experimental)**

```ini
; DefaultEngine.ini
[/Script/Engine.PhysicsSettings]
bEnableChaosGPUSolver=True
```

**측정 예시:**
- 1000-vertex Soft Body (CPU): ~8ms
- 1000-vertex Soft Body (GPU): ~2ms

---

## 💡 실전 예시

### 예시 1: 풍선

```cpp
// 높은 Volume Stiffness + 내부 압력
SoftBodyComponent->VolumeStiffness = 5000.0f;     // 체적 보존 강력
SoftBodyComponent->Pressure = 2000.0f;            // 내부 압력 (부풀어 오름)
SoftBodyComponent->EdgeStiffness = 50.0f;         // 부드러운 표면
```

**결과**: 바람 넣은 풍선처럼 팽팽한 구형 유지

### 예시 2: 젤리

```cpp
// 낮은 Stiffness + 높은 Damping
SoftBodyComponent->EdgeStiffness = 20.0f;         // 부드러움
SoftBodyComponent->VolumeStiffness = 100.0f;      // 약간의 체적 보존
SoftBodyComponent->Damping = 0.1f;                // 진동 빠르게 감쇠
```

**결과**: 흔들흔들 떨리는 젤리 효과

### 예시 3: 근육 (Character Soft Body)

```cpp
// Skeletal Mesh Bone을 Soft Body Vertex에 연결
SoftBodyComponent->AttachToSkeleton(SkeletalMeshComponent);

// Bone 움직임에 따라 Soft Body 변형
SoftBodyComponent->BoneInfluenceRadius = 10.0f;   // Bone 영향 범위
SoftBodyComponent->BoneStiffness = 500.0f;        // Bone과의 연결 강성
```

**결과**: 캐릭터 움직임에 따라 근육/지방이 흔들림

---

## 🎯 일반적인 함정

### ❌ 하지 말아야 할 것

```cpp
// 너무 많은 Vertex (1000+)
TetMesh->GenerateFromMesh(HighPolyMesh, MaxVertices = 5000);  // 너무 느림!
```

### ✅ 올바른 방법

```cpp
// LOD Mesh 사용 + 적절한 Vertex 수
TetMesh->GenerateFromMesh(LowPolyMesh, MaxVertices = 500);    // 빠름
```

### ❌ Self Collision 없이 복잡한 변형

```cpp
SoftBodyComponent->bSelfCollide = false;  // 주머니가 뒤집힐 수 있음!
```

### ✅ Self Collision 활성화

```cpp
SoftBodyComponent->bSelfCollide = true;
SoftBodyComponent->SelfCollisionThickness = 1.0f;  // 최소 거리 유지
```

---

## 📊 성능 비교

| 시뮬레이션 타입 | Vertex 수 | CPU 시간 (ms) | 용도 |
|----------------|-----------|---------------|------|
| Simple Cloth   | 100       | ~0.5ms        | 깃발, 커튼 |
| Jelly Object   | 500       | ~3ms          | 젤리, 쿠션 |
| Character Muscle | 1000    | ~8ms          | 캐릭터 근육 |
| Complex Deformation | 2000+ | ~20ms+       | 특수 효과 (시네마틱) |

---

## 🔗 References

- **Unreal Engine Docs**: [Chaos Flesh (Soft Body)](https://docs.unrealengine.com/5.3/en-US/chaos-flesh-in-unreal-engine/)
- **Paper**: "XPBD: Position-Based Simulation of Compliant Constrained Dynamics" (Macklin et al., 2016)
- **Source Code**: `Engine/Plugins/Experimental/ChaosFlesh/`
- **GDC Talk**: "Advanced Character Physics in Unreal Engine 5" (GDC 2023)

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Soft Body Physics (Chaos Flesh)