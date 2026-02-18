---
title: "Niagara Audio Integration"
date: "2025-11-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Niagara"
tags: ["unreal", "Niagara"]
---
# Niagara Audio Integration

## 🧭 개요

Niagara Audio Integration은 **파티클 시스템과 Unreal의 오디오 시스템을 연결하는 통합 레이어**로, 파티클 데이터에 반응하는 오디오 재생, 오디오 데이터를 기반으로 한 파티클 변조, 그리고 실시간 오디오 분석을 제공합니다.

**핵심 설계 철학:**
- **양방향 통합:** 파티클 → 오디오 (Audio Player), 오디오 → 파티클 (Spectrum/Oscilloscope)
- **실시간 분석:** Submix 오디오 스트림의 실시간 FFT/CQT 변환 및 GPU 전송
- **유연한 재생:** One-Shot (Fire-and-Forget) vs Persistent (파티클 생명주기 동기화)
- **멀티 디바이스 지원:** 에디터/게임 등 다중 오디오 디바이스 환경 대응

---

## 🏗️ 아키텍처

### 계층 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Data Interface Layer                               │
│  (Niagara Script에서 호출 가능한 API)                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────┐  ┌───────────────────────────────┐  │
│  │ UNiagaraDataInterface-        │  │ UNiagaraDataInterface-        │  │
│  │ AudioPlayer                   │  │ AudioSubmix                   │  │
│  │                               │  │                               │  │
│  │ - PlayOneShotAudio           │  │ - Base Class                  │  │
│  │ - PlayPersistentAudio        │  │ - Submix Listener 관리        │  │
│  │ - UpdateVolume/Pitch/Pos     │  │                               │  │
│  │ - SetParameter (Bool/Int/F)  │  │   ┌─────────────────────┐     │  │
│  └───────────────────────────────┘  │   │ AudioSpectrum       │     │  │
│                                      │   │ (FFT/CQT)           │     │  │
│                                      │   └─────────────────────┘     │  │
│                                      │   ┌─────────────────────┐     │  │
│                                      │   │ AudioOscilloscope   │     │  │
│                                      │   │ (Waveform)          │     │  │
│                                      │   └─────────────────────┘     │  │
│                                      └───────────────────────────────┘  │
└──────────────────────────────────────┼──────────────────────────────────┘
                                       ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                       Audio Capture Layer                                │
│  (Submix → Niagara 오디오 스트림 전송)                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │ FNiagaraSubmixListener (ISubmixBufferListener)             │       │
│  │ - OnNewSubmixBuffer() → Audio Thread Callback              │       │
│  │ - PushAudio() → Audio::FPatchInput                          │       │
│  │ - Multi-Device Support (Editor + Game)                     │       │
│  └──────────────────────────┬──────────────────────────────────┘       │
│                             ↓                                           │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │ Audio::FPatchMixer                                          │       │
│  │ - 멀티 디바이스의 오디오를 단일 스트림으로 병합              │       │
│  └──────────────────────────┬──────────────────────────────────┘       │
└──────────────────────────────┼──────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                       Processing Layer                                   │
│  (오디오 분석 및 변환)                                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │ FNiagaraDataInterfaceProxySpectrum                          │       │
│  │ - Constant-Q Transform (CQT) 계산                           │       │
│  │ - Logarithmic Frequency Spacing                             │       │
│  │ - Noise Floor Normalization                                 │       │
│  │ - GPU Buffer Upload (FReadBuffer)                           │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │ FNiagaraDataInterfaceProxyOscilloscope                      │       │
│  │ - Downsampling (Time-domain resampling)                     │       │
│  │ - Windowing (5ms~400ms)                                     │       │
│  │ - GPU Buffer Upload (FReadBuffer)                           │       │
│  └─────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                       Unreal Audio System                                │
│  (UAudioComponent, USoundSubmix, FAudioDevice)                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔍 계층별 상세 분석

### 1. **FNiagaraSubmixListener - Submix 오디오 캡처**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceAudio.h:13`

```cpp
class FNiagaraSubmixListener : public ISubmixBufferListener
{
public:
    FNiagaraSubmixListener(Audio::FPatchMixer& InMixer,
                          int32 InNumSamplesToBuffer,
                          Audio::FDeviceId InDeviceId,
                          USoundSubmix* InSoundSubmix);

    void RegisterToSubmix();      // Submix에 리스너 등록
    void UnregisterFromSubmix();  // Submix에서 리스너 해제

    float GetSampleRate() const;  // Submix의 샘플 레이트 반환
    int32 GetNumChannels() const; // Submix의 채널 개수 반환

    // ISubmixBufferListener 인터페이스
    virtual const FString& GetListenerName() const override;
    virtual void OnNewSubmixBuffer(const USoundSubmix* OwningSubmix,
                                   float* AudioData,
                                   int32 NumSamples,
                                   int32 NumChannels,
                                   const int32 SampleRate,
                                   double AudioClock) override;

private:
    TAtomic<int32> NumChannelsInSubmix;   // 스레드 안전 채널 개수
    TAtomic<int32> SubmixSampleRate;      // 스레드 안전 샘플 레이트
    Audio::FPatchInput MixerInput;        // PatchMixer로 오디오 전송
    Audio::FDeviceId AudioDeviceId;       // 오디오 디바이스 ID
    USoundSubmix* Submix;                 // 타겟 Submix
    bool bIsRegistered;                   // 등록 상태
};
```

**역할:** Unreal의 Submix 오디오 스트림을 Niagara로 라우팅

**동작 원리:**
```
Audio Thread:
  Submix Buffer Available
    ↓
  OnNewSubmixBuffer(AudioData, NumSamples, NumChannels, SampleRate)
    ├─ NumChannelsInSubmix.Store(NumChannels)     // Atomic 업데이트
    ├─ SubmixSampleRate.Store(SampleRate)         // Atomic 업데이트
    └─ MixerInput.PushAudio(AudioData, NumSamples) // Lock-Free Push

Game Thread (Niagara):
  ├─ GetSampleRate() → SubmixSampleRate.Load()
  ├─ GetNumChannels() → NumChannelsInSubmix.Load()
  └─ PatchMixer.PopAudio() → 오디오 데이터 수신
```

**소스 코드 검증:**

```cpp
// NiagaraDataInterfaceAudio.cpp:127
void FNiagaraSubmixListener::OnNewSubmixBuffer(const USoundSubmix* OwningSubmix,
                                               float* AudioData,
                                               int32 NumSamples,
                                               int32 NumChannels,
                                               const int32 SampleRate,
                                               double AudioClock)
{
    NumChannelsInSubmix = NumChannels;       // TAtomic<int32>로 스레드 안전
    SubmixSampleRate = SampleRate;
    MixerInput.PushAudio(AudioData, NumSamples);  // Lock-Free Push
}
```

```cpp
// NiagaraDataInterfaceAudio.cpp:55
void FNiagaraSubmixListener::RegisterToSubmix()
{
    if (FAudioDevice* AudioDevice = FAudioDeviceManager::Get()->GetAudioDeviceRaw(AudioDeviceId))
    {
        bIsRegistered = true;

        // Submix가 nullptr이면 Main Submix 사용
        USoundSubmix* SubmixToRegister = Submix ? Submix : &AudioDevice->GetMainSubmixObject();
        AudioDevice->RegisterSubmixBufferListener(AsShared(), *SubmixToRegister);

        // Audio Thread에서 등록이 완료될 때까지 대기
        FAudioCommandFence Fence;
        Fence.BeginFence();
        Fence.Wait();
    }
}
```

**멀티 디바이스 지원:**
- 에디터에서는 여러 오디오 디바이스가 동시에 존재 가능 (PIE, Editor Preview 등)
- 각 디바이스마다 별도의 FNiagaraSubmixListener 생성
- Audio::FPatchMixer를 통해 모든 디바이스의 오디오를 병합

---

### 2. **FNiagaraDataInterfaceProxySubmix - Submix Proxy 기본 클래스**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceAudio.h:68`

```cpp
struct FNiagaraDataInterfaceProxySubmix : public FNiagaraDataInterfaceProxy
{
    FNiagaraDataInterfaceProxySubmix(int32 InNumSamplesToBuffer);
    virtual ~FNiagaraDataInterfaceProxySubmix();

    void OnBeginDestroy();

    // Submix 변경 시 호출
    virtual void OnUpdateSubmix(USoundSubmix* Submix);

    // 오디오 데이터 액세스
    int32 PopAudio(float* OutBuffer, int32 NumSamples, bool bUseLatestAudio);
    int32 GetNumSamplesAvailable();
    int32 GetNumFramesAvailable();

    // 오디오 포맷 정보
    int32 GetNumChannels() const;
    float GetSampleRate() const;

private:
    void RegisterToAllAudioDevices();
    void UnregisterFromAllAudioDevices();

    void OnNewDeviceCreated(Audio::FDeviceId InDeviceId);
    void OnDeviceDestroyed(Audio::FDeviceId InDeviceId);

    // 디바이스별 리스너 맵
    TMap<Audio::FDeviceId, TSharedPtr<FNiagaraSubmixListener>> SubmixListeners;

    // 모든 디바이스의 오디오를 병합하는 믹서
    Audio::FPatchMixer PatchMixer;

    USoundSubmix* SubmixRegisteredTo;
    bool bIsSubmixListenerRegistered;
    int32 NumSamplesToBuffer;  // 내부 버퍼 크기

    FDelegateHandle DeviceCreatedHandle;    // 디바이스 생성 이벤트
    FDelegateHandle DeviceDestroyedHandle;  // 디바이스 소멸 이벤트
};
```

**역할:** Spectrum과 Oscilloscope의 공통 기반 클래스

**멀티 디바이스 관리:**

```cpp
// NiagaraDataInterfaceAudio.cpp:155
void FNiagaraDataInterfaceProxySubmix::RegisterToAllAudioDevices()
{
    if (FAudioDeviceManager* DeviceManager = FAudioDeviceManager::Get())
    {
        // 현재 존재하는 모든 오디오 디바이스에 리스너 등록
        DeviceManager->IterateOverAllDevices([&](Audio::FDeviceId DeviceId, FAudioDevice* InDevice)
        {
            AddSubmixListener(DeviceId);
        });
    }
}

void FNiagaraDataInterfaceProxySubmix::OnNewDeviceCreated(Audio::FDeviceId InDeviceId)
{
    if (bIsSubmixListenerRegistered)
    {
        // 새 디바이스가 생성되면 자동으로 리스너 추가
        AddSubmixListener(InDeviceId);
    }
}

void FNiagaraDataInterfaceProxySubmix::OnDeviceDestroyed(Audio::FDeviceId InDeviceId)
{
    // 디바이스 소멸 시 리스너 제거
    RemoveSubmixListener(InDeviceId);
}
```

**Audio::FPatchMixer 동작 원리:**

```
Multiple Audio Devices:
  ┌──────────────┐
  │ Device 0     │ → FNiagaraSubmixListener → PatchInput 0
  │ (Editor)     │                                ↓
  └──────────────┘                           FPatchMixer
                                                  ↓
  ┌──────────────┐                           PopAudio()
  │ Device 1     │ → FNiagaraSubmixListener → (모든 입력 병합)
  │ (PIE Game)   │                                ↓
  └──────────────┘                           Niagara Processing
```

---

### 3. **UNiagaraDataInterfaceAudioSpectrum - 주파수 분석**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceAudioSpectrum.h:130`

```cpp
UCLASS(EditInlineNew, Category = "Audio",
       meta = (DisplayName = "Audio Spectrum"), MinimalAPI)
class UNiagaraDataInterfaceAudioSpectrum : public UNiagaraDataInterfaceAudioSubmix
{
    GENERATED_UCLASS_BODY()

public:
    // Spectrum 설정
    UPROPERTY(EditAnywhere, Category = "Spectrum",
              meta = (ClampMin = "16", ClampMax = "1024"))
    int32 Resolution;  // GPU로 전송할 주파수 밴드 개수

    UPROPERTY(EditAnywhere, Category = "Spectrum",
              meta = (ClampMin = "20.0", ClampMax = "20000.0"))
    float MinimumFrequency;  // 최소 주파수 (Hz)

    UPROPERTY(EditAnywhere, Category = "Spectrum",
              meta = (ClampMin = "20.0", ClampMax = "20000.0"))
    float MaximumFrequency;  // 최대 주파수 (Hz)

    UPROPERTY(EditAnywhere, AdvancedDisplay, Category = "Spectrum",
              meta = (ClampMin = "-120.0", ClampMax = "0.0"))
    float NoiseFloorDb;  // 노이즈 플로어 (dB) - 이 값 이하는 0으로 간주

    // VM 함수
    void GetSpectrumValue(FVectorVMExternalFunctionContext& Context);
    void GetNumChannels(FVectorVMExternalFunctionContext& Context);

    virtual bool CanExecuteOnTarget(ENiagaraSimTarget Target) const override
    {
        return true;  // CPU/GPU 모두 지원
    }
};
```

**Proxy 구조:**

```cpp
struct FNiagaraDataInterfaceProxySpectrum : public FNiagaraDataInterfaceProxySubmix
{
    FNiagaraDataInterfaceProxySpectrum(float InMinimumFrequency,
                                       float InMaximumFrequency,
                                       int32 InNumBands,
                                       float InNoiseFloorDb,
                                       int32 InNumSamplesToBuffer);

    // Spectrum 샘플링
    float GetSpectrumValue(float InNormalizedPositionInSpectrum, int32 InChannelIndex);

    int32 GetNumBands() const;

    // 설정 업데이트
    void UpdateCQT(float InMinimumFrequency, float InMaximumFrequency, int32 InNumBands);
    void UpdateNoiseFloor(float InNoiseFloorDb);

    // GPU 전송
    void PostDataToGPU();
    FReadBuffer& ComputeAndPostSRV();

    // Spectrum 계산
    void UpdateSpectrum();

private:
    float MinimumFrequency;         // 20 Hz
    float MaximumFrequency;         // 20000 Hz
    TAtomic<int32> NumBands;        // Resolution
    float NoiseFloorDb;             // -60 dB

    int32 NumChannels;
    float SampleRate;
    float FFTScale;

    Audio::FAlignedFloatBuffer PopBuffer;                    // PatchMixer에서 Pop
    TArray<Audio::FAlignedFloatBuffer> ChannelSpectrumBuffers;  // 채널별 Spectrum

    // CQT 변환 객체
    TUniquePtr<Audio::FContiguousSparse2DKernelTransform> CQTKernel;
    TUniquePtr<Audio::IFFTAlgorithm> FFTAlgorithm;

    // 작업 버퍼
    Audio::FAlignedFloatBuffer InterleavedBuffer;
    Audio::FAlignedFloatBuffer DeinterleavedBuffer;
    Audio::FAlignedFloatBuffer FFTInputBuffer;
    Audio::FAlignedFloatBuffer FFTOutputBuffer;
    Audio::FAlignedFloatBuffer PowerSpectrumBuffer;
    Audio::FAlignedFloatBuffer SpectrumBuffer;
    Audio::FAlignedFloatBuffer WindowBuffer;

    // GPU 버퍼
    FReadBuffer GPUBuffer;

    FCriticalSection BufferLock;
};
```

**Constant-Q Transform (CQT) 개요:**

CQT는 FFT와 달리 **로그 스케일 주파수 간격**을 사용하여 음악적으로 더 의미 있는 분석을 제공합니다.

```
Linear Spacing (FFT):
  20 Hz, 40 Hz, 60 Hz, 80 Hz, 100 Hz, ...
  → 저주파 영역 과도하게 세밀, 고주파 영역 부족

Logarithmic Spacing (CQT):
  20 Hz, 40 Hz, 80 Hz, 160 Hz, 320 Hz, 640 Hz, 1280 Hz, 2560 Hz, ...
  → 음악적 옥타브 간격 (각 옥타브에 동일한 밴드 수 할당)
```

**CQT 계산 파이프라인:**

```
1. Audio Capture (OnNewSubmixBuffer):
   └─ PushAudio() → PatchMixer

2. UpdateSpectrum() (Game Thread):
   ├─ PopAudio(PopBuffer)
   │
   ├─ Deinterleave: [L0,R0,L1,R1,...] → [L0,L1,...] [R0,R1,...]
   │
   ├─ Apply Window (Hann/Hamming):
   │    └─ FFTInputBuffer[i] = DeinterleavedBuffer[i] * WindowBuffer[i]
   │
   ├─ FFT (Time → Frequency):
   │    └─ FFTAlgorithm->ForwardRealToComplex(FFTInputBuffer, FFTOutputBuffer)
   │
   ├─ Power Spectrum:
   │    └─ PowerSpectrumBuffer[i] = |FFTOutputBuffer[i]|^2
   │
   ├─ CQT Kernel Transform:
   │    └─ CQTKernel->TransformArray(PowerSpectrumBuffer, SpectrumBuffer)
   │        └─ Log-Frequency Binning
   │
   ├─ Noise Floor Normalization:
   │    └─ LinearAmplitude = Clamp((dB - NoiseFloorDb) / abs(NoiseFloorDb), 0, inf)
   │
   └─ Store to ChannelSpectrumBuffers[Channel]

3. PostDataToGPU() (Render Thread):
   └─ GPUBuffer.Upload(ChannelSpectrumBuffers)
```

**CQT 설정 계산:**

```cpp
// FNiagaraDataInterfaceProxySpectrum::GetConstantQSettings()
Audio::FPseudoConstantQKernelSettings GetConstantQSettings(
    float InMinimumFrequency,      // 20 Hz
    float InMaximumFrequency,      // 20000 Hz
    int32 InNumBands,              // 128
    float InNumBandsPerOctave,     // 12.0 (음악적 반음 간격)
    float InBandwidthStretch)      // 1.0
{
    float NumOctaves = log2(InMaximumFrequency / InMinimumFrequency);  // ~9.97 옥타브

    return Audio::FPseudoConstantQKernelSettings{
        .KernelLowestCenterFreq = InMinimumFrequency,
        .NumBands = InNumBands,
        .NumBandsPerOctave = InNumBandsPerOctave,
        .BandWidthStretch = InBandwidthStretch,
        .Normalization = Audio::EPseudoConstantQNormalization::EqualAmplitude
    };
}
```

**Noise Floor Normalization:**

```cpp
// NoiseFloorDb = -60 dB
// SpectrumValueDb = 20 * log10(SpectrumAmplitude)

float LinearAmplitude;
if (SpectrumValueDb <= NoiseFloorDb)
{
    LinearAmplitude = 0.0f;  // 노이즈 플로어 이하는 무음
}
else
{
    // -60dB → 0.0, 0dB → 1.0, >0dB → >1.0
    LinearAmplitude = (SpectrumValueDb - NoiseFloorDb) / FMath::Abs(NoiseFloorDb);
}
```

**GPU Shader 인터페이스:**

```hlsl
// Niagara Script (HLSL)
float GetSpectrumValue(NiagaraDataInterfaceAudioSpectrum DI,
                       float NormalizedFrequency,  // 0.0 ~ 1.0
                       int ChannelIndex)           // 0 = Left, 1 = Right
{
    int BandIndex = int(NormalizedFrequency * float(DI.Resolution - 1));
    int BufferIndex = ChannelIndex * DI.Resolution + BandIndex;
    return DI.SpectrumBuffer[BufferIndex];
}
```

---

### 4. **UNiagaraDataInterfaceAudioOscilloscope - 파형 분석**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceAudioOscilloscope.h:90`

```cpp
UCLASS(EditInlineNew, Category = "Audio", CollapseCategories,
       meta = (DisplayName = "Audio Oscilloscope"), MinimalAPI)
class UNiagaraDataInterfaceAudioOscilloscope : public UNiagaraDataInterface
{
    GENERATED_UCLASS_BODY()

public:
    UPROPERTY(EditAnywhere, Category = "Oscilloscope")
    TObjectPtr<USoundSubmix> Submix;

    static const int32 MaxBufferResolution = 8192;

    // GPU로 전송할 샘플 개수 (다운샘플링됨)
    UPROPERTY(EditAnywhere, Category = "Oscilloscope", AdvancedDisplay,
              meta = (ClampMin = "64", ClampMax = "8192"))
    int32 Resolution;

    // 표시할 오디오 길이 (밀리초)
    UPROPERTY(EditAnywhere, Category = "Oscilloscope",
              meta = (ClampMin = "5.0", ClampMax = "400.0"))
    float ScopeInMilliseconds;

    // VM 함수
    void SampleAudio(FVectorVMExternalFunctionContext& Context);
    void GetNumChannels(FVectorVMExternalFunctionContext& Context);

    virtual bool CanExecuteOnTarget(ENiagaraSimTarget Target) const override
    {
        return true;  // CPU/GPU 모두 지원
    }
};
```

**Proxy 구조:**

```cpp
struct FNiagaraDataInterfaceProxyOscilloscope : public FNiagaraDataInterfaceProxy
{
    FNiagaraDataInterfaceProxyOscilloscope(int32 InResolution, float InScopeInMillseconds);

    // 오디오 샘플링
    float SampleAudio(float NormalizedPositionInBuffer,
                     int32 Channel,
                     int32 NumFramesInBuffer,
                     int32 NumChannelsInBuffer);

    int32 GetNumChannels();

    // 설정 업데이트
    void OnUpdateSubmix(USoundSubmix* Submix);
    void OnUpdateResampling(int32 InResolution, float InScopeInMilliseconds);

    // GPU 전송
    void PostAudioToGPU();
    FReadBuffer& ComputeAndPostSRV();

    // 다운샘플링
    int32 DownsampleAudioToBuffer();

private:
    TMap<Audio::FDeviceId, TSharedPtr<FNiagaraSubmixListener>> SubmixListeners;
    Audio::FPatchMixer PatchMixer;

    USoundSubmix* SubmixRegisteredTo;
    bool bIsSubmixListenerRegistered;

    int32 Resolution;                  // 512
    float ScopeInMilliseconds;         // 50 ms

    Audio::FAlignedFloatBuffer PopBuffer;          // PatchMixer에서 Pop
    Audio::FAlignedFloatBuffer DownsampledBuffer;  // 다운샘플링된 버퍼

    FReadBuffer GPUDownsampledBuffer;              // GPU 버퍼
    FThreadSafeCounter NumChannelsInDownsampledBuffer;

    Audio::FAlignedFloatBuffer VectorVMReadBuffer; // CPU VM용 읽기 버퍼

    FCriticalSection DownsampleBufferLock;

    FDelegateHandle DeviceCreatedHandle;
    FDelegateHandle DeviceDestroyedHandle;
};
```

**다운샘플링 파이프라인:**

```
1. Calculate Target Sample Count:
   TargetNumSamples = (ScopeInMilliseconds / 1000.0) * SampleRate * NumChannels
   // 예: (50 ms / 1000) * 48000 Hz * 2 channels = 4800 samples

2. PopAudio from PatchMixer:
   int32 NumSamplesPopped = PatchMixer.PopAudio(PopBuffer, TargetNumSamples, bUseLatestAudio=false)

3. Downsample to Resolution:
   ResampleRatio = NumSamplesPopped / (Resolution * NumChannels)
   // 예: 4800 / (512 * 2) = 4.6875

   for (int i = 0; i < Resolution * NumChannels; ++i)
   {
       float SourceIndex = i * ResampleRatio;
       int Index0 = floor(SourceIndex);
       int Index1 = ceil(SourceIndex);
       float Fraction = SourceIndex - Index0;

       // Linear Interpolation
       DownsampledBuffer[i] = Lerp(PopBuffer[Index0], PopBuffer[Index1], Fraction);
   }

4. Upload to GPU:
   GPUDownsampledBuffer.Upload(DownsampledBuffer)
```

**GPU Shader 인터페이스:**

```hlsl
// Niagara Script (HLSL)
float SampleAudio(NiagaraDataInterfaceAudioOscilloscope DI,
                  float NormalizedPosition,  // 0.0 ~ 1.0 (시간 축)
                  int ChannelIndex)          // 0 = Left, 1 = Right
{
    // Interleaved Format: [L0, R0, L1, R1, ...]
    int FrameIndex = int(NormalizedPosition * float(NumFrames - 1));
    int SampleIndex = FrameIndex * DI.NumChannels + ChannelIndex;
    return DI.AudioBuffer[SampleIndex];
}
```

---

### 5. **UNiagaraDataInterfaceAudioPlayer - 오디오 재생**

**📂 위치:** `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceAudioPlayer.h:93`

```cpp
UCLASS(EditInlineNew, Category = "Audio",
       meta = (DisplayName = "Audio Player"), MinimalAPI)
class UNiagaraDataInterfaceAudioPlayer : public UNiagaraDataInterface
{
    GENERATED_UCLASS_BODY()

public:
    // 재생할 사운드 애셋
    UPROPERTY(EditAnywhere, Category = "Audio")
    TObjectPtr<USoundBase> SoundToPlay;

    // 감쇠 설정
    UPROPERTY(EditAnywhere, Category = "Audio")
    TObjectPtr<USoundAttenuation> Attenuation;

    // 동시 재생 제한 설정
    UPROPERTY(EditAnywhere, Category = "Audio")
    TObjectPtr<USoundConcurrency> Concurrency;

    // Sound Cue 파라미터 이름 목록
    UPROPERTY(EditAnywhere, Category = "Parameters")
    TArray<FName> ParameterNames;

    // 동적 설정 변경용 User Parameter
    UPROPERTY(EditAnywhere, Category = "Parameters")
    FNiagaraUserParameterBinding ConfigurationUserParameter;

    // 틱당 최대 재생 개수 제한
    UPROPERTY(EditAnywhere, AdvancedDisplay, Category = "Audio",
              meta = (InlineEditConditionToggle))
    bool bLimitPlaysPerTick;

    UPROPERTY(EditAnywhere, AdvancedDisplay, Category = "Audio",
              meta = (EditCondition = "bLimitPlaysPerTick", ClampMin = "0", UIMin = "0"))
    int32 MaxPlaysPerTick;

    // Niagara Component 소멸 시 오디오 정지 여부
    UPROPERTY(EditAnywhere, AdvancedDisplay, Category = "Audio")
    bool bStopWhenComponentIsDestroyed = true;

    // 루핑 사운드를 One-Shot으로 재생 허용 여부
    UPROPERTY(EditAnywhere, AdvancedDisplay, Category = "Audio")
    bool bAllowLoopingOneShotSounds = false;

#if WITH_EDITORONLY_DATA
    // 에디터 프리뷰에서 사운드 재생 비활성화
    UPROPERTY(EditAnywhere, AdvancedDisplay, Category = "Audio")
    bool bOnlyActiveDuringGameplay = false;
#endif

    // VM 함수
    virtual void PlayOneShotAudio(FVectorVMExternalFunctionContext& Context);
    virtual void PlayPersistentAudio(FVectorVMExternalFunctionContext& Context);
    virtual void SetParameterBool(FVectorVMExternalFunctionContext& Context);
    virtual void SetParameterInteger(FVectorVMExternalFunctionContext& Context);
    virtual void SetParameterFloat(FVectorVMExternalFunctionContext& Context);
    virtual void SetInitialParameterBool(FVectorVMExternalFunctionContext& Context);
    virtual void SetInitialParameterInteger(FVectorVMExternalFunctionContext& Context);
    virtual void SetInitialParameterFloat(FVectorVMExternalFunctionContext& Context);
    virtual void UpdateVolume(FVectorVMExternalFunctionContext& Context);
    virtual void UpdatePitch(FVectorVMExternalFunctionContext& Context);
    virtual void UpdateLocation(FVectorVMExternalFunctionContext& Context);
    virtual void UpdateRotation(FVectorVMExternalFunctionContext& Context);
    virtual void SetPausedState(FVectorVMExternalFunctionContext& Context);

    virtual bool CanExecuteOnTarget(ENiagaraSimTarget Target) const override
    {
        return Target == ENiagaraSimTarget::CPUSim;  // CPU 전용
    }
};
```

**Per-Instance Data:**

```cpp
struct FAudioPlayerInterface_InstanceData
{
    // Lock-Free Queues (멀티스레드 안전)
    TQueue<FAudioParticleData, EQueueMode::Mpsc> PlayAudioQueue;
    TQueue<FAudioInitialParamData, EQueueMode::Mpsc> InitialParamDataQueue;
    TQueue<FPersistentAudioParticleData, EQueueMode::Mpsc> PersistentAudioActionQueue;

    FThreadSafeCounter HandleCount;  // Persistent Audio Handle 생성기
    int32 ParamCountEstimate = 0;

    // Persistent Audio 관리
    TSortedMap<int32, TWeakObjectPtr<UAudioComponent>> PersistentAudioMapping;

    // 설정 캐시
    TWeakObjectPtr<USoundBase> SoundToPlay;
    TWeakObjectPtr<USoundAttenuation> Attenuation;
    TWeakObjectPtr<USoundConcurrency> Concurrency;
    TWeakObjectPtr<UNiagaraDataInterfaceAudioPlayerSettings> CachedUserParam;

    TArray<FName> ParameterNames;
    TSet<FNiagaraVariable> GlobalInitialParameterValues;

    FNiagaraLWCConverter LWCConverter;
    int32 MaxPlaysPerTick = 0;
    bool bStopWhenComponentIsDestroyed = true;
    bool bValidOneShotSound = false;
    bool bSoundToPlayIsLooping = false;
#if WITH_EDITORONLY_DATA
    bool bOnlyActiveDuringGameplay = false;
#endif

    FNiagaraParameterDirectBinding<UObject*> UserParamBinding;
};
```

**One-Shot Audio vs Persistent Audio:**

| 특징 | One-Shot Audio | Persistent Audio |
|------|----------------|------------------|
| **생명주기** | Fire-and-Forget (재생 시작 후 제어 불가) | 파티클 생명주기와 동기화 |
| **함수** | `PlayAudioAtLocation()` | `PlayPersistentAudio()` |
| **업데이트** | 불가능 | `UpdateVolume()`, `UpdatePitch()`, `UpdateLocation()` 등 |
| **파라미터 설정** | 초기 파라미터만 (`SetInitialFloatParameter`) | 런타임 변경 가능 (`SetFloatParameter`) |
| **정지** | 불가능 (자동 완료) | `SetPaused(true)` 또는 파티클 소멸 시 |
| **메모리** | 낮음 (UAudioComponent 미생성) | 높음 (파티클당 UAudioComponent) |
| **사용 사례** | 총알 발사음, 폭발음 등 단발성 효과 | 엔진 소리, 화재 소리 등 지속적 효과 |

**Tick 생명주기:**

```
PerInstanceTick (PreSimulate):
  ├─ Update SoundToPlay/Attenuation/Concurrency
  ├─ Bind ConfigurationUserParameter
  └─ Validate bValidOneShotSound

[Simulation Phase]
  ├─ PlayOneShotAudio() → Enqueue to PlayAudioQueue
  ├─ PlayPersistentAudio() → Enqueue to PersistentAudioActionQueue
  ├─ SetInitialFloatParameter() → Enqueue to InitialParamDataQueue
  └─ UpdateVolume() → Enqueue to PersistentAudioActionQueue (with UpdateCallback)

PerInstanceTickPostSimulate (PostSimulate):
  ├─ Drain InitialParamDataQueue → Build PerParticleParams map
  │
  ├─ Drain PlayAudioQueue:
  │   └─ For each FAudioParticleData:
  │       ├─ Lookup InitialParams from PerParticleParams
  │       └─ UGameplayStatics::PlaySoundAtLocation()
  │
  └─ Drain PersistentAudioActionQueue:
      └─ For each FPersistentAudioParticleData:
          ├─ Lookup UAudioComponent from PersistentAudioMapping
          └─ Execute UpdateCallback (UpdateVolume, UpdatePitch, etc.)
```

**소스 코드 검증:**

```cpp
// NiagaraDataInterfaceAudioPlayer.cpp:197
bool UNiagaraDataInterfaceAudioPlayer::PerInstanceTickPostSimulate(...)
{
    FAudioPlayerInterface_InstanceData* PIData = static_cast<FAudioPlayerInterface_InstanceData*>(PerInstanceData);

    // 1. InitialParamDataQueue → PerParticleParams 맵 생성
    TMap<int32, TArray<FAudioInitialParamData>> PerParticleParams;
    FAudioInitialParamData ParamData;
    while (PIData->InitialParamDataQueue.Dequeue(ParamData))
    {
        PerParticleParams.FindOrAdd(ParamData.ParticleID).Add(ParamData);
    }

    // 2. One-Shot Audio 재생
    if (!PIData->PlayAudioQueue.IsEmpty())
    {
        TArray<FAudioParticleData> Data;
        FAudioParticleData Value;
        while (PIData->PlayAudioQueue.Dequeue(Value))
        {
            Data.Add(Value);
            if (PIData->MaxPlaysPerTick > 0 && Data.Num() >= PIData->MaxPlaysPerTick)
            {
                PIData->PlayAudioQueue.Empty();  // 제한 초과 시 나머지 버림
                break;
            }
        }

        for (const FAudioParticleData& ParticleData : Data)
        {
            UInitialActiveSoundParams* InitialParams = nullptr;
            TArray<FAudioInitialParamData>* ParticleAudioParams = PerParticleParams.Find(ParticleData.ParticleID);

            if (PIData->GlobalInitialParameterValues.Num() > 0 || ParticleAudioParams)
            {
                InitialParams = NewObject<UInitialActiveSoundParams>();
                // Global 파라미터 추가
                for (const FNiagaraVariable& Var : PIData->GlobalInitialParameterValues)
                {
                    InitialParams->AudioParams.Add(ConvertVariableToAudioParam(Var));
                }
                // Per-Particle 파라미터 추가
                if (ParticleAudioParams)
                {
                    for (const FAudioInitialParamData& Var : *ParticleAudioParams)
                    {
                        InitialParams->AudioParams.Add(ConvertVariableToAudioParam(Var.Value));
                    }
                }
            }

            // Fire-and-Forget 재생
            UGameplayStatics::PlaySoundAtLocation(
                World, PIData->SoundToPlay.Get(),
                ParticleData.Position, ParticleData.Rotation,
                ParticleData.Volume, ParticleData.Pitch, ParticleData.StartTime,
                PIData->Attenuation.Get(), PIData->Concurrency.Get(),
                SoundOwner, InitialParams);
        }
    }

    // 3. Persistent Audio 업데이트
    FPersistentAudioParticleData Value;
    while (PIData->PersistentAudioActionQueue.Dequeue(Value))
    {
        UAudioComponent* AudioComponent = nullptr;
        if (Value.AudioHandle > 0)
        {
            auto MappedValue = PIData->PersistentAudioMapping.Find(Value.AudioHandle);
            if (MappedValue && MappedValue->IsValid())
            {
                AudioComponent = MappedValue->Get();
            }
        }

        // UpdateCallback 실행 (Game Thread에서 안전)
        if (Value.UpdateCallback)
        {
            Value.UpdateCallback(PIData, AudioComponent, SystemInstance);
        }
    }

    return false;
}
```

---

## 💡 실전 예시

### 예시 1: Spectrum 기반 파티클 스케일 조절

```hlsl
// Niagara Emitter Update Script
void UpdateParticleFromSpectrum(inout FParticleData Particle,
                                NiagaraDataInterfaceAudioSpectrum SpectrumDI)
{
    // 베이스 주파수 (20 Hz ~ 150 Hz)
    float BassAmplitude = SpectrumDI.GetSpectrumValue(0.05, 0);  // Left Channel

    // 미드 주파수 (150 Hz ~ 2000 Hz)
    float MidAmplitude = SpectrumDI.GetSpectrumValue(0.3, 0);

    // 고주파 (2000 Hz ~ 20000 Hz)
    float TrebleAmplitude = SpectrumDI.GetSpectrumValue(0.9, 0);

    // 주파수별로 다른 효과 적용
    Particle.Scale = lerp(Particle.Scale, BassAmplitude * 5.0, 0.1);
    Particle.Color.r = MidAmplitude;
    Particle.Color.b = TrebleAmplitude;

    // 베이스가 강할 때 파티클 방출
    if (BassAmplitude > 0.7)
    {
        Engine.EmitParticle();
    }
}
```

**내부 동작:**
```
Audio Thread:
  Submix → OnNewSubmixBuffer() → PatchInput.PushAudio()

Game Thread (매 프레임):
  ├─ UpdateSpectrum():
  │   ├─ PatchMixer.PopAudio()
  │   ├─ FFT → CQT
  │   └─ Store in ChannelSpectrumBuffers
  │
  └─ PostDataToGPU():
      └─ GPUBuffer.Upload()

Render Thread (GPU):
  └─ Niagara Simulation Shader:
      └─ GetSpectrumValue() → SpectrumBuffer 샘플링
```

---

### 예시 2: Oscilloscope 기반 파형 시각화

```hlsl
// Niagara Ribbon Emitter
void UpdateRibbonVertex(inout FRibbonVertex Vertex,
                       NiagaraDataInterfaceAudioOscilloscope OscilloscopeDI,
                       float Time)
{
    // 시간 축 (Ribbon Age 기반)
    float NormalizedTime = Vertex.Age / RibbonTotalTime;  // 0.0 ~ 1.0

    // 왼쪽 채널 샘플링
    float LeftAmplitude = OscilloscopeDI.SampleAudio(NormalizedTime, 0);

    // 오른쪽 채널 샘플링
    float RightAmplitude = OscilloscopeDI.SampleAudio(NormalizedTime, 1);

    // Y 오프셋으로 파형 표현
    Vertex.Position.y = LeftAmplitude * 100.0;   // 좌측 파형
    Vertex.Position.z = RightAmplitude * 100.0;  // 우측 파형 (스테레오 분리)

    // 진폭에 따른 색상
    float TotalAmplitude = (abs(LeftAmplitude) + abs(RightAmplitude)) * 0.5;
    Vertex.Color = lerp(float3(0, 0, 1), float3(1, 0, 0), TotalAmplitude);
}
```

**Oscilloscope 설정:**
- Resolution: 512 samples
- ScopeInMilliseconds: 50 ms
- 결과: 최근 50ms의 오디오를 512개 샘플로 다운샘플링하여 실시간 표시

---

### 예시 3: One-Shot Audio - 폭발 사운드

```hlsl
// Particle Death Event
void OnParticleDestroyed(inout FParticleData Particle,
                        NiagaraDataInterfaceAudioPlayer AudioPlayerDI)
{
    float3 ExplosionPosition = Particle.Position;
    float ExplosionVolume = Particle.Scale / MaxScale;  // 크기에 비례한 볼륨
    float ExplosionPitch = lerp(0.8, 1.2, Random(Particle.ID));

    // One-Shot 재생 (Fire-and-Forget)
    AudioPlayerDI.PlayAudioAtLocation(
        ExplosionPosition,
        FRotator::ZeroRotator,
        ExplosionVolume,
        ExplosionPitch,
        0.0  // StartTime
    );

    // 초기 파라미터 설정 (Sound Cue에서 사용)
    AudioPlayerDI.SetInitialFloatParameter(
        Particle.ID,
        0,  // ParameterNames[0] = "ExplosionSize"
        Particle.Scale
    );
}
```

**Blueprint - Sound Cue 설정:**
```
SoundWave [ExplosionSound]
   ↓
Modulator (Volume) ← ExplosionSize Parameter
   ↓
Attenuator (Distance-based falloff)
   ↓
Output
```

---

### 예시 4: Persistent Audio - 엔진 사운드

```hlsl
// Particle Spawn
void SpawnParticle(out FParticleData Particle,
                  NiagaraDataInterfaceAudioPlayer AudioPlayerDI)
{
    Particle.Position = SpawnLocation;
    Particle.Velocity = SpawnVelocity;

    // Persistent Audio 시작
    int AudioHandle = AudioPlayerDI.PlayPersistentAudio(
        Particle.Position,
        FRotator::ZeroRotator,
        1.0,  // Initial Volume
        1.0,  // Initial Pitch
        0.0   // StartTime
    );

    Particle.AudioHandle = AudioHandle;  // 핸들 저장
}

// Particle Update
void UpdateParticle(inout FParticleData Particle,
                   NiagaraDataInterfaceAudioPlayer AudioPlayerDI,
                   float DeltaTime)
{
    // 속도에 따른 피치 변경
    float Speed = length(Particle.Velocity);
    float TargetPitch = lerp(0.5, 2.0, Speed / MaxSpeed);

    AudioPlayerDI.UpdateAudioPitch(
        Particle.AudioHandle,
        TargetPitch
    );

    // 위치 업데이트
    AudioPlayerDI.UpdateAudioLocation(
        Particle.AudioHandle,
        Particle.Position
    );

    // RPM 파라미터 전송 (Sound Cue에서 사용)
    float RPM = Speed * 100.0;
    AudioPlayerDI.SetFloatParameter(
        Particle.AudioHandle,
        0,  // ParameterNames[0] = "RPM"
        RPM
    );
}

// Particle Death
void OnParticleDestroyed(inout FParticleData Particle,
                        NiagaraDataInterfaceAudioPlayer AudioPlayerDI)
{
    // Persistent Audio는 자동으로 정지됨 (PersistentAudioMapping에서 제거)
    // 명시적으로 정지하려면:
    AudioPlayerDI.SetPaused(Particle.AudioHandle, true);
}
```

**내부 동작:**

```cpp
// PlayPersistentAudio() 구현
void UNiagaraDataInterfaceAudioPlayer::PlayPersistentAudio(FVectorVMExternalFunctionContext& Context)
{
    VectorVM::FUserPtrHandler<FAudioPlayerInterface_InstanceData> InstData(Context);

    FNDIInputParam<FVector3f> PositionParam(Context);
    FNDIInputParam<FQuat4f> RotationParam(Context);
    FNDIInputParam<float> VolumeParam(Context);
    FNDIInputParam<float> PitchParam(Context);
    FNDIInputParam<float> StartTimeParam(Context);

    FNDIOutputParam<int32> OutHandle(Context);

    for (int32 i = 0; i < Context.GetNumInstances(); ++i)
    {
        FVector3f Position = PositionParam.GetAndAdvance();
        FQuat4f Rotation = RotationParam.GetAndAdvance();
        float Volume = VolumeParam.GetAndAdvance();
        float Pitch = PitchParam.GetAndAdvance();
        float StartTime = StartTimeParam.GetAndAdvance();

        // 고유한 AudioHandle 생성
        int32 AudioHandle = InstData->HandleCount.Increment();

        // 생성 요청을 Queue에 추가
        FPersistentAudioParticleData Data;
        Data.AudioHandle = AudioHandle;
        Data.UpdateCallback = [Position, Rotation, Volume, Pitch, StartTime](
            FAudioPlayerInterface_InstanceData* InstData,
            UAudioComponent* AudioComponent,
            FNiagaraSystemInstance* SystemInstance)
        {
            if (!AudioComponent)
            {
                // UAudioComponent 생성
                UWorld* World = SystemInstance->GetWorldManager()->GetWorld();
                AudioComponent = UGameplayStatics::SpawnSoundAtLocation(
                    World,
                    InstData->SoundToPlay.Get(),
                    InstData->LWCConverter.ConvertSimulationPositionToWorld(Position),
                    Rotation.Rotator(),
                    Volume,
                    Pitch,
                    StartTime,
                    InstData->Attenuation.Get(),
                    InstData->Concurrency.Get(),
                    true  // bAutoDestroy = false (Persistent)
                );

                // Mapping에 저장
                InstData->PersistentAudioMapping.Add(Data.AudioHandle, AudioComponent);
            }
        };

        InstData->PersistentAudioActionQueue.Enqueue(Data);

        OutHandle.SetAndAdvance(AudioHandle);
    }
}
```

---

### 예시 5: 실시간 오디오 반응형 파티클 시스템

```hlsl
// Emitter: Audio-Reactive Visualizer
void SpawnParticle(out FParticleData Particle,
                  NiagaraDataInterfaceAudioSpectrum SpectrumDI,
                  float ParticleID)
{
    // 파티클 ID를 주파수 범위로 매핑
    float NormalizedFrequency = ParticleID / float(NumParticles);

    // 해당 주파수 밴드의 진폭 샘플링
    float Amplitude = SpectrumDI.GetSpectrumValue(NormalizedFrequency, 0);

    // 진폭이 임계값 이상일 때만 생성
    if (Amplitude < 0.3)
    {
        Particle.bKilled = true;
        return;
    }

    // 원형 배치 (주파수가 각도)
    float Angle = NormalizedFrequency * TWO_PI;
    float Radius = 100.0 + Amplitude * 200.0;

    Particle.Position = float3(
        cos(Angle) * Radius,
        sin(Angle) * Radius,
        0.0
    );

    // 색상은 주파수 스펙트럼에 따라 (Bass=Red, Mid=Green, Treble=Blue)
    Particle.Color = HSVtoRGB(NormalizedFrequency, 1.0, Amplitude);

    // 크기는 진폭에 비례
    Particle.Scale = Amplitude * 5.0;

    // 생명 시간은 짧게 (Flash 효과)
    Particle.Lifetime = 0.2;
}

void UpdateParticle(inout FParticleData Particle,
                   NiagaraDataInterfaceAudioSpectrum SpectrumDI,
                   float DeltaTime)
{
    // 파티클 ID로 주파수 재계산
    float NormalizedFrequency = Particle.ID / float(NumParticles);

    // 현재 진폭 샘플링
    float Amplitude = SpectrumDI.GetSpectrumValue(NormalizedFrequency, 0);

    // 진폭 변화에 따라 Scale 애니메이션
    Particle.Scale = lerp(Particle.Scale, Amplitude * 5.0, 0.5);

    // Fade Out
    Particle.Color.a = 1.0 - (Particle.Age / Particle.Lifetime);
}
```

**시스템 설정:**
- Emitter: Burst 방식 (매 프레임 128개 파티클 생성)
- Spectrum DI:
  - Resolution: 128
  - MinimumFrequency: 20 Hz
  - MaximumFrequency: 20000 Hz
  - NoiseFloorDb: -60 dB

---

### 예시 6: Multi-Channel Spectrum 분석 (스테레오)

```hlsl
// Stereo Visualizer
void UpdateParticle(inout FParticleData Particle,
                   NiagaraDataInterfaceAudioSpectrum SpectrumDI)
{
    float NormalizedFrequency = Particle.FrequencyIndex / 128.0;

    // 좌우 채널 샘플링
    float LeftAmplitude = SpectrumDI.GetSpectrumValue(NormalizedFrequency, 0);
    float RightAmplitude = SpectrumDI.GetSpectrumValue(NormalizedFrequency, 1);

    // X축은 주파수, Y축은 좌측 채널, Z축은 우측 채널
    Particle.Position = float3(
        NormalizedFrequency * 500.0,
        LeftAmplitude * 100.0,
        RightAmplitude * 100.0
    );

    // 채널 간 차이 시각화 (Stereo Width)
    float StereoWidth = abs(LeftAmplitude - RightAmplitude);
    Particle.Color = lerp(float3(0, 1, 0), float3(1, 0, 1), StereoWidth);
}
```

---

## 🔧 디버깅 및 트러블슈팅

### 일반적인 문제 해결

| 문제 | 원인 | 해결 방법 |
|------|------|----------|
| **Spectrum이 항상 0을 반환** | Submix 미설정 또는 오디오 재생 안 됨 | Submix 설정 확인, 사운드가 실제 재생 중인지 확인 |
| **에디터에서 오디오 재생 안 됨** | `bOnlyActiveDuringGameplay = true` | 에디터 프리뷰에서는 false로 설정 |
| **Persistent Audio가 즉시 정지됨** | Looping Sound가 아님 | SoundToPlay가 Looping=true인지 확인 또는 충분히 긴 사운드 사용 |
| **틱당 일부 파티클만 사운드 재생** | `MaxPlaysPerTick` 제한 초과 | MaxPlaysPerTick 값 증가 또는 bLimitPlaysPerTick=false |
| **GPU Spectrum이 업데이트되지 않음** | PostDataToGPU() 미호출 | FNiagaraDataInterfaceProxySpectrum::PostDataToGPU()가 매 프레임 호출되는지 확인 |
| **Oscilloscope 해상도가 낮음** | Resolution 값이 작음 | Resolution을 512 이상으로 증가 (최대 8192) |

---

### Console Commands

| 명령어 | 설명 |
|--------|------|
| `au.Debug.SoundCues 1` | Sound Cue 디버깅 정보 표시 |
| `au.3dVisualize.Attenuation 1` | 감쇠 범위 시각화 |
| `stat Audio` | 오디오 통계 표시 |
| `stat Niagara` | Niagara 통계 (Audio DI 포함) |
| `fx.Niagara.ShowOnlyAudioDebug 1` | Audio DI만 디버그 표시 |

---

### Profiling

**CPU Profiling:**
```cpp
DECLARE_CYCLE_STAT(TEXT("Audio DI update persistent sound"), STAT_NiagaraAudioDIUpdateSound, STATGROUP_Niagara);
DECLARE_CYCLE_STAT(TEXT("Audio DI create persistent sound"), STAT_NiagaraAudioDICreateSound, STATGROUP_Niagara);
DECLARE_CYCLE_STAT(TEXT("Audio DI stop persistent sound"), STAT_NiagaraAudioDIStopSound, STATGROUP_Niagara);
```
- `stat Niagara` 명령어로 확인
- "Audio DI" 항목에서 시간 측정

**GPU Profiling (Spectrum/Oscilloscope):**
```
stat GPU
ProfileGPU
```
- "NiagaraSimulation" Pass에서 시뮬레이션 시간 확인
- Spectrum/Oscilloscope GPU 버퍼 업로드는 "UpdateTextureRegions" 등에서 측정

---

### 시각화

**Submix Listener 디버깅:**

```cpp
// NiagaraDataInterfaceAudio.cpp
void FNiagaraSubmixListener::OnNewSubmixBuffer(...)
{
    UE_LOG(LogNiagara, Verbose, TEXT("Submix: %s, Samples: %d, Channels: %d, SampleRate: %d"),
           *OwningSubmix->GetName(), NumSamples, NumChannels, SampleRate);
}
```

**Spectrum 값 출력:**

```hlsl
// Niagara Script Debug
float DebugSpectrum(NiagaraDataInterfaceAudioSpectrum DI, float Freq)
{
    float Value = DI.GetSpectrumValue(Freq, 0);
    DebugPrint(Value);  // Niagara Debugger에 표시
    return Value;
}
```

---

## 📚 참고 자료

### 소스 파일 위치

| 파일 | 설명 |
|------|------|
| `NiagaraDataInterfaceAudio.h/cpp` | Submix Listener 기본 클래스 |
| `NiagaraDataInterfaceAudioSpectrum.h/cpp` | FFT/CQT 주파수 분석 |
| `NiagaraDataInterfaceAudioOscilloscope.h/cpp` | 파형 다운샘플링 |
| `NiagaraDataInterfaceAudioPlayer.h/cpp` | 오디오 재생 (One-Shot/Persistent) |

### 관련 Unreal 오디오 시스템

| 클래스 | 설명 |
|--------|------|
| `ISubmixBufferListener` | Submix 오디오 캡처 인터페이스 |
| `Audio::FPatchMixer` | 멀티 입력 오디오 믹싱 |
| `Audio::FPatchInput` | Lock-Free 오디오 Push |
| `Audio::FPatchOutput` | Lock-Free 오디오 Pop |
| `Audio::FContiguousSparse2DKernelTransform` | CQT Kernel |
| `Audio::IFFTAlgorithm` | FFT 변환 인터페이스 |
| `UAudioComponent` | Unreal 오디오 컴포넌트 |
| `USoundSubmix` | Submix 애셋 |
| `USoundAttenuation` | 감쇠 설정 |
| `USoundConcurrency` | 동시 재생 제한 |

### 관련 문서

- **Unreal Docs:** [Audio System Overview](https://docs.unrealengine.com/en-US/WorkingWithAudio/Overview/)
- **Unreal Docs:** [Sound Submixes](https://docs.unrealengine.com/en-US/WorkingWithAudio/Submixes/)
- **Unreal Docs:** [Niagara Audio](https://docs.unrealengine.com/en-US/RenderingAndGraphics/Niagara/Audio/)
- **DSP Theory:** [Constant-Q Transform](https://en.wikipedia.org/wiki/Constant-Q_transform)
- **DSP Theory:** [Fast Fourier Transform](https://en.wikipedia.org/wiki/Fast_Fourier_transform)

---

> 🔄 **Updated:** 2025-11-22 — Niagara Audio Integration 문서 생성 (Submix Listener, Spectrum FFT/CQT, Oscilloscope, Audio Player One-Shot/Persistent, Multi-Device Support)
