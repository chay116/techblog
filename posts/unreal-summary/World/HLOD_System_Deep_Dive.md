---
title: "HLOD System Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "World"
tags: ["unreal", "World"]
engine_version: "Unreal Engine 5.7"
---
# HLOD System Deep Dive

## 🧭 개요

**HLOD**는 먼 거리 오브젝트를 단순화된 Proxy Mesh로 대체하여 Draw Call을 줄입니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **HLOD Layer** | 거리별 LOD 레벨 (HLOD0/HLOD1/HLOD2) |
| **Proxy Mesh** | 여러 Actor를 합친 단순 Mesh |
| **Cell Size** | HLOD 생성 단위 (1km, 2km, 4km) |
| **Nanite HLOD** | Nanite 기반 HLOD (UE5.1+) |

---

## 🏗️ HLOD Generation

```
Build Time:
  1. Group Actors by Distance
  2. Merge Meshes (Simplify Geometry)
  3. Bake Lighting (Lightmap)
  4. Generate Proxy Mesh

Runtime:
  Distance < 500m  → Original Actors
  Distance 500~2km → HLOD0 (Medium Detail)
  Distance 2km+    → HLOD1 (Low Detail)
```

---

## 📊 성능

**Scene (10,000 Buildings):**

| 거리 | Draw Calls | FPS |
|------|-----------|-----|
| **No HLOD** | 10,000 | 30 FPS |
| **HLOD ON** | 500 | 60 FPS |

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - HLOD System