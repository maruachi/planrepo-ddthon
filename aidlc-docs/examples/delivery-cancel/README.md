# 배송 전 주문 취소·환불 Plan 예시 읽기 안내

이 폴더는 한 가지 예시를 처음부터 문서 승인까지 따라 읽기 위한 자료입니다. 모든 내용은 PlanRepo 로컬 시연용입니다. Codex가 작성자와 검토자 역할을 바꾸어 가며 실행했으며, 실제 주문을 처리하거나 실제 직원이 승인한 기록이 아닙니다.

`aidlc-docs/examples/delivery-cancel/plan.md` 한 파일이 실제 Plan입니다. `01`부터 `06`까지의 파일은 그 Plan을 처음 읽는 기획자와 검토자가 이해하기 쉽도록 문단별로 나눈 학습 자료입니다. 실제 업무에서 여섯 파일을 따로 작성해야 한다는 뜻이 아닙니다. 작성자는 `aidlc-docs/examples/delivery-cancel/00-sr.md`처럼 가지고 있던 설명을 그대로 올리고, 한 Plan 안에서 필요한 문단만 다듬을 수 있습니다.

## 처음 읽는 순서

1. **SR을 읽습니다.** `aidlc-docs/examples/delivery-cancel/00-sr.md`에서 작성자가 처음 올린 원문과 범위를 확인합니다.
2. **원문을 읽고 직접 수정합니다.** 등록한 원문은 곧 Plan의 시작입니다. 문장이나 범위가 분명하면 AI를 사용하지 않고 사람이 바로 고칠 수 있습니다.
3. **AI 추천은 필요한 경우에만 선택합니다.** AI는 문단 정리, 빠진 질문, 시나리오, 화면 문구를 제안할 수 있습니다. 질문에 모두 답하거나 AI 추천을 채택해야 문서를 승인할 수 있는 것은 아닙니다.
4. **문단별로 검토합니다.** 아래 여섯 학습 파일에서 누가 무엇을 확인하는지 살펴봅니다. 검토자는 실제로 바꿔야 하는 문단에 의견을 남깁니다.
5. **현재 문서를 승인합니다.** 사람이 요청한 필수 수정이 해결되면 검토자가 현재 문서 버전을 승인합니다. 승인은 Plan 내용에 대한 합의이며 실제 개발·주문·결제 완료를 뜻하지 않습니다.

## 문단별 학습 자료

- `aidlc-docs/examples/delivery-cancel/01-requirements.md`: 고객 약속, 범위, 완료 판단 기준
- `aidlc-docs/examples/delivery-cancel/02-user-scenarios.md`: 정상 상황과 예외 상황의 사용자 흐름
- `aidlc-docs/examples/delivery-cancel/03-workflow.md`: 초안, 수정, 검토, 승인 순서
- `aidlc-docs/examples/delivery-cancel/04-structure.md`: 화면, 서버, 저장소, 외부 서비스의 큰 연결
- `aidlc-docs/examples/delivery-cancel/05-decisions.md`: 사람이 정해야 하는 업무 원칙
- `aidlc-docs/examples/delivery-cancel/06-work-units.md`: 다음 개발 과정에서 구체화할 작업 후보

시각화용 숨은 메타자료는 원본 `aidlc-docs/examples/delivery-cancel/plan.md`에만 있습니다. 문단별 학습 파일은 사람이 읽는 본문에 집중합니다.

## 로컬 앱 시연 결과

- `aidlc-docs/examples/delivery-cancel/07-review.md`: 댓글 한 건, 필수 수정 요청 한 건, 문서 v3 반영 보고와 해결 확인을 사람 관점으로 정리합니다.
- `aidlc-docs/examples/delivery-cancel/08-approval.md`: 현재 문서 v3을 누가 확인했고 무엇에 동의했는지, 승인 범위가 어디까지인지 설명합니다.

상세 저장 증거는 `aidlc-docs/examples/delivery-cancel/evidence/app-record.json`에 있습니다. 이 결과는 로컬 예시 흐름의 실행 증거이며 실제 직원 결재나 실제 고객 주문 처리의 증거가 아닙니다.

## localhost에서 열기

로컬 예시 서버가 같은 시연 데이터로 실행 중일 때 다음 링크로 각 화면을 엽니다.

- [문서 열기](http://localhost:4173/?sr=sr-1a3cf4a3-377e-45ee-8f4d-c158fad36e69&view=documents)
- [요약·시각화 열기](http://localhost:4173/?sr=sr-1a3cf4a3-377e-45ee-8f4d-c158fad36e69&view=overview)
- [공유·리뷰와 결재 열기](http://localhost:4173/?sr=sr-1a3cf4a3-377e-45ee-8f4d-c158fad36e69&view=approval)
