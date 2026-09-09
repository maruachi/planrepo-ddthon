# U3 화면

WorkspaceShell 역할 선택(author/reviewer), SR 상세의 ReviewPanel, 보드 카드의 미완료 리뷰 수를 추가한다. ReviewPanel props는 srId, column, target?(현재 표시 VersionRef), role, revision(화면 갱신 번호), workflowRevision(수동 완료용), changed 콜백이다. 전체 리뷰 목록과 추가 조회, 원래 버전 링크/최신 여부, 요청/결과 내용, 역할별 요청·결과 폼을 제공한다.

작성자는 Inception/Construction에서 문서를 연 뒤 리뷰를 요청한다. 리뷰어는 원래 버전 링크로 이동해 결과를 기록한다. 구현 대기에서는 작성자가 수동 완료 선언 안내를 확인하고 완료 버튼을 누른다. 모든 입력은 레이블/data-testid와 키보드 조작을 제공한다. 역할 전환 시 초안이 있으면 기존 보호 방식으로 확인한다.

GET /api/srs/:srId/reviews?limit&cursor는 Page<ReviewView>, GET /reviews/:reviewId는 ReviewView다. POST /reviews {target,comment}, POST /reviews/:reviewId/results {kind,comment}, POST /implementation {revision}. POST는 X-Operation-Id와 X-Planrepo-Role을 보내며 결과는 ReviewView 또는 SR이다. GET /operations로 불확실 요청을 확인한다.
