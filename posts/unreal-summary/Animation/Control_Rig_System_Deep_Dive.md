---
title: "Control Rig System Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Animation"
tags: ["unreal", "Animation"]
---
# Control Rig System Deep Dive

## 🧭 개요

**Control Rig**는 런타임/에디터에서 Bone을 프로시저럴하게 제어하는 시스템입니다.

---

## 🎮 Control Rig 사용

```cpp
// Control Rig Asset 생성
UControlRig* ControlRig = NewObject<UControlRig>();

// Bone 제어
FRigUnit_SetBoneTransform SetBone;
SetBone.Bone = "Hand_R";
SetBone.Transform = FTransform(FRotator(0, 45, 0));
SetBone.ExecuteContext = Context;
```

---

## 🦴 IK (Inverse Kinematics)

```
// Two Bone IK (팔/다리)
Control Rig Node: FBIK (Full Body IK)
  - Effector: Hand_R Target
  - Root: Shoulder
  - Tip: Hand

→ Hand를 Target 위치로 이동 시 자동으로 팔꿈치 각도 계산
```

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Control Rig