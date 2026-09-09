# CG-09 병행 구현 경계

승인된 CG-09를 공유 파일 충돌 없이 연결하기 위한 작성 범위입니다. 제품 범위와 단계 승인은 기존 승인을 유지합니다. 세부 과제의 실제 RED/GREEN과 완료 여부는 중앙 계획과 과제 보고에 기록합니다.

## 공유 서비스 작성자

CG-07 원작성자가 SOURCE fix1 동결 뒤 공통 계약과 문서·초안 경계를 담당합니다. `src/contracts/views.ts`, `methods.ts`, `schemas.ts`, `src/runtime/application-composition.ts`, `src/application/workspace-query-service.ts`, `src/persistence/sr-repository.ts`, `generation-run-query.ts`, `review-impact-repository.ts`는 한 작성자만 수정합니다. 새로운 Artifact 서비스·저장소, InputSnapshot 저장·복원 adapter와 M-047 preparation도 이 작성자 범위입니다.

먼저 질문·결정 상세 DTO와 일반 버전 변경의 ReviewImpact 저장 API를 구체화해 다른 작성자에게 공유합니다. 기존 SOURCE·설명 동작을 유지하고 영향 게이트가 G2뿐일 때 G1을 잘못 무효화하지 않아야 합니다. 질문·결정의 내용 타입을 별도 계약 파일로 분리하면 그 파일은 질문 작성자가 소유하고 공유 View는 합의한 타입을 확장합니다.

## 질문·결정 작성자

생성 입력 원작성자는 결정 25 participants 입력 보완을 동결한 뒤 질문·결정 repository/service와 단위·저장 통합 테스트를 맡습니다. 공개 메서드는 M-008/M-010/M-012이며 질문 답변과 해결, 미확정 결정과 사람 확정을 구분합니다. 초안의 선택 제안을 새 미확정 질문·결정으로 쓰는 repository 함수는 호출자가 소유한 같은 DB 트랜잭션을 사용합니다. 서버 ID와 원 temporaryId의 매핑을 반환합니다. 이 함수가 자기 transaction·receipt를 별도로 확정하면 안 됩니다.

실제 권한·guard·receipt·원자성 검증을 우선합니다. 공유 조립부나 DTO가 준비되지 않은 부분은 아직 미연결로 보고하고 fake handler를 제품 코드에 넣지 않습니다. 같은 DB에 대한 최종 공개 HTTP 통합은 공유 서비스 작성자가 확인합니다.

## 웹 작성자

CG-08 SOURCE UI 동결·검토 뒤 기존 HTTP client와 폼 상태 경계를 사용해 CG-09 UI를 연결합니다. 계약 필드가 부족하면 공유 작성자에게 구체 필드를 요청합니다. fixture 본문, 임의 endpoint, DB 직접 접근과 any로 본문 누락을 우회하지 않습니다. SOURCE 이후 backend 대기 중에는 별도 파일의 CG-12 runner 순수·소유 Node child 검증을 앞당길 수 있습니다. 실행 루프·claim 연결과 과제 전체 완료는 해당 선행 서비스가 준비된 뒤 처리합니다.

## 연결 전에 확정할 세부 사항

- M-047은 빈 상세 입력과 판별된 new_generation/retry/draft preparation을 함께 지원합니다. 조회는 DB를 쓰지 않고 모든 지문은 같은 calculator로 계산합니다.
- InputSnapshot의 supplement는 nullable 열을 사용합니다. participants는 같은 SR EntityRef의 contents 항목 JSON에 고정하고 사용자 ID를 VersionRef로 가장하지 않습니다. 과거 입력에 현재 멤버를 역주입하지 않습니다.
- 질문·결정 본문과 실제 선택 답변·확정 근거를 구체 DTO로 반환합니다. 지정 결정권자가 없는 새 결정 제안과 WorkflowPlan의 필수 구조를 Markdown만으로 적용하는 계약 공백은 구현 전에 명시적인 사람 선택이나 검증된 구조 입력으로 해결합니다. 임의 persona 지정이나 모델 추론을 업무 권한으로 사용하지 않습니다.
- 문서 비교는 정확한 두 version의 원문을 보존합니다. 현재 버전만 있는 UI로 과거 비교를 가장하지 않습니다.
- 초안 적용은 정확한 결과 종류·버전 또는 temporaryId 매핑을 한 번만 저장합니다. 적용 결과 재생은 고정 결과와 현재 기준을 분리합니다.

확장 세 가지는 비활성화되어 N/A입니다. 운영 배포나 외부 기록 생성은 이 구현에 포함하지 않습니다.
