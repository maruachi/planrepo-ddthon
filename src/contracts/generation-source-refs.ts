import type { VersionRef } from './context';
import type { SnapshotContentItem } from './views';

export function generationSourceRefKey(ref: VersionRef): string {
  return ref.kind === 'review_policy'
    ? `${ref.kind}\u0000${ref.projectId}\u0000\u0000${ref.entityId}\u0000${ref.version}`
    : `${ref.kind}\u0000${ref.projectId}\u0000${ref.srId}\u0000${ref.entityId}\u0000${ref.version}`;
}

export function allowedGenerationSourceRefs(
  contents: readonly SnapshotContentItem[],
): readonly VersionRef[] {
  return contents.flatMap((item) => 'version' in item.ref ? [item.ref] : []);
}

export function allowedGenerationSourceRefKeys(
  contents: readonly SnapshotContentItem[],
): ReadonlySet<string> {
  return new Set(allowedGenerationSourceRefs(contents).map(generationSourceRefKey));
}
