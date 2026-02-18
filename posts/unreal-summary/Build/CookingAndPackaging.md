---
title: "Cooking & Packaging Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Build"
tags: ["unreal", "Build"]
---
# Cooking & Packaging Deep Dive

## 🧭 개요

**Cooking**은 에셋을 플랫폼별로 최적화하고, **Packaging**은 실행 파일을 생성합니다.

---

## 🍳 Cooking Process

```
1. Asset Collection (모든 Referenced Assets)
2. Shader Compilation (Platform별 Shader)
3. Texture Compression (BC7/ASTC/etc.)
4. Package Optimization (Cooked .uasset)
5. PAK File 생성 (압축)
```

---

## 📦 Packaging

```
// Project Settings → Packaging
- Build Configuration: Shipping
- Compression: Enabled
- Pak File: Single PAK

// Command Line Packaging
RunUAT.bat BuildCookRun -project="MyProject.uproject" -platform=Win64 -configuration=Shipping -cook -stage -pak -archive
```

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Cooking & Packaging