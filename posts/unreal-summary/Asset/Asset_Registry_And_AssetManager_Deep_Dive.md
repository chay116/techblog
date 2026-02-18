---
title: "Asset Registry & AssetManager Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Asset"
tags: ["unreal", "Asset"]
engine_version: "Unreal Engine 5.7"
---
# Asset Registry & AssetManager Deep Dive

## 🧭 개요 (Overview)

**Asset Registry**는 디스크의 모든 애셋 정보를 메모리에 캐싱하는 카탈로그 시스템이고, **AssetManager**는 Primary Asset의 로딩/언로딩을 관리하는 싱글톤 시스템입니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **IAssetRegistry** | 모든 패키지/애셋의 메타데이터 카탈로그 |
| **FAssetData** | 애셋의 메타데이터 (경로, 클래스, 태그) |
| **FAssetRegistryState** | 직렬화 가능한 애셋 레지스트리 상태 |
| **UAssetManager** | Primary Asset 로딩 관리자 |
| **FPrimaryAssetId** | Primary Asset의 고유 식별자 (Type:Name) |
| **FStreamableManager** | 비동기 애셋 로딩 시스템 |

**핵심 철학:**
> Asset Registry는 "무엇이 존재하는지" 알려주고,
> AssetManager는 "무엇을 로드할지" 결정한다

---

## 🏗️ 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Disk Assets                                       │
│  /Game/MyMap.umap                                                        │
│  /Game/Characters/Hero.uasset                                            │
│  /Game/Weapons/Sword.uasset                                              │
│  /Game/Items/Potion.uasset                                               │
└──────────────────────────┬───────────────────────────────────────────────┘
                           ↓ (Editor Startup: Gather Scan)
                           ↓ (Cooked Build: Serialized Cache)
┌─────────────────────────────────────────────────────────────────────────┐
│                      IAssetRegistry                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  FAssetRegistryState                                            │   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │  FAssetDataMap (CachedAssetsByObjectPath)                  │ │   │
│  │  │  - /Game/MyMap.MyMap → FAssetData                          │ │   │
│  │  │  - /Game/Characters/Hero → FAssetData                      │ │   │
│  │  │  - /Game/Weapons/Sword → FAssetData                        │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │  CachedAssetsByClass                                        │ │   │
│  │  │  - UStaticMesh → [Sword, Shield, ...]                      │ │   │
│  │  │  - USkeletalMesh → [Hero, Enemy, ...]                      │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │  CachedAssetsByPath                                         │ │   │
│  │  │  - /Game/Characters → [Hero, ...]                          │ │   │
│  │  │  - /Game/Weapons → [Sword, Shield, ...]                    │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │  CachedDependsNodes (Dependency Graph)                      │ │   │
│  │  │  - Sword → [Material_M, Texture_T, ...]                    │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Query APIs:                                                            │
│  - GetAssetsByClass(UStaticMesh)                                        │
│  - GetAssetsByPath("/Game/Weapons")                                     │
│  - GetDependencies("/Game/Weapons/Sword")                               │
└──────────────────────────┬───────────────────────────────────────────────┘
                           ↓ (Used by)
┌─────────────────────────────────────────────────────────────────────────┐
│                     UAssetManager                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Primary Asset Directory                                        │   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │  FPrimaryAssetType → TArray<FAssetData>                    │ │   │
│  │  │  - Map → [MyMap1, MyMap2, ...]                             │ │   │
│  │  │  - Character → [Hero, Enemy, ...]                          │ │   │
│  │  │  - Weapon → [Sword, Bow, ...]                              │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                           ↓                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  FStreamableManager                                             │   │
│  │  - TSharedPtr<FStreamableHandle> LoadPrimaryAsset(...)          │   │
│  │  - Async Loading with Bundles ("Client", "Server", etc.)        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└──────────────────────────┬───────────────────────────────────────────────┘
                           ↓
                    Loaded UObjects in Memory
```

**설계 의도:**

| 이유 | 설명 | 효과 |
|------|------|------|
| **1. 디스크 스캔 최소화** | Asset Registry에 모든 메타데이터 캐싱 | 빠른 쿼리 (O(1) ~ O(log N)) |
| **2. 명시적 로딩** | AssetManager로 Primary Asset 관리 | 메모리 사용 최적화 |
| **3. 의존성 추적** | Dependency Graph로 참조 관계 추적 | 정확한 쿠킹/패키징 |

---

## 📐 계층별 상세 분석

### 1. **IAssetRegistry - 애셋 카탈로그**

**📂 위치:** `AssetRegistry/Public/AssetRegistry/IAssetRegistry.h:262`

**역할:** 모든 패키지의 메타데이터를 메모리에 보관

**핵심 구조:**

```cpp
class IAssetRegistry
{
public:
    // 싱글톤 접근
    static IAssetRegistry* Get();
    static IAssetRegistry& GetChecked();

    // 쿼리 API
    virtual bool GetAssetsByPath(FName PackagePath, TArray<FAssetData>& OutAssetData,
                                 bool bRecursive = false, bool bIncludeOnlyOnDiskAssets = false) const = 0;

    virtual bool GetAssetsByClass(FTopLevelAssetPath ClassPathName, TArray<FAssetData>& OutAssetData,
                                  bool bSearchSubClasses = false) const = 0;

    virtual bool GetAssets(const FARFilter& Filter, TArray<FAssetData>& OutAssetData,
                          bool bSkipARFilteredAssets = true) const = 0;

    // 의존성 쿼리
    virtual bool GetDependencies(const FAssetIdentifier& AssetIdentifier,
                                 TArray<FAssetIdentifier>& OutDependencies,
                                 EDependencyCategory Category = EDependencyCategory::All) const = 0;

    virtual bool GetReferencers(const FAssetIdentifier& AssetIdentifier,
                               TArray<FAssetIdentifier>& OutReferencers,
                               EDependencyCategory Category = EDependencyCategory::All) const = 0;

    // 스캔 제어
    virtual void ScanPathsSynchronous(const TArray<FString>& InPaths, bool bForceRescan = false,
                                      bool bIgnoreDenyListScanFilters = false) = 0;
};
```

**FAssetData 구조:**

```cpp
struct FAssetData
{
    // 핵심 식별자
    FName PackageName;           // "/Game/Weapons/Sword"
    FName PackagePath;           // "/Game/Weapons"
    FName AssetName;             // "Sword"
    FTopLevelAssetPath AssetClassPath;  // "/Script/Engine.StaticMesh"

    // 태그 (CustomData)
    FAssetDataTagMap TagsAndValues;  // "NumLODs" → "4", "Materials" → "2"

    // 청크/쿠킹 정보
    TArray<int32> ChunkIDs;
    uint32 PackageFlags;

    // 메서드
    FString GetExportTextName() const;  // "/Game/Weapons/Sword.Sword"
    FSoftObjectPath GetSoftObjectPath() const;
};
```

**메모리 구조:**

```
FAssetRegistryState:
┌─────────────────────────────────────────────────────────────────────────┐
│  FAssetDataMap CachedAssetsByObjectPath                                 │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │  Key: FSoftObjectPath                  Value: FAssetData*     │     │
│  │  "/Game/Weapons/Sword.Sword"      →    [PackageName, Tags...] │     │
│  │  "/Game/Characters/Hero.Hero"     →    [PackageName, Tags...] │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                                                         │
│  TMap<FTopLevelAssetPath, TArray<FAssetData*>> CachedAssetsByClass     │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │  "/Script/Engine.StaticMesh"      →    [Sword*, Shield*, ...]  │     │
│  │  "/Script/Engine.SkeletalMesh"    →    [Hero*, Enemy*, ...]    │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                                                         │
│  TMap<FName, TArray<FAssetData*>> CachedAssetsByPath                    │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │  "/Game/Weapons"                  →    [Sword*, Shield*, ...]  │     │
│  │  "/Game/Characters"               →    [Hero*, Enemy*, ...]    │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                                                         │
│  TMap<FAssetIdentifier, FDependsNode*> CachedDependsNodes               │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │  "/Game/Weapons/Sword"            →    [Material_M, Texture_T] │     │
│  │  "/Game/Characters/Hero"          →    [Anim_A, Skeleton_S]    │     │
│  └────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
```

**스캔 프로세스 (Editor):**

```
Engine Startup
   │
   ├─→ 1. FAssetRegistry::SearchAllAssets()
   │      - 모든 /Content 폴더 스캔
   │      - FAssetDataGatherer (백그라운드 스레드)
   │
   ├─→ 2. FAssetDataGatherer::GetAndTrimSearchResults()
   │      - .uasset 파일 헤더만 읽기 (Full Load 안 함!)
   │      - FAssetData 생성 (Class, Tags, Dependencies)
   │
   ├─→ 3. FAssetRegistry::AddAssetData()
   │      - CachedAssetsByObjectPath에 추가
   │      - CachedAssetsByClass 인덱스 업데이트
   │      - CachedAssetsByPath 인덱스 업데이트
   │
   └─→ 4. OnInitialSearchCompleted()
          - 모든 시스템에 통지
```

**Cooked Build 프로세스:**

```cpp
// Cooking 시 직렬화
FArchive& Ar = ...;
FAssetRegistryState State;

// Serialize (압축 + 필터링)
FAssetRegistrySerializationOptions Options;
Options.bSerializeAssetRegistry = true;
Options.bSerializeDependencies = true;
Options.bFilterAssetDataWithNoTags = true;  // 태그 없는 애셋 제외

State.Serialize(Ar, Options);

// → AssetRegistry.bin (Cooked 패키지에 포함)
```

---

### 2. **UAssetManager - Primary Asset 관리자**

**📂 위치:** `Engine/Classes/Engine/AssetManager.h:83`

**역할:** Primary Asset의 로딩/언로딩 관리

**핵심 개념:**

```cpp
class UAssetManager : public UObject
{
public:
    // 싱글톤
    static UAssetManager& Get();
    static bool IsInitialized();

    // Streamable Manager 접근
    static FStreamableManager& GetStreamableManager();

    // Primary Asset 등록
    virtual int32 ScanPathsForPrimaryAssets(
        FPrimaryAssetType PrimaryAssetType,
        const TArray<FString>& Paths,
        UClass* BaseClass,
        bool bHasBlueprintClasses,
        bool bIsEditorOnly = false,
        bool bForceSynchronousScan = true);

    // Primary Asset 쿼리
    virtual bool GetPrimaryAssetData(const FPrimaryAssetId& PrimaryAssetId, FAssetData& AssetData) const;
    virtual FSoftObjectPath GetPrimaryAssetPath(const FPrimaryAssetId& PrimaryAssetId) const;
    virtual UObject* GetPrimaryAssetObject(const FPrimaryAssetId& PrimaryAssetId) const;

    // 비동기 로딩
    virtual TSharedPtr<FStreamableHandle> LoadPrimaryAsset(
        const FPrimaryAssetId& AssetToLoad,
        const TArray<FName>& LoadBundles = TArray<FName>(),
        FStreamableDelegate DelegateToCall = FStreamableDelegate(),
        TAsyncLoadPriority Priority = FStreamableManager::DefaultAsyncLoadPriority);

    virtual TSharedPtr<FStreamableHandle> LoadPrimaryAssets(
        const TArray<FPrimaryAssetId>& AssetsToLoad,
        const TArray<FName>& LoadBundles = TArray<FName>(),
        FStreamableDelegate DelegateToCall = FStreamableDelegate());

    // 언로딩
    virtual int32 UnloadPrimaryAsset(const FPrimaryAssetId& AssetToUnload);
    virtual int32 UnloadPrimaryAssets(const TArray<FPrimaryAssetId>& AssetsToUnload);

    // Bundle 상태 변경
    virtual TSharedPtr<FStreamableHandle> ChangeBundleStateForPrimaryAssets(
        const TArray<FPrimaryAssetId>& AssetsToChange,
        const TArray<FName>& AddBundles,
        const TArray<FName>& RemoveBundles,
        bool bRemoveAllBundles = false);
};
```

**FPrimaryAssetId 구조:**

```cpp
struct FPrimaryAssetId
{
    FPrimaryAssetType PrimaryAssetType;  // "Map", "Character", "Weapon"
    FName PrimaryAssetName;              // "MyMap", "Hero", "Sword"

    // 생성자
    FPrimaryAssetId(FPrimaryAssetType InType, FName InName)
        : PrimaryAssetType(InType), PrimaryAssetName(InName) {}

    // "Map:MyMap" 형식
    FString ToString() const;
    static FPrimaryAssetId FromString(const FString& String);

    bool IsValid() const { return PrimaryAssetType.IsValid() && !PrimaryAssetName.IsNone(); }
};
```

**Primary Asset 등록 흐름:**

```
UAssetManager::StartInitialLoading()
   │
   ├─→ 1. Load Config (DefaultGame.ini)
   │      [/Script/Engine.AssetManagerSettings]
   │      +PrimaryAssetTypesToScan=(PrimaryAssetType="Map",AssetBaseClass="/Script/Engine.World",...)
   │
   ├─→ 2. ScanPathsForPrimaryAssets()
   │      - IAssetRegistry::GetAssetsByClass(UWorld)
   │      - Filter by PrimaryAssetType
   │      - Add to PrimaryAssetDirectory
   │
   └─→ 3. Build Management Database
          - UpdateManagementDatabase()
          - Resolve Dependencies
          - Build Chunk Map
```

---

### 3. **FStreamableManager - 비동기 로딩**

**📂 위치:** `Engine/Public/Engine/StreamableManager.h`

**역할:** 비동기 애셋 로딩 관리

**핵심 구조:**

```cpp
class FStreamableManager
{
public:
    // 비동기 로드
    TSharedPtr<FStreamableHandle> RequestAsyncLoad(
        const FSoftObjectPath& TargetToLoad,
        FStreamableDelegate DelegateToCall = FStreamableDelegate(),
        TAsyncLoadPriority Priority = DefaultAsyncLoadPriority,
        bool bManageActiveHandle = false,
        bool bStartStalled = false,
        FString DebugName = TEXT("RequestAsyncLoad"));

    TSharedPtr<FStreamableHandle> RequestAsyncLoad(
        const TArray<FSoftObjectPath>& TargetsToLoad,
        FStreamableDelegate DelegateToCall = FStreamableDelegate(),
        TAsyncLoadPriority Priority = DefaultAsyncLoadPriority,
        bool bManageActiveHandle = false,
        bool bStartStalled = false,
        FString DebugName = TEXT("RequestAsyncLoad Array"));

    // 동기 로드
    UObject* LoadSynchronous(const FSoftObjectPath& Target, bool bManageActiveHandle = false,
                             TSharedPtr<FStreamableHandle>* HandlePtr = nullptr);

    // 언로드
    void Unload(const FSoftObjectPath& Target);

    // 진행 상황 확인
    bool IsAsyncLoadComplete(const FSoftObjectPath& Target);
    float GetAsyncLoadPercentage(const FSoftObjectPath& Target);
};
```

**FStreamableHandle:**

```cpp
struct FStreamableHandle
{
    // 상태 확인
    bool IsActive() const;
    bool HasLoadCompleted() const;
    bool WasCanceled() const;

    // 대기
    void WaitUntilComplete(float Timeout = 0.0f, bool bStartStalledHandles = true);

    // 취소
    void CancelHandle();

    // 로드된 애셋 접근
    UObject* GetLoadedAsset() const;
    void GetLoadedAssets(TArray<UObject*>& LoadedAssets) const;

    // Delegate
    FStreamableDelegate CompleteDelegate;
    FStreamableDelegate CancelDelegate;
    FStreamableUpdateDelegate UpdateDelegate;
};
```

**Bundle 시스템:**

```cpp
// Config (DefaultGame.ini)
[/Script/Engine.AssetManagerSettings]
+PrimaryAssetRules=(
    PrimaryAssetId="Character:Hero",
    Rules=(
        Priority=1,
        ChunkId=-1,
        CookRule=AlwaysCook,
        BundleRules=(
            (BundleNames=("Client"), BundleAssets=("/Game/Characters/Hero_ClientOnly.uasset")),
            (BundleNames=("Server"), BundleAssets=("/Game/Characters/Hero_ServerOnly.uasset")),
            (BundleNames=("Client","Server"), BundleAssets=("/Game/Characters/Hero_Shared.uasset"))
        )
    )
)

// 사용 예시
TArray<FName> Bundles;
Bundles.Add("Client");  // Client Bundle만 로드

UAssetManager::Get().LoadPrimaryAsset(
    FPrimaryAssetId("Character", "Hero"),
    Bundles,
    FStreamableDelegate::CreateLambda([]() {
        UE_LOG(LogTemp, Log, TEXT("Hero Client Bundle Loaded!"));
    })
);
```

---

## 🧪 실전 예시

### 예시 1: Asset Registry 쿼리

```cpp
// 모든 StaticMesh 찾기
TArray<FAssetData> StaticMeshes;
IAssetRegistry::Get()->GetAssetsByClass(
    FTopLevelAssetPath("/Script/Engine.StaticMesh"),
    StaticMeshes,
    true  // bSearchSubClasses
);

for (const FAssetData& AssetData : StaticMeshes)
{
    UE_LOG(LogTemp, Log, TEXT("Found StaticMesh: %s"), *AssetData.GetExportTextName());
}

// 특정 경로의 애셋 찾기
TArray<FAssetData> WeaponAssets;
IAssetRegistry::Get()->GetAssetsByPath(
    "/Game/Weapons",
    WeaponAssets,
    true  // bRecursive
);

// 태그로 필터링
FARFilter Filter;
Filter.ClassPaths.Add(FTopLevelAssetPath("/Script/Engine.StaticMesh"));
Filter.TagsAndValues.Add("NumLODs", "4");  // NumLODs == 4

TArray<FAssetData> HighLODMeshes;
IAssetRegistry::Get()->GetAssets(Filter, HighLODMeshes);
```

### 예시 2: Primary Asset 로딩

```cpp
// DefaultGame.ini에 정의
[/Script/Engine.AssetManagerSettings]
+PrimaryAssetTypesToScan=(
    PrimaryAssetType="Weapon",
    AssetBaseClass="/Script/MyGame.WeaponDataAsset",
    bHasBlueprintClasses=False,
    Directories=((Path="/Game/Weapons"))
)

// C++ 코드
void LoadWeapon(FName WeaponName)
{
    FPrimaryAssetId WeaponId("Weapon", WeaponName);

    TSharedPtr<FStreamableHandle> Handle = UAssetManager::Get().LoadPrimaryAsset(
        WeaponId,
        {},  // No bundles
        FStreamableDelegate::CreateLambda([WeaponId]() {
            UObject* WeaponData = UAssetManager::Get().GetPrimaryAssetObject(WeaponId);
            if (WeaponData)
            {
                UE_LOG(LogTemp, Log, TEXT("Weapon Loaded: %s"), *WeaponData->GetName());
            }
        })
    );

    // 또는 동기 로드
    // Handle->WaitUntilComplete();
}

// 언로드
void UnloadWeapon(FName WeaponName)
{
    FPrimaryAssetId WeaponId("Weapon", WeaponName);
    UAssetManager::Get().UnloadPrimaryAsset(WeaponId);
}
```

### 예시 3: 의존성 추적

```cpp
// Sword의 모든 의존성 찾기
FAssetIdentifier SwordId("/Game/Weapons/Sword");
TArray<FAssetIdentifier> Dependencies;

IAssetRegistry::Get()->GetDependencies(
    SwordId,
    Dependencies,
    UE::AssetRegistry::EDependencyCategory::Package  // Package 의존성만
);

for (const FAssetIdentifier& Dep : Dependencies)
{
    UE_LOG(LogTemp, Log, TEXT("Dependency: %s"), *Dep.ToString());
}
// Output:
// Dependency: /Game/Materials/Sword_M
// Dependency: /Game/Textures/Sword_D
// Dependency: /Game/Textures/Sword_N

// 역방향: Sword를 참조하는 애셋 찾기
TArray<FAssetIdentifier> Referencers;
IAssetRegistry::Get()->GetReferencers(SwordId, Referencers);
```

---

## ⚙️ 설정 및 최적화

### Config 설정 (DefaultGame.ini)

```ini
[/Script/Engine.AssetManagerSettings]
; Primary Asset Types
+PrimaryAssetTypesToScan=(
    PrimaryAssetType="Map",
    AssetBaseClass="/Script/Engine.World",
    bHasBlueprintClasses=False,
    bIsEditorOnly=False,
    Directories=((Path="/Game/Maps"))
)

+PrimaryAssetTypesToScan=(
    PrimaryAssetType="Character",
    AssetBaseClass="/Script/MyGame.CharacterDataAsset",
    bHasBlueprintClasses=True,
    bIsEditorOnly=False,
    Directories=((Path="/Game/Characters"))
)

; Chunk 설정
+PrimaryAssetRules=(
    PrimaryAssetId="Map:Level1",
    Rules=(Priority=1, ChunkId=1, CookRule=AlwaysCook)
)

+PrimaryAssetRules=(
    PrimaryAssetId="Map:Level2",
    Rules=(Priority=1, ChunkId=2, CookRule=AlwaysCook)
)
```

### Asset Registry 최적화

**메모리 절약:**

```cpp
// DefaultEngine.ini
[AssetRegistry]
; 태그 없는 애셋 제외 (Cooked에서)
bFilterAssetDataWithNoTags=True

; 의존성 직렬화 제어
bSerializeDependencies=True
bSerializeDependencies=True

; Editor-Only 데이터 제외
bFilterEditorOnlyAssets=True
```

**스캔 성능:**

```cpp
// Bulk Scan (여러 경로 스캔 시)
UAssetManager& Manager = UAssetManager::Get();
Manager.PushBulkScanning();

Manager.ScanPathForPrimaryAssets("Weapon", "/Game/Weapons", ...);
Manager.ScanPathForPrimaryAssets("Item", "/Game/Items", ...);
Manager.ScanPathForPrimaryAssets("Character", "/Game/Characters", ...);

Manager.PopBulkScanning();  // 한 번에 스캔
```

---

## 🐛 디버깅

### 콘솔 명령어

```
# Asset Registry 상태 확인
AssetRegistry.DumpState

# Primary Asset 리스트
AssetManager.DumpLoadedAssets

# 특정 애셋 의존성
AssetRegistry.PrintAssetDependencies /Game/Weapons/Sword

# 로딩 중인 핸들 확인
Streamable.DumpActiveHandles
```

### 일반적인 함정

**❌ bIncludeOnlyOnDiskAssets 오해:**

```cpp
// 위험 - 로드된 애셋의 변경사항 무시
TArray<FAssetData> Assets;
IAssetRegistry::Get()->GetAssetsByClass(
    UStaticMesh::StaticClass(),
    Assets,
    false,
    true  // bIncludeOnlyOnDiskAssets = true
);
// → 메모리의 수정된 태그가 반영 안 됨!

// ✅ 올바른 사용
IAssetRegistry::Get()->GetAssetsByClass(
    UStaticMesh::StaticClass(),
    Assets,
    false,
    false  // 메모리 우선
);
```

**❌ Primary Asset 미등록:**

```cpp
// Config에 등록 안 함
// → GetPrimaryAssetData() = false

// ✅ DefaultGame.ini에 반드시 등록
[/Script/Engine.AssetManagerSettings]
+PrimaryAssetTypesToScan=(...)
```

---

## 📊 성능 특성

### Asset Registry 메모리 사용량

**Editor (모든 태그 포함):**
- FAssetData: ~200 bytes/애셋
- 10,000 애셋: ~2 MB

**Cooked (태그 필터링):**
- FAssetData: ~100 bytes/애셋
- 10,000 애셋: ~1 MB

### 쿼리 성능

| 작업 | 복잡도 | 시간 (10,000 애셋) |
|------|--------|-------------------|
| GetAssetsByClass | O(1) | ~0.01 ms |
| GetAssetsByPath | O(1) | ~0.01 ms |
| GetAssets (Filter) | O(N) | ~1 ms |
| GetDependencies | O(1) | ~0.01 ms |
| ScanPathsSynchronous | O(N × M) | ~500 ms (N=경로, M=파일) |

---

## 🔗 참고 자료

**소스 파일:**
- `AssetRegistry/Public/AssetRegistry/IAssetRegistry.h` - Asset Registry 인터페이스
- `AssetRegistry/Public/AssetRegistry/AssetRegistryState.h` - 직렬화 가능한 상태
- `Engine/Classes/Engine/AssetManager.h` - Primary Asset 관리자
- `Engine/Public/Engine/StreamableManager.h` - 비동기 로딩

**관련 문서:**
- [Asset Management](https://docs.unrealengine.com/5.7/en-US/asset-management/)
- [Asset Registry](https://docs.unrealengine.com/5.7/en-US/asset-registry/)

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Asset Registry & AssetManager Deep Dive
  - IAssetRegistry 쿼리 API (Class/Path/Filter)
  - FAssetRegistryState (Disk/Memory 캐싱)
  - UAssetManager (Primary Asset 관리)
  - FStreamableManager (비동기 로딩)
  - Bundle 시스템 & 의존성 추적
  - 실전 예시 및 Config 설정