import type { ArtifactView } from '@/src/contracts/views';
import {
  documentSection,
  sectionBody,
  type InceptionDocumentId,
} from '../state/inception-plan';
import './PlanDocumentVisual.css';

interface TextSection {
  readonly title?: string;
  readonly lines: readonly string[];
}

interface ListedItem {
  readonly text: string;
  readonly details: readonly string[];
}

const MAX_VISIBLE_ITEMS = 40;

function plainText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[*_~\x60]/gu, '')
    .replace(/\\([\\#>+.!()[\]{}-])/gu, '$1')
    .trim();
}

function proseLines(markdown: string): readonly string[] {
  const result: string[] = [];
  let fence: { readonly marker: string; readonly length: number } | undefined;
  for (const line of markdown.split(/\r?\n/u)) {
    const marker = /^ {0,3}(\x60{3,}|~{3,})/u.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = { marker: marker[0]!, length: marker.length };
      else if (marker[0] === fence.marker && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence === undefined && !/^\s*>/u.test(line)) result.push(line);
  }
  return result;
}

function splitSections(markdown: string): readonly TextSection[] {
  const sections: { title?: string; lines: string[] }[] = [{ lines: [] }];
  for (const line of proseLines(markdown)) {
    const heading = /^ {0,3}#{1,6}\s+(.+)$/u.exec(line);
    if (heading !== null) {
      sections.push({ title: plainText(heading[1]!), lines: [] });
      continue;
    }
    sections.at(-1)!.lines.push(line);
  }
  return sections.filter((section) => section.title !== undefined || section.lines.some((line) => line.trim() !== ''));
}

function listItems(lines: readonly string[]): readonly ListedItem[] {
  const items: { text: string; details: string[] }[] = [];
  for (const line of lines) {
    const item = /^\s*(?:[-+*]|\d+[.)])\s+(.+)$/u.exec(line);
    if (item !== null) {
      items.push({ text: plainText(item[1]!), details: [] });
      continue;
    }
    const detail = plainText(line);
    if (detail !== '' && items.length > 0) items.at(-1)!.details.push(detail);
  }
  return items;
}

function readableLines(lines: readonly string[]): readonly string[] {
  const listed = listItems(lines);
  if (listed.length > 0) return listed.map((item) => [item.text, ...item.details].join(' · '));
  return lines.map(plainText).filter(Boolean);
}

function firstParagraphBeforeList(sections: readonly TextSection[]): readonly string[] {
  for (const section of sections.filter((item) => item.title === undefined)) {
    const paragraph: string[] = [];
    for (const line of section.lines) {
      if (/^\s*(?:[-+*]|\d+[.)])\s+/u.test(line)) break;
      const value = plainText(line);
      if (value === '') {
        if (paragraph.length > 0) break;
        continue;
      }
      paragraph.push(value);
    }
    if (paragraph.length > 0) return [paragraph.join(' ')];
  }
  return [];
}

function listedText(item: ListedItem): string {
  return [item.text, ...item.details].join(' · ');
}

function VisualHeader({ title, onRead }: { readonly title: string; onRead(): void }) {
  return <header className="plan-document-visual__header">
    <div><p className="eyebrow">문서 한눈에 보기</p><h3>{title}</h3></div>
    <button type="button" className="text-button" onClick={onRead}>원문 열기</button>
  </header>;
}

function EmptyVisual({ title, onRead }: { readonly title: string; onRead(): void }) {
  return <section className="plan-document-visual" aria-label={title}>
    <VisualHeader title={title} onRead={onRead} />
    <p className="quiet">문서에 목록으로 정리된 내용이 없습니다. 원문에서 현재 내용을 확인해 주세요.</p>
  </section>;
}

function RequirementsVisual({ sections, onRead }: { readonly sections: readonly TextSection[]; onRead(): void }) {
  const purposeSections = sections.filter((section) => section.title !== undefined && /목적|배경/u.test(section.title));
  const includedSections = sections.filter((section) => section.title !== undefined && /포함|대상/u.test(section.title));
  const excludedSections = sections.filter((section) => section.title !== undefined && /제외|범위\s*밖/u.test(section.title));
  const allItems = sections.flatMap((section) => listItems(section.lines));
  const generalItems = sections
    .filter((section) => section.title === undefined || !/제외|범위\s*밖/u.test(section.title))
    .flatMap((section) => listItems(section.lines));
  const explicitlyExcluded = (value: string) => /제외|범위\s*밖|포함하지\s*않|대상이\s*아님/u.test(value);
  const entries = [
    {
      label: purposeSections.length > 0 ? '목적' : '개요',
      values: purposeSections.length > 0
        ? purposeSections.flatMap((section) => readableLines(section.lines))
        : firstParagraphBeforeList(sections),
    },
    {
      label: includedSections.length > 0 ? '포함하는 범위' : '정리된 요구사항',
      values: includedSections.length > 0
        ? includedSections.flatMap((section) => readableLines(section.lines))
        : generalItems.filter((item) => !explicitlyExcluded(listedText(item))).map(listedText),
    },
    {
      label: '제외하는 범위',
      values: excludedSections.length > 0
        ? excludedSections.flatMap((section) => readableLines(section.lines))
        : allItems.filter((item) => explicitlyExcluded(listedText(item))).map(listedText),
    },
  ];

  return <section className="plan-document-visual" aria-label="요구사항 한눈에 보기">
    <VisualHeader title="요구사항" onRead={onRead} />
    <div className="plan-document-visual__scope-grid">{entries.map((entry) =>
      <article key={entry.label}><h4>{entry.label}</h4>
        {entry.values.length > 0
          ? <ul>{entry.values.slice(0, MAX_VISIBLE_ITEMS).map((value, index) => <li key={index}>{value}</li>)}</ul>
          : <p className="quiet">원문에 별도 항목으로 적혀 있지 않습니다.</p>}
      </article>)}</div>
  </section>;
}

function CardListVisual({ title, itemLabel, sections, onRead }: {
  readonly title: string;
  readonly itemLabel: string;
  readonly sections: readonly TextSection[];
  onRead(): void;
}) {
  const cards = sections.flatMap((section) => {
    const listed = listItems(section.lines);
    if (listed.length > 0) {
      return listed.map((item) => ({
        title: item.text,
        detail: item.details.join(' '),
        group: section.title,
      }));
    }
    if (section.title !== undefined) {
      const detail = readableLines(section.lines).join(' ');
      return detail === '' ? [] : [{ title: section.title, detail, group: undefined }];
    }
    return [];
  }).slice(0, MAX_VISIBLE_ITEMS);

  if (cards.length === 0) return <EmptyVisual title={title} onRead={onRead} />;
  return <section className="plan-document-visual" aria-label={title + ' 한눈에 보기'}>
    <VisualHeader title={title} onRead={onRead} />
    <div className="plan-document-visual__cards">{cards.map((card, index) =>
      <article key={card.title + ':' + index}>
        {card.group !== undefined && <span className="plan-document-visual__group">{card.group}</span>}
        <h4>{card.title}</h4>
        {card.detail !== '' && <p>{card.detail}</p>}
      </article>)}</div>
    <p className="quiet">{itemLabel}은 문서에 적힌 순서로 나열했습니다. 흐름이나 우선순위를 따로 추정하지 않았습니다.</p>
  </section>;
}

function DecisionsVisual({ sections, onRead }: { readonly sections: readonly TextSection[]; onRead(): void }) {
  const decisions = sections.flatMap((section) => listItems(section.lines)).slice(0, MAX_VISIBLE_ITEMS).map((item) => {
    const explicitlyUnknown = /(?:^|[\s[（(])(?:미확인|미정|미결정)(?:$|[\s\]）).,:：])/u.test(item.text);
    const text = item.text
      .replace(/^\[(?:미확인|미정|미결정)\]\s*/u, '')
      .replace(/\s*[（(]?(?:미확인|미정|미결정)[）)]?\s*$/u, '')
      .trim();
    const separator = text.search(/[:：]/u);
    const title = separator < 0 ? text : text.slice(0, separator).trim();
    const selection = separator < 0 ? '' : text.slice(separator + 1).trim();
    const reasonLine = item.details.find((line) => /^(?:이유|근거)\s*[:：]/u.test(line));
    const reason = reasonLine?.replace(/^(?:이유|근거)\s*[:：]\s*/u, '') ?? '';
    const otherDetails = item.details.filter((line) => line !== reasonLine);
    return { title, selection, reason, otherDetails, explicitlyUnknown };
  });

  if (decisions.length === 0) return <EmptyVisual title="주요 결정" onRead={onRead} />;
  return <section className="plan-document-visual" aria-label="주요 결정 한눈에 보기">
    <VisualHeader title="주요 결정" onRead={onRead} />
    <div className="plan-document-visual__cards">{decisions.map((decision, index) =>
      <article key={decision.title + ':' + index}>
        {decision.explicitlyUnknown && <span className="plan-document-visual__unknown">미확인</span>}
        <h4>{decision.title}</h4>
        {decision.selection !== '' && <p>{decision.selection}</p>}
        {decision.reason !== '' && <p><strong>문서에 적힌 이유</strong><br />{decision.reason}</p>}
        {decision.otherDetails.map((detail, detailIndex) => <p key={detailIndex}>{detail}</p>)}
      </article>)}</div>
  </section>;
}

export function PlanDocumentVisual({ artifact, documentId, onRead }: {
  readonly artifact: ArtifactView;
  readonly documentId: InceptionDocumentId;
  onRead(): void;
}) {
  if (documentId === 'structure') return null;
  const section = documentSection(artifact, documentId);
  const body = section === undefined ? '' : sectionBody(artifact, section.sectionId);
  const sections = splitSections(body);

  if (documentId === 'requirements') return <RequirementsVisual sections={sections} onRead={onRead} />;
  if (documentId === 'stories') return <CardListVisual title="사용자 시나리오" itemLabel="시나리오" sections={sections} onRead={onRead} />;
  if (documentId === 'workflow') return <CardListVisual title="진행 계획" itemLabel="작업" sections={sections} onRead={onRead} />;
  if (documentId === 'decisions') return <DecisionsVisual sections={sections} onRead={onRead} />;
  return <CardListVisual title="작업 단위" itemLabel="작업 단위" sections={sections} onRead={onRead} />;
}
