# WT-Spike Code Generation Plan

이 문서는 승인된 [1시간 Vertical Spike execution plan](../../inception/plans/worktree-integration-one-hour-execution-plan.md)을 구현하는 **단일 source of truth**다. Code Generation Part 2는 이 계획이 명시적으로 승인된 뒤에만 시작한다. 승인 시점부터 60분 hard stop을 적용한다.

## Part 1 — Planning 완료 기록

- [x] Step P1 — `aidlc-state.md`, brownfield reverse-engineering code structure, 승인된 requirements/stories와 spike execution plan 검토
- [x] Step P2 — 기존 TypeScript/React/Express/Git/CLI 통합 경계와 수정 대상 파일 확인
- [x] Step P3 — 단일 WT-Spike context, 계약, service boundary와 database 비소유 결정을 문서화
- [x] Step P4 — Lead + 3개 lane의 비충돌 파일 ownership과 통합 순서 확정
- [x] Step P5 — example test, PBT, typecheck와 isolated smoke 검증 계획 포함
- [x] Step P6 — Security/Resiliency disabled 및 PBT Partial 적용성 검토
- [x] Step P7 — 실행 단계별 numbered checkbox와 story traceability 작성
- [x] Step P8 — Code Generation 계획 승인 질문과 audit prompt 작성
- [x] Step P9 — 전체 Code Generation 계획 명시적 승인 — Q1 B, 2026-09-09T03:46:59Z

## Unit Context

- **Unit**: `WT-Spike` 하나만 사용한다. 정식 Units Generation은 승인된 timebox에 따라 skip되었다.
- **Project**: Brownfield PlanRepo. 기존 파일은 in-place 수정하고 `_new`, `_modified` 같은 복제 파일을 만들지 않는다.
- **목적**: 한 SR의 deterministic Git worktree 준비, legacy AI-DLC state 파싱, 정확한 resume prompt/cwd 실행, 관리 파일 manifest delta, 최소 API/UI를 한 vertical slice로 증명한다.
- **비목적**: 승인된 P0+P1 전체 stories의 production 구현, durable persistence/checkpoint/restore, official profile, drift/edit/approval/review/handoff는 포함하지 않는다.
- **Database entities**: 새 entity나 migration 없음. Spike 상태와 operation 중복 방지는 process memory에 한정되며 재시작 복구를 주장하지 않는다.
- **External dependency**: local Git executable, configured local repository, optional Claude executable. 테스트는 isolated Git fixture와 fake executable을 사용한다.

## Story Slice Traceability

아래 story는 **부분 기술 증거**만 만든다. 이 계획 완료만으로 story 전체를 `[x]` 처리하지 않는다.

| Story | Spike contribution | 완료 주장 |
| --- | --- | --- |
| US-WT-03 격리된 SR Worktree 준비 | deterministic branch/path provision과 rediscovery | Partial |
| US-WT-04 AI-DLC Profile 탐색과 상태 판정 | legacy `aidlc-state.md`의 current stage와 첫 미완료 항목 | Partial; official profile 제외 |
| US-WT-06 관리 파일 Checkpoint 생성 | scoped pre/post hash manifest와 delta | Partial; durable checkpoint/blob 제외 |
| US-WT-07 Git 쓰기 정책 적용 | 최소 deny policy와 shell-free Git 호출 | Partial |
| US-WT-08 실제 Worktree에서 AI-DLC 시작·재개 | 정확한 resume prompt와 worktree cwd runner proof | Partial |
| US-WT-10 실제 상태 기반 진행 화면 | readiness, parsed stage, run status, changed paths 표시 | Partial |

## Frozen Contracts and Invariants

Lead는 첫 5분에 `src/worktree-spike/contracts.ts`를 생성하고 다음 계약을 고정한다.

- `RESUME_PROMPT`의 정확한 값은 `aidlc-docs/aidlc-state.md를 확인하고, 첫 번째 미완료 항목부터 이어서 진행해주세요.`다.
- `WorktreeHandle`은 `srId`, `repositoryRoot`, `branch`, `worktreeRoot`, `readiness`를 갖는다.
- `ParsedAidlcState`는 `statePath`, `currentStage`, `firstIncomplete`, `status`를 갖는다.
- `ManifestEntry`, `ScopedManifest`, `ManifestDelta`는 정렬된 relative path와 SHA-256 hash, created/modified/deleted path를 표현한다.
- `WorktreeSpikeView`는 `configured`, worktree readiness, parsed stage/incomplete item, run status와 changed paths만 클라이언트에 노출한다.
- 모든 filesystem path는 canonical worktree root 아래여야 한다. `.git`, worktree 밖 경로와 외부 symlink는 읽지 않는다.
- 같은 SR provision은 같은 `planrepo/sr/<sr-id>` branch/worktree를 재발견한다. 서로 다른 SR은 같은 path를 공유하지 않는다.
- Git과 Claude process는 `spawn`/`execFile`의 `shell: false`만 사용한다.
- manifest ordering과 serialization은 deterministic하다.

## Exact File Ownership

### Lead — contracts and integration only

새 파일:

- `src/worktree-spike/contracts.ts`
- `src/worktree-spike/worktree-spike-service.ts`
- `src/worktree-spike/http/worktree-spike-routes.ts`
- `tests/worktree-spike/integration.test.ts`

기존 파일 in-place 수정:

- `src/app/config.ts`
- `src/app/create-app.ts`
- `src/sr-document-foundation/http/routes.ts`
- `src/sr-document-foundation/ui/SRDetailPage.tsx`
- `package.json`
- `package-lock.json`
- `tests/sr-document-foundation/config.test.ts`

### Lane A — Git/worktree only

- `src/worktree-spike/git/git-command-policy.ts`
- `src/worktree-spike/git/git-worktree.ts`
- `tests/worktree-spike/git/git-command-policy.test.ts`
- `tests/worktree-spike/git/git-worktree.test.ts`

### Lane B — state/manifest/PBT only

- `src/worktree-spike/state/legacy-aidlc-state-parser.ts`
- `src/worktree-spike/manifest/scoped-manifest.ts`
- `tests/worktree-spike/state/legacy-aidlc-state-parser.test.ts`
- `tests/worktree-spike/manifest/scoped-manifest.test.ts`
- `tests/worktree-spike/manifest/scoped-manifest.property.test.ts`
- `tests/worktree-spike/manifest/generators.ts`

### Lane C — runner/status UI only

- `src/worktree-spike/runner/worktree-aidlc-runner.ts`
- `src/worktree-spike/ui/worktree-spike-client.ts`
- `src/worktree-spike/ui/WorktreeSpikePanel.tsx`
- `tests/worktree-spike/runner/worktree-aidlc-runner.test.ts`
- `tests/worktree-spike/ui/worktree-spike-client.test.ts`

Lane은 공통 계약이나 다른 lane 파일을 직접 수정하지 않는다. 계약 변경이 필요하면 Lead가 조정한다. Sub-agent 병렬 작업은 사용자가 요청한 병렬 실행 범위 안에서, 승인 후에만 시작한다.

## HTTP and UI Boundary

- `PLANREPO_REPOSITORY_PATH`: spike 대상 local repository. 미설정 시 status는 `configured: false`이고 mutation은 명시적 오류를 반환한다.
- `PLANREPO_WORKSPACE_ROOT`: managed worktree root. 기본값은 app root 아래 `.planrepo/worktrees`다.
- `GET /api/srs/:srId/worktree-spike`: 현재 process의 spike view 조회.
- `POST /api/srs/:srId/worktree-spike/provision`: deterministic worktree 준비와 legacy state 파싱.
- `POST /api/srs/:srId/worktree-spike/resume`: manifest-before → runner → manifest-after → delta를 수행한다.
- 기존 root API middleware의 loopback/origin, JSON content type와 `X-Operation-Id` 검증을 재사용한다. Service는 process-lifetime operation map으로 같은 operation의 중복 실행을 막는다.
- `WorktreeSpikePanel`은 SR detail에 additive하게 배치한다. 버튼과 status control은 `worktree-spike-*` 형태의 stable `data-testid`를 사용한다.

## Part 2 — Generation Execution Plan

### Step 1 — 0–5분: Preflight와 dependency lock

- [x] 기존 사용자 변경과 target 파일 존재 여부를 다시 확인하고 보존한다.
- [x] `node_modules`가 없으면 locked dependency install을 수행한다. — 기존 install 확인
- [x] Vitest 호환 `fast-check`를 devDependency로 설치하고 `package.json`과 `package-lock.json`에 resolved exact version을 기록한다.
- [x] `git`, Node 24, targeted test/typecheck 명령 가용성을 확인한다.

### Step 2 — 0–5분: Lead contract freeze

- [x] Lead가 `contracts.ts`와 frozen interfaces/constants를 생성한다.
- [x] Config의 repository/workspace 설정과 HTTP response shape를 고정한다.
- [x] 세 lane에 위 exact ownership과 contract를 전달하고 동시에 시작한다.
- [x] 이 단계 완료 즉시 이 plan의 Step 1/2 checkboxes와 `aidlc-state.md`를 갱신한다.

### Step 3 — 5–35분: Lane A Git/worktree 구현

- [x] 허용된 read/provision 명령만 실행하고 commit, push, reset `--hard`, clean을 거부하는 policy를 구현한다.
- [x] repository root 확인, canonical managed root 검사, deterministic branch/path 생성과 existing worktree rediscovery를 구현한다.
- [x] isolated local Git fixture로 동일 SR idempotency, 서로 다른 SR 격리와 deny policy example tests를 작성한다. — 12 tests passed
- [x] Lane A 완료 즉시 이 plan의 해당 checkboxes를 갱신하고 Lead에게 결과를 전달한다.

### Step 4 — 5–35분: Lane B legacy state/manifest/PBT 구현

- [x] legacy Markdown에서 current stage와 문서 순서상 첫 `- [ ]` 항목을 읽는 parser와 missing/malformed example tests를 구현한다.
- [x] `aidlc-docs/**/*.md`, root `AGENTS.md`, root `CLAUDE.md`만 SHA-256으로 capture하고 외부 symlink와 `.git`을 제외한다.
- [x] deterministic serialize/deserialize/diff와 created/modified/deleted example tests를 구현한다.
- [x] reusable relative-path/manifest generators를 작성하고 round-trip, sorted/deterministic, worktree-relative invariants를 `fast-check`로 검증한다.
- [x] shrinking을 비활성화하지 않고 재현 가능한 fixed seed를 test 설정에 명시하며 실패 출력으로 seed와 shrunk counterexample을 보존한다. — seed 424242, property당 150 runs
- [x] Lane B 완료 즉시 이 plan의 해당 checkboxes를 갱신하고 Lead에게 결과를 전달한다. — 10 tests passed

### Step 5 — 5–35분: Lane C worktree runner/status UI 구현

- [x] injected launcher를 지원하는 shell-free runner를 구현하고 worktree root를 유일한 `cwd`로 사용한다.
- [x] fake executable/launcher test에서 `RESUME_PROMPT`가 변경 없이 전달되고 cwd가 worktree root인지 검증한다.
- [x] API response guard/client와 readiness, stage, first incomplete item, run status, changed paths를 표시하는 panel을 구현한다.
- [x] provision/resume 버튼에 stable `data-testid`를 부여하고 client guard/mutation 상태 example tests를 작성한다. — 7 tests passed
- [x] Lane C 완료 즉시 이 plan의 해당 checkboxes를 갱신하고 Lead에게 결과를 전달한다.

### Step 6 — 5–45분: Lead service/API/composition 통합

- [x] process-memory operation deduplication을 포함한 `WorktreeSpikeService`를 작성하고 Lane A/B/C port를 조합한다.
- [x] 세 HTTP route와 validation을 추가하고 기존 root route의 catch-all 앞에 mount한다.
- [x] config와 `createApp`에서 spike dependencies와 close lifecycle을 연결한다.
- [x] `SRDetailPage.tsx`에 `WorktreeSpikePanel`을 additive하게 연결한다.
- [x] HTTP integration test에서 unconfigured error, provision view, resume delta와 duplicate operation 동작을 검증한다.

### Step 7 — 35–45분: Merge와 brownfield consistency

- [x] Lead가 lane 산출물을 frozen contract에 통합하고 lane 간 직접 의존이나 ownership 충돌을 제거한다.
- [x] 기존 planning/review route와 SR detail 흐름이 유지되는지 compile-level로 확인한다.
- [x] `_new`, `_modified` 등 duplicate brownfield 파일과 계획 밖 production 파일이 없음을 확인한다.
- [x] 45분 gate에서 compile 실패가 남으면 stretch 기능을 즉시 제외하고 필수 slice 수정에 집중한다. — compile failure 없음, N/A

### Step 8 — 45–55분: Focused tests와 PBT

- [x] `tests/worktree-spike/**` targeted Vitest를 실행한다. — 8 files, 32 tests passed
- [x] PBT output에 fixed seed가 식별되고 shrinking이 enabled임을 확인한다. — seed 424242
- [x] manifest round-trip, ordering/root-bound invariants와 example tests가 모두 통과해야 PBT-02/03/07/08/09를 compliant로 판정한다.
- [x] 실패 시 seed/counterexample과 미완료 범위를 기록하고 신규 기능 추가를 중단한다. — final run failure 없음, N/A

### Step 9 — 45–55분: Typecheck와 regression sample

- [x] `npm run typecheck`를 실행한다. — passed
- [x] 영향 경계의 기존 config, HTTP, planning 또는 review focused regression tests를 실행한다. — 12 files, 40 tests passed
- [x] 실패가 spike 변경 때문인지 pre-existing인지 증거와 함께 구분하고 spike regression은 해결한다. — sandbox EPERM과 test fixture defect 구분·해결

### Step 10 — 45–55분: Isolated vertical proof

- [x] OS temp의 local Git repository에 legacy `aidlc-docs/aidlc-state.md`와 관리 파일 fixture를 만든다.
- [x] 실제 Git worktree provision → legacy parse → fake runner의 파일 변경 → manifest delta를 한 흐름으로 검증한다.
- [x] branch/path, exact prompt, cwd, parsed stage/first incomplete와 changed paths 증거를 기록한다.
- [x] fixture와 test process를 정리하고 사용자 repository나 default DB에 runtime state를 남기지 않는다.

### Step 11 — 55–60분: Optional smoke

- [x] 시간이 남고 필수 검증이 통과한 경우에만 local UI status panel smoke를 수행한다. — SKIPPED, backlog에 기록; typecheck/build 우선
- [x] 사용 가능한 인증 환경이 명시적으로 확인된 경우에만 실제 Claude CLI 1회를 시도한다. — SKIPPED, 인증 환경을 가정하지 않음; fake proof와 구분
- [x] 실제 CLI smoke 때문에 60분 hard stop을 넘기지 않는다.

### Step 12 — 55–60분: Documentation과 handoff

- [x] `aidlc-docs/construction/worktree-integration-spike/code/implementation-summary.md`를 생성해 modified/created 파일과 partial story evidence를 기록한다.
- [x] 같은 directory의 `verification.md`에 명령, 결과, PBT seed, fake/real CLI 구분과 미완료 backlog를 기록한다.
- [x] deployment artifact는 Infrastructure Design skip과 local spike 성격상 N/A임을 기록한다.
- [x] 완료한 execution checkbox만 즉시 `[x]`로 바꾸고 미완료 항목은 열린 상태로 유지한다.
- [x] `aidlc-state.md`와 `audit.md`를 갱신하고 60분 hard stop 시점의 정확한 상태를 인계한다.

### Step 13 — Generated artifact review gate

- [x] 생성된 code/tests/docs의 review prompt를 audit에 기록한다.
- [x] 표준 2-option Code Generation 완료 메시지로 Request Changes 또는 Continue to Build and Test 승인을 요청한다.
- [x] 생성물 명시적 승인 응답을 기록하고서만 focused Build and Test 단계로 전환한다. — Q1 B, 2026-09-09T03:55:49Z

## Verification Success Boundary

Spike 성공은 다음이 모두 참일 때만 선언한다.

1. Isolated fixture에서 deterministic worktree provision/rediscovery가 통과한다.
2. Legacy parser가 current stage와 첫 미완료 항목을 반환한다.
3. Fake runner가 정확한 prompt와 worktree cwd를 증명한다.
4. Scoped manifest가 runner 변경의 created/modified/deleted paths를 deterministic하게 반환한다.
5. 최소 API/client/UI integration, targeted tests, enforced PBT와 typecheck가 통과한다.

실제 Claude CLI, full browser regression, production build, durable restart recovery와 18개 stories 전체 acceptance는 성공 조건이 아니다.

## Extension Compliance

| Extension/Rule | Code Plan Status | Required evidence |
| --- | --- | --- |
| Security Baseline | Disabled/N/A | 별도 enforcement 없음; root-bound path와 shell-free process는 frozen invariant |
| Resiliency Baseline | Disabled/N/A | durable recovery는 backlog |
| PBT-01 | Advisory/N/A | Partial mode; identified manifest/path properties만 구현 |
| PBT-02 | Required | manifest serialize/deserialize round-trip property |
| PBT-03 | Required | deterministic ordering과 root-bound relative path invariants |
| PBT-04 | Advisory/N/A | Partial mode non-blocking |
| PBT-05 | Advisory/N/A | Partial mode non-blocking |
| PBT-06 | Advisory/N/A | Partial mode non-blocking |
| PBT-07 | Required | reusable domain generators, valid/edge path와 manifest cases |
| PBT-08 | Required | shrinking enabled, fixed/logged seed, replayable failure evidence |
| PBT-09 | Required | Vitest-compatible `fast-check`, exact lockfile version |
| PBT-10 | Advisory/Planned | Git/parser/runner example tests를 PBT와 병행 |

Part 1 계획에는 blocking extension finding이 없다. Part 2에서 PBT-02/03/07/08/09 evidence가 누락되면 Code Generation 완료를 제시하지 않는다.
