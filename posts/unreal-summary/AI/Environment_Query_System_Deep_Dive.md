---
title: "Environment Query System (EQS) Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "AI"
tags: ["unreal", "AI"]
engine_version: "Unreal Engine 5.7"
---
# Environment Query System (EQS) Deep Dive

## 🧭 개요

**EQS (Environment Query System)** 는 AI가 주변 환경을 분석하여 최적의 위치를 찾는 시스템입니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Generator** | 후보 위치 생성 (Grid, Circle, Path 등) |
| **Test** | 후보 평가 (거리, 시야, 커버 등) |
| **Scoring** | 점수 계산 (가중치 합산) |
| **Context** | 쿼리 기준점 (Querier, Target) |

---

## 🏗️ EQS Pipeline

```
1. Generator: 100개 후보 위치 생성 (Circle around Target)
    ↓
2. Tests:
   - Distance to Target (가까울수록 +점수)
   - Trace (시야 확보 여부)
   - Distance to Cover (엄폐물 가까울수록 +점수)
    ↓
3. Scoring: 가중치 합산
    ↓
4. Best Location 반환 (최고 점수)
```

---

## 🎮 예시: Cover 찾기

```cpp
// EQS Query
UEnvQuery* FindCoverQuery = ...;

// Run Query
FEnvQueryRequest Request(FindCoverQuery, AI);
Request.SetFloatParam("MaxDistance", 1000.0f);

Request.Execute(EEnvQueryRunMode::SingleResult, [](TSharedPtr<FEnvQueryResult> Result)
{
    if (Result->IsSuccessful())
    {
        FVector BestCoverLocation = Result->GetItemAsLocation(0);
        AI->MoveToLocation(BestCoverLocation);
    }
});
```

### EQS Blueprint Setup

```
Generator: Points in Circle
  - Radius: 1000
  - Points: 50

Tests:
  1. Trace (Line of Sight to Enemy)
     - Score: Inverse (시야 없으면 +점수)
  2. Distance (to Enemy)
     - Score: 500~1000 range preferred
  3. Distance (to Cover Objects)
     - Score: < 100 preferred
```

---

## 📊 성능

**EQS Query (50 Points, 3 Tests):**
- Query Time: ~2ms
- Async Execution (Non-blocking)

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - EQS