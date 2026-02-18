---
title: "String (문자열 타입들)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Core"
tags: ["unreal", "Core"]
---
# String (문자열 타입들)

## 🧭 개요

언리얼 엔진은 **세 가지 주요 문자열 타입**을 제공하며, 각각은 **명확히 구분된 사용 목적**을 가집니다:

- **FString**: 범용 동적 문자열 (수정 가능, 동적 할당)
- **FName**: 고속 식별자 (불변, 전역 테이블, 케이스 무시)
- **FText**: 지역화 가능한 UI 텍스트 (다국어, 포맷팅, 변환)

**핵심 철학:**
> **FString**은 "일반적인 문자열 처리",
> **FName**은 "빠른 비교가 필요한 식별자",
> **FText**는 "사용자에게 보여지는 텍스트"를 담당한다.

**선택 가이드:**

| 용도 | 추천 타입 | 이유 |
|------|----------|------|
| 에셋/오브젝트 이름 | FName | 빠른 해시/비교, 메모리 효율적 |
| UI 텍스트 | FText | 지역화 지원, 동적 포맷팅 |
| 파일 경로 | FString | 문자열 조작 필요 |
| 디버그 출력 | FString | 자유로운 포맷팅 |
| 태그/카테고리 | FName | 빠른 검색/비교 |
| 사용자 입력 | FText | 문화권별 처리 |

**📂 위치:**
- FString: `Engine/Source/Runtime/Core/Public/Containers/UnrealString.h`
- FName: `Engine/Source/Runtime/Core/Public/UObject/NameTypes.h`
- FText: `Engine/Source/Runtime/Core/Public/Internationalization/Text.h`

---

## 🧱 FString - 동적 문자열

### FString 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            FString                                      │
│  (TArray<TCHAR> 기반, 동적 할당, 수정 가능)                              │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - Data : TArray<TCHAR>              // 실제 문자 배열                 │
│      ├── ArrayNum : int32              // 사용 중인 문자 수 (null 포함)  │
│      ├── ArrayMax : int32              // 할당된 용량                    │
│      └── AllocatorInstance : Heap      // 힙 할당자                     │
│                                                                         │
│  Public:                                                                │
│    + Len() : int32                     // 문자열 길이 (null 제외)        │
│    + IsEmpty() : bool                  // 빈 문자열 여부                 │
│    + Append(const TCHAR*)              // 문자열 추가                    │
│    + operator+=(const FString&)        // 연결 연산자                    │
│    + ToUpper() : FString               // 대문자 변환                    │
│    + ToLower() : FString               // 소문자 변환                    │
│    + Left(int32) : FString             // 왼쪽 부분 문자열               │
│    + Right(int32) : FString            // 오른쪽 부분 문자열             │
│    + Mid(int32, int32) : FString       // 중간 부분 문자열               │
│    + Split(const FString&) : bool      // 분할                          │
│    + Replace(const TCHAR*, ...)        // 치환                          │
│    + Printf(const TCHAR*, ...)         // 포맷 생성 (정적)               │
└─────────────────────────────────────────────────────────────────────────┘
```

**📂 위치:** `UnrealString.h:11`

**메모리 레이아웃:**
```
FString Instance:
┌────────────────────────────────────────────────────────────┐
│  TArray<TCHAR> Data                                        │
│  ├── Pointer to Heap: [H][e][l][l][o][\0]                 │
│  ├── ArrayNum = 6    (Hello + null)                        │
│  └── ArrayMax = 16   (할당 용량)                            │
└────────────────────────────────────────────────────────────┘
         │
         ↓ (힙 메모리)
┌────────────────────────────────────────────────────────────┐
│  [H][e][l][l][o][\0][?][?][?][?][?][?][?][?][?][?]         │
│  <---- 사용 중 ----->|<----- 여유 공간 --------->          │
│       6 chars              10 chars                        │
└────────────────────────────────────────────────────────────┘
```

### 주요 API

```cpp
// 생성
FString Str1 = TEXT("Hello");
FString Str2(TEXT("World"));
FString Str3 = FString::Printf(TEXT("Number: %d"), 42);

// 연결
FString Result = Str1 + TEXT(" ") + Str2;  // "Hello World"
Str1 += TEXT("!");                         // "Hello!"
Str1.Append(TEXT(" World"));               // "Hello! World"

// 검색
int32 Index = Str1.Find(TEXT("World"));              // 7
bool bContains = Str1.Contains(TEXT("Hello"));       // true
bool bStartsWith = Str1.StartsWith(TEXT("Hello"));   // true
bool bEndsWith = Str1.EndsWith(TEXT("World"));       // true

// 수정
Str1.ToUpperInline();                      // "HELLO! WORLD"
Str1.ToLowerInline();                      // "hello! world"
Str1.RemoveFromStart(TEXT("hello! "));     // "world"
Str1.TrimStartAndEndInline();              // 공백 제거

// 분할
TArray<FString> Parts;
Str1.ParseIntoArray(Parts, TEXT(" "));     // ["Hello!", "World"]

FString Left, Right;
if (Str1.Split(TEXT(" "), &Left, &Right))  // Left="Hello!", Right="World"
{
    // ...
}

// 치환
Str1 = Str1.Replace(TEXT("World"), TEXT("Unreal"));  // "Hello! Unreal"

// 비교
bool bEqual = Str1.Equals(TEXT("Hello! Unreal"));           // true
bool bEqualIgnoreCase = Str1.Equals(TEXT("hello! unreal"),
                                    ESearchCase::IgnoreCase);  // true
int32 Compare = Str1.Compare(TEXT("Hello! Unreal"));        // 0
```

### 성능 특성

| 연산 | 시간 복잡도 | 메모리 할당 | 노트 |
|------|-----------|------------|------|
| 생성 (복사) | O(n) | 예 | 깊은 복사 수행 |
| 연결 (+) | O(n+m) | 예 | 새 문자열 생성 |
| Append | O(m) | 경우에 따라 | 용량 부족 시 재할당 |
| 비교 (==) | O(n) | 아니오 | 문자 단위 비교 |
| Find | O(n*m) | 아니오 | Boyer-Moore 미사용 |
| ToUpper/Lower | O(n) | 예 | 새 문자열 반환 |

---

## 🔖 FName - 식별자 문자열

### FName 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FName                                      │
│  (Global Name Table 참조, 불변, 고속 비교)                               │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - ComparisonIndex : FNameEntryId    // 대소문자 무시 인덱스           │
│    - DisplayIndex : FNameEntryId       // 원본 대소문자 인덱스 (선택적)  │
│    - Number : uint32                   // 인스턴스 번호 (예: _0, _1)     │
│                                                                         │
│  Public:                                                                │
│    + ToString() : FString              // FString으로 변환               │
│    + GetPlainNameString() : FString    // 번호 없는 이름                 │
│    + GetNumber() : int32               // 인스턴스 번호                  │
│    + IsNone() : bool                   // NAME_None 여부                │
│    + operator==(FName) : bool          // 고속 비교 (정수 비교)          │
│    + GetComparisonIndex() : FNameEntryId  // 비교용 ID                  │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ 참조
                                      ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                      Global Name Table (FNamePool)                      │
│  (프로세스 전역, 중복 제거, 스레드 안전)                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [0]: "None"                                                            │
│  [1]: "Actor"                                                           │
│  [2]: "StaticMeshComponent"                                             │
│  [3]: "MyCustomName"                                                    │
│  [4]: "AnotherName"                                                     │
│  ...                                                                    │
│  [N]: "PlayerController"                                                │
│                                                                         │
│  각 엔트리는 FNameEntry:                                                 │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  Header:                                                 │          │
│  │    - bIsWide : 1 bit        (ANSI/Wide 구분)            │          │
│  │    - Len : 15 bits          (문자열 길이)               │          │
│  │  Data:                                                   │          │
│  │    - AnsiName / WideName    (실제 문자열)               │          │
│  └──────────────────────────────────────────────────────────┘          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**📂 위치:** `NameTypes.h:575`

**메모리 비교:**
```
FString:
  sizeof(FString) = 16 bytes (포인터 8B + Num 4B + Max 4B)
  실제 문자열은 힙에 별도 할당 → 총 16B + strlen * 2B (UTF-16)

FName:
  sizeof(FName) = 8 bytes (ComparisonIndex 4B + Number 4B)
  WITH_CASE_PRESERVING_NAME 시: 12 bytes (DisplayIndex 4B 추가)
  문자열은 Global Table에 1회만 저장 → 공유됨

예시: "PlayerController" 1000개 저장 시
  FString: ~16KB (포인터) + ~32KB (문자열) = 48KB
  FName:   ~8KB  (인덱스만) + 32B (테이블 1회) = 8.032KB
  → 6배 절약!
```

### FName 생성 과정

```
    코드                 FName Constructor        FNamePool
     │                          │                      │
     │ FName("MyObject")        │                      │
     ├─────────────────────────>│                      │
     │                          │ FindOrAdd("MyObject")│
     │                          ├─────────────────────>│
     │                          │                      │ Hash 계산
     │                          │                      ├──────────┐
     │                          │                      │ CRC32    │
     │                          │                      │<─────────┘
     │                          │                      │
     │                          │                      │ 테이블 검색
     │                          │                      ├──────────┐
     │                          │                      │ 기존재? │
     │                          │                      │<─────────┘
     │                          │                      │
     │                          │                      │ (없으면)
     │                          │                      │ 새 엔트리 추가
     │                          │                      ├──────────┐
     │                          │                      │ Allocate │
     │                          │                      │<─────────┘
     │                          │<─────────────────────┤
     │                          │  FNameEntryId(12345) │
     │<─────────────────────────┤                      │
     │  FName{Index=12345, Num=0}                     │
```

### 주요 API

```cpp
// 생성
FName Name1 = FName(TEXT("PlayerController"));
FName Name2 = FName(TEXT("PlayerController_0"));  // 명시적 번호
FName Name3 = FName("PlayerController", 5);       // 번호 지정: PlayerController_5
FName None = NAME_None;                           // 특수 값

// 비교 (매우 빠름 - 정수 비교)
bool bEqual = (Name1 == Name2);                   // false (번호 다름)
bool bSameName = Name1.GetPlainNameString() == Name2.GetPlainNameString();  // true

// 문자열 변환
FString Str = Name1.ToString();                   // "PlayerController"
FString Plain = Name1.GetPlainNameString();       // "PlayerController" (번호 무시)
int32 Num = Name1.GetNumber();                    // 0

// 검색
FName Find = FName(TEXT("PlayerController"), FNAME_Find);  // 없으면 NAME_None
FName Add = FName(TEXT("NewName"), FNAME_Add);             // 없으면 추가

// 비교 모드
int32 Cmp = Name1.Compare(Name2);                          // 빠른 인덱스 비교
int32 LexCmp = Name1.ComparisonIndex.CompareLexical(Name2.ComparisonIndex);  // 느린 알파벳 순
```

### FName의 장점

**✅ 빠른 비교:**
```cpp
// FString 비교: O(n) - 문자 단위
bool FString::operator==(const FString& Other) const
{
    return FCString::Strcmp(*Data, *Other.Data) == 0;  // 루프
}

// FName 비교: O(1) - 정수 비교
bool FName::operator==(const FName& Other) const
{
    return ComparisonIndex == Other.ComparisonIndex && Number == Other.Number;
}
```

**✅ 메모리 효율:**
- 동일 문자열 여러 번 사용 시 테이블에 1회만 저장
- FName 인스턴스는 8~12바이트 (인덱스 + 번호)

**✅ 스레드 안전:**
- Global Name Table은 스레드 안전하게 구현됨 (Lock-Free 또는 Critical Section)

### FName의 제약

**❌ 불변성:**
```cpp
FName Name = FName(TEXT("Hello"));
// Name을 "World"로 변경 불가 → 새 FName 생성해야 함
```

**❌ 메모리 누수 가능:**
```cpp
// 테이블은 영구 저장 (프로세스 종료까지 해제 안됨)
for (int32 i = 0; i < 1000000; i++)
{
    FName Unique = FName(*FString::Printf(TEXT("Unique_%d"), i));
    // 100만 개 엔트리가 테이블에 영구 저장됨!
}
// → 동적 생성 자제, 고정된 이름 사용 권장
```

---

## 🌐 FText - 지역화 텍스트

### FText 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FText                                      │
│  (지역화 가능, 포맷팅 지원, UI 전용)                                      │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - TextData : TSharedRef<ITextData>  // 실제 텍스트 데이터             │
│      │                                                                  │
│      ├─ FTextHistory_Base            // 히스토리 (생성 정보)            │
│      ├─ LocalizedString              // 지역화된 문자열                 │
│      └─ Flags : ETextFlag            // 속성 (Transient, Invariant 등) │
│                                                                         │
│  Public:                                                                │
│    + ToString() : FString            // 현재 언어로 변환                 │
│    + Format(FText, Args) : FText     // 동적 포맷팅                     │
│    + AsNumber(float) : FText         // 숫자를 문화권별 형식으로         │
│    + AsDate(FDateTime) : FText       // 날짜를 문화권별 형식으로         │
│    + AsCurrency(float) : FText       // 통화를 문화권별 형식으로         │
│    + ToUpper() : FText               // 문화권별 대문자 변환             │
│    + ToLower() : FText               // 문화권별 소문자 변환             │
│    + IsEmpty() : bool                // 빈 텍스트 여부                  │
│    + EqualTo(FText) : bool           // 지역화 인식 비교                │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ 참조
                                      ↓
┌─────────────────────────────────────────────────────────────────────────┐
│              FTextLocalizationManager (지역화 관리자)                    │
│  (LocRes 파일 로드, 현재 문화권 관리, 실시간 변환)                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Current Culture: en-US                                                 │
│                                                                         │
│  String Table:                                                          │
│  ┌──────────────────────────────────────────────────────────┐          │
│  │  Namespace: "Game"                                       │          │
│  │  Key: "WelcomeMessage"                                   │          │
│  │                                                          │          │
│  │  en-US: "Welcome to our game!"                           │          │
│  │  ko-KR: "게임에 오신 것을 환영합니다!"                     │          │
│  │  ja-JP: "ゲームへようこそ!"                                │          │
│  │  zh-CN: "欢迎来到我们的游戏!"                              │          │
│  └──────────────────────────────────────────────────────────┘          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**📂 위치:** `Text.h:28`

### 지역화 메커니즘

```
소스 코드:
  LOCTEXT("WelcomeKey", "Welcome!")
         │
         ↓ (빌드 시)
  Unreal Header Tool (UHT) / Localization Dashboard
         │
         ↓
  LocRes 파일 생성:
  ┌─────────────────────────────────────────┐
  │  Game/en/Game.locres:                   │
  │    WelcomeKey → "Welcome!"              │
  │                                         │
  │  Game/ko/Game.locres:                   │
  │    WelcomeKey → "환영합니다!"            │
  │                                         │
  │  Game/ja/Game.locres:                   │
  │    WelcomeKey → "ようこそ!"               │
  └─────────────────────────────────────────┘
         │
         ↓ (런타임)
  현재 Culture에 따라 자동 선택
  SetCurrentCulture("ko") → "환영합니다!" 반환
```

### 주요 API

```cpp
// 생성 (지역화)
#define LOCTEXT_NAMESPACE "MyGame"
FText WelcomeText = LOCTEXT("WelcomeKey", "Welcome to the game!");
FText InvariantText = FText::AsCultureInvariant(TEXT("Version 1.0"));  // 지역화 안함
#undef LOCTEXT_NAMESPACE

// 포맷팅
FText PlayerName = FText::FromString(TEXT("Alice"));
int32 Score = 100;
FText Message = FText::Format(
    LOCTEXT("ScoreMessage", "{0} scored {1} points!"),
    PlayerName,
    FText::AsNumber(Score)
);
// en-US: "Alice scored 100 points!"
// ko-KR: "Alice님이 100점을 획득했습니다!" (포맷 문자열이 다름)

// 숫자 포맷팅 (문화권별)
float Value = 1234567.89f;
FText Number = FText::AsNumber(Value);
// en-US: "1,234,567.89"
// de-DE: "1.234.567,89"  (쉼표/점 반대)
// ko-KR: "1,234,567.89"

// 통화 포맷팅
FText Currency = FText::AsCurrency(99.99f, TEXT("USD"));
// en-US: "$99.99"
// ko-KR: "US$99.99" 또는 "99.99 USD"

// 날짜/시간 포맷팅
FDateTime Now = FDateTime::Now();
FText Date = FText::AsDate(Now, EDateTimeStyle::Short);
// en-US: "1/15/25"
// ko-KR: "25. 1. 15."
// ja-JP: "2025/01/15"

FText Time = FText::AsTime(Now, EDateTimeStyle::Medium);
// en-US: "2:30:45 PM"
// ko-KR: "오후 2:30:45"

// 복수형 처리 (Plural)
int32 ItemCount = 1;
FText ItemText = FText::Format(
    LOCTEXT("ItemCount", "You have {NumItems} {NumItems}|plural(one=item,other=items)"),
    FFormatArgumentValue(ItemCount)
);
// ItemCount=1: "You have 1 item"
// ItemCount=5: "You have 5 items"

// 비교
bool bEqual = Text1.EqualTo(Text2);                        // 현재 문화권에서 같은지
bool bIdentical = Text1.IdenticalTo(Text2);                // 완전히 동일한 소스인지
int32 Compare = FText::CompareTo(Text1, Text2);            // 문화권별 정렬
```

### FText의 장점

**✅ 자동 지역화:**
```cpp
// 코드는 한 번만 작성
FText Greeting = LOCTEXT("Greeting", "Hello");

// 게임 빌드 시 모든 언어로 자동 변환
// Localization Dashboard에서 번역만 추가하면 됨
```

**✅ 문화권 인식:**
```cpp
// 숫자, 날짜, 통화를 각 문화권 규칙에 맞게 표시
FText KoreanNumber = FText::AsNumber(1234567.89f);  // "1,234,567.89"
// 독일어로 전환 시: "1.234.567,89" (자동)
```

**✅ 동적 포맷팅:**
```cpp
// 실행 중 동적으로 값 삽입, 순서도 언어별로 다름
FText Msg = FText::Format(
    LOCTEXT("ItemPickup", "{0} picked up {1}"),
    PlayerName, ItemName
);
// 한국어: "{0}님이 {1}을(를) 획득했습니다" (어순 변경 가능)
```

### FText의 제약

**❌ 느린 비교:**
```cpp
// FText 비교는 내부적으로 ToString() 호출 → 문자열 비교
bool bEqual = Text1.EqualTo(Text2);  // O(n)
// FName이 더 빠름
```

**❌ 메모리 오버헤드:**
```cpp
sizeof(FText) = 16 bytes (TSharedRef<ITextData>)
// 추가로 TextData, History, LocalizedString 등 힙 할당
// FString보다 무거움
```

**❌ 직렬화 복잡성:**
```cpp
// FText는 History를 저장하므로 직렬화가 복잡
// 단순 문자열로 저장하려면 FString으로 변환 필요
```

---

## 📊 타입 비교표

| 특성 | FString | FName | FText |
|------|---------|-------|-------|
| **용도** | 범용 문자열 | 식별자 | UI/지역화 |
| **메모리** | 16B + 힙 | 8~12B | 16B + 힙 |
| **수정 가능** | ✅ | ❌ | ❌ |
| **비교 속도** | O(n) | O(1) | O(n) |
| **대소문자** | 구분 | 무시 (기본) | 구분 |
| **해시 가능** | ✅ | ✅ | ❌ |
| **지역화** | ❌ | ❌ | ✅ |
| **포맷팅** | Printf | 없음 | Format |
| **직렬화** | 단순 | 인덱스 | 복잡 |
| **전역 테이블** | ❌ | ✅ | ✅ |

### 성능 벤치마크 (예시)

```
테스트: "PlayerController" 문자열 10,000회 비교

1. FString (operator==):       ~500ms  (문자 단위 비교)
2. FName (operator==):         ~2ms    (정수 비교)
3. FText (EqualTo):            ~600ms  (ToString + 비교)

테스트: 10,000개 문자열 저장

1. TArray<FString>:            ~320KB  (각각 힙 할당)
2. TArray<FName>:              ~80KB   (인덱스만, 테이블 공유)
3. TArray<FText>:              ~400KB  (TextData + History)

결론:
- 빠른 비교 필요 → FName (250배 빠름)
- 메모리 절약 필요 → FName (4배 절약)
- 지역화 필요 → FText (유일한 선택)
- 일반 처리 → FString (유연성)
```

---

## 💡 실전 사용 패턴

### 패턴 1: 오브젝트 이름 관리

```cpp
// ✅ 올바른 방법: FName 사용
class AActor
{
    FName ActorName;  // 빠른 검색/비교

    AActor* FindActorByName(FName SearchName)
    {
        // O(1) 비교
        return AllActors.FindByPredicate([SearchName](AActor* Actor)
        {
            return Actor->ActorName == SearchName;  // 매우 빠름
        });
    }
};

// ❌ 잘못된 방법: FString 사용
class AActor
{
    FString ActorName;  // 느린 검색

    AActor* FindActorByName(const FString& SearchName)
    {
        // O(n) 비교 (문자열 길이만큼)
        return AllActors.FindByPredicate([&SearchName](AActor* Actor)
        {
            return Actor->ActorName == SearchName;  // 느림
        });
    }
};
```

### 패턴 2: UI 텍스트 표시

```cpp
// ✅ 올바른 방법: FText 사용
void UpdateHealthUI(int32 CurrentHealth, int32 MaxHealth)
{
    FText HealthText = FText::Format(
        LOCTEXT("HealthDisplay", "Health: {0}/{1}"),
        FText::AsNumber(CurrentHealth),
        FText::AsNumber(MaxHealth)
    );
    // en-US: "Health: 75/100"
    // ko-KR: "체력: 75/100" (번역됨)

    HealthLabel->SetText(HealthText);
}

// ❌ 잘못된 방법: FString 사용
void UpdateHealthUI(int32 CurrentHealth, int32 MaxHealth)
{
    FString HealthText = FString::Printf(TEXT("Health: %d/%d"),
                                          CurrentHealth, MaxHealth);
    // 지역화 안됨, 항상 "Health: 75/100"

    HealthLabel->SetText(FText::FromString(HealthText));  // 비효율적
}
```

### 패턴 3: 타입 간 변환

```cpp
// FString → FName
FString Str = TEXT("MyObject");
FName Name = FName(*Str);  // 또는 FName(Str)

// FName → FString
FName Name = FName(TEXT("MyObject"));
FString Str = Name.ToString();

// FString → FText
FString Str = TEXT("Hello");
FText Text = FText::FromString(Str);  // 지역화 안됨

// FText → FString
FText Text = LOCTEXT("Greeting", "Hello");
FString Str = Text.ToString();  // 현재 언어로 변환

// FName → FText
FName Name = FName(TEXT("MyObject"));
FText Text = FText::FromName(Name);  // 지역화 안됨

// FText → FName (권장하지 않음)
FText Text = LOCTEXT("ObjectName", "MyObject");
FName Name = FName(*Text.ToString());  // 지역화된 문자열이 FName으로...
```

### 패턴 4: TMap 키 선택

```cpp
// ✅ 빠른 검색: FName 사용
TMap<FName, AActor*> ActorMap;
ActorMap.Add(FName(TEXT("Player")), PlayerActor);
AActor* Found = ActorMap.FindRef(FName(TEXT("Player")));  // O(1) 해시

// △ 가능: FString 사용 (느림)
TMap<FString, AActor*> ActorMap;
ActorMap.Add(TEXT("Player"), PlayerActor);
AActor* Found = ActorMap.FindRef(TEXT("Player"));  // O(1) 해시지만 GetTypeHash() 느림

// ❌ 불가능: FText 사용
TMap<FText, AActor*> ActorMap;  // 컴파일 에러! FText는 해시 불가
```

---

## 🚀 성능 최적화

### ✅ 해야 할 것

```cpp
// 좋은 예시 1: FName으로 빠른 비교
TArray<FName> Tags = {
    FName(TEXT("Enemy")),
    FName(TEXT("Boss")),
    FName(TEXT("Elite"))
};

bool HasTag(FName SearchTag)
{
    return Tags.Contains(SearchTag);  // O(1) 비교 * N
}

// 좋은 예시 2: FString 미리 할당
FString BuildLongString()
{
    FString Result;
    Result.Reserve(1000);  // 미리 공간 확보

    for (int32 i = 0; i < 100; i++)
    {
        Result.Appendf(TEXT("Item %d, "), i);  // 재할당 최소화
    }
    return Result;
}

// 좋은 예시 3: FText는 UI에만 사용
void DisplayMessage(const FText& LocalizedMessage)
{
    MessageWidget->SetText(LocalizedMessage);  // UI 표시
}

// 로직에서는 FName/FString 사용
void ProcessGameLogic(FName ObjectName)
{
    if (ObjectName == FName(TEXT("Player")))  // 빠른 비교
    {
        // ...
    }
}
```

### ❌ 피해야 할 것

```cpp
// 나쁜 예시 1: FName 동적 생성 남용
void SpawnManyObjects()
{
    for (int32 i = 0; i < 100000; i++)
    {
        FName UniqueName = FName(*FString::Printf(TEXT("Object_%d"), i));
        // Global Name Table에 10만 개 엔트리 영구 저장!
        // 메모리 누수와 동일
    }
}

// 나쁜 예시 2: FText를 비교 키로 사용
bool CompareTexts(const FText& A, const FText& B)
{
    return A.EqualTo(B);  // 느림! ToString() 호출
}
// → FName이나 FString 사용

// 나쁜 예시 3: 불필요한 타입 변환
FName Name = FName(TEXT("MyObject"));
FString Str = Name.ToString();           // 할당
FText Text = FText::FromString(Str);     // 할당
FString Str2 = Text.ToString();          // 할당
// → 불필요한 3번의 힙 할당

// 나쁜 예시 4: FString 반복 연결
FString BuildString()
{
    FString Result;
    for (int32 i = 0; i < 1000; i++)
    {
        Result += FString::Printf(TEXT("Item %d"), i);  // 매번 재할당!
    }
    return Result;
}
// → Reserve() 또는 StringBuilder 사용
```

---

## 🐛 일반적인 함정

### 함정 1: FName 대소문자

```cpp
// 위험한 코드
FName Name1 = FName(TEXT("PlayerController"));
FName Name2 = FName(TEXT("playercontroller"));
bool bEqual = (Name1 == Name2);  // true! (대소문자 무시)

// 원본 문자열 필요 시
FString Display1 = Name1.ToString();  // "PlayerController"
FString Display2 = Name2.ToString();  // "playercontroller" (WITH_CASE_PRESERVING_NAME)
```

### 함정 2: FText 비교

```cpp
// 위험한 코드
FText Text1 = LOCTEXT("Key1", "Hello");
FText Text2 = FText::FromString(TEXT("Hello"));

bool bEqual = Text1.EqualTo(Text2);      // true (문자열 같음)
bool bIdentical = Text1.IdenticalTo(Text2);  // false! (소스 다름)

// Text1은 지역화됨 (LocRes에서 로드)
// Text2는 런타임 생성 (지역화 안됨)
```

### 함정 3: 빈 문자열 처리

```cpp
FString EmptyStr = TEXT("");
FName EmptyName = FName();
FText EmptyText = FText::GetEmpty();

EmptyStr.IsEmpty();   // true
EmptyName.IsNone();   // true
EmptyText.IsEmpty();  // true

// 하지만...
FName Name1 = FName(TEXT(""));       // NAME_None과 동일
FName Name2 = NAME_None;
(Name1 == Name2);  // true

FString Str = Name1.ToString();  // "None" (빈 문자열 아님!)
```

---

## 🔗 참조 자료

### 공식 문서
- Unreal Engine Docs: [FString](https://docs.unrealengine.com/en-US/API/Runtime/Core/Containers/FString/)
- Unreal Engine Docs: [FName](https://docs.unrealengine.com/en-US/API/Runtime/Core/UObject/FName/)
- Unreal Engine Docs: [FText](https://docs.unrealengine.com/en-US/ProductionPipelines/Localization/Text/)
- Unreal Engine Docs: [String Handling](https://docs.unrealengine.com/en-US/ProgrammingAndScripting/ProgrammingWithCPP/UnrealArchitecture/StringHandling/)

### 소스 코드
- `Engine/Source/Runtime/Core/Public/Containers/UnrealString.h` - FString 구현
- `Engine/Source/Runtime/Core/Public/UObject/NameTypes.h` - FName 구현
- `Engine/Source/Runtime/Core/Public/Internationalization/Text.h` - FText 구현
- `Engine/Source/Runtime/Core/Private/UObject/UnrealNames.cpp` - Global Name Table

### 관련 주제
- `UnrealSummary/Core/Memory.md` - 문자열 메모리 할당 전략
- `UnrealSummary/Core/Templates.md` - TArray<TCHAR> (FString 기반)
- `UnrealSummary/CoreUObject/Serialization.md` - 문자열 직렬화

---

> 🔄 Created: 2025-01-XX — Initial documentation for String types (FString/FName/FText) in UE 5.7
