import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import type { SrScope } from '@/src/contracts/context';
import type { ArtifactEdit, WorkflowPlanEdit } from '@/src/contracts/views';
import {
  matchesArtifactBasis,
  validateArtifactEdit,
} from '@/src/domain/artifact-rules';

const scope: SrScope = {
  kind: 'sr',
  projectId: 'project-1',
  srId: 'sr-1',
};

function requirementsEdit(markdown = '# 요구사항\n\n## REQ-1\n요구사항 본문'): ArtifactEdit {
  const startOffset = markdown.indexOf('## REQ-1');
  return {
    kind: 'requirements',
    markdown,
    sectionIndex: [{
      sectionId: 'REQ-1',
      title: '요구사항 1',
      startOffset,
      endOffset: markdown.length,
    }],
    requirementLinks: [{
      requirementId: 'REQ-1',
      sectionIds: ['REQ-1'],
      acceptanceCriteria: ['완료 기준'],
    }],
    changeSummary: '최초 작성',
    targetBasis: { kind: 'absent', logicalKey: 'requirements' },
  };
}

describe('Artifact 순수 규칙', () => {
  it('absent와 version basis를 현재 version에 정확히 대조한다', () => {
    expect(matchesArtifactBasis(undefined, { kind: 'absent' })).toBe(true);
    expect(matchesArtifactBasis(1, { kind: 'absent' })).toBe(false);
    expect(matchesArtifactBasis(2, { kind: 'version', version: 2 })).toBe(true);
    expect(matchesArtifactBasis(undefined, { kind: 'version', version: 2 })).toBe(false);
    expect(matchesArtifactBasis(3, { kind: 'version', version: 2 })).toBe(false);
  });

  it('유효한 문서의 원문 구조와 lock 재검사 basis를 반환한다', () => {
    const result = validateArtifactEdit(scope, requirementsEdit());
    expect(result).toEqual({
      ok: true,
      issues: [],
      basisRecheck: {
        scope,
        expected: { kind: 'absent' },
        targetKey: 'requirements',
        mustRecheckUnderWriteLock: true,
      },
    });

    const revision = requirementsEdit();
    const versionResult = validateArtifactEdit(scope, {
      ...revision,
      artifactId: 'artifact-1',
      targetBasis: {
        kind: 'version',
        ref: {
          kind: 'artifact',
          projectId: scope.projectId,
          srId: scope.srId,
          entityId: 'artifact-1',
          version: 4,
        },
      },
    });
    expect(versionResult.basisRecheck).toEqual({
      scope,
      expected: { kind: 'version', version: 4 },
      targetKey: 'artifact-1',
      mustRecheckUnderWriteLock: true,
    });
  });

  it('문서 종류와 designStage 조합을 runtime에서도 제한한다', () => {
    const invalidKind = validateArtifactEdit(scope, {
      ...requirementsEdit(),
      kind: 'unknown',
    } as unknown as ArtifactEdit);
    expect(invalidKind.issues).toContainEqual({
      code: 'DOCUMENT_KIND_INVALID',
      path: 'kind',
    });

    const missingStage = validateArtifactEdit(scope, {
      ...requirementsEdit(),
      kind: 'design',
    } as unknown as ArtifactEdit);
    expect(missingStage.issues).toContainEqual({
      code: 'DESIGN_STAGE_REQUIRED',
      path: 'designStage',
    });

    const forbiddenStage = validateArtifactEdit(scope, {
      ...requirementsEdit(),
      designStage: 'functional',
    } as unknown as ArtifactEdit);
    expect(forbiddenStage.issues).toContainEqual({
      code: 'DESIGN_STAGE_FORBIDDEN',
      path: 'designStage',
    });
  });

  it('section ID·원문 offset과 requirement link의 고유성·대상을 함께 검사한다', () => {
    const base = requirementsEdit();
    const result = validateArtifactEdit(scope, {
      ...base,
      sectionIndex: [
        ...base.sectionIndex,
        {
          sectionId: 'REQ-1',
          title: '중복',
          startOffset: 0,
          endOffset: 4,
        },
      ],
      requirementLinks: [
        ...base.requirementLinks,
        {
          requirementId: 'REQ-1',
          sectionIds: ['missing-section', 'missing-section'],
          acceptanceCriteria: [''],
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'SECTION_ID_DUPLICATE',
      'SECTION_RANGE_OVERLAP',
      'SECTION_SOURCE_MISMATCH',
      'REQUIREMENT_ID_DUPLICATE',
      'REQUIREMENT_SECTION_DUPLICATE',
      'REQUIREMENT_SECTION_UNKNOWN',
      'REQUIREMENT_SOURCE_MISMATCH',
      'REQUIREMENT_CRITERIA_INVALID',
    ]));
  });

  it('section heading과 requirement ID를 prefix·인용·code fence의 부분 문자열로 인정하지 않는다', () => {
    const prefixMarkdown = '## REQ-10\nREQ-10 body';
    const prefix = validateArtifactEdit(scope, {
      ...requirementsEdit(prefixMarkdown),
      sectionIndex: [{
        sectionId: 'REQ-1', title: '잘못된 prefix', startOffset: 0, endOffset: prefixMarkdown.length,
      }],
      requirementLinks: [{
        requirementId: 'REQ-1', sectionIds: ['REQ-1'], acceptanceCriteria: ['완료 기준'],
      }],
    });
    expect(prefix.issues).toEqual(expect.arrayContaining([
      { code: 'SECTION_SOURCE_MISMATCH', path: 'sectionIndex[0]' },
      { code: 'REQUIREMENT_SOURCE_MISMATCH', path: 'requirementLinks[0]' },
    ]));

    for (const markdown of [
      '> ## REQ-1\n인용문',
      '```markdown\n## REQ-1\n```',
    ]) {
      const startOffset = markdown.indexOf('## REQ-1');
      const result = validateArtifactEdit(scope, {
        ...requirementsEdit(markdown),
        sectionIndex: [{
          sectionId: 'REQ-1', title: '실제 heading 아님', startOffset, endOffset: markdown.length,
        }],
      });
      expect(result.issues).toContainEqual({
        code: 'SECTION_SOURCE_MISMATCH', path: 'sectionIndex[0]',
      });
    }
  });

  it('정확한 section ID 뒤에 표시 제목이 붙은 실제 heading은 허용한다', () => {
    const markdown = '## REQ-1 결제 취소\nREQ-1 본문';

    expect(validateArtifactEdit(scope, requirementsEdit(markdown)).ok).toBe(true);
  });

  it('많은 부분 ID 후보도 bounded 시간 안에 선형으로 검사한다', () => {
    const markdown = `## SEC-1\n${'REQ-10 '.repeat(5_000)}`;
    const startedAt = performance.now();
    const result = validateArtifactEdit(scope, {
      ...requirementsEdit(markdown),
      sectionIndex: [{
        sectionId: 'SEC-1', title: '성능 경계', startOffset: 0, endOffset: markdown.length,
      }],
      requirementLinks: [{
        requirementId: 'REQ-1', sectionIds: ['SEC-1'], acceptanceCriteria: ['완료 기준'],
      }],
    });
    const elapsedMs = performance.now() - startedAt;

    expect(Buffer.byteLength(markdown, 'utf8')).toBeLessThan(40_000);
    expect(result.issues).toContainEqual({
      code: 'REQUIREMENT_SOURCE_MISMATCH', path: 'requirementLinks[0]',
    });
    expect(elapsedMs).toBeLessThan(500);
  });

  it('참조는 같은 project/SR의 불변 version이어야 한다', () => {
    const result = validateArtifactEdit(scope, {
      ...requirementsEdit(),
      decisionRefs: [{
        kind: 'decision',
        projectId: scope.projectId,
        srId: 'other-sr',
        entityId: 'decision-1',
        version: 1,
      }],
    });
    expect(result.issues).toContainEqual({
      code: 'REFERENCE_SCOPE_MISMATCH',
      path: 'decisionRefs[0]',
    });
  });

  it('Markdown은 문자 수와 별개로 UTF-8 1 MiB를 넘지 않는다', () => {
    const markdown = `## REQ-1\n${'한'.repeat(400_000)}`;
    expect(markdown.length).toBeLessThan(1024 * 1024);
    expect(Buffer.byteLength(markdown, 'utf8')).toBeGreaterThan(1024 * 1024);
    const result = validateArtifactEdit(scope, requirementsEdit(markdown));
    expect(result.issues).toContainEqual({
      code: 'MARKDOWN_TOO_LARGE',
      path: 'markdown',
    });
  });

  it('WorkflowPlan의 stage·task ID와 요구사항·검증·설계 ref 연결을 검사한다', () => {
    const base = requirementsEdit();
    const workflow: WorkflowPlanEdit = {
      ...base,
      kind: 'workflow_plan',
      targetBasis: { kind: 'absent', logicalKey: 'workflow_plan' },
      workflowVersion: 'v1.0.1',
      implementationUnitCount: 1,
      stages: [{
        stageId: 'functional_design',
        choice: 'executed',
        designArtifactRefs: [{
          kind: 'artifact',
          projectId: scope.projectId,
          srId: scope.srId,
          entityId: 'design-1',
          version: 1,
        }],
      }],
      requirementTaskLinks: [{
        taskId: 'CG-01',
        requirementIds: ['REQ-1'],
        verification: ['contract test'],
        order: 1,
      }],
    };
    expect(validateArtifactEdit(scope, workflow).ok).toBe(true);
    const invalid = validateArtifactEdit(scope, {
      ...workflow,
      stages: [
        workflow.stages[0],
        { stageId: 'functional_design', choice: 'skipped', reason: '' },
      ],
      requirementTaskLinks: [
        workflow.requirementTaskLinks[0],
        {
          taskId: 'CG-01',
          requirementIds: ['REQ-missing'],
          verification: [''],
          order: 1,
        },
      ],
    });
    expect(invalid.issues).toContainEqual({
      code: 'WORKFLOW_INVALID',
      path: 'stages[1].stageId',
    });
    expect(invalid.issues).toContainEqual({
      code: 'WORKFLOW_INVALID',
      path: 'requirementTaskLinks[1].requirementIds[0]',
    });
  });

  it('workflow_plan kind는 1:1 WorkflowPlan 구조 전체를 필수로 요구한다', () => {
    const missing = validateArtifactEdit(scope, {
      ...requirementsEdit(),
      kind: 'workflow_plan',
      targetBasis: { kind: 'absent', logicalKey: 'workflow_plan' },
    } as ArtifactEdit);

    expect(missing.ok).toBe(false);
    expect(missing.issues).toContainEqual({ code: 'WORKFLOW_INVALID', path: 'workflow' });
  });
});
