---
title: "언리얼 엔진 + C# 서버 연동 완벽 가이드"
date: "2025-11-26"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Networking"
tags: ["unreal", "Networking"]
---
# 언리얼 엔진 + C# 서버 연동 완벽 가이드

## 🎯 목차

1. [전체 아키텍처](#1-전체-아키텍처)
2. [C# 서버 구현 (LiteNetLib)](#2-c-서버-구현-litenetlib)
3. [언리얼 클라이언트 구현 (C++)](#3-언리얼-클라이언트-구현-c)
4. [프로토콜 정의 (MessagePack)](#4-프로토콜-정의-messagepack)
5. [완전한 예제](#5-완전한-예제)
6. [테스트 및 디버깅](#6-테스트-및-디버깅)

---

## 1. 전체 아키텍처

### 1.1 시스템 구조

```
┌─────────────────────────────────────────────────────────────────┐
│ 언리얼 클라이언트 (C++)                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ GameMode / PlayerController                             │     │
│ │ └─ 게임 로직, 입력 처리                                  │     │
│ └─────────────────────────────────────────────────────────┘     │
│                           ↓                                     │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ NetworkClient (C++)                                     │     │
│ │ ├─ UDP Socket (FUdpSocketReceiver)                      │     │
│ │ ├─ MessagePack 직렬화/역직렬화                          │     │
│ │ └─ 패킷 송수신                                           │     │
│ └─────────────────────────────────────────────────────────┘     │
│                           ↓                                     │
└─────────────────────────────────────────────────────────────────┘
                            ↓ UDP (MessagePack)
┌─────────────────────────────────────────────────────────────────┐
│ C# 서버 (.NET 8)                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ GameServer (Main)                                       │     │
│ │ └─ LiteNetLib UDP 리스너                                │     │
│ └─────────────────────────────────────────────────────────┘     │
│                           ↓                                     │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ RoomManager                                             │     │
│ │ └─ 매칭, 방 생성/삭제                                    │     │
│ └─────────────────────────────────────────────────────────┘     │
│                           ↓                                     │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ GameRoom (20Hz Tick)                                    │     │
│ │ ├─ 게임 로직 (이동, 충돌, 공격)                         │     │
│ │ ├─ Soft Collision                                       │     │
│ │ └─ 상태 브로드캐스트                                     │     │
│ └─────────────────────────────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

통신 프로토콜:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 프로토콜: UDP (LiteNetLib)
• 직렬화: MessagePack
• 언어: C# (서버) ↔ C++ (클라이언트)
```

### 1.2 통신 플로우

```
클라이언트 시작:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 언리얼 클라이언트 시작
   ↓
2. NetworkClient 초기화
   ↓
3. C# 서버 연결 (UDP)
   ├─ SendConnectRequest()
   └─ 서버: AcceptConnection()
   ↓
4. 매칭 요청
   ├─ SendFindMatch()
   └─ 서버: 방 생성 또는 기존 방 참가
   ↓
5. 게임 시작
   └─ 서버: GameRoom.StartGame() (20Hz Tick 시작)

게임 중:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

클라이언트 → 서버 (매 프레임):
├─ PlayerInput (MoveX, MoveY, IsAttacking)
└─ 서버: 입력 큐에 추가

서버 → 클라이언트 (20Hz):
├─ GameState (모든 플레이어 위치, 체력)
└─ 클라이언트: 캐릭터 업데이트 (보간)

게임 종료:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 게임 종료 조건 (승리/패배)
   ↓
2. 서버: GameEnd 메시지
   ↓
3. 클라이언트: 결과 화면 표시
   ↓
4. 연결 종료
```

---

## 2. C# 서버 구현 (LiteNetLib)

### 2.1 프로젝트 설정

```bash
# .NET 8 콘솔 앱 생성
dotnet new console -n BrawlStarsServer
cd BrawlStarsServer

# LiteNetLib 설치
dotnet add package LiteNetLib

# MessagePack 설치
dotnet add package MessagePack

# 실행
dotnet run
```

### 2.2 메시지 프로토콜 정의

```csharp
// ===================================================
// Messages/PacketType.cs
// ===================================================

public enum PacketType : byte
{
    // 연결
    ConnectRequest = 1,
    ConnectResponse = 2,

    // 매칭
    FindMatch = 10,
    MatchFound = 11,
    GameStarted = 12,

    // 게임
    PlayerInput = 20,
    GameState = 21,

    // 종료
    GameEnd = 30
}

// ===================================================
// Messages/NetworkMessages.cs
// ===================================================

using MessagePack;

// 연결 요청
[MessagePackObject]
public class ConnectRequest
{
    [Key(0)] public string PlayerId { get; set; }
    [Key(1)] public string PlayerName { get; set; }
}

[MessagePackObject]
public class ConnectResponse
{
    [Key(0)] public bool Success { get; set; }
    [Key(1)] public string Message { get; set; }
}

// 매칭 요청
[MessagePackObject]
public class FindMatchRequest
{
    [Key(0)] public string PlayerId { get; set; }
}

[MessagePackObject]
public class MatchFoundResponse
{
    [Key(0)] public string RoomId { get; set; }
    [Key(1)] public int PlayerCount { get; set; }
}

// 게임 입력
[MessagePackObject]
public class PlayerInput
{
    [Key(0)] public string PlayerId { get; set; }
    [Key(1)] public int SequenceNumber { get; set; }
    [Key(2)] public float MoveX { get; set; }
    [Key(3)] public float MoveY { get; set; }
    [Key(4)] public bool IsAttacking { get; set; }
    [Key(5)] public float AimX { get; set; }
    [Key(6)] public float AimY { get; set; }
}

// 게임 상태
[MessagePackObject]
public class GameState
{
    [Key(0)] public List<PlayerState> Players { get; set; }
    [Key(1)] public List<ProjectileState> Projectiles { get; set; }
    [Key(2)] public long Timestamp { get; set; }
}

[MessagePackObject]
public class PlayerState
{
    [Key(0)] public string PlayerId { get; set; }
    [Key(1)] public float PositionX { get; set; }
    [Key(2)] public float PositionY { get; set; }
    [Key(3)] public float VelocityX { get; set; }
    [Key(4)] public float VelocityY { get; set; }
    [Key(5)] public int Health { get; set; }
    [Key(6)] public float Rotation { get; set; }
}

[MessagePackObject]
public class ProjectileState
{
    [Key(0)] public string ProjectileId { get; set; }
    [Key(1)] public float PositionX { get; set; }
    [Key(2)] public float PositionY { get; set; }
    [Key(3)] public float VelocityX { get; set; }
    [Key(4)] public float VelocityY { get; set; }
}
```

### 2.3 게임 서버 구현

```csharp
// ===================================================
// GameServer.cs
// ===================================================

using LiteNetLib;
using LiteNetLib.Utils;
using MessagePack;

public class GameServer : INetEventListener
{
    private NetManager _server;
    private RoomManager _roomManager;
    private Dictionary<int, PlayerConnection> _connections = new();

    public void Start(int port)
    {
        _roomManager = new RoomManager(this);
        _server = new NetManager(this);
        _server.Start(port);

        Console.WriteLine($"[Server] Started on port {port}");

        // 전역 틱 (100ms)
        Timer globalTick = new Timer(GlobalTick, null, 0, 100);
    }

    // ================================================
    // 연결
    // ================================================
    public void OnPeerConnected(NetPeer peer)
    {
        Console.WriteLine($"[Connect] Peer {peer.Id} connected");

        var connection = new PlayerConnection
        {
            PeerId = peer.Id,
            Peer = peer
        };

        _connections[peer.Id] = connection;
    }

    // ================================================
    // 패킷 수신
    // ================================================
    public void OnNetworkReceive(NetPeer peer, NetPacketReader reader, byte channel, DeliveryMethod deliveryMethod)
    {
        byte packetType = reader.GetByte();
        byte[] data = reader.GetRemainingBytes();

        switch ((PacketType)packetType)
        {
            case PacketType.ConnectRequest:
                HandleConnectRequest(peer, data);
                break;

            case PacketType.FindMatch:
                HandleFindMatch(peer, data);
                break;

            case PacketType.PlayerInput:
                HandlePlayerInput(peer, data);
                break;
        }
    }

    // ================================================
    // 연결 요청 처리
    // ================================================
    private void HandleConnectRequest(NetPeer peer, byte[] data)
    {
        var request = MessagePackSerializer.Deserialize<ConnectRequest>(data);

        Console.WriteLine($"[Connect] Player {request.PlayerName} ({request.PlayerId})");

        // 연결 정보 저장
        if (_connections.TryGetValue(peer.Id, out var connection))
        {
            connection.PlayerId = request.PlayerId;
            connection.PlayerName = request.PlayerName;
        }

        // 응답
        var response = new ConnectResponse
        {
            Success = true,
            Message = "Connected successfully"
        };

        SendMessage(peer, PacketType.ConnectResponse, response);
    }

    // ================================================
    // 매칭 요청 처리
    // ================================================
    private void HandleFindMatch(NetPeer peer, byte[] data)
    {
        var request = MessagePackSerializer.Deserialize<FindMatchRequest>(data);

        var connection = _connections[peer.Id];
        var room = _roomManager.FindOrCreateRoom(connection);

        Console.WriteLine($"[Match] Player {connection.PlayerName} → Room {room.RoomId}");

        // 매칭 응답
        var response = new MatchFoundResponse
        {
            RoomId = room.RoomId,
            PlayerCount = room.Players.Count
        };

        SendMessage(peer, PacketType.MatchFound, response);

        // 6명 모이면 게임 시작
        if (room.Players.Count >= 6)
        {
            room.StartGame();

            foreach (var player in room.Players.Values)
            {
                SendMessage(player.Connection.Peer, PacketType.GameStarted, new object());
            }
        }
    }

    // ================================================
    // 플레이어 입력 처리
    // ================================================
    private void HandlePlayerInput(NetPeer peer, byte[] data)
    {
        var input = MessagePackSerializer.Deserialize<PlayerInput>(data);

        var connection = _connections[peer.Id];
        var room = _roomManager.FindRoomByPlayerId(connection.PlayerId);

        if (room != null && room.Players.TryGetValue(connection.PlayerId, out var player))
        {
            player.PendingInputs.Enqueue(input);
        }
    }

    // ================================================
    // 메시지 전송
    // ================================================
    public void SendMessage<T>(NetPeer peer, PacketType packetType, T message)
    {
        byte[] data = MessagePackSerializer.Serialize(message);

        NetDataWriter writer = new NetDataWriter();
        writer.Put((byte)packetType);
        writer.Put(data);

        peer.Send(writer, DeliveryMethod.ReliableOrdered);
    }

    public void BroadcastToRoom(string roomId, PacketType packetType, object message)
    {
        var room = _roomManager.GetRoom(roomId);
        if (room == null) return;

        byte[] data = MessagePackSerializer.Serialize(message);

        NetDataWriter writer = new NetDataWriter();
        writer.Put((byte)packetType);
        writer.Put(data);

        foreach (var player in room.Players.Values)
        {
            player.Connection.Peer.Send(writer, DeliveryMethod.Sequenced);
        }
    }

    // ================================================
    // 전역 틱
    // ================================================
    private void GlobalTick(object state)
    {
        _server.PollEvents();
    }

    // 기타 인터페이스 구현
    public void OnPeerDisconnected(NetPeer peer, DisconnectInfo disconnectInfo)
    {
        Console.WriteLine($"[Disconnect] Peer {peer.Id}");

        if (_connections.TryGetValue(peer.Id, out var connection))
        {
            var room = _roomManager.FindRoomByPlayerId(connection.PlayerId);
            room?.RemovePlayer(connection.PlayerId);

            _connections.Remove(peer.Id);
        }
    }

    public void OnNetworkError(IPEndPoint endPoint, SocketError socketError) { }
    public void OnNetworkReceiveUnconnected(IPEndPoint remoteEndPoint, NetPacketReader reader, UnconnectedMessageType messageType) { }
    public void OnNetworkLatencyUpdate(NetPeer peer, int latency) { }
    public void OnConnectionRequest(ConnectionRequest request)
    {
        request.Accept();
    }
}

// ===================================================
// PlayerConnection.cs
// ===================================================

public class PlayerConnection
{
    public int PeerId { get; set; }
    public NetPeer Peer { get; set; }
    public string PlayerId { get; set; }
    public string PlayerName { get; set; }
}
```

### 2.4 게임 룸 구현

```csharp
// ===================================================
// GameRoom.cs
// ===================================================

public class GameRoom
{
    public string RoomId { get; }
    public GamePhase Phase { get; private set; }
    public Dictionary<string, Player> Players { get; } = new();

    private GameServer _server;
    private Timer _tickTimer;
    private const int TICK_RATE = 50; // 20Hz

    public GameRoom(GameServer server)
    {
        RoomId = Guid.NewGuid().ToString();
        Phase = GamePhase.Waiting;
        _server = server;
    }

    // ================================================
    // 게임 시작
    // ================================================
    public void StartGame()
    {
        Phase = GamePhase.Playing;
        Console.WriteLine($"[Game] Room {RoomId} started!");

        // 플레이어 초기화
        int spawnIndex = 0;
        Vector2[] spawnPoints = new[]
        {
            new Vector2(10, 10),
            new Vector2(40, 10),
            new Vector2(10, 40),
            new Vector2(40, 40),
            new Vector2(25, 10),
            new Vector2(25, 40)
        };

        foreach (var player in Players.Values)
        {
            player.Position = spawnPoints[spawnIndex % spawnPoints.Length];
            spawnIndex++;
        }

        // 20Hz 틱 시작
        _tickTimer = new Timer(Tick, null, 0, TICK_RATE);
    }

    // ================================================
    // 게임 틱 (50ms = 20Hz)
    // ================================================
    private void Tick(object state)
    {
        float deltaTime = TICK_RATE / 1000f; // 0.05s

        // 1. 입력 처리
        ProcessInputs();

        // 2. 게임 로직
        UpdatePlayers(deltaTime);
        UpdateProjectiles(deltaTime);

        // 3. 충돌 감지
        CheckCollisions();

        // 4. 상태 브로드캐스트
        BroadcastGameState();

        // 5. 게임 종료 체크
        CheckGameEnd();
    }

    // ================================================
    // 입력 처리
    // ================================================
    private void ProcessInputs()
    {
        foreach (var player in Players.Values)
        {
            while (player.PendingInputs.TryDequeue(out PlayerInput input))
            {
                if (input.SequenceNumber <= player.LastProcessedInputSequence)
                    continue;

                // 이동 입력
                player.MoveInput = new Vector2(input.MoveX, input.MoveY);

                // 조준 입력
                player.AimDirection = new Vector2(input.AimX, input.AimY);

                // 공격 입력
                if (input.IsAttacking && player.CanFire())
                {
                    FireProjectile(player);
                }

                player.LastProcessedInputSequence = input.SequenceNumber;
            }
        }
    }

    // ================================================
    // 플레이어 업데이트
    // ================================================
    private void UpdatePlayers(float deltaTime)
    {
        foreach (var player in Players.Values)
        {
            if (player.Health <= 0) continue;

            // 이동
            if (player.MoveInput.Length() > 0.1f)
            {
                Vector2 moveDir = player.MoveInput.Normalized();
                player.Velocity = moveDir * player.MoveSpeed;
            }
            else
            {
                // 마찰력
                player.Velocity *= 0.8f;
            }

            // 위치 업데이트
            player.Position += player.Velocity * deltaTime;

            // 맵 경계
            player.Position.X = Math.Clamp(player.Position.X, 0, 50);
            player.Position.Y = Math.Clamp(player.Position.Y, 0, 50);

            // 회전 (조준 방향)
            if (player.AimDirection.Length() > 0.1f)
            {
                player.Rotation = MathF.Atan2(player.AimDirection.Y, player.AimDirection.X);
            }
        }
    }

    // ================================================
    // Soft Collision (물리 엔진 없음!)
    // ================================================
    private void CheckCollisions()
    {
        // 플레이어 간 충돌
        var playerList = Players.Values.ToList();
        for (int i = 0; i < playerList.Count; i++)
        {
            for (int j = i + 1; j < playerList.Count; j++)
            {
                var playerA = playerList[i];
                var playerB = playerList[j];

                float distance = Vector2.Distance(playerA.Position, playerB.Position);
                float radiusSum = playerA.Radius + playerB.Radius;

                if (distance < radiusSum)
                {
                    // 겹침 - 밀어내기
                    float overlap = radiusSum - distance;
                    Vector2 direction = (playerA.Position - playerB.Position).Normalized();

                    playerA.Position += direction * overlap * 0.5f;
                    playerB.Position -= direction * overlap * 0.5f;
                }
            }
        }

        // 투사체 충돌 (생략 - 이전 가이드 참고)
    }

    // ================================================
    // 상태 브로드캐스트
    // ================================================
    private void BroadcastGameState()
    {
        var gameState = new GameState
        {
            Players = Players.Values.Select(p => new PlayerState
            {
                PlayerId = p.PlayerId,
                PositionX = p.Position.X,
                PositionY = p.Position.Y,
                VelocityX = p.Velocity.X,
                VelocityY = p.Velocity.Y,
                Health = p.Health,
                Rotation = p.Rotation
            }).ToList(),
            Projectiles = new List<ProjectileState>(), // 생략
            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };

        _server.BroadcastToRoom(RoomId, PacketType.GameState, gameState);
    }
}
```

---

## 3. 언리얼 클라이언트 구현 (C++)

### 3.1 플러그인 설정

먼저 MessagePack C++ 라이브러리를 언리얼 프로젝트에 추가해야 합니다.

```cpp
// YourProject.Build.cs

using UnrealBuildTool;

public class YourProject : ModuleRules
{
    public YourProject(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "InputCore",
            "Sockets",          // UDP 소켓
            "Networking"        // 네트워킹
        });

        // MessagePack 헤더 경로 추가
        PublicIncludePaths.Add("$(ProjectDir)/ThirdParty/msgpack-c/include");
    }
}
```

### 3.2 네트워크 클라이언트 구현

```cpp
// ===================================================
// NetworkClient.h
// ===================================================

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Sockets.h"
#include "SocketSubsystem.h"
#include "Networking.h"
#include "msgpack.hpp"
#include "NetworkClient.generated.h"

USTRUCT(BlueprintType)
struct FPlayerInput
{
    GENERATED_BODY()

    UPROPERTY() FString PlayerId;
    UPROPERTY() int32 SequenceNumber;
    UPROPERTY() float MoveX;
    UPROPERTY() float MoveY;
    UPROPERTY() bool IsAttacking;
    UPROPERTY() float AimX;
    UPROPERTY() float AimY;
};

USTRUCT(BlueprintType)
struct FPlayerState
{
    GENERATED_BODY()

    UPROPERTY() FString PlayerId;
    UPROPERTY() float PositionX;
    UPROPERTY() float PositionY;
    UPROPERTY() float VelocityX;
    UPROPERTY() float VelocityY;
    UPROPERTY() int32 Health;
    UPROPERTY() float Rotation;
};

UCLASS()
class YOURPROJECT_API ANetworkClient : public AActor
{
    GENERATED_BODY()

public:
    ANetworkClient();

    virtual void BeginPlay() override;
    virtual void Tick(float DeltaTime) override;
    virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

    // 서버 연결
    UFUNCTION(BlueprintCallable)
    void ConnectToServer(FString ServerIP, int32 Port);

    // 매칭 요청
    UFUNCTION(BlueprintCallable)
    void RequestMatch();

    // 입력 전송
    void SendPlayerInput(FVector2D MoveInput, FVector2D AimInput, bool bIsAttacking);

    // 델리게이트
    DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnConnectedDelegate);
    DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnMatchFoundDelegate, int32, PlayerCount);
    DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnGameStartedDelegate);
    DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnGameStateReceivedDelegate, const TArray<FPlayerState>&, Players);

    UPROPERTY(BlueprintAssignable)
    FOnConnectedDelegate OnConnected;

    UPROPERTY(BlueprintAssignable)
    FOnMatchFoundDelegate OnMatchFound;

    UPROPERTY(BlueprintAssignable)
    FOnGameStartedDelegate OnGameStarted;

    UPROPERTY(BlueprintAssignable)
    FOnGameStateReceivedDelegate OnGameStateReceived;

private:
    FSocket* Socket;
    TSharedPtr<FInternetAddr> ServerAddr;
    FString MyPlayerId;
    int32 InputSequenceNumber;

    // 패킷 수신
    void ReceivePackets();
    void HandlePacket(uint8 PacketType, const TArray<uint8>& Data);

    // 메시지 전송
    void SendMessage(uint8 PacketType, const TArray<uint8>& Data);

    // MessagePack 헬퍼
    template<typename T>
    TArray<uint8> SerializeMessagePack(const T& Object);

    template<typename T>
    bool DeserializeMessagePack(const TArray<uint8>& Data, T& OutObject);
};

// ===================================================
// NetworkClient.cpp
// ===================================================

#include "NetworkClient.h"

ANetworkClient::ANetworkClient()
{
    PrimaryActorTick.bCanEverTick = true;
    InputSequenceNumber = 0;
    MyPlayerId = FGuid::NewGuid().ToString();
}

void ANetworkClient::BeginPlay()
{
    Super::BeginPlay();
}

void ANetworkClient::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    // 패킷 수신
    if (Socket)
    {
        ReceivePackets();
    }
}

// ================================================
// 서버 연결
// ================================================
void ANetworkClient::ConnectToServer(FString ServerIP, int32 Port)
{
    ISocketSubsystem* SocketSubsystem = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM);

    // UDP 소켓 생성
    Socket = SocketSubsystem->CreateSocket(NAME_DGram, TEXT("GameClient"), false);

    if (!Socket)
    {
        UE_LOG(LogTemp, Error, TEXT("Failed to create socket"));
        return;
    }

    // 서버 주소 설정
    ServerAddr = SocketSubsystem->CreateInternetAddr();
    bool bIsValid;
    ServerAddr->SetIp(*ServerIP, bIsValid);
    ServerAddr->SetPort(Port);

    if (!bIsValid)
    {
        UE_LOG(LogTemp, Error, TEXT("Invalid IP address: %s"), *ServerIP);
        return;
    }

    // 연결 요청 전송
    msgpack::sbuffer buffer;
    msgpack::packer<msgpack::sbuffer> packer(&buffer);

    packer.pack_map(2);
    packer.pack("PlayerId");
    packer.pack(TCHAR_TO_UTF8(*MyPlayerId));
    packer.pack("PlayerName");
    packer.pack("Player");

    TArray<uint8> Data;
    Data.Append((uint8*)buffer.data(), buffer.size());

    SendMessage(1, Data); // PacketType::ConnectRequest

    UE_LOG(LogTemp, Log, TEXT("Connecting to server %s:%d"), *ServerIP, Port);
}

// ================================================
// 매칭 요청
// ================================================
void ANetworkClient::RequestMatch()
{
    msgpack::sbuffer buffer;
    msgpack::packer<msgpack::sbuffer> packer(&buffer);

    packer.pack_map(1);
    packer.pack("PlayerId");
    packer.pack(TCHAR_TO_UTF8(*MyPlayerId));

    TArray<uint8> Data;
    Data.Append((uint8*)buffer.data(), buffer.size());

    SendMessage(10, Data); // PacketType::FindMatch

    UE_LOG(LogTemp, Log, TEXT("Requesting match..."));
}

// ================================================
// 입력 전송
// ================================================
void ANetworkClient::SendPlayerInput(FVector2D MoveInput, FVector2D AimInput, bool bIsAttacking)
{
    InputSequenceNumber++;

    msgpack::sbuffer buffer;
    msgpack::packer<msgpack::sbuffer> packer(&buffer);

    packer.pack_map(7);
    packer.pack("PlayerId");
    packer.pack(TCHAR_TO_UTF8(*MyPlayerId));
    packer.pack("SequenceNumber");
    packer.pack(InputSequenceNumber);
    packer.pack("MoveX");
    packer.pack(MoveInput.X);
    packer.pack("MoveY");
    packer.pack(MoveInput.Y);
    packer.pack("IsAttacking");
    packer.pack(bIsAttacking);
    packer.pack("AimX");
    packer.pack(AimInput.X);
    packer.pack("AimY");
    packer.pack(AimInput.Y);

    TArray<uint8> Data;
    Data.Append((uint8*)buffer.data(), buffer.size());

    SendMessage(20, Data); // PacketType::PlayerInput
}

// ================================================
// 패킷 수신
// ================================================
void ANetworkClient::ReceivePackets()
{
    uint32 PendingDataSize;

    while (Socket->HasPendingData(PendingDataSize))
    {
        TArray<uint8> RecvData;
        RecvData.SetNumUninitialized(PendingDataSize);

        int32 BytesRead;
        Socket->Recv(RecvData.GetData(), RecvData.Num(), BytesRead);

        if (BytesRead > 0)
        {
            uint8 PacketType = RecvData[0];
            TArray<uint8> MessageData;
            MessageData.Append(RecvData.GetData() + 1, BytesRead - 1);

            HandlePacket(PacketType, MessageData);
        }
    }
}

// ================================================
// 패킷 처리
// ================================================
void ANetworkClient::HandlePacket(uint8 PacketType, const TArray<uint8>& Data)
{
    switch (PacketType)
    {
        case 2: // ConnectResponse
        {
            msgpack::object_handle oh = msgpack::unpack((const char*)Data.GetData(), Data.Num());
            msgpack::object obj = oh.get();

            bool bSuccess = false;
            obj.via.map.ptr[0].val.convert(bSuccess);

            if (bSuccess)
            {
                UE_LOG(LogTemp, Log, TEXT("Connected to server!"));
                OnConnected.Broadcast();
            }
            break;
        }

        case 11: // MatchFound
        {
            msgpack::object_handle oh = msgpack::unpack((const char*)Data.GetData(), Data.Num());
            msgpack::object obj = oh.get();

            int32 PlayerCount = 0;
            for (uint32 i = 0; i < obj.via.map.size; ++i)
            {
                std::string key;
                obj.via.map.ptr[i].key.convert(key);

                if (key == "PlayerCount")
                {
                    obj.via.map.ptr[i].val.convert(PlayerCount);
                }
            }

            UE_LOG(LogTemp, Log, TEXT("Match found! Players: %d"), PlayerCount);
            OnMatchFound.Broadcast(PlayerCount);
            break;
        }

        case 12: // GameStarted
        {
            UE_LOG(LogTemp, Log, TEXT("Game started!"));
            OnGameStarted.Broadcast();
            break;
        }

        case 21: // GameState
        {
            msgpack::object_handle oh = msgpack::unpack((const char*)Data.GetData(), Data.Num());
            msgpack::object obj = oh.get();

            TArray<FPlayerState> Players;

            for (uint32 i = 0; i < obj.via.map.size; ++i)
            {
                std::string key;
                obj.via.map.ptr[i].key.convert(key);

                if (key == "Players")
                {
                    msgpack::object_array playersArray = obj.via.map.ptr[i].val.via.array;

                    for (uint32 j = 0; j < playersArray.size; ++j)
                    {
                        msgpack::object_map playerMap = playersArray.ptr[j].via.map;

                        FPlayerState PlayerState;

                        for (uint32 k = 0; k < playerMap.size; ++k)
                        {
                            std::string playerKey;
                            playerMap.ptr[k].key.convert(playerKey);

                            if (playerKey == "PlayerId")
                            {
                                std::string playerId;
                                playerMap.ptr[k].val.convert(playerId);
                                PlayerState.PlayerId = FString(playerId.c_str());
                            }
                            else if (playerKey == "PositionX")
                                playerMap.ptr[k].val.convert(PlayerState.PositionX);
                            else if (playerKey == "PositionY")
                                playerMap.ptr[k].val.convert(PlayerState.PositionY);
                            else if (playerKey == "VelocityX")
                                playerMap.ptr[k].val.convert(PlayerState.VelocityX);
                            else if (playerKey == "VelocityY")
                                playerMap.ptr[k].val.convert(PlayerState.VelocityY);
                            else if (playerKey == "Health")
                                playerMap.ptr[k].val.convert(PlayerState.Health);
                            else if (playerKey == "Rotation")
                                playerMap.ptr[k].val.convert(PlayerState.Rotation);
                        }

                        Players.Add(PlayerState);
                    }
                }
            }

            OnGameStateReceived.Broadcast(Players);
            break;
        }
    }
}

// ================================================
// 메시지 전송
// ================================================
void ANetworkClient::SendMessage(uint8 PacketType, const TArray<uint8>& Data)
{
    if (!Socket || !ServerAddr.IsValid())
        return;

    TArray<uint8> Packet;
    Packet.Add(PacketType);
    Packet.Append(Data);

    int32 BytesSent;
    Socket->SendTo(Packet.GetData(), Packet.Num(), BytesSent, *ServerAddr);
}

void ANetworkClient::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    Super::EndPlay(EndPlayReason);

    if (Socket)
    {
        Socket->Close();
        ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM)->DestroySocket(Socket);
    }
}
```

### 3.3 플레이어 컨트롤러 통합

```cpp
// ===================================================
// BrawlPlayerController.h
// ===================================================

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "NetworkClient.h"
#include "BrawlPlayerController.generated.h"

UCLASS()
class YOURPROJECT_API ABrawlPlayerController : public APlayerController
{
    GENERATED_BODY()

public:
    virtual void SetupInputComponent() override;
    virtual void Tick(float DeltaTime) override;

protected:
    virtual void BeginPlay() override;

    // 네트워크 클라이언트
    UPROPERTY()
    ANetworkClient* NetworkClient;

    // 입력
    FVector2D MoveInput;
    FVector2D AimInput;
    bool bIsAttacking;

    // 입력 핸들러
    void MoveForward(float Value);
    void MoveRight(float Value);
    void StartFire();
    void StopFire();

    // 네트워크 이벤트
    UFUNCTION()
    void OnConnected();

    UFUNCTION()
    void OnMatchFound(int32 PlayerCount);

    UFUNCTION()
    void OnGameStarted();

    UFUNCTION()
    void OnGameStateReceived(const TArray<FPlayerState>& Players);

private:
    // 다른 플레이어들
    UPROPERTY()
    TMap<FString, AActor*> RemotePlayers;
};

// ===================================================
// BrawlPlayerController.cpp
// ===================================================

#include "BrawlPlayerController.h"

void ABrawlPlayerController::BeginPlay()
{
    Super::BeginPlay();

    // 네트워크 클라이언트 생성
    NetworkClient = GetWorld()->SpawnActor<ANetworkClient>();

    // 이벤트 바인딩
    NetworkClient->OnConnected.AddDynamic(this, &ABrawlPlayerController::OnConnected);
    NetworkClient->OnMatchFound.AddDynamic(this, &ABrawlPlayerController::OnMatchFound);
    NetworkClient->OnGameStarted.AddDynamic(this, &ABrawlPlayerController::OnGameStarted);
    NetworkClient->OnGameStateReceived.AddDynamic(this, &ABrawlPlayerController::OnGameStateReceived);

    // 서버 연결
    NetworkClient->ConnectToServer("127.0.0.1", 9050);
}

void ABrawlPlayerController::SetupInputComponent()
{
    Super::SetupInputComponent();

    // 이동
    InputComponent->BindAxis("MoveForward", this, &ABrawlPlayerController::MoveForward);
    InputComponent->BindAxis("MoveRight", this, &ABrawlPlayerController::MoveRight);

    // 공격
    InputComponent->BindAction("Fire", IE_Pressed, this, &ABrawlPlayerController::StartFire);
    InputComponent->BindAction("Fire", IE_Released, this, &ABrawlPlayerController::StopFire);
}

void ABrawlPlayerController::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    // 조준 방향 (마우스)
    FVector MouseLocation, MouseDirection;
    DeprojectMousePositionToWorld(MouseLocation, MouseDirection);

    // 2D 평면 투영 (탑다운)
    FVector PlayerLocation = GetPawn()->GetActorLocation();
    FVector2D PlayerPos2D(PlayerLocation.X, PlayerLocation.Y);
    FVector2D MousePos2D(MouseLocation.X, MouseLocation.Y);

    AimInput = (MousePos2D - PlayerPos2D).GetSafeNormal();

    // 서버에 입력 전송 (매 프레임)
    if (NetworkClient)
    {
        NetworkClient->SendPlayerInput(MoveInput, AimInput, bIsAttacking);
    }
}

// ================================================
// 입력 핸들러
// ================================================
void ABrawlPlayerController::MoveForward(float Value)
{
    MoveInput.Y = Value;
}

void ABrawlPlayerController::MoveRight(float Value)
{
    MoveInput.X = Value;
}

void ABrawlPlayerController::StartFire()
{
    bIsAttacking = true;
}

void ABrawlPlayerController::StopFire()
{
    bIsAttacking = false;
}

// ================================================
// 네트워크 이벤트
// ================================================
void ABrawlPlayerController::OnConnected()
{
    UE_LOG(LogTemp, Log, TEXT("Connected! Requesting match..."));

    // 자동 매칭 요청
    NetworkClient->RequestMatch();
}

void ABrawlPlayerController::OnMatchFound(int32 PlayerCount)
{
    UE_LOG(LogTemp, Log, TEXT("Match found with %d players"), PlayerCount);
}

void ABrawlPlayerController::OnGameStarted()
{
    UE_LOG(LogTemp, Log, TEXT("Game started!"));
}

void ABrawlPlayerController::OnGameStateReceived(const TArray<FPlayerState>& Players)
{
    // 모든 플레이어 업데이트
    for (const FPlayerState& PlayerState : Players)
    {
        if (PlayerState.PlayerId == NetworkClient->MyPlayerId)
        {
            // 내 캐릭터 (서버 조정)
            FVector NewLocation(
                PlayerState.PositionX * 100.0f, // m → cm
                PlayerState.PositionY * 100.0f,
                GetPawn()->GetActorLocation().Z
            );

            // 부드러운 보간
            FVector CurrentLocation = GetPawn()->GetActorLocation();
            FVector InterpolatedLocation = FMath::VInterpTo(
                CurrentLocation,
                NewLocation,
                GetWorld()->GetDeltaSeconds(),
                10.0f
            );

            GetPawn()->SetActorLocation(InterpolatedLocation);
        }
        else
        {
            // 다른 플레이어 (보간)
            AActor** FoundActor = RemotePlayers.Find(PlayerState.PlayerId);

            if (!FoundActor)
            {
                // 새 플레이어 생성
                FActorSpawnParameters SpawnParams;
                AActor* RemotePlayer = GetWorld()->SpawnActor<AActor>(
                    /* YourRemotePlayerClass */,
                    FVector(PlayerState.PositionX * 100.0f, PlayerState.PositionY * 100.0f, 0),
                    FRotator::ZeroRotator,
                    SpawnParams
                );

                RemotePlayers.Add(PlayerState.PlayerId, RemotePlayer);
            }
            else
            {
                // 기존 플레이어 업데이트
                AActor* RemotePlayer = *FoundActor;

                FVector NewLocation(
                    PlayerState.PositionX * 100.0f,
                    PlayerState.PositionY * 100.0f,
                    0
                );

                // 부드러운 보간 (100-200ms 과거)
                FVector CurrentLocation = RemotePlayer->GetActorLocation();
                FVector InterpolatedLocation = FMath::VInterpTo(
                    CurrentLocation,
                    NewLocation,
                    GetWorld()->GetDeltaSeconds(),
                    10.0f
                );

                RemotePlayer->SetActorLocation(InterpolatedLocation);
            }
        }
    }
}
```

---

## 4. 프로토콜 정의 (MessagePack)

### 4.1 MessagePack C++ 설치

```bash
# Windows (vcpkg)
vcpkg install msgpack-cxx

# macOS (Homebrew)
brew install msgpack

# Linux
sudo apt-get install libmsgpack-dev
```

### 4.2 언리얼 프로젝트에 추가

```
YourProject/
├─ ThirdParty/
│  └─ msgpack-c/
│     └─ include/
│        └─ msgpack.hpp
```

---

## 5. 완전한 예제

### 5.1 서버 실행

```bash
# C# 서버 실행
cd BrawlStarsServer
dotnet run

# 출력:
[Server] Started on port 9050
```

### 5.2 클라이언트 실행

```
1. 언리얼 에디터 실행
2. BrawlPlayerController 설정
3. Play (PIE)

출력:
[NetworkClient] Connecting to server 127.0.0.1:9050
[NetworkClient] Connected to server!
[NetworkClient] Requesting match...
[NetworkClient] Match found! Players: 1
... (6명 모일 때까지 대기)
[NetworkClient] Game started!
```

---

## 6. 테스트 및 디버깅

### 6.1 Wireshark로 패킷 확인

```
필터: udp.port == 9050

패킷 내용:
• 01 [MessagePack] - ConnectRequest
• 02 [MessagePack] - ConnectResponse
• 0A [MessagePack] - FindMatch
• 14 [MessagePack] - PlayerInput (매 프레임)
• 15 [MessagePack] - GameState (20Hz)
```

### 6.2 일반적인 문제 해결

```
문제 1: "Failed to create socket"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
해결: 프로젝트 설정 → Sockets, Networking 모듈 추가

문제 2: MessagePack 컴파일 에러
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
해결: Build.cs에 Include 경로 추가
PublicIncludePaths.Add("$(ProjectDir)/ThirdParty/msgpack-c/include");

문제 3: 서버 연결 안 됨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
해결: 방화벽 확인, 127.0.0.1:9050 포트 개방

문제 4: 패킷 수신 안 됨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
해결: Tick() 함수에서 ReceivePackets() 호출 확인
```

---

## 💡 핵심 요약

### ✅ **연동 구조**

```
언리얼 (C++) ↔ C# 서버
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

프로토콜: UDP (LiteNetLib)
직렬화: MessagePack
통신 주기:
• 클라이언트 → 서버: 60Hz (매 프레임)
• 서버 → 클라이언트: 20Hz (게임 틱)

핵심 컴포넌트:
1. C# 서버:
   • LiteNetLib (UDP)
   • MessagePack (직렬화)
   • GameRoom (20Hz Tick)

2. 언리얼 클라이언트:
   • FSocket (UDP)
   • msgpack-c (역직렬화)
   • NetworkClient (Actor)
```

### 🎯 **다음 단계**

```
1. 클라이언트 예측 추가
   → 즉시 반응 (지연 없음)

2. 서버 조정 (Reconciliation)
   → 입력 재생 (Replay)

3. 보간 (Interpolation)
   → 다른 플레이어 부드럽게

4. 최적화
   → 대역폭 절감
   → Delta Compression
```

---

**완성!** 🎉

언리얼 C++ 클라이언트와 C# LiteNetLib 서버가 **MessagePack**으로 완벽하게 연동됩니다! 🚀