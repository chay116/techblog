---
title: "Blueprint API - Niagara Blueprint 통합"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Blueprint API - Niagara Blueprint 통합

## 🧭 개요 (Overview)

**Niagara Blueprint API**는 **Blueprint에서 Niagara System을 제어하고 상호작용**할 수 있는 완전한 인터페이스를 제공합니다.

이 시스템은 **UNiagaraComponent (인스턴스 제어)**, **UNiagaraFunctionLibrary (Static Helper)**, **Array Data Interface**, **Event 시스템** 등을 통해 **코드 없이도 복잡한 VFX 로직을 구현**할 수 있게 합니다.

**핵심 사용 사례:**
- **UNiagaraComponent**: System 생명주기 제어 (Activate, Deactivate, Reset)
- **Parameter 설정**: 30+ SetVariable* 함수로 Runtime 파라미터 조정
- **UNiagaraFunctionLibrary**: SpawnSystemAtLocation, SpawnSystemAttached
- **Array Data Interface**: Blueprint에서 동적 배열 데이터 전달
- **Event Delegate**: OnSystemFinished로 VFX 완료 감지
- **Parameter Collection**: 전역 파라미터 공유

**📂 주요 위치:**
- Component API: `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraComponent.h`
- Function Library: `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraFunctionLibrary.h`
- Array Function Library: `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceArrayFunctionLibrary.h`

---

## 🎯 설계 철학: 왜 Blueprint API가 중요한가?

### 문제: VFX 프로그래밍의 접근성

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  VFX 프로그래밍의 전통적인 문제점                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ❌ 문제 1: C++ 코드 필수                                                │
│  - 간단한 VFX 로직도 C++ 코드 작성 필요                                 │
│  - 컴파일 시간 증가, 이터레이션 속도 저하                                │
│  - 아티스트/디자이너의 VFX 제어 어려움                                   │
│                                                                         │
│  ❌ 문제 2: Runtime 파라미터 조정 불편                                   │
│  - 하드코딩된 값 변경 시 코드 수정 필요                                  │
│  - 게임 상황에 따른 동적 VFX 변경 어려움                                 │
│  - 예: "체력이 낮으면 붉은색, 높으면 푸른색" → C++ 로직 필요            │
│                                                                         │
│  ❌ 문제 3: 복잡한 데이터 전달                                           │
│  - 배열 데이터 (적 위치 목록) 전달 방법 부재                            │
│  - Curve 데이터, Texture 동적 교체 복잡                                 │
│                                                                         │
│  ❌ 문제 4: VFX 이벤트 감지 어려움                                       │
│  - "VFX가 끝났을 때" 이벤트 감지 불가                                    │
│  - 예: "폭발 이펙트 끝난 후 데미지 처리" → Timer 추측                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                            ↓
                   Niagara Blueprint API 솔루션:
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ✅ 해결 1: 완전한 Blueprint 통합                                        │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  Blueprint Event Graph:                              │              │
│  │                                                      │              │
│  │  [Event BeginPlay]                                   │              │
│  │      │                                               │              │
│  │      ├─► [Spawn System at Location]                  │              │
│  │      │     System: NS_Fire                           │              │
│  │      │     Location: (0, 0, 100)                     │              │
│  │      │     Return: NiagaraComponent                  │              │
│  │      │                                               │              │
│  │      └─► [Set Variable (Float)]                      │              │
│  │            Target: NiagaraComponent                  │              │
│  │            Variable Name: "Intensity"                │              │
│  │            Value: 5.0                                │              │
│  │                                                      │              │
│  │  코드 없이 VFX 생성 및 제어!                         │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
│  ✅ 해결 2: 30+ SetVariable* 함수                                       │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  SetVariableFloat(Name, Value)                       │              │
│  │  SetVariableVec3(Name, Vector)                       │              │
│  │  SetVariableLinearColor(Name, Color)                 │              │
│  │  SetVariableQuat(Name, Rotation)                     │              │
│  │  SetVariableTexture(Name, Texture)                   │              │
│  │  SetVariableMaterial(Name, Material)                 │              │
│  │  SetVariableActor(Name, Actor)                       │              │
│  │  ... (30개 이상)                                     │              │
│  │                                                      │              │
│  │  모든 Niagara 타입 지원!                             │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
│  ✅ 해결 3: Array Data Interface                                        │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  TArray<FVector> EnemyPositions = GetEnemyLocations()│              │
│  │                                                      │              │
│  │  SetNiagaraArrayVector(                              │              │
│  │    NiagaraComponent,                                 │              │
│  │    "EnemyPositions",                                 │              │
│  │    EnemyPositions)                                   │              │
│  │                                                      │              │
│  │  → Niagara에서 배열 데이터 읽기 가능                 │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
│  ✅ 해결 4: OnSystemFinished Delegate                                   │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  [Spawn System at Location]                          │              │
│  │      │                                               │              │
│  │      └─► [Bind Event to OnSystemFinished]            │              │
│  │            │                                         │              │
│  │            └─► [Custom Event: VFX_Finished]          │              │
│  │                  │                                   │              │
│  │                  └─► [Apply Damage]                  │              │
│  │                                                      │              │
│  │  VFX 완료 시 자동으로 이벤트 호출!                   │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 설계 원칙

| 설계 원칙 | 설명 | 효과 |
|----------|------|------|
| **완전한 타입 지원** | Float, Vector, Color, Actor 등 30+ 타입 | 모든 Use Case 커버 |
| **일관된 네이밍** | SetVariable*, GetVariable* 패턴 | 학습 곡선 최소화 |
| **Static Helper** | UNiagaraFunctionLibrary::SpawnSystem* | 어디서든 호출 가능 |
| **이벤트 기반** | OnSystemFinished Delegate | 비동기 VFX 로직 구현 |
| **Array 지원** | 11개 Array 타입 (Float, Vector, Color 등) | 대량 데이터 전달 |

---

## 🏗️ 시스템 아키텍처 (System Architecture)

### 전체 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                 Niagara Blueprint API Architecture                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │              Blueprint Layer (Blueprint Graph)                │      │
│  ├──────────────────────────────────────────────────────────────┤      │
│  │                                                              │      │
│  │  ┌────────────────────────────────────────────────┐          │      │
│  │  │   UNiagaraFunctionLibrary (Static Helpers)     │          │      │
│  │  │   - SpawnSystemAtLocation()                    │          │      │
│  │  │   - SpawnSystemAttached()                      │          │      │
│  │  │   - GetNiagaraParameterCollection()            │          │      │
│  │  │   - OverrideSystemUserVariableStaticMesh()     │          │      │
│  │  └────────────────────────────────────────────────┘          │      │
│  │             │                        │                        │      │
│  │             │ Returns                │ Manipulates           │      │
│  │             ↓                        ↓                        │      │
│  │  ┌────────────────────────────────────────────────┐          │      │
│  │  │   UNiagaraComponent (Instance Control)         │          │      │
│  │  │   - Activate() / Deactivate()                  │          │      │
│  │  │   - ResetSystem()                              │          │      │
│  │  │   - SetVariableFloat/Vec3/Color/...           │          │      │
│  │  │   - GetVariableFloat/Vec3/Color/...           │          │      │
│  │  │   - SetAsset() / GetAsset()                    │          │      │
│  │  │   - OnSystemFinished (Delegate)                │          │      │
│  │  └────────────────────────────────────────────────┘          │      │
│  │             │                                                 │      │
│  │             │ Controls                                        │      │
│  │             ↓                                                 │      │
│  │  ┌────────────────────────────────────────────────┐          │      │
│  │  │   UNiagaraSystem (Asset)                       │          │      │
│  │  │   - Emitters[]                                 │          │      │
│  │  │   - User Parameters                            │          │      │
│  │  └────────────────────────────────────────────────┘          │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │       Array Data Interface (동적 배열 데이터 전달)            │      │
│  ├──────────────────────────────────────────────────────────────┤      │
│  │                                                              │      │
│  │  Blueprint:                                                  │      │
│  │  ┌────────────────────────────────────────────────┐          │      │
│  │  │ UNiagaraDataInterfaceArrayFunctionLibrary      │          │      │
│  │  │   - SetNiagaraArrayFloat()                     │          │      │
│  │  │   - SetNiagaraArrayVector()                    │          │      │
│  │  │   - SetNiagaraArrayColor()                     │          │      │
│  │  │   - SetNiagaraArrayQuat()                      │          │      │
│  │  │   - ... (11 types)                             │          │      │
│  │  └────────────────────────────────────────────────┘          │      │
│  │             │                                                 │      │
│  │             │ Sets Array Data                                │      │
│  │             ↓                                                 │      │
│  │  ┌────────────────────────────────────────────────┐          │      │
│  │  │   UNiagaraDataInterfaceArray* (Runtime DI)     │          │      │
│  │  │   - FloatData[]                                │          │      │
│  │  │   - VectorData[]                               │          │      │
│  │  │   - ColorData[]                                │          │      │
│  │  └────────────────────────────────────────────────┘          │      │
│  │             │                                                 │      │
│  │             │ Read in Niagara Script                         │      │
│  │             ↓                                                 │      │
│  │  ┌────────────────────────────────────────────────┐          │      │
│  │  │   Niagara Emitter Script                       │          │      │
│  │  │   for (int i = 0; i < ArrayLength; i++)        │          │      │
│  │  │     Value = ArrayDI.GetFloatValue(i)           │          │      │
│  │  └────────────────────────────────────────────────┘          │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │       Parameter Collection (전역 파라미터 공유)               │      │
│  ├──────────────────────────────────────────────────────────────┤      │
│  │                                                              │      │
│  │  ┌────────────────────────────────────────────────┐          │      │
│  │  │   UNiagaraParameterCollection (Asset)          │          │      │
│  │  │   - Parameters[]                               │          │      │
│  │  │     "Global_WindDirection" : Vector            │          │      │
│  │  │     "Global_TimeOfDay" : Float                 │          │      │
│  │  └────────────────────────────────────────────────┘          │      │
│  │             ▲                                                 │      │
│  │             │ Read                                            │      │
│  │             │                                                 │      │
│  │  ┌──────────┴──────────────────────────────────────┐         │      │
│  │  │   Multiple Niagara Systems                      │         │      │
│  │  │   NS_Fire, NS_Smoke, NS_Leaves (공유 파라미터)  │         │      │
│  │  └─────────────────────────────────────────────────┘         │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧱 핵심 클래스 상세 (Core Classes)

### 1. UNiagaraComponent - Instance 제어

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraComponent.h:84-730`

**역할:** Niagara System의 런타임 인스턴스를 제어하는 Component

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       UNiagaraComponent                                 │
│  (Niagara System Instance - 생명주기 및 파라미터 제어)                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Public Properties:                                                     │
│    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Niagara")      │
│    TObjectPtr<UNiagaraSystem> Asset                                     │
│      // 실행할 Niagara System 자산                                      │
│                                                                         │
│    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Niagara")      │
│    bool bAutoActivate = true                                            │
│      // Component 생성 시 자동 활성화 여부                               │
│                                                                         │
│    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Niagara")      │
│    bool bAutoDestroy = false                                            │
│      // System 완료 시 자동으로 Component 파괴                          │
│                                                                         │
│  Lifecycle Methods (Blueprint Callable):                                │
│    UFUNCTION(BlueprintCallable)                                         │
│    void Activate(bool bReset = false)                                   │
│      // System 활성화 (bReset=true면 처음부터 재시작)                   │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void Deactivate()                                                    │
│      // System 비활성화 (현재 파티클은 수명까지 유지)                   │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void DeactivateImmediate()                                           │
│      // System 즉시 비활성화 (모든 파티클 즉시 제거)                    │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void ResetSystem()                                                   │
│      // System 리셋 (처음부터 다시 시작)                                │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void ReinitializeSystem()                                            │
│      // System 재초기화 (Asset 변경 후 호출)                            │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetPaused(bool bInPaused)                                       │
│      // System 일시정지/재개                                            │
│                                                                         │
│  Asset Manipulation (Blueprint Callable):                               │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetAsset(UNiagaraSystem* InAsset, bool bResetExistingOverrides)│
│      // 실행 중인 System 교체                                           │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    UNiagaraSystem* GetAsset() const                                     │
│      // 현재 System 자산 반환                                           │
│                                                                         │
│  Parameter Setting (Blueprint Callable):                                │
│    // Float                                                             │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVariableFloat(FName InVariableName, float InValue)           │
│                                                                         │
│    // Int                                                               │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVariableInt(FName InVariableName, int32 InValue)             │
│                                                                         │
│    // Bool                                                              │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVariableBool(FName InVariableName, bool InValue)             │
│                                                                         │
│    // Vector (FVector)                                                  │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVariableVec3(FName InVariableName, FVector InValue)          │
│                                                                         │
│    // Vector2D                                                          │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVariableVec2(FName InVariableName, FVector2D InValue)        │
│                                                                         │
│    // Vector4                                                           │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVariableVec4(FName InVariableName, FVector4 InValue)         │
│                                                                         │
│    // LinearColor (Color)                                               │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVariableLinearColor(FName InVariableName,                    │
│                                 const FLinearColor& InValue)            │
│                                                                         │
│    // Quat (Rotation)                                                   │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVariableQuat(FName InVariableName, const FQuat& InValue)     │
│                                                                         │
│    // Position (World Space Vector)                                     │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVariablePosition(FName InVariableName, FVector InValue)      │
│                                                                         │
│    // Object (UObject*)                                                 │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVariableObject(FName InVariableName, UObject* Object)        │
│                                                                         │
│    // Actor (AActor*)                                                   │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVariableActor(FName InVariableName, AActor* Actor)           │
│                                                                         │
│    // Material (UMaterialInterface*)                                    │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVariableMaterial(FName InVariableName,                       │
│                              UMaterialInterface* Material)              │
│                                                                         │
│    // Static Mesh (UStaticMesh*)                                        │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVariableStaticMesh(FName InVariableName,                     │
│                                UStaticMesh* StaticMesh)                 │
│                                                                         │
│    // Texture (UTexture*)                                               │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVariableTexture(FName InVariableName, UTexture* Texture)     │
│                                                                         │
│    // Texture Render Target                                             │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVariableTextureRenderTarget(FName InVariableName,            │
│                                         UTextureRenderTarget* Texture)  │
│                                                                         │
│    // ... (30+ SetVariable* 함수)                                       │
│                                                                         │
│  Parameter Getting (Blueprint Callable):                                │
│    UFUNCTION(BlueprintCallable)                                         │
│    float GetVariableFloat(FName InVariableName) const                   │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    int32 GetVariableInt(FName InVariableName) const                     │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    bool GetVariableBool(FName InVariableName) const                     │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    FVector GetVariableVec3(FName InVariableName) const                  │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    FLinearColor GetVariableLinearColor(FName InVariableName) const      │
│                                                                         │
│    // ... (Get 함수도 30+ 존재)                                          │
│                                                                         │
│  Delegates (Blueprint Assignable):                                      │
│    DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(                         │
│        FOnNiagaraSystemFinished,                                        │
│        UNiagaraComponent*, PSystem)                                     │
│                                                                         │
│    UPROPERTY(BlueprintAssignable, Category="Niagara")                   │
│    FOnNiagaraSystemFinished OnSystemFinished                            │
│      // System 완료 시 호출되는 이벤트                                  │
│                                                                         │
│  Query Methods (Blueprint Callable):                                    │
│    UFUNCTION(BlueprintCallable)                                         │
│    bool IsActive() const                                                │
│      // 현재 활성 상태 확인                                             │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    ENiagaraExecutionState GetRequestedExecutionState() const            │
│      // 요청된 실행 상태 (Active, Inactive, etc.)                       │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    float GetDesiredAge() const                                          │
│      // System의 원하는 나이 (Sequencer에서 사용)                       │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetDesiredAge(float InDesiredAge)                               │
│      // System의 나이를 직접 설정 (Scrubbing)                           │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SeekToDesiredAge(float InDesiredAge)                            │
│      // 특정 시간으로 점프 (Tick 없이 즉시 이동)                        │
│                                                                         │
│  Advanced Methods:                                                      │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetForceSolo(bool bInForceSolo)                                 │
│      // System을 Solo 모드로 강제 (다른 System과 독립 실행)             │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetRandomSeedOffset(int32 InRandomSeedOffset)                   │
│      // Random Seed Offset 설정 (다른 난수 시퀀스)                      │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    int32 GetRandomSeedOffset() const                                    │
│      // 현재 Random Seed Offset 반환                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 2. UNiagaraFunctionLibrary - Static Helper 함수

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraFunctionLibrary.h:19-296`

**역할:** Blueprint에서 Niagara System을 생성하고 조작하는 Static 함수 모음

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   UNiagaraFunctionLibrary                               │
│  (Static Helper 함수 - Blueprint에서 호출 가능한 Utility)                │
├─────────────────────────────────────────────────────────────────────────┤
│  Spawn System (Blueprint Callable):                                     │
│    UFUNCTION(BlueprintCallable, Category="Niagara",                     │
│              meta=(WorldContext="WorldContextObject"))                  │
│    static UNiagaraComponent* SpawnSystemAtLocation(                     │
│        UObject* WorldContextObject,                                     │
│        UNiagaraSystem* SystemTemplate,                                  │
│        FVector Location,                                                │
│        FRotator Rotation = FRotator::ZeroRotator,                       │
│        FVector Scale = FVector(1.0f),                                   │
│        bool bAutoDestroy = true,                                        │
│        bool bAutoActivate = true,                                       │
│        ENCPoolMethod PoolingMethod = ENCPoolMethod::None,               │
│        bool bPreCullCheck = true)                                       │
│      // 월드 위치에 System 생성                                         │
│        - bAutoDestroy=true: System 완료 시 자동 파괴                    │
│        - PoolingMethod: None, AutoRelease, ManualRelease (Component Pool)│
│        - bPreCullCheck: Spawn 전 Scalability Culling 체크               │
│                                                                         │
│    UFUNCTION(BlueprintCallable, Category="Niagara",                     │
│              meta=(WorldContext="WorldContextObject"))                  │
│    static UNiagaraComponent* SpawnSystemAttached(                       │
│        UNiagaraSystem* SystemTemplate,                                  │
│        USceneComponent* AttachToComponent,                              │
│        FName AttachPointName,                                           │
│        FVector Location,                                                │
│        FRotator Rotation,                                               │
│        FVector Scale,                                                   │
│        EAttachLocation::Type LocationType,                              │
│        bool bAutoDestroy = true,                                        │
│        bool bAutoActivate = true,                                       │
│        ENCPoolMethod PoolingMethod = ENCPoolMethod::None,               │
│        bool bPreCullCheck = true)                                       │
│      // Component에 Attach하여 System 생성                              │
│        - AttachToComponent: 부모 Component (Character Mesh 등)          │
│        - AttachPointName: Socket 이름 (예: "hand_r")                    │
│        - LocationType: KeepRelative, KeepWorld, SnapToTarget            │
│                                                                         │
│  Parameter Override (Blueprint Callable):                               │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void OverrideSystemUserVariableStaticMeshComponent(           │
│        UNiagaraComponent* NiagaraSystem,                                │
│        const FString& OverrideName,                                     │
│        UStaticMeshComponent* StaticMeshComponent)                       │
│      // User Variable을 StaticMeshComponent로 Override                 │
│                                                                         │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void OverrideSystemUserVariableStaticMesh(                    │
│        UNiagaraComponent* NiagaraSystem,                                │
│        const FString& OverrideName,                                     │
│        UStaticMesh* StaticMesh)                                         │
│      // User Variable을 StaticMesh로 Override                          │
│                                                                         │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void OverrideSystemUserVariableSkeletalMeshComponent(         │
│        UNiagaraComponent* NiagaraSystem,                                │
│        const FString& OverrideName,                                     │
│        USkeletalMeshComponent* SkeletalMeshComponent)                   │
│      // User Variable을 SkeletalMeshComponent로 Override               │
│                                                                         │
│  Parameter Collection (Blueprint Callable):                             │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static UNiagaraParameterCollectionInstance*                          │
│        GetNiagaraParameterCollection(                                   │
│        UObject* WorldContextObject,                                     │
│        UNiagaraParameterCollection* Collection)                         │
│      // Parameter Collection Instance 반환 (전역 파라미터 접근)         │
│                                                                         │
│  Utility (Blueprint Callable):                                          │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void SetVolumeTextureObject(                                  │
│        UNiagaraComponent* NiagaraSystem,                                │
│        const FString& OverrideName,                                     │
│        UVolumeTexture* Texture)                                         │
│      // Volume Texture 설정                                             │
│                                                                         │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void SetTextureObject(                                        │
│        UNiagaraComponent* NiagaraSystem,                                │
│        const FString& OverrideName,                                     │
│        UTexture* Texture)                                               │
│      // 2D Texture 설정                                                 │
│                                                                         │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void SetTexture2DArrayObject(                                 │
│        UNiagaraComponent* NiagaraSystem,                                │
│        const FString& OverrideName,                                     │
│        UTexture2DArray* Texture)                                        │
│      // Texture2DArray 설정                                             │
│                                                                         │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static UNiagaraDataInterfaceSkeletalMesh*                            │
│        GetSkeletalMeshDataInterface(                                    │
│        UNiagaraComponent* NiagaraComponent,                             │
│        FName DIName)                                                    │
│      // Skeletal Mesh Data Interface 접근                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 3. UNiagaraDataInterfaceArrayFunctionLibrary - Array 데이터 전달

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceArrayFunctionLibrary.h:20-165`

**역할:** Blueprint에서 Niagara로 배열 데이터를 전달하는 함수 모음

```
┌─────────────────────────────────────────────────────────────────────────┐
│          UNiagaraDataInterfaceArrayFunctionLibrary                      │
│  (Array 데이터 전달 - Blueprint → Niagara Script)                        │
├─────────────────────────────────────────────────────────────────────────┤
│  Array Setters (Blueprint Callable):                                    │
│                                                                         │
│    // Float Array                                                       │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void SetNiagaraArrayFloat(                                    │
│        UNiagaraComponent* NiagaraSystem,                                │
│        FName OverrideName,                                              │
│        const TArray<float>& ArrayData)                                  │
│                                                                         │
│    // Vector Array (FVector)                                            │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void SetNiagaraArrayVector(                                   │
│        UNiagaraComponent* NiagaraSystem,                                │
│        FName OverrideName,                                              │
│        const TArray<FVector>& ArrayData)                                │
│                                                                         │
│    // Vector2D Array                                                    │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void SetNiagaraArrayVector2D(                                 │
│        UNiagaraComponent* NiagaraSystem,                                │
│        FName OverrideName,                                              │
│        const TArray<FVector2D>& ArrayData)                              │
│                                                                         │
│    // Vector4 Array                                                     │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void SetNiagaraArrayVector4(                                  │
│        UNiagaraComponent* NiagaraSystem,                                │
│        FName OverrideName,                                              │
│        const TArray<FVector4>& ArrayData)                               │
│                                                                         │
│    // Color Array (FLinearColor)                                        │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void SetNiagaraArrayColor(                                    │
│        UNiagaraComponent* NiagaraSystem,                                │
│        FName OverrideName,                                              │
│        const TArray<FLinearColor>& ArrayData)                           │
│                                                                         │
│    // Quat Array (FQuat)                                                │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void SetNiagaraArrayQuat(                                     │
│        UNiagaraComponent* NiagaraSystem,                                │
│        FName OverrideName,                                              │
│        const TArray<FQuat>& ArrayData)                                  │
│                                                                         │
│    // Int32 Array                                                       │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void SetNiagaraArrayInt32(                                    │
│        UNiagaraComponent* NiagaraSystem,                                │
│        FName OverrideName,                                              │
│        const TArray<int32>& ArrayData)                                  │
│                                                                         │
│    // Bool Array                                                        │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void SetNiagaraArrayBool(                                     │
│        UNiagaraComponent* NiagaraSystem,                                │
│        FName OverrideName,                                              │
│        const TArray<bool>& ArrayData)                                   │
│                                                                         │
│    // UObject* Array                                                    │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void SetNiagaraArrayUObject(                                  │
│        UNiagaraComponent* NiagaraSystem,                                │
│        FName OverrideName,                                              │
│        const TArray<UObject*>& ArrayData)                               │
│                                                                         │
│    // Position Array (World Space Vectors)                              │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void SetNiagaraArrayPosition(                                 │
│        UNiagaraComponent* NiagaraSystem,                                │
│        FName OverrideName,                                              │
│        const TArray<FVector>& ArrayData)                                │
│                                                                         │
│    // Matrix Array (FMatrix)                                            │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static void SetNiagaraArrayMatrix(                                   │
│        UNiagaraComponent* NiagaraSystem,                                │
│        FName OverrideName,                                              │
│        const TArray<FMatrix>& ArrayData)                                │
│                                                                         │
│  Array Getters (Blueprint Callable):                                    │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static TArray<float> GetNiagaraArrayFloat(                           │
│        UNiagaraComponent* NiagaraSystem,                                │
│        FName OverrideName)                                              │
│                                                                         │
│    UFUNCTION(BlueprintCallable, Category="Niagara")                     │
│    static TArray<FVector> GetNiagaraArrayVector(                        │
│        UNiagaraComponent* NiagaraSystem,                                │
│        FName OverrideName)                                              │
│                                                                         │
│    // ... (Get 함수도 11개 타입 모두 존재)                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**지원되는 Array 타입 11가지:**

| 타입 | Blueprint 표현 | Niagara Script에서 사용 |
|------|---------------|------------------------|
| **Float** | TArray<float> | ArrayFloat DI |
| **Vector** | TArray<FVector> | ArrayVector DI |
| **Vector2D** | TArray<FVector2D> | ArrayVector2D DI |
| **Vector4** | TArray<FVector4> | ArrayVector4 DI |
| **Color** | TArray<FLinearColor> | ArrayColor DI |
| **Quat** | TArray<FQuat> | ArrayQuat DI |
| **Int32** | TArray<int32> | ArrayInt32 DI |
| **Bool** | TArray<bool> | ArrayBool DI |
| **Position** | TArray<FVector> | ArrayPosition DI (World Space) |
| **Matrix** | TArray<FMatrix> | ArrayMatrix DI |
| **UObject** | TArray<UObject*> | ArrayUObject DI |

---

### 4. UNiagaraParameterCollectionInstance - 전역 파라미터

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraParameterCollection.h:94-158`

**역할:** 여러 Niagara System이 공유하는 전역 파라미터 인스턴스

```
┌─────────────────────────────────────────────────────────────────────────┐
│              UNiagaraParameterCollectionInstance                        │
│  (전역 파라미터 인스턴스 - 여러 System이 공유)                          │
├─────────────────────────────────────────────────────────────────────────┤
│  Public Methods (Blueprint Callable):                                   │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetFloatParameter(FName InVariableName, float InValue)          │
│      // Float 파라미터 설정                                             │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetIntParameter(FName InVariableName, int32 InValue)            │
│      // Int 파라미터 설정                                               │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetBoolParameter(FName InVariableName, bool InValue)            │
│      // Bool 파라미터 설정                                              │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVector3Parameter(FName InVariableName, FVector InValue)      │
│      // Vector 파라미터 설정                                            │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVector2DParameter(FName InVariableName, FVector2D InValue)   │
│      // Vector2D 파라미터 설정                                          │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetVector4Parameter(FName InVariableName, FVector4 InValue)     │
│      // Vector4 파라미터 설정                                           │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetColorParameter(FName InVariableName,                         │
│                            FLinearColor InValue)                        │
│      // Color 파라미터 설정                                             │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetQuatParameter(FName InVariableName, const FQuat& InValue)    │
│      // Quat 파라미터 설정                                              │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    float GetFloatParameter(FName InVariableName) const                  │
│      // Float 파라미터 반환                                             │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    int32 GetIntParameter(FName InVariableName) const                    │
│      // Int 파라미터 반환                                               │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    bool GetBoolParameter(FName InVariableName) const                    │
│      // Bool 파라미터 반환                                              │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    FVector GetVector3Parameter(FName InVariableName) const              │
│      // Vector 파라미터 반환                                            │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    FLinearColor GetColorParameter(FName InVariableName) const           │
│      // Color 파라미터 반환                                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 실전 사용 예시 (Practical Examples)

### 예시 1: 기본 System 생성 및 파라미터 설정

**시나리오:** Player가 버튼을 누르면 폭발 이펙트 생성, 강도는 체력에 비례

**Blueprint 구현:**

```
[Event: OnButtonPressed]
    │
    ├─► [Get Player Health]
    │       │
    │       └─► Health (Float)
    │
    ├─► [Spawn System at Location]
    │       SystemTemplate: NS_Explosion
    │       Location: (0, 0, 100)
    │       bAutoDestroy: true
    │       Return: NiagaraComponent
    │
    └─► [Set Variable Float]
            Target: NiagaraComponent
            Variable Name: "Intensity"
            Value: Health / 100.0  // 0.0 ~ 1.0
```

**C++ 동등 코드:**

```cpp
void AMyActor::OnButtonPressed()
{
    float Health = GetPlayerHealth();
    FVector Location = FVector(0, 0, 100);

    UNiagaraComponent* NiagaraComp = UNiagaraFunctionLibrary::SpawnSystemAtLocation(
        this, NS_Explosion, Location, FRotator::ZeroRotator,
        FVector(1.0f), true);

    if (NiagaraComp)
    {
        NiagaraComp->SetVariableFloat(FName("Intensity"), Health / 100.0f);
    }
}
```

---

### 예시 2: Actor에 Attach된 System

**시나리오:** Character의 오른손 Socket에 불 이펙트 Attach

**Blueprint 구현:**

```
[Event: BeginPlay]
    │
    ├─► [Get Mesh Component]
    │       │
    │       └─► Mesh (USkeletalMeshComponent*)
    │
    └─► [Spawn System Attached]
            SystemTemplate: NS_Fire
            AttachToComponent: Mesh
            AttachPointName: "hand_r"  // Socket Name
            Location: (0, 0, 0)
            Rotation: (0, 0, 0)
            LocationType: SnapToTarget
            bAutoDestroy: false
            Return: NiagaraComponent
            │
            └─► [Set Variable Linear Color]
                    Target: NiagaraComponent
                    Variable Name: "FireColor"
                    Value: (1.0, 0.5, 0.0, 1.0)  // Orange
```

**C++ 동등 코드:**

```cpp
void AMyCharacter::BeginPlay()
{
    Super::BeginPlay();

    USkeletalMeshComponent* Mesh = GetMesh();
    UNiagaraComponent* FireComp = UNiagaraFunctionLibrary::SpawnSystemAttached(
        NS_Fire, Mesh, FName("hand_r"), FVector::ZeroVector,
        FRotator::ZeroRotator, FVector(1.0f),
        EAttachLocation::SnapToTarget, false, true);

    if (FireComp)
    {
        FireComp->SetVariableLinearColor(FName("FireColor"),
            FLinearColor(1.0f, 0.5f, 0.0f, 1.0f));
    }
}
```

---

### 예시 3: OnSystemFinished Event 활용

**시나리오:** 폭발 이펙트가 끝나면 데미지 적용

**Blueprint 구현:**

```
[Event: TriggerExplosion]
    │
    ├─► [Spawn System at Location]
    │       SystemTemplate: NS_Explosion
    │       Location: ExplosionLocation
    │       bAutoDestroy: true
    │       Return: NiagaraComponent
    │       │
    │       └─► [Bind Event to OnSystemFinished]
    │               Event: OnExplosionFinished
    │
    └─► [Custom Event: OnExplosionFinished]
            PSystem (UNiagaraComponent*)
            │
            ├─► [Apply Radial Damage]
            │       Origin: PSystem->GetComponentLocation()
            │       Radius: 500.0
            │       Damage: 100.0
            │
            └─► [Print String]
                    Text: "Explosion finished!"
```

**C++ 동등 코드:**

```cpp
void AMyActor::TriggerExplosion(FVector Location)
{
    UNiagaraComponent* ExplosionComp = UNiagaraFunctionLibrary::SpawnSystemAtLocation(
        this, NS_Explosion, Location, FRotator::ZeroRotator,
        FVector(1.0f), true);

    if (ExplosionComp)
    {
        ExplosionComp->OnSystemFinished.AddDynamic(this,
            &AMyActor::OnExplosionFinished);
    }
}

void AMyActor::OnExplosionFinished(UNiagaraComponent* PSystem)
{
    FVector Origin = PSystem->GetComponentLocation();
    UGameplayStatics::ApplyRadialDamage(this, 100.0f, Origin, 500.0f,
        nullptr, TArray<AActor*>(), this);

    UE_LOG(LogTemp, Log, TEXT("Explosion finished!"));
}
```

---

### 예시 4: Array Data Interface 사용 (적 위치 목록 전달)

**시나리오:** 화살 System에 적 위치 배열 전달, 각 화살이 적을 추적

**Niagara System 설정:**
- Data Interface: `ArrayVector` (이름: "EnemyPositions")
- Particle Update에서 `ArrayVector.GetVectorValue(Index)` 호출

**Blueprint 구현:**

```
[Event Tick]
    │
    ├─► [Get All Actors of Class]
    │       ActorClass: AEnemyCharacter
    │       Return: OutActors (TArray<AActor*>)
    │       │
    │       └─► [For Each Loop]
    │               Array: OutActors
    │               │
    │               ├─► [Get Actor Location]
    │               │       Actor: ArrayElement
    │               │       Return: Location (FVector)
    │               │
    │               └─► [Array Add]
    │                       Target: EnemyPositions (TArray<FVector>)
    │                       Item: Location
    │
    └─► [Set Niagara Array Vector]
            NiagaraSystem: ArrowSystemComponent
            OverrideName: "EnemyPositions"
            ArrayData: EnemyPositions
```

**C++ 동등 코드:**

```cpp
void AMyActor::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    TArray<AActor*> Enemies;
    UGameplayStatics::GetAllActorsOfClass(this, AEnemyCharacter::StaticClass(), Enemies);

    TArray<FVector> EnemyPositions;
    for (AActor* Enemy : Enemies)
    {
        EnemyPositions.Add(Enemy->GetActorLocation());
    }

    UNiagaraDataInterfaceArrayFunctionLibrary::SetNiagaraArrayVector(
        ArrowSystemComponent, FName("EnemyPositions"), EnemyPositions);
}
```

**Niagara Script (Particle Update):**

```hlsl
// ArrayVector Data Interface: "EnemyPositions"
int32 NumEnemies = ArrayVector.Length(EnemyPositions);

if (NumEnemies > 0)
{
    // 가장 가까운 적 찾기
    int32 ClosestIndex = 0;
    float MinDist = 999999.0;

    for (int32 i = 0; i < NumEnemies; i++)
    {
        FVector EnemyPos = ArrayVector.GetVectorValue(EnemyPositions, i);
        float Dist = length(Particles.Position - EnemyPos);

        if (Dist < MinDist)
        {
            MinDist = Dist;
            ClosestIndex = i;
        }
    }

    // 가장 가까운 적 향해 이동
    FVector TargetPos = ArrayVector.GetVectorValue(EnemyPositions, ClosestIndex);
    FVector Direction = normalize(TargetPos - Particles.Position);
    Particles.Velocity = Direction * 1000.0;  // 1000 units/sec
}
```

---

### 예시 5: Parameter Collection 사용 (전역 환경 설정)

**시나리오:** 모든 Niagara System이 전역 Wind Direction과 Time of Day 공유

**1. Parameter Collection 자산 생성:**
- Content Browser → 우클릭 → Niagara → Niagara Parameter Collection
- 이름: "NPC_GlobalEnvironment"
- Parameters:
  - "Global_WindDirection" : Vector (기본값: (1, 0, 0))
  - "Global_TimeOfDay" : Float (기본값: 12.0)

**2. Niagara System에서 참조:**
- NS_Leaves, NS_Smoke, NS_Dust 등
- Parameter Collection 추가: NPC_GlobalEnvironment
- Script에서 사용:
  ```hlsl
  FVector WindDir = ParameterCollection.Global_WindDirection;
  Particles.Velocity += WindDir * 100.0;
  ```

**3. Blueprint에서 Runtime 업데이트:**

```
[Event Tick]
    │
    ├─► [Get Niagara Parameter Collection]
    │       WorldContext: Self
    │       Collection: NPC_GlobalEnvironment
    │       Return: CollectionInstance
    │       │
    │       ├─► [Get Wind Direction from Weather System]
    │       │       Return: WindDirection (FVector)
    │       │
    │       ├─► [Set Vector3 Parameter]
    │       │       Target: CollectionInstance
    │       │       Variable Name: "Global_WindDirection"
    │       │       Value: WindDirection
    │       │
    │       ├─► [Get Current Time of Day]
    │       │       Return: TimeOfDay (Float)  // 0~24
    │       │
    │       └─► [Set Float Parameter]
    │               Target: CollectionInstance
    │               Variable Name: "Global_TimeOfDay"
    │               Value: TimeOfDay
```

**C++ 동등 코드:**

```cpp
void AMyGameMode::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    UNiagaraParameterCollectionInstance* CollectionInstance =
        UNiagaraFunctionLibrary::GetNiagaraParameterCollection(
            this, NPC_GlobalEnvironment);

    if (CollectionInstance)
    {
        FVector WindDirection = WeatherSystem->GetWindDirection();
        CollectionInstance->SetVector3Parameter(FName("Global_WindDirection"),
            WindDirection);

        float TimeOfDay = GetCurrentTimeOfDay();  // 0~24
        CollectionInstance->SetFloatParameter(FName("Global_TimeOfDay"),
            TimeOfDay);
    }
}
```

**결과:** 모든 Niagara System (나뭇잎, 연기, 먼지 등)이 동일한 Wind Direction 적용

---

### 예시 6: Dynamic Material Parameter 변경

**시나리오:** 체력에 따라 Effect 색상 변경 (100% = 초록, 0% = 빨강)

**Blueprint 구현:**

```
[Event Tick]
    │
    ├─► [Get Player Health]
    │       Return: Health (Float)  // 0~100
    │
    ├─► [Lerp (Linear Color)]
    │       A: (1.0, 0.0, 0.0, 1.0)  // Red
    │       B: (0.0, 1.0, 0.0, 1.0)  // Green
    │       Alpha: Health / 100.0
    │       Return: CurrentColor (FLinearColor)
    │
    └─► [Set Variable Linear Color]
            Target: HealthIndicatorNiagaraComponent
            Variable Name: "IndicatorColor"
            Value: CurrentColor
```

**C++ 동등 코드:**

```cpp
void AMyCharacter::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    float Health = GetHealth();  // 0~100
    float Alpha = Health / 100.0f;

    FLinearColor RedColor(1.0f, 0.0f, 0.0f, 1.0f);
    FLinearColor GreenColor(0.0f, 1.0f, 0.0f, 1.0f);
    FLinearColor CurrentColor = FMath::Lerp(RedColor, GreenColor, Alpha);

    HealthIndicatorNiagaraComponent->SetVariableLinearColor(
        FName("IndicatorColor"), CurrentColor);
}
```

---

## 🐛 디버깅 및 최적화 팁 (Debugging & Optimization Tips)

### 일반적인 함정

#### ❌ 하지 말아야 할 것:

```cpp
// 1. Tick에서 매 프레임 Spawn
Tick():
  SpawnSystemAtLocation(NS_Fire, ...)  // ← 매 프레임 새 Component 생성!
// 결과: 메모리 누수, 성능 저하

// 2. Variable Name 오타
SetVariableFloat("Intesity", 5.0)  // ← "Intensity" 오타
// 결과: 파라미터 설정 안 됨, 로그에 Warning

// 3. bAutoDestroy=false로 Spawn 후 관리 안 함
UNiagaraComponent* Comp = SpawnSystemAtLocation(..., false)
// Comp를 저장하지 않으면 메모리 누수
// 반드시 Deactivate() 호출 필요

// 4. Array Data를 매 프레임 Set (큰 배열)
Tick():
  TArray<FVector> LargeArray(10000);
  SetNiagaraArrayVector(Comp, "Data", LargeArray)  // ← CPU 복사 비용!
// 변경 시에만 Set 호출
```

#### ✅ 올바른 방법:

```cpp
// 1. Component Pooling 사용
SpawnSystemAtLocation(NS_Fire, ..., ENCPoolMethod::AutoRelease)
// Component Pool에서 재사용, 성능 향상

// 2. Variable Name을 FName으로 관리
static const FName IntensityParam = FName("Intensity");
SetVariableFloat(IntensityParam, 5.0)

// 3. bAutoDestroy=true 또는 명시적 관리
UNiagaraComponent* Comp = SpawnSystemAtLocation(..., true)  // 자동 파괴
// OR
Comp = SpawnSystemAtLocation(..., false)
SavedComponents.Add(Comp)  // 저장
// 나중에 Comp->Deactivate()

// 4. Array Data 변경 시에만 Set
if (EnemyPositionsChanged)
{
    SetNiagaraArrayVector(Comp, "EnemyPositions", NewPositions)
    EnemyPositionsChanged = false
}
```

---

### Parameter 설정 시 주의사항

| 상황 | 문제 | 해결 방법 |
|------|------|----------|
| **Variable Name 오타** | 파라미터 설정 안 됨 | Editor에서 복사/붙여넣기 사용, const FName 정의 |
| **Type 불일치** | SetVariableFloat("Color", ...) | 올바른 타입 함수 사용 (SetVariableLinearColor) |
| **Niagara System에 파라미터 없음** | Runtime Error | Niagara Editor에서 User Parameter 먼저 생성 |
| **Component가 nullptr** | Crash | SpawnSystem* 반환값 nullptr 체크 |
| **매 프레임 Set** | CPU 오버헤드 | 변경 시에만 호출, Dirty Flag 사용 |

---

### Blueprint vs C++ 성능 비교

| 작업 | Blueprint 성능 | C++ 성능 | 권장 사항 |
|------|--------------|---------|----------|
| **SetVariableFloat (1회)** | 거의 동일 | 거의 동일 | Blueprint OK |
| **SetVariableFloat (Tick)** | 약간 느림 | 빠름 | C++로 이동 고려 |
| **SpawnSystemAtLocation** | 거의 동일 | 거의 동일 | Blueprint OK |
| **Array Data Set (작은 배열)** | 약간 느림 | 빠름 | Blueprint OK |
| **Array Data Set (큰 배열 Tick)** | 느림 | 빠름 | C++로 이동 필수 |
| **OnSystemFinished Event** | 거의 동일 | 거의 동일 | Blueprint OK |

**결론:** 대부분의 Use Case에서 Blueprint 사용 가능, 매 프레임 대량 데이터 처리만 C++

---

### Component Pooling 활용

**문제:** SpawnSystem*을 자주 호출하면 GC 압력 증가

**해결:** Component Pooling 사용

```cpp
// Blueprint에서:
SpawnSystemAtLocation(
    NS_Fire,
    Location,
    Rotation,
    Scale,
    true,  // bAutoDestroy
    true,  // bAutoActivate
    ENCPoolMethod::AutoRelease,  // ← Pooling 활성화!
    true   // bPreCullCheck
)

// 내부 동작:
// 1. Pool에 비활성 Component 있으면 재사용
// 2. 없으면 새로 생성
// 3. System 완료 시 Deactivate → Pool로 반환
```

**성능 이점:**
- GC 호출 횟수 감소 (수백 개 Component → 수십 개 Pool)
- Spawn 시간 감소 (이미 생성된 Component 재사용)
- 메모리 단편화 감소

---

### 일반적인 디버깅 시나리오

| 증상 | 원인 | 디버깅 방법 |
|------|------|------------|
| **파라미터 설정 안 됨** | Variable Name 오타 | Output Log에서 "Parameter not found" Warning 확인 |
| **System이 안 보임** | bAutoActivate=false | Activate() 호출 또는 bAutoActivate=true |
| **System이 즉시 사라짐** | bAutoDestroy=true + Duration 짧음 | Duration 확인 or bAutoDestroy=false |
| **OnSystemFinished 안 호출** | Loop System | Loop System은 절대 Finish 안 함, Loop=false 설정 |
| **Array Data 전달 안 됨** | Data Interface 이름 불일치 | Niagara Editor에서 DI 이름 확인 |
| **Color가 안 바뀜** | Material이 Lit → Unlit | Unlit Material 사용 or Emissive 증가 |
| **메모리 누수** | bAutoDestroy=false + 관리 안 함 | bAutoDestroy=true or 명시적 Deactivate |

---

## 📖 참고 자료 (References)

### 공식 문서

- [Unreal Engine Docs: Niagara Blueprint API](https://docs.unrealengine.com/5.3/en-US/blueprint-and-niagara-in-unreal-engine/)
- [Unreal Engine Docs: Spawning Niagara Systems](https://docs.unrealengine.com/5.3/en-US/spawning-niagara-systems-in-unreal-engine/)
- [Unreal Engine Docs: Parameter Collections](https://docs.unrealengine.com/5.3/en-US/niagara-parameter-collections-in-unreal-engine/)

### 소스 파일 참조

- **Component:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraComponent.h:84-730`
- **Function Library:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraFunctionLibrary.h:19-296`
- **Array Function Library:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceArrayFunctionLibrary.h:20-165`
- **Parameter Collection:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraParameterCollection.h:94-158`

### 핵심 개념

- **UNiagaraComponent:** Niagara System Instance, 생명주기 및 파라미터 제어
- **SetVariable*:** 30+ 타입 지원, Runtime 파라미터 설정
- **OnSystemFinished:** System 완료 시 Event Delegate
- **Array Data Interface:** Blueprint → Niagara로 배열 데이터 전달 (11 types)
- **Parameter Collection:** 전역 파라미터 공유 시스템
- **Component Pooling:** GC 압력 감소, 성능 최적화
