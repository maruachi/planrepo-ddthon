# U1 도메인 모델

상태: 기능 설계 Q1 B 승인 완료. 실제 저장 스키마·언어·DB는 U1 NFR에서 결정한다.

근거: [메서드 계약](../../../inception/application-design/component-methods.md), [단위 정의](../../../inception/application-design/unit-of-work.md), [설계 계획](../../plans/sr-document-foundation-functional-design-plan.md).

## 식별과 공통 값

ID는 서버가 발급하는 불투명한 식별자이다. 제목·파일명·배열 순서로 소속을 판정하지 않는다. 시각은 서버가 기록한 시점이며 사건의 확정 순서는 SR별 증가 sequence로 구분한다. 실제 ID 형식과 시간 직렬화는 기술 설계에서 정한다.

| 값 | 필드와 의미 | 제약 |
|---|---|---|
| VersionRef | srId, documentId, versionId | 세 ID가 저장된 동일 소속을 가리킴 |
| ActorContext | source: user/ai/system, role: author/reviewer 또는 없음 | 사람의 시연 역할과 AI/시스템 출처를 구분; 인증 신원이 아님 |
| SRDraft | title, description, optional attachmentMarkdown | 제목·설명 필수, 첨부 없음과 빈 첨부 문자열 구분 |
| InputAttachment | markdown, optional displayName | 원본 입력으로 보관; 로컬 파일 경로나 실행 명령이 아님 |
| Result | 성공 값 또는 code/message/field/target 정보 | 성공 여부와 저장 여부를 혼동하지 않음 |
| WorkflowState | column, 후속 단위의 stage/cycle 확장 | 단일 저장 원본; U1은 초기 SR 목록만 생성 |

## 엔터티

| 엔터티 | 핵심 필드 | 소유·관계·불변 조건 |
|---|---|---|
| SR | id, title, description, optional attachment, createdAt, createdBy, workflow | 초기 입력을 보존. 생성 시 문서가 0개일 수 있음 |
| Document | id, srId, logicalKey, latestVersionId, createdAt | 한 SR 소속. logicalKey는 SR 안의 안정된 문서 식별 값. 생성 완료 시 버전이 최소 1개 |
| DocumentVersion | id, srId, documentId, versionNumber, title, body, origin, createdAt, actor, optional baseVersionId/sourceVersionId/runId | 저장 후 변경·삭제하지 않는 전체 본문 스냅샷 |
| HistoryEvent | id, srId, sequence, kind, actor, occurredAt, versionRefs, optional subject, summary, optional details | 본문 변경 없이 존재 가능. versionRefs는 0개 이상. 문서 관련 사건은 대상 버전을 명시 |

Document 제목은 선택 버전의 title에서 읽는다. 새 AI 결과의 제목이 달라도 logicalKey/documentId가 같으면 기존 문서의 새 버전이다. 같은 제목의 다른 문서는 허용하며 제목만으로 문서를 합치지 않는다.

versionNumber는 문서별 저장 순서이며 1부터 증가한다. latestVersionId는 기본 열람하는 명시적 포인터이다. U1에서는 편집·복원·일반 생성 저장 시 새 버전을 가리킨다. 조회는 최대 번호를 최신으로 계산하지 않고 포인터를 사용하여 U2의 늦은 결과 정책을 확장할 수 있게 한다.

baseVersionId는 변경의 출발 버전이다. 복원은 baseVersionId에 처리 시작 때 최신을, sourceVersionId에 고른 복원 원본을 기록한다. AI는 runId와 연결하고 U2가 실행 문맥의 입력 버전을 기록한다. 최초 문서에는 baseVersionId가 없다.

origin은 ai_generated, human_edit, restoration으로 구분한다. HistoryEvent는 추가 후 기존 내용을 수정·삭제하지 않는다. 후속 정정이 필요하면 원래 사건을 보존하고 새로운 사건으로 기록한다.

## 관계의 텍스트 표현

SR 하나는 문서 0개 이상과 사건 1개 이상을 가진다. 문서 하나는 같은 SR의 버전 1개 이상과 최신 버전 참조 하나를 가진다. 사건은 같은 SR의 버전들을 가리키거나 문서 생성 전 단계/실행 사건처럼 버전 없이 존재한다. 버전 하나를 여러 결정이나 리뷰 사건이 가리킬 수 있다. 사건 추가는 해당 버전의 본문을 바꾸지 않는다.

첨부는 SR의 생성 입력이며 DocumentVersion으로 자동 복제하지 않는다. 이를 편집·복원 가능한 계획 문서처럼 표시하지 않는다. 이후 계획 문서는 별도의 Document로 보관한다. 첨부 재열람에 원래 로컬 파일의 존재를 요구하지 않는다.

## 사건 종류와 확장

| 종류 | 생산 담당 | 버전 연결·의미 |
|---|---|---|
| sr_created | U1 C03 | 버전 없음; 초기 입력 생성 |
| document_edited | U1 C04 | 새 버전과 기준 버전; 사람 편집 |
| document_restored | U1 C04 | 새 버전·복원 원본·복원 전 최신 |
| document_generated | U1 C04 준비, U2 C05 커밋 | AI 새 버전과 runId; 준비만으로 공개하지 않음 |
| 계획 실행/응답/결정 사건 | U2 | 종류와 subject는 U2에서 구체화; 질문은 버전 없이, 문서 결정은 버전과 연결 |
| 리뷰/수동 완료 사건 | U3 | 리뷰는 원래 대상 버전, 완료는 SR 상태와 연결 |

U1 이력 뷰는 공통 필드와 본문 없는 사건을 표시한다. U2/U3는 자기 사건 타입과 검증을 추가한다. 브라우저가 임의의 HistoryEvent나 ChangeSet을 제출하는 API는 제공하지 않는다. details는 결정·요청 내용을 보관할 수 있으며 화면에서 텍스트로 표시한다.

## 조회 모델

| 모델 | 표시 데이터 |
|---|---|
| SRSummary | id, title, column, 선택적 stage/cycle 및 실행/리뷰 요약 확장 |
| SRDetail | 초기 입력, 문서 목록, 저장된 workflow와 후속 요약 |
| DocumentView | 정확한 VersionRef, title/body, versionNumber, origin/actor/time, latestVersionRef, isLatest |
| VersionSummary | VersionRef, 번호, 출처, 시각, 기준/복원 원본 참조, isLatest |
| DiffView | left/right VersionRef와 번호·제목, 제목 변경과 전체 변경 없음 여부, 동일/추가/삭제 줄과 양쪽 줄 번호 |
| HistoryView | 저장 순서로 정렬한 사건 목록, 대상 버전 링크, 선택적 상세 내용 |

문서 목록은 최신 제목을 표시하지만 선택 버전 화면은 해당 버전의 제목·본문을 표시한다. 조회 모델은 레코드를 조합한 값이며 별도 수정 가능한 상태 원본이 아니다.

## 저장 전 변경 모델

ChangeSet은 서버 내부 값으로 preconditions, 신규/변경 레코드, events를 포함한다. 전제조건에는 SR 존재, 참조 소속, 기대 최신 버전, 새 logicalKey의 미사용 등이 들어간다. C09는 같은 변경 묶음에서 새로 만들어질 참조도 검증한다.

DocumentChanges는 새 Document/DocumentVersion, 최신 포인터 변경, document_generated 사건 및 전제조건을 담는다. C04.prepareGenerated는 이를 반환할 뿐 저장하거나 성공 이력을 공개하지 않는다. U2는 Run·질문·진행 변경을 더해 하나의 C09.commit으로 저장한다. 모든 변경과 사건을 함께 확정하거나 아무것도 반영하지 않는다.

GeneratedArtifact는 logicalKey, optional documentId, title, body를 갖는다. 기존 문서는 documentId와 logicalKey 일치 및 SR 소속을 확인한다. 새 문서는 기존 키 충돌을 확인한다. runId의 SR 소속은 U2의 Run 레코드와 결합하는 commit 시에도 검증한다. U1 준비 데이터 검증에는 해당 소속을 제공하는 최소 실행 참조를 사용할 수 있지만 실제 CLI 성공 증거로 해석하지 않는다.

## 후속 결정과 확장 준수

DB 트랜잭션·직렬화·저장 경로는 U1 NFR, stage/회차·Run/Question/Decision과 늦은 AI 결과 정책은 U2, Review·역할 전환·수동 완료는 U3가 확정한다. U1은 후속 서비스 필드를 추측해 전부 구현하지 않는다.

Security Baseline, Resiliency Baseline, Property-Based Testing은 모두 Enabled No, N/A이다. 기존 비활성 결정을 유지하며 제품의 저장·이력 보존 요구는 적용한다.
