# DEMO-4 구현 준비

실제 시드 구현·검증 결과가 아닙니다. CG-04는 `aidlc-docs/construction/planrepo/code/task-04-brief.md`, `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, `aidlc-docs/construction/planrepo/functional-design/domain-entities.md`와 CG-03의 실제 DDL을 사용합니다.

## 고정 식별자

manifest를 모든 가상 ID의 단일 원본으로 둡니다. projectId는 demo-project, teamId는 demo-team입니다. 기본 actor는 P-01입니다.

| persona | actorId | 역할 |
|---|---|---|
| P-01 | persona-p01-owner | sr_owner |
| P-02 | persona-p02-requester | business_requester |
| P-03 | persona-p03-reviewer | reviewer |
| P-04 | persona-p04-decision-maker | decision_maker |
| P-05 | persona-p05-admin | team_admin |

| key | srId | 현재 제품 단계 |
|---|---|---|
| PAY-102 | sr-pay-102 | requirements |
| AUTH-331 | sr-auth-331 | planning |
| NOTI-028 | sr-noti-028 | ready |
| CAT-093 | sr-cat-093 | requirements |

manifest에는 seedId=DEMO-4, version=1, projectId, teamId, defaultActorId, personaIds, srIds, policyId=policy-demo-review, initialStates와 필요한 entityIds를 보존합니다. readDemoManifest는 ID를 DB 정렬 순서로 추측하지 않습니다. empty TestApp은 같은 프로젝트와 사용자 5명만 준비하고 SR·seed 완료 표식은 없습니다.

## 공통 관계

SR마다 최초/current 설명 v1, workflowVersion=v1.0.1, implementationUnitCount=1, G1/G2 현재 상태와 배정 v1을 둡니다. P-05가 P-03을 두 게이트의 검토자로 배정합니다. 정책 v1의 requiredRoles는 reviewer이고 requireAllAssigned·requireDistinctPeer는 true입니다. 정책과 각 게이트 체크리스트를 같은 고정 버전으로 연결합니다. 시각은 관계 순서에 맞는 고정 ISO 값입니다.

필요한 계획 그래프는 requirements, workflow_plan, 선택 design, implementation_plan 문서 버전을 포함합니다. WorkflowPlanVersion은 workflow_plan ArtifactVersion과 1:1이며 실행/생략 이유·선택 설계·작업·요구사항·검증 연결을 일치시킵니다. Markdown과 구조 색인의 ID는 같아야 합니다.

## 시드별 관계

PAY-102는 요구사항 v1, current/G1 open 질문과 결과 스냅샷, 취소 기간 정책의 확정 결정 v1을 가집니다. 결정권자는 P-04입니다. G1 묶음은 같은 자료·분류·정책·배정을 고정하고 P-03에게 pending 검토 요청을 둡니다. 승인은 없으며 open 질문이 전환을 막습니다. G2는 묶음 없이 not_passed입니다.

AUTH-331은 요구사항 v1과 현재 유효 G1 묶음·승인·통과를 가집니다. 과거 G2 epoch 1 묶음·승인은 있지만 G2 pass는 없습니다. 구현 계획 current는 v2입니다. v1 대상 차단 수정 요청은 v2로 승계돼 awaiting_confirmation이며 currentApplicationEventRef를 가집니다. 요청자 P-03, 반영자/담당자 P-01입니다. 적용 이벤트는 원 대상 v1과 적용 버전 v2·요약·근거를 함께 가집니다. G2는 epoch 2, not_passed, needsNewBundle=true이며 변경 근거를 보존합니다. 확인 대기는 차단을 해제하지 않습니다.

NOTI-028은 G1/G2 묶음·승인·처리된 요청·통과 이력을 가집니다. G2는 정확한 현재 G1을 참조합니다. requirements·workflow_plan·선택 design·implementation_plan v1과 Handoff H1이 연결됩니다. H1은 두 묶음·승인·내용 refs·검증 기준·후속 범위·고정 Markdown을 보존합니다. 현재 유효성은 실제 gate/묶음으로 계산합니다.

CAT-093은 요구사항 v1로 G1/G2 통과 후 H1 외부 구현을 시작하고 요구사항 v2가 생긴 순서입니다. 현재 제품 단계는 requirements입니다. 두 게이트는 epoch 2, invalid, needsNewBundle=true이며 각각의 무효화 근거와 과거 pass를 보존합니다. G1 기록의 실제 단계 변경은 implementing에서 requirements입니다. H1 ImplementationRecord는 started·manual=true와 시작자/시각을 유지하며 현재 기준의 activeImplementationRef는 비웁니다. 과거 H1에 요구사항 v2를 끼워 넣지 않습니다.

## 실제 DDL 연결 준비

CG-03의 초기 DDL을 읽은 결과, 지연 FK를 사용해 다음 순서로 전체 그래프를 같은 transaction에 넣을 수 있습니다. 프로젝트·사용자·정책을 준비한 뒤 SR·설명·문서/진행 계획 버전을 넣습니다. 분류·질문/결과·결정/버전과 배정/검토자를 연결합니다. G1 다음 G2 묶음·요청/승인·통과/현재 게이트를 기록합니다. 수정 요청/이벤트·인계/구현·필요 활동을 넣고 seed manifest를 마지막에 저장합니다. foreign_key_check를 검사한 뒤 commit합니다.

JSON 열에 저장한 참조는 FK가 아닙니다. seed validator는 bundle의 문서·결정·질문·분류·근거·검토자 snapshot, G2 상위 G1 종류, Handoff의 게이트·승인·내용 refs, 분류 target, 수정 요청 currentTarget의 실제 버전, pass의 정책·배정·승인 refs를 같은 scope에서 확인해야 합니다. CG-03의 demo_seed_manifests에 seed_id·manifest_version·project_id·completed_at·manifest_digest·manifest_json과 프로젝트 FK·불변성을 추가했습니다. config의 seedId=DEMO-4와 version=1을 registry에 그대로 저장하며 서로 다른 버전 표현을 섞지 않습니다. 최종 schema와 API는 실제 확정 파일을 따릅니다.

## 검사 경계

현재 포인터·모든 ref는 같은 프로젝트/SR/논리 ID의 실제 불변 버전이어야 합니다. 묶음의 배정·정책·체크리스트·검토자와 개별 승인/통과 조건을 맞춥니다. Handoff의 G1은 G2가 고정한 G1과 같아야 합니다. 현재 유효성과 외부 started 사실은 별개입니다.

공개 View DTO는 전체 저장 모델이 아닙니다. ReviewBundleSnapshot의 축약된 필드나 EntityKind만으로 ENT 전체를 줄이지 않습니다. 초기 DDL의 35 ENT와 실제 관계를 기준으로 작성합니다. 시드 성공은 후속 실제 사용자 명령·게이트 동작의 통과 증거가 아닙니다.
