import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prepareGenerationSnapshot } from '@/src/application/generation-snapshot';
import { readGenerationBasis } from '@/src/persistence/generation-input-repository';
import { insertInputSnapshot } from '@/src/persistence/input-snapshot-repository';
import { loadProjectRuleSource } from '@/src/runtime/project-rule-source';
import { createEditorFixture } from '@/tests/helpers/editor-fixture';
import { createTestApp } from '@/tests/helpers/test-app';

describe('생성 입력 준비 조회', () => {
  it('새 생성·retry·draft가 같은 계산기를 쓰고 조회는 snapshot이나 run을 쓰지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createEditorFixture(app);
      const input = {
        taskKind: 'ARTIFACT_DRAFT' as const,
        documentKind: 'requirements' as const,
        targetBasis: { kind: 'absent' as const, logicalKey: 'requirements' },
        supplement: '',
      };
      const before = app.db.prepare(
        'SELECT count(*) AS snapshots FROM input_snapshots',
      ).get();
      const first = await app.invoke('M-047', fixture.scope, { kind: 'new_generation', input });
      if (!first.ok) throw new Error(JSON.stringify(first.error));
      expect(first.value.preparation).toMatchObject({
        kind: 'new_generation',
        input,
        expectedInputFingerprint: expect.stringMatching(/^sha256:/u),
      });
      expect(app.db.prepare('SELECT count(*) AS snapshots FROM input_snapshots').get()).toEqual(before);

      const rules = loadProjectRuleSource(process.cwd()).rules;
      const scope = { kind: 'sr' as const, projectId: fixture.scope.projectId, srId: fixture.scope.srId };
      const basis = readGenerationBasis(app.db, scope);
      if (basis === undefined) throw new Error('fixture SR 생성 입력을 찾을 수 없습니다.');
      const prepared = prepareGenerationSnapshot(input, basis, rules);
      const snapshot = app.db.transaction(() => {
        const stored = insertInputSnapshot(app.db, {
          basis, prepared, projectRules: rules, capturedAt: '2026-09-09T04:00:00.000Z',
          snapshotId: `snapshot-${randomUUID()}`,
        });
        app.db.prepare(
          `INSERT INTO generation_runs(
             project_id,sr_id,run_id,task_kind,input_snapshot_id,provider_selection_json,
             requested_by,requested_at,status,revision,error_code,finished_at,payload_json
           ) VALUES(?,?,?,?,?,?,?,?,'failed',1,'PROVIDER_ERROR','2026-09-09T04:01:30.000Z','{}')`,
        ).run(
          scope.projectId, scope.srId, 'run-preparation', input.taskKind, stored.snapshotId,
          JSON.stringify({ providerId: 'mock', modelChoice: { kind: 'installed_default' } }),
          fixture.scope.actorId, '2026-09-09T04:01:00.000Z',
        );
        app.db.prepare(
          `INSERT INTO generation_runs(
             project_id,sr_id,run_id,task_kind,input_snapshot_id,provider_selection_json,
             requested_by,requested_at,status,revision,result_draft_id,finished_at,payload_json
           ) VALUES(?,?,?,?,?,?,?,?,'succeeded',1,?,?,'{}')`,
        ).run(
          scope.projectId, scope.srId, 'run-draft-preparation', input.taskKind, stored.snapshotId,
          JSON.stringify({ providerId: 'mock', modelChoice: { kind: 'installed_default' } }),
          fixture.scope.actorId, '2026-09-09T04:01:10.000Z',
          'draft-preparation', '2026-09-09T04:02:00.000Z',
        );
        app.db.prepare(
          `INSERT INTO generation_drafts(
             project_id,sr_id,draft_id,schema_version,task_kind,body_json,
             basis_input_snapshot_id,basis_fingerprint,provenance_json,created_at,
             source_run_id,source_draft_id,reviewed_by,reviewed_at,payload_json
           ) VALUES(?,?,?,1,?,?,?,?,?, ?,?,NULL,NULL,NULL,'{}')`,
        ).run(
          scope.projectId,
          scope.srId,
          'draft-preparation',
          input.taskKind,
          JSON.stringify({
            schemaVersion: 1, kind: 'artifact', documentKind: 'requirements',
            markdown: fixture.edit.markdown, requirementRefs: ['FR-EDIT'], changeSummary: '생성 초안',
          }),
          stored.snapshotId,
          stored.contentFingerprint,
          JSON.stringify({
            kind: 'provider', sourceRunId: 'run-draft-preparation',
          }),
          '2026-09-09T04:02:00.000Z',
          'run-draft-preparation',
        );
        return stored;
      }).immediate();

      const retry = await app.invoke('M-047', fixture.scope, { kind: 'retry', runId: 'run-preparation' });
      expect(retry.ok).toBe(true);
      if (retry.ok) {
        expect(retry.value.preparation).toMatchObject({
          kind: 'retry', input, expectedInputFingerprint: snapshot.contentFingerprint,
        });
      }

      const saved = await app.invoke(
        'M-015', { ...fixture.scope, idempotencyKey: 'preparation-artifact' }, fixture.edit,
      );
      expect(saved.ok).toBe(true);
      if (!saved.ok) return;
      const occupiedRetry = await app.invoke(
        'M-047', fixture.scope, { kind: 'retry', runId: 'run-preparation' },
      );
      expect(occupiedRetry).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
      const draft = await app.invoke('M-047', fixture.scope, { kind: 'draft', draftId: 'draft-preparation' });
      expect(draft.ok).toBe(true);
      if (draft.ok) {
        expect(draft.value.preparation).toMatchObject({
          kind: 'draft',
          draftBasisFingerprint: snapshot.contentFingerprint,
          freshness: 'stale',
          draftTargetBasis: { kind: 'absent', logicalKey: 'requirements' },
          currentTargetBasis: { kind: 'version', ref: saved.value.versionRef },
        });
      }
    } finally {
      await app.close();
    }
  });

  it('현재 입력이 생성 한도를 넘겨도 일반 M-047은 기존 run을 unknown freshness로 조회합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createEditorFixture(app);
      const scope = {
        kind: 'sr' as const,
        projectId: fixture.scope.projectId,
        srId: fixture.scope.srId,
      };
      const rules = loadProjectRuleSource(process.cwd()).rules;
      const basis = readGenerationBasis(app.db, scope);
      if (basis === undefined) throw new Error('fixture SR 생성 입력을 찾을 수 없습니다.');
      const input = { taskKind: 'QUESTION_PROPOSALS' as const };
      const prepared = prepareGenerationSnapshot(input, basis, rules);
      app.db.transaction(() => {
        const snapshot = insertInputSnapshot(app.db, {
          basis,
          prepared,
          projectRules: rules,
          capturedAt: '2026-09-09T04:00:00.000Z',
          snapshotId: 'snapshot-before-large-sources',
        });
        app.db.prepare(
          `INSERT INTO generation_runs(
             project_id,sr_id,run_id,task_kind,input_snapshot_id,provider_selection_json,
             requested_by,requested_at,status,revision,result_draft_id,finished_at,payload_json
           ) VALUES(?,?,?,?,?,?,?,?,'succeeded',1,?,'2026-09-09T04:01:30.000Z','{}')`,
        ).run(
          scope.projectId,
          scope.srId,
          'run-before-large-sources',
          input.taskKind,
          snapshot.snapshotId,
          JSON.stringify({ providerId: 'mock', modelChoice: { kind: 'installed_default' } }),
          fixture.scope.actorId,
          '2026-09-09T04:01:00.000Z',
          'draft-before-large-sources',
        );
        app.db.prepare(
          `INSERT INTO generation_drafts(
             project_id,sr_id,draft_id,schema_version,task_kind,body_json,
             basis_input_snapshot_id,basis_fingerprint,provenance_json,created_at,
             source_run_id,source_draft_id,reviewed_by,reviewed_at,payload_json
           ) VALUES(?,?,?,1,'QUESTION_PROPOSALS',?,?,?,?,?,?,NULL,NULL,NULL,'{}')`,
        ).run(
          scope.projectId,
          scope.srId,
          'draft-before-large-sources',
          JSON.stringify({
            schemaVersion: 1,
            kind: 'question_proposals',
            proposals: [{
              temporaryId: 'before-large-source',
              text: '큰 입력 전 초안을 계속 볼 수 있습니까?',
              reason: '저장 초안 열람 검증',
              suggestedAssigneeId: fixture.scope.actorId,
              requiredGate: 'G1',
              sourceRefs: [],
              candidateAnswers: [],
            }],
          }),
          snapshot.snapshotId,
          snapshot.contentFingerprint,
          JSON.stringify({ kind: 'provider', sourceRunId: 'run-before-large-sources' }),
          '2026-09-09T04:01:30.000Z',
          'run-before-large-sources',
        );
      }).immediate();

      const pendingRetry = await app.invoke(
        'M-047', fixture.scope, { kind: 'retry', runId: 'run-before-large-sources' },
      );
      expect(pendingRetry).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });

      const largeContent = '가'.repeat(349_525);
      for (const index of [1, 2]) {
        const sr = app.db.prepare(
          'SELECT revision FROM srs WHERE project_id=? AND sr_id=?',
        ).get(scope.projectId, scope.srId) as { readonly revision: number };
        const attached = await app.invoke('M-006', {
          actorId: fixture.scope.actorId,
          projectId: scope.projectId,
          srId: scope.srId,
          idempotencyKey: `large-source-${index}`,
          guard: {
            resource: {
              target: { kind: 'sr', projectId: scope.projectId, srId: scope.srId, entityId: scope.srId },
              expectedRevision: sr.revision,
            },
          },
        }, {
          kind: 'text',
          content: largeContent,
          provenance: `대용량 근거 ${index}`,
        });
        expect(attached.ok).toBe(true);
      }

      const detail = await app.invoke('M-047', fixture.scope, {});
      expect(detail).toMatchObject({
        ok: true,
        value: {
          generationRuns: [{
            runId: 'run-before-large-sources',
            freshness: {
              kind: 'unknown',
              reason: '현재 생성 입력 기준을 아직 계산할 수 없습니다.',
            },
          }],
        },
      });
      const selectedDraft = await app.invoke(
        'M-047', fixture.scope, { kind: 'draft', draftId: 'draft-before-large-sources' },
      );
      expect(selectedDraft).toMatchObject({
        ok: true,
        value: {
          draftReview: {
            draft: {
              draftId: 'draft-before-large-sources',
              freshness: {
                kind: 'unknown',
                reason: '현재 생성 입력 기준을 아직 계산할 수 없습니다.',
              },
            },
            inputSnapshot: { snapshotId: 'snapshot-before-large-sources' },
          },
          preparationUnavailable: {
            reason: '현재 생성 입력이 2 MiB를 넘어 비교 기준을 계산할 수 없습니다.',
          },
        },
      });
      if (selectedDraft.ok) expect(selectedDraft.value.preparation).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('revision retry는 원 version 대신 같은 문서의 현재 exact version을 준비합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createEditorFixture(app);
      const first = await app.invoke(
        'M-015', { ...fixture.scope, idempotencyKey: 'retry-target-v1' }, fixture.edit,
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const scope = { kind: 'sr' as const, projectId: fixture.scope.projectId, srId: fixture.scope.srId };
      const rules = loadProjectRuleSource(process.cwd()).rules;
      const basis = readGenerationBasis(app.db, scope);
      if (basis === undefined) throw new Error('fixture SR 생성 입력을 찾을 수 없습니다.');
      const input = {
        taskKind: 'ARTIFACT_REVISION' as const,
        documentKind: 'requirements' as const,
        targetBasis: { kind: 'version' as const, ref: first.value.versionRef },
      };
      const prepared = prepareGenerationSnapshot(input, basis, rules);
      app.db.transaction(() => {
        const snapshot = insertInputSnapshot(app.db, {
          basis,
          prepared,
          projectRules: rules,
          capturedAt: '2026-09-09T04:10:00.000Z',
          snapshotId: 'snapshot-retry-v1',
        });
        app.db.prepare(
          `INSERT INTO generation_runs(
             project_id,sr_id,run_id,task_kind,input_snapshot_id,provider_selection_json,
             requested_by,requested_at,status,revision,error_code,finished_at,payload_json
           ) VALUES(?,?,?,?,?,?,?,?,'failed',1,'PROVIDER_ERROR','2026-09-09T04:12:00.000Z','{}')`,
        ).run(
          scope.projectId,
          scope.srId,
          'run-retry-v1',
          input.taskKind,
          snapshot.snapshotId,
          JSON.stringify({ providerId: 'mock', modelChoice: { kind: 'installed_default' } }),
          fixture.scope.actorId,
          '2026-09-09T04:11:00.000Z',
        );
      }).immediate();
      const markdown = '## FR-EDIT 개정 요구사항\nFR-EDIT은 현재 version을 사용합니다.\n';
      const second = await app.invoke('M-015', {
        actorId: fixture.scope.actorId,
        projectId: scope.projectId,
        srId: scope.srId,
        idempotencyKey: 'retry-target-v2',
        guard: { resource: { target: {
          kind: 'artifact', projectId: scope.projectId, srId: scope.srId,
          entityId: first.value.artifactId,
        }, expectedRevision: first.value.revision } },
      }, {
        ...fixture.edit,
        markdown,
        sectionIndex: [{ sectionId: 'FR-EDIT', title: '개정 요구사항', startOffset: 0, endOffset: markdown.length }],
        changeSummary: '현재 version으로 개정합니다.',
        targetBasis: { kind: 'version', ref: first.value.versionRef },
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      const retry = await app.invoke('M-047', fixture.scope, { kind: 'retry', runId: 'run-retry-v1' });
      expect(retry).toMatchObject({
        ok: true,
        value: { preparation: {
          kind: 'retry',
          input: { taskKind: 'ARTIFACT_REVISION', targetBasis: { kind: 'version', ref: second.value.versionRef } },
        } },
      });
    } finally {
      await app.close();
    }
  });

  it('M-047은 entity kind에 version을 붙인 손상 snapshot ref를 STORE_UNAVAILABLE로 거절합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createEditorFixture(app);
      const scope = {
        kind: 'sr' as const,
        projectId: fixture.scope.projectId,
        srId: fixture.scope.srId,
      };
      app.db.transaction(() => {
        app.db.prepare(
          `INSERT INTO input_snapshots(
             project_id,sr_id,snapshot_id,workflow_version,task_kind,content_fingerprint,
             contents_json,project_rules_json,captured_at,document_kind,target_basis_json,supplement
           ) VALUES(?,?,?,'v1.0.1','QUESTION_PROPOSALS','sha256:corrupt-ref',?,
                    '[]','2026-09-09T04:20:00.000Z',NULL,NULL,NULL)`,
        ).run(scope.projectId, scope.srId, 'snapshot-invalid-version-kind', JSON.stringify([{
          ref: {
            kind: 'question', projectId: scope.projectId, srId: scope.srId,
            entityId: 'invalid-version-kind', version: 1,
          },
          content: '잘못된 version kind입니다.',
          confirmation: 'not_applicable',
        }]));
        app.db.prepare(
          `INSERT INTO generation_runs(
             project_id,sr_id,run_id,task_kind,input_snapshot_id,provider_selection_json,
             requested_by,requested_at,status,revision,result_draft_id,finished_at,payload_json
           ) VALUES(?,?,?,?,?,?,?,?,'succeeded',1,?,?,'{}')`,
        ).run(
          scope.projectId,
          scope.srId,
          'run-invalid-version-kind',
          'QUESTION_PROPOSALS',
          'snapshot-invalid-version-kind',
          JSON.stringify({ providerId: 'mock', modelChoice: { kind: 'installed_default' } }),
          fixture.scope.actorId,
          '2026-09-09T04:21:00.000Z',
          'draft-invalid-version-kind',
          '2026-09-09T04:22:00.000Z',
        );
        app.db.prepare(
          `INSERT INTO generation_drafts(
             project_id,sr_id,draft_id,schema_version,task_kind,body_json,
             basis_input_snapshot_id,basis_fingerprint,provenance_json,created_at,
             source_run_id,source_draft_id,reviewed_by,reviewed_at,payload_json
           ) VALUES(?,?,?,1,'QUESTION_PROPOSALS',?,?,?, ?,?,?,NULL,NULL,NULL,'{}')`,
        ).run(
          scope.projectId,
          scope.srId,
          'draft-invalid-version-kind',
          JSON.stringify({
            schemaVersion: 1,
            kind: 'question_proposals',
            proposals: [{
              temporaryId: 'invalid-ref-proposal',
              text: '잘못된 snapshot을 읽습니까?',
              reason: 'codec 검증',
              suggestedAssigneeId: fixture.scope.actorId,
              requiredGate: 'G1',
              sourceRefs: [],
              candidateAnswers: [],
            }],
          }),
          'snapshot-invalid-version-kind',
          'sha256:corrupt-ref',
          JSON.stringify({ kind: 'provider', sourceRunId: 'run-invalid-version-kind' }),
          '2026-09-09T04:22:00.000Z',
          'run-invalid-version-kind',
        );
      }).immediate();

      expect(await app.invoke('M-047', fixture.scope, {})).toMatchObject({
        ok: false,
        error: { code: 'STORE_UNAVAILABLE' },
      });
    } finally {
      await app.close();
    }
  });
});
