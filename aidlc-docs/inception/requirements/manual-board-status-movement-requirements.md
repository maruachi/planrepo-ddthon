# 수동 계획 보드 상태 이동 요구사항

## Intent Analysis

- **User request**: 계획 보드의 SR 카드를 버튼으로 수동 이동한다.
- **Request type**: 기존 기능 Hotfix enhancement.
- **Scope estimate**: 보드 UI, HTTP mutation, 상태 저장과 보드 조회 projection을 포함하는 소규모 다중 컴포넌트 변경.
- **Complexity estimate**: 사용자 동작은 단순하지만 기존 AI-DLC workflow column 우선순위와 충돌할 수 있어 저장 경계는 명시적으로 분리해야 한다.
- **Requirements depth**: Minimal. 사용자가 시간 제약과 최대 단계 생략을 명시했다.

## Functional Requirements

### FR-MB-01 수동 이전 및 다음 이동

각 SR 카드에는 현재 열을 기준으로 한 `이전 상태`와 `다음 상태` 버튼을 제공한다. 버튼은 `COLUMNS`에 정의된 여섯 상태 순서에서 인접한 한 열로만 이동한다.

### FR-MB-02 경계 상태

첫 번째 열에서는 `이전 상태`, 마지막 열에서는 `다음 상태`를 비활성화한다. 유효하지 않거나 비인접한 상태 이동은 서버에서도 거부한다.

### FR-MB-03 카드 탐색과 버튼 동작 분리

카드 본문 선택은 기존 SR 상세 화면으로 이동한다. 상태 이동 버튼 선택은 카드 링크 탐색을 일으키지 않고 상태 변경만 수행한다.

### FR-MB-04 독립적인 수동 상태

수동 보드 상태는 AI-DLC workflow의 stage, status, revision, cycle, 질문, 승인 또는 실행 상태를 읽거나 변경하지 않는다. 기존 planning advance/complete API를 재사용하지 않는다.

### FR-MB-05 표시 우선순위와 영속성

수동 이동이 한 번 저장된 SR은 해당 수동 상태를 보드 표시의 최우선 값으로 사용한다. 이 값은 애플리케이션 재시작 후에도 유지되며 이후 AI-DLC workflow 변화로 덮어쓰지 않는다. 수동 값이 없는 기존 SR은 기존 workflow/SR projection을 그대로 사용한다.

### FR-MB-06 사용자 피드백

이동 중에는 해당 카드의 이동 버튼을 중복 실행할 수 없게 한다. 성공하면 보드를 다시 조회해 카드를 새 열에 표시하고, 실패하면 현재 표시를 유지하면서 재시도 가능한 오류를 제공한다.

### FR-MB-07 변경 범위

Drag-and-drop, 자동 workflow 연동, 다중 카드 이동, 임의 상태 선택 메뉴, 이동 이력 화면, 권한 체계 변경은 구현하지 않는다.

## Non-Functional Requirements

- **NFR-MB-01 단순성**: 기존 React/Express/SQLite 구조와 고정 `COLUMNS` 목록을 재사용하며 신규 외부 dependency를 추가하지 않는다.
- **NFR-MB-02 데이터 보존**: 기존 SR, planning workflow, 문서, review와 worktree-spike 데이터 및 migration 이력을 변경하거나 삭제하지 않는 additive schema 변경을 사용한다.
- **NFR-MB-03 요청 안전성**: 기존 `X-Operation-Id`, JSON validation, typed error/result 경계를 유지하고 동일 요청의 중복 실행으로 추가 상태 변경이 발생하지 않게 한다.
- **NFR-MB-04 접근성**: 버튼은 명시적인 텍스트 또는 접근 가능한 이름, disabled 상태와 keyboard activation을 제공한다.
- **NFR-MB-05 회귀 방지**: 타입 검사, 수동 이동 서비스/API/UI 테스트, 기존 board projection 테스트와 전체 관련 테스트를 실행한다.

## Acceptance Scenarios

1. 중간 열의 카드에서 `다음 상태`를 선택하면 바로 다음 열로 이동하고 새로고침 후에도 유지된다.
2. 중간 열의 카드에서 `이전 상태`를 선택하면 바로 이전 열로 이동한다.
3. 첫 열과 마지막 열에서는 범위를 벗어나는 버튼을 사용할 수 없다.
4. AI-DLC workflow row가 존재하는 SR을 수동 이동해도 workflow state는 변경되지 않고 보드만 수동 상태를 표시한다.
5. 이동 요청이 실패하면 카드가 기존 열에 남고 오류와 재시도 경로가 표시된다.
6. 기존 수동 override가 없는 SR은 이전과 동일한 workflow 우선 projection을 사용한다.

## Technical Boundary

- 수동 보드 상태는 기존 workflow payload와 별도의 nullable override 또는 전용 additive record로 저장한다.
- 보드 조회 우선순위는 `manual board override` → `planning workflow column` → `initial SR column`이다.
- HTTP mutation은 목표 열과 현재 projection을 검증하되 AI-DLC policy/service를 호출하지 않는다.
- 정확한 파일과 storage contract는 최소 Workflow Planning과 Code Generation plan에서 확정한다.

## Stage Recommendation

- User Stories: Skip. 단일 사용자 Hotfix이며 acceptance scenarios가 직접적인 검증 기준을 제공한다.
- Application Design: Skip. 새 서비스 경계나 외부 시스템이 필요하지 않다.
- Units Generation: Skip. 단일 Hotfix unit이다.
- Functional/NFR/Infrastructure Design: Skip. 새 복잡한 business model, stack 또는 infrastructure가 없다.
- Workflow Planning, Code Generation, Build and Test: Mandatory minimal execution.

## Extension Configuration

- Security Baseline: Disabled; N/A for this Hotfix.
- Resiliency Baseline: Disabled; N/A for this Hotfix.
- Property-Based Testing: Partial. Requirements Analysis에는 직접 적용되는 blocking rule이 없다. Code Generation에서는 인접 열 계산 invariant에 PBT-03, PBT-07, PBT-08, PBT-09를 적용한다.
