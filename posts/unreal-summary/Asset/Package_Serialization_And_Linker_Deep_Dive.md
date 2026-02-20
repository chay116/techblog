---
title: "Package Serialization & Linker Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "CoreUObject"
tags: ["unreal", "CoreUObject", "Asset"]
engine_version: "Unreal Engine 5.7"
---
# Package Serialization & Linker Deep Dive

## 🧭 개요 (Overview)

**Package Serialization**은 UObject를 디스크에 저장하고 로드하는 시스템이며, **Linker**는 이 직렬화를 담당하는 핵심 클래스입니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **FLinkerLoad** | .uasset/.umap 파일 로딩 담당 |
| **FLinkerSave** | .uasset/.umap 파일 저장 담당 |
| **FPackageFileSummary** | 패키지 파일 헤더 (TOC - Table Of Contents) |
| **FObjectExport** | 패키지 내부 UObject 정보 |
| **FObjectImport** | 외부 패키지 참조 정보 |
| **Async Loading** | 비동기 패키지 로딩 |

**핵심 철학:**
> Header에 모든 메타데이터,
> Export에 실제 UObject 데이터,
> Lazy Loading으로 빠른 시작

---

## 🏗️ .uasset 파일 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        .uasset File Layout                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  FPackageFileSummary (Header)                                   │   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │  Tag: 0x9E2A83C1 (PACKAGE_FILE_TAG)                        │ │   │
│  │  │  FileVersionUE: 5.7                                        │ │   │
│  │  │  PackageFlags: PKG_ContainsMap | PKG_Cooked               │ │   │
│  │  │  TotalHeaderSize: 4096 bytes                               │ │   │
│  │  │  NameCount: 150, NameOffset: 0x100                         │ │   │
│  │  │  ExportCount: 50, ExportOffset: 0x800                      │ │   │
│  │  │  ImportCount: 30, ImportOffset: 0x600                      │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                           ↓                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Name Table (NameOffset = 0x100)                                │   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │  Index 0: "None"                                           │ │   │
│  │  │  Index 1: "MyMap"                                          │ │   │
│  │  │  Index 2: "PersistentLevel"                                │ │   │
│  │  │  Index 3: "StaticMeshComponent"                            │ │   │
│  │  │  ...                                                        │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                           ↓                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Import Table (ImportOffset = 0x600)                            │   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │  FObjectImport[0]:                                         │ │   │
│  │  │    ClassPackage: "/Script/CoreUObject"                     │ │   │
│  │  │    ClassName: "Package"                                    │ │   │
│  │  │    ObjectName: "/Script/Engine"                            │ │   │
│  │  │  FObjectImport[1]:                                         │ │   │
│  │  │    ClassPackage: "/Script/CoreUObject"                     │ │   │
│  │  │    ClassName: "Class"                                      │ │   │
│  │  │    ObjectName: "StaticMeshComponent"                       │ │   │
│  │  │    OuterIndex: Import[0] (Engine Package)                  │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                           ↓                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Export Table (ExportOffset = 0x800)                            │   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │  FObjectExport[0]: (PersistentLevel)                       │ │   │
│  │  │    ClassIndex: Import[2] (Level)                           │ │   │
│  │  │    ObjectName: "PersistentLevel"                           │ │   │
│  │  │    SerialSize: 2048 bytes                                  │ │   │
│  │  │    SerialOffset: 0x2000                                    │ │   │
│  │  │  FObjectExport[1]: (StaticMeshActor)                       │ │   │
│  │  │    ClassIndex: Import[5] (StaticMeshActor)                 │ │   │
│  │  │    ObjectName: "StaticMeshActor_0"                         │ │   │
│  │  │    SerialSize: 512 bytes                                   │ │   │
│  │  │    SerialOffset: 0x2800                                    │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                           ↓                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Export Data (SerialOffset)                                     │   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │  @0x2000: PersistentLevel UObject Data (2048 bytes)        │ │   │
│  │  │    - Properties (UPROPERTY)                                │ │   │
│  │  │    - Actors TArray                                         │ │   │
│  │  │    - NavMeshBounds                                         │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │  @0x2800: StaticMeshActor_0 UObject Data (512 bytes)       │ │   │
│  │  │    - Location: FVector(100, 200, 300)                      │ │   │
│  │  │    - Rotation: FRotator(0, 90, 0)                          │ │   │
│  │  │    - StaticMesh: Import Reference                          │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                           ↓                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Bulk Data (.ubulk, .uexp - 선택적)                             │   │
│  │  - Texture Mip Data                                             │   │
│  │  - Audio Sample Data                                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📐 계층별 상세 분석

### 1. **FPackageFileSummary - 패키지 헤더**

**📂 위치:** `CoreUObject/Public/UObject/PackageFileSummary.h:56`

**역할:** 패키지의 메타데이터 및 오프셋 정보

**핵심 구조:**

```cpp
struct FPackageFileSummary
{
    // 매직 넘버
    int32 Tag;  // 0x9E2A83C1 (PACKAGE_FILE_TAG)

    // 버전 정보
    FPackageFileVersion FileVersionUE;          // 5.7
    int32 FileVersionLicenseeUE;                // Licensee 버전
    FCustomVersionContainer CustomVersionContainer;  // 커스텀 버전

    // 패키지 플래그
    uint32 PackageFlags;
    // PKG_ContainsMap, PKG_Cooked, PKG_FilterEditorOnly 등

    // 헤더 크기
    int32 TotalHeaderSize;  // NameTable + ImportMap + ExportMap까지

    // Name Table
    int32 NameCount;        // 150
    int32 NameOffset;       // 0x100

    // Import Table
    int32 ImportCount;      // 30
    int32 ImportOffset;     // 0x600

    // Export Table
    int32 ExportCount;      // 50
    int32 ExportOffset;     // 0x800

    // Soft Object Paths
    int32 SoftObjectPathsCount;
    int32 SoftObjectPathsOffset;

    // Dependencies
    int32 DependsOffset;
    int32 SoftPackageReferencesCount;
    int32 SoftPackageReferencesOffset;

    // Preload Dependencies
    int32 PreloadDependencyCount;
    int32 PreloadDependencyOffset;

    // Asset Registry Data
    int32 AssetRegistryDataOffset;

    // Bulk Data
    int64 BulkDataStartOffset;

    // 버전 정보
    FEngineVersion SavedByEngineVersion;
    FEngineVersion CompatibleWithEngineVersion;

    // Compression
    uint32 CompressionFlags;

    // Unversioned (Cooked)
    bool bUnversioned;  // true면 버전 없이 저장 (Cooked 빌드)

    // Chunk IDs (스트리밍)
    TArray<int32> ChunkIDs;
};
```

**파일 직렬화:**

```cpp
void FPackageFileSummary::Serialize(FArchive& Ar)
{
    Ar << Tag;  // 0x9E2A83C1 확인

    // 버전 정보
    Ar << FileVersionUE;
    Ar << FileVersionLicenseeUE;
    Ar << CustomVersionContainer;

    // 메타데이터
    Ar << TotalHeaderSize;
    Ar << PackageName;

    // Name Table
    Ar << NameCount;
    Ar << NameOffset;

    // Export/Import
    Ar << ExportCount;
    Ar << ExportOffset;
    Ar << ImportCount;
    Ar << ImportOffset;

    // ... 나머지 필드들
}
```

---

### 2. **FLinkerLoad - 패키지 로딩**

**📂 위치:** `CoreUObject/Public/UObject/LinkerLoad.h:119`

**역할:** .uasset/.umap 파일을 메모리로 로드

**핵심 구조:**

```cpp
class FLinkerLoad : public FLinker, public FArchiveUObject
{
public:
    // Loader (실제 파일 읽기)
    FArchive* Loader;  // FAsyncArchive 또는 FArchiveFileReaderGeneric

    // 패키지 경로
    FPackagePath PackagePath;  // "/Game/MyMap"

    // Name/Import/Export Maps
    TArray<FName> NameMap;
    TArray<FObjectImport> ImportMap;
    TArray<FObjectExport> ExportMap;

    // Export Hash (빠른 검색)
    static constexpr int32 ExportHashCount = 256;
    TUniquePtr<int32[]> ExportHash;

    // Preload Dependencies
    TArray<FPackageIndex> PreloadDependencies;

    // Async Loading
    void* AsyncRoot;  // FAsyncPackage*

    // 로딩 상태
    uint32 LoadFlags;
    bool bHaveImportsBeenVerified;

    // 멀티스레드 보호
    UE::FRecursiveMutex Mutex;
};
```

**로딩 프로세스:**

```
LoadPackage("/Game/MyMap")
   │
   ├─→ 1. FLinkerLoad::CreateLinker()
   │      - Open .uasset file
   │      - Read FPackageFileSummary
   │
   ├─→ 2. LoadPackageHeader()
   │      - Seek to NameOffset → Load NameMap
   │      - Seek to ImportOffset → Load ImportMap
   │      - Seek to ExportOffset → Load ExportMap
   │
   ├─→ 3. VerifyImports()
   │      - 모든 Import 해결 (외부 패키지 로드)
   │      - Class redirector 처리
   │
   ├─→ 4. CreateExport(ExportIndex)
   │      - UObject::StaticAllocateObject()
   │      - ExportMap[ExportIndex] → UObject*
   │
   ├─→ 5. SerializeExport(ExportIndex)
   │      - Seek to ExportMap[ExportIndex].SerialOffset
   │      - UObject::Serialize(Ar)
   │      - UPROPERTY() 직렬화
   │
   └─→ 6. PostLoad()
          - UObject::PostLoad() 호출
          - 최종 초기화
```

**FObjectExport 구조:**

```cpp
struct FObjectExport : public FObjectResource
{
    FPackageIndex ClassIndex;       // Import 또는 Export Index (Class)
    FPackageIndex SuperIndex;       // 부모 클래스
    FPackageIndex TemplateIndex;    // CDO Template

    FPackageIndex OuterIndex;       // Outer UObject (Owner)
    FName ObjectName;               // "PersistentLevel"

    uint32 ObjectFlags;             // RF_Public, RF_Transient 등

    int64 SerialSize;               // UObject 직렬화 크기 (bytes)
    int64 SerialOffset;             // 파일 내 오프셋

    bool bForcedExport;             // 강제 Export 여부
    bool bNotForClient;             // 클라이언트 제외
    bool bNotForServer;             // 서버 제외

    FGuid PackageGuid;              // Export GUID
    uint32 PackageFlags;            // RF_WasLoaded 등

    int32 FirstExportDependency;    // Preload 의존성 시작 인덱스
    int32 SerializationBeforeSerializationDependencies;
    int32 CreateBeforeSerializationDependencies;
    int32 SerializationBeforeCreateDependencies;
    int32 CreateBeforeCreateDependencies;
};
```

**FObjectImport 구조:**

```cpp
struct FObjectImport : public FObjectResource
{
    FName ClassPackage;             // "/Script/Engine"
    FName ClassName;                // "StaticMeshComponent"

    FPackageIndex OuterIndex;       // Outer Import/Export
    FName ObjectName;               // "StaticMeshComponent"

    FPackageIndex XObject;          // 해결된 실제 UObject* (로드 후)
    int32 SourceLineNumber;         // 디버깅용
    FName SourceFileName;
};
```

---

### 3. **FLinkerSave - 패키지 저장**

**📂 위치:** `CoreUObject/Public/UObject/LinkerSave.h:47`

**역할:** UObject를 .uasset/.umap 파일로 저장

**핵심 구조:**

```cpp
class FLinkerSave : public FLinker, public FArchiveUObject
{
public:
    // Saver (실제 파일 쓰기)
    FArchive* Saver;  // FArchiveFileWriterGeneric 또는 FMemoryWriter

    // Object → PackageIndex 매핑
    TMap<TObjectPtr<UObject>, FPackageIndex> ObjectIndicesMap;

    // Name → Index 매핑
    TMap<FNameEntryId, int32> NameIndices;

    // SoftObjectPath → Index 매핑
    TMap<FSoftObjectPath, int32> SoftObjectPathIndices;

    // Searchable Names
    TMap<const UObject*, TArray<FName>> SearchableNamesObjectMap;

    // Package Trailer (Bulk Data, Payloads)
    TUniquePtr<UE::FPackageTrailerBuilder> PackageTrailerBuilder;

    // Additional Data (Bulk Data Callbacks)
    TArray<AdditionalDataCallback> AdditionalDataToAppend;

    // Post Save Callbacks
    TArray<TUniqueFunction<void(...)>> PostSaveCallbacks;

    // 플래그
    bool bProceduralSave;           // Cooking 등
    bool bUpdatingLoadedPath;       // Editor Save
    bool bRehydratePayloads;        // Virtualized 복원
};
```

**저장 프로세스:**

```
SavePackage(Package, "/Game/MyMap")
   │
   ├─→ 1. FLinkerSave::Create()
   │      - Open .uasset file for writing
   │      - Initialize ObjectIndicesMap
   │
   ├─→ 2. TagExports()
   │      - 모든 Export 수집 (재귀적)
   │      - ObjectIndicesMap 생성
   │
   ├─→ 3. GatherImports()
   │      - 모든 Import 수집
   │      - 외부 참조 추적
   │
   ├─→ 4. BuildNameMap()
   │      - 모든 FName 수집
   │      - NameIndices 생성
   │
   ├─→ 5. WriteSummary() (Placeholder)
   │      - FPackageFileSummary 임시 작성
   │      - 실제 오프셋은 나중에 업데이트
   │
   ├─→ 6. WriteNameTable()
   │      - NameOffset = Tell()
   │      - 모든 FName 직렬화
   │
   ├─→ 7. WriteImportTable()
   │      - ImportOffset = Tell()
   │      - 모든 FObjectImport 직렬화
   │
   ├─→ 8. WriteExportTable()
   │      - ExportOffset = Tell()
   │      - 모든 FObjectExport 직렬화 (SerialOffset은 임시)
   │
   ├─→ 9. WriteExportData()
   │      - 각 Export의 SerialOffset = Tell()
   │      - UObject::Serialize(Ar)
   │      - UPROPERTY() 직렬화
   │
   ├─→ 10. UpdateSummary()
   │       - Seek(0)
   │       - FPackageFileSummary 재작성 (정확한 오프셋)
   │
   └─→ 11. WriteBulkData()
           - .ubulk 파일 생성 (필요시)
           - Bulk Data 직렬화
```

---

### 4. **Async Loading - 비동기 로딩**

**📂 위치:** `CoreUObject/Private/Serialization/AsyncLoading*.cpp`

**역할:** 게임 플레이 중 패키지 비동기 로드

**핵심 구조:**

```cpp
struct FAsyncPackage2
{
    // 패키지 정보
    FName PackageName;
    FLinkerLoad* Linker;

    // 로딩 상태
    EAsyncPackageLoadingState2 LoadingState;
    // - None
    // - WaitingForSummary
    // - ProcessSummary
    // - WaitingForHeader
    // - ProcessHeader
    // - WaitingForExports
    // - ProcessExports
    // - Complete

    // Import Dependencies
    TArray<FAsyncPackage2*> ImportedAsyncPackages;

    // Export 처리
    TArray<FExportObject> Exports;
    int32 ProcessedExportsCount;

    // Time Limit (프레임 드롭 방지)
    double TimeLimit;
};
```

**비동기 로딩 흐름:**

```
LoadPackageAsync("/Game/MyMap")
   │
   ├─→ Tick 1: ProcessSummary
   │      - Read FPackageFileSummary (작은 데이터)
   │      - 2ms 제한
   │
   ├─→ Tick 2: ProcessHeader
   │      - Read NameMap, ImportMap, ExportMap
   │      - 5ms 제한
   │
   ├─→ Tick 3-5: ProcessExports (점진적)
   │      - CreateExport() 10개씩
   │      - SerializeExport() 5개씩
   │      - 10ms 제한 (매 틱)
   │
   └─→ Tick 6: PostLoad
          - 모든 UObject::PostLoad()
          - 완료 콜백 호출
```

**Time Slicing:**

```cpp
void FAsyncLoadingThread2::ProcessAsyncLoading()
{
    double StartTime = FPlatformTime::Seconds();
    double TimeLimit = 0.005;  // 5ms

    while (!IsAsyncLoadingSuspended())
    {
        FAsyncPackage2* Package = GetNextPackageToProcess();
        if (!Package)
            break;

        Package->ProcessExports(TimeLimit);

        double CurrentTime = FPlatformTime::Seconds();
        if (CurrentTime - StartTime > TimeLimit)
        {
            break;  // 시간 초과 - 다음 프레임으로
        }
    }
}
```

---

## 🧪 실전 예시

### 예시 1: 패키지 저장

```cpp
// SavePackage 호출
FString PackageFileName = FPackageName::LongPackageNameToFilename(
    "/Game/MyMap",
    FPackageName::GetMapPackageExtension()
);

FSavePackageArgs SaveArgs;
SaveArgs.TopLevelFlags = RF_Public | RF_Standalone;
SaveArgs.SaveFlags = SAVE_NoError;

UPackage::SavePackage(
    Package,
    nullptr,  // Asset
    *PackageFileName,
    SaveArgs
);

// 내부 흐름:
// 1. FLinkerSave 생성
// 2. TagExports() - 모든 Export 수집
// 3. GatherImports() - 외부 참조 수집
// 4. WriteSummary() + WriteNameTable() + WriteImportTable() + WriteExportTable()
// 5. WriteExportData() - UObject 직렬화
// 6. UpdateSummary() - 오프셋 업데이트
```

### 예시 2: 패키지 로딩

```cpp
// Synchronous Load
UPackage* Package = LoadPackage(nullptr, TEXT("/Game/MyMap"), LOAD_None);

// Asynchronous Load
FStreamableManager& StreamableManager = UAssetManager::GetStreamableManager();
TSharedPtr<FStreamableHandle> Handle = StreamableManager.RequestAsyncLoad(
    FSoftObjectPath("/Game/MyMap.MyMap"),
    FStreamableDelegate::CreateLambda([]() {
        UE_LOG(LogTemp, Log, TEXT("MyMap Loaded!"));
    })
);

// 내부 흐름:
// 1. FLinkerLoad 생성
// 2. LoadPackageHeader() - Summary + NameMap + ImportMap + ExportMap
// 3. VerifyImports() - 외부 패키지 로드
// 4. CreateExport() - UObject 인스턴스 생성
// 5. SerializeExport() - UPROPERTY() 로드
// 6. PostLoad() - 초기화
```

### 예시 3: Export/Import 추적

```cpp
// Export 찾기
UObject* FindExport(FLinkerLoad* Linker, const TCHAR* Name)
{
    for (int32 i = 0; i < Linker->ExportMap.Num(); ++i)
    {
        FObjectExport& Export = Linker->ExportMap[i];
        if (Export.ObjectName == Name)
        {
            return Linker->CreateExport(i);
        }
    }
    return nullptr;
}

// Import 해결
UObject* ResolveImport(FLinkerLoad* Linker, int32 ImportIndex)
{
    FObjectImport& Import = Linker->ImportMap[ImportIndex];

    // 외부 패키지 로드
    UPackage* Package = LoadPackage(nullptr, *Import.ClassPackage.ToString(), LOAD_None);

    // Class 찾기
    UClass* Class = FindObject<UClass>(Package, *Import.ClassName.ToString());

    return Class;
}
```

---

## ⚙️ 설정 및 최적화

### Cooking 설정

**DefaultEngine.ini:**

```ini
[Core.System]
; Unversioned 저장 (버전 정보 제거)
; → 파일 크기 감소, 빠른 로딩
Pak.bUnversioned=True

; Compression
CompressionFormats=Oodle
; Oodle, Zlib, Gzip

[/Script/UnrealEd.ProjectPackagingSettings]
; Chunk 설정 (스트리밍)
bGenerateChunks=True
ChunkIdPakFilesPerChunk=True
```

### 비동기 로딩 최적화

**TimeLimit 조정:**

```cpp
// DefaultEngine.ini
[/Script/Engine.StreamingSettings]
; 프레임당 로딩 시간 (ms)
AsyncLoadingTimeLimit=5.0  // 5ms (기본값)

; Priority
AsyncLoadingPriority=0  // Normal
// -1: Low, 0: Normal, 1: High
```

**Preload Dependencies:**

```cpp
// 자주 사용되는 애셋 미리 로드
void PreloadCommonAssets()
{
    TArray<FSoftObjectPath> AssetsToLoad;
    AssetsToLoad.Add(FSoftObjectPath("/Game/Materials/M_Common.M_Common"));
    AssetsToLoad.Add(FSoftObjectPath("/Game/Textures/T_UI.T_UI"));

    FStreamableManager& Manager = UAssetManager::GetStreamableManager();
    Manager.RequestAsyncLoad(AssetsToLoad, []() {
        UE_LOG(LogTemp, Log, TEXT("Common Assets Preloaded"));
    });
}
```

---

## 🐛 디버깅

### 콘솔 명령어

```
# Linker 정보 확인
obj list class=LinkerLoad

# 패키지 의존성
obj refs name=/Game/MyMap

# Async Loading 상태
stat streaming

# 로딩 중인 패키지
AsyncLoadingThread.DumpPackageStates
```

### 일반적인 함정

**❌ PostLoad에서 Async Loading:**

```cpp
// 위험 - PostLoad에서 동기 로드!
void UMyActor::PostLoad()
{
    Super::PostLoad();

    // ❌ 데드락 가능!
    UTexture2D* Texture = LoadObject<UTexture2D>(nullptr, TEXT("/Game/Textures/T_MyTexture"));
}

// ✅ Async Load 사용
void UMyActor::PostLoad()
{
    Super::PostLoad();

    FStreamableManager& Manager = UAssetManager::GetStreamableManager();
    Manager.RequestAsyncLoad(
        FSoftObjectPath("/Game/Textures/T_MyTexture"),
        [this]() {
            MyTexture = Cast<UTexture2D>(
                StaticLoadObject(UTexture2D::StaticClass(), nullptr, TEXT("/Game/Textures/T_MyTexture"))
            );
        }
    );
}
```

**❌ Circular Dependency:**

```cpp
// Package A → Import Package B
// Package B → Import Package A
// → 로딩 실패!

// ✅ Soft Object Path 사용
UPROPERTY()
TSoftObjectPtr<UTexture2D> MyTexture;  // Hard Reference 대신
```

---

## 📊 성능 특성

### 파일 크기

| 요소 | 크기 (예시) |
|------|------------|
| FPackageFileSummary | ~500 bytes |
| Name Table (150 names) | ~2 KB |
| Import Table (30 imports) | ~1.5 KB |
| Export Table (50 exports) | ~3 KB |
| Export Data (UObjects) | ~50 KB |
| **Total Header** | **~7 KB** |
| **Total File** | **~57 KB** |

### 로딩 시간 (HDD vs SSD)

| 작업 | HDD | SSD | NVMe |
|------|-----|-----|------|
| Open File | ~10 ms | ~1 ms | ~0.5 ms |
| Read Summary | ~5 ms | ~0.5 ms | ~0.1 ms |
| Read Header | ~20 ms | ~2 ms | ~0.5 ms |
| Read Exports | ~100 ms | ~10 ms | ~2 ms |
| **Total** | **~135 ms** | **~13.5 ms** | **~3.1 ms** |

---

## 🔗 참고 자료

**소스 파일:**
- `CoreUObject/Public/UObject/LinkerLoad.h` - 패키지 로딩
- `CoreUObject/Public/UObject/LinkerSave.h` - 패키지 저장
- `CoreUObject/Public/UObject/PackageFileSummary.h` - 파일 헤더
- `CoreUObject/Public/UObject/ObjectResource.h` - FObjectExport/Import
- `CoreUObject/Private/Serialization/AsyncLoading2.cpp` - 비동기 로딩

**관련 문서:**
- [Unreal Package File Format](https://docs.unrealengine.com/5.7/en-US/unreal-package-file-format/)
- [Asynchronous Asset Loading](https://docs.unrealengine.com/5.7/en-US/asynchronous-asset-loading/)

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Package Serialization & Linker Deep Dive
  - .uasset 파일 구조 (Summary/NameTable/Import/Export)
  - FLinkerLoad (로딩 프로세스)
  - FLinkerSave (저장 프로세스)
  - FAsyncPackage2 (비동기 로딩)
  - Time Slicing & 성능 최적화
  - 실전 예시 및 디버깅