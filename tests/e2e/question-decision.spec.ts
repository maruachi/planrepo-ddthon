import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures/test-app';
import { openPersonaContext } from './fixtures/personas';
import { applyDecisionDraftSelections } from '@/src/persistence/question-decision-repository';
import { createPersistence } from '@/src/persistence/transaction';

async function openQuestions(page: import('@playwright/test').Page, actorId: string, srKey = 'PAY-102') {
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(actorId);
  await page.locator('.sr-card').filter({ hasText: srKey }).getByRole('button', { name: '상세 열기' }).click();
  await page.getByRole('button', { name: '질문·결정' }).click();
}

test('배정된 자유 입력 질문에 근거와 함께 답하고 answered와 resolved를 구분한다', async ({ page, app, manifest }) => {
  const questionId = manifest.entityIds['PAY-102'].questionId;
  await openQuestions(page, manifest.personaIds['P-02']);
  const question = page.getByTestId(`question-${questionId}`);

  await expect(question).toContainText('부분 취소·중복 요청·외부 실패');
  await expect(question).toContainText('취소 기간 결정만으로 예외 흐름이 완성되지 않습니다.');
  await question.getByLabel('직접 작성 답변').fill('부분 취소와 외부 실패를 각각 멱등 처리합니다.');
  await question.getByLabel('답변 근거').fill('업무 담당자가 취소 정책을 확인했습니다.');
  await question.getByRole('button', { name: '답변 저장' }).click();

  await expect(question).toContainText('답변됨');
  await expect(question).not.toContainText('해결됨');
  const detail = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-02'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  }, {});
  expect(detail.ok && detail.value.questions.find((item) => item.questionId === questionId)?.status).toBe('answered');
});

test('owner가 담당자와 선택지를 명시한 후속 질문을 만들고 담당자는 직접 작성으로 답한다', async ({ page, browser, app, manifest }) => {
  await openQuestions(page, manifest.personaIds['P-01']);
  const parent = page.getByTestId(`question-${manifest.entityIds['PAY-102'].questionId}`);
  await parent.getByRole('button', { name: '후속 질문 추가' }).click();
  await parent.getByLabel('후속 질문', { exact: true }).fill('재시도 횟수를 선택해 주세요.');
  await parent.getByLabel('후속 질문 이유').fill('외부 결제사 오류 정책을 확정합니다.');
  await parent.getByLabel('후속 질문 담당자').selectOption(manifest.personaIds['P-03']);
  await parent.getByLabel('답변 방식').selectOption('choice');
  await parent.getByLabel('선택지 (한 줄에 하나)').fill('1회\n3회');
  await parent.getByLabel('필요 게이트').selectOption('G2');
  await parent.getByRole('button', { name: '후속 질문 저장' }).click();
  await expect(page.getByText('후속 질문을 저장했습니다.')).toBeVisible();

  const detail = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  }, {});
  if (!detail.ok) throw new Error('후속 질문 조회에 실패했습니다.');
  const created = detail.value.questions.find((item) => item.text === '재시도 횟수를 선택해 주세요.');
  expect(created).toMatchObject({
    assigneeId: manifest.personaIds['P-03'], answerMode: 'choice', requiredGate: 'G2',
    options: [{ text: '1회' }, { text: '3회' }],
  });
  if (created === undefined) throw new Error('후속 질문이 없습니다.');
  const createdCard = page.getByTestId(`question-${created.questionId}`);
  await expect(createdCard).toContainText('선택지');
  await expect(createdCard).toContainText('1회');
  await expect(createdCard).toContainText('3회');

  const persona = await openPersonaContext(browser, app, manifest.personaIds['P-03']);
  try {
    await persona.page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
    await persona.page.getByRole('button', { name: '질문·결정' }).click();
    const question = persona.page.getByTestId(`question-${created.questionId}`);
    await question.getByLabel('직접 작성').check();
    await question.getByLabel('직접 작성 답변').fill('오류 종류에 따라 1회 또는 3회 재시도합니다.');
    await question.getByLabel('답변 근거').fill('운영 정책 원문을 확인했습니다.');
    await question.getByRole('button', { name: '답변 저장' }).click();
    await expect(question).toContainText('답변됨');
  } finally {
    await persona.context.close();
  }
});

test('선택형 질문의 현재 선택지를 근거와 함께 답변으로 저장한다', async ({ page, app, manifest }) => {
  const parentId = manifest.entityIds['PAY-102'].questionId;
  const created = await app.invoke('M-010', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
    idempotencyKey: randomUUID(), guard: { resource: {
      target: { kind: 'question', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'], entityId: parentId },
      expectedRevision: 1,
    } },
  }, {
    parentQuestionId: parentId,
    text: '선택지로 재시도 횟수를 확정합니다.',
    reason: '선택 답변 UI를 확인합니다.',
    assigneeId: manifest.personaIds['P-03'],
    answerMode: 'choice',
    options: [{ optionId: 'once', text: '1회' }, { optionId: 'three', text: '3회' }],
    classification: { scope: 'current', requiredGate: 'G2', reason: '재시도 정책' },
  });
  if (!created.ok) throw new Error('선택형 질문 fixture가 없습니다.');
  await openQuestions(page, manifest.personaIds['P-03']);
  const question = page.getByTestId(`question-${created.value.questionId}`);
  await question.getByLabel('3회').check();
  await question.getByLabel('답변 근거').fill('담당자가 현재 선택지를 확인했습니다.');
  await question.getByRole('button', { name: '답변 저장' }).click();

  await expect(question).toContainText('답변됨');
  await expect(question).toContainText('현재 답변');
  await expect(question).toContainText('3회');
});

test('지정 decision maker가 대안과 근거를 확정하고 다른 actor에게는 확정 form을 숨긴다', async ({ page, browser, app, manifest }) => {
  const persistence = createPersistence(app.db);
  const [mapping] = persistence.withinTransaction((db) => applyDecisionDraftSelections(db, {
    scope: { kind: 'sr', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'] },
    actorId: manifest.personaIds['P-01'],
    occurredAt: '2026-09-09T12:00:00.000Z',
    draftId: `ui-decision-${randomUUID()}`,
    selections: [{
      proposal: {
        temporaryId: 'retry-policy',
        prompt: '외부 결제사 재시도 정책을 선택합니다.',
        alternatives: [
          { optionId: 'once', label: '1회', description: '즉시 한 번 재시도합니다.' },
          { optionId: 'three', label: '3회', description: '지수 지연으로 세 번 재시도합니다.' },
        ],
        impact: '취소 실패 복구 시간에 영향을 줍니다.',
        recommendation: 'three',
        sourceRefs: [],
      },
      decisionMakerId: manifest.personaIds['P-04'],
      classification: { scope: 'current', requiredGate: 'G1', reason: '필수 복구 정책' },
    }],
  }));
  if (mapping === undefined) throw new Error('decision fixture가 없습니다.');

  await openQuestions(page, manifest.personaIds['P-01']);
  const ownerView = page.getByTestId(`decision-${mapping.ref.entityId}`);
  await expect(ownerView).toContainText('결정권자만 확정할 수 있습니다.');
  await expect(ownerView).toContainText('1회');
  await expect(ownerView).toContainText('3회');
  await expect(ownerView).toContainText('추천: 3회');
  await expect(ownerView.getByRole('button', { name: '결정 확정' })).toHaveCount(0);

  const maker = await openPersonaContext(browser, app, manifest.personaIds['P-04']);
  try {
    await maker.page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
    await maker.page.getByRole('button', { name: '질문·결정' }).click();
    const decision = maker.page.getByTestId(`decision-${mapping.ref.entityId}`);
    await decision.getByLabel('3회').check();
    await decision.getByLabel('결정 이유').fill('외부 장애 복구와 중복 방지를 함께 만족합니다.');
    await decision.getByLabel('결정 근거').fill('결정권자가 운영 기준을 확인했습니다.');
    await decision.getByRole('button', { name: '결정 확정' }).click();
    await expect(decision).toContainText('확정됨');
  } finally {
    await maker.context.close();
  }
});

test('409와 늦은 refresh 뒤에도 dirty 답변을 보존하고 terminal 최신 결과의 제한과 폐기를 명시한다', async ({ page, app, manifest }) => {
  const questionId = manifest.entityIds['PAY-102'].questionId;
  await openQuestions(page, manifest.personaIds['P-02']);
  const question = page.getByTestId(`question-${questionId}`);
  const answer = question.getByLabel('직접 작성 답변');
  await answer.fill('충돌 뒤에도 보존할 답변입니다.');
  await question.getByLabel('답변 근거').fill('충돌 재현 근거입니다.');

  const concurrent = await app.invoke('M-008', {
    actorId: manifest.personaIds['P-02'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
    idempotencyKey: randomUUID(), guard: { resource: {
      target: { kind: 'question', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'], entityId: questionId },
      expectedRevision: 1,
    } },
  }, {
    questionId,
    answeredQuestionSnapshotRef: {
      kind: 'question_result', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'], entityId: questionId, version: 1,
    },
    answer: { kind: 'free_text', text: '다른 요청이 먼저 저장한 답변입니다.' },
    evidence: { text: '동시 요청 근거' },
  });
  expect(concurrent.ok).toBe(true);

  await question.getByRole('button', { name: '답변 저장' }).click();
  await expect(question.getByRole('alert')).toContainText('revision이 이미 바뀌었습니다.');
  await expect(answer).toHaveValue('충돌 뒤에도 보존할 답변입니다.');

  let releaseRefresh!: () => void;
  let sawRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => { sawRefresh = resolve; });
  const refreshRelease = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  await page.route('**/api/methods/M-047', async (route) => {
    sawRefresh();
    await refreshRelease;
    await route.continue();
  });
  await page.getByRole('button', { name: '최신 상태 확인' }).click();
  await refreshStarted;
  await expect(answer).toHaveValue('충돌 뒤에도 보존할 답변입니다.');
  releaseRefresh();

  await expect(question.getByRole('status')).toContainText('최신 질문 revision 2');
  await expect(question.getByRole('status')).toContainText('다른 요청이 먼저 저장한 답변입니다.');
  await expect(question).toContainText('추가 답변 저장은 아직 지원하지 않습니다.');
  await expect(question.getByRole('button', { name: '최신 질문 기준으로 계속 작성' })).toHaveCount(0);
  await expect(answer).toHaveValue('충돌 뒤에도 보존할 답변입니다.');

  await page.unroute('**/api/methods/M-047');
  await expect(question.getByRole('button', { name: '작성 중 답변 폐기' })).toBeVisible();
  await question.getByRole('button', { name: '작성 중 답변 폐기' }).click();
  await expect(question.getByLabel('직접 작성 답변')).toHaveCount(0);
  await expect(question).toContainText('다른 요청이 먼저 저장한 답변입니다.');
});

test('답변 저장 응답을 기다리는 동안 바꾼 입력을 보존하고 저장된 최신 상태를 다시 조회한다', async ({ page, manifest }) => {
  const questionId = manifest.entityIds['PAY-102'].questionId;
  await openQuestions(page, manifest.personaIds['P-02']);
  const question = page.getByTestId(`question-${questionId}`);
  const answer = question.getByLabel('직접 작성 답변');
  await answer.fill('처음 제출한 답변입니다.');
  await question.getByLabel('답변 근거').fill('처음 제출한 근거입니다.');

  let release!: () => void;
  let sawRequest!: () => void;
  const requestStarted = new Promise<void>((resolve) => { sawRequest = resolve; });
  const responseRelease = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/methods/M-008', async (route) => {
    sawRequest();
    await responseRelease;
    await route.continue();
  });
  const submission = question.getByRole('button', { name: '답변 저장' }).click();
  await requestStarted;
  await answer.fill('응답 대기 중 새로 작성한 답변입니다.');
  release();
  await submission;

  await expect(answer).toHaveValue('응답 대기 중 새로 작성한 답변입니다.');
  await expect(question).toContainText('이전 답변의 저장 결과를 확인했습니다. 현재 편집은 유지했습니다.');
  await expect(question).toContainText('최신 질문 revision 2 · 답변됨');
  await expect(question).toContainText('처음 제출한 답변입니다.');
});

test('결정 저장 응답을 기다리는 동안 바꾼 선택은 이전 결과가 와도 dirty 상태로 남는다', async ({ page, app, manifest }) => {
  const [mapping] = createPersistence(app.db).withinTransaction((db) => applyDecisionDraftSelections(db, {
    scope: { kind: 'sr', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'] },
    actorId: manifest.personaIds['P-01'],
    occurredAt: '2026-09-09T12:10:00.000Z',
    draftId: `ui-delayed-decision-${randomUUID()}`,
    selections: [{
      proposal: {
        temporaryId: 'delayed-retry-policy',
        prompt: '늦은 응답 중 선택 변경을 보존합니다.',
        alternatives: [
          { optionId: 'once', label: '1회', description: '한 번 재시도합니다.' },
          { optionId: 'three', label: '3회', description: '세 번 재시도합니다.' },
        ],
        impact: '응답 지연 중 편집에 영향을 줍니다.', recommendation: 'three', sourceRefs: [],
      },
      decisionMakerId: manifest.personaIds['P-04'],
      classification: { scope: 'current', requiredGate: 'G1', reason: '결정 입력 보존' },
    }],
  }));
  if (mapping === undefined) throw new Error('decision fixture가 없습니다.');
  await openQuestions(page, manifest.personaIds['P-04']);
  const decision = page.getByTestId(`decision-${mapping.ref.entityId}`);
  await decision.getByLabel('3회').check();
  await decision.getByLabel('결정 이유').fill('처음 제출한 이유입니다.');
  await decision.getByLabel('결정 근거').fill('처음 제출한 근거입니다.');

  let release!: () => void;
  let sawRequest!: () => void;
  const requestStarted = new Promise<void>((resolve) => { sawRequest = resolve; });
  const responseRelease = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/methods/M-012', async (route) => {
    sawRequest();
    await responseRelease;
    await route.continue();
  });
  await decision.getByRole('button', { name: '결정 확정' }).click();
  await requestStarted;
  await decision.getByLabel('1회').check();
  release();

  await expect(decision.getByText('저장하지 않은 결정 입력이 있습니다.', { exact: false })).toBeVisible();
  await expect(decision).toContainText('이전 결정의 확정 결과를 확인했습니다. 현재 편집은 유지했습니다.');
  await expect(decision.getByLabel('1회')).toBeChecked();
  await expect(decision).toContainText('최신 decision revision 2 · 확정됨');
  await expect(decision).toContainText('재확정은 아직 지원하지 않습니다.');
  await expect(decision.getByRole('button', { name: '최신 decision 기준으로 계속 작성' })).toHaveCount(0);
});

test('후속 질문 저장 응답을 기다리는 동안 바꾼 본문을 이전 결과가 덮어쓰지 않는다', async ({ page, manifest }) => {
  await openQuestions(page, manifest.personaIds['P-01']);
  const question = page.getByTestId(`question-${manifest.entityIds['PAY-102'].questionId}`);
  await question.getByRole('button', { name: '후속 질문 추가' }).click();
  const text = page.getByTestId(`followup-text-${manifest.entityIds['PAY-102'].questionId}`);
  await text.fill('처음 제출할 후속 질문입니다.');
  await question.getByLabel('후속 질문 이유').fill('늦은 응답 처리를 확인합니다.');
  await question.getByLabel('후속 질문 담당자').selectOption(manifest.personaIds['P-02']);

  let release!: () => void;
  let sawRequest!: () => void;
  const requestStarted = new Promise<void>((resolve) => { sawRequest = resolve; });
  const responseRelease = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/methods/M-010', async (route) => {
    sawRequest();
    await responseRelease;
    await route.continue();
  });
  const submission = question.getByRole('button', { name: '후속 질문 저장' }).click();
  await requestStarted;
  await text.fill('응답 대기 중 새로 작성한 후속 질문입니다.');
  release();
  await submission;

  await expect(text).toHaveValue('응답 대기 중 새로 작성한 후속 질문입니다.');
  await expect(question.getByText('저장하지 않은 후속 질문이 있습니다.')).toBeVisible();
  await expect(question).toContainText('이전 후속 질문의 저장 결과를 확인했습니다. 현재 편집은 유지했습니다.');
  await expect(page.locator('[data-testid^="question-"]').filter({ hasText: '처음 제출할 후속 질문입니다.' })).toBeVisible();
});

test('부모 질문 revision이 바뀌면 후속 질문 입력을 보존하고 최신 기준을 명시 채택한다', async ({ page, app, manifest }) => {
  const parentId = manifest.entityIds['PAY-102'].questionId;
  await openQuestions(page, manifest.personaIds['P-01']);
  const question = page.getByTestId(`question-${parentId}`);
  await question.getByRole('button', { name: '후속 질문 추가' }).click();
  const text = page.getByTestId(`followup-text-${parentId}`);
  await text.fill('부모 변경 뒤에도 보존할 후속 질문입니다.');
  await question.getByLabel('후속 질문 이유').fill('최신 부모 기준을 채택합니다.');
  await question.getByLabel('후속 질문 담당자').selectOption(manifest.personaIds['P-02']);

  const concurrent = await app.invoke('M-008', {
    actorId: manifest.personaIds['P-02'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
    idempotencyKey: randomUUID(), guard: { resource: {
      target: { kind: 'question', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'], entityId: parentId }, expectedRevision: 1,
    } },
  }, {
    questionId: parentId,
    answeredQuestionSnapshotRef: {
      kind: 'question_result', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'], entityId: parentId, version: 1,
    },
    answer: { kind: 'free_text', text: '동시 요청의 답변입니다.' }, evidence: { text: '동시 요청 근거' },
  });
  expect(concurrent.ok).toBe(true);
  await page.getByRole('button', { name: '최신 상태 확인' }).click();

  await expect(text).toHaveValue('부모 변경 뒤에도 보존할 후속 질문입니다.');
  await expect(question.getByRole('status')).toContainText('최신 부모 질문 revision 2');
  await question.getByRole('button', { name: '최신 부모 질문 기준으로 계속 작성' }).click();
  let submittedRevision: number | undefined;
  await page.route('**/api/methods/M-010', async (route) => {
    submittedRevision = (route.request().postDataJSON() as { meta: { guard: { resource: { expectedRevision: number } } } }).meta.guard.resource.expectedRevision;
    await route.continue();
  });
  await question.getByRole('button', { name: '후속 질문 저장' }).click();
  await expect(question).toContainText('후속 질문을 저장했습니다.');
  expect(submittedRevision).toBe(2);
});

test('탭 왕복 뒤에도 설명과 SOURCE의 저장하지 않은 입력을 유지한다', async ({ page, manifest }) => {
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
  const description = page.getByTestId('sr-context-description-input');
  const provenance = page.getByLabel('근거 출처');
  await description.fill('탭 왕복 뒤에도 남을 설명입니다.');
  await provenance.fill('탭 왕복 뒤에도 남을 SOURCE 출처입니다.');

  await page.getByRole('button', { name: '질문·결정' }).click();
  await page.getByRole('button', { name: '검토 요약' }).click();

  await expect(description).toHaveValue('탭 왕복 뒤에도 남을 설명입니다.');
  await expect(provenance).toHaveValue('탭 왕복 뒤에도 남을 SOURCE 출처입니다.');
});

test('탭 왕복 뒤에도 질문 답변과 결정 확정의 dirty 입력을 유지한다', async ({ page, app, manifest }) => {
  const parentId = manifest.entityIds['PAY-102'].questionId;
  const question = await app.invoke('M-010', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
    idempotencyKey: randomUUID(), guard: { resource: {
      target: { kind: 'question', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'], entityId: parentId }, expectedRevision: 1,
    } },
  }, {
    parentQuestionId: parentId, text: '탭 보존 질문', reason: '탭 상태를 확인합니다.',
    assigneeId: manifest.personaIds['P-01'], answerMode: 'free_text',
    classification: { scope: 'current', requiredGate: 'G1', reason: '탭 상태 확인' },
  });
  if (!question.ok) throw new Error('question fixture가 없습니다.');
  const [decision] = createPersistence(app.db).withinTransaction((db) => applyDecisionDraftSelections(db, {
    scope: { kind: 'sr', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'] },
    actorId: manifest.personaIds['P-01'], occurredAt: '2026-09-09T12:20:00.000Z', draftId: randomUUID(),
    selections: [{
      proposal: {
        temporaryId: 'tab-decision', prompt: '탭 보존 결정',
        alternatives: [{ optionId: 'keep', label: '유지', description: '입력을 유지합니다.' }],
        impact: '탭 상태', recommendation: 'keep', sourceRefs: [],
      },
      decisionMakerId: manifest.personaIds['P-01'],
      classification: { scope: 'current', requiredGate: 'G1', reason: '탭 상태 확인' },
    }],
  }));
  if (decision === undefined) throw new Error('decision fixture가 없습니다.');
  await openQuestions(page, manifest.personaIds['P-01']);
  const questionCard = page.getByTestId(`question-${question.value.questionId}`);
  const decisionCard = page.getByTestId(`decision-${decision.ref.entityId}`);
  await questionCard.getByLabel('직접 작성 답변').fill('탭 왕복 뒤에도 남을 답변입니다.');
  await questionCard.getByLabel('답변 근거').fill('답변 근거입니다.');
  await decisionCard.getByLabel('결정 이유').fill('탭 왕복 뒤에도 남을 결정 이유입니다.');
  await decisionCard.getByLabel('결정 근거').fill('결정 근거입니다.');

  await page.getByRole('button', { name: '검토 요약' }).click();
  await page.getByRole('button', { name: '질문·결정' }).click();

  await expect(questionCard.getByLabel('직접 작성 답변')).toHaveValue('탭 왕복 뒤에도 남을 답변입니다.');
  await expect(decisionCard.getByLabel('결정 이유')).toHaveValue('탭 왕복 뒤에도 남을 결정 이유입니다.');
});
