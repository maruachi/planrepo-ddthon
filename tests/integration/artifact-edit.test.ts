import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import manifest from '@/config/demo/manifest.json' with { type: 'json' };
import { createEditorFixture } from '@/tests/helpers/editor-fixture';
import { createTestApp } from '@/tests/helpers/test-app';
import { prepareGenerationSnapshot } from '@/src/application/generation-snapshot';
import { readGenerationBasis } from '@/src/persistence/generation-input-repository';
import { insertInputSnapshot } from '@/src/persistence/input-snapshot-repository';
import { loadProjectRuleSource } from '@/src/runtime/project-rule-source';
import type { ArtifactEdit, GenerationInput, GenerationResult } from '@/src/contracts/views';

function revisionScope(
  fixture: Awaited<ReturnType<typeof createEditorFixture>>,
  artifactId: string,
  revision: number,
) {
  return {
    actorId: fixture.scope.actorId,
    projectId: fixture.scope.projectId,
    srId: fixture.scope.srId,
    guard: {
      resource: {
        target: {
          kind: 'artifact' as const,
          projectId: fixture.scope.projectId,
          srId: fixture.scope.srId,
          entityId: artifactId,
        },
        expectedRevision: revision,
      },
    },
  };
}

function insertProviderDraft(
  app: Awaited<ReturnType<typeof createTestApp>>,
  fixture: { readonly scope: { readonly actorId: string; readonly projectId: string; readonly srId: string } },
  input: GenerationInput,
  body: GenerationResult,
) {
  const scope = { kind: 'sr' as const, projectId: fixture.scope.projectId, srId: fixture.scope.srId };
  const basis = readGenerationBasis(app.db, scope);
  if (basis === undefined) throw new Error('fixture 생성 입력을 찾을 수 없습니다.');
  const rules = loadProjectRuleSource(process.cwd()).rules;
  const prepared = prepareGenerationSnapshot(input, basis, rules);
  const suffix = randomUUID();
  return app.db.transaction(() => {
    const snapshot = insertInputSnapshot(app.db, {
      basis,
      prepared,
      projectRules: rules,
      capturedAt: '2026-09-09T05:00:00.000Z',
      snapshotId: `snapshot-${suffix}`,
    });
    const runId = `run-${suffix}`;
    const draftId = `draft-${suffix}`;
    app.db.prepare(
      `INSERT INTO generation_runs(
         project_id,sr_id,run_id,task_kind,input_snapshot_id,provider_selection_json,
         requested_by,requested_at,status,revision,result_draft_id,finished_at,payload_json
       ) VALUES(?,?,?,?,?,?,?,?,'succeeded',1,?,?,'{}')`,
    ).run(
      scope.projectId,
      scope.srId,
      runId,
      input.taskKind,
      snapshot.snapshotId,
      JSON.stringify({ providerId: 'mock', modelChoice: { kind: 'installed_default' } }),
      fixture.scope.actorId,
      '2026-09-09T05:01:00.000Z',
      draftId,
      '2026-09-09T05:02:00.000Z',
    );
    app.db.prepare(
      `INSERT INTO generation_drafts(
         project_id,sr_id,draft_id,schema_version,task_kind,body_json,
         basis_input_snapshot_id,basis_fingerprint,provenance_json,created_at,
         source_run_id,source_draft_id,reviewed_by,reviewed_at,payload_json
       ) VALUES(?,?,?,1,?,?,?,?,?,?,?,NULL,NULL,NULL,'{}')`,
    ).run(
      scope.projectId,
      scope.srId,
      draftId,
      input.taskKind,
      JSON.stringify(body),
      snapshot.snapshotId,
      snapshot.contentFingerprint,
      JSON.stringify({ kind: 'provider', sourceRunId: runId }),
      '2026-09-09T05:02:00.000Z',
      runId,
    );
    return { draftId, fingerprint: snapshot.contentFingerprint, snapshotId: snapshot.snapshotId, body };
  }).immediate();
}

describe('문서 편집과 초안 적용', () => {
  it('같은 absent 문서를 동시에 만들면 하나만 확정합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createEditorFixture(app);
      const results = await Promise.all([
        app.invoke('M-015', { ...fixture.scope, idempotencyKey: 'edit-a' }, fixture.edit),
        app.invoke('M-015', { ...fixture.scope, idempotencyKey: 'edit-b' }, fixture.competingEdit),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter(
        (result) => !result.ok && result.error.code === 'STALE_VERSION',
      )).toHaveLength(1);
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM artifacts WHERE project_id=? AND sr_id=?',
      ).get(fixture.scope.projectId, fixture.scope.srId)).toEqual({ count: 1 });
    } finally {
      await app.close();
    }
  });

  it('고정 replay value와 현재 revision을 분리하고 같은 ID의 본문·criteria 변경을 비교합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createEditorFixture(app);
      const first = await app.invoke(
        'M-015',
        { ...fixture.scope, idempotencyKey: 'artifact-first' },
        fixture.edit,
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const markdown = '## FR-EDIT 변경된 요구사항\nFR-EDIT은 본문과 기준이 바뀝니다.\n';
      const secondEdit = {
        ...fixture.edit,
        markdown,
        sectionIndex: [{
          sectionId: 'FR-EDIT', title: '변경된 요구사항', startOffset: 0, endOffset: markdown.length,
        }],
        requirementLinks: [{
          requirementId: 'FR-EDIT',
          sectionIds: ['FR-EDIT'] as [string, ...string[]],
          acceptanceCriteria: ['변경된 기준'],
        }],
        changeSummary: '본문과 기준을 바꿉니다.',
        targetBasis: { kind: 'version' as const, ref: first.value.versionRef },
      };
      const second = await app.invoke(
        'M-015',
        { ...revisionScope(fixture, first.value.artifactId, first.value.revision), idempotencyKey: 'artifact-second' },
        secondEdit,
      );
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      const replay = await app.invoke(
        'M-015',
        { ...fixture.scope, idempotencyKey: 'artifact-first' },
        fixture.edit,
      );
      expect(replay).toMatchObject({
        ok: true,
        value: { versionRef: { version: 1 } },
        current: { currentRevision: 2 },
      });

      const diff = await app.invoke('M-016', {
        actorId: fixture.scope.actorId,
        projectId: fixture.scope.projectId,
        srId: fixture.scope.srId,
      }, { before: first.value.versionRef, after: second.value.versionRef });
      expect(diff.ok).toBe(true);
      if (diff.ok) {
        expect(diff.value.changedSectionIds).toEqual(['FR-EDIT']);
        expect(diff.value.changedRequirementIds).toEqual(['FR-EDIT']);
      }
    } finally {
      await app.close();
    }
  });

  it('M-016은 같은 문서에서 제거된 decision ref도 변경 목록에 포함합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const sample = (await app.invoke('M-047', {
        actorId: 'persona-p01-owner', projectId: 'demo-project', srId: 'sr-pay-102',
      }, {}));
      expect(sample.ok).toBe(true);
      if (!sample.ok) return;
      const original = sample.value.artifacts.find(({ kind }) => kind === 'requirements');
      const decisionRef = sample.value.decisions[0]?.currentConfirmation?.ref;
      if (original === undefined || decisionRef === undefined) throw new Error('DEMO-4 비교 자료가 없습니다.');
      const edit = {
        kind: 'requirements' as const,
        artifactId: original.artifactId,
        markdown: original.markdown,
        sectionIndex: original.sectionIndex,
        requirementLinks: original.requirementLinks,
        changeSummary: '결정 근거를 연결합니다.',
        targetBasis: { kind: 'version' as const, ref: original.versionRef },
        decisionRefs: [decisionRef],
        sourceRefs: original.sourceRefs,
        questionResultRefs: original.questionResultRefs,
      };
      const linked = await app.invoke('M-015', {
        actorId: sample.value.sr.ownerId,
        projectId: sample.value.sr.scope.projectId,
        srId: sample.value.sr.scope.srId,
        guard: { resource: { target: {
          kind: 'artifact', projectId: original.scope.projectId,
          srId: original.scope.srId, entityId: original.artifactId,
        }, expectedRevision: original.revision } },
      }, edit);
      expect(linked.ok).toBe(true);
      if (!linked.ok) return;
      const removed = await app.invoke('M-015', {
        actorId: sample.value.sr.ownerId,
        projectId: sample.value.sr.scope.projectId,
        srId: sample.value.sr.scope.srId,
        guard: { resource: { target: {
          kind: 'artifact', projectId: original.scope.projectId,
          srId: original.scope.srId, entityId: original.artifactId,
        }, expectedRevision: linked.value.revision } },
      }, {
        ...edit,
        changeSummary: '결정 근거 연결을 제거합니다.',
        targetBasis: { kind: 'version', ref: linked.value.versionRef },
        decisionRefs: [],
      });
      expect(removed.ok).toBe(true);
      if (!removed.ok) return;
      const compared = await app.invoke('M-016', {
        actorId: sample.value.sr.ownerId,
        projectId: sample.value.sr.scope.projectId,
        srId: sample.value.sr.scope.srId,
      }, { before: linked.value.versionRef, after: removed.value.versionRef });
      expect(compared).toMatchObject({
        ok: true,
        value: { changedDecisionRefs: [decisionRef] },
      });
    } finally {
      await app.close();
    }
  });

  it('중간 version에서 삭제한 section과 requirement ID를 뒤 version에서 재사용하지 못합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createEditorFixture(app);
      const first = await app.invoke(
        'M-015', { ...fixture.scope, idempotencyKey: 'history-first' }, fixture.edit,
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const replacementMarkdown = '## FR-NEW 새 요구사항\n새 항목입니다.\n';
      const replacement = await app.invoke('M-015', {
        ...revisionScope(fixture, first.value.artifactId, first.value.revision),
        idempotencyKey: 'history-replacement',
      }, {
        ...fixture.edit,
        markdown: replacementMarkdown,
        sectionIndex: [{
          sectionId: 'FR-NEW', title: '새 요구사항', startOffset: 0, endOffset: replacementMarkdown.length,
        }],
        requirementLinks: [{
          requirementId: 'FR-NEW', sectionIds: ['FR-NEW'], acceptanceCriteria: ['새 기준'],
        }],
        changeSummary: '기존 항목을 삭제합니다.',
        targetBasis: { kind: 'version', ref: first.value.versionRef },
      });
      expect(replacement.ok).toBe(true);
      if (!replacement.ok) return;
      const reused = await app.invoke('M-015', {
        ...revisionScope(fixture, first.value.artifactId, replacement.value.revision),
        idempotencyKey: 'history-reused',
      }, {
        ...fixture.edit,
        targetBasis: { kind: 'version', ref: replacement.value.versionRef },
        changeSummary: '삭제된 ID를 재사용합니다.',
      });
      expect(reused).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    } finally {
      await app.close();
    }
  });

  it('WorkflowPlan에서 삭제한 task ID도 뒤 version의 다른 항목에 재사용하지 못합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createEditorFixture(app);
      const workflow = (taskId: string, targetBasis: ArtifactEdit['targetBasis']) => {
        const markdown = `## FR-WORK 진행 계획\nFR-WORK을 ${taskId}로 구현합니다.\n`;
        return {
          kind: 'workflow_plan' as const,
          markdown,
          sectionIndex: [{ sectionId: 'FR-WORK', title: '진행 계획', startOffset: 0, endOffset: markdown.length }],
          requirementLinks: [{ requirementId: 'FR-WORK', sectionIds: ['FR-WORK'] as [string], acceptanceCriteria: ['검증합니다.'] }],
          changeSummary: `${taskId} 계획`,
          targetBasis,
          workflowVersion: 'v1.0.1' as const,
          stages: [{ stageId: 'functional', choice: 'skipped' as const, reason: '기존 설계를 사용합니다.' }] as const,
          implementationUnitCount: 1 as const,
          requirementTaskLinks: [{ taskId, requirementIds: ['FR-WORK'] as [string], verification: ['test'] as [string], order: 1 }] as const,
        };
      };
      const firstInput = workflow('CG-OLD', { kind: 'absent', logicalKey: 'workflow_plan' });
      const first = await app.invoke('M-017', {
        actorId: fixture.scope.actorId, projectId: fixture.scope.projectId, srId: fixture.scope.srId,
        guard: { resource: { target: {
          kind: 'artifact_logical_key', projectId: fixture.scope.projectId,
          srId: fixture.scope.srId, logicalKey: 'workflow_plan',
        }, expected: 'absent' } },
      }, firstInput);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const secondInput = workflow('CG-NEW', { kind: 'version', ref: first.value.versionRef });
      const second = await app.invoke('M-017', {
        ...revisionScope(fixture, first.value.artifactId, first.value.revision),
      }, secondInput);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      const reused = await app.invoke('M-017', {
        ...revisionScope(fixture, first.value.artifactId, second.value.revision),
      }, workflow('CG-OLD', { kind: 'version', ref: second.value.versionRef }));
      expect(reused).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    } finally {
      await app.close();
    }
  });

  it('저장된 WorkflowPlan 관계가 손상되면 M-047은 STORE_UNAVAILABLE입니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      app.db.exec('DROP TRIGGER workflow_plan_versions_no_update');
      app.db.prepare(
        `UPDATE workflow_plan_versions SET stages_json=?
          WHERE project_id='demo-project' AND sr_id='sr-auth-331'`,
      ).run(JSON.stringify([
        { stageId: 'duplicate', choice: 'skipped', reason: '첫 단계' },
        { stageId: 'duplicate', choice: 'skipped', reason: '중복 단계' },
      ]));
      const detail = await app.invoke('M-047', {
        actorId: 'persona-p01-owner', projectId: 'demo-project', srId: 'sr-auth-331',
      }, {});
      expect(detail).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
    } finally {
      await app.close();
    }
  });

  it('현재 fingerprint의 artifact 초안만 한 번 적용하고 정확한 결과를 재생합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createEditorFixture(app);
      const input = {
        taskKind: 'ARTIFACT_DRAFT' as const,
        documentKind: 'requirements' as const,
        targetBasis: { kind: 'absent' as const, logicalKey: 'requirements' },
      };
      const body = {
        schemaVersion: 1 as const,
        kind: 'artifact' as const,
        documentKind: 'requirements' as const,
        markdown: fixture.edit.markdown,
        requirementRefs: fixture.edit.requirementLinks.map(({ requirementId }) => requirementId),
        changeSummary: fixture.edit.changeSummary,
      };
      const draft = insertProviderDraft(app, fixture, input, body);
      const guard = {
        kind: 'artifact' as const,
        expectedInputFingerprint: draft.fingerprint,
        target: fixture.scope.guard?.resource,
      };
      if (guard.target === undefined) throw new Error('artifact guard가 없습니다.');
      const application = {
        draftId: draft.draftId,
        selectedContent: { kind: 'artifact' as const, edit: fixture.edit },
        applicationReason: '사람이 원문과 구조를 확인했습니다.',
      };
      const applied = await app.invoke('M-018', {
        actorId: fixture.scope.actorId,
        projectId: fixture.scope.projectId,
        srId: fixture.scope.srId,
        guard,
        idempotencyKey: 'apply-artifact-draft',
      }, application);
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.value).toMatchObject({
        draftId: draft.draftId,
        result: { kind: 'artifact', artifactVersionRef: { version: 1 } },
        reviewImpact: { affectedGates: ['G1', 'G2'] },
      });
      expect(app.db.prepare(
        `SELECT draft_id,checked_input_fingerprint,output_refs_json
           FROM draft_applications WHERE project_id=? AND sr_id=?`,
      ).get(fixture.scope.projectId, fixture.scope.srId)).toMatchObject({
        draft_id: draft.draftId,
        checked_input_fingerprint: draft.fingerprint,
        output_refs_json: JSON.stringify(applied.value.result),
      });

      const replay = await app.invoke('M-018', {
        actorId: fixture.scope.actorId,
        projectId: fixture.scope.projectId,
        srId: fixture.scope.srId,
        guard,
        idempotencyKey: 'apply-artifact-draft',
      }, application);
      expect(replay).toMatchObject({
        ok: true,
        disposition: 'Replayed',
        value: applied.value,
      });
      const duplicate = await app.invoke('M-018', {
        actorId: fixture.scope.actorId,
        projectId: fixture.scope.projectId,
        srId: fixture.scope.srId,
        guard,
        idempotencyKey: 'apply-artifact-draft-again',
      }, application);
      expect(duplicate).toMatchObject({ ok: false, error: { code: 'INPUT_CHANGED' } });
      const detail = await app.invoke('M-047', fixture.scope, {});
      expect(detail).toMatchObject({
        ok: true,
        value: {
          generationDrafts: [expect.objectContaining({
            draftId: draft.draftId,
            application: {
              kind: 'applied',
              applicationId: applied.value.applicationId,
              result: applied.value.result,
            },
          })],
        },
      });
    } finally {
      await app.close();
    }
  });

  it('오래된 원 초안은 최신 fingerprint로 직접 적용하지 않고 M-019가 현재 target snapshot을 새로 고정합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createEditorFixture(app);
      const input = {
        taskKind: 'ARTIFACT_DRAFT' as const,
        documentKind: 'requirements' as const,
        targetBasis: { kind: 'absent' as const, logicalKey: 'requirements' },
      };
      const body = {
        schemaVersion: 1 as const,
        kind: 'artifact' as const,
        documentKind: 'requirements' as const,
        markdown: fixture.edit.markdown,
        requirementRefs: ['FR-EDIT'],
        changeSummary: fixture.edit.changeSummary,
      };
      const draft = insertProviderDraft(app, fixture, input, body);
      const currentArtifact = await app.invoke(
        'M-015', { ...fixture.scope, idempotencyKey: 'occupy-absent-target' }, fixture.competingEdit,
      );
      expect(currentArtifact.ok).toBe(true);
      if (!currentArtifact.ok) return;
      const preparation = await app.invoke(
        'M-047', fixture.scope, { kind: 'draft', draftId: draft.draftId },
      );
      expect(preparation.ok).toBe(true);
      if (!preparation.ok || preparation.value.preparation?.kind !== 'draft') return;
      const latestFingerprint = preparation.value.preparation.currentInputFingerprint;
      const direct = await app.invoke('M-018', {
        actorId: fixture.scope.actorId,
        projectId: fixture.scope.projectId,
        srId: fixture.scope.srId,
        idempotencyKey: 'direct-stale-draft',
        guard: {
          kind: 'artifact',
          expectedInputFingerprint: latestFingerprint,
          target: { target: {
            kind: 'artifact_logical_key', projectId: fixture.scope.projectId,
            srId: fixture.scope.srId, logicalKey: 'requirements',
          }, expected: 'absent' },
        },
      }, { draftId: draft.draftId, selectedContent: { kind: 'artifact', edit: fixture.edit } });
      expect(direct).toMatchObject({ ok: false, error: { code: 'INPUT_CHANGED' } });

      const reviewed = await app.invoke('M-019', {
        actorId: fixture.scope.actorId,
        projectId: fixture.scope.projectId,
        srId: fixture.scope.srId,
        idempotencyKey: 'review-current-target',
        guard: { expectedInputFingerprint: latestFingerprint },
      }, {
        sourceDraftId: draft.draftId,
        currentInputFingerprint: latestFingerprint,
        body,
        comparisonSummary: '현재 문서 version을 기준으로 다시 확인했습니다.',
      });
      if (!reviewed.ok) throw new Error(JSON.stringify(reviewed.error));
      expect(reviewed.ok).toBe(true);
      expect(reviewed.value).toMatchObject({
        taskKind: 'ARTIFACT_REVISION',
        basisFingerprint: expect.not.stringMatching(new RegExp(`^${draft.fingerprint}$`, 'u')),
      });
      expect(reviewed.value.basisInputSnapshotRef).not.toBe(draft.snapshotId);
      const reviewedSnapshot = app.db.prepare(
        `SELECT task_kind,target_basis_json,content_fingerprint FROM input_snapshots
          WHERE project_id=? AND sr_id=? AND snapshot_id=?`,
      ).get(fixture.scope.projectId, fixture.scope.srId, reviewed.value.basisInputSnapshotRef) as {
        task_kind: string; target_basis_json: string; content_fingerprint: string;
      };
      expect(reviewedSnapshot).toMatchObject({
        task_kind: 'ARTIFACT_REVISION',
        content_fingerprint: reviewed.value.basisFingerprint,
      });
      expect(JSON.parse(reviewedSnapshot.target_basis_json)).toEqual({
        kind: 'version', ref: currentArtifact.value.versionRef,
      });
      const replayed = await app.invoke('M-019', {
        actorId: fixture.scope.actorId,
        projectId: fixture.scope.projectId,
        srId: fixture.scope.srId,
        idempotencyKey: 'review-current-target',
        guard: { expectedInputFingerprint: latestFingerprint },
      }, {
        sourceDraftId: draft.draftId,
        currentInputFingerprint: latestFingerprint,
        body,
        comparisonSummary: '현재 문서 version을 기준으로 다시 확인했습니다.',
      });
      expect(replayed).toMatchObject({
        ok: true,
        disposition: 'Replayed',
        value: reviewed.value,
        current: {
          target: {
            kind: 'generation_draft',
            entityId: reviewed.value.draftId,
          },
          inputFingerprint: reviewed.value.basisFingerprint,
        },
      });
      const beforeReads = app.db.prepare(
        `SELECT
           (SELECT count(*) FROM input_snapshots WHERE project_id=? AND sr_id=?) AS snapshots,
           (SELECT count(*) FROM generation_drafts WHERE project_id=? AND sr_id=?) AS drafts,
           (SELECT count(*) FROM draft_applications WHERE project_id=? AND sr_id=?) AS applications`,
      ).get(
        fixture.scope.projectId, fixture.scope.srId,
        fixture.scope.projectId, fixture.scope.srId,
        fixture.scope.projectId, fixture.scope.srId,
      );
      const reopened = await app.invoke('M-047', fixture.scope, {});
      expect(reopened).toMatchObject({
        ok: true,
        value: {
          generationDrafts: expect.arrayContaining([
            expect.objectContaining({
              draftId: draft.draftId,
              provenance: expect.objectContaining({ kind: 'provider' }),
              basisInputSnapshotRef: draft.snapshotId,
              application: { kind: 'not_applied' },
            }),
            expect.objectContaining({
              draftId: reviewed.value.draftId,
              provenance: expect.objectContaining({
                kind: 'human_review', sourceDraftId: draft.draftId,
              }),
              basisInputSnapshotRef: reviewed.value.basisInputSnapshotRef,
              application: { kind: 'not_applied' },
            }),
          ]),
        },
      });
      if (!reopened.ok) throw new Error(JSON.stringify(reopened.error));
      expect(reopened.value.generationDrafts).toHaveLength(2);
      expect(reopened.value.generationDrafts.every((item) => !Object.hasOwn(item, 'body'))).toBe(true);

      const selected = await app.invoke(
        'M-047', fixture.scope, { kind: 'draft', draftId: reviewed.value.draftId },
      );
      expect(selected).toMatchObject({
        ok: true,
        value: {
          draftReview: {
            draft: reviewed.value,
            inputSnapshot: {
              snapshotId: reviewed.value.basisInputSnapshotRef,
              contentFingerprint: reviewed.value.basisFingerprint,
              contents: expect.any(Array),
            },
          },
          preparation: {
            kind: 'draft',
            draftId: reviewed.value.draftId,
            draftBasisFingerprint: reviewed.value.basisFingerprint,
          },
        },
      });
      expect(app.db.prepare(
        `SELECT
           (SELECT count(*) FROM input_snapshots WHERE project_id=? AND sr_id=?) AS snapshots,
           (SELECT count(*) FROM generation_drafts WHERE project_id=? AND sr_id=?) AS drafts,
           (SELECT count(*) FROM draft_applications WHERE project_id=? AND sr_id=?) AS applications`,
      ).get(
        fixture.scope.projectId, fixture.scope.srId,
        fixture.scope.projectId, fixture.scope.srId,
        fixture.scope.projectId, fixture.scope.srId,
      )).toEqual(beforeReads);
      const other = await createEditorFixture(app);
      expect(await app.invoke(
        'M-047', other.scope, { kind: 'draft', draftId: reviewed.value.draftId },
      )).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    } finally {
      await app.close();
    }
  });

  it('M-019는 현재 snapshot의 명시 question answer ref를 검토 제안 근거로 보존합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const projectId = manifest.projectId;
      const srId = manifest.srIds['PAY-102'];
      const questionId = manifest.entityIds['PAY-102'].questionId;
      const ownerId = manifest.personaIds['P-01'];
      const requesterId = manifest.personaIds['P-02'];
      const answered = await app.invoke('M-008', {
        actorId: requesterId,
        projectId,
        srId,
        idempotencyKey: 'answer-before-reviewed-draft',
        guard: { resource: { target: {
          kind: 'question', projectId, srId, entityId: questionId,
        }, expectedRevision: 1 } },
      }, {
        questionId,
        answeredQuestionSnapshotRef: {
          kind: 'question_result', projectId, srId, entityId: questionId, version: 1,
        },
        answer: { kind: 'free_text', text: '부분 취소와 중복 요청을 멱등 처리합니다.' },
        evidence: { text: '담당자가 정책을 확인했습니다.' },
      });
      expect(answered.ok).toBe(true);
      if (!answered.ok) throw new Error(JSON.stringify(answered.error));
      expect(answered.value.currentResult.selectedAnswer).toBeDefined();
      if (answered.value.currentResult.selectedAnswer === undefined) {
        throw new Error('M-008 응답에 선택 답변이 없습니다.');
      }
      const answerRef = answered.value.currentResult.selectedAnswer.ref;
      const body = {
        schemaVersion: 1 as const,
        kind: 'question_proposals' as const,
        proposals: [{
          temporaryId: 'followup-after-answer',
          text: '실패 유형별 재시도 횟수는 몇 회입니까?',
          reason: '답변에서 세부 정책을 확인합니다.',
          suggestedAssigneeId: requesterId,
          requiredGate: 'G1' as const,
          sourceRefs: [answerRef],
          candidateAnswers: [],
        }] as const,
      };
      const fixture = { scope: { actorId: ownerId, projectId, srId } };
      const draft = insertProviderDraft(app, fixture, { taskKind: 'QUESTION_PROPOSALS' }, body);

      const reviewed = await app.invoke('M-019', {
        ...fixture.scope,
        idempotencyKey: 'review-answer-source-ref',
        guard: { expectedInputFingerprint: draft.fingerprint },
      }, {
        sourceDraftId: draft.draftId,
        currentInputFingerprint: draft.fingerprint,
        body,
        comparisonSummary: '선택 답변을 근거로 후속 질문을 확인했습니다.',
      });
      if (!reviewed.ok) throw new Error(JSON.stringify(reviewed.error));

      expect(reviewed).toMatchObject({
        ok: true,
        value: {
          body: { kind: 'question_proposals', proposals: [{ sourceRefs: [answerRef] }] },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('M-019 검토 초안은 원 초안과 fingerprint를 보존하고 변경된 현재 입력을 거절합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createEditorFixture(app);
      const generationInput = { taskKind: 'QUESTION_PROPOSALS' as const };
      const body = {
        schemaVersion: 1 as const,
        kind: 'question_proposals' as const,
        proposals: [{
          temporaryId: 'proposal-q1',
          text: '정책을 확인했습니까?',
          reason: '요구사항 확인',
          suggestedAssigneeId: fixture.scope.actorId,
          requiredGate: 'G1' as const,
          sourceRefs: [],
          candidateAnswers: ['확인했습니다.'],
        }] as const,
      };
      const draft = insertProviderDraft(app, fixture, generationInput, body);
      const reviewedBody = {
        ...body,
        proposals: [{ ...body.proposals[0], text: '정책 원문을 직접 확인했습니까?' }] as const,
      };
      const snapshotsBeforeInvalid = app.db.prepare(
        'SELECT count(*) AS count FROM input_snapshots WHERE project_id=? AND sr_id=?',
      ).get(fixture.scope.projectId, fixture.scope.srId);
      const invalid = await app.invoke('M-019', {
        actorId: fixture.scope.actorId,
        projectId: fixture.scope.projectId,
        srId: fixture.scope.srId,
        guard: { expectedInputFingerprint: draft.fingerprint },
        idempotencyKey: 'review-duplicate-proposals',
      }, {
        sourceDraftId: draft.draftId,
        currentInputFingerprint: draft.fingerprint,
        body: { ...body, proposals: [body.proposals[0], body.proposals[0]] },
        comparisonSummary: '중복 제안은 저장하지 않습니다.',
      });
      expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM input_snapshots WHERE project_id=? AND sr_id=?',
      ).get(fixture.scope.projectId, fixture.scope.srId)).toEqual(snapshotsBeforeInvalid);
      const reviewed = await app.invoke('M-019', {
        actorId: fixture.scope.actorId,
        projectId: fixture.scope.projectId,
        srId: fixture.scope.srId,
        guard: { expectedInputFingerprint: draft.fingerprint },
        idempotencyKey: 'review-draft',
      }, {
        sourceDraftId: draft.draftId,
        currentInputFingerprint: draft.fingerprint,
        body: reviewedBody,
        comparisonSummary: '질문 표현을 구체화했습니다.',
      });
      expect(reviewed.ok).toBe(true);
      if (!reviewed.ok) return;
      expect(reviewed.value).toMatchObject({
        basisInputSnapshotRef: expect.stringMatching(/^snapshot-/u),
        basisFingerprint: draft.fingerprint,
        provenance: {
          kind: 'human_review',
          sourceDraftId: draft.draftId,
          reviewedBy: fixture.scope.actorId,
          comparisonSummary: '질문 표현을 구체화했습니다.',
        },
      });

      const changedDescription = await app.invoke('M-005', {
        actorId: fixture.scope.actorId,
        projectId: fixture.scope.projectId,
        srId: fixture.scope.srId,
        guard: { resource: { target: {
          kind: 'sr', projectId: fixture.scope.projectId,
          srId: fixture.scope.srId, entityId: fixture.scope.srId,
        }, expectedRevision: 1 } },
      }, {
        title: '문서 편집 검증', purpose: '동시 생성 검증',
        description: '현재 입력을 바꿉니다.', changeReason: 'stale 검증',
      });
      expect(changedDescription.ok).toBe(true);
      const stale = await app.invoke('M-019', {
        actorId: fixture.scope.actorId,
        projectId: fixture.scope.projectId,
        srId: fixture.scope.srId,
        guard: { expectedInputFingerprint: draft.fingerprint },
        idempotencyKey: 'review-stale',
      }, {
        sourceDraftId: draft.draftId,
        currentInputFingerprint: draft.fingerprint,
        body,
        comparisonSummary: '오래된 입력입니다.',
      });
      expect(stale).toMatchObject({ ok: false, error: { code: 'INPUT_CHANGED' } });
    } finally {
      await app.close();
    }
  });

  it('질문과 decision 초안은 temporaryId를 서버 ID에 정확히 매핑하고 decision을 미확정으로 둡니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createEditorFixture(app);
      const questionBody = {
        schemaVersion: 1 as const,
        kind: 'question_proposals' as const,
        proposals: [{
          temporaryId: 'temporary-question', text: '추가 정책이 있습니까?',
          reason: '요구사항 확인', suggestedAssigneeId: fixture.scope.actorId,
          requiredGate: 'G1' as const, sourceRefs: [], candidateAnswers: [],
        }] as const,
      };
      const questionDraft = insertProviderDraft(
        app, fixture, { taskKind: 'QUESTION_PROPOSALS' }, questionBody,
      );
      const questions = await app.invoke('M-018', {
        actorId: fixture.scope.actorId,
        projectId: fixture.scope.projectId,
        srId: fixture.scope.srId,
        guard: { kind: 'questions', expectedInputFingerprint: questionDraft.fingerprint },
      }, {
        draftId: questionDraft.draftId,
        selectedContent: { kind: 'questions', temporaryIds: ['temporary-question'] },
      });
      expect(questions.ok).toBe(true);
      if (!questions.ok || questions.value.result.kind !== 'questions') return;
      expect(questions.value.result.mappings).toEqual([{
        temporaryId: 'temporary-question',
        ref: expect.objectContaining({ kind: 'question', entityId: expect.stringMatching(/^question-/u) }),
      }]);

      const decisionBody = {
        schemaVersion: 1 as const,
        kind: 'decision_proposals' as const,
        proposals: [{
          temporaryId: 'temporary-decision', prompt: '정책을 적용합니까?',
          alternatives: [{ optionId: 'yes', label: '적용', description: '정책을 적용합니다.' }] as const,
          impact: '요구사항에 반영됩니다.', recommendation: '적용', sourceRefs: [],
        }] as const,
      };
      const decisionDraft = insertProviderDraft(
        app, fixture, { taskKind: 'DECISION_PROPOSALS' }, decisionBody,
      );
      const decisions = await app.invoke('M-018', {
        actorId: fixture.scope.actorId,
        projectId: fixture.scope.projectId,
        srId: fixture.scope.srId,
        guard: { kind: 'decisions', expectedInputFingerprint: decisionDraft.fingerprint },
      }, {
        draftId: decisionDraft.draftId,
        selectedContent: {
          kind: 'decisions',
          selections: [{
            temporaryId: 'temporary-decision',
            decisionMakerId: fixture.scope.actorId,
            classification: { scope: 'current', requiredGate: 'G2', reason: '계획 전에 확정합니다.' },
          }],
        },
      });
      expect(decisions.ok).toBe(true);
      if (!decisions.ok || decisions.value.result.kind !== 'decisions') return;
      expect(decisions.value.result.mappings).toEqual([{
        temporaryId: 'temporary-decision',
        ref: expect.objectContaining({ kind: 'decision', entityId: expect.stringMatching(/^decision-/u) }),
      }]);
      const detail = await app.invoke('M-047', fixture.scope, {});
      expect(detail.ok).toBe(true);
      if (detail.ok) {
        expect(detail.value.decisions).toContainEqual(expect.objectContaining({
          decisionId: decisions.value.result.mappings[0].ref.entityId,
          state: 'unconfirmed',
          decisionMakerId: fixture.scope.actorId,
          requiredGate: 'G2',
        }));
      }
    } finally {
      await app.close();
    }
  });

  it('M-018 nested edit의 UTF-8 1 MiB 초과 본문은 HTTP 413으로 거절합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createEditorFixture(app);
      const markdown = `## FR-BIG 큰 문서\nFR-BIG ${'가'.repeat(400_000)}`;
      const response = await app.server.inject({
        method: 'POST',
        url: '/api/methods/M-018',
        headers: {
          host: new URL(app.baseURL).host,
          origin: app.baseURL,
          'x-planrepo-actor': fixture.scope.actorId,
        },
        payload: {
          scope: { kind: 'sr', projectId: fixture.scope.projectId, srId: fixture.scope.srId },
          input: {
            draftId: 'draft-big',
            selectedContent: {
              kind: 'artifact',
              edit: {
                ...fixture.edit,
                markdown,
                sectionIndex: [{ sectionId: 'FR-BIG', title: '큰 문서', startOffset: 0, endOffset: markdown.length }],
                requirementLinks: [{ requirementId: 'FR-BIG', sectionIds: ['FR-BIG'], acceptanceCriteria: ['검증'] }],
              },
            },
          },
          meta: {
            requestId: randomUUID(),
            idempotencyKey: randomUUID(),
            guard: {
              kind: 'artifact', expectedInputFingerprint: 'sha256:big',
              target: fixture.scope.guard.resource,
            },
          },
        },
      });
      expect(response.statusCode).toBe(413);
    } finally {
      await app.close();
    }
  });

  it('M-018의 늦은 activity 저장 실패는 문서·적용·receipt를 모두 rollback합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createEditorFixture(app);
      const body = {
        schemaVersion: 1 as const,
        kind: 'artifact' as const,
        documentKind: 'requirements' as const,
        markdown: fixture.edit.markdown,
        requirementRefs: ['FR-EDIT'],
        changeSummary: fixture.edit.changeSummary,
      };
      const draft = insertProviderDraft(app, fixture, {
        taskKind: 'ARTIFACT_DRAFT', documentKind: 'requirements',
        targetBasis: { kind: 'absent', logicalKey: 'requirements' },
      }, body);
      app.db.exec(
        `CREATE TEMP TRIGGER fail_draft_activity BEFORE INSERT ON activity_events
         WHEN NEW.event_type='generation_draft_applied'
         BEGIN SELECT RAISE(ABORT, '주입한 초안 활동 실패'); END`,
      );
      const result = await app.invoke('M-018', {
        actorId: fixture.scope.actorId,
        projectId: fixture.scope.projectId,
        srId: fixture.scope.srId,
        idempotencyKey: 'rollback-draft-application',
        guard: {
          kind: 'artifact', expectedInputFingerprint: draft.fingerprint,
          target: fixture.scope.guard.resource,
        },
      }, { draftId: draft.draftId, selectedContent: { kind: 'artifact', edit: fixture.edit } });
      expect(result).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
      expect(app.db.prepare(
        `SELECT
           (SELECT count(*) FROM artifacts WHERE project_id=? AND sr_id=?) AS artifacts,
           (SELECT count(*) FROM draft_applications WHERE project_id=? AND sr_id=?) AS applications,
           (SELECT count(*) FROM command_receipts WHERE project_id=? AND idempotency_key=?) AS receipts`,
      ).get(
        fixture.scope.projectId, fixture.scope.srId,
        fixture.scope.projectId, fixture.scope.srId,
        fixture.scope.projectId, 'rollback-draft-application',
      )).toEqual({ artifacts: 0, applications: 0, receipts: 0 });
    } finally {
      await app.close();
    }
  });
});
