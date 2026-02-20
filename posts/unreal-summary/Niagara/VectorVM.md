---
title: "VectorVM Overview"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# VectorVM Overview

> 🔄 Updated: 2026-02-18 — 중복 문서에서 고유 내용을 통합
## 🧭 개요

VectorVM은 **Unreal Engine의 SIMD 기반 가상 머신**으로, 주로 **Niagara 파티클 시스템**에서 고성능 데이터 병렬 연산을 수행하기 위해 설계되었습니다.

**핵심 목적:**
- **대량의 파티클 데이터를 SIMD 명령어로 병렬 처리**
- **플랫폼 독립적인 바이트코드 실행**
- **레지스터 기반 아키텍처로 빠른 데이터 접근**

**주요 특징:**
- **4-wide SIMD 연산**: 한 번에 4개의 인스턴스를 동시 처리
- **바이트코드 인터프리터**: 최적화된 바이트코드를 실행
- **레지스터 기반**: 스택이 아닌 레지스터를 통한 빠른 데이터 접근
- **플랫폼별 SIMD 최적화**: SSE/AVX(x64), NEON(ARM) 지원

**📂 위치:** `Engine/Source/Runtime/VectorVM/`

---

## 🧱 시스템 아키텍처

### 전체 구조 다이어그램

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Niagara Particle System                             │
│  (VectorVM 바이트코드를 생성하고 실행 요청)                                   │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VectorVM::Runtime::ExecVectorVMState()                   │
│  - 실행 컨텍스트 초기화                                                      │
│  - Batch와 Chunk로 인스턴스 분할                                             │
│  - 바이트코드 디스패치 및 실행                                               │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          ↓                      ↓                      ↓
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐
│ FVectorVMState  │  │ FVectorVMBatch  │  │ Bytecode Dispatcher │
│                 │  │ State           │  │                     │
│ - Bytecode      │  │ - RegisterData  │  │ - OpCode 디코딩     │
│ - Constants     │  │ - RegPtrTable   │  │ - SIMD 함수 호출    │
│ - Temp Registers│  │ - RegIncTable   │  │ - 레지스터 관리     │
│ - Input/Output  │  │ - RandState     │  │                     │
│   Mappings      │  │                 │  │                     │
└─────────────────┘  └─────────────────┘  └─────────────────────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SIMD Execution Functions                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ VVM_Exec2f  │  │ VVM_Exec3f  │  │ VVM_Exec2i  │  │ VVM_Output  │       │
│  │ _add        │  │ _mad        │  │ _addi       │  │ _float      │       │
│  │ _sub        │  │ _lerp       │  │ _muli       │  │ _int32      │       │
│  │ _mul        │  │ _clamp      │  │ _bit_and    │  │ _half       │       │
│  │ _div        │  │ _select     │  │ _bit_or     │  │             │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
          │                                               │
          ↓                                               ↓
┌─────────────────────┐                    ┌──────────────────────┐
│ Platform Intrinsics │                    │ Output Datasets      │
│ - SSE/AVX (x64)     │                    │ (Niagara 파티클 데이터)│
│ - NEON (ARM)        │                    └──────────────────────┘
└─────────────────────┘
```

---

## 📐 핵심 데이터 구조

### 1. FVectorVMState - VM 실행 상태

**📂 위치:** `Engine/Source/Runtime/VectorVM/Private/VectorVMTypes.h:23`

```cpp
struct FVectorVMState
{
    uint8* Bytecode;                    // 최적화된 바이트코드
    uint32 NumBytecodeBytes;            // 바이트코드 크기

    FVecReg* ConstantBuffers;           // 상수 버퍼 (SIMD 레지스터)
    FVectorVMExtFunctionData* ExtFunctionTable;  // 외부 함수 테이블
    int32* NumOutputPerDataSet;         // 데이터셋별 출력 개수

    // 레지스터 매핑 테이블
    uint16* ConstRemapTable;            // 상수 재매핑
    uint16* InputRemapTable;            // 입력 재매핑
    uint16* InputDataSetOffsets;        // 입력 데이터셋 오프셋
    uint8*  OutputRemapDataSetIdx;      // 출력 데이터셋 인덱스
    uint16* OutputRemapDataType;        // 출력 데이터 타입
    uint16* OutputRemapDst;             // 출력 목적지

    // 캐시 (Exec() 호출 시 설정)
    uint8*  ConstMapCacheIdx;
    uint16* ConstMapCacheSrc;
    uint8*  InputMapCacheIdx;
    uint16* InputMapCacheSrc;
    int32   NumInstancesExecCached;

    uint32 Flags;                       // VVMFlag_* 플래그
    uint32 NumExtFunctions;
    uint32 MaxExtFnRegisters;

    uint32 NumTempRegisters;            // 임시 레지스터 개수
    uint32 NumConstBuffers;             // 상수 버퍼 개수
    uint32 NumInputBuffers;             // 입력 버퍼 개수
    uint32 NumInputDataSets;            // 입력 데이터셋 개수
    uint32 NumOutputsRemapped;          // 재매핑된 출력 개수
    uint32 NumOutputBuffers;            // 출력 버퍼 개수
    uint32 MaxOutputDataSet;            // 최대 출력 데이터셋
    uint32 NumDummyRegsRequired;        // 더미 레지스터 개수

    // 배치 관련
    uint32 BatchOverheadSize;
    uint32 ChunkLocalDataOutputIdxNumBytes;
    uint32 ChunkLocalNumOutputNumBytes;
    uint32 ChunkLocalOutputMaskIdxNumBytes;

    uint64 OptimizerHashId;             // 최적화 해시 ID
    uint32 TotalNumBytes;               // 전체 메모리 크기
};
```

**핵심 책임:**
- **바이트코드 저장**: 최적화된 VM 명령어 시퀀스
- **레지스터 관리**: 상수, 임시, 입력, 출력 레지스터 매핑
- **실행 상태 캐싱**: 반복 실행 시 성능 최적화

---

### 2. FVectorVMBatchState - 배치별 실행 상태

**📂 위치:** `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp:51`

```cpp
struct FVectorVMBatchState
{
    MS_ALIGN(16) FVecReg* RegisterData GCC_ALIGN(16);  // 임시 레지스터 데이터

    struct
    {
        uint32* StartingOutputIdxPerDataSet;    // 데이터셋별 출력 시작 인덱스
        uint32* NumOutputPerDataSet;            // 데이터셋별 출력 개수
        uint8** OutputMaskIdx;                  // 출력 마스크 인덱스

        struct
        {
            uint32** RegData;                   // 외부 함수용 레지스터 데이터
            uint8*   RegInc;                    // 레지스터 증분 (0=상수, 16=임시)
            FVecReg* DummyRegs;                 // 더미 레지스터
        } ExtFnDecodedReg;

        int32* RandCounters;                    // 외부 함수용 랜덤 카운터

        int ChunkIdx;                           // 현재 청크 인덱스
        int StartInstanceThisChunk;             // 청크 시작 인스턴스
        int NumInstancesThisChunk;              // 청크 인스턴스 개수
    } ChunkLocalData;

    uint8** RegPtrTable;    // 레지스터 포인터 테이블 (정렬되지 않음)
    uint8*  RegIncTable;    // 레지스터 증분 테이블 (0=상수, 16=임시)
    uint8*  OutputMaskIdx;  // 출력 마스크 인덱스

    union
    {
        struct
        {
            VectorRegister4i State[5];   // xorwow 랜덤 상태
            VectorRegister4i Counters;   // xorwow 카운터
        };
    } RandState;

    FRandomStream RandStream;                   // FRandomStream 상태
};
```

**핵심 책임:**
- **배치 단위 레지스터 할당**: 각 배치마다 독립적인 레지스터 공간
- **청크별 실행 상태 관리**: 청크 단위로 인스턴스 분할 처리
- **레지스터 포인터 테이블**: 상수/임시/입력/출력 레지스터에 빠른 접근

---

### 3. FVecReg - SIMD 레지스터 Union

**📂 위치:** `Engine/Source/Runtime/VectorVM/Private/VectorVMTypes.h:12`

```cpp
union FVecReg
{
    VectorRegister4f v;  // 4x float (SSE/NEON 사용)
    VectorRegister4i i;  // 4x int32 (SSE/NEON 사용)
};
```

**핵심 특징:**
- **128비트 SIMD 레지스터**: 4개의 float 또는 int를 동시 처리
- **타입 중립적**: float와 int를 동일한 메모리 공간에서 처리 (비트캐스트)

---

### 4. EVectorVMOp - OpCode 열거형

**📂 위치:** `Engine/Source/Runtime/VectorVM/Public/VectorVM.h:236`

```cpp
enum class EVectorVMOp : uint8
{
    done,                      // 0: 실행 종료
    add,                       // 1: float 덧셈
    sub,                       // 2: float 뺄셈
    mul,                       // 3: float 곱셈
    div,                       // 4: float 나눗셈
    mad,                       // 5: float multiply-add (a*b+c)
    lerp,                      // 6: 선형 보간
    rcp,                       // 7: 역수 (1/x)
    rsq,                       // 8: 역제곱근 (1/sqrt(x))
    sqrt,                      // 9: 제곱근
    neg,                       // 10: 부정
    abs,                       // 11: 절대값
    exp, exp2, log, log2,      // 12-15: 지수/로그 함수
    sin, cos, tan,             // 16-18: 삼각 함수
    asin, acos, atan, atan2,   // 19-22: 역삼각 함수
    ceil, floor, fmod, frac, trunc,  // 23-27: 소수점 연산
    clamp, min, max, pow,      // 28-31: 범위/제곱 연산

    // 비교 연산 (결과: 0xFFFFFFFF=true, 0x00000000=false)
    cmplt, cmple, cmpgt, cmpge, cmpeq, cmpneq,  // 37-42: float 비교

    select,                    // 43: 조건 선택 (mask ? a : b)

    // 정수 연산
    addi, subi, muli, divi,    // 44-47: int 산술
    clampi, mini, maxi,        // 48-50: int 범위
    absi, negi, signi,         // 51-53: int 단항
    randomi,                   // 54: 랜덤 int
    cmplti, cmplei, cmpgti, cmpgei, cmpeqi, cmpneqi,  // 55-60: int 비교

    // 비트 연산
    bit_and, bit_or, bit_xor, bit_not,  // 61-64: 비트 연산
    bit_lshift, bit_rshift,    // 65-66: 비트 시프트
    logic_and, logic_or, logic_xor, logic_not,  // 67-70: 논리 연산

    // 타입 변환
    f2i, i2f, f2b, b2f, i2b, b2i,  // 71-76: 타입 변환

    // 입출력
    inputdata_float, inputdata_int32, inputdata_half,  // 77-79
    inputdata_noadvance_float, inputdata_noadvance_int32, inputdata_noadvance_half,  // 80-82
    outputdata_float, outputdata_int32, outputdata_half,  // 83-85

    // 특수 명령
    acquireindex,              // 86: 인덱스 획득
    external_func_call,        // 87: 외부 함수 호출
    exec_index,                // 88: 실행 인덱스

    // 병합된 최적화 명령 (98~178)
    // 자주 함께 사용되는 명령들을 하나로 결합
    exec_indexf,               // 98: exec_index + i2f
    exec_index_addi,           // 99: exec_index + addi
    cmplt_select,              // 100: cmplt + select
    mad_add,                   // 130: mad + add
    mul_mad0,                  // 137: mul -> mad (첫 번째 인자)
    sin_cos,                   // 176: sin과 cos 동시 계산

    NumOpcodes
};
```

**핵심 특징:**
- **179개의 OpCode**: 기본 연산 + 병합 최적화 연산
- **8비트 크기**: 메모리 효율적
- **병합 연산 (Merged Ops)**: 자주 연결되는 명령을 하나로 결합 (예: `mad_add`, `mul_mul`, `sin_cos`)

---

## 🔄 실행 흐름 (Execution Flow)

### 시퀀스 다이어그램

```
Niagara       ExecVectorVMState()    FVectorVMBatchState    Bytecode Dispatcher    SIMD Functions
  │                  │                        │                      │                    │
  │ Exec Request     │                        │                      │                    │
  ├─────────────────>│                        │                      │                    │
  │                  │                        │                      │                    │
  │                  │ 1. 상수 버퍼 초기화    │                      │                    │
  │                  ├────────────────────────┤                      │                    │
  │                  │                        │                      │                    │
  │                  │ 2. 배치/청크 분할 계산 │                      │                    │
  │                  ├────────────────────────┤                      │                    │
  │                  │                        │                      │                    │
  │                  │ 3. Alloc BatchState    │                      │                    │
  │                  ├───────────────────────>│                      │                    │
  │                  │                        │                      │                    │
  │                  │ 4. Setup Pointers      │                      │                    │
  │                  ├───────────────────────>│                      │                    │
  │                  │                        │                      │                    │
  │                  │ 5. For Each Chunk      │                      │                    │
  │                  │  ┌──────────────────────────────────────────────────────┐          │
  │                  │  │ If (NumLoops == 1)                                   │          │
  │                  │  │   ExecChunkSingleLoop()                              │          │
  │                  │  │ Else                                                 │          │
  │                  │  │   ExecChunkMultipleLoops()                           │          │
  │                  │  └──────────────────────────────────────────────────────┘          │
  │                  │                        │                      │                    │
  │                  │                        │ 6. Decode OpCode     │                    │
  │                  │                        ├─────────────────────>│                    │
  │                  │                        │                      │                    │
  │                  │                        │ 7. Dispatch to Func  │                    │
  │                  │                        │                      ├───────────────────>│
  │                  │                        │                      │                    │
  │                  │                        │                      │ 8. SIMD Execution  │
  │                  │                        │                      │ (VectorAdd,        │
  │                  │                        │                      │  VectorMul, etc)   │
  │                  │                        │                      │<───────────────────┤
  │                  │                        │                      │                    │
  │                  │                        │ 9. Write to Register │                    │
  │                  │                        │<─────────────────────┤                    │
  │                  │                        │                      │                    │
  │                  │ 10. Free BatchState    │                      │                    │
  │                  │<───────────────────────┤                      │                    │
  │                  │                        │                      │                    │
  │ Return           │                        │                      │                    │
  │<─────────────────┤                        │                      │                    │
```

---

### 계층별 상세 분석

#### 1. ExecVectorVMState - 최상위 실행 함수

**📂 위치:** `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp:2182`

**역할:** VectorVM 실행의 진입점

**실행 단계:**

```cpp
void ExecVectorVMState(FVectorVMExecContext *ExecCtx)
{
    // 1. 외부 함수 테이블 설정
    for (uint32 i = 0; i < ExecCtx->VVMState->NumExtFunctions; ++i)
    {
        ExecCtx->VVMState->ExtFunctionTable[i].Function = ExecCtx->ExtFunctionTable[i];
    }

    // 2. 출력 카운터 초기화
    for (uint32 i = 0; i < ExecCtx->VVMState->MaxOutputDataSet; ++i)
    {
        ExecCtx->VVMState->NumOutputPerDataSet[i] = 0;
    }

    // 3. 데이터 매핑 캐시 빌드 (첫 실행 시에만)
    if (!(ExecCtx->VVMState->Flags & VVMFlag_DataMapCacheSetup))
    {
        VVMBuildMapTableCaches(ExecCtx);
        ExecCtx->VVMState->Flags |= VVMFlag_DataMapCacheSetup;
    }

    // 4. 상수 버퍼 설정
    for (uint32 i = 0; i < ExecCtx->VVMState->NumConstBuffers; ++i)
    {
        // 상수 테이블에서 값을 가져와 SIMD 레지스터에 복제
        ExecCtx->VVMState->ConstantBuffers[i].i = VectorIntSet1(
            ((uint32*)ExecCtx->ConstantTableData[...])[...]
        );
    }

    // 5. Batch/Chunk 분할 계산
    // NumInstances가 변경되지 않았으면 캐시된 값 사용
    if (ExecCtx->NumInstances != ExecCtx->VVMState->NumInstancesExecCached)
    {
        // 배치당 최대 4개 청크 (POWER OF 2 필수)
        static const uint32 MaxChunksPerBatch = 4;

        // 페이지 크기 (기본 64KB)
        size_t PageSizeInBytes = (uint64_t)GVVMPageSizeInKB << 10;

        // 루프 개수 계산 (4-wide 기준)
        const uint32 TotalNumLoopsRequired = ((ExecCtx->NumInstances + 3) >> 2);

        // 청크당 최대 루프 개수 계산
        MaxLoopsPerChunk = ...;

        // 배치당 필요한 메모리 계산
        ExecCtx->Internal.NumBytesRequiredPerBatch = ...;
    }

    // 6. BatchState 할당
    FVectorVMBatchState *BatchState = (FVectorVMBatchState*)FMemory::Malloc(
        ExecCtx->VVMState->BatchOverheadSize +
        ExecCtx->Internal.PerBatchRegisterDataBytesRequired
    );

    // 7. BatchState 포인터 설정
    SetupBatchStatePtrs(ExecCtx, BatchState);

    // 8. 랜덤 상태 초기화 (필요 시)
    if (ExecCtx->VVMState->Flags & VVMFlag_HasRandInstruction)
    {
        SetupRandStateForBatch(BatchState);
    }

    // 9. 청크별 실행
    int StartInstanceThisChunk = 0;
    int NumChunksThisBatch = (ExecCtx->NumInstances + MaxInstancesPerChunk - 1) / MaxInstancesPerChunk;

    for (int ChunkIdx = 0; ChunkIdx < NumChunksThisBatch; ++ChunkIdx)
    {
        int NumInstancesThisChunk = MIN(MaxInstancesPerChunk,
                                        ExecCtx->NumInstances - StartInstanceThisChunk);
        int NumLoops = ((NumInstancesThisChunk + 3) & ~3) >> 2;  // 4-wide

        BatchState->ChunkLocalData.ChunkIdx = ChunkIdx;
        BatchState->ChunkLocalData.StartInstanceThisChunk = StartInstanceThisChunk;
        BatchState->ChunkLocalData.NumInstancesThisChunk = NumInstancesThisChunk;

        if (NumLoops == 1)
            ExecChunkSingleLoop(ExecCtx, BatchState);
        else
            ExecChunkMultipleLoops(ExecCtx, BatchState, NumLoops);

        StartInstanceThisChunk += MaxInstancesPerChunk;
    }

    // 10. 정리
    FMemory::Free(BatchState);

    // 11. DataSet 출력 인덱스 설정
    for (uint32 i = 0; i < ExecCtx->VVMState->MaxOutputDataSet; ++i)
    {
        ExecCtx->DataSets[i].DataSetAccessIndex =
            ExecCtx->VVMState->NumOutputPerDataSet[i] - 1;
    }
}
```

**핵심 최적화:**
- **캐싱**: 인스턴스 개수가 동일하면 배치/청크 분할 계산 생략
- **메모리 페이지 정렬**: 64KB 페이지 단위로 배치 메모리 할당
- **청크 분할**: 큰 데이터를 청크로 나누어 캐시 효율 향상

---

#### 2. SetupBatchStatePtrs - 레지스터 포인터 테이블 설정

**📂 위치:** `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp:314`

**역할:** BatchState의 메모리 레이아웃 설정

**메모리 레이아웃:**

```
┌─────────────────────────────────────────────────────────┐
│  FVectorVMBatchState (sizeof=88, align=16)              │
├─────────────────────────────────────────────────────────┤
│  [64-byte aligned padding]                              │
├─────────────────────────────────────────────────────────┤
│  RegisterData (FVecReg[NumTempRegisters * NumLoops])    │  <- 임시 레지스터 배열
│  - 각 레지스터는 16바이트 (4 x float/int)                │
├─────────────────────────────────────────────────────────┤
│  RegPtrTable (uint8*[NumPtrRegsInTable])                │  <- 레지스터 포인터 테이블
│  - 순서: Temp → Const → Input → Output                  │
├─────────────────────────────────────────────────────────┤
│  RegIncTable (uint8[NumPtrRegsInTable])                 │  <- 레지스터 증분 테이블
│  - 0: 상수 (advance 안 함)                              │
│  - 16: 임시 레지스터 (FVecReg 크기만큼 advance)         │
├─────────────────────────────────────────────────────────┤
│  OutputMaskIdx (uint8[MaxOutputDataSet * NumLoops])     │  <- 출력 마스크
│  - acquireindex 명령의 결과 (4비트 = 4개 인스턴스)      │
├─────────────────────────────────────────────────────────┤
│  ChunkLocalData (청크별 데이터)                          │
│  - StartingOutputIdxPerDataSet                          │
│  - NumOutputPerDataSet                                  │
│  - OutputMaskIdx 포인터 배열                            │
│  - ExtFnDecodedReg (외부 함수용)                        │
└─────────────────────────────────────────────────────────┘
```

**레지스터 포인터 테이블 구성:**

```cpp
// RegPtrTable의 레이아웃
// [0 ~ NumTempRegisters-1]              : 임시 레지스터 포인터
// [NumTempRegisters ~ +NumConstBuffers] : 상수 버퍼 포인터
// [... ~ +NumInputBuffers]              : 입력 버퍼 포인터 (1차)
// [... ~ +NumInputBuffers]              : 입력 버퍼 포인터 (2차, 청크 시작용)
// [... ~ +NumOutputBuffers]             : 출력 버퍼 포인터

uint32 **TempRegPtr   = (uint32**)BatchState->RegPtrTable;
uint32 **ConstBuffPtr = TempRegPtr   + NumTempRegisters;
uint32 **InputPtr     = ConstBuffPtr + NumConstBuffers;
uint32 **OutputPtr    = InputPtr     + NumInputBuffers * 2;
```

---

#### 3. ExecChunkMultipleLoops - 바이트코드 실행

**📂 위치:** `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp` (매크로 생성)

**역할:** 바이트코드를 읽고 SIMD 함수로 디스패치

**바이트코드 디코딩 구조:**

```
[OpCode:1] [Operands:N] [OpCode:1] [Operands:N] ... [done:1]
    │           │
    │           └─ 레지스터 인덱스들 (16비트 또는 8비트)
    │
    └─ EVectorVMOp enum 값
```

**실행 메커니즘 (의사코드):**

```cpp
void ExecChunkMultipleLoops(FVectorVMExecContext* ExecCtx,
                            FVectorVMBatchState* BatchState,
                            int NumLoops)
{
    const uint8* InsPtr = ExecCtx->VVMState->Bytecode;  // 명령어 포인터

    while (true)
    {
        uint8 OpCode = *InsPtr++;  // OpCode 읽기

        switch (OpCode)
        {
            case EVectorVMOp::done:
                return;  // 실행 종료

            case EVectorVMOp::add:
                // InsPtr에서 레지스터 인덱스 3개 읽기: [Src0:16bit][Src1:16bit][Dst:16bit]
                InsPtr = VVM_Dispatch_execFn2f_1f(
                    true,           // CT_MultipleLoops = true
                    InsPtr,         // 피연산자 포인터
                    BatchState,
                    ExecCtx,
                    VVM_Exec2f_add, // 실제 SIMD 함수
                    NumLoops
                );
                break;

            case EVectorVMOp::mad:
                InsPtr = VVM_Dispatch_execFn3f_1f(
                    true, InsPtr, BatchState, ExecCtx, VVM_Exec3f_mad, NumLoops
                );
                break;

            case EVectorVMOp::outputdata_float:
                InsPtr = VVM_Output32(true, InsPtr, BatchState, ExecCtx);
                break;

            // ... 나머지 OpCode들
        }
    }
}
```

---

#### 4. VVM_Dispatch_execFn2f_1f - 디스패치 함수

**📂 위치:** `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp:1585`

**역할:** 레지스터에서 데이터를 읽고, SIMD 함수를 호출하고, 결과를 저장

```cpp
VM_FORCEINLINE const uint8* VVM_Dispatch_execFn2f_1f(
    const bool CT_MultipleLoops,  // 컴파일 타임 상수: true=여러 루프
    const uint8* InsPtr,          // 명령어 포인터
    FVectorVMBatchState* BatchState,
    FVectorVMExecContext* ExecCtx,
    VVMFn_2f fn,                  // 실제 SIMD 함수 (예: VVM_Exec2f_add)
    int NumLoops                  // 루프 개수 (4-wide 단위)
)
{
    // 1. 레지스터 인덱스 디코딩
    uint16* RegIndices = (uint16*)InsPtr;
    // RegIndices[0] = 첫 번째 소스 레지스터 인덱스
    // RegIndices[1] = 두 번째 소스 레지스터 인덱스
    // RegIndices[2] = 목적지 레지스터 인덱스

    // 2. 레지스터 포인터 가져오기
    uint8* P0 = BatchState->RegPtrTable[RegIndices[0]];  // 첫 번째 소스
    uint8* P1 = BatchState->RegPtrTable[RegIndices[1]];  // 두 번째 소스
    uint8* P2 = BatchState->RegPtrTable[RegIndices[2]];  // 목적지

    if (CT_MultipleLoops)  // 여러 루프인 경우
    {
        // 3. 레지스터 증분 가져오기
        uint32 Inc0 = (uint32)BatchState->RegIncTable[RegIndices[0]];
        uint32 Inc1 = (uint32)BatchState->RegIncTable[RegIndices[1]];
        // Inc = 0:  상수 (포인터 이동 안 함)
        // Inc = 16: 임시 레지스터 (FVecReg 크기만큼 이동)

        uint8* End = P2 + sizeof(FVecReg) * NumLoops;  // 종료 지점

        // 4. 루프 실행 (4-wide 단위)
        do
        {
            // 4.1. SIMD 로드
            VectorRegister4f R0 = VectorLoad((float*)P0);
            VectorRegister4f R1 = VectorLoad((float*)P1);

            // 4.2. 포인터 이동 (상수면 0, 임시면 16바이트)
            P0 += Inc0;
            P1 += Inc1;

            // 4.3. SIMD 함수 호출
            VectorRegister4f Res = fn(BatchState, R0, R1);
            // 예: VVM_Exec2f_add → VectorAdd(R0, R1)

            // 4.4. 결과 저장
            VectorStore(Res, (float*)P2);
            P2 += sizeof(FVecReg);  // 목적지는 항상 임시 레지스터

        } while (P2 < End);
    }
    else  // 단일 루프인 경우 (NumLoops == 1)
    {
        // 루프 없이 한 번만 실행
        VectorRegister4f R0 = VectorLoad((float*)P0);
        VectorRegister4f R1 = VectorLoad((float*)P1);
        VectorRegister4f Res = fn(BatchState, R0, R1);
        VectorStore(Res, (float*)P2);
    }

    // 5. 명령어 포인터 진행
    // 3개의 16비트 인덱스 = 6바이트 + 1바이트(OpCode 사이의 정렬) = 7바이트
    return InsPtr + 7;
}
```

**핵심 최적화:**
- **컴파일 타임 분기**: `CT_MultipleLoops`로 루프 여부를 컴파일 타임에 결정
- **강제 인라인**: `VM_FORCEINLINE`으로 함수 호출 오버헤드 제거
- **상수 최적화**: Inc==0이면 포인터 이동 생략

---

#### 5. VVM_Exec2f_add - 실제 SIMD 연산

**📂 위치:** `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp:1906`

```cpp
VM_FORCEINLINE VectorRegister4f VVM_Exec2f_add(
    FVectorVMBatchState* BatchState,
    VectorRegister4f a,
    VectorRegister4f b
)
{
    return VectorAdd(a, b);
}
```

**플랫폼별 구현:**

```cpp
// x64 (SSE)
#define VectorAdd(a, b)  _mm_add_ps(a, b)
// -> addps xmm0, xmm1  (128비트 4x float 덧셈)

// ARM (NEON)
#define VectorAdd(a, b)  vaddq_f32(a, b)
// -> vadd.f32 q0, q1, q2  (128비트 4x float 덧셈)
```

---

## 🧩 주요 기능

### 1. SIMD 최적화 방식

VectorVM은 다음과 같은 방식으로 SIMD 최적화를 달성합니다:

**1.1 4-wide 병렬 처리**

```cpp
// 일반적인 스칼라 코드
for (int i = 0; i < NumInstances; ++i)
{
    float a = Input0[i];
    float b = Input1[i];
    Output[i] = a + b;  // 한 번에 1개 처리
}

// VectorVM의 SIMD 코드
int NumLoops = (NumInstances + 3) / 4;  // 4개씩 묶음
for (int i = 0; i < NumLoops; ++i)
{
    VectorRegister4f a = VectorLoad(&Input0[i * 4]);  // 4개 로드
    VectorRegister4f b = VectorLoad(&Input1[i * 4]);  // 4개 로드
    VectorRegister4f res = VectorAdd(a, b);           // 4개 동시 덧셈
    VectorStore(res, &Output[i * 4]);                 // 4개 저장
}
```

**성능 향상:**
- **이론적 4배 속도**: 한 명령어로 4개 데이터 처리
- **실제 3~3.5배**: 메모리 대역폭과 캐시 미스 고려

---

**1.2 레지스터 증분 테이블 (Register Increment Table)**

```cpp
// RegIncTable 값
// 0:  상수 레지스터 (포인터 이동 안 함)
// 16: 임시 레지스터 (FVecReg 크기 = 16바이트만큼 이동)

// 예시: A + B = C (A는 상수, B와 C는 임시 레지스터)
uint32 Inc0 = BatchState->RegIncTable[RegIndices[0]];  // A: 0 (상수)
uint32 Inc1 = BatchState->RegIncTable[RegIndices[1]];  // B: 16 (임시)

do
{
    VectorRegister4f R0 = VectorLoad((float*)P0);  // A 로드 (항상 같은 값)
    VectorRegister4f R1 = VectorLoad((float*)P1);  // B 로드
    P0 += Inc0;  // P0 += 0  (상수는 이동 안 함)
    P1 += Inc1;  // P1 += 16 (다음 4개 값으로 이동)

    VectorRegister4f Res = VectorAdd(R0, R1);  // R0은 매번 같은 값
    VectorStore(Res, (float*)P2);
    P2 += 16;
} while (...);
```

**효과:**
- **상수 브로드캐스트 자동 처리**: 상수는 한 번 로드하면 모든 루프에서 재사용
- **분기 제거**: Inc 값이 0인지 검사하는 if문 불필요

---

**1.3 출력 마스크 테이블 (Output Mask Table)**

`acquireindex` 명령은 조건부 출력을 위한 마스크를 생성합니다.

```cpp
// VVM_PSHUFB_OUTPUT_TABLE - 출력 셔플 테이블
// 하위 4비트가 4개 인스턴스의 출력 여부를 나타냄
// 0001 (1): 첫 번째만 출력
// 0101 (5): 첫 번째와 세 번째 출력
// 1111 (15): 모두 출력

static const MS_ALIGN(16) uint8 VVM_PSHUFB_OUTPUT_TABLE[] GCC_ALIGN(16) =
{
    0xFF, 0xFF, 0xFF, 0xFF, ...,  // 0000: 모두 무시
    0x00, 0x01, 0x02, 0x03, ...,  // 0001: [0] 출력
    0x04, 0x05, 0x06, 0x07, ...,  // 0010: [1] 출력
    0x00, 0x01, 0x02, 0x03,       // 0011: [0][1] 출력
        0x04, 0x05, 0x06, 0x07, ...,
    ...
    0x00, 0x01, 0x02, 0x03,       // 1111: [0][1][2][3] 모두 출력
        0x04, 0x05, 0x06, 0x07,
        0x08, 0x09, 0x0A, 0x0B,
        0x0C, 0x0D, 0x0E, 0x0F
};

// 사용 예시
uint8 TblIdx = *TblIdxPtr++;  // 예: 5 (0101 = 첫 번째와 세 번째 출력)
VectorRegister4i Mask = ((VectorRegister4i*)VVM_PSHUFB_OUTPUT_TABLE)[TblIdx];
VectorRegister4i Src = VectorIntLoad(SrcPtr);
VectorRegister4i Val = VVM_pshufb(Src, Mask);  // [Src[0], Src[2], ?, ?]
VectorIntStore(Val, DstPtr);
DstPtr += VVM_OUTPUT_ADVANCE_TABLE[TblIdx];  // TblIdx=5 → +8바이트 (2개 출력)
```

**효과:**
- **조건부 출력 최적화**: if문 없이 SIMD 셔플 명령어로 처리
- **메모리 패킹**: 출력 데이터가 연속적으로 패킹됨

---

### 2. 레지스터 관리 시스템

VectorVM은 3가지 타입의 레지스터를 관리합니다:

**2.1 상수 레지스터 (Constant Registers)**

```cpp
// 상수는 VVMState에 SIMD 레지스터로 저장
FVecReg* ConstantBuffers;  // 각 상수는 4-wide로 복제됨

// 예: 상수 3.14를 설정
ExecCtx->VVMState->ConstantBuffers[i].i = VectorIntSet1(
    ((uint32*)ConstantTableData)[index]
);
// VectorIntSet1(x) → [x, x, x, x] (4개 복제)

// 레지스터 테이블에 포인터 저장
ConstBuffPtr[i] = (uint32*)(ExecCtx->VVMState->ConstantBuffers + i);
RegIncTable[ConstantRegisterIndex] = 0;  // 증분 = 0 (이동 안 함)
```

---

**2.2 임시 레지스터 (Temporary Registers)**

```cpp
// 임시 레지스터는 BatchState에 배치별로 할당
FVecReg* RegisterData;  // 크기: NumTempRegisters * NumLoops

// 각 청크마다 독립적인 공간 사용
// 레지스터 N의 루프 L에서의 위치:
//   RegisterData[N * NumLoops + L]

for (uint32 i = 0; i < NumTempRegisters; ++i)
{
    TempRegPtr[i] = (uint32*)(BatchState->RegisterData + i * NumLoops);
    RegIncTable[i] = sizeof(FVecReg);  // 16바이트
}
```

---

**2.3 입력/출력 레지스터 (Input/Output Registers)**

```cpp
// 입력 레지스터는 Niagara 데이터에 직접 포인팅
for (uint32 i = 0; i < NumInputBuffers; ++i)
{
    uint8 DataSetIdx = InputMapCacheIdx[i];
    uint16 InputMapSrcIdx = InputMapCacheSrc[i];

    bool bNoAdvanceInput = InputMapSrcIdx & 0x8000;  // 최상위 비트
    bool bHalfInput = InputMapSrcIdx & 0x4000;       // 두 번째 비트
    InputMapSrcIdx = InputMapSrcIdx & 0x3FFF;        // 하위 14비트

    if (bNoAdvanceInput)  // 노어드밴스 입력 (모든 인스턴스가 같은 값 사용)
    {
        // 상수 버퍼 뒤에 저장
        InputPtr[i] = (uint32*)(ConstantBuffers + NumConstBuffers + NoAdvCounter++);
        RegIncTable[InputRegisterIndex] = 0;  // 증분 = 0
    }
    else  // 일반 입력 (인스턴스마다 다른 값)
    {
        // Niagara 입력 버퍼에 직접 포인팅
        uint32 DataTypeStride = bHalfInput ? 2 : 4;
        uint32 OffsetBytes = InstanceOffset * DataTypeStride;
        InputPtr[i] = (uint32*)(DataSetInputBuffers[InputMapSrcIdx] + OffsetBytes);
        RegIncTable[InputRegisterIndex] = DataTypeStride;  // 2 또는 4
    }

    // 두 번째 복사본 (청크 시작 위치 복원용)
    InputPtr[i + NumInputBuffers] = InputPtr[i];
}
```

---

### 3. 병합 명령 (Merged Instructions)

자주 함께 사용되는 명령들을 하나로 결합하여 디스패치 오버헤드를 줄입니다.

**예시 1: `mad_add` (OpCode 130)**

```cpp
// 원래 코드 (2개 명령)
mad  R0, R1, R2, R3   // R3 = R0 * R1 + R2
add  R3, R4, R5       // R5 = R3 + R4

// 병합 코드 (1개 명령)
mad_add  R0, R1, R2, R4, R5   // R5 = (R0 * R1 + R2) + R4

// 구현
VectorRegister4f VVM_Exec4f_mad_add(
    FVectorVMBatchState* BatchState,
    VectorRegister4f a, VectorRegister4f b,
    VectorRegister4f c, VectorRegister4f d
)
{
    VectorRegister4f mad_result = VectorMultiplyAdd(a, b, c);  // a*b+c
    return VectorAdd(mad_result, d);                           // + d
}
```

**효과:**
- **디스패치 횟수 감소**: 2번 → 1번
- **레지스터 읽기/쓰기 감소**: R3를 메모리에 쓰고 다시 읽는 과정 제거
- **명령어 캐시 효율 향상**

---

**예시 2: `sin_cos` (OpCode 176)**

```cpp
// 원래 코드 (2개 명령)
sin  R0, R1   // R1 = sin(R0)
cos  R0, R2   // R2 = cos(R0)  (R0를 두 번 읽음)

// 병합 코드 (1개 명령)
sin_cos  R0, R1, R2   // R1 = sin(R0), R2 = cos(R0)

// 구현
const uint8* VVM_sin_cos(const bool CT_MultipleLoops, ...)
{
    uint16* RegIndices = (uint16*)InsPtr;
    uint8* P0 = BatchState->RegPtrTable[RegIndices[0]];
    uint8* P1 = BatchState->RegPtrTable[RegIndices[1]];  // sin 결과
    uint8* P2 = BatchState->RegPtrTable[RegIndices[2]];  // cos 결과

    if (CT_MultipleLoops)
    {
        uint32 Inc0 = BatchState->RegIncTable[RegIndices[0]];
        uint8* End = P1 + sizeof(FVecReg) * NumLoops;
        do
        {
            VectorRegister4f R0 = VectorLoad((float*)P0);
            P0 += Inc0;
            VectorSinCos(
                (VectorRegister4f*)P1,  // sin 출력
                (VectorRegister4f*)P2,  // cos 출력
                &R0                     // 입력
            );
            P1 += sizeof(FVecReg);
            P2 += sizeof(FVecReg);
        } while (P1 < End);
    }
    return InsPtr + 7;
}
```

**효과:**
- **입력 중복 제거**: R0을 한 번만 로드
- **SIMD 효율 향상**: `VectorSinCos`는 한 번에 sin/cos를 모두 계산 (테일러 급수 공유)

---

## 💡 설계 철학

| 설계 원칙 | 설명 | 효과 |
|----------|------|------|
| **1. 데이터 병렬성 최우선** | 모든 연산을 4-wide SIMD로 설계 | 파티클 시스템의 대량 데이터 처리에 최적화 |
| **2. 레지스터 기반 아키텍처** | 스택 대신 레지스터 인덱스 사용 | 빠른 데이터 접근, 캐시 효율 향상 |
| **3. 컴파일 타임 최적화** | `CT_MultipleLoops` 같은 템플릿 기반 분기 | 런타임 오버헤드 제거 |
| **4. 배치 및 청크 분할** | 큰 작업을 작은 청크로 분할 | CPU 캐시에 맞춰 성능 향상 |
| **5. 플랫폼 추상화** | `VectorAdd`, `VectorMul` 같은 매크로 사용 | 플랫폼별 최적화 코드 쉽게 관리 |

---

## 🔍 실전 예시

### 예시 1: 파티클 위치 업데이트

```cpp
// 의사코드
for (int i = 0; i < NumParticles; ++i)
{
    Position[i] = Position[i] + Velocity[i] * DeltaTime;
}

// VectorVM 바이트코드
mul  Velocity, DeltaTime, Temp0   // Temp0 = Velocity * DeltaTime
add  Position, Temp0, Position    // Position += Temp0

// 실행 흐름
// 1. mul 명령 디코딩
OpCode = EVectorVMOp::mul
RegIndices = [VelocityRegIdx, DeltaTimeRegIdx, Temp0RegIdx]

// 2. VVM_Dispatch_execFn2f_1f 호출
P0 = RegPtrTable[VelocityRegIdx]   // Velocity 입력 버퍼
P1 = RegPtrTable[DeltaTimeRegIdx]  // DeltaTime 상수 버퍼
P2 = RegPtrTable[Temp0RegIdx]      // Temp0 임시 레지스터

Inc0 = 16  // Velocity: 임시 레지스터
Inc1 = 0   // DeltaTime: 상수

NumLoops = (NumParticles + 3) / 4  // 예: 10000개 → 2500 루프

// 3. SIMD 루프 실행
for (int loop = 0; loop < NumLoops; ++loop)
{
    // 4개 파티클의 Velocity 로드
    VectorRegister4f V = VectorLoad((float*)P0);  // [V0, V1, V2, V3]
    P0 += 16;  // 다음 4개로 이동

    // DeltaTime 로드 (4개 모두 같은 값)
    VectorRegister4f DT = VectorLoad((float*)P1);  // [DT, DT, DT, DT]
    P1 += 0;   // 이동 안 함 (상수)

    // SIMD 곱셈
    VectorRegister4f Res = VectorMultiply(V, DT);  // [V0*DT, V1*DT, V2*DT, V3*DT]

    // Temp0에 저장
    VectorStore(Res, (float*)P2);
    P2 += 16;
}

// 4. add 명령도 동일한 방식으로 실행
```

---

### 예시 2: 조건부 출력 (acquireindex)

```cpp
// 의사코드
for (int i = 0; i < NumParticles; ++i)
{
    if (Particle[i].Age < Particle[i].LifeTime)
    {
        Output[OutputIdx++] = Particle[i];  // 살아있는 파티클만 출력
    }
}

// VectorVM 바이트코드
cmplt  Age, LifeTime, Mask         // Mask = (Age < LifeTime) ? 0xFFFFFFFF : 0
acquireindex  Mask                 // OutputMaskIdx 업데이트
outputdata_float  ParticleData     // Mask에 따라 선택적 출력

// acquireindex 실행
uint8* MaskPtr = RegPtrTable[MaskRegIdx];  // Mask 레지스터
uint8* OutputMaskPtr = OutputMaskIdx[DataSetIdx];

for (int loop = 0; loop < NumLoops; ++loop)
{
    // 4개 파티클의 Mask 로드
    VectorRegister4i Mask = VectorIntLoad(MaskPtr);  // [M0, M1, M2, M3]

    // 각 마스크를 1비트로 변환
    // M0=0xFFFFFFFF → 1, M0=0x00000000 → 0
    uint8 OutputMask = 0;
    OutputMask |= (Mask[0] != 0) ? 1 : 0;
    OutputMask |= (Mask[1] != 0) ? 2 : 0;
    OutputMask |= (Mask[2] != 0) ? 4 : 0;
    OutputMask |= (Mask[3] != 0) ? 8 : 0;

    // 예: [true, false, true, false] → 0101 (5)
    *OutputMaskPtr++ = OutputMask;

    MaskPtr += 16;
}

// outputdata_float 실행
for (int loop = 0; loop < NumLoops; ++loop)
{
    uint8 TblIdx = OutputMaskIdx[loop];  // 예: 5 (0101)

    // SIMD 셔플로 출력
    VectorRegister4i Shuffle = VVM_PSHUFB_OUTPUT_TABLE[TblIdx];
    VectorRegister4i Src = VectorIntLoad(SrcPtr);
    VectorRegister4i Packed = VVM_pshufb(Src, Shuffle);  // [Src[0], Src[2], ?, ?]

    VectorIntStore(Packed, DstPtr);
    DstPtr += VVM_OUTPUT_ADVANCE_TABLE[TblIdx];  // TblIdx=5 → +8 (2개 출력)
}
```

---

## 🔗 참조

**공식 문서:**
- [Niagara Overview](https://docs.unrealengine.com/5.7/ko/overview-of-niagara-effects-for-unreal-engine/)
- [Optimizing Niagara Performance](https://docs.unrealengine.com/5.7/ko/optimizing-niagara-effects-in-unreal-engine/)

**소스 파일:**
- `Engine/Source/Runtime/VectorVM/Public/VectorVM.h` - 기본 타입 및 OpCode 정의
- `Engine/Source/Runtime/VectorVM/Public/VectorVMRuntime.h` - 실행 컨텍스트
- `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp` - 실행 루프 및 SIMD 함수
- `Engine/Source/Runtime/VectorVM/Private/VectorVMTypes.h` - 내부 타입 정의
- `Engine/Source/Runtime/VectorVM/Private/Platforms/VectorVMPlatformGeneric.h` - 플랫폼별 SIMD 구현
- `Engine/Source/Runtime/VectorVM/Private/VectorVMOptimizer.cpp` - 바이트코드 최적화

**관련 시스템:**
- Niagara 파티클 시스템
- FRandomStream (랜덤 생성기)
- Unreal 플랫폼 추상화 (VectorRegister4f, VectorRegister4i)

---

> 🔄 Updated: 2025-11-21 — VectorVM 시스템 전체 분석 및 문서화 완료
---

## 🗄️ 병합 메모(아카이브)

- `../_Archive/_MergedNotes/2026-02-18/VectorVM__Overview__MergedNotes.md`

