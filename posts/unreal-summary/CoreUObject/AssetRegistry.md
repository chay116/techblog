---
title: "에셋 레지스트리 시스템 (Asset Registry System)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "CoreUObject"
tags: ["unreal", "CoreUObject"]
---
# 에셋 레지스트리 시스템 (Asset Registry System)

## 🧭 개요

**에셋 레지스트리 (Asset Registry)**는 언리얼 엔진의 모든 에셋에 대한 중앙 집중식 메타데이터 카탈로그입니다. 디스크에 있는 모든 패키지와 에셋의 정보를 인덱싱하여, 에셋을 로드하지 않고도 빠르게 검색하고 쿼리할 수 있게 합니다.

**핵심 구성 요소:**
- **IAssetRegistry** - 에셋 레지스트리 인터페이스 (싱글톤)
- **FAssetData** - 개별 에셋의 메타데이터 구조체
- **FARFilter** - 에셋 필터링 및 쿼리
- **FAssetIdentifier** - 에셋 고유 식별자
- **FAssetBundleData** - 에셋 번들 정보
- **AssetRegistryState** - 직렬화 가능한 레지스트리 상태

**주요 기능:**
- **빠른 에셋 검색** - 로드 없이 에셋 메타데이터 쿼리
- **에셋 의존성 추적** - Hard/Soft 참조 관계 분석
- **비동기 스캔** - 백그라운드 디렉터리 스캔
- **에디터 통합** - 콘텐츠 브라우저, 레퍼런스 뷰어
- **쿠킹 지원** - 런타임 에셋 정보 직렬화
- **에셋 태그** - 커스텀 메타데이터 (SearchableAssetKey)
- **Primary Asset 관리** - 청크 할당 및 쿠킹 규칙

**작동 방식:**
- **에디터 시작 시:** 모든 마운트된 디렉터리를 스캔하여 .uasset/.umap 파일 인덱싱
- **런타임:** 쿠킹된 AssetRegistry.bin 파일 로드 (프로덕션 빌드용)
- **비동기 업데이트:** 파일 시스템 변경 감지 및 증분 업데이트

**모듈 위치:**
- `Engine/Source/Runtime/AssetRegistry/Public/AssetRegistry/`
- `Engine/Source/Runtime/CoreUObject/Public/AssetRegistry/`

**핵심 파일:**
- `IAssetRegistry.h` - 메인 인터페이스
- `AssetData.h` - FAssetData 구조체
- `ARFilter.h` - 필터링 기능
- `AssetRegistryState.h` - 직렬화 가능한 상태

**엔진 버전:** Unreal Engine 5.6.1 (2025년 기준)

---

## 🧱 구조

### 에셋 레지스트리 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Asset Registry System                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [에디터 모드]                                                           │
│                                                                         │
│   엔진 시작                                                              │
│      ↓                                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  1. AssetRegistry 모듈 로드          │                            │
│   │     - IAssetRegistry::Get()          │                            │
│   │     - 싱글톤 인스턴스 생성           │                            │
│   └──────────────────────────────────────┘                            │
│      ↓                                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  2. 초기 디렉터리 스캔               │                            │
│   │     - /Game/, /Engine/, /Plugins/    │                            │
│   │     - .uasset, .umap 파일 발견       │                            │
│   │     - 비동기 백그라운드 스캔         │                            │
│   └──────────────────────────────────────┘                            │
│      ↓                                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  3. 에셋 메타데이터 추출             │                            │
│   │     - 패키지 헤더 파싱               │                            │
│   │     - FAssetData 생성                │                            │
│   │     - AssetRegistrySearchable 태그   │                            │
│   │     - 의존성 정보 수집               │                            │
│   └──────────────────────────────────────┘                            │
│      ↓                                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  4. 인덱싱 완료                      │                            │
│   │     - FAssetRegistryState 구축       │                            │
│   │     - 콘텐츠 브라우저 활성화         │                            │
│   │     - 검색 가능                      │                            │
│   └──────────────────────────────────────┘                            │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [런타임 모드 - Cooked 빌드]                                             │
│                                                                         │
│   게임 시작                                                              │
│      ↓                                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  1. AssetRegistry.bin 로드           │                            │
│   │     - 쿠킹 시 생성된 캐시 파일       │                            │
│   │     - 즉시 사용 가능                 │                            │
│   └──────────────────────────────────────┘                            │
│      ↓                                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  2. 최소 메타데이터 로드             │                            │
│   │     - 에디터 전용 데이터 제외        │                            │
│   │     - Primary Asset 정보만           │                            │
│   │     - 의존성 정보 (필요시)           │                            │
│   └──────────────────────────────────────┘                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### IAssetRegistry 인터페이스

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          IAssetRegistry                                 │
│  (글로벌 에셋 카탈로그 인터페이스)                                        │
├─────────────────────────────────────────────────────────────────────────┤
│  📂 위치: AssetRegistry/Public/AssetRegistry/IAssetRegistry.h:241       │
│                                                                         │
│  Static:                                                                │
│    + Get() : IAssetRegistry*           // 싱글톤 인스턴스              │
│    + GetChecked() : IAssetRegistry&    // 체크된 싱글톤               │
│                                                                         │
│  [검색 API]                                                             │
│    + HasAssets(FName Path, bRecursive) : bool                          │
│    + GetAssetsByPackageName(FName, OutAssets) : bool                   │
│    + GetAssetsByPath(FName Path, OutAssets, bRecursive) : bool         │
│    + GetAssetsByClass(FTopLevelAssetPath, OutAssets) : bool            │
│    + GetAssets(FARFilter, OutAssets) : bool                            │
│    + GetAllAssets(OutAssets, bIncludeOnlyOnDiskAssets) : bool          │
│                                                                         │
│  [에셋 조회]                                                            │
│    + GetAssetByObjectPath(FSoftObjectPath) : FAssetData                │
│    + TryGetAssetByObjectPath(FSoftObjectPath, OutAsset) : bool         │
│    + GetAssetPackageDataCopy(FName PackageName) : FAssetPackageData    │
│                                                                         │
│  [의존성 API]                                                           │
│    + GetDependencies(FAssetIdentifier, OutDeps, Category) : bool       │
│    + GetReferencers(FAssetIdentifier, OutRefs, Category) : bool        │
│    + GetDependencies(FName PackageName, OutDeps, Category) : bool      │
│    + GetReferencers(FName PackageName, OutRefs, Category) : bool       │
│                                                                         │
│  [스캔 API]                                                             │
│    + ScanPathsSynchronous(Paths, bForceRescan)                         │
│    + ScanFilesSynchronous(Files, bForceRescan)                         │
│    + ScanModifiedAssetFiles(Files)                                     │
│    + IsLoadingAssets() : bool                                          │
│    + WaitForCompletion()                                               │
│                                                                         │
│  [이벤트]                                                               │
│    + OnAssetAdded() : FAssetAddedEvent&                                │
│    + OnAssetRemoved() : FAssetRemovedEvent&                            │
│    + OnAssetRenamed() : FAssetRenamedEvent&                            │
│    + OnAssetUpdated() : FAssetUpdatedEvent&                            │
│    + OnFilesLoaded() : FFilesLoadedEvent&                              │
│    + OnInMemoryAssetCreated() : FInMemoryAssetCreatedEvent&            │
│    + OnInMemoryAssetDeleted() : FInMemoryAssetDeletedEvent&            │
│                                                                         │
│  [직렬화]                                                               │
│    + SerializeSearchableAssetRegistryState(FArchive&) : void           │
│    + LoadRegistryData(FArchive&, Flags) : void                         │
│    + SaveRegistryData(FArchive&, Options) : void                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### FAssetData 구조체

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            FAssetData                                   │
│  (개별 에셋의 메타데이터)                                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  📂 위치: CoreUObject/Public/AssetRegistry/AssetData.h:156              │
│                                                                         │
│  Public:                                                                │
│    - FName PackageName             // 패키지 이름 (/Game/Path/Asset)   │
│    - FName PackagePath             // 패키지 경로 (/Game/Path)         │
│    - FName AssetName               // 에셋 이름 (Asset)                │
│    - FTopLevelAssetPath AssetClassPath  // 클래스 경로              │
│    - uint32 PackageFlags           // 패키지 플래그                    │
│    - FAssetDataTagMapSharedView TagsAndValues  // 커스텀 태그          │
│    - TSharedPtr<FAssetBundleData> TaggedAssetBundles  // 번들 정보     │
│                                                                         │
│  [생성자]                                                               │
│    + FAssetData()                  // 기본 생성자                      │
│    + FAssetData(UObject*)          // 오브젝트로부터 생성              │
│    + FAssetData(PackageName, PackagePath, AssetName, ClassPath)        │
│                                                                         │
│  [쿼리 API]                                                             │
│    + IsValid() : bool              // 유효성 검사                      │
│    + IsUAsset() : bool             // 메인 에셋 여부                   │
│    + GetSoftObjectPath() : FSoftObjectPath  // 소프트 참조             │
│    + GetObjectPathString() : FString        // 오브젝트 경로 문자열    │
│    + GetAsset() : UObject*         // 에셋 로드 (로드 안 됐으면 로드)  │
│    + GetClass() : UClass*          // 클래스 가져오기 (로드 가능)      │
│    + IsInstanceOf(UClass*) : bool  // 클래스 체크 (로드 없음)          │
│                                                                         │
│  [태그 API]                                                             │
│    + GetTagValue(FName Key) : FAssetTagValueRef  // 태그 값 가져오기   │
│    + GetTagValueRef<T>(FName Key) : T*  // 타입 지정 태그 가져오기     │
│    + FindTag(FName Key) : bool     // 태그 존재 여부                   │
│    + SetTagsAndAssetBundles(FAssetDataTagMap&&)  // 태그 설정         │
│                                                                         │
│  [청크 ID 관리]                                                         │
│    + GetChunkIDs() : FChunkArrayView  // 청크 ID 목록                  │
│    + SetChunkIDs(FChunkArray&&)    // 청크 ID 설정                     │
│    + AddChunkID(int32)             // 청크 ID 추가                     │
│    + ClearChunkIDs()               // 청크 ID 삭제                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### FAssetData 내부 구조 시각화

```
FAssetData 인스턴스 메모리 레이아웃:
┌────────────────────────────────────────────────────────────────┐
│  PackageName:      /Game/Characters/Hero/Mesh                  │
│  PackagePath:      /Game/Characters/Hero                       │
│  AssetName:        Mesh                                        │
│  AssetClassPath:   /Script/Engine.StaticMesh                   │
│  PackageFlags:     0x00000001 (PKG_ContainsMap)                │
├────────────────────────────────────────────────────────────────┤
│  TagsAndValues:    (FAssetDataTagMapSharedView)                │
│    ┌────────────────────────────────────────────────────────┐ │
│    │  Key: "NumTriangles"   Value: "12345"                  │ │
│    │  Key: "LODs"           Value: "4"                      │ │
│    │  Key: "Vertices"       Value: "5678"                   │ │
│    │  Key: "AssetImportData" Value: "[JSON Data]"          │ │
│    └────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────┤
│  TaggedAssetBundles:  (TSharedPtr<FAssetBundleData>)          │
│    ┌────────────────────────────────────────────────────────┐ │
│    │  Bundle: "Client"                                      │ │
│    │    - /Game/Characters/Hero/Texture                     │ │
│    │    - /Game/Characters/Hero/Material                    │ │
│    │  Bundle: "Server"                                      │ │
│    │    - /Game/Characters/Hero/CollisionMesh               │ │
│    └────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────┤
│  ChunkIDs:         [0, 2]  (청크 0과 2에 포함)                 │
└────────────────────────────────────────────────────────────────┘
```

### FARFilter - 에셋 필터링

```cpp
// FARFilter 구조체 (에셋 검색 쿼리)
struct FARFilter
{
    // 필터 조건 (AND 조합)
    TArray<FName> PackageNames;              // 패키지 이름
    TArray<FName> PackagePaths;              // 패키지 경로
    TArray<FSoftObjectPath> SoftObjectPaths; // 오브젝트 경로
    TArray<FTopLevelAssetPath> ClassPaths;   // 클래스 경로
    TSet<FName> RecursiveClassPathsExclusionSet;  // 제외할 클래스
    TMultiMap<FName, FString> TagsAndValues; // 태그 필터

    bool bRecursivePaths = false;            // 하위 경로 포함
    bool bRecursiveClasses = false;          // 파생 클래스 포함
    bool bIncludeOnlyOnDiskAssets = false;   // 디스크 에셋만
};

// 사용 예시
FARFilter Filter;
Filter.PackagePaths.Add(TEXT("/Game/Characters"));
Filter.bRecursivePaths = true;
Filter.ClassPaths.Add(UStaticMesh::StaticClass()->GetClassPathName());

TArray<FAssetData> Assets;
IAssetRegistry::Get()->GetAssets(Filter, Assets);
```

---

## 🔬 설계 철학: 왜 에셋 레지스트리인가?

### 파일 시스템 직접 검색의 한계

```cpp
// ❌ 파일 시스템 직접 검색 - 매우 느림

void FindAllStaticMeshes_Slow()
{
    TArray<FString> Files;

    // 1. 모든 .uasset 파일 찾기 (느림!)
    IFileManager::Get().FindFilesRecursive(
        Files,
        *FPaths::ProjectContentDir(),
        TEXT("*.uasset"),
        true, false
    );

    // 2. 각 파일을 열어서 타입 확인 (매우 느림!!)
    for (const FString& File : Files)
    {
        // 패키지 로드 필요 - 메모리와 시간 소비
        UPackage* Package = LoadPackage(nullptr, *File, LOAD_None);
        if (!Package) continue;

        // 오브젝트 찾기
        UObject* Asset = FindObject<UObject>(Package, *FPaths::GetBaseFilename(File));
        if (Asset && Asset->IsA<UStaticMesh>())
        {
            // 찾음!
        }

        // 패키지 언로드
        CollectGarbage(GARBAGE_COLLECTION_KEEPFLAGS);
    }
}

// ❌ 불가능한 것들:
// - 프로젝트 내 모든 스태틱 메시 찾기 (수천 개 로드 필요!)
// - 특정 태그를 가진 에셋 검색 (모든 에셋 로드 필요!)
// - 에셋 의존성 분석 (재귀적 로드 필요!)
// - 콘텐츠 브라우저 (실시간 필터링 불가능!)
```

```cpp
// ✅ 에셋 레지스트리 - 로드 없이 즉시 검색

void FindAllStaticMeshes_Fast()
{
    IAssetRegistry& AssetRegistry = IAssetRegistry::GetChecked();

    // 1. 필터 생성
    FARFilter Filter;
    Filter.ClassPaths.Add(UStaticMesh::StaticClass()->GetClassPathName());
    Filter.PackagePaths.Add(TEXT("/Game"));
    Filter.bRecursivePaths = true;

    // 2. 즉시 검색 (에셋 로드 없음!)
    TArray<FAssetData> Assets;
    AssetRegistry.GetAssets(Filter, Assets);

    // 3. 메타데이터 접근 (여전히 로드 없음)
    for (const FAssetData& Asset : Assets)
    {
        FString NumTris = Asset.GetTagValueRef<FString>(TEXT("NumTriangles"));
        FString LODs = Asset.GetTagValueRef<FString>(TEXT("LODs"));

        // 실제로 필요한 에셋만 로드
        if (NeedToLoad(Asset))
        {
            UStaticMesh* Mesh = Cast<UStaticMesh>(Asset.GetAsset());
        }
    }
}

// ✅ 가능한 것들:
// - 프로젝트 내 모든 에셋 즉시 검색 (로드 없음!)
// - 복잡한 필터링 (클래스, 경로, 태그)
// - 의존성 분석 (GetDependencies/GetReferencers)
// - 콘텐츠 브라우저 실시간 필터링
// - 에셋 태그 기반 검색
```

### 설계 선택: 사전 인덱싱 vs 런타임 스캔

| 접근법 | 장점 | 단점 |
|-------|------|------|
| **런타임 파일 스캔** | - 항상 최신 상태<br>- 별도 캐시 불필요 | - 매우 느림 (수천 개 파일 I/O)<br>- 에셋 로드 필요<br>- 메모리 과다 사용 |
| **인메모리 인덱스 (AssetRegistry)** | - ✅ 초고속 검색<br>- ✅ 로드 없이 메타데이터 접근<br>- ✅ 의존성 그래프 사전 구축 | - ⚠️ 초기 스캔 시간<br>- ⚠️ 메모리 사용 (인덱스) |
| **데이터베이스** | - 영구 저장<br>- SQL 쿼리 | - 외부 의존성<br>- 동기화 복잡 |

**언리얼이 AssetRegistry를 선택한 이유:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   AssetRegistry 선택의 핵심 이유                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 성능 (Performance)                                                  │
│     ─────────────────────────────────────────────────────────────────  │
│     • 에셋 로드 없이 메타데이터 검색                                      │
│     • 메모리 인덱스로 O(log N) 검색                                      │
│     • 콘텐츠 브라우저 실시간 필터링 가능                                  │
│                                                                         │
│     [성능 비교]                                                         │
│     파일 스캔 (10,000 에셋):  ~300초 (각 파일 로드)                      │
│     AssetRegistry:            ~0.001초 (인덱스 조회)                     │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  2. 메모리 효율 (Memory Efficiency)                                     │
│     ─────────────────────────────────────────────────────────────────  │
│     • 에셋을 로드하지 않고 메타데이터만 저장                              │
│     • FAssetData는 작음 (수백 bytes vs 에셋 수MB)                        │
│                                                                         │
│     [메모리 비교]                                                       │
│     UStaticMesh 로드:         ~10MB (지오메트리, 텍스처 등)              │
│     FAssetData:               ~500 bytes (이름, 클래스, 태그)            │
│     10,000 에셋 전체 로드:    ~100GB                                    │
│     AssetRegistry 인덱스:     ~5MB                                      │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  3. 에디터 통합 (Editor Integration)                                    │
│     ─────────────────────────────────────────────────────────────────  │
│     • 콘텐츠 브라우저 실시간 검색                                         │
│     • 레퍼런스 뷰어 의존성 그래프                                         │
│     • 에셋 감사 (Audit) 툴                                               │
│     • 리다이렉터 수정 툴                                                 │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  4. 쿠킹 최적화 (Cooking Optimization)                                  │
│     ─────────────────────────────────────────────────────────────────  │
│     • 에디터에서 구축한 인덱스를 직렬화                                   │
│     • 런타임에서 즉시 사용 가능                                          │
│     • Primary Asset 기반 청크 할당                                       │
│     • 불필요한 에셋 제외 (쿠커 필터링)                                    │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  5. 의존성 관리 (Dependency Management)                                 │
│     ─────────────────────────────────────────────────────────────────  │
│     • Hard/Soft 참조 구분                                                │
│     • 순환 참조 감지                                                     │
│     • "어디서 사용되는지" 역방향 검색 (GetReferencers)                    │
│     • Primary Asset 관리 체인                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 주요 API

### 1. 에셋 검색 기본

```cpp
#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetRegistry/IAssetRegistry.h"

// 싱글톤 접근
IAssetRegistry& AssetRegistry = IAssetRegistry::GetChecked();

// 1. 특정 패키지의 에셋 가져오기
TArray<FAssetData> Assets;
FName PackageName = TEXT("/Game/Characters/Hero");
AssetRegistry.GetAssetsByPackageName(PackageName, Assets);

for (const FAssetData& Asset : Assets)
{
    UE_LOG(LogTemp, Log, TEXT("Asset: %s, Class: %s"),
        *Asset.AssetName.ToString(),
        *Asset.AssetClassPath.ToString());
}

// 2. 특정 경로의 모든 에셋 가져오기
TArray<FAssetData> PathAssets;
FName PackagePath = TEXT("/Game/Characters");
AssetRegistry.GetAssetsByPath(PackagePath, PathAssets, /*bRecursive=*/true);

// 3. 특정 클래스의 모든 에셋 가져오기
TArray<FAssetData> MeshAssets;
AssetRegistry.GetAssetsByClass(
    UStaticMesh::StaticClass()->GetClassPathName(),
    MeshAssets
);

// 4. 오브젝트 경로로 에셋 가져오기
FSoftObjectPath ObjectPath(TEXT("/Game/Characters/Hero.Hero"));
FAssetData AssetData = AssetRegistry.GetAssetByObjectPath(ObjectPath);

if (AssetData.IsValid())
{
    UE_LOG(LogTemp, Log, TEXT("Found: %s"), *AssetData.AssetName.ToString());
}
```

### 2. FARFilter를 사용한 복잡한 쿼리

```cpp
// 복합 필터 생성
FARFilter Filter;

// 경로 필터 (여러 경로 + 재귀)
Filter.PackagePaths.Add(TEXT("/Game/Characters"));
Filter.PackagePaths.Add(TEXT("/Game/Weapons"));
Filter.bRecursivePaths = true;

// 클래스 필터 (파생 클래스 포함)
Filter.ClassPaths.Add(UStaticMesh::StaticClass()->GetClassPathName());
Filter.ClassPaths.Add(USkeletalMesh::StaticClass()->GetClassPathName());
Filter.bRecursiveClasses = true;

// 태그 필터
Filter.TagsAndValues.Add(TEXT("LODs"), TEXT("4"));

// 쿼리 실행
TArray<FAssetData> FilteredAssets;
IAssetRegistry::Get()->GetAssets(Filter, FilteredAssets);

UE_LOG(LogTemp, Log, TEXT("Found %d assets matching filter"), FilteredAssets.Num());
```

### 3. 에셋 태그 사용

```cpp
// 에셋에 커스텀 태그 추가 (C++ 클래스에서)
UCLASS()
class UMyAsset : public UObject
{
    GENERATED_BODY()

public:
    UPROPERTY(EditAnywhere, AssetRegistrySearchable, Category = "Metadata")
    int32 Rarity = 1;

    UPROPERTY(EditAnywhere, AssetRegistrySearchable, Category = "Metadata")
    FString Category = TEXT("Weapon");

    virtual void GetAssetRegistryTags(TArray<FAssetRegistryTag>& OutTags) const override
    {
        Super::GetAssetRegistryTags(OutTags);

        // 커스텀 태그 추가
        OutTags.Add(FAssetRegistryTag(
            TEXT("Rarity"),
            FString::FromInt(Rarity),
            FAssetRegistryTag::TT_Numerical
        ));

        OutTags.Add(FAssetRegistryTag(
            TEXT("Category"),
            Category,
            FAssetRegistryTag::TT_Alphabetical
        ));
    }
};

// 태그로 검색
IAssetRegistry& AssetRegistry = IAssetRegistry::GetChecked();

FARFilter Filter;
Filter.ClassPaths.Add(UMyAsset::StaticClass()->GetClassPathName());
Filter.TagsAndValues.Add(TEXT("Rarity"), TEXT("5"));  // 전설 등급만

TArray<FAssetData> RareAssets;
AssetRegistry.GetAssets(Filter, RareAssets);

// 태그 값 읽기
for (const FAssetData& Asset : RareAssets)
{
    FString Category;
    if (Asset.GetTagValue(TEXT("Category"), Category))
    {
        UE_LOG(LogTemp, Log, TEXT("Rare %s: %s"), *Category, *Asset.AssetName.ToString());
    }
}
```

### 4. 의존성 분석

```cpp
IAssetRegistry& AssetRegistry = IAssetRegistry::GetChecked();

// 1. 특정 에셋이 의존하는 에셋 찾기
FAssetIdentifier AssetId(TEXT("/Game/Characters/Hero.Hero"));

TArray<FAssetIdentifier> Dependencies;
AssetRegistry.GetDependencies(
    AssetId,
    Dependencies,
    UE::AssetRegistry::EDependencyCategory::Package
);

UE_LOG(LogTemp, Log, TEXT("%s depends on:"), *AssetId.ToString());
for (const FAssetIdentifier& Dep : Dependencies)
{
    UE_LOG(LogTemp, Log, TEXT("  - %s"), *Dep.ToString());
}

// 2. 특정 에셋을 참조하는 에셋 찾기 (역방향)
TArray<FAssetIdentifier> Referencers;
AssetRegistry.GetReferencers(
    AssetId,
    Referencers,
    UE::AssetRegistry::EDependencyCategory::Package
);

UE_LOG(LogTemp, Log, TEXT("%s is referenced by:"), *AssetId.ToString());
for (const FAssetIdentifier& Ref : Referencers)
{
    UE_LOG(LogTemp, Log, TEXT("  - %s"), *Ref.ToString());
}

// 3. Hard/Soft 참조 구분
FAssetRegistryDependencyOptions DepOptions;
DepOptions.bIncludeHardPackageReferences = true;
DepOptions.bIncludeSoftPackageReferences = false;  // Soft 참조 제외

TArray<FAssetDependency> HardDeps;
AssetRegistry.GetDependencies(AssetId, HardDeps, DepOptions);

// 4. 순환 참조 탐지
TSet<FAssetIdentifier> Visited;
TArray<FAssetIdentifier> Stack;

bool bHasCycle = DetectCyclicDependency(AssetId, AssetRegistry, Visited, Stack);
if (bHasCycle)
{
    UE_LOG(LogTemp, Warning, TEXT("Cyclic dependency detected!"));
    for (const FAssetIdentifier& Id : Stack)
    {
        UE_LOG(LogTemp, Warning, TEXT("  -> %s"), *Id.ToString());
    }
}
```

### 5. 비동기 스캔

```cpp
IAssetRegistry& AssetRegistry = IAssetRegistry::GetChecked();

// 1. 특정 경로 스캔 (비동기)
TArray<FString> PathsToScan;
PathsToScan.Add(TEXT("/Game/NewContent"));

AssetRegistry.ScanPathsSynchronous(
    PathsToScan,
    /*bForceRescan=*/true
);

// 2. 스캔 완료 대기
if (AssetRegistry.IsLoadingAssets())
{
    UE_LOG(LogTemp, Log, TEXT("Scanning assets..."));
    AssetRegistry.WaitForCompletion();
    UE_LOG(LogTemp, Log, TEXT("Scan complete!"));
}

// 3. 개별 파일 스캔
TArray<FString> FilesToScan;
FilesToScan.Add(TEXT("C:/Project/Content/NewAsset.uasset"));

AssetRegistry.ScanFilesSynchronous(FilesToScan);

// 4. 수정된 파일만 재스캔
TArray<FString> ModifiedFiles;
ModifiedFiles.Add(TEXT("C:/Project/Content/UpdatedAsset.uasset"));

AssetRegistry.ScanModifiedAssetFiles(ModifiedFiles);
```

### 6. 에셋 레지스트리 이벤트

```cpp
class FMyAssetListener
{
public:
    void RegisterCallbacks()
    {
        IAssetRegistry& AssetRegistry = IAssetRegistry::GetChecked();

        // 에셋 추가 이벤트
        AssetRegistry.OnAssetAdded().AddRaw(this, &FMyAssetListener::OnAssetAdded);

        // 에셋 제거 이벤트
        AssetRegistry.OnAssetRemoved().AddRaw(this, &FMyAssetListener::OnAssetRemoved);

        // 에셋 이름 변경 이벤트
        AssetRegistry.OnAssetRenamed().AddRaw(this, &FMyAssetListener::OnAssetRenamed);

        // 에셋 업데이트 이벤트 (태그 변경 등)
        AssetRegistry.OnAssetUpdated().AddRaw(this, &FMyAssetListener::OnAssetUpdated);

        // 메모리 에셋 생성 이벤트
        AssetRegistry.OnInMemoryAssetCreated().AddRaw(this, &FMyAssetListener::OnInMemoryAssetCreated);

        // 메모리 에셋 삭제 이벤트
        AssetRegistry.OnInMemoryAssetDeleted().AddRaw(this, &FMyAssetListener::OnInMemoryAssetDeleted);

        // 파일 로드 완료 이벤트
        AssetRegistry.OnFilesLoaded().AddRaw(this, &FMyAssetListener::OnFilesLoaded);
    }

private:
    void OnAssetAdded(const FAssetData& AssetData)
    {
        UE_LOG(LogTemp, Log, TEXT("Asset added: %s"), *AssetData.AssetName.ToString());
    }

    void OnAssetRemoved(const FAssetData& AssetData)
    {
        UE_LOG(LogTemp, Log, TEXT("Asset removed: %s"), *AssetData.AssetName.ToString());
    }

    void OnAssetRenamed(const FAssetData& AssetData, const FString& OldPath)
    {
        UE_LOG(LogTemp, Log, TEXT("Asset renamed: %s -> %s"),
            *OldPath,
            *AssetData.GetObjectPathString());
    }

    void OnAssetUpdated(const FAssetData& AssetData)
    {
        UE_LOG(LogTemp, Log, TEXT("Asset updated: %s"), *AssetData.AssetName.ToString());
    }

    void OnInMemoryAssetCreated(UObject* Asset)
    {
        UE_LOG(LogTemp, Log, TEXT("In-memory asset created: %s"), *Asset->GetName());
    }

    void OnInMemoryAssetDeleted(UObject* Asset)
    {
        UE_LOG(LogTemp, Log, TEXT("In-memory asset deleted: %s"), *Asset->GetName());
    }

    void OnFilesLoaded()
    {
        UE_LOG(LogTemp, Log, TEXT("AssetRegistry files loaded"));
    }
};
```

### 7. Primary Asset 관리

```cpp
// Primary Asset 정의
UCLASS()
class UMyPrimaryAsset : public UPrimaryDataAsset
{
    GENERATED_BODY()

public:
    // Primary Asset ID 정의
    virtual FPrimaryAssetId GetPrimaryAssetId() const override
    {
        return FPrimaryAssetId(TEXT("Weapon"), GetFName());
    }

    // 관리할 에셋 번들 정의
    UPROPERTY(EditAnywhere, Category = "AssetBundles")
    FAssetBundleData AssetBundles;
};

// Primary Asset 로딩
UAssetManager& AssetManager = UAssetManager::Get();

FPrimaryAssetId AssetId(TEXT("Weapon"), TEXT("Sword_Legendary"));

// 비동기 로드
TArray<FName> BundlesToLoad;
BundlesToLoad.Add(TEXT("Client"));  // 클라이언트 번들만 로드

FStreamableDelegate Callback = FStreamableDelegate::CreateLambda([AssetId]()
{
    UObject* LoadedAsset = UAssetManager::Get().GetPrimaryAssetObject(AssetId);
    UE_LOG(LogTemp, Log, TEXT("Primary Asset loaded: %s"), *LoadedAsset->GetName());
});

AssetManager.LoadPrimaryAsset(AssetId, BundlesToLoad, Callback);

// 청크 할당
UAssetManager::Get().SetPrimaryAssetIdChunks(AssetId, {0, 2});  // 청크 0, 2에 할당
```

---

## 💡 실전 활용 예제

### 예제 1: 콘텐츠 브라우저 스타일 검색

```cpp
class FContentBrowserSearcher
{
public:
    TArray<FAssetData> SearchAssets(
        const FString& SearchText,
        const FString& SelectedPath,
        const TArray<FTopLevelAssetPath>& ClassFilters,
        bool bRecursive = true)
    {
        IAssetRegistry& AssetRegistry = IAssetRegistry::GetChecked();

        // 필터 생성
        FARFilter Filter;

        // 경로 필터
        if (!SelectedPath.IsEmpty())
        {
            Filter.PackagePaths.Add(FName(*SelectedPath));
            Filter.bRecursivePaths = bRecursive;
        }

        // 클래스 필터
        if (ClassFilters.Num() > 0)
        {
            Filter.ClassPaths = ClassFilters;
            Filter.bRecursiveClasses = true;
        }

        // 검색 실행
        TArray<FAssetData> Assets;
        AssetRegistry.GetAssets(Filter, Assets);

        // 텍스트 검색 (AssetName 기반)
        if (!SearchText.IsEmpty())
        {
            Assets = Assets.FilterByPredicate([&SearchText](const FAssetData& Asset)
            {
                return Asset.AssetName.ToString().Contains(SearchText);
            });
        }

        return Assets;
    }
};

// 사용 예시
FContentBrowserSearcher Searcher;

TArray<FTopLevelAssetPath> Classes;
Classes.Add(UStaticMesh::StaticClass()->GetClassPathName());
Classes.Add(USkeletalMesh::StaticClass()->GetClassPathName());

TArray<FAssetData> Results = Searcher.SearchAssets(
    TEXT("Hero"),            // 검색어
    TEXT("/Game/Characters"), // 경로
    Classes,                 // 클래스 필터
    true                     // 재귀
);
```

### 예제 2: 에셋 감사 툴 (Unused Assets Finder)

```cpp
class FUnusedAssetFinder
{
public:
    TArray<FAssetData> FindUnusedAssets(const FString& RootPath)
    {
        IAssetRegistry& AssetRegistry = IAssetRegistry::GetChecked();

        // 1. 모든 에셋 가져오기
        TArray<FAssetData> AllAssets;
        AssetRegistry.GetAssetsByPath(FName(*RootPath), AllAssets, /*bRecursive=*/true);

        // 2. 레퍼런스가 없는 에셋 찾기
        TArray<FAssetData> UnusedAssets;

        for (const FAssetData& Asset : AllAssets)
        {
            // Primary Asset은 제외 (항상 필요)
            if (Asset.GetClass()->IsChildOf(UPrimaryDataAsset::StaticClass()))
            {
                continue;
            }

            // 레퍼런서 확인
            TArray<FAssetIdentifier> Referencers;
            FAssetIdentifier AssetId = FAssetIdentifier::FromString(Asset.GetObjectPathString());
            AssetRegistry.GetReferencers(AssetId, Referencers);

            // 레퍼런스가 없으면 미사용
            if (Referencers.Num() == 0)
            {
                UnusedAssets.Add(Asset);
            }
        }

        return UnusedAssets;
    }

    void DeleteUnusedAssets(const TArray<FAssetData>& UnusedAssets)
    {
        FAssetRegistryModule& AssetRegistryModule =
            FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));

        for (const FAssetData& Asset : UnusedAssets)
        {
            UE_LOG(LogTemp, Warning, TEXT("Deleting unused asset: %s"),
                *Asset.GetObjectPathString());

            // 에디터에서 삭제
            if (UObject* LoadedAsset = Asset.GetAsset())
            {
                ObjectTools::DeleteSingleObject(LoadedAsset);
            }
        }
    }
};
```

### 예제 3: 의존성 그래프 시각화

```cpp
class FDependencyGraphBuilder
{
public:
    struct FGraphNode
    {
        FAssetIdentifier AssetId;
        TArray<FGraphNode*> Dependencies;
        TArray<FGraphNode*> Referencers;
        int32 Depth = 0;
    };

    FGraphNode* BuildDependencyGraph(const FAssetIdentifier& RootAsset, int32 MaxDepth = 3)
    {
        IAssetRegistry& AssetRegistry = IAssetRegistry::GetChecked();

        TMap<FAssetIdentifier, FGraphNode*> Nodes;
        FGraphNode* Root = BuildGraphRecursive(RootAsset, 0, MaxDepth, AssetRegistry, Nodes);

        return Root;
    }

private:
    FGraphNode* BuildGraphRecursive(
        const FAssetIdentifier& AssetId,
        int32 Depth,
        int32 MaxDepth,
        IAssetRegistry& AssetRegistry,
        TMap<FAssetIdentifier, FGraphNode*>& Nodes)
    {
        // 이미 방문한 노드
        if (Nodes.Contains(AssetId))
        {
            return Nodes[AssetId];
        }

        // 최대 깊이 도달
        if (Depth >= MaxDepth)
        {
            return nullptr;
        }

        // 새 노드 생성
        FGraphNode* Node = new FGraphNode();
        Node->AssetId = AssetId;
        Node->Depth = Depth;
        Nodes.Add(AssetId, Node);

        // 의존성 수집
        TArray<FAssetIdentifier> Dependencies;
        AssetRegistry.GetDependencies(
            AssetId,
            Dependencies,
            UE::AssetRegistry::EDependencyCategory::Package
        );

        // 재귀적 그래프 구축
        for (const FAssetIdentifier& Dep : Dependencies)
        {
            FGraphNode* DepNode = BuildGraphRecursive(Dep, Depth + 1, MaxDepth, AssetRegistry, Nodes);
            if (DepNode)
            {
                Node->Dependencies.Add(DepNode);
                DepNode->Referencers.Add(Node);
            }
        }

        return Node;
    }

public:
    void PrintGraph(const FGraphNode* Node)
    {
        if (!Node) return;

        FString Indent = FString::ChrN(Node->Depth * 2, ' ');
        UE_LOG(LogTemp, Log, TEXT("%s%s"), *Indent, *Node->AssetId.ToString());

        for (const FGraphNode* Dep : Node->Dependencies)
        {
            PrintGraph(Dep);
        }
    }
};

// 사용 예시
FDependencyGraphBuilder Builder;
FAssetIdentifier RootAsset(TEXT("/Game/Characters/Hero.Hero"));
FDependencyGraphBuilder::FGraphNode* Graph = Builder.BuildDependencyGraph(RootAsset, 3);

Builder.PrintGraph(Graph);
```

---

## 🚨 일반적인 함정

### ❌ bIncludeOnlyOnDiskAssets 이해 부족

```cpp
// ❌ 잘못됨: 메모리 에셋을 놓칠 수 있음
TArray<FAssetData> Assets;
IAssetRegistry::Get()->GetAssetsByPath(
    FName(TEXT("/Game")),
    Assets,
    /*bRecursive=*/true,
    /*bIncludeOnlyOnDiskAssets=*/true  // 디스크 에셋만!
);

// 런타임에 생성된 에셋은 포함 안 됨!
// 예: Procedural Material, Dynamic Texture 등

// ✅ 올바름: 메모리 에셋도 포함
IAssetRegistry::Get()->GetAssetsByPath(
    FName(TEXT("/Game")),
    Assets,
    /*bRecursive=*/true,
    /*bIncludeOnlyOnDiskAssets=*/false  // 메모리 에셋도 포함
);
```

### ❌ AssetRegistry 스캔 완료 전 쿼리

```cpp
// ❌ 잘못됨: 에디터 시작 직후 쿼리
void UMyGameInstance::Init()
{
    Super::Init();

    // AssetRegistry가 아직 스캔 중일 수 있음!
    TArray<FAssetData> Assets;
    IAssetRegistry::Get()->GetAllAssets(Assets);
    // Assets.Num() == 0 일 수 있음!
}

// ✅ 올바름: 스캔 완료 대기
void UMyGameInstance::Init()
{
    Super::Init();

    IAssetRegistry& AssetRegistry = IAssetRegistry::GetChecked();

    if (AssetRegistry.IsLoadingAssets())
    {
        // 스캔 완료 이벤트 등록
        AssetRegistry.OnFilesLoaded().AddLambda([this]()
        {
            // 이제 안전하게 쿼리 가능
            TArray<FAssetData> Assets;
            IAssetRegistry::Get()->GetAllAssets(Assets);
            UE_LOG(LogTemp, Log, TEXT("Found %d assets"), Assets.Num());
        });
    }
    else
    {
        // 이미 스캔 완료
        TArray<FAssetData> Assets;
        AssetRegistry.GetAllAssets(Assets);
    }
}
```

### ❌ GetAsset() 남용으로 인한 성능 저하

```cpp
// ❌ 나쁨: 모든 에셋을 로드
TArray<FAssetData> AllMeshes;
IAssetRegistry::Get()->GetAssetsByClass(
    UStaticMesh::StaticClass()->GetClassPathName(),
    AllMeshes
);

for (const FAssetData& Asset : AllMeshes)
{
    UStaticMesh* Mesh = Cast<UStaticMesh>(Asset.GetAsset());  // 로드!
    // 수천 개의 메시를 모두 로드 - 메모리 폭발!
}

// ✅ 좋음: 필요한 것만 로드
TArray<FAssetData> AllMeshes;
IAssetRegistry::Get()->GetAssetsByClass(
    UStaticMesh::StaticClass()->GetClassPathName(),
    AllMeshes
);

for (const FAssetData& Asset : AllMeshes)
{
    // 먼저 메타데이터 확인 (로드 없음)
    FString NumTris = Asset.GetTagValueRef<FString>(TEXT("NumTriangles"));

    // 조건에 맞는 에셋만 로드
    if (FCString::Atoi(*NumTris) < 10000)
    {
        UStaticMesh* Mesh = Cast<UStaticMesh>(Asset.GetAsset());  // 로드
        // 처리...
    }
}
```

### ❌ FARFilter 중복 조건

```cpp
// ❌ 비효율적: 같은 조건 여러 번
FARFilter Filter;
Filter.PackagePaths.Add(TEXT("/Game/Characters"));
Filter.PackagePaths.Add(TEXT("/Game/Characters"));  // 중복!
Filter.ClassPaths.Add(UStaticMesh::StaticClass()->GetClassPathName());
Filter.ClassPaths.Add(UStaticMesh::StaticClass()->GetClassPathName());  // 중복!

// ✅ 효율적: TSet 사용 또는 중복 제거
TSet<FName> UniquePaths;
UniquePaths.Add(TEXT("/Game/Characters"));
UniquePaths.Add(TEXT("/Game/Weapons"));

Filter.PackagePaths = UniquePaths.Array();
```

---

## 🔍 디버깅 팁

### 콘솔 명령어

```bash
# 에셋 레지스트리 정보
AssetRegistry.DumpState              # 전체 상태 덤프
AssetRegistry.PrintAssetData [Path]  # 특정 에셋 정보

# 의존성 분석
AssetRegistry.FindInvalidUAssets     # 유효하지 않은 에셋 찾기
AssetRegistry.PrintReferencers [Asset]  # 레퍼런서 출력
AssetRegistry.PrintDependencies [Asset] # 의존성 출력

# 스캔 제어
AssetRegistry.SearchAllAssets        # 전체 재스캔
AssetRegistry.ScanPathsSynchronous [Path]  # 특정 경로 스캔
```

### Unreal Insights 프로파일링

```cpp
// AssetRegistry 성능 추적
TRACE_CPUPROFILER_EVENT_SCOPE(AssetRegistryQuery);

IAssetRegistry& AssetRegistry = IAssetRegistry::GetChecked();
TArray<FAssetData> Assets;
AssetRegistry.GetAllAssets(Assets);

// Insights에서 "AssetRegistryQuery" 이벤트 확인
```

### 에셋 레지스트리 통계

```cpp
// 통계 수집
IAssetRegistry& AssetRegistry = IAssetRegistry::GetChecked();

TArray<FAssetData> AllAssets;
AssetRegistry.GetAllAssets(AllAssets);

TMap<FTopLevelAssetPath, int32> ClassCounts;

for (const FAssetData& Asset : AllAssets)
{
    ClassCounts.FindOrAdd(Asset.AssetClassPath)++;
}

// 클래스별 에셋 수 출력
for (const auto& Pair : ClassCounts)
{
    UE_LOG(LogTemp, Log, TEXT("Class: %s, Count: %d"),
        *Pair.Key.ToString(),
        Pair.Value);
}
```

---

## 🔗 참고자료

- [Asset Registry Documentation](https://docs.unrealengine.com/asset-registry-in-unreal-engine/)
- [Asset Management Framework](https://docs.unrealengine.com/asset-management-in-unreal-engine/)
- [IAssetRegistry API](https://docs.unrealengine.com/API/Runtime/AssetRegistry/IAssetRegistry/)
- [FAssetData API](https://docs.unrealengine.com/API/Runtime/CoreUObject/AssetRegistry/FAssetData/)
- [IAssetRegistry.h Source](Engine/Source/Runtime/AssetRegistry/Public/AssetRegistry/IAssetRegistry.h)
- [AssetData.h Source](Engine/Source/Runtime/CoreUObject/Public/AssetRegistry/AssetData.h)

---

> 📅 생성: 2025-10-20 — 에셋 레지스트리 시스템 문서화 (UE 5.6.1 검증 완료)
