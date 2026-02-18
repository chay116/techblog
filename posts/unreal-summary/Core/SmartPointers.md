---
title: "스마트 포인터 (Smart Pointers)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Core"
tags: ["unreal", "Core"]
---
# 스마트 포인터 (Smart Pointers)

## 🧭 개요

**언리얼 엔진의 스마트 포인터**는 자동 메모리 관리를 제공하는 Core 모듈의 핵심 구성 요소입니다. 참조 카운팅을 통해 메모리 누수를 방지하고 안전한 포인터 관리를 지원합니다.

**핵심 타입:**
- **TSharedRef<T>** - Non-nullable 공유 참조 (항상 유효)
- **TSharedPtr<T>** - Nullable 공유 포인터 (nullptr 가능)
- **TWeakPtr<T>** - 약한 참조 (순환 참조 방지)
- **TUniquePtr<T>** - 독점 소유권 포인터

**주요 특징:**
- 자동 메모리 관리 (참조 카운트 0 시 자동 삭제)
- 스레드 안전 모드 지원 (`ESPMode::ThreadSafe`)
- 약한 참조로 순환 참조 방지
- C++ 포인터와 유사한 직관적 문법
- 타입 캐스팅 지원

**⚠️ 중요한 제한사항:**
- **UObject와 함께 사용 금지!** (UObject는 GC 관리)
- 일반 C++ 객체 전용

**모듈 위치:** `Engine/Source/Runtime/Core/Public/Templates/`

**핵심 파일:**
- `SharedPointer.h` - TSharedRef/TSharedPtr/TWeakPtr
- `UniquePtr.h` - TUniquePtr
- `SharedPointerInternals.h` - 내부 구현

**엔진 버전:** Unreal Engine 5.7 (2025년 기준)

---

## 🧱 구조

### 스마트 포인터 타입 계층

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Unreal Smart Pointer Types                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [공유 소유권 (Shared Ownership)]                                       │
│                                                                         │
│  TSharedRef<T>                   TSharedPtr<T>                          │
│  ┌──────────────────┐            ┌──────────────────┐                  │
│  │  Non-nullable    │            │  Nullable        │                  │
│  │  항상 유효       │            │  nullptr 가능    │                  │
│  │  안전성 최우선   │            │  유연성 높음     │                  │
│  └──────┬───────────┘            └──────┬───────────┘                  │
│         │                               │                              │
│         └───────────┬───────────────────┘                              │
│                     │                                                  │
│                     ↓                                                  │
│         ┌───────────────────────┐                                      │
│         │  Reference Counter    │ (참조 카운트)                         │
│         │  - SharedRefCount     │                                      │
│         │  - WeakRefCount       │                                      │
│         └───────────────────────┘                                      │
│                     ↑                                                  │
│                     │                                                  │
│         ┌───────────┴───────────┐                                      │
│         │                       │                                      │
│  TWeakPtr<T>                    T* (실제 객체)                          │
│  ┌──────────────────┐                                                  │
│  │  약한 참조       │                                                  │
│  │  순환 참조 방지  │                                                  │
│  │  Pin()으로 승격  │                                                  │
│  └──────────────────┘                                                  │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [독점 소유권 (Exclusive Ownership)]                                    │
│                                                                         │
│  TUniquePtr<T>                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  단독 소유권                                                      │  │
│  │  복사 불가, 이동만 가능                                           │  │
│  │  참조 카운터 없음 (오버헤드 최소)                                │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│         │                                                               │
│         ↓                                                               │
│      T* (실제 객체)                                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 참조 카운팅 메커니즘

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   참조 카운팅 (Reference Counting)                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [Reference Controller 구조]                                            │
│                                                                         │
│  TReferenceControllerBase                                               │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  int32 SharedRefCount;    // 공유 참조 카운트                    │  │
│  │  int32 WeakRefCount;      // 약한 참조 카운트                    │  │
│  │                                                                  │  │
│  │  ~TReferenceControllerBase()                                     │  │
│  │  {                                                               │  │
│  │      if (SharedRefCount == 0)                                    │  │
│  │          delete Object;     // 객체 삭제                         │  │
│  │                                                                  │  │
│  │      if (WeakRefCount == 0)                                      │  │
│  │          delete this;       // 컨트롤러 삭제                     │  │
│  │  }                                                               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  [카운트 변화 예시]                                                      │
│                                                                         │
│  1. 객체 생성                                                           │
│     TSharedPtr<Foo> Ptr1 = MakeShared<Foo>();                          │
│     → SharedRefCount = 1, WeakRefCount = 0                             │
│                                                                         │
│  2. 공유 포인터 복사                                                    │
│     TSharedPtr<Foo> Ptr2 = Ptr1;                                       │
│     → SharedRefCount = 2, WeakRefCount = 0                             │
│                                                                         │
│  3. 약한 포인터 생성                                                    │
│     TWeakPtr<Foo> Weak1 = Ptr1;                                        │
│     → SharedRefCount = 2, WeakRefCount = 1                             │
│                                                                         │
│  4. Ptr1 소멸                                                           │
│     Ptr1.Reset();                                                      │
│     → SharedRefCount = 1, WeakRefCount = 1                             │
│                                                                         │
│  5. Ptr2 소멸                                                           │
│     Ptr2.Reset();                                                      │
│     → SharedRefCount = 0 ⟹ 객체 삭제!                                 │
│     → WeakRefCount = 1 (컨트롤러는 유지)                               │
│                                                                         │
│  6. Weak1 소멸                                                          │
│     Weak1.Reset();                                                     │
│     → WeakRefCount = 0 ⟹ 컨트롤러 삭제!                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔬 설계 철학

### 왜 자체 스마트 포인터인가?

**📂 위치:** `Engine/Source/Runtime/Core/Public/Templates/SharedPointer.h:100-112`

```cpp
// ❌ C++ 표준 std::shared_ptr의 한계

#include <memory>

std::shared_ptr<Foo> Ptr = std::make_shared<Foo>();

// 문제점:
// - 스레드 안전 강제 (성능 오버헤드)
// - Non-nullable 타입 없음
// - 언리얼 컨테이너와 통합 불가
// - 예외 처리 의존 (언리얼은 예외 사용 안 함)
// - 플랫폼별 구현 차이
```

```cpp
// ✅ 언리얼 스마트 포인터 - 맞춤 최적화

TSharedRef<Foo> Ptr = MakeShared<Foo>();  // Non-nullable!
TSharedPtr<Foo, ESPMode::ThreadSafe> ThreadSafePtr;  // 선택적 스레드 안전

// 장점:
// - 스레드 안전 선택 가능 (성능 최적화)
// - TSharedRef (Non-nullable) 지원
// - 언리얼 컨테이너와 완벽 통합
// - 예외 없음 (크래시나 로그만)
// - 모든 플랫폼 동일 동작
// - MakeShared 최적화 (할당 1회)
```

### 스마트 포인터 비교

| 특징 | **TSharedRef** | **TSharedPtr** | **TWeakPtr** | **TUniquePtr** |
|------|----------------|----------------|--------------|----------------|
| **Null 가능** | ❌ 불가능 | ✅ 가능 | ✅ 가능 | ✅ 가능 |
| **복사** | ✅ 가능 | ✅ 가능 | ✅ 가능 | ❌ 불가능 (이동만) |
| **참조 카운트** | ✅ 있음 | ✅ 있음 | ✅ 있음 | ❌ 없음 |
| **오버헤드** | 중간 | 중간 | 작음 | 최소 |
| **사용 시나리오** | 항상 유효 보장 | 일반적 공유 | 순환 참조 방지 | 독점 소유 |

---

## 🧩 주요 API

### TSharedRef - Non-nullable 공유 참조

**📂 위치:** `Engine/Source/Runtime/Core/Public/Templates/SharedPointer.h:148`

```cpp
#include "Templates/SharedPointer.h"

// 생성 (항상 유효한 객체 필요)
TSharedRef<FMyClass> Ref1 = MakeShared<FMyClass>();  // 권장
TSharedRef<FMyClass> Ref2 = MakeShareable(new FMyClass());  // 할당 2회

// ❌ 기본 생성자 없음 (nullptr 불가능)
// TSharedRef<FMyClass> Ref3;  // 컴파일 에러!

// 복사
TSharedRef<FMyClass> Ref3 = Ref1;  // 참조 카운트 증가

// 역참조 (항상 안전)
Ref1->DoSomething();
FMyClass& Object = *Ref1;

// nullptr 할당 불가
// Ref1 = nullptr;  // 컴파일 에러!

// Reset() 없음 (항상 유효해야 하므로)

// TSharedPtr로 변환 (암시적)
TSharedPtr<FMyClass> Ptr = Ref1;

// 참조 카운트 확인
int32 RefCount = Ref1.GetSharedReferenceCount();
bool bUnique = Ref1.IsUnique();  // RefCount == 1
```

### TSharedPtr - Nullable 공유 포인터

**📂 위치:** `Engine/Source/Runtime/Core/Public/Templates/SharedPointer.h`

```cpp
// 생성
TSharedPtr<FMyClass> Ptr1;  // nullptr
TSharedPtr<FMyClass> Ptr2 = MakeShared<FMyClass>();
TSharedPtr<FMyClass> Ptr3 = MakeShareable(new FMyClass());

// nullptr 체크
if (Ptr2.IsValid())
{
    Ptr2->DoSomething();
}

// 역참조 (체크 후 사용)
if (Ptr2)
{
    FMyClass& Object = *Ptr2;
}

// nullptr 할당
Ptr2 = nullptr;

// Reset (참조 해제)
Ptr2.Reset();

// 소유권 이전
TSharedPtr<FMyClass> Ptr4 = MoveTemp(Ptr3);  // Ptr3는 nullptr

// 비교
if (Ptr1 == Ptr2) { }
if (Ptr1 != nullptr) { }

// 참조 카운트
int32 RefCount = Ptr2.GetSharedReferenceCount();
bool bUnique = Ptr2.IsUnique();

// Get() - 원시 포인터 가져오기
FMyClass* RawPtr = Ptr2.Get();
```

### TWeakPtr - 약한 참조

**📂 위치:** `Engine/Source/Runtime/Core/Public/Templates/SharedPointer.h`

```cpp
// 생성 (TSharedRef/TSharedPtr에서만)
TSharedPtr<FMyClass> SharedPtr = MakeShared<FMyClass>();
TWeakPtr<FMyClass> WeakPtr = SharedPtr;

// ❌ 직접 생성 불가
// TWeakPtr<FMyClass> Weak = new FMyClass();  // 컴파일 에러

// 유효성 체크
if (WeakPtr.IsValid())
{
    // 아직 살아있음
}

// Pin() - TSharedPtr로 승격
TSharedPtr<FMyClass> Pinned = WeakPtr.Pin();
if (Pinned.IsValid())
{
    // 안전하게 사용
    Pinned->DoSomething();
}

// Reset
WeakPtr.Reset();

// 순환 참조 방지 예시
class FNode
{
public:
    TSharedPtr<FNode> Parent;     // ❌ 순환 참조!
    TWeakPtr<FNode> WeakParent;   // ✅ 약한 참조로 해결
    TArray<TSharedPtr<FNode>> Children;
};

TSharedPtr<FNode> Root = MakeShared<FNode>();
TSharedPtr<FNode> Child = MakeShared<FNode>();
Child->WeakParent = Root;  // 약한 참조
Root->Children.Add(Child);
// Root 소멸 시 Child도 자동 소멸 (순환 참조 없음)
```

### TUniquePtr - 독점 소유권

**📂 위치:** `Engine/Source/Runtime/Core/Public/Templates/UniquePtr.h`

```cpp
#include "Templates/UniquePtr.h"

// 생성
TUniquePtr<FMyClass> Unique1 = MakeUnique<FMyClass>();
TUniquePtr<FMyClass> Unique2(new FMyClass());

// ❌ 복사 불가
// TUniquePtr<FMyClass> Unique3 = Unique1;  // 컴파일 에러!

// ✅ 이동만 가능
TUniquePtr<FMyClass> Unique3 = MoveTemp(Unique1);  // Unique1은 nullptr

// 역참조
Unique3->DoSomething();
FMyClass& Object = *Unique3;

// nullptr 체크
if (Unique3.IsValid())
{
    // 사용
}

// Reset (삭제 및 nullptr)
Unique3.Reset();

// Release (소유권 포기, 수동 삭제 필요)
FMyClass* RawPtr = Unique3.Release();
delete RawPtr;  // 직접 삭제 필요!

// 배열 지원
TUniquePtr<int32[]> Array = MakeUnique<int32[]>(10);
Array[0] = 100;

// Get() - 원시 포인터
FMyClass* Ptr = Unique3.Get();
```

### MakeShared vs MakeShareable

```cpp
// ✅ MakeShared - 권장 (할당 1회)
TSharedPtr<FMyClass> Ptr1 = MakeShared<FMyClass>(Arg1, Arg2);
// 내부: 객체 + Reference Controller를 한 번에 할당

// ⚠️ MakeShareable - 할당 2회
TSharedPtr<FMyClass> Ptr2 = MakeShareable(new FMyClass(Arg1, Arg2));
// 내부: 객체 할당 + Reference Controller 할당 (별도)

// 성능 차이
// MakeShared:     1회 할당 (빠름, 캐시 효율적)
// MakeShareable:  2회 할당 (느림, 캐시 미스 가능)

// 예외: MakeShareable 사용 시나리오
// - 이미 할당된 포인터를 스마트 포인터로 변환
FMyClass* RawPtr = GetSomePointer();
TSharedPtr<FMyClass> Ptr3 = MakeShareable(RawPtr);
```

### TSharedFromThis - this를 TSharedRef로

```cpp
#include "Templates/SharedPointer.h"

// 클래스 선언
class FMyClass : public TSharedFromThis<FMyClass>
{
public:
    void RegisterSelf()
    {
        // this를 TSharedRef로 변환
        TSharedRef<FMyClass> SelfRef = AsShared();

        // 다른 곳에 등록
        GManager->RegisterObject(SelfRef);
    }

    void DoSomethingAsync()
    {
        // 비동기 작업에 안전하게 this 전달
        AsyncTask(ENamedThreads::AnyThread, [Self = AsShared()]()
        {
            // Self는 유효성 보장
            Self->ProcessData();
        });
    }
};

// 사용
TSharedPtr<FMyClass> Obj = MakeShared<FMyClass>();
Obj->RegisterSelf();  // 내부에서 AsShared() 호출
```

### 타입 캐스팅

```cpp
// Static Cast (다운캐스트)
class FBase {};
class FDerived : public FBase {};

TSharedPtr<FBase> BasePtr = MakeShared<FDerived>();
TSharedPtr<FDerived> DerivedPtr = StaticCastSharedPtr<FDerived>(BasePtr);

TSharedRef<FBase> BaseRef = MakeShared<FDerived>();
TSharedRef<FDerived> DerivedRef = StaticCastSharedRef<FDerived>(BaseRef);

// Const Cast
TSharedPtr<const FMyClass> ConstPtr = MakeShared<FMyClass>();
TSharedPtr<FMyClass> MutablePtr = ConstCastSharedPtr<FMyClass>(ConstPtr);
```

---

## 🎯 실전 예시

### 예시 1: 리소스 관리자

```cpp
// 리소스 자동 관리

class FTexture
{
public:
    FTexture(const FString& Path)
    {
        // 텍스처 로드
        UE_LOG(LogTemp, Log, TEXT("Loading: %s"), *Path);
    }

    ~FTexture()
    {
        // 자동 언로드
        UE_LOG(LogTemp, Log, TEXT("Unloading texture"));
    }
};

class FResourceManager
{
    TMap<FString, TSharedPtr<FTexture>> Textures;

public:
    TSharedPtr<FTexture> LoadTexture(const FString& Path)
    {
        // 캐시 확인
        if (TSharedPtr<FTexture>* Found = Textures.Find(Path))
        {
            return *Found;
        }

        // 새로 로드
        TSharedPtr<FTexture> NewTexture = MakeShared<FTexture>(Path);
        Textures.Add(Path, NewTexture);
        return NewTexture;
    }

    void Cleanup()
    {
        // 참조 카운트 1인 텍스처만 제거 (아무도 사용 안 함)
        for (auto It = Textures.CreateIterator(); It; ++It)
        {
            if (It.Value().IsUnique())
            {
                UE_LOG(LogTemp, Log, TEXT("Removing unused: %s"), *It.Key());
                It.RemoveCurrent();
            }
        }
    }
};

// 사용
FResourceManager Manager;
{
    TSharedPtr<FTexture> Tex1 = Manager.LoadTexture(TEXT("A.png"));
    TSharedPtr<FTexture> Tex2 = Manager.LoadTexture(TEXT("A.png"));  // 캐시 히트!
    check(Tex1 == Tex2);  // 같은 인스턴스

    Manager.Cleanup();  // Tex1, Tex2가 사용 중이므로 제거 안 됨
}
// Tex1, Tex2 소멸 → 참조 카운트 0 → 자동 삭제
Manager.Cleanup();  // 이제 제거됨
```

### 예시 2: 순환 참조 방지

```cpp
// 부모-자식 관계

class FWidget : public TSharedFromThis<FWidget>
{
public:
    FString Name;
    TWeakPtr<FWidget> Parent;  // 약한 참조!
    TArray<TSharedPtr<FWidget>> Children;

    void AddChild(TSharedPtr<FWidget> Child)
    {
        Child->Parent = AsShared();  // 약한 참조로 설정
        Children.Add(Child);
    }

    void RemoveFromParent()
    {
        TSharedPtr<FWidget> ParentPtr = Parent.Pin();
        if (ParentPtr.IsValid())
        {
            ParentPtr->Children.Remove(AsShared());
        }
    }
};

// 사용
TSharedPtr<FWidget> Root = MakeShared<FWidget>();
Root->Name = TEXT("Root");

TSharedPtr<FWidget> Child1 = MakeShared<FWidget>();
Child1->Name = TEXT("Child1");

Root->AddChild(Child1);

// Root 소멸 시 Child1도 자동 소멸 (순환 참조 없음)
Root.Reset();  // Child1도 삭제됨
```

### 예시 3: 스레드 안전 스마트 포인터

```cpp
// 멀티스레드 환경

class FSharedData
{
public:
    TArray<int32> Data;
    FCriticalSection DataLock;

    void AddValue(int32 Value)
    {
        FScopeLock Lock(&DataLock);
        Data.Add(Value);
    }
};

// 스레드 안전 스마트 포인터
TSharedPtr<FSharedData, ESPMode::ThreadSafe> SharedData = MakeShared<FSharedData, ESPMode::ThreadSafe>();

// 스레드 1
Async(EAsyncExecution::Thread, [SharedData]()
{
    for (int32 i = 0; i < 1000; ++i)
    {
        SharedData->AddValue(i);
    }
});

// 스레드 2
Async(EAsyncExecution::Thread, [SharedData]()
{
    for (int32 i = 1000; i < 2000; ++i)
    {
        SharedData->AddValue(i);
    }
});

// 참조 카운팅이 스레드 안전하게 작동
```

---

## 💡 최적화 및 팁

### 성능 모범 사례

```cpp
// ✅ 좋음: MakeShared 사용
TSharedPtr<FMyClass> Ptr1 = MakeShared<FMyClass>();  // 할당 1회

// ❌ 나쁨: new + MakeShareable
TSharedPtr<FMyClass> Ptr2 = MakeShareable(new FMyClass());  // 할당 2회

// ✅ 좋음: TSharedRef (nullptr 체크 불필요)
void ProcessData(TSharedRef<FData> Data)
{
    Data->Process();  // 항상 유효
}

// ⚠️ 덜 좋음: TSharedPtr (nullptr 체크 필요)
void ProcessData(TSharedPtr<FData> Data)
{
    if (Data.IsValid())  // 체크 오버헤드
    {
        Data->Process();
    }
}

// ✅ 좋음: Pass by value (참조 카운트 증가)
void Function(TSharedPtr<FData> Data)
{
    // Data 복사, 참조 카운트 +1
}

// ⚠️ 위험: Pass by reference (위험할 수 있음)
void Function(const TSharedPtr<FData>& Data)
{
    // 참조만 전달, 소유권 없음
    // Data가 외부에서 소멸하면 위험!
}

// ✅ 좋음: TWeakPtr::Pin() 최소화
TWeakPtr<FData> Weak = Shared;
if (TSharedPtr<FData> Pinned = Weak.Pin())
{
    // 한 번만 Pin 호출
    Pinned->DoA();
    Pinned->DoB();
}

// ❌ 나쁨: 반복 Pin
TWeakPtr<FData> Weak = Shared;
Weak.Pin()->DoA();  // Pin 1
Weak.Pin()->DoB();  // Pin 2 (오버헤드)
```

### 일반적인 함정

```cpp
// ❌ UObject에 스마트 포인터 사용
TSharedPtr<UMyObject> Ptr = MakeShareable(NewObject<UMyObject>());  // 절대 안 됨!
// UObject는 GC가 관리 → 스마트 포인터와 충돌

// ✅ UObject는 일반 포인터 + UPROPERTY
UPROPERTY()
UMyObject* MyObject;  // GC 관리

// ❌ this를 직접 TSharedPtr로
class FMyClass
{
    void BadFunction()
    {
        TSharedPtr<FMyClass> SelfPtr(this);  // 크래시!
        // 이미 다른 TSharedPtr가 this를 소유 중일 수 있음
    }
};

// ✅ TSharedFromThis 사용
class FMyClass : public TSharedFromThis<FMyClass>
{
    void GoodFunction()
    {
        TSharedRef<FMyClass> SelfRef = AsShared();  // 안전
    }
};

// ❌ 순환 참조
class FA
{
    TSharedPtr<FB> B;
};
class FB
{
    TSharedPtr<FA> A;  // 순환 참조! 메모리 누수
};

// ✅ 약한 참조로 해결
class FB
{
    TWeakPtr<FA> A;  // 약한 참조
};

// ❌ 로컬 변수를 TSharedPtr로
void Function()
{
    FMyClass Local;
    TSharedPtr<FMyClass> Ptr(&Local);  // 크래시!
    // Local은 스택 변수 → delete 불가
}

// ✅ Heap 할당
TSharedPtr<FMyClass> Ptr = MakeShared<FMyClass>();
```

---

## 🔗 참고자료

- [Smart Pointer Library](https://docs.unrealengine.com/smart-pointer-library/)
- [Shared Pointers](https://docs.unrealengine.com/shared-pointers-in-unreal-engine/)
- [SharedPointer.h Source](Engine/Source/Runtime/Core/Public/Templates/SharedPointer.h)
- [UniquePtr.h Source](Engine/Source/Runtime/Core/Public/Templates/UniquePtr.h)

---

> 📅 생성: 2025-10-27 — 스마트 포인터 시스템 문서화 (UE 5.7 검증)
