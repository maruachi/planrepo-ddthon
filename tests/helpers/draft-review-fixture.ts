import { randomUUID } from 'node:crypto';
import type { GenerationInput, GenerationResult } from '@/src/contracts/views';
import { prepareGenerationSnapshot } from '@/src/application/generation-snapshot';
import { readGenerationBasis } from '@/src/persistence/generation-input-repository';
import { insertInputSnapshot } from '@/src/persistence/input-snapshot-repository';
import { loadProjectRuleSource } from '@/src/runtime/project-rule-source';
import type { TestApp } from '@/tests/helpers/test-app';

export function insertDraftReviewFixture(
  app: TestApp,
  scope: { readonly actorId: string; readonly projectId: string; readonly srId: string },
  input: GenerationInput,
  body: GenerationResult,
) {
  const srScope = { kind: 'sr' as const, projectId: scope.projectId, srId: scope.srId };
  const basis = readGenerationBasis(app.db, srScope);
  if (basis === undefined) throw new Error('초안 fixture의 현재 입력을 찾을 수 없습니다.');
  const rules = loadProjectRuleSource(process.cwd()).rules;
  const prepared = prepareGenerationSnapshot(input, basis, rules);
  const suffix = randomUUID();
  return app.db.transaction(() => {
    const snapshot = insertInputSnapshot(app.db, {
      basis,
      prepared,
      projectRules: rules,
      capturedAt: '2026-09-09T06:00:00.000Z',
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
      JSON.stringify({ providerId: 'ui-fixture', modelChoice: { kind: 'installed_default' } }),
      scope.actorId,
      '2026-09-09T06:01:00.000Z',
      draftId,
      '2026-09-09T06:02:00.000Z',
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
      '2026-09-09T06:02:00.000Z',
      runId,
    );
    return {
      draftId,
      runId,
      snapshotId: snapshot.snapshotId,
      fingerprint: snapshot.contentFingerprint,
    };
  }).immediate();
}
