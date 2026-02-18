---
title: "Testing and Validation (테스트 및 검증)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Testing and Validation (테스트 및 검증)

## 🧭 개요

Niagara 시스템의 **정확성과 안정성을 보장**하기 위한 테스트 및 검증 전략입니다.

**핵심 영역:**
- **Unit Testing**: 개별 Module/Function 테스트
- **Integration Testing**: System 전체 동작 확인
- **Regression Testing**: 이전 버그 재발 방지
- **Performance Testing**: 성능 기준 유지

---

## 🧱 테스트 유형

### 1. **Functional Testing**

**테스트 항목:**
- Particle Spawn 정확성
- Lifetime 계산
- Event 전달
- DataInterface 동작

**예시 테스트:**
```cpp
// Spawn Rate 검증
UTEST(Niagara, SpawnRateAccuracy)
{
    UNiagaraSystem* System = CreateTestSystem();
    System->SpawnRate = 100;  // 초당 100개

    SimulateForDuration(1.0f);  // 1초 시뮬레이션

    int32 ParticleCount = System->GetActiveParticles();
    EXPECT_NEAR(ParticleCount, 100, 5);  // 100 ± 5
}
```

### 2. **Visual Validation**

**방법:**
- Screenshot Comparison
- Automated Visual Tests
- Manual QA

**도구:**
```cpp
// Screenshot 캡처
ConsoleCommand("HighResShot 1920x1080")

// 비교
CompareScreenshots("Expected.png", "Actual.png", Tolerance=0.01);
```

### 3. **Performance Regression**

**벤치마크 테스트:**
```cpp
BENCHMARK(Niagara, ParticleUpdate)
{
    UNiagaraSystem* System = CreateLargeSystem();

    MEASURE_SCOPE(UpdateTime)
    {
        System->Tick(0.016f);  // 60 FPS
    }

    EXPECT_LT(UpdateTime, 5.0);  // 5ms 이하
}
```

---

## 💡 테스트 전략

### 1. **Deterministic Testing**

**문제:**
- Random 값으로 인한 불확정성
- 테스트 실패 재현 어려움

**해결:**
```cpp
// Fixed Random Seed 사용
UNiagaraSystem* System;
System->SetRandomSeed(12345);

// 이제 항상 같은 결과
```

### 2. **Mocking DataInterfaces**

**Mock DI 생성:**
```cpp
class UMockDataInterface : public UNiagaraDataInterface
{
public:
    virtual void GetFunctions(TArray<FNiagaraFunctionSignature>& OutFunctions) override
    {
        FNiagaraFunctionSignature Sig;
        Sig.Name = "MockFunction";
        // ... 설정 ...
        OutFunctions.Add(Sig);
    }

    // Deterministic 결과 반환
    virtual void MockFunction(FVectorVMExternalFunctionContext& Context)
    {
        VectorVM::FExternalFuncRegisterHandler<float> OutValue(Context);
        for (int i = 0; i < Context.GetNumInstances(); ++i)
        {
            *OutValue.GetDestAndAdvance() = 42.0f;  // 항상 42
        }
    }
};
```

### 3. **Integration Test Environment**

**자동화된 테스트 맵:**
```
/Game/Tests/Niagara/
├── SpawnTest_Map.umap
├── EventTest_Map.umap
├── PerformanceTest_Map.umap
└── RegressionTest_Map.umap
```

**실행:**
```cpp
// Command Line
UnrealEditor.exe Project.uproject -ExecCmds="Automation RunTests Niagara"
```

---

## ⚠️ 일반적인 테스트 실수

### ❌ 피해야 할 것

**1. Non-Deterministic Tests:**
```cpp
// ❌ Random에 의존 → 가끔 실패
EXPECT_EQ(ParticleCount, 100);  // Random Spawn!
```

**2. Timing에 의존:**
```cpp
// ❌ 프레임 타이밍 불확정
Sleep(100ms);
EXPECT_TRUE(EffectComplete);  // 느린 머신에서 실패!
```

**3. 하드코딩된 Path:**
```cpp
// ❌ 다른 환경에서 실패
Asset = LoadObject("C:/MyProject/Asset.uasset");
```

### ✅ 올바른 방법

**1. Fixed Seed 사용:**
```cpp
// ✅ Deterministic
System->SetRandomSeed(12345);
EXPECT_NEAR(ParticleCount, 100, 5);
```

**2. Simulation Time 제어:**
```cpp
// ✅ 고정된 DeltaTime
for (int i = 0; i < 60; ++i)
{
    System->Tick(0.016f);  // 정확히 60 프레임
}
EXPECT_TRUE(EffectComplete);
```

**3. 상대 Path 사용:**
```cpp
// ✅ 플랫폼 독립적
Asset = LoadObject("/Game/Effects/MyEffect.MyEffect");
```

---

## 🐛 디버깅 도구

### 1. **Niagara Debugger**

```cpp
// 활성화
fx.Niagara.Debug.Enabled 1

// 특정 System 추적
fx.Niagara.Debug.Filter "MySystem"

// Particle 데이터 출력
fx.Niagara.Debug.ShowParticleData 1
```

### 2. **DataSet Dump**

```cpp
// Console Command
obj dump MyNiagaraSystem

// 출력: 모든 Particle 데이터
```

### 3. **Visual Logger**

```cpp
// C++ Code
#if ENABLE_VISUAL_LOG
    UE_VLOG_LOCATION(this, LogNiagara, Log, ParticlePosition, 10.f, FColor::Red, TEXT("Particle %d"), ParticleID);
#endif
```

---

## 🔗 참조 자료

**UE Automation System:**
- [Automation System Documentation](https://docs.unrealengine.com/en-US/TestingAndOptimization/Automation/)

**Testing Best Practices:**
- [Unit Testing in UE](https://docs.unrealengine.com/en-US/ProgrammingAndScripting/ProgrammingWithCPP/UnrealArchitecture/Reference/Testing/)

**Console Commands:**
- `Automation RunTests` - 자동화 테스트 실행
- `fx.Niagara.Debug.*` - 디버깅 명령어

---

> 🔄 작성: 2025-11-22 — Niagara 테스트 및 검증 가이드
> 🔄 Updated: 2026-02-18 — 중복 문서 통합 (Validation.md 내용 병합)

---

## Niagara Validation System (나이아가라 검증 시스템)

### 개요

Niagara Validation System은 **나이아가라 시스템 에셋의 품질 및 성능을 검증**하는 에디터 전용 프레임워크입니다. 플랫폼별 제약사항, 성능 예산, 모범 사례 위반을 자동으로 탐지하여 개발자에게 경고 및 자동 수정 옵션을 제공합니다.

**핵심 목적:**
- **성능 문제 조기 발견**: GPU 바운드 미설정, 과도한 시뮬레이션 스테이지 등
- **플랫폼 호환성 보장**: 모바일에서 금지된 렌더러, 데이터 인터페이스 검증
- **팀 표준 강제**: Effect Type별 규칙 세트를 통한 일관된 품질 유지
- **자동 수정 제공**: 일부 규칙은 원클릭 수정 기능 제공

**📂 위치:**
- `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraValidationRule.h`
- `Engine/Plugins/FX/Niagara/Source/NiagaraEditor/Public/NiagaraValidationRules.h`

---

### UNiagaraValidationRule - 검증 규칙 기반 클래스

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraValidationRule.h:68`

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        UNiagaraValidationRule                            │
│  (추상 기반 클래스 - 모든 검증 규칙의 부모)                              │
├──────────────────────────────────────────────────────────────────────────┤
│  Protected:                                                              │
│    - bIsConfigDisabled : bool          // Config에서 비활성화 가능       │
│                                                                          │
│  Public:                                                                 │
│    + IsEnabled() : bool                // 활성화 여부 확인               │
│    + CheckValidity(Context, Results)   // 실제 검증 로직 (가상 함수)    │
└──────────────────────────────────────────────────────────────────────────┘
```

**핵심 멤버:**

```cpp
// NiagaraValidationRule.h:68
UCLASS(abstract, EditInlineNew, MinimalAPI, Config=Editor)
class UNiagaraValidationRule : public UObject
{
    GENERATED_BODY()

public:
    bool IsEnabled() const { return bIsConfigDisabled == false && GetClass()->HasAnyClassFlags(CLASS_Deprecated) == false; }

#if WITH_EDITOR
    NIAGARA_API virtual void CheckValidity(const FNiagaraValidationContext& Context, TArray<FNiagaraValidationResult>& OutResults) const;
#endif

protected:
    UPROPERTY(Config)
    bool bIsConfigDisabled = false;
};
```

---

### FNiagaraValidationResult - 검증 결과 구조체

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraValidationRule.h:39`

```cpp
struct FNiagaraValidationResult
{
    ENiagaraValidationSeverity Severity = ENiagaraValidationSeverity::Info;
    FText SummaryText;
    FText Description;
    TWeakObjectPtr<UObject> SourceObject;
    TArray<FNiagaraValidationFix> Fixes;   // 자동 수정 델리게이트
    TArray<FNiagaraValidationFix> Links;   // "Go To Effect Type" 같은 링크
};
```

**심각도 레벨:**

```cpp
UENUM()
enum class ENiagaraValidationSeverity
{
    Info,      // 정보성 메시지 (파란색)
    Warning,   // 잠재적 문제 (노란색)
    Error,     // 반드시 수정해야 할 문제 (빨간색)
};
```

---

### 검증 규칙 실행 파이프라인

```
    에디터 UI          NiagaraValidation      UNiagaraEffectType    각 ValidationRule
       │                    │                         │                    │
       │ Validate System    │                         │                    │
       ├───────────────────>│                         │                    │
       │                    │ 1. Global Rules 로드    │                    │
       │                    ├─────────────────────────┤                    │
       │                    │ 2. Effect Type Rules    │                    │
       │                    ├────────────────────────>│                    │
       │                    │ 3. Module Rules         │                    │
       │                    ├────────────────────────────────────────────>│
       │                    │                         │  CheckValidity()   │
       │                    │<─────────────────────────────────────────────┤
       │  ResultCallback()  │                         │                    │
       │<───────────────────┤                         │                    │
```

**3계층 검증 우선순위:**

| 계층 | 설정 위치 | 용도 | 예시 |
|------|----------|------|------|
| **1. Global Rules** | `EditorSettings->DefaultValidationRuleSets` | 프로젝트 전체 강제 규칙 | "모든 시스템은 Effect Type 필수" |
| **2. Effect Type Rules** | `UNiagaraEffectType->ValidationRules` | FX 타입별 제약사항 | "Impact FX는 GPU 금지" |
| **3. Module Rules** | `UNiagaraScript->ValidationRules` | 모듈별 사용 조건 | "Depth Collision은 불투명 재질 금지" |

---

### 내장 Validation Rule 카탈로그

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        UNiagaraValidationRule                            │
│  (abstract base)                                                         │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
        ▼                         ▼                         ▼
┌─────────────────┐    ┌──────────────────┐    ┌────────────────────┐
│  Performance    │    │   Platform       │    │   Content          │
│  Rules          │    │   Compatibility  │    │   Quality          │
└─────────────────┘    └──────────────────┘    └────────────────────┘
        │                       │                        │
        ├─ NoWarmupTime         ├─ GpuUsage              ├─ InvalidEffectType
        ├─ FixedGPUBoundsSet    ├─ BannedRenderers       ├─ HasEffectType
        ├─ EmitterCount         ├─ BannedModules         ├─ LWC
        ├─ RendererCount        ├─ BannedDataInterfaces  └─ MaterialUsage
        ├─ NoFixedDeltaTime     ├─ Lightweight
        ├─ SimulationStageBudget├─ RibbonRenderer
        └─ TickDependencyCheck  └─ NoEvents
```

**주요 성능 관련 규칙:**
- **NoWarmupTime**: Warmup Time이 설정된 시스템에 Error 발생
- **FixedGPUBoundsSet**: GPU 이미터에 Dynamic Bounds 사용 시 Error
- **EmitterCount**: 플랫폼별 이미터 개수 제한 강제
- **SimulationStageBudget**: Simulation Stage 남용 방지

**플랫폼 호환성 규칙:**
- **GpuUsage**: GPU 시뮬레이션 미지원 플랫폼 경고 + 자동 CPU 전환 수정
- **BannedRenderers**: 특정 플랫폼에서 렌더러 차단 (예: 모바일에서 Mesh Renderer 금지)
- **BannedModules**: CPU/GPU 또는 플랫폼별 모듈 제한

---

### Custom Validation Rule 작성 예시

```cpp
// MyProjectValidationRules.h
UCLASS(Category = "Validation", DisplayName = "Max Particle Count")
class UMyValidationRule_MaxParticleCount : public UNiagaraValidationRule
{
    GENERATED_BODY()

public:
    UPROPERTY(EditAnywhere, Category = Validation)
    int32 MaxParticleCount = 10000;

    UPROPERTY(EditAnywhere, Category = Validation)
    ENiagaraValidationSeverity Severity = ENiagaraValidationSeverity::Warning;

    virtual void CheckValidity(const FNiagaraValidationContext& Context,
        TArray<FNiagaraValidationResult>& OutResults) const override;
};
```

---

### 검증 시스템 핵심 설계 철학

> **검증 시스템의 3계층 우선순위:**
> - **Global Rules**는 "프로젝트 전체 강제 표준",
> - **Effect Type Rules**는 "FX 타입별 성능/플랫폼 제약",
> - **Module Rules**는 "모듈 사용 조건"을 담당한다.

> **자동 수정 제공 원칙:**
> - 단순 속성 변경은 자동 수정 제공 (SimTarget, Bounds Mode 등)
> - 구조적 변경은 "Go to Source"만 제공 (모듈 제거, 이미터 재구성 등)

### 검증 시스템 소스 파일 참조

- `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraValidationRule.h` - 기본 클래스
- `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraValidationRuleSet.h` - 규칙 세트
- `Engine/Plugins/FX/Niagara/Source/NiagaraEditor/Public/NiagaraValidationRules.h` - 내장 규칙들
- `Engine/Plugins/FX/Niagara/Source/NiagaraEditor/Private/NiagaraValidationRules.cpp` - 검증 로직
- `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraEffectType.h:448` - Effect Type 통합
