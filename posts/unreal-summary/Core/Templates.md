---
title: "템플릿 메타프로그래밍 (Template Metaprogramming)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Core"
tags: ["unreal", "Core"]
---
# 템플릿 메타프로그래밍 (Template Metaprogramming)

## 🧭 개요

**언리얼 엔진의 템플릿 시스템**은 컴파일 타임 타입 조작 및 메타프로그래밍을 제공하는 Core 모듈의 핵심 구성 요소입니다. C++ 템플릿을 활용하여 타입 안전성, 제네릭 프로그래밍, 컴파일 타임 최적화를 지원합니다.

**핵심 기능:**
- **Type Traits** - 타입 특성 검사 (TIsPointer, TIsArithmetic 등)
- **Type Transformations** - 타입 변환 (TRemoveReference, TDecay 등)
- **SFINAE** - TEnableIf를 통한 함수 오버로드 제어
- **Function Traits** - 함수 타입 분석 및 조작
- **Template Utilities** - Forward, MoveTemp, Swap 등

**주요 특징:**
- 컴파일 타임 연산 (런타임 오버헤드 0)
- 타입 안전성 보장
- std::와 호환 가능한 API
- 언리얼 컨테이너와 완벽 통합

**모듈 위치:** `Engine/Source/Runtime/Core/Public/Templates/`

**핵심 파일:**
- `EnableIf.h` - SFINAE (TEnableIf)
- `Decay.h` - 타입 감쇄 (TDecay)
- `IsPointer.h`, `IsArithmetic.h` - Type Traits
- `RemoveReference.h`, `RemoveConst.h` - 타입 변환
- `Function.h` - TFunction<> (std::function 대체)
- `Tuple.h` - TTuple<> (std::tuple 대체)

**엔진 버전:** Unreal Engine 5.7 (2025년 기준)

---

## 🧱 구조

### 템플릿 시스템 계층

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  Unreal Template Metaprogramming System                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [Type Traits - 타입 특성 검사]                                         │
│                                                                         │
│  TIsPointer<T>          → T가 포인터인가?                               │
│  TIsReference<T>        → T가 참조인가?                                 │
│  TIsArithmetic<T>       → T가 산술 타입인가? (int, float 등)            │
│  TIsClass<T>            → T가 클래스인가?                               │
│  TIsEnum<T>             → T가 enum인가?                                 │
│  TIsAbstract<T>         → T가 추상 클래스인가?                          │
│  TIsConstructible<T>    → T를 생성할 수 있는가?                         │
│  TIsTriviallyDestructible<T> → T의 소멸자가 trivial한가?               │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [Type Transformations - 타입 변환]                                     │
│                                                                         │
│  TRemoveReference<T&>   → T                                             │
│  TRemoveConst<const T>  → T                                             │
│  TRemovePointer<T*>     → T                                             │
│  TRemoveCV<const volatile T> → T                                        │
│  TDecay<T>              → 참조, const, volatile 모두 제거 + 배열→포인터 │
│  TAddConst<T>           → const T                                       │
│  TAddReference<T>       → T&                                            │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [SFINAE - 함수 오버로드 제어]                                          │
│                                                                         │
│  TEnableIf<Condition, ReturnType>                                       │
│    - Condition == true  → type = ReturnType                             │
│    - Condition == false → type 정의 없음 (컴파일 에러 유발)             │
│                                                                         │
│  사용 예시:                                                             │
│  template<typename T>                                                   │
│  typename TEnableIf<TIsArithmetic<T>::Value, T>::Type                   │
│  Add(T A, T B) { return A + B; }  // 산술 타입만 허용                   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [Utility Templates]                                                    │
│                                                                         │
│  Forward<T>(Arg)        → Perfect forwarding (완벽한 전달)              │
│  MoveTemp(Obj)          → Move semantics (이동 의미론)                  │
│  Swap(A, B)             → 값 교환                                       │
│  DeclVal<T>()           → T 타입의 가상 객체 (컴파일 타임만)            │
│  Invoke(Func, Args...)  → 함수/람다/멤버 함수 통합 호출                 │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [Function Wrappers]                                                    │
│                                                                         │
│  TFunction<ReturnType(Params...)>                                       │
│    - std::function 대체                                                 │
│    - 함수 포인터, 람다, 펑터 저장                                       │
│    - Small Buffer Optimization (SBO)                                    │
│                                                                         │
│  TFunctionRef<ReturnType(Params...)>                                    │
│    - 임시 참조 (복사/이동 불가)                                         │
│    - 오버헤드 최소 (포인터 2개 크기)                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Type Traits 내부 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Type Traits 구현 패턴                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [TIsPointer 예시]                                                      │
│                                                                         │
│  template<typename T>                                                   │
│  struct TIsPointer                                                      │
│  {                                                                      │
│      enum { Value = false };  // 기본값: false                         │
│  };                                                                     │
│                                                                         │
│  // 특수화 (Specialization) - 포인터 타입만 true                        │
│  template<typename T>                                                   │
│  struct TIsPointer<T*>                                                  │
│  {                                                                      │
│      enum { Value = true };                                             │
│  };                                                                     │
│                                                                         │
│  // 사용                                                                │
│  TIsPointer<int>::Value       // false                                  │
│  TIsPointer<int*>::Value      // true                                   │
│  TIsPointer<FMyClass>::Value  // false                                  │
│  TIsPointer<FMyClass*>::Value // true                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔬 설계 철학

### 왜 자체 템플릿 라이브러리인가?

```cpp
// ❌ C++ 표준 <type_traits>의 한계

#include <type_traits>

std::is_pointer<int*>::value  // C++11
std::is_pointer_v<int*>        // C++17 (일부 플랫폼 불가)

// 문제점:
// - C++11/14/17/20 버전별 차이
// - 플랫폼별 구현 차이
// - 언리얼 코딩 스타일과 불일치
// - 일부 구형 컴파일러 미지원
```

```cpp
// ✅ 언리얼 템플릿 - 일관성 및 확장성

TIsPointer<int*>::Value  // 모든 플랫폼 동일

// 장점:
// - 모든 플랫폼 동일한 API
// - 언리얼 코딩 스타일 일치 (PascalCase, ::Value)
// - 구형 컴파일러 지원
// - 커스텀 확장 가능
// - std::와 호환 (내부적으로 std:: 활용)
```

---

## 🧩 주요 API

### Type Traits - 타입 특성 검사

```cpp
#include "Templates/IsPointer.h"
#include "Templates/IsArithmetic.h"
#include "Templates/IsClass.h"

// 포인터 여부
static_assert(TIsPointer<int*>::Value == true, "");
static_assert(TIsPointer<int>::Value == false, "");

// 산술 타입 여부 (int, float, double 등)
static_assert(TIsArithmetic<int>::Value == true, "");
static_assert(TIsArithmetic<float>::Value == true, "");
static_assert(TIsArithmetic<FString>::Value == false, "");

// 클래스 여부
static_assert(TIsClass<FString>::Value == true, "");
static_assert(TIsClass<int>::Value == false, "");

// 참조 여부
static_assert(TIsLValueReference<int&>::Value == true, "");
static_assert(TIsRValueReference<int&&>::Value == true, "");

// enum 여부
enum EMyEnum { A, B, C };
static_assert(TIsEnum<EMyEnum>::Value == true, "");

// 추상 클래스 여부
class FAbstract { virtual void Func() = 0; };
static_assert(TIsAbstract<FAbstract>::Value == true, "");

// 생성 가능 여부
static_assert(TIsConstructible<FString>::Value == true, "");
static_assert(TIsConstructible<FAbstract>::Value == false, "");

// Trivial 여부 (POD)
static_assert(TIsTriviallyDestructible<int>::Value == true, "");
static_assert(TIsTriviallyDestructible<FString>::Value == false, "");
```

### Type Transformations - 타입 변환

**📂 위치:** `Engine/Source/Runtime/Core/Public/Templates/Decay.h:41`

```cpp
#include "Templates/RemoveReference.h"
#include "Templates/RemoveConst.h"
#include "Templates/Decay.h"

// 참조 제거
using Type1 = TRemoveReference<int&>::Type;    // int
using Type2 = TRemoveReference<int&&>::Type;   // int
using Type3 = TRemoveReference<int>::Type;     // int

// const 제거
using Type4 = TRemoveConst<const int>::Type;   // int
using Type5 = TRemoveConst<int>::Type;         // int

// 포인터 제거
using Type6 = TRemovePointer<int*>::Type;      // int
using Type7 = TRemovePointer<int**>::Type;     // int*

// Decay (감쇄)
using Type8 = TDecay<int&>::Type;              // int
using Type9 = TDecay<const int>::Type;         // int
using Type10 = TDecay<int[]>::Type;            // int*
using Type11 = TDecay<int(float)>::Type;       // int(*)(float)

// 타입 추가
using Type12 = TAddConst<int>::Type;           // const int
using Type13 = TAddReference<int>::Type;       // int&

// 조건부 타입
using Type14 = TChooseClass<true, int, float>::Result;   // int
using Type15 = TChooseClass<false, int, float>::Result;  // float
```

### TEnableIf - SFINAE (컴파일 타임 함수 선택)

**📂 위치:** `Engine/Source/Runtime/Core/Public/Templates/EnableIf.h:18`

```cpp
#include "Templates/EnableIf.h"
#include "Templates/IsArithmetic.h"

// 산술 타입만 허용하는 Add 함수
template<typename T>
typename TEnableIf<TIsArithmetic<T>::Value, T>::Type
Add(T A, T B)
{
    return A + B;
}

// 사용
int Result1 = Add(10, 20);      // OK: int는 산술 타입
float Result2 = Add(1.0f, 2.0f); // OK: float는 산술 타입
// Add(FString("A"), FString("B"));  // 컴파일 에러! FString은 산술 타입 아님

// 포인터 타입만 허용
template<typename T>
typename TEnableIf<TIsPointer<T>::Value, void>::Type
DeletePointer(T Ptr)
{
    delete Ptr;
}

// 클래스 타입만 허용
template<typename T>
typename TEnableIf<TIsClass<T>::Value, int>::Type
GetClassSize()
{
    return sizeof(T);
}

// 복잡한 조건
template<typename T>
typename TEnableIf<
    TIsArithmetic<T>::Value && !TIsPointer<T>::Value,
    T
>::Type
SafeAdd(T A, T B)
{
    return A + B;
}
```

### Forward & MoveTemp - Perfect Forwarding & Move Semantics

```cpp
#include "Templates/UnrealTemplate.h"

// Perfect Forwarding (완벽한 전달)
template<typename T>
void Wrapper(T&& Arg)
{
    ActualFunction(Forward<T>(Arg));  // Arg의 lvalue/rvalue 속성 유지
}

// Move Semantics (이동 의미론)
FString Source = TEXT("Hello");
FString Dest = MoveTemp(Source);  // Source는 이동 후 비어있음

// 실전 예시: 컨테이너에 이동
TArray<FString> Array;
FString Str = TEXT("Large String...");
Array.Add(MoveTemp(Str));  // 복사 없이 이동 (빠름!)

// Swap (교환)
int A = 10, B = 20;
Swap(A, B);  // A = 20, B = 10

// 배열 요소 교환
TArray<int> Arr = {1, 2, 3, 4, 5};
Swap(Arr[0], Arr[4]);  // {5, 2, 3, 4, 1}
```

### TFunction - 함수 래퍼

```cpp
#include "Templates/Function.h"

// 함수 포인터 저장
TFunction<int(int, int)> Func1 = [](int A, int B) { return A + B; };
int Result1 = Func1(10, 20);  // 30

// 멤버 함수 저장
class FCalculator
{
public:
    int Add(int A, int B) { return A + B; }
};

FCalculator Calc;
TFunction<int(int, int)> Func2 = [&Calc](int A, int B) {
    return Calc.Add(A, B);
};

// 콜백으로 사용
void ProcessData(TFunction<void(int)> Callback)
{
    for (int i = 0; i < 10; ++i)
    {
        Callback(i);
    }
}

ProcessData([](int Value) {
    UE_LOG(LogTemp, Log, TEXT("Value: %d"), Value);
});

// nullptr 체크
TFunction<void()> Func3;
if (Func3)  // false
{
    Func3();
}

// Reset
Func3 = []() { UE_LOG(LogTemp, Log, TEXT("Called")); };
Func3();  // "Called"
Func3 = nullptr;
```

### TFunctionRef - 경량 함수 참조

```cpp
#include "Templates/Function.h"

// TFunctionRef는 복사/이동 불가, 임시 참조만
void ProcessItems(const TArray<int>& Items, TFunctionRef<void(int)> Callback)
{
    for (int Item : Items)
    {
        Callback(Item);
    }
}

// 사용
TArray<int> Items = {1, 2, 3, 4, 5};
ProcessItems(Items, [](int Value) {
    UE_LOG(LogTemp, Log, TEXT("%d"), Value);
});

// TFunction vs TFunctionRef
// TFunction:    복사 가능, 저장 가능, 오버헤드 있음
// TFunctionRef: 복사 불가, 임시만, 오버헤드 최소
```

### Invoke - 통합 호출

```cpp
#include "Templates/Invoke.h"

// 일반 함수
int Add(int A, int B) { return A + B; }
int Result1 = Invoke(Add, 10, 20);  // 30

// 멤버 함수
class FMyClass
{
public:
    int Add(int A, int B) { return A + B; }
};

FMyClass Obj;
int Result2 = Invoke(&FMyClass::Add, &Obj, 10, 20);  // 30

// 람다
auto Lambda = [](int A, int B) { return A + B; };
int Result3 = Invoke(Lambda, 10, 20);  // 30

// 펑터
struct FFunctor
{
    int operator()(int A, int B) { return A + B; }
};

FFunctor Functor;
int Result4 = Invoke(Functor, 10, 20);  // 30
```

---

## 🎯 실전 예시

### 예시 1: 타입 안전 컨테이너

```cpp
// 산술 타입만 허용하는 배열
template<typename T>
class TArithmeticArray
{
    static_assert(TIsArithmetic<T>::Value, "T must be arithmetic type");

    TArray<T> Data;

public:
    void Add(T Value) { Data.Add(Value); }
    T Sum() const
    {
        T Total = 0;
        for (T Value : Data)
            Total += Value;
        return Total;
    }
};

// 사용
TArithmeticArray<int> IntArray;     // OK
TArithmeticArray<float> FloatArray; // OK
// TArithmeticArray<FString> StrArray;  // 컴파일 에러!
```

### 예시 2: 타입별 특화 처리

```cpp
// 기본 구현
template<typename T>
void Print(const T& Value)
{
    UE_LOG(LogTemp, Log, TEXT("Generic: %s"), *LexToString(Value));
}

// 포인터 특화
template<typename T>
typename TEnableIf<TIsPointer<T>::Value, void>::Type
Print(T Ptr)
{
    if (Ptr)
    {
        UE_LOG(LogTemp, Log, TEXT("Pointer: 0x%p"), Ptr);
    }
    else
    {
        UE_LOG(LogTemp, Log, TEXT("Pointer: nullptr"));
    }
}

// 산술 타입 특화
template<typename T>
typename TEnableIf<TIsArithmetic<T>::Value, void>::Type
Print(T Value)
{
    UE_LOG(LogTemp, Log, TEXT("Number: %f"), (double)Value);
}

// 사용
Print(42);           // "Number: 42.000000"
Print(3.14f);        // "Number: 3.140000"
int* Ptr = nullptr;
Print(Ptr);          // "Pointer: nullptr"
Print(FString("Hi")); // "Generic: Hi"
```

### 예시 3: 컴파일 타임 타입 선택

```cpp
// 조건에 따라 다른 타입 선택
template<int Size>
struct TIntegerSelector
{
    using Type = typename TChooseClass<
        Size <= 1, int8,
        typename TChooseClass<
            Size <= 2, int16,
            typename TChooseClass<
                Size <= 4, int32,
                int64
            >::Result
        >::Result
    >::Result;
};

// 사용
using SmallInt = TIntegerSelector<1>::Type;   // int8
using MediumInt = TIntegerSelector<2>::Type;  // int16
using LargeInt = TIntegerSelector<4>::Type;   // int32
using HugeInt = TIntegerSelector<8>::Type;    // int64

// 자동으로 적절한 크기의 정수 타입 선택
template<int Size>
class TCompactArray
{
    using IndexType = typename TIntegerSelector<Size>::Type;
    TArray<IndexType> Indices;

public:
    void AddIndex(IndexType Index) { Indices.Add(Index); }
};
```

### 예시 4: Move Semantics로 성능 최적화

```cpp
// 리소스 클래스
class FHeavyResource
{
    TArray<uint8> Data;  // 대용량 데이터

public:
    FHeavyResource()
    {
        Data.SetNum(1024 * 1024);  // 1 MB
        UE_LOG(LogTemp, Log, TEXT("Resource created"));
    }

    ~FHeavyResource()
    {
        UE_LOG(LogTemp, Log, TEXT("Resource destroyed"));
    }

    // 복사 생성자 (비용 높음)
    FHeavyResource(const FHeavyResource& Other)
        : Data(Other.Data)
    {
        UE_LOG(LogTemp, Log, TEXT("Resource copied"));
    }

    // 이동 생성자 (비용 낮음)
    FHeavyResource(FHeavyResource&& Other)
        : Data(MoveTemp(Other.Data))
    {
        UE_LOG(LogTemp, Log, TEXT("Resource moved"));
    }
};

// ❌ 나쁜 예: 복사 발생
FHeavyResource CreateResource1()
{
    FHeavyResource Res;
    return Res;  // 복사!
}

FHeavyResource Res1 = CreateResource1();  // "Resource copied"

// ✅ 좋은 예: 이동 발생
FHeavyResource CreateResource2()
{
    FHeavyResource Res;
    return MoveTemp(Res);  // 이동!
}

FHeavyResource Res2 = CreateResource2();  // "Resource moved"
```

### 예시 5: TFunction 콜백 시스템

```cpp
// 이벤트 시스템
class FEventSystem
{
    TMap<FString, TArray<TFunction<void(int)>>> Listeners;

public:
    void Subscribe(const FString& EventName, TFunction<void(int)> Callback)
    {
        Listeners.FindOrAdd(EventName).Add(MoveTemp(Callback));
    }

    void Trigger(const FString& EventName, int Value)
    {
        if (TArray<TFunction<void(int)>>* Found = Listeners.Find(EventName))
        {
            for (auto& Callback : *Found)
            {
                Callback(Value);
            }
        }
    }
};

// 사용
FEventSystem EventSystem;

// 리스너 등록
EventSystem.Subscribe(TEXT("OnScoreChanged"), [](int NewScore) {
    UE_LOG(LogTemp, Log, TEXT("Score: %d"), NewScore);
});

EventSystem.Subscribe(TEXT("OnScoreChanged"), [](int NewScore) {
    if (NewScore > 100)
    {
        UE_LOG(LogTemp, Warning, TEXT("High score!"));
    }
});

// 이벤트 발생
EventSystem.Trigger(TEXT("OnScoreChanged"), 150);
// 출력:
// "Score: 150"
// "High score!"
```

---

## 💡 최적화 및 팁

### 성능 모범 사례

```cpp
// ✅ 좋음: 컴파일 타임 분기 (런타임 비용 0)
template<typename T>
void Process(const T& Value)
{
    if constexpr (TIsArithmetic<T>::Value)
    {
        // 산술 타입 처리 (컴파일 타임 선택)
        DoFastPath(Value);
    }
    else
    {
        // 기타 타입 처리
        DoSlowPath(Value);
    }
}

// ❌ 나쁨: 런타임 분기 (오버헤드)
template<typename T>
void Process(const T& Value)
{
    if (TIsArithmetic<T>::Value)  // 런타임 체크 (불필요)
    {
        DoFastPath(Value);
    }
}

// ✅ 좋음: MoveTemp 사용
TArray<FString> Source = GetLargeArray();
TArray<FString> Dest = MoveTemp(Source);  // 이동 (빠름)

// ❌ 나쁨: 복사
TArray<FString> Dest2 = Source;  // 복사 (느림)

// ✅ 좋음: Perfect Forwarding
template<typename T>
void Wrapper(T&& Arg)
{
    Target(Forward<T>(Arg));  // lvalue/rvalue 속성 유지
}

// ❌ 나쁨: 복사 발생
template<typename T>
void Wrapper(T Arg)  // 복사!
{
    Target(Arg);
}

// ✅ 좋음: TFunctionRef (임시 콜백)
void ProcessSync(TFunctionRef<void(int)> Callback)
{
    Callback(42);  // 즉시 호출
}

// ⚠️ 위험: TFunction 저장 후 호출
TFunction<void(int)> StoredCallback;
void ProcessAsync(TFunction<void(int)> Callback)
{
    StoredCallback = MoveTemp(Callback);  // 저장 (안전)
}
```

### 일반적인 함정

```cpp
// ❌ TEnableIf 오용
template<typename T>
TEnableIf<TIsArithmetic<T>::Value, T>::Type  // 틀림! (typename 누락)
Add(T A, T B)
{
    return A + B;
}

// ✅ 올바름
template<typename T>
typename TEnableIf<TIsArithmetic<T>::Value, T>::Type  // typename 필수
Add(T A, T B)
{
    return A + B;
}

// ❌ MoveTemp 후 재사용
FString Str = TEXT("Hello");
ProcessA(MoveTemp(Str));
ProcessB(Str);  // 위험! Str은 이동 후 비어있음

// ✅ 올바름
FString Str = TEXT("Hello");
ProcessA(Str);  // 복사 전달
ProcessB(Str);  // 안전

// ❌ TFunctionRef 저장
TFunctionRef<void()> StoredRef;
void StoreCallback(TFunctionRef<void()> Callback)
{
    StoredRef = Callback;  // 위험! 참조만 저장
}

// ✅ TFunction 사용
TFunction<void()> StoredFunc;
void StoreCallback(TFunction<void()> Callback)
{
    StoredFunc = MoveTemp(Callback);  // 안전
}

// ❌ Forward 없이 전달
template<typename T>
void Wrapper(T&& Arg)
{
    Target(Arg);  // lvalue로 전달됨 (rvalue 속성 손실)
}

// ✅ Forward 사용
template<typename T>
void Wrapper(T&& Arg)
{
    Target(Forward<T>(Arg));  // 속성 유지
}
```

---

## 🔗 참고자료

- [C++ Template Metaprogramming](https://en.cppreference.com/w/cpp/language/templates)
- [SFINAE](https://en.cppreference.com/w/cpp/language/sfinae)
- [Templates Directory](Engine/Source/Runtime/Core/Public/Templates/)
- [EnableIf.h Source](Engine/Source/Runtime/Core/Public/Templates/EnableIf.h)
- [Decay.h Source](Engine/Source/Runtime/Core/Public/Templates/Decay.h)

---

> 📅 생성: 2025-10-27 — 템플릿 메타프로그래밍 시스템 문서화 (UE 5.7 검증)
