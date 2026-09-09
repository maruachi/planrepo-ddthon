# Manual Board Status Movement Implementation Summary

## Outcome

계획 보드의 각 SR 카드에 `이전`과 `다음` 버튼을 추가했다. 버튼은 `COLUMNS`의 정규 순서에서 바로 인접한 열로만 이동하며 첫 열의 이전 버튼과 마지막 열의 다음 버튼은 비활성화된다.

수동 보드 위치는 nullable `srs.manual_board_column`에 저장된다. 보드 조회만 `manual_board_column`을 `workflow_column`보다 우선해 표시하고, SR 상세와 AI-DLC 계획 상태는 계속 `workflow_column`을 사용한다. 수동 이동 명령은 `PlanningService`를 호출하거나 planning workflow row를 쓰지 않는다.

## Main Changes

- Shared contract: `BoardMoveDirection`, `adjacentColumn`, `move_board` command와 board-item query/result를 추가했다.
- Storage: additive schema v6 migration, board-only projection과 expected-column 조건부 update를 추가했다.
- Service and HTTP: stale/non-adjacent 이동을 거부하고 operation receipt replay를 지원하는 `POST /api/srs/:srId/board-movements`를 추가했다.
- UI: 카드 상세 링크와 형제 관계인 이전/다음 버튼, boundary/busy disabled 상태, 성공 후 reload와 동일 operation ID를 재사용하는 오류 재시도를 추가했다.
- Tests: migration, persistence/restart, workflow non-mutation, service, HTTP, client/render와 fast-check property tests를 추가했다.

## API Contract

- Method and path: `POST /api/srs/:srId/board-movements`
- Required header: `X-Operation-Id`
- JSON body: `expectedColumn`, `targetColumn`
- Success: 변경된 `SRSummary`
- Conflict: 표시 열이 `expectedColumn`과 달라진 경우 `WORKFLOW_CONFLICT`
- Validation: 알려지지 않은 열, 추가 body field 또는 비인접 목표는 `VALIDATION_ERROR`

## Persistence Contract

- `manual_board_column`은 null 또는 정규 `COLUMNS` 값만 허용한다.
- 기존 row는 null로 migration되어 기존 보드 동작을 유지한다.
- update와 command receipt는 하나의 immediate transaction에서 commit된다.
- `Queries.sr()`와 planning write는 `workflow_column` 의미를 유지한다.
- 동일 operation ID와 fingerprint replay는 저장된 결과를 반환하고 추가 이동하지 않는다.

## Requirements Traceability

| Requirement | Evidence |
| --- | --- |
| FR-MB-01, FR-MB-03, FR-MB-06 | `SRCard`, `KanbanColumn`, `BoardPage` button, disabled, busy and error UI |
| FR-MB-02 | `adjacentColumn` and service adjacency validation |
| FR-MB-04 | `manual_board_column`, board-only projection and restart test |
| FR-MB-05 | Separate board movement ChangeSet and workflow non-mutation tests |
| FR-MB-07 | No drag/drop, menu or multi-card controls were introduced |
| NFR-MB-01 | Canonical typed column/direction helper and client guard |
| NFR-MB-02 | Additive v5 to v6 migration with preservation test |
| NFR-MB-03 | Atomic expected-column update plus idempotent receipt |
| NFR-MB-04 | Accessible button names, stable test IDs and sibling interactive markup |
| NFR-MB-05 | Focused, regression, typecheck, full-suite and production build evidence |

## Explicit Exclusions

- Drag and drop, arbitrary destination menus and bulk movement
- AI-DLC workflow advancement, rollback or synchronization
- Manual movement history timeline events
- New dependencies, infrastructure or deployment configuration

## Concurrent Change Preservation

현재 worktree의 별도 worktree document/review 기능, `peer_review` 열, UI 스타일과 migration v4/v5 변경은 유지했다. 이 Hotfix는 다음 사용 가능 schema version인 v6을 사용했고, 후속 worktree document 변경은 v7을 예약하고 있다.
