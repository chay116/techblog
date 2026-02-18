---
title: "Niagara Module 시스템"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Niagara Module 시스템

## 🧭 개요

**Niagara Module**은 재사용 가능한 **파티클 동작 블록**입니다. 각 Module은 특정 기능(예: 중력 적용, 색상 변경, 충돌 처리 등)을 캡슐화하며, Emitter Stack에 추가하여 파티클 시스템을 구성합니다. Module은 **함수 그래프(Function Graph)** 형태로 구현되며, **Input/Output 파라미터**를 통해 데이터를 주고받습니다.

**핵심 철학:**
> Module은 **작고 재사용 가능한 빌딩 블록**이며,
> **Stack 순서**에 따라 실행되고,
> **Map Get/Set**을 통해 Attribute를 읽고 쓴다.
> Module은 **Script 타입별로 분류**되며 (Spawn, Update, Event 등),
> **상속과 버전 관리**를 통해 업데이트 가능하다.

**📂 주요 파일 위치:**
- Module Script: `Engine/Plugins/FX/Niagara/Content/Modules/*.uasset`
- Module Base: `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraScript.h`

---

## 🏗️ Module 구조

### 1. **Module 타입 (Script Usage)**

```cpp
enum class ENiagaraScriptUsage : uint8
{
    // Emitter Lifecycle
    EmitterSpawnScript,        // Emitter 생성 시 1회 실행
    EmitterUpdateScript,       // 매 프레임 실행 (Emitter 레벨)

    // Particle Lifecycle
    ParticleSpawnScript,       // 파티클 생성 시 실행
    ParticleUpdateScript,      // 매 프레임 실행 (파티클 레벨)
    ParticleEventScript,       // 이벤트 발생 시 실행

    // System Lifecycle
    SystemSpawnScript,         // System 생성 시 1회 실행
    SystemUpdateScript,        // 매 프레임 실행 (System 레벨)

    // Simulation Stage
    ParticleSimulationStageScript,  // Sim Stage에서 실행 (GPU 전용)

    // GPU Emitter
    ParticleGPUComputeScript,  // GPU Compute Shader로 컴파일됨
};
```

**실행 순서:**

```
System Spawn (1회)
     ↓
System Update (매 프레임)
     ↓
Emitter Spawn (1회)
     ↓
Emitter Update (매 프레임)
     ↓
Particle Spawn (새 파티클마다)
     ↓
Particle Update (모든 파티클, 매 프레임)
     ↓
Particle Event (이벤트 발생 시)
     ↓
Simulation Stage (GPU, 선택적)
```

---

### 2. **Module Stack**

**Stack 구조:**

```
┌────────────────────────────────────────────────────┐
│  Emitter Properties                                │
├────────────────────────────────────────────────────┤
│  Emitter Spawn                                     │
│    ├─ Module: Initialize Emitter                  │
│    └─ Module: Set Emitter Bounds                  │
├────────────────────────────────────────────────────┤
│  Emitter Update                                    │
│    ├─ Module: Spawn Rate                          │
│    └─ Module: Spawn Burst Instantaneous           │
├────────────────────────────────────────────────────┤
│  Particle Spawn                                    │
│    ├─ Module: Initialize Particle                 │
│    ├─ Module: Add Velocity                        │
│    ├─ Module: Set Color                           │
│    └─ Module: Set Sprite Size                     │
├────────────────────────────────────────────────────┤
│  Particle Update                                   │
│    ├─ Module: Gravity Force                       │
│    ├─ Module: Drag                                 │
│    ├─ Module: Color Over Life                     │
│    ├─ Module: Scale Sprite Size                   │
│    └─ Module: Kill Particles (Age > Lifetime)     │
├────────────────────────────────────────────────────┤
│  Add Event Handler                                 │
│    └─ Collision Event                             │
│        ├─ Module: Play Sound at Location          │
│        └─ Module: Spawn Particles                 │
└────────────────────────────────────────────────────┘
```

---

### 3. **Map Get / Map Set**

Module은 **Map Get**으로 Attribute를 읽고, **Map Set**으로 씁니다.

**Map Get:**

```
Input: Particles (Particle Data Interface)
Input: AttributeName (예: "Position")
Output: Value (FVector3f)

→ Particles.Position 읽기
```

**Map Set:**

```
Input: Particles (Particle Data Interface)
Input: AttributeName (예: "Position")
Input: Value (FVector3f)

→ Particles.Position 쓰기
```

**예시: Gravity Force Module**

```
Function: ApplyGravity

Parameters:
  - GravityForce (FVector3f) = (0, 0, -980)

Implementation:
  ┌────────────────────────────────────────────┐
  │  Map Get                                   │
  │    Attribute: "Velocity"                   │
  │    → CurrentVelocity                       │
  ├────────────────────────────────────────────┤
  │  Map Get                                   │
  │    Attribute: "Mass"                       │
  │    → Mass                                  │
  ├────────────────────────────────────────────┤
  │  Calculate                                 │
  │    Acceleration = GravityForce / Mass      │
  │    NewVelocity = CurrentVelocity +         │
  │                  Acceleration * DeltaTime  │
  ├────────────────────────────────────────────┤
  │  Map Set                                   │
  │    Attribute: "Velocity"                   │
  │    Value: NewVelocity                      │
  └────────────────────────────────────────────┘
```

---

## 💡 대표적인 Module들

### Spawn Modules

| Module | 설명 |
|--------|------|
| **Initialize Particle** | 필수 Attribute 초기화 (Position, Velocity, Lifetime 등) |
| **Spawn Rate** | 초당 파티클 생성 개수 |
| **Spawn Burst Instantaneous** | 즉시 N개 생성 |
| **Shape Location** | 다양한 Shape에서 Spawn (Sphere, Box, Cylinder 등) |
| **Add Velocity** | 초기 속도 설정 |
| **Add Velocity in Cone** | Cone 모양으로 속도 설정 |

### Update Modules

| Module | 설명 |
|--------|------|
| **Gravity Force** | 중력 적용 |
| **Drag** | 공기 저항 (속도 감쇠) |
| **Curl Noise Force** | Curl Noise 기반 Force |
| **Point Attraction Force** | 특정 위치로 끌어당김 |
| **Collision** | 환경 충돌 처리 |
| **Kill Particles in Volume** | Volume 내부 파티클 제거 |
| **Color Over Life** | 수명에 따라 색상 변화 |
| **Scale Sprite Size** | 크기 변화 |
| **Solve Forces and Velocity** | Force를 Velocity로 변환 |

### Event Modules

| Module | 설명 |
|--------|------|
| **Generate Collision Event** | 충돌 시 이벤트 생성 |
| **Generate Death Event** | 파티클 사망 시 이벤트 생성 |
| **Spawn Particles in Response to Event** | 이벤트에 대한 반응으로 새 파티클 생성 |
| **Play Audio** | 이벤트 발생 시 소리 재생 |

---

## 🔧 Module 작성

### 예시 1: 간단한 Bounce Module

```
Module Name: Bounce on Ground

Parameters:
  - GroundHeight (float) = 0.0
  - BounceFactor (float) = 0.8

Implementation:
  ┌────────────────────────────────────────────┐
  │  Map Get: "Position" → Position            │
  ├────────────────────────────────────────────┤
  │  Map Get: "Velocity" → Velocity            │
  ├────────────────────────────────────────────┤
  │  if (Position.Z < GroundHeight)            │
  │  {                                         │
  │      Position.Z = GroundHeight             │
  │      Velocity.Z = abs(Velocity.Z) *        │
  │                   BounceFactor             │
  │  }                                         │
  ├────────────────────────────────────────────┤
  │  Map Set: "Position" ← Position            │
  ├────────────────────────────────────────────┤
  │  Map Set: "Velocity" ← Velocity            │
  └────────────────────────────────────────────┘
```

---

### 예시 2: Temperature System Module

```
Module Name: Update Temperature

Parameters:
  - AmbientTemperature (float) = 20.0
  - CoolingRate (float) = 5.0

Implementation:
  ┌────────────────────────────────────────────┐
  │  Map Get: "Temperature" → Temp             │
  ├────────────────────────────────────────────┤
  │  float Difference = Temp - AmbientTemp     │
  │  float Cooling = Difference * CoolingRate  │
  │                  * DeltaTime               │
  │  Temp -= Cooling                           │
  ├────────────────────────────────────────────┤
  │  Map Set: "Temperature" ← Temp             │
  ├────────────────────────────────────────────┤
  │  // Color 업데이트                         │
  │  float NormalizedTemp = saturate(          │
  │      (Temp - 0.0) / 100.0)                │
  │  Color = lerp(Blue, Red, NormalizedTemp)   │
  ├────────────────────────────────────────────┤
  │  Map Set: "Color" ← Color                  │
  └────────────────────────────────────────────┘
```

---

### 예시 3: Vortex Force Module

```
Module Name: Vortex Force

Parameters:
  - VortexCenter (FVector3f) = (0, 0, 0)
  - VortexAxis (FVector3f) = (0, 0, 1)
  - VortexStrength (float) = 1000.0
  - VortexRadius (float) = 500.0

Implementation:
  ┌────────────────────────────────────────────┐
  │  Map Get: "Position" → Position            │
  ├────────────────────────────────────────────┤
  │  FVector3f Offset = Position - VortexCenter│
  │  float Distance = length(Offset)           │
  │                                            │
  │  if (Distance < VortexRadius && Distance > 0.1)│
  │  {                                         │
  │      // Tangential Force                   │
  │      FVector3f Tangent = cross(VortexAxis, │
  │                               Offset)      │
  │      Tangent = normalize(Tangent)          │
  │                                            │
  │      // Falloff                            │
  │      float Falloff = 1.0 - (Distance /     │
  │                             VortexRadius)  │
  │      float ForceMag = VortexStrength *     │
  │                       Falloff              │
  │                                            │
  │      // Radial Force (끌어당김)            │
  │      FVector3f Radial = -normalize(Offset) │
  │                         * ForceMag * 0.2   │
  │                                            │
  │      FVector3f TotalForce = Tangent *      │
  │                             ForceMag +     │
  │                             Radial         │
  │                                            │
  │      // Apply Force                        │
  │      Map Get: "Velocity" → Velocity        │
  │      Velocity += TotalForce * DeltaTime    │
  │      Map Set: "Velocity" ← Velocity        │
  │  }                                         │
  └────────────────────────────────────────────┘
```

---

## 🔗 Module 간 통신

### 방법 1: Attribute를 통한 통신

```
Module A: Set Temperature
  ┌─────────────────────────────┐
  │  Temp = CalculateTemp()     │
  │  Map Set: "Temperature"     │
  └─────────────────────────────┘
            ↓ (Particles.Temperature)

Module B: Color Based on Temperature
  ┌─────────────────────────────┐
  │  Map Get: "Temperature"     │
  │  Color = TempToColor(Temp)  │
  │  Map Set: "Color"           │
  └─────────────────────────────┘
```

---

### 방법 2: Emitter Parameter를 통한 통신

```
Emitter Spawn Module: Initialize Wind
  ┌──────────────────────────────────┐
  │  Emitter.WindDirection = (1,0,0) │
  │  Emitter.WindStrength = 500.0    │
  └──────────────────────────────────┘
            ↓ (Emitter Parameters)

Particle Update Module: Apply Wind
  ┌──────────────────────────────────┐
  │  FVector3f Wind = Emitter.       │
  │    WindDirection * Emitter.      │
  │    WindStrength                  │
  │  Map Get: "Velocity" → Vel       │
  │  Vel += Wind * DeltaTime         │
  │  Map Set: "Velocity" ← Vel       │
  └──────────────────────────────────┘
```

---

### 방법 3: DataInterface를 통한 통신

```
Module A: Write to Grid
  ┌─────────────────────────────────┐
  │  int3 GridIndex = WorldToGrid(  │
  │      Particles.Position)        │
  │  Grid3D.SetValue(GridIndex, 0,  │
  │      Particles.Density)         │
  └─────────────────────────────────┘
            ↓ (Grid3DCollection)

Module B: Read from Grid
  ┌─────────────────────────────────┐
  │  int3 GridIndex = WorldToGrid(  │
  │      Particles.Position)        │
  │  float Density = Grid3D.GetValue│
  │      (GridIndex, 0)             │
  │  Particles.Color *= Density     │
  └─────────────────────────────────┘
```

---

## 📦 Module 라이브러리

### Built-in Modules 구조

```
Content/Modules/
├─ Common/
│  ├─ InitializeParticle.uasset
│  ├─ SpawnRate.uasset
│  ├─ SpawnBurst.uasset
│  └─ KillParticles.uasset
├─ Forces/
│  ├─ GravityForce.uasset
│  ├─ Drag.uasset
│  ├─ CurlNoiseForce.uasset
│  ├─ PointAttractionForce.uasset
│  └─ VortexForce.uasset
├─ Color/
│  ├─ ColorOverLife.uasset
│  ├─ ScaleColorOverLife.uasset
│  └─ RandomColor.uasset
├─ Size/
│  ├─ ScaleSpriteSize.uasset
│  ├─ ScaleSpriteSeizeBySpeed.uasset
│  └─ UniformScaleSpriteSize.uasset
├─ Collision/
│  ├─ CollisionQuery.uasset
│  ├─ KillParticlesInVolume.uasset
│  └─ BounceOffSurface.uasset
├─ Location/
│  ├─ ShapeLocation_Sphere.uasset
│  ├─ ShapeLocation_Box.uasset
│  ├─ ShapeLocation_Cylinder.uasset
│  ├─ ShapeLocation_Mesh.uasset
│  └─ ShapeLocation_SkeletalMesh.uasset
└─ Events/
   ├─ GenerateCollisionEvent.uasset
   ├─ GenerateDeathEvent.uasset
   └─ SpawnParticlesOnEvent.uasset
```

---

## 🐛 디버깅 팁

### Module Execution 순서 확인

```cpp
// Console Command
Niagara.Debug.DrawEmitterExecutionOrder 1

// 화면에 표시:
// Emitter: MyEmitter
//   [Emitter Spawn]
//     1. Initialize Emitter
//     2. Set Bounds
//   [Emitter Update]
//     3. Spawn Rate
//     4. Spawn Burst
//   [Particle Spawn]
//     5. Initialize Particle
//     6. Add Velocity
//     7. Set Color
//   [Particle Update]
//     8. Gravity Force
//     9. Drag
//     10. Collision
//     11. Kill Particles
```

### Module Parameter 값 확인

```cpp
// Blueprint
UNiagaraComponent* Comp = ...;
UNiagaraEmitter* Emitter = ...;

// Module Parameter 읽기
FNiagaraVariable ParamVar(FNiagaraTypeDefinition::GetFloatDef(), TEXT("Module.GravityForce.Gravity"));
float GravityValue = Comp->GetFloatParameter(ParamVar.GetName());

UE_LOG(LogTemp, Log, TEXT("Gravity: %.2f"), GravityValue);
```

---

## 📚 참고 자료

### 핵심 개념 요약

| 개념 | 설명 |
|------|------|
| **Module** | 재사용 가능한 파티클 동작 블록 |
| **Module Stack** | Module들이 순서대로 실행되는 구조 |
| **Map Get/Set** | Attribute 읽기/쓰기 메커니즘 |
| **Script Usage** | Module 타입 (Spawn, Update, Event 등) |
| **Execution Order** | System → Emitter → Particle 순서 |
| **Parameter** | Module의 설정값 (외부에서 조정 가능) |
| **Function Graph** | Module의 내부 구현 (노드 그래프) |

---

> 📝 **작성일:** 2025-01-22
> 📝 **버전:** Unreal Engine 5.7
