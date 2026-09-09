# AI-DLC v1.0.1과 intent-discovery 비교

검토일은 2026-09-09입니다. 반복 질문과 요구사항 정제는 기존 AI-DLC와 크게 겹칩니다. 현재 스킬은 의도 항목의 출처·해석 지위·확인 범위·미결정 인계를 더 구체적으로 규정합니다. 이 문서는 원문 규칙의 비교이며 AI-DLC 대비 성능 우위를 입증하는 실험 결과가 아닙니다.

## 비교 대상

- AI-DLC는 사용자가 지정한 v1.0.1의 Requirements Analysis, Question Format Guide, Session Continuity, Workflow Changes, User Stories와 핵심 워크플로우를 확인했습니다.
- 스킬 원본은 `aidlc-docs/skill-development/intent-discovery/skill/SKILL.md`입니다. 사용 안내와 기존 검증 기록도 대조했습니다.
- root의 검토와 별도 에이전트의 읽기 전용 검토를 종합했습니다.

## 기존 AI-DLC에 있는 기능

| 기능 | 원문 근거 | 판단 |
|---|---|---|
| 의도·목표·성공 기준·예외 파악 | Requirements Analysis Steps 2, 5 | 기존 기능입니다. |
| 답변을 분석하고 모호함이 해소될 때까지 후속 질문 | Requirements Analysis Step 6 | 기존 기능입니다. |
| 모순과 근거 없는 가정 확인 | Question Format Guide의 Contradiction and Ambiguity Detection | 기존 기능입니다. |
| 이전 상태·질문·문서를 읽고 재개 | Session Continuity | 기존 기능입니다. |
| 중단·재개·이전 단계 수정·영향 분석 | Workflow Changes | 기존 기능입니다. |
| Inception 후속 단계에서 추가 질문 | User Stories Steps 3, 9, 10 | 기존 기능입니다. |

Requirements Analysis는 기능과 NFR뿐 아니라 사업 목표, 성공 기준, 사용자 장면과 예외를 점검합니다. Step 6은 답변 재검토와 반복 질문을 명시합니다. 사용자가 진행을 요청하는 예외 문구와 함께, 실제 답변을 받아 검증한 뒤 요구사항을 작성하는 gate도 둡니다. 따라서 사전 인터뷰의 잠정 인계를 공식 단계 승인으로 취급해서는 안 됩니다. [Requirements Analysis 원문](https://github.com/awslabs/aidlc-workflows/blob/v1.0.1/aidlc-rules/aws-aidlc-rule-details/inception/requirements-analysis.md)

Question Format Guide는 모순을 찾고 원 질문을 참조해 추가 확인하도록 합니다. 질문은 파일로 받는 방식입니다. 현재 스킬은 대화 인터뷰를 기본으로 지원하지만, 이 프로젝트는 이미 대화 응답을 허용하므로 프로젝트 안에서의 추가 차이는 작습니다. [Question Format Guide 원문](https://github.com/awslabs/aidlc-workflows/blob/v1.0.1/aidlc-rules/aws-aidlc-rule-details/common/question-format-guide.md)

재개와 변경 관리도 원본에 있습니다. 단계·산출물의 상태와 이력을 보존하는 기능 자체를 스킬의 독자 기능이라고 주장할 수 없습니다. [Session Continuity 원문](https://github.com/awslabs/aidlc-workflows/blob/v1.0.1/aidlc-rules/aws-aidlc-rule-details/common/session-continuity.md), [Workflow Changes 원문](https://github.com/awslabs/aidlc-workflows/blob/v1.0.1/aidlc-rules/aws-aidlc-rule-details/common/workflow-changes.md)

User Stories에서도 동기·성공 지표를 묻고 모순·모호함·가정을 재검토합니다. 사람과 생각을 맞추는 과정이 Requirements Analysis에서만 일어난다는 설명도 부정확합니다. [User Stories 원문](https://github.com/awslabs/aidlc-workflows/blob/v1.0.1/aidlc-rules/aws-aidlc-rule-details/inception/user-stories.md)

## 현재 스킬이 더 구체화한 부분

1. 의도 항목 ID를 사용자 원문 출처와 연결합니다. 사용자 명시, 확인된 해석, AI 제안, 위임된 선택, 미결정을 구분합니다. AI-DLC에도 일반적인 traceability와 감사 기록은 있지만, 확인한 문서에서는 이 분류를 모든 의도 항목의 필수 형식으로 규정하지 않습니다.
2. 누가 어느 버전의 어떤 범위를 어떤 말로 확인했는지 기록합니다. 의미 변경에 이전 확인을 재사용하지 않도록 명시합니다. 이는 기존 단계 승인과 변경 관리의 근거를 더 세밀하게 남기는 방식입니다.
3. 탐색, 확인 대기, 확인 완료, 중단, 잠정 인계를 구분합니다. 미결정의 담당·확인 방법·후속 단계를 남깁니다. 질문 중단과 내용 확인을 분리합니다.
4. AI-DLC 진입 전 선택적 인터뷰로 사용할 수 있습니다. Inception에서는 새 해석이나 충돌이 생긴 부분에 재진입합니다. 기존 요구사항·설계·구현 승인을 자동으로 변경하지 않습니다.

현재 스킬은 독자적인 요구사항 분석 방법론보다 의도 기록과 인계 규칙을 강화한 보완 도구에 가깝습니다. 모든 개발 요청 앞에 동일한 인터뷰를 추가하면 중복 질문과 문서 동기화 부담이 생길 수 있습니다.

## 현재 구현과 향후 제안의 경계

현재 구현에는 의도서 작성·재개·확인 근거 보존과 Inception 재진입 지침이 있습니다. 모든 요구사항·스토리·설계 문장을 원래 의도와 연결해 자동 검사하는 기능은 아직 없습니다. 공식 Requirements Analysis가 사전 의도서를 반드시 읽고 중복 질문을 건너뛰도록 하는 자동 연결도 설치만으로 적용되지 않습니다.

확장한다면 요구사항과 설계 문장마다 연결된 의도·사용자 근거를 검토하는 절차가 핵심입니다. 누락, 근거 없는 추가, 의미 변경을 구분하고, 사람의 선택이 필요한 차이만 질문하도록 설계하는 편이 목적에 맞습니다. 이 문단은 제안이며 구현 완료를 뜻하지 않습니다.

MRBS 사례의 “회의실 담당자는 자기 회의실 예약만 승인하고 시스템 관리 권한은 받지 않는다”를 예로 들 수 있습니다. 후속 설계에 전체 회의실 관리 권한이 추가되면 기존 의도와 충돌합니다. 부재 대행 정책을 AI가 추가했다면 사용자 확인 여부를 따로 살펴야 합니다. MRBS와 테이블오더는 이 절차를 검증하는 사례이며 실제 개발 대상으로 취급하지 않습니다.

## 플러그인에 대한 판단

여러 프로젝트에서 같은 절차를 재사용하거나 팀에 공유하려면 플러그인으로 묶을 실익이 있습니다. 첫 구성은 기존 스킬 하나와 필요한 의도서 양식·AI-DLC 연결 안내를 묶는 정도가 적절합니다. 평가 사례와 검증 기록은 패키지 소스에서 함께 관리할 수 있습니다. 기능을 억지로 여러 스킬로 나누거나 외부 서버를 추가할 근거는 아직 없습니다.

플러그인은 설치·공유 단위입니다. 포장만으로 질문 품질이 향상되거나 AI-DLC 실행 순서가 바뀌지는 않습니다. 공식 문서도 개인 워크플로우를 다듬는 동안에는 스킬로 시작하고, 공유·관련 스킬 묶음·팀 배포가 필요하면 플러그인으로 만들도록 안내합니다. [OpenAI 플러그인 작성 문서](https://learn.chatgpt.com/docs/build-plugins)

차별화 목표는 사용자 의도가 요구사항과 설계에 어떻게 반영됐는지 확인하는 데 둡니다. 사전 탐색은 선택적으로 사용하고, 이후 AI-DLC에서 확인한 의도를 이어받는 방식이 적절합니다.

## 검증 근거와 남은 확인

기존 `aidlc-docs/skill-development/intent-discovery/tests/comparison.md`의 3/5와 5/5는 스킬 없는 대조군과 스킬 적용군의 사례 비교입니다. 대조군에 AI-DLC 원본 규칙 전체를 적용한 실험이 아닙니다. AI-DLC 대비 개선 수치로 사용할 수 없습니다.

후속 비교에서는 같은 MRBS·테이블오더 입력과 사용자 응답 조건으로 AI-DLC 원본만 적용한 경우와 보완 스킬을 함께 적용한 경우를 비교해야 합니다. 사용자 의도 누락, 근거 없는 정책 추가, 확인 범위 확대, 중복 질문, 출처를 따라 검토할 수 있는지를 평가합니다. 질문 개수나 AI의 확신 점수로 완벽을 판정하지 않습니다.

이번 검토는 원문 비교와 독립 검토만 진행했습니다. 새로운 행동 실험, 제품 테스트, 플러그인 생성·설치와 기존 스킬 변경은 하지 않았습니다. 비교 문서는 저장 전 Markdown 파싱을 확인하며, 저장 후 참조 경로와 원문 일치를 검사합니다.
