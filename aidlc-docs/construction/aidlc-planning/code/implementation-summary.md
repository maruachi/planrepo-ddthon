# U2 구현과 인계

구현·통합 검증·인계 기록을 완료했다. 실제 CLI로 생성한 문서의 DB 저장과 브라우저 열람까지 확인했다. 검증 근거는 verification.md와 aidlc-state.md를 따른다.

CLI 어댑터, 정책·문맥, 화면을 세 에이전트가 병렬 구현하고 주 에이전트가 공유 타입·저장소·서비스·HTTP·앱을 통합했다. 각 담당 집중 테스트 후 저장/HTTP/브라우저 연결을 검증한다. 단위 간 U1 → U2 → U3 의존 순서는 유지한다.

| 계약 | 구현 |
|---|---|
| C05 7개 메서드 | services/planning-service.ts의 getWorkflow, advance, getRun, answer, decide, completePlanning, finishRun |
| C07 build/loadRules | context/planning-context-builder.ts |
| C08 execute | cli/claude-plan-runner.ts |
| C11 evaluate/evaluateOutcome | policy/planning-policy.ts |
| C01 계획 화면 | ui/PlanningPanel.tsx, planning-client.ts, planning.css |
| C02 계획 전송 | http/planning-routes.ts와 기존 routes의 조립 |
| C09 저장 확장 | 기존 storage 포트/조회/커밋 및 002-planning.ts |
| 보드·앱 연결 | 기존 SRCard/SRDetailPage와 app/create-app/config/WorkspaceShell |

상대 코드 경로의 기본은 src/aidlc-planning/이다. 테스트는 tests/aidlc-planning/이다. 문서 경로는 현재 code/이며 애플리케이션 코드를 aidlc-docs에 두지 않는다.

U3는 WorkflowState.column과 revision을 사용해 구현 대기에서 수동 완료를 처리한다. 리뷰는 정확한 VersionRef에 고정하고 계획 revision/승인을 바꾸지 않는다. 피어 리뷰 결과는 이미 모든 사건 상세를 모으는 문맥 빌더에서 읽히며 자체 승인을 대신하지 않는다. 공통 CommandKind/receipt와 C09 스키마를 확장할 때 이전 v1/v2 데이터와 불변 기록을 유지한다.

US-02 회차/단계, US-03 실제 생성, US-04 실패, US-05 질문/결정, US-13 구현 대기가 U2 주 범위다. US-06/07/08은 실제 생성·편집 경합·이력으로 연결한다. US-11/12/14 리뷰/수동 완료의 최종 수용은 U3다.

Security/Resiliency/PBT는 Disabled/N/A. 원문·기존 사용자 변경·루트 README 삭제를 유지했다. 배포·커밋·외부 메시지는 수행하지 않았다.
