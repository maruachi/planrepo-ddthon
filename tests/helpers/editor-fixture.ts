import { randomUUID } from 'node:crypto';
import type { ArtifactEdit } from '@/src/contracts/views';
import type { RevisionOrAbsentGuard } from '@/src/contracts/context';
import type { InvokeScope, TestApp } from '@/tests/helpers/test-app';
import { demoCase } from '@/tests/helpers/domain-cases';

function requirementsEdit(
  srId: string,
  projectId: string,
  description: string,
): ArtifactEdit & { readonly kind: 'requirements' } {
  const markdown = `## FR-EDIT 요구사항\nFR-EDIT은 ${description}\n`;
  return {
    kind: 'requirements',
    markdown,
    sectionIndex: [{
      sectionId: 'FR-EDIT',
      title: '요구사항',
      startOffset: 0,
      endOffset: markdown.length,
    }],
    requirementLinks: [{
      requirementId: 'FR-EDIT',
      sectionIds: ['FR-EDIT'],
      acceptanceCriteria: [description],
    }],
    changeSummary: description,
    targetBasis: { kind: 'absent', logicalKey: 'requirements' },
  };
}

export async function createEditorFixture(app: TestApp): Promise<{
  readonly scope: InvokeScope & {
    readonly srId: string;
    readonly guard: RevisionOrAbsentGuard<'artifact'>;
  };
  readonly edit: ArtifactEdit & { readonly kind: 'requirements' };
  readonly competingEdit: ArtifactEdit & { readonly kind: 'requirements' };
}> {
  const sample = demoCase('PAY-102');
  const registered = await app.invoke('M-003', {
    actorId: sample.ownerId,
    projectId: sample.projectId,
  }, {
    key: `EDIT-${randomUUID()}`,
    title: '문서 편집 검증',
    purpose: '동시 생성 검증',
    description: '문서가 없는 새 SR입니다.',
    ownerId: sample.ownerId,
  });
  if (!registered.ok) throw new Error('편집 fixture SR 등록에 실패했습니다.');
  const srId = registered.value.scope.srId;
  const guard = {
    resource: {
      target: {
        kind: 'artifact_logical_key' as const,
        projectId: sample.projectId,
        srId,
        logicalKey: 'requirements',
      },
      expected: 'absent' as const,
    },
  };
  return {
    scope: {
      actorId: sample.ownerId,
      projectId: sample.projectId,
      srId,
      guard,
    },
    edit: requirementsEdit(srId, sample.projectId, '첫 제출을 저장합니다.'),
    competingEdit: requirementsEdit(srId, sample.projectId, '경합 제출을 저장합니다.'),
  };
}
