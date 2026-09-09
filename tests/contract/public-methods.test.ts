import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  ALL_METHOD_IDS,
  INTERNAL_METHOD_IDS,
  METHOD_DEFINITIONS,
  PUBLIC_METHOD_IDS,
  type PublicMethodRequest,
} from '@/src/contracts/methods';
import {
  ARTIFACT_MARKDOWN_MAX_CHARACTERS,
  METHOD_REQUEST_MAX_BYTES,
  METHOD_REQUEST_EXAMPLES,
  METHOD_REQUEST_SCHEMAS,
  type JsonSchemaValue,
} from '@/src/contracts/schemas';
import type { CommandReceipt } from '@/src/contracts/results';
import type {
  ContextSourceView,
  DraftApplicationStatus,
  FollowupQuestion,
  GenerationRunView,
  ImplementationView,
  InputSnapshot,
  SRDetailView,
  SRView,
} from '@/src/contracts/views';

const projectScope = { kind: 'project', projectId: 'project-1' } as const;
const srScope = { kind: 'sr', projectId: 'project-1', srId: 'sr-1' } as const;
const g1Bundle = {
  projectId: 'project-1',
  srId: 'sr-1',
  gate: 'G1',
  bundleId: 'bundle-1',
  version: 1,
} as const;
const g2Bundle = { ...g1Bundle, gate: 'G2', bundleId: 'bundle-2' } as const;

const commandMeta = (guard?: object) => ({
  requestId: 'request-1',
  idempotencyKey: 'idempotency-1',
  ...(guard === undefined ? {} : { guard }),
});

const request = (scope: object, input: JsonSchemaValue, meta?: object) => ({
  scope,
  input,
  ...(meta === undefined ? {} : { meta }),
});

let validator: FastifyInstance;

beforeAll(async () => {
  validator = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  for (const methodId of PUBLIC_METHOD_IDS) {
    validator.post(
      `/validate/${methodId}`,
      { schema: { body: METHOD_REQUEST_SCHEMAS[methodId] } },
      async () => ({ valid: true }),
    );
  }
  await validator.ready();
});

afterAll(async () => {
  await validator.close();
});

const validate = (methodId: (typeof PUBLIC_METHOD_IDS)[number], payload: object) =>
  validator.inject({ method: 'POST', url: `/validate/${methodId}`, payload });

describe('공개 메서드 경계', () => {
  test('내부 실행 계약 여섯 개를 공개하지 않는다', () => {
    expect(PUBLIC_METHOD_IDS).toHaveLength(44);
    for (const method of ['M-036', 'M-037', 'M-038', 'M-039', 'M-049', 'M-050']) {
      expect(PUBLIC_METHOD_IDS).not.toContain(method);
    }
  });

  test('내부 실행 계약 여섯 개를 정확히 분리한다', () => {
    expect(INTERNAL_METHOD_IDS).toEqual([
      'M-036',
      'M-037',
      'M-038',
      'M-039',
      'M-049',
      'M-050',
    ]);
  });

  test('승인된 메서드 50개를 중복 없이 등록한다', () => {
    expect(ALL_METHOD_IDS).toHaveLength(50);
    expect(new Set(ALL_METHOD_IDS)).toHaveLength(50);
  });
});

describe('승인된 서비스 계약 등록표', () => {
  test('50개 ID를 승인된 서비스·메서드·종류·범위에 연결한다', () => {
    const actual = ALL_METHOD_IDS.map((id) => {
      const method = METHOD_DEFINITIONS[id];
      return `${id}:${method.service}:${method.name}:${method.mode}:${method.scope}:${method.visibility}`;
    });

    expect(actual).toEqual([
      'M-001:S-01:describeWorkspace:query:project:public',
      'M-002:S-01:selectDemoActor:query:project:public',
      'M-003:S-02:registerSr:command:project:public',
      'M-004:S-02:importMockTicket:command:project:public',
      'M-005:S-02:updateSrDescription:command:sr:public',
      'M-006:S-02:attachSource:command:sr:public',
      'M-007:S-02:confirmSource:command:sr:public',
      'M-008:S-03:answerQuestion:command:sr:public',
      'M-009:S-03:resolveQuestion:command:sr:public',
      'M-010:S-03:addFollowupQuestion:command:sr:public',
      'M-011:S-03:convertQuestionToDecision:command:sr:public',
      'M-012:S-03:confirmDecision:command:sr:public',
      'M-013:S-03:redecide:command:sr:public',
      'M-014:S-03:classifyScope:command:sr:public',
      'M-015:S-04:saveArtifact:command:sr:public',
      'M-016:S-04:compareArtifacts:query:sr:public',
      'M-017:S-04:saveWorkflowPlan:command:sr:public',
      'M-018:S-04:applyDraft:command:sr:public',
      'M-019:S-04:createReviewedDraft:command:sr:public',
      'M-020:S-05:requestReview:command:sr:public',
      'M-021:S-05:recordApproval:command:sr:public',
      'M-022:S-05:addComment:command:sr:public',
      'M-023:S-05:requestChange:command:sr:public',
      'M-024:S-05:submitChangeResult:command:sr:public',
      'M-025:S-05:confirmChangeResolution:command:sr:public',
      'M-026:S-05:requestFurtherChange:command:sr:public',
      'M-027:S-05:assessGate:query:sr:public',
      'M-028:S-05:transitionStage:command:sr:public',
      'M-029:S-06:createPolicyVersion:command:project:public',
      'M-030:S-06:assignReviewers:command:sr:public',
      'M-031:S-06:applyPolicyToSr:command:sr:public',
      'M-032:S-07:requestGeneration:command:sr:public',
      'M-033:S-07:getGeneration:query:sr:public',
      'M-034:S-07:cancelGeneration:command:sr:public',
      'M-035:S-07:retryGeneration:command:sr:public',
      'M-036:S-07:claimRun:internal:runtime:internal',
      'M-037:S-07:completeRun:internal:runtime:internal',
      'M-038:S-07:failRun:internal:runtime:internal',
      'M-039:S-07:reconcileInterruptedRuns:internal:runtime:internal',
      'M-040:S-08:createHandoff:command:sr:public',
      'M-041:S-08:previewHandoff:query:sr:public',
      'M-042:S-08:exportCurrentHandoff:command:sr:public',
      'M-043:S-08:recordImplementationStart:command:sr:public',
      'M-044:S-08:recordImplementationCompletion:command:sr:public',
      'M-045:S-09:getBoard:query:project:public',
      'M-046:S-09:getInbox:query:project:public',
      'M-047:S-09:getSrDetail:query:sr:public',
      'M-048:S-09:getActivity:query:target:public',
      'M-049:S-07:readRunControl:internal:runtime:internal',
      'M-050:S-07:recordExecutionTermination:internal:runtime:internal',
    ]);
  });
});

describe('실제 Fastify JSON schema 검증', () => {
  test('44개 공개 schema만 등록하고 내부 계약은 등록하지 않는다', () => {
    expect(Object.keys(METHOD_REQUEST_SCHEMAS)).toEqual(PUBLIC_METHOD_IDS);
    for (const method of INTERNAL_METHOD_IDS) {
      expect(method in METHOD_REQUEST_SCHEMAS).toBe(false);
    }
  });

  test('44개 메서드별 정상 입력 예제를 실제 validator가 승인한다', async () => {
    expect(Object.keys(METHOD_REQUEST_EXAMPLES)).toEqual(PUBLIC_METHOD_IDS);
    for (const methodId of PUBLIC_METHOD_IDS) {
      expect((await validate(methodId, METHOD_REQUEST_EXAMPLES[methodId])).statusCode).toBe(200);
    }
  });

  test('요청과 Markdown 상한을 문자 수와 byte 수로 구분한다', () => {
    expect(METHOD_REQUEST_MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(ARTIFACT_MARKDOWN_MAX_CHARACTERS).toBe(1024 * 1024);
  });

  test('M-003은 project scope와 서버 생성 필드를 제외한 등록 입력만 받는다', async () => {
    const input = {
      key: 'SR-1',
      title: '제목',
      purpose: '목적',
      description: '설명',
      ownerId: 'user-1',
    };
    expect((await validate('M-003', request(projectScope, input, commandMeta()))).statusCode).toBe(200);
    expect((await validate('M-003', request(srScope, input, commandMeta()))).statusCode).toBe(400);
    expect(
      (await validate('M-003', request(projectScope, { ...input, srId: 'client-id' }, commandMeta())))
        .statusCode,
    ).toBe(400);
  });

  test('M-006 link는 자격 정보가 없는 절대 HTTP(S) URL만 받는다', async () => {
    const example = METHOD_REQUEST_EXAMPLES['M-006'];
    const validLink = {
      kind: 'link',
      targetUrl: 'https://example.invalid/reference?q=1#section',
      provenance: '사용자 입력',
      verifiable: false,
    };
    expect((await validate('M-006', { ...example, input: validLink })).statusCode).toBe(200);
    expect((await validate('M-006', {
      ...example,
      input: { ...validLink, targetUrl: 'HTTPS://example.invalid/reference' },
    })).statusCode).toBe(200);
    for (const targetUrl of [
      'not a URL',
      '/relative',
      'javascript:alert(1)',
      'data:text/plain,secret',
      'file:///tmp/secret',
      'https://user:password@example.invalid/reference',
    ]) {
      expect(
        (await validate('M-006', { ...example, input: { ...validLink, targetUrl } })).statusCode,
      ).toBe(400);
    }
  });

  test('M-021은 BundleRef와 reviewEpoch만 guard로 받고 SR revision을 거절한다', async () => {
    const input = {
      bundleRef: g1Bundle,
      reviewEpoch: 2,
      checklistResults: [{ itemId: 'check-1', checked: true }],
      approvalScope: 'G1',
    };
    const guard = { expectedBundleRef: g1Bundle, expectedReviewEpoch: 2 };
    expect((await validate('M-021', request(srScope, input, commandMeta(guard)))).statusCode).toBe(200);
    expect((await validate('M-021', request(srScope, input, commandMeta()))).statusCode).toBe(400);
    expect(
      (
        await validate(
          'M-021',
          request(srScope, input, commandMeta({ ...guard, expectedRevision: 7 })),
        )
      ).statusCode,
    ).toBe(400);
  });

  test('M-020의 G2 검토 요청은 정확한 G1 상위 묶음을 요구한다', async () => {
    const example = METHOD_REQUEST_EXAMPLES['M-020'];
    const input = {
      ...(example.input as object),
      gate: 'G2',
      g1BundleRef: g2Bundle,
    };
    expect((await validate('M-020', { ...example, input })).statusCode).toBe(400);
  });

  test('명령별 revision guard는 다른 엔티티 kind를 거절한다', async () => {
    const wrong = (kind: string) => ({
      resource: {
        target: { kind, projectId: 'project-1', srId: 'sr-1', entityId: 'wrong-1' },
        expectedRevision: 1,
      },
    });
    const cases = [
      ['M-008', METHOD_REQUEST_EXAMPLES['M-008'], wrong('artifact')],
      ['M-023', METHOD_REQUEST_EXAMPLES['M-023'], {
        ...wrong('question'),
        expectedBundleRef: g1Bundle,
        expectedReviewEpoch: 1,
      }],
      ['M-028', METHOD_REQUEST_EXAMPLES['M-028'], wrong('artifact')],
    ] as const;
    for (const [methodId, example, guard] of cases) {
      expect(
        (await validate(methodId, { ...example, meta: commandMeta(guard) })).statusCode,
      ).toBe(400);
    }
  });

  test('SR 하위 EntityRef는 srId가 없으면 거절한다', async () => {
    const example = METHOD_REQUEST_EXAMPLES['M-014'];
    const input = {
      ...(example.input as object),
      targetRef: { kind: 'question', projectId: 'project-1', entityId: 'question-1' },
    };
    expect((await validate('M-014', { ...example, input })).statusCode).toBe(400);
  });

  test('M-032는 fingerprint를 meta.guard 한 곳에서만 받고 작업별 target 조건을 구분한다', async () => {
    const guard = { expectedInputFingerprint: 'sha256:input' };
    const questionInput = { taskKind: 'QUESTION_PROPOSALS', supplement: '누락 확인' };
    expect(
      (await validate('M-032', request(srScope, questionInput, commandMeta(guard)))).statusCode,
    ).toBe(200);
    expect((await validate('M-032', request(srScope, questionInput, commandMeta()))).statusCode).toBe(400);
    expect(
      (
        await validate(
          'M-032',
          request(
            srScope,
            { ...questionInput, expectedInputFingerprint: 'duplicate' },
            commandMeta(guard),
          ),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await validate(
          'M-032',
          request(srScope, questionInput, commandMeta({ ...guard, expectedRevision: 1 })),
        )
      ).statusCode,
    ).toBe(400);
  });

  test('M-018은 제안 적용과 문서 적용의 target guard를 구분한다', async () => {
    const questionApplication = {
      draftId: 'draft-1',
      selectedContent: { kind: 'questions', temporaryIds: ['tmp-1'] },
    };
    const questionGuard = { kind: 'questions', expectedInputFingerprint: 'sha256:input' };
    expect(
      (
        await validate(
          'M-018',
          request(srScope, questionApplication, commandMeta(questionGuard)),
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await validate(
          'M-018',
          request(
            srScope,
            questionApplication,
            commandMeta({
              kind: 'artifact',
              expectedInputFingerprint: 'sha256:input',
              target: {
                target: {
                  kind: 'artifact_logical_key',
                  projectId: 'project-1',
                  srId: 'sr-1',
                  logicalKey: 'requirements',
                },
                expected: 'absent',
              },
            }),
          ),
        )
      ).statusCode,
    ).toBe(400);

    const decisionApplication = {
      draftId: 'draft-decisions-1',
      selectedContent: {
        kind: 'decisions',
        selections: [{
          temporaryId: 'tmp-decision-1',
          decisionMakerId: 'user-1',
          classification: { scope: 'current', requiredGate: 'G1', reason: '요구사항 기준' },
        }],
      },
    };
    expect((await validate(
      'M-018',
      request(
        srScope,
        decisionApplication,
        commandMeta({ kind: 'decisions', expectedInputFingerprint: 'sha256:input' }),
      ),
    )).statusCode).toBe(200);
    expect((await validate(
      'M-018',
      request(
        srScope,
        {
          draftId: 'draft-decisions-1',
          selectedContent: { kind: 'decisions', temporaryIds: ['tmp-decision-1'] },
        },
        commandMeta({ kind: 'decisions', expectedInputFingerprint: 'sha256:input' }),
      ),
    )).statusCode).toBe(400);

    const markdown = '## FR-1 요구사항\nFR-1을 처리합니다.\n';
    const artifactApplication = {
      draftId: 'draft-artifact-1',
      selectedContent: {
        kind: 'artifact',
        edit: {
          kind: 'requirements',
          markdown,
          sectionIndex: [{
            sectionId: 'FR-1', title: '요구사항', startOffset: 0, endOffset: markdown.length,
          }],
          requirementLinks: [{
            requirementId: 'FR-1', sectionIds: ['FR-1'], acceptanceCriteria: ['처리합니다.'],
          }],
          changeSummary: '초안 적용',
          targetBasis: { kind: 'absent', logicalKey: 'requirements' },
        },
      },
    };
    const artifactGuard = {
      kind: 'artifact',
      expectedInputFingerprint: 'sha256:input',
      target: {
        target: {
          kind: 'artifact_logical_key', projectId: 'project-1', srId: 'sr-1',
          logicalKey: 'requirements',
        },
        expected: 'absent',
      },
    };
    expect((await validate(
      'M-018', request(srScope, artifactApplication, commandMeta(artifactGuard)),
    )).statusCode).toBe(200);
    expect((await validate(
      'M-018',
      request(srScope, {
        draftId: 'draft-artifact-1',
        selectedContent: { kind: 'artifact', markdown },
        targetBasis: { kind: 'absent', logicalKey: 'requirements' },
      }, commandMeta(artifactGuard)),
    )).statusCode).toBe(400);
    expect((await validate(
      'M-018',
      request(srScope, {
        draftId: 'draft-workflow-1',
        selectedContent: {
          kind: 'artifact',
          edit: { ...artifactApplication.selectedContent.edit, kind: 'workflow_plan' },
        },
      }, commandMeta({
        ...artifactGuard,
        target: {
          target: {
            kind: 'artifact_logical_key', projectId: 'project-1', srId: 'sr-1',
            logicalKey: 'workflow_plan',
          },
          expected: 'absent',
        },
      })),
    )).statusCode).toBe(400);
  });

  test('M-019의 질문 제안은 이유·담당자·필요 gate·출처·답변 후보를 빠뜨릴 수 없다', async () => {
    const payload = request(
      srScope,
      {
        sourceDraftId: 'draft-1',
        currentInputFingerprint: 'sha256:input',
        body: {
          schemaVersion: 1,
          kind: 'question_proposals',
          proposals: [{ temporaryId: 'tmp-1' }],
        },
        comparisonSummary: '비교',
      },
      commandMeta({ expectedInputFingerprint: 'sha256:input' }),
    );
    expect((await validate('M-019', payload)).statusCode).toBe(400);
  });

  test('M-047은 빈 상세 조회와 판별된 새 생성·retry·draft 준비만 받는다', async () => {
    expect((await validate('M-047', request(srScope, {}))).statusCode).toBe(200);
    expect((await validate('M-047', request(srScope, {
      kind: 'new_generation',
      input: {
        taskKind: 'ARTIFACT_DRAFT', documentKind: 'requirements',
        targetBasis: { kind: 'absent', logicalKey: 'requirements' }, supplement: '',
      },
    }))).statusCode).toBe(200);
    expect((await validate('M-047', request(srScope, {
      kind: 'retry', runId: 'run-1', draftId: 'draft-1',
    }))).statusCode).toBe(400);
    expect((await validate('M-047', request(srScope, {
      kind: 'draft', draftId: 'draft-1', extra: true,
    }))).statusCode).toBe(400);
  });

  test('M-029 정책 개정은 이전 버전과 변경 이유를 함께 요구한다', async () => {
    const policy = {
      previousPolicyRef: {
        kind: 'review_policy',
        projectId: 'project-1',
        entityId: 'policy-1',
        version: 1,
      },
      gates: {
        G1: { requiredRoles: ['reviewer'], checklist: [{ itemId: 'g1', label: '확인' }] },
        G2: { requiredRoles: ['reviewer'], checklist: [{ itemId: 'g2', label: '확인' }] },
      },
      requireAllAssigned: true,
      requireDistinctPeer: true,
    };
    expect(
      (await validate('M-029', request(projectScope, policy, commandMeta()))).statusCode,
    ).toBe(400);
  });

  test('M-031은 선택 gate별 review_gate_state revision resources를 받습니다', async () => {
    const input = { policyRef: { kind: 'review_policy', projectId: 'project-1', entityId: 'policy-1', version: 1 }, gates: ['G1', 'G2'] };
    const expectation = (kind: string, entityId: string) => ({
      target: { kind, projectId: 'project-1', srId: 'sr-1', entityId }, expectedRevision: 1,
    });
    const resources = [
      expectation('review_gate_state', 'G1'),
      expectation('review_gate_state', 'G2'),
    ];
    expect((await validate('M-031', request(srScope, input, commandMeta({ resources })))).statusCode)
      .toBe(200);
    expect((await validate('M-031', request(srScope, input, commandMeta(
      { resource: expectation('review_gate_state', 'G1') },
    )))).statusCode).toBe(400);
    expect((await validate('M-031', request(srScope, input, commandMeta({
      resources: [expectation('artifact', 'G1')],
    })))).statusCode).toBe(400);
  });

  test('M-034는 client revision guard 없이 취소 요청을 받으며 임의 guard를 거절한다', async () => {
    expect(
      (await validate('M-034', request(srScope, 'run-1', commandMeta()))).statusCode,
    ).toBe(200);
    expect(
      (
        await validate(
          'M-034',
          request(srScope, 'run-1', commandMeta({ expectedRevision: 1 })),
        )
      ).statusCode,
    ).toBe(400);
  });

  test('M-040과 M-042는 정확한 G2 BundleRef와 epoch를 요구한다', async () => {
    const guard = { expectedBundleRef: g2Bundle, expectedReviewEpoch: 3 };
    expect(
      (await validate('M-040', request(srScope, { g2BundleRef: g2Bundle }, commandMeta(guard))))
        .statusCode,
    ).toBe(200);
    expect(
      (await validate('M-042', request(srScope, 'handoff-1', commandMeta(guard)))).statusCode,
    ).toBe(200);
    expect(
      (await validate('M-042', request(srScope, 'handoff-1', commandMeta()))).statusCode,
    ).toBe(400);
    expect(
      (
        await validate(
          'M-040',
          request(srScope, { g2BundleRef: g1Bundle }, commandMeta({
            expectedBundleRef: g1Bundle,
            expectedReviewEpoch: 3,
          })),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await validate(
          'M-042',
          request(srScope, 'handoff-1', commandMeta({
            expectedBundleRef: g1Bundle,
            expectedReviewEpoch: 3,
          })),
        )
      ).statusCode,
    ).toBe(400);
  });

  test('모든 공개 schema가 미지원 최상위 필드를 거절한다', async () => {
    for (const methodId of ['M-001', 'M-003', 'M-021', 'M-032', 'M-034'] as const) {
      const payloads = {
        'M-001': request(projectScope, {}),
        'M-003': request(
          projectScope,
          { key: 'SR-1', title: '제목', purpose: '목적', description: '설명', ownerId: 'user-1' },
          commandMeta(),
        ),
        'M-021': request(
          srScope,
          {
            bundleRef: g1Bundle,
            reviewEpoch: 2,
            checklistResults: [{ itemId: 'check-1', checked: true }],
            approvalScope: 'G1',
          },
          commandMeta({ expectedBundleRef: g1Bundle, expectedReviewEpoch: 2 }),
        ),
        'M-032': request(
          srScope,
          { taskKind: 'QUESTION_PROPOSALS' },
          commandMeta({ expectedInputFingerprint: 'sha256:input' }),
        ),
        'M-034': request(srScope, 'run-1', commandMeta()),
      } as const;
      expect((await validate(methodId, { ...payloads[methodId], unsupported: true })).statusCode).toBe(
        400,
      );
    }
  });
});

const compileTimeContractCases = () => {
  const receiptWithFixedVersionResults: CommandReceipt = {
    scope: srScope,
    receiptId: 'receipt-1',
    actorRef: { actorId: 'user-1', projectId: 'project-1' },
    commandKind: 'saveArtifact',
    requestId: 'request-receipt-1',
    idempotencyKey: 'idempotency-receipt-1',
    inputFingerprint: 'sha256:receipt-input',
    committedRevision: 3,
    resultRefs: [
      {
        kind: 'artifact',
        projectId: 'project-1',
        srId: 'sr-1',
        entityId: 'artifact-1',
        version: 2,
      },
      g2Bundle,
    ],
    committedAt: '2026-09-09T00:00:00Z',
  };
  const validQuestionDraftRequest: PublicMethodRequest<'M-018'> = {
    scope: srScope,
    input: {
      draftId: 'draft-questions-1',
      selectedContent: { kind: 'questions', temporaryIds: ['tmp-question-1'] },
    },
    meta: {
      requestId: 'request-questions-1',
      idempotencyKey: 'idempotency-questions-1',
      guard: { kind: 'questions', expectedInputFingerprint: 'sha256:questions' },
    },
  };

  const validDecisionDraftRequest: PublicMethodRequest<'M-018'> = {
    scope: srScope,
    input: {
      draftId: 'draft-decisions-1',
      selectedContent: {
        kind: 'decisions',
        selections: [{
          temporaryId: 'tmp-decision-1',
          decisionMakerId: 'user-1',
          classification: { scope: 'current', requiredGate: 'G1', reason: '필수' },
        }],
      },
    },
    meta: {
      requestId: 'request-decisions-1',
      idempotencyKey: 'idempotency-decisions-1',
      guard: { kind: 'decisions', expectedInputFingerprint: 'sha256:decisions' },
    },
  };

  // @ts-expect-error M-018 input and guard kinds must match.
  const mismatchedDraftRequest: PublicMethodRequest<'M-018'> = {
    scope: srScope,
    input: {
      draftId: 'draft-mismatched-1',
      selectedContent: { kind: 'questions', temporaryIds: ['tmp-question-1'] },
    },
    meta: {
      requestId: 'request-mismatched-1',
      idempotencyKey: 'idempotency-mismatched-1',
      guard: { kind: 'decisions', expectedInputFingerprint: 'sha256:mismatched' },
    },
  };

  // @ts-expect-error choice questions require options.
  const choiceWithoutOptions: FollowupQuestion = {
    parentQuestionId: 'question-1',
    text: '질문',
    reason: '이유',
    assigneeId: 'user-1',
    answerMode: 'choice',
    classification: { scope: 'current', requiredGate: 'G1', reason: '필수' },
  };

  // @ts-expect-error artifact snapshots require documentKind and targetBasis.
  const artifactSnapshotWithoutTarget: InputSnapshot = {
    scope: srScope,
    snapshotId: 'snapshot-1',
    workflowVersion: 'v1.0.1',
    taskKind: 'ARTIFACT_DRAFT',
    contentFingerprint: 'sha256:input',
    contents: [],
    projectRules: [],
    capturedAt: '2026-09-09T00:00:00Z',
  };

  // @ts-expect-error applied state requires applicationId.
  const appliedWithoutId: DraftApplicationStatus = {
    kind: 'applied',
    result: {
      kind: 'questions',
      mappings: [{
        temporaryId: 'tmp-1',
        ref: { kind: 'question', projectId: 'project-1', srId: 'sr-1', entityId: 'q-1' },
      }],
    },
  };

  // @ts-expect-error succeeded runs require a draft and finishedAt.
  const succeededWithoutDraft: GenerationRunView = {
    scope: srScope,
    runId: 'run-1',
    taskKind: 'QUESTION_PROPOSALS',
    inputSnapshotId: 'snapshot-1',
    status: 'succeeded',
    revision: 1,
    requestedBy: 'user-1',
    requestedAt: '2026-09-09T00:00:00Z',
    requestedSelection: { providerId: 'claude', modelChoice: { kind: 'installed_default' } },
    freshness: 'current',
    termination: 'confirmed',
    application: { kind: 'not_applied' },
  };

  // @ts-expect-error failed runs require error and finishedAt.
  const failedWithoutError: GenerationRunView = {
    scope: srScope,
    runId: 'run-1',
    taskKind: 'QUESTION_PROPOSALS',
    inputSnapshotId: 'snapshot-1',
    status: 'failed',
    revision: 1,
    requestedBy: 'user-1',
    requestedAt: '2026-09-09T00:00:00Z',
    requestedSelection: { providerId: 'claude', modelChoice: { kind: 'installed_default' } },
    freshness: 'current',
    termination: 'confirmed',
    application: { kind: 'not_applied' },
  };

  // @ts-expect-error completed implementation requires completion facts and non-empty evidence.
  const completedWithoutFacts: ImplementationView = {
    implementationId: 'implementation-1',
    handoffRef: {
      kind: 'handoff',
      projectId: 'project-1',
      srId: 'sr-1',
      entityId: 'handoff-1',
      version: 1,
    },
    status: 'completed',
    startedBy: 'user-1',
    startedAt: '2026-09-09T00:00:00Z',
    evidence: [{ kind: 'verification', label: '테스트', value: '통과' }],
    activeForCurrentSr: true,
    revision: 1,
  };

  const validChoiceQuestion: FollowupQuestion = {
    parentQuestionId: 'question-1',
    text: '질문',
    reason: '이유',
    assigneeId: 'user-1',
    answerMode: 'choice',
    options: [{ optionId: 'a', text: 'A' }],
    classification: { scope: 'current', requiredGate: 'G1', reason: '필수' },
  };
  const validArtifactSnapshot: InputSnapshot = {
    scope: srScope,
    snapshotId: 'snapshot-1',
    workflowVersion: 'v1.0.1',
    taskKind: 'ARTIFACT_DRAFT',
    documentKind: 'requirements',
    targetBasis: { kind: 'absent', logicalKey: 'requirements' },
    contentFingerprint: 'sha256:input',
    contents: [],
    projectRules: [],
    capturedAt: '2026-09-09T00:00:00Z',
  };
  const validAppliedStatus: DraftApplicationStatus = {
    kind: 'applied',
    applicationId: 'application-1',
    result: {
      kind: 'questions',
      mappings: [{
        temporaryId: 'tmp-question-1',
        ref: {
          kind: 'question', projectId: 'project-1', srId: 'sr-1', entityId: 'question-1',
        },
      }],
    },
  };
  const validSucceededRun: GenerationRunView = {
    scope: srScope,
    runId: 'run-1',
    taskKind: 'QUESTION_PROPOSALS',
    inputSnapshotId: 'snapshot-1',
    status: 'succeeded',
    revision: 1,
    requestedBy: 'user-1',
    requestedAt: '2026-09-09T00:00:00Z',
    requestedSelection: { providerId: 'claude', modelChoice: { kind: 'installed_default' } },
    freshness: 'current',
    termination: 'confirmed',
    application: { kind: 'not_applied' },
    finishedAt: '2026-09-09T00:01:00Z',
    draft: {
      draftId: 'draft-1',
      schemaVersion: 1,
      taskKind: 'QUESTION_PROPOSALS',
      body: {
        schemaVersion: 1,
        kind: 'question_proposals',
        proposals: [
          {
            temporaryId: 'tmp-1',
            text: '질문',
            reason: '이유',
            suggestedAssigneeId: 'user-1',
            requiredGate: 'G1',
            sourceRefs: [],
            candidateAnswers: [],
          },
        ],
      },
      basisInputSnapshotRef: 'snapshot-1',
      basisFingerprint: 'sha256:input',
      provenance: { kind: 'provider', sourceRunId: 'run-1' },
      freshness: 'current',
      application: { kind: 'not_applied' },
    },
  };
  const validCompletedImplementation: ImplementationView = {
    implementationId: 'implementation-1',
    handoffRef: {
      kind: 'handoff',
      projectId: 'project-1',
      srId: 'sr-1',
      entityId: 'handoff-1',
      version: 1,
    },
    status: 'completed',
    startedBy: 'user-1',
    startedAt: '2026-09-09T00:00:00Z',
    completedBy: 'user-1',
    completedAt: '2026-09-09T01:00:00Z',
    completionSummary: '완료',
    evidence: [{ kind: 'verification', label: '테스트', value: '통과' }],
    activeForCurrentSr: true,
    revision: 2,
  };
  const validSrView: SRView = {
    scope: srScope,
    key: 'SR-1',
    title: '정확한 현재 제목',
    ownerId: 'user-1',
    originalDescriptionRef: {
      kind: 'sr_description', projectId: 'project-1', srId: 'sr-1',
      entityId: 'description-1', version: 1,
    },
    currentDescriptionRef: {
      kind: 'sr_description', projectId: 'project-1', srId: 'sr-1',
      entityId: 'description-1', version: 2,
    },
    progressStage: 'requirements',
    revision: 2,
    gates: [],
  };
  const validContextSource: ContextSourceView = {
    scope: srScope,
    sourceId: 'source-1',
    currentVersionRef: {
      kind: 'context_source', projectId: 'project-1', srId: 'sr-1',
      entityId: 'source-1', version: 2,
    },
    previousVersionRef: {
      kind: 'context_source', projectId: 'project-1', srId: 'sr-1',
      entityId: 'source-1', version: 1,
    },
    kind: 'link',
    targetUrl: 'https://example.invalid/reference',
    verifiable: false,
    unavailableReason: '오프라인 자료입니다.',
    provenance: '사용자 입력',
    displayName: '정책 원문',
    confirmation: 'confirmed',
    createdBy: 'user-1',
    createdAt: '2026-09-09T00:00:00Z',
    versionCreatedBy: 'user-1',
    versionCreatedAt: '2026-09-09T01:00:00Z',
    confirmedBy: 'user-1',
    confirmedAt: '2026-09-09T01:00:00Z',
    confirmationEvidence: '원문을 직접 확인했습니다.',
    revision: 2,
    reviewImpact: {
      affectedGates: ['G1', 'G2'], needsNewReview: true,
      returnStage: 'requirements', carriedBlockingRequestIds: [],
      currentHandoffValid: false,
    },
  };
  const validSrDetail: SRDetailView = {
    sr: validSrView,
    originalDescription: {
      versionRef: validSrView.originalDescriptionRef,
      title: '최초 제목', purpose: '최초 목적', description: '최초 설명',
      authorId: 'user-1', createdAt: '2026-09-09T00:00:00Z',
    },
    currentDescription: {
      versionRef: validSrView.currentDescriptionRef,
      title: '정확한 현재 제목', purpose: '현재 목적', description: '현재 설명',
      authorId: 'user-1', createdAt: '2026-09-09T01:00:00Z', changeReason: '명확화',
    },
    mockTicket: { key: 'SR-1', url: 'mock://jira/SR-1', status: '검토 중', mock: true },
    sources: [validContextSource], artifacts: [], questions: [], decisions: [], bundles: [],
    reviewRequests: [], approvals: [], gateAssessments: [], reviewConfigurations: [], reviewPreparations: [],
    comments: [], changeRequests: [],
    generationRuns: [], generationDrafts: [], implementations: [], revision: 2,
  };

  return {
    receiptWithFixedVersionResults,
    validQuestionDraftRequest,
    validDecisionDraftRequest,
    mismatchedDraftRequest,
    choiceWithoutOptions,
    artifactSnapshotWithoutTarget,
    appliedWithoutId,
    succeededWithoutDraft,
    failedWithoutError,
    completedWithoutFacts,
    validChoiceQuestion,
    validArtifactSnapshot,
    validAppliedStatus,
    validSucceededRun,
    validCompletedImplementation,
    validSrView,
    validSrDetail,
  };
};

void compileTimeContractCases;
