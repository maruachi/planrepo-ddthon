# PlanRepo 도메인 엔티티

버전은 0.1이며 **사용자 승인 완료**입니다. 승인 응답 “다음단계 진행”을 2026-09-08T14:53:15Z에 기록했습니다. UOW-01 전체의 기술 중립적인 데이터 모델입니다. 엔티티는 논리적으로 보존할 정보의 경계이며 테이블 수나 배포 단위가 아닙니다. 필드의 자료형·DB·ORM·직렬화 형식·실행 제한 수치는 후속 NFR·Infrastructure Design에서 정합니다.

기준은 `aidlc-docs/inception/requirements/requirements.md` 0.4, `aidlc-docs/inception/user-stories/stories.md` 0.1, `aidlc-docs/inception/application-design/component-methods.md`, `aidlc-docs/inception/application-design/services.md`, `aidlc-docs/inception/application-design/unit-of-work.md`입니다. 작성 범위는 `aidlc-docs/construction/plans/planrepo-functional-design-plan.md`를 따릅니다.

## 1. 표기와 공통 값

필수 필드는 유효한 레코드에 반드시 있어야 합니다. 선택 필드는 값이 없을 수 있습니다. 조건부 필드는 지정한 상태나 자료 종류에서 필수입니다. 빈 배열과 값 부재는 다릅니다. 검토자가 없는 빈 집합은 저장 가능한 미준비 상태이며 게이트 통과를 허용하는 상태가 아닙니다.

| 공통 값 | 의미와 조건 |
|---|---|
| ProjectScope | projectId입니다. 가상 사용자·팀 정책·SR 생성 전 요청·프로젝트 조회에 사용합니다. |
| SrScope | projectId와 srId입니다. 모든 SR 하위 엔티티·명령·조회·참조에서 같은 소속을 검사합니다. |
| VersionRef | 자료 종류·논리 ID·불변 version과 범위입니다. 숫자 version만 같은 다른 자료를 참조할 수 없습니다. |
| BundleRef | SrScope·gate·bundleId·version입니다. G2의 g1BundleRef도 같은 SR의 정확한 G1 버전입니다. |
| EntityRef | 종류·ID·범위입니다. 섹션은 ArtifactVersionRef와 sectionId를 함께 사용합니다. |
| revision | 현재 객체를 변경할 때 비교하는 충돌 감지 기준입니다. 내용 버전·검토 기준·승인 유효성과 구분합니다. |
| reviewEpoch | 게이트별 현재 검토 기준 식별자입니다. 영향받는 내용·조건이나 새 공식 검토 기준이 바뀌면 새 값으로 구분합니다. 증가 방식·자료형은 저장 설계에서 정합니다. |
| fingerprint | 입력이나 불변 내용의 동일성 비교값입니다. 입력 필드·참조 버전·규칙 내용을 정해진 방식으로 정규화해 계산합니다. 알고리즘은 후속 설계에서 정합니다. |
| ActorRef | 프로젝트에 속한 사람의 가상 사용자 ID 또는 서버의 내부 runtime 식별자입니다. 내부 주체가 사람의 결정·승인을 할 수 있다는 뜻은 아닙니다. |
| 시각·기한 | 저장 시각은 서버가 부여합니다. 업무 기한이 없으면 기한 초과로 분류하지 않습니다. 날짜 직렬화·시간대 표시는 후속 설계에서 정합니다. |
| EvidenceRef | 같은 SR의 근거 버전·문서 버전 또는 명시적 외부 링크/검증 요약입니다. 읽지 못한 자료의 존재를 확인된 사실로 바꾸지 않습니다. |

불변 레코드는 추가 후 본문·작성 주체·버전을 바꾸지 않습니다. 현재 객체는 불변 이력을 가리키는 포인터와 현재 상태를 가지며 revision 검사를 거쳐 변경합니다. 이 문서의 엔티티 필드에 있는 ref 배열은 정해진 범위를 검사한 참조입니다. UI가 보낸 객체 전체를 신뢰해 저장하지 않습니다.

## 2. 프로젝트·SR·문서

### ENT-01 WorkspaceProject

프로젝트 범위이며 한 팀·프로젝트의 데모 설정과 기본 정책 참조를 보존합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | projectId, teamId, name, revision입니다. |
| 조건부 | defaultPolicyRef와 provider 설정 식별자는 최초 준비 중 없을 수 있습니다. 설정이 있으면 현재 유효한 프로젝트 내부 설정을 가리킵니다. |
| 선택 | 데모 연결 표시와 가상 자료 목록을 포함할 수 있습니다. 자격 증명·개인 설치 경로는 업무 필드에 넣지 않습니다. |

프로젝트 1개에 ENT-02 멤버 여러 명과 ENT-03 SR 0개 이상이 속합니다. 새 기본 정책 지정은 기존 SR의 적용 정책을 자동 변경하지 않습니다.

### ENT-02 DemoUserMembership

가상 사용자와 서버가 인정하는 프로젝트 역할의 현재 자료입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | projectId, userId, displayName, roles, revision과 demo=true입니다. |
| 조건부 | SR 담당자·질문 담당자·결정권자·검토자 지정은 각 SR 객체와 배정 버전에 기록합니다. |
| 선택 | 화면 표시용 역할 설명은 선택입니다. |

프로젝트 내 userId가 고유합니다. 한 사람이 여러 역할을 가질 수 있습니다. ActorContext는 이 현재 정보와 대상 배정을 읽어 구성하며 클라이언트 역할 문자열을 채택하지 않습니다.

### ENT-03 SR

업무 집합의 현재 루트이며 제품 진행 단계와 현재 참조를 보존합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, key, ownerId, originalDescriptionRef, currentDescriptionRef, workflowVersion=v1.0.1, implementationUnitCount=1, progressStage, revision, createdAt, updatedAt입니다. |
| 조건부 | activeImplementationRef는 현재 기준의 외부 구현을 선택해 기록한 경우에만 있습니다. G1/G2의 ENT-21은 SR 생성과 함께 준비합니다. |
| 선택 | jiraKey, jiraUrl, jiraMockStatus, existingSystem 여부와 외부 연결은 선택입니다. 미입력과 기존 시스템 없음은 구분합니다. |

같은 프로젝트의 SR key와 가져온 jiraKey 중복을 검사합니다. 최초 설명을 덮어쓰지 않습니다. progressStage는 sr_received(접수), requirements(요구사항 구체화), planning(계획·설계), ready(구현 준비 완료), implementing(구현 중), completed(구현 완료)입니다. 검토 상태·게이트 유효성·외부 사실은 이 값 하나로 합치지 않습니다.

### ENT-04 SRDescriptionVersion

SR 제목·목적·설명의 불변 편집본입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, descriptionId, version, title, purpose, description, authorId, createdAt입니다. |
| 조건부 | 개정이면 previousVersionRef와 변경 이유를 포함합니다. 처음 등록한 version을 originalDescriptionRef가 계속 가리킵니다. |
| 선택 | Mock 가져오기이면 외부 원 키·상태·출처를 기록할 수 있습니다. |

ENT-03 하나에 버전 1개 이상입니다. currentDescriptionRef는 그 SR의 한 버전만 가리킵니다. 설명 변경은 승인 문서를 자동 덮어쓰지 않으며 검토 기준의 변경 영향은 같은 저장 경계에서 처리합니다.

### ENT-05 ContextSource

SR에 붙인 근거 자료의 정체성과 현재 버전 포인터입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, sourceId, currentVersionRef, revision, createdBy, createdAt입니다. |
| 조건부 | 자료의 대상·본문·확인 결과를 바꾸면 ENT-06 새 버전을 가리킵니다. |
| 선택 | 동일 근거를 나타내는 displayName은 선택입니다. |

SR 1개에 자료 0개 이상입니다. 같은 자료 버전의 표시명만 바꾸고 근거·확인 내용이 같으면 검토 기준 변경으로 간주하지 않습니다. 다른 SR의 자료 버전을 직접 현재 근거로 승계하지 않습니다.

### ENT-06 ContextSourceVersion

자료 내용·출처·사람의 확인 결과를 고정합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, sourceId, version, kind=text\|markdown\|link, provenance, confirmation=unconfirmed\|confirmed, createdBy, createdAt입니다. |
| 조건부 | text·markdown이면 content가 필수입니다. link이면 targetUrl과 확인 가능 여부가 필수입니다. confirmed이면 confirmedBy, confirmedAt, confirmationEvidence가 필수입니다. |
| 선택 | 관찰한 외부 대상 version·확인 불가 이유는 알 수 있을 때 기록합니다. |

ENT-05마다 버전 1개 이상입니다. 확인 동작도 새 버전으로 보존해 이전 묶음의 미확인/확인 상태를 바꾸지 않습니다. 미확인 자료에는 확인자를 만들어 넣지 않습니다. 링크 존재나 AI 추천만으로 confirmed를 만들지 않습니다.

### ENT-07 Artifact

논리 문서의 정체성과 현재 원고를 가리킵니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, artifactId, kind=requirements\|workflow_plan\|design\|implementation_plan, currentVersionRef, revision입니다. |
| 조건부 | 설계 문서이면 designStage가 필수입니다. 선택한 설계 단계마다 필요한 문서의 종류를 구분합니다. |
| 선택 | 문서의 표시 제목은 선택할 수 있습니다. |

SR 1개에 문서 0개 이상이며 문서마다 ENT-08 버전 1개 이상입니다. 같은 논리 문서의 종류를 개정 중 바꾸지 않습니다. 필수 문서의 준비 여부는 이름만으로 판단하지 않고 해당 버전 내용을 검사합니다.

### ENT-08 ArtifactVersion

문서 내용과 추적 정보를 보존하는 불변 버전입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, artifactId, kind, version, markdown, sectionIndex, requirementLinks, authorOrigin, authorId, createdAt, changeSummary입니다. |
| 조건부 | 개정이면 previousVersionRef가 필수입니다. AI 적용이면 draftApplicationRef와 inputSnapshotRef를 연결합니다. 요구사항이면 requirementId·완료 기준을, 구현 계획이면 작업 ID·요구사항·검증·순서 연결을 본문과 일치하게 보존합니다. |
| 선택 | decisionRefs, sourceRefs, questionResultRefs와 관련 설계 참조는 사용한 자료에 맞게 포함합니다. |

sectionIndex는 sectionId·제목·원문 위치의 구조입니다. 동일 버전 안의 sectionId·requirementId·taskId는 고유합니다. 개정에서 같은 항목의 ID를 보존하고 삭제 항목의 ID를 다른 항목에 재사용하지 않습니다. Markdown과 구조화 색인을 서로 다른 원문으로 운영하지 않습니다.

### ENT-09 WorkflowPlanVersion

진행 계획 문서 버전의 업무 구조입니다. ENT-08의 kind=workflow_plan인 버전에 종속한 동일 버전의 자료입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | artifactVersionRef, workflowVersion, 단계별 stageId·executed\|skipped 선택·이유, implementationUnitCount=1과 requirementTaskLinks입니다. |
| 조건부 | 실행 선택 단계에는 필요한 designArtifactRefs가 있어야 G2를 통과할 수 있습니다. 생략 단계에는 생략 이유가 필수입니다. 구현 작업에는 요구사항·검증 방법·회귀 항목 연결이 필요합니다. |
| 선택 | 기존 시스템이 있으면 적용·복구 고려를 관련 문서나 구현 계획 참조에 포함합니다. |

진행 계획 버전 1개와 이 자료는 1:1입니다. 별도 current pointer나 중복 편집본을 만들지 않습니다. 필수 G1/G2·요구사항·진행 계획·필수 설계·구체적 구현 계획을 skipped만으로 제거할 수 없습니다.

## 3. 질문·결정·범위

### ENT-10 Question

한 문제의 현재 질문 상태와 최신 처리 스냅샷을 관리합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, questionId, text, reason, assigneeId, answerMode=choice\|free_text, requiredGate, scopeClassificationRef, status, currentResultSnapshotRef, revision, createdAt입니다. |
| 조건부 | choice이면 options가 있으며 직접 작성 경로도 허용합니다. AI에서 적용한 질문은 sourceDraftRef를 보존합니다. converted_to_decision이면 convertedDecisionId가 필수입니다. |
| 선택 | parentQuestionId, relatedArtifactRefs, sourceRefs, candidateAnswers와 dueAt는 선택입니다. |

상태는 open(열림), answered(답변됨), resolved(해결됨), converted_to_decision(결정 전환됨)입니다. requiredGate는 현재 scopeClassificationRef에서 읽는 값이며 별도 규칙으로 편집하지 않습니다. 한 원 질문에 후속 질문 0개 이상이 연결되며 순환하지 않습니다. 질문 1개가 생성하는 공식 결정은 최대 1개입니다. 전환 뒤에는 결정 항목으로 같은 문제를 한 번만 집계합니다. 원 질문의 필수 시점과 현재 범위를 결정에도 유지하며 전환만으로 차단을 지우지 않습니다. 전환된 원 질문에 대한 답변 변경·해결 확인은 거절하고 상태를 answered나 resolved로 되돌리지 않습니다.

### ENT-11 QuestionAnswerVersion

사람이 선택하거나 직접 작성한 답변의 불변 이력입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, questionId, answerId, version, answeredQuestionSnapshotRef, answerText, evidenceRefs 또는 evidenceText, answeredBy, answeredAt입니다. |
| 조건부 | 선택 답변이면 selectedOptionId와 당시 선택지 내용을 보존합니다. 수정 답변이면 previousAnswerRef를 연결합니다. |
| 선택 | 직접 작성 내용은 선택형에서도 사용할 수 있습니다. |

answeredQuestionSnapshotRef는 답변할 때 읽은 질문 정의를 고정하며 그 답변을 포함해 새로 만드는 결과 스냅샷과 구분합니다. 질문 1개에 답변 버전 0개 이상이며 ENT-12가 현재 채택한 한 답변 버전을 가리킵니다. AI 후보는 이 엔티티의 사람 답변으로 저장하지 않습니다. 답변 저장만으로 해결 확인을 생성하지 않습니다.

### ENT-12 QuestionResultSnapshot

검토·AI 입력에서 읽을 특정 시점의 질문 정의와 처리 결과를 고정합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, questionId, version, text, reason, assigneeId, answerMode, options, status, classificationRef, evidence/source refs, capturedAt입니다. |
| 조건부 | answered·resolved이면 selectedAnswerRef가 필수입니다. resolved이면 resolvedBy, resolvedAt, resolutionEvidence와 reflectedArtifactRefs 또는 noDocumentChangeReason이 필수입니다. converted_to_decision이면 convertedDecisionId가 필수입니다. |
| 선택 | 후속 질문의 연결, candidateAnswers, dueAt와 설명을 포함할 수 있습니다. |

질문 1개에 스냅샷 1개 이상입니다. 질문 정의·답변·해결·필수 시점이 바뀌면 새 버전을 만들며 이전 결과를 수정하지 않습니다. 해결 확인은 특정 답변·근거·반영 문서 버전에 고정됩니다. 새 답변이나 반영 내용 변경 후 과거 확인을 현재 해결로 조용히 재사용하지 않습니다.

### ENT-13 Decision

논의할 선택 문제와 현재 공식 결정 버전을 관리합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, decisionId, prompt, alternatives, impact, decisionMakerId, classificationRef, revision, createdBy, createdAt입니다. |
| 조건부 | currentConfirmedVersionRef가 없으면 미확정입니다. 원 질문을 전환한 경우 originQuestionId가 필수이며 같은 질문의 기존 전환을 재사용합니다. |
| 선택 | AI 추천·근거, originDraftRef, dueAt와 후속 제안은 선택입니다. |

SR 1개에 결정 0개 이상이며 결정 1개에 ENT-14 버전 0개 이상입니다. 미확정 대안과 AI 추천은 공식 선택 필드가 아닙니다. 현재 지정 결정권자만 확정·재결정할 수 있으며 지정 여부는 요청 확정 시 다시 검사합니다.

### ENT-14 DecisionVersion

사람이 확정한 선택과 이유를 보존합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, decisionId, version, prompt, alternatives, impact, selectedOption 또는 명시적 선택 내용, rationale, evidenceRefs 또는 evidenceText, decisionMakerId, decidedAt, classificationRef입니다. |
| 조건부 | 재결정이면 previousVersionRef와 changeReason이 필수입니다. 원 질문이 있으면 originQuestionId와 근거 QuestionResultSnapshotRef를 포함합니다. |
| 선택 | 영향받는 requirementId·artifactVersionRef를 포함할 수 있습니다. |

이 엔티티가 존재하려면 지정 결정권자의 확정이 있어야 합니다. 이전 버전·그 버전의 결정권자·분류를 수정하지 않습니다. 재결정과 현재 포인터 이동·ReviewImpact는 한 번에 확정합니다.

### ENT-15 ScopeClassificationVersion

질문·결정의 필요한 게이트와 후속 범위 분류의 근거를 보존합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, classificationId, version, targetRef, scope=current\|followup, requiredGate=G1\|G2\|None, reason, classifiedBy, classifiedAt입니다. |
| 조건부 | current이면 requiredGate는 G1 또는 G2입니다. followup이면 None이며 ownerId·revisitAt 또는 명확한 재검토 사건/시점이 필수입니다. 현재 범위 축소이면 승인 대상 요구사항·완료 기준 개정 참조와 필요한 확정 결정 참조를 보존합니다. |
| 선택 | previousVersionRef와 관련 요구사항 ID를 포함할 수 있습니다. |

대상 1개에 분류 버전 1개 이상입니다. classifiedBy는 현재 SR 담당자입니다. followup 레이블만으로 기존 필수 결정을 제거하지 않습니다. 분류가 가리키는 범위 변경과 재승인 조건은 게이트에서 검사합니다. G2 필수 항목은 G1의 미해결 수에 포함하지 않습니다.

## 4. 검토·승인·수정 요청

### ENT-16 ReviewPolicyVersion

팀의 G1/G2 검토 역할·필수 체크리스트 정책을 고정합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | ProjectScope, policyId, version, 각 gate의 requiredRoles·checklist, requireAllAssigned=true, requireDistinctPeer=true, createdBy, createdAt입니다. |
| 조건부 | 개정이면 previousVersionRef·changeReason을 보존합니다. |
| 선택 | 정책 설명은 선택입니다. |

프로젝트에 정책 버전 1개 이상을 준비합니다. 체크리스트 항목 ID는 해당 버전 안에서 고유합니다. 새 기본 정책은 기존 SR에 자동 소급하지 않습니다. 명시적 적용 때만 ENT-21의 policyRef를 바꾸고 새 검토 기준을 만듭니다.

### ENT-17 ReviewAssignmentVersion

특정 SR·게이트의 지정 검토자 집합을 고정합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, gate, assignmentId, version, reviewerIds, assignedBy, assignedAt입니다. |
| 조건부 | 변경이면 previousVersionRef와 changeReason이 필수입니다. 비어 있거나 담당자 외 동료가 없으면 미준비 사유를 표시하고 통과를 막습니다. |
| 선택 | 배정 설명은 선택입니다. |

SR·gate 1개에 배정 버전 0개 이상이며 ENT-21이 현재 한 버전을 선택합니다. 문서가 아직 없어도 최초 배정은 가능하며 BundleRef를 가짜로 만들지 않습니다. reviewerIds는 중복 없는 집합이며 역할 겸임 자체를 금지하지 않습니다.

### ENT-18 ReviewBundle

공식 검토의 내용과 조건을 고정한 기준본입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, gate, bundleId, version, reviewEpoch, artifactVersionRefs, decisionVersionRefs, unconfirmedDecisionSnapshots, questionResultRefs, classificationRefs, contextSourceVersionRefs, assignmentRef, reviewerIds, policyRef, checklistSnapshot, createdBy, createdAt입니다. |
| 조건부 | G1에는 요구사항 기준이 필수입니다. G2에는 g1BundleRef와 진행 계획·선택 설계·구체적 구현 계획 버전이 필수입니다. 사용한 SR 설명·근거도 정확한 버전을 고정합니다. |
| 선택 | previousBundleRef와 변경 요약을 포함할 수 있습니다. |

SR·gate 1개에 묶음 0개 이상입니다. g1BundleRef는 생성 시 현재 유효한 같은 SR G1을 정확히 가리킵니다. 묶음 내용·reviewerIds·policyRef를 나중에 수정하지 않습니다. unconfirmedDecisionSnapshots에는 당시 미확정 결정의 ID·revision·질문·대안·영향·결정권자·분류와 미확정 상태를 묶음 내부의 불변 값으로 고정합니다. 확정된 결정은 decisionVersionRefs에 연결하며 같은 결정을 두 집합에 중복 포함하지 않습니다. 확정·재결정·제안 변경이 생기면 새 묶음을 요구합니다. 승인·수정 요청·진행 상태는 ENT-19·ENT-20·ENT-21·ENT-24에 분리합니다.

### ENT-19 ReviewRequest

누가 어느 공식 묶음을 검토해야 하는지와 요청 이력을 보존합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, requestId, bundleRef, reviewEpoch, reviewerId, requestKind, requestedBy, requestedAt, status, revision입니다. |
| 조건부 | 대체되면 supersededByRequestId 또는 supersededByBundleRef·supersededAt을 보존합니다. 처리되면 resultRef와 handledAt을 연결합니다. |
| 선택 | dueAt와 요청 설명은 선택입니다. |

묶음 1개에 지정 검토자별 요청이 연결됩니다. 같은 묶음·검토자·종류의 활성 요청을 중복 생성하지 않습니다. 상태는 pending, handled, superseded를 구분합니다. 현재 검토함은 현재 epoch·묶음의 요청만 공식 검토 할 일로 읽으며 이전 요청은 이력에서 보존합니다.

### ENT-20 Approval

사람의 특정 묶음에 대한 개별 승인 사실입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, approvalId, bundleRef, reviewEpoch, policyRef, checklistResults, approverId, approvalScope, result=approved, approvedAt입니다. |
| 조건부 | 필수 체크리스트마다 확인한 항목 ID·결과가 필요합니다. 현재 지정 검토자이며 묶음 버전이 정확해야 생성합니다. |
| 선택 | 검토 의견은 선택입니다. |

묶음별 사람의 유효한 개별 승인 사실을 중복 생성하지 않습니다. 변경 후에도 이 레코드는 보존하지만 새 epoch·새 묶음의 승인으로 계산하지 않습니다. 지정된 담당자의 승인은 허용하되 담당자 외 동료 없이 이것만으로 통과하지 않습니다. 승인 생성은 단계 전환을 일으키지 않습니다.

### ENT-21 ReviewGateState

게이트별 현재 검토 기준과 통과 유효성을 관리합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, gate=G1\|G2, reviewEpoch, needsNewBundle, validity=not_passed\|valid\|invalid, revision입니다. |
| 조건부 | policyRef·assignmentRef·currentBundleRef·lastPassRef는 준비되거나 통과한 경우에 존재합니다. 기준 변경이면 기준 변경 recordRef와 사유·영향 대상이 필수입니다. |
| 선택 | 현재 검토 상태의 계산에 필요한 명시적 요청 결과를 연결할 수 있습니다. |

SR마다 G1/G2 각 1개입니다. currentBundleRef가 있어도 valid가 아닐 수 있습니다. valid에는 현재 기준의 ENT-22 pass 기록이 필요합니다. 기준이 바뀌면 needsNewBundle을 설정합니다. 과거 통과 이력이 있으면 invalid로, 통과한 적이 없으면 not_passed로 둡니다. G1 변경 시 G1과 종속 G2의 새 기준·무효화가 함께 확정됩니다. 과거 G2의 lastPassRef만으로 새 G1 뒤의 valid를 복원하지 않습니다.

### ENT-22 GateTransitionRecord

통과·무효화의 당시 기준과 이유를 고정하는 업무 이력입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, transitionId, gate, reviewEpoch, kind=passed\|invalidated, actorRef, occurredAt, affectedVersionRefs입니다. |
| 조건부 | passed이면 bundleRef·정책/배정·개별 Approval refs·당시 조건 근거가 필수입니다. invalidated이면 이전 기준·변경 원인·영향받은 gate를 고정합니다. |
| 선택 | beforeStage와 afterStage는 실제 진행 단계가 바뀐 경우 기록합니다. |

게이트마다 기록 0개 이상입니다. 통과 사실은 당시 기준의 기록이며 현재 유효성은 ENT-21과 비교합니다. 일반 댓글이나 화면 열람만으로 이 레코드를 만들지 않습니다. 업무 변경·현재 게이트·단계·활동·receipt와 함께 확정합니다.

### ENT-23 Comment

문서 버전·섹션에 붙인 일반 의견입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, commentId, artifactVersionRef, sectionId, body, authorId, createdAt입니다. |
| 조건부 | 섹션이 새 버전에서 삭제돼도 원 버전·섹션 연결은 유지합니다. |
| 선택 | 관련 ReviewBundleRef는 공식 검토 문맥에서 작성한 경우 연결할 수 있습니다. |

문서 버전·섹션 1개에 댓글 0개 이상입니다. 본문 댓글과 ENT-24의 수정 요청은 구분합니다. 일반 의견만으로 차단·승인·단계 통과를 생성하지 않습니다.

### ENT-24 ChangeRequest

해결 확인 전까지 이어지는 수정 문제의 정체성과 현재 처리 상태입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, changeRequestId, originalTargetVersionRef, originalSectionId, body, blocking, affectedGate, assigneeId, requesterId, status=open\|awaiting_confirmation\|resolved, currentTargetRef, revision, requestedAt입니다. |
| 조건부 | awaiting_confirmation이면 currentApplicationEventRef가 필수입니다. resolved이면 currentResolutionEventRef가 필수입니다. 섹션이 없으면 currentTargetRef에 missing_section을 표시하고 원 위치·별도 목록 연결을 유지합니다. |
| 선택 | dueAt, 관련 BundleRef와 현재 지정 확인 검토자 연결은 선택입니다. |

요청 1개에 ENT-25 이력 1개 이상입니다. 미해결 요청은 새 버전·묶음으로 승계하며 ID·원 요청자·blocking을 유지합니다. 비차단 요청도 삭제하거나 임의 차단으로 승격하지 않습니다. 원 요청자는 현재 검토자 배정에서 빠져도 요청자 자격으로 확인할 수 있습니다.

### ENT-25 ChangeRequestEvent

수정 요청의 반영·피드백·해결·대상 승계 이력을 고정합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, eventId, changeRequestId, kind, actorId, occurredAt, beforeStatus, afterStatus, targetVersionRef입니다. |
| 조건부 | 반영이면 appliedArtifactVersionRef·반영 내용·근거가 필수입니다. 해결이면 검증한 applicationEventRef·정확한 반영 버전·확인 결과가 필수입니다. 추가 수정이면 미해결 내용과 피드백이 필수입니다. 섹션 삭제/승계이면 원 대상과 새 대상 또는 missing_section을 기록합니다. |
| 선택 | 관련 명령 receipt와 검토 묶음 참조를 연결할 수 있습니다. |

반영자와 확인자가 역할을 겸한다는 이유만으로 거절하지 않습니다. 확인 권한은 원 요청자 또는 현재 지정 검토자입니다. 과거 반영 이벤트 확인으로 새 반영 버전을 해결하지 못합니다. 반영 확인 대기는 blocking을 해제하지 않습니다.

## 5. 생성·적용

### ENT-26 InputSnapshot

생성 요청 당시 모델에 줄 내용과 출처·버전을 고정합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, snapshotId, workflowVersion, taskKind, contentFingerprint, SR 설명·문서·질문·답변·결정·분류·근거의 실제 내용과 참조, 프로젝트 내부 규칙의 버전·내용, capturedAt입니다. |
| 조건부 | 입력에 있는 자료마다 confirmed/unconfirmed 또는 사람 확정 여부를 구분합니다. 특정 문서 작업이면 documentKind와 targetBasis가 필수입니다. 기존 문서이면 targetBasis는 정확한 targetVersionRef입니다. 최초 생성이면 문서 종류·논리 대상 키와 absent 표시를 고정합니다. 적용 전에 같은 대상 문서가 생기면 충돌로 판단합니다. |
| 선택 | 사용자가 요청한 보완 내용과 이전 생성 연결은 요청한 경우 포함합니다. |

생성 실행 1개는 스냅샷 1개를 고정합니다. 최신 포인터만 저장한 뒤 실행 시 다시 읽지 않습니다. 다른 SR의 자료를 포함하지 않습니다. 일반 댓글 등 생성 입력에 포함하지 않은 변경은 fingerprint와 분리합니다.

### ENT-27 GenerationRun

영속 생성 작업의 수명과 고정된 요청 선택을 관리합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, runId, taskKind, inputSnapshotRef, providerSelection, requestedBy, requestedAt, status=pending\|running\|succeeded\|failed\|cancelled, revision입니다. |
| 조건부 | running이면 claimRef·startedAt, succeeded이면 resultDraftRef·finishedAt, failed이면 판별 가능한 errorCode·제거된 진단·finishedAt, cancelled이면 cancelledBy·cancelledAt이 필수입니다. |
| 선택 | retryOfRunId, 확인 가능한 actualModelId·cliVersion을 포함할 수 있습니다. 확인하지 못한 값은 없음/미확인으로 둡니다. |

providerSelection은 providerId와 modelChoice=installed_default\|explicit을 요청 시 고정하며 explicit이면 modelId가 필수입니다. 설정 변경은 이미 대기 중인 실행의 선택을 바꾸지 않습니다. 성공·실패·취소 terminal 상태는 경쟁에서 먼저 확정된 결과를 유지합니다. 오래됨·사람 적용·실제 종료 관찰을 status에 합치지 않습니다.

### ENT-28 ExecutionClaim

백엔드가 한 실행을 인수한 소유권입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, claimId, runId, ownerRuntimeId, ownershipToken, claimedAt, executionPolicyRef입니다. |
| 조건부 | 실행 인수 시 요청에 고정한 InputSnapshot·ProviderSelection을 함께 반환합니다. |
| 선택 | 중단 관찰·회수 근거는 실제 확인된 경우 기록합니다. |

실행 1개에 성공적으로 인수한 claim은 최대 1개입니다. 사용자 재시도는 새 GenerationRun을 만듭니다. 새 인수·재시작 복구 정책은 NFR Design에서 정하며 기존 claim을 다른 실행 권한으로 재활용하지 않습니다. 소유권 토큰은 내부 전용이며 UI·모델 입력·일반 활동·인계에 내보내지 않습니다.

### ENT-29 ExecutionObservation

프로세스 제어와 실제 종료 관찰을 업무 생성 상태와 분리합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, observationId, claimRef, observationKind=termination_confirmed, observedByRuntime, observedAt입니다. |
| 조건부 | 실제 확인한 terminationResult가 필수입니다. 취소를 요청하거나 신호를 전달했다는 사실만으로 이 종료 확인 레코드를 만들지 않습니다. |
| 선택 | 비밀 값을 제거한 진단·확인된 종료 코드·시간을 포함할 수 있습니다. |

claim 1개에 종료 확인 0개 또는 1개입니다. 같은 종료 확인을 중복 기록하지 않습니다. 런타임만 M-049로 제어 상태를 읽고 M-050으로 실제 종료를 기록합니다. 취소된 작업의 늦은 종료 기록은 취소 상태를 성공·실패로 바꾸거나 업무 문서를 적용하지 않습니다.

### ENT-30 GenerationDraft

생성 결과 또는 사람이 오래된 결과를 비교해 정리한 미확정 초안입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, draftId, schemaVersion, taskKind, body, basisInputSnapshotRef, basisFingerprint, provenance, createdAt입니다. |
| 조건부 | AI 결과이면 sourceRunId가 필수이고 성공한 유효 형식 결과만 연결합니다. 사람 비교 초안이면 sourceDraftId·reviewedBy·reviewedAt·현재 입력 기준·비교 반영 설명이 필수입니다. |
| 선택 | 문서 종류, 제안 내 임시 ID와 정규화된 참조, 변경 요약을 작업별로 포함합니다. |

성공 실행의 결과는 원 초안으로 고정합니다. 사람 비교는 새 초안을 만들어 원 실행·입력·오래됨 근거를 보존합니다. 입력 최신성은 현재 기준과 비교한 조회값이며 조회가 초안 상태를 쓰지 않습니다. 모델의 승인 문구·외부 ID를 업무 명령으로 채택하지 않습니다.

### ENT-31 DraftApplication

사람이 어떤 초안을 어떤 현재 대상에 적용했는지 고정한 결과입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, applicationId, draftId, appliedBy, appliedAt, checkedInputFingerprint, selectedContent, outputRefs와 commandReceiptRef입니다. |
| 조건부 | 문서 적용이면 새 ArtifactVersionRef를 연결합니다. 질문·결정 제안 적용이면 서버가 부여한 Question/Decision ID와 제안 임시 ID 매핑을 보존합니다. |
| 선택 | 사람이 적용 전에 작성한 수정 이유를 기록할 수 있습니다. |

초안 1개에 한 번의 사람 적용 결과를 기록합니다. 적용 전에는 0개이고 적용 후에는 1개입니다. 선택한 결과가 여러 질문·결정이면 한 적용 안에서 각각의 결과 ID를 연결합니다. 동일 행동·동일 제안을 반복 적용해 중복 생성하지 않습니다. 추가 검토로 반영할 내용은 새 현재 초안에서 다룹니다. 원 초안·실행의 내용을 덮어쓰지 않습니다.

## 6. 인계·외부 구현·추적

### ENT-32 Handoff

유효한 현재 승인에서 만든 외부 전달용 불변 기준본입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, handoffId, version, g1BundleRef, g2BundleRef, approvalRefs, artifactVersionRefs, decisionVersionRefs, questionResultRefs, workflowVersion, 검증 기준·후속 범위의 고정 내용, markdownSnapshot, createdBy, createdAt입니다. |
| 조건부 | G2가 고정한 g1BundleRef와 정확히 같아야 합니다. 실제 참조한 승인자·정책·문서 내용과 본문을 일치하게 고정합니다. |
| 선택 | previousHandoffRef와 작성 이유를 포함할 수 있습니다. |

SR 1개에 인계 0개 이상입니다. 현재용 생성·내보내기는 현재 게이트·epoch·정확한 묶음을 검사합니다. 인계 본문을 현재 문서 포인터로 다시 조합하지 않습니다. 나중에 무효화돼도 원본은 보존하며 과거 열람은 가능합니다. 이미 내려받은 파일을 회수하는 데이터 상태를 만들지 않습니다.

### ENT-33 ImplementationRecord

선택한 인계 기준별 외부 구현의 수동 사실을 기록합니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | SrScope, implementationId, handoffRef, startedBy, startedAt, status=started\|completed, revision과 기록이 수동이라는 표시입니다. |
| 조건부 | completed이면 completedBy·completedAt·completionSummary와 PR 링크 또는 검증 결과 요약 등 evidence가 필수입니다. |
| 선택 | 외부 저장소·PR·GitHub Mock 링크와 외부 작업 설명은 선택입니다. |

Handoff 1개에 외부 구현 기록 0개 또는 1개입니다. 동일 시작 재요청은 중복 기록을 만들지 않습니다. 완료는 이미 시작한 그 기록에 연결합니다. H1의 완료 사실은 H2에 복사하지 않습니다. H2가 현재 기준이면 과거 H1의 완료 입력으로 SR을 현재 구현 완료로 전환하지 않습니다. 재검토 중에도 H1의 사실·근거는 보존합니다.

### ENT-34 ActivityEvent

사용자에게 보이는 주요 업무 행동의 추가 전용 이력입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | ProjectScope, activityId, eventType, actorRef, targetRefs, occurredAt, commandReceiptRef 또는 내부 실행 근거, description입니다. |
| 조건부 | SR 업무이면 srId가 필수입니다. 버전 행동이면 정확한 VersionRef 또는 BundleRef를 연결합니다. 팀 정책 행동은 프로젝트 범위로 남깁니다. |
| 선택 | 변경 전후 참조·재검토 이유와 외부 구현 연결을 포함할 수 있습니다. |

업무 변경·현재 포인터·활동·receipt는 함께 저장합니다. 저장 실패를 성공한 업무 이벤트로 남기지 않습니다. 생성 실패/취소 자체를 정상적으로 확정한 이력과 업무 처리 실패를 구분합니다. 일반 UI에서 과거 활동을 수정·삭제하지 않습니다.

### ENT-35 CommandReceipt

반복 요청을 구분할 확정 결과의 추가 전용 기록입니다.

| 구분 | 필드와 조건 |
|---|---|
| 필수 | TargetScope, receiptId, actorRef, commandKind, requestId, idempotencyKey, inputFingerprint, committedRevision, resultRefs, committedAt입니다. |
| 조건부 | 새 SR 생성 명령은 ProjectScope와 생성 결과 SR 참조를 사용합니다. SR 업무는 SrScope를 사용합니다. |
| 선택 | 안전하게 재표시할 결과 요약을 포함할 수 있습니다. |

중복 키의 범위는 TargetScope·actorRef입니다. 그 범위의 같은 idempotencyKey에 다른 commandKind 또는 입력이 오면 충돌입니다. 동일 요청은 중복 변경·활동을 만들지 않습니다. 재전송 시 현재 권한과 현재용 전환·인계 조건을 재검사하며 과거 성공 receipt를 현재 유효한 승인·인계로 해석하지 않습니다.

## 7. 관계와 카디널리티

표의 0개 허용은 저장 가능한 시작 상태를 뜻합니다. 게이트 통과에 필요한 최소 수는 업무 규칙에서 따로 검사합니다.

| 관계 | 카디널리티와 같은 범위 조건 |
|---|---|
| 프로젝트와 사용자·SR | 프로젝트 1개에 사용자 1명 이상, SR 0개 이상입니다. SR 담당자·검토자·결정권자는 같은 프로젝트의 사용자입니다. |
| SR과 설명·근거·문서 | 최초 설명 1개와 설명 버전 1개 이상입니다. 근거·문서는 각각 0개 이상이며 각 현재 포인터는 자기 ID의 버전 하나를 가리킵니다. |
| SR과 게이트 | G1·G2 각각 현재 상태 1개입니다. 각 게이트에 묶음·정책 적용·검토자 배정·통과/무효화 이력이 연결됩니다. |
| 질문과 처리 | 질문 1개에 답변 버전 0개 이상·결과 스냅샷 1개 이상·후속 질문 0개 이상입니다. 원 질문에서 전환하는 결정은 최대 1개이며 전환 명령과 연결을 함께 저장합니다. |
| 결정과 확정 | 결정 1개에 확정 버전 0개 이상입니다. 미확정이면 현재 공식 버전 포인터가 없습니다. 분류는 질문/결정 ID에 속합니다. |
| 묶음과 승인 | 묶음 1개에 요청·개별 승인 0개 이상입니다. 승인 가능한 모든 지정자는 묶음의 검토자 집합에 속해야 하며 통과에는 그 전원이 필요합니다. |
| G2와 G1 | G2 묶음 1개는 정확한 G1 묶음 1개를 참조합니다. G1의 현재 유효성·정확한 ref·새 검토 기준을 함께 확인합니다. |
| 수정 요청과 버전 | 요청 1개는 원 문서 버전·섹션 1개와 현재 대상 1개를 가집니다. 새 버전의 섹션 부재도 현재 대상 상태로 남기며 요청을 제거하지 않습니다. |
| 생성과 소유권·초안 | Run 1개에 입력 스냅샷 1개·고정 선택 1개·claim 0개 또는 1개입니다. 성공하면 원 결과 초안 1개가 있습니다. 재시도는 이전 Run을 가리키는 새 Run입니다. |
| 초안과 적용 | 초안에는 원 실행 또는 사람의 비교 출처가 있습니다. 적용은 초안·현재 입력·사람·새 업무 결과를 연결합니다. 제안 임시 ID를 다른 SR의 실체 ID로 취급하지 않습니다. |
| 인계와 외부 사실 | 인계 1개에 정확한 G1·G2와 승인/내용 참조가 있습니다. 외부 기록은 그 인계에만 속하고 SR은 현재 선택한 기록을 별도로 가리킬 수 있습니다. |
| 변경과 추적 | 한 확정 명령은 업무 결과·필요한 현재 참조/무효화·활동과 receipt를 함께 저장합니다. 한 receipt에 관련 활동이 여러 개일 수 있습니다. |

## 8. 상태 분리와 조회 규약

| 축 | 보존하거나 계산하는 값 | 금지하는 혼동 |
|---|---|---|
| 제품 진행 | ENT-03의 progressStage입니다. 변경 영향에 따라 요구사항 또는 계획·설계 검토 단계로 복귀할 수 있습니다. | 외부 완료 사실만으로 현재 게이트를 통과시키지 않습니다. |
| 검토 상태 | 작성 중·검토 요청·검토 중·수정 필요·승인 완료·재검토 필요를 현재 기준의 요청·승인·미해결 문제·통과/무효화 사실로 계산합니다. | 일반 조회를 검토 시작이나 승인 완료 기록으로 바꾸지 않습니다. |
| 게이트 유효성 | ENT-21의 not_passed·valid·invalid와 현재 epoch·BundleRef입니다. | 지정 전원의 개별 승인 완료와 명시적 게이트 통과를 합치지 않습니다. |
| 질문·결정 | 답변·해결 확인·결정 전환·사람의 공식 확정 버전을 구분합니다. | 전환 질문과 미확정 결정을 같은 문제 두 개로 세지 않습니다. |
| 수정 요청 | open·awaiting_confirmation·resolved와 blocking을 따로 보존합니다. | 반영 제출이나 섹션 삭제를 해결 확인으로 취급하지 않습니다. |
| 생성 | Run terminal 상태, 현재 입력과의 최신성, 적용 이력, 실제 종료 관찰을 구분합니다. | cancelled 표시만으로 프로세스 종료 확인을 만들지 않습니다. |
| 외부 구현 | 특정 Handoff의 started·completed와 근거입니다. | 이전 Handoff의 완료를 최신 Handoff의 완료로 복사하지 않습니다. |

검토 상태는 화면을 읽어서 바뀌지 않습니다. UI가 사용하는 BoardView·InboxView·GateAssessment·SRDetailView·GenerationRunView·HandoffPreview는 같은 확정 자료를 읽어 구성하는 조회 모델입니다. 별도 업무 권한이나 쓰기 명령으로 취급하지 않습니다. 검토 중 표시는 저장된 명시적 검토 행동이 있을 때만 근거를 가지며 화면 접속만으로 생성하지 않습니다. 상세한 표시 우선순위와 상태 전이는 `aidlc-docs/construction/planrepo/functional-design/business-logic-model.md`에서 정합니다.

Inbox 항목은 질문·결정·현재 공식 검토 요청·수정·반영 확인에서 계산합니다. 기한·현재 단계 차단·직접 요청 여부·최근 시각과 대상 ID를 포함합니다. 원 요청자와 현재 지정 검토자라는 두 확인 자격을 보존하고 같은 사용자·같은 문제·같은 행동을 중복 표시하지 않습니다. 별도 비동기 projection 저장이나 열람에 따른 읽음 상태를 새 범위로 요구하지 않습니다.

## 9. 일관성 불변식과 검증 연결

| 구간 | 불변식 | 기준 |
|---|---|---|
| 범위 | SR 하위 참조는 모두 같은 SrScope입니다. 프로젝트 정책·가상 사용자는 같은 ProjectScope여야 합니다. | FR-01·02, NFR-04·08, AC-01·09·19입니다. |
| 현재와 이력 | 원 설명·문서·결정·질문 처리·근거·묶음·인계의 불변 버전을 덮어쓰지 않습니다. 현재 포인터만 조건부 갱신합니다. | FR-03·07·11·13·22, NFR-01·02, AC-13입니다. |
| 해결 근거 | 질문 해결은 선택 답변·근거·반영 문서 버전, 수정 해결은 현재 반영 이벤트·버전에 고정됩니다. | FR-05·12, AC-02·05·16입니다. |
| 승인 기준 | policy·assignment·reviewEpoch·BundleRef가 현재 기준과 일치해야 합니다. G2는 정확한 유효 G1을 사용합니다. | FR-13·14·15·19, AC-04·06·07·10입니다. |
| 변경의 원자성 | 변경·새 버전·현재 포인터·무효화·복귀·요청 승계·활동·receipt는 함께 확정하거나 전부 보존합니다. | FR-15·16·22, NFR-01·02·03, AC-09·13·16입니다. |
| 생성 경계 | 입력·선택·claim은 실행 기준이며 모델이 변경할 수 없습니다. 출력은 미확정 초안이고 적용은 사람의 별도 현재 조건 검사입니다. | FR-09·10·23, NFR-08, AC-08·17·18·19입니다. |
| 현재 인계 | 고정 인계 내용을 정확한 승인 refs와 함께 보존합니다. 생성·현재용 내보내기 확정 시 현재 조건을 검사합니다. | FR-20, NFR-03, AC-11·13입니다. |
| 외부 사실 | 인계별 시작·완료와 현재 SR 단계·검토 유효성을 분리합니다. 과거 사실 기록은 최신 구현의 성공 기록이 아닙니다. | FR-21·22, AC-12입니다. |
| 조회 일관성 | 같은 확정 기준에서 차단 사유·담당자·대상·다음 행동을 계산하며 조회가 업무 상태를 저장하지 않습니다. | FR-17·18, NFR-06, AC-14입니다. |

이 파일은 실행 코드나 물리 저장 스키마를 만들지 않습니다. 구체적 명령의 조건과 실패 처리, UI의 입력·표시는 나머지 Functional Design 문서에서 연결합니다. Security Baseline·Resiliency Baseline·PBT는 비활성 상태로 개별 규칙 N/A입니다. 기본 제품 NFR과 후속 구현의 TDD는 유지합니다.
