# Worktree 통합 User Stories 생성 계획

## 목적과 입력

승인된 [Worktree 통합 요구사항](../requirements/worktree-integration-requirements.md)을 사용자 중심의 작고 검증 가능한 story로 변환한다. 기존 User Stories 산출물은 원래 MVP의 이력으로 보존하고, 이번 개선 산출물은 별도 파일로 생성한다.

입력 문맥:

- [User Stories 실행 평가](worktree-integration-user-stories-assessment.md)
- [요구사항 답변 검증](../requirements/worktree-integration-requirement-answer-validation.md)
- [Reverse Engineering architecture](../reverse-engineering/architecture.md)
- [Reverse Engineering API](../reverse-engineering/api-documentation.md)

## 권장 방법론

User Journey와 Domain을 결합한 hybrid 접근을 권장한다. 최상위 흐름은 저장소 등록 → SR 연결·worktree 준비 → AI-DLC 실행 → 질문·승인 → 문서 운영 → 완료·인계 순서로 구성하고, checkpoint/drift/recovery 같은 cross-cutting domain은 독립 story로 분리한다.

| 접근 | 장점 | 주의점 |
| --- | --- | --- |
| User Journey-Based | 실제 화면 흐름과 end-to-end 인수 테스트가 명확함 | checkpoint·policy 같은 공통 domain이 중복될 수 있음 |
| Feature-Based | API·UI capability별 책임이 선명함 | 사용자 가치 흐름이 분절될 수 있음 |
| Persona-Based | 작성자·reviewer 요구 차이가 명확함 | 대부분 기능을 한 로컬 사용자가 수행해 중복 가능 |
| Domain-Based | repository/worktree/profile/checkpoint 경계가 선명함 | 사용자가 체감하는 순서가 약해질 수 있음 |
| Epic-Based | P0/P1 범위와 의존성 관리가 쉬움 | story가 커지거나 구현 task처럼 변할 수 있음 |
| Hybrid | 사용자 여정과 공통 domain의 장점을 결합 | 분해 기준을 명시적으로 유지해야 함 |

## Part 1 — 계획과 승인

- [x] 승인된 Requirements와 Reverse Engineering 문맥 로드
- [x] User Stories 실행 필요성 평가 및 별도 assessment 작성
- [x] 사용자 영향·persona·journey·technical boundary 분석
- [x] story breakdown 접근 선택지와 권장 hybrid 제시
- [x] story 작성 방법 확인 질문 작성
- [x] 모든 `[Answer]:` 응답 수신: 7개 권장안 A 기록
- [x] 응답의 누락·모순·모호성 검증: 누락·모순 없음
- [x] 확정 persona, granularity, acceptance criteria와 grouping 방법 기록
- [x] User Stories 생성 계획 명시적 승인: “권장안 대로 진행해줘.”

## Story 작성 확인 질문

### Question 1
이번 개선의 핵심 persona를 어떻게 구성합니까?

A) SR 작성자·저장소 운영자를 하나의 Local Planner로 통합하고 Peer Reviewer를 별도 persona로 둠

B) SR Author, Repository Operator, Peer Reviewer를 각각 별도 persona로 둠

C) 단일 Local User persona만 사용하고 역할 차이는 story 조건으로 표현

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — Local Planner와 Peer Reviewer 두 persona로 책임과 사용자 흐름을 분리

### Question 2
Story 분해 방식은 무엇을 사용합니까?

A) 사용자 여정 순서를 기본으로 하고 checkpoint·drift·recovery domain을 독립 story로 분리하는 Hybrid

B) repository, worktree, execution, artifact, interaction domain별로 분해

C) P0/P1 epic 아래 기능 capability별로 분해

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — 사용자 여정과 checkpoint·drift·recovery domain을 결합한 Hybrid 적용

### Question 3
Story granularity는 어느 수준으로 합니까?

A) 각 story가 사용자 가치 하나와 독립 인수 가능한 vertical slice가 되도록 작게 분해

B) 요구사항의 FR-WT 그룹 하나를 story 하나로 대응

C) P0와 P1을 각각 큰 epic 수준 story로 유지

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — 사용자 가치 하나를 독립 인수 가능한 vertical slice로 분해

### Question 4
Acceptance criteria 형식은 무엇을 사용합니까?

A) Given/When/Then 형식과 관련 FR-WT·NFR-WT·AC-WT 추적 ID를 함께 사용

B) 간결한 checklist 형식과 요구사항 추적 ID를 사용

C) Given/When/Then만 사용하고 별도 추적 표에서 요구사항을 연결

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — Given/When/Then과 FR-WT·NFR-WT·AC-WT 추적 ID 병기

### Question 5
중단·drift·충돌·금지 Git 명령 같은 실패 흐름은 어떻게 표현합니까?

A) 사용자 복구 행동이 독립 가치를 가지는 핵심 실패 흐름은 별도 story로 만들고 나머지는 관련 story의 acceptance criteria로 포함

B) 모든 실패 흐름을 정상 기능 story의 acceptance criteria로만 포함

C) 실패·복구 시나리오를 하나의 운영 story로 통합

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — 핵심 복구 행동은 별도 story, 국소 오류는 관련 story acceptance criteria에 포함

### Question 6
Story 우선순위와 의존성을 어떻게 표시합니까?

A) 각 story에 P0/P1, 선행 story와 병렬 가능 여부를 명시

B) P0/P1만 표시하고 의존성은 Workflow Planning에서 작성

C) 우선순위 없이 사용자 여정 순서만 사용

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — P0/P1, 선행 story와 병렬 가능 여부를 story별 명시

### Question 7
기존 PlanRepo 기능의 호환성은 story에 어떻게 반영합니까?

A) 기존 SR baseline 전환과 문서·review·draft 보호 회귀를 별도 compatibility story로 작성

B) 각 신규 story의 acceptance criteria에 관련 회귀 조건을 분산

C) User Stories에서는 제외하고 Build and Test에만 기록

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — baseline 전환과 기존 문서·review·draft 보호를 별도 compatibility story로 작성

## Part 2 — 생성 실행 계획

- [x] 확정 답변과 승인된 방법론 로드
- [x] `worktree-integration-personas.md`에 persona·목표·동기·불편·권한 경계 작성
- [x] P0/P1 user journey와 cross-cutting domain의 story inventory 작성: 4 epics, 18 stories
- [x] `worktree-integration-stories.md`에 INVEST 형식의 user stories 생성
- [x] 각 story에 acceptance criteria와 FR-WT·NFR-WT·AC-WT trace 작성
- [x] Persona-to-story mapping과 story dependency 작성
- [x] 기존 기능 compatibility·migration story 포함 여부 검증: US-WT-02, US-WT-17
- [x] 모든 story의 Independent, Negotiable, Valuable, Estimable, Small, Testable 검증
- [x] 요구사항 누락·P2 혼입·중복 story 검증
- [x] Markdown·링크·표·특수문자 content validation
- [x] PBT Partial 적용성 기록: User Stories 단계 직접 규칙은 N/A, 후속 testable boundary 추적
- [x] 생성 산출물 검토 질문 작성
- [x] 생성 산출물 명시적 승인: Q1 B, “승인 후 진행”

## 필수 산출물

- [x] `aidlc-docs/inception/user-stories/worktree-integration-stories.md`
- [x] `aidlc-docs/inception/user-stories/worktree-integration-personas.md`
- [x] 모든 story에 INVEST 검증 결과와 acceptance criteria 포함
- [x] 모든 persona를 관련 story에 mapping

## 범위 보호

- 구현 task, schema 세부 설계, 개발 일정과 sprint 배정은 Story 단계에서 결정하지 않는다.
- P2의 전체 checkpoint rollback, 파일별 drift 병합, 고급 quota·retention과 추가 harness는 이번 story backlog에서 제외하고 deferred 표에만 남긴다.
- 사용자 가치가 없는 내부 리팩터링은 story로 만들지 않고 후속 설계·코드 계획에서 다룬다.
