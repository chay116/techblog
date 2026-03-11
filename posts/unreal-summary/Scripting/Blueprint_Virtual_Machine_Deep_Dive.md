---
title: "Blueprint Virtual Machine Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Scripting"
tags: ["unreal", "GameFramework", "Scripting"]
engine_version: "Unreal Engine 5.7"
---
# Blueprint Virtual Machine Deep Dive

## 🧭 개요 (Overview)

**Blueprint Virtual Machine (Kismet VM)** 은 Blueprint 스크립트를 실행하는 바이트코드 인터프리터입니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Bytecode (Script)** | Blueprint → 바이트코드로 컴파일 (`UFunction::Script`) |
| **FFrame** | 함수 호출 스택 프레임 (Locals, Code Pointer, Stack) |
| **EExprToken** | VM Opcode (EX_LocalVariable, EX_CallFunction 등) |
| **ProcessInternal()** | VM 메인 루프 (Opcode 해석 및 실행) |
| **Compiled-In Native** | Nativization (Blueprint → C++ 변환) |

**핵심 철학:**
> Blueprint는 UFunction::Script 배열에 바이트코드로 저장,
> FFrame::Step()이 바이트코드를 읽어 실행 (Register Machine 아닌 Stack Machine)

---

## 🏗️ VM 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Blueprint Compilation                               │
├─────────────────────────────────────────────────────────────────────────┤
│  Blueprint Graph → FKismetCompilerContext → Bytecode (TArray<uint8>)   │
│                                                                          │
│  예시 Blueprint:                                                         │
│    float Total = A + B                                                  │
│    return Total                                                         │
│                                                                          │
│  컴파일된 Bytecode (UFunction::Script):                                 │
│    [EX_Let] [LocalVar:Total] [EX_Add] [LocalVar:A] [LocalVar:B]        │
│    [EX_Return] [LocalVar:Total]                                         │
│    [EX_EndOfScript]                                                     │
└──────────────────────┼───────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                        VM Execution (FFrame)                             │
├─────────────────────────────────────────────────────────────────────────┤
│  FFrame 생성:                                                            │
│    - Node: UFunction*                                                   │
│    - Object: 'this' 포인터                                              │
│    - Code: Bytecode 시작 주소 (Script.GetData())                        │
│    - Locals: 로컬 변수 메모리 (Stack)                                   │
│                                                                          │
│  ProcessInternal() 실행:                                                │
│    while (*Code != EX_EndOfScript)                                      │
│    {                                                                    │
│        uint8 Opcode = *Code++;                                          │
│        switch (Opcode)                                                  │
│        {                                                                │
│            case EX_Let: execLet(Stack, RESULT_PARAM); break;            │
│            case EX_LocalVariable: execLocalVariable(Stack); break;      │
│            case EX_CallFunction: execCallFunction(Stack); break;        │
│            // ...                                                       │
│        }                                                                │
│    }                                                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📐 핵심 구조 (Core Structures)

### 1. FFrame - VM Stack Frame

**📂 위치:** `CoreUObject/Public/UObject/Stack.h:113`

```cpp
struct FFrame : public FOutputDevice
{
    // 실행 중인 함수
    UFunction* Node;

    // 'this' 포인터 (Context Object)
    UObject* Object;

    // Bytecode 포인터 (현재 실행 위치)
    uint8* Code;

    // 로컬 변수 메모리
    uint8* Locals;

    // 마지막 읽은 Property (디버깅용)
    FProperty* MostRecentProperty;
    uint8* MostRecentPropertyAddress;

    // Control Flow Stack (if/for 등)
    FlowStackType FlowStack;  // TArray<CodeSkipSizeType>

    // 이전 Frame (Call Stack)
    FFrame* PreviousFrame;

    // Out Parameter 정보
    FOutParmRec* OutParms;

    // Native Function (Compiled-In 모드)
    FField* PropertyChainForCompiledIn;

    // 생성자
    FFrame(
        UObject* InObject,
        UFunction* InNode,
        void* InLocals,
        FFrame* InPreviousFrame = nullptr,
        FField* InPropertyChainForCompiledIn = nullptr
    );

    // Bytecode 읽기 (Opcode 실행)
    void Step(UObject* Context, void* const Result);

    // Bytecode에서 값 읽기
    template<typename T> T Read();
    FName ReadName();
    UObject* ReadObject();
    FProperty* ReadProperty();
};
```

### 2. EExprToken - VM Opcodes

**📂 위치:** `CoreUObject/Public/UObject/Script.h:189`

```cpp
enum EExprToken : uint8
{
    // 변수 참조
    EX_LocalVariable        = 0x00,  // 로컬 변수
    EX_InstanceVariable     = 0x01,  // 멤버 변수
    EX_DefaultVariable      = 0x02,  // CDO 변수

    // 제어 흐름
    EX_Return               = 0x04,  // Return
    EX_Jump                 = 0x06,  // Goto
    EX_JumpIfNot            = 0x07,  // If (!condition) Goto
    EX_Assert               = 0x09,  // Assert

    // 대입
    EX_Let                  = 0x0F,  // 변수 대입
    EX_LetBool              = 0x14,  // Bool 대입
    EX_LetObj               = 0x5F,  // UObject* 대입
    EX_LetWeakObjPtr        = 0x60,  // TWeakObjectPtr 대입

    // 함수 호출
    EX_VirtualFunction      = 0x1B,  // Virtual Function 호출
    EX_FinalFunction        = 0x1C,  // Final Function 호출 (최적화)
    EX_LocalVirtualFunction = 0x45,  // Local Virtual (더 빠름)
    EX_LocalFinalFunction   = 0x46,  // Local Final (가장 빠름)
    EX_CallMath             = 0x68,  // Pure Math Function

    // 상수
    EX_IntConst             = 0x1D,  // int32 상수
    EX_FloatConst           = 0x1E,  // float 상수
    EX_StringConst          = 0x1F,  // FString 상수
    EX_ObjectConst          = 0x20,  // UObject* 상수
    EX_NameConst            = 0x21,  // FName 상수
    EX_True                 = 0x27,  // true
    EX_False                = 0x28,  // false
    EX_NoObject             = 0x2A,  // nullptr

    // 캐스팅
    EX_DynamicCast          = 0x2E,  // Cast<T>()
    EX_Cast                 = 0x38,  // Static Cast

    // Context
    EX_Self                 = 0x17,  // this
    EX_Context              = 0x19,  // Object->Function()
    EX_Context_FailSilent   = 0x1A,  // NULL 허용

    // 컬렉션
    EX_SetArray             = 0x31,  // TArray 초기화
    EX_SetSet               = 0x39,  // TSet 초기화
    EX_SetMap               = 0x3B,  // TMap 초기화

    // Delegate
    EX_LetDelegate          = 0x44,  // Delegate 대입
    EX_BindDelegate         = 0x61,  // Delegate 바인딩
    EX_CallMulticastDelegate = 0x63, // Multicast Delegate 호출

    // 제어 흐름 (고급)
    EX_PushExecutionFlow    = 0x4C,  // 실행 흐름 저장 (for/while)
    EX_PopExecutionFlow     = 0x4D,  // 실행 흐름 복구
    EX_PopExecutionFlowIfNot = 0x4F, // 조건부 복구

    // 디버깅
    EX_Breakpoint           = 0x50,  // Breakpoint
    EX_Tracepoint           = 0x5E,  // Tracepoint
    EX_WireTracepoint       = 0x5A,  // Wire Tracepoint

    EX_EndOfScript          = 0x53,  // Bytecode 끝
};
```

### 3. ProcessInternal() - VM Main Loop

**📂 위치:** `CoreUObject/Private/UObject/ScriptCore.cpp`

```cpp
void UObject::ProcessInternal(FFrame& Stack, RESULT_DECL)
{
    // Bytecode 끝까지 실행
    while (*Stack.Code != EX_EndOfScript)
    {
        // Opcode 읽기
        uint8 Opcode = *Stack.Code++;

        // Opcode 실행 (Giant Switch Statement)
        switch (Opcode)
        {
            case EX_LocalVariable:
                {
                    // Locals에서 변수 읽기
                    FProperty* Property = Stack.ReadProperty();
                    Stack.MostRecentPropertyAddress = Stack.Locals + Property->GetOffset_ForInternal();
                }
                break;

            case EX_InstanceVariable:
                {
                    // Object의 멤버 변수 읽기
                    FProperty* Property = Stack.ReadProperty();
                    Stack.MostRecentPropertyAddress = Property->ContainerPtrToValuePtr<uint8>(Stack.Object);
                }
                break;

            case EX_Let:
                {
                    // 대입 연산 (Destination = Source)
                    FProperty* DestProperty = Stack.ReadProperty();
                    Stack.Step(Stack.Object, nullptr);  // Source 평가
                    uint8* DestAddr = Stack.MostRecentPropertyAddress;

                    // Value 평가
                    Stack.Step(Stack.Object, DestAddr);  // Destination에 직접 기록
                }
                break;

            case EX_CallFunction:
                {
                    // 함수 호출
                    UFunction* Function = (UFunction*)Stack.ReadObject();

                    // 파라미터 스택 할당
                    uint8* Parms = (uint8*)FMemory_Alloca(Function->ParmsSize);
                    FMemory::Memzero(Parms, Function->ParmsSize);

                    // 파라미터 평가 (Bytecode에서 읽기)
                    for (FProperty* Property = (FProperty*)Function->ChildProperties; Property; Property = (FProperty*)Property->Next)
                    {
                        Stack.Step(Stack.Object, Property->ContainerPtrToValuePtr<uint8>(Parms));
                    }

                    // 함수 실행
                    Function->Invoke(Stack.Object, Stack, Parms);

                    // Out Parameter 복사
                    for (FOutParmRec* OutParm = Stack.OutParms; OutParm; OutParm = OutParm->NextOutParm)
                    {
                        OutParm->Property->CopyCompleteValue(OutParm->PropAddr, /* Source */);
                    }
                }
                break;

            case EX_Return:
                {
                    // Return Value 평가
                    Stack.Step(Stack.Object, RESULT_PARAM);
                    Stack.Code = &GEndOfScript;  // Bytecode 종료
                }
                break;

            // ... 100+ Opcodes
        }
    }
}
```

---

## ⚡ Bytecode 예시

### 예시 1: Simple Addition

```cpp
// Blueprint:
int32 Add(int32 A, int32 B)
{
    return A + B;
}

// Bytecode (Simplified):
EX_Return
    EX_IntConst, 0           // Result Temp 선언
    EX_CallMath              // Math::Add 호출
        EX_LocalVariable, A  // Parameter 1
        EX_LocalVariable, B  // Parameter 2
EX_EndOfScript
```

### 예시 2: If-Else Statement

```cpp
// Blueprint:
void Foo(bool Condition)
{
    if (Condition)
    {
        DoA();
    }
    else
    {
        DoB();
    }
}

// Bytecode:
EX_JumpIfNot                  // if (!Condition)
    EX_LocalVariable, Condition
    Offset: 15                // Else 블록으로 Jump

// Then 블록:
EX_CallFunction, DoA
EX_Jump, Offset: 20           // End로 Jump

// Else 블록 (Offset 15):
EX_CallFunction, DoB

// End (Offset 20):
EX_EndOfScript
```

### 예시 3: ForEach Loop

```cpp
// Blueprint:
void ForEach(TArray<AActor*> Actors)
{
    for (AActor* Actor : Actors)
    {
        Actor->DoSomething();
    }
}

// Bytecode:
EX_PushExecutionFlow          // Loop Start 저장
    Offset: LoopStart

LoopStart:
EX_Context                    // Actors.Iterator()
    EX_LocalVariable, Actors
    EX_CallFunction, GetNextItem
    EX_LocalVariable, Actor   // Out Parameter

EX_JumpIfNot                  // if (!Iterator.IsValid())
    EX_LocalVariable, IteratorValid
    Offset: LoopEnd

// Loop Body:
EX_Context                    // Actor->DoSomething()
    EX_LocalVariable, Actor
    EX_CallFunction, DoSomething

EX_PopExecutionFlow           // Loop Start로 돌아가기

LoopEnd:
EX_EndOfScript
```

---

## 🚀 성능 최적화

### 1. Nativization (Compiled-In)

**문제:** Bytecode Interpreter는 C++보다 느림 (10~100배)

**해결:** Blueprint → C++ 자동 변환

```cpp
// Before (Bytecode):
UFunction::Script = [EX_Let, EX_LocalVariable, ...]

// After (Nativized C++):
void UMyClass::MyFunction_Implementation(int32 A, int32 B)
{
    int32 Result = A + B;  // 직접 C++ 코드
    return Result;
}
```

**설정:**
```ini
[/Script/Engine.ProjectPackagingSettings]
BlueprintNativizationMethod=Inclusive
```

### 2. Fast Path (VM 최적화)

**최적화된 Opcode:**

| Slow Opcode | Fast Opcode | 설명 |
|-------------|-------------|------|
| `EX_VirtualFunction` | `EX_LocalVirtualFunction` | Same Object Virtual Call |
| `EX_FinalFunction` | `EX_LocalFinalFunction` | Same Object Final Call |
| `EX_Context + EX_VirtualFunction` | `EX_CallMath` | Pure Math (no Context) |

**효과:**
```cpp
// Slow (General):
EX_Context              // this->
    EX_Self
    EX_VirtualFunction  // GetHealth()
        Function: GetHealth

// Fast (Optimized):
EX_LocalVirtualFunction  // 🔑 1개 Opcode로 단축
    Function: GetHealth
```

### 3. Property Access Cache

**최적화:**
```cpp
// MostRecentProperty 캐싱
if (Stack.MostRecentProperty == CachedProperty)
{
    // 캐시 히트 → Property 검색 생략
    return Stack.MostRecentPropertyAddress;
}
```

---

## 🧩 Native Function 호출

Blueprint에서 C++ 함수 호출 과정:

```
Blueprint Bytecode
    ↓
EX_CallFunction, [UFunction*]
    ↓
UFunction::Invoke()
    ↓
┌─────────────────────────────────┐
│ UFunction::FunctionFlags 확인    │
├─────────────────────────────────┤
│ FUNC_Native?                    │
│   Yes → ProcessInternal() 호출  │
│         (C++ exec* 함수 직접 호출)│
│   No  → ProcessEvent() 호출     │
│         (Bytecode 실행)         │
└─────────────────────────────────┘
    ↓
Native Function Execution
```

**예시:**

```cpp
// Blueprint에서 호출:
float Length = MyVector.Size()

// C++ UFUNCTION:
UFUNCTION(BlueprintCallable)
float GetVectorLength(FVector V)
{
    return V.Size();  // 🔑 C++ 직접 실행 (빠름)
}

// Bytecode:
EX_FinalFunction
    Function: GetVectorLength
    Parameter: EX_LocalVariable, MyVector
```

---

## 🐛 디버깅

### Blueprint Debugger

```
F9  - Breakpoint 토글
F10 - Step Over
F11 - Step Into
```

**EX_Breakpoint Opcode:**
```cpp
case EX_Breakpoint:
    if (GIsEditor && !GIsPlayInEditorWorld)
    {
        // Debugger에 Break Signal 전송
        FBlueprintContextTracker::Get().OnBreakpoint();
    }
    break;
```

### Script Callstack

```cpp
// Crash 시 Blueprint Callstack 출력
FFrame::GetScriptCallstack()

// 예시:
MyCharacter_C::ReceiveTick
  └─ MyComponent::OnUpdate
      └─ CalculateDamage (Blueprint Function)
          └─ CRASH HERE!
```

### Logging

```cpp
// Bytecode 디버그 로그
LogScriptCore: Executing EX_CallFunction (MyFunction)
LogScriptCore: Parameter 1: int32 = 42
LogScriptCore: Parameter 2: FString = "Hello"
```

---

## 📊 성능 비교

**벤치마크 (10,000회 호출):**

| 구현 | 시간 | 배율 |
|------|------|------|
| **C++ Native** | 0.1ms | 1x (기준) |
| **Blueprint (Nativized)** | 0.5ms | 5x |
| **Blueprint (VM)** | 10ms | 100x |

**권장사항:**
- **Performance Critical:** C++ Native (매 프레임 호출)
- **Moderate:** Blueprint Nativized (가끔 호출)
- **Prototyping:** Blueprint VM (디자이너 작업)

---

## 🔗 참고 자료

**소스 파일:**
- `CoreUObject/Public/UObject/Stack.h` - FFrame
- `CoreUObject/Public/UObject/Script.h` - EExprToken
- `CoreUObject/Private/UObject/ScriptCore.cpp` - ProcessInternal()

**관련 문서:**
- [Blueprint Performance](https://docs.unrealengine.com/5.7/en-US/blueprint-best-practices-in-unreal-engine/)
- [Blueprint Nativization](https://docs.unrealengine.com/5.7/en-US/blueprint-nativization/)

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Blueprint VM
  - FFrame Stack Frame
  - EExprToken Opcodes (100+ Opcodes)
  - ProcessInternal() Main Loop
  - Bytecode 예시 (Add/If/ForEach)
  - Nativization & Fast Path 최적화
  - Native Function 호출 과정