export interface DocumentRenderModel {
  readonly sourceMarkdown: string;
  readonly renderMarkdown: string;
  readonly policy: {
    readonly skipRawHtml: true;
    readonly loadImages: false;
  };
}

export type DocumentLinkPresentation =
  | { readonly kind: 'anchor'; readonly href: string }
  | {
      readonly kind: 'external';
      readonly href: string;
      readonly target: '_blank';
      readonly rel: 'noopener noreferrer';
    }
  | { readonly kind: 'blocked'; readonly source: string };

export interface DocumentSourceComparison {
  readonly before: DocumentRenderModel;
  readonly after: DocumentRenderModel;
  readonly changed: boolean;
}

export function prepareDocumentDisplay(markdown: string): DocumentRenderModel {
  return {
    sourceMarkdown: markdown,
    renderMarkdown: markdown,
    policy: { skipRawHtml: true, loadImages: false },
  };
}

export function classifyDocumentLink(source: string): DocumentLinkPresentation {
  if (/^#[^\s\u0000-\u001f\u007f]+$/u.test(source)) {
    return { kind: 'anchor', href: source };
  }
  if (source.trim() !== source || /[\u0000-\u001f\u007f]/u.test(source)) {
    return { kind: 'blocked', source };
  }
  try {
    const url = new URL(source);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return {
        kind: 'external',
        href: source,
        target: '_blank',
        rel: 'noopener noreferrer',
      };
    }
  } catch {
    return { kind: 'blocked', source };
  }
  return { kind: 'blocked', source };
}

export function compareDocumentSources(
  before: string,
  after: string,
): DocumentSourceComparison {
  return {
    before: prepareDocumentDisplay(before),
    after: prepareDocumentDisplay(after),
    changed: before !== after,
  };
}
