---
title: "엔진 초기화 시스템 (Engine Initialization System)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Core"
tags: ["unreal", "Core"]
---
# 엔진 초기화 시스템 (Engine Initialization System)

## 🧭 개요

**언리얼 엔진 초기화 시스템**은 엔진이 부팅되어 게임이 실행 가능한 상태가 되기까지의 전체 프로세스를 관리합니다. 이는 메모리 할당자 초기화부터 렌더링 시스템, 게임프레임워크 초기화까지 수백 개의 시스템을 순차적으로 시작합니다.

**핵심 구성 요소:**
- **FEngineLoop** - 엔진 루프 메인 클래스 (PreInit → Init → Tick → Exit)
- **FPreInitContext** - Pre-Initialization 컨텍스트
- **GuardedMain** - 예외 처리 래퍼
- **FModuleManager** - 모듈 로딩 관리자
- **GUObjectArray** - 오브젝트 시스템 초기화
- **GEngine** - 엔진 인스턴스 (UGameEngine 또는 UEditorEngine)

**주요 단계:**
1. **PreInit** - 기본 시스템 초기화 (Core, 파일시스템, 로깅)
2. **Init** - 엔진 시스템 초기화 (렌더링, 오디오, 물리)
3. **Tick** - 게임 루프 실행
4. **Exit** - 정리 및 종료

**부팅 시간 (대략적):**
- **에디터:** ~30-60초 (플러그인, 에셋 스캔 포함)
- **게임 (Development):** ~5-10초
- **게임 (Shipping):** ~2-5초

**모듈 위치:**
- `Engine/Source/Runtime/Launch/Private/LaunchEngineLoop.cpp`
- `Engine/Source/Runtime/Launch/Public/LaunchEngineLoop.h`

**엔진 버전:** Unreal Engine 5.6.1 (2025년 기준)

---

## 🧱 구조

### 엔진 초기화 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   Unreal Engine Initialization Flow                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [1] main() / WinMain()                                                 │
│      ↓                                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  GuardedMain()                       │                            │
│   │  - 예외 처리 래퍼                     │                            │
│   │  - 크래시 리포터 초기화               │                            │
│   └──────────────────────────────────────┘                            │
│      ↓                                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  GEngineLoop.PreInit(CmdLine)        │                            │
│   │  ═══════════════════════════════     │                            │
│   │                                      │                            │
│   │  [1-1] PreInitPreStartupScreen       │                            │
│   │  ┌────────────────────────────────┐  │                            │
│   │  │ • 커맨드 라인 파싱              │  │                            │
│   │  │ • FPlatformProcess 초기화       │  │                            │
│   │  │ • 작업 디렉터리 설정            │  │                            │
│   │  │ • 프로젝트 파일 로드            │  │                            │
│   │  │ • 플러그인 디스커버리           │  │                            │
│   │  │ • Core 모듈 로드               │  │                            │
│   │  └────────────────────────────────┘  │                            │
│   │         ↓                            │                            │
│   │  [1-2] PreInitPostStartupScreen      │                            │
│   │  ┌────────────────────────────────┐  │                            │
│   │  │ • CoreUObject 모듈 로드        │  │                            │
│   │  │ • GUObjectArray 초기화         │  │                            │
│   │  │ • FName 시스템 초기화          │  │                            │
│   │  │ • 리플렉션 시스템 등록         │  │                            │
│   │  │ • GC 초기화                    │  │                            │
│   │  │ • AssetRegistry 모듈 로드      │  │                            │
│   │  │ • Slate UI 시스템 초기화       │  │                            │
│   │  └────────────────────────────────┘  │                            │
│   └──────────────────────────────────────┘                            │
│      ↓                                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  GEngineLoop.Init()                  │                            │
│   │  ═══════════════════════════════     │                            │
│   │                                      │                            │
│   │  [2-1] 엔진 인스턴스 생성            │                            │
│   │  ┌────────────────────────────────┐  │                            │
│   │  │ • UGameEngine 또는              │  │                            │
│   │  │ • UEditorEngine 생성            │  │                            │
│   │  │ • GEngine 글로벌 설정           │  │                            │
│   │  └────────────────────────────────┘  │                            │
│   │         ↓                            │                            │
│   │  [2-2] 렌더링 시스템 초기화          │                            │
│   │  ┌────────────────────────────────┐  │                            │
│   │  │ • RHI (Render Hardware Interface) │                            │
│   │  │ • 렌더링 스레드 시작            │  │                            │
│   │  │ • 글로벌 셰이더 로드            │  │                            │
│   │  └────────────────────────────────┘  │                            │
│   │         ↓                            │                            │
│   │  [2-3] 서브시스템 초기화             │                            │
│   │  ┌────────────────────────────────┐  │                            │
│   │  │ • 물리 엔진 (Chaos)             │  │                            │
│   │  │ • 오디오 시스템                 │  │                            │
│   │  │ • 네트워킹 시스템               │  │                            │
│   │  │ • 온라인 서브시스템             │  │                            │
│   │  └────────────────────────────────┘  │                            │
│   │         ↓                            │                            │
│   │  [2-4] 월드 및 게임 초기화           │                            │
│   │  ┌────────────────────────────────┐  │                            │
│   │  │ • UWorld 생성                   │  │                            │
│   │  │ • GameInstance 생성             │  │                            │
│   │  │ • GameMode 스폰                 │  │                            │
│   │  │ • 레벨 로드                     │  │                            │
│   │  └────────────────────────────────┘  │                            │
│   └──────────────────────────────────────┘                            │
│      ↓                                                                  │
│   ┌──────────────────────────────────────┐                            │
│   │  GEngineLoop.Tick()                  │                            │
│   │  ═══════════════════════════════     │                            │
│   │  (게임 루프 - 매 프레임 반복)        │                            │
│   │                                      │                            │
│   │  • 입력 처리                         │                            │
│   │  • 게임 로직 (Tick)                  │                            │
│   │  • 물리 시뮬레이션                    │                            │
│   │  • 애니메이션 업데이트               │                            │
│   │  • 렌더링                            │                            │
│   │  • 오디오 믹싱                       │                            │
│   │  • 네트워크 업데이트                  │                            │
│   │  • GC (Garbage Collection)           │                            │
│   └──────────────────────────────────────┘                            │
│      ↓ (종료 시)                                                        │
│   ┌──────────────────────────────────────┐                            │
│   │  GEngineLoop.Exit()                  │                            │
│   │  ═══════════════════════════════     │                            │
│   │                                      │                            │
│   │  • 월드 정리                         │                            │
│   │  • GC 최종 실행                      │                            │
│   │  • 렌더링 스레드 종료                 │                            │
│   │  • 모듈 언로드                       │                            │
│   │  • 메모리 해제                       │                            │
│   └──────────────────────────────────────┘                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### FEngineLoop 클래스

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          FEngineLoop                                    │
│  (엔진 메인 루프 클래스)                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  📂 위치: Launch/Public/LaunchEngineLoop.h:48                           │
│                                                                         │
│  Public Methods:                                                        │
│    + PreInit(ArgC, ArgV[], AdditionalCommandline) : int32              │
│    + PreInit(CmdLine) : int32                                          │
│    + PreInitPreStartupScreen(CmdLine) : int32                          │
│    + PreInitPostStartupScreen(CmdLine) : int32                         │
│    + LoadPreInitModules()                                              │
│    + LoadCoreModules() : bool                                          │
│    + Init() : int32                                                    │
│    + Tick()                                                            │
│    + Exit()                                                            │
│                                                                         │
│  Static Methods:                                                        │
│    + AppInit() : bool                                                  │
│    + AppPreExit()                                                      │
│    + AppExit()                                                         │
│    + PostInitRHI()                                                     │
│                                                                         │
│  Private Members:                                                       │
│    - FrameTimes : TArray<float>                                        │
│    - TotalTickTime : double                                            │
│    - MaxTickTime : double                                              │
│    - MaxFrameCounter : uint64                                          │
│    - PendingCleanupObjects : FPendingCleanupObjects*                   │
│    - EngineService : FEngineService*                                   │
│    - PreInitContext : FPreInitContext                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### FPreInitContext 구조체

```cpp
// 📂 위치: LaunchEngineLoop.h:19
struct FPreInitContext
{
    bool bDumpEarlyConfigReads = false;
    bool bDumpEarlyPakFileReads = false;
    bool bForceQuitAfterEarlyReads = false;
    bool bWithConfigPatching = false;
    bool bHasEditorToken = false;
    bool bIsRegularClient = false;
    bool bIsPossiblyUnrecognizedCommandlet = false;

    FString Token;                      // 커맨드 라인 토큰
    FString CommandletCommandLine;      // 커맨들릿 전용 커맨드 라인

    FScopedSlowTask* SlowTaskPtr = nullptr;

#if WITH_ENGINE && !UE_SERVER
    TSharedPtr<FSlateRenderer> SlateRenderer;
#endif
};
```

---

## 🔬 설계 철학: 왜 단계별 초기화인가?

### 모놀리식 초기화의 한계

```cpp
// ❌ 모놀리식 초기화 - 불가능한 접근

void BadEngineInit()
{
    // 모든 것을 한 번에 초기화 시도
    InitMemory();
    InitCore();
    InitUObject();
    InitRendering();
    InitPhysics();
    InitAudio();
    // ...

    // ❌ 문제점:
    // 1. 의존성 순서 보장 불가
    // 2. 실패 시 어디서 멈춰야 할지 불명확
    // 3. 조건부 초기화 불가 (에디터 vs 게임)
    // 4. 디버깅 어려움
    // 5. 확장성 없음
}
```

```cpp
// ✅ 언리얼 방식 - 단계별 초기화

int main(int argc, char** argv)
{
    // [1] PreInit - 기본 시스템
    if (GEngineLoop.PreInit(argc, argv) != 0)
        return 1;  // 실패 시 즉시 종료

    // [2] Init - 엔진 시스템
    if (GEngineLoop.Init() != 0)
        return 1;

    // [3] Tick - 게임 루프
    while (!IsEngineExitRequested())
    {
        GEngineLoop.Tick();
    }

    // [4] Exit - 정리
    GEngineLoop.Exit();

    return 0;
}

// ✅ 장점:
// - 명확한 의존성 체인
// - 단계별 실패 처리
// - 조건부 초기화 가능
// - 디버깅 용이
// - 모듈화 가능
```

### 초기화 전략 비교

| 접근법 | 장점 | 단점 |
|-------|------|------|
| **모놀리식 초기화** | - 간단한 코드<br>- 빠른 구현 | - 의존성 관리 불가<br>- 확장 어려움<br>- 디버깅 어려움 |
| **지연 초기화 (Lazy Init)** | - 필요할 때만 초기화<br>- 초기 부팅 빠름 | - 런타임 오버헤드<br>- 예측 불가능한 성능<br>- 스레드 안전성 이슈 |
| **단계별 초기화 (Unreal)** | - ✅ 명확한 의존성<br>- ✅ 실패 처리 용이<br>- ✅ 모듈화<br>- ✅ 디버깅 용이 | - ⚠️ 복잡한 구조<br>- ⚠️ 초기 부팅 시간 |

**언리얼이 단계별 초기화를 선택한 이유:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│              단계별 초기화 선택의 핵심 이유                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 의존성 관리 (Dependency Management)                                 │
│     ─────────────────────────────────────────────────────────────────  │
│     • Core → CoreUObject → Engine → Game 순서 보장                      │
│     • FName 초기화 → GUObjectArray 초기화 → UClass 등록                 │
│     • 각 단계에서 필요한 시스템만 사용                                    │
│                                                                         │
│  2. 조건부 초기화 (Conditional Initialization)                          │
│     ─────────────────────────────────────────────────────────────────  │
│     • 에디터 vs 게임 vs 서버 vs 커맨들릿                                 │
│     • WITH_ENGINE, WITH_EDITOR 매크로 기반 조건 분기                     │
│     • 플러그인 선택적 로딩                                               │
│                                                                         │
│  3. 실패 처리 (Failure Handling)                                        │
│     ─────────────────────────────────────────────────────────────────  │
│     • 각 단계별 에러 코드 반환                                           │
│     • 실패 시 이전 단계 롤백 가능                                        │
│     • 명확한 에러 메시지 ("PreInit 실패" vs "Init 실패")                 │
│                                                                         │
│  4. 디버깅 및 프로파일링 (Debugging & Profiling)                        │
│     ─────────────────────────────────────────────────────────────────  │
│     • SCOPED_BOOT_TIMING 매크로로 각 단계 시간 측정                      │
│     • 브레이크포인트 설정 용이                                           │
│     • 부팅 병목 지점 쉽게 파악                                           │
│                                                                         │
│  5. 확장성 (Extensibility)                                              │
│     ─────────────────────────────────────────────────────────────────  │
│     • 플러그인이 초기화 단계에 훅 삽입 가능                               │
│     • FDelayedAutoRegisterHelper로 지연 등록                            │
│     • IModuleInterface::StartupModule() 콜백                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 주요 초기화 단계 상세

### 1. PreInit - 기본 시스템 초기화

**📂 위치:** `LaunchEngineLoop.cpp:1588` (PreInitPreStartupScreen)

```cpp
int32 FEngineLoop::PreInitPreStartupScreen(const TCHAR* CmdLine)
{
    SCOPED_BOOT_TIMING("FEngineLoop::PreInitPreStartupScreen");

    // [1-1] 로깅 시스템 초기화
    if (GLog)
    {
        GLog->SetCurrentThreadAsPrimaryThread();
    }

    // [1-2] 커맨드 라인 설정
    if (!FCommandLine::Set(CmdLine))
    {
        return -1;  // 실패
    }

    // [1-3] 작업 디렉터리 설정
    FPlatformProcess::SetCurrentWorkingDirectoryToBaseDir();

    // [1-4] 프로젝트 파일 로드
    FString GameProjectFilePathUnnormalized;
    if (LaunchSetGameName(CmdLine, GameProjectFilePathUnnormalized) == false)
    {
        return 1;
    }

    // [1-5] 플러그인 디스커버리
    IPluginManager::Get();  // 플러그인 매니저 초기화

    // [1-6] Core 모듈 로드
    if (!LoadCoreModules())
    {
        UE_LOG(LogInit, Fatal, TEXT("Failed to load Core modules"));
        return 1;
    }

    // [1-7] 파일 시스템 초기화
    FPlatformFileManager::Get();

    // [1-8] 설정 파일 로드
    GConfig->LoadGlobalIniFile(GEngineIni, TEXT("Engine"));

    return 0;  // 성공
}
```

**PreInitPostStartupScreen - CoreUObject 초기화**

**📂 위치:** `LaunchEngineLoop.cpp:3244`

```cpp
int32 FEngineLoop::PreInitPostStartupScreen(const TCHAR* CmdLine)
{
    SCOPED_BOOT_TIMING("FEngineLoop::PreInitPostStartupScreen");

    // [1-9] CoreUObject 모듈 로드
    FModuleManager::Get().LoadModule(TEXT("CoreUObject"));

    // [1-10] GUObjectArray 초기화
    // 모든 UObject가 등록될 글로벌 배열 생성
    // MaxObjects, MaxObjectsNotConsideredByGC 설정

    // [1-11] FName 시스템 초기화
    // 문자열 인터닝 테이블 준비

    // [1-12] UClass 자동 등록
    // StaticClass() 함수들이 UClass 생성 및 등록
    // CDO (Class Default Object) 생성

    // [1-13] GC 초기화
    // 가비지 컬렉션 시스템 준비

    // [1-14] AssetRegistry 모듈 로드
    FModuleManager::Get().LoadModule(TEXT("AssetRegistry"));

    // [1-15] Slate UI 시스템 초기화 (에디터/게임)
#if WITH_ENGINE && !UE_SERVER
    if (!IsRunningCommandlet())
    {
        if (!FSlateApplication::IsInitialized())
        {
            FSlateApplication::Create();
        }
    }
#endif

    return 0;
}
```

**PreInit 완료 시점:**
- ✅ Core 모듈 로드 완료
- ✅ CoreUObject 모듈 로드 완료
- ✅ GUObjectArray 초기화 완료
- ✅ 리플렉션 시스템 활성화
- ✅ AssetRegistry 준비
- ✅ 기본 UI 시스템 준비

---

### 2. Init - 엔진 시스템 초기화

**📂 위치:** `LaunchEngineLoop.cpp:4490`

```cpp
int32 FEngineLoop::Init()
{
    SCOPED_BOOT_TIMING("FEngineLoop::Init");

    // [2-1] 엔진 인스턴스 생성
    {
        SCOPED_BOOT_TIMING("Create GEngine");

        // 에디터 vs 게임 엔진 선택
#if WITH_EDITOR
        if (GIsEditor)
        {
            GEngine = GEditor = NewObject<UEditorEngine>(GetTransientPackage(), EngineClass);
        }
        else
#endif
        {
            GEngine = NewObject<UGameEngine>(GetTransientPackage(), EngineClass);
        }

        check(GEngine);

        // 엔진 초기화
        GEngine->Init(this);
    }

    // [2-2] 렌더링 시스템 초기화
    {
        SCOPED_BOOT_TIMING("InitializeRenderingCVarsCaching");

        // RHI (Render Hardware Interface) 초기화
        RHIInit();

        // 렌더링 스레드 시작
        StartRenderingThread();

        // 글로벌 셰이더 로드
        CompileGlobalShaderMap();
    }

    // [2-3] 물리 엔진 초기화
    {
        SCOPED_BOOT_TIMING("InitGamePhys");
        InitGamePhys();  // Chaos 물리 시스템
    }

    // [2-4] 오디오 시스템 초기화
    {
        SCOPED_BOOT_TIMING("InitAudio");

        if (FAudioDeviceManager* AudioDeviceManager = GEngine->GetAudioDeviceManager())
        {
            AudioDeviceManager->InitializeManager();
        }
    }

    // [2-5] 월드 생성 및 로드
    {
        SCOPED_BOOT_TIMING("LoadMap");

        // 초기 맵 로드
        FString Error;
        if (!GEngine->LoadMap(FWorldContext(), URL, nullptr, Error))
        {
            UE_LOG(LogLoad, Fatal, TEXT("Failed to load map: %s"), *Error);
        }
    }

    // [2-6] GameInstance 초기화
    {
        UGameInstance* GameInstance = GEngine->GameViewport->GetGameInstance();
        GameInstance->Init();
    }

    return 0;  // 성공
}
```

**Init 완료 시점:**
- ✅ GEngine 인스턴스 생성
- ✅ 렌더링 시스템 활성화
- ✅ 렌더링 스레드 실행 중
- ✅ 물리 엔진 준비
- ✅ 오디오 시스템 준비
- ✅ 초기 월드 로드
- ✅ GameInstance 생성

---

### 3. Tick - 게임 루프 실행

**📂 위치:** `LaunchEngineLoop.cpp:5337`

```cpp
void FEngineLoop::Tick()
{
    // [3-1] 프레임 시작 시간 기록
    const double StartTime = FPlatformTime::Seconds();

    // [3-2] 입력 처리
    FSlateApplication::Get().PumpMessages();
    FSlateApplication::Get().Tick();

    // [3-3] 엔진 틱 (게임 로직)
    GEngine->Tick(DeltaTime, bIdleMode);

    // 내부에서:
    // - UWorld::Tick() 호출
    //   - AActor::Tick() 모든 액터
    //   - UActorComponent::TickComponent() 모든 컴포넌트
    // - 물리 시뮬레이션 (FPhysScene::Tick)
    // - 애니메이션 업데이트
    // - 파티클 시스템

    // [3-4] 렌더링
    // 렌더링 스레드는 별도로 실행 중
    // 여기서는 렌더링 커맨드만 큐잉

    // [3-5] 오디오 믹싱
    // 오디오 스레드에서 비동기 실행

    // [3-6] 네트워킹
    if (GEngine->GetNetDriver())
    {
        GEngine->GetNetDriver()->TickDispatch(DeltaTime);
        GEngine->GetNetDriver()->PostTickDispatch();
    }

    // [3-7] GC (주기적)
    if (GEngine->ShouldCollectGarbage())
    {
        CollectGarbage(GARBAGE_COLLECTION_KEEPFLAGS);
    }

    // [3-8] 프레임 동기화
    const double EndTime = FPlatformTime::Seconds();
    const double FrameTime = EndTime - StartTime;

    // FPS 제한
    if (FrameTime < TargetFrameTime)
    {
        FPlatformProcess::Sleep(TargetFrameTime - FrameTime);
    }
}
```

**Tick 매 프레임 처리:**
- ✅ 입력 처리 (~0.1ms)
- ✅ 게임 로직 (1-5ms)
- ✅ 물리 시뮬레이션 (1-10ms)
- ✅ 애니메이션 업데이트 (1-5ms)
- ✅ 렌더링 큐잉 (0.5-2ms)
- ✅ 네트워크 업데이트 (0.1-1ms)
- ✅ GC (주기적, 1-50ms)

---

### 4. Exit - 정리 및 종료

**📂 위치:** `LaunchEngineLoop.cpp:4729`

```cpp
void FEngineLoop::Exit()
{
    SCOPED_BOOT_TIMING("FEngineLoop::Exit");

    // [4-1] 월드 정리
    if (GEngine)
    {
        for (const FWorldContext& Context : GEngine->GetWorldContexts())
        {
            if (Context.World())
            {
                Context.World()->BeginTearingDown();
            }
        }
    }

    // [4-2] GC 최종 실행
    CollectGarbage(GARBAGE_COLLECTION_KEEPFLAGS, true);  // Full GC

    // [4-3] 렌더링 스레드 종료
    StopRenderingThread();

    // [4-4] 오디오 종료
    if (GEngine && GEngine->GetAudioDeviceManager())
    {
        GEngine->GetAudioDeviceManager()->ShutdownAllAudioDevices();
    }

    // [4-5] 물리 종료
    TermGamePhys();

    // [4-6] 엔진 소멸
    if (GEngine)
    {
        GEngine->PreExit();
        GEngine = nullptr;
    }

    // [4-7] 모듈 언로드 (역순)
    FModuleManager::Get().UnloadModulesAtShutdown();

    // [4-8] CoreUObject 정리
    // GUObjectArray 정리
    // FName 테이블 정리

    // [4-9] Core 모듈 정리
    // 메모리 할당자, 로깅 시스템 등

    // [4-10] 플랫폼 종료
    FPlatformMisc::PlatformTearDown();
}
```

**Exit 완료 시점:**
- ✅ 모든 월드 소멸
- ✅ 모든 UObject 소멸
- ✅ 렌더링 스레드 종료
- ✅ 모든 모듈 언로드
- ✅ 메모리 해제
- ✅ 안전한 종료

---

## 💡 모듈 로딩 순서

### Core 모듈 로딩 체인

```
시간 순서 (Early → Late):
┌─────────────────────────────────────────────────────────────────────────┐
│                      Module Loading Chain                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [Phase 0: Platform Layer]                                              │
│  ┌──────────────────────────────────────┐                              │
│  │  - FPlatformProcess                  │  (OS 인터페이스)               │
│  │  - FPlatformMemory                   │  (메모리 할당자)               │
│  │  - FPlatformFile                     │  (파일 시스템)                 │
│  └──────────────────────────────────────┘                              │
│                  ↓                                                      │
│  [Phase 1: Core Module]                                                 │
│  ┌──────────────────────────────────────┐                              │
│  │  Core.dll / libCore.so               │                              │
│  │  ───────────────────────────────     │                              │
│  │  - FName                             │  (문자열 인터닝)               │
│  │  - TArray, TMap, TSet                │  (컨테이너)                   │
│  │  - FString                           │  (문자열)                     │
│  │  - FMath                             │  (수학)                       │
│  │  - Delegates                         │  (이벤트 시스템)               │
│  │  - FModuleManager                    │  (모듈 매니저)                 │
│  │  - Async/Threading                   │  (멀티스레드)                  │
│  └──────────────────────────────────────┘                              │
│                  ↓                                                      │
│  [Phase 2: CoreUObject Module]                                          │
│  ┌──────────────────────────────────────┐                              │
│  │  CoreUObject.dll / libCoreUObject.so │                              │
│  │  ───────────────────────────────────  │                              │
│  │  - GUObjectArray                     │  (오브젝트 배열)               │
│  │  - UObject                           │  (오브젝트 기본 클래스)        │
│  │  - UClass, FProperty                 │  (리플렉션)                   │
│  │  - GarbageCollector                  │  (GC)                         │
│  │  - Serialization (FArchive)          │  (직렬화)                     │
│  │  - FLinkerLoad/Save                  │  (패키지 로딩)                 │
│  └──────────────────────────────────────┘                              │
│                  ↓                                                      │
│  [Phase 3: Engine Module]                                               │
│  ┌──────────────────────────────────────┐                              │
│  │  Engine.dll / libEngine.so           │                              │
│  │  ───────────────────────────────────  │                              │
│  │  - UEngine (UGameEngine/UEditorEngine)│  (엔진 인스턴스)              │
│  │  - UWorld                            │  (월드)                       │
│  │  - AActor                            │  (액터)                       │
│  │  - UActorComponent                   │  (컴포넌트)                   │
│  │  - GameFramework                     │  (게임 프레임워크)             │
│  │  - Rendering                         │  (렌더링)                     │
│  │  - Physics (Chaos)                   │  (물리)                       │
│  │  - Audio                             │  (오디오)                     │
│  │  - Networking                        │  (네트워킹)                   │
│  └──────────────────────────────────────┘                              │
│                  ↓                                                      │
│  [Phase 4: Game Module]                                                 │
│  ┌──────────────────────────────────────┐                              │
│  │  MyGame.dll / libMyGame.so           │                              │
│  │  ───────────────────────────────────  │                              │
│  │  - UMyGameInstance                   │  (게임 인스턴스)               │
│  │  - AMyGameMode                       │  (게임 모드)                   │
│  │  - AMyCharacter                      │  (캐릭터)                     │
│  │  - Custom Gameplay                   │  (게임 로직)                   │
│  └──────────────────────────────────────┘                              │
│                  ↓                                                      │
│  [Phase 5: Plugins (Optional)]                                          │
│  ┌──────────────────────────────────────┐                              │
│  │  - EnhancedInput.dll                 │                              │
│  │  - OnlineSubsystem.dll               │                              │
│  │  - CustomPlugin.dll                  │                              │
│  └──────────────────────────────────────┘                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**의존성 규칙:**
- Core는 다른 모듈에 의존하지 않음
- CoreUObject는 Core에만 의존
- Engine은 Core + CoreUObject에 의존
- Game은 Core + CoreUObject + Engine에 의존
- 순환 의존성 금지

---

## 🚨 일반적인 함정

### ❌ PreInit 전 UObject 사용

```cpp
// ❌ 위험: CoreUObject 로드 전 UObject 사용
int main()
{
    // PreInit 전
    UMyObject* Obj = NewObject<UMyObject>();  // 크래시!
    // GUObjectArray가 아직 초기화 안 됨!

    GEngineLoop.PreInit(CmdLine);  // 너무 늦음
}

// ✅ 올바름: PreInit 이후 사용
int main()
{
    GEngineLoop.PreInit(CmdLine);  // CoreUObject 로드

    // 이제 안전
    UMyObject* Obj = NewObject<UMyObject>();
}
```

### ❌ 모듈 로딩 순서 무시

```cpp
// ❌ 잘못된 모듈 로딩 순서
void BadModuleLoad()
{
    FModuleManager::Get().LoadModule(TEXT("MyGameModule"));  // 먼저 로드
    FModuleManager::Get().LoadModule(TEXT("Engine"));        // 나중에 로드
    // MyGameModule이 Engine에 의존하므로 크래시!
}

// ✅ 올바른 모듈 로딩 순서
void GoodModuleLoad()
{
    FModuleManager::Get().LoadModule(TEXT("Core"));
    FModuleManager::Get().LoadModule(TEXT("CoreUObject"));
    FModuleManager::Get().LoadModule(TEXT("Engine"));
    FModuleManager::Get().LoadModule(TEXT("MyGameModule"));
}
```

### ❌ Tick에서 무거운 작업

```cpp
// ❌ 나쁨: Tick에서 동기 로딩
void AMyActor::Tick(float DeltaTime)
{
    // 매 프레임 수백 ms 블로킹!
    UTexture2D* Texture = LoadObject<UTexture2D>(nullptr, TEXT("/Game/Textures/BigTexture"));
}

// ✅ 좋음: 비동기 로딩
void AMyActor::BeginPlay()
{
    // 한 번만, 비동기로
    StreamableManager.RequestAsyncLoad(
        AssetPath,
        FStreamableDelegate::CreateUObject(this, &AMyActor::OnTextureLoaded)
    );
}
```

---

## 🔍 디버깅 팁

### 부팅 시간 프로파일링

```cpp
// SCOPED_BOOT_TIMING 사용
void MyInitFunction()
{
    SCOPED_BOOT_TIMING("MyInitFunction");

    // 초기화 코드...

    // 자동으로 시간 측정 및 로그 출력
}

// 출력 예시:
// LogInit: Display: MyInitFunction took 123.45 ms
```

### 콘솔 명령어

```bash
# 부팅 프로파일 덤프
Stat StartFile
Stat StopFile

# 모듈 로딩 시간
-LogTimes

# 상세 부팅 로그
-Verbose

# 부팅 추적
-trace=boot,loadtime
```

### 브레이크포인트 위치

```cpp
// 주요 브레이크포인트 설정 위치
FEngineLoop::PreInitPreStartupScreen()  // Line 1588
FEngineLoop::PreInitPostStartupScreen() // Line 3244
FEngineLoop::Init()                     // Line 4490
GUObjectArray.AllocateObjectPool()      // CoreUObject 초기화
StaticRegisterNativesUMyClass()         // 리플렉션 등록
```

---

## 🔗 참고자료

- [Engine Initialization](https://docs.unrealengine.com/engine-initialization-in-unreal-engine/)
- [Module Loading](https://docs.unrealengine.com/modules-in-unreal-engine/)
- [Game Loop](https://docs.unrealengine.com/the-game-loop-in-unreal-engine/)
- [LaunchEngineLoop.cpp Source](Engine/Source/Runtime/Launch/Private/LaunchEngineLoop.cpp)
- [LaunchEngineLoop.h Source](Engine/Source/Runtime/Launch/Public/LaunchEngineLoop.h)

---

**연관 문서:**
- [CoreUObject/UObject.md](../CoreUObject/UObject.md) - UObject 시스템
- [CoreUObject/ObjectIndexing.md](../CoreUObject/ObjectIndexing.md) - FUObjectArray
- [CoreUObject/GarbageCollection.md](../CoreUObject/GarbageCollection.md) - GC 초기화
- [CoreUObject/AssetRegistry.md](../CoreUObject/AssetRegistry.md) - AssetRegistry 초기화

---

> 📅 생성: 2025-10-20 — 엔진 초기화 시스템 문서화 (UE 5.6.1 검증 완료)
