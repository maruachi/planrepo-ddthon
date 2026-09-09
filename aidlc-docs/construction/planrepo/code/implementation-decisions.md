# PlanRepo 구현 시 확정한 계약

승인 제품 규칙은 `aidlc-docs/inception/application-design/component-methods.md`, `aidlc-docs/construction/planrepo/functional-design/domain-entities.md`, `aidlc-docs/construction/planrepo/nfr-design/nfr-design-patterns.md`입니다. 이 문서는 HTTP와 TypeScript로 옮길 때의 세부 해석을 기록하며 업무 권한·필수 게이트를 바꾸지 않습니다.

## HTTP와 타입 경계

1. M-032의 입력 지문은 wire에서 meta.guard.expectedInputFingerprint 한 곳에 둡니다. 서비스 조립부가 승인된 논리 GenerationInput의 기대 지문으로 전달합니다. 서로 다른 두 값이나 input의 중복 필드는 거절합니다. M-018·M-019·M-035도 해당 현재 입력 검사 책임을 유지합니다.
2. GuardFor<M>와 JSON schema는 변경 대상에 필요한 조건을 구분합니다. M-021은 BundleRef·reviewEpoch이며 전체 SR revision을 사용하지 않습니다. 신규 SR·Mock 가져오기의 중복 키는 서버의 원자적 고유성 검사로 판정합니다. 클라이언트가 신규 ID나 가짜 expectedRevision을 발급하지 않습니다. M-034는 승인 계획 예시처럼 runId·현재 pending/running CAS·receipt로 취소하고, 인수로 revision이 바뀌었다는 이유만으로 취소를 막는 새 필수 guard를 추가하지 않습니다.
3. M-002는 승인 signature처럼 DemoActorId 선택값을 서버가 고정 목록과 현재 ProjectScope로 검증합니다. 선택 전 X-PlanRepo-Actor를 선행 조건으로 요구하지 않습니다. 선택 결과는 그 브라우저에만 저장하며 서버 전역 선택값을 바꾸지 않습니다. 다른 업무 요청의 현재 actor·scope 검사는 유지합니다.
4. M-038의 내부 ProviderFailure는 ClaimRef를 필수로 포함합니다. provider 자체의 실패는 token 없는 ProviderFailureCore이며 C-05가 소유 ClaimRef를 붙여 S-07에 전달합니다. provider는 DB·RuntimeContext·업무 command를 받지 않습니다.
5. M-042의 성공 응답 본문은 고정된 Markdown UTF-8 bytes입니다. HTTP 변환은 Content-Type·안전한 Content-Disposition과 X-PlanRepo-Command 메타데이터를 붙입니다. 메타데이터는 {kind,receipt,current?} JSON의 UTF-8 base64url이며 서비스의 Committed/Replayed와 현재 조건을 보존합니다. 거절 응답은 다른 명령과 같은 JSON DomainError입니다. 일반 성공 JSON을 Markdown 본문으로 덧붙이지 않습니다. HTTP 과제에서 헤더 길이·직렬화와 사용자 입력의 제어 문자 거절을 검증합니다.
6. 타입별 결과 view를 정의하고 unknown은 실제 외부 입력 파싱 경계에서만 좁힙니다. JSON schema의 maxLength를 UTF-8 byte 상한으로 오인하지 않습니다. byte 상한은 TextEncoder 또는 Buffer.byteLength의 실제 수신·본문·출력 검사와 연결합니다. 테스트용 잘못된 JSON은 raw HTTP 경계로 보내고 정상 invoke는 Methods map 타입을 따릅니다.

## 저장 결과 참조

7. CG-03에서 확인한 CommandReceipt.resultRefs의 EntityRef 전용 타입은 고정 버전·묶음 참조를 표현하지 못합니다. ReceiptResultRef를 EntityRef | VersionRef | BundleRef로 명시합니다. 저장층은 전달된 불변 결과를 그대로 보존하며 재개방·현재 포인터 변경 뒤에도 원래 committedRevision과 resultRefs를 반환합니다. 현재 조회 결과는 과거 명령의 고정 결과와 분리합니다. CG-03에 최소 계약 수정과 정상 타입 RED/GREEN을 포함합니다.

## 데모 상태 분리

8. CAT-093의 ‘구현 중·재검토 필요’는 현재 제품 단계와 외부 사실을 나눠 표현합니다. G1 기준 변경 뒤 progressStage=requirements이고 G1·종속 G2는 invalid·새 reviewEpoch·needsNewBundle입니다. 과거 유효했던 H1의 ImplementationRecord.status=started와 승인·통과 이력은 보존합니다. BR-21의 가장 앞선 검토 단계 복귀와 ENT-33의 인계별 외부 사실을 함께 만족시킵니다. 변경 뒤에도 progressStage=implementing을 유지하는 해석은 사용하지 않습니다.


## HTTP 구성의 선행 의존

9. CG-05에 workspace-repository.ts의 typed 프로젝트·현재 멤버십 조회를 추가합니다. empty TestApp은 manifest에서 프로젝트·5사용자만 준비하는 test-only fixture이며 product seed의 별도 변형을 추가하지 않습니다. seedDemo(db)의 기존 계약을 유지합니다. 새 테스트의 testRunId는 randomUUID입니다.
10. CG-14의 macos-observation.ts 중 고정 sysctl/ioreg host/boot 관찰을 CG-05로 앞당깁니다. 고정 인수·shell=false·timeout·출력 상한·UUID 형식을 검사하고 raw UUID/명령 출력은 HTTP·로그에 내보내지 않습니다. 강한 프로세스 시작 identity는 여전히 미지원입니다. parentStartedAt은 unavailable을 명시하며 임의 시각을 실제 kernel start로 쓰지 않습니다. host/boot 관찰 실패는 서로 다른 runtime을 같은 host로 인정하지 않는 고유한 unknown 표시와 별도 unavailable 상태로 보존합니다. 비AI 앱은 계속 사용할 수 있고 복구 근거로 채택하지 않습니다. CG-14에서 실제 복구·종료 관찰을 확장합니다.


## SR 기본 경로의 선행 의존

11. CG-06에서 M-005 설명 개정의 ReviewImpact를 실제로 적용하므로 CG-07의 순수 review-impact.ts를 CG-06으로 앞당깁니다. 같은 트랜잭션의 게이트·epoch·현재 인계·단계 복귀·기존 검토 요청 대체 저장은 review-impact-repository.ts로 공유합니다. CG-07은 이 경계를 근거 자료 변경으로 확장합니다. 이미 승인된 NOTI와 재검토 중인 CAT 시드에서 설명 변경을 검사하며 원 설명·과거 승인·외부 구현 이력을 보존합니다. 이를 뒤로 미루면 M-005가 승인 기준을 바꾸고도 유효한 게이트를 남기므로 작업 순서를 보완합니다. 공유 API를 조정하면 후속 과제 호출부도 함께 검증해야 합니다.
12. SR 등록과 Mock 가져오기는 현재 프로젝트 멤버십을 검사하고 지정한 ownerId도 같은 프로젝트의 현재 멤버인지 확인합니다. BR-02에 특정 전역 역할만 등록할 수 있다는 별도 제한은 없습니다. 생성 후 M-005와 접수 단계 M-028은 현재 SR의 실제 담당자만 허용합니다. 고정 persona ID나 team_admin 이름으로 담당자 검사를 우회하지 않습니다. 등록 자체에도 역할 제한을 의도한 것으로 확인되면 이 선택은 등록 권한과 해당 테스트를 조정해야 합니다.


## 조회 기준과 대체 요청

13. BoardView.revision과 프로젝트 범위 조회의 revision은 읽은 Project.revision이며 프로젝트 설정의 충돌 기준입니다. 전체 보드 쓰기의 전역 순번으로 사용하지 않습니다. ND-03에 따라 카드마다 실제 SR revision과 기준 refs를 같은 readConsistent snapshot에서 반환합니다. 서로 다른 응답이 같은 시점이라는 주장은 하지 않습니다. UI의 오래된 응답 배제는 조회 키와 발행 순번으로 처리합니다. SR revision의 최댓값이나 별도 암묵적인 전역 counter를 만들지 않습니다.
14. M-005처럼 아직 새 공식 묶음/요청을 만들지 않는 기준 변경에서는 gate epoch·needsNewBundle·무효화 이력을 같은 트랜잭션에서 기록하고 이전 요청을 보존합니다. ENT-19에 따라 현재 epoch와 묶음에 해당하지 않는 과거 pending 요청은 현재 공식 검토함에서 제외합니다. 실제 새 request/bundle을 만드는 단계에서 정확한 supersededByRequestId 또는 supersededByBundleRef와 supersededAt을 기록하고 superseded로 전환합니다. 대체 대상이 없는 상태에서 가짜 ref나 ref 없는 superseded 행을 만들지 않습니다. 이후 검토함과 요청 생성이 이 조건을 함께 사용하지 않으면 오래된 할 일이 다시 노출될 수 있으므로 CG-18/20/23에서 검증합니다.


## 편집과 초안 적용의 선행 계약

15. question-decision-repository.ts의 최초 생성을 CG-16에서 CG-09로 앞당깁니다. 첫 답변·후속 질문·결정 확정과 적용 저장부터 저장 계층을 사용해야 하며 service에 SQL을 섞지 않습니다. CG-16은 해결 확인·전환·분류를 기존 repository에 추가합니다.
16. CG-09에서 AppliedDraftView와 DraftApplicationStatus의 적용 결과를 ENT-31에 맞게 구체화합니다. 문서 적용은 정확한 ArtifactVersionRef를 보존합니다. 질문·결정 적용은 선택한 temporaryId와 서버가 만든 해당 종류의 EntityRef를 명시적으로 매핑합니다. 결과 종류와 맞지 않는 참조·중복/누락 매핑을 허용하지 않는 판별 타입과 저장 codec을 함께 검증합니다. EntityRef 전용 outputRefs를 타입 단언으로 우회하지 않습니다. 같은 적용의 재생에서도 고정된 버전·ID 매핑을 그대로 반환합니다.


## 공통 서비스 조립

17. CG-06에서 C-09의 application-composition.ts가 공개 메서드 adapter와 업무 서비스를 한곳에서 조립합니다. main과 TestApp은 기존의 DB/fixture·lifecycle·listen 순서를 유지하고 같은 factory의 handlers를 사용합니다. 현재 실제로 필요한 Persistence와 Mock 조회 포트만 입력받습니다. 향후 실행 포트는 첫 소비 과제에서 추가합니다. C-02가 C-05/C-06 dispatcher/provider를 직접 호출하지 않습니다. 업무 거절은 공통 DomainError 경계로 전달하며 generic 500으로 바뀌지 않도록 검증합니다. 조립 경로가 다시 나뉘면 테스트와 실제 서버의 동작이 달라질 수 있으므로 두 시작 경로의 실제 업무 호출을 확인합니다.


## 생성 입력 준비 조회

18. CG-09에서 M-047의 선택적 preparation 입력과 SRDetailView.preparation 결과를 추가합니다. 기존 빈 상세 입력은 유지합니다. new_generation의 GenerationInput, retry의 runId, draft의 draftId를 판별 union으로 구분합니다. 결과는 같은 종류·대상과 실제 계산한 입력, expectedInputFingerprint, basisRefs, projectRuleVersions를 묶습니다. 초안은 불변 draftBasisFingerprint와 currentInputFingerprint/freshness를 분리하며 문서 종류만 draftTargetBasis와 currentTargetBasis를 가집니다. 서버는 같은 scope·현재 권한을 검사하고 조회 중 snapshot/run/receipt/활동을 쓰지 않습니다. generation-snapshot.ts와 generation-input-repository.ts를 첫 소비인 CG-09에서 만들고 M-018/M-019, 이후 M-032/M-035와 같은 calculator를 재사용합니다. 변경 명령은 트랜잭션 안에서 다시 계산합니다. M-035는 failed/cancelled의 작업 의도를 유지하며 현재 정확한 문서 버전으로 계산합니다. 원 absent 대상에 문서가 생겨 taskKind 변경이 필요하면 자동 변환하지 않고 명시적인 새 M-032를 요구합니다. 원 초안의 targetBasis는 바꾸지 않습니다. 다른 현재 기준의 직접 적용을 거절하고 사람이 현재 기준을 확인한 M-019 또는 새 생성을 사용합니다. 세부 DTO·공개 schema·실제 첫 준비 조회/변경 이후 거절 테스트를 같이 구현합니다. 독립 읽기 검토에서 최초 생성의 공개 fingerprint 조회 공백을 확인해 이 연결을 선택했습니다. 잘못되면 조회와 소비 DTO를 함께 고쳐야 합니다.

19. CG-10에서 승인된 대기열 포화 오류 QUEUE_FULL을 DomainErrorCode·HTTP 409·화면의 재시도 설명에 추가합니다. 기존 최소 오류 코드 목록에 없다는 이유로 권한이나 provider 오류로 바꾸지 않습니다. 같은 receipt의 재생은 포화 검사보다 먼저 처리합니다.


## 고정 로컬 규칙과 snapshot 저장

20. CG-09에서 config/generation/project-rules.json에 승인된 제품 규칙의 자체 완결 요약과 logical ID를 둡니다. 생성 업무에 필요한 명시 규칙만 포함하며 AI-DLC 실행 지시·audit·개인 설정을 모델 문맥으로 자동 수집하지 않습니다. ProjectRuleSource는 검증한 프로젝트 루트에서 자산을 읽고 logical ID와 정확한 content의 SHA-256으로 안정 version을 만듭니다. mtime이나 config schemaVersion을 규칙 version으로 사용하지 않습니다. 실제 규칙 content/version은 InputSnapshot과 canonical envelope에 고정합니다. filesystem 읽기는 C-09 bootstrap에서 끝내고 선택한 규칙 snapshot을 runtime 동안 불변으로 유지합니다. 파일 변경 반영은 새 bootstrap이나 명시적으로 교체한 rule source를 통해 이뤄집니다. 자동 reload를 새 기능으로 추가하지 않습니다. 변경 명령은 transaction 안에서 현재 선택한 규칙 snapshot과 같은 calculator를 사용합니다. 새로 선택한 규칙이 달라지면 이전 지문을 현재 입력으로 재사용하지 않습니다.
21. 현재 input_snapshots에는 선택 supplement 열이 없습니다. CG-09의 첫 snapshot 저장 전에 append migration 0002로 nullable supplement TEXT를 추가합니다. 기존 0001 SQL과 checksum, 과거 snapshot·run·draft·receipt는 보존합니다. 별도 registry에 순서대로 등록하고 migration은 기존 offline maintenance 경계에서 실행합니다. 기존 행의 null은 보완 입력 부재이며 빈 문자열과 구분합니다. retry의 원 task/document/supplement/targetBasis는 불변 InputSnapshot에서 복원하고 변경 가능한 run payload에 원 입력의 유일한 원본을 두지 않습니다. 실제 version 1 DB의 upgrade와 기존 이력/불변 trigger 보존을 회귀 테스트로 확인합니다. 새 서버가 옛 schema를 준비 완료로 표시하지 않는 기존 규칙도 유지합니다.


## 생성 작업 조회의 판정 불가 상태

22. CG-06의 M-047도 실제 generation_runs·draft·application·termination 행을 읽습니다. DB-only 조회에서 현재 로컬 규칙을 포함한 입력 지문을 계산할 수 없으면 입력 최신성을 current나 stale로 단정하지 않습니다. GenerationRunView와 필요한 DraftView는 별도 InputFreshness의 unknown과 필수 사유를 표현합니다. 이는 Run의 pending/running/succeeded/failed/cancelled 상태와 다릅니다. typed CurrentInputFingerprintPort가 있으면 실제 현재 지문과 불변 snapshot 지문을 비교합니다. 포트가 없거나 판정 근거가 부족할 때만 unknown을 사용하며 저장소 손상·잘못된 JSON을 가리지 않습니다. CG-09에서 실제 calculator와 현재 rule source를 C-09에 연결하고 CG-10부터 실제 생성 경로의 current/stale를 검증합니다. 종료 여부는 observation, 적용 여부는 application 행에서만 복원합니다. 조회 fixture에 주입한 지문 테스트를 제품 calculator 통합 증거로 세지 않습니다.

## Provider 결과 표현의 정합성

23. CG-13의 예시 판별 이름 Draft/Failure를 이미 CG-02에서 구현한 completed/failed와 일치시킵니다. 완료는 GenerationResult와 ExecutionReport, 실패는 token 없는 ProviderFailureCore와 ExecutionReport를 반환합니다. C-05가 claim을 결합하는 경계는 유지합니다. CLI가 exit 0이어도 is_error=true이면 명시 provider 실패이므로 CG-13에서 PROVIDER_ERROR 코드를 추가합니다. 잘못된 JSON이나 허용 참조 위반의 INVALID_OUTPUT과 구분합니다. 이 수정은 예시와 구현 계약을 맞추며 provider 출력에 DB·runtime capability를 넣지 않습니다. ProcessResult의 Completed/Failure는 낮은 실행 계층의 별도 판별 타입입니다.

## 문서의 논리 대상과 설계 단계

24. 새 문서의 논리 key를 requirements, workflow_plan, implementation_plan 또는 design:<stage>로 통일합니다. stage는 기존 ArtifactEdit의 application, functional, nfr, infrastructure입니다. 설계 문서는 종류만 같아도 단계가 다르면 별개 대상입니다. ARTIFACT_DRAFT는 선택한 정확한 key의 부재를 검사하고 ARTIFACT_REVISION은 정확한 현재 ArtifactVersionRef에서 종류와 설계 단계를 읽습니다. bare design은 단계가 모호해 거절합니다. 같은 해석을 M-015/M-017의 targetBasis·guard, M-047 준비 조회, 생성 snapshot과 사람 적용에 사용합니다. 별도 AI 실행 인자를 추가하지 않으며 absent targetBasis의 key가 고정 작업 의도를 보존합니다. CG-09에서 공통 key helper와 typed basis를 구현하고 공개 예시의 workflow/requirements 불일치도 바로잡습니다. 기존 seed가 functional_design을 design_stage에 넣은 것은 계약의 functional과 다른 값이므로 새 seed를 수정하고 append migration 0002에서 이 알려진 이전 표기를 functional로 정규화합니다. 0001 SQL/checksum과 ArtifactVersion 원문·refs·이력은 바꾸지 않습니다. 현재 실제 사용자 DB를 수정하지 않으며 격리 version 1 upgrade 테스트로 검증합니다.

## 생성 제안의 담당자 후보

25. 질문 제안의 필수 suggestedAssigneeId를 모델이 명시 입력에서 선택할 수 있도록 GenerationBasis와 InputSnapshot에 participants를 고정합니다. participants는 현재 SR ownerId와 같은 프로젝트의 현재 멤버 userId·displayName 목록입니다. 역할·권한·ActorContext·인증·다른 프로젝트의 사용자는 포함하지 않습니다. 멤버 목록은 userId 기준으로 안정 정렬하며 정확한 값은 canonical 지문에 포함합니다. InputSnapshot 저장에는 기존 contents 배열의 같은 SR EntityRef 항목 content JSON에 participants를 담습니다. 새 DB 열이나 중복 DTO 필드를 추가하지 않습니다. 이전 snapshot에 이 항목이 없으면 현재 멤버로 과거 입력을 복원하지 않습니다. 이는 업무 후보 정보이며 권한 증명이 아닙니다. 출력의 담당자는 고정 후보 목록에서만 제안하고 사람 적용 시 실제 현재 멤버십을 다시 검사합니다. 후보의 ID를 VersionRef나 sourceRef로 변환하지 않습니다. 새 SR의 QUESTION_PROPOSALS snapshot에 유효한 사용자 ID가 하나도 없는 실제 격리 DB 재현으로 이 연결을 보완했습니다. 현재 owner가 프로젝트 멤버가 아니면 다른 후보와 별개로 그 부적합 상태를 숨기지 않으며 적용 권한은 서버가 판정합니다.

## 초안 적용의 명시적인 사람 입력

26. M-018의 결정 적용은 selectedContent.kind=decisions와 selections 목록을 받습니다. 각 항목은 temporaryId, decisionMakerId와 QuestionClassificationInput 형식의 classification을 요구합니다. 사람이 결정권자와 필요한 게이트 또는 후속 범위를 명시하며 모델 추천이나 고정 persona로 담당자를 추정하지 않습니다. 선택 ID의 중복·누락·다른 초안 ID를 거절하고 현재 프로젝트 멤버십과 분류 조건을 적용 트랜잭션에서 검사합니다. 문서 적용은 selectedContent.kind=artifact와 edit를 받습니다. edit는 검증된 ArtifactEdit 또는 WorkflowPlanEdit이며 본문·색인·요구사항 연결·근거·변경 이유와 해당 workflow 구조를 포함합니다. 대상 기준은 edit.targetBasis 한 곳에 두고 바깥 targetBasis는 제거합니다. 서버는 문서 종류·설계 단계·현재 지문·원 초안의 대상·guard를 대조합니다. WorkflowPlan 구조가 없는 일반 문서 분기로 검증을 우회하지 않습니다. M-018의 artifact/questions/decisions 입력과 guard의 판별 상관관계, 결정 16의 고정 적용 결과·temporaryId 매핑을 유지합니다. 이는 기존의 Markdown만 있는 적용 입력과 담당자 없는 결정 적용으로 ENT-09/13을 만들 수 없었던 공백을 구체화합니다.

## 문서 저장과 변경 영향의 선행 연결

27. CG-09의 문서·초안 첫 소비에서 M-017의 ArtifactVersion과 WorkflowPlanVersion 1:1 저장을 함께 연결합니다. CG-20은 이 저장 경계를 재사용하고 필수 단계·문서 정책 및 G2와 정확한 현재 G1의 전체 검증을 완성합니다. 공통 버전 ReviewImpact 저장 API는 실제 변경 refs와 영향 게이트를 받아 같은 트랜잭션에서 적용합니다. G1 변경에는 종속 G2가 항상 포함됩니다. G2 전용 변경은 G1의 유효성·epoch·묶음을 보존하고 앞선 접수·요구사항 단계를 planning으로 밀어내지 않습니다. followup/None은 게이트를 무효화하지 않습니다. 기존 설명·SOURCE wrapper는 이 확장에서도 동작과 불변 이력을 유지합니다.

## 실행 adapter의 관측과 제어 경계

28. CG13의 첫 실제 Claude adapter 연결을 위해 ExecutionControl에 런타임이 만든 execution={launchRef,cwd}를 추가합니다. 이는 업무 ProviderRequest나 모델 입력이 아닌 실행별 최소 capability입니다. ClaimRef·DB·RuntimeContext를 넘기지 않습니다. 기존 ProcessResult의 Completed/Failure 판별은 유지하며 runner가 최초 결과 확정 시점의 실제 bytes·pipe close 관측·시작 시도와 결과 확정 시각·관측한 exit/signal을 정제 metrics로 제공합니다. 실패 결과에 0이나 close 상태를 추정해 넣지 않습니다. 취소·timeout 뒤 늦은 close는 불변 결과를 바꾸지 않고 별도 observation으로 전달합니다. finishedAt은 결과 확정 시각이며 전체 OS 범위 종료를 증명하지 않습니다. 제한 시간은 monotonic clock으로 계속 판정합니다. C05가 필요한 관찰은 adapter 생성자에 주입한 좁은 ProcessObserver sink로 연결하고 launchRef를 런타임 내부 claim에 대응시킵니다. provider는 저장·권한을 알지 않습니다. 이 구체화는 실제 runner와 adapter fixture의 계약이 달라지는 것을 막습니다.

## 사람 검토 초안과 재시도의 현재 대상

29. M019는 사람이 본 원 초안 preparation의 currentInputFingerprint를 트랜잭션 안에서 검증합니다. 새 human_review 초안에는 현재 입력 자료·규칙·정확한 문서 대상을 새 InputSnapshot으로 고정합니다. 원 초안과 실행의 snapshot·taskKind·target은 보존합니다. 원 absent 대상에 이미 문서가 생겼다면 명시적인 비교 검토로 만든 새 초안만 ARTIFACT_REVISION/current version으로 기록합니다. 같은 문서의 이전 revision도 현재 version으로 정규화합니다. 새 snapshot fingerprint는 이 정규화된 입력에서 계산하므로 원 초안 preparation의 검사용 지문과 다를 수 있습니다. 사람 검토 없이 최신 지문만 넣은 M018 직접 적용은 거절합니다. M035 retry는 별도 규칙입니다. failed/cancelled의 원 ARTIFACT_REVISION은 현재 exact version으로 준비하지만 원 ARTIFACT_DRAFT absent 대상이 없어졌으면 자동 task 변경 없이 새 M032를 요구합니다. 결정18의 원본 보존과 BR25·FR10의 현재 초안 반영을 함께 충족하는 구체화입니다.

## 저장 초안의 재조회와 고정 입력 비교

30. CG09의 UI-20 연결에서 새 human_review 초안을 페이지 재개방 뒤에도 선택할 수 있도록 SRDetailView에 작은 generationDrafts 목록을 추가합니다. 목록은 draftId·taskKind·provenance·basisInputSnapshotRef·basisFingerprint·freshness·application을 제공하고 큰 body와 InputSnapshot 본문은 중복하지 않습니다. 기존 M047의 kind=draft 준비 요청에는 선택한 DraftView와 그 불변 InputSnapshot을 같은 일관된 읽기에서 반환합니다. 현재 자료는 같은 SRDetailView의 현재 문서·질문·결정·SOURCE 및 preparation의 현재 basisRefs/projectRuleVersions와 비교합니다. 새 endpoint나 조회 중 저장을 추가하지 않습니다. 원 provider run의 결과와 human_review 결과는 서로 다른 ID와 provenance를 유지합니다. 큰 현재 입력의 최신성 판정 불가는 기존 결정22를 따르되 저장 초안 열람을 막지 않도록 필요한 현재 비교 상태를 명시합니다. 이는 새 검토 초안이 M019 응답에만 있어 새로고침 뒤 찾을 수 없던 첫 화면 소비의 공백을 채웁니다. 잘못되면 목록·선택 조회 DTO와 소비 화면을 함께 고쳐야 합니다.


## 필수 항목의 후속 범위 전환 근거

31. CG16의 M014에서 current 필수 질문·결정을 followup으로 줄일 때 ENT-15와 BR-07의 확정된 범위 축소 decision version 및 개정 requirements artifact version을 보존합니다. 누락된 wire 표현을 채우기 위해 ScopeClassification followup에도 optional basisRefs를 추가합니다. 서비스는 기존 current에서 전환할 때 이 근거를 필수로 검증하고 같은 SR의 실제 version·확정 상태·문서 종류를 확인합니다. 이미 followup인 항목의 담당자·재검토 조건 갱신에는 새 범위 축소 근거를 강제하지 않습니다. 새 권한을 만들지 않고 승인된 업무 제약을 구현합니다.

## 질문·결정 후속 내용의 첫 소비

32. CG16에서 M009의 해결 근거·반영 문서 또는 문서 변경 불필요 이유, M011의 원 질문 고정 결과·전환 결정 연결, M013의 재결정 변경 근거를 typed 생성 basis와 InputSnapshot에 명시적으로 포함합니다. revision만 바꾸고 실제 의미 있는 내용을 모델 입력에서 누락하지 않습니다. canonical 순서·기존 원문·명시 ref 검증과 2 MiB 경계는 유지합니다. ScopeView와 M047의 현재 질문·결정 조회에는 검증한 현재 분류의 이유·담당자·재검토 조건·basisRefs를 구체 타입으로 반환해 첫 ScopeClassificationForm이 저장 내용을 읽고 비교할 수 있게 합니다. 과거 분류 전체를 중복 복제하거나 브라우저에서 기본값으로 추측하지 않습니다. 필요한 shared 선언과 실제 조회·snapshot 검증을 CG16의 범위에 포함합니다.

## 정책 명시 적용의 복수 게이트 경계

33. M031의 PolicyApplication은 G1과 G2를 함께 선택할 수 있지만 기존 단일 RevisionGuard와 단일 ReviewBundleView로는 두 게이트의 현재 기준과 결과를 표현할 수 없습니다. CG17의 첫 구현에서 resources 목록을 가진 PolicyApplicationGuard로 구체화합니다. 선택한 각 gate의 review_gate_state 기대 revision을 정확히 한 번 받아 같은 트랜잭션 안에서 모두 검사합니다. 중복·누락·다른 SR·선택 밖 target은 거절합니다. 결과는 PolicyApplicationResult에 gate별 BundleAvailable 또는 NeedsInputs와 전체 ReviewImpact를 보존합니다. receipt 재생은 원 확정 결과를 유지하고 최신 기준은 M047로 다시 읽습니다. 직접 선택한 정책 참조만 변경하되 G1 기준 변경의 종속 G2 무효화는 함께 처리합니다. 두 게이트를 선택하면 G1의 새 기준을 먼저 반영하고 G2의 현재 유효 G1 조건을 다시 평가하므로 과거 G1/G2 pass를 복원하지 않습니다. 이는 기존 다중 선택 의도와 원자적 현재성 제약을 함께 구현하는 계약 보완이며 권한이나 필수 검토 조건을 완화하지 않습니다.

## 생성 실행 보고서의 저장과 공개 조회

34. CG10의 M033/M047 조회와 CG11의 내부 terminal 저장은 generation_runs.payload_json.execution에 기존 ExecutionReport의 정제된 형식을 공유합니다. 실행 보고서가 없는 기존 또는 pending Run은 실제 모델·CLI 버전을 추측하지 않습니다. 보고서가 있으면 검증한 optional actualModelId와 cliVersion만 공개 GenerationRunView에 명시적으로 투영합니다. 요청 model choice를 actualModelId로 복사하지 않습니다. runtime은 최초 terminal의 실제 보고서를 저장하고 늦은 결과가 이를 덮지 않게 합니다. 보고서의 raw 출력·환경·인증·소유권 capability는 허용하지 않습니다. CG10은 명시 fixture로 조회 계약을 검증하며 실제 Claude 검증과 구분합니다. CG11은 같은 저장 표현을 실제 내부 완료·실패 경로에서 사용합니다.

## 진행과 검증

각 해석은 후속 실제 테스트로 검증합니다. 권한·현재성·도메인 제약을 바꾸는 것으로 확인되면 기존 스펙을 우선해 수정하고 근거를 남깁니다.
