---
title: "패키지 및 링커 시스템 (Package and Linker System)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "CoreUObject"
tags: ["unreal", "CoreUObject"]
---
# 패키지 및 링커 시스템 (Package and Linker System)

## 🧭 개요

**패키지(Package)**는 언리얼 엔진의 에셋 저장 및 로딩의 기본 단위입니다. 모든 UObject는 UPackage 안에 존재하며, **링커(Linker)** 시스템은 패키지를 디스크에 저장하고 메모리로 로드하는 핵심 메커니즘입니다.

**핵심 구성 요소:**
- **UPackage** - 패키지 오브젝트 (에셋 컨테이너)
- **FLinkerLoad** - 패키지 로딩
- **FLinkerSave** - 패키지 저장
- **FObjectImport** - 외부 오브젝트 참조
- **FObjectExport** - 패키지 내 오브젝트 정의
- **FPackageFileSummary** - 패키지 헤더
- **AsyncLoading2** - 이벤트 기반 비동기 로더 (EDL)

**주요 기능:**
- **패키지 저장** - .uasset, .umap 파일 생성
- **패키지 로딩** - 동기/비동기 로딩
- **의존성 해결** - Import/Export 테이블 관리
- **버전 관리** - 엔진 버전 및 커스텀 버전
- **에셋 레지스트리 통합** - 메타데이터 추출
- **쿠킹 지원** - 플랫폼 최적화

**패키지 파일 구조:**
```
MyAsset.uasset          // 메인 에셋 파일
├─ Package Summary      // 헤더 (버전, 테이블 오프셋)
├─ Name Table           // FName 문자열 목록
├─ Import Table         // 외부 참조 목록
├─ Export Table         // 내부 오브젝트 목록
└─ Export Data          // 실제 직렬화된 오브젝트 데이터

MyAsset.uexp            // BulkData (텍스처, 사운드 등)
MyAsset.ubulk           // 추가 BulkData (옵션)
```

**모듈 위치:**
- `Engine/Source/Runtime/CoreUObject/Public/UObject/Package.h`
- `Engine/Source/Runtime/CoreUObject/Public/UObject/Linker.h`
- `Engine/Source/Runtime/CoreUObject/Public/UObject/LinkerLoad.h`
- `Engine/Source/Runtime/CoreUObject/Public/UObject/LinkerSave.h`

**엔진 버전:** Unreal Engine 5.6.1 (2025년 기준)

---

## 🧱 구조

### 패키지 및 링커 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  Package and Linker Architecture                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [저장 (Saving)]                                                        │
│                                                                         │
│   게임/에디터 코드                                                       │
│      ↓                                                                  │
│   UPackage::Save() / SavePackage()                                      │
│      ↓                                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  FLinkerSave 생성                    │                            │
│   │  ───────────────────────────────     │                            │
│   │  1. Export 목록 수집                 │                            │
│   │     - 패키지 내 모든 UObject         │                            │
│   │  2. Import 목록 수집                 │                            │
│   │     - 외부 패키지 참조               │                            │
│   │  3. Name 테이블 구축                 │                            │
│   │     - 모든 FName 수집                │                            │
│   └──────────────────────────────────────┘                            │
│      ↓                                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  직렬화 (Serialization)              │                            │
│   │  ───────────────────────────────     │                            │
│   │  1. Package Summary 작성             │                            │
│   │  2. Name Table 작성                  │                            │
│   │  3. Import Table 작성                │                            │
│   │  4. Export Table 작성                │                            │
│   │  5. Export Data 작성                 │                            │
│   │     - 각 UObject::Serialize() 호출   │                            │
│   └──────────────────────────────────────┘                            │
│      ↓                                                                  │
│   .uasset 파일 생성                                                     │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [로딩 (Loading)]                                                       │
│                                                                         │
│   LoadPackage() / LoadPackageAsync()                                    │
│      ↓                                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  FLinkerLoad 생성                    │                            │
│   │  ───────────────────────────────     │                            │
│   │  1. 파일 열기 (.uasset)              │                            │
│   │  2. Package Summary 읽기             │                            │
│   │     - 버전 확인                      │                            │
│   │     - 테이블 오프셋 읽기             │                            │
│   │  3. Name Table 로드                  │                            │
│   │  4. Import Table 로드                │                            │
│   │  5. Export Table 로드                │                            │
│   └──────────────────────────────────────┘                            │
│      ↓                                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  Import 해결                         │                            │
│   │  ───────────────────────────────     │                            │
│   │  - 외부 패키지 로드 (재귀)           │                            │
│   │  - 의존성 체인 구축                  │                            │
│   └──────────────────────────────────────┘                            │
│      ↓                                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  Export 로드 (역직렬화)              │                            │
│   │  ───────────────────────────────     │                            │
│   │  1. UObject 생성 (NewObject)         │                            │
│   │  2. UObject::Serialize() 호출        │                            │
│   │     - 각 UPROPERTY 복원              │                            │
│   │  3. PostLoad() 호출                  │                            │
│   │     - 로드 후 초기화                 │                            │
│   └──────────────────────────────────────┘                            │
│      ↓                                                                  │
│   UPackage + UObject들 메모리에 생성                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### UPackage 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            UPackage                                     │
│  (에셋 컨테이너)                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  📂 위치: CoreUObject/Public/UObject/Package.h                          │
│                                                                         │
│  상속: UObject                                                          │
│                                                                         │
│  Public Members:                                                        │
│    - PackageFlags : uint32              // PKG_* 플래그               │
│    - FileName : FName                   // 파일 이름                   │
│    - FileSize : int64                   // 파일 크기                   │
│    - Guid : FGuid                       // 패키지 고유 ID              │
│    - ChunkIDs : TArray<int32>           // 청크 ID (쿠킹용)            │
│                                                                         │
│  Public Methods:                                                        │
│    + GetOutermost() : UPackage*         // 최상위 패키지 (자기 자신)    │
│    + Save(Filename, SaveFlags) : ESavePackageResult                    │
│    + FullyLoad() : void                 // 전체 로드                   │
│    + IsDirty() : bool                   // 수정 여부                   │
│    + MarkAsFullyLoaded() : void         // 로드 완료 표시              │
│    + GetMetaData() : UMetaData*         // 메타데이터 (에디터 전용)     │
│                                                                         │
│  Package Flags (EPackageFlags):                                         │
│    - PKG_None                = 0x00000000                              │
│    - PKG_NewlyCreated        = 0x00000001  // 신규 생성               │
│    - PKG_ClientOptional      = 0x00000002  // 클라이언트 옵션          │
│    - PKG_ServerSideOnly      = 0x00000004  // 서버 전용               │
│    - PKG_CompiledIn          = 0x00000010  // 네이티브 코드로 컴파일됨 │
│    - PKG_ForDiffing          = 0x00000020  // Diff용                  │
│    - PKG_EditorOnly          = 0x00000040  // 에디터 전용             │
│    - PKG_Developer           = 0x00000080  // 개발자 전용             │
│    - PKG_ContainsMapData     = 0x00004000  // 월드/레벨 데이터 포함    │
│    - PKG_Compiling           = 0x00010000  // 컴파일 중               │
│    - PKG_ContainsMap         = 0x00020000  // 맵 패키지               │
│    - PKG_RequiresLocalizationGather = 0x00040000  // 지역화 필요      │
│    - PKG_PlayInEditor        = 0x00100000  // PIE 패키지              │
│    - PKG_ContainsScript      = 0x00200000  // 스크립트 포함           │
│    - PKG_DisallowExport      = 0x00400000  // 익스포트 금지           │
│    - PKG_ReloadingForCooker  = 0x40000000  // 쿠커용 리로드 중         │
│    - PKG_FilterEditorOnly    = 0x80000000  // 에디터 전용 필터링       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### FLinkerLoad 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          FLinkerLoad                                    │
│  (패키지 로더)                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│  📂 위치: CoreUObject/Public/UObject/LinkerLoad.h:117                   │
│                                                                         │
│  상속: FLinker, FArchiveUObject                                         │
│                                                                         │
│  Public Members:                                                        │
│    - Summary : FPackageFileSummary      // 패키지 헤더                 │
│    - NameMap : TArray<FName>            // Name 테이블                 │
│    - ImportMap : TArray<FObjectImport>  // Import 테이블               │
│    - ExportMap : TArray<FObjectExport>  // Export 테이블               │
│    - LoadFlags : uint32                 // LOAD_* 플래그               │
│    - Loader : FArchive*                 // 파일 스트림                 │
│                                                                         │
│  Public Methods:                                                        │
│    + CreateLinkerAsync(PackagePath, LoadFlags) : FLinkerLoad*          │
│    + LoadPackage(Outer, PackageName, LoadFlags) : UPackage*            │
│    + Preload(Object) : void             // Export 로드                 │
│    + CreateExport(Index) : UObject*     // Export 오브젝트 생성        │
│    + CreateImport(Index) : UObject*     // Import 오브젝트 찾기        │
│    + VerifyImport(Index) : EVerifyResult // Import 검증               │
│    + ResolveAllImports() : void         // 모든 Import 해결            │
│                                                                         │
│  Loading Status:                                                        │
│    - LINKER_Failed   = 0                // 로딩 실패                   │
│    - LINKER_Loaded   = 1                // 로딩 성공                   │
│    - LINKER_TimedOut = 2                // 타임아웃                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### FPackageFileSummary (패키지 헤더)

```cpp
// 📂 위치: CoreUObject/Public/UObject/PackageFileSummary.h
struct FPackageFileSummary
{
    // 매직 넘버 (0x9E2A83C1)
    int32 Tag;

    // 파일 버전
    int32 FileVersionUE;                    // 언리얼 엔진 버전
    int32 FileVersionLicenseeUE;            // 라이선시 버전
    FCustomVersionContainer CustomVersionContainer;

    // 총 헤더 크기
    int32 TotalHeaderSize;

    // 패키지 이름
    FString PackageName;

    // 패키지 플래그
    uint32 PackageFlags;

    // 테이블 정보
    int32 NameCount;                        // Name 개수
    int32 NameOffset;                       // Name 테이블 오프셋
    int32 SoftObjectPathsCount;             // Soft 참조 개수
    int32 SoftObjectPathsOffset;            // Soft 참조 오프셋
    int32 GatherableTextDataCount;          // 지역화 텍스트 개수
    int32 GatherableTextDataOffset;         // 지역화 텍스트 오프셋
    int32 ExportCount;                      // Export 개수
    int32 ExportOffset;                     // Export 테이블 오프셋
    int32 ImportCount;                      // Import 개수
    int32 ImportOffset;                     // Import 테이블 오프셋
    int32 DependsOffset;                    // 의존성 테이블 오프셋
    int32 SoftPackageReferencesCount;       // Soft 패키지 참조 개수
    int32 SoftPackageReferencesOffset;      // Soft 패키지 참조 오프셋

    // 에셋 레지스트리 데이터
    int32 AssetRegistryDataOffset;
    int64 BulkDataStartOffset;

    // 월드 타일 정보 (맵 전용)
    int32 WorldTileInfoDataOffset;

    // 청크 ID
    TArray<int32> ChunkIDs;

    // Preload Dependencies (EDL용)
    int32 PreloadDependencyCount;
    int32 PreloadDependencyOffset;

    // 이름 해시 (빠른 검색용)
    int32 NamesReferencedFromExportDataCount;
    int64 PayloadTocOffset;

    // 압축 정보
    uint32 CompressionFlags;
    TArray<FCompressedChunk> CompressedChunks;

    // 패키지 소스 (DDC 키 등)
    int32 PackageSource;

    // 기타
    FGuid PersistentGuid;                   // 패키지 GUID
    FGuid Guid;                             // 저장 GUID
    FGenerationInfo Generations[1];         // 세대 정보
};
```

### FObjectExport 구조

```cpp
// 📂 위치: CoreUObject/Public/UObject/ObjectResource.h
struct FObjectExport
{
    // 오브젝트 정보
    int32 ClassIndex;                       // 클래스 (Import 인덱스)
    int32 SuperIndex;                       // 부모 클래스
    int32 TemplateIndex;                    // 템플릿 (Archetype)
    int32 OuterIndex;                       // Outer 오브젝트
    FName ObjectName;                       // 오브젝트 이름

    // 플래그
    uint32 ObjectFlags;                     // RF_* 플래그

    // 직렬화 정보
    int64 SerialSize;                       // 직렬화 크기
    int64 SerialOffset;                     // 직렬화 오프셋

    // Export 플래그
    bool bForcedExport;                     // 강제 Export
    bool bNotForClient;                     // 클라이언트 제외
    bool bNotForServer;                     // 서버 제외
    bool bIsAsset;                          // 에셋 여부
    bool bGeneratePublicHash;               // Public Hash 생성

    // 패키지 GUID (참조 검증용)
    FGuid PackageGuid;

    // Preload Dependencies (EDL용)
    TArray<int32> FirstExportDependency;
    int32 SerializationBeforeSerializationDependencies;
    int32 CreateBeforeSerializationDependencies;
    int32 SerializationBeforeCreateDependencies;
    int32 CreateBeforeCreateDependencies;
};
```

### FObjectImport 구조

```cpp
// 📂 위치: CoreUObject/Public/UObject/ObjectResource.h
struct FObjectImport
{
    // 외부 오브젝트 정보
    FName ClassPackage;                     // 클래스 패키지 이름
    FName ClassName;                        // 클래스 이름
    int32 OuterIndex;                       // Outer Import 인덱스
    FName ObjectName;                        // 오브젝트 이름

    // Import 해결 결과
    UObject* XObject;                       // 실제 UObject (로드 후)
    FLinkerLoad* SourceLinker;              // 소스 Linker
    int32 SourceIndex;                      // 소스 Export 인덱스

    // 옵션
    bool bImportOptional;                   // 옵션 Import (없어도 됨)
    bool bImportSearchedFor;                // 검색 완료 여부
    bool bImportFailed;                     // Import 실패
};
```

---

## 🔬 설계 철학: 왜 Import/Export 테이블인가?

### 직접 포인터 저장의 한계

```cpp
// ❌ 불가능: 포인터를 직접 파일에 저장

class UMyActor : public AActor
{
    UPROPERTY()
    UStaticMesh* Mesh;  // 포인터: 0x00007FF8'1234'5678
};

// 파일에 저장 시:
void Save()
{
    // 포인터 주소를 저장?
    File.Write(&Mesh, sizeof(void*));  // ❌ 다음 실행 시 무효!
}

// 문제점:
// 1. 포인터는 런타임마다 다름
// 2. 외부 에셋 참조 불가
// 3. 플랫폼 간 호환 불가
// 4. 버전 변경 시 호환 불가
```

```cpp
// ✅ 언리얼 방식: Import/Export 인덱스

// Export Table (패키지 내부 오브젝트)
// Index  ClassName      ObjectName      Outer
//   0    Actor          MyActor         None
//   1    StaticMeshComp MeshComp        MyActor

// Import Table (외부 패키지 참조)
// Index  ClassPackage   ClassName       ObjectName
//   0    /Script/Engine StaticMesh      /Game/Meshes/Cube

// 저장 시:
MyActor.MeshComp = Import[0]  // "Import 0번을 참조"

// 로드 시:
1. Import[0] 해결 → /Game/Meshes/Cube 로드
2. MyActor.MeshComp에 할당
```

### Import/Export 테이블 이점

| 특징 | 직접 포인터 저장 | Import/Export 테이블 |
|------|------------------|---------------------|
| **주소 독립성** | ❌ 런타임마다 다름 | ✅ 심볼릭 참조 |
| **외부 참조** | ❌ 불가능 | ✅ 다른 패키지 참조 가능 |
| **플랫폼 독립성** | ❌ 포인터 크기 다름 | ✅ 모든 플랫폼 동일 |
| **버전 호환성** | ❌ 레이아웃 변경 시 깨짐 | ✅ 이름 기반 검색 |
| **지연 로딩** | ❌ 불가능 | ✅ Import만 해결 후 지연 가능 |
| **리다이렉션** | ❌ 불가능 | ✅ CoreRedirects 지원 |

---

## 🧩 주요 API

### 1. 패키지 로딩 (동기)

```cpp
#include "UObject/Package.h"
#include "UObject/UObjectGlobals.h"

// 기본 패키지 로딩
UPackage* Package = LoadPackage(
    nullptr,                                // Outer
    TEXT("/Game/MyAsset"),                  // 패키지 이름
    LOAD_None                               // 로드 플래그
);

if (Package)
{
    // 패키지 내 오브젝트 찾기
    UObject* Asset = FindObject<UObject>(
        Package,
        TEXT("MyAsset")
    );
}

// 특정 클래스 로딩
UStaticMesh* Mesh = LoadObject<UStaticMesh>(
    nullptr,
    TEXT("/Game/Meshes/Cube.Cube")
);

// 로드 플래그 사용
UPackage* PackageNoWarn = LoadPackage(
    nullptr,
    TEXT("/Game/MyAsset"),
    LOAD_NoWarn | LOAD_Quiet  // 경고 억제
);
```

### 2. 패키지 로딩 (비동기)

```cpp
#include "Engine/StreamableManager.h"
#include "Engine/AssetManager.h"

// StreamableManager 사용
FStreamableManager& Streamable = UAssetManager::GetStreamableManager();

// 단일 에셋 비동기 로드
FSoftObjectPath AssetPath(TEXT("/Game/Meshes/Cube.Cube"));

FStreamableDelegate OnLoadedDelegate = FStreamableDelegate::CreateLambda([AssetPath]()
{
    UObject* LoadedAsset = AssetPath.ResolveObject();
    if (LoadedAsset)
    {
        UE_LOG(LogTemp, Log, TEXT("Asset loaded: %s"), *LoadedAsset->GetName());
    }
});

TSharedPtr<FStreamableHandle> Handle = Streamable.RequestAsyncLoad(
    AssetPath,
    OnLoadedDelegate
);

// 여러 에셋 동시 로드
TArray<FSoftObjectPath> AssetsToLoad;
AssetsToLoad.Add(FSoftObjectPath(TEXT("/Game/Meshes/Cube")));
AssetsToLoad.Add(FSoftObjectPath(TEXT("/Game/Textures/T_Default")));
AssetsToLoad.Add(FSoftObjectPath(TEXT("/Game/Materials/M_Default")));

Streamable.RequestAsyncLoad(
    AssetsToLoad,
    FStreamableDelegate::CreateLambda([]()
    {
        UE_LOG(LogTemp, Log, TEXT("All assets loaded!"));
    })
);

// 로딩 진행률 확인
if (Handle.IsValid())
{
    float Progress = Handle->GetProgress();  // 0.0 ~ 1.0
    bool bLoaded = Handle->HasLoadCompleted();

    // 수동으로 대기 (블로킹)
    Handle->WaitUntilComplete();
}
```

### 3. 패키지 저장

```cpp
#include "UObject/SavePackage.h"

// 기본 패키지 저장
UPackage* Package = CreatePackage(TEXT("/Game/MyNewAsset"));
UStaticMesh* Mesh = NewObject<UStaticMesh>(Package, TEXT("MyMesh"), RF_Public | RF_Standalone);

// 메시 데이터 설정...

// 저장
FSavePackageArgs SaveArgs;
SaveArgs.TopLevelFlags = RF_Public | RF_Standalone;
SaveArgs.SaveFlags = SAVE_NoError;

FSavePackageResultStruct Result = UPackage::SavePackage(
    Package,
    Mesh,
    TEXT("C:/MyProject/Content/MyNewAsset.uasset"),
    SaveArgs
);

if (Result == ESavePackageResult::Success)
{
    UE_LOG(LogTemp, Log, TEXT("Package saved successfully"));
    UE_LOG(LogTemp, Log, TEXT("File size: %lld bytes"), Result.TotalFileSize);
}
```

### 4. FLinkerLoad 직접 사용

```cpp
#include "UObject/LinkerLoad.h"
#include "UObject/Package.h"

// FLinkerLoad 생성
FPackagePath PackagePath = FPackagePath::FromPackageNameChecked(TEXT("/Game/MyAsset"));

FLinkerLoad* Linker = FLinkerLoad::CreateLinkerAsync(
    nullptr,
    PackagePath,
    LOAD_None
);

if (Linker)
{
    // 패키지 헤더 정보 확인
    const FPackageFileSummary& Summary = Linker->Summary;

    UE_LOG(LogTemp, Log, TEXT("Package: %s"), *Summary.PackageName);
    UE_LOG(LogTemp, Log, TEXT("Engine Version: %d"), Summary.FileVersionUE);
    UE_LOG(LogTemp, Log, TEXT("Export Count: %d"), Summary.ExportCount);
    UE_LOG(LogTemp, Log, TEXT("Import Count: %d"), Summary.ImportCount);

    // Export 목록 순회
    for (int32 i = 0; i < Linker->ExportMap.Num(); ++i)
    {
        const FObjectExport& Export = Linker->ExportMap[i];

        UE_LOG(LogTemp, Log, TEXT("Export[%d]: %s (Size: %lld bytes)"),
            i,
            *Export.ObjectName.ToString(),
            Export.SerialSize
        );
    }

    // Import 목록 순회
    for (int32 i = 0; i < Linker->ImportMap.Num(); ++i)
    {
        const FObjectImport& Import = Linker->ImportMap[i];

        UE_LOG(LogTemp, Log, TEXT("Import[%d]: %s.%s"),
            i,
            *Import.ClassPackage.ToString(),
            *Import.ObjectName.ToString()
        );
    }

    // Export 로드
    for (int32 i = 0; i < Linker->ExportMap.Num(); ++i)
    {
        UObject* LoadedObject = Linker->CreateExport(i);

        if (LoadedObject)
        {
            // Preload - 실제 데이터 로드
            Linker->Preload(LoadedObject);
        }
    }
}
```

### 5. 패키지 의존성 분석

```cpp
#include "AssetRegistry/AssetRegistryModule.h"
#include "UObject/LinkerLoad.h"

void AnalyzePackageDependencies(const FString& PackageName)
{
    // 패키지 로드
    UPackage* Package = LoadPackage(nullptr, *PackageName, LOAD_None);

    if (!Package)
    {
        return;
    }

    // Linker 가져오기
    FLinkerLoad* Linker = Package->GetLinker();

    if (!Linker)
    {
        return;
    }

    // Hard Dependencies (Import 테이블)
    TSet<FName> HardDependencies;

    for (const FObjectImport& Import : Linker->ImportMap)
    {
        // 패키지 이름 추출
        FName PackageName = Import.ClassPackage;

        // /Script/ 제외 (엔진 코드)
        if (!PackageName.ToString().StartsWith(TEXT("/Script/")))
        {
            HardDependencies.Add(PackageName);
        }
    }

    // Soft Dependencies (AssetRegistry 사용)
    IAssetRegistry& AssetRegistry = FModuleManager::LoadModuleChecked<FAssetRegistryModule>("AssetRegistry").Get();

    TArray<FAssetIdentifier> Dependencies;
    AssetRegistry.GetDependencies(
        FAssetIdentifier(FName(*PackageName)),
        Dependencies,
        UE::AssetRegistry::EDependencyCategory::Package,
        UE::AssetRegistry::EDependencyQuery::Soft
    );

    // 출력
    UE_LOG(LogTemp, Log, TEXT("=== Package Dependencies: %s ==="), *PackageName);

    UE_LOG(LogTemp, Log, TEXT("Hard Dependencies (%d):"), HardDependencies.Num());
    for (const FName& Dep : HardDependencies)
    {
        UE_LOG(LogTemp, Log, TEXT("  - %s"), *Dep.ToString());
    }

    UE_LOG(LogTemp, Log, TEXT("Soft Dependencies (%d):"), Dependencies.Num());
    for (const FAssetIdentifier& Dep : Dependencies)
    {
        UE_LOG(LogTemp, Log, TEXT("  - %s"), *Dep.ToString());
    }
}
```

### 6. 패키지 전체 로드 (FullyLoad)

```cpp
// 패키지 부분 로드 (기본)
UPackage* Package = LoadPackage(nullptr, TEXT("/Game/MyAsset"), LOAD_None);
// 이 시점에서는 Export 테이블만 로드, 실제 데이터는 필요할 때 로드

// 전체 로드 (모든 Export 강제 로드)
Package->FullyLoad();
// 이제 모든 오브젝트가 메모리에 로드됨

// 사용 예시: 에셋 검증
void ValidatePackage(const FString& PackageName)
{
    UPackage* Package = LoadPackage(nullptr, *PackageName, LOAD_None);

    if (Package)
    {
        // 모든 오브젝트 로드
        Package->FullyLoad();

        // 패키지 내 모든 오브젝트 순회
        ForEachObjectWithPackage(Package, [](UObject* Object)
        {
            // 검증 로직
            if (!Object->IsValidLowLevel())
            {
                UE_LOG(LogTemp, Error, TEXT("Invalid object: %s"), *Object->GetName());
            }

            return true;  // 계속 순회
        });
    }
}
```

---

## 💡 EDL (Event Driven Loader) - AsyncLoading2

**EDL**은 언리얼 엔진 4.25부터 도입된 이벤트 기반 비동기 로더로, 기존 AsyncLoading을 대체합니다.

### EDL vs Legacy AsyncLoading

| 특징 | Legacy AsyncLoading | EDL (AsyncLoading2) |
|------|---------------------|---------------------|
| **병렬성** | 제한적 (순차 처리) | ✅ 완전 병렬 (다중 패키지 동시 로드) |
| **의존성** | 런타임 해결 | ✅ 컴파일 타임 Preload Dependencies |
| **메모리** | 높음 (전체 로드 후 해제) | ✅ 낮음 (스트리밍) |
| **로딩 속도** | 느림 | ✅ 빠름 (2-3배) |
| **디버깅** | 어려움 | ✅ 명확한 이벤트 체인 |

### Preload Dependencies

```cpp
// 컴파일 타임에 생성되는 의존성 그래프
// Export A의 Serialize()가 Export B를 필요로 함

// 패키지 저장 시:
FObjectExport ExportA;
ExportA.SerializationBeforeSerializationDependencies = { ExportB_Index };

// 패키지 로드 시 (EDL):
// 1. ExportB를 먼저 로드
// 2. ExportB의 Serialize() 완료 대기
// 3. ExportA 로드 시작

// 이점:
// - 데드락 방지
// - 병렬 로딩 최적화
// - 로딩 순서 보장
```

---

## 🚨 일반적인 함정

### ❌ 동기 로딩 남용

```cpp
// ❌ 나쁨: Tick에서 동기 로딩
void AMyActor::Tick(float DeltaTime)
{
    // 매 프레임 수백 ms 블로킹!
    UTexture2D* Texture = LoadObject<UTexture2D>(nullptr, TEXT("/Game/Textures/BigTexture"));
}

// ✅ 좋음: BeginPlay에서 비동기 로딩
void AMyActor::BeginPlay()
{
    Super::BeginPlay();

    FSoftObjectPath TexturePath(TEXT("/Game/Textures/BigTexture"));

    UAssetManager::GetStreamableManager().RequestAsyncLoad(
        TexturePath,
        FStreamableDelegate::CreateUObject(this, &AMyActor::OnTextureLoaded)
    );
}

void AMyActor::OnTextureLoaded()
{
    // 비동기 로드 완료
}
```

### ❌ 패키지 없이 에셋 저장

```cpp
// ❌ 잘못됨: 패키지 없이 UObject 저장 시도
UStaticMesh* Mesh = NewObject<UStaticMesh>();
// Mesh->Save(...);  // 불가능! Outer가 Transient Package

// ✅ 올바름: 패키지 생성 후 저장
UPackage* Package = CreatePackage(TEXT("/Game/MyAsset"));
UStaticMesh* Mesh = NewObject<UStaticMesh>(Package, TEXT("MyMesh"), RF_Public | RF_Standalone);

// 이제 저장 가능
FSavePackageArgs SaveArgs;
UPackage::SavePackage(Package, Mesh, TEXT("C:/MyProject/Content/MyAsset.uasset"), SaveArgs);
```

### ❌ Linker를 너무 오래 유지

```cpp
// ❌ 나쁨: Linker 장기 보유
FLinkerLoad* Linker = ...;
// ... 오랜 시간 동안 Linker 사용
// 메모리 누수, 파일 핸들 점유

// ✅ 좋음: 필요한 작업 후 즉시 해제
{
    FLinkerLoad* Linker = ...;

    // 필요한 작업
    Linker->CreateExport(0);

    // 스코프 종료 시 자동 해제
}
```

---

## 🔍 디버깅 팁

### 콘솔 명령어

```bash
# 패키지 정보 덤프
obj list class=Package
obj dump PackageName

# 로딩 통계
stat streaming
stat streamingdetails

# 비동기 로딩 추적
-trace=loadtime,assetloadtime

# 패키지 의존성 출력
obj refs name=MyAsset

# Import/Export 상세 정보
-LogLinker=Verbose
```

### Unreal Insights 프로파일링

```cpp
// 로딩 이벤트 추적
TRACE_CPUPROFILER_EVENT_SCOPE(LoadPackage);

UPackage* Package = LoadPackage(nullptr, TEXT("/Game/MyAsset"), LOAD_None);

// Insights에서 "LoadPackage" 이벤트 확인
// - 로딩 시간
// - Import 해결 시간
// - Export 로드 시간
```

---

## 🔗 참고자료

- [Package Loading](https://docs.unrealengine.com/package-loading-in-unreal-engine/)
- [Async Loading](https://docs.unrealengine.com/asynchronous-asset-loading-in-unreal-engine/)
- [Asset Management](https://docs.unrealengine.com/asset-management-in-unreal-engine/)
- [Package.h Source](Engine/Source/Runtime/CoreUObject/Public/UObject/Package.h)
- [LinkerLoad.h Source](Engine/Source/Runtime/CoreUObject/Public/UObject/LinkerLoad.h)
- [LinkerSave.h Source](Engine/Source/Runtime/CoreUObject/Public/UObject/LinkerSave.h)

**연관 문서:**
- [CoreUObject/Serialization.md](./Serialization.md) - 직렬화 시스템
- [CoreUObject/AssetRegistry.md](./AssetRegistry.md) - 에셋 레지스트리
- [Core/EngineInitialization.md](../Core/EngineInitialization.md) - 엔진 초기화

---

> 📅 생성: 2025-10-20 — 패키지 및 링커 시스템 문서화 (UE 5.6.1 검증 완료)
