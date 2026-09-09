# U1 저장·문서 기반 기능 설계 계획

상태: 기능 설계 산출물 4개 승인 완료. 사용자 채팅 “승인 후 진행”을 Q1 B로 기록하고 U1 NFR Requirements로 전환했다. Units Generation 산출물은 사용자 채팅 “승인 후 진행”으로 승인 완료했다.

근거: [단위 정의](../../inception/application-design/unit-of-work.md), [의존성과 인계](../../inception/application-design/unit-of-work-dependency.md), [스토리 매핑](../../inception/application-design/unit-of-work-story-map.md), [요구사항](../../inception/requirements/requirements.md), [메서드 계약](../../inception/application-design/component-methods.md).

## 실행 체크리스트

- [x] 1. 단위 산출물 승인을 기록하고 Units Generation 완료 및 U1 전환
- [x] 2. U1 책임·스토리·서비스 계약·공통 요구사항과 후속 단위 경계 확인
- [x] 3. 여덟 질문 범주 평가 및 기존 결정·설계 제안·후속 결정 구분
- [x] 4. 기능 설계 계획과 산출물 순서 작성 및 내용 검증
- [x] 5. domain-entities.md 작성: 식별자·소속·관계·버전·사건·변경 묶음
- [x] 6. business-rules.md 작성: 검증·새 버전·최신 참조·편집·비교·복원·오류 규칙
- [x] 7. business-logic-model.md 작성: 메서드별 처리·데이터 흐름·일관된 저장·수용 기준 추적
- [x] 8. frontend-components.md 작성: 화면 구조·입력과 상태·사용자 흐름·서비스 연결
- [x] 9. 네 문서의 계약·참조·스토리·예외 처리·확장 준수 검증
- [x] 10. 설계 검토 질문·상태·감사 로그 갱신 및 승인 요청
- [x] 11. 기능 설계의 명시적 승인 수신·기록 후 U1 NFR Requirements로 전환

각 단계 완료 직후 체크박스를 갱신한다. 문서는 construction/sr-document-foundation/functional-design/에 저장한다. 이번 단계는 기술 독립 설계이며 앱 코드와 런타임 테스트는 Code Generation에서 수행한다.

## 질문 범주 평가

| 범주 | 근거·설계 처리 | 추가 입력 필요성 |
|---|---|---|
| Business Logic Modeling | 승인된 생성·열람·편집·비교·새 버전 복원 흐름을 구체화 | 기존 사용자 흐름을 재질문하지 않음 |
| Domain Model | SR·Document·DocumentVersion·HistoryEvent 및 VersionRef의 소속 관계 정의 | 승인 설계가 U1에 위임한 데이터 모델 결정 |
| Business Rules | 원본 보존·본문 없는 사건은 확정. 동일 본문 편집은 변경 없음, 복원은 새 버전으로 제안 | 구체 동작을 산출물에 명시하여 최종 설계 검토에서 변경 가능 |
| Data Flow | C09의 일관된 commit, prepareGenerated의 저장 없는 변경 준비 유지 | 저장 기술은 U1 NFR에서 선택 |
| Integration Points | U1은 U2/U3를 호출하지 않음. 실행 결과·리뷰 사건은 공통 계약 확장 | 실제 CLI·회차 정책·리뷰 상태는 해당 단위 담당 |
| Error Handling | 소속 오류·대상 없음·저장 실패를 구분. 오래된 편집 기준은 충돌로 반환하고 초안 보존 | 필수 데이터 보존의 구체 설계안이며 제품 범위 추가 없음 |
| Business Scenarios | 같은 본문·과거 버전 편집·동일 버전 비교·늦은 결과·빈 문서 목록을 명시 | 자동 병합이나 새로운 협업 기능을 전제하지 않음 |
| Frontend Components | 고정 6열·SR 입력/상세·문서/편집/이력/비교/복원과 키보드 흐름 | 프레임워크 독립 구조와 논리 API 계약으로 정의 |

요구사항의 “제품 범위의 미응답 질문은 없으며 … 구현하기 위한 설계 결정”과 단위별 결정 담당을 따른다. 추가 답변이 없으면 정할 수 없는 제품 범위 문제는 발견하지 않았다. 따라서 사전 질문은 0개이며 별도의 계획 재승인을 만들지 않고 검토 가능한 설계 산출물을 작성한다. 아래 구체적 제안은 기능 설계 승인 전까지 변경 가능하다. 승인 전 구현이나 다음 NFR 단계로 진행하지 않는다.

## 설계 제안과 후속 경계

- SR 제목·설명·선택 첨부는 생성 시점의 입력을 보관한다. 입력 수정 기능은 승인 범위에 없어 추가하지 않는다. 첨부는 생성 문맥이며 AI 계획 문서와 구분한다.
- 문서 본문 변경은 새 버전으로 남긴다. 현재 내용과 같은 편집은 변경 없음으로 알리며 새 버전을 만들지 않는다. 명시적 복원은 내용이 같아도 새 복원 버전과 사건을 남긴다.
- 오래된 버전을 기준으로 한 편집 저장은 최신 변경을 알리고 초안을 유지한다. 최신 본문과 비교 후 사용자가 다시 편집한다. 자동 병합이나 과거 기록 수정은 제공하지 않는다.
- U1의 저장 경계는 변경 준비 때 관찰한 최신 참조가 commit까지 유효한지 확인한다. U2의 늦은 생성 결과 채택 정책은 U2에서 결정하며 U1은 명시한 전제조건 실패를 반환한다.
- 보드의 고정 열과 초기 SR 목록 상태는 U1에서 정의한다. 단계·회차 계산은 U2, 리뷰·수동 완료는 U3가 확장한다.

## 검증 범위

네 필수 설계 문서의 상대 링크·표 열 수·문서 구문을 점검한다. U1 최초 구현 메서드 18개와 US-01/06/07/08/09/10 및 US-02 기반 기여를 추적한다. 저장·복원·참조·본문 없는 사건의 성공/실패 시나리오를 명시한다. 설계 검증을 구현 테스트 통과로 기록하지 않는다.

## 확장 준수

| 확장 | Enabled | 평가 | 사유 |
|---|---|---|---|
| Security Baseline | No | N/A | 사용자 Q11 B; 전체 규칙과 적용 생략 |
| Resiliency Baseline | No | N/A | 사용자 Q12 B; 전체 규칙과 적용 생략 |
| Property-Based Testing | No | N/A | 사용자 Q13 C; 전체 규칙과 적용 생략 |

승인된 제품 NFR은 계속 적용한다. [설계 검토 Q1](../sr-document-foundation/functional-design/functional-design-approval-questions.md)에서 네 산출물을 검토한다. U1의 최초 담당 메서드 18개와 승인된 배정의 정확한 일치, 업무 규칙 22개, 스토리 추적, 네 필수 문서·상대 링크·표 열 수를 검증했다. 런타임 검증은 아직 수행하지 않았다.
