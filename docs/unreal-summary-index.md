# Unreal Summary Index

이 문서는 `posts/unreal-summary/` 유지보수용 인덱스다.  
목표는 다음 세 가지다.

1. 상위 카테고리 구조를 한눈에 본다.
2. 어떤 카테고리부터 정리해야 하는지 우선순위를 잡는다.
3. 공개용 `posts/unreal-summary/Overview.md`와 동기화 기준을 남긴다.

## Current Snapshot

- Total docs: `223`
- Audit status: `metadata_issues=0`, `link_issues=0`
- Public entrypoint:
  - `posts/unreal-summary/Overview.md`
  - `site/unreal.html`

## Top-Level Categories

| Category | Count | Suggested role |
|---|---:|---|
| `Niagara` | 41 | 가장 큰 세부 묶음, 별도 로드맵 유지 필요 |
| `Rendering` | 28 | Nanite/RDG/RT/VT 등 핵심 렌더링 |
| `Physics` | 26 | Chaos 전체 구조와 실전 튜닝 |
| `Core` | 19 | 엔진 기초 진입점 |
| `Animation` | 17 | Animation framework 및 스키닝 |
| `Lumen` | 13 | GI/Reflection 하위 시스템 |
| `GameFramework` | 10 | Actor/World/Pawn/GameMode 중심 |
| `MuJoCoChaos` | 10 | 프로젝트 특화 통합 문서 |
| `AI` | 8 | BT/StateTree/Mass AI |
| `CoreUObject` | 8 | UObject/GC/Reflection |
| `Shader` | 8 | Shader system, permutation, parameters |
| `Gameplay` | 5 | Input/GAS/Camera |
| `Networking` | 4 | Iris, 서버 통합 |
| `Performance` | 4 | CPU/GPU 최적화, 프로파일링 |
| `World` | 4 | WP/HLOD/Streaming |
| `Movement` | 3 | CharacterMovement, Mover |
| `UI` | 3 | Slate/CommonUI/WebView |
| `Asset` | 2 | Asset Registry, Package/Linker |
| `Build` | 2 | UBT, Cooking |
| `Audio` | 1 | MetaSound |
| `Integration` | 1 | 외부 통합 |
| `Material` | 1 | Material system |
| `MultiThreading` | 1 | 멀티스레딩 |
| `RealWorld` | 1 | 실제 사례 분석 |
| `Scripting` | 1 | Blueprint VM |
| `VectorVM` | 1 | VectorVM |

## Recommended Maintenance Priority

### P0: Public entry quality

- `posts/unreal-summary/Overview.md`
- `posts/unreal-summary/VersionHistory.md`
- category-level `Overview.md` files that users hit first

이 문서들은 처음 열릴 가능성이 높기 때문에 가장 먼저 최신화해야 한다.

### P1: Core engine path

- `Core`
- `CoreUObject`
- `GameFramework`
- `World`
- `Performance`

입문 루트로 가장 많이 쓰일 묶음이다.

### P2: Rendering path

- `Rendering`
- `Shader`
- `Material`
- `Lumen`

GPU/graphics 관점 독자가 가장 많이 들어올 가능성이 높은 묶음이다.

### P3: Large specialist sets

- `Niagara`
- `Physics`
- `Animation`
- `AI`

문서 수가 많아 별도 내부 인덱스가 있으면 좋다.

## Known Cleanup Items

- 일부 Unreal summary 문서는 한글 인코딩이 깨져 있다.
- 일부 category `Overview.md`는 현재 실제 문서 수와 구조를 완전히 반영하지 못한다.
- `VersionHistory.md`는 공개 루트 문서인데 현재 가독성이 좋지 않다.

## Next Suggested Tasks

1. `VersionHistory.md` 복구
2. 깨진 `Overview.md` 묶음 우선 복구
3. `Niagara`, `Rendering`, `Physics`에 category-level curated reading order 추가
4. 필요하면 category count를 스크립트로 자동 생성
