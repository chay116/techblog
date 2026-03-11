---
title: "Movement (이동 시스템)"
date: "2026-02-19"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Movement"
tags: ["unreal", "GameFramework", "Movement"]
---
# Movement (이동 시스템)

> Updated: 2026-02-19 — Overview.md 최초 생성

## 🧭 개요

언리얼 엔진의 **이동 시스템** 카테고리는 캐릭터 이동과 네트워크 동기화를 다룹니다. 기존 CharacterMovementComponent와 차세대 Mover Plugin의 비교 분석, 그리고 네트워크 예측(Client-Side Prediction) 및 서버 보정(Reconciliation) 메커니즘을 포괄합니다.

## 📂 문서 목록

| 문서 | 설명 |
|------|------|
| [MoverVsCharacterMovement.md](./MoverVsCharacterMovement.md) | Mover Plugin vs CharacterMovementComponent 비교 분석 |
| [CharacterMovement_NetworkPrediction_Deep_Dive.md](./CharacterMovement_NetworkPrediction_Deep_Dive.md) | 네트워크 예측, 서버 보정, Move Buffering 심층 분석 |

## 🔗 관련 카테고리

- [AI](../AI/) - Mover Plugin & Mass AI 연계
- [Performance](../Performance/) - 이동 연산 CPU 최적화