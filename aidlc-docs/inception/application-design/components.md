# PlanRepo 구성요소 설계

버전은 0.1이며 **사용자 승인 완료**입니다. 구성요소는 논리 모듈입니다. 별도 배포 서비스나 최종 개발 unit을 뜻하지 않습니다.

기준은 `aidlc-docs/inception/requirements/requirements.md`, `aidlc-docs/inception/user-stories/stories.md`입니다. 전체 설계는 `aidlc-docs/inception/application-design/application-design.md`, 메서드는 `aidlc-docs/inception/application-design/component-methods.md`, 서비스 흐름은 `aidlc-docs/inception/application-design/services.md`, 의존 관계는 `aidlc-docs/inception/application-design/component-dependency.md`에 정리합니다. 모든 경로는 프로젝트 루트 기준입니다.

## 구조 선택

| 대안 | 장점 | 비용과 판단 |
|---|---|---|
| 모듈형 단일 로컬 앱 | 업무 상태·승인·이력을 같은 저장 경계에서 다루고 실행·복구 절차를 단순하게 유지합니다. | 논리 모듈의 접근 경계를 코드·테스트로 유지해야 합니다. 이 구성을 추천합니다. |
| 서비스별 별도 백엔드 프로세스 | 기능별 실행 자원과 장애를 분리하기 쉽습니다. | 버전·승인·검토함의 일관성과 배포·통신·복구가 복잡해집니다. 한 팀 기능 데모에는 비용이 큽니다. |

브라우저 UI와 로컬 백엔드, 로컬 영속저장을 기본 실행 형태로 제안합니다. GenerationRuntime은 첫 구현에서 같은 백엔드의 관리 루프로 둘 수 있게 설계하며, Claude만 제한된 자식 프로세스로 호출합니다. 별도 작업 서버나 메시지 브로커를 필수로 추가하지 않습니다. 정확한 런타임·프레임워크·DB 제품은 이후 NFR Requirements에서 결정합니다.

## 구성요소

### C-01 WebUI

- **책임**: 가상 사용자 전환, 팀 보드·검토함·SR 상세·문서·검토·생성·인계를 표시하고 사용자의 명시적 행동을 요청합니다.
- **소유 정보**: 편집 중 입력, 선택한 탭·필터와 마지막으로 받은 버전 토큰입니다. 승인·게이트·현재 역할의 정답을 소유하지 않습니다.
- **인터페이스**: C-02의 조회·변경 계약을 호출합니다. 서버가 반환한 사유·대상·버전과 저장 상태를 보여줍니다.
- **의존**: C-02
- **검증할 경계**: 키보드 접근, 실패 시 입력 보존, 현재 사용자·Mock·실제 AI·승인 상태 표시입니다.

### C-02 ApplicationServices

- **책임**: 사용자 행동별 S-01부터 S-09까지의 서비스를 제공합니다. 권한·현재 상태를 확인하고 변경과 감사·무효화를 묶습니다.
- **소유 정보**: 유스케이스 순서와 저장 경계입니다. 상세 상태 판단은 C-03에 위임합니다.
- **인터페이스**: 사용자용 Command/Query와 내부 GenerationRun 처리 계약입니다. 외부 AI 응답으로 공개 변경 메서드를 직접 호출하지 않습니다.
- **의존**: C-03, C-04, C-07, C-08, C-09
- **검증할 경계**: 같은 검증을 UI와 직접 요청에 적용하고 저장·무효화·이력·중복 요청 기록을 원자적으로 처리합니다.

### C-03 DomainPolicies

- **책임**: 현재 역할·배정, 질문·결정·수정 확인, 검토 기준, G1/G2 통과와 변경 영향의 정책을 판단합니다.
- **소유 정보**: 승인된 요구사항의 업무 조건과 판단 결과입니다. 파일·네트워크·프로세스·DB I/O는 하지 않습니다.
- **인터페이스**: PolicyContext와 현재 스냅샷을 받아 Decision, GateAssessment, ReviewImpact를 반환합니다.
- **의존**: 다른 논리 구성요소에 의존하지 않습니다.
- **검증할 경계**: 동일 입력의 판단을 재현합니다. AI 점수·승인 문구·클라이언트 완료 값을 근거로 삼지 않습니다.

### C-04 LocalPersistence

- **책임**: 업무 상태·불변 버전·현재 참조·활동·중복 요청 결과·생성 작업의 영속 저장과 일관된 조회를 제공합니다.
- **소유 정보**: 유일한 영속 기준입니다. 저장 제품·테이블·잠금 방식은 NFR·Functional Design에서 정합니다.
- **인터페이스**: TransactionBoundary, 업무 repository, RunRepository, ReceiptRepository, ReadRepository입니다.
- **의존**: 다른 논리 구성요소에 의존하지 않습니다.
- **검증할 경계**: 업무 변경과 관련 무효화·요청 연결·이력을 함께 확정하거나 취소합니다. 데이터 보존·충돌·재접속을 검증합니다.

### C-05 GenerationRuntime

- **책임**: 영속 대기 작업을 인수하고 C-06을 실행한 뒤 S-07의 내부 완료 계약에 결과를 전달합니다.
- **소유 정보**: 실행 중인 프로세스 핸들과 취소 신호 등 일시적 실행 정보입니다. 내부 상태 조회로 취소를 ExecutionControl에 전달하고 실제 종료 확인을 내부 계약으로 기록합니다. 작업의 영속 상태는 C-04를 통해 S-07이 관리합니다.
- **인터페이스**: S-07의 claimRun·completeRun·failRun·readRunControl·recordExecutionTermination과 C-06의 generate입니다. 사용자 문서를 직접 저장하지 않습니다.
- **의존**: C-02, C-06, C-09
- **검증할 경계**: 긴 외부 호출 중 업무 트랜잭션을 점유하지 않습니다. 재시작·취소·늦은 결과의 단일 상태 확정을 보장할 실행 계약을 따릅니다.

### C-06 GenerationProviders

- **책임**: 공통 생성 계약으로 Claude adapter와 테스트용 adapter를 제공합니다. Claude 전용 인자·출력 포장·오류는 여기서 변환합니다.
- **소유 정보**: provider 연결, 구조화 출력 정규화, 제한된 프로세스 호출입니다. 승인·단계·저장 repository를 받지 않습니다.
- **인터페이스**: GenerationProvider.generate(ProviderRequest, ExecutionControl)와 ProviderRegistry.resolve입니다.
- **의존**: C-09
- **검증할 경계**: 실행 파일·인자·stdin을 분리합니다. 도구·MCP·문맥·설정 제한을 따로 검증하고 확인되지 않은 model·인증 원인을 추정하지 않습니다.

### C-07 ReferenceProviders

- **책임**: 가상 Jira 목록·가져오기 정보와 GitHub Mock 조회·외부 링크 정보를 제공합니다.
- **소유 정보**: 프로젝트에 포함한 가상 자료와 연결 표시입니다. 실제 외부 시스템의 상태·권한을 정답으로 소유하지 않습니다.
- **인터페이스**: ReferenceProvider.listTickets·getTicket·getImplementationLink입니다. 반환값에 Mock 여부와 출처를 포함합니다.
- **의존**: C-09
- **검증할 경계**: 외부 API 쓰기·양방향 동기화·임의 링크 내용 수집을 하지 않습니다.

### C-08 DocumentPresentation

- **책임**: 문서의 안전한 표시 데이터, 원문·버전 비교, 변경 요약의 연결과 Handoff Markdown 표현을 만듭니다.
- **소유 정보**: 표현 형식과 직렬화 계약입니다. 문서 원문·승인·인계 유효성은 바꾸지 않습니다.
- **인터페이스**: renderDocument·compareVersions·serializeHandoff입니다. 입력은 명시적으로 전달받은 불변 자료입니다.
- **의존**: 다른 논리 구성요소에 의존하지 않습니다.
- **검증할 경계**: 저장한 원문은 보존하고 표시할 때 실행 가능한 내용을 제한합니다. 인계 미리보기·파일은 같은 고정 기준과 본문을 사용합니다.

### C-09 ProjectRuntime

- **책임**: 프로젝트 루트·실행 설정·가상 사용자 목록·시각·ID·설치 Claude 탐색과 제한 프로세스 실행의 기반을 제공합니다.
- **소유 정보**: 프로젝트 내부의 제품 설정과 명시적인 환경 전제입니다. 전역 Codex·Claude 설정을 제품 상태 저장소로 쓰지 않습니다.
- **인터페이스**: ActorResolver, RuntimeConfig, Clock, IdGenerator, ControlledProcessRunner입니다.
- **의존**: 다른 논리 구성요소에 의존하지 않습니다.
- **검증할 경계**: 개인 경로를 고정하지 않고 PATH로 Claude를 찾습니다. 비밀 값을 표시·감사·인계본에 넣지 않습니다. 실제 조직 인증은 구현하지 않습니다.

## 업무 서비스와 스토리

| 서비스 | 사용자 행동 | 연결 스토리 |
|---|---|---|
| S-01 WorkspaceService | 한 팀·프로젝트와 가상 사용자 선택을 제공합니다. | US-001, US-027, US-028, US-029, US-030 |
| S-02 SRContextService | SR 등록·가상 가져오기·원 설명·근거 확인을 관리합니다. | US-001, US-002, US-003 |
| S-03 QuestionDecisionService | 답변·해결·후속 질문·결정 전환·확정·범위 분류를 분리합니다. | US-004, US-005, US-006, US-007, US-008 |
| S-04 ArtifactService | 문서·계획과 버전·비교·AI 초안의 사람 적용을 관리합니다. | US-011, US-012, US-020 |
| S-05 ReviewWorkflowService | 공식 묶음·개별 승인·수정 확인·게이트·재검토를 관리합니다. | US-014, US-015, US-016, US-017, US-018, US-019, US-021, US-022, US-023, US-024, US-025, US-026 |
| S-06 ReviewPolicyService | 정책 버전·SR 명시 적용·검토자 배정을 관리합니다. | US-029, US-030 |
| S-07 GenerationService | 고정 입력·생성 작업·결과 검사·취소·재시도와 초안을 관리합니다. | US-009, US-010, US-011, US-013 |
| S-08 HandoffImplementationService | 유효 기준본 생성·내보내기와 외부 구현 사실을 관리합니다. | US-031, US-032, US-033, US-034 |
| S-09 WorkspaceQueryService | 보드·검토함·상세·변경점·현재 기준과 과거 이력을 조회합니다. | US-015, US-022, US-027, US-028, US-034 |

## 데이터 소유와 변경 원칙

C-04가 SR·근거·질문·결정·문서·묶음·승인·수정 요청·정책·작업·인계·활동을 저장합니다. C-02의 서비스만 공개 업무 명령을 처리하며 현재 역할·배정을 다시 확인합니다. C-03은 현재 스냅샷을 판단하고 I/O를 하지 않습니다. C-05·C-06은 사람의 검토·승인 권한을 받지 않습니다.

불변 내용 버전과 변경 가능한 현재 참조·처리 상태를 구분합니다. 같은 SR의 문서·결정·질문 결과 변경이 승인 기준에 영향을 주면 내용 저장·무효화·검토 대상 갱신·요청 승계·이력 기록을 함께 확정합니다. AI 완료만으로 이 업무 변경을 시작하지 않습니다.

일반 댓글과 의미가 같은 링크 표시명 변경은 승인 대상이 유지되는 경우 승인을 무효화하지 않습니다. 저장 충돌을 위한 revision과 승인 유효성은 다른 개념입니다. 단순히 revision이 증가했다는 이유로 G1·G2를 무효화하지 않습니다.

## 범위와 남은 설계

상세 상태 전이·데이터 스키마·트랜잭션 구현·성능 목표·프로세스 제한의 실제 효과는 Functional Design·NFR·Infrastructure Design과 구현 검증에서 다룹니다. 이 설계는 구현·실제 Claude 실행이 완료됐다는 뜻이 아닙니다.

Security Baseline·Resiliency Baseline·PBT는 비활성 상태로 N/A입니다. 기본 NFR과 TDD는 유지합니다.
