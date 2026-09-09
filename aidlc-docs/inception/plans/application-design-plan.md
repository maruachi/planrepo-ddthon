# Application Design Plan — PlanRepo HTML 목업 (Unit U1)

> 표준 승인 위임(Standing Authorization, 2026-09-08): "앞으로 모두 권장사항으로 진행해서 개발까지 완료하고 서버까지 띄워줘".
> 아래 설계 결정(D-AD-*)은 제품 오너 권장안으로 자동 채택되며, 차단 질문 대신 결정+근거로 기록한다.

## A. 목적 / 범위
- **목적**: 코드 생성에 앞서 화면·컴포넌트·서비스(클라이언트 모듈)·의존성·시드 데이터 모델을 확정한다.
- **범위**: 단일 자기완결 `index.html`(HTML/CSS/JS) 하나. 공유 셸 + SR 상세 **중앙 검토 영역 4종 변형**. 서버/영속성/실제 AI/Git 없음(§3).
- **핵심 산출 결정**: 4종 변형의 정보 배치를 확정하고, 셸/컴포넌트는 4종에서 **동일**하게 고정(비교 변수 = 배치뿐, NFR-VIS-1).

## B. 산출물 체크리스트 (application-design.md 규칙)
- [x] `application-design/components.md` — 컴포넌트 인벤토리(셸 + 4종 변형 + 공용 위젯)
- [x] `application-design/component-methods.md` — 각 컴포넌트의 행위/메서드/상태 전이(클라이언트 관점)
- [x] `application-design/services.md` — 클라이언트 "서비스" 모듈(파서·버전·게이트·정책·상태 스토어 등, 서버 아님)
- [x] `application-design/component-dependency.md` — 컴포넌트/서비스 의존성 그래프(Mermaid, 검증 후)
- [x] `application-design/data-model.md` — §11 7개 엔티티 시드 데이터 모델 + table-order-ddthon 시드 매핑
- [x] `application-design/application-design.md` — 통합 설계 문서(4종 변형 상세 + 화면 흐름 + 셸 구조)
- [x] 게이트 메시지 제시 → 표준 승인 위임으로 자동 승인 → audit.md/aidlc-state.md 갱신

## C. 설계 방법론 체크리스트
- [x] 참조 시안(`Requirements/ui_ux/`)의 가을톤 팔레트·컴포넌트 클래스 재사용, `.terminal`/`.git-panel` 제거(Q5=A)
- [x] 4종 변형을 **의도적으로 서로 다른** 정보 아키텍처로 정의(단일 컬럼 / 2-pane / 3-pane / 점진 공개)
- [x] 두 핵심 과업(T1 지금 답할 질문 찾기 · T2 이전 검토 이후 변경 확인)을 각 변형에서 수행 가능하게 매핑
- [x] 네 행동·세 게이트·버전 고정 승인·수정 요청 라이프사이클을 모든 변형에서 표현
- [x] 색 비의존 상태(텍스트+아이콘+숫자)·키보드·반응형(서랍/순차)·글자 ~12px 하한 반영(횡단)
- [x] §11 데이터 링크(7 엔티티) 시드 스키마 확정 → Functional Design 입력

## D. 설계 결정 (권장안 자동 채택)

### D-AD-1. 4종 변형의 축(무엇을 다르게 할 것인가)
- **결정**: SR 상세의 **중앙 검토 영역 정보 배치**만 다르게 한다. ① 단일 컬럼 집중, ② 좌우 2-pane 비교, ③ 3-pane 콕핏, ④ 점진적 공개 서랍.
- **근거**: MK-1·2, US-H1/H2, §13. 셸·팔레트·시드·과업 고정 → 순수 비교(NFR-VIS-1).

### D-AD-2. 공유 셸 구조(4종 공통·고정)
- **결정**: 좌측 사이드바(내비: 팀 보드 / 내 검토함 / SR 상세, 역할 전환기, 변형 전환기) + 상단 topbar(SR·현재 단계·현재 작업·지금 필요한 행동·담당자·차단 이유 고정) + 본문 영역(화면별). SR 상세에서만 중앙 영역이 4종으로 토글.
- **근거**: FR-UI-BOARD/INBOX/DETAIL, US-H1, 상단 고정 영역(US-H2 AC).

### D-AD-3. 클라이언트 "서비스" 모듈 경계
- **결정**: 순수 프런트엔드 모듈로 구성 — `store`(인메모리 상태), `answerParser`(원문 보존 `[Answer]` 파서, Q2=C 하이브리드), `versionService`(문서 ID+버전·재승인), `gateService`(3 게이트 조건 평가), `reviewService`(수정 요청 라이프사이클), `policyService`(승인 정책), `roleService`(역할 전환·권한), `aiRunService`(실행 상태 시뮬레이션, 실제 실행 없음), `seed`(시드 데이터).
- **근거**: §11 엔티티, FR-QN/VER/GATE/RR/POL/ROLE/AI. 서버 아님 — 모두 브라우저 내 모듈(§3).

### D-AD-4. 시드 도메인
- **결정**: table-order-ddthon aidlc-docs(예: story-generation-plan, unit-of-work-plan, U2 메뉴 functional-design/nfr-design)를 시드 SR·문서·질문·버전 소재로 사용. 새로고침 시 초기화(MK-6).
- **근거**: 요구사항의 시드 지침, US-C4/H2 AC(데모 초기화).

### D-AD-5. 상태·접근성 표현(횡단, 4종 공통)
- **결정**: 모든 상태 배지는 텍스트+아이콘+숫자 동반, 라벨 ~12px 하한, 키보드 포커스 링·비활성 사유 노출, 좁은 화면에서 보조 패널은 서랍/순차.
- **근거**: NFR-A11Y-1·2·3, NFR-RESP-1, FR-UI-STATE, US-I1/I2.

## E. 실행 로그 (checkbox는 완료 즉시 갱신)
- [x] 4종 변형 병렬 설계 워크플로우 실행 및 결과 수신
- [x] 산출물 6종 생성(B 체크리스트)
- [x] 게이트 자동 승인 + audit.md/aidlc-state.md 갱신
