---
title: "Niagara Scalability System"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Niagara Scalability System

> Updated: 2026-02-18 ? merged duplicate content from related documents.
## 🧭 개요

Niagara의 Scalability 시스템은 **성능과 품질 사이의 균형을 자동으로 관리**하는 핵심 시스템입니다. 이 시스템은 실시간으로 이펙트의 중요도를 평가하고, 거리, 가시성, 인스턴스 수, GPU 예산 등 다양한 기준에 따라 이펙트를 선택적으로 비활성화(Culling)합니다.

**핵심 목표:**
- 성능 목표(프레임레이트) 달성
- 시각적 품질 최대화 (중요한 이펙트 우선 유지)
- 플랫폼별 자동 조정 (PC, 콘솔, 모바일)

**핵심 철학:**
> UNiagaraEffectType은 "어떤 종류의 이펙트인가"를 정의하고,
> FNiagaraScalabilityManager는 "해당 종류의 모든 인스턴스를 추적하고 컬링"하며,
> FNiagaraWorldManager는 "월드 전체의 이펙트를 통합 관리"합니다.

---

## 🧱 시스템 아키텍처

### 전체 구조 다이어그램

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FNiagaraWorldManager                              │
│  (월드 전역 매니저 - 모든 이펙트 타입 관리)                           │
├─────────────────────────────────────────────────────────────────────┤
│  • TMap<UNiagaraEffectType*, FNiagaraScalabilityManager>            │
│  • CachedViewInfo: 카메라/뷰 정보 캐싱                                │
│  • UpdateScalabilityManagers(DeltaSeconds, bNewSpawnsOnly)          │
│                                                                      │
│  핵심 메서드:                                                         │
│  + DistanceCull()            // 거리 기반 컬링                        │
│  + ViewBasedCulling()        // 뷰 프러스텀/렌더 기반 컬링            │
│  + InstanceCountCull()       // 인스턴스 수 제한                      │
│  + GlobalBudgetCull()        // GPU 예산 기반 컬링                    │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ 관리
                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│             FNiagaraScalabilityManager (이펙트 타입별)                │
│  (동일 EffectType을 사용하는 모든 컴포넌트 추적)                      │
├─────────────────────────────────────────────────────────────────────┤
│  • EffectType: UNiagaraEffectType*                                  │
│  • ManagedComponents: TArray<UNiagaraComponent*>                    │
│  • State: TArray<FNiagaraScalabilityState>                          │
│  • SystemData: TArray<FNiagaraScalabilitySystemData>                │
│                                                                      │
│  핵심 메서드:                                                         │
│  + Update(DeltaSeconds, bNewOnly)                                   │
│  + Register(Component) / Unregister(Component)                      │
│  + EvaluateCullState()       // 각 컴포넌트 컬링 상태 평가            │
│  + ProcessSignificance()     // Significance Handler 실행            │
│  + ApplyScalabilityState()   // 컬링 결과 적용 (Deactivate 등)       │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ 사용
                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│                   UNiagaraEffectType                                 │
│  (이펙트 종류 정의 - 설정 및 정책)                                    │
├─────────────────────────────────────────────────────────────────────┤
│  • UpdateFrequency: ENiagaraScalabilityUpdateFrequency              │
│  • CullReaction: ENiagaraCullReaction                               │
│  • SignificanceHandler: UNiagaraSignificanceHandler*                │
│  • SystemScalabilitySettings: 플랫폼별 설정                           │
│  • NumInstances: 현재 활성 인스턴스 수                                │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ 포함
                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│           FNiagaraSystemScalabilitySettings                          │
│  (실제 컬링 기준 및 한계값)                                           │
├─────────────────────────────────────────────────────────────────────┤
│  • MaxDistance: 최대 거리 (거리 컬링)                                 │
│  • MaxInstances: 최대 인스턴스 수 (Effect Type 전체)                  │
│  • MaxSystemInstances: 최대 인스턴스 수 (System별)                    │
│  • VisibilityCulling: 가시성 관련 설정                                │
│  • BudgetScaling: GPU 예산 스케일링 설정                              │
│  • CullProxyMode: Cull Proxy 모드                                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔍 계층별 상세 분석

### 1. **UNiagaraEffectType - 이펙트 타입 정의**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEffectType.h:400`

**역할:** 동일한 특성을 가진 이펙트 그룹(예: 총격 이펙트, 환경 이펙트, 캐릭터 이펙트)의 스케일러빌리티 정책을 정의합니다.

**핵심 멤버:**

```cpp
// NiagaraEffectType.h:400
UCLASS(config = Niagara, perObjectConfig, MinimalAPI)
class UNiagaraEffectType : public UObject
{
    // 로컬 플레이어 소유 이펙트도 컬링 허용 여부
    UPROPERTY(EditAnywhere, Category = "Scalability")
    bool bAllowCullingForLocalPlayers = false;

    // 스케일러빌리티 체크 주기
    UPROPERTY(EditAnywhere, Category = "Scalability")
    ENiagaraScalabilityUpdateFrequency UpdateFrequency;

    // 컬링 시 반응 (Kill, Pause, Asleep 등)
    UPROPERTY(EditAnywhere, Category = "Scalability")
    ENiagaraCullReaction CullReaction;

    // Significance 계산 핸들러 (거리 기반, 나이 기반 등)
    UPROPERTY(EditAnywhere, Instanced, Category = "Scalability")
    TObjectPtr<UNiagaraSignificanceHandler> SignificanceHandler;

    // 플랫폼별 스케일러빌리티 설정
    UPROPERTY(EditAnywhere, Category = "Scalability")
    FNiagaraSystemScalabilitySettingsArray SystemScalabilitySettings;

    // 현재 활성 인스턴스 수 (런타임 추적)
    int32 NumInstances;

    // 마지막 업데이트 이후 새 시스템 추가 여부
    uint32 bNewSystemsSinceLastScalabilityUpdate : 1;
};
```

**제공 기능:**

1. **업데이트 주기 제어 (UpdateFrequency)**
   - `SpawnOnly`: 스폰 시에만 체크 (가장 가벼움)
   - `Low`: 1.0초마다 (기본값: `fx.NiagaraScalabilityUpdateTime_Low`)
   - `Medium`: 0.5초마다
   - `High`: 0.25초마다
   - `Continuous`: 매 프레임 (가장 정확하지만 비쌈)

2. **컬링 반응 정책 (CullReaction)**
   - `Deactivate (Kill)`: 비활성화 후 재활성화 안 됨, 파티클은 자연사
   - `DeactivateImmediate (Kill and Clear)`: 즉시 비활성화 및 파티클 제거
   - `DeactivateResume (Asleep)`: 비활성화 후 조건 충족 시 재활성화
   - `DeactivateImmediateResume (Asleep and Clear)`: 즉시 비활성화 후 재활성화 가능
   - `PauseResume (Pause)`: 일시정지 후 재개 (상태 유지)

**소스 검증:**
```cpp
// NiagaraEffectType.h:18-32
UENUM()
enum class ENiagaraCullReaction
{
    Deactivate UMETA(DisplayName = "Kill"),
    DeactivateImmediate UMETA(DisplayName = "Kill and Clear"),
    DeactivateResume UMETA(DisplayName = "Asleep"),
    DeactivateImmediateResume UMETA(DisplayName = "Asleep and Clear"),
    PauseResume UMETA(DisplayName = "Pause"),
};
```

---

### 2. **FNiagaraSystemScalabilitySettings - 실제 컬링 기준**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEffectType.h:186`

**역할:** 실제 컬링 임계값 및 활성화 조건을 정의합니다.

**핵심 구조:**

```cpp
// NiagaraEffectType.h:186
USTRUCT()
struct FNiagaraSystemScalabilitySettings
{
    GENERATED_USTRUCT_BODY()

    // 플랫폼 필터 (PC, 콘솔, 모바일 등)
    UPROPERTY(EditAnywhere, Category = "Scalability")
    FNiagaraPlatformSet Platforms;

    // === 거리 컬링 ===
    UPROPERTY(EditAnywhere, Category = "Scalability", meta = (InlineEditConditionToggle))
    uint32 bCullByDistance : 1;

    UPROPERTY(EditAnywhere, Category = "Scalability", meta = (EditCondition = "bCullByDistance"))
    float MaxDistance;  // 이 거리 이상이면 컬링

    // === 인스턴스 수 제한 ===
    // Effect Type 전체 인스턴스 수 제한
    UPROPERTY(EditAnywhere, Category = "Scalability", meta = (InlineEditConditionToggle))
    uint32 bCullMaxInstanceCount : 1;

    UPROPERTY(EditAnywhere, Category = "Scalability")
    int32 MaxInstances;

    // 특정 System별 인스턴스 수 제한
    UPROPERTY(EditAnywhere, Category = "Scalability", meta = (InlineEditConditionToggle))
    uint32 bCullPerSystemMaxInstanceCount : 1;

    UPROPERTY(EditAnywhere, Category = "Scalability")
    int32 MaxSystemInstances;

    // === 가시성 컬링 ===
    UPROPERTY(EditAnywhere, Category = "Scalability")
    FNiagaraSystemVisibilityCullingSettings VisibilityCulling;

    // === GPU 예산 스케일링 ===
    UPROPERTY(EditAnywhere, Category = "Scalability")
    FNiagaraGlobalBudgetScaling BudgetScaling;

    // === Cull Proxy 설정 ===
    UPROPERTY(EditAnywhere, Category = "Scalability")
    ENiagaraCullProxyMode CullProxyMode;

    UPROPERTY(EditAnywhere, Category = "Scalability")
    int32 MaxSystemProxies = 32;  // 최대 프록시 개수
};
```

**가시성 컬링 상세:**

```cpp
// NiagaraEffectType.h:153
USTRUCT()
struct FNiagaraSystemVisibilityCullingSettings
{
    // 렌더링되지 않을 때 컬링
    UPROPERTY(EditAnywhere, Category = "Scalability", meta = (InlineEditConditionToggle))
    uint32 bCullWhenNotRendered : 1;

    // 뷰 프러스텀 벗어날 때 컬링
    UPROPERTY(EditAnywhere, Category = "Scalability", meta = (InlineEditConditionToggle))
    uint32 bCullByViewFrustum : 1;

    // PreCull 시에도 뷰 프러스텀 체크 허용
    UPROPERTY(EditAnywhere, Category = "Scalability")
    uint32 bAllowPreCullingByViewFrustum : 1;

    // 뷰 프러스텀 벗어난 시간 한계
    UPROPERTY(EditAnywhere, Category = "Scalability")
    float MaxTimeOutsideViewFrustum;

    // 렌더링 안 된 시간 한계
    UPROPERTY(EditAnywhere, Category = "Scalability")
    float MaxTimeWithoutRender;
};
```

**GPU 예산 스케일링:**

```cpp
// NiagaraEffectType.h:112
USTRUCT()
struct FNiagaraGlobalBudgetScaling
{
    // GPU 예산 초과 시 컬링 여부
    UPROPERTY(EditAnywhere, Category = "Scalability")
    uint32 bCullByGlobalBudget : 1;

    // 예산 사용률에 따라 MaxDistance 스케일
    UPROPERTY(EditAnywhere, Category = "Scalability")
    uint32 bScaleMaxDistanceByGlobalBudgetUse : 1;

    // 예산 사용률 임계값 (1.0 = 100% 사용)
    UPROPERTY(EditAnywhere, Category = "Scalability")
    float MaxGlobalBudgetUsage;

    // 거리 스케일링 커브 (예산 사용률 → 거리 배율)
    UPROPERTY(EditAnywhere, Category = "Budget Scaling")
    FNiagaraLinearRamp MaxDistanceScaleByGlobalBudgetUse;

    // 인스턴스 수 스케일링 커브
    UPROPERTY(EditAnywhere, Category = "Budget Scaling")
    FNiagaraLinearRamp MaxInstanceCountScaleByGlobalBudgetUse;
};
```

---

### 3. **FNiagaraScalabilityManager - 이펙트 타입별 관리자**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraScalabilityManager.h:48`

**역할:** 동일한 `UNiagaraEffectType`을 사용하는 모든 컴포넌트를 추적하고, 스케일러빌리티 규칙을 적용합니다.

**핵심 구조:**

```cpp
// NiagaraScalabilityManager.h:48
USTRUCT()
struct FNiagaraScalabilityManager
{
    GENERATED_USTRUCT_BODY()

    FNiagaraWorldManager* WorldMan = nullptr;

    // 관리하는 Effect Type
    UPROPERTY(transient)
    TObjectPtr<UNiagaraEffectType> EffectType;

    // 등록된 모든 컴포넌트
    UPROPERTY(transient)
    TArray<TObjectPtr<UNiagaraComponent>> ManagedComponents;

    // 각 컴포넌트의 스케일러빌리티 상태
    TArray<FNiagaraScalabilityState> State;

    // System별 집계 데이터
    TMap<UNiagaraSystem*, int32> SystemDataIndexMap;
    TArray<FNiagaraScalabilitySystemData> SystemData;

    double LastUpdateTime;

    bool bRefreshOwnerAllowsScalability = false;

    // 핵심 메서드
    void Update(float DeltaSeconds, bool bNewOnly);
    void Register(UNiagaraComponent* Component);
    void Unregister(UNiagaraComponent* Component);
};
```

**System Data 구조:**

```cpp
// NiagaraScalabilityManager.h:30
struct FNiagaraScalabilitySystemData
{
    uint16 InstanceCount = 0;       // 현재 활성 인스턴스 수
    uint16 CullProxyCount = 0;      // 현재 Cull Proxy 개수

    // Significance 필요 여부 플래그
    uint16 bNeedsSignificanceForActiveOrDirty : 1;
    uint16 bNeedsSignificanceForCulled : 1;
};
```

**동작 흐름:**

```
┌────────────────────────────────────────────────────────────────┐
│          FNiagaraScalabilityManager::Update()                  │
└────────────────────────┬───────────────────────────────────────┘
                         │
                         ↓
         ┌───────────────────────────────┐
         │   UpdateFrequency 체크         │
         │   (마지막 업데이트 이후 시간)   │
         └───────────────┬───────────────┘
                         │
                         ↓
         ┌───────────────────────────────┐
         │   UpdateInternal()            │
         └───────────────┬───────────────┘
                         │
         ┌───────────────┴───────────────┐
         ↓                               ↓
┌──────────────────────┐      ┌──────────────────────┐
│ EvaluateCullState()  │      │ ProcessSignificance()│
│ (각 컴포넌트 평가)    │      │ (Significance 정렬)  │
│                      │      │                      │
│ - DistanceCull()     │      │ - Handler 실행       │
│ - ViewBasedCulling() │      │ - 중요도 순 정렬     │
│ - InstanceCountCull()│      │ - Index 재할당       │
│ - GlobalBudgetCull() │      │                      │
└──────────┬───────────┘      └──────────┬───────────┘
           │                             │
           └──────────────┬──────────────┘
                          ↓
         ┌───────────────────────────────┐
         │  ApplyScalabilityState()      │
         │  (Deactivate/Pause 등 실행)   │
         └───────────────────────────────┘
```

**소스 검증 - Update 로직:**

```cpp
// NiagaraScalabilityManager.cpp:560
void FNiagaraScalabilityManager::Update(float DeltaSeconds, bool bNewOnly)
{
    if (bRefreshCachedSystemData)
    {
        // System Data 캐시 리프레시
        bRefreshCachedSystemData = false;
        SystemDataIndexMap.Reset();
        SystemData.Reset();

        for (int32 CompIdx = 0; CompIdx < ManagedComponents.Num(); ++CompIdx)
        {
            GetSystemData(CompIdx, true);
        }
    }

    // 스케일러빌리티 비활성화 시 모든 컴포넌트 등록 해제
    bool bShutdown = EffectType == nullptr ||
                     FNiagaraWorldManager::GetScalabilityCullingMode() == ENiagaraScalabilityCullingMode::Disabled;
    if (bShutdown)
    {
        while (ManagedComponents.Num())
        {
            ManagedComponents.Last()->UnregisterWithScalabilityManager();
        }
        return;
    }

    float WorstGlobalBudgetUse = FFXBudget::GetWorstAdjustedUsage();

    if (bNewOnly)
    {
        // 새 인스턴스만 처리
        if (!EffectType->bNewSystemsSinceLastScalabilityUpdate)
        {
            return;
        }

        FComponentIterationContext NewComponentContext;
        NewComponentContext.bNewOnly = true;
        NewComponentContext.bProcessAllComponents = true;
        EffectType->bNewSystemsSinceLastScalabilityUpdate = false;
        NewComponentContext.WorstGlobalBudgetUse = WorstGlobalBudgetUse;

        UpdateInternal(NewComponentContext);
        return;
    }

    // UpdateFrequency에 따른 주기적 업데이트
    const double CurrentTime = WorldMan->GetWorld()->GetTimeSeconds();
    const float TimeSinceUpdate = float(CurrentTime - LastUpdateTime);
    const float UpdatePeriod = GetScalabilityUpdatePeriod(EffectType->UpdateFrequency);

    const bool bResetUpdate = bRefreshOwnerAllowsScalability ||
                              EffectType->UpdateFrequency == ENiagaraScalabilityUpdateFrequency::Continuous ||
                              ((TimeSinceUpdate >= UpdatePeriod) && !DefaultContext.ComponentRequiresUpdate.Contains(true));

    if (bResetUpdate)
    {
        LastUpdateTime = CurrentTime;
        DefaultContext.MaxUpdateCount = GetMaxUpdatesPerFrame(EffectType, ManagedComponents.Num(), UpdatePeriod, DeltaSeconds);
        DefaultContext.bProcessAllComponents = bRefreshOwnerAllowsScalability ||
                                               DefaultContext.MaxUpdateCount == ManagedComponents.Num();
        // ...
    }

    DefaultContext.WorstGlobalBudgetUse = WorstGlobalBudgetUse;
    UpdateInternal(DefaultContext);

    bRefreshOwnerAllowsScalability = false;
}
```

**EvaluateCullState 상세:**

```cpp
// NiagaraScalabilityManager.cpp:208
bool FNiagaraScalabilityManager::EvaluateCullState(FComponentIterationContext& Context, int32 ComponentIndex, int32& UpdateCounter)
{
    check(ManagedComponents.IsValidIndex(ComponentIndex));
    UNiagaraComponent* Component = ManagedComponents[ComponentIndex];

    if (!Component || !IsValid(Component))
    {
        UnregisterAt(ComponentIndex);
        return false;
    }

    FNiagaraScalabilityState& CompState = State[ComponentIndex];

    const bool UpdateScalability = Component->ScalabilityManagerHandle == ComponentIndex
        && (!Context.bNewOnly || CompState.bNewlyRegistered);

    if (UpdateScalability)
    {
        UNiagaraSystem* System = Component->GetAsset();
        if (System == nullptr)
        {
            Unregister(Component);
            return false;
        }

        CompState.bNewlyRegisteredDirty = CompState.bNewlyRegistered;
        CompState.bNewlyRegistered = false;

        const FNiagaraSystemScalabilitySettings& Scalability = System->GetScalabilitySettings();
        const FNiagaraScalabilitySystemData& SysData = GetSystemData(ComponentIndex);

        #if DEBUG_SCALABILITY_STATE
        CompState.bCulledByInstanceCount = false;
        CompState.bCulledByDistance = false;
        CompState.bCulledByVisibility = false;
        #endif

        // WorldManager의 컬링 함수 호출
        WorldMan->CalculateScalabilityState(System, Scalability, EffectType, Component, false, Context.WorstGlobalBudgetUse, CompState);

        bool bNeedSortedSignificane = (SysData.bNeedsSignificanceForActiveOrDirty && (!CompState.bCulled || CompState.IsDirty()))
                                    || SysData.bNeedsSignificanceForCulled;
        if (bNeedSortedSignificane)
        {
            Context.bRequiresGlobalSignificancePass |= System->NeedsSortedSignificanceCull();
        }

        Context.bHasDirtyState |= CompState.IsDirty();
        ++UpdateCounter;
    }

    return true;
}
```

---

### 4. **FNiagaraScalabilityState - 컴포넌트별 상태**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraScalabilityState.h:10`

**역할:** 각 컴포넌트의 현재 스케일러빌리티 상태를 추적합니다.

**핵심 구조:**

```cpp
// NiagaraScalabilityState.h:10
USTRUCT()
struct FNiagaraScalabilityState
{
    GENERATED_BODY()

    // 중요도 (0.0 ~ 1.0, 높을수록 중요)
    UPROPERTY(VisibleAnywhere, Category="Scalability")
    float Significance;

    // 마지막으로 보인 시간
    UPROPERTY(VisibleAnywhere, Category = "Scalability")
    float LastVisibleTime;

    // SystemData 배열의 인덱스
    int16 SystemDataIndex;

    // 새로 등록된 컴포넌트 여부
    UPROPERTY(VisibleAnywhere, Category = "Scalability")
    uint8 bNewlyRegistered : 1;

    UPROPERTY(VisibleAnywhere, Category = "Scalability")
    uint8 bNewlyRegisteredDirty : 1;

    // === 컬링 상태 플래그 ===
    UPROPERTY(VisibleAnywhere, Category = "Scalability")
    uint8 bCulled : 1;  // 현재 컬링됨

    UPROPERTY(VisibleAnywhere, Category="Scalability")
    uint8 bPreviousCulled : 1;  // 이전 프레임 컬링 상태

    // === 컬링 이유별 플래그 (디버깅용) ===
    UPROPERTY(VisibleAnywhere, Category="Scalability")
    uint8 bCulledByDistance : 1;

    UPROPERTY(VisibleAnywhere, Category = "Scalability")
    uint8 bCulledByInstanceCount : 1;

    UPROPERTY(VisibleAnywhere, Category = "Scalability")
    uint8 bCulledByVisibility : 1;

    UPROPERTY(VisibleAnywhere, Category = "Scalability")
    uint8 bCulledByGlobalBudget : 1;

    // Dirty 체크: 상태가 변경되었는가?
    bool IsDirty() const { return bCulled != bPreviousCulled; }

    // 상태 적용: 이전 상태를 현재 상태로 동기화
    void Apply() { bPreviousCulled = bCulled; }
};
```

**상태 전환 다이어그램:**

```
[새 컴포넌트 생성]
       ↓
  bNewlyRegistered = true
       ↓
  Register() → Manager에 등록
       ↓
  EvaluateCullState()
       ↓
  ┌────────────────┐
  │ bCulled = ?    │ ← DistanceCull, ViewBasedCulling 등 실행
  └────────────────┘
       ↓
  ProcessSignificance() (SignificanceHandler 있으면)
       ↓
  ┌────────────────┐
  │ IsDirty()?     │ → bCulled != bPreviousCulled
  └────────────────┘
       ↓ Yes
  ApplyScalabilityState()
       ↓
  ┌─────────────────────────────────┐
  │ Deactivate / Pause / Resume     │
  └─────────────────────────────────┘
       ↓
  Apply() → bPreviousCulled = bCulled
```

---

### 5. **UNiagaraSignificanceHandler - 중요도 계산**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEffectType.h:362`

**역할:** 여러 이펙트 인스턴스 간의 상대적 중요도를 계산합니다. 인스턴스 수 제한 시 중요도가 낮은 것부터 컬링됩니다.

**기본 클래스:**

```cpp
// NiagaraEffectType.h:362
UCLASS(abstract, EditInlineNew, MinimalAPI)
class UNiagaraSignificanceHandler : public UObject
{
    GENERATED_BODY()

public:
    virtual void CalculateSignificance(
        TConstArrayView<UNiagaraComponent*> Components,
        TArrayView<FNiagaraScalabilityState> OutState,
        TConstArrayView<FNiagaraScalabilitySystemData> SystemData,
        TArray<int32>& OutIndices
    ) PURE_VIRTUAL(CalculateSignificance, );
};
```

**내장 Significance Handler 종류:**

#### 5.1. **UNiagaraSignificanceHandlerDistance - 거리 기반**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEffectType.h:372`

**로직:** 카메라에 가까울수록 높은 중요도를 부여합니다.

```cpp
// NiagaraEffectType.cpp:284
void UNiagaraSignificanceHandlerDistance::CalculateSignificance(
    TConstArrayView<UNiagaraComponent*> Components,
    TArrayView<FNiagaraScalabilityState> OutState,
    TConstArrayView<FNiagaraScalabilitySystemData> SystemData,
    TArray<int32>& OutIndices)
{
    const int32 ComponentCount = Components.Num();
    check(ComponentCount == OutState.Num());

    for (int32 CompIdx = 0; CompIdx < ComponentCount; ++CompIdx)
    {
        FNiagaraScalabilityState& State = OutState[CompIdx];
        const FNiagaraScalabilitySystemData& SysData = SystemData[State.SystemDataIndex];

        const bool AddIndex = (SysData.bNeedsSignificanceForActiveOrDirty && (!State.bCulled || State.IsDirty()))
                            || SysData.bNeedsSignificanceForCulled;

        if (State.bCulled && !SysData.bNeedsSignificanceForCulled)
        {
            State.Significance = 0.0f;
        }
        else
        {
            UNiagaraComponent* Component = Components[CompIdx];

            float LODDistance = 0.0f;
            if (Component->bEnablePreviewLODDistance)
            {
                LODDistance = Component->PreviewLODDistance;
            }
            else if (FNiagaraSystemInstanceControllerConstPtr Controller = Component->GetSystemInstanceController())
            {
                LODDistance = Controller->GetLODDistance();
            }

            // 역수로 계산: 가까울수록 높은 Significance
            State.Significance = 1.0f / LODDistance;
        }

        if (AddIndex)
        {
            OutIndices.Add(CompIdx);
        }
    }
}
```

**특징:**
- **가까운 이펙트 = 높은 Significance**
- LODDistance 사용 (카메라~컴포넌트 거리)
- `Significance = 1.0 / Distance` 공식

#### 5.2. **UNiagaraSignificanceHandlerAge - 나이 기반**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEffectType.h:382`

**로직:** 최근 생성된 이펙트일수록 높은 중요도를 부여합니다.

```cpp
// NiagaraEffectType.cpp:324
void UNiagaraSignificanceHandlerAge::CalculateSignificance(
    TConstArrayView<UNiagaraComponent*> Components,
    TArrayView<FNiagaraScalabilityState> OutState,
    TConstArrayView<FNiagaraScalabilitySystemData> SystemData,
    TArray<int32>& OutIndices)
{
    const int32 ComponentCount = Components.Num();
    check(ComponentCount == OutState.Num());

    for (int32 CompIdx = 0; CompIdx < ComponentCount; ++CompIdx)
    {
        FNiagaraScalabilityState& State = OutState[CompIdx];
        const FNiagaraScalabilitySystemData& SysData = SystemData[State.SystemDataIndex];
        const bool AddIndex = (SysData.bNeedsSignificanceForActiveOrDirty && (!State.bCulled || State.IsDirty()))
                            || SysData.bNeedsSignificanceForCulled;

        if (State.bCulled)
        {
            State.Significance = 0.0f;
        }
        else
        {
            UNiagaraComponent* Component = Components[CompIdx];

            if (FNiagaraSystemInstanceControllerConstPtr Controller = Component->GetSystemInstanceController())
            {
                // 역수로 계산: 최근 생성일수록 Age가 작아 Significance 높음
                State.Significance = 1.0f / Controller->GetAge();
            }
        }

        if (AddIndex)
        {
            OutIndices.Add(CompIdx);
        }
    }
}
```

**특징:**
- **새로운 이펙트 = 높은 Significance**
- `Significance = 1.0 / Age` 공식
- 총격 이펙트처럼 최신 타격 효과를 우선시할 때 유용

---

### 6. **FNiagaraWorldManager - 월드 전역 관리**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraWorldManager.h:95`

**역할:** 월드 내 모든 Niagara 이펙트 시스템을 통합 관리하며, 실제 컬링 로직을 실행합니다.

**핵심 멤버:**

```cpp
// NiagaraWorldManager.h:95
class FNiagaraWorldManager : public FGCObject
{
private:
    UWorld* World = nullptr;

    // Effect Type별 Scalability Manager
    TMap<TObjectPtr<UNiagaraEffectType>, FNiagaraScalabilityManager> ScalabilityManagers;

    // 뷰 정보 캐싱 (카메라 위치, 프러스텀 등)
    TArray<FNiagaraCachedViewInfo, TInlineAllocator<8>> CachedViewInfo;

    // Component Pool (재사용)
    TObjectPtr<UNiagaraComponentPool> ComponentPool;

    // 앱 포커스 상태 (포커스 없으면 일부 컬링 비활성화)
    bool bAppHasFocus;

    // 전역 Scalability Culling 모드
    static ENiagaraScalabilityCullingMode ScalabilityCullingMode;

public:
    // 스케일러빌리티 매니저 업데이트
    void UpdateScalabilityManagers(float DeltaSeconds, bool bNewSpawnsOnly);

    // 컴포넌트 등록/해제
    void RegisterWithScalabilityManager(UNiagaraComponent* Component, UNiagaraEffectType* EffectType);
    void UnregisterWithScalabilityManager(UNiagaraComponent* Component, UNiagaraEffectType* EffectType);

    // PreCull 체크 (스폰 전 컬링)
    NIAGARA_API bool ShouldPreCull(UNiagaraSystem* System, UNiagaraComponent* Component);
    NIAGARA_API bool ShouldPreCull(UNiagaraSystem* System, FVector Location);

    // 스케일러빌리티 상태 계산
    void CalculateScalabilityState(
        UNiagaraSystem* System,
        const FNiagaraSystemScalabilitySettings& ScalabilitySettings,
        UNiagaraEffectType* EffectType,
        UNiagaraComponent* Component,
        bool bIsPreCull,
        float WorstGlobalBudgetUse,
        FNiagaraScalabilityState& OutState
    );

    // 개별 컬링 함수들
    void DistanceCull(
        UNiagaraEffectType* EffectType,
        const FNiagaraSystemScalabilitySettings& ScalabilitySettings,
        UNiagaraComponent* Component,
        FNiagaraScalabilityState& OutState
    );

    void ViewBasedCulling(
        UNiagaraEffectType* EffectType,
        const FNiagaraSystemScalabilitySettings& ScalabilitySettings,
        FSphere BoundingSphere,
        float ComponentTimeSinceRendered,
        bool bIsPrecull,
        FNiagaraScalabilityState& OutState
    );

    void InstanceCountCull(
        UNiagaraEffectType* EffectType,
        UNiagaraSystem* System,
        const FNiagaraSystemScalabilitySettings& ScalabilitySettings,
        FNiagaraScalabilityState& OutState
    );

    void GlobalBudgetCull(
        const FNiagaraSystemScalabilitySettings& ScalabilitySettings,
        float WorstGlobalBudgetUse,
        FNiagaraScalabilityState& OutState
    );

    void SortedSignificanceCull(
        UNiagaraEffectType* EffectType,
        UNiagaraComponent* Component,
        const FNiagaraSystemScalabilitySettings& ScalabilitySettings,
        float Significance,
        int32& EffectTypeInstCount,
        uint16& SystemInstCount,
        FNiagaraScalabilityState& OutState
    );
};
```

**View Info 캐싱:**

```cpp
// NiagaraWorldManager.h:82
struct FNiagaraCachedViewInfo
{
    FMatrix ViewMat;
    FMatrix ProjectionMat;
    FMatrix ViewProjMat;
    FMatrix ViewToWorld;
    TArray<FPlane, TInlineAllocator<6>> FrutumPlanes;  // 뷰 프러스텀 평면들

    void Init(const FWorldCachedViewInfo& WorldViewInfo);
};
```

---

## 🛠️ 컬링 메커니즘 상세

### 1. **Distance Culling (거리 컬링)**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraWorldManager.cpp:2303`

**작동 방식:**

```cpp
// NiagaraWorldManager.cpp:2303
void FNiagaraWorldManager::DistanceCull(
    UNiagaraEffectType* EffectType,
    const FNiagaraSystemScalabilitySettings& ScalabilitySettings,
    UNiagaraComponent* Component,
    FNiagaraScalabilityState& OutState)
{
    float LODDistance = 0.0f;

    if (Component->bEnablePreviewLODDistance)
    {
        LODDistance = Component->PreviewLODDistance;
    }
    else if(GetCachedViewInfo().Num() > 0)
    {
        // 모든 뷰(카메라)에서 가장 가까운 거리 계산
        float ClosestDistSq = FLT_MAX;
        FVector Location = Component->GetComponentLocation();
        for (const FNiagaraCachedViewInfo& ViewInfo : GetCachedViewInfo())
        {
            ClosestDistSq = FMath::Min(ClosestDistSq, float(FVector::DistSquared(ViewInfo.ViewToWorld.GetOrigin(), Location)));
        }

        LODDistance = FMath::Sqrt(ClosestDistSq);
    }

    // LOD Distance 설정 (다른 시스템에서도 사용)
    float MaxDist = ScalabilitySettings.MaxDistance;
    Component->SetLODDistance(LODDistance, FMath::Max(MaxDist, 1.0f));

    if (GetScalabilityCullingMode() == ENiagaraScalabilityCullingMode::Enabled &&
        GEnableNiagaraDistanceCulling &&
        ScalabilitySettings.bCullByDistance)
    {
        bool bCull = LODDistance > MaxDist;
        OutState.bCulled |= bCull;

        // GPU 예산 기반 거리 스케일링
        bool bBudgetCullEnabled = GEnableNiagaraGlobalBudgetCulling && FFXBudget::Enabled() && INiagaraModule::UseGlobalFXBudget();
        if (bCull)
        {
            #if DEBUG_SCALABILITY_STATE
            OutState.bCulledByGlobalBudget = false;  // 거리로 이미 컬링됨
            #endif
        }
        else if (bBudgetCullEnabled && ScalabilitySettings.BudgetScaling.bScaleMaxDistanceByGlobalBudgetUse)
        {
            float Usage = FFXBudget::GetWorstAdjustedUsage();
            float Scale = ScalabilitySettings.BudgetScaling.MaxDistanceScaleByGlobalBudgetUse.Evaluate(Usage);
            MaxDist *= Scale;  // 예산 사용률에 따라 거리 축소

            bCull = LODDistance > MaxDist;

            #if DEBUG_SCALABILITY_STATE
            OutState.bCulledByGlobalBudget |= bCull;
            #endif
        }

        #if DEBUG_SCALABILITY_STATE
        OutState.bCulledByDistance = bCull;
        #endif
        OutState.bCulled |= bCull;
    }
}
```

**핵심 로직:**
1. **다중 뷰 지원**: 모든 카메라에서 가장 가까운 거리 사용
2. **LOD Distance 계산**: 컴포넌트 위치 ~ 카메라 거리
3. **MaxDistance 비교**: `LODDistance > MaxDistance` → 컬링
4. **Budget Scaling**: GPU 예산 초과 시 MaxDistance 동적 감소

**Console Variable:**
```cpp
// NiagaraWorldManager.cpp:154
static int GEnableNiagaraDistanceCulling = 1;
static FAutoConsoleVariableRef CVarEnableNiagaraDistanceCulling(
    TEXT("fx.Niagara.Scalability.DistanceCulling"),
    GEnableNiagaraDistanceCulling,
    TEXT("When non-zero, high level scalability culling based on distance is enabled."),
    ECVF_Default
);
```

---

### 2. **View-Based Culling (뷰 프러스텀/렌더 컬링)**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraWorldManager.cpp:2182`

**작동 방식:**

```cpp
// NiagaraWorldManager.cpp:2182
void FNiagaraWorldManager::ViewBasedCulling(
    UNiagaraEffectType* EffectType,
    const FNiagaraSystemScalabilitySettings& ScalabilitySettings,
    FSphere BoundingSphere,
    float ComponentTimeSinceRendered,
    bool bIsPrecull,
    FNiagaraScalabilityState& OutState)
{
    if (GetScalabilityCullingMode() != ENiagaraScalabilityCullingMode::Enabled)
    {
        return;
    }

    bool bInsideAnyView = !ScalabilitySettings.VisibilityCulling.bCullByViewFrustum;

    // === 1. 뷰 프러스텀 체크 ===
    if (ScalabilitySettings.VisibilityCulling.bCullByViewFrustum)
    {
        for (FNiagaraCachedViewInfo& ViewInfo : CachedViewInfo)
        {
            bool bInsideThisView = true;
            if (bInsideAnyView == false)
            {
                // 6개의 프러스텀 평면과 구 충돌 검사
                for (FPlane& FrustumPlane : ViewInfo.FrutumPlanes)
                {
                    if (FrustumPlane.IsValid())
                    {
                        // Plane Dot 계산: dot(Plane, Sphere.xyz) - Plane.w <= Sphere.w
                        bool bInside = FrustumPlane.PlaneDot(BoundingSphere.Center) <= BoundingSphere.W;
                        if (!bInside)
                        {
                            bInsideThisView = false;
                            break;
                        }
                    }
                }
            }

            if (bInsideThisView)
            {
                bInsideAnyView = true;
            }
        }

        // 뷰가 없으면 컬링하지 않음 (예: 리레지스터 컨텍스트)
        bInsideAnyView |= CachedViewInfo.Num() == 0;
    }

    // === 2. LastVisibleTime 업데이트 ===
    float TimeSinceInsideView = 0.0f;
    if (bInsideAnyView)
    {
        OutState.LastVisibleTime = static_cast<float>(World->GetTimeSeconds());
    }
    else
    {
        TimeSinceInsideView = static_cast<float>(World->GetTimeSeconds() - OutState.LastVisibleTime);
    }

    // === 3. 컬링 조건 체크 ===
    bool bCullByOutsideViewFrustum = ScalabilitySettings.VisibilityCulling.bCullByViewFrustum &&
        (!bIsPrecull || ScalabilitySettings.VisibilityCulling.bAllowPreCullingByViewFrustum) &&
        TimeSinceInsideView > ScalabilitySettings.VisibilityCulling.MaxTimeOutsideViewFrustum;

    // 렌더링 시간 체크 (앱 포커스 있을 때만)
    bool bCullByNotRendered = bAppHasFocus &&
                              ScalabilitySettings.VisibilityCulling.bCullWhenNotRendered &&
                              ComponentTimeSinceRendered > ScalabilitySettings.VisibilityCulling.MaxTimeWithoutRender;

    bool bCull = bCullByNotRendered || bCullByOutsideViewFrustum;

    OutState.bCulled |= bCull;
    #if DEBUG_SCALABILITY_STATE
    OutState.bCulledByVisibility = bCull;
    #endif
}
```

**핵심 로직:**

1. **뷰 프러스텀 체크 (View Frustum Culling)**
   - 6개의 프러스텀 평면과 Bounding Sphere 충돌 검사
   - 하나의 뷰라도 안에 있으면 통과
   - `MaxTimeOutsideViewFrustum` 초과 시 컬링

2. **렌더링 체크 (Render Culling)**
   - `LastRenderTime` 추적
   - `MaxTimeWithoutRender` 초과 시 컬링
   - 앱 포커스 없으면 비활성화 (Alt+Tab 대응)

**프러스텀 평면 충돌 공식:**
```
bool bInside = FrustumPlane.PlaneDot(Sphere.Center) <= Sphere.W

where:
  PlaneDot(Point) = Plane.X * Point.X + Plane.Y * Point.Y + Plane.Z * Point.Z - Plane.W

If PlaneDot <= SphereRadius → Sphere는 평면 안쪽 (보임)
If PlaneDot > SphereRadius → Sphere는 평면 바깥쪽 (컬링)
```

**Console Variable:**
```cpp
// NiagaraWorldManager.cpp:145
static int GEnableNiagaraVisCulling = 1;
static FAutoConsoleVariableRef CVarEnableNiagaraVisCulling(
    TEXT("fx.Niagara.Scalability.VisibilityCulling"),
    GEnableNiagaraVisCulling,
    TEXT("When non-zero, high level scalability culling based on visibility is enabled."),
    ECVF_Default
);
```

---

### 3. **Instance Count Culling (인스턴스 수 제한)**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraWorldManager.cpp:2253`

**작동 방식:**

```cpp
// NiagaraWorldManager.cpp:2253
void FNiagaraWorldManager::InstanceCountCull(
    UNiagaraEffectType* EffectType,
    UNiagaraSystem* System,
    const FNiagaraSystemScalabilitySettings& ScalabilitySettings,
    FNiagaraScalabilityState& OutState)
{
    if (GetScalabilityCullingMode() != ENiagaraScalabilityCullingMode::Enabled)
    {
        return;
    }

    int32 SystemInstanceMax = ScalabilitySettings.MaxSystemInstances;
    int32 EffectTypeInstanceMax = ScalabilitySettings.MaxInstances;

    // === 1. 기본 인스턴스 수 체크 ===
    bool bCull = ScalabilitySettings.bCullMaxInstanceCount && EffectType->NumInstances >= EffectTypeInstanceMax;
    bCull |= ScalabilitySettings.bCullPerSystemMaxInstanceCount && System->GetActiveInstancesCount() >= SystemInstanceMax;

    bool bBudgetCullEnabled = GEnableNiagaraGlobalBudgetCulling && FFXBudget::Enabled() && INiagaraModule::UseGlobalFXBudget();

    if (bCull)
    {
        #if DEBUG_SCALABILITY_STATE
        OutState.bCulledByGlobalBudget = false;  // 인스턴스 수로 이미 컬링됨
        #endif
    }
    // === 2. GPU 예산 기반 인스턴스 수 스케일링 ===
    else if (bBudgetCullEnabled &&
            (ScalabilitySettings.BudgetScaling.bScaleMaxInstanceCountByGlobalBudgetUse ||
             ScalabilitySettings.BudgetScaling.bScaleSystemInstanceCountByGlobalBudgetUse))
    {
        float Usage = FFXBudget::GetWorstAdjustedUsage();

        if (ScalabilitySettings.BudgetScaling.bScaleMaxInstanceCountByGlobalBudgetUse)
        {
            const float Scale = ScalabilitySettings.BudgetScaling.MaxInstanceCountScaleByGlobalBudgetUse.Evaluate(Usage);
            EffectTypeInstanceMax = int32(float(EffectTypeInstanceMax) * Scale);
        }
        if (ScalabilitySettings.BudgetScaling.bScaleSystemInstanceCountByGlobalBudgetUse)
        {
            const float Scale = ScalabilitySettings.BudgetScaling.MaxSystemInstanceCountScaleByGlobalBudgetUse.Evaluate(Usage);
            SystemInstanceMax = int32(float(SystemInstanceMax) * Scale);
        }

        bCull = ScalabilitySettings.bCullMaxInstanceCount && EffectType->NumInstances >= EffectTypeInstanceMax;
        bCull |= ScalabilitySettings.bCullPerSystemMaxInstanceCount && System->GetActiveInstancesCount() >= SystemInstanceMax;

        OutState.bCulled |= bCull;
        #if DEBUG_SCALABILITY_STATE
        OutState.bCulledByGlobalBudget |= bCull;
        #endif
    }

    OutState.bCulled |= bCull;
    #if DEBUG_SCALABILITY_STATE
    OutState.bCulledByInstanceCount = bCull;
    #endif
}
```

**두 가지 인스턴스 제한:**

1. **Effect Type 전체 제한 (`MaxInstances`)**
   - 동일 EffectType을 사용하는 모든 시스템 합산
   - 예: "총격 이펙트"는 전체 50개까지만 허용
   - `EffectType->NumInstances >= MaxInstances` → 컬링

2. **System별 제한 (`MaxSystemInstances`)**
   - 특정 UNiagaraSystem의 인스턴스 수 제한
   - 예: "Explosion01"은 10개까지만 허용
   - `System->GetActiveInstancesCount() >= MaxSystemInstances` → 컬링

**Budget Scaling:**
- GPU 예산 초과 시 인스턴스 제한 동적 감소
- 예: `Usage = 1.2` (120% 사용) → `Scale = 0.7` → `MaxInstances *= 0.7`

**Console Variable:**
```cpp
// NiagaraWorldManager.cpp:162
static int GEnableNiagaraInstanceCountCulling = 1;
static FAutoConsoleVariableRef CVarEnableNiagaraInstanceCountCulling(
    TEXT("fx.Niagara.Scalability.InstanceCountCulling"),
    GEnableNiagaraInstanceCountCulling,
    TEXT("When non-zero, high level scalability culling based on instance count is enabled."),
    ECVF_Default
);
```

---

### 4. **Sorted Significance Culling (중요도 정렬 컬링)**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraWorldManager.cpp:2127`

이 메서드는 **SignificanceHandler가 있을 때** 인스턴스 수 제한을 적용하는 고급 컬링 방식입니다.

**작동 방식:**

```cpp
// NiagaraWorldManager.cpp:2127
void FNiagaraWorldManager::SortedSignificanceCull(
    UNiagaraEffectType* EffectType,
    UNiagaraComponent* Component,
    const FNiagaraSystemScalabilitySettings& ScalabilitySettings,
    float Significance,
    int32& EffectTypeInstCount,
    uint16& SystemInstCount,
    FNiagaraScalabilityState& OutState)
{
    bool bCull = false;

    if(GetScalabilityCullingMode() == ENiagaraScalabilityCullingMode::Enabled && GEnableNiagaraInstanceCountCulling)
    {
        UNiagaraSystem* System = Component->GetAsset();
        check(System);

        int32 SystemInstanceMax = 0;
        int32 EffectTypeInstanceMax = 0;
        System->GetMaxInstanceCounts(SystemInstanceMax, EffectTypeInstanceMax, false);

        // === 기본 인스턴스 수 체크 ===
        bCull = ScalabilitySettings.bCullMaxInstanceCount && EffectTypeInstCount >= EffectTypeInstanceMax;
        bCull |= ScalabilitySettings.bCullPerSystemMaxInstanceCount && SystemInstCount >= SystemInstanceMax;

        bool bBudgetCullEnabled = GEnableNiagaraGlobalBudgetCulling && FFXBudget::Enabled() && INiagaraModule::UseGlobalFXBudget();

        if (bCull)
        {
            #if DEBUG_SCALABILITY_STATE
            OutState.bCulledByGlobalBudget = false;
            #endif
        }
        // === Budget 기반 조정 ===
        else if (bBudgetCullEnabled)
        {
            System->GetMaxInstanceCounts(SystemInstanceMax, EffectTypeInstanceMax, bBudgetCullEnabled);

            bCull = ScalabilitySettings.bCullMaxInstanceCount && EffectTypeInstCount >= EffectTypeInstanceMax;
            bCull |= ScalabilitySettings.bCullPerSystemMaxInstanceCount && SystemInstCount >= SystemInstanceMax;

            #if DEBUG_SCALABILITY_STATE
            OutState.bCulledByGlobalBudget |= bCull;
            #endif
        }
    }

    OutState.bCulled |= bCull;

    // === 인스턴스 카운터 증가 (컬링되지 않은 것만) ===
    if(OutState.bCulled == false)
    {
        ++EffectTypeInstCount;
        ++SystemInstCount;
    }

    #if DEBUG_SCALABILITY_STATE
    OutState.bCulledByInstanceCount = bCull;
    #endif
}
```

**ProcessSignificance 흐름:**

```cpp
// NiagaraScalabilityManager.cpp:278
void FNiagaraScalabilityManager::ProcessSignificance(
    UNiagaraSignificanceHandler* SignificanceHandler,
    FComponentIterationContext& Context)
{
    Context.SignificanceIndices.Reset(ManagedComponents.Num());

    // === 1. SignificanceHandler 실행 ===
    SignificanceHandler->CalculateSignificance(ManagedComponents, State, SystemData, Context.SignificanceIndices);

    // === 2. Significance 내림차순 정렬 ===
    auto ComparePredicate = [&](const FNiagaraScalabilityState& A, const FNiagaraScalabilityState& B)
    {
        return A.Significance > B.Significance;  // 높은 것이 우선
    };

    Context.SignificanceIndices.Sort([&](int32 A, int32 B) {
        return ComparePredicate(State[A], State[B]);
    });

    // SystemData 초기화
    for (FNiagaraScalabilitySystemData& SysData : SystemData)
    {
        SysData.InstanceCount = 0;
        SysData.CullProxyCount = 0;
    }

    int32 EffectTypeActiveInstances = 0;

    // === 3. 중요도 순으로 처리 ===
    for (int32 SortedIt = 0; SortedIt < Context.SignificanceIndices.Num(); ++SortedIt)
    {
        int32 SortedIdx = Context.SignificanceIndices[SortedIt];
        UNiagaraComponent* Component = ManagedComponents[SortedIdx];
        FNiagaraScalabilityState& CompState = State[SortedIdx];
        UNiagaraSystem* System = Component->GetAsset();
        const FNiagaraSystemScalabilitySettings& ScalabilitySettings = System->GetScalabilitySettings();

        FNiagaraScalabilitySystemData& SysData = GetSystemData(SortedIdx);

        if (CompState.bCulled)
        {
            if (CompState.IsDirty())
            {
                Component->SetSystemSignificanceIndex(INDEX_NONE);
            }
        }
        else
        {
            // === SortedSignificanceCull 호출 ===
            WorldMan->SortedSignificanceCull(EffectType, Component, ScalabilitySettings, CompState.Significance,
                                            EffectTypeActiveInstances, SysData.InstanceCount, CompState);

            // Significance Index 할당 (중요도 순위)
            int32 SignificanceIndex = CompState.bCulled ? INDEX_NONE : SysData.InstanceCount - 1;
            Component->SetSystemSignificanceIndex(SignificanceIndex);

            Context.bHasDirtyState |= CompState.IsDirty();
        }

        // === 4. Cull Proxy 처리 ===
        if (ScalabilitySettings.CullProxyMode != ENiagaraCullProxyMode::None)
        {
            if (CompState.bCulled)
            {
                bool bEnableCullProxy = SysData.CullProxyCount < ScalabilitySettings.MaxSystemProxies
                                     && CompState.bCulledByVisibility == false;  // 가시성으로 컬링된 것은 Proxy 안 함

                if (bEnableCullProxy)
                {
                    ++SysData.CullProxyCount;
                    Component->CreateCullProxy(true);
                }
            }
            else
            {
                Component->DestroyCullProxy();
            }
        }
    }
}
```

**Significance Culling 핵심 원리:**

1. **Handler 실행**: 모든 컴포넌트의 Significance 계산
2. **정렬**: Significance 내림차순 정렬 (높은 = 중요)
3. **순차 처리**: 중요도 높은 것부터 인스턴스 카운터 증가
4. **제한 체크**: `EffectTypeInstCount >= MaxInstances` → 이후는 모두 컬링
5. **Index 할당**: `SignificanceIndex = InstanceCount - 1` (Emitter가 내부적으로 사용 가능)

**예시:**
```
MaxInstances = 5

[정렬 후]
1. Component A - Significance: 10.0 → Pass (Index = 0)
2. Component B - Significance: 8.5  → Pass (Index = 1)
3. Component C - Significance: 7.2  → Pass (Index = 2)
4. Component D - Significance: 5.0  → Pass (Index = 3)
5. Component E - Significance: 3.1  → Pass (Index = 4)
6. Component F - Significance: 2.0  → Culled (EffectTypeInstCount >= 5)
7. Component G - Significance: 1.5  → Culled
...
```

---

### 5. **Global Budget Culling (GPU 예산 컬링)**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraWorldManager.cpp:2407`

**작동 방식:**

```cpp
// NiagaraWorldManager.cpp:2407
void FNiagaraWorldManager::GlobalBudgetCull(
    const FNiagaraSystemScalabilitySettings& ScalabilitySettings,
    float WorstGlobalBudgetUse,
    FNiagaraScalabilityState& OutState)
{
    bool bCull = GetScalabilityCullingMode() == ENiagaraScalabilityCullingMode::Enabled &&
                 WorstGlobalBudgetUse >= ScalabilitySettings.BudgetScaling.MaxGlobalBudgetUsage;

    OutState.bCulled |= bCull;
    #if DEBUG_SCALABILITY_STATE
    OutState.bCulledByGlobalBudget |= bCull;
    #endif
}
```

**핵심 개념:**

1. **WorstGlobalBudgetUse**: 모든 FX Budget 중 최악의 사용률
   - `FFXBudget::GetWorstAdjustedUsage()` 호출
   - 값: `0.0 ~ 1.0+` (1.0 = 100% 사용, 1.2 = 120% 초과)

2. **MaxGlobalBudgetUsage**: 설정된 임계값
   - 예: `0.9` → 90% 초과 시 컬링
   - 예: `1.0` → 100% 초과 시 컬링

3. **Budget Scaling 통합**:
   - `GlobalBudgetCull()`: 단순 ON/OFF 컬링
   - `BudgetScaling.bScaleMaxDistanceByGlobalBudgetUse`: 거리 동적 조정
   - `BudgetScaling.bScaleMaxInstanceCountByGlobalBudgetUse`: 인스턴스 수 동적 조정

**FXBudget 시스템:**

```
FX.Budget.Time (ms)       // 프레임당 CPU 시간 예산
FX.Budget.GameThreadTime  // 게임 쓰레드 시간 예산
FX.Budget.RenderThreadTime// 렌더 쓰레드 시간 예산
FX.Budget.VRAM (MB)       // VRAM 예산

Usage = ActualTime / BudgetTime
WorstGlobalBudgetUse = Max(GameThreadUsage, RenderThreadUsage, VRAMUsage)
```

**Budget Scaling 커브 예시:**

```cpp
// NiagaraEffectType.cpp:190
static const FNiagaraLinearRamp DefaultBudgetScaleRamp(0.5f, 1.0f, 1.0f, 0.5f);
// X축: Budget Usage (0.5 ~ 1.0)
// Y축: Scale Factor (1.0 ~ 0.5)

Usage = 0.5 → Scale = 1.0 (정상)
Usage = 0.75 → Scale = 0.75 (75%로 축소)
Usage = 1.0 → Scale = 0.5 (50%로 축소)
Usage > 1.0 → Scale = 0.5 (최소)
```

---

## 💡 최적화 팁 및 베스트 프랙티스

### ✅ 올바른 사용 예시

#### 1. **Effect Type별 그룹화**

```cpp
// 좋은 예: 특성에 따라 Effect Type 분리
UNiagaraEffectType* ImpactEffectType;     // 총격, 충돌 이펙트
UNiagaraEffectType* EnvironmentEffectType; // 연기, 먼지, 환경 이펙트
UNiagaraEffectType* CharacterEffectType;   // 캐릭터 스킬, 버프 이펙트

// ImpactEffectType 설정:
- UpdateFrequency: High (0.25s) - 빠른 반응 필요
- CullReaction: DeactivateImmediate - 총격은 빠르게 사라짐
- SignificanceHandler: Distance - 가까운 총격이 중요
- MaxInstances: 50

// EnvironmentEffectType 설정:
- UpdateFrequency: Low (1.0s) - 느린 업데이트 허용
- CullReaction: DeactivateResume - 다시 보이면 재활성화
- SignificanceHandler: Distance
- MaxInstances: 100
- MaxDistance: 5000.0

// CharacterEffectType 설정:
- UpdateFrequency: Continuous - 항상 정확히 관리
- CullReaction: PauseResume - 상태 유지 중요
- bAllowCullingForLocalPlayers: false - 플레이어 이펙트는 항상 표시
- MaxInstances: 20
```

#### 2. **플랫폼별 설정**

```cpp
// SystemScalabilitySettings 배열 설정

// [0] PC High-End
Platforms = Windows + High Quality
bCullByDistance = true
MaxDistance = 10000.0
MaxInstances = 100
MaxSystemInstances = 10
bCullWhenNotRendered = false  // 고사양 PC는 렌더 컬링 불필요

// [1] Console (PS5, Xbox Series)
Platforms = PS5 + XboxSeriesX + Medium Quality
bCullByDistance = true
MaxDistance = 8000.0
MaxInstances = 50
MaxSystemInstances = 5
bCullWhenNotRendered = true
MaxTimeWithoutRender = 2.0

// [2] Mobile
Platforms = Android + iOS + Low Quality
bCullByDistance = true
MaxDistance = 3000.0
MaxInstances = 20
MaxSystemInstances = 2
bCullWhenNotRendered = true
MaxTimeWithoutRender = 1.0
BudgetScaling.bCullByGlobalBudget = true
BudgetScaling.MaxGlobalBudgetUsage = 0.8  // 80% 초과 시 컬링
```

#### 3. **Budget Scaling 활용**

```cpp
// BudgetScaling 설정 (Performance-Critical 프로젝트)

bCullByGlobalBudget = true
MaxGlobalBudgetUsage = 0.9  // 90% 초과 시 컬링

bScaleMaxDistanceByGlobalBudgetUse = true
MaxDistanceScaleByGlobalBudgetUse:
  StartX = 0.7  // 70% 사용부터 스케일 시작
  StartY = 1.0  // 거리 100% 유지
  EndX = 1.0    // 100% 사용
  EndY = 0.6    // 거리 60%로 축소

// 효과:
// - Budget 70% 미만: 정상 거리 (예: 5000 units)
// - Budget 85%: 거리 80%로 축소 (4000 units)
// - Budget 100%: 거리 60%로 축소 (3000 units)
// - Budget 110%: 90% 초과로 추가 컬링 시작
```

#### 4. **SignificanceHandler 선택**

```cpp
// 총격/폭발 이펙트
SignificanceHandler = UNiagaraSignificanceHandlerDistance
// → 플레이어 가까운 총격이 중요

// 스킬 쿨다운 이펙트
SignificanceHandler = UNiagaraSignificanceHandlerAge
// → 최근 시전한 스킬 이펙트 우선 표시

// 커스텀 Handler (C++):
class UMySignificanceHandler : public UNiagaraSignificanceHandler
{
    virtual void CalculateSignificance(...) override
    {
        // 예: 플레이어 캐릭터에 붙은 이펙트 = 최고 우선순위
        for (int32 i = 0; i < Components.Num(); ++i)
        {
            UNiagaraComponent* Comp = Components[i];
            if (Comp->GetOwner()->IsA<APlayerCharacter>())
            {
                OutState[i].Significance = 1000.0f;  // 매우 높은 우선순위
            }
            else
            {
                float Distance = GetLODDistance(Comp);
                OutState[i].Significance = 1.0f / Distance;
            }
        }
    }
};
```

#### 5. **Cull Proxy 활용**

```cpp
// CullProxyMode 설정

// 연기, 파티클 군중 등
CullProxyMode = ENiagaraCullProxyMode::Instanced_Rendered
MaxSystemProxies = 32

// 작동 방식:
// 1. 50개의 연기 이펙트 스폰
// 2. 거리/인스턴스 수 제한으로 20개 컬링
// 3. 컬링된 20개 중 중요도 높은 32개까지 Proxy 생성
// 4. Proxy는 단일 Simulation + 여러 위치에 렌더
// 5. CPU/GPU 비용 대폭 감소 (단, 정확도는 낮음)

// 주의: bCulledByVisibility는 Proxy 생성 안 함
// → 안 보이는 것까지 Proxy 만들 필요 없음
```

---

### ❌ 피해야 할 실수

#### 1. **UpdateFrequency 과다 사용**

```cpp
// 나쁜 예: 모든 이펙트를 Continuous로 설정
UpdateFrequency = ENiagaraScalabilityUpdateFrequency::Continuous;
// → 매 프레임 모든 컴포넌트 평가 = 큰 CPU 부담

// 좋은 예: 필요에 따라 차등 적용
- 플레이어 스킬: Continuous (정확도 중요)
- 환경 이펙트: Low (1.0s 주기면 충분)
- 원거리 이펙트: SpawnOnly (스폰 시에만 체크)
```

#### 2. **플랫폼 설정 누락**

```cpp
// 나쁜 예: 단일 설정만 존재
SystemScalabilitySettings.Settings[0]:
  Platforms = All Platforms
  MaxInstances = 100

// 문제: 모바일도 100개 허용 → 성능 저하

// 좋은 예: 플랫폼별 분리
Settings[0]: PC High-End → MaxInstances = 100
Settings[1]: Console → MaxInstances = 50
Settings[2]: Mobile → MaxInstances = 20
```

#### 3. **SignificanceHandler 없이 MaxInstances 사용**

```cpp
// 나쁜 예:
SignificanceHandler = nullptr
MaxInstances = 50
CullReaction = DeactivateImmediate

// 문제:
// - Significance 없으면 FIFO 방식 (먼저 스폰된 것 유지)
// - 카메라 가까운 중요한 이펙트가 컬링될 수 있음
// - PreCull만 작동 (스폰 시에만 체크)

// 좋은 예:
SignificanceHandler = UNiagaraSignificanceHandlerDistance
MaxInstances = 50
CullReaction = DeactivateResume

// 효과:
// - 가까운 이펙트 우선 유지
// - 중요도 낮은 것부터 컬링
// - 조건 충족 시 재활성화
```

#### 4. **Budget Scaling 과도한 의존**

```cpp
// 나쁜 예: Budget에만 의존
bCullByDistance = false
bCullMaxInstanceCount = false
BudgetScaling.bCullByGlobalBudget = true
MaxGlobalBudgetUsage = 1.0

// 문제:
// - Budget 초과 전까지 무제한 스폰
// - 갑작스런 대량 컬링 발생 (프레임 드랍)
// - 예측 불가능한 동작

// 좋은 예: 다층 방어
bCullByDistance = true
MaxDistance = 5000.0  // 1차 방어선

bCullMaxInstanceCount = true
MaxInstances = 50  // 2차 방어선

BudgetScaling.bCullByGlobalBudget = true
MaxGlobalBudgetUsage = 0.9  // 3차 방어선 (긴급 상황)
```

#### 5. **bAllowCullingForLocalPlayers 잘못 사용**

```cpp
// 나쁜 예: 모든 EffectType에 false
bAllowCullingForLocalPlayers = false

// 문제:
// - 플레이어 근처 모든 이펙트가 컬링 면제
// - 성능 문제 발생 가능

// 좋은 예: 선택적 사용
CharacterEffectType.bAllowCullingForLocalPlayers = false;  // 캐릭터 버프/스킬
ImpactEffectType.bAllowCullingForLocalPlayers = true;      // 총격 이펙트 (일부 컬링 허용)
```

---

### 🔧 디버깅 팁

#### 1. **Console Commands**

```cpp
// 스케일러빌리티 시스템 제어
fx.Niagara.Scalability.Enable 0/1                // 전체 시스템 활성화/비활성화
fx.Niagara.Scalability.DistanceCulling 0/1       // 거리 컬링만 토글
fx.Niagara.Scalability.VisibilityCulling 0/1     // 가시성 컬링만 토글
fx.Niagara.Scalability.InstanceCountCulling 0/1  // 인스턴스 수 컬링만 토글

// 업데이트 주기 조정
fx.NiagaraScalabilityUpdateTime_Low 1.0     // Low 주기 (기본: 1.0s)
fx.NiagaraScalabilityUpdateTime_Medium 0.5  // Medium 주기 (기본: 0.5s)
fx.NiagaraScalabilityUpdateTime_High 0.25   // High 주기 (기본: 0.25s)

// 프레임당 최대 업데이트 수
fx.ScalabilityMaxUpdatesPerFrame 50  // -1 = 무제한

// 인스턴스 수 제한 엄격 적용
fx.Niagara.Scalability.ApplyInstanceCountsRigidly 0/1
// 1 = 컬링 해제된 시스템도 전체 인스턴스가 MaxInstances 미만일 때까지 대기

// Budget 관련
fx.Budget.Time 10.0  // 프레임당 CPU 시간 예산 (ms)
FX.Budget.VRAM 512   // VRAM 예산 (MB)
```

#### 2. **Debug Visualization**

```cpp
// Niagara Debug HUD 활성화 (Editor/Development Build)
fx.Niagara.Debug.Hud 1

// 표시 내용:
// - 활성 시스템 수
// - 컬링된 시스템 수 (Distance/Visibility/InstanceCount/Budget별)
// - 각 시스템의 Significance
// - Budget 사용률

// CSV Profiling (WITH_PARTICLE_PERF_CSV_STATS)
-csvGpuStats
// 출력: NiagaraCulled/Total, NiagaraCulled/Distance, NiagaraCulled/InstCounts 등
```

#### 3. **ScalabilityState 디버깅**

```cpp
// NiagaraComponent에서 현재 상태 확인
#if WITH_NIAGARA_DEBUGGER
FNiagaraScalabilityState DebugCachedScalabilityState;
// 컴포넌트마다 저장됨
#endif

// Dump 명령 (DEBUG_SCALABILITY_STATE 활성화 시)
void FNiagaraScalabilityManager::Dump()
{
    // Effect Type별 요약 출력:
    // - 관리 중인 컴포넌트 수
    // - 활성/컬링 개수
    // - 컬링 이유별 통계 (Distance/InstanceCount/Visibility)
    // - 각 컴포넌트의 Significance
}
```

---

### 📊 성능 측정

#### 업데이트 비용

```cpp
// NiagaraScalabilityManager.cpp:38
static int32 GetMaxUpdatesPerFrame(const UNiagaraEffectType* EffectType, int32 ItemsRemaining, float UpdatePeriod, float DeltaSeconds)
{
    if (GScalabilityMaxUpdatesPerFrame > 0 && EffectType->UpdateFrequency != ENiagaraScalabilityUpdateFrequency::Continuous)
    {
        int32 UpdateCount = ItemsRemaining;

        // 주기에 따른 프레임당 처리량 계산
        if ((UpdatePeriod > SMALL_NUMBER) && (DeltaSeconds < UpdatePeriod))
        {
            UpdateCount = FMath::Min(FMath::CeilToInt(((float)ItemsRemaining) * DeltaSeconds / UpdatePeriod), ItemsRemaining);
        }

        // 최대 제한 적용
        if (UpdateCount > GScalabilityMaxUpdatesPerFrame)
        {
            UE_LOG(LogNiagara, Verbose, TEXT("NiagaraScalabilityManager needs to process %d updates (will be clamped to %d)"), UpdateCount, GScalabilityMaxUpdatesPerFrame);
            UpdateCount = GScalabilityMaxUpdatesPerFrame;
        }
        return UpdateCount;
    }

    return ItemsRemaining;
}

// 예시:
// - UpdatePeriod = 1.0s (Low)
// - ItemsRemaining = 100개
// - DeltaSeconds = 0.016s (60fps)
// - UpdateCount = 100 * 0.016 / 1.0 = 1.6 → 2개/프레임
// - MaxUpdatesPerFrame = 50 → 최종 2개/프레임

// 결과: 100개를 50프레임에 걸쳐 처리
```

**비용 분석:**

| UpdateFrequency | 주기 | 100개 처리 시간 | CPU 부담 |
|----------------|------|----------------|----------|
| SpawnOnly | 스폰 시만 | 즉시 | 최소 |
| Low | 1.0s | ~50 프레임 | 낮음 |
| Medium | 0.5s | ~25 프레임 | 중간 |
| High | 0.25s | ~12 프레임 | 높음 |
| Continuous | 매 프레임 | 매 프레임 | 최대 |

---

## 🔗 참고 자료

### 소스 파일 경로 정리

| 파일 | 경로 | 주요 내용 |
|------|------|-----------|
| **NiagaraEffectType.h** | `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEffectType.h` | UNiagaraEffectType, FNiagaraSystemScalabilitySettings, SignificanceHandler |
| **NiagaraEffectType.cpp** | `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraEffectType.cpp` | SignificanceHandler 구현 (Distance, Age) |
| **NiagaraScalabilityManager.h** | `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraScalabilityManager.h` | FNiagaraScalabilityManager 정의 |
| **NiagaraScalabilityManager.cpp** | `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraScalabilityManager.cpp` | Update, EvaluateCullState, ProcessSignificance, ApplyScalabilityState |
| **NiagaraScalabilityState.h** | `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraScalabilityState.h` | FNiagaraScalabilityState 정의 |
| **NiagaraWorldManager.h** | `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraWorldManager.h` | FNiagaraWorldManager 정의 |
| **NiagaraWorldManager.cpp** | `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraWorldManager.cpp` | DistanceCull, ViewBasedCulling, InstanceCountCull, GlobalBudgetCull |

### 주요 Console Variables

```cpp
// 스케일러빌리티 활성화/비활성화
fx.Niagara.Scalability.Enable [0/1]
fx.Niagara.Scalability.DistanceCulling [0/1]
fx.Niagara.Scalability.VisibilityCulling [0/1]
fx.Niagara.Scalability.InstanceCountCulling [0/1]

// 업데이트 주기
fx.NiagaraScalabilityUpdateTime_Low [초]
fx.NiagaraScalabilityUpdateTime_Medium [초]
fx.NiagaraScalabilityUpdateTime_High [초]

// 프레임당 처리 제한
fx.ScalabilityMaxUpdatesPerFrame [개수]

// 인스턴스 수 제한 정책
fx.Niagara.Scalability.ApplyInstanceCountsRigidly [0/1]

// Budget
fx.Budget.Time [ms]
FX.Budget.VRAM [MB]
```

### 디버그 도구

```cpp
// Debug HUD
fx.Niagara.Debug.Hud [0/1]

// CSV Profiling
-csvGpuStats
// 출력: NiagaraCulled/Total, NiagaraCulled/Distance 등

// Dump 명령 (C++에서 호출)
FNiagaraScalabilityManager::Dump()
```

---

## 📝 업데이트 이력

> 🔄 Updated: 2025-01-21 — Niagara Scalability System 초기 문서 작성
> - UNiagaraEffectType 구조 및 설정 상세 분석
> - FNiagaraScalabilityManager 업데이트 흐름 다이어그램 추가
> - FNiagaraWorldManager의 4가지 컬링 메커니즘 소스 검증
> - UNiagaraSignificanceHandler 종류 및 구현 예시
> - 실전 최적화 팁 및 베스트 프랙티스 작성

## Merged Notes (from Niagara/EffectType_and_Scalability.md)

### EffectType & Scalability - Niagara 성능 관리 및 확장성
#### 🧭 개요 (Overview)
**Niagara EffectType & Scalability 시스템**은 **다양한 하드웨어 환경에서 Niagara System의 성능을 관리**하고, **자동으로 품질과 파티클 수를 조절**하여 **목표 프레임레이트를 유지**하는 통합 프레임워크입니다.

이 시스템은 **EffectType 기반 정책 정의**, **동적 Culling (Distance, Visibility, InstanceCount, Budget)**, **Significance 기반 우선순위**, **Global Budget 관리** 등을 제공합니다.

**핵심 사용 사례:**
- **EffectType**: System 카테고리별 Scalability 정책 정의 (예: "Gameplay Critical", "Ambient", "Cosmetic")
- **FNiagaraScalabilityManager**: 전역 Culling 관리, 프레임별 System 평가
- **4계층 Culling**: Distance → Visibility → InstanceCount → Global Budget 순차 평가
- **SignificanceHandler**: 중요도 기반 선택적 Culling (Player 근처 Effect 우선 보존)
- **Console CVars**: 실시간 Scalability 설정 조정

**📂 주요 위치:**
- EffectType: `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEffectType.h`
- Scalability Manager: `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraScalabilityManager.h`
- Scalability State: `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraCommon.h`

---

#### 🎯 설계 철학: 왜 별도의 Scalability 시스템인가?
##### 문제: Niagara Scalability의 고유한 과제
```
┌─────────────────────────────────────────────────────────────────────────┐
│                  Niagara Scalability의 고유한 문제점                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ❌ 문제 1: 하드웨어 다양성                                              │
│  - 모바일 (30fps, 메모리 제한) vs 콘솔 (60fps) vs 고성능 PC (120fps+)   │
│  - 동일한 System이 환경에 따라 수천 배 차이 (100개 vs 10만 개 파티클)  │
│  - 수동 조정 불가능 (빌드마다 다른 프리셋 관리 어려움)                  │
│                                                                         │
│  ❌ 문제 2: 동적 성능 변동                                               │
│  - 게임 상황에 따른 부하 변동 (평시 vs 전투, 실내 vs 실외)              │
│  - 수백 개 System 동시 실행 시 총 비용 예측 불가                        │
│  - 프레임 드롭 발생 시 사후 대응 필요                                   │
│                                                                         │
│  ❌ 문제 3: 중요도 구분의 어려움                                         │
│  - 모든 Effect를 동등하게 처리 불가                                     │
│  - Gameplay Critical (총구 화염) vs Cosmetic (배경 나비)                │
│  - Player 근처 Effect vs 멀리 떨어진 Effect                             │
│                                                                         │
│  ❌ 문제 4: 메모리 예산 초과                                             │
│  - GPU 파티클 버퍼 메모리 고갈 (수백 MB~GB)                             │
│  - Instance 수 폭증 (1000개 Component 동시 실행)                         │
│  - 전역 예산 관리 부재                                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                            ↓
                   Niagara EffectType & Scalability 솔루션:
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ✅ 해결 1: EffectType 기반 정책 정의                                    │
│  ┌──────────────────────────────────────────────────┐                  │
│  │  EffectType "Gameplay Critical":                 │                  │
│  │    - UpdateFrequency: High (매 프레임 평가)      │                  │
│  │    - CullReaction: DeactivateImmediate          │                  │
│  │    - Distance Culling: 100m                      │                  │
│  │                                                  │                  │
│  │  EffectType "Ambient":                           │                  │
│  │    - UpdateFrequency: Low (매 10프레임)          │                  │
│  │    - CullReaction: Pause                        │                  │
│  │    - Distance Culling: 50m                       │                  │
│  └──────────────────────────────────────────────────┘                  │
│                                                                         │
│  ✅ 해결 2: 4계층 동적 Culling                                          │
│  ┌──────────────────────────────────────────────────┐                  │
│  │  [Layer 1] Distance Culling                      │                  │
│  │    - MaxDistance 초과 시 Cull                    │                  │
│  │                                                  │                  │
│  │  [Layer 2] Visibility Culling                    │                  │
│  │    - 화면 밖 + bCullByViewFrustum = true → Cull │                  │
│  │                                                  │                  │
│  │  [Layer 3] Instance Count Culling                │                  │
│  │    - MaxInstances 초과 시 거리순 정렬 → 먼 것 Cull │                │
│  │                                                  │                  │
│  │  [Layer 4] Global Budget Culling                 │                  │
│  │    - 전역 Instance Budget 초과 시 Significance 순 │                │
│  └──────────────────────────────────────────────────┘                  │
│                                                                         │
│  ✅ 해결 3: Significance Handler                                        │
│  ┌──────────────────────────────────────────────────┐                  │
│  │  FNiagaraSignificanceHandler::                   │                  │
│  │    CalculateSignificance(Component, LocalPlayer) │                  │
│  │                                                  │                  │
│  │  반환값: float Significance (0.0 ~ 1.0)          │                  │
│  │    - 1.0: 가장 중요 (Player 위치)                │                  │
│  │    - 0.5: 중간                                   │                  │
│  │    - 0.0: 가장 덜 중요 (멀리 떨어짐)             │                  │
│  │                                                  │                  │
│  │  사용: Global Budget 초과 시 낮은 것부터 Cull    │                  │
│  └──────────────────────────────────────────────────┘                  │
│                                                                         │
│  ✅ 해결 4: Global Budget Scaling                                       │
│  ┌──────────────────────────────────────────────────┐                  │
│  │  Budget Pressure 계산:                           │                  │
│  │    Pressure = ActiveInstances / BudgetedInstances│                  │
│  │                                                  │                  │
│  │  if (Pressure > 1.0):                            │                  │
│  │    BudgetScale = 1.0 / Pressure                  │                  │
│  │    → 모든 System의 MaxInstances *= BudgetScale   │                  │
│  │                                                  │                  │
│  │  결과: 전역 예산 초과 시 자동으로 Instance 감소   │                  │
│  └──────────────────────────────────────────────────┘                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 설계 원칙
| 설계 원칙 | 설명 | 효과 |
|----------|------|------|
| **정책 기반 관리** | EffectType에 Scalability 정책 정의 → System은 정책 참조 | 중앙 집중식 관리, 일관성 보장 |
| **계층적 Culling** | Distance → Visibility → InstanceCount → Budget 순차 평가 | 저렴한 체크부터 실행, 조기 종료 |
| **중요도 기반** | Significance Handler로 우선순위 결정 | Gameplay Critical Effect 우선 보존 |
| **동적 조정** | 런타임 Budget Pressure에 따라 자동 Scale | 목표 성능 유지 |
| **갱신 주기 조절** | UpdateFrequency로 평가 빈도 제어 | 저중요도 System의 CPU 비용 절감 |

---

#### 🏗️ 시스템 아키텍처 (System Architecture)
##### 전체 구조
```
┌─────────────────────────────────────────────────────────────────────────┐
│              Niagara EffectType & Scalability Architecture             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │                    Asset Layer (자산 정의)                   │      │
│  ├──────────────────────────────────────────────────────────────┤      │
│  │                                                              │      │
│  │  ┌──────────────────────┐   ┌────────────────────────┐      │      │
│  │  │ UNiagaraEffectType   │   │  UNiagaraSystem        │      │      │
│  │  │ (정책 정의)           │   │  (System 자산)         │      │      │
│  │  │                      │   │                        │      │      │
│  │  │ - UpdateFrequency    │   │ - EffectType           ├──────┘      │
│  │  │ - CullProxies[]      │   │   (참조)               │             │
│  │  │ - SignificanceHandler│   │ - AllowCullingForLocalPlayer│        │
│  │  │ - PerfBaselineVersion│   │ - MaxInstances         │             │
│  │  │ - MaxDistance        │   └────────────────────────┘             │
│  │  │ - MaxInstances       │                                           │
│  │  │ - MaxParticleCount   │                                           │
│  │  └──────────────────────┘                                           │
│  └──────────────────────────────────────────────────────────────────────┘
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │              Runtime Layer (런타임 관리)                      │      │
│  ├──────────────────────────────────────────────────────────────┤      │
│  │                                                              │      │
│  │  ┌────────────────────────────────────────────────┐          │      │
│  │  │   FNiagaraScalabilityManager (싱글톤)          │          │      │
│  │  │   - 전역 Culling 관리자                        │          │      │
│  │  │                                                │          │      │
│  │  │   Private:                                     │          │      │
│  │  │     - EffectTypeToComponentMap                 │          │      │
│  │  │       TMap<UNiagaraEffectType*,                │          │      │
│  │  │             TArray<UNiagaraComponent*>>        │          │      │
│  │  │                                                │          │      │
│  │  │     - ComponentToCullStateMap                  │          │      │
│  │  │       TMap<UNiagaraComponent*, FCullState>     │          │      │
│  │  │                                                │          │      │
│  │  │   Public Methods:                              │          │      │
│  │  │     + Register(Component) : void               │          │      │
│  │  │     + Unregister(Component) : void             │          │      │
│  │  │     + EvaluateCullState(Component) : bool      │          │      │
│  │  │     + OnWorldPostActorTick() : void            │          │      │
│  │  └────────────────────────────────────────────────┘          │      │
│  │             │                        │                        │      │
│  │             │ Register               │ EvaluateCullState     │      │
│  │             ↓                        ↓                        │      │
│  │  ┌─────────────────────┐   ┌────────────────────────┐        │      │
│  │  │  UNiagaraComponent  │   │ FNiagaraWorldManager   │        │      │
│  │  │  (Component 인스턴스)│   │ (World별 관리자)       │        │      │
│  │  │                     │   │                        │        │      │
│  │  │ - EffectType        │   │ + Tick()               │        │      │
│  │  │ - bCulled           │   │ + GetScalabilityManager()│       │      │
│  │  │ - Significance      │   │                        │        │      │
│  │  │ - LastCullDistance  │   └────────────────────────┘        │      │
│  │  └─────────────────────┘                                     │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │          Culling Evaluation (4계층 평가)                      │      │
│  ├──────────────────────────────────────────────────────────────┤      │
│  │                                                              │      │
│  │  EvaluateCullState(Component):                               │      │
│  │    │                                                         │      │
│  │    ├─► [Layer 1] Distance Culling                            │      │
│  │    │   if (Distance > EffectType.MaxDistance)                │      │
│  │    │     → Cull, return true                                 │      │
│  │    │                                                         │      │
│  │    ├─► [Layer 2] Visibility Culling                          │      │
│  │    │   if (!InFrustum && EffectType.bCullByViewFrustum)      │      │
│  │    │     → Cull, return true                                 │      │
│  │    │                                                         │      │
│  │    ├─► [Layer 3] Instance Count Culling                      │      │
│  │    │   if (EffectTypeInstances > EffectType.MaxInstances)    │      │
│  │    │     Sort by Distance, Cull Furthest                     │      │
│  │    │                                                         │      │
│  │    └─► [Layer 4] Global Budget Culling                       │      │
│  │        if (TotalInstances > GlobalBudget)                    │      │
│  │          Calculate Significance                              │      │
│  │          Sort by Significance, Cull Lowest                   │      │
│  │                                                              │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

#### 🧱 핵심 클래스 상세 (Core Classes)
##### 1. UNiagaraEffectType - Scalability 정책 정의
**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEffectType.h:201-427`

**역할:** Effect 카테고리별 Scalability 정책을 정의하는 자산 클래스

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       UNiagaraEffectType                                │
│  (Scalability 정책 자산 - System 카테고리별 정책 정의)                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Public Properties:                                                     │
│    UPROPERTY(EditAnywhere, Category="Scalability")                      │
│    ENiagaraScalabilityUpdateFrequency UpdateFrequency = Medium          │
│      // 갱신 주기 (SpawnOnly, Low, Medium, High, Continuous)            │
│        - SpawnOnly: Spawn 시에만 평가                                   │
│        - Low: 32 프레임마다 (~0.5초)                                    │
│        - Medium: 8 프레임마다 (~0.13초)                                 │
│        - High: 4 프레임마다 (~0.06초)                                   │
│        - Continuous: 매 프레임 평가                                     │
│                                                                         │
│    UPROPERTY(EditAnywhere, Category="Scalability")                      │
│    TArray<FNiagaraSystemScalabilitySettings> SystemScalabilitySettings  │
│      // 플랫폼별 Scalability 설정 배열                                  │
│      struct FNiagaraSystemScalabilitySettings:                          │
│        - FNiagaraPlatformSet Platforms                                  │
│          (Windows, PS5, Xbox, iOS, Android 등)                          │
│        - float MaxDistance                                              │
│          (이 거리 이상 = Cull)                                          │
│        - bool bCullMaxInstanceCount                                     │
│        - int32 MaxInstances                                             │
│          (동시 활성 Instance 최대 개수)                                 │
│        - bool bCullByViewFrustum                                        │
│          (화면 밖 = Cull)                                               │
│        - ENiagaraCullReaction CullReaction                              │
│          (Deactivate, DeactivateImmediate, DeactivateResume, Pause)     │
│                                                                         │
│    UPROPERTY(EditAnywhere, Category="Significance")                     │
│    TSubclassOf<UNiagaraSignificanceHandler> SignificanceHandler         │
│      // Significance 계산 로직 (Plugin 가능)                            │
│      - nullptr: 기본 거리 기반 계산                                     │
│      - 커스텀: 사용자 정의 중요도 로직                                  │
│                                                                         │
│    UPROPERTY(EditAnywhere, Category="Performance")                      │
│    FNiagaraPerfBaselineStats PerfBaselineStats                          │
│      // 성능 베이스라인 (GT/RT 시간, Particle Count)                    │
│                                                                         │
│    UPROPERTY(EditAnywhere, Category="Culling|Proxy")                    │
│    TArray<FNiagaraSystemScalabilityOverride> CullProxies                │
│      // Cull될 때 대체 System (LOD 개념)                                │
│      struct FNiagaraSystemScalabilityOverride:                          │
│        - TSoftObjectPtr<UNiagaraSystem> System                          │
│        - bool bApplySystemScale                                         │
│                                                                         │
│  Public Methods:                                                        │
│    + GetActiveSystemScalabilitySettings(Platforms) :                    │
│        const FNiagaraSystemScalabilitySettings&                         │
│      // 현재 플랫폼에 맞는 Scalability 설정 반환                        │
│                                                                         │
│    + GetSignificanceHandler() : UNiagaraSignificanceHandler*            │
│      // Significance Handler 인스턴스 반환                              │
│                                                                         │
│    + GetUpdateFrequency() : ENiagaraScalabilityUpdateFrequency          │
│      // 갱신 주기 반환                                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**ENiagaraCullReaction 상세:**

| CullReaction | 설명 | 사용 시나리오 |
|--------------|------|--------------|
| **Deactivate** | Component->Deactivate() 호출 (부드러운 종료) | 일반적인 Effect (파티클 수명 유지 후 자연스럽게 사라짐) |
| **DeactivateImmediate** | Component->DeactivateImmediate() (즉시 종료) | Gameplay Critical (즉시 제거 필요) |
| **DeactivateResume** | Deactivate + Cull 해제 시 Activate | On/Off 토글 가능 (UI Effect) |
| **Pause** | Simulation Pause (상태 유지) | 메모리 절약 + 빠른 Resume (연기, 구름) |

---

##### 2. FNiagaraScalabilityManager - 전역 Culling 관리자
**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraScalabilityManager.h:33-169`

**역할:** 모든 UNiagaraComponent의 Culling 상태를 관리하고 프레임별로 평가하는 싱글톤

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   FNiagaraScalabilityManager                            │
│  (전역 Scalability 관리자 - World당 1개 싱글톤)                         │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - TMap<UNiagaraEffectType*, FManagedComponentSet>                    │
│        EffectTypeToComponentMap                                         │
│      // EffectType별 Component 그룹                                     │
│      struct FManagedComponentSet:                                       │
│        TArray<UNiagaraComponent*> ManagedComponents                     │
│        int32 LastUpdateFrame                                            │
│                                                                         │
│    - TMap<UNiagaraComponent*, FCullState> ComponentToCullStateMap       │
│      // Component별 Culling 상태                                        │
│      struct FCullState:                                                 │
│        bool bCulled                                                     │
│        bool bPreviousCulled                                             │
│        float LastCullDistance                                           │
│        float Significance                                               │
│        ENiagaraCullReaction CullReaction                                │
│                                                                         │
│    - TWeakObjectPtr<UWorld> World                                       │
│      // 연결된 World                                                   │
│                                                                         │
│    - int32 UpdateCounter                                                │
│      // 프레임 카운터 (UpdateFrequency 판정용)                          │
│                                                                         │
│  Public Methods:                                                        │
│    + Register(UNiagaraComponent* Component) : void                      │
│      // Component 등록                                                  │
│        EffectTypeToComponentMap[EffectType].Add(Component)              │
│        ComponentToCullStateMap.Add(Component, DefaultCullState)         │
│                                                                         │
│    + Unregister(UNiagaraComponent* Component) : void                    │
│      // Component 등록 해제                                             │
│        EffectTypeToComponentMap[EffectType].Remove(Component)           │
│        ComponentToCullStateMap.Remove(Component)                        │
│                                                                         │
│    + OnWorldPostActorTick(UWorld* InWorld, ELevelTick TickType,        │
│        float DeltaSeconds) : void                                       │
│      // 매 프레임 호출 (FNiagaraWorldManager::Tick에서)                 │
│        UpdateCounter++;                                                 │
│        for each EffectType in EffectTypeToComponentMap:                 │
│          if (ShouldUpdate(EffectType, UpdateCounter)):                  │
│            EvaluateEffectType(EffectType)                               │
│                                                                         │
│    + EvaluateCullState(UNiagaraComponent* Component,                    │
│        int32 ComponentIndex, int32 UpdateCounter) : bool                │
│      // Component의 Cull 상태 평가 (4계층 Culling)                      │
│        [상세 흐름 아래 참조]                                            │
│                                                                         │
│    + GetScalabilityState(UNiagaraComponent* Component) :                │
│        FNiagaraScalabilityState                                         │
│      // Component의 현재 Scalability 상태 반환                          │
│                                                                         │
│  Private Methods:                                                       │
│    - ShouldUpdate(UNiagaraEffectType* EffectType,                       │
│        int32 UpdateCounter) : bool                                      │
│      // UpdateFrequency에 따라 평가 여부 결정                           │
│        switch (EffectType->UpdateFrequency):                            │
│          SpawnOnly: return false (이미 평가됨)                          │
│          Low: return (UpdateCounter % 32) == 0                          │
│          Medium: return (UpdateCounter % 8) == 0                        │
│          High: return (UpdateCounter % 4) == 0                          │
│          Continuous: return true                                        │
│                                                                         │
│    - EvaluateEffectType(UNiagaraEffectType* EffectType) : void          │
│      // EffectType에 속한 모든 Component 평가                           │
│        TArray<UNiagaraComponent*>& Components =                         │
│          EffectTypeToComponentMap[EffectType].ManagedComponents         │
│        for (int32 i = 0; i < Components.Num(); ++i):                    │
│          EvaluateCullState(Components[i], i, UpdateCounter)             │
│                                                                         │
│    - ApplyCullReaction(UNiagaraComponent* Component,                    │
│        ENiagaraCullReaction Reaction) : void                            │
│      // CullReaction에 따라 Component 상태 변경                         │
│        switch (Reaction):                                               │
│          Deactivate: Component->Deactivate()                            │
│          DeactivateImmediate: Component->DeactivateImmediate()          │
│          Pause: Component->SetPaused(true)                              │
│          DeactivateResume: (상태 플래그 설정)                           │
│                                                                         │
│    - CalculateSignificance(UNiagaraComponent* Component,                │
│        APlayerController* Player) : float                               │
│      // Significance Handler 호출 or 기본 거리 계산                     │
│        if (SignificanceHandler):                                        │
│          return Handler->CalculateSignificance(Component, Player)       │
│        else:                                                            │
│          return 1.0 - (Distance / MaxDistance)                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**EvaluateCullState 흐름:**

```
FNiagaraScalabilityManager::EvaluateCullState(Component, ComponentIndex, UpdateCounter)
    │
    ├─► [1] Validity Check
    │   if (!Component || !Component->IsActive())
    │     return false  // Skip
    │
    ├─► [2] Get Scalability Settings
    │   EffectType = Component->GetAsset()->EffectType
    │   Settings = EffectType->GetActiveSystemScalabilitySettings()
    │   PreviousCullState = ComponentToCullStateMap[Component]
    │
    ├─► [3] Layer 1: Distance Culling
    │   if (Settings.MaxDistance > 0)
    │     Distance = (Component->GetComponentLocation() - ViewLocation).Size()
    │     if (Distance > Settings.MaxDistance)
    │       bCulled = true
    │       CullReason = Distance
    │       goto Apply
    │
    ├─► [4] Layer 2: Visibility Culling
    │   if (Settings.bCullByViewFrustum)
    │     if (!Component->WasRecentlyRendered())
    │       bCulled = true
    │       CullReason = Visibility
    │       goto Apply
    │
    ├─► [5] Layer 3: Instance Count Culling
    │   if (Settings.bCullMaxInstanceCount)
    │     EffectTypeInstanceCount = EffectTypeToComponentMap[EffectType].Num()
    │     if (EffectTypeInstanceCount > Settings.MaxInstances)
    │       // 거리순 정렬 후 먼 것 Cull
    │       SortByDistance(EffectTypeComponents)
    │       if (ComponentIndex >= Settings.MaxInstances)
    │         bCulled = true
    │         CullReason = InstanceCount
    │         goto Apply
    │
    ├─► [6] Layer 4: Global Budget Culling
    │   TotalInstances = GetTotalActiveInstances()
    │   if (TotalInstances > GlobalBudget)
    │     // Significance 계산 필요
    │     bNeedsSignificanceCalculation = true
    │     Significance = CalculateSignificance(Component, LocalPlayer)
    │     ComponentToCullStateMap[Component].Significance = Significance
    │
    │     // 전역 정렬 후 낮은 Significance부터 Cull
    │     SortAllComponentsBySignificance()
    │     if (Component->SignificanceRank > GlobalBudget)
    │       bCulled = true
    │       CullReason = Budget
    │       goto Apply
    │
    ├─► [7] Not Culled
    │   bCulled = false
    │
    └─► [8] Apply Cull State
        NewCullState = FCullState{bCulled, PreviousCulled, Distance,
                                  Significance, Settings.CullReaction}
        ComponentToCullStateMap[Component] = NewCullState

        if (bCulled != PreviousCulled)
          // 상태 변경 발생
          if (bCulled)
            ApplyCullReaction(Component, Settings.CullReaction)
          else
            // Resume
            Component->Activate(true)

        return bCulled
```

---

##### 3. FNiagaraScalabilityState - Component별 Scalability 상태
**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraCommon.h:1156-1190`

**역할:** Component의 현재 Scalability 상태를 나타내는 구조체

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   FNiagaraScalabilityState                              │
│  (Component별 Scalability 상태 - 직렬화 가능)                           │
├─────────────────────────────────────────────────────────────────────────┤
│  Public Members:                                                        │
│    float Significance = 1.0f                                            │
│      // 현재 Significance 값 (0.0 ~ 1.0)                                │
│      // 1.0 = 가장 중요, 0.0 = 가장 덜 중요                             │
│                                                                         │
│    float LastVisibleTime = 0.0f                                         │
│      // 마지막으로 렌더링된 시간 (World->GetTimeSeconds())              │
│                                                                         │
│    uint8 bCulled : 1                                                    │
│      // 현재 Cull 상태                                                  │
│                                                                         │
│    uint8 bPreviouslyCulled : 1                                          │
│      // 이전 프레임 Cull 상태 (상태 변경 감지용)                        │
│                                                                         │
│    uint8 bCulledByDistance : 1                                          │
│      // Distance Culling으로 인해 Cull됨                                │
│                                                                         │
│    uint8 bCulledByInstanceCount : 1                                     │
│      // Instance Count Culling으로 인해 Cull됨                          │
│                                                                         │
│    uint8 bCulledByVisibility : 1                                        │
│      // Visibility Culling으로 인해 Cull됨                              │
│                                                                         │
│    uint8 bCulledByGlobalBudget : 1                                      │
│      // Global Budget Culling으로 인해 Cull됨                           │
│                                                                         │
│  Public Methods:                                                        │
│    + IsCulled() const : bool                                            │
│      return bCulled                                                     │
│                                                                         │
│    + GetCullReason() const : FString                                    │
│      if (bCulledByDistance) return "Distance"                           │
│      if (bCulledByVisibility) return "Visibility"                       │
│      if (bCulledByInstanceCount) return "InstanceCount"                 │
│      if (bCulledByGlobalBudget) return "GlobalBudget"                   │
│      return "None"                                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

##### 4. UNiagaraSignificanceHandler - 중요도 계산 플러그인
**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEffectType.h:80-115`

**역할:** Component의 중요도를 계산하는 추상 베이스 클래스 (Plugin 시스템)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                UNiagaraSignificanceHandler                              │
│  (Significance 계산 플러그인 - 커스텀 중요도 로직)                       │
├─────────────────────────────────────────────────────────────────────────┤
│  Public Virtual Methods:                                                │
│    + CalculateSignificance(                                             │
│        UNiagaraComponent* Component,                                    │
│        UNiagaraEffectType* EffectType) : float                          │
│      // 순수 가상 함수 - 반드시 Override 필요                           │
│      // 반환값: 0.0 (가장 덜 중요) ~ 1.0 (가장 중요)                    │
│                                                                         │
│  Built-in Handler 종류:                                                 │
│    ┌──────────────────────────────────────────────────┐                │
│    │  UNiagaraSignificanceHandlerDistance             │                │
│    │  (거리 기반 - 기본 Handler)                      │                │
│    │                                                  │                │
│    │  CalculateSignificance() override:               │                │
│    │    Distance = (Comp->Loc - ViewLoc).Size()       │                │
│    │    return 1.0 - FMath::Clamp(Distance /          │                │
│    │                   EffectType->MaxDistance, 0, 1) │                │
│    │                                                  │                │
│    │  설명: MaxDistance가 가까울수록 1.0에 가까움     │                │
│    └──────────────────────────────────────────────────┘                │
│                                                                         │
│    ┌──────────────────────────────────────────────────┐                │
│    │  UNiagaraSignificanceHandlerAge                  │                │
│    │  (수명 기반)                                     │                │
│    │                                                  │                │
│    │  CalculateSignificance() override:               │                │
│    │    Age = Comp->GetAge()                          │                │
│    │    return Age / MaxAge                           │                │
│    │                                                  │                │
│    │  설명: 오래된 Effect일수록 높은 Significance     │                │
│    │        (오래 산 것 = 중요하므로 보존)            │                │
│    └──────────────────────────────────────────────────┘                │
│                                                                         │
│  Custom Handler 예시:                                                   │
│    ┌──────────────────────────────────────────────────┐                │
│    │  UMyGameplaySignificanceHandler                  │                │
│    │  (Gameplay 로직 기반)                            │                │
│    │                                                  │                │
│    │  CalculateSignificance() override:               │                │
│    │    AActor* Owner = Comp->GetOwner()              │                │
│    │    if (Owner->ActorHasTag("Critical"))           │                │
│    │      return 1.0  // 무조건 최고 중요도           │                │
│    │                                                  │                │
│    │    if (IsInCombat(Owner))                        │                │
│    │      return 0.8  // 전투 중 = 높은 중요도        │                │
│    │                                                  │                │
│    │    Distance = GetDistanceToPlayer(Comp)          │                │
│    │    return 1.0 - (Distance / 1000.0)              │                │
│    │                                                  │                │
│    │  설명: "Critical" 태그 + 전투 상태 고려          │                │
│    └──────────────────────────────────────────────────┘                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

#### 💻 Console Commands (Console 명령어)
##### Scalability 설정
```cpp
// Scalability Level 설정 (0: Low, 1: Medium, 2: High, 3: Epic, 4: Cinematic)
fx.Niagara.ScalabilityLevel [0-4]

// 예시
fx.Niagara.ScalabilityLevel 2  // High Quality
fx.Niagara.ScalabilityLevel 0  // Low Quality (모바일)
```

##### Culling 디버깅
```cpp
// Scalability 정보 덤프
fx.Niagara.Scalability.Dump
// 출력: EffectType별 활성 Instance 수, Cull 통계

// Global Budget 설정 (동시 활성 Instance 최대 개수)
fx.Niagara.Scalability.GlobalBudget [Instance Count]

// 예시
fx.Niagara.Scalability.GlobalBudget 500  // 최대 500개 Instance

// Culling 비활성화 (디버깅용)
fx.Niagara.Scalability.Enabled 0  // Culling 완전히 끔
fx.Niagara.Scalability.Enabled 1  // Culling 다시 활성화
```

##### Debug HUD로 Scalability 확인
```cpp
// Scalability Overview 표시
fx.Niagara.Debug.Hud Enabled=1 OverviewMode=2

// 출력 예시:
┌────────────────────────────────────────────┐
│ Scalability Overview:                      │
│                                            │
│ EffectType "Gameplay Critical":            │
│   Active: 50 / 100 (MaxInstances)          │
│   Culled: 5                                │
│     - Distance: 3                          │
│     - Visibility: 2                        │
│                                            │
│ EffectType "Ambient":                      │
│   Active: 200 / 300                        │
│   Culled: 50                               │
│     - Distance: 30                         │
│     - InstanceCount: 20                    │
│                                            │
│ Global Budget: 450 / 500                   │
│   Budget Pressure: 0.9 (90%)               │
└────────────────────────────────────────────┘
```

---

#### 🎯 실전 사용 예시 (Practical Examples)
##### 예시 1: EffectType 설정 (에디터)
**시나리오:** "Fire_Gameplay" Effect는 Gameplay Critical, "Ambient_Dust" Effect는 Ambient로 분류

**단계:**

1. **EffectType 자산 생성:**
   - Content Browser → 우클릭 → Niagara → Niagara Effect Type
   - 이름: "EffectType_GameplayCritical"

2. **Scalability 설정:**
   ```
   EffectType_GameplayCritical:
     UpdateFrequency: High (매 4프레임)

     SystemScalabilitySettings[0]:  // Windows, PS5, Xbox
       MaxDistance: 5000.0 (50m)
       bCullMaxInstanceCount: true
       MaxInstances: 100
       bCullByViewFrustum: false  // 화면 밖이어도 유지
       CullReaction: DeactivateImmediate

     SystemScalabilitySettings[1]:  // Mobile
       MaxDistance: 2000.0 (20m)
       MaxInstances: 30
       bCullByViewFrustum: true
       CullReaction: DeactivateImmediate
   ```

3. **System에 적용:**
   - NS_Fire_Gameplay 열기 → EffectType = "EffectType_GameplayCritical"

**결과:** Gameplay Critical Effect는 화면 밖이어도 유지되고, 높은 우선순위로 처리됨

---

##### 예시 2: Global Budget으로 성능 제한
**시나리오:** 동시 활성 Niagara Instance를 500개로 제한

**단계:**

```cpp
// 1. DefaultEngine.ini 또는 런타임 설정
[/Script/Niagara.NiagaraSettings]
GlobalBudgetMaxInstances=500

// 2. 런타임에서 Console 명령어로 조정
fx.Niagara.Scalability.GlobalBudget 500
```

**내부 동작:**

```
현재 활성 Instance: 600개
GlobalBudget: 500개

Budget Pressure = 600 / 500 = 1.2

→ Scalability Manager가 모든 Component의 Significance 계산
→ Significance 낮은 순으로 정렬
→ 하위 100개 Cull

결과: 500개로 감소
```

**측정:**

```cpp
fx.Niagara.Debug.Hud Enabled=1 OverviewMode=1

// 화면 출력:
Global Budget: 500 / 500 (100%)
Culled by Budget: 100
```

---

##### 예시 3: 커스텀 Significance Handler 구현
**시나리오:** Player의 조준선 위의 Effect는 더 높은 중요도

**구현:**

```cpp
// MyProjectSignificanceHandler.h
#pragma once
#include "NiagaraEffectType.h"
#include "MyProjectSignificanceHandler.generated.h"

UCLASS()
class UMyProjectSignificanceHandler : public UNiagaraSignificanceHandler
{
    GENERATED_BODY()

public:
    virtual float CalculateSignificance(
        UNiagaraComponent* Component,
        UNiagaraEffectType* EffectType) const override
    {
        // 1. 기본 거리 기반 Significance
        APlayerController* PC = GetWorld()->GetFirstPlayerController();
        if (!PC) return 0.5f;

        FVector ViewLocation = PC->PlayerCameraManager->GetCameraLocation();
        FVector CompLocation = Component->GetComponentLocation();
        float Distance = (CompLocation - ViewLocation).Size();
        float DistanceSignificance = 1.0f - FMath::Clamp(
            Distance / EffectType->GetActiveSystemScalabilitySettings().MaxDistance,
            0.0f, 1.0f);

        // 2. 조준선과의 각도 고려
        FVector ViewDirection = PC->PlayerCameraManager->GetActorForwardVector();
        FVector ToComponent = (CompLocation - ViewLocation).GetSafeNormal();
        float DotProduct = FVector::DotProduct(ViewDirection, ToComponent);

        // DotProduct: 1.0 (정면) ~ -1.0 (후면)
        // 0.8 이상이면 Bonus
        float ViewBonus = 0.0f;
        if (DotProduct > 0.8f)
        {
            ViewBonus = 0.3f;  // +30% Significance
        }

        // 3. Owner Actor의 태그 확인
        AActor* Owner = Component->GetOwner();
        float TagBonus = 0.0f;
        if (Owner && Owner->ActorHasTag(FName("HighPriority")))
        {
            TagBonus = 0.5f;  // +50% Significance
        }

        // 4. 최종 Significance (0.0 ~ 1.0 범위 유지)
        float FinalSignificance = FMath::Clamp(
            DistanceSignificance + ViewBonus + TagBonus, 0.0f, 1.0f);

        return FinalSignificance;
    }
};
```

**EffectType 설정:**

```
EffectType_Combat:
  SignificanceHandler: MyProjectSignificanceHandler
```

**결과:** Player가 바라보는 Effect는 더 높은 Significance → Budget 초과 시에도 보존됨

---

##### 예시 4: CullProxy로 LOD 구현
**시나리오:** 멀리 떨어지면 간소화된 Effect로 전환

**설정:**

```
EffectType_Fire:
  SystemScalabilitySettings[0]:
    MaxDistance: 3000.0 (30m)

  CullProxies[0]:
    System: NS_Fire_LOD1 (파티클 50% 감소)
    bApplySystemScale: true
```

**동작:**

```
거리 < 30m:
  → NS_Fire_Original 실행 (Full Quality)

거리 30m ~ 60m:
  → NS_Fire_Original Cull
  → NS_Fire_LOD1 Activate (대체)

거리 > 60m:
  → NS_Fire_LOD1도 Cull (완전히 사라짐)
```

**구현 코드 (ScalabilityManager 내부):**

```cpp
if (bCulled && EffectType->CullProxies.Num() > 0)
{
    // 원본 Cull
    Component->Deactivate();

    // Proxy Spawn
    for (const FNiagaraSystemScalabilityOverride& Proxy : EffectType->CullProxies)
    {
        UNiagaraSystem* ProxySystem = Proxy.System.LoadSynchronous();
        UNiagaraComponent* ProxyComp = UNiagaraFunctionLibrary::SpawnSystemAtLocation(
            World, ProxySystem, Component->GetComponentLocation());

        if (Proxy.bApplySystemScale)
        {
            ProxyComp->SetRelativeScale3D(Component->GetRelativeScale3D());
        }
    }
}
```

---

##### 예시 5: UpdateFrequency 최적화
**시나리오:** Ambient Effect는 자주 평가할 필요 없음

**설정:**

```
EffectType_Ambient:
  UpdateFrequency: Low  // 32 프레임마다 (0.5초)

EffectType_GameplayCritical:
  UpdateFrequency: High  // 4 프레임마다 (0.06초)
```

**성능 비교:**

| UpdateFrequency | 평가 주기 | CPU 비용 (1000개 Instance 기준) |
|----------------|---------|------------------------------|
| Continuous | 매 프레임 (60fps) | 60,000 평가/초 (100%) |
| High | 4 프레임마다 | 15,000 평가/초 (25%) |
| Medium | 8 프레임마다 | 7,500 평가/초 (12.5%) |
| Low | 32 프레임마다 | 1,875 평가/초 (3.1%) |
| SpawnOnly | Spawn 시 1회 | 거의 0% |

**결과:** Ambient Effect를 Low로 설정하면 CPU 비용 97% 절감

---

#### 🐛 디버깅 및 최적화 팁 (Debugging & Optimization Tips)
##### 일반적인 함정
###### ❌ 하지 말아야 할 것:
```cpp
// 1. 모든 Effect를 Continuous로 설정
EffectType_Default:
  UpdateFrequency: Continuous  // ← CPU 낭비!
// 대부분의 Effect는 Medium이면 충분

// 2. MaxInstances를 너무 크게 설정
EffectType_Ambient:
  MaxInstances: 10000  // ← 메모리 고갈!
// 실제로 필요한 만큼만 설정 (보통 100~500)

// 3. SignificanceHandler를 과도하게 복잡하게 구현
CalculateSignificance():
  // 10개 이상의 조건 체크 ← 매 프레임마다 호출됨!
// 단순한 로직으로 유지 (거리 + 1~2개 조건)

// 4. Global Budget을 너무 낮게 설정
GlobalBudgetMaxInstances=50  // ← Effect 대부분 Cull됨
// 목표 플랫폼의 성능에 맞춰 조정 (PC: 500~1000, 모바일: 100~300)
```

###### ✅ 올바른 방법:
```cpp
// 1. EffectType별 적절한 UpdateFrequency
EffectType_GameplayCritical:
  UpdateFrequency: High  // 중요한 것만

EffectType_Ambient:
  UpdateFrequency: Low  // 배경 Effect

// 2. MaxInstances를 합리적으로 설정
EffectType_Projectile:
  MaxInstances: 50  // 동시에 50발 이상 발사 안 함

EffectType_Ambient:
  MaxInstances: 200  // 배경 Effect는 많아도 됨

// 3. 간단한 Significance Handler
CalculateSignificance():
  DistanceSignificance = 1.0 - (Distance / MaxDistance)
  if (IsInCombat)
    return DistanceSignificance + 0.3  // +30%
  return DistanceSignificance

// 4. 플랫폼별 Budget
PC: GlobalBudgetMaxInstances=800
Console: GlobalBudgetMaxInstances=500
Mobile: GlobalBudgetMaxInstances=150
```

---

##### Scalability 분석 워크플로우
###### 1단계: 현재 상태 확인
```cpp
fx.Niagara.Debug.Hud Enabled=1 OverviewMode=2

// 출력 분석:
// - Active vs MaxInstances 비율
// - Culled 개수 및 이유 (Distance, Visibility, InstanceCount, Budget)
// - Budget Pressure (>1.0이면 과부하)
```

###### 2단계: 병목 EffectType 찾기
```cpp
fx.Niagara.Scalability.Dump

// 출력:
EffectType "Ambient_Dust": Active=350, Culled=50 (Budget)
EffectType "Combat_Impact": Active=80, Culled=2 (Distance)

// 분석:
// - Ambient_Dust가 Budget Culling 많이 발생 → MaxInstances 낮추기
// - Combat_Impact은 정상
```

###### 3단계: UpdateFrequency 최적화
```cpp
// "Ambient" EffectType의 UpdateFrequency를 Medium → Low로 변경
// CPU Profiling으로 평가 비용 확인

stat Niagara
// FNiagaraScalabilityManager::OnWorldPostActorTick 시간 확인
```

###### 4단계: Global Budget 조정
```cpp
// Budget Pressure가 지속적으로 >1.0이면
fx.Niagara.Scalability.GlobalBudget 600  // 500에서 600으로 증가

// 또는 덜 중요한 EffectType의 MaxInstances 감소
EffectType_Ambient:
  MaxInstances: 300 → 200
```

---

##### 성능 측정 및 목표 설정
| 플랫폼 | 목표 성능 | Global Budget 권장 | MaxDistance 권장 |
|--------|---------|------------------|-----------------|
| **고성능 PC** | 120fps | 800~1000 | 5000.0 (50m) |
| **콘솔 (PS5, XSX)** | 60fps | 500~700 | 4000.0 (40m) |
| **저사양 PC** | 60fps | 300~500 | 3000.0 (30m) |
| **모바일 (High)** | 30fps | 150~300 | 2000.0 (20m) |
| **모바일 (Low)** | 30fps | 50~100 | 1000.0 (10m) |

**측정 지표:**

```cpp
stat Niagara

// 중요 지표:
// - Niagara Total GT Time: < 2.0ms (60fps 기준)
// - Active Instances: <= GlobalBudget
// - Culled Percentage: 10~30% (너무 낮으면 Budget 낭비, 너무 높으면 Effect 부족)
```

---

##### 일반적인 디버깅 시나리오
| 증상 | 원인 | 해결 방법 |
|------|------|----------|
| **Effect가 갑자기 사라짐** | Distance Culling | MaxDistance 증가 or 거리 확인 |
| **Budget Pressure 항상 >1.0** | GlobalBudget 부족 | GlobalBudget 증가 or MaxInstances 감소 |
| **중요한 Effect가 Cull됨** | Significance 낮음 | SignificanceHandler 조정 or "Critical" 태그 |
| **CPU 프레임 드롭** | UpdateFrequency 과다 | Ambient EffectType을 Low로 변경 |
| **화면 밖에서도 Cull됨** | Visibility Culling | bCullByViewFrustum=false |
| **Instance 수 폭증** | MaxInstances 너무 큼 | MaxInstances 감소 (50~200) |

---

#### 📖 참고 자료 (References)
##### 공식 문서
- [Unreal Engine Docs: Niagara Scalability](https://docs.unrealengine.com/5.3/en-US/niagara-scalability-in-unreal-engine/)
- [Unreal Engine Docs: Effect Type](https://docs.unrealengine.com/5.3/en-US/niagara-effect-type-in-unreal-engine/)
- [Unreal Engine Docs: Performance and Scalability](https://docs.unrealengine.com/5.3/en-US/optimizing-niagara-effects-in-unreal-engine/)

##### 소스 파일 참조
- **EffectType:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEffectType.h:201-427`
- **Scalability Manager:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraScalabilityManager.h:33-169`
- **Scalability State:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraCommon.h:1156-1190`
- **Significance Handler:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEffectType.h:80-115`

##### 핵심 개념
- **EffectType:** System 카테고리별 Scalability 정책 자산
- **Scalability Manager:** World별 싱글톤, 모든 Component의 Culling 관리
- **4계층 Culling:** Distance → Visibility → InstanceCount → Budget
- **Significance:** Component의 중요도 (0.0 ~ 1.0), Global Budget 초과 시 우선순위
- **CullReaction:** Culling 발생 시 동작 (Deactivate, Pause, DeactivateImmediate, DeactivateResume)
- **UpdateFrequency:** Scalability 평가 주기 (SpawnOnly, Low, Medium, High, Continuous)

---

#### 소스 검증 보충: 컬링 메커니즘 실제 코드
> 🔄 Updated: 2026-02-18 — 중복 문서 통합 (Optimization.md 내용 병합)

##### Distance Culling 소스 검증
**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraWorldManager.cpp:2303`

```cpp
void FNiagaraWorldManager::DistanceCull(
    UNiagaraEffectType* EffectType,
    const FNiagaraSystemScalabilitySettings& ScalabilitySettings,
    UNiagaraComponent* Component,
    FNiagaraScalabilityState& OutState)
{
    float LODDistance = 0.0f;

    if (Component->bEnablePreviewLODDistance)
    {
        LODDistance = Component->PreviewLODDistance;
    }
    else if(GetCachedViewInfo().Num() > 0)
    {
        float ClosestDistSq = FLT_MAX;
        FVector Location = Component->GetComponentLocation();
        for (const FNiagaraCachedViewInfo& ViewInfo : GetCachedViewInfo())
        {
            ClosestDistSq = FMath::Min(ClosestDistSq,
                float(FVector::DistSquared(ViewInfo.ViewToWorld.GetOrigin(), Location)));
        }
        LODDistance = FMath::Sqrt(ClosestDistSq);
    }

    float MaxDist = ScalabilitySettings.MaxDistance;
    Component->SetLODDistance(LODDistance, FMath::Max(MaxDist, 1.0f));

    if (GetScalabilityCullingMode() == ENiagaraScalabilityCullingMode::Enabled &&
        GEnableNiagaraDistanceCulling &&
        ScalabilitySettings.bCullByDistance)
    {
        bool bCull = LODDistance > MaxDist;
        OutState.bCulled |= bCull;
        // Budget 기반 거리 스케일링 추가 처리...
    }
}
```

##### View-Based Culling 소스 검증
**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraWorldManager.cpp:2182`

**핵심 로직:**
1. **뷰 프러스텀 체크**: 6개의 프러스텀 평면과 Bounding Sphere 충돌 검사
2. **LastVisibleTime 업데이트**: `MaxTimeOutsideViewFrustum` 초과 시 컬링
3. **렌더링 체크**: `MaxTimeWithoutRender` 초과 시 컬링 (앱 포커스 없으면 비활성화)

**프러스텀 평면 충돌 공식:**
```
bool bInside = FrustumPlane.PlaneDot(Sphere.Center) <= Sphere.W

where:
  PlaneDot(Point) = Plane.X * Point.X + Plane.Y * Point.Y + Plane.Z * Point.Z - Plane.W
```

##### FNiagaraScalabilityState 소스 검증
**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraScalabilityState.h:10`

```cpp
USTRUCT()
struct FNiagaraScalabilityState
{
    GENERATED_BODY()

    UPROPERTY(VisibleAnywhere, Category="Scalability")
    float Significance;

    UPROPERTY(VisibleAnywhere, Category = "Scalability")
    float LastVisibleTime;

    int16 SystemDataIndex;

    uint8 bNewlyRegistered : 1;
    uint8 bNewlyRegisteredDirty : 1;
    uint8 bCulled : 1;
    uint8 bPreviousCulled : 1;
    uint8 bCulledByDistance : 1;
    uint8 bCulledByInstanceCount : 1;
    uint8 bCulledByVisibility : 1;
    uint8 bCulledByGlobalBudget : 1;

    bool IsDirty() const { return bCulled != bPreviousCulled; }
    void Apply() { bPreviousCulled = bCulled; }
};
```

##### FNiagaraScalabilityManager Update 소스 검증
**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraScalabilityManager.cpp:560`

프레임당 업데이트 처리량 계산:
```cpp
static int32 GetMaxUpdatesPerFrame(const UNiagaraEffectType* EffectType, int32 ItemsRemaining,
    float UpdatePeriod, float DeltaSeconds)
{
    if (GScalabilityMaxUpdatesPerFrame > 0 &&
        EffectType->UpdateFrequency != ENiagaraScalabilityUpdateFrequency::Continuous)
    {
        int32 UpdateCount = ItemsRemaining;
        if ((UpdatePeriod > SMALL_NUMBER) && (DeltaSeconds < UpdatePeriod))
        {
            UpdateCount = FMath::Min(
                FMath::CeilToInt(((float)ItemsRemaining) * DeltaSeconds / UpdatePeriod),
                ItemsRemaining);
        }
        if (UpdateCount > GScalabilityMaxUpdatesPerFrame)
        {
            UpdateCount = GScalabilityMaxUpdatesPerFrame;
        }
        return UpdateCount;
    }
    return ItemsRemaining;
}
```

##### SignificanceHandler 소스 검증
**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraEffectType.cpp:284`

**UNiagaraSignificanceHandlerDistance:**
```cpp
// 역수로 계산: 가까울수록 높은 Significance
State.Significance = 1.0f / LODDistance;
```

**UNiagaraSignificanceHandlerAge:**
```cpp
// 역수로 계산: 최근 생성일수록 Age가 작아 Significance 높음
State.Significance = 1.0f / Controller->GetAge();
```

##### 소스 파일 경로 정리
| 파일 | 경로 | 주요 내용 |
|------|------|-----------|
| **NiagaraEffectType.h** | `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEffectType.h` | UNiagaraEffectType, FNiagaraSystemScalabilitySettings, SignificanceHandler |
| **NiagaraEffectType.cpp** | `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraEffectType.cpp` | SignificanceHandler 구현 (Distance, Age) |
| **NiagaraScalabilityManager.h** | `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraScalabilityManager.h` | FNiagaraScalabilityManager 정의 |
| **NiagaraScalabilityManager.cpp** | `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraScalabilityManager.cpp` | Update, EvaluateCullState, ProcessSignificance |
| **NiagaraScalabilityState.h** | `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraScalabilityState.h` | FNiagaraScalabilityState 정의 |
| **NiagaraWorldManager.cpp** | `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraWorldManager.cpp` | DistanceCull, ViewBasedCulling, InstanceCountCull, GlobalBudgetCull |

