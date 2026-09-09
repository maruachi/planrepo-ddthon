# CG-11 단일 claim·terminal·종료 관찰 구현 보고

## 구현 결과

- M-036은 등록된 runtime capability를 검증한 뒤 `BEGIN IMMEDIATE` transaction에서 singleton slot과 모든 running Run의 일관성을 먼저 확인합니다. 비어 있을 때만 `requested_at, run_id` 순서의 pending Run 하나를 골라 claim, Run running 전환, slot, launch intent를 한 commit에 저장합니다.
- runtime ownership capability와 claim ownership token은 서버가 임의 발급합니다. DB에는 claim token의 SHA-256 hash만 저장합니다. 검사는 `timingSafeEqual`을 사용하며 다른 runtime, 다른 Run, 변조 token을 거절합니다. 공개 HTTP와 공개 DTO에는 내부 메서드와 token을 연결하지 않았습니다.
- M-037은 고정 InputSnapshot과 결과 종류·참조를 검사합니다. 정제한 결과가 UTF-8 2 MiB 이하인지 확인하고, 실제 test evidence port가 소유한 완료 시각과 deadline을 검증합니다. 결과 검증 뒤와 성공 초안·terminal Run·정제 ExecutionReport·activity·최종 조회 뒤 transaction 반환 직전에 monotonic clock을 읽습니다. 마지막 검사가 실패하면 같은 transaction 전체를 rollback합니다.
- M-038은 같은 claim과 실제 실패 evidence를 검증합니다. 성공, 실패, 취소, timeout 가운데 첫 terminal만 저장하고 늦은 완료나 실패는 기존 Run을 반환합니다.
- M-049는 terminal 뒤에도 원 claim capability로 제어 상태를 읽습니다. M-050은 검증된 종료 observation을 claim당 한 번 저장하며 같은 claim이 차지한 slot만 비웁니다. 이전 Run의 늦은 observation은 다음 Run의 slot을 바꾸지 않습니다.
- `readGenerationState`의 기존 `slot: string[]`는 유지하고 검증용 `activeSlot`을 추가했습니다. 제품 상태나 공개 View는 바꾸지 않았습니다.
- 부모가 직접 spawn한 Node worker는 같은 격리 DB를 별도 connection과 별도 runtime으로 엽니다. READY와 RELEASE barrier 뒤 두 claim을 경쟁시켜 한 프로세스만 인수함을 확인합니다. 같은 idempotency key의 M-032도 별도 connection 두 개에서 경쟁시켜 `Committed`와 `Replayed`가 같은 Run을 가리킴을 확인합니다. READY의 DB owner PID와 DB runtime identity의 PID는 부모가 소유한 exact ChildProcess PID와 같습니다. worker의 token과 raw 환경은 결과 파일이나 출력에 기록하지 않습니다.

## TDD와 검증

- `npm test -- tests/integration/generation-claim.test.ts -t "preserves cancellation until matching termination"`의 첫 행동 RED는 exit 1입니다. empty TestApp에서 M-003, M-047, M-032는 통과했고 수집 가능한 noop claim이 `null`을 반환해 `expect(claim).not.toBeNull()` 단언이 실패했습니다. module 부재나 fixture 실패를 RED로 집계하지 않았습니다.
- worker 구현의 첫 `npm test -- tests/integration/generation-claim.test.ts`는 exit 1입니다. 당시 Vitest fork worker 두 개가 runtime 등록을 동시에 시도해 두 번째 worker의 READY 제한시간이 끝났습니다. 두 worker를 차례로 READY 상태까지 올린 뒤 같은 RELEASE barrier에서 작업만 동시에 시작하도록 고쳤습니다. fix round 2에서 중간 Vitest manager/fork 구조 자체를 직접 소유 Node child로 교체했습니다.
- 이어 실행한 같은 테스트는 exit 1입니다. `request-b`의 RESULT 파일을 `fs.watch`가 간헐적으로 놓쳐 제한시간이 끝났습니다. 부모와 worker 모두 제한시간이 있는 `fs.watch`에 25 ms 존재 확인을 보조로 추가했습니다. BUSY나 worker 오류를 빈 claim 또는 정상 replay로 취급하지 않습니다.
- 구현 중 `./node_modules/.bin/tsc -p tsconfig.server.json --noEmit`는 `generation-repository.ts`의 함수 타입 구문과 `generation-internal.ts`의 `DomainError` import 누락으로 각각 exit 2였습니다. 두 CG-11 오류를 고친 뒤 같은 명령은 exit 0이었습니다. 이후 전역 typecheck의 한 실행은 병행 중이던 CG-17 정책 파일 오류로 exit 2였고, 그 소유자가 동결한 뒤 아래 최종 검사는 exit 0이었습니다.
- `npm test -- tests/integration/generation-claim.test.ts -t "별도 Node worker"`는 barrier와 파일 확인 보완 뒤 exit 0입니다. 1개가 통과하고 6개를 선택 제외했습니다.
- `npm test -- tests/integration/generation-claim.test.ts tests/integration/generation-request.test.ts`는 최종 리팩터링 뒤 exit 0입니다. 2개 파일의 17개 테스트가 통과했습니다.
- `npm test -- tests/contract/generation-public.test.ts tests/contract/public-methods.test.ts tests/contract/http-boundary.test.ts tests/integration/generation-claim.test.ts tests/integration/generation-request.test.ts tests/integration/generation-preparation.test.ts tests/integration/artifact-edit.test.ts tests/integration/context-source.test.ts tests/integration/sr-services.test.ts tests/integration/readiness.test.ts tests/integration/storage-atomicity.test.ts tests/unit/generation-snapshot.test.ts tests/unit/runtime-identity.test.ts tests/unit/runtime-paths.test.ts`의 첫 관련 전체 검사는 exit 0이며 당시 10개 파일의 141개 테스트가 통과했습니다. worker barrier 계약 정리 뒤 같은 명령을 다시 실행한 최종 검사는 exit 0이며 14개 파일의 182개 테스트가 통과했습니다. 병행 과제에서 같은 명시 경로의 테스트가 늘어난 결과도 함께 포함합니다.
- `npm run typecheck`는 최종 두 번 모두 exit 0입니다. server와 web TypeScript 검사가 통과했습니다. 마지막 실행은 worker barrier 계약과 내부 ref narrowing 정리 뒤 실행했습니다.

## 검증한 경계

- cancel 뒤 늦은 성공은 cancelled를 뒤집지 않습니다. slot은 실제 M-050 observation 전까지 유지합니다. observation 뒤 다음 pending Run을 인수하며 이전 observation 재생은 새 slot을 보존합니다.
- 관찰이 먼저 확정된 running Run을 취소하면 M-034 첫 결과와 같은 key replay 모두 `termination:'confirmed'`를 유지합니다.
- 성공 뒤 현재 SR 입력이 바뀌면 생성 초안과 고정 snapshot은 보존되고 M-033 freshness는 stale입니다. 실제 보고서의 `actualModelId`와 `cliVersion`만 M-033과 M-047에 표시합니다.
- 잘못된 token, 다른 runtime owner, 다른 Run, 등록되지 않은 runtime을 거절합니다. slot과 running Run이 모순이면 새 claim을 거절하고 기존 자료를 보존합니다.
- deadline 초과, 결과 종류 불일치, 2 MiB 초과, 늦은 activity insert 실패가 Run terminal과 초안을 부분 저장하지 않습니다. trigger 제거 뒤 같은 claim으로 정상 완료할 수 있습니다.
- worker crash 뒤 claim, running Run, slot을 그대로 보존합니다. 테스트 정리는 assertion 뒤 격리 DB에서만 수행합니다.

## 변경 경로와 남은 연결

- 새 제품 파일은 `src/application/generation-internal.ts`, `src/generation-runtime/claim-context.ts`, `src/generation-runtime/execution-evidence.ts`입니다.
- 저장 변경은 `src/persistence/generation-repository.ts`입니다.
- 새 테스트 파일은 `tests/helpers/internal-generation-rig.ts`, `tests/helpers/runtime-workers.ts`, `tests/fixtures/runtime-worker.ts`, `tests/integration/generation-claim.test.ts`입니다. `tests/helpers/generation-fixture.ts`에는 typed `activeSlot` 조회만 추가했습니다. fix round 2에서 중간 Vitest manager를 만들던 `tests/fixtures/runtime-worker.test.ts`와 `vitest.runtime-worker.config.ts`는 제거했습니다.
- 문서는 `aidlc-docs/construction/planrepo/code/task-11-brief.md`, `aidlc-docs/construction/planrepo/code/task-11-report.md`입니다.
- 실제 Claude, 브라우저, 성능, 전체 crash 복구는 실행하지 않았습니다. production runner의 spawn 시각 기준 `deadlineMono`, 실제 no-spawn 근거, 자동 인수 loop, main/TestApp lifecycle 연결은 C-05와 CG-12 이후 통합 범위입니다. `M-039` recovery도 후속 과제입니다.

## 독립 검토 fix round 1

- `npm test -- tests/integration/generation-claim.test.ts -t '출력·deadline|별도 Node worker'`의 회귀 RED는 exit 1입니다. 2개가 실패하고 5개를 선택 제외했습니다. activity `BEFORE INSERT` trigger가 monotonic clock을 50에서 101로 전진시킨 뒤에도 deadline 100인 완료가 `Recorded`가 되어 첫 단언이 실패했습니다. worker READY는 `{ready:true}`만 담아 실제 DB owner identity 단언도 실패했습니다. 두 번째 테스트가 RELEASE 전에 끝나 RESULT 제한시간의 unhandled rejection 1건도 함께 발생했으며 GREEN 구현에서 조기 CLOSE를 barrier 입력으로 처리해 없앴습니다.
- M-037은 repository의 activity와 최종 Run 조회가 끝난 뒤 transaction callback 반환 직전에 monotonic deadline을 다시 검사합니다. 같은 trigger 회귀에서 예외가 발생하고 succeeded Run과 generation draft가 모두 rollback됩니다.
- fix round 1은 `/bin/ps`의 PID 시작 identity와 Vitest manager를 함께 관찰했지만 부모의 direct ChildProcess handle로 DB owner 종료를 확인하지 못했습니다. 이 방식은 fix round 2에서 제거했습니다.
- `crashOwnedWorker`와 `close`는 종료 제한시간 오류를 삼키지 않습니다. 전체 worker 정리 중 하나라도 실패하면 integration `finally`도 DB slot/runtime이나 TestApp 폴더를 지우지 않습니다.
- 수정 뒤 `npm test -- tests/integration/generation-claim.test.ts -t '출력·deadline|별도 Node worker'`는 exit 0입니다. 2개가 통과하고 5개를 선택 제외했습니다.
- `npm test -- tests/integration/generation-claim.test.ts tests/integration/generation-request.test.ts`는 exit 0이며 2개 파일의 17개 테스트가 통과했습니다. 실제 두 worker claim과 같은 key 접수 경합을 다시 실행했습니다.
- fix round 1 뒤 `npm run typecheck`는 exit 0입니다. server와 web TypeScript 검사가 통과했습니다. 관련 전체 14개 파일 182개 검사는 fix 직전 이미 통과했고, 이번 수정의 직접 경계는 위 17개로 다시 검증했습니다.

## 독립 검토 fix round 2

- `npm test -- tests/integration/generation-claim.test.ts -t '별도 Node worker'`의 첫 RED는 exit 1입니다. READY의 실제 DB owner PID 4006과 부모가 소유한 Vitest manager PID 3997이 달라 direct owner 단언 1개가 실패하고 6개를 선택 제외했습니다.
- 미확인 cleanup 회귀의 다음 같은 명령도 exit 1입니다. loser worker에 100ms close 지연과 25ms 확인 제한을 줬지만 기존 `close()`가 `undefined`로 정상 반환해 거절 단언 1개가 실패했습니다.
- 부모는 `process.execPath --import tsx tests/fixtures/runtime-worker.ts`로 DB owner를 직접 spawn합니다. 중간 Vitest manager와 fork는 없습니다. READY의 owner PID, DB `runtime_identities.parent_pid`, 부모 ChildProcess PID를 exact 대조합니다. 종료는 그 handle의 `exit`와 `close`를 모두 관찰한 뒤에만 `OWNER_EXIT.json`으로 기록합니다. PID 부재나 재사용 추정, `ps`, 전체 PID 목록을 종료 증거로 쓰지 않습니다.
- loser의 첫 close 확인은 실제 25ms 제한을 넘겨 오류를 전파합니다. 그 시점의 winner slot, loser runtime row, control 폴더를 보존합니다. 실제 child가 100ms 뒤 닫힌 후 같은 `close()`가 exact handle의 exit와 close를 확인하며, 그 뒤에만 격리 fixture를 정리합니다. crash는 부모가 직접 소유한 child가 자기 PID에 SIGKILL을 보내고 같은 exact handle로 확인합니다.
- 수정 뒤 `npm test -- tests/integration/generation-claim.test.ts -t '별도 Node worker'`는 exit 0입니다. 실제 claim과 같은 key 접수 경합 1개가 통과하고 6개를 선택 제외했습니다.
- `npm test -- tests/integration/generation-claim.test.ts tests/integration/generation-request.test.ts`는 exit 0이며 2개 파일의 17개 테스트가 통과했습니다.
- 이어 실행한 `npm run typecheck`는 exit 1입니다. CG-11의 await 뒤 `closeDelayMs` narrowing 오류 1개와 병행 UI의 `tests/unit/web/draft-comparison.test.ts` JSX·축약 View 오류 6개가 함께 나타났습니다. CG-11 오류를 고친 뒤 `./node_modules/.bin/tsc -p tsconfig.server.json --noEmit`는 남은 UI 6개 때문에 exit 1이었습니다. 처음 만든 `/tmp/planrepo-cg11-fix2-tsconfig.json`은 `/tmp` 기준 Node type root를 찾지 못해 exit 1이었고, workspace의 `node_modules/@types`를 명시한 뒤 같은 scoped tsc는 exit 0이었습니다. UI 소유 파일은 수정하지 않았습니다.
