# 후속 구현 병렬화 검토

상태: 2026-09-08 검토 완료. 실행 계획 승인을 대체하지 않는 권고이며 U2/U3 구현은 시작하지 않았다.

## 검토 완료 항목

- [x] 상태·U1 코드 계획·산출물 Q1 확인: 첫 미완료는 Step 21 산출물 승인이다.
- [x] U1 인계와 U2/U3 의존성 확인: 승인된 단위 순서는 U1 → U2 → U3다.
- [x] 실제 공통 계약·저장 포트·마이그레이션·앱 조립 코드와 병렬 작업 경계 확인.
- [x] 독립 에이전트의 읽기 전용 검토와 대조하고 아래 권고 기록.

## 권고

U2 설계 및 코드 계획에서 입력·출력 타입과 파일 소유권을 확정한 뒤, 주 에이전트와 하위 에이전트 3개로 단위 내부 구현을 분담한다. 아래 하위 경로는 제안이며 아직 생성된 파일을 뜻하지 않는다.

| 담당 | 병렬 작업 | 제안 소유 경로 |
|---|---|---|
| 주 에이전트 | 공통 계약 확정, 저장 확장, C05 서비스와 HTTP·앱 통합 | src/shared/, src/sr-document-foundation/storage/, src/app/, src/aidlc-planning/services/, src/aidlc-planning/http/ |
| 에이전트 1 | C08 CLI 실행·출력 파싱·실패 처리와 집중 테스트 | src/aidlc-planning/cli/, tests/aidlc-planning/cli/ |
| 에이전트 2 | C11 단계 정책, C07 문맥 구성과 집중 테스트 | src/aidlc-planning/policy/, src/aidlc-planning/context/, tests/aidlc-planning/policy/, tests/aidlc-planning/context/ |
| 에이전트 3 | 확정된 API 계약으로 계획·질문·결정 UI와 상태 검증 | src/aidlc-planning/ui/, tests/aidlc-planning/ui/ |

문맥 구성의 저장 조회는 먼저 확정한 포트에 의존하고, 테스트 대역으로 독립 검증한다. 테스트 대역 검증은 실제 CLI·DB 통합 증거로 간주하지 않는다. 기존 SR 화면·공통 CSS·API 클라이언트에 필요한 변경은 주 에이전트에게 요청해 한 명만 수정한다. 공유 계약 변경도 주 에이전트가 반영하고 다른 담당자에게 알린다.

순차로 남길 작업은 공통 타입/포트 확정, 스키마 버전과 데이터 보존 정책 결정, 최종 서비스 조립, 실제 CLI 결과의 원자 저장, 실행 중 편집/늦은 결과 검사, 최종 빌드·브라우저 통합 검증이다. 현재 migrations.ts는 버전 1의 전체 스키마를 비교하므로 후속 테이블 파일 추가만으로는 확장되지 않는다. migrations.ts, sqlite-store.ts, queries.ts, store-port.ts는 동시에 수정하지 않는다. package.json/잠금 파일과 상태·계획·감사 로그도 주 에이전트가 관리한다.

U3는 U2의 단계·구현 대기 계약과 통합 증거에 의존한다. 현재 승인된 단위 순서를 유지하고, U3에 도달하면 같은 방식으로 리뷰 서비스와 화면을 분담한다. U2/U3 전체를 동시에 착수하는 변경은 이번 권고에 포함하지 않는다.

병렬 작업자는 자기 소유 테스트를 수행하고 결과를 인계한다. 최종 통합은 한 번 모아서 수행하고, 실패한 범위만 수정·재검증한다. 실제 CLI 실행은 한 담당자에게 모아 중복 실행과 인증/출력 혼선을 방지한다. 예상 단축률은 측정 근거가 없어 제시하지 않는다.

## 근거와 현재 승인 경계

- [단위 의존성과 인계](../../inception/application-design/unit-of-work-dependency.md)
- [단위 정의](../../inception/application-design/unit-of-work.md)
- [U1 구현 인계](../sr-document-foundation/code/implementation-summary.md)
- [U1 검증 기록](../sr-document-foundation/code/verification.md)
- [첫 미완료 항목의 승인 Q1](../sr-document-foundation/code/code-generation-approval-questions.md)

U1 Steps 1–20과 기존 승인은 보존한다. Q1이 비어 있으므로 Step 21은 미완료로 유지한다. 이번 검토에서는 제품 코드를 변경하거나 테스트를 재실행하지 않았다. Security Baseline, Resiliency Baseline, Property-Based Testing은 모두 Enabled No / N/A이며 전체 규칙 로드와 적용을 생략했다.
