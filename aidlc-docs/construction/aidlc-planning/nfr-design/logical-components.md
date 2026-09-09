# U2 논리 컴포넌트와 담당

주 에이전트: shared/planning-contracts, 기존 StorePort/SQLite/schema v2, PlanningService, HTTP 및 앱/보드 통합. 공통 파일/잠금/상태/감사 로그의 단일 편집자다.

병렬 1: src/aidlc-planning/cli 및 대응 테스트. PlanRunnerPort를 구현하고 DB를 직접 접근하지 않는다.

병렬 2: src/aidlc-planning/policy 및 context, 대응 테스트. 정책은 순수 함수, 문맥은 StorePort 조회와 고정 단계별 규칙 파일만 사용한다.

병렬 3: src/aidlc-planning/ui 및 대응 테스트. 공유 HTTP 계약과 기존 UI 요소를 재사용하고 기존 앱·공통 CSS 변경은 주 에이전트가 통합한다.

공통 계약 확정 → 세 병렬 작업과 저장 구현 → 서비스/HTTP 조립 → 실제 CLI·DB·브라우저 통합 검증 순서다. 서로 다른 임시 DB/포트를 사용하고 최종 빌드 산출물은 주 에이전트만 만든다. 단계별 실제 완료를 코드 계획에 즉시 반영한다.
