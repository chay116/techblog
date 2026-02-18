---
title: "Behavior Tree Execution Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "AI"
tags: ["unreal", "AI"]
engine_version: "Unreal Engine 5.7"
---
# Behavior Tree Execution Deep Dive

## 🧭 개요

**Behavior Tree**는 계층적 AI 의사결정 트리로, 조건과 행동을 노드로 구성합니다.

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Composite Node** | Selector (OR), Sequence (AND), Simple Parallel |
| **Task Node** | 실제 행동 (MoveTo, Attack, Wait) |
| **Decorator** | 조건 (Blackboard 값 확인) |
| **Service** | 주기적 업데이트 (시야 체크) |
| **Blackboard** | AI 메모리 (TargetActor, Patrol Location) |

---

## 🏗️ Behavior Tree Structure

```
Root (Selector)
  ├─ [Decorator: Has Target?] Sequence
  │   ├─ Task: MoveTo(Target)
  │   └─ Task: Attack(Target)
  └─ Sequence
      ├─ Task: FindPatrolPoint
      └─ Task: MoveTo(PatrolPoint)
```

---

## ⚡ Execution Flow

```cpp
// Tick (매 프레임)
1. Evaluate Decorators (조건 체크)
2. Active Node 실행:
   - Selector: 첫 번째 성공할 때까지
   - Sequence: 모든 자식 성공까지
3. Task 실행 결과:
   - Success → 다음 노드
   - Failure → 부모로 돌아감
   - InProgress → 계속 대기
```

---

## 🎮 예시

### Task: MoveTo

```cpp
UCLASS()
class UBTTask_MoveTo : public UBTTaskNode
{
    virtual EBTNodeResult::Type ExecuteTask(UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory) override
    {
        AAIController* AI = OwnerComp.GetAIOwner();
        FVector TargetLocation = OwnerComp.GetBlackboardComponent()->GetValueAsVector("MoveToLocation");

        AI->MoveToLocation(TargetLocation);
        return EBTNodeResult::InProgress;  // Async
    }

    virtual void TickTask(UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory, float DeltaTime) override
    {
        if (AI->HasReachedDestination())
        {
            FinishLatentTask(OwnerComp, EBTNodeResult::Succeeded);
        }
    }
};
```

### Decorator: Blackboard Condition

```cpp
UCLASS()
class UBTDecorator_HasTarget : public UBTDecorator
{
    virtual bool CalculateRawConditionValue(UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory) const override
    {
        UBlackboardComponent* BB = OwnerComp.GetBlackboardComponent();
        return BB->GetValueAsObject("TargetActor") != nullptr;
    }
};
```

---

## 📊 성능

**Behavior Tree (100 AI):**
- Tree Evaluation: ~0.5ms/AI
- Total (100 AI): ~50ms

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - Behavior Tree