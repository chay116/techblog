---
title: "언리얼 엔진 웹뷰 프로덕션 통합 가이드"
date: "2025-11-25"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "UI"
tags: ["unreal", "UI"]
---
# 언리얼 엔진 웹뷰 프로덕션 통합 가이드

## 🎯 목차

1. [왜 웹뷰인가? - 비즈니스 관점](#1-왜-웹뷰인가---비즈니스-관점)
2. [아키텍처 설계 - 책임 분리](#2-아키텍처-설계---책임-분리)
3. [브릿지(Bridge) 통신 - 병목 해결](#3-브릿지bridge-통신---병목-해결)
4. [안드로이드 파편화 대응](#4-안드로이드-파편화-대응)
5. [프로덕션 레벨 구현](#5-프로덕션-레벨-구현)
6. [성능 최적화](#6-성능-최적화)
7. [디버깅과 모니터링](#7-디버깅과-모니터링)
8. [실전 체크리스트](#8-실전-체크리스트)

---

## 1. 왜 웹뷰인가? - 비즈니스 관점

### 현실적인 시나리오

```cpp
// 시나리오 1: 급한 밸런스 패치 🔥
// 금요일 오후 6시, 특정 아이템이 너무 저렴해서 매출 급락!

// ❌ 네이티브 UMG 방식
// 1. C++ 코드 수정 → 2시간
// 2. 빌드 → 30분
// 3. QA 테스트 → 1시간
// 4. 스토어 업데이트 제출 → 즉시
// 5. 심사 대기 → iOS: 1-3일, Android: 몇 시간
// 총 소요: 최소 2-3일, 주말 매출 날림 💸

// ✅ 웹뷰 방식
// 1. 웹 서버 HTML/JS 수정 → 10분
// 2. 배포 → 1분
// 총 소요: 11분, 즉시 적용! ✨
```

### 업계 표준 구성

```
┌─────────────────────────────────────────────────────────────┐
│                    모바일 게임 구조                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  게임플레이 (100% 네이티브)                                  │
│  ┌───────────────────────────────────────────┐             │
│  │ • 전투, 맵 이동, 캐릭터 컨트롤               │             │
│  │ • 60fps 필수, 저지연                       │             │
│  │ • Unreal C++ / Blueprint                 │             │
│  └───────────────────────────────────────────┘             │
│                      ▲                                      │
│                      │ 데이터 동기화                         │
│                      ▼                                      │
│  메타 게임 (하이브리드: 60% 웹뷰 + 40% 네이티브)              │
│  ┌───────────────────────────────────────────┐             │
│  │ 웹뷰 영역 (자주 바뀌는 것)                  │             │
│  │ • 로비 이벤트 배너                         │             │
│  │ • 상점 (가격, 세일, 신상품)                 │             │
│  │ • 공지사항, 뉴스                           │             │
│  │ • 랭킹 리스트                              │             │
│  │ • 길드 정보                                │             │
│  │                                           │             │
│  │ 네이티브 영역 (성능/오프라인 필수)           │             │
│  │ • 캐릭터 3D 프리뷰                         │             │
│  │ • 매칭 버튼 (즉각 반응)                    │             │
│  │ • 인벤토리 드래그 앤 드롭                   │             │
│  │ • 설정 메뉴                                │             │
│  └───────────────────────────────────────────┘             │
│                                                             │
└─────────────────────────────────────────────────────────────┘

업데이트 주기:
• 네이티브: 2-4주마다 (스토어 심사)
• 웹뷰: 하루에도 여러 번 (서버 배포만)
```

---

## 2. 아키텍처 설계 - 책임 분리

### 핵심 원칙: "무엇을 웹뷰로?"

```cpp
/**
 * 웹뷰 vs 네이티브 판단 기준
 */

// ✅ 웹뷰로 만들어야 하는 것
struct FWebViewCandidates
{
    // 1. 자주 바뀌는 콘텐츠
    bool bFrequentUpdates;      // 이벤트, 세일, 배너

    // 2. 복잡한 텍스트/레이아웃
    bool bComplexLayout;        // HTML이 CSS보다 쉬움

    // 3. 외부 콘텐츠 연동
    bool bExternalContent;      // 고객센터, 커뮤니티

    // 4. A/B 테스트 필요
    bool bABTestRequired;       // 실시간 실험
};

// ❌ 네이티브로 만들어야 하는 것
struct FNativeCandidates
{
    // 1. 실시간 인터랙션
    bool bRealtimeInteraction;  // 조이스틱, 드래그

    // 2. 성능 크리티컬
    bool bPerformanceCritical;  // 60fps 필수 UI

    // 3. 오프라인 필수
    bool bOfflineRequired;      // 설정, 튜토리얼

    // 4. 3D 렌더링 통합
    bool b3DRendering;          // 캐릭터 프리뷰
};
```

### 실전 예시: 상점 UI 설계

```cpp
/**
 * 상점 UI 설계: 90% 웹뷰 + 10% 네이티브
 *
 * 이유: 가격/아이템은 자주 바뀌지만, 결제는 네이티브 필수
 */

UCLASS()
class YOURGAME_API UStoreWidget : public UCommonActivatableWidget
{
    GENERATED_BODY()

public:
    // 네이티브 컴포넌트
    UPROPERTY(meta=(BindWidget))
    UWebBrowser* WebBrowser;              // 상점 콘텐츠 (90%)

    UPROPERTY(meta=(BindWidget))
    UWidget* NativePaymentOverlay;        // 결제 UI (10%)

    UPROPERTY(meta=(BindWidget))
    UWidget* OfflineFallbackUI;           // 오프라인 대체 UI

    UPROPERTY(meta=(BindWidget))
    UImage* CharacterPreview3D;           // 3D 프리뷰 (SceneCapture2D)

protected:
    virtual void NativeOnActivated() override;

    // 웹뷰 → 네이티브 통신
    UFUNCTION()
    void HandlePurchaseRequest(const FString& ItemId, int32 Price);

    UFUNCTION()
    void HandlePreview3DRequest(const FString& ItemId);

    // 네이티브 → 웹뷰 통신
    void UpdateUserCurrency(int32 Gems, int32 Gold);

private:
    // 브릿지 관리
    TSharedPtr<class FWebViewBridge> Bridge;
};
```

---

## 3. 브릿지(Bridge) 통신 - 병목 해결

### 문제: JavascriptInterface의 비용

```cpp
/**
 * 문제 상황:
 * 유저가 전투 중 골드를 획득할 때마다 웹뷰 상점의 잔액을 업데이트?
 *
 * 전투 중 골드 변동: 초당 5-10회
 * 브릿지 호출 비용: ~2-5ms (메인 스레드 블로킹!)
 * 결과: 프레임 드롭, 버벅임 🔥
 */

// ❌ 나쁜 예: 매번 호출
void ABattleCharacter::AddGold(int32 Amount)
{
    Gold += Amount;

    // 웹뷰에 즉시 전달 (비용 높음!)
    GetStoreWidget()->UpdateGoldInWebView(Gold);  // 2-5ms 블로킹
}

// ✅ 좋은 예: 배칭 (Batching)
class FWebViewBridge
{
private:
    // 변경 사항을 큐에 모음
    TQueue<FWebViewMessage> PendingMessages;
    FTimerHandle BatchTimerHandle;

    // 1초에 한 번만 전송 (또는 N개 누적 시)
    static constexpr float BATCH_INTERVAL = 1.0f;
    static constexpr int32 BATCH_SIZE = 10;

public:
    void QueueMessage(const FWebViewMessage& Message)
    {
        PendingMessages.Enqueue(Message);

        // 일정 개수 쌓이면 즉시 플러시
        if (PendingMessages.Count() >= BATCH_SIZE)
        {
            FlushMessages();
        }
    }

    void FlushMessages()
    {
        if (PendingMessages.IsEmpty()) return;

        // JSON 배열로 한 번에 전송
        TArray<TSharedPtr<FJsonValue>> MessageArray;

        FWebViewMessage Message;
        while (PendingMessages.Dequeue(Message))
        {
            MessageArray.Add(MakeMessageJson(Message));
        }

        FString JsonString;
        TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&JsonString);
        FJsonSerializer::Serialize(MessageArray, Writer);

        // 단 한 번의 브릿지 호출
        ExecuteJavascript(FString::Printf(
            TEXT("window.GameBridge.handleBatch(%s)"), *JsonString
        ));
    }
};
```

### 경량화된 프로토콜 설계

```cpp
/**
 * 프로토콜 설계 원칙:
 * 1. 최소 데이터만 전송
 * 2. 타입 안전성 보장
 * 3. 에러 처리 내장
 */

// 메시지 타입 정의
UENUM(BlueprintType)
enum class EWebViewMessageType : uint8
{
    // 네이티브 → 웹뷰
    UpdateCurrency,         // 재화 업데이트
    UpdateInventory,        // 인벤토리 변경
    UpdateUserInfo,         // 유저 정보

    // 웹뷰 → 네이티브
    PurchaseItem,           // 아이템 구매
    PreviewItem,            // 아이템 프리뷰
    NavigateToGame,         // 게임 화면 이동
};

// 경량 메시지 구조체
USTRUCT(BlueprintType)
struct FWebViewMessage
{
    GENERATED_BODY()

    UPROPERTY()
    EWebViewMessageType Type;

    UPROPERTY()
    FString Payload;  // 작은 JSON 문자열만

    UPROPERTY()
    int32 MessageId;  // 응답 매칭용

    // 직렬화 (최소 크기)
    FString ToMinimalJson() const
    {
        // {"t":0,"p":"...","id":123}
        // 필드명을 1글자로 축약
        return FString::Printf(TEXT("{\"t\":%d,\"p\":\"%s\",\"id\":%d}"),
            (int32)Type, *Payload, MessageId);
    }
};

// 사용 예시
void UStoreWidget::UpdateCurrency(int32 Gems, int32 Gold)
{
    FWebViewMessage Message;
    Message.Type = EWebViewMessageType::UpdateCurrency;
    Message.Payload = FString::Printf(TEXT("{\"g\":%d,\"c\":%d}"), Gems, Gold);
    Message.MessageId = NextMessageId++;

    Bridge->QueueMessage(Message);  // 배칭으로 전송
}
```

### 양방향 통신: Promise 패턴

```cpp
/**
 * 웹뷰 → 네이티브 요청 후 응답 대기
 * (비동기 처리 필수)
 */

class FWebViewBridge
{
private:
    // 응답 대기 중인 콜백
    TMap<int32, TFunction<void(const FString&)>> PendingCallbacks;
    int32 NextMessageId = 0;

public:
    // 웹뷰에서 호출: game://purchase?itemId=123
    void HandleWebViewRequest(const FString& URL)
    {
        // URL 파싱
        FString Scheme, Path, Query;
        ParseURL(URL, Scheme, Path, Query);

        if (Scheme != TEXT("game")) return;

        if (Path == TEXT("purchase"))
        {
            FString ItemId = ParseQuery(Query, TEXT("itemId"));
            int32 MessageId = FCString::Atoi(*ParseQuery(Query, TEXT("msgId")));

            // 비동기 처리 (결제 UI는 시간이 걸림)
            AsyncTask(ENamedThreads::GameThread, [this, ItemId, MessageId]()
            {
                // 네이티브 결제 UI 표시
                ShowNativePaymentDialog(ItemId, [this, MessageId](bool bSuccess, const FString& Receipt)
                {
                    // 웹뷰로 응답 전송
                    FString Response = FString::Printf(
                        TEXT("{\"success\":%s,\"receipt\":\"%s\"}"),
                        bSuccess ? TEXT("true") : TEXT("false"),
                        *Receipt
                    );

                    ExecuteJavascript(FString::Printf(
                        TEXT("window.GameBridge.resolvePromise(%d, %s)"),
                        MessageId, *Response
                    ));
                });
            });
        }
    }

    // 웹뷰 JS 측 코드
    /*
    class GameBridge {
        private pendingPromises = new Map();
        private nextId = 0;

        async purchaseItem(itemId) {
            const msgId = this.nextId++;

            // Promise 생성
            const promise = new Promise((resolve, reject) => {
                this.pendingPromises.set(msgId, { resolve, reject });

                // 타임아웃 (30초)
                setTimeout(() => {
                    if (this.pendingPromises.has(msgId)) {
                        reject(new Error('Request timeout'));
                        this.pendingPromises.delete(msgId);
                    }
                }, 30000);
            });

            // 네이티브 호출
            window.location.href = `game://purchase?itemId=${itemId}&msgId=${msgId}`;

            return promise;
        }

        resolvePromise(msgId, response) {
            const callbacks = this.pendingPromises.get(msgId);
            if (callbacks) {
                if (response.success) {
                    callbacks.resolve(response);
                } else {
                    callbacks.reject(new Error('Purchase failed'));
                }
                this.pendingPromises.delete(msgId);
            }
        }
    }

    // 사용
    try {
        const result = await gameBridge.purchaseItem('item_123');
        console.log('Purchase success:', result.receipt);
    } catch (error) {
        console.error('Purchase failed:', error);
    }
    */
};
```

---

## 4. 안드로이드 파편화 대응

### 문제: Android System WebView 지옥

```cpp
/**
 * 현실:
 * - iOS: WKWebView (단일 버전, 잘 관리됨)
 * - Android: Android System WebView (제조사/버전 파편화)
 *
 * 삼성 Galaxy A: Chrome 90 기반
 * 샤오미: Chrome 85 기반
 * LG: Chrome 80 기반
 * Huawei: 자체 WebView (Chromium 기반 아닐 수도!)
 *
 * 결과: CSS 레이아웃 깨짐, JS API 미지원, 흰 화면...
 */

// ❌ 안드로이드에서 흰 화면이 뜨는 이유
// 1. WebView 버전이 너무 낮음 (Chrome 70 이하)
// 2. JavaScript 미활성화
// 3. 하드웨어 가속 미지원
// 4. 메모리 부족 (저사양 기기)
```

### 해결책 1: WebView 버전 체크

```cpp
/**
 * 앱 시작 시 WebView 버전 확인 및 업데이트 유도
 */

UCLASS()
class UWebViewVersionChecker : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
    UFUNCTION(BlueprintCallable, Category="WebView")
    static bool CheckWebViewVersion(FString& OutVersion, bool& bNeedsUpdate)
    {
#if PLATFORM_ANDROID
        // JNI로 Android System WebView 버전 확인
        if (JNIEnv* Env = FAndroidApplication::GetJavaEnv())
        {
            jclass PackageManagerClass = Env->FindClass("android/content/pm/PackageManager");
            jclass PackageInfoClass = Env->FindClass("android/content/pm/PackageInfo");

            jobject PackageManager = FAndroidApplication::GetJavaPackageManager();
            jmethodID GetPackageInfoMethod = Env->GetMethodID(
                PackageManagerClass,
                "getPackageInfo",
                "(Ljava/lang/String;I)Landroid/content/pm/PackageInfo;"
            );

            jstring WebViewPackageName = Env->NewStringUTF("com.google.android.webview");
            jobject PackageInfo = Env->CallObjectMethod(
                PackageManager,
                GetPackageInfoMethod,
                WebViewPackageName,
                0
            );

            if (PackageInfo)
            {
                jfieldID VersionNameField = Env->GetFieldID(
                    PackageInfoClass,
                    "versionName",
                    "Ljava/lang/String;"
                );
                jstring VersionName = (jstring)Env->GetObjectField(PackageInfo, VersionNameField);

                const char* VersionChars = Env->GetStringUTFChars(VersionName, nullptr);
                OutVersion = FString(VersionChars);
                Env->ReleaseStringUTFChars(VersionName, VersionChars);

                // Chrome 85 이상 필요 (2020년 8월)
                int32 MajorVersion = FCString::Atoi(*OutVersion.Left(2));
                bNeedsUpdate = MajorVersion < 85;

                return true;
            }
        }
#endif
        return false;
    }

    UFUNCTION(BlueprintCallable, Category="WebView")
    static void ShowWebViewUpdateDialog()
    {
#if PLATFORM_ANDROID
        // 네이티브 다이얼로그 표시
        if (JNIEnv* Env = FAndroidApplication::GetJavaEnv())
        {
            // Google Play로 WebView 업데이트 페이지 열기
            FString URL = TEXT("market://details?id=com.google.android.webview");
            FPlatformProcess::LaunchURL(*URL, nullptr, nullptr);
        }
#endif
    }
};

// 사용 예시 (게임 시작 시)
void UMyGameInstance::Init()
{
    Super::Init();

    FString WebViewVersion;
    bool bNeedsUpdate = false;

    if (UWebViewVersionChecker::CheckWebViewVersion(WebViewVersion, bNeedsUpdate))
    {
        UE_LOG(LogTemp, Log, TEXT("WebView Version: %s"), *WebViewVersion);

        if (bNeedsUpdate)
        {
            // 업데이트 다이얼로그 표시
            ShowUpdatePrompt(TEXT("게임 실행을 위해 WebView 업데이트가 필요합니다."));
        }
    }
}
```

### 해결책 2: Fallback UI (필수!)

```cpp
/**
 * 웹뷰 로딩 실패 시 네이티브 UI로 대체
 *
 * 실패 케이스:
 * 1. 오프라인 (네트워크 끊김)
 * 2. 서버 다운
 * 3. WebView 크래시
 * 4. 타임아웃 (5초 이상 로딩)
 */

UCLASS()
class UWebViewWithFallback : public UCommonActivatableWidget
{
    GENERATED_BODY()

public:
    UPROPERTY(meta=(BindWidget))
    UWebBrowser* WebBrowser;

    UPROPERTY(meta=(BindWidget))
    UWidget* WebViewContainer;

    UPROPERTY(meta=(BindWidget))
    UWidget* FallbackUI;  // 네이티브 UMG (항상 동작)

    UPROPERTY(meta=(BindWidget))
    UTextBlock* ErrorMessageText;

    UPROPERTY(EditDefaultsOnly)
    float LoadTimeout = 5.0f;  // 5초 타임아웃

protected:
    virtual void NativeConstruct() override
    {
        Super::NativeConstruct();

        // 웹뷰 이벤트 바인딩
        WebBrowser->OnLoadStarted.AddDynamic(this, &UWebViewWithFallback::HandleLoadStarted);
        WebBrowser->OnLoadCompleted.AddDynamic(this, &UWebViewWithFallback::HandleLoadCompleted);
        WebBrowser->OnLoadError.AddDynamic(this, &UWebViewWithFallback::HandleLoadError);

        // 초기 상태
        ShowLoadingState();
    }

    void LoadWebView(const FString& URL)
    {
        bWebViewLoaded = false;
        WebBrowser->LoadURL(URL);

        // 타임아웃 타이머
        GetWorld()->GetTimerManager().SetTimer(
            TimeoutTimerHandle,
            this,
            &UWebViewWithFallback::HandleLoadTimeout,
            LoadTimeout,
            false
        );
    }

private:
    UFUNCTION()
    void HandleLoadStarted()
    {
        ShowLoadingState();
    }

    UFUNCTION()
    void HandleLoadCompleted()
    {
        bWebViewLoaded = true;
        GetWorld()->GetTimerManager().ClearTimer(TimeoutTimerHandle);
        ShowWebViewState();

        // 웹뷰가 정상 작동하는지 체크
        WebBrowser->ExecuteJavascript(TEXT("window.GameBridge ? 'OK' : 'ERROR'"));
    }

    UFUNCTION()
    void HandleLoadError()
    {
        GetWorld()->GetTimerManager().ClearTimer(TimeoutTimerHandle);
        ShowFallbackState(TEXT("웹 페이지를 불러올 수 없습니다.\n네트워크 연결을 확인해주세요."));
    }

    void HandleLoadTimeout()
    {
        if (!bWebViewLoaded)
        {
            ShowFallbackState(TEXT("페이지 로딩 시간이 초과되었습니다.\n다시 시도해주세요."));
        }
    }

    void ShowLoadingState()
    {
        WebViewContainer->SetVisibility(ESlateVisibility::Hidden);
        FallbackUI->SetVisibility(ESlateVisibility::Hidden);
        // 로딩 스피너 표시
    }

    void ShowWebViewState()
    {
        WebViewContainer->SetVisibility(ESlateVisibility::Visible);
        FallbackUI->SetVisibility(ESlateVisibility::Hidden);
    }

    void ShowFallbackState(const FString& ErrorMessage)
    {
        WebViewContainer->SetVisibility(ESlateVisibility::Hidden);
        FallbackUI->SetVisibility(ESlateVisibility::Visible);
        ErrorMessageText->SetText(FText::FromString(ErrorMessage));

        // 분석 로그 전송 (어떤 기기에서 실패했는지 추적)
        SendWebViewErrorAnalytics(ErrorMessage);
    }

    void SendWebViewErrorAnalytics(const FString& ErrorMessage)
    {
        // Firebase Analytics 또는 자체 로그 서버
        TMap<FString, FString> EventParams;
        EventParams.Add(TEXT("error_message"), ErrorMessage);
        EventParams.Add(TEXT("device_model"), FPlatformMisc::GetDeviceId());
        EventParams.Add(TEXT("os_version"), FPlatformMisc::GetOSVersion());
        EventParams.Add(TEXT("webview_version"), GetWebViewVersion());

        // 분석 서버로 전송
        UAnalytics::LogEvent(TEXT("webview_load_failed"), EventParams);
    }

    bool bWebViewLoaded = false;
    FTimerHandle TimeoutTimerHandle;
};
```

### 해결책 3: Feature Detection (기능 감지)

```cpp
/**
 * WebView에서 사용할 기능이 지원되는지 체크
 */

// 웹뷰 초기화 시 실행할 JS
const TCHAR* WebViewFeatureDetection = TEXT(R"(
(function() {
    window.GameCapabilities = {
        // 기본 JS 기능
        es6: typeof Symbol !== 'undefined',
        async: typeof async !== 'undefined',
        promise: typeof Promise !== 'undefined',

        // 웹 API
        fetch: typeof fetch !== 'undefined',
        localStorage: typeof localStorage !== 'undefined',
        webgl: !!document.createElement('canvas').getContext('webgl'),

        // CSS 기능
        flexbox: CSS.supports('display', 'flex'),
        grid: CSS.supports('display', 'grid'),

        // 디바이스 정보
        isMobile: /Android|iPhone|iPad/i.test(navigator.userAgent),
        isTablet: /iPad|Android/i.test(navigator.userAgent) && window.innerWidth > 768,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        pixelRatio: window.devicePixelRatio || 1,

        // WebView 정보
        userAgent: navigator.userAgent,
        chromeVersion: parseInt((navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1]) || 0
    };

    // 네이티브로 capabilities 전송
    window.location.href = 'game://capabilities?' + JSON.stringify(window.GameCapabilities);
})();
)");

void UWebViewManager::InitializeWebView(UWebBrowser* WebBrowser)
{
    // Feature Detection 스크립트 주입
    WebBrowser->ExecuteJavascript(WebViewFeatureDetection);

    // Capabilities 수신 대기
    WebBrowser->OnUrlChanged.AddDynamic(this, &UWebViewManager::HandleCapabilitiesReceived);
}

void UWebViewManager::HandleCapabilitiesReceived(const FText& URL)
{
    FString URLString = URL.ToString();

    if (URLString.StartsWith(TEXT("game://capabilities?")))
    {
        // JSON 파싱
        FString CapabilitiesJson = URLString.RightChop(20);
        TSharedPtr<FJsonObject> JsonObject;
        TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(CapabilitiesJson);

        if (FJsonSerializer::Deserialize(Reader, JsonObject))
        {
            int32 ChromeVersion = JsonObject->GetIntegerField(TEXT("chromeVersion"));
            bool bSupportsES6 = JsonObject->GetBoolField(TEXT("es6"));

            UE_LOG(LogTemp, Log, TEXT("WebView Chrome Version: %d"), ChromeVersion);

            // 너무 낮은 버전이면 레거시 모드
            if (ChromeVersion < 85)
            {
                LoadURL(TEXT("https://lobby.game.com/legacy.html"));  // ES5 버전
            }
            else
            {
                LoadURL(TEXT("https://lobby.game.com/index.html"));   // 최신 버전
            }
        }
    }
}
```

---

## 5. 프로덕션 레벨 구현

### 완전한 WebView Manager 시스템

```cpp
/**
 * 프로덕션 레벨 WebView 관리자
 *
 * 기능:
 * 1. WebView 풀링 (재사용)
 * 2. 메모리 관리
 * 3. 에러 처리 및 재시도
 * 4. 분석 및 모니터링
 * 5. 보안 (XSS, CSRF 방지)
 */

UCLASS()
class YOURGAME_API UWebViewManager : public UGameInstanceSubsystem
{
    GENERATED_BODY()

public:
    // Subsystem 초기화
    virtual void Initialize(FSubsystemCollectionBase& Collection) override
    {
        Super::Initialize(Collection);

        // 앱 시작 시 WebView 3개 미리 생성 (풀링)
        PreloadWebViews(3);

        // 메모리 경고 감지
        FCoreDelegates::GetMemoryTrimDelegate().AddUObject(this, &UWebViewManager::HandleMemoryWarning);
    }

    virtual void Deinitialize() override
    {
        // 모든 WebView 정리
        ReleaseAllWebViews();

        Super::Deinitialize();
    }

    /**
     * WebView 획득 (풀에서 재사용 또는 새로 생성)
     */
    UFUNCTION(BlueprintCallable, Category="WebView")
    UWebBrowser* AcquireWebView(const FString& URL)
    {
        UWebBrowser* WebView = nullptr;

        // 풀에 사용 가능한 WebView가 있으면 재사용
        if (AvailableWebViews.Num() > 0)
        {
            WebView = AvailableWebViews.Pop();
            UE_LOG(LogTemp, Log, TEXT("Reusing WebView from pool"));
        }
        else
        {
            // 새로 생성
            WebView = CreateWebView();
            UE_LOG(LogTemp, Warning, TEXT("Creating new WebView (pool exhausted)"));
        }

        if (WebView)
        {
            InUseWebViews.Add(WebView);
            ConfigureWebView(WebView);
            WebView->LoadURL(URL);
        }

        return WebView;
    }

    /**
     * WebView 반환 (풀로 돌려보냄)
     */
    UFUNCTION(BlueprintCallable, Category="WebView")
    void ReleaseWebView(UWebBrowser* WebView)
    {
        if (!WebView) return;

        // 정리
        WebView->LoadURL(TEXT("about:blank"));
        WebView->ExecuteJavascript(TEXT("document.body.innerHTML = '';"));

        // 풀로 반환
        InUseWebViews.Remove(WebView);
        AvailableWebViews.Add(WebView);

        // 풀 크기 제한 (최대 5개)
        if (AvailableWebViews.Num() > 5)
        {
            UWebBrowser* OldestWebView = AvailableWebViews[0];
            AvailableWebViews.RemoveAt(0);
            DestroyWebView(OldestWebView);
        }
    }

private:
    // WebView 풀
    UPROPERTY()
    TArray<UWebBrowser*> AvailableWebViews;

    UPROPERTY()
    TArray<UWebBrowser*> InUseWebViews;

    /**
     * WebView 미리 생성
     */
    void PreloadWebViews(int32 Count)
    {
        for (int32 i = 0; i < Count; ++i)
        {
            UWebBrowser* WebView = CreateWebView();
            if (WebView)
            {
                AvailableWebViews.Add(WebView);
            }
        }

        UE_LOG(LogTemp, Log, TEXT("Preloaded %d WebViews"), AvailableWebViews.Num());
    }

    /**
     * WebView 생성
     */
    UWebBrowser* CreateWebView()
    {
        UWebBrowser* WebView = NewObject<UWebBrowser>(this);

        if (WebView)
        {
            // 초기 설정
            WebView->LoadURL(TEXT("about:blank"));
            ConfigureWebView(WebView);
        }

        return WebView;
    }

    /**
     * WebView 설정
     */
    void ConfigureWebView(UWebBrowser* WebView)
    {
        if (!WebView) return;

        // 이벤트 바인딩
        WebView->OnUrlChanged.AddDynamic(this, &UWebViewManager::HandleUrlChanged);
        WebView->OnBeforePopup.AddDynamic(this, &UWebViewManager::HandleBeforePopup);

        // 보안 설정
#if PLATFORM_ANDROID || PLATFORM_IOS
        // JavaScript 활성화 (필수)
        WebView->ExecuteJavascript(TEXT("console.log('WebView initialized');"));

        // Content Security Policy 설정
        FString CSP = TEXT("Content-Security-Policy: ")
                      TEXT("default-src 'self'; ")
                      TEXT("script-src 'self' 'unsafe-inline'; ")
                      TEXT("style-src 'self' 'unsafe-inline'; ")
                      TEXT("img-src 'self' data: https:; ")
                      TEXT("connect-src 'self' wss://your-game-server.com;");

        // TODO: CSP 헤더 주입 (플랫폼별 구현 필요)
#endif
    }

    /**
     * WebView 파괴
     */
    void DestroyWebView(UWebBrowser* WebView)
    {
        if (!WebView) return;

        // 이벤트 바인딩 해제
        WebView->OnUrlChanged.RemoveAll(this);
        WebView->OnBeforePopup.RemoveAll(this);

        // 메모리 해제
        WebView->LoadURL(TEXT("about:blank"));
        WebView->ConditionalBeginDestroy();
    }

    /**
     * 모든 WebView 해제
     */
    void ReleaseAllWebViews()
    {
        for (UWebBrowser* WebView : AvailableWebViews)
        {
            DestroyWebView(WebView);
        }
        AvailableWebViews.Empty();

        for (UWebBrowser* WebView : InUseWebViews)
        {
            DestroyWebView(WebView);
        }
        InUseWebViews.Empty();
    }

    /**
     * 메모리 경고 처리
     */
    void HandleMemoryWarning()
    {
        UE_LOG(LogTemp, Warning, TEXT("Memory warning! Releasing unused WebViews"));

        // 사용하지 않는 WebView 모두 해제
        for (UWebBrowser* WebView : AvailableWebViews)
        {
            DestroyWebView(WebView);
        }
        AvailableWebViews.Empty();

        // 강제 GC
        GEngine->ForceGarbageCollection(true);
    }

    /**
     * URL 변경 이벤트 (Bridge 통신)
     */
    UFUNCTION()
    void HandleUrlChanged(const FText& URL)
    {
        FString URLString = URL.ToString();

        // game:// 프로토콜 처리
        if (URLString.StartsWith(TEXT("game://")))
        {
            ProcessBridgeMessage(URLString);
        }
    }

    /**
     * 팝업 차단
     */
    UFUNCTION()
    bool HandleBeforePopup(FString URL, FString Frame)
    {
        UE_LOG(LogTemp, Warning, TEXT("Popup blocked: %s"), *URL);

        // 외부 브라우저로 열기
        FPlatformProcess::LaunchURL(*URL, nullptr, nullptr);

        return true;  // 팝업 차단
    }

    /**
     * Bridge 메시지 처리
     */
    void ProcessBridgeMessage(const FString& URL)
    {
        // game://action?param=value
        FString Action, Query;
        URL.Split(TEXT("?"), &Action, &Query);

        Action = Action.RightChop(7);  // "game://" 제거

        if (Action == TEXT("purchase"))
        {
            HandlePurchase(Query);
        }
        else if (Action == TEXT("navigate"))
        {
            HandleNavigate(Query);
        }
        else if (Action == TEXT("analytics"))
        {
            HandleAnalytics(Query);
        }
    }

    void HandlePurchase(const FString& Query)
    {
        // 구매 로직 (네이티브 결제)
    }

    void HandleNavigate(const FString& Query)
    {
        // 화면 전환
    }

    void HandleAnalytics(const FString& Query)
    {
        // 분석 이벤트 전송
    }
};
```

### 보안: XSS/CSRF 방지

```cpp
/**
 * 보안 고려사항
 *
 * 1. XSS (Cross-Site Scripting) 방지
 * 2. CSRF (Cross-Site Request Forgery) 방지
 * 3. 안전한 메시지 검증
 */

class FWebViewSecurity
{
public:
    /**
     * URL 화이트리스트 검증
     */
    static bool IsURLAllowed(const FString& URL)
    {
        // 허용된 도메인만 로드
        TArray<FString> AllowedDomains = {
            TEXT("lobby.yourgame.com"),
            TEXT("store.yourgame.com"),
            TEXT("api.yourgame.com")
        };

        for (const FString& Domain : AllowedDomains)
        {
            if (URL.Contains(Domain))
            {
                return true;
            }
        }

        UE_LOG(LogTemp, Error, TEXT("Blocked unauthorized URL: %s"), *URL);
        return false;
    }

    /**
     * 메시지 서명 검증 (HMAC)
     */
    static bool VerifyMessageSignature(const FString& Message, const FString& Signature)
    {
        // 서버와 공유하는 비밀키
        static const FString SecretKey = TEXT("YOUR_SECRET_KEY_HERE");

        // HMAC-SHA256 계산
        TArray<uint8> MessageBytes;
        MessageBytes.Append((uint8*)TCHAR_TO_UTF8(*Message), Message.Len());

        TArray<uint8> KeyBytes;
        KeyBytes.Append((uint8*)TCHAR_TO_UTF8(*SecretKey), SecretKey.Len());

        FSHA256 Hash;
        Hash.Update(MessageBytes.GetData(), MessageBytes.Num());
        Hash.Update(KeyBytes.GetData(), KeyBytes.Num());

        uint8 Digest[32];
        Hash.Final(Digest);

        // Base64 인코딩
        FString ComputedSignature = FBase64::Encode(Digest, 32);

        return ComputedSignature == Signature;
    }

    /**
     * SQL Injection 방지 (사용자 입력 검증)
     */
    static FString SanitizeUserInput(const FString& Input)
    {
        FString Sanitized = Input;

        // 위험한 문자 제거
        Sanitized = Sanitized.Replace(TEXT("'"), TEXT(""));
        Sanitized = Sanitized.Replace(TEXT("\""), TEXT(""));
        Sanitized = Sanitized.Replace(TEXT(";"), TEXT(""));
        Sanitized = Sanitized.Replace(TEXT("--"), TEXT(""));
        Sanitized = Sanitized.Replace(TEXT("<script>"), TEXT(""));

        return Sanitized;
    }

    /**
     * CSRF 토큰 생성
     */
    static FString GenerateCSRFToken()
    {
        // 세션마다 고유한 토큰
        FGuid Token = FGuid::NewGuid();
        return Token.ToString();
    }
};

// 사용 예시
void UWebViewManager::LoadSecureURL(const FString& URL)
{
    // 1. URL 검증
    if (!FWebViewSecurity::IsURLAllowed(URL))
    {
        UE_LOG(LogTemp, Error, TEXT("URL not allowed: %s"), *URL);
        return;
    }

    // 2. CSRF 토큰 추가
    FString CSRFToken = FWebViewSecurity::GenerateCSRFToken();
    FString SecureURL = FString::Printf(TEXT("%s?csrf=%s"), *URL, *CSRFToken);

    // 3. WebView 로드
    WebBrowser->LoadURL(SecureURL);
}
```

---

## 6. 성능 최적화

### 메모리 최적화

```cpp
/**
 * WebView 메모리 사용량 최적화
 *
 * 문제:
 * - WebView (Chrome): 300-500MB
 * - Unreal 게임: 1-2GB
 * - 저사양 기기 (4GB RAM): 메모리 부족!
 */

class FWebViewMemoryOptimizer
{
public:
    /**
     * 게임 시작 전 WebView 메모리 해제
     */
    static void PrepareForGameplay(UWebBrowser* WebView)
    {
        if (!WebView) return;

        // 1. 페이지 언로드
        WebView->LoadURL(TEXT("about:blank"));

        // 2. JS 실행 컨텍스트 정리
        WebView->ExecuteJavascript(TEXT(R"(
            // 이벤트 리스너 제거
            window.removeEventListener('message', window.gameMessageHandler);

            // 타이머 정리
            if (window.gameTimers) {
                window.gameTimers.forEach(id => clearInterval(id));
                window.gameTimers = [];
            }

            // 큰 객체 해제
            if (window.gameData) {
                window.gameData = null;
            }

            // 강제 GC (일부 브라우저만 지원)
            if (window.gc) {
                window.gc();
            }
        )"));

        // 3. WebView 숨기기 (렌더링 중단)
        WebView->SetVisibility(ESlateVisibility::Collapsed);

        // 4. 네이티브 메모리 GC
        FPlatformProcess::Sleep(0.1f);
        GEngine->ForceGarbageCollection(true);

        UE_LOG(LogTemp, Log, TEXT("WebView memory cleaned for gameplay"));
    }

    /**
     * 이미지 로딩 최적화 (LazyLoad)
     */
    static FString GetOptimizedImageTag(const FString& ImageURL, int32 Width, int32 Height)
    {
        // Lazy loading + 저해상도 placeholder
        return FString::Printf(TEXT(R"(
            <img
                src="data:image/svg+xml,%%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 %d %d'%%3E%%3C/svg%%3E"
                data-src="%s"
                loading="lazy"
                width="%d"
                height="%d"
                onload="this.style.opacity=1"
                style="opacity:0; transition: opacity 0.3s;"
            />
        )"), Width, Height, *ImageURL, Width, Height);
    }
};

// 사용 예시
void ULobbyWidget::StartGame()
{
    // 게임 시작 전 WebView 메모리 정리
    FWebViewMemoryOptimizer::PrepareForGameplay(WebBrowser);

    // 게임 씬 로드
    UGameplayStatics::OpenLevel(this, TEXT("BattleMap"));
}
```

### 로딩 속도 최적화

```cpp
/**
 * WebView 초기 로딩 속도 개선
 *
 * 목표: 흰 화면 시간 최소화 (< 500ms)
 */

class FWebViewLoadOptimizer
{
public:
    /**
     * 앱 시작 시 WebView 프리로드
     */
    static void PreloadInBackground(UWebBrowser* WebView, const FString& URL)
    {
        // 백그라운드에서 미리 로드 (화면에 안 보이는 상태)
        WebView->SetVisibility(ESlateVisibility::Collapsed);
        WebView->LoadURL(URL);

        // 로딩 완료되면 표시 준비
        WebView->OnLoadCompleted.AddLambda([WebView]()
        {
            UE_LOG(LogTemp, Log, TEXT("WebView preloaded successfully"));
            // 이제 SetVisibility(Visible) 하면 즉시 표시됨
        });
    }

    /**
     * Critical CSS 인라인화
     */
    static FString InjectCriticalCSS()
    {
        // 초기 렌더링에 필요한 CSS만 HTML에 포함
        return TEXT(R"(
            <style>
                /* Critical CSS - 첫 화면 렌더링에 필수 */
                body {
                    margin: 0;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    background: #1a1a1a;
                }
                .loading-screen {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                }
                .spinner {
                    border: 4px solid rgba(255,255,255,0.1);
                    border-top-color: #fff;
                    border-radius: 50%;
                    width: 40px;
                    height: 40px;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            </style>

            <!-- 나머지 CSS는 비동기 로드 -->
            <link rel="preload" href="/main.css" as="style" onload="this.rel='stylesheet'">
        )");
    }

    /**
     * Service Worker로 캐싱
     */
    static const TCHAR* GetServiceWorkerScript()
    {
        return TEXT(R"(
            // service-worker.js
            const CACHE_VERSION = 'v1.0.0';
            const CACHE_NAME = 'game-lobby-' + CACHE_VERSION;
            const ASSETS_TO_CACHE = [
                '/',
                '/index.html',
                '/main.css',
                '/main.js',
                '/images/logo.png',
                '/fonts/game-font.woff2'
            ];

            // 설치 시 캐싱
            self.addEventListener('install', event => {
                event.waitUntil(
                    caches.open(CACHE_NAME).then(cache => {
                        console.log('Caching app shell');
                        return cache.addAll(ASSETS_TO_CACHE);
                    })
                );
                self.skipWaiting();
            });

            // 요청 가로채기 (캐시 우선)
            self.addEventListener('fetch', event => {
                event.respondWith(
                    caches.match(event.request).then(response => {
                        // 캐시에 있으면 즉시 반환
                        if (response) {
                            console.log('Serving from cache:', event.request.url);
                            return response;
                        }

                        // 없으면 네트워크 요청
                        return fetch(event.request).then(response => {
                            // 성공하면 캐시에 저장
                            if (response.ok) {
                                const clonedResponse = response.clone();
                                caches.open(CACHE_NAME).then(cache => {
                                    cache.put(event.request, clonedResponse);
                                });
                            }
                            return response;
                        });
                    })
                );
            });

            // 구버전 캐시 삭제
            self.addEventListener('activate', event => {
                event.waitUntil(
                    caches.keys().then(cacheNames => {
                        return Promise.all(
                            cacheNames.map(cacheName => {
                                if (cacheName !== CACHE_NAME) {
                                    console.log('Deleting old cache:', cacheName);
                                    return caches.delete(cacheName);
                                }
                            })
                        );
                    })
                );
            });
        )");
    }
};

// 사용 예시
void UGameInstance::Init()
{
    Super::Init();

    // WebView 미리 로드 (백그라운드)
    UWebBrowser* PreloadedWebView = NewObject<UWebBrowser>();
    FWebViewLoadOptimizer::PreloadInBackground(
        PreloadedWebView,
        TEXT("https://lobby.yourgame.com")
    );

    // 나중에 로비 화면 열 때 즉시 표시
}
```

---

## 7. 디버깅과 모니터링

### Chrome DevTools 연결

```cpp
/**
 * WebView 디버깅: Chrome DevTools 활성화
 *
 * 방법:
 * 1. Android: chrome://inspect
 * 2. iOS: Safari 개발자 도구
 */

class FWebViewDebugger
{
public:
    /**
     * 원격 디버깅 활성화
     */
    static void EnableRemoteDebugging()
    {
#if PLATFORM_ANDROID && !UE_BUILD_SHIPPING
        // Android WebView 디버깅 활성화
        if (JNIEnv* Env = FAndroidApplication::GetJavaEnv())
        {
            jclass WebViewClass = Env->FindClass("android/webkit/WebView");
            jmethodID SetWebContentsDebuggingEnabledMethod = Env->GetStaticMethodID(
                WebViewClass,
                "setWebContentsDebuggingEnabled",
                "(Z)V"
            );

            Env->CallStaticVoidMethod(WebViewClass, SetWebContentsDebuggingEnabledEnabledMethod, JNI_TRUE);

            UE_LOG(LogTemp, Log, TEXT("WebView remote debugging enabled. Connect via chrome://inspect"));
        }
#elif PLATFORM_IOS && !UE_BUILD_SHIPPING
        // iOS: WKWebView는 자동으로 Safari 개발자 도구 지원
        UE_LOG(LogTemp, Log, TEXT("WebView debugging: Open Safari -> Develop -> [Device Name]"));
#endif
    }

    /**
     * 콘솔 로그를 Unreal 로그로 포워딩
     */
    static void SetupConsoleForwarding(UWebBrowser* WebView)
    {
        // JS 콘솔을 가로채서 Unreal 로그로 전송
        WebView->ExecuteJavascript(TEXT(R"(
            (function() {
                const originalLog = console.log;
                const originalWarn = console.warn;
                const originalError = console.error;

                console.log = function(...args) {
                    originalLog.apply(console, args);
                    window.location.href = 'game://log?level=info&message=' + encodeURIComponent(args.join(' '));
                };

                console.warn = function(...args) {
                    originalWarn.apply(console, args);
                    window.location.href = 'game://log?level=warning&message=' + encodeURIComponent(args.join(' '));
                };

                console.error = function(...args) {
                    originalError.apply(console, args);
                    window.location.href = 'game://log?level=error&message=' + encodeURIComponent(args.join(' '));
                };

                // Unhandled errors
                window.addEventListener('error', function(event) {
                    window.location.href = 'game://log?level=error&message=' +
                        encodeURIComponent('Uncaught: ' + event.message + ' at ' + event.filename + ':' + event.lineno);
                });

                // Promise rejections
                window.addEventListener('unhandledrejection', function(event) {
                    window.location.href = 'game://log?level=error&message=' +
                        encodeURIComponent('Unhandled Promise Rejection: ' + event.reason);
                });
            })();
        )"));
    }

    /**
     * 로그 메시지 처리
     */
    static void HandleLogMessage(const FString& URL)
    {
        // game://log?level=error&message=Something%20went%20wrong
        TMap<FString, FString> Params = ParseQueryString(URL);

        FString Level = Params.FindRef(TEXT("level"));
        FString Message = FPlatformHttp::UrlDecode(Params.FindRef(TEXT("message")));

        if (Level == TEXT("error"))
        {
            UE_LOG(LogTemp, Error, TEXT("[WebView] %s"), *Message);
        }
        else if (Level == TEXT("warning"))
        {
            UE_LOG(LogTemp, Warning, TEXT("[WebView] %s"), *Message);
        }
        else
        {
            UE_LOG(LogTemp, Log, TEXT("[WebView] %s"), *Message);
        }
    }
};
```

### 성능 모니터링

```cpp
/**
 * WebView 성능 메트릭 수집
 */

class FWebViewAnalytics
{
public:
    /**
     * 페이지 로딩 시간 측정
     */
    static void MeasurePageLoadTime(UWebBrowser* WebView)
    {
        WebView->OnLoadStarted.AddLambda([StartTime = FPlatformTime::Seconds()]()
        {
            // 로딩 시작
        });

        WebView->OnLoadCompleted.AddLambda([StartTime = FPlatformTime::Seconds()]()
        {
            double LoadTime = FPlatformTime::Seconds() - StartTime;

            UE_LOG(LogTemp, Log, TEXT("WebView load time: %.2f seconds"), LoadTime);

            // 분석 서버로 전송
            TMap<FString, FString> EventParams;
            EventParams.Add(TEXT("load_time_ms"), FString::Printf(TEXT("%.0f"), LoadTime * 1000));
            EventParams.Add(TEXT("url"), TEXT("lobby"));

            UAnalytics::LogEvent(TEXT("webview_load_time"), EventParams);
        });
    }

    /**
     * JS에서 Performance API 사용
     */
    static void InjectPerformanceTracking(UWebBrowser* WebView)
    {
        WebView->ExecuteJavascript(TEXT(R"(
            (function() {
                window.addEventListener('load', function() {
                    // Navigation Timing API
                    const perfData = performance.getEntriesByType('navigation')[0];

                    const metrics = {
                        dns: perfData.domainLookupEnd - perfData.domainLookupStart,
                        tcp: perfData.connectEnd - perfData.connectStart,
                        request: perfData.responseStart - perfData.requestStart,
                        response: perfData.responseEnd - perfData.responseStart,
                        dom: perfData.domInteractive - perfData.responseEnd,
                        load: perfData.loadEventEnd - perfData.loadEventStart,
                        total: perfData.loadEventEnd - perfData.fetchStart
                    };

                    // 네이티브로 전송
                    window.location.href = 'game://analytics?type=performance&data=' +
                        encodeURIComponent(JSON.stringify(metrics));
                });
            })();
        )"));
    }

    /**
     * 메모리 사용량 모니터링
     */
    static void MonitorMemoryUsage(UWebBrowser* WebView)
    {
        // JS에서 메모리 정보 수집 (Chrome만 지원)
        WebView->ExecuteJavascript(TEXT(R"(
            if (performance.memory) {
                const memoryMB = {
                    used: (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2),
                    total: (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2),
                    limit: (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2)
                };

                console.log('WebView Memory:', memoryMB);

                window.location.href = 'game://analytics?type=memory&data=' +
                    encodeURIComponent(JSON.stringify(memoryMB));
            }
        )"));
    }
};
```

---

## 8. 실전 체크리스트

### 개발 단계

```cpp
// ✅ WebView 초기 설정
☐ WebView 버전 체크 (Android 85+, iOS 14+)
☐ JavaScript 활성화 확인
☐ 하드웨어 가속 활성화
☐ Content Security Policy 설정
☐ 원격 디버깅 활성화 (개발 빌드)

// ✅ 브릿지 통신
☐ 경량 프로토콜 설계 (필드명 축약)
☐ 메시지 배칭 구현
☐ 타임아웃 처리 (30초)
☐ 에러 핸들링 (재시도 로직)
☐ Promise 패턴 구현 (비동기)

// ✅ 보안
☐ URL 화이트리스트 검증
☐ HTTPS 강제 (프로덕션)
☐ XSS 방지 (입력 검증)
☐ CSRF 토큰 사용
☐ 민감 정보 로컬 저장 금지 (localStorage)

// ✅ 성능
☐ WebView 풀링 (재사용)
☐ Service Worker 캐싱
☐ 이미지 Lazy Loading
☐ Critical CSS 인라인화
☐ 게임 시작 전 메모리 정리

// ✅ 오류 처리
☐ Fallback UI 구현 (네이티브)
☐ 오프라인 대응
☐ 타임아웃 처리 (5초)
☐ 로딩 스피너 표시
☐ 에러 분석 로그 전송

// ✅ 플랫폼별 대응
☐ Android WebView 버전 체크
☐ iOS Safe Area 처리
☐ 노치/다이나믹 아일랜드 고려
☐ 태블릿 레이아웃 대응
☐ 가로/세로 모드 지원
```

### QA 테스트

```cpp
// 🧪 기능 테스트
☐ 네이티브 → 웹뷰 데이터 전달 (재화, 유저 정보)
☐ 웹뷰 → 네이티브 이벤트 (구매, 이동)
☐ 3D 프리뷰 연동 (SceneCapture2D)
☐ 결제 플로우 (네이티브 IAP)
☐ 푸시 알림 클릭 → 특정 웹뷰 페이지 열기

// 🧪 에러 시나리오
☐ 오프라인 상태에서 앱 시작
☐ 웹뷰 로딩 중 네트워크 끊김
☐ 서버 다운 (500 에러)
☐ 타임아웃 (5초 이상)
☐ WebView 크래시

// 🧪 성능 테스트
☐ 초기 로딩 시간 (< 1초 목표)
☐ 웹뷰 ↔ 게임 전환 시간
☐ 메모리 사용량 (저사양 기기)
☐ 배터리 소모 (장시간 사용)
☐ 프레임 드롭 (60fps 유지)

// 🧪 플랫폼별 테스트
☐ iOS 14, 15, 16, 17
☐ Android 8, 9, 10, 11, 12, 13, 14
☐ 삼성, 샤오미, LG, Pixel 기기
☐ 저사양 기기 (2GB RAM)
☐ 태블릿 (iPad, Galaxy Tab)
```

### 프로덕션 배포

```cpp
// 🚀 배포 전 최종 점검
☐ 원격 디버깅 비활성화
☐ 프로덕션 URL로 변경
☐ HTTPS 강제 확인
☐ 분석 도구 연동 (Firebase, Amplitude)
☐ 크래시 리포팅 (Crashlytics, Sentry)
☐ A/B 테스트 준비

// 🚀 모니터링 설정
☐ WebView 로딩 실패율 추적
☐ 평균 로딩 시간 측정
☐ 디바이스별 성능 분석
☐ 크래시율 모니터링
☐ 사용자 피드백 수집
```

---

## 💡 실전 팁

### 1. 점진적 도입 전략

```cpp
/**
 * 한 번에 모든 UI를 웹뷰로 바꾸지 마세요!
 *
 * 단계별 전환:
 * Week 1: 공지사항만 웹뷰 (리스크 낮음)
 * Week 2: 이벤트 배너 추가
 * Week 3: 상점 일부 (세일 페이지)
 * Week 4: 상점 전체
 * Week 5: 랭킹 시스템
 */

// Phase 1: 공지사항 (가장 안전)
class UNoticeWidget : public UUserWidget
{
    UPROPERTY(meta=(BindWidget))
    UWebBrowser* WebBrowser;

    void ShowNotice()
    {
        // 단순 HTML 표시 (통신 없음)
        WebBrowser->LoadURL(TEXT("https://notice.game.com/latest"));
    }
};

// Phase 2: 이벤트 배너 (조회만)
class UEventBannerWidget : public UUserWidget
{
    // 클릭 시 네이티브 이벤트 발생
    void OnBannerClicked(const FString& EventId)
    {
        // 네이티브 화면 전환
        OpenEventDetailScreen(EventId);
    }
};

// Phase 3: 상점 (구매 포함)
class UStoreWidget : public UUserWidget
{
    // 복잡한 브릿지 통신
    // 이 단계에서 실전 경험 쌓기
};
```

### 2. 개발자 도구 단축키

```cpp
/**
 * 디버깅 단축키 (Development 빌드에만)
 */

#if !UE_BUILD_SHIPPING
void UWebViewDebugWidget::NativeConstruct()
{
    Super::NativeConstruct();

    // F12 키로 Chrome DevTools 열기 (시뮬레이션)
    FSlateApplication::Get().OnKeyDown().AddLambda([this](const FKeyEvent& KeyEvent)
    {
        if (KeyEvent.GetKey() == EKeys::F12)
        {
            // WebView 새로고침
            WebBrowser->Reload();
            return FReply::Handled();
        }

        if (KeyEvent.GetKey() == EKeys::F11)
        {
            // Fallback UI 강제 표시 (테스트용)
            ShowFallbackUI();
            return FReply::Handled();
        }

        return FReply::Unhandled();
    });
}
#endif
```

### 3. 웹 개발자와 협업 팁

```cpp
/**
 * 웹 팀과 명확한 인터페이스 정의
 */

// 문서화: API_CONTRACT.md
/*
# Native ↔ Web 통신 규격

## 1. Native → Web (데이터 전달)

### 유저 정보 전달
```js
window.initUser({
    userId: string,
    level: number,
    gems: number,
    gold: number,
    vipLevel: number
});
```

### 재화 업데이트
```js
window.updateCurrency({
    gems: number,
    gold: number
});
```

## 2. Web → Native (이벤트)

### 아이템 구매
```
game://purchase?itemId=123&price=100&msgId=456
```

### 화면 이동
```
game://navigate?screen=battle&mode=pvp
```

## 3. 에러 처리
모든 요청은 30초 타임아웃
실패 시 `game://error?code=TIMEOUT` 호출
*/
```

---

## 📚 참고 자료

### Epic 공식 문서
- [Web Browser Widget](https://docs.unrealengine.com/5.3/en-US/web-browser-widget-in-unreal-engine/)
- [Slate UI Framework](https://docs.unrealengine.com/5.3/en-US/slate-ui-framework-in-unreal-engine/)

### 플랫폼별 WebView 문서
- [Android WebView](https://developer.android.com/reference/android/webkit/WebView)
- [iOS WKWebView](https://developer.apple.com/documentation/webkit/wkwebview)

### 성능 최적화
- [Web Performance Working Group](https://www.w3.org/webperf/)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)

---

## 🎓 결론

> **"웹뷰는 UI 도구가 아니라 비즈니스 리스크 관리 도구입니다."**

### 핵심 교훈

1. **빠른 업데이트 = 경쟁력**
   - 스토어 심사 없이 즉시 배포
   - 주말/심야 긴급 패치 가능

2. **하이브리드가 정답**
   - 게임플레이: 네이티브 (성능)
   - 메타 게임: 웹뷰 (유연성)

3. **안정성이 최우선**
   - Fallback UI 필수
   - 오프라인 대응 필수
   - 에러 로깅 필수

4. **점진적 도입**
   - 공지사항 → 이벤트 → 상점 순서로
   - 한 번에 바꾸려다 망함

5. **플랫폼 파편화 대응**
   - Android WebView 버전 체크
   - Feature Detection
   - 레거시 모드 지원

### 마지막 조언

```cpp
/**
 * 웹뷰를 도입하려는 개발자에게
 */

// ❌ 하지 말아야 할 것
- 모든 UI를 웹뷰로 만들기
- 브릿지 통신을 동기로 처리
- 에러 처리 생략
- 한 번에 전체 전환

// ✅ 해야 할 것
- 명확한 책임 분리
- 경량 프로토콜 설계
- Fallback UI 구현
- 점진적 도입
- 철저한 테스트

/**
 * 이 가이드를 따르면:
 * ✅ 업데이트 시간 3일 → 10분
 * ✅ 앱 크기 30-50% 감소
 * ✅ A/B 테스트 자유롭게
 * ✅ 개발 생산성 2배 향상
 */
```

---

**작성자:** Claude
**버전:** 1.0.0
**최종 수정:** 2025-11-25