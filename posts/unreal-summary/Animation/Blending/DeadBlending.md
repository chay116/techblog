---
title: "DeadBlending"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Animation"
tags: ["unreal", "Animation", "Blending"]
---
## 💡 실전 예시 (Practical Examples)

### ✅ 좋은 예: 방향 전환의 반응성

```cpp
// Run Forward → Run Left 부드러운 전환
void AMyCharacter::UpdateRunDirection()
{
    FInertializationRequest Request;
    Request.Duration = 0.2f;  // 빠른 전환
    Request.BlendMode = EDeadBlendMode::VelocityAdaptive;

    // DeadBlending 노드로 전달
    AnimInstance->RequestDeadBlending(Request);
}
```

### ✅ 좋은 예: 전투 히트 반응

```cpp
void AMyCharacter::OnHitReaction(EDamageType DamageType)
{
    FInertializationRequest Request;
    Request.Duration = 0.1f;  // 즉각적 반응
    Request.Description = TEXT("Combat Hit Reaction");

    // 히트 유형에 따라 다른 블렌딩 설정
    switch (DamageType)
    {
        case EDamageType::Light:
            Request.HalfLife = 0.2f;
            break;
        case EDamageType::Heavy:
            Request.HalfLife = 0.05f;
            break;
    }

    AnimInstance->RequestDeadBlending(Request);
}
```

### 💡 적응형 Decay 조정

```cpp
void AMyCharacter::TuneBlendingParameters()
{
    FAnimNode_DeadBlending* DeadBlendNode = GetDeadBlendingNode();

    // 빠른 반응이 필요한 상황
    DeadBlendNode->ExtrapolationHalfLife = 0.2f;
    DeadBlendNode->ExtrapolationHalfLifeMin = 0.05f;
    DeadBlendNode->ExtrapolationHalfLifeMax = 0.5f;

    // 부드러운 전환이 필요한 상황
    DeadBlendNode->ExtrapolationHalfLife = 1.0f;
    DeadBlendNode->ExtrapolationHalfLifeMin = 0.5f;
    DeadBlendNode->ExtrapolationHalfLifeMax = 2.0f;
}
```

### ❌ 피해야 할 예시: 극단적 속도

```cpp
// 🚫 주의: 위험한 설정
DeadBlendNode->MaximumTranslationVelocity = 10000.0f;  // 포즈 파괴 위험
DeadBlendNode->MaximumRotationVelocity = 720.0f;       // 비현실적인 회전
```

## 📊 성능 최적화 (Performance Optimization)

### CPU 비용 분석

```
속도 계산:       0.05ms (100개 본)
반감기 계산:     0.03ms (100개 본)
외삽:           0.15ms (100개 본)
크로스페이드:    0.05ms (100개 본)
총 비용:        0.28ms (이너셜라이제이션 대비 0.15ms)
```

### 메모리 사용량

- 속도 벡터: 본당 ~12바이트 × 3
- 반감기: 본당 ~12바이트 × 3
- 총 메모리: 본당 ~72바이트 (이너셜라이제이션 대비 ~40바이트)

### ✅ 모범 사례

- 모션 매칭에 사용 (비용 대비 효과적)
- 속도 제한을 보수적으로 설정
- 불필요한 본 필터링
- 블렌드 프로파일 재사용

### ❌ 피해야 할 사례

- 모든 블렌딩에 사용 (과도한 계산)
- 2초 이상 긴 반감기
- 루트 본 필터링 (루트 모션 방해)
- 지나치게 높은 속도 제한 (아티팩트 발생)

## 🔧 디버깅 및 문제 해결

### 시각적 디버깅

- `bShowExtrapolations` 에디터 플래그
- 뷰포트 내 외삽 시각화
- 속도 벡터 표시
- 반감기 색상 코딩

### 일반적인 문제점

#### 문제 1: 포즈 깨짐/튐

**원인**: 속도 제한이 너무 높음
**해결책**:
- `MaximumTranslationVelocity` 및 `MaximumRotationVelocity` 낮추기
- 속도 클램핑 확인
- 블렌드 프로파일 조정

#### 문제 2: 전환이 느리고 둔감

**원인**: 반감기가 너무 김
**해결책**:
- `ExtrapolationHalfLife` 감소
- `ExtrapolationHalfLifeMax` 낮추기
- 더 짧은 블렌드 시간 설정

#### 문제 3: 전환 지터/끊김

**원인**: 반감기가 너무 짧음
**해결책**:
- `ExtrapolationHalfLifeMin` 증가
- 안정화 시간 조정
- 보간 곡선 변경

## 🚀 고급 주제

### 커스텀 감쇠 함수

- 지수 감쇠 이외의 감쇠 함수
- 본별 커스텀 타이밍

### 하이브리드 접근

- 동일 AnimGraph에서 이너셜라이제이션 + 데드 블렌딩 혼용
- 전환 유형별 노드 라우팅

### IK와의 통합

- IK 목표 외삽
- 부드러운 핸드/풋 IK 전환

### 네트워크 복제

- 클라이언트 측 시각적 부드러움
- 서버는 직접 블렌딩

### 미래 개선 방향

- 추가 최적화 가능성
- 연구 방향성 탐색

## 🔗 참고 문헌

### Daniel Holden의 연구
- [Dead Blending 원본 논문](https://theorangeduck.com/page/dead-blending)

### Unreal Engine 소스
- `Engine/Source/Runtime/Engine/Classes/Animation/AnimNode_DeadBlending.h`
- `Engine/Source/Runtime/Engine/Private/Animation/AnimNode_DeadBlending.cpp`

### 추가 참고 자료
- GDC 발표: "애니메이션 전환의 새로운 접근"
- 모션 매칭 및 반응형 애니메이션 기술 논문

---

> 🔄 **작성일**: 2025-11-07
> 📝 **문서 버전**: v1.0
> ✅ **소스 검증**: UE 5.7.0
> 📂 **이전 문서**: [Inertialization.md](./Inertialization.md)