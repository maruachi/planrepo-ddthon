# 통합 검증

사용자 DB와 분리된 PLANREPO_DB_PATH로 앱을 시작한다. 실제 CLI는 기존 인증과 사용자 설정을 사용한다.

1. SR을 생성하고 계획 생성을 시작한다. running에서 정상 결과 저장 또는 실패로 바뀌는지 확인한다. 실제 성공 문서의 본문·runId를 확인한다.
2. 필요한 질문에 답하고 문서 승인/수정 요청을 기록한다. 다음 단계와 같은 단계 재생성의 회차 차이를 확인한다.
3. 문서를 편집·비교·복원하고 과거 버전/본문 없는 결정 사건이 유지되는지 확인한다. 실행 중 편집은 늦은 AI 결과로 덮어쓰지 않아야 한다.
4. Inception/Construction에서 원래 버전에 리뷰를 요청하고 대기 중에도 자체 승인 후 진행한다. 리뷰어로 전환해 원래 버전 결과를 남기고 이후 버전의 승인으로 표시하지 않는지 확인한다.
5. 마지막 구현 계획을 승인해 구현 대기로 이동하고, 작성자가 수동 완료한다. CLI/빌드/Git 자동 실행이 없어야 한다.
6. 앱을 종료하고 같은 DB로 다시 시작해 SR·실제 생성 문서·이력·리뷰·수동 완료를 재열람한다. 주요 입력·확인을 키보드로 수행한다.

별도 실패 검증은 CLI 프로세스 실패, 잘못된 JSON/빈 출력, 실행 중 편집, 저장 롤백, 저장 후 응답 연결 유실을 포함한다. 자동 테스트는 임시 SQLite와 실제 Express 소켓으로 상태·원자성·receipt를 검증한다. 실인증 성공은 U2 verification.md의 별도 실행으로 확인했다.

최종 브라우저 흐름은 실제 생성된 초기 문서와 결정적 후속 단계 결과를 함께 사용했다. 전체 9단계를 실제 CLI로 반복 호출한 것은 아니다. 전체 E2E 프레임워크를 프로젝트 의존성으로 추가하지 않았다. 한 번의 실제 CLI 성공·실패와 단위/브라우저 연결을 구분한 증거는 각 단위 verification.md에 기록했다.

## Worktree Integration Spike Scenarios

### Scenario 1 — Git Worktree to Legacy State

- Setup: OS temporary directory에 local repository를 만들고 `AGENTS.md`, `aidlc-docs/aidlc-state.md`를 commit한다.
- Execute: `GitWorktreeManager.provision` 후 `LegacyAidlcStateParser.parse`를 호출한다.
- Expected: `planrepo/sr/<sr-id>`와 `<managed-root>/<sr-id>`가 일치하고 current stage와 첫 미완료 항목이 반환된다.
- Cleanup: test가 전체 temporary root를 삭제한다. 사용자 repository에는 접근하지 않는다.

### Scenario 2 — Runner to Manifest Delta

- Setup: provision된 worktree에서 pre-run manifest를 capture한다.
- Execute: injected fake launcher가 exact resume prompt와 worktree `cwd`를 확인하고 `aidlc-docs/generated.md`를 생성한다.
- Expected: post-run delta의 created path가 해당 파일이고 run status가 `succeeded`다.
- Boundary: 실제 Claude 인증/provider 성공을 증명하지 않는다.

### Scenario 3 — HTTP/API Composition

- Setup: in-memory fake ports를 사용하는 local Express test server를 시작한다.
- Execute: status, provision, resume를 호출하고 같은 `X-Operation-Id`를 재사용한다.
- Expected: unconfigured mutation은 bounded 409, 정상 resume은 202, duplicate operation은 runner 한 번만 실행한다.
- Cleanup: runner와 server를 닫는다.

```bash
npx vitest run tests/worktree-spike/integration.test.ts
```

자동 integration tests는 외부 서비스, remote clone, 사용자 DB와 실제 Claude CLI를 사용하지 않는다.

## Manual Board Status Movement Scenarios

### Scenario 1 — UI to HTTP to SQLite

- Setup: 임시 SQLite database를 사용하는 local test server를 시작하고 `sr_list` SR을 생성한다.
- Execute: 카드의 다음 동작과 동일한 body로 `POST /api/srs/:srId/board-movements`를 호출한다.
- Expected: board summary는 바로 다음 정규 열을 반환하고 재조회와 database reopen 후에도 유지된다.
- Cleanup: test server와 임시 database directory를 닫고 삭제한다.

### Scenario 2 — Manual Override Isolation

- Setup: AI-DLC workflow가 `inception`인 SR을 준비한다.
- Execute: expected `inception`, target `construction`으로 수동 보드 이동을 commit한다.
- Expected: board item만 `construction`으로 표시되고 SR detail과 planning workflow column/revision/status는 그대로다. PlanningService는 호출되지 않는다.

### Scenario 3 — Conflict and Replay

- Execute: 같은 operation ID와 동일 body를 두 번 호출한 뒤, 새 operation ID로 stale expected column과 비인접 target을 각각 전송한다.
- Expected: 동일 operation replay는 추가 이동 없이 성공하고 stale request는 409, 비인접 request는 400이며 저장 상태는 보존된다.

자동 실행 명령은 Unit Test 문서의 Manual Board focused suite와 같다. 별도 서비스 endpoint, credential 또는 cleanup command는 필요하지 않는다.

## Worktree Document Edit and History Scenarios

### Scenario 1 — AI Run to Immutable History

- Setup: 임시 SR, SQLite DB와 isolated Worktree에서 AI runner test double이 `aidlc-docs/**/*.md`를 생성한다.
- Execute: Worktree resume 후 current document와 version list를 조회한다.
- Expected: 전체 현재 Markdown set이 색인되고 첫 버전은 `ai_generated` v1이며 실제 파일 SHA-256과 본문이 일치한다.
- Cleanup: test가 임시 DB와 Worktree root를 삭제한다.

### Scenario 2 — Browser Contract to Atomic File and SQLite

- Execute: current hash와 새 본문을 UUID `X-Operation-Id`로 edit endpoint에 전송하고 같은 요청을 재전송한다.
- Expected: 실제 Worktree 파일과 latest pointer는 v2 `human_edit`로 바뀌고 v1은 그대로 남는다. 재전송은 같은 result를 반환하며 중복 버전을 만들지 않는다.
- Failure boundaries: stale hash, traversal, symlink, protected state/audit path와 1 MiB 초과는 원본을 변경하지 않는다. metadata commit failure는 catchable 범위에서 원본 복구를 시도한다.

### Scenario 3 — Historical Read and Restart

- Execute: v1 version ID를 명시해 읽고, 앱 service/database를 다시 열어 current와 history를 재조회한다.
- Expected: v1은 읽기 전용 과거 본문이고 v2는 최신이며, 재시작 전후 path/hash/body/origin/version identity가 같다.

### Scenario 4 — Next Unchanged AI Run

- Execute: 사람 편집된 파일이 있는 동일 Worktree에서 변경 없는 다음 resume을 수행한다.
- Expected: runner는 사람 편집 본문을 같은 `cwd`에서 읽을 수 있고, 문서 목록은 유지되며 동일 hash의 AI 버전을 추가하지 않는다.

```bash
./node_modules/.bin/vitest run tests/worktree-spike/integration.test.ts tests/worktree-spike/document-history.test.ts
```

통합 테스트는 local loopback server, 임시 SQLite와 임시 filesystem/Git fixture만 사용한다. 사용자 repository, 실제 Claude 인증, Git commit/add/push 또는 외부 endpoint는 사용하지 않는다.

## Initial SR Prompt Selection Hotfix Scenarios

### Scenario 1 — New SR to Initial Requirements Prompt

- **Setup**: no persisted Claude session ID; provide one SR title, description and optional Markdown attachment through the read-only requirements port.
- **Execute**: provision and resume the SR Worktree.
- **Expected**: the captured prompt contains only that SR's specification and ends with the AI-DLC requirements/workflow start sentence; runner executes once for a replayed operation ID.

### Scenario 2 — Existing Session to Exact Resume Prompt

- **Setup**: complete the first interactive run so its session ID is persisted.
- **Execute**: explicitly resume again.
- **Expected**: the same session ID is passed with resume mode and input equals `aidlc-docs/aidlc-state.md를 확인하고, 첫 번째 미완료 항목부터 이어서 진행해주세요.` exactly; SR requirements are not resent.

### Scenario 3 — Service Restart

- **Setup**: construct a new service instance over a persisted ready view containing the prior session ID.
- **Execute**: call resume without an in-memory child.
- **Expected**: exact resume mode is selected without reading SR requirements, then normal manifest/state collection completes.

### Scenario 4 — Missing SR Boundary

- **Setup**: configure the requirements provider to fail for the requested SR.
- **Execute**: attempt the first run.
- **Expected**: the request fails before any Claude runner invocation.

The focused command is documented in `unit-test-instructions.md`. Tests use fake runner/Claude boundaries, temporary SQLite/filesystem/Git fixtures and local loopback only. They do not invoke real Claude authentication or mutate a user repository.
