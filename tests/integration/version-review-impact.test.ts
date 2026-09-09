import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyVersionReviewImpact } from '@/src/persistence/review-impact-repository';
import { demoCase } from '@/tests/helpers/domain-cases';
import { createTestApp } from '@/tests/helpers/test-app';

describe('일반 version ReviewImpact 저장', () => {
  it('G2 전용 변경은 G1 epoch·bundle을 보존하고 G2만 무효화합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const sample = demoCase('NOTI-028');
      const beforeSr = app.db.prepare(
        'SELECT progress_stage,revision FROM srs WHERE project_id=? AND sr_id=?',
      ).get(sample.projectId, sample.srId) as { progress_stage: 'ready'; revision: number };
      const beforeGates = app.db.prepare(
        `SELECT gate,review_epoch,validity,needs_new_bundle,current_bundle_id,
                current_bundle_version,last_pass_transition_id,revision
           FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate`,
      ).all(sample.projectId, sample.srId);
      const artifact = app.db.prepare(
        `SELECT artifact_id,current_version FROM artifacts
          WHERE project_id=? AND sr_id=? AND kind='implementation_plan'`,
      ).get(sample.projectId, sample.srId) as { artifact_id: string; current_version: number };
      const result = app.db.transaction(() => applyVersionReviewImpact(app.db, {
        projectId: sample.projectId,
        srId: sample.srId,
        actorId: sample.ownerId,
        currentStage: beforeSr.progress_stage,
        changedVersionRef: {
          kind: 'artifact', projectId: sample.projectId, srId: sample.srId,
          entityId: artifact.artifact_id, version: artifact.current_version,
        },
        affectedGates: ['G2'],
        reason: '구현 계획이 바뀌었습니다.',
        occurredAt: '2026-09-09T12:00:00.000Z',
        incrementSrRevision: true,
      })).immediate();

      expect(result).toMatchObject({
        progressStage: 'planning',
        reviewImpact: { affectedGates: ['G2'], returnStage: 'planning' },
      });
      const afterGates = app.db.prepare(
        `SELECT gate,review_epoch,validity,needs_new_bundle,current_bundle_id,
                current_bundle_version,last_pass_transition_id,revision
           FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate`,
      ).all(sample.projectId, sample.srId) as typeof beforeGates;
      expect(afterGates[0]).toEqual((beforeGates as readonly unknown[])[0]);
      expect(afterGates[1]).toMatchObject({
        gate: 'G2', review_epoch: 2, validity: 'invalid', needs_new_bundle: 1,
      });
      expect(app.db.prepare(
        'SELECT progress_stage,revision FROM srs WHERE project_id=? AND sr_id=?',
      ).get(sample.projectId, sample.srId)).toEqual({
        progress_stage: 'planning', revision: beforeSr.revision + 1,
      });
    } finally {
      await app.close();
    }
  });

  it('followup 변경은 gate를 건드리지 않고 SR revision만 증가시킵니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const sample = demoCase('NOTI-028');
      const beforeSr = app.db.prepare(
        'SELECT progress_stage,revision FROM srs WHERE project_id=? AND sr_id=?',
      ).get(sample.projectId, sample.srId) as { progress_stage: 'ready'; revision: number };
      const beforeGates = app.db.prepare(
        'SELECT * FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
      ).all(sample.projectId, sample.srId);
      const artifact = app.db.prepare(
        `SELECT artifact_id,current_version FROM artifacts
          WHERE project_id=? AND sr_id=? AND kind='requirements'`,
      ).get(sample.projectId, sample.srId) as { artifact_id: string; current_version: number };
      const result = app.db.transaction(() => applyVersionReviewImpact(app.db, {
        projectId: sample.projectId,
        srId: sample.srId,
        actorId: sample.ownerId,
        currentStage: beforeSr.progress_stage,
        changedVersionRef: {
          kind: 'artifact', projectId: sample.projectId, srId: sample.srId,
          entityId: artifact.artifact_id, version: artifact.current_version,
        },
        affectedGates: [],
        reason: '후속 범위가 바뀌었습니다.',
        occurredAt: '2026-09-09T12:00:00.000Z',
        incrementSrRevision: true,
      })).immediate();
      expect(result.reviewImpact).toMatchObject({ affectedGates: [], needsNewReview: false });
      expect(app.db.prepare(
        'SELECT progress_stage,revision FROM srs WHERE project_id=? AND sr_id=?',
      ).get(sample.projectId, sample.srId)).toEqual({
        progress_stage: beforeSr.progress_stage, revision: beforeSr.revision + 1,
      });
      expect(app.db.prepare(
        'SELECT * FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
      ).all(sample.projectId, sample.srId)).toEqual(beforeGates);
    } finally {
      await app.close();
    }
  });
});
