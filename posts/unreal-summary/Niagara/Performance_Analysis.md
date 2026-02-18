---
title: "Performance Analysis (성능 분석)"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Performance Analysis (성능 분석)

## 🧭 개요

Niagara 성능 분석은 **병목 지점을 식별**하고 최적화 기회를 찾는 과정입니다.

**핵심 도구:**
- **stat Niagara**: CPU/GPU 통계
- **GPU Visualizer**: GPU 프로파일링
- **Niagara Debugger**: 실시간 디버깅
- **Insights**: 상세 프로파일링

---

## 🧱 주요 프로파일링 도구

### 1. **Console Commands**

```cpp
// CPU 통계
stat Niagara
stat NiagaraEmitters
stat Particles

// GPU 통계
stat GPU
ProfileGPU

// 메모리
stat Memory
stat NiagaraMemory
```

### 2. **Niagara Debugger**

**활성화:**
```
fx.Niagara.Debug.Enabled 1
```

**기능:**
- 파티클 개수 실시간 표시
- Emitter별 시간 측정
- DataInterface 성능

### 3. **Insights (Unreal Insights)**

**녹화:**
```
Trace.Start
// ... 테스트 실행 ...
Trace.Stop
```

**분석:**
- CPU Timeline
- GPU Timeline
- Task Graph 추적

---

## 💡 일반적인 병목 지점

### 1. **과도한 Particle 개수**

**증상:**
```
stat Niagara
NiagaraOverview_GT: 50ms  // ← 너무 느림!
```

**해결:**
- MaxParticleCount 제한
- Distance Culling
- LOD 시스템

### 2. **복잡한 Script**

**증상:**
```
stat NiagaraEmitters
MyEmitter Update: 15ms  // ← Script가 너무 복잡
```

**해결:**
- Script 최적화 (불필요한 연산 제거)
- Static Switch 사용
- Simulation Stage 줄이기

### 3. **GPU Bottleneck**

**증상:**
```
ProfileGPU
NiagaraGPU: 20ms  // ← GPU Simulation 과부하
```

**해결:**
- Particle 개수 감소
- Simulation Stage Iteration 줄이기
- Grid 해상도 낮추기

---

## ⚠️ 최적화 체크리스트

### ✅ CPU 최적화

**1. Component Pooling:**
```cpp
FX.NiagaraComponentPool.Enable = 1
```

**2. Fixed Bounds:**
```cpp
// Dynamic Bounds 비용 제거
UNiagaraSystem::bFixedBounds = true
```

**3. Async Tick:**
```cpp
// Concurrent Tick 활성화 (기본값)
AsyncWorkCanOverlapTickGroups = true
```

### ✅ GPU 최적화

**1. Particle 개수 제한:**
```cpp
Emitter->MaxParticleCount = 1000;
```

**2. Half Precision 사용:**
```cpp
// Color 등은 Half로 충분
Attribute.Type = FNiagaraTypeDefinition::GetHalfDef();
```

**3. Simulation Stage 최소화:**
```cpp
// NumIterations 줄이기
SimulationStage->NumIterations = 5;  // 10 → 5
```

---

## 🐛 디버깅 팁

### Particle 개수 확인

```cpp
// Console
fx.Niagara.Debug.OverviewMode 1

// 화면에 표시:
// - Active Particles
// - Emitters
// - Systems
```

### Script 실행 시간 측정

```cpp
// Emitter별 시간
stat NiagaraEmitters

// 결과:
// MyEmitter_Spawn: 2.5ms
// MyEmitter_Update: 8.3ms
// MyEmitter_Events: 1.2ms
```

---

## 🔗 참조 자료

**공식 문서:**
- [Unreal Insights Documentation](https://docs.unrealengine.com/en-US/TestingAndOptimization/PerformanceAndProfiling/UnrealInsights/)
- [Niagara Performance Guide](https://docs.unrealengine.com/en-US/RenderingAndGraphics/Niagara/PerformanceGuide/)

**Console Variables:**
- `stat Niagara` - CPU/GPU 통계
- `fx.Niagara.Debug.Enabled` - 디버거 활성화
- `ProfileGPU` - GPU 프로파일링

---

> 🔄 작성: 2025-11-22 — Niagara 성능 분석 및 최적화 가이드
