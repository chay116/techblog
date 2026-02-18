---
title: "Lumen Surface Cache - Deep Dive"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Lumen"]
---
# Lumen Surface Cache - Deep Dive

## 🧭 개요

Lumen Surface Cache의 **내부 구현**과 **세부 동작 원리**를 다룹니다.

**핵심 주제:**
- **Card Generation**: Mesh → 6-sided OBB Cards
- **Mip Map System**: 9 Resolution Levels (Lumen::NumResLevels)
- **Physical Atlas Allocation**: Page Table + Virtual Texturing
- **Direct Lighting Update**: Shadow Mask + Light Accumulation
- **Card Sharing**: Identical Card 재사용

---

## 🧱 Card Data Structure

### 1. **FLumenCard 상세**

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/Lumen/LumenSceneData.h:273`

```cpp
class FLumenCard
{
public:
    // Bounding Boxes
    FLumenCardOBBf LocalOBB;        // Local Space OBB
    FLumenCardOBBd WorldOBB;        // World Space OBB (Double Precision)
    FLumenCardOBBf MeshCardsOBB;    // Mesh Cards Space OBB

    // Visibility & State
    bool bVisible = false;           // 현재 프레임 가시성
    bool bHeightfield = false;       // Heightfield (Landscape 등)
    bool bAxisXFlipped = false;      // X축 뒤집힘

    ELumenCardDilationMode DilationMode = ELumenCardDilationMode::Disabled;

    // Resolution Levels (Mip Maps)
    uint8 MinAllocatedResLevel = UINT8_MAX;  // 할당된 최소 Res Level
    uint8 MaxAllocatedResLevel = 0;          // 할당된 최대 Res Level
    uint8 DesiredLockedResLevel = 0;         // 요청된 Res Level (거리 기반)

    // MipMap 배열 (9 levels)
    FLumenSurfaceMipMap SurfaceMipMaps[Lumen::NumResLevels];

    // Mesh Cards 참조
    int32 MeshCardsIndex = -1;       // 어떤 Mesh에 속하는지
    int32 IndexInMeshCards = -1;     // Mesh 내 Index
    uint8 IndexInBuildData = UINT8_MAX;
    uint8 AxisAlignedDirectionIndex = UINT8_MAX;  // 방향 (0~5: ±X, ±Y, ±Z)

    float ResolutionScale = 1.0f;    // Resolution Scale Factor
    float CardAspect = 1.0f;         // Aspect Ratio (Width/Height)

    // Card Sharing (Identical Cards)
    FLumenCardId CardSharingId = FLumenCardId::GetInvalidId();
    int32 CardSharingListIndex = INDEX_NONE;

    // Methods
    void Initialize(...);
    void SetTransform(const FMatrix& LocalToWorld, const FLumenMeshCards& MeshCards);
    void UpdateMinMaxAllocatedLevel();
    bool IsAllocated() const { return MinAllocatedResLevel <= MaxAllocatedResLevel; }
    FLumenSurfaceMipMap& GetMipMap(int32 ResLevel);
};
```

### 2. **FLumenSurfaceMipMap**

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/Lumen/LumenSceneData.h:236`

```cpp
struct FLumenSurfaceMipMap
{
    uint8 SizeInPagesX = 0;          // Page 개수 (X축)
    uint8 SizeInPagesY = 0;          // Page 개수 (Y축)
    uint8 ResLevelX = 0;             // Resolution Level (X)
    uint8 ResLevelY = 0;             // Resolution Level (Y)

    int32 PageTableSpanOffset = -1;  // Page Table에서의 시작 Offset
    uint16 PageTableSpanSize = 0;    // Page Table Span 크기
    bool bLocked = false;            // Lock 여부 (필수 Mip)

    bool IsAllocated() const
    {
        return PageTableSpanSize > 0;
    }

    FIntPoint GetSizeInPages() const
    {
        return FIntPoint(SizeInPagesX, SizeInPagesY);
    }

    int32 GetPageTableIndex(int32 LocalPageIndex) const
    {
        return PageTableSpanOffset + LocalPageIndex;
    }
};
```

**MipMap 레벨 구조:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│              Lumen Card Resolution Levels (9 Levels)                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Lumen::MinResLevel = -3                                                │
│  Lumen::MaxResLevel = +5                                                │
│  Lumen::NumResLevels = 9                                                │
│                                                                         │
│  Resolution Level → Actual Resolution:                                  │
│                                                                         │
│  Level -3: 512×512   (Lowest Detail)                                    │
│  Level -2: 724×724                                                      │
│  Level -1: 1024×1024                                                    │
│  Level  0: 1448×1448 (Default)                                          │
│  Level +1: 2048×2048                                                    │
│  Level +2: 2896×2896                                                    │
│  Level +3: 4096×4096                                                    │
│  Level +4: 5793×5793                                                    │
│  Level +5: 8192×8192 (Highest Detail)                                   │
│                                                                         │
│  Distance-based Selection:                                              │
│    - Near Objects (0~10m): Level +3 ~ +5                                │
│    - Medium Distance (10~50m): Level 0 ~ +2                             │
│    - Far Objects (50m+): Level -3 ~ -1                                  │
│                                                                         │
│  Page Count per Level (Example, 4096×4096 Card):                        │
│    - Level +3: 32×32 = 1024 pages (128×128 per page)                   │
│    - Level +1: 16×16 = 256 pages                                        │
│    - Level -1: 8×8 = 64 pages                                           │
│                                                                         │
│  Adaptive Allocation:                                                   │
│    - 모든 레벨이 항상 할당되는 것은 아님                                 │
│    - DesiredLockedResLevel에 따라 일부만 할당                            │
│    - MinAllocatedResLevel ~ MaxAllocatedResLevel 범위만 물리 메모리 사용 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 💡 Card Generation (Mesh Cards)

### 1. **6-sided OBB 생성**

**개념:**

Mesh는 **Oriented Bounding Box (OBB)** 기준으로 6개 방향 Card로 변환됩니다.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  Mesh → 6-sided Card Generation                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Input Mesh:                                                            │
│    ┌───────────────────┐                                                │
│    │                   │                                                │
│    │   Complex Mesh    │                                                │
│    │   (1M triangles)  │                                                │
│    │                   │                                                │
│    └───────────────────┘                                                │
│                                                                         │
│  ▼ OBB Calculation                                                      │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │         Oriented Bounding Box (OBB)                           │     │
│  │  ┌─────────────┐                                              │     │
│  │  │             │  ← OBB.Extent (Half Size)                    │     │
│  │  │      ●      │  ← OBB.Origin (Center)                       │     │
│  │  │             │  ← OBB.AxisX, OBB.AxisY, OBB.AxisZ           │     │
│  │  └─────────────┘                                              │     │
│  └───────────────────────────────────────────────────────────────┘     │
│                                                                         │
│  ▼ 6 Card Generation                                                    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │                     6 Directional Cards                      │       │
│  ├─────────────────────────────────────────────────────────────┤       │
│  │                                                              │       │
│  │  Card 0 (+X): Right Face                                    │       │
│  │    - Direction: +OBB.AxisX                                   │       │
│  │    - Size: OBB.Extent.Y × OBB.Extent.Z                       │       │
│  │    - UV: Project along X axis                                │       │
│  │                                                              │       │
│  │  Card 1 (-X): Left Face                                     │       │
│  │    - Direction: -OBB.AxisX                                   │       │
│  │    - Size: OBB.Extent.Y × OBB.Extent.Z                       │       │
│  │                                                              │       │
│  │  Card 2 (+Y): Front Face                                    │       │
│  │    - Direction: +OBB.AxisY                                   │       │
│  │    - Size: OBB.Extent.X × OBB.Extent.Z                       │       │
│  │                                                              │       │
│  │  Card 3 (-Y): Back Face                                     │       │
│  │    - Direction: -OBB.AxisY                                   │       │
│  │    - Size: OBB.Extent.X × OBB.Extent.Z                       │       │
│  │                                                              │       │
│  │  Card 4 (+Z): Top Face                                      │       │
│  │    - Direction: +OBB.AxisZ                                   │       │
│  │    - Size: OBB.Extent.X × OBB.Extent.Y                       │       │
│  │                                                              │       │
│  │  Card 5 (-Z): Bottom Face                                   │       │
│  │    - Direction: -OBB.AxisZ                                   │       │
│  │    - Size: OBB.Extent.X × OBB.Extent.Y                       │       │
│  │                                                              │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                                                                         │
│  Card Selection (Culling):                                              │
│    - Backface Culling: 뒷면은 렌더링 안 함                              │
│    - Empty Card: 아무 Geometry도 없으면 생성 안 함                      │
│    - Typical Result: 3~4 Cards per Mesh                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. **FLumenCardId (Card Identification)**

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/Lumen/LumenSceneData.h:91`

```cpp
union FLumenCardId
{
    static constexpr uint64 InvalidPackedValue = -1;

    uint64 PackedValue;
    struct
    {
        uint32 ResLevelBiasX : 4;              // Resolution Level Bias X (0~15)
        uint32 ResLevelBiasY : 4;              // Resolution Level Bias Y (0~15)
        uint32 AxisAlignedDirectionIndex : 3;  // Direction (0~5)
        uint32 Unused : 21;
        uint32 CustomId;                       // Mesh Custom ID
    };

    FLumenCardId(uint32 InCustomId, uint8 InAxisAlignedDirectionIndex,
                 uint8 InResLevelBiasX, uint8 InResLevelBiasY);

    bool IsValid() const { return PackedValue != InvalidPackedValue; }
    void Invalidate() { PackedValue = InvalidPackedValue; }
};
```

**Card ID 용도:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    FLumenCardId Usage                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  1. Card Sharing (Instancing)                                           │
│     │                                                                    │
│     ├─ 동일한 Mesh의 여러 Instance가 같은 Card를 공유                   │
│     │   - CustomId: Mesh Unique ID                                      │
│     │   - AxisAlignedDirectionIndex: Card 방향 (0~5)                    │
│     │   - ResLevelBias: Resolution 편차                                 │
│     │                                                                    │
│     ├─ Example: 100개 나무 Instance                                     │
│     │   - 모두 같은 CardId → 1개 Card만 렌더링                          │
│     │   - 99개는 Card 재사용 (메모리 절약)                              │
│     │                                                                    │
│     └─ Hash Map: CardId → Physical Page                                 │
│                                                                         │
│  2. Cache Lookup                                                        │
│     │                                                                    │
│     └─ CardId로 Physical Atlas 위치 검색                                │
│         - O(1) Hash Lookup                                              │
│         - Page Table Index 반환                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 Physical Atlas & Page Table

### 1. **Physical Atlas Layout**

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/Lumen/LumenSceneData.h:44`

```cpp
BEGIN_GLOBAL_SHADER_PARAMETER_STRUCT(FLumenCardScene, )
    SHADER_PARAMETER(uint32, NumCards)
    SHADER_PARAMETER(uint32, NumMeshCards)
    SHADER_PARAMETER(uint32, NumCardPages)
    SHADER_PARAMETER(FVector2f, PhysicalAtlasSize)           // 4096×4096 (기본)
    SHADER_PARAMETER(FVector2f, InvPhysicalAtlasSize)        // 1/4096

    // Physical Atlas Textures
    SHADER_PARAMETER_RDG_TEXTURE(Texture2D, AlbedoAtlas)     // RGBA16F
    SHADER_PARAMETER_RDG_TEXTURE(Texture2D, OpacityAtlas)    // R8
    SHADER_PARAMETER_RDG_TEXTURE(Texture2D, NormalAtlas)     // RGB10A2
    SHADER_PARAMETER_RDG_TEXTURE(Texture2D, EmissiveAtlas)   // RGB11F
    SHADER_PARAMETER_RDG_TEXTURE(Texture2D, DepthAtlas)      // R32F

    // Page Table
    SHADER_PARAMETER_RDG_BUFFER_SRV(ByteAddressBuffer, PageTableBuffer)
END_GLOBAL_SHADER_PARAMETER_STRUCT()
```

**Atlas 구조:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│             Physical Atlas (4096×4096 기본)                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  AlbedoAtlas (RGBA16F):                                                 │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ ┌────┬────┬────┬────┬────┬────┬────┬────┐                  │        │
│  │ │P0  │P1  │P2  │P3  │P4  │P5  │P6  │P7  │ ...              │        │
│  │ │128 │128 │128 │128 │128 │128 │128 │128 │                  │        │
│  │ ├────┼────┼────┼────┼────┼────┼────┼────┤                  │        │
│  │ │P32 │P33 │P34 │P35 │P36 │P37 │P38 │P39 │ ...              │        │
│  │ └────┴────┴────┴────┴────┴────┴────┴────┘                  │        │
│  │ ...                                                          │        │
│  │ (32×32 = 1024 pages per Atlas)                              │        │
│  └────────────────────────────────────────────────────────────┘        │
│                                                                         │
│  NormalAtlas (RGB10A2):                                                 │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ (Same layout as AlbedoAtlas)                                │        │
│  │ 10-bit per channel (Normal X, Y, Z)                         │        │
│  └────────────────────────────────────────────────────────────┘        │
│                                                                         │
│  EmissiveAtlas (RGB11F):                                                │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ (Same layout)                                                │        │
│  │ 11-bit floating point per channel                           │        │
│  └────────────────────────────────────────────────────────────┘        │
│                                                                         │
│  DepthAtlas (R32F):                                                     │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ (Same layout)                                                │        │
│  │ 32-bit float depth                                           │        │
│  └────────────────────────────────────────────────────────────┘        │
│                                                                         │
│  Total Memory (4096×4096):                                              │
│    - Albedo: 128 MB (RGBA16F)                                           │
│    - Normal: 64 MB (RGB10A2)                                            │
│    - Emissive: 64 MB (RGB11F)                                           │
│    - Depth: 64 MB (R32F)                                                │
│    - Total: ~320 MB                                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. **Page Table (Virtual → Physical Mapping)**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Page Table Structure                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Page Table Entry (per Card Page):                                      │
│    struct FLumenPageTableEntry                                          │
│    {                                                                     │
│        uint16 PhysicalPageX;     // Physical Atlas X (0~31)             │
│        uint16 PhysicalPageY;     // Physical Atlas Y (0~31)             │
│        uint8  SampleAtlasBiasX;  // Sub-page offset X                   │
│        uint8  SampleAtlasBiasY;  // Sub-page offset Y                   │
│        uint8  SampleCardResLevelX; // Card Resolution Level X           │
│        uint8  SampleCardResLevelY; // Card Resolution Level Y           │
│        uint16 CardIndex;         // Which Card (0~65535)                │
│        uint8  bValid : 1;        // Valid Flag                          │
│        uint8  bLocked : 1;       // Locked (High Priority)              │
│    };                                                                    │
│                                                                         │
│  Mapping Process:                                                       │
│    1. Card Lookup: CardIndex → FLumenCard                               │
│    2. MipMap Lookup: ResLevel → FLumenSurfaceMipMap                     │
│    3. Page Index Calculation: LocalPageXY → PageTableIndex              │
│    4. Page Table Lookup: PageTableIndex → PhysicalPageXY                │
│    5. Physical Atlas Access: PhysicalPageXY → Texel                     │
│                                                                         │
│  Example:                                                               │
│    - Card 42, ResLevel +1 (2048×2048)                                   │
│    - MipMap: 16×16 pages                                                │
│    - Local Page (5, 7) → PageTableIndex = Offset + 5*16 + 7 = 87       │
│    - PageTable[87] = {PhysicalX: 12, PhysicalY: 8}                     │
│    - Physical Atlas: (12*128, 8*128) ~ (13*128, 9*128)                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## ⚠️ 주의사항

### ❌ 피해야 할 것

**1. 모든 Card를 최고 해상도로:**
```cpp
// ❌ 모든 Card를 Level +5로 고정
r.LumenScene.SurfaceCache.CardMinResLevel = 5
r.LumenScene.SurfaceCache.CardMaxResLevel = 5
// → Atlas 공간 부족, VRAM 폭증
```

**2. 너무 많은 Mesh Cards:**
```cpp
// ❌ 작은 Mesh에 Card 생성
Small Prop (10 triangles) → Lumen Mesh Cards
// → Card 생성 오버헤드 > 이득
```

**3. Physical Atlas 크기 과도하게 증가:**
```cpp
// ❌ 8K Atlas
r.LumenScene.SurfaceCache.AtlasSize = 8192
// → VRAM: 320MB → 1.2GB!
```

### ✅ 올바른 방법

**1. Adaptive Resolution:**
```cpp
// ✅ 거리 기반 자동 조정
r.LumenScene.SurfaceCache.CardMinResLevel = -3  // 512×512
r.LumenScene.SurfaceCache.CardMaxResLevel = 5   // 8192×8192
// Lumen이 자동으로 거리에 따라 선택
```

**2. 적절한 Mesh 선택:**
```cpp
// ✅ 큰 Static Mesh만
Large Building (>10,000 tris) → Enable Lumen Scene
Small Props → Disable (or use existing lighting)
```

**3. Card Sharing 활용:**
```cpp
// ✅ Instanced Static Mesh
100 Trees → Same Mesh Asset
// → 1개 Card Set만 렌더링, 99개는 공유
```

---

## 🔗 참조 자료

**소스 파일:**
- `Engine/Source/Runtime/Renderer/Private/Lumen/LumenSceneData.h:273` - FLumenCard
- `Engine/Source/Runtime/Renderer/Private/Lumen/LumenSceneData.h:236` - FLumenSurfaceMipMap
- `Engine/Source/Runtime/Renderer/Private/Lumen/LumenSceneData.h:44` - FLumenCardScene

**관련 문서:**
- [Lumen_Overview.md](Lumen_Overview.md) - Lumen 기본 개념
- [Lumen_RadianceCache_Deep_Dive.md](Lumen_RadianceCache_Deep_Dive.md) - Radiance Cache 상세
- [Lumen_Optimization.md](Lumen_Optimization.md) - 성능 최적화

**외부 자료:**
- GDC 2021: "A Deep Dive into Lumen" - Surface Cache 섹션
- SIGGRAPH 2021: "Lumen: Real-time Global Illumination"

---

> 🔄 작성: 2025-11-22 — Lumen Surface Cache 심층 분석
