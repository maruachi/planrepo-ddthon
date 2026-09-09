# PlanRepo 저장 schema

버전은 0.1입니다. 구현은 `src/persistence/migrations/0001-planrepo.ts`의 migration 1을 기준으로 합니다.

## 연결과 migration 계약

`src/persistence/database.ts`는 모든 connection에 `journal_mode=DELETE`, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=100`, `recursive_triggers=ON`을 설정하고 읽어서 확인합니다. 하나라도 다르면 connection을 반환하지 않습니다. `recursive_triggers=ON`은 append-only table의 기존 행을 `INSERT OR REPLACE`로 교체할 때 암묵적 DELETE trigger도 실행되게 합니다.

빈 DB 준비는 `migrateDatabase`만 담당합니다. 이 함수는 `BEGIN EXCLUSIVE`부터 전체 DDL, bootstrap row, `app_migrations(number, checksum, applied_at)` 삽입까지 한 transaction에서 처리합니다. 실패하면 부분 table과 migration row를 모두 rollback합니다. SQLite의 내부 `schema_version`을 앱 migration 번호로 사용하지 않습니다.

일반 업무 transaction은 시작한 잠금 안에서 지원 migration 번호와 checksum을 다시 확인합니다. 불일치하면 callback을 실행하지 않습니다. DB 파일 잠금, `synchronous=FULL`과 rollback journal을 전원 손실이나 디스크 고장의 무손실 보장으로 확대하지 않습니다.

## 35개 업무 엔티티 대응

| ENT | table | 주 키와 관계 |
|---|---|---|
| ENT-01 WorkspaceProject | `workspace_projects` | `project_id`; 기본 정책은 같은 프로젝트의 불변 정책 version을 가리킵니다. |
| ENT-02 DemoUserMembership | `demo_user_memberships` | `(project_id, user_id)`; 모든 사람 참조의 프로젝트 소속 기준입니다. |
| ENT-03 SR | `srs` | `(project_id, sr_id)`; owner와 필수 original/current description ref를 복합 FK로 제한합니다. |
| ENT-04 SRDescriptionVersion | `sr_description_versions` | `(project_id, sr_id, description_id, version)`; 이전 version은 같은 논리 ID의 더 작은 번호입니다. |
| ENT-05 ContextSource | `context_sources` | `(project_id, sr_id, source_id)`; 필수 current version ref가 있습니다. |
| ENT-06 ContextSourceVersion | `context_source_versions` | `(project_id, sr_id, source_id, version)`; 종류와 확인 상태의 조건부 필드를 검사합니다. |
| ENT-07 Artifact | `artifacts` | `(project_id, sr_id, artifact_id)`; kind와 필수 current version을 함께 FK로 제한합니다. |
| ENT-08 ArtifactVersion | `artifact_versions` | `(project_id, sr_id, artifact_id, kind, version)`; 이전 version과 적용·입력 근거를 보존합니다. |
| ENT-09 WorkflowPlanVersion | `workflow_plan_versions` | `(project_id, sr_id, artifact_id, version)`; ArtifactVersion과 1:1입니다. |
| ENT-10 Question | `questions` | `(project_id, sr_id, question_id)`; 필수 classification/current snapshot과 parent 순환 금지를 적용합니다. |
| ENT-11 QuestionAnswerVersion | `question_answer_versions` | `(project_id, sr_id, question_id, answer_id, version)`; 질문 snapshot과 이전 답변을 고정합니다. |
| ENT-12 QuestionResultSnapshot | `question_result_snapshots` | `(project_id, sr_id, question_id, version)`; 채택 답변과 분류 version을 고정합니다. |
| ENT-13 Decision | `decisions` | `(project_id, sr_id, decision_id)`; 공식 version 포인터는 선택이고 원 질문 전환은 고유합니다. |
| ENT-14 DecisionVersion | `decision_versions` | `(project_id, sr_id, decision_id, version)`; 더 작은 이전 version만 허용합니다. |
| ENT-15 ScopeClassificationVersion | `scope_classification_versions` | `(project_id, sr_id, classification_id, version)`; current/followup과 required gate 조합을 검사합니다. |
| ENT-16 ReviewPolicyVersion | `review_policy_versions` | `(project_id, policy_id, version)`; 프로젝트 범위와 이전 version을 제한합니다. |
| ENT-17 ReviewAssignmentVersion | `review_assignment_versions` | `(project_id, sr_id, gate, assignment_id, version)`; reviewer는 `review_assignment_reviewers`에서 프로젝트 membership에 연결합니다. |
| ENT-18 ReviewBundle | `review_bundles` | `(project_id, sr_id, gate, bundle_id, version)`; G2의 G1 ref는 gate까지 포함한 같은 SR 복합 FK입니다. |
| ENT-19 ReviewRequest | `review_requests` | `(project_id, sr_id, request_id)`; 활성 중복과 승계 순환을 막습니다. |
| ENT-20 Approval | `approvals` | `(project_id, sr_id, approval_id)`; 묶음 version·정책 version·approver 소속을 고정하고 묶음별 중복을 막습니다. |
| ENT-21 ReviewGateState | `review_gate_states` | `(project_id, sr_id, gate)`; 현재 policy·assignment·bundle과 last pass를 복합 FK로 제한합니다. |
| ENT-22 GateTransitionRecord | `gate_transition_records` | `(project_id, sr_id, transition_id)`; 당시 gate·epoch·bundle·영향 refs를 추가 전용으로 보존합니다. |
| ENT-23 Comment | `comments` | `(project_id, sr_id, comment_id)`; 정확한 ArtifactVersion과 작성자 소속을 가리킵니다. |
| ENT-24 ChangeRequest | `change_requests` | `(project_id, sr_id, change_request_id)`; 원 ArtifactVersion과 조건부 current event 포인터를 가집니다. |
| ENT-25 ChangeRequestEvent | `change_request_events` | `(project_id, sr_id, change_request_id, event_id)`; 같은 요청과 대상 ArtifactVersion에 속합니다. |
| ENT-26 InputSnapshot | `input_snapshots` | `(project_id, sr_id, snapshot_id)`; 생성 입력과 프로젝트 규칙의 고정 JSON을 보존합니다. |
| ENT-27 GenerationRun | `generation_runs` | `(project_id, sr_id, run_id)`; snapshot·claim·result와 상태별 필수 필드를 제한하고 retry 순환을 막습니다. |
| ENT-28 ExecutionClaim | `execution_claims` | `(project_id, sr_id, run_id, claim_id)`; Run당 하나이며 runtime과 launch intent를 고정합니다. |
| ENT-29 ExecutionObservation | `execution_observations` | `(project_id, sr_id, observation_id)`; Claim당 종료 확인 하나만 허용합니다. |
| ENT-30 GenerationDraft | `generation_drafts` | `(project_id, sr_id, draft_id)`; 입력 snapshot·원 Run·비교 초안 출처를 보존하고 source 순환을 막습니다. |
| ENT-31 DraftApplication | `draft_applications` | `(project_id, sr_id, application_id)`; Draft당 한 번이며 receipt와 고정 출력 refs를 연결합니다. |
| ENT-32 Handoff | `handoffs` | `(project_id, sr_id, handoff_id, version)`; G1/G2 gate를 포함한 묶음 refs와 고정 Markdown/digest를 보존합니다. |
| ENT-33 ImplementationRecord | `implementation_records` | `(project_id, sr_id, implementation_id)`; Handoff version별 하나이며 완료 상태의 근거를 요구합니다. |
| ENT-34 ActivityEvent | `activity_events` | `(project_id, activity_id)`; SR 범위, receipt 또는 내부 실행 근거와 고정 target refs를 보존합니다. |
| ENT-35 CommandReceipt | `command_receipts` | `(project_id, receipt_id)`; 별도의 NULL 없는 5열 idempotency UNIQUE와 고정 결과·재생 값을 가집니다. |

Handoff의 `handoff_id`만으로는 고유하지 않습니다. 같은 논리 Handoff의 version 2 이상을 보존할 수 있으며 모든 참조는 version을 포함합니다. 새 현재 후보를 별도 논리 Handoff로 만들 때는 새 ID와 version 1을 사용합니다.

배열과 다형 참조 중 DB가 직접 범위를 판정할 수 있는 reviewer 관계는 typed join table로 분리했습니다. Bundle·Handoff·snapshot·activity의 고정 JSON에는 전체 `projectId`, `srId`, 논리 ID와 version을 보존합니다. 이 JSON의 kind별 소속과 필수 구성은 각 업무 repository와 CG-04 seed validator가 transaction 안에서 검사해야 합니다. `foreign_key_check`만으로 JSON ref 검증을 대신하지 않습니다.

## 순환 삽입과 불변성

SR/DescriptionVersion, ContextSource/Version, Artifact/Version, Question/ResultSnapshot처럼 필수 current 포인터와 자식 소속 FK가 서로를 가리키는 관계는 current 쪽 복합 FK를 `DEFERRABLE INITIALLY DEFERRED`로 정의했습니다. 부모·최초 자식·포인터를 같은 transaction에서 완성해야 하며 NULL 상태로 commit할 수 없습니다.

이전 version은 같은 범위·논리 ID를 참조하고 더 작은 version만 허용합니다. Question parent는 INSERT와 UPDATE 모두에서, ReviewRequest 승계, GenerationRun retry, GenerationDraft source는 각 관계 변경 시 recursive trigger로 2개 이상 노드의 순환을 막습니다.

불변 version, assignment reviewer 집합, 승인, 전환, 댓글, 변경 이벤트, 입력 snapshot, claim/observation, draft/application, Handoff, ActivityEvent, CommandReceipt와 seed manifest에는 UPDATE·DELETE 거절 trigger가 있습니다. 현재 객체와 Run 상태는 후속 repository가 revision/CAS로 갱신합니다.

## bootstrap 보조 자료

35개 업무 ENT와 별도로 다음 table을 둡니다.

- `app_migrations`는 앱 migration 번호·checksum·적용 시각을 보존합니다.
- `maintenance_state`는 복구되지 않은 maintenance owner를 감지합니다.
- `runtime_identities`는 backend 실행 식별·boot/부모 관찰 정보를 불변 이력으로 보존합니다. 종료된 Run의 Claim과 Observation은 이 table을 참조합니다.
- `runtime_instances`는 현재 활성 등록과 heartbeat만 보존합니다. 정상 해제는 이 행만 삭제하므로 과거 runtime identity와 Claim은 남습니다.
- `execution_slot`은 정확한 Run·Claim·runtime·launch intent 하나만 가리킵니다.
- `demo_seed_manifests`는 `seed_id`, `manifest_version`, `project_id`, 완료 시각, digest와 고정 manifest JSON을 보존합니다. DEMO-4 graph와 이 row는 CG-04에서 같은 EXCLUSIVE transaction에 저장합니다.

`createTestDatabase({ testRunId })`는 검증한 UUID별 새 임시 폴더와 실제 파일 DB를 만들고 schema까지만 준비합니다. HTTP, `createTestApp`과 DEMO-4 seed를 호출하지 않습니다. `close`는 connection을 닫고 그 fixture 폴더만 제거합니다.
