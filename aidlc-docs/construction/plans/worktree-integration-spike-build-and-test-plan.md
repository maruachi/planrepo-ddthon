# WT-Spike Build and Test Plan

이 체크리스트는 승인된 WT-Spike generated artifacts의 focused Build and Test 단계를 추적한다. 기존 PlanRepo 최종 build/test 문서는 brownfield in-place addendum으로 갱신한다.

- [x] Step 1 — Generated artifact Q1 B 승인과 사용자 원문을 기록하고 Code Generation 완료 처리
- [x] Step 2 — Build and Test 상세 규칙, spike implementation/verification와 기존 instruction files 로드
- [x] Step 3 — Typecheck, full tests, production build를 Build and Test stage evidence로 재실행
- [x] Step 4 — `build-instructions.md`에 worktree config, build artifact와 warning/troubleshooting 추가
- [x] Step 5 — `unit-test-instructions.md`에 118-test 구성과 PBT seed/replay 명령 추가
- [x] Step 6 — `integration-test-instructions.md`에 isolated Git/fake runner/API 시나리오와 cleanup 추가
- [x] Step 7 — `performance-test-instructions.md`에 spike N/A 판정과 20,000-file deferred 기준 추가
- [x] Step 8 — `build-and-test-summary.md`에 최신 결과, fake/real 경계와 Operations readiness 작성
- [x] Step 9 — Security/Resiliency disabled, PBT Partial 규칙별 compliance와 content validation 확인
- [x] Step 10 — State/audit를 갱신하고 표준 Operations 승인 prompt 제시
- [ ] Step 11 — 명시적 승인 후에만 Operations placeholder로 전환

## Focused Test Strategy

- Unit/example: Git policy/worktree, legacy parser, manifest capture/diff, runner와 client guard
- Property-based: manifest round-trip, deterministic ordering, managed relative-path invariant
- Integration: actual local Git worktree + filesystem and fake launcher vertical proof; HTTP service operation deduplication
- Regression: complete existing and spike Vitest suite
- Build: client/server/test typecheck, comparison worker, Vite client와 Node server
- Performance: 20,000-file acceptance는 spike 범위 밖이며 측정하지 않음
- Security: extension disabled; dependency audit result와 root/symlink/shell invariants만 사실로 기록
- E2E: browser/real Claude CLI는 이번 spike에서 미실행, fake proof로 대체 주장하지 않음
