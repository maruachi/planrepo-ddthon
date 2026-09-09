# PlanRepo 공개 API 요약

이 문서는 구현된 공개 메서드의 입력, 권한, 저장, 조회 현재성 계약을 요약합니다. HTTP 요청 형식과 전체 메서드 등록표는 `src/contracts/methods.ts`와 `src/contracts/schemas.ts`가 기준입니다.

## 공통 HTTP 경계

공개 메서드는 `POST /api/methods/:methodId`로 호출합니다. 현재 가상 사용자는 `X-PlanRepo-Actor` header로 전달합니다. 요청의 `scope.projectId`와 actor의 프로젝트가 같아야 하며 SR 범위 메서드는 `scope.srId`도 검사합니다.

명령은 `meta.requestId`, `meta.idempotencyKey`와 메서드별 guard를 받습니다. 새 결과는 `Committed`, 같은 범위·actor·idempotency key·명령·정규화 입력은 `Replayed`로 반환합니다. 같은 key에 다른 명령이나 입력이 오면 `IDEMPOTENCY_CONFLICT`와 기존 `priorReceipt`를 반환합니다. `Replayed.value`와 receipt는 최초 commit 결과를 보존하며 `current`는 재생 시점의 현재 revision을 별도로 표시합니다.

업무 거절은 `DomainError`로 반환합니다. 주요 오류는 입력 오류 `VALIDATION_ERROR`, 프로젝트 권한 오류 `FORBIDDEN`, 실제 SR owner 오류 `NOT_ASSIGNED`, 없는 프로젝트·멤버·SR 오류 `NOT_FOUND`, 오래된 revision `STALE_VERSION`, 허용되지 않은 단계 전환 `GATE_BLOCKED`, 저장 실패 `STORE_UNAVAILABLE`입니다.

## S-01 Workspace

### M-001 describeWorkspace

현재 프로젝트, 다섯 가상 사용자, Mock 연결 상태, Project 설정 revision, 기본 검토 정책 참조와 정책 version 목록을 읽습니다. 정책에는 gate별 필수 역할과 체크리스트가 포함됩니다. actor가 지정되면 현재 프로젝트 멤버인지 검사합니다. 조회는 업무 자료를 쓰지 않습니다.

### M-002 selectDemoActor

입력 actor ID가 현재 프로젝트의 등록된 가상 사용자인지 검사하고 `DemoActorView`를 반환합니다. 서버 전역 사용자를 바꾸지 않습니다.

## S-02 SR context

### M-003 registerSr

`NewSR`의 `key`, `title`, `purpose`, `description`, `ownerId`를 받습니다. 호출 actor와 owner는 모두 현재 프로젝트 멤버여야 합니다. `sr_key`와 `jira_key` 두 key 공간을 한 write transaction에서 교차 검사합니다.

성공하면 서버가 SR ID와 설명 ID를 생성합니다. SR, 불변 설명 version 1, 고정 original/current 설명 참조, `sr_received` 단계, 당시 프로젝트 기본 정책을 고정한 G1·G2 epoch 1 `not_passed` 상태, activity와 receipt를 하나의 IMMEDIATE transaction에서 확정합니다.

### M-004 importMockTicket

프로젝트 config의 Mock Jira key를 받습니다. 저장 잠금 전에 현재 멤버 권한과 Mock 자료를 조회하고, 확정 transaction에서 권한과 두 key 공간의 중복을 다시 검사합니다. 새 key이면 `Imported`, 이미 연결된 key이면 기존 자료를 바꾸지 않고 `Existing`을 반환합니다.

### M-005 updateSrDescription

실제 SR owner만 제목, 목적, 설명과 변경 이유를 수정할 수 있습니다. guard는 현재 SR의 정확한 target과 `expectedRevision`을 요구합니다. original 설명은 보존하고 같은 논리 설명 ID의 다음 불변 version을 만들며 current 설명 참조만 갱신합니다.

설명 변경은 G1과 종속 G2의 epoch를 올리고 새 bundle 필요 상태를 기록합니다. 과거 pass가 있는 gate는 `invalid`, 아직 pass가 없는 gate는 `not_passed`가 됩니다. 과거 승인, bundle, handoff, 외부 구현 사실은 보존합니다. 현재 제품 단계는 가장 이른 재검토 단계인 `requirements`로 돌아갑니다. 아직 승인 기준이 없던 `sr_received` SR은 접수 단계를 유지합니다. 대체 bundle이나 요청이 없을 때 과거 요청에 가짜 대체 참조를 만들지 않습니다.

### M-006 attachSource

현재 프로젝트 멤버가 정확한 SR revision guard로 text, markdown 또는 link 자료를 등록합니다. 서버가 source ID와 시각을 정하며 version 1은 항상 `unconfirmed`입니다. text와 markdown은 입력 본문을 그대로 보존합니다. link의 `targetUrl`은 자격 정보가 없는 절대 `http` 또는 `https` URL만 허용합니다. 상대 주소와 `javascript`, `data`, `file` scheme은 거절합니다. link는 target URL, 출처, 확인 가능 여부와 선택한 외부 version·확인 불가 이유를 보존하며 외부 내용을 자동으로 수집하지 않습니다.

자료 등록과 SR revision, G1·G2 epoch, ReviewImpact, activity, receipt는 같은 IMMEDIATE transaction에서 확정합니다. 내용·대상·확인 상태가 새 검토 기준을 만들면 가장 이른 재검토 단계로 돌아가며 과거 bundle, 승인과 handoff는 바꾸지 않습니다.

### M-007 confirmSource

현재 SR의 실제 owner만 정확한 `context_source` revision guard와 현재 `ContextSourceVersionRef`를 지정해 자료를 확인합니다. 확인 근거는 필수이며 `confirmedBy`와 `confirmedAt`은 서버가 기록합니다. 기존 미확인 version을 고치지 않고 같은 내용·출처를 가진 새 confirmed version을 만들고 current pointer를 옮깁니다.

`ContextSourceView`는 공통 identity·현재 version·작성 정보·출처와 함께 종류별 본문 또는 link 정보를 반환합니다. `unconfirmed`에는 사람 확인 필드가 없고 `confirmed`에는 확인자·시각·근거가 모두 있습니다. 같은 자료의 표시명만 달라지고 내용·출처·확인 상태가 같으면 순수 ReviewImpact 판정은 재검토를 만들지 않습니다.

## S-05 공식 검토와 단계 전환

### M-020 requestReview

현재 SR owner만 정확한 `review_gate_state` revision guard로 공식 검토를 요청합니다. 서버는 현재 문서·질문 결과·결정·분류·자료·설명, 정책, 배정과 review epoch를 다시 읽고 요청의 명시 refs와 비교합니다. 필수 자료나 준비된 동료 검토자가 없으면 bundle이나 receipt를 만들지 않고 `GATE_BLOCKED`를 반환합니다. 미해결 질문과 미확정 결정은 불변 snapshot에 포함할 수 있으며 검토 요청 자체를 막지 않습니다.

현재 기준이 기존 공식 bundle과 같으면 새 idempotency key여도 그 bundle과 reviewer별 요청 ID를 재사용합니다. 새 기준일 때만 불변 bundle과 현재 요청을 만들고 직전 bundle의 pending 요청을 대체합니다. 이때 바뀐 `currentBundleRef`와 `needsNewBundle`을 반영해 gate revision을 한 번 올리고 receipt에 새 revision을 기록합니다. 이미 통과한 gate와 SR 진행 단계는 같은 기준 재요청으로 되감지 않습니다.

### M-021 recordApproval

현재 gate 배정에 포함된 프로젝트 멤버만 정확한 `BundleRef`와 review epoch로 개별 승인합니다. bundle에 고정된 정책 체크리스트의 모든 항목을 중복 없이 확인해야 합니다. 승인과 reviewer 요청의 handled 상태, activity, receipt를 하나의 transaction에서 확정합니다. SR revision은 승인 guard가 아니며 미해결 질문이나 미확정 결정은 개별 승인을 막지 않습니다. 같은 묶음·사용자의 승인 사실은 중복 생성하지 않습니다. 같은 key 재생은 현재 멤버십과 현재 gate 배정 자격을 먼저 확인한 뒤 최초 ApprovalView와 receipt를 반환합니다. 이후 문서·질문·결정 기준이 바뀌었다는 이유로 과거 확정 명령에 현재 BundleRef·epoch guard를 다시 적용하지 않습니다. 배정에서 제거된 사용자는 과거 receipt도 현재 자격 검사에서 거절됩니다.

### M-022~026 댓글·수정·확인

M-022는 현재 프로젝트 멤버가 실제 문서 version·section에 일반 댓글을 추가합니다. 선택한 bundle이 있으면 같은 SR의 실재하는 bundle인지 확인합니다. 댓글, activity와 receipt는 원자적으로 저장하며 SR revision, gate revision, review epoch와 기존 승인을 바꾸지 않습니다.

M-023은 현재 영향 gate의 지정 검토자가 정확한 `review_gate_state` revision, 현재 `BundleRef`와 review epoch로 수정을 요청합니다. 현재 묶음을 검토하다 발견한 과거 문서 version·section도 원 대상으로 고정할 수 있습니다. 같은 논리 문서의 현재 version에 같은 section이 있으면 `currentTargetRef`로 연결하고, 삭제됐으면 `missing_section`으로 표시합니다. 본문, 차단 여부, 영향 gate, 담당자와 원 요청자를 함께 고정합니다. 비차단 요청은 승인 기준을 유지합니다. 차단 요청은 G1이면 G1과 종속 G2, G2이면 G2만 새 검토 기준으로 전환합니다.

M-024는 수정 담당자 또는 현재 SR owner가 실제 current artifact version의 반영 요약과 evidence를 불변 event로 남기고 요청을 `awaiting_confirmation`으로 바꿉니다. M-025와 M-026은 원 요청자 또는 영향 gate의 현재 지정 검토자가 정확한 현재 application event를 각각 해결 확인하거나 추가 수정할 수 있습니다. 원 요청자는 현재 배정에서 빠진 뒤에도 자기 요청을 확인할 수 있습니다. 반영자라는 사실만으로 확인 권한이 생기거나 사라지지 않습니다. 반영 확인 대기는 blocking을 해제하지 않습니다.

같은 key 재생은 현재 권한을 다시 확인한 뒤 최초 허용 DTO와 receipt를 반환하며 최신 request revision은 `current`에 분리합니다. 저장된 receipt와 M-047 응답은 허용 필드, scope, ref와 상태 관계를 다시 검사해 임의 추가 필드를 내보내지 않습니다. 해결된 요청의 `currentTargetRef`는 해결 당시 실재하던 artifact version의 이력으로 남으며 이후 문서 개정 때문에 현재 version으로 바꾸지 않습니다. M-015·M-017 저장과 M-018 문서 초안 적용이 새 artifact version을 만들면 같은 논리 문서의 모든 `open`·`awaiting_confirmation` 요청을 함께 승계합니다. 원 section이 없어지면 `currentTargetRef`를 `missing_section`으로 표시하면서 요청 ID, 원 version·section, 요청자, blocking과 현재 상태를 보존합니다.

### M-027 assessGate

현재 프로젝트 멤버가 G1 또는 G2의 GP-01~09를 일관된 읽기 snapshot에서 평가합니다. 결과에는 현재 bundle과 epoch, 검토 표시 상태, 각 조건의 통과 여부·이유·실제 담당자·대상 ref와 전체 전환 가능 여부가 포함됩니다. 조회는 activity, 요청 상태, SR revision과 검토 시작 사실을 쓰지 않습니다.

G1의 GP-02는 bundle이 고정한 요구사항 version의 비지 않은 section, 요구사항 연결과 수용 기준을 확인합니다. GP-03은 current G1 질문을 검사하고 정확히 연결된 decision이 있는 전환 질문만 제외합니다. GP-04의 미확정 결정 담당자는 그 결정의 실제 `decisionMakerId`입니다. G2 전용 질문과 결정은 G1 통과를 막지 않습니다.

### M-028 transitionStage

실제 SR owner가 `sr_received`에서 `requirements`로 시작할 때는 정확한 SR revision guard와 이유를 사용합니다. `requirements`에서 `planning`으로 이동할 때는 G1, `planning`에서 `ready`로 이동할 때는 G2의 정확한 SR revision, `BundleRef`, review epoch와 이유가 필요합니다.

게이트 전환은 transaction 안에서 현재 권한·단계·bundle·epoch와 GP-01~09를 다시 평가합니다. 지정 전원의 개별 승인이 있어도 질문·결정·문서·차단 변경·정책 역할 중 하나가 부족하면 `GATE_BLOCKED`입니다. 성공하면 당시 조건, 정책·배정·승인 refs와 전체 고정 version refs를 가진 pass 기록, gate validity, SR 단계, activity와 receipt를 함께 확정합니다. 동일 receipt는 최초 SR 결과를 재생하고 현재 revision은 별도로 반환합니다. G1 통과는 G2 전용 미해결 항목을 승인하지 않으며 과거 G2 통과를 복원하지 않습니다.

## S-06 검토 정책과 배정

### M-029 createPolicyVersion

현재 `team_admin`만 프로젝트 기본 검토 정책의 새 불변 version을 만듭니다. 기존 정책 개정은 정확한 `previousPolicyRef`와 변경 이유를 요구합니다. 두 gate의 필수 역할과 체크리스트는 비어 있거나 중복될 수 없으며 `requireAllAssigned`와 `requireDistinctPeer`는 항상 `true`입니다. 성공하면 프로젝트 기본 정책 참조와 설정 revision만 바뀝니다. 기존 SR의 gate별 정책 참조는 소급 변경하지 않습니다.

### M-030 assignReviewers

현재 `team_admin`만 정확한 `review_gate_state` revision guard로 gate의 검토자 배정 version을 추가합니다. 변경 배정은 현재 `previousAssignmentRef`와 변경 이유를 요구합니다. 빈 배정과 담당자만 있는 배정도 이력으로 저장하지만 `ready=false`로 반환하며 bundle이나 승인을 만들지 않습니다. 문서 없는 SR의 최초 배정도 저장하고 가짜 문서나 BundleRef를 만들지 않습니다.

배정 변경은 G1이면 G1과 종속 G2, G2이면 G2의 epoch를 각각 한 번 올립니다. 현재 자료가 준비됐으면 정책 체크리스트, 배정, 검토자, 설명, 문서, 질문 결과, 결정, 분류, context source와 G2의 정확한 유효 G1 묶음을 새 불변 bundle로 고정하고 검토 요청을 만듭니다. 바로 전 current bundle의 pending 요청만 새 요청으로 대체하며 과거 요청, 승인, 미해결 수정 요청과 원 요청자는 보존합니다.

### M-031 applyPolicyToSr

현재 `team_admin`이 한 정책 version을 선택한 G1 또는 G2에 명시 적용합니다. `PolicyApplicationGuard.resources`에는 선택한 gate별 정확한 `review_gate_state` revision이 한 번씩 있어야 합니다. 누락, 중복, 다른 SR, 선택 밖 gate는 전체 명령을 거절합니다. 직접 선택한 gate의 정책 참조만 바꾸고 G1 변경의 종속 G2 영향은 함께 반영합니다.

결과 `PolicyApplicationResult`는 gate별 `BundleAvailable` 또는 `NeedsInputs`와 전체 `ReviewImpact`를 한 receipt에 반환합니다. 두 gate를 함께 선택하면 G1 새 기준을 먼저 고정한 뒤 G2가 현재 유효한 G1 조건을 다시 검사합니다. 과거 통과나 승인을 새 epoch로 복사하지 않습니다.

## S-09 기본 조회

### M-045 getBoard

현재 프로젝트 멤버만 조회합니다. 각 카드에는 실제 current 설명의 제목, SR별 revision, 단계, owner, G1·G2 상태를 반환합니다. `BoardView.revision`은 `workspace_projects.revision`인 프로젝트 설정 revision입니다. 전체 보드 변경 순번이나 쓰기 허가 token으로 사용하지 않습니다. 검색, 단계, gate, 차단 여부와 owner filter를 같은 읽기 snapshot에서 적용합니다.

### M-047 getSrDetail

현재 프로젝트 멤버만 조회합니다. 실제 original/current 설명 본문, Mock Jira 출처, 종류·내용·출처·확인 상태를 갖춘 현재 context source, artifact와 추적 정보, 질문, 결정, review bundle, reviewer 요청·승인·현재 gate 평가, generation run과 작은 generation draft 목록, 외부 구현 이력을 같은 read transaction에서 조립합니다. `reviewConfigurations`는 gate별 현재 revision·epoch·validity와 실제 정책·배정·bundle 참조를 반환합니다. `reviewPreparations`는 공식 검토와 같은 읽기 전용 capture로 계산한 `Ready`의 정확한 M020 입력·체크리스트 또는 `NeedsInputs`의 부족 항목·담당자를 반환하며 조회 중 bundle이나 요청을 만들지 않습니다. review bundle은 체크리스트 snapshot, 배정·정책·설명과 모든 JSON version ref의 실제 범위·존재를 검사합니다. reviewer 요청과 승인은 현재 bundle·epoch·정책·배정·체크리스트·처리 결과 관계를 검사하고 허용된 필드만 반환합니다. draft 목록은 ID, 작업 종류, provenance, 고정 snapshot과 fingerprint, freshness와 적용 상태만 반환하며 큰 본문을 반복하지 않습니다. `{kind:'draft',draftId}` 입력은 선택한 `DraftView`와 불변 `InputSnapshot`을 `draftReview`로 반환하고 현재 비교가 가능하면 `preparation`을 함께 반환합니다. 현재 입력이 2 MiB를 넘으면 저장 초안은 계속 반환하고 `preparationUnavailable`에 비교 불가 이유를 명시합니다. 각 `sr.revision`은 그 응답 snapshot의 SR 현재성을 뜻합니다. 서로 다른 HTTP 응답이 같은 시점이라고 주장하지 않습니다. 저장된 source, review bundle, reviewer 요청·승인 또는 snapshot 판별 자료가 손상되면 임의 기본값을 만들지 않고 `STORE_UNAVAILABLE`로 거절합니다.

M-047의 `comments`는 원 문서 version·section과 작성자·선택 bundle을 반환합니다. `changeRequests`는 원 대상, 현재 artifact 또는 `missing_section`, 상태, blocking, 요청자·담당자, 현재 application·resolution refs와 허용된 event 필드만 반환합니다. 저장된 scope, 현재 artifact, bundle 또는 event 관계가 손상되면 `STORE_UNAVAILABLE`로 거절합니다.

## 조립과 테스트 경계

`src/runtime/application-composition.ts`가 S-01, S-02, S-06과 기본 S-09 adapter를 한 번만 조립합니다. `src/main.ts`와 `tests/helpers/test-app.ts`가 같은 handlers를 사용합니다. HTTP 계층 C-02는 persistence나 Mock provider를 직접 호출하지 않습니다.

`tests/helpers/domain-cases.ts`의 `demoCase`는 고정 DEMO-4 manifest ID만 반환합니다. `currentCase`와 `currentReviewInput`은 manifest와 실제 DB의 현재 SR·gate를 읽습니다. 이 helper는 업무 자료를 만들거나 승인 성공을 대신하지 않습니다.
