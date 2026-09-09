# CG-17 정책·배정 UI 구현 보고

CG-17의 프로젝트 기본 검토 정책 편집과 SR별 G1·G2 정책·검토자 배정을 실제 M-001, M-029, M-030, M-031, M-047 HTTP 경로에 연결했습니다. backend와 공통 계약은 변경하지 않았습니다.

## 구현 범위

- 팀 설정은 현재 정책을 구조형 필드로 보여주고 `team_admin`만 새 불변 버전을 저장합니다. `requireAllAssigned=true`와 `requireDistinctPeer=true`는 바꿀 수 없는 승인 원칙으로 유지합니다.
- 새 기본 정책은 기존 SR에 자동 적용되지 않음을 화면에 밝힙니다. 현재 기본 정책이 있으면 정확한 `previousPolicyRef`와 변경 이유로만 개정합니다.
- SR 상세는 G1·G2별 현재 정책, 배정 준비 상태, 누락 자료를 보여줍니다. 빈 배정과 담당자만 배정도 저장하지만 준비 완료로 표시하지 않습니다.
- 배정 변경은 현재 `ReviewAssignmentRef`와 `review_gate_state` revision guard를 함께 보냅니다. 정책 적용은 선택한 모든 gate의 exact revision을 `PolicyApplicationGuard.resources`로 보냅니다.
- 409 응답 뒤 작성 중 선택을 유지하고 최신 기준을 명시적으로 채택하거나 편집을 폐기할 수 있습니다. 전송 결과가 불명확하면 같은 idempotency key로 확인합니다. 늦은 성공 응답은 응답 대기 중 바꾼 검토자 선택을 덮지 않습니다.
- browser client는 M-001의 정책 목록과 M-029~031 결과, M-047의 `reviewConfigurations`와 `reviewPreparations`를 scope·gate·revision·ref 관계까지 검사합니다.
- CG-19 작성자와 합의한 M-047 `comments`와 `changeRequests`도 저장 DTO의 scope, ref, status, event kind별 필수 조합을 렌더 전에 검사합니다. CG-19 화면은 이 과제에서 구현하지 않았습니다.
- `ChangeRequestEventView.changeRequestId`는 바깥 수정 요청 ID와 일치해야 하며 선택 `bundleRef`도 같은 SR scope여야 합니다.

## TDD 근거

client 행동 RED는 다음 명령으로 확인했습니다.

```sh
npm test -- tests/unit/web/client.test.ts -t '정책·배정|M-001과 M-047의 정책'
```

결과는 exit 1, 2개 실패와 18개 미선택이었습니다. M-029의 `null` 성공값을 `Committed`로 받아들였고 M-001의 `policies:[null]`을 정상 Query로 받아들였습니다.

UI 행동 RED는 다음 명령으로 확인했습니다.

```sh
npx playwright test tests/e2e/bundles/policy.spec.ts
```

결과는 exit 1, 2개 실패였습니다. `팀 검토 정책`과 `검토자와 정책 배정` 영역이 없어서 각각 locator assertion과 timeout이 발생했습니다.

최초 구현 뒤 2개 E2E 실행에서는 1개가 통과하고 1개가 실패했습니다. 정책 저장 응답과 제출한 편집의 타입이 다른 값을 직접 비교해 저장 중 편집으로 잘못 판정한 구현 결함이었습니다. 제출 시 만든 `PolicyEdit`끼리 비교하도록 고쳤습니다.

확장 E2E 최초 실행은 6개 중 5개가 통과했습니다. 불명확 결과 테스트가 실제 화면에 없는 `새 SR 등록` 버튼 이름을 사용해 timeout이 발생했습니다. 격리 TestApp API로 SR fixture를 만든 뒤 실제 보드에서 여는 경로로 고쳤습니다. 이 실패는 제품 RED로 집계하지 않았습니다.

## 최종 검증

```sh
npm test -- tests/unit/web/client.test.ts
# exit 0, 21 tests passed

npx playwright test tests/e2e/bundles/policy.spec.ts
# exit 0, 7 tests passed

npm run typecheck
# exit 0

npm run build
# exit 0, client 203 modules transformed
```

CG-19의 마지막 DTO 보완인 event의 바깥 수정 요청 ID 관계와 선택 bundle scope를 반영한 뒤 다음 영향 검증도 통과했습니다.

```sh
npm test -- tests/unit/web/client.test.ts && ./node_modules/.bin/tsc -p tsconfig.web.json --noEmit && npm run build
# exit 0, 21 tests passed, web typecheck exit 0, client 203 modules transformed
```

마지막 정책 저장 방식 문구와 선택 범위를 정리한 뒤 영향 경로를 다음 명령으로 다시 확인했습니다.

```sh
npx playwright test tests/e2e/bundles/policy.spec.ts -g 'team admin이'
# exit 0, 1 test passed

./node_modules/.bin/tsc -p tsconfig.web.json --noEmit
# exit 0

npm run build
# exit 0, client 203 modules transformed
```

Vite는 build 중 기존 native config loader 호환 경고와 500 kB chunk 경고를 출력했지만 build는 통과했습니다. 실제 Claude 호출, 성능, 복구 검증은 이 UI 하위범위에서 실행하지 않았습니다. CG-18의 검토 요청·승인·gate 판정 UI는 다음 과제입니다.

## 변경 경로

- `src/web/App.tsx`
- `src/web/api/client.ts`
- `src/web/components/SRDetail.tsx`
- `src/web/components/SRDetailShell.tsx`
- `src/web/components/SRReviewAssignment.tsx`
- `src/web/components/TeamPolicyEditor.tsx`
- `src/web/styles/base.css`
- `tests/unit/web/client.test.ts`
- `tests/e2e/bundles/policy.spec.ts`
- `aidlc-docs/construction/planrepo/code/task-17-ui-report.md`

전체 CG-17 완료 표시와 중앙 계획·state·audit 갱신은 root 검토 뒤 처리합니다.

## 독립 검토 fix round 1

독립 검토의 Important 2건을 실제 지연 응답 E2E로 수정했습니다.

- 정책 편집은 화면이 나중에 받은 `workspace.defaultPolicyRef`가 아니라 `FormDraft`에 고정한 basis ref로 `previousPolicyRef`를 만듭니다. 저장 중 유지한 편집은 최신 정책을 자동 기준으로 삼지 않습니다. 사용자가 `현재 입력에 최신 기준 사용`을 선택한 뒤에만 새 ref를 사용합니다.
- 검토자 배정은 reviewer ID뿐 아니라 변경 이유까지 제출값과 비교합니다. 전송 중 reason만 바뀌어도 성공 응답은 현재 편집을 초기화하지 않습니다.

행동 RED는 다음 명령으로 확인했습니다.

```sh
npx playwright test tests/e2e/bundles/policy.spec.ts -g '명시적으로 채택|변경 이유는 늦은'
# exit 1, 3개 중 기존 1개 통과, 새 회귀 2개 실패
```

정책 테스트는 최신 정책 ref를 자동 사용해 stale 경고가 나타나지 않았습니다. 배정 테스트는 새 변경 이유 입력 자체는 남았지만 저장 완료 메시지를 표시하고 dirty 상태를 초기화해 `현재 선택은 유지했습니다.` assertion이 실패했습니다.

수정 뒤 같은 명령은 exit 0, 3 tests passed였습니다. 변경 범위 전체는 다음 명령으로 확인했습니다.

```sh
npx playwright test tests/e2e/bundles/policy.spec.ts && ./node_modules/.bin/tsc -p tsconfig.web.json --noEmit
# exit 0, 9 tests passed, web typecheck exit 0
```

fix round 1의 변경 경로는 `src/web/components/TeamPolicyEditor.tsx`, `src/web/components/SRReviewAssignment.tsx`, `tests/e2e/bundles/policy.spec.ts`, 이 보고서입니다. 사용자 preview의 `.planrepo/previews/cg17-20260909` snapshot과 실행 session 64858은 수정하거나 재시작하지 않았습니다.

배정 회귀는 command 처리 완료 메시지를 기다린 뒤 변경 이유 값과 dirty 표시를 확인하도록 보강했습니다. `npx playwright test tests/e2e/bundles/policy.spec.ts -g '기존 배정 저장 중'`은 exit 0, 1 test passed였습니다.
