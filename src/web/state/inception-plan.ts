import type { ArtifactView, SRDetailView } from '@/src/contracts/views';
import { stripPlanVisualization } from './plan-visualization';

export const INCEPTION_DOCUMENTS = [
  { id: 'requirements', title: '요구사항', purpose: '무엇을 왜 만드는지, 이번 범위와 완료 조건을 정리합니다.', aliases: ['요구사항', '요구사항분석'] },
  { id: 'stories', title: '사용자 시나리오', purpose: '누가 어떤 상황에서 사용하는지 확인합니다.', aliases: ['사용자시나리오', '사용자스토리', 'userstories'] },
  { id: 'workflow', title: '진행 계획', purpose: 'Inception에서 필요한 작업과 생략할 작업을 정합니다.', aliases: ['진행계획', '워크플로계획', 'workflowplanning'] },
  { id: 'structure', title: '주요 구조', purpose: '구성 요소의 책임과 서로 연결되는 방식을 설명합니다.', aliases: ['주요구조', '애플리케이션설계', 'applicationdesign'] },
  { id: 'decisions', title: '주요 결정', purpose: '선택한 방향과 이유, 아직 결정하지 않은 내용을 구분합니다.', aliases: ['주요결정', '주요결정사항', '결정사항'] },
  { id: 'units', title: '작업 단위', purpose: '이 Plan을 어떤 단위로 나눌지 정리합니다.', aliases: ['작업단위', '개발단위', 'unitsgeneration'] },
] as const;
export type InceptionDocumentId = typeof INCEPTION_DOCUMENTS[number]['id'];
export type PlanState = 'draft' | 'aligning' | 'review' | 'changes' | 'approved';
export const PLAN_STATES: readonly { id: PlanState; label: string; help: string }[] = [
  { id: 'draft', label: '초안', help: '가지고 있는 초안 문서로 시작합니다.' },
  { id: 'aligning', label: '문서 작성 중', help: '올린 문서를 읽고 필요한 내용을 다듬습니다.' },
  { id: 'review', label: '검토·결재 중', help: '공유한 Plan을 함께 확인합니다.' },
  { id: 'changes', label: '수정 필요', help: '검토 의견을 반영합니다.' },
  { id: 'approved', label: '결재 완료', help: '현재 Plan 버전의 결재를 마쳤습니다.' },
];
export function currentPlan(detail: SRDetailView): ArtifactView | undefined {
  return detail.artifacts.find(a => a.kind === 'requirements');
}
export function isInceptionPlan(artifact: ArtifactView | undefined): boolean {
  return artifact?.kind === 'requirements' && stripPlanVisualization(artifact.markdown).trim().length > 0;
}
function proseLines(markdown: string): string[] {
  let fence: { marker: string; length: number } | undefined;
  return stripPlanVisualization(markdown).split(/\r?\n/u).filter(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = { marker: marker[0]!, length: marker.length };
      else if (marker[0] === fence.marker && marker.length >= fence.length) fence = undefined;
      return false;
    }
    return fence === undefined && !/^\s*>/u.test(line);
  });
}
const normalize = (value: string) => value.toLowerCase().replace(/[\s\d.·:()_-]/gu, '');
export function documentSection(artifact: ArtifactView | undefined, id: InceptionDocumentId) {
  const definition = INCEPTION_DOCUMENTS.find(d => d.id === id)!;
  return artifact?.sectionIndex.find(s => definition.aliases.some(alias => normalize(s.title) === normalize(alias)));
}
export function sectionBody(artifact: ArtifactView, sectionId: string): string {
  const section = artifact.sectionIndex.find(s => s.sectionId === sectionId);
  return section === undefined ? '' : stripPlanVisualization(artifact.markdown.slice(section.startOffset, section.endOffset)).replace(/^ {0,3}##[^\n]*(?:\n|$)/u, '').trim();
}
export function excerpt(markdown: string, maxLength = 180): string {
  return stripPlanVisualization(markdown).replace(/```[\s\S]*?```/gu, '').split(/\r?\n/u)
    .map(line => line.replace(/^\s*(?:#{1,6}\s*|[-*]\s*|>\s*)/u, '').replace(/[*_`]/gu, '').trim())
    .filter(Boolean).join(' ').slice(0, maxLength);
}
export function planState(detail: SRDetailView): PlanState {
  const artifact = currentPlan(detail);
  if (!isInceptionPlan(artifact)) return detail.questions.length > 0 ? 'aligning' : 'draft';
  const config = detail.reviewConfigurations.find(c => c.gate === 'G1');
  const bundle = detail.bundles.find(b => b.bundleRef.gate === 'G1' &&
    b.bundleRef.bundleId === config?.currentBundleRef?.bundleId && b.bundleRef.version === config?.currentBundleRef?.version &&
    b.reviewEpoch === config.reviewEpoch && b.artifactVersionRefs.some(r => r.entityId === artifact?.artifactId && r.version === artifact.versionRef.version));
  if (detail.changeRequests.some(c => c.affectedGate === 'G1' && c.status !== 'resolved')) return 'changes';
  if (bundle && config?.validity === 'valid' && !config.needsNewBundle) return 'approved';
  if (bundle && !config?.needsNewBundle && detail.reviewRequests.some(r => r.bundleRef.bundleId === bundle.bundleRef.bundleId && r.bundleRef.version === bundle.bundleRef.version && r.reviewEpoch === bundle.reviewEpoch)) return 'review';
  return 'aligning';
}
export function planStateLabel(detail: SRDetailView): string {
  return PLAN_STATES.find(s => s.id === planState(detail))!.label;
}
export function planTemplate(detail: SRDetailView): string {
  const old = currentPlan(detail);
  const requirements = old?.markdown ?? detail.currentDescription.description;
  const structure = detail.artifacts.find(a => a.kind === 'design' && a.designStage === 'application')?.markdown;
  const decisions = detail.decisions.map(d => d.state === 'confirmed'
    ? '- ' + d.prompt + ': ' + (d.currentConfirmation?.selection.text ?? '') + '\n  이유: ' + (d.currentConfirmation?.rationale ?? '')
    : '- [미확인] ' + d.prompt).join('\n');
  const nested = (text: string) => text.replace(/^#{1,2}\s+/gmu, '### ');
  return '# Inception Plan: ' + detail.sr.title + '\n\n' + INCEPTION_DOCUMENTS.map(d => {
    const body = d.id === 'requirements' ? nested(requirements)
      : d.id === 'structure' && structure ? nested(structure)
      : d.id === 'decisions' && decisions ? decisions
      : '[미확인] ' + d.purpose;
    return '## ' + d.title + '\n\n' + body;
  }).join('\n\n');
}
export function structuralLinks(markdown: string): readonly { from: string; to: string }[] {
  const links: { from: string; to: string }[] = [];
  for (const line of proseLines(markdown)) {
    if (!/^\s*[-*]\s+/u.test(line) || /미확인|미정|예시|가정|검토 중/u.test(line)) continue;
    const clean = line.replace(/^\s*[-*]\s+/u, '').split(/[:：]/u)[0]!.trim();
    if (!clean.includes('→')) continue;
    const nodes = clean.split('→').map(s => s.trim()).filter(Boolean);
    if (nodes.some(s => s.length > 36) || nodes.length < 2) continue;
    for (let i = 0; i < nodes.length - 1; i++) {
      const from = nodes[i]!, to = nodes[i + 1]!;
      if (from !== to && !links.some(l => l.from === from && l.to === to)) links.push({ from, to });
    }
  }
  return links;
}
