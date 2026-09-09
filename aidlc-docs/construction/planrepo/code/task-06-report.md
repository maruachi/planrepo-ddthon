# CG-06 구현 보고

CG-06의 SR 등록, Mock 가져오기, 설명 개정, 접수 단계 전환, 기본 보드·상세 조회와 공통 application composition을 구현했습니다.

## 구현 결과

- `src/contracts/views.ts`에 SR 제목, original/current 설명 본문과 Mock ticket을 추가했습니다. 보드 카드는 큰 설명 본문을 중복하지 않습니다.
- `src/domain/authorization.ts`가 현재 프로젝트 멤버, 같은 프로젝트 owner와 실제 SR owner를 구분해 검사합니다.
- `src/application/sr-context-service.ts`와 `src/persistence/sr-repository.ts`가 M-003, M-004, M-005와 CG-06 범위의 M-028을 처리합니다. 등록은 SR, 설명 version 1, G1·G2 초기 상태, activity와 receipt를 하나의 IMMEDIATE transaction에서 저장합니다.
- M-004는 Mock 조회 전에 현재 멤버를 검사합니다. Mock 조회는 write lock 밖에서 수행하고 확정 transaction에서 권한, owner와 `sr_key`·`jira_key` 교차 중복을 다시 검사합니다.
- receipt replay는 현재 권한을 먼저 확인합니다. version 1 canonical envelope에 명령 종류, 명시 scope, NoGuard를 포함한 guard와 입력을 넣고 requestId·시각은 제외합니다. 같은 범위·actor·key의 envelope fingerprint가 같을 때만 최초 결과를 재생합니다. 최초 value·receipt와 재생 시점의 current basis를 분리합니다.
- `src/domain/review-impact.ts`와 `src/persistence/review-impact-repository.ts`가 설명 변경의 G1·G2 영향, epoch, invalidation과 제품 단계 복귀를 같은 transaction에 저장합니다. NOTI는 두 gate가 epoch 2 `invalid`가 되고 CAT는 epoch 3 `invalid`가 됩니다. 두 사례 모두 requirements로 돌아가며 과거 승인·bundle·handoff·외부 started 사실을 보존합니다.
- `src/application/workspace-query-service.ts`가 M-045와 M-047을 read transaction으로 조립합니다. Board revision은 Project 설정 revision이며 카드에는 각 SR revision을 반환합니다. 상세는 실제 설명, Mock, source, artifact, 질문, 결정, bundle, generation run과 외부 구현을 읽습니다.
- `src/persistence/generation-run-query.ts`는 generation run의 5개 status를 판별해 읽고 provider 선택, snapshot·draft scope, 성공 초안, 적용 행과 실제 종료 관찰을 검사합니다. claim token, raw 실행 경로와 저장 진단은 공개 DTO에 넣지 않습니다. 현재 입력 calculator가 없는 DB-only 조회는 최신성을 `unknown`과 이유로 반환합니다. 선택적 `CurrentInputFingerprintPort`가 실제 현재 지문을 제공할 때만 `current` 또는 `stale`을 계산합니다.
- artifact section, requirement link와 외부 완료 근거 JSON은 필수 필드와 non-empty 조건을 runtime에서 좁혀 DTO로 만듭니다. 약한 DTO나 `any`로 저장 자료를 합법화하지 않았습니다.
- `tests/helpers/domain-cases.ts`는 manifest 고정 ID와 실제 SR·gate 현재 조회만 제공합니다.
- `src/runtime/application-composition.ts`가 M-001, M-002와 새 메서드 adapter를 조립합니다. `src/main.ts`와 `tests/helpers/test-app.ts`가 같은 factory를 사용합니다. C-02는 업무 서비스나 provider를 직접 호출하지 않습니다.
- TestApp의 `serveWeb`은 기본 false입니다. true일 때만 현재 프로젝트의 `dist/web`과 프로젝트 root 정적 경계를 같은 listener에 연결합니다.
- 기존 `src/application/workspace-service.ts`와 `src/persistence/workspace-repository.ts` 공개 계약은 변경 없이 composition에서 재사용했습니다. `src/application/http/routes.ts`와 `src/application/http/server.ts`도 기존 DomainError 및 command/query 응답 경계로 새 handlers를 연결할 수 있어 CG-06에서 수정하지 않았습니다.

## TDD 기록

- 첫 `npm test -- tests/integration/sr-context.test.ts`는 exit 1이었습니다. 7개 모두 M-003, M-004, M-005, M-028, M-045, M-047 handler가 `NOT_IMPLEMENTED`를 반환해 기대한 행동 RED를 확인했습니다. 모듈 부재는 RED 근거로 세지 않았습니다.
- 독립 서비스 최소 구현 뒤 `npm test -- tests/integration/sr-services.test.ts`는 exit 0이었고 첫 4개가 통과했습니다. 권한·전환·rollback 사례를 확장한 실행은 7개가 통과했습니다.
- Mock 조회 전 권한과 replay 전 owner 현재성 회귀를 추가한 `npm test -- tests/integration/sr-services.test.ts`는 exit 1이었습니다. 8개 중 1개가 실패했고 비멤버 요청에서도 provider lookup count가 1이어서 기대값 0과 달랐습니다. 권한 사전 검사와 transaction 재검사를 구현했습니다.
- 첫 수정 후 같은 명령은 테스트가 membership의 `demo=1` CHECK를 0으로 바꾸려 해 exit 1이었습니다. 이는 회귀 fixture 설정 오류였습니다. 격리 DB에서 FK를 끄고 owner membership 행을 제거하는 현재성 사례로 고친 뒤 8개가 exit 0으로 통과했습니다.
- JSON codec을 보완한 첫 `npm run typecheck`는 exit 1이었습니다. `ExternalEvidence.kind`가 string으로 넓어진 1건을 명시적 runtime narrowing으로 고쳤고 재실행은 exit 0이었습니다.
- `npm test -- tests/contract/public-methods.test.ts tests/unit/review-impact.test.ts tests/integration/sr-services.test.ts`는 exit 0이었고 3개 파일의 29개가 통과했습니다.
- 실제 source와 완료 구현 근거, 설명 변경 activity 실패 rollback, 같은 idempotency key의 다른 명령을 추가한 `npm test -- tests/integration/sr-services.test.ts`는 exit 0이었고 10개가 통과했습니다.
- main과 TestApp을 composition에 연결한 뒤 최초 RED 명령 `npm test -- tests/integration/sr-context.test.ts`를 다시 실행했습니다. exit 0이며 HTTP 호출 7개가 모두 통과했습니다.
- CG-08의 Playwright 수집은 TestApp 전이 경로의 JSON import에 attribute가 없어 시작 전에 실패했습니다. TestApp, seed, Mock provider와 domain helper의 JSON import에 `with { type: 'json' }`을 적용했습니다. 이후 `./node_modules/.bin/playwright test --list`는 exit 0이었고 UI 테스트 1개를 수집했습니다. 브라우저 실행은 이 명령에서 하지 않았습니다.
- query service가 던지는 업무 오류를 기존 HTTP 경계가 generic 500으로 바꾸지 않는지 M-045 비멤버와 M-047 없는 SR 사례로 확인했습니다. `npm test -- tests/integration/sr-context.test.ts`는 exit 0이며 7개가 통과했습니다.

## 최종 검증

- `npm test -- tests/integration/sr-context.test.ts tests/integration/sr-services.test.ts tests/unit/review-impact.test.ts tests/contract/public-methods.test.ts`는 exit 0이었고 4개 파일의 38개가 통과했습니다.
- 최신 `npm run typecheck`는 exit 0이었습니다.
- CG-05 fix2와 CG-06 연결을 포함한 최종 `npm test`는 exit 0이었습니다. 테스트 파일 13개와 테스트 142개가 모두 통과했습니다.
- 전체 suite와 병렬 실행한 최종 `npm run typecheck`도 exit 0이었습니다.

## 독립 검토 fix round 1

- `./node_modules/.bin/vitest run tests/integration/sr-services.test.ts`는 exit 1이었습니다. 전체 15개 중 기존 10개가 통과하고 신규 회귀 5개가 실패했습니다. M-005 guard 변경이 `Replayed`가 됐고, 확정된 M-004가 provider 부재에서 `NOT_FOUND`를 반환했으며 provider 예외를 그대로 던졌습니다. 설명 양끝 공백·줄바꿈이 제거됐고 M-047은 실제 pending 행이 있어도 빈 배열을 반환했습니다.
- 명령 fingerprint를 versioned canonical envelope로 바꿨습니다. M-005와 M-028은 같은 key·입력이라도 guard가 바뀌면 `IDEMPOTENCY_CONFLICT`와 `priorReceipt`를 반환합니다. M-003과 M-004의 NoGuard도 같은 envelope 정책을 사용합니다.
- M-004는 현재 actor 권한을 확인한 뒤 receipt를 먼저 읽습니다. receipt가 없을 때만 write lock 밖에서 provider를 조회하고 확정 transaction에서 권한과 receipt를 다시 검사합니다. provider 예외는 `PROVIDER_UNAVAILABLE`로 정제합니다.
- 등록·개정 description은 공백 입력 검사에만 `trim`을 사용합니다. 저장 본문과 fingerprint는 전달된 Unicode, 줄바꿈과 양끝 공백을 그대로 보존합니다.
- DB-only 최신성 판정 공백을 확인해 `InputFreshness`에 이유가 필수인 `unknown`을 추가했습니다. `CurrentInputFingerprintPort` 전달 전후를 분리한 M-047 회귀는 첫 실행에서 exit 1이었고, pending·succeeded run이 모두 `unknown`이어서 주입한 `current`·`stale` 기대와 달랐습니다. query service까지 typed port를 전달한 뒤 통과했습니다. 이 port 주입 검사는 calculator 통합 증거가 아니며 CG-09가 실제 calculator를 연결해야 합니다.
- 수정 후 `./node_modules/.bin/vitest run tests/integration/sr-services.test.ts`는 exit 0이며 15개가 통과했습니다.
- snapshot source ref 검증을 보강한 뒤 `./node_modules/.bin/tsc -p tsconfig.server.json --noEmit`는 exit 1이었습니다. `VersionRef`의 project 범위 variant에서 `srId`를 바로 읽은 타입 오류 1건이었습니다. `review_policy`를 먼저 판별한 뒤 SR 범위만 `srId`를 읽도록 고쳤습니다.
- 선행 영향 검사 `./node_modules/.bin/vitest run tests/integration/sr-context.test.ts tests/integration/sr-services.test.ts tests/integration/demo-seed.test.ts tests/integration/storage-atomicity.test.ts tests/contract/public-methods.test.ts tests/unit/review-impact.test.ts`는 exit 0이며 6개 파일의 89개가 통과했습니다.
- `npm run typecheck`는 exit 0이며 server와 web TypeScript 검사가 모두 통과했습니다.
- 전체 suite는 CG-07의 의도한 M-006 HTTP RED와 병행 중인 후속 과제를 섞지 않기 위해 이번 fix에서 실행하지 않았습니다. 브라우저와 실제 provider도 실행하지 않았습니다.

## 미실행과 후속 범위

CG-06은 전체 보드·검토함 US-027, G1/G2 통과 단계 전환, 실제 generation 작업을 구현하지 않습니다. 브라우저, 실제 Claude, 성능과 강한 process recovery 검증은 실행하지 않았습니다. `serveWeb`의 build 결과와 브라우저 수용은 CG-08이 실제 UI 자산을 만든 뒤 검증합니다.

## 확장 규칙 준수

Security Baseline, Resiliency Baseline과 Property-Based Testing 확장은 `aidlc-docs/aidlc-state.md`에서 비활성화돼 N/A입니다. 기본 현재 권한, 저장 원자성, TDD와 content validation 규칙은 적용했습니다.

## 독립 재검토 fix round 2

- `./node_modules/.bin/vitest run tests/integration/sr-context.test.ts -t "M-047.*STORE_UNAVAILABLE"`는 exit 1이었습니다. 선택한 2개 회귀가 모두 실패했고 나머지 7개는 건너뛰었습니다. 잘못된 `provider_selection_json` shape와 calculator의 빈 fingerprint가 각각 HTTP 500을 반환해 기대한 503과 달랐습니다.
- `src/persistence/generation-run-query.ts`의 저장 row·JSON·현재 fingerprint codec 오류를 `GenerationRunReadError`로 구분했습니다. `src/application/workspace-query-service.ts`는 이 오류만 `STORE_UNAVAILABLE`로 바꿉니다. 일반 프로그래머 `Error`는 다시 던져 기존 HTTP 500 경계를 유지합니다.
- 같은 RED 명령의 수정 후 실행은 exit 0이며 선택한 2개가 통과했습니다. 빈 fingerprint는 HTTP 503과 `STORE_UNAVAILABLE`을 반환하고, 같은 port가 던진 일반 `Error`는 HTTP 500과 `INTERNAL_ERROR`를 유지합니다.
- `./node_modules/.bin/vitest run tests/integration/sr-context.test.ts tests/integration/sr-services.test.ts`는 exit 0이며 2개 파일의 24개가 통과했습니다. 기존 현재 권한의 `FORBIDDEN`과 없는 SR의 `NOT_FOUND` 경계도 포함합니다.
- 관련 검사 `./node_modules/.bin/vitest run tests/integration/sr-context.test.ts tests/integration/sr-services.test.ts tests/integration/demo-seed.test.ts tests/integration/storage-atomicity.test.ts tests/contract/public-methods.test.ts tests/unit/review-impact.test.ts`는 exit 0이며 6개 파일의 91개가 통과했습니다.
- `npm run typecheck`는 exit 0이며 server와 web TypeScript 검사가 모두 통과했습니다. 전체 suite는 CG-07의 의도한 M-006 HTTP RED와 분리하기 위해 실행하지 않았습니다.
