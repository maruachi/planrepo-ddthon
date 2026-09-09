import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures/test-app';
import type { TestApp } from '../../helpers/test-app';
import type { DemoManifest } from '../../helpers/demo-manifest';

async function openSettings(page: import('@playwright/test').Page, actorId: string) {
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(actorId);
  await page.getByRole('button', { name: '팀 설정' }).click();
}

async function openSr(page: import('@playwright/test').Page, actorId: string, srKey: string) {
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(actorId);
  await page.locator('.sr-card').filter({ hasText: srKey }).getByRole('button', { name: '상세 열기' }).click();
}

async function createSr(app: TestApp, manifest: DemoManifest, title: string) {
  const ownerId = manifest.personaIds['P-01'];
  const key = `UI-POLICY-${randomUUID().slice(0, 8)}`;
  const created = await app.invoke('M-003', { actorId: ownerId, projectId: manifest.projectId }, {
    key, title, purpose: '검토 정책 UI 검증', description: '정책과 검토자 배정을 준비합니다.', ownerId,
  });
  if (!created.ok) throw new Error('SR fixture를 만들지 못했습니다.');
  return { key, srId: created.value.scope.srId, ownerId };
}

test('team admin이 고정 승인 원칙을 유지한 새 기본 정책 버전을 만들고 기존 SR에는 소급하지 않는다', async ({ page, app, manifest }) => {
  const adminId = manifest.personaIds['P-05'];
  const beforeWorkspace = await app.invoke('M-001', { actorId: adminId, projectId: manifest.projectId }, {});
  const beforeDetail = await app.invoke('M-047', {
    actorId: adminId, projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  }, {});
  if (!beforeWorkspace.ok || !beforeDetail.ok || beforeWorkspace.value.defaultPolicyRef === undefined) {
    throw new Error('정책 fixture를 읽지 못했습니다.');
  }
  const previousDefault = beforeWorkspace.value.defaultPolicyRef;
  const previousSrPolicy = beforeDetail.value.reviewConfigurations.find((item) => item.gate === 'G1')?.policy?.policyRef;

  await openSettings(page, adminId);
  const editor = page.getByRole('region', { name: '팀 검토 정책' });
  await expect(editor).toContainText('지정된 검토자 전원 승인');
  await expect(editor).toContainText('담당자 외 동료 승인');
  await editor.getByLabel('정책 저장 방식').selectOption('revision');
  await editor.getByLabel('정책 설명').fill('회귀 검토 정책');
  await editor.getByLabel('G1 필수 역할').fill('reviewer\nbusiness_requester');
  await editor.getByLabel('G1 체크리스트').fill('g1-scope | 범위와 완료 기준 확인\ng1-evidence | 근거 확인');
  await editor.getByLabel('G2 필수 역할').fill('reviewer');
  await editor.getByLabel('G2 체크리스트').fill('g2-plan | 계획과 검증 확인');
  await editor.getByLabel('정책 변경 이유').fill('팀 검토 기준을 구체화합니다.');
  await editor.getByRole('button', { name: '정책 버전 저장' }).click();
  await expect(editor).toContainText('새 기본 정책 버전을 저장했습니다.');

  const afterWorkspace = await app.invoke('M-001', { actorId: adminId, projectId: manifest.projectId }, {});
  const afterDetail = await app.invoke('M-047', {
    actorId: adminId, projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
  }, {});
  expect(afterWorkspace.ok && afterWorkspace.value.defaultPolicyRef?.version).toBe(previousDefault.version + 1);
  expect(afterDetail.ok && afterDetail.value.reviewConfigurations.find((item) => item.gate === 'G1')?.policy?.policyRef)
    .toEqual(previousSrPolicy);
  await expect(editor).toContainText('기존 SR에는 자동 적용되지 않습니다.');
});

test('문서 없는 SR에 owner만 배정해도 저장하며 묶음 없이 준비 부족을 표시한다', async ({ page, app, manifest }) => {
  const adminId = manifest.personaIds['P-05'];
  const { key, srId, ownerId } = await createSr(app, manifest, '문서 없는 배정');

  await openSr(page, adminId, key);
  const assignment = page.getByRole('region', { name: '검토자와 정책 배정' });
  await assignment.getByLabel('G1 검토자 SR 담당자').check();
  await assignment.getByRole('button', { name: 'G1 검토자 저장' }).click();
  await expect(assignment).toContainText('G1 배정을 저장했습니다.');
  await expect(assignment).toContainText('준비 부족');

  const detail = await app.invoke('M-047', {
    actorId: adminId, projectId: manifest.projectId, srId,
  }, {});
  if (!detail.ok) throw new Error('배정 결과를 조회하지 못했습니다.');
  expect(detail.value.reviewConfigurations.find((item) => item.gate === 'G1')?.assignment).toMatchObject({
    gate: 'G1', reviewerIds: [ownerId], ready: false,
  });
  expect(detail.value.bundles).toHaveLength(0);
});

test('빈 검토자 배정도 저장하되 준비 완료로 표시하지 않는다', async ({ page, app, manifest }) => {
  const adminId = manifest.personaIds['P-05'];
  const { key, srId } = await createSr(app, manifest, '빈 검토자 배정');
  await openSr(page, adminId, key);
  const panel = page.getByRole('region', { name: '검토자와 정책 배정' });
  await panel.getByRole('button', { name: 'G1 검토자 저장' }).click();
  await expect(panel).toContainText('G1 배정을 저장했습니다.');
  await expect(panel).toContainText('준비 부족');
  const detail = await app.invoke('M-047', { actorId: adminId, projectId: manifest.projectId, srId }, {});
  expect(detail.ok && detail.value.reviewConfigurations.find((item) => item.gate === 'G1')?.assignment).toMatchObject({
    gate: 'G1', reviewerIds: [], ready: false,
  });
});

test('선택한 두 gate에 같은 정책을 각 gate의 exact revision guard로 적용한다', async ({ page, app, manifest }) => {
  const adminId = manifest.personaIds['P-05'];
  const { key, srId } = await createSr(app, manifest, '복수 gate 정책 적용');
  const before = await app.invoke('M-047', { actorId: adminId, projectId: manifest.projectId, srId }, {});
  if (!before.ok) throw new Error('초기 SR 정책을 읽지 못했습니다.');
  const oldPolicy = before.value.reviewConfigurations.find((item) => item.gate === 'G1')?.policy?.policyRef;
  if (oldPolicy === undefined) throw new Error('초기 정책이 없습니다.');
  const newPolicy = await app.invoke('M-029', { actorId: adminId, projectId: manifest.projectId }, {
    previousPolicyRef: oldPolicy,
    changeReason: '복수 gate UI 검증 정책',
    description: '복수 gate 적용 정책',
    gates: {
      G1: { requiredRoles: ['reviewer'], checklist: [{ itemId: 'g1-new', label: 'G1 새 기준' }] },
      G2: { requiredRoles: ['reviewer'], checklist: [{ itemId: 'g2-new', label: 'G2 새 기준' }] },
    },
    requireAllAssigned: true,
    requireDistinctPeer: true,
  });
  if (!newPolicy.ok) throw new Error('새 정책 fixture를 만들지 못했습니다.');

  await openSr(page, adminId, key);
  const assignment = page.getByRole('region', { name: '검토자와 정책 배정' });
  await assignment.getByLabel('적용 정책').selectOption(`${newPolicy.value.policyRef.entityId}:${newPolicy.value.policyRef.version}`);
  await assignment.getByRole('button', { name: '선택 gate에 정책 적용' }).click();
  await expect(assignment).toContainText('G1·G2 정책을 적용했습니다.');

  const after = await app.invoke('M-047', { actorId: adminId, projectId: manifest.projectId, srId }, {});
  if (!after.ok) throw new Error('정책 적용 결과를 읽지 못했습니다.');
  for (const gate of ['G1', 'G2'] as const) {
    const previous = before.value.reviewConfigurations.find((item) => item.gate === gate);
    const current = after.value.reviewConfigurations.find((item) => item.gate === gate);
    expect(current?.policy?.policyRef).toEqual(newPolicy.value.policyRef);
    expect(current?.revision).toBeGreaterThan(previous?.revision ?? -1);
  }
});

test('배정 409 뒤 dirty 선택을 보존하고 최신 gate 기준을 명시적으로 채택한다', async ({ page, app, manifest }) => {
  const adminId = manifest.personaIds['P-05'];
  const ownerId = manifest.personaIds['P-01'];
  const reviewerId = manifest.personaIds['P-03'];
  const { key, srId } = await createSr(app, manifest, '배정 충돌');
  const before = await app.invoke('M-047', { actorId: adminId, projectId: manifest.projectId, srId }, {});
  if (!before.ok) throw new Error('배정 기준을 읽지 못했습니다.');
  const g1 = before.value.reviewConfigurations.find((item) => item.gate === 'G1');
  if (g1 === undefined) throw new Error('G1 설정이 없습니다.');

  await openSr(page, adminId, key);
  const panel = page.getByRole('region', { name: '검토자와 정책 배정' });
  await panel.getByLabel('G1 검토자 SR 담당자').check();
  const concurrent = await app.invoke('M-030', {
    actorId: adminId, projectId: manifest.projectId, srId,
    guard: { resource: { target: { kind: 'review_gate_state', projectId: manifest.projectId, srId, entityId: 'G1' }, expectedRevision: g1.revision } },
  }, { gate: 'G1', reviewerIds: [reviewerId] });
  if (!concurrent.ok) throw new Error('동시 배정을 만들지 못했습니다.');
  await panel.getByRole('button', { name: 'G1 검토자 저장' }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel.getByLabel('G1 검토자 SR 담당자')).toBeChecked();
  await expect(panel).toContainText('서버의 최신 배정 기준이 바뀌었습니다.');
  await panel.getByRole('button', { name: '현재 선택에 최신 기준 사용' }).click();
  await panel.getByLabel('배정 변경 이유').fill('동시 변경 뒤 담당자를 선택합니다.');
  await panel.getByRole('button', { name: 'G1 검토자 저장' }).click();
  await expect(panel).toContainText('G1 배정을 저장했습니다.');
  const after = await app.invoke('M-047', { actorId: adminId, projectId: manifest.projectId, srId }, {});
  expect(after.ok && after.value.reviewConfigurations.find((item) => item.gate === 'G1')?.assignment?.reviewerIds).toEqual([ownerId]);
});

test('불명확한 배정 저장은 같은 idempotency key로 확인한다', async ({ page, app, manifest }) => {
  const adminId = manifest.personaIds['P-05'];
  const { key } = await createSr(app, manifest, '불명확 배정');
  await openSr(page, adminId, key);
  const panel = page.getByRole('region', { name: '검토자와 정책 배정' });
  await panel.getByLabel('G1 검토자 SR 담당자').check();
  const keys: string[] = [];
  let first = true;
  await page.route('**/api/methods/M-030', async (route) => {
    const body = route.request().postDataJSON() as { meta: { idempotencyKey: string } };
    keys.push(body.meta.idempotencyKey);
    if (first) { first = false; await route.abort('connectionfailed'); } else await route.continue();
  });
  await panel.getByRole('button', { name: 'G1 검토자 저장' }).click();
  await expect(panel.getByRole('alert')).toContainText('확인해야 합니다');
  await panel.getByRole('button', { name: '같은 요청 확인' }).click();
  await expect(panel).toContainText('G1 배정을 저장했습니다.');
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test('배정의 늦은 성공은 응답 대기 중 바꾼 선택을 유지한다', async ({ page, app, manifest }) => {
  const adminId = manifest.personaIds['P-05'];
  const { key } = await createSr(app, manifest, '늦은 배정 응답');
  await openSr(page, adminId, key);
  const panel = page.getByRole('region', { name: '검토자와 정책 배정' });
  await panel.getByLabel('G1 검토자 SR 담당자').check();
  let release!: () => void;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  const responseRelease = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/methods/M-030', async (route) => { started(); await responseRelease; const response = await route.fetch(); await route.fulfill({ response }); });
  const saving = panel.getByRole('button', { name: 'G1 검토자 저장' }).click();
  await requestStarted;
  await panel.getByLabel('G1 검토자 동료 검토자').check();
  release();
  await saving;
  await expect(panel.getByLabel('G1 검토자 SR 담당자')).toBeChecked();
  await expect(panel.getByLabel('G1 검토자 동료 검토자')).toBeChecked();
  await expect(panel).toContainText('현재 선택은 유지했습니다.');
});

test('정책 저장 중 유지한 편집은 최신 policy ref를 명시적으로 채택하기 전 저장되지 않는다', async ({ page, app, manifest }) => {
  const adminId = manifest.personaIds['P-05'];
  const initial = await app.invoke('M-001', { actorId: adminId, projectId: manifest.projectId }, {});
  if (!initial.ok || initial.value.defaultPolicyRef === undefined) throw new Error('초기 정책을 읽지 못했습니다.');
  await openSettings(page, adminId);
  const editor = page.getByRole('region', { name: '팀 검토 정책' });
  await editor.getByLabel('정책 설명').fill('먼저 저장할 정책 A');
  await editor.getByLabel('정책 변경 이유').fill('정책 A 변경 이유');
  let release!: () => void;
  let committed!: (response: import('@playwright/test').APIResponse) => void;
  const responseRelease = new Promise<void>((resolve) => { release = resolve; });
  const serverCommitted = new Promise<import('@playwright/test').APIResponse>((resolve) => { committed = resolve; });
  await page.route('**/api/methods/M-029', async (route) => {
    const response = await route.fetch();
    committed(response);
    await responseRelease;
    await route.fulfill({ response });
  });
  const firstSave = editor.getByRole('button', { name: '정책 버전 저장' }).click();
  const firstResponse = await serverCommitted;
  const firstBody = await firstResponse.json() as { value: { policyRef: typeof initial.value.defaultPolicyRef } };
  await editor.getByLabel('정책 설명').fill('응답 대기 중 편집한 정책 B');
  await editor.getByLabel('정책 변경 이유').fill('정책 B 변경 이유');
  const third = await app.invoke('M-029', { actorId: adminId, projectId: manifest.projectId }, {
    previousPolicyRef: firstBody.value.policyRef,
    changeReason: '동시 정책 C 변경 이유',
    description: '동시에 저장한 정책 C',
    gates: {
      G1: { requiredRoles: ['reviewer'], checklist: [{ itemId: 'g1-c', label: 'G1 C 기준' }] },
      G2: { requiredRoles: ['reviewer'], checklist: [{ itemId: 'g2-c', label: 'G2 C 기준' }] },
    }, requireAllAssigned: true, requireDistinctPeer: true,
  });
  if (!third.ok) throw new Error('동시 정책을 저장하지 못했습니다.');
  release();
  await firstSave;
  await expect(editor).toContainText('현재 입력은 유지했습니다.');
  await expect(editor).toContainText('서버의 최신 정책이 바뀌었습니다.');
  await editor.getByRole('button', { name: '정책 버전 저장' }).click();
  await expect(editor.getByRole('alert')).toContainText('현재 기본 정책 버전이 바뀌었습니다.');
  const beforeAdopt = await app.invoke('M-001', { actorId: adminId, projectId: manifest.projectId }, {});
  expect(beforeAdopt.ok && beforeAdopt.value.defaultPolicyRef).toEqual(third.value.policyRef);
  await editor.getByRole('button', { name: '현재 입력에 최신 기준 사용' }).click();
  await editor.getByRole('button', { name: '정책 버전 저장' }).click();
  await expect(editor).toContainText('새 기본 정책 버전을 저장했습니다.');
  const after = await app.invoke('M-001', { actorId: adminId, projectId: manifest.projectId }, {});
  expect(after.ok && after.value.defaultPolicyRef?.version).toBe(third.value.policyRef.version + 1);
  await page.unroute('**/api/methods/M-029');
});

test('기존 배정 저장 중 바꾼 변경 이유는 늦은 성공 뒤에도 유지한다', async ({ page, app, manifest }) => {
  const adminId = manifest.personaIds['P-05'];
  const ownerId = manifest.personaIds['P-01'];
  const reviewerId = manifest.personaIds['P-03'];
  const { key, srId } = await createSr(app, manifest, '배정 이유 지연 응답');
  const before = await app.invoke('M-047', { actorId: adminId, projectId: manifest.projectId, srId }, {});
  if (!before.ok) throw new Error('초기 배정 기준을 읽지 못했습니다.');
  const g1 = before.value.reviewConfigurations.find((item) => item.gate === 'G1');
  if (g1 === undefined) throw new Error('G1 설정이 없습니다.');
  const initial = await app.invoke('M-030', {
    actorId: adminId, projectId: manifest.projectId, srId,
    guard: { resource: { target: { kind: 'review_gate_state', projectId: manifest.projectId, srId, entityId: 'G1' }, expectedRevision: g1.revision } },
  }, { gate: 'G1', reviewerIds: [ownerId] });
  if (!initial.ok) throw new Error('초기 배정을 저장하지 못했습니다.');
  await openSr(page, adminId, key);
  const panel = page.getByRole('region', { name: '검토자와 정책 배정' });
  await panel.getByLabel('G1 검토자 동료 검토자').check();
  await panel.getByLabel('배정 변경 이유').fill('먼저 제출할 배정 이유');
  let release!: () => void;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  const responseRelease = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/methods/M-030', async (route) => { const response = await route.fetch(); started(); await responseRelease; await route.fulfill({ response }); });
  const saving = panel.getByRole('button', { name: 'G1 검토자 저장' }).click();
  await requestStarted;
  await panel.getByLabel('배정 변경 이유').fill('응답 대기 중 새로 쓴 배정 이유');
  release();
  await saving;
  await expect(panel).toContainText('현재 선택은 유지했습니다.');
  await expect(panel.getByLabel('배정 변경 이유')).toHaveValue('응답 대기 중 새로 쓴 배정 이유');
  await expect(panel).toContainText('저장하지 않은 검토자 선택이 있습니다.');
  await page.unroute('**/api/methods/M-030');
  void reviewerId;
});
