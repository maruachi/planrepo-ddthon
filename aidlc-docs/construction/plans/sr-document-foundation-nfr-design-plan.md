# U1 NFR 설계 계획

상태: NFR 설계 산출물 2개 작성·검증 및 Q1 B 승인 완료. NFR Requirements Q1 B는 사용자 채팅 “승인 후 진행”으로 승인됐다. 이번 설계 산출물도 사용자 채팅 “승인 후 진행”으로 승인됐다.

근거: [NFR 요구사항](../sr-document-foundation/nfr-requirements/nfr-requirements.md), [기술 선택](../sr-document-foundation/nfr-requirements/tech-stack-decisions.md), [기능 처리 모델](../sr-document-foundation/functional-design/business-logic-model.md), [단위 인계](../../inception/application-design/unit-of-work-dependency.md).

## 실행 체크리스트

- [x] 1. NFR Requirements Q1 B 기록, 이전 계획 10번과 U1 단계 완료
- [x] 2. 기능·NFR·단위 계약 및 NFR Design 규칙 확인
- [x] 3. 다섯 설계 질문 범주 평가, 기존 승인과 이번 설계 결정·검증 범위 구분
- [x] 4. nfr-design-patterns.md 작성: 스키마·트랜잭션·복구·대용량·입력·화면·검증 추적
- [x] 5. logical-components.md 작성: 논리 책임·앱 조립·전송·배치·단위 인계
- [x] 6. NFR 12개 추적·참조·실패 경로·계약 변경·문서 구문과 링크 검증
- [x] 7. 검토 Q1 생성, 상태·체크박스·감사 로그 갱신 및 승인 요청
- [x] 8. 명시적 NFR Design 승인 기록 후 U1 Code Generation 계획 단계로 전환

완료한 단계는 같은 작업에서 체크한다. 코드 생성이나 패키지 설치는 이 계획에 포함하지 않는다.

## 설계 질문 범주 평가

아래 질문은 설계 검토를 위한 평가 항목이다. 답변 근거는 기존 승인 문서이며 새로운 사용자 답변을 만들어 기록하지 않는다.

| 범주 | 평가 질문 | 근거와 이번 처리 |
|---|---|---|
| Resilience Patterns | 응답 유실·잠금·저장 실패에 어떻게 회복할 것인가? | U1-NFR02/03/04/07: 원자 저장, 초안 유지, 자동 재시도 없음 승인. 커밋 확인 기록과 재조회로 구체화 |
| Scalability Patterns | 증가하는 목록·본문을 어느 경계에서 제한할 것인가? | 단일 사용자·각 본문 1 MiB 승인. 삭제 없는 커서 조회와 제한된 비교 실행을 설계; 수평 확장 제외 |
| Performance Patterns | 큰 비교와 동기 DB가 조작을 막지 않도록 어떻게 제한할 것인가? | U1-NFR05, 수치 SLA 없음. 워커·계산 중단·간략 비교·부분 화면 표시 제안, 실제 성능은 구현에서 확인 |
| Security Patterns | 본문·경로·로컬 전송의 실행 경계를 어떻게 유지할 것인가? | U1-NFR01/08/12: loopback·서버 설정·타입/용량/소속 검증·비실행 렌더링. 인증/운영 보안 확장 추가 없음 |
| Logical Components | 큐·캐시·저장·UI를 어떤 책임으로 나눌 것인가? | 한 서버/DB와 C01/02/03/04/09/10 유지. 내부 비교 워커와 요청 확인 어댑터 사용; 외부 브로커·분산 캐시 불필요 |

미결 제품 범위 질문은 없다. 설계 방식은 승인된 U1 결정 담당 범위에서 구체화하고 최종 산출물 Q1로 검토한다. 조회 페이지 기본값·워커 제한·DB 설정은 이번 설계 제안이며 기존 사용자 수치 약속이나 측정 결과가 아니다.

## 작성·검증 기준

필수 문서 2개를 작성한다. 표·일반 Markdown과 관계의 텍스트 설명을 사용하므로 Mermaid/ASCII 도형 검사는 N/A이다. 쓰기 전 표 열 수·코드/특수 문자·링크를 확인한다. 설계의 기술 동작은 공식 자료를 확인하고 해당 판단 옆에 출처를 붙인다. SQL DDL·실제 패키지 API 및 동작 검증은 승인된 Code Generation에서 수행한다.

## 확장 준수

Security Baseline, Resiliency Baseline, Property-Based Testing은 모두 Enabled No, N/A이다. 전체 규칙 로드와 적용은 생략하고 승인된 제품 NFR은 유지한다. Infrastructure Design 생략을 유지한다.

## 검증 기록

필수 문서 2개, P01–P08과 U1-NFR01–12의 추적, 표 열 수·로컬 링크를 확인했다. 복합 FK 순환의 커밋 시 검증, 동일 편집·복원·응답 유실·중복 확인·큰 비교·개발/빌드 워커 경로를 검토했다. 기존 승인된 서비스 업무 의미는 유지하고 Page/DocumentSummary/CommandContext 구체화는 검토 문서에 명시했다. SQL과 실제 패키지 조합은 아직 실행하지 않았다.

[설계 검토 Q1](../sr-document-foundation/nfr-design/nfr-design-approval-questions.md)은 사용자 채팅 “승인 후 진행”으로 B 승인됐다. 단계 1–8을 완료했으며 U1 Code Generation 계획을 작성한다.
