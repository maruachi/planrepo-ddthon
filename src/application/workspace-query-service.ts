import type { ProjectScope, QueryContext, SrScope } from '@/src/contracts/context';
import type { DomainError } from '@/src/contracts/results';
import type {
  BoardFilter,
  BoardView,
  GenerationPreparationRequest,
  NoInput,
  ReviewConfigurationView,
  ReviewPreparationView,
  SRDetailView,
} from '@/src/contracts/views';
import { WorkspaceServiceError } from '@/src/application/workspace-service';
import { requireProjectMember } from '@/src/domain/authorization';
import type { Persistence } from '@/src/persistence/transaction';
import {
  GenerationRunReadError,
  readGenerationDraftReview,
  type CurrentInputFingerprintPort,
} from '@/src/persistence/generation-run-query';
import {
  readBoardCards,
  readMembership,
  readProjectRevision,
  readSrDetail,
  ReviewBundleReadError,
} from '@/src/persistence/sr-repository';
import { buildAssessment } from './review-workflow-service';
import { ReviewRepositoryError } from '@/src/persistence/review-repository';
import { readAssignment, readGateState, readPolicy } from '@/src/persistence/review-policy-repository';
import {
  assessCurrentReviewAssignment,
  prepareCurrentReviewBundle,
  reviewPreparationFromPrepared,
} from '@/src/application/review-bundle-snapshot';
import { ContextSourceRepositoryError } from '@/src/persistence/context-source-repository';
import { ArtifactRepositoryError } from '@/src/persistence/artifact-repository';
import { InputSnapshotRepositoryError } from '@/src/persistence/input-snapshot-repository';
import {
  GenerationPreparationError,
  readGenerationPreparation,
} from '@/src/application/generation-preparation';
import type { ProjectRuleSnapshot } from '@/src/runtime/project-rule-source';
import { GenerationInputTooLargeError } from '@/src/application/generation-snapshot';
import type { DatabaseConnection } from '@/src/persistence/database';
import { ChangeRequestRepositoryError } from '@/src/persistence/change-request-repository';

export class WorkspaceQueryError extends WorkspaceServiceError {}

function fail(
  code: Extract<DomainError['code'], 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'STORE_UNAVAILABLE'>,
  message: string,
): never {
  throw new WorkspaceQueryError({ code, message, blockers: [], assigneeIds: [], targetRefs: [] });
}

function authorize(
  actorId: string,
  membership: ReturnType<typeof readMembership>,
): void {
  const error = requireProjectMember(actorId, membership);
  if (error !== undefined) throw new WorkspaceQueryError(error);
}

function isPreparationRequest(
  input: NoInput | GenerationPreparationRequest,
): input is GenerationPreparationRequest {
  return 'kind' in input;
}

function readReviewConfiguration(
  db: DatabaseConnection,
  detail: SRDetailView,
  gate: 'G1' | 'G2',
): { readonly configuration: ReviewConfigurationView; readonly preparation: ReviewPreparationView } {
  const state = readGateState(db, detail.sr.scope, gate);
  if (state === undefined) throw new ReviewRepositoryError(`${gate} 검토 상태를 찾을 수 없습니다.`);
  const storedPolicy = state.policyRef === undefined ? undefined : readPolicy(db, state.policyRef);
  const storedAssignment = state.assignmentRef === undefined ? undefined : readAssignment(db, state.assignmentRef);
  if (state.policyRef !== undefined && storedPolicy === undefined) throw new ReviewRepositoryError(`${gate} 정책을 찾을 수 없습니다.`);
  if (state.assignmentRef !== undefined && storedAssignment === undefined) throw new ReviewRepositoryError(`${gate} 배정을 찾을 수 없습니다.`);
  if (storedAssignment !== undefined && storedAssignment.gate !== gate) throw new ReviewRepositoryError(`${gate} 배정의 gate가 다릅니다.`);

  let assignment = storedAssignment;
  let preparation: ReviewPreparationView;
  if (storedPolicy === undefined || storedAssignment === undefined) {
    const missing = [
      ...(storedPolicy === undefined ? [`${gate} 검토 정책이 필요합니다.`] : []),
      ...(storedAssignment === undefined ? [`${gate} 검토자 배정이 필요합니다.`] : []),
    ];
    preparation = {
      kind: 'NeedsInputs', gate, gateRevision: state.revision, missing, assigneeIds: [detail.sr.ownerId],
    };
  } else {
    assignment = assessCurrentReviewAssignment(db, {
      scope: detail.sr.scope, gate, assignment: storedAssignment, policy: storedPolicy,
    });
    const prepared = prepareCurrentReviewBundle(db, {
      scope: detail.sr.scope,
      gate,
      actorId: detail.sr.ownerId,
      assignment,
      policy: storedPolicy,
      createdAt: detail.bundles.find((bundle) => bundle.bundleRef.gate === gate &&
        state.currentBundleRef?.bundleId === bundle.bundleRef.bundleId &&
        state.currentBundleRef.version === bundle.bundleRef.version)?.createdAt ?? '1970-01-01T00:00:00.000Z',
    });
    preparation = reviewPreparationFromPrepared(gate, state.revision, prepared);
  }
  return {
    configuration: {
      gate,
      reviewEpoch: state.reviewEpoch,
      revision: state.revision,
      needsNewBundle: state.needsNewBundle,
      validity: state.validity,
      ...(storedPolicy === undefined ? {} : { policy: storedPolicy }),
      ...(assignment === undefined ? {} : { assignment }),
      ...(state.currentBundleRef === undefined ? {} : { currentBundleRef: state.currentBundleRef }),
      ...(state.lastPassTransitionId === undefined ? {} : { lastPassTransitionId: state.lastPassTransitionId }),
    },
    preparation,
  };
}

export interface WorkspaceQueryService {
  getBoard(ctx: QueryContext<ProjectScope>, filter: BoardFilter): BoardView;
  getSrDetail(
    ctx: QueryContext<SrScope>,
    input?: NoInput | GenerationPreparationRequest,
  ): SRDetailView;
}

export function createWorkspaceQueryService(
  persistence: Persistence,
  options: {
    readonly currentInputFingerprints?: CurrentInputFingerprintPort;
    readonly projectRules?: ProjectRuleSnapshot;
    readonly documentReviewMode?: boolean;
  } = {},
): WorkspaceQueryService {
  return {
    getBoard(ctx, filter) {
      return persistence.readConsistent((db) => {
        authorize(
          ctx.actor.actorId,
          readMembership(db, ctx.scope.projectId, ctx.actor.actorId),
        );
        const revision = readProjectRevision(db, ctx.scope.projectId);
        if (revision === undefined) return fail('NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
        const cards = readBoardCards(db, ctx.scope.projectId, filter).map((card) => {
          const gate = card.sr.progressStage === 'sr_received' || card.sr.progressStage === 'requirements' ? 'G1' : 'G2';
          const assessment = buildAssessment(db, card.sr.scope, gate, options);
          const failed = assessment.conditions.filter((condition) => !condition.passed);
          return {
            ...card,
            reviewStatus: card.sr.gates.some((state) => state.validity === 'invalid')
              ? '재검토 필요'
              : assessment.reviewState,
            blockers: failed.map((condition) => condition.reason),
          };
        });
        return {
          projectId: ctx.scope.projectId,
          cards,
          truncated: false,
          revision,
        };
      });
    },
    getSrDetail(ctx, input = {}) {
      return persistence.readConsistent((db) => {
        authorize(
          ctx.actor.actorId,
          readMembership(db, ctx.scope.projectId, ctx.actor.actorId),
        );
        let detail: SRDetailView | undefined;
        try {
          detail = readSrDetail(
            db,
            ctx.scope.projectId,
            ctx.scope.srId,
            options.currentInputFingerprints,
          );
          if (detail !== undefined) {
            const review = (['G1', 'G2'] as const).map((gate) => readReviewConfiguration(db, detail!, gate));
            detail = {
              ...detail,
              gateAssessments: [
                buildAssessment(db, ctx.scope, 'G1', options),
                buildAssessment(db, ctx.scope, 'G2', options),
              ],
              reviewConfigurations: review.map((item) => item.configuration),
              reviewPreparations: review.map((item) => item.preparation),
            };
          }
          if (isPreparationRequest(input)) {
            if (detail === undefined) return fail('NOT_FOUND', 'SR을 찾을 수 없습니다.');
            if (options.projectRules === undefined) {
              return fail('STORE_UNAVAILABLE', '프로젝트 생성 규칙을 읽을 수 없습니다.');
            }
            if (input.kind === 'draft') {
              const draftReview = readGenerationDraftReview(
                db,
                ctx.scope.projectId,
                ctx.scope.srId,
                input.draftId,
                options.currentInputFingerprints,
              );
              if (draftReview === undefined) return fail('NOT_FOUND', '생성 초안을 찾을 수 없습니다.');
              try {
                detail = {
                  ...detail,
                  draftReview,
                  preparation: readGenerationPreparation(db, ctx.scope, input, options.projectRules),
                };
              } catch (error) {
                if (!(error instanceof GenerationInputTooLargeError)) throw error;
                detail = {
                  ...detail,
                  draftReview,
                  preparationUnavailable: {
                    reason: '현재 생성 입력이 2 MiB를 넘어 비교 기준을 계산할 수 없습니다.',
                  },
                };
              }
            } else {
              detail = {
                ...detail,
                preparation: readGenerationPreparation(db, ctx.scope, input, options.projectRules),
              };
            }
          }
        } catch (error) {
          if (
            error instanceof GenerationRunReadError ||
            error instanceof ReviewBundleReadError ||
            error instanceof ReviewRepositoryError ||
            error instanceof ChangeRequestRepositoryError ||
            (error instanceof GenerationPreparationError && error.code === 'CORRUPT_DATA') ||
            (error instanceof ContextSourceRepositoryError && error.code === 'CORRUPT_DATA') ||
            (error instanceof ArtifactRepositoryError && error.code === 'CORRUPT_DATA') ||
            (error instanceof InputSnapshotRepositoryError && error.code === 'CORRUPT_DATA')
          ) {
            return fail('STORE_UNAVAILABLE', '저장된 SR 상세 자료를 안전하게 읽을 수 없습니다.');
          }
          if (error instanceof GenerationPreparationError) {
            return fail(error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION_ERROR', error.message);
          }
          if (error instanceof GenerationInputTooLargeError) {
            return fail('VALIDATION_ERROR', error.message);
          }
          throw error;
        }
        if (detail === undefined) return fail('NOT_FOUND', 'SR을 찾을 수 없습니다.');
        return detail;
      });
    },
  };
}
