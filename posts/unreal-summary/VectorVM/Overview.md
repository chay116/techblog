---
title: "VectorVM Overview"
date: "2026-02-18"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "VectorVM"
tags: ["unreal", "Niagara", "VectorVM"]
---
# VectorVM Overview

> Updated: 2026-02-18 ? merged duplicate content from related documents.
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

## Merged Notes (from Niagara/VectorVM.md)

### VectorVM - Niagara CPU 시뮬레이션 가상 머신
> 🔄 Updated: 2026-02-18 — VectorVM/Overview.md, Niagara/VM_Execution.md 내용을 통합하여 단일 문서로 병합

---

#### 🧭 개요 (Overview)
**VectorVM**은 **Niagara의 CPU 시뮬레이션을 담당하는 SIMD 기반 가상 머신 (Virtual Machine)**입니다. Niagara 그래프에서 컴파일된 바이트코드 (Bytecode)를 고속으로 실행하며, SSE/AVX 명령어를 활용한 벡터화된 연산으로 대규모 파티클 시뮬레이션을 효율적으로 처리합니다.

**핵심 역할:**
- **바이트코드 실행**: Niagara 스크립트를 컴파일한 VM 바이트코드를 실행
- **SIMD 벡터화 (Vectorization)**: 128비트 레지스터로 4개 파티클 동시 처리 (SSE/AVX, NEON)
- **고성능 연산**: 수학 연산, 조건 분기, 데이터 접근을 병렬화
- **레지스터 관리**: 상수/임시/입출력 레지스터의 효율적 관리
- **배치 처리 (Batch Processing)**: Chunk 단위로 분할하여 캐시 지역성 (Cache Locality) 최적화
- **외부 함수 호출 (External Function)**: DataInterface 함수 호출 지원

**📂 주요 위치:**
- `Engine/Source/Runtime/VectorVM/Public/VectorVM.h:236` (EVectorVMOp - 179개 OpCode)
- `Engine/Source/Runtime/VectorVM/Private/VectorVMTypes.h:23` (FVectorVMState)
- `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp:2182` (ExecVectorVMState)
- `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraScriptExecutionContext.h` (실행 컨텍스트)

---

#### 🎯 설계 철학: 왜 VectorVM인가?
##### 인터프리터 방식의 한계와 VectorVM의 해법
```
┌─────────────────────────────────────────────────────────────────────────┐
│                     인터프리터 실행의 문제점                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  문제 1: 스칼라 처리 (Scalar Processing)                                │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  for (int i = 0; i < 10000; ++i)                     │              │
│  │  {                                                   │              │
│  │      Position[i] += Velocity[i] * DeltaTime;         │              │
│  │  }                                                   │              │
│  │  → 10,000번 반복, 파티클 하나씩 처리                 │              │
│  │  → 캐시 미스, 분기 예측 실패                          │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
│  문제 2: 함수 호출 오버헤드 (Function Call Overhead)                    │
│  - 각 연산마다 가상 함수 호출                                            │
│  - 노드 그래프 순회 비용                                                 │
│  - 타입 체크 및 변환 오버헤드                                            │
│                                                                         │
│  문제 3: 메모리 레이아웃 (Memory Layout)                                │
│  - AoS (Array of Structures) 레이아웃                                   │
│  - SIMD 활용 불가능                                                     │
│  - 캐시 라인 낭비                                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                            ↓
                   VectorVM 솔루션:
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  해결 1: SIMD 벡터화 (4-wide 병렬)                                      │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  // 4개 파티클 동시 처리 (SSE)                        │              │
│  │  VectorRegister4f Pos = VectorLoad(Position);         │              │
│  │  VectorRegister4f Vel = VectorLoad(Velocity);         │              │
│  │  VectorRegister4f DT = VectorLoadFloat1(&Delta);      │              │
│  │  VectorRegister4f Result =                            │              │
│  │      VectorAdd(Pos, VectorMul(Vel, DT));              │              │
│  │  VectorStore(Result, Position);                       │              │
│  │                                                       │              │
│  │  → 10,000개 파티클 = 2,500번 반복 (4배 빠름!)         │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
│  해결 2: 바이트코드 실행 (Bytecode Execution)                           │
│  - 점프 테이블 기반 빠른 디스패치                                        │
│  - 가상 함수 호출 제거                                                   │
│  - 인라인 SIMD 연산                                                     │
│                                                                         │
│  해결 3: SoA (Structure of Arrays) 레이아웃                             │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  float PositionX[10000];  // 연속 메모리              │              │
│  │  float PositionY[10000];  // 캐시 친화적              │              │
│  │  float PositionZ[10000];  // SIMD 최적화              │              │
│  │                                                       │              │
│  │  → 128비트 로드로 4개 X 좌표 동시 읽기                │              │
│  │  → 캐시 라인 완전 활용                                 │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
│  해결 4: 병합 명령어 (Fused Operations)                                 │
│  - mad_add: (A * B) + C를 한 OpCode로 실행                             │
│  - mul_mul: (A * B) * (C * D)를 한 번에 계산                            │
│  - sin_cos: sin/cos 동시 계산                                           │
│  → 디스패치 오버헤드 50% 감소                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 성능 비교
| 방식 | 10만 파티클 업데이트 | 방법 |
|------|----------------------|------|
| **인터프리터 (스칼라)** | ~50ms | 파티클별 순회 + 가상 함수 호출 |
| **VectorVM (SIMD)** | ~5ms | 4-wide 벡터화 + 바이트코드 |
| **GPU Compute Shader** | ~1ms | 100만+ 스레드 완전 병렬 |

##### 설계 원칙 표
| 설계 원칙 | 설명 | 효과 |
|----------|------|------|
| **1. 데이터 병렬성 최우선** | 모든 연산을 4-wide SIMD로 설계 | 파티클 시스템의 대량 데이터 처리에 최적화 |
| **2. 레지스터 기반 아키텍처** | 스택 대신 레지스터 인덱스 사용 | 빠른 데이터 접근, 캐시 효율 향상 |
| **3. 컴파일 타임 최적화** | `CT_MultipleLoops` 같은 템플릿 기반 분기 | 런타임 오버헤드 제거 |
| **4. 배치 및 청크 분할** | 큰 작업을 작은 청크로 분할 | CPU 캐시에 맞춰 성능 향상 |
| **5. 플랫폼 추상화** | `VectorAdd`, `VectorMul` 같은 매크로 사용 | 플랫폼별 최적화 코드 쉽게 관리 |

**핵심 철학:**
> VectorVM은 **CPU에서 가능한 최대 병렬성을 추출**하기 위해 설계되었습니다.
> GPU만큼 빠르진 않지만, **디버깅 가능**하고 **복잡한 로직 지원**이 강점입니다.
> **"SIMD First, Scalar Fallback"** - 4개 인스턴스를 동시 처리하며, Constant vs Register 자동 최적화, Merged OpCode로 dispatch overhead를 최소화합니다.

---

#### 🧱 시스템 아키텍처 (System Architecture)
##### 전체 실행 파이프라인
```
┌─────────────────────────────────────────────────────────────────────────┐
│                     VectorVM 실행 파이프라인                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [1] 컴파일 (에디터 시점)                                               │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  Niagara Graph (노드 기반 스크립트)                   │              │
│  │      ↓                                               │              │
│  │  FNiagaraHlslTranslator::Compile()                   │              │
│  │      ├─ 그래프 순회                                   │              │
│  │      ├─ HLSL 코드 생성                                │              │
│  │      └─ HLSL → VM 바이트코드 변환                     │              │
│  │      ↓                                               │              │
│  │  FNiagaraVMExecutableData                            │              │
│  │  ├─ ByteCode: TArray<uint8>                         │              │
│  │  ├─ NumTempRegisters: int32                         │              │
│  │  └─ ConstantData: TArray<FVecReg>                   │              │
│  └──────────────────────────────────────────────────────┘              │
│                       ↓ DDC 캐싱                                        │
│                                                                         │
│  [2] 런타임 실행 준비                                                   │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  FNiagaraScriptExecutionContext (실행 오케스트레이터)  │              │
│  │  ├─ Script: UNiagaraScript*                          │              │
│  │  ├─ VectorVMState: FVectorVMState*                   │              │
│  │  ├─ FunctionTable: TArray<FVMExternalFunction*>     │              │
│  │  ├─ UserPtrTable: TArray<void*>                     │              │
│  │  └─ Parameters: FNiagaraScriptInstanceParameterStore│              │
│  └──────────────────────────────────────────────────────┘              │
│                       ↓                                                 │
│  [3] 배치 분할 (Batch Splitting)                                       │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  10,000 파티클 → Chunk 단위 처리 (4개씩 SIMD)        │              │
│  │                                                      │              │
│  │  FVectorVMBatchState (배치별 상태)                   │              │
│  │  ├─ RegisterData: FVecReg[NumTemp * NumLoops]       │              │
│  │  ├─ RegPtrTable: uint8*[TotalRegs]                  │              │
│  │  ├─ RegIncTable: uint8[TotalRegs]                   │              │
│  │  └─ ChunkLocalData: 청크별 로컬 데이터               │              │
│  └──────────────────────────────────────────────────────┘              │
│                       ↓                                                 │
│  [4] 바이트코드 실행 (SIMD 디스패치)                                    │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  ExecChunkMultipleLoops() / ExecChunkSingleLoop()    │              │
│  │  {                                                   │              │
│  │      while (true)                                    │              │
│  │      {                                               │              │
│  │          OpCode = *InsPtr++;                          │              │
│  │          switch (OpCode)                             │              │
│  │          {                                           │              │
│  │          case EVectorVMOp::add:                      │              │
│  │              VVM_Dispatch_execFn2f_1f(VVM_Exec2f_add)│              │
│  │              break;                                  │              │
│  │          case EVectorVMOp::done:                     │              │
│  │              return;                                 │              │
│  │          }                                           │              │
│  │      }                                               │              │
│  │  }                                                   │              │
│  └──────────────────────────────────────────────────────┘              │
│                       ↓                                                 │
│  [5] SIMD 연산 실행                                                     │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  VVM_Exec2f_add:                                     │              │
│  │  {                                                   │              │
│  │      return VectorAdd(a, b);                         │              │
│  │      //     └─ _mm_add_ps(A, B) (SSE)               │              │
│  │      //     └─ vaddq_f32(A, B)  (NEON)              │              │
│  │  }                                                   │              │
│  └──────────────────────────────────────────────────────┘              │
│                       ↓                                                 │
│  [6] 결과 출력                                                          │
│  ┌──────────────────────────────────────────────────────┐              │
│  │  outputdata_float → 조건부/무조건 출력               │              │
│  │  → Output DataSet (Niagara 파티클 데이터)            │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 실행 시퀀스 다이어그램
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

#### 📐 핵심 데이터 구조 (Core Data Structures)
##### 1. FVectorVMState - VM 실행 상태
**📂 위치:** `Engine/Source/Runtime/VectorVM/Private/VectorVMTypes.h:23`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FVectorVMState                                  │
│  (VM 실행의 전역 상태 컨테이너)                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  Private:                                                               │
│    - Bytecode : uint8*                    // 최적화된 바이트코드         │
│    - NumBytecodeBytes : uint32            // 바이트코드 크기             │
│    - ConstantBuffers : FVecReg*           // 상수 버퍼 (SIMD 레지스터)  │
│    - ExtFunctionTable : FVectorVMExtFunctionData*  // 외부 함수 테이블   │
│    - NumOutputPerDataSet : int32*         // 데이터셋별 출력 개수       │
│                                                                         │
│  레지스터 매핑 테이블:                                                  │
│    - ConstRemapTable : uint16*            // 상수 재매핑                │
│    - InputRemapTable : uint16*            // 입력 재매핑                │
│    - InputDataSetOffsets : uint16*        // 입력 데이터셋 오프셋       │
│    - OutputRemapDataSetIdx : uint8*       // 출력 데이터셋 인덱스       │
│    - OutputRemapDataType : uint16*        // 출력 데이터 타입           │
│    - OutputRemapDst : uint16*             // 출력 목적지                │
│                                                                         │
│  캐시 (Exec 호출 시 설정):                                              │
│    - ConstMapCacheIdx : uint8*                                          │
│    - ConstMapCacheSrc : uint16*                                         │
│    - InputMapCacheIdx : uint8*                                          │
│    - InputMapCacheSrc : uint16*                                         │
│    - NumInstancesExecCached : int32                                     │
│                                                                         │
│  카운터:                                                                │
│    - NumTempRegisters : uint32            // 임시 레지스터 개수         │
│    - NumConstBuffers : uint32             // 상수 버퍼 개수             │
│    - NumInputBuffers : uint32             // 입력 버퍼 개수             │
│    - NumOutputBuffers : uint32            // 출력 버퍼 개수             │
│    - Flags : uint32                       // VVMFlag_* 플래그           │
│    - OptimizerHashId : uint64             // 최적화 해시 ID             │
│                                                                         │
│  핵심 역할:                                                             │
│    - 바이트코드 및 상수 데이터 보관                                      │
│    - 레지스터 매핑 정보 관리                                             │
│    - 외부 함수 (DataInterface) 연결                                     │
│    - 실행 상태 캐싱 (반복 실행 시 성능 최적화)                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**소스 검증:**
```cpp
// VectorVMTypes.h:23
struct FVectorVMState
{
    uint8* Bytecode;                    // 최적화된 바이트코드
    uint32 NumBytecodeBytes;            // 바이트코드 크기

    FVecReg* ConstantBuffers;           // 상수 버퍼 (SIMD 레지스터)
    FVectorVMExtFunctionData* ExtFunctionTable;  // 외부 함수 테이블
    int32* NumOutputPerDataSet;         // 데이터셋별 출력 개수

    // 레지스터 매핑 테이블
    uint16* ConstRemapTable;
    uint16* InputRemapTable;
    uint16* InputDataSetOffsets;
    uint8*  OutputRemapDataSetIdx;
    uint16* OutputRemapDataType;
    uint16* OutputRemapDst;

    // 캐시
    uint8*  ConstMapCacheIdx;
    uint16* ConstMapCacheSrc;
    uint8*  InputMapCacheIdx;
    uint16* InputMapCacheSrc;
    int32   NumInstancesExecCached;

    uint32 Flags;
    uint32 NumExtFunctions;
    uint32 MaxExtFnRegisters;
    uint32 NumTempRegisters;
    uint32 NumConstBuffers;
    uint32 NumInputBuffers;
    uint32 NumInputDataSets;
    uint32 NumOutputsRemapped;
    uint32 NumOutputBuffers;
    uint32 MaxOutputDataSet;
    uint32 NumDummyRegsRequired;

    uint32 BatchOverheadSize;
    uint32 ChunkLocalDataOutputIdxNumBytes;
    uint32 ChunkLocalNumOutputNumBytes;
    uint32 ChunkLocalOutputMaskIdxNumBytes;

    uint64 OptimizerHashId;
    uint32 TotalNumBytes;
};
```

---

##### 2. FVectorVMBatchState - 배치별 실행 상태
**📂 위치:** `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp:51`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      FVectorVMBatchState                                │
│  (배치별 실행 상태 - 멀티스레드 안전)                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  Public:                                                                │
│    - RegisterData : FVecReg* (16-byte aligned)                         │
│      // 임시 레지스터 데이터 (배치별 독립)                               │
│                                                                         │
│    - RegPtrTable : uint8*[TotalRegs]                                   │
│      // 레지스터 포인터 테이블                                           │
│      // [Temp0, Temp1, ..., Const0, ..., Input0, ..., Output0, ...]   │
│                                                                         │
│    - RegIncTable : uint8[TotalRegs]                                    │
│      // 레지스터 증분 테이블                                             │
│      // 0 = 상수 (포인터 고정, 브로드캐스트)                             │
│      // 16 = 임시/입출력 (FVecReg 크기만큼 증가)                         │
│                                                                         │
│    - OutputMaskIdx : uint8*                                            │
│      // 출력 마스크 인덱스 (acquireindex 결과)                           │
│                                                                         │
│    - ChunkLocalData : struct                                           │
│      // Chunk별 로컬 데이터                                             │
│      ├─ StartingOutputIdxPerDataSet : uint32*                          │
│      ├─ NumOutputPerDataSet : uint32*                                  │
│      ├─ OutputMaskIdx : uint8**                                        │
│      ├─ ExtFnDecodedReg : struct (외부 함수용)                          │
│      ├─ RandCounters : int32*                                          │
│      ├─ ChunkIdx : int                                                 │
│      ├─ StartInstanceThisChunk : int                                   │
│      └─ NumInstancesThisChunk : int                                    │
│                                                                         │
│    - RandState : union                                                 │
│      // xorwow 랜덤 상태 (State[5] + Counters)                         │
│    - RandStream : FRandomStream                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

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

---

##### 3. FVecReg - SIMD 레지스터 Union
**📂 위치:** `Engine/Source/Runtime/VectorVM/Private/VectorVMTypes.h:12`

```cpp
// VectorVMTypes.h:12
union FVecReg
{
    VectorRegister4f v;  // 4x float (SSE/NEON 사용)
    VectorRegister4i i;  // 4x int32 (SSE/NEON 사용)
};
```

**특징:**
- **128비트 SIMD 레지스터**: 4개의 float 또는 int를 동시 처리
- **타입 중립적**: float와 int를 동일한 메모리 공간에서 처리 (비트캐스트)
- **플랫폼별 구현**: SSE `__m128` (x86/x64), NEON `float32x4_t` (ARM)

---

##### 4. EVectorVMOp - OpCode 열거형
**📂 위치:** `Engine/Source/Runtime/VectorVM/Public/VectorVM.h:236`

```cpp
// VectorVM.h:236
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
    acquireindex,              // 86: 인덱스 획득 (조건부 출력)
    external_func_call,        // 87: 외부 함수 호출 (DataInterface)
    exec_index,                // 88: 실행 인덱스

    // 병합된 최적화 명령 (98~178)
    exec_indexf,               // 98: exec_index + i2f
    exec_index_addi,           // 99: exec_index + addi
    cmplt_select,              // 100: cmplt + select
    mad_add,                   // 130: mad + add
    mul_mad0,                  // 137: mul -> mad (첫 번째 인자)
    sin_cos,                   // 176: sin과 cos 동시 계산

    NumOpcodes
};
```

**OpCode 통계:**
- **총 179개 OpCode**: 기본 연산 (~25개) + 병합 최적화 연산 (~75개) + 특수 명령 (~79개)
- **8비트 크기**: 메모리 효율적
- **병합 연산 (Merged Ops)**: 자주 연결되는 명령을 하나로 결합하여 디스패치 오버헤드 감소

**바이트코드 인코딩:**

```
┌────────────────────────────────────────────────────────┐
│           ByteCode Encoding                            │
├────────────────────────────────────────────────────────┤
│                                                        │
│  add OpCode:                                           │
│  ┌────────┬──────────┬──────────┬──────────┐          │
│  │ OpCode │ Src0:16b │ Src1:16b │ Dst:16b  │          │
│  │  0x01  │  idx0    │  idx1    │  idx2    │          │
│  └────────┴──────────┴──────────┴──────────┘          │
│  → RegPtrTable[idx2] = RegPtrTable[idx0] + [idx1]     │
│                                                        │
│  external_func_call OpCode:                            │
│  ┌────────┬─────────────┬────────┬────────┐           │
│  │ OpCode │ FuncIndex   │NumInput│NumOutput│          │
│  │  0x57  │  0x0005     │  0x02  │  0x01  │           │
│  └────────┴─────────────┴────────┴────────┘           │
│  → Call FunctionTable[5] with 2 inputs, 1 output      │
└────────────────────────────────────────────────────────┘
```

---

##### 5. FNiagaraScriptExecutionContext - VM 실행 컨텍스트
**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraScriptExecutionContext.h:128`

**역할:** VM 실행에 필요한 모든 데이터를 소유하고, 실행을 조율 (Orchestrate)

```cpp
struct FNiagaraScriptExecutionContextBase
{
    UNiagaraScript* Script;
    VectorVM::Runtime::FVectorVMState* VectorVMState = nullptr;

    TArray<const FVMExternalFunction*> FunctionTable;
    TArray<void*> UserPtrTable;  // DataInterface Instance Data
    FNiagaraScriptInstanceParameterStore Parameters;
    TArray<FNiagaraDataSetExecutionInfo, TInlineAllocator<2>> DataSetInfo;
    ENiagaraSystemSimulationScript ScriptType;

    int32 HasInterpolationParameters : 1;
    int32 bAllowParallel : 1;
    int32 bHasDIsWithPreStageTick : 1;
    int32 bHasDIsWithPostStageTick : 1;
};
```

**Execute 플로우:**
```cpp
// NiagaraScriptExecutionContext.cpp
bool FNiagaraScriptExecutionContextBase::Execute(
    FNiagaraSystemInstance* Instance,
    float DeltaSeconds,
    uint32 NumInstances,
    const FScriptExecutionConstantBufferTable& ConstantBufferTable)
{
    // 1. Constant Buffer 준비
    TArray<const uint8*> ConstantBuffers;
    ConstantBuffers.Add(reinterpret_cast<const uint8*>(&DeltaSeconds));
    ConstantBuffers.Add(Parameters.GetParameterDataArray().GetData());

    // 2. DataSet 바인딩
    for (FNiagaraDataSetExecutionInfo& DataSet : DataSetInfo)
    {
        DataSet.Init(...);
    }

    // 3. VM 실행
    VectorVM::Exec(VectorVMState, NumInstances, ConstantBuffers,
                   DataSetInfo, FunctionTable, UserPtrTable);

    return true;
}
```

---

##### 6. FVectorVMExternalFunctionContext - External Function 호출 컨텍스트
**📂 위치:** `Engine/Source/Runtime/VectorVM/Public/VectorVM.h:315`

**역할:** DataInterface 함수가 VM 데이터에 접근할 수 있는 인터페이스

```cpp
class FVectorVMExternalFunctionContext
{
public:
    uint32** RegisterData;      // 입력/출력 레지스터 배열
    uint8* RegInc;              // Constant: 0, Register: sizeof(FVecReg)
    int RegReadCount;
    int NumRegisters;
    int StartInstance;
    int NumInstances;
    int NumLoops;               // NumInstances / 4 (SIMD width)
    int PerInstanceFnInstanceIdx;
    void** UserPtrTable;        // DataInterface Instance Data
    int NumUserPtrs;
    FRandomStream* RandStream;
    TArrayView<FDataSetMeta> DataSets;

    float* GetNextRegister(int32* OutAdvanceOffset);
    void* GetUserPtrTable(int32 UserPtrIdx);
    FRandomStream& GetRandStream();
};
```

---

##### 7. FDataSetMeta - DataSet 접근 메타데이터
**📂 위치:** `Engine/Source/Runtime/VectorVM/Public/VectorVM.h:246`

**역할:** VM이 Particle DataSet을 읽고 쓸 수 있도록 메타데이터 제공

```cpp
struct FDataSetMeta
{
    using FInputRegisterView = TArrayView<uint8 const* RESTRICT const>;
    using FOutputRegisterView = TArrayView<uint8* RESTRICT const>;

    FInputRegisterView InputRegisters;
    FOutputRegisterView OutputRegisters;

    uint32 InputRegisterTypeOffsets[3];   // Float, Int, Half
    uint32 OutputRegisterTypeOffsets[3];

    int32 DataSetAccessIndex;
    int32 InstanceOffset;

    TArray<int32>* IDTable;
    TArray<int32>* FreeIDTable;
    TArray<int32>* SpawnedIDsTable;
    int32* NumFreeIDs;
    int32* MaxUsedID;
    int32* NumSpawnedIDs;
    int32 IDAcquireTag;
};
```

**DataSet 레지스터 매핑 (SoA 레이아웃):**

```
┌──────────────────────────────────────────────────────────┐
│          Particle DataSet Layout (SoA)                   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  InputRegisters[0] → Particles.Position.X Buffer         │
│  InputRegisters[1] → Particles.Position.Y Buffer         │
│  InputRegisters[2] → Particles.Position.Z Buffer         │
│  InputRegisters[3] → Particles.Velocity.X Buffer         │
│  InputRegisters[4] → Particles.Velocity.Y Buffer         │
│  InputRegisters[5] → Particles.Velocity.Z Buffer         │
│  ...                                                     │
│                                                          │
│  OutputRegisters[0] → Updated Position.X Buffer          │
│  OutputRegisters[1] → Updated Position.Y Buffer          │
│  OutputRegisters[2] → Updated Position.Z Buffer          │
│  ...                                                     │
│                                                          │
│  VM OpCode 예시:                                         │
│  inputdata_float R0, InputRegister=0  // Read Pos.X      │
│  inputdata_float R1, InputRegister=3  // Read Vel.X      │
│  add R2, R0, R1                       // NewPos = Pos+Vel │
│  outputdata_float R2, OutputRegister=0 // Write Pos.X    │
└──────────────────────────────────────────────────────────┘
```

---

#### 🔄 계층별 실행 메커니즘 상세 분석
##### 1. ExecVectorVMState - 최상위 실행 함수
**📂 위치:** `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp:2182`

**역할:** VectorVM 실행의 진입점

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

    // 4. 상수 버퍼 설정 (VectorIntSet1로 4-wide 복제)
    for (uint32 i = 0; i < ExecCtx->VVMState->NumConstBuffers; ++i)
    {
        ExecCtx->VVMState->ConstantBuffers[i].i = VectorIntSet1(
            ((uint32*)ExecCtx->ConstantTableData[...])[...]
        );
    }

    // 5. Batch/Chunk 분할 계산 (인스턴스 개수 변경 시에만)
    if (ExecCtx->NumInstances != ExecCtx->VVMState->NumInstancesExecCached)
    {
        static const uint32 MaxChunksPerBatch = 4;  // 2의 거듭제곱 필수
        size_t PageSizeInBytes = (uint64_t)GVVMPageSizeInKB << 10;  // 기본 64KB
        const uint32 TotalNumLoopsRequired = ((ExecCtx->NumInstances + 3) >> 2);
        // ... MaxLoopsPerChunk, PerBatchRegisterDataBytesRequired 계산
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

##### 2. SetupBatchStatePtrs - 레지스터 포인터 테이블 설정
**📂 위치:** `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp:314`

**역할:** BatchState의 메모리 레이아웃 및 레지스터 포인터 테이블 설정

```cpp
// RegPtrTable의 레이아웃
// [0 ~ NumTempRegisters-1]              : 임시 레지스터 포인터
// [NumTempRegisters ~ +NumConstBuffers] : 상수 버퍼 포인터
// [... ~ +NumInputBuffers]              : 입력 버퍼 포인터 (1차)
// [... ~ +NumInputBuffers]              : 입력 버퍼 포인터 (2차, 청크 시작용)
// [... ~ +NumOutputBuffers]             : 출력 버퍼 포인터

// 임시 레지스터
for (uint32 i = 0; i < NumTempRegisters; ++i)
{
    TempRegPtr[i] = (uint32*)(BatchState->RegisterData + i * NumLoops);
    RegIncTable[i] = sizeof(FVecReg);  // 16바이트
}

// 상수 레지스터 (증분 = 0, 브로드캐스트)
for (uint32 i = 0; i < NumConstBuffers; ++i)
{
    ConstBuffPtr[i] = (uint32*)(ExecCtx->VVMState->ConstantBuffers + i);
    RegIncTable[ConstantRegisterIndex] = 0;
}

// 입력 레지스터 (noadvance: 증분=0, 일반: 증분=DataTypeStride)
for (uint32 i = 0; i < NumInputBuffers; ++i)
{
    bool bNoAdvanceInput = InputMapSrcIdx & 0x8000;
    bool bHalfInput = InputMapSrcIdx & 0x4000;

    if (bNoAdvanceInput)
    {
        InputPtr[i] = (uint32*)(ConstantBuffers + NumConstBuffers + NoAdvCounter++);
        RegIncTable[InputRegisterIndex] = 0;
    }
    else
    {
        uint32 DataTypeStride = bHalfInput ? 2 : 4;
        InputPtr[i] = (uint32*)(DataSetInputBuffers[...] + InstanceOffset * DataTypeStride);
        RegIncTable[InputRegisterIndex] = DataTypeStride;
    }

    // 두 번째 복사본 (청크 시작 위치 복원용)
    InputPtr[i + NumInputBuffers] = InputPtr[i];
}
```

---

##### 3. ExecChunkMultipleLoops - 바이트코드 실행 루프
**📂 위치:** `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp` (매크로 생성)

**역할:** 바이트코드를 읽고 SIMD 함수로 디스패치

```cpp
void ExecChunkMultipleLoops(FVectorVMExecContext* ExecCtx,
                            FVectorVMBatchState* BatchState,
                            int NumLoops)
{
    const uint8* InsPtr = ExecCtx->VVMState->Bytecode;

    while (true)
    {
        uint8 OpCode = *InsPtr++;

        switch (OpCode)
        {
            case EVectorVMOp::done:
                return;

            case EVectorVMOp::add:
                InsPtr = VVM_Dispatch_execFn2f_1f(
                    true, InsPtr, BatchState, ExecCtx,
                    VVM_Exec2f_add, NumLoops
                );
                break;

            case EVectorVMOp::mad:
                InsPtr = VVM_Dispatch_execFn3f_1f(
                    true, InsPtr, BatchState, ExecCtx,
                    VVM_Exec3f_mad, NumLoops
                );
                break;

            case EVectorVMOp::outputdata_float:
                InsPtr = VVM_Output32(true, InsPtr, BatchState, ExecCtx);
                break;

            case EVectorVMOp::external_func_call:
                // DataInterface 함수 호출
                CallExternalFunction(InsPtr, BatchState, ExecCtx);
                break;

            // ... 나머지 OpCode들
        }
    }
}
```

---

##### 4. VVM_Dispatch_execFn2f_1f - 디스패치 함수
**📂 위치:** `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp:1585`

**역할:** 레지스터에서 데이터를 읽고, SIMD 함수를 호출하고, 결과를 저장

```cpp
VM_FORCEINLINE const uint8* VVM_Dispatch_execFn2f_1f(
    const bool CT_MultipleLoops,  // 컴파일 타임 상수
    const uint8* InsPtr,
    FVectorVMBatchState* BatchState,
    FVectorVMExecContext* ExecCtx,
    VVMFn_2f fn,                  // 예: VVM_Exec2f_add
    int NumLoops
)
{
    // 1. 레지스터 인덱스 디코딩
    uint16* RegIndices = (uint16*)InsPtr;

    // 2. 레지스터 포인터 가져오기
    uint8* P0 = BatchState->RegPtrTable[RegIndices[0]];  // 소스 0
    uint8* P1 = BatchState->RegPtrTable[RegIndices[1]];  // 소스 1
    uint8* P2 = BatchState->RegPtrTable[RegIndices[2]];  // 목적지

    if (CT_MultipleLoops)
    {
        // 3. 레지스터 증분 가져오기
        uint32 Inc0 = (uint32)BatchState->RegIncTable[RegIndices[0]];
        uint32 Inc1 = (uint32)BatchState->RegIncTable[RegIndices[1]];
        // Inc = 0:  상수 (포인터 이동 안 함)
        // Inc = 16: 임시 레지스터 (FVecReg 크기만큼 이동)

        uint8* End = P2 + sizeof(FVecReg) * NumLoops;

        // 4. 루프 실행 (4-wide 단위)
        do
        {
            VectorRegister4f R0 = VectorLoad((float*)P0);
            VectorRegister4f R1 = VectorLoad((float*)P1);
            P0 += Inc0;
            P1 += Inc1;

            VectorRegister4f Res = fn(BatchState, R0, R1);

            VectorStore(Res, (float*)P2);
            P2 += sizeof(FVecReg);  // 목적지는 항상 임시 레지스터
        } while (P2 < End);
    }
    else  // 단일 루프 (NumLoops == 1)
    {
        VectorRegister4f R0 = VectorLoad((float*)P0);
        VectorRegister4f R1 = VectorLoad((float*)P1);
        VectorRegister4f Res = fn(BatchState, R0, R1);
        VectorStore(Res, (float*)P2);
    }

    return InsPtr + 7;  // 3개의 16비트 인덱스 + 정렬
}
```

**핵심 최적화:**
- **컴파일 타임 분기**: `CT_MultipleLoops`로 루프 여부를 컴파일 타임에 결정
- **강제 인라인**: `VM_FORCEINLINE`으로 함수 호출 오버헤드 제거
- **상수 최적화**: Inc==0이면 포인터 이동 생략 (브로드캐스트 효과)

---

##### 5. VVM_Exec2f_add - 실제 SIMD 연산
**📂 위치:** `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp:1906`

```cpp
VM_FORCEINLINE VectorRegister4f VVM_Exec2f_add(
    FVectorVMBatchState* BatchState,
    VectorRegister4f a,
    VectorRegister4f b)
{
    return VectorAdd(a, b);
}
```

**플랫폼별 구현:**
```cpp
// x64 (SSE)
#define VectorAdd(a, b)  _mm_add_ps(a, b)
// → addps xmm0, xmm1  (128비트 4x float 덧셈, 1 사이클)

// ARM (NEON)
#define VectorAdd(a, b)  vaddq_f32(a, b)
// → vadd.f32 q0, q1, q2  (128비트 4x float 덧셈)
```

---

#### ⚙️ SIMD 최적화 기법 (SIMD Optimizations)
##### 1. 4-wide 병렬 처리
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

##### 2. 레지스터 증분 테이블 (Register Increment Table)
```cpp
// RegIncTable 값
// 0:  상수 레지스터 (포인터 이동 안 함, 브로드캐스트)
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

    VectorRegister4f Res = VectorAdd(R0, R1);
    VectorStore(Res, (float*)P2);
    P2 += 16;
} while (...);
```

**효과:**
- **상수 브로드캐스트 자동 처리**: 상수는 한 번 로드하면 모든 루프에서 재사용
- **분기 제거**: Inc 값이 0인지 검사하는 if문 불필요

---

##### 3. 병합 명령어 (Fused/Merged Operations)
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
    VectorRegister4f c, VectorRegister4f d)
{
    VectorRegister4f mad_result = VectorMultiplyAdd(a, b, c);
    return VectorAdd(mad_result, d);
}
```

**예시 2: `sin_cos` (OpCode 176)**

```cpp
// 원래 코드 (2개 명령, R0를 두 번 읽음)
sin  R0, R1   // R1 = sin(R0)
cos  R0, R2   // R2 = cos(R0)

// 병합 코드 (1개 명령, R0를 한 번만 읽음)
sin_cos  R0, R1, R2   // R1 = sin(R0), R2 = cos(R0)

// 구현
const uint8* VVM_sin_cos(const bool CT_MultipleLoops, ...)
{
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
    return InsPtr + 7;
}
```

**성능 향상 요약:**

```
기존 방식 (3개 OpCode):
  Temp1 = A * B       // OpCode: mul (디스패치 1)
  Temp2 = Temp1 + C   // OpCode: add (디스패치 2)
  Temp3 = Temp2 + D   // OpCode: add (디스패치 3)
  → 3번 디스패치 오버헤드

병합 방식 (1개 OpCode):
  Result = (A * B + C) + D  // OpCode: mad_add
  → 1번 디스패치
  → 디스패치 오버헤드: 66% 감소
  → 레지스터 R/W: 50% 감소
  → 실행 시간: ~40% 단축
```

---

##### 4. 출력 마스크 테이블 (Output Mask Table) / acquireindex
`acquireindex` 명령은 조건부 출력을 위한 마스크를 생성합니다.

```cpp
// VVM_PSHUFB_OUTPUT_TABLE - 출력 셔플 테이블
// 하위 4비트가 4개 인스턴스의 출력 여부를 나타냄
// 0001 (1): 첫 번째만 출력
// 0101 (5): 첫 번째와 세 번째 출력
// 1111 (15): 모두 출력

// 사용 예시
uint8 TblIdx = *TblIdxPtr++;  // 예: 5 (0101 = 첫 번째와 세 번째 출력)
VectorRegister4i Mask = ((VectorRegister4i*)VVM_PSHUFB_OUTPUT_TABLE)[TblIdx];
VectorRegister4i Src = VectorIntLoad(SrcPtr);
VectorRegister4i Val = VVM_pshufb(Src, Mask);  // [Src[0], Src[2], ?, ?]
VectorIntStore(Val, DstPtr);
DstPtr += VVM_OUTPUT_ADVANCE_TABLE[TblIdx];  // TblIdx=5 → +8바이트 (2개 출력)
```

**효과:**
- **조건부 출력 최적화**: if문 없이 SIMD 셔플 명령어로 처리 (분기 제거)
- **메모리 패킹**: 출력 데이터가 연속적으로 패킹됨
- **파이프라인 정체 없음**: 분기 예측 실패 원천 차단

---

#### 💡 실전 예시 (Practical Examples)
##### 예시 1: 파티클 위치 업데이트
**Niagara 스크립트:**

```
Particle Update:
  Position = Position + Velocity * DeltaTime
```

**컴파일된 바이트코드 (의사 코드):**

```
[OpCode: mul, Src0=Velocity, Src1=DeltaTime, Dst=Temp0]
[OpCode: add, Src0=Position, Src1=Temp0, Dst=Position]
```

**실행 흐름 (10000 파티클):**

```cpp
// 1. mul 명령 디코딩
P0 = RegPtrTable[VelocityRegIdx]   // Velocity 입력 버퍼 (Inc=16)
P1 = RegPtrTable[DeltaTimeRegIdx]  // DeltaTime 상수 버퍼 (Inc=0)
P2 = RegPtrTable[Temp0RegIdx]      // Temp0 임시 레지스터 (Inc=16)

NumLoops = (10000 + 3) / 4  // = 2500 루프

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
    VectorStore(Res, (float*)P2);
    P2 += 16;
}

// 2. add 명령도 동일한 방식으로 실행
```

**성능:**
- 스칼라: 10000번 반복 x 2 연산 = 20000회
- VectorVM: 2500번 반복 x 2 OpCode = 5000회 (4배 빠름!)

---

##### 예시 2: 조건부 파티클 제거
**Niagara 스크립트:**

```
Particle Update:
  if (Age > Lifetime)
  {
      KillParticle();
  }
```

**실행 예시 (4개 파티클):**

```cpp
// 1. 마스크 생성
Age = {1.5f, 0.8f, 2.3f, 0.5f};
Lifetime = {1.0f, 1.0f, 1.0f, 1.0f};

Mask = VectorCmpGT(Age, Lifetime);
// → {0xFFFFFFFF, 0, 0xFFFFFFFF, 0}  (파티클 0, 2가 조건 만족)

// 2. acquireindex 실행
int Count = __popcnt(Mask);  // = 2
int OutIdx = AtomicAdd(&GlobalDeadCount, 2);  // = 47

// 3. 조건부 출력 (SIMD select 사용, 분기 없음!)
DeadParticles[47] = 0;  // 파티클 0 (Age=1.5)
DeadParticles[48] = 2;  // 파티클 2 (Age=2.3)
```

---

##### 예시 3: External Function Call (DataInterface)
**바이트코드:**
```
inputdata_int32 R0, InputRegister=10  // Particles.TriangleIndex
external_func_call FuncID=5, NumInputs=1, NumOutputs=3
outputdata_float R1, OutputRegister=0 // Particles.SampledPos.X
outputdata_float R2, OutputRegister=1 // Particles.SampledPos.Y
outputdata_float R3, OutputRegister=2 // Particles.SampledPos.Z
done
```

**External Function 구현:**
```cpp
void UNiagaraDataInterfaceStaticMesh::GetTrianglePosition(
    FVectorVMExternalFunctionContext& Context)
{
    VectorVM::FUserPtrHandler<FNDIStaticMesh_InstanceData> InstData(Context);
    VectorVM::FExternalFuncInputHandler<int32> TriIndexParam(Context);
    VectorVM::FExternalFuncRegisterHandler<float> OutPosX(Context);
    VectorVM::FExternalFuncRegisterHandler<float> OutPosY(Context);
    VectorVM::FExternalFuncRegisterHandler<float> OutPosZ(Context);

    for (int32 i = 0; i < Context.GetNumLoops<4>(); ++i)
    {
        for (int32 j = 0; j < 4; ++j)
        {
            int32 TriIndex = TriIndexParam.GetAndAdvance();
            FVector TriPos = InstData->GetTrianglePosition(TriIndex);

            *OutPosX.GetDestAndAdvance() = TriPos.X;
            *OutPosY.GetDestAndAdvance() = TriPos.Y;
            *OutPosZ.GetDestAndAdvance() = TriPos.Z;
        }
    }
}
```

---

##### 예시 4: 병렬 실행 (TaskGraph 통합)
```cpp
void FNiagaraSystemInstance::Tick_GameThread(float DeltaSeconds)
{
    if (bAllowParallel && Emitters.Num() > 1)
    {
        FGraphEventArray Tasks;
        for (FNiagaraEmitterInstance* Emitter : Emitters)
        {
            FGraphEventRef Task = FFunctionGraphTask::CreateAndDispatchWhenReady(
                [Emitter, DeltaSeconds]()
                {
                    Emitter->ExecuteParticleUpdate(DeltaSeconds);
                },
                TStatId(), nullptr, ENamedThreads::AnyThread
            );
            Tasks.Add(Task);
        }
        FTaskGraphInterface::Get().WaitUntilTasksComplete(Tasks);
    }
    else
    {
        for (FNiagaraEmitterInstance* Emitter : Emitters)
        {
            Emitter->ExecuteParticleUpdate(DeltaSeconds);
        }
    }
}
```

---

#### 📊 성능 최적화 (Performance Optimization)
##### stat 명령어
```
stat VectorVM           // VectorVM 통계
stat Particles          // 파티클 개수
stat NiagaraDetailed    // External Function별 시간 확인
```

**주요 지표:**
- **VectorVM Exec Time**: 바이트코드 실행 시간 (목표: < 2ms)
- **Particle Count**: 파티클 개수 (목표: < 50만)
- **Bytecode Size**: 바이트코드 크기 (작을수록 캐시 친화적)

##### 해야 할 것
**1. 병합 명령어 활용:**
```hlsl
// 좋은 예: mad 패턴
float Result = A * B + C;  // → mad OpCode (단일 OpCode)

// 나쁜 예: 분리된 연산
float Temp = A * B;
float Result = Temp + C;  // → mul + add (2 OpCodes)
```

**2. 상수 최대한 활용:**
```hlsl
// 좋은 예: DeltaTime은 상수로 전달 (Inc=0, 브로드캐스트)
Particles.Position = Particles.Position + Particles.Velocity * Engine.DeltaTime;

// 나쁜 예: Per-particle 데이터 불필요 사용
float DT = 1.0f / 60.0f;  // 매 파티클 → 4배 메모리 대역폭 사용
```

**3. SoA 레이아웃 유지:**
```cpp
// 좋은 예: FNiagaraDataSet의 SoA 활용
float* PosX = DataSet->GetFloatBuffer(PositionX);
float* PosY = DataSet->GetFloatBuffer(PositionY);

// 나쁜 예: AoS로 변환 (캐시 미스 증가)
struct FParticle { FVector Pos; FVector Vel; };
TArray<FParticle> Particles;  // SIMD 활용 불가!
```

**4. SIMD 친화적 코드 작성:**
```hlsl
// 좋은 예: Component-wise 연산 (마스크 기반 조건부 실행)
Mask = (Age > Lifetime) && (Type == 0);
Result = select(Mask, ValueA, ValueB);

// 나쁜 예: 깊은 분기 (SIMD lane 낭비)
if (Age > Lifetime)
{
    if (Type == 0) { /* ... */ }
    else { /* ... */ }
}
```

**5. 레지스터 재사용:**
```
// 좋은 예: 중간 결과를 Particles Attribute에 저장하여 레지스터 절약
Particles.TempA = (A * B) + (C * D);
Particles.TempB = (E * F) + (G * H);
float Result = Particles.TempA * Particles.TempB;
// → 4 temp registers per stage

// 나쁜 예: 모든 계산을 한 표현식에
float Result = (((A * B) + (C * D)) * ((E * F) + (G * H)));
// → 12+ temp registers
```

##### 피해야 할 것
**1. 느린 연산:**
```
피해야 할 것:
  - div (나눗셈) → rsq + mul 사용
  - pow (거듭제곱) → exp + log 조합

대안:
  Result = A / B  →  Result = A * (1.0 / B)  (B가 상수일 때)
  Result = pow(A, 2)  →  Result = A * A
```

**2. External Function 남용:**
```cpp
// 나쁜 예: 매 파티클마다 External Function 호출
// → Function call overhead + Cache miss (random mesh access)
// → ~10-100배 느림 (OpCode 대비)

// 좋은 예: Batch 처리
TArray<FVector> Positions;
SampleStaticMeshBatch(TriIndices, Positions);
```

**3. 불필요한 Type Conversion:**
```hlsl
// 나쁜 예: 반복적인 변환
int Index = (int)Particles.ID;
float Value = (float)Index;
Particles.CustomData = Value * Scale;
// → f2i + i2f OpCode (불필요)

// 좋은 예: 변환 최소화
float Value = Particles.ID;  // Already float
Particles.CustomData = Value * Scale;
```

---

#### 🐛 디버깅 및 트러블슈팅 (Debugging & Troubleshooting)
##### 바이트코드 디스어셈블리
```cpp
// VMExecutableData에서 Assembly 확인
FString Assembly = VMExecutableData.LastAssemblyTranslation;

// 출력:
//   0: inputdata_float R0, DataSetIdx=0, RegIdx=0
//   4: inputdata_float R1, DataSetIdx=0, RegIdx=3
//   8: add R2, R0, R1
//  12: outputdata_float R2, DataSetIdx=0, RegIdx=0
//  16: done

// 파일로 저장
FFileHelper::SaveStringToFile(Assembly, TEXT("D:/VM_Assembly.txt"));

// OpCode별 디스어셈블리
UNiagaraScript* Script = Emitter->GetUpdateScript();
const TArray<uint8>& Bytecode = Script->GetVMExecutableData().ByteCode;
UE_LOG(LogNiagara, Log, TEXT("Bytecode Size: %d"), Bytecode.Num());

for (int32 i = 0; i < Bytecode.Num();)
{
    EVectorVMOp OpCode = (EVectorVMOp)Bytecode[i++];
    UE_LOG(LogNiagara, Log, TEXT("OpCode: %s"), *UEnum::GetValueAsString(OpCode));
}
```

##### 레지스터 덤프 (Runtime)
```cpp
void DumpRegisters(VectorVM::Runtime::FVectorVMState* State, int32 InstanceIdx)
{
    for (int32 i = 0; i < State->NumTempRegisters; ++i)
    {
        float Value = State->TempRegisters[i][InstanceIdx];
        UE_LOG(LogNiagara, Log, TEXT("R%d[%d] = %f"), i, InstanceIdx, Value);
    }
}
```

##### External Function 프로파일링
```cpp
void ProfiledExternalFunction(FVectorVMExternalFunctionContext& Context)
{
    SCOPE_CYCLE_COUNTER(STAT_NiagaraDI_GetTriPosition);

    double StartTime = FPlatformTime::Seconds();
    ProcessExternalFunction(Context);
    double EndTime = FPlatformTime::Seconds();

    UE_LOG(LogNiagara, Warning, TEXT("ExternalFunc took %.4f ms"),
           (EndTime - StartTime) * 1000.0);
}
// stat NiagaraDetailed → External Function별 시간 확인
```

##### SIMD 정렬 확인
```cpp
void CheckAlignment()
{
    for (int32 i = 0; i < DataSet->GetNumBuffers(); ++i)
    {
        uint8* Buffer = DataSet->GetComponentPtrFloat(i);
        uintptr_t Address = reinterpret_cast<uintptr_t>(Buffer);

        if ((Address % 16) != 0)
        {
            UE_LOG(LogNiagara, Error, TEXT("Buffer %d is not 16-byte aligned!"), i);
        }
    }
}
```

##### 흔한 에러와 해결 방법
**1. "VectorVM bytecode corruption"**
```
원인: 바이트코드 손상 또는 DDC 캐시 불일치

해결책:
  1. Edit → Delete Derived Data Cache
  2. Niagara 에셋 재컴파일
  3. 에디터 재시작
```

**2. "Invalid register index"**
```
원인: 레지스터 인덱스가 범위 초과 (너무 많은 임시 변수, 50개 제한)

해결책:
  - 그래프 단순화
  - Scratch Pad 함수 분리
  - 중간 결과를 Particles Attribute에 저장
```

**3. "External function not found"**
```
원인: DataInterface 함수 누락 또는 시그니처 불일치

해결책:
  - DataInterface 바인딩 확인
  - 플러그인 활성화 확인
  - C++ DataInterface 재컴파일
```

**4. "DataSet index X is invalid"**
```
원인: inputdata/outputdata OpCode의 잘못된 Register Index

디버깅:
  1. VMExecutableData.Attributes 배열 확인
  2. InputRegister/OutputRegister 매핑 검증
  3. DataSet Layout이 컴파일 시점과 동일한지 확인
```

---

#### 🎯 핵심 정리
##### 컴포넌트 요약
| 컴포넌트 | 역할 | 특징 |
|----------|------|------|
| **FNiagaraScriptExecutionContext** | VM 실행 오케스트레이터 | Parameters, FunctionTable, UserPtrTable 관리 |
| **FVectorVMState** | 전역 VM 실행 상태 | 바이트코드, 상수, 레지스터 매핑 |
| **FVectorVMBatchState** | 배치별 실행 상태 | 독립 레지스터 공간, 멀티스레드 안전 |
| **FVecReg** | SIMD 레지스터 Union | 128비트 (4x float/int) |
| **EVectorVMOp** | OpCode 정의 | 179개 OpCode (기본 + 병합) |
| **FVectorVMExternalFunctionContext** | External Function 인터페이스 | DataInterface 함수 호출 |
| **FDataSetMeta** | DataSet 접근 메타데이터 | SoA 기반 InputRegisters/OutputRegisters 매핑 |

---

#### 🔗 참조 자료 (References)
##### 소스 파일- `Engine/Source/Runtime/VectorVM/Public/VectorVM.h:236` - EVectorVMOp 열거형 (179개 OpCode)
- `Engine/Source/Runtime/VectorVM/Public/VectorVM.h:49` - VVM_OP_XM_LIST 매크로
- `Engine/Source/Runtime/VectorVM/Public/VectorVM.h:315` - FVectorVMExternalFunctionContext
- `Engine/Source/Runtime/VectorVM/Public/VectorVM.h:246` - FDataSetMeta
- `Engine/Source/Runtime/VectorVM/Public/VectorVMRuntime.h` - 실행 컨텍스트
- `Engine/Source/Runtime/VectorVM/Private/VectorVMTypes.h:23` - FVectorVMState 구조체
- `Engine/Source/Runtime/VectorVM/Private/VectorVMTypes.h:12` - FVecReg union
- `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp:2182` - ExecVectorVMState() 함수
- `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp:314` - SetupBatchStatePtrs() 함수
- `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp:1585` - VVM_Dispatch_execFn2f_1f() 함수
- `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp:1906~` - VVM_Exec* SIMD 함수들
- `Engine/Source/Runtime/VectorVM/Private/Platforms/VectorVMPlatformGeneric.h` - 플랫폼별 SIMD 구현
- `Engine/Source/Runtime/VectorVM/Private/VectorVMOptimizer.cpp` - 바이트코드 최적화
- `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraScriptExecutionContext.h:128` - 실행 컨텍스트

##### 공식 문서- [Niagara Overview](https://docs.unrealengine.com/5.7/ko/overview-of-niagara-effects-for-unreal-engine/)
- [Optimizing Niagara Performance](https://docs.unrealengine.com/5.7/ko/optimizing-niagara-effects-in-unreal-engine/)
- [Intel Intrinsics Guide](https://software.intel.com/sites/landingpage/IntrinsicsGuide)

##### 관련 시스템- Niagara 파티클 시스템
- FRandomStream (랜덤 생성기)
- Unreal 플랫폼 추상화 (VectorRegister4f, VectorRegister4i)

##### 관련 문서- **[Compiler.md](Compiler.md)** - Niagara → VectorVM 바이트코드 컴파일 과정
- **[SimulationPipeline.md](SimulationPipeline.md)** - CPU/GPU 시뮬레이션 파이프라인
- **[Core/NiagaraScript.md](Core/NiagaraScript.md)** - UNiagaraScript 및 FNiagaraVMExecutableData


## Merged Notes (from Niagara/VM_Execution.md)

### VM Execution System (VM 실행 시스템)
#### 🧭 개요
Niagara VectorVM은 **SIMD 최적화된 바이트코드 인터프리터**로, CPU에서 파티클 시뮬레이션을 병렬 실행합니다.

**핵심 역할:**
- VM 바이트코드를 SIMD로 실행 (SSE/AVX)
- 4개 인스턴스를 동시에 처리 (VECTOR_WIDTH_FLOATS = 4)
- External Function (DataInterface) 호출
- DataSet Read/Write 관리

**📂 주요 위치:**
- `Engine/Source/Runtime/VectorVM/Public/VectorVM.h`
- `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp`
- `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraScriptExecutionContext.h`

---

#### 🧱 전체 실행 아키텍처
```
┌──────────────────────────────────────────────────────────────────────┐
│                    VM Execution Pipeline                             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Game Thread (GT)                                                    │
│  ┌────────────────────────────────────────┐                         │
│  │ FNiagaraScriptExecutionContext         │                         │
│  │  - Parameters (ParameterStore)         │                         │
│  │  - FunctionTable (External Functions)  │                         │
│  │  - UserPtrTable (DI Instance Data)     │                         │
│  └────────────────────────────────────────┘                         │
│                   │ Execute()                                        │
│                   ↓                                                  │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ VectorVM::Runtime::FVectorVMState                              │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ ByteCode Buffer                                          │  │ │
│  │  │  [add][R0][R1][R2][mul][R2][R3][R4]...                  │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ Register File (Temp Registers)                           │  │ │
│  │  │  R0: [f0, f1, f2, f3]  ← 4개 인스턴스 동시 처리         │  │ │
│  │  │  R1: [f0, f1, f2, f3]                                    │  │ │
│  │  │  R2: [f0, f1, f2, f3]                                    │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ Constant Table                                           │  │ │
│  │  │  [DeltaTime][Mass][Gravity]...                           │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ DataSet Input/Output                                     │  │ │
│  │  │  InputRegisters: Particles.Position, Velocity...         │  │ │
│  │  │  OutputRegisters: Updated Values                         │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                   │ Exec Loop (SIMD)                                │
│                   ↓                                                  │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ OpCode Dispatch                                                │ │
│  │  • add/sub/mul/div → SIMD Intrinsics (SSE/AVX)                │ │
│  │  • external_func_call → DataInterface 호출                    │ │
│  │  • inputdata_float → DataSet Read                             │ │
│  │  • outputdata_float → DataSet Write                           │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                   │                                                  │
│                   ↓                                                  │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Result: Updated Particle DataSet                               │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

---

#### 🔧 계층별 상세 분석
##### 1. **FNiagaraScriptExecutionContext - VM 실행 컨텍스트**
**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraScriptExecutionContext.h:128`

**역할:** VM 실행에 필요한 모든 데이터를 소유하고, 실행을 orchestrate.

**핵심 구조:**
```cpp
struct FNiagaraScriptExecutionContextBase
{
    // 실행할 스크립트
    UNiagaraScript* Script;

    // VM State (실제 바이트코드 실행기)
    VectorVM::Runtime::FVectorVMState* VectorVMState = nullptr;

    // External Function Table
    TArray<const FVMExternalFunction*> FunctionTable;

    // UserPtr Table (DataInterface Instance Data)
    TArray<void*> UserPtrTable;

    // Parameter Store (Constants, DataInterfaces, UObjects)
    FNiagaraScriptInstanceParameterStore Parameters;

    // DataSet Execution Info
    TArray<FNiagaraDataSetExecutionInfo, TInlineAllocator<2>> DataSetInfo;

    // Script Type
    ENiagaraSystemSimulationScript ScriptType;

    // Flags
    int32 HasInterpolationParameters : 1;
    int32 bAllowParallel : 1;
    int32 bHasDIsWithPreStageTick : 1;
    int32 bHasDIsWithPostStageTick : 1;
};
```

**Execute 플로우:**
```cpp
// NiagaraScriptExecutionContext.cpp
bool FNiagaraScriptExecutionContextBase::Execute(
    FNiagaraSystemInstance* Instance,
    float DeltaSeconds,
    uint32 NumInstances,
    const FScriptExecutionConstantBufferTable& ConstantBufferTable)
{
    // 1. Constant Buffer 준비
    TArray<const uint8*> ConstantBuffers;
    ConstantBuffers.Add(reinterpret_cast<const uint8*>(&DeltaSeconds));
    ConstantBuffers.Add(Parameters.GetParameterDataArray().GetData());

    // 2. DataSet 바인딩
    for (FNiagaraDataSetExecutionInfo& DataSet : DataSetInfo)
    {
        DataSet.Init(DataSet.DataSet, DataSet.Input, DataSet.StartInstance, DataSet.bUpdateInstanceCount);
    }

    // 3. VM 실행
    VectorVM::Exec(
        VectorVMState,
        NumInstances,
        ConstantBuffers,
        DataSetInfo,
        FunctionTable,
        UserPtrTable
    );

    return true;
}
```

---

##### 2. **VectorVM::Runtime::FVectorVMState - VM 실행 상태**
**📂 위치:** `Engine/Source/Runtime/VectorVM/Public/VectorVM.h:20`

**역할:** 바이트코드, 레지스터, OpCode 디스패치 테이블을 관리하는 핵심 VM.

**핵심 구조 (구현은 Private):**
```cpp
namespace VectorVM::Runtime
{
    struct FVectorVMState
    {
        // ByteCode Buffer
        const uint8* ByteCode;
        uint32 ByteCodeLength;

        // Register File (Temp Registers)
        float** TempRegisters;  // 각 레지스터는 float[4] 배열
        uint32 NumTempRegisters;

        // Constant Table
        const uint8** ConstantTablePtrs;
        uint32 NumConstants;

        // DataSet Registers
        FDataSetMeta* DataSets;
        uint32 NumDataSets;

        // External Function Table
        const FVMExternalFunction** ExternalFunctions;
        uint32 NumExternalFunctions;

        // Execution State
        uint32 PC;  // Program Counter
        uint32 NumInstancesProcessed;
    };
}
```

**OpCode 실행 예시:**
```cpp
// Conceptual pseudo-code (실제 구현은 SIMD Assembly)
void ExecuteOpCode(EVectorVMOp OpCode)
{
    switch (OpCode)
    {
    case EVectorVMOp::add:
    {
        uint8 Dst = ReadRegisterIndex();
        uint8 Src0 = ReadRegisterIndex();
        uint8 Src1 = ReadRegisterIndex();

        // SIMD Add (4개 동시 처리)
        __m128 A = _mm_load_ps(TempRegisters[Src0]);
        __m128 B = _mm_load_ps(TempRegisters[Src1]);
        __m128 Result = _mm_add_ps(A, B);
        _mm_store_ps(TempRegisters[Dst], Result);
        break;
    }

    case EVectorVMOp::mul:
    {
        // Similar SIMD multiplication
        break;
    }

    case EVectorVMOp::external_func_call:
    {
        uint16 FunctionIndex = ReadUInt16();
        CallExternalFunction(FunctionIndex);
        break;
    }
    }
}
```

---

##### 3. **EVectorVMOp - OpCode 정의**
**📂 위치:** `Engine/Source/Runtime/VectorVM/Public/VectorVM.h:49`

**역할:** VM이 실행할 수 있는 모든 명령어 정의.

**주요 OpCode 카테고리:**
```cpp
// VectorVM.h:236
enum class EVectorVMOp : uint8
{
    // Termination
    done = 0,                    // 실행 종료

    // Arithmetic (Float)
    add = 1,                     // Dst = Src0 + Src1
    sub = 2,                     // Dst = Src0 - Src1
    mul = 3,                     // Dst = Src0 * Src1
    div = 4,                     // Dst = Src0 / Src1
    mad = 5,                     // Dst = Src0 * Src1 + Src2
    lerp = 6,                    // Dst = lerp(Src0, Src1, Src2)

    // Math Functions
    rcp = 7,                     // Dst = 1.0 / Src
    rsq = 8,                     // Dst = 1.0 / sqrt(Src)
    sqrt = 9,                    // Dst = sqrt(Src)
    neg = 10,                    // Dst = -Src
    abs = 11,                    // Dst = abs(Src)
    exp = 12,                    // Dst = exp(Src)
    sin = 16,                    // Dst = sin(Src)
    cos = 17,                    // Dst = cos(Src)

    // Comparison (Float)
    cmplt = 37,                  // Dst = Src0 < Src1 ? 1 : 0
    cmple = 38,                  // Dst = Src0 <= Src1 ? 1 : 0
    cmpgt = 39,                  // Dst = Src0 > Src1 ? 1 : 0
    cmpeq = 41,                  // Dst = Src0 == Src1 ? 1 : 0

    // Integer Operations
    addi = 44,                   // Dst = Src0 + Src1 (int)
    muli = 46,                   // Dst = Src0 * Src1 (int)
    cmplti = 55,                 // Dst = Src0 < Src1 (int)

    // Bitwise
    bit_and = 61,                // Dst = Src0 & Src1
    bit_or = 62,                 // Dst = Src0 | Src1
    bit_lshift = 65,             // Dst = Src0 << Src1

    // Type Conversion
    f2i = 71,                    // Dst = (int)Src
    i2f = 72,                    // Dst = (float)Src

    // Input/Output
    inputdata_float = 77,        // Dst = Read from DataSet (float)
    inputdata_int32 = 78,        // Dst = Read from DataSet (int)
    outputdata_float = 83,       // Write to DataSet (float)
    outputdata_int32 = 84,       // Write to DataSet (int)

    // External Function Call
    external_func_call = 87,     // Call DataInterface function

    // Index Generation
    acquireindex = 86,           // Particle ID 할당
    exec_index = 88,             // Current execution index

    // Merged Ops (최적화용)
    mad_add = 130,               // (A * B + C) + D
    mul_add = 139,               // (A * B) + C
    i2f_mul = 159,               // (float)Src * Scale

    NumOpcodes
};
```

**OpCode 인코딩 예시:**
```
┌────────────────────────────────────────────────────────┐
│           ByteCode Encoding                            │
├────────────────────────────────────────────────────────┤
│                                                        │
│  add OpCode:                                           │
│  ┌────────┬────────┬────────┬────────┐                │
│  │ OpCode │  Dst   │  Src0  │  Src1  │                │
│  │  0x01  │  0x02  │  0x00  │  0x01  │                │
│  └────────┴────────┴────────┴────────┘                │
│  → R2 = R0 + R1                                        │
│                                                        │
│  external_func_call OpCode:                            │
│  ┌────────┬─────────────┬────────┬────────┐           │
│  │ OpCode │ FuncIndex   │NumInput│NumOutput│          │
│  │  0x57  │  0x0005     │  0x02  │  0x01  │           │
│  └────────┴─────────────┴────────┴────────┘           │
│  → Call FunctionTable[5] with 2 inputs, 1 output      │
└────────────────────────────────────────────────────────┘
```

---

##### 4. **FVectorVMExternalFunctionContext - External Function 호출 컨텍스트**
**📂 위치:** `Engine/Source/Runtime/VectorVM/Public/VectorVM.h:315`

**역할:** DataInterface 함수가 VM 데이터에 접근할 수 있는 인터페이스.

**핵심 구조:**
```cpp
class FVectorVMExternalFunctionContext
{
public:
    // Register Data (입력/출력 레지스터 배열)
    uint32** RegisterData;

    // Register Increment (Constant: 0, Register: 1)
    uint8* RegInc;

    int RegReadCount;
    int NumRegisters;

    // Instance Info
    int StartInstance;
    int NumInstances;
    int NumLoops;  // NumInstances / 4 (SIMD width)
    int PerInstanceFnInstanceIdx;

    // User Ptr Table (DataInterface Instance Data)
    void** UserPtrTable;
    int NumUserPtrs;

    // Random Number Generator
    FRandomStream* RandStream;

    // DataSets
    TArrayView<FDataSetMeta> DataSets;

    // Helper Functions
    float* GetNextRegister(int32* OutAdvanceOffset);
    void* GetUserPtrTable(int32 UserPtrIdx);
    FRandomStream& GetRandStream();
};
```

**External Function 예시:**
```cpp
// DataInterface 함수 구현
void UNiagaraDataInterfaceStaticMesh::GetTrianglePosition(
    FVectorVMExternalFunctionContext& Context)
{
    // 1. UserPtr 획득 (DI Instance Data)
    VectorVM::FUserPtrHandler<FNDIStaticMesh_InstanceData> InstData(Context);

    // 2. Input Register 획득 (Triangle Index)
    VectorVM::FExternalFuncInputHandler<int32> TriIndexParam(Context);

    // 3. Output Register 획득 (Position)
    VectorVM::FExternalFuncRegisterHandler<float> OutPosX(Context);
    VectorVM::FExternalFuncRegisterHandler<float> OutPosY(Context);
    VectorVM::FExternalFuncRegisterHandler<float> OutPosZ(Context);

    // 4. Loop (4개 인스턴스 동시 처리)
    for (int32 i = 0; i < Context.GetNumLoops<4>(); ++i)
    {
        // 각 인스턴스별로 처리
        for (int32 j = 0; j < 4; ++j)
        {
            int32 TriIndex = TriIndexParam.GetAndAdvance();
            FVector TriPos = InstData->GetTrianglePosition(TriIndex);

            *OutPosX.GetDestAndAdvance() = TriPos.X;
            *OutPosY.GetDestAndAdvance() = TriPos.Y;
            *OutPosZ.GetDestAndAdvance() = TriPos.Z;
        }
    }
}
```

---

##### 5. **FDataSetMeta - DataSet 접근 메타데이터**
**📂 위치:** `Engine/Source/Runtime/VectorVM/Public/VectorVM.h:246`

**역할:** VM이 Particle DataSet을 읽고 쓸 수 있도록 메타데이터 제공.

**핵심 구조:**
```cpp
struct FDataSetMeta
{
    using FInputRegisterView = TArrayView<uint8 const* RESTRICT const>;
    using FOutputRegisterView = TArrayView<uint8* RESTRICT const>;

    // Input Registers (Read from DataSet)
    FInputRegisterView InputRegisters;

    // Output Registers (Write to DataSet)
    FOutputRegisterView OutputRegisters;

    // Type별 Offset (Float, Int, Half)
    uint32 InputRegisterTypeOffsets[3];
    uint32 OutputRegisterTypeOffsets[3];

    // DataSet Access Index
    int32 DataSetAccessIndex;

    // Instance Offset (처리 시작 오프셋)
    int32 InstanceOffset;

    // Persistent ID Tables
    TArray<int32>* IDTable;
    TArray<int32>* FreeIDTable;
    TArray<int32>* SpawnedIDsTable;
    int32* NumFreeIDs;
    int32* MaxUsedID;
    int32* NumSpawnedIDs;
    int32 IDAcquireTag;
};
```

**DataSet Register 매핑:**
```
┌──────────────────────────────────────────────────────────┐
│          Particle DataSet Layout (SoA)                   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  InputRegisters[0] → Particles.Position.X Buffer         │
│  InputRegisters[1] → Particles.Position.Y Buffer         │
│  InputRegisters[2] → Particles.Position.Z Buffer         │
│  InputRegisters[3] → Particles.Velocity.X Buffer         │
│  InputRegisters[4] → Particles.Velocity.Y Buffer         │
│  InputRegisters[5] → Particles.Velocity.Z Buffer         │
│  ...                                                     │
│                                                          │
│  OutputRegisters[0] → Updated Position.X Buffer          │
│  OutputRegisters[1] → Updated Position.Y Buffer          │
│  OutputRegisters[2] → Updated Position.Z Buffer          │
│  ...                                                     │
│                                                          │
│  VM OpCode:                                              │
│  inputdata_float R0, InputRegister=0  // Read Pos.X      │
│  inputdata_float R1, InputRegister=3  // Read Vel.X      │
│  add R2, R0, R1                       // NewPos = Pos+Vel │
│  outputdata_float R2, OutputRegister=0 // Write Pos.X    │
└──────────────────────────────────────────────────────────┘
```

---

#### 🔄 실행 플로우 상세
```
┌──────────────────────────────────────────────────────────────────────┐
│               Complete VM Execution Sequence                         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Step 1: Context Initialization                                      │
│  ┌────────────────────────────────────────┐                         │
│  │ FNiagaraScriptExecutionContext::Init() │                         │
│  │  - Load ByteCode from VMExecutableData │                         │
│  │  - Allocate Temp Registers             │                         │
│  │  - Bind External Functions             │                         │
│  │  - Setup DataSet Mappings              │                         │
│  └────────────────────────────────────────┘                         │
│                   ↓                                                  │
│  Step 2: Parameter Binding                                           │
│  ┌────────────────────────────────────────┐                         │
│  │ Bind Constants to Constant Table       │                         │
│  │  - DeltaTime, Mass, Gravity 등         │                         │
│  │ Bind DataInterfaces to UserPtrTable    │                         │
│  │  - DI Index → Instance Data Pointer    │                         │
│  └────────────────────────────────────────┘                         │
│                   ↓                                                  │
│  Step 3: DataSet Binding                                             │
│  ┌────────────────────────────────────────┐                         │
│  │ Map Particle Attributes to Registers   │                         │
│  │  InputRegisters[0] = &Particles.Pos.X  │                         │
│  │  InputRegisters[1] = &Particles.Pos.Y  │                         │
│  │  OutputRegisters[0] = &Output.Pos.X    │                         │
│  └────────────────────────────────────────┘                         │
│                   ↓                                                  │
│  Step 4: VM Execution Loop                                           │
│  ┌────────────────────────────────────────┐                         │
│  │ for (Batch = 0; Batch < NumBatches; Batch++)                    │
│  │ {                                       │                         │
│  │   ProcessInstances = min(4, Remaining); │                         │
│  │   PC = 0;                               │                         │
│  │                                         │                         │
│  │   while (ByteCode[PC] != done)          │                         │
│  │   {                                     │                         │
│  │     OpCode = ByteCode[PC++];            │                         │
│  │     DispatchOpCode(OpCode);  // SIMD    │                         │
│  │   }                                     │                         │
│  │ }                                       │                         │
│  └────────────────────────────────────────┘                         │
│                   ↓                                                  │
│  Step 5: Result Write-back                                           │
│  ┌────────────────────────────────────────┐                         │
│  │ Flush OutputRegisters to DataSet       │                         │
│  │  - Particles.Position updated          │                         │
│  │  - Particles.Velocity updated          │                         │
│  └────────────────────────────────────────┘                         │
└──────────────────────────────────────────────────────────────────────┘
```

---

#### 💡 실전 예시
##### 예시 1: 간단한 Add Velocity 실행
**ByteCode:**
```
// Particle Update: Position += Velocity * DeltaTime

inputdata_float R0, InputRegister=0   // Particles.Position.X
inputdata_float R1, InputRegister=3   // Particles.Velocity.X
inputdata_float R2, ConstantIndex=0   // DeltaTime (from Constant Table)
mul R3, R1, R2                        // R3 = Velocity * DeltaTime
add R4, R0, R3                        // R4 = Position + R3
outputdata_float R4, OutputRegister=0 // Write to Particles.Position.X
done
```

**SIMD 실행 (4 Particles):**
```cpp
// Step 1: Load Inputs (SIMD)
__m128 PosX = _mm_load_ps(&InputRegisters[0][StartInstance]);  // [P0.x, P1.x, P2.x, P3.x]
__m128 VelX = _mm_load_ps(&InputRegisters[3][StartInstance]);  // [P0.vx, P1.vx, P2.vx, P3.vx]
__m128 DT = _mm_set1_ps(ConstantTable[0]);                     // [dt, dt, dt, dt]

// Step 2: Mul (SIMD)
__m128 Delta = _mm_mul_ps(VelX, DT);  // [P0.vx*dt, P1.vx*dt, P2.vx*dt, P3.vx*dt]

// Step 3: Add (SIMD)
__m128 NewPosX = _mm_add_ps(PosX, Delta);  // [P0.newX, P1.newX, P2.newX, P3.newX]

// Step 4: Store Output (SIMD)
_mm_store_ps(&OutputRegisters[0][StartInstance], NewPosX);
```

**성능:**
- 4개 파티클을 **단일 OpCode로 동시 처리**
- 1000 Particles = 250 SIMD Batches
- 전통적인 루프 대비 **~3-4배 빠름**

---

##### 예시 2: External Function Call (StaticMesh Sample)
**ByteCode:**
```
// Sample position from StaticMesh

inputdata_int32 R0, InputRegister=10  // Particles.TriangleIndex
external_func_call FuncID=5, NumInputs=1, NumOutputs=3, InputRegs=[R0], OutputRegs=[R1,R2,R3]
outputdata_float R1, OutputRegister=0 // Particles.SampledPos.X
outputdata_float R2, OutputRegister=1 // Particles.SampledPos.Y
outputdata_float R3, OutputRegister=2 // Particles.SampledPos.Z
done
```

**External Function 실행:**
```cpp
void DIStaticMesh_GetTriPosition(FVectorVMExternalFunctionContext& Context)
{
    // Get DI Instance Data
    VectorVM::FUserPtrHandler<FNDIStaticMesh_InstanceData> InstData(Context);

    // Input: Triangle Index
    VectorVM::FExternalFuncInputHandler<int32> TriIndexParam(Context);

    // Outputs: Position X, Y, Z
    VectorVM::FExternalFuncRegisterHandler<float> OutPosX(Context);
    VectorVM::FExternalFuncRegisterHandler<float> OutPosY(Context);
    VectorVM::FExternalFuncRegisterHandler<float> OutPosZ(Context);

    // Process 4 instances
    for (int32 i = 0; i < Context.GetNumLoops<4>(); ++i)
    {
        for (int32 j = 0; j < 4; ++j)
        {
            int32 TriIndex = TriIndexParam.GetAndAdvance();

            // Fetch from StaticMesh data
            FVector TriPos = InstData->TrianglePositions[TriIndex];

            *OutPosX.GetDestAndAdvance() = TriPos.X;
            *OutPosY.GetDestAndAdvance() = TriPos.Y;
            *OutPosZ.GetDestAndAdvance() = TriPos.Z;
        }
    }
}
```

---

##### 예시 3: Constant vs Register 입력 처리
**ByteCode with Constant:**
```
// Velocity += Constant Acceleration (10.0)

inputdata_float R0, InputRegister=3   // Particles.Velocity.X (Register)
add R1, R0, ConstantIndex=5           // ConstantTable[5] = 10.0
outputdata_float R1, OutputRegister=3
```

**Runtime Register Setup:**
```cpp
// External Function에서 입력 타입 자동 감지
VectorVM::FExternalFuncInputHandler<float> Acceleration(Context);

if (Acceleration.IsConstant())
{
    // Constant: 모든 파티클에 같은 값
    float ConstAccel = Acceleration.Get();
    __m128 AccelVec = _mm_set1_ps(ConstAccel);  // [10.0, 10.0, 10.0, 10.0]

    // Optimized: Single load
    for (int32 i = 0; i < NumLoops; ++i)
    {
        __m128 Vel = LoadVelocity(i);
        __m128 NewVel = _mm_add_ps(Vel, AccelVec);
        StoreVelocity(i, NewVel);
    }
}
else
{
    // Register: 각 파티클마다 다른 값
    for (int32 i = 0; i < NumLoops; ++i)
    {
        __m128 Vel = LoadVelocity(i);
        __m128 AccelVec = LoadAcceleration(i);  // Per-particle
        __m128 NewVel = _mm_add_ps(Vel, AccelVec);
        StoreVelocity(i, NewVel);
    }
}
```

---

##### 예시 4: Merged OpCode 최적화
**Unoptimized ByteCode:**
```
// Velocity = (OldVel * Drag) + Force

inputdata_float R0, InputRegister=3   // Velocity
inputdata_float R1, InputRegister=10  // Drag
inputdata_float R2, InputRegister=11  // Force
mul R3, R0, R1                        // 5 OpCodes
add R4, R3, R2
outputdata_float R4, OutputRegister=3
done
```

**Optimized ByteCode (Merged Op):**
```
// Same operation with single OpCode

inputdata_float R0, InputRegister=3   // Velocity
inputdata_float R1, InputRegister=10  // Drag
inputdata_float R2, InputRegister=11  // Force
mul_add R3, R0, R1, R2                // 4 OpCodes (1개 절약)
outputdata_float R3, OutputRegister=3
done
```

**성능 향상:**
```
OpCode Dispatch Overhead:
- Unoptimized: 6 OpCode dispatches
- Optimized: 5 OpCode dispatches (~16% 감소)

Instruction Cache:
- Merged Op는 하나의 캐시 라인에 더 잘 맞음
- Branch Prediction도 더 효율적
```

---

##### 예시 5: Parallel Execution (TaskGraph 통합)
**Multi-Emitter System:**
```cpp
// System에 3개 Emitter, 각각 독립적으로 실행 가능

void FNiagaraSystemInstance::Tick_GameThread(float DeltaSeconds)
{
    if (bAllowParallel && Emitters.Num() > 1)
    {
        // Task Graph 병렬 실행
        FGraphEventArray Tasks;

        for (FNiagaraEmitterInstance* Emitter : Emitters)
        {
            FGraphEventRef Task = FFunctionGraphTask::CreateAndDispatchWhenReady(
                [Emitter, DeltaSeconds]()
                {
                    // Worker Thread에서 실행
                    Emitter->ExecuteParticleUpdate(DeltaSeconds);
                },
                TStatId(),
                nullptr,
                ENamedThreads::AnyThread
            );
            Tasks.Add(Task);
        }

        // 모든 Emitter 완료 대기
        FTaskGraphInterface::Get().WaitUntilTasksComplete(Tasks);
    }
    else
    {
        // Sequential execution
        for (FNiagaraEmitterInstance* Emitter : Emitters)
        {
            Emitter->ExecuteParticleUpdate(DeltaSeconds);
        }
    }
}
```

**Worker Thread에서 VM 실행:**
```cpp
void FNiagaraEmitterInstance::ExecuteParticleUpdate(float DeltaSeconds)
{
    // Thread-safe: 각 Emitter는 독립적인 데이터 소유
    FNiagaraScriptExecutionContext& Context = GetUpdateExecutionContext();

    // VM Execute (SIMD)
    Context.Execute(
        SystemInstance,
        DeltaSeconds,
        ParticleDataSet->GetNumInstances(),
        ConstantBufferTable
    );
}
```

---

##### 예시 6: Register Allocation 최적화
**Source HLSL:**
```hlsl
void ParticleUpdate()
{
    float3 Pos = Particles.Position;
    float3 Vel = Particles.Velocity;
    float3 Force = ComputeForce(Pos);
    Vel += Force * DeltaTime;
    Pos += Vel * DeltaTime;
    Particles.Position = Pos;
    Particles.Velocity = Vel;
}
```

**Naive ByteCode (많은 레지스터 사용):**
```
inputdata_float R0, InputRegister=0   // Pos.X
inputdata_float R1, InputRegister=1   // Pos.Y
inputdata_float R2, InputRegister=2   // Pos.Z
inputdata_float R3, InputRegister=3   // Vel.X
inputdata_float R4, InputRegister=4   // Vel.Y
inputdata_float R5, InputRegister=5   // Vel.Z
// ... compute Force into R6, R7, R8
// ... 9 temporary registers needed
```

**Optimized ByteCode (Register Reuse):**
```
inputdata_float R0, InputRegister=0   // Pos.X
inputdata_float R1, InputRegister=1   // Pos.Y
inputdata_float R2, InputRegister=2   // Pos.Z
// ... compute Force directly into R0, R1, R2 (재사용)
mul R0, R0, ConstantIndex=0           // Force.X * DeltaTime
inputdata_float R3, InputRegister=3   // Vel.X (이제 로드)
add R3, R3, R0                        // Vel.X += Force.X * DeltaTime
outputdata_float R3, OutputRegister=3
// ... Only 4 registers needed (9→4, ~55% 감소)
```

---

#### ⚡ 성능 최적화
##### ✅ 해야 할 것
**1. SIMD 친화적 코드 작성:**
```hlsl
// 좋은 예: Component-wise 연산 (SIMD 최적화됨)
float3 NewVel = OldVel + Force * DeltaTime;
// → 3개 add, 3개 mul OpCode (SIMD로 병렬 처리)

// 나쁜 예: Branching (SIMD 방해)
if (Particles.Age > 1.0)
{
    Particles.Velocity = float3(0,0,0);
}
// → Branch divergence, SIMD lane 낭비
```

**2. Constant 사용 최대화:**
```hlsl
// 좋은 예: Constant 값 사용
float Mass = 10.0;  // ConstantTable에서 로드 (1회)
Particles.Force = Particles.Acceleration * Mass;

// 나쁜 예: Per-particle 값
float Mass = Particles.Mass;  // InputRegister에서 로드 (매 파티클)
Particles.Force = Particles.Acceleration * Mass;
// → 4배 메모리 대역폭 사용
```

**3. Merged OpCode 활용:**
```hlsl
// 컴파일러가 자동 최적화하지만, 명시적으로 작성 가능:

// 좋은 예: mad 패턴
float Result = A * B + C;  // → mad OpCode (단일 OpCode)

// 나쁜 예: 분리된 연산
float Temp = A * B;
float Result = Temp + C;  // → mul + add (2 OpCodes)
```

---

##### ❌ 피해야 할 것
**1. External Function 남용:**
```cpp
// 나쁜 예: 매 파티클마다 External Function 호출
for (Particle p : Particles)
{
    p.Position = SampleStaticMesh(p.TriIndex);  // External call
}

// 성능 문제:
// - Function call overhead
// - Cache miss (random mesh access)
// - ~10-100배 느림 (OpCode 대비)

// 좋은 예: Batch 처리
TArray<FVector> Positions;
SampleStaticMeshBatch(TriIndices, Positions);  // 1회 호출
for (int32 i = 0; i < Particles.Num(); ++i)
{
    Particles[i].Position = Positions[i];
}
```

**2. 깊은 Function Call Chain:**
```hlsl
// 나쁜 예: 중첩된 함수 호출
float ComputeFinalValue()
{
    return FuncA(FuncB(FuncC(Input)));
}
// → ByteCode가 매우 길어짐
// → Register pressure 증가
// → Instruction cache miss

// 좋은 예: Inline
float ComputeFinalValue()
{
    float c = Input * ScaleC;
    float b = c + OffsetB;
    float a = b * ScaleA;
    return a;
}
// → 간결한 ByteCode
// → Better register allocation
```

**3. 불필요한 Type Conversion:**
```hlsl
// 나쁜 예: 반복적인 변환
int Index = (int)Particles.ID;
float Value = (float)Index;
Particles.CustomData = Value * Scale;
// → f2i + i2f OpCode (불필요)

// 좋은 예: 변환 최소화
float Value = Particles.ID;  // Already float
Particles.CustomData = Value * Scale;
// → 변환 OpCode 제거
```

---

#### 🐛 디버깅 가이드
##### 일반적인 함정
**❌ Register Overflow:**
```cpp
// 증상: "Too many temp registers" 컴파일 에러
// 원인: 복잡한 수식이 너무 많은 임시 레지스터 필요

// 해결: 수식 분할
void ComplexComputation()
{
    // 나쁜 예: 모든 계산을 한 번에
    float Result = (((A * B) + (C * D)) * ((E * F) + (G * H))) / ((I * J) + (K * L));
    // → 12+ temp registers

    // 좋은 예: 중간 결과를 Particles Attribute에 저장
    Particles.TempA = (A * B) + (C * D);
    Particles.TempB = (E * F) + (G * H);
    Particles.TempC = (I * J) + (K * L);
    float Result = (Particles.TempA * Particles.TempB) / Particles.TempC;
    // → 4 temp registers per stage
}
```

**❌ DataSet Index Out of Bounds:**
```bash
### 증상: Crash with "DataSet index X is invalid"### 원인: inputdata/outputdata OpCode의 잘못된 Register Index
### 디버깅:1. Check VMExecutableData.Attributes 배열
2. Verify InputRegister/OutputRegister 매핑
3. 확인: DataSet Layout이 컴파일 시점과 동일한지
```

**❌ External Function Mismatch:**
```cpp
// 증상: Crash in external_func_call OpCode
// 원인: Function Signature 불일치

// 디버깅:
void VerifyFunctionSignature()
{
    FVMExternalFunctionBindingInfo& Binding = VMExecutableData.CalledVMExternalFunctions[5];

    // Check:
    UE_LOG(LogNiagara, Log, TEXT("FunctionName: %s"), *Binding.Name.ToString());
    UE_LOG(LogNiagara, Log, TEXT("NumInputs: %d"), Binding.GetNumInputs());
    UE_LOG(LogNiagara, Log, TEXT("NumOutputs: %d"), Binding.GetNumOutputs());

    // Compare with actual DI function signature
    FNiagaraFunctionSignature Signature;
    DataInterface->GetFunctions(Signatures);
    // Verify Binding.Name matches Signature
}
```

---

##### 디버깅 팁
**1. ByteCode Disassembly 확인:**
```cpp
// VMExecutableData에서 Assembly 확인
FString Assembly = VMExecutableData.LastAssemblyTranslation;

// Output:
//   0: inputdata_float R0, DataSetIdx=0, RegIdx=0
//   4: inputdata_float R1, DataSetIdx=0, RegIdx=3
//   8: add R2, R0, R1
//  12: outputdata_float R2, DataSetIdx=0, RegIdx=0
//  16: done

// 파일로 저장
FFileHelper::SaveStringToFile(Assembly, TEXT("D:/VM_Assembly.txt"));
```

**2. Register Dump (Runtime):**
```cpp
// VM 실행 중 레지스터 덤프 (Debugging Build)
void DumpRegisters(VectorVM::Runtime::FVectorVMState* State, int32 InstanceIdx)
{
    for (int32 i = 0; i < State->NumTempRegisters; ++i)
    {
        float Value = State->TempRegisters[i][InstanceIdx];
        UE_LOG(LogNiagara, Log, TEXT("R%d[%d] = %f"), i, InstanceIdx, Value);
    }
}
```

**3. External Function Profiling:**
```cpp
// External Function 실행 시간 측정
void ProfiledExternalFunction(FVectorVMExternalFunctionContext& Context)
{
    SCOPE_CYCLE_COUNTER(STAT_NiagaraDI_GetTriPosition);

    double StartTime = FPlatformTime::Seconds();

    // Actual function logic
    ProcessExternalFunction(Context);

    double EndTime = FPlatformTime::Seconds();
    UE_LOG(LogNiagara, Warning, TEXT("ExternalFunc took %.4f ms"), (EndTime - StartTime) * 1000.0);
}

// Stat 확인:
// stat NiagaraDetailed → External Function별 시간 확인
```

**4. SIMD Alignment 확인:**
```cpp
// Crash 원인: Misaligned SIMD load
// 해결: 데이터 정렬 확인

void CheckAlignment()
{
    for (int32 i = 0; i < DataSet->GetNumBuffers(); ++i)
    {
        uint8* Buffer = DataSet->GetComponentPtrFloat(i);
        uintptr_t Address = reinterpret_cast<uintptr_t>(Buffer);

        if ((Address % 16) != 0)
        {
            UE_LOG(LogNiagara, Error, TEXT("Buffer %d is not 16-byte aligned!"), i);
            // → FMemory::Malloc 사용 시 자동 정렬되어야 함
            // → 문제가 있다면 Custom Allocator 사용 확인
        }
    }
}
```

---

#### 🎯 핵심 정리
##### VM 실행 아키텍처 요약
| 컴포넌트 | 역할 | 특징 |
|----------|------|------|
| **FNiagaraScriptExecutionContext** | VM 실행 orchestrator | Parameters, FunctionTable, UserPtrTable 관리 |
| **VectorVM::Runtime::FVectorVMState** | 바이트코드 인터프리터 | OpCode dispatch, SIMD execution |
| **EVectorVMOp** | OpCode 정의 | 177개 OpCode (기본 + 최적화용 Merged Ops) |
| **FVectorVMExternalFunctionContext** | External Function 인터페이스 | DataInterface 함수 호출 |
| **FDataSetMeta** | DataSet 접근 메타데이터 | InputRegisters, OutputRegisters 매핑 |

##### 설계 철학
> **"SIMD First, Scalar Fallback"**
> - 4개 인스턴스를 동시 처리 (SSE/AVX)
> - Constant vs Register 자동 최적화
> - Merged OpCode로 dispatch overhead 최소화

##### 주요 최적화 포인트
1. **SIMD 활용** - Component-wise 연산, branching 최소화
2. **Constant 사용** - Per-particle 데이터 대신 shared constant
3. **Merged OpCode** - `mul_add`, `mad_add` 등 복합 연산
4. **Register Reuse** - 임시 레지스터 재사용으로 allocation 감소

---

#### 🔗 참조 자료
- **Epic VectorVM 구현:** `Engine/Source/Runtime/VectorVM/Private/VectorVMRuntime.cpp`
- **OpCode 정의:** `Engine/Source/Runtime/VectorVM/Public/VectorVM.h:49`
- **External Function API:** `Engine/Source/Runtime/VectorVM/Public/VectorVM.h:315`
- **SIMD Intrinsics:** Intel Intrinsics Guide (https://software.intel.com/sites/landingpage/IntrinsicsGuide)
