---
title: "GPU Optimization Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Performance"
tags: ["unreal", "Performance"]
---
# GPU Optimization Deep Dive

## 🧭 개요

**GPU 최적화**는 렌더링 병목을 제거하여 GPU Frame Time을 줄입니다.

---

## 🎨 Draw Call 최적화

### Instanced Static Mesh

```cpp
// ❌ 1,000개 Static Mesh = 1,000 Draw Calls
for (int32 i = 0; i < 1000; ++i)
{
    UStaticMeshComponent* Mesh = NewObject<UStaticMeshComponent>();
    Mesh->SetStaticMesh(TreeMesh);
}

// ✅ Instanced Static Mesh = 1 Draw Call
UInstancedStaticMeshComponent* ISM = NewObject<UInstancedStaticMeshComponent>();
ISM->SetStaticMesh(TreeMesh);

for (int32 i = 0; i < 1000; ++i)
{
    FTransform Transform = ...;
    ISM->AddInstance(Transform);  // 🔑 1 Draw Call!
}
```

---

## 📐 Material Complexity

```
// Material Editor → Stats
Shader Complexity:
  Instructions: 500  ◄─ 너무 복잡! (목표: < 200)
  Texture Samples: 10  ◄─ 너무 많음! (목표: < 5)

// 해결책:
1. Texture 통합 (R/G/B/A 채널 활용)
2. Lerp 대신 BlendOverlay 사용
3. 불필요한 Normal Map 제거
```

---

## 🔄 Overdraw 최적화

```
// Overdraw Visualization
r.ShaderComplexity 2  ; Overdraw Mode

// 빨간색 = High Overdraw (여러 번 그려짐)
// → Translucent Material 줄이기
// → Particle Count 줄이기
```

---

## 📊 성능 비교

| 최적화 | Draw Calls | GPU Time |
|--------|-----------|----------|
| **ISM (1,000 Trees)** | 1,000 → 1 | 10ms → 0.5ms |
| **Material 단순화** | - | 5ms → 2ms |
| **Overdraw 감소** | - | 3ms → 1ms |

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - GPU Optimization