---
title: "Post Process Pipeline Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Pipeline"]
engine_version: "Unreal Engine 5.7"
---
# Post Process Pipeline Deep Dive

## 🧭 개요

**Post Process**는 렌더링된 이미지에 후처리 효과를 적용하여 시각적 품질을 향상시킵니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Bloom** | 밝은 영역 번짐 효과 |
| **DOF** | Depth of Field (피사계 심도) |
| **Motion Blur** | 움직임 블러 |
| **TAA** | Temporal Anti-Aliasing (시간적 안티앨리어싱) |
| **Tonemapping** | HDR → LDR 변환 (ACES, Uncharted 2) |
| **Color Grading** | LUT 기반 색보정 |

---

## 🏗️ Post Process Pipeline (렌더링 순서)

```
Scene Rendering (HDR, Float16)
    ↓
┌─────────────────────────────────────────────────────────┐
│ 1. TAA (Temporal Anti-Aliasing)                         │
├─────────────────────────────────────────────────────────┤
│   - Reproject Previous Frame                            │
│   - Blend with Current Frame (Jitter + Accumulation)    │
│   - Result: Smooth edges, reduced aliasing              │
└──────────────────────┼───────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│ 2. Motion Blur                                          │
├─────────────────────────────────────────────────────────┤
│   - Velocity Buffer (Screen-space Motion Vectors)       │
│   - Per-Pixel Blur along Motion Direction               │
└──────────────────────┼───────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│ 3. Depth of Field (DOF)                                 │
├─────────────────────────────────────────────────────────┤
│   - Gaussian DOF (Fast, Low Quality)                    │
│   - Bokeh DOF (Slow, High Quality, Hexagon Bokeh)       │
│   - Circle of Confusion (CoC) based on Depth            │
└──────────────────────┼───────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│ 4. Bloom                                                │
├─────────────────────────────────────────────────────────┤
│   - Extract Bright Pixels (Threshold > 1.0)             │
│   - Downsampled Blur (5 levels, Gaussian)               │
│   - Upsample + Composite                                │
└──────────────────────┼───────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│ 5. Tonemapping                                          │
├─────────────────────────────────────────────────────────┤
│   - HDR (Float16) → LDR (8-bit)                         │
│   - ACES Filmic Curve (Default)                         │
│   - Exposure Adjustment                                 │
└──────────────────────┼───────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│ 6. Color Grading (LUT)                                  │
├─────────────────────────────────────────────────────────┤
│   - 3D LUT (32×32×32 Texture)                           │
│   - Saturation, Contrast, Gamma adjustment              │
└──────────────────────┼───────────────────────────────────┘
                       ↓
Final Image (sRGB, 8-bit)
```

---

## 🌟 Bloom

```cpp
// Bloom Settings
PostProcessVolume->Settings.bOverride_BloomIntensity = true;
PostProcessVolume->Settings.BloomIntensity = 1.0f;  // 강도 (Default: 0.675)

PostProcessVolume->Settings.bOverride_BloomThreshold = true;
PostProcessVolume->Settings.BloomThreshold = 1.0f;  // 밝기 임계값 (>1.0만 Bloom)

// Bloom 알고리즘:
// 1. Extract Bright Pixels
if (SceneColor.rgb > BloomThreshold)
{
    BrightColor = SceneColor.rgb;
}

// 2. Downsampled Blur (5 Levels)
for (int i = 0; i < 5; ++i)
{
    BloomTexture[i] = GaussianBlur(BloomTexture[i - 1], DownsampleFactor=2);
}

// 3. Upsample + Composite
for (int i = 4; i >= 0; --i)
{
    BloomTexture[i] += Upsample(BloomTexture[i + 1]) * 0.5;
}

FinalColor = SceneColor + BloomTexture[0] * BloomIntensity;
```

---

## 📷 Depth of Field (DOF)

```cpp
// DOF Settings
PostProcessVolume->Settings.bOverride_DepthOfFieldFocalDistance = true;
PostProcessVolume->Settings.DepthOfFieldFocalDistance = 500.0f;  // cm

PostProcessVolume->Settings.bOverride_DepthOfFieldFstop = true;
PostProcessVolume->Settings.DepthOfFieldFstop = 2.8f;  // Aperture (작을수록 얕은 심도)

// Circle of Confusion (CoC) 계산:
float FocalLength = 50.0f;  // mm
float FocalDistance = 500.0f;  // cm
float Aperture = FocalLength / Fstop;  // mm

for each pixel:
{
    float PixelDepth = SceneDepth(pixel);
    float CoC = Aperture * abs(PixelDepth - FocalDistance) / (PixelDepth * (FocalDistance - FocalLength));

    if (CoC > 0.01)
    {
        // Blur this pixel (Bokeh or Gaussian)
        BlurredColor = SampleNeighbors(pixel, CoC);
    }
}
```

**DOF 타입:**
- **Gaussian DOF**: 빠름 (~1ms), 단순 블러
- **Bokeh DOF**: 느림 (~5ms), 사실적인 Hexagon Bokeh

---

## 🏃 Motion Blur

```cpp
// Motion Blur Settings
PostProcessVolume->Settings.bOverride_MotionBlurAmount = true;
PostProcessVolume->Settings.MotionBlurAmount = 0.5f;  // 0~1

PostProcessVolume->Settings.bOverride_MotionBlurMax = true;
PostProcessVolume->Settings.MotionBlurMax = 100.0f;  // Max blur distance (pixels)

// Velocity Buffer 생성:
// - Previous Frame Transform vs Current Frame Transform
// - Per-Object Motion Vectors

// Shader:
float2 Velocity = VelocityBuffer[pixel];  // Screen-space motion vector
float3 BlurredColor = 0;

const int SampleCount = 8;
for (int i = 0; i < SampleCount; ++i)
{
    float t = (i / float(SampleCount)) - 0.5;  // -0.5 ~ 0.5
    float2 SampleUV = UV + Velocity * t * MotionBlurAmount;
    BlurredColor += SceneColor.Sample(SampleUV);
}

FinalColor = BlurredColor / SampleCount;
```

---

## 🎨 Tonemapping & Color Grading

### Tonemapping (HDR → LDR)

```cpp
// ACES Filmic Curve (Default)
float3 ACESFilmic(float3 x)
{
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    return saturate((x * (a * x + b)) / (x * (c * x + d) + e));
}

// Tonemapping with Exposure
float3 TonemappedColor = ACESFilmic(SceneColor * Exposure);
```

### Color Grading (LUT)

```cpp
// 3D LUT (32×32×32)
Texture3D ColorGradingLUT;

float3 LUTCoord = saturate(TonemappedColor);  // 0~1
float3 GradedColor = ColorGradingLUT.SampleLevel(Sampler, LUTCoord, 0).rgb;
```

---

## 🔧 TAA (Temporal Anti-Aliasing)

```cpp
// TAA Pipeline:
// 1. Jitter Camera (Sub-pixel offset)
FVector2D Jitter = HaltonSequence(FrameIndex);  // -0.5 ~ 0.5
ProjectionMatrix = AddJitter(ProjectionMatrix, Jitter);

// 2. Reproject Previous Frame
float2 Velocity = VelocityBuffer[pixel];
float2 PrevUV = UV - Velocity;
float3 PrevColor = PreviousFrame.Sample(PrevUV);

// 3. Blend Current + Previous
float3 CurrentColor = SceneColor[pixel];
float BlendFactor = 0.1;  // 90% history, 10% current

// Clamp history to neighborhood (avoid ghosting)
float3 AABBMin, AABBMax;
ComputeNeighborhoodAABB(pixel, AABBMin, AABBMax);
PrevColor = clamp(PrevColor, AABBMin, AABBMax);

float3 FinalColor = lerp(PrevColor, CurrentColor, BlendFactor);
```

---

## 📊 성능

**1080p Post Process:**

| Effect | GPU Time |
|--------|----------|
| **TAA** | ~1ms |
| **Motion Blur** | ~1ms |
| **DOF (Gaussian)** | ~1ms |
| **DOF (Bokeh)** | ~5ms |
| **Bloom** | ~2ms |
| **Tonemapping** | ~0.5ms |
| **Total (No Bokeh)** | ~5.5ms |

---

## 🔗 참고 자료

**소스:**
- `Renderer/Private/PostProcess/`
- `Shaders/Private/PostProcessBloom.usf`
- `Shaders/Private/PostProcessDOF.usf`

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Post Process Pipeline