# CG-19 backend 부분 구현 보고

CG-19의 M-022~026 backend, M-015 미해결 요청 승계와 M-047 조회 DTO를 구현했습니다. 화면과 브라우저 E2E는 후속 작성자 범위이므로 이 보고서는 backend 부분만 다룹니다.

## TDD 근거

- 최초 행동 RED: `npm test -- tests/integration/change-request.test.ts`는 exit 1, 1개 중 1개 실패였습니다. M-025 handler가 없어 검토자 배정에서 빠진 원 요청자의 해결 확인 결과가 `ok:false`였습니다.
- receipt 경계 RED: append-only 보호 trigger를 격리 fixture에서 명시적으로 해제한 뒤 같은 명령 receipt에 top-level·nested canary를 넣었습니다. 대상 테스트는 exit 1, 7개 중 1개 실패였고 M-024 재생 응답이 두 canary를 그대로 노출했습니다.
- strict replay codec을 연결한 뒤 같은 명령은 최초 `awaiting_confirmation` 값을 반환하고 후속 `open` 상태 revision은 `current`에만 반환합니다. canary는 응답에서 제거됩니다.
- M-015 차단 요청 승계 테스트의 첫 실패는 DEMO-4 과거 fixture의 `REQ-AUTH-331을` 표기가 현재 exact identifier 규칙과 맞지 않은 테스트 준비 문제였습니다. 공백을 둔 유효 편집 입력으로 바로잡은 뒤 실제 승계 행동을 검사했습니다. 이 실패는 제품 행동 RED로 집계하지 않습니다.

## 구현 경계

- M-022는 실제 문서 version·section과 선택 bundle을 확인해 댓글, activity와 receipt를 원자적으로 저장하며 gate와 SR revision을 유지합니다.
- M-023은 현재 영향 gate의 지정 검토자, gate revision, bundle, epoch와 담당자 membership을 확인합니다. 비차단 요청은 승인 상태를 유지하고 차단 요청은 영향 gate만 새 검토 기준으로 전환합니다.
- M-024는 요청 담당자 또는 SR owner가 실제 current artifact에 제출한 반영 요약과 evidence를 고정합니다. M-025와 M-026은 원 요청자 또는 현재 영향 gate reviewer만 정확한 현재 application event를 확인할 수 있습니다.
- M-015는 같은 논리 artifact의 모든 `open`·`awaiting_confirmation` 요청을 새 version으로 승계합니다. 삭제된 section은 `missing_section`으로 남기며 요청 ID, 요청자, blocking과 상태를 유지합니다.
- M-047은 댓글, 수정 요청과 event를 허용 필드로 재구성합니다. scope, bundle, artifact, 현재 target, application·resolution 관계가 손상되면 `STORE_UNAVAILABLE`로 거절합니다.
- 동일 명령 재생은 현재 권한을 먼저 확인하고 최초 DTO와 receipt를 strict codec으로 반환합니다. 최신 request revision은 `current`에 분리합니다.

## 검증

- `npm test -- tests/integration/change-request.test.ts`: 중간 대상 검증에서 exit 0, 10/10 PASS였습니다. 마지막 G1 종속 영향 사례는 아래 관련 검증에 포함했습니다.
- `npm run typecheck`: exit 0입니다.
- `npm test -- tests/contract/public-methods.test.ts tests/integration/artifact-edit.test.ts tests/integration/review-policy.test.ts tests/integration/g1-review.test.ts tests/integration/change-request.test.ts`: exit 0, 70/70 PASS입니다. 이 실행에 CG-19 대상 11개가 모두 포함됐습니다.
- 실제 Claude 호출, 브라우저 E2E, 성능·복구 검사는 실행하지 않았습니다.

## 남은 범위

`SectionDiscussion` 화면과 `tests/e2e/bundles/change.spec.ts`는 별도 UI 작성·검토 뒤 연결합니다. 따라서 CG-19 전체 완료나 US-016~018 UI 완료를 주장하지 않습니다.

## 독립 검토 fix round 1

- 공개 흐름 RED probe `./node_modules/.bin/tsx --tsconfig tsconfig.json /tmp/cg19-boundary-probe.ts`는 exit 0으로 재현을 마쳤습니다. M-025 해결 뒤 M-015 v3 저장은 성공했지만 M-047은 `STORE_UNAVAILABLE`이었습니다. M-015 v2와 새 G2 M-020 뒤 과거 v1 section의 M-023도 `STORE_UNAVAILABLE`이었습니다. 최초 probe의 seed 원문 exact identifier 오류는 유효한 편집 입력으로 바로잡았으며 행동 RED로 세지 않습니다.
- 회귀 테스트 RED `npm test -- tests/integration/change-request.test.ts`는 exit 1이며 15개 중 새 4개가 실패했습니다. 해결 이력 조회, 과거 version 요청, M-017 승계, M-018 승계가 각각 기대한 `ok:true` 대신 M-047 또는 M-023의 `STORE_UNAVAILABLE`을 반환했습니다.
- `readChangeRequests`는 해결된 요청의 역사 target에는 실재 version만 요구합니다. 미해결 요청에는 현재 version 또는 `missing_section` 조건을 유지합니다. M-023은 원 과거 ref를 보존하면서 같은 논리 artifact의 현재 section으로 `currentTargetRef`를 계산합니다.
- M-015와 M-017의 공통 저장 경계 및 M-018의 artifact 적용 경계가 같은 transaction에서 미해결 요청을 승계합니다. 동일 M-017·M-018 재생은 carry event를 한 개로 유지합니다. M-017의 늦은 activity 실패는 artifact version, 요청 승계 event·revision과 receipt를 모두 rollback합니다.
- 최소 구현 뒤 `npm test -- tests/integration/change-request.test.ts`는 exit 0이며 16개가 통과했습니다.
- 관련 검증 `npm test -- tests/integration/change-request.test.ts tests/integration/artifact-edit.test.ts`는 exit 0이며 29개가 통과했습니다. 수정한 같은 snapshot에서 원 probe를 다시 실행해 해결 이력의 M047이 `ok`, 과거 version의 M023이 `open`임을 확인했습니다.
- `npm run typecheck`은 이번 변경 경로의 타입 오류를 고친 뒤에도 exit 1이었습니다. 병행 작성 중인 `tests/integration/restricted-generation-loop.test.ts:51,92`의 `GenerationResult.proposals` tuple narrowing 오류 2개만 남았습니다. CG19 경로를 가리키는 오류는 없습니다.
