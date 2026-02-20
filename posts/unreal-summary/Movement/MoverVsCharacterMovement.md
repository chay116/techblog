---
title: "언리얼 엔진 무브먼트 시스템: Mover Plugin vs CharacterMovementComponent"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "GameFramework"
tags: ["unreal", "GameFramework", "Movement"]
---
# 언리얼 엔진 무브먼트 시스템: Mover Plugin vs CharacterMovementComponent

> 🔬 상태: 실험적 (Mover Plugin) vs 안정적 (CharacterMovementComponent)
>
> 🕒 최종 업데이트: 2025-11-07

## 🧭 1. 개요 (Overview)

### Mover Plugin: 혁신적인 실험적 무브먼트 시스템

#### 정의
Mover Plugin은 언리얼 엔진의 차세대 무브먼트 시스템으로, 기존 `CharacterMovementComponent`의 한계를 극복하기 위해 설계된 실험적인 프레임워크입니다. 모듈성, 확장성, 유연성에 중점을 두고 개발되었습니다.

#### 주요 특징
- 완전히 모듈형 아키텍처
- 동적 무브먼트 모드 지원
- 고급 네트워킹 백엔드 시스템 (Backend Liaison)
- 확장 가능한 무브먼트 수정자 (Movement Modifiers)
- 계층화된 무브먼트 시스템

### CharacterMovementComponent: 검증된 생산 시스템

#### 정의
`UCharacterMovementComponent`는 언리얼 엔진의 표준 무브먼트 컴포넌트로, 수년간 게임 개발자들에 의해 검증되고 최적화된 솔루션입니다. 대부분의 게임 프로젝트에서 기본 무브먼트 컴포넌트로 사용됩니다.

#### 주요 특징
- 단일 모놀리식 아키텍처
- 고정된 무브먼트 모드 열거형
- 내장된 네트워킹 지원
- 성능에 최적화
- 광범위한 커뮤니티 지원

### 두 시스템의 공존 이유

1. **진화적 접근**
   - Mover Plugin은 `CharacterMovementComponent`의 한계를 극복하기 위한 실험적 대안
   - 점진적 기술 혁신을 위한 플랫폼 제공

2. **유연성과 안정성의 균형**
   - 기존 시스템: 안정성과 성능
   - 새로운 시스템: 모듈성과 확장성

3. **다양한 개발 요구사항 충족**
   - 대규모 MMO: 복잡한 무브먼트 요구
   - 소규모 게임: 간단하고 최적화된 솔루션

### 비교 다이어그램

```
┌───────────────────────────────┐     ┌───────────────────────────────┐
│ CharacterMovementComponent    │     │ Mover Plugin                  │
├───────────────────────────────┤     ├───────────────────────────────┤
│ • 단일 컴포넌트               │     │ • 모듈형 컴포넌트 시스템      │
│ • 고정된 무브먼트 모드        │     │ • 동적 무브먼트 모드          │
│ • 제한된 확장성               │     │ • 높은 확장성                │
│ • 내장 네트워킹               │     │ • 백엔드 리에종 네트워킹      │
│ • 성능 최적화                 │     │ • 유연한 성능 설계            │
└───────────────────────────────┘     └───────────────────────────────┘
```

## 🏗️ 2. 아키텍처 비교

### 설계 철학: 단일 vs 모듈형

#### CharacterMovementComponent: 단일 모놀리식 디자인
```
┌─────────────────────────────────────┐
│     CharacterMovementComponent      │
│ ┌───────────────────────────────┐   │
│ │   단일 컴포넌트 내 모든 로직   │   │
│ │   - 하드코딩된 상태 머신      │   │
│ │   - 제한된 확장성             │   │
│ └───────────────────────────────┘   │
└─────────────────────────────────────┘
```

#### Mover Plugin: 모듈형 컴포넌트 아키텍처
```
┌─────────────────────────────────────┐
│           Mover Plugin              │
│ ┌───────────────────────────────┐   │
│ │   계층화된 모듈식 컴포넌트     │   │
│ │   - 동적 모드 시스템          │   │
│ │   - 플러그형 수정자           │   │
│ │   - 고도의 확장성             │   │
│ └───────────────────────────────┘   │
└─────────────────────────────────────┘
```

### 무브먼트 모드 시스템

| 특성 | CharacterMovementComponent | Mover Plugin |
|------|----------------------------|--------------|
| 모드 정의 | 고정된 열거형 (`EMovementMode`) | 동적 클래스 기반 시스템 |
| 확장성 | 제한적 (미리 정의됨) | 무제한 (런타임 생성 가능) |
| 커스터마이징 | 상속 필요 | 플러그인 방식 |
| 전환 메커니즘 | 수동 전환 | 자동/수동 전환 지원 |

### 네트워킹 백엔드

#### CharacterMovementComponent
- 내장된 네트워킹 로직
- 클라이언트-서버 동기화
- 제한된 커스터마이징 옵션

#### Mover Plugin: Backend Liaison
```
┌─────────────────────┐   ┌─────────────────┐
│ 클라이언트           │   │ 서버            │
│   └─ 움직임 예측     │◄► │   └─ 권한 검증  │
│   └─ 보간            │   │   └─ 상태 관리  │
└─────────────────────┘   └─────────────────┘
```

- 플러그형 네트워킹 백엔드
- 동적 권한 및 동기화 메커니즘
- 고급 보간 및 예측 지원

## 🔍 3. 핵심 차이점

### 무브먼트 모드

#### CharacterMovementComponent
```cpp
enum EMovementMode
{
    MOVE_None = 0,
    MOVE_Walking,
    MOVE_NavWalking,
    MOVE_Falling,
    MOVE_Swimming,
    MOVE_Flying
};
```

#### Mover Plugin
```cpp
class UMoveMode : public UObject
{
    // 동적으로 정의 가능
    virtual void UpdateMovement(float DeltaTime);
    virtual bool CanTransitionTo(UMoveMode* NextMode);
};
```

### 무브먼트 수정자 (Mover 전용)

```cpp
class UMovementModifier
{
    // 움직임에 동적 영향을 줄 수 있는 플러그인 시스템
    virtual void ApplyModification(FMovementState& State);
};

// 예: 중력 영향 수정자
class UGravityModifier : public UMovementModifier
{
    float GravityScale = 1.0f;
};
```

### 인스턴트 무브먼트 효과

```cpp
// Mover Plugin: 즉각적인 상태 변경
class UInstantMovementEffect
{
    virtual void Apply(AActor* Target);
};

// 예: 순간 텔레포트
class UTeleportEffect : public UInstantMovementEffect
{
    void Apply(AActor* Target) override
    {
        Target->SetActorLocation(TargetLocation);
    }
};
```

### 네트워킹 차이점

| 특성 | CharacterMovementComponent | Mover Plugin |
|------|----------------------------|--------------|
| 동기화 | 내장된 RPC | 백엔드 리에종 시스템 |
| 지연 처리 | 제한적 | 고급 보간 지원 |
| 권한 모델 | 정적 | 동적, 플러그형 |

## 🔀 4. 마이그레이션 가이드

### 어떤 시스템을 선택해야 하나?

**CharacterMovementComponent 추천:**
- 전통적인 게임플레이
- 성능에 민감한 프로젝트
- 표준 무브먼트 요구사항
- 안정성 중시

**Mover Plugin 추천:**
- 복잡한 무브먼트 메커니즘
- 고도의 커스터마이징 필요
- MMO, 멀티플레이어 게임
- 실험적 기능 요구

### 마이그레이션 단계

1. 기존 `CharacterMovementComponent` 분석
2. Mover Plugin 컴포넌트로 점진적 대체
3. 주요 무브먼트 로직을 `UMoveMode`로 리팩토링
4. 네트워킹 로직을 Backend Liaison으로 마이그레이션

### 호환성 노트

- 일부 기능은 완전 호환되지 않음
- 성능 오버헤드 고려 필요
- 실험적 시스템이므로 주의 요망

## 🎮 5. 실전 예시: 캐릭터 점프

### CharacterMovementComponent

```cpp
void AMyCharacter::Jump()
{
    CharacterMovement->SetMovementMode(MOVE_Falling);
    // 하드코딩된 점프 로직
    LaunchCharacter(FVector::UpVector * JumpZVelocity, false, true);
}
```

### Mover Plugin

```cpp
// 점프 모드 정의
UCLASS()
class UJumpMoveMode : public UMoveMode
{
    void UpdateMovement(float DeltaTime) override
    {
        // 동적이고 확장 가능한 점프 로직
        ApplyVerticalVelocity(JumpStrength);
        CheckLanding();
    }
};

// 점프 트리거
void AMyCharacter::Jump()
{
    MoverComponent->SetMoveMode(UJumpMoveMode::StaticClass());
}
```

### 🏆 결론

Mover Plugin은 `CharacterMovementComponent`의 혁신적인 대안으로, 게임 개발의 미래를 엿볼 수 있는 실험적 시스템입니다. 하지만 아직 완전한 대체재는 아니며, 프로젝트의 요구사항과 성숙도를 신중히 고려해야 합니다.

---

### 🔗 참고 자료
- Unreal Engine 공식 문서
- Epic Games 개발자 블로그
- 커뮤니티 피드백 및 RFC