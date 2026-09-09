# WT-Spike Implementation Summary

## Outcome

승인된 60분 vertical spike의 필수 범위를 구현했다. 하나의 SR에 대해 deterministic Git worktree를 준비하고 legacy AI-DLC state를 읽으며, 정확한 resume prompt를 해당 worktree `cwd`에서 shell 없이 실행한다. 실행 전후 관리 파일 SHA-256 manifest delta와 최소 API/UI 상태를 제공한다.

이 결과는 production-ready P0+P1 구현이 아니라 기술 증거다. Durable repository/workspace/run/checkpoint schema, restart recovery, official profile, drift/edit/approval/restore와 review/handoff는 포함하지 않는다.

## Created Application Files

- `src/worktree-spike/contracts.ts`
- `src/worktree-spike/worktree-spike-service.ts`
- `src/worktree-spike/http/worktree-spike-routes.ts`
- `src/worktree-spike/git/git-command-policy.ts`
- `src/worktree-spike/git/git-worktree.ts`
- `src/worktree-spike/state/legacy-aidlc-state-parser.ts`
- `src/worktree-spike/manifest/scoped-manifest.ts`
- `src/worktree-spike/runner/worktree-aidlc-runner.ts`
- `src/worktree-spike/ui/worktree-spike-client.ts`
- `src/worktree-spike/ui/WorktreeSpikePanel.tsx`

## Modified Existing Files

- `src/app/config.ts` — `PLANREPO_REPOSITORY_PATH`, `PLANREPO_WORKSPACE_ROOT` 설정 추가
- `src/app/create-app.ts` — spike service와 lifecycle 조합
- `src/sr-document-foundation/http/routes.ts` — 기존 공통 API guard 뒤에 spike routes mount
- `src/sr-document-foundation/ui/SRDetailPage.tsx` — additive status panel 배치
- `package.json`, `package-lock.json` — exact `fast-check` 4.9.0 devDependency
- `tests/sr-document-foundation/config.test.ts` — 새 config resolution regression coverage

## Created Tests

- Git policy/worktree: 12 tests
- Legacy state/manifest/PBT: 10 tests
- Runner/client: 7 tests
- HTTP와 isolated vertical integration: 3 tests

총 8개 spike test file의 32 tests가 통과한다. 전체 suite는 31 files, 118 tests가 통과한다.

## Runtime Contract

- `PLANREPO_REPOSITORY_PATH`가 없으면 spike status는 `configured: false`이며 provision은 bounded 409 error를 반환한다.
- `PLANREPO_WORKSPACE_ROOT` 기본값은 `<app-root>/.planrepo/worktrees`다.
- `GET /api/srs/:srId/worktree-spike`
- `POST /api/srs/:srId/worktree-spike/provision`
- `POST /api/srs/:srId/worktree-spike/resume`
- POST는 기존 root API 정책에 따라 JSON body와 UUID `X-Operation-Id`가 필요하다.
- 정확한 prompt는 `aidlc-docs/aidlc-state.md를 확인하고, 첫 번째 미완료 항목부터 이어서 진행해주세요.`다.

## Partial Story Evidence

| Story | Evidence | Remaining |
| --- | --- | --- |
| US-WT-03 | deterministic branch/path, rediscovery, SR isolation | durable repository/workspace schema |
| US-WT-04 | legacy state current stage와 첫 미완료 항목 | official profile와 ambiguity recovery |
| US-WT-06 | scoped SHA-256 manifest와 delta | immutable checkpoint/blob/restore |
| US-WT-07 | strict Git allowlist, destructive command denial, shell-free calls | complete policy surface와 audit persistence |
| US-WT-08 | exact prompt, worktree cwd, cancellation lifecycle | durable run/transcript/restart recovery |
| US-WT-10 | status API/client/panel, stable test IDs | full UX, browser regression, product integration |

어떤 story도 이 spike만으로 전체 완료 처리하지 않는다.

## Known Limitations and Backlog

- Service view와 operation deduplication은 process memory에만 있으며 restart 후 복구되지 않는다.
- Manifest는 변경 증거이지 복원 가능한 checkpoint가 아니다.
- 실제 Claude CLI와 인증된 provider smoke는 수행하지 않았다. 검증 결과는 injected fake launcher다.
- Local UI browser smoke는 timebox 내 필수 검증을 우선해 수행하지 않았다. Client typecheck와 production bundle 포함은 확인했다.
- Vite production build는 성공했지만 기존 500 kB 초과 chunk warning은 유지된다.
- Deployment/IaC artifact는 승인된 Infrastructure Design skip과 local technical spike 범위상 N/A다.

## Extension Compliance

- Security Baseline: disabled, N/A. Root containment, symlink exclusion과 shell-free process는 spike invariant로 구현했다.
- Resiliency Baseline: disabled, N/A. Durable recovery는 backlog다.
- PBT Partial: PBT-02/03/07/08/09 compliant. `fast-check` 4.9.0, reusable generators, round-trip/invariants, seed `424242`, 150 runs/property와 shrinking enabled evidence가 있다.
