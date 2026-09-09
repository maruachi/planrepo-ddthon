# PlanRepo 애플리케이션 설계 계획

상태: 설계 검토 Q1 A 승인 확인 (2026-09-08T14:17:00Z). Application Design 완료, Units Generation으로 전환.

근거: [실행 계획](execution-plan.md), [실행 승인 Q1 A](workflow-planning-approval-questions.md), [요구사항](../requirements/requirements.md), [스토리](../user-stories/stories.md), [페르소나](../user-stories/personas.md).

## 실행 체크리스트

- [x] 실행 계획 승인 A 확인 및 Workflow Planning 완료 기록
- [x] 요구사항·스토리·페르소나·범위·확장 상태 확인
- [x] 컴포넌트·메서드·서비스·의존성·패턴의 다섯 질문 범주 평가
- [x] 설계 범위와 작성 방법 및 필수 산출물 계획 수립
- [x] components.md 작성: 컴포넌트 책임·인터페이스·소유 영역
- [x] component-methods.md 작성: 언어 독립 메서드 시그니처·입출력 계약
- [x] services.md 작성: 서비스 조율·문서/사건 저장·실행 결과 흐름
- [x] component-dependency.md 작성: 의존성 행렬·통신 방식·데이터 흐름
- [x] application-design.md 작성: 전체 설계 통합본·추적·후속 결정
- [x] 요구사항·14개 스토리·컴포넌트·메서드·흐름 간 완전성과 일관성 검증
- [x] 마크다운·다이어그램·참조·확장 적용 상태 검증
- [x] 산출물 검토 질문 작성 및 상태·감사 로그 갱신
- [x] 애플리케이션 설계 산출물 승인 또는 변경 요청 수신·기록
- [x] Application Design 완료 및 Units Generation으로 전환

## 질문 범주 평가와 적용할 작성 기준

| 범주 | 근거·설계 방법 | 추가 사용자 입력 필요 여부 |
|---|---|---|
| Component Identification | 승인된 세 작업 영역을 로컬 앱의 논리 모듈로 구체화. UI, 서비스, 저장·CLI·외부 입력 경계 정의 | 없음. 기존 범위 내 책임 배분을 설계 산출물로 검토 |
| Component Methods | SR·문서·버전·실행·질문·결정·리뷰 식별자를 포함하는 입출력 계약 작성 | 없음. 구체적 필드·검증 규칙은 Functional Design으로 유보 |
| Service Layer Design | SR·문서·계획·리뷰 서비스가 사용자 행위를 조율하고 공통 저장 경계 사용 | 없음. 새 제품 기능을 추가하지 않는 내부 구성 결정 |
| Component Dependencies | UI → 로컬 서버 → 서비스 → 저장/CLI 경계, 서비스 사이 순환 의존 방지 | 없음. 단일 로컬 앱 및 NFR-06에 따른 책임 구분 |
| Design Patterns | 하나의 로컬 서버 안에 논리 모듈과 교체 가능한 어댑터 배치, 별도 배포 단위는 만들지 않음 | 없음. 언어·프레임워크·저장 기술 선택은 승인된 일정대로 NFR Requirements에서 수행 |

미응답 제품 범위나 서로 모순된 결정은 없다. 위 선택은 기존 실행 승인에 따른 설계안이며, 별도 승인을 받았다고 기록하지 않는다. 추가 질문을 만들기 위해 이미 확정된 범위를 재질문하지 않는다. 검토 가능한 설계 산출물을 모두 작성한 뒤 명시적 산출물 승인을 받는다.

## 산출물 작성 방법

components.md, component-methods.md, services.md, component-dependency.md 및 이 네 문서의 내용을 통합한 application-design.md를 inception/application-design/ 아래에 작성한다. 메서드 계약은 언어 독립 표기로 작성하고 구현 가능한 책임 경계를 표현하되 정확한 DB 스키마·CLI 옵션·반복 회차 계산·상태 전이표는 후속 단위 설계에서 정의한다.

문서 버전과 본문 변경 없는 사건의 분리, 과거 버전 보존, 리뷰 대상 버전 고정, 피어 리뷰와 AI-DLC 승인 분리, 실제 CLI와 코드 구현 직전 종료를 일관되게 연결한다. 생성 성공은 결과 검증과 저장 이후에만 표시하는 흐름으로 설계한다. 사용자가 볼 진행 정보에는 장시간 실행의 상태 조회 경계를 둔다.

NFR-01–NFR-06 및 FR-01–FR-09를 스토리와 책임 컴포넌트에 연결한다. 다이어그램에는 텍스트 대안을 제공하고 파일 생성 전에 마크다운·연결·문법을 검증한다. 각 필수 파일 생성 직후 대응 체크박스를 완료 처리한다.

## 확장 준수 평가

| 확장 | Enabled | 평가 | 사유 |
|---|---|---|---|
| Security Baseline | No | N/A | Q11 B로 비활성화; 전체 규칙 로드·적용 생략 |
| Resiliency Baseline | No | N/A | Q12 B로 비활성화; 전체 규칙 로드·적용 생략 |
| Property-Based Testing | No | N/A | Q13 C로 비활성화; 전체 규칙 로드·적용 생략 |

## 생성 결과

필수 설계 문서 5개와 산출물 검토 질문을 작성했다. 11개 논리 컴포넌트의 책임·메서드·의존성과 전체 FR/NFR·스토리 추적을 검증했다. [설계 통합본](../application-design/application-design.md)에서 상세 문서 전체를 함께 검토할 수 있다.
