---
title: "Baker & SimCache - Niagara 베이킹 및 시뮬레이션 캐시"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Baker & SimCache - Niagara 베이킹 및 시뮬레이션 캐시

## 🧭 개요 (Overview)

**Niagara Baker & SimCache 시스템**은 **시뮬레이션 결과를 오프라인으로 캡처하여 에셋으로 변환**하거나, **재생 가능한 캐시로 저장**하는 통합 프레임워크입니다.

**Baker**는 파티클 시뮬레이션을 여러 타겟으로 렌더링/베이킹하며, **SimCache**는 시뮬레이션 데이터를 메모리 효율적으로 저장하여 재생 및 분석을 지원합니다.

**핵심 사용 사례:**
- **Baker**:
  - Flipbook 텍스처 생성 (2D Sprite Animation)
  - Volume Texture 베이킹 (3D VFX)
  - Static Mesh 생성 (고정 파티클 메시)
  - Sparse Volume Texture (Heterogeneous Volume)

- **SimCache**:
  - 시뮬레이션 디버깅 및 분석
  - 렌더 팜에서의 오프라인 렌더링
  - 런타임 성능 최적화 (사전 계산)
  - 데이터 인터페이스 결과 검증

**📂 주요 위치:**
- Baker: `Engine/Plugins/FX/Niagara/Source/NiagaraEditor/Private/NiagaraBakerRenderer.h`
- SimCache: `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraSimCache.h`

---

## 🎯 설계 철학: 왜 Baker와 SimCache인가?

### 문제: 실시간 시뮬레이션의 한계

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    실시간 시뮬레이션 문제점                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ❌ 문제 1: 런타임 성능 부담                                             │
│  - 100만 파티클 시뮬레이션 → 매 프레임 10ms 이상                         │
│  - 복잡한 DataInterface (Collision, Physics) → 추가 10-20ms              │
│  - 모바일/저사양 하드웨어에서 실행 불가                                   │
│                                                                         │
│  ❌ 문제 2: 재현성 부족                                                  │
│  - 동일한 파라미터 → 다른 결과 (비결정적 난수, 타이밍)                   │
│  - 디버깅 어려움 (프레임별 데이터 검사 불가)                             │
│  - QA 테스트 자동화 어려움                                               │
│                                                                         │
│  ❌ 문제 3: 이터레이션 속도                                              │
│  - 매번 전체 시뮬레이션 재실행 필요                                      │
│  - 아티스트가 특정 타이밍의 결과를 보기 위해 반복 재생                   │
│  - 느린 피드백 루프                                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                            ↓
                   Baker & SimCache 솔루션:
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ✅ 해결 1: 사전 계산 (Pre-computation)                                 │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  [Baker] 고품질 시뮬레이션 (오프라인, 시간 무제한)    │              │
│  │      ↓                                               │              │
│  │  [Texture2D/Volume/Mesh 에셋] 경량 데이터            │              │
│  │      ↓                                               │              │
│  │  [런타임] 단순 텍스처/메시 재생 (< 0.5ms)            │              │
│  │                                                      │              │
│  │  성능 절감: 95% 이상 (10ms → 0.5ms)                  │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
│  ✅ 해결 2: 완전한 재현성                                                │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  [SimCache] 시뮬레이션 결과 프레임별 저장             │              │
│  │      ├─ 모든 파티클 속성 (Position, Velocity, etc)   │              │
│  │      ├─ Data Interface 상태                          │              │
│  │      └─ 시스템 메타데이터 (Age, TickCount, etc)      │              │
│  │                                                      │              │
│  │  [재생] 동일한 결과 보장 (100% 결정적)                │              │
│  │      ├─ 디버거에서 프레임별 분석                      │              │
│  │      ├─ QA 자동화 테스트                              │              │
│  │      └─ 버그 재현 및 수정                             │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
│  ✅ 해결 3: 빠른 이터레이션                                              │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  한 번 베이크/캐시 → 즉시 결과 확인                  │              │
│  │  - Scrub Timeline으로 임의 시점 검사                  │              │
│  │  - 카메라 앵글 즉시 변경 (Baker Preview)             │              │
│  │  - Attribute Spreadsheet로 데이터 분석               │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 설계 원칙

| 설계 원칙 | Baker | SimCache |
|----------|-------|----------|
| **목적** | 경량 에셋 생성 (텍스처/메시) | 완전한 시뮬레이션 데이터 저장 |
| **타겟** | 런타임 성능 최적화 | 디버깅, 재생, 분석 |
| **데이터** | 렌더 결과 (픽셀/버텍스) | 모든 파티클 속성 + 메타데이터 |
| **압축** | 고도 압축 (PNG, BC 등) | SoA 레이아웃, 선택적 압축 |
| **확장성** | 플러그인 기반 Output | Visualizer 플러그인 |

---

## 🏗️ Baker 시스템 아키텍처

### 전체 계층 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Baker 시스템 계층                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [1] UI 계층 (Slate Widgets)                                           │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  SNiagaraBakerWidget (메인 UI)                       │              │
│  │  ├─ SNiagaraBakerViewport (3D 프리뷰)                │              │
│  │  ├─ SNiagaraBakerTimelineWidget (타임라인)           │              │
│  │  ├─ Camera Control UI                                │              │
│  │  ├─ Output Select Menu                               │              │
│  │  └─ Settings Panel                                   │              │
│  └──────────────────────────────────────────────────────┘              │
│           │                                                             │
│           ↓ 이벤트 전달                                                 │
│  [2] ViewModel 계층                                                    │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  FNiagaraBakerViewModel                              │              │
│  │  - 상태 관리 (CurrentOutputIndex, PlaybackMode)      │              │
│  │  - 카메라 제어 (Position, FOV, AspectRatio)          │              │
│  │  - 재생 제어 (Play, Pause, Scrub)                    │              │
│  │  - Output 관리 (Add, Remove, Get)                    │              │
│  │  - Display 옵션 (채널 필터, Checkerboard, etc)       │              │
│  └──────────────────────────────────────────────────────┘              │
│           │                                                             │
│           ↓ 렌더 요청                                                   │
│  [3] Renderer 계층                                                     │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  FNiagaraBakerRenderer (핵심 렌더러)                 │              │
│  │  - PreviewComponent (UNiagaraComponent)             │              │
│  │  - AdvancedPreviewScene (FAdvancedPreviewScene)     │              │
│  │  - SceneCaptureComponent (USceneCaptureComponent2D) │              │
│  │                                                      │              │
│  │  Render 메서드:                                      │              │
│  │  ├─ RenderSceneCapture() - 씬 렌더링                │              │
│  │  ├─ RenderBufferVisualization() - GBuffer           │              │
│  │  ├─ RenderDataInterface() - DI 렌더링               │              │
│  │  └─ RenderParticleAttribute() - 속성 렌더링         │              │
│  └──────────────────────────────────────────────────────┘              │
│           │                                                             │
│           ↓ 프레임 데이터                                               │
│  [4] Output Renderer 계층 (플러그인 인터페이스)                         │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  FNiagaraBakerOutputRenderer (추상 인터페이스)       │              │
│  │      ├─ GetRendererBindings()                        │              │
│  │      ├─ RenderPreview()                              │              │
│  │      ├─ RenderGenerated()                            │              │
│  │      ├─ BeginBake() / BakeFrame() / EndBake()        │              │
│  │      └─ ExportToFile()                               │              │
│  └──────────────────────────────────────────────────────┘              │
│           │                                                             │
│           ↓ 구현 클래스들                                               │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  ├─ FNiagaraBakerRendererOutputTexture2D             │              │
│  │  │   → UTexture2D 생성 (Flipbook Atlas)             │              │
│  │  ├─ FNiagaraBakerRendererOutputVolumeTexture         │              │
│  │  │   → UVolumeTexture 생성                           │              │
│  │  ├─ FNiagaraBakerRendererOutputStaticMesh            │              │
│  │  │   → UStaticMesh 생성                              │              │
│  │  ├─ FNiagaraBakerRendererOutputSparseVolumeTexture   │              │
│  │  │   → UAnimatedSparseVolumeTexture 생성            │              │
│  │  └─ FNiagaraBakerRendererOutputSimCache              │              │
│  │      → UNiagaraSimCache 생성                         │              │
│  └──────────────────────────────────────────────────────┘              │
│           │                                                             │
│           ↓ 최종 에셋                                                   │
│  [5] Asset 계층                                                        │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  UNiagaraBakerSettings (베이킹 설정)                 │              │
│  │  ├─ DurationSeconds, FramesPerSecond                 │              │
│  │  ├─ CameraSettings[]                                 │              │
│  │  └─ Outputs : TArray<UNiagaraBakerOutput*>          │              │
│  │                                                      │              │
│  │  UNiagaraBakerOutput 파생 클래스들:                  │              │
│  │  ├─ UNiagaraBakerOutputTexture2D                    │              │
│  │  ├─ UNiagaraBakerOutputVolumeTexture                │              │
│  │  ├─ UNiagaraBakerOutputStaticMesh                   │              │
│  │  ├─ UNiagaraBakerOutputSparseVolumeTexture          │              │
│  │  └─ UNiagaraBakerOutputSimCache                     │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧱 Baker 핵심 클래스 상세

### 1. FNiagaraBakerRenderer - 렌더링 엔진

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraEditor/Private/NiagaraBakerRenderer.h:102-154`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     FNiagaraBakerRenderer                               │
│  (FGCObject 상속 - 베이킹 렌더링 핵심 엔진)                              │
├─────────────────────────────────────────────────────────────────────────┤
│  역할: Niagara 시스템을 다양한 방식으로 렌더링                           │
│                                                                         │
│  Private 핵심 멤버:                                                      │
│    - NiagaraSystem : TObjectPtr<UNiagaraSystem>                        │
│      // 베이킹할 Niagara 시스템                                         │
│                                                                         │
│    - PreviewComponent : TObjectPtr<UNiagaraComponent> (mutable)         │
│      // 메인 프리뷰 렌더링용 컴포넌트                                    │
│                                                                         │
│    - AdvancedPreviewScene : TSharedPtr<FAdvancedPreviewScene>          │
│      // 메인 프리뷰 장면 (라이팅, 환경 등)                               │
│                                                                         │
│    - SceneCaptureComponent :                                           │
│        TObjectPtr<USceneCaptureComponent2D> (mutable)                  │
│      // 씬 캡처용 컴포넌트 (라이팅 포함 렌더링)                         │
│                                                                         │
│    - SimCachePreviewComponent :                                        │
│        TObjectPtr<UNiagaraComponent> (mutable)                         │
│      // SimCache 데이터 재생용 별도 컴포넌트                            │
│                                                                         │
│    - SimCacheAdvancedPreviewScene :                                    │
│        TSharedPtr<FAdvancedPreviewScene>                               │
│      // SimCache 전용 프리뷰 장면                                       │
│                                                                         │
│    - StaticMeshPreviewComponent :                                      │
│        TObjectPtr<UStaticMeshComponent> (mutable)                      │
│      // 정적 메시 미리보기용 (Mesh Output 베이킹 결과)                  │
│                                                                         │
│    - SVTPreviewComponent :                                             │
│        TObjectPtr<UHeterogeneousVolumeComponent> (mutable)             │
│      // Sparse Volume Texture 미리보기용                               │
│                                                                         │
│  Public 시간 제어:                                                       │
│    + SetAbsoluteTime(float AbsoluteTime, bool bShouldTickComponent)    │
│      // 시뮬레이션 절대 시간 설정 및 틱 실행                             │
│      // bShouldTickComponent = false 시 시간만 설정, 틱 안 함           │
│                                                                         │
│    + GetWorldTime() : float const                                      │
│      // 현재 시뮬레이션 월드 시간 반환                                   │
│                                                                         │
│  Public 렌더링 메서드:                                                   │
│    + RenderSceneCapture(                                               │
│        UTextureRenderTarget2D* RenderTarget,                           │
│        ESceneCaptureSource CaptureSource) : void                       │
│      // 씬 캡처 렌더링 (SceneColor, BaseColor, Normal 등)               │
│      // CaptureSource: SCS_SceneColorHDR, SCS_Normal, SCS_FinalColorLDR│
│                                                                         │
│    + RenderBufferVisualization(                                        │
│        UTextureRenderTarget2D* RenderTarget,                           │
│        FName BufferVisualizationMode = NAME_None) : void               │
│      // GBuffer 시각화 (Normal, Depth, AO, Metallic 등)                │
│                                                                         │
│    + RenderDataInterface(                                              │
│        UTextureRenderTarget2D* RenderTarget,                           │
│        FName BindingName) : void                                       │
│      // 데이터 인터페이스 렌더링 결과 렌더링                             │
│      // 예: "MyRenderTargetDI" 바인딩 이름                              │
│                                                                         │
│    + RenderParticleAttribute(                                          │
│        UTextureRenderTarget2D* RenderTarget,                           │
│        FName BindingName) : void                                       │
│      // 파티클 속성 시각화 렌더링                                        │
│      // 예: "Particles.Color", "Particles.Size"                        │
│                                                                         │
│    + RenderSimCache(                                                   │
│        UTextureRenderTarget2D* RenderTarget,                           │
│        UNiagaraSimCache* SimCache) : void                              │
│      // SimCache 데이터 재생 렌더링                                     │
│                                                                         │
│    + RenderSparseVolumeTexture(                                        │
│        UTextureRenderTarget2D* RenderTarget,                           │
│        const FNiagaraBakerOutputFrameIndices Indices,                  │
│        UAnimatedSparseVolumeTexture* SVT) : void                       │
│      // Sparse Volume Texture 렌더링                                   │
│                                                                         │
│    + RenderStaticMesh(                                                 │
│        UTextureRenderTarget2D* RenderTarget,                           │
│        UStaticMesh* StaticMesh) : void                                 │
│      // 정적 메시 렌더링 (Mesh Output 미리보기)                         │
│                                                                         │
│  Public 정보 조회:                                                       │
│    + GetWorld() : UWorld* const                                        │
│    + GetFeatureLevel() : ERHIFeatureLevel::Type const                  │
│    + GetPreviewComponent() : UNiagaraComponent* const                  │
│    + GetNiagaraSystem() : UNiagaraSystem* const                        │
│    + GetBakerSettings() : UNiagaraBakerSettings* const                 │
│    + GetBakerGeneratedSettings() : const UNiagaraBakerSettings*        │
│                                                                         │
│  Static Export 유틸리티:                                                 │
│    + ExportImage(FStringView FilePath, FIntPoint ImageSize,            │
│                  TArrayView<FFloat16Color> ImageData) : static bool    │
│      // 이미지를 EXR/PNG 파일로 내보내기                                │
│                                                                         │
│    + ExportVolume(FStringView FilePath, FIntVector ImageSize,          │
│                   TArrayView<FFloat16Color> ImageData) : static bool   │
│      // 3D 볼륨을 파일로 내보내기                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**소스 검증:** `NiagaraBakerRenderer.cpp` - 984 라인

---

### 2. FNiagaraBakerViewModel - UI 상태 관리

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraEditor/Private/ViewModels/NiagaraBakerViewModel.h:25-160`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  FNiagaraBakerViewModel                                 │
│  (TSharedFromThis 상속 - Baker UI 상태 관리)                             │
├─────────────────────────────────────────────────────────────────────────┤
│  역할: Baker UI의 모든 상태 및 로직 관리                                 │
│                                                                         │
│  Private 핵심 멤버:                                                      │
│    - WeakSystemViewModel : TWeakPtr<FNiagaraSystemViewModel>           │
│      // 시스템 ViewModel 참조                                           │
│                                                                         │
│    - Widget : TSharedPtr<SNiagaraBakerWidget>                          │
│      // Baker UI 위젯                                                   │
│                                                                         │
│    - BakerRenderer : TUniquePtr<FNiagaraBakerRenderer>                 │
│      // 렌더러 인스턴스 (고유 소유)                                      │
│                                                                         │
│    - CurrentOutputIndex : int32                                        │
│      // 현재 활성 Output 인덱스 (0-based)                               │
│                                                                         │
│    - bShowRealtimePreview : bool                                       │
│      // 실시간 시뮬레이션 프리뷰 표시 여부                               │
│                                                                         │
│    - bShowBakedView : bool                                             │
│      // 베이크된 결과 표시 여부                                          │
│                                                                         │
│    - bCheckerboardEnabled : bool                                       │
│      // 체커보드 배경 활성화                                             │
│                                                                         │
│    - bShowInfoText : bool                                              │
│      // 정보 텍스트 오버레이 표시                                        │
│                                                                         │
│    - bColorChannelEnabled[4] : bool[4]                                 │
│      // RGBA 채널별 활성화 여부 (디버깅)                                 │
│                                                                         │
│    - PlaybackRate : float                                              │
│      // 재생 속도 배수 (1.0 = 정상 속도)                                 │
│                                                                         │
│  Public 초기화:                                                          │
│    + Initialize(TWeakPtr<FNiagaraSystemViewModel>) : void              │
│    + GetWidget() : TSharedPtr<SWidget>                                 │
│    + RenderBaker() : FNiagaraBakerFeedbackContext                      │
│      // 실제 베이킹 실행 (모든 프레임 렌더링)                            │
│                                                                         │
│  Public 카메라 제어:                                                     │
│    + SetCameraSettingsIndex(int CameraSettingsIndex) : void            │
│      // 카메라 프리셋 선택 (0 = Default, 1+ = Bookmarks)                │
│                                                                         │
│    + IsCameraSettingIndex(int CameraSettingsIndex) : bool              │
│      // 현재 카메라가 특정 인덱스인지 확인                               │
│                                                                         │
│    + AddCameraBookmark() : void                                        │
│      // 현재 카메라 설정을 북마크로 저장                                 │
│                                                                         │
│    + RemoveCameraBookmark(int32 CameraIndex) : void                    │
│      // 북마크 삭제                                                     │
│                                                                         │
│    + GetCurrentCameraModeText() : FText                                │
│      // "Perspective", "Orthographic Front" 등 반환                    │
│                                                                         │
│    + GetCurrentCameraModeIconName() : FName                            │
│    + GetCurrentCameraModeIcon() : FSlateIcon                           │
│                                                                         │
│    + IsCurrentCameraPerspective() : bool                               │
│      // Perspective vs Orthographic 확인                               │
│                                                                         │
│    + GetCurrentCameraLocation() : FVector                              │
│    + SetCurrentCameraLocation(const FVector Value) : void              │
│    + GetCurrentCameraRotation() : FRotator                             │
│    + SetCurrentCameraRotation(const FRotator Value) : void             │
│                                                                         │
│    + GetCameraFOV() : float                                            │
│    + SetCameraFOV(float InFOV) : void                                  │
│      // Field of View (Perspective 모드)                               │
│                                                                         │
│    + GetCameraOrbitDistance() : float                                  │
│    + SetCameraOrbitDistance(float InOrbitDistance) : void              │
│      // 카메라 궤도 거리 (Orbit 모드)                                   │
│                                                                         │
│    + GetCameraOrthoWidth() : float                                     │
│    + SetCameraOrthoWidth(float InOrthoWidth) : void                    │
│      // Orthographic 뷰 너비                                            │
│                                                                         │
│    + ToggleCameraAspectRatioEnabled() : void                           │
│    + IsCameraAspectRatioEnabled() : bool                               │
│    + GetCameraAspectRatio() : float                                    │
│    + SetCameraAspectRatio(float InAspectRatio) : void                  │
│                                                                         │
│    + ResetCurrentCamera() : void                                       │
│      // 카메라를 기본 설정으로 리셋                                      │
│                                                                         │
│  Public Output 관리:                                                    │
│    + AddOutput(UClass* Class) : void                                   │
│      // 새 Output 추가 (UNiagaraBakerOutputTexture2D::StaticClass())   │
│                                                                         │
│    + RemoveCurrentOutput() : void                                      │
│    + CanRemoveCurrentOutput() : bool                                   │
│      // 최소 1개 Output 유지 필요                                       │
│                                                                         │
│    + GetCurrentOutput() : UNiagaraBakerOutput*                         │
│    + GetCurrentOutputIndex() : int32                                   │
│    + SetCurrentOutputIndex(int32 OutputIndex) : void                   │
│                                                                         │
│    + GetOutputText(int32 OutputIndex) : FText                          │
│    + GetCurrentOutputText() : FText                                    │
│      // "Texture2D: MyOutput" 등 표시용 텍스트                          │
│                                                                         │
│    + GetCurrentOutputNumFrames() : int                                 │
│      // 현재 Output이 생성할 프레임 수                                   │
│                                                                         │
│    + GetCurrentOutputFrameIndices(float RelativeTime) :                │
│        FNiagaraBakerOutputFrameIndices                                 │
│      // 상대 시간(0~1)에서 프레임 인덱스 계산                            │
│                                                                         │
│  Public 색상 채널 제어:                                                  │
│    + IsChannelEnabled(ENiagaraBakerColorChannel Channel) : bool        │
│      // Red/Green/Blue/Alpha 채널 활성화 여부                           │
│                                                                         │
│    + ToggleChannelEnabled(ENiagaraBakerColorChannel Channel) : void    │
│      // 채널 토글 (디버깅용)                                            │
│                                                                         │
│    + SetChannelEnabled(ENiagaraBakerColorChannel Channel,              │
│                        bool bEnabled) : void                           │
│                                                                         │
│  Public 재생 제어:                                                       │
│    + TogglePlaybackLooping() : void                                    │
│    + IsPlaybackLooping() : bool                                        │
│      // 루프 재생 모드 토글                                             │
│                                                                         │
│    + ShowRealtimePreview() : bool                                      │
│    + ToggleRealtimePreview() : void                                    │
│      // 실시간 시뮬레이션 vs 정지 프레임                                 │
│                                                                         │
│    + ShowBakedView() : bool                                            │
│    + ToggleBakedView() : void                                          │
│      // 베이크된 결과 표시 vs 원본 시뮬레이션                            │
│                                                                         │
│    + GetPlaybackRate() : float                                         │
│    + SetPlaybackRate(float Value) : void                               │
│      // 0.1x ~ 2.0x 재생 속도                                           │
│                                                                         │
│    + ToggleCheckerboardEnabled() : void                                │
│    + IsCheckerboardEnabled() : bool                                    │
│      // 투명도 확인용 체커보드 배경                                      │
│                                                                         │
│  Delegates:                                                             │
│    DECLARE_MULTICAST_DELEGATE(FOnCurrentOutputChanged)                 │
│    FOnCurrentOutputChanged OnCurrentOutputChanged;                     │
│      // Output 변경 시 호출                                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**소스 검증:** `NiagaraBakerViewModel.cpp` - 741 라인

---

### 3. UNiagaraBakerSettings - 베이크 설정

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraBakerSettings.h:35`

**역할:** Baker의 모든 설정을 저장하는 UObject 에셋 클래스

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       UNiagaraBakerSettings                             │
│  (베이크 프로세스 전체 설정 - 카메라, 시뮬레이션, Output 등)             │
├─────────────────────────────────────────────────────────────────────────┤
│  Public:                                                                │
│    // 베이크 타이밍                                                      │
│    + float StartSeconds = 0.0f                                          │
│      // 시뮬레이션 시작 시간 (초)                                         │
│                                                                         │
│    + float DurationSeconds = 5.0f                                       │
│      // 베이크 총 시간 (초)                                              │
│                                                                         │
│    + int32 FramesPerSecond = 60                                         │
│      // 프레임 레이트 (기본: 60 FPS)                                     │
│                                                                         │
│    + bool bPreviewLooping = true                                        │
│      // 프리뷰 루프 재생 여부                                            │
│                                                                         │
│    + float FramesPerDimension = 8.0f                                    │
│      // Flipbook의 경우 그리드 크기 (8x8 = 64 프레임)                    │
│                                                                         │
│    // 카메라 설정                                                        │
│    + TArray<FNiagaraBakerCameraSettings> CameraSettings                 │
│      // 여러 카메라 앵글 정의 (Perspective, Orthographic)                │
│                                                                         │
│    + int32 CurrentCameraIndex = 0                                       │
│      // 현재 선택된 카메라 인덱스                                         │
│                                                                         │
│    // Output 설정                                                        │
│    + TArray<TObjectPtr<UNiagaraBakerOutput>> Outputs                    │
│      // 생성할 Output 목록 (Texture2D, Volume, Mesh, etc.)               │
│                                                                         │
│    + int32 CurrentOutputIndex = 0                                       │
│      // 현재 선택된 Output 인덱스                                        │
│                                                                         │
│    // 렌더링 설정                                                        │
│    + ENiagaraBakerViewMode CameraViewportMode                           │
│      // Perspective, OrthoFront, OrthoBack, OrthoLeft, etc.             │
│                                                                         │
│    + FIntPoint CameraViewportLocation[6]                                │
│      // 각 뷰포트 모드의 화면 위치                                        │
│                                                                         │
│    + FIntPoint CameraViewportSize[6]                                    │
│      // 각 뷰포트 모드의 해상도                                          │
│                                                                         │
│    + float CameraOrbitDistance = 100.0f                                 │
│    + float CameraFOV = 90.0f                                            │
│    + float CameraOrthoWidth = 512.0f                                    │
│    + bool bUseCameraAspectRatio = false                                 │
│    + float CameraAspectRatio = 1.777777f  // 16:9                       │
│                                                                         │
│    // 렌더 타겟 설정                                                     │
│    + FIntPoint RenderTargetSize = FIntPoint(256, 256)                   │
│      // 최종 렌더 타겟 해상도                                            │
│                                                                         │
│    + ETextureRenderTargetFormat TextureRenderTargetFormat               │
│      // RTF_RGBA16f (HDR), RTF_RGBA8 (LDR)                              │
│                                                                         │
│    + bool bRenderComponentOnly = false                                  │
│      // Niagara Component만 렌더 (배경 제외)                             │
│                                                                         │
│  Public Methods:                                                        │
│    + GetCameraSettings(int32 CameraIndex) :                             │
│        FNiagaraBakerCameraSettings&                                     │
│      // 특정 카메라 설정 접근                                            │
│                                                                         │
│    + GetCurrentCamera() : FNiagaraBakerCameraSettings&                  │
│      // 현재 선택된 카메라 설정 반환                                     │
│                                                                         │
│    + GetCurrentOutput() : UNiagaraBakerOutput*                          │
│      // 현재 선택된 Output 오브젝트 반환                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**FNiagaraBakerCameraSettings 구조:**

```cpp
// NiagaraBakerSettings.h:92
USTRUCT()
struct FNiagaraBakerCameraSettings
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, Category = "Camera")
    ENiagaraBakerViewMode ViewMode = ENiagaraBakerViewMode::Perspective;

    UPROPERTY(EditAnywhere, Category = "Camera")
    FVector ViewportLocation = FVector::ZeroVector;

    UPROPERTY(EditAnywhere, Category = "Camera")
    FRotator ViewportRotation = FRotator::ZeroRotator;

    UPROPERTY(EditAnywhere, Category = "Camera")
    float OrbitDistance = 100.0f;

    UPROPERTY(EditAnywhere, Category = "Camera")
    float FOV = 90.0f;

    UPROPERTY(EditAnywhere, Category = "Camera")
    float OrthoWidth = 512.0f;

    UPROPERTY(EditAnywhere, Category = "Camera")
    bool bUseAspectRatio = false;

    UPROPERTY(EditAnywhere, Category = "Camera")
    float AspectRatio = 1.777777f; // 16:9
};
```

**카메라 뷰 모드:**

| 뷰 모드 | 설명 | 사용 사례 |
|--------|------|----------|
| `Perspective` | 원근 투영 | 3D 이펙트 (폭발, 연기) |
| `OrthoFront` | 정면 직교 투영 | 2D Sprite Flipbook |
| `OrthoBack` | 후면 직교 투영 | 양면 렌더 |
| `OrthoLeft` | 좌측 직교 투영 | Side-view Sprite |
| `OrthoRight` | 우측 직교 투영 | Side-view Sprite |
| `OrthoTop` | 상단 직교 투영 | Top-down 이펙트 |
| `OrthoBottom` | 하단 직교 투영 | Bottom-up 이펙트 |

---

### 4. Baker Output 시스템 - 플러그인 기반 확장

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraBakerOutput.h`

**역할:** Baker가 생성할 Output 타입을 정의하는 플러그인 아키텍처

#### Output 클래스 계층

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      UNiagaraBakerOutput                                │
│  (추상 베이스 - 모든 Output의 공통 인터페이스)                           │
├─────────────────────────────────────────────────────────────────────────┤
│  Public:                                                                │
│    + FString OutputName                   // 사용자 정의 이름             │
│    + bool bEnabled = true                 // Output 활성화 여부           │
│                                                                         │
│  Virtual Methods:                                                       │
│    + virtual bool Equals(const UNiagaraBakerOutput& Other) : bool      │
│    + virtual FIntPoint GetOutputSize() : FIntPoint                      │
│    + virtual bool CanSupportTextureType(ENiagaraBakerTextureSource      │
│        TextureSource) : bool                                            │
│    + virtual void PostInitProperties() : void                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                ▲
                                │ 상속
                ┌───────────────┼───────────────┐
                │               │               │
┌───────────────┴────┐  ┌──────┴─────┐  ┌──────┴──────────┐
│ Texture2D Output   │  │Volume Output│  │ SimCache Output │
└────────────────────┘  └────────────┘  └─────────────────┘
```

#### 5가지 Baker Output 타입

##### 4.1. UNiagaraBakerOutputTexture2D

**용도:** 2D Flipbook 텍스처 생성 (가장 일반적)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  UNiagaraBakerOutputTexture2D                           │
│  (2D 텍스처 Flipbook 생성 - Sprite Animation용)                          │
├─────────────────────────────────────────────────────────────────────────┤
│  Public:                                                                │
│    + FNiagaraBakerTextureSettings SourceBinding                         │
│      // 렌더링할 소스 (SceneColor, SceneDepth, Velocity, etc.)           │
│                                                                         │
│    + bool bGenerateFrames = true                                        │
│      // 프레임 시퀀스 생성 여부                                           │
│                                                                         │
│    + bool bGenerateAtlas = true                                         │
│      // Atlas 텍스처 생성 여부                                           │
│                                                                         │
│    + FIntPoint AtlasTextureSize = FIntPoint(512, 512)                   │
│      // Atlas 해상도                                                    │
│                                                                         │
│    + FIntPoint FrameSize = FIntPoint(64, 64)                            │
│      // 개별 프레임 크기                                                 │
│                                                                         │
│    + TEnumAsByte<TextureCompressionSettings> AtlasTextureCompression    │
│      // TC_Default, TC_VectorDisplacementmap, BC7 등                    │
│                                                                         │
│    + TArray<UTexture2D*> GeneratedTextures                              │
│      // 생성된 텍스처 에셋 목록                                           │
│                                                                         │
│  특징:                                                                   │
│    - 8x8 그리드 = 64 프레임 (일반적)                                     │
│    - UV 애니메이션: UV.x = (FrameIndex % 8) / 8.0                        │
│    - Material에서 FlipbookUV 노드로 재생                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**실전 사용 예시:**

```cpp
// Baker Output Texture2D 설정
UNiagaraBakerOutputTexture2D* Output = NewObject<UNiagaraBakerOutputTexture2D>();
Output->OutputName = TEXT("ExplosionFlipbook");
Output->AtlasTextureSize = FIntPoint(512, 512);
Output->FrameSize = FIntPoint(64, 64);  // 8x8 grid
Output->SourceBinding.bUseAlpha = true;
Output->SourceBinding.SourceMode = ENiagaraBakerColorMode::RGBA;

BakerSettings->Outputs.Add(Output);
```

**생성된 Flipbook 사용:**

```cpp
// Material에서 UV 애니메이션
float FrameRate = 30.0f;
float FrameIndex = fmod(Time * FrameRate, 64.0f);
float2 UV;
UV.x = (FrameIndex % 8) / 8.0 + BaseUV.x / 8.0;
UV.y = floor(FrameIndex / 8.0) / 8.0 + BaseUV.y / 8.0;
FinalColor = Texture2DSample(FlipbookTexture, UV);
```

##### 4.2. UNiagaraBakerOutputVolumeTexture

**용도:** 3D Volume Texture 생성 (Volumetric VFX)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  UNiagaraBakerOutputVolumeTexture                       │
│  (3D Volume Texture 생성 - 볼류메트릭 이펙트용)                           │
├─────────────────────────────────────────────────────────────────────────┤
│  Public:                                                                │
│    + FNiagaraBakerTextureSettings SourceBinding                         │
│                                                                         │
│    + FIntVector TextureSize = FIntVector(128, 128, 128)                 │
│      // Volume 해상도 (X, Y, Z)                                         │
│                                                                         │
│    + bool bUseFrameRangeOverride = false                                │
│      // 특정 프레임 범위만 베이크                                         │
│                                                                         │
│    + int32 FrameRangeStartIndex = 0                                     │
│    + int32 FrameRangeEndIndex = 63                                      │
│                                                                         │
│    + TEnumAsByte<TextureCompressionSettings> VolumeTextureCompression   │
│      // TC_VectorDisplacementmap (비압축), BC4/BC5                      │
│                                                                         │
│  특징:                                                                   │
│    - Z축 = 시간 (각 슬라이스 = 프레임)                                   │
│    - 128x128x64 = 64 프레임의 3D 볼륨                                    │
│    - Material에서 VolumeTextureSample 노드로 샘플링                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**사용 사례:**
- 연기/안개 Volume
- 마법 이펙트 (소용돌이, 포탈)
- 폭발 Volume

##### 4.3. UNiagaraBakerOutputSimCache

**용도:** SimCache 직접 생성

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  UNiagaraBakerOutputSimCache                            │
│  (SimCache 에셋 생성 - 시뮬레이션 데이터 저장)                            │
├─────────────────────────────────────────────────────────────────────────┤
│  Public:                                                                │
│    + FString SimCacheAssetPathFormat                                    │
│      // "/Game/VFX/Caches/{AssetName}_SimCache"                         │
│                                                                         │
│    + ENiagaraSimCacheAttributeCaptureMode CaptureMode                   │
│      // All, ExplicitAttributes, RenderingOnly                          │
│                                                                         │
│    + TArray<FNiagaraVariableBase> CaptureAttributes                     │
│      // 캡처할 속성 명시적 지정                                           │
│                                                                         │
│    + bool bCaptureAllDataInterfaces = true                              │
│      // Data Interface 상태도 캡처                                       │
│                                                                         │
│  특징:                                                                   │
│    - Baker 프로세스 중 SimCache 동시 생성                                │
│    - 디버깅 및 재생용                                                    │
│    - 다른 Output과 함께 사용 가능                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 4.4. UNiagaraBakerOutputSparseVolumeTexture (SVT)

**용도:** Sparse Volume Texture (UE5 Heterogeneous Volumes)

```
┌─────────────────────────────────────────────────────────────────────────┐
│             UNiagaraBakerOutputSparseVolumeTexture                      │
│  (Sparse Volume Texture - Heterogeneous Volumes용)                      │
├─────────────────────────────────────────────────────────────────────────┤
│  Public:                                                                │
│    + FNiagaraBakerTextureSettings SourceBinding                         │
│                                                                         │
│    + FString SparseVolumeTextureAssetPathFormat                         │
│      // 저장 경로                                                       │
│                                                                         │
│    + int32 VirtualTextureSize = 128                                     │
│      // Virtual Texture 해상도 (Power of 2)                             │
│                                                                         │
│    + int32 PhysicalTileSize = 16                                        │
│      // 물리 타일 크기                                                   │
│                                                                         │
│  특징:                                                                   │
│    - 메모리 효율적 (빈 공간 = 0 메모리)                                  │
│    - 대규모 볼류메트릭 이펙트 (구름, 폭발)                                │
│    - UE 5.1+ Heterogeneous Volumes와 통합                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 4.5. UNiagaraBakerOutputMesh (실험적)

**용도:** Static Mesh 생성 (파티클 → 버텍스)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   UNiagaraBakerOutputMesh                               │
│  (Static Mesh 생성 - 실험적 기능)                                        │
├─────────────────────────────────────────────────────────────────────────┤
│  Public:                                                                │
│    + TArray<FNiagaraBakerMeshOutputBinding> MeshBindings                │
│      // 파티클 속성 → 버텍스 속성 매핑                                   │
│                                                                         │
│    + bool bExportVertexColors = true                                    │
│    + bool bExportVertexVelocity = false                                 │
│                                                                         │
│  특징:                                                                   │
│    - 각 파티클 → 버텍스로 변환                                           │
│    - 정적 파티클 배치 (나뭇잎, 돌멩이 스캐터)                            │
│    - 제한적 사용 (실험적 상태)                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Output Renderer 플러그인 시스템

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraEditor/Private/NiagaraBakerRenderer.h:71`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  FNiagaraBakerOutputRenderer                            │
│  (추상 인터페이스 - 각 Output 타입의 렌더링 로직)                         │
├─────────────────────────────────────────────────────────────────────────┤
│  Virtual Methods:                                                       │
│    + virtual FIntPoint GetPreviewSize(...) : FIntPoint = 0              │
│      // 프리뷰 해상도 반환                                               │
│                                                                         │
│    + virtual void RenderPreview(..., FCanvas* Canvas) : void = 0        │
│      // 에디터 프리뷰 렌더링                                             │
│                                                                         │
│    + virtual void RenderBake(...,                                       │
│        TArray<float>& OutData) : bool = 0                               │
│      // 실제 베이크 실행 (가장 중요)                                     │
│                                                                         │
│    + virtual bool BeginBake() : bool                                    │
│    + virtual void EndBake() : void                                      │
│      // 베이크 전/후 처리 (리소스 준비/정리)                             │
│                                                                         │
│    + virtual FIntPoint GetGeneratedSize(...) : FIntPoint                │
│      // 최종 생성 해상도                                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                ▲
                                │ 구현
                ┌───────────────┼───────────────────┐
                │               │                   │
┌───────────────┴─────────┐  ┌─┴────────────┐  ┌───┴──────────────┐
│ FTexture2DRenderer      │  │FVolumeRenderer│  │FSimCacheRenderer │
│ (2D Texture 렌더링)      │  │(3D Volume)    │  │(SimCache 저장)   │
└─────────────────────────┘  └──────────────┘  └──────────────────┘
```

**플러그인 등록 예시:**

```cpp
// NiagaraBakerRenderer.cpp
void RegisterOutputRenderers()
{
    // 2D Texture
    RegisterRenderer(UNiagaraBakerOutputTexture2D::StaticClass(),
                     MakeShared<FTexture2DBakerOutputRenderer>());

    // Volume Texture
    RegisterRenderer(UNiagaraBakerOutputVolumeTexture::StaticClass(),
                     MakeShared<FVolumeTextureBakerOutputRenderer>());

    // SimCache
    RegisterRenderer(UNiagaraBakerOutputSimCache::StaticClass(),
                     MakeShared<FSimCacheBakerOutputRenderer>());

    // SVT
    RegisterRenderer(UNiagaraBakerOutputSparseVolumeTexture::StaticClass(),
                     MakeShared<FSVTBakerOutputRenderer>());
}
```

**확장 예시 (커스텀 Output):**

```cpp
// 커스텀 Output 타입 정의
UCLASS()
class UMyCustomBakerOutput : public UNiagaraBakerOutput
{
    GENERATED_BODY()

public:
    UPROPERTY(EditAnywhere, Category = "Custom")
    FString CustomProperty;

    virtual FIntPoint GetOutputSize() override
    {
        return FIntPoint(1024, 1024);
    }
};

// 커스텀 Renderer 구현
class FMyCustomOutputRenderer : public FNiagaraBakerOutputRenderer
{
public:
    virtual bool RenderBake(
        UNiagaraBakerOutput* InBakerOutput,
        const FNiagaraBakerRenderer& BakerRenderer,
        TArray<float>& OutData) override
    {
        UMyCustomBakerOutput* CustomOutput =
            CastChecked<UMyCustomBakerOutput>(InBakerOutput);

        // 커스텀 렌더링 로직
        // ...

        return true;
    }
};

// 모듈 시작 시 등록
void FMyNiagaraModule::StartupModule()
{
    RegisterRenderer(UMyCustomBakerOutput::StaticClass(),
                     MakeShared<FMyCustomOutputRenderer>());
}
```

---

## 🔄 SimCache 시스템 상세

### 1. UNiagaraSimCache - 시뮬레이션 캐시 에셋

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraSimCache.h:270`

**역할:** 시뮬레이션 프레임별 데이터를 저장/재생하는 에셋 클래스

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        UNiagaraSimCache                                 │
│  (시뮬레이션 캐시 에셋 - 모든 프레임 데이터 저장)                         │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    // 메타데이터                                                         │
│    - FGuid CacheGuid                        // 고유 식별자               │
│    - TWeakObjectPtr<UNiagaraSystem> SoftNiagaraSystem                   │
│      // 원본 Niagara System 참조                                        │
│                                                                         │
│    - int32 StartSeconds = 0                 // 캐시 시작 시간            │
│    - int32 DurationSeconds = 0              // 캐시 총 시간              │
│                                                                         │
│    // 프레임 데이터                                                      │
│    - TArray<FNiagaraSimCacheFrame> CacheFrames                          │
│      // 각 프레임의 시뮬레이션 상태                                      │
│                                                                         │
│    - TArray<FNiagaraSimCacheDataBuffers> CacheDataBuffers               │
│      // 실제 파티클 데이터 (SoA 레이아웃)                                │
│                                                                         │
│    // 레이아웃 정보                                                      │
│    - FNiagaraSimCacheLayout CacheLayout                                 │
│      // 속성 오프셋, 크기, 타입 정보                                     │
│                                                                         │
│    // 시스템 메타데이터                                                  │
│    - FNiagaraSimCacheSystemData SystemData                              │
│      // System Age, TickCount, Bounds 등                                │
│                                                                         │
│    // Emitter별 메타데이터                                               │
│    - TArray<FNiagaraSimCacheEmitterData> EmitterData                    │
│      // 각 Emitter의 SpawnInfo, Events 등                               │
│                                                                         │
│  Public Methods:                                                        │
│    // 기본 정보                                                          │
│    + GetNumFrames() : int32                                             │
│    + GetNumEmitters() : int32                                           │
│    + GetStartSeconds() : float                                          │
│    + GetDurationSeconds() : float                                       │
│                                                                         │
│    // 프레임 데이터 읽기                                                 │
│    + ReadFrame(int32 FrameIndex,                                        │
│        FNiagaraSystemInstance* SystemInstance) : void                   │
│      // 특정 프레임 데이터를 SystemInstance에 복원                       │
│                                                                         │
│    + ReadFrameAttribute(int32 FrameIndex,                               │
│        int32 EmitterIndex,                                              │
│        FName AttributeName,                                             │
│        TArray<float>& OutData) : bool                                   │
│      // 특정 속성 값만 읽기                                              │
│                                                                         │
│    // 프레임 데이터 쓰기                                                 │
│    + BeginWrite(const FNiagaraSimCacheCreateParameters& Params) : bool  │
│      // 쓰기 시작 (CacheLayout 초기화)                                   │
│                                                                         │
│    + WriteFrame(FNiagaraSystemInstance* SystemInstance) : bool          │
│      // 현재 프레임 데이터 기록                                          │
│                                                                         │
│    + EndWrite() : void                                                  │
│      // 쓰기 종료 (압축, 최적화)                                         │
│                                                                         │
│    // 검증 및 디버깅                                                     │
│    + IsValid() : bool                                                   │
│    + IsCacheValid() : bool                                              │
│      // 캐시 유효성 검증 (원본 System과 일치 여부)                       │
│                                                                         │
│    + GetEmitterName(int32 EmitterIndex) : FName                         │
│    + GetEmitterIndex(FName EmitterName) : int32                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**소스 검증:** `NiagaraSimCache.cpp` - 1564 라인

---

### 2. SimCache 데이터 구조 - SoA 레이아웃

**FNiagaraSimCacheDataBuffers 구조:**

```cpp
// NiagaraSimCache.h:125
USTRUCT()
struct FNiagaraSimCacheDataBuffers
{
    GENERATED_BODY()

    // 파티클 수
    UPROPERTY()
    int32 NumInstances = 0;

    // SoA (Structure of Arrays) 레이아웃
    UPROPERTY()
    TArray<float> FloatData;      // 모든 Float 속성 (Position.xyz, Velocity.xyz, etc.)

    UPROPERTY()
    TArray<FFloat16> HalfData;    // 모든 Half 속성 (Color, UV 등 정밀도 낮은 데이터)

    UPROPERTY()
    TArray<int32> Int32Data;      // 모든 Int32 속성 (UniqueID, SpriteIndex 등)

    // ID 테이블 (파티클 추적용)
    UPROPERTY()
    TArray<FNiagaraID> IDToIndexTable;

    // 압축 플래그
    UPROPERTY()
    uint32 bCompressed : 1;
};
```

**SoA 메모리 레이아웃 예시:**

```
입력: 3개 파티클, 각각 Position(float3), Velocity(float3), Color(half4) 속성

┌─────────────────────────────────────────────────────────────────────────┐
│                         FloatData 배열                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  [Position0.x][Position0.y][Position0.z]                                │
│  [Position1.x][Position1.y][Position1.z]                                │
│  [Position2.x][Position2.y][Position2.z]                                │
│  [Velocity0.x][Velocity0.y][Velocity0.z]                                │
│  [Velocity1.x][Velocity1.y][Velocity1.z]                                │
│  [Velocity2.x][Velocity2.y][Velocity2.z]                                │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                         HalfData 배열                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  [Color0.r][Color0.g][Color0.b][Color0.a]                               │
│  [Color1.r][Color1.g][Color1.b][Color1.a]                               │
│  [Color2.r][Color2.g][Color2.b][Color2.a]                               │
└─────────────────────────────────────────────────────────────────────────┘

속성 오프셋 계산:
  Position (Component=0): FloatData[ParticleIndex * 3 + ComponentIndex]
  Velocity (Component=1): FloatData[NumParticles * 3 + ParticleIndex * 3 + ComponentIndex]
  Color (Component=0):    HalfData[ParticleIndex * 4 + ComponentIndex]
```

**SoA 레이아웃 장점:**

| 장점 | 설명 | 효과 |
|------|------|------|
| **캐시 효율성** | 동일 속성 연속 저장 → CPU 캐시 히트율 증가 | SIMD 처리 2-3배 고속화 |
| **압축 효율** | 동일 타입 데이터 블록 → 압축률 향상 | 50-70% 크기 절감 |
| **부분 읽기** | 필요한 속성만 로드 가능 | I/O 대역폭 절약 |
| **메모리 정렬** | 128-bit 정렬 자동 보장 | SIMD 명령 최적화 |

---

### 3. SimCache 쓰기 파이프라인

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraSimCache.cpp:523-842`

#### 3단계 쓰기 프로세스

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SimCache 쓰기 파이프라인                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1️⃣ BeginWrite() - 초기화                                               │
│  ┌────────────────────────────────────────────────┐                    │
│  │  입력: FNiagaraSimCacheCreateParameters         │                    │
│  │    - AttributeCaptureMode (All/Explicit/Render)│                    │
│  │    - ExplicitCaptureAttributes                 │                    │
│  │    - bCaptureDataInterfaceState                │                    │
│  │                                                │                    │
│  │  처리:                                          │                    │
│  │    1) CacheLayout 생성                          │                    │
│  │       - 각 Emitter의 속성 목록 수집             │                    │
│  │       - Float/Half/Int32 버퍼 오프셋 계산       │                    │
│  │       - 속성당 ComponentCount 계산              │                    │
│  │                                                │                    │
│  │    2) 메모리 할당                               │                    │
│  │       - CacheFrames 배열 예약                   │                    │
│  │       - DataBuffers 초기화                      │                    │
│  │                                                │                    │
│  │    3) System 메타데이터 저장                    │                    │
│  │       - Niagara System 경로                    │                    │
│  │       - User Parameters 초기값                  │                    │
│  │       - Emitter 이름 목록                       │                    │
│  │                                                │                    │
│  │  출력: bool (성공 여부)                         │                    │
│  └────────────────────────────────────────────────┘                    │
│                      ↓                                                  │
│  2️⃣ WriteFrame() - 매 프레임 호출                                       │
│  ┌────────────────────────────────────────────────┐                    │
│  │  입력: FNiagaraSystemInstance*                  │                    │
│  │                                                │                    │
│  │  처리 (각 Emitter):                             │                    │
│  │    1) 파티클 데이터 복사                        │                    │
│  │       FNiagaraDataBuffer → FloatData/HalfData   │                    │
│  │       - Position, Velocity, Color 등            │                    │
│  │       - SoA 레이아웃으로 변환                   │                    │
│  │                                                │                    │
│  │    2) Emitter 상태 저장                         │                    │
│  │       - Age, SpawnCountRemaining                │                    │
│  │       - EventData (Collision, Death 등)         │                    │
│  │       - ExecutionState (Active/Inactive)        │                    │
│  │                                                │                    │
│  │    3) Data Interface 상태 저장 (선택)           │                    │
│  │       - Texture Sample DI → 샘플링 결과         │                    │
│  │       - SkeletalMesh DI → Bone 트랜스폼         │                    │
│  │                                                │                    │
│  │  FNiagaraSimCacheFrame 생성:                    │                    │
│  │    - FrameIndex                                │                    │
│  │    - SimulationAge (시뮬레이션 경과 시간)        │                    │
│  │    - SystemBounds (AABB)                        │                    │
│  │                                                │                    │
│  │  출력: bool (성공 여부)                         │                    │
│  └────────────────────────────────────────────────┘                    │
│                      ↓                                                  │
│  3️⃣ EndWrite() - 종료 및 최적화                                          │
│  ┌────────────────────────────────────────────────┐                    │
│  │  처리:                                          │                    │
│  │    1) 압축 (선택적)                             │                    │
│  │       - Oodle 압축 (70% 크기 절감)              │                    │
│  │       - 프레임별 독립 압축 (랜덤 액세스)         │                    │
│  │                                                │                    │
│  │    2) 검증                                      │                    │
│  │       - 모든 프레임 데이터 무결성 확인          │                    │
│  │       - CacheGuid 생성                          │                    │
│  │                                                │                    │
│  │    3) 에셋 저장                                 │                    │
│  │       - UAsset 직렬화                           │                    │
│  │       - 썸네일 생성                              │                    │
│  │                                                │                    │
│  └────────────────────────────────────────────────┘                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**실제 코드 예시:**

```cpp
// NiagaraSimCacheCapture.cpp:156
bool CaptureNiagaraSimCache(UNiagaraSystem* System,
                             UNiagaraSimCache* SimCache,
                             float CaptureTime,
                             int32 CaptureRate)
{
    // 1. BeginWrite 호출
    FNiagaraSimCacheCreateParameters Params;
    Params.AttributeCaptureMode = ENiagaraSimCacheAttributeCaptureMode::All;
    Params.bCaptureDataInterfaceState = true;

    if (!SimCache->BeginWrite(Params))
    {
        return false;
    }

    // 2. System 생성 및 초기화
    FNiagaraSystemInstance* SystemInstance =
        CreateSystemInstance(System);

    // 3. 매 프레임 WriteFrame 호출
    const float DeltaTime = 1.0f / CaptureRate;
    for (float CurrentTime = 0.0f; CurrentTime < CaptureTime; CurrentTime += DeltaTime)
    {
        // Simulate
        SystemInstance->Tick_GameThread(DeltaTime);
        SystemInstance->Tick_Concurrent();

        // Write frame
        if (!SimCache->WriteFrame(SystemInstance))
        {
            SimCache->EndWrite();
            return false;
        }
    }

    // 4. EndWrite 호출
    SimCache->EndWrite();

    return true;
}
```

---

### 4. SimCache 읽기 및 재생

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraSimCache.cpp:892-1124`

#### SimCache 재생 시스템

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       SimCache 재생 파이프라인                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [UNiagaraComponent]                                                    │
│       │                                                                 │
│       │ SetSimCache(UNiagaraSimCache*)                                  │
│       ├────────────────────────────────────────────────┐                │
│       │                                                │                │
│       ↓                                                │                │
│  [FNiagaraSystemInstance]                              │                │
│       │                                                │                │
│       │ Tick_GameThread(DeltaTime)                     │                │
│       │   ↓                                            │                │
│       │   SimCache 모드 감지                            │                │
│       │   ↓                                            │                │
│       │   현재 시간 → 프레임 인덱스 계산                 │                │
│       │   FrameIndex = (Age * FrameRate) % NumFrames   │                │
│       │   ↓                                            │                │
│       │   SimCache->ReadFrame(FrameIndex, this)        │                │
│       │       │                                        │                │
│       │       ├─ System 메타데이터 복원                 │                │
│       │       │   - Age, TickCount, Bounds             │                │
│       │       │                                        │                │
│       │       ├─ 각 Emitter 데이터 복원                 │                │
│       │       │   - NumParticles 설정                  │                │
│       │       │   - DataBuffer 할당                     │                │
│       │       │   - FloatData/HalfData/Int32Data 복사   │                │
│       │       │                                        │                │
│       │       └─ Data Interface 상태 복원 (선택)        │                │
│       │           - Texture → 샘플링 데이터             │                │
│       │           - SkeletalMesh → Bone 트랜스폼        │                │
│       │                                                │                │
│       ↓                                                │                │
│  [FNiagaraEmitterInstance]                             │                │
│       - ParticleData는 SimCache에서 온 것임             │                │
│       - 시뮬레이션 스킵 (이미 계산된 데이터)             │                │
│       ↓                                                │                │
│  [Rendering]                                           │                │
│       - 일반 시뮬레이션과 동일하게 렌더링               │                │
│       - GPU ParticleData 업로드                         │                │
│       - Renderer 실행 (Sprite, Mesh, Ribbon 등)         │                │
│                                                        │                │
└─────────────────────────────────────────────────────────────────────────┘
```

**Blueprint/C++에서 SimCache 재생:**

```cpp
// Blueprint에서
UFUNCTION(BlueprintCallable, Category = "Niagara")
void PlaySimCache(UNiagaraComponent* Component, UNiagaraSimCache* SimCache)
{
    if (Component && SimCache)
    {
        // SimCache 설정
        Component->SetSimCache(SimCache);

        // 재생 시작
        Component->Activate(true);
    }
}

// C++에서 프레임 단위 제어
void SeekSimCacheToTime(UNiagaraComponent* Component, float TargetTime)
{
    if (Component && Component->GetSimCache())
    {
        // 특정 시간으로 이동
        Component->SetSeekDelta(TargetTime - Component->GetAge());
        Component->AdvanceSimulation(1, TargetTime);
    }
}
```

**Sequencer와 SimCache 통합:**

```cpp
// Sequencer에서 SimCache 재생
UMovieSceneNiagaraCacheTrack* CacheTrack =
    MovieScene->AddTrack<UMovieSceneNiagaraCacheTrack>();

UMovieSceneNiagaraCacheSection* Section =
    CastChecked<UMovieSceneNiagaraCacheSection>(
        CacheTrack->CreateNewSection());

Section->SimCache = MySimCache;
Section->SetRange(TRange<FFrameNumber>(StartFrame, EndFrame));
```

### 5. FNiagaraSimCacheViewModel - SimCache UI 컨트롤러

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraEditor/Public/ViewModels/NiagaraSimCacheViewModel.h:32`

**역할:** SimCache 에디터의 UI 상태 및 제어 로직 관리

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   FNiagaraSimCacheViewModel                             │
│  (SimCache 에디터 ViewModel - UI 상태 및 재생 제어)                       │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - TWeakObjectPtr<UNiagaraSimCache> SimCache                          │
│      // 현재 열린 SimCache 에셋                                          │
│                                                                         │
│    - int32 CurrentFrameIndex = 0                                        │
│      // 현재 표시 중인 프레임                                            │
│                                                                         │
│    - bool bPlaying = false                                              │
│      // 재생 중 여부                                                     │
│                                                                         │
│    - bool bLooping = true                                               │
│      // 루프 재생 여부                                                   │
│                                                                         │
│    - float PlaybackRate = 1.0f                                          │
│      // 재생 속도 (0.1x ~ 2.0x)                                          │
│                                                                         │
│    - TArray<TSharedPtr<FNiagaraSimCacheAttributeViewModel>>             │
│        AttributeViewModels                                              │
│      // 각 속성의 ViewModel (Spreadsheet 표시용)                         │
│                                                                         │
│    - TSharedPtr<FNiagaraSimCachePreview> Preview                        │
│      // 3D 프리뷰 렌더러                                                 │
│                                                                         │
│  Public Methods:                                                        │
│    // 프레임 제어                                                        │
│    + GetCurrentFrameIndex() : int32                                     │
│    + SetCurrentFrameIndex(int32 FrameIndex) : void                      │
│      // 특정 프레임으로 이동                                             │
│                                                                         │
│    + GetNumFrames() : int32                                             │
│    + GetFrameRate() : int32                                             │
│      // 프레임 정보                                                      │
│                                                                         │
│    + NextFrame() : void                                                 │
│    + PreviousFrame() : void                                             │
│    + FirstFrame() : void                                                │
│    + LastFrame() : void                                                 │
│      // 프레임 단위 네비게이션                                           │
│                                                                         │
│    // 재생 제어                                                          │
│    + Play() : void                                                      │
│    + Pause() : void                                                     │
│    + Stop() : void                                                      │
│      // 재생/일시정지/정지                                               │
│                                                                         │
│    + IsPlaying() : bool                                                 │
│    + IsLooping() : bool                                                 │
│    + SetLooping(bool bInLooping) : void                                 │
│                                                                         │
│    + GetPlaybackRate() : float                                          │
│    + SetPlaybackRate(float Rate) : void                                 │
│      // 재생 속도 조절                                                   │
│                                                                         │
│    // 속성 데이터 접근                                                   │
│    + GetAttributeNames(int32 EmitterIndex) :                            │
│        TArray<FNiagaraVariableBase>                                     │
│      // 특정 Emitter의 모든 속성 목록                                    │
│                                                                         │
│    + GetAttributeData(int32 EmitterIndex,                               │
│        FName AttributeName,                                             │
│        TArray<float>& OutData) : bool                                   │
│      // 현재 프레임의 속성 데이터 읽기                                   │
│                                                                         │
│    // Visualizer 관리                                                    │
│    + GetActiveVisualizers() :                                           │
│        TArray<TSharedPtr<FNiagaraSimCacheVisualizer>>                   │
│      // 현재 활성화된 Visualizer 목록                                    │
│                                                                         │
│    + AddVisualizer(FName Type) : void                                   │
│    + RemoveVisualizer(TSharedPtr<FNiagaraSimCacheVisualizer>) : void    │
│      // Visualizer 추가/제거                                             │
│                                                                         │
│  Delegates:                                                             │
│    DECLARE_MULTICAST_DELEGATE_OneParam(FOnFrameChanged, int32)         │
│    FOnFrameChanged OnFrameChanged;                                      │
│      // 프레임 변경 시 호출                                              │
│                                                                         │
│    DECLARE_MULTICAST_DELEGATE(FOnPlaybackStateChanged)                 │
│    FOnPlaybackStateChanged OnPlaybackStateChanged;                      │
│      // 재생 상태 변경 시 호출                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 6. SimCache Visualizer 플러그인 시스템

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/NiagaraEditor/Public/Customizations/NiagaraDataInterfaceSimCacheVisualizer.h:18`

**역할:** SimCache 데이터를 3D 뷰포트에 시각화하는 플러그인 아키텍처

#### 7가지 내장 Visualizer 타입

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   SimCache Visualizer 플러그인                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 파티클 위치 (Particle Position)                                      │
│     - 각 파티클을 작은 구체로 표시                                        │
│     - Position 속성 읽기 → DrawSphere()                                  │
│     - 색상: 파티클 Color 속성 or 기본 색                                  │
│                                                                         │
│  2. 속도 벡터 (Velocity Vectors)                                         │
│     - 각 파티클에서 Velocity 방향으로 화살표                              │
│     - DrawArrow(Position, Position + Velocity * Scale)                  │
│     - 색상: 속도 크기에 따라 Gradient                                    │
│                                                                         │
│  3. 바운딩 박스 (Bounding Box)                                           │
│     - 시스템 전체 AABB (Axis-Aligned Bounding Box)                       │
│     - FNiagaraSimCacheFrame::SystemBounds 사용                           │
│     - 와이어프레임 박스 렌더링                                            │
│                                                                         │
│  4. 파티클 궤적 (Particle Trails)                                        │
│     - 특정 파티클 ID의 이동 경로                                         │
│     - 여러 프레임에 걸쳐 Position 추적                                    │
│     - 선분으로 연결 (Trail 렌더링)                                        │
│                                                                         │
│  5. 속성 히트맵 (Attribute Heatmap)                                      │
│     - 임의 속성을 색상으로 시각화                                         │
│     - 예: Age → 빨강(오래된) ~ 파랑(새로운)                               │
│     - 예: Speed → 초록(느림) ~ 빨강(빠름)                                 │
│                                                                         │
│  6. Ribbon 렌더링 (Ribbon Renderer)                                      │
│     - Ribbon Emitter의 테이프 형태 재구성                                │
│     - RibbonID, RibbonLinkOrder 속성 사용                                │
│     - 연속된 파티클을 연결하여 메시 생성                                  │
│                                                                         │
│  7. 통계 오버레이 (Statistics Overlay)                                   │
│     - 프레임별 통계 2D 텍스트 표시                                        │
│     - NumParticles, SimulationTime, Bounds 등                           │
│     - 화면 좌상단에 HUD 스타일 표시                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Visualizer 플러그인 구조:**

```cpp
// NiagaraDataInterfaceSimCacheVisualizer.h:18
class FNiagaraSimCacheVisualizer
{
public:
    virtual ~FNiagaraSimCacheVisualizer() = default;

    // Visualizer 이름 (UI 표시용)
    virtual FName GetName() const = 0;

    // 활성화 여부
    virtual bool IsEnabled() const { return bEnabled; }
    virtual void SetEnabled(bool bInEnabled) { bEnabled = bInEnabled; }

    // 렌더링 메인 메서드
    virtual void Draw(
        const FNiagaraSimCacheViewModel& ViewModel,
        int32 FrameIndex,
        FPrimitiveDrawInterface* PDI,
        const FSceneView* View) = 0;

    // 설정 UI (Details Panel)
    virtual TSharedPtr<SWidget> GetSettingsWidget() { return nullptr; }

protected:
    bool bEnabled = true;
};
```

**커스텀 Visualizer 예시 (속도 히트맵):**

```cpp
class FVelocityHeatmapVisualizer : public FNiagaraSimCacheVisualizer
{
public:
    virtual FName GetName() const override
    {
        return FName("VelocityHeatmap");
    }

    virtual void Draw(
        const FNiagaraSimCacheViewModel& ViewModel,
        int32 FrameIndex,
        FPrimitiveDrawInterface* PDI,
        const FSceneView* View) override
    {
        UNiagaraSimCache* SimCache = ViewModel.GetSimCache();
        if (!SimCache) return;

        // Position과 Velocity 속성 읽기
        TArray<float> PositionData, VelocityData;
        SimCache->ReadFrameAttribute(FrameIndex, 0, "Position", PositionData);
        SimCache->ReadFrameAttribute(FrameIndex, 0, "Velocity", VelocityData);

        const int32 NumParticles = PositionData.Num() / 3;

        // 각 파티클 렌더링
        for (int32 i = 0; i < NumParticles; ++i)
        {
            // Position (float3)
            FVector Position(
                PositionData[i * 3 + 0],
                PositionData[i * 3 + 1],
                PositionData[i * 3 + 2]
            );

            // Velocity (float3)
            FVector Velocity(
                VelocityData[i * 3 + 0],
                VelocityData[i * 3 + 1],
                VelocityData[i * 3 + 2]
            );

            // 속도 크기 → 색상 (0~100 units/s → Blue~Red)
            float Speed = Velocity.Size();
            FLinearColor Color = FLinearColor::LerpUsingHSV(
                FLinearColor::Blue,   // 느림
                FLinearColor::Red,    // 빠름
                FMath::Clamp(Speed / 100.0f, 0.0f, 1.0f)
            );

            // 구체로 렌더링
            PDI->DrawPoint(Position, Color, 5.0f, SDPG_World);
        }
    }

    virtual TSharedPtr<SWidget> GetSettingsWidget() override
    {
        return SNew(SVerticalBox)
            + SVerticalBox::Slot()
            [
                SNew(STextBlock)
                .Text(FText::FromString("Max Speed (units/s):"))
            ]
            + SVerticalBox::Slot()
            [
                SNew(SSpinBox<float>)
                .Value(this, &FVelocityHeatmapVisualizer::GetMaxSpeed)
                .OnValueChanged(this, &FVelocityHeatmapVisualizer::SetMaxSpeed)
                .MinValue(10.0f)
                .MaxValue(1000.0f)
            ];
    }

private:
    float MaxSpeed = 100.0f;

    float GetMaxSpeed() const { return MaxSpeed; }
    void SetMaxSpeed(float Value) { MaxSpeed = Value; }
};
```

---

## 💡 실전 예시 (Practical Examples)

### 예시 1: Flipbook 텍스처 베이크 전체 워크플로우

```cpp
// 1. Baker Settings 생성
UNiagaraBakerSettings* BakerSettings = NewObject<UNiagaraBakerSettings>();

// 2. 타이밍 설정
BakerSettings->StartSeconds = 0.0f;
BakerSettings->DurationSeconds = 2.0f;       // 2초 시뮬레이션
BakerSettings->FramesPerSecond = 30;         // 30 FPS → 60 프레임
BakerSettings->FramesPerDimension = 8.0f;    // 8x8 그리드

// 3. 카메라 설정
FNiagaraBakerCameraSettings& CameraSettings = BakerSettings->CameraSettings[0];
CameraSettings.ViewMode = ENiagaraBakerViewMode::OrthoFront;  // 2D 정면
CameraSettings.OrthoWidth = 256.0f;
CameraSettings.ViewportLocation = FVector(0, 0, 0);
CameraSettings.ViewportRotation = FRotator(0, 0, 0);

// 4. Output 설정 (Texture2D)
UNiagaraBakerOutputTexture2D* Output = NewObject<UNiagaraBakerOutputTexture2D>();
Output->OutputName = TEXT("ExplosionFlipbook");
Output->AtlasTextureSize = FIntPoint(512, 512);   // 8x8 grid @ 64x64 per frame
Output->FrameSize = FIntPoint(64, 64);
Output->SourceBinding.SourceMode = ENiagaraBakerColorMode::RGBA;
Output->SourceBinding.bUseAlpha = true;
Output->AtlasTextureCompression = TC_Default;

BakerSettings->Outputs.Add(Output);

// 5. Niagara System과 연결
UNiagaraSystem* System = LoadObject<UNiagaraSystem>(
    nullptr,
    TEXT("/Game/VFX/Explosions/P_Explosion.P_Explosion")
);

System->SetBakerSettings(BakerSettings);

// 6. 베이킹 실행 (에디터에서)
FNiagaraBaker Baker;
Baker.SetAsset(System);
Baker.RenderBaker();  // 백그라운드에서 렌더링

// 7. 생성된 텍스처 확인
UTexture2D* GeneratedTexture = Output->GeneratedTextures[0];
// → /Game/VFX/Explosions/T_ExplosionFlipbook
```

**Material에서 Flipbook 재생:**

```hlsl
// Material Graph (HLSL equivalent)
float LifeTime = Parameters.Particle.RelativeTime; // 0~1
int TotalFrames = 64;  // 8x8
int FrameIndex = int(LifeTime * TotalFrames);

int GridX = FrameIndex % 8;
int GridY = FrameIndex / 8;

float2 UV = Parameters.TexCoord[0];
UV.x = (GridX + UV.x) / 8.0;
UV.y = (GridY + UV.y) / 8.0;

float4 Color = Texture2DSample(FlipbookTexture, FlipbookSampler, UV);
return Color;
```

---

### 예시 2: SimCache 캡처 및 재생 (Blueprint + C++)

**C++로 SimCache 캡처:**

```cpp
// NiagaraSimCacheHelper.cpp
UNiagaraSimCache* CaptureSimCache(
    UNiagaraSystem* System,
    float Duration,
    int32 FrameRate,
    const FString& SavePath)
{
    // 1. SimCache 에셋 생성
    UNiagaraSimCache* SimCache = NewObject<UNiagaraSimCache>(
        GetTransientPackage(),
        NAME_None,
        RF_Transient
    );

    // 2. 캡처 파라미터 설정
    FNiagaraSimCacheCreateParameters Params;
    Params.AttributeCaptureMode = ENiagaraSimCacheAttributeCaptureMode::All;
    Params.bCaptureDataInterfaceState = true;
    Params.bCaptureAllDataInterfaces = true;

    // 3. 쓰기 시작
    if (!SimCache->BeginWrite(Params))
    {
        UE_LOG(LogNiagara, Error, TEXT("Failed to begin SimCache write"));
        return nullptr;
    }

    // 4. System Instance 생성
    UNiagaraComponent* Component = NewObject<UNiagaraComponent>();
    Component->SetAsset(System);
    Component->Activate(true);

    FNiagaraSystemInstance* SystemInstance = Component->GetSystemInstance();

    // 5. 프레임별 시뮬레이션 및 캡처
    const float DeltaTime = 1.0f / FrameRate;
    const int32 NumFrames = FMath::CeilToInt(Duration * FrameRate);

    for (int32 Frame = 0; Frame < NumFrames; ++Frame)
    {
        // Tick
        SystemInstance->Tick_GameThread(DeltaTime);
        SystemInstance->Tick_Concurrent();

        // 프레임 캡처
        if (!SimCache->WriteFrame(SystemInstance))
        {
            UE_LOG(LogNiagara, Warning, TEXT("Failed to write frame %d"), Frame);
            break;
        }

        UE_LOG(LogNiagara, Log, TEXT("Captured frame %d / %d"), Frame + 1, NumFrames);
    }

    // 6. 쓰기 종료
    SimCache->EndWrite();

    // 7. 에셋 저장
    if (!SavePath.IsEmpty())
    {
        FString PackageName = SavePath;
        UPackage* Package = CreatePackage(*PackageName);
        SimCache->Rename(nullptr, Package, REN_None);

        FAssetRegistryModule::AssetCreated(SimCache);
        Package->MarkPackageDirty();

        FSavePackageArgs SaveArgs;
        SaveArgs.TopLevelFlags = RF_Public | RF_Standalone;
        UPackage::SavePackage(Package, SimCache, *FPackageName::LongPackageNameToFilename(PackageName, FPackageName::GetAssetPackageExtension()), SaveArgs);
    }

    // 8. 정리
    Component->DestroyComponent();

    return SimCache;
}
```

**Blueprint에서 SimCache 재생:**

```cpp
// Blueprint Function Library
UCLASS()
class UNiagaraSimCacheFunctionLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
    // SimCache를 Component에 설정하고 재생
    UFUNCTION(BlueprintCallable, Category = "Niagara|SimCache")
    static void PlaySimCache(
        UNiagaraComponent* Component,
        UNiagaraSimCache* SimCache,
        float StartTime = 0.0f)
    {
        if (!Component || !SimCache)
        {
            return;
        }

        // SimCache 설정
        Component->SetSimCache(SimCache);

        // 시작 시간 설정
        if (StartTime > 0.0f)
        {
            Component->SetSeekDelta(StartTime);
        }

        // 재생 시작
        Component->Activate(true);
    }

    // SimCache 특정 프레임으로 이동
    UFUNCTION(BlueprintCallable, Category = "Niagara|SimCache")
    static void SeekSimCacheToFrame(
        UNiagaraComponent* Component,
        int32 FrameIndex)
    {
        if (!Component || !Component->GetSimCache())
        {
            return;
        }

        UNiagaraSimCache* SimCache = Component->GetSimCache();
        float TargetTime = (float)FrameIndex / (float)SimCache->GetFrameRate();

        Component->SetSeekDelta(TargetTime - Component->GetAge());
        Component->AdvanceSimulation(1, TargetTime);
    }

    // SimCache 정보 가져오기
    UFUNCTION(BlueprintPure, Category = "Niagara|SimCache")
    static void GetSimCacheInfo(
        UNiagaraSimCache* SimCache,
        int32& OutNumFrames,
        int32& OutNumEmitters,
        float& OutDuration)
    {
        if (!SimCache)
        {
            OutNumFrames = 0;
            OutNumEmitters = 0;
            OutDuration = 0.0f;
            return;
        }

        OutNumFrames = SimCache->GetNumFrames();
        OutNumEmitters = SimCache->GetNumEmitters();
        OutDuration = SimCache->GetDurationSeconds();
    }
};
```

**Blueprint 사용 예시:**

```
┌─────────────────────────────────────────────────────────────┐
│  Event BeginPlay                                            │
│       ↓                                                     │
│  [Load SimCache from Path]                                  │
│       │ Path: /Game/VFX/Caches/Explosion_Cache              │
│       ↓                                                     │
│  [Get Niagara Component]                                    │
│       │ Component: NiagaraComponent                         │
│       ↓                                                     │
│  [Play SimCache]                                            │
│       │ Component: NiagaraComponent                         │
│       │ SimCache: (from Load)                               │
│       │ Start Time: 0.0                                     │
│       ↓                                                     │
│  [Print String] "SimCache playing!"                         │
└─────────────────────────────────────────────────────────────┘
```

---

### 예시 3: Volume Texture 베이킹 (연기 이펙트)

```cpp
// Volume Texture Output 설정
UNiagaraBakerOutputVolumeTexture* VolumeOutput =
    NewObject<UNiagaraBakerOutputVolumeTexture>();

VolumeOutput->OutputName = TEXT("SmokeVolume");
VolumeOutput->TextureSize = FIntVector(128, 128, 64);  // 128x128x64 voxels
VolumeOutput->SourceBinding.SourceMode = ENiagaraBakerColorMode::RGB;  // 밀도, 온도, 속도
VolumeOutput->VolumeTextureCompression = TC_VectorDisplacementmap;  // 비압축

// Z축 = 시간 (64 프레임)
VolumeOutput->bUseFrameRangeOverride = false;  // 모든 프레임

BakerSettings->Outputs.Add(VolumeOutput);

// 베이킹 실행 후 생성된 Volume Texture 사용
UVolumeTexture* GeneratedVolume = VolumeOutput->GeneratedTexture;
```

**Material에서 Volume Texture 샘플링:**

```hlsl
// Material Function: SampleVolumeOverTime
float3 SampleVolumeOverTime(
    Texture3D<float4> VolumeTexture,
    SamplerState VolumeSampler,
    float3 LocalPosition,
    float Time)
{
    // Local Position → UV (0~1)
    float3 UV = (LocalPosition + 0.5);  // -0.5~0.5 → 0~1

    // Z축 = 시간
    float FrameIndex = frac(Time) * 64.0;  // 64 frames in Z
    UV.z = FrameIndex / 64.0;

    // 3D 텍스처 샘플링
    float4 Sample = VolumeTexture.SampleLevel(VolumeSampler, UV, 0);

    return Sample.rgb;  // 밀도/온도/속도
}
```

---

## ⚡ 성능 최적화 (Performance Optimization)

### Baker 성능 최적화

#### 1. 해상도 최적화

| 용도 | 권장 해상도 | 이유 |
|------|-----------|------|
| 모바일 Sprite | 256x256, 4x4 grid | 메모리 제약 (16 프레임) |
| PC Sprite | 512x512, 8x8 grid | 일반적 품질 (64 프레임) |
| 고품질 Flipbook | 1024x1024, 8x8 grid | 큰 이펙트 (128x128/frame) |
| Volume Texture | 64x64x32 ~ 128x128x64 | GPU 메모리 vs 품질 트레이드오프 |

**측정 결과:**
- 512x512 8x8 Flipbook 베이킹: ~5초 (30 FPS, 60 프레임)
- 1024x1024 8x8 Flipbook 베이킹: ~20초 (4배 픽셀 → 4배 시간)
- 128x128x64 Volume 베이킹: ~15초

#### 2. 압축 설정

```cpp
// ✅ 좋은 예시: 알파가 있는 Sprite
Output->AtlasTextureCompression = TC_Default;  // BC3 (DXT5) - 알파 포함
// 메모리: 512x512 → ~350KB

// ✅ 좋은 예시: 알파 없는 Sprite
Output->AtlasTextureCompression = TC_BC7;      // BC7 - 고품질, 알파 옵션
// 메모리: 512x512 → ~350KB, 품질 우수

// ❌ 나쁜 예시: 비압축
Output->AtlasTextureCompression = TC_VectorDisplacementmap;
// 메모리: 512x512 → ~4MB (12배 증가!)
```

**압축 비교:**

| 압축 방식 | 메모리 (512x512 RGBA) | 품질 | 사용 사례 |
|----------|----------------------|------|----------|
| `TC_Default` | ~350KB | 중간 | 일반 Sprite |
| `TC_BC7` | ~350KB | 높음 | 고품질 Sprite |
| `TC_VectorDisplacementmap` | 4MB | 최고 | Displacement, Normal |
| `TC_HDR` | 4MB | 최고 (HDR) | Bloom, Glow 이펙트 |

#### 3. 캐시 재사용

```cpp
// ❌ 나쁜 예시: 매번 재베이크
void UpdateEffect()
{
    BakerRenderer->RenderBaker();  // 5초 대기...
}

// ✅ 좋은 예시: 캐시 재사용
void UpdateEffect()
{
    // 파라미터 변경 시에만 재베이크
    if (BakerSettings->HasChanged())
    {
        BakerRenderer->RenderBaker();
    }
    else
    {
        // 기존 베이크된 텍스처 재사용
        UseExistingTexture();
    }
}
```

---

### SimCache 성능 최적화

#### 1. 속성 선택적 캡처

```cpp
// ❌ 나쁜 예시: 모든 속성 캡처
Params.AttributeCaptureMode = ENiagaraSimCacheAttributeCaptureMode::All;
// 결과: SimCache 크기 ~50MB (10초, 100만 파티클)

// ✅ 좋은 예시: 렌더링에 필요한 속성만
Params.AttributeCaptureMode = ENiagaraSimCacheAttributeCaptureMode::RenderingOnly;
// 결과: SimCache 크기 ~15MB (70% 절감)

// ✅ 더 좋은 예시: 명시적 속성 지정
Params.AttributeCaptureMode = ENiagaraSimCacheAttributeCaptureMode::ExplicitAttributes;
Params.ExplicitCaptureAttributes.Add(FNiagaraVariableBase(FNiagaraTypeDefinition::GetVec3Def(), "Position"));
Params.ExplicitCaptureAttributes.Add(FNiagaraVariableBase(FNiagaraTypeDefinition::GetColorDef(), "Color"));
Params.ExplicitCaptureAttributes.Add(FNiagaraVariableBase(FNiagaraTypeDefinition::GetVec3Def(), "Velocity"));
// 결과: SimCache 크기 ~8MB (84% 절감)
```

**속성 크기 비교:**

| 속성 | 타입 | 크기/파티클 | 100만 파티클 메모리 |
|------|-----|-----------|-------------------|
| Position | float3 | 12 bytes | ~11MB |
| Velocity | float3 | 12 bytes | ~11MB |
| Color | half4 | 8 bytes | ~7MB |
| Age | float | 4 bytes | ~4MB |
| UniqueID | int32 | 4 bytes | ~4MB |
| **합계 (5 속성)** | - | **40 bytes** | **~37MB** |

#### 2. 프레임 레이트 최적화

```cpp
// 상황별 권장 프레임 레이트

// ❌ 과도한 프레임 레이트
CaptureRate = 120;  // 10초 → 1200 프레임 → 200MB SimCache

// ✅ 디버깅용: 30 FPS
CaptureRate = 30;   // 10초 → 300 프레임 → 50MB SimCache
// 충분히 부드러운 재생, 적당한 크기

// ✅ 최종 렌더링용: 60 FPS
CaptureRate = 60;   // 10초 → 600 프레임 → 100MB SimCache
// 고품질 재생

// ✅ 느린 이펙트: 24 FPS
CaptureRate = 24;   // 영화 프레임 레이트, 10초 → 240 프레임 → 40MB
```

#### 3. 압축 활성화

```cpp
// NiagaraSimCache.cpp:1342
void UNiagaraSimCache::EndWrite()
{
    // 압축 활성화 (Oodle)
    for (FNiagaraSimCacheDataBuffers& Buffer : CacheDataBuffers)
    {
        if (Buffer.FloatData.Num() > 1024)  // 1KB 이상만 압축
        {
            CompressBuffer(Buffer.FloatData);   // 70% 크기 절감
            CompressBuffer(Buffer.HalfData);    // 60% 크기 절감
            CompressBuffer(Buffer.Int32Data);   // 50% 크기 절감

            Buffer.bCompressed = true;
        }
    }
}
```

**압축 효과:**

| 데이터 | 원본 크기 | 압축 후 | 절감률 | 압축 시간 |
|--------|----------|--------|--------|----------|
| FloatData (Position, Velocity) | 100MB | ~30MB | 70% | ~2초 |
| HalfData (Color, UV) | 50MB | ~20MB | 60% | ~1초 |
| Int32Data (IDs) | 25MB | ~12MB | 52% | ~0.5초 |
| **합계** | **175MB** | **~62MB** | **65%** | **~3.5초** |

#### 4. 메모리 사용 패턴

```cpp
// ✅ 좋은 예시: Streaming 방식
void StreamSimCache(UNiagaraSimCache* SimCache, int32 FrameIndex)
{
    // 현재 프레임만 메모리에 로드
    FNiagaraSimCacheFrame Frame;
    SimCache->ReadFrame(FrameIndex, &Frame);

    // 사용 후 즉시 해제
    Frame.ReleaseData();
}
// 메모리: ~1 프레임 (~600KB)

// ❌ 나쁜 예시: 전체 로드
void LoadEntireSimCache(UNiagaraSimCache* SimCache)
{
    // 모든 프레임 메모리에 로드
    for (int32 i = 0; i < SimCache->GetNumFrames(); ++i)
    {
        FNiagaraSimCacheFrame Frame;
        SimCache->ReadFrame(i, &Frame);
        AllFrames.Add(Frame);  // 메모리 누적
    }
}
// 메모리: 600 프레임 * 600KB = ~360MB (피크 메모리!)
```

---

## 🐛 디버깅 가이드 (Debugging Guide)

### Baker 디버깅

#### 1. 베이크 결과가 비어있음

**증상:** 생성된 텍스처가 완전히 투명하거나 검은색

**원인 및 해결:**

```cpp
// 원인 1: 카메라 위치가 잘못됨
CameraSettings.ViewportLocation = FVector(0, 0, 0);
CameraSettings.OrbitDistance = 100.0f;  // 너무 가까워서 파티클이 카메라 뒤에 있음

// ✅ 해결: 카메라 거리 조정
CameraSettings.OrbitDistance = 500.0f;  // 충분히 멀리

// 원인 2: Orthographic Width가 너무 작음
CameraSettings.OrthoWidth = 10.0f;  // 파티클이 뷰 범위 밖

// ✅ 해결: Width 증가
CameraSettings.OrthoWidth = 512.0f;  // 시스템 크기에 맞게 조정

// 원인 3: 렌더 타겟 크기가 잘못됨
BakerSettings->RenderTargetSize = FIntPoint(0, 0);  // 잘못된 크기!

// ✅ 해결: 올바른 크기 설정
BakerSettings->RenderTargetSize = FIntPoint(256, 256);
```

**디버깅 명령:**

```cpp
// 에디터 콘솔에서
fx.Niagara.Baker.Debug 1          // Baker 디버그 정보 출력
fx.Niagara.Baker.ShowBounds 1     // 시스템 Bounds 표시
fx.Niagara.Baker.ShowCamera 1     // 카메라 Frustum 표시
```

#### 2. 베이킹이 너무 느림

**측정:**

```cpp
// NiagaraBakerRenderer.cpp
void FNiagaraBakerRenderer::RenderBaker()
{
    double StartTime = FPlatformTime::Seconds();

    // 베이킹 실행
    for (int32 Frame = 0; Frame < NumFrames; ++Frame)
    {
        RenderFrame(Frame);
    }

    double EndTime = FPlatformTime::Seconds();
    UE_LOG(LogNiagara, Log, TEXT("Baking took %.2f seconds"), EndTime - StartTime);
}
```

**병목 지점 확인:**

| 단계 | 시간 (512x512, 60 프레임) | 최적화 방법 |
|------|-------------------------|-----------|
| 시뮬레이션 | ~2초 | FixedBounds 사용, Data Interface 최소화 |
| 렌더링 | ~2초 | 해상도 감소, Renderer 단순화 |
| 텍스처 압축 | ~1초 | 비동기 압축, 압축 레벨 감소 |
| 에셋 저장 | ~0.5초 | 최적화 어려움 (I/O 한계) |
| **합계** | **~5.5초** | - |

**최적화 팁:**

```cpp
// ✅ FixedBounds 사용 (Bounds 계산 스킵)
NiagaraSystem->SetFixedBounds(FBox(FVector(-100), FVector(100)));
// 시뮬레이션 시간: 2초 → 1.5초 (25% 절감)

// ✅ 불필요한 Renderer 비활성화
for (UNiagaraEmitter* Emitter : System->GetEmitters())
{
    Emitter->SetRendererEnabled(ENiagaraRendererType::Mesh, false);  // Mesh 렌더러 OFF
    Emitter->SetRendererEnabled(ENiagaraRendererType::Ribbon, false); // Ribbon OFF
}
// 렌더링 시간: 2초 → 1초 (50% 절감)
```

---

### SimCache 디버깅

#### 1. SimCache 재생이 원본과 다름

**증상:** SimCache 재생 시 파티클 위치/동작이 원본 시뮬레이션과 다름

**원인 및 해결:**

```cpp
// 원인 1: Data Interface 상태가 캡처되지 않음
Params.bCaptureDataInterfaceState = false;  // SkeletalMesh 위치 변화 무시됨

// ✅ 해결: DI 상태 캡처 활성화
Params.bCaptureDataInterfaceState = true;

// 원인 2: 비결정적 난수
// Niagara Script에서 Random Range 사용 → 매 재생마다 다른 결과

// ✅ 해결: Deterministic Random 사용
// Niagara Script에서:
// RandomSeed = ParticleID;
// RandomValue = DeterministicRandom(RandomSeed);

// 원인 3: ExplicitAttributes에 필수 속성 누락
Params.ExplicitCaptureAttributes.Add(
    FNiagaraVariableBase(FNiagaraTypeDefinition::GetVec3Def(), "Position")
);
// Velocity 속성이 누락되어 움직임이 다름

// ✅ 해결: 모든 필수 속성 추가
Params.ExplicitCaptureAttributes.Add(
    FNiagaraVariableBase(FNiagaraTypeDefinition::GetVec3Def(), "Velocity")
);
```

**검증 스크립트:**

```cpp
// SimCache 무결성 검증
bool ValidateSimCache(UNiagaraSimCache* SimCache, UNiagaraSystem* OriginalSystem)
{
    // 1. Emitter 수 일치 확인
    if (SimCache->GetNumEmitters() != OriginalSystem->GetEmitters().Num())
    {
        UE_LOG(LogNiagara, Error, TEXT("Emitter count mismatch"));
        return false;
    }

    // 2. 각 프레임 데이터 검증
    for (int32 Frame = 0; Frame < SimCache->GetNumFrames(); ++Frame)
    {
        for (int32 Emitter = 0; Emitter < SimCache->GetNumEmitters(); ++Emitter)
        {
            TArray<float> PositionData;
            SimCache->ReadFrameAttribute(Frame, Emitter, "Position", PositionData);

            // Position 데이터가 비어있으면 실패
            if (PositionData.Num() == 0)
            {
                UE_LOG(LogNiagara, Error, TEXT("Frame %d Emitter %d has no Position data"), Frame, Emitter);
                return false;
            }

            // NaN 체크
            for (float Value : PositionData)
            {
                if (!FMath::IsFinite(Value))
                {
                    UE_LOG(LogNiagara, Error, TEXT("Frame %d contains NaN or Inf"), Frame);
                    return false;
                }
            }
        }
    }

    return true;
}
```

#### 2. SimCache 파일 크기가 너무 큼

**분석 도구:**

```cpp
// SimCache 크기 분석
void AnalyzeSimCacheSize(UNiagaraSimCache* SimCache)
{
    int64 TotalSize = 0;
    int64 FloatDataSize = 0;
    int64 HalfDataSize = 0;
    int64 Int32DataSize = 0;

    for (const FNiagaraSimCacheDataBuffers& Buffer : SimCache->GetCacheDataBuffers())
    {
        FloatDataSize += Buffer.FloatData.Num() * sizeof(float);
        HalfDataSize += Buffer.HalfData.Num() * sizeof(FFloat16);
        Int32DataSize += Buffer.Int32Data.Num() * sizeof(int32);
    }

    TotalSize = FloatDataSize + HalfDataSize + Int32DataSize;

    UE_LOG(LogNiagara, Log, TEXT("SimCache Size Analysis:"));
    UE_LOG(LogNiagara, Log, TEXT("  FloatData: %.2f MB (%.1f%%)"),
        FloatDataSize / 1024.0f / 1024.0f,
        100.0f * FloatDataSize / TotalSize);
    UE_LOG(LogNiagara, Log, TEXT("  HalfData: %.2f MB (%.1f%%)"),
        HalfDataSize / 1024.0f / 1024.0f,
        100.0f * HalfDataSize / TotalSize);
    UE_LOG(LogNiagara, Log, TEXT("  Int32Data: %.2f MB (%.1f%%)"),
        Int32DataSize / 1024.0f / 1024.0f,
        100.0f * Int32DataSize / TotalSize);
    UE_LOG(LogNiagara, Log, TEXT("  Total: %.2f MB"), TotalSize / 1024.0f / 1024.0f);
}
```

**출력 예시:**

```
SimCache Size Analysis:
  FloatData: 85.5 MB (65.2%)   ← Position, Velocity 등
  HalfData: 32.1 MB (24.5%)    ← Color, UV 등
  Int32Data: 13.5 MB (10.3%)   ← UniqueID 등
  Total: 131.1 MB
```

**해결 방법:**

```cpp
// 1. Half Precision 변환
// Position, Velocity → FFloat16으로 변환 (정밀도 감소, 크기 50% 절감)

// 2. 속성 제거
// UniqueID, Age 등 불필요한 속성 제거 → 10-20% 절감

// 3. 프레임 레이트 감소
// 60 FPS → 30 FPS → 크기 50% 절감

// 4. 압축 활성화
// Oodle 압축 → 크기 60-70% 절감
```

---

## 🔗 관련 문서 (Related Documents)

- **Niagara/Editor.md** - Baker & SimCache 에디터 UI 상세
- **Niagara/Rendering.md** - Baker Output Renderer 통합
- **Niagara/Core/NiagaraComponent.md** - SimCache 재생 통합
- **Niagara/Optimization.md** - 시뮬레이션 성능 최적화

---

## 📚 참고 자료 (References)

### 공식 문서
- [Unreal Engine - Niagara Baker Documentation](https://docs.unrealengine.com/5.3/en-US/niagara-baker-in-unreal-engine/)
- [Unreal Engine - SimCache Overview](https://docs.unrealengine.com/5.3/en-US/niagara-simulation-cache-in-unreal-engine/)

### 소스 코드 주요 파일
- `Engine/Plugins/FX/Niagara/Source/NiagaraEditor/Private/NiagaraBakerRenderer.h` (984 lines)
- `Engine/Plugins/FX/Niagara/Source/NiagaraEditor/Private/ViewModels/NiagaraBakerViewModel.h` (741 lines)
- `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraSimCache.h` (1564 lines)
- `Engine/Plugins/FX/Niagara/Source/NiagaraEditor/Public/Customizations/NiagaraDataInterfaceSimCacheVisualizer.h`

### 추천 학습 자료
- **GDC 2023**: "Niagara Visual Effects in Unreal Engine 5.2" - Baker & SimCache 워크플로우
- **Unreal Fest 2024**: "Optimizing VFX with Baked Simulations" - 모바일 최적화 기법
- **Community Tutorial**: "Creating Flipbook Textures from Niagara" (YouTube)

### 예제 프로젝트
- **Content Examples**: `Engine/Content/Examples/Niagara/Baker`
- **Lyra Sample**: Grenade 폭발 Flipbook (Baked)
- **City Sample**: 교통 신호 SimCache 사용

---

**🔄 Updated: 2025-11-21** — Baker & SimCache 시스템 완전 문서화 완료
