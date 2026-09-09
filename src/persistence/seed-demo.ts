import { createHash } from 'node:crypto';
import manifestJson from '@/config/demo/manifest.json' with { type: 'json' };
import referenceMocksJson from '@/config/demo/reference-mocks.json' with { type: 'json' };
import scenariosJson from '@/config/demo/scenarios.json' with { type: 'json' };
import type { GateKind, ProgressStage } from '@/src/contracts/context';
import type { DatabaseConnection } from './database';
import { runOfflineMaintenance } from './maintenance';
import { BUSINESS_ENTITY_TABLES } from './migrations/0001-planrepo';

type JsonObject = Record<string, unknown>;

interface GateSeed {
  readonly reviewEpoch: number;
  readonly validity: 'not_passed' | 'valid' | 'invalid';
  readonly needsNewBundle: boolean;
  readonly bundle: boolean;
  readonly bundleEpoch?: number;
  readonly approval: boolean;
  readonly pass: boolean;
  readonly invalidated?: boolean;
}

interface ScenarioSeed {
  readonly key: keyof typeof manifestJson.srIds;
  readonly title: string;
  readonly purpose: string;
  readonly description: string;
  readonly revision: number;
  readonly artifacts: {
    readonly requirementsVersions: number;
    readonly includePlanning: boolean;
    readonly implementationPlanVersions?: number;
  };
  readonly gates: Readonly<Record<GateKind, GateSeed>>;
  readonly question?: (typeof scenariosJson.scenarios)[number]['question'];
  readonly decision?: (typeof scenariosJson.scenarios)[number]['decision'];
  readonly change?: (typeof scenariosJson.scenarios)[number]['change'];
  readonly handoff?: (typeof scenariosJson.scenarios)[number]['handoff'];
  readonly implementation?: (typeof scenariosJson.scenarios)[number]['implementation'];
}

interface VersionRef {
  readonly kind:
    | 'sr_description'
    | 'artifact'
    | 'question_result'
    | 'decision'
    | 'scope_classification'
    | 'review_assignment'
    | 'review_policy';
  readonly projectId: string;
  readonly srId?: string;
  readonly entityId: string;
  readonly version: number;
}

interface BundleRef {
  readonly projectId: string;
  readonly srId: string;
  readonly gate: GateKind;
  readonly bundleId: string;
  readonly version: number;
}

interface EntityRef {
  readonly kind: 'question' | 'decision' | 'approval';
  readonly projectId: string;
  readonly srId: string;
  readonly entityId: string;
}

interface PassRef {
  readonly kind: 'gate_pass';
  readonly projectId: string;
  readonly srId: string;
  readonly gate: GateKind;
  readonly transitionId: string;
}

const manifest = manifestJson;
const scenarios = scenariosJson.scenarios as readonly ScenarioSeed[];
const PROJECT_ID = manifest.projectId;
const OWNER_ID = manifest.personaIds['P-01'];
const REQUESTER_ID = manifest.personaIds['P-02'];
const REVIEWER_ID = manifest.personaIds['P-03'];
const DECISION_MAKER_ID = manifest.personaIds['P-04'];
const ADMIN_ID = manifest.personaIds['P-05'];
const POLICY_VERSION = 1;
const WORKFLOW_VERSION = 'v1.0.1';
const BASE_TIME = Date.parse('2026-09-09T00:00:00.000Z');

let timestampOffset = 0;

function nextTimestamp(): string {
  const value = new Date(BASE_TIME + timestampOffset * 1_000).toISOString();
  timestampOffset += 1;
  return value;
}

function revisedArtifactTimestamp(scenario: ScenarioSeed, kind: string, version: number): string | undefined {
  if (scenario.key === 'AUTH-331' && kind === 'implementation_plan' && version === 2) {
    return '2026-09-09T01:00:00.000Z';
  }
  if (scenario.key === 'CAT-093' && kind === 'requirements' && version === 2) {
    return '2026-09-09T02:00:00.000Z';
  }
  return undefined;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function insert(db: DatabaseConnection, table: string, values: Readonly<Record<string, unknown>>): void {
  const columns = Object.keys(values);
  const placeholders = columns.map(() => '?').join(', ');
  db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(...columns.map((column) => values[column]));
}

function versionRef(
  kind: Exclude<VersionRef['kind'], 'review_policy'>,
  srId: string,
  entityId: string,
  version: number,
): VersionRef {
  return { kind, projectId: PROJECT_ID, srId, entityId, version };
}

function policyRef(): VersionRef {
  return {
    kind: 'review_policy',
    projectId: PROJECT_ID,
    entityId: manifest.policyId,
    version: POLICY_VERSION,
  };
}

function bundleRef(srId: string, gate: GateKind): BundleRef {
  const ids = manifestEntityIds(srId);
  const configuredId = ids[`${gate.toLowerCase()}BundleId`];
  if (configuredId === undefined) throw new Error(`DEMO-4 manifest에 ${gate} bundle ID가 없습니다.`);
  return {
    projectId: PROJECT_ID,
    srId,
    gate,
    bundleId: configuredId,
    version: 1,
  };
}

function manifestEntityIds(srId: string): Readonly<Record<string, string>> {
  const entry = Object.entries(manifest.srIds).find(([, configuredSrId]) => configuredSrId === srId);
  if (entry === undefined) throw new Error(`DEMO-4 manifest에 SR ${srId}가 없습니다.`);
  return manifest.entityIds[entry[0] as keyof typeof manifest.entityIds];
}

function keySlug(srId: string): string {
  return srId.replace(/^sr-/, '');
}

function artifactId(srId: string, kind: 'requirements' | 'workflow_plan' | 'design' | 'implementation_plan'): string {
  return `artifact-${keySlug(srId)}-${kind.replaceAll('_', '-')}`;
}

function assignmentId(srId: string, gate: GateKind): string {
  return `assignment-${keySlug(srId)}-${gate.toLowerCase()}`;
}

function passId(srId: string, gate: GateKind): string {
  return `transition-${keySlug(srId)}-${gate.toLowerCase()}-passed`;
}

function passRef(srId: string, gate: GateKind): PassRef {
  return { kind: 'gate_pass', projectId: PROJECT_ID, srId, gate, transitionId: passId(srId, gate) };
}

function assertConfiguration(): void {
  if (manifest.seedId !== 'DEMO-4' || manifest.version !== '1') {
    throw new Error('DEMO-4 manifest 식별자가 올바르지 않습니다.');
  }
  const keys = scenarios.map((scenario) => scenario.key);
  if (new Set(keys).size !== 4 || Object.keys(manifest.srIds).some((key) => !keys.includes(key as ScenarioSeed['key']))) {
    throw new Error('DEMO-4 시나리오와 manifest SR이 일치하지 않습니다.');
  }
  if (referenceMocksJson.jira.length !== 4 || referenceMocksJson.jira.some((item) => !item.mock)) {
    throw new Error('DEMO-4 Jira mock 구성이 올바르지 않습니다.');
  }
  for (const scenario of scenarios) {
    const ids = manifest.entityIds[scenario.key] as Readonly<Record<string, string>>;
    const expected = {
      ...(scenario.question === undefined ? {} : { questionId: scenario.question.id }),
      ...(scenario.decision === undefined ? {} : { decisionId: scenario.decision.id }),
      ...(scenario.gates.G1.bundle ? { g1BundleId: `bundle-${scenario.key.toLowerCase()}-g1-v1` } : {}),
      ...(scenario.gates.G2.bundle ? { g2BundleId: `bundle-${scenario.key.toLowerCase()}-g2-v1` } : {}),
      ...(scenario.change === undefined ? {} : { changeRequestId: scenario.change.id }),
      ...(scenario.handoff === undefined ? {} : { handoffId: scenario.handoff.id }),
      ...(scenario.implementation === undefined ? {} : { implementationId: scenario.implementation.id }),
    };
    for (const [kind, id] of Object.entries(expected)) {
      if (ids[kind] !== id) throw new Error(`DEMO-4 manifest의 ${scenario.key}.${kind}가 시나리오와 다릅니다.`);
    }
  }
}

function assertBusinessStoreEmpty(db: DatabaseConnection): void {
  const completed = db.prepare('SELECT 1 FROM demo_seed_manifests WHERE seed_id=?').get(manifest.seedId);
  if (completed !== undefined) throw new Error('이미 DEMO-4 시드가 완료됐습니다.');

  for (const table of BUSINESS_ENTITY_TABLES) {
    const row = db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
    if (row !== undefined) throw new Error('업무 자료가 있는 DB에는 DEMO-4 시드를 넣을 수 없습니다.');
  }
}

function insertProjectAndPeople(db: DatabaseConnection): void {
  insert(db, 'workspace_projects', {
    project_id: PROJECT_ID,
    team_id: manifest.teamId,
    name: scenariosJson.project.name,
    revision: scenariosJson.project.revision,
    default_policy_id: manifest.policyId,
    default_policy_version: POLICY_VERSION,
    provider_config_id: null,
  });
  for (const persona of scenariosJson.personas) {
    insert(db, 'demo_user_memberships', {
      project_id: PROJECT_ID,
      user_id: manifest.personaIds[persona.persona as keyof typeof manifest.personaIds],
      display_name: persona.displayName,
      roles_json: json(persona.roles),
      revision: 1,
      demo: 1,
    });
  }
  insert(db, 'review_policy_versions', {
    project_id: PROJECT_ID,
    policy_id: manifest.policyId,
    version: POLICY_VERSION,
    gates_json: json(scenariosJson.policy.gates),
    require_all_assigned: 1,
    require_distinct_peer: 1,
    created_by: ADMIN_ID,
    created_at: nextTimestamp(),
    previous_version: null,
    change_reason: null,
    description: scenariosJson.policy.description,
  });
}

function insertSrAndDescription(db: DatabaseConnection, scenario: ScenarioSeed, srId: string): void {
  const descriptionId = `description-${keySlug(srId)}`;
  const createdAt = nextTimestamp();
  const mock = referenceMocksJson.jira.find((item) => item.key === scenario.key);
  if (mock === undefined) throw new Error(`DEMO-4 ${scenario.key} Jira mock이 없습니다.`);

  insert(db, 'srs', {
    project_id: PROJECT_ID,
    sr_id: srId,
    sr_key: scenario.key,
    owner_id: OWNER_ID,
    original_description_id: descriptionId,
    original_description_version: 1,
    current_description_id: descriptionId,
    current_description_version: 1,
    workflow_version: WORKFLOW_VERSION,
    implementation_unit_count: 1,
    progress_stage: manifest.initialStates[scenario.key] as ProgressStage,
    revision: scenario.revision,
    created_at: createdAt,
    updated_at: scenario.key === 'CAT-093'
      ? '2026-09-09T02:00:03.000Z'
      : scenario.key === 'AUTH-331'
        ? '2026-09-09T01:00:02.000Z'
        : nextTimestamp(),
    jira_key: mock.key,
    jira_url: mock.url,
    existing_system: 0,
    active_implementation_id: null,
  });
  insert(db, 'sr_description_versions', {
    project_id: PROJECT_ID,
    sr_id: srId,
    description_id: descriptionId,
    version: 1,
    title: scenario.title,
    purpose: scenario.purpose,
    description: scenario.description,
    author_id: OWNER_ID,
    created_at: createdAt,
    previous_version: null,
    change_reason: null,
    payload_json: json({
      jira: { key: mock.key, url: mock.url, status: mock.status, mock: true },
      source: 'DEMO-4',
    }),
  });
}

function artifactMarkdown(scenario: ScenarioSeed, kind: string, version: number): string {
  const requirementId = `REQ-${scenario.key}`;
  if (kind === 'requirements') {
    return `# ${scenario.key} 요구사항 v${version}\n\n## ${requirementId}\n${scenario.description}\n\n- 완료 기준: ${scenario.purpose}`;
  }
  if (kind === 'workflow_plan') {
    return `# ${scenario.key} 진행 계획\n\n## stage-design\n설계를 수행합니다.\n\n## task-implement\n${requirementId}을 구현하고 contract test로 검증합니다.`;
  }
  if (kind === 'design') {
    return `# ${scenario.key} 기능 설계\n\n## design-contract\n${requirementId}의 입력·상태·오류 계약을 정의합니다.`;
  }
  const authSection = scenario.key === 'AUTH-331'
    ? '\n\n## auth-error-contract\n계정 잠김과 공급자 오류의 계약을 구분합니다.'
    : '';
  return `# ${scenario.key} 구현 계획 v${version}\n\n## task-implement\n${requirementId}을 구현합니다.${authSection}\n\n## verify-contract\ncontract test로 검증합니다.`;
}

function sectionIndex(
  markdown: string,
  sections: readonly { readonly sectionId: string; readonly title: string }[],
): readonly { readonly sectionId: string; readonly title: string; readonly startOffset: number; readonly endOffset: number }[] {
  return sections.map((section, index) => {
    const startOffset = markdown.indexOf(`## ${section.sectionId}`);
    if (startOffset < 0) throw new Error(`DEMO-4 문서에 ${section.sectionId} section이 없습니다.`);
    const nextSection = sections[index + 1];
    const endOffset = nextSection === undefined
      ? markdown.length
      : markdown.indexOf(`## ${nextSection.sectionId}`, startOffset + 1);
    if (endOffset <= startOffset) throw new Error(`DEMO-4 문서의 ${section.sectionId} 범위가 올바르지 않습니다.`);
    return { ...section, startOffset, endOffset };
  });
}

function insertArtifactVersion(
  db: DatabaseConnection,
  scenario: ScenarioSeed,
  srId: string,
  kind: 'requirements' | 'workflow_plan' | 'design' | 'implementation_plan',
  version: number,
  currentVersion: number,
): void {
  const id = artifactId(srId, kind);
  const requirementId = `REQ-${scenario.key}`;
  const markdown = artifactMarkdown(scenario, kind, version);
  if (version === 1) {
    insert(db, 'artifacts', {
      project_id: PROJECT_ID,
      sr_id: srId,
      artifact_id: id,
      kind,
      current_version: currentVersion,
      revision: currentVersion,
      design_stage: kind === 'design' ? 'functional' : null,
      display_title: `${scenario.key} ${kind}`,
    });
  }
  const sectionDefinitions = kind === 'requirements'
    ? [{ sectionId: requirementId, title: scenario.title }]
    : kind === 'implementation_plan'
      ? [
          { sectionId: 'task-implement', title: '구현' },
          ...(scenario.key === 'AUTH-331'
            ? [{ sectionId: 'auth-error-contract', title: '인증 오류 계약' }]
            : []),
          { sectionId: 'verify-contract', title: '검증' },
        ]
      : kind === 'workflow_plan'
        ? [
            { sectionId: 'stage-design', title: '설계 단계' },
            { sectionId: 'task-implement', title: '구현 작업' },
          ]
        : [{ sectionId: 'design-contract', title: scenario.title }];
  const sections = sectionIndex(markdown, sectionDefinitions);
  const linkedSectionIds = kind === 'requirements'
    ? [requirementId]
    : kind === 'workflow_plan' || kind === 'implementation_plan'
      ? ['task-implement']
      : ['design-contract'];
  const payload: JsonObject = {
    sections,
    decisionRefs: [],
    sourceRefs: [],
    questionResultRefs: [],
  };
  if (kind === 'requirements') {
    payload.requirements = [{
      requirementId,
      statement: scenario.description,
      acceptanceCriteria: [{ criterionId: `AC-${scenario.key}-1`, text: scenario.purpose }],
    }];
  }
  if (kind === 'implementation_plan') {
    payload.tasks = [{
      taskId: 'task-implement',
      requirementIds: [requirementId],
      verificationIds: ['verify-contract'],
      order: 1,
    }];
    payload.verifications = [{ verificationId: 'verify-contract', method: 'contract test' }];
  }
  insert(db, 'artifact_versions', {
    project_id: PROJECT_ID,
    sr_id: srId,
    artifact_id: id,
    kind,
    version,
    markdown,
    section_index_json: json(sections),
    requirement_links_json: json([{
      requirementId,
      sectionIds: linkedSectionIds,
      acceptanceCriteria: [scenario.purpose],
    }]),
    author_origin: 'human',
    author_id: OWNER_ID,
    created_at: revisedArtifactTimestamp(scenario, kind, version) ?? nextTimestamp(),
    change_summary: version === 1 ? 'DEMO-4 최초 작성' : '검토 수정 요청 반영',
    previous_version: version === 1 ? null : version - 1,
    draft_application_id: null,
    input_snapshot_id: null,
    payload_json: json(payload),
  });
}

function insertArtifacts(db: DatabaseConnection, scenario: ScenarioSeed, srId: string): void {
  for (let version = 1; version <= scenario.artifacts.requirementsVersions; version += 1) {
    insertArtifactVersion(db, scenario, srId, 'requirements', version, scenario.artifacts.requirementsVersions);
  }
  if (!scenario.artifacts.includePlanning) return;

  insertArtifactVersion(db, scenario, srId, 'workflow_plan', 1, 1);
  insertArtifactVersion(db, scenario, srId, 'design', 1, 1);
  const planVersions = scenario.artifacts.implementationPlanVersions ?? 1;
  for (let version = 1; version <= planVersions; version += 1) {
    insertArtifactVersion(db, scenario, srId, 'implementation_plan', version, planVersions);
  }
  insert(db, 'workflow_plan_versions', {
    project_id: PROJECT_ID,
    sr_id: srId,
    artifact_id: artifactId(srId, 'workflow_plan'),
    artifact_kind: 'workflow_plan',
    version: 1,
    workflow_version: WORKFLOW_VERSION,
    stages_json: json([
      {
        stageId: 'functional_design',
        choice: 'executed',
        designArtifactRefs: [versionRef('artifact', srId, artifactId(srId, 'design'), 1)],
      },
      { stageId: 'nfr_requirements', choice: 'skipped', reason: 'DEMO-4 범위에 별도 NFR이 없습니다.' },
    ]),
    implementation_unit_count: 1,
    requirement_task_links_json: json([{
      taskId: 'task-implement',
      requirementIds: [`REQ-${scenario.key}`],
      verification: ['contract test와 기존 상태 전이를 검사합니다.'],
      order: 1,
    }]),
  });
}

function insertQuestionAndDecision(db: DatabaseConnection, scenario: ScenarioSeed, srId: string): void {
  const question = scenario.question;
  const decision = scenario.decision;
  if (question === undefined || decision === undefined) return;

  const questionTarget: EntityRef = { kind: 'question', projectId: PROJECT_ID, srId, entityId: question.id };
  const decisionTarget: EntityRef = { kind: 'decision', projectId: PROJECT_ID, srId, entityId: decision.id };
  for (const classification of [
    { id: question.classificationId, target: questionTarget, reason: question.reason },
    { id: decision.classificationId, target: decisionTarget, reason: decision.impact },
  ]) {
    insert(db, 'scope_classification_versions', {
      project_id: PROJECT_ID,
      sr_id: srId,
      classification_id: classification.id,
      version: 1,
      target_kind: classification.target.kind,
      target_id: classification.target.entityId,
      scope: 'current',
      required_gate: 'G1',
      reason: classification.reason,
      classified_by: OWNER_ID,
      classified_at: nextTimestamp(),
      previous_version: null,
      owner_id: null,
      revisit_at: null,
      revisit_event: null,
      payload_json: json({ targetRef: classification.target }),
    });
  }

  insert(db, 'questions', {
    project_id: PROJECT_ID,
    sr_id: srId,
    question_id: question.id,
    text: question.text,
    reason: question.reason,
    assignee_id: REQUESTER_ID,
    answer_mode: 'free_text',
    required_gate: question.requiredGate,
    classification_id: question.classificationId,
    classification_version: 1,
    status: question.status,
    current_result_version: question.resultVersion,
    revision: 1,
    created_at: nextTimestamp(),
    parent_question_id: null,
    converted_decision_id: null,
    payload_json: json({ relatedArtifactRefs: [versionRef('artifact', srId, artifactId(srId, 'requirements'), 1)] }),
  });
  insert(db, 'question_result_snapshots', {
    project_id: PROJECT_ID,
    sr_id: srId,
    question_id: question.id,
    version: question.resultVersion,
    text: question.text,
    reason: question.reason,
    assignee_id: REQUESTER_ID,
    answer_mode: 'free_text',
    options_json: '[]',
    status: question.status,
    classification_id: question.classificationId,
    classification_version: 1,
    evidence_refs_json: '[]',
    captured_at: nextTimestamp(),
    selected_answer_id: null,
    selected_answer_version: null,
    payload_json: json({
      classificationRef: versionRef('scope_classification', srId, question.classificationId, 1),
      candidateAnswers: [],
    }),
  });

  insert(db, 'decisions', {
    project_id: PROJECT_ID,
    sr_id: srId,
    decision_id: decision.id,
    prompt: decision.prompt,
    alternatives_json: json(decision.alternatives),
    impact: decision.impact,
    decision_maker_id: DECISION_MAKER_ID,
    classification_id: decision.classificationId,
    classification_version: 1,
    revision: 1,
    created_by: OWNER_ID,
    created_at: nextTimestamp(),
    current_confirmed_version: decision.version,
    origin_question_id: null,
    payload_json: json({ requiredGate: decision.requiredGate }),
  });
  insert(db, 'decision_versions', {
    project_id: PROJECT_ID,
    sr_id: srId,
    decision_id: decision.id,
    version: decision.version,
    prompt: decision.prompt,
    alternatives_json: json(decision.alternatives),
    impact: decision.impact,
    selected_option: decision.selectedOption,
    rationale: decision.rationale,
    evidence_json: json({ text: '데모 고객 지원 정책' }),
    decision_maker_id: DECISION_MAKER_ID,
    decided_at: nextTimestamp(),
    classification_id: decision.classificationId,
    classification_version: 1,
    previous_version: null,
    change_reason: null,
    payload_json: json({
      affectedRequirements: [`REQ-${scenario.key}`],
      artifactVersionRefs: [versionRef('artifact', srId, artifactId(srId, 'requirements'), 1)],
    }),
  });
}

function insertAssignments(db: DatabaseConnection, srId: string): void {
  for (const gate of ['G1', 'G2'] as const) {
    const id = assignmentId(srId, gate);
    insert(db, 'review_assignment_versions', {
      project_id: PROJECT_ID,
      sr_id: srId,
      gate,
      assignment_id: id,
      version: 1,
      assigned_by: ADMIN_ID,
      assigned_at: nextTimestamp(),
      previous_version: null,
      change_reason: null,
      description: `${gate} 동료 검토 배정`,
    });
    insert(db, 'review_assignment_reviewers', {
      project_id: PROJECT_ID,
      sr_id: srId,
      gate,
      assignment_id: id,
      assignment_version: 1,
      reviewer_id: REVIEWER_ID,
    });
  }
}

function bundleArtifactRefs(scenario: ScenarioSeed, srId: string, gate: GateKind): readonly VersionRef[] {
  if (gate === 'G1') {
    return [versionRef('artifact', srId, artifactId(srId, 'requirements'), 1)];
  }
  return [
    versionRef('artifact', srId, artifactId(srId, 'requirements'), 1),
    versionRef('artifact', srId, artifactId(srId, 'workflow_plan'), 1),
    versionRef('artifact', srId, artifactId(srId, 'design'), 1),
    versionRef('artifact', srId, artifactId(srId, 'implementation_plan'), 1),
  ];
}

function insertBundle(db: DatabaseConnection, scenario: ScenarioSeed, srId: string, gate: GateKind, gateSeed: GateSeed): void {
  const ref = bundleRef(srId, gate);
  const bundleEpoch = gateSeed.bundleEpoch ?? gateSeed.reviewEpoch;
  const assignment = versionRef('review_assignment', srId, assignmentId(srId, gate), 1);
  const decisionRefs = scenario.decision === undefined
    ? []
    : [versionRef('decision', srId, scenario.decision.id, scenario.decision.version)];
  const questionRefs = scenario.question === undefined
    ? []
    : [versionRef('question_result', srId, scenario.question.id, scenario.question.resultVersion)];
  const classificationRefs = scenario.question === undefined || scenario.decision === undefined
    ? []
    : [
        versionRef('scope_classification', srId, scenario.question.classificationId, 1),
        versionRef('scope_classification', srId, scenario.decision.classificationId, 1),
      ];
  const payload = {
    artifactVersionRefs: bundleArtifactRefs(scenario, srId, gate),
    decisionVersionRefs: decisionRefs,
    unconfirmedDecisionSnapshots: [],
    questionResultRefs: questionRefs,
    classificationRefs,
    contextSourceVersionRefs: [],
    assignmentRef: assignment,
    reviewerIds: [REVIEWER_ID],
    policyRef: policyRef(),
    descriptionRef: versionRef('sr_description', srId, `description-${keySlug(srId)}`, 1),
  };
  insert(db, 'review_bundles', {
    project_id: PROJECT_ID,
    sr_id: srId,
    gate,
    bundle_id: ref.bundleId,
    version: ref.version,
    review_epoch: bundleEpoch,
    assignment_id: assignment.entityId,
    assignment_version: assignment.version,
    policy_id: manifest.policyId,
    policy_version: POLICY_VERSION,
    checklist_json: json(scenariosJson.policy.gates[gate].checklist),
    created_by: OWNER_ID,
    created_at: nextTimestamp(),
    previous_bundle_id: null,
    previous_bundle_version: null,
    g1_gate: 'G1',
    g1_bundle_id: gate === 'G2' ? bundleRef(srId, 'G1').bundleId : null,
    g1_bundle_version: gate === 'G2' ? 1 : null,
    payload_json: json(payload),
  });

  const requestId = `request-${keySlug(srId)}-${gate.toLowerCase()}-v1`;
  const approvalId = `approval-${keySlug(srId)}-${gate.toLowerCase()}-v1`;
  insert(db, 'review_requests', {
    project_id: PROJECT_ID,
    sr_id: srId,
    request_id: requestId,
    gate,
    bundle_id: ref.bundleId,
    bundle_version: ref.version,
    review_epoch: bundleEpoch,
    reviewer_id: REVIEWER_ID,
    request_kind: 'peer_review',
    requested_by: OWNER_ID,
    requested_at: nextTimestamp(),
    status: gateSeed.approval ? 'handled' : 'pending',
    revision: gateSeed.approval ? 2 : 1,
    superseded_by_request_id: null,
    result_ref_json: gateSeed.approval
      ? json({ kind: 'approval', projectId: PROJECT_ID, srId, entityId: approvalId })
      : null,
    handled_at: gateSeed.approval ? nextTimestamp() : null,
    payload_json: json({ bundleRef: ref }),
  });
  if (!gateSeed.approval) return;

  const checklistResults = scenariosJson.policy.gates[gate].checklist.map((item) => ({
    itemId: item.itemId,
    checked: true,
  }));
  insert(db, 'approvals', {
    project_id: PROJECT_ID,
    sr_id: srId,
    approval_id: approvalId,
    gate,
    bundle_id: ref.bundleId,
    bundle_version: ref.version,
    review_epoch: bundleEpoch,
    policy_id: manifest.policyId,
    policy_version: POLICY_VERSION,
    checklist_results_json: json(checklistResults),
    approver_id: REVIEWER_ID,
    approval_scope: gate,
    result: 'approved',
    approved_at: nextTimestamp(),
    comment: `${gate} 데모 승인`,
  });
  if (!gateSeed.pass) return;

  insert(db, 'gate_transition_records', {
    project_id: PROJECT_ID,
    sr_id: srId,
    transition_id: passId(srId, gate),
    gate,
    review_epoch: bundleEpoch,
    kind: 'passed',
    actor_kind: 'user',
    actor_id: OWNER_ID,
    occurred_at: nextTimestamp(),
    affected_version_refs_json: json(bundleArtifactRefs(scenario, srId, gate)),
    bundle_id: ref.bundleId,
    bundle_version: ref.version,
    payload_json: json({
      bundleRef: ref,
      assignmentRef: assignment,
      policyRef: policyRef(),
      approvalRefs: [{ kind: 'approval', projectId: PROJECT_ID, srId, entityId: approvalId }],
    }),
  });
}

function insertGateState(db: DatabaseConnection, scenario: ScenarioSeed, srId: string, gate: GateKind): void {
  const gateSeed = scenario.gates[gate];
  if (gateSeed.invalidated) {
    insert(db, 'gate_transition_records', {
      project_id: PROJECT_ID,
      sr_id: srId,
      transition_id: `transition-${keySlug(srId)}-${gate.toLowerCase()}-invalidated`,
      gate,
      review_epoch: gateSeed.reviewEpoch,
      kind: 'invalidated',
      actor_kind: 'user',
      actor_id: OWNER_ID,
      occurred_at: scenario.key === 'CAT-093'
        ? `2026-09-09T02:00:0${gate === 'G1' ? '1' : '2'}.000Z`
        : nextTimestamp(),
      affected_version_refs_json: json([
        versionRef('artifact', srId, artifactId(srId, 'requirements'), scenario.artifacts.requirementsVersions),
      ]),
      bundle_id: bundleRef(srId, gate).bundleId,
      bundle_version: 1,
      payload_json: json({
        previousPassRef: passRef(srId, gate),
        ...(gate === 'G1'
          ? { fromStage: 'implementing', toStage: 'requirements', productStageChanged: true }
          : { productStageChanged: false }),
        reason: gate === 'G1'
          ? '요구사항 v2가 승인된 기준을 변경해 제품 단계를 재검토로 돌렸습니다.'
          : 'G1 무효화로 종속 G2 기준도 무효화했습니다.',
      }),
    });
  }

  const keepsInvalidBundle = gateSeed.validity === 'invalid' && gateSeed.bundle;
  const hasCurrentBundle = gateSeed.bundle && (!gateSeed.needsNewBundle || keepsInvalidBundle);
  insert(db, 'review_gate_states', {
    project_id: PROJECT_ID,
    sr_id: srId,
    gate,
    review_epoch: gateSeed.reviewEpoch,
    needs_new_bundle: gateSeed.needsNewBundle ? 1 : 0,
    validity: gateSeed.validity,
    revision: gateSeed.reviewEpoch,
    policy_id: manifest.policyId,
    policy_version: POLICY_VERSION,
    assignment_id: assignmentId(srId, gate),
    assignment_version: 1,
    current_bundle_id: hasCurrentBundle ? bundleRef(srId, gate).bundleId : null,
    current_bundle_version: hasCurrentBundle ? 1 : null,
    last_pass_transition_id: gateSeed.pass ? passId(srId, gate) : null,
    impact_json: gateSeed.needsNewBundle
      ? json({
          reason: gateSeed.validity === 'invalid' ? 'requirements_changed' : 'change_request_applied',
          invalidationTransitionId: gateSeed.invalidated
            ? `transition-${keySlug(srId)}-${gate.toLowerCase()}-invalidated`
            : null,
          changedVersionRefs: [
            versionRef(
              'artifact',
              srId,
              artifactId(srId, gateSeed.validity === 'invalid' ? 'requirements' : 'implementation_plan'),
              gateSeed.validity === 'invalid'
                ? scenario.artifacts.requirementsVersions
                : (scenario.artifacts.implementationPlanVersions ?? 1),
            ),
          ],
        })
      : null,
  });
}

function insertReviewGraph(db: DatabaseConnection, scenario: ScenarioSeed, srId: string): void {
  insertAssignments(db, srId);
  for (const gate of ['G1', 'G2'] as const) {
    const gateSeed = scenario.gates[gate];
    if (gateSeed.bundle) insertBundle(db, scenario, srId, gate, gateSeed);
  }
  for (const gate of ['G1', 'G2'] as const) insertGateState(db, scenario, srId, gate);
}

function insertChange(db: DatabaseConnection, scenario: ScenarioSeed, srId: string): void {
  const change = scenario.change;
  if (change === undefined) return;
  const artifact = artifactId(srId, 'implementation_plan');
  const currentRef = versionRef('artifact', srId, artifact, change.currentImplementationPlanVersion);
  const originalRef = versionRef('artifact', srId, artifact, change.originalImplementationPlanVersion);
  insert(db, 'change_requests', {
    project_id: PROJECT_ID,
    sr_id: srId,
    change_request_id: change.id,
    original_artifact_id: artifact,
    original_artifact_kind: 'implementation_plan',
    original_artifact_version: change.originalImplementationPlanVersion,
    original_section_id: change.sectionId,
    body: change.body,
    blocking: 1,
    affected_gate: 'G2',
    assignee_id: OWNER_ID,
    requester_id: REVIEWER_ID,
    status: 'awaiting_confirmation',
    current_target_json: json(currentRef),
    revision: 2,
    requested_at: nextTimestamp(),
    current_application_event_id: change.eventId,
    current_resolution_event_id: null,
    due_at: null,
    payload_json: json({ bundleRef: bundleRef(srId, 'G2'), originalArtifactVersionRef: originalRef }),
  });
  insert(db, 'change_request_events', {
    project_id: PROJECT_ID,
    sr_id: srId,
    change_request_id: change.id,
    event_id: change.eventId,
    kind: 'applied',
    actor_id: OWNER_ID,
    occurred_at: scenario.key === 'AUTH-331' ? '2026-09-09T01:00:01.000Z' : nextTimestamp(),
    before_status: 'open',
    after_status: 'awaiting_confirmation',
    target_artifact_id: artifact,
    target_artifact_kind: 'implementation_plan',
    target_artifact_version: change.currentImplementationPlanVersion,
    payload_json: json({
      originalArtifactVersionRef: originalRef,
      appliedArtifactVersionRef: currentRef,
      applicationSummary: change.applicationSummary,
      evidence: { text: '구현 계획 v2의 오류 처리 항목' },
    }),
  });
}

function insertHandoffAndImplementation(db: DatabaseConnection, scenario: ScenarioSeed, srId: string): void {
  const handoff = scenario.handoff;
  if (handoff === undefined) return;
  const g1 = bundleRef(srId, 'G1');
  const g2 = bundleRef(srId, 'G2');
  const contentRefs = bundleArtifactRefs(scenario, srId, 'G2');
  const approvalRefs = (['G1', 'G2'] as const).map((gate) => ({
    kind: 'approval' as const,
    projectId: PROJECT_ID,
    srId,
    entityId: `approval-${keySlug(srId)}-${gate.toLowerCase()}-v1`,
  }));
  const refs = {
    g1BundleRef: g1,
    g2BundleRef: g2,
    artifactVersionRefs: contentRefs,
    decisionVersionRefs: [],
    questionResultRefs: [],
    classificationRefs: [],
    approvalRefs,
    verificationCriteria: [{
      requirementId: `REQ-${scenario.key}`,
      verificationId: 'verify-contract',
      method: 'contract test',
    }],
    followupScope: [],
  };
  const validation = {
    g1PassRef: passRef(srId, 'G1'),
    g2PassRef: passRef(srId, 'G2'),
    policyRef: policyRef(),
    assignmentRefs: [
      versionRef('review_assignment', srId, assignmentId(srId, 'G1'), 1),
      versionRef('review_assignment', srId, assignmentId(srId, 'G2'), 1),
    ],
    checkedAt: nextTimestamp(),
  };
  const markdown = `# ${scenario.key} Handoff H1\n\nG1·G2 승인 기준과 구현·검증 참조를 고정합니다.`;
  insert(db, 'handoffs', {
    project_id: PROJECT_ID,
    sr_id: srId,
    handoff_id: handoff.id,
    version: handoff.version,
    g1_gate: 'G1',
    g1_bundle_id: g1.bundleId,
    g1_bundle_version: g1.version,
    g2_gate: 'G2',
    g2_bundle_id: g2.bundleId,
    g2_bundle_version: g2.version,
    refs_json: json(refs),
    workflow_version: WORKFLOW_VERSION,
    validation_json: json(validation),
    markdown_snapshot: markdown,
    digest: digest(markdown),
    created_by: OWNER_ID,
    created_at: nextTimestamp(),
    previous_handoff_id: null,
    previous_handoff_version: null,
    reason: 'DEMO-4 승인 기준 고정',
  });

  const implementation = scenario.implementation;
  if (implementation === undefined) return;
  const github = referenceMocksJson.github.find((item) => item.srKey === scenario.key);
  if (github === undefined) throw new Error(`DEMO-4 ${scenario.key} GitHub mock이 없습니다.`);
  insert(db, 'implementation_records', {
    project_id: PROJECT_ID,
    sr_id: srId,
    implementation_id: implementation.id,
    handoff_id: handoff.id,
    handoff_version: handoff.version,
    started_by: OWNER_ID,
    started_at: nextTimestamp(),
    status: implementation.status,
    revision: 1,
    manual: implementation.manual ? 1 : 0,
    completed_by: null,
    completed_at: null,
    completion_summary: null,
    evidence_json: null,
    payload_json: json({ externalRef: github, historicalStage: 'implementing' }),
  });
}

function insertActivityEvents(db: DatabaseConnection, scenario: ScenarioSeed, srId: string): void {
  const refs: unknown[] = [{ kind: 'sr', projectId: PROJECT_ID, srId, entityId: srId }];
  if (scenario.handoff !== undefined) refs.push(versionRef('artifact', srId, artifactId(srId, 'requirements'), 1));
  insert(db, 'activity_events', {
    project_id: PROJECT_ID,
    activity_id: `activity-${keySlug(srId)}-seeded`,
    sr_id: srId,
    event_type: 'demo_seeded',
    actor_kind: 'user',
    actor_id: OWNER_ID,
    target_refs_json: json(refs),
    occurred_at: nextTimestamp(),
    receipt_id: null,
    internal_basis_json: json({ seedId: manifest.seedId, seedVersion: manifest.version }),
    description: `${scenario.key} 데모 자료를 준비했습니다.`,
    payload_json: json({ initialStage: manifest.initialStates[scenario.key] }),
  });
}

function insertValidatedDemoGraph(db: DatabaseConnection): void {
  timestampOffset = 0;
  insertProjectAndPeople(db);
  for (const scenario of scenarios) {
    const srId = manifest.srIds[scenario.key];
    insertSrAndDescription(db, scenario, srId);
    insertArtifacts(db, scenario, srId);
    insertQuestionAndDecision(db, scenario, srId);
    insertReviewGraph(db, scenario, srId);
    insertChange(db, scenario, srId);
    insertHandoffAndImplementation(db, scenario, srId);
    insertActivityEvents(db, scenario, srId);
  }
  validateStoredGraph(db);
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) throw new Error('DEMO-4 시드 참조 검증: foreign key 위반이 있습니다.');
}

function parseObject(value: string, label: string): JsonObject {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`DEMO-4 시드 참조 검증: ${label}이 객체가 아닙니다.`);
  }
  return parsed as JsonObject;
}

function arrayField(value: JsonObject, key: string): readonly unknown[] {
  const field = value[key];
  if (!Array.isArray(field)) throw new Error(`DEMO-4 시드 참조 검증: ${key} 배열이 없습니다.`);
  return field;
}

function validateVersionRef(db: DatabaseConnection, raw: unknown, expectedSrId?: string): void {
  if (typeof raw !== 'object' || raw === null) throw new Error('DEMO-4 시드 참조 검증: version ref가 객체가 아닙니다.');
  const ref = raw as Partial<VersionRef>;
  if (ref.projectId !== PROJECT_ID || typeof ref.entityId !== 'string' || typeof ref.version !== 'number') {
    throw new Error('DEMO-4 시드 참조 검증: version ref 범위나 식별자가 올바르지 않습니다.');
  }
  if (ref.kind === 'review_policy') {
    const found = db.prepare(
      'SELECT 1 FROM review_policy_versions WHERE project_id=? AND policy_id=? AND version=?',
    ).get(ref.projectId, ref.entityId, ref.version);
    if (found === undefined) throw new Error('DEMO-4 시드 참조 검증: 정책 버전이 없습니다.');
    return;
  }
  if (typeof ref.srId !== 'string' || (expectedSrId !== undefined && ref.srId !== expectedSrId)) {
    throw new Error('DEMO-4 시드 참조 검증: SR version ref 범위가 다릅니다.');
  }
  const lookups: Partial<Record<VersionRef['kind'], [string, string]>> = {
    sr_description: ['sr_description_versions', 'description_id'],
    artifact: ['artifact_versions', 'artifact_id'],
    question_result: ['question_result_snapshots', 'question_id'],
    decision: ['decision_versions', 'decision_id'],
    scope_classification: ['scope_classification_versions', 'classification_id'],
    review_assignment: ['review_assignment_versions', 'assignment_id'],
  };
  const lookup = ref.kind === undefined ? undefined : lookups[ref.kind];
  if (lookup === undefined) throw new Error(`DEMO-4 시드 참조 검증: 지원하지 않는 version kind ${String(ref.kind)}입니다.`);
  const [table, idColumn] = lookup;
  const found = db.prepare(
    `SELECT 1 FROM ${table} WHERE project_id=? AND sr_id=? AND ${idColumn}=? AND version=?`,
  ).get(ref.projectId, ref.srId, ref.entityId, ref.version);
  if (found === undefined) throw new Error(`DEMO-4 시드 참조 검증: ${ref.kind} 버전이 없습니다.`);
}

function validateBundleRef(db: DatabaseConnection, raw: unknown, expectedSrId: string, expectedGate?: GateKind): BundleRef {
  if (typeof raw !== 'object' || raw === null) throw new Error('DEMO-4 시드 참조 검증: bundle ref가 객체가 아닙니다.');
  const ref = raw as Partial<BundleRef>;
  if (
    ref.projectId !== PROJECT_ID || ref.srId !== expectedSrId ||
    (ref.gate !== 'G1' && ref.gate !== 'G2') ||
    (expectedGate !== undefined && ref.gate !== expectedGate) ||
    typeof ref.bundleId !== 'string' || typeof ref.version !== 'number'
  ) {
    throw new Error('DEMO-4 시드 참조 검증: bundle ref 범위나 식별자가 올바르지 않습니다.');
  }
  const found = db.prepare(
    'SELECT 1 FROM review_bundles WHERE project_id=? AND sr_id=? AND gate=? AND bundle_id=? AND version=?',
  ).get(ref.projectId, ref.srId, ref.gate, ref.bundleId, ref.version);
  if (found === undefined) throw new Error('DEMO-4 시드 참조 검증: bundle이 없습니다.');
  return ref as BundleRef;
}

function validateEntityRef(db: DatabaseConnection, raw: unknown, expectedSrId: string, expectedKind: EntityRef['kind']): void {
  if (typeof raw !== 'object' || raw === null) throw new Error('DEMO-4 시드 참조 검증: entity ref가 객체가 아닙니다.');
  const ref = raw as Partial<EntityRef>;
  if (ref.kind !== expectedKind || ref.projectId !== PROJECT_ID || ref.srId !== expectedSrId || typeof ref.entityId !== 'string') {
    throw new Error('DEMO-4 시드 참조 검증: entity ref 범위나 종류가 올바르지 않습니다.');
  }
  const table = expectedKind === 'question' ? 'questions' : expectedKind === 'decision' ? 'decisions' : 'approvals';
  const column = expectedKind === 'question' ? 'question_id' : expectedKind === 'decision' ? 'decision_id' : 'approval_id';
  const found = db.prepare(`SELECT 1 FROM ${table} WHERE project_id=? AND sr_id=? AND ${column}=?`)
    .get(ref.projectId, ref.srId, ref.entityId);
  if (found === undefined) throw new Error(`DEMO-4 시드 참조 검증: ${expectedKind}가 없습니다.`);
}

function validatePassRef(db: DatabaseConnection, raw: unknown, expectedSrId: string, expectedGate: GateKind): void {
  if (typeof raw !== 'object' || raw === null) throw new Error('DEMO-4 시드 참조 검증: pass ref가 객체가 아닙니다.');
  const ref = raw as Partial<PassRef>;
  if (
    ref.kind !== 'gate_pass' || ref.projectId !== PROJECT_ID || ref.srId !== expectedSrId ||
    ref.gate !== expectedGate || typeof ref.transitionId !== 'string'
  ) throw new Error('DEMO-4 시드 참조 검증: pass ref 범위나 종류가 올바르지 않습니다.');
  const found = db.prepare(
    "SELECT 1 FROM gate_transition_records WHERE project_id=? AND sr_id=? AND gate=? AND transition_id=? AND kind='passed'",
  ).get(ref.projectId, ref.srId, ref.gate, ref.transitionId);
  if (found === undefined) throw new Error('DEMO-4 시드 참조 검증: gate pass가 없습니다.');
}

function validateBundlePayloads(db: DatabaseConnection): void {
  const rows = db.prepare(
    `SELECT sr_id, gate, bundle_id, version, assignment_id, assignment_version,
            policy_id, policy_version, checklist_json, payload_json,
            g1_bundle_id, g1_bundle_version
       FROM review_bundles WHERE project_id=?`,
  ).all(PROJECT_ID) as Array<Record<string, string | number | null>>;
  for (const row of rows) {
    const srId = String(row.sr_id);
    const gate = row.gate as GateKind;
    const payload = parseObject(String(row.payload_json), `bundle ${String(row.bundle_id)}`);
    for (const key of [
      'artifactVersionRefs', 'decisionVersionRefs', 'questionResultRefs',
      'classificationRefs', 'contextSourceVersionRefs',
    ]) {
      for (const ref of arrayField(payload, key)) validateVersionRef(db, ref, srId);
    }
    validateVersionRef(db, payload.assignmentRef, srId);
    validateVersionRef(db, payload.policyRef);
    validateVersionRef(db, payload.descriptionRef, srId);
    const assignment = payload.assignmentRef as VersionRef;
    const policy = payload.policyRef as VersionRef;
    if (
      assignment.kind !== 'review_assignment' || assignment.entityId !== row.assignment_id ||
      assignment.version !== row.assignment_version ||
      policy.kind !== 'review_policy' || policy.entityId !== row.policy_id || policy.version !== row.policy_version
    ) throw new Error('DEMO-4 시드 참조 검증: bundle의 정책 또는 배정 관계가 다릅니다.');
    const reviewerIds = arrayField(payload, 'reviewerIds');
    const assignedRows = db.prepare(
      `SELECT reviewer_id FROM review_assignment_reviewers
        WHERE project_id=? AND sr_id=? AND gate=? AND assignment_id=? AND assignment_version=?
        ORDER BY reviewer_id`,
    ).all(PROJECT_ID, srId, gate, row.assignment_id, row.assignment_version) as Array<{ reviewer_id: string }>;
    if (json([...reviewerIds].sort()) !== json(assignedRows.map((item) => item.reviewer_id))) {
      throw new Error('DEMO-4 시드 참조 검증: bundle 검토자와 배정 검토자가 다릅니다.');
    }
    const policyRow = db.prepare(
      'SELECT gates_json FROM review_policy_versions WHERE project_id=? AND policy_id=? AND version=?',
    ).get(PROJECT_ID, row.policy_id, row.policy_version) as { gates_json: string } | undefined;
    if (policyRow === undefined) throw new Error('DEMO-4 시드 참조 검증: bundle 정책이 없습니다.');
    const policyGates = parseObject(policyRow.gates_json, '정책 gates');
    const expectedGate = policyGates[gate];
    if (typeof expectedGate !== 'object' || expectedGate === null) throw new Error('DEMO-4 시드 참조 검증: gate 정책이 없습니다.');
    const expectedChecklist = (expectedGate as JsonObject).checklist;
    if (json(JSON.parse(String(row.checklist_json))) !== json(expectedChecklist)) {
      throw new Error('DEMO-4 시드 참조 검증: bundle checklist와 정책이 다릅니다.');
    }
    if (gate === 'G2') {
      validateBundleRef(db, {
        projectId: PROJECT_ID,
        srId,
        gate: 'G1',
        bundleId: row.g1_bundle_id,
        version: row.g1_bundle_version,
      }, srId, 'G1');
    }
  }
}

function validateApprovalAndPassPayloads(db: DatabaseConnection): void {
  const approvals = db.prepare(
    `SELECT sr_id, gate, bundle_id, bundle_version, review_epoch, policy_id, policy_version,
            checklist_results_json, approver_id, approval_scope, approval_id
       FROM approvals WHERE project_id=?`,
  ).all(PROJECT_ID) as Array<Record<string, string | number>>;
  for (const approval of approvals) {
    const srId = String(approval.sr_id);
    const gate = approval.gate as GateKind;
    validateBundleRef(db, {
      projectId: PROJECT_ID, srId, gate,
      bundleId: approval.bundle_id, version: approval.bundle_version,
    }, srId, gate);
    const bundle = db.prepare(
      `SELECT review_epoch, checklist_json, policy_id, policy_version
         FROM review_bundles WHERE project_id=? AND sr_id=? AND gate=? AND bundle_id=? AND version=?`,
    ).get(PROJECT_ID, srId, gate, approval.bundle_id, approval.bundle_version) as {
      review_epoch: number; checklist_json: string; policy_id: string; policy_version: number;
    } | undefined;
    if (
      bundle === undefined || bundle.review_epoch !== approval.review_epoch ||
      bundle.policy_id !== approval.policy_id || bundle.policy_version !== approval.policy_version ||
      approval.approval_scope !== gate
    ) {
      throw new Error('DEMO-4 시드 참조 검증: approval의 bundle·epoch·정책 관계가 다릅니다.');
    }
    const requiredIds = (JSON.parse(bundle.checklist_json) as Array<{ itemId: string }>).map((item) => item.itemId).sort();
    const checkedIds = (JSON.parse(String(approval.checklist_results_json)) as Array<{ itemId: string; checked: boolean }>)
      .filter((item) => item.checked).map((item) => item.itemId).sort();
    if (json(requiredIds) !== json(checkedIds)) throw new Error('DEMO-4 시드 참조 검증: approval checklist가 완전하지 않습니다.');
    const reviewer = db.prepare(
      `SELECT 1 FROM review_assignment_reviewers r JOIN review_bundles b
         ON b.project_id=r.project_id AND b.sr_id=r.sr_id AND b.gate=r.gate
        AND b.assignment_id=r.assignment_id AND b.assignment_version=r.assignment_version
        WHERE b.project_id=? AND b.sr_id=? AND b.gate=? AND b.bundle_id=? AND b.version=? AND r.reviewer_id=?`,
    ).get(PROJECT_ID, srId, gate, approval.bundle_id, approval.bundle_version, approval.approver_id);
    if (reviewer === undefined) throw new Error('DEMO-4 시드 참조 검증: approval 주체가 지정 검토자가 아닙니다.');
  }

  const passes = db.prepare(
    `SELECT sr_id, gate, transition_id, review_epoch, bundle_id, bundle_version,
            payload_json, affected_version_refs_json
       FROM gate_transition_records WHERE project_id=? AND kind='passed'`,
  ).all(PROJECT_ID) as Array<{
    sr_id: string; gate: GateKind; transition_id: string; review_epoch: number;
    bundle_id: string; bundle_version: number; payload_json: string; affected_version_refs_json: string;
  }>;
  for (const pass of passes) {
    const payload = parseObject(pass.payload_json, `pass ${pass.transition_id}`);
    const bundle = validateBundleRef(db, payload.bundleRef, pass.sr_id, pass.gate);
    validateVersionRef(db, payload.assignmentRef, pass.sr_id);
    validateVersionRef(db, payload.policyRef);
    const bundleRow = db.prepare(
      `SELECT review_epoch, assignment_id, assignment_version, policy_id, policy_version, payload_json
         FROM review_bundles WHERE project_id=? AND sr_id=? AND gate=? AND bundle_id=? AND version=?`,
    ).get(PROJECT_ID, pass.sr_id, pass.gate, bundle.bundleId, bundle.version) as {
      review_epoch: number; assignment_id: string; assignment_version: number;
      policy_id: string; policy_version: number; payload_json: string;
    };
    const assignment = payload.assignmentRef as VersionRef;
    const policy = payload.policyRef as VersionRef;
    if (
      pass.bundle_id !== bundle.bundleId || pass.bundle_version !== bundle.version ||
      pass.review_epoch !== bundleRow.review_epoch ||
      assignment.entityId !== bundleRow.assignment_id || assignment.version !== bundleRow.assignment_version ||
      policy.entityId !== bundleRow.policy_id || policy.version !== bundleRow.policy_version
    ) throw new Error('DEMO-4 시드 참조 검증: pass의 정책 또는 배정 관계가 bundle과 다릅니다.');
    const approvalIds: string[] = [];
    for (const approval of arrayField(payload, 'approvalRefs')) {
      validateEntityRef(db, approval, pass.sr_id, 'approval');
      approvalIds.push((approval as EntityRef).entityId);
    }
    const matchingApprovals = db.prepare(
      `SELECT approval_id FROM approvals
        WHERE project_id=? AND sr_id=? AND gate=? AND bundle_id=? AND bundle_version=?
        ORDER BY approval_id`,
    ).all(PROJECT_ID, pass.sr_id, pass.gate, bundle.bundleId, bundle.version) as Array<{ approval_id: string }>;
    if (json(approvalIds.sort()) !== json(matchingApprovals.map((item) => item.approval_id))) {
      throw new Error('DEMO-4 시드 참조 검증: pass 승인 집합이 bundle 승인과 다릅니다.');
    }
    const bundlePayload = parseObject(bundleRow.payload_json, 'pass bundle');
    if (json(JSON.parse(pass.affected_version_refs_json)) !== json(bundlePayload.artifactVersionRefs)) {
      throw new Error('DEMO-4 시드 참조 검증: pass 내용 버전이 bundle과 다릅니다.');
    }
  }
}

function validateClassificationAndChangeRefs(db: DatabaseConnection): void {
  const classifications = db.prepare(
    'SELECT sr_id, target_kind, target_id, payload_json FROM scope_classification_versions WHERE project_id=?',
  ).all(PROJECT_ID) as Array<{ sr_id: string; target_kind: 'question' | 'decision'; target_id: string; payload_json: string }>;
  for (const classification of classifications) {
    const payload = parseObject(classification.payload_json, `classification ${classification.target_id}`);
    validateEntityRef(db, payload.targetRef, classification.sr_id, classification.target_kind);
    const target = payload.targetRef as EntityRef;
    if (target.entityId !== classification.target_id) throw new Error('DEMO-4 시드 참조 검증: classification target ID가 다릅니다.');
  }

  const changes = db.prepare(
    `SELECT sr_id, change_request_id, current_target_json, current_application_event_id, payload_json
       FROM change_requests WHERE project_id=?`,
  ).all(PROJECT_ID) as Array<{ sr_id: string; change_request_id: string; current_target_json: string; current_application_event_id: string; payload_json: string }>;
  for (const change of changes) {
    const currentTarget = JSON.parse(change.current_target_json) as unknown;
    validateVersionRef(db, currentTarget, change.sr_id);
    const event = db.prepare(
      'SELECT payload_json FROM change_request_events WHERE project_id=? AND sr_id=? AND change_request_id=? AND event_id=?',
    ).get(PROJECT_ID, change.sr_id, change.change_request_id, change.current_application_event_id) as { payload_json: string } | undefined;
    if (event === undefined) throw new Error('DEMO-4 시드 참조 검증: change application event가 없습니다.');
    const eventPayload = parseObject(event.payload_json, 'change event');
    validateVersionRef(db, eventPayload.originalArtifactVersionRef, change.sr_id);
    validateVersionRef(db, eventPayload.appliedArtifactVersionRef, change.sr_id);
    if (json(currentTarget) !== json(eventPayload.appliedArtifactVersionRef)) {
      throw new Error('DEMO-4 시드 참조 검증: change current target과 적용 event가 다릅니다.');
    }
    const payload = parseObject(change.payload_json, 'change request');
    validateBundleRef(db, payload.bundleRef, change.sr_id, 'G2');
    validateVersionRef(db, payload.originalArtifactVersionRef, change.sr_id);
    const section = db.prepare(
      `SELECT 1
         FROM change_requests c JOIN artifact_versions v
           ON v.project_id=c.project_id AND v.sr_id=c.sr_id
          AND v.artifact_id=c.original_artifact_id AND v.kind=c.original_artifact_kind
          AND v.version=c.original_artifact_version
         JOIN json_each(v.section_index_json) item
           ON json_extract(item.value, '$.sectionId')=c.original_section_id
        WHERE c.project_id=? AND c.sr_id=? AND c.change_request_id=?`,
    ).get(PROJECT_ID, change.sr_id, change.change_request_id);
    if (section === undefined) throw new Error('DEMO-4 시드 참조 검증: change 대상 section이 없습니다.');
  }
}

function validateHandoffRefs(db: DatabaseConnection): void {
  const handoffs = db.prepare(
    `SELECT sr_id, handoff_id, g1_bundle_id, g1_bundle_version, g2_bundle_id, g2_bundle_version,
            refs_json, validation_json FROM handoffs WHERE project_id=?`,
  ).all(PROJECT_ID) as Array<{
    sr_id: string; handoff_id: string; g1_bundle_id: string; g1_bundle_version: number;
    g2_bundle_id: string; g2_bundle_version: number; refs_json: string; validation_json: string;
  }>;
  for (const handoff of handoffs) {
    const refs = parseObject(handoff.refs_json, `handoff ${handoff.handoff_id}`);
    const g1 = validateBundleRef(db, refs.g1BundleRef, handoff.sr_id, 'G1');
    const g2 = validateBundleRef(db, refs.g2BundleRef, handoff.sr_id, 'G2');
    if (
      g1.bundleId !== handoff.g1_bundle_id || g1.version !== handoff.g1_bundle_version ||
      g2.bundleId !== handoff.g2_bundle_id || g2.version !== handoff.g2_bundle_version
    ) throw new Error('DEMO-4 시드 참조 검증: handoff bundle JSON과 열이 다릅니다.');
    const g2Row = db.prepare(
      `SELECT g1_bundle_id, g1_bundle_version, payload_json FROM review_bundles
        WHERE project_id=? AND sr_id=? AND gate='G2' AND bundle_id=? AND version=?`,
    ).get(PROJECT_ID, handoff.sr_id, g2.bundleId, g2.version) as {
      g1_bundle_id: string; g1_bundle_version: number; payload_json: string;
    } | undefined;
    if (g2Row === undefined || g2Row.g1_bundle_id !== g1.bundleId || g2Row.g1_bundle_version !== g1.version) {
      throw new Error('DEMO-4 시드 참조 검증: handoff G1과 G2의 상위 G1이 다릅니다.');
    }
    for (const key of ['artifactVersionRefs', 'decisionVersionRefs', 'questionResultRefs', 'classificationRefs']) {
      for (const ref of arrayField(refs, key)) validateVersionRef(db, ref, handoff.sr_id);
    }
    const g2Payload = parseObject(g2Row.payload_json, `handoff ${handoff.handoff_id} G2 bundle`);
    for (const key of ['artifactVersionRefs', 'decisionVersionRefs', 'questionResultRefs', 'classificationRefs']) {
      if (json(refs[key]) !== json(g2Payload[key])) {
        throw new Error(`DEMO-4 시드 참조 검증: handoff ${key}가 G2 bundle과 다릅니다.`);
      }
    }
    const approvalIds: string[] = [];
    for (const approval of arrayField(refs, 'approvalRefs')) {
      validateEntityRef(db, approval, handoff.sr_id, 'approval');
      approvalIds.push((approval as EntityRef).entityId);
    }
    const expectedApprovalIds = db.prepare(
      `SELECT approval_id FROM approvals
        WHERE project_id=? AND sr_id=?
          AND ((gate='G1' AND bundle_id=? AND bundle_version=?)
            OR (gate='G2' AND bundle_id=? AND bundle_version=?))
        ORDER BY approval_id`,
    ).all(
      PROJECT_ID, handoff.sr_id,
      g1.bundleId, g1.version, g2.bundleId, g2.version,
    ) as Array<{ approval_id: string }>;
    if (json(approvalIds.sort()) !== json(expectedApprovalIds.map((item) => item.approval_id))) {
      throw new Error('DEMO-4 시드 참조 검증: handoff 승인 집합이 G1/G2와 다릅니다.');
    }
    if (!Array.isArray(refs.verificationCriteria) || !Array.isArray(refs.followupScope)) {
      throw new Error('DEMO-4 시드 참조 검증: handoff 검증 기준이나 후속 범위가 없습니다.');
    }
    const validation = parseObject(handoff.validation_json, `handoff ${handoff.handoff_id} validation`);
    validatePassRef(db, validation.g1PassRef, handoff.sr_id, 'G1');
    validatePassRef(db, validation.g2PassRef, handoff.sr_id, 'G2');
    for (const [gate, bundle, rawPass] of [
      ['G1', g1, validation.g1PassRef],
      ['G2', g2, validation.g2PassRef],
    ] as const) {
      const transitionId = (rawPass as PassRef).transitionId;
      const pass = db.prepare(
        `SELECT review_epoch, bundle_id, bundle_version FROM gate_transition_records
          WHERE project_id=? AND sr_id=? AND gate=? AND transition_id=? AND kind='passed'`,
      ).get(PROJECT_ID, handoff.sr_id, gate, transitionId) as {
        review_epoch: number; bundle_id: string; bundle_version: number;
      } | undefined;
      const fixedBundle = db.prepare(
        `SELECT review_epoch FROM review_bundles
          WHERE project_id=? AND sr_id=? AND gate=? AND bundle_id=? AND version=?`,
      ).get(PROJECT_ID, handoff.sr_id, gate, bundle.bundleId, bundle.version) as { review_epoch: number } | undefined;
      if (
        pass === undefined || fixedBundle === undefined || pass.review_epoch !== fixedBundle.review_epoch ||
        pass.bundle_id !== bundle.bundleId || pass.bundle_version !== bundle.version
      ) throw new Error(`DEMO-4 시드 참조 검증: handoff ${gate} pass가 고정 bundle과 다릅니다.`);
    }
    validateVersionRef(db, validation.policyRef);
    const assignmentIds: string[] = [];
    for (const assignment of arrayField(validation, 'assignmentRefs')) {
      validateVersionRef(db, assignment, handoff.sr_id);
      assignmentIds.push((assignment as VersionRef).entityId);
    }
    if (json(assignmentIds.sort()) !== json([
      assignmentId(handoff.sr_id, 'G1'), assignmentId(handoff.sr_id, 'G2'),
    ].sort())) throw new Error('DEMO-4 시드 참조 검증: handoff 배정 집합이 G1/G2와 다릅니다.');
  }
}

function validateInvalidationRefs(db: DatabaseConnection): void {
  const invalidations = db.prepare(
    `SELECT sr_id, gate, affected_version_refs_json, payload_json
       FROM gate_transition_records WHERE project_id=? AND kind='invalidated'`,
  ).all(PROJECT_ID) as Array<{
    sr_id: string; gate: GateKind; affected_version_refs_json: string; payload_json: string;
  }>;
  for (const invalidation of invalidations) {
    const payload = parseObject(invalidation.payload_json, 'gate invalidation');
    validatePassRef(db, payload.previousPassRef, invalidation.sr_id, invalidation.gate);
    const affected = JSON.parse(invalidation.affected_version_refs_json) as unknown;
    if (!Array.isArray(affected) || affected.length === 0) {
      throw new Error('DEMO-4 시드 참조 검증: invalidation 영향 버전이 없습니다.');
    }
    for (const ref of affected) validateVersionRef(db, ref, invalidation.sr_id);
  }
}

function validateGateStates(db: DatabaseConnection): void {
  const states = db.prepare(
    `SELECT sr_id, gate, review_epoch, needs_new_bundle, validity,
            policy_id, policy_version, assignment_id, assignment_version,
            current_bundle_id, current_bundle_version, last_pass_transition_id, impact_json
       FROM review_gate_states WHERE project_id=? ORDER BY sr_id, gate`,
  ).all(PROJECT_ID) as Array<Record<string, string | number | null>>;
  if (states.length !== scenarios.length * 2) {
    throw new Error('DEMO-4 시드 참조 검증: SR마다 G1/G2 현재 상태가 있어야 합니다.');
  }
  for (const state of states) {
    const srId = String(state.sr_id);
    const gate = state.gate as GateKind;
    const expected = scenarios.find((scenario) => manifest.srIds[scenario.key] === srId)?.gates[gate];
    if (expected === undefined || state.review_epoch !== expected.reviewEpoch || state.validity !== expected.validity) {
      throw new Error('DEMO-4 시드 참조 검증: 현재 gate 상태가 시나리오와 다릅니다.');
    }
    if (state.policy_id !== manifest.policyId || state.policy_version !== POLICY_VERSION) {
      throw new Error('DEMO-4 시드 참조 검증: 현재 gate 정책이 다릅니다.');
    }
    if (state.assignment_id !== assignmentId(srId, gate) || state.assignment_version !== 1) {
      throw new Error('DEMO-4 시드 참조 검증: 현재 gate 배정이 다릅니다.');
    }
    let currentBundleEpoch: number | undefined;
    if (state.current_bundle_id !== null || state.current_bundle_version !== null) {
      if (state.current_bundle_id === null || state.current_bundle_version === null) {
        throw new Error('DEMO-4 시드 참조 검증: 현재 bundle 식별자와 version이 함께 있어야 합니다.');
      }
      const bundle = db.prepare(
        `SELECT review_epoch FROM review_bundles
          WHERE project_id=? AND sr_id=? AND gate=? AND bundle_id=? AND version=?`,
      ).get(PROJECT_ID, srId, gate, state.current_bundle_id, state.current_bundle_version) as {
        review_epoch: number;
      } | undefined;
      if (bundle === undefined) throw new Error('DEMO-4 시드 참조 검증: 현재 gate bundle이 없습니다.');
      currentBundleEpoch = bundle.review_epoch;
    }
    let lastPassEpoch: number | undefined;
    if (state.last_pass_transition_id !== null) {
      const pass = db.prepare(
        `SELECT review_epoch, bundle_id, bundle_version FROM gate_transition_records
          WHERE project_id=? AND sr_id=? AND gate=? AND transition_id=? AND kind='passed'`,
      ).get(PROJECT_ID, srId, gate, state.last_pass_transition_id) as {
        review_epoch: number; bundle_id: string; bundle_version: number;
      } | undefined;
      if (pass === undefined) throw new Error('DEMO-4 시드 참조 검증: 현재 gate의 last pass 관계가 다릅니다.');
      lastPassEpoch = pass.review_epoch;
      if (
        state.current_bundle_id !== null &&
        (pass.bundle_id !== state.current_bundle_id || pass.bundle_version !== state.current_bundle_version)
      ) throw new Error('DEMO-4 시드 참조 검증: 현재 gate의 pass와 bundle이 다릅니다.');
    }
    if (
      state.validity === 'valid' &&
      (lastPassEpoch !== state.review_epoch || currentBundleEpoch !== state.review_epoch || state.needs_new_bundle !== 0)
    ) throw new Error('DEMO-4 시드 참조 검증: valid gate의 현재 기준이 일치하지 않습니다.');
    if (state.validity === 'invalid') {
      if (lastPassEpoch === undefined || lastPassEpoch >= Number(state.review_epoch) || state.needs_new_bundle !== 1) {
        throw new Error('DEMO-4 시드 참조 검증: invalid gate의 과거 pass 관계가 올바르지 않습니다.');
      }
      const impact = state.impact_json === null ? undefined : parseObject(String(state.impact_json), 'gate impact');
      const invalidationId = impact?.invalidationTransitionId;
      const invalidation = typeof invalidationId !== 'string' ? undefined : db.prepare(
        `SELECT 1 FROM gate_transition_records
          WHERE project_id=? AND sr_id=? AND gate=? AND transition_id=?
            AND kind='invalidated' AND review_epoch=?`,
      ).get(PROJECT_ID, srId, gate, invalidationId, state.review_epoch);
      if (invalidation === undefined) throw new Error('DEMO-4 시드 참조 검증: 현재 gate invalidation이 없습니다.');
    }
  }
}

function validateArtifactStructures(db: DatabaseConnection): void {
  const artifacts = db.prepare(
    `SELECT sr_id, artifact_id, kind, version, markdown, section_index_json, requirement_links_json
       FROM artifact_versions WHERE project_id=?`,
  ).all(PROJECT_ID) as Array<{
    sr_id: string; artifact_id: string; kind: string; version: number; markdown: string;
    section_index_json: string; requirement_links_json: string;
  }>;
  for (const artifact of artifacts) {
    const sections = JSON.parse(artifact.section_index_json) as unknown;
    if (!Array.isArray(sections) || sections.length === 0) {
      throw new Error('DEMO-4 시드 참조 검증: 문서 sectionIndex가 비었습니다.');
    }
    const ids = new Set<string>();
    for (const raw of sections) {
      if (typeof raw !== 'object' || raw === null) throw new Error('DEMO-4 시드 참조 검증: section이 객체가 아닙니다.');
      const section = raw as Record<string, unknown>;
      if (
        typeof section.sectionId !== 'string' || typeof section.title !== 'string' ||
        !Number.isInteger(section.startOffset) || !Number.isInteger(section.endOffset) ||
        Number(section.startOffset) < 0 || Number(section.endOffset) <= Number(section.startOffset) ||
        Number(section.endOffset) > artifact.markdown.length || ids.has(section.sectionId)
      ) throw new Error('DEMO-4 시드 참조 검증: section 범위나 ID가 올바르지 않습니다.');
      if (!artifact.markdown.slice(Number(section.startOffset), Number(section.endOffset)).includes(`## ${section.sectionId}`)) {
        throw new Error('DEMO-4 시드 참조 검증: section 범위가 Markdown과 다릅니다.');
      }
      ids.add(section.sectionId);
    }
    const links = JSON.parse(artifact.requirement_links_json) as unknown;
    if (!Array.isArray(links) || links.length === 0) throw new Error('DEMO-4 시드 참조 검증: requirementLinks가 비었습니다.');
    for (const raw of links) {
      if (typeof raw !== 'object' || raw === null) throw new Error('DEMO-4 시드 참조 검증: requirement link가 객체가 아닙니다.');
      const link = raw as Record<string, unknown>;
      if (
        typeof link.requirementId !== 'string' || !Array.isArray(link.sectionIds) || link.sectionIds.length === 0 ||
        link.sectionIds.some((id) => typeof id !== 'string' || !ids.has(id)) ||
        !Array.isArray(link.acceptanceCriteria) || link.acceptanceCriteria.some((item) => typeof item !== 'string')
      ) throw new Error('DEMO-4 시드 참조 검증: requirement link가 올바르지 않습니다.');
    }
  }
  const plans = db.prepare(
    `SELECT sr_id, stages_json, requirement_task_links_json
       FROM workflow_plan_versions WHERE project_id=?`,
  ).all(PROJECT_ID) as Array<{ sr_id: string; stages_json: string; requirement_task_links_json: string }>;
  for (const plan of plans) {
    const stages = JSON.parse(plan.stages_json) as unknown;
    if (!Array.isArray(stages) || stages.length === 0) throw new Error('DEMO-4 시드 참조 검증: Workflow 단계가 비었습니다.');
    for (const raw of stages) {
      if (typeof raw !== 'object' || raw === null) throw new Error('DEMO-4 시드 참조 검증: Workflow 단계가 객체가 아닙니다.');
      const stage = raw as Record<string, unknown>;
      if (typeof stage.stageId !== 'string' || (stage.choice !== 'executed' && stage.choice !== 'skipped')) {
        throw new Error('DEMO-4 시드 참조 검증: Workflow 단계 선택이 올바르지 않습니다.');
      }
      if (stage.choice === 'executed') {
        if (!Array.isArray(stage.designArtifactRefs)) throw new Error('DEMO-4 시드 참조 검증: 실행 단계 설계 참조가 없습니다.');
        for (const ref of stage.designArtifactRefs) validateVersionRef(db, ref, plan.sr_id);
      } else if (typeof stage.reason !== 'string' || stage.reason.length === 0) {
        throw new Error('DEMO-4 시드 참조 검증: 생략 단계 이유가 없습니다.');
      }
    }
    const links = JSON.parse(plan.requirement_task_links_json) as unknown;
    if (!Array.isArray(links) || links.length === 0) throw new Error('DEMO-4 시드 참조 검증: Workflow 작업 연결이 비었습니다.');
    for (const raw of links) {
      if (typeof raw !== 'object' || raw === null) throw new Error('DEMO-4 시드 참조 검증: Workflow 작업 연결이 객체가 아닙니다.');
      const link = raw as Record<string, unknown>;
      if (
        typeof link.taskId !== 'string' || !Array.isArray(link.requirementIds) || link.requirementIds.length === 0 ||
        !Array.isArray(link.verification) || link.verification.length === 0 ||
        !Number.isInteger(link.order) || Number(link.order) < 1
      ) throw new Error('DEMO-4 시드 참조 검증: Workflow 작업 연결이 올바르지 않습니다.');
    }
  }
}

function validateStoredGraph(db: DatabaseConnection): void {
  validateArtifactStructures(db);
  validateBundlePayloads(db);
  validateApprovalAndPassPayloads(db);
  validateClassificationAndChangeRefs(db);
  validateHandoffRefs(db);
  validateInvalidationRefs(db);
  validateGateStates(db);
}

function recordSeedManifest(db: DatabaseConnection): void {
  const manifestText = json(manifest);
  insert(db, 'demo_seed_manifests', {
    seed_id: manifest.seedId,
    manifest_version: manifest.version,
    project_id: PROJECT_ID,
    completed_at: nextTimestamp(),
    manifest_digest: digest(manifestText),
    manifest_json: manifestText,
  });
}

export function seedDemo(db: DatabaseConnection): void {
  assertConfiguration();
  runOfflineMaintenance(
    db,
    `seed:${manifest.seedId}`,
    (tx) => {
      assertBusinessStoreEmpty(tx);
      insertValidatedDemoGraph(tx);
      recordSeedManifest(tx);
    },
    new Date(BASE_TIME).toISOString(),
  );
}
