# CG-10 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

### CG-10 현재 입력·provider 선택의 고정과 생성 접수·조회·취소·재시도

**구현 묶음**: B-02입니다. **선행**: CG-01, CG-02, CG-03, CG-05, CG-09입니다.

**연결 기준**: M-032, M-033, M-034, M-035, US-009, US-010, US-013, ENT-26, ENT-27, ENT-34, ENT-35, SCN-14, SCN-15, SCN-17, SCN-19, NQ-07, NQ-08, NQ-10, NQ-14, NQ-17, NQ-18, NQ-20, NQ-22, ND-02, ND-04, ND-07, ND-08, ND-14, INF-03, INF-04, INF-05, INF-06입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/results.ts` | 갱신합니다. | 새 접수 포화의 QUEUE_FULL을 DomainErrorCode와 HTTP 매핑에 연결합니다. |
| `src/application/generation-service.ts` | 생성합니다. | S-07 공개 M-032~M-035 구현입니다. |
| `src/application/generation-snapshot.ts` | 갱신합니다. | CG-09의 공유 calculator를 실제 생성 접수·재시도에 연결합니다. |
| `src/persistence/generation-repository.ts` | 생성합니다. | 기존 schema의 snapshot/Run/receipt/용량 조건을 같은 트랜잭션으로 처리합니다. |
| `tests/helpers/generation-fixture.ts` | 생성합니다. | 아래에 정의한 최소 실제 DB fixture와 읽기 전용 snapshot helper입니다. |
| `tests/integration/generation-request.test.ts` | 생성합니다. | 접수·포화·재생·선택 고정·현재 입력 재시도를 검증합니다. |
| `tests/contract/generation-public.test.ts` | 생성합니다. | 공개 입력/오류/조회 정제와 내부 메서드 비노출을 검증합니다. |

**인터페이스와 입력 조건**

createGenerationFixture(app) -> Promise<{scope,input,guard}>는 tests/helpers/generation-fixture.ts에 정의합니다. empty 테스트 DB에 STORAGE의 fixture builder로 한 가상 프로젝트·담당 membership·editable SR·설명·프로젝트 내부 규칙만 한 트랜잭션으로 넣습니다. 생산 서비스의 권한/용량 코드는 구현하지 않습니다. scope는 실제 fixture의 actorId/projectId/srId이며 guard를 포함하지 않습니다. input은 CONTRACT GenerationInput의 질문 생성값입니다. fixture는 TestApp empty의 기존 프로젝트·멤버를 재사용하고 업무 SR·설명·규칙만 준비합니다. 그 뒤 실제 M-047의 new_generation 준비 조회에서 얻은 expectedInputFingerprint를 별도 guard로 반환합니다. M-034 같은 다른 메서드에 이 guard를 자동으로 섞지 않습니다. 이미 업무 자료가 있는 DB이면 거절합니다. 생성 Run/receipt는 미리 만들지 않습니다.

readGenerationState(app.db,runId?)는 같은 파일의 읽기 전용 SELECT입니다. 결과는 깊게 동결한 {nonterminalCount,runs:[{runId,status,inputSnapshotRef,providerSelection,retryOfRunId}],snapshots,receipts,slot,claims,observations,businessDigest}입니다. businessDigest는 원문 버전·질문/결정·게이트·승인 기준을 안정 정렬한 digest이며 runtime/receipt/활동 추가는 제외합니다. ownership token과 raw 모델/인증 값을 반환하지 않습니다. 정확한 SQL 열 이름은 STORAGE schema에 맞추며 helper가 제품 상태를 수정하지 않습니다.

taskKind wire enum은 CONTRACT와 일치시킵니다. 질문·결정 제안·요구사항/진행 계획/설계/구현 계획의 작업 구분을 유지합니다. 문서 대상은 정확한 versionRef 또는 absent 기준입니다. providerSelection은 서버 설정에서 고정하고 사용자 임의 실행 인자를 받지 않습니다.

최종 크기 검사는 canonical 지문용 envelope와 별도로 실행합니다. InputSnapshot 저장은 실제 직렬화 snapshot 2 MiB 상한을 검사합니다. M032/M035는 서버에서 고정한 selection과 task/documentKind를 합친 실제 ProviderRequest JSON의 UTF-8 bytes도 2 MiB 이하인지 같은 transaction의 commit 전에 검사합니다. canonical 입력이 한도 이하여도 JSON 문자열 escaping·명시 ref marker·전송 포장으로 커지면 snapshot/Run/receipt를 남기지 않고 VALIDATION_ERROR로 거절합니다. provider/model은 이 크기 검사에는 포함되지만 업무 fingerprint에는 포함되지 않습니다.

M-033 Query와 M-032/M-034/M-035의 receipt를 구분합니다. M-035는 failed/cancelled에서만 새 Run을 만듭니다. succeeded의 새 생성은 M-032입니다. 공개 registry는 M-032~035만 연결하며 M-036~039/M-049~050은 HTTP에 등록하지 않습니다.

- [x] **Step 055: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { createGenerationFixture, readGenerationState } from '@/tests/helpers/generation-fixture';

it('replays a queued request at capacity and rejects only the eleventh new request', async () => {
  const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
  try {
    const { scope, input, guard } = await createGenerationFixture(app);
    const sent = [];
    for (let i = 0; i < 10; i += 1) {
      const result = await app.invoke('M-032', { ...scope, guard, idempotencyKey: `queue-${i}` }, input);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.code);
      expect(result.value.status).toBe('pending');
      sent.push(result.value.runId);
    }
    const replay = await app.invoke('M-032', { ...scope, guard, idempotencyKey: 'queue-0' }, input);
    expect(replay).toMatchObject({ ok: true, disposition: 'Replayed', value: { runId: sent[0] } });
    const overflow = await app.invoke('M-032', { ...scope, guard, idempotencyKey: 'queue-10' }, input);
    expect(overflow).toMatchObject({ ok: false, error: { code: 'QUEUE_FULL' } });
    expect(readGenerationState(app.db).nonterminalCount).toBe(10);
    expect(readGenerationState(app.db).snapshots).toHaveLength(10);
  } finally {
    await app.close();
  }
});
```

- [x] **Step 056: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/generation-request.test.ts -t "replays a queued request at capacity"
```

예상 결과는 다음과 같습니다. 미구현 M-032가 pending을 만들지 못하거나 receipt 우선/11번째 제한을 빠뜨려 행동 assertion이 실패해야 합니다. import 오류·DB fixture 실패는 RED 증거로 인정하지 않습니다.

- [x] **Step 057: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

BEGIN IMMEDIATE에서 현재 역할·SrScope·receipt를 먼저 확인합니다. 기존 같은 키/지문이면 현재 권한 재검사 후 Replayed를 반환하고 포화 검사를 새 접수에만 적용합니다. nonterminal 개수<10을 확인한 뒤 ENT-26·ENT-27 pending·ENT-35·활동을 함께 commit합니다. 실패 지점 주입으로 부분 snapshot/Run/receipt 0건을 검증합니다.

입력 지문은 task/refinement·설명·확인 상태·답변/결정/분류·참조 문서·규칙 내용/버전·targetBasis를 포함합니다. provider/model·host·cwd·runtime ID는 별도 실행 선택/메타데이터이며 업무 fingerprint에 넣지 않습니다. 실행 시 현재 포인터를 다시 읽어 옛 snapshot을 바꾸지 않습니다.

UTF-8 직렬화 명시 입력 총 2 MiB를 검사합니다. 새 문서 absent와 기존 정확한 versionRef를 구분합니다. 잘못된 다른 SR 참조·권한·누락 targetBasis·크기 초과는 작업을 남기지 않고 명확히 거절합니다.

M-034는 pending/running에서 첫 terminal을 CAS로 cancelled로 바꾸고 제어 알림을 commit 뒤 전달합니다. 여기서 프로세스 종료/slot 해제를 쓰지 않습니다. M-035는 이전 failed/cancelled를 보존한 채 현재 입력/선택으로 새 pending과 retryOfRunId를 만듭니다.

조회에 provider 종류·요청 모델·확인된 실제 모델·상태·stale·적용·신호/종료 확인을 별개 값으로 연결합니다. 질문 조회나 M-033 조회가 hidden write를 만들지 않게 합니다. 소유권 token·개인 경로·raw 진단을 직렬화하지 않습니다.

포화 상태의 M-033/M-034, 입력 변경 후 재시도, 설정만 변경한 뒤 기존 snapshot/문서/게이트 불변, 같은 입력 다른 키/같은 키 다른 입력, 공개 경로의 6개 내부 메서드 거절을 각각 별도 테스트로 추가합니다.

- [x] **Step 058: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/generation-request.test.ts tests/contract/generation-public.test.ts
```

통과 조건은 다음과 같습니다. 실제 SQLite의 10개 접수·동일 receipt 재생·11번째 거절·새 재시도·조회 무변경·내부 비노출이 통과해야 합니다. Claude 실제 성공은 이 명령의 결과에 포함하지 않습니다.

- [x] **Step 059: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 060: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

대기 작업과 고정 입력/선택/receipt의 원자적 저장 증거가 있습니다.

질문·결정/문서 작업 구분과 실제/테스트 표시 계약을 보존합니다.

관련 targeted GREEN과 typecheck를 기록하고 스토리 전체 완료를 표시하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
