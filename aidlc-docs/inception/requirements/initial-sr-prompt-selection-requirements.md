# Initial SR Prompt Selection Hotfix 요구사항

## Intent Analysis

- **User request**: 첫 Claude Code 세션은 고정된 재개 문구 대신 SR 요구사항 명세서를 포함하여 AI-DLC requirements 작성을 시작하고, 이후 재실행은 기존 `aidlc-state.md` 재개 문구를 사용한다.
- **Request type**: 기존 Worktree AI-DLC 실행 기능의 startup prompt bug fix와 focused enhancement.
- **Scope estimate**: Worktree 실행 서비스, SR 조회 경계, prompt 계약, runner 검증과 focused tests.
- **Complexity estimate**: Moderate. 최초 실행과 세션 재개를 정확히 구분하고 기존 interactive session 동작을 보존해야 한다.
- **Requirements depth**: Minimal. 사용자 동작과 30분 구현 제한이 명확하다.

## Timeboxed Solution Boundary

- 기존 Worktree provision, Claude interactive stream, session ID persistence와 HTTP endpoint를 재사용한다.
- 새 화면, 새 데이터베이스 migration, AI-DLC state schema 변경과 requirements-complete 전용 parser는 추가하지 않는다.
- 최초 실행 여부는 해당 SR에 저장된 Claude session ID 존재 여부로 판정한다.
- session ID가 없는 최초 실행은 현재 SR 원문의 제목, 설명, 선택적 첨부 Markdown을 prompt에 포함한다.
- session ID가 있는 후속 실행은 서버 재시작 여부와 무관하게 기존 session을 resume하고 고정 재개 prompt를 사용한다.

## Functional Requirements

### FR-ISP-01 최초 세션 prompt

1. 사용자가 준비된 SR Worktree에서 Claude 실행을 처음 시작하고 저장된 Claude session ID가 없으면 PlanRepo는 SR 원문을 조회해야 한다.
2. 최초 prompt는 `SR 요구사항 명세서` 제목 아래에 SR 제목과 설명을 포함해야 한다.
3. SR에 첨부 Markdown이 있으면 첨부 표시 이름과 본문도 최초 prompt에 포함해야 한다.
4. 최초 prompt는 SR 요구사항을 바탕으로 requirements 문서를 만들고 `AI-DLC workflows 진행합시다.`라는 시작 의도를 명시해야 한다.
5. 최초 prompt는 기존 고정 재개 문구만 단독으로 전송해서는 안 된다.

### FR-ISP-02 requirements 작성 후 재개 prompt

1. 최초 Claude session ID는 기존 방식대로 SR별로 저장해야 한다.
2. requirements 작성 과정 이후 사용자가 실행을 종료하고 다시 시작하거나 서버를 재시작한 뒤 명시적으로 실행하면, 저장된 같은 Claude session ID를 `--resume`으로 사용해야 한다.
3. 후속 실행의 시작 메시지는 아래 문구와 정확히 같아야 한다.

    `aidlc-docs/aidlc-state.md를 확인하고, 첫 번째 미완료 항목부터 이어서 진행해주세요.`

4. 후속 실행에서는 SR 요구사항 명세서를 다시 붙여 보내지 않아야 한다.
5. 다른 SR의 session ID나 요구사항을 섞어서는 안 된다.

### FR-ISP-03 호환성과 실패 처리

1. SR을 찾을 수 없거나 읽을 수 없으면 Claude process를 시작하지 않고 기존 bounded domain error로 반환해야 한다.
2. 이미 active process가 있는 SR에서 실행 버튼을 다시 눌러도 새 prompt나 process를 중복 전송하지 않아야 한다.
3. 실행 중 사용자가 보내는 후속 자유 텍스트 메시지, finish, cancel, transcript polling 동작은 변경하지 않아야 한다.
4. 기존 non-interactive runner 호환 경로에서도 최초 prompt와 재개 prompt가 허용된 prompt로 검증되어야 한다.

## Non-Functional Requirements

- **NFR-ISP-01 시간 한도**: 기존 service dependency와 pure prompt builder를 확장하는 방식으로 30분 내 구현 가능한 범위를 유지한다.
- **NFR-ISP-02 결정성**: 같은 SR 원문은 같은 최초 prompt를 생성하고 prompt 선택은 저장된 SR별 session ID에만 의존해야 한다.
- **NFR-ISP-03 안전성**: shell interpolation 없이 기존 argument 배열과 Worktree `cwd`를 유지한다.
- **NFR-ISP-04 데이터 경계**: SR 제목, 설명과 첨부 Markdown 외의 데이터는 최초 prompt에 추가하지 않는다.
- **NFR-ISP-05 회귀 방지**: Worktree provision, interactive continuation, document history, review와 board 기능을 보존한다.
- **NFR-ISP-06 검증**: 최초 prompt 내용, 첨부 유무, 후속 exact resume prompt, 서버 재시작 후 persisted session과 SR 격리를 focused tests로 검증한다.

## Acceptance Scenarios

1. session ID가 없는 SR에서 실행하면 captured Claude input에 SR 제목과 설명, `SR 요구사항 명세서`, `AI-DLC workflows 진행합시다.`가 포함된다.
2. 첨부 Markdown이 있는 SR에서는 표시 이름과 첨부 본문까지 최초 input에 포함된다.
3. 첨부가 없는 SR에서는 불필요한 첨부 섹션 없이 최초 input이 생성된다.
4. 최초 실행 이후 같은 SR을 다시 실행하면 captured input이 고정 재개 문구와 정확히 일치하고 같은 session ID를 resume한다.
5. persistence에서 기존 session ID를 읽은 새 service instance도 첫 실행부터 고정 재개 문구를 사용한다.
6. 두 SR을 실행해도 각 최초 prompt에는 해당 SR의 요구사항만 포함된다.
7. SR 조회 실패 시 runner는 호출되지 않는다.
8. focused tests, 전체 typecheck, 전체 test와 production build가 통과한다.

## Explicitly Deferred

- requirements stage 완료 여부를 별도 state 필드로 파싱하는 기능
- AI-DLC profile별 최초 prompt template 관리 UI
- prompt preview 및 사용자 편집 UI
- SR 첨부 외 파일 자동 수집
- 새 migration 또는 execution prompt 이력 모델

## Traceability

- 사용자 최초 실행 요구: FR-ISP-01, Acceptance 1–3.
- requirements 완료 후 재시작 요구: FR-ISP-02, Acceptance 4–5.
- 30분 제한: NFR-ISP-01과 Timeboxed Solution Boundary.
- 기존 Worktree continuation 보존: FR-ISP-03, NFR-ISP-05.

## Stage Recommendation

- User Stories: 명확하고 격리된 bug fix이므로 생략한다.
- Application Design, Units Generation, Functional Design, NFR Requirements, NFR Design, Infrastructure Design: 기존 component 경계를 유지하므로 생략한다.
- Workflow Planning, Code Generation, Build and Test: 필수 단계만 최소 깊이로 실행한다.

## Extension Compliance

- Security Baseline: Disabled; skipped and N/A.
- Resiliency Baseline: Disabled; skipped and N/A.
- Property-Based Testing Partial: Requirements Analysis에 직접 적용되는 blocking rule은 없다. Prompt builder의 결정성과 SR 격리는 Code Generation에서 PBT-03 적용 여부를 평가하고, PBT-07, PBT-08, PBT-09를 유지한다.

