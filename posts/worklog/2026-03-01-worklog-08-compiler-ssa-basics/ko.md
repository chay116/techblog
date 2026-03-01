---
title: "워크로그 #08 - 컴파일러 IR의 SSA 기초"
date: "2026-03-01"
status: "wip"
project: "vAI"
lang: "ko"
category: "worklog"
track: "tooling"
series: "compiler"
tags: ["compiler", "ssa", "llvm", "ir", "optimization"]
---

SSA(Static Single Assignment)는 컴파일러 중간표현(IR)을 이해할 때 가장 먼저 잡아야 하는 개념이다.
핵심 규칙은 단순하다.

1. 변수는 한 번만 정의된다.
2. 모든 사용(use)은 반드시 정의(def) 이후에 나타난다.

규칙 자체는 단순하지만, 최적화에서는 매우 강력하다. 값의 출처를 추적하는 비용이 줄어들기 때문이다.

# 재할당 코드와 SSA

일반 코드에서는 같은 이름이 여러 번 재할당된다.

```text
y = 1
y = 2
x = y
```

SSA로 바꾸면 이름이 분리되어 데이터 흐름이 바로 드러난다.

```text
y1 = 1
y2 = 2
x1 = y2
```

컴파일러 입장에서는 "x1이 어떤 값을 쓰는가"가 즉시 명확해진다.

# 분기 합류와 phi 함수

분기 이후 합류 지점에서는 phi가 필요하다.

```c
if (cond) {
  y = 10;
} else {
  y = 20;
}
x = y + 1;
```

SSA 형태는 아래와 비슷하다.

```text
if (cond) {
  y1 = 10
} else {
  y2 = 20
}
y3 = phi(y1, y2)
x1 = y3 + 1
```

`phi(a, b)`는 "어느 경로에서 왔는지"에 따라 값을 선택한다는 의미다.

# 왜 최적화가 쉬워지는가

SSA가 있으면 아래 패스들이 단순해진다.

- 상수 전파(Constant Propagation)
- 죽은 코드 제거(DCE)
- 전역 값 번호화(GVN)
- 루프 불변 코드 이동(LICM)

공통 이유는 동일하다. use-def 관계가 분명해서 값 추적이 쉬워진다.

# LLVM 관점

LLVM IR는 SSA 기반이다. 초기 IR에서 보이던 메모리 접근(`alloca/load/store`)은 `mem2reg` 같은 패스를 통해 SSA register 값으로 승격된다.
즉 SSA는 이론이 아니라 실제 최적화 파이프라인의 중심 구조다.

# GPU/저수준 코드 분석과 연결

GPU 최적화 문맥에서도 SSA 이해는 중요하다.

- 분기 합류 시 값 선택이 최종 코드에 어떻게 반영되는가
- 값 수명이 레지스터 압박으로 어떻게 이어지는가
- IR 최적화가 최종 ISA(SASS)에 어떤 영향을 주는가

결국 SSA를 이해하면 소스 코드와 최종 기계코드 사이를 훨씬 일관되게 읽을 수 있다.

# 참고 메모

기초 정리 참고: https://lifeisforu.tistory.com/507

# Reference Materials

- https://en.wikipedia.org/wiki/Static_single-assignment_form
- https://llvm.org/docs/LangRef.html
- https://llvm.org/docs/Passes.html
