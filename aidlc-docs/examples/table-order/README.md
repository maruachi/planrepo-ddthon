# 테이블오더 Inception Plan 시연

테이블오더 초안으로 PlanRepo의 문서 등록, 실제 AI 질문, 답변, 문서 보완, 시각화, 검토 요청과 최종 결재를 실행하고 녹화했습니다. 최종 문서는 v3입니다.

## 영상과 문서

| 파일 | 내용 |
|---|---|
| `aidlc-docs/examples/table-order/table-order-demo.mp4` | 한국어 구간 설명을 넣은 6분 36초 편집본입니다. |
| `aidlc-docs/examples/table-order/table-order-full.mp4` | 14분 47.83초 전체 녹화본입니다. |
| `aidlc-docs/examples/table-order/inception-plan.md` | 앱에서 최종 승인한 문서 v3과 시각화 자료입니다. |
| `aidlc-docs/examples/table-order/requirements-draft.md` | 사용자 요구사항 초안입니다. |
| `aidlc-docs/examples/table-order/source-request.md` | 녹화 요청을 포함한 사용자 원문입니다. |
| `aidlc-docs/examples/table-order/poster.png` | 승인 후 시각화 화면입니다. |
| `aidlc-docs/examples/table-order/verification-report.md` | 실행 범위, 검증 결과와 한계입니다. |

영상은 실제 컴퓨터 화면을 녹화했습니다. 원본은 저장 상태를 확인하기 위해 두 구간으로 녹화했고, 전체본은 두 구간을 시간순으로 연결했습니다. 편집본은 긴 대기와 반복 점검 구간을 줄였으며 재생 속도는 바꾸지 않았습니다. 하단의 한국어 설명만 추가했습니다. 음성은 없습니다. 원본 고해상도 녹화는 `aidlc-docs/examples/table-order/table-order-raw.mov`와 `aidlc-docs/examples/table-order/table-order-raw-02.mov`에 보존했습니다.

## 편집본에서 볼 수 있는 과정

| 시작 | 장면 |
|---|---|
| 00:00 | 초안 원문과 검토자를 등록합니다. |
| 00:24 | AI가 만든 참고 질문을 읽습니다. |
| 00:48 | 질문 다섯 개에 답하고 시연 가정을 구분합니다. |
| 01:48 | 답변을 바탕으로 Inception Plan을 생성합니다. |
| 01:56 | 첫 보완안을 검토합니다. |
| 02:08 | 원문 누락과 시각화 인용 오류의 보완을 요청합니다. |
| 02:30 | 검증된 두 번째 보완안을 반영합니다. |
| 03:08 | 원문 세부 조건과 시연 승인 범위를 직접 보완합니다. |
| 03:26 | 전체 업무 흐름을 시각화합니다. |
| 03:45 | 여섯 가지 상황의 화면과 원문 연결을 확인합니다. |
| 05:01 | 현재 문서 v3의 검토를 요청합니다. |
| 05:39 | 가상 동료 검토자가 확인 항목과 의견을 기록합니다. |
| 06:09 | 담당자가 문서 v3을 최종 결재합니다. |

## 앱에서 이어 보기

- [문서 v3](http://127.0.0.1:4173/?sr=sr-63bb1d22-6550-4689-8284-bd9059e09fee&view=documents)
- [요약·시각화](http://127.0.0.1:4173/?sr=sr-63bb1d22-6550-4689-8284-bd9059e09fee&view=overview)
- [검토·결재 결과](http://127.0.0.1:4173/?sr=sr-63bb1d22-6550-4689-8284-bd9059e09fee&view=approval)

로컬 서버와 기존 시연 저장소가 실행 중일 때 사용할 수 있습니다. SR 키는 SR-MVP입니다. 이 시연에서 Codex가 작성자와 검토자 역할을 바꾸어 진행했습니다. 실제 직원의 승인이나 테이블오더 서비스 구현·주문 처리·배포 결과를 뜻하지 않습니다. 현재 프로젝트가 제공하는 전체 Inception 사용자 흐름을 실행한 결과입니다.
