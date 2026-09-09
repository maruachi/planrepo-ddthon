# Domain Entities — Unit U1 (클라이언트 도메인)

> 기술 무관 도메인 모델(서버 없음). `data-model.md`(§11 7엔티티)를 코드 생성용 정밀 타입·열거로 구체화. 모든 인스턴스는 `seed`에서 생성, 새로고침 시 재초기화(MK-6).

## 열거형 (Enums)
- **Stage**: `SR접수` · `Inception` · `Construction설계` · `구현대기` (FR-STG-1)
- **AnswerState**: `미답변` · `편집중` · `제안됨` · `확정됨` (FR-QN-8)
- **SaveState**: `저장중` · `저장됨` · `저장실패` · `미저장` (FR-SV-1)
- **ReviewStatus**: `답변필요` · `결정확정대기` · `계획승인대기` · `수정중` · `수정확인대기` · `산출물승인대기` · `승인완료` (FR-STG-2)
- **AiStatus**: `실행전` · `실행중` · `추가답변대기` · `초안준비` · `실패` · `취소` · `중단재개가능` (FR-STG-2)
- **VersionStatus**: `초안` · `승인`
- **RrState**: `열림` · `수정확인대기` · `확인완료` · `재오픈` (FR-RR-1)
- **Gate**: `AI실행` · `문서승인` · `다음단계인계` (FR-GATE-1~3)
- **Policy**: `전원` · `과반수` · `리더` (FR-POL-1·2)
- **Role**: `요청자` · `개발자` · `결정권자` · `리뷰어` · `리더` (+ 목업 전용 `평가자`) (FR-ROLE-1)
- **TaskType**: `질문분석` · `생성계획승인` · `산출물생성` · `수정초안` (FR-AI-3)

## 엔티티 (필드 · 타입 · 링크)

### SR
`{ id:str, title:str, stage:Stage, assignee:userId, scope:str, workflowVersion:str, refs:{jira?, repo?}, blockReason:str|null, unitIds:[str], policyConfig:PolicyConfig, exception:{gate,reason,actor}|null }`
- 파생: `reviewStatusAgg`, `aiStatusAgg` = 유닛 facet 집계(FR-STG-7).

### Unit
`{ id:str, srId:str, name:str, facets:[Facet], progress:{position:str, unresolvedDeps:[str]}, reviewStatus:ReviewStatus, aiStatus:AiStatus }`
- **Facet**: `{ key:str, applicable:bool, reason:str, requiredArtifacts:[docId], predecessors:[unitId|facetKey], reviewCheckpoint:str }` — `applicable:false` → 진행률 분모 제외(FR-STG-5).

### Document / DocVersion
- **Document**: `{ id:str, unitId:str, type:str, title:str, currentVersion:int }`
- **DocVersion**: `{ docId:str, version:int, body:markdownStr, createdReason:str, inputVersions:[{docId,version}], prevVersion:int|null, status:VersionStatus, staleReview:bool, questionIds:[str] }`
- 규칙 링크: 답변 확정 → 새 DocVersion(FR-VER-2); 과거 버전 승인 차단(FR-VER-3).

### Question / Decision
- **Question**: `{ id:str, docId:str, docVersion:int, originalTitle:str, choices:[{char:str, text:str}], otherChar:str|null, selectionMode:'단일'|'복수'|'Other', answerFormat:str, required:bool, blocking:bool, decisionOwner:userId, parentRunId:str|null, parseError:{kind:'형식오류'|'중복번호'|'Answer누락', location:str}|null }`
- **Decision**(질문당 0..1): `{ questionId:str, answerState:AnswerState, answerValue:str|null, saveState:SaveState, source:'사람확정'|'AI권고', confirmedBy?:userId, confirmedAt?:iso, rationale?:str, history:[{value, confirmedBy, at}] }`

### Approval
`{ id:str, docId:str, version:int, reviewerSet:[userId], policy:Policy, result:'대기'|'승인'|'수정요청', checklist:[{key,label,done}], approver?:userId, approvedAt?:iso }`
- 버전 고정(FR-VER-1). 정책 변경이 과거 승인 미전환(FR-POL-3) — 승인 시점 policy 스냅샷 보관.

### RevisionRequest / Comment
- **RevisionRequest**: `{ id:str, docId:str, atVersion:int, area:str, state:RrState, submitter?:userId, fixVersion?:int, confirmer?:userId, blocking:bool }`
- **Comment**: `{ id:str, rrId?:str, docId:str, atVersion:int, quote:str, anchor:str, orphanedNote?:'이전 버전의 댓글' }` (FR-VER-4)

### AIRun
`{ id:str, parentRunId:str|null, srId:str, taskType:TaskType, inputVersion:{docId,version}, confirmedAnswers:[questionId], revisionRequestId?:str, outputVersion?:{docId,version}, planApproved:bool, status:AiStatus, checkpoint?:str, error?:str }`

### PolicyConfig
`{ srId:str, policy:Policy, reviewerSet:[userId], changedBy?:userId, reason?:str }`

## 시드 인스턴스 요약 (MK-4)
`SR-1024`(Construction설계) → 유닛 `U1주문`(완료), `U2메뉴`(현재), `U3결제`(대기).
`U2메뉴` 문서 `DOC-U2-FUNC` v1✓/v2✓/v3(초안·재검토), `DOC-U2-NFR` v2(초안).
질문 Q2(필수·차단·미확정·P3 이서준)·Q3(필수·차단)·Q5(필수)·Q7(후속·부모 RUN-U2-03·차단아님); 파서 오류 Q6(Answer누락 줄42)·Q4(중복번호).
`RR-2`(DOC-U2-FUNC v2 대상, 수정확인대기, 제출 김도현→fix v3→확인자 박민지 미확인, blocking).
`RUN-U2-03`(산출물생성, 추가답변대기, input v3, planApproved).
사용자: 정하은(요청자)·김도현(개발자)·이서준(결정권자)·박민지(리뷰어)·최유진(리더)·한지우(평가자).
