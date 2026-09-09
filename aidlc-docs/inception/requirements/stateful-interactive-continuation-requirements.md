# Stateful Interactive AI-DLC Continuation 요구사항

## Intent Analysis

- **User request**: Worktree의 AI-DLC 이어서 실행이 이전 Claude 컨텍스트를 유지하고, 브라우저에서 Claude 출력을 확인하면서 후속 멘트를 입력할 수 있게 한다.
- **Request type**: 기존 사용자 기능의 bug fix와 interactive enhancement.
- **Scope estimate**: Worktree runner, service/runtime state, persisted view, HTTP client와 React panel을 잇는 단일 수직 슬라이스.
- **Complexity estimate**: Moderate. 장시간 child process, 세션 재개, 양방향 JSON stream과 브라우저 polling을 함께 다룬다.
- **Requirements depth**: Minimal focused. 승인된 Worktree requirements와 US-WT-08, US-WT-10, US-WT-11을 재사용하고 30분 구현 한도를 적용한다.

## Confirmed Root Cause

현재 `WorktreeAidlcRunner`는 매 요청마다 `claude -p`를 새로 실행하고 초기 prompt 직후 stdin을 닫는다. stdout은 process 종료 후 한 번에 반환되고 stderr 내용은 버린다. PlanRepo는 Claude session ID, transcript 또는 active stdin handle을 보관하지 않는다. 따라서 Claude가 진행 여부를 물으면 사용자가 답할 수 없으며 다음 실행은 이전 대화 컨텍스트를 잃는다.

설치된 Claude Code 2.1.266은 `--session-id`, `--resume`, `--input-format stream-json`, `--output-format stream-json`, `--include-partial-messages`와 `--replay-user-messages`를 제공한다.

## Timeboxed Solution Boundary

- 실시간 전송은 새 SSE/WebSocket 계층 대신 기존 HTTP status polling을 짧은 간격으로 확장한다.
- 한 SR에 하나의 active Claude process와 하나의 current session ID만 허용한다.
- 첫 실행은 미리 생성한 UUID를 `--session-id`로 전달하고, 종료·재시작 뒤 명시적 이어서 실행은 저장된 ID를 `--resume`으로 전달한다.
- 실행 중에는 stream-JSON stdin을 열어 두고 사용자 메시지를 같은 process에 전달한다.
- transcript는 사용자/Claude 텍스트와 bounded 상태·오류 이벤트만 노출한다. 전체 checkpoint, background process reattachment와 범용 terminal emulation은 제외한다.

## Functional Requirements

### FR-SIC-01 Claude 세션 컨텍스트 유지

1. 첫 interactive 실행 전에 SR별 유효 UUID session ID를 생성하고 Worktree 상태와 함께 저장한다.
2. 첫 process는 worktree를 `cwd`로 사용하고 `--session-id` 및 stream-JSON 입출력 옵션으로 시작한다.
3. 실행 중 추가 사용자 메시지는 새 process가 아니라 같은 process의 열린 stdin으로 전달한다.
4. process 종료 또는 서버 재시작 후 사용자가 이어서 실행하면 저장된 session ID를 `--resume`으로 전달한다.
5. 다른 SR의 session ID를 재사용하지 않는다.

### FR-SIC-02 Interactive process lifecycle

1. 시작 API는 child 종료까지 HTTP 연결을 점유하지 않고 active 상태를 즉시 반환한다.
2. stdout의 newline-delimited stream-JSON을 incremental event로 파싱한다.
3. process가 살아 있는 동안 stdin을 닫지 않는다.
4. 종료 코드, parser 오류, timeout, 취소와 stdin 실패를 bounded run error로 기록하고 UI에 표시한다.
5. 한 SR에서 이미 process가 실행 중이면 중복 process를 시작하지 않고 기존 active session 상태를 반환한다.

### FR-SIC-03 Claude 출력 가시성

1. Worktree 상태 응답은 증가하는 transcript sequence, actor, text, event type과 timestamp를 제공한다.
2. UI는 실행 중 짧은 polling으로 새 transcript를 표시한다.
3. 사용자 메시지와 Claude 응답 순서를 보존하고 자동으로 최신 항목을 확인할 수 있게 한다.
4. partial text가 제공되면 화면을 갱신하되 동일 최종 응답을 중복 표시하지 않는다.
5. 잘못된 stream event는 process 전체를 즉시 crash시키지 않고 진단 가능한 오류로 전환한다.

### FR-SIC-04 사용자 메시지 입력

1. active session UI는 자유 텍스트 입력과 전송 버튼을 제공한다.
2. 빈 메시지, 허용 크기 초과 메시지와 active process가 없는 전송을 서버에서 거부한다.
3. 전송 API는 operation ID로 중복 요청을 식별하고 같은 메시지를 두 번 stdin에 쓰지 않는다.
4. 전송 성공 후 사용자 메시지를 transcript에 반영하고 Claude의 다음 출력을 계속 수집한다.
5. 전송 중에는 중복 클릭을 막되 다른 화면 읽기는 유지한다.

### FR-SIC-05 명시적 종료와 재개

1. 사용자는 active process를 취소할 수 있고 기존 process-group 종료 정책을 재사용한다.
2. 취소나 정상 종료 후 session ID와 bounded transcript는 유지한다.
3. 다음 이어서 실행은 같은 Claude 대화 세션을 resume하되 새 사용자 동작 없이는 자동 실행하지 않는다.
4. 저장된 session이 Claude에서 복구 불가능하면 오류를 표시하고 명시적 새 세션 시작 경로를 제공한다.

## Non-Functional Requirements

- **NFR-SIC-01 시간 한도**: 30분 구현을 위해 기존 Worktree view JSON persistence, REST validation, polling UI와 process-group cancellation을 확장한다. 새 transport library와 범용 pseudo-terminal은 추가하지 않는다.
- **NFR-SIC-02 데이터 경계**: session ID와 bounded transcript를 재시작 후 복구하고 transcript 크기와 개별 message 크기를 제한한다.
- **NFR-SIC-03 프로세스 안전성**: shell을 사용하지 않고 명시적 argument 배열, Worktree `cwd`, timeout, output bound와 close cancellation을 유지한다.
- **NFR-SIC-04 순서와 중복 방지**: transcript sequence는 단조 증가하고 operation replay는 같은 사용자 메시지를 재전송하지 않는다.
- **NFR-SIC-05 사용성·접근성**: transcript는 actor와 상태를 텍스트로 구분하고 input/button은 label, keyboard submit, busy/disabled/error 상태를 제공한다.
- **NFR-SIC-06 호환성**: 기존 provision, document edit/history, Worktree review와 manual board 동작을 보존한다.
- **NFR-SIC-07 검증**: fake duplex Claude process로 초기 session, same-process follow-up, persisted resume, incremental output, malformed event, cancel과 duplicate message를 시험한다.
- **NFR-SIC-08 PBT Partial**: stream event encode/decode round trip과 transcript ordering/dedup invariant에 PBT-02, PBT-03, PBT-07, PBT-08, PBT-09를 적용한다.

## Acceptance Scenarios

1. 최초 이어서 실행 시 stable session UUID가 저장되고 Claude는 Worktree에서 stream mode로 시작한다.
2. Claude가 진행 여부를 묻는 출력이 process 종료 전 UI transcript에 나타난다.
3. 사용자가 `진행해줘`를 입력하면 같은 child stdin으로 전달되고 Claude 후속 응답이 같은 transcript에 이어진다.
4. 같은 operation ID의 메시지 요청이 재전송돼도 stdin에는 한 번만 기록된다.
5. 실행이 끝난 뒤 다시 이어서 실행하면 새 session이 아니라 저장된 session ID로 resume한다.
6. 서버 재시작 뒤에도 session ID와 이전 bounded transcript가 보이며 다음 명시적 실행이 해당 session을 resume한다.
7. 다른 SR의 실행과 transcript는 섞이지 않는다.
8. 취소 시 child process group이 종료되고 session ID와 수집된 transcript는 보존된다.
9. malformed 또는 과도한 output은 bounded 오류가 되고 서버와 다른 SR은 계속 동작한다.
10. 기존 Worktree 문서 편집·이력, review, board movement와 전체 typecheck/build/test가 회귀 없이 통과한다.

## Explicitly Deferred

- SSE, WebSocket과 pseudo-terminal 기반 화면
- terminal control sequence와 전체 Claude TUI 재현
- server crash 후 살아 있는 child process 재부착
- 여러 동시 Claude 세션 또는 과거 세션 선택 UI
- transcript 전문 검색, 장기 보관, export와 고급 redaction
- tool permission 전용 host callback UI와 범용 permission broker

## Traceability

- 기존 requirements: FR-WT-05, FR-WT-06, FR-WT-07, FR-WT-09
- 기존 stories: US-WT-08 실제 Worktree 실행, US-WT-10 실제 상태 기반 진행, US-WT-11 질문 응답
- 직접 결함: one-shot `claude -p`, immediate stdin close, exit-time stdout collection, absent session identity

## Stage Recommendation

- User Stories: 승인된 US-WT-08, US-WT-10, US-WT-11을 재사용하고 새 생성은 생략한다.
- Application Design, Units Generation, Functional Design, NFR Requirements, NFR Design, Infrastructure Design: 30분 최소 plan에서 생략하고 process/session/stream 계약을 Code Generation plan의 blocking 항목으로 이동한다.
- Workflow Planning, Code Generation, Build and Test: mandatory 단계만 실행한다.

## Extension Compliance

- Security Baseline: Disabled; skipped and N/A.
- Resiliency Baseline: Disabled; skipped and N/A.
- Property-Based Testing: Partial. Requirements Analysis 직접 blocking rule은 없고 PBT-02, PBT-03, PBT-07, PBT-08, PBT-09를 Code Generation과 Build and Test에 전달한다.
