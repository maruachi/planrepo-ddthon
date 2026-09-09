# U3 담당 경계

주 에이전트: 공유 계약·기존 저장소·C03 수동 완료·HTTP·WorkspaceShell/보드/상세·문서/최종 검증.

서비스 에이전트: src/review-implementation/services와 담당 서비스 테스트. StorePort의 reviews/review 조회 및 ChangeSet.review만 사용한다.

화면 에이전트: src/review-implementation/ui와 상태 테스트. 역할/현재 버전/워크플로우 revision을 props로 받고 서버 원본을 조회한다.

검증 에이전트: 별도 tests/review-implementation/integration.test.ts와 migration.test.ts. 서비스/저장 계약이 준비된 뒤 실제 DB 경계로 U1/U2/U3를 연결한다.
