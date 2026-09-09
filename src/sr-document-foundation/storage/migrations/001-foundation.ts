export const foundationSQL = `
CREATE TABLE srs (
 id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL CHECK(length(CAST(title AS BLOB)) BETWEEN 1 AND 4096),
 description TEXT NOT NULL CHECK(length(CAST(description AS BLOB)) BETWEEN 1 AND 1048576),
 attachment_markdown TEXT CHECK(length(CAST(attachment_markdown AS BLOB)) <= 1048576),
 attachment_display_name TEXT CHECK(length(CAST(attachment_display_name AS BLOB)) <= 4096),
 created_at TEXT NOT NULL, actor_source TEXT NOT NULL, actor_role TEXT,
 workflow_column TEXT NOT NULL CHECK(workflow_column IN ('sr_list','requirements_analysis','inception','construction','implementation_ready','implemented'))
);
CREATE TABLE documents (
 id TEXT PRIMARY KEY NOT NULL, sr_id TEXT NOT NULL REFERENCES srs(id), logical_key TEXT NOT NULL,
 latest_version_id TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(sr_id,id), UNIQUE(sr_id,logical_key),
 FOREIGN KEY(sr_id,id,latest_version_id) REFERENCES document_versions(sr_id,document_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE document_versions (
 id TEXT PRIMARY KEY NOT NULL, sr_id TEXT NOT NULL, document_id TEXT NOT NULL,
 version_number INTEGER NOT NULL CHECK(version_number > 0 AND version_number <= 9007199254740991),
 title TEXT NOT NULL CHECK(length(CAST(title AS BLOB)) BETWEEN 1 AND 4096),
 body TEXT NOT NULL CHECK(length(CAST(body AS BLOB)) <= 1048576),
 origin TEXT NOT NULL CHECK(origin IN ('ai_generated','human_edit','restoration')),
 created_at TEXT NOT NULL, actor_source TEXT NOT NULL, actor_role TEXT,
 base_version_id TEXT, source_version_id TEXT, run_id TEXT,
 UNIQUE(sr_id,document_id,id), UNIQUE(document_id,version_number),
 FOREIGN KEY(sr_id,document_id) REFERENCES documents(sr_id,id),
 FOREIGN KEY(sr_id,document_id,base_version_id) REFERENCES document_versions(sr_id,document_id,id),
 FOREIGN KEY(sr_id,document_id,source_version_id) REFERENCES document_versions(sr_id,document_id,id)
);
CREATE TABLE history_events (
 id TEXT PRIMARY KEY NOT NULL, sr_id TEXT NOT NULL REFERENCES srs(id),
 sequence INTEGER NOT NULL CHECK(sequence > 0 AND sequence <= 9007199254740991),
 kind TEXT NOT NULL, actor_source TEXT NOT NULL, actor_role TEXT, occurred_at TEXT NOT NULL,
 summary TEXT NOT NULL, subject_json TEXT, details_json TEXT,
 UNIQUE(sr_id,id), UNIQUE(sr_id,sequence)
);
CREATE TABLE event_version_refs (
 sr_id TEXT NOT NULL, event_id TEXT NOT NULL, document_id TEXT NOT NULL, version_id TEXT NOT NULL,
 PRIMARY KEY(sr_id,event_id,document_id,version_id),
 FOREIGN KEY(sr_id,event_id) REFERENCES history_events(sr_id,id),
 FOREIGN KEY(sr_id,document_id,version_id) REFERENCES document_versions(sr_id,document_id,id)
);
CREATE TABLE command_receipts (
 operation_id TEXT PRIMARY KEY NOT NULL, command_kind TEXT NOT NULL, fingerprint TEXT NOT NULL,
 sr_id TEXT NOT NULL REFERENCES srs(id), document_id TEXT, version_id TEXT, changed INTEGER NOT NULL CHECK(changed IN (0,1)), committed_at TEXT NOT NULL,
 CHECK((document_id IS NULL AND version_id IS NULL) OR (document_id IS NOT NULL AND version_id IS NOT NULL)),
 FOREIGN KEY(sr_id,document_id,version_id) REFERENCES document_versions(sr_id,document_id,id)
);
CREATE INDEX srs_order ON srs(created_at,id);
CREATE INDEX documents_order ON documents(sr_id,created_at,id);
CREATE INDEX event_document ON event_version_refs(sr_id,document_id,event_id);
${['document_versions', 'history_events', 'event_version_refs', 'command_receipts'].flatMap(table => ['UPDATE', 'DELETE'].map(action => `CREATE TRIGGER ${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT, 'immutable record'); END;`)).join('\n')}
CREATE TRIGGER sr_input_immutable BEFORE UPDATE OF id,title,description,attachment_markdown,attachment_display_name,created_at,actor_source,actor_role ON srs BEGIN SELECT RAISE(ABORT,'immutable input'); END;
CREATE TRIGGER document_identity_immutable BEFORE UPDATE OF id,sr_id,logical_key,created_at ON documents BEGIN SELECT RAISE(ABORT,'immutable document'); END;
`;
