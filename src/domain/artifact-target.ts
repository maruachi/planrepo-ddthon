import type { DocumentKind } from '@/src/contracts/views';

export type DesignStage = 'application' | 'functional' | 'nfr' | 'infrastructure';
export type ArtifactLogicalKey = Exclude<DocumentKind, 'design'> | `design:${DesignStage}`;

export interface ArtifactLogicalTarget {
  readonly kind: DocumentKind;
  readonly designStage?: DesignStage;
  readonly logicalKey: ArtifactLogicalKey;
}

const DESIGN_STAGES: readonly DesignStage[] = [
  'application',
  'functional',
  'nfr',
  'infrastructure',
];

function isDesignStage(value: unknown): value is DesignStage {
  return typeof value === 'string' && DESIGN_STAGES.includes(value as DesignStage);
}

export function artifactLogicalTarget(
  kind: DocumentKind,
  designStage?: string | null,
): ArtifactLogicalTarget {
  if (kind === 'design') {
    if (!isDesignStage(designStage)) {
      throw new Error('design 문서에는 application, functional, nfr, infrastructure 중 정확한 단계가 필요합니다.');
    }
    return { kind, designStage, logicalKey: `design:${designStage}` };
  }
  if (!['requirements', 'workflow_plan', 'implementation_plan'].includes(kind)) {
    throw new Error('지원하지 않는 문서 종류입니다.');
  }
  if (designStage !== undefined && designStage !== null) {
    throw new Error('design 이외 문서에는 설계 단계를 지정할 수 없습니다.');
  }
  return { kind, logicalKey: kind };
}

export function parseArtifactLogicalKey(logicalKey: string): ArtifactLogicalTarget {
  if (logicalKey === 'requirements' || logicalKey === 'workflow_plan' || logicalKey === 'implementation_plan') {
    return artifactLogicalTarget(logicalKey);
  }
  if (logicalKey.startsWith('design:')) {
    return artifactLogicalTarget('design', logicalKey.slice('design:'.length));
  }
  throw new Error('artifact logical key가 올바르지 않습니다.');
}
