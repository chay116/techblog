---
title: "GameMode (게임 모드와 게임 규칙)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "GameFramework"
tags: ["unreal", "GameFramework"]
---
# GameMode (게임 모드와 게임 규칙)

## 🧭 개요

**AGameModeBase**는 언리얼 엔진의 **게임 규칙과 진행을 정의하는 클래스**입니다. 플레이어 입장, Pawn 스폰, 승리 조건, 게임 흐름을 관리하며 **서버에만 존재**합니다.

**핵심 철학:**
> **GameMode**는 "게임 규칙" (서버 전용, 권한),
> **GameState**는 "게임 상태" (복제, 모든 클라이언트 공유),
> **PlayerState**는 "플레이어 상태" (복제, 개별 플레이어)를 담당한다.

**주요 특징:**
- **서버 전용**: 클라이언트에는 존재하지 않음 (AuthorityGameMode)
- **클래스 관리**: PlayerController, Pawn, PlayerState, GameState, HUD 클래스 지정
- **플레이어 로그인**: Login → PostLogin → HandleStartingNewPlayer → RestartPlayer
- **게임 흐름**: InitGame → StartPlay → MatchState 관리

**📂 위치:**
- `Engine/Source/Runtime/Engine/Classes/GameFramework/GameModeBase.h`
- `Engine/Source/Runtime/Engine/Private/GameModeBase.cpp`
- `Engine/Source/Runtime/Engine/Classes/GameFramework/GameMode.h` (확장 버전)

---

## 🧱 GameMode 아키텍처

### GameMode vs GameState

**📂 위치:** `GameModeBase.h:35-65` (External/Foundation)

```
┌─Dedicated Server──────────────────────┐
│                                       │
│ World                                 │
│  │                                    │
│  ├──AuthorityGameMode:AGameModeBase  │  **서버에만 존재**
│  │   │                                │  - 게임 규칙
│  │   └──GameState:AGameStateBase     │  - 권한
│  │                                    │
│  └──GameState:AGameStateBase ─────────┼──────────┐ **복제됨**
│     :replicated                       │          │
│                                       │          │
└───────────────────────────────────────┘          │
                                                   │
      ┌────────────────────────────────────────────┤
      │                                            │
      ↓                                            ↓
┌─Client0────────────────────┐   ┌─Client1────────────────────┐
│                            │   │                            │
│ World                      │   │ World                      │
│  │                         │   │  │                         │
│  ├──GameState (복제됨)      │   │  ├──GameState (복제됨)      │
│  │                         │   │  │                         │
│  └──AuthorityGameMode:null │   │  └──AuthorityGameMode:null │
│                            │   │                            │
└────────────────────────────┘   └────────────────────────────┘
```

### Framework 클래스 계층

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        AGameModeBase                                    │
│  (게임 규칙 - 서버 전용)                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Key Members:                                                           │
│    - GameStateClass : TSubclassOf<AGameStateBase>    // 게임 상태 클래스│
│    - PlayerControllerClass : TSubclassOf<...>        // PC 클래스       │
│    - DefaultPawnClass : TSubclassOf<APawn>           // 기본 Pawn 클래스│
│    - PlayerStateClass : TSubclassOf<APlayerState>    // PS 클래스       │
│    - HUDClass : TSubclassOf<AHUD>                    // HUD 클래스      │
│                                                                         │
│  Key Methods:                                                           │
│    + InitGame() : void                    // 게임 초기화                │
│    + Login() : APlayerController*         // 플레이어 입장              │
│    + PostLogin() : void                   // 로그인 후 처리             │
│    + HandleStartingNewPlayer() : void     // 신규 플레이어 시작         │
│    + RestartPlayer() : void               // Pawn 스폰 및 Possess      │
│    + SpawnDefaultPawnFor() : APawn*       // Pawn 생성                 │
│    + StartPlay() : void                   // BeginPlay 시작            │
└─────────────────────────────────────────────────────────────────────────┘
                              │ 생성
                              ↓
                     ┌────────┴───────────────┬────────────────┬──────────┐
                     ↓                        ↓                ↓          ↓
          ┌────────────────┐    ┌───────────────────┐  ┌────────┐  ┌────────┐
          │ AGameStateBase │    │ APlayerController │  │ APawn  │  │  AHUD  │
          │  (게임 상태)    │    │  (입력/카메라)     │  │(캐릭터) │  │ (UI)   │
          └────────────────┘    └───────────────────┘  └────────┘  └────────┘
                 │                        │
                 │ 복제                   │ 생성
                 ↓                        ↓
          ┌────────────────┐    ┌───────────────────┐
          │모든 클라이언트에 │    │   APlayerState    │
          │ GameState 존재  │    │ (플레이어 정보)    │
          └────────────────┘    └───────────────────┘
```

---

## 🎮 GameMode 클래스 관리

### 주요 클래스 지정

```cpp
UCLASS()
class AMyGameMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    AMyGameMode()
    {
        // 게임 상태 클래스
        GameStateClass = AMyGameState::StaticClass();

        // 플레이어 컨트롤러 클래스
        PlayerControllerClass = AMyPlayerController::StaticClass();

        // 기본 Pawn 클래스
        DefaultPawnClass = AMyCharacter::StaticClass();

        // 플레이어 상태 클래스
        PlayerStateClass = AMyPlayerState::StaticClass();

        // HUD 클래스
        HUDClass = AMyHUD::StaticClass();

        // 관전자 Pawn 클래스
        SpectatorClass = ASpectatorPawn::StaticClass();
    }
};
```

### 동적 클래스 선택

```cpp
// Controller에 따라 다른 Pawn 사용
UClass* AMyGameMode::GetDefaultPawnClassForController_Implementation(AController* InController)
{
    AMyPlayerController* MyPC = Cast<AMyPlayerController>(InController);
    if (MyPC && MyPC->bIsVIPPlayer)
    {
        // VIP 플레이어는 특별한 Pawn 사용
        return AVIPCharacter::StaticClass();
    }

    // 일반 플레이어
    return DefaultPawnClass;
}
```

---

## 🚪 플레이어 로그인 흐름

### 전체 시퀀스

```
    UGameEngine::LoadMap()
           │
           ↓
    1. AGameModeBase 스폰 (서버만)
           │
           ↓
    2. GameMode->InitGame()
           │ - OptionsString 파싱
           │ - GameSession 생성
           ↓
    3. GameMode->InitGameState()
           │ - GameState 스폰 및 초기화
           ↓
    4. Player 접속
           │
           ↓
    5. GameMode->PreLogin()
           │ - 접속 허용 여부 확인
           ↓
    6. GameMode->Login()
           │ - PlayerController 스폰
           │ - PlayerState 생성
           ↓
    7. GameMode->PostLogin()
           │ - 복제 시작 (안전한 시점)
           │
           ↓
    8. GameMode->HandleStartingNewPlayer()
           │
           ├─ PlayerCanRestart() 확인
           │
           └─ RestartPlayer()
                │
                ├─ FindPlayerStart() - 스폰 위치 찾기
                │
                ├─ SpawnDefaultPawnFor() - Pawn 생성
                │    └─ SpawnDefaultPawnAtTransform()
                │
                └─ FinishRestartPlayer()
                     │
                     ├─ Controller->Possess(Pawn) - Possession
                     └─ Controller->ClientSetRotation() - 회전 동기화
```

### Login - PlayerController 생성

**📂 위치:** `GameModeBase.h:263-299` (External/Foundation)

```cpp
APlayerController* AGameModeBase::SpawnPlayerController(
    ENetRole InRemoteRole,
    const FString& Options
)
{
    FActorSpawnParameters SpawnInfo;
    SpawnInfo.Instigator = GetInstigator();
    SpawnInfo.bDeferConstruction = true;  // 나중에 설정 변경 가능
    SpawnInfo.ObjectFlags |= RF_Transient;  // 맵에 저장 안 함

    // PlayerController 스폰
    APlayerController* NewPC = GetWorld()->SpawnActor<APlayerController>(
        PlayerControllerClass,
        FVector::ZeroVector,
        FRotator::ZeroRotator,
        SpawnInfo
    );

    if (NewPC)
    {
        if (InRemoteRole == ROLE_SimulatedProxy)
        {
            // 로컬 플레이어
            NewPC->SetAsLocalPlayerController();
        }

        // Deferred Construction 완료
        NewPC->FinishSpawning(FTransform::Identity);
    }

    return NewPC;
}
```

### RestartPlayer - Pawn 스폰과 Possession

**📂 위치:** `GameModeBase.h:183-218` (External/Foundation)

```cpp
void AGameModeBase::RestartPlayer(AController* NewPlayer)
{
    // 1. PlayerStart 찾기
    AActor* StartSpot = FindPlayerStart(NewPlayer);

    // 2. PlayerStart 위치에 Pawn 스폰
    RestartPlayerAtPlayerStart(NewPlayer, StartSpot);
}

void AGameModeBase::RestartPlayerAtPlayerStart(
    AController* NewPlayer,
    AActor* StartSpot
)
{
    FRotator SpawnRotation = StartSpot->GetActorRotation();

    // 3. Pawn 생성
    if (GetDefaultPawnClassForController(NewPlayer) != nullptr)
    {
        APawn* NewPawn = SpawnDefaultPawnFor(NewPlayer, StartSpot);
        if (IsValid(NewPawn))
        {
            NewPlayer->SetPawn(NewPawn);  // 연결만 (Possess 아님)
        }
    }

    // 4. Possession 완료
    FinishRestartPlayer(NewPlayer, SpawnRotation);
}
```

### FinishRestartPlayer - Possession

**📂 위치:** `GameModeBase.h:115-156` (External/Foundation)

```cpp
void AGameModeBase::FinishRestartPlayer(
    AController* NewPlayer,
    const FRotator& StartRotation
)
{
    // Pawn Possess
    NewPlayer->Possess(NewPlayer->GetPawn());

    if (IsValid(NewPlayer->GetPawn()))
    {
        // Pawn 회전 설정
        NewPlayer->ClientSetRotation(
            NewPlayer->GetPawn()->GetActorRotation(),
            true  // bResetCamera
        );

        // Controller 회전 설정 (Roll 제거)
        FRotator NewControllerRot = StartRotation;
        NewControllerRot.Roll = 0.f;
        NewPlayer->SetControlRotation(NewControllerRot);
    }
}
```

**SetControlRotation vs ClientSetRotation:**
```
SetControlRotation()
    └─ ControlRotation 변수 업데이트 (PlayerController 내부 상태)

ClientSetRotation()
    └─ ControlRotation을 Possessed Pawn에 적용 (실제 회전 반영)
```

---

## ⏱️ StartPlay - BeginPlay 시작

**📂 위치:** `GameModeBase.h:70-76` (External/Foundation)

```cpp
void AGameModeBase::StartPlay()
{
    // GameState를 통해 모든 Actor의 BeginPlay 호출
    GameState->HandleBeginPlay();
}
```

**BeginPlay 트리거 흐름:**
```
UWorld::BeginPlay()
     │
     ├─ GameMode->StartPlay()
     │       │
     │       └─ GameState->HandleBeginPlay()
     │               │
     │               └─ World->bBegunPlay = true
     ↓
모든 Actor에 대해:
     │
     ├─ Actor->DispatchBeginPlay()
     │       │
     │       └─ Actor->BeginPlay()
     │               │
     │               └─ Component->BeginPlay()
     ↓
게임 시작
```

---

## 💡 실전 패턴

### 패턴 1: 팀별 Pawn 클래스

```cpp
UCLASS()
class ATeamGameMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    UPROPERTY(EditDefaultsOnly, Category = "Teams")
    TSubclassOf<APawn> RedTeamPawnClass;

    UPROPERTY(EditDefaultsOnly, Category = "Teams")
    TSubclassOf<APawn> BlueTeamPawnClass;

    virtual UClass* GetDefaultPawnClassForController_Implementation(
        AController* InController
    ) override
    {
        AMyPlayerState* PS = InController->GetPlayerState<AMyPlayerState>();
        if (PS)
        {
            switch (PS->TeamID)
            {
            case 1:
                return RedTeamPawnClass;
            case 2:
                return BlueTeamPawnClass;
            }
        }

        return DefaultPawnClass;
    }
};
```

### 패턴 2: 스폰 위치 커스터마이징

```cpp
AActor* AMyGameMode::FindPlayerStart_Implementation(
    AController* Player,
    const FString& IncomingName
)
{
    // 팀별 PlayerStart 찾기
    AMyPlayerState* PS = Player->GetPlayerState<AMyPlayerState>();
    if (PS)
    {
        FName TeamTag = FName(*FString::Printf(TEXT("Team%d"), PS->TeamID));

        for (TActorIterator<APlayerStart> It(GetWorld()); It; ++It)
        {
            APlayerStart* Start = *It;
            if (Start->PlayerStartTag == TeamTag)
            {
                return Start;
            }
        }
    }

    // 기본 동작
    return Super::FindPlayerStart_Implementation(Player, IncomingName);
}
```

### 패턴 3: 접속 제한

```cpp
void AMyGameMode::PreLogin(
    const FString& Options,
    const FString& Address,
    const FUniqueNetIdRepl& UniqueId,
    FString& ErrorMessage
)
{
    Super::PreLogin(Options, Address, UniqueId, ErrorMessage);

    // 서버 만원
    if (GetNumPlayers() >= MaxPlayers)
    {
        ErrorMessage = TEXT("Server is full");
        return;
    }

    // 밴 확인
    if (IsBannedPlayer(UniqueId))
    {
        ErrorMessage = TEXT("You are banned from this server");
        return;
    }

    // 비밀번호 확인
    FString Password = UGameplayStatics::ParseOption(Options, TEXT("Password"));
    if (Password != ServerPassword)
    {
        ErrorMessage = TEXT("Incorrect password");
        return;
    }
}
```

### 패턴 4: PostLogin에서 초기화

```cpp
void AMyGameMode::PostLogin(APlayerController* NewPlayer)
{
    Super::PostLogin(NewPlayer);

    // 이제 복제가 안전함
    AMyPlayerState* PS = NewPlayer->GetPlayerState<AMyPlayerState>();
    if (PS)
    {
        // 데이터베이스에서 플레이어 정보 로드
        LoadPlayerData(PS);

        // 환영 메시지
        NewPlayer->ClientMessage(TEXT("Welcome to the server!"));
    }

    // 다른 플레이어에게 알림
    for (FConstPlayerControllerIterator It = GetWorld()->GetPlayerControllerIterator(); It; ++It)
    {
        APlayerController* PC = It->Get();
        if (PC != NewPlayer)
        {
            PC->ClientMessage(
                FString::Printf(TEXT("%s has joined the game"), *NewPlayer->GetPlayerName())
            );
        }
    }
}
```

### 패턴 5: 게임 규칙 검증

```cpp
bool AMyGameMode::CanDamage(
    AActor* DamagedActor,
    float Damage,
    AController* EventInstigator
)
{
    // 아군 공격 방지
    if (bFriendlyFireDisabled)
    {
        APawn* DamagedPawn = Cast<APawn>(DamagedActor);
        APawn* InstigatorPawn = EventInstigator ? EventInstigator->GetPawn() : nullptr;

        if (DamagedPawn && InstigatorPawn)
        {
            AMyPlayerState* PS1 = DamagedPawn->GetPlayerState<AMyPlayerState>();
            AMyPlayerState* PS2 = InstigatorPawn->GetPlayerState<AMyPlayerState>();

            if (PS1 && PS2 && PS1->TeamID == PS2->TeamID)
            {
                // 같은 팀 - 데미지 불가
                return false;
            }
        }
    }

    return true;
}
```

---

## 🎯 GameMode 선택 방법

### 우선순위

```
1. URL 파라미터
   └─ "MyMap?game=MyGameMode"

2. World Settings Override
   └─ 에디터에서 World Settings → GameMode Override

3. DefaultGameMode (Project Settings)
   └─ Edit → Project Settings → Maps & Modes → Default GameMode
```

**코드에서 확인:**
```cpp
// UGameEngine::LoadMap()에서
UClass* GameModeClass = nullptr;

// 1. URL에서 확인
FString GameModeString;
if (FURL::Parse(*Options, TEXT("game"), GameModeString))
{
    GameModeClass = LoadClass<AGameModeBase>(nullptr, *GameModeString);
}

// 2. World Settings에서 확인
if (!GameModeClass && WorldSettings)
{
    GameModeClass = WorldSettings->DefaultGameMode;
}

// 3. Project Settings에서 확인
if (!GameModeClass)
{
    GameModeClass = LoadObject<UClass>(nullptr, *DefaultGameModePath);
}

// GameMode 스폰
AGameModeBase* GameMode = GetWorld()->SpawnActor<AGameModeBase>(GameModeClass);
```

---

## 🔗 참조 자료

### 공식 문서
- Unreal Engine Docs: [GameMode](https://docs.unrealengine.com/en-US/InteractiveExperiences/Framework/GameMode/)
- Unreal Engine Docs: [GameState](https://docs.unrealengine.com/en-US/InteractiveExperiences/Framework/GameMode/#gamestate)

### 소스 코드
- `Engine/Source/Runtime/Engine/Classes/GameFramework/GameModeBase.h` - AGameModeBase 선언
- `Engine/Source/Runtime/Engine/Private/GameModeBase.cpp` - 구현
- `UnrealSummary/External/Foundation/GameModeBase.h` - 주석 달린 핵심 코드

### 관련 주제
- `UnrealSummary/GameFramework/World.md` - World와 GameMode 관계
- `UnrealSummary/GameFramework/PlayerController.md` - PlayerController 생명주기
- `UnrealSummary/GameFramework/Pawn.md` - Pawn Possession

---

> 🔄 Created: 2025-01-XX — Initial documentation for GameMode System (AGameModeBase, Login Flow, Pawn Spawning) in UE 5.7
