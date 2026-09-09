import { createHash } from 'node:crypto';
import type { VersionRef } from '@/src/contracts/context';
import type { GenerationInput } from '@/src/contracts/views';
import {
  artifactLogicalTarget,
  parseArtifactLogicalKey,
  type ArtifactLogicalKey,
} from '@/src/domain/artifact-target';
import type { GenerationBasis } from '@/src/persistence/generation-input-repository';
import type { ProjectRuleSnapshot } from '@/src/runtime/project-rule-source';

export const GENERATION_INPUT_MAX_BYTES = 2 * 1024 * 1024;

export class GenerationInputBasisError extends Error {}
export class GenerationInputTooLargeError extends Error {}

export interface PreparedGenerationSnapshot {
  readonly input: GenerationInput;
  readonly targetArtifactKey?: ArtifactLogicalKey;
  readonly canonicalJson: string;
  readonly byteLength: number;
  readonly contentFingerprint: string;
  readonly basisRefs: readonly VersionRef[];
  readonly projectRuleVersions: readonly {
    readonly logicalId: string;
    readonly version: string;
  }[];
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isReferenceSetKey(key: string | undefined): boolean {
  return key === 'refs' || key === 'basisRefs' || key?.endsWith('Refs') === true;
}

function canonical(value: unknown, key?: string): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const items = value.map((item) => canonical(item));
    if (isReferenceSetKey(key)) items.sort(compareCodeUnits);
    return `[${items.join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareCodeUnits(left, right));
    return `{${entries.map(([entryKey, item]) => `${JSON.stringify(entryKey)}:${canonical(item, entryKey)}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('canonical JSON에 지원하지 않는 값이 있습니다.');
  return encoded;
}

export function canonicalJson(value: unknown): string {
  return canonical(value);
}

const SR_VERSION_KINDS = new Set([
  'sr_description',
  'context_source',
  'artifact',
  'question_answer',
  'question_result',
  'decision',
  'scope_classification',
  'review_assignment',
  'handoff',
]);

function isVersionRef(value: unknown): value is VersionRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.kind === 'review_policy') {
    return typeof item.projectId === 'string' && item.srId === undefined &&
      typeof item.entityId === 'string' && typeof item.version === 'number' &&
      Number.isInteger(item.version) && item.version > 0;
  }
  return typeof item.kind === 'string' && SR_VERSION_KINDS.has(item.kind) &&
    typeof item.projectId === 'string' && typeof item.srId === 'string' &&
    typeof item.entityId === 'string' && typeof item.version === 'number' &&
    Number.isInteger(item.version) && item.version > 0;
}

function collectRefs(value: unknown, found: Map<string, VersionRef>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, found);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  if (isVersionRef(value)) found.set(canonical(value), value);
  for (const item of Object.values(value as Record<string, unknown>)) collectRefs(item, found);
}

function validateTarget(
  input: GenerationInput,
  basis: GenerationBasis,
  allowStaleTarget: boolean,
): ArtifactLogicalKey | undefined {
  if (input.taskKind === 'ARTIFACT_REVISION') {
    const target = basis.artifacts.find((artifact) => {
      const artifactRef = artifact.ref;
      return artifactRef.projectId === input.targetBasis.ref.projectId &&
        artifactRef.srId === input.targetBasis.ref.srId &&
        artifactRef.entityId === input.targetBasis.ref.entityId;
    });
    if (
      target === undefined || target.kind !== input.documentKind ||
      (!allowStaleTarget && target.ref.version !== input.targetBasis.ref.version)
    ) {
      throw new GenerationInputBasisError('문서 개정 target이 같은 SR·종류의 현재 version이 아닙니다.');
    }
    try {
      return artifactLogicalTarget(target.kind, target.designStage).logicalKey;
    } catch (error) {
      throw new GenerationInputBasisError(error instanceof Error ? error.message : '문서 target이 올바르지 않습니다.');
    }
  }
  if (input.taskKind === 'ARTIFACT_DRAFT') {
    let target;
    try {
      target = parseArtifactLogicalKey(input.targetBasis.logicalKey);
    } catch (error) {
      throw new GenerationInputBasisError(error instanceof Error ? error.message : '새 문서 target이 올바르지 않습니다.');
    }
    if (target.kind !== input.documentKind) {
      throw new GenerationInputBasisError('새 문서의 logical key와 document kind가 다릅니다.');
    }
    if (!allowStaleTarget && basis.artifacts.some((artifact) => artifact.logicalKey === target.logicalKey)) {
      throw new GenerationInputBasisError('absent로 요청한 문서 target이 이미 있습니다.');
    }
    return target.logicalKey;
  }
  return undefined;
}

export function prepareGenerationSnapshot(
  input: GenerationInput,
  basis: GenerationBasis,
  rules: ProjectRuleSnapshot,
  options: { readonly allowStaleTarget?: boolean } = {},
): PreparedGenerationSnapshot {
  const targetArtifactKey = validateTarget(input, basis, options.allowStaleTarget === true);
  const projectRules = [...rules]
    .sort((left, right) => compareCodeUnits(left.logicalId, right.logicalId))
    .map(({ logicalId, version, content }) => ({ logicalId, version, content }));
  const envelope = {
    schemaVersion: 1,
    scope: basis.scope,
    generation: input,
    targetArtifactKey,
    workflowVersion: basis.workflowVersion,
    participants: basis.participants,
    currentDescription: basis.currentDescription,
    sources: basis.sources,
    questions: basis.questions,
    decisions: basis.decisions,
    classifications: basis.classifications,
    artifacts: basis.artifacts,
    projectRules,
  };
  const serialized = canonicalJson(envelope);
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  if (byteLength > GENERATION_INPUT_MAX_BYTES) {
    throw new GenerationInputTooLargeError(
      `생성 입력은 UTF-8 ${GENERATION_INPUT_MAX_BYTES} bytes를 넘을 수 없습니다.`,
    );
  }
  const refs = new Map<string, VersionRef>();
  collectRefs(envelope, refs);
  return {
    input,
    ...(targetArtifactKey === undefined ? {} : { targetArtifactKey }),
    canonicalJson: serialized,
    byteLength,
    contentFingerprint: `sha256:${createHash('sha256').update(serialized).digest('hex')}`,
    basisRefs: [...refs.entries()]
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([, value]) => value),
    projectRuleVersions: projectRules.map(({ logicalId, version }) => ({ logicalId, version })),
  };
}
