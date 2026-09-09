# U1 NFR 요구사항 계획

상태: NFR 산출물 2개 작성·검증 및 Q1 B 승인 완료. 사용자 채팅 “승인 후 진행”을 반영했다. U1 기능 설계 Q1 B는 사용자 채팅 “승인 후 진행”으로 승인 완료했다.

근거: [요구사항](../../inception/requirements/requirements.md), [실행 계획](../../inception/plans/execution-plan.md), [단위 인계](../../inception/application-design/unit-of-work-dependency.md), [U1 도메인](../sr-document-foundation/functional-design/domain-entities.md), [업무 규칙](../sr-document-foundation/functional-design/business-rules.md), [처리 모델](../sr-document-foundation/functional-design/business-logic-model.md), [화면](../sr-document-foundation/functional-design/frontend-components.md).

## 체크리스트

- [x] 1. 기능 설계 승인 수신·기록, U1 완료 및 NFR Requirements 전환
- [x] 2. 승인된 기능 설계·NFR-01–06·단위별 인계와 제한 범위 확인
- [x] 3. 여덟 질문 범주 평가, 기존 승인·신규 기술 제안·후속 검증 구분
- [x] 4. 로컬 도구 버전·경로 및 공식 기술 문서로 호환 조건 조사
- [x] 5. 평가 계획·산출물 순서·검증 경계 작성
- [x] 6. nfr-requirements.md 작성: 비기능 기준·환경·용량·성능·보존·사용성과 검증
- [x] 7. tech-stack-decisions.md 작성: 스택·저장·실행·대안·근거·구현 확인 항목
- [x] 8. 두 산출물의 원본 추적·기능 계약·호환 근거·문서 구문·확장 준수 검증
- [x] 9. 검토 질문·상태·감사 로그 갱신 후 NFR 산출물 승인 요청
- [x] 10. 명시적 NFR 산출물 승인 수신·기록 후 U1 NFR Design으로 전환

각 단계 완료 즉시 체크박스를 갱신한다. 문서는 construction/sr-document-foundation/nfr-requirements/에 생성한다. 승인된 기존 기능·단위 분해는 재질문하지 않는다.

## 질문 범주 평가

| 범주 | 기존 근거 | 이번 처리·추가 입력 판단 |
|---|---|---|
| Scalability | NFR-02 로컬 단일 사용자, 다중 사용자 제외 | 단일 서버/DB. 임의 동시 사용자 목표를 추가하지 않음 |
| Performance | NFR-03 사용성, 수치 SLA 미합의 | 응답 상태·큰 비교 처리·검증용 입력과 지원 상한을 명시적 제안으로 작성 |
| Availability | 운영 배포·HA·RTO/RPO 범위 제외 | 앱 재시작 후 저장 재열람과 장애 표시 요구만 유지 |
| Security | 로그인 없음, 보안 확장 Disabled, 본문은 데이터라는 승인 설계 | loopback 실행·본문 렌더링·입력 검증으로 기존 경계 구체화. 확장을 다시 켜지 않음 |
| Tech Stack | 기존 코드/기술 선호 제약 없음, U1에서 공통 선택하기로 승인 | 설치된 Node 24/npm을 활용할 구체 스택 제안과 대안 작성; 최종 산출물 검토에서 변경 가능 |
| Reliability | NFR-04, 버전/사건 원자 저장, 충돌과 초안 보존 | SQLite 트랜잭션·재열람·실패 검증. 자동 재시도 패키지 추가 없음 |
| Maintainability | 순차 단위 확장, 한 앱, 제한된 검증 범위 | TypeScript·공통 저장/오류 계약·잠금 파일·필요한 집중 테스트 |
| Usability | 키보드·진행/오류·버전 식별이 승인됨 | 한국어 업무 화면, 레이블·초점·본문/초안 구분. 인증 수준 접근성 주장 없음 |

미응답 제품 범위 문제는 발견하지 않았다. 수치·저장 위치·스택은 이번 단계에 위임된 구체적 제안으로 문서화하고 최종 NFR 승인을 받는다. 추가 사전 질문은 0개다. 이전 기능 설계 승인을 새 스택 승인으로 간주하지 않는다.

## 관찰과 제안 구분

로컬 관찰: node v24.7.0, npm 11.5.1, python 3.9.7, claude 실행 파일 경로 존재. 패키지 설치·앱 빌드·네이티브 SQLite 로딩·CLI 인증 및 생성 성공은 확인하지 않았다. 사용자의 기존 파일과 도구 설치를 변경하지 않았다.

제안: Node 24 계열·TypeScript·React/Vite·Express 5·better-sqlite3, 앱 루트 .planrepo/의 SQLite 파일. 정확한 패키지 패치는 Code Generation에서 호환성을 검사하고 잠금 파일에 고정한다. 문서의 지원 상한과 검증용 입력은 새 제안임을 표시하고 성능 실측으로 주장하지 않는다.

## 검증과 확장

필수 산출물 2개, NFR-01–06 추적, 기능 규칙과의 일치, 기술 근거 링크, 로컬 상대 링크와 표 열 수를 검증한다. 기술 문서는 공식 자료를 사용하고 조사일을 기록한다. 실측이나 테스트를 수행한 것처럼 기록하지 않는다.

| 확장 | Enabled | 평가 | 사유 |
|---|---|---|---|
| Security Baseline | No | N/A | 기존 Q11 B; 전체 규칙과 적용 생략 |
| Resiliency Baseline | No | N/A | 기존 Q12 B; 전체 규칙과 적용 생략 |
| Property-Based Testing | No | N/A | 기존 Q13 C; 전체 규칙과 적용 생략 |

필수 문서 2개, U1-NFR01–12와 원본 NFR-01–06 추적, 이전 기능 설계 승인/체크박스, 문서 상대 링크·표 열 수 검증을 완료했다. 기술 문서에는 공식 자료 근거와 설치 시 확인할 제한을 구분했다. [NFR 검토 Q1](../sr-document-foundation/nfr-requirements/nfr-requirements-approval-questions.md)은 사용자 채팅 “승인 후 진행”으로 B 승인되었으며 단계 10을 완료했다.
