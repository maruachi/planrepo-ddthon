import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures/test-app';
import type { TestApp } from '../../helpers/test-app';
import type { DemoManifest } from '../../helpers/demo-manifest';

async function openSr(page: import('@playwright/test').Page, actorId: string, srKey: string) {
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(actorId);
  await page.locator('.sr-card').filter({ hasText: srKey }).getByRole('button', { name: '상세 열기' }).click();
}

async function preparePassableG1(app: TestApp, manifest: DemoManifest) {
  const ownerId = manifest.personaIds['P-01'];
  const reviewerId = manifest.personaIds['P-03'];
  const projectId = manifest.projectId;
  const srId = manifest.srIds['PAY-102'];
  const initial = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
  if (!initial.ok) throw new Error('초기 G1 자료를 읽지 못했습니다.');
  const question = initial.value.questions.find((item) => item.status !== 'resolved' && item.requiredGate === 'G1');
  if (question === undefined) throw new Error('G1 질문이 없습니다.');
  const moved = await app.invoke('M-014', {
    actorId: ownerId, projectId, srId,
    guard: { resource: { target: { kind: 'question', projectId, srId, entityId: question.questionId }, expectedRevision: question.revision } },
  }, { targetRef: { kind: 'question', projectId, srId, entityId: question.questionId }, scope: 'current', requiredGate: 'G2', reason: 'G2에서 확인할 질문입니다.' });
  if (!moved.ok) throw new Error('질문 범위를 바꾸지 못했습니다.');
  const ready = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
  if (!ready.ok) throw new Error('새 G1 준비 입력을 읽지 못했습니다.');
  const preparation = ready.value.reviewPreparations.find((item) => item.gate === 'G1');
  const configuration = ready.value.reviewConfigurations.find((item) => item.gate === 'G1');
  if (preparation?.kind !== 'Ready' || configuration === undefined) throw new Error('G1 검토가 준비되지 않았습니다.');
  const requested = await app.invoke('M-020', {
    actorId: ownerId, projectId, srId,
    guard: { resource: { target: { kind: 'review_gate_state', projectId, srId, entityId: 'G1' }, expectedRevision: configuration.revision } },
  }, preparation.input);
  if (!requested.ok || requested.value.kind !== 'BundleAvailable') throw new Error('G1 검토본을 만들지 못했습니다.');
  const bundle = requested.value.bundle;
  const checklist = bundle.checklistSnapshot.map((item) => ({ itemId: item.itemId, checked: true as const }));
  const first = checklist[0];
  if (first === undefined) throw new Error('G1 체크리스트가 비었습니다.');
  const approved = await app.invoke('M-021', {
    actorId: reviewerId, projectId, srId,
    guard: { expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch },
  }, { bundleRef: bundle.bundleRef, reviewEpoch: bundle.reviewEpoch, checklistResults: [first, ...checklist.slice(1)], approvalScope: 'G1' });
  if (!approved.ok) throw new Error('G1 승인을 만들지 못했습니다.');
  return { ownerId, projectId, srId };
}

test('같은 현재 기준의 G1 검토 요청은 기존 불변 묶음과 요청을 재사용한다', async ({ page, app, manifest }) => {
  const ownerId = manifest.personaIds['P-01'];
  const srId = manifest.srIds['PAY-102'];
  const before = await app.invoke('M-047', { actorId: ownerId, projectId: manifest.projectId, srId }, {});
  if (!before.ok) throw new Error('G1 상세를 읽지 못했습니다.');
  const bundle = before.value.reviewConfigurations.find((item) => item.gate === 'G1')?.currentBundleRef;
  if (bundle === undefined) throw new Error('현재 G1 묶음이 없습니다.');
  const requestCount = before.value.reviewRequests.length;
  await openSr(page, ownerId, 'PAY-102');
  const review = page.getByRole('region', { name: '공식 검토' });
  await review.getByRole('button', { name: 'G1 공식 검토 요청' }).click();
  await expect(review).toContainText('현재 요구사항 검토본을 확인했습니다.');
  const after = await app.invoke('M-047', { actorId: ownerId, projectId: manifest.projectId, srId }, {});
  expect(after.ok && after.value.reviewConfigurations.find((item) => item.gate === 'G1')?.currentBundleRef).toEqual(bundle);
  expect(after.ok && after.value.reviewRequests).toHaveLength(requestCount);
});

test('지정 검토자는 미해결 G1 질문이 있어도 고정 본문과 체크리스트를 확인하고 개별 승인한다', async ({ page, app, manifest }) => {
  const reviewerId = manifest.personaIds['P-03'];
  const srId = manifest.srIds['PAY-102'];
  const before = await app.invoke('M-047', { actorId: reviewerId, projectId: manifest.projectId, srId }, {});
  if (!before.ok) throw new Error('G1 검토 대상을 읽지 못했습니다.');
  const unresolved = before.value.questions.find((question) => question.status !== 'resolved' && question.requiredGate === 'G1');
  expect(unresolved).toBeDefined();
  const artifact = before.value.artifacts[0];
  if (artifact === undefined) throw new Error('검토 문서가 없습니다.');
  await openSr(page, reviewerId, 'PAY-102');
  const form = page.getByRole('region', { name: 'G1 검토본 확인' });
  await expect(form).toContainText(artifact.sectionIndex[0]?.title ?? artifact.artifactId);
  await expect(form).toContainText('미해결 질문');
  for (const item of before.value.reviewConfigurations.find((entry) => entry.gate === 'G1')?.policy?.gates.G1.checklist ?? []) {
    await form.getByLabel(item.label).check();
  }
  await form.getByLabel('승인 의견').fill('현재 고정 묶음의 요구사항과 근거를 확인했습니다.');
  await form.getByRole('button', { name: /G1 검토본 v1 개별 승인/ }).click();
  await expect(form).toContainText('개별 승인을 기록했습니다.');
  const after = await app.invoke('M-047', { actorId: reviewerId, projectId: manifest.projectId, srId }, {});
  expect(after.ok && after.value.approvals.some((approval) => approval.approverId === reviewerId)).toBe(true);
  expect(after.ok && after.value.questions.some((question) => question.questionId === unresolved?.questionId && question.status !== 'resolved')).toBe(true);
  expect(after.ok && after.value.sr.progressStage).toBe('requirements');
});

test('G1 조건을 다시 검사하고 owner가 exact bundle과 SR revision으로 planning 전환을 확정한다', async ({ page, app, manifest }) => {
  const ownerId = manifest.personaIds['P-01'];
  const reviewerId = manifest.personaIds['P-03'];
  const projectId = manifest.projectId;
  const srId = manifest.srIds['PAY-102'];
  const initial = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
  if (!initial.ok) throw new Error('초기 G1 자료를 읽지 못했습니다.');
  const question = initial.value.questions.find((item) => item.status !== 'resolved' && item.requiredGate === 'G1');
  if (question === undefined) throw new Error('G1 질문이 없습니다.');
  const moved = await app.invoke('M-014', {
    actorId: ownerId, projectId, srId,
    guard: { resource: { target: { kind: 'question', projectId, srId, entityId: question.questionId }, expectedRevision: question.revision } },
  }, { targetRef: { kind: 'question', projectId, srId, entityId: question.questionId }, scope: 'current', requiredGate: 'G2', reason: 'G2에서 확인할 질문입니다.' });
  if (!moved.ok) throw new Error('질문 범위를 바꾸지 못했습니다.');
  const ready = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
  if (!ready.ok) throw new Error('새 G1 준비 입력을 읽지 못했습니다.');
  const preparation = ready.value.reviewPreparations.find((item) => item.gate === 'G1');
  const configuration = ready.value.reviewConfigurations.find((item) => item.gate === 'G1');
  if (preparation?.kind !== 'Ready' || configuration === undefined) throw new Error('G1 검토가 준비되지 않았습니다.');
  const requested = await app.invoke('M-020', {
    actorId: ownerId, projectId, srId,
    guard: { resource: { target: { kind: 'review_gate_state', projectId, srId, entityId: 'G1' }, expectedRevision: configuration.revision } },
  }, preparation.input);
  if (!requested.ok || requested.value.kind !== 'BundleAvailable') throw new Error('G1 검토 묶음을 만들지 못했습니다.');
  const bundle = requested.value.bundle;
  const checklist = bundle.checklistSnapshot.map((item) => ({ itemId: item.itemId, checked: true as const }));
  const first = checklist[0];
  if (first === undefined) throw new Error('G1 체크리스트가 비었습니다.');
  const approved = await app.invoke('M-021', {
    actorId: reviewerId, projectId, srId,
    guard: { expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch },
  }, { bundleRef: bundle.bundleRef, reviewEpoch: bundle.reviewEpoch, checklistResults: [first, ...checklist.slice(1)], approvalScope: 'G1' });
  if (!approved.ok) throw new Error('G1 승인을 만들지 못했습니다.');
  await openSr(page, ownerId, 'PAY-102');
  const conditions = page.getByRole('region', { name: 'G1 통과 조건' });
  await conditions.getByRole('button', { name: '검토 조건 다시 확인' }).click();
  await expect(conditions).toContainText('모든 G1 통과 조건을 충족했습니다.');
  await conditions.getByLabel('단계 이동 이유').fill('요구사항 검토 조건을 모두 확인했습니다.');
  await conditions.getByRole('button', { name: '검토 완료하고 계획으로 이동' }).click();
  await expect(conditions).toContainText('계획 단계로 이동했습니다.');
  const after = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
  expect(after.ok && after.value.sr.progressStage).toBe('planning');
});

test('검토에서 제외된 사용자의 이전 화면 승인은 거절되고 승인 기록을 만들지 않는다', async ({ page, app, manifest }) => {
  const reviewerId = manifest.personaIds['P-03'];
  const adminId = manifest.personaIds['P-05'];
  const projectId = manifest.projectId;
  const srId = manifest.srIds['PAY-102'];
  await openSr(page, reviewerId, 'PAY-102');
  const form = page.getByRole('region', { name: 'G1 검토본 확인' });
  const detail = await app.invoke('M-047', { actorId: adminId, projectId, srId }, {});
  if (!detail.ok) throw new Error('검토 배정을 읽지 못했습니다.');
  const configuration = detail.value.reviewConfigurations.find((item) => item.gate === 'G1');
  if (configuration?.assignment === undefined) throw new Error('G1 배정이 없습니다.');
  const changed = await app.invoke('M-030', {
    actorId: adminId, projectId, srId,
    guard: { resource: { target: { kind: 'review_gate_state', projectId, srId, entityId: 'G1' }, expectedRevision: configuration.revision } },
  }, { gate: 'G1', reviewerIds: [], previousAssignmentRef: configuration.assignment.assignmentRef, changeReason: '검토자를 다시 배정합니다.' });
  if (!changed.ok) throw new Error('검토자 제외 fixture를 만들지 못했습니다.');
  for (const item of detail.value.bundles.find((bundle) => bundle.bundleRef.gate === 'G1')?.checklistSnapshot ?? []) {
    await form.getByLabel(item.label).check();
  }
  await form.getByRole('button', { name: /개별 승인/ }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  const after = await app.invoke('M-047', { actorId: adminId, projectId, srId }, {});
  expect(after.ok && after.value.approvals.some((approval) => approval.approverId === reviewerId)).toBe(false);
});

test('검토자가 없는 새 SR은 승인이 끝났다고 표시하지 않는다', async ({ page, app, manifest }) => {
  const ownerId = manifest.personaIds['P-01'];
  const key = `UI-G1-EMPTY-${randomUUID().slice(0, 8)}`;
  const created = await app.invoke('M-003', { actorId: ownerId, projectId: manifest.projectId }, {
    key, title: '검토자 없는 SR', purpose: '빈 승인 집계 확인', description: '검토자를 배정하기 전입니다.', ownerId,
  });
  if (!created.ok) throw new Error('새 SR fixture를 만들지 못했습니다.');
  await openSr(page, ownerId, key);
  const review = page.getByRole('region', { name: '공식 검토' });
  await expect(review).toContainText('검토자 배정이 필요합니다.');
  await expect(review).not.toContainText('0/0명 승인');
  await expect(review).not.toContainText('승인 완료');
});

test('불명확한 검토 요청은 같은 idempotency key로 다시 확인한다', async ({ page, manifest }) => {
  const ownerId = manifest.personaIds['P-01'];
  const keys: string[] = [];
  let first = true;
  await page.route('**/api/methods/M-020', async (route) => {
    const body = route.request().postDataJSON() as { readonly meta: { readonly idempotencyKey: string } };
    keys.push(body.meta.idempotencyKey);
    if (first) { first = false; await route.abort('connectionfailed'); } else await route.continue();
  });
  await openSr(page, ownerId, 'PAY-102');
  const review = page.getByRole('region', { name: '공식 검토' });
  await review.getByRole('button', { name: 'G1 공식 검토 요청' }).click();
  await expect(review.getByRole('alert')).toContainText('확인해야 합니다');
  await review.getByRole('button', { name: '같은 요청 확인' }).click();
  await expect(review).toContainText('현재 요구사항 검토본을 확인했습니다.');
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  await page.unroute('**/api/methods/M-020');
});

test('단계 이동 충돌 뒤 작성 이유를 보존하고 최신 기준을 명시적으로 채택한다', async ({ page, app, manifest }) => {
  const { ownerId, projectId, srId } = await preparePassableG1(app, manifest);
  await openSr(page, ownerId, 'PAY-102');
  const conditions = page.getByRole('region', { name: 'G1 통과 조건' });
  await conditions.getByRole('button', { name: '검토 조건 다시 확인' }).click();
  await expect(conditions).toContainText('모든 G1 통과 조건을 충족했습니다.');
  await conditions.getByLabel('단계 이동 이유').fill('작성 중 보존할 단계 이동 이유');
  const before = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
  if (!before.ok) throw new Error('설명 변경 기준을 읽지 못했습니다.');
  const changed = await app.invoke('M-005', {
    actorId: ownerId, projectId, srId,
    guard: { resource: { target: { kind: 'sr', projectId, srId, entityId: srId }, expectedRevision: before.value.sr.revision } },
  }, {
    title: before.value.currentDescription.title,
    purpose: before.value.currentDescription.purpose,
    description: `${before.value.currentDescription.description}\n동시 변경`,
    changeReason: '단계 이동과 동시에 설명을 바꿉니다.',
  });
  if (!changed.ok) throw new Error('동시 변경 fixture를 만들지 못했습니다.');
  await conditions.getByRole('button', { name: '검토 완료하고 계획으로 이동' }).click();
  await expect(conditions.getByRole('alert')).toBeVisible();
  await expect(conditions.getByLabel('단계 이동 이유')).toHaveValue('작성 중 보존할 단계 이동 이유');
  await expect(conditions).toContainText('검토 기준이 새로 바뀌었습니다.');
  await conditions.getByRole('button', { name: '현재 작성 내용에 최신 기준 사용' }).click();
  await expect(conditions.getByLabel('단계 이동 이유')).toHaveValue('작성 중 보존할 단계 이동 이유');
});

test('개별 승인 지연 응답 중 고친 의견을 지우지 않고 최신 승인 상태를 반영한다', async ({ page, manifest }) => {
  const reviewerId = manifest.personaIds['P-03'];
  await openSr(page, reviewerId, 'PAY-102');
  const form = page.getByRole('region', { name: 'G1 검토본 확인' });
  await form.getByLabel('요구사항과 완료 기준을 확인했습니다.').check();
  await form.getByLabel('질문·결정과 근거를 확인했습니다.').check();
  await form.getByLabel('승인 의견').fill('먼저 제출할 승인 의견');
  let release!: () => void;
  let started!: () => void;
  const responseRelease = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  await page.route('**/api/methods/M-021', async (route) => {
    const response = await route.fetch();
    started();
    await responseRelease;
    await route.fulfill({ response });
  });
  const saving = form.getByRole('button', { name: /개별 승인/ }).click();
  await requestStarted;
  await form.getByLabel('승인 의견').fill('응답 대기 중 고친 승인 의견');
  release();
  await saving;
  await expect(form).toContainText('개별 승인을 기록했습니다.');
  await expect(form.getByLabel('승인 의견')).toHaveValue('응답 대기 중 고친 승인 의견');
  await page.unroute('**/api/methods/M-021');
});
