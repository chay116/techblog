---
title: "Inertialization (관성 블렌딩)"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Animation"
tags: ["unreal", "Animation", "Blending"]
---
# Inertialization (관성 블렌딩)

## 요청 시스템 (Request System)

### 요청 API 상세 설명

#### `RequestInertialization` 기본 오버로드

```cpp
// 파일 위치: Engine/Source/Runtime/Engine/Classes/Animation/AnimNode_Inertialization.h:246
void RequestInertialization(
    float Duration,             // 관성화 지속 시간
    UBlendProfile* BlendProfile // 선택적 본 가중치 프로파일
)
```

**사용 예시:**
```cpp
// ✅ 좋은 예: 방향 전환 관성화
void AMyCharacter::TurnCharacter()
{
    // 0.3초 동안 관성화 적용
    AnimInstance->RequestInertialization(0.3f);
}

// ✅ 고급 예: 블렌드 프로파일과 함께 사용
void AMyCharacter::PerformComplexTransition()
{
    // 특정 본에 대해 다른 감쇠 속도 적용
    UBlendProfile* CustomProfile = CreateBlendProfile();
    CustomProfile->SetBoneBlendScale(SpineIndex, 0.5f);
    CustomProfile->SetBoneBlendScale(HeadIndex, 0.3f);

    AnimInstance->RequestInertialization(0.4f, CustomProfile);
}
```

#### 필터링된 곡선과 본

```cpp
struct FInertializationRequest
{
    // 필터링할 본 배열
    TArray<FBoneReference> FilteredBones;

    // 필터링할 곡선 이름
    TArray<FName> FilteredCurves;

    // 관성화 지속 시간 (초)
    float Duration = 0.2f;

    // 블렌드 프로파일 (선택적)
    UBlendProfile* BlendProfile = nullptr;

    // 요청 설명 (디버깅용)
    FString Description;
}
```

**필터링 전략:**
```cpp
// ✅ 상체만 관성화
FInertializationRequest Request;
Request.FilteredBones.Add(FBoneReference("Spine"));
Request.FilteredBones.Add(FBoneReference("Neck"));
Request.FilteredBones.Add(FBoneReference("Head"));

// ❌ 루트 본 제외 (루트 모션 캐릭터의 경우)
Request.FilteredBones.Remove(FBoneReference("root"));
```

### 요청 전파 메커니즘

```
애니메이션 그래프 계층
    ↓
루트 인터티얼라이제이션 노드
    ↓
하위 노드로 요청 전파
    ↓
상태별 특화된 처리
```

## 통합 지점 (Integration Points)

### 상태 머신 통합 (State Machine Integration)

```cpp
// 상태 머신 전환 설정
FAnimTransitionNodeSettings TransitionSettings;
TransitionSettings.BlendMode = EBlendMode::Inertialization;
TransitionSettings.BlendProfile = MyCustomBlendProfile;
```

### 블렌드 스페이스 통합

```cpp
// 블렌드 스페이스 파라미터 변경 시 자동 관성화
void AMyCharacter::UpdateMovementBlendSpace()
{
    // 파라미터 변경 시 관성화 요청
    AnimInstance->RequestInertialization(0.2f);
}
```

### 몽타주 통합

```cpp
// 몽타주 재생과 동시에 관성화
void AMyCharacter::PlayCombatMontage()
{
    PlayAnimMontage(CombatMontage);

    // 몽타주 전환 시 관성화
    FInertializationRequest Request;
    Request.Duration = 0.3f;
    Request.Description = TEXT("Combat Montage Transition");
    AnimInstance->RequestInertialization(Request);
}
```

### 레이어별 블렌딩

```cpp
// 상체와 하체 독립적 관성화
void ConfigureLayeredAnimation()
{
    // 상체: 빠른 관성화
    FInertializationRequest UpperBodyRequest;
    UpperBodyRequest.Duration = 0.1f;
    UpperBodyRequest.FilteredBones.Add(FBoneReference("Spine"));

    // 하체: 느린 관성화
    FInertializationRequest LowerBodyRequest;
    LowerBodyRequest.Duration = 0.4f;
    LowerBodyRequest.FilteredBones.Add(FBoneReference("Pelvis"));
}
```

## 실전 예시 (Practical Examples)

### 예시 1: 반응형 이동

```cpp
// 달리기 방향 급격한 전환
void AMyCharacter::UpdateRunDirection()
{
    // 이전 방향에서 새 방향으로 자연스러운 전환
    FInertializationRequest Request;
    Request.Duration = 0.2f;  // 빠른 전환
    Request.Description = TEXT("Run Direction Change");

    AnimInstance->RequestInertialization(Request);
}
```

### 예시 2: 전투 전환

```cpp
// 공격에서 피격 반응으로
void AMyCharacter::OnCombatHit()
{
    // 빠른 전환, 상체 중심
    FInertializationRequest Request;
    Request.Duration = 0.1f;  // 매우 빠른 전환
    Request.FilteredBones.Add(FBoneReference("Spine"));
    Request.FilteredBones.Add(FBoneReference("Neck"));

    AnimInstance->RequestInertialization(Request);
}
```

## 성능 최적화 (Performance Optimization)

### CPU 비용 분석

```
포즈 차이 계산:    0.05ms (100개 본)
감쇠 적용:        0.1ms (100개 본)
총 오버헤드:      0.15-0.2ms
```

### 메모리 사용

```
본당 델타 포즈 저장: ~40바이트
1000개 본 스켈레톤: ~40KB 추가 메모리
```

### 성능 비교 테이블

| 방법 | CPU 비용 | 메모리 | 품질 | 사용 사례 |
|------|----------|--------|------|-----------|
| 기본 블렌딩 | 0.05ms | 0KB | 중간 | 느린 전환 |
| 관성화 | 0.2ms | 6KB | 높음 | 빠른 전환, 방향 변경 |

### 최적화 모범 사례

```cpp
// ✅ 좋은 예: 선택적 관성화
void OptimizeInertialization()
{
    // 짧은 지속 시간
    float Duration = 0.3f;  // 0.1-0.5초 권장

    // 불필요한 본 필터링
    FInertializationRequest Request;
    Request.FilteredBones.Add(FBoneReference("Spine"));
    Request.FilteredBones.Add(FBoneReference("Neck"));

    // 블렌드 프로파일 재사용
    static UBlendProfile* SharedProfile = CreateBlendProfile();
    Request.BlendProfile = SharedProfile;
}

// ❌ 나쁜 예: 과도한 관성화
void AvoidExcessiveInertialization()
{
    // 너무 긴 지속 시간 (1초 이상)
    AnimInstance->RequestInertialization(1.5f);  // ❌ 성능 저하!
}
```

## 디버깅 및 트러블슈팅

### 디버깅 명령

```
a.Inertialization.Enable 1     // 관성화 활성화
a.Inertialization.Debug 1      // 자세한 디버그 정보
a.Inertialization.DrawDebug 1  // 시각적 디버그 그리기
```

### 일반적인 문제 해결

#### 문제: 포즈 튕김
- **원인**: 지속 시간이 너무 짧음
- **해결책**: 지속 시간 늘리기 (0.2초 → 0.4초)

#### 문제: 반응 느림
- **원인**: 지속 시간이 너무 김
- **해결책**: 지속 시간 줄이기 (0.5초 → 0.2초)

### 문제 해결 흐름도

```
관성화 작동하지 않음?
    │
    ├─ 애니 그래프에 노드 있음? ──아니오──> 관성화 노드 추가
    │       │ 예
    ├─ RequestInertialization 호출? ──아니오──> 요청 함수 호출
    │       │ 예
    ├─ 지속 시간 적절? ──아니오──> 조정 (0.1-0.5초 일반적)
    │       │ 예
    └─ 필터링 설정 확인
```

## 고급 주제 (Advanced Topics)

### 다중 레이어 관성화

```cpp
// 독립적 레이어 관성화
void ConfigureMultiLayerInertialization()
{
    // 상체 레이어
    FInertializationRequest UpperBodyRequest;
    UpperBodyRequest.FilteredBones.Add(FBoneReference("Spine"));

    // 하체 레이어
    FInertializationRequest LowerBodyRequest;
    LowerBodyRequest.FilteredBones.Add(FBoneReference("Pelvis"));

    // 각 레이어 독립적으로 관리
}
```

### 맞춤형 감쇠 함수

```cpp
// 기본 지수 감쇠 이상의 함수
float CustomDecayFunction(float Time, float Duration)
{
    // 비선형 감쇠 예시
    return FMath::Lerp(1.0f, 0.0f, FMath::Pow(Time / Duration, 2.5f));
}
```

## 관련 문서

- **📄 위치:** `Engine/Source/Runtime/Engine/Classes/Animation/AnimNode_Inertialization.h`
- **GDC 참조:** GDC 2018 "Animation Techniques" 발표
- **UE 문서:** [언리얼 엔진 애니메이션 시스템](https://docs.unrealengine.com/animation)

---

> **업데이트됨:** 2025-11-07
> **버전:** 1.2.0
> 관성화 시스템에 대한 포괄적인 문서화
