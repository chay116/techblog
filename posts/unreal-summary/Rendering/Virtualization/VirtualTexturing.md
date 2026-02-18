---
title: "Virtual Texturing Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Virtualization"]
engine_version: "Unreal Engine 5.7"
---
# Virtual Texturing Deep Dive

## 🧭 개요

**Virtual Texturing**은 초대형 텍스처를 타일 기반으로 스트리밍하여 메모리를 절약합니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Virtual Texture** | 논리적으로 큰 텍스처 (예: 16K×16K) |
| **Physical Texture** | 실제 GPU 메모리 (예: 4K×4K Cache) |
| **Tile** | 128×128 픽셀 단위로 분할 |
| **Page Table** | Virtual → Physical 매핑 테이블 |
| **Feedback Buffer** | 필요한 Tile 요청 정보 |
| **RVT** | Runtime Virtual Texture (동적 생성) |

---

## 🏗️ Virtual Texture Pipeline

```
┌─────────────────────────────────────────────────────────┐
│         Phase 1: Feedback Pass (Tile Request)           │
├─────────────────────────────────────────────────────────┤
│  Render Scene with Low-Res Proxy                        │
│    → Feedback Buffer records requested Tiles            │
│    → Example: Pixel needs Tile (X=10, Y=5, Mip=2)       │
└──────────────────────┼───────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│      Phase 2: Streaming (Load Tiles from Disk)          │
├─────────────────────────────────────────────────────────┤
│  Feedback Buffer → Tile Requests                        │
│    → Async Load Tiles from .uasset/.utexture           │
│    → Decompress (BC7/ASTC)                              │
│    → Upload to Physical Texture Cache                   │
└──────────────────────┼───────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│       Phase 3: Page Table Update                        │
├─────────────────────────────────────────────────────────┤
│  Page Table[Virtual Tile ID] = Physical Tile Address    │
│    → GPU can now sample from Physical Cache             │
└──────────────────────┼───────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│          Phase 4: Final Render                          │
├─────────────────────────────────────────────────────────┤
│  Material Shader:                                       │
│    VirtualUV → Page Table Lookup → Physical UV          │
│    Sample Physical Texture                              │
└─────────────────────────────────────────────────────────┘
```

---

## 🎮 Runtime Virtual Texture (RVT)

RVT는 **동적으로 생성**되는 가상 텍스처입니다 (Landscape, Decal 투영 등).

### RVT 설정

```cpp
// Runtime Virtual Texture Component
URuntimeVirtualTextureComponent* RVT = NewObject<URuntimeVirtualTextureComponent>(this);
RVT->SetVirtualTexture(MyRVTAsset);

// RVT Asset 설정
URuntimeVirtualTexture* RVTAsset = NewObject<URuntimeVirtualTexture>();
RVTAsset->TileCount = 1024;          // 1024×1024 Tiles
RVTAsset->TileSize = 128;            // 128×128 pixels per tile
RVTAsset->TileBorderSize = 4;        // Border for filtering

// Material Type
RVTAsset->MaterialType = ERuntimeVirtualTextureMaterialType::BaseColor_Normal_Roughness;
```

### RVT Material Sampling

```cpp
// Material Function: RuntimeVirtualTextureSample
FLinearColor BaseColor, Normal, Roughness;
MaterialExpressionRuntimeVirtualTextureSample(
    RVT,
    UV,
    BaseColor,
    Normal,
    Roughness
);

// Output
Material.BaseColor = BaseColor;
Material.Normal = Normal;
Material.Roughness = Roughness;
```

---

## 🗺️ Landscape RVT 예시

```cpp
// Landscape with RVT
ALandscape* Landscape = GetWorld()->SpawnActor<ALandscape>();

// Enable RVT
Landscape->bUseRVT = true;
Landscape->RuntimeVirtualTexture = RVTAsset;

// Material: Sample from RVT instead of individual textures
// Before (4 Texture Samples):
//   DiffuseTexture, NormalTexture, RoughnessTexture, AOTexture

// After (1 RVT Sample):
//   RuntimeVirtualTextureSample(RVT, UV)
//   → All 4 channels in one lookup!
```

**메모리 절약:**
- **Before**: 4×4K Textures = 64MB per material
- **After**: 1 RVT (shared across all materials) = 16MB

---

## 🚀 성능 최적화

### Tile Cache Size

```ini
[SystemSettings]
; Larger cache = fewer tile loads (but more VRAM)
r.VirtualTexture.PhysicalPoolSize=512  ; MB

; Tile Size (128 recommended)
r.VirtualTexture.TileSize=128
```

### Async Streaming

```cpp
// Prefetch Tiles (before camera moves)
RVT->PrefetchTiles(BoundsMin, BoundsMax, MipLevel);

// Example: Open World Streaming
void AMyGameMode::Tick(float DeltaTime)
{
    FVector PlayerPos = GetPlayerPosition();
    FBox PrefetchBounds = FBox(PlayerPos - FVector(5000), PlayerPos + FVector(5000));

    RVT->PrefetchTiles(PrefetchBounds, /*MipLevel=*/0);
}
```

---

## 📊 성능

**Landscape RVT (8K×8K):**

| 항목 | Without RVT | With RVT |
|------|-------------|----------|
| **VRAM** | 256MB (4 textures) | 64MB (1 RVT) |
| **Texture Samples** | 4 per pixel | 1 per pixel |
| **Streaming** | Load all 256MB | Stream tiles (16MB active) |

---

## 🔗 참고 자료

**소스:**
- `Renderer/Private/VirtualTexturing/`
- `Engine/Public/VT/RuntimeVirtualTexture.h`

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Virtual Texturing
  - RVT (Runtime Virtual Texture)
  - Tile-based Streaming
  - Landscape RVT 최적화