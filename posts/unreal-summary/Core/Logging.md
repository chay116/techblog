---
title: "Logging (로깅 시스템)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Core"
tags: ["unreal", "Core"]
---
# Logging (로깅 시스템)

## 🧭 개요

**Logging System**은 언리얼 엔진의 **디버깅 및 진단 메시지 출력 메커니즘**입니다. 카테고리 기반 필터링, 동적 verbosity 조절, 다중 출력 장치 지원을 통해 개발 중 효율적인 디버깅을 가능하게 합니다.

**핵심 철학:**
> **카테고리(Category)**는 "로그의 출처" (LogTemp, LogActor, LogNetwork 등),
> **Verbosity**는 "로그의 중요도" (Fatal, Error, Warning, Log, Verbose),
> **OutputDevice**는 "로그의 출력 위치" (콘솔, 파일, 에디터 등)를 담당한다.

**로깅의 장점:**
- **필터링**: 카테고리/Verbosity 기반으로 필요한 로그만 표시
- **성능**: 컴파일 타임/런타임 제거 가능
- **멀티 출력**: 콘솔, 파일, Visual Studio 등 동시 출력
- **구조화**: 카테고리로 논리적 그룹화
- **디버깅**: 파일/라인 번호, 타임스탬프 자동 추가

**📂 위치:**
- 로그 매크로: `Engine/Source/Runtime/Core/Public/Logging/LogMacros.h`
- 로그 카테고리: `Engine/Source/Runtime/Core/Public/Logging/LogCategory.h`
- 출력 장치: `Engine/Source/Runtime/Core/Public/Misc/OutputDevice.h`

---

## 🧱 로깅 시스템 아키텍처

### 전체 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Application Code                                │
│  (게임 로직, 엔진 코드)                                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  UE_LOG(LogTemp, Warning, TEXT("Health: %d"), Health);                  │
│         │         │             │               │                       │
│      Category  Verbosity      Format          Args                      │
│                                                                         │
└────────────────────────┬────────────────────────────────────────────────┘
                         ↓ (매크로 확장)
┌─────────────────────────────────────────────────────────────────────────┐
│                        FMsg::Logf_Internal()                            │
│  (로그 메시지 포맷팅)                                                      │
├─────────────────────────────────────────────────────────────────────────┤
│  - 파일/라인 번호 추가                                                     │
│  - 포맷 문자열 처리 (printf 스타일)                                        │
│  - 타임스탬프 추가                                                        │
│  - Verbosity 체크                                                        │
└────────────────────────┬────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                      FLogCategoryBase                                   │
│  (카테고리 별 필터링)                                                      │
├─────────────────────────────────────────────────────────────────────────┤
│  - IsSuppressed() 체크 (Verbosity 비교)                                  │
│  - DebugBreakOnLog 처리                                                  │
└────────────────────────┬────────────────────────────────────────────────┘
                         ↓ (통과 시)
┌─────────────────────────────────────────────────────────────────────────┐
│                   FOutputDeviceRedirector                               │
│  (출력 장치 관리자)                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│  - 등록된 모든 OutputDevice에 전달                                         │
└──────┬──────────────┬──────────────┬────────────┬─────────────────────┘
       │              │              │            │
       ↓              ↓              ↓            ↓
┌──────────┐   ┌─────────────┐  ┌─────────┐  ┌──────────────┐
│ Console  │   │   File      │  │ Editor  │  │   Visual     │
│          │   │   (Log.txt) │  │ Output  │  │   Studio     │
└──────────┘   └─────────────┘  └─────────┘  └──────────────┘
```

---

## 🧩 핵심 구성 요소

### 1. **ELogVerbosity - 로그 레벨**

**📂 위치:** `LogVerbosity.h`

```cpp
namespace ELogVerbosity
{
    enum Type : uint8
    {
        // 시스템 값
        NoLogging = 0,     // 로깅 완전 비활성화

        // 사용 가능한 Verbosity (낮음 → 높음)
        Fatal,             // 크래시 유발, 프로그램 종료
        Error,             // 에러 (빨간색 표시)
        Warning,           // 경고 (노란색 표시)
        Display,           // 중요 정보 (항상 표시)
        Log,               // 일반 로그 (기본)
        Verbose,           // 상세 로그
        VeryVerbose,       // 매우 상세한 로그

        // 특수
        All = VeryVerbose, // 모든 로그
        NumVerbosity,      // 개수
        VerbosityMask = 0xf,  // 비트 마스크
        SetColor = 0x40    // 색상 설정 (특수)
    };
}
```

**Verbosity 필터링 원리:**
```
카테고리의 현재 Verbosity: Warning

Fatal       ✅ 출력 (Fatal <= Warning)
Error       ✅ 출력 (Error <= Warning)
Warning     ✅ 출력 (Warning <= Warning)
Display     ❌ 필터 (Display > Warning)
Log         ❌ 필터 (Log > Warning)
Verbose     ❌ 필터 (Verbose > Warning)
VeryVerbose ❌ 필터 (VeryVerbose > Warning)
```

---

### 2. **UE_LOG 매크로**

**📂 위치:** `LogMacros.h:152`

**기본 사용법:**
```cpp
// 기본 형식
UE_LOG(CategoryName, Verbosity, Format, ...);

// 예시
UE_LOG(LogTemp, Warning, TEXT("Player health is low: %d"), PlayerHealth);
UE_LOG(LogTemp, Error, TEXT("Failed to load asset: %s"), *AssetPath);
UE_LOG(LogTemp, Display, TEXT("Level loaded successfully"));
UE_LOG(LogTemp, Verbose, TEXT("Detailed state: %s"), *DetailedInfo);
```

**조건부 로깅:**
```cpp
// UE_CLOG: 조건이 true일 때만 로그
UE_CLOG(Health < 20, LogTemp, Warning, TEXT("Low health: %d"), Health);

// 동등한 코드
if (Health < 20)
{
    UE_LOG(LogTemp, Warning, TEXT("Low health: %d"), Health);
}
```

**매크로 확장:**
```cpp
// 소스
UE_LOG(LogTemp, Warning, TEXT("Health: %d"), 50);

// 컴파일 타임 확장 (단순화)
if (!LogTemp.IsSuppressed(ELogVerbosity::Warning))
{
    FMsg::Logf_Internal(
        __FILE__,           // "MyActor.cpp"
        __LINE__,           // 42
        LogTemp.GetCategoryName(),
        ELogVerbosity::Warning,
        TEXT("Health: %d"),
        50
    );
}
```

---

### 3. **로그 카테고리**

**📂 위치:** `LogCategory.h:18`

```cpp
// FLogCategoryBase 구조
struct FLogCategoryBase
{
    // 생성자
    FLogCategoryBase(
        const FLogCategoryName& CategoryName,
        ELogVerbosity::Type DefaultVerbosity,
        ELogVerbosity::Type CompileTimeVerbosity
    );

    // Verbosity 체크
    bool IsSuppressed(ELogVerbosity::Type VerbosityLevel) const
    {
        return !((VerbosityLevel & ELogVerbosity::VerbosityMask) <= Verbosity);
    }

    // 현재 Verbosity 조회/설정
    ELogVerbosity::Type GetVerbosity() const { return Verbosity; }
    void SetVerbosity(ELogVerbosity::Type NewVerbosity);

private:
    ELogVerbosity::Type Verbosity;             // 런타임 Verbosity
    bool DebugBreakOnLog;                      // 로그 시 브레이크포인트
    uint8 DefaultVerbosity;                    // 기본 Verbosity
    const ELogVerbosity::Type CompileTimeVerbosity;  // 컴파일 타임 Verbosity
    const FLogCategoryName CategoryName;       // 카테고리 이름
};
```

**카테고리 선언 매크로:**
```cpp
// 헤더 파일 (.h)
DECLARE_LOG_CATEGORY_EXTERN(LogMyGame, Log, All);
//                           ↑         ↑    ↑
//                      카테고리 이름  │    컴파일타임 최대
//                                 기본 Verbosity

// 구현 파일 (.cpp)
DEFINE_LOG_CATEGORY(LogMyGame);
```

**매크로 확장:**
```cpp
// DECLARE_LOG_CATEGORY_EXTERN 확장
extern FLogCategory<ELogVerbosity::Log, ELogVerbosity::All> LogMyGame;

// DEFINE_LOG_CATEGORY 확장
FLogCategory<ELogVerbosity::Log, ELogVerbosity::All> LogMyGame(TEXT("LogMyGame"));
```

---

### 4. **FOutputDevice - 출력 장치**

**📂 위치:** `OutputDevice.h:132`

```cpp
class FOutputDevice
{
public:
    // 순수 가상 함수 (하위 클래스에서 구현)
    virtual void Serialize(
        const TCHAR* Message,
        ELogVerbosity::Type Verbosity,
        const FName& Category
    ) = 0;

    // 타임스탬프 포함 버전
    virtual void Serialize(
        const TCHAR* Message,
        ELogVerbosity::Type Verbosity,
        const FName& Category,
        const double Time
    )
    {
        Serialize(Message, Verbosity, Category);
    }
};
```

**주요 OutputDevice 구현체:**
```
FOutputDeviceRedirector     → 다른 모든 장치로 리다이렉트 (GLog)
  ├─ FOutputDeviceConsole   → 게임 콘솔 출력
  ├─ FOutputDeviceFile      → 로그 파일 (Saved/Logs/MyGame.log)
  ├─ FOutputDeviceDebug     → OutputDebugString() (Visual Studio)
  └─ FOutputDeviceEditor    → 에디터 Output Log 창
```

---

## 💡 로그 카테고리 사용법

### 카테고리 정의

**MyGame/Public/MyGameLog.h:**
```cpp
#pragma once

#include "CoreMinimal.h"

// 게임 전용 카테고리 선언
DECLARE_LOG_CATEGORY_EXTERN(LogMyGame, Log, All);
DECLARE_LOG_CATEGORY_EXTERN(LogMyGameAI, Warning, All);
DECLARE_LOG_CATEGORY_EXTERN(LogMyGameNetwork, Display, All);
```

**MyGame/Private/MyGameLog.cpp:**
```cpp
#include "MyGameLog.h"

// 카테고리 정의 (cpp 파일 1곳에만!)
DEFINE_LOG_CATEGORY(LogMyGame);
DEFINE_LOG_CATEGORY(LogMyGameAI);
DEFINE_LOG_CATEGORY(LogMyGameNetwork);
```

**사용:**
```cpp
#include "MyGameLog.h"

void AMyActor::BeginPlay()
{
    Super::BeginPlay();

    UE_LOG(LogMyGame, Log, TEXT("Actor spawned: %s"), *GetName());
    UE_LOG(LogMyGameAI, Warning, TEXT("No path found!"));
    UE_LOG(LogMyGameNetwork, Display, TEXT("Connected to server"));
}
```

---

## 🎨 포맷 문자열

### 지원되는 형식 지정자

```cpp
// 정수
int32 Number = 42;
UE_LOG(LogTemp, Log, TEXT("Number: %d"), Number);           // "Number: 42"
UE_LOG(LogTemp, Log, TEXT("Hex: 0x%x"), Number);            // "Hex: 0x2a"
UE_LOG(LogTemp, Log, TEXT("Hex (uppercase): 0x%X"), Number);  // "Hex (uppercase): 0x2A"

// 부동소수점
float Value = 3.14159f;
UE_LOG(LogTemp, Log, TEXT("Float: %f"), Value);             // "Float: 3.141590"
UE_LOG(LogTemp, Log, TEXT("Float (2 decimals): %.2f"), Value);  // "Float (2 decimals): 3.14"

// 문자열
FString Name = TEXT("Player");
UE_LOG(LogTemp, Log, TEXT("Name: %s"), *Name);              // "Name: Player"

const TCHAR* CStr = TEXT("Hello");
UE_LOG(LogTemp, Log, TEXT("String: %s"), CStr);             // "String: Hello"

// FName
FName ActorName = FName(TEXT("MyActor"));
UE_LOG(LogTemp, Log, TEXT("FName: %s"), *ActorName.ToString());  // "FName: MyActor"

// UObject 포인터
AActor* Actor = GetOwner();
UE_LOG(LogTemp, Log, TEXT("Owner: %s"), *GetNameSafe(Actor));    // "Owner: BP_Player_C_0"

// Bool
bool bActive = true;
UE_LOG(LogTemp, Log, TEXT("Active: %s"), bActive ? TEXT("true") : TEXT("false"));

// 포인터
void* Ptr = this;
UE_LOG(LogTemp, Log, TEXT("Pointer: %p"), Ptr);            // "Pointer: 0x00007FF6A1234567"

// FVector/FRotator
FVector Location = FVector(100, 200, 300);
UE_LOG(LogTemp, Log, TEXT("Location: %s"), *Location.ToString());  // "Location: X=100 Y=200 Z=300"
```

---

## 🚀 실전 패턴

### 패턴 1: 디버그 빌드 전용 로그

```cpp
#if !UE_BUILD_SHIPPING
    UE_LOG(LogTemp, Verbose, TEXT("Debug info: %s"), *DebugString);
#endif

// 또는 컴파일 타임 제거
DECLARE_LOG_CATEGORY_EXTERN(LogMyGameDebug, Log, VeryVerbose);

// Shipping 빌드 시 Verbose/VeryVerbose는 컴파일 타임에 제거됨
UE_LOG(LogMyGameDebug, Verbose, TEXT("This won't exist in shipping"));
```

### 패턴 2: 조건부 로깅

```cpp
// 방법 1: UE_CLOG
UE_CLOG(Health <= 0, LogTemp, Error, TEXT("Actor died!"));

// 방법 2: 명시적 if
if (bDetailedLogging)
{
    UE_LOG(LogTemp, Verbose, TEXT("Detailed state: %s"), *GetDetailedState());
}

// 방법 3: 카테고리 활성화 체크 (성능 최적화)
if (UE_LOG_ACTIVE(LogTemp, Verbose))
{
    // 비용이 높은 문자열 생성
    FString ExpensiveString = GenerateExpensiveDebugInfo();
    UE_LOG(LogTemp, Verbose, TEXT("Info: %s"), *ExpensiveString);
}
```

### 패턴 3: 함수 진입/종료 로깅

```cpp
void AMyActor::ComplexFunction()
{
    UE_LOG(LogMyGame, Verbose, TEXT(">>> ComplexFunction ENTER"));

    // 함수 로직
    // ...

    UE_LOG(LogMyGame, Verbose, TEXT("<<< ComplexFunction EXIT"));
}

// RAII 스타일 (자동 로깅)
struct FScopedLog
{
    FString FunctionName;

    FScopedLog(const FString& InName) : FunctionName(InName)
    {
        UE_LOG(LogTemp, Verbose, TEXT(">>> %s ENTER"), *FunctionName);
    }

    ~FScopedLog()
    {
        UE_LOG(LogTemp, Verbose, TEXT("<<< %s EXIT"), *FunctionName);
    }
};

void AMyActor::ComplexFunction()
{
    FScopedLog ScopedLog(TEXT("ComplexFunction"));
    // 함수 종료 시 자동으로 EXIT 로그
}
```

### 패턴 4: 에러 추적

```cpp
void LoadAsset(const FString& AssetPath)
{
    UObject* Asset = LoadObject<UObject>(nullptr, *AssetPath);

    if (!Asset)
    {
        UE_LOG(LogMyGame, Error, TEXT("Failed to load asset: %s"), *AssetPath);
        UE_LOG(LogMyGame, Error, TEXT("  | Caller: %s"), ANSI_TO_TCHAR(__FUNCTION__));
        UE_LOG(LogMyGame, Error, TEXT("  | File: %s:%d"), ANSI_TO_TCHAR(__FILE__), __LINE__);
        return;
    }

    UE_LOG(LogMyGame, Log, TEXT("Loaded asset: %s"), *Asset->GetName());
}
```

---

## ⚙️ 런타임 Verbosity 조절

### 콘솔 명령어

```
# 모든 카테고리 Verbosity 조회
log list

# 특정 카테고리 Verbosity 변경
log LogTemp Verbose
log LogMyGame All
log LogNetwork Warning

# 카테고리 비활성화
log LogTemp off

# 콘솔에서 카테고리 필터링
log LogTemp only         // LogTemp만 표시
log LogTemp reset        // 필터 해제
```

### C++ 코드에서 Verbosity 변경

```cpp
// 방법 1: 직접 설정
LogMyGame.SetVerbosity(ELogVerbosity::Verbose);

// 방법 2: IConsoleManager 사용
IConsoleManager::Get().RegisterConsoleCommand(
    TEXT("MyGame.EnableDebugLogs"),
    TEXT("Enable detailed logging"),
    FConsoleCommandDelegate::CreateLambda([]()
    {
        LogMyGame.SetVerbosity(ELogVerbosity::VeryVerbose);
        LogMyGameAI.SetVerbosity(ELogVerbosity::All);
    })
);
```

### DefaultEngine.ini 설정

```ini
[Core.Log]
; 기본 Verbosity 설정
Global=Log
LogTemp=Verbose
LogMyGame=All
LogMyGameAI=Warning

; Shipping 빌드에서는 무시됨
LogNetwork=VeryVerbose
```

---

## 🐛 디버깅 기능

### 로그 브레이크포인트

```cpp
// 방법 1: 코드에서 설정
LogMyGame.DebugBreakOnLog = true;
UE_LOG(LogMyGame, Error, TEXT("This will break!"));  // 디버거에서 중단

// 방법 2: 콘솔 명령어
log LogMyGame break
UE_LOG(LogMyGame, Warning, TEXT("Break on log"));  // 중단
```

### Fatal 로그 (크래시)

```cpp
// Fatal 로그는 항상 크래시 유발
UE_LOG(LogTemp, Fatal, TEXT("Critical error!"));
// → 프로그램 즉시 종료, 콜스택 덤프

// ensure와 유사하게 사용
if (!ensure(Pointer != nullptr))
{
    UE_LOG(LogTemp, Fatal, TEXT("Null pointer encountered!"));
}
```

---

## 🚀 성능 최적화

### ✅ 해야 할 것

```cpp
// 좋은 예시 1: Verbosity 체크로 비용 절약
if (UE_LOG_ACTIVE(LogTemp, VeryVerbose))
{
    // 비용이 높은 문자열 생성은 로그 활성화 시에만
    FString ExpensiveDebugInfo = GenerateComplexDebugInfo();
    UE_LOG(LogTemp, VeryVerbose, TEXT("Debug: %s"), *ExpensiveDebugInfo);
}

// 좋은 예시 2: Shipping 빌드에서 제거
DECLARE_LOG_CATEGORY_EXTERN(LogDebug, Log, Verbose);
UE_LOG(LogDebug, Verbose, TEXT("Debug only"));
// Shipping: CompileTimeVerbosity = Verbose → VeryVerbose 로그는 컴파일 제거

// 좋은 예시 3: 카테고리 세분화
UE_LOG(LogMyGameAI, Verbose, TEXT("AI state changed"));
UE_LOG(LogMyGameNetwork, Warning, TEXT("Packet loss detected"));
// → 필요한 카테고리만 활성화 가능
```

### ❌ 피해야 할 것

```cpp
// 나쁜 예시 1: 항상 비용 발생
FString ExpensiveString = GenerateExpensiveInfo();  // ❌ 로그 비활성화여도 생성
UE_LOG(LogTemp, Verbose, TEXT("Info: %s"), *ExpensiveString);

// 나쁜 예시 2: 너무 많은 로그
for (int32 i = 0; i < 10000; i++)
{
    UE_LOG(LogTemp, Log, TEXT("Processing: %d"), i);  // ❌ 성능 저하
}
// → 주기적으로만 로그 (i % 1000 == 0)

// 나쁜 예시 3: LogTemp 남용
UE_LOG(LogTemp, Log, TEXT("AI calculation"));  // ❌ 카테고리 불명확
// → 전용 카테고리 사용 (LogMyGameAI)

// 나쁜 예시 4: 문자열 포맷 실수
UObject* Object = nullptr;
UE_LOG(LogTemp, Log, TEXT("Object: %s"), *Object->GetName());  // ❌ 크래시!
// → GetNameSafe() 사용
```

---

## 🔗 참조 자료

### 공식 문서
- Unreal Engine Docs: [Logging](https://docs.unrealengine.com/en-US/ProgrammingAndScripting/ProgrammingWithCPP/Logging/)
- Unreal Engine Docs: [Output Log](https://docs.unrealengine.com/en-US/Basics/SourceControl/InEditor/OutputLog/)

### 소스 코드
- `Engine/Source/Runtime/Core/Public/Logging/LogMacros.h` - UE_LOG 매크로
- `Engine/Source/Runtime/Core/Public/Logging/LogCategory.h` - 로그 카테고리
- `Engine/Source/Runtime/Core/Public/Logging/LogVerbosity.h` - Verbosity 정의
- `Engine/Source/Runtime/Core/Public/Misc/OutputDevice.h` - 출력 장치
- `Engine/Source/Runtime/Core/Private/Misc/OutputDeviceRedirector.cpp` - 리다이렉터 구현

### 관련 주제
- `UnrealSummary/Core/Console.md` - 콘솔 명령어 시스템
- `UnrealSummary/Core/String.md` - 문자열 포맷팅 (FString, FName)
- `CLAUDE.md` - 빌드 설정 (Shipping 빌드에서 로그 제거)

---

> 🔄 Created: 2025-01-XX — Initial documentation for Logging System in UE 5.7
