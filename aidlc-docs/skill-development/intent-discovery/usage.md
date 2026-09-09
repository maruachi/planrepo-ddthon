# intent-discovery 사용 안내

AI-DLC 시작 전에 사람의 목적·범위·기대 행동을 반복 인터뷰로 구체화합니다. 사용자가 확인한 의도와 미결정을 문서로 남깁니다. 스킬 원본은 `aidlc-docs/skill-development/intent-discovery/skill/SKILL.md`입니다.

## 새 아이디어로 시작하기

대화에서 다음처럼 요청합니다.

> $intent-discovery로 이 아이디어를 AI-DLC에 넘기기 전에 내 의도가 충분히 구체화될 때까지 질문해 주세요. 아이디어는 …입니다.

스킬은 현재 이해와 확인 전 해석을 구분하고 중요한 공백부터 묻습니다. 실제 답변을 받아 내용을 갱신합니다. 정해진 질문 횟수나 AI의 확신 점수로 종료하지 않습니다.

## 중단·재개·인계

- 잠시 멈출 때는 “오늘은 여기서 멈추고 남은 질문을 보관해 주세요”라고 요청합니다.
- 미결정이 있어도 넘길 때는 “미정인 항목을 표시하고 현재 내용으로 인계해 주세요”라고 요청합니다. 잠정 인계로 기록합니다.
- 다시 시작할 때는 기존 의도서와 함께 “이 기록에서 이어서 질문해 주세요”라고 요청합니다.
- 현재 요약이 맞으면 “이 버전이 제 의도와 맞습니다. AI-DLC 입력으로 넘겨 주세요”라고 확인합니다.

기본 기록 경로는 프로젝트 루트 기준 `aidlc-docs/pre-inception/<topic>/intent-brief.md`입니다. 프로젝트의 문서 규칙과 사용자가 지정한 위치가 우선합니다. 원문·출처, 의도 ID, 구체 장면, 미결정, 위임 범위, 확인 버전과 재개 지점을 기록합니다.

## Inception에서 다시 사용하기

기존 의도서와 현재 산출물을 제공하고 다음처럼 요청합니다.

> $intent-discovery로 이번 설계에서 새로 생긴 해석과 기존 의도가 어긋나는 부분을 맞춰 주세요. 이미 확인한 목적과 범위는 유지해 주세요.

Requirements Analysis에서는 동기·범위·기대 결과를, User Stories에서는 실제 행동과 예외를 확인합니다. Workflow Planning에서는 단계·우선순위와 선택 영향을 확인합니다. Application Design과 Units Generation에서는 처리 방식과 분해 결과가 기존 의도를 보존하는지 확인합니다.

## AI-DLC와의 연결

스킬의 의도서 확인은 AI-DLC의 요구사항·설계·구현 계획 승인이 아닙니다. 새 AI-DLC v1.0.1은 원본 시작 절차인 Workspace Detection을 거쳐 필요한 기존 시스템 분석과 Requirements Analysis로 진행합니다. 이미 진행 중이면 현재 단계와 새 의도 차이를 인계합니다.

이번 패키지는 독립 스킬입니다. 기존 프로젝트의 `AGENTS.md`, AI-DLC 원본 규칙과 제품 코드를 변경하지 않습니다. 개인 스킬 설치는 발견 가능한 위치에 파일을 두는 것이며 모든 개발 요청의 자동 실행 순서를 강제로 바꾸는 설정이 아닙니다.

특정 프로젝트에서 사전 인터뷰를 자동으로 먼저 실행하려면 그 프로젝트의 진입 규칙에 적용 범위를 명시해야 합니다. 예를 들어 “사용자가 새 아이디어의 사전 구체화를 요청하면 intent-discovery를 먼저 적용하고, 인계 후 AI-DLC의 시작 또는 재개 절차를 따른다”는 규칙을 둘 수 있습니다. 기존의 명확한 구현 요청까지 다시 인터뷰하도록 확대하지 않습니다.

## 검증 자료

계획은 `aidlc-docs/skill-development/intent-discovery/plan.md`, 대조군 검토는 `aidlc-docs/skill-development/intent-discovery/tests/baseline-review.md`, 적용 전후 비교는 `aidlc-docs/skill-development/intent-discovery/tests/comparison.md`에 있습니다. 각 대화의 원문과 출력은 `aidlc-docs/skill-development/intent-discovery/tests/`에 보존합니다. 최종 검증 결과는 `aidlc-docs/skill-development/intent-discovery/verification.md`에 기록합니다.

MRBS와 테이블오더는 절차 검토 사례입니다. 실제 사례 서비스를 개발하거나 사례의 정책을 다른 프로젝트에 자동 적용하지 않습니다.
