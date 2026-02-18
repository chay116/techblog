---
title: "언리얼 리플렉션 시스템 (Unreal Reflection System)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "CoreUObject"
tags: ["unreal", "CoreUObject"]
---
# 언리얼 리플렉션 시스템 (Unreal Reflection System)

## 🧭 개요

**언리얼 리플렉션 시스템** (또는 **언리얼 헤더 툴 (Unreal Header Tool, UHT)**이라고도 함)은 언리얼 엔진의 런타임 타입 정보(RTTI) 시스템입니다. C++의 제한적인 RTTI를 확장하여 강력한 메타프로그래밍 기능을 제공합니다.

**핵심 기능:**
- **타입 인트로스펙션 (Type Introspection)** - 런타임에 클래스 계층, 프로퍼티, 함수를 쿼리
- **프로퍼티 메타데이터 (Property Metadata)** - 객체 프로퍼티를 일반적인 방법으로 접근, 수정 및 직렬화
- **블루프린트 통합 (Blueprint Integration)** - C++ 클래스/함수/프로퍼티를 비주얼 스크립팅에 노출
- **직렬화 (Serialization)** - 수동 직렬화 코드 없이 자동 저장/로드
- **네트워킹 (Networking)** - 자동 프로퍼티 리플리케이션
- **가비지 컬렉션 (Garbage Collection)** - 자동 메모리 관리를 위한 객체 참조 추적
- **에디터 통합 (Editor Integration)** - 자동 프로퍼티 편집 UI, 디테일 패널, 툴팁
- **핫 리로드 (Hot Reload)** - 라이브 C++ 리컴파일 지원

**작동 방식:**
1. **언리얼 헤더 툴 (Unreal Header Tool, UHT)**이 컴파일 전에 C++ 헤더 파일을 파싱
2. 리플렉션 메타데이터가 포함된 `.generated.h` 파일 생성
3. `UCLASS()`, `UPROPERTY()`, `UFUNCTION()` 같은 매크로가 리플렉션을 위한 타입을 표시
4. 런타임에서 `UClass`, `FProperty`, `UFunction` 객체를 통해 메타데이터에 접근

**핵심 원칙:** 리플렉션은 매크로를 통해 **옵트인(opt-in)** 방식이며, 클래스 선언에 `GENERATED_BODY()`가 필요합니다.

**모듈 위치:** `Engine/Source/Runtime/CoreUObject/Public/UObject/`

**핵심 파일:**
- `Class.h` - UClass, UStruct, UFunction 정의
- `UnrealType.h` - FProperty 계층 구조
- `Field.h` - UField 기본 클래스
- `ObjectMacros.h` - UCLASS, UPROPERTY, UFUNCTION 매크로

**엔진 버전:** Unreal Engine 5.6.1 (2025년 기준)

---

## 🧱 구조

### 리플렉션 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Unreal Reflection System                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [1] 컴파일 타임 - UHT (Unreal Header Tool)                             │
│                                                                         │
│   C++ 소스 코드                                                          │
│   ┌──────────────────────────────────────┐                            │
│   │ UCLASS()                             │                            │
│   │ class UMyObject : public UObject     │                            │
│   │ {                                    │                            │
│   │     GENERATED_BODY()                 │                            │
│   │                                      │                            │
│   │     UPROPERTY()                      │                            │
│   │     int32 Health;                    │                            │
│   │                                      │                            │
│   │     UFUNCTION()                      │                            │
│   │     void TakeDamage(float Amount);   │                            │
│   │ };                                   │                            │
│   └──────────────────────────────────────┘                            │
│                     ↓                                                  │
│   UnrealBuildTool (UBT) 호출                                            │
│                     ↓                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  Unreal Header Tool (UHT)            │                            │
│   │  - C++ 파서 (Custom parser)          │                            │
│   │  - 매크로 인식 (UCLASS, UPROPERTY)    │                            │
│   │  - 메타데이터 추출                    │                            │
│   └──────────────────────────────────────┘                            │
│                     ↓                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  생성된 코드                          │                            │
│   │  - MyObject.generated.h              │                            │
│   │  - MyObject.gen.cpp                  │                            │
│   └──────────────────────────────────────┘                            │
│                     ↓                                                  │
│   C++ 컴파일러 (MSVC/Clang)                                             │
│                     ↓                                                  │
│   실행 파일 (.exe/.dll)                                                 │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [2] 런타임 - 리플렉션 데이터 접근                                       │
│                                                                         │
│   ┌──────────────────────────────────────┐                            │
│   │  UClass* MyClass = UMyObject::StaticClass();                      │
│   │                                      │                            │
│   │  // 프로퍼티 순회                     │                            │
│   │  for (FProperty* Prop : MyClass)     │                            │
│   │                                      │                            │
│   │  // 함수 호출                         │                            │
│   │  MyClass->ProcessEvent(Func, Params) │                            │
│   └──────────────────────────────────────┘                            │
│                     ↓                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  엔진 시스템 활용                     │                            │
│   │  - 가비지 컬렉션 (GC)                 │                            │
│   │  - 직렬화 (Serialization)            │                            │
│   │  - 네트워킹 (Networking)              │                            │
│   │  - 블루프린트 VM (Blueprint)          │                            │
│   │  - 에디터 (Editor)                   │                            │
│   └──────────────────────────────────────┘                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 핵심 리플렉션 타입 계층 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            UObject                                      │
│  (모든 언리얼 오브젝트의 기본 클래스)                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                 ▲
                                 │ 상속
                                 │
┌─────────────────────────────────────────────────────────────────────────┐
│                            UField                                       │
│  (리플렉션 데이터 오브젝트의 기본 클래스)                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - UField* Next                  // 링크드 리스트                      │
│                                                                         │
│  Public:                                                                │
│    + AddCppProperty()              // C++ 프로퍼티 추가                  │
│    + Bind()                        // 네이티브 함수 바인딩               │
│    + GetOwnerClass() : UClass*     // 소유자 클래스                      │
│    + GetOwnerStruct() : UStruct*   // 소유자 구조체                      │
│    + GetAuthoredName() : FString   // 원본 이름                         │
│    + GetMetaData(Key) : FString    // 메타데이터 접근                    │
└─────────────────────────────────────────────────────────────────────────┘
                                 ▲
                ┌────────────────┼────────────────┐
                │                │                │
    ┌───────────┴───────┐  ┌────┴────┐    ┌─────┴─────┐
    │     UStruct       │  │ UEnum   │    │ (기타)     │
    │  (구조체/클래스)   │  │(열거형) │    │           │
    └───────────────────┘  └─────────┘    └───────────┘
                │
        ┌───────┴───────┐
        │               │
   ┌────┴────┐    ┌────┴──────┐
   │ UClass  │    │UScriptStruct│
   │(클래스) │    │ (순수 구조체)│
   └─────────┘    └────────────┘


┌─────────────────────────────────────────────────────────────────────────┐
│                          FProperty                                      │
│  (모든 프로퍼티 메타데이터의 기본 클래스)                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  📂 위치: CoreUObject/Public/UObject/UnrealType.h:180                    │
│                                                                         │
│  Private:                                                               │
│    - int32 ArrayDim                // 배열 크기                          │
│    - int32 ElementSize             // 요소 크기                          │
│    - EPropertyFlags PropertyFlags  // 프로퍼티 플래그                    │
│    - uint16 RepIndex               // 리플리케이션 인덱스                │
│                                                                         │
│  Public:                                                                │
│    + GetOffset_ForInternal() : int32  // 오프셋                         │
│    + GetSize() : int32             // 크기                              │
│    + ContainerPtrToValuePtr<T>()   // 값 포인터 변환                     │
│    + GetPropertyValue() : T        // 값 가져오기                        │
│    + SetPropertyValue(T)           // 값 설정                           │
│    + ExportTextItem()              // 텍스트로 내보내기                  │
│    + ImportText()                  // 텍스트에서 가져오기                │
│    + SerializeItem()               // 직렬화                            │
│    + CopyCompleteValue()           // 값 복사                           │
└─────────────────────────────────────────────────────────────────────────┘
                                 ▲
                ┌────────────────┼──────────────────────┐
                │                │                      │
   ┌────────────┴────────┐  ┌───┴────────┐   ┌────────┴─────────┐
   │  FNumericProperty   │  │FBoolProperty│   │ FStrProperty     │
   │  (숫자 프로퍼티)     │  │(불리언)     │   │ (FString)        │
   └─────────────────────┘  └────────────┘   └──────────────────┘
                │
        ┌───────┴────────┬──────────────┐
        │                │              │
   ┌────┴─────┐   ┌─────┴──────┐  ┌───┴──────┐
   │FIntProperty│  │FFloatProperty│ │FByteProperty│
   │  (int32)   │  │  (float)     │ │ (uint8/enum) │
   └────────────┘  └──────────────┘ └──────────────┘


┌─────────────────────────────────────────────────────────────────────────┐
│                       FObjectProperty                                   │
│  (UObject 포인터 프로퍼티)                                                │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - UClass* PropertyClass         // 프로퍼티 타입                      │
│                                                                         │
│  Public:                                                                │
│    + GetObjectPropertyValue() : UObject*  // 오브젝트 가져오기           │
│    + SetObjectPropertyValue(UObject*)     // 오브젝트 설정               │
└─────────────────────────────────────────────────────────────────────────┘
                                 ▲
                ┌────────────────┼──────────────────────┐
                │                │                      │
   ┌────────────┴────────┐  ┌───┴────────┐   ┌────────┴─────────┐
   │FObjectPtrProperty   │  │FClassProperty│  │FSoftObjectProperty│
   │ (TObjectPtr<T>)     │  │(UClass*)     │  │(TSoftObjectPtr<>)│
   └─────────────────────┘  └─────────────┘   └──────────────────┘


┌─────────────────────────────────────────────────────────────────────────┐
│                      컨테이너 프로퍼티                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  FArrayProperty                    FMapProperty                        │
│  ┌──────────────────┐             ┌──────────────────┐                │
│  │ TArray<T>        │             │ TMap<K, V>       │                │
│  ├──────────────────┤             ├──────────────────┤                │
│  │ - Inner: FProperty│            │ - KeyProp        │                │
│  └──────────────────┘             │ - ValueProp      │                │
│                                    └──────────────────┘                │
│                                                                         │
│  FSetProperty                      FStructProperty                     │
│  ┌──────────────────┐             ┌──────────────────┐                │
│  │ TSet<T>          │             │ FMyStruct        │                │
│  ├──────────────────┤             ├──────────────────┤                │
│  │ - ElementProp    │             │ - Struct: UScriptStruct            │
│  └──────────────────┘             └──────────────────┘                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### UHT 워크플로우 (컴파일 타임 프로세스)

```
[1] 소스 코드 작성
    │
    │   MyObject.h
    │   ───────────────────────────────
    │   UCLASS()
    │   class UMyObject : public UObject
    │   {
    │       GENERATED_BODY()
    │
    │       UPROPERTY()
    │       int32 Health;
    │
    │       UFUNCTION(BlueprintCallable)
    │       void TakeDamage(float Amount);
    │   };
    │
    ↓

[2] UnrealBuildTool (UBT) 실행
    │
    │   - .uproject 파일 파싱
    │   - 모듈 의존성 분석
    │   - UCLASS/UPROPERTY/UFUNCTION 포함 헤더 검색
    │
    ↓

[3] Unreal Header Tool (UHT) 호출
    │
    │   UHT 실행:
    │   ┌────────────────────────────────────┐
    │   │ 1. MyObject.h 파싱                 │
    │   │    - UCLASS() 매크로 인식          │
    │   │    - UPROPERTY() 매크로 인식       │
    │   │    - UFUNCTION() 매크로 인식       │
    │   │                                    │
    │   │ 2. 메타데이터 추출                 │
    │   │    - 클래스 이름: "UMyObject"      │
    │   │    - 프로퍼티: "Health", int32     │
    │   │    - 함수: "TakeDamage", float     │
    │   │    - 지정자: BlueprintCallable     │
    │   │                                    │
    │   │ 3. 코드 생성                       │
    │   │    - MyObject.generated.h          │
    │   │    - MyObject.gen.cpp              │
    │   └────────────────────────────────────┘
    │
    ↓

[4] 생성된 코드

    MyObject.generated.h
    ───────────────────────────────
    // GENERATED_BODY() 확장
    #define MyObject_Generated_Body() \
    public: \
        static UClass* StaticClass(); \
        void GetLifetimeReplicatedProps(...) const; \
    private: \
        static void StaticRegisterNativesUMyObject(); \
        friend struct Z_Construct_UClass_UMyObject_Statics;

    MyObject.gen.cpp
    ───────────────────────────────
    // 프로퍼티 메타데이터
    static FIntProperty* NewProp_Health = new FIntProperty(
        FObjectInitializer(),
        EC_InternalUseOnlyConstructor,
        UMyObject::StaticClass(),
        TEXT("Health"),
        STRUCT_OFFSET(UMyObject, Health),
        EPropertyFlags::CPF_None,
        0x0000000000000001
    );

    // 함수 메타데이터
    static UFunction* NewFunc_TakeDamage = ...;

    // UClass 생성 함수
    UClass* Z_Construct_UClass_UMyObject()
    {
        static UClass* Class = nullptr;
        if (!Class)
        {
            Class = new UClass(...);
            Class->AddProperty(NewProp_Health);
            Class->AddFunction(NewFunc_TakeDamage);
            Class->StaticLink();
        }
        return Class;
    }

    // StaticClass() 구현
    UClass* UMyObject::StaticClass()
    {
        return Z_Construct_UClass_UMyObject();
    }
    │
    ↓

[5] C++ 컴파일러 실행
    │
    │   - MSVC/Clang 컴파일러
    │   - MyObject.h + MyObject.generated.h 컴파일
    │   - MyObject.cpp + MyObject.gen.cpp 컴파일
    │
    ↓

[6] 링킹
    │
    │   - 실행 파일 (.exe/.dll) 생성
    │   - 리플렉션 메타데이터 포함
    │
    ↓

[7] 런타임
    │
    │   엔진 시작 시:
    │   ┌────────────────────────────────────┐
    │   │ 1. StaticRegisterNatives() 호출    │
    │   │    - UClass 등록                   │
    │   │    - FProperty 등록                │
    │   │    - UFunction 등록                │
    │   │                                    │
    │   │ 2. CDO (Class Default Object) 생성 │
    │   │    - GetMutableDefault<UMyObject>()│
    │   │                                    │
    │   │ 3. 블루프린트 바인딩               │
    │   │    - BlueprintCallable 노출        │
    │   └────────────────────────────────────┘
    │
    ↓

[8] 리플렉션 활용
    │
    │   런타임 코드:
    │   ───────────────────────────────
    │   UClass* Class = UMyObject::StaticClass();
    │
    │   // 프로퍼티 접근
    │   FProperty* Prop = Class->FindPropertyByName("Health");
    │   int32 Health = Prop->GetPropertyValue(...);
    │
    │   // 함수 호출
    │   UFunction* Func = Class->FindFunctionByName("TakeDamage");
    │   Object->ProcessEvent(Func, &Params);
    │
    │   // GC 추적
    │   for (FProperty* Prop : Class->GetProperties())
    │   {
    │       if (FObjectProperty* ObjProp = Cast<FObjectProperty>(Prop))
    │       {
    │           UObject* RefObj = ObjProp->GetObjectPropertyValue(...);
    │           // RefObj 마크
    │       }
    │   }
    │
    ↓

[완료] 엔진 시스템 활용
    │
    │   - 가비지 컬렉션: UPROPERTY 기반 참조 추적
    │   - 직렬화: FProperty::SerializeItem() 자동 호출
    │   - 네트워킹: UPROPERTY(Replicated) 자동 동기화
    │   - 블루프린트: UFUNCTION(BlueprintCallable) 노드 생성
    │   - 에디터: UPROPERTY(EditAnywhere) 디테일 패널
```

---

## 🔬 설계 철학: 왜 UHT인가?

### C++ 표준 RTTI의 한계

```cpp
// ❌ C++ 표준 RTTI - 매우 제한적

class MyClass
{
public:
    int Health;
    void TakeDamage(float Amount);
};

// typeid로 타입 정보만 얻을 수 있음
const std::type_info& info = typeid(MyClass);
std::cout << info.name();  // "class MyClass" (컴파일러 의존적)

// ❌ 불가능한 것들:
// - 멤버 변수 목록 열거 (Health)
// - 멤버 함수 목록 열거 (TakeDamage)
// - 멤버 변수 값 읽기/쓰기
// - 함수 동적 호출
// - 메타데이터 (툴팁, 카테고리, 제약조건)
```

```cpp
// ✅ 언리얼 리플렉션 - 모든 것이 가능

UCLASS()
class UMyClass : public UObject
{
    GENERATED_BODY()

public:
    UPROPERTY(EditAnywhere, Category = "Stats", meta = (ClampMin = "0", ClampMax = "100"))
    int32 Health;

    UFUNCTION(BlueprintCallable, Category = "Combat")
    void TakeDamage(float Amount);
};

// ✅ 가능한 것들:
UClass* Class = UMyClass::StaticClass();

// 멤버 변수 열거
for (FProperty* Prop : Class->GetProperties())
{
    FString PropName = Prop->GetName();  // "Health"
    FString PropType = Prop->GetCPPType();  // "int32"
    FString Category = Prop->GetMetaData("Category");  // "Stats"
}

// 멤버 변수 값 읽기/쓰기
FIntProperty* HealthProp = FindFProperty<FIntProperty>(Class, "Health");
int32 HealthValue = HealthProp->GetPropertyValue(...);
HealthProp->SetPropertyValue(..., 50);

// 함수 동적 호출
UFunction* Func = Class->FindFunctionByName("TakeDamage");
Object->ProcessEvent(Func, &Params);

// 메타데이터 접근
int32 MaxHealth = HealthProp->GetIntMetaData("ClampMax");  // 100
```

### 설계 선택: 코드 생성 vs 런타임 리플렉션

언리얼은 **컴파일 타임 코드 생성** 방식을 선택했습니다. 이는 다른 접근법과 비교하면:

| 접근법 | 예시 | 장점 | 단점 |
|-------|------|------|------|
| **C++ 표준 RTTI** | `typeid()`, `dynamic_cast<>` | - 표준, 컴파일러 내장<br>- 추가 도구 불필요 | - 매우 제한적 (타입 정보만)<br>- 멤버 접근 불가<br>- 메타데이터 없음 |
| **런타임 리플렉션** | Java, C# | - 완전한 리플렉션<br>- 메타데이터 지원 | - 런타임 오버헤드 큼<br>- 메모리 사용량 증가<br>- C++에서 불가능 (언어 제약) |
| **템플릿 메타프로그래밍** | `boost::hana` | - 컴파일 타임 처리<br>- 타입 안전 | - 컴파일 시간 증가<br>- 복잡한 문법<br>- 제한적 기능 |
| **코드 생성 (UHT)** | Unreal Engine | - ✅ 완전한 리플렉션<br>- ✅ 메타데이터 풍부<br>- ✅ 런타임 성능 우수<br>- ✅ C++ 언어 제약 우회 | - ⚠️ 별도 도구 필요<br>- ⚠️ 빌드 과정 복잡 |

**언리얼이 UHT를 선택한 이유:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         UHT 선택의 핵심 이유                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 성능 (Performance)                                                  │
│     ─────────────────────────────────────────────────────────────────  │
│     • 모든 메타데이터가 컴파일 타임에 생성됨                              │
│     • 런타임 오버헤드 최소화                                             │
│     • FProperty 조회: O(1) 해시 테이블 (컴파일 타임 구축)                │
│                                                                         │
│     [성능 비교]                                                         │
│     런타임 리플렉션 (Java):  Property 조회 ~1000ns                       │
│     UHT (Unreal):           Property 조회 ~50ns (20배 빠름)             │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  2. 메모리 효율 (Memory Efficiency)                                     │
│     ─────────────────────────────────────────────────────────────────  │
│     • 메타데이터가 클래스 단위로 공유됨                                   │
│     • 인스턴스당 오버헤드 없음                                           │
│                                                                         │
│     [메모리 비교]                                                       │
│     Java/C# 오브젝트:  24 bytes (헤더 + vtable + 타입 정보)             │
│     UObject:           8 bytes (포인터만)                               │
│     메타데이터:        클래스당 1회만 저장 (UClass에)                     │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  3. 풍부한 메타데이터 (Rich Metadata)                                    │
│     ─────────────────────────────────────────────────────────────────  │
│     • 에디터 통합: Category, ToolTip, DisplayName                       │
│     • 블루프린트: BlueprintCallable, BlueprintReadWrite                 │
│     • 검증: ClampMin, ClampMax, AllowedClasses                         │
│     • 네트워킹: Replicated, ReplicatedUsing                            │
│     • 커스텀 메타데이터: meta = (CustomKey = "Value")                    │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  4. C++ 언어 제약 우회 (Language Limitations)                            │
│     ─────────────────────────────────────────────────────────────────  │
│     • C++는 런타임 리플렉션을 표준으로 지원하지 않음                       │
│     • UHT는 C++ 파서를 구현하여 메타데이터 추출                           │
│     • 컴파일러 독립적 (MSVC/Clang/GCC 모두 지원)                         │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  5. 전방 호환성 (Forward Compatibility)                                 │
│     ─────────────────────────────────────────────────────────────────  │
│     • UHT 업데이트로 새 기능 추가 가능                                    │
│     • 코드 리컴파일만으로 메타데이터 업데이트                              │
│     • 버전별 직렬화 지원 (FCustomVersion)                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 주요 API

### 1. UClass - 클래스 메타데이터

**📂 위치:** `Engine/Source/Runtime/CoreUObject/Public/UObject/Class.h`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              UClass                                     │
│  (클래스 리플렉션 메타데이터)                                             │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - UClass* SuperClass            // 부모 클래스                        │
│    - UObject* ClassDefaultObject   // CDO (템플릿 오브젝트)              │
│    - TMap<FName, UFunction*> FuncMap  // 함수 맵                        │
│    - FProperty* PropertyLink       // 프로퍼티 링크드 리스트              │
│    - int32 ClassUnique             // 클래스 고유 ID                     │
│    - EClassFlags ClassFlags        // 클래스 플래그                      │
│                                                                         │
│  Public:                                                                │
│    + StaticClass() : UClass*       // 정적 클래스 접근                   │
│    + GetSuperClass() : UClass*     // 부모 클래스                        │
│    + GetDefaultObject() : UObject* // CDO 가져오기                       │
│    + FindPropertyByName() : FProperty*  // 프로퍼티 찾기                 │
│    + FindFunctionByName() : UFunction*  // 함수 찾기                     │
│    + IsChildOf(UClass*) : bool     // 상속 관계 확인                     │
│    + GetProperties() : Iterator    // 프로퍼티 순회                      │
└─────────────────────────────────────────────────────────────────────────┘
```

**사용 예시:**

```cpp
// 클래스 메타데이터 접근
UClass* ActorClass = AActor::StaticClass();

// 📂 소스: Class.h:1234 (StaticClass 정의)
UClass* AActor::StaticClass()
{
    return GetPrivateStaticClassBody(...);
}

// 상속 관계 확인
bool bIsActor = MyClass->IsChildOf(AActor::StaticClass());
UClass* ParentClass = MyClass->GetSuperClass();

// 프로퍼티 순회
for (TFieldIterator<FProperty> It(ActorClass); It; ++It)
{
    FProperty* Prop = *It;
    FString PropName = Prop->GetName();
    FString PropType = Prop->GetCPPType();

    // 프로퍼티 플래그 확인
    bool bEditable = Prop->HasAnyPropertyFlags(CPF_Edit);
    bool bBlueprintVisible = Prop->HasAnyPropertyFlags(CPF_BlueprintVisible);
}

// 함수 순회
for (TFieldIterator<UFunction> It(ActorClass); It; ++It)
{
    UFunction* Func = *It;
    FString FuncName = Func->GetName();

    // 함수 플래그 확인
    bool bBlueprintCallable = Func->HasAnyFunctionFlags(FUNC_BlueprintCallable);
}

// CDO (Class Default Object) 접근
UObject* CDO = ActorClass->GetDefaultObject();

// 인스턴스 생성
UObject* NewInstance = NewObject<UObject>(Outer, ActorClass);
```

### 2. FProperty - 프로퍼티 메타데이터

**📂 위치:** `Engine/Source/Runtime/CoreUObject/Public/UObject/UnrealType.h:180`

**프로퍼티 타입 계층:**

```cpp
// 기본 프로퍼티
FProperty                    // 추상 기본 클래스
├── FNumericProperty         // 숫자 프로퍼티 (추상)
│   ├── FByteProperty        // uint8 / enum
│   ├── FIntProperty         // int32
│   ├── FInt64Property       // int64
│   ├── FFloatProperty       // float
│   ├── FDoubleProperty      // double
│   └── FEnumProperty        // C++ enum class
├── FBoolProperty            // bool
├── FStrProperty             // FString
├── FNameProperty            // FName
├── FTextProperty            // FText

// 오브젝트 프로퍼티
├── FObjectProperty          // UObject*
│   ├── FObjectPtrProperty   // TObjectPtr<>
│   ├── FClassProperty       // UClass*
│   └── FSoftObjectProperty  // TSoftObjectPtr<>

// 구조체 프로퍼티
├── FStructProperty          // USTRUCT

// 컨테이너 프로퍼티
├── FArrayProperty           // TArray<>
├── FSetProperty             // TSet<>
├── FMapProperty             // TMap<>

// 델리게이트 프로퍼티
├── FDelegateProperty        // 싱글캐스트
├── FMulticastDelegateProperty // 멀티캐스트

// 기타
└── FInterfaceProperty       // TScriptInterface<>
```

**런타임 프로퍼티 접근:**

```cpp
UObject* Object = GetSomeObject();
UClass* Class = Object->GetClass();

// 이름으로 프로퍼티 찾기
FProperty* HealthProp = Class->FindPropertyByName(TEXT("Health"));
if (HealthProp)
{
    // 타입 확인 및 캐스팅
    if (FIntProperty* IntProp = CastField<FIntProperty>(HealthProp))
    {
        // 값 포인터 얻기
        void* ValuePtr = IntProp->ContainerPtrToValuePtr<void>(Object);

        // 값 가져오기
        int32 Health = IntProp->GetPropertyValue(ValuePtr);

        // 값 설정
        IntProp->SetPropertyValue(ValuePtr, 100);
    }

    // 일반적인 프로퍼티 접근
    void* ValuePtr = HealthProp->ContainerPtrToValuePtr<void>(Object);

    // 텍스트로 내보내기
    FString ValueText;
    HealthProp->ExportTextItem_Direct(ValueText, ValuePtr, nullptr, nullptr, 0);
    // ValueText = "100"

    // 텍스트에서 가져오기
    const TCHAR* Buffer = TEXT("200");
    HealthProp->ImportText_Direct(Buffer, ValuePtr, nullptr, 0);
    // Health = 200

    // 프로퍼티 복사
    void* SourcePtr = ...;
    void* DestPtr = ...;
    HealthProp->CopyCompleteValue(DestPtr, SourcePtr);
}

// 모든 프로퍼티 순회
for (TFieldIterator<FProperty> It(Class); It; ++It)
{
    FProperty* Prop = *It;

    // 기본 정보
    FString PropName = Prop->GetName();
    FString PropType = Prop->GetCPPType();
    int32 Offset = Prop->GetOffset_ForInternal();
    int32 Size = Prop->GetSize();

    // 플래그 확인
    bool bEditable = Prop->HasAnyPropertyFlags(CPF_Edit);
    bool bBlueprintVisible = Prop->HasAnyPropertyFlags(CPF_BlueprintVisible);
    bool bReplicated = Prop->HasAnyPropertyFlags(CPF_Net);
    bool bTransient = Prop->HasAnyPropertyFlags(CPF_Transient);

    // 메타데이터 접근
    if (Prop->HasMetaData(TEXT("ClampMin")))
    {
        int32 MinValue = Prop->GetIntMetaData(TEXT("ClampMin"));
    }
}
```

### 3. UFunction - 함수 메타데이터

```cpp
UFunction* Func = MyClass->FindFunctionByName(TEXT("TakeDamage"));

if (Func)
{
    // 함수 플래그 확인
    bool bBlueprintCallable = Func->HasAnyFunctionFlags(FUNC_BlueprintCallable);
    bool bConst = Func->HasAnyFunctionFlags(FUNC_Const);
    bool bStatic = Func->HasAnyFunctionFlags(FUNC_Static);

    // 파라미터 순회
    for (TFieldIterator<FProperty> It(Func); It; ++It)
    {
        FProperty* Param = *It;
        FString ParamName = Param->GetName();

        bool bReturnParam = Param->HasAnyPropertyFlags(CPF_ReturnParm);
        bool bOutParam = Param->HasAnyPropertyFlags(CPF_OutParm);
        bool bConstParam = Param->HasAnyPropertyFlags(CPF_ConstParm);
    }

    // 함수 호출
    UObject* Target = ...;
    struct FParams
    {
        float Damage;
        float ReturnValue;
    } Params;
    Params.Damage = 10.0f;

    Target->ProcessEvent(Func, &Params);

    float Result = Params.ReturnValue;
}
```

### 4. UStruct - 구조체 메타데이터

```cpp
// 구조체 메타데이터 접근
UScriptStruct* VectorStruct = TBaseStructure<FVector>::Get();

// 프로퍼티 접근
FProperty* XProp = VectorStruct->FindPropertyByName(TEXT("X"));

// 구조체 인스턴스 생성
void* StructMemory = FMemory::Malloc(VectorStruct->GetStructureSize());
VectorStruct->InitializeStruct(StructMemory);

// 값 설정
FVector* VectorPtr = (FVector*)StructMemory;
VectorPtr->X = 1.0f;
VectorPtr->Y = 2.0f;
VectorPtr->Z = 3.0f;

// 직렬화
FArchive& Ar = ...;
VectorStruct->SerializeItem(Ar, StructMemory, nullptr);

// 정리
VectorStruct->DestroyStruct(StructMemory);
FMemory::Free(StructMemory);
```

### 5. UEnum - 열거형 메타데이터

```cpp
UEnum* MyEnum = StaticEnum<EMyEnum>();

// 열거형 이름 가져오기
int32 Count = MyEnum->NumEnums();
for (int32 i = 0; i < Count; ++i)
{
    FName EnumName = MyEnum->GetNameByIndex(i);
    int64 EnumValue = MyEnum->GetValueByIndex(i);

    UE_LOG(LogTemp, Log, TEXT("%s = %lld"), *EnumName.ToString(), EnumValue);
}

// 값 → 문자열 변환
FString EnumStr = MyEnum->GetNameStringByValue((int64)EMyEnum::Value);

// 문자열 → 값 변환
int64 EnumValue = MyEnum->GetValueByNameString(TEXT("Value"));

// DisplayName 가져오기 (UMETA(DisplayName))
FText DisplayName = MyEnum->GetDisplayNameTextByValue((int64)EMyEnum::Value);
```

---

## 💡 성능 고려사항

### 리플렉션 vs 직접 접근 성능 비교

```cpp
// 벤치마크 시나리오: Health 프로퍼티 1,000,000회 읽기

// ✅ 직접 접근 - 최고 성능
FORCEINLINE int32 GetHealth_Direct(UMyObject* Obj)
{
    return Obj->Health;  // ~1 CPU cycle
}
// 1,000,000회: ~1ms

// ⚠️ 리플렉션 (캐시 없음) - 매우 느림
int32 GetHealth_Reflection_NoCache(UMyObject* Obj)
{
    UClass* Class = Obj->GetClass();  // ~10ns
    FProperty* Prop = Class->FindPropertyByName(TEXT("Health"));  // ~500ns (해시 테이블 조회)
    FIntProperty* IntProp = CastField<FIntProperty>(Prop);  // ~50ns
    void* ValuePtr = IntProp->ContainerPtrToValuePtr<void>(Obj);  // ~5ns
    return IntProp->GetPropertyValue(ValuePtr);  // ~5ns
    // 총 ~570ns per call
}
// 1,000,000회: ~570ms (570배 느림!)

// ✅ 리플렉션 (캐시 사용) - 허용 가능
class UMyObjectOptimized
{
    static FIntProperty* CachedHealthProp;  // 한 번만 조회

    static void Initialize()
    {
        CachedHealthProp = FindFProperty<FIntProperty>(StaticClass(), TEXT("Health"));
    }

    int32 GetHealth_Reflection_Cached()
    {
        void* ValuePtr = CachedHealthProp->ContainerPtrToValuePtr<void>(this);
        return CachedHealthProp->GetPropertyValue(ValuePtr);  // ~10ns
    }
};
// 1,000,000회: ~10ms (10배 느림, 허용 가능)
```

**성능 요약:**

| 접근 방식 | 1회 호출 | 1,000,000회 | 상대 속도 |
|----------|---------|------------|----------|
| ✅ **직접 접근** | ~1ns | ~1ms | 1x (기준) |
| ✅ **리플렉션 (캐시)** | ~10ns | ~10ms | 10x 느림 ⚠️ |
| ❌ **리플렉션 (캐시 없음)** | ~570ns | ~570ms | 570x 느림 🚫 |

**권장 사항:**

```cpp
// ✅ 좋음: 초기화 시 캐싱
class UMyClass : public UObject
{
    static FProperty* CachedHealthProp;

    virtual void PostInitProperties() override
    {
        Super::PostInitProperties();

        if (!CachedHealthProp)
        {
            CachedHealthProp = GetClass()->FindPropertyByName(TEXT("Health"));
        }
    }

    int32 GetHealthReflection()
    {
        return CachedHealthProp->GetPropertyValue_Direct(...);
    }
};

// ❌ 나쁨: 매번 조회
void Tick()
{
    UClass* Class = GetClass();  // 매 프레임!
    FProperty* Prop = Class->FindPropertyByName(TEXT("Health"));  // 매우 느림!
}
```

---

## 🎯 모범 사례

### 1. 항상 GENERATED_BODY() 포함하기

```cpp
// ✅ 올바름
UCLASS()
class UMyClass : public UObject
{
    GENERATED_BODY()  // 필수!

public:
    UPROPERTY()
    int32 Value;
};

// ❌ 잘못됨 - 컴파일 에러!
UCLASS()
class UMyClass : public UObject
{
    // GENERATED_BODY() 누락!
public:
    UPROPERTY()
    int32 Value;
};
```

### 2. BlueprintPure 함수는 const여야 함

```cpp
// ✅ 올바름
UFUNCTION(BlueprintPure)
float GetHealth() const;  // const!

// ❌ 잘못됨 - 컴파일 에러
UFUNCTION(BlueprintPure)
float GetHealth();  // const 누락
```

### 3. UObject 포인터에 UPROPERTY() 필수

```cpp
// ✅ 올바름 - GC 추적
UPROPERTY()
UObject* MyObject;

// ❌ 위험 - GC될 수 있음!
UObject* DangerousPointer;
```

### 4. 리플렉션 데이터 캐싱하기

```cpp
// ❌ 나쁨: 반복 조회
void Tick()
{
    FProperty* Prop = GetClass()->FindPropertyByName(TEXT("Health"));
}

// ✅ 좋음: 한 번만 조회
FProperty* CachedProp = nullptr;

void Initialize()
{
    CachedProp = GetClass()->FindPropertyByName(TEXT("Health"));
}

void Tick()
{
    if (CachedProp) { /* 사용 */ }
}
```

### 5. 큰 매개변수에는 const 참조 사용

```cpp
// ✅ 효율적
UFUNCTION(BlueprintCallable)
void ProcessData(const FLargeStruct& Data);

// ❌ 비효율적 - 복사
UFUNCTION(BlueprintCallable)
void ProcessData(FLargeStruct Data);
```

---

## 🚨 일반적인 함정

### ❌ GENERATED_BODY() 잊어버리기

```cpp
UCLASS()
class UMyClass : public UObject
{
    // ❌ GENERATED_BODY() 누락 - 컴파일 에러!
};
```

### ❌ const가 아닌 BlueprintPure 사용하기

```cpp
// ❌ 컴파일 에러
UFUNCTION(BlueprintPure)
float GetValue() { return Value; }  // const 누락!
```

### ❌ 캐싱 없이 핫 패스에서 리플렉션 사용하기

```cpp
// ❌ 매우 느림
void Tick()
{
    UClass* Class = GetClass();  // 매 프레임 조회
    FProperty* Prop = Class->FindPropertyByName(TEXT("Health"));  // 500ns!
}
```

### ❌ TFieldIterator 잘못 사용하기

```cpp
// ❌ 잘못됨 - 무한 루프!
for (TFieldIterator<FProperty> It(Class); It; ++It)
{
    Class->AddProperty(...);  // 순회 중 수정!
}

// ✅ 올바름 - 먼저 모으기
TArray<FProperty*> Properties;
for (TFieldIterator<FProperty> It(Class); It; ++It)
{
    Properties.Add(*It);
}

for (FProperty* Prop : Properties)
{
    // 안전하게 수정
}
```

---

## 🔬 설계 철학: 왜 커스텀 리플렉션인가?

C++의 기본 RTTI(typeid, dynamic_cast)로는 언리얼의 요구사항을 충족할 수 없습니다. 커스텀 리플렉션 시스템을 구축한 **설계 의도**를 분석합니다.

### C++ RTTI vs 언리얼 리플렉션 비교

| 항목 | C++ RTTI | 언리얼 리플렉션 | 이유 |
|------|----------|----------------|------|
| **프로퍼티 접근** | ❌ 불가능 | ✅ FProperty로 가능 | 직렬화, 에디터, GC 필수 |
| **함수 메타데이터** | ❌ 없음 | ✅ UFunction | 블루프린트 호출, RPC, 델리게이트 |
| **메타데이터** | ❌ 없음 | ✅ 풍부함 (Category, DisplayName 등) | 에디터 UI, 툴팁 |
| **직렬화** | ❌ 수동 구현 | ✅ 자동 | 저장/로드, 네트워킹 |
| **블루프린트 통합** | ❌ 불가능 | ✅ 완벽 지원 | 비주얼 스크립팅 핵심 |
| **GC 참조 추적** | ❌ 없음 | ✅ UPROPERTY 기반 | 자동 메모리 관리 |
| **핫 리로드** | ❌ 불가능 | ✅ 지원 | 개발 생산성 |
| **크로스 플랫폼** | ⚠️ 플랫폼별 차이 | ✅ 일관성 | 멀티 플랫폼 엔진 |
| **성능 오버헤드** | 낮음 | 중간 (최적화 가능) | 캐싱으로 완화 |

### 핵심 철학

> **"컴파일 타임 코드 생성을 통해 런타임 유연성과 성능을 동시에 확보한다"**

**3가지 핵심 설계 원칙:**

1. **옵트인 (Opt-in) 방식**
   - 모든 클래스가 리플렉션 비용을 지불하지 않음
   - UCLASS() 매크로로 명시적 선택
   - 네이티브 C++ 클래스는 오버헤드 없음

2. **컴파일 타임 생성**
   - UHT가 메타데이터를 컴파일 전에 생성
   - 런타임 파싱 없음 → 빠른 시작
   - 타입 안전성 보장

3. **계층적 책임 분리**
   - UClass: 타입 메타데이터
   - FProperty: 데이터 레이아웃
   - UFunction: 행동 메타데이터
   - 각각 독립적으로 최적화 가능

---

## 🧩 계층별 책임 분리

리플렉션 시스템의 3대 핵심 컴포넌트가 어떻게 협력하는지 시각화합니다.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         UClass (타입 메타데이터)                          │
│  "이 클래스가 무엇인가?"                                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  책임:                                                                   │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ 클래스 계층          │  │ 생성/소멸            │                      │
│  │ - SuperClass        │  │ - ClassConstructor  │                      │
│  │ - Interfaces        │  │ - ClassDefaultObject│                      │
│  │ - 크기/정렬         │  │ - CreateInstance()  │                      │
│  └─────────────────────┘  └─────────────────────┘                      │
│                                                                         │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ 리플렉션 데이터      │  │ 엔진 통합            │                      │
│  │ - PropertyLink      │  │ - 직렬화 지원        │                      │
│  │ - FuncMap           │  │ - 네트워킹 지원      │                      │
│  │ - InterfaceMap      │  │ - 에디터 지원        │                      │
│  └─────────────────────┘  └─────────────────────┘                      │
│                                                                         │
└─────────────┬───────────────────────────────────────────────────────────┘
              │ 소유
              ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                    FProperty (데이터 레이아웃)                            │
│  "이 데이터가 어떻게 저장되는가?"                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  책임:                                                                   │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ 메모리 레이아웃      │  │ 값 접근/수정         │                      │
│  │ - Offset            │  │ - GetValue()        │                      │
│  │ - Size              │  │ - SetValue()        │                      │
│  │ - Alignment         │  │ - CopySingleValue() │                      │
│  └─────────────────────┘  └─────────────────────┘                      │
│                                                                         │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ 직렬화               │  │ GC 참조 추적         │                      │
│  │ - SerializeItem()   │  │ - ContainsObjectRef │                      │
│  │ - ExportText()      │  │ - AddReferencedObjs │                      │
│  │ - ImportText()      │  │ - (UObject* 탐지)   │                      │
│  └─────────────────────┘  └─────────────────────┘                      │
│                                                                         │
└─────────────┬───────────────────────────────────────────────────────────┘
              │ 형제
              ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                    UFunction (행동 메타데이터)                            │
│  "이 함수가 어떻게 호출되는가?"                                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  책임:                                                                   │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ 함수 시그니처        │  │ 호출 메커니즘        │                      │
│  │ - ParmsSize         │  │ - Invoke()          │                      │
│  │ - ReturnValueOffset │  │ - ProcessEvent()    │                      │
│  │ - NumParms          │  │ - Func 포인터       │                      │
│  └─────────────────────┘  └─────────────────────┘                      │
│                                                                         │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ 블루프린트           │  │ 네트워킹             │                      │
│  │ - BlueprintCallable │  │ - NetFuncFlags      │                      │
│  │ - BlueprintPure     │  │ - RPC 호출          │                      │
│  │ - CallInEditor      │  │ - Replication       │                      │
│  └─────────────────────┘  └─────────────────────┘                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

             데이터 흐름 및 의존성:

    UClass                    FProperty                    UFunction
      │                          │                            │
      ├─ 클래스 계층 ────────>   오프셋 계산 ────────────>    파라미터 레이아웃
      │                          │                            │
      ├─ CDO 생성 ──────────>    기본값 복사 ─────────────>   생성자 호출
      │                          │                            │
      └─ 리플렉션 순회 ──────>    값 읽기/쓰기 ────────────>   함수 실행
                                 │
                                 └─ GC 참조 추적 ────────────>  (UObject* 발견)
```

---

## 🔄 런타임 동작 시퀀스

### 1️⃣ **UFunction 호출 프로세스** (블루프린트 → 네이티브)

```
    블루프린트        UObject         UFunction       네이티브 C++
    (BP Graph)     (Instance)       (Metadata)        (실제 코드)
       │                │                │                │
       │ Call "TakeDmg" │                │                │
       ├───────────────>│                │                │
       │                │ ProcessEvent() │                │
       │                ├───────────────>│                │
       │                │                │                │
       │                │  [파라미터 스택 구성]           │
       │                │                │                │
       │                │  ┌──────────────────────────┐  │
       │                │  │ Params 구조체:           │  │
       │                │  │ ┌──────────────────────┐ │  │
       │                │  │ │ float Amount = 10.0  │ │  │
       │                │  │ └──────────────────────┘ │  │
       │                │  └──────────────────────────┘  │
       │                │                │                │
       │                │  FuncPtr 있나? │                │
       │                │  ├────────────>│                │
       │                │  │ Yes: Native │                │
       │                │                │  Invoke()      │
       │                │                ├───────────────>│
       │                │                │                │
       │                │                │  // C++ 실행  │
       │                │                │  void TakeDmg │
       │                │                │  (float Amt)  │
       │                │                │  {            │
       │                │                │    Health-=Amt│
       │                │                │  }            │
       │                │                │                │
       │                │                │  return       │
       │                │                │<───────────────┤
       │                │  return value  │                │
       │                │<───────────────┤                │
       │   return       │                │                │
       │<───────────────┤                │                │

   Performance:
   - BP → Native: ~100-200ns (FuncPtr 직접 호출)
   - BP → BP: ~500-1000ns (바이트코드 인터프리터)
```

### 2️⃣ **FProperty를 통한 값 접근**

```
   게임 코드         UClass           FProperty        메모리 (인스턴스)
      │                │                 │                   │
      │ FindProperty() │                 │                   │
      ├───────────────>│                 │                   │
      │                │ PropertyLink    │                   │
      │                ├────────────────>│                   │
      │                │                 │                   │
      │ GetValue()     │                 │                   │
      ├────────────────┼────────────────>│                   │
      │                │                 │  Offset + Instance│
      │                │                 ├──────────────────>│
      │                │                 │                   │
      │                │                 │  *(int32*)(Obj+48)│
      │                │                 │<──────────────────┤
      │                │                 │  Value = 100      │
      │                │  return 100     │                   │
      │<───────────────┼─────────────────┤                   │
      │                │                 │                   │

   Performance:
   - Direct member access: ~1-2ns
   - FProperty::GetValue(): ~50-100ns (캐싱 없이)
   - FindPropertyByName(): ~300-500ns (해시 맵 조회)

   최적화:
   - 초기화 시 한 번만 FindProperty()
   - FProperty* 포인터를 캐싱
   - 핫 패스에서는 직접 접근 사용
```

### 3️⃣ **리플렉션 데이터 생명주기**

```
[엔진 시작]
    │
    ↓
┌────────────────────────────────────────┐
│  Module 로드                            │
│  ─────────────────────────────────────│
│  1. DLL/SO 로드                        │
│  2. StaticRegisterNatives 호출         │
│     └→ UFunction 네이티브 바인딩       │
│  3. Z_Construct_UClass 호출            │
│     └→ UClass 생성                     │
│     └→ FProperty 생성                  │
│     └→ CDO 생성                        │
└────────────────────────────────────────┘
    ↓
┌────────────────────────────────────────┐
│  런타임 사용                            │
│  ─────────────────────────────────────│
│  - GetClass() → UClass 조회 (O(1))    │
│  - FindProperty() → 해시 맵 (O(1))    │
│  - ProcessEvent() → 함수 호출         │
│  - Serialize() → FProperty 순회       │
│  - GC → UObject* FProperty 추적       │
└────────────────────────────────────────┘
    ↓
┌────────────────────────────────────────┐
│  핫 리로드 (에디터)                     │
│  ─────────────────────────────────────│
│  1. 재컴파일                           │
│  2. 기존 UClass 무효화                 │
│  3. 새 UClass 생성                     │
│  4. 인스턴스 재초기화 (CDO 복사)       │
└────────────────────────────────────────┘
    ↓
[엔진 종료]
    │
    ↓
UClass, FProperty, UFunction은 GC에 의해 정리됨
(RF_MarkAsRootSet 플래그로 보호됨)
```

---

## 🔍 디버깅 팁

### 콘솔 명령어

```bash
# 클래스 목록
obj list class=MyClass

# 오브젝트 덤프
obj dump MyActor

# 참조 찾기
obj refs name=MyObject class=MyClass

# 리플렉션 데이터 확인
obj classes
```

### Visual Studio Natvis

UClass, FProperty, UFunction에는 커스텀 비주얼라이저가 있습니다:

```xml
<!-- Engine/Extras/VisualStudioDebugging/Unreal.natvis -->
<Type Name="UClass">
    <DisplayString>{*(UObject*)this}</DisplayString>
    <Expand>
        <Item Name="[Class Name]">GetName()</Item>
        <Item Name="[Super Class]">SuperStruct</Item>
        <Item Name="[Properties]">PropertyLink</Item>
        <Item Name="[Functions]">FuncMap</Item>
    </Expand>
</Type>
```

---

## 🆕 UE 5.7 주요 변경사항

### 1. Property Visitor API 변경 - Context 파라미터 추가

**📂 위치:**
- `Engine/Source/Runtime/CoreUObject/Public/UObject/Class.h:941`
- `Engine/Source/Runtime/CoreUObject/Public/UObject/UnrealType.h:381`
- `Engine/Source/Runtime/CoreUObject/Public/UObject/PropertyVisitor.h:370`

**변경 내용:**

Property Visitor API에 `FPropertyVisitorContext` 파라미터가 추가되었습니다:

```cpp
// ❌ UE 5.6 이전 (Deprecated)
UClass->Visit(Data, [](const FPropertyVisitorPath& Path, const FPropertyVisitorData& Data)
{
    // 프로퍼티 순회 로직
    return EPropertyVisitorControlFlow::Continue;
});

// ✅ UE 5.7 이후 (권장)
FPropertyVisitorContext Context;
UClass->Visit(Data, Context, [](const FPropertyVisitorPath& Path, const FPropertyVisitorData& Data)
{
    // 프로퍼티 순회 로직
    return EPropertyVisitorControlFlow::Continue;
});
```

**FPropertyVisitorContext:**

```cpp
struct FPropertyVisitorContext
{
    // 방문 컨텍스트 정보
    // 향후 확장을 위한 구조체
};
```

**영향을 받는 API:**

```cpp
// UClass::Visit
UE_DEPRECATED(5.7, "Visit is deprecated, please use Visit with context instead.")
COREUOBJECT_API EPropertyVisitorControlFlow Visit(
    void* Data,
    const TFunctionRef<EPropertyVisitorControlFlow(const FPropertyVisitorPath&, const FPropertyVisitorData&)> InFunc
) const;

// 새로운 API
COREUOBJECT_API EPropertyVisitorControlFlow Visit(
    void* Data,
    FPropertyVisitorContext& Context,  // 추가된 파라미터
    const TFunctionRef<EPropertyVisitorControlFlow(const FPropertyVisitorPath&, const FPropertyVisitorData&)> InFunc
) const;

// FProperty::Visit
UE_DEPRECATED(5.7, "Visit is deprecated, please use Visit with context instead.")
COREUOBJECT_API EPropertyVisitorControlFlow Visit(
    const FPropertyVisitorData& Data,
    const TFunctionRef<EPropertyVisitorControlFlow(const FPropertyVisitorPath&, const FPropertyVisitorData&)> InFunc
) const;

// VisitProperty (전역 함수)
UE_DEPRECATED(5.7, "Visit is deprecated, please use Visit with context instead.")
COREUOBJECT_API EPropertyVisitorControlFlow VisitProperty(...);
```

**마이그레이션 예시:**

```cpp
// === 프로퍼티 순회 (UClass) ===

// UE 5.6
MyClass->Visit(MyData, [](const FPropertyVisitorPath& Path, const FPropertyVisitorData& Data)
{
    if (const FProperty* Property = Path.Top())
    {
        UE_LOG(LogTemp, Log, TEXT("Property: %s"), *Property->GetName());
    }
    return EPropertyVisitorControlFlow::Continue;
});

// UE 5.7
FPropertyVisitorContext Context;
MyClass->Visit(MyData, Context, [](const FPropertyVisitorPath& Path, const FPropertyVisitorData& Data)
{
    if (const FProperty* Property = Path.Top())
    {
        UE_LOG(LogTemp, Log, TEXT("Property: %s"), *Property->GetName());
    }
    return EPropertyVisitorControlFlow::Continue;
});
```

---

### 2. Property 타입 별칭 변경

**📂 위치:** `Engine/Source/Runtime/CoreUObject/Public/UObject/Class.h:2013`

**변경 내용:**

`TPointerToAddStructReferencedObjects` 타입 별칭이 deprecated되고 `PointerToAddStructReferencedObjectsType`으로 대체되었습니다:

```cpp
// ❌ UE 5.6 이전 (Deprecated)
using TPointerToAddStructReferencedObjects UE_DEPRECATED(5.7, "...") =
    void (*)(void* A, FReferenceCollector& Collector);

// ✅ UE 5.7 이후 (권장)
using PointerToAddStructReferencedObjectsType =
    void (*)(void* A, FReferenceCollector& Collector);
```

**사용 예시:**

```cpp
// UScriptStruct에서 사용
struct FScriptStruct : public UStruct
{
    // 구조체 참조 추가 함수 포인터
    PointerToAddStructReferencedObjectsType AddStructReferencedObjects();
};

// 커스텀 구조체 GC 참조 추가
void AddMyStructReferencedObjects(void* StructPtr, FReferenceCollector& Collector)
{
    FMyStruct* MyStruct = static_cast<FMyStruct*>(StructPtr);
    Collector.AddReferencedObject(MyStruct->MyUObject);
}
```

**마이그레이션:**

```cpp
// 검색 및 교체
TPointerToAddStructReferencedObjects → PointerToAddStructReferencedObjectsType
```

---

### 3. FObjectPropertyBase::GetCPPTypeCustom() Deprecated

**📂 위치:** `Engine/Source/Runtime/CoreUObject/Public/UObject/UnrealType.h:2787`

**변경 내용:**

```cpp
// ❌ UE 5.6 이전 (Deprecated)
UE_DEPRECATED(5.7, "GetCPPTypeCustom is deprecated, and object properties now implement GetCPPType directly.")
FString GetCPPTypeCustom(FString* ExtendedTypeText, uint32 CPPExportFlags, const FString& InnerNativeTypeName) const { return {}; }
```

**이유:**

Object Property 클래스들이 이제 `GetCPPType()`을 직접 구현합니다. 별도의 `GetCPPTypeCustom()` 헬퍼 함수가 더 이상 필요하지 않습니다.

**영향:**

일반적인 게임 코드에서는 이 함수를 직접 호출하지 않습니다. 이는 주로 UHT(Unreal Header Tool) 및 코드 생성 시스템에서 사용됩니다.

**대안:**

Object Property의 C++ 타입 문자열이 필요한 경우:

```cpp
// FProperty에서 C++ 타입 가져오기
FString CPPType = Property->GetCPPType();

// 또는 확장 타입 텍스트와 함께
FString ExtendedTypeText;
FString CPPType = Property->GetCPPType(&ExtendedTypeText);
```

---

### 업데이트된 코드 예시

#### Property Visitor 사용 (UE 5.7)

```cpp
// === 모든 UPROPERTY 순회 ===

void TraverseProperties(UObject* Object)
{
    UClass* Class = Object->GetClass();
    FPropertyVisitorContext Context;  // 새로운 context

    Class->Visit(
        Object,  // 데이터 포인터
        Context, // context 파라미터
        [](const FPropertyVisitorPath& Path, const FPropertyVisitorData& Data)
        {
            const FProperty* Property = Path.Top();
            if (!Property)
                return EPropertyVisitorControlFlow::Continue;

            // 프로퍼티 정보 출력
            UE_LOG(LogTemp, Log, TEXT("Property: %s, Type: %s"),
                *Property->GetName(),
                *Property->GetCPPType());

            // 특정 타입 체크
            if (const FObjectProperty* ObjectProp = CastField<FObjectProperty>(Property))
            {
                UObject* Value = ObjectProp->GetObjectPropertyValue(Data.Data);
                if (Value)
                {
                    UE_LOG(LogTemp, Log, TEXT("  -> Object Value: %s"), *Value->GetName());
                }
            }

            return EPropertyVisitorControlFlow::Continue;
        }
    );
}
```

#### 구조체 GC 참조 추가 (UE 5.7)

```cpp
// === 커스텀 구조체 GC 지원 ===

USTRUCT()
struct FMyStruct
{
    GENERATED_BODY()

    UPROPERTY()
    TObjectPtr<UObject> MyObject;  // GC 추적 필요

    // 비 UPROPERTY 참조 (수동 추가 필요)
    UObject* ManualReference = nullptr;
};

// GC 참조 추가 함수 (PointerToAddStructReferencedObjectsType)
void AddFMyStructReferencedObjects(void* StructPtr, FReferenceCollector& Collector)
{
    FMyStruct* MyStruct = static_cast<FMyStruct*>(StructPtr);

    // 수동 참조 추가
    Collector.AddReferencedObject(MyStruct->ManualReference);

    // UPROPERTY는 자동 처리되므로 수동 추가 불필요
}

// UScriptStruct에 등록 (엔진 내부에서 자동 처리)
```

---

### 마이그레이션 체크리스트

**Property Visitor API:**

1. ✅ `UClass::Visit` 호출 찾기
2. ✅ `FPropertyVisitorContext Context;` 추가
3. ✅ Context를 두 번째 파라미터로 전달
4. ✅ 컴파일 및 테스트

**타입 별칭:**

1. ✅ `TPointerToAddStructReferencedObjects` 검색
2. ✅ `PointerToAddStructReferencedObjectsType`로 교체

**GetCPPTypeCustom:**

1. ✅ `GetCPPTypeCustom` 호출 찾기 (드물음)
2. ✅ `GetCPPType()` 직접 호출로 변경

**컴파일 경고:**

```
warning C4996: 'UClass::Visit': Visit is deprecated, please use Visit with context instead
warning C4996: 'TPointerToAddStructReferencedObjects': ... has been deprecated, please use PointerToAddStructReferencedObjectsType instead
```

---

## 🔗 참고자료

- [Unreal Reflection System](https://docs.unrealengine.com/unreal-engine-reflection-system/)
- [UHT (Unreal Header Tool)](https://docs.unrealengine.com/programming-with-cplusplus-in-unreal-engine/)
- [Gameplay Classes](https://docs.unrealengine.com/gameplay-classes-in-unreal-engine/)
- [UCLASS Specifiers](https://docs.unrealengine.com/uclass-specifiers/)
- [UPROPERTY Specifiers](https://docs.unrealengine.com/uproperty-specifiers/)
- [UFUNCTION Specifiers](https://docs.unrealengine.com/ufunction-specifiers/)
- [UnrealType.h Source](Engine/Source/Runtime/CoreUObject/Public/UObject/UnrealType.h)
- [Class.h Source](Engine/Source/Runtime/CoreUObject/Public/UObject/Class.h)
- [PropertyVisitor.h Source](Engine/Source/Runtime/CoreUObject/Public/UObject/PropertyVisitor.h) - **UE 5.7 업데이트**

---

> 📅 생성: 2025-10-17 — 초기 리플렉션 시스템 문서화
> 📅 업데이트: 2025-10-20 — 시각적 다이어그램, 설계 철학, 성능 분석 추가 (UE 5.6.1 검증 완료)
> 🔄 업데이트: 2025-11-06 — UE 5.7 Property Visitor 및 타입 별칭 변경사항 반영
