import { describe, expect, it } from 'vitest';
import type { SRDetailView } from '@/src/contracts/views';
import { g1PlanReadiness } from '@/src/web/state/plan-review-readiness';

function detail(overrides: Partial<SRDetailView> = {}): SRDetailView {
  return {
    sr: { ownerId: 'owner' },
    artifacts: [{ kind: 'requirements', markdown: '검토할 문서 본문' }],
    questions: [],
    decisions: [],
    changeRequests: [],
    reviewConfigurations: [{ gate: 'G1', policy: { gates: { G1: {}, G2: {} } }, assignment: { reviewerIds: ['reviewer'], ready: true } }],
    reviewPreparations: [{ kind: 'Ready', gate: 'G1' }],
    gateAssessments: [{ gate: 'G1', canTransition: false, conditions: [
      { conditionId: 'GP-01', passed: false }, { conditionId: 'GP-07', passed: false }, { conditionId: 'GP-08', passed: false },
    ] }],
    ...overrides,
  } as unknown as SRDetailView;
}

function question(id: string, status: 'open' | 'answered' | 'resolved', scope: 'current' | 'followup', requiredGate: 'G1' | 'G2' | 'None') {
  return {
    questionId: id,
    text: `질문 ${id}`,
    status,
    assigneeId: `assignee-${id}`,
    currentClassification: { scope, requiredGate },
  } as SRDetailView['questions'][number];
}

describe('g1PlanReadiness', () => {
  it('AI 질문과 결정은 검토 요청을 막지 않는다', () => {
    const issues = g1PlanReadiness(detail({ questions: [
      question('open-g1', 'open', 'current', 'G1'),
      question('answered-g1', 'answered', 'current', 'G1'),
      question('g2', 'open', 'current', 'G2'),
      question('followup', 'open', 'followup', 'None'),
      question('resolved', 'resolved', 'current', 'G1'),
    ] }));

    expect(issues).toEqual([]);
  });

  it('검토 요청 전 bundle과 승인 조건 실패를 준비 부족으로 만들지 않는다', () => {
    expect(g1PlanReadiness(detail())).toEqual([]);
  });
});
