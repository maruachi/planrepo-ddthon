import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandReceipt, CurrentBasis } from '@/src/contracts/results';
import type { ArtifactView, SRView } from '@/src/contracts/views';
import { invoke, TransportUncertainError } from '@/src/web/api/client';

const sr: SRView = {
  scope: { kind: 'sr', projectId: 'project-a', srId: 'sr-a' },
  key: 'SR-1',
  title: '테스트 SR',
  ownerId: 'actor-a',
  originalDescriptionRef: {
    kind: 'sr_description', projectId: 'project-a', srId: 'sr-a', entityId: 'sr-a', version: 1,
  },
  currentDescriptionRef: {
    kind: 'sr_description', projectId: 'project-a', srId: 'sr-a', entityId: 'sr-a', version: 1,
  },
  progressStage: 'sr_received',
  revision: 1,
  gates: [],
};

const receipt: CommandReceipt = {
  scope: { kind: 'project', projectId: 'project-a' },
  receiptId: 'receipt-1',
  actorRef: { actorId: 'actor-a', projectId: 'project-a' },
  commandKind: 'M-003',
  requestId: 'request-1',
  idempotencyKey: 'key-1',
  inputFingerprint: 'sha256:input',
  committedRevision: 1,
  resultRefs: [],
  committedAt: '2026-09-09T00:00:00.000Z',
};

const current: CurrentBasis = {
  target: { kind: 'sr', projectId: 'project-a', srId: 'sr-a', entityId: 'sr-a' },
  currentRevision: 1,
  allowedActions: [],
};

const reviewImpact = {
  affectedGates: [], needsNewReview: false, carriedBlockingRequestIds: [], currentHandoffValid: true,
};

function classification(kind: 'question' | 'decision', entityId: string) {
  return {
    ref: { kind: 'scope_classification' as const, projectId: 'project-a', srId: 'sr-a', entityId: `classification-${entityId}`, version: 1 },
    targetRef: { kind, projectId: 'project-a', srId: 'sr-a', entityId },
    scope: 'current', requiredGate: 'G1', reason: '현재 범위', classifiedBy: 'actor-a',
    classifiedAt: '2026-09-09T00:00:00.000Z', basisRefs: [],
  };
}

function questionValue() {
  const currentClassification = classification('question', 'question-a');
  return {
    scope: { kind: 'sr', projectId: 'project-a', srId: 'sr-a' }, questionId: 'question-a',
    text: '질문', reason: '이유', assigneeId: 'actor-a', answerMode: 'free_text', options: [],
    requiredGate: 'G1', classificationRef: currentClassification.ref, currentClassification,
    candidateAnswers: [], relatedArtifactRefs: [], sourceRefs: [], createdAt: '2026-09-09T00:00:00.000Z',
    currentResult: {
      ref: { kind: 'question_result', projectId: 'project-a', srId: 'sr-a', entityId: 'question-a', version: 1 },
      capturedAt: '2026-09-09T00:00:00.000Z', evidenceRefs: [],
    },
    status: 'open', revision: 1, allowedActions: [], reviewImpact,
  };
}

function decisionValue() {
  const currentClassification = classification('decision', 'decision-a');
  return {
    scope: { kind: 'sr', projectId: 'project-a', srId: 'sr-a' }, decisionId: 'decision-a',
    prompt: '결정', alternatives: [{ optionId: 'a', label: 'A', description: '대안 A' }], impact: '영향',
    decisionMakerId: 'actor-a', requiredGate: 'G1', classificationRef: currentClassification.ref,
    currentClassification, sourceRefs: [], createdBy: 'actor-a', createdAt: '2026-09-09T00:00:00.000Z',
    state: 'unconfirmed', revision: 1, allowedActions: [], reviewImpact,
  };
}

function resolvedQuestionValue() {
  const value = questionValue();
  const selectedAnswer = {
    ref: {
      kind: 'question_answer' as const, projectId: 'project-a', srId: 'sr-a', entityId: 'answer-a', version: 1,
    },
    answeredQuestionSnapshotRef: {
      kind: 'question_result', projectId: 'project-a', srId: 'sr-a', entityId: 'question-a', version: 1,
    },
    answer: { kind: 'free_text', text: '답변' }, evidence: { text: '답변 근거' },
    answeredBy: 'actor-a', answeredAt: '2026-09-09T00:00:00.000Z',
  };
  return {
    ...value,
    status: 'resolved',
    revision: 3,
    currentResult: {
      ...value.currentResult,
      ref: { ...value.currentResult.ref, version: 3 },
      selectedAnswer,
      resolution: {
        selectedAnswerRef: selectedAnswer.ref,
        evidence: { text: '해결 근거' },
        documentDisposition: { kind: 'not_required', reason: '문서 변경 없음' },
        resolvedBy: 'actor-a', resolvedAt: '2026-09-09T00:00:00.000Z',
      },
    },
  };
}

function confirmedDecisionValue() {
  const value = decisionValue();
  return {
    ...value,
    state: 'confirmed',
    revision: 2,
    currentConfirmation: {
      ref: {
        kind: 'decision', projectId: 'project-a', srId: 'sr-a', entityId: 'decision-a', version: 2,
      },
      selection: { optionId: 'a', text: 'A' }, rationale: '이유', evidence: { text: '근거' },
      decidedBy: 'actor-a', decidedAt: '2026-09-09T00:00:00.000Z',
      classificationRef: value.classificationRef,
      previousVersionRef: {
        kind: 'decision', projectId: 'project-a', srId: 'sr-a', entityId: 'decision-a', version: 1,
      },
      changeReason: '변경',
    },
  };
}

function detailValue(questions: readonly unknown[], decisions: readonly unknown[]) {
  const description = {
    versionRef: sr.currentDescriptionRef, title: sr.title, purpose: '검증', description: '검증 본문',
    authorId: 'actor-a', createdAt: '2026-09-09T00:00:00.000Z',
  };
  return {
    sr, originalDescription: description, currentDescription: description,
    sources: [], artifacts: [], questions, decisions, bundles: [],
    reviewRequests: [], approvals: [], gateAssessments: ['G1', 'G2'].map((gate) => ({
      gate, assessedRevision: 1, reviewEpoch: 0, conditions: [], reviewState: '작성 중', canTransition: false,
    })),
    reviewConfigurations: ['G1', 'G2'].map((gate) => ({
      gate, reviewEpoch: 0, revision: 1, needsNewBundle: false, validity: 'not_passed',
    })),
    reviewPreparations: ['G1', 'G2'].map((gate) => ({
      kind: 'NeedsInputs', gate, gateRevision: 1, missing: ['정책'], assigneeIds: ['actor-a'],
    })),
    comments: [], changeRequests: [],
    generationRuns: [], generationDrafts: [], implementations: [], revision: 1,
  };
}

function respond(body: unknown) {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
}

async function register() {
  return invoke('M-003', { actorId: 'actor-a', projectId: 'project-a' }, {
    key: 'SR-1', title: '테스트 SR', purpose: '검증', description: '검증', ownerId: 'actor-a',
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('browser HTTP client 응답 검증', () => {
  it('공식 검토·승인·gate 조회와 전환의 malformed 성공값을 거절합니다', async () => {
    const srReceipt = (commandKind: 'M-020' | 'M-021' | 'M-028'): CommandReceipt => ({
      ...receipt, scope: { kind: 'sr', projectId: 'project-a', srId: 'sr-a' }, commandKind,
    });
    const bundleRef = { projectId: 'project-a', srId: 'sr-a', gate: 'G1' as const, bundleId: 'bundle-a', version: 1 };
    const gateGuard = { resource: { target: { kind: 'review_gate_state' as const, projectId: 'project-a', srId: 'sr-a', entityId: 'G1' }, expectedRevision: 1 } };
    const requestInput = {
      gate: 'G1' as const, artifactVersionRefs: [], decisionVersionRefs: [], unconfirmedDecisionSnapshots: [],
      questionResultRefs: [], classificationRefs: [], contextSourceVersionRefs: [], reviewerIds: ['actor-a'],
      assignmentRef: { kind: 'review_assignment' as const, projectId: 'project-a', srId: 'sr-a', entityId: 'assignment-a', version: 1 },
      policyRef: { kind: 'review_policy' as const, projectId: 'project-a', entityId: 'policy-a', version: 1 },
    };
    respond({ kind: 'Committed', value: null, receipt: srReceipt('M-020') });
    await expect(invoke('M-020', { actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a', guard: gateGuard }, requestInput))
      .rejects.toBeInstanceOf(TransportUncertainError);
    respond({ kind: 'Committed', value: null, receipt: srReceipt('M-021') });
    await expect(invoke('M-021', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
      guard: { expectedBundleRef: bundleRef, expectedReviewEpoch: 1 },
    }, { bundleRef, reviewEpoch: 1, checklistResults: [{ itemId: 'check-a', checked: true }], approvalScope: 'G1' }))
      .rejects.toBeInstanceOf(TransportUncertainError);
    respond(null);
    await expect(invoke('M-027', { actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a' }, 'G1'))
      .rejects.toThrow('M-027 응답 value가 올바르지 않습니다.');
    respond({ kind: 'Committed', value: null, receipt: srReceipt('M-028') });
    await expect(invoke('M-028', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
      guard: { resource: { target: { kind: 'sr', projectId: 'project-a', srId: 'sr-a', entityId: 'sr-a' }, expectedRevision: 1 }, expectedBundleRef: bundleRef, expectedReviewEpoch: 1 },
    }, { toStage: 'planning', reason: 'G1 통과', gate: 'G1', bundleRef }))
      .rejects.toBeInstanceOf(TransportUncertainError);
  });

  it('M-047의 검토 요청·승인·gate assessment 저장 DTO를 렌더 전에 검사합니다', async () => {
    respond({ ...detailValue([], []), reviewRequests: [null] });
    await expect(invoke('M-047', { actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a' }, {}))
      .rejects.toThrow('M-047 응답 value가 올바르지 않습니다.');
    respond({ ...detailValue([], []), approvals: [null] });
    await expect(invoke('M-047', { actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a' }, {}))
      .rejects.toThrow('M-047 응답 value가 올바르지 않습니다.');
    respond({ ...detailValue([], []), gateAssessments: [null] });
    await expect(invoke('M-047', { actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a' }, {}))
      .rejects.toThrow('M-047 응답 value가 올바르지 않습니다.');
  });

  it('정책·배정·명시 적용 command의 malformed 성공값을 불명확 결과로 처리합니다', async () => {
    const commandReceipt = (commandKind: 'M-029' | 'M-030' | 'M-031'): CommandReceipt => ({
      ...receipt,
      scope: commandKind === 'M-029'
        ? { kind: 'project', projectId: 'project-a' }
        : { kind: 'sr', projectId: 'project-a', srId: 'sr-a' },
      commandKind,
    });
    const gateGuard = { resource: {
      target: { kind: 'review_gate_state' as const, projectId: 'project-a', srId: 'sr-a', entityId: 'G1' },
      expectedRevision: 1,
    } };

    respond({ kind: 'Committed', value: null, receipt: commandReceipt('M-029') });
    await expect(invoke('M-029', { actorId: 'actor-a', projectId: 'project-a' }, {
      gates: {
        G1: { requiredRoles: ['reviewer'], checklist: [{ itemId: 'g1', label: 'G1 확인' }] },
        G2: { requiredRoles: ['reviewer'], checklist: [{ itemId: 'g2', label: 'G2 확인' }] },
      }, requireAllAssigned: true, requireDistinctPeer: true,
    })).rejects.toBeInstanceOf(TransportUncertainError);

    respond({ kind: 'Committed', value: null, receipt: commandReceipt('M-030') });
    await expect(invoke('M-030', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a', guard: gateGuard,
    }, { gate: 'G1', reviewerIds: [] })).rejects.toBeInstanceOf(TransportUncertainError);

    respond({ kind: 'Committed', value: null, receipt: commandReceipt('M-031') });
    await expect(invoke('M-031', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
      guard: { resources: [gateGuard.resource] },
    }, {
      policyRef: { kind: 'review_policy', projectId: 'project-a', entityId: 'policy-a', version: 1 },
      gates: ['G1'],
    })).rejects.toBeInstanceOf(TransportUncertainError);
  });

  it('M-001과 M-047의 정책·배정 준비 조회를 렌더 전에 좁게 검사합니다', async () => {
    respond({
      project: { projectId: 'project-a', teamId: 'team-a', name: '프로젝트' },
      actors: [], connection: { kind: 'mock', available: true }, revision: 1,
      defaultPolicyRef: { kind: 'review_policy', projectId: 'project-a', entityId: 'policy-a', version: 1 },
      policies: [null],
    });
    await expect(invoke('M-001', { actorId: 'actor-a', projectId: 'project-a' }, {}))
      .rejects.toThrow('M-001 응답 value가 올바르지 않습니다.');

    respond({
      ...detailValue([], []),
      reviewConfigurations: [{ gate: 'G1', revision: 1 }],
      reviewPreparations: [{ kind: 'Ready', gate: 'G1', gateRevision: 1, input: null, checklistSnapshot: [] }],
    });
    await expect(invoke('M-047', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
    }, {})).rejects.toThrow('M-047 응답 value가 올바르지 않습니다.');
  });

  it('M-047의 comment와 change request 저장 DTO를 렌더 전에 좁게 검사합니다', async () => {
    respond({ ...detailValue([], []), comments: [null] });
    await expect(invoke('M-047', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
    }, {})).rejects.toThrow('M-047 응답 value가 올바르지 않습니다.');

    respond({ ...detailValue([], []), changeRequests: [{ changeRequestId: 'change-a' }] });
    await expect(invoke('M-047', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
    }, {})).rejects.toThrow('M-047 응답 value가 올바르지 않습니다.');
  });

  it('현재 UI command의 null value와 빈 receipt를 불명확 결과로 처리합니다', async () => {
    respond({ kind: 'Committed', value: null, receipt: {} });

    await expect(register()).rejects.toBeInstanceOf(TransportUncertainError);
  });

  it('현재 UI command의 필수 receipt 필드를 검사합니다', async () => {
    respond({ kind: 'Committed', value: sr, receipt: {} });

    await expect(register()).rejects.toBeInstanceOf(TransportUncertainError);
  });

  it('SOURCE command의 필수 source value를 검사합니다', async () => {
    respond({ kind: 'Committed', value: null, receipt });

    await expect(invoke('M-006', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
      guard: { resource: {
        target: { kind: 'sr', projectId: 'project-a', srId: 'sr-a', entityId: 'sr-a' },
        expectedRevision: 1,
      } },
    }, { kind: 'text', content: '본문', provenance: '사용자 입력' }))
      .rejects.toBeInstanceOf(TransportUncertainError);

    await expect(invoke('M-007', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
      guard: { resource: {
        target: { kind: 'context_source', projectId: 'project-a', srId: 'sr-a', entityId: 'source-a' },
        expectedRevision: 1,
      } },
    }, {
      sourceVersionRef: {
        kind: 'context_source', projectId: 'project-a', srId: 'sr-a', entityId: 'source-a', version: 1,
      },
      confirmationEvidence: '사람 확인',
    })).rejects.toBeInstanceOf(TransportUncertainError);
  });

  it('Replayed의 현재 기준을 빈 객체로 신뢰하지 않습니다', async () => {
    respond({ kind: 'Replayed', value: sr, receipt, current: {} });

    await expect(register()).rejects.toBeInstanceOf(TransportUncertainError);
  });

  it('현재 UI query의 필수 value를 검사합니다', async () => {
    respond(null);

    await expect(invoke('M-001', {
      actorId: 'actor-a', projectId: 'project-a',
    }, {})).rejects.toThrow('M-001 응답 value가 올바르지 않습니다.');
  });

  it('유효한 command envelope는 기존 typed 결과로 복원합니다', async () => {
    respond({ kind: 'Replayed', value: sr, receipt, current });

    await expect(register()).resolves.toMatchObject({
      ok: true, disposition: 'Replayed', value: sr, receipt, current,
    });
  });

  it('질문·후속 질문·결정 command의 null value는 같은 key로 확인할 수 있는 불명확 결과입니다', async () => {
    const commandReceipt = (commandKind: 'M-008' | 'M-010' | 'M-012'): CommandReceipt => ({
      ...receipt,
      scope: { kind: 'sr', projectId: 'project-a', srId: 'sr-a' },
      commandKind,
    });
    const meta = {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
      guard: { resource: {
        target: { kind: 'question' as const, projectId: 'project-a', srId: 'sr-a', entityId: 'question-a' },
        expectedRevision: 1,
      } },
    };

    respond({ kind: 'Committed', value: null, receipt: commandReceipt('M-008') });
    await expect(invoke('M-008', meta, {
      questionId: 'question-a',
      answeredQuestionSnapshotRef: {
        kind: 'question_result', projectId: 'project-a', srId: 'sr-a', entityId: 'question-a', version: 1,
      },
      answer: { kind: 'free_text', text: '답변' }, evidence: { text: '근거' },
    })).rejects.toBeInstanceOf(TransportUncertainError);

    respond({ kind: 'Committed', value: null, receipt: commandReceipt('M-010') });
    await expect(invoke('M-010', meta, {
      parentQuestionId: 'question-a', text: '후속 질문', reason: '확인 필요', assigneeId: 'actor-a',
      answerMode: 'free_text', classification: { scope: 'current', requiredGate: 'G1', reason: '확인 필요' },
    })).rejects.toBeInstanceOf(TransportUncertainError);

    respond({ kind: 'Committed', value: null, receipt: commandReceipt('M-012') });
    await expect(invoke('M-012', {
      ...meta,
      guard: { resource: {
        target: { kind: 'decision', projectId: 'project-a', srId: 'sr-a', entityId: 'decision-a' },
        expectedRevision: 1,
      } },
    }, {
      decisionId: 'decision-a', selection: { optionId: 'option-a', text: '대안 A' },
      rationale: '결정 이유', evidence: { text: '결정 근거' },
    })).rejects.toBeInstanceOf(TransportUncertainError);
  });

  it('해결·전환·재결정·범위 command의 null value는 같은 key로 확인할 수 있는 불명확 결과입니다', async () => {
    const commandReceipt = (commandKind: 'M-009' | 'M-011' | 'M-013' | 'M-014'): CommandReceipt => ({
      ...receipt,
      scope: { kind: 'sr', projectId: 'project-a', srId: 'sr-a' },
      commandKind,
    });
    const questionGuard = { resource: {
      target: { kind: 'question' as const, projectId: 'project-a', srId: 'sr-a', entityId: 'question-a' },
      expectedRevision: 1,
    } };
    const decisionGuard = { resource: {
      target: { kind: 'decision' as const, projectId: 'project-a', srId: 'sr-a', entityId: 'decision-a' },
      expectedRevision: 1,
    } };
    const scope = { actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a' };

    respond({ kind: 'Committed', value: null, receipt: commandReceipt('M-009') });
    await expect(invoke('M-009', { ...scope, guard: questionGuard }, {
      questionId: 'question-a',
      selectedAnswerRef: {
        kind: 'question_answer', projectId: 'project-a', srId: 'sr-a', entityId: 'question-a', version: 1,
      },
      resolutionEvidence: { text: '근거' },
      documentDisposition: { kind: 'not_required', reason: '문서 변경이 필요 없습니다.' },
    })).rejects.toBeInstanceOf(TransportUncertainError);

    respond({ kind: 'Committed', value: null, receipt: commandReceipt('M-011') });
    await expect(invoke('M-011', { ...scope, guard: questionGuard }, {
      questionId: 'question-a',
      questionResultSnapshotRef: {
        kind: 'question_result', projectId: 'project-a', srId: 'sr-a', entityId: 'question-a', version: 1,
      },
      prompt: '결정 질문', alternatives: [{ optionId: 'a', label: 'A', description: '대안 A' }],
      impact: '영향', decisionMakerId: 'actor-a',
      classificationRef: {
        kind: 'scope_classification', projectId: 'project-a', srId: 'sr-a', entityId: 'question-a', version: 1,
      },
    })).rejects.toBeInstanceOf(TransportUncertainError);

    respond({ kind: 'Committed', value: null, receipt: commandReceipt('M-013') });
    await expect(invoke('M-013', { ...scope, guard: decisionGuard }, {
      decisionId: 'decision-a', selection: { text: '새 결정' }, rationale: '이유', evidence: { text: '근거' },
      previousVersionRef: {
        kind: 'decision', projectId: 'project-a', srId: 'sr-a', entityId: 'decision-a', version: 1,
      },
      changeReason: '상황 변경',
    })).rejects.toBeInstanceOf(TransportUncertainError);

    respond({ kind: 'Committed', value: null, receipt: commandReceipt('M-014') });
    await expect(invoke('M-014', { ...scope, guard: decisionGuard }, {
      targetRef: decisionGuard.resource.target,
      scope: 'current', requiredGate: 'G2', reason: '현재 범위입니다.',
    })).rejects.toBeInstanceOf(TransportUncertainError);
  });

  it('해결·전환·재결정·범위 command의 nested 상태 불일치를 불명확 결과로 처리합니다', async () => {
    const commandReceipt = (commandKind: 'M-009' | 'M-011' | 'M-013' | 'M-014'): CommandReceipt => ({
      ...receipt, scope: { kind: 'sr', projectId: 'project-a', srId: 'sr-a' }, commandKind,
    });
    const questionGuard = { resource: { target: {
      kind: 'question' as const, projectId: 'project-a', srId: 'sr-a', entityId: 'question-a',
    }, expectedRevision: 1 } };
    const decisionGuard = { resource: { target: {
      kind: 'decision' as const, projectId: 'project-a', srId: 'sr-a', entityId: 'decision-a',
    }, expectedRevision: 1 } };
    const scope = { actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a' };

    respond({ kind: 'Committed', value: { ...questionValue(), status: 'resolved' }, receipt: commandReceipt('M-009') });
    await expect(invoke('M-009', { ...scope, guard: questionGuard }, {
      questionId: 'question-a', selectedAnswerRef: { kind: 'question_answer', projectId: 'project-a', srId: 'sr-a', entityId: 'answer-a', version: 1 },
      resolutionEvidence: { text: '근거' }, documentDisposition: { kind: 'not_required', reason: '불필요' },
    })).rejects.toBeInstanceOf(TransportUncertainError);

    respond({ kind: 'Committed', value: {
      ...decisionValue(), currentClassification: classification('question', 'question-a'),
    }, receipt: commandReceipt('M-011') });
    await expect(invoke('M-011', { ...scope, guard: questionGuard }, {
      questionId: 'question-a', questionResultSnapshotRef: { kind: 'question_result', projectId: 'project-a', srId: 'sr-a', entityId: 'question-a', version: 1 },
      prompt: '결정', alternatives: [{ optionId: 'a', label: 'A', description: '대안 A' }], impact: '영향', decisionMakerId: 'actor-a',
      classificationRef: { kind: 'scope_classification', projectId: 'project-a', srId: 'sr-a', entityId: 'classification-question-a', version: 1 },
    })).rejects.toBeInstanceOf(TransportUncertainError);

    respond({ kind: 'Committed', value: { ...decisionValue(), state: 'confirmed' }, receipt: commandReceipt('M-013') });
    await expect(invoke('M-013', { ...scope, guard: decisionGuard }, {
      decisionId: 'decision-a', selection: { optionId: 'a', text: 'A' }, rationale: '이유', evidence: { text: '근거' },
      previousVersionRef: { kind: 'decision', projectId: 'project-a', srId: 'sr-a', entityId: 'decision-a', version: 1 }, changeReason: '변경',
    })).rejects.toBeInstanceOf(TransportUncertainError);

    const currentClassification = classification('decision', 'decision-a');
    respond({ kind: 'Committed', value: {
      targetRef: currentClassification.targetRef, classificationRef: currentClassification.ref,
      classification: { ...currentClassification, scope: 'followup', requiredGate: 'None' },
      scope: 'followup', requiredGate: 'None', revision: 2, reviewImpact,
    }, receipt: commandReceipt('M-014') });
    await expect(invoke('M-014', { ...scope, guard: decisionGuard }, {
      targetRef: decisionGuard.resource.target, scope: 'current', requiredGate: 'G2', reason: '현재 범위',
    })).rejects.toBeInstanceOf(TransportUncertainError);
  });

  it('M-009/011/013/014 응답의 nested ref를 요청 scope와 논리 대상에 묶습니다', async () => {
    const commandReceipt = (commandKind: 'M-009' | 'M-011' | 'M-013' | 'M-014'): CommandReceipt => ({
      ...receipt, scope: { kind: 'sr', projectId: 'project-a', srId: 'sr-a' }, commandKind,
    });
    const questionGuard = { resource: { target: {
      kind: 'question' as const, projectId: 'project-a', srId: 'sr-a', entityId: 'question-a',
    }, expectedRevision: 1 } };
    const decisionGuard = { resource: { target: {
      kind: 'decision' as const, projectId: 'project-a', srId: 'sr-a', entityId: 'decision-a',
    }, expectedRevision: 1 } };
    const scope = { actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a' };

    const resolved = resolvedQuestionValue();
    respond({ kind: 'Committed', value: {
      ...resolved,
      currentResult: {
        ...resolved.currentResult,
        selectedAnswer: {
          ...resolved.currentResult.selectedAnswer,
          answeredQuestionSnapshotRef: {
            kind: 'question_result', projectId: 'project-a', srId: 'sr-b', entityId: 'question-a', version: 1,
          },
        },
      },
    }, receipt: commandReceipt('M-009') });
    await expect(invoke('M-009', { ...scope, guard: questionGuard }, {
      questionId: 'question-a', selectedAnswerRef: resolved.currentResult.selectedAnswer.ref,
      resolutionEvidence: { text: '해결 근거' },
      documentDisposition: { kind: 'not_required', reason: '문서 변경 없음' },
    })).rejects.toBeInstanceOf(TransportUncertainError);

    respond({ kind: 'Committed', value: {
      ...decisionValue(),
      originQuestionId: 'question-a',
      originQuestionResultSnapshotRef: {
        kind: 'question_result', projectId: 'project-a', srId: 'sr-b', entityId: 'question-a', version: 1,
      },
    }, receipt: commandReceipt('M-011') });
    await expect(invoke('M-011', { ...scope, guard: questionGuard }, {
      questionId: 'question-a',
      questionResultSnapshotRef: {
        kind: 'question_result', projectId: 'project-a', srId: 'sr-a', entityId: 'question-a', version: 1,
      },
      prompt: '결정', alternatives: [{ optionId: 'a', label: 'A', description: '대안 A' }],
      impact: '영향', decisionMakerId: 'actor-a',
      classificationRef: classification('question', 'question-a').ref,
    })).rejects.toBeInstanceOf(TransportUncertainError);

    const confirmed = confirmedDecisionValue();
    respond({ kind: 'Committed', value: {
      ...confirmed,
      currentConfirmation: {
        ...confirmed.currentConfirmation,
        previousVersionRef: {
          kind: 'decision', projectId: 'project-a', srId: 'sr-b', entityId: 'decision-a', version: 1,
        },
      },
    }, receipt: commandReceipt('M-013') });
    await expect(invoke('M-013', { ...scope, guard: decisionGuard }, {
      decisionId: 'decision-a', selection: { optionId: 'a', text: 'A' }, rationale: '이유', evidence: { text: '근거' },
      previousVersionRef: {
        kind: 'decision', projectId: 'project-a', srId: 'sr-a', entityId: 'decision-a', version: 1,
      }, changeReason: '변경',
    })).rejects.toBeInstanceOf(TransportUncertainError);

    const currentClassification = classification('decision', 'decision-a');
    respond({ kind: 'Committed', value: {
      targetRef: currentClassification.targetRef,
      classificationRef: { ...currentClassification.ref, srId: 'sr-b' },
      classification: {
        ...currentClassification,
        ref: { ...currentClassification.ref, srId: 'sr-b' },
      },
      scope: 'current', requiredGate: 'G1', revision: 2, reviewImpact,
    }, receipt: commandReceipt('M-014') });
    await expect(invoke('M-014', { ...scope, guard: decisionGuard }, {
      targetRef: decisionGuard.resource.target, scope: 'current', requiredGate: 'G1', reason: '현재 범위',
    })).rejects.toBeInstanceOf(TransportUncertainError);
  });

  it('M-047은 질문·결정 nested ref의 scope와 분류·전환 상관관계를 검사합니다', async () => {
    const crossScoped = resolvedQuestionValue();
    const selected = crossScoped.currentResult.selectedAnswer;
    respond(detailValue([{
      ...crossScoped,
      currentResult: {
        ...crossScoped.currentResult,
        selectedAnswer: {
          ...selected,
          answeredQuestionSnapshotRef: {
            kind: 'question_result', projectId: 'project-a', srId: 'sr-b', entityId: 'question-a', version: 1,
          },
        },
      },
    }], []));
    await expect(invoke('M-047', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
    }, {})).rejects.toThrow('M-047 응답 value가 올바르지 않습니다.');

    const converted = {
      ...questionValue(), status: 'converted_to_decision', convertedDecisionId: 'decision-a',
    };
    respond(detailValue([converted], [{
      ...decisionValue(),
      requiredGate: 'G2',
      originQuestionId: 'other-question',
      originQuestionResultSnapshotRef: {
        kind: 'question_result', projectId: 'project-a', srId: 'sr-a', entityId: 'other-question', version: 1,
      },
    }]));
    await expect(invoke('M-047', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
    }, {})).rejects.toThrow('M-047 응답 value가 올바르지 않습니다.');
  });

  it('M-047은 converted question의 현재 결과보다 같거나 미래인 origin result를 거절합니다', async () => {
    const question = questionValue();
    const converted = {
      ...question,
      status: 'converted_to_decision',
      convertedDecisionId: 'decision-a',
      revision: 2,
      currentResult: {
        ...question.currentResult,
        ref: { ...question.currentResult.ref, version: 2 },
      },
    };
    const decision = {
      ...decisionValue(),
      originQuestionId: 'question-a',
      originQuestionResultSnapshotRef: {
        kind: 'question_result', projectId: 'project-a', srId: 'sr-a', entityId: 'question-a', version: 3,
      },
    };
    respond(detailValue([converted], [decision]));

    await expect(invoke('M-047', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
    }, {})).rejects.toThrow('M-047 응답 value가 올바르지 않습니다.');
  });

  it('M-047의 malformed 질문·결정 항목을 render 전에 query 오류로 거절합니다', async () => {
    const description = {
      versionRef: sr.currentDescriptionRef,
      title: sr.title,
      purpose: '검증',
      description: '검증 본문',
      authorId: 'actor-a',
      createdAt: '2026-09-09T00:00:00.000Z',
    };
    respond({
      sr,
      originalDescription: description,
      currentDescription: description,
      sources: [], artifacts: [], questions: [null], decisions: [{}], bundles: [],
      generationRuns: [], implementations: [], revision: 1,
    });

    await expect(invoke('M-047', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
    }, {})).rejects.toThrow('M-047 응답 value가 올바르지 않습니다.');
  });

  it('문서 command의 malformed value를 불명확 결과로 처리합니다', async () => {
    respond({ kind: 'Committed', value: null, receipt: { ...receipt, commandKind: 'M-015' } });

    await expect(invoke('M-015', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
      guard: { resource: {
        target: { kind: 'artifact_logical_key', projectId: 'project-a', srId: 'sr-a', logicalKey: 'requirements' },
        expected: 'absent',
      } },
    }, {
      kind: 'requirements', markdown: '## REQ-1 요구사항\nREQ-1 본문',
      sectionIndex: [{ sectionId: 'REQ-1', title: '요구사항', startOffset: 0, endOffset: 28 }],
      requirementLinks: [{ requirementId: 'REQ-1', sectionIds: ['REQ-1'], acceptanceCriteria: ['검증'] }],
      changeSummary: '첫 문서', targetBasis: { kind: 'absent', logicalKey: 'requirements' },
    })).rejects.toBeInstanceOf(TransportUncertainError);
  });

  it('초안 검토·적용 command의 malformed value를 불명확 결과로 처리합니다', async () => {
    const scope = {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
      guard: { kind: 'questions' as const, expectedInputFingerprint: 'sha256:input' },
    };
    respond({ kind: 'Committed', value: null, receipt: { ...receipt, commandKind: 'M-018' } });
    await expect(invoke('M-018', scope, {
      draftId: 'draft-a', selectedContent: { kind: 'questions', temporaryIds: ['question-a'] },
    })).rejects.toBeInstanceOf(TransportUncertainError);

    respond({ kind: 'Committed', value: null, receipt: { ...receipt, commandKind: 'M-019' } });
    await expect(invoke('M-019', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
      guard: { expectedInputFingerprint: 'sha256:input' },
    }, {
      sourceDraftId: 'draft-a', currentInputFingerprint: 'sha256:input',
      body: {
        schemaVersion: 1, kind: 'question_proposals', proposals: [{
          temporaryId: 'question-a', text: '질문', reason: '이유', suggestedAssigneeId: 'actor-a',
          requiredGate: 'G1', sourceRefs: [], candidateAnswers: [],
        }],
      },
      comparisonSummary: '현재 입력과 비교했습니다.',
    })).rejects.toBeInstanceOf(TransportUncertainError);
  });

  it('M-047의 malformed 초안 목록·선택 조회를 render 전에 거절합니다', async () => {
    const description = {
      versionRef: sr.currentDescriptionRef, title: sr.title, purpose: '검증', description: '검증 본문',
      authorId: 'actor-a', createdAt: '2026-09-09T00:00:00.000Z',
    };
    const base = {
      sr, originalDescription: description, currentDescription: description,
      sources: [], artifacts: [], questions: [], decisions: [], bundles: [],
      generationRuns: [], implementations: [], revision: 1,
    };
    respond({
      ...base,
      generationDrafts: [{
        draftId: 'draft-a', taskKind: 'QUESTION_PROPOSALS', basisInputSnapshotRef: 'snapshot-a',
        basisFingerprint: 'sha256:input', provenance: { kind: 'provider' },
        freshness: 'current', application: { kind: 'not_applied' },
      }],
    });
    await expect(invoke('M-047', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
    }, {})).rejects.toThrow('M-047 응답 value가 올바르지 않습니다.');

    respond({
      ...base,
      generationDrafts: [],
      draftReview: { draft: null, inputSnapshot: {} },
      preparation: { kind: 'draft', draftId: 'draft-a' },
    });
    await expect(invoke('M-047', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
    }, { kind: 'draft', draftId: 'draft-a' })).rejects.toThrow('M-047 응답 value가 올바르지 않습니다.');
  });

  it('snapshot content ref의 version이 있으면 정확한 version ref로만 받습니다', async () => {
    const description = {
      versionRef: sr.currentDescriptionRef, title: sr.title, purpose: '검증', description: '검증 본문',
      authorId: 'actor-a', createdAt: '2026-09-09T00:00:00.000Z',
    };
    const draft = {
      draftId: 'draft-a', taskKind: 'QUESTION_PROPOSALS', basisInputSnapshotRef: 'snapshot-a',
      basisFingerprint: 'sha256:input', provenance: { kind: 'provider', sourceRunId: 'run-a' },
      freshness: 'current', application: { kind: 'not_applied' }, schemaVersion: 1,
      body: { schemaVersion: 1, kind: 'question_proposals', proposals: [{
        temporaryId: 'question-a', text: '질문', reason: '이유', suggestedAssigneeId: 'actor-a',
        requiredGate: 'G1', sourceRefs: [], candidateAnswers: [],
      }] },
    };
    const base = {
      sr, originalDescription: description, currentDescription: description,
      sources: [], artifacts: [], questions: [], decisions: [], bundles: [],
      generationRuns: [], generationDrafts: [draft], implementations: [], revision: 1,
    };
    const snapshot = (ref: unknown) => ({
      scope: sr.scope, snapshotId: 'snapshot-a', workflowVersion: 'v1.0.1',
      contentFingerprint: 'sha256:input', contents: [{ ref, content: '{}', confirmation: 'not_applicable' }],
      projectRules: [], capturedAt: '2026-09-09T00:00:00.000Z', taskKind: 'QUESTION_PROPOSALS',
    });

    respond({
      ...base,
      draftReview: { draft, inputSnapshot: snapshot({
        kind: 'artifact', projectId: 'project-a', srId: 'sr-a', entityId: 'artifact-a', version: '1',
      }) },
    });
    await expect(invoke('M-047', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
    }, { kind: 'draft', draftId: 'draft-a' })).rejects.toThrow('M-047 응답 value가 올바르지 않습니다.');

    respond({
      ...base,
      draftReview: { draft, inputSnapshot: snapshot({
        kind: 'question', projectId: 'project-a', srId: 'sr-a', entityId: 'question-a', version: 1,
      }) },
    });
    await expect(invoke('M-047', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
    }, { kind: 'draft', draftId: 'draft-a' })).rejects.toThrow('M-047 응답 value가 올바르지 않습니다.');
  });

  it('M-016과 M-047의 malformed 문서를 render 전에 query 오류로 거절합니다', async () => {
    respond({ before: null, after: {}, changedRequirementIds: [], changedDecisionRefs: [], changedSectionIds: [] });
    const ref = {
      kind: 'artifact' as const, projectId: 'project-a', srId: 'sr-a', entityId: 'artifact-a', version: 1,
    };
    await expect(invoke('M-016', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
    }, { before: ref, after: { ...ref, version: 2 } }))
      .rejects.toThrow('M-016 응답 value가 올바르지 않습니다.');

    const description = {
      versionRef: sr.currentDescriptionRef, title: sr.title, purpose: '검증', description: '검증 본문',
      authorId: 'actor-a', createdAt: '2026-09-09T00:00:00.000Z',
    };
    respond({
      sr, originalDescription: description, currentDescription: description,
      sources: [], artifacts: [null as unknown as ArtifactView], questions: [], decisions: [], bundles: [],
      generationRuns: [], implementations: [], revision: 1,
    });
    await expect(invoke('M-047', {
      actorId: 'actor-a', projectId: 'project-a', srId: 'sr-a',
    }, {})).rejects.toThrow('M-047 응답 value가 올바르지 않습니다.');
  });
});
