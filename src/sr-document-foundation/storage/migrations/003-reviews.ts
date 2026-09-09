export const reviewSQL = `
CREATE TABLE reviews (
 id TEXT PRIMARY KEY NOT NULL, sr_id TEXT NOT NULL, document_id TEXT NOT NULL, version_id TEXT NOT NULL,
 requested_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('requested','approved','changes_requested')),
 payload TEXT NOT NULL CHECK(json_valid(payload)), UNIQUE(sr_id,id),
 FOREIGN KEY(sr_id,document_id,version_id) REFERENCES document_versions(sr_id,document_id,id)
);
CREATE TABLE review_receipts (
 operation_id TEXT PRIMARY KEY NOT NULL REFERENCES command_receipts(operation_id), sr_id TEXT NOT NULL, review_id TEXT NOT NULL,
 FOREIGN KEY(sr_id,review_id) REFERENCES reviews(sr_id,id)
);
CREATE INDEX reviews_order ON reviews(sr_id,requested_at,id);
CREATE INDEX reviews_pending ON reviews(sr_id,status);
CREATE TRIGGER review_identity BEFORE UPDATE OF id,sr_id,document_id,version_id,requested_at ON reviews BEGIN SELECT RAISE(ABORT,'immutable review target'); END;
CREATE TRIGGER review_terminal BEFORE UPDATE ON reviews WHEN OLD.status <> 'requested' BEGIN SELECT RAISE(ABORT,'terminal review'); END;
CREATE TRIGGER review_no_delete BEFORE DELETE ON reviews BEGIN SELECT RAISE(ABORT,'immutable review'); END;
CREATE TRIGGER review_receipts_update BEFORE UPDATE ON review_receipts BEGIN SELECT RAISE(ABORT,'immutable review receipt'); END;
CREATE TRIGGER review_receipts_delete BEFORE DELETE ON review_receipts BEGIN SELECT RAISE(ABORT,'immutable review receipt'); END;
`;
