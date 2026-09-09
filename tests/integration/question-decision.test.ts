import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import manifest from '@/config/demo/manifest.json' with { type: 'json' };
import { prepareGenerationSnapshot } from '@/src/application/generation-snapshot';
import type { DatabaseConnection } from '@/src/persistence/database';
import { readCurrentArtifacts } from '@/src/persistence/artifact-repository';
import { readGenerationBasis } from '@/src/persistence/generation-input-repository';
import { insertInputSnapshot, readInputSnapshot } from '@/src/persistence/input-snapshot-repository';
import { readDecisionView, readQuestionView } from '@/src/persistence/question-decision-repository';
import { createTestApp } from '@/tests/helpers/test-app';

const projectId = manifest.projectId;
const srId = manifest.srIds['PAY-102'];
const questionId = manifest.entityIds['PAY-102'].questionId;
const seededDecisionId = manifest.entityIds['PAY-102'].decisionId;
const ownerId = manifest.personaIds['P-01'];
const requesterId = manifest.personaIds['P-02'];

function questionGuard(revision: number) {
  return {
    resource: {
      target: { kind: 'question' as const, projectId, srId, entityId: questionId },
      expectedRevision: revision,
    },
  };
}

function decisionGuard(decisionId: string, revision: number) {
  return {
    resource: {
      target: { kind: 'decision' as const, projectId, srId, entityId: decisionId },
      expectedRevision: revision,
    },
  };
}

function rewriteReplayValue(
  db: DatabaseConnection,
  actorId: string,
  idempotencyKey: string,
  rewrite: (value: Record<string, unknown>) => Record<string, unknown>,
): void {
  const row = db.prepare(
    'SELECT replay_value_json FROM command_receipts WHERE project_id=? AND actor_id=? AND idempotency_key=?',
  ).get(projectId, actorId, idempotencyKey) as { readonly replay_value_json: string } | undefined;
  if (row === undefined) throw new Error('receipt missing');
  db.prepare(
    'UPDATE command_receipts SET replay_value_json=? WHERE project_id=? AND actor_id=? AND idempotency_key=?',
  ).run(JSON.stringify(rewrite(JSON.parse(row.replay_value_json) as Record<string, unknown>)),
    projectId, actorId, idempotencyKey);
}

describe('question resolution and decision history', () => {
  it('stored replay codec은 question/decision/scope의 추가 필드를 제거하고 필수 필드 손상을 거절합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const initialQuestion = readQuestionView(app.db, { kind: 'sr', projectId, srId }, questionId);
      const initialDecision = readDecisionView(app.db, { kind: 'sr', projectId, srId }, seededDecisionId);
      if (initialQuestion === undefined || initialDecision?.currentConfirmation === undefined) {
        throw new Error('seed question/decision missing');
      }
      const answered = await app.invoke('M-008', {
        actorId: requesterId, projectId, srId, requestId: 'codec-answer', idempotencyKey: 'codec-answer',
        guard: questionGuard(initialQuestion.revision),
      }, {
        questionId,
        answeredQuestionSnapshotRef: initialQuestion.currentResult.ref,
        answer: { kind: 'free_text', text: 'codec 검사용 답변입니다.' },
        evidence: { text: 'codec 검사용 근거입니다.' },
      });
      if (!answered.ok || answered.value.currentResult.selectedAnswer === undefined) {
        throw new Error('answer setup failed');
      }
      const resolutionInput = {
        questionId,
        selectedAnswerRef: answered.value.currentResult.selectedAnswer.ref,
        resolutionEvidence: { text: '현재 요구사항과 일치함을 확인했습니다.' },
        documentDisposition: { kind: 'not_required' as const, reason: '문서 변경이 필요 없습니다.' },
      };
      const resolved = await app.invoke('M-009', {
        actorId: ownerId, projectId, srId, requestId: 'codec-resolve', idempotencyKey: 'codec-resolve',
        guard: questionGuard(answered.value.revision),
      }, resolutionInput);
      if (!resolved.ok) throw new Error(`resolve setup failed: ${resolved.error.code}`);

      const revisionInput = {
        decisionId: seededDecisionId,
        selection: { optionId: 'same-day', text: '당일' },
        rationale: '저장 replay codec을 검증합니다.',
        evidence: { text: '결정권자가 근거를 확인했습니다.' },
        previousVersionRef: initialDecision.currentConfirmation.ref,
        changeReason: 'codec 검사를 위한 재결정입니다.',
      };
      const revised = await app.invoke('M-013', {
        actorId: manifest.personaIds['P-04'], projectId, srId,
        requestId: 'codec-redecide', idempotencyKey: 'codec-redecide',
        guard: decisionGuard(seededDecisionId, initialDecision.revision),
      }, revisionInput);
      if (!revised.ok) throw new Error(`redecide setup failed: ${revised.error.code}`);

      const scopeInput = {
        targetRef: { kind: 'decision' as const, projectId, srId, entityId: seededDecisionId },
        scope: 'current' as const,
        requiredGate: 'G2' as const,
        reason: 'codec 검사를 위해 현재 범위를 다시 분류합니다.',
      };
      const classified = await app.invoke('M-014', {
        actorId: ownerId, projectId, srId, requestId: 'codec-classify', idempotencyKey: 'codec-classify',
        guard: decisionGuard(seededDecisionId, revised.value.revision),
      }, scopeInput);
      if (!classified.ok) throw new Error(`classify setup failed: ${classified.error.code}`);

      app.db.exec('DROP TRIGGER command_receipts_no_update');
      rewriteReplayValue(app.db, ownerId, 'codec-resolve', (value) => ({
        ...value,
        ownershipToken: 'question-secret',
        currentResult: {
          ...(value.currentResult as Record<string, unknown>),
          rawEnvironment: { TOKEN: 'question-secret' },
        },
      }));
      rewriteReplayValue(app.db, manifest.personaIds['P-04'], 'codec-redecide', (value) => ({
        ...value,
        ownershipToken: 'decision-secret',
        currentConfirmation: {
          ...(value.currentConfirmation as Record<string, unknown>),
          rawEnvironment: { TOKEN: 'decision-secret' },
        },
      }));
      rewriteReplayValue(app.db, ownerId, 'codec-classify', (value) => ({
        ...value,
        ownershipToken: 'scope-secret',
        classification: {
          ...(value.classification as Record<string, unknown>),
          rawEnvironment: { TOKEN: 'scope-secret' },
        },
      }));

      const latestClassification = await app.invoke('M-014', {
        actorId: ownerId, projectId, srId,
        requestId: 'codec-classify-latest', idempotencyKey: 'codec-classify-latest',
        guard: decisionGuard(seededDecisionId, classified.value.revision),
      }, {
        ...scopeInput,
        requiredGate: 'G1',
        reason: 'replay value와 최신 current를 구분합니다.',
      });
      if (!latestClassification.ok) {
        throw new Error(`latest classification setup failed: ${latestClassification.error.code}`);
      }

      const replayedQuestion = await app.invoke('M-009', {
        actorId: ownerId, projectId, srId, requestId: 'codec-resolve-replay', idempotencyKey: 'codec-resolve',
        guard: questionGuard(answered.value.revision),
      }, resolutionInput);
      const replayedDecision = await app.invoke('M-013', {
        actorId: manifest.personaIds['P-04'], projectId, srId,
        requestId: 'codec-redecide-replay', idempotencyKey: 'codec-redecide',
        guard: decisionGuard(seededDecisionId, initialDecision.revision),
      }, revisionInput);
      const replayedScope = await app.invoke('M-014', {
        actorId: ownerId, projectId, srId, requestId: 'codec-classify-replay', idempotencyKey: 'codec-classify',
        guard: decisionGuard(seededDecisionId, revised.value.revision),
      }, scopeInput);
      expect(replayedQuestion).toMatchObject({ ok: true, disposition: 'Replayed', value: resolved.value });
      expect(replayedDecision).toMatchObject({ ok: true, disposition: 'Replayed', value: revised.value });
      expect(replayedScope).toMatchObject({
        ok: true,
        disposition: 'Replayed',
        value: classified.value,
        current: { currentRevision: latestClassification.value.revision },
      });
      for (const replayed of [replayedQuestion, replayedDecision, replayedScope]) {
        expect(JSON.stringify(replayed)).not.toContain('secret');
        expect(JSON.stringify(replayed)).not.toContain('rawEnvironment');
        expect(JSON.stringify(replayed)).not.toContain('ownershipToken');
      }

      rewriteReplayValue(app.db, ownerId, 'codec-resolve', (value) => ({
        ...value,
        currentResult: {
          ...(value.currentResult as Record<string, unknown>),
          ref: {
            ...((value.currentResult as Record<string, unknown>).ref as Record<string, unknown>),
            version: 'broken',
          },
        },
      }));
      expect(await app.invoke('M-009', {
        actorId: ownerId, projectId, srId, requestId: 'codec-resolve-corrupt', idempotencyKey: 'codec-resolve',
        guard: questionGuard(answered.value.revision),
      }, resolutionInput)).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
      rewriteReplayValue(app.db, manifest.personaIds['P-04'], 'codec-redecide', (value) => ({
        ...value,
        currentConfirmation: {
          ...(value.currentConfirmation as Record<string, unknown>),
          ref: {
            ...((value.currentConfirmation as Record<string, unknown>).ref as Record<string, unknown>),
            version: 'broken',
          },
        },
      }));
      expect(await app.invoke('M-013', {
        actorId: manifest.personaIds['P-04'], projectId, srId,
        requestId: 'codec-redecide-corrupt', idempotencyKey: 'codec-redecide',
        guard: decisionGuard(seededDecisionId, initialDecision.revision),
      }, revisionInput)).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
      rewriteReplayValue(app.db, ownerId, 'codec-classify', (value) => ({
        ...value,
        classification: {
          ...(value.classification as Record<string, unknown>),
          reason: 42,
        },
      }));
      expect(await app.invoke('M-014', {
        actorId: ownerId, projectId, srId, requestId: 'codec-classify-corrupt', idempotencyKey: 'codec-classify',
        guard: decisionGuard(seededDecisionId, revised.value.revision),
      }, scopeInput)).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
    } finally {
      await app.close();
    }
  });

  it('M-008의 실제 답변을 M-009로 해결한 뒤 새 답변은 과거 해결 확인을 재사용하지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const initial = readQuestionView(app.db, { kind: 'sr', projectId, srId }, questionId);
      if (initial === undefined) throw new Error('seed question missing');
      const first = await app.invoke('M-008', {
        actorId: requesterId,
        projectId,
        srId,
        requestId: 'answer-1',
        idempotencyKey: 'answer-1',
        guard: questionGuard(initial.revision),
      }, {
        questionId,
        answeredQuestionSnapshotRef: initial.currentResult.ref,
        answer: { kind: 'free_text', text: '결제 후 7일 이내 취소합니다.' },
        evidence: { text: '가상 정책을 확인했습니다.' },
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.value.status).toBe('answered');
      const selected = first.value.currentResult.selectedAnswer;
      if (selected === undefined) throw new Error('selected answer missing');

      expect(await app.invoke('M-009', {
        actorId: requesterId, projectId, srId,
        guard: questionGuard(first.value.revision),
      }, {
        questionId,
        selectedAnswerRef: selected.ref,
        resolutionEvidence: { text: '답변자가 스스로 해결 처리하려고 합니다.' },
        documentDisposition: { kind: 'not_required', reason: '권한 검사' },
      })).toMatchObject({ ok: false, error: { code: 'NOT_ASSIGNED' } });
      expect(await app.invoke('M-009', {
        actorId: ownerId, projectId, srId,
        guard: questionGuard(first.value.revision),
      }, {
        questionId,
        selectedAnswerRef: { ...selected.ref, version: selected.ref.version + 1 },
        resolutionEvidence: { text: '과거 또는 미래 답변을 선택하려고 합니다.' },
        documentDisposition: { kind: 'not_required', reason: '정확한 답변 ref 검사' },
      })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });

      const resolved = await app.invoke('M-009', {
        actorId: ownerId,
        projectId,
        srId,
        requestId: 'resolve-1',
        idempotencyKey: 'resolve-1',
        guard: questionGuard(first.value.revision),
      }, {
        questionId,
        selectedAnswerRef: selected.ref,
        resolutionEvidence: { text: '현재 요구사항과 일치함을 확인했습니다.' },
        documentDisposition: {
          kind: 'not_required',
          reason: '현재 요구사항에 같은 취소 기한이 있습니다.',
        },
      });
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      expect(resolved.value.status).toBe('resolved');
      expect(resolved.value.currentResult.resolution).toMatchObject({
        selectedAnswerRef: selected.ref,
        evidence: { text: '현재 요구사항과 일치함을 확인했습니다.' },
        documentDisposition: {
          kind: 'not_required', reason: '현재 요구사항에 같은 취소 기한이 있습니다.',
        },
        resolvedBy: ownerId,
      });
      expect(await app.invoke('M-009', {
        actorId: ownerId, projectId, srId,
        requestId: 'resolve-replay', idempotencyKey: 'resolve-1',
        guard: questionGuard(first.value.revision),
      }, {
        questionId,
        selectedAnswerRef: selected.ref,
        resolutionEvidence: { text: '현재 요구사항과 일치함을 확인했습니다.' },
        documentDisposition: {
          kind: 'not_required', reason: '현재 요구사항에 같은 취소 기한이 있습니다.',
        },
      })).toMatchObject({ ok: true, disposition: 'Replayed', value: resolved.value });
      const resolvedBasis = readGenerationBasis(app.db, { kind: 'sr', projectId, srId });
      if (resolvedBasis === undefined) throw new Error('resolved generation basis missing');
      expect(resolvedBasis.questions.find(({ questionId: id }) => id === questionId)?.resolution).toMatchObject({
        selectedAnswerRef: selected.ref,
        evidence: { text: '현재 요구사항과 일치함을 확인했습니다.' },
        documentDisposition: { kind: 'not_required' },
      });
      const prepared = prepareGenerationSnapshot({ taskKind: 'QUESTION_PROPOSALS' }, resolvedBasis, []);
      const fixedSnapshot = app.db.transaction(() => insertInputSnapshot(app.db, {
        basis: resolvedBasis,
        prepared,
        projectRules: [],
        capturedAt: '2026-09-09T13:00:00.000Z',
      })).immediate();

      const changed = await app.invoke('M-008', {
        actorId: requesterId,
        projectId,
        srId,
        requestId: 'answer-2',
        idempotencyKey: 'answer-2',
        guard: questionGuard(resolved.value.revision),
      }, {
        questionId,
        answeredQuestionSnapshotRef: resolved.value.currentResult.ref,
        answer: { kind: 'free_text', text: '결제 후 3일 이내 취소합니다.' },
        evidence: { text: '변경된 가상 정책입니다.' },
      });
      expect(changed.ok).toBe(true);
      if (!changed.ok) return;
      expect(changed.value.status).toBe('answered');
      expect(changed.value.currentResult.resolution).toBeUndefined();
      expect(changed.value.currentResult.selectedAnswer?.ref).toEqual({
        ...selected.ref,
        version: selected.ref.version + 1,
      });
      expect(readGenerationBasis(app.db, { kind: 'sr', projectId, srId })?.questions
        .find(({ questionId: id }) => id === questionId)?.resolution).toBeNull();
      const storedFixed = readInputSnapshot(app.db, { kind: 'sr', projectId, srId }, fixedSnapshot.snapshotId);
      const fixedQuestion = storedFixed?.contents.find((item) =>
        item.ref.kind === 'question_result' && item.ref.entityId === questionId);
      expect(fixedQuestion === undefined ? undefined : JSON.parse(fixedQuestion.content)).toMatchObject({
        resolution: { selectedAnswerRef: selected.ref },
      });

      const requirements = readCurrentArtifacts(app.db, projectId, srId)
        .find(({ kind }) => kind === 'requirements');
      if (requirements === undefined) throw new Error('requirements artifact missing');
      const changedAnswerRef = changed.value.currentResult.selectedAnswer?.ref;
      if (changedAnswerRef === undefined) throw new Error('changed answer missing');
      expect(await app.invoke('M-009', {
        actorId: ownerId, projectId, srId,
        guard: questionGuard(changed.value.revision),
      }, {
        questionId,
        selectedAnswerRef: changedAnswerRef,
        resolutionEvidence: { text: '개정 문서 반영 여부를 확인했습니다.' },
        documentDisposition: {
          kind: 'reflected',
          artifactVersionRefs: [{ ...requirements.versionRef, version: requirements.versionRef.version + 99 }],
        },
      })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
      const reflected = await app.invoke('M-009', {
        actorId: ownerId, projectId, srId,
        requestId: 'resolve-reflected', idempotencyKey: 'resolve-reflected',
        guard: questionGuard(changed.value.revision),
      }, {
        questionId,
        selectedAnswerRef: changedAnswerRef,
        resolutionEvidence: { text: '개정 문서 반영 여부를 확인했습니다.' },
        documentDisposition: { kind: 'reflected', artifactVersionRefs: [requirements.versionRef] },
      });
      expect(reflected).toMatchObject({
        ok: true,
        value: {
          status: 'resolved',
          currentResult: {
            resolution: {
              selectedAnswerRef: changedAnswerRef,
              documentDisposition: { kind: 'reflected', artifactVersionRefs: [requirements.versionRef] },
            },
          },
        },
      });
      expect(readGenerationBasis(app.db, { kind: 'sr', projectId, srId })?.questions
        .find(({ questionId: id }) => id === questionId)?.resolution).toMatchObject({
        documentDisposition: { kind: 'reflected', artifactVersionRefs: [requirements.versionRef] },
      });
    } finally {
      await app.close();
    }
  });

  it('M-011은 원 질문에 미확정 decision 하나만 연결하고 전환 뒤 답변·해결을 거절합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const initial = readQuestionView(app.db, { kind: 'sr', projectId, srId }, questionId);
      if (initial === undefined) throw new Error('seed question missing');
      const input = {
        questionId,
        questionResultSnapshotRef: initial.currentResult.ref,
        prompt: '부분 취소 기간을 어떻게 정합니까?',
        alternatives: [
          { optionId: 'seven-days', label: '7일', description: '결제 후 7일까지 허용합니다.' },
          { optionId: 'three-days', label: '3일', description: '결제 후 3일까지 허용합니다.' },
        ] as const,
        impact: '취소 정책과 요구사항 완료 기준이 달라집니다.',
        decisionMakerId: manifest.personaIds['P-04'],
        classificationRef: initial.classificationRef,
      };
      const converted = await app.invoke('M-011', {
        actorId: ownerId, projectId, srId, requestId: 'convert-1', idempotencyKey: 'convert-1',
        guard: questionGuard(initial.revision),
      }, input);
      expect(converted.ok).toBe(true);
      if (!converted.ok) return;
      expect(converted.value).toMatchObject({
        state: 'unconfirmed',
        originQuestionId: questionId,
        decisionMakerId: manifest.personaIds['P-04'],
        requiredGate: 'G1',
      });
      expect(converted.value.classificationRef).not.toEqual(initial.classificationRef);
      expect(readGenerationBasis(app.db, { kind: 'sr', projectId, srId })?.decisions
        .find(({ definition }) => definition.decisionId === converted.value.decisionId)?.definition).toMatchObject({
        originQuestionId: questionId,
        originQuestionResultSnapshotRef: initial.currentResult.ref,
      });
      expect(readQuestionView(app.db, { kind: 'sr', projectId, srId }, questionId)).toMatchObject({
        status: 'converted_to_decision',
        convertedDecisionId: converted.value.decisionId,
      });
      expect(await app.invoke('M-011', {
        actorId: ownerId, projectId, srId, requestId: 'convert-replay', idempotencyKey: 'convert-1',
        guard: questionGuard(initial.revision),
      }, input)).toMatchObject({ ok: true, disposition: 'Replayed', value: converted.value });

      const concurrent = await app.invoke('M-011', {
        actorId: ownerId, projectId, srId, requestId: 'convert-2', idempotencyKey: 'convert-2',
        guard: questionGuard(initial.revision),
      }, input);
      expect(concurrent).toMatchObject({ ok: false, error: { code: 'STALE_VERSION' } });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM decisions WHERE project_id=? AND sr_id=? AND origin_question_id=?',
      ).get(projectId, srId, questionId)).toEqual({ count: 1 });

      const convertedQuestion = readQuestionView(app.db, { kind: 'sr', projectId, srId }, questionId);
      if (convertedQuestion === undefined) throw new Error('converted question missing');
      expect(await app.invoke('M-014', {
        actorId: ownerId, projectId, srId,
        guard: questionGuard(convertedQuestion.revision),
      }, {
        targetRef: { kind: 'question', projectId, srId, entityId: questionId },
        scope: 'current', requiredGate: 'G2', reason: '원 질문 분류 변경 시도',
      })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
      const reclassified = await app.invoke('M-014', {
        actorId: ownerId, projectId, srId,
        guard: decisionGuard(converted.value.decisionId, converted.value.revision),
      }, {
        targetRef: { kind: 'decision', projectId, srId, entityId: converted.value.decisionId },
        scope: 'current', requiredGate: 'G2', reason: '연결 decision에서 범위를 변경합니다.',
      });
      expect(reclassified).toMatchObject({
        ok: true,
        value: {
          targetRef: { kind: 'decision', entityId: converted.value.decisionId },
          classificationRef: { version: 2 },
          requiredGate: 'G2',
        },
      });
      expect((await app.invoke('M-008', {
        actorId: requesterId, projectId, srId,
        guard: questionGuard(convertedQuestion.revision),
      }, {
        questionId,
        answeredQuestionSnapshotRef: convertedQuestion.currentResult.ref,
        answer: { kind: 'free_text', text: '허용하지 않아야 합니다.' },
        evidence: { text: '전환 뒤 답변 시도' },
      })).ok).toBe(false);
      expect((await app.invoke('M-009', {
        actorId: ownerId, projectId, srId,
        guard: questionGuard(convertedQuestion.revision),
      }, {
        questionId,
        selectedAnswerRef: {
          kind: 'question_answer', projectId, srId, entityId: 'missing-answer', version: 1,
        },
        resolutionEvidence: { text: '전환 뒤 해결 시도' },
        documentDisposition: { kind: 'not_required', reason: '전환됐습니다.' },
      })).ok).toBe(false);
      if (!reclassified.ok) return;
      const confirmed = await app.invoke('M-012', {
        actorId: manifest.personaIds['P-04'], projectId, srId,
        guard: decisionGuard(converted.value.decisionId, reclassified.value.revision),
      }, {
        decisionId: converted.value.decisionId,
        selection: { optionId: 'seven-days', text: '7일' },
        rationale: '질문에서 전환한 근거를 토대로 확정합니다.',
        evidence: { text: '결정권자가 전환 근거를 확인했습니다.' },
      });
      expect(confirmed).toMatchObject({
        ok: true,
        value: {
          currentConfirmation: {
            originQuestionId: questionId,
            originQuestionResultSnapshotRef: initial.currentResult.ref,
          },
        },
      });
      expect(readGenerationBasis(app.db, { kind: 'sr', projectId, srId })?.decisions
        .find(({ definition }) => definition.decisionId === converted.value.decisionId)?.currentVersion).toMatchObject({
        originQuestionId: questionId,
        originQuestionResultSnapshotRef: initial.currentResult.ref,
      });
    } finally {
      await app.close();
    }
  });

  it('M-013은 현재 지정 decision maker만 정확한 이전 버전에서 재결정하고 과거 버전을 보존합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const initial = readDecisionView(app.db, { kind: 'sr', projectId, srId }, seededDecisionId);
      if (initial?.currentConfirmation === undefined) throw new Error('seed confirmed decision missing');
      const input = {
        decisionId: seededDecisionId,
        selection: { optionId: 'same-day', text: '당일' },
        rationale: '정산 위험을 줄입니다.',
        evidence: { text: '정산 정책 변경을 확인했습니다.' },
        previousVersionRef: initial.currentConfirmation.ref,
        changeReason: '취소 가능 기간을 단축합니다.',
      };
      const unauthorized = await app.invoke('M-013', {
        actorId: ownerId, projectId, srId,
        guard: decisionGuard(seededDecisionId, initial.revision),
      }, input);
      expect(unauthorized).toMatchObject({ ok: false, error: { code: 'NOT_ASSIGNED' } });

      const revised = await app.invoke('M-013', {
        actorId: manifest.personaIds['P-04'], projectId, srId,
        requestId: 'redecide-1', idempotencyKey: 'redecide-1',
        guard: decisionGuard(seededDecisionId, initial.revision),
      }, input);
      expect(revised.ok).toBe(true);
      if (!revised.ok) return;
      expect(revised.value).toMatchObject({
        state: 'confirmed',
        revision: initial.revision + 1,
        classificationRef: initial.classificationRef,
        currentConfirmation: {
          ref: { kind: 'decision', entityId: seededDecisionId, version: 2 },
          previousVersionRef: initial.currentConfirmation.ref,
          changeReason: input.changeReason,
          selection: input.selection,
        },
        reviewImpact: { affectedGates: ['G1', 'G2'], needsNewReview: true },
      });
      expect(readGenerationBasis(app.db, { kind: 'sr', projectId, srId })?.decisions
        .find(({ definition }) => definition.decisionId === seededDecisionId)?.currentVersion).toMatchObject({
        ref: { version: 2 },
        previousVersionRef: initial.currentConfirmation.ref,
        changeReason: input.changeReason,
      });
      expect(app.db.prepare(
        `SELECT version,previous_version,change_reason,classification_id,classification_version
           FROM decision_versions WHERE project_id=? AND sr_id=? AND decision_id=? ORDER BY version`,
      ).all(projectId, srId, seededDecisionId)).toEqual([
        expect.objectContaining({ version: 1, previous_version: null }),
        expect.objectContaining({
          version: 2,
          previous_version: 1,
          change_reason: input.changeReason,
          classification_id: initial.classificationRef.entityId,
          classification_version: initial.classificationRef.version,
        }),
      ]);
      const replayed = await app.invoke('M-013', {
        actorId: manifest.personaIds['P-04'], projectId, srId,
        requestId: 'redecide-replay', idempotencyKey: 'redecide-1',
        guard: decisionGuard(seededDecisionId, initial.revision),
      }, input);
      expect(replayed).toMatchObject({ ok: true, disposition: 'Replayed', value: revised.value });
    } finally {
      await app.close();
    }
  });

  it('M-014는 current 축소에 확정 decision과 현재 requirements 근거를 요구하고 분류 이력을 보존합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const target = readDecisionView(app.db, { kind: 'sr', projectId, srId }, seededDecisionId);
      const question = readQuestionView(app.db, { kind: 'sr', projectId, srId }, questionId);
      if (target?.currentConfirmation === undefined || question === undefined) throw new Error('seed basis missing');
      const converted = await app.invoke('M-011', {
        actorId: ownerId, projectId, srId,
        guard: questionGuard(question.revision),
      }, {
        questionId,
        questionResultSnapshotRef: question.currentResult.ref,
        prompt: '범위를 후속으로 줄입니까?',
        alternatives: [{ optionId: 'defer', label: '후속 처리', description: '이번 범위에서 제외합니다.' }],
        impact: '현재 요구사항 범위가 줄어듭니다.',
        decisionMakerId: manifest.personaIds['P-04'],
        classificationRef: question.classificationRef,
      });
      expect(converted.ok).toBe(true);
      if (!converted.ok) return;
      const artifact = readCurrentArtifacts(app.db, projectId, srId).find(({ kind }) => kind === 'requirements');
      if (artifact === undefined || artifact.kind !== 'requirements') throw new Error('requirements artifact missing');
      const revisedArtifact = await app.invoke('M-015', {
        actorId: ownerId, projectId, srId,
        guard: { resource: { target: {
          kind: 'artifact', projectId, srId, entityId: artifact.artifactId,
        }, expectedRevision: artifact.revision } },
      }, {
        kind: 'requirements',
        artifactId: artifact.artifactId,
        markdown: artifact.markdown,
        sectionIndex: artifact.sectionIndex,
        requirementLinks: artifact.requirementLinks,
        changeSummary: '범위 축소를 반영해 요구사항과 완료 기준을 개정합니다.',
        targetBasis: { kind: 'version', ref: artifact.versionRef },
        decisionRefs: artifact.decisionRefs,
        sourceRefs: artifact.sourceRefs,
        questionResultRefs: artifact.questionResultRefs,
      });
      expect(revisedArtifact.ok).toBe(true);
      if (!revisedArtifact.ok) return;
      const requirementsRef = revisedArtifact.value.versionRef;
      const base = {
        targetRef: { kind: 'decision' as const, projectId, srId, entityId: seededDecisionId },
        scope: 'followup' as const,
        requiredGate: 'None' as const,
        reason: '범위 축소 결정과 개정 요구사항을 반영합니다.',
        ownerId,
        revisit: { kind: 'event' as const, event: '다음 취소 정책 개정' },
      };
      const invoke = (basisRefs: readonly import('@/src/contracts/context').VersionRef[] | undefined, key: string) =>
        app.invoke('M-014', {
          actorId: ownerId, projectId, srId, requestId: key, idempotencyKey: key,
          guard: decisionGuard(seededDecisionId, target.revision),
        }, { ...base, ...(basisRefs === undefined ? {} : { basisRefs }) });

      expect(await invoke(undefined, 'classify-missing')).toMatchObject({
        ok: false, error: { code: 'VALIDATION_ERROR' },
      });
      expect(await invoke([{
        ...target.currentConfirmation.ref,
        projectId: 'other-project',
      }, requirementsRef], 'classify-wrong-scope')).toMatchObject({
        ok: false, error: { code: 'VALIDATION_ERROR' },
      });
      expect(await invoke([{
        kind: 'decision', projectId, srId,
        entityId: converted.value.decisionId, version: 1,
      }, requirementsRef], 'classify-unconfirmed')).toMatchObject({
        ok: false, error: { code: 'VALIDATION_ERROR' },
      });
      expect(await invoke([{
        ...target.currentConfirmation.ref,
        version: target.currentConfirmation.ref.version + 99,
      }, requirementsRef], 'classify-wrong-version')).toMatchObject({
        ok: false, error: { code: 'VALIDATION_ERROR' },
      });

      const classified = await invoke([target.currentConfirmation.ref, requirementsRef], 'classify-ok');
      expect(classified.ok).toBe(true);
      if (!classified.ok) return;
      expect(classified.value).toMatchObject({
        targetRef: base.targetRef,
        scope: 'followup',
        requiredGate: 'None',
        revision: target.revision + 1,
        reviewImpact: { affectedGates: ['G1', 'G2'], needsNewReview: true },
        classification: {
          ref: { version: target.classificationRef.version + 1 },
          targetRef: base.targetRef,
          scope: 'followup',
          requiredGate: 'None',
          reason: base.reason,
          ownerId,
          revisit: base.revisit,
          basisRefs: [target.currentConfirmation.ref, requirementsRef],
        },
      });
      expect(await invoke([target.currentConfirmation.ref, requirementsRef], 'classify-ok')).toMatchObject({
        ok: true, disposition: 'Replayed', value: classified.value,
      });
      const detail = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.value.decisions.find((decision) => decision.decisionId === seededDecisionId)).toMatchObject({
        decisionId: seededDecisionId,
        requiredGate: 'None',
        currentClassification: {
          scope: 'followup', reason: base.reason, ownerId, revisit: base.revisit,
        },
      });
      expect(app.db.prepare(
        `SELECT version,scope,required_gate,previous_version,owner_id,revisit_event,payload_json
           FROM scope_classification_versions
          WHERE project_id=? AND sr_id=? AND classification_id=? ORDER BY version`,
      ).all(projectId, srId, target.classificationRef.entityId)).toEqual([
        expect.objectContaining({ version: target.classificationRef.version, scope: 'current', required_gate: 'G1' }),
        expect.objectContaining({
          version: target.classificationRef.version + 1,
          scope: 'followup',
          required_gate: 'None',
          previous_version: target.classificationRef.version,
          owner_id: ownerId,
          revisit_event: base.revisit.event,
          payload_json: expect.stringContaining(requirementsRef.entityId),
        }),
      ]);
      const rescheduled = await app.invoke('M-014', {
        actorId: ownerId, projectId, srId,
        guard: decisionGuard(seededDecisionId, classified.value.revision),
      }, {
        ...base,
        reason: '이미 후속인 항목의 재검토 사건만 명시적으로 갱신합니다.',
        revisit: { kind: 'event', event: '다음 분기 계획 수립' },
      });
      expect(rescheduled).toMatchObject({
        ok: true,
        value: {
          scope: 'followup',
          requiredGate: 'None',
          revision: classified.value.revision + 1,
          reviewImpact: { affectedGates: [], needsNewReview: false },
        },
      });
      if (!rescheduled.ok) return;
      const followupDecision = readDecisionView(app.db, { kind: 'sr', projectId, srId }, seededDecisionId);
      if (followupDecision?.currentConfirmation === undefined) throw new Error('followup decision version missing');
      expect(await app.invoke('M-013', {
        actorId: manifest.personaIds['P-04'], projectId, srId,
        guard: decisionGuard(seededDecisionId, rescheduled.value.revision),
      }, {
        decisionId: seededDecisionId,
        selection: { optionId: 'same-day', text: '당일' },
        rationale: '후속 계획에서 정책을 다시 정합니다.',
        evidence: { text: '후속 계획 검토 근거입니다.' },
        previousVersionRef: followupDecision.currentConfirmation.ref,
        changeReason: '후속 범위의 결정을 갱신합니다.',
      })).toMatchObject({
        ok: true,
        value: {
          requiredGate: 'None',
          classificationRef: rescheduled.value.classificationRef,
          currentConfirmation: { classificationRef: rescheduled.value.classificationRef },
          reviewImpact: { affectedGates: [], needsNewReview: false },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('M-011과 M-014의 늦은 activity 저장 실패는 entity·분류·gate·receipt를 모두 rollback합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const scope = { kind: 'sr' as const, projectId, srId };
      const question = readQuestionView(app.db, scope, questionId);
      const decision = readDecisionView(app.db, scope, seededDecisionId);
      if (question === undefined || decision === undefined) throw new Error('seed target missing');
      const state = () => ({
        sr: app.db.prepare('SELECT revision FROM srs WHERE project_id=? AND sr_id=?').get(projectId, srId),
        gates: app.db.prepare(
          'SELECT gate,review_epoch,validity,revision FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
        ).all(projectId, srId),
        questions: app.db.prepare(
          'SELECT question_id,status,current_result_version,converted_decision_id,revision FROM questions WHERE project_id=? AND sr_id=? ORDER BY question_id',
        ).all(projectId, srId),
        decisions: app.db.prepare(
          'SELECT decision_id,classification_id,classification_version,current_confirmed_version,revision FROM decisions WHERE project_id=? AND sr_id=? ORDER BY decision_id',
        ).all(projectId, srId),
        classifications: app.db.prepare(
          'SELECT classification_id,version,scope,required_gate FROM scope_classification_versions WHERE project_id=? AND sr_id=? ORDER BY classification_id,version',
        ).all(projectId, srId),
        receipts: app.db.prepare(
          'SELECT receipt_id FROM command_receipts WHERE project_id=? AND scope_target_id=? ORDER BY receipt_id',
        ).all(projectId, srId),
      });

      const beforeConversion = state();
      app.db.exec(`CREATE TRIGGER reject_question_converted_activity
        BEFORE INSERT ON activity_events WHEN NEW.event_type='question_converted'
        BEGIN SELECT RAISE(ABORT, 'late conversion activity failure'); END`);
      const conversion = await app.invoke('M-011', {
        actorId: ownerId, projectId, srId, requestId: 'rollback-convert', idempotencyKey: 'rollback-convert',
        guard: questionGuard(question.revision),
      }, {
        questionId,
        questionResultSnapshotRef: question.currentResult.ref,
        prompt: 'rollback되어야 하는 전환입니까?',
        alternatives: [{ optionId: 'yes', label: '예', description: '전환합니다.' }],
        impact: 'rollback 검증입니다.',
        decisionMakerId: manifest.personaIds['P-04'],
        classificationRef: question.classificationRef,
      });
      expect(conversion).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
      expect(state()).toEqual(beforeConversion);
      app.db.exec('DROP TRIGGER reject_question_converted_activity');

      const beforeClassification = state();
      app.db.exec(`CREATE TRIGGER reject_scope_classified_activity
        BEFORE INSERT ON activity_events WHEN NEW.event_type='scope_classified'
        BEGIN SELECT RAISE(ABORT, 'late classification activity failure'); END`);
      const classification = await app.invoke('M-014', {
        actorId: ownerId, projectId, srId,
        requestId: 'rollback-classify', idempotencyKey: 'rollback-classify',
        guard: decisionGuard(seededDecisionId, decision.revision),
      }, {
        targetRef: { kind: 'decision', projectId, srId, entityId: seededDecisionId },
        scope: 'current', requiredGate: 'G2', reason: 'rollback되어야 하는 분류입니다.',
      });
      expect(classification).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
      expect(state()).toEqual(beforeClassification);
    } finally {
      await app.close();
    }
  });

  it('현재 classification row의 대상이 entity pointer와 다르면 읽기를 거절합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const decision = readDecisionView(app.db, { kind: 'sr', projectId, srId }, seededDecisionId);
      if (decision === undefined) throw new Error('seed decision missing');
      app.db.exec('DROP TRIGGER scope_classification_versions_no_update');
      app.db.prepare(
        `UPDATE scope_classification_versions SET target_id=?
          WHERE project_id=? AND sr_id=? AND classification_id=? AND version=?`,
      ).run('another-decision', projectId, srId,
        decision.classificationRef.entityId, decision.classificationRef.version);
      expect(() => readDecisionView(
        app.db,
        { kind: 'sr', projectId, srId },
        seededDecisionId,
      )).toThrow(/classification 대상이 entity pointer와 다릅니다/u);
    } finally {
      await app.close();
    }
  });
});
