# CG-14 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

### CG-14 시작·정상 종료·crash gap 복구와 known limitation의 명시

**구현 묶음**: B-02입니다. **선행**: CG-11, CG-12, CG-13입니다.

**연결 기준**: M-036, M-039, M-049, M-050, US-009, US-010, ENT-27, ENT-28, ENT-29, ENT-30, SCN-16, SCN-17, SCN-20, NQ-04, NQ-05, NQ-14, NQ-16, NQ-21, NQ-22, NQ-23, ND-08, ND-09, ND-10, ND-13, ND-14, INF-04, INF-07, INF-08, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/generation-runtime/recovery.ts` | 생성합니다. | M-039 부모 중단 분류와 제한된 M-050 복구 경로입니다. |
| `src/runtime/macos-observation.ts` | 갱신합니다. | CG-05에서 준비한 고정 sysctl/ioreg host/boot 관찰을 복구 판단에 연결합니다. |
| `src/generation-runtime/runtime-lifecycle.ts` | 생성합니다. | runtime 등록·shutdown·pending 보존과 정리 중 DB 수명입니다. |
| `src/application/generation-internal.ts` | 갱신합니다. | 검증한 원 claim의 복구 관찰 capability만 연결합니다. |
| `tests/helpers/recovery-rig.ts` | 생성합니다. | 같은 실제 DB와 명시 OS 관찰 fixture를 결합하는 아래 계약입니다. |
| `tests/helpers/runtime-workers.ts` | 갱신합니다. | 기존 helper에 claim/spawn/commit 장애 barrier를 추가합니다. |
| `tests/fixtures/runtime-worker.ts` | 갱신합니다. | 기존 worker에 제한 child fixture와 crash 지점을 추가합니다. |
| `tests/integration/generation-recovery.test.ts` | 생성합니다. | unknown·reboot 조건·terminal 보존·낡은 claim을 검증합니다. |
| `tests/integration/generation-crash-os.test.ts` | 생성합니다. | 실제 worker 중단 후 저장·slot 보존을 검증합니다. |

**인터페이스와 입력 조건**

createRecoveryRig(app) -> {prepareClaim():Promise<{runId,claimId}>,restartWithObservation(observation):Promise<RecoverySummary>,signals():readonly SignalAttempt[]}를 tests/helpers/recovery-rig.ts에 정의합니다. prepareClaim은 RUN_REQUEST fixture/M-032와 RUN_CLAIM M-036을 실제 DB에서 호출합니다. restartWithObservation은 test 전용 OS observation port와 새 runtime을 조립하며 DB를 직접 terminal/빈 slot으로 수정하지 않습니다. 관찰 fixture의 출처를 Test로 남깁니다. 실제 owner crash는 별도 generation-crash-os.test.ts에서 runtime-workers로 검증합니다.

RecoverySummary는 {classification:'KnownInterrupted'|'Unknown'|'PreservedTerminal',goalMet:boolean,reason,...}를 내부 결과로 사용하며 공개 GenerationRunView에는 정제한 상태/미확인 이유만 매핑합니다. same-host/same-boot에서 strong start identity가 없으면 owner PID ESRCH·ps lstart·heartbeat로 M-039를 완화하지 않습니다.

정상 observation과 host_reboot_confirmed가 M-050에 연결되어도 Run이 running이면 검증된 부모 중단에 따른 M-039 terminal 확정이 필요합니다. M-036은 slot 없음 AND 다른 running 없음일 때만 다음 pending을 인수합니다.

macOS observation 명령은 /usr/sbin/sysctl -n kern.bootsessionuuid 및 /usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice -k IOPlatformUUID입니다. shell=false·고정 args·제한 출력·UUID 형식을 검사합니다. raw UUID/OS 전체 출력은 로그/UI/인계에 내보내지 않습니다. 시작 정보가 미지원이면 그 사실을 저장하고 가짜 strong identity를 만들지 않습니다. 초기 native libproc helper/Python/Swift runtime 추가는 없습니다.

- [x] **Step 079: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { readGenerationState } from '@/tests/helpers/generation-fixture';
import { createRecoveryRig } from '@/tests/helpers/recovery-rig';

it('keeps same-boot recovery unknown without strong identity even when the owner PID is absent', async () => {
  const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
  try {
    const rig = createRecoveryRig(app);
    const before = await rig.prepareClaim();
    const report = await rig.restartWithObservation({
      source: 'Test', hostRelation: 'same', bootRelation: 'same',
      startIdentity: 'unavailable', ownerPidCheck: 'ESRCH',
      executionTermination: 'unknown'
    });
    expect(report).toMatchObject({ classification: 'Unknown', goalMet: false });
    const state = readGenerationState(app.db, before.runId);
    expect(state.runs[0].status).toBe('running');
    expect(state.slot?.claimId).toBe(before.claimId);
    expect(state.observations).toHaveLength(0);
    expect(rig.signals()).toHaveLength(0);
  } finally {
    await app.close();
  }
});
```

- [x] **Step 080: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/generation-recovery.test.ts -t "keeps same-boot recovery unknown"
```

예상 결과는 다음과 같습니다. PID 부재/새 runtime만으로 interrupted 또는 종료 확인을 확정하거나 slot을 지우는 구현에서 실패해야 합니다. fake observation으로 실제 OS 복구 지원 완료를 표시하는 테스트도 실패시킵니다.

- [x] **Step 081: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

앱 등록은 새 runtimeInstanceId와 host/boot·부모 PID·관찰 가능한 시작 identity/미지원 상태를 claim/launchIntent에 연결합니다. 복구용 비밀은 공개 DTO/로그에 넣지 않습니다. 조회 준비 뒤 10초 내 분류 목표를 측정하고 증거 부족이면 Unknown+goalMet=false를 기록합니다.

M-039는 승인 ND-10의 강한 OS 근거가 있는 이전 runtime의 running만 interrupted 실패로 CAS합니다. 초기 same-boot strong identity 부재는 알려진 한계이며 미확인 상태/slot을 보존합니다. 테스트가 이 보수적 동작을 확인했다고 NQ-21 목표 통과로 바꾸지 않습니다.

같은 물리 host·검증된 boot 전환·실행 전 저장된 원 identity가 모두 있을 때만 host_reboot_confirmed를 사용합니다. 실제 reboot 없이 주입한 fixture는 알고리즘 테스트입니다. sleep/same boot·다른 host·복사/VM 복원·UUID 파싱 실패·EPERM·ESRCH 단독은 자동 종료 근거가 아닙니다. 신뢰 조건을 실제로 검증하지 못하면 해당 OS recovery capability는 비활성입니다.

실제 worker를 claim commit 전/후, spawn 직후 PID 저장 전, 성공 commit 뒤 M-050 전에서 중단합니다. worker가 만든 제한 Node child를 테스트 harness가 현재 소유 handle로 별도 정리하더라도, 앱 복구의 trusted observation을 조작하지 않습니다. slot/Run/초안/receipt/pending 보존과 재인수 거절을 확인합니다. 종료 미확인 child가 남으면 test-runs를 지우지 않습니다.

검증된 부모 중단과 실제 Claude 전체 종료를 분리합니다. M-039 뒤에도 slot을 유지합니다. terminal 성공은 보존하고 M-050만 보충합니다. 복구 runtime은 완료 권한을 재발급하지 않으며 옛 claim completion을 차단하고 동일 claim observation만 허용합니다.

정상 shutdown은 새 HTTP 변경/인수 중단, 짧은 commit/rollback 완료, 자기 runner 정리, M-049/M-050 저장, runtime 종료 기록, DB close 순서입니다. running 정리는 내부 실패 사유이며 사용자의 가상 취소 행위로 만들지 않습니다. 10초 뒤에도 종료 미확인/저장 실패면 slot을 보존하고 오류 종료합니다.

ready는 DB 사용 준비와 provider/복구 제한을 분리합니다. Unknown일 때 비AI 조회·편집이 가능하고 새 인수만 막히는지 검사합니다. maintenance는 active/unknown runtime·slot/running이면 거절하여 source 변경/시드로 상태를 초기화하지 않습니다.

B-02 결과에 same-boot crash의 NQ-21 미통과와 실제 reboot 미검증을 분명히 남깁니다. 목표 충족이 필요한 후속 결정을 위해 원인·가능한 strong identity 수단·native 추가 비용을 제시하며 현재 승인 경계를 임의 완화하지 않습니다.

- [x] **Step 082: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/generation-recovery.test.ts tests/integration/generation-crash-os.test.ts tests/integration/generation-claim.test.ts
```

통과 조건은 다음과 같습니다. 보수적 unknown 처리와 실제 crash 자료 보존 테스트는 GREEN이어야 합니다. 그러나 same-boot 강한 identity 미지원으로 NQ-21 해당 목표는 미통과이며, fixture reboot는 실제 reboot 검증을 대체하지 않습니다.

- [x] **Step 083: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 084: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

저장·복구 테스트의 GREEN과 NQ-21 목표 달성을 별개로 보고합니다.

재시작 후 stale PID/PGID signal·자동 slot 삭제·claim 재발급이 없습니다.

실제 crash 테스트의 환경·지점·자료 보존·미확인 child/목표 결과를 기록합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
