---
title: "System and Emitter Lifecycle (시스템 및 에미터 생명주기)"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# System and Emitter Lifecycle (시스템 및 에미터 생명주기)

## 🧭 개요

Niagara System과 Emitter의 **생명주기 관리**는 초기화부터 종료까지의 전체 상태 전환을 담당합니다.

**핵심 역할:**
- System/Emitter Instance 생성 및 초기화
- 상태 전환 (PendingSpawn → Active → Complete → Disabled)
- Activation/Deactivation/Reset 관리
- Pooling을 통한 재사용

**📂 주요 위치:**
- `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraSystemInstance.h`
- `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEmitterInstance.h`
- `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraTypes.h`

---

## 🧱 생명주기 상태 다이어그램

```
┌──────────────────────────────────────────────────────────────────────┐
│             System Instance Lifecycle States                         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  [None]                                                              │
│    │                                                                 │
│    │ Constructor()                                                   │
│    ↓                                                                 │
│  [Constructed]                                                       │
│    │                                                                 │
│    │ Init()                                                          │
│    ↓                                                                 │
│  [PendingSpawn / PendingSpawnPaused]                                │
│    │                                                                 │
│    │ Tick() - First Frame                                           │
│    ↓                                                                 │
│  [Active / Paused]                                                   │
│    │                                                                 │
│    │ Tick() - N Frames                                              │
│    │                                                                 │
│    │ All Emitters Complete? OR Deactivate() Called                  │
│    ↓                                                                 │
│  [Complete]                                                          │
│    │                                                                 │
│    │ Cleanup() OR Activate(ResetAll)                                │
│    ↓              ↓                                                  │
│  [Destroyed]    [PendingSpawn] (Reactivation)                       │
│                                                                      │
│  Additional States:                                                  │
│    [Disabled] - Cannot be activated (Invalid asset, error)          │
│    [Paused] - Active but not ticking                                │
│    [PendingSpawnPaused] - Waiting for activation in paused state    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 🔧 계층별 상세 분석

### 1. **ENiagaraExecutionState - 실행 상태 Enum**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraTypes.h`

**실행 상태 정의:**
```cpp
enum class ENiagaraExecutionState : uint32
{
    /** 활성 상태, 정상적으로 실행 중 */
    Active,

    /** 비활성 상태, 아직 활성화 안됨 */
    Inactive,

    /** 비활성 상태로 전환 중 (모든 파티클 kill 대기) */
    InactiveClear,

    /** 완료 상태, 더 이상 실행하지 않음 */
    Complete,

    /** 비활성화됨, 재활성화 불가 (에러 등) */
    Disabled,

    Num UMETA(Hidden)
};
```

**상태 전환 조건:**
```cpp
Inactive → Active:
  - Activate() 호출
  - 첫 Spawn 실행

Active → InactiveClear:
  - Deactivate(bImmediate=false) 호출
  - 기존 파티클 kill 대기

Active → Complete:
  - Deactivate(bImmediate=true) 호출
  - 모든 Emitter가 Complete
  - System LoopBehavior가 Once이고 완료

InactiveClear → Complete:
  - 모든 파티클 Kill 완료

Complete → Active:
  - Activate(ResetAll) 호출로 재시작

Any → Disabled:
  - 치명적 에러 발생
  - Asset이 Invalid
```

---

### 2. **FNiagaraSystemInstance - System Instance 생명주기**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraSystemInstance.h:78`

**핵심 구조:**
```cpp
class FNiagaraSystemInstance
{
public:
    /** System Instance 상태 */
    ENiagaraSystemInstanceState SystemInstanceState = ENiagaraSystemInstanceState::None;

    /** 요청된 실행 상태 (User 요청) */
    ENiagaraExecutionState RequestedExecutionState;

    /** 실제 실행 상태 (Tick 후 반영) */
    ENiagaraExecutionState ActualExecutionState;

    /** Reset 모드 */
    enum class EResetMode : uint8
    {
        ResetAll,       // 전체 리셋 (파티클 kill + state 초기화)
        ResetSystem,    // System만 리셋 (파티클 유지)
        ReInit,         // 완전 재초기화
        None
    };

    /** 생성자 */
    FNiagaraSystemInstance(
        UWorld& InWorld,
        UNiagaraSystem& InAsset,
        FNiagaraUserRedirectionParameterStore* InOverrideParameters,
        USceneComponent* InAttachComponent,
        ENiagaraTickBehavior InTickBehavior,
        bool bInPooled
    );

    /** 초기화 */
    void Init(bool bInForceSolo = false);

    /** 활성화 */
    void Activate(EResetMode InResetMode = EResetMode::ResetAll);

    /** 비활성화 */
    void Deactivate(bool bImmediate = false);

    /** 완료 처리 */
    void Complete(bool bExternalCompletion);

    /** 정리 */
    void Cleanup();

    /** Pooling 재사용 */
    void OnPooledReuse(UWorld& NewWorld);
};
```

**SystemInstanceState Enum:**
```cpp
enum class ENiagaraSystemInstanceState : uint8
{
    None,                   // 미초기화
    PendingSpawn,           // Spawn 대기 중
    PendingSpawnPaused,     // Pause 상태로 Spawn 대기
    Spawning,               // Spawn 실행 중 (첫 Tick)
    Running,                // 정상 실행 중
    Paused,                 // 일시 정지
    Complete,               // 완료
    Num
};
```

---

### 3. **System Lifecycle 상세 플로우**

**Construction (생성):**
```cpp
// UNiagaraComponent::ActivateSystem()
FNiagaraSystemInstancePtr SystemInstance = MakeShared<FNiagaraSystemInstance>(
    *GetWorld(),
    *Asset,
    OverrideParameters,
    AttachComponent,
    TickBehavior,
    bPooled
);

// Constructor에서:
// - World, System Asset 저장
// - InstanceParameters 초기화
// - SystemInstanceState = None
// - RequestedExecutionState = Inactive
// - ActualExecutionState = Inactive
```

**Initialization (초기화):**
```cpp
void FNiagaraSystemInstance::Init(bool bInForceSolo)
{
    // 1. System Simulation 찾기/생성
    SystemSimulation = WorldManager->GetSystemSimulation(System);

    // 2. Emitter Instance 생성
    for (const FNiagaraEmitterHandle& EmitterHandle : System->GetEmitterHandles())
    {
        FNiagaraEmitterInstancePtr EmitterInstance = MakeShared<FNiagaraEmitterInstanceImpl>(this);
        EmitterInstance->Init(EmitterIndex);
        Emitters.Add(EmitterInstance);
    }

    // 3. Parameter Store 초기화
    SystemParameters.InitFromSystem(System);
    InstanceParameters.InitFromSystem(System);

    // 4. DataInterface 초기화
    InitDataInterfaces();

    // 5. Bounding Box 초기화
    CalculateBounds();

    // 6. 상태 변경
    SystemInstanceState = ENiagaraSystemInstanceState::PendingSpawn;

#if WITH_EDITOR
    OnInitialized().Broadcast();
#endif
}
```

**Activation (활성화):**
```cpp
void FNiagaraSystemInstance::Activate(EResetMode InResetMode)
{
    // 이미 활성 상태면 Reset만 수행
    if (IsActive())
    {
        Reset(InResetMode);
        return;
    }

    // 1. Async Work 대기 중이면 나중에 처리
    if (HasPendingFinalize())
    {
        DeferredResetMode = InResetMode;
        return;
    }

    // 2. Reset 수행
    Reset(InResetMode);

    // 3. 상태 변경
    if (IsPaused())
    {
        SystemInstanceState = ENiagaraSystemInstanceState::PendingSpawnPaused;
    }
    else
    {
        SystemInstanceState = ENiagaraSystemInstanceState::PendingSpawn;
    }

    // 4. 실행 상태 설정
    SetRequestedExecutionState(ENiagaraExecutionState::Active);

    // 5. System Simulation에 등록
    if (!SystemSimulation->GetSystemInstances().Contains(this))
    {
        SystemSimulation->AddInstance(this);
    }
}
```

**Reset (리셋):**
```cpp
void FNiagaraSystemInstance::Reset(EResetMode Mode)
{
    switch (Mode)
    {
    case EResetMode::ResetAll:
        // 1. Emitter Reset (파티클 Kill)
        for (FNiagaraEmitterInstanceRef& Emitter : Emitters)
        {
            Emitter->ResetSimulation(/*bKillExisting=*/true);
        }

        // 2. Age/TickCount 초기화
        Age = 0.0f;
        TickCount = 0;

        // 3. Random Seed 리셋
        ResetRandomSeedForInstance();

        // 4. DataInterface Reset
        ResetDataInterfaces();
        break;

    case EResetMode::ResetSystem:
        // System만 리셋, 파티클 유지
        Age = 0.0f;
        TickCount = 0;
        break;

    case EResetMode::ReInit:
        // 완전 재초기화
        Cleanup();
        Init(bSolo);
        break;
    }

#if WITH_EDITOR
    OnReset().Broadcast();
#endif
}
```

**Deactivation (비활성화):**
```cpp
void FNiagaraSystemInstance::Deactivate(bool bImmediate)
{
    if (bImmediate)
    {
        // 즉시 종료: 모든 파티클 Kill
        SetRequestedExecutionState(ENiagaraExecutionState::Complete);

        for (FNiagaraEmitterInstanceRef& Emitter : Emitters)
        {
            Emitter->ResetSimulation(/*bKillExisting=*/true);
        }
    }
    else
    {
        // Graceful 종료: 기존 파티클 유지, 새 Spawn 중지
        SetRequestedExecutionState(ENiagaraExecutionState::InactiveClear);
    }
}
```

**Completion (완료):**
```cpp
void FNiagaraSystemInstance::Complete(bool bExternalCompletion)
{
    // 1. 실행 상태 변경
    SetActualExecutionState(ENiagaraExecutionState::Complete);
    SystemInstanceState = ENiagaraSystemInstanceState::Complete;

    // 2. Emitter 완료
    for (FNiagaraEmitterInstanceRef& Emitter : Emitters)
    {
        Emitter->HandleCompletion(/*bForce=*/true);
    }

    // 3. Parameter Unbind
    UnbindParameters(/*bFromComplete=*/true);

    // 4. System Simulation에서 제거
    if (SystemSimulation.IsValid())
    {
        SystemSimulation->RemoveInstance(this);
    }

    // 5. Callback 호출
    if (OnCompleteDelegate.IsBound())
    {
        OnCompleteDelegate.Execute(bExternalCompletion);
    }

    // 6. Component Cleanup (if not pooled)
    if (!bPooled)
    {
        Cleanup();
    }
}
```

**Cleanup (정리):**
```cpp
void FNiagaraSystemInstance::Cleanup()
{
    // 1. Emitter Cleanup
    for (FNiagaraEmitterInstanceRef& Emitter : Emitters)
    {
        Emitter.Reset();
    }
    Emitters.Empty();

    // 2. DataInterface Cleanup
    for (TPair<TWeakObjectPtr<UNiagaraDataInterface>, int32>& Pair : DataInterfaceInstanceDataOffsets)
    {
        UNiagaraDataInterface* DI = Pair.Key.Get();
        void* InstanceData = &DataInterfaceInstanceData[Pair.Value];
        if (DI && InstanceData)
        {
            DI->DestroyPerInstanceData(InstanceData, this);
        }
    }
    DataInterfaceInstanceData.Empty();
    DataInterfaceInstanceDataOffsets.Empty();

    // 3. Parameter Store Cleanup
    InstanceParameters.Empty();
    SystemParameters.Empty();

    // 4. 상태 초기화
    SystemInstanceState = ENiagaraSystemInstanceState::None;
    SetActualExecutionState(ENiagaraExecutionState::Disabled);

#if WITH_EDITOR
    OnDestroyed().Broadcast();
#endif
}
```

---

### 4. **FNiagaraEmitterInstance - Emitter Instance 생명주기**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEmitterInstance.h:24`

**핵심 구조:**
```cpp
class FNiagaraEmitterInstance
{
public:
    /** Emitter 실행 상태 */
    ENiagaraExecutionState ExecutionState = ENiagaraExecutionState::Active;

    /** 초기화 */
    virtual void Init(int32 InEmitterIdx);

    /** Simulation 리셋 */
    virtual void ResetSimulation(bool bKillExisting = true) = 0;

    /** Enable/Disable */
    virtual void SetEmitterEnable(bool bNewEnableState) = 0;

    /** Pooling 재사용 */
    virtual void OnPooledReuse() = 0;

    /** 완료 처리 */
    virtual bool HandleCompletion(bool bForce = false) = 0;

    /** Tick */
    virtual void Tick(float DeltaSeconds) = 0;

protected:
    FNiagaraSystemInstance* ParentSystemInstance;
    FNiagaraDataSet* ParticleDataSet;
    ENiagaraExecutionState ExecutionState;
};
```

**Emitter Lifecycle 플로우:**
```cpp
// Initialization:
void FNiagaraEmitterInstance::Init(int32 InEmitterIdx)
{
    EmitterIndex = InEmitterIdx;

    // 1. Emitter Asset 캐싱
    VersionedEmitter = ParentSystemInstance->GetSystem()->GetEmitterHandle(EmitterIndex).GetInstance();

    // 2. DataSet 생성
    ParticleDataSet = &ParentSystemInstance->GetEmitterDataSet(EmitterIndex);

    // 3. Script Execution Context 초기화
    SpawnExecContext.Init(ParentSystemInstance, SpawnScript, ENiagaraSimTarget::CPUSim);
    UpdateExecContext.Init(ParentSystemInstance, UpdateScript, ENiagaraSimTarget::CPUSim);

    // 4. Renderer 초기화
    for (UNiagaraRendererProperties* Renderer : GetRenderers())
    {
        if (Renderer)
        {
            Renderer->Initialize(this);
        }
    }

    // 5. 상태 설정
    ExecutionState = ENiagaraExecutionState::Active;
}

// Reset:
void FNiagaraEmitterInstance::ResetSimulation(bool bKillExisting)
{
    if (bKillExisting)
    {
        // 모든 파티클 Kill
        ParticleDataSet->ResetBuffers();
        TotalSpawnedParticles = 0;
    }

    // Age 리셋
    EmitterAge = 0.0f;

    // SpawnInfo 초기화
    SpawnInfos.Empty();
}

// Completion:
bool FNiagaraEmitterInstance::HandleCompletion(bool bForce)
{
    // 1. 이미 Complete 상태면 리턴
    if (ExecutionState == ENiagaraExecutionState::Complete)
    {
        return true;
    }

    // 2. 강제 종료 또는 자연스러운 완료
    if (bForce || ShouldComplete())
    {
        ExecutionState = ENiagaraExecutionState::Complete;

        // 3. 파티클 Kill
        ParticleDataSet->ResetBuffers();

        return true;
    }

    return false;
}

bool FNiagaraEmitterInstance::ShouldComplete() const
{
    // Emitter 완료 조건:
    // - LoopBehavior가 Once이고 Lifetime 초과
    // - ExecutionState가 InactiveClear이고 파티클 0개
    // - Emitter가 Disabled

    if (ExecutionState == ENiagaraExecutionState::Disabled)
    {
        return true;
    }

    if (ExecutionState == ENiagaraExecutionState::InactiveClear)
    {
        return GetNumParticles() == 0;
    }

    if (VersionedEmitter.GetEmitterData()->CalculateBoundsMode == ENiagaraEmitterCalculateBoundMode::Fixed)
    {
        // Fixed Bounds는 Loop 조건만 체크
        return false;
    }

    return EmitterAge >= GetMaxLifetime() && GetNumParticles() == 0;
}
```

---

## 💡 실전 예시

### 예시 1: Component에서 System 생성 및 활성화

**Blueprint Component Setup:**
```cpp
// C++ Component
UCLASS()
class AMyActor : public AActor
{
    GENERATED_BODY()

    UPROPERTY(VisibleAnywhere)
    UNiagaraComponent* NiagaraComp;

    virtual void BeginPlay() override
    {
        Super::BeginPlay();

        // Component Auto-Activate
        // → FNiagaraSystemInstance 생성
        // → Init() 호출
        // → Activate(ResetAll) 호출
    }
};
```

**Internal Sequence:**
```cpp
// UNiagaraComponent::Activate()
void UNiagaraComponent::Activate(bool bReset)
{
    if (!SystemInstance.IsValid())
    {
        // 1. System Instance 생성
        SystemInstance = MakeShared<FNiagaraSystemInstance>(
            *GetWorld(),
            *Asset,
            OverrideParameters,
            this,
            TickBehavior,
            /*bPooled=*/false
        );

        // 2. 초기화
        SystemInstance->Init();
    }

    // 3. 활성화
    if (bReset)
    {
        SystemInstance->Activate(FNiagaraSystemInstance::EResetMode::ResetAll);
    }
    else
    {
        SystemInstance->Activate(FNiagaraSystemInstance::EResetMode::None);
    }
}
```

---

### 예시 2: Loop System vs One-Shot System

**Loop System (Infinite):**
```cpp
// System Asset Settings:
// - LoopBehavior = Infinite
// - LoopDuration = 5.0

// Lifecycle:
Tick 0: Age=0.0  → Active
Tick N: Age=5.0  → Loop (Age reset to 0)
Tick M: Age=5.0  → Loop again
// 무한 반복, Complete 안됨
```

**One-Shot System:**
```cpp
// System Asset Settings:
// - LoopBehavior = Once
// - LoopDuration = 2.0

// Lifecycle:
Tick 0: Age=0.0, Particles=0    → Active, Spawn particles
Tick 1: Age=0.016, Particles=100 → Active
...
Tick N: Age=2.0, Particles=50   → InactiveClear (no more spawns)
Tick M: Age=2.5, Particles=10   → InactiveClear (particles dying)
Tick K: Age=3.0, Particles=0    → Complete
// System Simulation에서 제거됨
```

---

### 예시 3: Deactivate의 두 가지 모드

**Immediate Deactivation:**
```cpp
// 즉시 종료 (파티클 즉시 Kill)
NiagaraComp->Deactivate();  // bImmediate = false (default)
// OR
NiagaraComp->DeactivateImmediate();  // bImmediate = true

// Internal:
SystemInstance->Deactivate(/*bImmediate=*/true);
// → SetRequestedExecutionState(Complete)
// → 모든 Emitter의 파티클 즉시 Kill
// → 다음 Tick에서 Complete 상태로 전환
```

**Graceful Deactivation:**
```cpp
// 기존 파티클 유지, 새 Spawn만 중지
NiagaraComp->Deactivate();  // bImmediate = false

// Internal:
SystemInstance->Deactivate(/*bImmediate=*/false);
// → SetRequestedExecutionState(InactiveClear)
// → 새 Spawn 중지
// → 기존 파티클은 Lifetime까지 유지
// → 모든 파티클 사망 후 Complete
```

---

### 예시 4: Reset Modes

**ResetAll (전체 리셋):**
```cpp
// 모든 상태 초기화
SystemInstance->Reset(FNiagaraSystemInstance::EResetMode::ResetAll);

// 효과:
// - 모든 파티클 Kill
// - Age = 0
// - TickCount = 0
// - Random Seed 리셋
// - DataInterface Reset
// → 완전히 새로운 상태로 시작
```

**ResetSystem (System만 리셋):**
```cpp
// System 상태만 초기화, 파티클 유지
SystemInstance->Reset(FNiagaraSystemInstance::EResetMode::ResetSystem);

// 효과:
// - Age = 0
// - TickCount = 0
// - 파티클은 그대로 유지
// → Looping System에서 Loop 시작 시 사용
```

**ReInit (완전 재초기화):**
```cpp
// 전체 Cleanup 후 재초기화
SystemInstance->Reset(FNiagaraSystemInstance::EResetMode::ReInit);

// 효과:
// - Cleanup() 호출 (모든 리소스 해제)
// - Init() 호출 (새로 초기화)
// → System Asset 변경 시 사용
```

---

### 예시 5: Pooling을 통한 재사용

**Pooled System:**
```cpp
// WorldManager Pooling
FNiagaraSystemInstancePtr PooledInstance = WorldManager->GetPooledSystemInstance(SystemAsset);

if (PooledInstance.IsValid())
{
    // 1. Pool에서 가져온 Instance 재사용
    PooledInstance->OnPooledReuse(*NewWorld);

    // 2. 새 위치/파라미터 설정
    PooledInstance->SetWorldTransform(NewTransform);
    PooledInstance->GetInstanceParameters().SetParameterValue(...);

    // 3. 활성화
    PooledInstance->Activate(FNiagaraSystemInstance::EResetMode::ResetAll);
}
else
{
    // Pool에 없으면 새로 생성
    PooledInstance = MakeShared<FNiagaraSystemInstance>(..., /*bPooled=*/true);
    PooledInstance->Init();
    PooledInstance->Activate(FNiagaraSystemInstance::EResetMode::ResetAll);
}

// Complete 후 Pool로 반환
void FNiagaraSystemInstance::Complete(bool bExternalCompletion)
{
    // ...

    if (bPooled)
    {
        // Cleanup 안하고 Pool로 반환
        WorldManager->ReturnToPool(this);
    }
    else
    {
        // 일반 Instance는 Cleanup
        Cleanup();
    }
}
```

---

### 예시 6: Emitter Enable/Disable

**Runtime Emitter Control:**
```cpp
// Emitter 동적 활성화/비활성화
SystemInstance->SetEmitterEnable(FName("FireEmitter"), false);

// Internal:
void FNiagaraSystemInstance::SetEmitterEnable(FName EmitterName, bool bNewEnableState)
{
    FNiagaraEmitterInstance* Emitter = GetEmitterByName(EmitterName);
    if (Emitter)
    {
        Emitter->SetEmitterEnable(bNewEnableState);
    }
}

void FNiagaraEmitterInstance::SetEmitterEnable(bool bNewEnableState)
{
    if (bNewEnableState)
    {
        // Enable
        ExecutionState = ENiagaraExecutionState::Active;
    }
    else
    {
        // Disable
        ExecutionState = ENiagaraExecutionState::Disabled;

        // 파티클 Kill
        ParticleDataSet->ResetBuffers();
    }
}
```

---

## 🐛 디버깅 가이드

### 일반적인 함정

**❌ Complete된 System 재활성화 실패:**
```cpp
// 문제: Complete된 후 Activate() 호출 안됨
SystemInstance->Deactivate();
// → Complete 상태
SystemInstance->Tick(...);  // ← 아무 일도 안일어남

// 해결: Reset과 함께 Activate
SystemInstance->Activate(FNiagaraSystemInstance::EResetMode::ResetAll);
// → PendingSpawn 상태로 전환
```

**❌ Pooled System이 제대로 Reset 안됨:**
```cpp
// 문제: Pool에서 가져온 Instance가 이전 상태 유지
PooledInstance = WorldManager->GetPooledSystemInstance(Asset);
PooledInstance->Activate(FNiagaraSystemInstance::EResetMode::None);
// → 이전 Age/TickCount 유지!

// 해결: ResetAll로 완전 초기화
PooledInstance->Activate(FNiagaraSystemInstance::EResetMode::ResetAll);
```

**❌ Emitter가 Complete되지 않음:**
```cpp
// 문제: LoopBehavior가 Infinite인데 Complete 기대
// System Settings:
// - LoopBehavior = Infinite

SystemInstance->Deactivate(/*bImmediate=*/false);
// → InactiveClear 상태로 전환
// → 파티클 사망 대기
// → 하지만 Infinite Loop이므로 영원히 Complete 안됨!

// 해결 1: Immediate Deactivate
SystemInstance->Deactivate(/*bImmediate=*/true);

// 해결 2: LoopBehavior 변경
// System Asset에서 LoopBehavior = Once로 설정
```

---

### 디버깅 팁

**1. 상태 추적:**
```cpp
void DebugSystemState(const FNiagaraSystemInstance* SystemInstance)
{
    UE_LOG(LogNiagara, Log, TEXT("=== System State ==="));
    UE_LOG(LogNiagara, Log, TEXT("SystemInstanceState: %s"),
        *UEnum::GetValueAsString(SystemInstance->SystemInstanceState));
    UE_LOG(LogNiagara, Log, TEXT("RequestedExecutionState: %s"),
        *UEnum::GetValueAsString(SystemInstance->GetRequestedExecutionState()));
    UE_LOG(LogNiagara, Log, TEXT("ActualExecutionState: %s"),
        *UEnum::GetValueAsString(SystemInstance->GetActualExecutionState()));
    UE_LOG(LogNiagara, Log, TEXT("Age: %.2f"), SystemInstance->GetAge());
    UE_LOG(LogNiagara, Log, TEXT("TickCount: %d"), SystemInstance->GetTickCount());

    for (int32 i = 0; i < SystemInstance->GetEmitters().Num(); ++i)
    {
        const FNiagaraEmitterInstance* Emitter = SystemInstance->GetEmitters()[i].Get();
        UE_LOG(LogNiagara, Log, TEXT("  Emitter[%d] State: %s, Particles: %d"),
            i,
            *UEnum::GetValueAsString(Emitter->GetExecutionState()),
            Emitter->GetNumParticles());
    }
}
```

**2. Lifecycle Event Tracking:**
```cpp
#if WITH_EDITOR
// System Instance에 Event 등록
SystemInstance->OnInitialized().AddLambda([]()
{
    UE_LOG(LogNiagara, Log, TEXT("System Initialized"));
});

SystemInstance->OnReset().AddLambda([]()
{
    UE_LOG(LogNiagara, Log, TEXT("System Reset"));
});

SystemInstance->SetOnComplete([](bool bExternalCompletion)
{
    UE_LOG(LogNiagara, Log, TEXT("System Complete (External: %d)"), bExternalCompletion);
});

SystemInstance->OnDestroyed().AddLambda([]()
{
    UE_LOG(LogNiagara, Log, TEXT("System Destroyed"));
});
#endif
```

**3. Emitter 완료 조건 확인:**
```cpp
void DebugEmitterCompletionConditions(const FNiagaraEmitterInstance* Emitter)
{
    UE_LOG(LogNiagara, Log, TEXT("=== Emitter Completion Check ==="));
    UE_LOG(LogNiagara, Log, TEXT("ExecutionState: %s"),
        *UEnum::GetValueAsString(Emitter->GetExecutionState()));
    UE_LOG(LogNiagara, Log, TEXT("NumParticles: %d"), Emitter->GetNumParticles());
    UE_LOG(LogNiagara, Log, TEXT("EmitterAge: %.2f"), Emitter->GetEmitterAge());
    UE_LOG(LogNiagara, Log, TEXT("MaxLifetime: %.2f"), Emitter->GetMaxLifetime());
    UE_LOG(LogNiagara, Log, TEXT("LoopBehavior: %s"),
        *UEnum::GetValueAsString(Emitter->GetVersionedEmitter().GetEmitterData()->LoopBehavior));

    bool bShouldComplete = Emitter->ShouldComplete();
    UE_LOG(LogNiagara, Log, TEXT("ShouldComplete: %d"), bShouldComplete);
}
```

---

## 🎯 핵심 정리

### Lifecycle 요약

| 상태 | 설명 | 다음 상태 |
|------|------|----------|
| **None** | 미초기화 | → PendingSpawn (Init) |
| **PendingSpawn** | Spawn 대기 | → Active (First Tick) |
| **Active** | 정상 실행 | → InactiveClear/Complete |
| **InactiveClear** | Graceful 종료 중 | → Complete (파티클 0) |
| **Complete** | 완료 | → PendingSpawn (Reactivate) |
| **Disabled** | 비활성화 (에러) | (재활성화 불가) |

### Reset Mode 비교

| Mode | 파티클 Kill | Age Reset | DataInterface Reset | 사용 사례 |
|------|-------------|-----------|---------------------|----------|
| **ResetAll** | ✅ | ✅ | ✅ | 완전 재시작 |
| **ResetSystem** | ❌ | ✅ | ❌ | Loop 재시작 |
| **ReInit** | ✅ | ✅ | ✅ | Asset 변경 후 |

### 설계 철학

> **"Graceful Degradation with Pooling Support"**
> - Deactivate는 기본적으로 Graceful (파티클 유지)
> - Pooling으로 재사용 최적화
> - Component Auto-Activation 지원
> - Editor에서 실시간 Reset/Reinit 가능

---

## 🔗 참조 자료

- **System Instance 구현:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraSystemInstance.cpp`
- **Emitter Instance 구현:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraEmitterInstanceImpl.cpp`
- **World Manager Pooling:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraWorldManager.cpp`
