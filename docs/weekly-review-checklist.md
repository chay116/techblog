# Weekly Review Checklist

## 1) Triage notes

- [ ] Move validated notes from `notes/` into `worklog/`.
- [ ] Drop or merge stale notes.

## 2) Worklog quality pass

- [ ] Ensure each worklog has executive summary + numeric success criteria.
- [ ] Ensure setup is reproducible (GPU, driver, flags, workload, warmup, run count).
- [ ] Ensure each worklog includes evidence (profiler counters or IR/ISA snippets).
- [ ] Ensure each worklog has decision + fallback + next actions.

## 3) Comparison consolidation

- [ ] Promote repeated conclusions into `comparisons/`.
- [ ] Ensure each comparison has weighted evaluation criteria.
- [ ] Ensure each recommendation states when not to use it.
- [ ] Mark uncertain claims as WIP, not stable.

## 4) Index maintenance

- [ ] Update `docs/worklog-index.md`.
- [ ] Update `docs/comparison-index.md`.

## 5) Forward plan

- [ ] Pick top 2 experiments for next week.
- [ ] Define one explicit kill-criteria for each planned experiment.
