# Worktree AI-DLC 문서 편집·저장·이력 요구사항

## Intent Analysis

- **User request**: 지정 repository의 SR worktree에서 `claude -p` 기반 AI-DLC가 생성한 문서를 선택하고, 편집·저장하며 변경 이력을 관리한다.
- **Request type**: 기존 Worktree vertical spike의 사용자 기능 확장.
- **Scope estimate**: Worktree 파일 정책과 원자적 저장, SQLite 버전 저장, HTTP API, React 편집기·이력 UI와 회귀 테스트를 포함하는 다중 컴포넌트 변경.
- **Complexity estimate**: Moderate. 파일이 실제 원본이고 SQLite가 이력을 보존하므로 충돌, 경로 안전성과 두 저장 매체의 일관성을 다뤄야 한다.
- **Requirements depth**: Standard focus. 이미 승인된 comprehensive Worktree 요구사항과 US-WT-13/14를 재사용한다.

## Existing Baseline

- SR 카드는 상세 화면으로 이동한다.
- 지정 repository에서 SR별 worktree를 준비하고 해당 worktree를 `cwd`로 `claude -p`를 실행한다.
- 실행 전후 manifest에서 생성·변경된 `aidlc-docs/**/*.md` 경로와 SHA-256을 수집한다.
- 현재 Worktree 문서는 경로로 선택해 읽을 수 있지만 편집 API, 버전 저장소와 Worktree 전용 이력 UI는 없다.
- 기존 SQLite 계획 문서의 편집·버전 기능은 별도 데이터 모델이며 Worktree 파일을 변경하지 않는다.

## Functional Requirements

### FR-WDEH-01 Worktree 문서 색인과 선택

1. 성공한 AI-DLC 실행에서 관찰한 모든 관리 대상 `aidlc-docs/**/*.md`를 SR과 상대 경로로 색인한다.
2. 최신 실행에서 변경되지 않은 기존 색인 문서도 목록에서 유지한다.
3. 목록은 상대 경로, 최신 hash, 최신 버전 번호, origin과 편집 가능 여부를 표시한다.
4. 삭제 감지와 tombstone은 이번 단위에서 제외하며 삭제된 현재 파일은 읽기 오류로 명시한다.

### FR-WDEH-02 편집 가능 정책

1. Worktree 내부의 일반 UTF-8 Markdown 계획 문서만 편집할 수 있다.
2. `aidlc-docs/aidlc-state.md`와 `aidlc-docs/audit.md`는 항상 읽기 전용이다.
3. Worktree 밖 경로, 절대 경로, 정규화되지 않은 경로, symlink와 Markdown이 아닌 파일은 서버에서 거부한다.
4. 문서당 기존 1 MiB UTF-8 상한을 유지하고 내용을 자동으로 자르지 않는다.

### FR-WDEH-03 안전한 저장

1. 편집 시작 시 읽은 SHA-256을 `expectedHash`로 저장 요청에 포함한다.
2. 서버는 저장 직전에 실제 파일 hash와 `expectedHash`가 같은지 확인한다.
3. hash가 다르면 원본 파일을 덮어쓰지 않고 충돌을 반환하며 브라우저 초안을 유지한다.
4. 충돌이 없으면 같은 디렉터리의 임시 파일에 전체 내용을 기록한 뒤 atomic rename으로 현재 파일을 교체한다.
5. 동일 본문 저장은 새 버전을 만들지 않는 성공적인 no-op으로 처리한다.
6. 파일 변경과 버전 메타데이터 기록 중 하나가 실패하면 성공으로 응답하지 않고 가능한 범위에서 이전 파일을 복구한다.

### FR-WDEH-04 불변 버전 이력

1. AI-DLC 실행으로 생성·수정된 문서와 사람 저장을 origin이 각각 `ai_generated` 또는 `human_edit`인 새 버전으로 기록한다.
2. 각 버전은 SR, 상대 경로, 증가하는 버전 번호, hash, 정확한 UTF-8 본문, origin, 시각, 이전 버전과 선택적 run 식별자를 보관한다.
3. 동일 경로의 이전 버전은 수정하거나 삭제하지 않는다.
4. 동일 hash가 이미 최신 버전이면 중복 버전을 만들지 않는다.
5. 최신 문서 포인터와 버전 이력은 애플리케이션 재시작 후에도 SQLite에서 복구된다.

### FR-WDEH-05 버전 열람 UI

1. Worktree 문서를 선택하면 현재 파일 내용과 최신 버전 메타데이터를 표시한다.
2. 해당 경로의 버전 목록을 최신순으로 제공한다.
3. 과거 버전을 선택하면 저장된 정확한 본문을 읽기 전용으로 표시하고 현재 파일과 구분한다.
4. Worktree 버전 이력은 기존 SQLite 계획 문서 이력과 명확히 구분한다.
5. 이번 단위에서는 버전 비교와 과거 버전 복원을 제공하지 않는다.

### FR-WDEH-06 편집 UI와 초안 보호

1. 편집 가능한 최신 Worktree 문서에는 본문 편집, 저장과 취소 동작을 제공한다.
2. 저장 중 중복 제출을 막고 성공 후 최신 버전과 목록을 다시 조회한다.
3. 이동, 역할 변경 또는 새로고침으로 미저장 초안이 사라질 수 있으면 기존 dirty-state 보호를 사용한다.
4. 서버 충돌 또는 저장 실패 시 초안을 유지하고 재시도 가능한 오류를 표시한다.
5. 읽기 전용 문서와 과거 버전에는 편집 버튼을 제공하지 않는다.

### FR-WDEH-07 다음 AI-DLC 실행과의 연결

1. 사람 저장 결과는 SR의 실제 worktree 파일에 반영된다.
2. 이후 `claude -p` 실행은 같은 worktree를 `cwd`로 사용하므로 편집된 파일을 입력으로 읽을 수 있다.
3. 문서 저장은 Git commit, add, stash, push 또는 branch 변경을 수행하지 않는다.
4. 기존 Worktree 준비·재개 상태와 legacy SQLite 계획 문서의 데이터는 손상시키지 않는다.

## Non-Functional Requirements

- **NFR-WDEH-01 데이터 보존**: Additive SQLite migration과 immutable update/delete trigger를 사용하고 기존 schema v4 데이터와 문서·review·workflow 데이터를 보존한다.
- **NFR-WDEH-02 경로 안전성**: canonical worktree containment, symlink 거부, 관리 경로 allowlist와 저장 전 재검증을 적용한다.
- **NFR-WDEH-03 충돌 안전성**: expected hash가 일치하지 않으면 자동 병합이나 덮어쓰기를 하지 않는다.
- **NFR-WDEH-04 요청 안전성**: 기존 JSON 검증과 UUID `X-Operation-Id` 규칙을 사용하고 동일 저장 요청 재전송은 중복 버전을 만들지 않는다.
- **NFR-WDEH-05 사용성·접근성**: 편집 가능 여부, 현재/과거 버전, 저장·충돌·실패 상태를 텍스트로 제공하고 모든 동작을 키보드로 사용할 수 있게 한다.
- **NFR-WDEH-06 검증**: 경로 정책, hash 충돌, atomic save, 불변 버전, 재시작 복구, API와 editor state를 예제 기반 테스트로 검증한다.
- **NFR-WDEH-07 PBT Partial**: 버전 직렬화 round-trip과 path/version ordering invariant에 PBT-02, PBT-03, PBT-07, PBT-08, PBT-09를 적용한다.

## Acceptance Scenarios

1. Claude 실행이 문서를 생성한 뒤 SR 상세를 다시 열면 그 문서가 목록에 있고 v1 `ai_generated`로 열람된다.
2. 다음 Claude 실행에서 해당 문서가 변경되지 않아도 기존 문서와 이력은 목록에 유지된다.
3. 편집 가능한 최신 문서를 저장하면 실제 worktree 파일과 최신 본문이 바뀌고 v2 `human_edit`가 생성되며 v1도 열람할 수 있다.
4. 같은 본문을 다시 저장하면 파일과 최신 버전 번호가 변하지 않는다.
5. 편집 중 외부에서 파일이 바뀌면 저장은 conflict로 실패하고 외부 파일과 사용자 초안을 모두 보존한다.
6. 상태 또는 audit 문서 편집 API를 호출하면 서버가 읽기 전용 오류로 거부한다.
7. 서버 재시작 후에도 문서 목록, 최신 버전과 과거 버전 본문을 동일하게 조회할 수 있다.
8. 저장 후 AI-DLC를 재개하면 runner는 편집된 파일이 있는 동일 worktree에서 실행된다.
9. 경로 탈출, symlink와 1 MiB 초과 본문은 원본을 변경하지 않고 거부된다.
10. 기존 SQLite 계획 문서 편집·이력과 review 흐름은 회귀 없이 동작한다.

## Explicitly Deferred

- 두 버전의 시각적 diff
- 과거 Worktree 버전 복원
- 전체 checkpoint와 content-addressed blob 저장소
- 삭제 tombstone과 외부 drift 가져오기
- 승인 baseline 무효화와 downstream stale 계산
- 다중 repository/profile, 실제 사용자 인증과 권한 모델

## Traceability

- 기존 requirements: FR-WT-10, FR-WT-11의 불변 이력 일부, FR-WT-12, FR-WT-16
- 기존 stories: US-WT-13 Worktree 파일과 이력 탐색, US-WT-14 계획 문서 안전 편집
- 기존 acceptance: AC-WT-06과 AC-WT-07의 편집·다중 버전 열람 부분
- 비교·복원은 FR-WT-13, US-WT-15와 AC-WT-08에 남아 있으며 이번 단위에서 완료로 처리하지 않는다.

## Stage Recommendation

- User Stories: Reuse approved US-WT-13 and US-WT-14; no regeneration.
- Application Design: Skip; the current Worktree service, filesystem adapter, SQLite adapter and SR detail seams are sufficient.
- Units Generation: Skip; one focused Worktree document unit.
- Functional Design: Execute minimally because file/DB save ordering, immutable lineage and conflict rules require explicit design.
- NFR Requirements: Skip; existing stack and limits are retained.
- NFR Design: Execute minimally with filesystem/SQLite consistency and recovery boundaries.
- Infrastructure Design: Skip; local runtime only.
- Workflow Planning, Code Generation, Build and Test: Mandatory.

## Extension Compliance

- Security Baseline: Disabled; skipped and N/A.
- Resiliency Baseline: Disabled; skipped and N/A.
- Property-Based Testing: Partial. No Requirements Analysis blocking rule applies; PBT-02, PBT-03, PBT-07, PBT-08 and PBT-09 are carried into design, implementation and verification.

