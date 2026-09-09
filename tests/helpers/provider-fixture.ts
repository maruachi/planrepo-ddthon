import type { VersionRef } from '@/src/contracts/context';
import type { GenerationResult } from '@/src/contracts/views';
import type { ProviderRequest } from '@/src/providers/generation/provider-contract';
import type { ProcessResult } from '@/src/runtime/controlled-process-runner';

const sourceRef: VersionRef = Object.freeze({
  kind: 'context_source',
  projectId: 'project-provider-test',
  srId: 'sr-provider-test',
  entityId: 'source-provider-test',
  version: 2,
});

export function validQuestionResult(): Extract<GenerationResult, { readonly kind: 'question_proposals' }> {
  return {
    schemaVersion: 1,
    kind: 'question_proposals',
    proposals: [{
      temporaryId: 'proposal-1',
      text: '승인 책임자는 누구입니까?',
      reason: '검토 책임을 확정해야 합니다.',
      suggestedAssigneeId: 'user-owner',
      requiredGate: 'G1',
      sourceRefs: [sourceRef],
      candidateAnswers: ['제품 책임자', '기술 책임자'],
    }],
  };
}

export function providerFixture(): {
  readonly request: ProviderRequest;
  readonly closedProcess: Extract<ProcessResult, { readonly kind: 'Completed' }>;
} {
  const request: ProviderRequest = {
    schemaVersion: 1,
    taskKind: 'QUESTION_PROPOSALS',
    snapshot: {
      scope: { kind: 'sr', projectId: 'project-provider-test', srId: 'sr-provider-test' },
      snapshotId: 'snapshot-provider-test',
      workflowVersion: 'v1.0.1',
      taskKind: 'QUESTION_PROPOSALS',
      contentFingerprint: 'sha256:provider-test',
      contents: [
        {
          ref: { kind: 'sr', projectId: 'project-provider-test', srId: 'sr-provider-test', entityId: 'sr-provider-test' },
          content: JSON.stringify({
            participants: {
              ownerId: 'user-owner',
              members: [
                { userId: 'user-owner', displayName: '소유자' },
                { userId: 'user-member', displayName: '구성원' },
              ],
            },
          }),
          confirmation: 'not_applicable',
        },
        { ref: sourceRef, content: '확인된 가상 원문', confirmation: 'confirmed' },
      ],
      projectRules: [{ logicalId: 'RULE-1', version: '1', content: '근거를 연결합니다.' }],
      capturedAt: '2026-09-09T00:00:00.000Z',
    },
    selection: {
      providerId: 'claude-cli',
      modelChoice: { kind: 'explicit', modelId: 'global.anthropic.claude-opus-4-8' },
    },
  };
  const closedProcess: Extract<ProcessResult, { readonly kind: 'Completed' }> = {
    kind: 'Completed',
    stdout: Buffer.alloc(0),
    stderrByteCount: 0,
    exitCode: 0,
    closedAtMono: 12,
    deadlineMono: 300_000,
    metrics: {
      startedAt: '2026-09-09T00:00:00.000Z',
      finishedAt: '2026-09-09T00:00:01.000Z',
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutClosed: true,
      stderrClosed: true,
      exitCode: 0,
    },
  };
  return { request, closedProcess };
}
