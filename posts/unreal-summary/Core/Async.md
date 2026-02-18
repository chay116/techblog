---
title: "Async (비동기 작업 시스템)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Core"
tags: ["unreal", "Core"]
---
# Async (비동기 작업 시스템)

## 🧭 개요

**Async System**은 언리얼 엔진의 **고수준 비동기 작업 API**입니다. TaskGraph보다 사용하기 쉬운 인터페이스를 제공하며, `TFuture<T>`/`TPromise<T>` 패턴으로 비동기 작업의 결과를 안전하게 처리할 수 있습니다.

**핵심 철학:**
> **Async()**는 "간단한 비동기 실행" (람다 기반),
> **TFuture/TPromise**는 "비동기 결과 전달" (타입 안전),
> **FAsyncTask**는 "재사용 가능한 작업" (클래스 기반)을 담당한다.

**TaskGraph와의 차이:**
- **TaskGraph**: 저수준, DAG 의존성, 세밀한 제어
- **Async**: 고수준, 간편한 사용, Future 패턴

**📂 위치:**
- `Engine/Source/Runtime/Core/Public/Async/Async.h`
- `Engine/Source/Runtime/Core/Public/Async/Future.h`
- `Engine/Source/Runtime/Core/Public/Async/AsyncWork.h`

---

## 🧱 비동기 실행 모드

### EAsyncExecution - 실행 전략

**📂 위치:** `Async.h:27`

```cpp
enum class EAsyncExecution
{
    // 짧은 작업 (밀리초 단위)
    TaskGraph,              // TaskGraph 시스템 사용 (워커 스레드)
    TaskGraphMainThread,    // 메인 스레드에서 실행 (즉시)
    TaskGraphMainTick,      // 다음 Tick에서 실행 (안전한 시점)

    // 긴 작업 (초 단위 이상)
    Thread,                 // 전용 스레드 생성
    ThreadIfForkSafe,       // Fork 안전 시 스레드 생성
    ThreadPool,             // 스레드 풀 사용 (권장)

#if WITH_EDITOR
    LargeThreadPool         // 에디터 전용 대형 스레드 풀
#endif
};
```

**선택 가이드:**

| 작업 유형 | 실행 시간 | 추천 모드 | 이유 |
|----------|---------|----------|------|
| 간단한 계산 | < 1ms | TaskGraph | 오버헤드 최소 |
| UI 업데이트 | < 5ms | TaskGraphMainThread | 메인 스레드 안전 |
| 게임 로직 | < 10ms | TaskGraphMainTick | 안전한 시점 실행 |
| 파일 I/O | > 100ms | ThreadPool | 긴 블로킹 작업 |
| 네트워크 | > 1s | Thread | 독립적 실행 |

---

## 🧩 핵심 API

### 1. **Async() - 비동기 실행**

**기본 사용법:**
```cpp
#include "Async/Async.h"

// 기본 (TaskGraph)
Async(EAsyncExecution::TaskGraph, []()
{
    // 백그라운드 작업
    UE_LOG(LogTemp, Log, TEXT("Running in background"));
});

// 메인 스레드로 결과 반환
Async(EAsyncExecution::TaskGraph, []() -> int32
{
    // 백그라운드에서 계산
    return ExpensiveCalculation();
})
.Then([](int32 Result)
{
    // 메인 스레드에서 결과 사용
    UE_LOG(LogTemp, Log, TEXT("Result: %d"), Result);
});
```

---

### 2. **TFuture<T> / TPromise<T> - Future 패턴**

**📂 위치:** `Future.h:19`

```cpp
// TFuture: 비동기 작업의 결과를 받는 객체
// TPromise: 비동기 작업이 결과를 설정하는 객체

template<typename ResultType>
class TFuture
{
public:
    // 결과 대기 (블로킹)
    ResultType Get();

    // 완료 여부 확인 (논블로킹)
    bool IsReady() const;

    // 타임아웃과 함께 대기
    bool WaitFor(const FTimespan& Duration) const;

    // 완료 시 콜백 실행
    TFuture<NewType> Then(TFunction<NewType(ResultType)> Continuation);
};

template<typename ResultType>
class TPromise
{
public:
    // 결과 설정 (한 번만 가능)
    void SetValue(const ResultType& Result);
    void SetValue(ResultType&& Result);

    // Future 객체 반환
    TFuture<ResultType> GetFuture();
};
```

---

### 3. **Async() 반환값과 TFuture**

**비동기 작업 시작 및 결과 대기:**
```cpp
// 방법 1: 즉시 결과 대기 (블로킹)
TFuture<int32> Future = Async(EAsyncExecution::ThreadPool, []() -> int32
{
    FPlatformProcess::Sleep(2.0f);  // 긴 작업 시뮬레이션
    return 42;
});

int32 Result = Future.Get();  // 2초 대기 후 42 반환
UE_LOG(LogTemp, Log, TEXT("Result: %d"), Result);

// 방법 2: 논블로킹 체크
TFuture<FString> Future = Async(EAsyncExecution::ThreadPool, []() -> FString
{
    return LoadDataFromServer();
});

// 게임 루프에서 확인
void Tick(float DeltaTime)
{
    if (Future.IsReady())
    {
        FString Data = Future.Get();
        ProcessData(Data);
    }
}
```

---

### 4. **Then() - Continuation (체이닝)**

**연속 작업 구성:**
```cpp
Async(EAsyncExecution::ThreadPool, []() -> FString
{
    // 1단계: 파일 로드
    return LoadFileFromDisk();
})
.Then([](FString FileContent) -> TArray<FString>
{
    // 2단계: 파싱 (여전히 백그라운드)
    return ParseFileContent(FileContent);
})
.Then([](TArray<FString> ParsedData)
{
    // 3단계: 메인 스레드에서 UI 업데이트
    UpdateUI(ParsedData);
});
```

**에러 처리 포함:**
```cpp
Async(EAsyncExecution::ThreadPool, []() -> TOptional<FString>
{
    if (FPaths::FileExists(FilePath))
    {
        return LoadFile(FilePath);
    }
    return {};  // 실패
})
.Then([](TOptional<FString> MaybeContent)
{
    if (MaybeContent.IsSet())
    {
        UE_LOG(LogTemp, Log, TEXT("Loaded: %s"), *MaybeContent.GetValue());
    }
    else
    {
        UE_LOG(LogTemp, Error, TEXT("Failed to load file"));
    }
});
```

---

### 5. **TPromise - 수동 제어**

**Promise로 비동기 작업 수동 완료:**
```cpp
TPromise<int32> Promise;
TFuture<int32> Future = Promise.GetFuture();

// 다른 스레드에서 작업 수행
Async(EAsyncExecution::ThreadPool, [Promise = MoveTemp(Promise)]() mutable
{
    int32 Result = DoHeavyWork();
    Promise.SetValue(Result);  // Promise 완료
});

// 메인 스레드에서 결과 대기
int32 Result = Future.Get();
```

---

### 6. **FAsyncTask / FAutoDeleteAsyncTask - 클래스 기반**

**📂 위치:** `AsyncWork.h:59`

**재사용 가능한 작업 클래스:**
```cpp
// 1. 작업 클래스 정의
class FMyAsyncTask : public FNonAbandonableTask
{
    friend class FAsyncTask<FMyAsyncTask>;

private:
    int32 InputData;
    int32 Result;

public:
    FMyAsyncTask(int32 InData) : InputData(InData), Result(0) {}

    // 필수: 작업 수행
    void DoWork()
    {
        // 긴 작업 수행
        Result = InputData * InputData;
        FPlatformProcess::Sleep(1.0f);
    }

    // 필수: 통계 추적
    FORCEINLINE TStatId GetStatId() const
    {
        RETURN_QUICK_DECLARE_CYCLE_STAT(FMyAsyncTask, STATGROUP_ThreadPoolAsyncTasks);
    }

    int32 GetResult() const { return Result; }
};

// 2. 사용 (수동 삭제)
FAsyncTask<FMyAsyncTask>* Task = new FAsyncTask<FMyAsyncTask>(10);
Task->StartBackgroundTask();

// 대기 및 결과 획득
Task->EnsureCompletion();
int32 Result = Task->GetTask().GetResult();
delete Task;

// 3. 사용 (자동 삭제) - 권장
(new FAutoDeleteAsyncTask<FMyAsyncTask>(10))->StartBackgroundTask();
// 완료 후 자동 삭제, 결과 받을 수 없음
```

**StartSynchronousTask() - 동기 실행:**
```cpp
// 현재 스레드에서 즉시 실행 (디버깅용)
FAsyncTask<FMyAsyncTask> Task(10);
Task.StartSynchronousTask();
int32 Result = Task.GetTask().GetResult();
```

---

## 💡 실전 패턴

### 패턴 1: 파일 로드

```cpp
void LoadAssetAsync(const FString& AssetPath)
{
    Async(EAsyncExecution::ThreadPool, [AssetPath]() -> TArray<uint8>
    {
        // 백그라운드에서 파일 로드
        TArray<uint8> Data;
        FFileHelper::LoadFileToArray(Data, *AssetPath);
        return Data;
    })
    .Then([](TArray<uint8> Data)
    {
        // 메인 스레드에서 텍스처 생성
        UTexture2D* Texture = CreateTextureFromData(Data);
        ApplyTexture(Texture);
    });
}
```

### 패턴 2: 병렬 계산

```cpp
TArray<TFuture<int32>> Futures;

for (int32 i = 0; i < 10; i++)
{
    Futures.Add(Async(EAsyncExecution::TaskGraph, [i]() -> int32
    {
        return ExpensiveCalculation(i);
    }));
}

// 모든 결과 대기
TArray<int32> Results;
for (TFuture<int32>& Future : Futures)
{
    Results.Add(Future.Get());
}

UE_LOG(LogTemp, Log, TEXT("All calculations complete"));
```

### 패턴 3: 네트워크 요청

```cpp
class FHttpAsyncTask : public FNonAbandonableTask
{
    friend class FAutoDeleteAsyncTask<FHttpAsyncTask>;

    FString URL;
    TFunction<void(FString)> Callback;

    FHttpAsyncTask(const FString& InURL, TFunction<void(FString)> InCallback)
        : URL(InURL), Callback(InCallback)
    {}

    void DoWork()
    {
        FString Response = SendHTTPRequest(URL);

        // 메인 스레드로 결과 전달
        AsyncTask(ENamedThreads::GameThread, [Response, Callback = this->Callback]()
        {
            Callback(Response);
        });
    }

    FORCEINLINE TStatId GetStatId() const
    {
        RETURN_QUICK_DECLARE_CYCLE_STAT(FHttpAsyncTask, STATGROUP_ThreadPoolAsyncTasks);
    }
};

// 사용
void FetchData()
{
    (new FAutoDeleteAsyncTask<FHttpAsyncTask>(
        TEXT("https://api.example.com/data"),
        [](FString Response)
        {
            UE_LOG(LogTemp, Log, TEXT("Response: %s"), *Response);
        }
    ))->StartBackgroundTask();
}
```

### 패턴 4: 프로그레스 추적

```cpp
class FProgressAsyncTask : public FNonAbandonableTask
{
    friend class FAsyncTask<FProgressAsyncTask>;

    TAtomic<int32> Progress;
    int32 TotalSteps;

public:
    FProgressAsyncTask(int32 InSteps) : Progress(0), TotalSteps(InSteps) {}

    void DoWork()
    {
        for (int32 i = 0; i < TotalSteps; i++)
        {
            DoStep(i);
            Progress = i + 1;
        }
    }

    float GetProgress() const
    {
        return (float)Progress.Load() / TotalSteps;
    }

    FORCEINLINE TStatId GetStatId() const
    {
        RETURN_QUICK_DECLARE_CYCLE_STAT(FProgressAsyncTask, STATGROUP_ThreadPoolAsyncTasks);
    }
};

// 사용
FAsyncTask<FProgressAsyncTask>* Task = new FAsyncTask<FProgressAsyncTask>(100);
Task->StartBackgroundTask();

// UI에서 프로그레스 표시
void Tick(float DeltaTime)
{
    if (Task && !Task->IsDone())
    {
        float Progress = Task->GetTask().GetProgress();
        UpdateProgressBar(Progress);
    }
    else if (Task && Task->IsDone())
    {
        delete Task;
        Task = nullptr;
    }
}
```

---

## 🔁 TaskGraph vs Async 비교

### 언제 TaskGraph를 사용하나?

```cpp
// TaskGraph: 복잡한 의존성이 필요할 때
FGraphEventRef Task1 = TGraphTask<FTask1>::CreateTask().ConstructAndDispatchWhenReady();
FGraphEventRef Task2 = TGraphTask<FTask2>::CreateTask().ConstructAndDispatchWhenReady();

FGraphEventArray Prerequisites = { Task1, Task2 };
FGraphEventRef Task3 = TGraphTask<FTask3>::CreateTask(&Prerequisites)
    .ConstructAndDispatchWhenReady();

Task3->Wait();
```

### 언제 Async를 사용하나?

```cpp
// Async: 간단한 비동기 작업 + 결과 반환
TFuture<int32> Result = Async(EAsyncExecution::ThreadPool, []()
{
    return LoadAndProcessData();
})
.Then([](int32 ProcessedData)
{
    return ProcessedData * 2;
});

int32 FinalResult = Result.Get();
```

**선택 기준:**

| 특징 | TaskGraph | Async |
|------|----------|-------|
| **사용 편의성** | 낮음 (명시적 클래스) | 높음 (람다) |
| **의존성 관리** | ✅ DAG 지원 | ❌ 체이닝만 |
| **결과 반환** | 수동 (변수 저장) | ✅ TFuture |
| **스레드 제어** | ✅ 세밀함 | 제한적 |
| **적합한 상황** | 복잡한 병렬 처리 | 간단한 비동기 I/O |

---

## 🚀 성능 최적화

### ✅ 해야 할 것

```cpp
// 좋은 예시 1: ThreadPool 사용 (긴 작업)
Async(EAsyncExecution::ThreadPool, []()
{
    LoadLargeFile();  // 수 초 소요
});

// 좋은 예시 2: TaskGraph 사용 (짧은 작업)
Async(EAsyncExecution::TaskGraph, []()
{
    QuickCalculation();  // 밀리초 소요
});

// 좋은 예시 3: 체이닝으로 코드 정리
Async(EAsyncExecution::ThreadPool, []() { return LoadData(); })
    .Then([](Data D) { return ProcessData(D); })
    .Then([](Result R) { DisplayResult(R); });
```

### ❌ 피해야 할 것

```cpp
// 나쁜 예시 1: 짧은 작업에 Thread 사용
Async(EAsyncExecution::Thread, []()
{
    int32 Sum = A + B;  // ❌ 스레드 생성 오버헤드 >> 작업 시간
});
// → TaskGraph 사용

// 나쁜 예시 2: 긴 작업에 TaskGraph 사용
Async(EAsyncExecution::TaskGraph, []()
{
    LoadGiantFile();  // ❌ 워커 스레드 블로킹
});
// → ThreadPool 사용

// 나쁜 예시 3: 메인 스레드 블로킹
TFuture<int32> Future = Async(EAsyncExecution::ThreadPool, []() { return 42; });
int32 Result = Future.Get();  // ❌ 메인 스레드 블로킹!
// → Then() 사용 또는 논블로킹 체크

// 나쁜 예시 4: UObject 접근 (크래시!)
Async(EAsyncExecution::ThreadPool, [this]()
{
    MyActor->DoSomething();  // ❌ UObject는 메인 스레드 전용!
});
// → AsyncTask(ENamedThreads::GameThread, ...) 사용
```

---

## 🐛 일반적인 함정

### 함정 1: 캡처된 포인터 생명주기

```cpp
// ❌ 위험한 코드
void MyFunction()
{
    TArray<int32> LocalData = LoadData();

    Async(EAsyncExecution::ThreadPool, [&LocalData]()  // ❌ 참조 캡처!
    {
        ProcessData(LocalData);  // LocalData는 이미 소멸됨!
    });
}  // LocalData 소멸

// ✅ 올바른 코드
void MyFunction()
{
    TArray<int32> LocalData = LoadData();

    Async(EAsyncExecution::ThreadPool, [LocalData]()  // ✅ 값 캡처
    {
        ProcessData(LocalData);
    });
}
```

### 함정 2: UObject 스레드 안전성

```cpp
// ❌ 위험한 코드
Async(EAsyncExecution::ThreadPool, [this]()
{
    // UObject는 게임 스레드에서만 접근 가능!
    MyComponent->SetRelativeLocation(NewLocation);  // ❌ 크래시!
});

// ✅ 올바른 코드
Async(EAsyncExecution::ThreadPool, [NewLocation]() -> FVector
{
    // 백그라운드에서 계산만 수행
    return CalculateNewPosition(NewLocation);
})
.Then([this](FVector CalculatedPosition)
{
    // 메인 스레드에서 UObject 수정
    MyComponent->SetRelativeLocation(CalculatedPosition);
});
```

### 함정 3: Future 누수

```cpp
// ❌ 나쁜 코드: Future 무시
Async(EAsyncExecution::ThreadPool, []()
{
    DoWork();
});
// Future가 반환되지만 무시됨 → 완료 여부 추적 불가

// ✅ 좋은 코드: Future 저장 또는 완료 대기
TFuture<void> Future = Async(EAsyncExecution::ThreadPool, []()
{
    DoWork();
});

// 나중에 확인
if (Future.IsReady())
{
    // 작업 완료
}
```

---

## 🔗 참조 자료

### 공식 문서
- Unreal Engine Docs: [Asynchronous Asset Loading](https://docs.unrealengine.com/en-US/ProgrammingAndScripting/ProgrammingWithCPP/Assets/AsyncLoading/)

### 소스 코드
- `Engine/Source/Runtime/Core/Public/Async/Async.h` - Async() 함수
- `Engine/Source/Runtime/Core/Public/Async/Future.h` - TFuture/TPromise
- `Engine/Source/Runtime/Core/Public/Async/AsyncWork.h` - FAsyncTask

### 관련 주제
- `UnrealSummary/Core/TaskGraph.md` - 저수준 태스크 시스템
- `UnrealSummary/Core/Multithreading.md` - 스레드 기본 요소
- `UnrealSummary/Core/Delegates.md` - 콜백 패턴

---

> 🔄 Created: 2025-01-XX — Initial documentation for Async System in UE 5.7
