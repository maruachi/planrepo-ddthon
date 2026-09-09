export const worktreeSpikeSQL = `
CREATE TABLE worktree_spike_states (
 sr_id TEXT PRIMARY KEY NOT NULL REFERENCES srs(id),
 updated_at TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload))
);
CREATE TRIGGER worktree_spike_identity BEFORE UPDATE OF sr_id ON worktree_spike_states BEGIN SELECT RAISE(ABORT,'immutable worktree spike identity'); END;
CREATE TRIGGER worktree_spike_no_delete BEFORE DELETE ON worktree_spike_states BEGIN SELECT RAISE(ABORT,'immutable worktree spike state'); END;
`;
