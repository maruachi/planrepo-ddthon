# U3 처리

C06.request는 역할/계획 열/버전 소속 검사 후 Review+요청 사건을 C09.commit한다. C06.submitResult는 역할/원래 requested 상태 검사 후 결과+결과 사건을 같은 트랜잭션에 저장한다. C06.listReviews/getReview는 원래 버전과 현재 최신 참조를 각각 조회한다.

C03.markImplemented는 author, implementation_ready, U2 status=complete, expectedRevision을 확인하고 SR 열/WorkflowState revision/수동 사건/receipt를 저장한다. C05 호출은 없다.

U2 문맥 빌더는 기존 공통 사건 상세 조회로 실제 리뷰 내용을 포함한다. 정책은 리뷰 필드를 요구하지 않는다. 따라서 역의존이나 별도 큐가 필요하지 않다.
