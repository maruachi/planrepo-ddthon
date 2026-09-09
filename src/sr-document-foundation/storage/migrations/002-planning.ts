export const planningSQL = `
CREATE TABLE planning_runs (
 id TEXT PRIMARY KEY NOT NULL, sr_id TEXT NOT NULL REFERENCES srs(id),
 status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
 payload TEXT NOT NULL CHECK(json_valid(payload)), UNIQUE(sr_id,id)
);
CREATE TABLE planning_workflows (
 sr_id TEXT PRIMARY KEY NOT NULL REFERENCES srs(id), revision INTEGER NOT NULL CHECK(revision > 0),
 latest_run_id TEXT, payload TEXT NOT NULL CHECK(json_valid(payload)),
 FOREIGN KEY(sr_id,latest_run_id) REFERENCES planning_runs(sr_id,id)
);
CREATE TABLE planning_version_runs (
 sr_id TEXT NOT NULL, document_id TEXT NOT NULL, version_id TEXT NOT NULL, run_id TEXT NOT NULL,
 PRIMARY KEY(sr_id,document_id,version_id),
 FOREIGN KEY(sr_id,document_id,version_id) REFERENCES document_versions(sr_id,document_id,id),
 FOREIGN KEY(sr_id,run_id) REFERENCES planning_runs(sr_id,id)
);
CREATE TABLE planning_receipt_runs (
 operation_id TEXT PRIMARY KEY NOT NULL REFERENCES command_receipts(operation_id), sr_id TEXT NOT NULL, run_id TEXT NOT NULL,
 FOREIGN KEY(sr_id,run_id) REFERENCES planning_runs(sr_id,id)
);
CREATE INDEX planning_running ON planning_runs(status);
CREATE TRIGGER planning_run_terminal BEFORE UPDATE ON planning_runs WHEN OLD.status <> 'running' BEGIN SELECT RAISE(ABORT,'terminal run'); END;
CREATE TRIGGER planning_run_identity BEFORE UPDATE OF id,sr_id ON planning_runs BEGIN SELECT RAISE(ABORT,'immutable run identity'); END;
${['planning_runs', 'planning_workflows', 'planning_version_runs', 'planning_receipt_runs'].map(t => `CREATE TRIGGER ${t}_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT,'immutable planning record'); END;`).join('\n')}
${['planning_version_runs', 'planning_receipt_runs'].map(t => `CREATE TRIGGER ${t}_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT,'immutable planning link'); END;`).join('\n')}
`;
