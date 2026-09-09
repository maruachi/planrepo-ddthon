# Frontend Components — Unit U1 (계층·상태·상호작용·검증)

> 프레임워크 없는 vanilla JS 컴포넌트(함수 렌더 + `store` 구독). props = 렌더 입력, state = `store` 파생. 4변형은 동일 위젯·서비스 공유(Q-FD6=A).

## 1. 컴포넌트 계층
```
AppShell
├─ Sidebar (nav · RoleSwitcher · VariantSwitcher · ResetBanner)
├─ SkipLink
└─ Main
   ├─ Board → BoardColumn ×4 → SrCard (facets, 차단원인, 유닛 펼침)
   ├─ Inbox → InboxFilterTabs + InboxList → InboxRow
   └─ SrDetail
      ├─ Topbar (SR·현재작업·지금 필요한 행동·담당자·차단이유)  ← 고정
      └─ DetailCenter (변형 슬롯: V1SingleColumn | V2SplitCompare | V3Cockpit | V4Focus)
Toast (전역)
```
공용 위젯(변형이 조립): QuestionCard, AnswerRadioGroup, SaveStateIndicator, ParseErrorCard, VersionDiffView, VersionTimeline, ReviewChecklist, ApprovalPanel, RevisionRequestPanel, AiRunInline, GatePanel, PolicySelector, ActionButton, StatusBadge, DocTree, Drawer, HandoffContextView.

## 2. 주요 컴포넌트 props/state
| 컴포넌트 | props(입력) | state/파생 | 핸들러 |
|---|---|---|---|
| `VariantSwitcher` | activeVariant | — | `select(vId)`→variantController |
| `RoleSwitcher` | activeRole | 가능 행동 집합 | `select(role)` |
| `Topbar` | sr, unit | 지금 필요한 행동(파생), 차단이유 | `clickBlockReason()` |
| `SrCard` | sr | facet 집계·유닛 상세 펼침 | `expandUnits()`, `clickBlockReason()` |
| `InboxRow` | reviewItem | — | `open()` |
| `QuestionCard` | question, decision, role | answerState, saveState, canConfirm | `edit()`, `saveAnswer()`, `confirmDecision()`, `openParentRun()` |
| `AnswerRadioGroup` | choices, otherChar, value | selected | `change(value)` |
| `SaveStateIndicator` | saveState | — | — |
| `ParseErrorCard` | errors[] | — | `fixError()` |
| `VersionDiffView` | docId, fromV, toV | diff lines | `expand()` |
| `VersionTimeline` | versions, viewingV | canApprove(파생) | `selectVersion(v)` |
| `ApprovalPanel` | docId, version, role, gateResult | reviewed? | `reviewThenApprove()`, `approvePlan()`, `approveArtifact()` |
| `RevisionRequestPanel` | rr, role | 상태 라벨 | `submitFix()`, `confirmFix()`, `open()` |
| `AiRunInline` | run | status 배지·로그 | `startRun()`, `approvePlan()` |
| `GatePanel` | gate, ctx, role | {passed, unmet} | `advanceStage()`, `exceptionAdvance()` |
| `PolicySelector` | policyConfig, role | — | `setPolicy()` |
| `ActionButton` | label, enabled, disabledReason, actor | — | `onClick` |

## 3. 상호작용 흐름 (두 핵심 과업)
- **T1 지금 답할 질문 찾기**: Topbar '지금 필요한 행동' 또는 변형별 진입점(V1 배너/V2 필터/V3 카운터 칩/V4 큐 첫 카드) → `QuestionCard` → `AnswerRadioGroup.change` → `saveAnswer`(제안됨). 결정권자 역할이면 `confirmDecision` 활성.
- **T2 이전 검토 이후 변경 확인**: `VersionDiffView`(이전 승인본 대비) → `ReviewChecklist` → `ApprovalPanel.reviewThenApprove`. 변형별 노출: V1 하단 스크롤, V2 우측 상주+연동 점프, V3 dock 상주, V4 강제 5단계 위저드.

## 4. 폼 검증 규칙
- 라디오/복수/Other: 선택 없으면 `saveAnswer` 비활성(사유: '선택 필요'). Other 선택 시 자유 설명 필수.
- `saveAnswer` 후에만 `confirmDecision` 후보(그리고 역할=결정권자·담당 결정권자 일치).
- `approveArtifact`는 `canApprove(최신)` ∧ `gate('문서승인').passed` ∧ `reviewed` 일 때만 활성.
- `startRun`은 미저장 답변 없음 ∧ 중복 아님 ∧ (필요 시)planApproved 일 때만 활성; 아니면 비활성+사유.
- 모든 비활성 버튼은 `disabledReason` 노출(NFR-A11Y-2).

## 5. 변형별 배치 로직 (동일 위젯, 배치만 상이)
- **V1SingleColumn**: 위젯을 세로 우선순위 스택으로; 활성 질문만 펼침, 나머지 아코디언; sticky 섹션 점프 칩(전 섹션 카운트); 보조 스택에 DocTree/AiRunInline/RevisionRequestPanel/GatePanel; 과거 버전 승인 차단 상태 노출.
- **V2SplitCompare**: 2-pane grid; LEFT=QuestionCard 리스트+AiRunInline, RIGHT=Version/Review 5영역+ApprovalPanel+RevisionRequestPanel; 드래그 divider(키보드 ←/→); 연동 스크롤(diff↔질문); 맥락은 Drawer.
- **V3Cockpit**: 3-pane grid(280 / fluid / 360); LEFT=DocTree+유닛 타임라인+RoleSwitcher/PolicySelector; CENTER=우선순위 카드 스택+카운터 칩+ParseErrorCard; RIGHT dock=Diff+5영역+4행동(2×2)+GatePanel+AiRunInline+RevisionRequestPanel; [답변 저장] 정본은 dock, 카드 내는 shortcut 표시.
- **V4Focus**: 스텝 칩 스트립 + 위저드 내비 + 단일 포커스 카드(5종: 답변/확정/계획/검토(5단계 아코디언)/게이트/**수정요청**) + 카드 행동 푸터(주 행동 1개) + 서랍 트리거 바 + `Drawer` slide-over(포커스 트랩·Esc); 스텝 칩으로 임의 큐 점프.

## 6. 반응형·접근성
- 좁은 화면: V1/V4는 그대로 순차; V2는 탭('질문·결정 | 변경 검토')+서랍; V3는 3-pane→탭/아코디언, 좌·우 서랍. Topbar 고정 유지(US-H2).
- 랜드마크(nav/main/complementary), `aria-live`(카운터·저장 상태·카드 전환), 라디오 방향키, 서랍 포커스 트랩.
