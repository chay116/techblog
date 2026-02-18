---
title: "World Partition & Streaming Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "World"
tags: ["unreal", "World"]
engine_version: "Unreal Engine 5.7"
---
# World Partition & Streaming Deep Dive

## 🧭 개요

**World Partition**은 UE5의 대규모 오픈월드 스트리밍 시스템입니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Grid-based Streaming** | 월드를 격자로 나누어 로딩 |
| **Runtime Hash** | 동적 Cell 로드/언로드 |
| **Data Layers** | 레이어별 선택적 로딩 (Lighting/Gameplay/Audio) |
| **HLOD** | 먼 거리 LOD (Hierarchical LOD) |

---

## 🏗️ World Partition Structure

```
World (100km²)
    ↓
Divided into Cells (2km × 2km each)
    ↓
Player 위치 기준:
  - Load Radius (5km): Streaming IN
  - Unload Radius (7km): Streaming OUT
    ↓
Per Cell:
  - Actors (Static Mesh, Lights, etc.)
  - Landscape Streaming Proxies
  - HLOD Meshes
```

---

## 🎮 설정

```cpp
// World Partition 활성화 (Project Settings)
[/Script/Engine.WorldPartition]
bEnableWorldPartition=True
GridSize=20000  ; 200m Grid

// Data Layer 사용
UDataLayerAsset* LightingLayer = ...;
Actor->AddDataLayer(LightingLayer);

// Runtime Toggle
UDataLayerSubsystem* DLS = GetWorld()->GetSubsystem<UDataLayerSubsystem>();
DLS->SetDataLayerRuntimeState(LightingLayer, EDataLayerRuntimeState::Activated);
```

---

## 📊 성능

**오픈월드 (25km²):**
- Loaded Cells: ~50 (Player 주변만)
- Streaming Time: ~100ms (Background Thread)
- Memory: ~2GB (Loaded Cells만)

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - World Partition