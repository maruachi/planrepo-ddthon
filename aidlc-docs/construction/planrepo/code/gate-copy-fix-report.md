# 게이트 사용자 문구 보완 보고

## 변경 경계

- `src/domain/gate-assessment.ts`는 `conditionId`와 판정값을 유지하면서 실패 이유를 사용자가 다음 행동을 알 수 있는 한국어로 바꿨습니다.
- GP-01은 아직 검토 자료가 없는 경우와 기존 묶음의 검토 기준이 바뀐 경우를 구분합니다.
- GP-02는 검토 요청에 포함되지 않은 문서 종류와 포함된 요구사항 문서의 구조 보완을 구분합니다. 저장소에 문서가 없다고 단정하지 않습니다.
- GP-05, GP-07, GP-08, GP-09는 각각 수정 확인, 미승인 검토자, 역할·체크리스트, G1 미완료·상위 묶음 불일치를 구분합니다.
- `src/application/workspace-query-service.ts`의 M-045 보드 `blockers`는 내부 `GP-xx` 식별자를 붙이지 않고 판정의 사용자 이유만 반환합니다. M-027의 `conditionId`, 담당자와 대상 참조는 그대로입니다.

## TDD와 검증

- RED: `npm test -- tests/integration/gate-copy.test.ts`는 exit 1이었습니다. 3개 테스트가 모두 기대한 기존 내부 문구 때문에 실패했습니다. M-045에는 `GP-01`과 `epoch`가 노출됐고, M-027은 자료 부재·문서 종류·검토자 배정·G1 상태를 구분하지 않았으며, GP-08은 역할과 체크리스트 부족을 하나로 합쳤습니다.
- GREEN: 같은 명령은 exit 0이며 3개 테스트가 통과했습니다.
- 관련 검증: `npm test -- tests/integration/gate-copy.test.ts tests/integration/g1-review.test.ts tests/integration/sr-context.test.ts`는 exit 0이며 3개 파일의 25개 테스트가 통과했습니다.
- `npm run typecheck`은 exit 1이었습니다. 이 변경 밖에서 동시에 작성 중인 `src/runtime/claude-live-candidate.ts`, `src/runtime/restricted-process-runner.ts`, `src/web/api/client.ts`의 기존 타입 오류 5개 때문에 중단됐습니다. 이번 변경 파일을 가리키는 오류는 없었습니다.

위 내용은 작성자의 검증 범위입니다. root의 독립 검토와 체험 서버 반영 결과는 아래에 있습니다.

## 독립 검토와 체험 서버 반영

- [x] 최초4파일224줄과 후속4파일101줄을 독립 검토했습니다. 성공 문구의 내부 용어도 보완했습니다.
- [x] 후속 `npm test -- tests/integration/gate-copy.test.ts`가 exit 0, 3/3 PASS입니다. 기존 관련25개 결과를 유지합니다.
- [x] `./node_modules/.bin/tsc -p .planrepo/previews/cg17-20260909/updates/review-copy/tsconfig.copy.json --noEmit`이 exit 0입니다. 변경한 두 소스와 그 의존 경로만 검사해 병행 작업의 오류와 분리했습니다.
- [x] 사용자 preview의 기존 source map74개를 복원했습니다. 수정 대상2파일이 baseline과 byte 단위로 같음을 확인한 뒤 검토한 최종 소스만 반영했습니다. esbuild의 node22 ESM 빌드가 exit 0이며 입력74개를 유지합니다.
- [x] 사용자 DB를 읽기 전용으로 백업하고 기존 preview를 소유한 작성자가 정상 종료했습니다. root가 같은 DB·config·정적 화면으로 새 candidate를 실행했습니다. DB 초기화·seed·migration은 실행하지 않았습니다.
- [x] `curl --silent --show-error --fail http://127.0.0.1:4173/health/ready`가 exit 0이며 ready=true, generationReady=false입니다.
- [x] gstack-browse로 실제 보드의 GP 코드·epoch 제거와 새 문구를 확인했습니다. console errors는0개입니다.
- [x] 재시작 전 백업과 현재 DB의 업무 테이블39개를 비교했습니다. 기존 모든 행을 보존했습니다. 사용자 체험 중 SR1개와 관련 정상 기록이 추가됐으므로 전체 파일 hash가 같다고 주장하지 않습니다.

체험 주소는 `http://127.0.0.1:4173`입니다. root가 소유한 PTY36148을 유지합니다. 실행 파일은 `.planrepo/previews/cg17-20260909/updates/review-copy/candidate/server/main.js`이며 작업 폴더는 `.planrepo/previews/cg17-20260909`입니다. 기존 PTY64858은 정상 종료됐습니다. 후속 구현이 이 DB를 테스트용으로 사용하거나 재초기화해서는 안 됩니다.
