---
title: "MetaSound System Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Audio"
tags: ["unreal", "Audio"]
engine_version: "Unreal Engine 5.7"
---
# MetaSound System Deep Dive

## 🧭 개요 (Overview)

**MetaSound**는 UE5의 차세대 오디오 엔진으로, 노드 기반 오디오 그래프를 실시간 DSP로 실행합니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Audio Graph** | 노드 기반 DSP 그래프 (Oscillator, Filter, Mixer 등) |
| **Operator** | DSP 알고리즘 단위 (C++ 구현) |
| **Audio Render Thread** | 별도 Thread에서 오디오 처리 (Low Latency) |
| **Data Types** | Audio (Buffer), Trigger, Float, Int, Bool 등 |
| **Graph Compilation** | Editor Graph → Runtime Executable Graph |

---

## 🏗️ MetaSound Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              MetaSound Editor (Graph)                       │
├─────────────────────────────────────────────────────────────┤
│  Nodes:                                                     │
│    - Sine Wave Oscillator (Frequency: 440Hz)               │
│    → Low Pass Filter (Cutoff: 1000Hz)                      │
│    → Gain (Volume: 0.5)                                    │
│    → Output (Stereo)                                       │
└──────────────────────┼───────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│            Runtime Graph Execution                          │
├─────────────────────────────────────────────────────────────┤
│  Audio Render Thread (512 samples @ 48kHz):                │
│                                                             │
│  while (Running)                                            │
│  {                                                          │
│      // Oscillator → Buffer                                │
│      SineOscillator.Execute(OutBuffer, Frequency);         │
│                                                             │
│      // Filter → Buffer                                    │
│      LowPassFilter.Execute(OutBuffer, Cutoff);             │
│                                                             │
│      // Gain → Buffer                                      │
│      Gain.Execute(OutBuffer, Volume);                      │
│                                                             │
│      // Output → Audio Device                              │
│      SubmitAudio(OutBuffer);                               │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎵 Core Operators

### Oscillator (Sine Wave)

```cpp
// Sine Wave 생성
class FSineOscillatorOperator : public IOperator
{
public:
    void Execute()
    {
        for (int32 i = 0; i < BlockSize; ++i)
        {
            OutputBuffer[i] = FMath::Sin(Phase);
            Phase += PhaseIncrement;  // Frequency 기반
        }
    }
private:
    float Phase = 0.0f;
    float PhaseIncrement;  // 2 * PI * Frequency / SampleRate
};
```

### Low Pass Filter

```cpp
// 간단한 1-pole LPF
class FLowPassFilterOperator : public IOperator
{
public:
    void Execute()
    {
        for (int32 i = 0; i < BlockSize; ++i)
        {
            State = State + Alpha * (InputBuffer[i] - State);
            OutputBuffer[i] = State;
        }
    }
private:
    float State = 0.0f;
    float Alpha;  // Cutoff Frequency 기반
};
```

---

## 🎮 Realtime Parameter Control

```cpp
// Blueprint에서 MetaSound Parameter 변경
UMetaSoundSource* MetaSound = ...;

// Frequency 변경 (실시간 반영!)
MetaSound->SetFloatParameter("Frequency", 880.0f);  // A5 음

// Trigger 발동
MetaSound->SetTriggerParameter("PlayNote");
```

---

## 📊 Performance

**전형적인 오디오 처리:**

| 항목 | 값 |
|------|------|
| **Sample Rate** | 48,000 Hz |
| **Block Size** | 512 samples |
| **Latency** | ~10ms (512 / 48000) |
| **CPU Usage** | ~2% (간단한 Graph) |

---

## 🎛️ 실전 예시

### 예시: Footstep Sound

```
MetaSound Graph:
  Random (Min: 0.9, Max: 1.1)  // Pitch Variation
    ↓
  Wave Player (Footstep.wav)
    ↓
  Pitch Shift (Random Output)
    ↓
  Gain (Volume: 0.7)
    ↓
  Output (Mono)
```

**Blueprint Trigger:**
```cpp
void ACharacter::PlayFootstep()
{
    MetaSoundFootstep->SetTriggerParameter("Play");
}
```

---

## 🚀 최적화

### ✅ 효율적인 Graph

```
Nodes: 10~20개
CPU: ~2%
```

### ❌ 비효율적인 Graph

```
Nodes: 100+개  // 🚫 너무 복잡!
CPU: ~15%
```

---

## 🔗 참고 자료

**소스 파일:**
- `MetasoundEngine/Public/MetasoundSource.h`
- `MetasoundFrontend/Public/MetasoundFrontendDocument.h`

**공식 문서:**
- [MetaSound Overview](https://docs.unrealengine.com/5.7/en-US/metasounds-in-unreal-engine/)

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - MetaSound System
  - Audio Graph Architecture
  - Core Operators (Oscillator, Filter, Gain)
  - Realtime Parameter Control
  - Performance Characteristics