# CG-04 구현 보고

CG-04는 지원 schema만 있는 빈 DB에 DEMO-4 업무 그래프를 한 번의 `BEGIN EXCLUSIVE` transaction으로 기록합니다. 같은 transaction 안에서 업무 자료 부재를 확인하고, 네 SR의 전체 관계와 JSON 참조를 검증한 뒤 manifest를 마지막에 기록합니다.

## 구현 결과

- `config/demo/manifest.json`은 `seedId=DEMO-4`, `version=1`, `projectId=demo-project`, 고정 persona 5명과 PAY-102·AUTH-331·NOTI-028·CAT-093의 ID를 보존합니다.
- `config/demo/scenarios.json`은 정책·배정·문서 버전·질문/결정·bundle·approval/pass·change·handoff·implementation 이력을 정의합니다.
- `config/demo/reference-mocks.json`은 Jira·GitHub 가상 근거와 시드에 넣지 않는 내부 검토 사례를 구분합니다.
- `src/persistence/seed-demo.ts`의 `seedDemo(db)`는 기존 maintenance owner, 활성 runtime, 점유 slot, running 작업을 공통 offline maintenance 경계에서 거절합니다. 완료 표식이나 기존 업무 자료도 transaction 안에서 거절합니다.
- 불변 `runtime_identities` 이력만 있고 활성 `runtime_instances`가 없으면 시드를 허용하고 그 이력을 보존합니다.
- seed validator는 bundle, approval, pass, invalidation, classification, change와 handoff의 JSON 참조를 같은 project/SR/종류/논리 ID/version의 실제 행과 대조합니다. 정책·배정·checklist·reviewer·approval·pass 관계도 대조합니다.
- CAT-093은 현재 `progressStage=requirements`와 과거 H1의 `ImplementationRecord.status=started`를 분리합니다. `active_implementation_id`는 비어 있습니다. 요구사항 v2 뒤 G1은 `implementing`에서 `requirements`로 돌아가고, 종속 G2는 제품 단계를 다시 바꾸지 않은 채 무효화됩니다.
- AUTH-331은 과거 G2 epoch 1 승인 뒤 implementation plan v2와 적용 event가 이어집니다. 현재 G2는 epoch 2, `not_passed`, `needs_new_bundle=true`이고 change는 `awaiting_confirmation`입니다.
- `tests/helpers/demo-manifest.ts`의 `readDemoManifest(db)`는 manifest digest와 registry, 프로젝트·정책, persona 5명, SR 4건과 현재 제품 단계를 읽기 전용으로 대조합니다.
- `scripts/db-migrate.ts`와 `scripts/seed-demo.ts`는 현재 runtime config와 project path를 사용해 `.planrepo`의 선택된 dataDir 아래 `planrepo.sqlite`를 엽니다.

## TDD 근거

첫 `npm test -- tests/integration/demo-seed.test.ts`는 exit 1이었습니다. 수집 가능한 no-op `seedDemo`가 고정 SR 4건 assertion에 빈 배열을 반환해 예상대로 RED가 됐습니다. 반복·기존 자료·rollback·runtime/slot/running·JSON 참조 검사까지 확장한 no-op 실행도 8개 assertion이 모두 실패했습니다.

구현 중 다음 RED를 별도로 확인했습니다.

- `npm test -- tests/integration/demo-seed.test.ts`는 CAT 요구사항 v2가 implementation 시작보다 먼저 기록된 시각 비교에서 exit 1이었습니다. 도메인 사건 시각을 삽입 순서와 분리한 뒤 통과했습니다.
- 같은 명령은 AUTH change의 `auth-error-contract` section이 실제 implementation plan 버전에 없어서 exit 1이었습니다. 두 계획 버전의 Markdown·section index에 같은 section을 추가하고 validator가 section 존재를 검사한 뒤 통과했습니다.
- 같은 명령은 `readDemoManifest`의 수집 가능한 미구현 오류로 exit 1이었습니다. digest와 실제 행을 읽기 전용으로 검사한 뒤 통과했습니다.
- 같은 명령은 존재하지만 bundle 배정 관계가 다른 JSON 참조를 validator가 받아들여 exit 1이었습니다. bundle·pass·handoff의 정책, 배정, 승인 집합 관계 검사를 추가한 뒤 9개 테스트가 모두 통과했습니다.

첫 `npm run typecheck`는 exit 1이었습니다. JSON import에서 넓어진 persona key와 progress stage의 `string` 타입 두 곳, better-sqlite3 타입에 없는 `totalChanges` 사용 두 곳을 찾았습니다. config key와 stage를 좁히고 SQLite의 `total_changes()` 읽기 쿼리로 바꿨습니다.

## 최종 검증

| 명령 | exit | 결과 |
|---|---:|---|
| `npm test -- tests/integration/demo-seed.test.ts tests/integration/storage-atomicity.test.ts` | 0 | 2개 파일, 43개 테스트가 통과했습니다. |
| `npm run typecheck` | 0 | server와 web TypeScript 검사가 통과했습니다. |
| `npm test` | 0 | 4개 파일, 85개 테스트가 통과했습니다. |
| `node --input-type=module -e "import { readFileSync } from 'node:fs'; for (const file of ['config/demo/manifest.json','config/demo/scenarios.json','config/demo/reference-mocks.json']) JSON.parse(readFileSync(file, 'utf8')); console.log('demo JSON OK')"` | 0 | `demo JSON OK`를 출력했습니다. |

CLI는 `node:crypto`의 `randomUUID()`가 만든 testRunId `1ea027cc-c9d2-425a-bb5b-291a552ec88a`로 실제 실행했습니다.

| 명령 | exit | 결과 |
|---|---:|---|
| `PLANREPO_MODE=test PLANREPO_TEST_RUN_ID=1ea027cc-c9d2-425a-bb5b-291a552ec88a npm run db:migrate` | 0 | 격리된 test-runs dataDir에 schema를 준비했습니다. |
| `PLANREPO_MODE=test PLANREPO_TEST_RUN_ID=1ea027cc-c9d2-425a-bb5b-291a552ec88a npm run seed:demo` | 0 | 같은 DB에 DEMO-4를 기록했습니다. |
| 위 `seed:demo` 명령 재실행 | 1 | `이미 DEMO-4 시드가 완료됐습니다.`로 거절했습니다. 기존 자료는 통합 테스트의 before/after 비교로 보존을 확인했습니다. |

GREEN 뒤 shared DTO나 storage transaction을 옮기는 리팩터링은 하지 않았습니다. CG-04 내부의 삽입·참조 검사 함수로 책임을 유지했고 최신 변경 경로는 targeted 검사와 전체 테스트로 다시 확인했습니다.

Claude, 브라우저, 성능, 복구 훈련은 이 offline seed 과제의 완료 기준에 없어 실행하지 않았습니다. 설치, 전역 설정, 외부 호출과 commit도 하지 않았습니다. 비활성화된 Security Baseline, Resiliency Baseline, Property-Based Testing 확장 규칙은 N/A입니다.

## 독립 검토 fix round 1

`npm test -- tests/integration/demo-seed.test.ts`를 먼저 실행했습니다. exit 1이었고 13개 테스트 중 4개가 예상한 이유로 실패했습니다. 문서 section의 `startOffset`이 없었고, manifest의 존재하지 않는 `handoffId`를 받아들였으며, `OWNER_ID` 행동을 `actor_kind=system`으로 기록했습니다. CAT-093 G1 pass의 epoch를 1에서 2로 바꾼 오염도 commit 전 검증을 통과했습니다.

문서 저장은 Markdown에서 각 제목의 실제 `startOffset`과 `endOffset`을 계산하도록 고쳤습니다. `requirementLinks`, Workflow 단계 선택, `requirementTaskLinks`는 `src/contracts/views.ts`의 필수 필드와 연결을 그대로 저장하고 validator가 Markdown 범위와 참조를 검사합니다. manifest의 `entityIds`는 시나리오 ID 구성이 다르면 transaction 전에 거절하며, `readDemoManifest(db)`는 각 ID가 같은 project와 SR의 실제 question·decision·bundle·change·handoff·implementation 행인지 확인합니다.

pass는 행의 epoch와 bundle 열을 payload와 고정 bundle에 대조합니다. handoff는 네 종류의 자료 참조와 G1/G2 pass가 고정 G2 bundle 및 상위 G1과 같은지 확인합니다. 현재 gate state는 epoch, 정책, 배정, 현재 bundle, last pass와 invalidation을 함께 검사합니다. 명시적인 가상 사용자 행동은 `actor_kind=user`, `actor_id=persona-p01-owner`로 기록합니다.

| 명령 | exit | 결과 |
|---|---:|---|
| `npm test -- tests/integration/demo-seed.test.ts` | 0 | fix round 1 회귀 3개를 포함한 13개 테스트가 통과했습니다. |
| `npm test -- tests/integration/demo-seed.test.ts tests/integration/storage-atomicity.test.ts` | 0 | 2개 파일, 46개 테스트가 통과했습니다. |
| `npm run typecheck` | 0 | server와 web TypeScript 검사가 통과했습니다. |

CG-05가 HTTP/runtime 파일을 구현 중이므로 이 round에서는 전체 테스트와 CLI를 다시 실행하지 않았습니다. CG-04가 직접 바꾼 seed, storage 경계와 타입 검사를 대상으로 검증했습니다.
