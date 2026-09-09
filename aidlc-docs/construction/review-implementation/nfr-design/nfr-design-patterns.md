# U3 저장 패턴

Review의 srId/documentId/versionId는 U1 버전 복합 FK에 연결한다. 요청 정체성과 원래 내용은 불변이며 requested 상태에서 결과를 한 번 저장한다. ChangeSet.review의 expectedStatus=null은 새 요청, requested는 결과 전제다. 계획 state/revision은 리뷰 변경 묶음에 포함하지 않는다.

review_receipts는 operationId→Review를 연결해 원래 요청/결과를 재조회한다. 수동 완료는 기존 planning ChangeSet을 사용하고 revision을 확인한다. 전체 트랜잭션 실패 시 리뷰/사건/receipt 또는 SR/상태/사건이 모두 롤백된다.

v1/v2 마이그레이션은 기존 원문과 버전·실행·결정·확인 기록을 보존한다. 조회/추가 페이지/사건 문맥과 키보드 기능을 재사용한다.
