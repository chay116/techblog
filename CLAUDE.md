# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

GPU 최적화, vAI 프로젝트, 컴퓨트/렌더 API 비교(Vulkan, CUDA, HIP, GLSL)를 다루는 이중 언어(영어/한국어) 리서치 블로그. GitHub Pages 정적 사이트로 배포된다.

## 빌드 & 배포

- **사이트 데이터 빌드:** `python scripts/build_site.py` — `posts/` 하위의 `en.md`/`ko.md` 파일을 스캔하고 YAML frontmatter를 파싱하여 `site/posts.json` 생성
- **배포:** `main` 브랜치에 push하면 GitHub Actions가 자동 배포 (`.github/workflows/deploy-pages.yml`). 수동 배포 불필요.
- **로컬 미리보기:** 브라우저에서 `site/index.html`을 직접 열면 된다. 단, 포스트 뷰어(`site/post.html`)는 GitHub raw URL에서 마크다운을 가져오므로, 포스트 내용 확인은 `main`에 push된 상태여야 한다.

## 아키텍처

### 콘텐츠 파이프라인
1. 마크다운 포스트는 `posts/` 하위에 포스트별 디렉토리로 저장. 각 디렉토리에 `en.md`(영어)와/또는 `ko.md`(한국어) 파일 배치
2. `scripts/build_site.py`가 모든 포스트의 YAML frontmatter를 파싱하여 `site/posts.json`에 메타데이터, 태그, 자동 추출 요약(첫 번째 비-제목/비-테이블 문단)을 기록
3. 정적 사이트(`site/`)는 순수 vanilla JS — 프레임워크/번들러 없음. `app.js`가 인덱스 페이지의 클라이언트 사이드 필터링 담당, `post.js`가 GitHub raw 마크다운을 fetch하여 `marked.js`로 렌더링

### 콘텐츠 구조
- `posts/`: 발행용 포스트 (포스트별 디렉토리, `en.md`/`ko.md` + 선택적 `code/`, `build/`)
- `worklog/`: 날짜 기반 실험 로그 (WIP 허용)
- `comparisons/`: 안정화된 비교 문서 (사이트에 배포되지 않음)
- `notes/`: 원시 메모 및 아이디어 캡처
- `templates/`: worklog, comparison, note 작성 템플릿

### 포스트 디렉토리 구조
각 포스트는 다음과 같은 디렉토리 구조를 가진다:
```
posts/<category>/[<track>/]<YYYY-MM-DD-type-NN-topic>/
  en.md        ← 영어 포스트 (필수)
  ko.md        ← 한국어 포스트 (선택)
  code/        ← 관련 코드 (선택)
  build/       ← 빌드 산출물 (선택)
```
빌드 스크립트는 `en.md`와 `ko.md`만 수집하며, `code/`와 `build/` 등 다른 파일은 무시한다.

### 포스트 Frontmatter 스키마
모든 포스트에 아래 YAML frontmatter 필수:
```yaml
---
title: ""
date: "YYYY-MM-DD"
status: "wip"          # wip | stable
project: "vAI"
lang: "en"             # en | ko (생략 시 기본값 "en")
category: "worklog"    # worklog | comparison
track: "api-language"  # api-language | gpu-architecture | runtime-framework | tooling
tags: ["gpu"]
---
```

빌드 스크립트는 `category`와 `track`을 필터링에 사용한다. frontmatter 이후 첫 번째 본문 문단이 JSON 피드의 요약으로 추출된다.

### 파일 명명 규칙
- 포스트 디렉토리: `YYYY-MM-DD-<type>-<NN>-<topic>/` (예: `2026-02-14-worklog-01-cuda-vulkan-init-on-nvidia/`)
- 디렉토리 안의 언어 파일: `en.md`, `ko.md`
- 비교 문서: `comparison-<topic>.md`

## 비교 문서 정책

`comparisons/` 하위 파일은 반드시 포함해야 할 항목: (1) `# Code to Inspect` — 리포지토리 경로와 핵심 심볼, (2) `# Reference Materials` — 스펙/문서 직접 링크, (3) `# Evidence Mapping` — 주장과 코드 경로/참조 자료의 연결.
