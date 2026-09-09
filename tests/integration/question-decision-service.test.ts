import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import manifest from '@/config/demo/manifest.json' with { type: 'json' };
import {
  createQuestionDecisionService,
  type AddFollowupQuestionCommand,
  type AnswerQuestionCommand,
  type ConfirmDecisionCommand,
} from '@/src/application/question-decision-service';
import type { EntityRef, RevisionGuard, SrScope } from '@/src/contracts/context';
import {
  applyDecisionDraftSelections,
  applyQuestionDraftSelections,
  readDecisionView,
  readDecisionViews,
  readQuestionViews,
  QuestionDecisionRepositoryError,
} from '@/src/persistence/question-decision-repository';
import { createPersistence } from '@/src/persistence/transaction';
import { createTestApp } from '@/tests/helpers/test-app';

const projectId = manifest.projectId;
const ownerId = manifest.personaIds['P-01'];
const requesterId = manifest.personaIds['P-02'];
const reviewerId = manifest.personaIds['P-03'];
const decisionMakerId = manifest.personaIds['P-04'];
const srId = manifest.srIds['PAY-102'];
const questionId = manifest.entityIds['PAY-102'].questionId;

function actor(actorId: string) {
  return { actorId, projectId, roles: [], srAssignments: [], demo: true as const };
}

function guard<K extends 'question' | 'decision'>(kind: K, entityId: string, revision: number): RevisionGuard<K> {
  return {
    resource: {
      target: { kind, projectId, srId, entityId } as EntityRef<K>,
      expectedRevision: revision,
    },
  };
}

function answerCommand(idempotencyKey: string = randomUUID()): AnswerQuestionCommand {
  return {
    actor: actor(requesterId),
    scope: { kind: 'sr', projectId, srId },
    requestId: randomUUID(),
    idempotencyKey,
    guard: guard('question', questionId, 1),
  };
}

describe('question/decision service storage integration', () => {
  it('M-008은 지정 담당자의 답변과 새 current result를 한 번만 저장하고 answered로 남깁니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const service = createQuestionDecisionService(createPersistence(app.db));
      const ctx = answerCommand('answer-once');
      const input = {
        questionId,
        answeredQuestionSnapshotRef: {
          kind: 'question_result' as const, projectId, srId, entityId: questionId, version: 1,
        },
        answer: { kind: 'free_text' as const, text: '부분 취소와 중복 요청을 모두 멱등 처리합니다.' },
        evidence: { text: '요청 담당자가 정책을 확인했습니다.' },
      };

      const committed = service.answerQuestion(ctx, input);
      const replayed = service.answerQuestion({ ...ctx, requestId: randomUUID() }, input);

      expect(committed).toMatchObject({
        kind: 'Committed',
        value: {
          questionId,
          status: 'answered',
          revision: 2,
          currentResult: {
            ref: { kind: 'question_result', entityId: questionId, version: 2 },
            selectedAnswer: {
              ref: { kind: 'question_answer', version: 1 },
              answeredQuestionSnapshotRef: { kind: 'question_result', version: 1 },
              answer: { kind: 'free_text', text: input.answer.text },
              evidence: input.evidence,
              answeredBy: requesterId,
            },
          },
          reviewImpact: { affectedGates: ['G1', 'G2'], needsNewReview: true },
        },
      });
      expect(replayed).toMatchObject({ kind: 'Replayed', value: committed.kind === 'Committed' ? committed.value : {} });
      expect(app.db.prepare(
        'SELECT status,current_result_version,revision FROM questions WHERE project_id=? AND sr_id=? AND question_id=?',
      ).get(projectId, srId, questionId)).toEqual({ status: 'answered', current_result_version: 2, revision: 2 });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM question_answer_versions WHERE project_id=? AND sr_id=? AND question_id=?',
      ).get(projectId, srId, questionId)).toEqual({ count: 1 });
      expect(app.db.prepare(
        "SELECT count(*) AS count FROM activity_events WHERE project_id=? AND sr_id=? AND event_type='question_answered'",
      ).get(projectId, srId)).toEqual({ count: 1 });
    } finally {
      await app.close();
    }
  });

  it('M-008은 현재 담당자 권한을 receipt 재생보다 먼저 다시 검사합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const service = createQuestionDecisionService(createPersistence(app.db));
      const ctx = answerCommand('authority-before-replay');
      const input = {
        questionId,
        answeredQuestionSnapshotRef: {
          kind: 'question_result' as const, projectId, srId, entityId: questionId, version: 1,
        },
        answer: { kind: 'free_text' as const, text: '첫 답변' },
        evidence: { text: '첫 근거' },
      };
      expect(service.answerQuestion(ctx, input).kind).toBe('Committed');
      app.db.transaction(() => {
        app.db.prepare(
          `INSERT INTO question_result_snapshots(
             project_id,sr_id,question_id,version,text,reason,assignee_id,answer_mode,options_json,
             status,classification_id,classification_version,evidence_refs_json,captured_at,
             selected_answer_id,selected_answer_version,payload_json
           ) SELECT project_id,sr_id,question_id,3,text,reason,?,answer_mode,options_json,
                    status,classification_id,classification_version,evidence_refs_json,
                    '2026-09-09T09:30:00.000Z',selected_answer_id,selected_answer_version,payload_json
               FROM question_result_snapshots
              WHERE project_id=? AND sr_id=? AND question_id=? AND version=2`,
        ).run(reviewerId, projectId, srId, questionId);
        app.db.prepare(
          `UPDATE questions SET assignee_id=?,current_result_version=3,revision=3
            WHERE project_id=? AND sr_id=? AND question_id=?`,
        ).run(reviewerId, projectId, srId, questionId);
      }).immediate();

      expect(service.answerQuestion({ ...ctx, requestId: randomUUID() }, input)).toMatchObject({
        kind: 'Rejected', error: { code: 'NOT_ASSIGNED' },
      });
    } finally {
      await app.close();
    }
  });

  it('M-010은 owner가 만든 G2 후속 질문만 G2에 반영하고 실제 본문을 반환합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const service = createQuestionDecisionService(createPersistence(app.db));
      const ctx: AddFollowupQuestionCommand = {
        actor: actor(ownerId),
        scope: { kind: 'sr', projectId, srId },
        requestId: randomUUID(),
        idempotencyKey: 'followup-g2',
        guard: guard('question', questionId, 1),
      };
      const result = service.addFollowupQuestion(ctx, {
        parentQuestionId: questionId,
        text: '구현 계획에서 재시도 횟수는 몇 회입니까?',
        reason: 'G2 구현 세부 조건을 확정합니다.',
        assigneeId: reviewerId,
        answerMode: 'choice',
        options: [
          { optionId: 'once', text: '1회' },
          { optionId: 'three', text: '3회' },
        ],
        classification: { scope: 'current', requiredGate: 'G2', reason: '구현 계획 결정' },
        candidateAnswers: ['1회', '3회'],
      });

      expect(result).toMatchObject({
        kind: 'Committed',
        value: {
          status: 'open',
          text: '구현 계획에서 재시도 횟수는 몇 회입니까?',
          parentQuestionId: questionId,
          assigneeId: reviewerId,
          answerMode: 'choice',
          requiredGate: 'G2',
          currentResult: { ref: { kind: 'question_result', version: 1 } },
          reviewImpact: { affectedGates: ['G2'], needsNewReview: true, returnStage: 'requirements' },
        },
      });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM questions WHERE project_id=? AND sr_id=? AND parent_question_id=?',
      ).get(projectId, srId, questionId)).toEqual({ count: 1 });
    } finally {
      await app.close();
    }
  });

  it('선택형 질문에도 담당자가 직접 작성한 free-text 답변을 저장합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const service = createQuestionDecisionService(createPersistence(app.db));
      const created = service.addFollowupQuestion({
        actor: actor(ownerId),
        scope: { kind: 'sr', projectId, srId },
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        guard: guard('question', questionId, 1),
      }, {
        parentQuestionId: questionId,
        text: '재시도 횟수를 선택합니다.',
        reason: '선택지 외의 정책도 받아야 합니다.',
        assigneeId: reviewerId,
        answerMode: 'choice',
        options: [{ optionId: 'once', text: '1회' }],
        classification: { scope: 'current', requiredGate: 'G2', reason: '구현 정책' },
      });
      if (created.kind !== 'Committed') throw new Error('선택형 질문 등록이 실패했습니다.');
      const question = created.value;
      const answered = service.answerQuestion({
        actor: actor(reviewerId),
        scope: question.scope,
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        guard: guard('question', question.questionId, question.revision),
      }, {
        questionId: question.questionId,
        answeredQuestionSnapshotRef: question.currentResult.ref,
        answer: { kind: 'free_text', text: '장애 유형별로 1회 또는 3회 재시도합니다.' },
        evidence: { text: '담당자가 운영 정책을 확인했습니다.' },
      });

      expect(answered).toMatchObject({
        kind: 'Committed',
        value: {
          answerMode: 'choice',
          status: 'answered',
          currentResult: {
            selectedAnswer: {
              answer: { kind: 'free_text', text: '장애 유형별로 1회 또는 3회 재시도합니다.' },
            },
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('예기치 않은 programmer 오류를 STORE_UNAVAILABLE로 바꾸지 않습니다', () => {
    const unexpected = new TypeError('programmer failure');
    const service = createQuestionDecisionService({
      withinTransaction(): never {
        throw unexpected;
      },
      readConsistent(): never {
        throw unexpected;
      },
    });

    expect(() => service.answerQuestion(answerCommand(), {
      questionId,
      answeredQuestionSnapshotRef: {
        kind: 'question_result', projectId, srId, entityId: questionId, version: 1,
      },
      answer: { kind: 'free_text', text: '답변' },
      evidence: { text: '근거' },
    })).toThrow(unexpected);
  });

  it('저장된 command receipt JSON 손상은 programmer 오류가 아니라 STORE_UNAVAILABLE입니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const service = createQuestionDecisionService(createPersistence(app.db));
      const ctx = answerCommand('corrupt-replay');
      const input = {
        questionId,
        answeredQuestionSnapshotRef: {
          kind: 'question_result' as const, projectId, srId, entityId: questionId, version: 1,
        },
        answer: { kind: 'free_text' as const, text: '저장된 receipt를 검증합니다.' },
        evidence: { text: '저장 codec 경계를 확인합니다.' },
      };
      expect(service.answerQuestion(ctx, input).kind).toBe('Committed');
      app.db.exec('DROP TRIGGER command_receipts_no_update');
      app.db.prepare(
        'UPDATE command_receipts SET replay_value_json=? WHERE project_id=? AND actor_id=? AND idempotency_key=?',
      ).run('[]', projectId, requesterId, ctx.idempotencyKey);

      expect(service.answerQuestion({ ...ctx, requestId: randomUUID() }, input)).toMatchObject({
        kind: 'Rejected', error: { code: 'STORE_UNAVAILABLE' },
      });
    } finally {
      await app.close();
    }
  });

  it('free-text 질문에는 임의 choice 답변을 저장하지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const result = createQuestionDecisionService(createPersistence(app.db)).answerQuestion(
        answerCommand(),
        {
          questionId,
          answeredQuestionSnapshotRef: {
            kind: 'question_result', projectId, srId, entityId: questionId, version: 1,
          },
          answer: { kind: 'choice', optionId: 'invented', text: '임의 선택' },
          evidence: { text: '근거' },
        },
      );

      expect(result).toMatchObject({ kind: 'Rejected', error: { code: 'VALIDATION_ERROR' } });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM question_answer_versions WHERE project_id=? AND sr_id=? AND question_id=?',
      ).get(projectId, srId, questionId)).toEqual({ count: 0 });
    } finally {
      await app.close();
    }
  });

  it('followup/None은 gate를 바꾸지 않고 SR revision만 올립니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const service = createQuestionDecisionService(createPersistence(app.db));
      const beforeSr = app.db.prepare(
        'SELECT revision FROM srs WHERE project_id=? AND sr_id=?',
      ).get(projectId, srId) as { revision: number };
      const beforeGates = app.db.prepare(
        'SELECT gate,revision,review_epoch,validity FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
      ).all(projectId, srId);
      const result = service.addFollowupQuestion({
        actor: actor(ownerId),
        scope: { kind: 'sr', projectId, srId },
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        guard: guard('question', questionId, 1),
      }, {
        parentQuestionId: questionId,
        text: '차기 분기에 환불 보고서를 추가합니까?',
        reason: '현재 구현과 분리한 후속 범위입니다.',
        assigneeId: requesterId,
        answerMode: 'free_text',
        classification: {
          scope: 'followup', requiredGate: 'None', reason: '차기 범위', ownerId,
          revisit: { kind: 'event', event: '다음 분기 계획' },
        },
      });

      expect(result).toMatchObject({
        kind: 'Committed',
        value: {
          requiredGate: 'None',
          reviewImpact: { affectedGates: [], needsNewReview: false },
        },
      });
      expect(app.db.prepare(
        'SELECT revision FROM srs WHERE project_id=? AND sr_id=?',
      ).get(projectId, srId)).toEqual({ revision: beforeSr.revision + 1 });
      expect(app.db.prepare(
        'SELECT gate,revision,review_epoch,validity FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
      ).all(projectId, srId)).toEqual(beforeGates);
    } finally {
      await app.close();
    }
  });

  it('제안 배치의 현재 member 검사가 실패하면 일부 question도 남기지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const persistence = createPersistence(app.db);
      const before = app.db.prepare(
        'SELECT count(*) AS count FROM questions WHERE project_id=? AND sr_id=?',
      ).get(projectId, srId);
      expect(() => persistence.withinTransaction((db) => applyQuestionDraftSelections(db, {
        scope: { kind: 'sr', projectId, srId },
        actorId: ownerId,
        occurredAt: '2026-09-09T10:20:00.000Z',
        draftId: 'draft-atomic-questions',
        proposals: [
          {
            temporaryId: 'valid-first', text: '첫 질문', reason: '첫 이유',
            suggestedAssigneeId: requesterId, requiredGate: 'G1', sourceRefs: [], candidateAnswers: [],
          },
          {
            temporaryId: 'invalid-second', text: '둘째 질문', reason: '둘째 이유',
            suggestedAssigneeId: 'other-project-user', requiredGate: 'G1', sourceRefs: [], candidateAnswers: [],
          },
        ],
      }))).toThrow(QuestionDecisionRepositoryError);
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM questions WHERE project_id=? AND sr_id=?',
      ).get(projectId, srId)).toEqual(before);
    } finally {
      await app.close();
    }
  });

  it('M-010의 존재하지 않는 related Artifact ref는 저장 손상이 아니라 입력 오류입니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const result = createQuestionDecisionService(createPersistence(app.db)).addFollowupQuestion({
        actor: actor(ownerId),
        scope: { kind: 'sr', projectId, srId },
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        guard: guard('question', questionId, 1),
      }, {
        parentQuestionId: questionId,
        text: '존재하지 않는 문서를 참조합니까?',
        reason: '입력 ref 검증 경계를 확인합니다.',
        assigneeId: requesterId,
        answerMode: 'free_text',
        classification: { scope: 'current', requiredGate: 'G1', reason: '현재 요구사항 확인' },
        relatedArtifactRefs: [{
          kind: 'artifact', projectId, srId, entityId: 'missing-artifact', version: 1,
        }],
      });

      expect(result).toMatchObject({ kind: 'Rejected', error: { code: 'VALIDATION_ERROR' } });
    } finally {
      await app.close();
    }
  });

  it('결정 제안의 중복 option ID를 쓰기 전에 거절하고 서로 다른 ID는 유지합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const persistence = createPersistence(app.db);
      const before = app.db.prepare(
        'SELECT count(*) AS count FROM decisions WHERE project_id=? AND sr_id=?',
      ).get(projectId, srId);
      let rejected: unknown;
      try {
        persistence.withinTransaction((db) => applyDecisionDraftSelections(db, {
          scope: { kind: 'sr', projectId, srId },
          actorId: ownerId,
          occurredAt: '2026-09-09T10:30:00.000Z',
          draftId: 'draft-duplicate-options',
          selections: [{
            proposal: {
              temporaryId: 'duplicate-options',
              prompt: '중복 option을 거절합니까?',
              alternatives: [
                { optionId: 'same', label: '첫 대안', description: '첫 설명' },
                { optionId: 'same', label: '둘째 대안', description: '둘째 설명' },
              ],
              impact: '결정 식별성',
              recommendation: 'same',
              sourceRefs: [],
            },
            decisionMakerId,
            classification: { scope: 'current', requiredGate: 'G1', reason: '식별 가능한 결정' },
          }],
        }));
      } catch (error) {
        rejected = error;
      }
      expect(rejected).toMatchObject({ code: 'INVALID_INPUT' });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM decisions WHERE project_id=? AND sr_id=?',
      ).get(projectId, srId)).toEqual(before);

      const [mapping] = persistence.withinTransaction((db) => applyDecisionDraftSelections(db, {
        scope: { kind: 'sr', projectId, srId },
        actorId: ownerId,
        occurredAt: '2026-09-09T10:31:00.000Z',
        draftId: 'draft-distinct-options',
        selections: [{
          proposal: {
            temporaryId: 'distinct-options',
            prompt: '서로 다른 option을 유지합니까?',
            alternatives: [
              { optionId: 'first', label: '첫 대안', description: '첫 설명' },
              { optionId: 'second', label: '둘째 대안', description: '둘째 설명' },
            ],
            impact: '결정 식별성',
            recommendation: 'second',
            sourceRefs: [],
          },
          decisionMakerId,
          classification: { scope: 'current', requiredGate: 'G1', reason: '식별 가능한 결정' },
        }],
      }));
      if (mapping === undefined) throw new Error('decision mapping이 없습니다.');
      expect(readDecisionView(app.db, { kind: 'sr', projectId, srId }, mapping.ref.entityId)?.alternatives)
        .toEqual([
          { optionId: 'first', label: '첫 대안', description: '첫 설명' },
          { optionId: 'second', label: '둘째 대안', description: '둘째 설명' },
        ]);
    } finally {
      await app.close();
    }
  });

  it('저장 codec 손상은 STORE_UNAVAILABLE, 사용자 입력 오류는 VALIDATION_ERROR로 구분합니다', async () => {
    const corruptApp = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      corruptApp.db.prepare(
        'UPDATE questions SET payload_json=? WHERE project_id=? AND sr_id=? AND question_id=?',
      ).run('[]', projectId, srId, questionId);
      expect(createQuestionDecisionService(createPersistence(corruptApp.db)).answerQuestion(
        answerCommand(),
        {
          questionId,
          answeredQuestionSnapshotRef: {
            kind: 'question_result', projectId, srId, entityId: questionId, version: 1,
          },
          answer: { kind: 'free_text', text: '답변' },
          evidence: { text: '근거' },
        },
      )).toMatchObject({ kind: 'Rejected', error: { code: 'STORE_UNAVAILABLE' } });
    } finally {
      await corruptApp.close();
    }

    const inputApp = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      expect(createQuestionDecisionService(createPersistence(inputApp.db)).answerQuestion(
        answerCommand(),
        {
          questionId,
          answeredQuestionSnapshotRef: {
            kind: 'question_result', projectId, srId, entityId: questionId, version: 1,
          },
          answer: { kind: 'free_text', text: '   ' },
          evidence: { text: '근거' },
        },
      )).toMatchObject({ kind: 'Rejected', error: { code: 'VALIDATION_ERROR' } });
      expect(inputApp.db.prepare(
        'SELECT count(*) AS count FROM question_answer_versions WHERE project_id=? AND sr_id=? AND question_id=?',
      ).get(projectId, srId, questionId)).toEqual({ count: 0 });
    } finally {
      await inputApp.close();
    }
  });

  it('plural reader가 seed의 질문 본문과 decision 확정 근거를 실제 row에서 반환합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      expect(readQuestionViews(app.db, projectId, srId)).toEqual([
        expect.objectContaining({
          questionId,
          text: expect.stringContaining('부분 취소'),
          assigneeId: requesterId,
          currentResult: expect.objectContaining({ ref: expect.objectContaining({ version: 1 }) }),
        }),
      ]);
      expect(readDecisionViews(app.db, projectId, srId)).toEqual([
        expect.objectContaining({
          decisionId: manifest.entityIds['PAY-102'].decisionId,
          decisionMakerId,
          requiredGate: 'G1',
          currentConfirmation: expect.objectContaining({
            ref: expect.objectContaining({ version: 1 }),
            rationale: expect.any(String),
            decidedBy: decisionMakerId,
          }),
        }),
      ]);
    } finally {
      await app.close();
    }
  });

  it('draft 제안 저장은 current member를 검사하고 temporaryId와 미확정 entity를 정확히 매핑합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const persistence = createPersistence(app.db);
      const scope: SrScope = { kind: 'sr', projectId, srId };
      const questionMappings = persistence.withinTransaction((db) => applyQuestionDraftSelections(db, {
        scope,
        actorId: ownerId,
        occurredAt: '2026-09-09T10:00:00.000Z',
        draftId: 'draft-question-proposals',
        proposals: [{
          temporaryId: 'temporary-q',
          text: '환불 원장은 어디에서 확인합니까?',
          reason: '실제 근거 위치가 필요합니다.',
          suggestedAssigneeId: requesterId,
          requiredGate: 'G1',
          sourceRefs: [],
          candidateAnswers: ['정산 원장'],
        }],
      }));
      const decisionMappings = persistence.withinTransaction((db) => applyDecisionDraftSelections(db, {
        scope,
        actorId: ownerId,
        occurredAt: '2026-09-09T10:01:00.000Z',
        draftId: 'draft-decision-proposals',
        selections: [{
          proposal: {
            temporaryId: 'temporary-d',
            prompt: '재시도 횟수를 선택합니다.',
            alternatives: [
              { optionId: 'once', label: '1회', description: '즉시 한 번 재시도합니다.' },
              { optionId: 'three', label: '3회', description: '지수 지연으로 세 번 재시도합니다.' },
            ],
            impact: '외부 결제사 장애 처리에 영향을 줍니다.',
            recommendation: 'three',
            sourceRefs: [],
          },
          decisionMakerId,
          classification: { scope: 'current', requiredGate: 'G1', reason: '요구사항 정책 결정' },
        }],
      }));

      expect(questionMappings).toEqual([{
        temporaryId: 'temporary-q',
        ref: expect.objectContaining({ kind: 'question', projectId, srId }),
      }]);
      expect(decisionMappings).toEqual([{
        temporaryId: 'temporary-d',
        ref: expect.objectContaining({ kind: 'decision', projectId, srId }),
      }]);
      const decision = readDecisionView(app.db, scope, decisionMappings[0]!.ref.entityId);
      expect(decision).toMatchObject({
        state: 'unconfirmed',
        decisionMakerId,
        recommendation: 'three',
        sourceDraft: { draftId: 'draft-decision-proposals', temporaryId: 'temporary-d' },
      });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM decision_versions WHERE project_id=? AND sr_id=? AND decision_id=?',
      ).get(projectId, srId, decisionMappings[0]!.ref.entityId)).toEqual({ count: 0 });
    } finally {
      await app.close();
    }
  });

  it('M-012는 지정 decision maker만 미확정 결정을 새 불변 version으로 확정합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const persistence = createPersistence(app.db);
      const scope: SrScope = { kind: 'sr', projectId, srId };
      const [mapping] = persistence.withinTransaction((db) => applyDecisionDraftSelections(db, {
        scope,
        actorId: ownerId,
        occurredAt: '2026-09-09T10:10:00.000Z',
        draftId: 'draft-confirm-decision',
        selections: [{
          proposal: {
            temporaryId: 'temporary-confirm',
            prompt: '재시도 횟수',
            alternatives: [{ optionId: 'three', label: '3회', description: '세 번 재시도' }],
            impact: '오류 복구 시간',
            recommendation: 'three',
            sourceRefs: [],
          },
          decisionMakerId,
          classification: { scope: 'current', requiredGate: 'G1', reason: '필수 정책' },
        }],
      }));
      if (mapping === undefined) throw new Error('decision mapping이 없습니다.');
      const service = createQuestionDecisionService(persistence);
      const ctx: ConfirmDecisionCommand = {
        actor: actor(decisionMakerId),
        scope,
        requestId: randomUUID(),
        idempotencyKey: 'confirm-once',
        guard: guard('decision', mapping.ref.entityId, 1),
      };
      const input = {
        decisionId: mapping.ref.entityId,
        selection: { optionId: 'three', text: '3회' },
        rationale: '장애 복구와 중복 방지를 함께 만족합니다.',
        evidence: { text: '결정권자가 운영 정책을 확인했습니다.' },
      };

      const unauthorized = service.confirmDecision({ ...ctx, actor: actor(ownerId), idempotencyKey: 'owner-confirm' }, input);
      const committed = service.confirmDecision(ctx, input);
      const replayed = service.confirmDecision({ ...ctx, requestId: randomUUID() }, input);

      expect(unauthorized).toMatchObject({ kind: 'Rejected', error: { code: 'NOT_ASSIGNED' } });
      expect(committed).toMatchObject({
        kind: 'Committed',
        value: {
          state: 'confirmed', revision: 2,
          currentConfirmation: {
            ref: { kind: 'decision', version: 1 },
            selection: input.selection,
            rationale: input.rationale,
            evidence: input.evidence,
            decidedBy: decisionMakerId,
          },
          reviewImpact: { affectedGates: ['G1', 'G2'], needsNewReview: true },
        },
      });
      expect(replayed).toMatchObject({ kind: 'Replayed', value: committed.kind === 'Committed' ? committed.value : {} });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM decision_versions WHERE project_id=? AND sr_id=? AND decision_id=?',
      ).get(projectId, srId, mapping.ref.entityId)).toEqual({ count: 1 });
    } finally {
      await app.close();
    }
  });
});
