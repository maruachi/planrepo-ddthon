import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/test-app';

async function openArtifactTab(page: Page, actorId: string, srKey: string, tab: '요구사항' | '진행 계획·설계' | '구현 계획') {
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(actorId);
  await page.locator('.sr-card').filter({ hasText: srKey }).getByRole('button', { name: '상세 열기' }).click();
  await page.getByRole('button', { name: tab, exact: true }).click();
}

function visibleWorkspace(page: Page) {
  return page.locator('[data-testid="artifact-workspace"]:visible');
}

async function fillSingleRequirement(page: Page, markdown: string, summary: string) {
  const workspace = visibleWorkspace(page);
  await workspace.getByLabel('Markdown 원문').fill(markdown);
  await workspace.getByRole('button', { name: '구조 초기화' }).click();
  await expect(workspace.getByLabel('시작 offset', { exact: true })).toHaveCount(0);
  await expect(workspace.getByLabel('끝 offset', { exact: true })).toHaveCount(0);
  await workspace.getByLabel('섹션 ID', { exact: true }).fill('REQ-UI');
  await workspace.getByLabel('요구사항 ID', { exact: true }).fill('REQ-UI');
  await workspace.getByLabel('연결 섹션 ID', { exact: true }).fill('REQ-UI');
  await workspace.getByLabel('수용 기준', { exact: true }).fill('브라우저에서 원문과 구조를 저장합니다.');
  await workspace.getByLabel('문서 개정 사유', { exact: true }).fill(summary);
}

test('owner가 요구사항 원문과 구조·추적 참조를 새 버전으로 저장한다', async ({ page, app, manifest }) => {
  const before = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  }, {});
  if (!before.ok) throw new Error('문서 fixture가 없습니다.');
  const current = before.value.artifacts.find((artifact) => artifact.kind === 'requirements');
  if (current === undefined) throw new Error('요구사항 fixture가 없습니다.');

  await openArtifactTab(page, manifest.personaIds['P-01'], 'PAY-102', '요구사항');
  const workspace = visibleWorkspace(page);
  await expect(workspace.getByLabel('Markdown 원문')).toHaveValue(current.markdown);
  await expect(workspace).toContainText(`문서 v${current.versionRef.version}`);
  await expect(workspace).toContainText('작성자');

  const markdown = '## REQ-UI UI 요구사항\nREQ-UI 브라우저 편집 내용을 저장합니다.\n';
  await fillSingleRequirement(page, markdown, 'UI에서 요구사항을 개정합니다.');
  const decision = before.value.decisions[0]?.currentConfirmation?.ref;
  if (decision !== undefined) await workspace.getByLabel(`결정 ${decision.entityId} v${decision.version}`).check();
  const source = before.value.sources[0]?.currentVersionRef;
  if (source !== undefined) await workspace.getByLabel(`근거 ${source.entityId} v${source.version}`).check();
  const question = before.value.questions[0]?.currentResult.ref;
  if (question !== undefined) await workspace.getByLabel(`질문 결과 ${question.entityId} v${question.version}`).check();
  await workspace.getByRole('button', { name: '문서 저장' }).click();

  await expect(workspace).toContainText(`문서 v${current.versionRef.version + 1}`);
  await expect(workspace.getByRole('status')).toContainText('문서를 저장했습니다.');
  await expect(workspace).toContainText('이번 저장 결과: 검토 영향 G1, G2');
  const after = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  }, {});
  if (!after.ok) throw new Error('저장 문서를 읽지 못했습니다.');
  const saved = after.value.artifacts.find((artifact) => artifact.artifactId === current.artifactId);
  expect(saved).toMatchObject({
    markdown, changeSummary: 'UI에서 요구사항을 개정합니다.',
    requirementLinks: [{ requirementId: 'REQ-UI', sectionIds: ['REQ-UI'] }],
  });
  expect(saved?.decisionRefs).toEqual(decision === undefined ? [] : [decision]);
  expect(saved?.sourceRefs).toEqual(source === undefined ? [] : [source]);
  expect(saved?.questionResultRefs).toEqual(question === undefined ? [] : [question]);
});

test('구현 계획 원문을 개정하고 문서 탭 왕복 동안 dirty 입력을 보존한다', async ({ page, app, manifest }) => {
  await openArtifactTab(page, manifest.personaIds['P-01'], 'AUTH-331', '구현 계획');
  const workspace = visibleWorkspace(page);
  const markdown = '## REQ-UI UI 구현 계획\nREQ-UI 구현과 검증을 연결합니다.\n';
  await fillSingleRequirement(page, markdown, '구현 계획을 개정합니다.');
  await page.getByRole('button', { name: '검토 요약' }).click();
  await page.getByRole('button', { name: '구현 계획', exact: true }).click();
  await expect(workspace.getByLabel('Markdown 원문')).toHaveValue(markdown);
  await workspace.getByRole('button', { name: '문서 저장' }).click();
  await expect(workspace.getByRole('status')).toContainText('문서를 저장했습니다.');

  const detail = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['AUTH-331'],
  }, {});
  expect(detail.ok && detail.value.artifacts).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'implementation_plan', markdown }),
  ]));
});

test('SR owner가 아닌 멤버는 문서 원문과 구조를 읽지만 저장할 수 없다', async ({ page, manifest }) => {
  await openArtifactTab(page, manifest.personaIds['P-02'], 'PAY-102', '요구사항');
  const workspace = visibleWorkspace(page);
  await expect(workspace).toContainText('현재 SR owner만 문서를 저장할 수 있습니다.');
  await expect(workspace.getByLabel('Markdown 원문')).toHaveAttribute('readonly', '');
  await expect(workspace.getByRole('button', { name: '문서 저장' })).toHaveCount(0);
  await expect(workspace).not.toContainText('인계 유효');
  await expect(workspace).not.toContainText('현재 검토 유지');
});

test('빈 SR에 단계가 분리된 functional design을 만든다', async ({ page, app, manifest }) => {
  const key = `DESIGN-${randomUUID().slice(0, 8)}`;
  const registered = await app.invoke('M-003', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
  }, {
    key, title: '설계 문서 UI', purpose: '설계 단계 구분', description: 'functional 설계를 작성합니다.',
    ownerId: manifest.personaIds['P-01'],
  });
  if (!registered.ok) throw new Error('SR fixture를 만들지 못했습니다.');
  await openArtifactTab(page, manifest.personaIds['P-01'], key, '진행 계획·설계');
  await page.getByLabel('문서 대상').selectOption('design:functional');
  const markdown = '## REQ-UI UI 요구사항\nREQ-UI 기능 설계를 기록합니다.\n';
  await fillSingleRequirement(page, markdown, 'functional 설계를 처음 작성합니다.');
  await visibleWorkspace(page).getByRole('button', { name: '문서 저장' }).click();

  const detail = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: registered.value.scope.srId,
  }, {});
  expect(detail.ok && detail.value.artifacts).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'design', designStage: 'functional', markdown }),
  ]));
});

test('수용 기준의 쉼표를 문장 안에 보존하고 section 제목과 offset은 원문에서 계산한다', async ({ page, app, manifest }) => {
  await openArtifactTab(page, manifest.personaIds['P-01'], 'PAY-102', '요구사항');
  const markdown = '## REQ-UI 쉼표 기준\nREQ-UI A, B를 함께 확인합니다.\n';
  await fillSingleRequirement(page, markdown, '구조 계산을 확인합니다.');
  const workspace = visibleWorkspace(page);
  await workspace.getByLabel('수용 기준', { exact: true }).fill('A, B를 함께 확인합니다.');
  await workspace.getByRole('button', { name: '문서 저장' }).click();
  await expect(workspace.getByRole('status')).toContainText('문서를 저장했습니다.');

  const detail = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  }, {});
  if (!detail.ok) throw new Error('저장 문서를 읽지 못했습니다.');
  const saved = detail.value.artifacts.find((artifact) => artifact.kind === 'requirements');
  expect(saved?.sectionIndex).toEqual([{ sectionId: 'REQ-UI', title: '쉼표 기준', startOffset: 0, endOffset: markdown.length }]);
  expect(saved?.requirementLinks[0]?.acceptanceCriteria).toEqual(['A, B를 함께 확인합니다.']);
});

test('M-016으로 고정된 두 version 원문과 요구사항·결정·section 변경을 비교한다', async ({ page, app, manifest }) => {
  const detail = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['CAT-093'],
  }, {});
  if (!detail.ok) throw new Error('비교 fixture가 없습니다.');
  const current = detail.value.artifacts.find((artifact) => artifact.kind === 'requirements');
  if (current?.previousVersionRef === undefined) throw new Error('두 version fixture가 없습니다.');
  const expected = await app.invoke('M-016', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['CAT-093'],
  }, { before: current.previousVersionRef, after: current.versionRef });
  if (!expected.ok) throw new Error('비교 fixture를 만들지 못했습니다.');

  await openArtifactTab(page, manifest.personaIds['P-01'], 'CAT-093', '요구사항');
  await visibleWorkspace(page).getByRole('button', { name: '이전 버전과 비교' }).click();
  const comparison = page.getByTestId('version-comparison');
  await expect(comparison.getByTestId('comparison-before')).toHaveText(expected.value.before.markdown);
  await expect(comparison.getByTestId('comparison-after')).toHaveText(expected.value.after.markdown);
  for (const id of expected.value.changedRequirementIds) await expect(comparison).toContainText(id);
  for (const id of expected.value.changedSectionIds) await expect(comparison).toContainText(id);
  for (const ref of expected.value.changedDecisionRefs) await expect(comparison).toContainText(`${ref.entityId} v${ref.version}`);
});

test('비교 중 문서 version이 바뀌면 이전 pair의 늦은 M-016 응답을 표시하지 않는다', async ({ page, app, manifest }) => {
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['CAT-093'],
  };
  const detail = await app.invoke('M-047', scope, {});
  if (!detail.ok) throw new Error('비교 fixture가 없습니다.');
  const current = detail.value.artifacts.find((artifact) => artifact.kind === 'requirements');
  if (current?.previousVersionRef === undefined || current.kind !== 'requirements') throw new Error('두 version fixture가 없습니다.');
  await openArtifactTab(page, scope.actorId, 'CAT-093', '요구사항');
  const workspace = visibleWorkspace(page);

  let release!: () => void;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  const responseRelease = new Promise<void>((resolve) => { release = resolve; });
  let delayed = true;
  await page.route('**/api/methods/M-016', async (route) => {
    if (!delayed) return route.continue();
    delayed = false;
    started();
    await responseRelease;
    await route.continue();
  });
  await workspace.getByRole('button', { name: '이전 버전과 비교' }).click();
  await requestStarted;

  const saved = await app.invoke('M-015', {
    ...scope,
    guard: { resource: { target: {
      kind: 'artifact', projectId: scope.projectId, srId: scope.srId, entityId: current.artifactId,
    }, expectedRevision: current.revision } },
  }, {
    kind: 'requirements', artifactId: current.artifactId, markdown: current.markdown,
    sectionIndex: current.sectionIndex, requirementLinks: current.requirementLinks,
    changeSummary: '비교 중 새 version을 저장합니다.', targetBasis: { kind: 'version', ref: current.versionRef },
    decisionRefs: current.decisionRefs, sourceRefs: current.sourceRefs, questionResultRefs: current.questionResultRefs,
  });
  expect(saved.ok).toBe(true);
  await page.getByRole('button', { name: '최신 상태 확인' }).first().click();
  await expect(workspace).toContainText(`문서 v${current.versionRef.version + 1}`);
  const staleResponse = page.waitForResponse((response) => response.url().includes('/api/methods/M-016'));
  release();
  await staleResponse;
  await expect(workspace.getByText(`이전 v${current.previousVersionRef.version}`, { exact: true })).toHaveCount(0);
  await page.unroute('**/api/methods/M-016');
});

test('409 뒤 dirty 원문을 보존하고 최신 기준을 명시적으로 채택하거나 폐기한다', async ({ page, app, manifest }) => {
  const initial = await app.invoke('M-047', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  }, {});
  if (!initial.ok) throw new Error('문서 fixture가 없습니다.');
  const artifact = initial.value.artifacts.find((item) => item.kind === 'requirements');
  if (artifact === undefined || artifact.kind !== 'requirements') throw new Error('요구사항 fixture가 없습니다.');
  await openArtifactTab(page, manifest.personaIds['P-01'], 'PAY-102', '요구사항');
  const dirtyMarkdown = '## REQ-UI UI 요구사항\nREQ-UI 충돌 뒤에도 보존할 원문입니다.\n';
  await fillSingleRequirement(page, dirtyMarkdown, '충돌 뒤 저장합니다.');

  const concurrent = await app.invoke('M-015', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
    guard: { resource: { target: {
      kind: 'artifact', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'], entityId: artifact.artifactId,
    }, expectedRevision: artifact.revision } },
  }, {
    kind: artifact.kind, artifactId: artifact.artifactId, markdown: artifact.markdown,
    sectionIndex: artifact.sectionIndex, requirementLinks: artifact.requirementLinks,
    changeSummary: '다른 요청이 먼저 저장했습니다.', targetBasis: { kind: 'version', ref: artifact.versionRef },
    decisionRefs: artifact.decisionRefs, sourceRefs: artifact.sourceRefs, questionResultRefs: artifact.questionResultRefs,
  });
  expect(concurrent.ok).toBe(true);

  const workspace = visibleWorkspace(page);
  await workspace.getByRole('button', { name: '문서 저장' }).click();
  await expect(workspace.getByRole('alert')).toContainText('revision');
  await expect(workspace.getByLabel('Markdown 원문')).toHaveValue(dirtyMarkdown);
  await workspace.getByRole('button', { name: '최신 상태 확인' }).click();
  await expect(workspace.locator('.basis-comparison')).toContainText('최신 문서 v2');
  await expect(workspace.getByLabel('Markdown 원문')).toHaveValue(dirtyMarkdown);
  await workspace.getByRole('button', { name: '최신 문서 기준으로 계속 작성' }).click();
  await expect(workspace.getByLabel('Markdown 원문')).toHaveValue(dirtyMarkdown);
  await workspace.getByRole('button', { name: '작성 중 문서 폐기' }).click();
  await expect(workspace.getByLabel('Markdown 원문')).toHaveValue(artifact.markdown);
});

test('409 뒤 최신 기준을 채택하지 않고 폐기해도 v2 원문과 guard로 복원한다', async ({ page, app, manifest }) => {
  const scope = {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  };
  const initial = await app.invoke('M-047', scope, {});
  if (!initial.ok) throw new Error('문서 fixture가 없습니다.');
  const artifact = initial.value.artifacts.find((item) => item.kind === 'requirements');
  if (artifact === undefined || artifact.kind !== 'requirements') throw new Error('요구사항 fixture가 없습니다.');
  await openArtifactTab(page, scope.actorId, 'PAY-102', '요구사항');
  const workspace = visibleWorkspace(page);
  const dirtyMarkdown = '## REQ-UI 작성 중 요구사항\nREQ-UI는 보존 중입니다.\n';
  await fillSingleRequirement(page, dirtyMarkdown, '충돌을 재현합니다.');

  const concurrentMarkdown = '## REQ-CURRENT 최신 요구사항\nREQ-CURRENT는 다른 요청이 저장했습니다.\n';
  const concurrent = await app.invoke('M-015', {
    ...scope,
    guard: { resource: { target: {
      kind: 'artifact', projectId: scope.projectId, srId: scope.srId, entityId: artifact.artifactId,
    }, expectedRevision: artifact.revision } },
  }, {
    kind: 'requirements', artifactId: artifact.artifactId, markdown: concurrentMarkdown,
    sectionIndex: [{ sectionId: 'REQ-CURRENT', title: '최신 요구사항', startOffset: 0, endOffset: concurrentMarkdown.length }],
    requirementLinks: [{ requirementId: 'REQ-CURRENT', sectionIds: ['REQ-CURRENT'], acceptanceCriteria: ['다른 요청의 현재 기준'] }],
    changeSummary: '다른 요청이 원문을 바꿉니다.', targetBasis: { kind: 'version', ref: artifact.versionRef },
    decisionRefs: [], sourceRefs: [], questionResultRefs: [],
  });
  expect(concurrent.ok).toBe(true);

  await workspace.getByRole('button', { name: '문서 저장' }).click();
  await expect(workspace.getByRole('alert')).toContainText('revision');
  await workspace.getByRole('button', { name: '최신 상태 확인' }).click();
  await expect(workspace.locator('.basis-comparison')).toContainText('최신 문서 v2');
  await workspace.getByRole('button', { name: '작성 중 문서 폐기' }).click();
  await expect(workspace.getByLabel('Markdown 원문')).toHaveValue(concurrentMarkdown);

  const finalMarkdown = '## REQ-UI 최종 요구사항\nREQ-UI는 최신 기준에서 저장합니다.\n';
  await fillSingleRequirement(page, finalMarkdown, '최신 v2를 기준으로 개정합니다.');
  await workspace.getByRole('button', { name: '문서 저장' }).click();
  await expect(workspace.getByRole('status')).toContainText('문서를 저장했습니다.');
  const detail = await app.invoke('M-047', scope, {});
  const saved = detail.ok && detail.value.artifacts.find((item) => item.kind === 'requirements');
  expect(saved).toMatchObject({ markdown: finalMarkdown, versionRef: { version: 3 } });
});

test('지연된 저장 응답 뒤 새 dirty 원문을 보존하고 실제 저장 version을 다시 읽는다', async ({ page, manifest }) => {
  await openArtifactTab(page, manifest.personaIds['P-01'], 'PAY-102', '요구사항');
  const first = '## REQ-UI UI 요구사항\nREQ-UI 먼저 제출한 원문입니다.\n';
  await fillSingleRequirement(page, first, '먼저 제출합니다.');
  const workspace = visibleWorkspace(page);
  let release!: () => void;
  let sawRequest!: () => void;
  const started = new Promise<void>((resolve) => { sawRequest = resolve; });
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/methods/M-015', async (route) => {
    sawRequest();
    await waiting;
    await route.continue();
  });
  const submission = workspace.getByRole('button', { name: '문서 저장' }).click();
  await started;
  const changed = '## REQ-UI UI 요구사항\nREQ-UI 응답 대기 중 바꾼 원문입니다.\n';
  await workspace.getByLabel('Markdown 원문').fill(changed);
  release();
  await submission;

  await expect(workspace.getByLabel('Markdown 원문')).toHaveValue(changed);
  await expect(workspace).toContainText('이전 문서의 저장 결과를 확인했습니다. 현재 편집은 유지했습니다.');
  await expect(workspace.locator('.basis-comparison')).toContainText('최신 문서 v2');
  await page.unroute('**/api/methods/M-015');
});
