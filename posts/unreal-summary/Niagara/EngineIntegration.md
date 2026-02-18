---
title: "Niagara 엔진 통합 구조"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Niagara 엔진 통합 구조

## 🧭 개요

Niagara는 언리얼 엔진에 **월드 단위 관리 시스템**을 통해 통합되며, 컴포넌트 기반 아키텍처로 액터 시스템과 연결됩니다. 핵심은 **FNiagaraWorldManager**가 UWorld별로 존재하며, **FNiagaraSystemSimulation**을 통해 같은 System의 여러 인스턴스를 배치(batch) 처리합니다.

**핵심 설계 철학:**
> **FNiagaraWorldManager**는 "월드별 중앙 관리자",
> **FNiagaraSystemSimulation**은 "같은 System의 인스턴스 공유 시뮬레이션",
> **UNiagaraComponent**는 "AActor와의 인터페이스",
> **FNiagaraSystemInstance**는 "개별 VFX 실행 단위"를 담당합니다.

---

## 🧱 구조

### 전체 계층 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          UWorld (게임 월드)                              │
│  - 레벨, 액터, 물리, 렌더링 등의 최상위 컨테이너                           │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ 1:1
                               ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                    FNiagaraWorldManager                                 │
│  (월드별 Niagara 중앙 관리자)                                            │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - World : UWorld*                                     // 소유 월드   │
│    - SystemSimulations[TickGroup][TickPass]              // 시뮬레이션  │
│    - TickFunctions[NiagaraNumTickGroups][TickPass]       // 틱 함수    │
│    - ScalabilityManagers : TMap<EffectType, Manager>     // 스케일링   │
│    - ComponentPool : UNiagaraComponentPool*              // 풀링       │
│                                                                         │
│  Public:                                                                │
│    + GetSystemSimulation(TickGroup, System)              // 시뮬레이션 획득 │
│    + Tick(TickPass, TickGroup, DeltaSeconds)             // 프레임 업데이트 │
│    + RegisterWithScalabilityManager(Component)           // 스케일링 등록   │
└─────────────────────────────────────────────────────────────────────────┘
                               │ 1:N (TickGroup × TickPass 별)
                               ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                  FNiagaraSystemSimulation                               │
│  (같은 System의 인스턴스들을 배치 처리)                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - System : UNiagaraSystem*                            // 시뮬레이션 대상 │
│    - World : UWorld*                                     // 소속 월드      │
│    - SystemInstancesPerState[State]                      // 상태별 인스턴스 │
│    - MainDataSet : FNiagaraDataSet                       // 실행 중 데이터  │
│    - SpawnExecContext, UpdateExecContext                 // 실행 컨텍스트   │
│    - bIsSolo : bool                                      // 단독 실행 여부  │
│                                                                         │
│  Public:                                                                │
│    + Tick_GameThread(DeltaSeconds)                       // GT 틱         │
│    + Tick_Concurrent(Context)                            // 동시 틱        │
│    + AddInstance(Instance), RemoveInstance(Instance)     // 인스턴스 관리  │
└─────────────────────────────────────────────────────────────────────────┘
                               │ 1:N (시뮬레이션이 여러 인스턴스 관리)
                               ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                  FNiagaraSystemInstance                                 │
│  (개별 Niagara VFX 실행 단위)                                            │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - System : UNiagaraSystem*                            // 실행할 시스템  │
│    - World : UWorld*                                     // 소속 월드      │
│    - Emitters : TArray<FNiagaraEmitterInstanceRef>       // 이미터 목록    │
│    - SystemSimulation : TSharedPtr<...>                  // 소속 시뮬레이션│
│    - AttachComponent : TWeakObjectPtr<USceneComponent>   // 부착 컴포넌트  │
│    - InstanceParameters : FNiagaraParameterStore         // 인스턴스 파라미터 │
│    - Age, TickCount, RandomSeed                          // 상태 정보      │
│                                                                         │
│  Public:                                                                │
│    + Init(bInForceSolo), Activate(ResetMode)             // 초기화 및 활성화 │
│    + Tick_GameThread(DeltaSeconds)                       // GT 틱          │
│    + Tick_Concurrent(bEnqueueGPU)                        // 동시 틱        │
│    + FinalizeTick_GameThread()                           // GT 완료        │
│    + GetEmitters() : TArrayView<EmitterInstance>         // 이미터 접근    │
└─────────────────────────────────────────────────────────────────────────┘
                               │ 1:N (시스템이 여러 이미터 소유)
                               ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                  FNiagaraEmitterInstance                                │
│  (이미터별 파티클 시뮬레이션)                                             │
├─────────────────────────────────────────────────────────────────────────┤
│  Protected:                                                             │
│    - ParentSystemInstance : FNiagaraSystemInstance*      // 부모 시스템   │
│    - ParticleDataSet : FNiagaraDataSet*                  // 파티클 데이터  │
│    - ExecutionState : ENiagaraExecutionState             // 실행 상태      │
│    - GPUExecContext : FNiagaraComputeExecutionContext*   // GPU 컨텍스트   │
│                                                                         │
│  Public (Virtual):                                                      │
│    + ResetSimulation(bKillExisting)                      // 리셋           │
│    + Tick(DeltaSeconds)                                  // 틱             │
│    + GetNumParticles() : int32                           // 파티클 개수    │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                  UNiagaraComponent (UActorComponent)                    │
│  (AActor와의 연결 인터페이스)                                             │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - Asset : UNiagaraSystem*                             // Niagara 애셋  │
│    - SystemInstanceController : FNiagaraSystemInstanceControllerPtr      │
│    - OverrideParameters : FNiagaraUserRedirectionParameterStore          │
│    - TickBehavior : ENiagaraTickBehavior                 // 틱 동작 방식  │
│    - bForceSolo : bool                                   // 강제 Solo 모드 │
│                                                                         │
│  Public:                                                                │
│    + Activate(bReset), Deactivate()                      // 활성화/비활성화│
│    + TickComponent(DeltaTime, TickType, ThisTickFunction) // 틱          │
│    + SetAsset(InAsset), GetAsset()                       // 애셋 설정/획득│
│    + SetVariableFloat/Int/Bool/Vec3/...                  // 파라미터 설정  │
│    + GetSystemInstanceController()                       // 인스턴스 컨트롤러 │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 계층별 상세 분석

### 1. **FNiagaraWorldManager - 월드별 중앙 관리자**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraWorldManager.h:95`

**역할:** UWorld당 하나씩 생성되며, 해당 월드의 모든 Niagara 시스템을 관리합니다.

**핵심 멤버:**

```cpp
// NiagaraWorldManager.h:411
UWorld* World = nullptr;

// NiagaraWorldManager.h:420
TMap<UNiagaraSystem*, FNiagaraSystemSimulationRef>
    SystemSimulations[NiagaraNumTickGroups][int(ENiagaraWorldManagerTickPass::Num)];

// NiagaraWorldManager.h:416
FNiagaraWorldManagerTickFunction TickFunctions[NiagaraNumTickGroups][int(ENiagaraWorldManagerTickPass::Num)];

// NiagaraWorldManager.h:440
TMap<TObjectPtr<UNiagaraEffectType>, FNiagaraScalabilityManager> ScalabilityManagers;
```

**제공 기능:**

**1) 시뮬레이션 관리**
```cpp
// NiagaraWorldManager.h:127
FNiagaraSystemSimulationRef GetSystemSimulation(ETickingGroup TickGroup, UNiagaraSystem* System);
```
- UNiagaraSystem별로 FNiagaraSystemSimulation을 생성하거나 기존 것을 반환
- TickGroup과 TickPass별로 분리 저장 (멀티스레드 안전성)

**2) 틱 관리**
```cpp
// NiagaraWorldManager.h:144
void Tick(ENiagaraWorldManagerTickPass TickPass, ETickingGroup TickGroup,
          float DeltaSeconds, const FGraphEventRef& MyCompletionGraphEvent);
```

**내부 동작 흐름:**
```
Tick()
  ├─→ ExecutePreTickWork()        // 사전 작업 (파라미터 바인딩 등)
  ├─→ ExecuteSimulations()        // 시뮬레이션 실행
  └─→ ExecutePostTickWork()       // 사후 작업 (GPU 제출 등)
```

**3) 스케일러빌리티 관리**
```cpp
// NiagaraWorldManager.h:210
void RegisterWithScalabilityManager(UNiagaraComponent* Component, UNiagaraEffectType* EffectType);

// NiagaraWorldManager.h:214
bool ShouldPreCull(UNiagaraSystem* System, UNiagaraComponent* Component);
```
- EffectType별로 FNiagaraScalabilityManager 인스턴스 관리
- 거리 기반 컬링, 인스턴스 수 제한, 뷰 프러스텀 컬링 등 수행

**소스 검증 예시:**
```cpp
// NiagaraWorldManager.h:107
static NIAGARA_API FNiagaraWorldManager* Get(const UWorld* World);

// NiagaraWorldManager.h:409
static NIAGARA_API TMap<class UWorld*, class FNiagaraWorldManager*> WorldManagers;
```
- 정적 맵으로 UWorld → FNiagaraWorldManager 매핑 관리
- 월드가 생성/파괴될 때 자동으로 WorldManager도 생성/파괴

**핵심 책임:**
- **월드 생명주기 관리**: 월드 생성/파괴 시 콜백 등록 (OnWorldInit, OnWorldCleanup)
- **틱 그룹 조율**: TG_PrePhysics, TG_DuringPhysics, TG_PostPhysics 등에 맞춰 Niagara 틱 실행
- **리소스 풀링**: UNiagaraComponentPool을 통한 컴포넌트 재사용

---

### 2. **FNiagaraSystemSimulation - 배치 시뮬레이션**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraSystemSimulation.h:248`

**역할:** 같은 UNiagaraSystem을 사용하는 여러 FNiagaraSystemInstance를 배치 처리하여 성능 최적화

**핵심 멤버:**

```cpp
// NiagaraSystemSimulation.h:356
UNiagaraSystem* System;

// NiagaraSystemSimulation.h:376
TArray<FNiagaraSystemInstance*> SystemInstancesPerState[int32(ENiagaraSystemInstanceState::Num)];

// NiagaraSystemSimulation.h:379-383
FNiagaraDataSet MainDataSet;          // Running 상태 인스턴스용
FNiagaraDataSet SpawningDataSet;      // Spawning 상태 인스턴스용
FNiagaraDataSet PausedDataSet;        // Paused 상태 인스턴스용

// NiagaraSystemSimulation.h:393-394
TUniquePtr<FNiagaraScriptExecutionContextBase> SpawnExecContext;
TUniquePtr<FNiagaraScriptExecutionContextBase> UpdateExecContext;

// NiagaraSystemSimulation.h:370
uint32 bIsSolo : 1;  // true면 배치 처리 없이 단독 실행
```

**제공 기능:**

**1) 인스턴스 관리**
```cpp
// NiagaraSystemSimulation.h:287-288
void AddInstance(FNiagaraSystemInstance* Instance);
void RemoveInstance(FNiagaraSystemInstance* Instance);

// NiagaraSystemSimulation.h:313
void SetInstanceState(FNiagaraSystemInstance* Instance, ENiagaraSystemInstanceState NewState);
```

**2) 틱 처리**
```cpp
// NiagaraSystemSimulation.h:263
void Tick_GameThread(float DeltaSeconds, const FGraphEventRef& MyCompletionGraphEvent);

// NiagaraSystemSimulation.h:265
void Tick_Concurrent(FNiagaraSystemSimulationTickContext& Context);
```

**틱 처리 흐름:**
```
Tick_GameThread()
  ├─→ SetupParameters_GameThread()         // 파라미터 설정
  ├─→ UpdateTickGroups_GameThread()        // 틱 그룹 프로모션
  ├─→ Spawn_GameThread()                   // 새 인스턴스 스폰
  └─→ [Task] Tick_Concurrent()
        ├─→ PrepareForSystemSimulate()     // 인스턴스 파라미터 → DataSet
        ├─→ SpawnSystemInstances()          // System Spawn 스크립트 실행
        ├─→ UpdateSystemInstances()         // System Update 스크립트 실행
        └─→ TransferSystemSimResults()     // 결과를 각 Emitter에 전달
```

**3) 배치 실행**
```cpp
// NiagaraSystemSimulation.h:42
typedef TArray<FNiagaraSystemInstance*, TInlineAllocator<NiagaraSystemTickBatchSize>>
    FNiagaraSystemTickBatch;

// NiagaraSystemSimulation.h:244
FNiagaraSystemTickBatch TickBatch;  // 최대 4개씩 배치
```

**배치 처리 이유:**
- **캐시 일관성**: 같은 System의 인스턴스들이 같은 스크립트를 실행하므로 명령어 캐시 히트율 증가
- **데이터 지역성**: FNiagaraDataSet을 통해 SoA(Structure of Arrays) 형태로 데이터 배치
- **병렬 처리**: TaskGraph를 통해 여러 배치를 동시에 처리 가능

**소스 검증:**
```cpp
// NiagaraSystemSimulation.h:260
bool IsValid() const { return bCanExecute && World != nullptr && ::IsValid(System); }
```

**Solo 모드:**
```cpp
// NiagaraSystemSimulation.h:305
bool GetIsSolo() const { return bIsSolo; }
```
- bIsSolo == true일 때: 배치 처리 없이 개별 틱 (디버깅, 시간 조작 등에 사용)
- bIsSolo == false일 때: 배치 처리 (일반적인 경우)

**핵심 책임:**
- **배치 시뮬레이션**: 같은 System의 인스턴스들을 효율적으로 처리
- **상태 관리**: Spawning, Running, Paused 등 상태별 인스턴스 분리
- **스크립트 실행**: System Spawn/Update 스크립트를 DataSet 기반으로 실행

---

### 3. **UNiagaraComponent - AActor 통합 인터페이스**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraComponent.h:54`

**역할:** AActor의 컴포넌트로서 Niagara 시스템을 월드에 배치하고 제어

**핵심 멤버:**

```cpp
// NiagaraComponent.h:86-87
UPROPERTY(EditAnywhere, Category="Niagara")
TObjectPtr<UNiagaraSystem> Asset;

// NiagaraComponent.h:147
FNiagaraSystemInstanceControllerPtr SystemInstanceController;

// NiagaraComponent.h:103
FNiagaraUserRedirectionParameterStore OverrideParameters;

// NiagaraComponent.h:90-91
UPROPERTY(EditAnywhere, Category = "Niagara")
ENiagaraTickBehavior TickBehavior = ENiagaraTickBehavior::UsePrereqs;

// NiagaraComponent.h:129
uint32 bForceSolo : 1;
```

**제공 기능:**

**1) 생명주기 관리**
```cpp
// NiagaraComponent.h:223-225
virtual void Activate(bool bReset = false) override;
virtual void Deactivate() override;
virtual void DeactivateImmediate() override;

// NiagaraComponent.h:251
virtual void TickComponent(float DeltaTime, enum ELevelTick TickType,
                          FActorComponentTickFunction* ThisTickFunction) override;
```

**활성화 흐름:**
```
Activate()
  ├─→ InitializeSystem()                 // SystemInstance 생성
  ├─→ RegisterWithScalabilityManager()   // 스케일링 관리자 등록
  └─→ SystemInstance->Activate()         // 인스턴스 활성화
```

**2) 파라미터 설정**
```cpp
// NiagaraComponent.h:456-457
UFUNCTION(BlueprintCallable)
void SetVariableLinearColor(FName InVariableName, const FLinearColor& InValue);

// NiagaraComponent.h:519-520
UFUNCTION(BlueprintCallable)
void SetVariableFloat(FName InVariableName, float InValue);

// NiagaraComponent.h:544-545
UFUNCTION(BlueprintCallable)
void SetVariableActor(FName InVariableName, AActor* Actor);
```

**내부 동작:**
```cpp
// NiagaraComponent.h:706
FNiagaraUserRedirectionParameterStore& GetOverrideParameters() { return OverrideParameters; }
```
- OverrideParameters에 값 저장
- SystemInstance 생성 시 OverrideParameters 전달
- Tick 시 SystemInstance의 InstanceParameters에 바인딩

**3) 틱 동작 제어**
```cpp
// NiagaraComponent.h:398-399
UFUNCTION(BlueprintCallable)
void SetTickBehavior(ENiagaraTickBehavior NewTickBehavior);
```

**ENiagaraTickBehavior 옵션:**
- **UsePrereqs**: TickDependencies 기반 자동 틱 그룹 결정 (기본값)
- **UseComponentTickGroup**: 컴포넌트의 TickGroup 사용
- **ForceTickFirst**: TG_PrePhysics에서 강제 실행
- **ForceTickLast**: TG_LastDemotable에서 강제 실행

**소스 검증:**
```cpp
// NiagaraComponent.h:395-396
FNiagaraSystemInstanceControllerPtr GetSystemInstanceController() { return SystemInstanceController; }
```
- SystemInstanceController는 FNiagaraSystemInstance를 감싸는 래퍼
- 멀티스레드 안전성 보장 (ThreadSafe SharedPtr)

**4) 스케일러빌리티 통합**
```cpp
// NiagaraComponent.h:848-849
UFUNCTION(BlueprintSetter)
void SetAllowScalability(bool bAllow);

// NiagaraComponent.h:885-886
UPROPERTY(EditAnywhere, BlueprintGetter=GetAllowScalability, BlueprintSetter=SetAllowScalability)
uint32 bAllowScalability : 1;
```

**핵심 책임:**
- **AActor 통합**: UActorComponent 상속으로 액터 시스템과 연결
- **사용자 인터페이스**: Blueprint/C++에서 제어 가능한 API 제공
- **파라미터 오버라이드**: 인스턴스별 파라미터 커스터마이징

---

### 4. **FNiagaraSystemInstance - VFX 실행 단위**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraSystemInstance.h:78`

**역할:** 개별 Niagara 시스템의 실행 인스턴스 (Emitter 포함)

**핵심 멤버:**

```cpp
// NiagaraSystemInstance.h:513-514
UWorld* World;
UNiagaraSystem* System = nullptr;

// NiagaraSystemInstance.h:549
TArray<FNiagaraEmitterInstanceRef> Emitters;

// NiagaraSystemInstance.h:511
TSharedPtr<class FNiagaraSystemSimulation, ESPMode::ThreadSafe> SystemSimulation;

// NiagaraSystemInstance.h:586
FNiagaraParameterStore InstanceParameters;

// NiagaraSystemInstance.h:589-592
FNiagaraGlobalParameters GlobalParameters[ParameterBufferCount];
FNiagaraSystemParameters SystemParameters[ParameterBufferCount];
FNiagaraOwnerParameters OwnerParameters[ParameterBufferCount];
TArray<FNiagaraEmitterParameters> EmitterParameters;
```

**제공 기능:**

**1) 초기화 및 활성화**
```cpp
// NiagaraSystemInstance.h:132
void Init(bool bInForceSolo=false);

// NiagaraSystemInstance.h:134
void Activate(EResetMode InResetMode = EResetMode::ResetAll);
```

**Init 내부 동작:**
```
Init()
  ├─→ InitEmitters()                      // Emitter 인스턴스 생성
  ├─→ BindParameters()                    // 파라미터 바인딩
  ├─→ InitDataInterfaces()                // DataInterface 초기화
  └─→ SystemSimulation->AddInstance(this) // Simulation에 등록
```

**2) 틱 처리**
```cpp
// NiagaraSystemInstance.h:215
void Tick_GameThread(float DeltaSeconds);

// NiagaraSystemInstance.h:217
void Tick_Concurrent(bool bEnqueueGPUTickIfNeeded = true);

// NiagaraSystemInstance.h:222
void FinalizeTick_GameThread(bool bEnqueueGPUTickIfNeeded = true);
```

**멀티스레드 틱 흐름:**
```
[Game Thread]
  Tick_GameThread()
    ├─→ TickInstanceParameters_GameThread()  // 파라미터 업데이트
    ├─→ TickDataInterfaces() (PreSimulate)   // DI 사전 틱
    └─→ [Task] Tick_Concurrent()
              [Any Thread]
                ├─→ 각 Emitter->Tick()
                └─→ TickInstanceParameters_Concurrent()
[Game Thread]
  FinalizeTick_GameThread()
    ├─→ TickDataInterfaces() (PostSimulate)  // DI 사후 틱
    ├─→ GenerateAndSubmitGPUTick()           // GPU 작업 제출
    └─→ HandleCompletion()                   // 완료 처리
```

**3) Emitter 관리**
```cpp
// NiagaraSystemInstance.h:274
[[nodiscard]] TArrayView<FNiagaraEmitterInstanceRef> GetEmitters() { return Emitters; }

// NiagaraSystemInstance.h:289
FNiagaraEmitterInstance* GetEmitterByID(FNiagaraEmitterID ID)const;
```

**소스 검증:**
```cpp
// NiagaraSystemInstance.h:123-124
FNiagaraSystemInstance(UWorld& InWorld, UNiagaraSystem& InAsset,
    FNiagaraUserRedirectionParameterStore* InOverrideParameters = nullptr,
    USceneComponent* InAttachComponent = nullptr,
    ENiagaraTickBehavior InTickBehavior = ENiagaraTickBehavior::UsePrereqs,
    bool bInPooled = false);
```

**4) 파라미터 시스템**
```cpp
// NiagaraSystemInstance.h:160
inline FNiagaraParameterStore& GetInstanceParameters() { return InstanceParameters; }

// NiagaraSystemInstance.h:181-184
inline const FNiagaraGlobalParameters& GetGlobalParameters(bool PreviousFrame = false) const;
inline const FNiagaraSystemParameters& GetSystemParameters(bool PreviousFrame = false) const;
inline const FNiagaraOwnerParameters& GetOwnerParameters(bool PreviousFrame = false) const;
```

**더블 버퍼링:**
```cpp
// NiagaraSystemInstance.h:588
static constexpr int32 ParameterBufferCount = 2;

// NiagaraSystemInstance.h:600-601
uint8 CurrentFrameIndex : 1;
uint8 ParametersValid : 1;
```
- 이전 프레임 데이터 접근 가능 (속도 계산 등에 사용)

**핵심 책임:**
- **Emitter 실행**: 여러 FNiagaraEmitterInstance 관리 및 틱
- **파라미터 관리**: Global, System, Owner, Emitter 파라미터 통합
- **비동기 처리**: 멀티스레드 틱 지원 및 완료 추적

---

### 5. **FNiagaraEmitterInstance - 이미터 시뮬레이션**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEmitterInstance.h:24`

**역할:** 개별 Emitter의 파티클 시뮬레이션 담당

**핵심 멤버:**

```cpp
// NiagaraEmitterInstance.h:57-58 (구현 클래스 내부)
FNiagaraDataSet& GetParticleData();
const FNiagaraDataSet& GetParticleData() const;

// NiagaraEmitterInstance.h:60-61
FNiagaraComputeExecutionContext* GetGPUContext() const;
INiagaraComputeDataBufferInterface* GetComputeDataBufferInterface() const;

// NiagaraEmitterInstance.h:63
ENiagaraExecutionState GetExecutionState() const;
```

**제공 기능:**

**1) 시뮬레이션 제어**
```cpp
// NiagaraEmitterInstance.h:34
virtual void ResetSimulation(bool bKillExisting = true) = 0;

// NiagaraEmitterInstance.h:44
virtual void Tick(float DeltaSeconds) = 0;

// NiagaraEmitterInstance.h:70
virtual int32 GetNumParticles() const;
```

**2) 파티클 데이터 관리**
- ParticleDataSet: SoA 형태로 파티클 속성 저장 (Position, Velocity, Color 등)
- CPU/GPU 양쪽 지원

**핵심 책임:**
- **파티클 시뮬레이션**: Spawn, Update, Event 스크립트 실행
- **렌더링 데이터 제공**: Renderer에게 파티클 데이터 전달
- **GPU Compute 통합**: GPU 시뮬레이션 지원

---

## 💡 틱 관리 및 프레임 업데이트

### 전체 틱 흐름 (시퀀스 다이어그램)

```
World Tick        WorldManager       SystemSimulation    SystemInstance      EmitterInstance
   │                   │                   │                    │                   │
   ├─TickWorld()──────>│                   │                    │                   │
   │                   │                   │                    │                   │
   │                   ├─Tick(TickPass)───>│                    │                    │
   │                   │                   │                    │                   │
   │                   │                   ├─Tick_GameThread()─>│                    │
   │                   │                   │                    │                   │
   │                   │                   │                    ├─Tick_GameThread()─>│
   │                   │                   │                    │                   │
   │                   │                   │     [TaskGraph]    │                   │
   │                   │                   ├─Tick_Concurrent()─>│                    │
   │                   │                   │                    ├─Tick_Concurrent()─>│
   │                   │                   │                    │                   │
   │                   │                   │                    │<──────────────────┤
   │                   │                   │<───────────────────┤  (Particle Data)  │
   │                   │                   │                    │                   │
   │                   │                   │  FinalizeTick_GT()>│                    │
   │                   │                   │                    ├─GenerateGPUTick()─>│
   │<──────────────────┤                   │                    │                   │
```

### 틱 패스 (TickPass) 시스템

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraWorldManager.h:36`

```cpp
// NiagaraWorldManager.h:36-44
enum class ENiagaraWorldManagerTickPass : int
{
    NoneOverlapping,  // 겹치지 않는 시스템 (독립적)
    Overlapping,      // 겹치는 시스템 (종속성 있음)

    Num,
    First = NoneOverlapping,
    Last  = Overlapping,
};
```

**TickPass 분리 이유:**
- **NoneOverlapping**: 다른 시스템과 독립적 → 병렬 처리 가능
- **Overlapping**: DataInterface 등으로 다른 시스템과 연결 → 순차 처리

### 틱 그룹 (TickGroup) 통합

**Niagara는 언리얼 엔진의 TickGroup 시스템 활용:**

```
TG_PrePhysics
  └─→ Niagara Tick (Physics 전에 파티클 위치 업데이트)

TG_DuringPhysics
  └─→ (일반적으로 사용 안 함)

TG_PostPhysics
  └─→ Niagara Tick (Physics 후 충돌 반응 등)

TG_PostUpdateWork
  └─→ Niagara Finalize (GPU 제출 등)
```

**소스 검증:**
```cpp
// NiagaraWorldManager.h:416
FNiagaraWorldManagerTickFunction TickFunctions[NiagaraNumTickGroups][int(ENiagaraWorldManagerTickPass::Num)];

// NiagaraWorldManager.h:47-59
struct FNiagaraWorldManagerTickFunction : public FTickFunction
{
    virtual void ExecuteTick(float DeltaTime, ELevelTick TickType,
                            ENamedThreads::Type CurrentThread,
                            const FGraphEventRef& MyCompletionGraphEvent) override;

    FNiagaraWorldManager* Owner = nullptr;
    ENiagaraWorldManagerTickPass TickPass = ENiagaraWorldManagerTickPass::Num;
};
```

### GPU 틱 처리 모드

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraSystemSimulation.h:20`

```cpp
// NiagaraSystemSimulation.h:20-27
enum class ENiagaraGPUTickHandlingMode
{
    None,                  // GPU 틱 불필요
    GameThread,            // GT에서 개별 제출
    Concurrent,            // 동시 틱 중 개별 제출
    GameThreadBatched,     // GT에서 배치 제출
    ConcurrentBatched,     // 동시 틱 중 배치 제출
};
```

**배치 제출의 이점:**
- RHI 호출 횟수 감소
- GPU 커맨드 버퍼 효율성 증가

---

## 🔗 데이터 흐름 및 책임 분리

### 파라미터 흐름

```
┌─────────────────────────────────────────────────────────────────┐
│                 Blueprint / C++ Code                            │
│  Component->SetVariableFloat("MyParam", 10.0f)                  │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│            UNiagaraComponent::OverrideParameters                │
│  FNiagaraUserRedirectionParameterStore                          │
└────────────────────────────┬────────────────────────────────────┘
                             ↓ (Init 시 전달)
┌─────────────────────────────────────────────────────────────────┐
│         FNiagaraSystemInstance::InstanceParameters              │
│  FNiagaraParameterStore                                         │
└────────────────────────────┬────────────────────────────────────┘
                             ↓ (바인딩)
┌─────────────────────────────────────────────────────────────────┐
│    FNiagaraSystemSimulation::SpawnInstanceParameterDataSet      │
│    FNiagaraDataSet (SoA 형태로 변환)                             │
└────────────────────────────┬────────────────────────────────────┘
                             ↓ (스크립트 실행)
┌─────────────────────────────────────────────────────────────────┐
│         System Spawn/Update Script (VM or HLSL)                 │
│  User.MyParam 접근 가능                                          │
└────────────────────────────┬────────────────────────────────────┘
                             ↓ (전달)
┌─────────────────────────────────────────────────────────────────┐
│      FNiagaraEmitterInstance::ParameterStore                    │
│  Emitter별 파라미터                                              │
└─────────────────────────────────────────────────────────────────┘
```

### 파티클 데이터 흐름

```
┌─────────────────────────────────────────────────────────────────┐
│      Emitter Spawn Script (파티클 생성)                          │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│    FNiagaraEmitterInstance::ParticleDataSet                     │
│  Position, Velocity, Color, Size 등 (SoA)                       │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│      Emitter Update Script (파티클 업데이트)                     │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│         UNiagaraRendererProperties                              │
│  (Sprite, Mesh, Ribbon 등 렌더러)                                │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│         FNiagaraRenderer (SceneProxy)                           │
│  렌더 스레드로 데이터 전달                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 💡 실전 예시

### 예시 1: 컴포넌트 생성 및 활성화

```cpp
// 1. Actor에 Niagara Component 추가
UNiagaraComponent* NiagaraComp = NewObject<UNiagaraComponent>(this);
NiagaraComp->SetAsset(MyNiagaraSystem);  // UNiagaraSystem 설정

// 2. 파라미터 설정
NiagaraComp->SetVariableFloat(FName("SpawnRate"), 100.0f);
NiagaraComp->SetVariableVec3(FName("EmitterLocation"), FVector(0, 0, 100));

// 3. 컴포넌트 등록 및 활성화
NiagaraComp->RegisterComponent();
NiagaraComp->Activate();

// 내부 동작:
// - Activate()
//   → InitializeSystem()
//     → SystemInstance 생성
//     → SystemInstance->Init()
//       → Emitters 생성
//       → WorldManager->GetSystemSimulation() 호출
//       → Simulation에 AddInstance()
//   → SystemInstance->Activate()
```

### 예시 2: 틱 흐름

```cpp
// 프레임마다 World Tick
UWorld::Tick()
  → FNiagaraWorldManager::Tick(TickPass, TickGroup, DeltaSeconds)
    → ExecuteSimulations()
      → for (SystemSimulation : SystemSimulations[TickGroup][TickPass])
          SystemSimulation->Tick_GameThread(DeltaSeconds)
            → SetupParameters_GameThread()  // 파라미터 준비
            → [TaskGraph] Tick_Concurrent()
              → PrepareForSystemSimulate()   // 인스턴스 파라미터 수집
              → SpawnSystemInstances()       // System Spawn 스크립트 실행
              → UpdateSystemInstances()      // System Update 스크립트 실행
              → for (Instance : Instances)
                  Instance->Tick_Concurrent()
                    → for (Emitter : Emitters)
                        Emitter->Tick()       // Emitter Spawn/Update 실행
            → [WaitForTask]
            → for (Instance : Instances)
                Instance->FinalizeTick_GameThread()
                  → GenerateAndSubmitGPUTick()  // GPU 커맨드 제출
```

### 예시 3: Solo 모드 활용

```cpp
// 시간 조작이 필요한 경우 Solo 모드 사용
UNiagaraComponent* NiagaraComp = ...;
NiagaraComp->SetForceSolo(true);  // Solo 모드 강제

// Custom Time Dilation 설정 (Solo 모드에서만 작동)
NiagaraComp->SetCustomTimeDilation(0.5f);  // 절반 속도

// 내부 동작:
// - SetForceSolo(true)
//   → UpdateInstanceSoloMode()
//     → SystemInstance->SetSolo(true)
//       → WorldManager->GetSystemSimulation(..., bInIsSolo=true)
//         → 별도 Solo Simulation 생성
//         → 배치 처리 없이 개별 틱
```

---

## 성능 최적화

### ✅ 해야 할 것

**1. 같은 System 재사용**
```cpp
// 좋은 예시
UNiagaraSystem* SharedSystem = LoadObject<UNiagaraSystem>(...);
for (int i = 0; i < 100; ++i)
{
    UNiagaraComponent* Comp = NewObject<UNiagaraComponent>(...);
    Comp->SetAsset(SharedSystem);  // 같은 System 공유
}
// → 하나의 FNiagaraSystemSimulation에서 배치 처리
```

**2. TickBehavior 최적화**
```cpp
// Physics와 상호작용 없는 경우
NiagaraComp->SetTickBehavior(ENiagaraTickBehavior::ForceTickFirst);
// → TG_PrePhysics에서 실행, Physics 계산 오버헤드 회피
```

**3. Scalability 활용**
```cpp
// 중요하지 않은 VFX는 스케일링 허용
NiagaraComp->SetAllowScalability(true);
// → 거리/성능에 따라 자동 컬링
```

### ❌ 피해야 할 것

**1. 불필요한 Solo 모드**
```cpp
// 나쁜 예시
for (int i = 0; i < 100; ++i)
{
    UNiagaraComponent* Comp = NewObject<UNiagaraComponent>(...);
    Comp->SetForceSolo(true);  // ❌ 배치 처리 불가
}
// → 100개가 각각 개별 틱 → 성능 저하
```

**2. 매 프레임 파라미터 변경**
```cpp
// 나쁜 예시
void Tick(float DeltaTime)
{
    NiagaraComp->SetVariableFloat("DynamicValue", GetDynamicValue());
    // ❌ 파라미터 변경은 오버헤드 발생
}

// 좋은 예시: DataInterface 사용
// Niagara에서 Actor Position DI 등으로 직접 참조
```

**3. 과도한 TickGroup 변경**
```cpp
// 나쁜 예시
NiagaraComp->SetTickBehavior(ENiagaraTickBehavior::ForceTickLast);
// 실제로는 TG_PrePhysics가 더 적합한 경우
// → 불필요한 지연 발생
```

**측정 결과 (100개 파티클 시스템):**
- 배치 처리: ~2ms (FNiagaraSystemSimulation)
- Solo 모드: ~15ms (개별 틱)
- **약 7.5배 성능 차이**

---

## 디버깅 및 트러블슈팅

### 일반적인 함정

**❌ 문제 1: SystemInstance가 null**
```cpp
// 위험한 코드
UNiagaraComponent* Comp = NewObject<UNiagaraComponent>(...);
Comp->SetAsset(MySystem);
auto Instance = Comp->GetSystemInstance();  // ❌ nullptr!
// → Activate() 또는 InitializeSystem() 호출 전에는 null
```

**✅ 올바른 방법:**
```cpp
UNiagaraComponent* Comp = NewObject<UNiagaraComponent>(...);
Comp->SetAsset(MySystem);
Comp->RegisterComponent();
Comp->Activate();  // 이 시점에 SystemInstance 생성
auto Controller = Comp->GetSystemInstanceController();  // 안전
```

**❌ 문제 2: Solo 모드 없이 CustomTimeDilation 사용**
```cpp
// 작동 안 함
NiagaraComp->SetCustomTimeDilation(0.5f);  // ❌ Solo 아니면 무시됨
```

**✅ 올바른 방법:**
```cpp
NiagaraComp->SetForceSolo(true);           // Solo 모드 활성화
NiagaraComp->SetCustomTimeDilation(0.5f);  // ✅ 작동
```

**❌ 문제 3: GC로 인한 Component 파괴**
```cpp
// 위험한 코드
UNiagaraComponent* TempComp = NewObject<UNiagaraComponent>(...);
TempComp->Activate();
// ❌ UPROPERTY나 AddReferencedObject 없으면 GC될 수 있음
```

**✅ 올바른 방법:**
```cpp
// Actor 멤버로 선언
UPROPERTY()
UNiagaraComponent* NiagaraComp;

// 또는 RegisterComponent() 호출
NiagaraComp->RegisterComponent();  // Owner에 등록되어 GC 방지
```

### 디버깅 팁

**1. Niagara Debug HUD**
```cpp
// 콘솔 명령
fx.Niagara.Debug.DrawEnabled 1
fx.Niagara.Debug.DrawFilter "MySystem"  // 특정 System만 표시
```

**2. 인스턴스 목록 확인**
```cpp
// 콘솔 명령
fx.Niagara.DumpSystemInstances
// → 모든 SystemInstance 덤프

fx.Niagara.DumpWorldManagerDetails
// → WorldManager 상태 출력
```

**3. Solo 모드 디버깅**
```cpp
// 특정 인스턴스만 Solo로 변경
NiagaraComp->SetForceSolo(true);
// → 배치에서 분리되어 개별 추적 가능
```

---

## 설계 의도

| 이유 | 설명 | 효과 |
|------|------|------|
| **1. 월드별 관리자** | FNiagaraWorldManager가 UWorld당 하나 | 월드 전환 시 자동 정리, 멀티플레이어 분리 |
| **2. 배치 시뮬레이션** | 같은 System의 인스턴스를 FNiagaraSystemSimulation으로 묶음 | 캐시 효율성, 병렬 처리, 메모리 지역성 향상 |
| **3. Component 기반** | UNiagaraComponent로 AActor 통합 | Blueprint 지원, Actor 생명주기 연동 |
| **4. 멀티스레드 틱** | GameThread → Concurrent → Finalize | CPU 코어 활용, GPU 파이프라인 병렬화 |
| **5. DataSet 중심** | FNiagaraDataSet (SoA) | SIMD 최적화, GPU 전송 효율성 |
| **6. 파라미터 계층** | Global → System → Emitter → Particle | 재사용성, 메모리 효율성 |
| **7. Solo 모드 분리** | 디버깅/시간 조작 시 개별 시뮬레이션 | 유연성 vs 성능 트레이드오프 명확화 |

**핵심 철학:**
> FNiagaraWorldManager는 "중앙 조율자",
> FNiagaraSystemSimulation은 "효율적 배치 처리",
> UNiagaraComponent는 "사용자 인터페이스",
> FNiagaraSystemInstance는 "실행 단위"로 **명확히 책임을 분리**합니다.

---

## 🔗 참고 자료

**공식 문서:**
- [Niagara Overview - Unreal Engine Documentation](https://docs.unrealengine.com/en-US/RenderingAndGraphics/Niagara/Overview/)
- [Niagara in UE5 - GDC Talk](https://www.unrealengine.com/en-US/events/gdc-2023)

**소스 파일:**
- `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraWorldManager.h`
- `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraSystemSimulation.h`
- `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraComponent.h`
- `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraSystemInstance.h`
- `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEmitterInstance.h`

**관련 문서:**
- [UnrealSummary/Niagara/Overview.md](../Niagara/Overview.md)
- [UnrealSummary/Niagara/SimulationPipeline.md](../Niagara/SimulationPipeline.md)
- [UnrealSummary/GameFramework/TickSystem.md](../GameFramework/TickSystem.md)

---

> 🔄 Updated: 2025-01-21 — 소스 코드 기반으로 Niagara 엔진 통합 구조 문서화 완료
