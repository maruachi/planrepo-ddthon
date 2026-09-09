# PlanRepo 요구사항의 근거와 자산 구성

제품 요구사항은 `aidlc-docs/inception/requirements/requirements.md` 버전 0.4에 통합했습니다. 이 문서는 어떤 내부 자산이 무엇을 설명하는지 정리합니다. 모든 경로는 프로젝트 루트 기준입니다.

## 1. 프로젝트 내부의 기준 자산

| 경로 | 내용 |
|---|---|
| `aidlc-docs/README.md` | 프로젝트 시작 순서와 재개 지점입니다. |
| `aidlc-docs/inception/requirements/requirements.md` | 제품 범위, FR·NFR·AC, 역할·게이트·화면·데이터·AI 연결의 필수 조건입니다. |
| `aidlc-docs/inception/requirements/reference-context.md` | MRBS·테이블오더의 시작 요구, 가정, 미정 결정과 검토 시나리오입니다. |
| `aidlc-docs/inception/requirements/requirement-verification-questions.md` | 답변을 수집한 질문과 사용자 답변입니다. |
| `aidlc-docs/aidlc-state.md` | 현재 단계, 확장 설정과 다음 행동입니다. |
| `.aidlc-rule-details/` | 프로젝트에 포함한 AI-DLC v1.0.1 상세 규칙입니다. |

`requirements/requirements.md`는 입력 의도를 정리한 진입 요약입니다. 세부 요구를 별도로 상속하지 않습니다. 현재 요구사항만 읽고도 제품 범위와 필수 조건을 판단할 수 있습니다.

## 2. 내부 검토 사례에서 적용한 내용

| 기준 | 제품에 반영한 내용 | 연결 |
|---|---|---|
| 사실·가정·제안을 구분합니다. | 자료 확인 상태와 AI 초안·사람의 답변·공식 결정을 구분합니다. | FR-02·04·07·09 |
| 질문으로 누락을 드러냅니다. | 질문 이유·담당자·근거·해결과 문서 반영을 추적합니다. | FR-04·05·06 |
| 변경 이유를 이해합니다. | 요구사항·결정·계획의 변경과 승인 버전을 연결합니다. | FR-08·11·13·15 |
| 사람별 다음 행동을 찾습니다. | 보드·검토함에서 차단 이유와 담당자·처리 대상을 보여줍니다. | FR-17·18 |
| 사례별 결정을 격리합니다. | SR별 질문·문서·결정·승인·AI 입력을 분리합니다. | FR-01·13·20·23, NFR-08 |

MRBS는 역할과 현재 권한, 담당자 변경·부재 정책의 미결정을 드러냅니다. 테이블오더는 한 문장의 시작 요구에서 세부 기능과 기술을 임의로 확정하지 않는 검토 흐름을 설명합니다. 구체적인 내용은 내부 참고 문서에 포함했습니다.

## 3. 답변과 추적

Q-01은 기능 데모, Q-03은 기술 표준 미지정·로컬 실행 우선, Q-06은 Jira·GitHub Mock, Q-07은 Markdown 인계, Q-08은 가상 데이터, Q-09는 SR 담당자의 분류안과 지정 결정권자의 확정으로 정리했습니다. Q-02는 대화의 후속 답변으로 설치된 Claude와 교체 가능한 AI 연결로 확정했습니다. 확장 3개는 모두 비활성화했습니다.

요구사항의 DEC-01부터 DEC-11은 질문 답변과 프로젝트 내부 자산 통합 결정을 추적합니다. FR-01부터 FR-23, NFR-01부터 NFR-08, AC-01부터 AC-19는 현재 요구사항 본문에서 정의합니다.

## 4. 워크플로우와 검증의 범위

현재 폴더에 포함된 규칙의 기준은 AI-DLC v1.0.1입니다. 기준 commit 식별자는 e49341dbeb8af82758dd85e96ed7fe9bcf38a447입니다. 초기 확인에서 공통 규칙 11개와 Workspace Detection·Requirements Analysis 규칙이 기준 버전과 일치했습니다. 이후 Requirements Analysis와 Workflow Planning의 depth-levels 링크 2개를 프로젝트 루트 표기로 바꿨습니다. 단계 내용은 유지했습니다. 규칙을 사용하기 위해 네트워크에서 다시 가져올 필요는 없습니다.

제품 요구사항 0.4는 사용자 승인을 받았습니다. 스토리·페르소나와 요구사항 추적을 검증하고 사용자 승인을 받았습니다. 실행 계획·Application Design 0.1·단위 산출물도 승인받았습니다. Functional Design 산출물 0.1도 승인받았고 NFR Requirements 산출물 0.1도 승인받았습니다. NFR Design 산출물 0.1도 승인받았습니다. Infrastructure Design 산출물 0.1을 승인받았습니다. 현재는 Code Generation Part 2 구현 중입니다. 사용자 응답 “응 진행하도록”으로 `aidlc-docs/construction/plans/planrepo-code-generation-plan.md`의 전체 계획 0.1과 28개 과제의 생성 순서를 승인받았습니다. 경로·설정·10개 환경 결정·12개 준비/실행 명령 계약은 `aidlc-docs/construction/planrepo/infrastructure-design/infrastructure-design.md`, 실행 배치는 `aidlc-docs/construction/planrepo/infrastructure-design/deployment-architecture.md`에 있습니다. CG-01의 도구·runtime 기반을 구현했고 테스트 20개·타입 검사를 통과했습니다. 기존 Claude 환경에서 global.anthropic.claude-opus-4-8의 짧은 실제 호출을 확인했습니다. 제품 빌드와 업무 생성 검증은 후속 과제에서 연결합니다. 문서 독립성은 프로젝트 파일만 별도 폴더에 복사하여 경로·필수 입력·문서 파싱을 검증합니다.
