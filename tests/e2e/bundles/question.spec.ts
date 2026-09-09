import { test, expect } from '../fixtures/test-app';
import { openPersonaContext } from '../fixtures/personas';

async function openQuestions(page: import('@playwright/test').Page, actorId: string, srKey = 'PAY-102') {
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(actorId);
  await page.locator('.sr-card').filter({ hasText: srKey }).getByRole('button', { name: '상세 열기' }).click();
  await page.getByRole('button', { name: '질문·결정' }).click();
}

test('owner가 현재 선택 답변을 문서 변경 불필요 근거와 함께 해결 확인한다', async ({ page, app, manifest }) => {
  const projectId = manifest.projectId;
  const srId = manifest.srIds['PAY-102'];
  const questionId = manifest.entityIds['PAY-102'].questionId;
  const initial = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-02'], projectId, srId,
  }, {});
  if (!initial.ok) throw new Error('질문 fixture를 조회하지 못했습니다.');
  const question = initial.value.questions.find((item) => item.questionId === questionId);
  if (question === undefined) throw new Error('질문 fixture가 없습니다.');
  const answered = await app.invoke('M-008', {
    actorId: question.assigneeId, projectId, srId,
    guard: { resource: {
      target: { kind: 'question', projectId, srId, entityId: questionId },
      expectedRevision: question.revision,
    } },
  }, {
    questionId, answeredQuestionSnapshotRef: question.currentResult.ref,
    answer: { kind: 'free_text', text: '부분 취소와 외부 실패를 각각 멱등 처리합니다.' },
    evidence: { text: '업무 담당자가 정책을 확인했습니다.' },
  });
  if (!answered.ok) throw new Error('답변 fixture를 만들지 못했습니다.');

  await openQuestions(page, manifest.personaIds['P-01']);
  const card = page.getByTestId(`question-${questionId}`);
  await card.getByRole('button', { name: '해결 확인' }).click();
  await card.getByLabel('해결 근거').fill('현재 요구사항과 답변이 일치합니다.');
  await card.getByLabel('문서 변경 불필요', { exact: true }).check();
  await card.getByLabel('문서 변경 불필요 이유').fill('현재 요구사항에 같은 정책이 이미 있습니다.');
  await card.getByRole('button', { name: '해결 저장' }).click();

  await expect(card).toContainText('해결됨');
  await expect(card).toContainText('현재 요구사항에 같은 정책이 이미 있습니다.');
});

test('owner가 현재 질문 결과와 분류를 기준으로 사람 결정권자에게 전환한다', async ({ page, app, manifest }) => {
  const projectId = manifest.projectId;
  const srId = manifest.srIds['PAY-102'];
  const questionId = manifest.entityIds['PAY-102'].questionId;
  const before = await app.invoke('M-047', { actorId: manifest.personaIds['P-01'], projectId, srId }, {});
  if (!before.ok) throw new Error('질문 fixture를 조회하지 못했습니다.');
  const question = before.value.questions.find((item) => item.questionId === questionId);
  if (question === undefined) throw new Error('질문 fixture가 없습니다.');

  await openQuestions(page, manifest.personaIds['P-01']);
  const card = page.getByTestId(`question-${questionId}`);
  await card.getByRole('button', { name: '결정으로 전환' }).click();
  await card.getByLabel('결정 문구').fill('부분 취소 실패 처리 방식을 결정합니다.');
  await card.getByLabel('대안 이름').nth(0).fill('즉시 실패');
  await card.getByLabel('대안 설명').nth(0).fill('실패를 즉시 사용자에게 알립니다.');
  await card.getByLabel('대안 이름').nth(1).fill('재시도');
  await card.getByLabel('대안 설명').nth(1).fill('안전한 범위에서 재시도합니다.');
  await card.getByLabel('결정 영향').fill('결제 취소 복구 시간과 사용자 안내에 영향을 줍니다.');
  await card.getByLabel('결정권자').selectOption(manifest.personaIds['P-04']);
  await card.getByRole('button', { name: '결정 전환 저장' }).click();

  await expect(card).toContainText('결정으로 전환됨');
  await expect(card.getByRole('button', { name: '결정으로 전환' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: '후속 질문 추가' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: '해결 확인' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: '범위 변경' })).toHaveCount(0);
  const after = await app.invoke('M-047', { actorId: manifest.personaIds['P-01'], projectId, srId }, {});
  if (!after.ok) throw new Error('전환 결과를 조회하지 못했습니다.');
  const convertedQuestion = after.value.questions.find((item) => item.questionId === questionId);
  const decision = after.value.decisions.find((item) => item.originQuestionId === questionId);
  expect(convertedQuestion).toMatchObject({ status: 'converted_to_decision', convertedDecisionId: decision?.decisionId });
  expect(decision).toMatchObject({
    prompt: '부분 취소 실패 처리 방식을 결정합니다.',
    decisionMakerId: manifest.personaIds['P-04'],
    originQuestionResultSnapshotRef: question.currentResult.ref,
    state: 'unconfirmed',
  });
});

test('현재 decision maker가 정확한 이전 결정을 기준으로 재결정하고 이력을 본다', async ({ page, app, manifest }) => {
  const projectId = manifest.projectId;
  const srId = manifest.srIds['PAY-102'];
  const decisionId = manifest.entityIds['PAY-102'].decisionId;
  const before = await app.invoke('M-047', { actorId: manifest.personaIds['P-04'], projectId, srId }, {});
  if (!before.ok) throw new Error('결정 fixture를 조회하지 못했습니다.');
  const decision = before.value.decisions.find((item) => item.decisionId === decisionId);
  if (decision?.currentConfirmation === undefined) throw new Error('확정 결정 fixture가 없습니다.');

  await openQuestions(page, manifest.personaIds['P-04']);
  const card = page.getByTestId(`decision-${decisionId}`);
  await card.getByRole('button', { name: '재결정' }).click();
  await card.getByRole('radio').last().check();
  await card.getByLabel('새 결정 이유').fill('변경된 운영 기준에 맞는 선택입니다.');
  await card.getByLabel('새 결정 근거').fill('결정권자가 최신 운영 기준을 확인했습니다.');
  await card.getByLabel('재결정 변경 이유').fill('취소 처리 기간 정책이 변경됐습니다.');
  await card.getByRole('button', { name: '재결정 저장' }).click();

  await expect(card).toContainText('취소 처리 기간 정책이 변경됐습니다.');
  await expect(card).toContainText(`이전 결정 v${decision.currentConfirmation.ref.version}`);
  const after = await app.invoke('M-047', { actorId: manifest.personaIds['P-04'], projectId, srId }, {});
  if (!after.ok) throw new Error('재결정 결과를 조회하지 못했습니다.');
  expect(after.value.decisions.find((item) => item.decisionId === decisionId)?.currentConfirmation).toMatchObject({
    previousVersionRef: decision.currentConfirmation.ref,
    changeReason: '취소 처리 기간 정책이 변경됐습니다.',
  });
});

test('owner가 현재 확정 결정과 요구사항 버전을 선택해 후속 범위로 옮긴다', async ({ page, app, manifest }) => {
  const projectId = manifest.projectId;
  const srId = manifest.srIds['PAY-102'];
  const decisionId = manifest.entityIds['PAY-102'].decisionId;
  const before = await app.invoke('M-047', { actorId: manifest.personaIds['P-01'], projectId, srId }, {});
  if (!before.ok) throw new Error('범위 fixture를 조회하지 못했습니다.');
  const decision = before.value.decisions.find((item) => item.decisionId === decisionId);
  const requirements = before.value.artifacts.find((item) => item.kind === 'requirements');
  if (decision?.currentConfirmation === undefined || requirements === undefined) throw new Error('범위 축소 기준 fixture가 없습니다.');
  const revised = await app.invoke('M-015', {
    actorId: manifest.personaIds['P-01'], projectId, srId,
    guard: { resource: {
      target: { kind: 'artifact', projectId, srId, entityId: requirements.artifactId },
      expectedRevision: requirements.revision,
    } },
  }, {
    kind: 'requirements', artifactId: requirements.artifactId, markdown: requirements.markdown,
    sectionIndex: requirements.sectionIndex, requirementLinks: requirements.requirementLinks,
    changeSummary: '범위 축소 결정 뒤 완료 기준을 재확인했습니다.',
    targetBasis: { kind: 'version', ref: requirements.versionRef },
    decisionRefs: requirements.decisionRefs, sourceRefs: requirements.sourceRefs,
    questionResultRefs: requirements.questionResultRefs,
  });
  if (!revised.ok) throw new Error(`개정 요구사항 fixture를 만들지 못했습니다: ${revised.error.code} ${revised.error.message}`);

  await openQuestions(page, manifest.personaIds['P-01']);
  const card = page.getByTestId(`decision-${decisionId}`);
  await expect(card).toContainText('현재 범위 분류');
  await card.getByRole('button', { name: '범위 변경' }).click();
  await card.getByLabel('업무 범위').selectOption('followup');
  await card.getByLabel('후속 담당자').selectOption(manifest.personaIds['P-03']);
  await card.getByLabel('재검토 조건').selectOption('event');
  await card.getByLabel('재검토 사건').fill('다음 결제 정책 검토');
  await card.locator('.scope-classification form select').nth(3).selectOption({ index: 1 });
  await card.locator('.scope-classification form select').nth(4).selectOption({ index: 1 });
  await card.getByLabel('분류 이유').fill('현재 범위 밖의 후속 정책으로 분리합니다.');
  await card.getByRole('button', { name: '범위 저장' }).click();

  await expect(card).toContainText('후속 업무 · 게이트 없음');
  await expect(card).toContainText('다음 결제 정책 검토');
  const after = await app.invoke('M-047', { actorId: manifest.personaIds['P-01'], projectId, srId }, {});
  if (!after.ok) throw new Error('범위 변경 결과를 조회하지 못했습니다.');
  const current = after.value.decisions.find((item) => item.decisionId === decisionId)?.currentClassification;
  expect(current).toMatchObject({
    scope: 'followup', requiredGate: 'None', ownerId: manifest.personaIds['P-03'],
    reason: '현재 범위 밖의 후속 정책으로 분리합니다.',
    revisit: { kind: 'event', event: '다음 결제 정책 검토' },
    basisRefs: [decision.currentConfirmation.ref, revised.value.versionRef],
  });

  await card.getByLabel('재검토 사건').fill('다음 분기 계획 수립');
  await card.getByLabel('분류 이유').fill('후속 범위의 재검토 시점을 바꿉니다.');
  await card.getByRole('button', { name: '범위 저장' }).click();
  await expect(card).toContainText('다음 분기 계획 수립');
  const rescheduled = await app.invoke('M-047', { actorId: manifest.personaIds['P-01'], projectId, srId }, {});
  if (!rescheduled.ok) throw new Error('후속 범위 재분류를 조회하지 못했습니다.');
  expect(rescheduled.value.decisions.find((item) => item.decisionId === decisionId)?.currentClassification).toMatchObject({
    scope: 'followup', reason: '후속 범위의 재검토 시점을 바꿉니다.',
    revisit: { kind: 'event', event: '다음 분기 계획 수립' }, basisRefs: [],
  });
});

test('owner가 현재 문서 버전을 다중 선택 가능한 반영 근거로 해결 확인한다', async ({ page, app, manifest }) => {
  const projectId = manifest.projectId;
  const srId = manifest.srIds['PAY-102'];
  const questionId = manifest.entityIds['PAY-102'].questionId;
  const initial = await app.invoke('M-047', { actorId: manifest.personaIds['P-02'], projectId, srId }, {});
  if (!initial.ok) throw new Error('질문 fixture를 조회하지 못했습니다.');
  const question = initial.value.questions.find((item) => item.questionId === questionId);
  const artifact = initial.value.artifacts[0];
  if (question === undefined || artifact === undefined) throw new Error('질문 또는 문서 fixture가 없습니다.');
  const answered = await app.invoke('M-008', {
    actorId: question.assigneeId, projectId, srId,
    guard: { resource: { target: { kind: 'question', projectId, srId, entityId: questionId }, expectedRevision: question.revision } },
  }, { questionId, answeredQuestionSnapshotRef: question.currentResult.ref, answer: { kind: 'free_text', text: '문서 반영 답변' }, evidence: { text: '문서 반영 근거' } });
  if (!answered.ok) throw new Error('답변 fixture를 만들지 못했습니다.');

  await openQuestions(page, manifest.personaIds['P-01']);
  const card = page.getByTestId(`question-${questionId}`);
  await card.getByRole('button', { name: '해결 확인' }).click();
  await card.getByLabel('해결 근거').fill('현재 문서에 반영된 답변입니다.');
  await card.getByLabel('현재 문서에 반영됨').check();
  await card.locator('.checkbox-label').first().getByRole('checkbox').check();
  await card.getByRole('button', { name: '해결 저장' }).click();
  await expect(card).toContainText('해결됨');
  const after = await app.invoke('M-047', { actorId: manifest.personaIds['P-01'], projectId, srId }, {});
  if (!after.ok) throw new Error('해결 결과를 조회하지 못했습니다.');
  expect(after.value.questions.find((item) => item.questionId === questionId)?.currentResult.resolution?.documentDisposition)
    .toEqual({ kind: 'reflected', artifactVersionRefs: [artifact.versionRef] });
});

test('해결 확인 409 뒤 dirty 입력을 보존하고 최신 답변 기준을 명시적으로 채택한다', async ({ page, app, manifest }) => {
  const projectId = manifest.projectId;
  const srId = manifest.srIds['PAY-102'];
  const questionId = manifest.entityIds['PAY-102'].questionId;
  const initial = await app.invoke('M-047', { actorId: manifest.personaIds['P-02'], projectId, srId }, {});
  if (!initial.ok) throw new Error('질문 fixture를 조회하지 못했습니다.');
  const question = initial.value.questions.find((item) => item.questionId === questionId);
  if (question === undefined) throw new Error('질문 fixture가 없습니다.');
  const first = await app.invoke('M-008', {
    actorId: question.assigneeId, projectId, srId,
    guard: { resource: { target: { kind: 'question', projectId, srId, entityId: questionId }, expectedRevision: question.revision } },
  }, { questionId, answeredQuestionSnapshotRef: question.currentResult.ref, answer: { kind: 'free_text', text: '첫 답변' }, evidence: { text: '첫 근거' } });
  if (!first.ok) throw new Error('첫 답변을 만들지 못했습니다.');

  await openQuestions(page, manifest.personaIds['P-01']);
  const card = page.getByTestId(`question-${questionId}`);
  await card.getByRole('button', { name: '해결 확인' }).click();
  await card.getByLabel('해결 근거').fill('저장 중 보존할 해결 근거');
  await card.getByLabel('문서 변경 불필요 이유').fill('저장 중 보존할 변경 불필요 이유');
  const second = await app.invoke('M-008', {
    actorId: question.assigneeId, projectId, srId,
    guard: { resource: { target: { kind: 'question', projectId, srId, entityId: questionId }, expectedRevision: first.value.revision } },
  }, { questionId, answeredQuestionSnapshotRef: first.value.currentResult.ref, answer: { kind: 'free_text', text: '최신 답변' }, evidence: { text: '최신 근거' } });
  if (!second.ok) throw new Error('동시 답변을 만들지 못했습니다.');

  await card.getByRole('button', { name: '해결 저장' }).click();
  await expect(card.getByRole('alert')).toBeVisible();
  await expect(card.getByLabel('해결 근거')).toHaveValue('저장 중 보존할 해결 근거');
  await expect(card).toContainText(`최신 질문 revision ${second.value.revision}`);
  await card.getByRole('button', { name: '최신 답변 기준으로 계속 작성' }).click();
  await card.getByRole('button', { name: '해결 저장' }).click();
  await expect(card).toContainText('해결됨');
});

test('불명확한 해결 저장은 같은 idempotency key로 확인한다', async ({ page, app, manifest }) => {
  const projectId = manifest.projectId;
  const srId = manifest.srIds['PAY-102'];
  const questionId = manifest.entityIds['PAY-102'].questionId;
  const initial = await app.invoke('M-047', { actorId: manifest.personaIds['P-02'], projectId, srId }, {});
  if (!initial.ok) throw new Error('질문 fixture를 조회하지 못했습니다.');
  const question = initial.value.questions.find((item) => item.questionId === questionId);
  if (question === undefined) throw new Error('질문 fixture가 없습니다.');
  const answered = await app.invoke('M-008', {
    actorId: question.assigneeId, projectId, srId,
    guard: { resource: { target: { kind: 'question', projectId, srId, entityId: questionId }, expectedRevision: question.revision } },
  }, { questionId, answeredQuestionSnapshotRef: question.currentResult.ref, answer: { kind: 'free_text', text: '확인 답변' }, evidence: { text: '확인 근거' } });
  if (!answered.ok) throw new Error('답변 fixture를 만들지 못했습니다.');

  await openQuestions(page, manifest.personaIds['P-01']);
  const card = page.getByTestId(`question-${questionId}`);
  await card.getByRole('button', { name: '해결 확인' }).click();
  await card.getByLabel('해결 근거').fill('불명확 결과 확인 근거');
  await card.getByLabel('문서 변경 불필요 이유').fill('문서 변경 없음');
  const keys: string[] = [];
  let firstRequest = true;
  await page.route('**/api/methods/M-009', async (route) => {
    const request = route.request().postDataJSON() as { readonly meta: { readonly idempotencyKey: string } };
    keys.push(request.meta.idempotencyKey);
    if (firstRequest) {
      firstRequest = false;
      await route.abort('connectionfailed');
    } else await route.continue();
  });
  await card.getByRole('button', { name: '해결 저장' }).click();
  await expect(card.getByRole('alert')).toContainText('확인해야 합니다');
  await card.getByRole('button', { name: '같은 요청 확인' }).click();
  await expect(card).toContainText('해결됨');
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  await page.unroute('**/api/methods/M-009');
});

test('owner와 decision maker에게만 각 변경 행동을 제공한다', async ({ page, browser, app, manifest }) => {
  const questionId = manifest.entityIds['PAY-102'].questionId;
  const decisionId = manifest.entityIds['PAY-102'].decisionId;
  await openQuestions(page, manifest.personaIds['P-02']);
  const memberQuestion = page.getByTestId(`question-${questionId}`);
  const memberDecision = page.getByTestId(`decision-${decisionId}`);
  await expect(memberQuestion.getByRole('button', { name: '결정으로 전환' })).toHaveCount(0);
  await expect(memberQuestion.getByRole('button', { name: '범위 변경' })).toHaveCount(0);
  await expect(memberDecision.getByRole('button', { name: '재결정' })).toHaveCount(0);

  const maker = await openPersonaContext(browser, app, manifest.personaIds['P-04']);
  try {
    await maker.page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
    await maker.page.getByRole('button', { name: '질문·결정' }).click();
    const makerDecision = maker.page.getByTestId(`decision-${decisionId}`);
    await expect(makerDecision.getByRole('button', { name: '재결정' })).toBeVisible();
    await expect(makerDecision.getByRole('button', { name: '범위 변경' })).toHaveCount(0);
  } finally {
    await maker.context.close();
  }
});

test('재결정의 늦은 성공은 응답 대기 중 바꾼 입력을 저장 완료로 덮지 않는다', async ({ page, manifest }) => {
  const decisionId = manifest.entityIds['PAY-102'].decisionId;
  await openQuestions(page, manifest.personaIds['P-04']);
  const card = page.getByTestId(`decision-${decisionId}`);
  await card.getByRole('button', { name: '재결정' }).click();
  await card.getByRole('radio').last().check();
  await card.getByLabel('새 결정 이유').fill('첫 재결정 이유');
  await card.getByLabel('새 결정 근거').fill('첫 재결정 근거');
  await card.getByLabel('재결정 변경 이유').fill('처음 제출할 변경 이유');
  let release!: () => void;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  const responseRelease = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/methods/M-013', async (route) => {
    started();
    await responseRelease;
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  const submission = card.getByRole('button', { name: '재결정 저장' }).click();
  await requestStarted;
  await card.getByLabel('재결정 변경 이유').fill('응답 대기 중 새로 쓴 변경 이유');
  release();
  await submission;
  await expect(card.getByLabel('재결정 변경 이유')).toHaveValue('응답 대기 중 새로 쓴 변경 이유');
  await expect(card).toContainText('현재 편집은 유지했습니다.');
  await expect(card).toContainText('최신 decision revision');
  await page.unroute('**/api/methods/M-013');
});
