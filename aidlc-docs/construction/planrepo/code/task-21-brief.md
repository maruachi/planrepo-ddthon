# CG-21 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

### CG-21 불변 Handoff 생성·미리보기·현재용 내보내기와 receipt 재검사

**구현 묶음**: B-05입니다. **선행**: CG-05, CG-09, CG-15, CG-20입니다.

**연결 기준**: M-040, M-041, M-042, M-015, M-047, US-031, ENT-08, ENT-09, ENT-12, ENT-14, ENT-15, ENT-18, ENT-20, ENT-21, ENT-22, ENT-32, ENT-34, ENT-35, SCN-14, SCN-18, SCN-20, SCN-21, NQ-05, NQ-06, NQ-07, NQ-08, NQ-09, NQ-17, NQ-20, NQ-22, ND-01, ND-02, ND-03, ND-05, ND-12, ND-14, INF-02, INF-04, INF-05, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | 실제 조회가 화면에 필요한 내용·참조·현재성을 구체 타입으로 반환하게 보완합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 공개 메서드 계약을 검사합니다. |
| `src/application/handoff-implementation-service.ts` | 생성합니다. | M-040/M-041/M-042의 현재 기준 검사와 고정 결과를 조정합니다. |
| `src/presentation/handoff-serializer.ts` | 생성합니다. | 명시된 불변 snapshot만으로 Markdown·UTF-8 bytes·digest를 만듭니다. |
| `src/persistence/handoff-repository.ts` | 생성합니다. | 고정 Handoff·정확한 G1/G2·승인/문서 refs와 receipt를 함께 저장합니다. |
| `tests/integration/handoff-current-export.test.ts` | 생성합니다. | 고정 bytes·무효 후 내보내기/receipt 거절·생성 경쟁을 검사합니다. |
| `tests/contract/handoff-serialization.test.ts` | 생성합니다. | 8 MiB 경계·한글·비밀 canary와 원문 일치를 검사합니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | S-08 생성/미리보기/현재용 내보내기와 과거 이력 구분을 정리합니다. |
| `aidlc-docs/construction/planrepo/code/repository-summary.md` | 갱신합니다. | 고정 bytes와 불변 refs의 저장 책임을 추가합니다. |
| `src/web/components/HandoffPanel.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `tests/e2e/bundles/handoff.spec.ts` | 생성합니다. | 같은 묶음의 실제 서버·DB·브라우저 경로와 주요 키보드 행동을 검증합니다. |
| `tests/live/claude-handoff.test.ts` | 생성합니다. | 실제 Claude 질문·답변·후속 생성·사람 적용·G1/G2·Handoff의 AC-17 전체 흐름입니다. |
| `vitest.claude-handoff.config.ts` | 생성합니다. | 실제 Handoff 수용 테스트만 명시 실행하며 자동 retry를 하지 않습니다. |

**조회 연결 보완**: `aidlc-docs/construction/planrepo/code/view-readiness.md`의 이 과제 항목을 실제 저장 조회와 DTO에 함께 반영합니다. 필요한 main·HTTP handlers·TestApp·workspace-query-service의 실제 소비 연결도 변경 diff에 포함합니다.

**인터페이스와 입력 조건**

scope는 actorId/projectId/srId와 요청별 requestId/idempotencyKey/guard를 사용합니다. helper는 fixture의 제한된 ID·검증된 문서 입력과 현재 저장 상태를 읽기만 합니다. 모든 실제 변경·승인·전환은 아래 M 메서드로 호출하며 helper가 성공 상태를 DB에 주입하지 않습니다. DTO 필드 이름은 CONTRACT에서 ENT/M의 의미에 맞춰 고정합니다. 대표 RED는 구현 시 실행할 코드이며 현재 실행 결과가 아닙니다. HandoffRequest는 정확한 g2BundleRef이며 서버가 그 묶음의 g1BundleRef와 승인/문서/질문/결정/후속 범위/검증 내용을 고정합니다. preview의 markdownSnapshot과 export bytes는 동일합니다. M-042 같은 key 재생도 현재 게이트/기준을 먼저 확인하며 무효이면 priorReceipt와 현재 거절을 구분합니다. 실제 Claude AC-17은 별도 B-05 통합 실행 증거가 필요합니다.

비AI 인계 구현은 독립적으로 진행할 수 있습니다. 실제 AC-17 검증과 이 과제의 전체 완료는 CG-15의 실제 후보 검증 증거를 선행 조건으로 삼으며, 그 증거가 없으면 해당 검증과 완료 체크박스를 미완료로 둡니다.


대표 테스트의 helper는 구현할 읽기 전용 fixture입니다. 기존 currentCase(app.db, c.key)를 실제 DTO와 저장 조회로 확장합니다. currentGateGuard(app.db, scope, gate)는 그 gate의 RevisionGuard<review_gate_state>를 읽고, currentArtifactEdit(app.db, c, kind)는 현재 문서의 targetBasis·구조를 유지한 typed 수정 입력을 만듭니다. helper는 업무 상태를 직접 쓰지 않습니다. 아래 예제는 아직 실행한 검증이 아니며 각 과제에서 실제 테스트를 작성하고 RED를 확인합니다.

- [ ] **Step 121: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput, currentGateGuard, currentArtifactEdit } from '@/tests/helpers/domain-cases';

it('한 번 성공한 export key도 게이트 무효 후에는 현재용 다운로드를 허용하지 않습니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('NOTI-028');
    let now = await currentCase(app.db, c.key);
    const scope = { actorId: c.ownerId, projectId: c.projectId, srId: c.srId };
    expect((await app.invoke('M-040', { ...scope, requestId: 'handoff-create',
      idempotencyKey: 'handoff-create', guard: { expectedBundleRef: now.gates.G2.currentBundle.ref, expectedReviewEpoch: now.gates.G2.currentBundle.reviewEpoch } },
      { g2BundleRef: now.gates.G2.currentBundle.ref })).ok).toBe(true);
    now = await currentCase(app.db, c.key);
    const handoff = now.latestHandoff;
    const preview = await app.invoke('M-041', scope, handoff.handoffRef.entityId);
    const exportScope = { ...scope, requestId: 'export-1', idempotencyKey: 'export-1',
      guard: { expectedBundleRef: now.gates.G2.currentBundle.ref, expectedReviewEpoch: now.gates.G2.currentBundle.reviewEpoch } };
    const first = await app.invoke('M-042', exportScope, handoff.handoffRef.entityId);
    expect(first).toMatchObject({ ok: true, disposition: 'Committed' });
    expect((await app.invoke('M-015', { ...scope, requestId: 'invalidate-export',
      idempotencyKey: 'invalidate-export', guard: { resource: { target: { kind: 'artifact', projectId: c.projectId, srId: c.srId, entityId: now.implementationPlan.versionRef.entityId }, expectedRevision: now.implementationPlan.revision } } }, currentArtifactEdit(app.db, c, 'implementation_plan'))).ok).toBe(true);
    const rejected = await app.invoke('M-042', { ...exportScope, requestId: 'export-2' }, handoff.handoffRef.entityId);
    expect(rejected).toMatchObject({ ok: false, error: { code: 'GATE_BLOCKED' } });
    if (!rejected.ok) expect(rejected.priorReceipt).toBeDefined();
    const past = await app.invoke('M-041', scope, handoff.handoffRef.entityId);
    expect(preview.ok && past.ok).toBe(true);
    expect((await currentCase(app.db, c.key)).handoffs.find(item =>
      item.handoffRef.entityId === handoff.handoffRef.entityId)?.markdownSnapshot).toBe(handoff.markdownSnapshot);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 122: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/handoff-current-export.test.ts
```

예상 결과는 다음과 같습니다. receipt를 먼저 무조건 성공 재생하거나 현재 포인터로 인계 본문을 다시 조합하는 구현에서 무효 export 거절 또는 고정 원문 단언이 실패합니다.

- [ ] **Step 123: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

1) 일관된 읽기로 불변 후보 refs/내용을 복사합니다. 2) tx 밖에서 필수 내용과 정확한 8 MiB 이하 Markdown/bytes/digest를 만듭니다. 3) BEGIN IMMEDIATE에서 현재 권한·같은 refs·유효 G1/G2·epoch를 다시 검사한 뒤 Handoff/활동/receipt를 저장합니다. M-042는 현재 유효성을 확정한 시점의 고정 bytes를 반환하고 네트워크 송신/backpressure는 tx 밖에서 처리합니다. M-041은 과거 원문을 유지하면서 현재 유효성을 따로 반환합니다. 다른 요청의 성공을 새 전환이나 새 유효 인계로 재사용하지 않습니다.

실제 AC-17 통합은 tests/live/claude-handoff.test.ts가 RUN_LIVE의 검증된 후보와 가상 입력을 사용합니다. M-032 질문 생성, M-018 사람 적용, M-008 답변, 현재 답변을 넣은 후속 문서 생성·적용, M-009 해결·M-012 결정, G1/G2의 현재 묶음별 사람 검토/승인/전환, M-040/M-041/M-042 인계까지 실제 서비스로 연결합니다. 초기 승인 fixture나 test adapter로 누락된 전환을 대신하지 않습니다. 부족한 모델 결과는 실패·미실행 근거로 남기고 무제한 재호출하지 않습니다.

- [ ] **Step 124: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/handoff-current-export.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/bundles/handoff.spec.ts
npm exec -- vitest run --config vitest.claude-handoff.config.ts tests/live/claude-handoff.test.ts
```

통과 조건은 다음과 같습니다. 고정 원문/bytes/digest, 8 MiB 정확 경계·초과 거절, 같은 생성/내보내기 동시 재생, 후보 읽기 뒤 기준 변경, 과거 미리보기 보존, invalid 후 receipt 우회 거절·canary 비노출이 통과합니다.

- [ ] **Step 125: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 126: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-031 C1~C4의 서비스·직렬화 기준을 통과합니다. C5/AC-17/SCN-18은 실제 Claude의 질문·사람 답변·후속 생성·적용·G1/G2·Handoff 통합을 별도 실행한 뒤에만 완료합니다. 테스트 adapter 성공으로 대체하지 않습니다.

이 묶음의 화면과 tests/e2e/bundles/handoff.spec.ts도 연결합니다. 서비스 테스트만으로 해당 스토리의 UI 기준을 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
