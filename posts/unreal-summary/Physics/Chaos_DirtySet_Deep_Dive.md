---
title: "Chaos DirtySet 심층 분석"
date: "2025-12-10"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Physics"
tags: ["unreal", "Physics"]
engine_version: "** Unreal Engine 5.7"
---
# Chaos DirtySet 심층 분석

## 🧭 개요

**FDirtySet**은 Chaos Physics에서 Game Thread와 Physics Thread 간의 효율적인 데이터 동기화를 위해 "변경된 프록시"만을 추적하는 핵심 시스템입니다. 이를 통해 불필요한 데이터 전송을 방지하고 성능을 최적화합니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **DirtySet** | 변경된 프록시를 추적하는 컨테이너 |
| **DirtyIdx** | 프록시가 DirtySet에서의 위치 (중복 방지용) |
| **버킷 시스템** | 프록시 타입별로 분리하여 관리 |
| **2단계 처리** | PT에서 Body 먼저 → Constraint 나중 |

---

## 🏗️ 전체 데이터 흐름

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        DirtySet 데이터 흐름                                      │
└─────────────────────────────────────────────────────────────────────────────────┘

  Game Thread (외부)                              Physics Thread (내부)
  ═══════════════════                             ════════════════════════

  1. 프로퍼티 변경
     │
     ▼
  TChaosProperty::Write()
     │
     └──► MarkDirty()
            │
            ▼
     PhysicsSolverBase->AddDirtyProxy(Proxy)
            │
            ▼
     MarshallingManager.AddDirtyProxy()
            │
            ▼
  ┌─────────────────────────┐
  │ ProducerData->          │
  │   DirtyProxiesDataBuffer│ ◄─── FDirtySet
  │     .Add(Proxy)         │
  └─────────────────────────┘
            │
            ▼
  2. PushPhysicsState()
     │
     ├──► DirtyProxiesData->ParallelForEachProxy()
     │         │
     │         ├── SingleParticleProxy: SyncRemoteData()
     │         ├── GeometryCollection: PushStateOnGameThread()
     │         ├── ClusterUnion: SyncRemoteData()
     │         └── Constraints: PushStateOnGameThread()
     │
     └──► MarshallingManager.Step_External()
               │
               ▼
         ExternalQueue에 PushData 적재 ─────────────────────►
                                                              │
                                                              ▼
                                             3. ProcessSinglePushedData_Internal()
                                                  │
                                                  ▼
                                             DirtyProxiesData->ForEachProxy()
                                                  │
                                                  ├── 새 프록시: Handle 생성, 등록
                                                  └── 기존 프록시: PushToPhysicsState()
                                                  │
                                                  ▼
                                             Physics 시뮬레이션 실행
```

---

## 📂 주요 소스 파일

| 파일 | 역할 |
|------|------|
| `Chaos/Public/Chaos/ChaosMarshallingManager.h:61-281` | FDirtySet 클래스 정의 |
| `Chaos/Public/Chaos/Properties.h:70-84` | TChaosProperty (프로퍼티 변경 감지) |
| `Chaos/Private/PBDRigidsSolver.cpp:1485-1618` | PushPhysicsState() |
| `Chaos/Private/PBDRigidsSolver.cpp:1620-1846` | ProcessSinglePushedData_Internal() |

---

## 🔷 FDirtySet 클래스 구조

**📂 위치:** `Engine/Source/Runtime/Experimental/Chaos/Public/Chaos/ChaosMarshallingManager.h:61-281`

```cpp
class FDirtySet
{
public:
    // 프록시 추가 (중복 방지)
    void Add(IPhysicsProxyBase* Base)
    {
        if(Base->GetDirtyIdx() == INDEX_NONE)  // 아직 DirtySet에 없으면
        {
            FDirtyProxiesBucket& Bucket = DirtyProxyBuckets[(uint32)Base->GetType()];
            const int32 Idx = Bucket.ProxiesData.Num();
            Base->SetDirtyIdx(Idx);            // 프록시에 인덱스 저장
            Bucket.ProxiesData.Add(Base);      // 버킷에 추가
            ++DirtyProxyBucketInfo.TotalNum;
        }
    }

    // 프록시 제거
    void Remove(IPhysicsProxyBase* Base);

    // Shape 추가
    void AddShape(IPhysicsProxyBase* Proxy, int32 ShapeIdx);

    // 순회 함수들
    template <typename Lambda>
    void ParallelForEachProxy(const Lambda& Func);  // 병렬 순회

    template <typename Lambda>
    void ForEachProxy(const Lambda& Func);          // 순차 순회

private:
    // 프록시 타입별 버킷 (SingleParticle, GeometryCollection, Joint 등)
    FDirtyProxiesBucket DirtyProxyBuckets[(uint32)EPhysicsProxyType::Count];

    // 버킷 정보 (개수 캐시)
    FDirtyProxiesBucketInfo DirtyProxyBucketInfo;

    // Shape 데이터
    TArray<FShapeDirtyData> ShapesData;
};
```

### 버킷 구조

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        FDirtySet 버킷 구조                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  DirtyProxyBuckets[EPhysicsProxyType::Count]                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ [0] SingleParticleProxy    → TArray<FDirtyProxy> { P1, P2, P3... }     │   │
│  │ [1] GeometryCollectionType → TArray<FDirtyProxy> { GC1, GC2... }       │   │
│  │ [2] ClusterUnionProxy      → TArray<FDirtyProxy> { CU1... }            │   │
│  │ [3] JointConstraintType    → TArray<FDirtyProxy> { J1, J2... }         │   │
│  │ [4] SuspensionConstraint   → TArray<FDirtyProxy> { S1... }             │   │
│  │ [5] CharacterGround...     → TArray<FDirtyProxy> { CG1... }            │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  DirtyProxyBucketInfo                                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ Num[0] = 3, Num[1] = 2, Num[2] = 1, ...                                │   │
│  │ TotalNum = 3 + 2 + 1 + ... = 전체 Dirty 프록시 수                       │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔶 DirtySet이 채워지는 3가지 경로

### 경로 1: 프로퍼티 변경 시 (가장 일반적)

**📂 위치:** `Engine/Source/Runtime/Experimental/Chaos/Public/Chaos/Properties.h:70-84`

```cpp
// TChaosProperty 클래스 내부
template <typename T, EChaosProperty PropName>
class TChaosProperty
{
public:
    void Write(const T& Val, bool bInvalidate, FDirtyChaosPropertyFlags& Dirty, IPhysicsProxyBase* Proxy)
    {
        Property = Val;
        MarkDirty(bInvalidate, Dirty, Proxy);  // ◄─── 여기서 DirtySet에 추가
    }

private:
    void MarkDirty(bool bInvalidate, FDirtyChaosPropertyFlags& Dirty, IPhysicsProxyBase* Proxy)
    {
        if(bInvalidate)
        {
            Dirty.MarkDirty(PropertyFlag);

            if(Proxy)
            {
                if(FPhysicsSolverBase* PhysicsSolverBase = Proxy->GetSolver<FPhysicsSolverBase>())
                {
                    PhysicsSolverBase->AddDirtyProxy(Proxy);  // ◄─── DirtySet.Add() 호출
                }
            }
        }
    }
};
```

**사용 예시:**
```cpp
// Particle의 위치를 변경하면 자동으로 DirtySet에 추가됨
Particle->SetX(NewPosition);  // 내부적으로 TChaosProperty::Write() 호출
                              // → MarkDirty() → AddDirtyProxy()
```

### 경로 2: 프록시 등록 시

**📂 위치:** `Engine/Source/Runtime/Experimental/Chaos/Private/PBDRigidsSolver.cpp:820-830, 950-973`

```cpp
// SingleParticle 등록
void FPBDRigidsSolver::RegisterObject(FSingleParticlePhysicsProxy* Proxy)
{
    // ... 초기화 코드 ...
    RigidBody_External.SetUniqueIdx(GetEvolution()->GenerateUniqueIdx());
    TrackGTParticle_External(*Proxy->GetParticle_LowLevel());

    Proxy->SetSolver(this);
    Proxy->GetParticle_LowLevel()->SetProxy(Proxy);
    AddDirtyProxy(Proxy);  // ◄─── 등록 시 DirtySet에 추가

    UpdateParticleInAccelerationStructure_External(...);
}

// GeometryCollection 등록
void FPBDRigidsSolver::RegisterObject(FGeometryCollectionPhysicsProxy* InProxy)
{
    InProxy->SetSolver(this);
    InProxy->Initialize(GetEvolution());
    InProxy->NewData();

    // SQ에 즉시 추가
    for (const TUniquePtr<FPBDRigidParticle>& Particle : InProxy->GetUnorderedParticles_External())
    {
        if (Particle && !Particle->Disabled())
        {
            UpdateParticleInAccelerationStructure_External(Particle.Get(), EPendingSpatialDataOperation::Add);
        }
    }

    AddDirtyProxy(InProxy);  // ◄─── 등록 시 DirtySet에 추가
}

// ClusterUnion, Joint, Suspension 등도 동일한 패턴
void FPBDRigidsSolver::RegisterObject(FClusterUnionPhysicsProxy* Proxy)
{
    // ... 초기화 ...
    AddDirtyProxy(Proxy);  // ◄─── 등록 시 DirtySet에 추가
}
```

### 경로 3: Shape 변경 시

**📂 위치:** `Engine/Source/Runtime/Experimental/Chaos/Public/Chaos/Properties.h:143-157`

```cpp
// TShapeProperty 클래스 내부
template <typename T, EShapeProperty PropName>
class TShapeProperty
{
public:
    void Write(const T& Val, bool bInvalidate, FShapeDirtyFlags& Dirty,
               IPhysicsProxyBase* Proxy, int32 ShapeIdx)
    {
        Property = Val;
        MarkDirty(bInvalidate, Dirty, Proxy, ShapeIdx);
    }

private:
    void MarkDirty(bool bInvalidate, FShapeDirtyFlags& Dirty,
                   IPhysicsProxyBase* Proxy, int32 ShapeIdx)
    {
        if(bInvalidate)
        {
            const bool bFirstDirty = Dirty.IsClean();
            Dirty.MarkDirty(PropertyFlag);

            if(bFirstDirty && Proxy)
            {
                if(FPhysicsSolverBase* PhysicsSolverBase = Proxy->GetSolver<FPhysicsSolverBase>())
                {
                    PhysicsSolverBase->AddDirtyProxyShape(Proxy, ShapeIdx);  // ◄─── Shape 전용
                }
            }
        }
    }
};
```

---

## 🔷 DirtySet 처리 과정

### 단계 1: Game Thread - PushPhysicsState()

**📂 위치:** `Engine/Source/Runtime/Experimental/Chaos/Private/PBDRigidsSolver.cpp:1485-1618`

```cpp
void FPBDRigidsSolver::PushPhysicsState(const FReal DeltaTime, const int32 NumSteps, const int32 NumExternalSteps)
{
    QUICK_SCOPE_CYCLE_COUNTER(STAT_PushPhysicsState);

    // Lock 획득 (AsyncInitBody가 활성화된 경우)
    UE_CHAOS_ASYNC_INITBODY_WRITESCOPELOCK(MarshallingManager.GetMarshallingManagerLock());

    // ProducerData에서 DirtySet 가져오기
    FPushPhysicsData* PushData = MarshallingManager.GetProducerData_External();
    FDirtySet* DirtyProxiesData = &PushData->DirtyProxiesDataBuffer;
    FDirtyPropertiesManager* Manager = &PushData->DirtyPropertiesManager;

    // Manager 준비
    Manager->PrepareBuckets(DirtyProxiesData->GetDirtyProxyBucketInfo());
    Manager->SetNumShapes(DirtyProxiesData->NumDirtyShapes());
    FShapeDirtyData* ShapeDirtyData = DirtyProxiesData->GetShapesDirtyData();

    // ★ 병렬로 각 Dirty 프록시 처리
    DirtyProxiesData->ParallelForEachProxy(
        [this, DynamicsWeight, Manager, ShapeDirtyData](int32 DataIdx, FDirtyProxy& Dirty)
    {
        switch(Dirty.Proxy->GetType())
        {
        case EPhysicsProxyType::SingleParticleProxy:
        {
            auto Proxy = static_cast<FSingleParticlePhysicsProxy*>(Dirty.Proxy);
            auto Particle = Proxy->GetParticle_LowLevel();

            if(auto Rigid = Particle->CastToRigidParticle())
            {
                Rigid->ApplyDynamicsWeight(DynamicsWeight);
            }

            Particle->PrepareBVH();
            Particle->LockGeometry();
            // GT 데이터를 Manager에 동기화
            Particle->SyncRemoteData(*Manager, DataIdx, Dirty.PropertyData,
                                     Dirty.ShapeDataIndices, ShapeDirtyData);
            Proxy->ClearAccumulatedData();
            Proxy->ResetDirtyIdx();  // ◄─── DirtyIdx 초기화 (다음 프레임 위해)
            break;
        }

        case EPhysicsProxyType::GeometryCollectionType:
        {
            auto Proxy = static_cast<FGeometryCollectionPhysicsProxy*>(Dirty.Proxy);
            Proxy->PushStateOnGameThread(this);
            Proxy->ResetDirtyIdx();
            break;
        }

        case EPhysicsProxyType::ClusterUnionProxy:
        {
            FClusterUnionPhysicsProxy* Proxy = static_cast<FClusterUnionPhysicsProxy*>(Dirty.Proxy);
            FClusterUnionPhysicsProxy::FExternalParticle* Particle = Proxy->GetParticle_External();
            Particle->LockGeometry();
            Proxy->SyncRemoteData(*Manager, DataIdx, Dirty.PropertyData);
            Proxy->ClearAccumulatedData();
            Proxy->ResetDirtyIdx();
            break;
        }

        case EPhysicsProxyType::JointConstraintType:
        case EPhysicsProxyType::SuspensionConstraintType:
        case EPhysicsProxyType::CharacterGroundConstraintType:
        {
            // Constraint들도 동일하게 처리
            // ...
            break;
        }
        }
    });

    // Step 전달 → ExternalQueue에 적재
    MarshallingManager.Step_External(DeltaTime, NumSteps, GetSolverSubstep_External());
}
```

### 단계 2: Physics Thread - ProcessSinglePushedData_Internal()

**📂 위치:** `Engine/Source/Runtime/Experimental/Chaos/Private/PBDRigidsSolver.cpp:1620-1846`

```cpp
void FPBDRigidsSolver::ProcessSinglePushedData_Internal(FPushPhysicsData& PushData)
{
    QUICK_SCOPE_CYCLE_COUNTER(STAT_ProcessSinglePushedData_Internal);

    FRewindData* RewindData = GetRewindData();
    FDirtySet* DirtyProxiesData = &PushData.DirtyProxiesDataBuffer;
    FDirtyPropertiesManager* Manager = &PushData.DirtyPropertiesManager;
    FShapeDirtyData* ShapeDirtyData = DirtyProxiesData->GetShapesDirtyData();
    FReal ExternalDt = PushData.ExternalDt;

    // ═══════════════════════════════════════════════════════════════════════
    // 1차 순회: Body 생성/업데이트 (Constraint보다 먼저!)
    // ═══════════════════════════════════════════════════════════════════════
    DirtyProxiesData->ForEachProxy([...](int32 DataIdx, FDirtyProxy& Dirty)
    {
        if(Dirty.Proxy->GetIgnoreDataOnStep_Internal() != CurrentFrame)
        {
            switch(Dirty.Proxy->GetType())
            {
            case EPhysicsProxyType::SingleParticleProxy:
            {
                FSingleParticlePhysicsProxy* Proxy = ...;

                const bool bIsNew = !Proxy->IsInitialized();
                if(bIsNew)
                {
                    // ★ 새 프록시 → Handle 생성
                    // 파티클 타입에 따라 Handle 생성
                    switch (Dirty.PropertyData.GetParticleBufferType())
                    {
                        case EParticleType::Static:
                            Proxy->SetHandle(Particles.CreateStaticParticles(1, UniqueIdx)[0]);
                            break;
                        case EParticleType::Kinematic:
                            Proxy->SetHandle(Particles.CreateKinematicParticles(1, UniqueIdx)[0]);
                            break;
                        case EParticleType::Rigid:
                            Proxy->SetHandle(Particles.CreateDynamicParticles(1, UniqueIdx)[0]);
                            break;
                    }
                }

                // PT에 상태 푸시
                Proxy->PushToPhysicsState(*Manager, DataIdx, Dirty, ShapeDirtyData, ExternalDt);

                if(bIsNew)
                {
                    GetEvolution()->RegisterParticle(Handle);  // Evolution에 등록
                    Proxy->SetInitialized(GetCurrentFrame());
                }
                break;
            }

            case EPhysicsProxyType::GeometryCollectionType:
            {
                FGeometryCollectionPhysicsProxy* Proxy = ...;
                if (!Proxy->IsInitializedOnPhysicsThread())
                {
                    Proxy->InitializeBodiesPT(this, GetParticles());
                }
                Proxy->PushToPhysicsState();
                break;
            }

            case EPhysicsProxyType::JointConstraintType:
            case EPhysicsProxyType::SuspensionConstraintType:
            case EPhysicsProxyType::CharacterGroundConstraintType:
                // ★ Body 생성 후에 처리해야 하므로 여기서는 Pass
                break;
            }
        }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 2차 순회: Constraint 생성/업데이트 (Body 생성 완료 후)
    // ═══════════════════════════════════════════════════════════════════════
    DirtyProxiesData->ForEachProxy([...](int32 DataIdx, FDirtyProxy& Dirty)
    {
        switch (Dirty.Proxy->GetType())
        {
        case EPhysicsProxyType::JointConstraintType:
        {
            auto JointProxy = static_cast<FJointConstraintPhysicsProxy*>(Dirty.Proxy);
            if (!JointProxy->IsInitialized())
            {
                JointProxy->InitializeOnPhysicsThread(this, *Manager, DataIdx, Dirty.PropertyData);
                JointProxy->SetInitialized(GetCurrentFrame());
            }
            JointProxy->PushStateOnPhysicsThread(this, *Manager, DataIdx, Dirty.PropertyData);
            break;
        }
        // SuspensionConstraint, CharacterGroundConstraint 등도 유사
        }
    });
}
```

---

## 🔶 DirtyIdx를 통한 중복 방지 메커니즘

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        DirtyIdx 중복 방지 메커니즘                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. 초기 상태: Proxy->DirtyIdx = INDEX_NONE (-1)                                │
│                                                                                  │
│  2. 첫 번째 변경:                                                                │
│     ┌────────────────────────────────────────────────────────────────────────┐  │
│     │ Particle->SetX(NewPos);                                                │  │
│     │   → AddDirtyProxy(Proxy)                                               │  │
│     │   → DirtySet.Add(Proxy)                                                │  │
│     │       if(Proxy->GetDirtyIdx() == INDEX_NONE)  // ✓ 조건 만족          │  │
│     │       {                                                                │  │
│     │           Proxy->SetDirtyIdx(Bucket.Num());   // DirtyIdx = 0         │  │
│     │           Bucket.Add(Proxy);                  // 버킷에 추가           │  │
│     │       }                                                                │  │
│     └────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  3. 같은 프레임에서 두 번째 변경:                                                 │
│     ┌────────────────────────────────────────────────────────────────────────┐  │
│     │ Particle->SetV(NewVel);                                                │  │
│     │   → AddDirtyProxy(Proxy)                                               │  │
│     │   → DirtySet.Add(Proxy)                                                │  │
│     │       if(Proxy->GetDirtyIdx() == INDEX_NONE)  // ✗ 조건 불만족        │  │
│     │       {                                        // DirtyIdx = 0이므로  │  │
│     │           // 아무것도 안 함 - 이미 DirtySet에 있음                     │  │
│     │       }                                                                │  │
│     └────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  4. PushPhysicsState() 후:                                                      │
│     ┌────────────────────────────────────────────────────────────────────────┐  │
│     │ Proxy->ResetDirtyIdx();  // DirtyIdx = INDEX_NONE으로 리셋             │  │
│     │                          // 다음 프레임에서 다시 추가 가능              │  │
│     └────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔷 프록시 제거 시 DirtySet 처리

**📂 위치:** `Engine/Source/Runtime/Experimental/Chaos/Private/PBDRigidsSolver.cpp:882-948`

```cpp
void FPBDRigidsSolver::UnregisterObject(FSingleParticlePhysicsProxy* Proxy)
{
    // ... 기타 정리 작업 ...

    // ★ DirtySet에서 제거
    RemoveDirtyProxy(Proxy);

    // 삭제 마킹
    Proxy->MarkDeleted();

    // 물리 스레드에 삭제 명령 전달
    EnqueueCommandImmediate([Proxy, UniqueIdx, this]()
    {
        // ... PT에서 실제 삭제 처리 ...
    });
}
```

**Remove 구현:**
```cpp
void FDirtySet::Remove(IPhysicsProxyBase* Base)
{
    const int32 Idx = Base->GetDirtyIdx();
    if(Idx != INDEX_NONE)
    {
        FDirtyProxiesBucket& Bucket = DirtyProxyBuckets[(uint32)Base->GetType()];

        if(Idx == Bucket.ProxiesData.Num() - 1)
        {
            // 마지막 요소면 그냥 Pop
            Bucket.ProxiesData.Pop(EAllowShrinking::No);
        }
        else if(Bucket.ProxiesData.IsValidIndex(Idx))
        {
            // 중간 요소면 RemoveAtSwap (O(1))
            Bucket.ProxiesData.RemoveAtSwap(Idx);
            // ★ Swap된 프록시의 DirtyIdx 업데이트
            Bucket.ProxiesData[Idx].SetDirtyIdx(Idx);
        }

        --DirtyProxyBucketInfo.Num[(uint32)Base->GetType()];
        --DirtyProxyBucketInfo.TotalNum;

        Base->ResetDirtyIdx();  // INDEX_NONE으로 리셋
    }
}
```

---

## 💡 성능 최적화 요약

| 최적화 기법 | 설명 | 효과 |
|------------|------|------|
| **DirtyIdx 중복 방지** | 같은 프레임에서 여러 번 변경해도 한 번만 추가 | 불필요한 처리 방지 |
| **타입별 버킷** | 프록시 타입별로 분리하여 관리 | 처리 순서 제어 용이 |
| **ParallelForEachProxy** | 병렬 순회로 GT에서 빠른 처리 | 멀티코어 활용 |
| **2단계 PT 처리** | Body 먼저 → Constraint 나중 | 의존성 문제 방지 |
| **RemoveAtSwap** | O(1) 제거 연산 | 빠른 프록시 제거 |

---

## 🔗 관련 문서

- [Chaos_Threading_And_Synchronization.md](./Chaos_Threading_And_Synchronization.md) - 전체 스레딩 아키텍처
- [Chaos_Complete_Architecture.md](./Chaos_Complete_Architecture.md) - Chaos 전체 구조
- [Overview.md](./Overview.md) - 물리 시스템 개요

---

> 이 문서는 FChaosMarshallingManager의 DirtySet 시스템을 심층 분석합니다.