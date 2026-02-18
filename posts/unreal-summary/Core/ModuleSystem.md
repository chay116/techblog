---
title: "ModuleSystem (모듈 시스템)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Core"
tags: ["unreal", "Core"]
---
# ModuleSystem (모듈 시스템)

## 🧭 개요

**Module System**은 언리얼 엔진의 **코드 조직화 및 동적 로딩 메커니즘**입니다. 엔진, 게임, 플러그인의 모든 코드는 **모듈(Module)** 단위로 분할되며, 각 모듈은 독립적으로 컴파일되고 런타임에 동적으로 로드/언로드될 수 있습니다.

**핵심 철학:**
> **모듈**은 "논리적 기능 단위" (Core, Engine, Slate 등),
> **의존성 그래프**는 "빌드 순서와 링크 관계",
> **동적 로딩**은 "플러그인과 핫 리로드"를 가능하게 한다.

**모듈의 장점:**
- **빌드 병렬화**: 의존성 없는 모듈은 동시에 컴파일
- **명확한 경계**: Public/Private API 분리
- **플러그인 시스템**: 외부 모듈 동적 추가
- **핫 리로드**: 에디터 실행 중 코드 변경 가능 (UE4/5 초기 버전)
- **링크 시간 단축**: 변경된 모듈만 재링크

**📂 위치:**
- 모듈 인터페이스: `Engine/Source/Runtime/Core/Public/Modules/ModuleInterface.h`
- 모듈 관리자: `Engine/Source/Runtime/Core/Public/Modules/ModuleManager.h`
- 빌드 설정 예시: `Engine/Source/Runtime/Core/Core.Build.cs`

---

## 🧱 모듈 아키텍처

### 모듈 계층 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Engine Modules (엔진 모듈)                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  Core (핵심 기반)                                         │          │
│  │  - 컨테이너, 문자열, 메모리, HAL, 모듈 시스템 자체         │          │
│  └─────────────────┬────────────────────────────────────────┘          │
│                    ↓ (의존)                                            │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  CoreUObject (오브젝트 시스템)                            │          │
│  │  - UObject, 리플렉션, GC, 직렬화                          │          │
│  └─────────────────┬────────────────────────────────────────┘          │
│                    ↓                                                   │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  Engine (게임 엔진)                                       │          │
│  │  - Actor, Component, Level, World, GameMode               │          │
│  └──────────────────────────────────────────────────────────┘          │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  Slate (UI 프레임워크)                                    │          │
│  └──────────────────────────────────────────────────────────┘          │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  Renderer (렌더링)                                        │          │
│  └──────────────────────────────────────────────────────────┘          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                      ↓ (의존)
┌─────────────────────────────────────────────────────────────────────────┐
│                      Game Modules (게임 모듈)                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  MyGame (게임 로직)                                       │          │
│  └──────────────────────────────────────────────────────────┘          │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  MyGameEditor (에디터 전용)                               │          │
│  └──────────────────────────────────────────────────────────┘          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                      ↓ (선택적)
┌─────────────────────────────────────────────────────────────────────────┐
│                      Plugin Modules (플러그인)                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  ThirdPartyLibrary (외부 라이브러리)                      │          │
│  └──────────────────────────────────────────────────────────┘          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 모듈 디렉토리 구조

```
MyModule/
├── MyModule.Build.cs           # 빌드 설정 (C#)
├── Public/                     # 공개 헤더 (다른 모듈이 include 가능)
│   ├── MyModuleAPI.h           # DLL export/import 매크로
│   ├── MyPublicClass.h
│   └── Interfaces/
│       └── IMyInterface.h
├── Private/                    # 비공개 구현 (.cpp와 내부 헤더)
│   ├── MyPrivateClass.h
│   ├── MyPrivateClass.cpp
│   └── MyModule.cpp            # 모듈 구현 (IMPLEMENT_MODULE)
└── Classes/                    # UObject 클래스 (선택적)
    └── MyActor.h
```

---

## 🧩 핵심 구성 요소

### 1. **IModuleInterface - 모듈 인터페이스**

**📂 위치:** `ModuleInterface.h:13`

```cpp
class IModuleInterface
{
public:
    virtual ~IModuleInterface() {}

    // DLL 로드 직후 호출 (초기화)
    virtual void StartupModule() {}

    // DLL 언로드 직전 호출 (정리)
    virtual void ShutdownModule() {}

    // 리로드 전 호출 (핫 리로드)
    virtual void PreUnloadCallback() {}

    // 리로드 후 호출
    virtual void PostLoadCallback() {}

    // 동적 언로드 지원 여부
    virtual bool SupportsDynamicReloading()
    {
        return true;
    }

    // 자동 종료 지원 여부
    virtual bool SupportsAutomaticShutdown()
    {
        return true;
    }

    // 게임플레이 코드 포함 여부
    virtual bool IsGameModule() const
    {
        return false;
    }
};
```

**생명주기:**
```
     프로세스 시작               DLL 로드               모듈 사용               프로세스 종료
         │                        │                       │                        │
         │                        │ LoadModule()          │                        │
         │                        ├─────────────┐         │                        │
         │                        │ DLL 로드     │         │                        │
         │                        │<────────────┘         │                        │
         │                        │                       │                        │
         │                        │ StartupModule()       │                        │
         │                        ├─────────────┐         │                        │
         │                        │ 초기화       │         │                        │
         │                        │<────────────┘         │                        │
         │                        │                       │                        │
         │                        ↓                       ↓                        │
         │              [모듈 사용 가능]          [API 호출]                      │
         │                                                                        │
         │                                                  │ ShutdownModule()    │
         │                                                  ├─────────────┐       │
         │                                                  │ 정리         │       │
         │                                                  │<────────────┘       │
         │                                                  │ DLL 언로드           │
         │                                                  ├─────────────┐       │
         │                                                  │             │       │
         │                                                  │<────────────┘       │
         └──────────────────────────────────────────────────┴────────────────────┘
```

---

### 2. **모듈 구현 매크로**

**모듈 정의:**
```cpp
// MyModule/Private/MyModule.cpp
#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

class FMyModule : public IModuleInterface
{
public:
    virtual void StartupModule() override
    {
        UE_LOG(LogTemp, Log, TEXT("MyModule: StartupModule"));
        // 초기화 코드 (싱글톤, 델리게이트 등록 등)
    }

    virtual void ShutdownModule() override
    {
        UE_LOG(LogTemp, Log, TEXT("MyModule: ShutdownModule"));
        // 정리 코드 (리소스 해제, 델리게이트 해제 등)
    }
};

// 모듈 등록 (필수!)
IMPLEMENT_MODULE(FMyModule, MyModule)
//                   ↑           ↑
//            클래스 이름    모듈 이름 (Build.cs와 동일)
```

**IMPLEMENT_MODULE 매크로 분석:**
```cpp
// ModuleBoilerplate.h에서 정의
#define IMPLEMENT_MODULE(ModuleImplClass, ModuleName) \
    extern "C" DLLEXPORT IModuleInterface* InitializeModule() \
    { \
        return new ModuleImplClass(); \
    }

// 각 모듈 DLL은 "InitializeModule()" 함수를 export
// FModuleManager는 이 함수를 호출하여 모듈 인스턴스 생성
```

---

### 3. **FModuleManager - 모듈 관리자**

**📂 위치:** `ModuleManager.h:170`

```cpp
class FModuleManager
{
public:
    // 싱글톤 접근
    static FModuleManager& Get();

    // 모듈 로드 (동기)
    IModuleInterface* LoadModule(const FName InModuleName);

    // 모듈 로드 (실패 시 예외 발생)
    IModuleInterface& LoadModuleChecked(const FName InModuleName);

    // 모듈 로드 (실패 이유 반환)
    TSharedPtr<IModuleInterface> LoadModuleWithFailureReason(
        const FName InModuleName,
        EModuleLoadResult& OutFailureReason
    );

    // 모듈 언로드
    bool UnloadModule(const FName InModuleName, bool bIsShutdown = false);

    // 모듈 로드 여부 확인
    bool IsModuleLoaded(const FName InModuleName) const;

    // 모듈 인터페이스 반환 (로드 안함)
    IModuleInterface* GetModule(const FName InModuleName);

    // 모듈 인터페이스 반환 (템플릿)
    template<typename TModuleInterface>
    static TModuleInterface& GetModuleChecked(const FName ModuleName)
    {
        FModuleManager& ModuleManager = FModuleManager::Get();
        return static_cast<TModuleInterface&>(
            ModuleManager.LoadModuleChecked(ModuleName)
        );
    }

    // 모듈 상태 쿼리
    void QueryModules(TArray<FModuleStatus>& OutModuleStatuses) const;
};
```

**사용 예시:**
```cpp
// 예시 1: 모듈 로드 및 사용
FModuleManager& ModuleManager = FModuleManager::Get();

// 방법 A: 기본 로드
if (ModuleManager.LoadModule(TEXT("HTTP")))
{
    // 모듈 로드 성공
}

// 방법 B: 타입 안전한 로드
IHttpModule& HttpModule = FModuleManager::LoadModuleChecked<IHttpModule>("HTTP");
HttpModule.GetHttpManager()->DoSomething();

// 예시 2: 모듈 로드 여부 확인
if (FModuleManager::Get().IsModuleLoaded("HTTP"))
{
    // 이미 로드됨
}

// 예시 3: 플러그인 모듈 로드
FModuleManager::Get().LoadModule(TEXT("MyPlugin"));
```

---

## 📦 모듈 빌드 설정 (.Build.cs)

### Build.cs 구조

**📂 위치:** `Core.Build.cs:7`

```csharp
using UnrealBuildTool;

public class MyModule : ModuleRules
{
    public MyModule(ReadOnlyTargetRules Target) : base(Target)
    {
        // PCH 설정
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        // Public 의존성 (헤더 + 링크)
        // 이 모듈을 사용하는 모듈도 자동으로 의존
        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine"
        });

        // Private 의존성 (링크만)
        // 이 모듈의 Private 코드에서만 사용
        PrivateDependencyModuleNames.AddRange(new string[]
        {
            "Slate",
            "SlateCore",
            "HTTP"
        });

        // 동적 로드 모듈 (런타임에 로드)
        DynamicallyLoadedModuleNames.AddRange(new string[]
        {
            "OnlineSubsystem",
            "OnlineSubsystemSteam"
        });

        // Public Include 경로
        PublicIncludePaths.AddRange(new string[]
        {
            "MyModule/Public"
        });

        // Private Include 경로
        PrivateIncludePaths.AddRange(new string[]
        {
            "MyModule/Private"
        });

        // 플랫폼별 설정
        if (Target.Platform == UnrealTargetPlatform.Win64)
        {
            PrivateDependencyModuleNames.Add("XInput");
        }

        // 빌드 타입별 설정
        if (Target.bBuildEditor)
        {
            PrivateDependencyModuleNames.Add("UnrealEd");
        }

        // 프리프로세서 정의
        PublicDefinitions.Add("WITH_MY_FEATURE=1");
    }
}
```

### 의존성 타입

| 타입 | 헤더 접근 | 링크 | 전이성 | 사용 시나리오 |
|------|---------|------|--------|--------------|
| **PublicDependencyModuleNames** | ✅ Public | ✅ | ✅ | Public 헤더에서 다른 모듈의 타입 사용 |
| **PrivateDependencyModuleNames** | ✅ Private | ✅ | ❌ | Private 구현에서만 사용 |
| **PublicIncludePathModuleNames** | ✅ Public | ❌ | ✅ | 헤더만 참조 (링크 불필요, 전방 선언용) |
| **PrivateIncludePathModuleNames** | ✅ Private | ❌ | ❌ | Private에서 헤더만 참조 |
| **DynamicallyLoadedModuleNames** | ❌ | ❌ | ❌ | 런타임에 FModuleManager로 로드 |

**전이성 예시:**
```
ModuleA (Public: Core, CoreUObject)
   ↓ (PublicDependency)
ModuleB (Public: ModuleA)
   ↓
ModuleC

ModuleC는 자동으로 Core, CoreUObject에도 접근 가능 (전이)
```

---

## 🔌 DLL Export/Import

### API 매크로 정의

**MyModule/Public/MyModuleAPI.h:**
```cpp
#pragma once

#include "CoreMinimal.h"

// DLL export/import 매크로
#ifdef MYMODULE_API
    #undef MYMODULE_API
#endif

#ifdef MYMODULE_EXPORTS
    // 이 모듈 빌드 시: export
    #define MYMODULE_API DLLEXPORT
#else
    // 다른 모듈에서 사용 시: import
    #define MYMODULE_API DLLIMPORT
#endif
```

**사용 예시:**
```cpp
// MyModule/Public/MyPublicClass.h
#pragma once

#include "CoreMinimal.h"
#include "MyModuleAPI.h"

// 다른 모듈에서 사용 가능 (export/import)
class MYMODULE_API FMyPublicClass
{
public:
    void DoSomething();

private:
    int32 PrivateMember;  // 외부에서 접근 불가
};

// 전역 함수도 export 가능
MYMODULE_API void MyGlobalFunction();
```

**빌드 시스템 동작:**
```
MyModule 빌드:
  → MYMODULE_EXPORTS 정의됨
  → MYMODULE_API = DLLEXPORT
  → MyModule.dll 생성 (FMyPublicClass를 export)

OtherModule 빌드:
  → MYMODULE_EXPORTS 정의 안됨
  → MYMODULE_API = DLLIMPORT
  → MyModule.dll에서 FMyPublicClass를 import
```

---

## 🔄 모듈 로딩 과정

### 로드 시퀀스

```
    코드                FModuleManager           DLL                InitializeModule
     │                        │                   │                        │
     │ LoadModule("MyModule") │                   │                        │
     ├───────────────────────>│                   │                        │
     │                        │ 모듈 경로 검색     │                        │
     │                        ├──────────┐        │                        │
     │                        │ FindDLL  │        │                        │
     │                        │<─────────┘        │                        │
     │                        │                   │                        │
     │                        │ LoadLibrary()     │                        │
     │                        ├──────────────────>│                        │
     │                        │                   │ DLL 메모리 매핑         │
     │                        │                   ├──────────┐             │
     │                        │                   │<─────────┘             │
     │                        │<──────────────────┤                        │
     │                        │ Handle            │                        │
     │                        │                   │                        │
     │                        │ GetProcAddress("InitializeModule")         │
     │                        ├───────────────────────────────────────────>│
     │                        │<───────────────────────────────────────────┤
     │                        │ Function Pointer  │                        │
     │                        │                   │                        │
     │                        │ Call InitializeModule()                    │
     │                        ├───────────────────────────────────────────>│
     │                        │                   │                        │ new FMyModule()
     │                        │                   │                        ├──────────┐
     │                        │                   │                        │<─────────┘
     │                        │<───────────────────────────────────────────┤
     │                        │ IModuleInterface* │                        │
     │                        │                   │                        │
     │                        │ StartupModule()   │                        │
     │                        ├───────────────────────────────────────────>│
     │                        │                   │                        │ 초기화 수행
     │                        │<───────────────────────────────────────────┤
     │<───────────────────────┤                   │                        │
     │  IModuleInterface*     │                   │                        │
```

### 모듈 검색 경로

```cpp
// 모듈 DLL 검색 순서:
1. Engine/Binaries/Win64/MyModule.dll
2. Plugins/MyPlugin/Binaries/Win64/MyModule.dll  // 예시 (Engine 또는 Project 아래)
3. Project/Binaries/Win64/MyModule.dll
4. Project/Plugins/MyPlugin/Binaries/Win64/MyModule.dll
```

---

## 💡 실전 사용 패턴

### 패턴 1: 게임 모듈 구현

**MyGame.Build.cs:**
```csharp
public class MyGame : ModuleRules
{
    public MyGame(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "InputCore"
        });

        PrivateDependencyModuleNames.AddRange(new string[]
        {
            "Slate",
            "SlateCore"
        });
    }
}
```

**MyGame/Private/MyGame.cpp:**
```cpp
#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

class FMyGameModule : public IModuleInterface
{
public:
    virtual void StartupModule() override
    {
        UE_LOG(LogTemp, Log, TEXT("MyGame module starting up"));
    }

    virtual void ShutdownModule() override
    {
        UE_LOG(LogTemp, Log, TEXT("MyGame module shutting down"));
    }

    virtual bool IsGameModule() const override
    {
        return true;  // 게임 모듈임을 명시
    }
};

IMPLEMENT_MODULE(FMyGameModule, MyGame)
```

---

### 패턴 2: 플러그인 모듈

**MyPlugin.uplugin:**
```json
{
    "FileVersion": 3,
    "FriendlyName": "My Plugin",
    "Version": 1,
    "Modules": [
        {
            "Name": "MyPlugin",
            "Type": "Runtime",
            "LoadingPhase": "Default"
        }
    ]
}
```

**MyPlugin.Build.cs:**
```csharp
public class MyPlugin : ModuleRules
{
    public MyPlugin(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[] { "Core" });
        PrivateDependencyModuleNames.AddRange(new string[] { "Engine", "CoreUObject" });
    }
}
```

**MyPlugin/Private/MyPlugin.cpp:**
```cpp
#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"
#include "IMyPlugin.h"

class FMyPluginModule : public IMyPlugin
{
public:
    virtual void StartupModule() override
    {
        UE_LOG(LogTemp, Log, TEXT("MyPlugin module has been loaded"));
    }

    virtual void ShutdownModule() override
    {
        UE_LOG(LogTemp, Log, TEXT("MyPlugin module has been unloaded"));
    }

    // 플러그인 API 구현
    virtual void DoPluginStuff() override
    {
        // 기능 구현
    }
};

IMPLEMENT_MODULE(FMyPluginModule, MyPlugin)
```

**외부에서 사용:**
```cpp
// 다른 모듈에서 플러그인 사용
if (FModuleManager::Get().IsModuleLoaded("MyPlugin"))
{
    IMyPlugin& Plugin = FModuleManager::GetModuleChecked<IMyPlugin>("MyPlugin");
    Plugin.DoPluginStuff();
}
```

---

### 패턴 3: 에디터 전용 모듈

**MyGameEditor.Build.cs:**
```csharp
public class MyGameEditor : ModuleRules
{
    public MyGameEditor(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        // 에디터 전용 의존성
        PrivateDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "UnrealEd",  // 에디터 API
            "MyGame"     // 게임 모듈
        });
    }
}
```

**MyGameEditor.Target.cs에서 로드:**
```csharp
// MyGameEditor.Target.cs
public class MyGameEditorTarget : TargetRules
{
    public MyGameEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        ExtraModuleNames.AddRange(new string[]
        {
            "MyGame",
            "MyGameEditor"  // 에디터에서만 로드
        });
    }
}
```

---

## 🚀 성능 최적화

### ✅ 해야 할 것

```cpp
// 좋은 예시 1: Private 의존성 사용
// MyModule.Build.cs
PrivateDependencyModuleNames.Add("HTTP");  // Private 구현에서만 사용
// → 다른 모듈은 HTTP에 의존하지 않음 (빌드 시간 단축)

// 좋은 예시 2: 전방 선언 활용
// MyPublicClass.h
class UTexture2D;  // 전방 선언

class MYMODULE_API FMyClass
{
    UTexture2D* Texture;  // 포인터만 사용
};

// MyPrivateClass.cpp
#include "Engine/Texture2D.h"  // 구현에서만 include

// 좋은 예시 3: 동적 로드 (선택적 기능)
// MyModule.Build.cs
DynamicallyLoadedModuleNames.Add("OnlineSubsystemSteam");

// Runtime에서 필요 시 로드
if (bUseSteam)
{
    FModuleManager::Get().LoadModule("OnlineSubsystemSteam");
}
```

### ❌ 피해야 할 것

```cpp
// 나쁜 예시 1: Public 의존성 남용
// MyModule.Build.cs
PublicDependencyModuleNames.Add("HTTP");  // ❌
// → 이 모듈을 사용하는 모든 모듈이 HTTP에도 의존 (전이)
// → PrivateDependency로 충분하면 Private 사용

// 나쁜 예시 2: Public 헤더에서 불필요한 include
// MyPublicClass.h
#include "Engine/Texture2D.h"  // ❌ Public 헤더에서 include
// → 이 헤더를 include하는 모든 파일이 Texture2D.h도 include
// → 전방 선언으로 충분하면 전방 선언 사용

// 나쁜 예시 3: 순환 의존성
// ModuleA.Build.cs
PublicDependencyModuleNames.Add("ModuleB");
// ModuleB.Build.cs
PublicDependencyModuleNames.Add("ModuleA");
// → 링크 에러! 순환 의존성 금지

// 해결 방법: 인터페이스 분리
// InterfaceModule ← ModuleA, ModuleB 모두 의존
```

---

## 🐛 일반적인 함정

### 함정 1: IMPLEMENT_MODULE 누락

```cpp
// ❌ 잘못된 코드: 모듈 구현만 있음
class FMyModule : public IModuleInterface
{
    // ...
};

// 링크 에러: "InitializeModule() undefined"
// → IMPLEMENT_MODULE 매크로 필수!

// ✅ 올바른 코드
class FMyModule : public IModuleInterface
{
    // ...
};

IMPLEMENT_MODULE(FMyModule, MyModule)
```

### 함정 2: 모듈 이름 불일치

```cpp
// MyModule.Build.cs
public class MyModule : ModuleRules { ... }

// MyModule.cpp
IMPLEMENT_MODULE(FMyModuleImpl, MyModul)  // ❌ 오타!
//                                   ↑ 'e' 누락

// 런타임 에러: "Cannot find module 'MyModule'"
```

### 함정 3: DLL 경계에서 메모리 문제

```cpp
// ❌ 위험한 코드: ModuleA에서 할당, ModuleB에서 해제
// ModuleA
MODULEA_API FString* CreateString()
{
    return new FString(TEXT("Hello"));  // ModuleA의 힙에서 할당
}

// ModuleB
void UseString()
{
    FString* Str = CreateString();
    delete Str;  // ❌ ModuleB의 힙에서 해제 시도 → 크래시!
}

// ✅ 올바른 방법: 스마트 포인터 사용
MODULEA_API TSharedPtr<FString> CreateString()
{
    return MakeShared<FString>(TEXT("Hello"));
}
// 또는 값으로 반환
MODULEA_API FString CreateString()
{
    return FString(TEXT("Hello"));
}
```

---

## 🔗 참조 자료

### 공식 문서
- Unreal Engine Docs: [Modules](https://docs.unrealengine.com/en-US/ProductionPipelines/BuildTools/UnrealBuildTool/ModuleFiles/)
- Unreal Engine Docs: [Build Configuration](https://docs.unrealengine.com/en-US/ProductionPipelines/BuildTools/UnrealBuildTool/)
- Unreal Engine Docs: [Plugins](https://docs.unrealengine.com/en-US/ProductionPipelines/Plugins/)

### 소스 코드
- `Engine/Source/Runtime/Core/Public/Modules/ModuleInterface.h` - 모듈 인터페이스
- `Engine/Source/Runtime/Core/Public/Modules/ModuleManager.h` - 모듈 관리자
- `Engine/Source/Runtime/Core/Private/Modules/ModuleManager.cpp` - 모듈 로딩 구현
- `Engine/Source/Runtime/Core/Public/Modules/Boilerplate/ModuleBoilerplate.h` - IMPLEMENT_MODULE 매크로

### 관련 주제
- `CLAUDE.md` - 빌드 시스템 개요 (UnrealBuildTool, Build.cs)
- `UnrealSummary/Core/SmartPointers.md` - DLL 경계 메모리 관리
- `UnrealSummary/CoreUObject/Reflection.md` - 모듈과 UObject 리플렉션

---

> 🔄 Created: 2025-01-XX — Initial documentation for Module System in UE 5.7
