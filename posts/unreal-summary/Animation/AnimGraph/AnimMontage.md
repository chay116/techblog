---
title: "AnimMontage"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Animation"
tags: ["unreal", "Animation", "AnimGraph"]
---
# AnimMontage

> **📅 Version:** 2024-11-07
> **📍 위치:** `Engine/Source/Runtime/Engine/Classes/Animation/AnimMontage.h`

## 🧭 개요 (Overview)

AnimMontage는 언리얼 엔진의 애니메이션 시스템에서 **복합적이고 유연한 애니메이션 재생을 가능하게 하는 고급 애셋 타입**입니다. 기본 애니메이션 재생의 한계를 넘어, 개발자에게 더욱 세밀하고 동적인 애니메이션 제어 메커니즘을 제공합니다.

### 핵심 특징

- 다중 섹션 지원 (Multiple Sections)
- 슬롯 기반 애니메이션 레이어링
- 동적 섹션 전환
- 브랜칭 포인트와 커스텀 노티파이
- 블렌딩 및 인터럽트 가능한 애니메이션 재생

### 기본 애니메이션 vs AnimMontage

```
기본 애니메이션 재생:
[재생] → [종료]

AnimMontage:
[시작] → [섹션A] → [브랜칭] → [섹션B] → [블렌딩] → [종료]
```

### 사용 사례

1. **전투 시스템**
   - 다양한 공격 애니메이션
   - 연속 콤보 시퀀스
   - 상태별 동적 애니메이션 전환

2. **캐릭터 인터랙션**
   - 인터랙티브 리로드
   - 멀티 스테이지 동작
   - 상황 의존적 애니메이션

3. **게임플레이 피드백**
   - 피격 반응
   - 사망 애니메이션
   - 특수 이벤트 트리거

### 주요 컴포넌트

```
┌─────────────────────────┐
│      AnimMontage       │
├─────────────────────────┤
│ • 섹션 (Sections)      │
│ • 슬롯 트랙            │
│ • 브랜칭 포인트        │
│ • 블렌딩 설정          │
└─────────────────────────┘
```

## 🧱 설계 철학: 왜 AnimMontage인가?

### 기존 애니메이션 시스템의 한계

1. **단순 선형 재생**
   - 고정된 애니메이션 시퀀스
   - 제한적인 상호작용성
   - 복잡한 동작 표현 어려움

2. **블렌딩 제약**
   - 제한된 크로스페이딩
   - 부자연스러운 전환
   - 성능 오버헤드

3. **상태 관리 복잡성**
   - 애니메이션 상태 추적 어려움
   - 다중 레이어 애니메이션 관리 비효율

### AnimMontage의 해결 방법

```
문제: 복잡한 애니메이션 요구사항
└─ 솔루션: AnimMontage
   ├─ 유연한 섹션 시스템
   ├─ 동적 섹션 전환
   ├─ 성능 최적화된 블렌딩
   └─ 상태 관리 간소화
```

#### 핵심 설계 원칙

1. **모듈성 (Modularity)**
   - 독립적인 애니메이션 섹션
   - 재사용 가능한 컴포넌트
   - 최소 결합도

2. **확장성 (Extensibility)**
   - 런타임 수정 가능
   - 프로그래밍적 제어
   - 커스텀 노티파이 지원

3. **성능 효율성**
   - 최소 메모리 오버헤드
   - 캐시 친화적 설계
   - GPU 친화적 트랜지션

## 🧩 시스템 아키텍처

### 주요 클래스 상호작용

```
┌─────────────────┐     ┌─────────────────┐
│ UAnimMontage   │←────→ FAnimMontageInstance│
└─────────────────┘     └─────────────────┘
        ▲                       ▲
        │                       │
┌─────────────────┐     ┌─────────────────┐
│ FAnimNode_Slot │←────→ Skeletal Mesh    │
└─────────────────┘     └─────────────────┘
```

### UAnimMontage (애셋 클래스)

- 애니메이션 섹션, 슬롯, 노티파이 정의
- 블렌딩 및 재생 설정 저장
- 런타임 인스턴스 생성 템플릿

### FAnimMontageInstance (런타임 인스턴스)

- 실제 애니메이션 재생 상태 관리
- 현재 섹션 및 블렌딩 추적
- 동적 전환 및 인터럽트 처리

### FAnimNode_Slot (슬롯 노드)

- 애니메이션 레이어링 담당
- 독립적인 애니메이션 블렌딩
- 우선순위 기반 재생

## 🧬 클래스 구조

### UAnimMontage

#### 주요 멤버 및 구조

```cpp
// 파일 위치: Engine/Source/Runtime/Engine/Classes/Animation/AnimMontage.h:621
class UAnimMontage : public UAnimCompositeBase
{
    // 섹션 데이터
    UPROPERTY()
    TArray<FCompositeSection> CompositeSections;

    // 슬롯 트랙
    UPROPERTY()
    TArray<FSlotAnimationTrack> SlotAnimTracks;

    // 브랜칭 포인트
    UPROPERTY()
    TArray<FBranchingPointMarker> BranchingPointMarkers;

    // 블렌딩 설정
    UPROPERTY()
    FMontageBlendSettings BlendSettings;
};
```

### FAnimMontageInstance

```cpp
// 파일 위치: Engine/Source/Runtime/Engine/Classes/Animation/AnimMontage.h:334
struct FAnimMontageInstance
{
    // 현재 재생 중인 몽타주
    UAnimMontage* Montage;

    // 현재 섹션 인덱스
    int32 CurrentSectionIndex;

    // 블렌딩 가중치
    float BlendWeight;

    // 재생 상태
    EPlayState PlayState;
};
```

### FCompositeSection

```cpp
struct FCompositeSection
{
    // 섹션 이름
    FName SectionName;

    // 시작/종료 시간
    float StartTime;
    float EndTime;

    // 다음 섹션으로의 전환
    FName NextSectionName;
};
```

### FSlotAnimationTrack

```cpp
struct FSlotAnimationTrack
{
    // 슬롯 이름
    FName SlotName;

    // 애니메이션 시퀀스들
    TArray<FAnimSegment> AnimSegments;
};
```

## 🔄 생명주기 (Lifecycle)

### 몽타주 인스턴스 상태 흐름

```
[생성] → [초기화] → [재생 시작] → [섹션 전환] → [블렌딩] → [종료]
   ↓         ↓          ↓           ↓           ↓         ↓
Constructor PostInit   BeginPlay   JumpSection  Blend    Terminate
```

### 주요 상태 변환

1. **생성 (Creation)**
   - `UAnimMontage` 애셋 로드
   - 초기 파라미터 설정
   - 메모리 할당

2. **초기화 (Initialization)**
   - 섹션 인덱스 설정
   - 초기 블렌딩 파라미터 구성
   - 애니메이션 시퀀스 참조

3. **재생 (Playback)**
   - 현재 섹션 트래킹
   - 애니메이션 블렌딩
   - 노티파이 및 브랜칭 포인트 처리

4. **전환 (Transition)**
   - 섹션 간 동적 이동
   - 블렌딩 모드 적용
   - 상태 동기화

5. **종료 (Termination)**
   - 리소스 해제
   - 상태 초기화
   - 메모리 정리

## 🔧 핵심 기능

### 섹션 관리

```cpp
// 섹션 재생
Montage->Play(Character);

// 특정 섹션으로 점프
Montage->JumpToSection("AttackCombo");

// 다음 섹션 설정
Montage->SetNextSection("Start", "End");
```

### 슬롯 시스템

```cpp
// 슬롯 기반 애니메이션 오버레이
Character->GetMesh()->GetAnimInstance()
    ->Montage_Play(AttackMontage, 1.0f, EMontagePlayReturnType::Duration, 0.0f, false);
```

### 브랜칭 포인트

```cpp
// 몽타주 노티파이 예시
UFUNCTION()
void OnMontageStarted(UAnimMontage* Montage)
{
    // 몽타주 시작 시 호출
}

UFUNCTION()
void OnBranchingPoint(UAnimMontage* Montage, FName BranchPointName)
{
    // 브랜칭 포인트에서 로직 실행
}
```

### 블렌딩 모드

1. **표준 블렌딩 (Standard Blend)**
   ```cpp
   Montage->BlendIn.BlendTime = 0.2f;
   Montage->BlendOut.BlendTime = 0.2f;
   ```

2. **관성 블렌딩 (Inertialization)**
   ```cpp
   // 더 부드러운 전환을 위한 고급 블렌딩
   Montage->SetPlayRate(1.0f);
   ```

## 🚀 실전 예시

### ✅ 좋은 패턴

```cpp
// 전투 애니메이션 몽타주
void AMyCharacter::ExecuteCombo()
{
    // 첫 번째 공격
    if (!IsAttacking)
    {
        PlayAnimMontage(ComboMontage, 1.0f, "Combo1");
        IsAttacking = true;
    }
    // 추가 공격
    else
    {
        Montage_JumpToSection("Combo2", ComboMontage);
    }
}
```

### ❌ 나쁜 패턴

```cpp
// 반복적이고 비효율적인 애니메이션 관리
void AMyCharacter::PlayAnimation()
{
    // 독립적인 애니메이션 재생, 상태 추적 어려움
    PlayAnimMontage(AttackAnim);
    PlayAnimMontage(ReloadAnim);
    PlayAnimMontage(DodgeAnim);
}
```

## 🔬 성능 최적화 및 디버깅

### 성능 최적화 팁

1. **애니메이션 풀링**
   - 재사용 가능한 몽타주 캐시
   - 메모리 할당 최소화

2. **블렌딩 시간 최소화**
   ```cpp
   Montage->BlendIn.BlendTime = 0.1f;  // 빠른 전환
   ```

3. **섹션 사전 로드**
   - 대규모 몽타주의 경우 초기 로딩 시간 개선

### 디버깅 도구

1. **애니메이션 디버거**
   ```
   r.Animation.Debug 1           // 콘솔 명령
   stat animupdate               // 성능 통계
   ```

2. **브레이크포인트 설정**
   - `FAnimMontageInstance::Update()`
   - `UAnimMontage::CreateInstance()`

### 일반적인 함정

```
❌ 피해야 할 것:
- 과도한 섹션/슬롯 사용
- 비효율적인 블렌딩 설정
- 메모리 누수

✅ 권장사항:
- 섹션 재사용
- 최소한의 블렌딩
- 리소스 관리
```

## 📚 참고 자료

- **공식 문서:** [Unreal Engine Animation Montage](https://docs.unrealengine.com)
- **소스 코드:** `Engine/Source/Runtime/Engine/Classes/Animation/AnimMontage.h`
- **GDC 발표:** "Advanced Animation Techniques in Unreal Engine"

## 📅 버전 히스토리

- v1.0 (2024-11-07): 초기 문서 작성
- v1.1 (예정): 성능 최적화 섹션 확장