# Components — 컴포넌트 인벤토리

> 참조 시안(`Requirements/ui_ux/`)의 가을톤 컴포넌트를 재사용하되(Q4=A), `.terminal`·`.git-panel`은 **제거**(Q5=A).
> 셸·공용 위젯은 4종 변형에서 **동일**(NFR-VIS-1). 변형은 SR 상세 중앙 영역 컴포넌트만 교체.

## A. 전역 셸 (4종 공통·고정)

| 컴포넌트 | 역할 | 요구사항 |
|---|---|---|
| `AppShell` | 전체 레이아웃(사이드바+본문) | FR-UI-* |
| `Sidebar` | 내비(팀 보드/내 검토함/SR 상세), **역할 전환기**, **변형 전환기**, 데모 초기화 안내 | FR-ROLE-2, MK-2/MK-6, US-H1 |
| `RoleSwitcher` | 5역할 '역할로 보기' 전환 | FR-ROLE-1·2, US-G1 |
| `VariantSwitcher` | V1~V4 인앱 토글(중앙 영역만 교체) | MK-1·2, NFR-VIS-1 |
| `Topbar` | SR 상세 상단 **고정 영역**: SR·현재 작업·지금 필요한 행동·담당자·차단 이유 | FR-UI-DETAIL, US-H2 |
| `ResetBanner` | 새로고침 시 데모 상태 초기화 표기 | MK-6 |
| `SkipLink` | 접근성 건너뛰기 링크 | NFR-A11Y-2 |
| `Toast` | 저장/행동 결과 알림 | FR-UI-STATE |

## B. 화면 (Screens)

| 화면 | 컴포넌트 | 요구사항 |
|---|---|---|
| 팀 보드 | `Board` → `BoardColumn`(4단계) → `SrCard` | FR-STG-1, FR-UI-BOARD |
| 내 검토함 | `Inbox` → `InboxFilterTabs` + `InboxList` → `InboxRow` | FR-UI-INBOX, Q11=C |
| SR 상세 | `SrDetail`(= `Topbar` + `DetailCenter`) | FR-UI-DETAIL |

- `SrCard`: 세 facet 분리(진행 위치·검토 상태·AI 실행 상태), 대표 차단 원인·해결 담당자·대기 기간, 유닛 상세 펼침(FR-STG-2·6·7). 경고 배지 동등 나열 금지.
- `InboxRow`: SR·요청 종류·대상 문서·버전·요청자·기한·다음 행동. 5행동 라벨+아이콘 구별. 빈 상태 vs 필터 결과 없음 구별.
- `DetailCenter`: **변형 슬롯** — V1/V2/V3/V4 중 하나를 렌더(아래 D).

## C. 공용 위젯 (4종 변형이 공유하는 조립 블록)

| 위젯 | 역할 | 요구사항 |
|---|---|---|
| `QuestionCard` | 원문 제목·선택지(A~X 보존)·[Answer]·자유 설명·필수/차단 배지·결정권자·후속 부모 실행 링크 | FR-QN-1~5·10·11 |
| `AnswerRadioGroup` | 원문 문자 보존 라디오/복수/Other 입력 | FR-QN-2·3 |
| `SaveStateIndicator` | 저장 중/저장됨/저장 실패/미저장(텍스트+아이콘) | FR-SV-1·3, NFR-INTEGRITY-1 |
| `ParseErrorCard` | 형식 오류·중복 번호·Answer 누락 위치 안내 | FR-QN-13, AC-12 |
| `VersionDiffView` | 이전 승인본 대비 ＋/－/～ + `신규·미검토`/`수정` 태그 | FR-REV-1(2), AC-4 |
| `VersionTimeline` | v1·v2✓·v3● 이력, 과거 버전 열람 시 최신 승인 차단 표기 | FR-VER-3, AC-5 |
| `ReviewChecklist` | 리뷰 체크리스트·필수 리뷰어 상태 | FR-REV-1(5) |
| `ApprovalPanel` | **버전 고정** 승인(생성 계획 승인/설계 산출물 승인) | FR-VER-1, FR-QN-14 |
| `RevisionRequestPanel` | 수정 요청 라이프사이클(열림→확인 대기→확인 완료), 제출자≠확인자 | FR-RR-1·2, AC-6 |
| `AiRunInline` | AI 실행 상태 배지+요약 로그(본문 인라인, 터미널 없음) | FR-AI-1·7, FR-UI-DETAIL, AC-9 |
| `GatePanel` | 세 게이트 조건·미충족 건수·예외 진행 배지 | FR-GATE-1~4 |
| `PolicySelector` | 전원/과반수/리더 정책 선택·기록 | FR-POL-1~3 |
| `ActionButton` | 결과 설명 라벨·비활성 사유·행위자 구분 | FR-QN-14, NFR-A11Y-2 |
| `StatusBadge` | 색+텍스트+아이콘+숫자 상태 | NFR-A11Y-1, FR-UI-STATE |
| `DocTree` | 문서 트리(탐색 ≠ 단계 전환) | FR-STG-4, US-F1 |
| `Drawer` | 좁은 화면 보조 패널/서랍(slide-over) | NFR-RESP-1 |
| `HandoffContextView` | 읽기전용 구현 인계 컨텍스트 + 참고용 Code Generation Plan(구분 표시) | FR-HANDOFF-1·2, AC-11 |

## D. 변형 중앙 영역 컴포넌트 (4종 — 비교 대상)

각 변형은 위 **공용 위젯을 동일하게 사용**하되 배치만 다르다(정보 배치가 유일한 비교 변수).

| 변형 | 컴포넌트 | 배치 요지 | 시그니처(차별점) |
|---|---|---|---|
| **V1 단일 컬럼 집중** | `V1SingleColumn` | 실행 초점 배너 → sticky 섹션 점프 칩 → 활성 질문 카드(유일 펼침) → 대기 질문 아코디언 → 변경 요약/버전 비교 → 보조 접힘 스택(문서·AI·**수정 요청**·팀) | 모든 블록 DOM 상주, sticky ToC = 전 섹션 카운트 스크롤 맵, 자기주도 스크롤 |
| **V2 좌우 2-pane 비교** | `V2SplitCompare` | 공통 sticky 액션 바 + LEFT(질문·결정) ‖ 드래그 divider ‖ RIGHT(변경 검토 5영역) | 드래그 divider + **연동 스크롤 인과 추적**(diff 줄↔원인 질문); 맥락은 서랍으로 완전 분리 |
| **V3 3-pane 콕핏** | `V3Cockpit` | LEFT 맥락 레일(문서 트리·유닛 타임라인·현재 위치·역할·정책) ‖ CENTER 질문 카드 스택 ‖ RIGHT 검토·승인·실행 dock | 상주 **맥락 레일**(유닛 전반 위치 파악), 클릭 0회 병렬 스캔, [답변 저장]은 dock에 단일 정본 |
| **V4 점진적 공개 서랍** | `V4Focus` | 스텝 칩 스트립 → 위저드 내비 → 포커스 카드(5종: 답변/확정/계획/**검토(5단계 위저드)**/게이트) → 카드 행동 푸터 → 서랍 트리거 바 → slide-over 서랍 | 위저드 큐 + **오프캔버스 서랍**(맥락 전부 서랍), 강제 5단계 diff, 스텝 칩 임의 점프 |

**변형 4종 공통 보장**: 상단 고정 영역·가을톤 팔레트·시드·과업 동일; 네 행동/세 게이트/버전 고정 승인/수정 요청 라이프사이클/파서 오류 표시/색 비의존 상태를 모두 표현(critique 갭 반영: V1에 수정 요청 라이프사이클 + 과거 버전 승인 차단, V2/V4에 확인 대기·제출자≠확인자, V3의 [답변 저장] 중복 제거).
