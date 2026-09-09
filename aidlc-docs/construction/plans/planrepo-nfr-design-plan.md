# PlanRepo NFR Design 작성 계획

버전은 0.1이며 **산출물 승인 완료**입니다. 사용자 응답 “진행하자”로 NFR Requirements 산출물 0.1을 승인받았습니다. 원자성·AI 실행은 Comprehensive, 나머지는 Standard 깊이로 설계합니다. 이번 승인은 설계 작성의 진행 승인입니다.

## 1. 입력과 산출물

`.aidlc-rule-details/construction/nfr-design.md`를 따릅니다. `aidlc-docs/construction/planrepo/nfr-requirements/nfr-requirements.md`의 NQ-01부터 NQ-24, `aidlc-docs/construction/planrepo/nfr-requirements/tech-stack-decisions.md`의 TECH-01부터 TECH-11을 입력으로 사용합니다. 승인된 Functional Design과 Application Design의 9개 구성요소·50개 논리 메서드·단일 UOW-01을 유지합니다.

산출물은 `aidlc-docs/construction/planrepo/nfr-design/nfr-design-patterns.md`와 `aidlc-docs/construction/planrepo/nfr-design/logical-components.md`입니다. 저장·충돌·조회·실행·종료·복구·표시 패턴과 협력 책임을 구체화합니다. 실제 디렉터리·실행 명령·프로세스 매핑은 Infrastructure Design에서 정합니다. 앱 코드·패키지 설치·인증 변경·실제 Claude 호출은 이번 단계에 포함하지 않습니다.

Superpowers brainstorming의 설계 비교·자기 검토와 verification-before-completion의 실제 검증 원칙을 적용합니다. 프로젝트 AI-DLC 규칙의 산출물 위치·단계 승인 절차를 우선합니다. 제품 범위·스택은 승인됐으므로 같은 질문을 반복하지 않습니다.

## 2. 질문 영역 평가

| 영역 | 근거와 설계 판단 |
|---|---|
| 복구 패턴 | NQ-05·06·08·16·21에서 확정 보존·첫 terminal 승자·새 Run 재시도를 승인받았습니다. 자동 모델 재시도 없이 영속 작업·종료 관찰·중단 판정을 설계합니다. 원 실행이 끝났다는 신뢰 근거 없이 슬롯을 해제하지 않습니다. |
| 확장 패턴 | NQ-01·14의 로컬 한 팀·5 context·1 실행·10 nonterminal 범위를 유지합니다. 브로커·다중 서버를 추가하지 않고 같은 DB의 원자적 용량 검사로 경쟁을 제어합니다. |
| 성능 패턴 | NQ-02·03·04·17의 승인 목표에 맞춰 짧은 트랜잭션·제한 조회·지연 로딩·바이트 제한을 설계합니다. 측정 전 성능을 달성했다고 가정하지 않습니다. |
| 보안 패턴 | NQ-10·11·19·22의 현재 행동 권한·안전한 표시·제한 CLI·진단 비노출을 구체화합니다. 비활성 확장·조직 인증을 추가하지 않습니다. 실제 정책 효과는 후속 가상 자료 검증으로 확인합니다. |
| 논리 구성요소 | 기존 C-01부터 C-09의 책임 안에서 저장 포트·작업 루프·provider·표현·runtime의 협력을 분리합니다. 새 배포 서비스·공개 업무 메서드는 만들지 않습니다. |

새 사용자 답변 없이는 결정할 수 없는 제품 범위의 모호함은 없습니다. 저장 모드·복구 프로토콜·도구 제한의 대안과 선택 근거를 문서로 제시합니다. 실제 설치 환경에서 확인해야 할 기술 조건은 구현 검증 항목으로 남기며 지원된다고 추정하지 않습니다. 환경 변경 승인이 필요하면 실제 원인과 변경안을 먼저 제시합니다. 추가 질문은 현재 대화에서 받는 기존 방식을 유지합니다.

## 3. 실행 계획

- [x] 사용자 원문·NFR Requirements 승인을 기록하고 상태를 NFR Design으로 전환했습니다.
- [x] 단계·공통 규칙·승인 문서와 질문 영역 다섯 가지를 확인했습니다.
- [x] SQLite·프로세스·CLI의 공식 근거와 대안을 확인하고 실행 검증이 필요한 조건을 구분했습니다.
- [x] `aidlc-docs/construction/planrepo/nfr-design/nfr-design-patterns.md`에 설계 패턴 14개·품질 기준 24개의 추적·검증 경계 사례 16개를 작성했습니다.
- [x] `aidlc-docs/construction/planrepo/nfr-design/logical-components.md`에 논리 책임 12개·기존 모듈 9개·공개 44개/내부 6개 메서드·NQ별 검증 책임을 작성했습니다.
- [x] 독립 검토로 업무 불변식·동시성·복구·추적을 확인했습니다. 같은 화면의 조회 응답 역전과 양쪽 출력 종료 선행 조건을 보정하고 재확인했습니다.
- [x] Markdown·JSON·표·ND/LC/NQ/NT 추적·9모듈·50메서드·프로젝트 내부 참조·승인 입력 18개의 보존을 검증했습니다.
- [x] 계획·상태·시작 안내·감사 기록을 갱신하고 검토 가능한 두 산출물의 승인 요청을 준비했습니다.
- [x] 사용자 응답 “어 진행해도될거같아”를 2026-09-08T15:50:03Z에 기록하고 NFR Design 산출물 0.1을 승인받았습니다.

## 4. 검증과 승인

파일 저장 전에 Markdown 파싱·표 구조·특수 문자를 확인합니다. 설계에는 복잡한 도식 대신 단계별 텍스트와 표를 사용합니다. 기존 실행 계획 Mermaid는 제한된 문법·노드·연결·현재 상태를 확인합니다. 문서를 별도 경로에 복사해 내부 참조를 검사하고 승인된 요구사항·스토리·기능 설계의 보존을 확인합니다. 정확한 명령·결과·실패·생략한 실행 검증은 `aidlc-docs/audit.md`에 추가합니다.

Security Baseline·Resiliency Baseline·PBT는 비활성으로 개별 규칙은 N/A입니다. opt-in 3개만 확인하고 전체 규칙은 읽지 않습니다. opt-in 없는 강제 확장은 없습니다. 기본 제품 NFR과 이후 구현의 TDD는 유지합니다.

검토 가능한 두 문서를 작성·검증한 뒤 변경 요청 또는 Infrastructure Design 진행을 제시합니다. 단계 규칙 Step 8에 따라 산출물 승인 전 Infrastructure Design을 시작하지 않습니다.
