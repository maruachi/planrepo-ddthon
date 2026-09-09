# PlanRepo 저장 포트 요약

버전은 0.1입니다. 이 파일은 CG-03에서 만든 저장 토대와 후속 repository의 사용 경계를 기록합니다.

## 공개 저장 API

- `openPlanRepoDatabase(databasePath)`는 실제 better-sqlite3 connection을 열고 DELETE/FULL/FK ON/100ms busy timeout/recursive trigger ON을 확인합니다. 공개 타입은 `DatabaseConnection`입니다.
- `migrateDatabase(db, migrations?, appliedAt?)`는 EXCLUSIVE transaction에서 bootstrap, DDL/DML과 migration metadata를 함께 확정합니다.
- `assertSupportedSchema(db)`는 정확한 migration 수·연속 번호·checksum을 검사합니다.
- `createPersistence(db).withinTransaction(work)`는 `BEGIN IMMEDIATE` 업무 transaction을 제공합니다.
- `createPersistence(db).readConsistent(work)`는 짧은 읽기 transaction을 제공합니다.
- `storeCommandReceipt(db, { receipt, replayValue })`는 호출자가 소유한 업무 transaction 안에서 고정 receipt와 전체 재생 값을 저장합니다.
- `readCommandReceipt(db, key)`는 scope·actor·idempotency key로 과거 고정 결과를 읽습니다.
- `registerRuntime(db, registration)`은 IMMEDIATE transaction 안에서 schema와 maintenance 상태를 재확인한 뒤 불변 runtime identity와 활성 등록을 함께 저장합니다.
- `unregisterRuntime(db, runtimeId)`는 활성 등록만 삭제합니다. Claim과 Observation이 참조하는 불변 runtime identity는 보존합니다.
- `runOfflineMaintenance(db, ownerId, work)`는 EXCLUSIVE lock 뒤 maintenance owner, runtime, execution slot과 running Run을 다시 검사하고 work commit까지 잠금을 유지합니다.

## transaction 소유

업무 repository는 구조 파싱을 transaction 밖에서 마칩니다. transaction 안에서는 현재 actor/scope, 기존 receipt, 필요한 guard를 읽고 조건부 write의 변경 행 수를 확인합니다. 새 version, current 포인터, gate 영향, 요청 승계, ActivityEvent, CommandReceipt와 필요한 Run은 한 callback에서 저장합니다. commit 뒤에만 Committed를 반환합니다.

callback은 동기 함수만 허용합니다. 알려진 async function은 호출 전에 거절합니다. 일반 함수가 Promise나 thenable을 반환하면 transaction 안에서 예외를 내 rollback하고 connection을 닫습니다. 이 조치는 callback이 보관한 DB 참조를 continuation에서 다시 쓰지 못하게 합니다. 사용자 callback 예외와 정상 SQLite constraint 실패는 rollback 뒤 원래 오류를 유지합니다. rollback 상태를 확인할 수 없거나 IO/손상 오류로 connection 상태가 불확실하면 connection을 폐기합니다.

`storeCommandReceipt`는 독립 transaction을 시작하지 않습니다. 후속 command repository가 업무 write와 함께 호출해야 합니다. 같은 5-tuple 경쟁의 패자는 UNIQUE 오류로 transaction 전체가 rollback된 뒤 `readCommandReceipt`로 승자의 고정 `commandKind`, `inputFingerprint`, `committedRevision`, `resultRefs`와 `replayValue`를 읽어 동일 요청인지 충돌인지 판정합니다. 현재 포인터에서 과거 결과를 다시 만들지 않습니다.

`ReceiptResultRef`는 `EntityRef | VersionRef | BundleRef`입니다. ArtifactVersion이나 Bundle처럼 version이 결과 의미의 일부인 경우 정확한 version을 receipt에 넣습니다. 재생 시 현재 권한과 현재용 동작의 현재 조건 검사는 서비스가 다시 수행하며, 저장층은 과거 성공을 현재 승인으로 바꾸지 않습니다.

## maintenance와 runtime

일반 backend는 빈 DB를 만들거나 migration하지 않습니다. `registerRuntime`은 지원 schema와 maintenance 부재를 한 IMMEDIATE transaction 안에서 확인하고 commit 뒤에만 준비 상태로 전환하는 호출부 계약을 전제로 합니다. `runtime_identities`는 실행 이력이고 `runtime_instances`는 활성 등록입니다. 정상 종료는 활성 행만 해제하며 terminal Run의 과거 Claim과 runtime identity는 유지합니다.

Migration과 seed는 같은 DB에서 실행하는 offline 작업입니다. 기존 maintenance owner, 활성 `runtime_instances` 행, 점유된 execution slot 또는 `GenerationRun.status='running'` 중 하나라도 있으면 거절합니다. 보존된 `runtime_identities` 이력은 maintenance를 차단하지 않습니다. heartbeat/PID 부재를 사망 증거로 사용하지 않습니다. maintenance callback도 동기 함수만 허용하며 Promise continuation이 생기면 rollback 후 connection을 닫습니다. Migration, runtime 등록·해제와 offline maintenance에서 IO/손상 오류가 나면 공통 failure 경계가 rollback을 시도한 뒤 connection을 폐기합니다.

`demo_seed_manifests`는 후속 CG-04가 사용합니다. CG-04는 지원 schema와 업무 자료 emptiness를 EXCLUSIVE lock 안에서 재확인하고 전체 DEMO-4 graph와 manifest row를 같은 callback에 넣어야 합니다. 이미 marker나 업무 자료가 있으면 수정 없이 거절합니다.
