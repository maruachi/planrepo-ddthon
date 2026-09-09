# Component Methods — 행위·상태 전이 (클라이언트)

> 서버 메서드가 아니라 **UI 상호작용 핸들러 + 클라이언트 상태 전이**를 정의한다(§3). 모두 `store`를 통해 서비스 결과를 커밋한다.

## 셸 / 전환기
- `VariantSwitcher.select(vId)` → `variantController.setVariant(vId)` → `DetailCenter` 슬롯만 재렌더. 셸·팔레트 불변(NFR-VIS-1).
- `RoleSwitcher.select(role)` → `roleService.setViewRole(role)` → 모든 `ActionButton`이 `canPerform/disabledReason` 재평가(비활성+사유).
- `Sidebar.navigate(screen)` → 화면 전환(보드/검토함/SR 상세). **단계 전환 아님**.
- `ResetBanner.onLoad()` → 새로고침 감지 시 초기화 문구 표시(MK-6).

## QuestionCard / 답변 상태 머신 (FR-QN-8)
`미답변 → 편집 중/미저장 → 답변 제안(저장됨) → 확정`
- `onEditAnswer(value)` → `Decision.saveState='저장 중'` → 자동 저장 → `저장됨`(초안) / 실패 시 `저장 실패`(성공 위장 금지 FR-SV-3).
- `saveAnswer()` (개발자 P2) → `answerParser.applyAnswer` (지정 [Answer]만 치환 AC-1) → 상태 `답변 제안`. **확정·승인 아님**(AC-2).
- `confirmDecision()` (결정권자 P3) → 상태 `확정` + 확정자·시각·근거 기록 → `versionService.createVersionOnConfirm`(새 버전, §8 가정).
- `editConfirmed()` → 새 제안으로 회귀 + 재확정 필요, 이전 확정 기록 보존(FR-QN-9).
- 후속 질문: `openParentRun()` → 부모 실행/최초 질문으로 이동(FR-AI-6, AC-3).

## ParseErrorCard
- `answerParser.validate()` 결과를 위치와 함께 렌더. 오류 존재 시 관련 게이트 차단. `fixError()` 후 재검증 → 차단 해제(AC-12).

## VersionDiffView / VersionTimeline
- `showDiff(fromV, toV)` → `versionService.getDiff` (이전 승인본 기준 ＋/－/～).
- `selectVersion(v)` → 열람 버전 전환. 과거 버전 열람 시 `ApprovalPanel.approveLatest()` **차단** + 최신 검토 유도(FR-VER-3, AC-5).

## ApprovalPanel (버전 고정)
- `reviewThenApprove()` → 제목만 승인 불가; `reviewService.getReviewSections` 확인 후에만 활성(FR-REV-2).
- `approvePlan()` / `approveArtifact()` → 대상(생성 계획 vs 설계 산출물)에 따라 하나만 활성, `gateService.evaluate('문서 승인')` 통과 필요(FR-GATE-2).

## RevisionRequestPanel (FR-RR-1·2, AC-6)
`열림 → 수정 완료·확인 대기 → 확인 완료`
- `open(area)` (리뷰어 P4) → `열림`(차단).
- `submitFix(fixVersion)` (작성자 P2) → `확인 대기`, **차단 유지**(제출만으로 미해제).
- `confirmFix()` (요청 리뷰어) → `확인 완료`/`재오픈`. 제출자≠확인자(FR-POL-4). 확인 대기 중 재변경 시 최신 수정 버전 재확인.
- AI 수정 초안 생성은 원본 미해결 — 명시적 반영 필요(FR-RR-3, AC-7).

## AiRunInline (표시만, FR-AI-*)
- `render(run)` → 상태 배지(실행 중/추가 답변 대기/실패/취소/중단·재개)+요약 로그(본문 인라인).
- `startRun()` → 미저장 답변 시 비활성+사유(FR-AI-2); 중복 시작 차단+대상·입력 버전 표시(FR-AI-8); 실행 중 입력 변경 시 이전 입력 기준 초안 표시(FR-AI-9, AC-10).
- `approvePlan()` → 계획 승인 후에만 산출물 생성(FR-AI-3). 결과=새 초안(FR-AI-5).

## GatePanel (FR-GATE-*)
- `evaluate(gate)` → `{passed, unmet[]}` 표시(미충족 건수 숫자). 조건 충족 시 관련 `ActionButton` 활성.
- `advanceStage()` (다음 단계·인계) → 통과 시 `구현 대기` 전환(AC-11) → `HandoffContextView` 열람 가능.
- `exceptionAdvance(reason)` (리더 P5) → 미충족·사유·실행자 기록 + `예외 진행` 배지. 미승인을 완료로 바꾸지 않음(FR-GATE-4).

## PolicySelector
- `setPolicy(p)` → `policyService.setPolicy`; 요청별 정책·리뷰어 집합 기록, 과거 승인 미전환(FR-POL-3).

## 화면 컴포넌트
- `SrCard.expandUnits()` → 유닛별 facet 상세(집계↔상세, FR-STG-7).
- `SrCard.clickBlockReason()` → 통과 조건·즉시 해결 행동 먼저 제시 후 이동(FR-UI-BOARD).
- `InboxFilterTabs.select(type)` → 유형 필터(기본 '전체'); 빈 상태 vs 필터 결과 없음 구별(FR-UI-INBOX).
- `Drawer.toggle()` → 좁은 화면 보조 패널/서랍(NFR-RESP-1).

## 변형 컨트롤러 공통
각 변형 컴포넌트는 위 핸들러를 **동일 로직**으로 호출하되 배치·노출 시점만 다르다(예: V4는 카드 종류별로 주 행동 하나만 푸터에 노출, V3는 4행동을 dock 2×2로 상시 노출, V1은 스크롤 위치별 분리, V2는 좌=편집/우=승인 분리). 로직 동일성이 "정보 배치만이 비교 변수"를 보장(NFR-VIS-1).
