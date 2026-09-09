import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/test-app';
import { insertDraftReviewFixture } from '@/tests/helpers/draft-review-fixture';

async function openDraftReview(page: Page, actorId: string, srKey: string) {
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(actorId);
  await page.locator('.sr-card').filter({ hasText: srKey }).getByRole('button', { name: '상세 열기' }).click();
  await page.getByRole('button', { name: '초안 검토', exact: true }).click();
}

test('provider 초안을 고정 입력과 함께 다시 열고 현재 기준으로 한 번만 적용한다', async ({ page, app, manifest }) => {
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  };
  const before = await app.invoke('M-047', scope, {});
  if (!before.ok) throw new Error('SR 상세 fixture를 찾을 수 없습니다.');
  const artifact = before.value.artifacts.find((item) => item.kind === 'requirements');
  if (artifact === undefined) throw new Error('요구사항 fixture를 찾을 수 없습니다.');
  const draft = insertDraftReviewFixture(app, scope, {
    taskKind: 'ARTIFACT_REVISION', documentKind: 'requirements',
    targetBasis: { kind: 'version', ref: artifact.versionRef },
  }, {
    schemaVersion: 1, kind: 'artifact', documentKind: 'requirements',
    markdown: artifact.markdown, requirementRefs: artifact.requirementLinks.map(({ requirementId }) => requirementId),
    changeSummary: 'provider 초안을 사람이 확인합니다.',
  });

  await openDraftReview(page, scope.actorId, 'PAY-102');
  const review = page.getByTestId('draft-review');
  await review.getByRole('button', { name: new RegExp(draft.draftId, 'u') }).click();
  await expect(review).toContainText(`고정 입력 ${draft.snapshotId}`);
  await expect(review).toContainText('provider');
  await expect(review.getByLabel('Markdown 원문')).toHaveValue(artifact.markdown);

  await openDraftReview(page, scope.actorId, 'PAY-102');
  await review.getByRole('button', { name: new RegExp(draft.draftId, 'u') }).click();
  await review.getByLabel('초안 적용 이유').fill('현재 입력과 원문 구조를 사람이 확인했습니다.');
  await review.getByRole('button', { name: '초안 적용' }).click();
  await expect(review.getByText(/초안을 적용했습니다/u)).toBeVisible();

  const after = await app.invoke('M-047', scope, {});
  if (!after.ok) throw new Error('적용 뒤 상세를 읽지 못했습니다.');
  expect(after.value.generationDrafts.find(({ draftId }) => draftId === draft.draftId)?.application)
    .toMatchObject({ kind: 'applied' });
  expect(after.value.artifacts.find(({ artifactId }) => artifactId === artifact.artifactId)?.versionRef.version)
    .toBe(artifact.versionRef.version + 1);

  await openDraftReview(page, scope.actorId, 'PAY-102');
  await expect(review).toContainText('적용됨');
  await review.getByRole('button', { name: new RegExp(draft.draftId, 'u') }).click();
  await expect(review.getByRole('heading', { name: `초안 ${draft.draftId}` })).toBeVisible();
  await expect(review.getByRole('button', { name: '초안 적용' })).toHaveCount(0);
});

test('오래된 absent 초안은 직접 적용하지 않고 사람 검토 초안을 별도로 저장한 뒤 적용한다', async ({ page, app, manifest }) => {
  const key = `DRAFT-${randomUUID().slice(0, 8)}`;
  const registered = await app.invoke('M-003', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
  }, {
    key, title: '오래된 초안 검토', purpose: '현재 target 비교', description: '초안 target 경합을 확인합니다.',
    ownerId: manifest.personaIds['P-01'],
  });
  if (!registered.ok) throw new Error('초안 검토 SR을 만들지 못했습니다.');
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: registered.value.scope.srId,
  };
  const draftMarkdown = '## REQ-DRAFT 원 초안\nREQ-DRAFT는 원 입력 기준입니다.\n';
  const draft = insertDraftReviewFixture(app, scope, {
    taskKind: 'ARTIFACT_DRAFT', documentKind: 'requirements',
    targetBasis: { kind: 'absent', logicalKey: 'requirements' },
  }, {
    schemaVersion: 1, kind: 'artifact', documentKind: 'requirements', markdown: draftMarkdown,
    requirementRefs: ['REQ-DRAFT'], changeSummary: '원 provider 초안',
  });
  const currentMarkdown = '## REQ-CURRENT 현재 문서\nREQ-CURRENT는 먼저 저장됐습니다.\n';
  const occupied = await app.invoke('M-015', {
    ...scope, idempotencyKey: randomUUID(), guard: { resource: { target: {
      kind: 'artifact_logical_key', projectId: scope.projectId, srId: scope.srId, logicalKey: 'requirements',
    }, expected: 'absent' } },
  }, {
    kind: 'requirements', markdown: currentMarkdown,
    sectionIndex: [{ sectionId: 'REQ-CURRENT', title: '현재 문서', startOffset: 0, endOffset: currentMarkdown.length }],
    requirementLinks: [{ requirementId: 'REQ-CURRENT', sectionIds: ['REQ-CURRENT'], acceptanceCriteria: ['현재 문서 기준'] }],
    changeSummary: '현재 문서를 먼저 저장합니다.', targetBasis: { kind: 'absent', logicalKey: 'requirements' },
  });
  if (!occupied.ok) throw new Error('현재 문서를 만들지 못했습니다.');

  await openDraftReview(page, scope.actorId, key);
  const review = page.getByTestId('draft-review');
  await review.getByRole('button', { name: new RegExp(draft.draftId, 'u') }).click();
  await expect(review).toContainText('오래됨');
  await expect(review.getByRole('button', { name: '초안 적용' })).toBeDisabled();
  const reviewedMarkdown = '## REQ-REVIEW 현재 비교 초안\nREQ-REVIEW는 현재 문서와 비교했습니다.\n';
  await review.getByLabel('Markdown 원문').fill(reviewedMarkdown);
  await review.getByLabel('변경 요약').fill('현재 문서와 비교해 초안을 고쳤습니다.');
  await review.getByLabel('요구사항 ID').fill('REQ-REVIEW');
  await review.getByLabel('비교 검토 사유').fill('원 absent 대상에 현재 문서가 생긴 차이를 확인했습니다.');
  await review.getByRole('button', { name: '사람 검토 초안 저장' }).click();
  await expect(review.getByText('사람 검토 초안을 저장했습니다.', { exact: true })).toBeVisible();
  await expect(review).toContainText('human_review');
  await expect(review).toContainText(draft.draftId);
  await expect(review.getByLabel('Markdown 원문')).toHaveValue(reviewedMarkdown);
  await review.getByLabel('섹션 ID', { exact: true }).fill('REQ-REVIEW');
  await review.getByLabel('연결 섹션 ID').fill('REQ-REVIEW');
  await review.getByLabel('수용 기준').fill('현재 문서 기준으로 확인합니다.');
  await review.getByLabel('초안 적용 이유').fill('사람 검토 초안의 구조를 확인했습니다.');
  await review.getByRole('button', { name: '초안 적용' }).click();
  await expect(review.getByText(/초안을 적용했습니다/u)).toBeVisible();

  const detail = await app.invoke('M-047', scope, {});
  if (!detail.ok) throw new Error('검토 초안 적용 결과를 읽지 못했습니다.');
  const human = detail.value.generationDrafts.find((item) => item.provenance.kind === 'human_review');
  expect(human?.application).toMatchObject({ kind: 'applied' });
  expect(detail.value.artifacts.find((item) => item.kind === 'requirements')).toMatchObject({
    markdown: reviewedMarkdown, versionRef: { version: 2 }, authorOrigin: 'ai_applied',
  });
});

test('질문 후보와 결정권자·분류를 사람이 선택하며 적용 결과는 미확정 상태로 남는다', async ({ page, app, manifest }) => {
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  };
  const questionDraft = insertDraftReviewFixture(app, scope, { taskKind: 'QUESTION_PROPOSALS' }, {
    schemaVersion: 1, kind: 'question_proposals', proposals: [{
      temporaryId: 'q-ui', text: '재시도 횟수를 확인합니까?', reason: '예외 정책이 필요합니다.',
      suggestedAssigneeId: manifest.personaIds['P-02'], requiredGate: 'G1', sourceRefs: [],
      candidateAnswers: ['1회', '3회'],
    }],
  });
  await openDraftReview(page, scope.actorId, 'PAY-102');
  const review = page.getByTestId('draft-review');
  await review.getByRole('button', { name: new RegExp(questionDraft.draftId, 'u') }).click();
  await expect(review.getByLabel('질문 q-ui 답변 후보')).toHaveValue('1회\n3회');
  await review.getByLabel('질문 q-ui 적용').check();
  await review.getByLabel('초안 적용 이유').fill('질문 후보와 담당자를 확인했습니다.');
  await review.getByRole('button', { name: '초안 적용' }).click();
  await expect(review.getByText(/초안을 적용했습니다/u)).toBeVisible();
  let detail = await app.invoke('M-047', scope, {});
  if (!detail.ok) throw new Error('질문 적용 결과를 읽지 못했습니다.');
  expect(detail.value.questions).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: '재시도 횟수를 확인합니까?', assigneeId: manifest.personaIds['P-02'], status: 'open' }),
  ]));

  const decisionDraft = insertDraftReviewFixture(app, scope, { taskKind: 'DECISION_PROPOSALS' }, {
    schemaVersion: 1, kind: 'decision_proposals', proposals: [{
      temporaryId: 'd-ui', prompt: '재시도 정책을 선택합니다.', impact: '복구 시간에 영향을 줍니다.',
      alternatives: [
        { optionId: 'once', label: '1회', description: '한 번 재시도합니다.' },
        { optionId: 'three', label: '3회', description: '세 번 재시도합니다.' },
      ],
      recommendation: 'three', sourceRefs: [],
    }],
  });
  await openDraftReview(page, scope.actorId, 'PAY-102');
  await review.getByRole('button', { name: new RegExp(decisionDraft.draftId, 'u') }).click();
  await review.getByLabel('결정 d-ui 적용').check();
  await review.getByLabel('결정권자').selectOption(manifest.personaIds['P-04']);
  await review.getByLabel('분류', { exact: true }).selectOption('current');
  await review.getByLabel('필요 gate').selectOption('G1');
  await review.getByLabel('분류 이유').fill('G1에서 재시도 정책이 필요합니다.');
  await review.getByLabel('초안 적용 이유').fill('결정 대안과 결정권자를 확인했습니다.');
  await review.getByRole('button', { name: '초안 적용' }).click();
  await expect(review.getByText(/초안을 적용했습니다/u)).toBeVisible();
  detail = await app.invoke('M-047', scope, {});
  if (!detail.ok) throw new Error('결정 적용 결과를 읽지 못했습니다.');
  expect(detail.value.decisions).toEqual(expect.arrayContaining([
    expect.objectContaining({ prompt: '재시도 정책을 선택합니다.', decisionMakerId: manifest.personaIds['P-04'], state: 'unconfirmed' }),
  ]));
});

test('WorkflowPlan 초안은 단계 생략 이유와 요구사항·작업·검증·순서를 구조로 적용한다', async ({ page, app, manifest }) => {
  const key = `WORKFLOW-${randomUUID().slice(0, 8)}`;
  const registered = await app.invoke('M-003', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
  }, {
    key, title: '진행 계획 초안', purpose: '구조형 적용', description: '진행 계획 구조를 확인합니다.',
    ownerId: manifest.personaIds['P-01'],
  });
  if (!registered.ok) throw new Error('진행 계획 SR을 만들지 못했습니다.');
  const scope = { actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: registered.value.scope.srId };
  const markdown = '## REQ-WF 진행 계획\nREQ-WF를 작업과 검증에 연결합니다.\n';
  const draft = insertDraftReviewFixture(app, scope, {
    taskKind: 'ARTIFACT_DRAFT', documentKind: 'workflow_plan',
    targetBasis: { kind: 'absent', logicalKey: 'workflow_plan' },
  }, {
    schemaVersion: 1, kind: 'artifact', documentKind: 'workflow_plan', markdown,
    requirementRefs: ['REQ-WF'], changeSummary: '진행 계획 초안',
  });
  await openDraftReview(page, scope.actorId, key);
  const review = page.getByTestId('draft-review');
  await review.getByRole('button', { name: new RegExp(draft.draftId, 'u') }).click();
  await review.getByLabel('수용 기준').fill('작업과 검증을 연결합니다.');
  const stage = review.getByRole('group', { name: '단계 1' });
  await stage.getByLabel('단계 ID').fill('functional-design');
  await stage.getByLabel('처리').selectOption('skipped');
  await stage.getByLabel('생략 이유').fill('기존 설계를 변경하지 않습니다.');
  await review.getByRole('button', { name: '단계 추가' }).click();
  const secondStage = review.getByRole('group', { name: '단계 2' });
  await secondStage.getByLabel('단계 ID').fill('infrastructure-design');
  await secondStage.getByLabel('처리').selectOption('skipped');
  await secondStage.getByLabel('생략 이유').fill('인프라 변경이 없습니다.');
  const task = review.getByRole('group', { name: '작업 1' });
  await task.getByLabel('작업 ID').fill('TASK-WF');
  await task.getByLabel('요구사항 ID').fill('REQ-WF');
  await task.getByLabel('검증').fill('진행 계획 저장을 확인합니다.');
  await task.getByLabel('순서').fill('1');
  await review.getByRole('button', { name: '작업 추가' }).click();
  const secondTask = review.getByRole('group', { name: '작업 2' });
  await secondTask.getByLabel('작업 ID').fill('TASK-VERIFY');
  await secondTask.getByLabel('요구사항 ID').fill('REQ-WF');
  await secondTask.getByLabel('검증').fill('회귀 검사를 실행합니다.');
  await secondTask.getByLabel('순서').fill('2');
  await review.getByLabel('초안 적용 이유').fill('단계와 작업 구조를 확인했습니다.');
  await review.getByRole('button', { name: '초안 적용' }).click();
  await expect(review.getByText(/초안을 적용했습니다/u)).toBeVisible();
  const detail = await app.invoke('M-047', scope, {});
  if (!detail.ok) throw new Error('WorkflowPlan 적용 결과를 읽지 못했습니다.');
  expect(detail.value.artifacts.find((item) => item.kind === 'workflow_plan')).toMatchObject({
    workflowVersion: 'v1.0.1',
    stages: [
      { stageId: 'functional-design', choice: 'skipped', reason: '기존 설계를 변경하지 않습니다.' },
      { stageId: 'infrastructure-design', choice: 'skipped', reason: '인프라 변경이 없습니다.' },
    ],
    requirementTaskLinks: [
      { taskId: 'TASK-WF', requirementIds: ['REQ-WF'], verification: ['진행 계획 저장을 확인합니다.'], order: 1 },
      { taskId: 'TASK-VERIFY', requirementIds: ['REQ-WF'], verification: ['회귀 검사를 실행합니다.'], order: 2 },
    ],
  });
});

test('SR owner가 아닌 멤버는 고정 초안을 읽지만 검토 저장과 적용 입력을 사용할 수 없다', async ({ page, app, manifest }) => {
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  };
  const draft = insertDraftReviewFixture(app, scope, { taskKind: 'QUESTION_PROPOSALS' }, {
    schemaVersion: 1, kind: 'question_proposals', proposals: [{
      temporaryId: 'q-readonly', text: '읽기 전용 질문입니까?', reason: '권한 경계를 확인합니다.',
      suggestedAssigneeId: manifest.personaIds['P-02'], requiredGate: 'G2', sourceRefs: [], candidateAnswers: [],
    }],
  });
  await openDraftReview(page, manifest.personaIds['P-02'], 'PAY-102');
  const review = page.getByTestId('draft-review');
  await review.getByRole('button', { name: new RegExp(draft.draftId, 'u') }).click();
  await expect(review).toContainText('읽기 전용 질문입니까?');
  await expect(review).toContainText('현재 SR owner만 검토 초안을 저장하거나 적용할 수 있습니다.');
  await expect(review.getByLabel('질문 q-readonly 적용')).toBeDisabled();
  await expect(review.getByRole('button', { name: '사람 검토 초안 저장' })).toHaveCount(0);
  await expect(review.getByRole('button', { name: '초안 적용' })).toHaveCount(0);
});

test('M-019 지연 응답 중 바꾼 원문을 보존하고 같은 요청 결과를 재조회한다', async ({ page, app, manifest }) => {
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  };
  const detail = await app.invoke('M-047', scope, {});
  if (!detail.ok) throw new Error('지연 검사의 SR 상세가 없습니다.');
  const artifact = detail.value.artifacts.find((item) => item.kind === 'requirements');
  if (artifact === undefined) throw new Error('지연 검사의 요구사항이 없습니다.');
  const draft = insertDraftReviewFixture(app, scope, {
    taskKind: 'ARTIFACT_REVISION', documentKind: 'requirements',
    targetBasis: { kind: 'version', ref: artifact.versionRef },
  }, {
    schemaVersion: 1, kind: 'artifact', documentKind: 'requirements', markdown: artifact.markdown,
    requirementRefs: artifact.requirementLinks.map(({ requirementId }) => requirementId), changeSummary: '지연 검토 초안',
  });
  await openDraftReview(page, scope.actorId, 'PAY-102');
  const review = page.getByTestId('draft-review');
  await review.getByRole('button', { name: new RegExp(draft.draftId, 'u') }).click();
  await review.getByLabel('비교 검토 사유').fill('제출할 비교 검토 사유입니다.');

  let release!: () => void;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  const responseRelease = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/methods/M-019', async (route) => {
    started();
    await responseRelease;
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  const submission = review.getByRole('button', { name: '사람 검토 초안 저장' }).click();
  await requestStarted;
  const changedMarkdown = `${artifact.markdown}\n응답 대기 중 새로 작성한 원문입니다.\n`;
  await review.getByLabel('Markdown 원문').fill(changedMarkdown);
  release();
  await submission;
  await expect(review.getByLabel('Markdown 원문')).toHaveValue(changedMarkdown);
  await expect(review).toContainText('현재 편집은 유지했습니다.');
  await page.unroute('**/api/methods/M-019');

  const reopened = await app.invoke('M-047', scope, {});
  if (!reopened.ok) throw new Error('지연 저장 결과를 읽지 못했습니다.');
  expect(reopened.value.generationDrafts.some((item) => item.provenance.kind === 'human_review' &&
    item.provenance.sourceDraftId === draft.draftId)).toBe(true);
});

test('M-019 409 뒤 dirty 원문을 보존하고 최신 기준 직접 폐기 후 새 guard로 저장한다', async ({ page, app, manifest }) => {
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  };
  const initial = await app.invoke('M-047', scope, {});
  if (!initial.ok) throw new Error('충돌 검사의 SR 상세가 없습니다.');
  const artifact = initial.value.artifacts.find((item) => item.kind === 'requirements');
  if (artifact === undefined) throw new Error('충돌 검사의 요구사항이 없습니다.');
  const draft = insertDraftReviewFixture(app, scope, {
    taskKind: 'ARTIFACT_REVISION', documentKind: 'requirements',
    targetBasis: { kind: 'version', ref: artifact.versionRef },
  }, {
    schemaVersion: 1, kind: 'artifact', documentKind: 'requirements', markdown: artifact.markdown,
    requirementRefs: artifact.requirementLinks.map(({ requirementId }) => requirementId), changeSummary: '충돌 검토 초안',
  });
  await openDraftReview(page, scope.actorId, 'PAY-102');
  const review = page.getByTestId('draft-review');
  await review.getByRole('button', { name: new RegExp(draft.draftId, 'u') }).click();
  const dirtyMarkdown = `${artifact.markdown}\n충돌 뒤에도 보존할 원문입니다.\n`;
  await review.getByLabel('Markdown 원문').fill(dirtyMarkdown);
  await review.getByLabel('비교 검토 사유').fill('충돌 전 비교 사유입니다.');

  const changed = await app.invoke('M-005', {
    ...scope, idempotencyKey: randomUUID(), guard: { resource: { target: {
      kind: 'sr', projectId: scope.projectId, srId: scope.srId, entityId: scope.srId,
    }, expectedRevision: initial.value.sr.revision } },
  }, {
    title: initial.value.currentDescription.title,
    purpose: initial.value.currentDescription.purpose,
    description: `${initial.value.currentDescription.description}\n동시 변경입니다.`,
    changeReason: '초안 입력 fingerprint 충돌을 만듭니다.',
  });
  expect(changed.ok).toBe(true);
  await review.getByRole('button', { name: '사람 검토 초안 저장' }).click();
  await expect(review.getByRole('alert')).toContainText('입력');
  await expect(review.getByLabel('Markdown 원문')).toHaveValue(dirtyMarkdown);
  await expect(review.locator('.basis-comparison')).toContainText('최신 초안 기준');
  await review.getByRole('button', { name: '작성 중 초안 폐기' }).click();
  await expect(review.getByLabel('Markdown 원문')).toHaveValue(artifact.markdown);
  await review.getByLabel('비교 검토 사유').fill('최신 입력 기준으로 다시 검토했습니다.');
  await review.getByRole('button', { name: '사람 검토 초안 저장' }).click();
  await expect(review.getByText('사람 검토 초안을 저장했습니다.', { exact: true })).toBeVisible();
});

test('M-019 전송 결과가 불명확하면 같은 idempotency key로 확인한다', async ({ page, app, manifest }) => {
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  };
  const detail = await app.invoke('M-047', scope, {});
  if (!detail.ok) throw new Error('재시도 검사의 SR 상세가 없습니다.');
  const artifact = detail.value.artifacts.find((item) => item.kind === 'requirements');
  if (artifact === undefined) throw new Error('재시도 검사의 요구사항이 없습니다.');
  const draft = insertDraftReviewFixture(app, scope, {
    taskKind: 'ARTIFACT_REVISION', documentKind: 'requirements', targetBasis: { kind: 'version', ref: artifact.versionRef },
  }, {
    schemaVersion: 1, kind: 'artifact', documentKind: 'requirements', markdown: artifact.markdown,
    requirementRefs: artifact.requirementLinks.map(({ requirementId }) => requirementId), changeSummary: '재시도 검토 초안',
  });
  await openDraftReview(page, scope.actorId, 'PAY-102');
  const review = page.getByTestId('draft-review');
  await review.getByRole('button', { name: new RegExp(draft.draftId, 'u') }).click();
  await review.getByLabel('비교 검토 사유').fill('불명확 결과를 같은 요청으로 확인합니다.');
  const keys: string[] = [];
  let first = true;
  await page.route('**/api/methods/M-019', async (route) => {
    const request = route.request().postDataJSON() as { readonly meta: { readonly idempotencyKey: string } };
    keys.push(request.meta.idempotencyKey);
    if (first) {
      first = false;
      await route.abort('connectionfailed');
    } else {
      await route.continue();
    }
  });
  await review.getByRole('button', { name: '사람 검토 초안 저장' }).click();
  await expect(review.getByRole('alert')).toContainText('확인할 수 없습니다.');
  await review.getByRole('button', { name: '같은 검토 저장 결과 확인' }).click();
  await expect(review.getByText('사람 검토 초안을 저장했습니다.', { exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  await page.unroute('**/api/methods/M-019');
});

test('늦은 다른 draft 조회 응답은 현재 선택한 초안 화면을 덮지 않는다', async ({ page, app, manifest }) => {
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  };
  const first = insertDraftReviewFixture(app, scope, { taskKind: 'QUESTION_PROPOSALS' }, {
    schemaVersion: 1, kind: 'question_proposals', proposals: [{
      temporaryId: 'q-first', text: '첫 번째 늦은 질문', reason: '조회 순서를 확인합니다.',
      suggestedAssigneeId: manifest.personaIds['P-02'], requiredGate: 'G1', sourceRefs: [], candidateAnswers: [],
    }],
  });
  const second = insertDraftReviewFixture(app, scope, { taskKind: 'QUESTION_PROPOSALS' }, {
    schemaVersion: 1, kind: 'question_proposals', proposals: [{
      temporaryId: 'q-second', text: '두 번째 현재 질문', reason: '현재 선택을 유지합니다.',
      suggestedAssigneeId: manifest.personaIds['P-03'], requiredGate: 'G2', sourceRefs: [], candidateAnswers: [],
    }],
  });
  await openDraftReview(page, scope.actorId, 'PAY-102');
  const review = page.getByTestId('draft-review');
  let release!: () => void;
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  const firstRelease = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/methods/M-047', async (route) => {
    const body = route.request().postDataJSON() as { readonly input?: { readonly draftId?: string } };
    if (body.input?.draftId === first.draftId) {
      started();
      await firstRelease;
    }
    await route.continue();
  });
  await review.getByRole('button', { name: new RegExp(first.draftId, 'u') }).click();
  await firstStarted;
  await review.getByRole('button', { name: new RegExp(second.draftId, 'u') }).click();
  await expect(review).toContainText('두 번째 현재 질문');
  release();
  await expect(review).toContainText('두 번째 현재 질문');
  await expect(review).not.toContainText('첫 번째 늦은 질문');
  await page.unroute('**/api/methods/M-047');
});

test('M-018 응답을 잃어도 같은 idempotency key의 Replayed 결과로 적용을 확인한다', async ({ page, app, manifest }) => {
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  };
  const draft = insertDraftReviewFixture(app, scope, { taskKind: 'QUESTION_PROPOSALS' }, {
    schemaVersion: 1, kind: 'question_proposals', proposals: [{
      temporaryId: 'q-replay', text: '적용 재생을 확인합니까?', reason: '같은 적용 요청을 확인합니다.',
      suggestedAssigneeId: manifest.personaIds['P-02'], requiredGate: 'G1', sourceRefs: [], candidateAnswers: [],
    }],
  });
  await openDraftReview(page, scope.actorId, 'PAY-102');
  const review = page.getByTestId('draft-review');
  await review.getByRole('button', { name: new RegExp(draft.draftId, 'u') }).click();
  await review.getByLabel('질문 q-replay 적용').check();
  await review.getByLabel('초안 적용 이유').fill('질문 적용 요청의 재생을 확인합니다.');
  const keys: string[] = [];
  let first = true;
  await page.route('**/api/methods/M-018', async (route) => {
    const request = route.request().postDataJSON() as { readonly meta: { readonly idempotencyKey: string } };
    keys.push(request.meta.idempotencyKey);
    if (first) {
      first = false;
      await route.fetch();
      await route.abort('connectionfailed');
    } else {
      await route.continue();
    }
  });
  await review.getByRole('button', { name: '초안 적용' }).click();
  await expect(review.getByRole('alert')).toContainText('확인할 수 없습니다.');
  await review.getByRole('button', { name: '같은 적용 결과 확인' }).click();
  await expect(review.getByText(/초안을 적용했습니다/u)).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  const detail = await app.invoke('M-047', scope, {});
  if (!detail.ok) throw new Error('재생 적용 결과를 읽지 못했습니다.');
  expect(detail.value.questions.filter(({ text }) => text === '적용 재생을 확인합니까?')).toHaveLength(1);
  await page.unroute('**/api/methods/M-018');
});

test('M-018의 늦은 응답은 새로 선택한 초안과 dirty 입력을 바꾸지 않는다', async ({ page, app, manifest }) => {
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  };
  const first = insertDraftReviewFixture(app, scope, { taskKind: 'QUESTION_PROPOSALS' }, {
    schemaVersion: 1, kind: 'question_proposals', proposals: [{
      temporaryId: 'q-late-apply', text: '늦게 적용할 질문', reason: '응답 격리를 확인합니다.',
      suggestedAssigneeId: manifest.personaIds['P-02'], requiredGate: 'G1', sourceRefs: [], candidateAnswers: [],
    }],
  });
  const second = insertDraftReviewFixture(app, scope, { taskKind: 'QUESTION_PROPOSALS' }, {
    schemaVersion: 1, kind: 'question_proposals', proposals: [{
      temporaryId: 'q-current-apply', text: '현재 선택한 질문', reason: '현재 입력을 유지합니다.',
      suggestedAssigneeId: manifest.personaIds['P-03'], requiredGate: 'G2', sourceRefs: [], candidateAnswers: [],
    }],
  });
  await openDraftReview(page, scope.actorId, 'PAY-102');
  const review = page.getByTestId('draft-review');
  await review.getByRole('button', { name: new RegExp(first.draftId, 'u') }).click();
  await review.getByLabel('질문 q-late-apply 적용').check();
  await review.getByLabel('초안 적용 이유').fill('첫 초안 적용을 시작합니다.');
  let release!: () => void;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  const responseRelease = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/methods/M-018', async (route) => {
    started();
    await responseRelease;
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  await review.getByRole('button', { name: '초안 적용' }).click();
  await requestStarted;
  await review.getByRole('button', { name: new RegExp(second.draftId, 'u') }).click();
  await expect(review.getByRole('heading', { name: `초안 ${second.draftId}` })).toBeVisible();
  await review.getByLabel('비교 검토 사유').fill('두 번째 초안의 작성 중 입력입니다.');
  release();
  await expect.poll(async () => {
    const latest = await app.invoke('M-047', scope, {});
    if (!latest.ok) return '조회 실패';
    return latest.value.generationDrafts.find(({ draftId }) => draftId === first.draftId)?.application.kind;
  }).toBe('applied');
  await expect(review.getByRole('heading', { name: `초안 ${second.draftId}` })).toBeVisible();
  await expect(review.getByLabel('비교 검토 사유')).toHaveValue('두 번째 초안의 작성 중 입력입니다.');
  await page.unroute('**/api/methods/M-018');
});

test('M-019의 늦은 응답은 입력이 같은 다른 초안 화면을 바꾸지 않는다', async ({ page, app, manifest }) => {
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  };
  const body = {
    schemaVersion: 1 as const, kind: 'question_proposals' as const, proposals: [{
      temporaryId: 'q-same-review', text: '같은 본문의 질문', reason: '초안 identity를 확인합니다.',
      suggestedAssigneeId: manifest.personaIds['P-02'], requiredGate: 'G1' as const, sourceRefs: [], candidateAnswers: [],
    }] as const,
  };
  const first = insertDraftReviewFixture(app, scope, { taskKind: 'QUESTION_PROPOSALS' }, body);
  const second = insertDraftReviewFixture(app, scope, { taskKind: 'QUESTION_PROPOSALS' }, body);
  await openDraftReview(page, scope.actorId, 'PAY-102');
  const review = page.getByTestId('draft-review');
  await review.getByRole('button', { name: new RegExp(first.draftId, 'u') }).click();
  await review.getByLabel('비교 검토 사유').fill('두 초안에 같은 입력을 둡니다.');
  let release!: () => void;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  const responseRelease = new Promise<void>((resolve) => { release = resolve; });
  let responseCompleted!: () => void;
  const routeCompleted = new Promise<void>((resolve) => { responseCompleted = resolve; });
  await page.route('**/api/methods/M-019', async (route) => {
    started();
    await responseRelease;
    const response = await route.fetch();
    await route.fulfill({ response });
    responseCompleted();
  });
  await review.getByRole('button', { name: '사람 검토 초안 저장' }).click();
  await requestStarted;
  await review.getByRole('button', { name: new RegExp(second.draftId, 'u') }).click();
  await expect(review.getByRole('heading', { name: `초안 ${second.draftId}` })).toBeVisible();
  await review.getByLabel('비교 검토 사유').fill('두 초안에 같은 입력을 둡니다.');
  release();
  await routeCompleted;
  await expect.poll(async () => {
    const latest = await app.invoke('M-047', scope, {});
    if (!latest.ok) return false;
    return latest.value.generationDrafts.some((draft) =>
      draft.provenance.kind === 'human_review' && draft.provenance.sourceDraftId === first.draftId);
  }).toBe(true);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(review.getByRole('heading', { name: `초안 ${second.draftId}` })).toBeVisible();
  await expect(review.getByLabel('비교 검토 사유')).toHaveValue('두 초안에 같은 입력을 둡니다.');
  await page.unroute('**/api/methods/M-019');
});

test('이전 초안의 늦은 M-018 거절은 현재 초안에 오류를 표시하지 않는다', async ({ page, app, manifest }) => {
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  };
  const first = insertDraftReviewFixture(app, scope, { taskKind: 'QUESTION_PROPOSALS' }, {
    schemaVersion: 1, kind: 'question_proposals', proposals: [{
      temporaryId: 'q-rejected-old', text: '거절될 이전 질문', reason: '현재 입력을 바꿉니다.',
      suggestedAssigneeId: manifest.personaIds['P-02'], requiredGate: 'G1', sourceRefs: [], candidateAnswers: [],
    }],
  });
  const second = insertDraftReviewFixture(app, scope, { taskKind: 'QUESTION_PROPOSALS' }, {
    schemaVersion: 1, kind: 'question_proposals', proposals: [{
      temporaryId: 'q-after-rejection', text: '거절 뒤 현재 질문', reason: '현재 화면을 유지합니다.',
      suggestedAssigneeId: manifest.personaIds['P-03'], requiredGate: 'G2', sourceRefs: [], candidateAnswers: [],
    }],
  });
  await openDraftReview(page, scope.actorId, 'PAY-102');
  const review = page.getByTestId('draft-review');
  await review.getByRole('button', { name: new RegExp(first.draftId, 'u') }).click();
  await review.getByLabel('질문 q-rejected-old 적용').check();
  await review.getByLabel('초안 적용 이유').fill('거절 경계를 확인합니다.');
  let release!: () => void;
  let started!: () => void;
  let finished!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  const responseRelease = new Promise<void>((resolve) => { release = resolve; });
  const responseFinished = new Promise<void>((resolve) => { finished = resolve; });
  await page.route('**/api/methods/M-018', async (route) => {
    started();
    await responseRelease;
    const response = await route.fetch();
    await route.fulfill({ response });
    finished();
  });
  await review.getByRole('button', { name: '초안 적용' }).click();
  await requestStarted;
  const current = await app.invoke('M-047', scope, {});
  if (!current.ok) throw new Error('거절용 현재 입력을 읽지 못했습니다.');
  const changed = await app.invoke('M-005', {
    ...scope, idempotencyKey: randomUUID(), guard: { resource: { target: {
      kind: 'sr', projectId: scope.projectId, srId: scope.srId, entityId: scope.srId,
    }, expectedRevision: current.value.sr.revision } },
  }, {
    title: current.value.currentDescription.title, purpose: current.value.currentDescription.purpose,
    description: `${current.value.currentDescription.description}\n늦은 거절을 만드는 변경입니다.`,
    changeReason: '이전 적용의 fingerprint를 오래되게 만듭니다.',
  });
  if (!changed.ok) throw new Error('거절용 현재 입력을 바꾸지 못했습니다.');
  await review.getByRole('button', { name: new RegExp(second.draftId, 'u') }).click();
  await expect(review.getByRole('heading', { name: `초안 ${second.draftId}` })).toBeVisible();
  await review.getByLabel('비교 검토 사유').fill('현재 초안 입력은 유지합니다.');
  const browserResponse = page.waitForResponse((response) => response.url().includes('/api/methods/M-018'));
  release();
  await responseFinished;
  await browserResponse;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(review.getByRole('heading', { name: `초안 ${second.draftId}` })).toBeVisible();
  await expect(review.getByLabel('비교 검토 사유')).toHaveValue('현재 초안 입력은 유지합니다.');
  await expect(review.getByRole('alert')).toHaveCount(0);
  await page.unroute('**/api/methods/M-018');
});

test('이전 초안의 늦은 M-019 불명확 결과는 현재 초안에 재시도를 표시하지 않는다', async ({ page, app, manifest }) => {
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  };
  const body = {
    schemaVersion: 1 as const, kind: 'question_proposals' as const, proposals: [{
      temporaryId: 'q-old-unknown', text: '결과가 불명확할 질문', reason: '전송 경계를 확인합니다.',
      suggestedAssigneeId: manifest.personaIds['P-02'], requiredGate: 'G1' as const, sourceRefs: [], candidateAnswers: [],
    }] as const,
  };
  const first = insertDraftReviewFixture(app, scope, { taskKind: 'QUESTION_PROPOSALS' }, body);
  const second = insertDraftReviewFixture(app, scope, { taskKind: 'QUESTION_PROPOSALS' }, {
    ...body, proposals: [{ ...body.proposals[0], temporaryId: 'q-current-unknown', text: '현재 화면 질문' }],
  });
  await openDraftReview(page, scope.actorId, 'PAY-102');
  const review = page.getByTestId('draft-review');
  await review.getByRole('button', { name: new RegExp(first.draftId, 'u') }).click();
  await review.getByLabel('비교 검토 사유').fill('불명확 결과를 만듭니다.');
  let release!: () => void;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  const responseRelease = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/methods/M-019', async (route) => {
    started();
    await responseRelease;
    await route.abort('connectionfailed');
  });
  await review.getByRole('button', { name: '사람 검토 초안 저장' }).click();
  await requestStarted;
  await review.getByRole('button', { name: new RegExp(second.draftId, 'u') }).click();
  await expect(review.getByRole('heading', { name: `초안 ${second.draftId}` })).toBeVisible();
  await review.getByLabel('비교 검토 사유').fill('현재 화면 입력입니다.');
  const failedRequest = page.waitForEvent('requestfailed', (request) => request.url().includes('/api/methods/M-019'));
  release();
  await failedRequest;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(review.getByRole('heading', { name: `초안 ${second.draftId}` })).toBeVisible();
  await expect(review.getByLabel('비교 검토 사유')).toHaveValue('현재 화면 입력입니다.');
  await expect(review.getByRole('button', { name: '같은 검토 저장 결과 확인' })).toHaveCount(0);
  await expect(review.getByRole('alert')).toHaveCount(0);
  await page.unroute('**/api/methods/M-019');
});

test('고정 입력과 현재 자료 비교는 이전·현재 본문과 당시 미확인 출처를 보여준다', async ({ page, app, manifest }) => {
  const key = `COMPARE-${randomUUID().slice(0, 8)}`;
  const originalDescription = '고정 입력 시점의 설명 A입니다.';
  const registered = await app.invoke('M-003', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
  }, {
    key, title: '입력 본문 비교', purpose: '실제 본문 대조', description: originalDescription,
    ownerId: manifest.personaIds['P-01'],
  });
  if (!registered.ok) throw new Error('본문 비교 SR을 만들지 못했습니다.');
  const scope = { actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: registered.value.scope.srId };
  const attached = await app.invoke('M-006', {
    ...scope, idempotencyKey: randomUUID(), guard: { resource: { target: {
      kind: 'sr', projectId: scope.projectId, srId: scope.srId, entityId: scope.srId,
    }, expectedRevision: registered.value.revision } },
  }, { kind: 'text', content: '사람이 아직 확인하지 않은 원문 근거입니다.', provenance: '사용자 입력' });
  if (!attached.ok) throw new Error('본문 비교 출처를 붙이지 못했습니다.');
  const draft = insertDraftReviewFixture(app, scope, { taskKind: 'QUESTION_PROPOSALS' }, {
    schemaVersion: 1, kind: 'question_proposals', proposals: [{
      temporaryId: 'q-compare', text: '변경된 설명을 확인합니까?', reason: '본문 차이를 확인합니다.',
      suggestedAssigneeId: manifest.personaIds['P-02'], requiredGate: 'G1', sourceRefs: [], candidateAnswers: [],
    }],
  });
  const beforeChange = await app.invoke('M-047', scope, {});
  if (!beforeChange.ok) throw new Error('설명 변경 기준을 읽지 못했습니다.');
  const currentDescription = '현재 입력의 설명 B입니다.';
  const changed = await app.invoke('M-005', {
    ...scope, idempotencyKey: randomUUID(), guard: { resource: { target: {
      kind: 'sr', projectId: scope.projectId, srId: scope.srId, entityId: scope.srId,
    }, expectedRevision: beforeChange.value.sr.revision } },
  }, {
    title: beforeChange.value.currentDescription.title,
    purpose: beforeChange.value.currentDescription.purpose,
    description: currentDescription,
    changeReason: '고정 입력과 다른 현재 설명을 만듭니다.',
  });
  if (!changed.ok) throw new Error('현재 설명을 바꾸지 못했습니다.');
  await openDraftReview(page, scope.actorId, key);
  const review = page.getByTestId('draft-review');
  await review.getByRole('button', { name: new RegExp(draft.draftId, 'u') }).click();
  const comparison = review.getByRole('region', { name: '고정 입력과 현재 자료 비교' });
  await expect(comparison).toContainText(originalDescription);
  await expect(comparison).toContainText(currentDescription);
  await expect(comparison).toContainText('변경');
  await expect(comparison).toContainText('사람이 아직 확인하지 않은 원문 근거입니다.');
  await expect(comparison).toContainText('당시 미확인');
});

test('질문·결정 제안을 구조형으로 고쳐 별도 사람 검토 초안에만 저장한다', async ({ page, app, manifest }) => {
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  };
  const sourceRef = (await app.invoke('M-047', scope, {}));
  if (!sourceRef.ok) throw new Error('제안 출처를 읽지 못했습니다.');
  const ref = sourceRef.value.currentDescription.versionRef;
  const question = insertDraftReviewFixture(app, scope, { taskKind: 'QUESTION_PROPOSALS' }, {
    schemaVersion: 1, kind: 'question_proposals', proposals: [{
      temporaryId: 'q-edit', text: '원 질문 문구', reason: '원 질문 이유',
      suggestedAssigneeId: manifest.personaIds['P-02'], requiredGate: 'G1', sourceRefs: [ref],
      candidateAnswers: ['원 후보'],
    }],
  });
  await openDraftReview(page, scope.actorId, 'PAY-102');
  const review = page.getByTestId('draft-review');
  await review.getByRole('button', { name: new RegExp(question.draftId, 'u') }).click();
  await expect(review).toContainText(`sr_description:${ref.entityId} v${ref.version}`);
  await review.getByLabel('질문 q-edit 문구').fill('사람이 고친 질문 문구');
  await review.getByLabel('질문 q-edit 이유').fill('사람이 고친 질문 이유');
  await review.getByLabel('질문 q-edit 제안 담당자').selectOption(manifest.personaIds['P-03']);
  await review.getByLabel('질문 q-edit 필요 gate').selectOption('G2');
  await review.getByLabel('질문 q-edit 답변 후보').fill('후보 A\n후보 B');
  await review.getByLabel('비교 검토 사유').fill('질문 제안을 현재 입력에 맞게 고쳤습니다.');
  await review.getByRole('button', { name: '사람 검토 초안 저장' }).click();
  await expect(review).toContainText('human_review');
  let detail = await app.invoke('M-047', scope, { kind: 'draft', draftId: question.draftId });
  if (!detail.ok || detail.value.draftReview === undefined) throw new Error('원 질문 초안을 읽지 못했습니다.');
  expect(detail.value.draftReview.draft.body).toMatchObject({
    kind: 'question_proposals', proposals: [{ text: '원 질문 문구', reason: '원 질문 이유' }],
  });
  const questionHuman = (await app.invoke('M-047', scope, {}));
  if (!questionHuman.ok) throw new Error('사람 검토 질문 목록을 읽지 못했습니다.');
  const humanQuestion = questionHuman.value.generationDrafts.find((item) =>
    item.provenance.kind === 'human_review' && item.provenance.sourceDraftId === question.draftId);
  if (humanQuestion === undefined) throw new Error('사람 검토 질문 초안이 없습니다.');
  detail = await app.invoke('M-047', scope, { kind: 'draft', draftId: humanQuestion.draftId });
  if (!detail.ok || detail.value.draftReview === undefined) throw new Error('사람 검토 질문 본문을 읽지 못했습니다.');
  expect(detail.value.draftReview.draft.body).toMatchObject({
    kind: 'question_proposals', proposals: [{
      text: '사람이 고친 질문 문구', reason: '사람이 고친 질문 이유',
      suggestedAssigneeId: manifest.personaIds['P-03'], requiredGate: 'G2',
      candidateAnswers: ['후보 A', '후보 B'],
    }],
  });
  await review.getByLabel('질문 q-edit 적용').check();
  await review.getByLabel('초안 적용 이유').fill('사람이 고친 질문 초안을 별도로 적용합니다.');
  await review.getByRole('button', { name: '초안 적용' }).click();
  await expect(review.getByText(/초안을 적용했습니다/u)).toBeVisible();
  const appliedQuestion = await app.invoke('M-047', scope, {});
  if (!appliedQuestion.ok) throw new Error('고친 질문 적용 결과를 읽지 못했습니다.');
  expect(appliedQuestion.value.questions).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: '사람이 고친 질문 문구', reason: '사람이 고친 질문 이유' }),
  ]));

  const decision = insertDraftReviewFixture(app, scope, { taskKind: 'DECISION_PROPOSALS' }, {
    schemaVersion: 1, kind: 'decision_proposals', proposals: [{
      temporaryId: 'd-edit', prompt: '원 결정 문구', impact: '원 영향', recommendation: 'one', sourceRefs: [ref],
      alternatives: [{ optionId: 'one', label: '원 대안', description: '원 대안 설명' }],
    }],
  });
  await openDraftReview(page, scope.actorId, 'PAY-102');
  await review.getByRole('button', { name: new RegExp(decision.draftId, 'u') }).click();
  await review.getByLabel('결정 d-edit 문구').fill('사람이 고친 결정 문구');
  await review.getByLabel('결정 d-edit 영향').fill('사람이 고친 영향');
  await review.getByLabel('결정 d-edit 추천').fill('two');
  await review.getByLabel('결정 d-edit 대안 1 ID').fill('two');
  await review.getByLabel('결정 d-edit 대안 1 이름').fill('고친 대안');
  await review.getByLabel('결정 d-edit 대안 1 설명').fill('고친 대안 설명');
  await review.getByLabel('비교 검토 사유').fill('결정 제안을 현재 입력에 맞게 고쳤습니다.');
  await review.getByRole('button', { name: '사람 검토 초안 저장' }).click();
  const decisionList = await app.invoke('M-047', scope, {});
  if (!decisionList.ok) throw new Error('사람 검토 결정 목록을 읽지 못했습니다.');
  const humanDecision = decisionList.value.generationDrafts.find((item) =>
    item.provenance.kind === 'human_review' && item.provenance.sourceDraftId === decision.draftId);
  if (humanDecision === undefined) throw new Error('사람 검토 결정 초안이 없습니다.');
  detail = await app.invoke('M-047', scope, { kind: 'draft', draftId: humanDecision.draftId });
  if (!detail.ok || detail.value.draftReview === undefined) throw new Error('사람 검토 결정 본문을 읽지 못했습니다.');
  expect(detail.value.draftReview.draft.body).toMatchObject({
    kind: 'decision_proposals', proposals: [{
      prompt: '사람이 고친 결정 문구', impact: '사람이 고친 영향', recommendation: 'two',
      alternatives: [{ optionId: 'two', label: '고친 대안', description: '고친 대안 설명' }],
    }],
  });
  await review.getByLabel('결정 d-edit 적용').check();
  await review.getByLabel('결정권자').selectOption(manifest.personaIds['P-04']);
  await review.getByLabel('분류', { exact: true }).selectOption('current');
  await review.getByLabel('필요 gate').selectOption('G1');
  await review.getByLabel('분류 이유').fill('고친 결정을 G1에서 확인합니다.');
  await review.getByLabel('초안 적용 이유').fill('사람이 고친 결정 초안을 별도로 적용합니다.');
  await review.getByRole('button', { name: '초안 적용' }).click();
  await expect(review.getByText(/초안을 적용했습니다/u)).toBeVisible();
  const appliedDecision = await app.invoke('M-047', scope, {});
  if (!appliedDecision.ok) throw new Error('고친 결정 적용 결과를 읽지 못했습니다.');
  expect(appliedDecision.value.decisions).toEqual(expect.arrayContaining([
    expect.objectContaining({ prompt: '사람이 고친 결정 문구', state: 'unconfirmed' }),
  ]));
});

test('artifact 검토는 요구사항 행을 추가·삭제하며 body 참조와 함께 저장한다', async ({ page, app, manifest }) => {
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  };
  const before = await app.invoke('M-047', scope, {});
  if (!before.ok) throw new Error('artifact 기준을 읽지 못했습니다.');
  const artifact = before.value.artifacts.find((item) => item.kind === 'requirements');
  if (artifact === undefined) throw new Error('요구사항 문서를 찾지 못했습니다.');
  const draft = insertDraftReviewFixture(app, scope, {
    taskKind: 'ARTIFACT_REVISION', documentKind: 'requirements', targetBasis: { kind: 'version', ref: artifact.versionRef },
  }, {
    schemaVersion: 1, kind: 'artifact', documentKind: 'requirements', markdown: artifact.markdown,
    requirementRefs: ['REQ-REMOVE'], changeSummary: '요구사항 행 편집',
  });
  await openDraftReview(page, scope.actorId, 'PAY-102');
  const review = page.getByTestId('draft-review');
  await review.getByRole('button', { name: new RegExp(draft.draftId, 'u') }).click();
  await review.getByRole('button', { name: '요구사항 1 삭제' }).click();
  await review.getByRole('button', { name: '요구사항 추가' }).click();
  await review.getByLabel('요구사항 ID').fill('REQ-ADD');
  await review.getByLabel('연결 섹션 ID').fill('REQ-ADD');
  await review.getByLabel('비교 검토 사유').fill('요구사항 참조를 교체했습니다.');
  await review.getByRole('button', { name: '사람 검토 초안 저장' }).click();
  const list = await app.invoke('M-047', scope, {});
  if (!list.ok) throw new Error('사람 검토 artifact 목록을 읽지 못했습니다.');
  const human = list.value.generationDrafts.find((item) =>
    item.provenance.kind === 'human_review' && item.provenance.sourceDraftId === draft.draftId);
  if (human === undefined) throw new Error('사람 검토 artifact 초안이 없습니다.');
  const detail = await app.invoke('M-047', scope, { kind: 'draft', draftId: human.draftId });
  if (!detail.ok || detail.value.draftReview === undefined) throw new Error('사람 검토 artifact 본문을 읽지 못했습니다.');
  expect(detail.value.draftReview.draft.body).toMatchObject({ kind: 'artifact', requirementRefs: ['REQ-ADD'] });
});
