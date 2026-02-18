---
title: "Chaos Physics Threading & Synchronization Deep Dive"
date: "2025-12-05"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Physics"
tags: ["unreal", "Physics"]
engine_version: "Unreal Engine 5.7"
---
# Chaos Physics Threading & Synchronization Deep Dive

## 🧭 개요 (Overview)

Chaos Physics는 **별도의 Physics Thread**에서 시뮬레이션을 수행하여 Game Thread와 독립적으로 실행됩니다. 이 문서는 두 스레드 간의 **안전한 데이터 동기화 메커니즘**을 심층 분석합니다.

**핵심 철학:**
- **Producer-Consumer Pattern**: Game Thread가 명령 생성, Physics Thread가 처리
- **Double Buffering**: 두 개의 데이터 버퍼로 동시 접근 방지
- **Physics Proxy System**: 스레드 간 데이터 격리 및 안전한 통신
- **Lock-Free Design**: 가능한 한 Lock 없이 통신하여 성능 극대화

---

## 🏗️ 스레드 아키텍처

### 전체 구조

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          GAME THREAD (Variable FPS)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────┐ │
│  │ UPrimitiveComponent │    │ UPhysicsConstraint  │    │ Game Logic      │ │
│  │ (공개 API)          │    │ (Joint 설정)        │    │ (사용자 코드)   │ │
│  └──────────┬──────────┘    └──────────┬──────────┘    └────────┬────────┘ │
│             │                          │                        │          │
│             └──────────────┬───────────┴────────────────────────┘          │
│                            ↓                                                │
│              ┌──────────────────────────────┐                              │
│              │ FSingleParticlePhysicsProxy  │  ← Physics Proxy (중재자)    │
│              │ - *_External() 메서드        │                              │
│              │ - 명령 큐 관리               │                              │
│              └──────────────┬───────────────┘                              │
│                             │                                               │
│                             ↓ Enqueue Command                              │
│              ┌──────────────────────────────┐                              │
│              │ Physics Command Queue        │  ← Thread-Safe Queue         │
│              │ (TQueue<FPhysicsCommand>)    │                              │
│              └──────────────┬───────────────┘                              │
│                             │                                               │
└─────────────────────────────┼───────────────────────────────────────────────┘
                              │
════════════════════════════════ SYNC BARRIER ═══════════════════════════════════
                              │
                              ↓ Dequeue & Execute
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PHYSICS THREAD (Fixed 60Hz)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     FPBDRigidsSolver                                 │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  ProcessCommands():                                                 │   │
│  │    - 큐에서 명령 꺼내어 실행                                         │   │
│  │    - Particle 상태 직접 수정                                         │   │
│  │                                                                     │   │
│  │  AdvanceOneTimeStep(Dt):                                            │   │
│  │    1. Integrate (힘 적용)                                           │   │
│  │    2. DetectCollisions (충돌 검출)                                  │   │
│  │    3. SolveConstraints (제약 해결)                                  │   │
│  │    4. UpdatePositions (위치 갱신)                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                             │                                               │
│                             ↓ Write Results                                │
│              ┌──────────────────────────────┐                              │
│              │ Results Buffer (Double)      │  ← 결과 버퍼                 │
│              │ - Positions, Rotations       │                              │
│              │ - Velocities, States         │                              │
│              └──────────────┬───────────────┘                              │
│                             │                                               │
└─────────────────────────────┼───────────────────────────────────────────────┘
                              │
════════════════════════════════ SYNC BARRIER ═══════════════════════════════════
                              │
                              ↓ Read Results (Buffer Swap)
┌─────────────────────────────────────────────────────────────────────────────┐
│                          GAME THREAD (다음 프레임)                           │
│                                                                             │
│  UPrimitiveComponent::GetPhysicsLinearVelocity()                           │
│    → Proxy에서 캐시된 결과 반환                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 핵심 클래스 정의

### 세 클래스의 역할

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Chaos Physics Core Classes                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  🏛️ FPBDRigidsSolver                                                            │
│  ────────────────────                                                           │
│  "물리 시뮬레이션의 중앙 관제소"                                                │
│  - 게임 스레드와 물리 스레드를 조율                                             │
│  - 전체 물리 시뮬레이션 프로세스 관리                                           │
│  - 최고 수준의 컨트롤러                                                         │
│                                                                                  │
│  📡 FChaosMarshallingManager                                                    │
│  ────────────────────────────                                                   │
│  "게임 스레드 ↔ 물리 스레드 데이터 전송 허브"                                   │
│  - 안전하고 효율적인 Push/Pull 통신 보장                                        │
│  - 멀티스레드 동기화 전문가                                                     │
│                                                                                  │
│  ⚙️ FPBDRigidsEvolutionGBF                                                      │
│  ────────────────────────────                                                   │
│  "실제 물리 법칙을 구현하는 연산 엔진"                                          │
│  - PBD 알고리즘을 통한 물리 계산                                                │
│  - 파티클의 위치, 속도, 충돌 계산                                               │
│  - 저수준 시뮬레이션 코어                                                       │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 🏛️ FPBDRigidsSolver - 물리 시뮬레이션 총괄 매니저

```cpp
class FPBDRigidsSolver : public FPhysicsSolverBase
{
    // 🎯 핵심 멤버
    TUniquePtr<FChaosMarshallingManager> MarshallingManager;    // 데이터 허브
    TUniquePtr<FPBDRigidsEvolutionGBF> MEvolution;              // 연산 엔진
    TArray<IPhysicsProxyBase*> Proxies;                         // 물리 프록시들
    FPBDRigidsEvolutionCallback EventManager;                   // 이벤트 관리

    // 🛠️ 주요 기능
    void AdvanceAndDispatch_External(FReal DeltaTime);          // 시뮬레이션 진행
    void PushPhysicsState(FReal DeltaTime, int32 NumSteps);     // 상태 푸시
    void RegisterObject(IPhysicsProxyBase* Proxy);               // 객체 등록
    void UnregisterObject(IPhysicsProxyBase* Proxy);             // 객체 해제
};
```

**주요 역할:**
- 🎛️ **시뮬레이션 조율**: 전체 물리 시뮬레이션 라이프사이클 관리
- 📋 **객체 관리**: 물리 프록시 등록/해제
- ⚡ **이벤트 처리**: 충돌 이벤트, Sleep/Wake 이벤트 등

### 📡 FChaosMarshallingManager - 멀티스레드 데이터 허브

```cpp
class FChaosMarshallingManager
{
    // 🎯 핵심 멤버
    std::atomic<FReal> ExternalTime_External;        // 게임 스레드 시간
    std::atomic<int32> ExternalTimestamp_External;   // 타임스탬프

    // Push 데이터 (게임 → 물리)
    FPushPhysicsData* ProducerData;                  // 현재 생산 중인 데이터
    TArray<FPushPhysicsData*> ExternalQueue;         // 대기열
    TQueue<FPushPhysicsData*> PushDataPool;          // 재사용 풀

    // Pull 데이터 (물리 → 게임)
    FPullPhysicsData* CurPullData;                   // 현재 결과 데이터
    TQueue<FPullPhysicsData*> PullDataQueue;         // 결과 큐

    // 🛠️ 주요 기능
    void Step_External(FReal DeltaTime, int32 NumSteps);    // 스텝 진행
    void AddDirtyProxy(IPhysicsProxyBase* Proxy);           // 더티 프록시 추가
    void FinalizePullData_Internal();                        // Pull 데이터 완료
};
```

**주요 역할:**
- 🔄 **데이터 중개**: 스레드 간 안전한 데이터 전송
- 🎯 **더티 추적**: 변경된 객체만 효율적으로 동기화
- ♻️ **풀링**: 메모리 재사용으로 할당 최소화

### ⚙️ FPBDRigidsEvolutionGBF - 연산 엔진

```cpp
class FPBDRigidsEvolutionGBF
{
    // 🎯 핵심 멤버
    FPBDCollisionConstraints CollisionConstraints;           // 충돌 제약
    FPBDJointConstraints JointConstraints;                   // 조인트 제약
    FSpatialAccelerationBroadPhase BroadPhase;               // 광역 충돌 감지
    FRigidClustering Clustering;                             // 클러스터링

    // 🛠️ 주요 기능
    void AdvanceOneTimeStepImpl(FReal Dt);                   // 한 스텝 진행
    void Integrate(FReal Dt);                                 // 적분
    void CreateConstraintGraph();                             // 제약 그래프 생성
    void Solve(FReal Dt);                                     // 제약 해결
};
```

**주요 역할:**
- 🔢 **수치 계산**: PBD 알고리즘을 통한 물리 법칙 계산
- ⚡ **통합 처리**: 힘 → 속도 → 위치 변환
- 🎯 **충돌 처리**: 충돌 감지 및 응답
- 🔗 **제약 해결**: 조인트, 충돌 등 제약조건 처리

### 🌳 계층 구조 및 상호작용

```
FPBDRigidsSolver (총괄 매니저)
├── FChaosMarshallingManager (데이터 허브)
│   ├── FPushPhysicsData (게임 → 물리)
│   │   ├── DirtyProxiesDataBuffer
│   │   ├── SimCallbackObjectsToAdd
│   │   └── StartTime, NumSteps
│   │
│   └── FPullPhysicsData (물리 → 게임)
│       ├── DirtyRigids (변경된 Rigid Body)
│       ├── DirtyChaosProperties
│       └── Timestamp
│
└── FPBDRigidsEvolutionGBF (연산 엔진)
    ├── FPBDCollisionConstraints (충돌)
    ├── FPBDJointConstraints (조인트)
    ├── FSpatialAccelerationBroadPhase (광역 충돌)
    ├── FRigidClustering (클러스터링)
    └── FIslandManager (Island 기반 병렬화)
```

---

## 🔄 Push/Pull 데이터 흐름 상세

### 🔼 게임 스레드에서 물리 스레드로 (Push)

```cpp
// 1. 게임 스레드에서 물리 상태 준비
void FPBDRigidsSolver::PushPhysicsState(FReal DeltaTime, int32 NumSteps)
{
    // 마샬링 매니저에서 Producer 데이터 획득
    FPushPhysicsData* PushData = MarshallingManager.GetProducerData_External();

    // 더티 프록시들을 병렬 처리
    PushData->DirtyProxiesDataBuffer.ParallelForEachProxy(
        [&](int32 DataIdx, FDirtyProxy& Dirty)
    {
        // 프록시 타입별 처리
        switch(Dirty.Proxy->GetType())
        {
        case EPhysicsProxyType::SingleParticleProxy:
            ProcessSingleParticleProxy(Dirty, DataIdx);
            break;
        case EPhysicsProxyType::GeometryCollectionType:
            ProcessGeometryCollectionProxy(Dirty, DataIdx);
            break;
        }
    });

    // 마샬링 매니저에 데이터 제출
    MarshallingManager.Step_External(DeltaTime, NumSteps);
}

// 2. 물리 스레드에서 데이터 처리
void FPBDRigidsSolver::ProcessPushedData_Internal(FPushPhysicsData& PushData)
{
    // 시뮬레이션 콜백 등록
    for(ISimCallbackObject* CallbackObj : PushData.SimCallbackObjectsToAdd)
    {
        RegisterSimCallbackObject(CallbackObj);
    }

    // 더티 프록시 데이터를 물리 파티클에 적용
    ProcessDirtyProxiesData(PushData);
}
```

### 🔽 물리 스레드에서 게임 스레드로 (Pull)

```cpp
// 1. 물리 시뮬레이션 실행
void FPBDRigidsSolver::AdvanceOneTimeStepImpl(FReal DeltaTime)
{
    // Evolution 엔진으로 실제 물리 계산
    MEvolution->AdvanceOneTimeStep(DeltaTime);

    // 결과를 Pull 데이터로 버퍼링
    BufferPhysicsResults();

    // 마샬링 매니저에 완료 통보
    MarshallingManager.FinalizePullData_Internal(
        LastExternalTimestampConsumed,
        SimStartTime,
        DeltaTime
    );
}

// 2. 게임 스레드에서 결과 적용
void ApplyPhysicsResults()
{
    // 마샬링 매니저에서 Pull 데이터 획득
    FPullPhysicsData* PullData = MarshallingManager.PopPullData_External();

    if(PullData)
    {
        // 각 프록시별로 결과 적용
        for(const FDirtyRigidParticleData& ParticleData : PullData->DirtyRigids)
        {
            if(FSingleParticlePhysicsProxy* Proxy = ParticleData.Proxy)
            {
                // 물리 결과를 게임 객체에 적용
                Proxy->PullFromPhysicsState(ParticleData, SolverTimestamp);
            }
        }
    }
}
```

### 데이터 흐름 시각화

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         Push/Pull Data Flow                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Game Thread                 MarshallingManager              Physics Thread     │
│  ───────────                 ──────────────────              ──────────────     │
│       │                            │                              │             │
│  [1] 게임 로직 실행                │                              │             │
│       │                            │                              │             │
│  [2] PushPhysicsState()            │                              │             │
│       │                            │                              │             │
│       ├── GetProducerData() ──────→│                              │             │
│       │                            │                              │             │
│       ├── 더티 프록시 수집         │                              │             │
│       │                            │                              │             │
│       ├── Step_External() ────────→│                              │             │
│       │                            │                              │             │
│       │                     [3] ExternalQueue.Add()               │             │
│       │                            │                              │             │
│       │                            ├──────────────────────────────→│             │
│       │                            │     FPushPhysicsData         │             │
│       │                            │                              │             │
│       │                            │                    [4] ProcessPushedData() │
│       │                            │                              │             │
│       │                            │                    [5] AdvanceOneTimeStep()│
│       │                            │                              │             │
│       │                            │                    [6] BufferResults()     │
│       │                            │                              │             │
│       │                            │←─────────────────────────────┤             │
│       │                            │     FPullPhysicsData         │             │
│       │                            │                              │             │
│       │                     [7] PullDataQueue.Add()               │             │
│       │                            │                              │             │
│  [8] PopPullData_External() ←─────┤                              │             │
│       │                            │                              │             │
│  [9] 게임 객체에 결과 적용         │                              │             │
│       │                            │                              │             │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 최적화 기술

### 1. ✅ 더티 플래그 시스템 (Dirty Flag)

```cpp
struct FDirtyProxy
{
    IPhysicsProxyBase* Proxy;           // 물리 프록시
    FDirtyChaosProperties PropertyData; // 변경된 속성
    TArray<int32> ShapeDataIndices;     // 형상 데이터 인덱스

    void MarkDirty(EChaosPropertyFlags Flag)
    {
        PropertyData.DirtyFlag(Flag);
    }

    bool IsDirty(EChaosPropertyFlags Flag) const
    {
        return PropertyData.IsDirty(Flag);
    }
};

// 사용 예시
void UpdatePhysicsObject(FVector NewPosition)
{
    // 1. 게임 스레드에서 위치 변경
    PhysicsProxy->SetPosition(NewPosition);

    // 2. 더티 플래그 마킹
    PhysicsProxy->MarkDirty(EChaosPropertyFlags::X);

    // 3. 마샬링 매니저에 등록
    MarshallingManager.AddDirtyProxy(PhysicsProxy);
}
```

### 2. 🔄 서브스테핑 지원

```cpp
void FPBDRigidsEvolutionGBF::AdvanceOneTimeStepImpl(FReal Dt, const FSubStepInfo& SubStepInfo)
{
    // 서브스텝별 처리
    for(int32 SubStep = 0; SubStep < SubStepInfo.NumSteps; ++SubStep)
    {
        FReal SubDt = Dt / SubStepInfo.NumSteps;

        // 1. 키네마틱 타겟 적용
        ApplyKinematicTargets(SubDt, SubStepInfo.PseudoFraction);

        // 2. 통합 (힘 → 속도 → 위치)
        Integrate(SubDt);

        // 3. 충돌 감지
        CollisionDetector.DetectCollisions(SubDt);

        // 4. 제약 해결
        SolveConstraints(SubDt);
    }
}
```

### 3. 🧮 메모리 풀링

```cpp
void FChaosMarshallingManager::PrepareExternalQueue_External()
{
    // 풀에서 재사용 가능한 데이터 확인
    if(!PushDataPool.Dequeue(ProducerData))
    {
        // 새로운 데이터 생성
        BackingBuffer.Add(MakeUnique<FPushPhysicsData>());
        ProducerData = BackingBuffer.Last().Get();
    }

    // 시작 시간 설정
    ProducerData->StartTime = ExternalTime_External;
}

void FChaosMarshallingManager::FreeData_Internal(FPushPhysicsData* PushData)
{
    // 데이터 리셋
    PushData->Reset();

    // 풀에 반환
    PushDataPool.Enqueue(PushData);
}
```

---

## 🎮 실제 사용 예시

### 🧱 물리 시뮬레이션 초기화

```cpp
void InitializePhysicsSimulation()
{
    // 1. 물리 솔버 생성
    FPBDRigidsSolver* Solver = new FPBDRigidsSolver(
        EMultiBufferMode::Double,    // 더블 버퍼링
        nullptr,                     // 소유자
        1.0f/60.0f                   // 물리 틱 간격
    );

    // 2. Evolution 엔진 초기화
    Solver->GetEvolution()->SetGravity(FVec3(0, 0, -980));

    // 3. 마샬링 매니저 설정
    Solver->GetMarshallingManager().SetHistoryLength(10);

    // 4. 이벤트 핸들러 등록
    Solver->GetEventManager()->RegisterHandler<FCollisionEventData>(
        EEventType::Collision,
        [](const FCollisionEventData& Event) {
            // 충돌 이벤트 처리
        }
    );
}
```

### ✏️ 실시간 물리 업데이트

```cpp
void UpdatePhysicsFrame(float DeltaTime)
{
    // 1. 게임 스레드에서 물리 상태 준비
    Solver->PushPhysicsState(DeltaTime, 1);

    // 2. 물리 스레드에서 시뮬레이션 실행
    Solver->AdvanceAndDispatch_External(DeltaTime);

    // 3. 결과를 게임 객체에 적용
    while(FPullPhysicsData* PullData = Solver->GetMarshallingManager().PopPullData_External())
    {
        ApplyPhysicsResults(PullData);
    }
}
```

### 🎯 동적 객체 생성

```cpp
void CreateDynamicRigidBody(UStaticMeshComponent* MeshComponent)
{
    // 1. 파티클 생성
    auto Particle = MakeUnique<FPBDRigidParticle>();
    Particle->SetX(MeshComponent->GetComponentLocation());
    Particle->SetR(MeshComponent->GetComponentQuat());
    Particle->SetObjectState(EObjectStateType::Dynamic);

    // 2. 프록시 생성
    FSingleParticlePhysicsProxy* Proxy = FSingleParticlePhysicsProxy::Create(
        MoveTemp(Particle)
    );

    // 3. 솔버에 등록
    Solver->RegisterObject(Proxy);

    // 4. 컴포넌트와 연결
    MeshComponent->SetPhysicsProxy(Proxy);
}
```

---

## ✅ 핵심 클래스 요약

| 컴포넌트 | 역할 | 핵심 기능 | 설계 패턴 |
|----------|------|-----------|-----------|
| **FPBDRigidsSolver** | 🎯 총괄 매니저 | 전체 물리 시뮬레이션 조율 | Strategy, Template Method |
| **FChaosMarshallingManager** | 📡 데이터 허브 | 스레드 간 안전한 데이터 전송 | Producer-Consumer, Object Pool |
| **FPBDRigidsEvolutionGBF** | ⚙️ 연산 엔진 | 실제 물리 법칙 계산 | Command, State Machine |

**핵심 특징:**
- 🔄 **멀티스레드 안전성**: 락 프리 큐와 원자적 연산으로 고성능 동기화
- ⚡ **성능 최적화**: 더티 플래그, 메모리 풀링, 서브스테핑으로 효율성 극대화
- 🧩 **모듈화 설계**: 각 컴포넌트가 명확한 책임을 가진 관심사 분리
- 🔧 **확장성**: 다양한 물리 시뮬레이션 요구사항에 대응 가능한 유연한 구조

---

## 📡 FChaosMarshallingManager 상세 분석

### 기본 역할

> **FChaosMarshallingManager**는 **게임 스레드와 물리 스레드 간의 안전하고 효율적인 데이터 교환(Marshalling)**을 처리하는 핵심 컴포넌트입니다.

**핵심 기능:**
- **명령 큐(Command Queue)**를 통한 이벤트 전달
- **더블 버퍼(Double Buffering)** 구조를 통한 상태 동기화
- **TaskGraph 통합**으로 비동기 물리 처리
- 물리 결과를 게임 오브젝트에 **정확히 반영**

### 클래스 구조

```cpp
class FChaosMarshallingManager
{
private:
    // 커맨드 큐 시스템
    TQueue<TUniquePtr<FPhysicsCommand>, EQueueMode::Mpsc> CommandQueue;

    // 데이터 버퍼 (더블 버퍼링)
    FPhysicsDataBuffer GameThreadBuffer;
    FPhysicsDataBuffer PhysicsThreadBuffer;

    // 스레드 동기화
    FCriticalSection BufferSwapLock;
    FEvent* PhysicsThreadEvent;

public:
    // 메인 인터페이스
    void QueueCommand(TUniquePtr<FPhysicsCommand> Command);
    void ProcessCommands();
    void MarshallGameThreadData();
    void UnmarshallPhysicsThreadData();
};
```

### 🔄 스레드 간 마샬링 흐름

#### 🎮 A. 게임 스레드 → 물리 스레드

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                Game Thread → Physics Thread Marshalling                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  [1] 명령 생성                                                                  │
│       FAddImpulseCommand, FSetTransformCommand 등                               │
│                           │                                                      │
│                           ▼                                                      │
│  [2] CommandQueue에 큐잉                                                        │
│       Thread-Safe MPSC Queue                                                    │
│                           │                                                      │
│                           ▼                                                      │
│  [3] GameThreadBuffer에 현재 상태 복사                                          │
│       Transform, Velocity, etc.                                                 │
│                           │                                                      │
│                           ▼                                                      │
│  [4] bBufferSwapRequested 플래그 설정                                           │
│       버퍼 스왑 요청                                                             │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```cpp
// 게임 스레드에서 물리 명령 큐잉
void FChaosMarshallingManager::QueuePhysicsCommand(AActor* Actor, const FVector& Impulse)
{
    // 1. 명령 객체 생성
    auto Command = MakeUnique<FAddImpulseCommand>();
    Command->ActorID = Actor->GetUniqueID();
    Command->ImpulseVector = Impulse;
    Command->ExecutionFrame = GFrameNumber;

    // 2. 스레드 안전 큐에 추가
    {
        FScopeLock Lock(&CommandQueueLock);
        CommandQueue.Enqueue(MoveTemp(Command));
    }

    // 3. 물리 스레드에 신호 전송
    PhysicsThreadEvent->Trigger();
}

// 게임 스레드에서 transform 데이터 마샬링
void FChaosMarshallingManager::MarshallGameThreadData()
{
    // 1. 게임 스레드 버퍼 잠금
    FScopeLock Lock(&GameThreadBufferLock);

    // 2. 모든 물리 액터의 상태 복사
    for (auto& ActorPair : PhysicsActors)
    {
        FPhysicsActorData& Data = GameThreadBuffer.ActorData[ActorPair.Key];
        Data.Transform = ActorPair.Value->GetActorTransform();
        Data.Velocity = ActorPair.Value->GetVelocity();
        Data.AngularVelocity = ActorPair.Value->GetAngularVelocity();
        Data.bNeedsUpdate = true;
    }

    // 3. 버퍼 스왑 요청
    bBufferSwapRequested = true;
}
```

#### 🧠 B. 물리 스레드에서 처리

```cpp
// 물리 스레드 메인 루프
void FChaosMarshallingManager::PhysicsThreadTick(float DeltaTime)
{
    // 1. 버퍼 스왑 (더블 버퍼링)
    if (bBufferSwapRequested.load())
    {
        SwapBuffers();
        bBufferSwapRequested = false;
    }

    // 2. 게임 스레드 명령 처리
    ProcessQueuedCommands();

    // 3. 물리 시뮬레이션 실행
    ChaosPhysicsSolver->AdvanceFrame(DeltaTime);

    // 4. 결과를 게임 스레드로 마샬링
    MarshallPhysicsResults();
}

void FChaosMarshallingManager::ProcessQueuedCommands()
{
    TUniquePtr<FPhysicsCommand> Command;

    // 큐에서 모든 명령 처리
    while (CommandQueue.Dequeue(Command))
    {
        switch (Command->GetType())
        {
            case EPhysicsCommandType::AddImpulse:
            {
                auto* ImpulseCmd = static_cast<FAddImpulseCommand*>(Command.Get());
                if (auto* PhysicsHandle = GetPhysicsHandle(ImpulseCmd->ActorID))
                {
                    PhysicsHandle->AddImpulse(ImpulseCmd->ImpulseVector);
                }
                break;
            }

            case EPhysicsCommandType::SetTransform:
            {
                auto* TransformCmd = static_cast<FSetTransformCommand*>(Command.Get());
                if (auto* PhysicsHandle = GetPhysicsHandle(TransformCmd->ActorID))
                {
                    PhysicsHandle->SetWorldTransform(TransformCmd->NewTransform);
                }
                break;
            }
        }
    }
}
```

### ⚙️ 내부 동작 메커니즘

#### 🌀 A. 더블 버퍼링 시스템

```cpp
// 버퍼 스왑 메커니즘
void FChaosMarshallingManager::SwapBuffers()
{
    FScopeLock GameLock(&GameThreadBufferLock);
    FScopeLock PhysicsLock(&PhysicsThreadBufferLock);

    // 포인터 스왑으로 빠른 전환
    Swap(GameThreadBuffer, PhysicsThreadBuffer);

    // 스왑 완료 신호
    BufferSwapComplete.Trigger();
}
```

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         Double Buffering Mechanism                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Frame N:                                                                       │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │  GameThreadBuffer (Front)        PhysicsThreadBuffer (Back)               │ │
│  │  ┌───────────────────┐           ┌───────────────────┐                    │ │
│  │  │ Game Thread       │           │ Physics Thread    │                    │ │
│  │  │ READ/WRITE        │           │ WRITE             │                    │ │
│  │  │ (새 입력 수집)    │           │ (시뮬레이션 결과) │                    │ │
│  │  └───────────────────┘           └───────────────────┘                    │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│                              ↓ SWAP (포인터만 교환)                             │
│                                                                                  │
│  Frame N+1:                                                                     │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │  PhysicsThreadBuffer (Front)     GameThreadBuffer (Back)                  │ │
│  │  ┌───────────────────┐           ┌───────────────────┐                    │ │
│  │  │ Game Thread       │           │ Physics Thread    │                    │ │
│  │  │ READ              │           │ WRITE             │                    │ │
│  │  │ (이전 프레임 결과)│           │ (새 시뮬레이션)   │                    │ │
│  │  └───────────────────┘           └───────────────────┘                    │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  장점:                                                                          │
│  • 게임/물리 스레드가 각자 자신의 버퍼만 접근 → Race Condition 방지            │
│  • 포인터 스왑 방식으로 성능 최적화 (데이터 복사 없음)                         │
│  • 1프레임 지연 (Trade-off)                                                    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 🧵 B. 비동기 TaskGraph 처리

```cpp
// TaskGraph 통합
void FChaosMarshallingManager::SchedulePhysicsTask()
{
    // 물리 작업을 별도 태스크로 분리
    auto PhysicsTask = TGraphTask<FPhysicsTickTask>::CreateTask(
        nullptr,
        ENamedThreads::GameThread
    ).ConstructAndDispatchWhenReady(this, DeltaTime);

    // 게임 스레드는 블록되지 않고 계속 진행
    PhysicsCompletionEvent = PhysicsTask->GetCompletionEvent();
}

// 결과 동기화
void FChaosMarshallingManager::SyncPhysicsResults()
{
    if (PhysicsCompletionEvent->IsComplete())
    {
        // 물리 결과를 게임 오브젝트에 적용
        ApplyPhysicsResultsToGameObjects();
        PhysicsCompletionEvent = nullptr;
    }
}
```

#### 🧠 C. 메모리 최적화 - 청크 기반 관리

```cpp
// 청크 기반 데이터 관리
struct FPhysicsDataChunk
{
    static constexpr int32 ChunkSize = 1024;

    TStaticArray<FPhysicsActorData, ChunkSize> ActorData;
    TBitArray<> ValidFlags;
    int32 UsedCount = 0;

    // 압축된 형태로 데이터 전송
    void CompressForTransfer(TArray<uint8>& OutBuffer)
    {
        FMemoryWriter Writer(OutBuffer);

        // 유효한 데이터만 직렬화
        Writer << UsedCount;
        for (int32 i = 0; i < ChunkSize; ++i)
        {
            if (ValidFlags[i])
            {
                Writer << i << ActorData[i];
            }
        }
    }
};

// 메모리 풀을 통한 최적화
class FPhysicsDataPool
{
    TQueue<TUniquePtr<FPhysicsActorData>> AvailableData;

public:
    TUniquePtr<FPhysicsActorData> Acquire()
    {
        TUniquePtr<FPhysicsActorData> Data;
        if (!AvailableData.Dequeue(Data))
        {
            Data = MakeUnique<FPhysicsActorData>();
        }
        return Data;
    }

    void Release(TUniquePtr<FPhysicsActorData> Data)
    {
        Data->Reset(); // 상태 초기화
        AvailableData.Enqueue(MoveTemp(Data));
    }
};
```

### 🕹️ 사용 예시

#### 게임 코드에서 물리 명령 큐잉

```cpp
// 게임 코드에서 사용 예시
void APhysicsActor::AddForce(const FVector& Force)
{
    // 즉시 적용이 아닌 다음 물리 틱에서 처리
    if (FChaosMarshallingManager* Manager = GetWorld()->GetPhysicsMarshallingManager())
    {
        Manager->QueueCommand(
            MakeUnique<FAddForceCommand>(GetUniqueID(), Force)
        );
    }
}
```

#### 물리 결과 적용

```cpp
void APhysicsActor::OnPhysicsUpdate(const FPhysicsActorData& PhysicsData)
{
    // 물리 스레드 결과를 게임 오브젝트에 반영
    SetActorTransform(PhysicsData.Transform);

    // 보간을 통한 부드러운 움직임
    if (bSmoothPhysicsUpdates)
    {
        FVector LerpedLocation = FMath::VInterpTo(
            GetActorLocation(),
            PhysicsData.Transform.GetLocation(),
            GetWorld()->GetDeltaSeconds(),
            PhysicsLerpSpeed
        );
        SetActorLocation(LerpedLocation);
    }
}
```

### 🧩 FChaosMarshallingManager 핵심 특징 요약

| 항목 | 설명 |
|------|------|
| **스레드 안전성** | MPSC 큐, 더블 버퍼, Atomic 플래그 사용 |
| **성능 최적화** | 메모리 풀, 청크 압축, 최소 잠금 구조 |
| **확장성** | 명령 패턴 기반, 다양한 커맨드 타입 확장 가능 |
| **TaskGraph 통합** | 엔진의 비동기 프레임워크와 완벽하게 호환 |
| **실시간성 보장** | 게임 스레드/물리 스레드 간 프레임 지연 최소화 |

### 참고 데이터 구조

- `FPhysicsCommand` → `AddImpulse`, `SetTransform`, `AddForce`, ...
- `FPhysicsActorData` → `Transform`, `Velocity`, `AngularVelocity`
- `FPhysicsDataChunk` → 압축 가능한 물리 데이터 블록
- `FPhysicsDataPool` → 풀 기반 메모리 재사용

---

## 🌐 FPBDRigidsEvolutionGBF 인스턴스 관리

### 📌 핵심 결론

> **FPBDRigidsEvolutionGBF**는 **UWorld마다 하나씩 존재**합니다.
> 전체 씬에 하나가 아닌, **각 UWorld마다 독립적으로 하나씩** 인스턴스화됩니다.

### 🏗️ 계층 구조: 전체 생성 흐름

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Physics Evolution Instance Hierarchy                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  UWorld (게임 월드)                                                              │
│       │                                                                         │
│       └── FPhysScene_Chaos (Physics Scene)                                      │
│             │                                                                   │
│             └── FChaosScene (Low-level Physics Context)                         │
│                   │                                                             │
│                   └── FPBDRigidsSolver (Solver)                                 │
│                         │                                                       │
│                         └── FPBDRigidsEvolutionGBF (Evolution System)           │
│                               │                                                 │
│                               ├── FPBDCollisionConstraints   // 충돌 처리       │
│                               ├── FPBDJointConstraints       // 조인트 제약     │
│                               ├── FGravityForces             // 중력 적용       │
│                               ├── FSpatialAccelerationBroadPhase // 공간 가속   │
│                               ├── FRigidClustering           // 클러스터링      │
│                               └── FCCDManager                // 연속 충돌       │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 🔄 생성 순서

```cpp
// 1. UWorld::InitWorld()에서 FPhysScene_Chaos 생성
UWorld* World = NewObject<UWorld>();

// 2. FPhysScene_Chaos는 Chaos 물리를 위한 FChaosScene 생성
FPhysScene_Chaos* PhysScene = new FPhysScene_Chaos();

// 3. FChaosScene 생성 (내부에서 Solver도 생성)
FChaosScene::FChaosScene(UObject* Owner, Chaos::FReal InAsyncDt)
{
    Solver = FChaosSolversModule::Get()->CreateSolver<FPBDRigidsSolver>();
    // Solver 내부에서 FPBDRigidsEvolutionGBF 생성됨
}
```

### 🔄 단일/멀티 월드 환경

#### 단일 UWorld 환경

```cpp
UWorld* World = GetWorld();
FPBDRigidsEvolutionGBF* Physics = GetPhysicsEvolutionFrom(World);
```

#### 멀티 UWorld 환경

각 월드 타입은 **독립적인 FPBDRigidsEvolutionGBF 인스턴스**를 가집니다:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Multi-World Physics Instances                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐               │
│  │   GameWorld     │   │   PIEWorld      │   │  PreviewWorld   │               │
│  │                 │   │                 │   │                 │               │
│  │ FPhysScene      │   │ FPhysScene      │   │ FPhysScene      │               │
│  │      ↓          │   │      ↓          │   │      ↓          │               │
│  │ FChaosScene     │   │ FChaosScene     │   │ FChaosScene     │               │
│  │      ↓          │   │      ↓          │   │      ↓          │               │
│  │ FPBDRigidsSolver│   │ FPBDRigidsSolver│   │ FPBDRigidsSolver│               │
│  │      ↓          │   │      ↓          │   │      ↓          │               │
│  │ Evolution #1    │   │ Evolution #2    │   │ Evolution #3    │               │
│  │                 │   │                 │   │                 │               │
│  │ (독립 시뮬)     │   │ (독립 시뮬)     │   │ (독립 시뮬)     │               │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘               │
│                                                                                  │
│  ※ 서로의 물리 상태를 공유하지 않음                                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```cpp
// 에디터 vs PIE 환경
UWorld* EditorWorld = GEditor->GetEditorWorldContext().World();
UWorld* PIEWorld = GEditor->GetPIEWorldContext().World();
// 각각 별도의 FPBDRigidsEvolutionGBF 인스턴스 보유

// 게임과 프리뷰 동시 운영
FPBDRigidsEvolutionGBF* GamePhysics = GetGamePhysicsEvolution();
FPBDRigidsEvolutionGBF* PreviewPhysics = GetPreviewPhysicsEvolution();

GamePhysics->AdvanceOneTimeStep(DeltaTime);    // 동시 실행 가능
PreviewPhysics->AdvanceOneTimeStep(DeltaTime);
```

### ⚙️ 스레드 구조 및 동기화 방식

#### 💡 3가지 주요 스레드

| 스레드 | 역할 |
|--------|------|
| **Game Thread** | 게임 로직, 액터 상태 업데이트 |
| **Physics Thread** | 물리 시뮬레이션 (`AdvanceOneTimeStep`) |
| **Render Thread** | 렌더링 커맨드 처리 |

#### 🔄 AdvanceOneTimeStep 동작 순서

```cpp
void FPBDRigidsEvolutionGBF::AdvanceOneTimeStep(FReal dt)
{
    Integrate(dt);                            // 위치/속도 적분
    DetectCollisions(dt);                     // 충돌 감지
    ApplyConstraints(dt);                     // 제약 조건 적용
    SyncToGameThread();                       // 결과 반영
}
```

> Chaos Physics는 물리 연산을 Physics Thread에서 비동기 처리하고, 게임 스레드와 결과를 동기화합니다.

### 🧾 인스턴스 관리 요약

| 항목 | 설명 |
|------|------|
| **인스턴스 수** | UWorld당 1개 |
| **독립성** | 각 UWorld는 자체 물리 시뮬레이션 담당 |
| **실행 스레드** | Physics Thread |
| **기능 구성** | 충돌, 조인트, 중력, 클러스터링 등 모든 물리 처리 포함 |
| **활용 환경** | GameWorld, PIEWorld, PreviewWorld, EditorWorld 등 |
| **동기화 방식** | `AdvanceOneTimeStep()` → `SyncToGameThread()` |

### 📘 실전 팁

- `FPBDRigidsEvolutionGBF`의 구조는 커스텀 Physics Extension 제작 시 진입 포인트로 활용 가능
- `FChaosScene`과 `FPhysScene_Chaos`를 통해 각 월드의 상태를 디버깅 가능
- PIE와 Editor 환경을 동시에 다루는 Tool 개발 시, 각 물리 인스턴스를 분리하여 테스트 필요

---

## 🎯 PhysicsProxy 시스템 상세

### 핵심 정의

> **PhysicsProxy**는 게임 스레드의 물리 객체와 물리 스레드의 시뮬레이션 파티클 간의 **중개자 역할**을 수행합니다.
> 멀티스레드 환경에서 안전하고 효율적인 데이터 전달과 동기화를 보장합니다.

### 기본 구조와 역할

```cpp
class IPhysicsProxyBase
{
    EPhysicsProxyType Type;
    UObject* Owner;
    TSharedPtr<IProxyTimestamp> Timestamp;
};

template<class Concrete, class ConcreteData, typename TProxyTimeStamp>
class TPhysicsProxy : public IPhysicsProxyBase
{
    bool IsSimulating() const {
        return static_cast<const Concrete*>(this)->IsSimulating();
    }
};
```

**주요 역할:**
- 🎯 **스레드 간 중개**: 게임 ↔ 물리
- 📤 **데이터 동기화**: 위치, 속도, 회전, 충돌
- 🌀 **생명주기 관리**: 생성, 업데이트, 삭제
- 🧷 **타입 안전성**: 다양한 프록시 타입

### 🌳 PhysicsProxy 계층 구조

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         PhysicsProxy Hierarchy                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  IPhysicsProxyBase                                                               │
│       │                                                                         │
│       └── TPhysicsProxy<T>                                                      │
│             │                                                                   │
│             ├── FSingleParticlePhysicsProxy                                     │
│             │     - 단일 리지드 바디 (프로젝타일, 일반 물리 액터)                │
│             │                                                                   │
│             ├── FGeometryCollectionPhysicsProxy                                 │
│             │     - 파괴 오브젝트 (벽 파괴, 폭발)                                │
│             │                                                                   │
│             ├── FSkeletalMeshPhysicsProxy                                       │
│             │     - 스켈레탈 메시 물리 (래그돌, 캐릭터 충돌)                     │
│             │                                                                   │
│             ├── FStaticMeshPhysicsProxy                                         │
│             │     - 정적 메시 충돌 (레벨 지형, 벽체)                             │
│             │                                                                   │
│             └── FPerSolverFieldSystem                                           │
│                   - 필드 시스템 프록시                                           │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 🔄 스레드 간 동기화 흐름

#### 🔼 게임 스레드 → 물리 스레드 (Push)

```cpp
// 게임 스레드에서 물리 스레드로 데이터 전송
void FSingleParticlePhysicsProxy::PushToPhysicsState(
    const FDirtyPropertiesManager& Manager,
    int32 DataIdx,
    const FDirtyProxy& Dirty,
    FShapeDirtyData* ShapesData,
    FReal ExternalDt)
{
    // Dirty 플래그 확인
    if (Dirty.IsDirty(EPBDRigidParticleProperty::X))
    {
        // 위치 업데이트
        if (auto* RigidHandle = GetHandle_LowLevel()->CastToRigidParticle())
        {
            RigidHandle->SetX(GetGameThreadAPI().X());
        }
    }

    if (Dirty.IsDirty(EPBDRigidParticleProperty::V))
    {
        // 속도 업데이트
        if (auto* RigidHandle = GetHandle_LowLevel()->CastToRigidParticle())
        {
            RigidHandle->SetV(GetGameThreadAPI().V());
        }
    }

    // 형상 데이터 업데이트
    if (ShapesData)
    {
        UpdateShapeData(ShapesData);
    }
}
```

#### 🔽 물리 스레드 → 게임 스레드 (Pull)

```cpp
// 물리 스레드에서 게임 스레드로 결과 전송
bool FSingleParticlePhysicsProxy::PullFromPhysicsState(
    const FDirtyRigidParticleData& PullData,
    int32 SolverSyncTimestamp,
    const FDirtyRigidParticleData* NextPullData,
    const FRealSingle* Alpha)
{
    // 보간 처리
    if (NextPullData && Alpha)
    {
        // 두 프레임 간 보간
        FVector InterpolatedPosition = FMath::Lerp(
            PullData.X, NextPullData->X, *Alpha);
        FQuat InterpolatedRotation = FMath::Lerp(
            PullData.R, NextPullData->R, *Alpha);

        GetGameThreadAPI().SetX(InterpolatedPosition);
        GetGameThreadAPI().SetR(InterpolatedRotation);
    }
    else
    {
        // 직접 데이터 복사
        GetGameThreadAPI().SetX(PullData.X);
        GetGameThreadAPI().SetR(PullData.R);
        GetGameThreadAPI().SetV(PullData.V);
        GetGameThreadAPI().SetW(PullData.W);
    }

    return true;
}
```

### 📊 PhysicsProxy 타입별 비교

| 프록시 타입 | 용도 | 특징 | 사용 예시 |
|-------------|------|------|-----------|
| `FSingleParticlePhysicsProxy` | 단일 리지드 바디 | 가장 기본적인 물리 객체 | 프로젝타일, 일반 물리 액터 |
| `FGeometryCollectionPhysicsProxy` | 파괴 오브젝트 | 여러 조각으로 분해 가능 | 벽 파괴, 폭발 |
| `FSkeletalMeshPhysicsProxy` | 스켈레탈 메시 물리 | Ragdoll | 래그돌, 캐릭터 충돌 |
| `FStaticMeshPhysicsProxy` | 정적 메시 충돌 | 복잡한 메시 형태 지원 | 레벨 지형, 벽체 |

### 🧰 프록시 생성 및 등록

#### ▶️ 생성 & 등록 과정

```cpp
// 프록시 팩토리 메서드
FSingleParticlePhysicsProxy* FSingleParticlePhysicsProxy::Create(
    TUniquePtr<FGeometryParticle>&& Particle)
{
    // 프록시 생성
    FSingleParticlePhysicsProxy* NewProxy = new FSingleParticlePhysicsProxy(
        MoveTemp(Particle));

    // 초기화
    NewProxy->Initialize();

    return NewProxy;
}

// 솔버에 프록시 등록
void RegisterProxyWithSolver(FSingleParticlePhysicsProxy* Proxy,
                             FPhysicsSolverBase* Solver)
{
    // 솔버에 프록시 추가
    Solver->RegisterObject(Proxy);

    // 파티클 핸들 생성
    FParticleHandle* Handle = Solver->CreateParticle();
    Proxy->SetHandle(Handle);
}
```

#### ❌ 소멸 과정

```cpp
// 프록시 소멸 과정
FSingleParticlePhysicsProxy::~FSingleParticlePhysicsProxy()
{
    // 물리 스레드에서 핸들 제거
    if (Handle)
    {
        if (auto* Solver = GetSolver())
        {
            Solver->DestroyParticle(Handle);
        }
    }

    // 게임 스레드 파티클 정리
    Particle.Reset();
    InterpolationData.Reset();
}
```

### 📊 FDirtyProxy 구조체 상세

```cpp
struct FDirtyProxy
{
    IPhysicsProxyBase* Proxy;           // 실제 물리 프록시 포인터
    FDirtyChaosProperties PropertyData; // 변경된 속성 데이터
    TArray<int32> ShapeDataIndices;     // 형상 데이터 인덱스들

    FDirtyProxy(IPhysicsProxyBase* InProxy)
        : Proxy(InProxy)
    {
    }

    void SetDirtyIdx(int32 Idx)
    {
        Proxy->SetDirtyIdx(Idx);
    }

    void AddShape(int32 ShapeDataIdx)
    {
        ShapeDataIndices.Add(ShapeDataIdx);
    }

    void Clear(FDirtyPropertiesManager& Manager, int32 DataIdx, FShapeDirtyData* ShapesData)
    {
        PropertyData.Clear(Manager, DataIdx);
        for(int32 ShapeDataIdx : ShapeDataIndices)
        {
            ShapesData[ShapeDataIdx].Clear(Manager, ShapeDataIdx);
        }
    }
};
```

> **핵심:** 변경된 속성만을 물리 스레드에 전달하여 성능 최적화 달성

**FDirtyProxy 역할:**
1. **컨테이너 역할**: 변경된 프록시와 그 속성 데이터를 묶어서 관리
2. **프록시 래퍼**: 실제 IPhysicsProxyBase 포인터를 담고 있음
3. **속성 데이터 관리**: FDirtyChaosProperties를 통해 실제 변경된 속성 정보 저장
4. **형상 데이터 추적**: ShapeDataIndices로 변경된 형상들의 인덱스 관리

#### 🔄 FDirtyProxy 사용 흐름

```cpp
// 1. 프록시가 변경되면 FDirtyProxy 생성
FDirtyProxy DirtyProxy(SomePhysicsProxy);

// 2. 변경된 형상 데이터 추가
DirtyProxy.AddShape(ShapeIndex);

// 3. PushToPhysicsState에서 사용
SomePhysicsProxy->PushToPhysicsState(Manager, DataIdx, DirtyProxy, ShapesData, ExternalDt);

// 4. 처리 완료 후 정리
DirtyProxy.Clear(Manager, DataIdx, ShapesData);
```

### 🎮 PhysicsProxy 실제 사용 예시

#### 🧱 기본 리지드 바디 생성

```cpp
void CreatePhysicsObject(UStaticMeshComponent* MeshComponent)
{
    // 1. 파티클 생성
    auto Particle = TUniquePtr<FGeometryParticle>(
        new FGeometryParticle());

    // 2. 프록시 생성
    FSingleParticlePhysicsProxy* Proxy =
        FSingleParticlePhysicsProxy::Create(MoveTemp(Particle));

    // 3. 솔버에 등록
    FPhysicsSolverBase* Solver = GetPhysicsSolver();
    Solver->RegisterObject(Proxy);

    // 4. 컴포넌트와 연결
    MeshComponent->SetPhysicsProxy(Proxy);
}
```

#### ✏️ 위치 업데이트

```cpp
void UpdatePhysicsObject(UPrimitiveComponent* Comp, const FVector& NewPosition)
{
    if (auto* Proxy = Comp->GetPhysicsProxy())
    {
        Proxy->GetGameThreadAPI().SetX(NewPosition);
        Proxy->MarkDirty(EPBDRigidParticleProperty::X);
    }
}
```

### ✅ PhysicsProxy 요약

| 항목 | 설명 |
|------|------|
| **역할** | 게임 ↔ 물리 스레드 간 물리 데이터 중계 |
| **동기화** | 더티 플래그 + 보간 처리 |
| **유형** | 리지드, 스켈레탈, 정적 메시 등 다양한 프록시 |
| **최적화** | 메모리 풀링, 속성 변화 추적 |
| **철학** | 관심사 분리 + 성능 중심 멀티스레딩 설계 |

### 🧠 설계 철학

- **관심사 분리**: 게임 로직과 물리 연산의 책임 분리
- **성능 중심**: Dirty flag + 최소 데이터 교환
- **확장 가능성**: 다양한 물리 객체 프록시 확장 가능

> 🔍 결과적으로, PhysicsProxy는 언리얼의 멀티스레드 물리 시스템에서의 **핵심 중개자**로서 설계되었으며, 복잡한 동기화와 생명주기 관리를 책임지는 핵심 컴포넌트입니다.

---

## 🔐 Scene Lock 시스템

### Lock 유형

**📂 위치:** `Engine/Source/Runtime/PhysicsCore/Public/ChaosSQTypes.h`

```cpp
// Scene Lock 매크로
#define CHAOS_SCENE_LOCK_READ      // 읽기 전용 접근
#define CHAOS_SCENE_LOCK_WRITE     // 읽기/쓰기 접근
#define CHAOS_SCENE_LOCK_NONE      // Lock 없음 (주의!)
```

### Lock 구현 세부사항

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FPhysScene_Chaos Lock 시스템                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐ │
│  │ RW Lock (기본)       │  │ Spinlock            │  │ Mutex              │ │
│  │                     │  │                     │  │                     │ │
│  │ 다수 Reader 허용     │  │ 짧은 대기 시간용    │  │ 긴 작업용          │ │
│  │ 단일 Writer 보장     │  │ 바쁜 대기 (spin)    │  │ 컨텍스트 스위칭    │ │
│  │                     │  │                     │  │                     │ │
│  │ 용도:               │  │ 용도:               │  │ 용도:               │ │
│  │ - 충돌 쿼리         │  │ - 카운터 증가       │  │ - 대규모 데이터    │ │
│  │ - 위치 읽기         │  │ - 플래그 설정       │  │   전송              │ │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘ │
│                                                                             │
│  사용 예시:                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ // Game Thread에서 충돌 쿼리                                         │   │
│  │ FPhysicsCommand_LineTraceSingle Command;                            │   │
│  │ Command.TraceChannel = ECC_Visibility;                              │   │
│  │                                                                     │   │
│  │ {                                                                   │   │
│  │     FPhysicsSceneReadLock Lock(Scene);  // RW Lock 획득             │   │
│  │     Scene->RaycastSingle(Start, End, Result);                       │   │
│  │ }  // Lock 자동 해제                                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Lock Scope Guard

```cpp
// RAII 패턴 Lock Guard
class FPhysicsSceneReadLock
{
public:
    FPhysicsSceneReadLock(FPhysScene_Chaos* InScene)
        : Scene(InScene)
    {
        Scene->ExternalDataLock.ReadLock();  // 진입 시 Lock 획득
    }

    ~FPhysicsSceneReadLock()
    {
        Scene->ExternalDataLock.ReadUnlock();  // 소멸 시 Lock 해제
    }

private:
    FPhysScene_Chaos* Scene;
};

// 사용 예시
void QueryPhysics()
{
    FPhysicsSceneReadLock Lock(PhysScene);  // Lock 획득
    // ... 물리 쿼리 수행 ...
}  // 스코프 종료 시 자동 해제
```

---

## 📡 Physics Thread Context

### FPhysicsThreadContext 클래스

**📂 위치:** `Engine/Source/Runtime/Experimental/Chaos/Public/Framework/Threading.h:169`

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FPhysicsThreadContext                                 │
│  (Physics Thread 전용 컨텍스트 - Thread Local Storage)                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Private:                                                                   │
│    - CurrentDeltaTime : FReal         // 현재 시뮬레이션 Dt                 │
│    - CurrentSimulationTime : FReal    // 누적 시뮬레이션 시간               │
│    - bIsPhysicsThread : bool          // Physics Thread 여부 플래그        │
│    - PendingCommands : TQueue<...>    // 대기 중인 명령 큐                  │
│                                                                             │
│  Public:                                                                    │
│    + GetCurrentDeltaTime() : FReal                                         │
│    + GetCurrentSimulationTime() : FReal                                    │
│    + IsInPhysicsThread() : bool       // 현재 스레드 확인                   │
│    + EnqueueCommand(Cmd)              // 명령 큐에 추가                     │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  TLS (Thread Local Storage) 구조:                                           │
│                                                                             │
│    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐       │
│    │ Game Thread     │    │ Physics Thread  │    │ Render Thread   │       │
│    │                 │    │                 │    │                 │       │
│    │ TLS: nullptr    │    │ TLS: Context*   │    │ TLS: nullptr    │       │
│    │                 │    │ (유일하게 유효) │    │                 │       │
│    └─────────────────┘    └─────────────────┘    └─────────────────┘       │
│                                                                             │
│  → Physics Thread에서만 Context 접근 가능                                   │
│  → 다른 스레드에서 접근 시 nullptr 반환                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 스레드 확인 유틸리티

```cpp
// Threading.h:280
FORCEINLINE bool IsInPhysicsThreadContext()
{
    return FPhysicsThreadContext::Get().IsInPhysicsSimContext();
}

// 사용 예시
void MyPhysicsOperation()
{
    if (Chaos::IsInPhysicsThreadContext())
    {
        // Physics Thread에서 직접 실행
        DirectModifyParticle();
    }
    else
    {
        // Game Thread에서 명령 큐에 추가
        EnqueuePhysicsCommand([](){ DirectModifyParticle(); });
    }
}
```

---

## 🔄 통신 패턴

### 1. Producer-Consumer 패턴

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Producer-Consumer Pattern                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  GAME THREAD (Producer)              PHYSICS THREAD (Consumer)              │
│  ┌──────────────────────┐            ┌──────────────────────┐              │
│  │                      │            │                      │              │
│  │  CreateCommand()     │            │  ProcessCommands()   │              │
│  │       │              │            │       │              │              │
│  │       ↓              │            │       ↓              │              │
│  │  ┌────────────┐      │            │  ┌────────────┐      │              │
│  │  │ Validate   │      │            │  │ Dequeue    │      │              │
│  │  │ Command    │      │            │  │ Command    │      │              │
│  │  └─────┬──────┘      │            │  └─────┬──────┘      │              │
│  │        │             │            │        │             │              │
│  │        ↓             │            │        ↓             │              │
│  │  ┌────────────┐      │            │  ┌────────────┐      │              │
│  │  │ Enqueue    │──────┼──Thread────┼─→│ Execute    │      │              │
│  │  │ to Queue   │      │   Safe     │  │ Command    │      │              │
│  │  └────────────┘      │   Queue    │  └────────────┘      │              │
│  │                      │            │                      │              │
│  └──────────────────────┘            └──────────────────────┘              │
│                                                                             │
│  장점:                                                                      │
│  - Game Thread는 블로킹 없이 계속 실행                                      │
│  - Physics Thread는 자신의 페이스로 처리                                    │
│  - 명령 순서 보장                                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2. Double Buffering 패턴

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Double Buffering Pattern                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Frame N:                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                                                                      │  │
│  │  Buffer A (Front)                  Buffer B (Back)                   │  │
│  │  ┌─────────────────┐               ┌─────────────────┐               │  │
│  │  │                 │               │                 │               │  │
│  │  │ Game Thread     │               │ Physics Thread  │               │  │
│  │  │ READ            │               │ WRITE           │               │  │
│  │  │                 │               │                 │               │  │
│  │  │ (이전 프레임    │               │ (현재 프레임    │               │  │
│  │  │  결과 읽기)     │               │  시뮬레이션)    │               │  │
│  │  │                 │               │                 │               │  │
│  │  └─────────────────┘               └─────────────────┘               │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│                              ↓ SWAP                                         │
│                                                                             │
│  Frame N+1:                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                                                                      │  │
│  │  Buffer B (Front)                  Buffer A (Back)                   │  │
│  │  ┌─────────────────┐               ┌─────────────────┐               │  │
│  │  │                 │               │                 │               │  │
│  │  │ Game Thread     │               │ Physics Thread  │               │  │
│  │  │ READ            │               │ WRITE           │               │  │
│  │  │                 │               │                 │               │  │
│  │  └─────────────────┘               └─────────────────┘               │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  핵심:                                                                      │
│  - 한 버퍼를 읽는 동안 다른 버퍼에 쓰기                                     │
│  - Lock 없이 동시 접근 가능                                                 │
│  - 1프레임 지연 발생 (Trade-off)                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3. Physics Proxy 패턴

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Physics Proxy Pattern                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  GAME THREAD                                   PHYSICS THREAD               │
│  ┌────────────────────────┐                    ┌────────────────────────┐  │
│  │                        │                    │                        │  │
│  │  UPrimitiveComponent   │                    │  FPBDRigidParticle     │  │
│  │  (게임 로직 객체)      │                    │  (물리 시뮬레이션 객체)│  │
│  │                        │                    │                        │  │
│  │  - Transform           │                    │  - X (Position)        │  │
│  │  - Velocity (캐시)     │                    │  - V (Velocity)        │  │
│  │  - 게임 상태           │                    │  - R (Rotation)        │  │
│  │                        │                    │  - W (Angular Vel)     │  │
│  └───────────┬────────────┘                    └───────────┬────────────┘  │
│              │                                             │               │
│              │         FSingleParticlePhysicsProxy         │               │
│              │     ┌───────────────────────────────┐       │               │
│              │     │                               │       │               │
│              └────→│  Game Thread Data             │←──────┘               │
│                    │  - CachedPosition            │                        │
│                    │  - CachedVelocity            │                        │
│                    │                               │                        │
│                    │  Physics Thread Data          │                        │
│                    │  - ParticleHandle*           │                        │
│                    │  - PendingCommands           │                        │
│                    │                               │                        │
│                    │  Methods:                     │                        │
│                    │  - SetX_External() ──────────┼→ 명령 큐에 추가        │
│                    │  - GetX_External() ←─────────┼── 캐시에서 읽기        │
│                    │  - PushToPhysicsState()     │                        │
│                    │  - PullFromPhysicsState()   │                        │
│                    │                               │                        │
│                    └───────────────────────────────┘                        │
│                                                                             │
│  데이터 흐름:                                                               │
│                                                                             │
│  Game → Physics:                                                            │
│    SetLinearVelocity_External(V)                                           │
│      → PendingCommands.Add(SetV(V))                                        │
│      → Physics Thread에서 Particle.V = V 실행                              │
│                                                                             │
│  Physics → Game:                                                            │
│    Physics Thread: PullFromPhysicsState()                                  │
│      → CachedPosition = Particle.X                                         │
│    Game Thread: GetPosition()                                               │
│      → return CachedPosition                                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4. Command 패턴 상세

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Command Pattern Details                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  명령 타입:                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ enum class EPhysicsCommandType                                       │   │
│  │ {                                                                    │   │
│  │     SetPosition,           // 위치 설정                              │   │
│  │     SetRotation,           // 회전 설정                              │   │
│  │     SetLinearVelocity,     // 선속도 설정                            │   │
│  │     SetAngularVelocity,    // 각속도 설정                            │   │
│  │     AddForce,              // 힘 추가                                │   │
│  │     AddImpulse,            // 충격량 추가                            │   │
│  │     SetKinematicTarget,    // Kinematic 타겟 설정                    │   │
│  │     WakeUp,                // Sleep 해제                             │   │
│  │     PutToSleep,            // Sleep 상태로                           │   │
│  │     // ...                                                           │   │
│  │ };                                                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  명령 실행 순서 보장:                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │  Game Thread (Frame N)           Physics Thread                     │   │
│  │                                                                     │   │
│  │  [1] SetPosition(P1)  ─────┐                                       │   │
│  │  [2] AddForce(F1)     ─────┼──→  처리 순서:                         │   │
│  │  [3] SetVelocity(V1)  ─────┘      [1] → [2] → [3]                  │   │
│  │                                    (FIFO 순서 보장)                  │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🎮 실전 코드 예시

### Game Thread에서 물리 조작

```cpp
// UDXActionTask_SimulatePhysicsAndAddImpulse 예시
void UDXActionTask_SimulatePhysicsAndAddImpulse::ApplyImpulseToTarget()
{
    // 1. Component 획득
    UPrimitiveComponent* TargetComponent = GetTargetComponent();
    if (!TargetComponent)
    {
        return;
    }

    // 2. Physics Body 확인
    FBodyInstance* BodyInstance = TargetComponent->GetBodyInstance();
    if (!BodyInstance || !BodyInstance->IsValidBodyInstance())
    {
        return;
    }

    // 3. 물리 시뮬레이션 활성화
    // → 내부적으로 Proxy를 통해 Physics Thread에 명령 전달
    TargetComponent->SetSimulatePhysics(true);

    // 4. Impulse 적용
    // → FSingleParticlePhysicsProxy::AddImpulse_External() 호출
    // → Physics Thread 명령 큐에 추가됨
    FVector ImpulseDirection = CalculateImpulseDirection();
    float ImpulseMagnitude = CalculateImpulseMagnitude();

    TargetComponent->AddImpulse(
        ImpulseDirection * ImpulseMagnitude,
        NAME_None,
        true  // bVelChange: true면 질량 무시
    );

    // 참고: 이 시점에서 Physics Thread는 아직 Impulse를 적용하지 않았음
    // 실제 적용은 다음 Physics Tick에서 수행됨
}
```

### 내부 동작 시퀀스

```
    Game Thread              Proxy                    Physics Thread
         │                     │                            │
    [1] AddImpulse()           │                            │
         │                     │                            │
         ├──────────────────→ [2] AddImpulse_External()     │
         │                     │                            │
         │                     ├─ Validate Parameters       │
         │                     │                            │
         │                     ├─ Create Command            │
         │                     │  {Type: AddImpulse,        │
         │                     │   Impulse: FVector,        │
         │                     │   bVelChange: bool}        │
         │                     │                            │
         │                     ├─ [3] Enqueue(Command) ────→│
         │                     │      (Thread-Safe)         │
         │                     │                            │
    [Return immediately]       │                            │
         │                     │                            │
         │                     │                     [4] Physics Tick
         │                     │                            │
         │                     │                     [5] ProcessCommands()
         │                     │                            │
         │                     │                     [6] Execute AddImpulse
         │                     │                        Particle.V += Impulse/Mass
         │                     │                            │
         │                     │                     [7] Simulate Step
         │                     │                            │
         │                     │                     [8] Write Results
         │                     │                            │
         │              [9] PullFromPhysics() ←─────────────┤
         │                     │                            │
    [10] GetVelocity()         │                            │
         │                     │                            │
         ├──────────────────→ [11] Return Cached Value     │
         │                     │                            │
    [새 속도 반영됨]           │                            │
```

---

## ⚡ 성능 최적화

### Work Stealing

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Work Stealing Pattern                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  기존 방식 (정적 분배):                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                       │
│  │ Thread 0 │ │ Thread 1 │ │ Thread 2 │ │ Thread 3 │                       │
│  │ [Island] │ │ [Island] │ │ [Island] │ │ [Island] │                       │
│  │ [Island] │ │ [Island] │ │          │ │          │                       │
│  │ [Island] │ │          │ │   IDLE   │ │   IDLE   │  ← 불균형!            │
│  │ [Island] │ │          │ │          │ │          │                       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                       │
│                                                                             │
│  Work Stealing (동적 분배):                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                       │
│  │ Thread 0 │ │ Thread 1 │ │ Thread 2 │ │ Thread 3 │                       │
│  │ [Island] │ │ [Island] │ │ [Island] │ │ [Island] │                       │
│  │ [Island] │→│←[steal!] │ │ [Island] │ │ [Island] │                       │
│  │          │ │ [Island] │ │ [Island] │ │ [Island] │  ← 균형!              │
│  │          │ │          │ │          │ │          │                       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                       │
│                                                                             │
│  구현:                                                                      │
│  - 각 Thread는 자신의 Work Queue 보유                                       │
│  - 자신의 Queue가 비면 다른 Thread의 Queue에서 훔쳐옴                       │
│  - Lock-free deque 사용 (양쪽에서 접근 가능)                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### SIMD 최적화

```cpp
// SOA (Structure of Arrays) 레이아웃
class FParticleSOA
{
    // SIMD 친화적 구조
    alignas(16) TArray<float> PositionX;  // [x0, x1, x2, x3, ...]
    alignas(16) TArray<float> PositionY;  // [y0, y1, y2, y3, ...]
    alignas(16) TArray<float> PositionZ;  // [z0, z1, z2, z3, ...]

    alignas(16) TArray<float> VelocityX;
    alignas(16) TArray<float> VelocityY;
    alignas(16) TArray<float> VelocityZ;
};

// SIMD를 활용한 Integration
void IntegrateSIMD(FParticleSOA& Particles, float Dt)
{
    const int32 NumParticles = Particles.Num();
    const int32 NumVectors = NumParticles / 4;  // 4개씩 처리

    const VectorRegister VDt = VectorSetFloat1(Dt);

    for (int32 i = 0; i < NumVectors; ++i)
    {
        // 4개 파티클 동시 처리
        VectorRegister Vx = VectorLoad(&Particles.VelocityX[i * 4]);
        VectorRegister Px = VectorLoad(&Particles.PositionX[i * 4]);

        // P = P + V * Dt (4개 동시)
        Px = VectorMultiplyAdd(Vx, VDt, Px);

        VectorStore(&Particles.PositionX[i * 4], Px);
    }
}
```

### Cache-Friendly 데이터 레이아웃

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Cache-Friendly Layout                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ❌ AoS (Array of Structures) - 캐시 비효율                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [P0.x P0.y P0.z V0.x V0.y V0.z M0] [P1.x P1.y P1.z V1.x V1.y V1.z M1]│   │
│  │  ↑─────── 캐시 라인 ─────↑                                           │   │
│  │  Position만 접근해도 Velocity, Mass까지 캐시에 로드됨                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ✅ SoA (Structure of Arrays) - 캐시 효율적                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Positions: [P0.x P0.y P0.z P1.x P1.y P1.z P2.x P2.y P2.z ...]      │   │
│  │             ↑─────── 캐시 라인 ─────↑                                │   │
│  │                                                                     │   │
│  │ Velocities: [V0.x V0.y V0.z V1.x V1.y V1.z ...]                    │   │
│  │                                                                     │   │
│  │ Masses: [M0 M1 M2 M3 ...]                                          │   │
│  │                                                                     │   │
│  │ Position 순회 시 캐시 효율 극대화                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  성능 차이:                                                                 │
│  - Position Integration: SoA ~2-3x 빠름                                    │
│  - Collision Detection: SoA ~1.5-2x 빠름                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 PhysX vs Chaos 비교

| 특성 | PhysX (UE4) | Chaos (UE5) |
|------|-------------|-------------|
| **스레딩 모델** | Task-based (PPL) | Dedicated Physics Thread |
| **동기화** | Scene Lock | Proxy + Command Queue |
| **데이터 레이아웃** | AoS | SoA (SIMD 최적화) |
| **버퍼링** | Single Buffer + Lock | Double Buffer |
| **Determinism** | 제한적 지원 | 완전 지원 (Network Prediction) |
| **병렬화** | Island-based | Island-based + Work Stealing |
| **지연** | 낮음 (동기) | 1프레임 (비동기) |
| **확장성** | 중간 | 높음 |

---

## 🐛 일반적인 함정

### ❌ Physics Thread에서 Game 객체 직접 접근

```cpp
// ❌ 위험: Physics Thread에서 UObject 접근
void FMyPhysicsCallback::OnPhysicsStep()
{
    AActor* Actor = GetOwnerActor();  // 크래시 위험!
    Actor->DoSomething();
}

// ✅ 안전: 필요한 데이터만 캐시
void FMyPhysicsCallback::CacheData()
{
    // Game Thread에서 호출
    CachedTransform = GetOwnerActor()->GetActorTransform();
}

void FMyPhysicsCallback::OnPhysicsStep()
{
    // Physics Thread에서 캐시된 데이터 사용
    FTransform Transform = CachedTransform;  // 안전
}
```

### ❌ Lock 범위를 너무 넓게 설정

```cpp
// ❌ 비효율: Lock 범위가 너무 넓음
void ProcessAllBodies()
{
    FPhysicsSceneWriteLock Lock(Scene);  // 여기서 Lock

    for (int32 i = 0; i < 1000; ++i)
    {
        // 오래 걸리는 작업...
        ProcessBody(i);  // 다른 스레드 전부 블로킹!
    }
}  // 여기서 해제

// ✅ 효율적: Lock 범위 최소화
void ProcessAllBodies()
{
    TArray<FBodyData> CachedData;

    {
        FPhysicsSceneReadLock Lock(Scene);  // 짧은 Lock
        CachedData = GatherBodyData();
    }  // 즉시 해제

    // Lock 없이 처리
    for (const FBodyData& Data : CachedData)
    {
        ProcessBody(Data);
    }
}
```

### ❌ 동기화 시점 오해

```cpp
// ❌ 오해: Impulse가 즉시 적용된다고 가정
void LaunchProjectile()
{
    Projectile->AddImpulse(LaunchVelocity);

    // 이 시점에서 속도는 아직 변경되지 않음!
    FVector Velocity = Projectile->GetPhysicsLinearVelocity();
    // Velocity는 이전 값 (1프레임 지연)

    UE_LOG(LogTemp, Warning, TEXT("Velocity: %s"), *Velocity.ToString());
}

// ✅ 올바른 이해: 다음 프레임에 반영됨
void LaunchProjectile()
{
    Projectile->AddImpulse(LaunchVelocity);

    // 예상 속도 직접 계산
    FVector ExpectedVelocity = LaunchVelocity / Projectile->GetMass();
    UE_LOG(LogTemp, Warning, TEXT("Expected Velocity: %s"), *ExpectedVelocity.ToString());
}
```

---

## 🔍 디버깅

### Console Commands

```bash
# Physics Thread 상태 확인
stat Physics
stat PhysicsVerbose

# Thread 타이밍 분석
stat Threading

# 명령 큐 모니터링
p.Chaos.DebugDraw.ShowPendingCommands 1

# Lock 경합 분석
stat LockContention
```

### 성능 프로파일링

| Stat | 정상 범위 | 경고 |
|------|----------|------|
| Physics Thread Time | < 8ms | > 12ms |
| Command Queue Size | < 100 | > 500 |
| Lock Wait Time | < 0.5ms | > 2ms |
| Buffer Swap Time | < 0.1ms | > 0.5ms |

---

## 📚 관련 문서

**내부 문서:**
- [Chaos_Solver_Deep_Dive.md](./Chaos_Solver_Deep_Dive.md) - PBD Solver 상세
- [Chaos_Physics_Solver_And_Constraints_Deep_Dive.md](./Chaos_Physics_Solver_And_Constraints_Deep_Dive.md) - Constraint 시스템

**소스 파일:**
- `Engine/Source/Runtime/Experimental/Chaos/Public/PhysicsProxy/SingleParticlePhysicsProxy.h`
- `Engine/Source/Runtime/Experimental/Chaos/Public/PBDRigidsSolver.h`
- `Engine/Source/Runtime/PhysicsCore/Public/ChaosSQTypes.h`

---

## 📝 버전 이력

- **v1.4** (2025-12-09): FChaosMarshallingManager 상세 분석 추가
  - 명령 큐(Command Queue) 시스템 및 MPSC 큐 구조
  - 더블 버퍼링 메커니즘 상세 설명 및 다이어그램
  - 비동기 TaskGraph 처리 통합
  - 메모리 최적화 (청크 기반 관리, 풀링)
  - 게임 코드에서의 사용 예시
- **v1.3** (2025-12-09): FPBDRigidsEvolutionGBF 인스턴스 관리 추가
  - UWorld당 하나의 Evolution 인스턴스 구조
  - UWorld → FPhysScene_Chaos → FChaosScene → FPBDRigidsSolver → Evolution 계층
  - 멀티 월드 환경 (GameWorld, PIEWorld, PreviewWorld) 독립 시뮬레이션
  - 스레드 구조 및 AdvanceOneTimeStep 동작 순서
- **v1.2** (2025-12-09): PhysicsProxy 시스템 상세 추가
  - IPhysicsProxyBase / TPhysicsProxy 계층 구조
  - Push/Pull 동기화 흐름 (PushToPhysicsState, PullFromPhysicsState)
  - PhysicsProxy 타입별 비교 (SingleParticle, GeometryCollection, SkeletalMesh, StaticMesh)
  - 프록시 생성/등록/소멸 과정
  - FDirtyProxy 구조체 상세 및 사용 흐름
  - 실제 사용 예시 및 설계 철학
- **v1.1** (2025-12-08): 핵심 클래스 추가
  - FPBDRigidsSolver, FChaosMarshallingManager, FPBDRigidsEvolutionGBF 상세
  - Push/Pull 데이터 흐름 시각화
  - 최적화 기술 (더티 플래그, 서브스테핑, 메모리 풀링)
- **v1.0** (2025-12-05): 초기 작성
  - Game Thread ↔ Physics Thread 통신 아키텍처
  - Scene Lock 시스템
  - Producer-Consumer, Double Buffering, Proxy 패턴
  - 성능 최적화 (Work Stealing, SIMD, Cache-Friendly)
  - PhysX vs Chaos 비교