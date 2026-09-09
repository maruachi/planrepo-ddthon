import type { SR } from '../../shared/contracts.js';
import { PagedText } from './PagedText.js';
export function InitialInputPanel({ sr }: { sr: SR }) { return <details className="initial-input" open><summary>초기 요구사항 <span>생성 당시 입력</span></summary><div className="initial-body"><PagedText body={sr.description} />{sr.attachmentMarkdown !== undefined ? <details className="attachment-details"><summary>참고 마크다운 · {sr.attachmentDisplayName ?? '첨부 문서'}</summary><PagedText body={sr.attachmentMarkdown} /></details> : <p className="muted">첨부 문서 없음</p>}</div></details>; }
