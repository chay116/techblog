---
title: "Mesh Distance Field (Mesh SDF) 심층 분석"
date: "2025-12-02"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Lumen"
tags: ["unreal", "Lumen"]
---
# Mesh Distance Field (Mesh SDF) 심층 분석

> Updated: 2025-12-02 — Lumen 엔진 코드 기반 심층 분석 문서 최초 작성

## 🧭 Overview

Mesh Distance Field는 각 Static Mesh의 표면으로부터의 **Signed Distance**를 저장하는 3D 볼륨 데이터입니다. Lumen의 Software Ray Tracing, Distance Field Ambient Occlusion, Movable SkyLight 그림자 등에 핵심적으로 사용됩니다.

### 핵심 개념

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Signed Distance Field (SDF)                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  SDF(x) = 점 x에서 가장 가까운 표면까지의 거리                             │
│                                                                         │
│  • SDF(x) > 0  →  점이 메쉬 외부에 있음                                  │
│  • SDF(x) < 0  →  점이 메쉬 내부에 있음                                  │
│  • SDF(x) = 0  →  점이 메쉬 표면 위에 있음                               │
│                                                                         │
│  Sphere Tracing: SDF 값만큼 안전하게 전진 가능                            │
│                                                                         │
│      Ray ─────●──────────────●────────────●──●                         │
│               │              │            │  │                          │
│         step = SDF(p0)  step = SDF(p1)   ...  Surface                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧱 데이터 구조

### 1. 핵심 상수 정의

**📂 위치:** `Engine/Source/Runtime/Engine/Public/DistanceFieldAtlas.h:35-50`

```cpp
namespace DistanceField
{
    // 메쉬 그라디언트 처리를 위한 1 복셀 보더
    inline constexpr int32 MeshDistanceFieldObjectBorder = 1;

    // 패딩 제외한 브릭 내 유효 데이터 크기
    inline constexpr int32 UniqueDataBrickSize = 7;

    // Trilinear 필터링을 위한 0.5 복셀 보더 포함 브릭 크기
    inline constexpr int32 BrickSize = 8;

    // SDF 메모리와 트레이싱 스텝 수의 트레이드오프
    inline constexpr int32 BandSizeInVoxels = 4;

    // Mip 레벨 수
    inline constexpr int32 NumMips = 3;

    // 무효 브릭 인덱스 마커
    inline constexpr uint32 InvalidBrickIndex = 0xFFFFFFFF;

    // SDF 저장 포맷 (8비트 단일 채널)
    inline constexpr EPixelFormat DistanceFieldFormat = PF_G8;

    // Indirection 테이블 최대 차원
    inline constexpr uint32 MaxIndirectionDimension = 1024;
};
```

### 2. Sparse Distance Field Mip 구조

**📂 위치:** `Engine/Source/Runtime/Engine/Public/DistanceFieldAtlas.h:198-237`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      FSparseDistanceFieldMip                            │
│  (각 Mip 레벨의 SDF 데이터 구조)                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  IndirectionDimensions : FInt32Vector                                   │
│    └─ Indirection 테이블의 3D 크기 (가상 UV 공간)                         │
│                                                                         │
│  NumDistanceFieldBricks : int32                                         │
│    └─ 이 Mip에 할당된 실제 브릭 수                                        │
│                                                                         │
│  VolumeToVirtualUVScale : FVector3f                                     │
│  VolumeToVirtualUVAdd : FVector3f                                       │
│    └─ Volume Space → Virtual UV 변환                                    │
│                                                                         │
│  DistanceFieldToVolumeScaleBias : FVector2f                             │
│    └─ 인코딩된 거리 → Volume Space 거리 변환                              │
│       Distance = Encoded * Scale + Bias                                 │
│                                                                         │
│  BulkOffset / BulkSize : uint32                                         │
│    └─ 스트리밍 데이터 오프셋/크기                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3. Distance Field Volume Data

**📂 위치:** `Engine/Source/Runtime/Engine/Public/DistanceFieldAtlas.h:240-303`

```cpp
class FDistanceFieldVolumeData : public FDeferredCleanupInterface
{
public:
    // 로컬 공간 바운딩 박스
    FBox3f LocalSpaceMeshBounds;

    // 대부분 양면 머티리얼 사용 여부
    bool bMostlyTwoSided;

    // 비동기 빌드 중 여부
    bool bAsyncBuilding;

    // 3개 Mip 레벨 데이터 (Mip0 = 최저 해상도, Mip2 = 최고 해상도)
    TStaticArray<FSparseDistanceFieldMip, DistanceField::NumMips> Mips;

    // 항상 로드되는 최저 해상도 Mip (Mip0)
    TArray<uint8> AlwaysLoadedMip;

    // 스트리밍되는 고해상도 Mip들 (Mip1, Mip2)
    FByteBulkData StreamableMips;

    // 고유 ID (Scene 내 참조용)
    uint64 Id;
};
```

---

## 📦 Sparse Brick 기반 저장 구조

### 1. 계층적 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Sparse Brick Storage                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Indirection Table                            │   │
│  │  (Volume Space → Brick Index 매핑)                              │   │
│  │                                                                 │   │
│  │   ┌───┬───┬───┬───┐                                            │   │
│  │   │ 5 │INV│INV│ 2 │  INV = 0xFFFFFFFF (빈 공간)                 │   │
│  │   ├───┼───┼───┼───┤                                            │   │
│  │   │INV│ 7 │INV│INV│  숫자 = Brick Atlas 내 인덱스              │   │
│  │   ├───┼───┼───┼───┤                                            │   │
│  │   │ 1 │INV│ 3 │INV│                                            │   │
│  │   └───┴───┴───┴───┘                                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Brick Atlas (3D Texture)                     │   │
│  │                                                                 │   │
│  │   ┌─────┬─────┬─────┬─────┬─────┐                              │   │
│  │   │Brick│Brick│Brick│Brick│Brick│                              │   │
│  │   │  0  │  1  │  2  │  3  │  4  │  ...                         │   │
│  │   │ 8³  │ 8³  │ 8³  │ 8³  │ 8³  │                              │   │
│  │   └─────┴─────┴─────┴─────┴─────┘                              │   │
│  │   각 Brick = 8×8×8 복셀 (7×7×7 유효 데이터 + 보더)              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  장점:                                                                  │
│  • 표면 근처에만 브릭 할당 → 메모리 효율                                 │
│  • 빈 공간/내부는 INVALID_BRICK_INDEX → 최대 인코딩 거리 반환            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. CVar 설정

**📂 위치:** `Engine/Source/Runtime/Renderer/Private/DistanceFieldStreaming.cpp:32-73`

```cpp
// Brick Atlas X, Y 크기 (브릭 단위)
CVarBrickAtlasSizeXYInBricks = 128;  // 128 × 128 = 16,384 브릭/슬라이스

// Atlas Z 방향 최대 깊이 (브릭 단위)
CVarMaxAtlasDepthInBricks = 32;      // 32 슬라이스
// 총 Atlas 크기: 128 × 128 × 32 × 8³ = 256MB 최대

// 프레임당 최대 업로드 (스트리밍)
CVarTextureUploadLimitKBytes = 8192; // 8MB/프레임
```

---

## 🔄 SDF 빌드 파이프라인

### 1. 빌드 프로세스 시퀀스

```
    Editor              StaticMesh          AsyncQueue        MeshUtilities
       │                     │                   │                   │
       │  Import/Modify      │                   │                   │
       ├────────────────────>│                   │                   │
       │                     │ CacheDerivedData  │                   │
       │                     ├──────────────────>│                   │
       │                     │                   │                   │
       │                     │  DDC Hit?         │                   │
       │                     │<──────────────────┤                   │
       │                     │                   │                   │
       │                     │  [DDC Miss]       │                   │
       │                     │                   │ AddTask           │
       │                     │                   ├──────────────────>│
       │                     │                   │                   │
       │                     │                   │  Background Build │
       │                     │                   │<──────────────────┤
       │                     │                   │                   │
       │                     │  ProcessAsyncTask │                   │
       │                     │<──────────────────┤                   │
       │                     │                   │                   │
       │                     │  Store to DDC     │                   │
       │                     │──────────────────>│                   │
       │                     │                   │                   │
```

### 2. DDC Key 생성

**📂 위치:** `Engine/Source/Runtime/Engine/Private/DistanceFieldAtlas.cpp:161-176`

```cpp
FString BuildDistanceFieldDerivedDataKey(const FString& InMeshKey)
{
    // MaxPerMeshResolution CVar 값 포함
    const int32 PerMeshMax = CVar->GetValueOnAnyThread();

    // DefaultVoxelDensity CVar 값 포함
    const float VoxelDensity = CVarDensity->GetValueOnAnyThread();

    // DDC 버전: "DC2427EE-AD20-4226-ADAD-15CAEB4FC9AB"
    return FDerivedDataCacheInterface::BuildCacheKey(
        TEXT("DIST"),
        *FString::Printf(TEXT("%s_%s%s%s"),
            *InMeshKey,
            DISTANCEFIELD_DERIVEDDATA_VER,
            *PerMeshMaxString,
            *VoxelDensityString),
        TEXT(""));
}
```

### 3. 비동기 빌드 태스크

**📂 위치:** `Engine/Source/Runtime/Engine/Private/DistanceFieldAtlas.cpp:898-960`

```cpp
void FDistanceFieldAsyncQueue::Build(FAsyncDistanceFieldTask* Task,
                                      FQueuedThreadPool& BuildThreadPool)
{
    // LOD 0의 렌더 데이터 사용
    const FStaticMeshLODResources& LODModel =
        Task->GenerateSource->GetRenderData()->LODResources[0];

    // 메쉬 데이터 준비
    FMeshDataForDerivedDataTask MeshData;
    MeshData.SourceMeshData = &Task->SourceMeshData;
    MeshData.LODModel = &LODModel;
    MeshData.SectionData = Task->SectionData;
    MeshData.Bounds = Task->GenerateSource->GetRenderData()->Bounds;

    // SDF 생성 (IMeshUtilities 인터페이스 사용)
    MeshUtilities->GenerateSignedDistanceFieldVolumeData(
        Task->StaticMesh->GetName(),
        MeshData,
        Task->DistanceFieldResolutionScale,
        Task->bGenerateDistanceFieldAsIfTwoSided,
        *Task->GeneratedVolumeData);

    // Card Representation도 함께 생성 (Lumen Surface Cache용)
    FAsyncCardRepresentationTask* CardTask =
        BeginCacheMeshCardRepresentationInternal(...);
}
```

---

## 📡 스트리밍 시스템

### 1. Mip 기반 스트리밍 전략

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Mip-based Streaming                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │   Mip 0 (Lowest Resolution)                                     │   │
│  │   • 항상 메모리에 로드됨 (AlwaysLoadedMip)                        │   │
│  │   • 가장 넓은 Band (먼 거리용)                                    │   │
│  │   • 대략적인 거리 정보                                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              ↓ 거리 가까워짐                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │   Mip 1 (Medium Resolution)                                     │   │
│  │   • 스트리밍 대상 (StreamableMips)                               │   │
│  │   • 중간 거리 트레이싱용                                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              ↓ 거리 더 가까워짐                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │   Mip 2 (Highest Resolution)                                    │   │
│  │   • 스트리밍 대상                                                │   │
│  │   • 가장 좁은 Band (표면 근처 정밀 트레이싱)                       │   │
│  │   • 정확한 Hit 위치 결정                                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  스트리밍 영역 (카메라 기준):                                           │
│                                                                         │
│    ┌─────────────────────────────────────────┐                         │
│    │              Mip0 영역                  │ ← 먼 거리               │
│    │    ┌─────────────────────────────┐     │                         │
│    │    │         Mip1 영역           │     │ ← 중간 거리              │
│    │    │    ┌─────────────────┐     │     │                         │
│    │    │    │   Mip2 영역     │     │     │ ← 가까운 거리            │
│    │    │    │    [Camera]     │     │     │                         │
│    │    │    └─────────────────┘     │     │                         │
│    │    └─────────────────────────────┘     │                         │
│    └─────────────────────────────────────────┘                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. GPU 기반 스트리밍 요청 생성

**📂 위치:** `Engine/Shaders/Private/DistanceFieldStreaming.usf:114-175`

```hlsl
// GPU에서 각 오브젝트가 필요로 하는 Mip 레벨 계산
[numthreads(THREADGROUP_SIZE, 1, 1)]
void ComputeDistanceFieldAssetWantedMipsCS(...)
{
    if (ObjectIndex < NumSceneObjects)
    {
        uint WantedNumMips = 1;  // 기본: Mip0만

        if (DebugForceNumMips == 0)
        {
            FDFObjectBounds DFObjectBounds = LoadDFObjectBounds(ObjectIndex);
            const float3 TranslatedCenter = DFFastAddDemote(
                DFObjectBounds.Center, PreViewTranslation);

            // 오브젝트가 Mip1 영역 내에 있는지 체크
            float OuterDistanceSq = ComputeSquaredDistanceBetweenAABBs(
                Mip1WorldTranslatedCenter, Mip1WorldExtent,
                TranslatedCenter, DFObjectBounds.BoxExtent);

            if (OuterDistanceSq <= 0)
            {
                // Mip2 영역 내에 있는지 체크
                float InnerDistanceSq = ComputeSquaredDistanceBetweenAABBs(
                    Mip2WorldTranslatedCenter, Mip2WorldExtent,
                    TranslatedCenter, DFObjectBounds.BoxExtent);

                WantedNumMips = InnerDistanceSq <= 0 ? 3 : 2;
            }
        }

        // Asset별 최대 필요 Mip 기록 (Atomic Max)
        if (WantedNumMips > 1)
        {
            FDFObjectData DFObjectData = LoadDFObjectData(ObjectIndex);
            InterlockedMax(RWDistanceFieldAssetWantedNumMips[DFObjectData.AssetIndex],
                          WantedNumMips);
        }
    }
}
```

### 3. Scatter Upload

**📂 위치:** `Engine/Shaders/Private/DistanceFieldStreaming.usf:26-52`

```hlsl
// 브릭 데이터를 Atlas에 분산 업로드
[numthreads(THREADGROUP_SIZE, THREADGROUP_SIZE, THREADGROUP_SIZE)]
void ScatterUploadDistanceFieldAtlasCS(...)
{
    uint BrickOffsetIndex = GroupId.z * THREADGROUP_SIZE / BrickSize;

    if (BrickOffsetIndex < NumBrickUploads)
    {
        uint BrickIndex = StartBrickIndex + BrickOffsetIndex;
        uint3 VoxelCoordinate = DispatchThreadId % BrickSize;

        // 선형 인덱스에서 브릭 내 위치 계산
        uint UploadDataReadIndex = BrickIndex * BrickSize * BrickSize * BrickSize
            + (VoxelCoordinate.z * BrickSize + VoxelCoordinate.y) * BrickSize
            + VoxelCoordinate.x;

        // Atlas 내 목표 좌표
        uint3 BrickAtlasCoordinate = BrickUploadCoordinates[BrickIndex].xyz;

        // 거리 값 쓰기
        RWDistanceFieldBrickAtlas[BrickAtlasCoordinate * BrickSize + VoxelCoordinate]
            = BrickUploadData[UploadDataReadIndex];
    }
}
```

---

## 🎯 샘플링 알고리즘

### 1. Sparse Mesh SDF 샘플링

**📂 위치:** `Engine/Shaders/Private/DistanceFieldLightingShared.ush:392-436`

```hlsl
float SampleSparseMeshSignedDistanceField(float3 SampleVolumePosition,
                                          FDFAssetData DFAssetData)
{
    // 1. Volume Space → Indirection Space 변환
    float3 IndirectionPos = SampleVolumePosition
        * DFAssetData.VolumeToIndirectionScale
        + DFAssetData.VolumeToIndirectionAdd;

    int3 IndirectionCoord = IndirectionPos;

    // 2. Indirection 테이블에서 Brick Index 로드
#if OFFSET_DATA_STRUCT == 0
    uint IndirectionIndex = (IndirectionCoord.z * DFAssetData.IndirectionDimensions.y
        + IndirectionCoord.y) * DFAssetData.IndirectionDimensions.x
        + IndirectionCoord.x;

    uint BrickIndex = DistanceFieldIndirectionTable.Load(
        (DFAssetData.IndirectionTableOffset + IndirectionIndex) * 4);
    bool ValidBrick = BrickIndex != INVALID_BRICK_INDEX;
#endif

    // 3. 최대 인코딩 거리 계산 (브릭이 없으면 이 값 반환)
    float MaxEncodedDistance = DFAssetData.DistanceFieldToVolumeScaleBias.x
        + DFAssetData.DistanceFieldToVolumeScaleBias.y;
    float DistanceField = MaxEncodedDistance;

    // 4. 유효한 브릭이면 실제 거리 샘플링
    if (ValidBrick)
    {
        // 브릭 내 로컬 UV
        float3 BrickLocalUV = IndirectionPos - IndirectionCoord;

        // Brick Index → 3D Atlas 좌표 디컴포즈
        float3 BrickOffset = uint3(
            BrickIndex & DistanceFieldBrickAtlasMask.x,
            (BrickIndex >> DistanceFieldBrickAtlasSizeLog2.x)
                & DistanceFieldBrickAtlasMask.y,
            BrickIndex >> (DistanceFieldBrickAtlasSizeLog2.x
                + DistanceFieldBrickAtlasSizeLog2.y));

        // Atlas UV 계산 (반복셀 보더 포함)
        float3 AtlasUV = BrickOffset * DistanceFieldBrickOffsetToAtlasUVScale
            + BrickLocalUV * DistanceFieldUniqueDataBrickSizeInAtlasTexels
            + DistanceFieldBrickAtlasHalfTexelSize;

        // Trilinear 샘플링
        float EncodedDistanceField = SampleDistanceFieldBrickTexture(AtlasUV);

        // 디코딩: Encoded * Scale + Bias
        DistanceField = EncodedDistanceField
            * DFAssetData.DistanceFieldToVolumeScaleBias.x
            + DFAssetData.DistanceFieldToVolumeScaleBias.y;
    }

    return DistanceField;
}
```

### 2. Multi-Mip 샘플링 (정확한 거리)

**📂 위치:** `Engine/Shaders/Private/DistanceFieldLightingShared.ush:452-472`

```hlsl
// 표면 근처에서 정확한 거리 반환
float DistanceToMeshSurfaceStandalone(float3 SampleVolumePosition,
                                      FDFObjectData DFObjectData)
{
    uint NumMips = LoadDFAssetData(DFObjectData.AssetIndex, 0).NumMips;
    float DistanceField = 0;

    // 저해상도 → 고해상도 순으로 샘플링
    for (uint ReversedMipIndex = 0; ReversedMipIndex < NumMips; ReversedMipIndex++)
    {
        FDFAssetData DFAssetMipData = LoadDFAssetData(
            DFObjectData.AssetIndex, ReversedMipIndex);

        DistanceField = SampleSparseMeshSignedDistanceField(
            SampleVolumePosition, DFAssetMipData);

        // 표면에서 충분히 멀면 현재 Mip으로 충분
        float MaxEncodedDistance = DFAssetMipData.DistanceFieldToVolumeScaleBias.x
            + DFAssetMipData.DistanceFieldToVolumeScaleBias.y;

        if (abs(DistanceField) > 0.25 * MaxEncodedDistance)
        {
            break;  // 더 고해상도 Mip 불필요
        }
    }

    return DistanceField;
}
```

---

## 🔍 오브젝트 컬링

### 1. View Frustum Culling

**📂 위치:** `Engine/Shaders/Private/DistanceFieldObjectCulling.usf:21-105`

```hlsl
[numthreads(UPDATEOBJECTS_THREADGROUP_SIZE, 1, 1)]
void CullObjectsForViewCS(uint GroupIndex : SV_GroupIndex, uint3 GroupId : SV_GroupID)
{
    const uint ObjectIndex = GetUnWrappedDispatchThreadId(GroupId, GroupIndex,
                                                          UPDATEOBJECTS_THREADGROUP_SIZE);

    if (GroupIndex == 0)
    {
        NumGroupObjects = 0;
    }
    GroupMemoryBarrierWithGroupSync();

    if (ObjectIndex < NumSceneObjects)
    {
        FDFObjectBounds DFObjectBounds = LoadDFObjectBounds(ObjectIndex);
        const float3 TranslatedCenter = DFFastToTranslatedWorld(
            DFObjectBounds.Center, PrimaryView.PreViewTranslation);

        float DistanceToViewSq = GetDistanceToCameraFromViewVectorSqr(
            PrimaryView.TranslatedWorldCameraOrigin - TranslatedCenter);

        // 거리 및 Frustum 컬링
        if (DistanceToViewSq < Square(AOMaxViewDistance + DFObjectBounds.SphereRadius)
            && ViewFrustumIntersectSphere(TranslatedCenter,
                                          DFObjectBounds.SphereRadius + AOObjectMaxDistance))
        {
            FDFObjectData DFObjectData = LoadDFObjectData(ObjectIndex);

            // Min/Max Draw Distance 체크
            if ((DFObjectData.MinMaxDrawDistance2.x < 0.0001
                    || DistanceToViewSq > DFObjectData.MinMaxDrawDistance2.x)
                && (DFObjectData.MinMaxDrawDistance2.y < 0.0001
                    || DistanceToViewSq < DFObjectData.MinMaxDrawDistance2.y))
            {
                uint DestIndex;
                InterlockedAdd(NumGroupObjects, 1U, DestIndex);
                GroupObjectIndices[DestIndex] = ObjectIndex;
            }
        }
    }

    GroupMemoryBarrierWithGroupSync();

    // 그룹 내 결과를 전역 버퍼에 기록
    if (GroupIndex == 0)
    {
        InterlockedAdd(RWObjectIndirectArguments[1], NumGroupObjects, GroupBaseIndex);
    }
    GroupMemoryBarrierWithGroupSync();

    if (GroupIndex < NumGroupObjects)
    {
        RWCulledObjectIndices[GroupBaseIndex + GroupIndex] = GroupObjectIndices[GroupIndex];
    }
}
```

### 2. Tile-based 세밀 컬링

**📂 위치:** `Engine/Shaders/Private/DistanceFieldObjectCulling.usf:261-374`

```hlsl
// SDF 기반 정밀 타일-오브젝트 교차 테스트
bool IntersectObjectWithConeDepthRange(
    float3 TileConeVertex, float3 TileConeAxis,
    float TileConeAngleCos, float TileConeAngleSin,
    float2 ConeDepthRange, float2 ConeAxisDistanceMinMax,
    uint ObjectIndex)
{
    if (ConeAxisDistanceMinMax.x > ConeDepthRange.x
        && ConeAxisDistanceMinMax.y < ConeDepthRange.y)
    {
        FDFObjectData DFObjectData = LoadDFObjectData(ObjectIndex);
        float4x4 TranslatedWorldToVolume = DFFastToTranslatedWorld(
            DFObjectData.WorldToVolume, PrimaryView.PreViewTranslation);

        // 타일 깊이 범위의 바운딩 구 계산
        float3 ViewTileBoundingSphereCenter = TileConeVertex
            + TileConeAxis * (0.5 * (ConeDepthRange.x + ConeDepthRange.y));
        float DistanceAlongAxis = 0.5 * (ConeDepthRange.y - ConeDepthRange.x);
        float FarDepthDistanceToEdgeOfCone = ConeDepthRange.y * TileConeAngleSin
            / TileConeAngleCos;
        float TileBoundingSphereRadius = sqrt(
            DistanceAlongAxis * DistanceAlongAxis
            + FarDepthDistanceToEdgeOfCone * FarDepthDistanceToEdgeOfCone);

        // Volume Space에서 박스 거리 테스트
        float3 VolumeTileBoundingSphereCenter = mul(
            float4(TranslatedWorldTileBoundingSphereCenter, 1),
            TranslatedWorldToVolume).xyz;
        float BoxDistance = ComputeDistanceFromBoxToPoint(
            -DFObjectData.VolumePositionExtent,
            DFObjectData.VolumePositionExtent,
            VolumeTileBoundingSphereCenter) * DFObjectData.VolumeScale;

        if (BoxDistance < TileBoundingSphereRadius + AOObjectMaxDistance)
        {
            // SDF 샘플링으로 정밀 테스트
            float3 ClampedSamplePosition = clamp(
                VolumeTileBoundingSphereCenter,
                -DFObjectData.VolumePositionExtent,
                DFObjectData.VolumePositionExtent);
            float DistanceToClamped = length(
                VolumeTileBoundingSphereCenter - ClampedSamplePosition);
            float DistanceToOccluder = (DistanceToMeshSurfaceStandalone(
                ClampedSamplePosition, DFObjectData) + DistanceToClamped)
                * DFObjectData.VolumeScale;

            if (DistanceToOccluder < TileBoundingSphereRadius + AOObjectMaxDistance)
            {
                return true;
            }
        }
    }
    return false;
}
```

---

## 📊 GPU 데이터 구조

### 1. Object Bounds 버퍼

**📂 위치:** `Engine/Shaders/Private/DistanceFieldLightingShared.ush:149-201`

```hlsl
// Stride: 3 float4's
struct FDFObjectBounds
{
    FDFVector3 Center;      // World Space 중심 (High + Low 정밀도)
    float SphereRadius;     // 바운딩 구 반경
    float3 BoxExtent;       // AABB 익스텐트
    uint OftenMoving;       // 동적 오브젝트 플래그
    bool bVisible;          // 가시성
    uint bCastShadow;       // 그림자 캐스팅
    bool bIsNaniteMesh;     // Nanite 메쉬 여부
    uint bEmissiveLightSource;
    bool bAffectIndirectLightingWhileHidden;
};

FDFObjectBounds LoadDFObjectBounds(uint ObjectIndex)
{
    FDFObjectBounds Bounds;

    float4 Vector0 = SceneObjectBounds[ObjectIndex * DF_OBJECT_BOUNDS_STRIDE + 0];
    float4 Vector1 = SceneObjectBounds[ObjectIndex * DF_OBJECT_BOUNDS_STRIDE + 1];
    float4 Vector2 = SceneObjectBounds[ObjectIndex * DF_OBJECT_BOUNDS_STRIDE + 2];

    // High + Low 정밀도 위치 조합
    Bounds.Center = MakeDFVector3(Vector0.xyz, Vector1.xyz);
    Bounds.SphereRadius = Vector1.w;
    Bounds.BoxExtent = Vector2.xyz;

    // 플래그 언팩
    uint Flags = asuint(Vector2.w);
    Bounds.OftenMoving = Flags & 1U;
    Bounds.bCastShadow = (Flags & 2U) != 0U;
    // ...

    return Bounds;
}
```

### 2. Object Data 버퍼

**📂 위치:** `Engine/Shaders/Private/DistanceFieldLightingShared.ush:232-301`

```hlsl
// Stride: 10 float4's
struct FDFObjectData
{
    float3 VolumePositionExtent;   // Volume Space 익스텐트
    float VolumeSurfaceBias;       // 표면 바이어스
    bool bMostlyTwoSided;          // 양면 머티리얼
    float VolumeScale;             // Volume → World 스케일
    float SelfShadowBias;          // 셀프 섀도 바이어스
    float2 MinMaxDrawDistance2;    // 드로우 거리 제곱
    uint GPUSceneInstanceIndex;    // GPU Scene 인덱스
    FDFInverseMatrix WorldToVolume;  // World → Volume 변환
    FDFMatrix VolumeToWorld;         // Volume → World 변환
    float3 VolumeToWorldScale;       // 축별 스케일
    uint AssetIndex;                 // SDF Asset 인덱스
};
```

### 3. Asset Data 버퍼

**📂 위치:** `Engine/Shaders/Private/DistanceFieldLightingShared.ush:74-127`

```hlsl
// Stride: 3 float4's per Mip, 9 float4's total (3 Mips)
struct FDFAssetData
{
    uint NumMips;                           // 사용 가능한 Mip 수
    uint3 IndirectionDimensions;            // Indirection 테이블 크기
    uint IndirectionTableOffset;            // 테이블 오프셋
    float2 DistanceFieldToVolumeScaleBias;  // 거리 디코딩 파라미터
    float3 VolumeToIndirectionAdd;          // Volume → Indirection 변환
    float3 VolumeToIndirectionScale;
};

FDFAssetData LoadDFAssetData(uint AssetIndex, uint ReversedMipIndex)
{
    uint Offset = AssetIndex * DF_ASSET_DATA_STRIDE
        + ReversedMipIndex * DF_ASSET_DATA_MIP_STRIDE;

    uint4 Vector0 = asuint(SceneDistanceFieldAssetData[Offset + 0]);
    float4 Vector1 = SceneDistanceFieldAssetData[Offset + 1];
    float4 Vector2 = SceneDistanceFieldAssetData[Offset + 2];

    FDFAssetData Data;
    // Indirection Dimensions 언팩 (10비트씩)
    Data.IndirectionDimensions.x = Vector0.x & INDIRECTION_DIMENSION_MASK;
    Data.IndirectionDimensions.y = (Vector0.x >> 10) & INDIRECTION_DIMENSION_MASK;
    Data.IndirectionDimensions.z = (Vector0.x >> 20) & INDIRECTION_DIMENSION_MASK;
    Data.NumMips = Vector0.x >> 30;  // 상위 2비트
    Data.IndirectionTableOffset = Vector0.y;

    Data.DistanceFieldToVolumeScaleBias = float2(Vector1.w, Vector2.w);
    Data.VolumeToIndirectionScale = Vector1.xyz;
    Data.VolumeToIndirectionAdd = Vector2.xyz;

    return Data;
}
```

---

## 💡 Tips & 최적화

### 성능 최적화

```
✅ 해야 할 것:

• r.DistanceFields.MaxPerMeshResolution 적절히 설정 (기본: 256)
  - 큰 메쉬에서 메모리 사용량 제한
  - 512 이상은 단일 메쉬당 64MB 이상 소모 가능

• r.DistanceFields.DefaultVoxelDensity 조정 (기본: 0.2)
  - 낮출수록 메모리 절약, 품질 저하
  - 높일수록 정밀도 증가, 메모리 증가

• 스트리밍 활용:
  - 먼 오브젝트는 Mip0만 사용
  - 가까운 오브젝트만 고해상도 Mip 로드

❌ 피해야 할 것:

• 모든 메쉬에 Generate Distance Field 활성화
  - 필요한 메쉬만 선택적으로 활성화

• 매우 복잡한 메쉬에 높은 해상도
  - LOD 0이 아닌 LOD에서 생성 고려
  - Resolution Scale 낮추기
```

### 디버깅 팁

```cpp
// 콘솔 명령어
r.DistanceFields.LogAtlasStats 1    // Atlas 통계 출력
r.DistanceFields.Debug.ForceNumMips 3  // 모든 Mip 강제 로드

// 시각화
ShowFlag.DistanceFieldAO 1
ShowFlag.VisualizeMeshDistanceFields 1
```

### 일반적인 문제

```
문제: SDF 품질이 낮음 (계단 현상)
해결: r.DistanceFields.MaxPerMeshResolution 증가
     또는 메쉬의 Distance Field Resolution Scale 증가

문제: 메모리 사용량 과다
해결: r.DistanceFields.BrickAtlasMaxSizeZ 감소
     불필요한 메쉬의 Distance Field 비활성화

문제: 스트리밍 지연으로 팝인 현상
해결: r.DistanceFields.TextureUploadLimitKBytes 증가
```

---

## 🔗 References

### 소스 파일 위치

| 파일 | 위치 | 설명 |
|------|------|------|
| **DistanceFieldAtlas.h** | Engine/Source/Runtime/Engine/Public/ | 핵심 데이터 구조 정의 |
| **DistanceFieldAtlas.cpp** | Engine/Source/Runtime/Engine/Private/ | DDC/빌드 로직 |
| **DistanceFieldStreaming.cpp** | Engine/Source/Runtime/Renderer/Private/ | 스트리밍 시스템 |
| **DistanceFieldStreaming.usf** | Engine/Shaders/Private/ | 스트리밍 셰이더 |
| **DistanceFieldLightingShared.ush** | Engine/Shaders/Private/ | 공용 셰이더 함수 |
| **DistanceFieldObjectCulling.usf** | Engine/Shaders/Private/ | 컬링 셰이더 |

### 관련 문서

- [GlobalDistanceField.md](./GlobalDistanceField.md) - Global SDF 시스템
- [LumenTracing.md](./LumenTracing.md) - Lumen 트레이싱 계층
- [Overview.md](./Overview.md) - Lumen 전체 아키텍처
