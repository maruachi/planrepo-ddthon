# Business Rules — Unit U1

> 검증·제약·정책 규칙. 각 규칙은 요구사항 ID로 추적. 마지막에 §12 AC-1..12 → 로직/컴포넌트 매핑.

## 행동 분리 (FR-QN-14)
- **BR-ACT-1**: 네 행동은 서로 다른 버튼·행위자. `답변 저장`(개발자 P2) ≠ `결정 확정`(결정권자 P3) ≠ `생성 계획 승인` ≠ `설계 산출물 승인`(리뷰어/정책).
- **BR-ACT-2**: `답변 저장`은 `제안됨`까지만 승격. 확정·승인을 자동 완료하지 않음(AC-2).

## 답변·저장 (FR-QN-*, FR-SV-*)
- **BR-ANS-1**: 지정 [Answer]만 변경, 선택지 문자·줄바꿈 보존(AC-1).
- **BR-ANS-2**: Other 문자는 원본 판독값 사용(추측 금지).
- **BR-ANS-3**: 확정 답변 수정 시 `제안됨` 회귀 + 재확정 필요, 이전 확정 history 보존.
- **BR-ANS-4**: 저장 실패·미저장을 성공/최신처럼 표시 금지(NFR-INTEGRITY-1).
- **BR-ANS-5**: 필수 질문(현재 단계) 미확정 시 단계 진행 차단; 의견·후속 단계 질문은 `차단 아님`으로 구별(FR-QN-11).

## 버전·리뷰 (FR-VER-*, FR-REV-*)
- **BR-VER-1**: 승인은 문서 ID+버전에 고정(FR-VER-1).
- **BR-VER-2**: 답변 확정(본문/Answer 변경)은 새 버전 생성; 이전 승인 보존(AC-4).
- **BR-VER-3**: 과거 버전 화면에서 최신 버전 승인 불가(AC-5).
- **BR-VER-4**: 제목만 보고 승인하는 버튼 없음 — 승인 패널에서 변경 확인 후 승인(FR-REV-2).
- **BR-VER-5**: 리뷰 화면은 5영역 순서 고정(판단 요약 → 변경 비교 → 관련 질문·답변·수정요청 → 원문·이력 → 체크리스트·승인).
- **BR-VER-6**: 입력 계획 변경 시 관련·후속 산출물 `재검토 필요` 표시, 자동 삭제·되돌림 없음(AC-8).
- **BR-VER-7**: 새 버전에서 위치 미검출 댓글은 `이전 버전의 댓글`로 표시(FR-VER-4).

## 수정 요청 (FR-RR-*)
- **BR-RR-1**: 수정 완료 제출만으로 차단 미해제; 요청 리뷰어 확인으로만 해결(AC-6).
- **BR-RR-2**: 제출자 ≠ 최종 확인자(FR-POL-4).
- **BR-RR-3**: AI 수정 초안 생성 ≠ 원본 해결 — 명시적 반영 필요(AC-7). 열린 수정 요청이 있어도 수정 초안 생성은 시작 가능(교착 방지).

## 게이트 (FR-GATE-*)
- **BR-GATE-1/2/3**: 각 게이트는 §5.4 조건 전부 충족 시에만 관련 행동 활성; 미충족 조건을 숫자·텍스트로 노출.
- **BR-GATE-4**: 예외 진행은 리더만, 문서 승인·인계 게이트에 한정(§8 가정); 미충족·사유·실행자 기록 + `예외 진행` 배지. 미승인을 완료로 바꾸지 않음.
- **BR-GATE-5**: 문서 탐색 클릭 ≠ 단계 전환; 전환 버튼만 동일 조건 검사(FR-STG-4).

## 역할·정책 (FR-ROLE-*, FR-POL-*)
- **BR-ROLE-1**: 현재 역할이 할 수 없는 행동 버튼 비활성 + 사유 노출.
- **BR-POL-1**: 기본 전원 승인; 정책 선택 시 요청별 정책·리뷰어 집합 기록.
- **BR-POL-2**: 정책 변경이 과거 승인을 최신 정책 승인으로 자동 전환하지 않음(승인 시점 스냅샷).

## 상태·접근성 (NFR-A11Y-*, FR-UI-STATE)
- **BR-A11Y-1**: 모든 상태는 색 + 텍스트 + 아이콘 + 숫자 병기.
- **BR-A11Y-2**: 라벨 최소 ~12px; 키보드 포커스·선택 가능; 비활성 사유 노출.
- **BR-A11Y-3**: 빈 상태 vs 필터 결과 없음 구별; 불러오기/연결 오류 상태 정의.

## §12 인수 기준 매핑
| AC | 규칙/로직 | 컴포넌트 |
|---|---|---|
| AC-1 원문 보존·지정 Answer만 | BR-ANS-1/2, 파서 §6 | QuestionCard, AnswerRadioGroup |
| AC-2 저장≠확정≠승인 | BR-ACT-2, 답변 머신 §1 | QuestionCard, ApprovalPanel |
| AC-3 후속 질문 실행 이어감 | AI §5(FR-AI-6) | QuestionCard(부모 링크), AiRunInline |
| AC-4 v2 승인 후 v3 재승인 | BR-VER-2, 버전 §2 | VersionTimeline, ApprovalPanel |
| AC-5 과거 버전 승인 불가 | BR-VER-3, `canApprove` | VersionTimeline, ApprovalPanel |
| AC-6 제출 후 확인 전 차단 | BR-RR-1, RR §3 | RevisionRequestPanel |
| AC-7 수정 초안 미해결 | BR-RR-3 | RevisionRequestPanel, AiRunInline |
| AC-8 재검토 필요 전파 | BR-VER-6, `propagateStaleReview` | VersionDiffView, StatusBadge |
| AC-9 실패·재시작 복구 | AI §5(FR-AI-7·10) | AiRunInline, ResetBanner |
| AC-10 입력 변경·중복 방지 | AI §5(FR-AI-8·9) | AiRunInline |
| AC-11 Git 없이 구현 대기 | BR-GATE-3, 게이트 §4 | GatePanel, HandoffContextView |
| AC-12 파서 오류 구별 | 파서 §6, BR-A11Y-3 | ParseErrorCard |

**모든 AC(1..12)가 규칙·로직·컴포넌트로 매핑됨.**
