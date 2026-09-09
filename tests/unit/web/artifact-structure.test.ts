import { describe, expect, it } from 'vitest';
import { deriveArtifactSectionIndex } from '@/src/domain/artifact-rules';

describe('브라우저 문서 구조 계산', () => {
  it('사람이 지정한 section ID의 제목과 원문 offset을 heading에서 계산합니다', () => {
    const markdown = '## REQ-1 첫 기준\nREQ-1 A, B를 확인합니다.\n\n## REQ-2 다음 기준\nREQ-2를 확인합니다.\n';
    const secondStart = markdown.indexOf('## REQ-2');

    expect(deriveArtifactSectionIndex(markdown, ['REQ-2', 'REQ-1'])).toEqual([
      { sectionId: 'REQ-1', title: '첫 기준', startOffset: 0, endOffset: secondStart },
      { sectionId: 'REQ-2', title: '다음 기준', startOffset: secondStart, endOffset: markdown.length },
    ]);
  });

  it('인용문이나 code fence 안의 같은 ID를 실제 section heading으로 쓰지 않습니다', () => {
    const markdown = '> ## REQ-1 인용\n```md\n## REQ-1 코드\n```\n';

    expect(() => deriveArtifactSectionIndex(markdown, ['REQ-1']))
      .toThrow('정확한 Markdown heading을 하나 찾을 수 없습니다.');
  });
});
