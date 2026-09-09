import { createHash } from 'node:crypto';
import type { AppMigration } from './0001-planrepo';

export const INPUT_SNAPSHOT_SUPPLEMENT_SQL = String.raw`
ALTER TABLE input_snapshots ADD COLUMN supplement TEXT;

UPDATE artifacts
   SET design_stage = 'functional'
 WHERE kind = 'design'
   AND design_stage = 'functional_design';
`;

export const PLANREPO_MIGRATION_0002: AppMigration = {
  number: 2,
  checksum: createHash('sha256').update(INPUT_SNAPSHOT_SUPPLEMENT_SQL).digest('hex'),
  sql: INPUT_SNAPSHOT_SUPPLEMENT_SQL,
};
