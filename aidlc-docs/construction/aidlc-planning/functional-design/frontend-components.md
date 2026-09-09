# U2 화면

기존 SR 상세에 PlanningPanel을 추가한다. srId, revision, changed 콜백을 받는다. stageLabel/회차/실행 상태, 가능한 진행 버튼, 질문별 응답 폼, 현재 버전 묶음의 승인/수정 요청 폼과 최근 실행 오류를 표시한다. 질문/결정 초안은 실패 시 보존하고 SR 변경 시 분리한다.

API: GET /api/srs/:srId/workflow, GET /api/srs/:srId/runs/:runId, POST /api/srs/:srId/planning/{advance,answers,decisions,complete}. POST는 X-Operation-Id 및 revision을 보낸다. advance 본문은 action/revision, answers는 questionSetId/answers/revision, decisions는 kind/comment/targets/revision, complete는 revision이다. 결과는 advance가 RunView, 나머지는 WorkflowView다. 모든 응답은 기존 Result 래퍼다.

실행 중 1초 간격 조회, 종료/화면 해제 시 타이머 정리. 완료 시 문서·이력·SR을 새로 조회한다. 오류·불확실 결과는 명시적 다시 확인 동작을 제공한다. 자동 재제출은 없다. 키보드 레이블·상태 안내·안정된 data-testid를 제공하고 제품에 내부 에이전트나 DB 기술 설명을 노출하지 않는다.
