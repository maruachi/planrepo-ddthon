# CG-07 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약 해석은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, 최신 Claude 실행 결정은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`입니다. 선행 과제의 실제 코드와 테스트를 사용합니다.

### CG-07 근거 자료의 미확인 등록과 버전에 고정한 사람의 확인

**구현 묶음**: B-01입니다. **선행**: CG-06입니다.

**연결 기준**: M-006, M-007, M-047, US-003, ENT-05, ENT-06, ENT-21, ENT-22, ENT-34, ENT-35, SCN-01, SCN-09, SCN-14, SCN-20, NQ-05, NQ-06, NQ-07, NQ-09, NQ-10, NQ-18, NQ-22, ND-01, ND-02, ND-03, ND-07, ND-14, INF-02, INF-04, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | 실제 조회가 화면에 필요한 내용·참조·현재성을 구체 타입으로 반환하게 보완합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 공개 메서드 계약을 검사합니다. |
| `src/application/sr-context-service.ts` | 갱신합니다. | M-006/M-007의 자료 등록·확인 버전과 ReviewImpact를 연결합니다. |
| `src/persistence/context-source-repository.ts` | 생성합니다. | ContextSource와 불변 ContextSourceVersion을 저장합니다. |
| `src/domain/review-impact.ts` | 갱신합니다. | 근거의 내용·확인 변경과 영향 없는 표시명 변경을 구분합니다. |
| `tests/integration/context-source.test.ts` | 생성합니다. | 미확인 링크·사람 확인·이전 버전·다른 SR 참조를 검사합니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | 자료 확인의 필수 근거·버전·권한 계약을 추가합니다. |

**조회 연결 보완**: `aidlc-docs/construction/planrepo/code/view-readiness.md`의 이 과제 항목을 실제 저장 조회와 DTO에 함께 반영합니다. 필요한 main·HTTP handlers·TestApp·workspace-query-service의 실제 소비 연결도 변경 diff에 포함합니다.

**인터페이스와 입력 조건**

공통 invoke는 {actorId,projectId,srId?,requestId?,idempotencyKey?,guard?}를 받고 서버가 ActorContext/TargetScope를 검증합니다. 성공의 disposition·receipt·current와 거절의 priorReceipt를 보존합니다. demoCase는 승인 DEMO-4 manifest의 ID/입력만 반환하고 currentCase/currentReviewInput은 현재 자료를 읽는 typed helper입니다. 이 helper는 업무 자료를 쓰거나 승인·전환 성공을 대신하지 않습니다. helper의 필드와 wire DTO는 CONTRACT에서 ENT/M 원문에 맞춰 고정합니다. 아래 코드는 구현 시 실행할 대표 RED이며 지금 실행한 결과가 아닙니다. SourceInput은 text/markdown/link별 필수 내용·출처를 받고 link이면 targetUrl과 확인 가능 여부를 기록합니다. SourceConfirmation은 정확한 기존 source version과 사람이 남긴 confirmationEvidence를 연결합니다. confirmedBy/confirmedAt은 서버가 결정합니다.

- [x] **Step 037: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput } from '@/tests/helpers/domain-cases';

it('링크 등록은 미확인이며 확인해도 이전 버전은 바뀌지 않습니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('PAY-102');
    const scope = { actorId: c.ownerId, projectId: c.projectId, srId: c.srId,
      requestId: 'source-1', idempotencyKey: 'source-1' };
    const detail = await app.invoke('M-047', scope, {});
    if (!detail.ok) throw new Error('현재 SR 조회에 실패했습니다.');
    const result = await app.invoke('M-006', { ...scope, guard: { resource: {
      target: { kind: 'sr', projectId: c.projectId, srId: c.srId, entityId: c.srId },
      expectedRevision: detail.value.sr.revision,
    } } }, {
      kind: 'link', targetUrl: 'https://example.invalid/reference',
      provenance: '사용자가 추가한 가상 근거입니다.', verifiable: false
    });
    expect(result.ok).toBe(true);
    const fresh = await currentCase(app, c);
    const source = fresh.sources.find(item => item.targetUrl === 'https://example.invalid/reference');
    expect(source?.confirmation).toBe('unconfirmed');
    expect(source?.confirmedBy).toBeUndefined();
    if (!source) throw new Error('등록한 근거가 없습니다.');
    const originalRef = source.currentVersionRef;
    const confirmed = await app.invoke('M-007', { ...scope, requestId: 'source-2',
      idempotencyKey: 'source-2', guard: { resource: {
        target: { kind: 'context_source', projectId: c.projectId, srId: c.srId,
          entityId: source.sourceId }, expectedRevision: source.revision,
      } } }, {
      sourceVersionRef: originalRef,
      confirmationEvidence: '사용자가 별도로 제공한 가상 확인 요약입니다.'
    });
    expect(confirmed.ok).toBe(true);
    const rows = app.db.prepare('SELECT version, confirmation FROM context_source_versions WHERE project_id = ? AND sr_id = ? AND source_id = ? ORDER BY version')
      .all(c.projectId, c.srId, source.sourceId);
    expect(rows).toEqual([{ version: 1, confirmation: 'unconfirmed' }, { version: 2, confirmation: 'confirmed' }]);
  } finally {
    await app.close();
  }
});
```

- [x] **Step 038: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/context-source.test.ts
```

예상 결과는 다음과 같습니다. 링크를 자동 confirmed로 저장하거나 M-007이 이전 레코드만 덮어써 불변 버전 두 개의 단언이 실패합니다.

- [x] **Step 039: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

M-006은 서버에서 unconfirmed로 시작하며 링크 존재·모델 주장만으로 확인 필드를 채우지 않습니다. M-007은 현재 담당자·동일 SR·기대 revision·대상 source version·확인 근거를 검사합니다. 새 ContextSourceVersion과 currentVersionRef, 관련 ReviewImpact·활동·receipt를 함께 확정합니다. 단순 displayName 변경은 source 내용과 확인 결과가 같으면 epoch를 바꾸지 않습니다. 확인 불가능한 외부 링크의 내용을 자동 수집하지 않습니다.

- [x] **Step 040: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/context-source.test.ts
npm run typecheck
```

통과 조건은 다음과 같습니다. 등록/확인의 두 버전, 과거 bundle의 옛 근거 상태, 오래된 확인과 다른 SR 버전 거절, 영향받는 게이트 무효화 및 원자성 검증이 통과합니다.

- [x] **Step 041: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 042: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-003 C1~C3와 기본 source scope·기록 경계를 통과합니다. 추후 생성 fingerprint와 검토 묶음은 같은 ContextSourceVersion refs를 사용합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
