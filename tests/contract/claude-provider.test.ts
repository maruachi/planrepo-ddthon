import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import manifest from '@/config/demo/manifest.json' with { type: 'json' };
import { prepareGenerationSnapshot } from '@/src/application/generation-snapshot';
import { createQuestionDecisionService } from '@/src/application/question-decision-service';
import { createClaudeCliProvider } from '@/src/providers/generation/claude-cli';
import {
  buildClaudeLaunchProfile,
  CLAUDE_INHERITED_ENVIRONMENT_NAMES,
  CLAUDE_PROFILE_FINGERPRINT,
  FIXED_SYSTEM_PROMPT,
  materializeClaudeEmptyMcpConfig,
  snapshotClaudeEmptyMcpConfig,
} from '@/src/providers/generation/claude-profile';
import { decodeClaudeResult } from '@/src/providers/generation/claude-result';
import type { ProviderRequest } from '@/src/providers/generation/provider-contract';
import { readGenerationBasis } from '@/src/persistence/generation-input-repository';
import { insertInputSnapshot } from '@/src/persistence/input-snapshot-repository';
import { createPersistence } from '@/src/persistence/transaction';
import type { ControlledProcessSpec, OwnedExecution, ProcessResult } from '@/src/runtime/controlled-process-runner';
import { providerFixture, validQuestionResult } from '@/tests/helpers/provider-fixture';
import { createTestApp } from '@/tests/helpers/test-app';

const temporaryRoots: string[] = [];

function providerProject(mcpContent = '{"mcpServers":{}}') {
  const root = mkdtempSync(resolve(tmpdir(), 'planrepo-provider-'));
  temporaryRoots.push(root);
  const configDir = resolve(root, 'config/claude');
  const runDir = resolve(root, '.planrepo/runs/launch');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(runDir, { recursive: true });
  const mcpConfigPath = resolve(configDir, 'mcp-empty.json');
  writeFileSync(mcpConfigPath, mcpContent);
  return { root, runDir, mcpConfigPath };
}

function approvedMcp(project: ReturnType<typeof providerProject>) {
  return materializeClaudeEmptyMcpConfig(
    snapshotClaudeEmptyMcpConfig(project.root, project.mcpConfigPath),
    project.runDir,
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function proposalRequest(
  request: ReturnType<typeof providerFixture>['request'],
  taskKind: 'QUESTION_PROPOSALS' | 'DECISION_PROPOSALS',
): ReturnType<typeof providerFixture>['request'] {
  const snapshot = request.snapshot;
  return {
    schemaVersion: 1,
    taskKind,
    selection: request.selection,
    snapshot: {
      scope: snapshot.scope,
      snapshotId: snapshot.snapshotId,
      workflowVersion: snapshot.workflowVersion,
      taskKind,
      contentFingerprint: snapshot.contentFingerprint,
      contents: snapshot.contents,
      projectRules: snapshot.projectRules,
      ...(snapshot.supplement === undefined ? {} : { supplement: snapshot.supplement }),
      capturedAt: snapshot.capturedAt,
    },
  };
}

function artifactRequest(
  request: ReturnType<typeof providerFixture>['request'],
  taskKind: 'ARTIFACT_DRAFT' | 'ARTIFACT_REVISION',
): ProviderRequest {
  const common = {
    scope: request.snapshot.scope,
    snapshotId: request.snapshot.snapshotId,
    workflowVersion: request.snapshot.workflowVersion,
    contentFingerprint: request.snapshot.contentFingerprint,
    contents: request.snapshot.contents,
    projectRules: request.snapshot.projectRules,
    ...(request.snapshot.supplement === undefined ? {} : { supplement: request.snapshot.supplement }),
    capturedAt: request.snapshot.capturedAt,
  };
  if (taskKind === 'ARTIFACT_DRAFT') {
    return {
      schemaVersion: 1, taskKind, documentKind: 'requirements', selection: request.selection,
      snapshot: {
        ...common, taskKind, documentKind: 'requirements',
        targetBasis: { kind: 'absent', logicalKey: 'requirements' },
      },
    };
  }
  return {
    schemaVersion: 1, taskKind, documentKind: 'requirements', selection: request.selection,
    snapshot: {
      ...common, taskKind, documentKind: 'requirements',
      targetBasis: { kind: 'version', ref: {
        kind: 'artifact', projectId: request.snapshot.scope.projectId,
        srId: request.snapshot.scope.srId, entityId: 'artifact-1', version: 1,
      } },
    },
  };
}

describe('Claude provider contract', () => {
  it('rejects an is_error result even when its subtype says success', () => {
    const { request, closedProcess } = providerFixture();
    const stdout = Buffer.from(JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'provider failure with synthetic secret CANARY_DO_NOT_LOG',
    }));
    const outcome = decodeClaudeResult({ request, process: closedProcess, stdout });

    expect(outcome).toMatchObject({ kind: 'failed', failure: { code: 'PROVIDER_ERROR' } });
    expect(JSON.stringify(outcome)).not.toContain('CANARY_DO_NOT_LOG');
  });

  it('accepts the matching result and records only verified model metadata', () => {
    const { request, closedProcess } = providerFixture();
    const stdout = Buffer.from(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false,
      result: JSON.stringify(validQuestionResult()),
      modelUsage: { 'global.anthropic.claude-opus-4-8': { inputTokens: 1 } },
    }));

    expect(decodeClaudeResult({ request, process: closedProcess, stdout })).toMatchObject({
      kind: 'completed',
      result: { kind: 'question_proposals' },
      execution: { actualModelId: 'global.anthropic.claude-opus-4-8' },
    });
    const canonicalModel = Buffer.from(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false,
      result: JSON.stringify(validQuestionResult()),
      modelUsage: { 'claude-opus-4-8': { inputTokens: 1 } },
    }));
    expect(decodeClaudeResult({ request, process: closedProcess, stdout: canonicalModel })).toMatchObject({
      kind: 'completed', execution: { actualModelId: 'claude-opus-4-8' },
    });
  });

  it('rejects task mismatch, unknown refs, malformed JSON and normalized results over the policy limit', () => {
    const { request, closedProcess } = providerFixture();
    const envelope = (result: unknown) => Buffer.from(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(result),
    }));
    const mismatched = { schemaVersion: 1, kind: 'artifact', documentKind: 'requirements', markdown: '# 문서', requirementRefs: [], changeSummary: '작성' };
    const unknownRef = validQuestionResult();
    const invalidProposal = {
      ...unknownRef.proposals[0],
      sourceRefs: [{ kind: 'context_source', projectId: 'other', srId: 'other', entityId: 'secret', version: 1 }],
    };

    expect(decodeClaudeResult({ request, process: closedProcess, stdout: envelope(mismatched) })).toMatchObject({
      kind: 'failed', failure: { code: 'INVALID_OUTPUT' },
    });
    expect(decodeClaudeResult({
      request,
      process: closedProcess,
      stdout: envelope({ ...unknownRef, proposals: [invalidProposal] }),
    })).toMatchObject({ kind: 'failed', failure: { code: 'INVALID_OUTPUT' } });
    expect(decodeClaudeResult({ request, process: closedProcess, stdout: Buffer.from('{') })).toMatchObject({
      kind: 'failed', failure: { code: 'INVALID_OUTPUT' },
    });
    expect(decodeClaudeResult({
      request,
      process: closedProcess,
      stdout: envelope(validQuestionResult()),
      normalizedResultMaxBytes: 5,
    })).toMatchObject({ kind: 'failed', failure: { code: 'INVALID_OUTPUT' } });
  });

  it('accepts an explicit current M-008 answer snapshot ref but rejects a ref found only inside content', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const projectId = manifest.projectId;
      const srId = manifest.srIds['PAY-102'];
      const questionId = manifest.entityIds['PAY-102'].questionId;
      const requesterId = manifest.personaIds['P-02'];
      const ownerId = manifest.personaIds['P-01'];
      const service = createQuestionDecisionService(createPersistence(app.db));
      const answered = service.answerQuestion({
        actor: { actorId: requesterId, projectId, roles: [], srAssignments: [], demo: true },
        scope: { kind: 'sr', projectId, srId },
        requestId: randomUUID(),
        idempotencyKey: 'provider-current-answer-ref',
        guard: {
          resource: {
            target: { kind: 'question', projectId, srId, entityId: questionId },
            expectedRevision: 1,
          },
        },
      }, {
        questionId,
        answeredQuestionSnapshotRef: {
          kind: 'question_result', projectId, srId, entityId: questionId, version: 1,
        },
        answer: { kind: 'free_text', text: '현재 답변 원문' },
        evidence: { text: '현재 질문 담당자가 확인했습니다.' },
      });
      expect(answered.kind).toBe('Committed');

      const scope = { kind: 'sr' as const, projectId, srId };
      const basis = readGenerationBasis(app.db, scope);
      if (basis === undefined) throw new Error('generation basis missing');
      const prepared = prepareGenerationSnapshot({ taskKind: 'QUESTION_PROPOSALS' }, basis, []);
      const snapshot = app.db.transaction(() => insertInputSnapshot(app.db, {
        basis,
        prepared,
        projectRules: [],
        capturedAt: '2026-09-09T12:00:00.000Z',
      })).immediate();
      const answerItem = snapshot.contents.find((item) => item.ref.kind === 'question_answer');
      if (answerItem === undefined || !('version' in answerItem.ref)) throw new Error('answer marker missing');
      const { request: fixtureRequest, closedProcess } = providerFixture();
      const request: ProviderRequest = {
        schemaVersion: 1,
        taskKind: 'QUESTION_PROPOSALS',
        snapshot,
        selection: fixtureRequest.selection,
      };
      const result = {
        schemaVersion: 1,
        kind: 'question_proposals',
        proposals: [{
          temporaryId: 'question-from-answer',
          text: '답변의 예외 조건은 무엇입니까?',
          reason: '답변의 범위를 확인합니다.',
          suggestedAssigneeId: ownerId,
          requiredGate: 'G1',
          sourceRefs: [answerItem.ref],
          candidateAnswers: ['예외 없음'],
        }],
      };
      const encode = (value: unknown) => Buffer.from(JSON.stringify({
        type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(value),
      }));
      expect(decodeClaudeResult({ request, process: closedProcess, stdout: encode(result) })).toMatchObject({
        kind: 'completed', result: { kind: 'question_proposals' },
      });

      const nestedOnlyRef = {
        kind: 'question_answer' as const, projectId, srId, entityId: 'nested-only', version: 1,
      };
      const requestWithNestedOnlyRef: ProviderRequest = {
        ...request,
        snapshot: {
          ...snapshot,
          contents: snapshot.contents.map((item, index) => index === 0
            ? {
                ...item,
                content: JSON.stringify({
                  ...(JSON.parse(item.content) as Record<string, unknown>),
                  nestedOnlyRef,
                }),
              }
            : item),
        },
      };
      expect(decodeClaudeResult({
        request: requestWithNestedOnlyRef,
        process: closedProcess,
        stdout: encode(result),
      })).toMatchObject({ kind: 'completed', result: { kind: 'question_proposals' } });
      expect(decodeClaudeResult({
        request: requestWithNestedOnlyRef,
        process: closedProcess,
        stdout: encode({
          ...result,
          proposals: [{ ...result.proposals[0], sourceRefs: [nestedOnlyRef] }],
        }),
      })).toMatchObject({ kind: 'failed', failure: { code: 'INVALID_OUTPUT' } });
    } finally {
      await app.close();
    }
  });

  it('rejects a model that contradicts an explicit selection and observed command attempts', () => {
    const { request, closedProcess } = providerFixture();
    const encode = (extra: Record<string, unknown>) => Buffer.from(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false,
      result: JSON.stringify(validQuestionResult()),
      ...extra,
    }));
    expect(decodeClaudeResult({
      request,
      process: closedProcess,
      stdout: encode({ modelUsage: { 'different-model': { inputTokens: 1 } } }),
    })).toMatchObject({ kind: 'failed', failure: { code: 'INVALID_OUTPUT' } });
    expect(decodeClaudeResult({
      request,
      process: closedProcess,
      stdout: encode({ permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'whoami' } }] }),
    })).toMatchObject({ kind: 'failed', failure: { code: 'UNAVAILABLE' } });
    expect(JSON.stringify(decodeClaudeResult({
      request,
      process: closedProcess,
      stdout: encode({ permission_denials: [{ tool_name: 'CANARY_TOOL_SECRET' }] }),
    }))).not.toContain('CANARY_TOOL_SECRET');
  });

  it('rejects blank required fields and duplicate proposal or option IDs before storage', () => {
    const { request, closedProcess } = providerFixture();
    const encode = (result: unknown) => Buffer.from(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(result),
    }));
    const valid = validQuestionResult();
    const blank = { ...valid, proposals: [{ ...valid.proposals[0], text: '' }] };
    const duplicate = { ...valid, proposals: [valid.proposals[0], { ...valid.proposals[0] }] };
    expect(decodeClaudeResult({ request, process: closedProcess, stdout: encode(blank) })).toMatchObject({
      kind: 'failed', failure: { code: 'INVALID_OUTPUT' },
    });
    expect(decodeClaudeResult({ request, process: closedProcess, stdout: encode(duplicate) })).toMatchObject({
      kind: 'failed', failure: { code: 'INVALID_OUTPUT' },
    });

    const decisionRequest = proposalRequest(request, 'DECISION_PROPOSALS');
    const duplicateOptions = {
      schemaVersion: 1, kind: 'decision_proposals', proposals: [{
        temporaryId: 'decision-1', prompt: '선택', impact: '영향', recommendation: '권고', sourceRefs: [],
        alternatives: [
          { optionId: 'same', label: 'A', description: 'A' },
          { optionId: 'same', label: 'B', description: 'B' },
        ],
      }],
    };
    expect(decodeClaudeResult({
      request: decisionRequest, process: closedProcess, stdout: encode(duplicateOptions),
    })).toMatchObject({ kind: 'failed', failure: { code: 'INVALID_OUTPUT' } });
  });

  it('rejects whitespace-only required strings and ID-array entries for every task kind', () => {
    const { request, closedProcess } = providerFixture();
    const encode = (result: unknown) => Buffer.from(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(result),
    }));
    const question = validQuestionResult();
    const invalidQuestions = [
      { ...question.proposals[0], temporaryId: ' \n ' },
      { ...question.proposals[0], text: ' \n ' },
      { ...question.proposals[0], reason: '\t' },
      { ...question.proposals[0], candidateAnswers: ['  '] },
    ];
    for (const proposal of invalidQuestions) {
      expect(decodeClaudeResult({
        request, process: closedProcess, stdout: encode({ ...question, proposals: [proposal] }),
      })).toMatchObject({ kind: 'failed', failure: { code: 'INVALID_OUTPUT' } });
    }

    const decisionRequest = proposalRequest(request, 'DECISION_PROPOSALS');
    const decision = {
      schemaVersion: 1, kind: 'decision_proposals', proposals: [{
        temporaryId: 'decision-1', prompt: '선택', impact: '영향', recommendation: '권고', sourceRefs: [],
        alternatives: [{ optionId: 'option-1', label: '대안', description: '설명' }],
      }],
    };
    const invalidDecisions = [
      { ...decision.proposals[0], temporaryId: ' ' },
      { ...decision.proposals[0], prompt: '\n' },
      { ...decision.proposals[0], impact: '\t' },
      { ...decision.proposals[0], recommendation: '  ' },
      { ...decision.proposals[0], alternatives: [{ optionId: ' ', label: '대안', description: '설명' }] },
      { ...decision.proposals[0], alternatives: [{ optionId: 'option-1', label: '\n', description: '설명' }] },
      { ...decision.proposals[0], alternatives: [{ optionId: 'option-1', label: '대안', description: '\t' }] },
    ];
    for (const proposal of invalidDecisions) {
      expect(decodeClaudeResult({
        request: decisionRequest, process: closedProcess,
        stdout: encode({ ...decision, proposals: [proposal] }),
      })).toMatchObject({ kind: 'failed', failure: { code: 'INVALID_OUTPUT' } });
    }

    for (const taskKind of ['ARTIFACT_DRAFT', 'ARTIFACT_REVISION'] as const) {
      const requestForArtifact = artifactRequest(request, taskKind);
      for (const result of [
        { schemaVersion: 1, kind: 'artifact', documentKind: 'requirements', markdown: ' \n', requirementRefs: ['REQ-1'], changeSummary: '변경' },
        { schemaVersion: 1, kind: 'artifact', documentKind: 'requirements', markdown: '# 문서', requirementRefs: ['\t'], changeSummary: '변경' },
        { schemaVersion: 1, kind: 'artifact', documentKind: 'requirements', markdown: '# 문서', requirementRefs: ['REQ-1'], changeSummary: '  ' },
      ]) {
        expect(decodeClaudeResult({
          request: requestForArtifact, process: closedProcess, stdout: encode(result),
        })).toMatchObject({ kind: 'failed', failure: { code: 'INVALID_OUTPUT' } });
      }
    }
  });

  it('rejects non-empty, symlinked, and arbitrary MCP config paths at provider bootstrap', () => {
    const runner = { start() { throw new Error('must not start'); } };
    const invalidRoots = [
      providerProject('{"mcpServers":{"unapproved":{"command":"false"}}}'),
      providerProject(),
      providerProject(),
    ];
    const symlinkTarget = resolve(invalidRoots[1]!.root, 'outside-empty.json');
    writeFileSync(symlinkTarget, '{"mcpServers":{}}');
    rmSync(invalidRoots[1]!.mcpConfigPath);
    symlinkSync(symlinkTarget, invalidRoots[1]!.mcpConfigPath);
    const arbitrary = resolve(invalidRoots[2]!.root, 'arbitrary-empty.json');
    writeFileSync(arbitrary, '{"mcpServers":{}}');

    for (const [project, mcpConfigPath] of [
      [invalidRoots[0]!, invalidRoots[0]!.mcpConfigPath],
      [invalidRoots[1]!, invalidRoots[1]!.mcpConfigPath],
      [invalidRoots[2]!, arbitrary],
    ] as const) {
      expect(() => createClaudeCliProvider({
        runner,
        projectRoot: project.root,
        mcpConfigPath,
        sourceEnvironment: { HOME: '/home/demo', PATH: '/bin' },
        cliVersion: '2.1.265',
      })).toThrow(/MCP/u);
    }
  });

  it('runs with an exclusive owned empty MCP copy after the checked-in source changes', async () => {
    const { request, closedProcess } = providerFixture();
    const project = providerProject();
    const stdout = Buffer.from(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(validQuestionResult()),
    }));
    let captured: ControlledProcessSpec | undefined;
    const provider = createClaudeCliProvider({
      runner: {
        start(spec: ControlledProcessSpec): OwnedExecution {
          captured = spec;
          return {
            result: Promise.resolve({
              ...closedProcess, stdout, metrics: { ...closedProcess.metrics, stdoutBytes: stdout.byteLength },
            }),
            requestStop: () => undefined,
            getObservationState: () => ({ kind: 'Pending', launchRef: spec.launchRef }),
          };
        },
      },
      projectRoot: project.root,
      mcpConfigPath: project.mcpConfigPath,
      sourceEnvironment: { HOME: '/home/demo', PATH: '/bin' },
      cliVersion: '2.1.265',
    });
    writeFileSync(project.mcpConfigPath, '{"mcpServers":{"changed":{"command":"false"}}}');

    const outcome = await provider.generate(request, {
      signal: new AbortController().signal,
      policy: {
        profileVersion: 'claude-cli-2.1.265-planrepo-v2', timeoutMs: 300_000,
        stdoutMaxBytes: 4_194_304, stderrMaxBytes: 262_144, normalizedResultMaxBytes: 2_097_152,
      },
      execution: { launchRef: 'launch-owned-mcp', cwd: project.runDir },
    });

    const mcpIndex = captured?.args.indexOf('--mcp-config') ?? -1;
    const ownedMcpPath = captured?.args[mcpIndex + 1];
    expect(ownedMcpPath).toBe(resolve(project.runDir, 'mcp-empty.json'));
    expect(readFileSync(ownedMcpPath!, 'utf8')).toBe('{"mcpServers":{}}');
    expect(outcome).toMatchObject({ kind: 'completed' });
  });

  it('builds the fixed argv as distinct values and filters the inherited environment', () => {
    const { request } = providerFixture();
    const project = providerProject();
    const profile = buildClaudeLaunchProfile({
      selection: request.selection,
      mcpConfig: approvedMcp(project),
      tmpDir: project.runDir,
      sourceEnvironment: {
        HOME: '/home/demo', PATH: '/bin', CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'demo',
        NODE_OPTIONS: '--require attacker', NODE_PATH: '/private/modules', PLANREPO_DB_PATH: '/private/data.sqlite',
        BUSINESS_TOKEN: 'CANARY_BUSINESS_TOKEN', RANDOM_VALUE: 'drop-me',
      },
    });

    expect(profile.executable).toBe('claude');
    expect(profile.args).toEqual([
      '--print', '--input-format', 'text', '--output-format', 'json',
      '--model', 'global.anthropic.claude-opus-4-8',
      '--tools', '', '--disallowedTools', 'mcp__*',
      '--strict-mcp-config', '--mcp-config', resolve(project.runDir, 'mcp-empty.json'),
      '--no-session-persistence', '--disable-slash-commands', '--no-chrome',
      '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
      '--settings', '{"disableAllHooks":true}', '--system-prompt', FIXED_SYSTEM_PROMPT,
    ]);
    expect(FIXED_SYSTEM_PROMPT).toContain('suggestedAssigneeId');
    expect(FIXED_SYSTEM_PROMPT).toContain('VersionRef');
    expect(FIXED_SYSTEM_PROMPT).toContain('ARTIFACT_REVISION');
    expect(profile.env).toMatchObject({
      HOME: '/home/demo', PATH: '/bin', CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'demo',
      TMPDIR: project.runDir, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    });
    expect(profile.env).not.toHaveProperty('NODE_OPTIONS');
    expect(profile.env).not.toHaveProperty('NODE_PATH');
    expect(profile.env).not.toHaveProperty('PLANREPO_DB_PATH');
    expect(profile.env).not.toHaveProperty('BUSINESS_TOKEN');
    expect(profile.env).not.toHaveProperty('RANDOM_VALUE');
  });

  it('omits model argv only for installed_default and keeps an internally selected explicit model fixed', () => {
    const project = providerProject();
    const base = {
      mcpConfig: approvedMcp(project),
      tmpDir: project.runDir,
      sourceEnvironment: { HOME: '/home/demo', PATH: '/bin' },
    };
    expect(buildClaudeLaunchProfile({
      ...base, selection: { providerId: 'claude-cli', modelChoice: { kind: 'installed_default' } },
    }).args).not.toContain('--model');
    expect(() => buildClaudeLaunchProfile({
      ...base, selection: { providerId: 'test', modelChoice: { kind: 'installed_default' } },
    })).toThrow(/provider/u);
    expect(buildClaudeLaunchProfile({
      ...base,
      selection: { providerId: 'claude-cli', modelChoice: { kind: 'explicit', modelId: 'internal-approved-model' } },
    }).args).toContain('internal-approved-model');
    expect(() => buildClaudeLaunchProfile({
      ...base,
      selection: { providerId: 'claude-cli', modelChoice: { kind: 'explicit', modelId: '' } },
    })).toThrow(/model/u);
    expect(() => buildClaudeLaunchProfile({
      ...base, sourceEnvironment: { HOME: '/home/demo' },
      selection: { providerId: 'claude-cli', modelChoice: { kind: 'installed_default' } },
    })).toThrow(/HOME.*PATH/u);
  });

  it('keeps the checked-in MCP and launch policy declarative without a pre-made success flag', () => {
    const root = resolve(import.meta.dirname, '../..');
    expect(readFileSync(resolve(root, 'config/claude/mcp-empty.json'), 'utf8').trim()).toBe('{"mcpServers":{}}');
    const policy = JSON.parse(readFileSync(resolve(root, 'config/claude/launch-policy.json'), 'utf8')) as Record<string, unknown>;
    expect(policy).toMatchObject({
      profileVersion: 'claude-cli-2.1.265-planrepo-v2',
      profileFingerprint: CLAUDE_PROFILE_FINGERPRINT,
      approvedCliCandidate: '2.1.265',
      executable: 'claude',
    });
    expect(policy.inheritedEnvironmentNames).toEqual(CLAUDE_INHERITED_ENVIRONMENT_NAMES);
    expect(Object.keys(policy).some((key) => /success|eligible|verified/u.test(key))).toBe(false);
  });

  it('accepts the exact decision and artifact DTOs and rejects extra authority fields', () => {
    const { request, closedProcess } = providerFixture();
    const sourceRef = validQuestionResult().proposals[0].sourceRefs[0]!;
    const encode = (result: unknown) => Buffer.from(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(result),
    }));
    const decisionRequest = proposalRequest(request, 'DECISION_PROPOSALS');
    const decision = {
      schemaVersion: 1,
      kind: 'decision_proposals',
      proposals: [{
        temporaryId: 'decision-1', prompt: '배포 방식을 선택합니다.',
        alternatives: [{ optionId: 'gradual', label: '점진 배포', description: '단계별로 배포합니다.' }],
        impact: '배포 위험이 달라집니다.', recommendation: '점진 배포', sourceRefs: [sourceRef],
      }],
    };
    expect(decodeClaudeResult({ request: decisionRequest, process: closedProcess, stdout: encode(decision) })).toMatchObject({
      kind: 'completed', result: { kind: 'decision_proposals' },
    });

    const artifactRequest = {
      ...request,
      taskKind: 'ARTIFACT_DRAFT' as const,
      documentKind: 'requirements' as const,
      snapshot: {
        ...request.snapshot,
        taskKind: 'ARTIFACT_DRAFT' as const,
        documentKind: 'requirements' as const,
        targetBasis: { kind: 'absent' as const, logicalKey: 'requirements' },
      },
    };
    const artifact = {
      schemaVersion: 1, kind: 'artifact', documentKind: 'requirements', markdown: '# 요구사항',
      requirementRefs: ['REQ-1'], changeSummary: '초안 작성',
    };
    expect(decodeClaudeResult({ request: artifactRequest, process: closedProcess, stdout: encode(artifact) })).toMatchObject({
      kind: 'completed', result: { kind: 'artifact', documentKind: 'requirements' },
    });
    expect(decodeClaudeResult({
      request: artifactRequest,
      process: closedProcess,
      stdout: encode({ ...artifact, claimRef: { ownershipToken: 'CANARY_AUTHORITY' } }),
    })).toMatchObject({ kind: 'failed', failure: { code: 'INVALID_OUTPUT' } });
  });

  it('passes the frozen request through stdin and the constrained runtime spec to the runner', async () => {
    const { request, closedProcess } = providerFixture();
    const project = providerProject();
    const stdout = Buffer.from(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(validQuestionResult()),
    }));
    let captured: ControlledProcessSpec | undefined;
    let stops = 0;
    const result: ProcessResult = { ...closedProcess, stdout, metrics: { ...closedProcess.metrics, stdoutBytes: stdout.byteLength } };
    const runner = {
      start(spec: ControlledProcessSpec): OwnedExecution {
        captured = spec;
        return {
          result: Promise.resolve(result),
          requestStop: () => { stops += 1; },
          getObservationState: () => ({ kind: 'Pending', launchRef: spec.launchRef }),
        };
      },
    };
    const controller = new AbortController();
    const provider = createClaudeCliProvider({
      runner,
      projectRoot: project.root,
      mcpConfigPath: project.mcpConfigPath,
      sourceEnvironment: { HOME: '/home/demo', PATH: '/bin' },
      cliVersion: '2.1.265',
    });
    const policy = {
      profileVersion: 'claude-cli-2.1.265-planrepo-v2',
      timeoutMs: 300_000 as const,
      stdoutMaxBytes: 4_194_304 as const,
      stderrMaxBytes: 262_144 as const,
      normalizedResultMaxBytes: 2_097_152 as const,
    };
    const generating = provider.generate(request, {
      signal: controller.signal,
      policy,
      execution: { launchRef: 'launch-provider-1', cwd: project.runDir },
    });
    (request.snapshot.contents as unknown as Array<{ content: string }>)[0]!.content = 'mutated after start';
    controller.abort();
    const outcome = await generating;

    expect(captured).toMatchObject({
      executable: 'claude',
      launchRef: 'launch-provider-1',
      cwd: project.runDir,
      limits: { timeoutMs: 300_000, stdoutMaxBytes: 4_194_304, stderrMaxBytes: 262_144 },
    });
    expect(captured?.stdinBytes.toString('utf8')).toContain('확인된 가상 원문');
    expect(captured?.stdinBytes.toString('utf8')).not.toContain('mutated after start');
    expect(stops).toBe(1);
    expect(outcome).toMatchObject({ kind: 'completed', execution: { cliVersion: '2.1.265' } });
  });

  it('rejects a changed execution policy before spawn and maps sanitized process failure metrics', async () => {
    const { request } = providerFixture();
    const project = providerProject();
    let starts = 0;
    const failedProcess: ProcessResult = {
      kind: 'Failure',
      code: 'TIMEOUT',
      metrics: {
        startedAt: '2026-09-09T00:00:00.000Z',
        finishedAt: '2026-09-09T00:05:00.001Z',
        stdoutBytes: 101,
        stderrBytes: 17,
        stdoutClosed: false,
        stderrClosed: false,
      },
    };
    const runner = {
      start(spec: ControlledProcessSpec): OwnedExecution {
        starts += 1;
        return {
          result: Promise.resolve(failedProcess),
          requestStop: () => undefined,
          getObservationState: () => ({ kind: 'Pending', launchRef: spec.launchRef }),
        };
      },
    };
    const provider = createClaudeCliProvider({
      runner,
      projectRoot: project.root,
      mcpConfigPath: project.mcpConfigPath,
      sourceEnvironment: { HOME: '/home/demo', PATH: '/bin' },
      cliVersion: '2.1.265',
      now: () => new Date('2026-09-09T00:00:00.000Z'),
    });
    const baseControl = {
      signal: new AbortController().signal,
      policy: {
        profileVersion: 'changed-profile',
        timeoutMs: 300_000 as const,
        stdoutMaxBytes: 4_194_304 as const,
        stderrMaxBytes: 262_144 as const,
        normalizedResultMaxBytes: 2_097_152 as const,
      },
      execution: { launchRef: 'launch-provider-2', cwd: project.runDir },
    };
    await expect(provider.generate(request, baseControl)).resolves.toMatchObject({
      kind: 'failed', failure: { code: 'POLICY_CONFLICT' }, execution: { stdoutBytes: 0, stdoutClosed: false },
    });
    expect(starts).toBe(0);

    const outcome = await provider.generate(request, {
      ...baseControl,
      policy: { ...baseControl.policy, profileVersion: 'claude-cli-2.1.265-planrepo-v2' },
    });
    expect(starts).toBe(1);
    expect(outcome).toMatchObject({
      kind: 'failed',
      failure: { code: 'TIMEOUT' },
      execution: {
        startedAt: '2026-09-09T00:00:00.000Z',
        finishedAt: '2026-09-09T00:05:00.001Z',
        stdoutBytes: 101,
        stderrBytes: 17,
        stdoutClosed: false,
        stderrClosed: false,
      },
    });
  });

  it('does not spawn an already-aborted request and publishes no_process_created', async () => {
    const { request } = providerFixture();
    const project = providerProject();
    let starts = 0;
    const observations: unknown[] = [];
    const provider = createClaudeCliProvider({
      runner: { start() { starts += 1; throw new Error('must not start'); } },
      projectRoot: project.root,
      mcpConfigPath: project.mcpConfigPath,
      sourceEnvironment: { HOME: '/home/demo', PATH: '/bin' },
      cliVersion: '2.1.265',
      observer: (state) => observations.push(state),
      now: () => new Date('2026-09-09T00:00:00.000Z'),
    });
    const controller = new AbortController();
    controller.abort();

    await expect(provider.generate(request, {
      signal: controller.signal,
      policy: {
        profileVersion: 'claude-cli-2.1.265-planrepo-v2',
        timeoutMs: 300_000,
        stdoutMaxBytes: 4_194_304,
        stderrMaxBytes: 262_144,
        normalizedResultMaxBytes: 2_097_152,
      },
      execution: { launchRef: 'launch-cancelled-before-start', cwd: project.runDir },
    })).resolves.toMatchObject({ kind: 'failed', failure: { code: 'CANCELLED' } });
    expect(starts).toBe(0);
    expect(observations).toContainEqual(expect.objectContaining({
      kind: 'Confirmed', launchRef: 'launch-cancelled-before-start',
      result: expect.objectContaining({ kind: 'no_process_created' }),
    }));
  });

  it('snapshots the CLI version and MCP path when the provider factory is created', async () => {
    const { request, closedProcess } = providerFixture();
    const project = providerProject();
    const stdout = Buffer.from(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(validQuestionResult()),
    }));
    let captured: ControlledProcessSpec | undefined;
    const options = {
      runner: {
        start(spec: ControlledProcessSpec): OwnedExecution {
          captured = spec;
          return {
            result: Promise.resolve({
              ...closedProcess, stdout, metrics: { ...closedProcess.metrics, stdoutBytes: stdout.byteLength },
            }),
            requestStop: () => undefined,
            getObservationState: () => ({ kind: 'Pending' as const, launchRef: spec.launchRef }),
          };
        },
      },
      projectRoot: project.root,
      mcpConfigPath: project.mcpConfigPath,
      sourceEnvironment: { HOME: '/home/demo', PATH: '/bin' },
      cliVersion: '2.1.265',
    };
    const provider = createClaudeCliProvider(options);
    options.mcpConfigPath = '/attacker/changed.json';
    options.cliVersion = '999.0.0';
    const outcome = await provider.generate(request, {
      signal: new AbortController().signal,
      policy: {
        profileVersion: 'claude-cli-2.1.265-planrepo-v2', timeoutMs: 300_000,
        stdoutMaxBytes: 4_194_304, stderrMaxBytes: 262_144, normalizedResultMaxBytes: 2_097_152,
      },
      execution: { launchRef: 'launch-snapshot', cwd: project.runDir },
    });

    expect(captured?.args).toContain(resolve(project.runDir, 'mcp-empty.json'));
    expect(captured?.args).not.toContain('/attacker/changed.json');
    expect(outcome).toMatchObject({ kind: 'completed', execution: { cliVersion: '2.1.265' } });
  });
});
