---
title: "Event System Deep Dive (이벤트 시스템 심화)"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Event System Deep Dive (이벤트 시스템 심화)

## 🧭 개요

Niagara Event System은 **파티클 간 또는 Emitter 간 통신**을 가능하게 합니다. 파티클이 특정 조건을 만족할 때 이벤트를 발생시키고, 다른 파티클이나 Emitter가 이를 수신하여 반응할 수 있습니다.

**핵심 개념:**
- **Event Generator**: 이벤트 생성 (Collision, Death, Custom)
- **Event Handler**: 이벤트 수신 및 처리
- **Event Payload**: 이벤트와 함께 전달되는 데이터 (Position, Velocity 등)
- **Cross-Emitter Communication**: Emitter 간 데이터 교환

---

## 🧱 주요 구성 요소

### 1. **Event Generator (이벤트 생성기)**

```cpp
// Particle Death Event
if (Particle.Age > Particle.Lifetime)
{
    // Event Payload 구성
    EventData.Position = Particle.Position;
    EventData.Velocity = Particle.Velocity;
    EventData.Color = Particle.Color;

    // Event 발생
    EmitEvent("OnDeath", EventData);
}
```

**일반적인 Event Types:**
- **Collision Event**: 파티클이 충돌할 때
- **Death Event**: 파티클이 죽을 때
- **Custom Event**: 사용자 정의 조건

### 2. **Event Handler (이벤트 핸들러)**

```cpp
// "OnDeath" Event 수신
OnReceiveEvent("OnDeath")
{
    // Event Payload에서 데이터 읽기
    FVector SpawnPosition = EventData.Position;
    FVector SpawnVelocity = EventData.Velocity;

    // 새 파티클 생성 (예: 폭발 효과)
    SpawnParticle(SpawnPosition, SpawnVelocity);
}
```

---

## 💡 주요 사용 사례

### 예시 1: Death Event로 Spawn

```
Emitter A (Main Particles):
    - Update Script에서 Death 감지
    - "OnDeath" Event 생성 (Position, Velocity 전달)

Emitter B (Explosion Particles):
    - Event Handler: "OnDeath" 수신
    - Spawn Script에서 Event Payload 읽기
    - 죽은 파티클 위치에 폭발 생성
```

### 예시 2: Collision Event Chain

```
Emitter A (Projectile):
    - Collision Detection
    - "OnCollision" Event 생성 (Hit Location, Normal)

Emitter B (Impact Effect):
    - "OnCollision" Event 수신
    - Impact 위치에 Spark 생성

Emitter C (Decal):
    - "OnCollision" Event 수신
    - Surface에 Decal 배치
```

### 예시 3: Persistent ID를 사용한 Target Tracking

```
Emitter A (Target Markers):
    - 각 파티클에 Persistent ID 할당
    - "OnTargetUpdate" Event 주기적 발생
    - Payload: ParticleID, Position

Emitter B (Homing Missiles):
    - "OnTargetUpdate" Event 수신
    - ParticleID로 Target 추적
    - Target Position으로 향하는 Velocity 계산
```

---

## ⚠️ 주의사항

### ❌ 피해야 할 것

**1. 과도한 Event 생성:**
```cpp
// ❌ 매 프레임 모든 파티클이 Event 생성
for (Particle in AllParticles)
{
    EmitEvent("Update", Particle);  // 10,000+ events/frame → 성능 저하!
}
```

**2. Event Handler 무한 루프:**
```cpp
// ❌ Emitter A → Event → Emitter B → Event → Emitter A → ...
// 무한 재귀 발생!
```

### ✅ 올바른 방법

**1. 조건부 Event 생성:**
```cpp
// ✅ 필요한 경우에만 Event 생성
if (ImportantCondition)
{
    EmitEvent("ImportantEvent", Data);
}
```

**2. Event Throttling:**
```cpp
// ✅ 일정 시간마다만 Event 생성
if (TimeSinceLastEvent > MinEventInterval)
{
    EmitEvent("ThrottledEvent", Data);
    TimeSinceLastEvent = 0;
}
```

---

## 🔗 참조 자료

**소스 파일:**
- `NiagaraDataSet.h` (Event DataSet)
- `NiagaraEmitterInstance.cpp` (Event Handler 실행)

**관련 문서:**
- [Memory_Management.md](Memory_Management.md) - Event DataSet 관리
- [Parameter_System.md](Parameter_System.md) - Event Payload 전달

---

> 🔄 작성: 2025-11-22 — Niagara Event System 개요
