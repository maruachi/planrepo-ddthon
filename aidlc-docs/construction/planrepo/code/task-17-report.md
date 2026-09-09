# CG-17 backend 구현 보고

CG-17의 팀 검토 정책 version, 문서 없는 최초 검토자 배정, 특정 SR 정책 적용과 불변 review bundle 캡처를 구현했습니다. UI와 브라우저 검증은 이번 backend 동결 뒤 별도 과제로 남깁니다.

## 구현 범위

- `M-029`는 현재 `team_admin` 권한을 DB에서 다시 읽고 새 기본 정책 version을 만듭니다. 기존 SR의 gate 정책 참조는 바꾸지 않습니다.
- `M-003`은 새 SR의 G1·G2 상태에 등록 당시 프로젝트 기본 정책을 고정합니다.
- `M-030`은 최초 또는 변경 배정을 불변 version으로 저장합니다. 문서가 없거나 검토자가 비어 있어도 가짜 bundle을 만들지 않습니다. 배정 조건이 준비되고 문서가 있으면 새 bundle과 검토자별 요청을 만듭니다.
- `M-031`은 선택 gate마다 정확히 하나의 `review_gate_state` revision을 `PolicyApplicationGuard.resources`로 받습니다. 한 transaction에서 정책 참조를 적용하고 gate별 `BundleAvailable` 또는 `NeedsInputs`와 전체 `ReviewImpact`를 반환합니다.
- G1 변경은 G1과 종속 G2를 합집합으로 한 번씩만 무효화합니다. G2 변경은 G2만 바꿉니다. 두 gate 동시 적용은 G1을 먼저 캡처한 뒤 G2의 현재 유효 G1 조건을 다시 검사합니다.
- bundle은 현재 요구사항, G2의 진행 계획·선택 설계·구현 계획, 설명, 질문 결과, 확정·미확정 결정, 분류, context source, 배정, 검토자, 정책, 체크리스트와 생성 정보를 고정합니다. 조회 시 JSON ref의 scope·kind·version 존재와 배정·정책 열의 관계를 다시 검사합니다.
- 새 bundle은 바로 전 current bundle의 pending 요청만 supersede합니다. 과거 요청, 승인, 미해결 수정 요청과 원 요청자는 보존합니다.
- `M-001`은 기본 정책 참조와 전체 정책 version 목록을 반환합니다. `M-047`은 확장한 strict bundle snapshot을 반환하며 손상 자료를 `STORE_UNAVAILABLE`로 바꿉니다.
- receipt 재생 전에 현재 권한을 다시 검사합니다. M-029와 M-030은 저장 참조에서 결과를 재구성합니다. M-031은 bundle과 요청을 저장 자료에서 재구성하고 `NeedsInputs`와 `ReviewImpact`를 허용 필드만 복사합니다.

## TDD 근거

첫 행동 RED는 다음 명령으로 확인했습니다.

```sh
npm test -- tests/integration/review-policy.test.ts
```

결과는 exit 1, 1개 테스트 실패였습니다. 문서 없는 새 SR에 M-030을 호출했을 때 `result.ok`가 `false`여서 기대한 `true` assertion이 실패했습니다. import 오류나 fixture 준비 실패가 아니었습니다.

추가 시나리오를 구현 전에 확장한 실행에서는 exit 1, 4개 중 3개가 실패했습니다. M-029와 준비된 M-030이 미연결이라 `result.ok=false`였습니다. 당시 M-031 거절 테스트는 handler 부재 상태에서도 통과할 수 있어 이후 오류 code와 정상 복수 gate 적용·epoch 증가 assertion을 추가했습니다.

bundle 손상 조회 테스트의 행동 RED는 exit 1이었습니다. 존재하지 않는 `context_source` version ref를 넣은 뒤 M-047이 `INTERNAL_ERROR`를 반환해 기대한 `STORE_UNAVAILABLE`과 달랐습니다. 전용 `ReviewBundleReadError`를 추가하고 조회 service에서 안전한 저장 오류로 변환했습니다.

중간에 준비된 seed assignment의 선택 설명을 readiness로 잘못 해석해 `NeedsInputs`가 나온 실패가 있었습니다. 저장 설명을 readiness 신호로 사용하지 않고 현재 SR owner, 프로젝트 membership 역할과 적용 policy를 기준으로 다시 계산하도록 고쳤습니다. 체크리스트 배열 기대 길이를 잘못 쓴 테스트 실패와 테스트 내 append-only trigger 실패는 제품 RED로 집계하지 않았습니다.

최종 대상 검증은 다음과 같습니다.

```sh
npm test -- tests/integration/review-policy.test.ts
# exit 0, 8 tests passed

npm test -- tests/contract/public-methods.test.ts tests/integration/review-policy.test.ts
# exit 0, 30 tests passed

npm test -- tests/integration/review-policy.test.ts tests/integration/demo-seed.test.ts
# exit 0, 21 tests passed

npm run typecheck
# exit 0
```

최종 영향 검증은 다음 명령으로 새로 실행했습니다.

```sh
npm test -- tests/contract/public-methods.test.ts tests/contract/http-boundary.test.ts tests/contract/generation-public.test.ts tests/integration/demo-seed.test.ts tests/integration/sr-services.test.ts tests/integration/context-source.test.ts tests/integration/artifact-edit.test.ts tests/integration/question-decision.test.ts tests/integration/generation-preparation.test.ts tests/integration/readiness.test.ts tests/integration/review-policy.test.ts tests/unit/web/client.test.ts
# exit 0, 12 files, 128 tests passed

npm run typecheck
# exit 0
```

통합 테스트는 문서 없는 최초 배정, 정책 비소급과 신규 SR pin, 준비된 bundle/request, 빈 배정의 미준비 상태, 현재 권한 재검사, 후속 activity 실패 rollback, 엄격한 bundle 조회, 복수 gate guard·단일 epoch 증가, 승인·수정 요청 보존, receipt canary 비노출을 검사합니다.

## 변경 경로

- `src/contracts/context.ts`
- `src/contracts/views.ts`
- `src/contracts/methods.ts`
- `src/contracts/schemas.ts`
- `src/domain/review-policy.ts`
- `src/application/review-policy-service.ts`
- `src/application/review-bundle-snapshot.ts`
- `src/application/workspace-service.ts`
- `src/application/workspace-query-service.ts`
- `src/persistence/review-policy-repository.ts`
- `src/persistence/review-impact-repository.ts`
- `src/persistence/sr-repository.ts`
- `src/persistence/workspace-repository.ts`
- `src/runtime/application-composition.ts`
- `tests/integration/review-policy.test.ts`
- `tests/contract/public-methods.test.ts`
- `aidlc-docs/construction/planrepo/code/api-summary.md`
- `aidlc-docs/construction/planrepo/code/task-17-report.md`

## 미실행 경계

CG-17 UI와 `tests/e2e/bundles/policy.spec.ts`는 backend 독립 검토 뒤 별도 작성자가 연결하므로 실행하지 않았습니다. 실제 Claude, 성능, 복구 검증은 이 과제 범위가 아닙니다. 전체 CG-17 완료 체크와 중앙 계획·state·audit 갱신은 root가 담당합니다.

## 독립 검토 fix round 1

독립 검토의 Important 3건을 TDD로 수정했습니다.

- M-030은 저장 row의 정렬 순서와 원 영수증의 검토자 순서를 집합으로 교차 검증한 뒤 원 성공값 순서를 재생합니다. 후속 배정이 있어도 `value`는 원 값을 유지하고 `current`만 최신 gate revision을 반영합니다.
- M-031은 원 영수증의 gate 순서와 request ID 순서를 저장 bundle·request 집합과 교차 검증해 재구성합니다. 저장 조회 정렬이 성공 결과를 바꾸지 않습니다.
- M-047과 BundleAvailable replay의 bundle JSON ref는 `kind/projectId/srId/entityId/version`만 새 객체로 재구성합니다. 미확정 결정의 분류 ref도 실제 `scope_classification_versions` 대상이 그 결정인지 검증합니다.
- workspace service는 DB 읽기 예외만 `STORE_UNAVAILABLE`로 바꾸고, 미존재 project·actor와 미멤버를 각각 `NOT_FOUND`·`FORBIDDEN`으로 보존합니다.

행동 RED는 다음 명령으로 확인했습니다.

```sh
npm test -- tests/integration/review-policy.test.ts tests/contract/http-boundary.test.ts
# exit 1, 4 failures
```

실패는 M-030 비정렬 검토자 재생의 `STORE_UNAVAILABLE`, M-031 재생 gate 순서 불일치, bundle ref의 `CG17_CANARY` 노출, M-001 미멤버의 503 응답이었습니다. 추가한 정책 codec 손상 회귀는 실제 저장 오류가 503 `STORE_UNAVAILABLE`로 남는지 검사합니다.

수정 후 대상 검증은 다음과 같습니다.

```sh
npm test -- tests/integration/review-policy.test.ts tests/contract/http-boundary.test.ts
# exit 0, 2 files, 26 tests passed

./node_modules/.bin/tsx --tsconfig tsconfig.json /tmp/cg17-replay-order-probe.ts
# exit 0; M002 actual=NOT_FOUND, M030 replayOk=true,
# M031 sameValue=true, M047 canaryLeaked=false

npm run typecheck
# exit 0
```

fix round 1의 변경 경로는 `src/application/review-policy-service.ts`, `src/application/workspace-service.ts`, `src/persistence/sr-repository.ts`, `tests/integration/review-policy.test.ts`, `tests/contract/http-boundary.test.ts`, 이 보고서입니다. `src/runtime/application-composition.ts`는 수정하지 않았습니다.

관련 영향 검증은 다음과 같습니다.

```sh
npm test -- tests/contract/public-methods.test.ts tests/contract/http-boundary.test.ts tests/integration/demo-seed.test.ts tests/integration/sr-context.test.ts tests/integration/generation-preparation.test.ts tests/integration/readiness.test.ts tests/integration/review-policy.test.ts
# exit 0, 7 files, 81 tests passed
```

위 typecheck exit 0 후 병행 작성자의 WIP가 추가된 상태에서 `npm run typecheck`를 다시 실행했을 때는 exit 1이었습니다. `tests/integration/generation-claim.test.ts`의 아직 없는 `tests/helpers/runtime-workers` import·implicit any와 `tests/unit/web/draft-comparison.test.ts`의 JSX 설정·WIP fixture 타입 오류입니다. CG-17 fix1 변경 경로에서는 오류가 보고되지 않았습니다.
