# PlanRepo 사용자 스토리 생성 계획 (Story Generation Plan)

이 문서는 **PART 1 — 계획** 산출물입니다. 아래 **질문(Q-S1 ~ Q-S7)**에 각 `[Answer]:` 태그 뒤에 문자(A/B/C…)를 채워 답해 주세요. 보기 중 맞는 것이 없으면 **X) Other**를 고르고 `[Answer]:` 뒤에 설명을 적어 주세요. 다 하시면 "승인" 또는 "done"이라고 알려 주세요. (제품 오너 관점의 권장안을 각 질문에 표시했습니다.)

> **입력 참조**: `aidlc-docs/inception/requirements/requirements.md`(FR/NFR/MK/AC ID), `Requirements/planrepo-requirements.md.txt`(§5 역할, §12 인수 시나리오), `user-stories-assessment.md`.

---

## A. 방법론·실행 체크리스트 (Methodology)

계획 승인 후 PART 2에서 아래 순서로 스토리를 생성합니다.

- [x] 1. 페르소나 정의 — 확정된 페르소나 집합(Q-S2)별 목표·책임·주요 과업·성공 지표·좌절 요인·기술 숙련도 정리 → `personas.md`
- [x] 2. 스토리 구조 확정 — 확정된 분해 방식(Q-S1)·세분화 수준(Q-S3)에 따라 에픽/스토리 골격 수립
- [x] 3. 사용자 스토리 작성 — INVEST 준수, "As a [페르소나], I want [행동], so that [가치]" 형식 → `stories.md`
- [x] 4. 수용 기준 작성 — 확정된 형식(Q-S4)으로 스토리별 수용 기준 작성
- [x] 5. 추적성 매핑 — 각 스토리를 FR/NFR/MK ID 및 §12 인수 시나리오(AC-1..12)에 매핑(Q-S7)
- [x] 6. 페르소나↔스토리 매핑 — 어느 페르소나가 어느 스토리의 주체인지 매핑표 작성
- [x] 7. 범위 표기 — 목업으로 시연 가능한 스토리와 제품 비전 전용(참고) 스토리 구분 표기(Q-S5)
- [x] 8. 비교 축 스토리 — 4종 화면 변형이 경쟁하는 과업을 명시하는 평가 스토리 포함 여부 반영(Q-S6)
- [x] 9. 검증 — INVEST·수용 기준 완전성·추적성 누락 점검 후 다음 단계 준비

## B. 필수 산출물 (Mandatory Artifacts)

- [x] `aidlc-docs/inception/user-stories/stories.md` — INVEST 준수 사용자 스토리 + 수용 기준
- [x] `aidlc-docs/inception/user-stories/personas.md` — 페르소나 아키타입·특성
- [x] 스토리 Independent·Negotiable·Valuable·Estimable·Small·Testable 보장
- [x] 스토리별 수용 기준 포함
- [x] 페르소나↔스토리 매핑

## C. 스토리 분해 방식 옵션 (참고 — Q-S1에서 선택)

- **User Journey-Based**: 사용자 워크플로우(답변→확정→계획 승인→산출물 승인→인계) 흐름을 따라 스토리 구성. 장점: 목업의 과업 속도 비교(§13)와 정렬. 단점: 역할 간 책임 경계가 흐려질 수 있음.
- **Feature-Based**: 시스템 기능(질문·결정, 버전·리뷰, 게이트, 보드/검토함)별 구성. 장점: FR ID와 깔끔히 매핑. 단점: 사용자 경험 흐름이 분절.
- **Persona-Based**: 역할별 필요를 묶어 구성. 장점: §5 역할 구분·권한 차이를 선명하게. 단점: 공유 흐름 중복.
- **Domain-Based / Epic-Based**: 비즈니스 도메인·계층적 에픽으로 구성.
- **Hybrid(권장)**: 에픽 = 기능/역량 영역, 각 에픽 내부 스토리는 페르소나 주체 + 사용자 여정 관점으로 작성 → 추적성(Feature)과 경험 흐름(Journey)·권한 구분(Persona)을 모두 확보.

---

## D. 계획 질문 (Q-S1 ~ Q-S7)

## Question S1
스토리 분해 방식을 무엇으로 할까요? (위 C 옵션 참고)

*권장: E — 에픽(기능/역량 영역) + 내부는 페르소나·여정 관점 하이브리드. 목업 비교 목적(§13)과 FR/AC 추적성을 동시에 만족.*

A) User Journey-Based (워크플로우 흐름 중심)

B) Feature-Based (기능 중심)

C) Persona-Based (역할 중심)

D) Epic-Based (계층적 에픽)

E) Hybrid — 에픽=기능 영역 + 스토리=페르소나·여정 관점 (권장)

X) Other (please describe after [Answer]: tag below)

[Answer]: E

## Question S2
페르소나 집합을 어떻게 구성할까요?

*권장: B — §5의 5개 역할 + 목업 평가자(레이아웃 비교 주체). §13의 비교 목적을 대표할 주체가 필요하고, 5개 역할은 서로 다른 행동/게이트를 유발하므로 모두 포함.*

A) §5의 5개 역할만(요청자·기획자 / 개발자·문서 작성자 / 결정권자 / 리뷰어 / 리더)

B) 5개 역할 + '목업 평가자'(정보 배치 비교 주체) 페르소나 추가 (권장)

C) 핵심 3~4개로 축소(개발자·작성자 / 결정권자 / 리뷰어 / 리더), 요청자는 부차 처리

X) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question S3
스토리 세분화(계층)를 어떻게 할까요?

*권장: A — 에픽 → 사용자 스토리 2계층. Comprehensive 깊이에 맞고 관리 가능.*

A) 에픽 → 사용자 스토리 2계층 (권장)

B) 평면 스토리 목록(에픽 없이)

C) 에픽 → 스토리 → 하위 작업 3계층(세밀)

X) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question S4
수용 기준(Acceptance Criteria) 형식은 무엇으로 할까요?

*권장: A — Given/When/Then. §12 인수 시나리오가 이미 조건·결과 형태라 자연스럽게 매핑되고 테스트 가능.*

A) Given/When/Then (Gherkin 스타일) (권장)

B) 체크리스트형 불릿 기준

C) 서술형 수용 문장

X) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question S5
스토리 범위를 어디까지로 할까요? (§3은 '제품 MVP'와 '이번 HTML 목업'을 구분)

*권장: B — 목업으로 시연 가능한 행동을 주 스토리로 삼되, 제품 비전 전용 기능(실제 AI 실행·Jira/Git 연동 등)은 '참고(범위 밖)'로 명시 태깅. 이번 산출물이 목업이므로.*

A) 제품 MVP 전체 비전(§3 제품 MVP)을 스토리로 — 목업 시연 여부와 무관

B) 목업 시연 가능한 행동을 주 스토리로 + 제품 비전 전용은 '참고' 태깅 (권장)

C) 목업 시연 가능한 행동만 — 제품 비전 전용은 완전 제외

X) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question S6
4종 화면 변형의 '비교' 자체를 스토리로 명시할까요? (평가자가 어떤 과업의 속도를 비교하는지)

*권장: A — §13이 목업의 존재 이유. 평가자가 변형을 전환하며 "지금 답할 질문 찾기 / 이전 검토 이후 바뀐 것 확인" 과업 속도를 비교하는 스토리를 포함하면 4종 변형의 설계 기준이 고정됨.*

A) 예 — '정보 배치 비교' 평가 여정을 별도 에픽/스토리로 포함 (권장)

B) 아니오 — 비교는 메타 활동이므로 스토리로 만들지 않고 Application Design에서만 다룸

X) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question S7
각 스토리를 요구사항 ID(FR/NFR/MK)와 §12 인수 시나리오(AC-1..12)에 명시적으로 매핑할까요?

*권장: A — Comprehensive 깊이·추적성 확보. 스토리별 "관련 요구사항 / 인수 시나리오" 필드 추가.*

A) 예 — 스토리별 FR/NFR/MK + AC 추적성 필드 포함 (권장)

B) 아니오 — 스토리는 독립적으로 두고 추적은 별도 매트릭스로 후속 처리

X) Other (please describe after [Answer]: tag below)

[Answer]: A
