import { createHash } from 'node:crypto';

export interface AppMigration {
  readonly number: number;
  readonly checksum: string;
  readonly sql: string;
}

export const BUSINESS_ENTITY_TABLES = [
  'workspace_projects',
  'demo_user_memberships',
  'srs',
  'sr_description_versions',
  'context_sources',
  'context_source_versions',
  'artifacts',
  'artifact_versions',
  'workflow_plan_versions',
  'questions',
  'question_answer_versions',
  'question_result_snapshots',
  'decisions',
  'decision_versions',
  'scope_classification_versions',
  'review_policy_versions',
  'review_assignment_versions',
  'review_bundles',
  'review_requests',
  'approvals',
  'review_gate_states',
  'gate_transition_records',
  'comments',
  'change_requests',
  'change_request_events',
  'input_snapshots',
  'generation_runs',
  'execution_claims',
  'execution_observations',
  'generation_drafts',
  'draft_applications',
  'handoffs',
  'implementation_records',
  'activity_events',
  'command_receipts',
] as const;

export const INITIAL_SCHEMA_SQL = String.raw`
CREATE TABLE app_migrations (
  number INTEGER PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE maintenance_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  owner_id TEXT,
  started_at TEXT,
  CHECK ((owner_id IS NULL) = (started_at IS NULL))
);
INSERT INTO maintenance_state(singleton_id, owner_id, started_at) VALUES (1, NULL, NULL);

CREATE TABLE runtime_identities (
  runtime_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  boot_id TEXT NOT NULL,
  parent_pid INTEGER NOT NULL CHECK (parent_pid > 0),
  parent_started_at TEXT NOT NULL,
  registered_at TEXT NOT NULL
);

CREATE TABLE runtime_instances (
  runtime_id TEXT PRIMARY KEY,
  heartbeat_at TEXT NOT NULL,
  FOREIGN KEY (runtime_id) REFERENCES runtime_identities(runtime_id)
);

CREATE TABLE execution_slot (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  project_id TEXT,
  sr_id TEXT,
  run_id TEXT,
  claim_id TEXT,
  claim_token_hash TEXT,
  runtime_id TEXT,
  launch_intent_id TEXT,
  CHECK (
    (run_id IS NULL AND project_id IS NULL AND sr_id IS NULL AND claim_id IS NULL
      AND claim_token_hash IS NULL AND runtime_id IS NULL AND launch_intent_id IS NULL)
    OR
    (run_id IS NOT NULL AND project_id IS NOT NULL AND sr_id IS NOT NULL AND claim_id IS NOT NULL
      AND claim_token_hash IS NOT NULL AND runtime_id IS NOT NULL AND launch_intent_id IS NOT NULL)
  ),
  FOREIGN KEY (project_id, sr_id, run_id, claim_id)
    REFERENCES execution_claims(project_id, sr_id, run_id, claim_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (runtime_id) REFERENCES runtime_instances(runtime_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE workspace_projects (
  project_id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  default_policy_id TEXT,
  default_policy_version INTEGER,
  provider_config_id TEXT,
  CHECK ((default_policy_id IS NULL) = (default_policy_version IS NULL)),
  FOREIGN KEY (project_id, default_policy_id, default_policy_version)
    REFERENCES review_policy_versions(project_id, policy_id, version)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE demo_user_memberships (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  roles_json TEXT NOT NULL CHECK (json_valid(roles_json)),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  demo INTEGER NOT NULL CHECK (demo = 1),
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES workspace_projects(project_id)
);

CREATE TABLE srs (
  project_id TEXT NOT NULL,
  sr_id TEXT NOT NULL,
  sr_key TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  original_description_id TEXT NOT NULL,
  original_description_version INTEGER NOT NULL,
  current_description_id TEXT NOT NULL,
  current_description_version INTEGER NOT NULL,
  workflow_version TEXT NOT NULL CHECK (workflow_version = 'v1.0.1'),
  implementation_unit_count INTEGER NOT NULL CHECK (implementation_unit_count = 1),
  progress_stage TEXT NOT NULL CHECK (progress_stage IN ('sr_received','requirements','planning','ready','implementing','completed')),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  jira_key TEXT,
  jira_url TEXT,
  existing_system INTEGER,
  active_implementation_id TEXT,
  PRIMARY KEY (project_id, sr_id),
  UNIQUE (project_id, sr_key),
  UNIQUE (project_id, jira_key),
  FOREIGN KEY (project_id) REFERENCES workspace_projects(project_id),
  FOREIGN KEY (project_id, owner_id) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, original_description_id, original_description_version)
    REFERENCES sr_description_versions(project_id, sr_id, description_id, version)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, sr_id, current_description_id, current_description_version)
    REFERENCES sr_description_versions(project_id, sr_id, description_id, version)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, sr_id, active_implementation_id)
    REFERENCES implementation_records(project_id, sr_id, implementation_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE sr_description_versions (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, description_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0), title TEXT NOT NULL, purpose TEXT NOT NULL,
  description TEXT NOT NULL, author_id TEXT NOT NULL, created_at TEXT NOT NULL,
  previous_version INTEGER, change_reason TEXT, payload_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, description_id, version),
  FOREIGN KEY (project_id, sr_id) REFERENCES srs(project_id, sr_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, author_id) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, description_id, previous_version)
    REFERENCES sr_description_versions(project_id, sr_id, description_id, version),
  CHECK ((previous_version IS NULL AND version = 1) OR (previous_version IS NOT NULL AND previous_version < version))
);

CREATE TABLE context_sources (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, source_id TEXT NOT NULL,
  current_version INTEGER NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 0),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, display_name TEXT,
  PRIMARY KEY (project_id, sr_id, source_id),
  FOREIGN KEY (project_id, sr_id) REFERENCES srs(project_id, sr_id),
  FOREIGN KEY (project_id, created_by) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, source_id, current_version)
    REFERENCES context_source_versions(project_id, sr_id, source_id, version)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE context_source_versions (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, source_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0), kind TEXT NOT NULL CHECK (kind IN ('text','markdown','link')),
  provenance TEXT NOT NULL, confirmation TEXT NOT NULL CHECK (confirmation IN ('unconfirmed','confirmed')),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, content TEXT, target_url TEXT,
  confirmed_by TEXT, confirmed_at TEXT, confirmation_evidence TEXT,
  previous_version INTEGER, payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, source_id, version),
  FOREIGN KEY (project_id, sr_id, source_id) REFERENCES context_sources(project_id, sr_id, source_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, created_by) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, confirmed_by) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, source_id, previous_version)
    REFERENCES context_source_versions(project_id, sr_id, source_id, version),
  CHECK ((previous_version IS NULL AND version = 1) OR (previous_version IS NOT NULL AND previous_version < version)),
  CHECK ((kind IN ('text','markdown') AND content IS NOT NULL) OR (kind = 'link' AND target_url IS NOT NULL)),
  CHECK (confirmation = 'unconfirmed' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND confirmation_evidence IS NOT NULL))
);

CREATE TABLE artifacts (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('requirements','workflow_plan','design','implementation_plan')),
  current_version INTEGER NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 0),
  design_stage TEXT, display_title TEXT,
  PRIMARY KEY (project_id, sr_id, artifact_id),
  UNIQUE (project_id, sr_id, artifact_id, kind),
  FOREIGN KEY (project_id, sr_id) REFERENCES srs(project_id, sr_id),
  FOREIGN KEY (project_id, sr_id, artifact_id, kind, current_version)
    REFERENCES artifact_versions(project_id, sr_id, artifact_id, kind, version)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE artifact_versions (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
  kind TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0), markdown TEXT NOT NULL,
  section_index_json TEXT NOT NULL CHECK (json_valid(section_index_json)),
  requirement_links_json TEXT NOT NULL CHECK (json_valid(requirement_links_json)),
  author_origin TEXT NOT NULL, author_id TEXT NOT NULL, created_at TEXT NOT NULL,
  change_summary TEXT NOT NULL, previous_version INTEGER, draft_application_id TEXT,
  input_snapshot_id TEXT, payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, artifact_id, kind, version),
  UNIQUE (project_id, sr_id, artifact_id, version),
  FOREIGN KEY (project_id, sr_id, artifact_id, kind) REFERENCES artifacts(project_id, sr_id, artifact_id, kind)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, author_id) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, artifact_id, kind, previous_version)
    REFERENCES artifact_versions(project_id, sr_id, artifact_id, kind, version),
  FOREIGN KEY (project_id, sr_id, draft_application_id)
    REFERENCES draft_applications(project_id, sr_id, application_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, sr_id, input_snapshot_id)
    REFERENCES input_snapshots(project_id, sr_id, snapshot_id),
  CHECK ((previous_version IS NULL AND version = 1) OR (previous_version IS NOT NULL AND previous_version < version))
);

CREATE TABLE workflow_plan_versions (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL DEFAULT 'workflow_plan' CHECK (artifact_kind = 'workflow_plan'),
  version INTEGER NOT NULL, workflow_version TEXT NOT NULL,
  stages_json TEXT NOT NULL CHECK (json_valid(stages_json)),
  implementation_unit_count INTEGER NOT NULL CHECK (implementation_unit_count = 1),
  requirement_task_links_json TEXT NOT NULL CHECK (json_valid(requirement_task_links_json)),
  PRIMARY KEY (project_id, sr_id, artifact_id, version),
  FOREIGN KEY (project_id, sr_id, artifact_id, artifact_kind, version)
    REFERENCES artifact_versions(project_id, sr_id, artifact_id, kind, version)
);

CREATE TABLE questions (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, question_id TEXT NOT NULL,
  text TEXT NOT NULL, reason TEXT NOT NULL, assignee_id TEXT NOT NULL,
  answer_mode TEXT NOT NULL CHECK (answer_mode IN ('choice','free_text')),
  required_gate TEXT NOT NULL CHECK (required_gate IN ('G1','G2','None')),
  classification_id TEXT NOT NULL, classification_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','answered','resolved','converted_to_decision')),
  current_result_version INTEGER NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at TEXT NOT NULL, parent_question_id TEXT, converted_decision_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, question_id),
  FOREIGN KEY (project_id, sr_id) REFERENCES srs(project_id, sr_id),
  FOREIGN KEY (project_id, assignee_id) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, parent_question_id) REFERENCES questions(project_id, sr_id, question_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, sr_id, question_id, current_result_version)
    REFERENCES question_result_snapshots(project_id, sr_id, question_id, version)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, sr_id, classification_id, classification_version)
    REFERENCES scope_classification_versions(project_id, sr_id, classification_id, version)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, sr_id, converted_decision_id) REFERENCES decisions(project_id, sr_id, decision_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (parent_question_id IS NULL OR parent_question_id <> question_id),
  CHECK (status <> 'converted_to_decision' OR converted_decision_id IS NOT NULL)
);

CREATE TABLE question_answer_versions (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, question_id TEXT NOT NULL,
  answer_id TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
  answered_snapshot_version INTEGER NOT NULL, answer_text TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)), answered_by TEXT NOT NULL,
  answered_at TEXT NOT NULL, previous_version INTEGER, selected_option_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, question_id, answer_id, version),
  FOREIGN KEY (project_id, sr_id, question_id) REFERENCES questions(project_id, sr_id, question_id),
  FOREIGN KEY (project_id, answered_by) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, question_id, answered_snapshot_version)
    REFERENCES question_result_snapshots(project_id, sr_id, question_id, version),
  FOREIGN KEY (project_id, sr_id, question_id, answer_id, previous_version)
    REFERENCES question_answer_versions(project_id, sr_id, question_id, answer_id, version),
  CHECK ((previous_version IS NULL AND version = 1) OR (previous_version IS NOT NULL AND previous_version < version))
);

CREATE TABLE question_result_snapshots (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, question_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0), text TEXT NOT NULL, reason TEXT NOT NULL,
  assignee_id TEXT NOT NULL, answer_mode TEXT NOT NULL, options_json TEXT NOT NULL CHECK (json_valid(options_json)),
  status TEXT NOT NULL, classification_id TEXT NOT NULL, classification_version INTEGER NOT NULL,
  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)), captured_at TEXT NOT NULL,
  selected_answer_id TEXT, selected_answer_version INTEGER, payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, question_id, version),
  FOREIGN KEY (project_id, sr_id, question_id) REFERENCES questions(project_id, sr_id, question_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, assignee_id) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, classification_id, classification_version)
    REFERENCES scope_classification_versions(project_id, sr_id, classification_id, version)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, sr_id, question_id, selected_answer_id, selected_answer_version)
    REFERENCES question_answer_versions(project_id, sr_id, question_id, answer_id, version)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE decisions (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, decision_id TEXT NOT NULL,
  prompt TEXT NOT NULL, alternatives_json TEXT NOT NULL CHECK (json_valid(alternatives_json)),
  impact TEXT NOT NULL, decision_maker_id TEXT NOT NULL,
  classification_id TEXT NOT NULL, classification_version INTEGER NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0), created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  current_confirmed_version INTEGER, origin_question_id TEXT, payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, decision_id),
  UNIQUE (project_id, sr_id, origin_question_id),
  FOREIGN KEY (project_id, sr_id) REFERENCES srs(project_id, sr_id),
  FOREIGN KEY (project_id, decision_maker_id) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, created_by) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, classification_id, classification_version)
    REFERENCES scope_classification_versions(project_id, sr_id, classification_id, version)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, sr_id, decision_id, current_confirmed_version)
    REFERENCES decision_versions(project_id, sr_id, decision_id, version)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, sr_id, origin_question_id) REFERENCES questions(project_id, sr_id, question_id)
);

CREATE TABLE decision_versions (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, decision_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0), prompt TEXT NOT NULL,
  alternatives_json TEXT NOT NULL CHECK (json_valid(alternatives_json)), impact TEXT NOT NULL,
  selected_option TEXT NOT NULL, rationale TEXT NOT NULL, evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  decision_maker_id TEXT NOT NULL, decided_at TEXT NOT NULL,
  classification_id TEXT NOT NULL, classification_version INTEGER NOT NULL,
  previous_version INTEGER, change_reason TEXT, payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, decision_id, version),
  FOREIGN KEY (project_id, sr_id, decision_id) REFERENCES decisions(project_id, sr_id, decision_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, decision_maker_id) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, classification_id, classification_version)
    REFERENCES scope_classification_versions(project_id, sr_id, classification_id, version),
  FOREIGN KEY (project_id, sr_id, decision_id, previous_version)
    REFERENCES decision_versions(project_id, sr_id, decision_id, version),
  CHECK ((previous_version IS NULL AND version = 1) OR (previous_version IS NOT NULL AND previous_version < version))
);

CREATE TABLE scope_classification_versions (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, classification_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0), target_kind TEXT NOT NULL CHECK (target_kind IN ('question','decision')),
  target_id TEXT NOT NULL, scope TEXT NOT NULL CHECK (scope IN ('current','followup')),
  required_gate TEXT NOT NULL CHECK (required_gate IN ('G1','G2','None')), reason TEXT NOT NULL,
  classified_by TEXT NOT NULL, classified_at TEXT NOT NULL, previous_version INTEGER,
  owner_id TEXT, revisit_at TEXT, revisit_event TEXT, payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, classification_id, version),
  FOREIGN KEY (project_id, sr_id) REFERENCES srs(project_id, sr_id),
  FOREIGN KEY (project_id, classified_by) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, owner_id) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, classification_id, previous_version)
    REFERENCES scope_classification_versions(project_id, sr_id, classification_id, version),
  CHECK ((previous_version IS NULL AND version = 1) OR (previous_version IS NOT NULL AND previous_version < version)),
  CHECK ((scope = 'current' AND required_gate IN ('G1','G2')) OR (scope = 'followup' AND required_gate = 'None')),
  CHECK (scope = 'current' OR owner_id IS NOT NULL OR revisit_at IS NOT NULL OR revisit_event IS NOT NULL)
);

CREATE TABLE review_policy_versions (
  project_id TEXT NOT NULL, policy_id TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
  gates_json TEXT NOT NULL CHECK (json_valid(gates_json)), require_all_assigned INTEGER NOT NULL CHECK (require_all_assigned = 1),
  require_distinct_peer INTEGER NOT NULL CHECK (require_distinct_peer = 1), created_by TEXT NOT NULL,
  created_at TEXT NOT NULL, previous_version INTEGER, change_reason TEXT, description TEXT,
  PRIMARY KEY (project_id, policy_id, version),
  FOREIGN KEY (project_id) REFERENCES workspace_projects(project_id),
  FOREIGN KEY (project_id, created_by) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, policy_id, previous_version)
    REFERENCES review_policy_versions(project_id, policy_id, version),
  CHECK ((previous_version IS NULL AND version = 1) OR (previous_version IS NOT NULL AND previous_version < version))
);

CREATE TABLE review_assignment_versions (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, gate TEXT NOT NULL CHECK (gate IN ('G1','G2')),
  assignment_id TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
  assigned_by TEXT NOT NULL, assigned_at TEXT NOT NULL, previous_version INTEGER,
  change_reason TEXT, description TEXT,
  PRIMARY KEY (project_id, sr_id, gate, assignment_id, version),
  UNIQUE (project_id, sr_id, assignment_id, version),
  FOREIGN KEY (project_id, sr_id) REFERENCES srs(project_id, sr_id),
  FOREIGN KEY (project_id, assigned_by) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, gate, assignment_id, previous_version)
    REFERENCES review_assignment_versions(project_id, sr_id, gate, assignment_id, version),
  CHECK ((previous_version IS NULL AND version = 1) OR (previous_version IS NOT NULL AND previous_version < version))
);

CREATE TABLE review_assignment_reviewers (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, gate TEXT NOT NULL,
  assignment_id TEXT NOT NULL, assignment_version INTEGER NOT NULL, reviewer_id TEXT NOT NULL,
  PRIMARY KEY (project_id, sr_id, gate, assignment_id, assignment_version, reviewer_id),
  FOREIGN KEY (project_id, sr_id, gate, assignment_id, assignment_version)
    REFERENCES review_assignment_versions(project_id, sr_id, gate, assignment_id, version),
  FOREIGN KEY (project_id, reviewer_id) REFERENCES demo_user_memberships(project_id, user_id)
);

CREATE TABLE review_bundles (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, gate TEXT NOT NULL CHECK (gate IN ('G1','G2')),
  bundle_id TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0), review_epoch INTEGER NOT NULL CHECK (review_epoch > 0),
  assignment_id TEXT NOT NULL, assignment_version INTEGER NOT NULL,
  policy_id TEXT NOT NULL, policy_version INTEGER NOT NULL, checklist_json TEXT NOT NULL CHECK (json_valid(checklist_json)),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  previous_bundle_id TEXT, previous_bundle_version INTEGER,
  g1_gate TEXT NOT NULL DEFAULT 'G1' CHECK (g1_gate = 'G1'),
  g1_bundle_id TEXT, g1_bundle_version INTEGER, payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, gate, bundle_id, version),
  FOREIGN KEY (project_id, sr_id, gate, assignment_id, assignment_version)
    REFERENCES review_assignment_versions(project_id, sr_id, gate, assignment_id, version),
  FOREIGN KEY (project_id, policy_id, policy_version) REFERENCES review_policy_versions(project_id, policy_id, version),
  FOREIGN KEY (project_id, created_by) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, gate, previous_bundle_id, previous_bundle_version)
    REFERENCES review_bundles(project_id, sr_id, gate, bundle_id, version),
  FOREIGN KEY (project_id, sr_id, g1_gate, g1_bundle_id, g1_bundle_version)
    REFERENCES review_bundles(project_id, sr_id, gate, bundle_id, version),
  CHECK ((previous_bundle_id IS NULL) = (previous_bundle_version IS NULL)),
  CHECK (previous_bundle_id IS NULL OR previous_bundle_id <> bundle_id OR previous_bundle_version < version),
  CHECK ((gate = 'G1' AND g1_bundle_id IS NULL AND g1_bundle_version IS NULL) OR
         (gate = 'G2' AND g1_bundle_id IS NOT NULL AND g1_bundle_version IS NOT NULL))
);

CREATE UNIQUE INDEX review_bundles_scope_lookup
  ON review_bundles(project_id, sr_id, bundle_id, version);

CREATE TABLE review_requests (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, request_id TEXT NOT NULL,
  gate TEXT NOT NULL, bundle_id TEXT NOT NULL, bundle_version INTEGER NOT NULL,
  review_epoch INTEGER NOT NULL, reviewer_id TEXT NOT NULL, request_kind TEXT NOT NULL,
  requested_by TEXT NOT NULL, requested_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','handled','superseded')),
  revision INTEGER NOT NULL CHECK (revision >= 0), superseded_by_request_id TEXT,
  result_ref_json TEXT, handled_at TEXT, payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, request_id),
  FOREIGN KEY (project_id, sr_id, gate, bundle_id, bundle_version)
    REFERENCES review_bundles(project_id, sr_id, gate, bundle_id, version),
  FOREIGN KEY (project_id, reviewer_id) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, requested_by) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, superseded_by_request_id)
    REFERENCES review_requests(project_id, sr_id, request_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX one_active_review_request
  ON review_requests(project_id, sr_id, gate, bundle_id, bundle_version, reviewer_id, request_kind)
  WHERE status = 'pending';

CREATE TABLE approvals (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, approval_id TEXT NOT NULL,
  gate TEXT NOT NULL, bundle_id TEXT NOT NULL, bundle_version INTEGER NOT NULL,
  review_epoch INTEGER NOT NULL, policy_id TEXT NOT NULL, policy_version INTEGER NOT NULL,
  checklist_results_json TEXT NOT NULL CHECK (json_valid(checklist_results_json)),
  approver_id TEXT NOT NULL, approval_scope TEXT NOT NULL, result TEXT NOT NULL CHECK (result = 'approved'),
  approved_at TEXT NOT NULL, comment TEXT,
  PRIMARY KEY (project_id, sr_id, approval_id),
  UNIQUE (project_id, sr_id, gate, bundle_id, bundle_version, approver_id),
  FOREIGN KEY (project_id, sr_id, gate, bundle_id, bundle_version)
    REFERENCES review_bundles(project_id, sr_id, gate, bundle_id, version),
  FOREIGN KEY (project_id, policy_id, policy_version) REFERENCES review_policy_versions(project_id, policy_id, version),
  FOREIGN KEY (project_id, approver_id) REFERENCES demo_user_memberships(project_id, user_id)
);

CREATE TABLE review_gate_states (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, gate TEXT NOT NULL CHECK (gate IN ('G1','G2')),
  review_epoch INTEGER NOT NULL CHECK (review_epoch > 0), needs_new_bundle INTEGER NOT NULL CHECK (needs_new_bundle IN (0,1)),
  validity TEXT NOT NULL CHECK (validity IN ('not_passed','valid','invalid')),
  revision INTEGER NOT NULL CHECK (revision >= 0), policy_id TEXT, policy_version INTEGER,
  assignment_id TEXT, assignment_version INTEGER, current_bundle_id TEXT, current_bundle_version INTEGER,
  last_pass_transition_id TEXT, impact_json TEXT,
  PRIMARY KEY (project_id, sr_id, gate),
  FOREIGN KEY (project_id, sr_id) REFERENCES srs(project_id, sr_id),
  FOREIGN KEY (project_id, policy_id, policy_version) REFERENCES review_policy_versions(project_id, policy_id, version),
  FOREIGN KEY (project_id, sr_id, gate, assignment_id, assignment_version)
    REFERENCES review_assignment_versions(project_id, sr_id, gate, assignment_id, version),
  FOREIGN KEY (project_id, sr_id, gate, current_bundle_id, current_bundle_version)
    REFERENCES review_bundles(project_id, sr_id, gate, bundle_id, version),
  FOREIGN KEY (project_id, sr_id, last_pass_transition_id)
    REFERENCES gate_transition_records(project_id, sr_id, transition_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE gate_transition_records (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, transition_id TEXT NOT NULL,
  gate TEXT NOT NULL CHECK (gate IN ('G1','G2')), review_epoch INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('passed','invalidated')), actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL, occurred_at TEXT NOT NULL, affected_version_refs_json TEXT NOT NULL CHECK (json_valid(affected_version_refs_json)),
  bundle_id TEXT, bundle_version INTEGER, payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, transition_id),
  FOREIGN KEY (project_id, sr_id) REFERENCES srs(project_id, sr_id),
  FOREIGN KEY (project_id, sr_id, gate, bundle_id, bundle_version)
    REFERENCES review_bundles(project_id, sr_id, gate, bundle_id, version)
);

CREATE TABLE comments (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, comment_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL, artifact_kind TEXT NOT NULL, artifact_version INTEGER NOT NULL,
  section_id TEXT NOT NULL, body TEXT NOT NULL, author_id TEXT NOT NULL, created_at TEXT NOT NULL,
  bundle_ref_json TEXT,
  PRIMARY KEY (project_id, sr_id, comment_id),
  FOREIGN KEY (project_id, sr_id, artifact_id, artifact_kind, artifact_version)
    REFERENCES artifact_versions(project_id, sr_id, artifact_id, kind, version),
  FOREIGN KEY (project_id, author_id) REFERENCES demo_user_memberships(project_id, user_id)
);

CREATE TABLE change_requests (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, change_request_id TEXT NOT NULL,
  original_artifact_id TEXT NOT NULL, original_artifact_kind TEXT NOT NULL, original_artifact_version INTEGER NOT NULL,
  original_section_id TEXT NOT NULL, body TEXT NOT NULL, blocking INTEGER NOT NULL CHECK (blocking IN (0,1)),
  affected_gate TEXT NOT NULL CHECK (affected_gate IN ('G1','G2')), assignee_id TEXT NOT NULL, requester_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','awaiting_confirmation','resolved')),
  current_target_json TEXT NOT NULL CHECK (json_valid(current_target_json)), revision INTEGER NOT NULL,
  requested_at TEXT NOT NULL, current_application_event_id TEXT, current_resolution_event_id TEXT,
  due_at TEXT, payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, change_request_id),
  FOREIGN KEY (project_id, sr_id, original_artifact_id, original_artifact_kind, original_artifact_version)
    REFERENCES artifact_versions(project_id, sr_id, artifact_id, kind, version),
  FOREIGN KEY (project_id, assignee_id) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, requester_id) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, change_request_id, current_application_event_id)
    REFERENCES change_request_events(project_id, sr_id, change_request_id, event_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, sr_id, change_request_id, current_resolution_event_id)
    REFERENCES change_request_events(project_id, sr_id, change_request_id, event_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (status <> 'awaiting_confirmation' OR current_application_event_id IS NOT NULL),
  CHECK (status <> 'resolved' OR current_resolution_event_id IS NOT NULL)
);

CREATE TABLE change_request_events (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, change_request_id TEXT NOT NULL,
  event_id TEXT NOT NULL, kind TEXT NOT NULL, actor_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
  before_status TEXT NOT NULL, after_status TEXT NOT NULL,
  target_artifact_id TEXT NOT NULL, target_artifact_kind TEXT NOT NULL, target_artifact_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, change_request_id, event_id),
  UNIQUE (project_id, sr_id, event_id),
  FOREIGN KEY (project_id, sr_id, change_request_id) REFERENCES change_requests(project_id, sr_id, change_request_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, actor_id) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, target_artifact_id, target_artifact_kind, target_artifact_version)
    REFERENCES artifact_versions(project_id, sr_id, artifact_id, kind, version)
);

CREATE TABLE input_snapshots (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, snapshot_id TEXT NOT NULL,
  workflow_version TEXT NOT NULL, task_kind TEXT NOT NULL, content_fingerprint TEXT NOT NULL,
  contents_json TEXT NOT NULL CHECK (json_valid(contents_json)), project_rules_json TEXT NOT NULL CHECK (json_valid(project_rules_json)),
  captured_at TEXT NOT NULL, document_kind TEXT, target_basis_json TEXT,
  PRIMARY KEY (project_id, sr_id, snapshot_id),
  FOREIGN KEY (project_id, sr_id) REFERENCES srs(project_id, sr_id)
);

CREATE TABLE generation_runs (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, run_id TEXT NOT NULL, task_kind TEXT NOT NULL,
  input_snapshot_id TEXT NOT NULL, provider_selection_json TEXT NOT NULL CHECK (json_valid(provider_selection_json)),
  requested_by TEXT NOT NULL, requested_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  revision INTEGER NOT NULL CHECK (revision >= 0), claim_id TEXT, result_draft_id TEXT,
  retry_of_run_id TEXT, started_at TEXT, finished_at TEXT, error_code TEXT,
  cancelled_by TEXT, cancelled_at TEXT, payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, run_id),
  FOREIGN KEY (project_id, sr_id, input_snapshot_id) REFERENCES input_snapshots(project_id, sr_id, snapshot_id),
  FOREIGN KEY (project_id, requested_by) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, run_id, claim_id)
    REFERENCES execution_claims(project_id, sr_id, run_id, claim_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, sr_id, result_draft_id)
    REFERENCES generation_drafts(project_id, sr_id, draft_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, sr_id, retry_of_run_id) REFERENCES generation_runs(project_id, sr_id, run_id),
  CHECK (retry_of_run_id IS NULL OR retry_of_run_id <> run_id),
  CHECK (status <> 'running' OR (claim_id IS NOT NULL AND started_at IS NOT NULL)),
  CHECK (status <> 'succeeded' OR (result_draft_id IS NOT NULL AND finished_at IS NOT NULL)),
  CHECK (status <> 'failed' OR (error_code IS NOT NULL AND finished_at IS NOT NULL)),
  CHECK (status <> 'cancelled' OR (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL))
);

CREATE TABLE execution_claims (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, run_id TEXT NOT NULL, claim_id TEXT NOT NULL,
  owner_runtime_id TEXT NOT NULL, ownership_token_hash TEXT NOT NULL, claimed_at TEXT NOT NULL,
  execution_policy_ref TEXT NOT NULL, launch_intent_id TEXT NOT NULL,
  PRIMARY KEY (project_id, sr_id, run_id, claim_id),
  UNIQUE (project_id, sr_id, run_id),
  FOREIGN KEY (project_id, sr_id, run_id) REFERENCES generation_runs(project_id, sr_id, run_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (owner_runtime_id) REFERENCES runtime_identities(runtime_id)
);

CREATE TABLE execution_observations (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, observation_id TEXT NOT NULL,
  run_id TEXT NOT NULL, claim_id TEXT NOT NULL,
  observation_kind TEXT NOT NULL CHECK (observation_kind = 'termination_confirmed'),
  observed_by_runtime TEXT NOT NULL, observed_at TEXT NOT NULL,
  termination_result_json TEXT NOT NULL CHECK (json_valid(termination_result_json)),
  diagnostic TEXT,
  PRIMARY KEY (project_id, sr_id, observation_id),
  UNIQUE (project_id, sr_id, run_id, claim_id),
  FOREIGN KEY (project_id, sr_id, run_id, claim_id)
    REFERENCES execution_claims(project_id, sr_id, run_id, claim_id),
  FOREIGN KEY (observed_by_runtime) REFERENCES runtime_identities(runtime_id)
);

CREATE TABLE generation_drafts (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, draft_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL, task_kind TEXT NOT NULL, body_json TEXT NOT NULL CHECK (json_valid(body_json)),
  basis_input_snapshot_id TEXT NOT NULL, basis_fingerprint TEXT NOT NULL,
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)), created_at TEXT NOT NULL,
  source_run_id TEXT, source_draft_id TEXT, reviewed_by TEXT, reviewed_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, draft_id),
  FOREIGN KEY (project_id, sr_id, basis_input_snapshot_id) REFERENCES input_snapshots(project_id, sr_id, snapshot_id),
  FOREIGN KEY (project_id, sr_id, source_run_id) REFERENCES generation_runs(project_id, sr_id, run_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (project_id, sr_id, source_draft_id) REFERENCES generation_drafts(project_id, sr_id, draft_id),
  FOREIGN KEY (project_id, reviewed_by) REFERENCES demo_user_memberships(project_id, user_id),
  CHECK (source_draft_id IS NULL OR source_draft_id <> draft_id)
);

CREATE TABLE draft_applications (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, application_id TEXT NOT NULL,
  draft_id TEXT NOT NULL, applied_by TEXT NOT NULL, applied_at TEXT NOT NULL,
  checked_input_fingerprint TEXT NOT NULL, selected_content_json TEXT NOT NULL CHECK (json_valid(selected_content_json)),
  output_refs_json TEXT NOT NULL CHECK (json_valid(output_refs_json)), receipt_id TEXT NOT NULL,
  reason TEXT,
  PRIMARY KEY (project_id, sr_id, application_id),
  UNIQUE (project_id, sr_id, draft_id),
  FOREIGN KEY (project_id, sr_id, draft_id) REFERENCES generation_drafts(project_id, sr_id, draft_id),
  FOREIGN KEY (project_id, applied_by) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, receipt_id) REFERENCES command_receipts(project_id, receipt_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE handoffs (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, handoff_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  g1_gate TEXT NOT NULL DEFAULT 'G1' CHECK (g1_gate = 'G1'),
  g1_bundle_id TEXT NOT NULL, g1_bundle_version INTEGER NOT NULL,
  g2_gate TEXT NOT NULL DEFAULT 'G2' CHECK (g2_gate = 'G2'),
  g2_bundle_id TEXT NOT NULL, g2_bundle_version INTEGER NOT NULL,
  refs_json TEXT NOT NULL CHECK (json_valid(refs_json)), workflow_version TEXT NOT NULL,
  validation_json TEXT NOT NULL CHECK (json_valid(validation_json)), markdown_snapshot TEXT NOT NULL,
  digest TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  previous_handoff_id TEXT, previous_handoff_version INTEGER, reason TEXT,
  PRIMARY KEY (project_id, sr_id, handoff_id, version),
  FOREIGN KEY (project_id, sr_id, g1_gate, g1_bundle_id, g1_bundle_version)
    REFERENCES review_bundles(project_id, sr_id, gate, bundle_id, version),
  FOREIGN KEY (project_id, sr_id, g2_gate, g2_bundle_id, g2_bundle_version)
    REFERENCES review_bundles(project_id, sr_id, gate, bundle_id, version),
  FOREIGN KEY (project_id, created_by) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, sr_id, previous_handoff_id, previous_handoff_version)
    REFERENCES handoffs(project_id, sr_id, handoff_id, version),
  CHECK ((previous_handoff_id IS NULL) = (previous_handoff_version IS NULL)),
  CHECK (previous_handoff_id IS NULL OR previous_handoff_id <> handoff_id OR previous_handoff_version < version)
);

CREATE TABLE implementation_records (
  project_id TEXT NOT NULL, sr_id TEXT NOT NULL, implementation_id TEXT NOT NULL,
  handoff_id TEXT NOT NULL, handoff_version INTEGER NOT NULL, started_by TEXT NOT NULL,
  started_at TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('started','completed')),
  revision INTEGER NOT NULL CHECK (revision >= 0), manual INTEGER NOT NULL CHECK (manual = 1),
  completed_by TEXT, completed_at TEXT, completion_summary TEXT, evidence_json TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, sr_id, implementation_id),
  UNIQUE (project_id, sr_id, handoff_id, handoff_version),
  FOREIGN KEY (project_id, sr_id, handoff_id, handoff_version) REFERENCES handoffs(project_id, sr_id, handoff_id, version),
  FOREIGN KEY (project_id, started_by) REFERENCES demo_user_memberships(project_id, user_id),
  FOREIGN KEY (project_id, completed_by) REFERENCES demo_user_memberships(project_id, user_id),
  CHECK (status <> 'completed' OR (completed_by IS NOT NULL AND completed_at IS NOT NULL AND completion_summary IS NOT NULL AND evidence_json IS NOT NULL))
);

CREATE TABLE activity_events (
  project_id TEXT NOT NULL, activity_id TEXT NOT NULL, sr_id TEXT,
  event_type TEXT NOT NULL, actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL,
  target_refs_json TEXT NOT NULL CHECK (json_valid(target_refs_json)), occurred_at TEXT NOT NULL,
  receipt_id TEXT, internal_basis_json TEXT, description TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  PRIMARY KEY (project_id, activity_id),
  FOREIGN KEY (project_id) REFERENCES workspace_projects(project_id),
  FOREIGN KEY (project_id, sr_id) REFERENCES srs(project_id, sr_id),
  FOREIGN KEY (project_id, receipt_id) REFERENCES command_receipts(project_id, receipt_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (receipt_id IS NOT NULL OR internal_basis_json IS NOT NULL)
);

CREATE TABLE command_receipts (
  project_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('project','sr')),
  scope_target_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  command_kind TEXT NOT NULL,
  request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  committed_revision INTEGER NOT NULL CHECK (committed_revision >= 0),
  result_refs_json TEXT NOT NULL CHECK (json_valid(result_refs_json)),
  replay_value_json TEXT NOT NULL CHECK (json_valid(replay_value_json)),
  committed_at TEXT NOT NULL,
  PRIMARY KEY (project_id, receipt_id),
  UNIQUE (scope_kind, project_id, scope_target_id, actor_id, idempotency_key),
  FOREIGN KEY (project_id) REFERENCES workspace_projects(project_id),
  FOREIGN KEY (project_id, actor_id) REFERENCES demo_user_memberships(project_id, user_id),
  CHECK (scope_kind <> 'project' OR scope_target_id = project_id)
);

CREATE TABLE demo_seed_manifests (
  seed_id TEXT PRIMARY KEY,
  manifest_version TEXT NOT NULL,
  project_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  manifest_digest TEXT NOT NULL,
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  UNIQUE (project_id),
  FOREIGN KEY (project_id) REFERENCES workspace_projects(project_id)
);

INSERT INTO execution_slot(singleton_id) VALUES (1);

CREATE TRIGGER command_receipts_sr_scope_insert
BEFORE INSERT ON command_receipts
WHEN NEW.scope_kind = 'sr' AND NOT EXISTS (
  SELECT 1 FROM srs WHERE project_id = NEW.project_id AND sr_id = NEW.scope_target_id
)
BEGIN
  SELECT RAISE(ABORT, 'command receipt SrScope가 존재하지 않습니다.');
END;

CREATE TRIGGER questions_no_cycle_insert
BEFORE INSERT ON questions
WHEN NEW.parent_question_id IS NOT NULL
BEGIN
  SELECT CASE WHEN EXISTS (
    WITH RECURSIVE ancestors(question_id, parent_question_id) AS (
      SELECT question_id, parent_question_id FROM questions
       WHERE project_id = NEW.project_id AND sr_id = NEW.sr_id AND question_id = NEW.parent_question_id
      UNION ALL
      SELECT q.question_id, q.parent_question_id FROM questions q
      JOIN ancestors a ON q.question_id = a.parent_question_id
       AND q.project_id = NEW.project_id AND q.sr_id = NEW.sr_id
      WHERE a.parent_question_id IS NOT NULL
    )
    SELECT 1 FROM ancestors WHERE question_id = NEW.question_id OR parent_question_id = NEW.question_id
  ) THEN RAISE(ABORT, '질문 관계는 순환할 수 없습니다.') END;
END;

CREATE TRIGGER questions_no_cycle_update
BEFORE UPDATE OF parent_question_id ON questions
WHEN NEW.parent_question_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.parent_question_id = NEW.question_id OR EXISTS (
    WITH RECURSIVE ancestors(question_id, parent_question_id) AS (
      SELECT question_id, parent_question_id FROM questions
       WHERE project_id = NEW.project_id AND sr_id = NEW.sr_id AND question_id = NEW.parent_question_id
      UNION ALL
      SELECT q.question_id, q.parent_question_id FROM questions q
      JOIN ancestors a ON q.question_id = a.parent_question_id
       AND q.project_id = NEW.project_id AND q.sr_id = NEW.sr_id
      WHERE a.parent_question_id IS NOT NULL
    )
    SELECT 1 FROM ancestors WHERE question_id = NEW.question_id OR parent_question_id = NEW.question_id
  ) THEN RAISE(ABORT, '질문 관계는 순환할 수 없습니다.') END;
END;

CREATE TRIGGER review_requests_no_cycle_insert
BEFORE INSERT ON review_requests
WHEN NEW.superseded_by_request_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.superseded_by_request_id = NEW.request_id OR EXISTS (
    WITH RECURSIVE chain(request_id, next_id) AS (
      SELECT request_id, superseded_by_request_id FROM review_requests
       WHERE project_id=NEW.project_id AND sr_id=NEW.sr_id AND request_id=NEW.superseded_by_request_id
      UNION ALL
      SELECT r.request_id, r.superseded_by_request_id FROM review_requests r
      JOIN chain c ON r.request_id=c.next_id
       AND r.project_id=NEW.project_id AND r.sr_id=NEW.sr_id
      WHERE c.next_id IS NOT NULL
    )
    SELECT 1 FROM chain WHERE request_id=NEW.request_id OR next_id=NEW.request_id
  ) THEN RAISE(ABORT, '검토 요청 승계는 순환할 수 없습니다.') END;
END;

CREATE TRIGGER review_requests_no_cycle_update
BEFORE UPDATE OF superseded_by_request_id ON review_requests
WHEN NEW.superseded_by_request_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.superseded_by_request_id = NEW.request_id OR EXISTS (
    WITH RECURSIVE chain(request_id, next_id) AS (
      SELECT request_id, superseded_by_request_id FROM review_requests
       WHERE project_id=NEW.project_id AND sr_id=NEW.sr_id AND request_id=NEW.superseded_by_request_id
      UNION ALL
      SELECT r.request_id, r.superseded_by_request_id FROM review_requests r
      JOIN chain c ON r.request_id=c.next_id
       AND r.project_id=NEW.project_id AND r.sr_id=NEW.sr_id
      WHERE c.next_id IS NOT NULL
    )
    SELECT 1 FROM chain WHERE request_id=NEW.request_id OR next_id=NEW.request_id
  ) THEN RAISE(ABORT, '검토 요청 승계는 순환할 수 없습니다.') END;
END;

CREATE TRIGGER generation_runs_no_retry_cycle_insert
BEFORE INSERT ON generation_runs
WHEN NEW.retry_of_run_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.retry_of_run_id = NEW.run_id OR EXISTS (
    WITH RECURSIVE chain(run_id, next_id) AS (
      SELECT run_id, retry_of_run_id FROM generation_runs
       WHERE project_id=NEW.project_id AND sr_id=NEW.sr_id AND run_id=NEW.retry_of_run_id
      UNION ALL
      SELECT r.run_id, r.retry_of_run_id FROM generation_runs r
      JOIN chain c ON r.run_id=c.next_id
       AND r.project_id=NEW.project_id AND r.sr_id=NEW.sr_id
      WHERE c.next_id IS NOT NULL
    )
    SELECT 1 FROM chain WHERE run_id=NEW.run_id OR next_id=NEW.run_id
  ) THEN RAISE(ABORT, '실행 재시도는 순환할 수 없습니다.') END;
END;

CREATE TRIGGER generation_runs_no_retry_cycle_update
BEFORE UPDATE OF retry_of_run_id ON generation_runs
WHEN NEW.retry_of_run_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.retry_of_run_id = NEW.run_id OR EXISTS (
    WITH RECURSIVE chain(run_id, next_id) AS (
      SELECT run_id, retry_of_run_id FROM generation_runs
       WHERE project_id=NEW.project_id AND sr_id=NEW.sr_id AND run_id=NEW.retry_of_run_id
      UNION ALL
      SELECT r.run_id, r.retry_of_run_id FROM generation_runs r
      JOIN chain c ON r.run_id=c.next_id
       AND r.project_id=NEW.project_id AND r.sr_id=NEW.sr_id
      WHERE c.next_id IS NOT NULL
    )
    SELECT 1 FROM chain WHERE run_id=NEW.run_id OR next_id=NEW.run_id
  ) THEN RAISE(ABORT, '실행 재시도는 순환할 수 없습니다.') END;
END;

CREATE TRIGGER generation_drafts_no_source_cycle_insert
BEFORE INSERT ON generation_drafts
WHEN NEW.source_draft_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.source_draft_id = NEW.draft_id OR EXISTS (
    WITH RECURSIVE chain(draft_id, next_id) AS (
      SELECT draft_id, source_draft_id FROM generation_drafts
       WHERE project_id=NEW.project_id AND sr_id=NEW.sr_id AND draft_id=NEW.source_draft_id
      UNION ALL
      SELECT d.draft_id, d.source_draft_id FROM generation_drafts d
      JOIN chain c ON d.draft_id=c.next_id
       AND d.project_id=NEW.project_id AND d.sr_id=NEW.sr_id
      WHERE c.next_id IS NOT NULL
    )
    SELECT 1 FROM chain WHERE draft_id=NEW.draft_id OR next_id=NEW.draft_id
  ) THEN RAISE(ABORT, '비교 초안 출처는 순환할 수 없습니다.') END;
END;
`;

const immutableTables = [
  'runtime_identities',
  'sr_description_versions', 'context_source_versions', 'artifact_versions',
  'workflow_plan_versions', 'question_answer_versions', 'question_result_snapshots',
  'decision_versions', 'scope_classification_versions', 'review_policy_versions',
  'review_assignment_versions', 'review_bundles', 'approvals', 'gate_transition_records',
  'review_assignment_reviewers',
  'comments', 'change_request_events', 'input_snapshots', 'execution_claims',
  'execution_observations', 'generation_drafts', 'draft_applications', 'handoffs',
  'activity_events', 'command_receipts',
  'demo_seed_manifests',
] as const;

export const IMMUTABILITY_SQL = immutableTables
  .flatMap((table) => [
    `CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is append-only'); END;`,
    `CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is append-only'); END;`,
  ])
  .join('\n');

const sql = `${INITIAL_SCHEMA_SQL}\n${IMMUTABILITY_SQL}`;

export const PLANREPO_MIGRATION_0001: AppMigration = {
  number: 1,
  checksum: createHash('sha256').update(sql).digest('hex'),
  sql,
};

export const PLANREPO_MIGRATIONS = [PLANREPO_MIGRATION_0001] as const;
