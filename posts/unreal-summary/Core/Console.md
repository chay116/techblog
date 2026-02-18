---
title: "Console (콘솔 시스템)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Core"
tags: ["unreal", "Core"]
---
# Console (콘솔 시스템)

## 🧭 개요

**Console System**은 언리얼 엔진의 **런타임 설정 및 디버깅 명령어 시스템**입니다. 콘솔 변수(CVar), 콘솔 명령어(Command), 자동 완성을 제공하여 개발 중 실시간으로 게임 동작을 조정할 수 있습니다.

**핵심 철학:**
> **Console Variable (CVar)**는 "설정 값" (int, float, bool, string),
> **Console Command**는 "실행 함수",
> **IConsoleManager**는 "등록 및 관리"를 담당한다.

**📂 위치:**
- `Engine/Source/Runtime/Core/Public/HAL/IConsoleManager.h`

---

## 🧩 핵심 API

### 1. **콘솔 변수 (CVar) 등록**

**정적 등록 (전역):**
```cpp
// .cpp 파일에서
static TAutoConsoleVariable<int32> CVarMyVariable(
    TEXT("MyGame.MyVariable"),    // 변수 이름
    100,                           // 기본값
    TEXT("Description of the variable"),  // 설명
    ECVF_Default                   // 플래그
);

// 사용
int32 Value = CVarMyVariable.GetValueOnGameThread();
CVarMyVariable.Set(200);
```

**동적 등록:**
```cpp
IConsoleManager& ConsoleManager = IConsoleManager::Get();

IConsoleVariable* CVar = ConsoleManager.RegisterConsoleVariable(
    TEXT("MyGame.DynamicVar"),
    0,
    TEXT("Dynamically registered variable"),
    ECVF_Default
);
```

---

### 2. **콘솔 명령어 (Command) 등록**

**람다 명령어:**
```cpp
IConsoleManager::Get().RegisterConsoleCommand(
    TEXT("MyGame.TestCommand"),
    TEXT("Test command description"),
    FConsoleCommandDelegate::CreateLambda([]()
    {
        UE_LOG(LogTemp, Log, TEXT("Test command executed"));
    }),
    ECVF_Default
);
```

**파라미터 있는 명령어:**
```cpp
IConsoleManager::Get().RegisterConsoleCommand(
    TEXT("MyGame.Teleport"),
    TEXT("Teleport to coordinates (x y z)"),
    FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
    {
        if (Args.Num() == 3)
        {
            float X = FCString::Atof(*Args[0]);
            float Y = FCString::Atof(*Args[1]);
            float Z = FCString::Atof(*Args[2]);

            // 텔레포트 로직
            UE_LOG(LogTemp, Log, TEXT("Teleport to: %.2f, %.2f, %.2f"), X, Y, Z);
        }
    }),
    ECVF_Cheat
);
```

---

### 3. **CVar 플래그**

```cpp
enum EConsoleVariableFlags
{
    ECVF_Default = 0x0,        // 기본
    ECVF_Cheat = 0x1,          // Shipping 빌드에서 숨김
    ECVF_ReadOnly = 0x4,       // 콘솔에서 변경 불가
    ECVF_RenderThreadSafe = 0x20,  // 렌더 스레드 동기화
    ECVF_Scalability = 0x40,   // 스케일러빌리티 설정
};
```

---

## 💡 실전 패턴

### 패턴 1: 디버그 모드 토글

```cpp
static TAutoConsoleVariable<bool> CVarDebugMode(
    TEXT("MyGame.DebugMode"),
    false,
    TEXT("Enable debug visualization"),
    ECVF_Default
);

void AMyActor::Tick(float DeltaTime)
{
    if (CVarDebugMode.GetValueOnGameThread())
    {
        // 디버그 시각화
        DrawDebugSphere(GetWorld(), GetActorLocation(), 100.0f, 12, FColor::Red);
    }
}
```

### 패턴 2: 성능 테스트

```cpp
static TAutoConsoleVariable<int32> CVarSpawnCount(
    TEXT("MyGame.SpawnCount"),
    10,
    TEXT("Number of actors to spawn for testing"),
    ECVF_Default
);

IConsoleManager::Get().RegisterConsoleCommand(
    TEXT("MyGame.SpawnTest"),
    TEXT("Spawn test actors"),
    FConsoleCommandDelegate::CreateLambda([]()
    {
        int32 Count = CVarSpawnCount.GetValueOnGameThread();
        for (int32 i = 0; i < Count; i++)
        {
            // 액터 생성
        }
        UE_LOG(LogTemp, Log, TEXT("Spawned %d actors"), Count);
    }),
    ECVF_Cheat
);
```

---

## 🎮 콘솔 사용법

```
# 게임 실행 중 ~ 키로 콘솔 열기

# CVar 조회
MyGame.DebugMode

# CVar 설정
MyGame.DebugMode 1

# 명령어 실행
MyGame.TestCommand

# 파라미터 있는 명령어
MyGame.Teleport 100 200 300

# 도움말
MyGame.DebugMode ?

# 자동 완성
MyGame.<Tab>
```

---

## 🔗 참조 자료

### 공식 문서
- Unreal Engine Docs: [Console Variables](https://docs.unrealengine.com/en-US/ProductionPipelines/DevelopmentSetup/Tools/ConsoleManager/)

### 소스 코드
- `Engine/Source/Runtime/Core/Public/HAL/IConsoleManager.h`

### 관련 주제
- `UnrealSummary/Core/Logging.md` - 콘솔 명령어로 로그 제어

---

> 🔄 Created: 2025-01-XX — Initial documentation for Console System in UE 5.7
