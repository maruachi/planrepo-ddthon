export const worktreeReviewSQL = `
CREATE TABLE worktree_reviews (
 id TEXT PRIMARY KEY NOT NULL, sr_id TEXT NOT NULL REFERENCES srs(id),
 document_path TEXT NOT NULL, document_hash TEXT NOT NULL CHECK(length(document_hash)=64),
 requested_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('requested','approved','changes_requested')),
 payload TEXT NOT NULL CHECK(json_valid(payload)), UNIQUE(sr_id,id)
);
CREATE TABLE worktree_review_receipts (
 operation_id TEXT PRIMARY KEY NOT NULL REFERENCES command_receipts(operation_id), sr_id TEXT NOT NULL, review_id TEXT NOT NULL,
 FOREIGN KEY(sr_id,review_id) REFERENCES worktree_reviews(sr_id,id)
);
CREATE INDEX worktree_reviews_order ON worktree_reviews(sr_id,requested_at,id);
CREATE INDEX worktree_reviews_pending ON worktree_reviews(sr_id,status);
CREATE TRIGGER worktree_review_identity BEFORE UPDATE OF id,sr_id,document_path,document_hash,requested_at ON worktree_reviews BEGIN SELECT RAISE(ABORT,'immutable worktree review target'); END;
CREATE TRIGGER worktree_review_terminal BEFORE UPDATE ON worktree_reviews WHEN OLD.status <> 'requested' BEGIN SELECT RAISE(ABORT,'terminal worktree review'); END;
CREATE TRIGGER worktree_review_no_delete BEFORE DELETE ON worktree_reviews BEGIN SELECT RAISE(ABORT,'immutable worktree review'); END;
CREATE TRIGGER worktree_review_receipts_update BEFORE UPDATE ON worktree_review_receipts BEGIN SELECT RAISE(ABORT,'immutable worktree review receipt'); END;
CREATE TRIGGER worktree_review_receipts_delete BEFORE DELETE ON worktree_review_receipts BEGIN SELECT RAISE(ABORT,'immutable worktree review receipt'); END;
`;
