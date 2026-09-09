# CG-10 생성 접수·조회·취소·재시도 구현 보고

## 구현 결과

- M-032는 현재 SR owner와 receipt를 먼저 확인합니다. 그 뒤 현재 입력 fingerprint와 DB 전체 pending·running 10개 한도를 검사합니다. 같은 IMMEDIATE transaction에서 불변 InputSnapshot, pending GenerationRun, activity, receipt를 저장합니다.
- 서버가 시작할 때 읽은 `RuntimeConfig.generation`의 `claude-cli`와 explicit `global.anthropic.claude-opus-4-8` 선택을 각 Run에 고정합니다. provider/model은 업무 입력 fingerprint에서 제외합니다. 사용자가 요청 본문에 provider 선택을 넣으면 schema가 거절합니다.
- InputSnapshot 자체와 실제 `ProviderRequest` JSON 직렬화 결과를 각각 UTF-8 2 MiB 한도로 검사합니다. 유효한 대용량 SOURCE 두 개로 InputSnapshot은 허용되지만 ProviderRequest 포장만 한도를 넘는 사례에서 snapshot, Run, receipt가 모두 rollback됨을 확인했습니다.
- M-033은 현재 프로젝트 멤버가 같은 SrScope의 Run을 읽습니다. M-032, M-034, M-035 변경은 현재 SR owner만 허용합니다. 조회는 receipt나 업무 상태를 쓰지 않으며 저장 selection, 현재 freshness, application, 종료 관찰을 typed reader에서 복원합니다. `payload_json.execution`에 실제 ExecutionReport가 있으면 검증된 `actualModelId`와 `cliVersion`만 추가하고 요청 selection과 섞지 않습니다.
- M-034는 pending 또는 running 상태를 조건부 UPDATE로 처음 terminal인 cancelled로 확정합니다. claim, execution slot, 프로세스와 종료 관찰은 바꾸지 않습니다. 취소 알림은 commit 뒤 한 번만 전달하며 동기 예외와 비동기 거절이 확정 결과를 뒤집지 않습니다.
- M-035는 failed 또는 cancelled 실행만 현재 입력과 현재 서버 selection으로 새 pending Run에 연결합니다. 과거 실행과 snapshot을 보존합니다. succeeded 실행은 재시도하지 않고 새 M-032를 사용하도록 거절합니다.
- 같은 actor·scope·idempotency key의 같은 명령과 입력은 포화 상태에서도 먼저 재생합니다. 다른 명령, 입력 또는 guard는 `IDEMPOTENCY_CONFLICT`입니다. 재생 value는 과거 receipt 결과를 유지하고 `current`는 현재 Run revision과 현재 입력 fingerprint를 별도로 반환합니다.
- `QUEUE_FULL`을 DomainErrorCode와 HTTP 409에 연결했습니다. 저장 receipt replay와 provider selection이 계약 형태를 잃으면 `STORE_UNAVAILABLE` 503으로 정제합니다.

## TDD와 검증

- `npm test -- tests/integration/generation-request.test.ts -t "replays a queued request at capacity"`의 첫 실행은 exit 1입니다. empty TestApp의 실제 M-003과 M-047 준비는 통과했고, 첫 M-032가 handler 부재로 `ok:false`를 반환해 pending 단언 1개가 실패했습니다. 파일 수집이나 fixture 실패는 아닙니다.
- `npm test -- tests/contract/generation-public.test.ts -t "권한·scope·포화"`의 첫 실행은 exit 1입니다. 비owner 현재 멤버의 M-033 조회가 owner-only 검사로 거절되어 1개가 실패했습니다. 조회 권한만 프로젝트 멤버로 고친 뒤 exit 0이며 1개가 통과하고 1개를 선택 제외했습니다.
- 저장 receipt 손상 회귀의 첫 준비 실행은 append-only trigger 때문에 동작 단언 전에 실패해 RED로 집계하지 않았습니다. 격리 TestApp에서 update 방지 trigger만 제거해 손상 자료를 만든 뒤 `npm test -- tests/contract/generation-public.test.ts -t "저장된 receipt replay"`는 exit 1이며 기대 503 대신 404를 반환했습니다. typed replay 검증 뒤 같은 명령은 exit 0이며 1개가 통과하고 2개를 선택 제외했습니다.
- 실제 2 MiB 경계 자료 크기를 찾는 첫 임시 probe는 CommonJS 변환의 top-level await 오류로 exit 1이어서 동작 증거로 집계하지 않았습니다. async 함수로 고친 read-only 크기 탐색 뒤 SOURCE 본문을 각각 1,046,150 ASCII bytes로 고정했습니다. `npm test -- tests/integration/generation-request.test.ts -t "실제 2 MiB ProviderRequest"`는 exit 0이며 1개가 통과하고 8개를 선택 제외했습니다.
- `npm test -- tests/integration/generation-request.test.ts tests/contract/generation-public.test.ts`는 기능 보강 전 마지막 targeted 실행에서 exit 0이며 12개가 통과했습니다. 뒤에 추가한 저장 codec 회귀까지 포함한 관련 전체 검증에서 두 파일의 13개가 모두 다시 통과했습니다.
- 비동기 취소 알림 거절을 명시한 뒤 `npm test -- tests/contract/generation-public.test.ts`는 exit 0이며 3개가 통과했습니다.
- `npm test -- tests/contract/generation-public.test.ts tests/contract/public-methods.test.ts tests/contract/http-boundary.test.ts tests/integration/generation-request.test.ts tests/integration/generation-preparation.test.ts tests/integration/artifact-edit.test.ts tests/integration/context-source.test.ts tests/integration/sr-services.test.ts tests/integration/readiness.test.ts tests/unit/generation-snapshot.test.ts tests/unit/runtime-paths.test.ts`는 exit 0입니다. 11개 파일의 138개 테스트가 통과했습니다.
- `npm run typecheck`는 exit 0입니다. server와 web TypeScript 검사가 모두 통과했습니다.

## 독립 검토 fix round 1

- `npm test -- tests/integration/generation-request.test.ts -t 'running 취소'`의 회귀 RED는 exit 1입니다. occupied slot과 claim에 `termination_confirmed` 관찰이 먼저 있는 running Run은 첫 M-034에서 `cancelled`, `termination:'confirmed'`, revision 3으로 확정됐습니다. 같은 key 재생만 기대 `Replayed` 대신 `Rejected`가 되어 실패했습니다.
- `npm test -- tests/contract/generation-public.test.ts -t '저장된 receipt'`의 회귀 RED는 exit 1입니다. 정상 pending replay와 optional `actualModelId`·`cliVersion`에 가상 `ownershipToken`·`rawEnvironment` canary를 더하자 HTTP value가 top-level canary를 그대로 노출해 실패했습니다. scope, requestedSelection, modelChoice, freshness, application을 포함한 replay DTO를 허용 필드로 새로 구성하도록 고쳤습니다.
- `npm test -- tests/contract/generation-public.test.ts -t '정제 execution report'`의 회귀 RED는 exit 1입니다. `generation_runs.payload_json.execution`에 유효한 ExecutionReport를 저장해도 실제 M-033에서 `actualModelId`와 `cliVersion`이 빠져 실패했습니다. M-047은 앞 단언 실패 때문에 이 RED 실행에서 도달하지 않았습니다.
- 구현 중 `./node_modules/.bin/tsc -p tsconfig.server.json --noEmit`는 `decodedFreshness`가 일반 string으로 넓어져 exit 1이었습니다. `InputFreshness`로 명시한 뒤 같은 검사는 exit 0이었습니다.
- M-034 replay decoder는 confirmed와 unobserved를 모두 허용합니다. M-032와 M-035의 고정 pending replay는 unobserved만 허용합니다. replay value와 receipt는 과거 값을 유지하고 `current`는 실제 revision과 현재 입력 fingerprint를 별도로 읽습니다. 현재 owner를 바꾼 같은 M-034 replay도 `NOT_ASSIGNED`로 거절됨을 확인했습니다.
- running 취소 회귀는 실제 occupied slot, claim, 기존 observation이 commit과 replay 뒤에도 같음을 확인합니다. 테스트 종료 때만 격리 TestApp lifecycle을 위해 slot을 비웁니다.
- execution report reader는 알려진 ExecutionReport 필수 필드와 선택 필드를 검사합니다. M-033과 M-047은 `actualModelId`와 `cliVersion`만 투영하고 raw 환경, token, 진단 원문을 반환하지 않습니다. report가 없는 pending Run은 두 필드가 없으며, 손상된 report는 `STORE_UNAVAILABLE`입니다.
- `npm test -- tests/integration/generation-request.test.ts tests/contract/generation-public.test.ts`는 exit 0이며 2개 파일의 14개 테스트가 통과했습니다.
- `npm test -- tests/contract/generation-public.test.ts tests/contract/public-methods.test.ts tests/contract/http-boundary.test.ts tests/integration/generation-request.test.ts tests/integration/generation-preparation.test.ts tests/integration/artifact-edit.test.ts tests/integration/context-source.test.ts tests/integration/sr-services.test.ts tests/integration/readiness.test.ts tests/unit/generation-snapshot.test.ts tests/unit/runtime-paths.test.ts`는 exit 0이며 11개 파일의 139개 테스트가 통과했습니다.
- fix round 1 뒤 `npm run typecheck`는 exit 0입니다. server와 web TypeScript 검사가 모두 통과했습니다.

## 변경 경로와 남은 경계

- 새 파일은 `src/application/generation-service.ts`, `src/persistence/generation-repository.ts`, `tests/helpers/generation-fixture.ts`, `tests/integration/generation-request.test.ts`, `tests/contract/generation-public.test.ts`, `aidlc-docs/construction/planrepo/code/task-10-report.md`입니다.
- 연결 변경은 `src/contracts/results.ts`, `src/application/http/routes.ts`, `src/runtime/application-composition.ts`, `src/main.ts`, `src/persistence/generation-run-query.ts`, `tests/helpers/test-app.ts`입니다. CG16에서 동결한 M-009, M-011, M-013, M-014 composition은 유지했습니다.
- `src/application/generation-snapshot.ts`와 `src/persistence/generation-input-repository.ts`는 병행 CG16 projection 소유라 수정하지 않았습니다. 현재 승인 calculator를 그대로 호출합니다.
- 실제 Claude, 브라우저, 성능, crash 복구는 실행하지 않았습니다. provider 실행, claim과 slot 소유권, 완료·실패 확정, 종료 관찰은 CG-11부터 CG-15까지의 후속 범위입니다. 공개 HTTP에는 M-032부터 M-035까지만 연결했고 M-036부터 M-039와 M-049, M-050은 등록하지 않았습니다.
