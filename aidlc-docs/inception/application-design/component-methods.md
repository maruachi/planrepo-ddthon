# 컴포넌트 메서드와 계약

상태: 설계 산출물 Q1 A 승인 완료. 아래 시그니처는 언어 독립 의사 표기이며 실제 코드/API 스키마가 아니다.

근거: [컴포넌트](components.md), [요구사항](../requirements/requirements.md).

## 공통 타입과 계약

`List<T>`는 목록, `Optional<T>`는 값이 없을 수 있음을 뜻한다. `Result<T>`는 성공 값 또는 오류 종류·설명을 반환하는 계약이다. ID의 실제 자료형, 필수 필드 전체, enum 값, HTTP 상태 코드는 Functional Design 및 구현 계약에서 확정한다.

| 타입 | 고수준 내용 |
|---|---|
| SRId, DocumentId, RunId, QuestionSetId, ReviewId, StageRef | 각각의 저장 객체 또는 SR 내 계획 단계 식별자 |
| VersionRef | srId, documentId, versionId; 서로 같은 소속인지 확인하는 대상 참조 |
| ActorContext | user 역할(작성자/리뷰어 시연) 또는 AI/시스템 출처. 인증된 사용자 신원은 아님 |
| SRDraft / SR / SRSummary / SRDetail | 생성 입력 / 저장 SR / 보드 카드 정보 / 연결 문서·진행·리뷰를 포함한 상세 조회 값 |
| DocumentView / VersionSummary / HistoryEvent / DiffView | 선택 본문 / 버전 식별·출처 / 사건 및 대상·내용 / 비교한 두 버전 식별과 차이 |
| WorkflowState / WorkflowView | 저장된 단계·회차·입력/승인 상황 / UI 진행 표시와 가능한 행동 |
| PlanningAction / ActionEvaluation | 진행 의도 / 허용 여부·이유·실행할 계획 작업 또는 구현 대기 전환 판단 |
| QuestionSet / AnswerSubmission / DecisionInput | 실행/단계별 질문 / 질문 ID와 응답 / 대상 버전·단계와 결정 종류·내용 |
| RunView | SR와 실행 ID, 실행 상태, 생성 결과 참조 또는 실패 설명. 실행 성공과 단계 완료를 구분 |
| ContextSnapshot | SR 입력·첨부·선택된 문서 버전·응답·결정·리뷰 대상·stage·규칙 및 계획 전용 실행 범위 |
| RunnerOutcome | 정상 결과(문서 목록, 질문 목록, 다음 행동 제안) 또는 실행/결과 수집 실패. 정상 결과가 곧 승인·단계 완료는 아님 |
| GeneratedArtifact / DocumentChanges | 문서 식별·제목·본문 등 정규화된 결과 / 저장할 새 버전·최신 포인터·AI 생성 사건의 변경 묶음 |
| ReviewDraft / ReviewResultInput / ReviewView | 대상 VersionRef와 요청 / 검토 내용·결과 / 원래 대상과 현재 버전의 관계를 포함한 조회 값 |
| ReadQuery / ReadResult / ChangeSet / CommitReceipt | 타입이 구분된 조회 / 결과 / 관련 레코드와 참조 검증을 포함한 일관된 변경 단위 / 저장된 객체 식별자 |
| RuleBundle / RunSpecification / ExecutionScope | stage별 적용 규칙 / 허용된 계획 실행 요청 / 작업 공간·수집 대상·기능 제한의 실행 계약 |
| ViewModel / LocalQuery / LocalCommand / LocalResponse | 화면 표시 값 / 서비스 조회 / 명시적 사용자 행동 / 성공·검증·실패 응답 |

문자열·본문 등을 뜻하는 Text, Markdown과 Boolean도 의사 타입이다. `ChangeSet`은 임의의 SQL이나 클라이언트가 보내는 저장 명령이 아니라 서버 내부의 도메인 변경 값이다. UI는 이를 직접 제출하지 않는다.

## 제공 메서드

| 컴포넌트 | 시그니처 | 입력·출력 및 목적 |
|---|---|---|
| C01 WorkspaceUI | render(view: ViewModel) → UI | 보드·상세·문서·이력·리뷰·진행 표시 |
| C01 WorkspaceUI | submit(command: LocalCommand) → Result<LocalResponse> | 사용자 입력을 C02에 전달하고 결과·오류 표시 |
| C01 WorkspaceUI | selectRole(role: ActorContext) → UI | 작성자/리뷰어 시연 역할 전환 |
| C02 LocalAppBoundary | query(request: LocalQuery) → Result<LocalResponse> | 대상 서비스의 조회 계약으로 전달 |
| C02 LocalAppBoundary | command(request: LocalCommand, actor: ActorContext) → Result<LocalResponse> | 생성·편집·진행·결정·리뷰·완료 명령을 명시적 서비스 메서드에 연결 |
| C03 SRService | create(input: SRDraft, actor: ActorContext) → Result<SR> | 필수 입력과 선택 첨부를 정규화하고 SR 및 생성 사건 저장 |
| C03 SRService | listBoard() → Result<List<SRSummary>> | 저장된 단계·회차·실행·리뷰 요약을 고정 열에 배치할 값 반환 |
| C03 SRService | getDetail(srId: SRId) → Result<SRDetail> | SR 입력과 문서·진행·리뷰 연결 정보 조회 |
| C03 SRService | markImplemented(srId: SRId, actor: ActorContext) → Result<SR> | 구현 대기 SR의 수동 완료 선언 및 사건 기록 |
| C04 DocumentService | listDocuments(srId: SRId) → Result<List<DocumentView>> | SR 소속 문서와 최신 참조 조회 |
| C04 DocumentService | readVersion(target: VersionRef) → Result<DocumentView> | 정확한 대상 버전의 본문 조회 |
| C04 DocumentService | listVersions(srId: SRId, documentId: DocumentId) → Result<List<VersionSummary>> | 문서별 저장 버전 목록 |
| C04 DocumentService | listHistory(srId: SRId, documentId: Optional<DocumentId>) → Result<List<HistoryEvent>> | SR 전체 또는 문서 관련 AI·사람 사건 조회 |
| C04 DocumentService | edit(target: VersionRef, body: Markdown, actor: ActorContext) → Result<DocumentView> | 편집 출발 버전을 참조하여 새 본문 버전과 사건 저장 |
| C04 DocumentService | compare(left: VersionRef, right: VersionRef) → Result<DiffView> | 같은 문서의 선택한 두 버전을 읽고 변경점 반환; 저장 없음 |
| C04 DocumentService | restore(source: VersionRef, actor: ActorContext) → Result<DocumentView> | 과거 본문으로 새 버전 생성, 복원 출처와 사건 저장 |
| C04 DocumentService | prepareGenerated(srId: SRId, runId: RunId, artifacts: List<GeneratedArtifact>) → Result<DocumentChanges> | AI 문서 결과의 소속·형식을 확인하고 저장할 변경 묶음 준비; 이 메서드 자체는 저장하지 않음 |
| C05 PlanningService | getWorkflow(srId: SRId) → Result<WorkflowView> | 저장 진행과 질문·결정·가능한 행동 조회 |
| C05 PlanningService | advance(srId: SRId, action: PlanningAction, actor: ActorContext) → Result<RunView> | 정책 확인, 실행 기록 생성, 비동기 계획 작업 시작 후 실행 조회용 ID 반환 |
| C05 PlanningService | getRun(srId: SRId, runId: RunId) → Result<RunView> | 진행 중·정상 결과·실패 표시를 위한 저장 상태 조회 |
| C05 PlanningService | answer(srId: SRId, questionSetId: QuestionSetId, input: AnswerSubmission, actor: ActorContext) → Result<WorkflowView> | 질문 소속 확인 후 응답과 사건 기록; 다음 실행 문맥에 포함 |
| C05 PlanningService | decide(srId: SRId, input: DecisionInput, actor: ActorContext) → Result<WorkflowView> | 문서/단계 대상 승인·수정 요청과 사건 기록; 본문 변경 불필요 |
| C05 PlanningService | completePlanning(srId: SRId, actor: ActorContext) → Result<WorkflowView> | 정책이 계획 종료를 허용하면 구현 대기로 전환하고 진행 사건 저장 |
| C05 PlanningService | finishRun(srId: SRId, runId: RunId, outcome: RunnerOutcome) → Result<RunView> | 내부 전용. 결과 검증 후 문서·질문·실행·사건을 함께 저장하거나 실패 기록 |
| C06 ReviewService | request(srId: SRId, input: ReviewDraft, actor: ActorContext) → Result<ReviewView> | 계획 중 문서의 정확한 버전을 대상으로 리뷰 요청·사건 저장 |
| C06 ReviewService | listReviews(srId: SRId) → Result<List<ReviewView>> | SR의 리뷰 대상·진행·결과 조회 |
| C06 ReviewService | getReview(srId: SRId, reviewId: ReviewId) → Result<ReviewView> | 원래 대상 버전과 결과 조회 |
| C06 ReviewService | submitResult(srId: SRId, reviewId: ReviewId, input: ReviewResultInput, actor: ActorContext) → Result<ReviewView> | 대상 버전을 유지한 검토 결과 또는 수정 요청과 사건 저장 |
| C07 PlanningContextBuilder | build(srId: SRId, runId: RunId, spec: RunSpecification) → Result<ContextSnapshot> | C09에서 해당 SR 문맥을 읽고 stage 규칙·계획 범위와 결합 |
| C07 PlanningContextBuilder | loadRules(spec: RunSpecification) → Result<RuleBundle> | 로컬 AI-DLC 규칙 중 계획 작업에 해당하는 규칙 선택. 제품 실행 범위를 함께 명시 |
| C08 PlanRunnerPort | execute(context: ContextSnapshot, scope: ExecutionScope) → Result<RunnerOutcome> | 비동기 내부 작업. macOS Claude Code CLI를 기존 인증으로 실행하고 결과를 정규화하여 반환 |
| C09 AppStorePort | read(query: ReadQuery) → Result<ReadResult> | SR·문서·버전·사건·실행·리뷰에 대한 타입별 조회 |
| C09 AppStorePort | commit(changes: ChangeSet) → Result<CommitReceipt> | 관련 데이터와 참조를 일관되게 저장. 일부만 성공으로 공개하지 않는 저장 경계 |
| C10 SRInputPort | normalize(input: SRDraft) → Result<SRDraft> | 직접 입력의 제목·설명·선택 첨부를 공통 형식으로 정규화 |
| C11 PlanningPolicy | evaluate(state: WorkflowState, action: PlanningAction) → Result<ActionEvaluation> | 현재 단계·질문·자체 결정으로 진행 가능 여부 판단; 리뷰 완료 여부는 필수 조건에 넣지 않음 |
| C11 PlanningPolicy | evaluateOutcome(state: WorkflowState, outcome: RunnerOutcome) → Result<WorkflowState> | 정상 결과가 의미하는 입력/승인 대기와 계획 상태를 판단. AI의 제안만으로 사용자 승인 생성 금지 |

서비스 메서드는 사용하는 저장 값과 의미를 정의하며 공통 Result 오류는 입력 오류, 대상 없음/소속 불일치, 진행 조건 미충족, CLI 실행·결과 오류, 저장 오류를 구분한다. 정확한 메시지·코드·HTTP 매핑은 후속 설계에서 결정한다.

## 계약 불변 조건

1. VersionRef·RunId·QuestionSetId·ReviewId는 요청 SR에 속해야 한다. 본문 편집·복원은 이전 버전을 덮어쓰지 않는다.
2. 질문은 실행/단계를 대상으로 저장할 수 있어야 한다. 문서 생성 전 질문에 응답할 때 존재하지 않는 버전을 강요하지 않는다. 문서 결정과 리뷰는 실제 대상 버전을 참조한다.
3. advance는 장시간 CLI 완료까지 UI 응답을 붙잡지 않고 RunView를 반환한다. C05가 내부 작업을 이어가며 UI는 getRun으로 상태를 다시 읽는다. 조회 주기·프로세스 중단 처리 세부는 NFR 설계에서 정한다.
4. 정상 RunnerOutcome도 결과 형식·대상 검증과 저장이 끝나야 실행 성공으로 공개한다. 문서가 없는 질문 결과와 실제 생성 실패를 구분하며 실행 성공을 단계 승인으로 해석하지 않는다.
5. completePlanning은 코드 실행을 호출하지 않는 상태 변경이다. markImplemented는 사용자의 완료 선언이며 검증된 빌드 결과가 아니다.
6. CLI 결과는 문서·질문·다음 계획 제안의 입력 데이터로만 처리한다. C11의 허용된 계획 범위를 넘는 명령을 실행 결과에서 재실행하지 않는다.
7. AppStorePort.commit의 일관된 변경은 필수 저장 요구를 위한 계약이다. 구체적인 트랜잭션 방식은 저장 기술 선택 후 정하고 분산 트랜잭션 시스템을 요구하지 않는다.

정확한 회차 계산, stage별 승인 수와 문서 묶음, 편집 도중 생성 결과 도착 시 처리, 상태명·저장 스키마·CLI 옵션은 Functional Design/NFR Design에서 이 계약을 구체화한다.
