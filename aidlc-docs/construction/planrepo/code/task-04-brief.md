# CG-04 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약 해석은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, 최신 Claude 실행 결정은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`입니다. 선행 과제의 실제 코드와 테스트를 사용합니다.

### CG-04 정지 상태의 schema 준비와 원자적 DEMO-4 시드

**구현 묶음**: B-01입니다. **선행**: CG-03입니다.

**연결 기준**: US-001, US-002, US-003, ENT-01, ENT-02, ENT-03, ENT-04, ENT-05, ENT-06, ENT-07, ENT-08, ENT-09, ENT-10, ENT-11, ENT-12, ENT-13, ENT-14, ENT-15, ENT-16, ENT-17, ENT-18, ENT-19, ENT-20, ENT-21, ENT-22, ENT-23, ENT-24, ENT-25, ENT-26, ENT-27, ENT-28, ENT-29, ENT-30, ENT-31, ENT-32, ENT-33, ENT-34, ENT-35, SCN-01, SCN-24, NQ-01, NQ-05, NQ-06, NQ-23, ND-01, ND-13, INF-04, INF-09, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `config/demo/manifest.json` | 생성합니다. | 가상 프로젝트·사용자와 네 SR의 고정 ID·초기 상태·자료 버전입니다. |
| `config/demo/scenarios.json` | 생성합니다. | PAY-102·AUTH-331·NOTI-028·CAT-093의 관계가 유효한 업무 시드입니다. |
| `config/demo/reference-mocks.json` | 생성합니다. | Jira·GitHub와 내부 검토 사례의 가상 근거입니다. |
| `src/persistence/seed-demo.ts` | 생성합니다. | seedDemo(db)와 빈 업무 자료 검사·한 번의 확정입니다. |
| `scripts/db-migrate.ts` | 생성합니다. | offline maintenance 경계에서 schema/checksum을 검사·적용합니다. |
| `scripts/seed-demo.ts` | 생성합니다. | 명시 seed 명령과 거절 exit code입니다. |
| `tests/helpers/demo-manifest.ts` | 생성합니다. | readDemoManifest(db)의 읽기 전용 typed 가상 ID/상태 조회입니다. |
| `tests/integration/demo-seed.test.ts` | 생성합니다. | schema만 있는 빈 DB·중간 실패·기존 자료 거절·네 시드 관계를 검사합니다. |

**CAT-093 상태 해석**: 승인 요구사항의 ‘구현 중·재검토 필요’는 과거 H1의 ImplementationRecord.status=started와 현재 progressStage=requirements의 공존입니다. G1 기준 변경 이력과 G1·종속 G2의 invalid/새 epoch/needsNewBundle을 함께 보존합니다. BR-21에 따라 제품 단계를 implementing에 남기지 않습니다. 원래 승인·묶음·인계·시작 사실은 삭제하지 않습니다.

**인터페이스와 입력 조건**

seedDemo(db: DatabaseConnection): void는 지원 schema의 빈 업무 DB에 네 SR과 관련 불변 자료·manifest를 한 트랜잭션으로 기록합니다. 이미 seed 완료 표식이나 업무 자료가 있으면 거절합니다. createTestDatabase는 STORAGE의 실제 DB helper입니다. readDemoManifest(db)는 {projectId,personaIds,srIds}와 명시 가상 자료의 ID만 반환하며 역할을 변경하거나 DB에 쓰지 않습니다. tests/helpers/domain-cases.ts의 demoCase는 이 manifest와 동일한 고정 자료를 읽습니다.

- [x] **Step 019: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from '@/tests/helpers/test-database';
import { seedDemo } from '@/src/persistence/seed-demo';

test('이미 시드한 업무 자료를 다시 덮어쓰지 않는다', async () => {
  const fixture = await createTestDatabase({ testRunId: randomUUID() });
  try {
    seedDemo(fixture.db);
    const before = fixture.db.prepare('SELECT * FROM srs ORDER BY sr_id').all();
    expect(before).toHaveLength(4);
    expect(() => seedDemo(fixture.db)).toThrow();
    expect(fixture.db.prepare('SELECT * FROM srs ORDER BY sr_id').all()).toEqual(before);
  } finally { await fixture.close(); }
});
```

- [x] **Step 020: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/demo-seed.test.ts
```

예상 결과는 다음과 같습니다. seed 구현 전 실패하거나, 두 번째 실행이 기존 자료를 덮어쓰면 거절 assertion이 실패합니다.

- [x] **Step 021: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

PAY-102는 requirements와 미해결 질문, AUTH-331은 planning과 반영 확인 대기, NOTI-028은 유효한 G1/G2의 구현 준비 완료, CAT-093은 외부 시작 이력과 재검토 필요 상태로 구성합니다. 시드에는 각 상태를 뒷받침하는 문서·질문/결정·정책·배정·묶음·승인·인계 refs를 함께 넣고 FK·게이트 조건을 검사합니다. CLI 진입은 offline maintenance를 획득하고 기존 runtime/slot/running을 검사합니다. 업무 emptiness 확인부터 자료 전체·완료 manifest까지 같은 commit에 둡니다.

```ts
const insertDemo = db.transaction(() => {
  assertBusinessStoreEmpty(db);
  insertValidatedDemoGraph(db, manifest);
  recordSeedManifest(db, manifest.version);
});
insertDemo.exclusive();
```

assertBusinessStoreEmpty·insertValidatedDemoGraph·recordSeedManifest는 seed-demo.ts의 내부 함수이며 같은 connection만 사용합니다. 첫 함수는 업무 ENT와 seed 표식의 부재를 검사하고 두 번째는 검증한 가상 그래프만 입력받습니다. 중간 삽입 실패·seed 직전 다른 runtime 등록·반복 실행을 검사합니다. 제품의 일반 start/조회에서는 seed를 호출하지 않습니다.

- [x] **Step 022: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/demo-seed.test.ts tests/integration/storage-atomicity.test.ts
```

통과 조건은 다음과 같습니다. 빈 schema DB의 4개 SR과 유효 참조, 중간 실패 전체 rollback, 기존 자료·완료표식·active/unknown 실행의 유지보수 거절이 통과합니다.

- [x] **Step 023: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 024: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

db:migrate·seed:demo 명령이 실제 경로와 exit code로 연결됩니다. fixture가 제공하는 초기 승인 상태와 이후 실제 사용자 흐름의 통과를 구분합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
