---
title: "가비지 컬렉션 (Garbage Collection)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "CoreUObject"
tags: ["unreal", "CoreUObject"]
---
# 가비지 컬렉션 (Garbage Collection)

## 🧭 개요

**언리얼 엔진의 가비지 컬렉션(GC)** 시스템은 UObject의 자동 메모리 관리를 담당하는 핵심 시스템입니다. C++의 수동 메모리 관리와 달리, UObject는 자동으로 추적되고 참조가 없을 때 정리됩니다.

**핵심 원칙:**
- **루트 기반 추적 (Root-Based Tracing)** - 루트 오브젝트에서 시작해 도달 가능한 모든 오브젝트를 추적
- **마크-스윕 알고리즘 (Mark-Sweep Algorithm)** - 표시(mark) 후 수집(sweep) 방식
- **UPROPERTY 기반 참조 추적** - 리플렉션 메타데이터를 통한 자동 참조 탐지
- **증분 및 멀티스레드 지원** - 게임 실행 중 성능 영향 최소화

**주요 기능:**
- 자동 메모리 관리 (메모리 누수 방지)
- 댕글링 포인터 방지
- 순환 참조 처리
- 에디터 실행 취소/재실행 지원
- 네트워크 리플리케이션과의 통합

**모듈 위치:** `Engine/Source/Runtime/CoreUObject/Public/UObject/`

**핵심 파일:**
- `GarbageCollection.h` - GC 인터페이스 및 설정
- `UObjectArray.h` - FUObjectArray (전역 오브젝트 관리)
- `UObjectBaseUtility.h` - AddToRoot, MarkAsGarbage
- `UnrealType.h` - FProperty (참조 추적)

**엔진 버전:** Unreal Engine 5.6.1 (2025년 기준)

---

## 🧱 GC 아키텍처

### GC 작동 원리 (전체 프로세스)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Unreal Garbage Collection System                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [1] 루트 셋 구성 (Root Set Construction)                               │
│                                                                         │
│   ┌──────────────────────────────────────┐                            │
│   │  루트 소스 (Root Sources)            │                            │
│   ├──────────────────────────────────────┤                            │
│   │  • RF_MarkAsRootSet 플래그           │                            │
│   │  • AddToRoot() 호출한 오브젝트        │                            │
│   │  • UWorld 및 활성 레벨               │                            │
│   │  • 로드된 패키지                     │                            │
│   │  • CDO (Class Default Object)        │                            │
│   │  • TStrongObjectPtr<T>               │                            │
│   │  • FGCObject 구현 클래스             │                            │
│   └──────────────────────────────────────┘                            │
│                     ↓                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  GUObjectArray에서 루트 수집          │                            │
│   │                                      │                            │
│   │  for (int32 i = 0; i < NumObjects; ++i)                           │
│   │  {                                   │                            │
│   │      if (Objects[i]->IsRooted())     │                            │
│   │          RootSet.Add(Objects[i]);    │                            │
│   │  }                                   │                            │
│   └──────────────────────────────────────┘                            │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [2] 마크 단계 (Mark Phase)                                             │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────┐        │
│   │  초기 마크 (Initial Mark)                                │        │
│   │  ─────────────────────────────────────────────────────  │        │
│   │  TArray<UObject*> ObjectsToProcess;                      │        │
│   │                                                          │        │
│   │  for (UObject* Root : RootSet)                           │        │
│   │  {                                                       │        │
│   │      Root->SetFlags(RF_ReachableInCluster);              │        │
│   │      ObjectsToProcess.Add(Root);                         │        │
│   │  }                                                       │        │
│   └──────────────────────────────────────────────────────────┘        │
│                     ↓                                                  │
│   ┌──────────────────────────────────────────────────────────┐        │
│   │  참조 추적 (Reference Tracing) - BFS                     │        │
│   │  ─────────────────────────────────────────────────────  │        │
│   │  while (ObjectsToProcess.Num() > 0)                      │        │
│   │  {                                                       │        │
│   │      UObject* Current = ObjectsToProcess.Pop();          │        │
│   │      UClass* Class = Current->GetClass();                │        │
│   │                                                          │        │
│   │      // [A] UPROPERTY 순회                               │        │
│   │      for (FProperty* Prop : Class->GetProperties())      │        │
│   │      {                                                   │        │
│   │          if (FObjectProperty* ObjProp = Cast<>(Prop))    │        │
│   │          {                                               │        │
│   │              UObject* Ref = ObjProp->GetValue(...);      │        │
│   │              if (Ref && !Ref->IsMarked())                │        │
│   │              {                                           │        │
│   │                  Ref->SetFlags(RF_ReachableInCluster);   │        │
│   │                  ObjectsToProcess.Add(Ref);              │        │
│   │              }                                           │        │
│   │          }                                               │        │
│   │      }                                                   │        │
│   │                                                          │        │
│   │      // [B] 커스텀 참조 (AddReferencedObjects)           │        │
│   │      FReferenceCollector Collector;                      │        │
│   │      Current->AddReferencedObjects(Current, Collector);  │        │
│   │      for (UObject* CustomRef : Collector)                │        │
│   │      {                                                   │        │
│   │          if (CustomRef && !CustomRef->IsMarked())        │        │
│   │          {                                               │        │
│   │              CustomRef->SetFlags(RF_ReachableInCluster); │        │
│   │              ObjectsToProcess.Add(CustomRef);            │        │
│   │          }                                               │        │
│   │      }                                                   │        │
│   │                                                          │        │
│   │      // [C] Outer 암묵적 참조                            │        │
│   │      ForEachObjectWithOuter(Current, [&](UObject* Sub)   │        │
│   │      {                                                   │        │
│   │          if (!Sub->IsMarked())                           │        │
│   │          {                                               │        │
│   │              Sub->SetFlags(RF_ReachableInCluster);       │        │
│   │              ObjectsToProcess.Add(Sub);                  │        │
│   │          }                                               │        │
│   │      });                                                 │        │
│   │  }                                                       │        │
│   └──────────────────────────────────────────────────────────┘        │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [3] 스윕 단계 (Sweep Phase)                                            │
│                                                                         │
│   ┌──────────────────────────────────────┐                            │
│   │  미마크 오브젝트 식별                 │                            │
│   │                                      │                            │
│   │  for (int32 i = 0; i < NumObjects; ++i)                           │
│   │  {                                   │                            │
│   │      UObject* Obj = Objects[i];      │                            │
│   │      if (!Obj->HasAnyFlags(RF_ReachableInCluster))                │
│   │      {                               │                            │
│   │          // 가비지로 표시             │                            │
│   │          UnreachableObjects.Add(Obj);│                            │
│   │      }                               │                            │
│   │      else                            │                            │
│   │      {                               │                            │
│   │          // 마크 해제 (다음 GC 준비) │                            │
│   │          Obj->ClearFlags(RF_ReachableInCluster);                  │
│   │      }                               │                            │
│   │  }                                   │                            │
│   └──────────────────────────────────────┘                            │
│                     ↓                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  BeginDestroy 호출                   │                            │
│   │                                      │                            │
│   │  for (UObject* Obj : UnreachableObjects)                          │
│   │  {                                   │                            │
│   │      Obj->ConditionalBeginDestroy(); │                            │
│   │      // - 타이머 해제                │                            │
│   │      // - 델리게이트 언바인드        │                            │
│   │      // - 서브오브젝트 정리           │                            │
│   │  }                                   │                            │
│   └──────────────────────────────────────┘                            │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [4] 소멸 단계 (Finalization)                                           │
│                                                                         │
│   ┌──────────────────────────────────────┐                            │
│   │  FinishDestroy 호출                  │                            │
│   │                                      │                            │
│   │  for (UObject* Obj : UnreachableObjects)                          │
│   │  {                                   │                            │
│   │      Obj->ConditionalFinishDestroy();│                            │
│   │      // - 최종 리소스 해제           │                            │
│   │      // - 메모리 해제 직전 처리      │                            │
│   │  }                                   │                            │
│   └──────────────────────────────────────┘                            │
│                     ↓                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  FUObjectArray에서 제거              │                            │
│   │                                      │                            │
│   │  for (UObject* Obj : UnreachableObjects)                          │
│   │  {                                   │                            │
│   │      GUObjectArray.FreeUObjectIndex(Obj);                         │
│   │      // - InternalIndex 재사용 목록에 추가                        │
│   │      // - TWeakObjectPtr 무효화 (SerialNumber = 0)               │
│   │  }                                   │                            │
│   └──────────────────────────────────────┘                            │
│                     ↓                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  메모리 해제                         │                            │
│   │                                      │                            │
│   │  FMemory::Free(Obj);                 │                            │
│   └──────────────────────────────────────┘                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

                    [완료] GC Cycle 종료
                           ↓
               다음 GC 트리거까지 대기
               (타이머 또는 명시적 호출)
```

### GC 루트 (GC Roots) 계층 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          GC Root Sources                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [1] 전역 루트 (Global Roots)                                           │
│  ┌──────────────────────────────────────┐                             │
│  │ RF_MarkAsRootSet 플래그               │                             │
│  │ ─────────────────────────────────    │                             │
│  │ • AddToRoot() 명시적 호출            │                             │
│  │ • TStrongObjectPtr<T>                │                             │
│  │                                      │                             │
│  │ 예시:                                │                             │
│  │   UObject* Persistent = NewObject<UMyObject>();                    │
│  │   Persistent->AddToRoot();           │                             │
│  │   // 영구 보호 (RemoveFromRoot까지) │                             │
│  └──────────────────────────────────────┘                             │
│                                                                         │
│  [2] 컨텍스트 루트 (Context Roots)                                      │
│  ┌──────────────────────────────────────┐                             │
│  │ 게임 월드 및 레벨                     │                             │
│  │ ─────────────────────────────────    │                             │
│  │ • UWorld                             │                             │
│  │ • ULevel (활성 레벨)                 │                             │
│  │ • 월드의 모든 AActor                 │                             │
│  │                                      │                             │
│  │ 월드 계층:                           │                             │
│  │   UWorld                             │                             │
│  │   └── ULevel                         │                             │
│  │       └── AActor[]                   │                             │
│  │           └── UActorComponent[]      │                             │
│  └──────────────────────────────────────┘                             │
│                                                                         │
│  [3] 패키지 루트 (Package Roots)                                        │
│  ┌──────────────────────────────────────┐                             │
│  │ 로드된 에셋 패키지                    │                             │
│  │ ─────────────────────────────────    │                             │
│  │ • UPackage (로드된 .uasset)          │                             │
│  │ • 패키지 내 모든 오브젝트             │                             │
│  │                                      │                             │
│  │ 예시:                                │                             │
│  │   UPackage                           │                             │
│  │   └── UBlueprint                     │                             │
│  │       ├── UBlueprintGeneratedClass   │                             │
│  │       └── CDO                        │                             │
│  └──────────────────────────────────────┘                             │
│                                                                         │
│  [4] CDO (Class Default Object)                                        │
│  ┌──────────────────────────────────────┐                             │
│  │ 클래스 기본 오브젝트                  │                             │
│  │ ─────────────────────────────────    │                             │
│  │ • GetDefault<UMyClass>()             │                             │
│  │ • 클래스 등록 시 자동 루트            │                             │
│  │ • 엔진 종료까지 유지                 │                             │
│  │                                      │                             │
│  │ 생명주기:                            │                             │
│  │   엔진 시작 → CDO 생성 → 엔진 종료  │                             │
│  └──────────────────────────────────────┘                             │
│                                                                         │
│  [5] FGCObject 커스텀 루트                                              │
│  ┌──────────────────────────────────────┐                             │
│  │ C++ 클래스에서 UObject 참조 보호      │                             │
│  │ ─────────────────────────────────    │                             │
│  │ class FMyManager : public FGCObject  │                             │
│  │ {                                    │                             │
│  │     UObject* ManagedObject;          │                             │
│  │                                      │                             │
│  │     void AddReferencedObjects(...)   │                             │
│  │     {                                │                             │
│  │         Collector.AddReferencedObject(ManagedObject);              │
│  │     }                                │                             │
│  │ };                                   │                             │
│  └──────────────────────────────────────┘                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### UPROPERTY 참조 추적 메커니즘

```
┌─────────────────────────────────────────────────────────────────────────┐
│              UPROPERTY 기반 참조 추적 (컴파일 타임 + 런타임)              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [컴파일 타임] UHT가 메타데이터 생성                                      │
│                                                                         │
│   소스 코드:                                                            │
│   ──────────────────────────────────────                               │
│   UCLASS()                                                              │
│   class UMyObject : public UObject                                      │
│   {                                                                     │
│       GENERATED_BODY()                                                  │
│                                                                         │
│       UPROPERTY()                                                       │
│       UOtherObject* Reference;  // ← GC 추적 대상                       │
│                                                                         │
│       UPROPERTY()                                                       │
│       TArray<AActor*> Actors;   // ← 컨테이너 내부도 추적               │
│   };                                                                    │
│                                                                         │
│   ↓ UHT 실행                                                            │
│                                                                         │
│   생성된 메타데이터 (MyObject.gen.cpp):                                  │
│   ──────────────────────────────────────                               │
│   // Reference 프로퍼티 메타데이터                                       │
│   static FObjectProperty* NewProp_Reference = new FObjectProperty(      │
│       FObjectInitializer(),                                             │
│       EC_InternalUseOnlyConstructor,                                    │
│       UMyObject::StaticClass(),                                         │
│       TEXT("Reference"),                                                │
│       STRUCT_OFFSET(UMyObject, Reference),  // ← 오프셋                 │
│       EPropertyFlags::CPF_None,                                         │
│       UOtherObject::StaticClass()           // ← 타입 정보              │
│   );                                                                    │
│                                                                         │
│   // Actors 프로퍼티 메타데이터                                          │
│   static FArrayProperty* NewProp_Actors = new FArrayProperty(...);      │
│   static FObjectProperty* NewProp_Actors_Inner = new FObjectProperty(   │
│       ..., AActor::StaticClass()  // ← 배열 요소 타입                   │
│   );                                                                    │
│                                                                         │
│   // UClass에 프로퍼티 등록                                              │
│   UClass* Class = UMyObject::StaticClass();                             │
│   Class->AddProperty(NewProp_Reference);                                │
│   Class->AddProperty(NewProp_Actors);                                   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [런타임] GC가 메타데이터를 사용해 참조 추적                              │
│                                                                         │
│   void MarkPhase()                                                      │
│   {                                                                     │
│       UObject* Current = ...;                                           │
│       UClass* Class = Current->GetClass();                              │
│                                                                         │
│       // 1. 클래스의 모든 프로퍼티 순회                                  │
│       for (FProperty* Prop : Class->GetProperties())                    │
│       {                                                                 │
│           // 2. UObject 포인터 프로퍼티인지 확인                         │
│           if (FObjectProperty* ObjProp = CastField<FObjectProperty>(Prop))│
│           {                                                             │
│               // 3. 오프셋으로 값 포인터 계산                            │
│               void* ValuePtr = ObjProp->ContainerPtrToValuePtr<void>(Current);│
│                                                                         │
│               // 4. 참조된 오브젝트 얻기                                 │
│               UObject* Referenced = ObjProp->GetObjectPropertyValue(ValuePtr);│
│                                                                         │
│               // 5. 마크 및 큐 추가                                      │
│               if (Referenced && !Referenced->IsMarked())                │
│               {                                                         │
│                   Referenced->SetFlags(RF_ReachableInCluster);          │
│                   ObjectsToProcess.Add(Referenced);                     │
│               }                                                         │
│           }                                                             │
│           // 6. 배열 프로퍼티 처리                                       │
│           else if (FArrayProperty* ArrayProp = CastField<FArrayProperty>(Prop))│
│           {                                                             │
│               FScriptArray* Array = ArrayProp->GetPropertyValuePtr(...);│
│               FProperty* InnerProp = ArrayProp->Inner;                  │
│                                                                         │
│               if (FObjectProperty* InnerObjProp = CastField<>(InnerProp))│
│               {                                                         │
│                   for (int32 i = 0; i < Array->Num(); ++i)              │
│                   {                                                     │
│                       UObject* Element = InnerObjProp->GetObjectPropertyValue(...)│
│                       if (Element && !Element->IsMarked())              │
│                       {                                                 │
│                           Element->SetFlags(RF_ReachableInCluster);     │
│                           ObjectsToProcess.Add(Element);                │
│                       }                                                 │
│                   }                                                     │
│               }                                                         │
│           }                                                             │
│       }                                                                 │
│   }                                                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

핵심 포인트:
1. UPROPERTY 매크로가 컴파일 타임에 FProperty 메타데이터 생성
2. 메타데이터에는 오프셋, 타입, 플래그 정보 포함
3. GC가 런타임에 메타데이터를 읽어 참조 자동 추적
4. 개발자는 UPROPERTY만 추가하면 GC가 알아서 처리
```

---

## 🔬 설계 철학: 왜 마크-스윕인가?

### GC 알고리즘 비교

| 알고리즘 | 작동 방식 | 장점 | 단점 | 사용 예시 |
|---------|----------|------|------|----------|
| **참조 카운팅<br>(Reference Counting)** | 각 오브젝트가 참조 수 저장,<br>0이 되면 즉시 해제 | - 즉시 메모리 회수<br>- 결정론적 타이밍 | - 순환 참조 처리 불가<br>- 참조 업데이트 오버헤드<br>- 멀티스레드 어려움 | C++ `shared_ptr` |
| **마크-스윕<br>(Mark-Sweep)** | 루트에서 도달 가능한<br>오브젝트 마크 후 미마크 수집 | ✅ 순환 참조 처리<br>✅ 낮은 참조 오버헤드<br>✅ 멀티스레드 친화적 | - GC 일시 정지<br>- 메모리 회수 지연 | **Unreal Engine**<br>Java, C#, Python |
| **복사 수집<br>(Copying GC)** | 살아있는 오브젝트를<br>새 공간으로 복사 | - 메모리 압축<br>- 할당 빠름 | - 메모리 2배 필요<br>- 포인터 업데이트 복잡 | JVM 젊은 세대 |
| **세대별 GC<br>(Generational GC)** | 오브젝트를 세대로 분류,<br>젊은 세대 자주 수집 | - 효율적 (대부분 젊음)<br>- 긴 GC 방지 | - 구현 복잡<br>- 메모리 오버헤드 | JVM, .NET |

**언리얼이 마크-스윕을 선택한 이유:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   마크-스윕 선택의 핵심 이유                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 순환 참조 처리 (Circular Reference Handling)                        │
│     ─────────────────────────────────────────────────────────────────  │
│     게임에서 순환 참조는 흔함:                                           │
│                                                                         │
│     AActor ←→ UActorComponent                                           │
│     Parent ←→ Child                                                     │
│     Controller ←→ Pawn                                                  │
│                                                                         │
│     참조 카운팅: ❌ 순환 참조 누수 (weak_ptr로 해결 필요)                │
│     마크-스윕:   ✅ 자동 처리 (도달 불가능하면 수집)                      │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  2. 낮은 참조 오버헤드 (Low Reference Overhead)                         │
│     ─────────────────────────────────────────────────────────────────  │
│     [참조 카운팅]                                                       │
│     • 포인터 할당마다 카운트 증가 (원자적 연산)                          │
│     • 포인터 해제마다 카운트 감소 (원자적 연산)                          │
│     • 멀티스레드에서 캐시 경합 (cache contention)                        │
│                                                                         │
│     비용: 포인터 할당/해제당 ~50ns (원자적 연산)                         │
│                                                                         │
│     [마크-스윕]                                                         │
│     • 포인터 할당/해제 비용 없음                                         │
│     • UPROPERTY에 저장만 하면 됨                                         │
│                                                                         │
│     비용: 0ns (GC 시간에만 처리)                                         │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  3. UPROPERTY 리플렉션 활용 (Reflection Integration)                    │
│     ─────────────────────────────────────────────────────────────────  │
│     언리얼은 이미 리플렉션 시스템 보유:                                   │
│     • UHT가 UPROPERTY 메타데이터 생성                                    │
│     • FProperty로 모든 멤버 변수 추적 가능                               │
│                                                                         │
│     마크-스윕은 리플렉션과 완벽히 호환:                                   │
│     • FProperty 순회하며 UObject* 포인터 발견                            │
│     • 추가 코드 불필요 (자동 참조 추적)                                  │
│                                                                         │
│     참조 카운팅: ❌ 모든 참조에 카운터 관리 코드 필요                     │
│     마크-스윕:   ✅ UPROPERTY만 추가하면 끝                               │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  4. 멀티스레드 친화적 (Multithreading)                                  │
│     ─────────────────────────────────────────────────────────────────  │
│     [참조 카운팅]                                                       │
│     • 모든 포인터 조작에 원자적 연산 필요                                │
│     • 캐시 라인 경합 (false sharing)                                     │
│     • 스핀락/뮤텍스 오버헤드                                             │
│                                                                         │
│     [마크-스윕]                                                         │
│     • 게임 스레드는 자유롭게 포인터 조작                                 │
│     • GC 단계에서만 동기화                                               │
│     • 증분 GC로 게임 스레드 영향 최소화                                  │
│                                                                         │
│     성능 비교 (1,000,000회 포인터 할당):                                 │
│     참조 카운팅:  ~50ms (원자적 연산 오버헤드)                           │
│     마크-스윕:    ~1ms (일반 포인터 할당)                                │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  5. 게임 엔진 특성 (Game Engine Characteristics)                        │
│     ─────────────────────────────────────────────────────────────────  │
│     • 오브젝트 수명: 대부분 프레임 단위 또는 레벨 단위                    │
│     • 짧은 수명 오브젝트: 이펙트, 프로젝타일, 파티클                     │
│     • 긴 수명 오브젝트: 레벨, 액터, 컴포넌트                             │
│                                                                         │
│     마크-스윕 장점:                                                     │
│     • 짧은 오브젝트는 한 번에 대량 수집 (효율적)                         │
│     • 긴 오브젝트는 루트로 보호 (안전)                                   │
│     • 레벨 언로드 시 관련 오브젝트 자동 정리                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 계층별 역할 분리

GC 시스템의 핵심 컴포넌트들이 어떻게 협력하여 가비지 컬렉션을 수행하는지 분석합니다.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    FUObjectArray (전역 오브젝트 관리자)                   │
│  "어떤 오브젝트들이 존재하는가?"                                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  책임:                                                                   │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ 오브젝트 등록        │  │ 인덱스 관리          │                      │
│  │ - AllocateIndex()   │  │ - InternalIndex     │                      │
│  │ - FreeIndex()       │  │ - 재사용 목록        │                      │
│  │ - 전역 배열 관리     │  │ - 청크 기반 할당     │                      │
│  └─────────────────────┘  └─────────────────────┘                      │
│                                                                         │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ GC 플래그 저장       │  │ 루트 관리            │                      │
│  │ - RF_Reachable      │  │ - RF_MarkAsRootSet  │                      │
│  │ - RF_Unreachable    │  │ - SetRootSet()      │                      │
│  │ - RF_MirroredGarbage│  │ - IsRooted()        │                      │
│  └─────────────────────┘  └─────────────────────┘                      │
│                                                                         │
└─────────────┬───────────────────────────────────────────────────────────┘
              │ 협력
              ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                       UClass (타입 메타데이터)                            │
│  "이 오브젝트의 구조가 무엇인가?"                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  책임:                                                                   │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ 프로퍼티 목록        │  │ 참조 순회            │                      │
│  │ - PropertyLink      │  │ - ForEachProperty() │                      │
│  │ - FProperty 체인    │  │ - FProperty 반복     │                      │
│  │ - 타입별 분류        │  │ - UObject* 탐지      │                      │
│  └─────────────────────┘  └─────────────────────┘                      │
│                                                                         │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ 클래스 계층          │  │ CDO 관리             │                      │
│  │ - SuperClass        │  │ - ClassDefaultObject│                      │
│  │ - 상속된 프로퍼티    │  │ - 기본값 복사        │                      │
│  │ - 인터페이스         │  │ - 참조 템플릿        │                      │
│  └─────────────────────┘  └─────────────────────┘                      │
│                                                                         │
└─────────────┬───────────────────────────────────────────────────────────┘
              │ 소유
              ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                    FProperty (프로퍼티 메타데이터)                        │
│  "이 데이터가 UObject 참조인가?"                                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  책임:                                                                   │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ 타입 판별            │  │ 값 접근              │                      │
│  │ - FObjectProperty   │  │ - GetValue()        │                      │
│  │ - FArrayProperty    │  │ - GetObjectRef()    │                      │
│  │ - FMapProperty      │  │ - Offset 계산        │                      │
│  └─────────────────────┘  └─────────────────────┘                      │
│                                                                         │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ GC 참조 수집         │  │ 참조 타입 확인       │                      │
│  │ - AddReferencedObjs │  │ - ContainsObjectRef │                      │
│  │ - 컨테이너 순회      │  │ - (bool 플래그)      │                      │
│  │ - 중첩 구조 처리     │  │ - 빠른 필터링        │                      │
│  └─────────────────────┘  └─────────────────────┘                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

             GC 실행 시 협력 흐름:

    FUObjectArray              UClass                  FProperty
         │                        │                        │
         ├─ 루트 수집 ──────────> 클래스 조회 ──────────> (사용 안 함)
         │                        │                        │
         ├─ 마크 단계 ──────────> PropertyLink 순회 ────> UObject* 탐지
         │                        │                        │
         │                        └─ TArray<UObject*> ──> Inner 프로퍼티
         │                        └─ TMap<K,UObject*> ──> Value 프로퍼티
         │                                                 │
         ├─ 마크 전파 ─────────────────────────────────────> (재귀 호출)
         │                                                 │
         └─ 스윕 단계 ──────────> (사용 안 함) ─────────> (사용 안 함)
            (플래그 기반)
```

---

## 🔄 GC 실행 상세 시퀀스

실제 GC 사이클이 어떻게 수행되는지 단계별로 시각화합니다.

### 1️⃣ **GC 트리거 및 초기화**

```
   게임 루프        GC Manager      FUObjectArray     오브젝트 인스턴스
      │                │                 │                   │
      │ Tick()         │                 │                   │
      │ ───────────>   │                 │                   │
      │                │                 │                   │
      │  [메모리 압력 감지]              │                   │
      │                │                 │                   │
      │  If (메모리 > 역치)              │                   │
      │     Or (명시적 호출)             │                   │
      │                ↓                 │                   │
      │                │                 │                   │
      │  CollectGarbage()                │                   │
      │  ├───────────>│                 │                   │
      │                │                 │                   │
      │                │ [GC 시작]       │                   │
      │                │                 │                   │
      │                │  1. DisallowGC 설정                 │
      │                │  2. BeginGC() 이벤트                │
      │                │  3. 통계 초기화                     │
      │                │                 │                   │
```

### 2️⃣ **루트 수집 단계**

```
   GC Manager      FUObjectArray     UObject (루트 후보)
      │                │                   │
      │ 루트 스캔      │                   │
      ├───────────────>│                   │
      │                │                   │
      │                │  for (i=0; i<Num; i++)
      │                │  {                │
      │                │    FUObjectItem* Item = Objects[i]
      │                │                   │
      │                │    if (IsRooted())│
      │                │    ├─────────────>│
      │                │    │              │ RF_MarkAsRootSet?
      │                │    │              │ TStrongObjectPtr?
      │                │    │              │ FGCObject?
      │                │    │<─────────────┤
      │                │    │ Yes          │
      │                │                   │
      │                │    RootSet.Add(Item)
      │                │                   │
      │                │    + UWorld      │
      │                │    + 로드된 패키지│
      │                │    + CDO (전부)   │
      │                │  }                │
      │                │                   │
      │<───────────────┤                   │
      │ 루트 수: 1234개│                   │
```

### 3️⃣ **마크 단계 (BFS 참조 추적)**

```
   GC Manager        UClass          FProperty        UObject (인스턴스)
      │                │                │                   │
      │ 마크 시작      │                │                   │
      │                │                │                   │
      │  Queue = RootSet                │                   │
      │                │                │                   │
      │  while (Queue not empty)        │                   │
      │  {             │                │                   │
      │    Obj = Queue.Pop()            │                   │
      │    ────────────┼────────────────┼──────────────────>│
      │                │                │                   │
      │    GetClass()  │                │                   │
      │    ────────────>│                │                   │
      │                │                │                   │
      │    ForEachProperty()            │                   │
      │    ────────────>│                │                   │
      │                │ PropertyLink   │                   │
      │                ├───────────────>│                   │
      │                │                │                   │
      │                │  [FProperty 순회]                  │
      │                │                │                   │
      │                │  FObjectProperty?                  │
      │                │                ├─ Yes              │
      │                │                │  GetValue(Obj)    │
      │                │                ├──────────────────>│
      │                │                │                   │
      │                │                │  Read: *(UObject**)(Obj+Offset)
      │                │                │<──────────────────┤
      │                │                │  RefObj = 0x12AB  │
      │                │                │                   │
      │  IsMarked(RefObj)?              │                   │
      │  ────────────────────────────────────────────>     │
      │                 No              │                   │
      │                │                │                   │
      │  SetMarked(RefObj)              │                   │
      │  Queue.Add(RefObj)              │                   │
      │                │                │                   │
      │                │  TArray<UObject*>?                 │
      │                │                ├─ Yes              │
      │                │                │  Inner->ForEach() │
      │                │                │    [배열 순회]     │
      │                │                │    RefObj1, RefObj2, ...
      │                │                │                   │
      │                │  [커스텀 참조]  │                   │
      │    AddReferencedObjects(Obj)    │                   │
      │    ────────────┼────────────────┼──────────────────>│
      │                │                │  // 사용자 정의   │
      │                │                │  Collector.Add(MyRef)
      │                │                │<──────────────────┤
      │                │                │  CustomRef 반환   │
      │  Queue.Add(CustomRef)           │                   │
      │                │                │                   │
      │  }  // while 끝│                │                   │
```

### 4️⃣ **스윕 단계 (미마크 오브젝트 수집)**

```
   GC Manager      FUObjectArray     UObject (미마크)   메모리 할당자
      │                │                   │                 │
      │ 스윕 시작      │                   │                 │
      ├───────────────>│                   │                 │
      │                │                   │                 │
      │  for (i=0; i<Num; i++)            │                 │
      │  {             │                   │                 │
      │    Item = Objects[i]              │                 │
      │                │                   │                 │
      │    if (!IsMarked(Item))           │                 │
      │    {           │                   │                 │
      │                │  [가비지 발견!]   │                 │
      │                │                   │                 │
      │      BeginDestroy()               │                 │
      │      ────────────────────────────>│                 │
      │                │                   │  리소스 정리    │
      │                │                   │  타이머 제거    │
      │                │                   │  델리게이트 해제│
      │                │                   │                 │
      │      FinishDestroy()              │                 │
      │      ────────────────────────────>│                 │
      │                │                   │  최종 클린업    │
      │                │                   │                 │
      │      FreeIndex(i)                 │                 │
      │      ├────────>│                   │                 │
      │                │  ObjAvailableList.Add(i)           │
      │                │  Item->Object = nullptr            │
      │                │                   │                 │
      │      delete Obj│                   │                 │
      │      ─────────────────────────────────────────────>│
      │                │                   │  FMemory::Free │
      │                │                   │                 │
      │    }           │                   │                 │
      │    else        │                   │                 │
      │    {           │                   │                 │
      │      ClearMarked(Item) // 다음 GC 준비              │
      │    }           │                   │                 │
      │  }             │                   │                 │
      │                │                   │                 │
      │<───────────────┤                   │                 │
      │ 수집: 567개    │                   │                 │
      │ 해제: 45.2MB   │                   │                 │
```

### 5️⃣ **GC 완료 및 정리**

```
   GC Manager      게임 루프
      │                │
      │  [GC 종료]     │
      │                │
      │  1. AllowGC 재설정
      │  2. EndGC() 이벤트
      │  3. 통계 업데이트
      │     - Duration: 3.2ms
      │     - Collected: 567 objects
      │     - Freed: 45.2 MB
      │                │
      │  Resume        │
      │  ─────────────>│
      │                │  Tick() 계속
```

---

## 🧩 주요 API

### UPROPERTY 참조 추적

```cpp
UCLASS()
class UMyObject : public UObject
{
    GENERATED_BODY()

public:
    // ✅ GC에서 추적됨 - 안전함
    UPROPERTY()
    UObject* TrackedObject;

    UPROPERTY()
    TArray<UObject*> TrackedArray;

    UPROPERTY()
    TMap<FName, UObject*> TrackedMap;

    // ❌ GC에서 추적 안 됨 - 위험함!
    UObject* UntrackedObject;  // 가비지 컬렉션될 수 있음!
};
```

**UPROPERTY가 하는 일:**

1. **컴파일 타임 (UHT)**
   - `.generated.h`에 메타데이터 생성
   - 프로퍼티 오프셋, 타입 정보 저장

2. **런타임 (GC)**
   - 마크 단계에서 리플렉션 시스템이 모든 UPROPERTY 순회
   - UObject 포인터를 발견하면 해당 오브젝트 마크
   - 컨테이너(TArray, TMap) 내부까지 자동 탐색

### 루트 관리

```cpp
// 오브젝트를 루트로 등록
UObject* MyObject = NewObject<UMyObject>();
MyObject->AddToRoot();  // GC로부터 보호

// 📂 소스: UObjectBaseUtility.h:206
FORCEINLINE void AddToRoot()
{
    GUObjectArray.IndexToObject(InternalIndex)->SetRootSet();
}

// 루트에서 제거
MyObject->RemoveFromRoot();  // GC 가능

// 루트 플래그 확인
if (MyObject->IsRooted())
{
    // 오브젝트가 루트임
}
```

### TObjectPtr - 향상된 오브젝트 포인터 (UE 5.0+)

```cpp
UCLASS()
class UMyClass : public UObject
{
    GENERATED_BODY()

public:
    // ✅ TObjectPtr - 추천 (UE 5.0+)
    UPROPERTY()
    TObjectPtr<AActor> MyActor;

    // ⚠️ 원시 포인터 - 여전히 작동하지만 덜 안전함
    UPROPERTY()
    AActor* LegacyActor;
};
```

**TObjectPtr의 장점:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│                     TObjectPtr<T> 기능 (UE 5.0+)                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. GC Barrier (Write Barrier)                                         │
│     ─────────────────────────────────────────────────────────────────  │
│     TObjectPtr<AActor> Actor = ...;                                     │
│     Actor->DoSomething();  // ← 읽기 시 자동으로 GC에 알림              │
│                                                                         │
│     내부 구현:                                                          │
│     AActor* operator->() const                                          │
│     {                                                                   │
│         AActor* Resolved = ResolveObjectHandle(Handle);                 │
│         // GC에 이 오브젝트가 접근되었음을 알림                         │
│         MarkObjectAsReachable(Resolved);                                │
│         return Resolved;                                                │
│     }                                                                   │
│                                                                         │
│  2. 향상된 디버깅 (Enhanced Debugging)                                  │
│     ─────────────────────────────────────────────────────────────────  │
│     • 댕글링 포인터 감지 (Development 빌드)                             │
│     • 오브젝트 수명 추적                                                │
│     • 메모리 접근 위반 조기 발견                                         │
│                                                                         │
│  3. 미래 최적화 (Future Optimization)                                   │
│     ─────────────────────────────────────────────────────────────────  │
│     • 핸들 기반 (Handle-Based) 참조                                     │
│     • 메모리 재배치 가능 (Relocatable)                                  │
│     • 압축 포인터 (Pointer Compression) 지원                            │
│                                                                         │
│  4. 타입 안전성 (Type Safety)                                           │
│     ─────────────────────────────────────────────────────────────────  │
│     TObjectPtr<AActor> Actor = ...;                                     │
│     TObjectPtr<APawn> Pawn = Actor;  // ❌ 컴파일 에러                  │
│     TObjectPtr<APawn> Pawn = Cast<APawn>(Actor);  // ✅ 명시적 캐스트  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 약한 포인터 (Weak Pointers)

```cpp
UCLASS()
class UMyClass : public UObject
{
    GENERATED_BODY()

public:
    // 약한 참조 - GC를 방해하지 않음
    TWeakObjectPtr<AActor> WeakActorRef;

    void UseWeakRef()
    {
        // 사용 전 유효성 검사 필수
        if (WeakActorRef.IsValid())
        {
            AActor* Actor = WeakActorRef.Get();
            Actor->DoSomething();
        }
        else
        {
            // 오브젝트가 GC됨
        }
    }
};
```

**TWeakObjectPtr 내부 구조:**
```cpp
// 📂 위치: WeakObjectPtr.h

template<typename T>
class TWeakObjectPtr
{
private:
    int32 ObjectIndex;        // FUObjectArray 인덱스
    int32 ObjectSerialNumber; // 시리얼 번호 (무효화 감지)

public:
    bool IsValid() const
    {
        if (ObjectIndex == INDEX_NONE)
            return false;

        FUObjectItem* ObjectItem = GUObjectArray.IndexToObject(ObjectIndex);
        if (!ObjectItem)
            return false;

        // 시리얼 번호 확인 (오브젝트가 재할당되었는지 검사)
        if (ObjectItem->SerialNumber != ObjectSerialNumber)
            return false;

        UObject* Object = ObjectItem->GetObject();
        return Object != nullptr && !Object->IsGarbage();
    }

    T* Get() const
    {
        return IsValid() ? static_cast<T*>(...) : nullptr;
    }
};
```

### 커스텀 참조 추가 (AddReferencedObjects)

```cpp
UCLASS()
class UMyClass : public UObject
{
    GENERATED_BODY()

public:
    // 원시 C++ 컨테이너 - UPROPERTY 불가
    TArray<TSharedPtr<FMyData>> CustomData;

    // 각 FMyData가 UObject* 참조를 가진다고 가정
    virtual void AddReferencedObjects(UObject* InThis, FReferenceCollector& Collector) override
    {
        Super::AddReferencedObjects(InThis, Collector);

        UMyClass* This = CastChecked<UMyClass>(InThis);
        for (auto& Data : This->CustomData)
        {
            if (Data.IsValid() && Data->CachedObject)
            {
                Collector.AddReferencedObject(Data->CachedObject);
            }
        }
    }
};
```

### FGCObject를 통한 C++ 참조 추적

```cpp
// 📂 위치: GarbageCollection.h

class FMyManager : public FGCObject
{
public:
    UObject* ManagedObject;
    TArray<UTexture2D*> Textures;

    // GC가 호출 - 참조 보고
    virtual void AddReferencedObjects(FReferenceCollector& Collector) override
    {
        Collector.AddReferencedObject(ManagedObject);
        Collector.AddReferencedObjects(Textures);
    }

    virtual FString GetReferencerName() const override
    {
        return TEXT("FMyManager");
    }
};

// 사용법
FMyManager Manager;
Manager.ManagedObject = NewObject<UMyObject>();
// ManagedObject는 GC로부터 보호됨
```

---

## 💡 GC 최적화 및 팁

### 성능 모범 사례

```cpp
// ✅ 좋음: 평평한 구조
UCLASS()
class UContainer : public UObject
{
    UPROPERTY()
    TArray<UItem*> Items;  // 100개 오브젝트
};
// GC 깊이: 2단계 (Container → Items)

// ❌ 나쁨: 깊은 참조 체인
UCLASS()
class UNode : public UObject
{
    UPROPERTY()
    UNode* Next;  // 100개 체인
};
// GC 깊이: 100단계 (캐시 미스 다수)
```

### 증분 GC 활성화

```ini
; DefaultEngine.ini
[/Script/Engine.GarbageCollectionSettings]

; 증분 BeginDestroy
gc.IncrementalBeginDestroyEnabled=True

; GC 클러스터링 (관련 오브젝트 그룹화)
gc.CreateGCClusters=True

; 최대 오브젝트 수
gc.MaxObjectsInGame=2097152
gc.MaxObjectsInEditor=12582912

; 멀티스레드 GC
gc.MultithreadedDestructionEnabled=True
```

### 순환 참조 해결

```cpp
// ❌ 순환 참조 - 둘 다 GC 안 됨!
UCLASS()
class UParent : public UObject
{
    UPROPERTY()
    UChild* Child;  // Parent → Child
};

UCLASS()
class UChild : public UObject
{
    UPROPERTY()
    UParent* Parent;  // Child → Parent (순환!)
};

// ✅ 약한 포인터로 해결
UCLASS()
class UParent : public UObject
{
    UPROPERTY()
    UChild* Child;  // 강한 참조
};

UCLASS()
class UChild : public UObject
{
    TWeakObjectPtr<UParent> Parent;  // 약한 참조 (UPROPERTY 없음)
};
```

---

## 🚨 일반적인 함정

### ❌ UPROPERTY 없는 원시 포인터

```cpp
// ❌ 위험: GC될 수 있음!
UCLASS()
class UBad : public UObject
{
    UObject* DangerousPointer;  // UPROPERTY 없음!
};

// ✅ 안전: GC 추적
UCLASS()
class UGood : public UObject
{
    UPROPERTY()
    UObject* SafePointer;
};
```

### ❌ delete 사용

```cpp
// ❌ 절대 안 됨!
UObject* Obj = NewObject<UMyObject>();
delete Obj;  // 크래시!

// ✅ 올바름
Obj->MarkAsGarbage();  // 다음 GC에서 수집
```

### ❌ IsValid 없이 사용

```cpp
// ❌ 위험: 크래시 가능
void Tick()
{
    MyObject->DoSomething();  // MyObject가 GC되었을 수 있음!
}

// ✅ 안전
void Tick()
{
    if (IsValid(MyObject))
    {
        MyObject->DoSomething();
    }
}
```

---

## 🔍 디버깅 팁

### 콘솔 명령어

```bash
# GC 즉시 실행
obj gc

# 매 프레임 GC 강제 (테스트용)
gc.CollectGarbageEveryFrame 1

# GC 통계 로그
gc.LogGarbageCollectionStats 1

# 오브젝트 참조 찾기
obj refs name=MyObject class=MyClass

# GC 클러스터 정보
obj clusters

# 메모리 보고서
memreport -full
```

### Unreal Insights

```bash
# GC 추적
UnrealEditor.exe -trace=default,object -statnamedevents

# Insights에서 확인:
# - ObjectLifetime
# - GarbageCollection
# - ObjectAllocation
```

---

## 📐 EInternalObjectFlags - GC 내부 플래그

**📂 위치:** `CoreUObject/Public/UObject/ObjectMacros.h`

GC 시스템이 내부적으로 사용하는 플래그 값:

```cpp
enum EInternalObjectFlags : int32
{
    // Reachability Flags (GC가 설정)
    Unreachable          = 1 << 14,  // GC Mark Phase에서 제거됨
    MaybeUnreachable     = 1 << 15,  // Incremental GC 중간 상태

    // Root Flags (개발자가 설정)
    RootSet              = 1 << 16,  // GC Root (절대 삭제 안 됨)
    Native               = 1 << 25,  // 네이티브 클래스
    Async                = 1 << 26,  // Async Loading

    // Cluster GC
    ClusterRoot          = 1 << 27,  // Cluster의 Root
    PendingKill          = 1 << 28,  // 삭제 대기 중
};
```

---

## ⚡ Incremental GC 상세 설정

**문제:** Full GC는 수십 ms 소요하여 프레임 드롭 발생

**해결:** Incremental GC - 매 프레임 작은 단위로 실행

```cpp
// Settings
gc.TimeLimitMs = 2.0f  // 프레임당 최대 2ms만 GC 실행

// 실행 예시
Frame 1: Mark 10,000 objects  (2ms)
Frame 2: Mark 10,000 objects  (2ms)
Frame 3: Mark 10,000 objects  (2ms)
...
Frame N: Sweep 5,000 objects  (2ms)
```

**CVars:**
```
gc.IncrementalBeginDestroyEnabled = 1
gc.MaxObjectsNotConsideredByGC = 0  // Root Set 크기
gc.TimeLimitMs = 2.0                // 프레임당 시간 제한
```

### 전형적인 GC 성능 (60 FPS 기준)

```
GC Time: ~2ms / 16.67ms (12%)
Objects Marked: 50,000 objects
Objects Swept: 500 objects
```

---

## 🔗 참고자료

- [Garbage Collection Overview](https://docs.unrealengine.com/unreal-engine-garbage-collection/)
- [Object Handling](https://docs.unrealengine.com/object-handling-in-unreal-engine/)
- [Managing Object References](https://docs.unrealengine.com/managing-object-references/)
- [GarbageCollection.h Source](Engine/Source/Runtime/CoreUObject/Public/UObject/GarbageCollection.h)
- [UObjectBaseUtility.h Source](Engine/Source/Runtime/CoreUObject/Public/UObject/UObjectBaseUtility.h)
- [UObjectArray.h Source](Engine/Source/Runtime/CoreUObject/Public/UObject/UObjectArray.h)
- [Unreal Engine GC 아키텍처 분석](https://www.cnblogs.com/timlly/p/13877623.html)
- [Unreal Object Handling](https://docs.unrealengine.com/5.7/en-US/unreal-object-handling/)

---

> 📅 생성: 2025-10-17 — 가비지 컬렉션 시스템 문서화
> 📅 업데이트: 2025-10-20 — GC 단계 시각화, 설계 철학, TObjectPtr 상세 설명 추가 (UE 5.6.1 검증 완료)
> 🔄 Updated: 2026-02-18 — Memory/ 폴더의 중복 문서에서 고유 내용을 통합
