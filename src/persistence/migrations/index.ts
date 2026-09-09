import { PLANREPO_MIGRATION_0001 } from './0001-planrepo';
import { PLANREPO_MIGRATION_0002 } from './0002-input-snapshot-supplement';

export type { AppMigration } from './0001-planrepo';
export { PLANREPO_MIGRATION_0001 } from './0001-planrepo';
export { PLANREPO_MIGRATION_0002 } from './0002-input-snapshot-supplement';

export const PLANREPO_MIGRATIONS = [
  PLANREPO_MIGRATION_0001,
  PLANREPO_MIGRATION_0002,
] as const;
