# U3 도메인

ReviewRecord는 ID, SR, 정확한 VersionRef, 요청 내용/시각, requested/approved/changes_requested 상태와 결과 내용/시각을 갖는다. ReviewView는 현재 문서 제목, 원래 버전 번호, isLatest/latestVersionRef를 더한다. 요청과 결과 사건은 불변 이력에 저장한다. 이전 버전에 대한 결과는 이후 버전을 승인한 것으로 표시하지 않는다.

DemoRole은 author/reviewer의 동일 사용자 시연 모드다. 계정·인증 신원이 아니다. 헤더 역할 선택은 브라우저 메모리 상태이며 요청 역할을 서버 입력으로 검증한다.

수동 구현 완료는 기존 SR 열과 U2 WorkflowState.column을 implementation_ready에서 implemented로 바꾸고 implementation_marked 사건을 남긴다. 빌드나 Git 결과로 자동 생성하지 않는다.
