import type { DatabaseConnection } from '@/src/persistence/database';
import type { RuntimeRegistration } from '@/src/persistence/maintenance';
import {
  assertSupportedSchema,
  registerRuntime,
  unregisterRuntime,
} from '@/src/persistence/maintenance';

export interface ReadinessStatus {
  readonly storageReady: boolean;
  readonly generationReady: boolean;
  readonly publicCode: 'READY' | 'STORE_UNAVAILABLE';
}

export interface AppLifecycle {
  start(): Promise<void>;
  readiness(): ReadinessStatus;
  setGenerationReady(ready: boolean): void;
  close(): Promise<void>;
}

export function createAppLifecycle(
  db: DatabaseConnection,
  registration: RuntimeRegistration,
): AppLifecycle {
  let storageReady = false;
  let generationReady = false;
  let registered = false;
  let closed = false;
  return {
    async start() {
      if (closed || registered) return;
      try {
        assertSupportedSchema(db);
        registerRuntime(db, registration);
        registered = true;
        storageReady = true;
      } catch {
        storageReady = false;
      }
    },
    readiness() {
      return {
        storageReady,
        generationReady,
        publicCode: storageReady ? 'READY' : 'STORE_UNAVAILABLE',
      };
    },
    setGenerationReady(ready) {
      generationReady = ready;
    },
    async close() {
      if (closed) return;
      storageReady = false;
      generationReady = false;
      try {
        if (registered && !db.open) {
          throw new Error('runtime 활성 등록 해제를 완료하지 못했습니다.');
        }
        if (registered) {
          unregisterRuntime(db, registration.runtimeId);
          registered = false;
        }
        closed = true;
      } finally {
        if (db.open) db.close();
      }
    },
  };
}
