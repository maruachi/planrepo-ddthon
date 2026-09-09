import { describe, expect, it } from 'vitest';
import type { SnapshotContentItem, SRDetailView } from '@/src/contracts/views';
import { compareInputContents } from '@/src/web/state/draft-input-comparison';

const projectId = 'project-a';
const srId = 'sr-a';
const versionRef = (kind: 'question_result' | 'decision' | 'scope_classification', entityId: string, version = 1) => ({
  kind, projectId, srId, entityId, version,
});

function detail(overrides: Partial<Pick<SRDetailView, 'questions' | 'decisions' | 'artifacts' | 'sources'>> = {}): SRDetailView {
  return {
    sr: { scope: { kind: 'sr', projectId, srId }, ownerId: 'owner-a' },
    currentDescription: {
      versionRef: { kind: 'sr_description', projectId, srId, entityId: srId, version: 1 },
      title: 'SR', purpose: '목적', description: '설명',
    },
    sources: [], artifacts: [], questions: [], decisions: [],
    ...overrides,
  } as unknown as SRDetailView;
}

function snapshot(ref: SnapshotContentItem['ref'], content: unknown): SnapshotContentItem {
  return { ref, content: JSON.stringify(content), confirmation: 'not_applicable' };
}

const classification = {
  ref: versionRef('scope_classification', 'classification-a'),
  targetRef: { kind: 'question', projectId, srId, entityId: 'question-a' },
  scope: 'current', requiredGate: 'G1', reason: '현재 범위',
  classifiedBy: 'owner-a', classifiedAt: '2026-09-09T00:00:00.000Z', basisRefs: [],
} as const;

describe('DraftReview 고정 입력 비교', () => {
  it('표시 이름이 없는 같은 출처를 대칭으로 비교합니다', () => {
    const ref = { kind: 'context_source' as const, projectId, srId, entityId: 'source-a', version: 1 };
    const before: SnapshotContentItem = {
      ref,
      content: JSON.stringify({
        ref, displayName: null, provenance: '사용자 입력', kind: 'text', content: '같은 본문', confirmation: 'unconfirmed',
      }),
      confirmation: 'unconfirmed',
    };
    const current = detail() as SRDetailView & { sources: SRDetailView['sources'] };
    const withSource = {
      ...current,
      sources: [{
        scope: { kind: 'sr', projectId, srId }, sourceId: 'source-a', currentVersionRef: ref,
        kind: 'text', content: '같은 본문', provenance: '사용자 입력', confirmation: 'unconfirmed',
      }],
    } as unknown as SRDetailView;

    expect(compareInputContents([before], withSource, []).find(({ key }) => key === 'context_source:source-a'))
      .toMatchObject({ state: '비교 범위 동일' });
  });

  it('같은 질문 답변과 근거는 비교 범위 안에서 동일합니다', () => {
    const ref = versionRef('question_result', 'question-a');
    const before = snapshot(ref, {
      resultRef: ref, questionId: 'question-a', text: '질문', reason: '이유', assigneeId: 'owner-a',
      answerMode: 'free_text', options: [], status: 'answered', classificationRef: classification.ref,
      evidenceRefs: [], candidateAnswers: [],
      selectedAnswer: {
        ref: { kind: 'question_answer', projectId, srId, entityId: 'answer-a', version: 1 },
        answerText: '같은 답변', selectedOptionId: null, evidence: { text: '같은 근거' }, answeredBy: 'owner-a',
      },
      resolution: null, convertedDecisionId: null,
    });
    const current = detail({ questions: [{
      questionId: 'question-a', text: '질문', reason: '이유', assigneeId: 'owner-a', answerMode: 'free_text',
      options: [], status: 'answered', classificationRef: classification.ref, currentClassification: classification,
      candidateAnswers: [], relatedArtifactRefs: [], sourceRefs: [], createdAt: '2026-09-09T00:00:00.000Z',
      currentResult: {
        ref, capturedAt: '2026-09-09T00:00:00.000Z', evidenceRefs: [],
        selectedAnswer: {
          ref: { kind: 'question_answer', projectId, srId, entityId: 'answer-a', version: 1 },
          answeredQuestionSnapshotRef: ref, answer: { kind: 'free_text', text: '같은 답변' },
          evidence: { text: '같은 근거' }, answeredBy: 'owner-a', answeredAt: '2026-09-09T00:00:00.000Z',
        },
      },
    }] as unknown as SRDetailView['questions'] });

    expect(compareInputContents([before], current, []).find(({ key }) => key === 'question_result:question-a'))
      .toMatchObject({ state: '비교 범위 동일' });
  });

  it('질문 해결 근거와 문서 반영 변경을 판별합니다', () => {
    const ref = versionRef('question_result', 'question-a', 2);
    const answerRef = { kind: 'question_answer' as const, projectId, srId, entityId: 'answer-a', version: 1 };
    const common = {
      resultRef: ref, questionId: 'question-a', text: '질문', reason: '이유', assigneeId: 'owner-a',
      answerMode: 'free_text', options: [], status: 'resolved', classificationRef: classification.ref,
      evidenceRefs: [], candidateAnswers: [],
      selectedAnswer: { ref: answerRef, answerText: '답변', selectedOptionId: null, evidence: { text: '답변 근거' }, answeredBy: 'owner-a' },
      convertedDecisionId: null,
    };
    const before = snapshot(ref, {
      ...common,
      resolution: {
        selectedAnswerRef: answerRef, evidence: { text: '이전 해결 근거' },
        documentDisposition: { kind: 'not_required', reason: '문서 불필요' },
        resolvedBy: 'owner-a', resolvedAt: '2026-09-09T01:00:00.000Z',
      },
    });
    const current = detail({ questions: [{
      questionId: 'question-a', text: '질문', reason: '이유', assigneeId: 'owner-a', answerMode: 'free_text',
      options: [], status: 'resolved', classificationRef: classification.ref, currentClassification: classification,
      candidateAnswers: [], relatedArtifactRefs: [], sourceRefs: [], createdAt: '2026-09-09T00:00:00.000Z',
      currentResult: {
        ref, capturedAt: '2026-09-09T00:00:00.000Z', evidenceRefs: [],
        selectedAnswer: {
          ref: answerRef, answeredQuestionSnapshotRef: ref, answer: { kind: 'free_text', text: '답변' },
          evidence: { text: '답변 근거' }, answeredBy: 'owner-a', answeredAt: '2026-09-09T00:30:00.000Z',
        },
        resolution: {
          selectedAnswerRef: answerRef, evidence: { text: '새 해결 근거' },
          documentDisposition: { kind: 'reflected', artifactVersionRefs: [
            { kind: 'artifact', projectId, srId, entityId: 'requirements-a', version: 1 },
          ] },
          resolvedBy: 'owner-a', resolvedAt: '2026-09-09T01:00:00.000Z',
        },
      },
    }] as unknown as SRDetailView['questions'] });

    const [result] = compareInputContents([before], current, []);
    expect(result).toMatchObject({ state: '변경' });
    expect(result?.before?.content).toContain('이전 해결 근거');
    expect(result?.current?.content).toContain('새 해결 근거');
  });

  it('결정 대안 변경을 판별하고 현재 DTO에 없는 고정 필드는 미확인으로 남깁니다', () => {
    const ref = versionRef('decision', 'decision-a');
    const classificationRef = versionRef('scope_classification', 'decision-classification');
    const definition = {
      decisionId: 'decision-a', prompt: '선택', alternatives: [{ optionId: 'a', label: '이전 대안', description: '이전 설명' }],
      impact: '영향', decisionMakerId: 'owner-a', classificationRef,
      originQuestionId: null, originQuestionResultSnapshotRef: null,
    };
    const currentVersion = {
      ref, prompt: '선택', alternatives: definition.alternatives, impact: '영향', selectedOption: 'a',
      rationale: '근거', evidence: { text: '결정 근거' }, decisionMakerId: 'owner-a', classificationRef,
      originQuestionId: null, originQuestionResultSnapshotRef: null, affectedRequirementIds: [], artifactVersionRefs: [],
      previousVersionRef: null, changeReason: null,
    };
    const before = snapshot(ref, { definition, currentVersion });
    const decisionClassification = {
      ...classification, ref: classificationRef,
      targetRef: { kind: 'decision' as const, projectId, srId, entityId: 'decision-a' },
    };
    const currentBase = {
      decisionId: 'decision-a', state: 'confirmed', prompt: '선택', impact: '영향', decisionMakerId: 'owner-a',
      requiredGate: 'G1', classificationRef, currentClassification: decisionClassification,
      sourceRefs: [], createdBy: 'owner-a', createdAt: '2026-09-09T00:00:00.000Z',
      currentConfirmation: {
        ref, selection: { optionId: 'a', text: '이전 대안' }, rationale: '근거', evidence: { text: '결정 근거' },
        decidedBy: 'owner-a', decidedAt: '2026-09-09T00:00:00.000Z', classificationRef,
      },
    };

    const changed = detail({ decisions: [{
      ...currentBase, alternatives: [{ optionId: 'a', label: '새 대안', description: '새 설명' }],
    }] as unknown as SRDetailView['decisions'] });
    expect(compareInputContents([before], changed, []).find(({ key }) => key === 'decision:decision-a'))
      .toMatchObject({ state: '변경' });

    const sameKnownFields = detail({ decisions: [{
      ...currentBase, alternatives: definition.alternatives,
    }] as unknown as SRDetailView['decisions'] });
    expect(compareInputContents([before], sameKnownFields, []).find(({ key }) => key === 'decision:decision-a')).toMatchObject({
      state: '현재값 미확인', note: expect.stringContaining('영향 요구사항'),
    });
  });

  it('followup 분류의 owner, revisit와 basis 변경을 판별합니다', () => {
    const ref = versionRef('scope_classification', 'classification-a');
    const target = { kind: 'question' as const, projectId, srId, entityId: 'question-a' };
    const before = snapshot(ref, {
      ref, target, scope: 'followup', requiredGate: 'None', reason: '후속 처리', ownerId: 'owner-a',
      revisitAt: null, revisitEvent: '배포 뒤', basisRefs: [],
    });
    const current = detail({ questions: [{
      questionId: 'question-a', text: '질문', reason: '이유', assigneeId: 'owner-a', answerMode: 'free_text',
      options: [], status: 'open', classificationRef: ref, candidateAnswers: [], relatedArtifactRefs: [], sourceRefs: [],
      createdAt: '2026-09-09T00:00:00.000Z',
      currentResult: {
        ref: versionRef('question_result', 'question-a'), capturedAt: '2026-09-09T00:00:00.000Z', evidenceRefs: [],
      },
      currentClassification: {
        ref, targetRef: target, scope: 'followup', requiredGate: 'None', reason: '후속 처리', ownerId: 'owner-b',
        revisit: { kind: 'event', event: '운영 확인 뒤' }, classifiedBy: 'owner-a',
        classifiedAt: '2026-09-09T00:00:00.000Z', basisRefs: [{
          kind: 'sr_description', projectId, srId, entityId: srId, version: 1,
        }],
      },
    }] as unknown as SRDetailView['questions'] });

    expect(compareInputContents([before], current, []).find(({ key }) => key === 'scope_classification:classification-a'))
      .toMatchObject({ state: '변경' });
  });

  it('외부 근거의 label, URL과 확인 요약 변경을 양쪽에 표시합니다', () => {
    const ref = versionRef('question_result', 'question-a');
    const selectedRef = { kind: 'question_answer' as const, projectId, srId, entityId: 'answer-a', version: 1 };
    const value = (evidence: unknown) => ({
      resultRef: ref, questionId: 'question-a', text: '질문', reason: '이유', assigneeId: 'owner-a',
      answerMode: 'free_text', options: [], status: 'answered', classificationRef: classification.ref,
      evidenceRefs: [], candidateAnswers: [],
      selectedAnswer: { ref: selectedRef, answerText: '답변', selectedOptionId: null, evidence, answeredBy: 'owner-a' },
      resolution: null, convertedDecisionId: null,
    });
    const beforeEvidence = { refs: [{
      kind: 'external', label: '이전 정책', url: 'https://old.example/policy', verificationSummary: '이전 확인 요약',
    }] };
    const currentEvidence = { refs: [{
      kind: 'external', label: '현재 정책', url: 'https://new.example/policy', verificationSummary: '현재 확인 요약',
    }] };
    const current = detail({ questions: [{
      questionId: 'question-a', text: '질문', reason: '이유', assigneeId: 'owner-a', answerMode: 'free_text',
      options: [], status: 'answered', classificationRef: classification.ref, currentClassification: classification,
      candidateAnswers: [], relatedArtifactRefs: [], sourceRefs: [], createdAt: '2026-09-09T00:00:00.000Z',
      currentResult: {
        ref, capturedAt: '2026-09-09T00:00:00.000Z', evidenceRefs: [],
        selectedAnswer: {
          ref: selectedRef, answeredQuestionSnapshotRef: ref, answer: { kind: 'free_text', text: '답변' },
          evidence: currentEvidence, answeredBy: 'owner-a', answeredAt: '2026-09-09T00:00:00.000Z',
        },
      },
    }] as unknown as SRDetailView['questions'] });

    const result = compareInputContents([snapshot(ref, value(beforeEvidence))], current, [])
      .find(({ key }) => key === 'question_result:question-a');
    expect(result).toMatchObject({ state: '변경' });
    expect(result?.before?.content).toContain('이전 정책 · https://old.example/policy · 이전 확인 요약');
    expect(result?.current?.content).toContain('현재 정책 · https://new.example/policy · 현재 확인 요약');
  });

  it('문서 수용 기준과 workflow 계획 변경을 양쪽에 표시합니다', () => {
    const ref = { kind: 'artifact' as const, projectId, srId, entityId: 'workflow-a', version: 1 };
    const designRef = { kind: 'artifact' as const, projectId, srId, entityId: 'design-a', version: 1 };
    const sectionIndex = [{ sectionId: 'REQ-1', title: '요구사항', startOffset: 0, endOffset: 20 }];
    const base = {
      ref, kind: 'workflow_plan', logicalKey: 'workflow_plan', markdown: '## REQ-1 요구사항\n본문', sectionIndex,
      decisionRefs: [], sourceRefs: [], questionResultRefs: [],
    };
    const before = snapshot(ref, {
      ...base,
      requirementLinks: [{ requirementId: 'REQ-1', sectionIds: ['REQ-1'], acceptanceCriteria: ['이전 수용 기준'] }],
      workflowPlan: {
        workflowVersion: 'v1.0.1', implementationUnitCount: 1,
        stages: [{ stageId: 'functional', choice: 'executed', designArtifactRefs: [designRef] }],
        requirementTaskLinks: [{ taskId: 'TASK-1', requirementIds: ['REQ-1'], verification: ['이전 검증'], order: 1 }],
      },
    });
    const current = detail({ artifacts: [{
      scope: { kind: 'sr', projectId, srId }, artifactId: 'workflow-a', kind: 'workflow_plan', versionRef: ref,
      markdown: base.markdown, sectionIndex,
      requirementLinks: [{ requirementId: 'REQ-1', sectionIds: ['REQ-1', 'SEC-2'], acceptanceCriteria: ['현재 수용 기준'] }],
      decisionRefs: [], sourceRefs: [], questionResultRefs: [], workflowVersion: 'v1.0.1', implementationUnitCount: 1,
      stages: [{ stageId: 'functional', choice: 'skipped', reason: '현재 생략 이유' }],
      requirementTaskLinks: [{ taskId: 'TASK-1', requirementIds: ['REQ-1'], verification: ['현재 검증'], order: 2 }],
    }] as unknown as SRDetailView['artifacts'] });

    const result = compareInputContents([before], current, []).find(({ key }) => key === 'artifact:workflow-a');
    expect(result).toMatchObject({ state: '변경' });
    expect(result?.before?.content).toContain('이전 수용 기준');
    expect(result?.before?.content).toContain('functional · 실행');
    expect(result?.before?.content).toContain('이전 검증');
    expect(result?.current?.content).toContain('현재 수용 기준');
    expect(result?.current?.content).toContain('SEC-2');
    expect(result?.current?.content).toContain('functional · 생략 · 현재 생략 이유');
    expect(result?.current?.content).toContain('현재 검증');
  });

  it('link의 검증 가능성, 관찰 버전과 이용 불가 이유를 양쪽에 표시합니다', () => {
    const ref = { kind: 'context_source' as const, projectId, srId, entityId: 'source-link', version: 1 };
    const before: SnapshotContentItem = {
      ref,
      content: JSON.stringify({
        ref, displayName: '정책 링크', provenance: '사용자 입력', kind: 'link', targetUrl: 'https://example.test/policy',
        verifiable: true, observedExternalVersion: 'v1', confirmation: 'unconfirmed',
      }),
      confirmation: 'unconfirmed',
    };
    const current = detail({ sources: [{
      scope: { kind: 'sr', projectId, srId }, sourceId: 'source-link', currentVersionRef: ref,
      displayName: '정책 링크', provenance: '사용자 입력', kind: 'link', targetUrl: 'https://example.test/policy',
      verifiable: false, unavailableReason: '현재 접근할 수 없음', confirmation: 'unconfirmed',
    }] as unknown as SRDetailView['sources'] });

    const result = compareInputContents([before], current, []).find(({ key }) => key === 'context_source:source-link');
    expect(result).toMatchObject({ state: '변경' });
    expect(result?.before?.content).toContain('검증 가능: 예');
    expect(result?.before?.content).toContain('관찰 외부 버전: v1');
    expect(result?.current?.content).toContain('검증 가능: 아니요');
    expect(result?.current?.content).toContain('이용 불가 이유: 현재 접근할 수 없음');
  });

  it('직접 입력 text가 option ID와 같아도 선택 방식 차이를 추정해 변경으로 오탐하지 않습니다', () => {
    const ref = versionRef('decision', 'decision-a');
    const classificationRef = versionRef('scope_classification', 'decision-classification');
    const alternative = { optionId: 'a', label: '대안 A', description: '대안 설명' };
    const before = snapshot(ref, {
      definition: {
        decisionId: 'decision-a', prompt: '선택', alternatives: [alternative], impact: '영향',
        decisionMakerId: 'owner-a', classificationRef, originQuestionId: null, originQuestionResultSnapshotRef: null,
      },
      currentVersion: {
        ref, prompt: '선택', alternatives: [alternative], impact: '영향', selectedOption: 'a', rationale: '근거',
        evidence: { text: '결정 근거' }, decisionMakerId: 'owner-a', classificationRef,
        originQuestionId: null, originQuestionResultSnapshotRef: null, affectedRequirementIds: [], artifactVersionRefs: [],
        previousVersionRef: null, changeReason: null,
      },
    });
    const currentClassification = {
      ...classification, ref: classificationRef,
      targetRef: { kind: 'decision' as const, projectId, srId, entityId: 'decision-a' },
    };
    const current = detail({ decisions: [{
      scope: { kind: 'sr', projectId, srId }, decisionId: 'decision-a', state: 'confirmed', prompt: '선택',
      alternatives: [alternative], impact: '영향', decisionMakerId: 'owner-a', requiredGate: 'G1',
      classificationRef, currentClassification, sourceRefs: [], createdBy: 'owner-a', createdAt: '2026-09-09T00:00:00.000Z',
      currentConfirmation: {
        ref, selection: { text: 'a' }, rationale: '근거', evidence: { text: '결정 근거' }, decidedBy: 'owner-a',
        decidedAt: '2026-09-09T00:00:00.000Z', classificationRef,
      },
    }] as unknown as SRDetailView['decisions'] });

    const result = compareInputContents([before], current, []).find(({ key }) => key === 'decision:decision-a');
    expect(result?.state).not.toBe('변경');
    expect(result?.before?.content).toContain('선택 값: a');
    expect(result?.current?.content).toContain('선택 값: a');
  });
});
