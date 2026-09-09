# CG-18 G1 공식 검토 UI 구현 보고

CG-18의 요구사항 검토 요청, 고정 검토본 확인, 지정 검토자의 개별 승인, 현재 조건 재검사와 담당자의 계획 단계 이동을 실제 M-020, M-021, M-027, M-028, M-047 HTTP 경로에 연결했습니다. backend와 공통 계약은 변경하지 않았습니다.

## 구현 범위

- SR 상세의 검토 요약은 현재 G1 설정과 같은 검토본·검토 시점의 요청과 승인만 집계합니다. 지정 검토자가 없으면 승인 완료로 표시하지 않습니다.
- 담당자는 M-047이 준비한 정확한 입력과 `review_gate_state` revision guard로 공식 검토를 요청합니다. 같은 현재 기준의 재요청은 기존 불변 검토본과 요청을 재사용합니다.
- 지정 검토자는 요청 당시 고정된 문서, 질문 결과, 확정·미확정 결정과 체크리스트를 읽고 개별 승인합니다. 미해결 질문은 개별 승인 자체를 막지 않으며 단계 이동 조건에서 별도로 판정합니다.
- 검토에서 제외된 사용자가 이전 화면에서 승인을 제출하면 서버 거절을 화면에 유지하고 승인 기록을 만들지 않습니다.
- 담당자는 M-027로 현재 조건을 다시 확인한 뒤 M-028에 정확한 SR revision, BundleRef, reviewEpoch를 보내 계획 단계 이동을 확정합니다.
- 단계 이동 409 뒤 작성한 이유를 유지합니다. 새 기준은 `현재 작성 내용에 최신 기준 사용`을 명시적으로 선택한 뒤에만 사용합니다.
- 불명확한 명령 결과는 같은 idempotency key로 다시 확인합니다. 승인 응답을 기다리는 동안 고친 의견은 늦은 성공 응답으로 덮지 않습니다.
- 화면에는 `GP-*`, epoch, 내부 ref를 노출하지 않습니다. G1과 G2는 각각 `요구사항 검토`, `계획 검토`로 설명하고 서버의 사용자 중심 조건 사유와 실제 사용자 이름을 표시합니다.
- browser client는 M-020, M-021, M-027, M-028 결과와 M-047의 검토 요청·승인·조건 DTO를 scope, gate, ref, revision 관계까지 검사합니다. malformed 성공값은 command에서 `TransportUncertainError`, query에서 조회 오류로 처리합니다.

## TDD 근거

client 행동 RED는 다음 명령으로 확인했습니다.

```sh
npm test -- tests/unit/web/client.test.ts -t '공식 검토|검토 요청·승인'
```

결과는 exit 1, 2개 실패와 21개 미선택이었습니다. M-020의 `null` 성공값을 Committed로 받아들였고 M-047의 `reviewRequests:[null]`을 정상 Query로 받아들였습니다. strict codec을 구현한 뒤 같은 명령은 exit 0, 2개 통과와 21개 미선택이었습니다.

UI 행동 RED는 다음 명령으로 확인했습니다.

```sh
npx playwright test tests/e2e/bundles/g1.spec.ts
```

결과는 exit 1, 3개 실패였습니다. 공식 검토 요청, 고정 검토본 승인, 현재 조건 확인 화면이 없어서 각 locator가 실패했습니다.

초기 구현 뒤 3개 중 2개가 통과했습니다. `공식 검토` region 이름이 바깥 요약과 안쪽 요청 영역에 중복돼 첫 검사가 strict locator 오류로 실패했습니다. 안쪽 영역을 `검토 요청`으로 구체화한 뒤 3개가 모두 통과했습니다.

검토자 제외, 빈 승인 집계, 불명확 응답을 추가한 첫 실행은 6개 중 5개가 통과했습니다. 검토자 제외로 서버가 승인을 거절한 직후 자동 새로고침이 오류 영역과 작성 입력을 제거했습니다. 거절 결과를 현재 폼에 유지하도록 고친 뒤 6개가 모두 통과했습니다.

단계 이동 충돌과 늦은 승인 응답 회귀를 추가했습니다. 첫 늦은 응답 테스트는 체크리스트를 선택하지 못해 로컬 validation에서 멈췄으므로 제품 RED로 집계하지 않았습니다. 실제 체크리스트 label로 선택하도록 fixture를 바로잡은 뒤 지연 응답까지 통과했습니다.

## 최종 검증

```sh
npm test -- tests/unit/web/client.test.ts
# exit 0, 23 tests passed

npx playwright test tests/e2e/bundles/g1.spec.ts
# exit 0, 8 tests passed

./node_modules/.bin/tsc -p tsconfig.web.json --noEmit
# exit 0

npm run build
# exit 0, client 207 modules transformed
```

`npm run typecheck`은 exit 1이었습니다. CG-18 소유 코드가 아니라 병행 CG-15의 `tests/integration/restricted-generation-loop.test.ts:51`과 `:92`에서 `QuestionProposal[]`을 `NonEmpty<QuestionProposal>`로 좁히지 못한 2개 오류입니다. 이 결과를 root와 CG-15 작성자에게 분리 전달했습니다. 동일 시점의 web typecheck는 exit 0입니다.

Vite는 build 중 기존 native config loader 호환 경고와 500 kB chunk 경고를 출력했지만 build는 통과했습니다. 실제 Claude 호출, 성능, 복구 검증은 이 UI 하위범위에서 실행하지 않았습니다.

사용자 미리보기의 이전 session 64858은 문구 교체 요청에 따라 Ctrl-C로 정상 종료해 exit 0을 확인했습니다. 미리보기 DB, config, static snapshot은 수정하지 않았습니다. 새 preview session 36148은 root 소유이므로 이 과제에서 변경하거나 재시작하지 않았습니다.

## 변경 경로

- `src/web/api/client.ts`
- `src/web/components/ReviewSummary.tsx`
- `src/web/components/ReviewRequestForm.tsx`
- `src/web/components/BundleReviewForm.tsx`
- `src/web/components/GateConditionPanel.tsx`
- `src/web/components/SRDetail.tsx`
- `src/web/components/SRDetailShell.tsx`
- `src/web/styles/base.css`
- `tests/unit/web/client.test.ts`
- `tests/e2e/bundles/g1.spec.ts`
- `aidlc-docs/construction/planrepo/code/task-18-ui-report.md`

CG-18 전체 완료 표시와 중앙 계획·state·audit 갱신은 root 검토 뒤 처리합니다.
