# PlanRepo Functional Design 작성 계획

버전은 0.1이며 **산출물 승인 완료**입니다. 사용자 응답 “응 진행해”로 UOW-01의 단위 산출물 0.1을 승인받았습니다. 승인된 단위의 기술 중립적인 상세 기능 설계를 작성합니다. 이 계획은 새 구현 계획이 아니며 앱 코드·스택·인프라를 확정하지 않습니다.

## 1. 입력과 범위

`aidlc-docs/inception/application-design/unit-of-work.md`, `aidlc-docs/inception/application-design/unit-of-work-dependency.md`, `aidlc-docs/inception/application-design/unit-of-work-story-map.md`가 단위 기준입니다. 제품 요구사항은 `aidlc-docs/inception/requirements/requirements.md` 0.4, 스토리는 `aidlc-docs/inception/user-stories/stories.md` 0.1, 논리 API는 `aidlc-docs/inception/application-design/component-methods.md`입니다.

`.aidlc-rule-details/construction/functional-design.md`를 적용합니다. UOW-01 전체의 데이터·상태·알고리즘·검증·역할·UI를 다룹니다. 핵심 게이트·버전·질문/결정·초안 적용·인계는 Comprehensive 깊이로 정리합니다. 이미 승인된 범위와 34개 스토리·122개 개별 기준·7개 공통 기준을 유지합니다.

## 2. 질문 영역 평가

| 영역 | 기존 근거와 설계 방향 |
|---|---|
| 업무 논리 | SR 접수·G1·G2·인계·외부 사실과 재검토 규칙이 정해졌습니다. 진행 단계·검토 상태·승인 유효성·외부 사실을 분리한 전이표를 작성합니다. |
| 도메인 모델 | 보존할 논리 데이터와 불변 버전·현재 참조가 정해졌습니다. 엔티티·필드·관계·필수 조건을 구체화하며 DB 스키마나 제품은 선정하지 않습니다. |
| 업무 규칙 | 현재 역할·지정 결정권자·지정 전원 승인·수정 확인 주체·범위 분류가 정해졌습니다. 역할 겸임과 비차단 요청을 잘못 제한하지 않습니다. |
| 데이터 흐름 | 변경과 무효화·요청 승계·활동·receipt의 원자성, 외부 실행 분리가 승인됐습니다. 확정 직전 재검사와 실패 시 불변 조건을 알고리즘으로 정합니다. |
| 통합 | 시스템 Claude·교체 계약·Jira/GitHub Mock·수동 외부 구현 사실이 정해졌습니다. provider가 업무 명령을 실행하거나 외부 상태를 자동 인증하지 않게 합니다. |
| 오류 처리 | 오래된 버전·권한·입력 변경·형식 오류·취소·저장 실패를 구분하는 논리 오류 계약이 있습니다. 사유·현재 대상·재시도와 입력 보존을 연결합니다. |
| 업무 시나리오 | G1/G2 영향 구분·새 차단·섹션 삭제·재배정·과거 인계 보존이 정해졌습니다. 경계 조건과 수용 기준에 연결한 검증 시나리오를 작성합니다. |
| 프런트엔드 | 메뉴·상세 탭·검토 요약·버전 승인·생성 패널·키보드·명시적 전환이 정해졌습니다. 화면 구성·입력/상태·폼 검증·논리 API 연결을 정의합니다. |

기존 결정으로 구체적인 설계안을 작성할 수 있어 새 업무 범위 질문이나 빈 답변 항목을 만들지 않습니다. 단순 구현 선택은 근거를 남기고 산출물 승인에서 검토합니다. 사용자 선택이 필요한 새로운 범위 충돌이 발견되면 대화에서 확인합니다. 미래 스택·저장 제품·실행 제한 수치·HTTP 경로는 다음 NFR·Infrastructure Design에서 정합니다.

## 3. 작성할 문서와 책임

| 문서 | 내용 |
|---|---|
| `aidlc-docs/construction/planrepo/functional-design/domain-entities.md` | 엔티티·필드·관계·범위·불변 버전·현재 상태·검토 묶음·AI 입력과 결과의 데이터 정의입니다. |
| `aidlc-docs/construction/planrepo/functional-design/business-rules.md` | 권한·필수 입력·게이트 조건·변경 영향·질문/결정·수정 요청·중복·충돌·AI·인계의 규칙과 추적입니다. |
| `aidlc-docs/construction/planrepo/functional-design/business-logic-model.md` | 명령 처리·상태 전이·게이트 판정·변경 전파·생성/적용·조회 알고리즘과 검증 시나리오입니다. |
| `aidlc-docs/construction/planrepo/functional-design/frontend-components.md` | 화면 구성·입력/출력·로컬 상태·폼·사용자 행동과 M 계약 연결입니다. |

도메인·규칙·흐름은 주 작업자가 맞추며 독립적인 프런트엔드 명세 작성과 읽기 전용 검토를 병행할 수 있습니다. 같은 파일을 동시에 수정하지 않습니다. 모든 새 문서는 작성 전에 Markdown을 파싱합니다. 새 그림보다 명시적인 관계·전이표를 우선하고 그림을 사용하면 문법과 글 설명을 함께 검증합니다.

## 4. 체크리스트

- [x] 사용자 원문을 기록하고 단위 산출물 0.1과 Units Generation을 승인·완료 처리했습니다.
- [x] 단위·요구사항·스토리·논리 계약과 Functional Design 규칙을 확인했습니다.
- [x] 질문 영역 여덟 가지를 평가하고 상세 설계의 범위·유보 사항을 기록했습니다.
- [x] `aidlc-docs/construction/planrepo/functional-design/domain-entities.md`에 엔티티·필드·관계·상태와 불변식을 작성했습니다.
- [x] `aidlc-docs/construction/planrepo/functional-design/business-rules.md`에 업무·권한·게이트·변경 영향·오류 규칙을 작성했습니다.
- [x] `aidlc-docs/construction/planrepo/functional-design/business-logic-model.md`에 상태 전이·처리 알고리즘·검증 시나리오·스토리 추적을 작성했습니다.
- [x] `aidlc-docs/construction/planrepo/functional-design/frontend-components.md`에 화면·props/state·폼 검증·논리 API 연결을 작성했습니다.
- [x] 독립 검토로 역할·버전·상태·게이트·AI·UI의 누락과 모순을 확인하고 수정했습니다. 실제 보정본의 재검토에서 남은 blocking 결함이 없었습니다.
- [x] 요구사항·스토리·메서드·규칙·엔티티 참조, 전이 조건, Markdown·프로젝트 경로를 검증했습니다.
- [x] 상태·시작 안내·감사 기록을 갱신하고 Functional Design 산출물 승인 요청을 준비했습니다.
- [x] 사용자 원문 “다음단계 진행”을 2026-09-08T14:53:15Z에 기록하고 Functional Design 0.1을 완료 처리했습니다.

## 5. 완료와 다음 단계

필수 기능 설계 문서 네 개를 구체적으로 작성·검증한 뒤 변경 요청 또는 NFR Requirements 진행의 두 선택을 제시합니다. Functional Design 규칙 Step 8에 따라 이번 산출물의 명시적 승인 후 다음 단계로 갑니다. 앱 구현·실제 Claude 호출·설정 변경·운영 작업은 이 단계에서 하지 않습니다.

작성·검증 결과는 엔티티 35개, 업무 규칙 32개, 처리 흐름 12개, 시나리오 24개, UI 26개입니다. 논리 메서드 50개와 공개 UI 연결 44개, 스토리 34개·개별 기준 122개·공통 기준 7개를 확인했습니다. Markdown·표 열 수·프로젝트 루트 참조 재배치 검증을 통과했습니다. 앱 테스트나 실제 Claude 생성은 실행하지 않았습니다.

Security Baseline·Resiliency Baseline·PBT는 비활성 상태이므로 개별 규칙은 N/A입니다. 전체 rule 로딩과 적용을 생략하며 기본 NFR과 행동 변경의 TDD는 유지합니다.
