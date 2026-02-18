---
title: "Chaos Debug & Profiling"
date: "2025-12-09"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Physics"
tags: ["unreal", "Physics"]
engine_version: "** Unreal Engine 5.7"
---
# Chaos Debug & Profiling

## 🧭 개요

**Chaos Debug & Profiling**은 물리 시스템의 문제를 진단하고 성능을 분석하는 도구 모음입니다. 시각화, 통계, 콘솔 명령을 통해 물리 동작을 검사할 수 있습니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **ChaosDebugDraw** | 물리 상태 시각화 시스템 |
| **Stats** | 물리 성능 통계 |
| **CVars** | 콘솔 변수로 디버그 제어 |
| **Profiling** | CPU/GPU 프로파일링 |

---

## 🧱 디버그 시각화 시스템

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Chaos Debug Visualization                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

  FChaosDe bugDrawQueue
         │
         ├── Shape Drawing
         │     ├── Spheres, Boxes, Capsules
         │     ├── Convex Hulls
         │     └── Triangle Meshes
         │
         ├── Contact Drawing
         │     ├── Contact Points
         │     ├── Contact Normals
         │     └── Penetration Depth
         │
         ├── Constraint Drawing
         │     ├── Joint Limits
         │     ├── Spring Forces
         │     └── Motor Targets
         │
         └── Simulation State
               ├── Velocities
               ├── Forces/Torques
               ├── Islands
               └── Sleep State

```

---

## 📂 주요 소스 파일

| 파일 | 역할 |
|------|------|
| `Chaos/Public/Chaos/ChaosDebugDraw.h` | 디버그 드로우 시스템 |
| `Chaos/Public/Chaos/ChaosDebugDrawDeclares.h` | 디버그 선언 |
| `Engine/Public/PhysicsEngine/PhysicsSettings.h` | 물리 설정 |
| `Chaos/Private/Chaos/ChaosDebugDraw.cpp` | 구현 |

---

## 🔷 주요 CVars

### 기본 시각화

```cpp
// 충돌체 시각화
p.Chaos.DebugDraw.Enabled = 1              // 디버그 드로우 활성화
p.Chaos.DebugDraw.Shapes = 1               // 충돌 모양 표시
p.Chaos.DebugDraw.ShapesShowStatic = 1     // 정적 물체 표시
p.Chaos.DebugDraw.ShapesShowKinematic = 1  // 키네마틱 물체 표시
p.Chaos.DebugDraw.ShapesShowDynamic = 1    // 동적 물체 표시

// 충돌 정보
p.Chaos.DebugDraw.Contacts = 1             // 접촉점 표시
p.Chaos.DebugDraw.ContactNormals = 1       // 접촉 노멀 표시
p.Chaos.DebugDraw.ContactErrors = 1        // 침투 오류 표시
```

### 시뮬레이션 상태

```cpp
// 물리 상태
p.Chaos.DebugDraw.Bodies = 1               // 바디 중심점 표시
p.Chaos.DebugDraw.Velocities = 1           // 속도 벡터 표시
p.Chaos.DebugDraw.Forces = 1               // 적용된 힘 표시
p.Chaos.DebugDraw.Transforms = 1           // 트랜스폼 축 표시

// Island 시스템
p.Chaos.DebugDraw.Islands = 1              // Island 경계 표시
p.Chaos.DebugDraw.IslandSleepState = 1     // Sleep 상태 표시

// 제약
p.Chaos.DebugDraw.Joints = 1               // 관절 표시
p.Chaos.DebugDraw.JointLimits = 1          // 관절 제한 표시
```

### Scene Query

```cpp
// 레이캐스트/스윕 시각화
p.Chaos.DebugDraw.SceneQuery = 1           // Scene Query 표시
p.Chaos.DebugDraw.Raycast = 1              // 레이캐스트 표시
p.Chaos.DebugDraw.Sweep = 1                // 스윕 표시
p.Chaos.DebugDraw.Overlap = 1              // 오버랩 표시
```

---

## 🔶 Stats Groups

### 물리 통계

```cpp
// 콘솔에서 활성화
stat Physics                    // 전체 물리 통계
stat ChaosStats                 // Chaos 상세 통계
stat ChaosCollision             // 충돌 통계
stat ChaosConstraints           // 제약 통계

// 개별 통계
stat ChaosThread                // 물리 스레드 통계
stat ChaosIslands               // Island 통계
stat ChaosSolver                // 솔버 통계
```

### 통계 항목 설명

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Physics Stats Breakdown                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  stat Physics:                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  FetchResults          : 결과 가져오기 시간                             │   │
│  │  StartPhysics          : 물리 시작 시간                                 │   │
│  │  SubstepSimulation     : 서브스텝 시뮬레이션 시간                       │   │
│  │  EndPhysics            : 물리 종료 시간                                 │   │
│  │  SyncComponentsToBodies: 컴포넌트 동기화 시간                           │   │
│  │  UpdateKinematics      : 키네마틱 업데이트 시간                         │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  stat ChaosStats:                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  NumRigidBodies        : 강체 수                                        │   │
│  │  NumActiveRigidBodies  : 활성 강체 수                                   │   │
│  │  NumSleepingBodies     : Sleep 강체 수                                  │   │
│  │  NumConstraints        : 제약 수                                        │   │
│  │  NumIslands            : Island 수                                      │   │
│  │  BroadPhaseTime        : Broadphase 시간                                │   │
│  │  NarrowPhaseTime       : Narrowphase 시간                               │   │
│  │  SolverTime            : 솔버 시간                                      │   │
│  │  IntegrationTime       : 적분 시간                                      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔷 에디터 디버그 도구

### Collision Analyzer

```
에디터 메뉴: Window > Developer Tools > Collision Analyzer

기능:
- 특정 Actor의 충돌 검사
- 충돌 채널 문제 진단
- 충돌 응답 확인
```

### Physics Debug View

```
뷰포트 메뉴: Show > Collision

표시 옵션:
- Simple Collision
- Complex Collision
- Collision Visibility
- Collision Response
```

---

## 🔶 런타임 디버깅

### C++ 디버그 코드

```cpp
// 디버그 드로우 직접 사용
void DrawPhysicsDebug(UWorld* World, FBodyInstance* Body)
{
    if (!Body) return;

    FTransform Transform = Body->GetUnrealWorldTransform();
    FVector Location = Transform.GetLocation();
    FVector LinearVel = Body->GetUnrealWorldVelocity();

    // 위치 표시
    DrawDebugSphere(World, Location, 10.f, 12, FColor::Green, false, -1.f);

    // 속도 벡터 표시
    DrawDebugDirectionalArrow(
        World,
        Location,
        Location + LinearVel.GetSafeNormal() * 100.f,
        20.f,
        FColor::Red,
        false,
        -1.f
    );

    // 바운딩 박스 표시
    FBox Box = Body->GetBodyBounds();
    DrawDebugBox(World, Box.GetCenter(), Box.GetExtent(), FColor::Yellow, false, -1.f);
}
```

### Blueprint 디버깅

```cpp
// Blueprint에서 사용 가능한 디버그 함수
UFUNCTION(BlueprintCallable, Category = "Physics|Debug")
static void DrawPhysicsBodyDebug(UPrimitiveComponent* Component)
{
    if (Component)
    {
        FBodyInstance* Body = Component->GetBodyInstance();
        if (Body)
        {
            // 디버그 시각화
            Body->DrawDebugPhysics();
        }
    }
}
```

---

## 🔷 프로파일링

### Unreal Insights

```
사용법:
1. -trace=default,physics 옵션으로 에디터 실행
2. Window > Developer Tools > Unreal Insights 열기
3. Physics 트랙 분석

분석 가능 항목:
- Physics Thread Timeline
- Substep Duration
- Solver Iterations
- Contact Generation
```

### CPU 프로파일링

```cpp
// 코드에 프로파일 스코프 추가
DECLARE_CYCLE_STAT(TEXT("Physics Simulation"), STAT_PhysicsSimulation, STATGROUP_Physics);

void TickPhysics(float DeltaTime)
{
    SCOPE_CYCLE_COUNTER(STAT_PhysicsSimulation);

    // 물리 시뮬레이션 코드
}
```

### 메모리 프로파일링

```
콘솔 명령:
memreport -full           // 전체 메모리 리포트
obj list class=RigidBody  // 강체 오브젝트 목록
stat memory               // 메모리 통계
```

---

## 💡 일반적인 디버깅 시나리오

### 1. 물체가 떨어지지 않음

```cpp
// 디버그 체크리스트:
// 1. Simulate Physics 활성화 확인
p.Chaos.DebugDraw.Bodies = 1    // 바디 상태 확인

// 2. 충돌 설정 확인
show Collision                   // 충돌체 표시

// 3. 중력 확인
p.Chaos.DebugDraw.Forces = 1    // 적용된 힘 확인
```

### 2. 물체가 서로 통과함

```cpp
// 디버그 체크리스트:
p.Chaos.DebugDraw.Contacts = 1         // 접촉점 확인
p.Chaos.DebugDraw.ContactErrors = 1    // 침투 오류 확인
p.Chaos.DebugDraw.CCD = 1              // CCD 상태 확인

// 솔버 반복 확인
p.Chaos.Solver.Iterations              // 현재 반복 횟수
```

### 3. 성능 저하

```cpp
// 프로파일링:
stat Physics                    // 물리 통계 확인
stat ChaosStats                 // 상세 통계

// 원인 분석:
p.Chaos.DebugDraw.Islands = 1   // Island 크기 확인
p.Chaos.DebugDraw.Contacts = 1  // 접촉 수 확인

// 최적화:
p.Chaos.Solver.Iterations = 4   // 반복 감소
p.Chaos.SleepThreshold = 0.1    // Sleep 임계값 조정
```

### 4. 제약 동작 이상

```cpp
// 제약 시각화:
p.Chaos.DebugDraw.Joints = 1          // 관절 표시
p.Chaos.DebugDraw.JointLimits = 1     // 제한 표시
p.Chaos.DebugDraw.JointErrors = 1     // 오류 표시
```

---

## 🔶 로깅

### 물리 로그 카테고리

```cpp
// LogChaos 활성화
Log LogChaos Verbose

// 특정 시스템 로그
Log LogChaosCollision Verbose
Log LogChaosSolver Verbose
Log LogChaosConstraints Verbose

// INI 설정
[Core.Log]
LogChaos=Verbose
```

### 커스텀 로깅

```cpp
// 물리 상태 로깅
void LogPhysicsState(UPrimitiveComponent* Comp)
{
    if (FBodyInstance* Body = Comp->GetBodyInstance())
    {
        FTransform T = Body->GetUnrealWorldTransform();
        FVector V = Body->GetUnrealWorldVelocity();

        UE_LOG(LogChaos, Log,
            TEXT("Body %s: Pos=%s Vel=%s Sleep=%d"),
            *Comp->GetName(),
            *T.GetLocation().ToString(),
            *V.ToString(),
            Body->IsSleeping()
        );
    }
}
```

---

## ⚙️ 성능 최적화 가이드

### 1. 통계 기반 최적화

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         Performance Optimization Guide                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  통계 항목            │ 높은 경우 원인            │ 해결 방법                   │
│  ─────────────────────┼──────────────────────────┼────────────────────────────  │
│  BroadPhaseTime       │ 물체 수 과다              │ 공간 분할, LOD 적용         │
│  NarrowPhaseTime      │ 복잡한 충돌체             │ 단순화, 컨벡스 분할         │
│  SolverTime           │ 많은 접촉/제약            │ 반복 감소, Sleep 활용       │
│  NumActiveRigidBodies │ Sleep 안 됨              │ Sleep 임계값 조정           │
│  NumIslands           │ Island 분산              │ 물체 그룹화                 │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2. 성능 CVars

```cpp
// 솔버 최적화
p.Chaos.Solver.Iterations = 4              // 기본 8에서 감소
p.Chaos.Solver.PushOutIterations = 2       // 푸시아웃 반복

// Sleep 최적화
p.Chaos.SleepThresholdLinear = 0.5         // 선형 속도 임계값
p.Chaos.SleepThresholdAngular = 0.5        // 각속도 임계값
p.Chaos.SleepFramesToSleep = 30            // Sleep까지 프레임

// Broadphase 최적화
p.Chaos.BroadphaseType = 1                 // 0=Grid, 1=AABB Tree
p.Chaos.BroadphaseCellSize = 100           // 그리드 셀 크기
```

---

## 🔗 관련 문서

- [Overview.md](Overview.md) - 물리 시스템 개요
- [Chaos_Complete_Architecture.md](Chaos_Complete_Architecture.md) - 전체 구조
- [Chaos_Threading_And_Synchronization.md](Chaos_Threading_And_Synchronization.md) - 스레딩

---

> 이 문서는 Chaos Physics Debug & Profiling 시스템을 설명합니다.