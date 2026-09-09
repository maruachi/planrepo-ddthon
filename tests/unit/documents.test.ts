import { describe, expect, it } from 'vitest';
import {
  classifyDocumentLink,
  compareDocumentSources,
  prepareDocumentDisplay,
} from '@/src/presentation/documents';

describe('문서 표시 경계', () => {
  it('unsafe HTML이 있는 Markdown도 저장 원문을 바꾸지 않고 raw HTML·image 실행을 끈다', () => {
    const markdown = '# 제목\n<script>alert(1)</script>\n<img src="https://example.test/x.png">';
    expect(prepareDocumentDisplay(markdown)).toEqual({
      sourceMarkdown: markdown,
      renderMarkdown: markdown,
      policy: {
        skipRawHtml: true,
        loadImages: false,
      },
    });
  });

  it('비교는 두 고정 원문과 공백·개행 차이를 그대로 보존한다', () => {
    const before = '# 제목\n\n본문  \n';
    const after = '# 제목\n\n본문\n추가\n';
    const comparison = compareDocumentSources(before, after);
    expect(comparison.before.sourceMarkdown).toBe(before);
    expect(comparison.before.renderMarkdown).toBe(before);
    expect(comparison.after.sourceMarkdown).toBe(after);
    expect(comparison.after.renderMarkdown).toBe(after);
    expect(comparison.changed).toBe(true);
    expect(compareDocumentSources(before, before).changed).toBe(false);
  });

  it('http/https와 문서 anchor만 링크로 만들고 실행 scheme과 상대 경로는 막는다', () => {
    expect(classifyDocumentLink('#REQ-1')).toEqual({
      kind: 'anchor',
      href: '#REQ-1',
    });
    expect(classifyDocumentLink('https://example.test/spec?q=1')).toEqual({
      kind: 'external',
      href: 'https://example.test/spec?q=1',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(classifyDocumentLink('http://example.test')).toMatchObject({
      kind: 'external',
    });
    for (const source of [
      'javascript:alert(1)',
      'data:text/html,unsafe',
      'file:///tmp/private',
      '//example.test/protocol-relative',
      '/relative/path',
      ' https://example.test/space',
      '#bad anchor',
    ]) {
      expect(classifyDocumentLink(source), source).toEqual({
        kind: 'blocked',
        source,
      });
    }
  });
});
