import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  confirmContextSource,
  ContextSourceRepositoryError,
  insertUnconfirmedContextSource,
  readContextSource,
} from '@/src/persistence/context-source-repository';
import { createPersistence } from '@/src/persistence/transaction';
import { demoCase } from '@/tests/helpers/domain-cases';
import { createTestApp } from '@/tests/helpers/test-app';

function expectRepositoryError(
  action: () => unknown,
  code: ContextSourceRepositoryError['code'],
): void {
  try {
    action();
    throw new Error('저장소 오류가 발생하지 않았습니다.');
  } catch (error) {
    expect(error).toBeInstanceOf(ContextSourceRepositoryError);
    if (error instanceof ContextSourceRepositoryError) expect(error.code).toBe(code);
  }
}

describe('ContextSource 저장소', () => {
  it('링크를 미확인 v1로 저장하고 사람 확인을 불변 v2로 만듭니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const sample = demoCase('PAY-102');
      const persistence = createPersistence(app.db);
      const sourceId = `source-${randomUUID()}`;
      const created = persistence.withinTransaction((db) => insertUnconfirmedContextSource(db, {
        projectId: sample.projectId,
        srId: sample.srId,
        sourceId,
        createdBy: sample.ownerId,
        createdAt: '2026-09-09T01:00:00Z',
        input: {
          kind: 'link',
          targetUrl: 'https://example.invalid/reference',
          provenance: '사용자 입력',
          verifiable: false,
          displayName: '결제 정책 원문',
          observedExternalVersion: 'demo-v1',
          unavailableReason: '오프라인 데모입니다.',
        },
      }));
      expect(created).toMatchObject({
        sourceId,
        currentVersionRef: { version: 1 },
        revision: 1,
        kind: 'link',
        confirmation: 'unconfirmed',
        targetUrl: 'https://example.invalid/reference',
        verifiable: false,
        observedExternalVersion: 'demo-v1',
        unavailableReason: '오프라인 데모입니다.',
      });
      expect(created.confirmedBy).toBeUndefined();

      const confirmed = persistence.withinTransaction((db) => confirmContextSource(db, {
        projectId: sample.projectId,
        srId: sample.srId,
        sourceVersionRef: created.currentVersionRef,
        expectedRevision: created.revision,
        confirmedBy: sample.ownerId,
        confirmedAt: '2026-09-09T02:00:00Z',
        confirmationEvidence: '담당자가 원문을 직접 확인했습니다.',
      }));
      expect(confirmed).toMatchObject({
        currentVersionRef: { version: 2 },
        previousVersionRef: created.currentVersionRef,
        revision: 2,
        kind: 'link',
        confirmation: 'confirmed',
        confirmedBy: sample.ownerId,
        confirmedAt: '2026-09-09T02:00:00Z',
        confirmationEvidence: '담당자가 원문을 직접 확인했습니다.',
      });
      expect(app.db.prepare(
        `SELECT version,confirmation,confirmed_by,previous_version,target_url,payload_json
           FROM context_source_versions
          WHERE project_id=? AND sr_id=? AND source_id=? ORDER BY version`,
      ).all(sample.projectId, sample.srId, sourceId)).toEqual([
        {
          version: 1,
          confirmation: 'unconfirmed',
          confirmed_by: null,
          previous_version: null,
          target_url: 'https://example.invalid/reference',
          payload_json: JSON.stringify({
            verifiable: false,
            observedExternalVersion: 'demo-v1',
            unavailableReason: '오프라인 데모입니다.',
          }),
        },
        {
          version: 2,
          confirmation: 'confirmed',
          confirmed_by: sample.ownerId,
          previous_version: 1,
          target_url: 'https://example.invalid/reference',
          payload_json: JSON.stringify({
            verifiable: false,
            observedExternalVersion: 'demo-v1',
            unavailableReason: '오프라인 데모입니다.',
          }),
        },
      ]);
      expect(readContextSource(app.db, sample.projectId, sample.srId, sourceId)).toEqual(confirmed);
    } finally {
      await app.close();
    }
  });

  it('현재 source revision과 정확한 현재 version ref만 확인합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const sample = demoCase('PAY-102');
      const persistence = createPersistence(app.db);
      const created = persistence.withinTransaction((db) => insertUnconfirmedContextSource(db, {
        projectId: sample.projectId,
        srId: sample.srId,
        sourceId: `source-${randomUUID()}`,
        createdBy: sample.ownerId,
        createdAt: '2026-09-09T01:00:00Z',
        input: { kind: 'text', content: '정확한 본문', provenance: '사용자 입력' },
      }));
      const base = {
        projectId: sample.projectId,
        srId: sample.srId,
        sourceVersionRef: created.currentVersionRef,
        confirmedBy: sample.ownerId,
        confirmedAt: '2026-09-09T02:00:00Z',
        confirmationEvidence: '직접 확인했습니다.',
      };
      expectRepositoryError(() => persistence.withinTransaction((db) => confirmContextSource(db, {
        ...base, expectedRevision: 99,
      })), 'STALE_VERSION');
      expectRepositoryError(() => persistence.withinTransaction((db) => confirmContextSource(db, {
        ...base,
        expectedRevision: created.revision,
        sourceVersionRef: { ...created.currentVersionRef, srId: demoCase('AUTH-331').srId },
      })), 'VALIDATION_ERROR');

      const confirmed = persistence.withinTransaction((db) => confirmContextSource(db, {
        ...base, expectedRevision: created.revision,
      }));
      expectRepositoryError(() => persistence.withinTransaction((db) => confirmContextSource(db, {
        ...base,
        expectedRevision: confirmed.revision,
        sourceVersionRef: created.currentVersionRef,
      })), 'STALE_VERSION');
      expect(app.db.prepare(
        'SELECT version,content,confirmation FROM context_source_versions WHERE project_id=? AND sr_id=? AND source_id=? ORDER BY version',
      ).all(sample.projectId, sample.srId, created.sourceId)).toEqual([
        { version: 1, content: '정확한 본문', confirmation: 'unconfirmed' },
        { version: 2, content: '정확한 본문', confirmation: 'confirmed' },
      ]);
    } finally {
      await app.close();
    }
  });

  it('caller transaction rollback을 따르고 독자 commit을 만들지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const sample = demoCase('PAY-102');
      const persistence = createPersistence(app.db);
      const sourceId = `source-${randomUUID()}`;
      expect(() => persistence.withinTransaction((db) => {
        insertUnconfirmedContextSource(db, {
          projectId: sample.projectId,
          srId: sample.srId,
          sourceId,
          createdBy: sample.ownerId,
          createdAt: '2026-09-09T01:00:00Z',
          input: { kind: 'markdown', content: '# 임시', provenance: '사용자 입력' },
        });
        throw new Error('caller 실패');
      })).toThrow('caller 실패');
      expect(readContextSource(app.db, sample.projectId, sample.srId, sourceId)).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('저장 경계에서도 허용되지 않은 link URL을 거절합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const sample = demoCase('PAY-102');
      const persistence = createPersistence(app.db);
      expectRepositoryError(() => persistence.withinTransaction((db) =>
        insertUnconfirmedContextSource(db, {
          projectId: sample.projectId,
          srId: sample.srId,
          sourceId: `source-${randomUUID()}`,
          createdBy: sample.ownerId,
          createdAt: '2026-09-09T01:00:00Z',
          input: {
            kind: 'link',
            targetUrl: 'https://user:password@example.invalid/reference',
            provenance: '사용자 입력',
            verifiable: false,
          },
        })), 'VALIDATION_ERROR');
    } finally {
      await app.close();
    }
  });
});
