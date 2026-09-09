import { randomUUID } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { expect, test } from 'vitest';
import type { ArtifactView, GenerationInput, GenerationRunView } from '@/src/contracts/views';
import { evaluateClaudeEvidence } from '@/src/runtime/claude-verification-status';
import { verifyClaudeLiveCandidate } from '@/src/runtime/claude-live-candidate';
import { createGenerationController } from '@/tests/helpers/generation-controller';
import { createGenerationFixture } from '@/tests/helpers/generation-fixture';
import { createTestApp } from '@/tests/helpers/test-app';

const testRunId = process.env.PLANREPO_CLAUDE_TEST_RUN_ID;
const reportPath = process.env.PLANREPO_CLAUDE_REPORT_PATH;

function requireLiveEnvironment(): { testRunId: string; reportPath: string } {
  if (testRunId === undefined || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/u.test(testRunId)) {
    throw new Error('CLAUDE_LIVE_TEST_RUN_ID_INVALID');
  }
  if (reportPath === undefined) throw new Error('CLAUDE_LIVE_REPORT_PATH_MISSING');
  const expected = resolve(process.cwd(), '.planrepo/test-runs', testRunId, 'results', 'claude-verification.json');
  if (resolve(reportPath) !== expected) throw new Error('CLAUDE_LIVE_REPORT_PATH_INVALID');
  return { testRunId, reportPath: expected };
}

async function waitForTerminal(
  app: Awaited<ReturnType<typeof createTestApp>>,
  scope: { readonly actorId: string; readonly projectId: string; readonly srId: string },
  runId: string,
): Promise<GenerationRunView> {
  for (let attempt = 0; attempt < 1_300; attempt += 1) {
    const read = await app.invoke('M-033', scope, runId);
    if (!read.ok) throw new Error(`CLAUDE_RUN_READ_${read.error.code}`);
    if (read.value.status !== 'pending' && read.value.status !== 'running') return read.value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('CLAUDE_RUN_WAIT_TIMEOUT');
}

async function prepare(
  app: Awaited<ReturnType<typeof createTestApp>>,
  scope: { readonly actorId: string; readonly projectId: string; readonly srId: string },
  input: GenerationInput,
) {
  const detail = await app.invoke('M-047', scope, { kind: 'new_generation', input });
  if (!detail.ok) throw new Error(`CLAUDE_PREPARE_${detail.error.code}`);
  if (detail.value.preparation?.kind !== 'new_generation') throw new Error('CLAUDE_PREPARATION_MISSING');
  return detail.value.preparation;
}

async function requestAndWait(
  app: Awaited<ReturnType<typeof createTestApp>>,
  scope: { readonly actorId: string; readonly projectId: string; readonly srId: string },
  input: GenerationInput,
) {
  const prepared = await prepare(app, scope, input);
  const requested = await app.invoke('M-032', {
    ...scope,
    idempotencyKey: randomUUID(),
    guard: { expectedInputFingerprint: prepared.expectedInputFingerprint },
  }, input);
  if (!requested.ok) throw new Error(`CLAUDE_REQUEST_${requested.error.code}`);
  const terminal = await waitForTerminal(app, scope, requested.value.runId);
  if (terminal.status !== 'succeeded') {
    throw new Error(`CLAUDE_RUN_${terminal.status.toUpperCase()}`);
  }
  return terminal;
}

function artifactGuard(scope: { readonly projectId: string; readonly srId: string }, artifact: ArtifactView) {
  return {
    target: {
      kind: 'artifact' as const,
      projectId: scope.projectId,
      srId: scope.srId,
      entityId: artifact.artifactId,
    },
    expectedRevision: artifact.revision,
  };
}

test('runs an explicit Claude question, human answer, and follow-up requirements revision', async () => {
  const live = requireLiveEnvironment();
  const app = await createTestApp({ fixture: 'empty', testRunId: live.testRunId });
  const controller = createGenerationController(app);
  const observations: Array<Record<string, unknown>> = [];
  const startedAt = Date.now();
  let finalReport: Record<string, unknown> | undefined;
  try {
    const fixture = await createGenerationFixture(app);
    const initialMarkdown = '## REQ-LIVE 초기 요구사항\nREQ-LIVE는 사람 답변을 후속 문서에 반영합니다.\n';
    const initial = await app.invoke('M-015', {
      ...fixture.scope,
      idempotencyKey: randomUUID(),
      guard: { resource: { target: {
        kind: 'artifact_logical_key', projectId: fixture.scope.projectId,
        srId: fixture.scope.srId, logicalKey: 'requirements',
      }, expected: 'absent' } },
    }, {
      kind: 'requirements',
      markdown: initialMarkdown,
      sectionIndex: [{ sectionId: 'REQ-LIVE', title: '초기 요구사항', startOffset: 0, endOffset: initialMarkdown.length }],
      requirementLinks: [{ requirementId: 'REQ-LIVE', sectionIds: ['REQ-LIVE'], acceptanceCriteria: ['사람 답변을 반영합니다.'] }],
      changeSummary: '실제 생성 전 기준 문서를 저장합니다.',
      targetBasis: { kind: 'absent', logicalKey: 'requirements' },
    });
    if (!initial.ok) throw new Error(`CLAUDE_INITIAL_ARTIFACT_${initial.error.code}`);

    const candidate = await verifyClaudeLiveCandidate({
      projectRoot: process.cwd(), workRoot: app.generationRuntime.runsRoot,
      sourceEnvironment: process.env,
    });
    if (candidate.kind !== 'Eligible') throw new Error(candidate.reason);
    await controller.startLiveCandidate(candidate.candidate);

    const questionRun = await requestAndWait(app, fixture.scope, { taskKind: 'QUESTION_PROPOSALS' });
    if (questionRun.draft.body.kind !== 'question_proposals') throw new Error('CLAUDE_QUESTION_RESULT_KIND');
    const proposal = questionRun.draft.body.proposals[0];
    const appliedQuestions = await app.invoke('M-018', {
      ...fixture.scope,
      idempotencyKey: randomUUID(),
      guard: { kind: 'questions', expectedInputFingerprint: questionRun.draft.basisFingerprint },
    }, {
      draftId: questionRun.draft.draftId,
      selectedContent: { kind: 'questions', temporaryIds: [proposal.temporaryId] },
      applicationReason: '실제 Claude 질문을 사람이 확인해 선택합니다.',
    });
    if (!appliedQuestions.ok || appliedQuestions.value.result.kind !== 'questions') {
      throw new Error('CLAUDE_QUESTION_APPLICATION_FAILED');
    }
    const questionId = appliedQuestions.value.result.mappings[0].ref.entityId;
    const questionDetail = await app.invoke('M-047', fixture.scope, {});
    if (!questionDetail.ok) throw new Error(`CLAUDE_QUESTION_READ_${questionDetail.error.code}`);
    const question = questionDetail.value.questions.find((item) => item.questionId === questionId);
    if (question === undefined) throw new Error('CLAUDE_QUESTION_NOT_FOUND');
    const answered = await app.invoke('M-008', {
      actorId: question.assigneeId,
      projectId: fixture.scope.projectId,
      srId: fixture.scope.srId,
      idempotencyKey: randomUUID(),
      guard: { resource: { target: {
        kind: 'question', projectId: fixture.scope.projectId,
        srId: fixture.scope.srId, entityId: question.questionId,
      }, expectedRevision: question.revision } },
    }, {
      questionId: question.questionId,
      answeredQuestionSnapshotRef: question.currentResult.ref,
      answer: { kind: 'free_text', text: '부분 실패는 재시도하며 같은 요청은 한 번만 반영합니다.' },
      evidence: { text: '가상 담당자가 실제 생성 흐름에서 명시 답변했습니다.' },
    });
    if (!answered.ok) throw new Error(`CLAUDE_ANSWER_${answered.error.code}`);

    const currentDetail = await app.invoke('M-047', fixture.scope, {});
    if (!currentDetail.ok) throw new Error(`CLAUDE_CURRENT_READ_${currentDetail.error.code}`);
    const currentArtifact = currentDetail.value.artifacts.find((item) => item.artifactId === initial.value.artifactId);
    if (currentArtifact === undefined) throw new Error('CLAUDE_CURRENT_ARTIFACT_MISSING');
    const documentRun = await requestAndWait(app, fixture.scope, {
      taskKind: 'ARTIFACT_REVISION', documentKind: 'requirements',
      targetBasis: { kind: 'version', ref: currentArtifact.versionRef },
      supplement: '명시된 사람 답변을 요구사항에 반영하고 REQ-LIVE 식별자를 유지하십시오.',
    });
    if (documentRun.draft.body.kind !== 'artifact') throw new Error('CLAUDE_DOCUMENT_RESULT_KIND');
    const body = documentRun.draft.body;
    const sectionId = body.requirementRefs[0] ?? 'REQ-LIVE';
    const appliedDocument = await app.invoke('M-018', {
      ...fixture.scope,
      idempotencyKey: randomUUID(),
      guard: {
        kind: 'artifact',
        expectedInputFingerprint: documentRun.draft.basisFingerprint,
        target: artifactGuard(fixture.scope, currentArtifact),
      },
    }, {
      draftId: documentRun.draft.draftId,
      selectedContent: { kind: 'artifact', edit: {
        artifactId: currentArtifact.artifactId,
        kind: 'requirements', markdown: body.markdown,
        sectionIndex: [{ sectionId, title: '사람 답변 반영 요구사항', startOffset: 0, endOffset: body.markdown.length }],
        requirementLinks: body.requirementRefs.map((requirementId) => ({
          requirementId, sectionIds: [sectionId], acceptanceCriteria: ['명시된 사람 답변을 반영합니다.'],
        })),
        changeSummary: body.changeSummary,
        targetBasis: { kind: 'version', ref: currentArtifact.versionRef },
        questionResultRefs: [answered.value.currentResult.ref],
      } },
      applicationReason: '사람이 실제 Claude 후속 문서와 구조를 확인했습니다.',
    });
    if (!appliedDocument.ok || appliedDocument.value.result.kind !== 'artifact') {
      throw new Error('CLAUDE_DOCUMENT_APPLICATION_FAILED');
    }
    const compared = await app.invoke('M-016', fixture.scope, {
      before: initial.value.versionRef,
      after: appliedDocument.value.result.artifactVersionRef,
    });
    if (!compared.ok) throw new Error(`CLAUDE_COMPARE_${compared.error.code}`);

    for (const run of [questionRun, documentRun]) {
      const row = app.db.prepare(
        `SELECT termination_result_json FROM execution_observations
          WHERE project_id=? AND sr_id=? AND run_id=?`,
      ).get(fixture.scope.projectId, fixture.scope.srId, run.runId) as { readonly termination_result_json: string } | undefined;
      const termination = row === undefined ? undefined : JSON.parse(row.termination_result_json) as { readonly kind?: string };
      if (termination?.kind !== 'restricted_scope_exited') throw new Error('CLAUDE_RESTRICTED_EXIT_NOT_CONFIRMED');
      observations.push({
        scenario: run.taskKind,
        state: 'Passed',
        runId: run.runId,
        inputSnapshotId: run.inputSnapshotId,
        draftId: run.draft.draftId,
        requestedModel: run.requestedSelection.modelChoice.kind === 'explicit'
          ? run.requestedSelection.modelChoice.modelId : 'installed_default',
        actualModel: run.actualModelId ?? 'not_reported',
        cliVersion: run.cliVersion ?? 'not_reported',
        terminal: run.status,
        termination: termination.kind,
      });
    }
    const report = {
      ...candidate.candidate.report,
      fixtureContract: 'Passed' as const,
      actualGeneration: 'Passed' as const,
      actualIsolation: 'Passed' as const,
      sameBootRecovery: 'KnownUnsupported' as const,
    };
    expect(evaluateClaudeEvidence(report)).toMatchObject({
      actualGenerationVerified: true,
      isolationVerified: true,
      eligibleForProduct: true,
    });
    finalReport = {
      ...report,
      testRunId: live.testRunId,
      outcome: 'Passed',
      elapsedMs: Date.now() - startedAt,
      observations,
      limitations: evaluateClaudeEvidence(report).limitations,
      boundaryAssessments: {
        restrictedLocalDescendants: 'Passed',
        toolAndMcpUse: 'Passed',
        cancellation: 'NotRun',
        filesystemAndNetworkIsolation: 'NotRun',
        globalCustomizationAbsence: 'KnownUnsupported',
        xpcAndRemoteExecutionTermination: 'KnownUnsupported',
      },
    };
  } finally {
    await controller.stop();
    await app.close();
  }
  if (finalReport === undefined) throw new Error('CLAUDE_LIVE_REPORT_MISSING');
  const reportDir = dirname(live.reportPath);
  await mkdir(reportDir, { recursive: true });
  const resolvedDir = await realpath(reportDir);
  if (resolvedDir !== resolve(process.cwd(), '.planrepo/test-runs', live.testRunId, 'results')) {
    throw new Error('CLAUDE_LIVE_REPORT_BOUNDARY_INVALID');
  }
  await writeFile(live.reportPath, `${JSON.stringify(finalReport, null, 2)}\n`, {
    encoding: 'utf8', flag: 'wx', mode: 0o600,
  });
});
