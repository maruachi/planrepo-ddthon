# Services — 클라이언트 모듈 경계 (D-AD-3)

> "서비스"는 서버가 아니라 **브라우저 내 순수 프런트엔드 모듈**이다(§3: 서버·영속성·실제 AI 없음).
> 모든 상태는 인메모리이며 새로고침 시 시드로 초기화(MK-6). 실제 인증/권한 검증·네트워크 없음.

## 개요

| 모듈 | 책임 | 주요 요구사항 |
|---|---|---|
| `seed` | 시드 데이터 정의·초기화 | MK-4, MK-6, §11 |
| `store` | 인메모리 상태 스토어 + 변경 구독(관찰자) | FR-UI-STATE |
| `answerParser` | 원문 보존 [Answer] 파서 + 오류 검출 | FR-QN-1~5·12·13, AC-1/AC-12 |
| `versionService` | 문서 ID+버전 관리·재승인·재검토 전파 | FR-VER-1~5, AC-4/AC-5/AC-8 |
| `reviewService` | 리뷰 5단계·승인·수정 요청 라이프사이클 | FR-REV-1·2, FR-RR-1~3, AC-6/AC-7 |
| `gateService` | 세 게이트 조건 평가 + 예외 진행 | FR-GATE-1~4, AC-11 |
| `policyService` | 승인 정책 선택·기록 | FR-POL-1~4 |
| `roleService` | 역할 전환·행동 가능 여부·비활성 사유 | FR-ROLE-1·2, AC(§5) |
| `aiRunService` | AI 실행 상태 시뮬레이션(표시만) | FR-AI-1~10, AC-3/AC-9/AC-10 |
| `variantController` | 4종 변형 전환(셸 고정) | MK-1·2, NFR-VIS-1, US-H1 |

## 모듈별 상세

### `seed`
- `buildInitialState()` → §11 엔티티 시드 그래프(SR-1024, U2 메뉴 등). `reset()`이 이를 재적용.
- 원본 Markdown 예시 문자열 포함(AC-1/AC-12 시연용).

### `store`
- 단일 상태 트리 보유 + `subscribe(fn)` / `dispatch(action)` (프레임워크 없이 최소 pub-sub).
- 액션은 서비스가 반환한 순수 결과를 커밋. UI는 구독으로 재렌더.
- 새로고침 = 스토어 재생성 → `seed.buildInitialState()`; 화면에 초기화 배너 표기(MK-6).

### `answerParser`
- `parse(markdown)` → `{questions[], errors[]}`. 제목 형식·선택지 문자·`[Answer]` 위치 원본 보존(FR-QN-1~4). Other 문자 원본에서 판독(FR-QN-5).
- `applyAnswer(markdown, questionId, value)` → **지정 [Answer]만** 치환, 나머지 문자·줄바꿈 불변(AC-1).
- `validate()` → 형식 오류·중복 번호·Answer 누락을 **위치와 함께** 반환; `미답변 0건`으로 숨기지 않음(FR-QN-13, AC-12).
- Q2=C 하이브리드: 구조화 시드가 기본, 소수 원본 예시에만 파서 경로 사용.

### `versionService`
- `getVersions(docId)` / `getDiff(docId, fromV, toV)` → 이전 승인본 대비 변경(＋/－/～ + 태그 `신규·미검토`/`수정`).
- `createVersionOnConfirm(...)` → 답변 확정 시 새 버전 생성, 이전 승인·승인자·시각 보존(FR-VER-2).
- `canApprove(docId, viewingVersion)` → 과거 버전 열람 중 최신 승인 차단(FR-VER-3, AC-5).
- `propagateStaleReview(changedDocVersion)` → 입력으로 쓴 산출물·후속 산출물에 `재검토 필요` 설정(FR-VER-5, AC-8), 자동 삭제·되돌림 없음.

### `reviewService`
- `getReviewSections(docVersion)` → FR-REV-1의 5영역 순서 데이터.
- `approve(docId, version, role)` → 게이트/정책 통과 시에만 승인(제목만 승인 불가 FR-REV-2).
- 수정 요청: `open(...)`, `submitFix(rrId, fixVersion, submitter)` → `확인 대기`(차단 유지 FR-RR-2), `confirm(rrId, confirmer)` → `확인 완료`/`재오픈`(제출자≠확인자 FR-POL-4). 확인 대기 중 재변경 시 최신 수정 버전 재확인.
- `aiDraftDoesNotResolve()` → AI 수정 초안 생성만으로 원본 미해결(FR-RR-3, AC-7).

### `gateService`
- `evaluate(gate, context)` → `{passed, unmet[]}` (텍스트 조건 목록). 세 게이트 각기 다른 조건:
  - AI 실행(FR-GATE-1): 입력 저장·필수 답변 확정·계획 승인·중복 없음.
  - 문서 승인(FR-GATE-2): 확인 버전 일치·필수 답변 확정·차단 수정 요청 해결·체크리스트.
  - 다음 단계·인계(FR-GATE-3): 필수 산출물 최신 승인·필수 결정·차단 없음·입력 영향 해소·미해결 실행 없음 → `구현 대기`(AC-11).
- `exceptionAdvance(gate, reason, actor)` → 미충족 조건·사유·실행자 기록 + `예외 진행` 배지(리더 한정, 문서 승인·인계 게이트만; FR-GATE-4, §8 가정).

### `policyService`
- `setPolicy(srId, policy)` / `getApplied(approvalId)` → 요청별 정책·리뷰어 집합 기록. 정책 변경이 과거 승인 미전환(FR-POL-3).

### `roleService`
- `setViewRole(role)` (5역할, FR-ROLE-1) → `canPerform(action)` + `disabledReason(action)`. 비활성 버튼 사유 노출(NFR-A11Y-2). 제출자≠확인자·결정권자≠리뷰어 구분(FR-ROLE-2).

### `aiRunService` *(표시만)*
- `getRun(runId)` / `startRun(...)`(시드 상태 전이 시뮬레이션): 미저장 답변 시 시작 비활성(FR-AI-2), 중복 방지(FR-AI-8), 실행 중 입력 변경 시 이전 입력 기준 초안 표시(FR-AI-9, AC-10), 실패·취소·중단 시 문서·확정 답변 보존(FR-AI-7). 후속 질문 시 부모 실행·기존 답변 보존(FR-AI-6, AC-3). 체크포인트 복구는 시드 상태로 표현(FR-AI-10, AC-9).
- 실제 실행 없음 — 상태·로그를 **본문 인라인**으로만 노출(터미널 금지, FR-UI-DETAIL).

### `variantController`
- `setVariant('V1'|'V2'|'V3'|'V4')` → SR 상세 **중앙 영역만** 교체. 셸(사이드바·topbar·보드·검토함)과 팔레트는 불변(NFR-VIS-1). 동일 시드·동일 과업 보장(US-H1/H2).
