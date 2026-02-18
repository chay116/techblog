---
title: "Sequencer Integration - Niagara Sequencer 통합"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Sequencer Integration - Niagara Sequencer 통합

## 🧭 개요 (Overview)

**Niagara Sequencer Integration**은 **Unreal Engine의 Sequencer (Cinematics)에서 Niagara System을 제어**하고, **타임라인 기반으로 VFX를 연출**할 수 있는 완전한 통합 시스템입니다.

이 시스템은 **MovieSceneNiagaraSystemTrack (생명주기 제어)**, **MovieSceneNiagaraParameterTrack (파라미터 애니메이션)**, **Age 기반 Scrubbing**, **Pre-animated State 복원** 등을 통해 **시네마틱 VFX 제어를 가능**하게 합니다.

**핵심 사용 사례:**
- **System Track**: Niagara Component의 Activate/Deactivate 타이밍 제어
- **Spawn Section**: 3단계 생명주기 (Start, Evaluate, End) 정의
- **Parameter Track**: Float, Vector, Color 등 파라미터 Keyframe 애니메이션
- **Age Update Mode**: DesiredAge vs TickDeltaTime (Scrubbing 지원)
- **Scalability Control**: Sequencer 재생 시 Scalability Culling 허용/차단

**📂 주요 위치:**
- System Track: `Engine/Plugins/FX/Niagara/Source/Niagara/Public/MovieScene/MovieSceneNiagaraSystemTrack.h`
- Spawn Section: `Engine/Plugins/FX/Niagara/Source/Niagara/Public/MovieScene/MovieSceneNiagaraSystemSpawnSection.h`
- Parameter Track: `Engine/Plugins/FX/Niagara/Source/Niagara/Public/MovieScene/Parameters/MovieSceneNiagaraParameterTrack.h`

---

## 🎯 설계 철학: 왜 Sequencer Integration이 필요한가?

### 문제: 시네마틱 VFX 제어의 어려움

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  시네마틱 VFX 제어의 전통적인 문제점                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ❌ 문제 1: 타이밍 제어 어려움                                           │
│  - "2.5초에 폭발 시작" → Blueprint Timer 사용 (부정확)                   │
│  - Sequencer에서 재생/일시정지 시 VFX도 동기화 필요                      │
│  - Scrubbing (타임라인 앞뒤 이동) 지원 불가                              │
│                                                                         │
│  ❌ 문제 2: 파라미터 애니메이션 복잡                                     │
│  - "0초~5초 동안 불꽃 색상 파란색→빨간색 변화" → 수동 Lerp 필요         │
│  - Keyframe 기반 애니메이션 불가                                        │
│  - Curve Editor 사용 불가                                               │
│                                                                         │
│  ❌ 문제 3: Pre-animated State 관리                                      │
│  - Sequencer 종료 후 원래 상태로 복원 어려움                             │
│  - "Sequencer에서 색상 변경 → 종료 후에도 변경된 채로 유지"              │
│                                                                         │
│  ❌ 문제 4: 시네마틱 품질 vs 게임 성능                                   │
│  - 시네마틱: Scalability Culling 끄고 최고 품질                          │
│  - 게임플레이: Scalability Culling 켜서 성능 유지                        │
│  - 전환 시 수동 설정 변경 필요                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                            ↓
                   Niagara Sequencer Integration 솔루션:
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ✅ 해결 1: MovieSceneNiagaraSystemTrack                                 │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  Sequencer Timeline:                                 │              │
│  │  0s        2.5s      5s       8s      10s            │              │
│  │  │───────────│────────│─────────│───────│            │              │
│  │  │           [===Spawn Section===]       │            │              │
│  │  │           ▲        ▼         ▼        │            │              │
│  │  │         Activate Running  Deactivate │            │              │
│  │  │                                       │            │              │
│  │  │  정확한 타이밍 제어!                  │            │              │
│  │  └──────────────────────────────────────┘            │              │
│                                                                         │
│  ✅ 해결 2: MovieSceneNiagaraParameterTrack               │              │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  Parameter "Color" Track:                            │              │
│  │  0s        2.5s      5s       8s      10s            │              │
│  │  │───────────│────────│─────────│───────│            │              │
│  │  ●Blue      ●Cyan    ●Yellow  ●Red     │            │              │
│  │  (Keyframes)                            │            │              │
│  │                                         │            │              │
│  │  → Curve Editor에서 보간 조정 가능!     │            │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
│  ✅ 해결 3: Pre-animated State Token                                    │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  Sequencer 시작:                                     │              │
│  │    Component.OriginalColor 저장                      │              │
│  │                                                      │              │
│  │  Sequencer 재생:                                     │              │
│  │    Component.Color = AnimatedColor                   │              │
│  │                                                      │              │
│  │  Sequencer 종료:                                     │              │
│  │    Component.Color = OriginalColor (복원)           │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
│  ✅ 해결 4: bAllowScalability Flag                                      │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  Spawn Section:                                      │              │
│  │    bAllowScalability = false                         │              │
│  │                                                      │              │
│  │  → Sequencer 재생 중 Scalability Culling 무시        │              │
│  │  → 시네마틱 최고 품질 보장                           │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 설계 원칙

| 설계 원칙 | 설명 | 효과 |
|----------|------|------|
| **Template 기반 평가** | Section → Implementation → Token 컴파일 | 런타임 성능 최적화 |
| **Age 기반 Scrubbing** | DesiredAge 직접 설정 | 타임라인 앞뒤 이동 지원 |
| **Pre-animated State** | Sequencer 시작/종료 시 상태 저장/복원 | 비파괴적 편집 |
| **Channel 기반 애니메이션** | MovieSceneChannel (Float, Vector, Color 등) | Curve Editor 통합 |
| **분리된 Track 타입** | System Track (생명주기) + Parameter Track (파라미터) | 명확한 책임 분리 |

---

## 🏗️ 시스템 아키텍처 (System Architecture)

### 전체 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│            Niagara Sequencer Integration Architecture                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │              Sequencer Asset Layer (편집 시)                 │      │
│  ├──────────────────────────────────────────────────────────────┤      │
│  │                                                              │      │
│  │  ┌────────────────────────────────────────────────┐          │      │
│  │  │   ULevelSequence (시네마틱 자산)               │          │      │
│  │  │   - MovieScene                                 │          │      │
│  │  │     └─ MasterTracks[]                          │          │      │
│  │  │         ├─ UMovieSceneNiagaraSystemTrack       │          │      │
│  │  │         │   └─ Sections[]                      │          │      │
│  │  │         │       └─ UMovieSceneNiagaraSystemSpawnSection│  │      │
│  │  │         │           - SectionStartBehavior     │          │      │
│  │  │         │           - SectionEvaluateBehavior  │          │      │
│  │  │         │           - SectionEndBehavior       │          │      │
│  │  │         │           - AgeUpdateMode            │          │      │
│  │  │         │           - bAllowScalability        │          │      │
│  │  │         │                                      │          │      │
│  │  │         └─ UMovieSceneNiagaraParameterTrack    │          │      │
│  │  │             (Float, Vector, Color, Int, Bool)  │          │      │
│  │  │             └─ Sections[]                      │          │      │
│  │  │                 └─ MovieSceneChannel (Keyframes)│         │      │
│  │  └────────────────────────────────────────────────┘          │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │          Compilation Layer (평가 준비)                        │      │
│  ├──────────────────────────────────────────────────────────────┤      │
│  │                                                              │      │
│  │  Sequencer Compile:                                          │      │
│  │  ┌────────────────────────────────────────────────┐          │      │
│  │  │   UMovieSceneSection::PostCompile()            │          │      │
│  │  │       │                                        │          │      │
│  │  │       └─► CreateTemplateForSection()           │          │      │
│  │  │             └─► FMovieSceneNiagaraSystemTrackImplementation│     │
│  │  │                 (Template)                     │          │      │
│  │  └────────────────────────────────────────────────┘          │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │          Runtime Evaluation Layer (재생 시)                  │      │
│  ├──────────────────────────────────────────────────────────────┤      │
│  │                                                              │      │
│  │  매 프레임:                                                  │      │
│  │  ┌────────────────────────────────────────────────┐          │      │
│  │  │   FMovieSceneEntitySystemRunner::Update()      │          │      │
│  │  │       │                                        │          │      │
│  │  │       ├─► Template::Evaluate()                 │          │      │
│  │  │       │     └─► Execution Token 생성           │          │      │
│  │  │       │         - FNiagaraSystemUpdateDesiredAgeExecutionToken│ │
│  │  │       │         - FNiagaraParameterExecutionToken│        │      │
│  │  │       │                                        │          │      │
│  │  │       └─► Token::Execute()                     │          │      │
│  │  │             └─► UNiagaraComponent에 적용       │          │      │
│  │  │                 - SetDesiredAge()              │          │      │
│  │  │                 - Activate() / Deactivate()    │          │      │
│  │  │                 - SetVariableFloat/Vec3/Color()│          │      │
│  │  └────────────────────────────────────────────────┘          │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │       Pre-animated State Management (상태 복원)              │      │
│  ├──────────────────────────────────────────────────────────────┤      │
│  │                                                              │      │
│  │  Sequencer Start:                                            │      │
│  │  ┌────────────────────────────────────────────────┐          │      │
│  │  │   SavePreAnimatedState(Component)              │          │      │
│  │  │       └─► OriginalState 저장                    │          │      │
│  │  │           - bActive                            │          │      │
│  │  │           - Parameter Values                   │          │      │
│  │  └────────────────────────────────────────────────┘          │      │
│  │                                                              │      │
│  │  Sequencer End:                                              │      │
│  │  ┌────────────────────────────────────────────────┐          │      │
│  │  │   RestorePreAnimatedState(Component)           │          │      │
│  │  │       └─► OriginalState 복원                    │          │      │
│  │  └────────────────────────────────────────────────┘          │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧱 핵심 클래스 상세 (Core Classes)

### 1. UMovieSceneNiagaraSystemTrack - System 생명주기 Track

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/MovieScene/MovieSceneNiagaraSystemTrack.h:18-30`

**역할:** Niagara Component의 생명주기를 Sequencer Timeline에서 제어

```
┌─────────────────────────────────────────────────────────────────────────┐
│                UMovieSceneNiagaraSystemTrack                            │
│  (System 생명주기 Track - Activate/Deactivate 타이밍 제어)              │
├─────────────────────────────────────────────────────────────────────────┤
│  Inheritance:                                                           │
│    UMovieSceneNiagaraTrack (Base)                                       │
│    IMovieSceneTrackTemplateProducer (Interface)                         │
│                                                                         │
│  Public Methods:                                                        │
│    virtual bool SupportsType(                                           │
│        TSubclassOf<UMovieSceneSection> SectionClass) const override     │
│      // 지원하는 Section 타입 확인                                      │
│      // UMovieSceneNiagaraSystemSpawnSection만 허용                     │
│                                                                         │
│    virtual UMovieSceneSection* CreateNewSection() override              │
│      // 새 Section 생성 (드래그 시 호출)                                │
│      return NewObject<UMovieSceneNiagaraSystemSpawnSection>(this)       │
│                                                                         │
│    virtual FMovieSceneEvalTemplatePtr CreateTemplateForSection(         │
│        const UMovieSceneSection& InSection) const override              │
│      // Section을 Evaluation Template으로 컴파일                        │
│      return FMovieSceneNiagaraSystemTrackImplementation(                │
│          Cast<UMovieSceneNiagaraSystemSpawnSection>(InSection))         │
│                                                                         │
│    virtual void PostCompile(                                            │
│        FMovieSceneEvaluationTrack& OutTrack,                            │
│        const FMovieSceneTrackCompilerArgs& Args) const override         │
│      // 컴파일 후 처리 (Pre-animated State Token 등록)                  │
│                                                                         │
│  Static Members:                                                        │
│    static FMovieSceneSharedDataId SharedDataId                          │
│      // Pre-animated State 공유 ID                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 2. UMovieSceneNiagaraSystemSpawnSection - Spawn Section 설정

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/MovieScene/MovieSceneNiagaraSystemSpawnSection.h:41-92`

**역할:** System의 3단계 생명주기 (Start, Evaluate, End) 정의

```
┌─────────────────────────────────────────────────────────────────────────┐
│          UMovieSceneNiagaraSystemSpawnSection                           │
│  (Spawn Section - System 생명주기 3단계 정의)                           │
├─────────────────────────────────────────────────────────────────────────┤
│  Public Properties:                                                     │
│    UPROPERTY(EditAnywhere, Category="Life Cycle")                       │
│    ENiagaraSystemSpawnSectionStartBehavior SectionStartBehavior         │
│      // Section 시작 시 동작                                            │
│      enum:                                                              │
│        - Activate: Deactivate → Activate (초기화 후 시작)               │
│                                                                         │
│    UPROPERTY(EditAnywhere, Category="Life Cycle")                       │
│    ENiagaraSystemSpawnSectionEvaluateBehavior SectionEvaluateBehavior   │
│      // Section 평가 중 동작 (2번째 프레임~마지막 프레임)               │
│      enum:                                                              │
│        - ActivateIfInactive: Inactive면 Activate (중간부터 재생 지원)   │
│        - None: 아무것도 안 함                                           │
│                                                                         │
│    UPROPERTY(EditAnywhere, Category="Life Cycle")                       │
│    ENiagaraSystemSpawnSectionEndBehavior SectionEndBehavior             │
│      // Section 종료 시 동작                                            │
│      enum:                                                              │
│        - SetSystemInactive: 새 파티클 생성 중지, 기존 파티클 수명까지  │
│        - Deactivate: 모든 파티클 즉시 제거                              │
│        - None: 계속 실행                                                │
│                                                                         │
│    UPROPERTY(EditAnywhere, Category="Life Cycle")                       │
│    ENiagaraAgeUpdateMode AgeUpdateMode                                  │
│      // Age 업데이트 방식                                               │
│      enum:                                                              │
│        - TickDeltaTime: DeltaTime만큼 Age 증가 (일반 재생)             │
│        - DesiredAge: Sequencer Time으로 Age 직접 설정 (Scrubbing)      │
│                                                                         │
│    UPROPERTY(EditAnywhere, Category="Life Cycle")                       │
│    bool bAllowScalability                                               │
│      // Scalability Culling 허용 여부                                   │
│      - false: Sequencer 재생 중 Culling 무시 (시네마틱 품질)            │
│      - true: Culling 허용 (게임플레이 성능)                             │
│                                                                         │
│  Public Methods (Blueprint Callable):                                   │
│    UFUNCTION(BlueprintPure)                                             │
│    ENiagaraSystemSpawnSectionStartBehavior GetSectionStartBehavior()    │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetSectionStartBehavior(                                        │
│        ENiagaraSystemSpawnSectionStartBehavior InBehavior)              │
│                                                                         │
│    UFUNCTION(BlueprintPure)                                             │
│    ENiagaraSystemSpawnSectionEvaluateBehavior GetSectionEvaluateBehavior()│
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetSectionEvaluateBehavior(                                     │
│        ENiagaraSystemSpawnSectionEvaluateBehavior InBehavior)           │
│                                                                         │
│    UFUNCTION(BlueprintPure)                                             │
│    ENiagaraSystemSpawnSectionEndBehavior GetSectionEndBehavior()        │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetSectionEndBehavior(                                          │
│        ENiagaraSystemSpawnSectionEndBehavior InBehavior)                │
│                                                                         │
│    UFUNCTION(BlueprintPure)                                             │
│    ENiagaraAgeUpdateMode GetAgeUpdateMode() const                       │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetAgeUpdateMode(ENiagaraAgeUpdateMode InMode)                  │
│                                                                         │
│    UFUNCTION(BlueprintPure)                                             │
│    bool GetAllowScalability() const                                     │
│                                                                         │
│    UFUNCTION(BlueprintCallable)                                         │
│    void SetAllowScalability(bool bInAllowScalability)                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**3단계 생명주기 예시:**

```
Sequencer Timeline:
0s        2.5s      5s       8s      10s
│───────────│────────│─────────│───────│
│           [===Spawn Section===]       │
│           ▲        │         ▲        │
│         Start   Evaluate    End      │

Start (2.5s):
  SectionStartBehavior = Activate
  → Component->Deactivate()
  → Component->Activate(true)  // Reset
  → Component->SetDesiredAge(0.0)

Evaluate (2.5s ~ 8s):
  SectionEvaluateBehavior = ActivateIfInactive
  → if (!Component->IsActive())
      Component->Activate()
  → AgeUpdateMode = DesiredAge
  → Component->SetDesiredAge(CurrentTime - 2.5s)

End (8s):
  SectionEndBehavior = SetSystemInactive
  → Component->SetSystemInactive()
  // 새 파티클 생성 중지, 기존 파티클은 수명까지 유지
```

---

### 3. UMovieSceneNiagaraParameterTrack - 파라미터 애니메이션 Track

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/MovieScene/Parameters/MovieSceneNiagaraParameterTrack.h:12-51`

**역할:** Niagara Parameter를 Keyframe 기반으로 애니메이션

```
┌─────────────────────────────────────────────────────────────────────────┐
│           UMovieSceneNiagaraParameterTrack (Abstract)                   │
│  (파라미터 애니메이션 Track - Keyframe 기반)                             │
├─────────────────────────────────────────────────────────────────────────┤
│  Inheritance:                                                           │
│    UMovieSceneNiagaraTrack (Base)                                       │
│                                                                         │
│  Private Properties:                                                    │
│    UPROPERTY()                                                          │
│    FNiagaraVariable Parameter                                           │
│      // 애니메이션할 파라미터                                           │
│      struct FNiagaraVariable:                                           │
│        - FName Name  (예: "Intensity")                                  │
│        - FNiagaraTypeDefinition Type  (Float, Vector, Color 등)         │
│                                                                         │
│  Public Methods:                                                        │
│    const FNiagaraVariable& GetParameter() const                         │
│      // 현재 파라미터 반환                                              │
│                                                                         │
│    void SetParameter(FNiagaraVariable InParameter)                      │
│      // 파라미터 설정                                                   │
│                                                                         │
│    virtual void SetSectionChannelDefaults(                              │
│        UMovieSceneSection* Section,                                     │
│        const TArray<uint8>& DefaultValueData) const                     │
│      // Channel 기본값 설정 (순수 가상 함수)                            │
│                                                                         │
│  Protected Helper Methods:                                              │
│    template<class ChannelType>                                          │
│    static ChannelType* GetEditableChannelFromProxy(                     │
│        FMovieSceneChannelProxy& ChannelProxy,                           │
│        const ChannelType& Channel)                                      │
│      // Channel Proxy에서 편집 가능한 Channel 반환                      │
│                                                                         │
│    template<class ChannelType, typename ValueType>                      │
│    static void SetChannelDefault(                                       │
│        FMovieSceneChannelProxy& ChannelProxy,                           │
│        const ChannelType& TargetChannel,                                │
│        ValueType DefaultValue)                                          │
│      // Channel 기본값 설정 Helper                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**파생 Track 타입:**

| Track 타입 | Channel 타입 | 지원하는 보간 | 사용 예시 |
|-----------|-------------|--------------|----------|
| **UMovieSceneNiagaraFloatParameterTrack** | FMovieSceneFloatChannel | Linear, Cubic, Constant | Intensity, Speed |
| **UMovieSceneNiagaraVectorParameterTrack** | FMovieSceneFloatChannel × 3 | Linear, Cubic, Constant | Position, Velocity |
| **UMovieSceneNiagaraColorParameterTrack** | FMovieSceneFloatChannel × 4 | Linear, Cubic, Constant | Particle Color |
| **UMovieSceneNiagaraIntegerParameterTrack** | FMovieSceneIntegerChannel | Linear, Constant | Particle Count |
| **UMovieSceneNiagaraBoolParameterTrack** | FMovieSceneBoolChannel | Constant | Enable/Disable Feature |

---

### 4. ENiagaraAgeUpdateMode - Age 업데이트 방식

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraCommon.h:484-492`

**역할:** Sequencer에서 System Age를 업데이트하는 방식 정의

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ENiagaraAgeUpdateMode                                │
│  (Age 업데이트 모드 - Scrubbing 지원 여부)                              │
├─────────────────────────────────────────────────────────────────────────┤
│  enum class ENiagaraAgeUpdateMode : uint8                               │
│  {                                                                      │
│      TickDeltaTime,  // DeltaTime 기반 (일반 재생)                      │
│      DesiredAge      // DesiredAge 기반 (Scrubbing 지원)                │
│  };                                                                     │
│                                                                         │
│  TickDeltaTime:                                                         │
│    - 매 프레임 DeltaTime만큼 Age 증가                                   │
│    - Component->Tick(DeltaTime) 호출                                    │
│    - 순방향 재생만 지원                                                 │
│    - 역방향 재생 / Scrubbing 불가                                       │
│    - 사용 시나리오: 일반 재생, 실시간 VFX                               │
│                                                                         │
│  DesiredAge:                                                            │
│    - Sequencer의 CurrentTime을 Age로 직접 설정                          │
│    - Component->SetDesiredAge(SequencerTime - SectionStartTime)         │
│    - 순방향/역방향 재생 모두 지원                                       │
│    - Scrubbing (타임라인 드래그) 지원                                   │
│    - 사용 시나리오: 시네마틱, 정밀한 타이밍 제어                         │
│                                                                         │
│  비교:                                                                  │
│  ┌────────────────────────────────────────────────────┐                │
│  │  TickDeltaTime:                                    │                │
│  │  Frame 0: Age = 0.0                                │                │
│  │  Frame 1: Age += 0.016 → 0.016                     │                │
│  │  Frame 2: Age += 0.016 → 0.032                     │                │
│  │  Frame 3: Age += 0.016 → 0.048                     │                │
│  │                                                    │                │
│  │  DesiredAge:                                       │                │
│  │  Frame 0 (Time=2.5s): Age = 0.0                    │                │
│  │  Frame 1 (Time=2.516s): Age = 0.016                │                │
│  │  Scrub to 5.0s: Age = 2.5 (즉시 점프!)             │                │
│  │  Frame 2 (Time=5.016s): Age = 2.516                │                │
│  └────────────────────────────────────────────────────┘                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 실전 사용 예시 (Practical Examples)

### 예시 1: 기본 Spawn Section 설정

**시나리오:** 2.5초~8초 동안 폭발 이펙트 재생

**Sequencer 설정:**

1. **Level Sequence 생성:**
   - Content Browser → 우클릭 → Cinematics → Level Sequence
   - 이름: "SEQ_Explosion"

2. **Niagara Component 추가:**
   - Outliner에서 Actor 선택
   - Sequencer에서 "+ Track" → Actor To Sequencer → MyActor
   - Niagara Component 선택 → Add

3. **System Track 추가:**
   - Niagara Component → "+ Track" → System Life Cycle

4. **Spawn Section 생성:**
   - System Life Cycle Track에서 드래그
   - 2.5s ~ 8s 구간 생성

5. **Section 설정:**
   ```
   Section Details:
     Start Behavior: Activate
     Evaluate Behavior: ActivateIfInactive
     End Behavior: SetSystemInactive
     Age Update Mode: DesiredAge
     Allow Scalability: false
   ```

**내부 동작:**

```
Time = 2.5s (Section Start):
  → Component->Deactivate()
  → Component->Activate(true)
  → Component->SetDesiredAge(0.0)

Time = 5.0s (Section Evaluate):
  → Component->SetDesiredAge(2.5)  // 5.0 - 2.5
  → Particles simulate to Age=2.5

Time = 8.0s (Section End):
  → Component->SetSystemInactive()
  → 새 파티클 생성 중지
  → 기존 파티클은 수명까지 유지
```

---

### 예시 2: 파라미터 애니메이션 (Color 변경)

**시나리오:** 불꽃 색상을 파란색 → 빨간색으로 5초 동안 변화

**Sequencer 설정:**

1. **Parameter Track 추가:**
   - Niagara Component → "+ Track" → Color → "FireColor"

2. **Keyframe 추가:**
   - 0s: Blue (0, 0, 1, 1)
   - 2.5s: Cyan (0, 1, 1, 1)
   - 5s: Yellow (1, 1, 0, 1)
   - 7.5s: Orange (1, 0.5, 0, 1)
   - 10s: Red (1, 0, 0, 1)

3. **Curve Editor 조정:**
   - Keyframe 선택 → Curve Editor
   - Tangent 조정 (Auto, Linear, Cubic, Constant)

**Runtime 평가:**

```
매 프레임:
  CurrentTime = Sequencer->GetCurrentTime()

  // Color Track Evaluation
  ColorChannel.Evaluate(CurrentTime, OutColor)

  // Execution Token 생성
  FNiagaraParameterExecutionToken Token
  {
    ParameterName = "FireColor",
    Value = OutColor
  }

  // Component에 적용
  Token.Execute(Component)
  → Component->SetVariableLinearColor("FireColor", OutColor)
```

**결과:** Curve Editor에서 조정한 보간 곡선대로 색상이 부드럽게 변화

---

### 예시 3: Scrubbing 지원 (DesiredAge 모드)

**시나리오:** Sequencer Timeline을 앞뒤로 드래그하며 VFX 확인

**설정:**

```
Spawn Section:
  Age Update Mode: DesiredAge  // ← 핵심!
  Start Behavior: Activate
```

**동작:**

```
Sequencer Timeline:
0s        2s      4s      6s      8s      10s
│─────────│───────│───────│───────│───────│
          [===Spawn Section===]

사용자 동작:
  1. Timeline을 2s로 이동
     → Component->SetDesiredAge(0.0)
     → Particles spawn at Age=0

  2. Timeline을 6s로 드래그
     → Component->SetDesiredAge(4.0)
     → Particles immediately jump to Age=4.0
     → No simulation between Age=0~4 (즉시 점프)

  3. Timeline을 4s로 역방향 드래그
     → Component->SetDesiredAge(2.0)
     → Particles revert to Age=2.0
     → 역방향 재생!

결과: Scrubbing 완벽 지원
```

**TickDeltaTime 모드와 비교:**

```
TickDeltaTime 모드:
  → Age는 항상 증가만 가능
  → Timeline을 4s → 6s 이동 시:
      Age += (6-4) = Age + 2 (OK)
  → Timeline을 6s → 4s 역방향 이동 시:
      Age += (4-6) = Age - 2 (????)
      → Negative DeltaTime 처리 안 됨
      → Scrubbing 불가!
```

---

### 예시 4: Pre-animated State 복원

**시나리오:** Sequencer에서 색상 변경 후 원래 색상으로 복원

**설정:**

```
Original Component State:
  FireColor = Orange (1.0, 0.5, 0.0, 1.0)

Sequencer:
  Color Track "FireColor":
    0s: Blue (0, 0, 1, 1)
    5s: Red (1, 0, 0, 1)
```

**동작:**

```
1. Sequencer Play 시작:
   SavePreAnimatedState(Component):
     OriginalState.FireColor = Component->GetVariableLinearColor("FireColor")
     → OriginalState.FireColor = Orange

2. Sequencer 재생 중 (0s ~ 5s):
   Component->SetVariableLinearColor("FireColor", AnimatedColor)
   → Blue → Red 변화

3. Sequencer Stop:
   RestorePreAnimatedState(Component):
     Component->SetVariableLinearColor("FireColor",
         OriginalState.FireColor)
     → FireColor = Orange (원래 값 복원!)

결과: Sequencer 종료 후에도 원래 상태 유지
```

---

### 예시 5: bAllowScalability 활용 (시네마틱 품질)

**시나리오:** Sequencer 재생 중 Scalability Culling 무시

**문제 상황:**

```
게임플레이:
  - EffectType의 MaxDistance = 2000.0 (20m)
  - Player가 폭발 위치에서 30m 떨어짐
  → Distance Culling 발생
  → Sequencer 재생 중에도 Cull됨 (안 보임!)
```

**해결:**

```
Spawn Section:
  bAllowScalability = false  // ← Culling 무시!

내부 동작:
  FNiagaraScalabilityManager::EvaluateCullState(Component):
    if (Component->IsOwnedBySequencer() &&
        !SpawnSection->GetAllowScalability())
    {
      return false;  // Culling 안 함
    }

    // 일반 Culling 로직
    if (Distance > MaxDistance)
      return true;  // Cull

결과: Sequencer 재생 중에는 거리에 관계없이 항상 보임
```

---

### 예시 6: Multiple Parameter Tracks

**시나리오:** 동시에 여러 파라미터 애니메이션

**Sequencer 설정:**

```
Niagara Component "NS_Fire":
  ├─ System Life Cycle Track
  │    └─ Spawn Section (0s ~ 10s)
  │
  ├─ Float Track "Intensity"
  │    ├─ 0s: 0.0
  │    ├─ 2s: 5.0
  │    └─ 10s: 0.0
  │
  ├─ Vector Track "WindDirection"
  │    ├─ 0s: (1, 0, 0)  // East
  │    ├─ 5s: (0, 1, 0)  // North
  │    └─ 10s: (-1, 0, 0)  // West
  │
  └─ Color Track "FireColor"
       ├─ 0s: Blue
       ├─ 5s: Yellow
       └─ 10s: Red
```

**Runtime 평가 (매 프레임):**

```
Evaluate All Tracks(CurrentTime):
  // Float Track
  Intensity = FloatChannel.Evaluate(CurrentTime)
  Component->SetVariableFloat("Intensity", Intensity)

  // Vector Track
  WindDir = VectorChannel.Evaluate(CurrentTime)
  Component->SetVariableVec3("WindDirection", WindDir)

  // Color Track
  Color = ColorChannel.Evaluate(CurrentTime)
  Component->SetVariableLinearColor("FireColor", Color)

결과: 모든 파라미터가 동시에 부드럽게 애니메이션됨
```

---

## 🐛 디버깅 및 최적화 팁 (Debugging & Optimization Tips)

### 일반적인 함정

#### ❌ 하지 말아야 할 것:

```cpp
// 1. TickDeltaTime 모드로 Scrubbing 시도
Spawn Section:
  Age Update Mode: TickDeltaTime  // ← Scrubbing 안 됨!
// Sequencer Timeline 드래그 시 VFX가 이상하게 동작

// 2. bAllowScalability=true로 시네마틱 제작
Spawn Section:
  bAllowScalability: true  // ← Culling 발생 가능!
// 먼 거리 VFX가 안 보일 수 있음

// 3. SectionEndBehavior=None으로 Loop System 사용
Spawn Section:
  End Behavior: None  // ← Loop System이 영원히 실행!
// Section 종료 후에도 VFX 계속 재생

// 4. Parameter Name 오타
Float Track:
  Parameter Name: "Intensty"  // ← "Intensity" 오타
// 파라미터 설정 안 됨
```

#### ✅ 올바른 방법:

```cpp
// 1. 시네마틱용 설정
Spawn Section:
  Age Update Mode: DesiredAge  // Scrubbing 지원
  bAllowScalability: false     // Culling 무시
  Start Behavior: Activate     // 깨끗한 시작
  End Behavior: Deactivate     // 확실한 종료

// 2. Loop System용 설정
Spawn Section:
  End Behavior: SetSystemInactive  // Loop 중지
  // 또는 Deactivate (즉시 종료)

// 3. Parameter Name 확인
Niagara System Editor:
  User Parameters 탭에서 이름 복사/붙여넣기
  → "Intensity"

// 4. Pre-animated State 테스트
Sequencer 재생 전/후 값 확인:
  Component->GetVariableFloat("Intensity")
  → 재생 전: 1.0
  → 재생 중: Animated Value
  → 재생 후: 1.0 (복원됨)
```

---

### Age Update Mode 선택 가이드

| 사용 시나리오 | 권장 Mode | 이유 |
|-------------|----------|------|
| **시네마틱** | DesiredAge | Scrubbing, 역방향 재생 지원 |
| **실시간 VFX** | TickDeltaTime | 일반 재생만 필요, 약간 가벼움 |
| **정밀한 타이밍** | DesiredAge | 정확한 Age 제어 |
| **Loop System** | DesiredAge | Loop도 Scrubbing 지원 |

---

### Section Behavior 조합 권장

| 시나리오 | Start | Evaluate | End | 설명 |
|---------|-------|----------|-----|------|
| **일반 시네마틱** | Activate | ActivateIfInactive | Deactivate | 표준 설정 |
| **부드러운 종료** | Activate | ActivateIfInactive | SetSystemInactive | 파티클 수명까지 유지 |
| **중간부터 재생** | Activate | ActivateIfInactive | Deactivate | Scrubbing 지원 |
| **지속적인 Effect** | Activate | ActivateIfInactive | None | Section 이후에도 계속 |
| **빠른 시작/종료** | Activate | None | Deactivate | 간소화 |

---

### 성능 고려사항

| 작업 | 비용 | 최적화 방법 |
|------|------|------------|
| **DesiredAge Scrubbing** | 높음 (Age 점프 시 재계산) | 필요할 때만 사용 |
| **TickDeltaTime 일반 재생** | 낮음 | 실시간 VFX에 권장 |
| **Parameter Track (Float)** | 낮음 | 많이 사용해도 OK |
| **Parameter Track (많은 Keyframe)** | 약간 높음 | Curve 간소화 |
| **Pre-animated State 복원** | 낮음 | 자동 관리됨 |

---

### 일반적인 디버깅 시나리오

| 증상 | 원인 | 해결 방법 |
|------|------|----------|
| **Scrubbing 안 됨** | TickDeltaTime 모드 | DesiredAge 모드로 변경 |
| **VFX가 안 보임** | bAllowScalability=true + Culling | bAllowScalability=false 설정 |
| **Section 종료 후에도 실행** | End Behavior=None | Deactivate or SetSystemInactive |
| **파라미터 변경 안 됨** | Parameter Name 불일치 | Niagara Editor에서 이름 확인 |
| **Pre-animated State 복원 안 됨** | Sequencer Stop 안 함 | Stop() 명시적 호출 |
| **색상이 검정** | Emissive 부족 | Material Emissive 증가 |

---

## 📖 참고 자료 (References)

### 공식 문서

- [Unreal Engine Docs: Sequencer and Niagara](https://docs.unrealengine.com/5.3/en-US/sequencer-and-niagara-in-unreal-engine/)
- [Unreal Engine Docs: Animating Niagara Effects](https://docs.unrealengine.com/5.3/en-US/animating-niagara-effects-in-unreal-engine/)
- [Unreal Engine Docs: Sequencer Tracks](https://docs.unrealengine.com/5.3/en-US/sequencer-tracks-in-unreal-engine/)

### 소스 파일 참조

- **System Track:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/MovieScene/MovieSceneNiagaraSystemTrack.h:18-30`
- **Spawn Section:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/MovieScene/MovieSceneNiagaraSystemSpawnSection.h:41-92`
- **Parameter Track:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/MovieScene/Parameters/MovieSceneNiagaraParameterTrack.h:12-51`
- **Age Update Mode:** `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraCommon.h:484-492`

### 핵심 개념

- **UMovieSceneNiagaraSystemTrack:** System 생명주기 Timeline 제어
- **3단계 Spawn Section:** Start, Evaluate, End Behavior
- **ENiagaraAgeUpdateMode:** TickDeltaTime vs DesiredAge (Scrubbing 지원)
- **Parameter Track:** Keyframe 기반 파라미터 애니메이션
- **Pre-animated State:** Sequencer 종료 시 원래 상태 복원
- **bAllowScalability:** Sequencer 재생 중 Scalability Culling 제어
- **Template-based Evaluation:** Section → Template → Token → Execute
