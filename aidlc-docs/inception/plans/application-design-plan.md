# PlanRepo Application Design 작성 계획

버전은 0.1이며 **사용자 승인 완료**입니다. 사용자 응답 “응 진행해”로 승인된 실행 계획의 Application Design을 수행합니다. 이 계획은 설계 작성 절차이며 애플리케이션 구현 계획은 아닙니다.

## 1. 입력과 목표

입력은 프로젝트 루트의 `aidlc-docs/inception/requirements/requirements.md`, `aidlc-docs/inception/user-stories/stories.md`, `aidlc-docs/inception/user-stories/personas.md`, `aidlc-docs/inception/plans/execution-plan.md`입니다. 규칙은 `.aidlc-rule-details/inception/application-design.md`를 적용합니다.

다섯 역할과 34개 스토리를 구성요소·메서드·서비스·저장 경계에 연결합니다. 실제 Claude는 공통 생성 계약으로 연결하며 승인·버전·업무 저장에 직접 접근하지 않게 합니다. 상세 상태 전이·DB 스키마·잠금 알고리즘·CLI 제한 수치·프레임워크 선정은 이후 해당 설계 단계에서 구체화합니다.

## 2. 추가 질문 필요성 평가

| 확인 영역 | 이미 정해진 조건과 이번 설계의 처리 |
|---|---|
| 구성요소 | 새 로컬 기능 데모, 한 팀·프로젝트, 실제 저장·승인과 제한된 Claude 생성입니다. 역할별 책임을 가진 모듈형 앱을 제안합니다. |
| 메서드 | 스토리의 사용자 행동·버전·역할·거절 기준이 정해져 있습니다. 언어 중립의 입력·출력 계약으로 정리합니다. |
| 서비스 | 답변·해결·결정·수정 반영·확인·개별 승인·전환을 분리해야 합니다. 관련 변경은 같은 저장 경계에서 처리합니다. |
| 의존 관계 | 외부 조회는 Mock이며 실제 AI는 설치 Claude입니다. provider 결과와 사람의 적용·승인을 분리합니다. |
| 패턴·기술 제약 | 강제 기술 표준이 없고 로컬 실행을 우선하기로 답변받았습니다. 구조 대안은 이번 산출물에서 비교하고 스택은 NFR Requirements에서 확정합니다. |

새 업무 범위 질문은 없습니다. 기존 답변을 새로 작성하거나 추가 승인으로 위장하지 않습니다. 실행 계획의 설계 진행 승인 범위에서 구체적인 설계안을 작성합니다. API 경로·프레임워크·DB 제품·프로세스 제한의 상세 값은 지금 임의 확정하지 않습니다. 모순이나 사용자 선택이 필요한 새 범위가 드러나면 대화에서 확인합니다.

## 3. 접근 방식

모듈형 단일 로컬 앱과 서비스별 별도 프로세스 구성을 비교합니다. 첫 구성을 추천합니다. 업무 변경·승인 무효화·감사 기록을 하나의 저장 경계로 묶기 쉽고, 한 팀 기능 데모의 실행 절차를 작게 유지할 수 있습니다. 외부 CLI는 별도 자식 프로세스로 실행하되 제품의 업무 모듈과 분리합니다.

설계 설명은 한국어로 쓰고 메서드·자료형 식별자는 기술 표기를 사용합니다. 문서 경로는 프로젝트 루트 기준입니다. Mermaid는 사용한 문법을 쓰기 전에 검사하고 글로 된 흐름 설명을 포함합니다.

## 4. 생성·검증 체크리스트

- [x] 실행 계획 승인 응답을 기록하고 Workflow Planning을 완료 처리했습니다.
- [x] 요구사항·스토리·페르소나·실행 계획과 Application Design 규칙을 확인했습니다.
- [x] 질문 영역 다섯 가지를 검토하고 기존 결정으로 설계안을 작성할 수 있음을 확인했습니다.
- [x] 구조 대안과 추천 근거, 설계 범위와 이후 결정할 항목을 구분했습니다.
- [x] `aidlc-docs/inception/application-design/components.md`에 구성요소·책임·소유 정보·인터페이스를 작성했습니다.
- [x] `aidlc-docs/inception/application-design/component-methods.md`에 공통 자료형·메서드 입력·출력·거절 계약을 작성했습니다.
- [x] `aidlc-docs/inception/application-design/services.md`에 서비스별 흐름·원자적 변경·비동기 실행 계약을 작성했습니다.
- [x] `aidlc-docs/inception/application-design/component-dependency.md`에 의존 행렬·통신·데이터 흐름을 작성했습니다.
- [x] `aidlc-docs/inception/application-design/application-design.md`에 설계 결정·구성·흐름·위험·스토리 추적을 통합했습니다.
- [x] 독립 검토 두 건으로 계약 문제 5종을 수정하고 재검토했습니다.
- [x] 전체 스토리·요구사항 연결, 메서드·구성요소 참조, Mermaid·Markdown·프로젝트 경로를 검증했습니다.
- [x] 상태·시작 안내·감사 기록을 맞추고 설계 산출물 승인을 요청합니다.
- [x] 사용자 응답 “응진행해”를 2026-09-08T13:49:54Z에 기록하고 Application Design을 완료 처리했습니다.

## 5. 승인과 확장

설계 산출물 0.1을 사용자에게 승인받았습니다. `.aidlc-rule-details/inception/application-design.md` Step 13에 따라 실제 설계를 검토·승인받았으며 Units Generation으로 진행합니다. Code Generation은 각 단위의 별도 구현 계획 승인 이후입니다.

Security Baseline·Resiliency Baseline·PBT는 비활성 상태이며 개별 규칙은 N/A입니다. 전체 규칙을 읽지 않습니다. 기본 NFR과 행동 변경의 TDD는 유지합니다. 이 단계에서는 앱 코드·실제 생성 호출·인증 변경·설정 변경을 하지 않습니다.
