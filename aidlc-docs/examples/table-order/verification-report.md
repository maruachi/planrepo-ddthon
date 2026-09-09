# 테이블오더 시연 검증 보고서

2026-09-09에 PlanRepo의 기존 로컬 프로토타입으로 시연했습니다. 제품 소스는 변경하지 않았습니다. 사용자가 제공한 새 초안을 독립된 SR-MVP로 등록했습니다.

## 실행 결과

- 실제 Claude 질문 생성 1회와 문서 보완 2회가 모두 succeeded입니다. 질문 5개와 답변 5개를 저장했습니다.
- 원문 v1을 보존했습니다. 두 번째 AI 보완안을 v2로 적용하고, 원문 세부 조건과 시연 범위 안내를 직접 보완해 v3을 저장했습니다.
- 문서의 여섯 문단은 요구사항, 사용자 시나리오, 진행 계획, 주요 구조, 주요 결정, 작업 단위입니다. 작업 단위 8개에 수용 기준과 검증 방법을 담았습니다. 메뉴 관리 후속 요구도 보존했습니다.
- 최종 시각화는 노드 7개, 연결 6개, 상황 6개와 화면 제안 6개입니다. 앱의 실제 파서가 ready를 반환했습니다.
- 메뉴 탐색, 주문 성공, 주문 실패, 관리자 접수·상태 변경, 이용 완료·과거 이력, 다음 고객의 새 세션 화면을 실제 UI에서 확인했습니다. 원문 근거 버튼으로 문서의 사용자 시나리오에 이동했습니다.
- 문서 v3의 검토 요청, 가상 동료 검토자 승인, 담당자 최종 결재를 저장했습니다. 새로고침 후 결재 완료 상태를 확인했습니다.

## 검증 명령과 결과

| 명령 | 결과 |
|---|---|
| `npm test` | exit 0입니다. 테스트 파일 48개, 테스트 443개가 통과했습니다. |
| `npm run typecheck` | exit 0입니다. 서버와 웹 타입 검사가 통과했습니다. |
| `npm run build` | exit 0입니다. 서버와 웹을 빌드했습니다. |
| `node --input-type=module`에서 실제 `parsePlanVisualization`과 `deriveDraftDocumentStructure` 호출 | 최종 문서의 시각화가 ready이며 여섯 문단과 여섯 화면을 확인했습니다. |
| `ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,avg_frame_rate -of json aidlc-docs/examples/table-order/table-order-demo.mp4` | H.264, 1440×1032, 12fps, 396초, 5,633,560바이트입니다. |
| `ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height -of json aidlc-docs/examples/table-order/table-order-full.mp4` | H.264, 1440×936, 887.833333초, 8,003,931바이트입니다. |
| `ffmpeg -hide_banner -v error -i aidlc-docs/examples/table-order/table-order-demo.mp4 -f null -` | exit 0이며 전체 디코딩 오류가 없습니다. |
| `ffmpeg -hide_banner -v error -i aidlc-docs/examples/table-order/table-order-full.mp4 -f null -` | exit 0이며 전체 디코딩 오류가 없습니다. |

제품 소스를 수정하지 않아 새 TDD 테스트는 작성하지 않았습니다. 별도 자동 e2e·성능 테스트는 실행하지 않았습니다. 실제 컴퓨터 UI로 이번 시연 흐름을 검증했습니다. 테이블오더 구현과 그 서비스의 테스트는 이 프로젝트의 현재 시연 범위 밖입니다.

빌드에는 Vite의 향후 native 설정 로더와 import 형식 경고, 500kB 초과 번들 경고가 있었습니다. 빌드는 통과했으며 이번 녹화에서 코드 수정으로 처리하지 않았습니다.

## 발견한 문제와 처리

첫 AI 보완안은 원문의 일부 조건을 요약했고 시각화의 인용 한 곳이 본문의 어순과 달랐습니다. 실제 앱 파서는 `evidence 인용문을 현재 section 본문에서 찾을 수 없습니다.`를 반환했습니다. 이 초안은 문서에 적용하지 않았습니다. AI에 누락 복원과 정확한 인용을 요청한 두 번째 보완안은 ready였습니다.

시연 가정이 실제 사용자 확정으로 읽히지 않도록 문서 v3에 가상 역할·승인의 범위를 명시했습니다. 관리자 로그인 입력, 주문 상세 필드, 첫 주문의 세션 시작, 과거 이력 필드 등도 원문과 대조해 추가했습니다. 수정 후에도 인용 검증을 통과했습니다.

화면 캡처를 시작할 때 이전 eSPEC 녹화 프로세스가 남아 있었습니다. 이전 영상은 정상 종료해 보존했습니다. 이번 ffmpeg 녹화 시도는 프레임을 받지 못해 종료했고 macOS 화면 녹화로 전환했습니다. 3초 시험 영상과 첫 구간의 185.823333초 영상을 검증한 뒤 두 번째 구간을 녹화했습니다. 최종 사용 파일은 정상 저장된 두 macOS 녹화입니다.

마지막 화면 선택 시 컴퓨터 제어 도구가 사용자 조작 감지를 반환했습니다. 추가 화면 조작을 멈추고 녹화를 정상 저장했습니다. 최종 결재와 새로고침 검증은 그 전에 완료했습니다. 편집본은 이 후반 대기 구간을 제외합니다.

## 확장과 증거

Security Baseline, Resiliency Baseline, Property-Based Testing은 프로젝트의 Enabled=No 설정에 따라 모두 적용을 생략했습니다. 활성 확장은 없습니다. Mermaid·ASCII 다이어그램은 새로 만들지 않아 N/A입니다. 앱의 JSON 시각화와 정확한 인용을 검증했습니다.

- `aidlc-docs/examples/table-order/evidence/app-record.json`: 이 SR의 문서 버전·질문·답변·생성·적용·검토·승인·전환 기록입니다.
- `aidlc-docs/examples/table-order/evidence/final-validation.json`: 최종 문서와 실제 앱 파서의 검증 요약입니다.
- `aidlc-docs/examples/table-order/evidence/initial-app-validation.json`: 첫 AI 보완안의 인용 오류입니다.
- `aidlc-docs/examples/table-order/evidence/tests.log`, `aidlc-docs/examples/table-order/evidence/typecheck.log`, `aidlc-docs/examples/table-order/evidence/build.log`: 기존 검증의 전체 출력입니다.
- `aidlc-docs/examples/table-order/evidence/edit-decisions.json`: 편집에 사용한 원본 구간과 설명 카드 번호입니다. 모든 구간의 속도는 1입니다.
- `aidlc-docs/examples/table-order/evidence/video-contact-sheet.jpg`: 편집본 주요 장면을 추출해 육안 확인한 이미지입니다.

최종 문서 SHA-256은 `b86c8725be704e2d338df1be324aa56f02ce24aa0a85ece63980117ef34a6823`입니다. 실제 운영 규모와 메뉴 관리 포함 여부, 단말 갱신 정책, SSE 측정 조건 등은 문서에 구현 전 확인 항목으로 남겼습니다.
