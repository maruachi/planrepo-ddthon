# CG-03 구현 보고서

## 결과

35개 업무 ENT의 SQLite table, 복합 범위 FK, 필수 current 포인터, append-only trigger, CommandReceipt와 replay 저장, 원자적 migration, runtime 등록과 offline maintenance 잠금 기반을 구현했습니다. HTTP나 DEMO-4 seed에 의존하지 않는 실제 파일 DB fixture로 검증했습니다.

`CommandReceipt.resultRefs`가 불변 VersionRef와 BundleRef를 표현하지 못하던 계약을 `ReceiptResultRef = EntityRef | VersionRef | BundleRef`로 보완했습니다. 저장층은 `resultRefs`, `committedRevision`과 전체 replay 값을 JSON으로 고정합니다. 현재 포인터가 바뀌고 DB를 재개방해도 원래 결과를 반환합니다.

## 변경 파일

- `src/persistence/migrations/0001-planrepo.ts`
- `src/persistence/database.ts`
- `src/persistence/failure.ts`
- `src/persistence/transaction.ts`
- `src/persistence/command-receipts.ts`
- `src/persistence/maintenance.ts`
- `src/contracts/results.ts`
- `tests/helpers/test-database.ts`
- `tests/integration/storage-atomicity.test.ts`
- `tests/contract/public-methods.test.ts`
- `aidlc-docs/construction/planrepo/code/storage-and-schema.md`
- `aidlc-docs/construction/planrepo/code/repository-summary.md`
- `aidlc-docs/construction/plans/planrepo-code-generation-plan.md`
- `aidlc-docs/construction/planrepo/code/task-03-report.md`

## TDD 증거

첫 테스트 작성 직후 저장 모듈이 없어 `npm test -- tests/integration/storage-atomicity.test.ts`가 exit 1과 import 오류로 끝났습니다. 이 결과는 계획에서 금지한 수집 실패이므로 RED로 집계하지 않았습니다. 최소 수집 골격 뒤 같은 명령을 다시 실행했습니다. callback 예외 후 `{ n: 1 }`이 남아 `{ n: 0 }` 단언이 실패하는 의도한 RED를 exit 1로 확인했습니다.

추가 RED/GREEN은 다음과 같습니다.

| 명령 | RED 결과 | 최소 변경 뒤 GREEN |
|---|---|---|
| `npm test -- tests/integration/storage-atomicity.test.ts` | 원자성 1개 실패, async/Promise 경계 3개 실패, schema 3개 실패, receipt 2개 실패, maintenance async/owner 3개 실패, seed registry 1개 실패, schema FK shape 1개 실패, schema mismatch 1개 실패, migration owner 1개 실패, 자기 참조 순환 1개 실패를 각 변경 전에 확인했습니다. 모두 exit 1입니다. | 마지막 대상 실행에서 29개 통과, exit 0입니다. |
| `npm run typecheck` | 고정 receipt에 Artifact VersionRef와 BundleRef를 넣은 정상 사례가 TS2353과 TS2322로 실패했습니다. exit 1입니다. | `ReceiptResultRef` 추가 뒤 exit 0입니다. |

execution slot FK를 먼저 추가한 중간 변경에서는 초기 singleton row가 아직 생성되지 않은 `execution_claims`를 참조해 21개 테스트가 `no such table: main.execution_claims`로 실패했습니다. bootstrap row 삽입을 전체 table 생성 뒤로 옮겨 원인을 수정했습니다. 이 실패를 정상 RED로 집계하지 않았습니다.

## 구현 경계

- Connection마다 DELETE journal, FULL synchronous, FK ON, 100ms busy timeout과 recursive trigger ON을 설정하고 다시 읽어 확인합니다.
- 업무 write는 `BEGIN IMMEDIATE`, 일관된 read는 짧은 deferred transaction을 사용합니다. 둘 다 잠금 안에서 migration 번호와 checksum을 확인합니다.
- 알려진 async function callback은 호출 전에 거절합니다. 일반 callback이 Promise나 thenable을 반환하면 내부에서 throw해 rollback하고 connection을 닫아 continuation의 후속 DB 쓰기를 차단합니다.
- 최초 migration은 `BEGIN EXCLUSIVE`부터 DDL, bootstrap row와 `app_migrations` row까지 한 commit으로 처리합니다. 후속 migration 실패도 이전 schema와 migration 기록을 보존합니다.
- Runtime 등록은 `BEGIN IMMEDIATE` 안에서 schema와 maintenance 부재를 재확인하고 불변 identity와 활성 등록을 함께 저장합니다. 해제는 활성 등록만 삭제해 terminal Run의 과거 Claim과 identity를 보존합니다. Offline maintenance는 `BEGIN EXCLUSIVE` 뒤 기존 owner, 활성 runtime, execution slot과 running Run을 재확인합니다.
- CommandReceipt의 고유 키는 `(scope_kind, project_id, scope_target_id, actor_id, idempotency_key)`입니다. 다섯 열은 모두 `NOT NULL`이고 `command_kind`는 고유 키에 포함하지 않습니다.
- ProjectScope의 `scope_target_id=project_id`를 CHECK로 강제합니다. SrScope는 같은 프로젝트의 실제 SR인지 trigger로 검사합니다. Actor는 같은 프로젝트 membership에 복합 FK로 묶습니다.
- 필수 SR/ContextSource/Artifact/Question current 포인터는 `DEFERRABLE INITIALLY DEFERRED` 복합 FK입니다. 부모와 최초 불변 자식을 한 transaction에서 완성합니다.
- Question parent, ReviewRequest 승계, GenerationRun retry와 GenerationDraft source의 2개 이상 노드 순환을 recursive trigger로 거절합니다. 이전 version 관계는 같은 범위·논리 ID와 더 작은 번호를 요구합니다.
- Handoff와 ReviewBundle의 이전 ref는 이전 논리 ID와 version을 모두 보존합니다. Handoff의 주 키는 `(project_id, sr_id, handoff_id, version)`이며 같은 ID의 후속 version을 허용합니다.
- 35개 업무 ENT와 별도로 `app_migrations`, `maintenance_state`, `runtime_identities`, `runtime_instances`, `execution_slot`, `demo_seed_manifests`와 관계용 join table을 둡니다.

고정 JSON에 담는 다형/배열 ref는 DB FK만으로 kind별 소속을 검증할 수 없습니다. 각 후속 업무 repository와 CG-04 seed validator가 모든 `projectId`, `srId`, kind, 논리 ID, version과 gate를 transaction 안에서 검사해야 합니다. 이 책임은 `storage-and-schema.md`와 `repository-summary.md`에 기록했습니다.

## 최종 검증

| 명령 | 결과 |
|---|---|
| `npm test -- tests/integration/storage-atomicity.test.ts` | 1개 파일, 29개 테스트 통과, exit 0입니다. |
| `npm run typecheck` | server와 web TypeScript 검사 통과, exit 0입니다. |
| `npm test` | unit·contract·integration 3개 파일, 71개 테스트 통과, exit 0입니다. |

`npm run build`, 브라우저, E2E, 성능, 실제 Claude, 실제 전원 손실·디스크 장애·프로세스 강제 종료 검증은 실행하지 않았습니다. CG-03은 저장 기반 과제이며 이 검증은 후속 과제와 Build and Test 단계에서 수행합니다. 패키지 설치, 전역 변경, commit도 수행하지 않았습니다.

문서에는 Mermaid와 ASCII diagram이 없습니다. Markdown 표와 코드 식별자의 구분 기호를 확인했고 프로젝트 루트 기준 파일 참조를 사용했습니다.

## 독립 검토 Fix round 1/5

Important 네 건의 회귀 테스트를 먼저 추가했습니다. `npm test -- tests/integration/storage-atomicity.test.ts`는 불변 DescriptionVersion의 `INSERT OR REPLACE` 덮어쓰기, terminal Run의 Claim 보존 뒤 runtime 해제, migration IOERR 뒤 connection 폐기, Question parent UPDATE 순환 거절 사례가 각각 실패해 29개 통과·4개 실패, exit 1로 끝났습니다.

활성 runtime 등록과 불변 실행 identity를 분리했습니다. Claim과 Observation은 `runtime_identities`를 참조하고 `unregisterRuntime`은 `runtime_instances`만 삭제합니다. 모든 connection에서 `recursive_triggers=ON`을 검증하고 Question parent UPDATE에도 순환 trigger를 적용했습니다. `src/persistence/failure.ts`의 공통 경계가 업무 transaction, migration, runtime 등록·해제와 offline maintenance의 rollback 및 IO/손상 오류 connection 폐기를 처리합니다.

수정 뒤 검증 결과는 다음과 같습니다.

| 명령 | 결과 |
|---|---|
| `npm test -- tests/integration/storage-atomicity.test.ts` | 1개 파일, 33개 테스트 통과, exit 0입니다. |
| `npm run typecheck` | server와 web TypeScript 검사 통과, exit 0입니다. |

Fix round에서는 전체 `npm test`, build, 브라우저, E2E, 성능, 실제 디스크 IOERR를 실행하지 않았습니다. IOERR 경계는 SQLite 사용자 함수와 임시 trigger로 오류 코드를 주입해 검증했습니다. 이 변경은 저장 통합 경계와 타입에 한정되어 대상 검사와 typecheck를 실행했습니다.
