---
title: "Avowed GPU Technology Postmortem Deep Dive"
date: "2025-11-23"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "RealWorld"
tags: ["unreal", "Rendering", "RealWorld"]
---
# Avowed GPU Technology Postmortem Deep Dive

## 🧭 개요 (Overview)

**Avowed GPU Technology Postmortem**은 Obsidian Entertainment의 시니어 그래픽 엔지니어 Matt Campbell이 GDC 2025에서 발표한 실전 사례 연구입니다. Pillars of Eternity 세계관을 배경으로 한 싱글 플레이어 액션 RPG인 Avowed가 Unreal Engine 5.3.2를 활용하여 Xbox Series S/X 및 PC에 출시되기까지의 기술적 여정, 문제점, 그리고 해결책을 상세히 다룹니다.

**발표 핵심:**
- **실전 Nanite 최적화**: Masked Material 제거, WPO 최적화, 빈 Draw Call 문제 해결
- **Lumen 활용 및 함정**: Hardware RT 선택 이유, 메모리 문제, Single Layer Water 최적화
- **VSM과 Ray Traced Shadow 하이브리드**: 각 기술의 장단점과 실전 성능 비교
- **Virtual Texture 실무**: Texture Address Bound 문제, Pool Balancing

**성능 개선 사례 (Xbox Series S, 30Hz):**
- Paradise 외부 씬: **46.5ms → 30ms** (35% 향상)
- Emerald Stair 씬: **53ms → 33ms** (38% 향상)
- Fior 씬 (레이 트레이싱 그림자): **40ms → 25ms** (38% 향상)

**게임 정보:**
- **플랫폼**: Xbox Series S/X, PC
- **엔진**: Unreal Engine 5.3.2
- **출시**: 2025년 초
- **장르**: 1인칭/3인칭 액션 RPG
- **주요 특징**: 광활한 오픈 월드, 동적 낮-밤 주기, 완전 동적 GI

---

## 🎮 게임 특징 및 기술 요구사항

### 1. 게임 개요

**Avowed 게임 특성:**
- Pillars of Eternity 세계관
- 근접/원거리/마법 기반 전투
- 광활한 경치 (Vistas) - 수 킬로미터 시야 거리
- 완전 동적 낮-밤 주기
- 자연광 부족 환경 (동굴, 실내) - 전역 조명 필수
- 수많은 식물, 유기적인 세계

### 2. 플랫폼별 성능 목표

#### Xbox Series S - Quality Mode (30Hz)
```
내부 해상도: 900p
Lumen: 풀 하드웨어 레이 트레이싱
그림자:
  - 방향광 (Directional Light): Virtual Shadow Maps
  - 로컬 라이트: 레이 트레이싱 그림자
반사: 하드웨어 레이 트레이싱 반사
```

#### Xbox Series S - Performance Mode (60Hz)
```
내부 해상도: 1080p ~ 1800p (동적)
Lumen: 소프트웨어 Lumen (Distance Field)
그림자: 모든 라이트 풀 VSM
반사: 소프트웨어 Lumen 반사
병목: GPU 아닌 CPU 제한
```

**중요:** Performance Mode는 GPU가 아닌 **CPU 병목** 때문에 이러한 설정으로 결정되었습니다.

---

## 🔷 Nanite: 실전 최적화 사례

### 1. Nanite의 핵심 역할

**Avowed에서 Nanite가 중요했던 이유:**
- ✅ 광활한 경치를 **LOD 팝핑 없이** 구현
- ✅ 콘솔 메모리 사용량 제어 (가장 큰 병목)
- ✅ 수백만 폴리곤을 실시간 렌더링

### 2. UE4 → UE5 전환 문제

#### 문제 1: Masked Material 범람

**배경:**
```cpp
// UE4에서 식물 렌더링 방식
Material->BlendMode = BLEND_Masked;  // Alpha Test
Material->TwoSided = true;
Material->OpacityMask = AlphaTexture;
```

**Nanite에서의 문제:**
- Masked Material은 **픽셀 단위 평가** 필요
- Nanite Rasterizer에서 모든 픽셀을 셰이딩해야 함
- VRS (Variable Rate Shading) 불가 (UE 5.3)
- **Overdraw가 심각**

**성능 영향:**
- 식물이 많은 씬: Base Pass **5ms → 8ms**
- VSM Shadow Depth: **13ms** (Masked 1.5ms 포함)

**해결책: 불투명 변환**
```cpp
// 최종 해결책
Material->BlendMode = BLEND_Opaque;  // 불투명으로 전환
Material->TwoSided = false;          // 단면

// 지오메트리 변경
// 기존: 카드 1장 (양면)
// 변경: 카드 2장 (각각 단면, 약간 오프셋)
```

**결과:**
- Base Pass: **8ms → 3.5ms** (56% 개선)
- VSM: **13ms → 8ms** (38% 개선)

---

#### 문제 2: World Position Offset (WPO) 오버헤드

**배경:**
```cpp
// 나무 바람 애니메이션 (UE4 방식)
float3 WindOffset = SampleWindVAT(UV, Time);  // VAT 샘플링
WorldPosition += WindOffset * WindStrength;
```

**Nanite에서의 문제:**
- WPO는 **Vertex Shader에서 평가**
- Nanite Cluster 단위로 Bounds 재계산 필요
- 스트리밍 거리 계산 오류 발생
- **Cluster Culling 실패** → 불필요한 렌더링

**실측 성능:**
- WPO 활성화: Nanite Culling **0.8ms → 1.5ms**
- 거리 계산 오류로 멀리 있는 Cluster도 로드됨

**해결책:**
```cpp
// 나무 바람: WPO 완전 제거
// 대신 매우 제한적인 Vertex Animation만 사용
// 또는 정적 포즈로 베이킹

// CVar로 WPO 전역 비활성화
r.Nanite.AllowWorldPositionOffset = 0
```

**결과:**
- Nanite Culling: **1.5ms → 0.6ms** (60% 개선)
- 스트리밍 안정성 대폭 향상

---

#### 문제 3: Spline Mesh 처리

**배경:**
- UE4에서 길, 다리 등을 Spline Mesh로 제작
- Nanite는 초기에 Spline 미지원

**문제:**
- Spline Mesh는 CPU에서 Deform
- Nanite로 변환 불가
- 대량의 Spline → 메모리 폭발

**해결책 1: H-LOD 베이킹**
```cpp
// Spline Mesh를 정적 메시로 베이킹
// H-LOD (Hierarchical LOD) 시스템 활용

for (SplineMesh in Level)
{
    StaticMesh = BakeSplineToStaticMesh(SplineMesh);
    StaticMesh->bEnableNanite = true;

    // 원본 Spline은 에디터에서만 보이도록
    SplineMesh->bHiddenInGame = true;
}
```

**해결책 2: 스트리밍 거리 조정**
```cpp
// Nanite 스트리밍 거리 확장
r.Nanite.StreamingPoolSize = 512  // MB (기본 256)
r.Nanite.MaxStreamingRequests = 128  // 기본 64

// 멀리 있는 Cluster는 Low LOD로
r.Nanite.StreamingLODBias = 2  // +2 LOD (더 간단)
```

**결과:**
- 메모리: **2.2GB → 1.4GB** (36% 감소)
- Spline 관련 Draw Call 완전 제거

---

#### 문제 4: 빈 Draw Call (Empty Base Pass Draws)

**배경:**
```cpp
// 머티리얼 인스턴스로 Variation 생성
// 예: Tree_Master → Tree_Variant_01, Tree_Variant_02, ...

Material Instance "Tree_Variant_01":
    Parent = Tree_Master
    Texture = AlbedoA

Material Instance "Tree_Variant_02":
    Parent = Tree_Master
    Texture = AlbedoB
```

**Nanite의 문제:**
- Nanite는 **로드된 모든 Material Instance**에 대해 Draw Call 발행
- **컬링된 메시도 Draw Call 발행** (Material만 다르면)
- Draw Call 자체는 비어있지만 CPU 오버헤드 존재

**실측:**
```
베이스 패스 Draw Call 수: 1,200개
그 중 빈 Draw Call: 800개 (67%)
각 빈 Draw Call: 100~200 나노초
총 오버헤드: 0.08~0.16ms (작지만 누적되면 큼)
```

**현재 해결책 (제한적):**
```cpp
// 머티리얼 Variation 최소화
// 대신 Vertex Color나 Texture Atlas 사용

// 예: 단일 Material, Texture Atlas
Material->AlbedoAtlas = AtlasTexture;  // 여러 변형을 하나의 Atlas에
Vertex->UV = SelectAtlasRegion(VariantID);
```

**미래 해결책 (UE 5.4+):**
```cpp
// Work Graphs 기술로 해결 예정
// GPU가 Material Binning을 직접 수행
// 빈 Draw Call 완전 제거
```

---

### 3. Nanite 식물 (Foliage) 최적화

#### 초기 시도: Nanite Foliage로 즉시 전환

**배경:**
- UE 5.3에서 Nanite Foliage 지원 추가
- 기존 Alpha Masked Card를 Nanite로 변환 시도

**결과: 실패**
```
LOD 팝핑: 해결됨 ✅
렌더링 시간: 개선 안 됨 ❌

기존 (Non-Nanite):
  VSM Shadow: 13ms
  Base Pass: 5ms

Nanite Foliage (초기):
  Nanite Rasterization: 12ms  ← VSM에서 Nanite로 이동
  Base Pass: 5ms  ← 변화 없음
```

**문제 분석:**
- VSM 성능 문제가 **Nanite Rasterization** 문제로 전환
- Masked Material은 여전히 픽셀 단위 평가
- 근본적인 해결책 아님

#### 최종 해결책: 불투명 지오메트리

**방법:**
```cpp
// 1. Foliage Card를 불투명으로 변환
Material->BlendMode = BLEND_Opaque;
Material->TwoSided = false;

// 2. 지오메트리 Doubling
// 기존: 1 quad (양면, alpha masked)
// 변경: 2 quads (각각 단면, opaque)
//   - Front Quad: Normal facing camera
//   - Back Quad: Slight offset, flipped normal

// 3. Vertex 수 제약
// Nanite Cluster는 128 triangles
// Foliage는 가능한 한 간단하게 (quad 2~4개 수준)
```

**성능 결과:**
```
Paradise 외부 씬 (Series S, 30Hz):
  Nanite Vis Buffer: 4ms → 2.5ms (38% 개선)
  Base Pass: 5ms → 3.5ms (30% 개선)
  VSM: 13ms → 8ms (38% 개선)

총 프레임 시간: 46.5ms → 30ms (35% 개선)
```

---

### 4. Nanite 메모리 최적화

#### 스트리밍 풀 관리

**문제:**
- 콘솔은 제한된 메모리 (Series S: 10GB 총, 게임 사용 가능 ~8GB)
- Nanite Streaming Pool이 부족하면 **히칭 (Hitching)** 발생

**해결책:**
```cpp
// Streaming Pool 크기 조정
r.Nanite.StreamingPoolSize = 512  // Series X: 512MB
r.Nanite.StreamingPoolSize = 256  // Series S: 256MB

// 우선순위 조정
r.Nanite.StreamingImportanceScale = 2.0  // 중요한 메시 우선

// 거리별 LOD Bias
r.Nanite.StreamingLODBias = 2  // 원거리 +2 LOD
```

#### Cluster 수 제한

**전략:**
```cpp
// Import 시 Cluster 수 제한
StaticMesh->NaniteSettings.MaxClusters = 256;  // 기본 1024

// 복잡한 메시는 단순화
// 예: 나무 하나에 Cluster 1024개 → 256개로 감소
// 시각적 차이: 거의 없음 (거리 고려 시)
```

**메모리 절감:**
- 평균 Cluster 크기: ~16KB
- 1024 → 256 감소: **12MB → 3MB** per mesh
- 씬 전체: **1.2GB 절감**

---

## 💡 Lumen: 실전 활용 및 함정

### 1. Lumen 선택 배경

**왜 Lumen인가:**
- ✅ **적은 인원으로 높은 품질**: Lighter 2명으로 전체 게임 조명 완성
- ✅ **WYSIWYG**: 베이킹 없음, 실시간 프리뷰
- ✅ **동적 낮-밤 주기**: Lightmap Baking으로는 불가능
- ✅ **간접광 표현**: 동굴, 실내에서 자연스러운 간접광

### 2. Hardware RT vs Software RT 선택

#### 비교 테스트 결과

**지형 (Landscape) 반사:**
```
Software Lumen (Distance Field):
  - 거친 반사 (Coarse)
  - 경사면에서 Light Bleeding 많음
  - 디테일 부족

Hardware RT Lumen:
  - 정확한 반사
  - Light Bleeding 거의 없음
  - 자연스러운 디테일
```

**결정: Hardware RT Lumen 우선**
```cpp
// Quality Mode (30Hz) 설정
r.Lumen.HardwareRayTracing = 1
r.Lumen.HardwareRayTracing.LightingMode = 1  // Hit Lighting

// Performance Mode (60Hz)는 Software로 Fallback
r.Lumen.HardwareRayTracing = 0
```

**예상치 못한 이점:**
- 나중에 **레이 트레이싱 그림자**로 전환 시 매우 용이
- 이미 RT Scene이 준비되어 있어 추가 작업 최소

---

### 3. Async Compute 활용

#### Xbox의 Async Compute Queue

**배경:**
- Xbox는 강력한 Async Compute 지원
- Lumen은 Async에서 실행 가능

**최적화:**
```cpp
// Lumen을 Async Queue로 이동
r.Lumen.AsyncCompute = 1

// Async Queue에서 실행되는 패스:
// - Screen Probe Gather
// - Radiance Cache Update
// - Reflections
// - Indirect Lighting

// Graphics Queue는 다른 작업 수행:
// - Shadow Rendering
// - Translucency
// - Post Processing
```

**성능 향상:**
```
기존 (Sequential):
  Graphics Queue: Lumen (3.5ms) + Shadows (2ms) = 5.5ms

Async Compute:
  Graphics Queue: Shadows (2ms)
  Async Queue: Lumen (3.5ms)  ← 병렬 실행
  실제 시간: max(2ms, 3.5ms) = 3.5ms

절감: 2ms (36% 향상)
```

---

### 4. Lumen 메모리 문제

#### 문제: 메모리 폭발

**원인:**
```cpp
// Lumen이 사용하는 주요 메모리:
// 1. Surface Cache (Mesh Cards)
// 2. Radiance Cache (Probes)
// 3. Ray Tracing Scene (BLAS/TLAS)
// 4. Hit Lighting Buffers
// 5. Reflection Buffers

// Series S에서 총 메모리 사용:
Surface Cache: 450MB
Radiance Cache: 280MB
RT Scene: 320MB
기타: 150MB
---
총: ~1.2GB  ← 너무 많음!
```

**해결책 1: Mesh Distance Field 제거**
```cpp
// 콘솔에서 Distance Field 완전 비활성화
r.DistanceFields = 0

// RT BLAS만 사용 (이미 Lumen Hardware RT 사용 중)
// 메모리 절감: ~200MB
```

**부작용:**
- VFX에서 Distance Field 노드 사용 불가
- Niagara Collision에서 Distance Field Collision 불가
- 대안: Simple Collision 사용

**해결책 2: Surface Cache 최적화**
```cpp
// Mesh Cards 수 제한
r.Lumen.SurfaceCache.CardMaxResolution = 512  // 기본 1024
r.Lumen.SurfaceCache.MaxLumenMeshCards = 12  // 기본 24

// 객체당 Card 수 제한
// 예: 벽 → 2개 Card (앞, 뒤)
//     복잡한 메시 → 6개 Card
```

**메모리 절감:**
- Surface Cache: **450MB → 280MB** (38% 감소)

---

### 5. 동적 낮-밤 주기 문제

#### 문제: Temporal Accumulation 실패

**배경:**
```cpp
// Lumen은 Temporal Accumulation 사용
// 여러 프레임에 걸쳐 누적하여 노이즈 감소

// 문제: 낮 → 밤 전환 시
// - 낮의 GI 데이터가 누적되어 있음
// - 밤으로 전환해도 밝게 남음
// - 수 초 동안 서서히 어두워짐 (부자연스러움)
```

**해결책:**
```cpp
// 낮-밤 전환 시 Lumen 강제 리셋
void TransitionDayNight(float NewTimeOfDay)
{
    // 페이드 아웃 (0.5초)
    FadeToBlack(0.5f);

    // Lumen 강제 리셋
    FlushLumenSceneCache();
    FlushRadianceCache();

    // 시간 변경
    TimeOfDay = NewTimeOfDay;

    // 1프레임 대기 (Lumen 재구축)
    WaitOneFrame();

    // Lumen이 새로운 조명 계산
    // 최대 품질로 재구축 (일시적으로 품질 향상)
    r.Lumen.Reflections.MaxRoughnessToTrace = 0.6;  // 임시 상향

    // 페이드 인 (1.0초)
    FadeFromBlack(1.0f);

    // 품질 원래대로
    r.Lumen.Reflections.MaxRoughnessToTrace = 0.4;
}
```

**결과:**
- 부자연스러운 전환 완전 제거
- 사용자는 페이드만 보고 내부 리셋을 인지 못함

---

### 6. Mesh Cards 최적화

#### 문제: 뒷면에 Card 생성

**배경:**
```cpp
// Lumen은 객체당 최대 24개 Mesh Card 생성
// 문제: 벽 같은 단순 객체에도 12개 생성
//   - 앞면: 6개
//   - 뒷면: 6개 (불필요!)
```

**해결책: 엔진 수정**
```cpp
// NaniteLumen.cpp (엔진 수정)

// Mesh Card 생성 시 방향 Bias 추가
struct FMeshCardBuildSettings
{
    int32 MaxCards = 12;  // 24 → 12로 감소
    FVector PreferredDirection = FVector(0, 0, 1);  // 위쪽 우선
    float DirectionBias = 0.8f;  // 0.0 ~ 1.0
};

// Card 생성 알고리즘
float CardScore(FVector CardNormal, FVector PreferredDir, float Bias)
{
    float DotProduct = FVector::DotProduct(CardNormal, PreferredDir);
    return Lerp(1.0f, DotProduct, Bias);  // Bias가 높을수록 선호 방향 강조
}
```

**결과:**
- 벽: 뒷면 Card 거의 생성 안 됨
- 메모리 절감: **~50MB**
- 품질: 거의 차이 없음 (뒷면은 어차피 안 보임)

---

### 7. Emissive Lighting 트릭

#### Hidden Emissive Mesh Cards

**기법:**
```cpp
// 1. 숨겨진 Emissive Plane 배치
// 예: 동굴 천장에 보이지 않는 발광 평면

UPROPERTY()
UStaticMeshComponent* HiddenLight;

void SetupHiddenLight()
{
    HiddenLight->SetVisibility(false);  // 래스터라이즈 안 됨
    HiddenLight->SetCastShadow(false);

    // Lumen만 인식
    HiddenLight->bAffectDistanceFieldLighting = true;
    HiddenLight->bAffectDynamicIndirectLighting = true;

    // Material 설정
    Material->EmissiveColor = FLinearColor(1, 0.9, 0.7) * 5.0f;  // 밝은 오렌지
}
```

**Ray Tracing Material Node 활용:**
```cpp
// Material Graph에서

// Is Ray Tracing Material? 노드
if (IsRayTracingMaterial)
{
    Emissive = BaseEmissive * 10.0f;  // Lumen에서 10배 밝게
}
else
{
    Emissive = BaseEmissive * 1.0f;   // 일반 렌더링에서는 정상
}
```

**장점:**
- 래스터라이즈 비용 **0**
- Surface Cache만 차지 (매우 작음)
- Lumen GI에 큰 기여

**엔진 수정 필요:**
```cpp
// 반사 패스에서 Hidden Mesh 제거
// LumenReflections.cpp

bool ShouldIncludeInReflections(const FPrimitiveSceneProxy* Proxy)
{
    if (Proxy->IsHiddenInGame())
        return false;  // 숨겨진 메시 제외

    // ... 기존 로직
}
```

---

### 8. Single Layer Water 최적화

#### 문제 1: Lumen 반사 비용 중복

**배경:**
```cpp
// Single Layer Water 아래에 반사 표면이 있으면
// Lumen이 두 번 반사 계산:
//   1. 물 아래 표면 반사
//   2. 물 표면 반사

// 예: Bingham's Domain 맵
// - 물 아래 얼음 (반사)
// - 물 표면도 반사
// → 반사 비용 2배
```

**해결책: 엔진 수정**
```cpp
// LumenReflections.usf

Texture2D<float> SingleLayerWaterDepth;  // 추가

[numthreads(8, 8, 1)]
void LumenReflectionsCS(uint3 DispatchThreadId : SV_DispatchThreadID)
{
    float SceneDepth = DepthBuffer[PixelPos];
    float WaterDepth = SingleLayerWaterDepth[PixelPos];

    // 물 아래는 반사 안 함
    if (SceneDepth > WaterDepth)
    {
        // 물 아래 표면 → Skip
        return;
    }

    // 물 표면만 반사 계산
    TraceReflectionRay(...);
}
```

**성능 향상:**
- Bingham's Domain: **Reflections 3.5ms → 1.8ms** (49% 개선)

---

#### 문제 2: Single Layer Water 반사가 풀 스크린

**배경:**
```cpp
// UE 5.3의 Single Layer Water Reflection:
// - 항상 풀 스크린 패스
// - 화면에 물이 10% 만 있어도 100% 계산
// - 카메라 밖 물도 반사 계산
```

**해결책: 하이브리드 접근 (엔진 수정)**
```cpp
// SingleLayerWaterReflections.usf

// Pass 1: Screen Space Reflections (풀 해상도)
RWTexture2D<float4> SSR_Reflections;
RWTexture2D<uint> SSR_Mask;  // 성공 여부

[numthreads(8, 8, 1)]
void WaterSSR_CS(uint3 DispatchThreadId : SV_DispatchThreadID)
{
    // Screen Space Ray Trace
    bool bHit = TraceScreenSpaceRay(...);

    if (bHit)
    {
        SSR_Reflections[PixelPos] = HitColor;
        SSR_Mask[PixelPos] = 1;  // 성공
    }
    else
    {
        SSR_Mask[PixelPos] = 0;  // 실패 (Lumen 필요)
    }
}

// Pass 2: Lumen Reflections (1/4 해상도, Mask 영역만)
Texture2D<uint> SSR_Mask;

[numthreads(4, 4, 1)]  // 4x4 threads = 16x16 pixels (1/4 해상도)
void WaterLumenReflections_CS(uint3 DispatchThreadId : SV_DispatchThreadID)
{
    uint2 LowResPos = DispatchThreadId.xy;
    uint2 HighResPos = LowResPos * 4;  // 업스케일

    // 4x4 Quad에서 SSR이 실패한 픽셀이 있나?
    bool bNeedsLumen = false;
    for (int y = 0; y < 4; ++y)
    {
        for (int x = 0; x < 4; ++x)
        {
            if (SSR_Mask[HighResPos + uint2(x, y)] == 0)
            {
                bNeedsLumen = true;
                break;
            }
        }
    }

    if (bNeedsLumen)
    {
        // Lumen 반사 (coarse)
        float3 LumenReflection = TraceLumenReflection(...);
        LumenReflections[LowResPos] = LumenReflection;
    }
}

// Pass 3: Composite (SSR + Upscaled Lumen)
[numthreads(8, 8, 1)]
void WaterReflectionComposite_CS(uint3 DispatchThreadId : SV_DispatchThreadID)
{
    if (SSR_Mask[PixelPos] == 1)
    {
        FinalReflection = SSR_Reflections[PixelPos];  // 고해상도 SSR
    }
    else
    {
        uint2 LowResPos = PixelPos / 4;
        FinalReflection = LumenReflections[LowResPos];  // Upscaled Lumen
    }
}
```

**성능 결과:**
```
Paradise 씬 (물 30% 차지, Series S):
  기존: Water Reflections 8.0ms
  최적화 후:
    - SSR: 2.5ms (풀 해상도)
    - Lumen: 1.2ms (1/4 해상도, 일부만)
    - Composite: 0.3ms
    총: 4.0ms

절감: 4ms (50% 개선)
```

**품질:**
- 정적인 물: 거의 차이 없음
- 움직이는 물 (파도): 약간 거친 반사 (1/4 해상도), 하지만 눈치채기 어려움

---

#### 문제 3: 완벽한 거울 반사

**배경:**
```cpp
// Single Layer Water는 기본적으로 Roughness = 0
// → 완벽한 거울 반사

// 문제: 늪지대, 탁한 물 표현 불가
// 아티스트: 진흙 텍스처를 씌워도 반사는 완벽함
```

**해결책: 엔진 수정**
```cpp
// SingleLayerWaterCommon.ush

// Material에서 Roughness 읽기
float WaterRoughness = Material.Roughness;  // 기본 0.0

// Roughness에 따라 반사 Blur
float3 BlurredReflection = GaussianBlur(
    Reflection,
    WaterRoughness * 10.0f  // Blur 반경
);

FinalColor = lerp(Reflection, BlurredReflection, WaterRoughness);
```

**결과:**
- 늪지대: Roughness 0.3 → 약간 흐릿한 반사 (자연스러움)
- 맑은 호수: Roughness 0.05 → 거의 거울 반사 (유지)

---

## 🌑 Virtual Shadow Maps & Ray Traced Shadows

### 1. VSM 장점 및 전제 조건

**VSM이 훌륭한 이유:**
```cpp
// 기존 Cascade Shadow Maps (CSM)
// - 4개 Cascade
// - 각 Cascade별 Draw Call
// - Resolution: 2048x2048 per cascade
// - 멀리 갈수록 품질 저하

// Virtual Shadow Maps (VSM)
// - 단일 Virtual Texture
// - Page 기반 스트리밍 (128x128 per page)
// - Resolution: 무제한 (필요한 곳만 high-res)
// - 멀리 있어도 품질 유지 (광활한 경치)
```

**전제 조건: Nanite 필수**
```cpp
// VSM은 Nanite와 통합 설계
// Non-Nanite 메시는 성능 문제

// Nanite 메시: GPU-Driven Rasterization
//   - 한 번의 Dispatch로 모든 Cluster
//   - Virtual Page 기반 Culling
//   - 매우 빠름 (2~3ms)

// Non-Nanite 메시: 전통적 Draw Call
//   - Mesh당 Draw Call
//   - Virtual Page 무효화 (Invalidation) 비용
//   - 매우 느림 (10~20ms)
```

**권장사항:**
```cpp
// VSM 사용 시 반드시:
r.Shadow.Virtual = 1
r.Nanite = 1  // Nanite 필수!

// 가능한 모든 Static Mesh를 Nanite로
StaticMesh->bEnableNanite = true;
```

---

### 2. VSM 성능 문제 및 해결

#### 문제 1: Masked Material의 VSM 비용

**배경:**
```cpp
// Masked Material은 VSM에서도 픽셀 단위 평가 필요
// 예: 나무 잎 (Alpha Test)

// VSM Shadow Depth Pass:
// - 모든 픽셀에서 Opacity Mask 샘플링
// - discard 발생 → Rasterizer 효율 저하
```

**실측 성능:**
```
Paradise 외부 씬 (Alpha, 식물 많음):
  VSM Shadow Depth: 13ms
    - Masked Material: 1.5ms
    - Opaque Material: 11.5ms
```

**해결책: Opaque 전환 (Nanite 섹션과 동일)**
```cpp
// Masked → Opaque 전환
Material->BlendMode = BLEND_Opaque;

// 지오메트리 Doubling
// 2장의 Quad (각각 단면)
```

**결과:**
```
VSM Shadow Depth: 13ms → 8ms (38% 개선)
  - Masked Material: 0ms (제거)
  - Opaque Material: 8ms
```

---

#### 문제 2: Skinned Mesh (스킨드 메시) 비용

**배경:**
```cpp
// Skinned Mesh는 Nanite 미지원 (UE 5.3)
// → 전통적 Draw Call 방식
// → VSM에서 매우 느림

// 예: NPC 100명
//   - 각 NPC: 20K triangles
//   - 총: 2M triangles
//   - VSM Shadow: 10ms (너무 느림!)
```

**해결책: Ray Traced Shadow 사용**
```cpp
// Skinned Mesh는 레이 트레이싱으로 전환
r.Shadow.Virtual.Skinned = 0  // VSM에서 제외
r.RayTracing.Shadows.Skinned = 1  // RT Shadow 사용

// RT는 BLAS 기반이라 Skinned Mesh도 효율적
```

**성능 비교:**
```
NPC 100명 Shadow:
  VSM (Rasterization): 10ms
  Ray Traced: 2.5ms

절감: 7.5ms (75% 빠름!)
```

**품질:**
- VSM vs RT: **거의 구분 불가**
- RT가 약간 더 부드러운 Penumbra (추가 이득)

---

#### 문제 3: WPO/PDO의 VSM 비용

**배경:**
```cpp
// World Position Offset (WPO)
// Pixel Depth Offset (PDO)
// → Vertex/Pixel Shader 평가 필요
// → Nanite의 Hardware Rasterizer 사용 불가
// → Software Fallback (느림)
```

**해결책:**
```cpp
// WPO/PDO를 가능한 한 비활성화
r.Nanite.AllowWorldPositionOffset = 0
r.Nanite.AllowPixelDepthOffset = 0

// 정말 필요한 경우만 활성화
// 예: 특정 VFX 이벤트
```

**결과:**
- VSM: **1.5ms 절감**

---

#### 문제 4: Local Light VSM Invalidation

**배경:**
```cpp
// Local Light (Point, Spot, Rect)의 VSM:
// - Dynamic Object가 Light 영역을 통과하면
// - 해당 Light의 Virtual Page 무효화 (Invalidation)
// - 다음 프레임에 재렌더링
// - 무효화 비용이 매우 높음

// 실측:
// - 8개 Local Light
// - NPC가 이동
// - 매 프레임 무효화 발생
// - VSM Invalidation: 5~8ms (감당 불가)
```

**해결책: Ray Traced Shadow 전환**
```cpp
// Local Light는 모두 RT Shadow로
r.Shadow.Virtual.OnePassProjection = 0  // VSM Local Light 비활성화
r.RayTracing.Shadows = 1  // RT Shadow 활성화

// RT Shadow는 Invalidation 개념 없음
// 매 프레임 dynamic하게 트레이싱
```

**성능 결과 (Fior 씬, Series S, 30Hz):**
```
Alpha (VSM Local Light):
  VSM Shadow Depth: 11ms
  VSM Projection: 8ms
  총: 19ms

RT Shadow 전환 후:
  VSM Shadow Depth: 3ms (방향광만)
  RT Shadow: 3ms (로컬 라이트)
  총: 6ms

절감: 13ms (68% 빠름!)
```

---

### 3. Ray Traced Shadow 커스텀 구현

#### 왜 커스텀 구현?

**기본 UE 5.3 RT Shadow 문제:**
```cpp
// 기본 구현: Light당 풀 스크린 Pass
// - 8개 Light = 8개 풀 스크린 Dispatch
// - 8개 Denoising Pass
// - 8개 렌더 타겟
// → 메모리 및 성능 감당 불가
```

**커스텀 구현 목표:**
```cpp
// 1. 단일 Pass로 모든 Light 처리
// 2. 공유 Denoiser
// 3. 최소 메모리
```

#### 커스텀 RT Shadow 아키텍처

```hlsl
// Pass 1: Multi-Light Ray Tracing
RWTexture2D<uint> ShadowMask;  // Packed: 각 Light당 1 bit

StructuredBuffer<FLightData> Lights;  // 최대 32 lights
uint NumLights;

[numthreads(8, 8, 1)]
void MultiLightShadowCS(uint3 DispatchThreadId : SV_DispatchThreadID)
{
    uint2 PixelPos = DispatchThreadId.xy;

    // World Position 재구성
    float Depth = DepthBuffer[PixelPos];
    float3 WorldPos = ReconstructWorldPosition(PixelPos, Depth);

    uint ShadowBits = 0;

    // 모든 Light를 한 번에 처리
    for (uint LightIndex = 0; LightIndex < NumLights; ++LightIndex)
    {
        FLightData Light = Lights[LightIndex];

        // Light 영향 받는지 확인 (거리)
        float DistSq = dot(WorldPos - Light.Position, WorldPos - Light.Position);
        if (DistSq > Light.Radius * Light.Radius)
            continue;  // 영향 안 받음

        // Shadow Ray
        RayDesc Ray;
        Ray.Origin = WorldPos + Normal * 0.01f;
        Ray.Direction = normalize(Light.Position - WorldPos);
        Ray.TMin = 0.01f;
        Ray.TMax = sqrt(DistSq);

        // Inline Ray Tracing
        RayQuery<RAY_FLAG_ACCEPT_FIRST_HIT_AND_END_SEARCH> Query;
        Query.TraceRayInline(
            RTScene,
            RAY_FLAG_NONE,
            0xFF,
            Ray
        );

        Query.Proceed();

        // Hit = Shadow
        if (Query.CommittedStatus() == COMMITTED_TRIANGLE_HIT)
        {
            // Shadow
            ShadowBits |= (1u << LightIndex);  // Bit 설정
        }
    }

    // 결과 저장 (32 lights → 32 bits)
    ShadowMask[PixelPos] = ShadowBits;
}
```

```hlsl
// Pass 2: Shared Denoiser (Checkerboard)
Texture2D<uint> ShadowMask;
RWTexture2D<uint> DenoisedShadowMask;

[numthreads(8, 8, 1)]
void ShadowDenoiseCS(uint3 DispatchThreadId : SV_DispatchThreadID)
{
    uint2 PixelPos = DispatchThreadId.xy;

    // Checkerboard: (x + y) % 2 == FrameIndex % 2
    bool bCheckered = ((PixelPos.x + PixelPos.y) % 2) == (FrameIndex % 2);

    if (bCheckered)
    {
        // 이번 프레임에 Ray Trace 함
        uint Shadows = ShadowMask[PixelPos];
        DenoisedShadowMask[PixelPos] = Shadows;
    }
    else
    {
        // Reconstruct (인접 픽셀에서 보간)
        uint Neighbor1 = ShadowMask[PixelPos + uint2(1, 0)];
        uint Neighbor2 = ShadowMask[PixelPos + uint2(0, 1)];
        uint Neighbor3 = ShadowMask[PixelPos + uint2(-1, 0)];
        uint Neighbor4 = ShadowMask[PixelPos + uint2(0, -1)];

        // Majority Vote (bit별로)
        uint Reconstructed = 0;
        for (uint Bit = 0; Bit < NumLights; ++Bit)
        {
            uint Mask = (1u << Bit);
            uint Count = 0;
            Count += (Neighbor1 & Mask) ? 1 : 0;
            Count += (Neighbor2 & Mask) ? 1 : 0;
            Count += (Neighbor3 & Mask) ? 1 : 0;
            Count += (Neighbor4 & Mask) ? 1 : 0;

            if (Count >= 2)
                Reconstructed |= Mask;
        }

        DenoisedShadowMask[PixelPos] = Reconstructed;
    }
}
```

**성능:**
```
8 Lights, 1440p:
  Ray Tracing: 1.8ms (모든 Light 한 번에)
  Denoising: 0.4ms (Checkerboard)
  Unpack: 0.3ms (Shader에서 Bit 추출)
  총: 2.5ms

기본 UE Implementation (예상):
  Per-Light Trace: 8 * 1.2ms = 9.6ms
  Per-Light Denoise: 8 * 0.5ms = 4.0ms
  총: 13.6ms

절감: 11.1ms (82% 빠름!)
```

---

### 4. Volumetric Fog with RT Shadows

**문제:**
```cpp
// 기본 Volumetric Fog는 VSM만 지원
// RT Shadow 사용 시 Fog에 그림자 안 들어감
```

**해결책: Inline Volumetric Fog 구현**
```hlsl
// VolumetricFog.usf (커스텀)

RWTexture3D<float4> VolumetricFog;  // 3D Texture (Froxels)
Texture2D<uint> RTShadowMask;

[numthreads(4, 4, 4)]
void VolumetricFogCS(uint3 DispatchThreadId : SV_DispatchThreadID)
{
    // Froxel World Position
    float3 FroxelWorldPos = ComputeFroxelWorldPosition(DispatchThreadId);

    float3 Scattering = 0;

    for (uint LightIndex = 0; LightIndex < NumLights; ++LightIndex)
    {
        FLightData Light = Lights[LightIndex];

        // Shadow Ray (Inline)
        float Shadow = TraceShadowRay(FroxelWorldPos, Light);

        // Scattering
        float3 L = normalize(Light.Position - FroxelWorldPos);
        float Atten = ComputeAttenuation(FroxelWorldPos, Light);

        Scattering += Light.Color * Shadow * Atten;
    }

    VolumetricFog[DispatchThreadId] = float4(Scattering, 1.0f);
}
```

**성능:**
- Volumetric Fog with RT: **추가 1.2ms**
- 품질: VSM과 동일하거나 더 나음

---

### 5. 최종 Shadow 전략

**Avowed의 최종 Shadow 설정:**

#### Quality Mode (30Hz, Series S)
```cpp
// 방향광 (Sun/Moon)
r.Shadow.Virtual = 1  // VSM
r.Shadow.Virtual.SMRT = 1  // Smooth Virtual Shadow Maps

// 로컬 라이트 (Point, Spot, Rect)
r.RayTracing.Shadows = 1  // RT Shadow
r.RayTracing.Shadows.Denoiser = 0  // 커스텀 Denoiser 사용

// Skinned Mesh (NPC, 캐릭터)
r.Shadow.Virtual.Skinned = 0  // VSM 제외
r.RayTracing.Shadows.Skinned = 1  // RT 사용

// Contact Shadow (미세 그림자)
r.ContactShadows = 1
r.ContactShadows.Length = 0.1  // 10cm
```

#### Performance Mode (60Hz, Series S)
```cpp
// 모두 VSM (CPU 병목이라 RT 불필요)
r.Shadow.Virtual = 1
r.RayTracing.Shadows = 0

// Contact Shadow 유지 (저렴)
r.ContactShadows = 1
```

**성능 비교 (Quality Mode, Series S):**
```
Fior 씬:
  Alpha (모두 VSM): 19ms
  Final (VSM + RT): 6ms

절감: 13ms (68% 빠름!)
```

---

## 📦 Virtual Textures 실전 활용

### 1. Virtual Texture 사용 범위

**Avowed의 VT 사용:**
```cpp
// 거의 모든 텍스처를 VT로
// 예외:
//   - UI 텍스처
//   - 즉시 로드 필요 (Post Process 등)
//   - 매우 작은 텍스처 (< 256x256)
```

**장점:**
- ✅ 더 높은 해상도 (4K → 8K)
- ✅ 더 많은 고유 텍스처
- ✅ 메모리 사용량 고정 (Pool 기반)
- ✅ 스트리밍 자동화

---

### 2. Virtual Texture 문제점

#### 문제 1: Texture Address Bound

**배경:**
```cpp
// Virtual Texture는 Indirection Texture 사용
// UV → Indirection Texture → Physical Texture

// Indirection Texture 샘플링:
//   1. UV로 Indirection Texture 샘플
//   2. Page ID 및 Offset 계산
//   3. Physical Texture 샘플

// 문제: Texture Address Unit이 병목
// 일반 Texture: 1회 샘플링
// Virtual Texture: 2회 샘플링 (Indirection + Physical)
```

**실측:**
```
Emerald Stair 씬 (실내, 복잡한 재질):
  GPU Bottleneck: Texture Address Bound
  ALU 사용률: 45%
  Texture Unit 사용률: 92% ← 병목!
```

**부분 해결책:**
```cpp
// Mipmap LOD Bias로 샘플링 부담 감소
r.VirtualTexture.MipBias = 1.0  // +1 LOD (더 낮은 해상도)

// 텍스처 압축 강화
// BC7 → BC5 (Normal Map)
// BC7 → BC1 (Albedo, 품질 허용 시)
```

**결과:**
- Texture Bound: **92% → 78%**
- 시각적 차이: 거의 없음 (Mip Bias로 약간 흐릿)

---

#### 문제 2: Vertex/Pixel Shader Precaching 불가

**배경:**
```cpp
// 일반 Texture: Shader 컴파일 시 Texture Descriptor 캐싱 가능
// Virtual Texture: Runtime에 Page 매핑 변경
// → Descriptor 캐싱 불가
// → 매 Draw Call마다 Descriptor 업데이트
```

**영향:**
- CPU 오버헤드 증가
- Draw Call 비용 상승

**해결책 없음:**
- VT의 근본적인 특성
- 다만 Draw Call 수를 줄이면 완화 (Nanite가 도움)

---

#### 문제 3: Texture Pool Balancing

**문제:**
```cpp
// 여러 압축 포맷을 하나의 Pool에 혼합 불가
// 예:
//   Pool 1: BC7 (Character Textures)
//   Pool 2: BC1 (Environment Textures)

// 문제: 캐릭터가 많으면 Pool 1 부족
//       환경이 복잡하면 Pool 2 부족
```

**해결책:**
```cpp
// Texture Pool 분리
r.VirtualTexture.PoolSize.BC7 = 256  // MB (Characters)
r.VirtualTexture.PoolSize.BC1 = 512  // MB (Environment)

// 해상도 조정
// Characters: 1K (BC7, 고품질)
// Environment: 2K (BC1, 저품질 압축)
```

**추가 최적화:**
```cpp
// 환경 텍스처 압축 강화
// 원본: 2K BC7 (high quality)
// 최종: 2K BC1 (medium quality)

// 품질 손실: 약간 (주로 gradation banding)
// 메모리 절감: 50%
```

---

#### 문제 4: Material Layering과 VT

**문제:**
```cpp
// Material Function에서 VT 사용 시
// Preload Texture List에 제대로 추가 안 됨

// Material Instance:
//   Parent = MF_Landscape
//   Texture = LandscapeAlbedo_VT (Virtual Texture)

// MF_Landscape (Material Function):
//   Albedo = Texture Sample (Texture Parameter)

// 문제: Texture Parameter가 Instance Level에서
//       Preload List에 추가되지 않음
// → Material이 먼저 로드되면
// → Invalid VT Binding
// → 텍스처 다시 로드될 때까지 깨짐
```

**증상:**
```cpp
// 캐릭터 Normal Map이 검은색으로 표시
// 또는 체커보드 패턴 (Invalid Texture)
// 몇 초 후 정상 로딩 (Race Condition)
```

**해결책: 엔진 수정**
```cpp
// MaterialInstance.cpp

void UMaterialInstance::PostLoad()
{
    Super::PostLoad();

    // Material Function에서 사용된 VT도 수집
    TArray<UTexture*> ReferencedTextures;
    GetReferencedTextures(ReferencedTextures);

    for (UTexture* Texture : ReferencedTextures)
    {
        if (Texture->IsVirtualTextured())
        {
            // Preload List에 명시적 추가
            AddPreloadTexture(Texture);
        }
    }
}
```

**결과:**
- Race Condition 완전 제거
- 로딩 시 깨진 텍스처 문제 해결

---

## 🎯 최종 성능 비교 및 권장사항

### 1. 성능 개선 타임라인

#### Paradise 외부 씬 (Xbox Series S, 30Hz)

**Alpha 버전 (프로젝트 중반):**
```
총 프레임 시간: 46.5ms

Breakdown:
  Nanite Vis Buffer: 4.0ms
  Base Pass: 5.0ms
  VSM Shadow Depth: 13.0ms (Masked 1.5ms)
  VSM Projection: 8.0ms
  Lumen: 3.5ms
  Post Process: 5.0ms
  기타: 8.0ms
```

**Final 버전 (출시):**
```
총 프레임 시간: 30.0ms  ← 35% 개선!

Breakdown:
  Nanite Vis Buffer: 2.5ms (-38%)
  Base Pass: 3.5ms (-30%)
  VSM Shadow Depth: 8.0ms (-38%)
  VSM Projection: 4.0ms (-50%)  ← Async Compute
  Lumen: 3.0ms (-14%)  ← Async Compute
  Post Process: 4.0ms (-20%)
  기타: 5.0ms (-38%)
```

**주요 개선 사항:**
1. Masked → Opaque 전환
2. WPO 제거
3. Async Compute 활용
4. VSM Light Source Radius 조정

---

#### Fior 씬 (Xbox Series S, 30Hz)

**Alpha 버전 (VSM만 사용):**
```
총 프레임 시간: 40.0ms

Shadow Breakdown:
  VSM Shadow Depth: 11.0ms
  VSM Projection: 8.0ms
  총 Shadow: 19.0ms (47.5%)  ← 너무 높음!
```

**RT Shadow 전환 후:**
```
총 프레임 시간: 25.0ms  ← 38% 개선!

Shadow Breakdown:
  VSM Shadow Depth: 3.0ms (방향광만)
  RT Shadow: 3.0ms (로컬 라이트)
  총 Shadow: 6.0ms (24%)

절감: 13ms (68% 빠름!)
```

**품질 비교:**
- VSM vs RT: **거의 구분 불가**
- RT가 약간 부드러운 Penumbra

---

### 2. 핵심 교훈 및 권장사항

#### Nanite 관련

**✅ 해야 할 것:**
```cpp
// 1. 가능한 모든 것을 Nanite로
StaticMesh->bEnableNanite = true;

// 2. Masked → Opaque 전환 (필수!)
Material->BlendMode = BLEND_Opaque;

// 3. WPO/PDO 최소화
r.Nanite.AllowWorldPositionOffset = 0;

// 4. Spline은 H-LOD로 베이킹
BakeSplineToStaticMesh();

// 5. 스트리밍 Pool 충분히 할당
r.Nanite.StreamingPoolSize = 512;  // Series X
r.Nanite.StreamingPoolSize = 256;  // Series S
```

**❌ 피해야 할 것:**
```cpp
// 1. Masked Material 남용
Material->BlendMode = BLEND_Masked;  // ❌

// 2. 모든 나무에 WPO 바람 애니메이션
Material->WorldPositionOffset = WindAnimation();  // ❌

// 3. Spline을 Nanite 없이 사용
SplineMesh->bNanite = false;  // ❌

// 4. Material Instance 과다 생성
// 800개 Variant → 800개 빈 Draw Call  // ❌
```

---

#### Lumen 관련

**✅ 해야 할 것:**
```cpp
// 1. 프로젝트 시작 시 Hardware RT로 시작
r.Lumen.HardwareRayTracing = 1;
// 나중에 Software로 다운그레이드는 쉬움
// 반대는 매우 어려움

// 2. Async Compute 활용 (콘솔)
r.Lumen.AsyncCompute = 1;

// 3. Mesh Cards 수 제한
r.Lumen.SurfaceCache.MaxLumenMeshCards = 12;

// 4. Distance Field는 메모리 여유 있을 때만
r.DistanceFields = 1;  // 메모리 여유 있으면
r.DistanceFields = 0;  // 콘솔에서는 제거

// 5. Single Layer Water 최적화 (엔진 수정)
// SSR + Downsampled Lumen 하이브리드
```

**❌ 피해야 할 것:**
```cpp
// 1. Software Lumen으로 시작
// 나중에 Hardware로 업그레이드 매우 어려움  // ❌

// 2. 모든 객체에 24개 Mesh Cards
// 단순한 벽도 24개  // ❌

// 3. Distance Field + Lumen (콘솔)
// 메모리 부족  // ❌

// 4. Single Layer Water 풀 스크린 반사
// 성능 낭비  // ❌
```

---

#### Shadow 관련

**✅ 해야 할 것:**
```cpp
// 1. 단일 Shadow 솔루션에 얽매이지 말 것
// VSM (방향광) + RT (로컬 라이트) 하이브리드

// 2. Skinned Mesh는 RT Shadow
r.Shadow.Virtual.Skinned = 0;
r.RayTracing.Shadows.Skinned = 1;

// 3. Contact Shadow 활용
r.ContactShadows = 1;
r.ContactShadows.Length = 0.1;
// 생각보다 저렴하고 품질 크게 향상

// 4. RT Shadow는 커스텀 구현 고려
// 기본 UE Implementation은 비효율적
```

**❌ 피해야 할 것:**
```cpp
// 1. 모든 Shadow를 VSM으로
// Local Light VSM Invalidation 비용 높음  // ❌

// 2. 모든 Shadow를 RT로
// 방향광 RT는 VSM보다 느릴 수 있음  // ❌

// 3. Contact Shadow 무시
// "비싸다"는 편견  // ❌
```

---

#### Virtual Texture 관련

**✅ 해야 할 것:**
```cpp
// 1. Texture Pool 분리
r.VirtualTexture.PoolSize.BC7 = 256;  // Character
r.VirtualTexture.PoolSize.BC1 = 512;  // Environment

// 2. Mip Bias 조정
r.VirtualTexture.MipBias = 1.0;

// 3. Material Function VT 사용 시 Preload List 확인
// (엔진 수정 필요할 수 있음)

// 4. 압축 포맷 적절히 선택
// BC7: High quality (Character)
// BC1: Low quality (Environment, 거리)
```

**❌ 피해야 할 것:**
```cpp
// 1. 모든 텍스처를 같은 Pool에
// 압축 포맷 혼합 불가  // ❌

// 2. VT를 무조건 사용
// 작은 텍스처 (< 256x256)는 일반 텍스처가 나음  // ❌

// 3. Material Function에서 VT 무분별 사용
// Preload 문제 발생 가능  // ❌
```

---

### 3. 일반적인 개발 및 최적화 팁

#### 벤치마크 하드웨어 조기 설정

**중요성:**
```cpp
// 프로젝트 초기에 목표 하드웨어 확보
// 예: Xbox Series S Dev Kit

// Series S는 가장 낮은 사양
// → Series S에서 60Hz 달성하면
// → Series X에서는 여유
```

**Avowed 경험:**
- Series S Dev Kit를 6개월 늦게 받음
- 후반에 많은 최적화 필요
- **초기부터 있었으면 더 좋았을 것**

---

#### 최적화 시 Async 작업 비활성화

**이유:**
```cpp
// Async Compute는 타이밍 왜곡
// 예:
//   Graphics Queue: 10ms
//   Async Queue: 8ms (오버랩)
//   실제 프레임: 10ms

// Graphics Queue 최적화:
//   10ms → 9ms  ← 1ms 개선!
// 실제 프레임:
//   여전히 10ms  ← Async가 더 길어서 변화 없음

// 착각: 최적화가 안 되고 있다고 생각
```

**올바른 방법:**
```cpp
// 최적화할 때만 Async 끄기
r.Lumen.AsyncCompute = 0;
r.RayTracing.AsyncCompute = 0;

// 최적화 완료 후 다시 켜기
r.Lumen.AsyncCompute = 1;
r.RayTracing.AsyncCompute = 1;
```

---

#### 항상 프로파일링

**주간 성능 회의:**
```cpp
// Obsidian의 방식:
// - 매주 성능 회의
// - 게임 플레이 관찰 (QA 또는 개발자)
// - GPU/CPU 프로파일 실시간 확인
// - 이슈 발견 시 즉시 논의

// 장점:
// - 문제 조기 발견
// - 원인 파악 용이
// - 팀 전체 성능 인식 향상
```

---

#### 오토플레이어 시스템

**강력 추천:**
```cpp
// Autoplay System:
// - AI가 게임 자동 플레이
// - 모든 맵, 모든 경로 탐색
// - 성능 데이터 자동 수집

// 장점:
// - 사람이 놓칠 수 있는 영역 발견
// - 24시간 돌려서 데이터 수집
// - 회귀 테스트 자동화

// Avowed에서:
// - 오토플레이어가 미리 성능 문제 발견
// - QA 전에 수정 가능
```

---

#### 오래된 캡처 저장

**중요성:**
```cpp
// GPU 캡처를 오래 보관
// 예: RenderDoc, PIX 캡처

// 이유:
// - 과거와 비교하여 회귀 확인
// - 최적화 전후 비교
// - 문제 재현 가능

// Avowed:
// - Alpha 버전 캡처 보관
// - Final 버전과 비교
// - 35~38% 성능 향상 입증
```

---

## 📊 최종 성능 요약

### Xbox Series S - Quality Mode (30Hz)

| 씬 | Alpha (ms) | Final (ms) | 개선율 |
|------|------------|------------|--------|
| **Paradise 외부** | 46.5 | 30.0 | **35%** |
| **Emerald Stair** | 53.0 | 33.0 | **38%** |
| **Fior (RT Shadow)** | 40.0 | 25.0 | **38%** |

### 주요 최적화 기여도

| 최적화 | 절감 시간 | 비율 |
|--------|-----------|------|
| **Masked → Opaque** | ~3.5ms | 28% |
| **WPO 제거** | ~1.0ms | 8% |
| **RT Shadow (로컬)** | ~13ms | 68% |
| **Single Layer Water** | ~4ms | 50% |
| **Async Compute** | ~2ms | 36% |
| **VSM 최적화** | ~5ms | 38% |

---

## 📚 참고 자료 (References)

### GDC 발표
- **Matt Campbell (Obsidian Entertainment)** - "Avowed: A GPU Technology Postmortem" (GDC 2025)

### Avowed 게임 정보
- **출시**: 2025년 2월
- **플랫폼**: Xbox Series S/X, PC (Steam)
- **엔진**: Unreal Engine 5.3.2

### 관련 기술 문서
- [Nanite Virtualized Geometry](https://docs.unrealengine.com/5.7/en-US/nanite-virtualized-geometry/)
- [Lumen Global Illumination](https://docs.unrealengine.com/5.7/en-US/lumen-global-illumination/)
- [Virtual Shadow Maps](https://docs.unrealengine.com/5.7/en-US/virtual-shadow-maps/)
- [Virtual Textures](https://docs.unrealengine.com/5.7/en-US/virtual-textures/)

---

## 🗓️ Version History

> v1.0 — 2025-01-23: Avowed GPU Technology Postmortem Deep Dive 초안 작성 (GDC 2025 Matt Campbell 발표 기반, 실전 최적화 사례 및 성능 데이터 포함)