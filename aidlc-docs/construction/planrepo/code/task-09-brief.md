# CG-09 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

### CG-09 질문·답변·결정 기본 경로와 문서 버전·초안 적용

**구현 묶음**: B-02입니다. **선행**: CG-05, CG-06, CG-07, CG-08입니다.

**연결 기준**: M-008, M-010, M-012, M-015, M-016, M-018, M-019, US-004, US-007, US-009, US-011, US-012, ENT-07, ENT-08, ENT-10, ENT-11, ENT-12, ENT-13, ENT-14, ENT-26, ENT-27, ENT-30, ENT-31, SCN-02, SCN-03, SCN-15, SCN-16, NQ-06, NQ-07, NQ-08, NQ-11, NQ-17, NQ-18, ND-01, ND-02, ND-03, ND-06, ND-07, ND-12, INF-04, INF-06입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | 실제 조회가 화면에 필요한 내용·참조·현재성을 구체 타입으로 반환하게 보완합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 공개 메서드 계약을 검사합니다. |
| `src/persistence/question-decision-repository.ts` | 생성합니다. | M-008/M-010/M-012와 초안 적용의 질문·답변·미확정/확정 결정·현재 결과를 같은 트랜잭션에서 저장합니다. |
| `src/application/question-decision-service.ts` | 생성합니다. | 답변·후속 질문·미확정 결정과 사람 확정 기본 처리입니다. |
| `config/generation/project-rules.json` | 생성합니다. | 승인 제품 규칙의 자체 완결 요약과 명시적 규칙 ID를 둡니다. |
| `src/runtime/project-rule-source.ts` | 생성합니다. | 프로젝트 루트 자산을 검증하고 내용 기반의 안정 버전으로 제공합니다. |
| `src/persistence/migrations/0002-input-snapshot-supplement.ts` | 생성합니다. | 기존 snapshot을 보존하며 supplement 열을 추가하고 알려진 이전 설계 단계 표기를 정규화합니다. |
| `src/persistence/migrations/index.ts` | 생성합니다. | SQL checksum을 유지하는 순차 migration registry입니다. |
| `src/persistence/maintenance.ts` | 갱신합니다. | 최신 registry의 offline migration과 supported schema 검사를 사용합니다. |
| `tests/integration/snapshot-supplement-migration.test.ts` | 생성합니다. | 기존 version 1 자료를 보존한 upgrade와 불변 snapshot round trip을 검사합니다. |
| `tests/unit/generation-snapshot.test.ts` | 생성합니다. | canonical 순서·원문·규칙·입력 기준·제외 메타데이터를 검사합니다. |
| `src/application/generation-snapshot.ts` | 생성합니다. | 초안 적용·사람 검토·생성 준비가 공유하는 현재 입력 canonical envelope와 fingerprint입니다. |
| `src/persistence/generation-input-repository.ts` | 생성합니다. | 같은 SR의 현재 입력·규칙·run/draft 기준을 쓰기 없는 일관된 읽기로 제공합니다. |
| `src/contracts/methods.ts` | 갱신합니다. | 기존 M-047의 선택적 생성 준비 조회 입력을 연결합니다. |
| `src/contracts/schemas.ts` | 갱신합니다. | 빈 상세 입력 호환과 준비 대상별 판별 입력을 검증합니다. |
| `tests/unit/artifact-rules.test.ts` | 생성합니다. | 문서 원문·구조 참조·absent/version 기준을 검증합니다. |
| `tests/unit/documents.test.ts` | 생성합니다. | 비교 원문의 보존과 안전한 표시 경계를 검사합니다. |
| `src/application/artifact-service.ts` | 생성합니다. | M-015/M-016/M-017/M-018/M-019와 현재성 검사입니다. |
| `src/persistence/artifact-repository.ts` | 생성합니다. | ArtifactVersion·현재 참조·적용 이력의 원자적 저장입니다. |
| `src/domain/artifact-rules.ts` | 생성합니다. | 종류·고유 ID·absent/existing guard·범위·변경 영향 검사입니다. |
| `src/domain/artifact-target.ts` | 생성합니다. | 문서 종류와 설계 단계의 정확한 logical key를 생성·판별하는 공통 순수 함수입니다. |
| `src/persistence/seed-demo.ts` | 갱신합니다. | 새 시드의 design_stage를 기존 계약의 functional로 맞춥니다. |
| `src/presentation/documents.ts` | 생성합니다. | 안전한 표시와 원문을 보존하는 비교입니다. |
| `src/web/components/ArtifactWorkspace.tsx` | 생성합니다. | UI-12의 편집·원문·저장 입력입니다. |
| `src/web/components/VersionComparison.tsx` | 생성합니다. | UI-14의 고정 버전 원문 비교입니다. |
| `src/web/components/QuestionPanel.tsx` | 생성합니다. | UI-09 답변·후속 질문 기본 행동입니다. |
| `src/web/components/DecisionPanel.tsx` | 생성합니다. | UI-10 확정 권한과 선택·근거입니다. |
| `src/web/components/DraftReview.tsx` | 생성합니다. | UI-20 현재/오래된 초안의 사람 검토·적용입니다. |
| `tests/integration/artifact-edit.test.ts` | 생성합니다. | absent 경합·새 버전·원문·현재성·적용 중복을 검사합니다. |
| `tests/helpers/editor-fixture.ts` | 생성합니다. | createEditorFixture(app)로 같은 SR의 유효한 편집/초안 fixture와 typed 요청을 제공합니다. |

**조회 연결 보완**: `aidlc-docs/construction/planrepo/code/view-readiness.md`의 이 과제 항목을 실제 저장 조회와 DTO에 함께 반영합니다. 필요한 main·HTTP handlers·TestApp·workspace-query-service의 실제 소비 연결도 변경 diff에 포함합니다.

**편집 선행 보완**: `aidlc-docs/construction/planrepo/code/implementation-decisions.md` 15·16·18을 따릅니다. 질문/결정 저장소를 이 과제에서 만들고 M-018 결과의 정확한 문서 버전 또는 temporaryId/서버 ID 매핑을 DTO·저장·재생 테스트에 포함합니다.

**인터페이스와 입력 조건**

CG-09 연결 시 결정 24의 문서 logical key를 공통으로 사용합니다. requirements/workflow_plan/implementation_plan과 design:application/design:functional/design:nfr/design:infrastructure를 구분합니다. 다른 단계의 design이 있다는 이유로 새 design target을 거절하지 않습니다. ARTIFACT_REVISION은 정확한 참조에서 현재 종류·단계를 읽습니다. 기존 seed의 design_stage=functional_design은 계약의 functional로 수정하고 0002 migration의 알려진 이전 표기 정규화도 실제 upgrade 테스트에 포함합니다. M-017 공개 예시의 guard와 input targetBasis도 workflow_plan으로 맞춥니다.



생성 입력의 participants에는 현재 SR ownerId와 같은 프로젝트 현재 멤버의 userId·displayName을 고정합니다. 역할·인증 capability는 포함하지 않으며 canonical 지문과 InputSnapshot에 같은 값을 사용합니다. 질문 제안의 suggestedAssigneeId는 이 명시 후보에서 선택하고 실제 적용은 현재 멤버십을 다시 검사합니다. 결정 25와 새 SR의 실제 준비 조회 회귀를 함께 따릅니다.


M-019는 사람이 본 원 초안의 preparation.currentInputFingerprint를 잠금 안에서 검사합니다. 새 검토 초안은 현재 본문·참조·규칙과 현재 문서 target을 별도 InputSnapshot으로 고정합니다. 원 ARTIFACT_DRAFT의 absent 대상에 문서가 생겼으면 명시적인 사람 비교 이후 만든 새 검토 초안만 ARTIFACT_REVISION으로 기록하며 원 실행·원 초안·원 snapshot은 바꾸지 않습니다. 새 fingerprint는 정규화한 현재 입력으로 계산하므로 원 초안 preparation의 검사용 지문과 다를 수 있습니다. 반면 M-035 retry는 absent 작업을 revision으로 자동 전환하지 않고 새 M-032를 요구합니다. 기존 ARTIFACT_REVISION retry는 현재 exact version을 대상으로 새 입력·지문을 준비합니다.

초안 적용은 결정 26을 따릅니다. decisions는 selections의 각 temporaryId·decisionMakerId·classification을 사람이 지정합니다. artifact는 selectedContent.edit의 완전한 편집 입력을 받고 edit.targetBasis만 사용합니다. WorkflowPlan 구조는 명시적으로 검증하며 Markdown으로 추정하지 않습니다. M-017의 1:1 저장은 이 과제에서 연결하고 CG-20의 필수 정책·G2 전체 검증은 유지합니다.

초안 화면의 영속 조회는 결정30을 따릅니다. M047 상세의 작은 generationDrafts 목록에서 원 provider 초안과 human_review 초안을 고르고, 기존 kind=draft 준비 조회의 선택 DraftView/InputSnapshot으로 고정 입력을 읽습니다. 페이지 재개방 뒤 조회·적용과 조회 무변경을 실제 HTTP/E2E로 검증합니다. 새 endpoint와 브라우저 DB 접근을 추가하지 않습니다.

saveArtifact(ctx, ArtifactEdit)와 applyDraft(ctx, DraftApplication)는 승인 M-015/M-018 계약을 구현합니다. createEditorFixture(app): Promise<{scope: InvokeScope; edit: ArtifactEdit; competingEdit: ArtifactEdit}>는 같은 absent 대상·동일 guard·서로 다른 idempotencyKey의 두 제출을 만듭니다. 입력의 key는 InvokeScope에서 나누고 ArtifactEdit은 본문·참조만 유지합니다. 가상 성공 Run fixture는 적용 테스트의 시작 조건이며 실제 생성 통과로 세지 않습니다.

- [x] **Step 049: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { createEditorFixture } from '@/tests/helpers/editor-fixture';

test('같은 absent 문서를 동시에 만들면 하나만 확정한다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const fixture = await createEditorFixture(app);
    const results = await Promise.all([
      app.invoke('M-015', { ...fixture.scope, idempotencyKey: 'edit-a' }, fixture.edit),
      app.invoke('M-015', { ...fixture.scope, idempotencyKey: 'edit-b' }, fixture.competingEdit),
    ]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok && result.error.code === 'STALE_VERSION')).toHaveLength(1);
  } finally { await app.close(); }
});
```

- [x] **Step 050: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/artifact-edit.test.ts
```

예상 결과는 다음과 같습니다. 실제 absent 경쟁에서 중복 Artifact가 생기거나 비교 없이 두 요청을 수락하면 실패합니다.

- [x] **Step 051: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

입력 본문을 bytes로 검사하고 구조 색인과 원문 ID를 대조합니다. BEGIN IMMEDIATE 안에서 현재 권한·guard·receipt·input fingerprint를 재확인한 뒤 새 버전·현재 포인터·ReviewImpact·요청 승계·활동·receipt를 같이 저장합니다. 순수 비교·Markdown 변환은 트랜잭션 밖에서 수행하고 적용 직전 basis를 다시 확인합니다.

```ts
export function matchesArtifactBasis(
  current: number | undefined,
  expected: { kind: 'absent' } | { kind: 'version'; version: number },
): boolean {
  return expected.kind === 'absent' ? current === undefined : current === expected.version;
}
```

matchesArtifactBasis는 artifact-rules.ts가 제공하는 순수 함수입니다. 서비스는 승인 WriteGuard를 absent/version 인자로 정규화하고, 잠금 안의 현재 버전과 대조해 false이면 STALE_VERSION을 반환합니다. AI 제안은 미확정 질문·결정 또는 새 문서로만 사람 적용합니다. 오래된 원 실행은 보존하며 M-019로 만든 새 비교 초안도 별도 fingerprint를 검사합니다. 답변 저장은 answered이고 resolved가 아니며 지정 결정권자의 확인만 DecisionVersion을 만듭니다.

- [x] **Step 052: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/artifact-edit.test.ts
```

통과 조건은 다음과 같습니다. 동시 생성 한 건만 확정, 기존 문서 개정·원문 비교·1 MiB 상한·오래된 입력 거절·같은 초안 적용 재생·새 결정 미확정·답변됨/해결됨 구분이 통과합니다.

- [x] **Step 053: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 054: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

B-02 실제 생성에 필요한 질문/답변·문서·사람 적용 화면과 서비스가 연결됩니다. 전체 AI·편집 스토리는 B-06 상호작용 검증 전 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
