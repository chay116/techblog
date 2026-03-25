---
title: "Unreal Summary 개요"
date: "2026-03-26"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Meta"
tags: ["unreal", "Meta", "Overview"]
order: "0"
book: "Unreal Summary"
part: "Getting Started"
chapter: "전체 구조와 추천 읽기 순서"
---
# Unreal Summary 개요

이 문서는 `posts/unreal-summary/` 아래에 쌓인 Unreal Engine 문서 묶음의 **전체 지도**다.  
문서 수가 많기 때문에, 처음부터 전부 읽기보다 **관심 영역별 진입점**을 먼저 잡는 편이 훨씬 효율적이다.

현재 Unreal Summary는 **223개 문서**로 구성되어 있으며, 엔진 기초부터 렌더링, 물리, Niagara, UI, 네트워킹, 실제 사례 분석까지 폭넓게 다룬다.

## 1. 어떻게 읽는 것이 좋은가

읽는 순서는 목적에 따라 달라진다.

### 엔진 전체 구조를 먼저 잡고 싶은 경우

1. `Core`
2. `CoreUObject`
3. `GameFramework`
4. `World`
5. `Performance`

이 순서는 Unreal의 메모리/객체/월드/프레임 실행 구조를 먼저 이해하는 루트다.

### 렌더링 파이프라인을 먼저 보고 싶은 경우

1. `Rendering`
2. `Shader`
3. `Material`
4. `Lumen`
5. `Performance`

이 순서는 렌더링 백본을 먼저 보고, 그 다음 셰이더/머티리얼/Lumen으로 내려가는 루트다.

### 게임플레이 시스템을 먼저 보고 싶은 경우

1. `GameFramework`
2. `Gameplay`
3. `Movement`
4. `AI`
5. `Networking`

이 순서는 Actor, Pawn, Controller, 입력, 이동, 복제까지 자연스럽게 이어진다.

### VFX/시뮬레이션 쪽이 목적일 경우

1. `Niagara`
2. `VectorVM`
3. `Rendering`
4. `Performance`

Niagara는 문서 수가 가장 많고 내부 구조도 깊기 때문에, 먼저 개요와 파이프라인 문서를 읽는 편이 좋다.

## 2. 큰 분류

아래는 현재 Unreal Summary의 상위 카테고리와 문서 수다.

| 카테고리 | 문서 수 | 설명 |
|---|---:|---|
| `AI` | 8 | Behavior Tree, State Tree, EQS, Mass 기반 AI |
| `Animation` | 17 | AnimGraph, Blend, Skeletal Mesh, Control Rig |
| `Asset` | 2 | Asset Registry, Package/Linker |
| `Audio` | 1 | MetaSound |
| `Build` | 2 | UBT, Cooking/Packaging |
| `Core` | 19 | 메모리, 태스크 그래프, 문자열, 컨테이너, 콘솔 등 |
| `CoreUObject` | 8 | UObject, Reflection, GC, Serialization |
| `GameFramework` | 10 | Actor, Component, Pawn, World, Tick, GameMode |
| `Gameplay` | 5 | Camera, Enhanced Input, GAS 등 |
| `Integration` | 1 | 외부 시스템 통합 |
| `Lumen` | 13 | GI/Reflection/Lighting 구조 |
| `Material` | 1 | Material 시스템과 셰이더 컴파일 |
| `Movement` | 3 | CharacterMovement, Mover 비교 |
| `MuJoCoChaos` | 10 | MuJoCo와 Chaos 통합 실험/설계 |
| `MultiThreading` | 1 | 멀티스레딩 시스템 |
| `Networking` | 4 | Iris, 메시지 프로토콜, 서버 통합 |
| `Niagara` | 41 | Niagara 전체 아키텍처, 디버깅, 파이프라인 |
| `Performance` | 4 | CPU/GPU 최적화, 프로파일링 도구 |
| `Physics` | 26 | Chaos 전체 구조, 제약, 디버깅, 최적화 |
| `RealWorld` | 1 | 실제 게임 사례 분석 |
| `Rendering` | 28 | Nanite, RDG, RT, 그림자, 후처리, VT |
| `Scripting` | 1 | Blueprint VM |
| `Shader` | 8 | Shader 타입, 파라미터, permutation, 컴파일 |
| `UI` | 3 | Slate, CommonUI, WebView |
| `VectorVM` | 1 | SIMD VM 기반 실행 모델 |
| `World` | 4 | World Partition, HLOD, Streaming |

## 3. 추천 시작 문서

문서 수가 많은 카테고리는 입문용 시작점을 따로 잡는 편이 좋다.

### 엔진 기초

- `Core/Overview.md`
- `CoreUObject/UObject.md`
- `GameFramework/Overview.md`
- `World/Overview.md`

### 렌더링

- `Rendering/Nanite/Overview.md`
- `Rendering/Virtualization/Overview.md`
- `Shader/Overview.md`
- `Lumen/Overview.md`

### 게임플레이

- `GameFramework/Actor.md`
- `GameFramework/World.md`
- `Gameplay/Enhanced_Input_System_Deep_Dive.md`
- `Movement/CharacterMovement_NetworkPrediction_Deep_Dive.md`

### Niagara / VFX

- `Niagara/Overview.md`
- `Niagara/SimulationPipeline.md`
- `Niagara/GPU_Simulation_Pipeline_Deep_Dive.md`
- `VectorVM/Overview.md`

### 물리 / Chaos

- `Physics/Overview.md`
- `Physics/Chaos_Complete_Architecture.md`
- `Physics/Chaos_Solver_Deep_Dive.md`
- `Physics/Chaos_Performance_Optimization_Guide.md`

## 4. 권장 읽기 경로

### 경로 A: 엔진 구조 입문

- `Core/Overview.md`
- `CoreUObject/UObject.md`
- `GameFramework/Overview.md`
- `GameFramework/World.md`
- `GameFramework/TickSystem.md`

### 경로 B: UE5 렌더링 이해

- `Rendering/Virtualization/Overview.md`
- `Rendering/Nanite/Overview.md`
- `Rendering/Pipeline/DeferredShading.md`
- `Shader/Overview.md`
- `Lumen/Overview.md`

### 경로 C: 실전 성능 분석

- `Performance/Overview.md`
- `Performance/Profiling_Tools_Deep_Dive.md`
- `Performance/CPU_Optimization_Deep_Dive.md`
- `Performance/GPU_Optimization_Deep_Dive.md`

### 경로 D: Niagara 집중 탐구

- `Niagara/Overview.md`
- `Niagara/System_and_Emitter_Lifecycle.md`
- `Niagara/SimulationPipeline.md`
- `Niagara/GPU_Simulation_Pipeline_Deep_Dive.md`
- `Niagara/Debugger_and_Profiling.md`

## 5. 유지보수 메모

현재 구조는 카테고리별 분리는 잘 되어 있다. 다만 다음 두 가지는 후속 작업으로 남아 있다.

- 일부 오래된 Unreal 문서는 한글 인코딩이 깨져 있어 별도 복구 패스가 필요하다.
- 카테고리별 `Overview.md` 문서 중 일부는 최신 문서 수와 구조를 반영하도록 다시 손봐야 한다.

즉 이번 1차 정리는 **문서를 어디서부터 읽을지 정리하는 작업**이고, 다음 단계는 **깨진 카테고리 문서 복구 + overview 최신화**가 된다.

## 6. 관련 문서

- `VersionHistory.md`
- `Rendering/`
- `Physics/`
- `Niagara/`
- `GameFramework/`
- `Core/`
