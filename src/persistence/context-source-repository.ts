import type { ContextSourceVersionRef, SrScope } from '@/src/contracts/context';
import type { ReviewImpact } from '@/src/contracts/results';
import type { ContextSourceView, SourceInput } from '@/src/contracts/views';
import { isAllowedSourceLinkUrl } from '@/src/domain/source-url';
import type { DatabaseConnection } from '@/src/persistence/database';

interface StoredSourceBase {
  readonly scope: SrScope;
  readonly sourceId: string;
  readonly currentVersionRef: ContextSourceVersionRef;
  readonly revision: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly displayName?: string;
  readonly provenance: string;
  readonly versionCreatedBy: string;
  readonly versionCreatedAt: string;
  readonly previousVersionRef?: ContextSourceVersionRef;
}

type StoredSourceContent =
  | { readonly kind: 'text' | 'markdown'; readonly content: string }
  | {
      readonly kind: 'link';
      readonly targetUrl: string;
      readonly verifiable: boolean;
      readonly observedExternalVersion?: string;
      readonly unavailableReason?: string;
    };

type StoredSourceConfirmation =
  | {
      readonly confirmation: 'unconfirmed';
      readonly confirmedBy?: never;
      readonly confirmedAt?: never;
      readonly confirmationEvidence?: never;
    }
  | {
      readonly confirmation: 'confirmed';
      readonly confirmedBy: string;
      readonly confirmedAt: string;
      readonly confirmationEvidence: string;
    };

export type StoredContextSource = StoredSourceBase & StoredSourceContent & StoredSourceConfirmation;

export interface NewStoredContextSource {
  readonly projectId: string;
  readonly srId: string;
  readonly sourceId: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly input: SourceInput;
}

export interface StoredSourceConfirmationInput {
  readonly projectId: string;
  readonly srId: string;
  readonly sourceVersionRef: ContextSourceVersionRef;
  readonly expectedRevision: number;
  readonly confirmedBy: string;
  readonly confirmedAt: string;
  readonly confirmationEvidence: string;
}

export type ContextSourceRepositoryErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'STALE_VERSION'
  | 'CORRUPT_DATA';

export class ContextSourceRepositoryError extends Error {
  constructor(readonly code: ContextSourceRepositoryErrorCode, message: string) {
    super(message);
    this.name = 'ContextSourceRepositoryError';
  }
}

interface StoredSourceRow {
  readonly project_id: string;
  readonly sr_id: string;
  readonly source_id: string;
  readonly current_version: number;
  readonly revision: number;
  readonly source_created_by: string;
  readonly source_created_at: string;
  readonly display_name: string | null;
  readonly kind: 'text' | 'markdown' | 'link';
  readonly provenance: string;
  readonly confirmation: 'unconfirmed' | 'confirmed';
  readonly version_created_by: string;
  readonly version_created_at: string;
  readonly content: string | null;
  readonly target_url: string | null;
  readonly confirmed_by: string | null;
  readonly confirmed_at: string | null;
  readonly confirmation_evidence: string | null;
  readonly previous_version: number | null;
  readonly payload_json: string;
}

function fail(code: ContextSourceRepositoryErrorCode, message: string): never {
  throw new ContextSourceRepositoryError(code, message);
}

function requireText(value: string, label: string): void {
  if (value.trim().length === 0) fail('VALIDATION_ERROR', `${label}이 비었습니다.`);
}

function ref(
  projectId: string,
  srId: string,
  sourceId: string,
  version: number,
): ContextSourceVersionRef {
  return { kind: 'context_source', projectId, srId, entityId: sourceId, version };
}

function parseLinkPayload(raw: string): {
  readonly verifiable: boolean;
  readonly observedExternalVersion?: string;
  readonly unavailableReason?: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return fail('CORRUPT_DATA', '저장된 link payload JSON이 올바르지 않습니다.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('CORRUPT_DATA', '저장된 link payload가 객체가 아닙니다.');
  }
  if (!('verifiable' in parsed) || typeof parsed.verifiable !== 'boolean') {
    return fail('CORRUPT_DATA', '저장된 link 확인 가능 여부가 없습니다.');
  }
  const observedExternalVersion = 'observedExternalVersion' in parsed
    ? parsed.observedExternalVersion
    : undefined;
  const unavailableReason = 'unavailableReason' in parsed
    ? parsed.unavailableReason
    : undefined;
  if (
    (observedExternalVersion !== undefined && typeof observedExternalVersion !== 'string') ||
    (unavailableReason !== undefined && typeof unavailableReason !== 'string')
  ) return fail('CORRUPT_DATA', '저장된 link 관찰 정보가 올바르지 않습니다.');
  return {
    verifiable: parsed.verifiable,
    ...(typeof observedExternalVersion === 'string' ? { observedExternalVersion } : {}),
    ...(typeof unavailableReason === 'string' ? { unavailableReason } : {}),
  };
}

function mapRow(row: StoredSourceRow): StoredContextSource {
  const base: StoredSourceBase = {
    scope: { kind: 'sr', projectId: row.project_id, srId: row.sr_id },
    sourceId: row.source_id,
    currentVersionRef: ref(
      row.project_id, row.sr_id, row.source_id, row.current_version,
    ),
    revision: row.revision,
    createdBy: row.source_created_by,
    createdAt: row.source_created_at,
    ...(row.display_name === null ? {} : { displayName: row.display_name }),
    provenance: row.provenance,
    versionCreatedBy: row.version_created_by,
    versionCreatedAt: row.version_created_at,
    ...(row.previous_version === null
      ? {}
      : {
          previousVersionRef: ref(
            row.project_id, row.sr_id, row.source_id, row.previous_version,
          ),
        }),
  };
  const confirmation: StoredSourceConfirmation = row.confirmation === 'unconfirmed'
    ? row.confirmed_by !== null || row.confirmed_at !== null || row.confirmation_evidence !== null
      ? fail('CORRUPT_DATA', '미확인 자료에 사람 확인 정보가 있습니다.')
      : { confirmation: 'unconfirmed' }
    : row.confirmed_by === null || row.confirmed_at === null || row.confirmation_evidence === null
      ? fail('CORRUPT_DATA', '확인된 자료의 사람 확인 정보가 불완전합니다.')
      : {
          confirmation: 'confirmed',
          confirmedBy: row.confirmed_by,
          confirmedAt: row.confirmed_at,
          confirmationEvidence: row.confirmation_evidence,
        };
  if (row.kind === 'link') {
    if (row.target_url === null || row.content !== null) {
      return fail('CORRUPT_DATA', '저장된 link 자료의 대상 열이 올바르지 않습니다.');
    }
    if (!isAllowedSourceLinkUrl(row.target_url)) {
      return fail('CORRUPT_DATA', '저장된 link URL이 허용 정책을 위반합니다.');
    }
    return {
      ...base,
      kind: 'link',
      targetUrl: row.target_url,
      ...parseLinkPayload(row.payload_json),
      ...confirmation,
    };
  }
  if (row.content === null || row.target_url !== null) {
    return fail('CORRUPT_DATA', '저장된 본문 자료의 내용 열이 올바르지 않습니다.');
  }
  return { ...base, kind: row.kind, content: row.content, ...confirmation };
}

export function toContextSourceView(
  source: StoredContextSource,
  reviewImpact: ReviewImpact,
): ContextSourceView {
  return { ...source, reviewImpact };
}

export function readContextSource(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
  sourceId: string,
): StoredContextSource | undefined {
  const row = db.prepare(
    `SELECT s.project_id,s.sr_id,s.source_id,s.current_version,s.revision,
            s.created_by AS source_created_by,s.created_at AS source_created_at,s.display_name,
            v.kind,v.provenance,v.confirmation,v.created_by AS version_created_by,
            v.created_at AS version_created_at,v.content,v.target_url,v.confirmed_by,
            v.confirmed_at,v.confirmation_evidence,v.previous_version,v.payload_json
       FROM context_sources s JOIN context_source_versions v
         ON v.project_id=s.project_id AND v.sr_id=s.sr_id
        AND v.source_id=s.source_id AND v.version=s.current_version
      WHERE s.project_id=? AND s.sr_id=? AND s.source_id=?`,
  ).get(projectId, srId, sourceId) as StoredSourceRow | undefined;
  return row === undefined ? undefined : mapRow(row);
}

export function readContextSources(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
): readonly StoredContextSource[] {
  const ids = db.prepare(
    'SELECT source_id FROM context_sources WHERE project_id=? AND sr_id=? ORDER BY source_id',
  ).all(projectId, srId) as Array<{ readonly source_id: string }>;
  return ids.map(({ source_id }) => {
    const source = readContextSource(db, projectId, srId, source_id);
    if (source === undefined) return fail('CORRUPT_DATA', '현재 자료 version을 찾을 수 없습니다.');
    return source;
  });
}

export function insertUnconfirmedContextSource(
  db: DatabaseConnection,
  input: NewStoredContextSource,
): StoredContextSource {
  requireText(input.sourceId, 'sourceId');
  requireText(input.createdBy, 'createdBy');
  requireText(input.input.provenance, 'provenance');
  if (input.input.kind === 'link') {
    requireText(input.input.targetUrl, 'targetUrl');
    if (!isAllowedSourceLinkUrl(input.input.targetUrl)) {
      return fail('VALIDATION_ERROR', 'link targetUrl은 자격 정보가 없는 절대 HTTP(S) URL이어야 합니다.');
    }
  } else requireText(input.input.content, 'content');
  const parent = db.prepare(
    'SELECT 1 FROM srs WHERE project_id=? AND sr_id=?',
  ).get(input.projectId, input.srId);
  if (parent === undefined) return fail('NOT_FOUND', '자료를 붙일 SR을 찾을 수 없습니다.');
  const linkPayload = input.input.kind === 'link'
    ? {
        verifiable: input.input.verifiable,
        ...(input.input.observedExternalVersion === undefined
          ? {}
          : { observedExternalVersion: input.input.observedExternalVersion }),
        ...(input.input.unavailableReason === undefined
          ? {}
          : { unavailableReason: input.input.unavailableReason }),
      }
    : {};
  db.prepare(
    `INSERT INTO context_sources(
       project_id,sr_id,source_id,current_version,revision,created_by,created_at,display_name
     ) VALUES (?,?,?,1,1,?,?,?)`,
  ).run(
    input.projectId,
    input.srId,
    input.sourceId,
    input.createdBy,
    input.createdAt,
    input.input.displayName ?? null,
  );
  db.prepare(
    `INSERT INTO context_source_versions(
       project_id,sr_id,source_id,version,kind,provenance,confirmation,
       created_by,created_at,content,target_url,confirmed_by,confirmed_at,
       confirmation_evidence,previous_version,payload_json
     ) VALUES (?,?,?,1,?,?,'unconfirmed',?,?,?, ?,NULL,NULL,NULL,NULL,?)`,
  ).run(
    input.projectId,
    input.srId,
    input.sourceId,
    input.input.kind,
    input.input.provenance,
    input.createdBy,
    input.createdAt,
    input.input.kind === 'link' ? null : input.input.content,
    input.input.kind === 'link' ? input.input.targetUrl : null,
    JSON.stringify(linkPayload),
  );
  const stored = readContextSource(db, input.projectId, input.srId, input.sourceId);
  if (stored === undefined) return fail('NOT_FOUND', '저장한 자료를 읽을 수 없습니다.');
  return stored;
}

export function confirmContextSource(
  db: DatabaseConnection,
  input: StoredSourceConfirmationInput,
): StoredContextSource {
  requireText(input.confirmedBy, 'confirmedBy');
  requireText(input.confirmationEvidence, 'confirmationEvidence');
  const requestedRef = input.sourceVersionRef;
  if (
    requestedRef.kind !== 'context_source' ||
    requestedRef.projectId !== input.projectId ||
    requestedRef.srId !== input.srId
  ) return fail('VALIDATION_ERROR', '확인할 자료 version의 범위가 요청과 다릅니다.');
  const current = readContextSource(
    db, input.projectId, input.srId, requestedRef.entityId,
  );
  if (current === undefined) return fail('NOT_FOUND', '확인할 자료를 찾을 수 없습니다.');
  if (
    current.revision !== input.expectedRevision ||
    current.currentVersionRef.version !== requestedRef.version
  ) return fail('STALE_VERSION', '자료의 현재 revision 또는 version이 바뀌었습니다.');
  if (current.confirmation === 'confirmed') {
    return fail('VALIDATION_ERROR', '이미 확인된 현재 자료입니다.');
  }
  const nextVersion = requestedRef.version + 1;
  const currentPayload = db.prepare(
    `SELECT payload_json FROM context_source_versions
      WHERE project_id=? AND sr_id=? AND source_id=? AND version=?`,
  ).get(
    input.projectId, input.srId, requestedRef.entityId, requestedRef.version,
  ) as { payload_json: string } | undefined;
  if (currentPayload === undefined) return fail('CORRUPT_DATA', '현재 자료 version을 찾을 수 없습니다.');
  db.prepare(
    `INSERT INTO context_source_versions(
       project_id,sr_id,source_id,version,kind,provenance,confirmation,
       created_by,created_at,content,target_url,confirmed_by,confirmed_at,
       confirmation_evidence,previous_version,payload_json
     ) VALUES (?,?,?,?,?,?,'confirmed',?,?,?,?,?,?,?,?,?)`,
  ).run(
    input.projectId,
    input.srId,
    requestedRef.entityId,
    nextVersion,
    current.kind,
    current.provenance,
    input.confirmedBy,
    input.confirmedAt,
    current.kind === 'link' ? null : current.content,
    current.kind === 'link' ? current.targetUrl : null,
    input.confirmedBy,
    input.confirmedAt,
    input.confirmationEvidence,
    requestedRef.version,
    currentPayload.payload_json,
  );
  const updated = db.prepare(
    `UPDATE context_sources SET current_version=?,revision=revision+1
      WHERE project_id=? AND sr_id=? AND source_id=? AND current_version=? AND revision=?`,
  ).run(
    nextVersion,
    input.projectId,
    input.srId,
    requestedRef.entityId,
    requestedRef.version,
    input.expectedRevision,
  );
  if (updated.changes !== 1) return fail('STALE_VERSION', '자료의 현재 revision 또는 version이 바뀌었습니다.');
  const stored = readContextSource(db, input.projectId, input.srId, requestedRef.entityId);
  if (stored === undefined) return fail('NOT_FOUND', '확인한 자료를 읽을 수 없습니다.');
  return stored;
}
