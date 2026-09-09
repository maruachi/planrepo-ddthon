# CG-03 구현 지시서

아래 승인 과제와 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`를 따릅니다. CG-01·CG-02가 검증된 뒤 시작합니다.

### CG-03 35개 엔티티 관계 스키마와 원자적 저장·receipt 기반

**구현 묶음**: B-01입니다. **선행**: CG-01, CG-02입니다.

**연결 기준**: US-001, US-002, US-003, ENT-01, ENT-02, ENT-03, ENT-04, ENT-05, ENT-06, ENT-07, ENT-08, ENT-09, ENT-10, ENT-11, ENT-12, ENT-13, ENT-14, ENT-15, ENT-16, ENT-17, ENT-18, ENT-19, ENT-20, ENT-21, ENT-22, ENT-23, ENT-24, ENT-25, ENT-26, ENT-27, ENT-28, ENT-29, ENT-30, ENT-31, ENT-32, ENT-33, ENT-34, ENT-35, SCN-01, SCN-14, SCN-17, SCN-24, NQ-02, NQ-04, NQ-05, NQ-06, NQ-07, NQ-08, NQ-14, NQ-21, NQ-23, ND-01, ND-02, ND-08, ND-10, ND-13, INF-02, INF-04, INF-08, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/results.ts` | 갱신합니다. | ReceiptResultRef를 EntityRef·VersionRef·BundleRef union으로 표현해 불변 결과를 보존합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 불변 버전·묶음 receipt의 정상 타입 사례를 검증합니다. |
| `src/persistence/migrations/0001-planrepo.ts` | 생성합니다. | ENT-01부터 ENT-35까지의 초기 DDL, 복합 범위 FK·고유 제약·bootstrap registry를 한곳에서 정의합니다. |
| `src/persistence/database.ts` | 생성합니다. | 단일 connection의 DELETE/FULL/FK ON/busy timeout 확인과 준비 실패를 처리합니다. |
| `src/persistence/failure.ts` | 생성합니다. | transaction과 maintenance의 rollback·IOERR/손상 connection 폐기를 순환 의존 없이 공유합니다. |
| `src/persistence/transaction.ts` | 생성합니다. | 동기 withinTransaction/readConsistent와 rollback·connection 불확실 상태를 처리합니다. |
| `src/persistence/command-receipts.ts` | 생성합니다. | NULL 없는 receipt 고유 키와 입력 지문·고정 결과 참조를 저장합니다. |
| `src/persistence/maintenance.ts` | 생성합니다. | 동시 시작과 offline migration/seed의 공통 DB 소유권 경계를 구현합니다. |
| `tests/helpers/test-database.ts` | 생성합니다. | HTTP 없는 createTestDatabase와 실제 연결·close를 제공합니다. |
| `tests/integration/storage-atomicity.test.ts` | 생성합니다. | 실제 SQLite rollback·FK·receipt 경쟁·재개방을 검사합니다. |
| `aidlc-docs/construction/planrepo/code/storage-and-schema.md` | 생성합니다. | 35개 ENT의 테이블·키·FK·현재 포인터·불변 버전 및 migration 결과를 기록합니다. |
| `aidlc-docs/construction/planrepo/code/repository-summary.md` | 생성합니다. | 저장 포트와 트랜잭션 소유를 정리합니다. |

**인터페이스와 입력 조건**

HTTP나 createTestApp에 의존하지 않는 DB 직접 테스트입니다. createTestDatabase({testRunId})는 독립 경로의 실제 DB와 close를 반환하고 createPersistence(db)의 withinTransaction(work)는 같은 connection을 동기 callback에 전달합니다. 초기 DDL은 35개 업무 ENT와 별도 runtime/maintenance/slot 보조 자료를 만들되 각 업무 행동은 뒤 task에서 구현합니다. 자기 참조·현재 포인터는 같은 SrScope의 불변 버전만 가리키고 업무 참조는 프로젝트 절대경로를 저장하지 않습니다.

- [ ] **Step 013: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from '@/tests/helpers/test-database';
import { createPersistence } from '@/src/persistence/transaction';

it('callback 실패가 업무와 receipt 성격의 두 쓰기를 모두 취소합니다', async () => {
  const fixture = await createTestDatabase({ testRunId: randomUUID() });
  try {
    const db = fixture.db;
    db.exec('CREATE TEMP TABLE atomic_values (id TEXT PRIMARY KEY)');
    db.exec('CREATE TEMP TABLE atomic_receipts (id TEXT PRIMARY KEY)');
    const persistence = createPersistence(db);
    expect(() => persistence.withinTransaction(tx => {
      tx.prepare('INSERT INTO atomic_values(id) VALUES (?)').run('version-1');
      tx.prepare('INSERT INTO atomic_receipts(id) VALUES (?)').run('receipt-1');
      throw new Error('주입한 저장 실패');
    })).toThrow('주입한 저장 실패');
    expect(db.prepare('SELECT count(*) AS n FROM atomic_values').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM atomic_receipts').get()).toEqual({ n: 0 });
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {
    await fixture.close();
  }
});
```

- [ ] **Step 014: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/storage-atomicity.test.ts
```

예상 결과는 다음과 같습니다. 모듈·harness의 수집 가능 상태를 BOOT/CONTRACT에서 준비합니다. 초기 비원자적 저장 구현에서 주입한 예외 뒤 행이 남아 count=0 단언이 실패해야 합니다. import/설치 실패나 SQLite 자체 예외만을 예상 RED로 집계하지 않습니다.

- [ ] **Step 015: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

db.transaction(work).immediate()를 감싸되 callback은 Promise를 반환하지 못하게 검사합니다. rollback 여부를 확인할 수 없는 IO/commit 실패는 connection을 폐기하고 readiness를 내립니다. receipt UNIQUE(scope_kind, project_id, scope_target_id, actor_id, idempotency_key)를 만들고 command_kind는 비교값으로 둡니다. ProjectScope의 scope_target_id=projectId로 NULL을 없앱니다. app_migrations 번호/checksum과 DDL/DML을 같은 commit에 넣고 내부 schema_version을 수정하지 않습니다. backend 등록은 BEGIN IMMEDIATE 안에서 maintenance·지원 schema를 재확인해 확정하고, offline 유지보수는 BEGIN EXCLUSIVE 이후 runtime/slot/running 재확인부터 commit까지 같은 잠금을 유지합니다. FK·SR 소속·불변 버전의 append-only repository 경계를 만들고 receipt/activity를 임의 삭제하지 않습니다.

- [ ] **Step 016: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/storage-atomicity.test.ts
npm run typecheck
```

통과 조건은 다음과 같습니다. 대표 rollback, 각 업무 쓰기 지점의 실패 주입, 다른 connection의 동일 키 경쟁, schema mismatch, migration/seed 경쟁과 실패 보존, 재개방 검증이 통과합니다. DELETE/FULL을 전원 손실 무손실 보장으로 확대하지 않습니다.

- [ ] **Step 017: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 018: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

35개 ENT 대응표·FK 검사·소속 위반·NULL 없는 receipt 고유성·불변 버전 보존과 metadata 원자성을 검증합니다. 실제 업무 API 원자성은 SR_CONTEXT부터 확대합니다. HTTP와 순환 의존하지 않으며 실제 실행 명령·exit code를 문서에 기록합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

