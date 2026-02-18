---
title: "Profiling Tools Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Performance"
tags: ["unreal", "Performance"]
engine_version: "Unreal Engine 5.7"
---
# Profiling Tools Deep Dive

## 🧭 개요

**Profiling Tools**는 성능 병목을 찾고 최적화하는 필수 도구입니다.

### 핵심 도구

| 도구 | 용도 |
|------|------|
| **Unreal Insights** | Timeline 기반 상세 프로파일링 |
| **stat commands** | 실시간 통계 (FPS, Mem, GPU) |
| **GPU Visualizer** | GPU 렌더링 병목 분석 |
| **CPU Profiler (Visual Studio)** | C++ 코드 Hot Path 분석 |

---

## 🔍 Unreal Insights

### 활성화 및 캡처

```cpp
// 1. Launch with Tracing
UnrealEditor.exe -trace=cpu,gpu,frame,bookmark

// 2. 또는 Console에서 활성화
trace.Start

// 3. Capture Session (30초)
trace.Stop

// 4. Insights 실행
UnrealInsights.exe
```

### 주요 기능

```
┌─────────────────────────────────────────────────────────┐
│              Unreal Insights Tracks                     │
├─────────────────────────────────────────────────────────┤
│  1. Frame Track:                                        │
│     - Game Thread, Render Thread, RHI Thread            │
│     - Per-Frame Timing (16.67ms target @ 60 FPS)        │
│                                                         │
│  2. CPU Timeline:                                       │
│     - Function Call Hierarchy                           │
│     - Tick, Blueprint Execute, Animation Update         │
│     - Sorting by Inclusive/Exclusive Time               │
│                                                         │
│  3. GPU Timeline:                                       │
│     - Draw Calls, Compute Shaders                       │
│     - Shadow Rendering, GBuffer, Lighting               │
│                                                         │
│  4. Counters:                                           │
│     - Memory Usage, Draw Call Count                     │
│     - Triangles, Shader Permutations                    │
│                                                         │
│  5. Bookmarks:                                          │
│     - Custom Events (UE_TRACE_LOG)                      │
└─────────────────────────────────────────────────────────┘
```

### Custom Tracing

```cpp
// C++ Custom Trace
#include "ProfilingDebugging/CpuProfilerTrace.h"

void MyExpensiveFunction()
{
    TRACE_CPUPROFILER_EVENT_SCOPE(MyExpensiveFunction);  // 🔑 Insights에서 보임

    // Heavy work...
    for (int32 i = 0; i < 1000000; ++i)
    {
        DoWork();
    }
}

// Blueprint Custom Bookmark
UKismetSystemLibrary::BeginProfiling("MyBlueprintLogic");
// ... Blueprint nodes ...
UKismetSystemLibrary::EndProfiling();
```

---

## 📊 stat Commands

### 주요 stat 명령어

```
stat FPS                  ; FPS + Frame Time
stat Unit                 ; Game/Render/GPU Thread Time
stat UnitGraph            ; Visual Graph (30s history)

stat Game                 ; Game Thread Stats
stat SceneRendering       ; Render Thread Stats
stat GPU                  ; GPU Pass Times
stat RHI                  ; RHI Command Stats

stat Memory               ; Memory Usage
stat Streaming            ; Asset Streaming Stats
stat Particles            ; Niagara/Cascade Stats

stat NamedEvents          ; Custom stat groups
```

### stat 출력 예시

```
stat Unit:
  Frame:  16.5ms  (60 FPS)
  Game:    8.2ms  (Game Thread)
  Draw:    6.1ms  (Render Thread)
  GPU:    12.3ms  (GPU)
  RHIT:    0.5ms  (RHI Thread)

→ GPU Bound (12.3ms > 8.2ms Game)
```

---

## 🎮 GPU Visualizer

### 사용법

```
1. Console: r.ProfileGPU.ShowUI 1
2. Ctrl + Shift + ,  (GPU Visualizer 열기)
```

### GPU Timeline 예시

```
┌─────────────────────────────────────────────────────────┐
│               GPU Profiler (16.7ms total)               │
├─────────────────────────────────────────────────────────┤
│  Prepass                    1.2ms                       │
│  BasePass                   4.5ms  ◄─ 병목!            │
│  Lighting                   3.2ms                       │
│  Translucency               1.5ms                       │
│  Post Process               2.8ms                       │
│    ├─ TAA                   0.8ms                       │
│    ├─ Bloom                 1.2ms                       │
│    └─ Tonemapping           0.3ms                       │
│  VSM Update                 2.5ms                       │
│  Lumen                      1.0ms                       │
└─────────────────────────────────────────────────────────┘
```

**분석:**
- BasePass가 4.5ms로 가장 느림
- 원인: Complex Material, High Triangle Count
- 해결: Material 단순화, LOD 사용

---

## 🔧 Profiling 전략

### 1. Frame Time 분석

```cpp
// Target: 60 FPS = 16.67ms
// Check: stat Unit

if (Game Thread > 16.67ms)
{
    // CPU Bound
    // → Reduce Tick Cost, Blueprint Optimization
}
else if (GPU > 16.67ms)
{
    // GPU Bound
    // → Reduce Draw Calls, Simplify Materials
}
```

### 2. Draw Call 최적화

```
stat RHI:
  DrawCalls: 5,000  ◄─ 너무 많음 (목표: < 2,000)
  Triangles: 10M

// 해결책:
1. Instanced Static Mesh (ISM)
2. HLOD
3. Nanite (자동 최적화)
```

### 3. Memory Profiling

```
stat Memory:
  Physical: 8.2GB / 16GB
  Virtual:  12.1GB

stat LLM (Low Level Memory):
  Textures:     3.2GB  ◄─ 큰 비중
  StaticMesh:   1.5GB
  Animations:   0.8GB
  Audio:        0.5GB
```

---

## 🚀 최적화 우선순위

```
1. Frame Time > 20ms?
   → Profiling 시작

2. stat Unit으로 병목 파악
   - Game Thread Bound → CPU 최적화
   - GPU Bound → Rendering 최적화

3. Unreal Insights로 Hot Path 찾기
   - Tick 함수 최적화
   - Blueprint Nativization

4. GPU Visualizer로 렌더링 Pass 분석
   - Material Complexity 줄이기
   - Shadow Resolution 낮추기

5. stat Memory로 메모리 누수 확인
   - Texture Streaming 설정
   - Asset 언로드
```

---

## 📊 벤치마킹 예시

**Before Optimization:**
```
stat Unit:
  Frame: 25ms (40 FPS)
  Game:  18ms  ◄─ 병목
  GPU:   12ms

Unreal Insights:
  AAIController::Tick: 8ms  ◄─ Hot Path!
```

**After Optimization:**
```
// AIController Tick 최적화
// - Behavior Tree Tick Interval: 0.5s → 1.0s
// - Perception Update: Every Frame → Every 0.2s

stat Unit:
  Frame: 16ms (60 FPS)  ✅
  Game:  10ms
  GPU:   12ms
```

---

## 🔗 참고 자료

**소스:**
- `Core/Public/ProfilingDebugging/CpuProfilerTrace.h`
- `RenderCore/Public/ProfilingDebugging/RealtimeGPUProfiler.h`

**공식 문서:**
- [Unreal Insights](https://docs.unrealengine.com/5.7/en-US/unreal-insights-in-unreal-engine/)
- [Performance Profiling](https://docs.unrealengine.com/5.7/en-US/performance-profiling-in-unreal-engine/)

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Profiling Tools
  - Unreal Insights (Timeline, Custom Trace)
  - stat commands (FPS, Unit, GPU, Memory)
  - GPU Visualizer
  - 최적화 전략