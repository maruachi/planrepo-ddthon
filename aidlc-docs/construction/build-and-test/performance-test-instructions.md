# 성능 검증 범위

운영 부하·스트레스·확장 시험은 승인된 로컬 단일 사용자 MVP에서 N/A다. 응답 시간/동시 사용자 수 SLA를 새로 주장하지 않는다.

U1의 1 MiB 본문·전체 비교·페이지 처리, U2 문맥/출력 상한·비동기 실행과 타임아웃, U3 페이지 조회를 집중 검증했다. 향후 부하 요구가 생기면 데이터량·측정 목표·장비를 먼저 정의하고 별도 검증한다. 현재 빌드 크기 안내는 build-instructions.md에 기록했다.

## Worktree Integration Spike 판정

- **Status**: N/A for this 60-minute technical spike.
- 20,000-file repository scan, response-time percentile, throughput, concurrent user, sustained runner와 stress test는 실행하지 않았다.
- Manifest correctness는 작은 isolated fixture와 property-based input으로만 확인했다. 이는 filesystem 성능 측정이 아니다.
- Production 전에는 target filesystem, repository file distribution, warm/cold cache와 측정 장비를 고정하고 20,000 managed/candidate file 기준의 capture latency와 memory upper bound를 별도 승인해야 한다.
- 현재 단계에는 성능 목표나 합격 수치를 새로 발명하지 않으며, 성능 미검증을 blocking production backlog로 유지한다.

## Manual Board Status Movement 판정

- **Status**: N/A for this local single-user Hotfix.
- 이동은 단일 indexed primary-key row의 조건부 update와 receipt insert로 구성되지만 latency, throughput 또는 동시 사용자 SLA는 정의하지 않았다.
- 성능 도구나 dependency를 추가하지 않았다.
- 운영 규모 요구가 생기면 SR 수, 동시 이동 수, p95 latency와 SQLite lock contention 조건을 먼저 승인한 뒤 별도 load test를 설계한다.

## Worktree Document Edit and History 판정

- **Status**: N/A for the approved local single-user focused feature.
- 문서당 1 MiB 상한과 SQLite/filesystem correctness는 검증했지만 latency percentile, sustained throughput, concurrent editor 또는 대규모 version-count SLA는 정의하지 않았다.
- 별도 load/stress 도구나 dependency를 추가하지 않았다.
- 운영 성능 요구가 생기면 managed document 수, 경로당 version 수, filesystem 종류, SQLite lock contention, p95 save/read 목표와 측정 장비를 먼저 승인해야 한다.

## Initial SR Prompt Selection Hotfix 판정

- **Status**: N/A for load, stress and scalability testing.
- 이 Hotfix는 최초 실행에서 한 SR row를 동기적으로 읽고 bounded prompt string을 한 번 구성한다.
- 기존 로컬 단일 사용자 범위에는 response-time percentile, throughput, concurrent-session 또는 prompt-size performance SLA가 없다.
- 예제 및 property tests는 correctness와 input 다양성을 검증하며 성능 측정으로 주장하지 않는다.
- 운영 규모 요구가 생기면 SR/attachment 최대 크기, 동시 최초 실행 수, p95 prompt-construction latency와 측정 장비를 먼저 승인한 뒤 별도 load test를 설계한다.
