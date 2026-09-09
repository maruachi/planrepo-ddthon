import { describe, expect, it } from 'vitest';
import {
  assessContextSourceReviewImpact,
  assessDescriptionReviewImpact,
  assessVersionReviewImpact,
} from '@/src/domain/review-impact';

describe('SR 설명 변경 ReviewImpact', () => {
  it('승인 기준이 있으면 G1과 종속 G2를 requirements에서 다시 검토합니다', () => {
    expect(assessDescriptionReviewImpact({
      progressStage: 'ready',
      gates: [
        { gate: 'G1', validity: 'valid' },
        { gate: 'G2', validity: 'valid' },
      ],
      blockingRequestIds: ['change-1'],
    })).toEqual({
      reviewImpact: {
        affectedGates: ['G1', 'G2'],
        needsNewReview: true,
        returnStage: 'requirements',
        carriedBlockingRequestIds: ['change-1'],
        currentHandoffValid: false,
      },
      progressStage: 'requirements',
    });
  });

  it('아직 접수 중이고 통과 이력이 없으면 제품 단계를 앞당기지 않습니다', () => {
    expect(assessDescriptionReviewImpact({
      progressStage: 'sr_received',
      gates: [
        { gate: 'G1', validity: 'not_passed' },
        { gate: 'G2', validity: 'not_passed' },
      ],
      blockingRequestIds: [],
    })).toMatchObject({ progressStage: 'sr_received' });
  });
});

describe('일반 version 변경 ReviewImpact', () => {
  it('G2 전용 변경은 G1을 보존하고 가장 이른 현재 단계보다 전진하지 않습니다', () => {
    const common = {
      gates: [
        { gate: 'G1' as const, validity: 'valid' as const },
        { gate: 'G2' as const, validity: 'valid' as const },
      ],
      blockingRequestIds: ['change-g2'],
      affectedGates: ['G2' as const],
    };
    expect(assessVersionReviewImpact({ ...common, progressStage: 'ready' })).toEqual({
      reviewImpact: {
        affectedGates: ['G2'], needsNewReview: true, returnStage: 'planning',
        carriedBlockingRequestIds: ['change-g2'], currentHandoffValid: false,
      },
      progressStage: 'planning',
    });
    expect(assessVersionReviewImpact({
      ...common, progressStage: 'requirements',
    })).toMatchObject({ progressStage: 'requirements' });
  });

  it('G1 영향에서 G2를 빠뜨리면 거절하고 영향 없음은 현재 상태를 보존합니다', () => {
    const basis = {
      progressStage: 'ready' as const,
      gates: [
        { gate: 'G1' as const, validity: 'valid' as const },
        { gate: 'G2' as const, validity: 'invalid' as const },
      ],
      blockingRequestIds: [],
    };
    expect(() => assessVersionReviewImpact({
      ...basis, affectedGates: ['G1'],
    })).toThrow('G1 영향은 종속 G2를 포함해야 합니다.');
    expect(assessVersionReviewImpact({ ...basis, affectedGates: [] })).toEqual({
      reviewImpact: {
        affectedGates: [], needsNewReview: false,
        carriedBlockingRequestIds: [], currentHandoffValid: false,
      },
      progressStage: 'ready',
    });
  });
});

describe('근거 자료 ReviewImpact', () => {
  const common = {
    progressStage: 'ready' as const,
    gates: [
      { gate: 'G1' as const, validity: 'valid' as const },
      { gate: 'G2' as const, validity: 'valid' as const },
    ],
    blockingRequestIds: ['change-1'],
  };

  it('표시명만 바뀌고 내용과 확인 상태가 같으면 재검토하지 않습니다', () => {
    expect(assessContextSourceReviewImpact({
      ...common,
      before: {
        kind: 'text', content: '같은 본문', provenance: '같은 출처',
        confirmation: 'unconfirmed', displayName: '이전 표시명',
      },
      after: {
        kind: 'text', content: '같은 본문', provenance: '같은 출처',
        confirmation: 'unconfirmed', displayName: '새 표시명',
      },
    })).toEqual({
      reviewImpact: {
        affectedGates: [], needsNewReview: false,
        carriedBlockingRequestIds: [], currentHandoffValid: true,
      },
      progressStage: 'ready',
    });
  });

  it('새 근거 또는 확인 상태 변경은 G1과 종속 G2를 재검토합니다', () => {
    expect(assessContextSourceReviewImpact({
      ...common,
      after: {
        kind: 'link', targetUrl: 'https://example.invalid', provenance: '사용자 입력',
        verifiable: false, confirmation: 'unconfirmed',
      },
    })).toMatchObject({
      progressStage: 'requirements',
      reviewImpact: { affectedGates: ['G1', 'G2'], needsNewReview: true },
    });
  });
});
