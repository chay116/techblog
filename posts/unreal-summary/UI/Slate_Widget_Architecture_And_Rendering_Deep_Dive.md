---
title: "Slate Widget Architecture & Rendering Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "UI"
tags: ["unreal", "UI"]
engine_version: "Unreal Engine 5.7"
---
# Slate Widget Architecture & Rendering Deep Dive

## 🧭 개요 (Overview)

**Slate**는 Unreal Engine의 크로스플랫폼 UI 프레임워크로, Editor UI와 Runtime Game UI 모두에 사용됩니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **SWidget** | 모든 UI 요소의 기본 클래스 (Pure C++, No UObject) |
| **Declarative Syntax** | `SNew()`, `SAssignNew()` 매크로 기반 UI 선언 |
| **Composition Over Inheritance** | Panel + Leaf Widget 조합 |
| **Retained Mode Rendering** | Widget Tree 유지, Invalidation 기반 재렌더링 |
| **Three-Phase Pipeline** | Tick → SlatePrepass → Paint |
| **Element Batching** | Draw Call 최소화 (Texture/Shader 기준 배칭) |

**핵심 철학:**
> C++ 기반 즉각 반응형 UI (Immediate Mode가 아닌 Retained Mode),
> Widget Tree를 유지하며 변경사항만 Invalidate하여 재렌더링

---

## 🏗️ Widget 계층 구조 (Widget Hierarchy)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          SWidget (Base Class)                           │
│  - 모든 Slate UI 요소의 추상 베이스 클래스                              │
│  - UObject 상속 X (순수 C++, TSharedPtr로 관리)                         │
├─────────────────────────────────────────────────────────────────────────┤
│  핵심 책임:                                                              │
│  - Paint(): 렌더링 (FSlateDrawElement 생성)                             │
│  - Tick(): 프레임당 업데이트                                             │
│  - ComputeDesiredSize(): 레이아웃 크기 계산                             │
│  - OnArrangeChildren(): 자식 Widget 배치                               │
│  - Event Handling (OnMouseButtonDown, OnKeyDown, etc.)                 │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
┌───────▼──────────┐       ┌────────▼─────────┐
│   SPanel         │       │   SLeafWidget    │
│  (Container)     │       │  (Leaf Node)     │
├──────────────────┤       ├──────────────────┤
│ - Slots 관리     │       │ - 자식 없음       │
│ - 자식 배치 로직 │       │ - 직접 렌더링     │
└───────┬──────────┘       └────────┬─────────┘
        │                           │
    ┌───┴───┐                   ┌───┴───┐
┌───▼───┐ ┌─▼────┐         ┌────▼────┐ ┌▼──────┐
│SBox   │ │SOver │         │SImage   │ │SText  │
│Panel  │ │lay   │         │         │ │Box    │
└───────┘ └──────┘         └─────────┘ └───────┘
```

### Widget 타입 분류

```cpp
// 1. Leaf Widget - 자식이 없는 최종 Widget
class SLeafWidget : public SWidget
{
    // OnPaint에서 직접 FSlateDrawElement 생성
    // ComputeDesiredSize() 구현 필수
};

// 예시: STextBlock, SImage, SBorder (Border만), SSpacer

// 2. Panel Widget - 자식을 가질 수 있는 Container
class SPanel : public SWidget
{
protected:
    TPanelChildren<FSlot> Children;  // Slot 배열

    // OnArrangeChildren() 구현 (자식 배치 로직)
};

// 예시: SHorizontalBox, SVerticalBox, SOverlay, SCanvas

// 3. Compound Widget - 다른 Widget을 조합
class SCompoundWidget : public SWidget
{
protected:
    FSimpleSlot ChildSlot;  // 단일 자식만 허용
};

// 예시: SButton, SCheckBox, SScrollBox (내부에 SScrollBar + Content)
```

---

## ⚡ 3-Phase UI Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Phase 1: Tick (Logic Update)                         │
├─────────────────────────────────────────────────────────────────────────┤
│  - FSlateApplication::TickPlatform()                                    │
│  - FSlateApplication::TickApplication(DeltaTime)                        │
│                                                                          │
│  각 Widget::Tick(Geometry, DeltaTime) 호출:                             │
│    - Animation 업데이트                                                  │
│    - 비주얼 상태 변경 (Hover, Pressed, etc.)                            │
│    - Active Timer 실행                                                   │
│                                                                          │
│  ✅ Layout은 아직 확정 안 됨 (Geometry는 이전 프레임 것)                 │
└──────────────────────┼───────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────────────┐
│               Phase 2: SlatePrepass (Layout Computation)                │
├─────────────────────────────────────────────────────────────────────────┤
│  목적: 모든 Widget의 DesiredSize 계산 (Bottom-Up)                        │
│                                                                          │
│  1. 최하위 Leaf Widget부터 시작:                                         │
│     STextBlock::ComputeDesiredSize()                                    │
│       └─> FTextLayout::ComputeDesiredSize() 호출                        │
│                                                                          │
│  2. Parent로 전파:                                                       │
│     SHorizontalBox::ComputeDesiredSize()                                │
│       └─> 모든 자식 DesiredSize 합산 + Padding                          │
│                                                                          │
│  3. Root까지 계산 완료                                                   │
│                                                                          │
│  결과: 모든 Widget에 CachedDesiredSize 저장                              │
└──────────────────────┼───────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                  Phase 3: Paint (Rendering)                              │
├─────────────────────────────────────────────────────────────────────────┤
│  목적: FSlateDrawElement 생성 (Draw Call 배칭용)                        │
│                                                                          │
│  1. SWindow::Paint() 시작                                                │
│                                                                          │
│  2. Top-Down Traversal:                                                 │
│     - OnArrangeChildren() 호출 (자식 배치)                              │
│     - OnPaint() 호출 (렌더링 요소 생성)                                 │
│                                                                          │
│  3. Widget::OnPaint() 예시:                                             │
│     FSlateDrawElement::MakeBox(...)        // 사각형                     │
│     FSlateDrawElement::MakeText(...)       // 텍스트                     │
│     FSlateDrawElement::MakeLines(...)      // 선                         │
│                                                                          │
│  4. FSlateWindowElementList에 축적:                                     │
│     - DrawElements (타입별로 분류)                                       │
│     - LayerId 순서로 정렬                                                │
│                                                                          │
│  5. Element Batching (FSlateElementBatcher):                            │
│     - Texture + Shader 기준으로 배칭                                     │
│     - FSlateRenderBatch 생성                                            │
│                                                                          │
│  6. Render Thread 전송 → RHI Draw                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

### 프레임당 실행 순서

```cpp
// FSlateApplication::Tick() - 메인 루프
void FSlateApplication::Tick(float DeltaTime)
{
    // 1. Platform Input 처리
    TickPlatform(DeltaTime);

    // 2. Widget Tick (Logic)
    TickApplication(DeltaTime);

    // 3. SlatePrepass (Layout)
    for (TSharedRef<SWindow> Window : SlateWindows)
    {
        Window->SlatePrepass(GetApplicationScale());
    }

    // 4. Paint (Rendering)
    DrawWindows();
}
```

---

## 📐 핵심 구조 (Core Structures)

### 1. SWidget - UI 요소 기본 클래스

**📂 위치:** `SlateCore/Public/Widgets/SWidget.h:162`

```cpp
class SWidget : public TSharedFromThis<SWidget>
{
public:
    // ===== Rendering =====
    int32 Paint(
        const FPaintArgs& Args,
        const FGeometry& AllottedGeometry,
        const FSlateRect& MyCullingRect,
        FSlateWindowElementList& OutDrawElements,
        int32 LayerId,
        const FWidgetStyle& InWidgetStyle,
        bool bParentEnabled
    ) const;

    // ===== Layout =====
    void SlatePrepass(float LayoutScaleMultiplier);

    virtual FVector2D ComputeDesiredSize(float LayoutScaleMultiplier) const
    {
        return FVector2D::ZeroVector;  // Override 필수
    }

    virtual void OnArrangeChildren(
        const FGeometry& AllottedGeometry,
        FArrangedChildren& ArrangedChildren
    ) const
    {
        // Panel만 구현
    }

    // ===== Events =====
    virtual void Tick(const FGeometry& AllottedGeometry, double InCurrentTime, float InDeltaTime)
    {
        // 프레임당 업데이트
    }

    virtual FReply OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
    {
        return FReply::Unhandled();  // Event Bubbling
    }

    virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
    {
        return FReply::Unhandled();
    }

protected:
    // Desired Size Cache (SlatePrepass에서 계산)
    FVector2D DesiredSize;

    // Parent Widget (TWeakPtr - Circular Reference 방지)
    TWeakPtr<SWidget> ParentWidgetPtr;

    // Invalidation Flags
    EWidgetUpdateFlags UpdateFlags;
    bool bNeedsPrepass : 1;
};
```

**핵심 메서드:**

| 메서드 | 설명 | 호출 시점 |
|--------|------|-----------|
| **Tick()** | 로직 업데이트 (Animation, State 변경) | 매 프레임 (Phase 1) |
| **SlatePrepass()** | DesiredSize 계산 (재귀적) | Layout Phase (Phase 2) |
| **OnArrangeChildren()** | 자식 Widget 배치 (Panel만) | Paint Phase (Phase 3) |
| **OnPaint()** | FSlateDrawElement 생성 | Paint Phase (Phase 3) |

### 2. FSlateDrawElement - 렌더링 명령

**📂 위치:** `SlateCore/Public/Rendering/DrawElementTypes.h`

```cpp
// Draw Element 타입
enum class EElementType : uint8
{
    Box,                // 사각형 (Brush)
    DebugQuad,          // 디버깅용 사각형
    Text,               // 텍스트
    ShapedText,         // 복잡한 텍스트 (Rich Text)
    Line,               // 선
    Gradient,           // 그라디언트
    Spline,             // 곡선
    Custom,             // 커스텀 렌더링
    // ... 등등
};

// Static Factory Methods
class FSlateDrawElement
{
public:
    // 사각형 그리기
    static void MakeBox(
        FSlateWindowElementList& ElementList,
        uint32 InLayer,
        const FPaintGeometry& PaintGeometry,
        const FSlateBrush* InBrush,
        ESlateDrawEffect InDrawEffects = ESlateDrawEffect::None,
        const FLinearColor& InTint = FLinearColor::White
    );

    // 텍스트 그리기
    static void MakeText(
        FSlateWindowElementList& ElementList,
        uint32 InLayer,
        const FPaintGeometry& PaintGeometry,
        const FString& InText,
        const FSlateFontInfo& InFontInfo,
        ESlateDrawEffect InDrawEffects = ESlateDrawEffect::None,
        const FLinearColor& InTint = FLinearColor::White
    );

    // 선 그리기
    static void MakeLines(
        FSlateWindowElementList& ElementList,
        uint32 InLayer,
        const FPaintGeometry& PaintGeometry,
        const TArray<FVector2D>& Points,
        ESlateDrawEffect InDrawEffects = ESlateDrawEffect::None,
        const FLinearColor& InTint = FLinearColor::White,
        bool bAntialias = true,
        float Thickness = 1.0f
    );
};
```

**FSlateWindowElementList:**
- 한 Window의 모든 DrawElement를 담는 컨테이너
- Layer별로 정렬 (낮은 Layer가 먼저 렌더링)
- Element Batcher로 전달되어 배칭

### 3. FSlateElementBatcher - Draw Call 배칭

**📂 위치:** `SlateCore/Public/Rendering/ElementBatcher.h:43`

```cpp
class FSlateElementBatch
{
public:
    // Batch Key (같은 Key끼리 배칭 가능)
    struct FBatchKey
    {
        const FShaderParams ShaderParams;          // Shader 파라미터
        const ESlateBatchDrawFlag DrawFlags;       // 렌더링 플래그
        const ESlateShader ShaderType;             // Shader 타입
        const ESlateDrawPrimitive DrawPrimitiveType; // Triangle/Line
        const ESlateDrawEffect DrawEffects;        // Disabled/DisabledLuminance
        const FClipStateHandle ClipStateHandle;    // Clipping 상태
        const int8 SceneIndex;                     // Scene 인덱스

        bool operator==(const FBatchKey& Other) const
        {
            return DrawFlags == Other.DrawFlags
                && ShaderType == Other.ShaderType
                && DrawPrimitiveType == Other.DrawPrimitiveType
                && DrawEffects == Other.DrawEffects
                && ShaderParams == Other.ShaderParams
                && ClipStateHandle == Other.ClipStateHandle
                && SceneIndex == Other.SceneIndex;
        }
    };

    // Primary Key: Texture (같은 Texture끼리만 배칭)
    const FSlateShaderResource* ShaderResource;

    // Batch 정보
    uint32 NumElementsInBatch;      // 이 Batch의 Element 개수
    int32 VertexArrayIndex;         // Vertex Array 인덱스
    int32 IndexArrayIndex;          // Index Array 인덱스
};
```

**배칭 조건:**
```cpp
// 같은 Batch로 묶이려면:
1. ShaderResource (Texture) 동일
2. ShaderType 동일 (Default/Font/LineSegment 등)
3. DrawPrimitiveType 동일 (TriangleList/LineList)
4. DrawEffects 동일 (None/Disabled/IgnoreTextureAlpha 등)
5. ClipStateHandle 동일 (같은 Clipping 영역)
```

**배칭 예시:**
```
Frame에 100개의 Box Element:
  - 50개: Texture A, Default Shader, No Clip
  - 30개: Texture A, Default Shader, ClipRect 1
  - 20개: Texture B, Default Shader, No Clip

배칭 결과:
  Batch 1: 50 boxes (Texture A, No Clip)      → 1 Draw Call
  Batch 2: 30 boxes (Texture A, ClipRect 1)   → 1 Draw Call
  Batch 3: 20 boxes (Texture B, No Clip)      → 1 Draw Call

총 3 Draw Calls (배칭 없으면 100 Draw Calls!)
```

---

## 🎨 Declarative Syntax (선언적 UI 문법)

Slate는 C++ 매크로 기반 선언적 문법을 제공합니다.

### 기본 문법

```cpp
// SNew() - 새 Widget 생성 (TSharedRef 반환)
SNew(STextBlock)
    .Text(FText::FromString("Hello"))
    .ColorAndOpacity(FLinearColor::Red)

// SAssignNew() - TSharedPtr에 할당하며 생성
TSharedPtr<STextBlock> MyText;
SAssignNew(MyText, STextBlock)
    .Text(FText::FromString("World"))

// + 연산자 - Panel에 자식 추가
SNew(SVerticalBox)
    + SVerticalBox::Slot()
    .AutoHeight()
    [
        SNew(STextBlock).Text(FText::FromString("Line 1"))
    ]
    + SVerticalBox::Slot()
    .FillHeight(1.0f)
    [
        SNew(STextBlock).Text(FText::FromString("Line 2"))
    ]
```

### 실전 예시: Custom Widget

```cpp
class SMyWidget : public SCompoundWidget
{
public:
    SLATE_BEGIN_ARGS(SMyWidget)
        : _Title(FText::GetEmpty())
        , _OnClicked()
    {}
        SLATE_ATTRIBUTE(FText, Title)                    // TAttribute<FText>
        SLATE_EVENT(FOnClicked, OnClicked)               // Delegate
    SLATE_END_ARGS()

    void Construct(const FArguments& InArgs)
    {
        ChildSlot
        [
            SNew(SVerticalBox)

            // Header
            + SVerticalBox::Slot()
            .AutoHeight()
            .Padding(10.0f)
            [
                SNew(STextBlock)
                .Text(InArgs._Title)
                .Font(FSlateFontInfo(FPaths::EngineContentDir() / TEXT("Fonts/Roboto-Bold.ttf"), 24))
            ]

            // Button
            + SVerticalBox::Slot()
            .FillHeight(1.0f)
            .HAlign(HAlign_Center)
            .VAlign(VAlign_Center)
            [
                SNew(SButton)
                .OnClicked(InArgs._OnClicked)
                .Content()
                [
                    SNew(STextBlock).Text(FText::FromString("Click Me"))
                ]
            ]
        ];
    }
};

// 사용:
SNew(SMyWidget)
    .Title(FText::FromString("My Dialog"))
    .OnClicked_Lambda([]() -> FReply {
        UE_LOG(LogTemp, Log, TEXT("Clicked!"));
        return FReply::Handled();
    })
```

---

## 🔧 Invalidation System (무효화 시스템)

Slate는 **Retained Mode**이므로 Widget Tree를 유지하며, 변경사항만 Invalidate합니다.

### Invalidation Reasons

```cpp
enum class EInvalidateWidgetReason : uint8
{
    None                 = 0,

    // Layout 재계산 필요
    Layout               = 1 << 0,  // DesiredSize 변경

    // Paint만 재실행 (Layout은 그대로)
    Paint                = 1 << 1,  // 색상, 텍스트 변경

    // Volatility (매 프레임 Paint)
    Volatility           = 1 << 2,  // Animation 등

    // Child Order 변경
    ChildOrder           = 1 << 3,

    // RenderTransform 변경
    RenderTransform      = 1 << 4,

    // Visibility 변경
    Visibility           = 1 << 5,

    // Attribute 바인딩 변경
    AttributeRegistration = 1 << 6,

    // Prepass 필요
    Prepass              = Layout,
};
```

### Invalidation 트리거

```cpp
// 예시 1: Text 변경 → Paint Invalidation
void STextBlock::SetText(const TAttribute<FText>& InText)
{
    if (!TextAttribute.IdenticalTo(InText))
    {
        TextAttribute = InText;
        Invalidate(EInvalidateWidgetReason::Paint);  // 🔑 Paint만 재실행
    }
}

// 예시 2: Padding 변경 → Layout Invalidation
void SBox::SetPadding(const TAttribute<FMargin>& InPadding)
{
    if (!PaddingAttribute.IdenticalTo(InPadding))
    {
        PaddingAttribute = InPadding;
        Invalidate(EInvalidateWidgetReason::Layout);  // 🔑 Layout 재계산
    }
}

// 예시 3: Animation → Volatile (매 프레임 Paint)
void SImage::SetColorAndOpacity(const TAttribute<FSlateColor>& InColorAndOpacity)
{
    if (InColorAndOpacity.IsBound())
    {
        // Attribute가 바인딩되어 있으면 매 프레임 업데이트
        Invalidate(EInvalidateWidgetReason::Volatility);
    }
}
```

**Invalidation 전파:**
```
Child Widget Invalidated (Layout)
    ↓
Parent::Invalidate(Layout) 호출
    ↓
Grandparent::Invalidate(Layout) 호출
    ↓
Root (SWindow)까지 전파
    ↓
다음 프레임에 SlatePrepass() 재실행
```

---

## 🧩 Event System (이벤트 처리)

Slate는 **Event Bubbling**과 **Event Tunneling**을 지원합니다.

### Event Routing

```
┌─────────────────────────────────────────────────────────────┐
│                Event Routing (Bottom-Up)                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Hit Test (Top-Down):                                   │
│     Root → ... → Leaf (마우스 위치의 Widget 찾기)          │
│                                                             │
│  2. Event Bubbling (Bottom-Up):                            │
│     Leaf → ... → Root (FReply::Handled()까지)              │
│                                                             │
│  예시:                                                      │
│    SWindow                                                  │
│      └─ SVerticalBox                                        │
│           └─ SButton                                        │
│                └─ STextBlock  ← 마우스 클릭                │
│                                                             │
│  OnMouseButtonDown 호출 순서:                              │
│    1. STextBlock::OnMouseButtonDown()                      │
│         → return FReply::Unhandled()                       │
│    2. SButton::OnMouseButtonDown()                         │
│         → return FReply::Handled()  (🔑 여기서 멈춤!)      │
│    3. (SVerticalBox, SWindow은 호출 안 됨)                 │
└─────────────────────────────────────────────────────────────┘
```

### FReply - Event Response

```cpp
struct FReply
{
    // Event 처리 완료 (Bubbling 중단)
    static FReply Handled()
    {
        return FReply(true);
    }

    // Event 처리 안 함 (Parent로 전달)
    static FReply Unhandled()
    {
        return FReply(false);
    }

    // Mouse Capture (Drag 시작)
    FReply& CaptureMouse(TSharedRef<SWidget> InWidget)
    {
        MouseCaptor = InWidget;
        return *this;
    }

    // Focus 설정
    FReply& SetUserFocus(TSharedRef<SWidget> InWidget)
    {
        FocusRecipient = InWidget;
        return *this;
    }

    // Drag & Drop 시작
    FReply& BeginDragDrop(TSharedRef<FDragDropOperation> InDragDropContent)
    {
        DragDropContent = InDragDropContent;
        return *this;
    }
};
```

### 실전 예시: Drag 구현

```cpp
class SMyDraggable : public SLeafWidget
{
public:
    virtual FReply OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override
    {
        if (MouseEvent.GetEffectingButton() == EKeys::LeftMouseButton)
        {
            // Mouse Capture 시작
            return FReply::Handled()
                .CaptureMouse(SharedThis(this));  // 🔑 이제 OnMouseMove가 전역으로 호출됨
        }
        return FReply::Unhandled();
    }

    virtual FReply OnMouseMove(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override
    {
        if (HasMouseCapture())
        {
            // Drag 로직
            DragOffset += MouseEvent.GetCursorDelta();
            return FReply::Handled();
        }
        return FReply::Unhandled();
    }

    virtual FReply OnMouseButtonUp(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override
    {
        if (HasMouseCapture())
        {
            // Mouse Capture 해제
            return FReply::Handled()
                .ReleaseMouseCapture();
        }
        return FReply::Unhandled();
    }

private:
    FVector2D DragOffset;
};
```

---

## 🚀 성능 최적화

### 1. Invalidation Optimization

**✅ 해야 할 것:**
```cpp
// Paint만 변경되면 Paint Invalidation만
void SetColor(FLinearColor NewColor)
{
    if (Color != NewColor)
    {
        Color = NewColor;
        Invalidate(EInvalidateWidgetReason::Paint);  // Layout 재계산 안 함
    }
}
```

**❌ 피해야 할 것:**
```cpp
// 불필요한 Layout Invalidation
void SetColor(FLinearColor NewColor)
{
    Color = NewColor;
    Invalidate(EInvalidateWidgetReason::Layout);  // 🚫 낭비!
}
```

### 2. Volatility 최소화

**❌ 나쁜 예시 - 매 프레임 Paint:**
```cpp
SNew(STextBlock)
    .Text(TAttribute<FText>::Create([this]() {
        return FText::AsNumber(FMath::RandRange(0, 100));  // 매 프레임 변경!
    }))
```

**✅ 좋은 예시 - 변경 시에만:**
```cpp
TAttribute<FText> ScoreText;
ScoreText.Bind(this, &SMyWidget::GetScoreText);

// Score 변경 시에만 Invalidate
void SetScore(int32 NewScore)
{
    if (Score != NewScore)
    {
        Score = NewScore;
        Invalidate(EInvalidateWidgetReason::Paint);
    }
}
```

### 3. Widget Pooling

**문제:** 자주 생성/삭제되는 Widget (ListViewItem 등)

**해결:**
```cpp
// Object Pool 사용
TArray<TSharedPtr<SMyListItem>> ItemPool;

TSharedRef<SMyListItem> GetPooledItem()
{
    if (ItemPool.Num() > 0)
    {
        return ItemPool.Pop().ToSharedRef();  // 재사용
    }
    return SNew(SMyListItem);  // 새로 생성
}

void ReturnToPool(TSharedPtr<SMyListItem> Item)
{
    ItemPool.Add(Item);  // Pool에 반환
}
```

### 4. Fast Path (Invalidation Root)

**개념:** 작은 영역만 재렌더링 (전체 Window가 아니라)

```cpp
// SInvalidationPanel - Invalidation Root 역할
SNew(SInvalidationPanel)
    .Content()
    [
        // 이 안의 Widget들은 독립적으로 Invalidate 가능
        SNew(SVerticalBox)
        + SVerticalBox::Slot() [ ... ]
        + SVerticalBox::Slot() [ ... ]
    ]
```

**효과:**
- SInvalidationPanel 밖의 Widget은 재렌더링 안 함
- UI가 복잡할수록 효과 큼

---

## 📊 성능 측정

### Slate Stats

```
stat Slate               - 전체 Slate 통계
stat SlateVerbose        - 상세 통계 (Widget별)
```

**주요 지표:**
```
SlateUI:
  - Tick Widgets: 2.5ms        (Widget::Tick 시간)
  - SlatePrepass: 1.2ms        (Layout 계산)
  - Paint: 3.8ms               (FSlateDrawElement 생성)
  - Batching: 0.5ms            (Element 배칭)

  - Total Widgets: 1,245       (활성 Widget 개수)
  - Painted Widgets: 523       (실제 렌더링된 Widget)
  - Invalidated Widgets: 12    (Invalidate된 Widget)

  - Draw Calls: 48             (배칭 후 Draw Call 수)
  - Batches: 52                (Batch 개수)
```

### Slate Debugger

```
Ctrl + Shift + Alt + W   - Widget Reflector 열기
```

**기능:**
- Widget Hierarchy 시각화
- Hit Test 디버깅 (어떤 Widget이 클릭되었는지)
- Paint 영역 표시
- Invalidation Reason 확인

---

## 🐛 디버깅

### 일반적인 함정

**❌ TSharedPtr 대신 Raw Pointer:**
```cpp
STextBlock* MyText = new STextBlock();  // 🚫 Crash! (GC 없음)
```

**✅ 항상 TSharedPtr/TSharedRef:**
```cpp
TSharedPtr<STextBlock> MyText = SNew(STextBlock);  // ✅ 안전
```

**❌ Circular Reference:**
```cpp
TSharedPtr<SWidget> Parent;
TSharedPtr<SWidget> Child;

Parent->ChildSlot = Child;
Child->ParentPtr = Parent;  // 🚫 Leak! (둘 다 해제 안 됨)
```

**✅ TWeakPtr 사용:**
```cpp
TWeakPtr<SWidget> ParentPtr;  // ✅ Weak Reference
```

---

## 🔗 참고 자료

**소스 파일:**
- `SlateCore/Public/Widgets/SWidget.h` - Widget 기본 클래스
- `SlateCore/Public/Rendering/DrawElements.h` - Draw Element
- `SlateCore/Public/Rendering/ElementBatcher.h` - Batching
- `Slate/Public/Framework/Application/SlateApplication.h` - 메인 루프

**관련 문서:**
- [Slate UI Framework](https://docs.unrealengine.com/5.7/en-US/slate-ui-framework/)
- [Widget Reflector](https://docs.unrealengine.com/5.7/en-US/widget-reflector-in-unreal-engine/)

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Slate Widget Architecture & Rendering
  - Widget Hierarchy (SWidget/SPanel/SLeafWidget)
  - 3-Phase Pipeline (Tick/SlatePrepass/Paint)
  - Declarative Syntax (SNew/SAssignNew)
  - Invalidation System & Event Bubbling
  - Element Batching & Performance Optimization
  - 실전 예시 (Drag & Drop, Custom Widget)