---
title: "Unreal ↔ C# 서버 메시지 프로토콜 확장 가이드"
date: "2025-11-26"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Networking"
tags: ["unreal", "Networking"]
---
# Unreal ↔ C# 서버 메시지 프로토콜 확장 가이드

## 🎯 개요

이 문서는 MessagePack을 사용하는 Unreal C++ 클라이언트와 C# 서버 간 메시지 프로토콜을 추가/수정하는 방법을 설명합니다.

**핵심 원칙:**
> MessagePack은 **스키마리스(Schemaless)** 직렬화 포맷이므로,
> 양쪽에서 **동일한 필드 순서와 타입**을 유지해야 합니다.

---

## 📂 프로토콜 정의 파일 구조

```
프로젝트/
├── Server (C#)
│   └── Protocol/
│       ├── MessageTypes.cs          // 메시지 ID 정의
│       └── Messages/
│           ├── PlayerMessage.cs     // 플레이어 관련 메시지
│           ├── GameplayMessage.cs   // 게임플레이 메시지
│           └── ChatMessage.cs       // 채팅 메시지
│
└── Client (Unreal C++)
    └── Source/YourProject/Network/
        ├── MessageTypes.h            // 메시지 ID 정의 (C# 동기화)
        └── Messages/
            ├── PlayerMessage.h
            ├── GameplayMessage.h
            └── ChatMessage.h
```

---

## 📐 메시지 추가 단계별 가이드

### Step 1: 메시지 ID 정의 (양쪽 동기화)

#### C# (MessageTypes.cs)
```csharp
public enum MessageType : byte
{
    // 기존 메시지
    Connect = 1,
    PlayerMove = 2,
    PlayerState = 3,

    // ✨ 새로 추가하는 메시지
    PlayerShoot = 4,         // 플레이어 발사
    PlayerDamage = 5,        // 데미지 이벤트
    PlayerUseSkill = 6       // 스킬 사용
}
```

#### C++ (MessageTypes.h)
```cpp
// 📂 위치: Source/YourProject/Network/MessageTypes.h

#pragma once

enum class EMessageType : uint8
{
    // 기존 메시지
    Connect = 1,
    PlayerMove = 2,
    PlayerState = 3,

    // ✨ 새로 추가하는 메시지 (C#과 동일한 번호)
    PlayerShoot = 4,
    PlayerDamage = 5,
    PlayerUseSkill = 6
};
```

**⚠️ 주의사항:**
- 메시지 ID는 **양쪽에서 반드시 동일**해야 합니다
- 기존 메시지 ID는 **절대 변경 금지** (하위 호환성 깨짐)
- 새 메시지는 **가장 큰 번호 + 1**로 추가

---

### Step 2: C# 메시지 클래스 정의

```csharp
// 📂 위치: Server/Protocol/Messages/GameplayMessage.cs

using MessagePack;

namespace GameServer.Protocol.Messages
{
    /// <summary>
    /// 플레이어 발사 요청 (Client → Server)
    /// </summary>
    [MessagePackObject]
    public class PlayerShootRequest
    {
        [Key(0)]
        public int PlayerId { get; set; }

        [Key(1)]
        public float DirectionX { get; set; }  // 발사 방향 (정규화된 벡터)

        [Key(2)]
        public float DirectionY { get; set; }

        [Key(3)]
        public byte WeaponType { get; set; }   // 무기 종류 (0=기본, 1=샷건, 2=스나이퍼)
    }

    /// <summary>
    /// 데미지 이벤트 브로드캐스트 (Server → All Clients)
    /// </summary>
    [MessagePackObject]
    public class PlayerDamageEvent
    {
        [Key(0)]
        public int AttackerId { get; set; }    // 공격자 ID

        [Key(1)]
        public int VictimId { get; set; }      // 피해자 ID

        [Key(2)]
        public float Damage { get; set; }      // 데미지 양

        [Key(3)]
        public float VictimHP { get; set; }    // 피해자의 남은 HP

        [Key(4)]
        public bool IsKill { get; set; }       // 킬 여부
    }
}
```

**핵심 규칙:**
- `[MessagePackObject]` - 클래스 어트리뷰트 필수
- `[Key(n)]` - 필드 순서 지정 (0부터 시작, **순서 중요!**)
- 필드 타입은 MessagePack에서 지원하는 타입만 사용 가능

---

### Step 3: C++ 메시지 구조체 정의

```cpp
// 📂 위치: Source/YourProject/Network/Messages/GameplayMessage.h

#pragma once
#include "CoreMinimal.h"

/**
 * 플레이어 발사 요청 (Client → Server)
 * C#의 PlayerShootRequest와 동일한 구조
 */
struct FPlayerShootRequest
{
    int32 PlayerId;
    float DirectionX;
    float DirectionY;
    uint8 WeaponType;

    // MessagePack 직렬화
    void Serialize(msgpack::packer<msgpack::sbuffer>& Packer) const
    {
        Packer.pack_array(4);  // 필드 개수
        Packer.pack(PlayerId);     // Key(0)
        Packer.pack(DirectionX);   // Key(1)
        Packer.pack(DirectionY);   // Key(2)
        Packer.pack(WeaponType);   // Key(3)
    }
};

/**
 * 데미지 이벤트 브로드캐스트 (Server → All Clients)
 * C#의 PlayerDamageEvent와 동일한 구조
 */
struct FPlayerDamageEvent
{
    int32 AttackerId;
    int32 VictimId;
    float Damage;
    float VictimHP;
    bool IsKill;

    // MessagePack 역직렬화
    static FPlayerDamageEvent Deserialize(const msgpack::object& Obj)
    {
        FPlayerDamageEvent Event;

        // C#의 [Key(n)] 순서와 동일하게 파싱
        Event.AttackerId = Obj.via.array.ptr[0].as<int32>();     // Key(0)
        Event.VictimId = Obj.via.array.ptr[1].as<int32>();       // Key(1)
        Event.Damage = Obj.via.array.ptr[2].as<float>();         // Key(2)
        Event.VictimHP = Obj.via.array.ptr[3].as<float>();       // Key(3)
        Event.IsKill = Obj.via.array.ptr[4].as<bool>();          // Key(4)

        return Event;
    }
};
```

**타입 매핑 (C# ↔ C++):**

| C# Type | C++ Type | MessagePack Type |
|---------|----------|------------------|
| `int` | `int32` | integer |
| `float` | `float` | float32 |
| `double` | `double` | float64 |
| `bool` | `bool` | boolean |
| `byte` | `uint8` | integer (0-255) |
| `string` | `FString` | string |
| `List<T>` | `TArray<T>` | array |

---

### Step 4: 서버에서 메시지 처리 (C#)

```csharp
// 📂 위치: Server/GameServer.cs

using MessagePack;
using GameServer.Protocol.Messages;

public class GameServer
{
    private void ProcessPacket(NetPeer peer, byte[] data)
    {
        MessageType msgType = (MessageType)data[0];
        byte[] payload = data.Skip(1).ToArray();

        switch (msgType)
        {
            // ✨ 새로 추가한 메시지 처리
            case MessageType.PlayerShoot:
                HandlePlayerShoot(peer, payload);
                break;

            case MessageType.PlayerUseSkill:
                HandlePlayerUseSkill(peer, payload);
                break;
        }
    }

    private void HandlePlayerShoot(NetPeer peer, byte[] payload)
    {
        // 1. 역직렬화
        var request = MessagePackSerializer.Deserialize<PlayerShootRequest>(payload);

        // 2. 게임 로직 실행
        Player player = GetPlayer(request.PlayerId);
        if (player == null) return;

        // 발사 검증 (쿨다운, 탄약 등)
        if (!player.CanShoot()) return;

        // 투사체 생성
        Projectile projectile = CreateProjectile(
            player.Position,
            new Vector2(request.DirectionX, request.DirectionY),
            request.WeaponType
        );

        // 충돌 검사 및 데미지 처리
        Player victim = CheckProjectileHit(projectile);
        if (victim != null)
        {
            float damage = CalculateDamage(request.WeaponType);
            victim.HP -= damage;

            // 3. 모든 클라이언트에 브로드캐스트
            var damageEvent = new PlayerDamageEvent
            {
                AttackerId = request.PlayerId,
                VictimId = victim.Id,
                Damage = damage,
                VictimHP = victim.HP,
                IsKill = victim.HP <= 0
            };

            BroadcastDamageEvent(damageEvent);
        }
    }

    private void BroadcastDamageEvent(PlayerDamageEvent damageEvent)
    {
        // MessagePack 직렬화
        byte[] payload = MessagePackSerializer.Serialize(damageEvent);

        // 메시지 타입 추가
        byte[] packet = new byte[payload.Length + 1];
        packet[0] = (byte)MessageType.PlayerDamage;
        Array.Copy(payload, 0, packet, 1, payload.Length);

        // 모든 플레이어에게 전송
        foreach (var peer in _server.ConnectedPeerList)
        {
            peer.Send(packet, DeliveryMethod.ReliableOrdered);
        }
    }
}
```

---

### Step 5: 클라이언트에서 메시지 송수신 (Unreal C++)

#### 발사 요청 전송

```cpp
// 📂 위치: Source/YourProject/Network/NetworkClient.cpp

void UNetworkClient::SendShootRequest(const FVector2D& Direction, uint8 WeaponType)
{
    // 1. 메시지 생성
    FPlayerShootRequest Request;
    Request.PlayerId = LocalPlayerId;
    Request.DirectionX = Direction.X;
    Request.DirectionY = Direction.Y;
    Request.WeaponType = WeaponType;

    // 2. MessagePack 직렬화
    msgpack::sbuffer Buffer;
    msgpack::packer<msgpack::sbuffer> Packer(&Buffer);
    Request.Serialize(Packer);

    // 3. 메시지 타입 헤더 추가
    TArray<uint8> Packet;
    Packet.Add(static_cast<uint8>(EMessageType::PlayerShoot));  // [0] = 메시지 타입
    Packet.Append((uint8*)Buffer.data(), Buffer.size());         // [1~] = 페이로드

    // 4. 전송
    int32 BytesSent;
    Socket->SendTo(Packet.GetData(), Packet.Num(), BytesSent, *ServerAddress);
}
```

#### 데미지 이벤트 수신

```cpp
// 📂 위치: Source/YourProject/Network/NetworkClient.cpp

void UNetworkClient::ReceiveData()
{
    uint8 Buffer[2048];
    int32 BytesRead;

    if (Socket->Recv(Buffer, sizeof(Buffer), BytesRead))
    {
        // 1. 메시지 타입 파싱
        EMessageType MsgType = static_cast<EMessageType>(Buffer[0]);

        // 2. 페이로드 파싱
        msgpack::object_handle Handle = msgpack::unpack(
            reinterpret_cast<char*>(Buffer + 1),
            BytesRead - 1
        );

        msgpack::object Obj = Handle.get();

        // 3. 메시지별 처리
        switch (MsgType)
        {
            case EMessageType::PlayerDamage:
            {
                FPlayerDamageEvent Event = FPlayerDamageEvent::Deserialize(Obj);
                HandleDamageEvent(Event);
                break;
            }
        }
    }
}

void UNetworkClient::HandleDamageEvent(const FPlayerDamageEvent& Event)
{
    UE_LOG(LogNet, Log, TEXT("Player %d damaged Player %d for %.1f HP (Remaining: %.1f)"),
        Event.AttackerId, Event.VictimId, Event.Damage, Event.VictimHP);

    // 1. 피해자 찾기
    APlayerCharacter* Victim = FindPlayerById(Event.VictimId);
    if (Victim)
    {
        // 2. HP 업데이트
        Victim->SetHP(Event.VictimHP);

        // 3. 이펙트 재생
        Victim->PlayDamageEffect(Event.Damage);

        // 4. 킬 처리
        if (Event.IsKill)
        {
            Victim->Die();

            APlayerCharacter* Attacker = FindPlayerById(Event.AttackerId);
            if (Attacker)
            {
                Attacker->OnKillEnemy();
            }
        }
    }
}
```

---

## 🔧 메시지 수정 시나리오

### 시나리오 1: 기존 메시지에 필드 추가

**문제:** `PlayerMoveRequest`에 점프 상태를 추가하고 싶음

#### ❌ 잘못된 방법 (하위 호환성 깨짐)

```csharp
// C# - 기존 메시지
[MessagePackObject]
public class PlayerMoveRequest
{
    [Key(0)] public int PlayerId;
    [Key(1)] public float X;
    [Key(2)] public float Y;
    // ❌ 중간에 필드 추가 금지!
    [Key(3)] public bool IsJumping;  // 기존 클라이언트가 파싱 실패
}
```

#### ✅ 올바른 방법 (하위 호환성 유지)

```csharp
// C# - 필드는 끝에 추가
[MessagePackObject]
public class PlayerMoveRequest
{
    [Key(0)] public int PlayerId;
    [Key(1)] public float X;
    [Key(2)] public float Y;
    [Key(3)] public float VelocityX;
    [Key(4)] public float VelocityY;
    // ✅ 새 필드는 마지막에 추가
    [Key(5)] public bool IsJumping;   // 옵셔널 필드
}
```

```cpp
// C++ - 역직렬화 시 필드 개수 체크
struct FPlayerMoveRequest
{
    int32 PlayerId;
    float X, Y;
    float VelocityX, VelocityY;
    bool IsJumping;  // 기본값 false

    static FPlayerMoveRequest Deserialize(const msgpack::object& Obj)
    {
        FPlayerMoveRequest Request;

        int32 FieldCount = Obj.via.array.size;

        Request.PlayerId = Obj.via.array.ptr[0].as<int32>();
        Request.X = Obj.via.array.ptr[1].as<float>();
        Request.Y = Obj.via.array.ptr[2].as<float>();
        Request.VelocityX = Obj.via.array.ptr[3].as<float>();
        Request.VelocityY = Obj.via.array.ptr[4].as<float>();

        // ✅ 새 필드는 옵셔널로 처리
        if (FieldCount >= 6)
        {
            Request.IsJumping = Obj.via.array.ptr[5].as<bool>();
        }
        else
        {
            Request.IsJumping = false;  // 기본값
        }

        return Request;
    }
};
```

---

### 시나리오 2: 복잡한 데이터 타입 (배열, 중첩 구조)

#### 예시: 스킬 사용 메시지 (다중 타겟)

```csharp
// C# - 중첩 구조
[MessagePackObject]
public class SkillTarget
{
    [Key(0)] public int TargetId;
    [Key(1)] public float DamageMultiplier;  // 타겟별 데미지 배율
}

[MessagePackObject]
public class PlayerUseSkillRequest
{
    [Key(0)] public int PlayerId;
    [Key(1)] public byte SkillId;
    [Key(2)] public float PositionX;      // 스킬 중심 위치
    [Key(3)] public float PositionY;
    [Key(4)] public List<SkillTarget> Targets;  // 다중 타겟
}
```

```cpp
// C++ - 중첩 구조 역직렬화
struct FSkillTarget
{
    int32 TargetId;
    float DamageMultiplier;

    static FSkillTarget Deserialize(const msgpack::object& Obj)
    {
        FSkillTarget Target;
        Target.TargetId = Obj.via.array.ptr[0].as<int32>();
        Target.DamageMultiplier = Obj.via.array.ptr[1].as<float>();
        return Target;
    }
};

struct FPlayerUseSkillRequest
{
    int32 PlayerId;
    uint8 SkillId;
    float PositionX, PositionY;
    TArray<FSkillTarget> Targets;

    static FPlayerUseSkillRequest Deserialize(const msgpack::object& Obj)
    {
        FPlayerUseSkillRequest Request;

        Request.PlayerId = Obj.via.array.ptr[0].as<int32>();
        Request.SkillId = Obj.via.array.ptr[1].as<uint8>();
        Request.PositionX = Obj.via.array.ptr[2].as<float>();
        Request.PositionY = Obj.via.array.ptr[3].as<float>();

        // ✅ 배열 파싱
        const msgpack::object& TargetsArray = Obj.via.array.ptr[4];
        for (uint32 i = 0; i < TargetsArray.via.array.size; ++i)
        {
            FSkillTarget Target = FSkillTarget::Deserialize(TargetsArray.via.array.ptr[i]);
            Request.Targets.Add(Target);
        }

        return Request;
    }
};
```

---

## 📋 프로토콜 버전 관리 체크리스트

### 새 메시지 추가 시

- [ ] C#의 `MessageType` enum에 새 ID 추가
- [ ] C++의 `EMessageType` enum에 **동일한 번호**로 추가
- [ ] C#에 메시지 클래스 정의 (`[MessagePackObject]`, `[Key(n)]`)
- [ ] C++에 메시지 구조체 정의 (`Serialize`/`Deserialize` 구현)
- [ ] C# 서버에 메시지 핸들러 추가 (`switch-case`)
- [ ] C++ 클라이언트에 메시지 핸들러 추가 (`switch-case`)
- [ ] 양쪽에서 테스트 (직렬화/역직렬화 검증)

### 기존 메시지 수정 시

- [ ] **필드는 절대 중간에 추가 금지** - 마지막에만 추가
- [ ] 기존 필드 순서 변경 금지
- [ ] 기존 필드 타입 변경 금지
- [ ] 새 필드는 옵셔널로 처리 (기본값 설정)
- [ ] 역직렬화 시 필드 개수 체크로 하위 호환성 유지
- [ ] 프로토콜 버전 번호 업데이트 (`PROTOCOL_VERSION`)

---

## 💡 디버깅 팁

### 1. 메시지 직렬화 검증

```csharp
// C# - 직렬화 테스트
var request = new PlayerShootRequest
{
    PlayerId = 1,
    DirectionX = 0.707f,
    DirectionY = 0.707f,
    WeaponType = 2
};

byte[] serialized = MessagePackSerializer.Serialize(request);
Console.WriteLine($"Serialized: {BitConverter.ToString(serialized)}");

var deserialized = MessagePackSerializer.Deserialize<PlayerShootRequest>(serialized);
Debug.Assert(deserialized.PlayerId == 1);
```

```cpp
// C++ - 역직렬화 테스트
FPlayerShootRequest Request;
Request.PlayerId = 1;
Request.DirectionX = 0.707f;
Request.DirectionY = 0.707f;
Request.WeaponType = 2;

// 직렬화
msgpack::sbuffer Buffer;
msgpack::packer<msgpack::sbuffer> Packer(&Buffer);
Request.Serialize(Packer);

// 역직렬화
msgpack::object_handle Handle = msgpack::unpack(Buffer.data(), Buffer.size());
FPlayerShootRequest Deserialized = FPlayerShootRequest::Deserialize(Handle.get());

check(Deserialized.PlayerId == 1);
```

### 2. 메시지 로깅

```cpp
// C++ - 수신 메시지 헥스 덤프
void UNetworkClient::LogReceivedPacket(const uint8* Data, int32 Size)
{
    FString HexDump;
    for (int32 i = 0; i < Size; ++i)
    {
        HexDump += FString::Printf(TEXT("%02X "), Data[i]);
        if ((i + 1) % 16 == 0) HexDump += TEXT("\n");
    }

    UE_LOG(LogNet, Verbose, TEXT("Received packet:\n%s"), *HexDump);
}
```

### 3. 일반적인 오류

| 증상 | 원인 | 해결책 |
|------|------|--------|
| 역직렬화 예외 | 필드 순서 불일치 | C#과 C++의 `[Key(n)]` 순서 확인 |
| 잘못된 값 파싱 | 타입 불일치 | C# `int` ↔ C++ `int32` 매핑 확인 |
| 메시지 무시됨 | 메시지 ID 불일치 | `MessageType` enum 동기화 확인 |
| 크래시 | 배열 인덱스 초과 | 필드 개수 체크 (`Obj.via.array.size`) |

---

## 🔗 참고 자료

- **MessagePack Specification:** https://github.com/msgpack/msgpack/blob/master/spec.md
- **MessagePack C# (MessagePack-CSharp):** https://github.com/MessagePack-CSharp/MessagePack-CSharp
- **MessagePack C++ (msgpack-c):** https://github.com/msgpack/msgpack-c
- **Unreal Engine UDP Sockets:** `Engine/Source/Runtime/Sockets/`

---

## ✅ 요약

1. **메시지 ID는 양쪽에서 동일하게 유지**
2. **필드 순서(`[Key(n)]`)는 절대 변경 금지**
3. **새 필드는 마지막에 추가 + 옵셔널 처리**
4. **타입 매핑 (C# ↔ C++) 정확히 일치**
5. **직렬화/역직렬화 테스트 필수**
6. **프로토콜 버전 관리로 호환성 유지**
