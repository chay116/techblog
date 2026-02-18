---
title: "Volumetric Fog & Clouds Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Effects"]
engine_version: "Unreal Engine 5.7"
---
# Volumetric Fog & Clouds Deep Dive

## 🧭 개요

**Volumetric Fog**는 3D 공간에서 빛과 안개의 상호작용을 시뮬레이션하여 사실적인 대기 효과를 제공합니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Froxel** | Frustum Voxel (카메라 절두체를 3D 그리드로 분할) |
| **Ray Marching** | 광선을 따라 샘플링하여 안개 밀도 적분 |
| **Scattering** | 빛의 산란 (Mie, Rayleigh) |
| **Temporal Reprojection** | 이전 프레임 재사용 (성능 최적화) |
| **Volumetric Clouds** | GPU-driven 구름 시뮬레이션 (Weather System) |

---

## 🏗️ Volumetric Fog Pipeline

```
┌─────────────────────────────────────────────────────────┐
│           Phase 1: Voxelization (Froxel Grid)           │
├─────────────────────────────────────────────────────────┤
│  Camera Frustum → 3D Grid (64×64×128 Froxels)          │
│    - Near: 0.1m → Far: 10,000m (Exponential Depth)    │
│    - Each Froxel: Density, Albedo, Emissive           │
└──────────────────────┼───────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│         Phase 2: Light Injection (Compute Shader)       │
├─────────────────────────────────────────────────────────┤
│  For Each Light:                                        │
│    - Directional Light: Cascaded Shadow Maps           │
│    - Point/Spot Light: Shadow Map Projection           │
│    - Light Scattering: Phase Function (Henyey-Greenstein)│
│                                                         │
│  Output: 3D Texture (Scattered Light Intensity)        │
└──────────────────────┼───────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│      Phase 3: Integration (Ray Marching)                │
├─────────────────────────────────────────────────────────┤
│  For Each Pixel:                                        │
│    Ray = Camera → Pixel Direction                       │
│    Transmittance = 1.0                                  │
│    ScatteredLight = 0.0                                 │
│                                                         │
│    For Each Froxel along Ray:                          │
│      Density = SampleFroxel(Position)                   │
│      Transmittance *= exp(-Density * StepSize)          │
│      ScatteredLight += Transmittance * LightScatter     │
│                                                         │
│  FinalColor = SceneColor * Transmittance + ScatteredLight│
└─────────────────────────────────────────────────────────┘
```

---

## 🌫️ Volumetric Fog 설정

### Blueprint/C++ 설정

```cpp
// Exponential Height Fog (기본 안개)
AExponentialHeightFog* Fog = GetWorld()->SpawnActor<AExponentialHeightFog>();
Fog->GetComponent()->SetVolumetricFog(true);  // 🔑 Volumetric 활성화

// Fog 파라미터
Fog->GetComponent()->VolumetricFogScatteringDistribution = 0.5f;  // Scattering 방향성
Fog->GetComponent()->VolumetricFogAlbedo = FLinearColor(0.9, 0.9, 0.9);  // 안개 색상
Fog->GetComponent()->VolumetricFogExtinctionScale = 1.0f;  // 밀도
Fog->GetComponent()->VolumetricFogEmissive = FLinearColor::Black;  // 자체 발광

// Performance 설정
Fog->GetComponent()->VolumetricFogDistance = 10000.0f;  // 최대 거리
```

### Console Variables (CVars)

```
r.VolumetricFog 1                        ; 활성화
r.VolumetricFog.GridPixelSize 16         ; Froxel 해상도 (낮을수록 고품질)
r.VolumetricFog.GridSizeZ 128            ; Depth 해상도
r.VolumetricFog.TemporalReprojection 1   ; 시간적 재투영 (성능↑)
r.VolumetricFog.Jitter 1                 ; 지터링 (노이즈 감소)
```

---

## ☁️ Volumetric Clouds

```
┌─────────────────────────────────────────────────────────┐
│              Volumetric Cloud Architecture              │
├─────────────────────────────────────────────────────────┤
│  1. Weather Texture (2D):                               │
│     - Cloud Coverage (0~1)                              │
│     - Cloud Type (Cumulus, Stratus, etc.)               │
│     - Precipitation (비/눈)                             │
│                                                         │
│  2. Noise Textures (3D):                                │
│     - Base Noise: Worley/Perlin (대규모 구름 형태)      │
│     - Detail Noise: High-freq detail (디테일)           │
│                                                         │
│  3. Ray Marching:                                       │
│     - Cloud Layer: 1.5km ~ 8km altitude                │
│     - Adaptive Step Size (empty space skip)             │
│     - Light Scattering (Beer-Lambert Law)               │
└─────────────────────────────────────────────────────────┘
```

### Volumetric Cloud 설정

```cpp
// Sky Atmosphere + Volumetric Cloud
ASkyAtmosphere* SkyAtmo = GetWorld()->SpawnActor<ASkyAtmosphere>();
AVolumetricCloud* Cloud = GetWorld()->SpawnActor<AVolumetricCloud>();

// Cloud 파라미터
Cloud->LayerBottomAltitude = 1.5f;  // 1.5km
Cloud->LayerHeight = 6.5f;          // 6.5km (total 8km)
Cloud->TracingMaxDistance = 50.0f;  // km

// Material Parameter (Weather)
UMaterialInstanceDynamic* CloudMat = Cloud->GetVolumetricCloudMaterial();
CloudMat->SetScalarParameterValue("CloudCoverage", 0.5f);  // 50% 구름
CloudMat->SetScalarParameterValue("Precipitation", 0.0f);  // 비 없음
```

---

## 🎨 Light Scattering (Phase Function)

```cpp
// Henyey-Greenstein Phase Function
float HenyeyGreensteinPhase(float CosTheta, float G)
{
    float G2 = G * G;
    return (1.0f - G2) / (4.0f * PI * pow(1.0f + G2 - 2.0f * G * CosTheta, 1.5f));
}

// G = Scattering Distribution
// G = 0:  Isotropic (균일 산란)
// G > 0:  Forward Scattering (앞으로 산란, 안개)
// G < 0:  Backward Scattering (뒤로 산란, 드물음)
```

**예시:**
- **Fog**: G = 0.5 (앞으로 약간 산란)
- **Clouds**: G = 0.7 (앞으로 강하게 산란)

---

## 🚀 성능 최적화

### ✅ 효율적인 설정

```ini
[SystemSettings]
; Medium Quality
r.VolumetricFog.GridPixelSize=16
r.VolumetricFog.GridSizeZ=64
r.VolumetricFog.TemporalReprojection=1

; High Quality
r.VolumetricFog.GridPixelSize=8
r.VolumetricFog.GridSizeZ=128
```

### 성능 비교

| 설정 | GPU Cost | 품질 |
|------|---------|------|
| **Low (32×32×64)** | ~1ms | Medium |
| **Medium (64×64×128)** | ~2ms | High |
| **High (128×128×256)** | ~5ms | Very High |

---

## 🎮 실전 예시

### 예시 1: 시간대별 안개 밀도

```cpp
void AMyGameMode::UpdateFogByTimeOfDay(float TimeOfDay)
{
    AExponentialHeightFog* Fog = ...;

    // 새벽: 짙은 안개
    if (TimeOfDay < 6.0f)
    {
        Fog->GetComponent()->VolumetricFogExtinctionScale = 2.0f;
    }
    // 낮: 옅은 안개
    else if (TimeOfDay < 18.0f)
    {
        Fog->GetComponent()->VolumetricFogExtinctionScale = 0.5f;
    }
    // 밤: 중간 안개
    else
    {
        Fog->GetComponent()->VolumetricFogExtinctionScale = 1.0f;
    }
}
```

### 예시 2: 동적 구름 이동

```cpp
void AVolumetricCloud::Tick(float DeltaTime)
{
    // Wind로 구름 이동
    FVector2D WindOffset = FVector2D(1, 0) * DeltaTime * WindSpeed;

    UMaterialInstanceDynamic* Mat = GetVolumetricCloudMaterial();
    Mat->SetVectorParameterValue("WindOffset", FLinearColor(WindOffset.X, WindOffset.Y, 0, 0));
}
```

---

## 📊 성능 측정

**전형적인 Scene:**

| 항목 | GPU Time |
|------|----------|
| **Volumetric Fog (Medium)** | ~2ms |
| **Volumetric Clouds** | ~3ms |
| **Light Injection** | ~1ms |
| **Total** | ~6ms |

---

## 🔗 참고 자료

**소스 파일:**
- `Renderer/Private/VolumetricFog.cpp`
- `Renderer/Private/VolumetricCloud.cpp`
- `Engine/Public/Components/ExponentialHeightFogComponent.h`

**공식 문서:**
- [Volumetric Fog](https://docs.unrealengine.com/5.7/en-US/volumetric-fog-in-unreal-engine/)
- [Volumetric Clouds](https://docs.unrealengine.com/5.7/en-US/volumetric-clouds-in-unreal-engine/)

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Volumetric Fog & Clouds
  - Froxel-based Ray Marching
  - Light Scattering (Henyey-Greenstein)
  - Volumetric Clouds (Weather System)
  - Temporal Reprojection 최적화