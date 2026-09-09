# Business Logic Model — Unit U1

> 상태 머신 + 순수 알고리즘. 모든 상태 변경은 `store`를 통해 커밋되고, 게이트는 파생(순수 함수)로 재계산(Q-FD4=A). 실제 실행/네트워크 없음(§3).

## 1. 답변 상태 머신 (FR-QN-8, AC-1/AC-2)
```
미답변 ──edit──▶ 편집중/미저장 ──자동저장──▶ (저장됨 초안)
편집중 ──saveAnswer(P2)──▶ 제안됨(저장됨)      // '답변 저장' = 제안 승격, 확정·승인 아님
제안됨 ──confirmDecision(P3)──▶ 확정됨           // + 새 DocVersion 생성
확정됨 ──editConfirmed──▶ 제안됨(재확정 필요)    // 이전 확정 history 보존
```
- `saveAnswer` → `answerParser.applyAnswer` 로 **지정 [Answer]만** 치환(AC-1). 저장 실패 시 `저장실패`, 성공 위장 금지(FR-SV-3, NFR-INTEGRITY-1).
- `confirmDecision`만 문서 Answer를 갱신하고 새 버전을 만든다(Q-FD2=A).

## 2. 버전 로직 (FR-VER-*, AC-4/AC-5/AC-8)
- `createVersionOnConfirm(docId)`: 현재 최신 + 1, `prevVersion` 링크, 이전 버전·승인·승인자·시각 **불변** 보존.
- `getDiff(docId, fromV, toV)`: 라인 단위 `＋추가/－삭제/～수정` + 태그(`신규·미검토`/`수정`). 기본 비교 기준 = 이전 승인본.
- `canApprove(docId, viewingVersion)` = `viewingVersion === currentVersion && !hasNewerThan(viewingVersion)`; 과거 버전 열람 시 `false` + '최신 검토로 이동' 유도(AC-5).
- `propagateStaleReview(changedDV)`: `inputVersions`로 changedDV를 참조하는 모든 DocVersion(같은/다음 단계) `staleReview=true`. **자동 삭제·되돌림 없음**(FR-VER-5, AC-8).

## 3. 수정 요청 라이프사이클 (FR-RR-*, AC-6/AC-7)
```
열림 ──submitFix(P2, fixVersion)──▶ 수정확인대기   // blocking 유지 (제출만으로 미해제)
수정확인대기 ──confirm(요청리뷰어)──▶ 확인완료      // 제출자 ≠ 확인자
수정확인대기 ──재변경──▶ 수정확인대기(최신 fix 재확인 필요)
확인완료/수정확인대기 ──reopen──▶ 재오픈
```
- 최종 확인자 = 요청 리뷰어(FR-POL-4). AI 수정 초안 생성은 원본 미해결 — 명시적 반영(새 버전) 필요(FR-RR-3, AC-7).
- `submitFix`는 `blocking`을 유지 → 관련 게이트 계속 차단(AC-6).

## 4. 게이트 평가 (파생 순수 함수, FR-GATE-*, AC-11)
`evaluate(gate, ctx) → { passed:bool, unmet:[{key,label}] }`
- **AI실행**: 입력 저장완료 ∧ 필수답변 확정 ∧ (필요 시)계획 승인 ∧ 중복 실행 없음.
- **문서승인**: 확인버전 == 대상버전 ∧ 해당버전 필수답변 확정 ∧ 차단 수정요청 해결 ∧ 체크리스트 완료.
- **다음단계인계**: 단계 필수 산출물 최신 승인 ∧ 필수 결정 완료 ∧ 차단 요청 없음 ∧ 입력변경 영향 해소(staleReview 없음) ∧ 진행/미해결 실행 없음 → 통과 시 `구현대기`.
- `exceptionAdvance(gate, reason, actor)`(리더, 문서승인·인계만): `unmet`·사유·실행자 기록 + `예외진행` 배지. 미결정/미승인을 완료로 바꾸지 않음(FR-GATE-4).

## 5. AI 실행 시뮬레이션 (표시만, FR-AI-*, AC-3/9/10)
- `startRun(taskType, input)`: **가드** — 미저장 답변 있으면 비활성+사유(FR-AI-2); 동일 실행 중복이면 차단 + 대상·입력버전 표시(FR-AI-8); 계획 승인 필요 작업은 `planApproved` 전 산출물 생성 불가(FR-AI-3).
- 실행 중 입력 변경(입력 DocVersion 갱신) → 출력은 `이전 입력 기준 초안`으로 표시, 최신 문서 미덮어씀 + 재검토/재실행 안내(FR-AI-9, AC-10).
- `실패`/`취소`/`중단재개가능` → 문서·확정 답변 보존, 부분 결과는 '승인 가능 최종본' 아님(FR-AI-7).
- 후속 질문: 부모 실행·기존 답변·실행 ID 보존 + 새 답변 추가(FR-AI-6, AC-3).
- 새로고침(체크포인트 복구, AC-9)은 실제 제품 한정 — 목업은 시드 상태 + 초기화 배너로 표현(MK-6).

## 6. 파서 알고리즘 (Q2=C, FR-QN-1~5·13, AC-1/AC-12)
- `parse(md)`: 제목 형식(`## Question N`/`### Qn.`/`### Clarification Question n`) 인식하되 **원문 문자열 보존**. 선택지 문자·순서 원본대로(A/B/…/X, 고정 오지선다 아님). Other 문자 원본에서 판독(추측 금지, FR-QN-5).
- `applyAnswer(md, qId, value)`: 해당 질문 블록의 `[Answer]:` 라인만 정규식 치환(`[Answer]:A`, `[Answer]: A`, `- [Answer]: A`, 답변이 선택지보다 앞 형태 모두), 나머지 문자·줄바꿈 불변(AC-1).
- `validate(md)`: 형식 오류·중복 번호·`[Answer]` 누락을 **위치(줄 번호/절)** 와 함께 수집. 미답변 집계에서 오류를 '0건'으로 숨기지 않음(FR-QN-13, AC-12). 오류 존재 시 관련 게이트 `unmet`에 포함, 수정 후 재검증하면 해제.

## 7. 결정성·초기화
- 순수 함수 우선(diff/gate/parse) → 동일 입력 동일 출력. `Date`/난수 미사용(시드에 고정 타임스탬프 문자열).
- `reset()` = `store` 재생성 + `seed.buildInitialState()`; 화면에 초기화 배너(MK-6).
