---
title: "Lumen - 최적화"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Lumen"
tags: ["unreal", "Lumen"]
---
# Lumen - 최적화

## 🧭 개요

Lumen의 **성능 최적화**, **Scalability**, **다른 시스템과의 통합**을 다룹니다.

**핵심 주제:**
- **Performance Bottleneck**: 병목 지점 분석
- **Scalability Settings**: Quality Preset별 설정
- **Memory Optimization**: VRAM 사용량 최적화
- **Nanite Integration**: Nanite + Lumen 통합
- **Debugging Tools**: 시각화 및 프로파일링

---

## 🧱 Performance Bottlenecks

### 1. **Lumen의 주요 비용 영역**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   Lumen Performance Breakdown                           │
├─────────────────────────────────────────────────────────────────────────┤
│  GPU Time Budget (4K, Epic Settings, RTX 4080):                         │
│                                                                         │
│  1. Surface Cache Update           ~1.5ms (15%)                         │
│     │                                                                    │
│     ├─ Card Capture                   ~0.8ms    // 지오메트리 렌더링    │
│     ├─ Direct Lighting               ~0.5ms    // Shadow Mask 업데이트 │
│     └─ Atlas Allocation              ~0.2ms    // Virtual Page Table    │
│                                                                         │
│  2. Screen Probe Gather            ~3.0ms (30%)                         │
│     │                                                                    │
│     ├─ Probe Placement               ~0.3ms    // Adaptive Probe        │
│     ├─ Ray Tracing                   ~1.8ms    // 64 rays × N probes   │
│     ├─ Irradiance Integration        ~0.5ms    // SH/Octahedral         │
│     └─ Spatial/Temporal Filter       ~0.4ms    // Denoising             │
│                                                                         │
│  3. Reflections                    ~2.5ms (25%)                         │
│     │                                                                    │
│     ├─ Tile Classification           ~0.2ms    // Trace/Resolve/Clear   │
│     ├─ Ray Tracing                   ~1.5ms    // Per-Pixel Trace      │
│     ├─ Hit Lighting (Optional)       ~0.5ms    // Direct + Indirect     │
│     └─ Denoising & Composition       ~0.3ms    // Temporal + Spatial    │
│                                                                         │
│  4. Radiance Cache                 ~1.5ms (15%)                         │
│     │                                                                    │
│     ├─ Probe Update                  ~0.8ms    // Incremental Update    │
│     ├─ Probe Interpolation           ~0.5ms    // Per-Pixel Lookup      │
│     └─ Probe Culling                 ~0.2ms    // Visibility Test       │
│                                                                         │
│  5. Misc (Barriers, Copy)          ~1.5ms (15%)                         │
│                                                                         │
│  Total Lumen:                      ~10.0ms (100%)                       │
│                                                                         │
│  병목 순위:                                                              │
│    1위: Screen Probe Ray Tracing (1.8ms)    ← 최대 병목                 │
│    2위: Reflections Ray Tracing (1.5ms)     ← 두 번째 병목              │
│    3위: Surface Cache Card Capture (0.8ms)  ← 세 번째 병목              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. **병목 지점별 최적화**

**병목 1: Screen Probe Ray Tracing (1.8ms)**

```cpp
// ❌ 문제: 너무 많은 Probe × Ray
r.Lumen.ScreenProbeGather.ScreenProbeDownsampleFactor = 8    // 4배 많은 Probe
r.Lumen.ScreenProbeGather.TracingOctahedronResolution = 16   // 4배 많은 Ray
// → Total 16배 비용!

// ✅ 최적화 1: Probe 밀도 감소
r.Lumen.ScreenProbeGather.ScreenProbeDownsampleFactor = 16   // 기본값 (균형)
// 또는
r.Lumen.ScreenProbeGather.ScreenProbeDownsampleFactor = 32   // 성능 우선 (저품질)

// ✅ 최적화 2: Ray 개수 감소
r.Lumen.ScreenProbeGather.TracingOctahedronResolution = 8    // 기본값 (64 rays)
// 또는
r.Lumen.ScreenProbeGather.TracingOctahedronResolution = 4    // 성능 우선 (16 rays)

// ✅ 최적화 3: Trace Distance 제한
r.Lumen.ScreenProbeGather.MaxTraceDistance = 50000           // 500m (기본 무제한)
// Far Field는 Radiance Cache로 처리

// ✅ 최적화 4: Adaptive Probe 제한
r.Lumen.ScreenProbeGather.AdaptiveProbeAllocation = 0        // Uniform만 사용 (저품질)
```

**병목 2: Reflections Ray Tracing (1.5ms)**

```cpp
// ❌ 문제: Full Resolution Reflections
r.Lumen.Reflections.DownsampleFactor = 1                     // Full Res
// → 1920×1080 = 2,073,600 rays!

// ✅ 최적화 1: Downsampling
r.Lumen.Reflections.DownsampleFactor = 2                     // Half Res (기본)
// → 960×540 = 518,400 rays (4배 빠름)

// ✅ 최적화 2: Roughness Culling
r.Lumen.Reflections.MaxRoughnessToTrace = 0.3                // 기본 0.4
// Rough 표면은 Reflection Capture 사용

// ✅ 최적화 3: Trace Distance
r.Lumen.Reflections.MaxTraceDistance = 50000                 // 500m
r.Lumen.Reflections.NearFieldMaxTraceDistance = 1000         // 10m (Near Field)

// ✅ 최적화 4: Hardware RT 대신 Software
r.Lumen.HardwareRayTracing.Reflections = 0                   // Software (SDF)
// Hardware RT는 High-End GPU만
```

**병목 3: Surface Cache Card Capture (0.8ms)**

```cpp
// ❌ 문제: 고해상도 Card
r.LumenScene.SurfaceCache.CardCaptureResolution = 2048       // 매우 높음
// → 메모리 + GPU 시간 증가

// ✅ 최적화 1: 해상도 감소
r.LumenScene.SurfaceCache.CardCaptureResolution = 512        // 기본값
// 또는
r.LumenScene.SurfaceCache.CardCaptureResolution = 256        // 성능 우선

// ✅ 최적화 2: Update Rate 제한
r.LumenScene.SurfaceCache.UpdateFrameRate = 30               // 30 FPS (기본 60)
// 정적 씬에서는 느리게 업데이트 가능

// ✅ 최적화 3: Culling Distance
r.LumenScene.SurfaceCache.CardCaptureRefreshDistanceFromCamera = 10000  // 100m
// 먼 거리 Card는 업데이트 안 함
```

---

## 💡 Scalability Settings

### 1. **Quality Preset별 설정**

Unreal Engine의 Scalability System과 Lumen 통합:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  Lumen Scalability Presets                              │
├─────────────────────────────────────────────────────────────────────────┤
│  sg.GlobalIlluminationQuality = 0 (Low)                                 │
│    - ScreenProbeDownsampleFactor: 32                                    │
│    - TracingOctahedronResolution: 4 (16 rays)                           │
│    - Reflections DownsampleFactor: 4                                    │
│    - MaxRoughnessToTrace: 0.2                                           │
│    - Surface Cache Resolution: 256                                      │
│    - Hardware RT: Disabled                                              │
│    → Target: 720p @ 60 FPS (Low-End GPU)                                │
│                                                                         │
│  sg.GlobalIlluminationQuality = 1 (Medium)                              │
│    - ScreenProbeDownsampleFactor: 24                                    │
│    - TracingOctahedronResolution: 6 (36 rays)                           │
│    - Reflections DownsampleFactor: 2                                    │
│    - MaxRoughnessToTrace: 0.3                                           │
│    - Surface Cache Resolution: 384                                      │
│    - Hardware RT: Optional                                              │
│    → Target: 1080p @ 60 FPS (Mid-Range GPU)                             │
│                                                                         │
│  sg.GlobalIlluminationQuality = 2 (High)                                │
│    - ScreenProbeDownsampleFactor: 16                                    │
│    - TracingOctahedronResolution: 8 (64 rays)                           │
│    - Reflections DownsampleFactor: 2                                    │
│    - MaxRoughnessToTrace: 0.4                                           │
│    - Surface Cache Resolution: 512                                      │
│    - Hardware RT: Enabled (if supported)                                │
│    → Target: 1440p @ 60 FPS (High-End GPU)                              │
│                                                                         │
│  sg.GlobalIlluminationQuality = 3 (Epic)                                │
│    - ScreenProbeDownsampleFactor: 16                                    │
│    - TracingOctahedronResolution: 12 (144 rays)                         │
│    - Reflections DownsampleFactor: 1                                    │
│    - MaxRoughnessToTrace: 0.5                                           │
│    - Surface Cache Resolution: 1024                                     │
│    - Hardware RT: Enabled + Hit Lighting                                │
│    → Target: 4K @ 60 FPS (Ultra High-End GPU)                           │
│                                                                         │
│  sg.GlobalIlluminationQuality = 4 (Cinematic)                           │
│    - ScreenProbeDownsampleFactor: 8                                     │
│    - TracingOctahedronResolution: 16 (256 rays)                         │
│    - Reflections DownsampleFactor: 1                                    │
│    - MaxRoughnessToTrace: 0.6                                           │
│    - Surface Cache Resolution: 2048                                     │
│    - Hardware RT: Always + Hit Lighting                                 │
│    → Target: 4K @ 30 FPS (Offline Rendering)                            │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. **Custom Scalability 설정**

`DefaultScalability.ini`에서 프로젝트별 커스터마이징:

```ini
[GlobalIlluminationQuality@0]  ; Low
r.Lumen.ScreenProbeGather.ScreenProbeDownsampleFactor=32
r.Lumen.ScreenProbeGather.TracingOctahedronResolution=4
r.Lumen.Reflections.DownsampleFactor=4
r.Lumen.Reflections.MaxRoughnessToTrace=0.2
r.LumenScene.SurfaceCache.CardCaptureResolution=256
r.Lumen.HardwareRayTracing=0

[GlobalIlluminationQuality@1]  ; Medium
r.Lumen.ScreenProbeGather.ScreenProbeDownsampleFactor=24
r.Lumen.ScreenProbeGather.TracingOctahedronResolution=6
r.Lumen.Reflections.DownsampleFactor=2
r.Lumen.Reflections.MaxRoughnessToTrace=0.3
r.LumenScene.SurfaceCache.CardCaptureResolution=384

[GlobalIlluminationQuality@2]  ; High
r.Lumen.ScreenProbeGather.ScreenProbeDownsampleFactor=16
r.Lumen.ScreenProbeGather.TracingOctahedronResolution=8
r.Lumen.Reflections.DownsampleFactor=2
r.Lumen.Reflections.MaxRoughnessToTrace=0.4
r.LumenScene.SurfaceCache.CardCaptureResolution=512
r.Lumen.HardwareRayTracing=1

[GlobalIlluminationQuality@3]  ; Epic
r.Lumen.ScreenProbeGather.ScreenProbeDownsampleFactor=16
r.Lumen.ScreenProbeGather.TracingOctahedronResolution=12
r.Lumen.Reflections.DownsampleFactor=1
r.Lumen.Reflections.MaxRoughnessToTrace=0.5
r.LumenScene.SurfaceCache.CardCaptureResolution=1024
r.Lumen.HardwareRayTracing=1
r.Lumen.HardwareRayTracing.HitLighting=1
```

### 3. **Dynamic Scalability (Runtime)**

게임 중 동적으로 품질 조정:

```cpp
// C++ 코드: FPS에 따라 동적 조정
void UMyGameSettings::AdjustLumenQuality(float CurrentFPS, float TargetFPS)
{
    if (CurrentFPS < TargetFPS - 5.0f)
    {
        // FPS 낮음 → 품질 낮춤
        int32 CurrentQuality = GetGlobalIlluminationQuality();
        if (CurrentQuality > 0)
        {
            SetGlobalIlluminationQuality(CurrentQuality - 1);
        }
    }
    else if (CurrentFPS > TargetFPS + 10.0f)
    {
        // FPS 높음 → 품질 올림
        int32 CurrentQuality = GetGlobalIlluminationQuality();
        if (CurrentQuality < 3)
        {
            SetGlobalIlluminationQuality(CurrentQuality + 1);
        }
    }
}

// Blueprint: Scalability 변경
void UGameUserSettings::SetGlobalIlluminationQuality(int32 Value)
{
    Scalability::SetGlobalIlluminationQualityLevel(Value);
    ApplySettings(false);
}
```

---

## 🧩 Memory Optimization

### 1. **VRAM 사용량 분석**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  Lumen VRAM Usage (4K, Epic)                            │
├─────────────────────────────────────────────────────────────────────────┤
│  1. Surface Cache Atlas               ~800 MB                           │
│     │                                                                    │
│     ├─ Physical Atlas (4096×4096)         ~600 MB                       │
│     │   - Albedo: RGBA16F                  ~200 MB                      │
│     │   - Normal: RGB10A2                  ~100 MB                      │
│     │   - Emissive: RGB11F                 ~150 MB                      │
│     │   - Depth: R32F                      ~150 MB                      │
│     │                                                                    │
│     └─ Virtual Page Table                  ~200 MB                      │
│         - Per-Card Metadata                                             │
│                                                                         │
│  2. Radiance Cache                    ~400 MB                           │
│     │                                                                    │
│     ├─ Probe Radiance (SH3)               ~200 MB                       │
│     │   - 9 SH Coefficients × RGB          (per probe)                  │
│     │                                                                    │
│     └─ Probe Occlusion                    ~200 MB                       │
│         - Directional Occlusion                                         │
│                                                                         │
│  3. Screen Probe Textures             ~300 MB                           │
│     │                                                                    │
│     ├─ Screen Probe Atlas                 ~150 MB                       │
│     │   - Octahedral Radiance (6×6)                                     │
│     │                                                                    │
│     └─ Screen Probe Irradiance            ~150 MB                       │
│         - SH or Octahedral                                              │
│                                                                         │
│  4. Reflection Buffers                ~200 MB                           │
│     │                                                                    │
│     ├─ Trace Radiance (Half Res)          ~100 MB                       │
│     │   - RGB16F × 960×540                                              │
│     │                                                                    │
│     └─ Trace Hit/Material                 ~100 MB                       │
│         - Distance, Normal, ID                                          │
│                                                                         │
│  5. Hardware RT (Optional)            ~1000 MB                          │
│     │                                                                    │
│     ├─ BLAS (Bottom-Level AS)             ~600 MB                       │
│     │   - Per-Mesh Geometry                                             │
│     │                                                                    │
│     └─ TLAS (Top-Level AS)                ~400 MB                       │
│         - Scene Instance Hierarchy                                      │
│                                                                         │
│  Total Lumen VRAM:                    ~1.7 GB (without Hardware RT)    │
│                                       ~2.7 GB (with Hardware RT)        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. **VRAM 최적화 기법**

**최적화 1: Surface Cache 해상도 감소**

```cpp
// ✅ Atlas 크기 감소
r.LumenScene.SurfaceCache.AtlasSize = 2048          // 기본 4096 → 2048
// → VRAM: 800MB → 200MB (4배 감소)

// ✅ Card 해상도 감소
r.LumenScene.SurfaceCache.CardCaptureResolution = 256   // 기본 512 → 256
// → 더 낮은 LOD 사용
```

**최적화 2: Radiance Cache 밀도 감소**

```cpp
// ✅ Probe 간격 증가
r.LumenScene.RadianceCache.ProbeSpacing = 200       // 기본 100 → 200
// → Probe 개수 8배 감소 (3D Grid)

// ✅ Probe 해상도 감소
r.LumenScene.RadianceCache.ProbeResolution = 4      // 기본 6 → 4
// → SH Coefficient 수 감소
```

**최적화 3: Reflection 해상도 감소**

```cpp
// ✅ Reflection Downsampling
r.Lumen.Reflections.DownsampleFactor = 4            // 기본 2 → 4
// → VRAM: 200MB → 50MB (Quarter Res)
```

**최적화 4: Hardware RT 비활성화**

```cpp
// ✅ Software Ray Tracing 사용
r.Lumen.HardwareRayTracing = 0
// → VRAM: -1000MB (BLAS/TLAS 제거)
```

---

## 🔗 Nanite Integration

### 1. **Nanite + Lumen 시너지**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Nanite + Lumen Integration                         │
├─────────────────────────────────────────────────────────────────────────┤
│  Nanite의 이점:                                                          │
│    + Micro Polygon Detail → Lumen Surface Cache 고품질                  │
│    + Automatic LOD → Distance Field 생성 최적화                          │
│    + Virtual Geometry → VRAM 효율적                                     │
│                                                                         │
│  Lumen의 이점:                                                           │
│    + 동적 GI → Nanite 지오메트리 변경 시 실시간 반영                      │
│    + Card-based Caching → Nanite의 작은 삼각형도 효율적 샘플링           │
│                                                                         │
│  Hardware Ray Tracing + Nanite:                                         │
│    + Nanite Mesh → RT Acceleration Structure 통합                       │
│    + Pixel-Accurate Tracing → Micro Detail 반사                         │
│    - VRAM 증가 (BLAS for Nanite)                                        │
│                                                                         │
│  Best Practices:                                                        │
│    1. Nanite Mesh → Distance Field 자동 생성 활성화                      │
│    2. Lumen Surface Cache → Nanite Mesh 포함                            │
│    3. Hardware RT → Nanite Ray Tracing 활성화 (UE 5.3+)                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. **Nanite-Lumen 설정**

```cpp
// 1. Nanite Mesh Distance Field 생성
Static Mesh → Build Settings:
- Generate Mesh Distance Fields = True
- Distance Field Resolution Scale = 1.0

// 2. Lumen에서 Nanite 사용
r.Lumen.TraceMeshSDFs = 1                           // Nanite Mesh SDF 추적
r.LumenScene.SurfaceCache.IncludeNaniteMeshes = 1  // Surface Cache에 포함

// 3. Nanite Ray Tracing (UE 5.3+)
r.Lumen.HardwareRayTracing.Nanite = 1               // Nanite HW RT
r.RayTracing.Nanite = 1                             // Nanite RT 전역 활성화
```

---

## 🧪 Debugging & Visualization

### 1. **Lumen Visualization Modes**

```cpp
// Console Commands: Lumen 시각화

// 1. Surface Cache 시각화
r.Lumen.Visualize.Mode = 1                          // Surface Cache Cards
r.Lumen.Visualize.Mode = 2                          // Surface Cache Atlas

// 2. Screen Probe 시각화
r.Lumen.ScreenProbeGather.Visualize = 1             // Probe 위치 및 Radiance
r.Lumen.ScreenProbeGather.VisualizeTracingCoherency = 1  // Ray 방향

// 3. Reflections 디버깅
r.Lumen.Reflections.Visualize = 1                   // Reflection Traces
r.Lumen.Reflections.VisualizeTracingCoherency = 1   // Ray Coherency

// 4. Radiance Cache 시각화
r.LumenScene.Visualize.RadianceCacheProbes = 1      // World Probe 위치
r.LumenScene.Visualize.RadianceCacheProbeRadiance = 1  // Probe Radiance

// 5. Hardware RT 디버깅
r.Lumen.HardwareRayTracing.Visualize = 1            // RT Hit Points
```

### 2. **Performance Profiling**

```cpp
// GPU Profiling Commands

// 1. Lumen Pass별 시간 측정
stat GPU                                            // GPU 전체 시간
profilegpu                                          // Pass별 상세 시간

// 2. Lumen 전용 통계
stat Lumen                                          // Lumen 통계
stat LumenSurfaceCache                              // Surface Cache 통계
stat LumenScreenProbes                              // Screen Probe 통계

// 3. Unreal Insights
Trace.Start rdg                                     // RDG Trace 시작
// ... 게임 플레이 ...
Trace.Stop                                          // Trace 중지
// UnrealInsights.exe에서 .utrace 분석

// 4. Memory Profiling
stat RHI                                            // RHI 메모리
stat Memory                                         // 전체 메모리
```

### 3. **Lumen 비활성화 (A/B 비교)**

```cpp
// Lumen vs 기존 GI 비교

// Lumen 완전 비활성화
r.DynamicGlobalIlluminationMethod = 0               // Lumen → None
r.ReflectionMethod = 0                              // Lumen Reflections → None

// 또는 개별 비활성화
r.Lumen.DiffuseGI = 0                               // Diffuse GI만 비활성화
r.Lumen.Reflections = 0                             // Reflections만 비활성화

// 대체 방법 활성화
r.DynamicGlobalIlluminationMethod = 2               // Screen Space GI (SSGI)
r.ReflectionMethod = 2                              // Screen Space Reflections (SSR)
```

---

## ⚠️ 주의사항 및 Best Practices

### ❌ 피해야 할 것

**1. 모든 설정을 Max로:**
```cpp
// ❌ 모든 설정 Ultra
r.Lumen.ScreenProbeGather.TracingOctahedronResolution = 16  // 256 rays
r.Lumen.Reflections.DownsampleFactor = 1                    // Full Res
r.LumenScene.SurfaceCache.CardCaptureResolution = 2048      // 2K
r.Lumen.HardwareRayTracing.HitLighting = 1                  // Hit Lighting
// → GPU Time > 20ms (전체 프레임의 60%!)
```

**2. Distance Field 누락:**
```cpp
// ❌ Distance Field 생성 안 함
Static Mesh → Generate Mesh Distance Fields = False
// → Lumen에서 보이지 않음!
```

**3. Static Light + Lumen 혼용:**
```cpp
// ❌ Static Lightmap + Lumen
Directional Light → Mobility = Static
r.DynamicGlobalIlluminationMethod = 1  // Lumen
// → 간접광 중복 (너무 밝음)
```

### ✅ 올바른 방법

**1. GPU Tier별 Preset:**
```cpp
// ✅ RTX 4090 (Ultra High-End)
sg.GlobalIlluminationQuality = 3  // Epic

// ✅ RTX 3070 (High-End)
sg.GlobalIlluminationQuality = 2  // High

// ✅ RTX 2060 (Mid-Range)
sg.GlobalIlluminationQuality = 1  // Medium
r.Lumen.HardwareRayTracing = 0    // Software Ray Tracing

// ✅ GTX 1060 (Low-End)
sg.GlobalIlluminationQuality = 0  // Low
r.DynamicGlobalIlluminationMethod = 0  // Lumen 비활성화
```

**2. Distance Field 항상 생성:**
```cpp
// ✅ Project Settings
Project Settings → Rendering:
- Generate Mesh Distance Fields = True

// ✅ Per-Mesh 확인
Static Mesh → Build Settings:
- Distance Field Resolution Scale = 1.0
```

**3. Movable Lighting만 사용:**
```cpp
// ✅ 모든 Light를 Movable로
Directional Light → Mobility = Movable
Point Light → Mobility = Movable
Spot Light → Mobility = Movable

// Lumen이 실시간으로 간접광 계산
```

**4. Nanite + Lumen 함께 사용:**
```cpp
// ✅ Nanite Mesh에 Distance Field 생성
Static Mesh → Nanite Settings:
- Enable Nanite = True
- Generate Mesh Distance Fields = True

// ✅ Lumen에서 Nanite 사용
r.Lumen.TraceMeshSDFs = 1
r.LumenScene.SurfaceCache.IncludeNaniteMeshes = 1
```

---

## 🔗 참조 자료

**소스 파일:**
- `Engine/Source/Runtime/Renderer/Private/Lumen/Lumen.h` - Lumen 상수 정의
- `Engine/Source/Runtime/Renderer/Private/Lumen/LumenSceneData.h` - Scene 데이터
- `Engine/Source/Runtime/Renderer/Private/Lumen/LumenVisualize.h` - Visualization

**관련 문서:**
- [Lumen_Overview.md](Lumen_Overview.md) - Lumen 기본 개념
- [Lumen_Advanced.md](Lumen_Advanced.md) - GI, Reflections, Hardware RT
- [RDG_Overview.md](RDG_Overview.md) - RDG와 Lumen 통합

**외부 자료:**
- GDC 2021: "A Deep Dive into Lumen" - 성능 최적화 섹션
- Unreal Engine Documentation: "Lumen Performance Guide"
- Unreal Fest 2022: "Optimizing Lumen for Your Project"

**Console Variables 참조:**
```cpp
// Lumen 전체 설정 확인
r.Lumen.* | grep
r.LumenScene.* | grep

// Scalability 확인
sg.GlobalIlluminationQuality
```

---

> 🔄 작성: 2025-11-22 — Lumen 성능 최적화 및 Scalability 가이드
