export const worktreeDocumentHistorySQL = `
CREATE TABLE worktree_documents (
 sr_id TEXT NOT NULL REFERENCES srs(id),
 path TEXT NOT NULL,
 latest_version_id TEXT,
 latest_change TEXT NOT NULL CHECK(latest_change IN ('created','modified','unchanged')),
 PRIMARY KEY(sr_id,path),
 FOREIGN KEY(sr_id,latest_version_id) REFERENCES worktree_document_versions(sr_id,id)
);
CREATE TABLE worktree_document_versions (
 id TEXT PRIMARY KEY NOT NULL,
 sr_id TEXT NOT NULL,
 path TEXT NOT NULL,
 version_number INTEGER NOT NULL CHECK(version_number > 0),
 hash TEXT NOT NULL CHECK(length(hash)=64),
 body TEXT NOT NULL,
 origin TEXT NOT NULL CHECK(origin IN ('ai_generated','human_edit')),
 created_at TEXT NOT NULL,
 previous_version_id TEXT,
 source_operation_id TEXT,
 UNIQUE(sr_id,id),
 UNIQUE(sr_id,path,version_number),
 FOREIGN KEY(sr_id,path) REFERENCES worktree_documents(sr_id,path),
 FOREIGN KEY(sr_id,previous_version_id) REFERENCES worktree_document_versions(sr_id,id)
);
CREATE TABLE worktree_document_edit_receipts (
 operation_id TEXT PRIMARY KEY NOT NULL,
 fingerprint TEXT NOT NULL,
 sr_id TEXT NOT NULL,
 path TEXT NOT NULL,
 expected_hash TEXT NOT NULL CHECK(length(expected_hash)=64),
 version_id TEXT NOT NULL,
 changed INTEGER NOT NULL CHECK(changed IN (0,1)),
 created_at TEXT NOT NULL,
 FOREIGN KEY(sr_id,path) REFERENCES worktree_documents(sr_id,path),
 FOREIGN KEY(sr_id,version_id) REFERENCES worktree_document_versions(sr_id,id)
);
CREATE INDEX worktree_document_versions_order ON worktree_document_versions(sr_id,path,version_number DESC);
CREATE INDEX worktree_document_receipts_owner ON worktree_document_edit_receipts(sr_id,path,created_at);
CREATE TRIGGER worktree_document_identity BEFORE UPDATE OF sr_id,path ON worktree_documents BEGIN SELECT RAISE(ABORT,'immutable worktree document identity'); END;
CREATE TRIGGER worktree_document_no_delete BEFORE DELETE ON worktree_documents BEGIN SELECT RAISE(ABORT,'immutable worktree document'); END;
CREATE TRIGGER worktree_document_versions_update BEFORE UPDATE ON worktree_document_versions BEGIN SELECT RAISE(ABORT,'immutable worktree document version'); END;
CREATE TRIGGER worktree_document_versions_delete BEFORE DELETE ON worktree_document_versions BEGIN SELECT RAISE(ABORT,'immutable worktree document version'); END;
CREATE TRIGGER worktree_document_receipts_update BEFORE UPDATE ON worktree_document_edit_receipts BEGIN SELECT RAISE(ABORT,'immutable worktree document receipt'); END;
CREATE TRIGGER worktree_document_receipts_delete BEFORE DELETE ON worktree_document_edit_receipts BEGIN SELECT RAISE(ABORT,'immutable worktree document receipt'); END;
`;
