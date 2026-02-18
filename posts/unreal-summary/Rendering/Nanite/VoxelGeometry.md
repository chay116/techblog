---
title: "Nanite 체소 지오메트리 시스템 (Voxel Geometry System)"
date: "2025-11-23"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Rendering"
tags: ["unreal", "Rendering", "Nanite"]
---
# Nanite 체소 지오메트리 시스템 (Voxel Geometry System)

## 🧭 개요 (Overview)

Nanite의 **Voxel Geometry**는 극도로 복잡한 형상이나 폴리지(풀, 나무 등)를 효율적으로 표현하기 위한 실험적 기능입니다. 전통적인 삼각형 단순화가 어려운 경우, **체소화 (Voxelization)**를 통해 기하를 근사하고 **대리 삼각형 (Proxy Triangle)**으로 렌더링합니다.

**핵심 개념:**
- **체소화 (Voxelization)**: 복잡한 삼각형 메시를 3D 체소 그리드로 샘플링
- **체소 벽돌 (Voxel Brick)**: 4×4×4 체소 단위로 그룹화 (64-bit 점유 비트맵)
- **대리 삼각형 (Proxy Triangle)**: 렌더링 시 체소 벽돌을 삼각형으로 변환
- **Ray Tracing 기반 샘플링**: 사선 추적으로 법선, 머티리얼 등 속성 샘플링
- **DDA 추적 렌더링**: 픽셀별로 체소 벽돌 내부를 DDA로 추적

**📂 주요 소스 위치:**
- `Engine/Source/Developer/NaniteBuilder/Private/Cluster.h` - FCluster 체소 멤버
- `Engine/Source/Developer/NaniteBuilder/Private/Cluster.cpp` - Voxelize, BrickToTriangle
- `Engine/Source/Developer/NaniteBuilder/Private/ClusterDAG.cpp` - ReduceGroup (체소 경로)
- `Engine/Shaders/Private/Nanite/NaniteRasterizer.usf` - ClusterTraceBricks (렌더링)
- `Engine/Shaders/Private/Nanite/Voxel/` - GPU 셰이더 구현 (1,933 라인)

**GPU 셰이더 구현:**
이 문서는 **CPU 측 체소 생성 과정**을 다룹니다. **GPU 측 렌더링 구현** (DDA 알고리즘, Brick Key 인코딩, Visible Brick Detection, Rasterization/Scattering/Binning 패스)은 **[VoxelShaders.md](./VoxelShaders.md)**를 참조하세요.

---

## 🧱 핵심 데이터 구조 (Core Data Structures)

### 1. FCluster 체소 관련 멤버

**📂 위치:** `Cluster.h:23-58, 80-183`

```cpp
struct FCluster
{
    // === 기본 지오메트리 ===
    FVertexArray    Verts;          // 인터리브드 버텍스 (Position, Normal, Tangent, UVs, Color, Bones)
    TArray<uint32>  Indexes;        // 삼각형 인덱스 (체소 단계에서는 빈 배열)

    // === 체소 데이터 (NANITE_VOXEL_DATA 활성화 시) ===
    struct FBrick
    {
        FIntVector3  Position;      // 체소 벽돌 시작 위치 (4×4×4 정렬)
        uint64       VoxelMask;     // 64-bit 체소 점유 비트맵
        uint32       VertOffset;    // 이 벽돌의 첫 버텍스 오프셋
    };
    TArray<FBrick>   Bricks;        // 체소 벽돌 배열

    TArray<uint32>   MaterialIndexes;  // 각 삼각형(또는 벽돌)의 머티리얼 인덱스
    TBitArray<>      VoxelTriangle;    // 체소 대리 삼각형 플래그
    bool             bHasVoxelTriangles = false;

    // === LOD 및 바운드 ===
    float            LODError;      // 이 클러스터의 LOD 오차 (체소 크기)
    FSphere3f        Bounds;        // 바운딩 스피어
    // ...
};
```

**FBrick (체소 벽돌) 구조:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                          FBrick                                     │
├─────────────────────────────────────────────────────────────────────┤
│  Position : FIntVector3        // 벽돌 시작 체소 좌표 (4 단위 정렬) │
│  VoxelMask : uint64            // 64-bit 점유 비트맵 (4×4×4)        │
│  VertOffset : uint32           // Verts 배열 오프셋                 │
└─────────────────────────────────────────────────────────────────────┘
```

**VoxelMask 비트 인덱스:**
```
bitIndex = x + y * 4 + z * 16  (x, y, z ∈ [0, 3])
```

- x: 가장 빠르게 변화
- y: 중간
- z: 가장 느리게 변화

**예시:**
```
(0,0,0) → bit 0
(1,0,0) → bit 1
(3,3,3) → bit 63
```

---

### 2. FClusterDAG::FSettings 체소 파라미터

**📂 위치:** `ClusterDAG.h`

```cpp
struct FSettings
{
    uint32   NumRays = 128;          // 사선 샘플링 수
    bool     bSeparable = true;      // 분리 가능 필터 전략
    uint32   RayBackUp = 16;         // 백업 사선 수
    bool     bVoxelNDF = true;       // 법선 분포 함수 (NDF) 인코딩
    bool     bVoxelOpacity = true;   // 체소 불투명도 인코딩
    bool     bLerpUVs = true;        // 단순화 시 UV 보간
    float    MaxEdgeLengthFactor = 2.0f;  // 최대 엣지 길이 제약
    float    ShapePreservation = 0.0f;    // 형상 보존 가중치 (0=단순화, 1=체소화)
    int32    VoxelLevel = 0;              // 체소 레벨 문턱 (0=비활성화)
};
```

---

## 🔀 체소 경로 판정 로직 (Voxel Path Decision)

### ReduceGroup에서의 경로 선택

**📂 위치:** `ClusterDAG.cpp:ReduceGroup`

```cpp
// === STEP 1: 체소 경로 여부 결정 ===
bool bAllTriangles = true;  // 모든 자식이 삼각형 클러스터인가?
for (FCluster& Child : Group.Children)
{
    if (Child.NumTris == 0)  // 체소 클러스터 발견
    {
        bAllTriangles = false;
        break;
    }
}

bool bVoxels = !bAllTriangles || (Settings.ShapePreservation == Voxelize);

// === STEP 2: VoxelLevel 문턱 확인 ===
if (Settings.VoxelLevel != 0 && Settings.VoxelLevel <= (Group.MipLevel + 1))
{
    // 체소화 허용
}
else
{
    // 강제 삼각형 경로
    bVoxels = false;
}
```

**판정 조건:**

| 조건 | 결과 |
|------|------|
| 한 개 이상의 자식이 체소 클러스터 | → 체소 경로 |
| `Settings.ShapePreservation == Voxelize` | → 체소 경로 강제 |
| `VoxelLevel <= (MipLevel + 1)` | → 체소 허용 |
| `VoxelLevel == 0` | → 체소 비활성화 |

**VoxelLevel 예시:**
```
MipLevel = 1, VoxelLevel = 2 → 허용
MipLevel = 1, VoxelLevel = 3 → 금지 (강제 삼각형)
VoxelLevel = 0 → 영구 비활성화
```

---

## 🛠️ ReduceGroup: 삼각형 vs 체소 경로

**📂 위치:** `ClusterDAG.cpp:438-468`

### 경로 A: 삼각형 경로 (기본/회귀)

```cpp
// === 1. 자식 클러스터 병합 ===
FCluster Merged = FCluster(this, Group.Children);

// === 2. 목표 삼각형 수 계산 ===
uint32 MaxClusterSize = 128;
uint32 TargetClusterSize = 126;  // 초기값
uint32 NumParents = GetMaxParents(Group);
uint32 TargetNumTris = NumParents * TargetClusterSize;

// === 3. 단순화 (Simplification) ===
float SimplifyError = Merged.Simplify(this, TargetNumTris);

// === 4. 부모 클러스터 분할 ===
FGraphPartitioner Partitioner;
Partitioner.Partition(Merged, NumParents);

// 분할 실패 시: TargetClusterSize -= 2 (최소 64까지 재시도)
```

**목표 부모 클러스터 수 추정:**

```cpp
uint32 GetMaxParents(const FGroup& Group)
{
    uint32 NumGroupElements = 0;
    for (const FCluster& Child : Group.Children)
    {
        NumGroupElements += Child.MaterialIndexes.Num();
        // 삼각형 클러스터: MaterialIndexes.Num() ≈ NumTris
        // 체소 클러스터: MaterialIndexes.Num() ≈ NumBricks
    }

    // 256 = MaxClusterSize * 2
    return FMath::DivideAndRoundUp(NumGroupElements, 256);
}
```

**예시:**
```
NumGroupElements = 8000 → MaxParents = ceil(8000 / 256) = 32
NumGroupElements = 900  → MaxParents = ceil(900 / 256) = 4
```

---

### 경로 B: 체소 경로 (실험적)

```cpp
#if NANITE_VOXEL_DATA
if (bVoxels)
{
    // === 1. 목표 체소 수 계산 ===
    uint32 TargetNumBricks = NumParents * 128;
    uint32 GroupNumVerts = 0;
    for (const FCluster& Child : Group.Children)
        GroupNumVerts += Child.NumVerts;
    uint32 TargetNumVoxels = FMath::Max(1u, (GroupNumVerts * 3) / 4);

    // === 2. 초기 체소 크기 ===
    float GroupArea = CalculateGroupArea(Group.Children);  // 인스턴스 스케일 고려
    float VoxelSize = FMath::Sqrt(GroupArea / TargetNumVoxels) * 0.75f;
    VoxelSize = FMath::Max(VoxelSize, Group.ParentLODError);

    // === 3. 적응적 체소화 (루프) ===
    FCluster Voxelized;
    while (true)
    {
        Voxelized.Voxelize(this, Group.Children, VoxelSize);

        // 접수 조건 (3가지 동시 만족)
        if (Voxelized.Verts.Num() <= TargetNumVoxels &&
            Voxelized.Bricks.Num() <= TargetNumBricks &&
            VoxelSize < SimplifyError)
        {
            break;  // 성공
        }

        // 체소 크기 확대
        VoxelSize *= 1.1f;

        // 최종 실패 조건
        if (VoxelSize >= SimplifyError)
        {
            bVoxels = false;  // 삼각형 경로로 회귀
            break;
        }
    }

    // === 4. 부모 클러스터 분할 (공간 기반) ===
    FBVHCluster BVH;
    BVH.Build(Voxelized.Bricks);  // 체소 벽돌 Position 기반 공간 분할
    BVH.Partition(NumParents);

    // === 5. LOD 오차 갱신 ===
    Group.ParentLODError = FMath::Max(Group.ParentLODError, VoxelSize);
}
#endif
```

**체소화 루프 흐름:**

```
초기 VoxelSize = sqrt(Area / TargetVoxels) * 0.75

루프:
  1. Voxelize(VoxelSize)
  2. 체크:
     - Verts.Num() ≤ TargetNumVoxels?
     - Bricks.Num() ≤ TargetNumBricks?
     - VoxelSize < SimplifyError?
  3. 모두 만족 → 성공
  4. 아니면 VoxelSize *= 1.1 (10% 증가)
  5. VoxelSize ≥ SimplifyError → 실패 (삼각형 경로로 회귀)
```

---

## 🎨 체소화 과정 (Voxelization Process)

### 단계 1: Voxelize (Cluster.cpp:Voxelize)

**📂 위치:** `Cluster.cpp:Voxelize`

#### 1.1 준비 단계

```cpp
void FCluster::Voxelize(FClusterDAG* DAG, const TArray<FCluster>& Children, float VoxelSize)
{
    // === 1. 버텍스 포맷 통합 ===
    bool bHasColors = false;
    for (const FCluster& Child : Children)
    {
        if (Child.bHasColors)
            bHasColors = true;
    }

    // === 2. 체소 크기 역수 계산 ===
    float RcpVoxelSize = 1.0f / VoxelSize;
}
```

#### 1.2 체소 맵 생성 (VoxelMap)

```cpp
// TMap<FVoxelKey, FVoxelData> VoxelMap;
// FVoxelKey = (VoxelX, VoxelY, VoxelZ, MaterialIndex)

// === 삼각형 클러스터 체소화 ===
for (const FCluster& Child : Children)
{
    if (Child.NumTris > 0)
    {
        for (uint32 TriIndex = 0; TriIndex < Child.NumTris; ++TriIndex)
        {
            // 삼각형 3개 버텍스 가져오기
            FVector3f V0, V1, V2;
            // ...

            // 세계 좌표 → 체소 좌표
            FIntVector3 VoxelV0 = FIntVector3(V0 * RcpVoxelSize);
            FIntVector3 VoxelV1 = FIntVector3(V1 * RcpVoxelSize);
            FIntVector3 VoxelV2 = FIntVector3(V2 * RcpVoxelSize);

            // 삼각형이 덮는 모든 체소 기록 (26-연결)
            VoxelizeTri26(VoxelV0, VoxelV1, VoxelV2, MaterialIndex, VoxelMap);
        }
    }
}

// === 체소 클러스터 확장 ===
for (const FCluster& Child : Children)
{
    if (Child.NumTris == 0)  // 이미 체소 클러스터
    {
        for (const FBrick& Brick : Child.Bricks)
        {
            // 각 체소를 LODError * 0.5 반경으로 확장
            // AABB 생성 후 교차하는 모든 체소 수집
        }
    }
}
```

#### 1.3 사선 추적 (Ray Tracing) - 속성 샘플링

```cpp
#if RAY_TRACE_VOXELS

// === 1. 사선 생성 ===
TArray<FRay> Rays;
if (Settings.NumRays > 1)
{
    // 16개 사선 배치
    if (Settings.bSeparable)
        Rays = GenerateRayAligned(16);
    else
        Rays = GenerateRay(16, Settings.RayBackUp);
}
else
{
    // Morton 타일 기반 단일 사선
    Rays = GenerateSingleRay(VoxelPosition);
}

// === 2. 사선 교차 테스트 ===
for (const FRay& Ray : Rays)
{
    FRayHit Hit;
    if (RayTracingScene->Intersect(Ray, Hit))
    {
        // === 3. 명중 속성 수집 ===
        FVector3f HitNormal = GetTriangleNormal(Hit.TriangleIndex);
        uint32    HitMaterial = GetMaterialIndex(Hit.TriangleIndex);

        // 인스턴스 변환 적용
        if (Hit.InstanceIndex != INDEX_NONE)
        {
            FMatrix InstanceTransform = GetInstanceTransform(Hit.InstanceIndex);
            HitNormal = TransformNormal(InstanceTransform, HitNormal);
        }

        // TSGGX (Tangent Space GGX) NDF 누적
        VoxelData.NDFAccumulator.Add(HitNormal);
        VoxelData.HitCount++;
    }
}

// === 4. Coverage (불투명도) 계산 ===
float Coverage = float(HitCount) / float(NumRays);

// === 5. 후처리 ===
if (Settings.NumRays > 1 && !Settings.bVoxelOpacity)
{
    // 이진 힙으로 Coverage 기반 필터링
    // NDF 투영 면적으로 Coverage 재분배
    // 무작위 속성 상속으로 체소 수 감소
}
else
{
    // Coverage == 0인 체소 제거
}

#endif
```

**NDF (Normal Distribution Function):**
- TSGGX::Add(Normal): 법선을 누적하여 표면 거칠기 추정
- TSGGX::FitIsotropic(): 등방성 평균 법선 + Alpha (거칠기) 산출

#### 1.4 체소 버텍스 생성

```cpp
for (auto& [VoxelKey, VoxelData] : VoxelMap)
{
    // === 1. 위치 ===
    FVector3f Position = FVector3f(VoxelKey.XYZ + 0.5f) * VoxelSize;

    // === 2. 속성 보간 (명중 삼각형 기반) ===
    FVector3f Normal, TangentX, TangentY;
    FVector2f UVs[4];
    FLinearColor Color;
    LerpAttributes(VoxelData.HitTriangle, VoxelData.Barycentric,
                   Normal, TangentX, TangentY, UVs, Color);

    // === 3. 인스턴스 변환 적용 ===
    if (VoxelData.InstanceIndex != INDEX_NONE)
    {
        FMatrix Transform = GetInstanceTransform(VoxelData.InstanceIndex);
        TransformVert(Position, Normal, TangentX, TangentY, Bones, Transform);
    }

    // === 4. 선택적 NDF 인코딩 ===
    if (Settings.bVoxelNDF)
    {
        FVector3f AvgNormal;
        float Alpha;
        VoxelData.NDF.FitIsotropic(AvgNormal, Alpha);

        Normal = AvgNormal;
        Color.A = EncodeAlpha(Alpha);  // Alpha를 Color.A에 분단 인코딩
    }

    // === 5. 선택적 불투명도 인코딩 ===
    if (Settings.bVoxelOpacity)
    {
        Color.B = VoxelData.Coverage;
    }

    // === 6. 속성 정규화 ===
    CorrectAttributes(Normal, TangentX, TangentY);

    // === 7. Verts에 추가 ===
    Verts.Add(Position, Normal, TangentX, TangentY, UVs, Color, Bones);
}
```

---

### 단계 2: VoxelsToBricks (Cluster.cpp)

**📂 위치:** `Cluster.cpp:VoxelsToBricks`

```cpp
void FCluster::VoxelsToBricks(const TMap<FVoxelKey, FVoxelData>& VoxelMap)
{
    // === 1. 체소 그룹화 (4×4×4 단위) ===
    TMap<FBrickKey, FBrickData> BrickMap;
    // FBrickKey = (BrickX, BrickY, BrickZ, MaterialIndex)
    // BrickX = VoxelX & ~3 (4 단위 정렬)

    for (auto& [VoxelKey, VoxelData] : VoxelMap)
    {
        FIntVector3 BrickPos = FIntVector3(VoxelKey.XYZ & ~3);  // 4 단위 정렬
        FBrickKey BrickKey = {BrickPos, VoxelKey.MaterialIndex};

        BrickMap.FindOrAdd(BrickKey).Voxels.Add({VoxelKey.XYZ, VoxelData});
    }

    // === 2. 각 벽돌 처리 ===
    for (auto& [BrickKey, BrickData] : BrickMap)
    {
        FBrick Brick;
        Brick.Position = BrickKey.Position;
        Brick.VertOffset = Verts.Num();
        Brick.VoxelMask = 0;

        // === 3. 벽돌 내 체소 순회 ===
        for (auto& [VoxelPos, VoxelData] : BrickData.Voxels)
        {
            // 로컬 체소 좌표
            FIntVector3 LocalPos = VoxelPos - Brick.Position;
            int32 BitIndex = LocalPos.X + LocalPos.Y * 4 + LocalPos.Z * 16;

            // VoxelMask 설정
            Brick.VoxelMask |= (1ULL << BitIndex);

            // 버텍스 복사
            Verts.Add(VoxelData.Vertex);
        }

        // === 4. 벽돌 추가 ===
        Bricks.Add(Brick);
        MaterialIndexes.Add(BrickKey.MaterialIndex);
    }

    // === 5. 인덱스 비우기 ===
    Indexes.Empty();  // 체소 단계에서는 삼각형 없음
}
```

**메모리 레이아웃 예시:**

```
Verts: [V0, V1, V2, ..., V63] (첫 번째 벽돌) [V64, V65, ..., V127] (두 번째 벽돌)
       ↑
       Brick[0].VertOffset = 0
       Brick[0].VoxelMask = 0b...111 (예시)
       Brick[1].VertOffset = 64
```

---

## 🔺 체소 벽돌 → 대리 삼각형 변환 (BrickToTriangle)

**📂 위치:** `Cluster.cpp:FCluster(DAG, Children)` - 생성자 단계

### 변환 과정

```cpp
// === 부모 클러스터 생성 시 ===
FCluster::FCluster(FClusterDAG* DAG, const TArray<FCluster>& Children)
{
    for (const FCluster& Child : Children)
    {
        if (Child.NumTris == 0)  // 체소 클러스터
        {
            // 각 벽돌을 대리 삼각형으로 변환
            for (const FBrick& Brick : Child.Bricks)
            {
                BrickToTriangle(Child, Brick);
            }
        }
        else
        {
            // 삼각형 그대로 복사
            CopyTriangles(Child);
        }
    }
}
```

### BrickToTriangle 상세

```cpp
void FCluster::BrickToTriangle(const FCluster& SourceCluster, const FBrick& Brick)
{
    // === 1. 평균 위치 계산 ===
    FVector3f AvgPosition = FVector3f::ZeroVector;
    int32 NumVoxels = 0;

    for (int32 BitIndex = 0; BitIndex < 64; ++BitIndex)
    {
        if (Brick.VoxelMask & (1ULL << BitIndex))
        {
            uint32 VertIndex = Brick.VertOffset + NumVoxels;
            AvgPosition += SourceCluster.Verts[VertIndex].Position;
            NumVoxels++;
        }
    }
    AvgPosition /= NumVoxels;

    // === 2. 무작위 체소 속성 선택 ===
    int32 RandomVoxelIndex = FMath::RandRange(0, NumVoxels - 1);
    uint32 VertIndex = Brick.VertOffset + RandomVoxelIndex;

    FVector3f Normal = SourceCluster.Verts[VertIndex].Normal;
    FVector3f TangentX = SourceCluster.Verts[VertIndex].TangentX;
    FVector2f UVs[4] = { SourceCluster.Verts[VertIndex].UVs[0], ... };
    FLinearColor Color = SourceCluster.Verts[VertIndex].Color;

    // === 3. 법선 생성 (NDF 기반) ===
    if (Settings.bVoxelNDF)
    {
        // Color.A에 인코딩된 Alpha (거칠기) 복원
        float Alpha = DecodeAlpha(Color.A);

        // VNDF (Visible Normal Distribution Function) 샘플링
        FVector2f Xi = FMath::RandPointInCircle();
        FVector3f LocalNormal = VNDF::Sample(Normal, Alpha, Xi);

        Normal = LocalNormal;
    }

    // === 4. 접선 기저 구축 ===
    // Frisvad 방법으로 Normal에서 TangentX, TangentY 생성
    FVector3f TangentY;
    GetTangentBasisFrisvad(Normal, TangentX, TangentY);

    // 무작위 회전 (일관성 있는 정렬 아티팩트 방지)
    float RandomAngle = FMath::RandRange(0.0f, TWO_PI);
    RotateTangentBasis(TangentX, TangentY, RandomAngle);

    // === 5. 삼각형 버텍스 생성 ===
    float TriScale = SourceCluster.LODError * FMath::Sqrt(4.0f * NumVoxels);

    FVector3f V0 = AvgPosition - TangentX * TriScale + TangentY * TriScale;
    FVector3f V1 = AvgPosition + TangentX * TriScale + TangentY * TriScale;
    FVector3f V2 = AvgPosition + TangentX * TriScale - TangentY * TriScale;

    // === 6. 인스턴스 변환 적용 ===
    TransformVert(V0, Normal, TangentX, TangentY, Bones, InstanceTransform);
    TransformVert(V1, Normal, TangentX, TangentY, Bones, InstanceTransform);
    TransformVert(V2, Normal, TangentX, TangentY, Bones, InstanceTransform);

    // === 7. 속성 정규화 ===
    CorrectAttributes(Normal, TangentX, TangentY);

    // === 8. Verts 및 Indexes 추가 ===
    uint32 BaseVertIndex = Verts.Num();
    Verts.Add(V0, Normal, TangentX, TangentY, UVs, Color, Bones);
    Verts.Add(V1, Normal, TangentX, TangentY, UVs, Color, Bones);
    Verts.Add(V2, Normal, TangentX, TangentY, UVs, Color, Bones);

    Indexes.Add(BaseVertIndex + 0);
    Indexes.Add(BaseVertIndex + 1);
    Indexes.Add(BaseVertIndex + 2);

    // === 9. 메타데이터 ===
    MaterialIndexes.Add(Brick.MaterialIndex);
    VoxelTriangle[TriangleIndex] = true;  // 체소 대리 삼각형 표시
}
```

**대리 삼각형 시각화:**

```
체소 벽돌 (4×4×4):
   ████
   ████
   ████
   ████

    ↓ BrickToTriangle

대리 삼각형:
      /\
     /  \
    /____\
  (AvgPosition 중심, LODError 스케일)
```

---

## 🔧 단순화 및 최적화 (Simplification)

### ShrinkTriGroupWithMostSurfaceAreaLoss

**📂 위치:** `Cluster.cpp:ShrinkTriGroupWithMostSurfaceAreaLoss`

**목적:** 폴리지(풀/나무) 등에서 **과도한 차폐 (Over-Occlusion)**를 줄이기 위해, 표면적 손실이 가장 큰 삼각형 그룹을 **중심 방향으로 수축**합니다.

**호출 조건:**
```cpp
if (Settings.FoliageOverOcclusionBias > 0.0f)
{
    if (bHasVoxelTriangles)
        ShrinkVoxelTriangles(Settings.FoliageOverOcclusionBias, VoxelTriangle);
    else
        ShrinkTriGroupWithMostSurfaceAreaLoss(Settings.FoliageOverOcclusionBias);
}
```

**알고리즘:**

```cpp
void FCluster::ShrinkTriGroupWithMostSurfaceAreaLoss(float Bias)
{
    // === 1. 삼각형 그룹화 ===
    TArray<FTriGroup> TriGroups;
    GroupTriangles(TriGroups);  // 머티리얼, 연결성, 또는 MaterialRanges 기준

    // === 2. 표면적 계산 ===
    float MaxSurfaceAreaLoss = 0.0f;
    int32 WorstGroupIndex = INDEX_NONE;

    for (int32 GroupIndex = 0; GroupIndex < TriGroups.Num(); ++GroupIndex)
    {
        float OriginalArea = CalculateGroupSurfaceArea(TriGroups[GroupIndex]);
        float PotentialLoss = EstimateLossAfterShrink(TriGroups[GroupIndex], Bias);

        if (PotentialLoss > MaxSurfaceAreaLoss)
        {
            MaxSurfaceAreaLoss = PotentialLoss;
            WorstGroupIndex = GroupIndex;
        }
    }

    // === 3. 선택된 그룹 수축 ===
    if (WorstGroupIndex != INDEX_NONE)
    {
        FTriGroup& WorstGroup = TriGroups[WorstGroupIndex];

        // 그룹 중심 (Centroid) 계산
        FVector3f Centroid = CalculateCentroid(WorstGroup);

        // 각 버텍스를 중심 방향으로 이동
        for (uint32 VertIndex : WorstGroup.Vertices)
        {
            FVector3f& Position = Verts[VertIndex].Position;
            FVector3f ToCenter = Centroid - Position;

            // k = f(Bias, Distance) - Bias에 비례하되 뒤집힘 방지
            float k = FMath::Clamp(Bias * 0.1f, 0.0f, 0.9f);
            Position += ToCenter * k;
        }

        // 법선 및 접선 재계산
        RecalculateNormals(WorstGroup);
        RecalculateTangents(WorstGroup);

        // 바운드 갱신
        UpdateBounds();
        UpdateExternalEdges();
    }
}
```

**효과:**
- **표면 수축**: 외곽 버텍스가 중심으로 이동
- **차폐 감소**: 폴리지의 밀집된 영역이 약간 얇아져 과도한 차폐 완화
- **부작용**: 미세한 틈새 또는 face detachment 가능

**트리거 조건:**
- `FoliageOverOcclusionBias > 0`
- **체소 대리 삼각형이 없는 경우**만 실행 (체소 삼각형은 `ShrinkVoxelTriangles` 사용)

---

## 🖥️ 체소 렌더링 흐름 (Voxel Rendering Flow)

### FMicropolyRasterizeCS - 체소 분기

**📂 위치:** `Engine/Shaders/Private/Nanite/NaniteRasterizer.usf`

```hlsl
[numthreads(64, 1, 1)]
void FMicropolyRasterizeCS(uint GroupID : SV_GroupID, uint GroupIndex : SV_GroupIndex)
{
#if NANITE_VOXELS
    // 체소 렌더링 분기
    ClusterTraceBricks(GroupID, GroupIndex);
#else
    // 일반 삼각형 래스터화
    ClusterRasterize(GroupID, GroupIndex);
#endif
}
```

### ClusterTraceBricks 상세

**📂 위치:** `NaniteRasterizer.usf:ClusterTraceBricks`

#### 1. 클러스터 및 뷰 준비

```hlsl
void ClusterTraceBricks(uint GroupID, uint GroupIndex)
{
    // === 1. 가시 클러스터 가져오기 ===
    uint VisibleClusterIndex = GetVisibleCluster(GroupID);
    FNaniteView NaniteView = GetNaniteView(ViewIndex);
    FCluster Cluster = GetCluster(VisibleClusterIndex, NANITE_CLUSTER_TYPE_VOXELS);

    // === 2. FRaster 구성 ===
    FRaster Raster;
    Raster.ViewportScale = NaniteView.ViewportSize / 2.0f;
    Raster.ViewportBias = NaniteView.ViewportSize / 2.0f;
    Raster.ScissorRect = NaniteView.ViewRect;

    // VSM (Virtual Shadow Map) 특별 처리
    if (bIsVSM)
    {
        // 페이지 오프셋 및 배열 레이어 설정
        Raster.PageOffset = GetPageOffset(PageIndex);
        Raster.ArrayLayer = GetArrayLayer(PageIndex);
    }

    // === 3. 인스턴스 데이터 ===
    FInstanceDynamicData InstanceData = GetInstanceData(Cluster.InstanceIndex);
    float4x4 LocalToTranslatedWorld = InstanceData.LocalToWorld;

    // === 4. 사선 및 투영 행렬 ===
    bool bOrtho = IsOrthoProjection(NaniteView);
    float3 RayOrigin, RayDir;
    GetLocalRay<bOrtho>(RayOrigin, RayDir, NaniteView, InstanceData);

    // 체소 단위로 정규화
    float RcpVoxelSize = 1.0f / Cluster.LODError;
    RayOrigin *= RcpVoxelSize;
    RayDir *= RcpVoxelSize;

    // 체소 → 픽셀 클립 행렬
    float4x4 LocalVoxelToPixelClip = mul(LocalToTranslatedWorld, NaniteView.ViewToClip);
    LocalVoxelToPixelClip = mul(LocalVoxelToPixelClip, MakeScaleMatrix(Cluster.LODError));
    LocalVoxelToPixelClip = mul(LocalVoxelToPixelClip, Raster.ViewportScale, Raster.ViewportBias);

    // 방향 보정
    RayDir = select(abs(RayDir) < 1e-8f, 1e-8f, RayDir);
    float RayBias = 0.04f / length(RayDir);
}
```

#### 2. 벽돌 순회 (Brick Iteration)

```hlsl
// === 5. 각 벽돌 처리 ===
for (uint BrickIndex = 0; BrickIndex < Cluster.NumBricks; ++BrickIndex)
{
    FBrick Brick = DecodeBrick(Cluster, BrickIndex);
    int3 BrickStartPos = Brick.Position;      // 체소 좌표
    int3 BrickMax = BrickStartPos + int3(4, 4, 4);

    // 역비트 (Morton 순서 개선)
    uint64 ReversedBrickBits = ReverseBits64(Brick.VoxelMask);

    // === 6. 벽돌 → 로컬 변환 ===
    if (!Cluster.bIsSkinned)
    {
        // 정적 메시: 행렬 갱신
        LocalVoxelToPixelClip = UpdateMatrixForBrick(LocalVoxelToPixelClip, BrickStartPos);
    }
    else
    {
        // 스키닝 메시: 사선 갱신
        UpdateRayForBrick(RayOrigin, RayDir, BrickStartPos, BoneMatrices);
    }

    // === 7. 화면 공간 바운드 근사 ===
    float4 ScreenBounds = ApproximateScreenBounds(BrickStartPos, BrickMax, LocalVoxelToPixelClip);

    // 정수 픽셀로 반올림
    int2 PixelMin = floor(ScreenBounds.xy);
    int2 PixelMax = ceil(ScreenBounds.zw);

    // Scissor 클리핑
    PixelMin = max(PixelMin, Raster.ScissorRect.xy);
    PixelMax = min(PixelMax, Raster.ScissorRect.zw);

    // 최대 크기 제한 (약 30×30 픽셀)
    int2 BrickSize = PixelMax - PixelMin;
    if (any(BrickSize > MAX_BRICK_SCREEN_SIZE))
        continue;  // 너무 큰 벽돌 건너뛰기

    // === 8. 픽셀 태스크 생성 ===
    uint NumPixels = BrickSize.x * BrickSize.y;

    #if REDISTRIBUTE_WORK
        // Wave Prefix Sum으로 태스크 재분배
        uint WaveOffset = WavePrefixSum(NumPixels);
        uint WaveTotal = WaveActiveSum(NumPixels);

        // 환형 큐에 픽셀 태스크 추가
        for (uint LocalPixelIndex = 0; LocalPixelIndex < NumPixels; ++LocalPixelIndex)
        {
            uint QueueIndex = (WaveOffset + LocalPixelIndex) % 64;
            PixelQueue[QueueIndex] = PackPixelTask(PixelMin, LocalPixelIndex, BrickIndex);
        }
    #endif
}
```

#### 3. 픽셀별 추적 (Per-Pixel Tracing)

```hlsl
// === 9. 픽셀 처리 ===
for (uint TaskIndex = 0; TaskIndex < NumTasks; ++TaskIndex)
{
    FPixelTask Task = PixelQueue[TaskIndex];
    int2 PixelPos = Task.PixelPos;

    // === 10. 조기 깊이 테스트 ===
    if (OcclusionTestPixel(PixelPos, DepthBuffer))
        continue;  // 차폐됨, 건너뛰기

    // === 11. 벽돌 픽셀 처리 ===
    ProcessBrickPixel<bOrtho>(
        PixelPos,
        Task.BrickIndex,
        RayOrigin,
        RayDir,
        ReversedBrickBits,
        BrickStartPos,
        LocalVoxelToPixelClip,
        Raster,
        NaniteView
    );
}
```

#### 4. DDA 체소 추적 (DDA Voxel Traversal)

```hlsl
void ProcessBrickPixel<bool bOrtho>(
    int2 PixelPos,
    uint BrickIndex,
    float3 RayOrigin,
    float3 RayDir,
    uint64 ReversedBrickBits,
    int3 BrickStartPos,
    float4x4 LocalVoxelToPixelClip,
    FRaster Raster,
    FNaniteView NaniteView)
{
    // === 1. FVisBufferPixel 초기화 ===
    FVisBufferPixel Pixel;
    Pixel.PixelPos = PixelPos;
    Pixel.PageIndex = GetPageIndex(PixelPos);  // VSM 전용

    // === 2. 픽셀별 사선 조정 ===
    float3 PixelRayOrigin = RayOrigin;
    float3 PixelRayDir = RayDir;

    if (bOrtho)
    {
        // 정사영: 원점 픽셀 오프셋
        float2 PixelOffset = (PixelPos - Raster.ViewportBias) / Raster.ViewportScale;
        PixelRayOrigin.xy += PixelOffset;
    }
    else
    {
        // 투시: 방향 픽셀 오프셋
        float4 ClipPos = float4((PixelPos - Raster.ViewportBias) / Raster.ViewportScale * 2.0f - 1.0f, 0.5f, 1.0f);
        float3 WorldPos = mul(NaniteView.ClipToWorld, ClipPos).xyz;
        PixelRayDir = normalize(WorldPos - NaniteView.TranslatedWorldCameraOrigin);
    }

    // === 3. 벽돌 AABB 교차 ===
    float3 BrickMin = float3(BrickStartPos);
    float3 BrickMax = float3(BrickStartPos + int3(4, 4, 4));

    float tMin, tMax;
    if (!RayAABBIntersect(PixelRayOrigin, PixelRayDir, BrickMin, BrickMax, tMin, tMax))
        return;  // 교차 없음

    // Bias 추가 (자기 교차 방지)
    tMin += RayBias;
    tMax -= RayBias;

    if (tMin >= tMax)
        return;

    // === 4. DDA 초기화 ===
    FDDA DDA;
    InitDDA(DDA, PixelRayOrigin, PixelRayDir, BrickMin, BrickMax);
    StartDDA(DDA, tMin);

    // === 5. DDA 스텝 루프 ===
    while (DDA.Time < tMax)
    {
        // 현재 체소 인덱스
        int3 VoxelPos = int3(DDA.Position);  // [0..3]^3
        int VoxelIndex = VoxelPos.x + VoxelPos.y * 4 + VoxelPos.z * 16;

        // VoxelMask 테스트
        uint64 VoxelBit = 1ULL << VoxelIndex;
        if (ReversedBrickBits & VoxelBit)
        {
            // === 6. 명중! ===
            // 중점 시간 (현재 + 다음 교차 중간)
            float HitTime = (DDA.Time + DDA.NextTime) * 0.5f;

            // 깊이 계산
            float Depth;
            if (bOrtho)
            {
                Depth = 1.0f - HitTime;  // 정사영: 선형
            }
            else
            {
                // 투시: ViewToClip 역계산
                Depth = NaniteView.ViewToClip[3][2] / HitTime + NaniteView.ViewToClip[2][2];
            }

            // === 7. 가시성 버퍼 쓰기 ===
            Pixel.Depth = Depth;
            Pixel.VisibleClusterIndex = VisibleClusterIndex;
            Pixel.TriangleIndex = BrickIndex;  // 벽돌 인덱스 (삼각형 인덱스 대신)

            Pixel.WriteOverdraw();  // Overdraw 카운트 (디버그)
            Pixel.Write();          // DepthBuffer / VisBuffer64 UAV 쓰기

            return;  // 첫 명중만 기록
        }

        // 다음 체소로 이동
        StepDDA(DDA);
    }
}
```

**DDA (Digital Differential Analyzer):**
- 3D 그리드 순회 알고리즘
- X/Y/Z 축별로 다음 교차 시간 계산
- 가장 가까운 축으로 스텝
- 효율: O(grid 셀 수) vs O(모든 체소)

---

### 파이프라인 레벨 정렬 및 제약

#### 1. Material Bin 정렬 (글로벌)

**📂 위치:** `NaniteCullRaster.cpp:FRasterizerPass::CalcSortKey`

```cpp
uint64 CalcSortKey()
{
    bool bDepthTest = (bPixelProgrammable || RasterPipeline.bVoxel);

    // 체소는 항상 "깊이 테스트 필요" 그룹에 속함
    // 최상위 비트 설정 → 가장 나중에 렌더링
    uint64 SortKey = bDepthTest ? (1ULL << 63) : 0;

    // 추가 정렬 키 (Material, Pipeline 등)
    SortKey |= (MaterialIndex << 32);
    SortKey |= (PipelineIndex << 16);

    return SortKey;
}
```

**결과:**
- **체소 클러스터는 모든 불투명 클러스터 다음에 렌더링**
- 이전 패스의 깊이 버퍼 활용 → 조기 깊이 거부 (Early-Z Rejection) 최대화

#### 2. Depth Bucketing (세부 정렬)

**📂 위치:** `NaniteRasterizer.cpp:PrepareRasterizerPasses`

```cpp
// Depth Bucketing 활성화 조건
if (Nanite::FGlobalResources::UseExtendedClusterSize() && r.Nanite.DepthBucketing != 0)
{
    // 픽셀 프로그래머블: 최대 2개 블록 (근거리/원거리)
    NumDepthBlocks = (bPixelProgrammable && r.Nanite.DepthBucketPixelProgrammable) ? 2 : 1;

    // 체소: 항상 1개 블록 (근/원 분할 없음)
    if (RasterPipeline.bVoxel)
        NumDepthBlocks = 1;

    // FNaniteRasterBinMeta에 NumDepthBlocks 기록
    BinMeta.MaterialFlags_DepthBlock = NumDepthBlocks;
}
```

**결과:**
- 체소는 **근/원 깊이 블록 분할 없음** (항상 단일 블록)
- 픽셀 프로그래머블은 선택적으로 2블록 (r.Nanite.DepthBucketPixelProgrammable)

#### 3. 런타임 깊이 테스트

**📂 위치:** `NaniteRasterizer.usf:OcclusionTestPixel`

```hlsl
bool OcclusionTestPixel(int2 PixelPos, Texture2D<float> DepthBuffer)
{
    float CurrentDepth = DepthBuffer[PixelPos];

    // VSM: 페이지별 깊이 버퍼
    if (bIsVSM)
        CurrentDepth = VSMDepthBuffer[GetVSMPixelPos(PixelPos, PageIndex)];

    // 조기 거부: 현재 체소 깊이가 기존 깊이보다 멀면 건너뛰기
    return (EstimatedDepth > CurrentDepth);
}
```

**체소 렌더링 순서 보장:**
1. **Bin 정렬** (SortKey) → 체소가 마지막
2. **Depth Bucketing** (선택) → 체소는 단일 블록
3. **RasterBinArgsSWHW** 간접 디스패치 → Bin 순서대로 실행

---

## ⚠️ 체소 시스템의 한계점 (Limitations)

### 1. World Position Offset (WPO) 미지원

**문제:**
- 체소 경로는 **오프라인 체소화 → 벽돌 → 대리 삼각형** 정적 지오메트리
- 런타임에 **버텍스 셰이더 단계 없음** (SW 래스터라이저 직접 픽셀 처리)
- WPO는 버텍스 셰이더에서 위치를 변형하므로 적용 불가

**현재 동작:**
- WPO가 설정된 머티리얼은 **셰이딩 평가 시에만** 영향을 미침
- 실제 지오메트리 커버리지/윤곽선은 변하지 않음

**영향:**
- 풀 흔들림, 파도 등 WPO 기반 애니메이션이 체소에서는 동작하지 않음

---

### 2. UV 애니메이션 체소 표현 - 픽셀 "크롤링" (Pixel Crawling)

**문제:**
1. **일 벽돌 일 삼각형 + 무작위 방향**
   - BrickToTriangle이 각 벽돌을 단일 삼각형으로 변환
   - 법선 및 접선 기저를 무작위 회전 → 일관성 없는 UV 공간

2. **UV/법선 공간 불연속성**
   - 인접한 체소 벽돌 간 UV가 불연속적으로 점프
   - 텍스처 panner, flowmap 등이 "크롤링" 또는 "플리커링" 발생

3. **미분 근사 (ddx/ddy) 부정확**
   - 마이크로폴리곤 + 분석적 미분은 삼각형당 상수
   - UV 애니메이션 시 인접 픽셀 간 미분 차이 → 깜박임

4. **Variable Rate Shading (VRS) 악화**
   - VRS로 인한 픽셀 그룹화가 UV 불연속성을 더 두드러지게 만듦

**현상:**
- 체소 표면에서 텍스처가 "미끄러지거나" "진동"하는 것처럼 보임
- 특히 panner, rotator, flowmap 노드 사용 시 뚜렷함

---

### 3. 근접 고밀도 모델의 Nanite Overdraw 문제

**Nanite 통병:**
- **클러스터 그룹 단순화 문턱**: 삼각형/벽돌 수가 너무 적으면 더 이상 단순화 안 함
- **근접 LOD에서 오버드로우 증가**: 카메라 가까이에서도 많은 클러스터 렌더링

**체소 특유 문제:**
- 체소 클러스터는 **Visibility Buffer 기반**이지만 여전히 픽셀당 DDA 추적 비용 존재
- 고밀도 체소 모델 (예: 매우 복잡한 폴리지)은 픽셀당 여러 벽돌 추적 가능
- **해결책 없음**: Nanite 전반적인 설계 한계

---

### 4. Ray Tracing Scene AS (Acceleration Structure) - 삼각형만 지원

**문제:**
- 하드웨어 RT는 **삼각형 프리미티브만** 지원
- 체소 벽돌은 커스텀 프리미티브로 RT AS에 표현 불가

**현재 동작:**
- 체소 클러스터는 **대리 삼각형으로 변환**되어 RT AS에 추가
- 하지만 대리 삼각형은 체소 내부 디테일을 정확히 표현하지 못함

**영향:**
- **Global Illumination (GI)**: 체소 디테일이 GI 계산에서 누락
- **RT 그림자**: 대리 삼각형 형상으로 그림자 생성 → 부정확

**미래 개선 가능성:**
- **BVH Assembly (DXR 1.1+)**: 커스텀 BVH 노드 추가 가능
- Nanite 체소를 별도 BVH로 표현하여 Assembly에 포함 → RT 지원 가능성

---

### 5. VSM (Virtual Shadow Map)의 Nanite LOD Bias - 불일치 심화

**문제:**
- VSM은 별도 Nanite LOD bias 사용 (일반적으로 더 낮은 디테일)
- 체소 클러스터는 일반 렌더링과 VSM에서 **서로 다른 LOD** 선택 가능

**결과:**
- 일반 뷰: 체소 벽돌 렌더링
- VSM: 더 단순한 삼각형 LOD 렌더링 (또는 다른 체소 크기)

**영향:**
- **그림자 불일치**: VSM 그림자 경계가 실제 지오메트리와 일치하지 않음
- **Peter Panning**: 그림자가 오브젝트에서 떨어져 보임

**완화책:**
- `r.Nanite.VSM.LODBias` 조정 (하지만 완전히 해결 불가)

---

## 📊 체소 관련 상수 및 파라미터

### 고정 상수

| 상수 | 값 | 설명 |
|------|-----|------|
| `BRICK_SIZE` | 4×4×4 | 벽돌 체소 그리드 크기 |
| `VOXEL_MASK_BITS` | 64 | 벽돌 점유 비트맵 크기 |
| `MAX_CLUSTER_SIZE` | 128 | 클러스터당 최대 삼각형/벽돌 |
| `MAX_BRICK_SCREEN_SIZE` | ~30×30px | 벽돌 최대 화면 크기 (근사) |

### 설정 가능 파라미터

| 파라미터 | 기본값 | 설명 |
|----------|--------|------|
| `Settings.NumRays` | 128 | 사선 샘플링 수 |
| `Settings.bSeparable` | true | 분리 가능 필터 전략 |
| `Settings.RayBackUp` | 16 | 백업 사선 수 |
| `Settings.bVoxelNDF` | true | NDF 인코딩 활성화 |
| `Settings.bVoxelOpacity` | true | 불투명도 인코딩 활성화 |
| `Settings.MaxEdgeLengthFactor` | 2.0 | 최대 엣지 길이 제약 |
| `Settings.VoxelLevel` | 0 | 체소 레벨 문턱 (0=비활성화) |
| `Settings.ShapePreservation` | 0.0 | 0=단순화, 1=체소화 강제 |
| `Settings.FoliageOverOcclusionBias` | 0.0 | 폴리지 차폐 감소 강도 |

### 콘솔 변수 (Console Variables)

| CVars | 기본값 | 설명 |
|-------|--------|------|
| `r.Nanite.DepthBucketing` | 1 | 깊이 블록 분할 활성화 |
| `r.Nanite.DepthBucketPixelProgrammable` | 1 | 픽셀 프로그래머블 깊이 분할 |
| `r.Nanite.VSM.LODBias` | -1 | VSM Nanite LOD 바이어스 |
| `r.Nanite.Visualize` | 0 | 시각화 모드 (3=벽돌, 4=체소) |

---

## 🔧 디버깅 및 시각화

### 체소 시각화 명령어

```
r.Nanite.Visualize 3   // 체소 벽돌 경계 표시
r.Nanite.Visualize 4   // 개별 체소 표시
r.Nanite.Visualize 6   // 클러스터 LOD 오차 히트맵
```

### Stat 명령어

```
stat Nanite           // Nanite 전반 통계
stat NaniteVoxels     // 체소 관련 통계 (커스텀)
```

### 체소 디버그 체크리스트

- [ ] `NANITE_VOXEL_DATA` 매크로 활성화 확인
- [ ] `Settings.VoxelLevel` 올바른 값 설정
- [ ] 체소 경로 진입 조건 (bVoxels == true) 확인
- [ ] `Voxelize` 성공 여부 (TargetNumVoxels 충족)
- [ ] `VoxelsToBricks` 정상 실행 (Bricks.Num() > 0)
- [ ] `BrickToTriangle` 대리 삼각형 생성 확인 (Indexes.Num() > 0)
- [ ] 렌더링 시 `ClusterTraceBricks` 호출 확인 (#if NANITE_VOXELS)

---

## 🔗 관련 문서 (Related Documents)

- [Overview.md](./Overview.md) - Nanite 시스템 전체 개요
- [Cluster.md](./Cluster.md) - FCluster 구조 및 생성
- [DAG.md](./DAG.md) - ReduceGroup 및 계층 구조
- [Rasterization.md](./Rasterization.md) - 래스터화 시스템 (HW/SW)
- [Material.md](./Material.md) - Material Shading Pass
- **[VoxelShaders.md](./VoxelShaders.md)** - **체소 GPU 셰이더 구현** (DDA, Brick Key, AutoVoxel, RasterizeBricks, ScatterBricks, TileBricks)

---

## 📚 참고 자료 (References)

### 커뮤니티 분석
- [cnblogs.com/timlly](https://www.cnblogs.com/timlly/) - Nanite 기술 분석
- [blog.uwa4d.com](https://blog.uwa4d.com/) - USparkle Nanite 분석

### 엔진 소스
- `Engine/Source/Developer/NaniteBuilder/Private/Cluster.h` - FCluster
- `Engine/Source/Developer/NaniteBuilder/Private/Cluster.cpp` - Voxelize, BrickToTriangle
- `Engine/Source/Developer/NaniteBuilder/Private/ClusterDAG.cpp` - ReduceGroup
- `Engine/Shaders/Private/Nanite/NaniteRasterizer.usf` - ClusterTraceBricks, DDA
- `Engine/Shaders/Private/Nanite/NaniteClusterCulling.usf` - 컬링
- `Engine/Shaders/Shared/NaniteDefinitions.h` - 상수

### 공식 문서
- [Unreal Engine - Nanite Overview](https://docs.unrealengine.com/5.7/en-US/nanite-virtualized-geometry-in-unreal-engine/)
- [GDC 2021 - Brian Karis - Nanite](https://advances.realtimerendering.com/s2021/index.html)

---

> 🔄 **작성일**: 2025-11-06
> 📝 **문서 버전**: v1.0
> ✅ **소스 검증**: UE 5.7.0
> 📂 **주요 소스**: Cluster.cpp, ClusterDAG.cpp, NaniteRasterizer.usf
