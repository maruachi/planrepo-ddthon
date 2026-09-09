# CG-14 복구 구현 보고

## 구현 결과

M-039는 현재 runtime 등록을 확인한 뒤 이전 활성 runtime과 singleton 실행 slot을 같은 DB 기준에서 읽습니다. 관찰은 잠금 밖에서 수행하고, 변경 직전 `BEGIN IMMEDIATE` 안에서 runtime·slot·Run·claim을 다시 대조합니다. 같은 boot의 PID `ESRCH`, heartbeat, `ps` 결과, 다른 host, UUID 파싱 실패는 `Unknown`으로 남기며 signal과 DB 변경을 만들지 않습니다. slot 없는 stale runtime도 강한 종료 근거가 없으면 활성 등록을 보존하고 새 claim을 막습니다.

테스트가 소유한 실제 Node DB owner의 exit와 close를 확인한 경우에만 부모 중단을 `KnownInterrupted`로 분류합니다. running Run은 `INTERRUPTED` first-terminal CAS와 내부 activity를 같은 transaction에 저장합니다. 전체 실행 종료가 확인되지 않으면 원 claim slot과 runtime 등록을 유지합니다. 이미 succeeded·failed·cancelled인 Run은 덮지 않습니다. 같은 물리 host가 별도로 보증된 test port의 boot 전환만 `host_reboot_confirmed`를 사용할 수 있습니다. 전체 종료까지 확인한 경우 M-050 observation을 저장한 뒤 정확히 일치하는 slot과 이전 활성 등록만 해제합니다.

`createMacosRecoveryObservationPort`는 host·boot UUID digest 비교를 관찰 정보로 반환하지만 강한 reboot capability를 발급하지 않습니다. `ioreg`는 `/usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice -k IOPlatformUUID`로 고정했습니다. `shell=false`, 1초 timeout, 4,096 bytes 상한과 UUID 형식 검사를 유지합니다. root의 읽기 전용 실제 명령 확인은 sysctl 37 bytes와 ioreg 1,860 bytes가 상한 안에서 정상 형식으로 끝났지만, 실제 reboot·동일 물리 host·강한 process identity 증거로 사용하지 않았습니다.

`GenerationRuntimeLifecycle`은 recovery가 끝나기 전과 unresolved Run/runtime이 남은 동안 claim을 막습니다. 비AI HTTP 조회는 Unknown 상태에서도 유지됩니다. `main`은 현재 runtime 등록 뒤 recovery를 execution loop의 첫 claim 전에 실행하며 shutdown 시작 시 claim 가능 상태를 먼저 내립니다. 기존 server close, runner·observation drain, runtime unregister, DB close 순서를 유지합니다.

## TDD와 검증

첫 macOS 명령 테스트는 기대한 `-k IOPlatformUUID`가 실제 호출에 없어 exit 1이었습니다. 수정 뒤 `tests/unit/runtime-identity.test.ts`가 GREEN이 됐습니다. 수집 가능한 recovery no-op은 same-boot·ESRCH 사례에서 `inspectedCount=0`을 반환해 기대 1과 달라 exit 1이었습니다. 실제 후보 조회를 연결한 뒤 running·slot·observation 무변경과 signal 0개로 GREEN이 됐습니다.

회귀는 same-boot Unknown, 명시 test capability의 same-host reboot와 owner exit, 다른 host, macOS UUID 비교만 바뀐 경우, terminal first winner, pending, slot 없는 stale runtime, activity 실패 rollback, host reboot M-050, 내부 M-039 runtime capability를 검사합니다. 실제 별도 Node worker는 claim 전, claim commit 뒤, succeeded commit 뒤 M-050 전에서 종료했습니다. 첫 child-gap 테스트는 테스트 runner가 child를 만들어 DB owner worker와 sibling인 사실을 실제 PPID assertion으로 드러내며 exit 1이었습니다. 수정 뒤 DB owner worker가 제한 Node child를 직접 만들고 `spawned_before_pid_persistence` barrier에 도달한 다음 종료됩니다. parent PID는 저장된 worker owner PID와 일치하고 child PID는 runtime identity로 저장되지 않았습니다. worker 종료 뒤에도 child의 test 전용 socket이 살아 있는 상태에서 M-039가 slot과 observation을 보존했고, harness는 PID signal 없이 그 socket으로 유한 수명 child의 종료를 확인했습니다. 이 fixture는 production provider spawn topology나 escaped descendant 부재를 증명하지 않습니다.

최종 `./node_modules/.bin/vitest run tests/integration/generation-recovery.test.ts tests/integration/generation-crash-os.test.ts tests/integration/generation-claim.test.ts tests/integration/readiness.test.ts tests/integration/generation-loop.test.ts tests/unit/runtime-identity.test.ts tests/unit/runtime-lifecycle.test.ts`는 exit 0이며 7개 파일 46개 테스트가 통과했습니다. `npm run typecheck`와 CG-14 소유 source/helper용 `/tmp/tsconfig-cg14.json`은 모두 exit 0입니다. `node --import tsx -e "import('./src/main.ts')"`도 exit 0입니다.

CG-14에서는 실제 reboot, 실제 Claude 호출, native libproc helper, 제품 Claude sandbox profile, Docker와 브라우저를 실행하지 않았습니다. same-boot strong start identity와 실제 전체 process scope 증거는 계속 미지원이므로 NQ-21 목표는 미통과입니다. Unknown이면 비AI 사용은 가능하지만 새 claim과 offline maintenance는 차단됩니다.

독립 검토 fix1의 대상 명령 `./node_modules/.bin/vitest run tests/integration/generation-crash-os.test.ts -t 'limited child exists'`는 sibling PPID와 저장 owner PID가 달라 exit 1이었습니다. worker 소유 child와 실제 barrier를 연결한 뒤 같은 명령은 exit 0이며 1개 테스트가 통과하고 3개를 건너뛰었습니다.

fix1 관련 검증 `./node_modules/.bin/vitest run tests/integration/generation-crash-os.test.ts tests/integration/generation-claim.test.ts`는 exit 0이며 2개 파일 11개 테스트가 통과했습니다. `npm run typecheck`도 exit 0입니다. 기존 동결본의 7개 파일 46개 테스트와 scoped TypeScript·main import 결과는 source core가 바뀌지 않아 반복하지 않았습니다.
