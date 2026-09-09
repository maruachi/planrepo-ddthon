# PlanRepo 구성요소 메서드와 공통 계약

버전은 0.1이며 **사용자 승인 완료**입니다. 아래 표기는 언어 중립의 논리 계약입니다. 구현 코드·HTTP endpoint·DB 스키마를 확정하는 문법이 아닙니다.

구성요소는 `aidlc-docs/inception/application-design/components.md`, 서비스 흐름은 `aidlc-docs/inception/application-design/services.md`, 전체 설계는 `aidlc-docs/inception/application-design/application-design.md`를 따릅니다. 경로는 프로젝트 루트 기준입니다.

## 1. 공통 요청·결과

| 자료형 | 필수 의미 |
|---|---|
| CommandContext | 서버가 확인한 ActorContext, TargetScope, requestId·idempotencyKey, 명령 대상에 필요한 WriteGuard입니다. 시각·권한·역할을 클라이언트 선언으로 확정하지 않습니다. |
| TargetScope | ProjectScope(projectId) 또는 SrScope(projectId, srId)입니다. SR 생성 전·프로젝트 보드·팀 정책은 ProjectScope를 사용합니다. 기존 SR 대상 명령·조회에는 SrScope와 소속 검사가 필수입니다. 생성 ID는 서버가 발급하고 고유 키·프로젝트 조건을 검사합니다. |
| ActorContext | 선택된 가상 사용자 ID와 서버의 현재 프로젝트 역할과 대상 SR이 있는 경우의 배정입니다. 선택형 데모 사용자임을 표시하며 실제 조직 인증으로 주장하지 않습니다. |
| RuntimeContext | 백엔드가 발급한 실행 주체·소유권 토큰입니다. 사용자 요청이나 모델 출력이 만들 수 없습니다. |
| QueryContext | ActorContext, TargetScope와 조회 대상을 포함합니다. 조회 응답의 revision은 다음 요청에서 비교할 값이며 통과 권한이 아닙니다. |
| WriteGuard | 변경하는 대상의 expectedRevision, 필요한 expectedBundleRef, AI 적용의 expectedInputFingerprint입니다. 어떤 값이 필요한지는 명령 계약으로 정하고 현재 상태는 서버가 읽습니다. |
| VersionRef | 자료 종류·ID·불변 버전의 참조입니다. SR 범위도 확인합니다. ArtifactVersion, DecisionVersion, QuestionResultSnapshot, ReviewPolicyVersion을 구분합니다. |
| BundleRef | 게이트·묶음 ID·버전입니다. G2는 사용한 승인 G1 BundleRef를 포함합니다. |
| CommandResult<T> | 새 확정 결과 Committed, 동일 요청의 이전 처리 정보 Replayed, 거절 Rejected를 구분합니다. 현재 유효성·최신 revision과 이전 receipt를 혼동하지 않습니다. |
| CommandReceipt | 명령 종류·요청 식별자·입력 지문·행위자·처리 대상·확정 revision·시각과 결과 참조입니다. 업무 변경과 함께 저장합니다. |
| DomainError | 코드·사용자용 사유·현재 버전·차단 항목·담당자·처리 대상 참조를 포함합니다. 원시 CLI 출력·비밀 값·내부 자격 증명을 노출하지 않습니다. |
| GateAssessment | 검사한 현재 revision, 게이트·묶음·참조 G1, 필수 조건별 결과·사유·담당자·대상입니다. 적용 시점에는 다시 계산합니다. |
| ReviewImpact | 영향받는 게이트, 새 검토 필요, 복귀할 단계, 이어갈 차단 요청과 인계의 현재 유효성을 나타냅니다. 상세 전이표는 Functional Design에서 정합니다. |

오류 코드는 최소한 VALIDATION_ERROR, FORBIDDEN, NOT_ASSIGNED, STALE_VERSION, STALE_BUNDLE, INPUT_CHANGED, GATE_BLOCKED, IDEMPOTENCY_CONFLICT, STORE_UNAVAILABLE, PROVIDER_UNAVAILABLE, INVALID_OUTPUT, RUN_FINAL을 구분합니다. 실제로 판별하지 못한 인증·모델 오류는 추정하지 않습니다.

동일 idempotencyKey에 다른 명령·입력을 보내면 충돌로 처리합니다. 같은 요청을 재전송하면 중복 변경·이력을 만들지 않습니다. 이전 성공 receipt를 현재 승인이나 인계 가능성으로 재사용하지 않습니다. 현재 권한이 없거나 현재용 전환·인계 조건이 무효이면 거절과 필요한 이전 처리 정보를 구분해 반환합니다.

저장 충돌용 revision, AI 입력 fingerprint, 묶음의 불변 버전, 게이트의 현재 유효성은 별개입니다. 일반 댓글로 revision이 바뀌었다고 승인을 자동 무효화하지 않습니다. 정확한 비교 범위와 잠금·충돌 처리 방식은 Functional·NFR Design에서 정합니다.

## 2. 사용자와 내부 서비스 메서드

| ID | 서비스 | 시그니처 | 반환 | 목적·핵심 거절 조건 |
|---|---|---|---|---|
| M-001 | S-01 | `describeWorkspace(query: QueryContext)` | `WorkspaceView` | 한 팀·프로젝트와 가상 사용자·연결 상태를 표시합니다. |
| M-002 | S-01 | `selectDemoActor(selection: DemoActorId)` | `DemoActorView` | 고정된 가상 사용자 목록에서 선택합니다. 클라이언트가 보낸 역할·승인 권한을 신뢰하지 않습니다. |
| M-003 | S-02 | `registerSr(ctx: CommandContext, input: NewSR)` | `CommandResult<SRView>` | 키·제목·목적·설명·담당자·프로젝트를 검사하고 최초 설명을 보존합니다. |
| M-004 | S-02 | `importMockTicket(ctx: CommandContext, key: TicketKey)` | `CommandResult<ImportOutcome>` | Mock 자료만 사용합니다. 중복 키는 기존 SR을 안내하고 덮어쓰지 않습니다. |
| M-005 | S-02 | `updateSrDescription(ctx: CommandContext, input: SRDescriptionEdit)` | `CommandResult<SRView>` | 현재 설명과 최초 설명을 분리하고 승인 기준에 포함된 변경의 영향을 같이 처리합니다. |
| M-006 | S-02 | `attachSource(ctx: CommandContext, input: SourceInput)` | `CommandResult<ContextSourceView>` | 텍스트·Markdown·링크와 출처·확인 상태를 보존합니다. 읽지 않은 자료를 확인 완료로 만들지 않습니다. |
| M-007 | S-02 | `confirmSource(ctx: CommandContext, input: SourceConfirmation)` | `CommandResult<ContextSourceView>` | 확인자·근거·시각과 대상 버전을 기록하고 영향받는 검토 기준을 갱신합니다. |
| M-008 | S-03 | `answerQuestion(ctx: CommandContext, input: QuestionAnswer)` | `CommandResult<QuestionView>` | 배정된 질문에 답변을 저장합니다. 해결 확인은 별도입니다. |
| M-009 | S-03 | `resolveQuestion(ctx: CommandContext, input: QuestionResolution)` | `CommandResult<QuestionView>` | 담당자가 근거·일관성·문서 반영 또는 변경 불필요 이유를 확인합니다. |
| M-010 | S-03 | `addFollowupQuestion(ctx: CommandContext, input: FollowupQuestion)` | `CommandResult<QuestionView>` | 원 질문 연결·담당자·필수 시점을 보존하고 새 차단 문제의 영향을 반영합니다. |
| M-011 | S-03 | `convertQuestionToDecision(ctx: CommandContext, input: DecisionConversion)` | `CommandResult<DecisionView>` | 원 질문과 연결하고 중복 생성·문제 중복 집계를 막습니다. 새 결정은 미확정입니다. |
| M-012 | S-03 | `confirmDecision(ctx: CommandContext, input: DecisionConfirmation)` | `CommandResult<DecisionView>` | 현재 지정 결정권자만 선택·이유·근거를 확정하며 이전 버전을 보존합니다. |
| M-013 | S-03 | `redecide(ctx: CommandContext, input: DecisionRevision)` | `CommandResult<DecisionView>` | 새 결정 버전과 변경 이유·검토 영향을 함께 기록합니다. |
| M-014 | S-03 | `classifyScope(ctx: CommandContext, input: ScopeClassification)` | `CommandResult<ScopeView>` | 담당자의 G1/G2 필요 시점·후속 범위 분류입니다. 현재 필수 결정을 분류명만 바꿔 우회하지 못하게 합니다. |
| M-015 | S-04 | `saveArtifact(ctx: CommandContext, input: ArtifactEdit)` | `CommandResult<ArtifactView>` | 문서 종류·요구사항/섹션 식별자를 보존하고 새 버전과 검토 영향·요청 승계를 함께 확정합니다. |
| M-016 | S-04 | `compareArtifacts(query: QueryContext, refs: ArtifactVersionPair)` | `ArtifactDiffView` | 현재·이전 원문과 바뀐 요구사항·결정·섹션을 비교합니다. 요약이 원문 비교를 대신하지 않습니다. |
| M-017 | S-04 | `saveWorkflowPlan(ctx: CommandContext, input: WorkflowPlanEdit)` | `CommandResult<WorkflowPlanView>` | 실행·생략 단계와 이유, 문서 참조와 검증 연결을 저장합니다. 필수 문서·게이트 생략을 허용하지 않습니다. |
| M-018 | S-04 | `applyDraft(ctx: CommandContext, input: DraftApplication)` | `CommandResult<AppliedDraftView>` | 현재 입력 fingerprint·대상 버전·사람의 선택·실행 상태를 검사합니다. 결과를 새 문서 또는 미확정 질문·결정으로 반영하고 검토 영향을 함께 확정합니다. |
| M-019 | S-04 | `createReviewedDraft(ctx: CommandContext, input: ReviewedDraftInput)` | `CommandResult<DraftView>` | 오래된 결과와 현재 입력을 사람이 비교한 내용을 새로운 현재 초안으로 기록합니다. 원래 실행의 입력·오래됨 표시를 지우지 않습니다. |
| M-020 | S-05 | `requestReview(ctx: CommandContext, input: ReviewRequestInput)` | `CommandResult<ReviewBundleView>` | 고정 묶음을 생성하고 현재 공식 검토로 지정합니다. 이전 검토 요청·미해결 수정 요청·현재 검토함을 함께 갱신합니다. |
| M-021 | S-05 | `recordApproval(ctx: CommandContext, input: ApprovalInput)` | `CommandResult<ApprovalView>` | 현재 묶음·지정 검토자·확인 체크리스트를 검사해 개별 승인만 기록합니다. 단계 전환은 하지 않습니다. |
| M-022 | S-05 | `addComment(ctx: CommandContext, input: CommentInput)` | `CommandResult<CommentView>` | 문서 버전·섹션·작성자를 연결합니다. 승인 대상이 그대로인 일반 댓글은 승인을 유지합니다. |
| M-023 | S-05 | `requestChange(ctx: CommandContext, input: ChangeRequestInput)` | `CommandResult<ChangeRequestView>` | 대상·담당자·차단 여부와 현재 게이트의 영향을 함께 기록합니다. |
| M-024 | S-05 | `submitChangeResult(ctx: CommandContext, input: ChangeApplication)` | `CommandResult<ChangeRequestView>` | 반영 버전·근거를 연결하고 반영 확인 대기로 둡니다. 차단을 자동 해제하지 않습니다. |
| M-025 | S-05 | `confirmChangeResolution(ctx: CommandContext, input: ChangeConfirmation)` | `CommandResult<ChangeRequestView>` | 요청자 또는 지정 검토자가 현재 반영 대상을 확인합니다. 반영자와 역할을 겸한다는 이유로 일률적으로 거절하지 않습니다. |
| M-026 | S-05 | `requestFurtherChange(ctx: CommandContext, input: ChangeFeedback)` | `CommandResult<ChangeRequestView>` | 미해결 내용과 피드백을 남기고 해결 확인으로 처리하지 않습니다. |
| M-027 | S-05 | `assessGate(query: QueryContext, gate: GateKind)` | `GateAssessment` | 화면용 현재 조건·차단 이유·담당자·대상을 제공합니다. 조회 결과는 전환 권한이나 예약이 아닙니다. |
| M-028 | S-05 | `transitionStage(ctx: CommandContext, input: StageTransition)` | `CommandResult<SRView>` | 확정 경계에서 현재 권한·버전·묶음·필수 조건을 다시 검사하고 단계와 이력을 함께 저장합니다. |
| M-029 | S-06 | `createPolicyVersion(ctx: CommandContext, input: PolicyEdit)` | `CommandResult<PolicyView>` | 새 팀 정책 버전을 만들고 기존 SR에는 자동 소급하지 않습니다. |
| M-030 | S-06 | `assignReviewers(ctx: CommandContext, input: ReviewerAssignment)` | `CommandResult<ReviewAssignmentView>` | 최초·변경 배정을 지원하고 변경 시 새 묶음·재검토·현재 요청·이력을 함께 갱신합니다. |
| M-031 | S-06 | `applyPolicyToSr(ctx: CommandContext, input: PolicyApplication)` | `CommandResult<ReviewBundleView>` | 명시한 정책 버전만 SR에 적용하고 영향받는 게이트와 새 검토를 확정합니다. |
| M-032 | S-07 | `requestGeneration(ctx: CommandContext, input: GenerationInput)` | `CommandResult<GenerationRunView>` | 권한·현재 입력을 확인해 서버가 고정 스냅샷·ProviderSelection·대기 작업을 함께 저장합니다. |
| M-033 | S-07 | `getGeneration(query: QueryContext, run: GenerationRunId)` | `GenerationRunView` | 상태·입력·provider·요청/실제 model·오류·초안·오래됨·적용 정보를 구분합니다. |
| M-034 | S-07 | `cancelGeneration(ctx: CommandContext, run: GenerationRunId)` | `CommandResult<GenerationRunView>` | 작업의 상태 변경을 원자적으로 확정하고 취소 신호의 전달·프로세스 종료 확인과 구분합니다. |
| M-035 | S-07 | `retryGeneration(ctx: CommandContext, run: GenerationRunId)` | `CommandResult<GenerationRunView>` | 현재 입력으로 새 실행을 만들고 이전 시도를 연결합니다. 이전 오류·취소 이력을 덮어쓰지 않습니다. |
| M-036 | S-07 | `claimRun(internal: RuntimeContext)` | `Optional<ClaimedRun>` | 영속 대기 작업을 실행 소유권과 함께 하나만 인수합니다. 외부 요청에서 이 내부 계약을 호출할 수 없습니다. |
| M-037 | S-07 | `completeRun(internal: RuntimeContext, result: ProviderCompletion)` | `RunCompletionOutcome` | 실행 소유권·상태·형식·참조 범위를 검사합니다. 성공 초안을 저장하지만 업무 문서를 적용하지 않습니다. |
| M-038 | S-07 | `failRun(internal: RuntimeContext, error: ProviderFailure)` | `RunCompletionOutcome` | 해당 시도의 실패와 제거된 진단 정보를 기록합니다. 취소된 실행을 다시 실패·성공으로 바꾸지 않습니다. |
| M-039 | S-07 | `reconcileInterruptedRuns(internal: RuntimeContext)` | `RecoverySummary` | 재시작 후 소유권이 끊긴 실행을 실행 중인 것처럼 영구 표시하지 않습니다. 재시도 이력을 분리하는 복구 정책은 NFR Design에서 정합니다. |
| M-040 | S-08 | `createHandoff(ctx: CommandContext, input: HandoffRequest)` | `CommandResult<HandoffView>` | 현재 유효한 G1·G2와 정확한 기준 내용을 고정하고 인계·활동·중복 결과를 함께 확정합니다. |
| M-041 | S-08 | `previewHandoff(query: QueryContext, ref: HandoffId)` | `HandoffPreview` | 고정 기준 내용과 현재 유효성을 함께 표시합니다. 과거 인계를 최신 승인으로 표현하지 않습니다. |
| M-042 | S-08 | `exportCurrentHandoff(ctx: CommandContext, ref: HandoffId)` | `CommandResult<MarkdownDownload>` | 확정 시점의 현재 게이트·참조 유효성을 검사한 뒤 고정된 본문을 내보냅니다. 무효 게이트의 신규 현재용 내보내기는 거절합니다. |
| M-043 | S-08 | `recordImplementationStart(ctx: CommandContext, input: ImplementationStart)` | `CommandResult<ImplementationView>` | 유효 인계를 선택하고 수동 외부 구현 시작과 보드 단계를 연결합니다. |
| M-044 | S-08 | `recordImplementationCompletion(ctx: CommandContext, input: ImplementationCompletion)` | `CommandResult<ImplementationView>` | 완료 요약·외부 근거를 보존합니다. 재검토 중의 외부 완료 사실은 승인을 복구하거나 게이트를 우회하지 않습니다. |
| M-045 | S-09 | `getBoard(query: QueryContext, filter: BoardFilter)` | `BoardView` | 검색·필터·단계·검토·차단·다음 행동을 같은 확정 상태 기준으로 읽습니다. |
| M-046 | S-09 | `getInbox(query: QueryContext, filter: InboxFilter)` | `InboxView` | 현재 사용자에게 배정된 항목을 정해진 정렬로 반환하며 이전 묶음 요청을 중복 표시하지 않습니다. |
| M-047 | S-09 | `getSrDetail(query: QueryContext)` | `SRDetailView` | 현재 검토 요약·문서·질문·결정·묶음·생성·외부 진행과 기준 revision을 반환합니다. |
| M-048 | S-09 | `getActivity(query: QueryContext, filter: HistoryFilter)` | `ActivityView` | 행위자·대상 버전·시각과 과거 승인·인계·외부 구현 이력을 조회합니다. |
| M-049 | S-07 | `readRunControl(internal: RuntimeContext, claim: ClaimRef)` | `RunControlView` | 실행 소유권으로 현재 작업 상태·취소 요청을 읽습니다. terminal 상태에서도 같은 실행의 종료 확인을 위해 조회할 수 있으며 다른 실행은 읽지 못합니다. |
| M-050 | S-07 | `recordExecutionTermination(internal: RuntimeContext, input: ExecutionTermination)` | `ExecutionObservation` | 같은 실행의 실제 종료 확인·시각·제거된 진단을 중복 없이 기록합니다. 취소·성공·실패 상태나 업무 문서를 바꾸지 않습니다. |

메서드의 입력 자료형은 승인된 데이터 개념과 스토리의 필수 정보를 포함합니다. QuestionResolution에는 답변·근거·반영 문서 또는 변경 불필요 이유, DecisionConfirmation에는 선택·이유·근거, ApprovalInput에는 현재 BundleRef와 확인한 체크리스트, ChangeConfirmation에는 현재 반영 대상과 확인 결과를 명시합니다. 이를 단순한 completed=true 값으로 대신하지 않습니다.

ReviewRequestInput은 G1/G2, 문서·결정·질문 결과·정책·검토자와 G2의 상위 G1 기준을 명시합니다. 서버는 현재 저장 상태와 일치하는지 확인해 고정 묶음을 만듭니다. HandoffRequest는 정확한 현재 G2 참조를 받으며 본문·승인 버전을 서버가 고정된 자료에서 구성합니다.

## 3. AI 생성 계약

| 자료형 | 내용과 제한 |
|---|---|
| GenerationInput | taskKind, documentKind, 보완 요청, 대상 VersionRef와 expectedInputFingerprint입니다. QUESTION_PROPOSALS, DECISION_PROPOSALS, ARTIFACT_DRAFT·ARTIFACT_REVISION만 지원합니다. |
| InputSnapshot | 서버가 고정한 snapshotId·srId·workflowVersion·내용 지문과 실제 입력 내용입니다. 문서·질문·답변·결정·근거의 ID·버전·확인 여부와 필요한 프로젝트 내부 규칙의 버전·내용을 포함합니다. |
| ProviderSelection | providerId와 modelChoice입니다. modelChoice는 설치 환경 기본값과 명시 model ID를 구분합니다. requestGeneration이 입력과 함께 고정합니다. 대기 이후 설정 변경은 새 요청에만 적용합니다. 기본 model 선택과 실행에서 확인한 실제 model ID는 구분합니다. 설정 UI나 두 번째 실제 provider 구현을 요구하지 않습니다. |
| ClaimRef | runId와 실행 시도의 소유권 토큰입니다. 종료 후에도 같은 시도의 제어 조회·종료 확인에 사용하며 새 시도를 인수하는 권한이 되지 않습니다. |
| ClaimedRun | ClaimRef, 고정 InputSnapshot·ProviderSelection과 제한 실행 정책입니다. 실행기는 현재 전역 설정으로 저장된 선택을 덮어쓰지 않습니다. |
| RunControlView | 해당 실행의 현재 상태·취소 여부와 종료 관찰 정보입니다. C-05는 실행 중 이를 조회해 ExecutionControl로 취소를 전달합니다. 조회 간격·종료 확인 기한은 NFR Design에서 정합니다. |
| ExecutionTermination | 런타임이 연결한 ClaimRef, 실제 종료 확인·시각과 비밀 값을 제거한 진단입니다. 모델 출력의 종료 주장으로 만들지 않습니다. |
| ExecutionObservation | 실행 시도의 종료 관찰 기록입니다. 제품의 terminal 상태를 바꾸지 않으며 실제 종료가 확인되지 않았으면 확인됐다고 기록하지 않습니다. |
| ProviderRequest | schemaVersion, taskKind, documentKind, InputSnapshot의 명시적 내용, ProviderSelection입니다. 임의 실행 명령·repository 핸들·승인 기능은 포함하지 않습니다. |
| ExecutionControl | 실행별 timeout·출력 상한·취소 신호·제한 실행 정책입니다. 수치와 OS별 종료 방식은 NFR·Infrastructure Design에서 정합니다. |
| ProviderCompletion | 런타임이 연결한 실행 소유권·runId, 정규화된 결과 또는 오류, 확인 가능한 실행 model·CLI 버전·종료 정보입니다. 모델 출력이 runId·권한·입력 기준을 결정하지 않습니다. |
| GenerationResult | schemaVersion과 작업별 결과입니다. 질문은 이유·출처·담당자·필요 시점 제안과 답변 후보, 결정은 질문·대안·영향·추천, 문서는 종류·Markdown·요구사항 참조·변경 요약을 포함합니다. |
| GenerationRunView | 대기·진행·성공·실패·취소, snapshotId, 요청 provider/model, 확인 가능한 실제 model·CLI 버전, 오류·초안·입력 최신성·적용 이력입니다. |
| DraftView | 원 생성 실행 또는 사람의 비교 반영 근거, 기준 입력 fingerprint, 미확정 결과, 적용 여부와 오래됨 사유입니다. 성공한 실행과 적용된 문서를 구분합니다. |
| ProviderFailure | 실행 파일 부재·사용 불가·프로세스 실패·형식 오류·시간 제한 등의 판별 가능한 코드와 비밀 값을 제거한 진단입니다. 실패를 Mock 성공으로 바꾸지 않습니다. |

ProviderRegistry.resolve(selection)는 구성된 provider만 반환합니다. GenerationProvider.generate(request, control)는 정규화된 제안을 반환하며 업무 문서를 저장하지 않습니다. ControlledProcessRunner.run(executable, args, stdin, executionPolicy)는 실행 파일과 인자를 분리하고 본문을 명령 문자열로 해석하지 않습니다.

출력의 구조·작업 종류·필수 필드·참조 범위를 검사합니다. 스냅샷 밖의 항목을 이미 확인한 자료로 사용하지 않습니다. 새 제안용 임시 ID는 서버가 저장 ID에 매핑하며 모델이 실제 SR·문서·묶음 ID를 지정해 다른 자료를 변경할 수 없습니다. 본문의 “승인 완료” 같은 표현은 텍스트이며 승인 명령이 아닙니다.

## 4. 저장·정책·표현 포트

| 구성요소 | 포트 | 계약 |
|---|---|---|
| C-03 | authorize(actor, action, current); assessGate(current); classifyReviewImpact(before, proposed) | 현재 스냅샷의 정책 판단만 반환합니다. I/O와 실제 상태 변경을 하지 않습니다. |
| C-04 | withinTransaction(work); readConsistent(query) | 변경·검토 영향·현재 참조·요청 승계·활동·receipt를 함께 확정합니다. 조회는 하나의 일관된 기준을 반환합니다. |
| C-04 | appendVersion(tx, version); updateCurrent(tx, guard, change) | 불변 내용을 추가하고 현재 참조를 조건부 변경합니다. 기존 승인본을 덮어쓰지 않습니다. |
| C-04 | appendActivity(tx, event); storeReceipt(tx, receipt); storeRun(tx, run) | 업무 또는 작업 상태의 성공 여부와 기록이 어긋나지 않게 같은 저장 경계에 포함합니다. |
| C-07 | listTickets(filter); getTicket(key); getImplementationLink(ref) | 명시된 가상 자료와 Mock 표시·출처를 반환합니다. 외부 시스템 변경 명령은 없습니다. |
| C-08 | renderDocument(version); compareVersions(pair); serializeHandoff(snapshot) | 명시적으로 받은 불변 입력을 안전한 표현·비교·고정 Markdown으로 변환합니다. 게이트 판단은 하지 않습니다. |
| C-09 | resolveActor(selection); resolveProviderConfig(); locateClaude(); now(); nextId() | 가상 사용자·제품 설정·PATH 탐색·시각·식별자를 제공합니다. 개인 경로·비밀 값은 결과 문서에 고정하지 않습니다. |

업무 repository의 세부 메서드·테이블·경쟁 처리 알고리즘과 CLI 출력 포장 형식의 실제 파싱은 후속 상세 설계·구현에서 확정합니다. 이 표는 반드시 지켜야 할 입력·출력·권한·저장 경계이며 구현 완료를 주장하지 않습니다.
