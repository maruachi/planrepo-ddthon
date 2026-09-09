# CG-06 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약 해석은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, 최신 Claude 실행 결정은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`입니다. 선행 과제의 실제 코드와 테스트를 사용합니다.

### CG-06 SR 직접 등록·Mock 중복 가져오기·최초 설명과 기본 조회

**구현 묶음**: B-01입니다. **선행**: CG-03, CG-05입니다.

**연결 기준**: M-001, M-002, M-003, M-004, M-005, M-028, M-045, M-047, US-001, US-002, US-003, US-027, ENT-01, ENT-02, ENT-03, ENT-04, ENT-21, ENT-34, ENT-35, SCN-01, SCN-14, SCN-23, SCN-24, NQ-01, NQ-04, NQ-05, NQ-06, NQ-07, NQ-08, NQ-10, NQ-23, ND-01, ND-02, ND-03, ND-04, ND-05, ND-13, INF-01, INF-02, INF-04, INF-05, INF-08, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | SR 제목·최초/현재 설명·Mock 출처의 실제 조회 DTO를 완성합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 메서드 계약을 검사합니다. |
| `src/domain/review-impact.ts` | 생성합니다. | 설명 변경의 G1·종속 G2 영향과 가장 앞선 검토 단계 복귀를 판정합니다. |
| `src/persistence/review-impact-repository.ts` | 생성합니다. | 게이트·epoch·인계 현재성과 이전 요청의 현재 기준 이탈을 명령과 같은 트랜잭션에서 저장합니다. |
| `src/runtime/application-composition.ts` | 생성합니다. | main과 TestApp이 같은 공개 메서드 adapter와 서비스 조립을 사용하게 합니다. |
| `src/application/workspace-service.ts` | 변경 없이 재사용합니다. | 기존 M-001/M-002 계약을 공통 application composition에서 연결합니다. |
| `src/application/sr-context-service.ts` | 생성합니다. | M-003/M-004/M-005의 등록·원 설명·현재 설명을 처리합니다. |
| `src/persistence/generation-run-query.ts` | 생성합니다. | 실제 생성 작업·초안·적용·종료 관찰을 조회하며 미확정 입력 최신성은 명시적으로 구분합니다. |
| `src/application/workspace-query-service.ts` | 생성합니다. | M-045/M-047의 기본 보드·SR 조회를 일관된 읽기로 준비합니다. |
| `src/domain/authorization.ts` | 생성합니다. | ProjectScope/SrScope와 현재 역할·담당자를 검사합니다. |
| `src/persistence/sr-repository.ts` | 생성합니다. | SR·설명 버전·G1/G2 초기 상태와 활동·receipt를 저장합니다. |
| `src/providers/reference/mock-ticket-provider.ts` | 생성합니다. | 프로젝트 config/demo에서만 티켓을 조회합니다. |
| `tests/helpers/domain-cases.ts` | 생성합니다. | DEMO-4 typed ID와 현재 조회 기반 입력 builder를 제공합니다. |
| `tests/integration/sr-context.test.ts` | 생성합니다. | 등록·재생·Mock 중복·설명 보존·scope 거절·원자성을 검사합니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 생성합니다. | S-01/S-02와 기본 S-09 공개 계약·오류·receipt 의미를 추가합니다. |

**추가 연결 기준**: `aidlc-docs/construction/planrepo/code/implementation-decisions.md` 11·12·13·14·17과 `aidlc-docs/construction/planrepo/code/view-readiness.md`를 따릅니다. main·HTTP handlers·TestApp의 실제 서비스 연결 변경도 이번 과제 diff에 포함합니다. M-005를 구현하면서 ReviewImpact를 후속 과제로 미루지 않습니다.

**인터페이스와 입력 조건**

공통 invoke는 {actorId,projectId,srId?,requestId?,idempotencyKey?,guard?}를 받고 서버가 ActorContext/TargetScope를 검증합니다. 성공의 disposition·receipt·current와 거절의 priorReceipt를 보존합니다. demoCase는 승인 DEMO-4 manifest의 ID/입력만 반환하고 currentCase/currentReviewInput은 현재 자료를 읽는 typed helper입니다. 이 helper는 업무 자료를 쓰거나 승인·전환 성공을 대신하지 않습니다. helper의 필드와 wire DTO는 CONTRACT에서 ENT/M 원문에 맞춰 고정합니다. 아래 코드는 구현 시 실행할 대표 RED이며 지금 실행한 결과가 아닙니다. NewSR은 key/title/purpose/description/ownerId이며 projectId는 scope에서 검증합니다. 처음 progressStage는 sr_received이고 M-028의 담당자 명시 요청만 requirements로 전환합니다. 보드 전체 스토리 US-027 완료는 B-06에 남깁니다.

- [x] **Step 031: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput } from '@/tests/helpers/domain-cases';

it('같은 등록 재전송은 하나의 SR과 receipt만 남깁니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('PAY-102');
    const scope = { actorId: c.ownerId, projectId: c.projectId,
      requestId: 'register-1', idempotencyKey: 'register-1' };
    const input = { key: 'TEST-REGISTER-1', title: '중복 접수 검증',
      purpose: '하나의 SR만 등록합니다.', description: '최초 설명입니다.', ownerId: c.ownerId };
    const first = await app.invoke('M-003', scope, input);
    const replay = await app.invoke('M-003', { ...scope, requestId: 'register-2' }, input);
    expect(first).toMatchObject({ ok: true, disposition: 'Committed' });
    expect(replay).toMatchObject({ ok: true, disposition: 'Replayed' });
    if (first.ok && replay.ok) expect(replay.value).toEqual(first.value);
    expect(app.db.prepare('SELECT count(*) AS n FROM srs WHERE project_id = ? AND sr_key = ?')
      .get(c.projectId, input.key)).toEqual({ n: 1 });
    expect(app.db.prepare('SELECT count(*) AS n FROM command_receipts WHERE project_id = ? AND actor_id = ? AND idempotency_key = ?')
      .get(c.projectId, c.ownerId, scope.idempotencyKey)).toEqual({ n: 1 });
    const conflict = await app.invoke('M-003', scope, { ...input, title: '다른 입력입니다.' });
    expect(conflict).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } });
  } finally {
    await app.close();
  }
});
```

- [x] **Step 032: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/sr-context.test.ts
```

예상 결과는 다음과 같습니다. 현재 권한 검증을 통과한 같은 입력의 두 번째 등록이 새 SR을 만들거나 중복 키 오류만 반환해 Replayed 단언이 실패합니다.

- [x] **Step 033: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

현재 membership·ProjectScope를 확인한 뒤 receipt를 검사합니다. 동일 지문은 고정 resultRefs와 현재성을 Replayed로 반환합니다. 새 요청은 프로젝트 key/jiraKey 고유성, 담당자, 필수 입력을 검증하고 SRDescriptionVersion v1, SR의 original/currentDescriptionRef, G1/G2 not_passed, 활동·receipt를 한 tx에서 생성합니다. M-004의 기존 jiraKey는 기존 SR을 안내하고 내용을 덮어쓰지 않습니다. M-005는 expectedRevision과 새 설명 버전·ReviewImpact만 확정하며 originalDescriptionRef는 고정합니다. M-045/M-047은 읽기 중 활동이나 검토 시작을 쓰지 않습니다.

- [x] **Step 034: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/sr-context.test.ts
npm run typecheck
```

통과 조건은 다음과 같습니다. 직접 등록, 같은 키 다른 명령/입력, Mock 중복, 최초 설명 보존, 담당자/다른 SR 범위 거절, 응답 유실 후 재생, receipt 저장 실패 주입 시 SR/활동 전체 rollback이 통과합니다.

- [x] **Step 035: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 036: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-001/US-002/US-003의 기반 메서드와 네 SR 데모 조회를 실제 DB에 연결합니다. M-028의 sr_received→requirements만 이 task에서 구현하고 G1/G2 전환은 G1/G2로 확장합니다. 원문과 현재 설명·Mock 표시·actor 선택을 HTTP 직접 호출에서도 검증합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
