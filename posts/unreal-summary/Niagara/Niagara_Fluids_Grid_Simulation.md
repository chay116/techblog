---
title: "Niagara Fluids & Grid Simulation (나이아가라 유체 및 그리드 시뮬레이션)"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Niagara Fluids & Grid Simulation (나이아가라 유체 및 그리드 시뮬레이션)

## 🧭 개요

Niagara의 **Grid-based Simulation**은 3D/2D 격자(Grid)를 사용하여 **유체(Fluid), 가스, 연기(Smoke)** 등의 공간 기반 시뮬레이션을 구현합니다.

**핵심 개념:**
- **Grid3DCollection / Grid2DCollection**: 읽기/쓰기 가능한 3D/2D 텍스처 그리드
- **NeighborGrid3D**: 파티클 간 이웃 관계 저장
- **Simulation Stages**: Grid Iteration으로 셀별 연산 수행
- **GPU Compute**: 대규모 그리드 병렬 처리
- **Advection**: 속도장을 따라 값 이동
- **Pressure Solve**: 비압축성 유체 시뮬레이션

---

## 🧱 Grid DataInterface 종류

### 1. **Grid3DCollection**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceGrid3DCollection.h:124`

```
┌─────────────────────────────────────────────────────────────────────────┐
│              UNiagaraDataInterfaceGrid3DCollection                      │
│  3D 텍스처 기반 그리드, 다중 Attribute 저장                              │
├─────────────────────────────────────────────────────────────────────────┤
│  UPROPERTY:                                                             │
│    - NumAttributes : int32         // 저장할 Attribute 개수             │
│    - RenderTargetUserParameter     // 외부 RT 바인딩                    │
│    - OverrideBufferFormat          // 픽셀 포맷 (Float, Half 등)        │
│                                                                         │
│  주요 함수:                                                              │
│    + SetNumCells(X, Y, Z)          // 그리드 해상도 설정                 │
│    + GetValue(X, Y, Z, AttrIndex)  // 특정 셀 값 읽기                   │
│    + SetValue(X, Y, Z, AttrIndex, Value) // 셀 값 쓰기                  │
│    + SampleGrid(UVW)               // 보간된 값 샘플링                   │
│                                                                         │
│  내부 구조:                                                              │
│    - FGrid3DBuffer (3D Texture)    // RenderThread 버퍼                │
│    - Double Buffering (Current/Destination) // Ping-Pong               │
└─────────────────────────────────────────────────────────────────────────┘
```

**사용 사례:**
- 연기/가스 시뮬레이션 (Smoke, Fire)
- 볼륨 밀도(Density) 저장
- 속도장(Velocity Field) 저장

### 2. **NeighborGrid3D**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceNeighborGrid3D.h:60`

```
┌─────────────────────────────────────────────────────────────────────────┐
│              UNiagaraDataInterfaceNeighborGrid3D                        │
│  셀 단위로 파티클 ID 저장, 이웃 탐색 최적화                               │
├─────────────────────────────────────────────────────────────────────────┤
│  UPROPERTY:                                                             │
│    - MaxNeighborsPerCell : uint32  // 셀당 최대 이웃 개수               │
│                                                                         │
│  주요 함수:                                                              │
│    + GetNeighborCount(X, Y, Z)     // 특정 셀의 이웃 개수               │
│    + GetNeighbor(Index)            // Index번째 이웃 파티클 ID          │
│                                                                         │
│  내부 버퍼:                                                              │
│    - NeighborhoodBuffer            // int[] 파티클 ID 배열              │
│    - NeighborhoodCountBuffer       // int[] 셀별 이웃 개수              │
└─────────────────────────────────────────────────────────────────────────┘
```

**사용 사례:**
- SPH (Smoothed Particle Hydrodynamics)
- 파티클 간 충돌 검출
- 유체 압력 계산

### 3. **Grid2DCollection**

2D 그리드 버전 (Height Field, 2D Fluid 등):

```cpp
// Grid2DCollection
UPROPERTY(EditAnywhere, Category = "Grid")
FIntPoint NumCells;  // 예: (512, 512)

// 사용 예시: 2D Water Simulation
// - Height Map
// - Velocity Field (U, V)
```

---

## 💡 유체 시뮬레이션 구현

### 예시 1: 간단한 Smoke Simulation

**구조:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Smoke Simulation Pipeline                           │
├─────────────────────────────────────────────────────────────────────────┤
│  1. Emitter: Smoke Particles                                            │
│     ├─ Spawn: 초기 위치에서 연기 파티클 생성                             │
│     └─ Update: 중력, 부력 적용                                           │
│                                                                         │
│  2. Grid3DCollection: Density & Velocity                                │
│     ├─ Attributes: Density, VelocityX, VelocityY, VelocityZ (4개)      │
│     └─ Size: 64x64x64 cells                                             │
│                                                                         │
│  3. Simulation Stage 1: Write to Grid                                  │
│     ├─ Iteration: Particles                                             │
│     └─ 파티클 위치 → Grid Cell에 Density 누적                           │
│                                                                         │
│  4. Simulation Stage 2: Advect Grid                                    │
│     ├─ Iteration: Grid Cells                                            │
│     └─ 속도장을 따라 Density 이동 (Semi-Lagrangian Advection)           │
│                                                                         │
│  5. Simulation Stage 3: Apply Forces                                   │
│     ├─ Iteration: Grid Cells                                            │
│     └─ 부력, 점성(Viscosity) 등 적용                                     │
│                                                                         │
│  6. Simulation Stage 4: Read from Grid                                 │
│     ├─ Iteration: Particles                                             │
│     └─ Grid Cell 값 → 파티클 속도에 반영                                │
└─────────────────────────────────────────────────────────────────────────┘
```

**Script 예시:**

```cpp
// Simulation Stage 1: Write to Grid (Particle Iteration)
// - 각 파티클이 자신의 위치에 해당하는 Grid Cell에 값 쓰기

// Input: Particles.Position, Particles.Mass
// Grid: Grid3DCollection

// 1. 파티클 위치를 Grid Index로 변환
Index3D = WorldPosToGridIndex(Particles.Position);

// 2. 해당 셀에 Density 누적 (Atomic Add)
Grid.SetFloatValue(Index3D.X, Index3D.Y, Index3D.Z, DensityAttrIndex,
                   Particles.Mass);

// 3. 속도도 누적
Grid.SetVector3Value(Index3D.X, Index3D.Y, Index3D.Z, VelocityAttrIndex,
                     Particles.Velocity * Particles.Mass);
```

```cpp
// Simulation Stage 2: Advect Grid (Grid Cell Iteration)
// - Semi-Lagrangian Advection

// Iteration Source: Grid (64x64x64 = 262,144 iterations)

// Input: Current Cell Index (Particles.SimulationPosition)
int3 CellIndex = Particles.SimulationPosition;

// 1. 현재 셀의 속도 읽기
float3 Velocity = Grid.GetVector3Value(CellIndex.X, CellIndex.Y, CellIndex.Z, VelAttrIndex);

// 2. 역추적 (Backtracing): 어디서 왔는가?
float3 SourcePos = CellIndex - Velocity * DeltaTime;

// 3. SourcePos에서 Density 샘플링 (Trilinear Interpolation)
float NewDensity = Grid.SampleGridFloatValue(SourcePos, DensityAttrIndex);

// 4. 현재 셀에 쓰기
OutputGrid.SetFloatValue(CellIndex.X, CellIndex.Y, CellIndex.Z, DensityAttrIndex, NewDensity);
```

### 예시 2: SPH (Smoothed Particle Hydrodynamics)

**NeighborGrid3D 활용:**

```cpp
// Simulation Stage 1: Fill NeighborGrid
// - Particle Iteration
// - 각 파티클이 자신의 셀에 등록

Index3D = WorldPosToGridIndex(Particles.Position);
NeighborGrid.SetParticleNeighbor(Index3D.X, Index3D.Y, Index3D.Z, Particles.ID);

// Simulation Stage 2: Compute Pressure
// - Particle Iteration
// - 이웃 파티클과의 상호작용

Index3D = WorldPosToGridIndex(Particles.Position);

// 주변 27개 셀 순회 (3x3x3)
for (int dx = -1; dx <= 1; ++dx)
for (int dy = -1; dy <= 1; ++dy)
for (int dz = -1; dz <= 1; ++dz)
{
    int3 NeighborCell = Index3D + int3(dx, dy, dz);

    int NeighborCount = NeighborGrid.GetNeighborCount(NeighborCell.X, NeighborCell.Y, NeighborCell.Z);

    // 이웃 파티클들과 압력 계산
    for (int i = 0; i < NeighborCount; ++i)
    {
        int NeighborID = NeighborGrid.GetNeighbor(i);
        // SPH Pressure Kernel 적용
        // ...
    }
}
```

---

## ⚠️ 주의사항

### ❌ 피해야 할 것

**1. 과도한 Grid 해상도:**
```cpp
// ❌ 너무 큰 그리드 → GPU 메모리 부족, 성능 저하
NumCells = (256, 256, 256);  // 256³ = 16,777,216 cells!
NumAttributes = 10;           // 각 셀당 10개 float → 640MB+
```

**2. Simulation Stage에서 동시 읽기/쓰기:**
```cpp
// ❌ Race Condition! 같은 프레임에 Read/Write
// Simulation Stage 1: Write
Grid.SetValue(...);

// Simulation Stage 2 (같은 Grid): Read
value = Grid.GetValue(...);  // 정의되지 않은 동작!
```

**3. CPU Emitter에서 Grid 사용:**
```cpp
// ❌ Grid는 GPU 전용
Emitter.SimulationTarget = CPUSimulation;
// Grid3DCollection 사용 → 에러!
```

### ✅ 올바른 방법

**1. 적절한 해상도:**
```cpp
// ✅ 시뮬레이션 목적에 맞는 해상도
NumCells = (64, 64, 64);     // 262,144 cells (관리 가능)
NumAttributes = 4;            // Density + Velocity (X,Y,Z)
```

**2. Double Buffering 활용:**
```cpp
// ✅ Grid3DCollection은 자동으로 Double Buffer 제공
// - CurrentData: 읽기용
// - DestinationData: 쓰기용
// - Simulation Stage 종료 시 Swap

// Stage 1: CurrentData에서 읽기
value = Grid.GetPreviousValue(...);

// Stage 2: DestinationData에 쓰기
Grid.SetValue(...);  // 자동으로 OutputGrid에 기록
```

**3. GPU Emitter 사용:**
```cpp
// ✅ Grid는 GPU Simulation 필수
Emitter.SimulationTarget = GPUComputeSim;
```

---

## 🧩 고급 기법

### 1. **Divergence-Free Velocity (비압축성 유체)**

```cpp
// Simulation Stage: Pressure Projection
// - Poisson Equation 해결 (Jacobi Iteration)

// 1. Divergence 계산
float divU = (U[i+1] - U[i-1]) / (2*dx)
           + (V[j+1] - V[j-1]) / (2*dy)
           + (W[k+1] - W[k-1]) / (2*dz);

// 2. Pressure 업데이트 (Jacobi)
float newP = (P[i+1] + P[i-1] + P[j+1] + P[j-1] + P[k+1] + P[k-1] - divU) / 6.0;

// 3. Velocity 보정
U -= gradP_x;
V -= gradP_y;
W -= gradP_z;
```

### 2. **MacCormack Advection (고정밀도)**

```cpp
// 1st Pass: Forward Advection
float phi_hat = Advect_Forward(phi, velocity, dt);

// 2nd Pass: Backward Advection
float phi_tilde = Advect_Backward(phi_hat, velocity, dt);

// Error Estimation
float error = (phi_tilde - phi) * 0.5;

// Corrected Result
float phi_new = phi_hat + error;
```

### 3. **Vorticity Confinement (소용돌이 보존)**

```cpp
// Vorticity 계산
float3 curl = Curl(Velocity);

// Gradient 계산
float3 grad_curl = Gradient(length(curl));

// Confinement Force
float3 force = epsilon * (grad_curl x curl);

// 속도에 적용
Velocity += force * DeltaTime;
```

---

## 🔗 참조 자료

**소스 파일:**
- `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceGrid3DCollection.h` - Grid3D 구현
- `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceNeighborGrid3D.h:18` - NeighborGrid 구조
- `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceGrid2DCollection.h` - Grid2D 구현

**관련 문서:**
- [Simulation_Stages_Deep_Dive.md](Simulation_Stages_Deep_Dive.md) - Simulation Stage 상세
- [GPU_Compute.md](GPU_Compute.md) - GPU Compute 파이프라인
- [Advanced_DataInterface_Implementation.md](Advanced_DataInterface_Implementation.md) - Custom Grid DI 제작

**외부 자료:**
- Robert Bridson, "Fluid Simulation for Computer Graphics" (유체 시뮬레이션 교과서)
- Jos Stam, "Real-Time Fluid Dynamics for Games" (GDC 2003)
- GPU Gems Chapter 38: "Fast Fluid Dynamics Simulation on the GPU"

---

> 🔄 작성: 2025-11-22 — Niagara Grid-based Fluid Simulation 가이드
