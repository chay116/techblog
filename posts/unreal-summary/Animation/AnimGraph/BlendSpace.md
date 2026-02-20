---
title: "BlendSpace (블렌드 스페이스)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Animation"
tags: ["unreal", "Animation", "AnimGraph"]
---
# BlendSpace

## 📍 개요 (Overview)

블렌드 스페이스(BlendSpace)는 언리얼 엔진의 고급 애니메이션 보간 시스템으로, 2D/3D 공간에서 애니메이션 클립을 동적으로 혼합할 수 있게 해주는 강력한 도구입니다.

### 핵심 개념

```
           AnimationClip A
              /        \
             /          \
           Position    Rotation
             \          /
              \        /
           AnimationClip B
```

**주요 특징:**
- 다차원 입력 기반 애니메이션 보간
- 삼각 측량(Triangulation) 알고리즘 사용
- 부드러운 애니메이션 전환
- 런타임 성능 최적화

### 사용 사례

1. 캐릭터 이동 애니메이션
2. 방향성 블렌딩
3. 상태 기반 애니메이션 전환

**📂 위치:** `Engine/Source/Runtime/Engine/Classes/Animation/BlendSpace.h`

## 🧭 설계 철학

블렌드 스페이스의 설계는 다음 원칙을 기반으로 합니다:

### 1. 입력 공간 추상화

```
   Input Space
  ┌───────────────┐
  │ X: 속도      │
  │ Y: 방향      │
  │ Z: 기울기    │
  └───────────────┘
```

### 2. 유연한 보간 메커니즘

- 선형 보간 (Lerp)
- 삼각 측량 기반 보간
- 사용자 정의 가능한 샘플 포인트

### 3. 성능 최적화

- 캐싱 메커니즘
- 최소 오버헤드 보간
- GPU 친화적 설계

### 4. 컴파일타임 vs 런타임

```
컴파일타임:
├── 샘플 포인트 정의
├── 삼각형 생성
├── 보간 맵 준비

런타임:
└── 입력 기반 빠른 보간
```

## 🧱 클래스 구조

### UBlendSpace

```cpp
class UBlendSpace : public UAnimationAsset
{
    // 샘플 포인트 배열
    UPROPERTY()
    TArray<FBlendSample> SamplePoints;

    // 보간 파라미터
    UPROPERTY()
    FBlendSpaceAxis AxisToScale;
};
```

### FAnimNode_BlendSpacePlayer

```cpp
struct FAnimNode_BlendSpacePlayer : public FAnimNode_AssetPlayerBase
{
    // 현재 블렌드 스페이스
    UPROPERTY()
    UBlendSpace* BlendSpace;

    // 입력 좌표
    UPROPERTY()
    FVector Position;
};
```

### 주요 구조체

#### FBlendSample
```cpp
struct FBlendSample
{
    UAnimSequence* Animation;  // 애니메이션 클립
    FVector SampleValue;        // 샘플 좌표
};
```

## ⚙️ 핵심 기능

### 삼각 측량 (Triangulation)

```
   Sample Points
     /  |  \
    /   |   \
   /    |    \
  A     P     B  <- 입력 지점 보간
```

**알고리즘 단계:**
1. 삼각형 찾기
2. 무게 중심 계산
3. 애니메이션 보간

### 입력 스무딩

```
Raw Input   → 스무딩 필터 → 부드러운 출력
   ↓             ↓           ↓
[각도]     → [보간]     → [최종 포즈]
```

**스무딩 기법:**
- 지수 이동 평균
- 칼만 필터
- 사용자 정의 스무딩

## 🎬 실전 예시

### 캐릭터 이동 블렌드 스페이스

```cpp
// 블렌드 스페이스 설정 예시
void AMyCharacter::SetupBlendSpace()
{
    // X: 속도, Y: 방향
    BlendSpace->AddSample(
        FVector(0.0f, 0.0f, 0.0f),   // 정지
        WalkAnimation
    );
    BlendSpace->AddSample(
        FVector(500.0f, 90.0f, 0.0f),  // 달리기
        RunAnimation
    );
}
```

> 🔄 Updated: 2025-11-07 — BlendSpace 기본 문서 작성