# CG-09 migration 구현 보고

CG-09의 input snapshot supplement 저장을 위한 append migration만 구현했습니다. 기존 0001 SQL과 checksum은 수정하지 않았으며 실제 프로젝트 DB는 열거나 변경하지 않았습니다.

## 구현 결과

- `src/persistence/migrations/0002-input-snapshot-supplement.ts`는 `input_snapshots.supplement` nullable TEXT 열을 추가합니다. 기존 행은 null을 유지하고 새 행은 null, 빈 문자열과 실제 supplement를 구분합니다.
- 같은 migration은 `artifacts.kind='design'`이면서 `design_stage='functional_design'`인 알려진 이전 표기만 `functional`로 정규화합니다. 다른 설계 단계 문자열은 바꾸지 않습니다.
- `src/persistence/migrations/index.ts`는 0001과 0002를 순서대로 등록합니다. `src/persistence/maintenance.ts`는 이 최신 registry를 기본값으로 사용하므로 새 서버는 version 1 DB를 준비 완료로 인정하지 않습니다.
- migration은 기존 `BEGIN EXCLUSIVE`와 maintenance owner, active runtime, execution slot, running generation run 차단을 그대로 사용합니다. 중간 실패 시 열 추가, 표기 정규화와 migration row가 함께 rollback됩니다.
- version 1의 snapshot JSON, document target, Artifact current ref·revision, ArtifactVersion binary markdown과 append-only trigger를 byte 수준으로 보존합니다. 0001 checksum과 applied time도 그대로 유지합니다.

## 변경 경로

- `src/persistence/migrations/0002-input-snapshot-supplement.ts`
- `src/persistence/migrations/index.ts`
- `src/persistence/maintenance.ts`
- `tests/integration/snapshot-supplement-migration.test.ts`
- `tests/integration/storage-atomicity.test.ts`
- `aidlc-docs/construction/planrepo/code/task-09-migration-report.md`

## TDD와 검증 기록

- `npm test -- tests/integration/snapshot-supplement-migration.test.ts`의 첫 실행은 exit 1이었습니다. 3개 중 offline blocker 1개는 통과했고, version 1 DB를 최신으로 잘못 인정한 사례와 0002 실패 주입이 실행되지 않은 사례 2개가 기대한 이유로 실패했습니다.
- 0002와 registry를 연결한 뒤 같은 명령은 exit 0이며 3개가 통과했습니다.
- `npm test -- tests/integration/storage-atomicity.test.ts tests/integration/snapshot-supplement-migration.test.ts`의 첫 실행은 exit 1이었습니다. 36개 중 33개가 통과했고 최신 migration 번호 기대 1건과 version 1 전제의 사용자 정의 두 번째 migration 테스트 2건이 새 기본 registry 때문에 실패했습니다.
- 기존 regression을 최신 번호 `[1, 2]`에 맞추고 사용자 정의 실패 migration fixture를 명시적 version 1 DB로 고쳤습니다. 같은 명령을 다시 실행해 exit 0, 36개 통과를 확인했습니다.
- blocker별 오류 메시지를 구체화한 뒤 `npm test -- tests/integration/snapshot-supplement-migration.test.ts`는 exit 0이며 3개가 통과했습니다.
- `npm run typecheck`는 exit 0입니다.
- 최종 관련 검증 `npm test -- tests/integration/snapshot-supplement-migration.test.ts tests/integration/storage-atomicity.test.ts tests/integration/readiness.test.ts tests/integration/demo-seed.test.ts`는 exit 0이며 4개 파일의 56개 테스트가 통과했습니다.
- 변경 경로의 `git diff --check`는 exit 0입니다.

전체 suite, build, 브라우저, 성능, 복구, Claude는 실행하지 않았습니다. migration 검증은 모두 `randomUUID()` 경로로 만든 격리 TestDatabase에서 실행했습니다.
