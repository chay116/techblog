---
title: "Collision Detection & Scene Query"
date: "2025-12-07"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Physics"
tags: ["unreal", "Physics"]
engine_version: "** Unreal Engine 5.7"
---
# Collision Detection & Scene Query

## 🧭 개요

Chaos의 충돌 시스템은 **BroadPhase → Midphase → NarrowPhase** 파이프라인으로 구성되며, Scene Query(Raycast, Sweep, Overlap)는 동일한 공간 분할 구조를 활용합니다.

### 핵심 용어 정리

| 용어 | 설명 |
|------|------|
| **Collision Channel** | 오브젝트 분류용 열거형 (ECC_WorldStatic, ECC_Pawn 등) |
| **Object Type** | 오브젝트가 실제로 속한 채널 (자신의 정체성) |
| **Trace Channel** | 쿼리가 검사하는 채널 |
| **Collision Response** | 채널 간 반응 방식 (Block/Overlap/Ignore) |
| **Simple Collision** | Convex Hull, 기본 형상 기반 충돌 |
| **Complex Collision** | 실제 메시 삼각형 기반 충돌 |

---

## 🧱 충돌 감지 파이프라인

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Collision Detection Pipeline                              │
└─────────────────────────────────────────────────────────────────────────────────┘

  All Particles (N)
        │
        ↓
┌───────────────────────────────────────────────────────────────────────────┐
│                          BroadPhase                                        │
│                          O(N log N)                                        │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  입력: 모든 파티클의 AABB (Axis-Aligned Bounding Box)                     │
│  출력: 잠재적 충돌 쌍 (Potential Pairs)                                    │
│                                                                            │
│  알고리즘:                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐        │
│  │ Spatial Hashing  │  │ AABBTree (BVH)   │  │ Sweep and Prune  │        │
│  │ (Dynamic)        │  │ (Static/Dynamic) │  │ (SAP)            │        │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘        │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
        │
        │ Potential Pairs (K << N²)
        ↓
┌───────────────────────────────────────────────────────────────────────────┐
│                          Midphase                                          │
│                          (복합 형상용)                                     │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  복합 충돌 형상 (Mesh, Heightfield 등)에서 관련 프리미티브 필터링         │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────┐         │
│  │                    FImplicitBVH                               │         │
│  │                                                               │         │
│  │  Triangle Mesh, Heightfield, Compound Shape에서               │         │
│  │  실제 충돌 검사가 필요한 프리미티브만 추출                    │         │
│  └──────────────────────────────────────────────────────────────┘         │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
        │
        │ Primitive Pairs
        ↓
┌───────────────────────────────────────────────────────────────────────────┐
│                          NarrowPhase                                       │
│                          O(K)                                              │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  정밀 충돌 검사 및 Contact 생성                                           │
│                                                                            │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐        │
│  │ GJK Algorithm    │  │ EPA Algorithm    │  │ SAT Algorithm    │        │
│  │ (Convex-Convex)  │  │ (Penetration)    │  │ (Box-Box 특화)   │        │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘        │
│                                                                            │
│  출력: Contact Manifold                                                    │
│  ┌──────────────────────────────────────────────────────────────┐         │
│  │ - Contact Points (위치, 법선, 깊이)                          │         │
│  │ - Separating Axis                                             │         │
│  │ - Feature IDs (캐싱용)                                        │         │
│  └──────────────────────────────────────────────────────────────┘         │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 📂 주요 소스 파일

| 파일 | 역할 |
|------|------|
| `Chaos/Public/Chaos/Collision/BroadPhase.h` | BroadPhase 인터페이스 |
| `Chaos/Public/Chaos/Collision/SpatialAccelerationBroadPhase.h` | 공간 분할 BroadPhase |
| `Chaos/Public/Chaos/Collision/NarrowPhase.h` | NarrowPhase 인터페이스 |
| `Chaos/Public/Chaos/Collision/GJK.h` | GJK 알고리즘 |
| `Chaos/Public/Chaos/Collision/EPA.h` | EPA 알고리즘 |
| `Chaos/Public/Chaos/Collision/CollisionConstraintAllocator.h` | Contact 관리 |
| `Engine/Public/Physics/PhysicsFiltering.h` | 충돌 채널 및 필터링 |
| `Engine/Private/Collision/CollisionConversions.cpp` | 쿼리 결과 변환 |

---

## 🔷 핵심 내부 구조체

### BroadPhase 관련 구조체

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        BroadPhase Internal Structures                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ FSpatialAccelerationBroadPhase                                           │   │
│  │ (메인 BroadPhase 구현)                                                   │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  - TAABBTree<FAccelerationStructureHandle>  DynamicTree;   // 동적 트리 │   │
│  │  - TAABBTree<FAccelerationStructureHandle>  StaticTree;    // 정적 트리 │   │
│  │  - TArray<FBroadPhasePair>                  PotentialPairs; // 충돌 후보 │   │
│  │                                                                          │   │
│  │  FindOverlaps(AABB) → 해당 AABB와 겹치는 모든 핸들 반환                  │   │
│  │  UpdateObject(Handle, NewAABB) → 트리에서 위치 업데이트                  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ FAccelerationStructureHandle                                             │   │
│  │ (공간 구조에서 파티클을 식별하는 핸들)                                   │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  - FGeometryParticleHandle*  Particle;      // 실제 파티클               │   │
│  │  - FAABB3                    CachedBounds;  // 캐시된 경계               │   │
│  │  - uint32                    SpatialIdx;    // 공간 인덱스               │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ TAABBTree<T> (BVH 트리)                                                  │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  - TArray<FAABBTreeNode>  Nodes;         // 노드 배열                    │   │
│  │  - int32                  RootNode;      // 루트 인덱스                  │   │
│  │  - int32                  MaxDepth;      // 최대 깊이                    │   │
│  │                                                                          │   │
│  │  Query(AABB, Visitor) → 겹치는 모든 리프 방문                           │   │
│  │  Insert(Handle, AABB) → 새 요소 삽입                                    │   │
│  │  Remove(Handle) → 요소 제거                                             │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ FBroadPhasePair (충돌 후보 쌍)                                           │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  - FGeometryParticleHandle*  ParticleA;                                  │   │
│  │  - FGeometryParticleHandle*  ParticleB;                                  │   │
│  │  - int32                     ShapeIdxA;  // 복합 형상의 인덱스           │   │
│  │  - int32                     ShapeIdxB;                                  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### NarrowPhase 관련 구조체

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        NarrowPhase Internal Structures                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ FPBDCollisionConstraint (충돌 제약)                                      │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  - FGeometryParticleHandle*   Particle[2];        // 충돌 쌍            │   │
│  │  - FImplicitObject*           Implicit[2];        // 충돌 형상          │   │
│  │  - FContactManifold           Manifold;           // 접촉점들           │   │
│  │  - FVec3                      AccumulatedImpulse; // 누적 충격량        │   │
│  │  - FReal                      Friction;           // 마찰 계수          │   │
│  │  - FReal                      Restitution;        // 반발 계수          │   │
│  │                                                                          │   │
│  │  Apply() → 충돌 해소를 위한 위치/속도 보정                              │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ FContactManifold (접촉 정보 집합)                                        │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  - TArray<FContactPoint, 4>  Points;     // 최대 4개 접촉점             │   │
│  │  - FVec3                     Normal;     // 충돌 법선                   │   │
│  │  - FReal                     Phi;        // 침투 깊이 (음수=침투)       │   │
│  │                                                                          │   │
│  │  ※ 매니폴드는 이전 프레임에서 캐시되어 재사용됨 (Warm Starting)         │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ FContactPoint (개별 접촉점)                                              │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  - FVec3   ShapeContactPoints[2];  // 각 형상의 로컬 접촉점             │   │
│  │  - FVec3   ShapeContactNormal;     // 접촉 법선                         │   │
│  │  - FReal   Phi;                    // 침투 깊이                         │   │
│  │  - int32   FaceIndex;              // 삼각형 메시의 경우 면 인덱스       │   │
│  │                                                                          │   │
│  │  ContactLocation = ShapeContactPoints[0]                                 │   │
│  │  ContactNormal = ShapeContactNormal (A → B 방향)                        │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ FCollisionConstraintAllocator (제약 메모리 관리)                         │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  - TArray<FPBDCollisionConstraint>  Constraints;                         │   │
│  │  - FreeList                         AvailableSlots;                      │   │
│  │                                                                          │   │
│  │  Allocate() → 새 제약 할당 (풀에서)                                     │   │
│  │  Release(Constraint) → 제약 반환                                        │   │
│  │                                                                          │   │
│  │  ※ 풀링으로 매 프레임 할당/해제 비용 최소화                             │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Scene Query 관련 구조체

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Scene Query Structures                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ FHitResult (쿼리 결과 - 단일)                                            │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  - float                Distance;        // 시작점에서 히트까지 거리    │   │
│  │  - FVector              ImpactPoint;     // 충돌 위치 (월드)            │   │
│  │  - FVector              ImpactNormal;    // 충돌 표면 법선              │   │
│  │  - FVector              TraceStart;      // 쿼리 시작점                 │   │
│  │  - FVector              TraceEnd;        // 쿼리 끝점                   │   │
│  │  - FVector              Location;        // 충돌 시 쿼리 형상 중심      │   │
│  │  - FVector              Normal;          // 쿼리 형상 기준 법선         │   │
│  │  - TWeakObjectPtr       Actor;           // 충돌한 액터                 │   │
│  │  - TWeakObjectPtr       Component;       // 충돌한 컴포넌트             │   │
│  │  - FName                BoneName;        // 스켈레탈 본 이름            │   │
│  │  - int32                FaceIndex;       // 삼각형 인덱스               │   │
│  │  - UPhysicalMaterial*   PhysMaterial;    // 물리 재질                   │   │
│  │                                                                          │   │
│  │  bBlockingHit : 충돌 차단 여부                                          │   │
│  │  bStartPenetrating : 시작 시점에 이미 겹침                              │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ FOverlapResult (겹침 쿼리 결과)                                          │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  - TWeakObjectPtr  Actor;         // 겹친 액터                          │   │
│  │  - TWeakObjectPtr  Component;     // 겹친 컴포넌트                      │   │
│  │  - int32           ItemIndex;     // Instanced 컴포넌트의 인덱스        │   │
│  │                                                                          │   │
│  │  ※ FHitResult와 달리 위치/법선 정보 없음 (겹침만 확인)                  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ FCollisionQueryParams (쿼리 파라미터)                                    │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  - FName              TraceTag;           // 디버그용 태그              │   │
│  │  - FName              OwnerTag;           // 소유자 태그                │   │
│  │  - bool               bTraceComplex;      // Complex Collision 사용     │   │
│  │  - bool               bReturnFaceIndex;   // 면 인덱스 반환             │   │
│  │  - bool               bReturnPhysicalMaterial;  // 물리 재질 반환       │   │
│  │  - TArray<AActor*>    IgnoredActors;      // 무시할 액터들              │   │
│  │  - TArray<UPrimComp*> IgnoredComponents;  // 무시할 컴포넌트들          │   │
│  │                                                                          │   │
│  │  AddIgnoredActor(Actor) → 쿼리에서 특정 액터 제외                       │   │
│  │  AddIgnoredComponent(Comp) → 쿼리에서 특정 컴포넌트 제외                │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ FCollisionFilterData (저수준 필터)                                       │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  - uint32  Word0;  // Object Type (ECC_*)                               │   │
│  │  - uint32  Word1;  // Block 응답 비트마스크                             │   │
│  │  - uint32  Word2;  // Overlap 응답 비트마스크                           │   │
│  │  - uint32  Word3;  // 커스텀 플래그                                     │   │
│  │                                                                          │   │
│  │  ※ Physics Engine에 전달되는 실제 필터 데이터                           │   │
│  │  ※ Response Matrix가 이 비트마스크로 변환됨                             │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔷 BroadPhase 상세

### Spatial Hashing

```cpp
// 공간 해싱 기반 BroadPhase
// 장점: 동적 객체에 효율적, 삽입/삭제 O(1)
// 단점: 최적 셀 크기 선택 필요

class FSpatialHash
{
    TMap<FCellIndex, TArray<FParticleHandle*>> Grid;
    FReal CellSize;

    void Insert(FParticleHandle* Particle)
    {
        FAABB3 AABB = Particle->WorldSpaceInflatedBounds();
        // AABB가 걸치는 모든 셀에 등록
        for (FCellIndex Cell : GetOverlappingCells(AABB))
        {
            Grid[Cell].Add(Particle);
        }
    }
};
```

### AABBTree (BVH)

```
                     ┌─────────────────┐
                     │   Root AABB     │
                     │   (전체 월드)   │
                     └────────┬────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
       ┌──────┴──────┐                 ┌──────┴──────┐
       │   Left      │                 │   Right     │
       │   Child     │                 │   Child     │
       └──────┬──────┘                 └──────┬──────┘
              │                               │
       ┌──────┴──────┐                 ┌──────┴──────┐
       │  Particles  │                 │  Particles  │
       │  [A, B, C]  │                 │  [D, E, F]  │
       └─────────────┘                 └─────────────┘
```

```cpp
// BVH 트리 순회
void TraverseBVH(FAABBTreeNode* Node, FAABB3& QueryAABB, TArray<FParticleHandle*>& Results)
{
    if (!Node->AABB.Intersects(QueryAABB))
        return;

    if (Node->IsLeaf())
    {
        Results.Append(Node->Particles);
    }
    else
    {
        TraverseBVH(Node->Left, QueryAABB, Results);
        TraverseBVH(Node->Right, QueryAABB, Results);
    }
}
```

---

## 🌲 공간 가속 구조 심층 분석

### TSpatialAccelerationCollection - 가속 구조 컬렉션

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    TSpatialAccelerationCollection Architecture                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  TSpatialAccelerationCollection<TAABBTree, TBoundingVolume, TBoundingVolumeHierarchy>
│       │                                                                         │
│       ├── 버킷 시스템 (최대 8개 버킷)                                           │
│       │     ├── Bucket 0: 메인 월드 (지형, 건물)                               │
│       │     ├── Bucket 1~7: 스트리밍 레벨들                                    │
│       │     └── 각 버킷별로 독립적인 가속 구조                                  │
│       │                                                                         │
│       └── InnerIdx (버킷 내 서브구조)                                           │
│             ├── Default (0): 정적 객체용                                        │
│             ├── Dynamic (1): 동적 객체용                                        │
│             └── Custom (2~7): 프로젝트별 커스텀                                 │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### ISpatialAcceleration 인터페이스

```cpp
// 모든 공간 가속 구조의 기본 인터페이스
template<typename PayloadType, typename T = FReal, int d = 3>
class ISpatialAcceleration
{
public:
    // 기본 쿼리 연산
    virtual void Raycast(const FVec3& Start, const FVec3& Dir, T Length,
                        ISpatialVisitor<PayloadType>& Visitor) const = 0;
    virtual void Sweep(const FVec3& Start, const FVec3& Dir, T Length,
                      const FVec3& HalfExtents, ISpatialVisitor<PayloadType>& Visitor) const = 0;
    virtual void Overlap(const FAABB3& Bounds, ISpatialVisitor<PayloadType>& Visitor) const = 0;

    // 객체 관리
    virtual void Insert(const PayloadType& Payload, const FAABB3& Bounds) = 0;
    virtual void Remove(const PayloadType& Payload) = 0;
    virtual void Update(const PayloadType& Payload, const FAABB3& NewBounds) = 0;

    // 타입 체크
    template<typename T> const T* As() const;
};
```

### PBDRigidsEvolution의 3개 가속 구조

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    PBDRigidsEvolution - 3 Acceleration Structures                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  class FPBDRigidsEvolution {                                                     │
│      using FAccelerationStructure = ISpatialAccelerationCollection<...>;         │
│                                                                                  │
│      // 3개의 가속 구조를 운영!                                                  │
│      FAccelerationStructure* InternalAcceleration;       // ① 내부 물리 계산용 │
│      FAccelerationStructure* AsyncInternalAcceleration;  // ② 비동기 내부 계산 │
│      FAccelerationStructure* AsyncExternalAcceleration;  // ③ 비동기 외부 쿼리 │
│  };                                                                              │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                                                                          │   │
│  │   Physics Thread                    Game Thread                         │   │
│  │   ┌──────────────────────┐         ┌──────────────────────┐            │   │
│  │   │ InternalAcceleration │         │AsyncExternalAcceleration│          │   │
│  │   │                      │         │                        │           │   │
│  │   │ - 충돌 감지          │         │ - Raycast 쿼리         │           │   │
│  │   │ - 제약 생성          │         │ - Overlap 쿼리         │           │   │
│  │   └──────────────────────┘         └──────────────────────┘            │   │
│  │              ↕                                ↕                         │   │
│  │   ┌──────────────────────────────────────────────────────────┐         │   │
│  │   │           AsyncInternalAcceleration                       │         │   │
│  │   │           (백그라운드 업데이트)                           │         │   │
│  │   └──────────────────────────────────────────────────────────┘         │   │
│  │                                                                          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```cpp
// PBDRigidsEvolution.h - 물리 시뮬레이션의 심장부
class FPBDRigidsEvolution
{
    using FAccelerationStructure = ISpatialAccelerationCollection<FAccelerationStructureHandle, FReal, 3>;

    // 3개의 가속 구조를 운영
    FAccelerationStructure* InternalAcceleration;      // 내부 물리 계산용
    FAccelerationStructure* AsyncInternalAcceleration; // 비동기 내부 계산용
    FAccelerationStructure* AsyncExternalAcceleration; // 비동기 외부 쿼리용

    // 실제 물리 스텝에서 사용
    void AdvanceOneTimeStep(FReal Dt)
    {
        // 충돌 감지에서 가속 구조 사용
        BroadPhase.ProduceOverlaps(Dt, InternalAcceleration, ...);
    }
};
```

### 가속 구조 타입별 비교

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Spatial Acceleration Structures Comparison                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. TAABBTree<PayloadType>                                                       │
│     ├── BoundingBox 기반 노드 분할 → 트리 형태로 구성                           │
│     ├── bMutable = true → 동적 객체에 적합                                      │
│     └── Chaos에서 매우 자주 사용됨 (BroadPhase 기본)                            │
│                                                                                  │
│  2. TBoundingVolume<PayloadType>                                                 │
│     ├── 균일 공간 분할 (Grid 기반)                                              │
│     ├── 빈번한 삽입/삭제에 최적                                                 │
│     └── 작은 객체들이 균일 분포할 때 효율적                                     │
│                                                                                  │
│  3. TBoundingVolumeHierarchy<...>                                                │
│     ├── BVH 구조의 Chaos 구현체                                                 │
│     ├── Complex Mesh 충돌체 구성에 사용                                         │
│     └── Triangle Mesh Level 충돌 후보 검색에 활용                               │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

| 특성 | AABB Tree | Bounding Volume | BVH |
|------|-----------|-----------------|-----|
| **구축 시간** | 중간 O(n log n) | 빠름 O(n) | 느림 O(n log n) |
| **메모리 사용** | 낮음 | 높음 | 매우 낮음 |
| **삽입/삭제** | 빠름 O(log n) | 매우 빠름 O(1) | 느림 O(n) |
| **쿼리 성능** | 좋음 O(log n) | 가변적 O(1)~O(n) | 좋음 O(log n) |
| **동적 업데이트** | 우수 | 우수 | 나쁨 |
| **정적 환경** | 좋음 | 보통 | 최고 |

### 가속 구조 선택 가이드라인

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Acceleration Structure Selection Guide                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  AABB Tree를 선택하는 경우:                                                      │
│    ✅ 동적 객체가 많음 (>30%)                                                   │
│    ✅ 다양한 크기의 객체 혼재                                                   │
│    ✅ 메모리 제약이 있음                                                        │
│    ✅ 일반적인 게임 환경                                                        │
│                                                                                  │
│  Bounding Volume (Grid)를 선택하는 경우:                                         │
│    ✅ 객체가 균일하게 분포                                                      │
│    ✅ 빈번한 삽입/삭제 필요                                                     │
│    ✅ 작은 객체들이 대부분                                                      │
│    ✅ 단순한 쿼리 패턴                                                          │
│                                                                                  │
│  BVH를 선택하는 경우:                                                            │
│    ✅ 대부분 정적 환경 (>80%)                                                   │
│    ✅ 메모리가 매우 제한적                                                      │
│    ✅ 복잡한 계층 구조                                                          │
│    ✅ 배치 처리 시나리오                                                        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 게임 타입별 설정 패턴

```cpp
// ===== 오픈 월드 게임 설정 =====
void SetupOpenWorldPhysics()
{
    auto Collection = MakeUnique<TSpatialAccelerationCollection<...>>();

    // 메인 월드 (버킷 0)
    Collection->AddSubstructure(
        CreateBVH(TerrainAndBuildings),    // 지형과 건물 - BVH
        0, Default
    );

    Collection->AddSubstructure(
        CreateAABBTree(PlayersAndNPCs),    // 플레이어와 NPC - AABB Tree
        0, Dynamic
    );

    Collection->AddSubstructure(
        CreateGrid(CollectibleItems),      // 수집품 - Grid
        0, 4  // 커스텀 인덱스
    );

    // 스트리밍 구역들 (버킷 1-7)
    for (int32 StreamingLevel = 1; StreamingLevel < 8; StreamingLevel++)
    {
        Collection->AddSubstructure(
            CreateAppropriateStructure(StreamingLevel),
            StreamingLevel, Default
        );
    }
}

// ===== FPS 게임 설정 =====
void SetupFPSPhysics()
{
    // 모든 것을 하나의 동적 AABB Tree로
    Collection->AddSubstructure(
        CreateAABBTree(AllObjects),  // 모든 객체
        0, Dynamic
    );

    // 총알과 파편만 별도 처리
    Collection->AddSubstructure(
        CreateGrid(ProjectilesAndDebris),  // 총알과 파편
        0, 5  // 커스텀 고속 처리용
    );
}

// ===== RTS 게임 설정 =====
void SetupRTSPhysics()
{
    // 대량의 유닛들 - 균일 분포이므로 Grid가 효율적
    Collection->AddSubstructure(
        CreateGrid(Units),  // 유닛들
        0, Dynamic
    );

    // 건물들 - 정적이므로 BVH
    Collection->AddSubstructure(
        CreateBVH(Buildings),  // 건물들
        0, Default
    );
}
```

### PhysX Broad Phase 알고리즘 상세

#### SAP (Sweep and Prune) 알고리즘

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           SAP Algorithm                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. 객체 AABB의 최소/최대값을 X축 기준으로 정렬                                 │
│                                                                                  │
│     X축:  A.min  B.min  A.max  C.min  B.max  D.min  C.max  D.max               │
│           ─┬─────┬──────┬──────┬──────┬──────┬──────┬──────┬─                  │
│            │     │      │      │      │      │      │      │                   │
│            ├─────┼──────┤      │      │      │      │      │  A                │
│            │     ├──────┼──────┼──────┤      │      │      │  B                │
│            │     │      │      ├──────┼──────┼──────┤      │  C                │
│            │     │      │      │      │      ├──────┼──────┤  D                │
│                                                                                  │
│  2. 순차 검사로 충돌 후보 추출:                                                  │
│     • A.max > B.min → (A,B) 충돌 후보 ✓                                        │
│     • A.max > C.min → (A,C) 충돌 후보 ✓                                        │
│     • A.max < D.min → 검사 생략 (이후 객체도 모두 생략)                         │
│                                                                                  │
│  3. List_X = {(A,B), (A,C), (B,C), (B,D)}                                       │
│                                                                                  │
│  4. Y, Z축에서도 동일 검사 → 3축 모두 겹치는 pair만 최종 후보                   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

| 장점 | 단점 |
|------|------|
| ✅ 정적 환경에서 매우 빠름 | ❌ 동적 환경에서 O(n log n) 재정렬 필요 |
| ✅ 구현 간단, 직관적 | ❌ 3축 리스트 유지 → 메모리 낭비 |
| ✅ 객체 수 적을 때 효율적 | ❌ 캐시 비우호적 |
|  | ❌ 멀티스레드화 어려움 |

#### MBP (Multi Box Pruning) 알고리즘

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           MBP Algorithm                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. 씬 공간을 3D 그리드로 분할 (예: 16×16×16)                                   │
│                                                                                  │
│     ┌───┬───┬───┬───┐                                                          │
│     │ A │   │ B │   │   ← 각 셀에 객체 배치                                    │
│     ├───┼───┼───┼───┤                                                          │
│     │   │A,C│ C │   │   ← 객체가 여러 셀에 걸칠 수 있음                        │
│     ├───┼───┼───┼───┤                                                          │
│     │   │ C │C,D│ D │                                                          │
│     └───┴───┴───┴───┘                                                          │
│                                                                                  │
│  2. 각 셀 내에서만 SAP 또는 AABB 검사 수행                                      │
│                                                                                  │
│  3. 셀 경계를 넘는 객체는 여러 셀에 등록                                        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

| 장점 | 단점 |
|------|------|
| ✅ SAP보다 전체 정렬 범위 축소 | ❌ 셀 경계 문제 (객체가 여러 셀에 걸침) |
| ✅ 지역성 활용 가능 | ❌ 셀 크기 튜닝 필요 |
| ✅ 중간 규모 씬에 적합 | ❌ 동적 객체 많으면 셀 재배치 비용 |

#### ePABP (Pipelined Automatic Box Pruning)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ePABP Algorithm                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PABP = ABP (Automatic Box Pruning) + Pipelining                                │
│                                                                                  │
│  핵심 아이디어:                                                                  │
│  • 씬 전체를 공간 분할 없이 자동 처리                                           │
│  • AABB를 자동 정렬 후 여러 스레드에서 병렬 처리                                │
│  • 시작/끝 경계를 전방 탐색하며 충돌 후보 추출                                  │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐    │
│  │   Thread 0        Thread 1        Thread 2        Thread 3            │    │
│  │  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐            │    │
│  │  │ Chunk 0 │    │ Chunk 1 │    │ Chunk 2 │    │ Chunk 3 │            │    │
│  │  │ A-B     │    │ C-D     │    │ E-F     │    │ G-H     │            │    │
│  │  └─────────┘    └─────────┘    └─────────┘    └─────────┘            │    │
│  │       ↓              ↓              ↓              ↓                  │    │
│  │  ┌───────────────────────────────────────────────────────┐           │    │
│  │  │              Merge Results (Pipeline)                  │           │    │
│  │  └───────────────────────────────────────────────────────┘           │    │
│  └────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

| 장점 | 단점 |
|------|------|
| ✅ 멀티스레딩 성능 우수 | ❌ Pipelining 스케줄링 비용 |
| ✅ ABP보다 정밀한 파이프라인 스케줄링 | ❌ 정적 객체 많은 씬에서 효율 저하 |
| ✅ SAP/MBP보다 동적 객체 처리 향상 | ❌ PhysX SDK 내부 알고리즘 (문서화 적음) |

### 전체 Broad Phase 방식 비교

| 이름 | 병렬화 | 동적 객체 | 정적 객체 | 사용 위치 | 대표 환경 |
|------|--------|----------|----------|----------|----------|
| **SAP** | ❌ | 낮음 | 매우 높음 | PhysX | 모바일/VR/단순 정적 씬 |
| **MBP** | ⚠️ 부분 | 중간 | 높음 | PhysX | 일반 게임 씬 (UE4) |
| **ePABP** | ✅ | 높음 | 중간 | PhysX 최적화 | 멀티코어 CPU |
| **eGPU** | ✅✅ | 매우 높음 | 보통 | GPU 엔진 | FleX, Blast, 대규모 입자 |
| **AABB Tree** | ✅ | 높음 | 높음 | Chaos (UE5) | 범용 |

### 용도별 선택 가이드

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Broad Phase Selection Guide                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  🚀 동적 객체 수만 개           →  eGPU                                         │
│  🧠 멀티스레드 CPU 중심         →  ePABP                                        │
│  ⚙️ 일반적인 게임 씬           →  MBP 또는 AABB Tree                           │
│  🧩 정적 환경/모바일            →  SAP                                          │
│  🎮 UE5 Chaos                  →  AABB Tree (기본)                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### PhysX vs Chaos 비교 요약

| 항목 | PhysX SAP | PhysX MBP | Chaos AABB Tree |
|------|-----------|-----------|-----------------|
| **원리** | 정렬된 끝점 검사 | 공간 분할 + SAP | 계층적 AABB 트리 |
| **동적 객체** | 약함 | 중간 | 강함 |
| **정적 객체** | 매우 강함 | 강함 | 강함 |
| **대규모 씬** | ❌ | ✅ | ✅ |
| **메모리 효율** | 낮음 (3축 리스트) | 중간 (셀 기반) | 높음 (캐시 친화) |
| **멀티스레드** | 낮음 | 낮음~중간 | 높음 |
| **GPU 확장성** | 어려움 | 중간 | 높음 |

### Chaos가 AABB Tree를 선택한 이유

```
❌ SAP / MBP 문제점:
  - Sweep 정렬 기반 → 삽입/삭제 시 정렬 비용 O(n)
  - 캐시 미스 발생 확률 높음 (정렬 리스트 순회)
  - 메모리 접근이 비선형적 → CPU 병목
  - 병렬화 어려움

✅ AABB Tree 장점:
  - 계층 구조 → O(log n) 삽입/삭제/쿼리
  - 메모리 레이아웃 최적화 → 캐시 효율 향상
  - Time-slicing 지원 → 프레임 드롭 방지
  - 노드 단위 병렬 처리 가능
  - Flat Tree 구조로 GPU 확장 용이
```

| 정리 | SAP | MBP | AABB Tree |
|------|-----|-----|-----------|
| **추천 용도** | 정적 환경, 객체 수 적은 경우 | 중간 규모 동적+정적 씬 | 범용 게임 환경 |
| **UE5 사용 여부** | ❌ | ❌ | ✅ 기본 |
| **대체 이유** | 정렬 비용, 병렬화 어려움 | 셀 경계 문제, 관리 비용 | - |

### BVH 트리 구성 알고리즘

```cpp
// BVH 노드 구조
template <typename T, int d>
struct TBVHNode
{
    TVector<T, d> MMin, MMax;    // AABB 최소/최대 좌표
    int32 MAxis;                 // 분할 축 (0=X, 1=Y, 2=Z)
    TArray<int32> MChildren;     // 자식 노드 인덱스들
    int32 LeafIndex;             // 리프 노드일 경우 인덱스
};

// 재귀적 트리 분할
void BuildHierarchyRecursive(TBVHNode<T, d>& Node,
                           TArray<int32>& Indices,
                           int32 Level,
                           bool AllowMultipleSplitting)
{
    // 리프 노드 조건 확인
    if (Indices.Num() <= LeafCapacity || Level >= MMaxLevels)
    {
        Node.LeafIndex = Leafs.Num();
        Leafs.Append(Indices);
        return;
    }

    // 가장 긴 축을 분할 축으로 선택
    FVec3 BoxExtent = Node.MMax - Node.MMin;
    int32 SplitAxis = 0;
    if (BoxExtent.Y > BoxExtent.X) SplitAxis = 1;
    if (BoxExtent.Z > BoxExtent[SplitAxis]) SplitAxis = 2;
    Node.MAxis = SplitAxis;

    // 중심점 기준 분할
    T SplitPoint = (Node.MMax[SplitAxis] + Node.MMin[SplitAxis]) * 0.5f;

    // 객체들을 분할 평면 기준으로 분류
    TArray<int32> LeftIndices, RightIndices;
    for (int32 Index : Indices)
    {
        T ObjectCenter = (MWorldSpaceBoxes[Index].Min()[SplitAxis] +
                         MWorldSpaceBoxes[Index].Max()[SplitAxis]) * 0.5f;

        if (ObjectCenter < SplitPoint)
            LeftIndices.Add(Index);
        else
            RightIndices.Add(Index);
    }

    // 자식 노드 생성 (재귀)
    if (LeftIndices.Num() > 0)
    {
        TBVHNode<T, d> LeftChild;
        ComputeNodeBounds(LeftChild, LeftIndices);
        BuildHierarchyRecursive(LeftChild, LeftIndices, Level + 1, AllowMultipleSplitting);
        Node.MChildren.Add(Elements.Num());
        Elements.Add(LeftChild);
    }
    // RightIndices도 동일하게 처리...
}
```

---

## ⚡ 고급 BroadPhase 최적화 기법

### 1. 시간 분할 처리 (Time Slicing)

```cpp
struct FAABBTimeSliceCVars
{
    static bool bUseTimeSliceMillisecondBudget;      // 시간 예산 사용
    static float MaxProcessingTimePerSliceSeconds;   // 슬라이스당 최대 시간
    static int32 MinNodesChunkToProcessBetweenTimeChecks;  // 시간 체크 간격
};

// 시간 분할 BVH 업데이트
void UpdateHierarchyTimeSliced(float MaxTimeSliceSeconds)
{
    double StartTime = FPlatformTime::Seconds();

    while (HasMoreWork() &&
           (FPlatformTime::Seconds() - StartTime) < MaxTimeSliceSeconds)
    {
        ProcessNextChunk();
    }
}

// 실제 사용 예시 - 비동기 처리
void FPBDRigidsEvolution::ProgressAsyncAccelerationStructure()
{
    if (AsyncInternalAcceleration)
    {
        // 0.5ms 예산으로 점진적 업데이트
        AsyncInternalAcceleration->ProgressAsyncTimeSlicing(false);
    }
}
```

### 2. 더티 그리드 최적화

```cpp
struct FAABBTreeDirtyGridCVars
{
    static int32 DirtyElementGridCellSize;          // 그리드 셀 크기
    static int32 DirtyElementMaxGridCellQueryCount; // 최대 셀 쿼리 수
    static int32 DirtyElementMaxCellCapacity;       // 셀당 최대 용량
};

// 더티 객체만 업데이트
class FAABBTreeDirtyGrid
{
    TArray<TArray<int32>> GridCells;  // 그리드 셀별 객체 인덱스
    TSet<int32> DirtyElements;        // 변경된 객체들

    void UpdateDirtyElements()
    {
        for (int32 DirtyIndex : DirtyElements)
        {
            // 해당 객체만 선택적 업데이트
            UpdateSingleElement(DirtyIndex);
        }
        DirtyElements.Reset();
    }
};
```

### 3. SIMD 벡터화

```cpp
// SIMD 최적화된 AABB 교차 테스트 - 4개 AABB를 동시에 테스트
class FAABBVectorized
{
    VectorRegister4Float MinX, MinY, MinZ;
    VectorRegister4Float MaxX, MaxY, MaxZ;

    // 4개 AABB를 동시에 테스트
    VectorRegister4Int TestOverlap(const FAABBVectorized& Other) const
    {
        VectorRegister4Float TestMinX = VectorCompareGT(MinX, Other.MaxX);
        VectorRegister4Float TestMinY = VectorCompareGT(MinY, Other.MaxY);
        VectorRegister4Float TestMinZ = VectorCompareGT(MinZ, Other.MaxZ);
        VectorRegister4Float TestMaxX = VectorCompareGT(Other.MinX, MaxX);
        VectorRegister4Float TestMaxY = VectorCompareGT(Other.MinY, MaxY);
        VectorRegister4Float TestMaxZ = VectorCompareGT(Other.MinZ, MaxZ);

        VectorRegister4Float NoOverlap = VectorBitwiseOr(
            VectorBitwiseOr(TestMinX, TestMinY),
            VectorBitwiseOr(TestMinZ, VectorBitwiseOr(TestMaxX, VectorBitwiseOr(TestMaxY, TestMaxZ)))
        );

        return VectorFloatToInt(VectorBitwiseNot(NoOverlap));
    }
};
```

### 4. 메모리 풀링

```cpp
// 가속 구조 재사용을 위한 풀링
class FAccelerationStructurePool
{
    TQueue<FAccelerationStructure*> AvailableStructures;
    TArray<TUniquePtr<FAccelerationStructure>> BackingBuffer;

    FAccelerationStructure* GetOrCreate()
    {
        FAccelerationStructure* Structure;
        if (AvailableStructures.Dequeue(Structure))
        {
            Structure->Reset();
            return Structure;
        }

        // 새로 생성
        auto NewStructure = MakeUnique<FAccelerationStructure>();
        Structure = NewStructure.Get();
        BackingBuffer.Add(MoveTemp(NewStructure));
        return Structure;
    }

    void Return(FAccelerationStructure* Structure)
    {
        AvailableStructures.Enqueue(Structure);
    }
};
```

### 5. 비동기 처리 패턴

```cpp
// 3개의 가속 구조로 비동기 처리
class FPBDRigidsEvolution
{
    // 메인 스레드: InternalAcceleration 사용
    void MainThreadPhysics()
    {
        InternalAcceleration->Overlap(QueryBounds, OverlapVisitor);
    }

    // 백그라운드 스레드: AsyncInternalAcceleration 사용
    void BackgroundPhysicsUpdate()
    {
        AsyncInternalAcceleration->ProgressAsyncTimeSlicing(false);
    }

    // 게임 스레드: AsyncExternalAcceleration 사용
    void GameThreadQueries()
    {
        AsyncExternalAcceleration->Raycast(Start, Dir, Length, RaycastVisitor);
    }
};
```

---

## 🔶 NarrowPhase 알고리즘 상세

### NarrowPhase 핵심 구조체

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Narrow Phase Core Structures                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ FGeomGJKHelperSIMD (GJK SIMD 헬퍼)                                       │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  const void* Geometry;      // 지오메트리 포인터                         │   │
│  │  FRealSingle Margin;        // 마진 값                                  │   │
│  │  SupportFunc Func;          // Support 함수 포인터                       │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ TGJKSimplexData<T> (GJK 단체 데이터)                                     │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  TVec3<T> As[4];            // 형태 A의 단체 정점들                      │   │
│  │  TVec3<T> Bs[4];            // 형태 B의 단체 정점들                      │   │
│  │  T Barycentric[4];          // 무게중심 좌표                             │   │
│  │  int32 NumVerts;            // 단체 정점 개수 (1~4)                      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ TEPAEntry<T> (EPA 다면체 면)                                             │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  int32 IdxBuffer[3];        // 삼각형 인덱스                             │   │
│  │  TVec3<T> PlaneNormal;      // 삼각형 법선                               │   │
│  │  T Distance;                // 원점까지의 거리                           │   │
│  │  TVector<int32,3> AdjFaces; // 인접 삼각형들                             │   │
│  │  bool bObsolete;            // 폐기 여부                                 │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ FSATResult (SAT 결과)                                                    │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  ESATFeatureType FeatureTypes[2];  // 특성 타입 (평면/모서리/정점)       │   │
│  │  int32 FeatureIndices[2];          // 특성 인덱스                        │   │
│  │  FReal SignedDistance;             // 부호 있는 거리                     │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### NarrowPhase 처리 순서

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      Narrow Phase Pipeline                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  BroadPhase 충돌 쌍                                                             │
│        │                                                                         │
│        ↓                                                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐       │
│  │  1단계: GJK (Gilbert-Johnson-Keerthi)                                 │       │
│  │                                                                       │       │
│  │  목적: 두 볼록체가 교차하는지 판정                                    │       │
│  │  결과: 분리됨 → 종료 | 접촉 → 2단계로                                │       │
│  └──────────────────────────────────────────────────────────────────────┘       │
│        │ 접촉 감지됨                                                            │
│        ↓                                                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐       │
│  │  2단계: EPA (Expanding Polytope Algorithm)                            │       │
│  │                                                                       │       │
│  │  목적: 침투 깊이와 분리 방향 계산                                     │       │
│  │  결과: 침투 깊이, 충돌 법선                                           │       │
│  └──────────────────────────────────────────────────────────────────────┘       │
│        │                                                                         │
│        ↓                                                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐       │
│  │  3단계: SAT (Separating Axis Theorem)                                 │       │
│  │                                                                       │       │
│  │  목적: 최적 접촉 특성 선택 (평면-정점 or 모서리-모서리)               │       │
│  │  결과: 접촉점 위치, 접촉 특성 타입                                    │       │
│  └──────────────────────────────────────────────────────────────────────┘       │
│        │                                                                         │
│        ↓                                                                         │
│  Contact Manifold 생성 → Constraint Solver로 전달                               │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1단계: GJK 알고리즘 상세

```cpp
// GJK 메인 루프
while (!bIsContact && !bIsDegenerate)
{
    // Support 함수 호출: 각 형상에서 주어진 방향의 최원점
    const TVec3<T> SupportA = SupportAFunc(NegV);  // A에서 -V 방향
    const TVec3<T> SupportB = SupportBFunc(V);     // B에서 +V 방향

    // Minkowski Difference의 새로운 정점
    TVec3<T> NewPoint = SupportA - SupportB;

    // 단체(Simplex)에 정점 추가
    Simplex.Add(NewPoint);

    // 원점에 가장 가까운 점 찾기 → 새로운 탐색 방향
    V = SimplexFindClosestToOrigin(Simplex, Barycentric);

    // 수렴 조건 확인
    T NewDistance = V.Size();
    bIsContact = (NewDistance < Epsilon);

    // 진전이 없으면 종료
    if (NewDistance >= PrevDistance - Tolerance)
        break;

    PrevDistance = NewDistance;
}
```

### GJK (Gilbert-Johnson-Keerthi)

**용도:** Convex-Convex 충돌 검사

```
┌─────────────────────────────────────────────────────────────────┐
│                         GJK Algorithm                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Minkowski Difference: A ⊖ B = {a - b | a ∈ A, b ∈ B}           │
│                                                                  │
│  핵심 아이디어: A와 B가 충돌 ⟺ A ⊖ B가 원점을 포함             │
│                                                                  │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────┐   │
│  │   Shape A   │  ⊖  │   Shape B   │  =  │ Minkowski Diff  │   │
│  │     ●       │     │      ●      │     │       ●─────●   │   │
│  │   /   \     │     │    /   \    │     │      /       \  │   │
│  │  ●─────●    │     │   ●─────●   │     │     ●─────────● │   │
│  └─────────────┘     └─────────────┘     │      \       /  │   │
│                                          │       ●─────●   │   │
│                                          │         ○       │   │
│                                          │       Origin    │   │
│                                          └─────────────────┘   │
│                                                                  │
│  Simplex 확장:                                                   │
│  1. Support 함수로 최원점 찾기                                   │
│  2. Simplex에 추가                                               │
│  3. 원점이 Simplex 내부? → 충돌                                 │
│  4. 아니면 방향 업데이트 후 반복                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

```cpp
// GJK 핵심 Support 함수
FVec3 Support(const FImplicitObject& A, const FImplicitObject& B, const FVec3& Direction)
{
    // A에서 Direction 방향 최원점
    FVec3 PointA = A.Support(Direction, A.GetMargin());
    // B에서 -Direction 방향 최원점
    FVec3 PointB = B.Support(-Direction, B.GetMargin());
    // Minkowski Difference의 점
    return PointA - PointB;
}
```

### 2단계: EPA (Expanding Polytope Algorithm)

**용도:** GJK가 충돌을 감지한 후 침투 깊이와 분리 방향 계산

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         EPA Algorithm                                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  GJK가 충돌 감지 → EPA로 침투 깊이/방향 계산                                    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                        EPA 확장 과정                                     │   │
│  │                                                                          │   │
│  │    초기 Simplex          원점에 가장           새 정점 추가              │   │
│  │    (GJK 결과)           가까운 면 찾기        & Polytope 확장            │   │
│  │                                                                          │   │
│  │       △                    △                     ◇                     │   │
│  │      /●\       →          /●\        →         /●\                    │   │
│  │     /   \                /   \★             ★/   \★                   │   │
│  │    ●─────●              ●─────●               ●─────●                   │   │
│  │                                                                          │   │
│  │    ○ = Origin           ★ = 가장 가까운 면     새 Support 점 추가       │   │
│  │                                                                          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  결과:                                                                          │
│  - Penetration Depth (침투 깊이): 원점에서 가장 가까운 면까지의 거리            │
│  - Separation Normal (분리 방향): 그 면의 법선 방향                             │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```cpp
// EPA 알고리즘 상세 구현
template <typename T>
bool EPA(
    const FGeomGJKHelperSIMD& A, const FGeomGJKHelperSIMD& B,
    TGJKSimplexData<T>& SimplexData,      // GJK의 최종 Simplex
    TVec3<T>& OutNormal,                   // 출력: 분리 방향
    T& OutPenetration                       // 출력: 침투 깊이
)
{
    // EPA 초기화: GJK Simplex로 초기 다면체 구성
    TArray<TVec3<T>> VertsABuffer, VertsBBuffer;
    TArray<TEPAEntry<T>> Faces;
    TArray<int32> Queue;  // 처리 대기 면들 (거리순 정렬)

    // Simplex 정점들로 초기 사면체 구성
    InitializeEPAFromSimplex(SimplexData, VertsABuffer, VertsBBuffer, Faces, Queue);

    int32 Iteration = 0;
    const int32 MaxIterations = 128;  // EPA 최대 반복 횟수

    // EPA 메인 루프
    while (Queue.Num() > 0 && Iteration++ < MaxIterations)
    {
        // 원점에 가장 가까운 면 선택 (우선순위 큐)
        int32 ClosestFaceIdx = Queue[0];
        TEPAEntry<T>& ClosestFace = Faces[ClosestFaceIdx];

        // 그 면의 법선 방향으로 새로운 Support 점 찾기
        TVec3<T> SearchDir = ClosestFace.PlaneNormal;
        TVec3<T> SupportA = A.Support(SearchDir);
        TVec3<T> SupportB = B.Support(-SearchDir);
        TVec3<T> NewPoint = SupportA - SupportB;

        // 수렴 조건 확인
        T NewDist = TVec3<T>::DotProduct(NewPoint, SearchDir);
        if (NewDist - ClosestFace.Distance < Epsilon)
        {
            // 수렴! 결과 반환
            OutNormal = ClosestFace.PlaneNormal;
            OutPenetration = ClosestFace.Distance;
            return true;
        }

        // 새 정점으로 다면체 확장
        // 1. 새 정점에서 보이는 모든 면 제거
        TArray<TPair<int32, int32>> Horizon;  // 지평선 에지들
        for (int32 FaceIdx : Queue)
        {
            TEPAEntry<T>& Face = Faces[FaceIdx];
            TVec3<T> ToNewPoint = NewPoint - VertsABuffer[Face.IdxBuffer[0]] + VertsBBuffer[Face.IdxBuffer[0]];

            if (TVec3<T>::DotProduct(ToNewPoint, Face.PlaneNormal) > 0)
            {
                // 이 면은 새 정점에서 보임 → 제거 대상
                Face.bObsolete = true;
                // 인접 면과의 에지를 지평선에 추가
                CollectHorizonEdges(Face, Faces, Horizon);
            }
        }

        // 2. 지평선 에지들과 새 정점을 연결해 새 면 생성
        int32 NewVertIdx = VertsABuffer.Num();
        VertsABuffer.Add(SupportA);
        VertsBBuffer.Add(SupportB);

        for (const auto& Edge : Horizon)
        {
            TEPAEntry<T> NewFace;
            NewFace.IdxBuffer[0] = Edge.Key;
            NewFace.IdxBuffer[1] = Edge.Value;
            NewFace.IdxBuffer[2] = NewVertIdx;
            ComputeFaceNormalAndDistance(NewFace, VertsABuffer, VertsBBuffer);
            Faces.Add(NewFace);
        }

        // 3. 큐 재정렬 (거리순)
        RebuildPriorityQueue(Faces, Queue);
    }

    return false;  // 수렴 실패
}
```

### 3단계: SAT (Separating Axis Theorem)

**용도:** 최적의 접촉 특성 선택 (면-정점 vs 모서리-모서리)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      SAT - Separating Axis Theorem                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  목적: 두 Convex 형상 사이의 "최소 분리 축" 찾기                                │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                      SAT 테스트 축 종류                                  │   │
│  │                                                                          │   │
│  │  1. Face Normals (면 법선)                                              │   │
│  │     ┌─────┐    ┌─────┐                                                  │   │
│  │     │  A  │──→ │  B  │    A의 면 법선, B의 면 법선                      │   │
│  │     └─────┘    └─────┘                                                  │   │
│  │                                                                          │   │
│  │  2. Edge Cross Products (모서리 외적)                                    │   │
│  │     ─────      ─────                                                     │   │
│  │      ╲   ↗     A의 모서리 × B의 모서리 = 잠재적 분리축                   │   │
│  │       ╲/                                                                 │   │
│  │                                                                          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  결과:                                                                          │
│  - FeatureType: Plane-Vertex (면-정점) or Edge-Edge (모서리-모서리)             │
│  - SignedDistance: 분리 거리 (음수 = 침투)                                      │
│  - FeatureIndices: 접촉하는 특성의 인덱스                                        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```cpp
// SAT 접촉 특성 선택
struct FSATResult
{
    ESATFeatureType FeatureTypes[2];  // {Plane, Vertex} or {Edge, Edge}
    int32 FeatureIndices[2];          // 각 형상의 특성 인덱스
    FReal SignedDistance;              // 부호 있는 거리 (음수 = 침투)
};

// SAT 최적 접촉 특성 선택 과정
FSATResult SelectBestContactFeature(
    const FConvex& Convex1, const FRigidTransform3& Transform1,
    const FConvex& Convex2, const FRigidTransform3& Transform2
)
{
    FSATResult BestResult;
    BestResult.SignedDistance = -TNumericLimits<FReal>::Max();

    // 1. 면-정점 테스트: Convex1의 면들
    FSATResult PlaneResult1 = SATPlaneVertex(
        Convex1, Transform1,
        Convex2, Transform2
    );
    if (PlaneResult1.SignedDistance > BestResult.SignedDistance)
    {
        BestResult = PlaneResult1;
    }

    // 2. 면-정점 테스트: Convex2의 면들
    FSATResult PlaneResult2 = SATPlaneVertex(
        Convex2, Transform2,
        Convex1, Transform1
    );
    if (PlaneResult2.SignedDistance > BestResult.SignedDistance)
    {
        BestResult = PlaneResult2;
        // 인덱스 순서 스왑 (Convex2가 첫 번째)
        Swap(BestResult.FeatureIndices[0], BestResult.FeatureIndices[1]);
    }

    // 3. 모서리-모서리 테스트
    FSATResult EdgeResult = SATEdgeEdge(
        Convex1, Transform1,
        Convex2, Transform2
    );
    if (EdgeResult.SignedDistance > BestResult.SignedDistance)
    {
        BestResult = EdgeResult;
    }

    return BestResult;
}

// 면-정점 SAT
FSATResult SATPlaneVertex(
    const FConvex& ConvexWithPlanes, const FRigidTransform3& Transform1,
    const FConvex& ConvexWithVertices, const FRigidTransform3& Transform2
)
{
    FSATResult Best;
    Best.SignedDistance = -TNumericLimits<FReal>::Max();

    const TArray<FPlane>& Planes = ConvexWithPlanes.GetPlanes();

    for (int32 PlaneIdx = 0; PlaneIdx < Planes.Num(); ++PlaneIdx)
    {
        // 월드 공간 평면 법선
        FVec3 WorldNormal = Transform1.TransformVectorNoScale(Planes[PlaneIdx].Normal);

        // ConvexWithVertices에서 이 평면에 대한 Support 정점 찾기
        // (법선 반대 방향으로 가장 먼 정점)
        FVec3 SupportPoint = ConvexWithVertices.Support(-WorldNormal, Transform2);

        // 평면까지의 부호 있는 거리
        FVec3 PlanePoint = Transform1.TransformPosition(Planes[PlaneIdx].GetOrigin());
        FReal Distance = FVec3::DotProduct(SupportPoint - PlanePoint, WorldNormal);

        if (Distance > Best.SignedDistance)
        {
            Best.SignedDistance = Distance;
            Best.FeatureTypes[0] = ESATFeatureType::Plane;
            Best.FeatureTypes[1] = ESATFeatureType::Vertex;
            Best.FeatureIndices[0] = PlaneIdx;
            // 정점 인덱스는 Support 함수에서 추적
        }

        // Early out: 분리축 발견 (거리가 양수)
        if (Distance > 0)
        {
            return Best;  // 충돌 없음
        }
    }

    return Best;
}

// 모서리-모서리 SAT
FSATResult SATEdgeEdge(
    const FConvex& Convex1, const FRigidTransform3& Transform1,
    const FConvex& Convex2, const FRigidTransform3& Transform2
)
{
    FSATResult Best;
    Best.SignedDistance = -TNumericLimits<FReal>::Max();

    const TArray<FEdge>& Edges1 = Convex1.GetEdges();
    const TArray<FEdge>& Edges2 = Convex2.GetEdges();

    for (int32 Edge1Idx = 0; Edge1Idx < Edges1.Num(); ++Edge1Idx)
    {
        FVec3 Edge1Dir = Transform1.TransformVectorNoScale(Edges1[Edge1Idx].Direction);

        for (int32 Edge2Idx = 0; Edge2Idx < Edges2.Num(); ++Edge2Idx)
        {
            FVec3 Edge2Dir = Transform2.TransformVectorNoScale(Edges2[Edge2Idx].Direction);

            // 두 모서리의 외적 = 잠재적 분리축
            FVec3 Axis = FVec3::CrossProduct(Edge1Dir, Edge2Dir);
            if (Axis.SizeSquared() < KINDA_SMALL_NUMBER)
            {
                continue;  // 평행한 모서리는 스킵
            }
            Axis.Normalize();

            // 이 축에 두 Convex 투영
            FReal Min1, Max1, Min2, Max2;
            ProjectConvexOnAxis(Convex1, Transform1, Axis, Min1, Max1);
            ProjectConvexOnAxis(Convex2, Transform2, Axis, Min2, Max2);

            // 분리 거리 계산
            FReal Distance = FMath::Max(Min1 - Max2, Min2 - Max1);

            if (Distance > Best.SignedDistance)
            {
                Best.SignedDistance = Distance;
                Best.FeatureTypes[0] = ESATFeatureType::Edge;
                Best.FeatureTypes[1] = ESATFeatureType::Edge;
                Best.FeatureIndices[0] = Edge1Idx;
                Best.FeatureIndices[1] = Edge2Idx;
            }

            // Early out: 분리축 발견
            if (Distance > 0)
            {
                return Best;  // 충돌 없음
            }
        }
    }

    return Best;
}
```

---

## 🚀 NarrowPhase 최적화 기법

### 1. SIMD 벡터화

```cpp
// SIMD 최적화된 GJK Support 함수
struct FGeomGJKHelperSIMD
{
    const void* Geometry;
    FRealSingle Margin;
    SupportFuncSIMD Func;  // SIMD 버전 Support 함수

    // 4개 방향에 대한 Support를 동시에 계산
    void Support4(
        const VectorRegister4Float& DirX,
        const VectorRegister4Float& DirY,
        const VectorRegister4Float& DirZ,
        VectorRegister4Float& OutX,
        VectorRegister4Float& OutY,
        VectorRegister4Float& OutZ
    ) const
    {
        Func(Geometry, DirX, DirY, DirZ, Margin, OutX, OutY, OutZ);
    }
};

// SIMD GJK 거리 계산
VectorRegister4Float GJKDistanceSIMD(
    const FGeomGJKHelperSIMD& A,
    const FGeomGJKHelperSIMD& B,
    VectorRegister4Float& OutClosestA,
    VectorRegister4Float& OutClosestB
)
{
    // 4개의 독립적인 GJK 인스턴스를 병렬 처리
    VectorRegister4Float DirX = VectorSet(1.0f, 0.0f, 0.0f, 0.5f);
    VectorRegister4Float DirY = VectorSet(0.0f, 1.0f, 0.0f, 0.5f);
    VectorRegister4Float DirZ = VectorSet(0.0f, 0.0f, 1.0f, 0.5f);

    // 초기 Support 점들
    VectorRegister4Float SupportAX, SupportAY, SupportAZ;
    VectorRegister4Float SupportBX, SupportBY, SupportBZ;

    A.Support4(DirX, DirY, DirZ, SupportAX, SupportAY, SupportAZ);
    B.Support4(
        VectorNegate(DirX), VectorNegate(DirY), VectorNegate(DirZ),
        SupportBX, SupportBY, SupportBZ
    );

    // Minkowski Difference
    VectorRegister4Float PointX = VectorSubtract(SupportAX, SupportBX);
    VectorRegister4Float PointY = VectorSubtract(SupportAY, SupportBY);
    VectorRegister4Float PointZ = VectorSubtract(SupportAZ, SupportBZ);

    // ... SIMD GJK 반복 ...

    return VectorSqrt(
        VectorAdd(
            VectorMultiply(PointX, PointX),
            VectorAdd(
                VectorMultiply(PointY, PointY),
                VectorMultiply(PointZ, PointZ)
            )
        )
    );
}
```

### 2. Warm Starting (웜 스타팅)

```cpp
// 이전 프레임의 Simplex를 재사용하여 수렴 가속
struct FGJKWarmStartCache
{
    TGJKSimplexData<FReal> CachedSimplex;
    FVec3 CachedSearchDir;
    bool bValid;

    void Update(const TGJKSimplexData<FReal>& NewSimplex, const FVec3& NewDir)
    {
        CachedSimplex = NewSimplex;
        CachedSearchDir = NewDir;
        bValid = true;
    }

    void Invalidate()
    {
        bValid = false;
    }
};

// Warm Start를 활용한 GJK
bool GJKWithWarmStart(
    const FImplicitObject& A, const FImplicitObject& B,
    FGJKWarmStartCache& Cache,
    FVec3& OutClosestA, FVec3& OutClosestB
)
{
    TGJKSimplexData<FReal> Simplex;
    FVec3 SearchDir;

    if (Cache.bValid)
    {
        // 캐시된 Simplex로 시작 (보통 1-3회 반복으로 수렴)
        Simplex = Cache.CachedSimplex;
        SearchDir = Cache.CachedSearchDir;
    }
    else
    {
        // Cold start (최대 32회 반복 필요)
        SearchDir = FVec3(1, 0, 0);
        Simplex.NumVerts = 0;
    }

    bool bResult = GJKCore(A, B, Simplex, SearchDir, OutClosestA, OutClosestB);

    // 결과 캐싱
    Cache.Update(Simplex, SearchDir);

    return bResult;
}
```

### 3. 메모리 최적화

```cpp
// EPA 면 풀링으로 할당 최소화
class FEPAFacePool
{
    TArray<TEPAEntry<FReal>> Pool;
    TArray<int32> FreeList;
    int32 HighWaterMark;

public:
    FEPAFacePool(int32 InitialCapacity = 256)
    {
        Pool.Reserve(InitialCapacity);
        FreeList.Reserve(InitialCapacity);
        HighWaterMark = 0;
    }

    int32 Allocate()
    {
        if (FreeList.Num() > 0)
        {
            return FreeList.Pop();
        }

        int32 NewIdx = Pool.Num();
        Pool.AddDefaulted();
        HighWaterMark = FMath::Max(HighWaterMark, NewIdx + 1);
        return NewIdx;
    }

    void Free(int32 Idx)
    {
        Pool[Idx].bObsolete = true;
        FreeList.Add(Idx);
    }

    void Reset()
    {
        FreeList.Reset();
        Pool.SetNum(0, EAllowShrinking::No);  // 메모리 유지
    }

    TEPAEntry<FReal>& operator[](int32 Idx) { return Pool[Idx]; }
};

// Simplex 데이터 정렬 최적화 (캐시 친화적)
template <typename T>
struct alignas(64) TGJKSimplexDataAligned  // 캐시 라인 정렬
{
    TVec3<T> As[4];          // 64 bytes
    TVec3<T> Bs[4];          // 64 bytes
    T Barycentric[4];        // 16 bytes
    int32 NumVerts;          // 4 bytes
    int32 Padding[3];        // 12 bytes (64바이트 정렬)
};
```

---

## 📈 NarrowPhase 성능 특성

| 알고리즘 | 시간 복잡도 | 반복 제한 | 특징 |
|----------|-------------|-----------|------|
| **GJK** | 평균 O(1)* | 최대 32회 | *Warm Start 시 1-3회, Cold Start 시 10-20회 |
| **EPA** | O(n) | 최대 128회 | n = 생성된 면의 수, 복잡한 침투에서 느림 |
| **SAT** | O(n×m) | 특성 수에 비례 | n = 면/모서리 수, Early-out으로 실제론 빠름 |

### 실측 성능 (1000 Convex-Convex 쌍)

| 시나리오 | GJK | EPA | SAT | 총합 |
|----------|-----|-----|-----|------|
| **분리된 쌍 (70%)** | 0.5ms | - | - | 0.5ms |
| **접촉 쌍 (30%)** | 0.2ms | 0.8ms | 0.3ms | 1.3ms |
| **총 처리 시간** | - | - | - | ~1.8ms |

### 최적화 효과

| 최적화 기법 | 성능 향상 | 적용 대상 |
|-------------|-----------|-----------|
| **SIMD 벡터화** | 2-4배 | GJK Support, 거리 계산 |
| **Warm Starting** | 3-10배 | GJK 반복 횟수 감소 |
| **메모리 풀링** | 1.5-2배 | EPA 면 할당/해제 |
| **Early-out** | 2-5배 | SAT 분리축 조기 발견 |

---

## ⚡ CCD (Continuous Collision Detection)

### Tunneling 문제와 CCD의 필요성

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Tunneling Problem                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Discrete Collision Detection의 한계:                                           │
│                                                                                  │
│  프레임 N           프레임 N+1                                                   │
│     ○                    ○                                                      │
│     │     얇은 벽         │                                                     │
│     │        │            │                                                     │
│     ●───────▌────────────●   ← 총알이 벽을 통과!                               │
│   위치1      │          위치2                                                   │
│              │                                                                  │
│  문제: 프레임 사이의 이동 경로를 검사하지 않음                                   │
│  → 빠른 객체가 얇은 벽을 "터널링"하여 통과                                      │
│                                                                                  │
│  CCD 해결책:                                                                    │
│     ○────────────────────○                                                     │
│     │     얇은 벽         │                                                     │
│     │        │            │                                                     │
│     ●━━━━━━━✕━━━━━━━━━━━━●   ← 이동 경로상 충돌 감지                          │
│   위치1      │충돌!     (예상 위치2)                                            │
│              │                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```cpp
// Discrete Collision Detection의 한계:
// 기존 방식: 한 프레임에서 위치만 체크
void DiscreteCollisionCheck(FParticle& ParticleA, FParticle& ParticleB, FReal DeltaTime)
{
    FVec3 PosA_Current = ParticleA.X();
    FVec3 PosB_Current = ParticleB.X();

    // 현재 위치에서만 충돌 체크 - 중간 경로는 무시
    if (Intersects(ParticleA.Geometry(), ParticleB.Geometry()))
    {
        HandleCollision(ParticleA, ParticleB);
    }
    // 문제: 빠른 객체가 얇은 벽을 통과할 수 있음
}
```

### CCD 기본 원리 - Time of Impact (TOI)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Time of Impact (TOI) Concept                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  TOI = 충돌이 발생하는 시점 [0, 1] 범위                                          │
│                                                                                  │
│  t=0 (시작)              t=TOI (충돌)           t=1 (끝)                         │
│     ○                       ○                     ○                             │
│     │                       │                     │                             │
│     ●───────────────────────●─ ─ ─ ─ ─ ─ ─ ─ ─ ─(●)                            │
│   Start                   Contact              (Predicted End)                  │
│                                                                                  │
│  Conservative Advancement:                                                       │
│  1. 현재 거리 계산                                                               │
│  2. 최대 접근 속도 계산                                                          │
│  3. 안전한 시간 스텝 = 거리 / 최대접근속도                                       │
│  4. TOI 누적, 수렴할 때까지 반복                                                 │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```cpp
class FChaosCCD
{
public:
    struct FTOIResult
    {
        bool bHasCollision;
        FReal TOI;                    // [0,1] 범위의 충돌 시점
        FVec3 CollisionNormal;
        FVec3 CollisionPoint;
    };

    FTOIResult ComputeTimeOfImpact(const FParticle& ParticleA,
                                   const FParticle& ParticleB,
                                   FReal DeltaTime)
    {
        FTOIResult Result;

        // 1. Swept Volume 생성 - 이동 경로상의 모든 위치
        FSweptGeometry SweptA = CreateSweptGeometry(ParticleA, DeltaTime);
        FSweptGeometry SweptB = CreateSweptGeometry(ParticleB, DeltaTime);

        // 2. Conservative Advancement로 TOI 계산
        Result.TOI = CalculateTOI_ConservativeAdvancement(SweptA, SweptB);

        if (Result.TOI < 1.0f)  // 충돌 발생
        {
            Result.bHasCollision = true;
            Result.CollisionPoint = InterpolatePosition(ParticleA, Result.TOI);
            Result.CollisionNormal = CalculateCollisionNormal(SweptA, SweptB, Result.TOI);
        }

        return Result;
    }

private:
    FReal CalculateTOI_ConservativeAdvancement(const FSweptGeometry& GeomA,
                                               const FSweptGeometry& GeomB)
    {
        FReal TOI = 0.0f;
        FReal MaxIterations = 20;
        FReal Tolerance = 0.001f;

        for (int32 Iter = 0; Iter < MaxIterations; ++Iter)
        {
            // 현재 TOI에서의 거리 계산
            FReal Distance = ComputeDistance(GeomA, GeomB, TOI);

            if (Distance <= Tolerance)
            {
                return TOI;  // 충돌 시점 발견
            }

            // Conservative step size 계산
            FReal MaxApproachRate = GetMaxApproachRate(GeomA, GeomB, TOI);
            if (MaxApproachRate <= 0.0f)
                break;  // 더 이상 접근하지 않음

            FReal SafeTimeStep = Distance / MaxApproachRate;
            TOI += SafeTimeStep;

            if (TOI >= 1.0f)
            {
                TOI = 1.0f;
                break;  // 이 프레임에서는 충돌 없음
            }
        }

        return TOI;
    }
};
```

### Chaos의 Speculative Contact 시스템

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     Speculative Contact System                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  개념: "미래의 충돌"을 예측하여 미리 제약 조건 생성                              │
│                                                                                  │
│  현재 프레임에서:                                                                │
│     ○                                                                           │
│     │                                                                           │
│     ●─────→ (속도)      ▌ (벽)                                                  │
│                                                                                  │
│  Speculative Contact 생성:                                                       │
│     ○                                                                           │
│     │     예측 접촉점                                                           │
│     ●─────→ ─ ─ ─ ─ ★ ─▌                                                       │
│                    ↑                                                            │
│             미래 충돌점 예측                                                     │
│                                                                                  │
│  장점:                                                                          │
│  - 실제 TOI 이전에 제약 조건 적용                                               │
│  - 부드러운 충돌 응답                                                           │
│  - Solver와 자연스럽게 통합                                                     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```cpp
class FSpeculativeCCD
{
private:
    // 미래 접촉점 예측을 위한 데이터 구조
    struct FSpeculativeContact
    {
        FParticleHandle* ParticleA;
        FParticleHandle* ParticleB;
        FReal PredictedTOI;
        FVec3 PredictedContactPoint;
        FVec3 PredictedContactNormal;
        FReal ContactDepth;
        bool bIsSpeculative;
    };

    TArray<FSpeculativeContact> SpeculativeContacts;

public:
    void GenerateSpeculativeContacts(TArray<FParticlePair>& PotentialCollisions, FReal DeltaTime)
    {
        SpeculativeContacts.Reset();

        for (const FParticlePair& Pair : PotentialCollisions)
        {
            // 상대 속도 기반 CCD 필요성 판단
            FVec3 RelativeVelocity = Pair.ParticleA->V() - Pair.ParticleB->V();
            FReal RelativeSpeed = RelativeVelocity.Size();

            FReal SpeedThreshold = GetCCDSpeedThreshold(Pair);

            if (RelativeSpeed > SpeedThreshold)
            {
                // CCD 계산 필요
                FTOIResult TOI = ComputeTimeOfImpact(*Pair.ParticleA, *Pair.ParticleB, DeltaTime);

                if (TOI.bHasCollision)
                {
                    // Speculative Contact 생성
                    FSpeculativeContact& Contact = SpeculativeContacts.AddDefaulted();
                    Contact.ParticleA = Pair.ParticleA;
                    Contact.ParticleB = Pair.ParticleB;
                    Contact.PredictedTOI = TOI.TOI;
                    Contact.PredictedContactPoint = TOI.CollisionPoint;
                    Contact.PredictedContactNormal = TOI.CollisionNormal;
                    Contact.bIsSpeculative = true;

                    // 예측 접촉 깊이 계산 (미래 침투량)
                    Contact.ContactDepth = CalculateSpeculativeDepth(Pair, TOI, DeltaTime);
                }
            }
        }
    }

private:
    FReal CalculateSpeculativeDepth(const FParticlePair& Pair,
                                    const FTOIResult& TOI,
                                    FReal DeltaTime)
    {
        // 충돌 시점 이후에도 계속 이동할 침투량 예측
        FReal RemainingTime = DeltaTime * (1.0f - TOI.TOI);
        FVec3 RelativeVelocity = Pair.ParticleA->V() - Pair.ParticleB->V();

        // 법선 방향 침투 속도
        FReal NormalApproachSpeed = FVec3::DotProduct(RelativeVelocity, TOI.CollisionNormal);

        return FMath::Max(0.0f, NormalApproachSpeed * RemainingTime);
    }
};
```

### Sub-stepping을 통한 정확한 시뮬레이션

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CCD Sub-stepping Process                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  전체 DeltaTime을 여러 Sub-step으로 분할:                                        │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────┐      │
│  │ t=0        TOI₁        TOI₂                                   t=Δt   │      │
│  │  │          │           │                                       │     │      │
│  │  ●──────────X───────────X───────────────────────────────────────●     │      │
│  │  │   Sub1   │   Sub2    │              Sub3                     │     │      │
│  │  │          │           │                                       │     │      │
│  └───────────────────────────────────────────────────────────────────────┘      │
│                                                                                  │
│  각 Sub-step에서:                                                                │
│  1. 다음 TOI 찾기 (가장 빠른 충돌)                                               │
│  2. TOI까지 모든 파티클 전진                                                     │
│  3. 충돌 처리 (속도 변경)                                                        │
│  4. 남은 시간에 대해 반복                                                        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```cpp
class FCCDSubstepper
{
private:
    struct FSubstepState
    {
        FReal CurrentTime;
        FReal RemainingTime;
        TArray<FParticleHandle*> ActiveParticles;
        bool bHasCollisions;
    };

public:
    void AdvanceWithCCD(TArray<FParticleHandle*>& Particles, FReal DeltaTime)
    {
        FSubstepState State;
        State.CurrentTime = 0.0f;
        State.RemainingTime = DeltaTime;
        State.ActiveParticles = Particles;

        int32 MaxSubsteps = 10;  // 무한 루프 방지

        for (int32 SubstepCount = 0; SubstepCount < MaxSubsteps && State.RemainingTime > SMALL_NUMBER;
             ++SubstepCount)
        {
            // 1. 다음 TOI 찾기
            FReal NextTOI = FindEarliestTOI(State.ActiveParticles, State.RemainingTime);

            if (NextTOI >= State.RemainingTime)
            {
                // 더 이상 충돌 없음 - 남은 시간만큼 전진
                AdvanceParticles(State.ActiveParticles, State.RemainingTime);
                break;
            }

            // 2. TOI 시점까지 전진
            AdvanceParticles(State.ActiveParticles, NextTOI);
            State.CurrentTime += NextTOI;
            State.RemainingTime -= NextTOI;

            // 3. 충돌 처리
            ProcessCollisionsAtTOI(State.ActiveParticles);

            // 4. 충돌 후 속도 업데이트로 인한 새로운 CCD 검사 필요
            UpdateActiveParticlesForCCD(State.ActiveParticles);
        }
    }

private:
    FReal FindEarliestTOI(const TArray<FParticleHandle*>& Particles, FReal TimeHorizon)
    {
        FReal EarliestTOI = TimeHorizon;

        // 모든 파티클 쌍에 대해 TOI 계산
        for (int32 i = 0; i < Particles.Num(); ++i)
        {
            for (int32 j = i + 1; j < Particles.Num(); ++j)
            {
                FTOIResult TOI = ComputeTimeOfImpact(*Particles[i], *Particles[j], TimeHorizon);

                if (TOI.bHasCollision && TOI.TOI < EarliestTOI)
                {
                    EarliestTOI = TOI.TOI;
                }
            }
        }

        return EarliestTOI;
    }
};
```

### Shape별 CCD 최적화

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Shape-Specific CCD Algorithms                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  Sphere-Sphere CCD: 해석적 해법 (Analytical Solution)                    │   │
│  │                                                                          │   │
│  │  2차 방정식으로 정확한 TOI 계산:                                         │   │
│  │  |P(t)|² = R²  →  At² + Bt + C = 0                                      │   │
│  │                                                                          │   │
│  │  A = |V_rel|²                                                           │   │
│  │  B = 2 * (P_rel · V_rel)                                                │   │
│  │  C = |P_rel|² - (R₁ + R₂)²                                              │   │
│  │                                                                          │   │
│  │  TOI = (-B - √(B²-4AC)) / 2A                                            │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  Convex-Convex CCD: GJK-TOI 알고리즘                                     │   │
│  │                                                                          │   │
│  │  반복적 방법:                                                            │   │
│  │  1. 현재 시점에서 GJK로 거리 계산                                        │   │
│  │  2. 최대 접근 속도 추정                                                  │   │
│  │  3. Conservative 시간 스텝으로 전진                                      │   │
│  │  4. 수렴할 때까지 반복                                                   │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```cpp
class FShapeSpecificCCD
{
public:
    // Sphere-Sphere CCD - 해석적 해법 (가장 빠름)
    FTOIResult SphereSphere_CCD(const FSphere& SphereA, const FSphere& SphereB,
                                const FVec3& VelA, const FVec3& VelB, FReal DeltaTime)
    {
        FVec3 RelativePos = SphereB.Center - SphereA.Center;
        FVec3 RelativeVel = VelB - VelA;
        FReal CombinedRadius = SphereA.Radius + SphereB.Radius;

        // 2차 방정식: |P + V*t|² = R²
        FReal A = RelativeVel.SizeSquared();
        FReal B = 2.0f * FVec3::DotProduct(RelativePos, RelativeVel);
        FReal C = RelativePos.SizeSquared() - CombinedRadius * CombinedRadius;

        FReal Discriminant = B * B - 4.0f * A * C;

        if (Discriminant >= 0.0f && A > SMALL_NUMBER)
        {
            FReal SqrtD = FMath::Sqrt(Discriminant);
            FReal TOI = (-B - SqrtD) / (2.0f * A);  // 첫 번째 교점

            if (TOI >= 0.0f && TOI <= DeltaTime)
            {
                FTOIResult Result;
                Result.bHasCollision = true;
                Result.TOI = TOI / DeltaTime;  // [0,1] 범위로 정규화

                // 충돌 지점 계산
                FVec3 PosA_AtTOI = SphereA.Center + VelA * TOI;
                FVec3 PosB_AtTOI = SphereB.Center + VelB * TOI;
                Result.CollisionNormal = (PosB_AtTOI - PosA_AtTOI).GetSafeNormal();
                Result.CollisionPoint = PosA_AtTOI + Result.CollisionNormal * SphereA.Radius;

                return Result;
            }
        }

        return FTOIResult{false, 1.0f};
    }

    // Convex-Convex CCD - GJK 기반 (일반적인 경우)
    FTOIResult ConvexConvex_CCD(const FConvex& ConvexA, const FConvex& ConvexB,
                                const FTransform& TransformA, const FTransform& TransformB,
                                const FVec3& VelA, const FVec3& VelB, FReal DeltaTime)
    {
        // GJK-TOI 알고리즘 사용
        FGJK_TOI GJKSolver;
        return GJKSolver.ComputeTOI(ConvexA, ConvexB, TransformA, TransformB,
                                    VelA, VelB, DeltaTime);
    }
};
```

### CCD 성능 최적화

```cpp
class FCCDPerformanceOptimizer
{
private:
    // CCD 후보 필터링을 위한 휴리스틱
    struct FCCDCandidate
    {
        FParticlePair Pair;
        FReal Priority;        // 충돌 가능성 점수
        bool bNeedsCCD;

        FCCDCandidate(const FParticlePair& InPair) : Pair(InPair)
        {
            Priority = CalculateCCDPriority(InPair);
            bNeedsCCD = Priority > CCDThreshold;
        }
    };

    FReal CCDThreshold = 0.5f;

public:
    void OptimizedCCDProcessing(TArray<FParticlePair>& AllPairs, FReal DeltaTime)
    {
        TArray<FCCDCandidate> CCDCandidates;

        // 1. 빠른 필터링으로 CCD 후보 선별
        for (const FParticlePair& Pair : AllPairs)
        {
            FCCDCandidate Candidate(Pair);
            if (Candidate.bNeedsCCD)
            {
                CCDCandidates.Add(Candidate);
            }
        }

        // 2. 우선순위 정렬 (높은 위험도부터)
        CCDCandidates.Sort([](const FCCDCandidate& A, const FCCDCandidate& B) {
            return A.Priority > B.Priority;
        });

        // 3. 계층적 CCD 처리
        ProcessHighPriorityCCD(CCDCandidates, DeltaTime);
    }

private:
    FReal CalculateCCDPriority(const FParticlePair& Pair)
    {
        // 다양한 요소를 고려한 우선순위 계산
        FVec3 RelativeVel = Pair.ParticleA->V() - Pair.ParticleB->V();
        FReal RelativeSpeed = RelativeVel.Size();

        FReal Distance = (Pair.ParticleA->X() - Pair.ParticleB->X()).Size();
        FReal MinThickness = FMath::Min(Pair.ParticleA->GetMinThickness(),
                                        Pair.ParticleB->GetMinThickness());

        // 속도/거리 비율과 객체 두께 고려
        FReal SpeedRatio = RelativeSpeed * DeltaTime / Distance;
        FReal ThicknessRatio = RelativeSpeed * DeltaTime / MinThickness;

        return FMath::Max(SpeedRatio, ThicknessRatio);
    }

    void ProcessHighPriorityCCD(TArray<FCCDCandidate>& Candidates, FReal DeltaTime)
    {
        // 병렬 처리 가능한 독립적인 그룹 생성
        TArray<TArray<FCCDCandidate*>> IndependentGroups;
        GroupIndependentCandidates(Candidates, IndependentGroups);

        // 각 그룹을 병렬로 처리
        ParallelFor(IndependentGroups.Num(), [&](int32 GroupIndex)
        {
            for (FCCDCandidate* Candidate : IndependentGroups[GroupIndex])
            {
                ProcessSingleCCDCandidate(*Candidate, DeltaTime);
            }
        });
    }
};
```

### CCD와 Island 시스템 통합

```cpp
class FCCDIslandIntegration
{
public:
    void UpdateIslandsWithCCD(TArray<FPBDIsland*>& Islands, FReal DeltaTime)
    {
        for (FPBDIsland* Island : Islands)
        {
            // Island 내부에서만 CCD 수행 (독립성 유지)
            ProcessIslandCCD(*Island, DeltaTime);
        }
    }

private:
    void ProcessIslandCCD(FPBDIsland& Island, FReal DeltaTime)
    {
        // 1. Island 내 고속 객체 식별
        TArray<FParticleHandle*> FastParticles;
        IdentifyFastParticles(Island, FastParticles);

        if (FastParticles.Num() == 0)
            return;  // CCD 불필요

        // 2. Island별 Sub-stepping
        FCCDSubstepper Substepper;
        Substepper.AdvanceWithCCD(FastParticles, DeltaTime);

        // 3. CCD로 인한 새로운 연결이 Island 분할 유발할 수 있음
        CheckForIslandStructureChange(Island);
    }

    void CheckForIslandStructureChange(FPBDIsland& Island)
    {
        // CCD로 인한 새로운 접촉이 Island 구조를 변경했는지 확인
        // 필요시 Island 재구성 요청
        if (HasNewConnections(Island))
        {
            Island.MarkForRestructure();
        }
    }
};
```

### CCD 성능 비교

| 방식 | 정확도 | 성능 | 사용 사례 |
|------|--------|------|-----------|
| **Discrete** | 낮음 | ⭐⭐⭐⭐⭐ | 저속 객체, 두꺼운 충돌체 |
| **Speculative Contact** | 중간 | ⭐⭐⭐⭐ | 일반적인 게임 시나리오 |
| **Sub-stepping** | 높음 | ⭐⭐⭐ | 정밀 시뮬레이션 |
| **Full TOI** | 최고 | ⭐⭐ | 과학/엔지니어링 시뮬레이션 |

### CCD 활성화 설정

```cpp
// 프로젝트 설정에서 CCD 활성화
// Project Settings > Physics > Enable CCD

// 컴포넌트별 CCD 설정
UPROPERTY(EditAnywhere, Category = "Physics")
bool bUseCCD = false;

// 또는 런타임에서
UPrimitiveComponent* Mesh = GetMesh();
Mesh->SetUseCCD(true);

// CCD 임계값 조정
// 물체가 한 프레임에 이 비율 이상 이동하면 CCD 적용
// Default: 0.5 (반지름의 50%)
p.Chaos.CCD.CCDEnableThresholdBoundsScale = 0.5f;
```

---

## 🔄 Chaos 충돌 처리 함수 호출 흐름

### 메인 물리 업데이트 파이프라인

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Chaos Physics Update Pipeline                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  FPBDRigidsEvolutionGBF::Advance()              // PBDRigidsEvolutionGBF.cpp:334│
│      │                                                                          │
│      ├── AdvanceOneTimeStepImpl()               // :488                         │
│      │                                                                          │
│      ├── CollisionDetector.RunBroadPhase()      // :577                         │
│      │       │                                                                  │
│      │       ├── BroadPhase.ProduceOverlaps()   // SpatialAccelerationCD.h:33  │
│      │       │                                                                  │
│      │       └── ParticlePairCollisionAllowed() // SpatialAccelerationBP.h:41  │
│      │                                                                          │
│      ├── CollisionDetector.RunNarrowPhase()     // :588                         │
│      │       │                                                                  │
│      │       ├── BroadPhase.ProduceCollisions()                                 │
│      │       │                                                                  │
│      │       └── FCollisionContextAllocator::CreateConstraint()                │
│      │                                                                          │
│      └── IslandGroupManager.Solve()             // :686                         │
│              │                                                                  │
│              └── FPBDCollisionSolver (Position → Velocity)                     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Constraint Solver 실행 흐름

```cpp
// PBDCollisionSolver.h

// 위치 솔버
FPBDCollisionSolver::SolvePosition()                 // :904
├── SolvePositionNoFriction()                        // :1042
│   └── ApplyPositionCorrectionNormal()              // :569
└── SolvePositionWithFriction()                      // :1099
    └── ApplyFrictionCone()                          // :464

// 속도 솔버
FPBDCollisionSolver::SolveVelocity()                 // :978
└── ApplyVelocityCorrection()                        // :613
```

---

## 📐 PBD (Position Based Dynamics) 솔버 상세

### 위치 보정 공식

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    PBD Position Correction Formula                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  기본 공식:                                                                      │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │  PushOut = -Stiffness × ContactDelta × ContactMass                        │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  각 파티클에 대한 보정:                                                          │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │  DX = (InvM × PushOut) × ContactNormal    // 위치 변화                    │  │
│  │  DR = ContactNormalAngular × PushOut       // 회전 변화                    │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  Dynamic 물체만 위치/회전 변경:                                                  │
│  - Static: InvM = 0, InvI = 0 → DX = 0, DR = 0                                 │
│  - Dynamic: InvM > 0, InvI > 0 → 정상 보정 적용                                │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```cpp
// PBD 위치 보정 구현
void ApplyPositionCorrectionNormal(
    FReal Stiffness,
    FReal ContactDeltaNormal,
    FReal ContactMassNormal,
    const FVec3& ContactNormal,
    FPBDRigidParticleHandle* Body0,
    FPBDRigidParticleHandle* Body1
)
{
    // PushOut 계산
    FReal PushOutNormal = -Stiffness * ContactDeltaNormal * ContactMassNormal;

    // Dynamic 물체에만 적용
    if (Body0->IsDynamic())
    {
        FVec3 DX0 = (Body0->InvM() * PushOutNormal) * ContactNormal;
        FRotation3 DR0 = ContactNormalAngular0 * PushOutNormal;
        Body0->ApplyPositionDelta(DX0);
        Body0->ApplyRotationDelta(DR0);
    }

    // Body1도 반대 방향으로 동일하게 처리
    if (Body1->IsDynamic())
    {
        FVec3 DX1 = -(Body1->InvM() * PushOutNormal) * ContactNormal;
        FRotation3 DR1 = -ContactNormalAngular1 * PushOutNormal;
        Body1->ApplyPositionDelta(DX1);
        Body1->ApplyRotationDelta(DR1);
    }
}
```

### 접촉점 유효 질량 계산

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Contact Effective Mass Calculation                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  유효 질량 역수 공식:                                                            │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                            │  │
│  │   1         1        T  -1                 1        T  -1                  │  │
│  │  ─────  =  ─── + (r₀×n)  I₀  (r₀×n)  +  ─── + (r₁×n)  I₁  (r₁×n)         │  │
│  │  M_eff     m₀                            m₁                                │  │
│  │                                                                            │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  여기서:                                                                         │
│  - m: 질량                                                                      │
│  - I: 관성 텐서                                                                 │
│  - r: 질량 중심에서 접촉점까지의 벡터                                           │
│  - n: 접촉 법선                                                                 │
│                                                                                  │
│  Static 물체의 경우:                                                             │
│  - 1/m = 0 (무한 질량)                                                          │
│  - I⁻¹ = 0 (무한 관성)                                                         │
│  → 유효 질량에 기여하지 않음                                                    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```cpp
// 유효 접촉 질량 계산
FReal CalculateContactMass(
    const FPBDRigidParticleHandle* Body0,
    const FPBDRigidParticleHandle* Body1,
    const FVec3& ContactNormal,
    const FVec3& ContactOffset0,
    const FVec3& ContactOffset1
)
{
    FVec3 R0CrossN = FVec3::CrossProduct(ContactOffset0, ContactNormal);
    FVec3 R1CrossN = FVec3::CrossProduct(ContactOffset1, ContactNormal);

    // 유효 질량 역수 계산
    FReal ContactMassInvNormal =
        Body0->InvM() + FVec3::DotProduct(R0CrossN, Body0->InvI() * R0CrossN) +
        Body1->InvM() + FVec3::DotProduct(R1CrossN, Body1->InvI() * R1CrossN);

    // 유효 접촉 질량
    return (ContactMassInvNormal > SMALL_NUMBER) ? 1.0f / ContactMassInvNormal : 0.0f;
}
```

### Static 물체 특수 처리

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Static vs Dynamic Object Handling                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────┐    ┌─────────────────────────────┐            │
│  │       Static 물체           │    │       Dynamic 물체          │            │
│  ├─────────────────────────────┤    ├─────────────────────────────┤            │
│  │  InvM = 0 (무한 질량)       │    │  InvM > 0 (유한 질량)       │            │
│  │  InvI = 0 (무한 관성)       │    │  InvI > 0 (유한 관성)       │            │
│  │  IsDynamic() = false        │    │  IsDynamic() = true         │            │
│  │                             │    │                             │            │
│  │  결과:                      │    │  결과:                      │            │
│  │  - DX = 0 (위치 변경 없음)  │    │  - DX 계산됨                │            │
│  │  - DR = 0 (회전 변경 없음)  │    │  - DR 계산됨                │            │
│  │  - 다른 물체가 튕겨나감     │    │  - 충격에 반응함            │            │
│  └─────────────────────────────┘    └─────────────────────────────┘            │
│                                                                                  │
│  ⚠️ 중요: Static-Static 충돌은 의도적으로 차단됨                               │
│     → ParticlePairCollisionAllowed()에서 필터링                                 │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Friction & Restitution 처리

```cpp
// 마찰 원뿔 제한 (Friction Cone)
void ApplyFrictionCone(
    FReal StaticFriction,
    FReal DynamicFriction,
    FReal NormalForce,
    FVec3& TangentialForce
)
{
    // 정적 마찰 한계 검사
    FReal MaxStaticFriction = StaticFriction * NormalForce;
    FReal TangentialMagnitude = TangentialForce.Size();

    if (TangentialMagnitude > MaxStaticFriction)
    {
        // 동적 마찰로 전환 (미끄러짐 시작)
        FReal DynamicLimit = DynamicFriction * NormalForce;
        TangentialForce = TangentialForce.GetSafeNormal() * DynamicLimit;
    }
}

// 반발 계수 (Restitution) 적용
void ApplyRestitution(
    FReal Restitution,
    FReal ContactVelocity,
    FReal RestitutionThreshold,
    FReal& TargetVelocity
)
{
    // 충돌 속도가 임계값 이상일 때만 반발 적용
    if (Restitution > 0.0f && ContactVelocity < -RestitutionThreshold)
    {
        // 반발 후 목표 속도 = -반발계수 × 충돌 속도
        TargetVelocity = -Restitution * ContactVelocity;
    }
    else
    {
        TargetVelocity = 0.0f;  // 비탄성 충돌
    }
}
```

### 주요 코드 위치 참조

| 기능 | 파일 위치 | 라인 |
|------|----------|------|
| **충돌 필터링** | SpatialAccelerationBroadPhase.h | 120-124 |
| **위치 솔버** | PBDCollisionSolver.h | 1042-1070 |
| **속도 솔버** | PBDCollisionSolver.h | 613-685 |
| **질량 계산** | PBDCollisionSolver.h | 721-782 |
| **마찰 처리** | PBDCollisionSolver.h | 464-510 |

---

## 🔍 SQAccelerator (Spatial Query Accelerator)

### 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    SQ Accelerator Architecture                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  IChaosSQAccelerator (인터페이스)                                               │
│       │                                                                         │
│       ├── FGenericChaosSQAccelerator                                            │
│       │     │                                                                   │
│       │     └── 기본 Query 가속기                                               │
│       │         - Sweep, Overlap, Trace 연산 가속                              │
│       │         - SceneQueryLowLevel.cpp에 정의                                │
│       │                                                                         │
│       └── 기타 특수화된 가속기들...                                             │
│                                                                                  │
│  역할:                                                                          │
│  - Spatial Query 연산을 최적화                                                  │
│  - AABBTree, BVH 등의 가속 구조 활용                                           │
│  - Sweep/Overlap/Trace의 빠른 실행 보장                                        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### FGenericChaosSQAccelerator

```cpp
// SceneQueryLowLevel.cpp에 정의

class FGenericChaosSQAccelerator : public IChaosSQAccelerator
{
public:
    // Sweep 연산
    virtual void Sweep(
        const FPhysicsGeometry& QueryGeom,
        const FTransform& StartTM,
        const FVec3& Dir,
        FReal Length,
        FPhysicsHitCallback<FHitSweep>& HitBuffer,
        EHitFlags OutputFlags,
        const FQueryFilterData& QueryFilterData,
        ICollisionQueryFilterCallbackBase& QueryCallback
    ) override;

    // Overlap 연산
    virtual void Overlap(
        const FPhysicsGeometry& QueryGeom,
        const FTransform& GeomPose,
        FPhysicsHitCallback<FHitOverlap>& HitBuffer,
        const FQueryFilterData& QueryFilterData,
        ICollisionQueryFilterCallbackBase& QueryCallback
    ) override;

    // Raycast 연산
    virtual void Raycast(
        const FVec3& Start,
        const FVec3& Dir,
        FReal Length,
        FPhysicsHitCallback<FHitRaycast>& HitBuffer,
        EHitFlags OutputFlags,
        const FQueryFilterData& QueryFilterData,
        ICollisionQueryFilterCallbackBase& QueryCallback
    ) override;
};
```

### AABBTree의 GlobalPayloads

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    AABBTree GlobalPayloads                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  개념: AABB 트리의 특정 노드에 할당되지 않는 객체들의 목록                       │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                        AABBTree 구조                                     │   │
│  │                                                                          │   │
│  │           ┌───────────────────────────────────────┐                     │   │
│  │           │            Root Node                  │                     │   │
│  │           └───────────────┬───────────────────────┘                     │   │
│  │                           │                                              │   │
│  │           ┌───────────────┴───────────────┐                             │   │
│  │           │                               │                              │   │
│  │    ┌──────┴──────┐                 ┌──────┴──────┐                      │   │
│  │    │  Left Node  │                 │ Right Node  │                      │   │
│  │    │  (Payloads) │                 │ (Payloads)  │                      │   │
│  │    └─────────────┘                 └─────────────┘                      │   │
│  │                                                                          │   │
│  │    ─────────────────────────────────────────────────                    │   │
│  │                                                                          │   │
│  │    ┌─────────────────────────────────────────────────────────────┐      │   │
│  │    │                    GlobalPayloads                            │      │   │
│  │    │  (특정 노드에 속하지 않는 객체들)                            │      │   │
│  │    │                                                              │      │   │
│  │    │  • 매우 큰 객체 (여러 노드에 걸침)                          │      │   │
│  │    │  • 고속 이동 객체 (프레임 간 노드 이탈)                      │      │   │
│  │    │  • 전역적 충돌 객체 (특수 처리 필요)                         │      │   │
│  │    └─────────────────────────────────────────────────────────────┘      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  GlobalPayloads가 필요한 이유:                                                  │
│  1. 매우 큰 객체: 지형, 바다, 전체 맵 장애물                                   │
│  2. 고속 이동 객체: 탄환, 차량 - 노드 이동 오버헤드 방지                       │
│  3. 특수 객체: 트리 내에서 직접 관리하기 어려운 피직스 객체                     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```cpp
// AABBTree의 GlobalPayloads 사용
template<typename TPayloadType, typename TLeafType>
class TAABBTree
{
    // 노드 기반 페이로드
    TArray<TLeafType> Leaves;
    TArray<FAABBTreeNode> Nodes;

    // 전역 페이로드 - 특정 노드에 할당되지 않는 객체들
    TArray<TPayloadType> GlobalPayloads;

    void QueryImp(...)
    {
        // 1. 트리 노드 순회
        TraverseNodes(QueryBounds, Visitor);

        // 2. GlobalPayloads도 항상 검사
        for (const TPayloadType& Payload : GlobalPayloads)
        {
            if (Intersects(QueryBounds, Payload.Bounds))
            {
                Visitor(Payload);
            }
        }
    }

    void AddPayload(const TPayloadType& Payload)
    {
        if (IsTooBigForTree(Payload))
        {
            // 너무 크면 GlobalPayloads에 추가
            GlobalPayloads.Add(Payload);
        }
        else
        {
            // 정상적으로 트리에 삽입
            InsertIntoTree(Payload);
        }
    }
};
```

---

## 🔍 Scene Query

### 쿼리 타입

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            Scene Query Types                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────────┐                                                           │
│  │     Raycast      │  광선과 월드의 교차점 찾기                                │
│  │                  │                                                           │
│  │  ──────●────────>│  Start + Direction * Distance                             │
│  │              Hit │                                                           │
│  └──────────────────┘                                                           │
│                                                                                  │
│  ┌──────────────────┐                                                           │
│  │     Sweep        │  형상을 이동시키며 충돌 검사                              │
│  │                  │                                                           │
│  │  ○────────○────>│  Geometry moving along path                               │
│  │              Hit │                                                           │
│  └──────────────────┘                                                           │
│                                                                                  │
│  ┌──────────────────┐                                                           │
│  │    Overlap       │  형상과 겹치는 모든 객체 찾기                             │
│  │                  │                                                           │
│  │    ┌─────────┐   │                                                           │
│  │    │ Query   │   │  모든 겹치는 Particle 반환                               │
│  │    │ Volume  │   │                                                           │
│  │    └─────────┘   │                                                           │
│  └──────────────────┘                                                           │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔍 Trace/Sweep 내부 동작 상세

### LineTrace 내부 흐름

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     LineTrace Internal Flow                                      │
│                     LineTraceSingleByChannel 호출 시                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  STEP 1: 게임 스레드 → 물리 인터페이스                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  UWorld::LineTraceSingleByChannel(Hit, Start, End, Channel, Params)     │   │
│  │      │                                                                   │   │
│  │      ↓                                                                   │   │
│  │  FPhysicsInterface::RaycastSingle(World, Hit, Start, End, Channel...)   │   │
│  │      │                                                                   │   │
│  │      ↓                                                                   │   │
│  │  GetPhysicsScene()->RaycastSingle(...)                                   │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  STEP 2: 필터 데이터 생성                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  FCollisionFilterData QueryFilter;                                       │   │
│  │                                                                          │   │
│  │  // Channel → 비트마스크 변환                                            │   │
│  │  QueryFilter.Word0 = Channel;           // 쿼리 채널                     │   │
│  │  QueryFilter.Word1 = BlockMask;         // Block 응답 비트마스크         │   │
│  │  QueryFilter.Word2 = OverlapMask;       // Overlap 응답 비트마스크       │   │
│  │                                                                          │   │
│  │  // 프로젝트 설정의 Response Matrix가 비트마스크로 인코딩됨              │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  STEP 3: BroadPhase 쿼리 (AABB 기반)                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  // 광선을 감싸는 AABB 생성                                              │   │
│  │  FAABB3 RayAABB = FAABB3(Start, End).Thicken(Tolerance);                 │   │
│  │                                                                          │   │
│  │  // BVH 트리 순회 → 겹치는 모든 오브젝트 수집                           │   │
│  │  TArray<FAccelerationStructureHandle> Candidates;                        │   │
│  │  BroadPhase.Query(RayAABB, [&](Handle) {                                 │   │
│  │      // 필터 체크 (Channel 또는 ObjectType)                              │   │
│  │      if (PassesFilter(Handle.FilterData, QueryFilter))                   │   │
│  │      {                                                                   │   │
│  │          Candidates.Add(Handle);                                         │   │
│  │      }                                                                   │   │
│  │  });                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  STEP 4: NarrowPhase (정밀 Ray-Shape 교차 검사)                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  FReal ClosestT = FLT_MAX;                                               │   │
│  │  FHitResult ClosestHit;                                                  │   │
│  │                                                                          │   │
│  │  for (Handle : Candidates)                                               │   │
│  │  {                                                                       │   │
│  │      FImplicitObject* Shape = Handle.GetImplicit();                      │   │
│  │                                                                          │   │
│  │      // 형상별 Ray 교차 알고리즘                                         │   │
│  │      FReal T;                                                            │   │
│  │      FVec3 HitPoint, HitNormal;                                          │   │
│  │                                                                          │   │
│  │      switch (Shape->GetType())                                           │   │
│  │      {                                                                   │   │
│  │          case Sphere:   RaySphere(Start, Dir, Shape, T, ...);   break;  │   │
│  │          case Box:      RayBox(Start, Dir, Shape, T, ...);      break;  │   │
│  │          case Capsule:  RayCapsule(Start, Dir, Shape, T, ...);  break;  │   │
│  │          case Convex:   RayConvex(Start, Dir, Shape, T, ...);   break;  │   │
│  │          case TriMesh:  RayTriMesh(Start, Dir, Shape, T, ...);  break;  │   │
│  │      }                                                                   │   │
│  │                                                                          │   │
│  │      if (T < ClosestT)                                                   │   │
│  │      {                                                                   │   │
│  │          ClosestT = T;                                                   │   │
│  │          // FHitResult 채우기                                            │   │
│  │          ClosestHit.Distance = T * RayLength;                            │   │
│  │          ClosestHit.ImpactPoint = HitPoint;                              │   │
│  │          ClosestHit.ImpactNormal = HitNormal;                            │   │
│  │      }                                                                   │   │
│  │  }                                                                       │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  STEP 5: 결과 변환 및 반환                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  // Chaos 결과 → UE FHitResult 변환                                      │   │
│  │  ConvertQueryImpactHit(ChaosHit, OutHit);                                │   │
│  │                                                                          │   │
│  │  // Actor/Component 참조 설정                                            │   │
│  │  OutHit.Actor = GetOwningActor(Handle);                                  │   │
│  │  OutHit.Component = GetOwningComponent(Handle);                          │   │
│  │                                                                          │   │
│  │  return ClosestHit.bBlockingHit;                                         │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Sweep 내부 흐름

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Sweep Internal Flow                                       │
│                        SweepSingleByChannel 호출 시                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Sweep = "형상을 이동시키며 충돌 검사"                                          │
│                                                                                  │
│  LineTrace:  Start ●──────────────────────────● End (점 이동)                   │
│                                                                                  │
│  Sweep:      Start ○────────────○────────────○ End (형상 이동)                 │
│                    (Sphere)    (Sphere)    (Sphere)                             │
│                                                                                  │
│  STEP 1: Swept AABB 계산                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  // Sweep 형상의 이동 경로를 감싸는 AABB                                 │   │
│  │                                                                          │   │
│  │     ┌──────────────────────────────────────┐                            │   │
│  │     │                                      │   SweptAABB                │   │
│  │     │   ○────────○────────○              │   = StartAABB ∪ EndAABB    │   │
│  │     │  Start              End             │     + Shape Extent          │   │
│  │     │                                      │                             │   │
│  │     └──────────────────────────────────────┘                            │   │
│  │                                                                          │   │
│  │  FAABB3 SweptAABB;                                                       │   │
│  │  SweptAABB.GrowToInclude(StartTransform.GetLocation() + ShapeBounds);    │   │
│  │  SweptAABB.GrowToInclude(EndTransform.GetLocation() + ShapeBounds);      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  STEP 2: BroadPhase 쿼리                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  // SweptAABB와 겹치는 모든 오브젝트 수집                                │   │
│  │  BroadPhase.Query(SweptAABB, [&](Handle) {                               │   │
│  │      if (PassesFilter(Handle, QueryFilter))                              │   │
│  │          Candidates.Add(Handle);                                         │   │
│  │  });                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  STEP 3: NarrowPhase (GJK-based Sweep)                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  for (Handle : Candidates)                                               │   │
│  │  {                                                                       │   │
│  │      FImplicitObject* TargetShape = Handle.GetImplicit();                │   │
│  │                                                                          │   │
│  │      // GJK Raycast: Minkowski Sum 공간에서 Ray 검사                     │   │
│  │      // SweepShape ⊕ (-TargetShape) 공간에서 원점으로 향하는 Ray         │   │
│  │                                                                          │   │
│  │      FReal TOI;  // Time of Impact (0~1)                                 │   │
│  │      FVec3 HitNormal, HitPoint;                                          │   │
│  │                                                                          │   │
│  │      bool bHit = GJKRaycast(                                             │   │
│  │          SweepShape,           // 이동하는 형상                          │   │
│  │          TargetShape,          // 고정된 대상 형상                       │   │
│  │          StartTransform,                                                 │   │
│  │          Direction,                                                      │   │
│  │          Distance,                                                       │   │
│  │          TOI,                  // 출력: 충돌 시점                        │   │
│  │          HitPoint,                                                       │   │
│  │          HitNormal                                                       │   │
│  │      );                                                                   │   │
│  │                                                                          │   │
│  │      if (bHit && TOI < ClosestTOI)                                       │   │
│  │      {                                                                   │   │
│  │          ClosestTOI = TOI;                                               │   │
│  │          ClosestHit = BuildHitResult(TOI, HitPoint, HitNormal, Handle);  │   │
│  │      }                                                                   │   │
│  │  }                                                                       │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  STEP 4: 결과 반환                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  // Location = Sweep 시작점 + Direction * (TOI * Distance)               │   │
│  │  //          = 충돌 시점에서 Sweep 형상의 중심 위치                      │   │
│  │  OutHit.Location = Start + Direction * (TOI * Distance);                 │   │
│  │                                                                          │   │
│  │  // ImpactPoint = 실제 접촉 위치                                         │   │
│  │  OutHit.ImpactPoint = HitPoint;                                          │   │
│  │                                                                          │   │
│  │  // Distance = 이동한 거리                                               │   │
│  │  OutHit.Distance = TOI * TotalDistance;                                  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Overlap 내부 흐름

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Overlap Internal Flow                                     │
│                        OverlapMultiByChannel 호출 시                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Overlap = "주어진 위치에서 형상과 겹치는 모든 오브젝트 찾기"                   │
│                                                                                  │
│  STEP 1: Query Shape의 AABB 계산                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  FAABB3 QueryAABB = QueryShape.CalculateWorldBounds(Transform);          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  STEP 2: BroadPhase 쿼리                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  BroadPhase.Query(QueryAABB, [&](Handle) {                               │   │
│  │      if (PassesFilter(Handle, QueryFilter))                              │   │
│  │          Candidates.Add(Handle);                                         │   │
│  │  });                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  STEP 3: NarrowPhase (GJK Overlap Test)                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  for (Handle : Candidates)                                               │   │
│  │  {                                                                       │   │
│  │      FImplicitObject* TargetShape = Handle.GetImplicit();                │   │
│  │                                                                          │   │
│  │      // GJK로 두 형상의 겹침 여부만 확인 (침투 깊이는 필요 없음)         │   │
│  │      bool bOverlaps = GJKOverlap(                                        │   │
│  │          QueryShape, QueryTransform,                                     │   │
│  │          TargetShape, TargetTransform                                    │   │
│  │      );                                                                   │   │
│  │                                                                          │   │
│  │      if (bOverlaps)                                                      │   │
│  │      {                                                                   │   │
│  │          FOverlapResult Result;                                          │   │
│  │          Result.Actor = GetOwningActor(Handle);                          │   │
│  │          Result.Component = GetOwningComponent(Handle);                  │   │
│  │          OutOverlaps.Add(Result);                                        │   │
│  │      }                                                                   │   │
│  │  }                                                                       │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ※ Overlap은 Hit 위치/법선 정보가 없음 (겹침 여부만 확인)                       │
│  ※ 정확한 침투 정보가 필요하면 Sweep + bStartPenetrating 사용                   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Single vs Multi 쿼리

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Single vs Multi Query                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────┐    ┌─────────────────────────────┐            │
│  │      Single Query           │    │      Multi Query            │            │
│  ├─────────────────────────────┤    ├─────────────────────────────┤            │
│  │                             │    │                              │            │
│  │  ●────────●─────X──────●   │    │  ●────●─────●──────●        │            │
│  │  Start    Hit   (무시) End  │    │  Start Hit1  Hit2   End     │            │
│  │                             │    │                              │            │
│  │  • 첫 번째 Block만 반환     │    │  • 모든 Block 반환          │            │
│  │  • 가장 가까운 것만 필요    │    │  • 관통샷, 다중 타겟        │            │
│  │  • 성능 최적화 가능         │    │  • 정렬되어 반환            │            │
│  │                             │    │                              │            │
│  │  LineTraceSingleByChannel   │    │  LineTraceMultiByChannel    │            │
│  │  SweepSingleByChannel       │    │  SweepMultiByChannel        │            │
│  │                             │    │  OverlapMultiByChannel      │            │
│  └─────────────────────────────┘    └─────────────────────────────┘            │
│                                                                                  │
│  내부 차이:                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  // Single: Early Out 가능                                               │   │
│  │  if (bHit && TOI < ClosestTOI)                                           │   │
│  │  {                                                                       │   │
│  │      ClosestTOI = TOI;                                                   │   │
│  │      // 이미 찾은 것보다 먼 후보는 스킵 가능                             │   │
│  │  }                                                                       │   │
│  │                                                                          │   │
│  │  // Multi: 모든 히트 수집 후 정렬                                        │   │
│  │  AllHits.Add(Hit);                                                       │   │
│  │  // 쿼리 완료 후                                                         │   │
│  │  AllHits.Sort([](A, B) { return A.Distance < B.Distance; });             │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Simple vs Complex Collision 선택

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Simple vs Complex Collision Selection                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  FCollisionQueryParams::bTraceComplex 에 따라 달라짐                            │
│                                                                                  │
│  ┌─────────────────────────────────────────┐                                    │
│  │       bTraceComplex = false (기본)      │                                    │
│  ├─────────────────────────────────────────┤                                    │
│  │                                          │                                    │
│  │   실제 메시:        Simple Collision:    │                                    │
│  │   ┌──────────┐     ┌──────────┐         │                                    │
│  │   │ /\  /\   │     │          │         │                                    │
│  │   │/  \/  \  │  →  │  (Box)   │         │                                    │
│  │   │\  /\  /  │     │          │         │                                    │
│  │   └──────────┘     └──────────┘         │                                    │
│  │                                          │                                    │
│  │   • Convex Hull, Box, Sphere 등 사용     │                                    │
│  │   • 빠른 충돌 검사                       │                                    │
│  │   • 물리 시뮬레이션에 사용               │                                    │
│  │                                          │                                    │
│  └─────────────────────────────────────────┘                                    │
│                                                                                  │
│  ┌─────────────────────────────────────────┐                                    │
│  │       bTraceComplex = true              │                                    │
│  ├─────────────────────────────────────────┤                                    │
│  │                                          │                                    │
│  │   실제 메시의 모든 삼각형 사용:          │                                    │
│  │   ┌──────────┐                          │                                    │
│  │   │ /\  /\   │  ← 각 삼각형과 검사      │                                    │
│  │   │/  \/  \  │                          │                                    │
│  │   │\  /\  /  │                          │                                    │
│  │   └──────────┘                          │                                    │
│  │                                          │                                    │
│  │   • FaceIndex 반환 가능                  │                                    │
│  │   • 정확한 UV 매핑, 데칼 배치에 필요     │                                    │
│  │   • 비용 높음 (삼각형 수에 비례)         │                                    │
│  │                                          │                                    │
│  └─────────────────────────────────────────┘                                    │
│                                                                                  │
│  사용 시나리오:                                                                  │
│  │                                                                              │
│  │  • 총알 궤적 표시: bTraceComplex = true (정확한 위치 필요)                   │
│  │  • 캐릭터 이동: bTraceComplex = false (성능 중요)                            │
│  │  • 데칼 배치: bTraceComplex = true (FaceIndex로 UV 계산)                     │
│  │  • AI 시야 검사: bTraceComplex = false (대략적 판단)                         │
│  │                                                                              │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### API 사용법

#### Raycast

```cpp
// 단일 히트 (가장 가까운)
FHitResult Hit;
bool bHit = World->LineTraceSingleByChannel(
    Hit,
    Start,
    End,
    ECC_Visibility,          // 채널
    CollisionParams
);

if (bHit)
{
    AActor* HitActor = Hit.GetActor();
    FVector HitLocation = Hit.ImpactPoint;
    FVector HitNormal = Hit.ImpactNormal;
    float Distance = Hit.Distance;
}

// 다중 히트 (모든 히트)
TArray<FHitResult> Hits;
bool bHit = World->LineTraceMultiByChannel(
    Hits,
    Start,
    End,
    ECC_Visibility,
    CollisionParams
);
```

#### Sweep

```cpp
// Sphere Sweep
FHitResult Hit;
FCollisionShape Shape = FCollisionShape::MakeSphere(50.0f);

bool bHit = World->SweepSingleByChannel(
    Hit,
    Start,
    End,
    FQuat::Identity,
    ECC_Pawn,
    Shape,
    CollisionParams
);

// Capsule Sweep
FCollisionShape CapsuleShape = FCollisionShape::MakeCapsule(34.0f, 88.0f);

// Box Sweep
FCollisionShape BoxShape = FCollisionShape::MakeBox(FVector(50.0f, 50.0f, 50.0f));
```

#### Overlap

```cpp
// Sphere Overlap
TArray<FOverlapResult> Overlaps;
FCollisionShape Shape = FCollisionShape::MakeSphere(100.0f);

bool bOverlap = World->OverlapMultiByChannel(
    Overlaps,
    Location,
    FQuat::Identity,
    ECC_WorldDynamic,
    Shape,
    CollisionParams
);

for (const FOverlapResult& Overlap : Overlaps)
{
    AActor* OverlapActor = Overlap.GetActor();
    UPrimitiveComponent* OverlapComponent = Overlap.GetComponent();
}
```

### 쿼리 필터링

```cpp
// FCollisionQueryParams - 쿼리 파라미터
FCollisionQueryParams Params;
Params.AddIgnoredActor(this);                      // 특정 액터 무시
Params.AddIgnoredComponent(MyComponent);           // 특정 컴포넌트 무시
Params.bTraceComplex = true;                       // Complex Collision 사용
Params.bReturnPhysicalMaterial = true;             // 물리 재질 반환
Params.bReturnFaceIndex = true;                    // 삼각형 인덱스 반환

// FCollisionResponseParams - 응답 파라미터
FCollisionResponseParams ResponseParams;
ResponseParams.CollisionResponse = ECR_Block;      // 차단만 검사

// FCollisionObjectQueryParams - 오브젝트 타입 필터
FCollisionObjectQueryParams ObjectParams;
ObjectParams.AddObjectTypesToQuery(ECC_WorldStatic);
ObjectParams.AddObjectTypesToQuery(ECC_WorldDynamic);
```

---

## 📊 Collision Channel & Response

### ⭐ ByChannel vs ByObjectType - 핵심 차이

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    ByChannel vs ByObjectType 비교                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │         ByChannel               │  │         ByObjectType                 │  │
│  ├─────────────────────────────────┤  ├─────────────────────────────────────┤  │
│  │                                 │  │                                      │  │
│  │  "이 채널에 대해                │  │  "이 타입의 오브젝트를               │  │
│  │   어떻게 반응하는가?"           │  │   직접 찾아라"                       │  │
│  │                                 │  │                                      │  │
│  │  Response Matrix 사용 ✓        │  │  Response Matrix 무시 ✓             │  │
│  │                                 │  │                                      │  │
│  │  쿼리 채널 기준으로             │  │  오브젝트 타입 기준으로              │  │
│  │  Block/Overlap 필터링           │  │  직접 필터링                         │  │
│  │                                 │  │                                      │  │
│  └─────────────────────────────────┘  └─────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### ByChannel 상세 설명

```cpp
// ByChannel: Response Matrix를 사용하여 필터링
// "ECC_Visibility 채널로 쿼리할 때, 이 오브젝트가 어떻게 반응하는가?"

// 예: 총알 Raycast
World->LineTraceSingleByChannel(
    Hit,
    Start, End,
    ECC_GameTraceChannel1,  // "Weapon" 채널 (커스텀 정의)
    Params
);

// 내부 동작:
// 1. BroadPhase에서 광선과 겹치는 모든 오브젝트 찾음
// 2. 각 오브젝트의 Response Matrix 확인:
//    "이 오브젝트가 ECC_GameTraceChannel1에 대해 Block인가?"
// 3. Block인 오브젝트만 NarrowPhase로 진행
// 4. Ignore/Overlap인 오브젝트는 스킵
```

```
Response Matrix 예시:
                        Query Channel (Trace)
                   ┌────────┬────────┬────────────┐
                   │Visibility│Camera│WeaponTrace│
     ┌─────────────┼────────┼────────┼────────────┤
     │WorldStatic  │ Block  │ Block │   Block    │  ← 벽: 모두 막음
     │Pawn         │ Ignore │ Block │   Block    │  ← 캐릭터: 가시성은 통과
     │Projectile   │ Ignore │ Ignore│   Ignore   │  ← 투사체: 웨폰 쿼리 통과
     │Trigger      │ Ignore │ Ignore│   Ignore   │  ← 트리거: 모두 통과
     └─────────────┴────────┴────────┴────────────┘
     Object Type

LineTraceSingleByChannel(ECC_WeaponTrace):
  → WorldStatic: Block → 검사함 ✓
  → Pawn: Block → 검사함 ✓
  → Projectile: Ignore → 스킵!
  → Trigger: Ignore → 스킵!
```

### ByObjectType 상세 설명

```cpp
// ByObjectType: Response Matrix 무시, 직접 오브젝트 타입 지정
// "WorldStatic과 Pawn 타입 오브젝트만 찾아라"

FCollisionObjectQueryParams ObjectParams;
ObjectParams.AddObjectTypesToQuery(ECC_WorldStatic);
ObjectParams.AddObjectTypesToQuery(ECC_Pawn);
// Projectile, Trigger 등은 추가 안 함 → 무시됨

World->LineTraceSingleByObjectType(
    Hit,
    Start, End,
    ObjectParams,
    Params
);

// 내부 동작:
// 1. BroadPhase에서 광선과 겹치는 모든 오브젝트 찾음
// 2. 각 오브젝트의 Object Type 확인:
//    "이 오브젝트가 WorldStatic 또는 Pawn인가?"
// 3. 해당 타입인 오브젝트만 NarrowPhase로 진행
// 4. Response Matrix는 완전히 무시!
```

```
ByObjectType 필터링:

ObjectParams에 추가된 타입: [WorldStatic, Pawn]

LineTraceSingleByObjectType(ObjectParams):
  → WorldStatic 오브젝트: 포함 ✓ (타입 일치)
  → Pawn 오브젝트: 포함 ✓ (타입 일치)
  → Projectile 오브젝트: 제외! (타입 불일치)
  → Vehicle 오브젝트: 제외! (타입 불일치)

  ※ 각 오브젝트의 Response Matrix는 확인하지 않음!
```

### 언제 어떤 것을 쓸까?

| 상황 | 추천 | 이유 |
|------|------|------|
| **총알/레이저 히트 검사** | ByChannel | 오브젝트별 반응 다르게 설정 가능 |
| **카메라 충돌** | ByChannel | 일부 오브젝트는 카메라 통과 허용 |
| **발 아래 지면 검사** | ByObjectType | WorldStatic만 확실히 검사 |
| **적 감지 (AI)** | ByObjectType | Pawn 타입만 직접 검색 |
| **인벤토리 아이템 검색** | ByObjectType | 특정 타입만 찾음 |
| **복잡한 상호작용** | ByChannel | 매트릭스로 세밀한 제어 |

### 코드 비교

```cpp
// 시나리오: 플레이어의 무기 쿼리

// 방법 1: ByChannel - Response Matrix 활용
// 각 오브젝트가 "Weapon" 채널에 어떻게 반응하는지 설정
World->LineTraceSingleByChannel(Hit, Start, End, ECC_GameTraceChannel1);
// → Shield는 Block, Ghost는 Ignore 등 오브젝트별 설정 활용

// 방법 2: ByObjectType - 직접 타입 지정
FCollisionObjectQueryParams ObjectParams;
ObjectParams.AddObjectTypesToQuery(ECC_Pawn);
ObjectParams.AddObjectTypesToQuery(ECC_Destructible);
World->LineTraceSingleByObjectType(Hit, Start, End, ObjectParams);
// → Pawn과 Destructible만 검사, 나머지는 무조건 무시
```

### ⚠️ ObjectQuery의 특수한 동작

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    ObjectQuery 필터링 특수 동작                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  중요한 차이점:                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │  ObjectType이 A인 Preset이 A에 대해 Ignore로 설정되어 있더라도,           │  │
│  │  A ObjectType에 대한 ObjectQuery를 하면 검출됨!                            │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  예시:                                                                          │
│  - Pawn의 Collision Preset이 Pawn에 대해 Ignore로 설정됨                       │
│  - ByChannel 쿼리: Pawn 간 충돌 무시됨 ✓                                       │
│  - ByObjectType(Pawn) 쿼리: Pawn이 검출됨! (Ignore 설정 무시)                  │
│                                                                                  │
│  이유: ObjectQuery는 Response Matrix를 완전히 우회함                            │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Query Filter Data 구조

```cpp
/**
 * Format for QueryData:
 *     word0 (meta data - ECollisionQuery 타입)
 *
 *     For trace queries:
 *     word1 (blocking channels) - Block 응답 비트마스크
 *     word2 (touching channels) - Overlap 응답 비트마스크
 *     word3 (MyChannel (상위 8비트) as ECollisionChannel + Flags (하위 24비트))
 */
struct FCollisionFilterData
{
    uint32 Word0;  // ECollisionQuery (ObjectQuery / TraceQuery)
    uint32 Word1;  // Object Query: 검색할 Object Type 비트마스크
                   // Trace Query: Block 응답 비트마스크
    uint32 Word2;  // Trace Query: Overlap 응답 비트마스크
    uint32 Word3;  // Channel + MaskFilter
};
```

### CalcQueryHitType - 필터링 핵심 로직

```cpp
// CollisionFiltering.cpp
ECollisionQueryHitType FCollisionQueryFilterCallback::CalcQueryHitType(
    const FCollisionFilterData& QueryFilter,
    const FCollisionFilterData& ShapeFilter,
    bool bPreFilter
)
{
    ECollisionQuery QueryType = (ECollisionQuery)QueryFilter.Word0;
    FMaskFilter QuerierMaskFilter;
    const ECollisionChannel QuerierChannel = GetCollisionChannelAndExtraFilter(
        QueryFilter.Word3, QuerierMaskFilter);

    FMaskFilter ShapeMaskFilter;
    const ECollisionChannel ShapeChannel = GetCollisionChannelAndExtraFilter(
        ShapeFilter.Word3, ShapeMaskFilter);

    // MaskFilter 충돌 체크 (커스텀 마스크)
    if ((QuerierMaskFilter & ShapeMaskFilter) != 0)
    {
        return ECollisionQueryHitType::None;  // 무시
    }

    const uint32 ShapeBit = ECC_TO_BITFIELD(ShapeChannel);

    // ★ ObjectQuery인 경우 - Response Matrix 무시!
    if (QueryType == ECollisionQuery::ObjectQuery)
    {
        const int32 MultiTrace = (int32)QuerierChannel;

        // 대상의 ObjectType(ShapeBit)이 쿼리 대상(Word1)에 포함되면 검출
        if (ShapeBit & QueryFilter.Word1)
        {
            if (bPreFilter)
            {
                // Multi 쿼리: Touch로 반환 (모든 오브젝트 수집)
                // Single 쿼리: Block으로 반환 (첫 번째만)
                return MultiTrace ? ECollisionQueryHitType::Touch
                                 : ECollisionQueryHitType::Block;
            }
            else
            {
                // PostFilter: 항상 Block 반환
                // ObjectQuery는 Overlap 개념이 없음
                return ECollisionQueryHitType::Block;
            }
        }
        return ECollisionQueryHitType::None;  // 타입 불일치
    }

    // TraceQuery인 경우 - Response Matrix 사용
    // ... (기존 Channel 기반 필터링 로직)
}
```

### SweepMultiByObjectType 호출 흐름

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    SweepMultiByObjectType Call Flow                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. UWorld::SweepMultiByObjectType()                                            │
│     │                                                                           │
│     ├── CollisionShape.IsNearlyZero()? → LineTraceMultiByObjectType()          │
│     │                                                                           │
│     └── FPhysicsInterface::GeomSweepMulti(...)                                  │
│            │                                                                    │
│            ↓                                                                    │
│  2. FGenericPhysicsInterface::GeomSweepMulti()                                  │
│     │                                                                           │
│     ├── TCastTraits = TSQTraits<FHitSweep, Sweep, Multi>                       │
│     │                                                                           │
│     └── TSceneCastCommon<TCastTraits, TPTCastTraits>(...)                       │
│            │                                                                    │
│            ↓                                                                    │
│  3. TSceneCastCommonImp()                                                       │
│     │                                                                           │
│     └── SQAccelerator.Sweep(QueryGeom, Start, Dir, HitBuffer, ...)             │
│            │                                                                    │
│            ↓                                                                    │
│  4. TAABBTree::QueryImp()                                                       │
│     │                                                                           │
│     ├── PrePreFilterHelper() - ObjectQuery에서는 제한적 동작                    │
│     │                                                                           │
│     └── CalcQueryHitType() - 최종 필터링                                        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```cpp
// UWorld::SweepMultiByObjectType 구현
bool UWorld::SweepMultiByObjectType(
    TArray<struct FHitResult>& OutHits,
    const FVector& Start,
    const FVector& End,
    const FQuat& Rot,
    const FCollisionObjectQueryParams& ObjectQueryParams,
    const FCollisionShape& CollisionShape,
    const FCollisionQueryParams& Params
) const
{
    if (CollisionShape.IsNearlyZero())
    {
        // Zero-extent shape → LineTrace로 대체
        return LineTraceMultiByObjectType(OutHits, Start, End, ObjectQueryParams, Params);
    }
    else
    {
        // GeomSweep 실행
        FPhysicsInterface::GeomSweepMulti(
            this,
            CollisionShape,
            Rot,
            OutHits,
            Start,
            End,
            DefaultCollisionChannel,  // ObjectQuery에서는 채널 무시됨
            Params,
            FCollisionResponseParams::DefaultResponseParam,
            ObjectQueryParams  // ObjectType 비트마스크
        );

        // ObjectQuery는 Block 히트가 아니어도 true 반환
        return (OutHits.Num() > 0);
    }
}
```

### TSQTraits - Scene Query 타입 특성

```cpp
// TSQTraits: Sweep/Ray, Single/Multi/Test 조합에 따른 타입 특성 정의
template<typename THitType, ESweepOrRay SweepOrRay, ESingleMultiOrTest SingleMulti>
struct TSQTraits;

// 사용 예시
using TCastTraits = TSQTraits<FHitSweep, ESweepOrRay::Sweep, ESingleMultiOrTest::Multi>;
// → Sweep Multi 쿼리용 타입 특성

// TPTCastTraits: Physics Thread용 타입 특성 (비동기 쿼리)
using TPTCastTraits = TSQTraits<FPTSweepHit, ESweepOrRay::Sweep, ESingleMultiOrTest::Multi>;
```

### 채널 시스템

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          Collision Channels                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Object Channels (오브젝트 분류용):                                              │
│  ├── ECC_WorldStatic       : 정적 월드 지오메트리 (벽, 바닥)                     │
│  ├── ECC_WorldDynamic      : 동적 월드 오브젝트 (물리 오브젝트)                  │
│  ├── ECC_Pawn              : 폰/캐릭터                                          │
│  ├── ECC_PhysicsBody       : 물리 시뮬레이션 바디                               │
│  ├── ECC_Vehicle           : 차량                                               │
│  └── ECC_Destructible      : 파괴 가능 오브젝트                                 │
│                                                                                  │
│  Trace Channels (쿼리 전용):                                                     │
│  ├── ECC_Visibility        : 가시성 쿼리용 (LOS 체크)                           │
│  └── ECC_Camera            : 카메라 충돌 쿼리용                                  │
│                                                                                  │
│  커스텀 채널 (프로젝트 설정):                                                    │
│  ├── ECC_GameTraceChannel1 ~ 18 : 프로젝트별 Trace 채널                         │
│  └── ECC_EngineTraceChannel1 ~ 6 : 엔진 예약 채널                               │
│                                                                                  │
│  ※ Object Channel: 오브젝트가 "나는 Pawn이다"라고 선언                          │
│  ※ Trace Channel: 쿼리가 "Visibility로 검사한다"라고 선언                       │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 응답 타입

```cpp
enum ECollisionResponse
{
    ECR_Ignore,    // 충돌 무시
    ECR_Overlap,   // 겹침만 감지 (이벤트 발생)
    ECR_Block      // 충돌 차단 (물리적 반응)
};
```

### 응답 매트릭스 예시

```
           │ Static │ Dynamic │ Pawn │ Projectile │
───────────┼────────┼─────────┼──────┼────────────┤
Static     │ Ignore │  Block  │ Block│   Block    │
Dynamic    │ Block  │  Block  │ Block│   Block    │
Pawn       │ Block  │  Block  │Overlap│  Block    │
Projectile │ Block  │  Block  │ Block│   Ignore   │
```

---

## ⚡ 성능 최적화

### 1. Simple vs Complex Collision

```cpp
// Simple Collision (권장)
// - Convex Hull, Box, Sphere, Capsule
// - 빠른 계산

// Complex Collision
// - 실제 메시 삼각형 사용
// - 정확하지만 비용이 높음

// 설정
StaticMeshComponent->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
StaticMeshComponent->SetCollisionResponseToAllChannels(ECR_Block);

// Complex를 Simple로 사용 안 함 (성능 향상)
StaticMesh->bUseComplexAsSimpleCollision = false;
```

### 2. 쿼리 최적화

```cpp
// 나쁜 예: 매 프레임 LineTrace
void Tick(float DeltaTime)
{
    FHitResult Hit;
    World->LineTraceSingleByChannel(Hit, ...);  // 비용!
}

// 좋은 예: 필요할 때만, 또는 타이머 사용
void CheckCollision()
{
    // 0.1초마다 호출
    FHitResult Hit;
    World->LineTraceSingleByChannel(Hit, ...);
}
```

### 3. Async Scene Query

```cpp
// 비동기 쿼리 (Physics Thread에서 실행)
FTraceHandle Handle = World->AsyncLineTraceByChannel(
    EAsyncTraceType::Single,
    Start, End,
    ECC_Visibility,
    Params,
    FTraceDelegate::CreateUObject(this, &AMyActor::OnTraceComplete)
);

// 결과 콜백
void AMyActor::OnTraceComplete(const FTraceHandle& Handle, FTraceDatum& Data)
{
    if (Data.OutHits.Num() > 0)
    {
        FHitResult& Hit = Data.OutHits[0];
        // 처리...
    }
}
```

---

## 🔧 충돌 형상 (Collision Shapes)

### Implicit Objects

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          FImplicitObject Hierarchy                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  FImplicitObject (Base)                                                         │
│       │                                                                         │
│       ├── TBox<T, d>              : 박스                                        │
│       ├── TSphere<T, d>           : 구                                          │
│       ├── TCapsule<T>             : 캡슐                                        │
│       ├── TCylinder<T>            : 실린더                                      │
│       ├── TConvex<T, d>           : 컨벡스 헐                                   │
│       ├── TImplicitObjectScaled   : 스케일된 형상                               │
│       │                                                                         │
│       ├── FTriangleMeshImplicit   : 삼각형 메시                                 │
│       ├── FHeightField            : 하이트필드 (지형)                           │
│       │                                                                         │
│       └── FImplicitObjectUnion    : 복합 형상                                   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 형상별 특성

| 형상 | 성능 | 용도 |
|------|------|------|
| Sphere | ⭐⭐⭐⭐⭐ | 간단한 물체, 파티클 |
| Capsule | ⭐⭐⭐⭐ | 캐릭터, 팔다리 |
| Box | ⭐⭐⭐⭐ | 박스형 물체 |
| Convex | ⭐⭐⭐ | 복잡한 Convex 물체 |
| TriMesh | ⭐⭐ | 정밀한 환경 충돌 |

---

## 💡 Tips & 디버깅

### 충돌 시각화

```cpp
// 콘솔 명령
// show collision         - 충돌 형상 표시
// p.Chaos.DebugDraw.ShowBroadPhase 1  - BroadPhase 표시
// p.Chaos.DebugDraw.ShowContacts 1    - Contact 표시

// C++에서 디버그 드로우
DrawDebugLine(World, Start, End, FColor::Red, false, 1.0f);
DrawDebugSphere(World, Location, Radius, 16, FColor::Green, false, 1.0f);
```

### 일반적인 문제

| 문제 | 원인 | 해결 |
|------|------|------|
| Raycast가 안 맞음 | 채널 설정 오류 | 채널/응답 매트릭스 확인 |
| 성능 저하 | 과도한 Complex Collision | Simple Collision 사용 |
| 물체가 통과됨 | CCD 비활성화 | CCD 활성화 또는 두꺼운 충돌체 |
| 불안정한 충돌 | 너무 작은 형상 | 최소 크기 확보 |

---

## 🔗 관련 문서

- [Overview.md](Overview.md) - 물리 시스템 개요
- [Chaos_Solver_Deep_Dive.md](Chaos_Solver_Deep_Dive.md) - 솔버 상세
- [PhysicsInterface.md](PhysicsInterface.md) - 물리 인터페이스

---

> 이 문서는 Chaos의 충돌 감지 및 Scene Query 시스템을 설명합니다.

## Merged Notes (from Physics/Chaos_Collision_Detection_Deep_Dive.md)

### Chaos Collision Detection Deep Dive
> **작성일**: 2025-12-09
> **엔진 버전**: Unreal Engine 5.7
> **분석 대상**: Chaos Physics - Collision Detection Pipeline, Scene Query, CCD
> 🔄 Updated: 2026-02-18 — 중복 문서 통합 (Collision_And_SceneQuery.md 내용 병합)

---

#### 🧭 개요 (Overview)
Chaos의 충돌 감지 시스템은 **Broad Phase → Mid Phase → Narrow Phase** 3단계 파이프라인으로 구성됩니다. 각 단계는 점진적으로 후보를 좁혀가며 최종적으로 정확한 Contact Point를 생성합니다.

##### 핵심 개념
| 개념 | 설명 |
|------|------|
| **Broad Phase** | AABB 기반 공간 분할로 잠재적 충돌 쌍 필터링 |
| **Mid Phase** | 복합 형상(Mesh, Heightfield)에서 관련 프리미티브 추출 |
| **Narrow Phase** | GJK/EPA/SAT 알고리즘으로 정밀 충돌 검사 |
| **Contact Manifold** | 최대 4개의 접촉점으로 구성된 충돌 결과 |
| **Collision Filtering** | Channel 및 Response 기반 충돌 필터링 |

---

#### 🏗️ Collision Detection Pipeline
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Collision Detection Pipeline                              │
└─────────────────────────────────────────────────────────────────────────────────┘

  All Particles (N)
        │
        ↓
┌───────────────────────────────────────────────────────────────────────────┐
│                       1. BROAD PHASE                                       │
│                          O(N log N)                                        │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │              FSpatialAccelerationBroadPhase                          │  │
│  │                                                                      │  │
│  │    입력: 모든 파티클의 WorldSpaceInflatedBounds (AABB)              │  │
│  │    처리: AABBTree 쿼리 + Collision Filtering                        │  │
│  │    출력: 잠재적 충돌 쌍 (FParticlePair)                             │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ParticlePairBroadPhaseFilter:                                            │
│  ├─ 같은 파티클 제외                                                     │
│  ├─ 비활성화 파티클 제외                                                 │
│  ├─ Static vs Static 제외                                                │
│  ├─ CollisionGroup 필터링                                                │
│  └─ IgnoreCollisionManager 확인                                          │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
        │
        │ Potential Pairs (K << N²)
        ↓
┌───────────────────────────────────────────────────────────────────────────┐
│                       2. MID PHASE                                         │
│                       (복합 형상용)                                        │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │              FParticlePairMidPhase                                   │  │
│  │                                                                      │  │
│  │    타입별 처리:                                                      │  │
│  │    ├─ Generic: BVH 쿼리 (Mesh, Heightfield)                         │  │
│  │    ├─ ShapePair: Shape 쌍 최적화 (적은 Shape 수)                    │  │
│  │    └─ SphereApproximation: 구체 근사 (특수 최적화)                  │  │
│  │                                                                      │  │
│  │    출력: FSingleShapePairCollisionDetector 배열                     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
        │
        │ Shape Pairs
        ↓
┌───────────────────────────────────────────────────────────────────────────┐
│                       3. NARROW PHASE                                      │
│                          O(K)                                              │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │        FSingleShapePairCollisionDetector::GenerateCollision()       │  │
│  │                                                                      │  │
│  │    1. DoBoundsOverlap() - Bounds 중첩 확인                          │  │
│  │    2. 알고리즘 선택:                                                 │  │
│  │       ├─ GJK/EPA: Convex-Convex 충돌                                │  │
│  │       ├─ SAT: Box-Box, Convex-Triangle 특화                         │  │
│  │       └─ Specialized: Sphere-Sphere, Capsule-Capsule 등             │  │
│  │    3. Contact Manifold 생성 (최대 4개 접촉점)                       │  │
│  │                                                                      │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  출력: FPBDCollisionConstraint                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │  - FManifoldPoint[4]: 접촉점 배열                                   │  │
│  │  - Contact Normal, Penetration Depth                                │  │
│  │  - Static Friction Anchor                                           │  │
│  │  - Restitution, Friction 계수                                       │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
```

---

#### 📂 주요 소스 파일
| 파일 | 역할 | 라인 수 |
|------|------|---------|
| `Public/Chaos/AABBTree.h` | AABB 트리 공간 분할 | 4038 |
| `Public/Chaos/ISpatialAcceleration.h` | 공간 가속 인터페이스 | ~300 |
| `Public/Chaos/Collision/BasicBroadPhase.h` | 단순 Broad Phase | ~110 |
| `Public/Chaos/Collision/SpatialAccelerationBroadPhase.h` | 공간 가속 Broad Phase | 1032 |
| `Public/Chaos/GJK.h` | GJK 알고리즘 | 2166 |
| `Public/Chaos/EPA.h` | EPA 알고리즘 | ~150 |
| `Public/Chaos/Collision/SATConvexTriangle.h` | SAT 알고리즘 | ~200 |
| `Public/Chaos/Collision/ContactPoint.h` | Contact Point 구조체 | ~200 |
| `Public/Chaos/Collision/ParticlePairMidPhase.h` | Mid Phase 처리 | ~250 |
| `Public/Chaos/Collision/CollisionFilter.h` | 충돌 필터링 | ~200 |

---

#### 🔷 1. Broad Phase
##### 1.1 FAABBTree - 동적 AABB 트리
**📂 위치:** `Chaos/Public/Chaos/AABBTree.h:1`

AABB(Axis-Aligned Bounding Box) 트리 기반의 공간 가속 구조입니다.

```cpp
template<typename TPayloadType, typename TLeafType, typename T, int d>
class TAABBTree : public ISpatialAcceleration<TPayloadType, T, d>
{
private:
    //──────────────────────────────────────────────────────────────
    // 핵심 데이터 구조
    //──────────────────────────────────────────────────────────────

    // 전역 Payload 배열 (모든 요소)
    TArray<TPayloadType> MGlobalPayloads;

    // Dirty Grid (증분 업데이트용)
    TUniformGrid<T, d> MGrid;
    TArray<TBVCellElement> MElements;
    TArray<TBVCellElement> MDirtyElements;  // 변경된 요소들

    // Payload 정보 (트리 내 위치 추적)
    TArray<TBVPayloadInfo> MPayloadInfo;

    // 트리 노드 배열
    TArray<FAABBTreeNode> Nodes;

    //──────────────────────────────────────────────────────────────
    // 설정
    //──────────────────────────────────────────────────────────────
    int32 MaxChildrenInLeaf;      // 리프 노드 최대 요소 수
    int32 MaxTreeDepth;           // 최대 트리 깊이
    T MaxPayloadBounds;           // 최대 Payload 크기
    bool bDynamicTree;            // 동적 트리 여부

public:
    //──────────────────────────────────────────────────────────────
    // 쿼리 API
    //──────────────────────────────────────────────────────────────

    // 레이캐스트
    template<typename TSQVisitor>
    bool Raycast(const TVec3<T>& StartPoint, const TVec3<T>& Dir,
                 const T Length, TSQVisitor& Visitor) const;

    // 스윕 (이동하는 형상)
    template<typename TSQVisitor>
    bool Sweep(const TVec3<T>& StartPoint, const TVec3<T>& Dir,
               const T Length, const TVec3<T>& HalfExtents,
               TSQVisitor& Visitor) const;

    // 오버랩
    template<typename TSQVisitor>
    bool Overlap(const TAABB<T, d>& QueryBounds, TSQVisitor& Visitor) const;

    //──────────────────────────────────────────────────────────────
    // 업데이트 API
    //──────────────────────────────────────────────────────────────

    // 요소 추가/제거/업데이트
    void UpdateElement(const TPayloadType& Payload, const TAABB<T, d>& NewBounds, bool bHasBounds);
    void RemoveElement(const TPayloadType& Payload);

    // 트리 재구축
    void Reinitialize();

    // 증분 업데이트 (Dirty 요소만)
    void UpdateDirtyElements();
};
```

##### 1.2 Dirty Grid 메커니즘
변경된 요소만 효율적으로 업데이트하는 시스템입니다:

```
┌─────────────────────────────────────────────────────────────┐
│                    Dirty Grid System                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  프레임 N:                                                   │
│  ┌────────────────┐                                         │
│  │ 파티클 이동    │──→ MDirtyElements에 추가                │
│  │ AABB 변경     │                                          │
│  └────────────────┘                                         │
│                                                              │
│  프레임 N+1 (Collision Detection 전):                        │
│  ┌────────────────┐                                         │
│  │ UpdateDirty    │──→ Dirty 요소만 트리에서 재배치         │
│  │ Elements()     │     전체 재구축 O(N log N) 회피         │
│  └────────────────┘                                         │
│                                                              │
│  복잡도: O(D log N) where D = Dirty 요소 수                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

##### 1.3 FSpatialAccelerationBroadPhase
**📂 위치:** `Chaos/Public/Chaos/Collision/SpatialAccelerationBroadPhase.h:1`

AABBTree를 활용하는 고성능 Broad Phase 구현입니다:

```cpp
class FSpatialAccelerationBroadPhase
{
public:
    //──────────────────────────────────────────────────────────────
    // 충돌 감지 메인 API
    //──────────────────────────────────────────────────────────────

    void ProduceOverlaps(
        FReal Dt,
        Private::FCollisionConstraintAllocator* Allocator,
        const FCollisionDetectorSettings& Settings)
    {
        // 1. 각 동적 파티클에 대해 AABBTree 쿼리
        for (FGeometryParticleHandle* Particle : DynamicParticles)
        {
            TAABB<FReal, 3> Bounds = Particle->WorldSpaceInflatedBounds();

            // 2. 오버랩 검사
            SpatialAcceleration->Overlap(Bounds,
                [&](const FGeometryParticleHandle* Other)
                {
                    // 3. Broad Phase 필터링
                    if (ParticlePairBroadPhaseFilter(Particle, Other, ...))
                    {
                        // 4. MidPhase 생성 또는 가져오기
                        FParticlePairMidPhase* MidPhase =
                            GetOrCreateMidPhase(Particle, Other);
                    }
                });
        }
    }

    //──────────────────────────────────────────────────────────────
    // MidPhase 관리
    //──────────────────────────────────────────────────────────────

    FParticlePairMidPhase* GetOrCreateMidPhase(
        FGeometryParticleHandle* Particle0,
        FGeometryParticleHandle* Particle1);

private:
    // 공간 가속 구조
    ISpatialAcceleration<FGeometryParticleHandle*, FReal, 3>* SpatialAcceleration;

    // MidPhase 캐시
    TMap<FParticlePairKey, FParticlePairMidPhase*> MidPhaseMap;
};
```

##### 1.4 Collision Filtering
**📂 위치:** `Chaos/Public/Chaos/Collision/CollisionFilter.h:1`

```cpp
// Broad Phase 필터링 함수
bool ParticlePairBroadPhaseFilter(
    const FGeometryParticleHandle* Particle1,
    const FGeometryParticleHandle* Particle2,
    const FIgnoreCollisionManager* IgnoreCollisionManager)
{
    // 1. 같은 파티클 체크
    if (Particle1 == Particle2)
        return false;

    // 2. 비활성화 파티클 제외
    if (!Particle1->IsDynamic() && !Particle2->IsDynamic())
        return false;

    // 3. 두 Static/Kinematic 파티클 제외
    if (Particle1->ObjectState() == EObjectStateType::Static &&
        Particle2->ObjectState() == EObjectStateType::Static)
        return false;

    // 4. CollisionGroup 필터링
    if (!ShouldCollideWithCollisionGroup(Particle1, Particle2))
        return false;

    // 5. IgnoreCollisionManager 확인
    if (IgnoreCollisionManager &&
        IgnoreCollisionManager->IgnoresCollision(Particle1, Particle2))
        return false;

    return true;
}

// Shape별 필터링
bool DoCollide(
    EImplicitObjectType Implicit0Type,
    const FPerShapeData* Shape0,
    EImplicitObjectType Implicit1Type,
    const FPerShapeData* Shape1)
{
    // Simple/Complex 충돌 활성화 확인
    if (!FilterHasSimEnabled(Shape0) || !FilterHasSimEnabled(Shape1))
        return false;

    // 형상 타입 호환성 확인
    return AreShapeTypesCompatible(Implicit0Type, Implicit1Type);
}
```

---

#### 🔷 2. Mid Phase
##### 2.1 FParticlePairMidPhase
**📂 위치:** `Chaos/Public/Chaos/Collision/ParticlePairMidPhase.h:1`

파티클 쌍의 개별 Shape 쌍을 관리합니다:

```cpp
class FParticlePairMidPhase
{
public:
    //──────────────────────────────────────────────────────────────
    // MidPhase 타입
    //──────────────────────────────────────────────────────────────
    enum EParticlePairMidPhaseType : int8
    {
        Generic,            // 일반 (BVH, Mesh 등)
        ShapePair,          // Shape 쌍 최적화
        SphereApproximation // 구체 근사
    };

    //──────────────────────────────────────────────────────────────
    // 타입 결정
    //──────────────────────────────────────────────────────────────
    static EParticlePairMidPhaseType CalculateMidPhaseType(
        FGeometryParticleHandle* InParticle0,
        FGeometryParticleHandle* InParticle1)
    {
        int32 NumShapes0 = GetNumLeafShapes(InParticle0);
        int32 NumShapes1 = GetNumLeafShapes(InParticle1);

        // 적은 Shape 수: ShapePair 최적화
        if (NumShapes0 * NumShapes1 <= MaxShapePairCount)
            return ShapePair;

        // 하나가 Sphere인 경우: SphereApproximation
        if (IsSphereApproximatable(InParticle0) ||
            IsSphereApproximatable(InParticle1))
            return SphereApproximation;

        return Generic;
    }

    //──────────────────────────────────────────────────────────────
    // 충돌 생성
    //──────────────────────────────────────────────────────────────
    virtual void GenerateCollisions(
        const FReal CullDistance,
        const FReal Dt,
        FCollisionContext& Context) = 0;

protected:
    FGeometryParticleHandle* Particles[2];
    EParticlePairMidPhaseType MidPhaseType;
};
```

##### 2.2 FSingleShapePairCollisionDetector
**📂 위치:** `Chaos/Public/Chaos/Collision/ParticlePairMidPhase.h:100`

두 Shape 간 충돌 감지 및 제약 조건 생성:

```cpp
class FSingleShapePairCollisionDetector
{
public:
    //──────────────────────────────────────────────────────────────
    // 충돌 생성
    //──────────────────────────────────────────────────────────────
    int32 GenerateCollision(
        const FRealSingle Dt,
        const FRealSingle CullDistance,
        const FVec3f& RelativeMovement,
        const FCollisionContext& Context)
    {
        // 1. Bounds 중첩 확인
        if (!DoBoundsOverlap(CullDistance, RelativeMovement, CurrentEpoch))
            return 0;

        // 2. Narrow Phase 호출
        return GenerateCollisionImpl(Dt, CullDistance, Context);
    }

    //──────────────────────────────────────────────────────────────
    // 연속 충돌 감지 (CCD)
    //──────────────────────────────────────────────────────────────
    int32 GenerateCollisionCCD(
        const FRealSingle Dt,
        const FRealSingle CullDistance,
        const FVec3f& RelativeMovement,
        const bool bEnableCCDSweep,
        const FCollisionContext& Context);

    //──────────────────────────────────────────────────────────────
    // Bounds 중첩 확인
    //──────────────────────────────────────────────────────────────
    bool DoBoundsOverlap(
        const FRealSingle CullDistance,
        const FVec3f& RelativeMovement,
        const int32 CurrentEpoch)
    {
        // World Space Bounds 계산
        FAABB3f Bounds0 = GetWorldBounds(Shape0);
        FAABB3f Bounds1 = GetWorldBounds(Shape1);

        // CullDistance만큼 확장
        Bounds0.Thicken(CullDistance);
        Bounds1.Thicken(CullDistance);

        return Bounds0.Intersects(Bounds1);
    }

private:
    const FImplicitObject* Implicit0;
    const FImplicitObject* Implicit1;
    const FPerShapeData* Shape0;
    const FPerShapeData* Shape1;
    FPBDCollisionConstraint* Constraint;
};
```

---

#### 🔷 3. Narrow Phase
##### 3.1 GJK (Gilbert-Johnson-Keerthi) 알고리즘
**📂 위치:** `Chaos/Public/Chaos/GJK.h:1`

두 Convex 도형 간 최소 거리/관통 깊이를 계산합니다:

```cpp
//──────────────────────────────────────────────────────────────────────────
// GJK 메인 함수
//──────────────────────────────────────────────────────────────────────────
template<typename GeometryTypeA, typename GeometryTypeB>
bool GJKPenetration(
    const GeometryTypeA& A,                    // 첫 번째 도형
    const GeometryTypeB& B,                    // 두 번째 도형
    const FRigidTransform3& BToATM,            // B→A 변환
    FReal& OutPenetration,                     // 출력: 관통 깊이
    FVec3& OutClosestA,                        // 출력: A의 최근접점
    FVec3& OutClosestBInA,                     // 출력: B의 최근접점 (A 공간)
    FVec3& OutNormal,                          // 출력: 충돌 법선
    int32& OutClosestVertexIndexA,             // 출력: A의 최근접 정점
    int32& OutClosestVertexIndexB,             // 출력: B의 최근접 정점
    FReal& OutDistance,                        // 출력: 거리 (음수=관통)
    const FVec3& InitialDir = {1, 0, 0},       // 초기 탐색 방향
    const FReal Epsilon = 1e-3                 // 수렴 허용치
);

//──────────────────────────────────────────────────────────────────────────
// Support Function
//──────────────────────────────────────────────────────────────────────────
// GJK의 핵심: 주어진 방향에서 도형의 가장 먼 점 반환
template<typename T>
FVec3 Support(const T& Geometry, const FVec3& Direction)
{
    return Geometry.Support(Direction, Geometry.GetMargin());
}

// Minkowski Difference의 Support
FVec3 MinkowskiSupport(const FVec3& Dir)
{
    return SupportA(Dir) - SupportB(-Dir);
}

//──────────────────────────────────────────────────────────────────────────
// Simplex 구조
//──────────────────────────────────────────────────────────────────────────
template<typename T>
class TSimplex
{
    TVec3<T> Vertices[4];    // 최대 4개 정점 (3D 테트라헤드론)
    int32 NumVertices;       // 현재 정점 수

    // 원점을 포함하는지 확인하고 Simplex 축소
    bool DoSimplex(TVec3<T>& Direction);
};
```

##### GJK 알고리즘 시각화
```
┌─────────────────────────────────────────────────────────────────────────┐
│                         GJK Algorithm                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  목표: 두 Convex 도형의 Minkowski Difference가 원점을 포함하는지 확인   │
│                                                                          │
│  Minkowski Difference: A ⊖ B = {a - b | a ∈ A, b ∈ B}                  │
│  원점 포함 = 두 도형이 충돌                                             │
│                                                                          │
│  반복 과정:                                                              │
│                                                                          │
│  Iteration 1:      Iteration 2:      Iteration 3:                       │
│       ●               ●───●             ●───●                           │
│       │               │   │            /│   │                           │
│       │               │   │           / │   │                           │
│       ↓               │   │          ●──┼───●                           │
│    Direction        원점으로        원점을                               │
│     탐색           Simplex 확장    포함하면 충돌                         │
│                                                                          │
│  수렴 조건:                                                              │
│  - 원점이 Simplex 내부 → 충돌                                           │
│  - 새 Support Point가 진전 없음 → 비충돌                                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 3.2 EPA (Expanding Polytope Algorithm)
**📂 위치:** `Chaos/Public/Chaos/EPA.h:1`

GJK 결과로부터 정확한 관통 깊이와 접촉점을 계산합니다:

```cpp
//──────────────────────────────────────────────────────────────────────────
// EPA Entry (다면체의 면)
//──────────────────────────────────────────────────────────────────────────
template<typename T>
struct TEPAEntry
{
    int32 IdxBuffer[3];           // 삼각형 정점 인덱스
    TVec3<T> PlaneNormal;         // 평면 법선
    T Distance;                   // 원점으로부터의 거리
    TVector<int32, 3> AdjFaces;   // 인접 삼각형
    TVector<int32, 3> AdjEdges;   // 인접 모서리
    bool bObsolete;               // 폐기 표시
};

//──────────────────────────────────────────────────────────────────────────
// EPA 메인 함수
//──────────────────────────────────────────────────────────────────────────
template<typename T>
bool EPA(
    const TSimplex<T>& InitialSimplex,         // GJK에서 받은 Simplex
    const TArray<TVec3<T>>& InitialVertices,   // 초기 정점들
    SupportFunc SupportA,                       // A의 Support 함수
    SupportFunc SupportB,                       // B의 Support 함수
    TVec3<T>& OutNormal,                       // 출력: 충돌 법선
    T& OutPenetration,                         // 출력: 관통 깊이
    TVec3<T>& OutClosestA,                     // 출력: A의 최근접점
    TVec3<T>& OutClosestB                      // 출력: B의 최근접점
);

// 스택 할당 최적화 (작은 convex 형태)
template<typename T>
using TEPAWorkingArray = TArray<T, TInlineAllocator<32>>;
```

##### EPA 알고리즘 시각화
```
┌─────────────────────────────────────────────────────────────────────────┐
│                         EPA Algorithm                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  입력: GJK Simplex (원점을 포함하는 테트라헤드론)                       │
│  목표: 원점에서 Minkowski Difference 경계까지의 최소 거리 찾기         │
│        = 관통 깊이                                                       │
│                                                                          │
│  반복 과정:                                                              │
│                                                                          │
│  Step 1: 초기 다면체    Step 2: 확장           Step 3: 수렴             │
│                                                                          │
│       /\                    /\                     /\                    │
│      /  \                  /  \                   /  \                   │
│     /    \    ──→         / ●  \     ──→        /  ●  \                  │
│    /  ●   \              /  │   \              /   │   \                 │
│   /   │    \            /   │    \            /    │    \                │
│  ────────────          ─────┴─────           ─────┴─────                 │
│                        새 정점 추가         원점에서 가장                │
│                                             가까운 면 = 관통 깊이       │
│                                                                          │
│  관통 깊이 = 원점에서 가장 가까운 면까지의 거리                         │
│  충돌 법선 = 해당 면의 법선                                             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 3.3 SAT (Separating Axis Theorem)
**📂 위치:** `Chaos/Public/Chaos/Collision/SATConvexTriangle.h:1`

Box-Box, Convex-Triangle 충돌에 특화된 알고리즘:

```cpp
//──────────────────────────────────────────────────────────────────────────
// SAT Convex-Triangle
//──────────────────────────────────────────────────────────────────────────
template<typename ConvexType>
bool SATConvexTriangle(
    const ConvexType& Convex,
    const FTriangle& Triangle,
    const FVec3& TriangleNormal,
    const FReal CullDistanceSq,
    Private::FConvexContactPoint& OutContactPoint)
{
    // 1. Triangle Face vs Convex Vertices
    //    Convex를 Triangle 법선에 투영
    FReal MinDot = FLT_MAX;
    for (int32 i = 0; i < Convex.NumVertices(); ++i)
    {
        FReal Dot = FVec3::DotProduct(Convex.GetVertex(i), TriangleNormal);
        MinDot = FMath::Min(MinDot, Dot);
    }

    // 분리축 발견 시 비충돌
    if (MinDot > TrianglePlaneD + CullDistance)
        return false;

    // 2. Convex Faces vs Triangle Vertices
    for (int32 FaceIdx = 0; FaceIdx < Convex.NumPlanes(); ++FaceIdx)
    {
        FVec3 FaceNormal = Convex.GetPlaneNormal(FaceIdx);
        // Triangle 정점들을 Convex 면에 투영...
        if (AllVerticesOutside)
            return false;  // 분리축 발견
    }

    // 3. Edge-Edge 테스트
    for (int32 ConvexEdge = 0; ConvexEdge < Convex.NumEdges(); ++ConvexEdge)
    {
        for (int32 TriEdge = 0; TriEdge < 3; ++TriEdge)
        {
            FVec3 Axis = FVec3::CrossProduct(ConvexEdgeDir, TriEdgeDir);
            // 양쪽 도형을 Axis에 투영하여 분리 확인...
        }
    }

    // 분리축 없음 = 충돌
    return true;
}
```

##### SAT 알고리즘 시각화
```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Separating Axis Theorem                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  원리: 두 Convex 도형이 충돌하지 않으면 분리축이 존재                   │
│        분리축 = 두 도형의 투영이 겹치지 않는 축                         │
│                                                                          │
│  테스트할 축들:                                                          │
│  1. A의 모든 면 법선                                                     │
│  2. B의 모든 면 법선                                                     │
│  3. A와 B의 모든 엣지 쌍의 외적                                         │
│                                                                          │
│  시각화:                                                                 │
│                                                                          │
│       [A]        [B]              분리축                                 │
│      ┌───┐    ┌───┐                 │                                   │
│      │   │    │   │         A 투영: ├──────┤                            │
│      └───┘    └───┘         B 투영:       ├──────┤                      │
│                                    ↑                                     │
│                              겹치지 않음 = 비충돌                        │
│                                                                          │
│       [A]  [B]                      │                                    │
│      ┌───┬───┐              A 투영: ├──────┤                            │
│      │   │   │              B 투영:    ├──────┤                         │
│      └───┴───┘                     ↑                                     │
│                              겹침 = 모든 축에서 겹치면 충돌             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

#### 🔷 4. Contact Point & Manifold
##### 4.1 FContactPoint
**📂 위치:** `Chaos/Public/Chaos/Collision/ContactPoint.h:1`

```cpp
template<typename T>
class TContactPoint
{
public:
    //──────────────────────────────────────────────────────────────
    // 핵심 데이터
    //──────────────────────────────────────────────────────────────

    // Shape 공간의 접촉점 (두 도형)
    TVec3<T> ShapeContactPoints[2];

    // Shape 2의 법선 (Shape 1 방향)
    TVec3<T> ShapeContactNormal;

    // 접촉 분리 (음수 = 관통)
    T Phi;

    // 면 인덱스 (Mesh/Heightfield만)
    int32 FaceIndex;

    // 접촉 타입
    EContactPointType ContactType;
};

//──────────────────────────────────────────────────────────────────────────
// 접촉 타입 분류
//──────────────────────────────────────────────────────────────────────────
enum class EContactPointType : int8
{
    Unknown,
    VertexPlane,    // 정점-평면 (가장 안정적)
    EdgeEdge,       // 모서리-모서리
    PlaneVertex,    // 평면-정점
    VertexVertex    // 정점-정점 (최소 안정)
};
```

##### 4.2 FManifoldPoint
**📂 위치:** `Chaos/Public/Chaos/Collision/ContactPoint.h:50`

솔버에서 사용하는 제약 조건용 접촉점:

```cpp
class FManifoldPoint
{
public:
    // 저수준 충돌 감지 결과
    FContactPointf ContactPoint;

    // 플래그
    union FFlags
    {
        struct {
            uint8 bDisabled : 1;               // 비활성화됨
            uint8 bWasRestored : 1;            // 이전 프레임에서 복원됨
            uint8 bHasStaticFrictionAnchor : 1; // 정적 마찰 앵커 있음
            uint8 bInitialContact : 1;          // 첫 접촉
        };
        uint8 Bits;
    } Flags;

    // 정적 마찰 앵커점 (미끄러지지 않을 때 고정점)
    FVec3f ShapeAnchorPoints[2];

    // 초기 접촉점 (캐싱용)
    FVec3f InitialShapeContactPoints[2];

    // 충격량 (Solver 결과)
    FVec3f NetPushOut;           // 위치 보정
    FVec3f NetImpulse;           // 속도 보정
};
```

##### 4.3 One-Shot Manifold
**📂 위치:** `Private/Chaos/CollisionOneShotManifolds.h:1`

한 프레임에 모든 접촉점을 계산하는 방식:

```cpp
namespace Chaos::Collisions
{
    //──────────────────────────────────────────────────────────────
    // Box-Box Manifold
    //──────────────────────────────────────────────────────────────
    void ConstructBoxBoxOneShotManifold(
        const FImplicitBox3& Box1,
        const FRigidTransform3& Box1Transform,
        const FImplicitBox3& Box2,
        const FRigidTransform3& Box2Transform,
        const FReal Dt,
        FPBDCollisionConstraint& Constraint)
    {
        // 1. SAT로 관통 축 찾기
        // 2. 교차 영역 계산
        // 3. 최대 4개 접촉점 생성
        // 4. Constraint에 접촉점 추가
    }

    //──────────────────────────────────────────────────────────────
    // Convex-Convex Manifold
    //──────────────────────────────────────────────────────────────
    template<typename ConvexType1, typename ConvexType2>
    void ConstructConvexConvexOneShotManifold(
        const ConvexType1& Implicit1,
        const FRigidTransform3& Convex1Transform,
        const ConvexType2& Implicit2,
        const FRigidTransform3& Convex2Transform,
        const FReal Dt,
        FPBDCollisionConstraint& Constraint)
    {
        // 1. GJK/EPA로 최근접점/관통깊이 계산
        // 2. Contact Plane 결정
        // 3. 면의 교차 영역에서 접촉점 샘플링
        // 4. 최대 4개 접촉점으로 축소
    }
}
```

##### Manifold 시각화
```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Contact Manifold (최대 4점)                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  왜 최대 4개?                                                            │
│  - 3D에서 평면을 안정적으로 정의하는 최소 점 = 3                        │
│  - 회전 안정성을 위해 4점 권장                                          │
│  - 더 많은 점은 과잉 (성능 저하)                                        │
│                                                                          │
│  Box-Box 예시:                                                           │
│                                                                          │
│  ┌─────────────────┐                                                    │
│  │  ●           ●  │  ← 상단 Box                                        │
│  │  1           2  │                                                    │
│  └─────────────────┘                                                    │
│  ─────────────────────  ← Contact Plane                                 │
│  ┌─────────────────┐                                                    │
│  │  ●           ●  │  ← 하단 Box                                        │
│  │  3           4  │                                                    │
│  └─────────────────┘                                                    │
│                                                                          │
│  Contact Points:                                                         │
│  1. (x1, y1, z1), Normal: (0, 0, 1), Phi: -0.01                         │
│  2. (x2, y2, z2), Normal: (0, 0, 1), Phi: -0.01                         │
│  3. (x3, y3, z3), Normal: (0, 0, 1), Phi: -0.01                         │
│  4. (x4, y4, z4), Normal: (0, 0, 1), Phi: -0.01                         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

#### 🔷 5. FPBDCollisionConstraint
**📂 위치:** `Chaos/Public/Chaos/Collision/PBDCollisionConstraint.h:1`

충돌 제약 조건의 최종 형태:

```cpp
class FPBDCollisionConstraint
{
public:
    //──────────────────────────────────────────────────────────────
    // 파티클 참조
    //──────────────────────────────────────────────────────────────
    FGeometryParticleHandle* Particle[2];

    //──────────────────────────────────────────────────────────────
    // 접촉점 배열 (최대 4개)
    //──────────────────────────────────────────────────────────────
    TArray<FManifoldPoint, TInlineAllocator<4>> ManifoldPoints;

    //──────────────────────────────────────────────────────────────
    // 재료 속성
    //──────────────────────────────────────────────────────────────
    FPBDCollisionConstraintMaterial Material;
    // - Restitution (반발 계수)
    // - StaticFriction (정적 마찰)
    // - DynamicFriction (동적 마찰)

    //──────────────────────────────────────────────────────────────
    // 제약 조건 상태
    //──────────────────────────────────────────────────────────────
    bool bIsEnabled;              // 활성화 여부
    bool bIsProbe;                // Probe (충돌 감지만, 응답 없음)
    int32 ContainerId;            // 소유 컨테이너 ID

    //──────────────────────────────────────────────────────────────
    // 캐싱 데이터
    //──────────────────────────────────────────────────────────────
    FRigidTransform3 ImplicitTransform[2];  // 이전 프레임 Transform
    int32 Epoch;                            // 유효성 검사용
};
```

---

#### ⚡ 성능 최적화
##### Broad Phase 최적화
```cpp
// ✅ 좋은 예: Dirty Grid 활용
void FAABBTree::UpdateDirtyElements()
{
    // 변경된 요소만 업데이트
    for (auto& Element : MDirtyElements)
    {
        UpdateElementInTree(Element);
    }
    MDirtyElements.Reset();
}
// 복잡도: O(D log N) where D = Dirty 요소 수

// ❌ 나쁜 예: 매 프레임 전체 재구축
void Reinitialize()
{
    // 전체 트리 재구축
    BuildTreeFromScratch();
}
// 복잡도: O(N log N)
```

##### Narrow Phase 최적화
```cpp
// ✅ 좋은 예: SIMD 최적화된 GJK
struct FGeomGJKHelperSIMD
{
    typedef VectorRegister4Float(*SupportFunc)(
        const void* Geom,
        FRealSingle Margin,
        const VectorRegister4Float V);

    const void* Geometry;
    FRealSingle Margin;
    SupportFunc Func;
};

// ❌ 나쁜 예: 스칼라 연산
FVec3 Support(const FVec3& Dir)
{
    FVec3 Best = Vertices[0];
    FReal BestDot = FVec3::DotProduct(Vertices[0], Dir);
    for (int32 i = 1; i < NumVertices; ++i)
    {
        FReal Dot = FVec3::DotProduct(Vertices[i], Dir);
        if (Dot > BestDot) { Best = Vertices[i]; BestDot = Dot; }
    }
    return Best;
}
```

##### 메모리 최적화
```cpp
// ✅ 좋은 예: 인라인 할당자 (스택)
TArray<TEPAEntry<T>, TInlineAllocator<32>> EPAFaces;

// ✅ 좋은 예: 고정 크기 Manifold
TArray<FManifoldPoint, TInlineAllocator<4>> ManifoldPoints;

// ❌ 나쁜 예: 동적 할당
TArray<FManifoldPoint> ManifoldPoints;  // 힙 할당
```

---

#### 💡 디버깅 Tips
##### 시각화 명령어
```bash
### Collision 시각화p.Chaos.Collision.DrawCollisions 1

### Contact Point 시각화p.Chaos.Collision.DrawContactPoints 1

### Broad Phase 시각화p.Chaos.BroadPhase.DrawAABBTree 1

### 필터링 디버그p.Chaos.Collision.LogFilteredCollisions 1
```

##### 일반적인 문제
| 문제 | 원인 | 해결 |
|------|------|------|
| 충돌 누락 | AABB 패딩 부족 | `DynamicTreeBoundingBoxPadding` 증가 |
| 터널링 | CCD 미사용 | CCD 활성화 또는 Substep 증가 |
| 성능 저하 | 과도한 충돌 쌍 | Collision Channel 최적화 |
| 떨림 현상 | 접촉점 불안정 | `PositionIterations` 증가 |

---

---

#### 🔷 6. Scene Query 구조체
##### FHitResult (쿼리 결과 - 단일)
```
┌─────────────────────────────────────────────────────────────────────────┐
│ FHitResult (쿼리 결과 - 단일)                                            │
├─────────────────────────────────────────────────────────────────────────┤
│  - float                Distance;        // 시작점에서 히트까지 거리    │
│  - FVector              ImpactPoint;     // 충돌 위치 (월드)            │
│  - FVector              ImpactNormal;    // 충돌 표면 법선              │
│  - FVector              TraceStart;      // 쿼리 시작점                 │
│  - FVector              TraceEnd;        // 쿼리 끝점                   │
│  - FVector              Location;        // 충돌 시 쿼리 형상 중심      │
│  - FVector              Normal;          // 쿼리 형상 기준 법선         │
│  - TWeakObjectPtr       Actor;           // 충돌한 액터                 │
│  - TWeakObjectPtr       Component;       // 충돌한 컴포넌트             │
│  - FName                BoneName;        // 스켈레탈 본 이름            │
│  - int32                FaceIndex;       // 삼각형 인덱스               │
│  - UPhysicalMaterial*   PhysMaterial;    // 물리 재질                   │
│                                                                          │
│  bBlockingHit : 충돌 차단 여부                                          │
│  bStartPenetrating : 시작 시점에 이미 겹침                              │
└─────────────────────────────────────────────────────────────────────────┘
```

##### FCollisionQueryParams (쿼리 파라미터)
```
┌─────────────────────────────────────────────────────────────────────────┐
│ FCollisionQueryParams (쿼리 파라미터)                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  - FName              TraceTag;           // 디버그용 태그              │
│  - bool               bTraceComplex;      // Complex Collision 사용     │
│  - bool               bReturnFaceIndex;   // 면 인덱스 반환             │
│  - bool               bReturnPhysicalMaterial;  // 물리 재질 반환       │
│  - TArray<AActor*>    IgnoredActors;      // 무시할 액터들              │
│  - TArray<UPrimComp*> IgnoredComponents;  // 무시할 컴포넌트들          │
│                                                                          │
│  AddIgnoredActor(Actor) → 쿼리에서 특정 액터 제외                       │
│  AddIgnoredComponent(Comp) → 쿼리에서 특정 컴포넌트 제외                │
└─────────────────────────────────────────────────────────────────────────┘
```

##### FCollisionFilterData (저수준 필터)
```
┌─────────────────────────────────────────────────────────────────────────┐
│ FCollisionFilterData (저수준 필터)                                       │
├─────────────────────────────────────────────────────────────────────────┤
│  - uint32  Word0;  // Object Type (ECC_*)                               │
│  - uint32  Word1;  // Block 응답 비트마스크                             │
│  - uint32  Word2;  // Overlap 응답 비트마스크                           │
│  - uint32  Word3;  // 커스텀 플래그                                     │
│                                                                          │
│  ※ Physics Engine에 전달되는 실제 필터 데이터                           │
│  ※ Response Matrix가 이 비트마스크로 변환됨                             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

#### 🌲 7. 공간 가속 구조 심층 분석
##### TSpatialAccelerationCollection 아키텍처
```
┌─────────────────────────────────────────────────────────────────────────┐
│  TSpatialAccelerationCollection<TAABBTree, TBoundingVolume, TBVH>       │
│       │                                                                 │
│       ├── 버킷 시스템 (최대 8개 버킷)                                   │
│       │     ├── Bucket 0: 메인 월드 (지형, 건물)                       │
│       │     ├── Bucket 1~7: 스트리밍 레벨들                            │
│       │     └── 각 버킷별로 독립적인 가속 구조                          │
│       │                                                                 │
│       └── InnerIdx (버킷 내 서브구조)                                   │
│             ├── Default (0): 정적 객체용                                │
│             ├── Dynamic (1): 동적 객체용                                │
│             └── Custom (2~7): 프로젝트별 커스텀                         │
└─────────────────────────────────────────────────────────────────────────┘
```

##### PBDRigidsEvolution의 3개 가속 구조
```
┌─────────────────────────────────────────────────────────────────────────┐
│  class FPBDRigidsEvolution {                                             │
│      FAccelerationStructure* InternalAcceleration;       // 내부 물리용 │
│      FAccelerationStructure* AsyncInternalAcceleration;  // 비동기 내부 │
│      FAccelerationStructure* AsyncExternalAcceleration;  // 비동기 외부 │
│  };                                                                      │
│                                                                          │
│   Physics Thread                    Game Thread                         │
│   ┌──────────────────────┐         ┌──────────────────────┐            │
│   │ InternalAcceleration │         │AsyncExternalAcceleration│          │
│   │ - 충돌 감지          │         │ - Raycast 쿼리         │           │
│   │ - 제약 생성          │         │ - Overlap 쿼리         │           │
│   └──────────────────────┘         └──────────────────────┘            │
│              ↕                                ↕                         │
│   ┌──────────────────────────────────────────────────────────┐         │
│   │           AsyncInternalAcceleration (백그라운드)          │         │
│   └──────────────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 가속 구조 타입별 비교
| 특성 | AABB Tree | Bounding Volume | BVH |
|------|-----------|-----------------|-----|
| **구축 시간** | 중간 O(n log n) | 빠름 O(n) | 느림 O(n log n) |
| **메모리 사용** | 낮음 | 높음 | 매우 낮음 |
| **삽입/삭제** | 빠름 O(log n) | 매우 빠름 O(1) | 느림 O(n) |
| **쿼리 성능** | 좋음 O(log n) | 가변적 O(1)~O(n) | 좋음 O(log n) |
| **동적 업데이트** | 우수 | 우수 | 나쁨 |
| **정적 환경** | 좋음 | 보통 | 최고 |

##### Chaos가 AABB Tree를 선택한 이유
```
❌ SAP / MBP 문제점:
  - Sweep 정렬 기반 → 삽입/삭제 시 정렬 비용 O(n)
  - 캐시 미스 발생 확률 높음
  - 병렬화 어려움

✅ AABB Tree 장점:
  - 계층 구조 → O(log n) 삽입/삭제/쿼리
  - 메모리 레이아웃 최적화 → 캐시 효율 향상
  - Time-slicing 지원 → 프레임 드롭 방지
  - 노드 단위 병렬 처리 가능
  - Flat Tree 구조로 GPU 확장 용이
```

---

#### ⚡ 8. CCD (Continuous Collision Detection)
##### Tunneling 문제와 CCD의 필요성
```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Tunneling Problem                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Discrete Collision Detection의 한계:                                   │
│                                                                          │
│  프레임 N           프레임 N+1                                           │
│     ●───────▌────────────●   ← 총알이 벽을 통과!                       │
│   위치1      │          위치2                                           │
│                                                                          │
│  CCD 해결책:                                                            │
│     ●━━━━━━━✕━━━━━━━━━━━━●   ← 이동 경로상 충돌 감지                  │
│   위치1      │충돌!     (예상 위치2)                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

##### Time of Impact (TOI) 개념
```
  TOI = 충돌이 발생하는 시점 [0, 1] 범위

  t=0 (시작)              t=TOI (충돌)           t=1 (끝)
     ●──────────────────────●─ ─ ─ ─ ─ ─ ─ ─ ─ ─(●)
   Start                   Contact              (Predicted End)

  Conservative Advancement:
  1. 현재 거리 계산
  2. 최대 접근 속도 계산
  3. 안전한 시간 스텝 = 거리 / 최대접근속도
  4. TOI 누적, 수렴할 때까지 반복
```

##### Speculative Contact 시스템
```
  개념: "미래의 충돌"을 예측하여 미리 제약 조건 생성

  장점:
  - 실제 TOI 이전에 제약 조건 적용
  - 부드러운 충돌 응답
  - Solver와 자연스럽게 통합
```

##### CCD 성능 비교
| 방식 | 정확도 | 성능 | 사용 사례 |
|------|--------|------|-----------|
| **Discrete** | 낮음 | 최고 | 저속 객체, 두꺼운 충돌체 |
| **Speculative Contact** | 중간 | 높음 | 일반적인 게임 시나리오 |
| **Sub-stepping** | 높음 | 중간 | 정밀 시뮬레이션 |
| **Full TOI** | 최고 | 낮음 | 과학/엔지니어링 시뮬레이션 |

##### CCD 활성화 설정
```cpp
// 컴포넌트별 CCD 설정
UPROPERTY(EditAnywhere, Category = "Physics")
bool bUseCCD = false;

// 런타임에서
UPrimitiveComponent* Mesh = GetMesh();
Mesh->SetUseCCD(true);

// CCD 임계값 조정
p.Chaos.CCD.CCDEnableThresholdBoundsScale = 0.5f;
```

---

#### 📐 9. PBD Collision Solver 상세
##### 위치 보정 공식
```
  기본 공식:
  PushOut = -Stiffness * ContactDelta * ContactMass

  각 파티클에 대한 보정:
  DX = (InvM * PushOut) * ContactNormal    // 위치 변화
  DR = ContactNormalAngular * PushOut       // 회전 변화

  Static 물체: InvM = 0, InvI = 0 → DX = 0, DR = 0 (움직이지 않음)
  Dynamic 물체: InvM > 0, InvI > 0 → 정상 보정 적용
```

##### Friction & Restitution 처리
```cpp
// 마찰 원뿔 제한 (Friction Cone)
void ApplyFrictionCone(FReal StaticFriction, FReal DynamicFriction,
                        FReal NormalForce, FVec3& TangentialForce)
{
    FReal MaxStaticFriction = StaticFriction * NormalForce;
    FReal TangentialMagnitude = TangentialForce.Size();

    if (TangentialMagnitude > MaxStaticFriction)
    {
        // 동적 마찰로 전환 (미끄러짐 시작)
        FReal DynamicLimit = DynamicFriction * NormalForce;
        TangentialForce = TangentialForce.GetSafeNormal() * DynamicLimit;
    }
}

// 반발 계수 (Restitution) 적용
void ApplyRestitution(FReal Restitution, FReal ContactVelocity,
                       FReal RestitutionThreshold, FReal& TargetVelocity)
{
    if (Restitution > 0.0f && ContactVelocity < -RestitutionThreshold)
    {
        TargetVelocity = -Restitution * ContactVelocity;
    }
    else
    {
        TargetVelocity = 0.0f;  // 비탄성 충돌
    }
}
```

##### NarrowPhase 성능 특성
| 알고리즘 | 시간 복잡도 | 반복 제한 | 특징 |
|----------|-------------|-----------|------|
| **GJK** | 평균 O(1)* | 최대 32회 | *Warm Start 시 1-3회, Cold Start 시 10-20회 |
| **EPA** | O(n) | 최대 128회 | n = 생성된 면의 수 |
| **SAT** | O(n*m) | 특성 수에 비례 | Early-out으로 실제론 빠름 |

##### NarrowPhase 최적화 효과
| 최적화 기법 | 성능 향상 | 적용 대상 |
|-------------|-----------|-----------|
| **SIMD 벡터화** | 2-4배 | GJK Support, 거리 계산 |
| **Warm Starting** | 3-10배 | GJK 반복 횟수 감소 |
| **메모리 풀링** | 1.5-2배 | EPA 면 할당/해제 |
| **Early-out** | 2-5배 | SAT 분리축 조기 발견 |

---

#### 🔗 관련 문서
- [Chaos_Complete_Architecture.md](Chaos_Complete_Architecture.md) - Chaos 전체 구조
- [Chaos_Solver_Deep_Dive.md](Chaos_Solver_Deep_Dive.md) - Solver 상세
- [Chaos_Scene_Query_Deep_Dive.md](Chaos_Scene_Query_Deep_Dive.md) - Scene Query 상세 (별도 문서)

---

#### 📝 버전 이력
- **v1.0** (2025-12-09): 초기 작성
  - Broad Phase (AABBTree, SpatialAccelerationBroadPhase)
  - Mid Phase (ParticlePairMidPhase)
  - Narrow Phase (GJK, EPA, SAT)
  - Contact Point & Manifold
  - 성능 최적화 가이드
- **v1.1** (2026-02-18): 중복 문서 통합
  - Collision_And_SceneQuery.md 내용 병합
  - Scene Query 구조체, 공간 가속 구조 심층 분석 추가
  - CCD (Continuous Collision Detection) 섹션 추가
  - PBD Collision Solver 상세 추가
  - NarrowPhase 성능 특성 및 최적화 효과 추가
