import { test, expect } from '../fixtures/test-app';
import { openPersonaContext } from '../fixtures/personas';

test('가상 사용자와 등록 진입을 같은 작업 공간에 표시한다', async ({ page, app, manifest }) => {
  const workspace = await app.invoke('M-001', {
    actorId: manifest.personaIds['P-01'],
    projectId: manifest.projectId,
  }, {});
  expect(workspace.ok).toBe(true);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'PlanRepo' })).toBeVisible();
  await expect(page.getByRole('navigation')).toContainText('내 검토함');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.getByRole('button', { name: 'SR 등록', exact: true }).click();
  await expect(page.getByTestId('sr-registration-form-title-input')).toBeVisible();
});

test('직접 등록한 SR을 상세 화면과 실제 조회에서 확인한다', async ({ page, app, manifest }) => {
  const externalImageRequests: string[] = [];
  await page.route('https://example.invalid/**', async (route) => {
    externalImageRequests.push(route.request().url());
    await route.abort();
  });
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.getByRole('button', { name: 'SR 등록', exact: true }).click();
  await page.getByLabel('SR 키').fill('UI-801');
  await page.getByLabel('제목').fill('UI 등록 흐름');
  await page.getByLabel('목적').fill('실제 HTTP 등록을 확인한다.');
  await page.getByLabel('설명').fill('<img src="x" onerror="window.__unsafeMarkdown = true">\n\n![외부 이미지](https://example.invalid/private.png)\n\n**브라우저에서 입력한 설명입니다.**');
  await page.getByRole('button', { name: '등록 저장' }).click();

  await expect(page.getByRole('heading', { name: 'UI 등록 흐름', level: 1 })).toBeVisible();
  await expect(page.locator('main img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __unsafeMarkdown?: boolean }).__unsafeMarkdown)).toBeUndefined();
  expect(externalImageRequests).toEqual([]);
  const board = await app.invoke('M-045', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
  }, { search: 'UI-801' });
  expect(board.ok && board.value.cards.some((card) => card.sr.key === 'UI-801')).toBe(true);
});

test('Mock 티켓 키는 M-004 결과의 기존 SR 상세를 연다', async ({ page, manifest }) => {
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.getByRole('button', { name: 'SR 등록', exact: true }).click();
  await page.getByRole('button', { name: 'Mock 키 가져오기' }).click();
  await page.getByLabel('Mock 티켓 키').fill('PAY-102');
  await page.getByRole('button', { name: '가져오기', exact: true }).click();
  await expect(page.getByText('PAY-102', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('PlanRepo');
});

test('설명 변경은 dirty 입력과 읽은 revision으로 저장한 뒤 다시 조회된다', async ({ page, app, manifest }) => {
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  const card = page.locator('.sr-card').filter({ hasText: 'PAY-102' });
  await card.getByRole('button', { name: '상세 열기' }).click();
  const description = page.getByTestId('sr-context-description-input');
  await description.fill('Playwright가 저장한 현재 설명입니다.');
  await expect(page.getByText('저장하지 않은 설명이 있습니다.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '최신 상태 확인' }).click();
  await expect(description).toHaveValue('Playwright가 저장한 현재 설명입니다.');
  await page.getByLabel('변경 이유').fill('UI 저장 경계 확인');
  await page.getByRole('button', { name: '설명 저장' }).click();
  await expect(page.getByText('현재 설명을 저장했습니다.')).toBeVisible();

  const detail = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'],
  }, {});
  expect(detail.ok && detail.value.currentDescription.description).toBe('Playwright가 저장한 현재 설명입니다.');
});

test('설명 충돌 뒤 최신 설명과 비교해 입력을 보존한 새 기준으로 다시 저장한다', async ({ page, app, manifest }) => {
  const before = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'],
  }, {});
  if (!before.ok) throw new Error('상세 조회에 실패했습니다.');

  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
  const description = page.getByTestId('sr-context-description-input');
  await description.fill('충돌 뒤에도 보존할 설명입니다.');
  await page.getByLabel('변경 이유').fill('명시적으로 최신 기준을 채택합니다.');

  const concurrent = await app.invoke('M-005', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'], guard: { resource: {
      target: { kind: 'sr', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'], entityId: manifest.srIds['PAY-102'] },
      expectedRevision: before.value.sr.revision,
    } },
  }, {
    title: before.value.currentDescription.title,
    purpose: before.value.currentDescription.purpose,
    description: '다른 요청이 먼저 저장한 최신 설명입니다.',
    changeReason: '동시 수정 준비',
  });
  if (!concurrent.ok) throw new Error('동시 설명 변경 준비에 실패했습니다.');

  const requests: Array<{ meta: { idempotencyKey: string; guard: { resource: { expectedRevision: number } } } }> = [];
  await page.route('**/api/methods/M-005', async (route) => {
    requests.push(route.request().postDataJSON() as typeof requests[number]);
    await route.continue();
  });
  await page.getByRole('button', { name: '설명 저장' }).click();
  await expect(page.getByRole('alert')).toContainText('SR revision이 이미 바뀌었습니다.');
  await page.getByRole('button', { name: '최신 상태 확인' }).click();

  await expect(page.getByRole('status').getByText('다른 요청이 먼저 저장한 최신 설명입니다.')).toBeVisible();
  await expect(description).toHaveValue('충돌 뒤에도 보존할 설명입니다.');
  await page.getByRole('button', { name: '최신 설명 기준으로 계속 작성' }).click();
  await expect(description).toHaveValue('충돌 뒤에도 보존할 설명입니다.');
  await page.getByRole('button', { name: '설명 저장' }).click();
  await expect(page.getByText('현재 설명을 저장했습니다.')).toBeVisible();

  expect(requests).toHaveLength(2);
  expect(requests[0]?.meta.guard.resource.expectedRevision).toBe(before.value.sr.revision);
  expect(requests[1]?.meta.guard.resource.expectedRevision).toBe(concurrent.value.revision);
  expect(requests[1]?.meta.idempotencyKey).not.toBe(requests[0]?.meta.idempotencyKey);
  const after = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'],
  }, {});
  expect(after.ok && after.value.currentDescription.description).toBe('충돌 뒤에도 보존할 설명입니다.');
});

test('다섯 가상 사용자는 같은 앱에서 각 브라우저 context에 독립 저장된다', async ({ browser, app, manifest }) => {
  const contexts = [];
  try {
    for (const personaId of Object.values(manifest.personaIds)) {
      contexts.push(await openPersonaContext(browser, app, personaId));
    }
    for (const [index, personaId] of Object.values(manifest.personaIds).entries()) {
      const persona = contexts[index];
      if (persona === undefined) throw new Error('persona context가 없습니다.');
      await expect(persona.page.getByLabel('가상 사용자')).toHaveValue(personaId);
      await persona.page.reload();
      await expect(persona.page.getByLabel('가상 사용자')).toHaveValue(personaId);
    }
  } finally {
    await Promise.all(contexts.map(({ context }) => context.close()));
  }
});

test('명령의 200 응답을 해석할 수 없으면 같은 요청 확인과 dirty 입력을 유지한다', async ({ page, manifest }) => {
  const idempotencyKeys: string[] = [];
  let releaseRetry!: () => void;
  let sawRetry!: () => void;
  const retryStarted = new Promise<void>((resolve) => { sawRetry = resolve; });
  const retryRelease = new Promise<void>((resolve) => { releaseRetry = resolve; });
  await page.route('**/api/methods/M-003', async (route) => {
    const body = route.request().postDataJSON() as { meta: { idempotencyKey: string } };
    idempotencyKeys.push(body.meta.idempotencyKey);
    if (idempotencyKeys.length > 1) {
      sawRetry();
      await retryRelease;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{' });
  });
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.getByRole('button', { name: 'SR 등록', exact: true }).click();
  await page.getByLabel('SR 키').fill('UI-UNKNOWN');
  await page.getByLabel('제목').fill('결과 확인 필요');
  await page.getByLabel('목적').fill('불명확한 응답 처리');
  await page.getByLabel('설명').fill('입력을 보존해야 합니다.');
  await page.getByRole('button', { name: '등록 저장' }).click();

  await expect(page.getByText('저장 결과를 확인해야 합니다.', { exact: false })).toBeVisible();
  await expect(page.getByTestId('sr-registration-form-title-input')).toHaveValue('결과 확인 필요');
  await page.getByTestId('sr-registration-form-title-input').fill('후속 편집은 보존');
  await page.getByRole('button', { name: '같은 요청 확인' }).click({ clickCount: 2 });
  await retryStarted;
  await expect.poll(() => idempotencyKeys.length).toBe(2);
  expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
  releaseRetry();
  await expect(page.getByTestId('sr-registration-form-title-input')).toHaveValue('후속 편집은 보존');
});

test('등록 저장을 빠르게 두 번 눌러도 같은 attempt의 HTTP는 한 번만 실행한다', async ({ page, manifest }) => {
  let requests = 0;
  let sawRequest!: () => void;
  let releaseRequest!: () => void;
  const requestStarted = new Promise<void>((resolve) => { sawRequest = resolve; });
  const requestRelease = new Promise<void>((resolve) => { releaseRequest = resolve; });
  await page.route('**/api/methods/M-003', async (route) => {
    requests += 1;
    sawRequest();
    await requestRelease;
    await route.continue();
  });

  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.getByRole('button', { name: 'SR 등록', exact: true }).click();
  await page.getByLabel('SR 키').fill('UI-DOUBLE-801');
  await page.getByLabel('제목').fill('중복 제출 방지');
  await page.getByLabel('목적').fill('같은 attempt를 한 번만 실행한다.');
  await page.getByLabel('설명').fill('빠른 두 번 제출을 합칩니다.');
  await page.getByRole('button', { name: '등록 저장' }).click({ clickCount: 2 });
  await requestStarted;
  await expect.poll(() => requests).toBe(1);
  releaseRequest();
  await expect(page.getByRole('heading', { name: '중복 제출 방지', level: 1 })).toBeVisible();
});

test('초기 보드 조회 중 같은 가상 사용자를 다시 선택해도 조회를 잃지 않는다', async ({ page, manifest }) => {
  let releaseBoard!: () => void;
  let sawBoard!: () => void;
  const boardBlocked = new Promise<void>((resolve) => { sawBoard = resolve; });
  const release = new Promise<void>((resolve) => { releaseBoard = resolve; });
  await page.route('**/api/methods/M-045', async (route) => {
    sawBoard();
    await release;
    await route.continue();
  });
  await page.goto('/');
  await boardBlocked;
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  releaseBoard();
  const card = page.locator('.sr-card').filter({ hasText: 'PAY-102' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('담당자 SR 담당자');
  await expect(card).not.toContainText('persona-p01-owner');
});

test('닫힌 등록 폼의 늦은 성공은 바뀐 actor 화면을 상세로 전환하지 않는다', async ({ page, manifest }) => {
  let releaseRegistration!: () => void;
  let sawRegistration!: () => void;
  const registrationStarted = new Promise<void>((resolve) => { sawRegistration = resolve; });
  const registrationRelease = new Promise<void>((resolve) => { releaseRegistration = resolve; });
  await page.route('**/api/methods/M-003', async (route) => {
    sawRegistration();
    await registrationRelease;
    await route.continue();
  });

  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.getByRole('button', { name: 'SR 등록', exact: true }).click();
  await page.getByLabel('SR 키').fill('UI-LATE-801');
  await page.getByLabel('제목').fill('늦은 등록 결과');
  await page.getByLabel('목적').fill('현재 actor 화면을 바꾸지 않는다.');
  await page.getByLabel('설명').fill('서버 확정 사실과 현재 UI 적용을 분리한다.');
  await page.getByRole('button', { name: '등록 저장' }).click();
  await registrationStarted;

  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-02']);
  releaseRegistration();

  await expect(page.getByLabel('가상 사용자')).toHaveValue(manifest.personaIds['P-02']);
  await expect(page.getByRole('heading', { name: 'PlanRepo', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '늦은 등록 결과', level: 1 })).toHaveCount(0);
});

test('현재 보드 조회 실패는 loading을 끝내고 같은 actor로 재시도한다', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/methods/M-045', async (route) => {
    requests += 1;
    if (requests === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: {
          code: 'STORE_UNAVAILABLE', message: '보드 조회를 완료하지 못했습니다.',
          blockers: [], assigneeIds: [], targetRefs: [],
        } }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('보드 조회를 완료하지 못했습니다.');
  await expect(page.getByText('보드를 불러오고 있습니다.')).toHaveCount(0);
  await page.getByRole('button', { name: '보드 다시 시도' }).click();
  await expect(page.locator('.sr-card').filter({ hasText: 'PAY-102' })).toBeVisible();
  expect(requests).toBe(2);
});

test('상세 조회 오류에서 뒤로가거나 재시도하고 갱신 실패에도 dirty 입력을 보존한다', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/methods/M-047', async (route) => {
    requests += 1;
    if (requests === 1 || requests === 3) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: {
          code: 'STORE_UNAVAILABLE', message: '상세 조회를 완료하지 못했습니다.',
          blockers: [], assigneeIds: [], targetRefs: [],
        } }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
  await expect(page.getByRole('alert')).toContainText('상세 조회를 완료하지 못했습니다.');
  await expect(page.getByRole('button', { name: '← 팀 보드' })).toBeVisible();
  await expect(page.getByText('SR 상세를 불러오고 있습니다.')).toHaveCount(0);
  await page.getByRole('button', { name: '상세 다시 시도' }).click();
  await expect(page.getByRole('heading', { name: '결제 취소 기능', level: 1 })).toBeVisible();

  const description = page.getByTestId('sr-context-description-input');
  await description.fill('조회 실패 중에도 남아야 하는 설명입니다.');
  await page.getByRole('button', { name: '최신 상태 확인' }).click();
  await expect(page.getByRole('alert')).toContainText('상세 조회를 완료하지 못했습니다.');
  await expect(description).toHaveValue('조회 실패 중에도 남아야 하는 설명입니다.');
});

test('링크 근거를 자동 조회하지 않고 확인 가능성과 사람 확인 상태를 분리해 등록한다', async ({ page, app, manifest }) => {
  const externalRequests: string[] = [];
  await page.route('https://example.invalid/**', async (route) => {
    externalRequests.push(route.request().url());
    await route.abort();
  });

  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
  await page.getByLabel('근거 종류').selectOption('link');
  await page.getByLabel('근거 표시 이름').fill('외부 정책 원문');
  await page.getByLabel('근거 출처').fill('사용자가 제공한 정책 링크입니다.');
  await page.getByLabel('근거 URL').fill('https://example.invalid/reference');
  await page.getByLabel('관찰한 외부 버전').fill('policy-v3');
  await page.getByLabel('확인 불가 이유').fill('격리 데모에서는 외부 통신을 사용하지 않습니다.');
  await page.getByRole('button', { name: '근거 추가' }).click();

  await expect(page.getByText('근거를 추가했습니다.')).toBeVisible();
  const source = page.locator('[data-testid^="context-source-"]').filter({ hasText: '외부 정책 원문' });
  await expect(source).toContainText('확인 불가');
  await expect(source).toContainText('사람 확인 전');
  await expect(source).toContainText('https://example.invalid/reference');
  expect(externalRequests).toEqual([]);

  const detail = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'],
  }, {});
  expect(detail.ok && detail.value.sources.some((item) =>
    item.kind === 'link' && item.targetUrl === 'https://example.invalid/reference' &&
    item.verifiable === false && item.confirmation === 'unconfirmed' &&
    item.observedExternalVersion === 'policy-v3' &&
    item.unavailableReason === '격리 데모에서는 외부 통신을 사용하지 않습니다.')).toBe(true);
});

test('SR 담당자가 UI로 등록한 link의 정확한 version과 guard로 사람 확인을 기록한다', async ({ page, app, manifest }) => {
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
  await page.getByLabel('근거 종류').selectOption('link');
  await page.getByLabel('근거 표시 이름').fill('확인할 정책 링크');
  await page.getByLabel('근거 출처').fill('담당자가 받은 링크');
  await page.getByLabel('근거 URL').fill('https://example.invalid/confirm-source');
  await page.getByRole('button', { name: '근거 추가' }).click();
  await expect(page.getByText('근거를 추가했습니다.')).toBeVisible();

  const before = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'],
  }, {});
  if (!before.ok) throw new Error('확인 전 상세 조회에 실패했습니다.');
  const sourceView = before.value.sources.find((item) =>
    item.kind === 'link' && item.targetUrl === 'https://example.invalid/confirm-source');
  if (sourceView === undefined) throw new Error('확인할 근거를 찾지 못했습니다.');

  let requestBody: unknown;
  await page.route('**/api/methods/M-007', async (route) => {
    requestBody = route.request().postDataJSON();
    await route.continue();
  });
  const source = page.getByTestId(`context-source-${sourceView.sourceId}`);
  await source.getByLabel('사람 확인 근거').fill('담당자가 정책 원문을 직접 확인했습니다.');
  await source.getByRole('button', { name: '사람 확인 기록' }).click();

  await expect(source).toContainText('사람 확인 완료');
  await expect(source).toContainText('담당자가 정책 원문을 직접 확인했습니다.');
  await expect(source).toContainText('확인자: SR 담당자');
  await expect(source).not.toContainText(manifest.personaIds['P-01']);
  expect(requestBody).toMatchObject({
    scope: { kind: 'sr', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'] },
    input: {
      sourceVersionRef: sourceView.currentVersionRef,
      confirmationEvidence: '담당자가 정책 원문을 직접 확인했습니다.',
    },
    meta: { guard: { resource: {
      target: {
        kind: 'context_source', projectId: manifest.projectId,
        srId: manifest.srIds['PAY-102'], entityId: sourceView.sourceId,
      },
      expectedRevision: sourceView.revision,
    } } },
  });
  const after = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'],
  }, {});
  expect(after.ok && after.value.sources.some((item) =>
    item.sourceId === sourceView.sourceId && item.confirmation === 'confirmed' &&
    item.confirmedBy === manifest.personaIds['P-01'] &&
    item.previousVersionRef?.version === sourceView.currentVersionRef.version &&
    item.currentVersionRef.version === sourceView.currentVersionRef.version + 1)).toBe(true);
});

test('SR 담당자가 아닌 사용자의 확인 거절은 확인 근거 입력을 보존한다', async ({ page, app, manifest }) => {
  const before = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-02'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'],
  }, {});
  if (!before.ok) throw new Error('상세 조회에 실패했습니다.');
  const attached = await app.invoke('M-006', {
    actorId: manifest.personaIds['P-02'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'],
    guard: { resource: {
      target: { kind: 'sr', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'], entityId: manifest.srIds['PAY-102'] },
      expectedRevision: before.value.sr.revision,
    } },
  }, { kind: 'text', content: '권한 확인용 근거', provenance: '동료가 추가함' });
  if (!attached.ok) throw new Error('근거 준비에 실패했습니다.');

  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-02']);
  await page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
  const source = page.getByTestId(`context-source-${attached.value.sourceId}`);
  const evidence = source.getByLabel('사람 확인 근거');
  await evidence.fill('동료가 확인을 시도한 내용입니다.');
  await source.getByRole('button', { name: '사람 확인 기록' }).click();

  await expect(source.getByRole('alert')).toContainText('현재 SR 담당자만 이 작업을 할 수 있습니다.');
  await expect(evidence).toHaveValue('동료가 확인을 시도한 내용입니다.');
  await expect(source).toContainText('사람 확인 전');
});

test('확인 중 source version이 바뀌면 stale 오류와 작성한 확인 근거를 보존한다', async ({ page, app, manifest }) => {
  const before = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'],
  }, {});
  if (!before.ok) throw new Error('상세 조회에 실패했습니다.');
  const attached = await app.invoke('M-006', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'],
    guard: { resource: {
      target: { kind: 'sr', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'], entityId: manifest.srIds['PAY-102'] },
      expectedRevision: before.value.sr.revision,
    } },
  }, { kind: 'markdown', content: '# 오래된 확인 기준', provenance: '담당자 입력' });
  if (!attached.ok) throw new Error('근거 준비에 실패했습니다.');

  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
  const source = page.getByTestId(`context-source-${attached.value.sourceId}`);
  const evidence = source.getByLabel('사람 확인 근거');
  await evidence.fill('UI가 읽은 version에 대한 확인입니다.');

  const concurrent = await app.invoke('M-007', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'],
    guard: { resource: {
      target: {
        kind: 'context_source', projectId: manifest.projectId,
        srId: manifest.srIds['PAY-102'], entityId: attached.value.sourceId,
      },
      expectedRevision: attached.value.revision,
    } },
  }, {
    sourceVersionRef: attached.value.currentVersionRef,
    confirmationEvidence: '다른 요청이 먼저 확인했습니다.',
  });
  if (!concurrent.ok) throw new Error('동시 확인 준비에 실패했습니다.');

  await source.getByRole('button', { name: '사람 확인 기록' }).click();
  await expect(source.getByRole('alert')).toContainText('자료의 현재 revision 또는 version이 이미 바뀌었습니다.');
  await expect(evidence).toHaveValue('UI가 읽은 version에 대한 확인입니다.');

  await page.getByRole('button', { name: '최신 상태 확인' }).click();
  await expect(source).toContainText('다른 요청이 먼저 확인했습니다.');
  await expect(source).toContainText('작성 중인 확인 근거: UI가 읽은 version에 대한 확인입니다.');
  await expect(source.getByRole('button', { name: '사람 확인 기록' })).toHaveCount(0);
  await source.getByRole('button', { name: '작성 중 확인 근거 폐기' }).click();
  await expect(source).not.toContainText('작성 중인 확인 근거:');
  await expect(source).toContainText('다른 요청이 먼저 확인했습니다.');
});

test('근거 충돌 뒤 최신 SR과 비교해 본문을 보존한 새 기준으로 다시 저장한다', async ({ page, app, manifest }) => {
  const before = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'],
  }, {});
  if (!before.ok) throw new Error('상세 조회에 실패했습니다.');
  await page.goto('/');
  await page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
  await page.getByLabel('근거 종류').selectOption('markdown');
  await page.getByLabel('근거 표시 이름').fill('작성 중인 근거');
  await page.getByLabel('근거 출처').fill('작성자 메모');
  await page.getByLabel('근거 본문').fill('# 저장 전 본문');

  const concurrent = await app.invoke('M-006', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'], guard: { resource: {
      target: { kind: 'sr', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'], entityId: manifest.srIds['PAY-102'] },
      expectedRevision: before.value.sr.revision,
    } },
  }, { kind: 'text', content: '동시 변경', provenance: '다른 요청' });
  if (!concurrent.ok) throw new Error('동시 변경 준비에 실패했습니다.');
  await page.getByRole('button', { name: '최신 상태 확인' }).click();

  await expect(page.getByLabel('근거 종류')).toHaveValue('markdown');
  await expect(page.getByLabel('근거 표시 이름')).toHaveValue('작성 중인 근거');
  await expect(page.getByLabel('근거 출처')).toHaveValue('작성자 메모');
  await expect(page.getByLabel('근거 본문')).toHaveValue('# 저장 전 본문');
  await expect(page.getByText('저장하지 않은 근거가 있습니다.', { exact: false })).toBeVisible();

  const requestBodies: Array<{ meta: { idempotencyKey: string; guard: { resource: { expectedRevision: number } } } }> = [];
  await page.route('**/api/methods/M-006', async (route) => {
    requestBodies.push(route.request().postDataJSON() as typeof requestBodies[number]);
    await route.continue();
  });
  await page.getByRole('button', { name: '근거 추가' }).click();
  await expect(page.getByRole('region', { name: '근거' }).getByRole('alert')).toContainText('SR revision이 이미 바뀌었습니다.');
  expect(requestBodies[0]).toMatchObject({ meta: { guard: { resource: {
    target: {
      kind: 'sr', projectId: manifest.projectId,
      srId: manifest.srIds['PAY-102'], entityId: manifest.srIds['PAY-102'],
    },
    expectedRevision: before.value.sr.revision,
  } } } });
  await expect(page.getByLabel('근거 본문')).toHaveValue('# 저장 전 본문');
  await expect(page.getByText(`최신 SR revision ${before.value.sr.revision + 1}`)).toBeVisible();
  await page.getByRole('button', { name: '최신 SR 기준으로 계속 작성' }).click();
  await expect(page.getByLabel('근거 본문')).toHaveValue('# 저장 전 본문');
  await page.getByRole('button', { name: '근거 추가' }).click();
  await expect(page.getByText('근거를 추가했습니다.')).toBeVisible();
  expect(requestBodies).toHaveLength(2);
  expect(requestBodies[1]?.meta.guard.resource.expectedRevision).toBe(before.value.sr.revision + 1);
  expect(requestBodies[1]?.meta.idempotencyKey).not.toBe(requestBodies[0]?.meta.idempotencyKey);
});

test('SOURCE 저장 직후 늦은 상세 조회는 다음 입력을 보존하고 최신 기준 채택을 제공한다', async ({ page, manifest }) => {
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();

  let releaseRefresh!: () => void;
  let sawRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => { sawRefresh = resolve; });
  const refreshRelease = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  await page.route('**/api/methods/M-047', async (route) => {
    sawRefresh();
    await refreshRelease;
    await route.continue();
  });

  await page.getByLabel('근거 표시 이름').fill('첫 저장 근거');
  await page.getByLabel('근거 출처').fill('첫 저장');
  await page.getByLabel('근거 본문').fill('첫 본문');
  await page.getByRole('button', { name: '근거 추가' }).click();
  await expect(page.getByText('근거를 추가했습니다.')).toBeVisible();
  await refreshStarted;
  await page.getByLabel('근거 표시 이름').fill('조회 중 작성한 다음 근거');
  await page.getByLabel('근거 출처').fill('다음 저장');
  await page.getByLabel('근거 본문').fill('늦은 조회에도 보존할 본문');
  releaseRefresh();

  await expect(page.getByRole('button', { name: '최신 SR 기준으로 계속 작성' })).toBeVisible();
  await expect(page.getByLabel('근거 본문')).toHaveValue('늦은 조회에도 보존할 본문');
  await page.getByRole('button', { name: '최신 SR 기준으로 계속 작성' }).click();
  await page.getByRole('button', { name: '근거 추가' }).click();
  await expect(page.getByText('근거를 추가했습니다.')).toBeVisible();
  await expect(page.locator('[data-testid^="context-source-"]').filter({ hasText: '조회 중 작성한 다음 근거' })).toBeVisible();
});

test('SOURCE 추가와 확인을 빠르게 두 번 눌러도 각 attempt의 HTTP는 한 번만 실행한다', async ({ page, app, manifest }) => {
  let addRequests = 0;
  let sawAdd!: () => void;
  let releaseAdd!: () => void;
  const addStarted = new Promise<void>((resolve) => { sawAdd = resolve; });
  const addRelease = new Promise<void>((resolve) => { releaseAdd = resolve; });
  await page.route('**/api/methods/M-006', async (route) => {
    addRequests += 1;
    sawAdd();
    await addRelease;
    await route.continue();
  });

  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
  await page.getByLabel('근거 표시 이름').fill('중복 실행 확인 근거');
  await page.getByLabel('근거 출처').fill('실제 브라우저 입력');
  await page.getByLabel('근거 본문').fill('한 번만 저장할 본문');
  await page.getByRole('button', { name: '근거 추가' }).click({ clickCount: 2 });
  await addStarted;
  await expect.poll(() => addRequests).toBe(1);
  releaseAdd();
  await expect(page.getByText('근거를 추가했습니다.')).toBeVisible();
  await page.unroute('**/api/methods/M-006');

  const detail = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'],
  }, {});
  if (!detail.ok) throw new Error('추가한 근거 조회에 실패했습니다.');
  const added = detail.value.sources.find((source) => source.displayName === '중복 실행 확인 근거');
  if (added === undefined) throw new Error('추가한 근거가 없습니다.');

  let confirmationRequests = 0;
  let sawConfirmation!: () => void;
  let releaseConfirmation!: () => void;
  const confirmationStarted = new Promise<void>((resolve) => { sawConfirmation = resolve; });
  const confirmationRelease = new Promise<void>((resolve) => { releaseConfirmation = resolve; });
  await page.route('**/api/methods/M-007', async (route) => {
    confirmationRequests += 1;
    sawConfirmation();
    await confirmationRelease;
    await route.continue();
  });
  const source = page.getByTestId(`context-source-${added.sourceId}`);
  await source.getByLabel('사람 확인 근거').fill('중복 없이 확인합니다.');
  await source.getByRole('button', { name: '사람 확인 기록' }).click({ clickCount: 2 });
  await confirmationStarted;
  await expect.poll(() => confirmationRequests).toBe(1);
  releaseConfirmation();
  await expect(source).toContainText('사람 확인 완료');
});

test('닫힌 SOURCE 폼의 늦은 성공은 새 actor 화면에 적용하지 않지만 서버 확정은 보존한다', async ({ page, app, manifest }) => {
  let sawSource!: () => void;
  let releaseSource!: () => void;
  const sourceStarted = new Promise<void>((resolve) => { sawSource = resolve; });
  const sourceRelease = new Promise<void>((resolve) => { releaseSource = resolve; });
  await page.route('**/api/methods/M-006', async (route) => {
    sawSource();
    await sourceRelease;
    await route.continue();
  });

  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
  await page.getByLabel('근거 표시 이름').fill('늦은 SOURCE 결과');
  await page.getByLabel('근거 출처').fill('이전 actor 입력');
  await page.getByLabel('근거 본문').fill('서버에는 확정됩니다.');
  await page.getByRole('button', { name: '근거 추가' }).click();
  await sourceStarted;
  await page.getByRole('button', { name: '← 팀 보드' }).click();
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-02']);
  releaseSource();

  await expect(page.getByLabel('가상 사용자')).toHaveValue(manifest.personaIds['P-02']);
  await expect(page.getByRole('heading', { name: 'PlanRepo', level: 1 })).toBeVisible();
  const detail = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-02'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'],
  }, {});
  expect(detail.ok && detail.value.sources.some((source) => source.displayName === '늦은 SOURCE 결과')).toBe(true);
});

test('서로 다른 source의 사람 확인 draft를 섞지 않는다', async ({ page, app, manifest }) => {
  const before = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'],
  }, {});
  if (!before.ok) throw new Error('상세 조회에 실패했습니다.');
  const first = await app.invoke('M-006', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'], guard: { resource: {
      target: { kind: 'sr', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'], entityId: manifest.srIds['PAY-102'] },
      expectedRevision: before.value.sr.revision,
    } },
  }, { kind: 'text', content: '첫 번째', provenance: 'source A', displayName: '근거 A' });
  if (!first.ok) throw new Error('첫 근거 준비에 실패했습니다.');
  const middle = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'],
  }, {});
  if (!middle.ok) throw new Error('중간 상세 조회에 실패했습니다.');
  const second = await app.invoke('M-006', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
    srId: manifest.srIds['PAY-102'], guard: { resource: {
      target: { kind: 'sr', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'], entityId: manifest.srIds['PAY-102'] },
      expectedRevision: middle.value.sr.revision,
    } },
  }, { kind: 'text', content: '두 번째', provenance: 'source B', displayName: '근거 B' });
  if (!second.ok) throw new Error('둘째 근거 준비에 실패했습니다.');

  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
  const firstInput = page.getByTestId(`context-source-${first.value.sourceId}`).getByLabel('사람 확인 근거');
  const secondInput = page.getByTestId(`context-source-${second.value.sourceId}`).getByLabel('사람 확인 근거');
  await firstInput.fill('근거 A에만 남는 입력');

  await expect(firstInput).toHaveValue('근거 A에만 남는 입력');
  await expect(secondInput).toHaveValue('');
});

test('Markdown 근거의 이미지 구문은 외부 요청 없이 텍스트 참조로 표시한다', async ({ page, manifest }) => {
  const externalRequests: string[] = [];
  await page.route('https://example.invalid/**', async (route) => {
    externalRequests.push(route.request().url());
    await route.abort();
  });

  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
  await page.getByLabel('근거 종류').selectOption('markdown');
  await page.getByLabel('근거 표시 이름').fill('외부 이미지가 든 Markdown');
  await page.getByLabel('근거 출처').fill('사용자가 붙여 넣은 문서');
  await page.getByLabel('근거 본문').fill('![비공개 화면](https://example.invalid/source-image.png)\n\n본문');
  await page.getByRole('button', { name: '근거 추가' }).click();

  const source = page.locator('[data-testid^="context-source-"]').filter({ hasText: '외부 이미지가 든 Markdown' });
  await expect(source.locator('img')).toHaveCount(0);
  await expect(source).toContainText('이미지 참조: 비공개 화면');
  expect(externalRequests).toEqual([]);
});

test('허용하지 않는 link URL의 400 오류를 표시하고 SOURCE 입력을 보존한다', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
  await page.getByLabel('근거 종류').selectOption('link');
  await page.getByLabel('근거 표시 이름').fill('거절할 링크');
  await page.getByLabel('근거 출처').fill('입력 검증');
  const url = page.getByLabel('근거 URL');
  await url.fill('https://user:secret@example.invalid/private');
  await page.getByRole('button', { name: '근거 추가' }).click();

  await expect(page.getByRole('region', { name: '근거' }).getByRole('alert')).toBeVisible();
  await expect(url).toHaveValue('https://user:secret@example.invalid/private');
  await expect(page.getByLabel('근거 표시 이름')).toHaveValue('거절할 링크');
  await expect(page.getByLabel('근거 출처')).toHaveValue('입력 검증');
});

test('SOURCE의 malformed 200은 같은 key 확인으로 복구하고 입력을 임의 확정하지 않는다', async ({ page }) => {
  const idempotencyKeys: string[] = [];
  await page.route('**/api/methods/M-006', async (route) => {
    const body = route.request().postDataJSON() as { meta: { idempotencyKey: string } };
    idempotencyKeys.push(body.meta.idempotencyKey);
    if (idempotencyKeys.length === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ kind: 'Committed', value: null, receipt: {} }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.locator('.sr-card').filter({ hasText: 'PAY-102' }).getByRole('button', { name: '상세 열기' }).click();
  await page.getByLabel('근거 표시 이름').fill('응답 확인 근거');
  await page.getByLabel('근거 출처').fill('malformed 응답 테스트');
  await page.getByLabel('근거 본문').fill('확정 여부를 다시 확인합니다.');
  await page.getByRole('button', { name: '근거 추가' }).click();

  await expect(page.getByText('저장 결과를 확인해야 합니다.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('근거 본문')).toHaveValue('확정 여부를 다시 확인합니다.');
  await page.getByRole('button', { name: '같은 요청 확인' }).click();
  await expect.poll(() => idempotencyKeys.length).toBe(2);
  expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
  await expect(page.locator('[data-testid^="context-source-"]').filter({ hasText: '응답 확인 근거' })).toBeVisible();
});
