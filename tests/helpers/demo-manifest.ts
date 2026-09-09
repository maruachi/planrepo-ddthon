import { createHash } from 'node:crypto';
import type { ProgressStage } from '@/src/contracts/context';
import type { DatabaseConnection } from '@/src/persistence/database';

export interface DemoManifest {
  readonly seedId: 'DEMO-4';
  readonly version: '1';
  readonly projectId: string;
  readonly teamId: string;
  readonly defaultActorId: string;
  readonly personaIds: Readonly<Record<'P-01' | 'P-02' | 'P-03' | 'P-04' | 'P-05', string>>;
  readonly srIds: Readonly<Record<'PAY-102' | 'AUTH-331' | 'NOTI-028' | 'CAT-093', string>>;
  readonly policyId: string;
  readonly initialStates: Readonly<Record<'PAY-102' | 'AUTH-331' | 'NOTI-028' | 'CAT-093', ProgressStage>>;
  readonly entityIds: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

interface ManifestRow {
  readonly manifest_version: string;
  readonly project_id: string;
  readonly manifest_digest: string;
  readonly manifest_json: string;
}

const PERSONA_KEYS = ['P-01', 'P-02', 'P-03', 'P-04', 'P-05'] as const;
const SR_KEYS = ['PAY-102', 'AUTH-331', 'NOTI-028', 'CAT-093'] as const;
const PROGRESS_STAGES = new Set<ProgressStage>([
  'sr_received', 'requirements', 'planning', 'ready', 'implementing', 'completed',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireStringMap<K extends string>(value: unknown, keys: readonly K[], label: string): Readonly<Record<K, string>> {
  if (!isObject(value) || keys.some((key) => typeof value[key] !== 'string')) {
    throw new Error(`DEMO-4 manifest의 ${label}가 올바르지 않습니다.`);
  }
  return value as Readonly<Record<K, string>>;
}

function parseManifest(text: string): DemoManifest {
  const value: unknown = JSON.parse(text);
  if (!isObject(value)) throw new Error('DEMO-4 manifest JSON이 객체가 아닙니다.');
  if (
    value.seedId !== 'DEMO-4' || value.version !== '1' ||
    typeof value.projectId !== 'string' || typeof value.teamId !== 'string' ||
    typeof value.defaultActorId !== 'string' || typeof value.policyId !== 'string' ||
    !isObject(value.entityIds)
  ) throw new Error('DEMO-4 manifest의 필수 식별자가 올바르지 않습니다.');
  const personaIds = requireStringMap(value.personaIds, PERSONA_KEYS, 'personaIds');
  const srIds = requireStringMap(value.srIds, SR_KEYS, 'srIds');
  const initialStates = requireStringMap(value.initialStates, SR_KEYS, 'initialStates');
  if (SR_KEYS.some((key) => !PROGRESS_STAGES.has(initialStates[key] as ProgressStage))) {
    throw new Error('DEMO-4 manifest의 initialStates가 올바르지 않습니다.');
  }
  for (const key of SR_KEYS) {
    if (!isObject(value.entityIds[key])) throw new Error(`DEMO-4 manifest의 ${key} entityIds가 올바르지 않습니다.`);
    for (const id of Object.values(value.entityIds[key])) {
      if (typeof id !== 'string') throw new Error(`DEMO-4 manifest의 ${key} entity ID가 올바르지 않습니다.`);
    }
  }
  return {
    seedId: 'DEMO-4',
    version: '1',
    projectId: value.projectId,
    teamId: value.teamId,
    defaultActorId: value.defaultActorId,
    personaIds,
    srIds,
    policyId: value.policyId,
    initialStates: initialStates as Readonly<Record<(typeof SR_KEYS)[number], ProgressStage>>,
    entityIds: value.entityIds as Readonly<Record<string, Readonly<Record<string, string>>>>,
  };
}

export function readDemoManifest(db: DatabaseConnection): DemoManifest {
  const row = db.prepare(
    `SELECT manifest_version, project_id, manifest_digest, manifest_json
       FROM demo_seed_manifests WHERE seed_id='DEMO-4'`,
  ).get() as ManifestRow | undefined;
  if (row === undefined) throw new Error('DEMO-4 시드가 준비되지 않았습니다.');
  const expectedDigest = `sha256:${createHash('sha256').update(row.manifest_json).digest('hex')}`;
  if (row.manifest_digest !== expectedDigest) throw new Error('DEMO-4 manifest digest가 다릅니다.');

  const result = parseManifest(row.manifest_json);
  if (row.manifest_version !== result.version || row.project_id !== result.projectId) {
    throw new Error('DEMO-4 manifest registry와 JSON이 일치하지 않습니다.');
  }
  const project = db.prepare(
    'SELECT team_id, default_policy_id FROM workspace_projects WHERE project_id=?',
  ).get(result.projectId) as { team_id: string; default_policy_id: string | null } | undefined;
  if (project?.team_id !== result.teamId || project.default_policy_id !== result.policyId) {
    throw new Error('DEMO-4 manifest 프로젝트나 정책이 DB와 일치하지 않습니다.');
  }

  const actors = db.prepare(
    'SELECT user_id FROM demo_user_memberships WHERE project_id=? ORDER BY user_id',
  ).all(result.projectId) as Array<{ user_id: string }>;
  const expectedActors = Object.values(result.personaIds).sort();
  if (JSON.stringify(actors.map((actor) => actor.user_id)) !== JSON.stringify(expectedActors)) {
    throw new Error('DEMO-4 manifest persona가 DB와 일치하지 않습니다.');
  }
  const srs = db.prepare(
    'SELECT sr_key, sr_id, progress_stage FROM srs WHERE project_id=? ORDER BY sr_key',
  ).all(result.projectId) as Array<{ sr_key: string; sr_id: string; progress_stage: ProgressStage }>;
  const expectedSrs = SR_KEYS.map((key) => ({
    sr_key: key,
    sr_id: result.srIds[key],
    progress_stage: result.initialStates[key],
  })).sort((left, right) => left.sr_key.localeCompare(right.sr_key));
  if (JSON.stringify(srs) !== JSON.stringify(expectedSrs)) {
    throw new Error('DEMO-4 manifest SR 또는 초기 상태가 DB와 일치하지 않습니다.');
  }
  const entityLookups: Readonly<Record<(typeof SR_KEYS)[number], Readonly<Record<string, readonly [string, string, string?]>>>> = {
    'PAY-102': {
      questionId: ['questions', 'question_id'],
      decisionId: ['decisions', 'decision_id'],
      g1BundleId: ['review_bundles', 'bundle_id', 'G1'],
    },
    'AUTH-331': {
      changeRequestId: ['change_requests', 'change_request_id'],
      g1BundleId: ['review_bundles', 'bundle_id', 'G1'],
      g2BundleId: ['review_bundles', 'bundle_id', 'G2'],
    },
    'NOTI-028': {
      g1BundleId: ['review_bundles', 'bundle_id', 'G1'],
      g2BundleId: ['review_bundles', 'bundle_id', 'G2'],
      handoffId: ['handoffs', 'handoff_id'],
    },
    'CAT-093': {
      g1BundleId: ['review_bundles', 'bundle_id', 'G1'],
      g2BundleId: ['review_bundles', 'bundle_id', 'G2'],
      handoffId: ['handoffs', 'handoff_id'],
      implementationId: ['implementation_records', 'implementation_id'],
    },
  };
  for (const srKey of SR_KEYS) {
    const ids = result.entityIds[srKey];
    const lookups = entityLookups[srKey];
    if (ids === undefined || Object.keys(ids).sort().join() !== Object.keys(lookups).sort().join()) {
      throw new Error(`DEMO-4 manifest의 ${srKey} entityIds 구성이 올바르지 않습니다.`);
    }
    for (const [field, [table, column, gate]] of Object.entries(lookups)) {
      const id = ids[field];
      const found = gate === undefined
        ? db.prepare(`SELECT 1 FROM ${table} WHERE project_id=? AND sr_id=? AND ${column}=?`).get(
            result.projectId, result.srIds[srKey], id,
          )
        : db.prepare(`SELECT 1 FROM ${table} WHERE project_id=? AND sr_id=? AND gate=? AND ${column}=?`).get(
            result.projectId, result.srIds[srKey], gate, id,
          );
      if (found === undefined) throw new Error(`DEMO-4 manifest의 ${srKey}.${field}가 실제 자료와 일치하지 않습니다.`);
    }
  }
  return result;
}
