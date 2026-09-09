# CG-18 G1 backend 부분 구현 보고

## 범위

M-020, M-021, M-027과 gate가 있는 M-028을 실제 SQLite transaction과 공개 adapter에 연결했습니다. 기존 `sr_received`에서 `requirements`로 가는 M-028 경로는 유지했습니다. G1 화면과 브라우저 E2E는 후속 범위이므로 CG-18 전체 완료로 기록하지 않습니다.

## 구현 결과

- M-020은 현재 owner, gate revision, 정책·배정과 명시 refs를 다시 검사합니다. 준비가 부족하면 bundle과 receipt 없이 거절합니다. 같은 기준은 현재 bundle과 요청을 재사용합니다. 새 기준으로 `currentBundleRef`와 `needsNewBundle`이 바뀌면 gate revision을 한 번 올리고 새 revision을 receipt에 기록합니다.
- M-021은 현재 배정, 정확한 BundleRef·epoch와 고정 체크리스트를 검사합니다. 미해결 질문과 미확정 결정은 개별 승인을 막지 않습니다. 제거된 검토자의 과거 receipt도 현재 권한으로 거절합니다.
- M-027은 GP-01~09를 읽기 snapshot에서 계산합니다. GP-02는 고정 요구사항의 section, requirement link와 수용 기준을 검사합니다. GP-04는 미확정 결정의 실제 `decisionMakerId`를 담당자로 반환합니다.
- M-028은 현재 owner, SR revision, BundleRef·epoch와 GP 전체를 transaction 안에서 다시 검사합니다. 성공 시 pass, gate 상태, 단계, activity와 receipt를 함께 확정합니다.
- M-047은 검토 요청·승인·평가와 함께 `reviewConfigurations`와 `reviewPreparations`를 반환합니다. 준비 DTO는 실제 bundle capture와 같은 함수를 쓰며 조회 중 업무 자료를 쓰지 않습니다.
- 저장 JSON과 receipt replay는 허용 필드로 다시 구성합니다. 잘못된 관계나 필수값 손상은 `STORE_UNAVAILABLE`로 거절합니다.

## TDD와 검증

첫 행동 RED는 다음 명령에서 M-020 handler가 없어 공식 요청 단언이 실패한 결과였습니다.

```sh
npm test -- tests/integration/g1-review.test.ts
```

M-021/M-027 연결 전에는 같은 명령에서 승인 단언이 실패했습니다. GP-02 보완 전에는 구조가 빈 요구사항이 통과해 단언이 실패했습니다. M047 준비 DTO 보완 전에는 `reviewConfigurations`가 없어 `toHaveLength(2)`가 실패했습니다. 새 bundle revision 보완 전에는 새 요청 뒤 revision이 3에서 4로 바뀌어야 한다는 단언이 실제 3을 받아 실패했습니다.

최종 대상 검증은 다음과 같습니다.

```sh
npm test -- tests/integration/g1-review.test.ts
```

13개가 통과했고 exit code는 0입니다.

관련 회귀 검증은 다음과 같습니다.

```sh
npm test -- tests/contract/public-methods.test.ts tests/integration/artifact-edit.test.ts tests/integration/context-source.test.ts tests/integration/g1-review.test.ts tests/integration/generation-claim.test.ts tests/integration/generation-preparation.test.ts tests/integration/generation-request.test.ts tests/integration/question-decision.test.ts tests/integration/review-policy.test.ts tests/integration/sr-context.test.ts tests/integration/sr-services.test.ts
```

11개 파일의 119개 테스트가 통과했고 exit code는 0입니다.

```sh
npm run typecheck
```

CG-18 소유 코드의 이전 오류는 모두 해소됐지만 전체 명령은 exit code 1입니다. 병행 CG-16 UI 작업의 `tests/unit/web/client.test.ts:386`, `tests/unit/web/client.test.ts:405`에서 ref literal이 넓어지는 오류 두 건이 남았습니다. 이 파일은 CG-18 소유 범위가 아니므로 수정하지 않았습니다.

## 미실행 범위

G1 UI와 `tests/e2e/bundles/g1.spec.ts`는 아직 구현하지 않았습니다. 실제 Claude, 브라우저, 성능과 복구 검증은 이 backend 부분에서 실행하지 않았습니다.

## 독립 검토 fix round 1

M-021의 같은 key 재생보다 현재 bundle·epoch 검사를 먼저 적용해, 승인 뒤 문서·질문·결정 기준이 바뀌면 이미 확정한 명령도 `STALE_BUNDLE`로 바뀌는 문제가 있었습니다. 현재 프로젝트 멤버십과 현재 gate 배정 자격은 먼저 확인하되, 동일 key와 동일 fingerprint의 receipt는 원 ApprovalView와 receipt를 재생한 뒤 fresh gate current를 별도로 반환하도록 순서를 바꿨습니다. 신규 key의 승인만 현재 bundle·epoch·`needsNewBundle`을 검사합니다. 배정에서 제거된 검토자의 재생 거절은 유지합니다.

행동 RED는 다음 명령에서 확인했습니다.

```sh
npm test -- tests/integration/g1-review.test.ts
```

M-021 성공 뒤 M-014로 질문 분류를 바꾸고 같은 key를 재전송했을 때 기대한 `Replayed` 대신 `STALE_BUNDLE`이 반환돼 13개 중 1개가 실패했고 exit code는 1이었습니다. 수정 뒤 같은 테스트 13개가 통과했고 exit code는 0입니다. M-015 문서 변경 뒤 같은 key도 원 승인과 receipt를 재생하며 승인·승인 activity 수를 늘리지 않는지 확인했습니다. 같은 key의 다른 comment는 `IDEMPOTENCY_CONFLICT`, 현재 배정에서 제거된 검토자는 `NOT_ASSIGNED`를 유지합니다.

관련 회귀 명령은 다음과 같습니다.

```sh
npm test -- tests/contract/public-methods.test.ts tests/integration/artifact-edit.test.ts tests/integration/context-source.test.ts tests/integration/g1-review.test.ts tests/integration/generation-claim.test.ts tests/integration/generation-preparation.test.ts tests/integration/generation-request.test.ts tests/integration/question-decision.test.ts tests/integration/review-policy.test.ts tests/integration/sr-context.test.ts tests/integration/sr-services.test.ts
```

11개 파일의 119개 테스트가 통과했고 exit code는 0입니다. 최종 `npm run typecheck`도 exit code 0입니다.
