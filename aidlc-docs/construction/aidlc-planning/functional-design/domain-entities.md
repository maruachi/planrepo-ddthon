# U2 도메인

WorkflowState는 SR별 revision, stageIndex, column, status, Inception/Construction 회차, 최신 Run, 현재 질문/응답, 자체 결정과 검토 대상 버전 묶음을 갖는다. 처음에는 요구사항 분석 index 0, idle, SR 목록, 회차 0이다.

Run은 SR/단계, 실행 시작 시 문서 버전과 문맥, running/succeeded/failed, 결과 참조·오류를 저장한다. QuestionSet은 실행/단계와 질문 ID/문장/선택지 및 응답을 연결한다. PlanningDecision은 실제 대상 버전 묶음, 단계/실행, approve/request_changes, 내용과 시각을 보관한다. 이전 질문·응답·결정은 불변 사건 상세에 남는다.

ContextSnapshot은 초기 SR/첨부, 모든 현재 문서와 정확한 버전, 질문·결정 사건, 해당 단계 규칙과 planning-only 범위를 묶는다. U2에는 리뷰 사건이 없으며 U3가 같은 이력 조회로 연결한다. 문서·버전은 U1이 소유하고 실제 U2 생성 버전은 Run과 같은 SR로 연결한다.
