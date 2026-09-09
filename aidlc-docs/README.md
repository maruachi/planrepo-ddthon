# PlanRepo 프로젝트 시작 안내

이 프로젝트 폴더의 자산만으로 요구사항 검토와 AI-DLC 진행을 재개할 수 있습니다. 모든 문서 경로는 프로젝트 루트에서 해석합니다. 상위 폴더 탐색이나 개인 홈 경로를 전제로 하지 않습니다.

## 현재 Inception 프로토타입 안내

현재 사용자 화면은 하나의 SR에 올린 초안 원문을 **Inception Plan**으로 읽고, 다듬고, 검토하는 문서 중심 흐름에 집중합니다. 사용자는 내용을 **문서**, **요약·시각화**, **공유·리뷰** 세 탭에서 이어서 보고, 현재 문서 버전을 동료와 검토합니다.

하나의 원문 문서만으로도 공식 문서 검토를 시작하고 승인할 수 있습니다. 요구사항, 사용자 시나리오, 진행 계획, 주요 구조, 주요 결정, 작업 단위는 완전한 Plan 예시의 구성입니다. 모든 사용자가 여섯 문서를 따로 작성해야 하는 요건은 아닙니다.

작성자는 의도와 중요한 업무 결정을 확인하고, AI가 제안한 내용 변경을 반영할지 선택합니다. 검토자는 실제로 차단해야 할 수정 요청을 남기고 현재 문서를 최종 승인합니다. 시스템은 문서 구조와 관련 내용을 연결하고, AI 참고 추천을 표시하며, 문서 버전과 검토 이력을 관리합니다.

AI의 질문에 모두 답하거나, 근거를 별도 칸에 다시 입력하거나, 답변이 문서에 반영됐다는 확인 명령을 수행하는 일은 필수가 아닙니다. AI 질문과 근거는 문서 검토를 돕는 참고 정보입니다. 사용자는 원문을 직접 수정하거나 선택한 AI 제안만 반영한 뒤 문서 리뷰로 이동할 수 있습니다.

이번 프로토타입 UI에는 Construction, 코드 생성, 실행, 배포 흐름이 없습니다. 화면의 검토와 승인은 현재 Inception Plan 버전에만 적용됩니다. 아래의 승인된 전체 요구사항·설계·구현 자산은 후속 범위를 위해 그대로 유지합니다.

완전한 예시의 여섯 문단은 새 저장 스키마나 서로 독립된 여섯 Artifact가 아닙니다. 기존 `requirements` ArtifactVersion의 H2 section을 한 버전으로 표시합니다. 요약은 현재 Markdown heading과 명시된 내용을 바탕으로 보여 줍니다. AI가 원문 인용을 포함한 시각화 자료를 작성하면 상황별 흐름과 화면도 제공합니다. 인용의 유효성을 검사하지만 의미의 정확성을 자동 보증하지 않으므로 원문 ArtifactVersion을 함께 검토해야 합니다.

예시를 처음부터 읽으려면 `aidlc-docs/examples/delivery-cancel/README.md`에서 SR 원문, 한 Plan의 문단별 학습 자료, 로컬 앱에서 실행한 검토·승인 결과를 확인합니다. 이 결과는 하나의 사용자가 가상 역할을 바꾸어 가며 진행한 시연으로, 실제 직원 검토나 실제 주문 처리를 증명하지 않습니다.

일반 로컬 실행은 화면과 API를 같은 Fastify 서버의 단일 origin에서 제공하도록 설계했습니다. 빌드와 준비 절차를 실제로 마친 실행은 `http://127.0.0.1:4173`에서 엽니다. 2026-09-09에 새 빌드의 readiness와 화면을 확인했고 사용자 서버를 실행 상태로 유지했습니다. 정확한 명령·결과·생략 범위는 aidlc-docs/construction/planrepo/code/inception-prototype-report.md에 있습니다. Claude 연결은 브라우저가 CLI를 직접 실행하는 방식이 아니라 서버의 교체 가능한 provider adapter를 거칩니다. 기존 실행 제한, 권한, 저장, 검토 guard는 유지합니다.

## 1. 시작 순서

1. 프로젝트 루트의 `AGENTS.md`를 읽습니다.
2. `aidlc-docs/aidlc-state.md`에서 현재 단계·승인 상태·확장 설정을 확인합니다.
3. `aidlc-docs/inception/requirements/requirements.md`의 제품 요구사항 0.4를 읽습니다.
4. 검토 사례가 필요하면 `aidlc-docs/inception/requirements/reference-context.md`를 읽습니다.
5. 승인된 `aidlc-docs/inception/user-stories/stories.md`와 `aidlc-docs/inception/user-stories/personas.md`를 읽습니다.
6. `aidlc-docs/inception/plans/execution-plan.md`에서 실행할 단계·깊이·검증 순서를 확인합니다.
7. `aidlc-docs/inception/application-design/application-design.md`에서 승인된 설계 0.1과 상세 문서 안내를 읽습니다.
8. `aidlc-docs/inception/plans/unit-of-work-plan.md`에서 승인된 단위 분해안·코드 조직·생성 절차를 읽습니다.
9. `aidlc-docs/inception/application-design/unit-of-work.md`와 연결된 의존 관계·스토리 배정 문서에서 승인된 단위 산출물 0.1을 검토합니다.
10. `aidlc-docs/construction/plans/planrepo-functional-design-plan.md`와 `aidlc-docs/construction/planrepo/functional-design/`의 문서 네 개에서 승인된 상세 기능 설계를 읽습니다.
11. `aidlc-docs/construction/plans/planrepo-nfr-requirements-plan.md`와 `aidlc-docs/construction/planrepo/nfr-requirements/nfr-requirements.md`, `aidlc-docs/construction/planrepo/nfr-requirements/tech-stack-decisions.md`에서 승인된 품질 기준·기술 선택을 읽습니다.
12. `aidlc-docs/construction/plans/planrepo-nfr-design-plan.md`와 `aidlc-docs/construction/planrepo/nfr-design/nfr-design-patterns.md`, `aidlc-docs/construction/planrepo/nfr-design/logical-components.md`에서 승인된 설계 패턴·논리 책임을 읽습니다.

13. `aidlc-docs/construction/plans/planrepo-infrastructure-design-plan.md`와 `aidlc-docs/construction/planrepo/infrastructure-design/infrastructure-design.md`, `aidlc-docs/construction/planrepo/infrastructure-design/deployment-architecture.md`에서 승인된 실행·저장·설정·복구 구조를 검토합니다.

14. `aidlc-docs/construction/plans/planrepo-code-generation-plan.md`에서 승인된 전체 구현 계획 0.1의 28개 과제·168개 단계와 스토리별 완료 기준을 검토합니다.

## 2. 현재 상태와 다음 행동

요구사항 0.4, 스토리·페르소나, 실행 계획, Application Design과 단위 산출물 0.1을 승인받았습니다. 개발 단위는 UOW-01 하나이며 내부 구현을 여섯 묶음으로 진행합니다. Functional Design 산출물 0.1도 승인받았습니다. NFR Requirements 산출물 0.1도 승인받았습니다. NFR Design 산출물 0.1도 승인받았습니다. Infrastructure Design 산출물 0.1 두 개도 승인받았습니다. 현재는 Code Generation Part 2 구현 중입니다. 사용자 응답 “응 진행하도록”으로 `aidlc-docs/construction/plans/planrepo-code-generation-plan.md`의 전체 계획 0.1과 28개 과제의 생성 순서를 승인받았습니다. 인프라 결정 10개·명령 계약 12개와 모듈의 로컬 배치를 작성·검증했습니다. 설계 패턴 14개·논리 책임 12개·품질 기준 24개 연결과 경계 검증 사례 16개를 작성·검증했습니다. 세부 품질 조건 24개·기술 결정 11개를 작성·검증했습니다. 엔티티 35개·업무 규칙 32개·처리 흐름 12개·시나리오 24개·UI 26개를 작성·검증했습니다. 메서드 50개와 스토리 34개·개별 기준 122개를 연결했습니다. 추가 질문과 승인 응답은 현재 대화에서 받습니다.

`.aidlc-rule-details/inception/user-stories.md`의 계획과 산출물 승인을 마쳤습니다. 실행 계획 승인을 마쳤고 `.aidlc-rule-details/inception/application-design.md`에 따라 설계 산출물 5개와 계획의 검증을 마쳤습니다. 설계 산출물도 승인받았습니다. Units Generation의 계획·산출물 승인도 마쳤습니다. `.aidlc-rule-details/construction/functional-design.md` Step 8에 따라 기능 설계를 승인받았습니다. `.aidlc-rule-details/construction/nfr-requirements.md` Step 8에 따라 품질 기준·기술 선택을 승인받았습니다. `.aidlc-rule-details/construction/nfr-design.md` Step 8에 따라 NFR Design 산출물을 승인받았습니다. Infrastructure Design을 작성·검증하고 승인받았습니다. `.aidlc-rule-details/construction/code-generation.md` Part 1에 따라 전체 상세 구현 계획을 작성·검토·검증했습니다. 전체 계획 승인을 받았습니다. 현재 TDD 구현을 진행하고, Code Generation 검증 뒤 Build and Test로 이어갑니다.

Security Baseline, Resiliency Baseline, PBT 확장은 모두 비활성화 상태입니다. 확장 전체 규칙을 읽거나 적용하지 않습니다. 제품 요구사항의 권한·저장·충돌 방지·표시 안전성과 행동 변경의 TDD는 유지합니다.

## 3. 자산의 역할

| 경로 | 역할 |
|---|---|
| `aidlc-docs/inception/requirements/requirements.md` | 자체 완결 제품 요구사항입니다. |
| `aidlc-docs/inception/plans/user-stories-assessment.md` | User Stories의 실행 필요성과 추가 확인 판단입니다. |
| `aidlc-docs/inception/plans/story-generation-plan.md` | 스토리 작성 방식과 승인·생성·검증 체크리스트입니다. |
| `aidlc-docs/inception/plans/execution-plan.md` | 실행 단계·깊이·위험·검증 순서와 승인 상태입니다. |
| `aidlc-docs/inception/plans/application-design-plan.md` | 설계 작성·질문 평가·검토·검증·승인 체크리스트입니다. |
| `aidlc-docs/inception/plans/unit-of-work-plan.md` | 단위 분해안·모듈 배치·구현 순서·스토리 검증 책임과 산출물 생성 계획입니다. |
| `aidlc-docs/inception/application-design/unit-of-work.md` | UOW-01의 책임·모듈·코드 조직·구현 순서·완료 조건·후속 설계 인계입니다. |
| `aidlc-docs/inception/application-design/unit-of-work-dependency.md` | 단위 행렬·내부 모듈 의존·구현 묶음 선행 계약과 시스템 전제입니다. |
| `aidlc-docs/inception/application-design/unit-of-work-story-map.md` | 스토리 34개·개별 기준 122개·공통 기준·NFR의 검증 책임입니다. |
| `aidlc-docs/construction/plans/planrepo-code-generation-plan.md` | 파일·계약·선행 순서·실패/통과 테스트·스토리 완료 추적을 담은 승인된 구현 계획입니다. |
| `aidlc-docs/construction/plans/planrepo-infrastructure-design-plan.md` | 로컬 환경 매핑·독립 검토·검증·승인 체크리스트입니다. |
| `aidlc-docs/construction/planrepo/infrastructure-design/infrastructure-design.md` | 경로·설정·SQLite 수명·Claude 프로파일·OS 관찰·준비/종료·명령 계약입니다. |
| `aidlc-docs/construction/planrepo/infrastructure-design/deployment-architecture.md` | 일반/개발 프로세스·포트·9개 모듈 배치·요청 흐름·실패 경계입니다. |
| `aidlc-docs/construction/plans/planrepo-functional-design-plan.md` | 기능 설계 작성·검토·검증·승인 체크리스트입니다. |
| `aidlc-docs/construction/plans/planrepo-nfr-design-plan.md` | 설계 패턴·논리 책임의 작성·검토·검증·승인 체크리스트입니다. |
| `aidlc-docs/construction/planrepo/nfr-design/nfr-design-patterns.md` | 원자성·동시성·복구·제한 Claude 실행·표시 패턴과 NQ 추적·검증 사례입니다. |
| `aidlc-docs/construction/planrepo/nfr-design/logical-components.md` | 기존 9모듈의 협력 책임·계약·데이터 흐름·품질 검증 책임입니다. |
| `aidlc-docs/construction/plans/planrepo-nfr-requirements-plan.md` | 품질 요구사항과 기술 선택의 작성·검증·승인 체크리스트입니다. |
| `aidlc-docs/construction/planrepo/nfr-requirements/nfr-requirements.md` | 측정 프로파일·품질 목표·제한·완료 증거와 기본 NFR 추적입니다. |
| `aidlc-docs/construction/planrepo/nfr-requirements/tech-stack-decisions.md` | 기술 선택·대안·공식 근거·호환성·후속 검증 조건입니다. |
| `aidlc-docs/construction/planrepo/functional-design/domain-entities.md` | 데이터·필드·관계·불변 버전과 현재 상태를 정의합니다. |
| `aidlc-docs/construction/planrepo/functional-design/business-rules.md` | 역할·검토·게이트·변경·AI·인계의 업무 규칙입니다. |
| `aidlc-docs/construction/planrepo/functional-design/business-logic-model.md` | 상태 전이·알고리즘·검증 시나리오와 스토리 추적입니다. |
| `aidlc-docs/construction/planrepo/functional-design/frontend-components.md` | 화면 계층·props/state·폼·공개 계약 연결입니다. |
| `aidlc-docs/inception/application-design/application-design.md` | 통합 설계와 구성요소·메서드·서비스·의존 관계의 상세 문서 안내입니다. |
| `aidlc-docs/inception/user-stories/stories.md` | 사용자 스토리·수용 기준·추적표와 검증 흐름입니다. |
| `aidlc-docs/inception/user-stories/personas.md` | 다섯 역할의 목적·권한·스토리 연결입니다. |
| `aidlc-docs/inception/requirements/reference-context.md` | 요청·가정·미결정과 검토 장면을 담은 내부 사례입니다. |
| `aidlc-docs/inception/requirements/source-analysis.md` | 내부 자산의 적용 근거와 추적 관계입니다. |
| `aidlc-docs/inception/requirements/requirement-verification-questions.md` | 과거 질문과 답변 기록입니다. |
| `requirements/requirements.md` | 제품 입력 의도의 간단한 요약입니다. |
| `aidlc-docs/audit.md` | 단계·결정·검증의 감사 이력입니다. 과거 명령을 재실행하는 지침이 아닙니다. |
| `.aidlc-rule-details/` | 프로젝트에 포함한 단계별 규칙입니다. |

## 4. 실행 환경

제품의 첫 AI 연결은 설치된 Claude CLI입니다. 프로젝트 루트에서 다음 명령으로 확인합니다.

```sh
command -v claude
claude --version
```

CLI는 PATH로 찾고 개인 설치 경로를 고정하지 않습니다. 최초 확인 버전은 Claude Code 2.1.263이며, 이번 Inception Plan 검증에서는 설치 버전 2.1.265로 실제 호출했습니다. 기존 환경에서 global.anthropic.claude-opus-4-8의 짧은 실제 호출을 확인했습니다. provider는 Bedrock이었습니다. 이 명시 모델을 기본값으로 사용하고 provider와 model을 교체 가능한 계약으로 유지합니다. 실행 결정과 검증 범위는 aidlc-docs/construction/planrepo/code/claude-execution-decision.md에 있습니다.

기술 선택안은 현재 Node·npm을 유지하는 TypeScript·React/Vite·Fastify·SQLite 구성입니다. CG-01의 패키지 설치·경로 격리 테스트 23개·타입 검사·native SQLite·Fastify static 등록을 확인했습니다. CG-02의 공개 44개·내부 6개 메서드 계약과 독립 검토를 마쳤으며 계약 테스트 19개가 통과했습니다. CG-03 SQLite 저장 계층도 구현·검증했습니다. 독립 검토의 네 결함을 보완했고 저장 테스트 33개와 타입 검사가 통과했습니다. CG-04의 DEMO-4 시드와 CG-05의 HTTP 서버를 구현하고 독립 검토를 마쳤습니다. SR 등록·Mock 가져오기·설명 편집·보드·상세 조회를 연결했습니다. 첫 UI의 Playwright 테스트 6개, 타입 검사와 전체 빌드가 통과했습니다. SOURCE 편집과 검토·AI 생성 등 후속 기능은 구현 중입니다. 격리 DB에서 일반 실행과 개발 서버·proxy·HMR·포트 충돌 거절을 검증했습니다. 화면 응답 경합과 오류 처리의 후속 회귀 수정은 진행 중입니다. 과제별 정확한 완료 범위와 명령 결과는 aidlc-docs/construction/planrepo/code/implementation-progress.md와 각 task 보고서에 기록합니다.

인프라 설계의 일반 실행은 `http://127.0.0.1:4173`, 개발 화면은 `http://127.0.0.1:5173`입니다. 업무 DB·실행 폴더·정제 진단은 프로젝트 내부 `.planrepo/`로 계획했습니다. 최초 준비는 build·offline migration·빈 DB 시드의 순서입니다. 테스트에서는 격리 DB와 별도 loopback 포트로 실제 서버와 브라우저를 실행했습니다. 현재 체험용 서버는 포트 4173에서 실행합니다. 실행 데이터와 백업은 aidlc-docs/construction/planrepo/code/inception-prototype-report.md에 기록했습니다. 같은 boot의 비정상 종료에서 실행 identity를 확인하지 못하면 AI가 계속 차단될 수 있습니다. 비AI 준비와 생성 준비는 구분합니다.

## 5. 경로와 기록 규칙

새 문서의 파일 경로는 `aidlc-docs/` 또는 `.aidlc-rule-details/` 등 프로젝트 루트에서 시작하는 전체 경로로 적습니다. 중첩 문서 위치에 따라 해석이 달라지는 Markdown 상대 링크와 개인 경로를 쓰지 않습니다. 외부 문서가 필요한 결정은 내용을 검토해 핵심을 프로젝트 내부 자산으로 정리합니다.

새 기록은 `aidlc-docs/audit.md`에 추가합니다. 과거 기록에 포함되었던 외부 위치·참조 지시는 사용자의 명시적 요청에 따라 정리했습니다. 사용자 답변과 현재 결정은 프로젝트 안에서 확인할 수 있습니다.
