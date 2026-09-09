import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DocumentView } from '../../shared/contracts.js';
import { LIMITS } from '../../shared/limits.js';
import { PagedText } from './PagedText.js';
const safeURL = (url: string) => /^(https?:\/\/|mailto:|#)/i.test(url) ? url : '';
export function DocumentReader({ view }: { view: DocumentView }) {
  let lines = 0; for (const c of view.body) if (c === '\n') lines++;
  const large = new TextEncoder().encode(view.body).length > LIMITS.renderBytes || lines + 1 > LIMITS.renderLines;
  const [raw, setRaw] = useState(large);
  return <section><div className="reader-toolbar"><div className="segmented"><button data-testid="reader-render-button" aria-pressed={!raw} disabled={large} onClick={() => setRaw(false)}>문서 보기</button><button data-testid="reader-source-button" aria-pressed={raw} onClick={() => setRaw(true)}>원본 보기</button></div><small>{new TextEncoder().encode(view.body).length.toLocaleString()} bytes</small></div>{large && <p className="notice">큰 문서는 원본을 200줄씩 표시합니다. 전체 내용을 복사하거나 편집할 수 있습니다.</p>}{raw ? <PagedText key={view.versionId} body={view.body} /> : <article className="markdown"><Markdown remarkPlugins={[remarkGfm]} urlTransform={safeURL} components={{ img: ({ alt }) => <span className="image-alt">[이미지: {alt || '설명 없음'}]</span>, a: ({ href, children }) => href ? <a href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a> : <span>{children}</span> }}>{view.body}</Markdown>{!view.body && <p className="empty">빈 문서입니다.</p>}</article>}</section>;
}
