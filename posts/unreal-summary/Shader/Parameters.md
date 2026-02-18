---
title: "Shader Parameters 및 Uniform Buffer"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Shader"
tags: ["unreal", "Shader"]
---
# Shader Parameters 및 Uniform Buffer

## 🧭 개요 (Overview)

Unreal Engine의 **Shader Parameter 시스템**은 **CPU에서 GPU로 데이터를 전송**하는 메커니즘입니다. 이 시스템은 **Uniform Buffer**, **Texture/Sampler**, **Loose Parameter**를 통해 다양한 형태의 데이터를 효율적으로 관리합니다.

**핵심 개념:**
- **Uniform Buffer**: 구조화된 상수 데이터 (View, Material, Primitive 등)
- **Shader Resource (SRV)**: Texture, Buffer 등의 읽기 전용 리소스
- **Loose Parameter**: 개별 Scalar/Vector 파라미터
- **FShaderParameterMapInfo**: 컴파일 시 생성되는 Parameter 바인딩 정보

**📂 위치:**
- `Engine/Source/Runtime/RenderCore/Public/ShaderParameters.h`
- `Engine/Source/Runtime/RenderCore/Public/ShaderParameterMetadata.h`
- `Engine/Source/Runtime/RHI/Public/RHIResources.h`

---

## 🧱 Parameter 타입 (Parameter Types)

### 계층 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   FShaderParameterMapInfo                               │
│  (Shader 컴파일 시 생성되는 Parameter 바인딩 정보)                        │
├─────────────────────────────────────────────────────────────────────────┤
│  - UniformBuffers: TArray<FShaderUniformBufferParameterInfo>            │
│  - TextureSamplers: TArray<FShaderResourceParameterInfo>                │
│  - SRVs: TArray<FShaderResourceParameterInfo>                           │
│  - LooseParameterBuffers: TArray<FShaderLooseParameterBufferInfo>       │
└─────────────────────────────────────────────────────────────────────────┘
              ▲                    ▲                    ▲
              │                    │                    │
    ┌─────────┴─────────┐  ┌──────┴──────┐  ┌─────────┴─────────┐
    │                   │  │             │  │                   │
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────┐
│ Uniform Buffer  │ │ Texture/Sampler │ │ Loose Parameter     │
│                 │ │                 │ │                     │
│ 예시:           │ │ 예시:           │ │ 예시:               │
│ - View UB       │ │ - BaseColor Tex │ │ - float Time        │
│ - Material UB   │ │ - Normal Tex    │ │ - float3 Color      │
│ - Primitive UB  │ │ - Sampler State │ │ - int Count         │
└─────────────────┘ └─────────────────┘ └─────────────────────┘
```

**소스 검증:**

```cpp
// Shader.h:289-313
class FShaderParameterMapInfo
{
public:
    // Uniform Buffer 목록
    TMemoryImageArray<FShaderUniformBufferParameterInfo> UniformBuffers;

    // Texture + Sampler 목록
    TMemoryImageArray<FShaderResourceParameterInfo> TextureSamplers;

    // Shader Resource View (Texture, Buffer 등)
    TMemoryImageArray<FShaderResourceParameterInfo> SRVs;

    // 개별 Parameter (float, int 등)
    TMemoryImageArray<FShaderLooseParameterBufferInfo> LooseParameterBuffers;

    // 빠른 비교를 위한 해시
    uint64 Hash;
};
```

---

## 🧩 Uniform Buffer 시스템

### 1. Uniform Buffer 정의

Uniform Buffer는 **구조화된 상수 데이터**를 GPU에 전송하는 방법입니다.

**정의 매크로:**

```cpp
// View Uniform Buffer 정의
BEGIN_GLOBAL_SHADER_PARAMETER_STRUCT(FViewUniformShaderParameters, ENGINE_API)
    // 카메라 Transform
    SHADER_PARAMETER(FMatrix44f, ViewToClip)
    SHADER_PARAMETER(FMatrix44f, ClipToView)
    SHADER_PARAMETER(FMatrix44f, WorldToView)
    SHADER_PARAMETER(FMatrix44f, ViewToWorld)

    // 카메라 위치
    SHADER_PARAMETER(FVector3f, ViewOrigin)
    SHADER_PARAMETER(FVector3f, ViewForward)

    // 화면 해상도
    SHADER_PARAMETER(FVector2f, ViewSizeAndInvSize)

    // 시간
    SHADER_PARAMETER(float, GameTime)
    SHADER_PARAMETER(float, RealTime)
    SHADER_PARAMETER(float, DeltaTime)

    // Scene Textures
    SHADER_PARAMETER_RDG_TEXTURE(Texture2D, SceneColorTexture)
    SHADER_PARAMETER_RDG_TEXTURE(Texture2D, SceneDepthTexture)
END_SHADER_PARAMETER_STRUCT()
```

**HLSL에서 사용:**

```hlsl
// Shader에서 자동으로 바인딩됨
void MainPS()
{
    // View Uniform Buffer 접근
    float3 CameraPos = View.ViewOrigin;
    float Time = View.GameTime;

    float4x4 ViewToWorld = View.ViewToWorld;
    float3 WorldPos = mul(float4(LocalPos, 1.0f), ViewToWorld).xyz;
}
```

---

### 2. Uniform Buffer 생성 및 바인딩 (Runtime)

```cpp
// CPU 측: Uniform Buffer 데이터 준비
FViewUniformShaderParameters ViewParameters;
ViewParameters.ViewToClip = View.ViewMatrices.GetProjectionMatrix();
ViewParameters.ViewOrigin = View.ViewLocation;
ViewParameters.GameTime = View.Family->Time.GetWorldTimeSeconds();

// Uniform Buffer 생성 (RHI)
TUniformBufferRef<FViewUniformShaderParameters> ViewUniformBuffer =
    TUniformBufferRef<FViewUniformShaderParameters>::CreateUniformBufferImmediate(
        ViewParameters,
        UniformBuffer_SingleFrame  // 매 프레임 갱신
    );

// Shader에 바인딩
FRHIBatchedShaderParameters& BatchedParameters = RHICmdList.GetScratchShaderParameters();
SetUniformBufferParameter(BatchedParameters, PixelShader->GetUniformBufferParameter<FViewUniformShaderParameters>(), ViewUniformBuffer);
RHICmdList.SetBatchedShaderParameters(PixelShader.GetPixelShader(), BatchedParameters);
```

---

### 3. 주요 Uniform Buffer 종류

| Uniform Buffer 타입           | 갱신 주기       | 크기    | 용도                              |
|------------------------------|---------------|---------|-----------------------------------|
| **FViewUniformShaderParameters** | 매 View      | ~1 KB   | 카메라 Transform, 시간, 화면 크기   |
| **FPrimitiveUniformShaderParameters** | Object별 | ~512 B  | Object Transform, Bounds         |
| **FMaterialUniformBuffer**   | Material별    | ~2 KB   | Material 파라미터 (Texture, Scalar)|
| **FSceneTextureUniformParameters** | 매 프레임 | ~256 B  | GBuffer Texture 참조              |

---

## 💡 Parameter 바인딩 프로세스 (Binding Process)

### 컴파일 시 (Compile Time)

```
.usf Shader Source
      ↓
[Shader Compiler]
      ↓
Reflection Data 생성
  - Uniform Buffer: View (Slot 0)
  - Texture: BaseColorTexture (Slot 1)
  - Sampler: BaseColorSampler (Slot 2)
  - Loose: float Time (Offset 0)
      ↓
FShaderParameterMapInfo 저장
```

**소스 검증:**

```cpp
// Shader.h:144-174 - Parameter Info 클래스들
class FShaderUniformBufferParameterInfo
{
public:
    uint16 BaseIndex;  // Uniform Buffer Slot (0, 1, 2...)
};

class FShaderResourceParameterInfo
{
public:
    uint16 BaseIndex;           // Resource Slot
    uint8 BufferIndex;          // Buffer Index
    EShaderParameterType Type;  // Texture, Buffer, Sampler 등
};
```

---

### 런타임 (Runtime)

```
    CPU (C++)                        GPU (Shader)
         │                                │
         │  1. Uniform Buffer 준비         │
         │     ViewParameters.ViewOrigin   │
         │     = CameraPosition;           │
         │                                │
         │  2. RHI Uniform Buffer 생성     │
         │     CreateUniformBuffer()       │
         │                                │
         │  3. Shader에 바인딩              │
         │     SetUniformBufferParameter() │
         ├────────────────────────────────>│
         │                                │ 4. Shader 실행
         │                                │    float3 Pos = View.ViewOrigin;
         │                                │
```

---

## 🔗 실전 예시 (Practical Examples)

### 예시 1: Custom Uniform Buffer 정의

```cpp
// MyCustomParameters.h
BEGIN_GLOBAL_SHADER_PARAMETER_STRUCT(FMyCustomParameters, ENGINE_API)
    SHADER_PARAMETER(FVector3f, CustomColor)
    SHADER_PARAMETER(float, CustomIntensity)
    SHADER_PARAMETER_TEXTURE(Texture2D, CustomTexture)
    SHADER_PARAMETER_SAMPLER(SamplerState, CustomSampler)
END_SHADER_PARAMETER_STRUCT()

// IMPLEMENT_GLOBAL_SHADER_PARAMETER_STRUCT을 .cpp에서 호출
IMPLEMENT_GLOBAL_SHADER_PARAMETER_STRUCT(FMyCustomParameters, "MyCustomUB");
```

**HLSL에서 사용:**

```hlsl
// MyShader.usf
#include "/Engine/Private/Common.ush"

// 자동으로 생성된 Uniform Buffer
// cbuffer MyCustomUB
// {
//     float3 CustomColor;
//     float CustomIntensity;
// };
// Texture2D CustomTexture;
// SamplerState CustomSampler;

void MainPS(
    in float2 UV : TEXCOORD0,
    out float4 OutColor : SV_Target0
)
{
    float4 TexColor = CustomTexture.Sample(CustomSampler, UV);
    OutColor = TexColor * float4(MyCustomUB.CustomColor, 1.0f) * MyCustomUB.CustomIntensity;
}
```

**Runtime 바인딩:**

```cpp
// Render Thread에서 실행
FMyCustomParameters CustomParams;
CustomParams.CustomColor = FVector3f(1.0f, 0.5f, 0.2f);
CustomParams.CustomIntensity = 2.0f;
CustomParams.CustomTexture = MyTexture->GetResource()->TextureRHI;
CustomParams.CustomSampler = TStaticSamplerState<SF_Bilinear>::GetRHI();

TUniformBufferRef<FMyCustomParameters> CustomUB =
    TUniformBufferRef<FMyCustomParameters>::CreateUniformBufferImmediate(
        CustomParams,
        UniformBuffer_SingleFrame
    );

SetUniformBufferParameter(BatchedParameters, Shader->GetUniformBufferParameter<FMyCustomParameters>(), CustomUB);
```

---

### 예시 2: Shader에서 Material Parameter 접근

```cpp
// Material Shader에서 Material Uniform Buffer 접근
class FMyMaterialShader : public FMaterialShader
{
public:
    void SetParameters(
        FRHIBatchedShaderParameters& BatchedParameters,
        const FMaterialRenderProxy* MaterialRenderProxy,
        const FMaterial& Material
    )
    {
        // Material Uniform Buffer 자동 바인딩
        FMaterialShader::SetParameters(BatchedParameters, MaterialRenderProxy, Material, View);
    }
};
```

**HLSL에서 Material Parameter 사용:**

```hlsl
// MaterialTemplate.ush가 자동 생성됨
float3 GetMaterialBaseColor(FMaterialPixelParameters Parameters)
{
    // Material Uniform Buffer에서 Texture 참조
    float4 TexColor = Texture2DSample(Material.BaseColorTexture, Material.BaseColorSampler, Parameters.TexCoords[0]);

    // Scalar Parameter 참조
    float Brightness = Material.ScalarParameter_Brightness;

    return TexColor.rgb * Brightness;
}
```

---

## ⚠️ 성능 고려사항 (Performance Considerations)

### ✅ 좋은 예

```cpp
// 1. Uniform Buffer 재사용
// 매 프레임 동일한 데이터 → Uniform Buffer 재사용
TUniformBufferRef<FViewUniformShaderParameters> CachedViewUB;

if (!CachedViewUB.IsValid() || ViewChanged)
{
    CachedViewUB = CreateUniformBuffer(ViewParameters);
}

// 2. SingleFrame vs MultiFrame 선택
// 매 프레임 변경 → SingleFrame
TUniformBufferRef<FViewUniformShaderParameters>::CreateUniformBufferImmediate(
    ViewParameters,
    UniformBuffer_SingleFrame  // 다음 프레임에 자동 해제
);

// 불변 데이터 → MultiFrame
TUniformBufferRef<FStaticParameters>::CreateUniformBufferImmediate(
    StaticParams,
    UniformBuffer_MultiFrame  // 명시적으로 해제하기 전까지 유지
);
```

---

### ❌ 나쁜 예

```cpp
// 1. 매 Draw Call마다 Uniform Buffer 재생성 (비효율)
for (int32 i = 0; i < 1000; ++i)
{
    TUniformBufferRef<FMyParams> UB = CreateUniformBufferImmediate(...);  // ⚠️ 매우 느림
    DrawMesh(UB);
}

// 2. 큰 Uniform Buffer (> 64 KB)
BEGIN_GLOBAL_SHADER_PARAMETER_STRUCT(FHugeBuffer, ENGINE_API)
    SHADER_PARAMETER_ARRAY(FMatrix44f, Matrices, [10000])  // ⚠️ 640 KB - GPU 메모리 낭비
END_SHADER_PARAMETER_STRUCT()

// 3. Loose Parameter 남용
// Uniform Buffer로 묶는 것이 더 효율적
SHADER_PARAMETER(float, Param1)
SHADER_PARAMETER(float, Param2)
SHADER_PARAMETER(float, Param3)
// ... 수십 개의 개별 Parameter (비효율)
```

---

## 🔗 참고 자료 (References)

### 소스 코드
- `Engine/Source/Runtime/RenderCore/Public/ShaderParameters.h`
- `Engine/Source/Runtime/RenderCore/Public/ShaderParameterMetadata.h`
- `Engine/Source/Runtime/RHI/Public/RHIResources.h`

### 커뮤니티 자료
- [Shader Resource Binding (UE5)](https://scahp.tistory.com/80) - UniformBuffer 정의 및 바인딩

---

> 🔄 **작성일**: 2025-01-04
> 📝 **문서 버전**: v1.0
> ✅ **소스 검증**: UE 5.6 Release
