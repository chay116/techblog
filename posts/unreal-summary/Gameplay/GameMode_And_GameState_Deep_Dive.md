---
title: "GameMode & GameState Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Gameplay"
tags: ["unreal", "Gameplay"]
---
# GameMode & GameState Deep Dive

## 🧭 개요

**GameMode**는 게임 규칙(Server Only), **GameState**는 게임 상태(Replicated)를 관리합니다.

### 핵심 개념

| 클래스 | 설명 | Replication |
|--------|------|-------------|
| **AGameModeBase** | 게임 규칙 (Server Only) | ❌ No |
| **AGameStateBase** | 게임 상태 (Score, Time) | ✅ Yes (All Clients) |
| **APlayerController** | Player 입력 제어 | ✅ Yes (Owner Client) |
| **APlayerState** | Player 상태 (Name, Score) | ✅ Yes (All Clients) |
| **APawn** | Player가 조종하는 객체 | ✅ Yes |

---

## 🏗️ GameMode Lifecycle

```
Server 시작
    ↓
1. PreInitializeComponents()
2. InitGame() - 맵 로딩 전
3. PreLogin() - Player 접속 승인
4. Login() - PlayerController 생성
5. PostLogin() - Pawn Spawn
6. HandleStartingNewPlayer()
    ↓
Game Running
    ↓
7. Logout() - Player 나갈 때
```

---

## 🎮 예시: Deathmatch GameMode

```cpp
UCLASS()
class AMyGameMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    // Server Only - Client에 복제 안 됨
    int32 KillLimit = 10;
    TArray<APlayerController*> Players;

    virtual void PostLogin(APlayerController* NewPlayer) override
    {
        Super::PostLogin(NewPlayer);

        // Spawn Player
        APawn* Pawn = SpawnDefaultPawnFor(NewPlayer, ...);
        NewPlayer->Possess(Pawn);

        Players.Add(NewPlayer);
    }

    void OnPlayerKilled(APlayerController* Killer, APlayerController* Victim)
    {
        // Update Score (Server Only)
        AMyPlayerState* KillerState = Cast<AMyPlayerState>(Killer->PlayerState);
        KillerState->Score++;  // Replicated to all clients

        // Check Win Condition
        if (KillerState->Score >= KillLimit)
        {
            EndMatch(Killer);
        }
    }
};
```

---

## 📊 GameState (Replicated)

```cpp
UCLASS()
class AMyGameState : public AGameStateBase
{
    GENERATED_BODY()

public:
    // Replicated to all clients
    UPROPERTY(Replicated)
    int32 RemainingTime;

    UPROPERTY(Replicated)
    TArray<APlayerState*> TopPlayers;

    virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override
    {
        Super::GetLifetimeReplicatedProps(OutLifetimeProps);
        DOREPLIFETIME(AMyGameState, RemainingTime);
        DOREPLIFETIME(AMyGameState, TopPlayers);
    }
};
```

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - GameMode & GameState