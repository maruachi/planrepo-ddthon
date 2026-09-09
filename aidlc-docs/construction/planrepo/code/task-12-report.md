# CG-12 독립 runner 부분 구현 보고

이 보고는 `ControlledProcessRunner`, process evidence, 결정적 fake rig와 자기 Node child OS 검증만 기록합니다. C-05 execution loop, generation controller, 저장·조립 연결은 시작하지 않았으며 CG-12 전체 완료를 표시하지 않습니다.

## 구현 경계

- `ControlledProcessRunner.start(spec, observer)`는 `OwnedExecution`을 반환합니다. 실행 결과 `result`, 명시 중단 `requestStop(reason)`, 현재 종료 관찰 `getObservationState()`를 분리했습니다.
- 실제 spawn은 `shell:false`, `detached:true`, `stdio:['pipe','pipe','pipe']`로 고정하며 `unref`하지 않습니다. 전달받은 executable·argv·cwd·env를 shell 해석 없이 사용합니다.
- 최종 stdin bytes는 2,097,152 bytes, stdout은 4,194,304 raw bytes, stderr는 262,144 raw bytes까지만 허용합니다. stdout과 stderr listener를 함께 붙이고 별도로 집계합니다. stderr 원문은 `ProcessResult`에 넣지 않습니다. 호출자가 표준 timeout·byte·grace 상한을 늘리면 spawn 전에 `POLICY_CONFLICT`와 `no_process_created`로 거절합니다.
- stdin `write()`가 false이면 `drain` 뒤 `end()`합니다. stdin 오류는 `INPUT_ERROR`, stdout·stderr 오류는 `IO_ERROR`, 초과는 `OUTPUT_LIMIT`으로 구분합니다.
- `Completed`는 exit 0, child close, stdout close, stderr close, IO 오류 없음, `closedAtMono <= deadlineMono`가 모두 성립할 때만 반환합니다. JSON envelope 해석은 상위 RUN_PROVIDER 책임이므로 exit 0의 invalid JSON도 이 계층에서는 `Completed`입니다.
- deadline은 spawn 시도 단조 시각부터 300,000ms입니다. 정확한 경계의 close는 허용하고 1ms 초과는 `TIMEOUT`으로 확정합니다. 결과 확정 뒤에도 같은 handle의 pipe와 close listener를 유지합니다.
- 취소·timeout·출력/IO 실패는 결과를 먼저 고정하고, 현재 runner가 만든 동일 live handle과 process group leader PID를 확인한 경우에만 즉시 SIGTERM을 보냅니다. 2,000ms 뒤에도 같은 handle이 live일 때만 SIGKILL을 보냅니다. spawn event 전 취소도 handle이 live가 되는 즉시 종료를 시작합니다. signal 반환값, ESRCH, `child.killed`는 종료 확정 근거로 사용하지 않습니다.

## 종료 증거와 한계

- ENOENT는 Node의 spawn error를 근거로 `Confirmed/no_process_created`로 구분합니다. spawn 호출 자체가 throw한 crash gap과 ENOENT가 아닌 spawn error는 `Unknown`입니다.
- direct child의 exit와 두 pipe close는 observer에 늦게 전달합니다. 현재 구현에는 escaped descendant 부재를 증명하는 승인된 capability가 없으므로 정상 Node fixture도 `execution_scope_not_proven`인 `Unknown`으로 유지합니다. PID나 process group signal 성공을 전체 실행 범위 종료 증거로 승격하지 않습니다.
- OS fixture는 `process.execPath`와 현재 runner의 세 pipe만 사용합니다. success, late-stderr-overflow, flood-both, wait-for-term, ignore-term, nonzero, invalid-json 모드를 제공하며 네트워크·업무 파일·자손 프로세스를 사용하지 않습니다. 이 fixture의 성공은 실제 Claude나 managed 정책, credential helper, escaped descendant 부재의 증거가 아닙니다.
- runner와 테스트는 실행 폴더를 만들거나 삭제하지 않습니다. 테스트 뒤 `pgrep -fl 'tests/fixtures/process-child.mjs'` 결과는 비어 있었습니다.

## TDD와 검증

- 첫 `npm test -- tests/unit/controlled-process.test.ts -t "does not finish on stdout"`는 `tests/helpers/process-rig.ts`가 없어 suite import 단계에서 실패했습니다. 테스트가 실행되지 않았으므로 행동 RED로 집계하지 않습니다.
- production runner와 fake port·clock을 추가한 첫 전체 단위 실행은 spawn microtask 전에 취소와 deadline을 진행한 테스트 준비 문제 2개가 실패했습니다. spawn event를 명시적으로 flush한 뒤 8개가 통과했습니다.
- spawn event 전 취소 RED는 handle이 live가 된 뒤 SIGTERM을 보내지 않아 1개가 실패했습니다. 종료 요청을 보존해 spawn 관찰 직후 시작하도록 고쳤습니다. fake clock에서 deadline과 grace를 한 번에 넘긴 RED는 SIGKILL이 빠져 실패했고, 예약 시각 순서대로 callback을 실행하도록 고쳤습니다.
- 표준 상한을 1 byte 늘린 RED는 결과가 정해지지 않아 5초 timeout으로 실패했습니다. spawn 전 정책 검사를 추가한 뒤 `POLICY_CONFLICT`로 통과했습니다.
- OS 테스트를 먼저 추가했을 때 fixture가 없어 Node가 nonzero로 끝났고 큰 stdin 성공 테스트가 `PROCESS_FAILED`로 RED였습니다. 제한 fixture를 추가한 뒤 한글 대용량 stdin, stdout 종료 뒤 늦은 stderr 초과, 양쪽 동시 상한 flood, nonzero, invalid JSON, SIGTERM 반응, SIGTERM 무시 후 SIGKILL, ENOENT를 검증했습니다.
- 최종 `npm test -- tests/unit/controlled-process.test.ts tests/integration/controlled-process-os.test.ts`는 2개 파일 17개 테스트가 모두 통과했습니다. 실제 ignore-term 검사는 SIGTERM 뒤 최소 1,900ms가 지나 close된 것을 확인해 즉시 종료를 강제 종료 증거로 잘못 세지 않았습니다.
- `npm run typecheck`은 CG-12 파일을 모두 검사한 뒤 병행 작성 중인 `tests/integration/artifact-edit.test.ts`의 `srId: string | undefined` 4건 때문에 exit 2였습니다. CG-12 소유 파일 오류는 없었습니다. `git diff --check`는 통과했습니다.

후속 C-05는 이 runner의 `deadlineMono`를 사용해 parsing·참조 검증 뒤 M-037 직전 현재 시각을 다시 확인해야 합니다. 종료 관찰이 `Unknown`인 실행의 slot과 폴더를 보존하고, CG-14의 승인된 강한 관찰 capability가 생기기 전에는 이를 종료 확정으로 바꾸면 안 됩니다.

## 독립 검토 전 동결 메모

완료 close 뒤 timer와 runner listener 정리 테스트를 추가했습니다. 최초 실행은 rig에 관찰 API가 없어 RED였고 정리 구현 뒤 targeted 1/1이 통과했습니다. 이 마지막 정리 변경 뒤 전체 18개를 다시 실행하기 전에 독립 검토 동결 요청을 받았으므로, 위 17개 전체 통과 근거와 targeted 1개 통과 근거를 구분합니다.

동결 당시 열린 Important가 있었습니다. `NodeSpawnedProcess.isSameOwnedLiveScope()`가 child `exit` 뒤에도 `close` 전까지 true를 반환하고 runner도 `exitSeen`을 signal 조건에서 검사하지 않았습니다. direct child exit 뒤 상속된 pipe close가 지연되면 예약된 grace timer가 더 이상 현재 child handle로 보장할 수 없는 `-pid`에 SIGKILL을 보낼 수 있었습니다. 실제 PID 재사용이나 외부 프로세스 signal은 실험하지 않았습니다. 아래 fix round에서 fake `exit → pipe 미종료 → grace` 순서로 해결했습니다.

## 독립 검토 fix round 1

- `requestStop → exit(0) → pipe 미종료 → grace 2000ms` fake 순서는 기존 구현에서 `[SIGTERM, SIGKILL]`을 기록해 RED였습니다. Node wrapper는 `exit` 즉시 소유 live 상태를 내립니다. runner도 `exitSeen`이면 TERM과 KILL을 모두 금지하고 예약된 KILL timer를 해제합니다. direct exit 시 두 pipe의 현재 close 상태를 담은 `execution_scope_not_proven`을 observer에 전달하며 `Confirmed`로 올리지 않습니다. 같은 targeted 테스트는 수정 뒤 `[SIGTERM]`만 기록해 GREEN이었습니다.
- 유효한 mutable limits로 start한 뒤 `stdoutMaxBytes`를 4,194,305로 늘리고 stdin Buffer·argv·env를 바꾼 fake 테스트를 추가했습니다. 기존 구현은 변경된 stdin bytes를 쓰고 늘어난 stdout 상한을 사용해 RED였습니다. start 진입에서 limits·stdin bytes·argv·env와 나머지 실행 spec을 소유 snapshot으로 복사하고 모든 async callback이 이 snapshot만 사용하도록 고쳤습니다. 수정 뒤 원 stdin·argv·env와 4,194,304 stdout 상한을 유지해 `OUTPUT_LIMIT`으로 GREEN이었습니다.
- 모든 실제 OS 테스트가 만든 `OwnedExecution`을 test-local set에 등록했습니다. `afterEach`는 성공·실패 여부와 관계없이 그 handle에만 `requestStop`을 호출하고, `Confirmed/no_process_created` 또는 direct process와 두 pipe의 늦은 close가 담긴 `Unknown`을 최대 6초 동안 기다립니다. 폴더를 삭제하거나 외부 PID에 직접 signal하지 않습니다.
- listener 정리 뒤 처음 실행한 전체 runner 검증은 fake event가 `spawn` microtask보다 먼저 들어오는 기존 rig 순서를 pre-spawn 실패로 잘못 분류해 단위 2개가 timeout됐습니다. 실제 spawn error를 별도 상태로 기록하도록 좁혀 고친 뒤 `npm test -- tests/unit/controlled-process.test.ts`는 13/13, `npm test -- tests/integration/controlled-process-os.test.ts`는 7/7이 통과했습니다. `npm run typecheck`도 exit 0이었습니다. `git diff --check`는 통과했고 process-child fixture 잔존은 없었습니다.

이 fix 뒤 알려진 Critical/Important는 없습니다. 실제 PID 재사용이나 외부 프로세스 signal 실험은 수행하지 않았고, 전체 실행 범위 부재는 계속 `Unknown`입니다. C-05·CG-11·CG-14 연결과 CG-12 전체 완료 표시는 여전히 후속 범위입니다.

## C-05 저장·제어 통합

후속 작업에서 `generation-runtime/execution-loop.ts`와 테스트 전용 `generation-controller.ts`를 연결했습니다. TestApp은 기본 정지 상태이며 명시한 test adapter를 등록해야만 claim을 시작합니다. 시작 뒤 readiness의 generation 상태를 true로 바꾸고, `TestApp.close()`는 새 요청을 막은 다음 adapter를 한 번 중단하고 loop와 늦은 observation 쓰기를 drain한 뒤 runtime 등록과 DB를 닫습니다. 같은 TestApp의 controller 중복 등록은 거절합니다.

loop는 M-036이 확정한 claim의 저장 `launchIntentId`, `executionPolicyRef`, provider selection을 capability로 다시 읽습니다. 정확히 등록된 providerId만 선택하고 fallback하지 않습니다. 최종 직렬화한 `ProviderRequest`의 UTF-8 2,097,152 bytes 상한을 provider 호출 전에 다시 검사합니다. launch별 폴더는 서버가 만든 launch ID 아래 `mkdir(...,{recursive:false,mode:0700})`로만 만듭니다.

M-034 commit 알림은 현재 실행의 M-049를 즉시 깨우며 250ms polling을 유지합니다. 같은 `AbortController`는 한 번만 중단합니다. provider terminal과 M-050은 같은 claim에서 순서대로 저장합니다. 늦은 Confirmed observation은 SQLite busy를 재시도하며 실제 M-050 commit 뒤에만 private launch binding을 지웁니다. 다른 저장 오류는 삼키지 않고 `stop()` drain 오류로 반환합니다. `Unknown`이면 slot과 소유 폴더를 보존합니다.

provider rejection이나 claim 저장 오류로 background worker가 reject해도 unhandled rejection으로 보내지 않습니다. 비AI HTTP 서버는 유지하고 generation loop의 오류는 `stop()`에서 명시적으로 반환합니다. CG-14의 M-039는 `recoveryBeforeClaims` hook만 준비했으며 복구 판단은 구현하지 않았습니다.

첫 행동 RED는 `npm test -- tests/integration/generation-loop.test.ts -t "명시 test adapter"`였고 exit 1이었습니다. M-003, M-047, M-032가 성공했지만 M-033은 기대 `succeeded` 대신 `pending`이었습니다. 첫 구현 뒤 같은 assertion은 GREEN이었습니다. test adapter evidence를 registry 설정으로 신뢰하던 중간 리팩터링에서는 providerId 전달 누락으로 6개가 `TypeError` RED가 됐습니다. 테스트 전용 wrapper가 private evidence sink를 직접 쓰도록 정리하고 providerId를 실제 TestApp config에서 전달해 해결했습니다.

최종 C-05와 비OS 관련 검증 `npm test -- tests/integration/generation-loop.test.ts tests/integration/provider-swap.test.ts tests/integration/provider-evidence.test.ts tests/contract/claude-provider.test.ts tests/integration/generation-claim.test.ts tests/integration/generation-request.test.ts tests/contract/generation-public.test.ts tests/unit/controlled-process.test.ts tests/integration/readiness.test.ts`는 9개 파일 73개 테스트, exit 0입니다. `npm run typecheck`, `npm run build`, `git diff --check`도 exit 0입니다. 빌드는 201개 module을 변환했고 기존 Vite native config loader 경고를 출력했습니다.

추가 `npm test` 전체 실행은 38개 파일 중 37개, 369개 중 368개가 통과했지만 실제 OS child의 큰 stdin 테스트가 기본 5초를 넘어 exit 1이었습니다. 같은 테스트만 즉시 실행한 `npm test -- tests/integration/controlled-process-os.test.ts -t "큰 stdin과 한글 UTF-8"`는 1개 통과, exit 0이었습니다. 마지막 10개 파일 결합 실행도 이 OS 테스트 하나만 5초를 넘어 79/80, exit 1이었고 나머지는 통과했습니다. timeout을 늘리거나 runner 코드를 바꾸지 않았습니다. 실제 Claude, 브라우저, CG-14 복구는 실행하지 않았습니다.

## C-05 독립 검토 fix round 1

`readRunControl`이 실패하면 실행 loop가 provider 결과를 기다리지 않고 현재 abort 참조를 지우던 회귀를 실제 테스트로 고정했습니다. 늦은 Confirmed 관찰의 첫 `SQLITE_BUSY` 뒤 shutdown을 시작하는 경우와 즉시 Confirmed 관찰의 첫 `SQLITE_BUSY`도 함께 고정했습니다. 첫 대상 실행 `./node_modules/.bin/vitest run tests/integration/generation-loop.test.ts -t 'control 조회 실패|늦은 Confirmed|즉시 Confirmed'`는 exit 1이며 3개가 모두 실패했습니다. slot이 남아 TestApp runtime 해제가 외래 키 위반으로 실패한 것이 기대한 RED였습니다.

loop는 control 조회의 첫 오류를 보존하면서 같은 실행의 `AbortController`를 한 번 중단하고 provider promise가 settle될 때까지 기다립니다. 정제된 outcome의 terminal 저장과 신뢰한 Confirmed 관찰 저장을 drain한 뒤 원 control 오류를 `stop()`에서 반환합니다. Confirmed를 얻기 전의 unknown 대기만 shutdown signal로 중단합니다. Confirmed를 얻은 뒤에는 shutdown과 분리해 M-050 commit을 최대 3회 시도합니다. transient `SQLITE_BUSY`는 재시도하고 영구 `SQLITE_BUSY`는 세 번째 실패를 `stop()`에 반환하며 slot, launch binding과 실행 폴더를 보존합니다. launch binding은 실제 M-050 commit 뒤에만 제거합니다.

같은 대상 명령의 수정 후 실행은 exit 0이며 3개가 통과했습니다. 독립 검토 probe `./node_modules/.bin/tsx --tsconfig tsconfig.json /tmp/cg12-failure-drain-probe.ts`도 exit 0입니다. `control_error`는 abort 1회, provider settle, observation 1개, 빈 slot과 원 `probe control read busy` 오류를 반환했습니다. `shutdown_confirmed_busy`와 `immediate_confirmed_busy`는 각각 두 번째 저장에서 observation 1개와 빈 slot을 확인했습니다.

기존 실제 OS timeout은 child 실행과 matcher 시간을 분리해 측정했습니다. 큰 stdin child는 약 39ms에 끝났고 1.2MB Buffer를 Vitest `toMatchObject`로 깊게 비교하는 데 약 3,432ms가 걸렸습니다. 제품 runner와 2MiB 입력 한도는 바꾸지 않았습니다. 결과 kind를 먼저 좁히고 `Buffer.equals`로 bytes를 비교한 뒤 작은 metadata만 `toMatchObject`로 검사했습니다. 같은 단건은 기본 timeout에서 exit 0, 1개 통과, 전체 실행 164ms였습니다.

최종 관련 검증 `./node_modules/.bin/vitest run tests/integration/generation-loop.test.ts tests/integration/provider-swap.test.ts tests/integration/provider-evidence.test.ts tests/contract/claude-provider.test.ts tests/integration/generation-claim.test.ts tests/integration/generation-request.test.ts tests/contract/generation-public.test.ts tests/unit/controlled-process.test.ts tests/integration/readiness.test.ts tests/integration/controlled-process-os.test.ts`는 exit 0이며 10개 파일의 82개 테스트가 통과했습니다. `git diff --check`도 exit 0입니다.

전역 `npm run typecheck`는 병행 CG-17/18 파일인 `tests/integration/g1-review.test.ts` 1건과 CG-16 fix 중인 `tests/unit/web/client.test.ts` 2건 때문에 exit 1이었습니다. C-05 변경 파일만 포함한 `/tmp/tsconfig-cg12-fix1.json`의 `./node_modules/.bin/tsc -p /tmp/tsconfig-cg12-fix1.json --noEmit`은 exit 0입니다. 이 fix에서 실제 Claude와 CG-14 복구는 실행하지 않았습니다.

fix round 변경 경로는 `src/generation-runtime/execution-loop.ts`, `src/generation-runtime/execution-evidence-registry.ts`, `tests/integration/generation-loop.test.ts`, `tests/integration/controlled-process-os.test.ts`, 이 보고서입니다.

동결 직전 점검에서 provider 선택 실패, 직렬화 상한 초과, 소유 실행 폴더 생성 실패의 `no_process_created` 분기가 공통 durable 저장 함수를 거치지 않는 누락을 확인했습니다. adapter가 없는 실행에서 첫 M-050이 `SQLITE_BUSY`인 회귀를 추가했습니다. 최초 `./node_modules/.bin/vitest run tests/integration/generation-loop.test.ts -t 'adapter 선택 전 Confirmed'`는 첫 오류가 `stop()`으로 반환돼 exit 1, 1개 실패였습니다. 세 사전 실패 분기를 선택적 실행 폴더를 받는 같은 bounded 저장 함수로 연결한 뒤 같은 명령은 exit 0, 1개 통과였습니다. 소스에는 M-050 직접 호출이 공통 함수 내부 한 곳만 남고 세 사전 분기와 provider 실행 뒤 두 분기가 모두 이 함수를 호출합니다. `./node_modules/.bin/vitest run tests/integration/generation-loop.test.ts`는 exit 0, 13개가 통과했습니다. 마지막 관련 10개 파일 실행도 exit 0, 83개가 통과했고 scoped typecheck도 다시 exit 0이었습니다. 전역 typecheck는 병행 CG-16의 `tests/unit/web/client.test.ts` 두 타입 오류 때문에 exit 1이었으며 C-05 소유 경로 오류는 없었습니다.
