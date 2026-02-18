---
title: "Custom HLSL Nodes (커스텀 HLSL 노드)"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Custom HLSL Nodes (커스텀 HLSL 노드)

## 🧭 개요

Custom HLSL Node는 Niagara Script Graph에서 **직접 HLSL 코드를 작성**하여 사용할 수 있는 기능입니다. 복잡한 수학 연산, GPU 최적화, 또는 기존 노드로 구현하기 어려운 기능을 구현할 때 사용합니다.

**핵심 개념:**
- **Inline HLSL**: Graph 내에서 직접 HLSL 코드 작성
- **Include Files**: 외부 .ush 파일 참조
- **Input/Output Parameters**: Graph와 HLSL 간 데이터 교환
- **GPU/CPU 호환성**: GPU Simulation에서만 사용 가능

---

## 🧱 작성 방법

### 1. Custom HLSL Node 추가

**Niagara Module Script:**
1. Script Graph에서 우클릭
2. `Add Custom HLSL` 선택
3. HLSL 코드 입력

### 2. 기본 구조

```hlsl
// Input Parameters
float3 Position;
float3 Velocity;
float DeltaTime;

// HLSL Code
float3 NewPosition = Position + Velocity * DeltaTime;

// Output Parameters
Output.Position = NewPosition;
```

### 3. Include Files 사용

```hlsl
// External .ush file 참조
#include "/Plugin/FX/Niagara/Private/NiagaraQuaternionUtils.ush"

// Quaternion 회전 적용
float4 Rotation = MakeQuaternion(RotationAxis, RotationAngle);
float3 RotatedVector = RotateVectorByQuaternion(InputVector, Rotation);

Output.Result = RotatedVector;
```

---

## 💡 주요 사용 사례

### 예시 1: 복잡한 수학 연산

```hlsl
// Noise Function
float3 Position;
float Frequency;
float Amplitude;

// Perlin Noise (간단한 구현)
float noise = sin(Position.x * Frequency) * cos(Position.y * Frequency) * sin(Position.z * Frequency);
noise = noise * 0.5 + 0.5;  // [0, 1] 범위로 정규화

Output.NoiseValue = noise * Amplitude;
```

### 예시 2: GPU 최적화 연산

```hlsl
// SIMD-Optimized Vector Operations
float4 VectorA;
float4 VectorB;

// GPU는 float4 연산이 매우 빠름
float4 Result = VectorA * VectorB + float4(1, 1, 1, 1);

Output.Result = Result;
```

### 예시 3: Texture Sampling

```hlsl
// Texture2D 샘플링
Texture2D MyTexture;
SamplerState MySampler;
float2 UV;

// HLSL Texture Sample
float4 Color = MyTexture.Sample(MySampler, UV);

Output.Color = Color.rgb;
Output.Alpha = Color.a;
```

---

## ⚠️ 주의사항

### ❌ 피해야 할 것

**1. CPU Simulation에서 사용:**
```cpp
// ❌ Custom HLSL은 GPU Simulation에서만 작동
// CPU Emitter에서는 컴파일 에러!
```

**2. 너무 복잡한 코드:**
```hlsl
// ❌ Shader Instruction Limit 초과
for (int i = 0; i < 10000; ++i)  // GPU Timeout!
{
    // ...
}
```

**3. Undefined Behavior:**
```hlsl
// ❌ Uninitialized Variable
float SomeValue;
Output.Result = SomeValue;  // Undefined!
```

### ✅ 올바른 방법

**1. GPU Emitter 사용:**
```cpp
// ✅ Emitter Settings
SimTarget = GPUComputeSim
```

**2. 적절한 복잡도:**
```hlsl
// ✅ 간단하고 효율적인 코드
float3 Result = normalize(Input) * Length;
Output.Result = Result;
```

**3. 변수 초기화:**
```hlsl
// ✅ 항상 초기화
float SomeValue = 0.0;
Output.Result = SomeValue;
```

---

## 🔗 참조 자료

**HLSL 참조:**
- [Microsoft HLSL Reference](https://docs.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-reference)
- Unreal Engine Shader Files: `Engine/Shaders/`

**관련 문서:**
- [Script_Compilation.md](Script_Compilation.md) - HLSL 컴파일 과정

---

> 🔄 작성: 2025-11-22 — Custom HLSL Node 사용법
