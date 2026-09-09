# CG-12 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

### CG-12 동시 pipe·deadline·취소·종료 관찰을 분리하는 제한 Node runner

**구현 묶음**: B-02입니다. **선행**: CG-01, CG-02, CG-11입니다.

**연결 기준**: M-034, M-036, M-037, M-038, M-049, M-050, US-009, US-010, ENT-27, ENT-28, ENT-29, ENT-30, SCN-16, SCN-17, SCN-20, NQ-02, NQ-14, NQ-15, NQ-16, NQ-17, NQ-19, NQ-22, ND-08, ND-09, ND-10, ND-11, ND-12, INF-02, INF-03, INF-06, INF-07, INF-08입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/runtime/controlled-process-runner.ts` | 생성합니다. | 비동기 spawn과 소유 handle·pipe·signal·종료 관찰을 구현합니다. |
| `src/runtime/process-evidence.ts` | 생성합니다. | 현재 실행에 연결된 observation capability와 unknown을 구분합니다. |
| `src/generation-runtime/execution-loop.ts` | 생성합니다. | C-05의 provider 호출·M-049 제어·M-038/M-050 전달입니다. |
| `tests/helpers/process-rig.ts` | 생성합니다. | 가짜 시계/명시 event의 좁은 spawn port와 실제 runner를 연결합니다. |
| `tests/fixtures/process-child.mjs` | 생성합니다. | Node만 사용하는 실제 child fixture이며 아래 명령/수명 계약을 따릅니다. |
| `tests/unit/controlled-process.test.ts` | 생성합니다. | 두 pipe·시간·signal 경계의 결정적 순서를 검증합니다. |
| `tests/integration/controlled-process-os.test.ts` | 생성합니다. | 현재 macOS의 실제 child exit/close·입출력·취소/강제 종료를 검증합니다. |
| `tests/helpers/generation-controller.ts` | 생성합니다. | 자동 인수를 기본 정지한 TestApp에서 명시한 테스트 adapter 또는 사전 검증한 live 후보의 C-05 루프를 제어합니다. |

**인터페이스와 입력 조건**

ControlledProcessRunner.start(spec,observer) -> OwnedExecution을 정의합니다. spec={executable,args,cwd,env,stdinBytes,launchRef,limits}; observer는 실제 실행 관찰/정제 실패만 받습니다. OwnedExecution={result:Promise<ProcessResult>,requestStop(reason),getObservationState()}. ProcessResult는 Completed{stdout:Buffer,stderrByteCount,exitCode:0,closedAtMono,deadlineMono}|Failure{code}의 판별을 유지하며, CG13 첫 실제 adapter 소비에서 양쪽 분기에 최초 결과 확정 시점의 정제된 실행 metrics를 추가합니다. 실제 byte 수·pipe close 관측·시작 시도와 결과 확정 시각·관측한 exit/signal을 담고 늦은 관찰로 소급 수정하지 않습니다. Completed는 business 성공이 아니며 C-06/C-02의 결과 schema·refs·deadline 재검사가 남습니다. observation이 unknown이 되어도 동일 live handle의 늦은 신뢰 가능한 close를 observer로 전달할 수 있습니다. raw stderr를 Failure에 포함하지 않습니다.

tests/helpers/process-rig.ts의 createProcessRig() -> {start(),stdout(Buffer),stdoutEnd(),stderr(Buffer),stderrEnd(),exit(code),close(code),advance(ms),flush(),resultSettled(),signals()}를 정의합니다. 이것은 생산 ControlledProcessRunner에 fake SpawnPort/MonotonicClock를 주입하는 helper이며 결과/slot을 자체 구현하지 않습니다. flush는 이미 예약한 promise/event만 소진합니다. advance는 단조 시계와 timer를 명시적으로 움직입니다. 실제 OS 증거와 구분합니다.

tests/fixtures/process-child.mjs는 process.execPath로만 실행합니다. argv의 enum mode는 success, late-stderr-overflow, flood-both, wait-for-term, ignore-term, nonzero, invalid-json입니다. stdin으로 받은 명시 가상 bytes만 처리합니다. 생산 runner와 같은 stdin/stdout/stderr 세 pipe를 사용하며 시작은 현재 ChildProcess spawn 이벤트로 관찰합니다. 추가 IPC descriptor를 생산 runner에 요구하지 않습니다. success는 stdout 후 정상 exit; late-stderr-overflow는 stdout을 끝낸 뒤 stderr 262145 bytes; ignore-term만 자기 SIGTERM을 무시합니다. 네트워크·설정·credential·다른 파일 접근·자손 spawn은 하지 않습니다. 테스트 종료는 자신이 만든 handle만 정리하며 살아 있는 child/unknown evidence면 cwd를 삭제하지 않습니다.

createGenerationController(app)는 tests/helpers/generation-controller.ts에서 실제 C-05와 S-07 비공개 포트를 조립합니다. 반환값은 startTestAdapter(provider:GenerationProvider):Promise<void>, stop():Promise<void>입니다. TestApp은 기본 manual/paused이며 생성 접수·수동 claim 테스트 중 background loop가 자동 시작되지 않습니다. controller는 app.close에 stop을 등록하고 동일 앱에서 중복 루프 시작을 거절합니다. 테스트 adapter 주입은 이 내부 helper만 사용하며 일반 제품 API나 설정에서는 접근할 수 없습니다.

- [x] **Step 067: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { createProcessRig } from '@/tests/helpers/process-rig';

it('does not finish on stdout and fails if stderr later exceeds its byte limit', async () => {
  const rig = createProcessRig();
  const execution = rig.start();
  rig.stdout(Buffer.from('{"type":"result","subtype":"success","is_error":false,"result":"{}"}'));
  rig.stdoutEnd();
  await rig.flush();
  expect(rig.resultSettled()).toBe(false);
  rig.stderr(Buffer.alloc(262145));
  await rig.flush();
  expect(await execution.result).toMatchObject({ kind: 'Failure', code: 'OUTPUT_LIMIT' });
  expect(execution.getObservationState().kind).not.toBe('Confirmed');
  rig.exit(0);
  rig.stderrEnd();
  rig.close(0);
  await rig.flush();
  expect(await execution.result).toMatchObject({ kind: 'Failure', code: 'OUTPUT_LIMIT' });
});
```

- [x] **Step 068: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/unit/controlled-process.test.ts -t "does not finish on stdout"
```

예상 결과는 다음과 같습니다. stdout 하나의 완료를 전체 성공으로 처리하는 구현에서 첫 assertion이 실패해야 합니다. 또는 stderr 초과를 부분 성공으로 처리하는 동작에서 Failure assertion이 실패해야 합니다.

- [x] **Step 069: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

spawn(executable,args,{shell:false,detached:true,cwd,env,stdio:[pipe,pipe,pipe]})를 사용하고 unref하지 않습니다. C-05가 저장한 launchIntent/capability와 현재 ChildProcess handle을 연결합니다. 프롬프트는 stdin에 쓰고 backpressure/입력 오류를 처리합니다. stdout/stderr data listener를 즉시 함께 붙입니다.

각 Buffer raw bytes를 누적하며 stdout>4194304 또는 stderr>262144면 OUTPUT_LIMIT과 정리를 시작합니다. Korean UTF-8 경계와 JSON escape 후 입력 2097152 bytes를 검사합니다. stderr 끝까지 소비하거나 상한에서 명시적으로 실패 처리하고 raw 덤프를 남기지 않습니다.

deadlineMono=spawnAttemptMono+300000입니다. timer 통지뿐 아니라 close/파싱/참조 검증 후 M-037 직전 nowMono<=deadlineMono를 재검사합니다. direct child 정상 exit 0, 양쪽 stream close, 최종 bytes, IO 오류 부재가 모두 있어야 ProcessResult.Completed가 됩니다. nonzero/invalid IO는 실패이며 JSON envelope 판정은 RUN_PROVIDER가 맡습니다.

M-034 commit 알림+250ms M-049 확인으로 중단 요청을 감지합니다. 1초 내 SIGTERM 목표, 2초 유예 후 여전히 같은 실행의 소유 범위를 확인할 때만 SIGKILL을 시도합니다. pgid>1의 현재 소유 group만 허용하고 종료 후 timer를 해제합니다. 재시작 DB PID/PGID에 signal을 보내지 않습니다.

signal 성공·child.killed·ESRCH 하나를 종료로 쓰지 않습니다. direct child/양쪽 pipe와 검증된 실행 범위 부재를 결합합니다. EPERM·escaped descendant·identity 불확실이면 unknown, 10초 관찰 목표 미통과, slot 유지입니다. 신뢰 가능한 늦은 관찰만 M-050에 전달합니다.

실제 Node child fixture로 stdin 한글/backpressure, 동시 flood, 정상/비정상 exit, SIGTERM 반응/무응답, close 지연을 검증합니다. fake clock 테스트는 300초 경계/1ms 초과/파싱으로 timer 지연을 검증하고 실제 clock 테스트는 별도 증거로 기록합니다. tests/helpers/runtime-workers.ts의 앱 worker와 연결해 비AI 요청이 생성 중에도 처리됨을 확인합니다.

검증 목록에 ENOENT spawn 확정 실패의 no_process_created와 PID 저장 전 crash gap의 unknown을 별도로 둡니다. 어떤 경우도 기존 문서/승인이나 terminal 결과를 뒤집지 않습니다.

- [x] **Step 070: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/unit/controlled-process.test.ts tests/integration/controlled-process-os.test.ts tests/integration/generation-claim.test.ts
```

통과 조건은 다음과 같습니다. 결정적 event 경쟁과 현재 macOS 실제 child 검증을 각각 기록합니다. actual child fixture의 성공을 Claude no-spawn/managed 정책 검증으로 일반화하지 않습니다. 시간 목표를 초과하면 실패/미통과 수치를 남깁니다.

- [x] **Step 071: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 072: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

모든 pending listener/pipe/timer의 정상 종료와 unknown 보존을 검사했습니다.

표준 시간·bytes 제한을 상향해 테스트를 통과시키지 않습니다.

timeout/취소/실패의 terminal 확정과 실제 종료 관찰이 다른 사건임을 검증했습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
