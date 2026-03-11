---
title: "Task Graph System Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "MultiThreading"
tags: ["unreal", "Core", "MultiThreading"]
engine_version: "Unreal Engine 5.7"
---
# Task Graph System Deep Dive

## 🧭 개요 (Overview)

**Task Graph**는 Unreal Engine의 병렬 작업 스케줄링 시스템으로, CPU 코어를 효율적으로 활용합니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Task** | 비동기 실행 단위 (`UE::Tasks::TTask<T>`) |
| **Named Threads** | GameThread, RenderThread, RHIThread |
| **Worker Threads** | Thread Pool (CPU 코어 수만큼) |
| **Task Priority** | Normal / High Priority |
| **Prerequisites** | Task 실행 전에 완료되어야 하는 선행 Task |
| **Dependency Graph** | Task 간 의존성 관계 (DAG) |

---

## ⚡ Named Threads

**📂 위치:** `Core/Public/Async/TaskGraphInterfaces.h:54`

```cpp
namespace ENamedThreads
{
    enum Type : int32
    {
        // 주요 Named Threads
        GameThread              = 0,   // 메인 게임 로직
        ActualRenderingThread   = 1,   // 렌더링 로직
        RHIThread              = 2,   // RHI 명령 전송

        // Worker Threads
        AnyThread              = 0xff, // 아무 Worker Thread

        // Queue Type
        MainQueue              = 0x000, // Shared Queue
        LocalQueue             = 0x100, // Thread-Local Queue

        // Task Priority
        NormalTaskPriority     = 0x000,
        HighTaskPriority       = 0x200,

        // Thread Priority
        NormalThreadPriority   = 0x000,
        HighThreadPriority     = 0x400,
        BackgroundThreadPriority = 0x800,
    };
}
```

---

## 🏗️ UE::Tasks API

### TTask<T> - Task Handle

```cpp
#include "Tasks/Task.h"

// Task 생성 및 실행
UE::Tasks::TTask<int32> MyTask = UE::Tasks::Launch(
    UE_SOURCE_LOCATION,  // 디버깅용 위치 정보
    []() -> int32
    {
        // 비동기 작업
        return 42;
    }
);

// Task 완료 대기
MyTask.Wait();

// 결과 가져오기
int32 Result = MyTask.GetResult();
```

### Prerequisites (선행 조건)

```cpp
// Task A, B 생성
UE::Tasks::TTask<void> TaskA = UE::Tasks::Launch(UE_SOURCE_LOCATION, []() { /* Work A */ });
UE::Tasks::TTask<void> TaskB = UE::Tasks::Launch(UE_SOURCE_LOCATION, []() { /* Work B */ });

// Task C는 A와 B가 완료된 후 실행
UE::Tasks::TTask<void> TaskC = UE::Tasks::Launch(
    UE_SOURCE_LOCATION,
    []() { /* Work C */ },
    UE::Tasks::Prerequisites(TaskA, TaskB)  // 🔑 선행 조건
);
```

### ParallelFor - 병렬 루프

```cpp
#include "Async/ParallelFor.h"

TArray<int32> Data;
Data.SetNum(10000);

// 10,000개 항목을 병렬 처리
ParallelFor(Data.Num(), [&Data](int32 Index)
{
    Data[Index] = Index * 2;  // 각 Worker Thread에서 실행
});
```

---

## 🎯 실전 예시

### 예시 1: Async Loading

```cpp
// 비동기 Texture 로딩
UE::Tasks::TTask<UTexture2D*> LoadTask = UE::Tasks::Launch(
    UE_SOURCE_LOCATION,
    []() -> UTexture2D*
    {
        return LoadObject<UTexture2D>(nullptr, TEXT("/Game/Textures/MyTexture"));
    }
);

// 나중에 결과 사용
if (LoadTask.IsCompleted())
{
    UTexture2D* Texture = LoadTask.GetResult();
}
```

### 예시 2: Pipeline (A → B → C)

```cpp
auto TaskA = UE::Tasks::Launch(UE_SOURCE_LOCATION, []() { return 10; });
auto TaskB = UE::Tasks::Launch(UE_SOURCE_LOCATION, []() { return 20; }, UE::Tasks::Prerequisites(TaskA));
auto TaskC = UE::Tasks::Launch(UE_SOURCE_LOCATION, []() { return 30; }, UE::Tasks::Prerequisites(TaskB));

TaskC.Wait();  // C 완료 시 A, B도 자동 완료
```

---

## 🚀 성능 최적화

### ✅ 올바른 사용

```cpp
// 병렬 처리 가능한 작업
ParallelFor(Actors.Num(), [&](int32 i)
{
    Actors[i]->UpdatePhysics();  // 독립적인 작업
});
```

### ❌ 피해야 할 것

```cpp
// Race Condition!
int32 Counter = 0;
ParallelFor(1000, [&](int32 i)
{
    Counter++;  // 🚫 여러 Thread가 동시 접근!
});

// ✅ 올바른 방법: Atomic
std::atomic<int32> Counter{0};
ParallelFor(1000, [&](int32 i)
{
    Counter.fetch_add(1, std::memory_order_relaxed);
});
```

---

## 📊 성능 비교

**10,000개 Actor 업데이트:**

| 구현 | 시간 | CPU 사용률 |
|------|------|-----------|
| **Sequential (for loop)** | 100ms | 12.5% (1/8 코어) |
| **ParallelFor** | 15ms | ~100% (8/8 코어) |

---

## 🔗 참고 자료

**소스 파일:**
- `Core/Public/Tasks/Task.h` - UE::Tasks API
- `Core/Public/Async/ParallelFor.h` - ParallelFor
- `Core/Public/Async/TaskGraphInterfaces.h` - Named Threads

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Task Graph System
  - UE::Tasks::TTask API
  - Prerequisites & ParallelFor
  - Named Threads (GameThread/RenderThread/RHIThread)