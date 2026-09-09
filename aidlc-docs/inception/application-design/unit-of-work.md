# PlanRepo 작업 단위 정의

상태: 승인된 분해 계획에 따라 작성. Units Generation 산출물 Q1 A 승인 완료. 구현·런타임 검증은 아직 수행하지 않았다.

근거: [분해 계획](../plans/unit-of-work-plan.md), [애플리케이션 설계](application-design.md), [메서드 계약](component-methods.md), [요구사항](../requirements/requirements.md), [스토리](../user-stories/stories.md).

## 단위의 의미와 실행 순서

하나의 로컬 앱을 U1 저장·문서 기반, U2 계획·CLI, U3 리뷰·수동 완료 순으로 완성한다. 작업 단위는 개발 책임의 묶음이며, 한 앱의 논리 모듈로 구현한다. 서버·저장소·빌드 설정을 공유한다. C01/C02와 C09는 후속 기능을 같은 위치에 확장한다.

각 단위의 Functional Design → NFR Requirements → NFR Design → Code Generation 계획·생성을 완료하고 다음 단위로 이동한다. Infrastructure Design 생략은 기존 승인대로 유지한다. 전체 단위 뒤 Build and Test를 수행한다. 단계별 승인 절차도 유지한다.

## U1 — sr-document-foundation

목적: Git 없이 SR과 계획 문서를 저장하고 이전 본문과 사건을 보존하는 기반을 제공한다.

- 주 담당 스토리: US-01, US-06, US-07, US-08, US-09, US-10.
- 협력 범위: US-02의 고정 6열·카드/상세; U2/U3의 문서·버전·사건 저장과 조회.
- 컴포넌트: C03의 생성/조회, C04 전체, C09 저장 기반, C10 직접 입력, C01/C02 앱 기반과 문서 조작.
- 입력: 제목·요구 설명·선택 마크다운의 SRDraft, ActorContext, 대상 VersionRef, 편집 본문, 두 비교 버전, 복원 원본, 정규화된 GeneratedArtifact.
- 출력: 저장된 SR과 보드/상세, 선택 문서·버전·사건 목록, DiffView, 새 편집/복원 버전, 저장 전 DocumentChanges.
- 변경 소유: SR 초기 입력·초기 SR 목록 상태, Document/DocumentVersion, 최신 참조, 생성·편집·복원 사건. 공통 참조/저장 계약은 U1이 먼저 정의한다.

완료 기준: 필수 입력 오류와 첨부 유무, SR 재열람, 문서 편집·선택 버전 열람·비교·복원, SR/문서 소속 검증을 확인한다. 비교는 저장을 바꾸지 않고 복원은 새 버전을 만든다. 과거 본문과 본문 변화 없는 사건을 보존한다. prepareGenerated는 저장 전 변경 묶음을 반환하며 자체 커밋하지 않는다. 저장 실패가 일부 성공으로 공개되지 않는지 필요한 집중 검증을 수행한다.

U1 검증에는 준비된 문서·사건 데이터를 사용할 수 있다. 실제 CLI 결과, 질문/결정 생산, 리뷰 역할과 사건까지 포함한 스토리 전체 완료 증거는 U2/U3가 연결한 뒤 확보한다. U1에서 미래 Run·Review의 모든 필드를 미리 구현하지 않는다.

## U2 — aidlc-planning

목적: SR 문맥으로 실제 CLI를 실행하고 사람의 응답·결정과 함께 구현 직전까지 계획을 진행한다.

- 주 담당 스토리: US-02, US-03, US-04, US-05, US-13.
- 협력 범위: US-06 실제 생성 문서 열람, US-07 실행 중 편집 보존, US-08 AI·질문·결정 사건, U3 비차단 진행 및 완료 연결.
- 컴포넌트: C05, C07, C08, C11; C01/C02 계획 화면·전송; C09 계획 데이터 확장.
- 입력: SRId, PlanningAction, 질문별 응답, 대상 버전/단계와 결정, 저장 문맥, AI-DLC 계획 규칙, 로컬 CLI 설정과 기존 인증.
- 출력: WorkflowView, RunView, 질문·문서 결과, 실패 이유, 사건, 구현 대기 상태. UI는 저장된 결과를 조회한다.
- 변경 소유: 단계·회차·Run·QuestionSet·Answer·PlanningDecision. 생성 문서 변경은 C04가 준비하고 C05가 실행 결과와 함께 저장한다.

완료 기준: 실제 macOS Claude Code CLI를 적어도 한 번 실행해 해당 SR 문서 저장·UI 열람을 확인한다. 실행 전·생성 중·정상 결과·실패를 구분한다. 질문만 있는 유효한 결과와 잘못된/빈 결과를 구분하고, 문서·질문·실행 완료·사건을 관련 변경 단위로 저장한다. 질문 응답·본문 변화 없는 결정이 다음 실행 문맥으로 연결되는지 확인한다. AI 제안이나 리뷰 결과가 자체 승인을 대신하지 않으며 회차·단계·구현 대기 조건은 C11에서 판단한다.

실행 입력 버전을 보관하고 실행 중 편집·늦은 결과가 과거 본문을 덮어쓰지 않도록 U1 계약을 구체화한다. CLI 실행/수집/검증/저장 실패를 성공으로 표시하지 않는다. 구현 대기 전환에서 코드 구현·빌드·Git·PR을 실행하지 않는다. U2에서는 리뷰가 없는 문맥으로 동작하고 U3에서 실제 리뷰 연결을 검증한다.

## U3 — review-implementation

목적: 원래 문서 버전을 대상으로 비차단 리뷰를 제공하고 외부 구현의 수동 완료까지 연결한다.

- 주 담당 스토리: US-11, US-12, US-14.
- 협력 범위: US-02 리뷰/완료 표시, US-05 리뷰와 자체 승인 구분, US-06/08/09 리뷰 역할 조회, US-13 구현 대기에서 완료로 연결.
- 컴포넌트: C06; C01 역할·리뷰·수동 완료와 C02 해당 전송; C03.markImplemented; C09 리뷰 저장 확장.
- 입력: Inception/Construction SR의 VersionRef와 리뷰 요청, 검토 결과/수정 요청, 시연 역할, 구현 대기 SR의 수동 완료 명령.
- 출력: 원래 대상과 최신 버전의 관계가 드러나는 ReviewView, 리뷰 사건, 별도 카드 상태, 수동 완료 SR과 사건.
- 변경 소유: Review/검토 사건; C03.markImplemented를 통한 구현 대기에서 구현 완료로의 수동 전환. RoleSelection은 같은 사용자의 UI 역할이며 인증 신원이 아니다.

완료 기준: 리뷰를 요청해도 카드 열이 유지되고 자체 조건을 충족한 SR의 다음 계획 진행이 가능하다. 역할을 바꿔 원래 버전을 읽고 결과·수정 요청을 기록한다. 이후 버전에 과거 리뷰가 적용된 것처럼 표시하지 않는다. 수동 완료는 Git·빌드 연결 없이 사용자의 선언으로 표시한다. 모든 사건이 기존 이력 조회에 연결되고 저장된 문서·이력을 다시 열 수 있어야 한다.

U3에서 핵심 통합 흐름을 연결하고, 최종 Build and Test에서 빌드와 승인된 통합 시나리오·CLI 실패 경로·키보드 조작의 증거를 정리한다. 전체 E2E 자동화나 운영 부하 검증을 추가 필수 범위로 만들지 않는다.

## 메서드별 구현 담당

시그니처와 의미는 [승인된 메서드 계약](component-methods.md)을 유지한다. 아래 담당은 구현 작업의 소유권이며 컴포넌트의 코드 위치를 변경하지 않는다. UI/전송/조회/저장 기반은 U1에서 만들고 명시된 기능을 U2/U3가 확장한다.

| 컴포넌트 | 메서드 | 최초 구현 담당 | 후속 확장·통합 |
|---|---|---|---|
| C01 | `render` | U1 | U2 계획, U3 리뷰·완료 기능 추가 |
| C01 | `submit` | U1 | U2 계획, U3 리뷰·완료 기능 추가 |
| C01 | `selectRole` | U3 | 로컬 시연 역할; 계정 인증으로 사용하지 않음 |
| C02 | `query` | U1 | U2 계획, U3 리뷰·완료 기능 추가 |
| C02 | `command` | U1 | U2 계획, U3 리뷰·완료 기능 추가 |
| C03 | `create` | U1 | 해당 단위가 승인된 계약 전체 구현 |
| C03 | `listBoard` | U1 | U2 단계·실행, U3 리뷰·완료의 저장 요약 표시 확장 |
| C03 | `getDetail` | U1 | U2 단계·실행, U3 리뷰·완료의 저장 요약 표시 확장 |
| C03 | `markImplemented` | U3 | C03 기존 위치에 추가; U2 서비스 호출 없음 |
| C04 | `listDocuments` | U1 | 해당 단위가 승인된 계약 전체 구현 |
| C04 | `readVersion` | U1 | U2/U3 데이터 생산·역할 연결 후 재사용 확인 |
| C04 | `listVersions` | U1 | U2/U3 데이터 생산·역할 연결 후 재사용 확인 |
| C04 | `listHistory` | U1 | U2/U3 데이터 생산·역할 연결 후 재사용 확인 |
| C04 | `edit` | U1 | 해당 단위가 승인된 계약 전체 구현 |
| C04 | `compare` | U1 | U2/U3 데이터 생산·역할 연결 후 재사용 확인 |
| C04 | `restore` | U1 | 해당 단위가 승인된 계약 전체 구현 |
| C04 | `prepareGenerated` | U1 | U2가 호출하고 실행 결과와 함께 커밋 |
| C05 | `getWorkflow` | U2 | 해당 단위가 승인된 계약 전체 구현 |
| C05 | `advance` | U2 | 해당 단위가 승인된 계약 전체 구현 |
| C05 | `getRun` | U2 | 해당 단위가 승인된 계약 전체 구현 |
| C05 | `answer` | U2 | 해당 단위가 승인된 계약 전체 구현 |
| C05 | `decide` | U2 | 해당 단위가 승인된 계약 전체 구현 |
| C05 | `completePlanning` | U2 | 해당 단위가 승인된 계약 전체 구현 |
| C05 | `finishRun` | U2 | 해당 단위가 승인된 계약 전체 구현 |
| C06 | `request` | U3 | 해당 단위가 승인된 계약 전체 구현 |
| C06 | `listReviews` | U3 | 해당 단위가 승인된 계약 전체 구현 |
| C06 | `getReview` | U3 | 해당 단위가 승인된 계약 전체 구현 |
| C06 | `submitResult` | U3 | 해당 단위가 승인된 계약 전체 구현 |
| C07 | `build` | U2 | U3 리뷰 문맥을 저장 계약으로 연결; C06 호출 없음 |
| C07 | `loadRules` | U2 | 해당 단위가 승인된 계약 전체 구현 |
| C08 | `execute` | U2 | 해당 단위가 승인된 계약 전체 구현 |
| C09 | `read` | U1 | U2 실행·응답·결정, U3 리뷰 타입 확장; 기존 참조/저장 의미 유지 |
| C09 | `commit` | U1 | U2 실행·응답·결정, U3 리뷰 타입 확장; 기존 참조/저장 의미 유지 |
| C10 | `normalize` | U1 | 해당 단위가 승인된 계약 전체 구현 |
| C11 | `evaluate` | U2 | 해당 단위가 승인된 계약 전체 구현 |
| C11 | `evaluateOutcome` | U2 | 해당 단위가 승인된 계약 전체 구현 |

## 확장 준수 평가

| 확장 | Enabled | 평가 | 사유 |
|---|---|---|---|
| Security Baseline | No | N/A | Q11 B로 비활성화; 전체 규칙 로드·적용 생략 |
| Resiliency Baseline | No | N/A | Q12 B로 비활성화; 전체 규칙 로드·적용 생략 |
| Property-Based Testing | No | N/A | Q13 C로 비활성화; 전체 규칙 로드·적용 생략 |

활성 확장 차단 항목은 없다. 승인된 제품 NFR은 계속 적용한다.

## Greenfield 코드 구성과 공통 계약

애플리케이션 코드는 작업공간 루트, 생성 문서는 aidlc-docs/에 둔다. 다음 경로는 승인된 논리 배치이며 프레임워크의 실제 진입점/라우트 규칙은 U1 기술 선택 후 조정한다.

| 경로 | 책임 |
|---|---|
| src/sr-document-foundation/ | SR·문서·버전·이력·저장·직접 입력과 관련 UI/전송 |
| src/aidlc-planning/ | 계획·정책·문맥·CLI와 계획 UI/전송 |
| src/review-implementation/ | 리뷰·역할·수동 완료 흐름; markImplemented는 기존 C03 위치 |
| src/shared/ | 공통 식별자·참조·Result 계약. 도메인 서비스를 옮겨 역의존을 만들지 않음 |
| src/app/ | 단일 앱 조립·브라우저/서버 진입·라우트 연결 |
| tests/{unit-name}/ | 해당 단위의 의미 있는 기능 검증 |
| tests/integration/ | 자동화하는 단위 연결 검증; 전체 E2E 자동화는 필수 아님 |
| config/ | 필요할 때 로컬 실행 설정; 실제 데이터/CLI 위치는 NFR 설계에서 결정 |
| aidlc-docs/construction/{unit-name}/ | functional-design/, nfr-requirements/, nfr-design/, code/ 문서 |

unit-name은 sr-document-foundation, aidlc-planning, review-implementation을 사용한다. 하나의 프로젝트 빌드/실행 설정을 공유하고 원문 requirements/ 및 기존 사용자 파일을 보존한다.

| 공통 계약 | 최초 정의와 확장 책임 | 유지할 의미 |
|---|---|---|
| VersionRef·ActorContext·HistoryEvent | U1 기본, U2/U3 사건 종류·대상 추가 | 소속 확인, 본문 없는 사건 보존, 역할과 실제 신원 구분 |
| C09 read/commit·ChangeSet | U1 저장 기반, 각 후속 단위가 자기 타입 추가 | 관련 변경은 함께 반영; UI가 임의 저장 명령 제출하지 않음 |
| C04.prepareGenerated·DocumentChanges | U1 구현, U2 결과 저장 통합 | 문서 선행 커밋 없이 Run·질문·진행과 일관되게 저장 |
| WorkflowState | U1 초기 저장, U2 계획 의미, U3 수동 완료 | 저장 원본 하나; 카드/상세는 읽은 표현 |
| 리뷰 문맥 조회 | U2 C07 읽기, U3 Review 저장/조회 연결 | 리뷰 없음 허용; C07에서 C06 역호출 없음 |
| 편집과 늦은 생성 결과 | U1 버전 기본 규칙, U2 실행 입력/도착 처리 | 기존 본문 보존, 계약 변경 시 선행 데이터 재검증 |

## 후속 설계 결정 담당

| 결정 | 담당 단계 | 완료 전에 필요한 구체화 |
|---|---|---|
| SR·문서·버전·사건 모델과 비교/복원 | U1 Functional Design | 식별·소속·새 버전·최신 포인터·본문 없는 사건 의미 |
| 공통 스택·영속 저장·데이터 위치·앱 실행 | U1 NFR Requirements/Design | 기술 선택, 일관된 commit 방식, 오류 및 기본 UI/키보드 사용성 |
| 단계·회차·하위 stage·질문·결정·구현 대기 | U2 Functional Design | 정확한 전이·시작/증가 조건, 문서 묶음 승인, 오래된 결정/결과 처리 |
| 실제 CLI 입력·출력·허용 범위·상태 | U2 NFR Requirements/Design 및 Code Generation | 명령 옵션·실행 공간·기존 인증·프로세스 중단 처리; 실제 동작 증거 |
| 리뷰 상태·결과·역할·수동 완료 | U3 Functional Design 및 NFR Design | 버전 고정·새 버전 표시·리뷰와 자체 진행 분리·키보드 조작 |
| 전체 흐름 및 빌드 증거 | U3 연결 후 Build and Test | 핵심 시나리오 1개·CLI 실패·저장 재열람, 비적용 테스트 N/A |

이 표는 결정 담당을 배정한다. CLI 설치·인증·호출 성공, 실제 저장 성능, 미합의 수치를 확정한 기록이 아니다.
