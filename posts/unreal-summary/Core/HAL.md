---
title: "하드웨어 추상화 레이어 (Hardware Abstraction Layer - HAL)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Core"
tags: ["unreal", "Core"]
---
# 하드웨어 추상화 레이어 (Hardware Abstraction Layer - HAL)

## 🧭 개요

**HAL (Hardware Abstraction Layer)**는 언리얼 엔진의 플랫폼 독립성을 제공하는 Core 모듈의 핵심 구성 요소입니다. 다양한 운영체제, CPU 아키텍처, 하드웨어 플랫폼에서 동일한 API로 작동하도록 추상화 계층을 제공합니다.

**핵심 역할:**
- **플랫폼 추상화** - Windows, Mac, Linux, iOS, Android, 콘솔 통합
- **메모리 관리** - 플랫폼별 메모리 API 통합
- **파일 시스템** - 플랫폼별 파일 I/O 통합
- **스레딩** - 플랫폼별 스레드 API 통합
- **시간 관리** - 고해상도 타이머 및 시간 함수
- **프로세스 관리** - 프로세스/DLL 로드 및 관리
- **원자적 연산** - Lock-free 프로그래밍 지원

**지원 플랫폼:**
- **Desktop:** Windows (x64, ARM64), Mac (x64, ARM64), Linux (x64, ARM64)
- **Mobile:** iOS, Android (ARM, ARM64, x86, x64)
- **Console:** PlayStation, Xbox, Nintendo Switch
- **VR/XR:** Meta Quest, PSVR, SteamVR, Apple Vision Pro

**모듈 위치:** `Engine/Source/Runtime/Core/Public/HAL/`

**핵심 파일:**
- `Platform.h` - 플랫폼 감지 및 설정
- `PlatformMemory.h` - 메모리 API
- `PlatformProcess.h` - 프로세스 API
- `PlatformTime.h` - 시간 API
- `PlatformFile.h` - 파일 시스템 API
- `PlatformAtomics.h` - 원자적 연산
- `PlatformMisc.h` - 기타 유틸리티

**엔진 버전:** Unreal Engine 5.7 (2025년 기준)

---

## 🧱 구조

### HAL 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Hardware Abstraction Layer (HAL)                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [게임 코드/엔진 코드]                                                   │
│      │                                                                  │
│      │ 플랫폼 독립적 API 호출                                           │
│      │ - FPlatformMemory::Malloc()                                     │
│      │ - FPlatformFile::OpenRead()                                     │
│      │ - FPlatformTime::Seconds()                                      │
│      ↓                                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │              Generic Platform (기본 구현)                        │  │
│  │  GenericPlatformMemory, GenericPlatformFile, ...                 │  │
│  │  - 플랫폼 공통 로직                                               │  │
│  │  - 기본 구현 (fallback)                                          │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│      ↓ 상속 및 오버라이드                                               │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │           Platform-Specific Implementation                       │  │
│  │  (플랫폼별 구현)                                                  │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │  Windows:                                                        │  │
│  │    - WindowsPlatformMemory (VirtualAlloc/VirtualFree)            │  │
│  │    - WindowsPlatformFile (CreateFile/ReadFile/WriteFile)         │  │
│  │    - WindowsPlatformTime (QueryPerformanceCounter)               │  │
│  │                                                                  │  │
│  │  Linux:                                                          │  │
│  │    - LinuxPlatformMemory (mmap/munmap)                           │  │
│  │    - LinuxPlatformFile (open/read/write)                         │  │
│  │    - LinuxPlatformTime (clock_gettime)                           │  │
│  │                                                                  │  │
│  │  Mac:                                                            │  │
│  │    - MacPlatformMemory (mmap/munmap)                             │  │
│  │    - MacPlatformFile (open/read/write)                           │  │
│  │    - MacPlatformTime (mach_absolute_time)                        │  │
│  │                                                                  │  │
│  │  iOS/Android:                                                    │  │
│  │    - 모바일 최적화 구현                                           │  │
│  │    - 메모리 압력 모니터링                                         │  │
│  │    - 배터리 절약 모드                                             │  │
│  │                                                                  │  │
│  │  Console (PlayStation/Xbox/Switch):                              │  │
│  │    - 콘솔별 SDK API 래핑                                          │  │
│  │    - 플랫폼 인증 요구사항 충족                                    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│      ↓ OS/Hardware API 호출                                             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                OS/Hardware Layer                                 │  │
│  │  - Windows API (kernel32.dll, user32.dll)                        │  │
│  │  - POSIX API (libc, libpthread)                                  │  │
│  │  - Console SDK                                                   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 플랫폼 감지 매크로

**📂 위치:** `Engine/Source/Runtime/Core/Public/HAL/Platform.h:10-67`

```cpp
// 플랫폼 감지 매크로 (컴파일 타임)
#if PLATFORM_WINDOWS
    // Windows 전용 코드
#elif PLATFORM_MAC
    // Mac 전용 코드
#elif PLATFORM_LINUX
    // Linux 전용 코드
#elif PLATFORM_IOS
    // iOS 전용 코드
#elif PLATFORM_ANDROID
    // Android 전용 코드
#endif

// 플랫폼 그룹 매크로
#if PLATFORM_DESKTOP      // Windows, Mac, Linux
#if PLATFORM_MOBILE       // iOS, Android
#if PLATFORM_APPLE        // Mac, iOS, tvOS, visionOS
#if PLATFORM_UNIX         // Linux, Mac, iOS, Android
#if PLATFORM_MICROSOFT    // Windows, Xbox

// CPU 아키텍처
#if PLATFORM_CPU_X86_FAMILY   // x86, x64
#if PLATFORM_CPU_ARM_FAMILY   // ARM, ARM64

// 비트 수
#if PLATFORM_64BITS       // 64비트
#else                     // 32비트
#endif

// 엔디안
#if PLATFORM_LITTLE_ENDIAN    // Little Endian (대부분 플랫폼)
#if PLATFORM_BIG_ENDIAN       // Big Endian (일부 콘솔)
```

### 플랫폼별 구현 패턴

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  플랫폼별 헤더 include 패턴                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [1. Platform.h - 플랫폼 감지]                                          │
│  ────────────────────────────────────────────────────────────────────  │
│  #include "HAL/Platform.h"                                              │
│      ↓                                                                  │
│  // 플랫폼 자동 감지 (_WIN32, __linux__, __APPLE__ 등)                  │
│  #define PLATFORM_WINDOWS 1  (또는 0)                                   │
│  #define PLATFORM_LINUX 1    (또는 0)                                   │
│  ...                                                                    │
│                                                                         │
│  [2. Generic 헤더 - 기본 구현]                                          │
│  ────────────────────────────────────────────────────────────────────  │
│  #include "GenericPlatform/GenericPlatformMemory.h"                     │
│                                                                         │
│  struct FGenericPlatformMemory                                          │
│  {                                                                      │
│      static void* BinnedAllocFromOS(SIZE_T Size)                        │
│      {                                                                  │
│          // 기본 구현 (또는 순수 가상)                                   │
│          return nullptr;                                                │
│      }                                                                  │
│  };                                                                     │
│                                                                         │
│  [3. 플랫폼별 헤더 - 특화 구현]                                         │
│  ────────────────────────────────────────────────────────────────────  │
│  #if PLATFORM_WINDOWS                                                   │
│      #include "Windows/WindowsPlatformMemory.h"                         │
│                                                                         │
│      struct FWindowsPlatformMemory : public FGenericPlatformMemory      │
│      {                                                                  │
│          static void* BinnedAllocFromOS(SIZE_T Size)                    │
│          {                                                              │
│              return VirtualAlloc(nullptr, Size,                         │
│                  MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);             │
│          }                                                              │
│      };                                                                 │
│                                                                         │
│      typedef FWindowsPlatformMemory FPlatformMemory;                    │
│  #elif PLATFORM_LINUX                                                   │
│      #include "Linux/LinuxPlatformMemory.h"                             │
│                                                                         │
│      struct FLinuxPlatformMemory : public FGenericPlatformMemory        │
│      {                                                                  │
│          static void* BinnedAllocFromOS(SIZE_T Size)                    │
│          {                                                              │
│              return mmap(nullptr, Size, PROT_READ | PROT_WRITE,         │
│                  MAP_PRIVATE | MAP_ANON, -1, 0);                        │
│          }                                                              │
│      };                                                                 │
│                                                                         │
│      typedef FLinuxPlatformMemory FPlatformMemory;                      │
│  #endif                                                                 │
│                                                                         │
│  [4. 통합 헤더 - 플랫폼 독립적 인터페이스]                              │
│  ────────────────────────────────────────────────────────────────────  │
│  #include "HAL/PlatformMemory.h"                                        │
│      ↓                                                                  │
│  // FPlatformMemory가 자동으로 플랫폼별 타입으로 typedef됨               │
│  // Windows: FPlatformMemory = FWindowsPlatformMemory                   │
│  // Linux:   FPlatformMemory = FLinuxPlatformMemory                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔬 설계 철학

### 왜 HAL이 필요한가?

```cpp
// ❌ 플랫폼별 코드 직접 사용 - 유지보수 악몽

#ifdef _WIN32
    #include <windows.h>
    void* memory = VirtualAlloc(nullptr, size, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
#elif defined(__linux__)
    #include <sys/mman.h>
    void* memory = mmap(nullptr, size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
#elif defined(__APPLE__)
    #include <sys/mman.h>
    void* memory = mmap(nullptr, size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
#elif defined(__ANDROID__)
    // Android 전용 처리
#elif defined(__PS5__)
    // PlayStation 5 SDK
#endif

// 문제점:
// - 모든 코드에 #ifdef 난무
// - 플랫폼 추가 시 모든 코드 수정
// - 테스트 어려움
// - 가독성 최악
```

```cpp
// ✅ HAL 사용 - 플랫폼 독립적, 유지보수 용이

void* memory = FPlatformMemory::BinnedAllocFromOS(size);

// 장점:
// - 플랫폼 독립적 코드
// - 새 플랫폼 추가 시 HAL 구현만 추가
// - 테스트 용이 (Mock 가능)
// - 가독성 우수
// - 컴파일 타임 최적화 (inline)
```

### HAL 설계 원칙

| 원칙 | 설명 | 예시 |
|------|------|------|
| **1. Zero-Cost Abstraction** | 추상화로 인한 성능 손실 없음 | 모든 함수 `FORCEINLINE` |
| **2. 컴파일 타임 분기** | 런타임 분기 없음 | `#if PLATFORM_WINDOWS` |
| **3. Generic 기본 구현** | 공통 로직 중복 제거 | `FGenericPlatformMemory` |
| **4. 플랫폼별 최적화** | 각 플랫폼 최적 API 사용 | Windows: VirtualAlloc, Linux: mmap |
| **5. 일관된 인터페이스** | 모든 플랫폼 동일 API | `FPlatformMemory::Malloc()` |

---

## 🧩 주요 API

### FPlatformMemory - 메모리 관리

**📂 위치:** `Engine/Source/Runtime/Core/Public/GenericPlatform/GenericPlatformMemory.h:85-149`

```cpp
#include "HAL/PlatformMemory.h"

// 메모리 통계 조회
FPlatformMemoryStats Stats = FPlatformMemory::GetStats();

UE_LOG(LogTemp, Log, TEXT("Total Physical: %llu MB"),
    Stats.TotalPhysical / 1024 / 1024);
UE_LOG(LogTemp, Log, TEXT("Available Physical: %llu MB"),
    Stats.AvailablePhysical / 1024 / 1024);
UE_LOG(LogTemp, Log, TEXT("Used Physical: %llu MB"),
    Stats.UsedPhysical / 1024 / 1024);

// 메모리 상수 (실행 중 변하지 않음)
FPlatformMemoryConstants Constants = FPlatformMemory::GetConstants();
UE_LOG(LogTemp, Log, TEXT("Page Size: %zu bytes"), Constants.PageSize);
UE_LOG(LogTemp, Log, TEXT("OS Allocation Granularity: %zu bytes"),
    Constants.OsAllocationGranularity);

// 가상 메모리 할당
SIZE_T Size = 1024 * 1024;  // 1 MB
void* Memory = FPlatformMemory::BinnedAllocFromOS(Size);
if (Memory)
{
    // 사용
    FPlatformMemory::BinnedFreeToOS(Memory, Size);
}

// 페이지 보호 설정
FPlatformMemory::PageProtect(Memory, Size,
    /*bCanRead=*/ true,
    /*bCanWrite=*/ false);  // Read-only
```

**메모리 압력 감지 (모바일):**

```cpp
// 메모리 압력 상태 확인
FPlatformMemoryStats Stats = FPlatformMemory::GetStats();
auto PressureStatus = Stats.GetMemoryPressureStatus();

switch (PressureStatus)
{
case FPlatformMemoryStats::EMemoryPressureStatus::Nominal:
    // 정상
    break;

case FPlatformMemoryStats::EMemoryPressureStatus::Warning:
    // 경고 - 캐시 비우기
    UE_LOG(LogTemp, Warning, TEXT("Memory pressure warning!"));
    FlushRenderingCommands();
    break;

case FPlatformMemoryStats::EMemoryPressureStatus::Critical:
    // 위험 - 적극적 메모리 해제
    UE_LOG(LogTemp, Error, TEXT("Memory pressure critical!"));
    GEngine->TrimMemory();
    break;
}
```

### FPlatformTime - 시간 관리

**📂 위치:** `Engine/Source/Runtime/Core/Public/HAL/PlatformTime.h`

```cpp
#include "HAL/PlatformTime.h"

// 현재 시각 (초, double 정밀도)
double CurrentTime = FPlatformTime::Seconds();

// CPU 사이클 (고해상도)
uint64 Cycles = FPlatformTime::Cycles64();

// 프로파일링 예시
double StartTime = FPlatformTime::Seconds();
// ... 작업 수행 ...
double EndTime = FPlatformTime::Seconds();
double ElapsedMs = (EndTime - StartTime) * 1000.0;
UE_LOG(LogTemp, Log, TEXT("Elapsed: %.2f ms"), ElapsedMs);

// 사이클 → 초 변환
uint64 StartCycles = FPlatformTime::Cycles64();
// ... 작업 수행 ...
uint64 EndCycles = FPlatformTime::Cycles64();
double ElapsedSeconds = FPlatformTime::ToSeconds64(EndCycles - StartCycles);

// 시스템 시간
FPlatformTime::SystemTime(
    /*Year=*/ Year,
    /*Month=*/ Month,
    /*DayOfWeek=*/ DayOfWeek,
    /*Day=*/ Day,
    /*Hour=*/ Hour,
    /*Min=*/ Min,
    /*Sec=*/ Sec,
    /*MSec=*/ MSec
);

// UTC 시간
FPlatformTime::UtcTime(Year, Month, DayOfWeek, Day, Hour, Min, Sec, MSec);
```

### FPlatformProcess - 프로세스 관리

**📂 위치:** `Engine/Source/Runtime/Core/Public/HAL/PlatformProcess.h`

```cpp
#include "HAL/PlatformProcess.h"

// 현재 프로세스 정보
uint32 ProcessId = FPlatformProcess::GetCurrentProcessId();
UE_LOG(LogTemp, Log, TEXT("Process ID: %u"), ProcessId);

// 프로세스 실행
FString Program = TEXT("notepad.exe");
FString Args = TEXT("C:\\test.txt");
FProcHandle Handle = FPlatformProcess::CreateProc(
    *Program,
    *Args,
    /*bLaunchDetached=*/ false,
    /*bLaunchHidden=*/ false,
    /*bLaunchReallyHidden=*/ false,
    /*OutProcessID=*/ nullptr,
    /*PriorityModifier=*/ 0,
    /*OptionalWorkingDirectory=*/ nullptr,
    /*PipeWriteChild=*/ nullptr
);

if (Handle.IsValid())
{
    // 프로세스 대기
    FPlatformProcess::WaitForProc(Handle);

    // 종료 코드 확인
    int32 ReturnCode;
    if (FPlatformProcess::GetProcReturnCode(Handle, &ReturnCode))
    {
        UE_LOG(LogTemp, Log, TEXT("Return code: %d"), ReturnCode);
    }

    // 핸들 닫기
    FPlatformProcess::CloseProc(Handle);
}

// DLL 로드
void* DllHandle = FPlatformProcess::GetDllHandle(TEXT("MyPlugin.dll"));
if (DllHandle)
{
    // 함수 포인터 가져오기
    typedef void (*MyFunctionPtr)();
    MyFunctionPtr MyFunc = (MyFunctionPtr)FPlatformProcess::GetDllExport(
        DllHandle,
        TEXT("MyFunction")
    );

    if (MyFunc)
    {
        MyFunc();
    }

    // DLL 언로드
    FPlatformProcess::FreeDllHandle(DllHandle);
}

// Sleep
FPlatformProcess::Sleep(0.016f);  // 16ms (60 FPS)

// 현재 스레드 ID
uint32 ThreadId = FPlatformProcess::GetCurrentThreadId();
```

### FPlatformFile - 파일 시스템

**📂 위치:** `Engine/Source/Runtime/Core/Public/HAL/PlatformFile.h`

```cpp
#include "HAL/FileManager.h"
#include "HAL/PlatformFileManager.h"

// 파일 매니저 가져오기
IPlatformFile& PlatformFile = FPlatformFileManager::Get().GetPlatformFile();

// 파일 존재 확인
FString FilePath = TEXT("C:/Test.txt");
bool bExists = PlatformFile.FileExists(*FilePath);

// 파일 크기
int64 FileSize = PlatformFile.FileSize(*FilePath);

// 디렉토리 순회
class FMyFileVisitor : public IPlatformFile::FDirectoryVisitor
{
public:
    TArray<FString> Files;

    virtual bool Visit(const TCHAR* FilenameOrDirectory, bool bIsDirectory) override
    {
        if (!bIsDirectory)
        {
            Files.Add(FilenameOrDirectory);
        }
        return true;  // 계속 순회
    }
};

FMyFileVisitor Visitor;
PlatformFile.IterateDirectory(TEXT("C:/MyFolder"), Visitor);
for (const FString& File : Visitor.Files)
{
    UE_LOG(LogTemp, Log, TEXT("Found: %s"), *File);
}

// 파일 읽기
IFileHandle* FileHandle = PlatformFile.OpenRead(*FilePath);
if (FileHandle)
{
    TArray<uint8> Data;
    Data.SetNum(FileHandle->Size());
    FileHandle->Read(Data.GetData(), Data.Num());

    delete FileHandle;
}

// 파일 쓰기
IFileHandle* WriteHandle = PlatformFile.OpenWrite(*FilePath);
if (WriteHandle)
{
    const char* Text = "Hello World";
    WriteHandle->Write((const uint8*)Text, strlen(Text));

    delete WriteHandle;
}

// 디렉토리 생성
PlatformFile.CreateDirectory(TEXT("C:/NewFolder"));

// 파일 삭제
PlatformFile.DeleteFile(*FilePath);

// 파일 복사
PlatformFile.CopyFile(TEXT("C:/Dest.txt"), TEXT("C:/Source.txt"));

// 파일 이동
PlatformFile.MoveFile(TEXT("C:/NewPath.txt"), TEXT("C:/OldPath.txt"));
```

### FPlatformAtomics - 원자적 연산

**📂 위치:** `Engine/Source/Runtime/Core/Public/HAL/PlatformAtomics.h`

```cpp
#include "HAL/PlatformAtomics.h"

// 원자적 증가/감소
int32 Counter = 0;
FPlatformAtomics::InterlockedIncrement(&Counter);  // Counter++
FPlatformAtomics::InterlockedDecrement(&Counter);  // Counter--

// 원자적 덧셈
FPlatformAtomics::InterlockedAdd(&Counter, 5);  // Counter += 5

// 원자적 교환 (Swap)
int32 OldValue = FPlatformAtomics::InterlockedExchange(&Counter, 100);
// Counter = 100, 반환값 = 이전 값

// CAS (Compare-And-Swap)
int32 Expected = 100;
int32 NewValue = 200;
int32 PrevValue = FPlatformAtomics::InterlockedCompareExchange(
    &Counter,
    NewValue,   // Counter = NewValue (조건 만족 시)
    Expected    // Counter == Expected 조건
);
// Counter == Expected이면 Counter = NewValue
// 반환값 = 원래 Counter 값

// Lock-free Queue 예시
class FLockFreeQueue
{
    alignas(PLATFORM_CACHE_LINE_SIZE) volatile int32 Head;
    alignas(PLATFORM_CACHE_LINE_SIZE) volatile int32 Tail;
    TArray<void*> Buffer;

public:
    FLockFreeQueue(int32 Size) : Head(0), Tail(0)
    {
        Buffer.SetNum(Size);
    }

    bool Enqueue(void* Item)
    {
        int32 CurrentTail = Tail;
        int32 NextTail = (CurrentTail + 1) % Buffer.Num();

        if (NextTail == Head)
            return false;  // Full

        Buffer[CurrentTail] = Item;
        FPlatformAtomics::InterlockedExchange(&Tail, NextTail);
        return true;
    }

    bool Dequeue(void*& Item)
    {
        int32 CurrentHead = Head;
        if (CurrentHead == Tail)
            return false;  // Empty

        Item = Buffer[CurrentHead];
        int32 NextHead = (CurrentHead + 1) % Buffer.Num();
        FPlatformAtomics::InterlockedExchange(&Head, NextHead);
        return true;
    }
};

// 64비트 원자 연산
int64 Counter64 = 0;
FPlatformAtomics::InterlockedIncrement(&Counter64);
FPlatformAtomics::InterlockedCompareExchange(&Counter64, NewVal, Expected);

// 포인터 원자 연산
void* Ptr = nullptr;
FPlatformAtomics::InterlockedExchangePtr(&Ptr, NewPtr);
FPlatformAtomics::InterlockedCompareExchangePointer(&Ptr, NewPtr, Expected);
```

### FPlatformMisc - 기타 유틸리티

**📂 위치:** `Engine/Source/Runtime/Core/Public/HAL/PlatformMisc.h`

```cpp
#include "HAL/PlatformMisc.h"

// CPU 코어 수
int32 NumCores = FPlatformMisc::NumberOfCores();
int32 NumCoresIncludingHT = FPlatformMisc::NumberOfCoresIncludingHyperthreads();

UE_LOG(LogTemp, Log, TEXT("CPU Cores: %d (HT: %d)"),
    NumCores, NumCoresIncludingHT);

// 플랫폼 이름
FString PlatformName = FPlatformMisc::GetPlatformName();  // "Windows", "Linux", "Mac"

// 컴퓨터 이름
FString ComputerName = FPlatformMisc::GetComputerName();

// 사용자 이름
FString UserName = FPlatformMisc::GetLoginId();

// OS 버전
FString OSVersion = FPlatformMisc::GetOSVersion();

// CPU 정보
FString CPUVendor = FPlatformMisc::GetCPUVendor();
FString CPUBrand = FPlatformMisc::GetCPUBrand();

// 클립보드
FPlatformMisc::ClipboardCopy(TEXT("Hello World"));
FString ClipboardText;
FPlatformMisc::ClipboardPaste(ClipboardText);

// 메시지 박스 (에디터/스탠드얼론)
EAppReturnType::Type Result = FPlatformMisc::MessageBoxExt(
    EAppMsgType::YesNo,
    TEXT("Do you want to continue?"),
    TEXT("Confirmation")
);

if (Result == EAppReturnType::Yes)
{
    // 예
}

// 환경 변수
FString Path = FPlatformMisc::GetEnvironmentVariable(TEXT("PATH"));

// 배터리 상태 (모바일)
int32 BatteryLevel = FPlatformMisc::GetBatteryLevel();  // 0-100
bool bIsCharging = FPlatformMisc::IsRunningOnBattery();
```

---

## 🎯 실전 예시

### 예시 1: 플랫폼별 최적화된 메모리 할당

```cpp
// 플랫폼 독립적 코드 - HAL이 자동으로 최적 API 선택

class FMyAllocator
{
public:
    void* Allocate(SIZE_T Size)
    {
        // Windows: VirtualAlloc
        // Linux/Mac: mmap
        // Console: 플랫폼 SDK API
        return FPlatformMemory::BinnedAllocFromOS(Size);
    }

    void Free(void* Ptr, SIZE_T Size)
    {
        FPlatformMemory::BinnedFreeToOS(Ptr, Size);
    }
};

// 사용
FMyAllocator Allocator;
void* Memory = Allocator.Allocate(1024 * 1024);  // 1 MB
// ... 사용 ...
Allocator.Free(Memory, 1024 * 1024);
```

### 예시 2: 고해상도 타이머로 프로파일링

```cpp
// 정밀한 성능 측정

class FScopedTimer
{
    double StartTime;
    FString Name;

public:
    FScopedTimer(const FString& InName)
        : Name(InName)
    {
        StartTime = FPlatformTime::Seconds();
    }

    ~FScopedTimer()
    {
        double EndTime = FPlatformTime::Seconds();
        double ElapsedMs = (EndTime - StartTime) * 1000.0;
        UE_LOG(LogTemp, Log, TEXT("%s: %.3f ms"), *Name, ElapsedMs);
    }
};

// 사용
void ExpensiveFunction()
{
    FScopedTimer Timer(TEXT("ExpensiveFunction"));

    // ... 시간이 오래 걸리는 작업 ...
}

// 출력: ExpensiveFunction: 45.234 ms
```

### 예시 3: 플랫폼 감지 및 분기

```cpp
// 플랫폼별 다른 동작

void InitializeSystem()
{
#if PLATFORM_WINDOWS
    // Windows 전용 초기화
    UE_LOG(LogTemp, Log, TEXT("Initializing Windows..."));
    InitializeDirectX();
    InitializeXInput();

#elif PLATFORM_MAC
    // Mac 전용 초기화
    UE_LOG(LogTemp, Log, TEXT("Initializing Mac..."));
    InitializeMetal();
    InitializeGameController();

#elif PLATFORM_LINUX
    // Linux 전용 초기화
    UE_LOG(LogTemp, Log, TEXT("Initializing Linux..."));
    InitializeVulkan();
    InitializeEvdev();

#elif PLATFORM_IOS || PLATFORM_ANDROID
    // 모바일 공통 초기화
    UE_LOG(LogTemp, Log, TEXT("Initializing Mobile..."));
    InitializeTouchInput();
    InitializeAccelerometer();

#else
    #error "Unknown platform"
#endif

    // 플랫폼 독립적 초기화
    InitializeAudio();
    InitializeNetwork();
}
```

### 예시 4: 외부 프로그램 실행 및 출력 캡처

```cpp
// 외부 프로그램 실행 및 출력 읽기

FString RunExternalProgram(const FString& Program, const FString& Args)
{
    void* ReadPipe = nullptr;
    void* WritePipe = nullptr;
    FPlatformProcess::CreatePipe(ReadPipe, WritePipe);

    FProcHandle Handle = FPlatformProcess::CreateProc(
        *Program,
        *Args,
        /*bLaunchDetached=*/ false,
        /*bLaunchHidden=*/ true,
        /*bLaunchReallyHidden=*/ true,
        /*OutProcessID=*/ nullptr,
        /*PriorityModifier=*/ 0,
        /*OptionalWorkingDirectory=*/ nullptr,
        WritePipe  // 출력을 Pipe로 리다이렉트
    );

    FString Output;
    if (Handle.IsValid())
    {
        // 프로세스 종료 대기하며 출력 읽기
        while (FPlatformProcess::IsProcRunning(Handle))
        {
            Output += FPlatformProcess::ReadPipe(ReadPipe);
            FPlatformProcess::Sleep(0.01f);
        }

        // 남은 출력 읽기
        Output += FPlatformProcess::ReadPipe(ReadPipe);

        FPlatformProcess::CloseProc(Handle);
    }

    FPlatformProcess::ClosePipe(ReadPipe, WritePipe);

    return Output;
}

// 사용
FString Result = RunExternalProgram(TEXT("git"), TEXT("status"));
UE_LOG(LogTemp, Log, TEXT("Git output:\n%s"), *Result);
```

### 예시 5: 크로스 플랫폼 파일 암호화

```cpp
// 플랫폼 독립적인 파일 암호화

bool EncryptFile(const FString& SourcePath, const FString& DestPath, const FString& Key)
{
    IPlatformFile& PlatformFile = FPlatformFileManager::Get().GetPlatformFile();

    // 파일 읽기
    IFileHandle* ReadHandle = PlatformFile.OpenRead(*SourcePath);
    if (!ReadHandle)
        return false;

    TArray<uint8> Data;
    Data.SetNum(ReadHandle->Size());
    ReadHandle->Read(Data.GetData(), Data.Num());
    delete ReadHandle;

    // 간단한 XOR 암호화 (예시)
    for (int32 i = 0; i < Data.Num(); ++i)
    {
        Data[i] ^= Key[i % Key.Len()];
    }

    // 파일 쓰기
    IFileHandle* WriteHandle = PlatformFile.OpenWrite(*DestPath);
    if (!WriteHandle)
        return false;

    WriteHandle->Write(Data.GetData(), Data.Num());
    delete WriteHandle;

    return true;
}

// 사용 (모든 플랫폼에서 동일)
EncryptFile(TEXT("C:/secret.txt"), TEXT("C:/secret.enc"), TEXT("MySecretKey"));
```

---

## 💡 최적화 및 팁

### 성능 모범 사례

```cpp
// ✅ 좋음: 플랫폼 상수는 한 번만 조회
const FPlatformMemoryConstants& Constants = FPlatformMemory::GetConstants();
for (int32 i = 0; i < 1000; ++i)
{
    SIZE_T PageSize = Constants.PageSize;  // 캐시된 값 사용
}

// ❌ 나쁨: 매번 함수 호출
for (int32 i = 0; i < 1000; ++i)
{
    SIZE_T PageSize = FPlatformMemory::GetConstants().PageSize;  // 반복 호출
}

// ✅ 좋음: Cycles64 사용 (가장 빠름)
uint64 Start = FPlatformTime::Cycles64();
// ... 작업 ...
uint64 End = FPlatformTime::Cycles64();
double Elapsed = FPlatformTime::ToSeconds64(End - Start);

// ⚠️ 덜 좋음: Seconds() 사용 (약간 느림)
double Start = FPlatformTime::Seconds();
// ... 작업 ...
double End = FPlatformTime::Seconds();

// ✅ 좋음: 파일 핸들 재사용
IFileHandle* Handle = PlatformFile.OpenRead(*Path);
for (int32 i = 0; i < 100; ++i)
{
    uint8 Byte;
    Handle->Read(&Byte, 1);
}
delete Handle;

// ❌ 나쁨: 매번 파일 열기/닫기
for (int32 i = 0; i < 100; ++i)
{
    IFileHandle* Handle = PlatformFile.OpenRead(*Path);
    uint8 Byte;
    Handle->Read(&Byte, 1);
    delete Handle;
}
```

### 일반적인 함정

```cpp
// ❌ 플랫폼별 헤더 직접 include
#include "Windows/WindowsPlatformMemory.h"  // 틀림!

// ✅ 플랫폼 독립적 헤더 include
#include "HAL/PlatformMemory.h"  // 올바름

// ❌ 32비트/64비트 가정
int* Ptr = (int*)0x12345678;  // 64비트에서 잘림!

// ✅ 포인터 크기 독립적
UPTRINT PtrAsInt = (UPTRINT)Ptr;  // 플랫폼별 정수 크기

// ❌ Endian 가정
uint32 Value = *(uint32*)Buffer;  // Big-endian에서 깨짐!

// ✅ Endian 독립적
uint32 Value = (Buffer[0] << 24) | (Buffer[1] << 16) |
               (Buffer[2] << 8)  | Buffer[3];

// ❌ 파일 경로 하드코딩
FString Path = TEXT("C:\\MyFolder\\File.txt");  // Windows만 작동

// ✅ 플랫폼 독립적 경로
FString Path = FPaths::Combine(FPaths::ProjectDir(), TEXT("MyFolder"), TEXT("File.txt"));
```

---

## 🔗 참고자료

- [Platform Development](https://docs.unrealengine.com/platform-development/)
- [HAL API Reference](https://docs.unrealengine.com/API/Runtime/Core/HAL/)
- [Cross-Platform Development](https://docs.unrealengine.com/cross-platform-development-in-unreal-engine/)
- [Platform.h Source](Engine/Source/Runtime/Core/Public/HAL/Platform.h)
- [PlatformMemory.h Source](Engine/Source/Runtime/Core/Public/HAL/PlatformMemory.h)
- [PlatformProcess.h Source](Engine/Source/Runtime/Core/Public/HAL/PlatformProcess.h)

---

> 📅 생성: 2025-10-27 — HAL (하드웨어 추상화 레이어) 문서화 (UE 5.7 검증)
