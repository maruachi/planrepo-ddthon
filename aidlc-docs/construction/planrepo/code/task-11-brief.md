# CG-11 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

### CG-11 단일 claim·launch intent·첫 terminal·종료 slot의 저장 경계

**구현 묶음**: B-02입니다. **선행**: CG-10입니다.

**연결 기준**: M-036, M-037, M-038, M-049, M-050, US-009, US-010, US-011, US-013, ENT-26, ENT-27, ENT-28, ENT-29, ENT-30, ENT-34, SCN-14, SCN-15, SCN-16, SCN-17, SCN-19, SCN-20, NQ-06, NQ-08, NQ-14, NQ-16, NQ-18, NQ-21, NQ-22, ND-01, ND-07, ND-08, ND-09, ND-10, ND-12, INF-04, INF-06, INF-07, INF-08입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/application/generation-internal.ts` | 생성합니다. | C-02 S-07 내부 M-036~M-038/M-049/M-050과 capability 검증입니다. |
| `src/persistence/generation-repository.ts` | 갱신합니다. | 기존 DDL의 FIFO claim·singleton slot·terminal CAS·종료 observation 조건부 query입니다. |
| `src/generation-runtime/claim-context.ts` | 생성합니다. | 서버에서 발급한 runtime/claim capability를 관리하며 공개 DTO와 분리합니다. |
| `tests/helpers/internal-generation-rig.ts` | 생성합니다. | 제품 내부 포트를 직접 사용하는 아래 계약의 test helper입니다. |
| `tests/helpers/runtime-workers.ts` | 생성합니다. | 실제 별도 Node 프로세스에서 같은 DB를 다루는 테스트 실행기입니다. |
| `tests/fixtures/runtime-worker.ts` | 생성합니다. | 부모가 직접 spawn하고 소유하는 claim/장애 worker entry입니다. |
| `tests/integration/generation-claim.test.ts` | 생성합니다. | terminal 경쟁·늦은 observation·두 프로세스 claim과 crash gap 저장을 검증합니다. |

**인터페이스와 입력 조건**

createInternalGenerationRig(app) -> {claim():Promise<ClaimHandle|null>,complete(claim,draft):Promise<RunCompletionOutcome>,fail(claim,error):Promise<RunCompletionOutcome>,control(claim):Promise<RunControlView>,observe(claim,evidence):Promise<ExecutionObservation>}를 tests/helpers/internal-generation-rig.ts에 정의합니다. ClaimHandle은 테스트 접근용 runId/claimId와 helper가 비공개로 보관하는 실제 ClaimedRun/ClaimRef를 연결합니다. 제품 DTO의 필드 모양을 변경하지 않습니다. create 함수는 C-09 test runtime 등록과 C-02 S-07 내부 포트를 조립합니다. app.invoke나 공개 HTTP로 내부 계약을 부르지 않습니다. provider generation과 자동 인수 루프는 시작하지 않습니다. validDraft(claim)는 claim snapshot의 참조만 사용한 명시 fixture를 반환하며 생산 출력 validator를 우회하지 않습니다. complete/observe의 테스트 실행 증거는 좁은 test 포트로만 공급하며 public JSON에서 만들 수 없습니다.

terminationFixture(claim,{kind:'confirmed_test_child_close'|'no_process_created'})는 테스트 포트가 소유한 실행 증거에만 연결됩니다. 문자열 한 개만으로 production M-050 capability가 만들어지지 않습니다. 생산 경로의 no_process_created는 실제 spawn 미발생 증명에만 허용합니다.

tests/helpers/runtime-workers.ts의 startRuntimeWorker({app,testWorkerId,operation,barrier}) -> Promise<{ready,release(),result,crashOwnedWorker(),close()}>를 정의합니다. 부모는 process.execPath와 로컬 `tsx` loader의 인자 ['--import','tsx','tests/fixtures/runtime-worker.ts']로 실제 DB owner child를 직접 spawn합니다. entry는 같은 격리 DB를 별도 connection/runtime으로 열며 새 seed/reset을 하지 않습니다. 제어 정보는 .planrepo/test-runs/<testRunId>/control/<testWorkerId>/의 구조화한 JSON 파일에 READY/RELEASE/CRASH/RESULT로 교환합니다. DB/control 경로는 부모가 app.db에서 확인한 같은 testRunId realpath만 허용합니다. fs.watch와 제한시간 있는 확인으로 barrier를 구현하며 stdout이나 전체 PID 목록을 통신 규약으로 쓰지 않습니다. crashOwnedWorker()는 자기 helper가 소유한 control 채널에 CRASH를 쓰고, 부모가 직접 소유한 DB owner ChildProcess가 자신의 process.pid에만 SIGKILL을 보내도록 합니다. 부모는 그 exact handle의 exit와 close를 모두 확인합니다. close()는 살아 있는 자기 worker에 정상 종료를 요청하고 확인하지 못하면 오류와 자료를 보존합니다. runtime ID와 관찰 사실은 내부 테스트 자료이며 token/raw 출력은 기록하지 않습니다. 제품 runtime에 tsx 의존성이나 외부 supervisor를 추가하지 않습니다.

실제 ExecutionReport의 저장·조회 표현은 결정34의 generation_runs.payload_json.execution을 사용합니다. 최초 terminal 보고서를 보존하고 실제 모델·CLI 버전은 확인한 값만 저장합니다. CG10의 fixture 조회는 실제 provider 실행 증거가 아닙니다.

M-037의 결과 입력은 C-06/C-09가 준 실제 관찰/검증 결과와 결합합니다. 테스트에서 control 가능한 증거 port를 주입하되 production HTTP나 JSON에서 이 port를 구성할 수 없습니다.

- [x] **Step 061: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { createGenerationFixture, readGenerationState } from '@/tests/helpers/generation-fixture';
import { createInternalGenerationRig, validDraft, terminationFixture } from '@/tests/helpers/internal-generation-rig';

it('preserves cancellation until matching termination and ignores old observations after a new claim', async () => {
  const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
  try {
    const { scope, input, guard } = await createGenerationFixture(app);
    const first = await app.invoke('M-032', { ...scope, guard, idempotencyKey: 'r1' }, input);
    if (!first.ok) throw new Error(first.error.code);
    const rig = createInternalGenerationRig(app);
    const c1 = await rig.claim();
    expect(c1).not.toBeNull();
    if (!c1) throw new Error('claim missing');
    await app.invoke('M-034', { ...scope, idempotencyKey: 'cancel-r1' }, first.value.runId);
    await rig.complete(c1, validDraft(c1));
    expect(readGenerationState(app.db, c1.runId).runs[0].status).toBe('cancelled');
    expect(readGenerationState(app.db).slot?.claimId).toBe(c1.claimId);
    const second = await app.invoke('M-032', { ...scope, guard, idempotencyKey: 'r2' }, input);
    expect(second.ok).toBe(true);
    expect(await rig.claim()).toBeNull();
    const observation = terminationFixture(c1, { kind: 'confirmed_test_child_close' });
    await rig.observe(c1, observation);
    const c2 = await rig.claim();
    if (!c2) throw new Error('second claim missing');
    await rig.observe(c1, observation);
    expect(readGenerationState(app.db).slot?.claimId).toBe(c2.claimId);
    expect(readGenerationState(app.db, c1.runId).observations).toHaveLength(1);
  } finally {
    await app.close();
  }
});
```

- [x] **Step 062: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/generation-claim.test.ts -t "preserves cancellation until matching termination"
```

예상 결과는 다음과 같습니다. cancel 뒤 complete가 succeeded로 뒤집히거나, terminal만으로 slot을 비우거나, R1 재전송이 R2 slot을 지우는 결함을 assertion으로 잡아야 합니다.

- [x] **Step 063: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

M-036: BEGIN IMMEDIATE -> slot 비어 있음 AND 다른 running 없음 -> FIFO(createdAt,runId) pending 1개 -> 단 하나의 claim 발급 -> Run running+claim+slot+launchIntent를 같은 commit에 기록합니다. 반환 전에 PID를 요구하지 않습니다. spawn 전에 취소/지원 환경을 다시 확인할 수 있게 합니다.

M-037/M-038: 원 runtime/claim capability와 status=running을 WHERE 조건으로 검사합니다. M-037은 유효한 payload/같은 snapshot refs/정제 2 MiB/성공 관찰/deadline을 확인한 뒤 초안+terminal을 commit합니다. current fingerprint 불일치는 stale 초안으로 보존하며 업무 적용을 하지 않습니다. 늦은 결과는 첫 terminal과 본문을 유지합니다.

M-049는 terminal 뒤에도 같은 claim의 제어만 읽습니다. M-050은 검증된 observation 고유성을 확인하고 claim당 한 번 기록합니다. slot.claimRef=observation.claimRef인 경우에만 slot을 지웁니다. 이미 다른 slot이면 원 observation 재생만 하며 상태를 바꾸지 않습니다.

spawn 미시도 확정/명시 spawn 실패는 no_process_created 증거로 정리할 수 있습니다. PID 저장 전 crash gap·부모 사망·signal 성공·heartbeat 만료를 그 증거로 쓰지 않습니다. 기존 DDL의 claim 유일성·slot singleton·observation 유일성을 실제 SQL로 검증합니다.

두 실제 worker 프로세스를 barrier에서 동시에 M-036에 진입시켜 claim 1개/slot 1개/다른 Run pending을 확인합니다. 같은 키 접수도 서로 다른 connection에서 경쟁시킵니다. BUSY/rollback을 성공으로 삼지 않고 NQ-02 실패 응답 기준에 연결합니다.

성공 먼저/취소 먼저/실패 먼저/timeout 먼저, 잘못된 claim·다른 SR·이전 owner의 completion, 출력 검증 후 commit 직전 입력 변경, slot/Run 모순을 별도 테스트로 둡니다. 상태 모순은 새 인수를 막고 복구 오류를 반환합니다.

- [x] **Step 064: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/generation-claim.test.ts tests/integration/generation-request.test.ts
```

통과 조건은 다음과 같습니다. 첫 terminal·slot/관찰 분리·두 프로세스 단일 인수·잘못된 claim 거절·원자적 실패가 실제 SQLite에서 통과해야 합니다. 모의 termination fixture는 실제 Claude 종료 증거로 보고하지 않습니다.

- [x] **Step 065: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 066: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

6개 내부 계약 중 이 task가 맡는 5개가 공개 경로 없이 연결됩니다. M-039는 RUN_RECOVERY에서 완성합니다.

single slot 보호를 메모리 busy flag로 대체하지 않습니다.

M-050 재생과 다음 Run의 slot 보호가 실제 DB assertion으로 남습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
