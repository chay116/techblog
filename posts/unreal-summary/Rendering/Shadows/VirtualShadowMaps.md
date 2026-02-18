---
title: "Virtual Shadow Maps Deep Dive"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Shadows"]
---
# Virtual Shadow Maps Deep Dive

> 🔄 Created: 2025-11-22
>
> Virtual Shadow Maps의 핵심 알고리즘 - SMRT, Receiver Mask, HZB Culling 상세 분석

---

## 🧭 개요

**Virtual Shadow Maps (VSM)**은 Unreal Engine 5의 차세대 섀도우 시스템으로, 페이지 기반 가상 텍스처링과 Nanite 통합으로 메가스케일 섀도우를 효율적으로 렌더링합니다. 이 문서는 VSM의 핵심 알고리즘에 대한 상세 분석을 다룹니다.

### 핵심 기술

- **SMRT (Shadow Map Ray Tracing)**: 소프트 섀도우를 위한 효율적인 ray marching 알고리즘
- **Receiver Mask**: 페이지별 수신자 마스크로 불필요한 렌더링 최소화
- **HZB (Hierarchical Z-Buffer) Culling**: 페이지 단위 오클루전 컬링

---

## 🎯 SMRT (Shadow Map Ray Tracing) 알고리즘

### 개요

SMRT는 **exponential step marching**과 **slope-based extrapolation**을 결합하여 소프트 섀도우를 효율적으로 계산하는 알고리즘입니다. 전통적인 PCF보다 훨씬 적은 샘플로 고품질 soft shadow를 생성합니다.

### 핵심 아이디어

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      SMRT Ray Marching 과정                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Ray Origin (표면)           Shadow Map                                 │
│       ●                                                                 │
│       │\                     ┌────────┐                                │
│       │ \  Step 1            │▓▓▓▓▓▓▓▓│ Occluder                       │
│       │  \  (큰 스텝)        │▓▓▓▓▓▓▓▓│                                │
│       │   \                  └────────┘                                │
│       │    ● ← Sample 1 (Miss)                                         │
│       │     \                                                           │
│       │  Step 2\  (중간 스텝)                                           │
│       │         ● ← Sample 2 (Miss)                                    │
│       │          \                                                      │
│       │       Step 3 \ (작은 스텝)                                      │
│       │              ● ← Sample 3 (Hit!)                               │
│       │               │                                                 │
│       │               └─ 교차점 발견                                    │
│                                                                         │
│  Exponential Steps:                                                    │
│    SampleTime[i] = Pow2(TimeScale * i + TimeBias)                     │
│    - i=0: 1.0 (광원 근처, 큰 스텝)                                     │
│    - i=N: 0.0 (표면 근처, 작은 스텝)                                   │
│    - 지수 함수로 표면 근처 집중 샘플링                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### FSMRTSample 구조체

**📂 위치:** `Engine/Shaders/Private/VirtualShadowMaps/VirtualShadowMapSMRTCommon.ush:12`

```cpp
struct FSMRTSample
{
    bool bValid;                  // 샘플이 유효한 Physical Page에서 왔는지
    float SampleDepth;            // Shadow Map에서 샘플링한 깊이값
    float ReferenceDepth;         // Ray의 현재 위치 깊이 (항상 설정됨)
    float ExtrapolateSlope;       // Extrapolation에 사용할 최대 기울기
    bool bResetExtrapolation;     // Extrapolation 리셋 플래그
};
```

---

### SMRTRayCast 알고리즘 상세

**📂 위치:** `Engine/Shaders/Private/VirtualShadowMaps/VirtualShadowMapSMRTTemplate.ush:26`

```cpp
FSMRTResult SMRTRayCast(
    inout SMRT_TEMPLATE_RAY_STRUCT RayState,
    int NumSteps,           // 샘플링 횟수 (보통 8-16)
    float StepOffset)       // 초기 오프셋 (0~1)
{
    const float DepthHistoryNotSet = -10000.0f;
    float DepthHistory = DepthHistoryNotSet;     // 이전 유효 샘플의 깊이
    float DepthHistoryTime = -1.0f;              // 이전 유효 샘플의 시간
    float DepthSlope = 0;                        // 현재 추정된 깊이 기울기

    // Exponential time mapping: 표면에 가까울수록 조밀하게 샘플링
    const float TimeScale = -1.0f / NumSteps;
    const float TimeBias = 1.0f + (1.0 - StepOffset) * TimeScale;

    float PrevReferenceDepth = -1;

    for (int i = 0; i <= NumSteps; i++)
    {
        // 1. Exponential step 계산
        const float SampleTime = (i == NumSteps) ? 0 : Pow2(TimeScale * i + TimeBias);

        // 2. 해당 시간의 Shadow Map 샘플 가져오기
        FSMRTSample Sample = SMRTFindSample(RayState, SampleTime);
        const float ReferenceDepth = Sample.ReferenceDepth;

        if (Sample.bResetExtrapolation)
        {
            DepthSlope = Sample.ExtrapolateSlope;
        }

        if (Sample.bValid)
        {
            const float SampleDepth = Sample.SampleDepth;

            // 첫 번째 유효 샘플: 단순 깊이 비교
            if (DepthHistory == DepthHistoryNotSet)
            {
                DepthHistory = SampleDepth;
                DepthHistoryTime = SampleTime;

                if (SampleDepth > ReferenceDepth)
                {
                    // Hit! 그림자 안
                    FSMRTResult Result;
                    Result.bValidHit = true;
                    Result.HitDepth = SampleDepth;
                    return Result;
                }
            }
            else
            {
                // 두 번째 이후 샘플: Slope-based extrapolation 적용

                const float DeltaReferenceDepth = ReferenceDepth - PrevReferenceDepth;

                // 3. 수치 정밀도 문제 방지용 허용 오차
                const float EpsScale = 1.05f;
                const float CompareTolerance = abs(DeltaReferenceDepth) * EpsScale;

                const bool bBehind = (SampleDepth - ReferenceDepth) > CompareTolerance;
                float DepthForComparison = SampleDepth;

                float DeltaHistoryTime = SampleTime - DepthHistoryTime;

                if (bBehind)
                {
                    // 4. 뒤에 있을 때: 이전 기울기로 Extrapolate
                    #if SMRT_EXTRAPOLATE_SLOPE
                        DepthForComparison = DepthSlope * DeltaHistoryTime + DepthHistory;
                    #else
                        DepthForComparison = DepthHistory;
                    #endif
                }
                else
                {
                    // 5. 앞에 있을 때: 기울기 업데이트
                    if (SampleDepth != DepthHistory)
                    {
                        const float SlopeClamp = Sample.ExtrapolateSlope;
                        DepthSlope = (SampleDepth - DepthHistory) / DeltaHistoryTime;
                        DepthSlope = clamp(DepthSlope, -SlopeClamp, SlopeClamp);

                        DepthHistory = SampleDepth;
                        DepthHistoryTime = SampleTime;
                    }
                }

                // 6. Hit 판정
                float DepthDiff = ReferenceDepth - DepthForComparison;
                float HalfCompareTolerance = 0.5 * CompareTolerance;
                bool bHit = abs(DepthDiff + HalfCompareTolerance) < HalfCompareTolerance;

                if (bHit)
                {
                    FSMRTResult Result;
                    Result.bValidHit = true;
                    Result.HitDepth = DepthForComparison;
                    return Result;
                }
            }

            PrevReferenceDepth = ReferenceDepth;
        }
    }

    // 모든 샘플 Miss: 그림자 밖
    FSMRTResult Result;
    Result.bValidHit = false;
    Result.HitDepth = -1.0f;
    return Result;
}
```

---

### SMRT 알고리즘 단계별 설명

#### 1단계: Exponential Time Mapping

```cpp
SampleTime[i] = Pow2(TimeScale * i + TimeBias)

// NumSteps = 8일 때:
i=0: Time = 1.0       (광원 위치, Ray 끝)
i=1: Time = 0.841     (큰 스텝)
i=2: Time = 0.707     (중간 스텝)
i=3: Time = 0.594
i=4: Time = 0.5
i=5: Time = 0.420
i=6: Time = 0.353
i=7: Time = 0.297
i=8: Time = 0.0       (표면 위치, Ray 시작)
```

**설계 의도:**
- 표면 근처에서 더 많은 샘플 (정확한 교차점 검출)
- 광원 근처에서 적은 샘플 (멀리 있어서 덜 중요)

#### 2단계: Slope-Based Extrapolation

```
┌─────────────────────────────────────────────────────────────────────────┐
│              Slope Extrapolation 동작 원리                              │
│                                                                         │
│  Shadow Map Depth                                                       │
│      ▲                                                                  │
│      │    Sample 1                                                      │
│      │       ●                                                          │
│      │      ╱│                                                          │
│      │     ╱ │                                                          │
│      │    ╱  │← Slope 계산                                             │
│      │   ╱   │                                                          │
│      │  ● Sample 2                                                      │
│      │  │                                                               │
│      │  │  ● ← Extrapolated Position                                   │
│      │  │ ╱   (실제 샘플링 없이 추정)                                  │
│      │  │╱                                                              │
│      │  ● Sample 3 (실제 샘플링으로 검증)                              │
│      │                                                                  │
│      └──────────────────────────> Time                                 │
│                                                                         │
│  DepthSlope = (Sample2.Depth - Sample1.Depth) / DeltaTime             │
│  ExtrapolatedDepth = DepthHistory + DepthSlope * DeltaTime            │
└─────────────────────────────────────────────────────────────────────────┘
```

**효과:**
- 부드러운 표면에서 샘플 수 감소 가능
- 급격한 깊이 변화는 SlopeClamp로 제한
- 노이즈 감소

#### 3단계: Adaptive Multi-Ray Sampling

**📂 위치:** `Engine/Shaders/Private/VirtualShadowMaps/VirtualShadowMapProjectionDirectional.ush:175`

```cpp
FVirtualShadowMapSampleResult TraceDirectional(
    int VirtualShadowMapId,
    FLightShaderParameters Light,
    uint2 PixelPos,
    const float SceneDepth,
    float3 TranslatedWorldPosition,
    float RayStartOffset,
    const float Noise,
    float3 WorldNormal,
    const FSMRTTraceSettings Settings)
{
    // 여러 Ray 방향 샘플링 (Soft Shadow)
    for (int RayIndex = 0; RayIndex < Settings.RayCount; RayIndex++)
    {
        // 1. 랜덤 방향 생성 (Blue Noise 사용)
        float4 RandomSample = VirtualShadowMapGetRandomSample(PixelPos, FrameIndex, RayIndex, Settings.RayCount);
        float3 RayDir = GetRandomDirectionalLightRayDir(Light, RandomSample.xy);

        // 2. Clipmap 선택 (최적 해상도)
        FVirtualShadowMapHandle ClipmapHandle = GetMappedClipmap(VirtualShadowMapHandle, TranslatedWorldPosition, SceneDepth);

        // 3. Ray State 초기화
        FSMRTClipmapRayState RayState = SMRTClipmapRayInitialize(
            ProjectionData,
            RayOriginShadowTranslatedWorld,
            RayDir,
            RayLength,
            RayStartOffset,
            DepthSlopeUV,
            TexelOffset,
            Settings.ExtrapolateMaxSlope
        );

        // 4. SMRT Ray Cast 실행
        FSMRTResult SMRTResult = SMRTRayCast(RayState, Settings.SamplesPerRay, StepOffset);

        // 5. 결과 누적
        if (SMRTResult.bValidHit)
        {
            ShadowFactor += 0.0f;  // 그림자 안
        }
        else
        {
            ShadowFactor += 1.0f;  // 그림자 밖
        }
    }

    // 평균값 계산
    Result.ShadowFactor = ShadowFactor / float(Settings.RayCount);
    return Result;
}
```

---

### SMRT 파라미터

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/VirtualShadowMaps/VirtualShadowMapArray.h:193`

```cpp
BEGIN_GLOBAL_SHADER_PARAMETER_STRUCT(FVirtualShadowMapUniformParameters, )
    // SMRT parameters
    SHADER_PARAMETER(uint32, SMRTAdaptiveRayCount)              // Adaptive ray count (0=disable)
    SHADER_PARAMETER(int32, SMRTRayCountLocal)                  // Local lights ray count (4)
    SHADER_PARAMETER(int32, SMRTSamplesPerRayLocal)             // Samples per ray (8)
    SHADER_PARAMETER(float, SMRTExtrapolateMaxSlopeLocal)       // Max slope for extrapolation
    SHADER_PARAMETER(float, SMRTTexelDitherScaleLocal)          // Texel dithering scale
    SHADER_PARAMETER(float, SMRTMaxSlopeBiasLocal)              // Max slope bias
    SHADER_PARAMETER(float, SMRTCotMaxRayAngleFromLight)        // Max ray angle (cot)

    SHADER_PARAMETER(int32, SMRTRayCountDirectional)            // Directional lights ray count (8)
    SHADER_PARAMETER(int32, SMRTSamplesPerRayDirectional)       // Samples per ray (16)
    SHADER_PARAMETER(float, SMRTExtrapolateMaxSlopeDirectional) // Max slope
    SHADER_PARAMETER(float, SMRTTexelDitherScaleDirectional)    // Dithering
    SHADER_PARAMETER(float, SMRTRayLengthScale)                 // Ray length scaling
END_GLOBAL_SHADER_PARAMETER_STRUCT()
```

| 파라미터 | Directional Light | Local Light | 설명 |
|---------|-------------------|-------------|------|
| **RayCount** | 8 | 4 | 픽셀당 추적할 Ray 수 (소프트 섀도우 품질) |
| **SamplesPerRay** | 16 | 8 | Ray당 Shadow Map 샘플링 수 |
| **ExtrapolateMaxSlope** | 0.2 | 0.3 | 기울기 기반 Extrapolation 최대값 |
| **TexelDitherScale** | 1.0 | 1.0 | 텍셀 디더링 스케일 (앨리어싱 감소) |

---

## 🎭 Receiver Mask 시스템

### 개요

**Receiver Mask**는 각 Shadow Map 페이지에 대해 **어느 영역이 실제로 섀도우를 받는지** 기록하는 8×8 비트마스크입니다. 이를 통해 불필요한 영역의 렌더링을 건너뛸 수 있습니다.

### 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Receiver Mask 구조                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  각 VSM Page (128×128 픽셀) → 8×8 Receiver Mask (64 bits)              │
│                                                                         │
│  ┌────────────────────────────────────────────┐                        │
│  │       Shadow Map Page (128×128)            │                        │
│  │  ┌──┬──┬──┬──┬──┬──┬──┬──┐               │                        │
│  │  │16│16│16│16│16│16│16│16│               │                        │
│  │  ├──┼──┼──┼──┼──┼──┼──┼──┤               │                        │
│  │  │16│■│■│  │  │  │  │16│  ← 8×8 mask    │                        │
│  │  ├──┼──┼──┼──┼──┼──┼──┼──┤                 (각 셀 = 16×16 픽셀)   │
│  │  │16│■│■│■│  │  │  │16│                  │                        │
│  │  ├──┼──┼──┼──┼──┼──┼──┼──┤                 ■ = 섀도우 수신자 존재│
│  │  │16│  │■│■│  │  │  │16│                  │                        │
│  │  ├──┼──┼──┼──┼──┼──┼──┼──┤                                         │
│  │  │16│  │  │  │  │  │  │16│                                         │
│  │  ├──┼──┼──┼──┼──┼──┼──┼──┤                                         │
│  │  │16│  │  │  │  │  │  │16│                                         │
│  │  ├──┼──┼──┼──┼──┼──┼──┼──┤                                         │
│  │  │16│  │  │  │  │  │  │16│                                         │
│  │  ├──┼──┼──┼──┼──┼──┼──┼──┤                                         │
│  │  │16│16│16│16│16│16│16│16│                                         │
│  │  └──┴──┴──┴──┴──┴──┴──┴──┘                                         │
│  └────────────────────────────────────────────┘                        │
│                                                                         │
│  저장 방식: 4개의 uint (2×2 Quadrant)                                  │
│  - Quadrant [0,0]: bits  0-15 (상단 좌측 4×4)                         │
│  - Quadrant [1,0]: bits 16-31 (상단 우측 4×4)                         │
│  - Quadrant [0,1]: bits 32-47 (하단 좌측 4×4)                         │
│  - Quadrant [1,1]: bits 48-63 (하단 우측 4×4)                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Receiver Mask 마킹 알고리즘

**📂 위치:** `Engine/Shaders/Private/VirtualShadowMaps/VirtualShadowMapPageMarking.ush:71`

```cpp
void MarkPageReceiverMask(FVSMPageOffset PageOffset, uint2 VirtualAddress)
{
    // 1. 8×8 마스크 내 주소 계산 (128 → 8 = 16x 다운스케일)
    //    VSM_LOG2_PAGE_SIZE = 7 (128 = 2^7)
    //    VSM_LOG2_RECEIVER_MASK_SIZE = 3 (8 = 2^3)
    //    Shift = 7 - 3 = 4 (16 픽셀 per mask cell)
    uint2 MaskAddress = (VirtualAddress >> (VSM_LOG2_PAGE_SIZE - VSM_LOG2_RECEIVER_MASK_SIZE))
                       & VSM_RECEIVER_MASK_SUBMASK;  // 0-3 범위

    // 2. 2×2 Quadrant 계산 (상단/하단, 좌측/우측)
    uint2 MaskQuadrant = (VirtualAddress >> (VSM_LOG2_PAGE_SIZE - 1)) & 1u;

    // 3. Atomic OR로 비트 설정 (Thread-safe)
    //    각 Quadrant는 별도의 uint에 저장 (16 bits per quadrant)
    InterlockedOr(
        OutPageReceiverMasks[PageOffset.GetResourceAddress() * 2u + MaskQuadrant],
        1u << (MaskAddress.y * 4u + MaskAddress.x)
    );
}
```

### 사용 예시

```cpp
// Page 마킹 시 Receiver Mask도 함께 마킹
void MarkPage(
    FVirtualShadowMapHandle VirtualShadowMapHandle,
    uint MipLevel,
    float3 TranslatedWorldPosition,
    bool bUsePageDilation,
    float2 PageDilationOffset)
{
    // ... Shadow UV 계산 ...

    uint2 VirtualAddress = uint2(ShadowUVz.xy * CalcLevelDimsTexels(MipLevel));
    uint2 PageAddress = VirtualAddress >> VSM_LOG2_PAGE_SIZE;
    FVSMPageOffset PageOffset = CalcPageOffset(VirtualShadowMapHandle, MipLevel, PageAddress);

    // 1. Page 할당 플래그 설정
    MarkPageAddress(PageOffset, VSM_FLAG_ALLOCATED | VSM_FLAG_DETAIL_GEOMETRY);

    // 2. Receiver Mask 마킹 (ProjectionData 설정에 따라)
    BRANCH
    if (ProjectionData.bUseReceiverMask)
    {
        MarkPageReceiverMask(PageOffset, VirtualAddress);
    }
}
```

---

### Receiver Mask 최적화 효과

```
시나리오: 큰 바닥 평면 + 작은 캐릭터

Without Receiver Mask:
  ┌────────────────────────────┐
  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  ← 전체 렌더링 (25 pages)
  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
  │▓▓▓▓▓▓▓■▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  ■ = 캐릭터 (작음)
  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
  └────────────────────────────┘
  비용: 25 pages × 128×128 = 409,600 픽셀

With Receiver Mask:
  ┌────────────────────────────┐
  │░░░░░░░░░░░░░░░░░░░░░░░░░░│  ← 마스크된 영역 (렌더링 안 함)
  │░░░░░░░░░░░░░░░░░░░░░░░░░░│
  │░░░░░░░░░░░░░░░░░░░░░░░░░░│
  │░░░░░░▓■▓░░░░░░░░░░░░░░░░░│  ▓ = 실제 렌더링 (3 pages)
  │░░░░░░░░░░░░░░░░░░░░░░░░░░│
  └────────────────────────────┘
  비용: 3 pages × 128×128 = 49,152 픽셀
  절감: 88% 감소!
```

---

## 🔍 HZB (Hierarchical Z-Buffer) Culling

### 개요

**HZB**는 Shadow Map의 다단계 깊이 버퍼로, 페이지 단위로 구성됩니다. Nanite 렌더링 시 오클루전 컬링에 사용되어 보이지 않는 지오메트리의 렌더링을 건너뜁니다.

### HZB 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                 VSM HZB 피라미드 구조                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  각 Page는 독립적인 HZB 피라미드 보유 (7 levels)                        │
│                                                                         │
│  Level 0 (128×128, 원본)                                                │
│  ┌────────────────────────────────────────────────┐                    │
│  │ Full Resolution Depth                          │                    │
│  │ 각 픽셀 = Shadow Map 깊이값                    │                    │
│  └────────────────────────────────────────────────┘                    │
│                     ↓ 2×2 Max Reduction                                │
│  Level 1 (64×64)                                                        │
│  ┌──────────────────────────┐                                          │
│  │ Max(2×2 block)           │                                          │
│  └──────────────────────────┘                                          │
│                     ↓                                                   │
│  Level 2 (32×32)                                                        │
│  ┌──────────────┐                                                      │
│  │ Max(2×2)     │                                                      │
│  └──────────────┘                                                      │
│        ↓                                                                │
│  Level 3 (16×16)                                                        │
│  ┌──────┐                                                              │
│  │ Max  │                                                              │
│  └──────┘                                                              │
│     ↓                                                                   │
│  Level 4 (8×8)                                                          │
│  Level 5 (4×4)                                                          │
│  Level 6 (2×2)                                                          │
│  Level 7 (1×1) ← 전체 Page의 최대 깊이                                 │
│                                                                         │
│  총 7 Levels = Log2(128) = 7 (VSM_LOG2_PAGE_SIZE)                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### HZB 빌드 과정

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/VirtualShadowMaps/VirtualShadowMapArray.cpp:4350`

```cpp
// Level 0-4 빌드 (Base levels)
class FVirtualSmBuildHZBPerPageCS : public FVirtualShadowMapPageManagementShader
{
    static constexpr int32 HZBLevelsBase = 5;  // Build levels 0-4

    BEGIN_SHADER_PARAMETER_STRUCT(FParameters, )
        SHADER_PARAMETER_RDG_TEXTURE_SRV(Texture2DArray<uint>, ShadowDepthTexture)
        SHADER_PARAMETER_RDG_TEXTURE_UAV_ARRAY(RWTexture2DArray<float>, OutHZBPhysical, [HZBLevelsBase])
        // ... 기타 파라미터 ...
    END_SHADER_PARAMETER_STRUCT()
};

// Level 5-7 빌드 (Top levels)
class FVirtualSmBBuildHZBPerPageTopCS : public FVirtualShadowMapPageManagementShader
{
    static constexpr int32 HZBLevelsTop = 3;   // Build levels 5-7

    BEGIN_SHADER_PARAMETER_STRUCT(FParameters, )
        SHADER_PARAMETER_RDG_TEXTURE_UAV_ARRAY(RWTexture2DArray<float>, OutHZBPhysical, [HZBLevelsTop])
        // ... 기타 파라미터 ...
    END_SHADER_PARAMETER_STRUCT()
};
```

#### HZB 빌드 알고리즘 (Pseudo Code)

```hlsl
// Level 0 (128×128) → Shadow Map 직접 복사
HZB[0][x, y] = ShadowDepth[x, y]

// Level 1-7 (각 레벨은 이전 레벨의 2×2 max)
for (int level = 1; level <= 7; level++)
{
    int prevLevel = level - 1;
    int size = 128 >> level;  // 64, 32, 16, 8, 4, 2, 1

    for (int y = 0; y < size; y++)
    {
        for (int x = 0; x < size; x++)
        {
            // 2×2 블록의 최대값 (Conservative occlusion)
            float d0 = HZB[prevLevel][x*2 + 0, y*2 + 0];
            float d1 = HZB[prevLevel][x*2 + 1, y*2 + 0];
            float d2 = HZB[prevLevel][x*2 + 0, y*2 + 1];
            float d3 = HZB[prevLevel][x*2 + 1, y*2 + 1];

            HZB[level][x, y] = max(max(d0, d1), max(d2, d3));
        }
    }
}
```

---

### HZB Culling 사용

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/VirtualShadowMaps/VirtualShadowMapArray.cpp:3375`

```cpp
// Nanite 렌더링 시 HZB 파라미터 설정
BEGIN_SHADER_PARAMETER_STRUCT(FHZBShaderParameters, )
    SHADER_PARAMETER_RDG_TEXTURE(Texture2DArray, HZBTextureArray)
    SHADER_PARAMETER(FIntPoint, HZBSize)
END_SHADER_PARAMETER_STRUCT()

// Culling Pass에서 사용
if (HZBTextureArray)
{
    // HZB 기반 오클루전 컬링 활성화
    HZBShaderParameters.HZBTextureArray = HZBTextureArray;
    HZBShaderParameters.HZBSize = HZBTextureArray->Desc.Extent;

    // Nanite Cluster 컬링 시 HZB 테스트
    // - Cluster AABB를 Shadow Space로 투영
    // - HZB에서 해당 영역의 최대 깊이 쿼리
    // - Cluster 최소 깊이 > HZB 최대 깊이 → Occluded!
}
```

#### HZB Test 과정

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      HZB Occlusion Test                                 │
│                                                                         │
│  1. Cluster AABB 투영                                                   │
│     ┌────────┐                                                         │
│     │ Cluster│  → Shadow Space → Screen Rect (min/max UV)             │
│     └────────┘                                                         │
│                                                                         │
│  2. 적절한 HZB Level 선택                                               │
│     ScreenRect 크기에 맞는 레벨 (작으면 높은 레벨, 크면 낮은 레벨)     │
│                                                                         │
│  3. HZB 샘플링                                                          │
│     MaxDepth = HZB[level].Sample(ScreenRect)                           │
│                                                                         │
│  4. 비교                                                                │
│     if (Cluster.MinDepth > MaxDepth)                                   │
│     {                                                                   │
│         // Occluded! 렌더링 스킵                                       │
│         Cull();                                                         │
│     }                                                                   │
│     else                                                                │
│     {                                                                   │
│         // Visible, 렌더링 진행                                        │
│         Render();                                                       │
│     }                                                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔧 통합 파이프라인

### VSM 렌더링 전체 흐름

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   VSM 렌더링 파이프라인                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Page Marking (Screen Space)                                        │
│     ├─ 가시 픽셀에서 필요한 Shadow Map Page 마킹                       │
│     ├─ Receiver Mask 마킹 (섀도우 수신 위치 기록)                      │
│     └─ Mip Level 계산 (거리 기반)                                      │
│                                                                         │
│  2. Page Allocation                                                    │
│     ├─ 마킹된 Page들을 Physical Pool에 할당                            │
│     ├─ Temporal Caching (이전 프레임 재사용)                           │
│     └─ Page Table 업데이트 (Virtual → Physical 매핑)                   │
│                                                                         │
│  3. Nanite Rendering (Depth Pass)                                      │
│     ├─ HZB Culling (이전 프레임 HZB 사용)                              │
│     ├─ Receiver Mask Culling (마킹된 영역만 렌더링)                    │
│     ├─ Cluster 단위 렌더링                                             │
│     └─ Physical Page Pool에 Depth 기록                                │
│                                                                         │
│  4. HZB Build                                                           │
│     ├─ Level 0-4: Per-Page HZB 빌드 (Base)                             │
│     ├─ Level 5-7: Top levels 빌드                                      │
│     └─ 다음 프레임 Culling에 사용                                      │
│                                                                         │
│  5. Shadow Projection (Deferred Lighting)                              │
│     ├─ 각 픽셀에서 SMRT 실행                                           │
│     ├─ Multi-ray sampling (Soft Shadow)                                │
│     ├─ Slope-based extrapolation                                       │
│     └─ Shadow Factor 계산 (0=그림자, 1=빛)                             │
│                                                                         │
│  6. Temporal Accumulation (Optional)                                   │
│     └─ 이전 프레임 결과와 블렌딩 (노이즈 감소)                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ 성능 특성

### 비용 분석 (1080p, Nanite Scene)

| 단계 | GPU 시간 | 설명 |
|------|----------|------|
| **Page Marking** | ~0.3ms | Screen-space marking, Receiver Mask |
| **Page Allocation** | ~0.1ms | Virtual-to-physical mapping |
| **Nanite Depth Pass** | ~2-4ms | HZB+Receiver Mask culling |
| **HZB Build** | ~0.2ms | 7-level pyramid per page |
| **Shadow Projection (SMRT)** | ~1-3ms | 8 rays × 16 samples |
| **총 비용** | **~3.6-7.6ms** | 단일 Directional Light 기준 |

### SMRT vs PCF 비교

| 방식 | 샘플 수 | 품질 | 비용 |
|------|---------|------|------|
| **PCF 3×3** | 9 taps | 낮음 (Hard edge) | ~0.5ms |
| **PCF 5×5 Poisson** | 25 taps | 중간 | ~1.2ms |
| **SMRT (8×16)** | 128 logical taps | 높음 (Soft, Adaptive) | ~1.5ms |
| **효율** | - | **SMRT가 2배 효율적** | - |

---

## ⚠️ 최적화 팁

### ✅ 해야 할 것

**1. SMRT Ray Count 조정**
```cpp
r.Shadow.Virtual.SMRT.RayCountDirectional 8    // 기본값 (Balanced)
// 고품질: 16 (2배 비용)
// 저품질: 4 (절반 비용, 노이즈 증가)
```

**2. Receiver Mask 활성화**
```cpp
r.Shadow.Virtual.ReceiverMask 1  // 기본 활성화
// 대규모 오픈 월드에서 80% 이상 절감 효과
```

**3. HZB Culling 사용**
```cpp
r.Shadow.Virtual.HZBCulling 1    // Nanite와 함께 사용 시 50%+ 절감
```

**4. Samples Per Ray 조정**
```cpp
r.Shadow.Virtual.SMRT.SamplesPerRayDirectional 16  // 기본값
// 먼 거리: 8로 감소 (품질 손실 적음)
```

### ❌ 피해야 할 것

**1. 과도한 Ray Count**
```cpp
r.Shadow.Virtual.SMRT.RayCountDirectional 32  // ❌ 극심한 성능 저하 (4배 비용)
// 보통 8-16으로 충분
```

**2. Receiver Mask 비활성화**
```cpp
r.Shadow.Virtual.ReceiverMask 0   // ❌ 불필요한 렌더링 증가
// 특별한 이유 없이 비활성화하지 말 것
```

**3. 불필요한 Resolution Bias**
```cpp
r.Shadow.Virtual.ResolutionLodBiasDirectional 0  // 기본값
// 음수 값: 과도한 메모리/성능 비용
// 양수 값: 품질 저하
```

---

## 🐛 디버깅 팁

### 비주얼라이제이션

```cpp
// SMRT Ray 시각화
r.Shadow.Virtual.Visualize 1
r.Shadow.Virtual.VisualizeMode 2  // SMRT Rays

// Receiver Mask 확인
r.Shadow.Virtual.VisualizeMode 5  // Receiver Mask Density

// HZB 레벨 확인
r.Shadow.Virtual.VisualizeMode 6  // HZB Levels
```

### 일반적인 문제

**문제: 그림자가 너무 거침 (Hard Edge)**
- **원인**: SMRT Ray Count 너무 낮음
- **해결**: `r.Shadow.Virtual.SMRT.RayCountDirectional` 증가 (8 → 16)

**문제: 그림자에 노이즈 발생**
- **원인**: Samples Per Ray 부족
- **해결**: `r.Shadow.Virtual.SMRT.SamplesPerRayDirectional` 증가 (16 → 24)

**문제: 그림자가 너무 연함 (Light Leak)**
- **원인**: ExtrapolateMaxSlope 과다
- **해결**: `r.Shadow.Virtual.SMRT.ExtrapolateMaxSlopeDirectional` 감소 (0.3 → 0.1)

**문제: Nanite 지오메트리가 섀도우에 안 나타남**
- **원인**: HZB Culling 과다
- **해결**: Normal Bias 조정 또는 `r.Shadow.Virtual.NormalBias` 확인

---

## 📚 참조 자료

### 소스 파일

| 파일 | 설명 |
|------|------|
| `VirtualShadowMapSMRTTemplate.ush:26` | SMRT 핵심 알고리즘 |
| `VirtualShadowMapSMRTCommon.ush:12` | SMRT 구조체 및 유틸리티 |
| `VirtualShadowMapProjectionDirectional.ush:175` | Directional Light SMRT 통합 |
| `VirtualShadowMapPageMarking.ush:71` | Receiver Mask 마킹 |
| `VirtualShadowMapArray.cpp:4350` | HZB 빌드 Compute Shader |
| `VirtualShadowMapArray.h:193` | SMRT 파라미터 구조체 |

### 콘솔 변수

```cpp
// SMRT
r.Shadow.Virtual.SMRT.RayCountDirectional 8                // Directional light ray count
r.Shadow.Virtual.SMRT.RayCountLocal 4                      // Local light ray count
r.Shadow.Virtual.SMRT.SamplesPerRayDirectional 16          // Samples per ray
r.Shadow.Virtual.SMRT.ExtrapolateMaxSlopeDirectional 0.2   // Max slope for extrapolation

// Receiver Mask
r.Shadow.Virtual.ReceiverMask 1                            // Enable receiver mask optimization

// HZB
r.Shadow.Virtual.HZBCulling 1                              // Enable HZB culling
r.Shadow.Virtual.NormalBias 0.5                            // Normal bias for shadow projection

// Visualization
r.Shadow.Virtual.Visualize 1                               // Enable visualization
r.Shadow.Virtual.VisualizeMode 0-7                         // Various visualization modes
```

### 관련 문서

- **Virtual Shadow Maps Overview**: 전체 시스템 개요
- **Nanite Advanced**: Nanite + VSM 통합
- **Lumen Optimization**: Lumen + VSM 조합 최적화

---

> **핵심 요약:**
> - **SMRT**: Exponential step + Slope extrapolation으로 효율적 soft shadow (8 rays × 16 samples)
> - **Receiver Mask**: 8×8 비트마스크로 불필요한 렌더링 80% 절감
> - **HZB Culling**: 7-level 피라미드로 Nanite 오클루전 컬링 50% 절감
> - 총 비용: ~3.6-7.6ms (1080p, 단일 Directional Light)
> - Nanite와의 통합으로 메가스케일 고품질 섀도우 실현
