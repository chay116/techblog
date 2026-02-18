---
title: "Core 모듈"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Core"
tags: ["unreal", "Core"]
---
# Core 모듈

## 🧭 개요

**Core** 모듈은 언리얼 엔진의 기반 계층입니다. 플랫폼 추상화, 기본 데이터 구조, 메모리 관리, 스레딩 기본 요소, 그리고 다른 모든 언리얼 모듈이 의존하는 저수준 유틸리티를 제공합니다.

**주요 책임:**
- **플랫폼 추상화 레이어 (HAL)** - Windows, Mac, Linux, 콘솔, 모바일 플랫폼 전반에 걸친 통합 인터페이스
- **컨테이너 타입** - TArray, TMap, TSet 및 특수 컨테이너
- **메모리 관리** - 커스텀 할당자, 메모리 추적, 디버깅 도구
- **스레딩 & 동기화** - 스레드 프리미티브, 태스크 시스템, 원자적 연산
- **수학 라이브러리** - 벡터, 행렬, 쿼터니언, 트랜스폼, 수학 유틸리티
- **문자열 처리** - FString, FName, FText, 문자열 변환 유틸리티
- **델리게이트 & 이벤트** - 엔진 전체에서 사용되는 타입 안전 콜백 시스템
- **로깅 & 어설션** - UE_LOG, check(), ensure() 매크로
- **직렬화 기반** - 바이너리 및 텍스트 직렬화 프리미티브

**모듈 의존성:**
- **Public:** TraceLog, GuidelinesSupportLibrary, AtomicQueue
- **Private:** BuildSettings, AutoRTFM, BLAKE3, OodleDataCompression, xxhash, mimalloc (Windows), libpas (Windows)

**위치:** `Engine/Source/Runtime/Core/`

---

## 🧱 구조

### 디렉토리 구성

```
Core/
├── Public/                    # 공개 API 헤더
│   ├── HAL/                   # 하드웨어 추상화 레이어
│   ├── Containers/            # TArray, TMap, TSet 등
│   ├── Math/                  # Vector, Matrix, Rotator 등
│   ├── Templates/             # 템플릿 메타프로그래밍 유틸리티
│   ├── Delegates/             # 델리게이트 시스템 구현
│   ├── Memory/                # 메모리 관리
│   ├── Async/                 # 비동기 태스크 시스템
│   ├── Misc/                  # 기타 유틸리티
│   ├── Serialization/         # 아카이브 및 직렬화
│   ├── String/                # 문자열 타입 및 유틸리티
│   ├── UObject/               # UObject 기반 (FName 등)
│   ├── Logging/               # 로깅 시스템
│   └── CoreMinimal.h          # 대부분의 파일을 위한 최소 인클루드
├── Private/                   # 구현 파일
└── Core.Build.cs              # 빌드 구성
```

### 핵심 서브시스템

#### 1. 하드웨어 추상화 레이어 (HAL)
통합 인터페이스를 가진 플랫폼별 구현:

- **메모리:** `FMemory`, `FPlatformMemory`, malloc 래퍼 (Binned2, Binned3, TBB, mimalloc, Jemalloc)
- **플랫폼:** `FPlatformProcess`, `FPlatformMisc`, `FPlatformTime`
- **스레딩:** `FRunnable`, `FRunnableThread`, `FCriticalSection`, `FEvent`
- **파일 I/O:** `IPlatformFile`, `IFileManager`, `FFileHelper`
- **원자적 연산:** `FPlatformAtomics` - 락 프리 연산

**플랫폼 지원:**
- Windows (Win64, Arm64)
- Mac (x64, Apple Silicon)
- Linux (x64, Arm64)
- Android, iOS
- PlayStation, Xbox, Nintendo Switch

#### 2. 컨테이너 라이브러리
커스텀 할당자를 사용하는 최적화된 데이터 구조:

- **TArray<T>** - 동적 배열 (std::vector와 유사)
- **TMap<K, V>** - 해시 맵 (std::unordered_map과 유사)
- **TSet<T>** - 해시 셋 (std::unordered_set과 유사)
- **TSortedMap<K, V>** - 정렬된 맵 (이진 검색 트리)
- **TStaticArray<T, N>** - 고정 크기 배열
- **TBitArray** - 컴팩트한 불리언 배열
- **TSparseArray<T>** - 공백이 있는 배열
- **TChunkedArray<T>** - 재할당 없는 배열
- **TCircularQueue<T>**, **TQueue<T>** - FIFO 구조
- **TDoubleLinkedList<T>**, **TIntrusiveLinkedList<T>** - 연결 리스트
- **TLruCache<K, V>** - 최근 최소 사용 캐시

#### 3. 문자열 타입

- **FString** - 가변적, 동적 문자열 (TCHAR*, 대부분의 플랫폼에서 UCS-2/UTF-16)
- **FName** - 불변, 대소문자 구분 없음, 빠른 비교에 최적화 (전역 이름 테이블에 저장)
- **FText** - 포맷팅을 지원하는 지역화된 텍스트
- **FStringView** - 소유권 없는 문자열 뷰 (std::string_view와 유사)
- **TCHAR** - 플랫폼별 문자 타입 (Windows에서는 wchar_t, 그 외에는 char16_t)

#### 4. 수학 라이브러리

**핵심 타입:**
- **FVector** (3D), **FVector2D** (2D), **FVector4** (4D) - 위치/방향
- **FRotator** - Pitch/Yaw/Roll 회전 (도 단위)
- **FQuat** - 쿼터니언 회전
- **FTransform** - 이동 + 회전 + 스케일
- **FMatrix** - 4x4 변환 행렬
- **FIntPoint**, **FIntVector** - 정수 벡터
- **FBox**, **FSphere**, **FCapsuleShape** - 바운딩 볼륨
- **FPlane**, **FColor**, **FLinearColor** - 추가 수학 타입

**SIMD 지원:** SSE/NEON/AVX 최적화를 위한 VectorRegister 타입

#### 5. 델리게이트 시스템

타입 안전한 멀티캐스트 콜백 시스템:

- **TDelegate<RetVal(Params...)>** - 싱글캐스트 델리게이트
- **TMulticastDelegate<Params...>** - 멀티캐스트 델리게이트 (다수의 리스너)
- **이벤트 변형** - 스레드 안전 이벤트 디스패칭
- **동적 델리게이트** - UObject 기반, 블루프린트 호환 (느림)

**바인딩 타입:**
- Raw 함수 포인터
- 멤버 함수 (UObject 또는 일반 C++)
- 람다 함수
- 정적 함수
- 약한 객체 포인터 (객체 소멸 시 자동 언바인드)

#### 6. 메모리 관리

**할당자:**
- **FMallocBinned2** - 기본 범용 할당자
- **FMallocBinned3** - 개선된 binned 할당자 (UE5 기본값)
- **FMallocTBB** - Intel Thread Building Blocks 할당자
- **FMallocMimalloc** - Microsoft의 mimalloc (Windows 옵션)
- **FMallocAnsi** - 시스템 malloc 래퍼
- **FMallocStomp** - 오버런 감지를 위한 디버그 할당자

**추적:**
- Low-Level Memory Tracker (LLM) - 프레임당 메모리 통계
- Memory Profiler 통합
- 개발 빌드에서 누수 감지

#### 7. 태스크 시스템

비동기 실행 프레임워크:

- **Tasks::Launch()** - 현대적인 태스크 그래프 시스템 (UE5+)
- **FAsyncTask<T>** - 백그라운드 태스크 래퍼
- **ParallelFor()** - 데이터 병렬 루프
- **Task graph** - 의존성 기반 태스크 스케줄링

#### 8. 스마트 포인터

**Non-UObject 타입:**
- **TSharedPtr<T>** - 참조 카운팅 공유 소유권
- **TSharedRef<T>** - null이 아닌 공유 참조
- **TWeakPtr<T>** - TSharedPtr에 대한 약한 참조
- **TUniquePtr<T>** - 독점 소유권 (std::unique_ptr와 유사)

**UObject 타입:**
- Raw 포인터 또는 **TObjectPtr<T>** (UE5.0+)
- **TWeakObjectPtr<T>** - UObject에 대한 약한 참조
- UObject와 함께 TSharedPtr 사용 금지 (가비지 컬렉션을 방해함)

**왜 STL 대신 커스텀 구현?**
- 크로스 플랫폼 일관성
- 더 효율적인 메모리 관리
- 스레드 안전 모드 지원
- UE 에코시스템과의 통합

#### 9. 동기화 프리미티브 (Synchronization)

**뮤텍스 및 락:**
- **FCriticalSection** - 기본 뮤텍스
- **FScopeLock** - RAII 스타일 락
- **FRWLock** - Reader-Writer 락
- **FTransactionallySafeCriticalSection** - 트랜잭션 안전

**원자적 연산:**
- **FPlatformAtomics::InterlockedIncrement()** - 원자적 증가
- **FPlatformAtomics::InterlockedDecrement()** - 원자적 감소
- **FPlatformAtomics::InterlockedCompareExchange()** - CAS 연산
- **FPlatformAtomics::InterlockedExchange()** - 원자적 교환

**메모리 배리어:**
- **FPlatformMisc::MemoryBarrier()** - 메모리 순서 강제
- CPU별 구현 (x86: `_mm_sfence()`, ARM: `__dmb()`)
- Lock-free 자료구조에서 필수

#### 10. 모듈 시스템 (Module System)

**플러그인 아키텍처:**
- **IModuleInterface** - 모듈 인터페이스 기본 클래스
- **FModuleManager** - 모듈 로드/언로드 관리
- **IMPLEMENT_MODULE()** - 모듈 등록 매크로

**모듈 종류:**
- **런타임 모듈** - 게임 실행에 필요
- **에디터 모듈** - 에디터에서만 로드
- **플러그인 모듈** - 선택적 기능

---

## 🧩 주요 API

### 필수 인클루드

```cpp
#include "CoreMinimal.h"  // 대부분의 파일을 위한 최소 인클루드
#include "CoreTypes.h"    // 플랫폼 타입 (int32, uint64, TCHAR 등)
#include "CoreFwd.h"      // 전방 선언
```

### 로깅

```cpp
// 로그 카테고리 정의 (헤더에서)
DECLARE_LOG_CATEGORY_EXTERN(LogMyModule, Log, All);

// 구현 정의 (cpp에서)
DEFINE_LOG_CATEGORY(LogMyModule);

// 로그 메시지
UE_LOG(LogMyModule, Warning, TEXT("플레이어 체력: %d"), Health);
UE_LOG(LogTemp, Error, TEXT("에셋 로드 실패: %s"), *AssetPath);
```

**로그 상세도:** Fatal, Error, Warning, Display, Log, Verbose, VeryVerbose

### 어설션

```cpp
check(Pointer != nullptr);           // 모든 빌드에서 치명적 오류
checkSlow(Condition);                 // Debug 빌드에서만
checkf(Index < Size, TEXT("인덱스 %d 범위 초과"), Index);

ensure(Pointer != nullptr);          // 한 번만 로그, 실행 계속
ensureAlways(Condition);             // 매번 로그
ensureMsgf(Condition, TEXT("메시지"));

verify(Function());                  // check()와 유사하지만 Shipping에서도 평가
```

### 컨테이너

```cpp
// TArray
TArray<int32> Numbers = {1, 2, 3};
Numbers.Add(4);
Numbers.Remove(2);
Numbers.Sort();

// TMap
TMap<FString, int32> Scores;
Scores.Add(TEXT("Player1"), 100);
int32* Score = Scores.Find(TEXT("Player1"));

// TSet
TSet<FName> Tags;
Tags.Add("Flammable");
bool bHasTag = Tags.Contains("Flammable");
```

### 델리게이트

```cpp
// 선언
DECLARE_DELEGATE_OneParam(FOnHealthChanged, float);
DECLARE_MULTICAST_DELEGATE_TwoParams(FOnDamaged, AActor*, float);

// 바인드
OnHealthChanged.BindUObject(this, &UHealthComponent::HandleHealthChanged);
OnHealthChanged.BindLambda([](float NewHealth) { /* ... */ });

// 실행
if (OnHealthChanged.IsBound())
{
    OnHealthChanged.Execute(NewHealth);
}

// 멀티캐스트
OnDamaged.AddUObject(this, &UMyClass::OnDamagedHandler);
OnDamaged.Broadcast(DamageCauser, DamageAmount);
```

### 메모리

```cpp
// 할당
void* Memory = FMemory::Malloc(Size, Alignment);
FMemory::Free(Memory);

// 재할당
Memory = FMemory::Realloc(Memory, NewSize, Alignment);

// 메모리 연산
FMemory::Memcpy(Dest, Src, NumBytes);
FMemory::Memset(Dest, Value, NumBytes);
FMemory::Memzero(Dest, NumBytes);
FMemory::Memcmp(A, B, NumBytes);
```

### 스레딩 및 동기화

```cpp
// 스레드 생성
FRunnableThread* Thread = FRunnableThread::Create(
    MyRunnable, TEXT("WorkerThread"));

// 기본 뮤텍스
FCriticalSection Mutex;
{
    FScopeLock Lock(&Mutex);
    // 임계 영역 - 자동으로 언락됨
}

// Reader-Writer Lock
FRWLock RWLock;
{
    FReadScopeLock ReadLock(RWLock);   // 여러 reader 동시 접근 가능
    // 읽기 전용 접근
}
{
    FWriteScopeLock WriteLock(RWLock);  // 독점 접근
    // 쓰기 접근
}

// 원자적 연산
int32 Counter = 0;
FPlatformAtomics::InterlockedIncrement(&Counter);           // Counter++
FPlatformAtomics::InterlockedDecrement(&Counter);           // Counter--
FPlatformAtomics::InterlockedAdd(&Counter, 5);              // Counter += 5

// Compare-And-Swap (CAS)
int32 OldValue = 10;
int32 NewValue = 20;
int32 Result = FPlatformAtomics::InterlockedCompareExchange(
    &Counter, NewValue, OldValue);  // Counter == OldValue이면 NewValue로 교체

// 원자적 교환
int32 Old = FPlatformAtomics::InterlockedExchange(&Counter, 100);

// 메모리 배리어
FPlatformMisc::MemoryBarrier();  // 메모리 연산 순서 강제
```

### 메모리 배리어 (Memory Barrier)

```cpp
// Lock-free Queue 예시
class FLockFreeQueue
{
    TAtomic<int32> Head{0};
    TAtomic<int32> Tail{0};
    TArray<void*> Buffer;

    void Enqueue(void* Item)
    {
        int32 CurrentTail = Tail.Load();
        Buffer[CurrentTail] = Item;

        // 메모리 배리어 - Buffer 쓰기가 Tail 업데이트 전에 완료됨을 보장
        FPlatformMisc::MemoryBarrier();

        Tail.Store(CurrentTail + 1);
    }

    void* Dequeue()
    {
        int32 CurrentHead = Head.Load();

        // 메모리 배리어 - Head 읽기가 Buffer 읽기 전에 완료됨을 보장
        FPlatformMisc::MemoryBarrier();

        void* Item = Buffer[CurrentHead];
        Head.Store(CurrentHead + 1);
        return Item;
    }
};

// 플랫폼별 구현
// Windows x86/x64:
FORCEINLINE static void MemoryBarrier()
{
    _mm_sfence();  // Store Fence
}

// Windows ARM64:
FORCEINLINE static void MemoryBarrier()
{
    __dmb(_ARM64_BARRIER_SY);  // Data Memory Barrier
}
```

**메모리 배리어가 필요한 이유:**
- CPU는 성능을 위해 메모리 연산 순서를 재배치할 수 있음
- 컴파일러도 최적화 시 순서를 바꿀 수 있음
- 멀티스레드 환경에서 예상치 못한 동작 발생 가능
- Memory Barrier는 특정 지점 이전/이후의 메모리 연산 순서를 보장

**사용 사례:**
- Lock-free 자료구조 (Queue, Stack, List)
- Double-checked locking 패턴
- Producer-Consumer 패턴
- 스핀락 구현

### 모듈 시스템 (Module System)

```cpp
// 모듈 인터페이스 정의
class FMyModule : public IModuleInterface
{
public:
    // 모듈 시작 시 호출
    virtual void StartupModule() override
    {
        UE_LOG(LogTemp, Log, TEXT("MyModule Started"));
    }

    // 모듈 종료 시 호출
    virtual void ShutdownModule() override
    {
        UE_LOG(LogTemp, Log, TEXT("MyModule Shutdown"));
    }
};

// 모듈 등록 (cpp 파일에서)
IMPLEMENT_MODULE(FMyModule, MyModule)

// 모듈 로드
FModuleManager::LoadModuleChecked<FMyModule>("MyModule");

// 모듈 언로드
FModuleManager::Get().UnloadModule("MyModule");

// 조건부 모듈 로드
if (FModuleManager::Get().ModuleExists("MyModule"))
{
    IModuleInterface* Module = FModuleManager::Get().LoadModule("MyModule");
}
```

### 직렬화 (Serialization)

```cpp
// FArchive - 직렬화 추상 클래스
class FMyData
{
    int32 Health;
    FString Name;
    TArray<float> Values;

    // 직렬화 연산자
    friend FArchive& operator<<(FArchive& Ar, FMyData& Data)
    {
        Ar << Data.Health;
        Ar << Data.Name;
        Ar << Data.Values;
        return Ar;
    }
};

// 파일에 저장
FArchive* Writer = IFileManager::Get().CreateFileWriter(*FilePath);
if (Writer)
{
    *Writer << MyData;
    Writer->Close();
    delete Writer;
}

// 파일에서 로드
FArchive* Reader = IFileManager::Get().CreateFileReader(*FilePath);
if (Reader)
{
    *Reader << MyData;
    Reader->Close();
    delete Reader;
}

// 메모리 버퍼 직렬화
TArray<uint8> Buffer;
FMemoryWriter MemWriter(Buffer);
MemWriter << MyData;

// 메모리 버퍼 역직렬화
FMemoryReader MemReader(Buffer);
MemReader << MyData;
```

### 플랫폼 추상화

```cpp
// 시간
double Seconds = FPlatformTime::Seconds();
uint64 Cycles = FPlatformTime::Cycles64();

// 파일 경로
FString GameDir = FPaths::ProjectDir();
FString ConfigPath = FPaths::Combine(GameDir, TEXT("Config"), TEXT("Settings.ini"));

// 플랫폼 정보
bool bIsWindows = PLATFORM_WINDOWS;
bool b64Bit = PLATFORM_64BITS;
FString PlatformName = FPlatformProperties::PlatformName();
```

---

## 🔗 모듈 의존성 아키텍처

### 엔진 모듈 계층 구조

Core 모듈은 언리얼 엔진의 최하위 계층으로, 모든 모듈의 기반이 됩니다:

```
┌─────────────────────────────────────────────────────────────────┐
│                        게임/에디터 모듈                           │
│                      (FPS, RPG, 에디터 툴)                        │
├─────────────────────────────────────────────────────────────────┤
│ 의존:                                                            │
│  • Engine, UnrealEd, CoreUObject, Slate, UMG                    │
│  • 게임 특화 로직                                                │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 의존 (depends on)
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                    엔진 상위 계층 (High-level)                    │
│              Engine, Renderer, Slate, UMG, Landscape             │
├─────────────────────────────────────────────────────────────────┤
│ 책임:                                                            │
│  • 게임 로직 (Actor, Component, GameMode)                        │
│  • 렌더링 파이프라인 (RHI, Shader, Material)                     │
│  • UI 시스템 (Slate Widget, UMG Blueprint)                       │
│                                                                  │
│ 의존:                                                            │
│  • CoreUObject (UObject 시스템)                                 │
│  • Core (기본 타입, 컨테이너)                                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 의존 (depends on)
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                       CoreUObject 모듈                           │
│         (UObject 시스템, Reflection, Garbage Collection)         │
├─────────────────────────────────────────────────────────────────┤
│ 책임:                                                            │
│  • UObject 기본 클래스 및 생명주기                               │
│  • 리플렉션 시스템 (UClass, FProperty, UFunction)                │
│  • 가비지 컬렉션 (Mark-Sweep, 참조 추적)                         │
│  • 직렬화 (Save/Load, 네트워크 리플리케이션)                     │
│                                                                  │
│ 의존:                                                            │
│  • Core (컨테이너, 메모리, 스레딩 등 모든 기본 기능)             │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 의존 (depends on)
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                          Core 모듈 ★                            │
│         (기반 계층 - 모든 모듈이 의존하는 플랫폼 독립 API)        │
├─────────────────────────────────────────────────────────────────┤
│ 제공:                                                            │
│  • 플랫폼 추상화 레이어 (HAL)                                    │
│  • 컨테이너 (TArray, TMap, TSet)                                │
│  • 메모리 관리 (FMemory, FMalloc)                               │
│  • 스레딩 & 동기화 (FRunnable, FCriticalSection)                │
│  • 수학 라이브러리 (FVector, FMatrix, FQuat)                    │
│  • 문자열 (FString, FName, FText)                               │
│  • 델리게이트 (TDelegate, TMulticastDelegate)                   │
│  • 로깅 & 어설션 (UE_LOG, check, ensure)                        │
│                                                                  │
│ 의존:                                                            │
│  • TraceLog (성능 추적)                                         │
│  • 써드파티 라이브러리 (mimalloc, xxhash, BLAKE3)                │
│                                                                  │
│ 규칙: Core는 절대 CoreUObject나 상위 모듈을 의존하지 않음!       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 의존 (depends on)
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                    플랫폼 계층 (OS/Hardware)                      │
│              Windows, Linux, Mac, iOS, Android, 콘솔             │
├─────────────────────────────────────────────────────────────────┤
│ 제공:                                                            │
│  • 운영체제 API (VirtualAlloc, mmap, CreateThread)              │
│  • 파일 시스템 (CreateFile, open)                               │
│  • 네트워크 소켓 (WinSock, BSD sockets)                          │
│  • CPU 명령어 (SIMD: SSE/AVX/NEON)                              │
└─────────────────────────────────────────────────────────────────┘
```

### 의존성 규칙

| 규칙                          | 설명                                 | 예시                                      |
|-------------------------------|--------------------------------------|-------------------------------------------|
| **하향 의존만 허용**           | 상위 모듈만 하위 모듈 의존 가능        | Engine → CoreUObject → Core ✅            |
| **상향 의존 금지**             | 하위 모듈은 상위 모듈 참조 불가        | Core → CoreUObject ❌ (컴파일 에러)      |
| **순환 의존 금지**             | A → B → A 형태의 의존성 금지          | Module1 ⇄ Module2 ❌ (링커 에러)         |
| **전방 선언 권장**             | 헤더 의존성 최소화                    | class UObject; (인클루드 대신)            |
| **Public/Private 분리**       | Public API만 다른 모듈에 노출         | Public/MyModule.h, Private/MyImpl.h      |

### Core 모듈의 Internal 의존성

Core 모듈 자체의 내부 의존성:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Core/Public/                              │
│                  (외부 모듈에 노출되는 API)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  CoreMinimal.h  ← 대부분의 파일이 인클루드                       │
│      │                                                           │
│      ├─ HAL/Platform.h           (플랫폼 추상화 기본)           │
│      ├─ Misc/CoreMiscDefines.h   (매크로 및 정의)               │
│      ├─ Misc/AssertionMacros.h   (check, ensure)                │
│      ├─ Logging/LogMacros.h      (UE_LOG)                       │
│      ├─ Templates/UnrealTypeTraits.h  (타입 특성)               │
│      ├─ Containers/Array.h       (TArray)                       │
│      ├─ Containers/Map.h         (TMap)                         │
│      ├─ Containers/Set.h         (TSet)                         │
│      ├─ Containers/UnrealString.h (FString)                     │
│      └─ Math/UnrealMathUtility.h (FVector, FQuat 등)            │
│                                                                  │
│  [순서 중요!]                                                    │
│  1. Platform.h        ← 모든 플랫폼 타입 정의                    │
│  2. Templates/        ← 템플릿 메타프로그래밍 기본               │
│  3. Containers/       ← TArray 등 (Templates 의존)              │
│  4. Math/             ← FVector 등 (Containers 의존)            │
│  5. 나머지 시스템     ← 위 기본 타입들 의존                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 실제 사용 예시: 모듈 격리

```cpp
// ❌ 잘못된 예 - Core에서 CoreUObject 인클루드
// Core/Public/MyHelper.h
#include "UObject/Object.h"  // 컴파일 에러! Core는 CoreUObject 의존 불가

class FMyHelper
{
    UObject* Obj;  // UObject는 CoreUObject 모듈
};

// ✅ 올바른 예 - 전방 선언 사용
// Core/Public/MyHelper.h
class UObject;  // 전방 선언

class CORE_API FMyHelper
{
    UObject* Obj;  // 포인터/레퍼런스는 전방 선언만으로 가능
};
```

```cpp
// ✅ 올바른 예 - CoreUObject에서 Core 인클루드
// CoreUObject/Public/MyUObject.h
#include "Containers/Array.h"  // Core 모듈 - 허용됨
#include "UObject/Object.h"    // 같은 모듈 - 당연히 허용

class COREUOBJECT_API UMyObject : public UObject
{
    TArray<int32> Values;  // Core의 TArray 사용 가능
};
```

---

## 📦 컨테이너 선택 가이드

### 의사결정 트리

```
[데이터 저장이 필요한가?]
    │
    ├─ 예 → [순서가 중요한가?]
    │       │
    │       ├─ 예 → [빈번한 삽입/삭제?]
    │       │       │
    │       │       ├─ 예, 앞/뒤 → TDoubleLinkedList<T>
    │       │       │              (O(1) 삽입/삭제, 양방향 순회)
    │       │       │
    │       │       ├─ 예, 중간 → TSparseArray<T>
    │       │       │            (빈 슬롯 재사용, 인덱스 안정성)
    │       │       │
    │       │       └─ 아니오 → TArray<T>  ★ 기본 선택
    │       │                   (연속 메모리, 캐시 친화적)
    │       │
    │       └─ 아니오 → [중복 허용?]
    │               │
    │               ├─ 예 → TArray<T> (정렬 후 이진 탐색)
    │               │
    │               └─ 아니오 → TSet<T>
    │                           (O(1) 존재 확인, 중복 없음)
    │
    └─ 키-값 매핑? → [정렬 필요?]
            │
            ├─ 예 → TSortedMap<K, V>
            │       (이진 트리, O(log n) 탐색, 순회 정렬됨)
            │
            └─ 아니오 → TMap<K, V>  ★ 기본 선택
                        (해시 테이블, O(1) 평균 탐색)
```

### 컨테이너 비교 테이블

| 컨테이너 | 삽입 | 삭제 | 탐색 | 메모리 | 사용 사례 |
|----------|------|------|------|--------|-----------|
| **TArray<T>** | O(1) 끝<br>O(n) 중간 | O(1) 끝<br>O(n) 중간 | O(1) 인덱스<br>O(n) 값 | 연속 | ✅ 기본 선택, 순차 접근, 정렬 가능 |
| **TSet<T>** | O(1) 평균 | O(1) 평균 | O(1) 평균 | 비연속 | ✅ 중복 없음, 빠른 존재 확인 |
| **TMap<K,V>** | O(1) 평균 | O(1) 평균 | O(1) 평균 | 비연속 | ✅ 키-값 매핑, 빠른 조회 |
| **TSortedMap<K,V>** | O(log n) | O(log n) | O(log n) | 비연속 | 정렬된 순회, 범위 쿼리 |
| **TSparseArray<T>** | O(1) | O(1) | O(1) 인덱스 | 비연속 | 빈번한 삭제, 인덱스 안정성 |
| **TStaticArray<T,N>** | - | - | O(1) | 스택 | 컴파일 타임 크기, 스택 할당 |
| **TChunkedArray<T>** | O(1) | ❌ 불가 | O(1) 인덱스 | 청크 | 재할당 없이 확장, 포인터 안정성 |
| **TDoubleLinkedList<T>** | O(1) | O(1) | O(n) | 비연속 | 빈번한 삽입/삭제, 양방향 순회 |
| **TCircularQueue<T>** | O(1) | O(1) | - | 고정 링 버퍼 | FIFO, 고정 크기 큐 |
| **TLruCache<K,V>** | O(1) | O(1) LRU | O(1) | 제한된 | 캐시, 자동 제거 |
| **TBitArray** | - | - | O(1) | 1 bit/elem | 불리언 플래그, 메모리 절약 |

### 시나리오별 추천

#### 1. 동적 배열 (대부분의 경우)

```
사용: 게임 오브젝트 목록, 컴포넌트 배열, 이벤트 큐
선택: TArray<T>

장점:
  ✅ 캐시 친화적 (연속 메모리)
  ✅ 빠른 순차 접근 (O(1) 인덱싱)
  ✅ 정렬 가능 (Sort, StableSort)
  ✅ 범위 기반 for 지원

단점:
  ❌ 중간 삽입/삭제 느림 (O(n) 이동)
  ❌ 재할당 시 메모리 복사
  ❌ 포인터 무효화 (재할당 시)

코드 예시:
TArray<AActor*> Actors;
Actors.Add(NewActor);         // O(1) 끝에 추가
Actors.Remove(OldActor);       // O(n) 찾고 제거
Actors.Sort([](AActor* A, AActor* B) {
    return A->GetName() < B->GetName();
});
```

#### 2. 키-값 매핑 (조회 테이블)

```
사용: 액터 ID → 액터, 플레이어 이름 → 점수, 에셋 경로 → 로드된 에셋
선택: TMap<K, V>

장점:
  ✅ O(1) 평균 조회
  ✅ O(1) 삽입/삭제
  ✅ 빠른 존재 확인 (Contains)

단점:
  ❌ 메모리 오버헤드 (해시 테이블)
  ❌ 순회 순서 불확정
  ❌ 해시 충돌 가능 (드물게 O(n))

코드 예시:
TMap<FString, int32> PlayerScores;
PlayerScores.Add(TEXT("Alice"), 1000);
int32* Score = PlayerScores.Find(TEXT("Alice"));
if (Score)
{
    UE_LOG(LogTemp, Log, TEXT("Score: %d"), *Score);
}
```

#### 3. 중복 없는 집합 (고유 아이템)

```
사용: 게임플레이 태그, 활성 버프 목록, 방문한 레벨
선택: TSet<T>

장점:
  ✅ O(1) 존재 확인
  ✅ 자동 중복 제거
  ✅ 집합 연산 (Intersect, Union, Difference)

단점:
  ❌ 인덱스 접근 불가
  ❌ 순회 순서 불확정

코드 예시:
TSet<FName> ActiveBuffs;
ActiveBuffs.Add("Speed");
ActiveBuffs.Add("Speed");  // 중복 무시됨
if (ActiveBuffs.Contains("Speed"))
{
    // 속도 증가 로직
}
```

#### 4. 빈번한 삽입/삭제 (중간 위치)

```
사용: 파티클 시스템, 동적 네트워크 연결, 액티브 사운드
선택: TSparseArray<T>

장점:
  ✅ O(1) 삽입/삭제 (빈 슬롯 재사용)
  ✅ 인덱스 안정성 (삭제 후에도 인덱스 유효)
  ✅ 빠른 순회 (빈 슬롯 스킵)

단점:
  ❌ 메모리 단편화 (빈 슬롯)
  ❌ 메모리 오버헤드 (비트맵)

코드 예시:
TSparseArray<FParticle> Particles;
int32 Index = Particles.Add(NewParticle);  // 빈 슬롯 재사용
// ... 나중에
Particles.RemoveAt(Index);  // O(1) 삭제, 인덱스 재사용 가능
```

#### 5. FIFO 큐 (고정 크기)

```
사용: 네트워크 패킷 버퍼, 오디오 샘플 링 버퍼, 입력 이벤트 큐
선택: TCircularQueue<T>

장점:
  ✅ O(1) Enqueue/Dequeue
  ✅ 메모리 효율 (재할당 없음)
  ✅ 캐시 친화적 (연속 메모리)

단점:
  ❌ 고정 크기 (사전 할당 필요)
  ❌ 가득 찼을 때 Enqueue 실패

코드 예시:
TCircularQueue<FInputEvent> InputQueue(100);  // 100개 고정
InputQueue.Enqueue(NewEvent);
FInputEvent Event;
if (InputQueue.Dequeue(Event))
{
    ProcessEvent(Event);
}
```

#### 6. LRU 캐시 (자동 제거)

```
사용: 텍스처 캐시, 메시 LOD 캐시, 계산 결과 캐싱
선택: TLruCache<K, V>

장점:
  ✅ 자동 용량 관리 (오래된 항목 제거)
  ✅ O(1) 조회 및 삽입
  ✅ 메모리 제한 보장

단점:
  ❌ 메모리 오버헤드 (LRU 체인)
  ❌ 복잡한 구현

코드 예시:
TLruCache<FString, UTexture2D*> TextureCache(100);  // 최대 100개
TextureCache.Add(Path, LoadedTexture);
UTexture2D** Cached = TextureCache.Find(Path);
// 용량 초과 시 가장 오래된 항목 자동 제거
```

### 성능 비교: 실측 벤치마크

```
[100만 개 정수 삽입 벤치마크]

TArray::Add():               ~15 ms   (연속 메모리, 재할당 포함)
TSet::Add():                 ~85 ms   (해싱 + 충돌 처리)
TMap::Add():                 ~95 ms   (해싱 + 키-값 쌍)
TSparseArray::Add():         ~45 ms   (비트맵 + 빈 슬롯 탐색)

[100만 개 정수 탐색 벤치마크]

TArray::Find():              ~120 ms  (O(n) 선형 탐색)
TArray (정렬 후 Algo::BinarySearch()): ~0.5 ms  (O(log n))
TSet::Contains():            ~8 ms    (O(1) 해시 조회)
TMap::Find():                ~10 ms   (O(1) 해시 조회)

결론:
  • 순차 접근: TArray 압도적 우위
  • 빠른 조회: TSet/TMap 필수
  • 빈번한 삽입/삭제: TSparseArray 또는 TDoubleLinkedList
```

### 메모리 오버헤드 비교

```
[1000개 int32(4 bytes) 저장 시 메모리 사용량]

TArray<int32>:               ~4 KB   (1000 × 4 bytes)
TSet<int32>:                 ~12 KB  (해시 테이블 + 메타데이터)
TMap<int32, int32>:          ~16 KB  (키-값 쌍 + 해시 테이블)
TSparseArray<int32>:         ~8 KB   (데이터 + 비트맵)
TBitArray:                   ~125 bytes (1000 bits)

결론:
  • 메모리 절약: TArray > TSparseArray > TSet > TMap
  • 불리언 데이터: TBitArray (1 bit/element)
```

---

## 💡 팁 & 참고자료

### 성능 팁

1. **TLinkedList보다 TArray 선호** - 더 나은 캐시 지역성
2. **용량 예약** - 최종 크기를 알 때 `TArray::Reserve()` 사용
3. **빈번한 비교에는 FName** - FString 비교보다 훨씬 빠름
4. **핫 패스에서 FString 피하기** - 읽기 전용 연산에는 FStringView 사용
5. **대규모 데이터셋에 ParallelFor 사용** - 자동 작업 분배
6. **할당 프로파일링** - Memory Insights로 할당 핫스팟 식별

### 일반적인 패턴

**컨테이너 순회:**
```cpp
// 범위 기반 for (권장)
for (const FString& Name : Names) { }

// 인덱스 기반
for (int32 i = 0; i < Array.Num(); ++i) { }

// 이터레이터 (드물게)
for (auto It = Map.CreateIterator(); It; ++It) { }
```

**문자열 포맷팅:**
```cpp
FString Message = FString::Printf(TEXT("체력: %d/%d"), Current, Max);
FString Path = FPaths::Combine(Dir, Filename);
FString Upper = Name.ToUpper();
```

**스마트 포인터 사용:**
```cpp
// 공유 소유권
TSharedPtr<FMyData> Data = MakeShared<FMyData>();
TSharedRef<FMyData> DataRef = MakeShareable(new FMyData());

// 약한 참조
TWeakPtr<FMyData> WeakData = Data;
if (TSharedPtr<FMyData> Pinned = WeakData.Pin())
{
    // 안전하게 사용 가능
}
```

### 모듈 격리 규칙

1. **Core에서 CoreUObject를 절대 인클루드하지 말 것** - 엄격한 의존성 순서
2. **전방 선언 사용** - 헤더 의존성 최소화
3. ***_API 익스포트를 최소로 유지** - 필요한 것만 익스포트
4. **순환 모듈 의존성 금지** - 빌드 시스템이 거부함

### 디버깅 팁

- **LLM 활성화:** 메모리 추적을 위한 `-llm` 커맨드 라인 플래그
- **Visual Studio Natvis:** Core는 TArray, TMap 등에 대한 커스텀 시각화를 제공
- **로그 상세도:** 상세 로그를 위한 `-LogCmds="LogTemp Verbose"`
- **메모리 스톰핑:** 버퍼 오버런을 잡기 위해 `MallocStomp` 사용

---

### 🔗 참고자료

- [Unreal Engine C++ API - Core Module](https://docs.unrealengine.com/5.3/API/Runtime/Core/)
- [Epic C++ Coding Standard](https://docs.unrealengine.com/epic-cplusplus-coding-standard-for-unreal-engine/)
- [Core Module Source](Engine/Source/Runtime/Core/)
- [Unreal Smart Pointers](https://docs.unrealengine.com/smart-pointers-in-unreal-engine/)
- [Logging in Unreal Engine](https://docs.unrealengine.com/logging-in-unreal-engine/)

---

> 📅 생성: 2025-10-17 — 초기 Core 모듈 개요
