import type { SrScope } from '@/src/contracts/context';
import type {
  ArtifactTargetBasis,
  GenerationInput,
  GenerationPreparationRequest,
  GenerationPreparationView,
} from '@/src/contracts/views';
import {
  GenerationInputBasisError,
  GenerationInputTooLargeError,
  prepareGenerationSnapshot,
} from '@/src/application/generation-snapshot';
import type { DatabaseConnection } from '@/src/persistence/database';
import {
  GenerationBasisReadError,
  readGenerationBasis,
} from '@/src/persistence/generation-input-repository';
import {
  InputSnapshotRepositoryError,
  inputFromSnapshot,
  readInputSnapshot,
} from '@/src/persistence/input-snapshot-repository';
import type { ProjectRuleSnapshot } from '@/src/runtime/project-rule-source';

export class GenerationPreparationError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'CORRUPT_DATA' | 'VALIDATION_ERROR', message: string) {
    super(message);
    this.name = 'GenerationPreparationError';
  }
}

function notFound(message: string): never {
  throw new GenerationPreparationError('NOT_FOUND', message);
}

function currentTarget(
  input: GenerationInput,
  basis: NonNullable<ReturnType<typeof readGenerationBasis>>,
): ArtifactTargetBasis | undefined {
  if (!('targetBasis' in input)) return undefined;
  if (input.taskKind === 'ARTIFACT_REVISION') {
    const current = basis.artifacts.find((artifact) =>
      artifact.ref.entityId === input.targetBasis.ref.entityId,
    );
    return current === undefined ? input.targetBasis : { kind: 'version', ref: current.ref };
  }
  const current = basis.artifacts.find((artifact) => artifact.logicalKey === input.targetBasis.logicalKey);
  return current === undefined ? input.targetBasis : { kind: 'version', ref: current.ref };
}

export function normalizeReviewedGenerationInput(
  input: GenerationInput,
  basis: NonNullable<ReturnType<typeof readGenerationBasis>>,
): GenerationInput {
  if (!('targetBasis' in input)) return input;
  const target = currentTarget(input, basis);
  if (target === undefined) return input;
  const supplement = input.supplement === undefined ? {} : { supplement: input.supplement };
  if (target.kind === 'version') {
    return {
      taskKind: 'ARTIFACT_REVISION',
      documentKind: input.documentKind,
      targetBasis: target,
      ...supplement,
    };
  }
  return {
    taskKind: 'ARTIFACT_DRAFT',
    documentKind: input.documentKind,
    targetBasis: target,
    ...supplement,
  };
}

function calculate(
  db: DatabaseConnection,
  scope: SrScope,
  input: GenerationInput,
  rules: ProjectRuleSnapshot,
  allowStaleTarget: boolean,
) {
  const basis = readGenerationBasis(db, scope);
  if (basis === undefined) return notFound('생성 입력을 준비할 SR을 찾을 수 없습니다.');
  try {
    return {
      basis,
      prepared: prepareGenerationSnapshot(input, basis, rules, { allowStaleTarget }),
    };
  } catch (error) {
    if (error instanceof GenerationInputBasisError) {
      throw new GenerationPreparationError('VALIDATION_ERROR', error.message);
    }
    throw error;
  }
}

function readSnapshotForRun(db: DatabaseConnection, scope: SrScope, runId: string) {
  const row = db.prepare(
    `SELECT input_snapshot_id,status FROM generation_runs
      WHERE project_id=? AND sr_id=? AND run_id=?`,
  ).get(scope.projectId, scope.srId, runId) as {
    readonly input_snapshot_id: string;
    readonly status: string;
  } | undefined;
  if (row === undefined) return notFound('생성 실행을 찾을 수 없습니다.');
  if (row.status !== 'failed' && row.status !== 'cancelled') {
    throw new GenerationPreparationError('VALIDATION_ERROR', '실패하거나 취소된 생성 실행만 재시도할 수 있습니다.');
  }
  const snapshot = readInputSnapshot(db, scope, row.input_snapshot_id);
  if (snapshot === undefined) {
    throw new GenerationPreparationError('CORRUPT_DATA', '생성 실행의 input snapshot을 찾을 수 없습니다.');
  }
  return snapshot;
}

export function readGenerationPreparation(
  db: DatabaseConnection,
  scope: SrScope,
  request: GenerationPreparationRequest,
  rules: ProjectRuleSnapshot,
): GenerationPreparationView {
  try {
    if (request.kind === 'new_generation') {
      const current = calculate(db, scope, request.input, rules, false);
      return {
        kind: 'new_generation',
        input: request.input,
        expectedInputFingerprint: current.prepared.contentFingerprint,
        basisRefs: current.prepared.basisRefs,
        projectRuleVersions: current.prepared.projectRuleVersions,
      };
    }
    if (request.kind === 'retry') {
      const snapshot = readSnapshotForRun(db, scope, request.runId);
      const originalInput = inputFromSnapshot(snapshot);
      const currentBasis = readGenerationBasis(db, scope);
      if (currentBasis === undefined) return notFound('생성 입력을 준비할 SR을 찾을 수 없습니다.');
      const currentTargetBasis = currentTarget(originalInput, currentBasis);
      if (
        originalInput.taskKind === 'ARTIFACT_DRAFT' &&
        currentTargetBasis?.kind === 'version'
      ) {
        throw new GenerationPreparationError(
          'VALIDATION_ERROR',
          '원 absent 대상에 문서가 생겼습니다. 명시적인 새 생성을 요청하세요.',
        );
      }
      const input = normalizeReviewedGenerationInput(originalInput, currentBasis);
      const current = calculate(db, scope, input, rules, false);
      return {
        kind: 'retry',
        runId: request.runId,
        input,
        expectedInputFingerprint: current.prepared.contentFingerprint,
        basisRefs: current.prepared.basisRefs,
        projectRuleVersions: current.prepared.projectRuleVersions,
      };
    }
    const row = db.prepare(
      `SELECT basis_input_snapshot_id,basis_fingerprint FROM generation_drafts
        WHERE project_id=? AND sr_id=? AND draft_id=?`,
    ).get(scope.projectId, scope.srId, request.draftId) as {
      readonly basis_input_snapshot_id: string;
      readonly basis_fingerprint: string;
    } | undefined;
    if (row === undefined) return notFound('생성 초안을 찾을 수 없습니다.');
    const snapshot = readInputSnapshot(db, scope, row.basis_input_snapshot_id);
    if (snapshot === undefined) {
      throw new GenerationPreparationError('CORRUPT_DATA', '초안의 input snapshot을 찾을 수 없습니다.');
    }
    if (row.basis_fingerprint !== snapshot.contentFingerprint) {
      throw new GenerationPreparationError('CORRUPT_DATA', '초안과 input snapshot 지문이 다릅니다.');
    }
    const input = inputFromSnapshot(snapshot);
    const current = calculate(db, scope, input, rules, true);
    const originalTarget = 'targetBasis' in input ? input.targetBasis : undefined;
    const resolvedCurrentTarget = currentTarget(input, current.basis);
    return {
      kind: 'draft',
      draftId: request.draftId,
      input,
      expectedInputFingerprint: current.prepared.contentFingerprint,
      basisRefs: current.prepared.basisRefs,
      projectRuleVersions: current.prepared.projectRuleVersions,
      draftBasisFingerprint: row.basis_fingerprint,
      currentInputFingerprint: current.prepared.contentFingerprint,
      freshness: row.basis_fingerprint === current.prepared.contentFingerprint ? 'current' : 'stale',
      ...(originalTarget === undefined ? {} : { draftTargetBasis: originalTarget }),
      ...(resolvedCurrentTarget === undefined ? {} : { currentTargetBasis: resolvedCurrentTarget }),
    };
  } catch (error) {
    if (error instanceof GenerationPreparationError) throw error;
    if (error instanceof GenerationBasisReadError || error instanceof InputSnapshotRepositoryError) {
      throw new GenerationPreparationError('CORRUPT_DATA', error.message);
    }
    throw error;
  }
}

export function createCurrentInputFingerprintPort(rules: ProjectRuleSnapshot) {
  return {
    readCurrentInputFingerprint(
      db: DatabaseConnection,
      request: { readonly projectId: string; readonly srId: string; readonly inputSnapshotId: string },
    ): string | undefined {
      const scope: SrScope = {
        kind: 'sr', projectId: request.projectId, srId: request.srId,
      };
      const snapshot = readInputSnapshot(db, scope, request.inputSnapshotId);
      if (snapshot === undefined) return undefined;
      try {
        return calculate(db, scope, inputFromSnapshot(snapshot), rules, true).prepared.contentFingerprint;
      } catch (error) {
        if (error instanceof GenerationInputTooLargeError) return undefined;
        throw error;
      }
    },
  };
}
