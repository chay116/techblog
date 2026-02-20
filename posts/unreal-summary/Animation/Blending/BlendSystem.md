---
title: "언리얼 엔진 애니메이션 블렌딩 시스템"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Animation"
tags: ["unreal", "Animation", "Blending"]
---
# 언리얼 엔진 애니메이션 블렌딩 시스템

## 🧭 개요 (Overview)

애니메이션 블렌딩 시스템은 언리얼 엔진의 복잡한 애니메이션 전환 및 혼합을 관리하는 고급 메커니즘입니다. 이 시스템은 다음과 같은 주요 계층으로 구성됩니다:

- **알파 블렌딩 (Alpha Blending)**: 시간 기반 전환 곡선
- **포즈 블렌딩 (Pose Blending)**: 애니메이션 포즈 간 보간
- **본별 블렌딩 (Per-Bone Blending)**: 세밀한 개별 본 제어

이 문서는 블렌딩 시스템의 큰 그림을 빠르게 잡기 위한 상위 개요다. 세부 구현과 노드별 동작은 아래 문서에서 이어서 다룬다.

## 🔗 관련 문서 (Related Documents)

- [BlendProfiles.md](./BlendProfiles.md) - 본별 블렌딩 가중치 프로파일
- [Inertialization.md](./Inertialization.md) - 관성 기반 블렌딩
- [DeadBlending.md](./DeadBlending.md) - 데드 블렌딩
