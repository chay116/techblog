---
title: "UObject 해시 시스템 (UObject Hash System)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "CoreUObject"
tags: ["unreal", "CoreUObject"]
---
# UObject 해시 시스템 (UObject Hash System)

## 🧭 개요

**UObject 해시 시스템**은 언리얼 엔진에서 UObject를 빠르게 검색하기 위한 핵심 인프라입니다. 수백만 개의 오브젝트 중에서 이름, Outer, 클래스 등으로 O(1) 시간에 찾을 수 있도록 여러 해시 테이블을 관리합니다.

**핵심 구성 요소:**
- **FUObjectHashTables** - 글로벌 해시 테이블 집합 (싱글톤)
- **FHashBucket** - 메모리 효율적인 해시 버킷 (1-2개는 인라인, 3개 이상은 TSet/TArray)
- **TBucketMap** - 읽기 잠금을 지원하는 TMap 래퍼
- **해시 테이블 종류:**
  - **Hash** - FName 기반 검색
  - **HashOuter** - Outer 기반 검색
  - **ObjectOuterMap** - Object → Outer 맵
  - **ClassToObjectListMap** - Class → Objects 맵
  - **ClassToChildListMap** - Class → Child Classes 맵
  - **PackageToObjectListMap** - Package → Objects 맵
  - **ObjectToPackageMap** - Object → External Package 맵

**주요 기능:**
- **빠른 검색** - O(1) StaticFindObject, FindObjectWithOuter
- **클래스별 열거** - GetObjectsOfClass, ForEachObjectOfClass
- **Outer 기반 검색** - GetObjectsWithOuter, ForEachObjectWithOuter
- **패키지 관리** - GetObjectsWithPackage, External Package 추적
- **스레드 안전성** - FHashTableLock, TBucketMap 읽기 잠금

**성능:**
- **검색 시간:** O(1) 평균, O(n) 최악 (해시 충돌 시)
- **메모리:** 버킷당 16바이트 (1-2개 오브젝트), 그 이상은 동적 할당
- **스레드 안전:** Lock-free 읽기 (게임 스레드), Write는 잠금 필요

**모듈 위치:**
- `Engine/Source/Runtime/CoreUObject/Public/UObject/UObjectHash.h`
- `Engine/Source/Runtime/CoreUObject/Private/UObject/UObjectHash.cpp`
- `Engine/Source/Runtime/CoreUObject/Private/UObject/UObjectHashPrivate.h`

**엔진 버전:** Unreal Engine 5.7 (2025년 기준)

---

## 🧱 구조

### UObject 해시 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    UObject Hash System Architecture                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [글로벌 싱글톤]                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  FUObjectHashTables::Get()                                       │  │
│  │  ───────────────────────────────────────────────────────────     │  │
│  │  • 싱글톤 인스턴스 (static)                                       │  │
│  │  • 모든 해시 테이블 보유                                          │  │
│  │  • FTransactionallySafeCriticalSection으로 보호                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                             ↓                                           │
│  [해시 테이블 집합]                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                                                                  │  │
│  │  [1] Hash : TBucketMap<int32>                                   │  │
│  │  ───────────────────────────────────────────────────────────    │  │
│  │  • FName 해시 → 오브젝트 목록                                     │  │
│  │  • 키: GetTypeHash(FName)                                        │  │
│  │  • 용도: StaticFindObjectFast()                                  │  │
│  │  • 예시:                                                         │  │
│  │    Hash[GetTypeHash("MyActor")] = { Obj1, Obj2, Obj3 }          │  │
│  │                                                                  │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │                                                                  │  │
│  │  [2] HashOuter : TMultiMap<int32, uint32>                       │  │
│  │  ───────────────────────────────────────────────────────────    │  │
│  │  • (FName 해시 + Outer 포인터) → 오브젝트 인덱스                  │  │
│  │  • 키: GetTypeHash(FName) + (Outer >> 6)                        │  │
│  │  • 용도: 더 나은 해시 분산 (Outer 고려)                           │  │
│  │  • 예시:                                                         │  │
│  │    HashOuter[Hash("Mesh") + (Package>>6)] = { ObjIndex1, ... }  │  │
│  │                                                                  │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │                                                                  │  │
│  │  [3] ObjectOuterMap : TBucketMap<UObjectBase*>                  │  │
│  │  ───────────────────────────────────────────────────────────    │  │
│  │  • Outer → 하위 오브젝트 목록                                     │  │
│  │  • 키: UObjectBase* (Outer)                                      │  │
│  │  • 용도: GetObjectsWithOuter(), FindObjectWithOuter()           │  │
│  │  • 예시:                                                         │  │
│  │    ObjectOuterMap[PackagePtr] = { Obj1, Obj2, Obj3 }            │  │
│  │    ObjectOuterMap[Obj1] = { SubObj1, SubObj2 }                  │  │
│  │                                                                  │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │                                                                  │  │
│  │  [4] ClassToObjectListMap : TBucketMap<UClass*>                 │  │
│  │  ───────────────────────────────────────────────────────────    │  │
│  │  • 클래스 → 해당 클래스의 인스턴스 목록                            │  │
│  │  • 키: UClass*                                                   │  │
│  │  • 용도: GetObjectsOfClass(), ForEachObjectOfClass()            │  │
│  │  • 예시:                                                         │  │
│  │    ClassToObjectListMap[AActor::StaticClass()] = { Actor1, ... }│  │
│  │    ClassToObjectListMap[UTexture2D::StaticClass()] = { Tex1,... }│ │
│  │                                                                  │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │                                                                  │  │
│  │  [5] ClassToChildListMap : TMap<UClass*, TSet<UClass*>>         │  │
│  │  ───────────────────────────────────────────────────────────    │  │
│  │  • 클래스 → 직계 자식 클래스 목록                                  │  │
│  │  • 키: UClass*                                                   │  │
│  │  • 용도: GetDerivedClasses()                                     │  │
│  │  • 예시:                                                         │  │
│  │    ClassToChildListMap[AActor] = { APawn, AInfo, ALight, ... }  │  │
│  │    ClassToChildListMap[APawn] = { ACharacter, ASpectatorPawn }  │  │
│  │                                                                  │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │                                                                  │  │
│  │  [6] PackageToObjectListMap : TBucketMap<UPackage*>             │  │
│  │  ───────────────────────────────────────────────────────────    │  │
│  │  • 패키지 → 해당 패키지 내 오브젝트 목록                           │  │
│  │  • 키: UPackage*                                                 │  │
│  │  • 용도: GetObjectsWithPackage(), ForEachObjectWithPackage()    │  │
│  │  • 예시:                                                         │  │
│  │    PackageToObjectListMap["/Game/MyAsset"] = { Obj1, Obj2, ... }│  │
│  │                                                                  │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │                                                                  │  │
│  │  [7] ObjectToPackageMap : TMap<UObjectBase*, UPackage*>         │  │
│  │  ───────────────────────────────────────────────────────────    │  │
│  │  • 오브젝트 → External Package 맵                                 │  │
│  │  • 키: UObjectBase*                                              │  │
│  │  • 용도: GetObjectExternalPackage()                              │  │
│  │  • 예시: (External Actors - World Partition)                    │  │
│  │    ObjectToPackageMap[ActorPtr] = ExternalPackagePtr            │  │
│  │                                                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  [버전 추적]                                                             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  • AllClassesVersion : std::atomic<uint64>                       │  │
│  │    - 모든 클래스 등록/해제 시 증가                                  │  │
│  │    - 외부 캐시 무효화용                                            │  │
│  │  • NativeClassesVersion : std::atomic<uint64>                    │  │
│  │    - 네이티브 클래스만 추적                                         │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### FHashBucket 구조 (메모리 최적화)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FHashBucket (FSetHashBucket)                    │
│  (메모리 효율적인 해시 버킷 - 적은 충돌 시 인라인, 많으면 동적 할당)       │
├─────────────────────────────────────────────────────────────────────────┤
│  📂 위치: UObjectHash.cpp:87                                             │
│                                                                         │
│  메모리 레이아웃:                                                         │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  void* Elements[2];     // 16 bytes (64-bit)                  │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  [상태 1: 빈 버킷]                                                        │
│  ┌─────────────┬─────────────┐                                         │
│  │ Elements[0] │ Elements[1] │                                         │
│  ├─────────────┼─────────────┤                                         │
│  │   nullptr   │   nullptr   │   // 16 bytes, 오브젝트 0개             │
│  └─────────────┴─────────────┘                                         │
│                                                                         │
│  [상태 2: 1개 오브젝트]                                                   │
│  ┌─────────────┬─────────────┐                                         │
│  │ Elements[0] │ Elements[1] │                                         │
│  ├─────────────┼─────────────┤                                         │
│  │  UObject*   │   nullptr   │   // 16 bytes, 오브젝트 1개             │
│  └─────────────┴─────────────┘                                         │
│                                                                         │
│  [상태 3: 2개 오브젝트]                                                   │
│  ┌─────────────┬─────────────┐                                         │
│  │ Elements[0] │ Elements[1] │                                         │
│  ├─────────────┼─────────────┤                                         │
│  │  UObject*   │  UObject*   │   // 16 bytes, 오브젝트 2개             │
│  └─────────────┴─────────────┘                                         │
│                                                                         │
│  [상태 4: 3개 이상]                                                       │
│  ┌─────────────┬─────────────┐                                         │
│  │ Elements[0] │ Elements[1] │                                         │
│  ├─────────────┼─────────────┤                                         │
│  │   nullptr   │  TSet<...>* │   // 16 bytes + TSet 동적 할당          │
│  └─────────────┴─────────────┘                                         │
│                    ↓                                                    │
│              TSet<UObjectBase*>                                         │
│              ┌──────────────────┐                                       │
│              │  Obj1, Obj2, ... │   // 힙 할당                          │
│              └──────────────────┘                                       │
│                                                                         │
│  Public Methods:                                                        │
│    + Add(Object)                       // 오브젝트 추가                 │
│    + Remove(Object) : int32            // 오브젝트 제거                 │
│    + Contains(Object) : bool           // 포함 여부                     │
│    + Num() : int32                     // 개수                          │
│    + GetAllocatedSize() : SIZE_T       // 메모리 크기                   │
│    + Shrink()                          // 메모리 축소                   │
│    + CreateIterator() : THashBucketIterator                            │
│                                                                         │
│  메모리 효율:                                                             │
│    - 1-2개: 추가 할당 없음 (100% 인라인)                                  │
│    - 3개 이상: TSet 동적 할당 (메모리 증가)                               │
│    - 목표: 대부분의 버킷은 충돌이 적음 (평균 1-2개)                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### TBucketMap 구조 (읽기 잠금)

```cpp
// 📂 위치: UObjectHash.cpp:579
template <typename T, typename K = FHashBucket>
class TBucketMap : private TMap<T, K>
{
#if !UE_BUILD_SHIPPING
    int32 ReadOnlyLock = 0;  // 읽기 잠금 카운터
#endif

public:
    // 읽기 잠금 (복수 허용)
    void LockReadOnly()
    {
        ReadOnlyLock++;
    }

    void UnlockReadOnly()
    {
        ReadOnlyLock--;
        check(ReadOnlyLock >= 0);
    }

    // 쓰기 연산 (읽기 잠금 시 크래시)
    void Add(const T& Key)
    {
        UE_CLOG(ReadOnlyLock != 0, LogObj, Fatal,
            TEXT("Trying to modify UObject map (Add) that is currently being iterated."));
        TMap<T, K>::Add(Key);
    }

    void Remove(const T& Key)
    {
        UE_CLOG(ReadOnlyLock != 0, LogObj, Fatal,
            TEXT("Trying to modify UObject map (Remove) that is currently being iterated."));
        TMap<T, K>::Remove(Key);
    }

    // 읽기 전용 연산 (잠금 무관)
    K* Find(const T& Key) { return TMap<T, K>::Find(Key); }
    int32 Num() const { return TMap<T, K>::Num(); }
};

// 사용 예시
TBucketMap<int32> Hash;

// 안전한 반복
{
    TBucketMapLock Lock(Hash);  // ReadOnlyLock++

    for (auto& Pair : Hash)
    {
        // 읽기 전용 연산만 가능
        // Hash.Add(...);  // ❌ 크래시!
    }

}  // ReadOnlyLock--
```

---

## 🔬 설계 철학: 왜 이렇게 복잡한가?

### 단순 TMap vs FUObjectHashTables

```cpp
// ❌ 단순 접근 - TMap 하나로 모든 것 처리

TMap<FName, TArray<UObject*>> SimpleObjectMap;

// 오브젝트 찾기
UObject* FindObject(FName Name)
{
    TArray<UObject*>* List = SimpleObjectMap.Find(Name);
    if (List)
    {
        return (*List)[0];  // 첫 번째 반환
    }
    return nullptr;
}

// ❌ 문제점:
// 1. 동일 이름 오브젝트 구분 불가 (Outer 고려 안 됨)
// 2. 클래스별 검색 불가 (GetObjectsOfClass)
// 3. Outer 기반 검색 불가 (GetObjectsWithOuter)
// 4. 패키지 검색 불가
// 5. 메모리 낭비 (모든 버킷에 TArray 할당)
```

```cpp
// ✅ 언리얼 방식 - 다중 해시 테이블

FUObjectHashTables& HashTables = FUObjectHashTables::Get();

// [1] FName 기반 검색 (빠름)
UObject* FindByName(FName Name)
{
    int32 Hash = GetTypeHash(Name);
    FHashBucket* Bucket = HashTables.Hash.Find(Hash);
    // Bucket에서 선형 검색
}

// [2] Outer + FName 검색 (더 빠름, 충돌 적음)
UObject* FindWithOuter(UObject* Outer, FName Name)
{
    int32 Hash = GetObjectOuterHash(Name, (PTRINT)Outer);
    // HashOuter에서 검색
}

// [3] 클래스별 검색
void GetObjectsOfClass(UClass* Class, TArray<UObject*>& Out)
{
    FHashBucket* Bucket = HashTables.ClassToObjectListMap.Find(Class);
    // 해당 클래스의 모든 인스턴스 즉시 반환
}

// [4] Outer 기반 검색
void GetObjectsWithOuter(UObject* Outer, TArray<UObject*>& Out)
{
    FHashBucket* Bucket = HashTables.ObjectOuterMap.Find(Outer);
    // 해당 Outer의 모든 하위 오브젝트 즉시 반환
}

// ✅ 장점:
// - 각 검색 용도별 최적화된 해시 테이블
// - O(1) 검색 성능
// - 메모리 효율 (FHashBucket 인라인 최적화)
// - 다양한 검색 패턴 지원
```

### 해시 테이블 비교

| 특징 | 단순 TMap | FUObjectHashTables |
|------|----------|-------------------|
| **검색 속도** | O(1) ~ O(n) | O(1) 평균 |
| **메모리** | 높음 (모든 버킷 할당) | 낮음 (인라인 최적화) |
| **충돌 해결** | 선형 탐색 | Outer 고려 해시 |
| **클래스 검색** | ❌ O(n) 전체 순회 | ✅ O(1) ClassToObjectListMap |
| **Outer 검색** | ❌ O(n) 전체 순회 | ✅ O(1) ObjectOuterMap |
| **패키지 검색** | ❌ O(n) 전체 순회 | ✅ O(1) PackageToObjectListMap |
| **스레드 안전** | ❌ TMap은 기본 지원 없음 | ✅ TBucketMap 읽기 잠금 |

---

## 🧩 주요 API

### 1. 오브젝트 검색 (FindObject)

```cpp
#include "UObject/UObjectHash.h"

// [기본 검색] - FName만으로 검색
UObject* FindByName(FName Name, UClass* Class = nullptr)
{
    // StaticFindObjectFast는 deprecated (ANY_PACKAGE 지원 중단)
    // 대신 StaticFindObjectFastInternal 사용

    UObject* Found = StaticFindObjectFastInternal(
        Class,              // 클래스 (nullptr = 모든 클래스)
        nullptr,            // Outer (nullptr은 이제 지원 안 됨)
        Name,               // 오브젝트 이름
        false,              // bExactClass
        RF_NoFlags,         // ExcludeFlags
        EInternalObjectFlags::None
    );

    return Found;
}

// [권장] - Outer 지정 검색
UStaticMesh* FindMeshInPackage(UPackage* Package, FName MeshName)
{
    UStaticMesh* Mesh = StaticFindObjectFastInternal(
        UStaticMesh::StaticClass(),  // 클래스
        Package,                      // Outer (패키지)
        MeshName,                     // 이름
        false,                        // bExactClass (파생 클래스 포함)
        RF_NoFlags,                   // ExcludeFlags
        EInternalObjectFlags::None
    );

    return Mesh;
}

// [전체 경로 검색]
UObject* FindByPath(const FString& PathName)
{
    FName ObjectName = FName(*FPaths::GetBaseFilename(PathName));

    UObject* Found = StaticFindObjectFastExplicit(
        nullptr,        // 클래스
        ObjectName,     // 이름
        PathName,       // 전체 경로
        false,          // bExactClass
        RF_NoFlags      // ExcludeFlags
    );

    return Found;
}
```

### 2. Outer 기반 검색

```cpp
// 특정 Outer의 모든 오브젝트 가져오기
void GetAllObjectsInPackage(UPackage* Package, TArray<UObject*>& OutObjects)
{
    GetObjectsWithOuter(
        Package,            // Outer
        OutObjects,         // 출력 배열
        true,               // bIncludeNestedObjects (하위 Outer까지 재귀)
        RF_NoFlags,         // ExclusionFlags
        EInternalObjectFlags::None
    );

    UE_LOG(LogTemp, Log, TEXT("Found %d objects in package %s"),
        OutObjects.Num(), *Package->GetName());
}

// 특정 클래스의 오브젝트만 찾기
UStaticMeshComponent* FindMeshComponent(AActor* Actor)
{
    UStaticMeshComponent* Found = nullptr;

    ForEachObjectWithOuter(Actor, [&Found](UObject* Obj)
    {
        if (UStaticMeshComponent* Comp = Cast<UStaticMeshComponent>(Obj))
        {
            Found = Comp;
            // break 불가 - 람다에서 return은 람다 종료
        }
    }, false);  // bIncludeNestedObjects = false (직계만)

    return Found;
}

// 조건에 맞는 오브젝트만 찾기 (조기 종료)
UObject* FindFirstMatchingObject(UObject* Outer, TFunctionRef<bool(UObject*)> Predicate)
{
    UObject* Result = nullptr;

    ForEachObjectWithOuterBreakable(Outer, [&](UObject* Obj) -> bool
    {
        if (Predicate(Obj))
        {
            Result = Obj;
            return false;  // 반복 중단
        }
        return true;  // 계속
    });

    return Result;
}

// 특정 이름의 오브젝트 찾기
UObject* FindObjectByName(UObject* Outer, FName Name)
{
    return (UObject*)FindObjectWithOuter(
        Outer,              // Outer
        nullptr,            // 클래스 (nullptr = 모든 클래스)
        Name                // 이름
    );
}
```

### 3. 클래스 기반 검색

```cpp
// 특정 클래스의 모든 인스턴스 가져오기
void GetAllActors(UWorld* World, TArray<AActor*>& OutActors)
{
    TArray<UObject*> Objects;
    GetObjectsOfClass(
        AActor::StaticClass(),  // 클래스
        Objects,                // 출력 배열
        true,                   // bIncludeDerivedClasses (자식 클래스 포함)
        RF_ClassDefaultObject,  // ExcludeFlags (CDO 제외)
        EInternalObjectFlags::None
    );

    // World 필터링 (모든 World의 Actor가 반환되므로)
    for (UObject* Obj : Objects)
    {
        AActor* Actor = Cast<AActor>(Obj);
        if (Actor && Actor->GetWorld() == World)
        {
            OutActors.Add(Actor);
        }
    }
}

// ForEach 패턴 (메모리 효율적)
void ProcessAllTextures(TFunctionRef<void(UTexture2D*)> Operation)
{
    ForEachObjectOfClass(
        UTexture2D::StaticClass(),
        [Operation](UObject* Obj)
        {
            UTexture2D* Texture = Cast<UTexture2D>(Obj);
            if (Texture)
            {
                Operation(Texture);
            }
        },
        true,  // bIncludeDerivedClasses
        RF_ClassDefaultObject  // CDO 제외
    );
}

// 사용 예시
void LogAllTextureNames()
{
    ProcessAllTextures([](UTexture2D* Texture)
    {
        UE_LOG(LogTemp, Log, TEXT("Texture: %s, Size: %dx%d"),
            *Texture->GetName(),
            Texture->GetSizeX(),
            Texture->GetSizeY()
        );
    });
}
```

### 4. 파생 클래스 검색

```cpp
// 클래스 계층 구조 가져오기
void GetClassHierarchy(UClass* BaseClass, TArray<UClass*>& OutDerivedClasses)
{
    GetDerivedClasses(
        BaseClass,          // 부모 클래스
        OutDerivedClasses,  // 출력 배열
        true                // bRecursive (자식의 자식까지 재귀)
    );

    UE_LOG(LogTemp, Log, TEXT("%s has %d derived classes"),
        *BaseClass->GetName(), OutDerivedClasses.Num());
}

// 예시: 모든 Actor 타입 출력
void LogAllActorTypes()
{
    TArray<UClass*> ActorClasses;
    GetDerivedClasses(AActor::StaticClass(), ActorClasses, true);

    for (UClass* ActorClass : ActorClasses)
    {
        UE_LOG(LogTemp, Log, TEXT("Actor Type: %s"), *ActorClass->GetName());
    }
}

// 모든 클래스 계층 구조 가져오기
void GetAllClassHierarchies()
{
    TMap<UClass*, TSet<UClass*>> AllHierarchies = GetAllDerivedClasses();

    // AllHierarchies[UObject] = { AActor, UActorComponent, ... }
    // AllHierarchies[AActor] = { APawn, AInfo, ALight, ... }

    for (const auto& Pair : AllHierarchies)
    {
        UClass* Parent = Pair.Key;
        const TSet<UClass*>& Children = Pair.Value;

        UE_LOG(LogTemp, Log, TEXT("%s has %d direct children"),
            *Parent->GetName(), Children.Num());
    }
}
```

### 5. 패키지 기반 검색

```cpp
// 패키지 내 모든 오브젝트 가져오기
void GetPackageContents(UPackage* Package, TArray<UObject*>& OutObjects)
{
    GetObjectsWithPackage(
        Package,            // 패키지
        OutObjects,         // 출력 배열
        true,               // bIncludeNestedObjects
        RF_NoFlags,         // ExclusionFlags
        EInternalObjectFlags::None
    );

    for (UObject* Obj : OutObjects)
    {
        UE_LOG(LogTemp, Log, TEXT("  - %s (%s)"),
            *Obj->GetName(), *Obj->GetClass()->GetName());
    }
}

// ForEach 패턴
void ForEachInPackage(UPackage* Package, TFunctionRef<bool(UObject*)> Operation)
{
    ForEachObjectWithPackage(
        Package,
        Operation,
        true,  // bIncludeNestedObjects
        RF_NoFlags,
        EInternalObjectFlags::None
    );
}

// 예시: 패키지 크기 계산
int64 CalculatePackageSize(UPackage* Package)
{
    int64 TotalSize = 0;

    ForEachInPackage(Package, [&TotalSize](UObject* Obj)
    {
        TotalSize += Obj->GetClass()->GetStructureSize();
        return true;  // 계속
    });

    return TotalSize;
}
```

### 6. 해시 테이블 직접 조작

```cpp
// 오브젝트 해시 추가 (일반적으로 자동 호출됨)
void HashObject(UObjectBase* Object)
{
    // UObjectBase 생성자에서 자동 호출
    // 수동 호출은 권장하지 않음
    ::HashObject(Object);
}

// 오브젝트 해시 제거 (일반적으로 자동 호출됨)
void UnhashObject(UObjectBase* Object)
{
    // UObjectBase 소멸자에서 자동 호출
    ::UnhashObject(Object);
}

// External Package 할당 (World Partition)
void AssignExternalPackage(UObject* Object, UPackage* ExternalPackage)
{
    HashObjectExternalPackage(Object, ExternalPackage);
}

// External Package 가져오기
UPackage* GetExternalPackage(UObject* Object)
{
    return GetObjectExternalPackageThreadSafe(Object);
}

// 해시 테이블 메모리 축소
void ShrinkHashTables()
{
    ShrinkUObjectHashTables();
    // 내부적으로 병렬로 각 테이블 압축
}
```

---

## 💡 성능 최적화

### FHashBucket 메모리 최적화

```
┌─────────────────────────────────────────────────────────────────────────┐
│               FHashBucket 메모리 효율 분석                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [충돌 없음 (1개)]                                                        │
│  ────────────────────────────────────────────────────────────────────  │
│  메모리: 16 bytes                                                        │
│  ┌─────────┬─────────┐                                                  │
│  │ Obj1*   │ nullptr │                                                  │
│  └─────────┴─────────┘                                                  │
│                                                                         │
│  [충돌 1개 (2개)]                                                         │
│  ────────────────────────────────────────────────────────────────────  │
│  메모리: 16 bytes (추가 할당 없음)                                         │
│  ┌─────────┬─────────┐                                                  │
│  │ Obj1*   │ Obj2*   │                                                  │
│  └─────────┴─────────┘                                                  │
│                                                                         │
│  [충돌 2개 이상 (3개+)]                                                   │
│  ────────────────────────────────────────────────────────────────────  │
│  메모리: 16 bytes + TSet 오버헤드 (~80+ bytes)                           │
│  ┌─────────┬─────────┐                                                  │
│  │ nullptr │ TSet<>* │───→ TSet<UObject*> (힙 할당)                     │
│  └─────────┴─────────┘      ├─ Obj1                                     │
│                              ├─ Obj2                                     │
│                              ├─ Obj3                                     │
│                              └─ ...                                      │
│                                                                         │
│  [성능 비교]                                                              │
│  ────────────────────────────────────────────────────────────────────  │
│  일반적인 게임:                                                           │
│    • 총 오브젝트: ~500,000개                                              │
│    • 해시 버킷: ~100,000개                                                │
│    • 충돌률 (3개 이상): < 5%                                              │
│                                                                         │
│  메모리 절감:                                                             │
│    • 모든 버킷에 TSet 사용 시: 8MB                                        │
│    • FHashBucket 사용 시: 1.6MB + (5% × 80bytes) = ~2MB                 │
│    • 절감: 75%                                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 해시 충돌 최소화

```cpp
// [방법 1] FName만 사용 (충돌 가능성 높음)
int32 BasicHash = GetObjectHash(ObjectName);
// 예시: "Mesh" → 12345
// 문제: 모든 "Mesh" 이름의 오브젝트가 같은 버킷

// [방법 2] Outer 포함 (권장)
int32 BetterHash = GetObjectOuterHash(ObjectName, (PTRINT)Outer);
// 예시: "Mesh" + PackageA → 12345
//      "Mesh" + PackageB → 67890
// 장점: 다른 패키지의 같은 이름은 다른 버킷

// 실제 구현
static int32 GetObjectOuterHash(FName ObjName, PTRINT Outer)
{
    return GetTypeHash(ObjName) + static_cast<int32>(Outer >> 6);
    //                              ^^^^^^^^^^^^^^^^^^^^^^^^
    //                              Outer 포인터의 상위 비트 사용
    //                              (하위 6비트는 정렬로 항상 0)
}
```

---

## 🚨 일반적인 함정

### ❌ 반복 중 수정

```cpp
// ❌ 나쁨: 반복 중 오브젝트 생성
void BadIteration()
{
    ForEachObjectOfClass(AActor::StaticClass(), [](UObject* Obj)
    {
        // 반복 중 새 오브젝트 생성
        AActor* NewActor = GetWorld()->SpawnActor<AActor>();  // ❌ 크래시!
        // TBucketMap::LockReadOnly()가 활성화된 상태에서 Add() 호출
    });
}

// ✅ 좋음: 먼저 수집, 나중에 생성
void GoodIteration()
{
    TArray<UObject*> ActorsToProcess;

    // [1] 먼저 수집
    ForEachObjectOfClass(AActor::StaticClass(), [&ActorsToProcess](UObject* Obj)
    {
        ActorsToProcess.Add(Obj);
    });

    // [2] 나중에 처리 (반복 종료 후)
    for (UObject* Obj : ActorsToProcess)
    {
        AActor* NewActor = GetWorld()->SpawnActor<AActor>();  // ✅ 안전
    }
}
```

### ❌ ANY_PACKAGE 사용 (Deprecated)

```cpp
// ❌ 나쁨: ANY_PACKAGE 사용 (UE 5.1+ deprecated)
UObject* FindAnyObject(FName Name)
{
    return StaticFindObjectFast(
        nullptr,        // 클래스
        ANY_PACKAGE,    // ❌ Deprecated!
        Name
    );
}

// ✅ 좋음: 명시적 Outer 지정
UObject* FindObjectInPackage(UPackage* Package, FName Name)
{
    return StaticFindObjectFastInternal(
        nullptr,        // 클래스
        Package,        // Outer (명시적)
        Name,
        false,
        RF_NoFlags,
        EInternalObjectFlags::None
    );
}

// ✅ 또는: 전체 경로로 검색
UObject* FindByFullPath(const FString& PathName)
{
    return StaticFindObjectFastExplicit(
        nullptr,
        FName(*FPaths::GetBaseFilename(PathName)),
        PathName,
        false,
        RF_NoFlags
    );
}
```

### ❌ 스레드 안전성 무시

```cpp
// ❌ 나쁨: 게임 스레드 외부에서 해시 수정
void WorkerThreadFunction()
{
    // 워커 스레드에서 오브젝트 생성
    UObject* Obj = NewObject<UObject>();  // ❌ 위험!
    // HashObject()가 호출되어 해시 테이블 수정
    // 스레드 안전하지 않음!
}

// ✅ 좋음: 게임 스레드에서만 오브젝트 생성
void WorkerThreadFunction()
{
    // 워커 스레드에서 데이터만 처리
    TArray<FMyData> ProcessedData = ProcessData();

    // 게임 스레드로 전달
    AsyncTask(ENamedThreads::GameThread, [ProcessedData]()
    {
        // 게임 스레드에서 오브젝트 생성
        for (const FMyData& Data : ProcessedData)
        {
            UObject* Obj = NewObject<UObject>();  // ✅ 안전
        }
    });
}
```

---

## 🔍 디버깅 팁

### 콘솔 명령어

```bash
# 해시 테이블 통계
obj.DumpHashStats              # 기본 통계
obj.DumpHashStats 1            # 버킷별 충돌 정보 포함

# Outer 해시 통계
obj.DumpHashOuterStats         # 기본 통계
obj.DumpHashOuterStats 1       # 버킷별 충돌 정보 포함

# 메모리 사용량
obj.DumpHashMemoryOverhead     # 메모리 오버헤드
obj.DumpHashMemoryOverhead 1   # 상세 (각 맵 개별)

# 해시 테이블 축소
obj.ShrinkUObjectHashTables    # 메모리 압축

# 오브젝트 목록
obj.list                       # 모든 오브젝트
obj.list class=Actor           # 특정 클래스
obj.list outer=Package         # 특정 Outer

# 오브젝트 참조 추적
obj.refs name=MyObject         # MyObject를 참조하는 오브젝트
```

### 로깅

```cpp
#include "UObject/UObjectHash.h"

// 해시 통계 출력
void LogHashStatistics()
{
    FOutputDeviceNull NullDevice;
    LogHashStatistics(NullDevice, true);  // 버킷 충돌 포함
}

// 특정 클래스 개수 확인
void LogClassInstanceCount(UClass* Class)
{
    TArray<UObject*> Objects;
    GetObjectsOfClass(Class, Objects, true, RF_NoFlags);

    UE_LOG(LogTemp, Log, TEXT("%s has %d instances"),
        *Class->GetName(), Objects.Num());
}

// 패키지 내용 출력
void LogPackageContents(UPackage* Package)
{
    TArray<UObject*> Objects;
    GetObjectsWithPackage(Package, Objects, true);

    UE_LOG(LogTemp, Log, TEXT("Package %s contains %d objects:"),
        *Package->GetName(), Objects.Num());

    for (UObject* Obj : Objects)
    {
        UE_LOG(LogTemp, Log, TEXT("  - %s (%s)"),
            *Obj->GetName(), *Obj->GetClass()->GetName());
    }
}
```

---

## 🔗 참고자료

- [UObjectHash.h Source](Engine/Source/Runtime/CoreUObject/Public/UObject/UObjectHash.h)
- [UObjectHash.cpp Source](Engine/Source/Runtime/CoreUObject/Private/UObject/UObjectHash.cpp)
- [Object Handling](https://docs.unrealengine.com/en-US/ProgrammingAndScripting/ProgrammingWithCPP/UnrealArchitecture/Objects/)

**연관 문서:**
- [CoreUObject/ObjectIndexing.md](./ObjectIndexing.md) - FUObjectArray와의 관계
- [CoreUObject/UObject.md](./UObject.md) - FindObject 사용법
- [CoreUObject/PackageAndLinker.md](./PackageAndLinker.md) - 패키지 시스템

---

> 📅 생성: 2025-10-21 — UObject 해시 시스템 문서화 (UE 5.7 검증 완료)
