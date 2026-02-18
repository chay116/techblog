---
title: "UObject 시스템"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "CoreUObject"
tags: ["unreal", "CoreUObject"]
---
# UObject 시스템

## 🧭 개요

**UObject**는 모든 언리얼 엔진 오브젝트의 기본 클래스이며 언리얼의 오브젝트 시스템의 기초입니다. 다음과 같은 중요한 엔진 기능을 제공합니다:

- **리플렉션 (Reflection)** - 런타임 타입 정보 및 인트로스펙션
- **가비지 컬렉션 (Garbage Collection)** - 자동 메모리 관리
- **직렬화 (Serialization)** - 디스크로부터/디스크로 오브젝트 저장/로드
- **네트워킹 (Networking)** - 네트워크를 통한 오브젝트 리플리케이션
- **블루프린트 통합 (Blueprint Integration)** - C++를 비주얼 스크립팅에 노출
- **에디터 통합 (Editor Integration)** - 프로퍼티 편집, 실행 취소/재실행, 디테일 패널
- **프로퍼티 시스템 (Property System)** - 타입 안전 프로퍼티 접근 및 수정
- **오브젝트 수명 관리 (Object Lifetime Management)** - 생성, 초기화 및 소멸

**핵심 원칙:** `UObject`에서 파생된 모든 클래스는 언리얼의 리플렉션 시스템을 통해 이러한 기능을 자동으로 얻습니다.

**모듈 위치:** `Engine/Source/Runtime/CoreUObject/`

**핵심 종속성:** Core 모듈 (플랫폼 추상화, 컨테이너, 메모리)

**엔진 버전:** Unreal Engine 5.6.1 (2025년 기준)

---

## 🧱 구조

### 클래스 계층 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           UObjectBase                                   │
│  (최소 코어 - 전역 배열 등록, GC 인덱스)                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - UClass* ClassPrivate           // 오브젝트의 클래스 타입            │
│    - FName NamePrivate              // 오브젝트 이름                     │
│    - UObject* OuterPrivate          // 소유자/컨테이너                   │
│    - EObjectFlags ObjectFlags       // RF_* 플래그                      │
│    - int32 InternalIndex            // 전역 배열 인덱스                  │
│                                                                         │
│  Public:                                                                │
│    + GetClass() : UClass*           // 클래스 타입 반환                  │
│    + GetOuter() : UObject*          // Outer 반환                       │
│    + GetFName() : FName             // 이름 반환                         │
│    + GetFlags() : EObjectFlags      // 플래그 반환                       │
│    + IsValidLowLevel() : bool       // 저수준 유효성 검사                │
└─────────────────────────────────────────────────────────────────────────┘
                                      ▲
                                      │ 상속
                                      │
┌─────────────────────────────────────────────────────────────────────────┐
│                      UObjectBaseUtility                                 │
│  (편의 기능 - 플래그/GC 유틸, 검색/로드)                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Public:                                                                │
│    + SetFlags(EObjectFlags)         // 플래그 설정 (원자적)              │
│    + ClearFlags(EObjectFlags)       // 플래그 해제 (원자적)              │
│    + HasAnyFlags(EObjectFlags) : bool                                   │
│    + MarkAsGarbage()                // 가비지로 표시                      │
│    + AddToRoot()                    // GC 루트에 추가                    │
│    + RemoveFromRoot()               // GC 루트에서 제거                  │
│    + IsRooted() : bool              // 루트 여부 확인                    │
│    + GetFullName() : FString        // 전체 경로 문자열                  │
│    + GetPathName() : FString        // 경로 문자열                       │
│    + IsA<T>() : bool                // 타입 체크                         │
│    + GetWorld() : UWorld*           // 월드 포인터                       │
└─────────────────────────────────────────────────────────────────────────┘
                                      ▲
                                      │ 상속
                                      │
┌─────────────────────────────────────────────────────────────────────────┐
│                           UObject                                       │
│  (완전한 기능 - 리플렉션, 직렬화, 네트워킹)                               │
├─────────────────────────────────────────────────────────────────────────┤
│  Public:                                                                │
│    + PostInitProperties()           // 생성 후 초기화                    │
│    + PostLoad()                     // 로드 후 처리                      │
│    + BeginDestroy()                 // 소멸 시작                         │
│    + FinishDestroy()                // 최종 소멸                         │
│    + Serialize(FArchive&)           // 직렬화/역직렬화                   │
│    + ProcessEvent(UFunction*, void*) // 블루프린트/RPC 호출             │
│    + CreateDefaultSubobject<T>()    // 서브오브젝트 생성                 │
│    + Modify() : bool                // 언두/리두 기록                    │
│    + AddReferencedObjects()         // GC 커스텀 참조                    │
└─────────────────────────────────────────────────────────────────────────┘
                                      ▲
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
               ┌────┴────┐      ┌────┴────┐      ┌────┴────┐
               │ UField  │      │ AActor  │      │UActorCmp│
               │(리플렉션)│      │(게임액터)│      │(컴포넌트)│
               └────┬────┘      └─────────┘      └─────────┘
                    │
          ┌─────────┴─────────┐
          │                   │
     ┌────┴────┐         ┌───┴────┐
     │ UStruct │         │ UEnum  │
     │(구조체) │         │(열거형) │
     └────┬────┘         └────────┘
          │
    ┌─────┴─────┐
    │           │
┌───┴───┐  ┌───┴────┐
│UClass │  │UFunction│
│(클래스)│  │(함수)   │
└───────┘  └────────┘
```

**텍스트 계층 구조:**
```
UObjectBase                    // 최소 기본, 내부 GC 인덱스
└── UObjectBaseUtility         // 플래그 관리, 이름/클래스 접근
    └── UObject                // 전체 기능 세트 (직렬화, 네트워킹 등)
        ├── UField              // 리플렉션 데이터 오브젝트의 베이스
        │   ├── UStruct         // 구조체/클래스 레이아웃 정보
        │   │   ├── UClass      // 클래스 메타데이터 (UObject의 "타입")
        │   │   ├── UScriptStruct // 순수 구조체 메타데이터 (예: FVector)
        │   │   └── UFunction   // 함수 메타데이터
        │   └── UEnum           // 열거형 메타데이터
        └── (모든 게임 오브젝트)
            ├── AActor
            ├── UActorComponent
            ├── UAsset 타입들
            └── ...
```

### 오브젝트 플래그 (EObjectFlags)

UObject는 동작을 제어하는 플래그를 가집니다:

```cpp
RF_NoFlags                 // 플래그 없음
RF_Public                  // 오브젝트가 패키지 외부에서 보임
RF_Transactional          // 오브젝트가 실행 취소/재실행을 지원
RF_MarkAsRootSet          // 오브젝트가 가비지 컬렉션의 루트
RF_Transient              // 오브젝트를 디스크에 저장하지 않음
RF_ClassDefaultObject     // 클래스 기본 오브젝트 (CDO)
RF_ArchetypeObject        // 오브젝트가 원형 (템플릿)
RF_Standalone             // 가비지 컬렉션 중 오브젝트 유지 (에디터)
RF_NeedLoad               // 오브젝트를 로드해야 함
RF_NeedPostLoad           // PostLoad를 호출해야 함
RF_BeginDestroyed         // BeginDestroy가 호출됨
RF_FinishDestroyed        // FinishDestroy가 호출됨
```

### 주요 내부 구성 요소

#### 1. **UObjectBase** - 엔진 내부 관리의 최소 단위

**📂 위치:** `Engine/Source/Runtime/CoreUObject/Public/UObject/UObjectBase.h:46`

**역할:** 모든 UObject가 가져야 하는 최소 코어 (메모리 관리, GC, 클래스 참조)

UObjectBase는 **리플렉션 없이도** 존재 가능합니다. 즉, 오브젝트 시스템의 "주소록 엔트리" 같은 역할입니다.

**핵심 멤버:**
```cpp
class UObjectBase
{
private:
    UClass* ClassPrivate;           // 오브젝트의 클래스 타입
    FName NamePrivate;              // 오브젝트 이름
    UObject* OuterPrivate;          // 소유자/컨테이너
    EObjectFlags ObjectFlags;       // RF_* 플래그
    int32 InternalIndex;            // 전역 UObject 배열 인덱스 (FUObjectArray)
};
```

**제공 기능:**
- **전역 등록:** `AddObject()` - FUObjectArray에 인덱스 할당 및 등록
- **기본 접근자:** `GetClass()`, `GetOuter()`, `GetFName()`
- **플래그 관리:** `GetFlags()`, `AtomicallySetFlags()`, `AtomicallyClearFlags()`
- **유효성 검사:** `IsValidLowLevel()`, `IsValidLowLevelFast()`
- **고유 ID:** `GetUniqueID()` - InternalIndex 반환

**생성자 시그니처 (소스 검증):**
```cpp
// UObjectBase.h:101
UObjectBase(
    UClass* InClass,
    EObjectFlags InFlags,
    EInternalObjectFlags InInternalFlags,
    UObject* InOuter,
    FName InName,
    int32 InInternalIndex = -1,      // 미리 할당된 인덱스 (네트워크/언두)
    int32 InSerialNumber = 0,        // Weak Pointer용 시리얼 번호
    FRemoteObjectId InRemoteId = FRemoteObjectId()
);
```

**핵심 책임:** "이 오브젝트가 엔진에 존재한다"는 사실을 보장

---

#### 2. **UObjectBaseUtility** - 유틸리티 기능 모음 (비필수 고급 기능)

**📂 위치:** `Engine/Source/Runtime/CoreUObject/Public/UObject/UObjectBaseUtility.h:44`

**역할:** UObjectBase가 너무 코어라서 직접 넣기 부담스러운 편의 기능들을 분리

**계층 선언:**
```cpp
class UObjectBaseUtility : public UObjectBase
{
    // 편의 기능만 추가, 새로운 데이터 멤버 없음
};
```

**제공 기능:**

| 기능 카테고리 | 대표 메서드 | 설명 |
|--------------|------------|------|
| **플래그 유틸** | `SetFlags()`, `ClearFlags()` | 플래그 수정 (원자적) |
|  | `HasAnyFlags()`, `HasAllFlags()` | 플래그 체크 |
| **GC 관리** | `MarkAsGarbage()`, `ClearGarbage()` | 가비지 표시/해제 |
|  | `AddToRoot()`, `RemoveFromRoot()` | 루트 셋 관리 |
|  | `IsRooted()`, `IsUnreachable()` | GC 상태 확인 |
| **이름/경로** | `GetFullName()`, `GetPathName()` | 전체 경로 문자열 생성 |
| **타입 체크** | `IsA<T>()`, `IsChildOf()` | 타입 검사 |
| **검색/로드** | `StaticLoadObject()`, `FindObject()` | 오브젝트 찾기/로드 |
| **Outer 탐색** | `GetTypedOuter<T>()` | 특정 타입의 Outer 찾기 |
| **월드 접근** | `GetWorld()` | UWorld 포인터 얻기 |
| **리네임/복제** | `Rename()`, `DuplicateObject()` | 오브젝트 재명명/복사 |

**소스 검증 예시:**
```cpp
// UObjectBaseUtility.h:176
FORCEINLINE void MarkAsGarbage()
{
    check(!IsRooted());
    AtomicallySetFlags(RF_MirroredGarbage);
    AtomicallyClearInternalFlags(EInternalObjectFlags::Async);
    GUObjectArray.IndexToObject(InternalIndex)->SetGarbage();  // ← 전역 배열 조작
}

// UObjectBaseUtility.h:206
FORCEINLINE void AddToRoot()
{
    GUObjectArray.IndexToObject(InternalIndex)->SetRootSet();  // ← GC 루트 등록
}
```

**핵심 책임:** "오브젝트를 찾고, 다루고, 관리하는" 편의 기능

---

#### 3. **UObject** - 엔진/게임 코드용 풀 기능 오브젝트

**📂 위치:** `Engine/Source/Runtime/CoreUObject/Public/UObject/Object.h:93`

**역할:** 리플렉션, 직렬화, 이벤트, GC 등 전체 기능을 제공하는 최종 클래스

**계층 선언:**
```cpp
class UObject : public UObjectBaseUtility
{
    DECLARE_CLASS(UObject, UObject, CLASS_Abstract|CLASS_Intrinsic, ...)
    GENERATED_BODY()

    // 가상 함수들 (리플렉션/직렬화/GC/에디터)
};
```

**제공 기능:**

| 기능 카테고리 | 대표 메서드 | 설명 |
|--------------|------------|------|
| **생명주기** | `PostInitProperties()` | 생성 후, 프로퍼티 초기화 완료 시 |
|  | `PostLoad()` | 디스크에서 로드 후 |
|  | `BeginDestroy()` | 소멸 시작 (클린업) |
|  | `FinishDestroy()` | 최종 소멸 (메모리 해제 직전) |
| **직렬화** | `Serialize(FArchive&)` | 커스텀 직렬화/역직렬화 |
|  | `PreSave()`, `PostSave()` | 저장 전후 처리 |
| **리플렉션** | `ProcessEvent()` | UFunction 호출 (블루프린트/RPC) |
|  | `CallFunction()` | 함수 실행 |
| **에디터** | `Modify()` | 언두/리두 버퍼에 저장 |
|  | `PostEditChangeProperty()` | 프로퍼티 변경 알림 |
| **서브오브젝트** | `CreateDefaultSubobject<T>()` | 컴포넌트 생성 (생성자에서만) |
|  | `GetDefaultSubobjects()` | 서브오브젝트 목록 |
| **네트워킹** | `GetLifetimeReplicatedProps()` | 리플리케이션 설정 |
|  | `IsSupportedForNetworking()` | 네트워크 지원 여부 |
| **GC 커스텀** | `AddReferencedObjects()` | UPROPERTY 외 참조 추가 |

**소스 검증 예시:**
```cpp
// Object.h:225
virtual void PostInitProperties();

// Object.h:286
virtual void PreSave(FObjectPreSaveContext SaveContext);

// Object.h:311 (에디터만)
virtual bool Modify(bool bAlwaysMarkDirty=true);

// Object.h:128
UObject* CreateDefaultSubobject(
    FName SubobjectFName,
    UClass* ReturnType,
    UClass* ClassToCreateByDefault,
    bool bIsRequired,
    bool bIsTransient
);
```

**핵심 책임:** "오브젝트의 행동, 리플렉션, 직렬화, 이벤트 처리"

---

### 계층 분리의 설계 의도

UObjectBase, UObjectBaseUtility, UObject를 **왜 이렇게 나눴는가?**

| 이유 | 설명 | 효과 |
|------|------|------|
| **1. 빌드 종속성 최소화** | UObjectBase는 엔진 코어에서 사용되므로, 상위 유틸 기능(UObject)을 분리해서 종속성 감소 | 엔진 부팅 초기에 GC, 메모리 등록만 필요한 경우 UObjectBase만 링크 |
| **2. 모듈 경량화** | Cooked 빌드나 전용 서버에서 일부 기능 생략 가능 | 에디터 전용 기능(Modify, PostEditChange) 제외 시 크기 감소 |
| **3. 컴파일 속도 개선** | 모든 UObject에 "리플렉션/직렬화/VM 호출" 코드가 붙으면 불필요하게 거대해짐 | 헤더 변경 시 재컴파일 범위 축소 |
| **4. 책임 분리 (SoC)** | - UObjectBase: 존재와 정체성<br>- UObjectBaseUtility: 검색과 관리<br>- UObject: 행동과 리플렉션 | 각 계층의 역할이 명확해짐 |
| **5. 커스텀 런타임 지원** | 엔진 포크 시 특정 계층만 수정 가능 | 예: 경량 스크립팅 엔진에서 UObject 제거하고 UObjectBaseUtility까지만 사용 |

**핵심 철학:**
> UObjectBase는 "존재를 관리",
> UObjectBaseUtility는 "찾고 다루는 기능",
> UObject는 "행동과 리플렉션"을 담당한다.

---

### 계층별 책임 분리 (시각화)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        UObjectBase (존재와 정체성)                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ 전역 배열 등록       │  │ 기본 메타데이터      │                      │
│  │ InternalIndex 관리  │  │ Class, Name, Outer  │                      │
│  └──────────┬──────────┘  └──────────┬──────────┘                      │
│             │                        │                                  │
│             └────────┬───────────────┘                                  │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ 플래그 저장          │  │ 메모리 관리          │                      │
│  │ ObjectFlags         │  │ 생성/소멸            │                      │
│  └──────────┬──────────┘  └──────────┬──────────┘                      │
│             │                        │                                  │
└─────────────┼────────────────────────┼──────────────────────────────────┘
              │                        │
              ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                 UObjectBaseUtility (검색과 관리)                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ 플래그 유틸리티      │  │ GC 유틸리티          │                      │
│  │ SetFlags, HasFlags  │  │ AddToRoot,          │                      │
│  │                     │  │ MarkAsGarbage       │                      │
│  └──────────┬──────────┘  └──────────┬──────────┘                      │
│             │                        │                                  │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ 검색/로드            │  │ 이름/경로            │                      │
│  │ FindObject,         │  │ GetFullName,        │                      │
│  │ LoadObject          │  │ GetPathName         │                      │
│  └──────────┬──────────┘  └──────────┬──────────┘                      │
│             │                        │                                  │
│  ┌─────────────────────┐             │                                  │
│  │ 타입 체크            │             │                                  │
│  │ IsA, GetWorld       │             │                                  │
│  └──────────┬──────────┘             │                                  │
│             │                        │                                  │
└─────────────┼────────────────────────┼──────────────────────────────────┘
              │                        │
              ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    UObject (행동과 리플렉션)                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ 생명주기 훅          │  │ 직렬화              │                      │
│  │ PostInit, PostLoad  │  │ Serialize, PreSave  │                      │
│  └─────────────────────┘  └─────────────────────┘                      │
│                                                                         │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ 리플렉션             │  │ 에디터 통합          │                      │
│  │ ProcessEvent,       │  │ Modify,             │                      │
│  │ UFunction           │  │ PostEditChange      │                      │
│  └─────────────────────┘  └─────────────────────┘                      │
│                                                                         │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ GC 커스텀            │  │ 서브오브젝트         │                      │
│  │ AddReferencedObjects│  │ CreateDefaultSub    │                      │
│  └─────────────────────┘  └─────────────────────┘                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

             데이터 흐름 및 의존성:

    UObjectBase                UObjectBaseUtility              UObject
         │                             │                         │
         ├─ 전역 배열 ──────────────>  플래그 유틸 ──────────>  에디터 통합
         │                             │                         │
         ├─ 메타데이터 ─────────────>  검색/로드 ──────────────>  직렬화
         │                             │                         │
         ├─ 플래그 저장 ─────────────>  GC 유틸 ───────────────>  GC 커스텀
         │                             │                         │
         └─ 메모리 관리 ─────────────────────────────────────────>  생명주기 훅
                                       │
                                       ├─ 이름/경로 ──────────>  리플렉션
                                       │
                                       └─ 타입 체크 ──────────>  서브오브젝트
```

**계층별 데이터 흐름:**
```
[게임 코드]
    ↓
┌──────────────────────────────────────────┐
│           UObject (사용자 인터페이스)      │
│  - ProcessEvent() → 블루프린트 호출       │
│  - Serialize() → 저장/로드               │
│  - Modify() → 언두/리두                  │
└──────────────────┬───────────────────────┘
                   ↓
┌──────────────────────────────────────────┐
│      UObjectBaseUtility (편의 레이어)     │
│  - IsA() → 타입 체크                     │
│  - GetWorld() → 월드 접근                │
│  - AddToRoot() → GC 루트 관리            │
└──────────────────┬───────────────────────┘
                   ↓
┌──────────────────────────────────────────┐
│        UObjectBase (엔진 코어)            │
│  - GUObjectArray 등록                    │
│  - InternalIndex 할당                    │
│  - 메모리 생명주기 관리                   │
└──────────────────┬───────────────────────┘
                   ↓
         [FUObjectArray 전역 배열]
```

---

### 객체 생명주기와 계층별 역할

UObject가 생성되어 소멸되기까지 각 계층이 어떻게 협력하는지 단계별로 설명합니다.

#### 1️⃣ **객체 생성 단계**

```
    게임 코드          NewObject<T>()    StaticAllocate   UObjectBase   UObjectBaseUtility   UObject   GUObjectArray
       │                   │                   │                │                │               │           │
       │ NewObject<MyObj>()│                   │                │                │               │           │
       ├──────────────────>│                   │                │                │               │           │
       │                   │ Allocate          │                │                │               │           │
       │                   ├──────────────────>│                │                │               │           │
       │                   │                   │                │                │               │           │
       │                   │                   │ ┌──────────────────────────────────────────────────────┐   │
       │                   │                   │ │ UObjectBase 생성자                                   │   │
       │                   │                   │ └──────────────────────────────────────────────────────┘   │
       │                   │                   │  UObjectBase()  │                │               │           │
       │                   │                   ├────────────────>│                │               │           │
       │                   │                   │                 │                │               │           │
       │                   │                   │  ClassPrivate = MyClass          │               │           │
       │                   │                   │  NamePrivate  = "MyObject"       │               │           │
       │                   │                   │  OuterPrivate = Outer            │               │           │
       │                   │                   │  ObjectFlags  = RF_NoFlags       │               │           │
       │                   │                   │                 │                │               │           │
       │                   │                   │                 │   AddObject()  │               │           │
       │                   │                   │                 ├───────────────────────────────────────────>│
       │                   │                   │                 │                │               │  [등록]   │
       │                   │                   │                 │<───────────────────────────────────────────┤
       │                   │                   │                 │  InternalIndex = 12345        │  Index=12345
       │                   │                   │                 │                │               │           │
       │                   │                   │                 │                │               │           │
       │                   │                   │ ┌──────────────────────────────────────────────────────┐   │
       │                   │                   │ │ UObjectBaseUtility 생성자 (pass-through)            │   │
       │                   │                   │ └──────────────────────────────────────────────────────┘   │
       │                   │                   │  BaseUtility()  │                │               │           │
       │                   │                   ├─────────────────┼───────────────>│               │           │
       │                   │                   │                 │                │               │           │
       │                   │                   │                 │                │               │           │
       │                   │                   │ ┌──────────────────────────────────────────────────────┐   │
       │                   │                   │ │ UObject 생성자                                       │   │
       │                   │                   │ └──────────────────────────────────────────────────────┘   │
       │                   │                   │  UObject()      │                │               │           │
       │                   │                   ├─────────────────┼────────────────┼──────────────>│           │
       │                   │                   │                 │                │               │           │
       │                   │                   │                 │                │  CreateDefaultSub()       │
       │                   │                   │                 │                │  PostInitProperties()     │
       │                   │                   │                 │                │  (UPROPERTY 초기화)        │
       │                   │                   │                 │                │  (블루프린트 등록)         │
       │                   │                   │                 │                │               │           │
       │                   │   return MyObject*│                 │                │               │           │
       │<──────────────────┼───────────────────┼─────────────────┼────────────────┼───────────────┤           │
       │                   │                   │                 │                │               │           │

   [완료] UMyObject* 반환 (InternalIndex=12345, GUObjectArray에 등록됨)
```

**텍스트 플로우:**
```
NewObject<UMyObject>() 호출
    ↓
StaticAllocateObject() (엔진 내부)
    ↓
┌─────────────────────────────────────┐
│  UObjectBase 생성자 실행             │
│  ─────────────────────────────────  │
│  1. ClassPrivate = UMyObject::StaticClass() │
│  2. NamePrivate = "MyObject"         │
│  3. OuterPrivate = GetTransientPackage() │
│  4. ObjectFlags = RF_NoFlags         │
│  5. AddObject() 호출                 │
│     └→ GUObjectArray.AllocateIndex() │ ← ★ 전역 배열에 등록
│     └→ InternalIndex = 12345        │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  UObjectBaseUtility 생성자           │
│  (로직 없음, pass-through)           │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  UObject 생성자 실행                 │
│  ─────────────────────────────────  │
│  1. CreateDefaultSubobject() 호출    │
│     (컴포넌트 생성)                  │
│  2. PostInitProperties() 호출        │ ← ★ 리플렉션 초기화
│     - UPROPERTY 기본값 적용         │
│     - 블루프린트 이벤트 등록         │
└─────────────────────────────────────┘
```

**핵심 포인트:**
- **UObjectBase:** 엔진이 객체를 인식하는 순간 (GUObjectArray 등록)
- **UObject:** 리플렉션, 프로퍼티, 이벤트 시스템 활성화

---

#### 2️⃣ **리플렉션 등록 단계** (컴파일 타임 + 런타임)

```
UHT (Unreal Header Tool) - 컴파일 전 실행
    ↓
MyObject.generated.h 생성
    ↓
Z_Construct_UClass_UMyObject() 함수 생성
    ↓
    ├─ StaticRegisterNativesUMyObject()
    │     └→ UFunction 등록 (함수 이름 ↔ 실행 포인터)
    │
    └─ ConstructUClass()
          └→ UClass 오브젝트 생성
                ├─ FProperty 배열 (UPROPERTY 메타데이터)
                ├─ UFunction 배열 (UFUNCTION 메타데이터)
                └─ DefaultObject (CDO) 생성
```

**UClass의 역할:**
- UMyObject 클래스 자체를 설명하는 리플렉션 메타데이터
- GC가 `UPROPERTY` 순회 시 이 메타데이터 사용

**CDO (Class Default Object):**
- 클래스의 초기 상태를 복제할 때 사용하는 템플릿 객체
- `GetDefault<UMyObject>()`로 접근 가능

---

#### 3️⃣ **런타임 사용 단계**

```cpp
// UObjectBaseUtility 편의 기능 사용
UMyObject* Obj = ...;

// 타입 체크
if (Obj->IsA<AActor>())  // UObjectBaseUtility::IsA()

// 월드 접근
UWorld* World = Obj->GetWorld();  // UObjectBaseUtility::GetWorld()

// 경로 문자열
FString Path = Obj->GetPathName();  // "/Game/MyPackage/MyObject"

// GC 루트 관리
Obj->AddToRoot();  // UObjectBaseUtility::AddToRoot()
```

---

#### 4️⃣ **가비지 컬렉션 단계**

```
GC 시작 (엔진 타이머 또는 명시적 호출)
    ↓
┌─────────────────────────────────────┐
│  마크 단계 (Mark Phase)              │
│  ─────────────────────────────────  │
│  1. 루트 셋 초기화                   │
│     - GUObjectArray에서 IsRooted() == true 수집 │
│     - UObjectBaseUtility::IsRooted() 사용  │
│                                      │
│  2. 리플렉션 순회                    │
│     For each UPROPERTY:              │
│       - UClass 메타데이터에서 FProperty 읽기 │
│       - UObject* 포인터 발견 시 마크  │
│       - 재귀적으로 참조 체인 탐색     │
│                                      │
│  3. 커스텀 참조                      │
│     - UObject::AddReferencedObjects() 호출 │
│       (UPROPERTY 외 참조 추가)       │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  스윕 단계 (Sweep Phase)             │
│  ─────────────────────────────────  │
│  For each 마크되지 않은 오브젝트:    │
│    1. BeginDestroy() 호출 (UObject) │
│    2. FinishDestroy() 호출 (UObject)│
│    3. GUObjectArray에서 제거 (UObjectBase) │
│    4. InternalIndex 재사용 목록에 추가 │
└─────────────────────────────────────┘
```

**계층별 역할:**
- **UObjectBase:** GUObjectArray 관리 (InternalIndex 할당/해제)
- **UObjectBaseUtility:** IsRooted, MarkAsGarbage 등 GC 유틸
- **UObject:** BeginDestroy, AddReferencedObjects 등 GC 훅

---

#### 5️⃣ **객체 소멸 단계**

```
GC가 수집 대상으로 결정 또는 명시적 MarkAsGarbage()
    ↓
┌─────────────────────────────────────┐
│  UObject::BeginDestroy()             │
│  ─────────────────────────────────  │
│  - 리소스 해제 (타이머, 델리게이트)  │
│  - 서브오브젝트 정리                 │
│  - RF_BeginDestroyed 플래그 설정    │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  UObject::FinishDestroy()            │
│  ─────────────────────────────────  │
│  - 최종 정리 (메모리 해제 직전)      │
│  - RF_FinishDestroyed 플래그 설정   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  UObjectBase::~UObjectBase()         │
│  ─────────────────────────────────  │
│  - GUObjectArray에서 제거            │
│  - InternalIndex를 재사용 목록에 추가 │
│  - TWeakObjectPtr 무효화            │
│     (SerialNumber = 0)               │
└─────────────────────────────────────┘
    ↓
메모리 해제 (FMemory::Free)
```

### 오브젝트 명명

모든 UObject는 다음을 가집니다:
- **FName** - Outer 내에서 고유한 이름 (빠르고 대소문자 구분 없음)
- **Outer** - 소유자/컨테이너 (일반적으로 UPackage)
- **전체 경로 (Full Path)** - 예: `/Game/MyProject/Blueprints/MyActor.MyActor`

```cpp
UObject* Object = ...;
FName Name = Object->GetFName();                  // "MyActor"
FString FullName = Object->GetFullName();         // "MyActor /Game/.../MyActor"
FString PathName = Object->GetPathName();         // "/Game/.../MyActor"
UPackage* Package = Object->GetPackage();         // 이 오브젝트를 포함하는 패키지
UObject* Outer = Object->GetOuter();              // 직접 소유자
```

---

## 🧩 주요 API

### 오브젝트 생성

```cpp
// 템플릿 기반 생성 (권장)
UMyObject* MyObject = NewObject<UMyObject>(
    Outer,                    // 소유자 (nullptr = 임시 패키지)
    UMyObject::StaticClass(), // 인스턴스화할 클래스
    Name,                     // FName (NAME_None = 자동 생성)
    Flags,                    // EObjectFlags
    Template                  // 복사할 템플릿 오브젝트
);

// 간단한 생성
UMyObject* Simple = NewObject<UMyObject>();

// 특정 outer와 함께
UMyObject* Persistent = NewObject<UMyObject>(GetTransientPackage());

// 클래스 기본 오브젝트 (CDO) 접근
UMyObject* CDO = GetMutableDefault<UMyObject>();
const UMyObject* ConstCDO = GetDefault<UMyObject>();
```

### 서브오브젝트 (컴포넌트) 생성

```cpp
// 생성자에서만!
UCLASS()
class AMyActor : public AActor
{
    GENERATED_BODY()

public:
    AMyActor()
    {
        // CreateDefaultSubobject - 생성자에서만 호출해야 함
        MeshComponent = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("MeshComp"));

        // 선택적 서브오브젝트 (자식 클래스가 억제 가능)
        OptionalComp = CreateOptionalDefaultSubobject<UMyComponent>(TEXT("OptComp"));

        // 루트 컴포넌트로 설정
        RootComponent = MeshComponent;
    }

private:
    UPROPERTY()
    UStaticMeshComponent* MeshComponent;

    UPROPERTY()
    UMyComponent* OptionalComp;
};
```

### 타입 확인 및 캐스팅

```cpp
UObject* Obj = GetSomeObject();

// 타입 확인
if (Obj->IsA<AActor>())
{
    // Obj는 AActor 또는 파생 클래스
}

if (Obj->IsA(AActor::StaticClass()))
{
    // 동일하지만 UClass*로
}

// 캐스팅
AActor* Actor = Cast<AActor>(Obj);            // 잘못된 타입이면 nullptr 반환
if (Actor)
{
    // Actor를 안전하게 사용
}

// 체크된 캐스트 (잘못된 타입이면 어설트)
AActor* ActorChecked = CastChecked<AActor>(Obj);

// 인터페이스 캐스팅
IMyInterface* Interface = Cast<IMyInterface>(Obj);

// 정확한 타입 체크 (상속 없음)
if (Obj->GetClass() == AActor::StaticClass())
{
    // Obj는 정확히 AActor, 서브클래스 아님
}
```

### 오브젝트 찾기 및 로딩

```cpp
// 경로로 로드된 오브젝트 찾기
UObject* Found = FindObject<UObject>(nullptr, TEXT("/Game/MyAsset"));

// 오브젝트 찾기 또는 로드
UObject* Loaded = LoadObject<UObject>(nullptr, TEXT("/Game/MyAsset"));

// 정적 로드 (컴파일 타임 경로)
UTexture2D* Texture = LoadObject<UTexture2D>(nullptr,
    TEXT("/Game/Textures/MyTexture.MyTexture"));

// 소프트 오브젝트 경로 사용
FSoftObjectPath SoftPath(TEXT("/Game/MyAsset"));
UObject* LoadedFromSoft = SoftPath.TryLoad();

// 에셋 로딩 (대형 에셋에 권장)
TSoftObjectPtr<UStaticMesh> MeshRef = ...;
if (!MeshRef.IsNull() && !MeshRef.IsValid())
{
    UStaticMesh* Mesh = MeshRef.LoadSynchronous();
}
```

### 오브젝트 소멸

```cpp
// 가비지 컬렉션 표시
UObject* Obj = ...;
Obj->MarkAsGarbage();  // 다음 GC 패스에서 수집됨

// 조건부 BeginDestroy
Obj->ConditionalBeginDestroy();

// IsGarbage 체크 (UE 5.4+)
if (Obj->IsGarbage())  // ✅ 최신 방식
{
    // 오브젝트가 가비지로 표시됨
}

// IsPendingKill (UE 5.4부터 Deprecated)
// ⚠️ 더 이상 사용하지 말 것 - IsValid() 사용

// 현대적 유효성 검사
if (IsValid(Obj))
{
    // 오브젝트가 유효하고 킬 대기 상태가 아님
}

// null 체크 없는 검사
if (IsValidChecked(Obj))  // Obj != nullptr 가정
{
    // 오브젝트가 유효함
}
```

### 오브젝트 플래그 관리

```cpp
UObject* Obj = ...;

// 플래그 설정
Obj->SetFlags(RF_Transactional | RF_Public);

// 플래그 지우기
Obj->ClearFlags(RF_Transient);

// 플래그 확인
if (Obj->HasAnyFlags(RF_Transactional))
{
    // 오브젝트가 실행 취소/재실행 지원
}

if (Obj->HasAllFlags(RF_Public | RF_Transactional))
{
    // 오브젝트가 두 플래그 모두 가짐
}

// 모든 플래그 가져오기
EObjectFlags Flags = Obj->GetFlags();
```

### 직렬화

```cpp
// 커스텀 동작을 위해 Serialize 오버라이드
void UMyObject::Serialize(FArchive& Ar)
{
    Super::Serialize(Ar);

    // 커스텀 직렬화
    Ar << CustomData;

    if (Ar.IsLoading())
    {
        // 로딩 관련 로직
    }
    else if (Ar.IsSaving())
    {
        // 저장 관련 로직
    }
}

// 로드 후 초기화
void UMyObject::PostLoad()
{
    Super::PostLoad();

    // 로딩 후 데이터 초기화
    // 오래된 데이터 수정, 버전 업그레이드 등
}
```

### 오브젝트 수정 추적 (트랜잭션)

```cpp
// 오브젝트 수정 (실행 취소/재실행 활성화)
UObject* Obj = ...;
Obj->Modify();  // 실행 취소를 위해 현재 상태 기록

// 프로퍼티 변경
Obj->MyProperty = NewValue;

// 트랜잭션 스코프
{
    FScopedTransaction Transaction(LOCTEXT("MyAction", "My Action"));

    Obj->Modify();
    Obj->MyProperty = NewValue;

    // 트랜잭션이 스코프 종료 시 자동 커밋됨
}
```

### 리플렉션 및 프로퍼티 접근

```cpp
UObject* Obj = ...;
UClass* Class = Obj->GetClass();

// 프로퍼티 순회
for (TFieldIterator<FProperty> It(Class); It; ++It)
{
    FProperty* Property = *It;
    FString PropName = Property->GetName();

    // 프로퍼티 값 접근
    void* ValuePtr = Property->ContainerPtrToValuePtr<void>(Obj);
}

// 이름으로 프로퍼티 찾기
FProperty* Property = Class->FindPropertyByName(TEXT("Health"));
if (Property)
{
    // 값 가져오기
    float* HealthPtr = Property->ContainerPtrToValuePtr<float>(Obj);
    float Health = *HealthPtr;
}

// 이름으로 함수 호출
UFunction* Function = Class->FindFunctionByName(TEXT("TakeDamage"));
if (Function)
{
    struct FParams
    {
        float Damage;
    } Params;
    Params.Damage = 10.0f;

    Obj->ProcessEvent(Function, &Params);
}
```

---

## 💡 팁 & 레퍼런스

### 모범 사례

1. **UObject 참조에는 항상 UPROPERTY() 사용**
   ```cpp
   UPROPERTY()
   UMyObject* MyObject;  // GC 안전

   // 나쁨: UPROPERTY 없는 원시 포인터
   UMyObject* DangerousPointer;  // 댕글링 포인터가 될 수 있음!
   ```

2. **`new`로 UObject를 절대 할당하지 않기**
   ```cpp
   // 잘못됨
   UMyObject* Obj = new UMyObject();  // 이렇게 하지 마세요!

   // 올바름
   UMyObject* Obj = NewObject<UMyObject>();
   ```

3. **CreateDefaultSubobject는 생성자에서만**
   ```cpp
   // 잘못됨
   void UMyObject::SomeFunction()
   {
       Comp = CreateDefaultSubobject<UComponent>(TEXT("Comp"));  // 크래시!
   }

   // 올바름
   UMyObject::UMyObject()
   {
       Comp = CreateDefaultSubobject<UComponent>(TEXT("Comp"));
   }
   ```

4. **원시 포인터 대신 TObjectPtr<> 사용 (UE 5.0+)**
   ```cpp
   UPROPERTY()
   TObjectPtr<AActor> MyActor;  // GC Barrier, 향상된 디버깅, 타입 안전성

   // 원시 포인터도 작동하지만 덜 안전함
   UPROPERTY()
   AActor* LegacyActor;
   ```

5. **사용 전 유효성 검사**
   ```cpp
   if (IsValid(MyObject))
   {
       MyObject->DoSomething();
   }
   ```

### 일반적인 패턴

**싱글톤 패턴 (데이터 컨테이너로서의 CDO):**
```cpp
UCLASS()
class UGameSettings : public UObject
{
    GENERATED_BODY()

public:
    UPROPERTY(EditDefaultsOnly)
    float MaxSpeed = 100.0f;

    static const UGameSettings* Get()
    {
        return GetDefault<UGameSettings>();
    }
};

// 사용법
float Speed = UGameSettings::Get()->MaxSpeed;
```

**임시 런타임 오브젝트:**
```cpp
// 저장되지 않을 임시 오브젝트 생성
UMyObject* Temp = NewObject<UMyObject>(
    GetTransientPackage(),
    NAME_None,
    RF_Transient
);
```

**에셋 참조:**
```cpp
// 하드 참조 (즉시 로드)
UPROPERTY()
UStaticMesh* Mesh;

// 소프트 참조 (온디맨드 로드)
UPROPERTY()
TSoftObjectPtr<UStaticMesh> MeshRef;

// 에셋 경로
UPROPERTY()
FSoftObjectPath MeshPath;
```

### 성능 팁

1. **UObject 생성 최소화** - 오버헤드 있음 (리플렉션 설정, 등록)
2. **자주 생성/소멸되는 오브젝트에 오브젝트 풀링 사용**
3. **순수 데이터에는 구조체 (USTRUCT) 선호** - GC/리플렉션 오버헤드 없음
4. **오브젝트 연산 일괄 처리** - 많은 작은 할당 피하기
5. **GC 성능 모니터링** - `-gc` 통계 사용, 오브젝트 그래프 최소화

### 디버깅 팁

```bash
# 콘솔 명령어
obj list                          # 모든 오브젝트 나열
obj list class=Actor              # 모든 Actor 나열
obj list outer=Package            # 패키지 내 오브젝트 나열
obj dump ClassName                # 오브젝트 세부정보 덤프
obj refs name=ObjectName          # 오브젝트에 대한 참조 찾기
gc.CollectGarbageEveryFrame 1     # 매 프레임 GC 강제 (테스트)
gc.LogGarbageCollectionStats 1    # GC 통계 로그
```

**Visual Studio Natvis:**
- Core는 UObject, UClass, FName 등에 대한 커스텀 디버거 비주얼라이저 제공
- 감시 창에서 오브젝트 이름, 클래스 및 플래그 표시

### 일반적인 함정

❌ **UPROPERTY 없이 원시 UObject 포인터 저장**
```cpp
UMyObject* Obj = NewObject<UMyObject>();  // GC 됩니다!
```

✅ **UPROPERTY 또는 AddReferencedObjects 사용**
```cpp
UPROPERTY()
UMyObject* Obj;  // GC 안전
```

❌ **생성자 외부에서 CreateDefaultSubobject 호출**
```cpp
void Func() { Comp = CreateDefaultSubobject<UComponent>(TEXT("Comp")); }
```

✅ **생성자에서만**
```cpp
UMyClass::UMyClass() { Comp = CreateDefaultSubobject<UComponent>(TEXT("Comp")); }
```

❌ **UObject를 수동으로 삭제**
```cpp
delete MyObject;  // 절대 이렇게 하지 마세요!
```

✅ **가비지 컬렉션 사용**
```cpp
MyObject->MarkAsGarbage();  // 자동으로 수집됨
```

### 오브젝트 수명 주기

```
1. Construction    NewObject<>() / SpawnActor()
   ↓
2. PostInitProperties()  프로퍼티 초기화
   ↓
3. PostLoad() OR PostActorCreated()  디스크에서 로드 또는 새로운 생성
   ↓
4. BeginPlay() (Actor만)  게임 시작
   ↓
5. Tick/Update  런타임
   ↓
6. BeginDestroy()  소멸 시작
   ↓
7. FinishDestroy()  최종 정리
   ↓
8. Memory freed
```

---

## 🆕 UE 5.7 주요 변경사항

### 1. FindObject API 변경 - EFindObjectFlags Enum 사용

**📂 위치:** `Engine/Source/Runtime/CoreUObject/Public/UObject/FindObjectFlags.h:16`

**변경 내용:**

기존의 boolean `ExactClass` 파라미터가 deprecated되고 `EFindObjectFlags` enum으로 대체되었습니다.

```cpp
// ❌ UE 5.6 이전 (Deprecated)
UObject* Found = FindObject<UMyClass>(Outer, TEXT("MyObject"), true);  // ExactClass bool

// ✅ UE 5.7 이후 (권장)
UObject* Found = FindObject<UMyClass>(Outer, TEXT("MyObject"), EFindObjectFlags::ExactClass);
```

**EFindObjectFlags 옵션:**

```cpp
enum class EFindObjectFlags : uint8
{
    None = 0,
    ExactClass = 1 << 0,        // 정확한 클래스만 검색 (서브클래스 제외)
    // 추가 플래그들이 향후 추가될 수 있음
};
ENUM_CLASS_FLAGS(EFindObjectFlags)
```

**마이그레이션:**

```cpp
// 패턴 1: ExactClass = true
FindObject<UMyClass>(Outer, Name, true)
→ FindObject<UMyClass>(Outer, Name, EFindObjectFlags::ExactClass)

// 패턴 2: ExactClass = false (기본값)
FindObject<UMyClass>(Outer, Name, false)
→ FindObject<UMyClass>(Outer, Name, EFindObjectFlags::None)
또는
→ FindObject<UMyClass>(Outer, Name)  // 파라미터 생략 가능
```

---

### 2. EInternalObjectFlags::RefCounted Deprecated

**📂 위치:** `Engine/Source/Runtime/CoreUObject/Public/UObject/ObjectMacros.h:664`

**변경 내용:**

`EInternalObjectFlags::RefCounted` 플래그가 deprecated되었습니다. 대신 `GetRefCount()` 메서드를 사용하여 참조 카운트 존재 여부를 확인해야 합니다.

```cpp
// ❌ UE 5.6 이전 (Deprecated)
if (Object->HasAnyInternalFlags(EInternalObjectFlags::RefCounted))
{
    // 참조 카운트가 있음
}

// ✅ UE 5.7 이후 (권장)
if (Object->GetRefCount() > 0)
{
    // 참조 카운트가 있음
}
```

**이유:**

플래그는 deprecated 마킹되었지만 여전히 내부적으로 사용됩니다. 하지만 외부 코드에서는 `GetRefCount()`를 사용하는 것이 더 명확하고 안전합니다.

---

### 3. GetSubobjectsWithStableNamesForNetworking() Deprecated

**📂 위치:** `Engine/Source/Runtime/CoreUObject/Public/UObject/Object.h:1075`

**변경 내용:**

```cpp
// ❌ UE 5.6 이전 (Deprecated)
UE_DEPRECATED(5.7, "This function is useless now and will be deleted")
virtual void GetSubobjectsWithStableNamesForNetworking(TArray<UObject*> &ObjList) {}
```

**이유:**

이 함수는 더 이상 엔진 내부에서 사용되지 않으며 쓸모없어졌습니다. 네트워킹 서브오브젝트 처리는 다른 메커니즘으로 대체되었습니다.

**대안:**

일반적으로 이 함수를 직접 호출할 필요가 없습니다. 네트워킹 서브오브젝트는 자동으로 처리됩니다. 특별한 네트워킹 요구사항이 있다면:

1. `IsSupportedForNetworking()` 오버라이드
2. `ReplicateSubobjects()` 사용 (Actor Components)
3. `GetLifetimeReplicatedProps()` 사용 (Replication 설정)

---

### 4. Remote Object API 변경

**📂 위치:** `Engine/Source/Runtime/CoreUObject/Public/UObject/UObjectGlobals.h:1311, 1745, 1802`

**변경 내용:**

Remote Object 관련 API들이 deprecated되고 새로운 scope 기반 API로 대체되었습니다:

```cpp
// ❌ UE 5.6 이전 (Deprecated)
UE_DEPRECATED(5.7, "Use FRemoteObjectConstructionOverridesScope instead.")
FObjectInitializer(UObject* InObj,
    const FStaticConstructObjectParameters& StaticConstructParams,
    UE::RemoteObject::Serialization::FRemoteObjectConstructionOverrides* RemoteObjectOverides);

UE_DEPRECATED(5.7, "Use FRemoteObjectConstructionOverridesScope instead.")
UE::RemoteObject::Serialization::FRemoteObjectConstructionOverrides* GetRemoteSubObjectOverrides() const;

// ✅ UE 5.7 이후 (권장)
// FRemoteObjectConstructionOverridesScope 사용
```

**영향:**

일반적인 게임 코드에서는 Remote Object API를 직접 사용하지 않습니다. 이는 엔진 내부 및 특수한 네트워킹 시나리오에서 사용됩니다.

---

### 업데이트된 코드 예시

#### FindObject 사용 (Updated)

```cpp
// === 오브젝트 검색 패턴 ===

// 1. 일반 검색 (서브클래스 포함)
UObject* Found = FindObject<UMyClass>(Outer, TEXT("MyObject"));

// 2. 정확한 클래스만 (UE 5.7+)
UObject* ExactFound = FindObject<UMyClass>(
    Outer,
    TEXT("MyObject"),
    EFindObjectFlags::ExactClass
);

// 3. null Outer (모든 패키지 검색)
UObject* GlobalSearch = FindObject<UMyClass>(nullptr, TEXT("MyObject"));

// 4. 완전한 경로로 검색
UObject* PathFound = FindObject<UObject>(nullptr, TEXT("/Game/MyAsset.MyAsset"));
```

#### 참조 카운트 확인 (Updated)

```cpp
// === 참조 카운트 체크 ===

UObject* Obj = GetSomeObject();

// UE 5.7+ 방식
if (Obj->GetRefCount() > 0)
{
    UE_LOG(LogTemp, Log, TEXT("Object has %d references"), Obj->GetRefCount());
}
else
{
    UE_LOG(LogTemp, Log, TEXT("Object has no external references"));
}
```

---

### 마이그레이션 체크리스트

**프로젝트 전체 검색 및 교체:**

1. ✅ `FindObject.*true` → `EFindObjectFlags::ExactClass`
2. ✅ `FindObject.*false` → `EFindObjectFlags::None` 또는 파라미터 제거
3. ✅ `EInternalObjectFlags::RefCounted` → `GetRefCount()`
4. ✅ `GetSubobjectsWithStableNamesForNetworking` 호출 제거

**컴파일 경고 확인:**

UE 5.7에서 프로젝트를 빌드하면 deprecated API 사용에 대한 경고가 표시됩니다:

```
warning C4996: 'FindObject': FindObject with a boolean ExactClass has been deprecated -
please use the EFindObjectFlags enum instead
```

이러한 경고를 모두 수정하여 향후 버전과의 호환성을 보장하세요.

---

### 🔗 레퍼런스

- [Unreal Engine Objects](https://docs.unrealengine.com/ProgrammingAndScripting/ProgrammingWithCPP/UnrealArchitecture/Objects)
- [Object Handling in Unreal](https://docs.unrealengine.com/object-handling-in-unreal-engine/)
- [Garbage Collection](https://docs.unrealengine.com/unreal-engine-garbage-collection/)
- [UObject Source](Engine/Source/Runtime/CoreUObject/Public/UObject/Object.h)
- [UClass Source](Engine/Source/Runtime/CoreUObject/Public/UObject/Class.h)
- [FindObjectFlags Source](Engine/Source/Runtime/CoreUObject/Public/UObject/FindObjectFlags.h) - **UE 5.7 신규**

---

> 📅 생성: 2025-10-17 — 초기 UObject 시스템 문서
> 🔄 업데이트: 2025-11-06 — UE 5.7 API 변경사항 반영
