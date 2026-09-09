# U3 병렬 구현 계획

진행 근거: 사용자의 “승인 후 코드 구현 병렬 진행해줘.”와 “이어서 진행해줘.” U2의 실제 CLI/저장/브라우저 검증과 인계를 완료한 뒤 시작한다.

- [x] 1. U2 인계·단위/스토리·설계 규칙을 확인하고 U3 기능/NFR/공통 계약을 구체화한다.
- [x] 2. 주 에이전트: StorePort·schema v3·원자 리뷰 저장/조회·receipt 확장.
- [x] 3. 에이전트 1: ReviewService, 요청/결과/역할/원래 대상과 자체 승인 분리 테스트. 5개 통과.
- [x] 4. 에이전트 2: ReviewPanel, 역할별 요청/검토·수동 완료 UI와 상태 검증. 8개 통과.
- [x] 5. 주 에이전트: C03.markImplemented, HTTP/역할 전환·카드·상세 통합.
- [x] 6. 에이전트 3: 기존 데이터 마이그레이션과 U1/U2/U3 연결 검증. 4개 통과.
- [x] 7. 타입 검사·전체 테스트·빌드·실제 브라우저 통합/키보드/재열람 검증, 문제 수정. 최종 86개 통과, pageerror 0.
- [x] 8. 실행/API/검증/인계 문서와 상태·스토리 완료 기록, Build and Test 진행.

공통 파일·기존 src/app, sr-document-foundation, shared, workflow 문서는 주 에이전트만 수정한다. 서비스는 src/review-implementation/services/, 화면은 ui/, 에이전트 3 검증은 tests/review-implementation/integration.test.ts 및 migration.test.ts를 소유한다. 테스트 DB/포트를 분리하고 최종 빌드는 주 에이전트만 수행한다.

범위는 C06 4메서드, C01.selectRole, C03.markImplemented, C02/C09와 보드 연결이다. US-11/12/14 및 US-02/05/06/08/09/13 최종 통합을 확인한다. 인프라 생략 유지, Security/Resiliency/PBT 비활성/N/A.
