import { randomUUID } from 'node:crypto';
import type { SrScope } from '@/src/contracts/context';
import type {
  DraftApplication,
  DraftApplicationResult,
  DraftView,
  GenerationResult,
} from '@/src/contracts/views';
import type { DatabaseConnection } from '@/src/persistence/database';
import { readStoredGenerationDraft } from '@/src/persistence/generation-run-query';

export class DraftRepositoryError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'ALREADY_APPLIED' | 'CORRUPT_DATA', message: string) {
    super(message);
    this.name = 'DraftRepositoryError';
  }
}

export function insertReviewedDraft(
  db: DatabaseConnection,
  input: {
    readonly scope: SrScope;
    readonly sourceDraftId: string;
    readonly taskKind: DraftView['taskKind'];
    readonly body: GenerationResult;
    readonly inputSnapshotId: string;
    readonly basisFingerprint: string;
    readonly reviewedBy: string;
    readonly reviewedAt: string;
    readonly comparisonSummary: string;
  },
): DraftView {
  const draftId = `draft-${randomUUID()}`;
  const provenance = {
    kind: 'human_review',
    sourceDraftId: input.sourceDraftId,
    reviewedBy: input.reviewedBy,
    reviewedAt: input.reviewedAt,
    comparisonSummary: input.comparisonSummary,
  } as const;
  db.prepare(
    `INSERT INTO generation_drafts(
       project_id,sr_id,draft_id,schema_version,task_kind,body_json,
       basis_input_snapshot_id,basis_fingerprint,provenance_json,created_at,
       source_run_id,source_draft_id,reviewed_by,reviewed_at,payload_json
     ) VALUES(?,?,?,1,?,?,?,?,?, ?,NULL,?,?,?,'{}')`,
  ).run(
    input.scope.projectId,
    input.scope.srId,
    draftId,
    input.taskKind,
    JSON.stringify(input.body),
    input.inputSnapshotId,
    input.basisFingerprint,
    JSON.stringify(provenance),
    input.reviewedAt,
    input.sourceDraftId,
    input.reviewedBy,
    input.reviewedAt,
  );
  const stored = readStoredGenerationDraft(
    db,
    input.scope.projectId,
    input.scope.srId,
    draftId,
    input.basisFingerprint,
  );
  if (stored === undefined) throw new DraftRepositoryError('CORRUPT_DATA', '저장한 검토 초안을 읽을 수 없습니다.');
  return stored.view;
}

export function insertDraftApplication(
  db: DatabaseConnection,
  input: {
    readonly scope: SrScope;
    readonly draftId: string;
    readonly appliedBy: string;
    readonly appliedAt: string;
    readonly checkedInputFingerprint: string;
    readonly selectedContent: DraftApplication['selectedContent'];
    readonly result: DraftApplicationResult;
    readonly receiptId: string;
    readonly reason?: string;
    readonly applicationId?: string;
  },
): string {
  const existing = db.prepare(
    `SELECT application_id FROM draft_applications
      WHERE project_id=? AND sr_id=? AND draft_id=?`,
  ).get(input.scope.projectId, input.scope.srId, input.draftId) as {
    readonly application_id: string;
  } | undefined;
  if (existing !== undefined) {
    throw new DraftRepositoryError('ALREADY_APPLIED', '초안은 이미 적용됐습니다.');
  }
  const applicationId = input.applicationId ?? `application-${randomUUID()}`;
  db.prepare(
    `INSERT INTO draft_applications(
       project_id,sr_id,application_id,draft_id,applied_by,applied_at,
       checked_input_fingerprint,selected_content_json,output_refs_json,receipt_id,reason
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    input.scope.projectId,
    input.scope.srId,
    applicationId,
    input.draftId,
    input.appliedBy,
    input.appliedAt,
    input.checkedInputFingerprint,
    JSON.stringify(input.selectedContent),
    JSON.stringify(input.result),
    input.receiptId,
    input.reason ?? null,
  );
  return applicationId;
}
