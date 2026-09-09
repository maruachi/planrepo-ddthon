# U2 NFR 설계 패턴

SQLite schema v2는 기존 6개 테이블을 유지하고 planning_workflows, planning_runs, planning_version_runs, planning_receipt_runs를 추가한다. Run과 WorkflowState는 검증된 서버 타입의 JSON payload와 소속/상태/리비전 열을 함께 가진다. 생성 버전과 실제 Run의 연결은 복합 FK로 같은 SR을 강제한다. U1의 기존 선택적 run_id는 레거시 인계 필드로 보존하고 U2가 생성하는 모든 버전에는 새 연결을 요구한다. receipt 연결은 응답 유실 후 원래 Run을 조회하며 다른 최신 실행과 혼동하지 않도록 한다.

ChangeSet.planning은 expectedRevision, 새 state, 선택적 Run을 담는다. 같은 BEGIN IMMEDIATE에서 리비전 비교, Run/상태, U1 문서/사건, 연결과 receipt를 커밋한다. CLI 대기는 트랜잭션 밖이다. 시작 시 문맥을 확정하고 완료 시 문서 집합과 버전을 다시 검사한다. 실패 결과는 문서 생성 없이 Run 실패와 사건으로 원자 저장한다.

서버 재시작 때 running Run을 interrupted 실패로 기록한다. 종료는 진행 중 자식 종료 후 DB를 닫는다. 저장 장애 때문에 실패 기록도 못 쓴 경우 성공으로 표시하지 않는다. 출력은 JSON 스키마/상한 검증을 통과한 데이터만 저장하며 도구나 shell 명령으로 실행하지 않는다.
