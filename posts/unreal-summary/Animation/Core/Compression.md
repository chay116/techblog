---
title: "애니메이션 압축 시스템 (Animation Compression)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Animation"
tags: ["unreal", "Animation", "Core"]
---
# 애니메이션 압축 시스템 (Animation Compression)

## 🧭 개요 (Overview)

애니메이션 압축 시스템은 언리얼 엔진의 핵심 애니메이션 메모리 최적화 기술입니다. 로우 데이터를 효율적으로 저장하고 런타임에 빠르게 해제할 수 있는 고급 압축 알고리즘을 제공합니다.

### 압축의 필요성

애니메이션은 대규모 메모리를 소모하는 에셋입니다:
- 60 FPS, 5초 애니메이션, 100개 본
- 비압축 크기: ~1.2 MB
- 100개 애니메이션 = ~120 MB
- 압축 후: ~100-200 KB (6-12배 크기 감소)

## 🎯 설계 철학

### 압축 설계 결정

| 결정 | 이유 | 트레이드오프 |
|------|------|-------------|
| Codec 기반 압축 | 다양한 알고리즘 지원 | 압축/해제 시간 증가 |
| DDC 캐싱 | 재압축 방지 | 디스크 공간 사용 |
| 양자화 | 비트 수 감소 | 정밀도 손실 |

## 🏗️ 시스템 아키텍처

### 압축 파이프라인

```
입력: FRawAnimSequenceTrack
     ↓
압축기: UAnimBoneCompressionCodec
     ↓
출력: ICompressedAnimData
     ↓
런타임: 실시간 해제 및 보간
```

### 압축 전략

1. **키 감소 알고리즘**
   - 선형 키 제거
   - 사소한 키 제거
   - 트랙별 압축

2. **양자화 기법**
   - 회전: QuatLog + 11비트/축
   - 위치: 16비트 고정 소수점
   - 스케일: 16비트 고정 소수점

## 🧱 핵심 클래스

### 1. UAnimBoneCompressionCodec

```cpp
// AnimBoneCompressionCodec.h:25-32
UCLASS(abstract, EditInlineNew)
class UAnimBoneCompressionCodec : public UObject
{
    // 압축 및 해제 가상 메서드
    virtual bool Compress(...);
    virtual void DecompressPose(...);
};
```

### 2. FCompressibleAnimData

```cpp
// AnimCompressionTypes.h:200-220
struct FCompressibleAnimData
{
    TArray<FRawAnimSequenceTrack> RawAnimationData;
    USkeleton* Skeleton;
    double SequenceLength;
    int32 NumberOfKeys;
};
```

## 🌟 주요 기능

### 압축 과정

1. 원본 애니메이션 데이터 분석
2. 압축 코덱 선택
3. 에러 임계값 적용
4. 파생 데이터 캐시(DDC)에 저장

### 해제 과정

1. 런타임에 압축된 데이터 요청
2. 코덱을 통한 해제
3. 보간 및 포즈 생성

## 💡 실전 예시

### ✅ 올바른 압축 설정

```cpp
UAnimBoneCompressionSettings* Settings = NewObject<UAnimBoneCompressionSettings>();
Settings->Codecs.Add(NewObject<UAnimCompress_RemoveLinearKeys>());
Settings->ErrorThreshold = 0.5f;  // 0.5cm 오차 허용
AnimSequence->BoneCompressionSettings = Settings;
```

### ❌ 잘못된 압축 설정

```cpp
// ❌ 압축 비활성화 (메모리 폭발)
AnimSequence->BoneCompressionSettings = nullptr;

// ❌ 과도한 오차 임계값
Settings->ErrorThreshold = 10.0f;  // 눈에 띄는 변형 발생
```

## 📊 성능 최적화

### ✅ 권장사항
1. 0.1-1.0cm 오차 임계값
2. RemoveLinearKeys 사용
3. 고품질 애니메이션에 트랙별 압축
4. 팀 내 DDC 공유

### ❌ 피해야 할 것
1. 압축 완전 비활성화
2. 0 오차 임계값 설정
3. DDC 캐싱 무시

## 🔧 디버깅 팁

### 압축 결과 로깅

```cpp
int64 RawSize = AnimSeq->GetApproxRawSize();
int32 CompressedSize = AnimSeq->GetApproxCompressedSize();
float Ratio = (float)RawSize / (float)CompressedSize;

UE_LOG(LogAnimation, Log,
    TEXT("압축: %lld → %d 바이트 (%.1fx)"),
    RawSize, CompressedSize, Ratio);
```

## 📚 참고 자료

1. 공식 언리얼 엔진 문서
2. GDC 애니메이션 압축 발표 자료
3. ACL 플러그인 (추가 압축 옵션)

> 💡 주의: 압축은 메모리와 정밀도 사이의 섬세한 균형입니다.