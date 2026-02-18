---
title: "Time (시간 시스템)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Core"
tags: ["unreal", "Core"]
---
# Time (시간 시스템)

## 🧭 개요

**Time System**은 언리얼 엔진의 **시간 측정 및 관리 메커니즘**입니다. 고성능 타이머, 프레임 시간, 델타 타임, 타임스탬프 등을 플랫폼 독립적으로 제공합니다.

**핵심 철학:**
> **FPlatformTime**은 "플랫폼별 시간 측정" (초 단위, 고해상도),
> **FDateTime**는 "날짜/시간 표현" (년/월/일/시/분/초),
> **FTimespan**은 "시간 간격" (Duration)을 담당한다.

**📂 위치:**
- `Engine/Source/Runtime/Core/Public/HAL/PlatformTime.h`
- `Engine/Source/Runtime/Core/Public/Misc/DateTime.h`
- `Engine/Source/Runtime/Core/Public/Misc/Timespan.h`

---

## 🧩 핵심 API

### 1. **FPlatformTime - 고성능 타이머**

**현재 시간 (초):**
```cpp
double CurrentTime = FPlatformTime::Seconds();
UE_LOG(LogTemp, Log, TEXT("Current time: %.3f seconds"), CurrentTime);
```

**시간 측정:**
```cpp
double StartTime = FPlatformTime::Seconds();

// 작업 수행
DoExpensiveWork();

double EndTime = FPlatformTime::Seconds();
double ElapsedTime = EndTime - StartTime;
UE_LOG(LogTemp, Log, TEXT("Elapsed: %.3f ms"), ElapsedTime * 1000.0);
```

**CPU 사이클:**
```cpp
uint64 StartCycles = FPlatformTime::Cycles64();
DoWork();
uint64 EndCycles = FPlatformTime::Cycles64();
double ElapsedSeconds = FPlatformTime::ToSeconds64(EndCycles - StartCycles);
```

---

### 2. **FDateTime - 날짜/시간**

**현재 시간:**
```cpp
FDateTime Now = FDateTime::Now();       // 로컬 시간
FDateTime UtcNow = FDateTime::UtcNow(); // UTC 시간

UE_LOG(LogTemp, Log, TEXT("Year: %d, Month: %d, Day: %d"),
    Now.GetYear(), Now.GetMonth(), Now.GetDay());
UE_LOG(LogTemp, Log, TEXT("Hour: %d, Minute: %d, Second: %d"),
    Now.GetHour(), Now.GetMinute(), Now.GetSecond());
```

**날짜 생성:**
```cpp
FDateTime CustomDate(2025, 12, 31, 23, 59, 59);  // 2025-12-31 23:59:59
```

**날짜 연산:**
```cpp
FDateTime Tomorrow = FDateTime::Now() + FTimespan::FromDays(1);
FDateTime NextWeek = FDateTime::Now() + FTimespan::FromDays(7);
```

**포맷 변환:**
```cpp
FString DateString = Now.ToString(TEXT("%Y-%m-%d %H:%M:%S"));
// "2025-01-15 14:30:45"

FDateTime Parsed;
FDateTime::Parse(TEXT("2025-01-15 14:30:45"), Parsed);
```

---

### 3. **FTimespan - 시간 간격**

**생성:**
```cpp
FTimespan Duration = FTimespan::FromSeconds(90);
FTimespan Interval = FTimespan::FromMinutes(5);
FTimespan Period = FTimespan::FromHours(2);
```

**변환:**
```cpp
double TotalSeconds = Duration.GetTotalSeconds();    // 90.0
int32 Minutes = Duration.GetMinutes();               // 1
int32 Seconds = Duration.GetSeconds();               // 30
```

---

## 💡 실전 패턴

### 패턴 1: 프레임 타임 측정

```cpp
void AMyActor::Tick(float DeltaTime)
{
    static double LastTime = FPlatformTime::Seconds();
    double CurrentTime = FPlatformTime::Seconds();
    double FrameTime = CurrentTime - LastTime;

    UE_LOG(LogTemp, Verbose, TEXT("Frame time: %.3f ms (%.1f FPS)"),
        FrameTime * 1000.0, 1.0 / FrameTime);

    LastTime = CurrentTime;
}
```

### 패턴 2: 타이머 (주기적 실행)

```cpp
FTimerHandle TimerHandle;

GetWorld()->GetTimerManager().SetTimer(
    TimerHandle,
    [this]()
    {
        UE_LOG(LogTemp, Log, TEXT("Timer triggered"));
    },
    5.0f,      // 5초마다
    true       // 반복
);

// 타이머 중지
GetWorld()->GetTimerManager().ClearTimer(TimerHandle);
```

### 패턴 3: 프로파일링

```cpp
{
    SCOPE_CYCLE_COUNTER(STAT_MyExpensiveFunction);
    DoExpensiveWork();
}

// 또는 수동
double StartTime = FPlatformTime::Seconds();
DoExpensiveWork();
double ElapsedMs = (FPlatformTime::Seconds() - StartTime) * 1000.0;
UE_LOG(LogTemp, Log, TEXT("Function took %.3f ms"), ElapsedMs);
```

---

## 🔗 참조 자료

### 공식 문서
- Unreal Engine Docs: [Timers](https://docs.unrealengine.com/en-US/ProgrammingAndScripting/ProgrammingWithCPP/UnrealArchitecture/Timers/)

### 소스 코드
- `Engine/Source/Runtime/Core/Public/HAL/PlatformTime.h`
- `Engine/Source/Runtime/Core/Public/Misc/DateTime.h`
- `Engine/Source/Runtime/Core/Public/Misc/Timespan.h`

---

> 🔄 Created: 2025-01-XX — Initial documentation for Time System in UE 5.7
