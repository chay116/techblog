---
title: "IOStore (I/O Store)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Core"
tags: ["unreal", "Core"]
---
# IOStore (I/O Store)

## 🧭 개요

**IOStore**는 언리얼 엔진 4.25부터 도입된 **차세대 파일 패키징 및 I/O 시스템**입니다. 기존 PAK 시스템을 개선하며, **훨씬 빠른 로딩 속도와 효율적인 메모리 사용**을 제공합니다.

**핵심 철학:**
> **IOStore**는 "컨테이너 기반 스토리지" (TOC + Data 파일),
> **IoDispatcher**는 "비동기 I/O 디스패처" (우선순위 큐),
> **SyncLoader2**는 "차세대 로더" (의존성 사전 분석),
> **IoChunk**는 "최소 읽기 단위" (압축 블록)를 담당한다.

**주요 특징:**
- **TOC (Table of Contents)** - 청크 메타데이터의 빠른 인덱싱
- **Perfect Hash** - O(1) 청크 검색 (해시 충돌 없음)
- **압축 블록** - 청크를 64KB 블록으로 분할하여 부분 로딩
- **비동기 I/O** - 우선순위 기반 비동기 읽기
- **메모리 맵핑** - 대용량 파일을 가상 메모리로 매핑
- **암호화 지원** - AES 암호화 지원
- **온디맨드 스트리밍** - 필요한 데이터만 다운로드 (클라우드 게임)
- **SyncLoader2** - 의존성 사전 분석으로 런타임 오버헤드 감소

**버전 히스토리:**
- **UE 4.25**: Experimental (실험적 기능)
- **UE 4.26**: Beta (일부 기능 제한)
- **UE 5.0+**: 공식 지원 (기본 활성화)

**📂 위치:**
- `Engine/Source/Runtime/Core/Internal/IO/IoStore.h` - TOC 구조
- `Engine/Source/Runtime/Core/Public/IO/IoDispatcher.h` - I/O 디스패처
- `Engine/Source/Runtime/Core/Public/IO/IoChunkId.h` - 청크 식별자
- `Engine/Source/Runtime/Experimental/IoStore/OnDemand/` - 온디맨드 스트리밍

**엔진 버전:** Unreal Engine 5.7

---

## 🧱 IOStore vs PAK 비교

### 기존 PAK 시스템의 문제점

**PAK (Package) 시스템 (UE4 초기):**
```
game.pak (단일 거대 파일)
├─ 인덱스 (파일 이름 → 오프셋 매핑)
└─ 데이터 (순차적 배치)
```

**문제점:**
```cpp
// PAK: 파일 이름으로 검색 (느림)
FString AssetPath = "/Game/Characters/Hero/Mesh.uasset";
int64 Offset = PakFile->FindFile(AssetPath);  // 문자열 해시 + 검색
void* Data = PakFile->Read(Offset, Size);

// 문제 1: 문자열 검색 오버헤드 (100-500ns)
// 문제 2: 압축된 전체 파일을 한번에 읽어야 함
// 문제 3: 파일 단위 압축 → 큰 파일은 비효율적
// 문제 4: 부분 로딩 불가능
```

---

### IOStore의 해결책

**IOStore 시스템 (UE 4.25+):**
```
game.utoc (Table of Contents - 메타데이터)
game.ucas (Container - 실제 데이터)
game.pak  (엔진 파일, 셰이더 등 - 크기 축소)
```

**구조:**

```
┌────────────────────────────────────────────────────────────────────────┐
│                            IOStore 아키텍처                             │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  [1] .pak 파일 (기존보다 작아짐)                                        │
│      ┌─────────────────────────────────────────────────────────────┐  │
│      │ 역할 축소:                                                   │  │
│      │ ├─ 엔진 파일 (.dll, .exe 등)                                │  │
│      │ ├─ 셰이더 바이너리 코드 (.ushaderbytecode)                  │  │
│      │ ├─ 프로젝트 설정 파일 (.ini)                                │  │
│      │ └─ 콘텐츠 외 접근 빈도가 낮은 파일들                         │  │
│      │                                                             │  │
│      │ 크기: 5GB → 500MB (10분의 1로 감소)                         │  │
│      └─────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  [2] .ucas 파일 (IOStore Container - 실제 에셋 데이터)                 │
│      ┌─────────────────────────────────────────────────────────────┐  │
│      │ .uasset 파일 (게임 에셋)                                    │  │
│      │ ├─ Texture2D                                                │  │
│      │ ├─ StaticMesh                                               │  │
│      │ ├─ SkeletalMesh                                             │  │
│      │ ├─ Animation                                                │  │
│      │ └─ Material                                                 │  │
│      │                                                             │  │
│      │ .umap 파일 (레벨 맵)                                         │  │
│      │ ├─ Level_Main.umap                                          │  │
│      │ └─ SubLevel_*.umap                                          │  │
│      │                                                             │  │
│      │ 데이터 배치 최적화:                                          │  │
│      │ ├─ 16바이트 얼라인먼트 (SIMD 최적화)                        │  │
│      │ ├─ 시크 순서 고려 배치 (로드 순서대로 배치)                  │  │
│      │ └─ 파티셔닝 (1GB 단위 분할)                                 │  │
│      │    ├─ game_0_P.ucas (Partition 0 - 1GB)                    │  │
│      │    ├─ game_1_P.ucas (Partition 1 - 1GB)                    │  │
│      │    └─ game_2_P.ucas (Partition 2 - 1GB)                    │  │
│      └─────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  [3] .utoc 파일 (Table of Contents - 목차)                             │
│      ┌─────────────────────────────────────────────────────────────┐  │
│      │ FIoStoreTocHeader                                           │  │
│      │ ─────────────────                                           │  │
│      │ • ContainerId: FGuid                                        │  │
│      │ • TocEntryCount: 10,000개 청크                              │  │
│      │ • CompressionBlockSize: 64KB                                │  │
│      │ • PartitionCount: 3개 파티션                                │  │
│      │ • PartitionSize: 1GB                                        │  │
│      │                                                             │  │
│      │ TArray<FIoChunkId> ChunkIds                                 │  │
│      │ ─────────────────────────                                   │  │
│      │ [0] → ChunkId: 0x1234ABCD (Texture)                        │  │
│      │ [1] → ChunkId: 0x5678EFGH (Mesh)                           │  │
│      │ [2] → ChunkId: 0x9ABCIJKL (Audio)                          │  │
│      │                                                             │  │
│      │ TArray<FIoOffsetAndLength> ChunkOffsetLengths               │  │
│      │ ───────────────────────────────────────                     │  │
│      │ [0] → Offset: 0MB, Length: 2MB (압축 후)                   │  │
│      │ [1] → Offset: 2MB, Length: 5MB (압축 후)                   │  │
│      │ [2] → Offset: 7MB, Length: 1MB (압축 후)                   │  │
│      │                                                             │  │
│      │ TArray<int32> ChunkPerfectHashSeeds                         │  │
│      │ ──────────────────────────────                              │  │
│      │ Perfect Hash 시드 (O(1) 검색)                               │  │
│      │                                                             │  │
│      │ TArray<FIoStoreTocCompressedBlockEntry> CompressionBlocks   │  │
│      │ ──────────────────────────────────────────────              │  │
│      │ 각 청크를 64KB 블록으로 분할                                 │  │
│      │ ├─ Block 0: Offset=0KB,   Compressed=48KB                  │  │
│      │ ├─ Block 1: Offset=48KB,  Compressed=52KB                  │  │
│      │ └─ Block 2: Offset=100KB, Compressed=45KB                  │  │
│      └─────────────────────────────────────────────────────────────┘  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

**핵심 변화:**
- **.pak 역할 축소**: 게임 에셋이 제외되어 크기가 10분의 1로 감소
- **.ucas 에셋 전담**: 모든 게임 에셋이 최적화된 배치로 저장
- **.utoc 인덱싱**: Perfect Hash로 O(1) 청크 검색

---

## 📋 핵심 구조 설명

### 1. **FIoStoreTocHeader - TOC 헤더**

**📂 위치:** `IoStore.h:43-80`

```cpp
struct FIoStoreTocHeader
{
    static constexpr inline char TocMagicImg[] = "-==--==--==--==-";

    uint8  TocMagic[16];                       // 매직 넘버 (파일 검증)
    uint8  Version;                            // TOC 버전
    uint32 TocHeaderSize;                      // 헤더 크기
    uint32 TocEntryCount;                      // 총 청크 개수
    uint32 TocCompressedBlockEntryCount;       // 압축 블록 개수
    uint32 CompressionMethodNameCount;         // 압축 방법 개수
    uint32 CompressionBlockSize;               // 압축 블록 크기 (보통 64KB)
    uint32 PartitionCount;                     // 파티션 개수
    uint64 PartitionSize;                      // 파티션 크기 (기본 1GB)
    FIoContainerId ContainerId;                // 컨테이너 ID (GUID)
    FGuid EncryptionKeyGuid;                   // 암호화 키 GUID
    EIoContainerFlags ContainerFlags;          // 컨테이너 플래그
    uint32 TocChunkPerfectHashSeedsCount;      // Perfect Hash 시드 개수
};
```

**역할:**
- 컨테이너 메타데이터 저장
- 버전 관리 및 호환성 체크
- Perfect Hash 시드 정보

---

### 2. **FIoChunkId - 청크 식별자**

**청크 ID 구조:**
```cpp
struct FIoChunkId
{
    uint64 ChunkId;  // 12바이트 ID
    uint8  ChunkType;
    uint8  Reserved[3];
};
```

**청크 타입:**
```cpp
enum class EIoChunkType : uint8
{
    Invalid = 0,
    ExportBundleData,        // 에셋 데이터
    BulkData,                // 대용량 데이터 (텍스처, 오디오)
    OptionalBulkData,        // 선택적 데이터
    MemoryMappedBulkData,    // 메모리 맵핑 데이터
    ScriptObjects,           // Blueprint 스크립트
    ContainerHeader,         // 컨테이너 헤더
    ExternalFile,            // 외부 파일 참조
    ShaderCodeLibrary,       // 셰이더 코드
    ShaderCode,              // 개별 셰이더
    PackageStoreEntry,       // 패키지 엔트리
    PackageData,             // 패키지 데이터
};
```

**Perfect Hash를 이용한 O(1) 검색:**
```cpp
// IoStore.h:309
uint64 HashChunkIdWithSeed(int32 Seed, const FIoChunkId& ChunkId)
{
    // Perfect Hash: 시드를 사용하여 해시 충돌 없이 매핑
    uint64 Hash = ChunkId.ChunkId ^ Seed;
    return Hash % TocEntryCount;
}

// 사용 예시
int32 Seed = ChunkPerfectHashSeeds[0];
int32 TocIndex = HashChunkIdWithSeed(Seed, ChunkId);
FIoOffsetAndLength& Location = ChunkOffsetLengths[TocIndex];

// PAK: 문자열 해시 (100-500ns, 충돌 가능)
// IOStore: Perfect Hash (10-20ns, 충돌 없음)
// → 10-50배 빠름! 🚀
```

---

### 3. **FIoStoreTocCompressedBlockEntry - 압축 블록**

**📂 위치:** `IoStore.h:105-164`

```cpp
struct FIoStoreTocCompressedBlockEntry
{
    // 비트 필드를 사용하여 공간 절약
    // 총 12바이트: 5 (Offset) + 3 (CompressedSize) + 3 (UncompressedSize) + 1 (CompressionMethod)

    static constexpr uint32 OffsetBits = 40;    // 1TB 지원
    static constexpr uint32 SizeBits = 24;      // 16MB 블록 지원

    uint64 GetOffset() const;                    // 컨테이너 내 오프셋
    uint32 GetCompressedSize() const;            // 압축 후 크기
    uint32 GetUncompressedSize() const;          // 압축 전 크기 (보통 64KB)
    uint8  GetCompressionMethodIndex() const;    // 압축 방법 (0=None, 1=Zlib, 2=Oodle, ...)

private:
    uint8 Data[12];
};
```

**압축 블록 레이아웃:**
```
청크 (2MB 텍스처):
┌──────────────────────────────────────────────────────────────┐
│  Chunk (UncompressedSize = 2MB)                              │
│  ├─ Compressed Block 0: Offset=0KB,   Compressed=48KB       │
│  ├─ Compressed Block 1: Offset=48KB,  Compressed=52KB       │
│  ├─ Compressed Block 2: Offset=100KB, Compressed=45KB       │
│  └─ ... (총 32개 블록)                                       │
└──────────────────────────────────────────────────────────────┘

장점:
- 부분 로딩 가능 (필요한 블록만 압축 해제)
- 스트리밍 친화적 (순차 읽기)
- 메모리 효율 (64KB씩 압축 해제)

메모리 비교:
PAK:     2MB 압축 + 2MB 압축 해제 = 4MB 메모리
IOStore: 64KB 압축 + 64KB 압축 해제 = 128KB 메모리
→ 30배 적은 메모리 사용! 💾
```

---

## 🔄 새로운 로더 시스템: SyncLoader2

### AsyncLoader (UE4 초기) vs SyncLoader2 (UE 4.25+)

**기존 AsyncLoader:**
```
Game Thread
    ↓ 로드 요청
Async Loading Thread
    ↓ 런타임 의존성 분석 (느림!)
Pool Thread
    ↓ PAK 파일 읽기
디스크 I/O
```

**새로운 SyncLoader2 (ZeroLoader):**
```
Game Thread
    ↓ 로드 요청
Async Loading Thread 2 (개선됨)
    ↓ 의존성 사전 분석 (패키징 시점)
IO Dispatcher (신규)
    ↓ 메모리 블록 정보 구축
IO Service (신규)
    ↓ 컨테이너(.ucas) 직접 읽기
디스크 I/O
```

---

### SyncLoader2 상세 아키텍처

```
┌────────────────────────────────────────────────────────────────────────┐
│                     SyncLoader2 로드 흐름                               │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  [1] Game Thread                                                       │
│      └─ LoadPackage("/Game/Characters/Hero") 요청                     │
│          ↓                                                             │
│                                                                        │
│  [2] Async Loading Thread 2 (개선된 로더)                              │
│      ├─ 큐잉 (대기)                                                    │
│      ├─ 의존성 분석 (패키징 시점에 완료됨 → 빠름!)                      │
│      └─ IO Dispatcher 전달                                            │
│          ↓                                                             │
│                                                                        │
│  [3] IO Dispatcher (신규 - IOStore 전용)                               │
│      ├─ .utoc 파일에서 청크 정보 조회                                  │
│      │   └─ Perfect Hash(ChunkId) → TocIndex                          │
│      │       └─ ChunkOffsetLengths[TocIndex]                          │
│      │           └─ Offset: 2MB, Length: 5MB                          │
│      │                                                                 │
│      ├─ 메모리 블록 정보 구축                                          │
│      │   └─ CompressionBlocks 리스트                                  │
│      │       ├─ Block 0: Offset=2MB,   Compressed=48KB                │
│      │       ├─ Block 1: Offset=2.05MB, Compressed=52KB               │
│      │       └─ ...                                                   │
│      │                                                                 │
│      └─ IO Service 요청                                               │
│          ↓                                                             │
│                                                                        │
│  [4] IO Service (신규 - 파일 I/O 전담) ⚠️ 병목 지점 1                  │
│      ├─ .ucas 파일 열기                                               │
│      ├─ 파일 시크 (Seek) → Offset=2MB                                 │
│      ├─ 파일 읽기 (Read) → 48KB 읽기                                  │
│      ├─ 압축 해제 (Oodle/Zlib) → 64KB 데이터                          │
│      └─ 완료 콜백 → IO Dispatcher                                     │
│          ↓                                                             │
│                                                                        │
│  [5] Async Loading Thread 2 (다시) ⚠️ 병목 지점 2                      │
│      ├─ 시리얼라이즈 (직렬화)                                          │
│      │   └─ FArchive를 통한 역직렬화                                  │
│      │                                                                 │
│      ├─ 패키지 참조 전개 (Reference Resolution)                        │
│      │   └─ 의존 에셋 로드 (애니메이션 등)                             │
│      │                                                                 │
│      ├─ 네이티브 클래스 생성자 실행                                    │
│      │   └─ UObject::UObject() 호출                                   │
│      │                                                                 │
│      ├─ 리소스 전개                                                   │
│      │   ├─ 텍스처 초기화                                             │
│      │   ├─ 머티리얼 초기화                                           │
│      │   └─ 메시 초기화                                               │
│      │                                                                 │
│      └─ 사용 가능 알림 → Game Thread                                  │
│          ↓                                                             │
│                                                                        │
│  [6] Game Thread (다시) ⚠️ 병목 지점 3                                 │
│      ├─ 레벨 스트리밍 (Level Streaming)                                │
│      │   ├─ 액터 생성 (SpawnActor)                                    │
│      │   ├─ 컴포넌트 생성 (CreateComponents)                          │
│      │   └─ BeginPlay() 실행                                          │
│      │                                                                 │
│      ├─ 머티리얼 파이프라인 컴파일 체크                                │
│      │   └─ 셰이더 파이프라인이 준비되었는지 확인                      │
│      │                                                                 │
│      ├─ 물리 바디 셋업                                                │
│      │   └─ PhysX/Chaos 물리 바디 생성                                │
│      │                                                                 │
│      └─ 에셋 사용 가능!                                               │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

**주요 개선점:**

1. **의존성 분석 시점 변경**
   ```cpp
   // AsyncLoader: 런타임 분석
   void AsyncLoader::LoadPackage(FPackageId PackageId)
   {
       // 매 로드마다 의존성 분석 (느림!)
       TArray<FPackageId> Dependencies = AnalyzeDependencies(PackageId);
       for (FPackageId Dep : Dependencies) {
           LoadPackage(Dep);  // 재귀 로드
       }
   }

   // SyncLoader2: 패키징 시점 분석
   // .utoc 파일에 의존성 정보가 미리 저장되어 있음
   void SyncLoader2::LoadPackage(FPackageId PackageId)
   {
       // .utoc에서 의존성 목록 즉시 로드 (빠름!)
       TArray<FPackageId> Dependencies = Toc->GetDependencies(PackageId);
       BatchLoadPackages(Dependencies);  // 배치 로드
   }
   ```

2. **IO Dispatcher 추가**
   - IOStore 컨테이너에 특화된 읽기 최적화
   - 메모리 블록 정보를 미리 구축하여 IO Service에 전달
   - 배치 읽기 (Batch Read) 지원

3. **컨테이너 직접 읽기**
   - .pak 우회하여 .ucas 직접 접근
   - 16바이트 얼라인먼트로 효율적 메모리 접근

---

## 📊 실측 성능 개선 (검증된 데이터)

### 테스트 환경

**검증 프로젝트:**
- Elemental Demo
- Infiltrator Demo
- Raid Demo (고품질 콘텐츠)

**측정 방법:**
- Windows 64 Test Build 패키지
- Unreal Insights로 5회 반복 측정 후 평균
- 엔진 로드 시간 제외, 레벨 로드만 측정

---

### 성능 개선 결과

| 프로젝트 | IOStore 비활성화 | IOStore 활성화 | 개선율 | 비고 |
|---------|----------------|---------------|--------|------|
| **Elemental** | 로드 시간 기준 | - | **28% 단축** | 중간 크기 프로젝트 |
| **Infiltrator** | 로드 시간 기준 | - | **28% 단축** | 중간 크기 프로젝트 |
| **Raid Demo** | 로드 시간 기준 | - | **5% 단축** | 고품질 콘텐츠 많음 |
| **사내 프로젝트** | 90초 | 60초 | **33% 단축** | 대규모 프로젝트 |

**Raid Demo 개선율이 낮은 이유:**
- 고품질 텍스처/메시 등 에셋 자체 크기가 큼 (8K 텍스처, 100만 폴리곤 메시)
- I/O 최적화보다 **에셋 자체 로드 시간**이 병목
- 압축 해제, 시리얼라이즈 비용이 더 큼

**프로젝트 특성별 개선 효과:**
```
작은 에셋 많음 (블루프린트, UI) → 큰 개선 (30%+)
중간 에셋 (일반 3D 게임)       → 중간 개선 (20-30%)
큰 에셋 많음 (고품질 그래픽)   → 작은 개선 (5-15%)
```

---

## ⚠️ 로딩 병목 지점 분석 (Unreal Insights 활용)

### Unreal Insights 데이터 캡처

**캡처 명령어:**
```bash
# 필수 캡처
UnrealEditor.exe MyProject.uproject -trace=cpu,loadtime

# 상세 분석 (파일 I/O 포함)
UnrealEditor.exe MyProject.uproject -trace=cpu,loadtime,file

# 로드 스레드 동작 확인
UnrealEditor.exe MyProject.uproject -cpuprofileritrace
```

**프로젝트 설정에서 활성화:**
```ini
; DefaultEngine.ini
[Core.System]
; Unreal Insights 로딩 분석 활성화
EnableAssetLoadingInsights=True
```

---

### 3가지 병목 지점

**병목 지점 식별:**
```
Unreal Insights → Loading View

타임라인에서 가장 긴 바(Bar)를 찾기:
┌────────────────────────────────────────────────────────────┐
│ IO Service 바가 길면          → I/O 최적화 필요            │
│ Async Loading Thread 바가 길면 → 참조/생성자 최적화        │
│ Game Thread 바가 길면         → 스트리밍/액터 초기화 최적화│
└────────────────────────────────────────────────────────────┘
```

---

## 🎯 병목 지점 1: IO Service 최적화

### 문제점

**IO Service에서 발생하는 부하:**
- 파일 읽기 횟수가 많음
- 파일 시크 (Seek) 처리 비용
- Read 처리 비용

**타임라인 예시:**
```
IO Service 스레드:
[Seek][Read][Seek][Read][Seek][Read]...
 ↑ 이 부분이 길면 I/O 병목
```

---

### 최적화 방법

#### 1. **에셋 데이터 크기 절감**

```cpp
// ❌ 나쁜 예: 거대한 단일 에셋
UTexture2D* HugeTexture;  // 8K 텍스처 (512MB) → 로드 시간 길음

// ✅ 좋은 예: 에셋 크기 절감
UTexture2D* CompressedTexture;
// - Oodle 압축 활성화 → 128MB
// - 밉맵 최적화 (Mip Gen Settings)
// - 텍스처 스트리밍 활성화
```

**텍스처 압축 설정:**
```cpp
// 에디터에서:
Texture Settings:
├─ Compression Settings: BC7 (고품질) 또는 BC1 (경량)
├─ Compression Quality: Default (균형) 또는 Highest (품질 우선)
├─ Lossy Compression Amount: 0.0 (무손실) ~ 1.0 (최대 압축)
└─ Use Oodle Texture Compression: ✓ (UE5 권장)
```

#### 2. **에셋 리덕션 (Reduction) 수행**

```cpp
// Static Mesh LOD 설정
UStaticMesh* Mesh;
Mesh->GetNumLODs();  // LOD 개수 확인

// LOD 0 (최고 품질) 폴리곤 수 조정
// 멀리 있을 때는 낮은 LOD 사용 → 로드 시간 감소
```

#### 3. **큰 맵 파일 분할**

```cpp
// ❌ 나쁜 예: 단일 거대 맵
Level_Huge.umap (500MB)
└─ 모든 액터가 한 레벨에 (10,000개 액터)

// ✅ 좋은 예: 레벨 스트리밍
Level_Main.umap (50MB)
├─ SubLevel_Terrain.umap (100MB) - 항상 로드
├─ SubLevel_Buildings.umap (150MB) - 필요 시 로드
├─ SubLevel_Props.umap (100MB) - 필요 시 로드
└─ SubLevel_Effects.umap (100MB) - 필요 시 로드
```

**레벨 스트리밍 설정:**
```cpp
// Blueprint에서
Load Stream Level
├─ Level Name: "SubLevel_Buildings"
├─ Should Block on Load: false (비동기)
└─ Make Visible After Load: true

// C++에서
FLatentActionInfo LatentInfo;
UGameplayStatics::LoadStreamLevel(
    GetWorld(),
    FName("SubLevel_Buildings"),
    true,  // bMakeVisibleAfterLoad
    false, // bShouldBlockOnLoad
    LatentInfo
);
```

#### 4. **에셋 로딩 타이밍 변경**

```cpp
// 로딩 전략:
// - 상주 (Always Loaded): 자주 사용하는 에셋
// - 미리 읽기 (Preload): 곧 필요한 에셋
// - 지연 로드 (Lazy Load): 나중에 필요한 에셋

// ✅ 좋은 예: Soft Reference + 비동기 로드
UPROPERTY()
TSoftObjectPtr<UTexture2D> LazyTexture;

void AMyActor::LoadTextureWhenNeeded()
{
    if (!LazyTexture.IsValid())
    {
        // 비동기 로드
        FStreamableManager& Streamable =
            UAssetManager::GetStreamableManager();

        Streamable.RequestAsyncLoad(
            LazyTexture.ToSoftObjectPath(),
            FStreamableDelegate::CreateUObject(
                this, &AMyActor::OnTextureLoaded)
        );
    }
}
```

---

## 🎯 병목 지점 2: Async Loading Thread 2 최적화

### 문제점

**Async Loading Thread에서 발생하는 부하:**
- 패키지 참조 전개 (Reference Resolution)
- 네이티브 클래스 생성자 (Constructor)
- 리소스 시리얼라이즈 (Serialization)

---

### 최적화 방법

#### 1. **패키지 참조 전개 최적화**

```cpp
// 문제: Hard Reference는 즉시 로드됨
UPROPERTY()
UAnimSequence* Animation;
// 레벨 로드 시 애니메이션도 즉시 로드 → 로드 시간 증가

UPROPERTY()
USkeletalMesh* Mesh;
// 메시도 즉시 로드 → 추가 로드 시간

// ✅ 해결: Soft Reference
UPROPERTY()
TSoftObjectPtr<UAnimSequence> Animation;
// 필요할 때 로드 (PlayAnimation 호출 시)

UPROPERTY()
TSoftObjectPtr<USkeletalMesh> Mesh;
// 필요할 때 로드

// 로드 타이밍 제어
void AMyCharacter::PlayAnimation(FName AnimName)
{
    if (!Animation.IsValid())
    {
        // 이 시점에 로드
        Animation.LoadSynchronous();
    }
    // 애니메이션 재생
}
```

**Hard vs Soft Reference 비교:**
```
Hard Reference:
레벨 로드 → 즉시 모든 참조 로드
  └─ Animation (100MB)
      └─ Mesh (200MB)
          └─ Material (50MB)
              └─ Texture (300MB)
총 650MB 즉시 로드 → 느림!

Soft Reference:
레벨 로드 → 레벨만 로드 (10MB)
필요 시점 → 필요한 것만 로드 (100MB)
총 110MB만 로드 → 빠름!
```

#### 2. **네이티브 클래스 생성자 최적화**

```cpp
// ❌ 나쁜 예: 생성자에서 무거운 작업
AMyActor::AMyActor()
{
    // 데이터 테이블 로드 (느림!)
    static ConstructorHelpers::FObjectFinder<UDataTable> DataTableFinder(
        TEXT("/Game/Data/MyDataTable"));
    DataTable = DataTableFinder.Object;

    // 복잡한 초기화
    for (int i = 0; i < 1000; i++) {
        Components.Add(CreateDefaultSubobject<UStaticMeshComponent>(
            FName(*FString::Printf(TEXT("Mesh%d"), i))));
    }
}

// ✅ 좋은 예: BeginPlay로 지연
AMyActor::AMyActor()
{
    // 생성자는 가볍게
    RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
}

void AMyActor::BeginPlay()
{
    Super::BeginPlay();

    // 무거운 작업은 BeginPlay에서
    DataTable = LoadObject<UDataTable>(
        nullptr, TEXT("/Game/Data/MyDataTable"));

    // 또는 비동기 로드
    FStreamableManager& Streamable =
        UAssetManager::GetStreamableManager();
    Streamable.RequestAsyncLoad(
        FSoftObjectPath(TEXT("/Game/Data/MyDataTable")),
        FStreamableDelegate::CreateUObject(
            this, &AMyActor::OnDataTableLoaded)
    );
}
```

**생성자 vs BeginPlay 타이밍:**
```
생성자:
└─ 에셋 로드 중 실행 (Async Loading Thread)
   └─ 블로킹 발생 → 로드 시간 증가

BeginPlay:
└─ 레벨 로드 완료 후 실행 (Game Thread)
   └─ 로드 시간에 영향 없음
```

#### 3. **리소스 시리얼라이즈 최적화**

**라이트맵 최적화:**
```cpp
// 에디터에서 라이트맵 해상도 조정
World Settings:
├─ Lightmass Settings
│   ├─ Static Lighting Level Scale: 1.0 → 0.5 (절반 해상도)
│   └─ Num Indirect Lighting Bounces: 3 → 1 (바운스 횟수 감소)
│
└─ Lightmap Resolution
    ├─ 큰 메시: 512 → 256
    └─ 작은 메시: 256 → 128

// 섀도우 큐브 설정
DirectionalLight:
└─ Dynamic Shadow Distance Stationary Light: 20000 → 5000
   (그림자 거리 감소 → 섀도우 맵 크기 감소)
```

**머티리얼 참조 최적화:**
```cpp
// ❌ 나쁜 예: 불필요한 머티리얼 캐시
UMaterialInterface* Material = Mesh->GetMaterial(0);
// 사용하지 않는데도 로드됨

// ✅ 좋은 예: 필요한 것만 참조
void AMyActor::BeginPlay()
{
    Super::BeginPlay();

    // 실제 사용할 때만 머티리얼 가져오기
    if (bNeedsMaterial)
    {
        UMaterialInterface* Material = Mesh->GetMaterial(0);
    }
}
```

**Static Mesh LOD 최적화:**
```cpp
// LOD 0 퀄리티 조정
UStaticMesh* Mesh;

// 멀리 있을 때 LOD 0 사용 안 함
Mesh->LODGroup = NAME_None;
Mesh->bAutoComputeLODScreenSize = true;

// LOD 설정
FStaticMeshSourceModel& LOD0 = Mesh->GetSourceModel(0);
LOD0.ReductionSettings.PercentTriangles = 1.0f;  // 100% (최고 품질)

FStaticMeshSourceModel& LOD1 = Mesh->GetSourceModel(1);
LOD1.ReductionSettings.PercentTriangles = 0.5f;  // 50%

FStaticMeshSourceModel& LOD2 = Mesh->GetSourceModel(2);
LOD2.ReductionSettings.PercentTriangles = 0.25f; // 25%
```

---

## 🎯 병목 지점 3: Game Thread 최적화

### 문제점

**Game Thread에서 발생하는 부하:**
- 레벨 스트리밍 (Level Streaming)
- 액터/컴포넌트 생성 및 초기화
- 머티리얼 파이프라인 컴파일 체크
- 물리 바디 셋업

---

### 최적화 방법

#### 1. **레벨 스트리밍 타이밍 조정**

```cpp
// ❌ 나쁜 예: 한번에 모든 서브 레벨 로드
void AMyGameMode::BeginPlay()
{
    Super::BeginPlay();

    // 모든 레벨을 동시에 로드 → 끊김 현상 (Hitches)
    UGameplayStatics::LoadStreamLevel(this, "SubLevel_1", true, false, LatentInfo);
    UGameplayStatics::LoadStreamLevel(this, "SubLevel_2", true, false, LatentInfo);
    UGameplayStatics::LoadStreamLevel(this, "SubLevel_3", true, false, LatentInfo);
    UGameplayStatics::LoadStreamLevel(this, "SubLevel_4", true, false, LatentInfo);
    UGameplayStatics::LoadStreamLevel(this, "SubLevel_5", true, false, LatentInfo);
}

// ✅ 좋은 예: 점진적 로드
void AMyGameMode::BeginPlay()
{
    Super::BeginPlay();

    // 필수 레벨만 즉시 로드
    UGameplayStatics::LoadStreamLevel(this, "SubLevel_Essential", true, false, LatentInfo);

    // 나머지는 타이머로 순차 로드
    CurrentLevelIndex = 0;
    GetWorld()->GetTimerManager().SetTimer(
        LoadTimerHandle,
        this,
        &AMyGameMode::LoadNextLevel,
        0.5f,  // 0.5초마다
        true   // 반복
    );
}

void AMyGameMode::LoadNextLevel()
{
    TArray<FName> LevelsToLoad = {
        "SubLevel_1", "SubLevel_2", "SubLevel_3", "SubLevel_4"
    };

    if (CurrentLevelIndex < LevelsToLoad.Num())
    {
        UGameplayStatics::LoadStreamLevel(
            this,
            LevelsToLoad[CurrentLevelIndex],
            true,
            false,
            FLatentActionInfo()
        );
        CurrentLevelIndex++;
    }
    else
    {
        // 모든 레벨 로드 완료
        GetWorld()->GetTimerManager().ClearTimer(LoadTimerHandle);
    }
}
```

**타임라인 비교:**
```
한번에 로드 (나쁨):
Frame 1: [레벨1][레벨2][레벨3][레벨4][레벨5] ← 500ms 끊김!
Frame 2: 정상
Frame 3: 정상

점진적 로드 (좋음):
Frame 1: [레벨1] ← 100ms
Frame 2: [레벨2] ← 100ms
Frame 3: [레벨3] ← 100ms
Frame 4: [레벨4] ← 100ms
Frame 5: [레벨5] ← 100ms
→ 끊김 현상 없음!
```

#### 2. **액터/컴포넌트 통합**

```cpp
// ❌ 나쁜 예: 1000개의 개별 StaticMeshActor
void AMyLevel::SpawnTrees()
{
    for (int i = 0; i < 1000; i++)
    {
        FVector Location = GetRandomLocation();
        FRotator Rotation = GetRandomRotation();

        // 각 나무마다 액터 생성 → 초기화 비용 * 1000
        AStaticMeshActor* Tree = GetWorld()->SpawnActor<AStaticMeshActor>(
            AStaticMeshActor::StaticClass(),
            Location,
            Rotation
        );
        Tree->GetStaticMeshComponent()->SetStaticMesh(TreeMesh);
    }
}

// ✅ 좋은 예: HISM (Hierarchical Instanced Static Mesh)
void AMyLevel::SpawnTrees()
{
    // 단일 컴포넌트 생성
    UHierarchicalInstancedStaticMeshComponent* HISM =
        NewObject<UHierarchicalInstancedStaticMeshComponent>(this);
    HISM->SetStaticMesh(TreeMesh);
    HISM->RegisterComponent();

    // 1000개 인스턴스 추가 (초기화 비용 1회만)
    for (int i = 0; i < 1000; i++)
    {
        FVector Location = GetRandomLocation();
        FRotator Rotation = GetRandomRotation();
        FTransform Transform(Rotation, Location);

        HISM->AddInstance(Transform);  // 매우 빠름!
    }
}
```

**성능 비교:**
```
1000개 액터:
├─ SpawnActor × 1000 = ~500ms
├─ RegisterComponent × 1000 = ~200ms
├─ BeginPlay × 1000 = ~300ms
└─ 총 1000ms (1초)

HISM:
├─ NewObject × 1 = ~0.5ms
├─ RegisterComponent × 1 = ~0.2ms
├─ AddInstance × 1000 = ~50ms
└─ 총 50.7ms (0.05초)

→ 20배 빠름! 🚀
```

#### 3. **물리 바디 최적화**

```cpp
// ❌ 나쁜 예: 모든 오브젝트에 물리 시뮬레이션
USkeletalMeshComponent* Mesh = Character->GetMesh();
Mesh->SetSimulatePhysics(true);  // 모든 본에 물리 바디 생성

// PhysicsAsset: 100개 본 → 100개 물리 바디 생성 → 느림!

// ✅ 좋은 예 1: Query Only
Mesh->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
// 충돌 감지만 활성화, 물리 시뮬레이션 비활성화
// → 물리 바디 생성 비용 절감

// ✅ 좋은 예 2: 물리 바디 개수 축소
// PhysicsAsset 에디터에서:
// 100개 본 → 20개 주요 본만 물리 바디 생성
// (머리, 상체, 팔, 다리 등 주요 부분만)

// ✅ 좋은 예 3: 지연 초기화
void AMyCharacter::BeginPlay()
{
    Super::BeginPlay();

    // 즉시 물리 활성화하지 않음
    GetMesh()->SetSimulatePhysics(false);
}

void AMyCharacter::OnRagdoll()
{
    // Ragdoll 필요할 때만 활성화
    GetMesh()->SetSimulatePhysics(true);
    GetMesh()->SetAllBodiesSimulatePhysics(true);
}
```

**물리 바디 비용:**
```
100개 물리 바디:
├─ 생성 비용: ~100ms
├─ 메모리: ~10MB
└─ 시뮬레이션 비용: 프레임당 ~5ms

20개 물리 바디:
├─ 생성 비용: ~20ms (5배 빠름)
├─ 메모리: ~2MB (5배 적음)
└─ 시뮬레이션 비용: 프레임당 ~1ms (5배 빠름)
```

#### 4. **머티리얼 파이프라인 컴파일 체크 최적화**

```cpp
// 문제: 불필요한 머티리얼 로드
void AMyActor::BeginPlay()
{
    Super::BeginPlay();

    // ❌ 모든 머티리얼을 순회하며 컴파일 체크
    TArray<UMaterialInterface*> AllMaterials;
    Mesh->GetUsedMaterials(AllMaterials);

    for (UMaterialInterface* Material : AllMaterials)
    {
        // 각 머티리얼의 셰이더 파이프라인 컴파일 완료 체크
        // → 컴파일 안 된 셰이더가 있으면 대기 (느림!)
        Material->IsReadyForFinishDestroy();
    }
}

// ✅ 해결 1: 필요한 머티리얼만 체크
void AMyActor::BeginPlay()
{
    Super::BeginPlay();

    // 현재 보이는 머티리얼만 체크
    UMaterialInterface* VisibleMaterial = Mesh->GetMaterial(0);
    if (VisibleMaterial)
    {
        VisibleMaterial->IsReadyForFinishDestroy();
    }
}

// ✅ 해결 2: 셰이더 미리 컴파일
// 에디터에서:
// Edit → Project Settings → Engine → Rendering
// ├─ Share Material Shader Code: ✓
// └─ Shared Material Native Libraries: ✓

// 패키징 시 모든 셰이더 미리 컴파일
// → 런타임 컴파일 불필요
```

---

## 💡 IOStore 활성화 방법

### 프로젝트 설정에서 활성화

```ini
; DefaultEngine.ini
[Core.System]
; IOStore 활성화 (UE 4.25+)
UseIoStore=True

; 압축 블록 크기 (기본 64KB)
IoStoreCompressionBlockSize=65536

; 파티션 크기 (기본 1GB)
IoStoreMaxPartitionSize=1073741824
```

### 명령줄 (CLI)에서 활성화

```bash
# 프로젝트 런처에서
RunUAT.bat BuildCookRun ^
    -project="C:/MyProject/MyProject.uproject" ^
    -platform=Win64 ^
    -clientconfig=Development ^
    -cook ^
    -stage ^
    -pak ^
    -iostore ^
    -compressed

# 또는 직접 쿠킹
UnrealEditor-Cmd.exe "C:/MyProject/MyProject.uproject" ^
    -run=Cook ^
    -targetplatform=Win64 ^
    -iostore
```

### 생성되는 파일 확인

```bash
# IOStore 비활성화 시
MyProject/Saved/StagedBuilds/Windows/MyProject/Content/Paks/
├─ MyProject.pak (5GB)

# IOStore 활성화 시
MyProject/Saved/StagedBuilds/Windows/MyProject/Content/Paks/
├─ MyProject.pak (500MB - 축소됨!)
├─ MyProject.utoc (50MB)
├─ MyProject_0_P.ucas (1GB)
├─ MyProject_1_P.ucas (1GB)
├─ MyProject_2_P.ucas (1GB)
└─ MyProject_3_P.ucas (500MB)
```

---

## 📈 실전 최적화 체크리스트

### I/O 최적화 (IO Service)

- [ ] 에셋 압축 활성화 (Oodle)
- [ ] 텍스처 해상도 최적화 (8K → 4K)
- [ ] 큰 맵 파일 분할 (레벨 스트리밍)
- [ ] Soft Reference 사용 (Hard Reference 최소화)
- [ ] 에셋 로딩 타이밍 조정 (지연 로드)

### 스레드 최적화 (Async Loading Thread 2)

- [ ] 패키지 참조 전개 최소화 (불필요한 Hard Reference 제거)
- [ ] 생성자 최적화 (무거운 작업 BeginPlay로 이동)
- [ ] 라이트맵 해상도 감소 (2048 → 1024)
- [ ] 섀도우 큐브 크기 감소
- [ ] Static Mesh LOD 설정

### 게임 스레드 최적화 (Game Thread)

- [ ] 레벨 스트리밍 타이밍 조정 (점진적 로드)
- [ ] 액터/컴포넌트 통합 (HISM 사용)
- [ ] 물리 바디 개수 축소 (100개 → 20개)
- [ ] 물리 시뮬레이션 Query Only 설정
- [ ] 머티리얼 셰이더 미리 컴파일

---

## 🔗 참고자료

### 공식 문서
- [Unreal Engine Asset Management](https://docs.unrealengine.com/en-US/WorkingWithContent/AssetManagement/)
- [Level Streaming](https://docs.unrealengine.com/en-US/BuildingWorlds/LevelStreaming/)
- [Unreal Insights](https://docs.unrealengine.com/en-US/TestingAndOptimization/PerformanceAndProfiling/UnrealInsights/)

### 소스 코드
- `Engine/Source/Runtime/Core/Internal/IO/IoStore.h` - IOStore 구조
- `Engine/Source/Runtime/Core/Public/IO/IoDispatcher.h` - I/O 디스패처
- `Engine/Source/Runtime/CoreUObject/Private/Serialization/AsyncLoading2.cpp` - SyncLoader2 구현
- `Engine/Source/Runtime/Core/Private/IO/IoDispatcher.cpp` - IO Service 구현

### 관련 주제
- `UnrealSummary/Core/Memory.md` - 메모리 할당자 (FMallocBinned3)
- `UnrealSummary/Core/Async.md` - 비동기 프로그래밍
- `UnrealSummary/CoreUObject/Serialization.md` - 직렬화 시스템

---

> 📅 생성: 2025-10-27 — IOStore 시스템 문서화 (UE 4.25 ~ UE 5.7)
>
> 본 문서는 언리얼 엔진의 IOStore 시스템을 체계적으로 정리한 것입니다.
> - IOStore 기본 개념 및 PAK 시스템과의 비교
> - SyncLoader2 아키텍처 및 로딩 흐름
> - 실측 성능 개선 수치 및 병목 지점 분석
> - Unreal Insights를 활용한 최적화 방법
> - 실무 최적화 체크리스트
