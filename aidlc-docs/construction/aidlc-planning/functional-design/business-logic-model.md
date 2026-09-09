# U2 처리 모델

advance: 현재 상태와 최신 승인 대상 확인 → 정책 평가 → 정확한 문맥 구성 → Run/새 상태/시작 사건 원자 저장 → Run ID 반환 → 비동기 CLI 실행 → finishRun.

finishRun: 정상 출력 검증 → 시작 당시 입력 버전/문서 집합 재확인 → 논리 키를 SR의 문서 ID와 대응 → C04.prepareGenerated → 질문/새 상태/완료 Run을 변경 묶음에 추가 → C09.commit. 실패는 별도 Run 실패와 사건으로 저장한다. CLI 대기 동안 DB 트랜잭션은 없다.

answer/decide: SR/질문·실행·단계 소속, revision, 대상 최신성 검사 → 상태와 불변 사건 저장. 본문을 변경하지 않는다. completePlanning은 정책 확인 후 SR 열·상태·사건만 저장한다.

C05의 getWorkflow/advance/getRun/answer/decide/completePlanning/finishRun, C07 build/loadRules, C08 execute, C11 evaluate/evaluateOutcome를 구현한다. 구체적 브라우저/서비스 공유 타입은 src/shared/planning-contracts.ts에 정의한다.
