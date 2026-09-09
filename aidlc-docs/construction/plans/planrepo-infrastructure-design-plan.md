# PlanRepo Infrastructure Design 작성 계획

버전은 0.1이며 **산출물 승인 완료**입니다. 사용자 응답 “어 진행해도될거같아”로 NFR Design 산출물 0.1을 승인받았습니다. 단일 UOW-01의 로컬 실행 환경을 Standard 깊이로 정합니다.

## 1. 기준과 산출물

`.aidlc-rule-details/construction/infrastructure-design.md`를 적용합니다. `aidlc-docs/construction/planrepo/nfr-design/nfr-design-patterns.md`의 ND-01부터 ND-14, `aidlc-docs/construction/planrepo/nfr-design/logical-components.md`의 LC-01부터 LC-12와 승인된 NFR Requirements·Functional Design·단위 정의를 유지합니다.

산출물은 `aidlc-docs/construction/planrepo/infrastructure-design/infrastructure-design.md`와 `aidlc-docs/construction/planrepo/infrastructure-design/deployment-architecture.md`입니다. 실제 로컬 프로세스·파일 위치·설정·포트·준비/시작/종료/복구·검증 명령의 계약을 정합니다. 현재 앱 파일·패키지·DB를 만들거나 서버·Claude·배포를 실행하지 않습니다.

Superpowers의 설계 검토·검증 원칙을 이어 적용하며 AI-DLC의 파일 위치와 단계 승인을 따릅니다. 구현은 다음 Code Generation의 상세 계획을 만든 뒤 시작합니다.

## 2. 질문 영역 평가

| 영역 | 기존 근거와 이번 결정 |
|---|---|
| 배포 환경 | 승인 범위는 macOS arm64의 로컬 기능 데모입니다. 클라우드·운영 공개·조직 인증은 N/A이며 이 결정을 다시 묻지 않습니다. 일반 로컬 실행과 개발/테스트 실행을 나눕니다. |
| 실행 자원 | Node 기반 단일 backend와 브라우저, 제한된 Claude 자식 프로세스를 배치합니다. 시스템 Node·설치 Claude를 유지하고 추가 작업 서버나 OS 서비스 등록을 요구하지 않습니다. |
| 저장 | SQLite DELETE/FULL과 짧은 트랜잭션이 승인됐습니다. 프로젝트 내부 DB·실행 폴더·진단·fixture 경로, 시드·migration·재배치·복구의 보존 조건을 정합니다. |
| 메시징 | 같은 DB의 영속 Run/slot과 C-05 루프를 사용합니다. 별도 broker·외부 queue·pub/sub는 N/A입니다. 내부 알림 유실은 주기 조회로 보완합니다. |
| 네트워크 | loopback·같은 origin·정확한 Host/Origin 검사를 로컬 포트와 개발 proxy에 매핑합니다. 외부 호출은 Claude 모델 통신과 사용자의 명시적 링크 열기만 있습니다. |
| 관측 | 로컬 readiness·작업 상태·정제한 진단·검증 기록을 배치합니다. 외부 모니터링 계정·운영 경보·원시 프롬프트 수집은 N/A입니다. |
| 공유 자원 | UOW-01 하나이므로 단위 간 shared infrastructure는 없습니다. 앱 내부 모듈은 같은 DB와 runtime을 쓰며 이 두 문서에 책임을 포함합니다. 여러 앱 사본/테스트 DB는 분리합니다. |

새 사용자 선택 없이는 정할 수 없는 제품 범위 모순은 없습니다. 경로·기본 포트·준비 명령은 승인된 로컬 설계를 구체화하는 선택입니다. 실제 CLI 인증·프로세스 격리와 OS 종료 관찰의 유효성은 확인된 근거와 후속 실행 검증을 구분합니다. 환경 변경이 필요해지면 원인과 구체적인 변경안을 먼저 제시합니다. 질문은 현재 대화에서 받는 기존 방식을 따릅니다.

## 3. 실행 계획

- [x] 사용자 원문·NFR Design 승인을 기록하고 Infrastructure Design으로 전환했습니다.
- [x] 단계·공통 규칙·승인된 설계와 질문 영역 일곱 가지를 확인했습니다.
- [x] 현재 환경을 읽기 전용으로 확인하고 공식 근거로 로컬 실행·OS 관찰 수단을 정했습니다.
- [x] `aidlc-docs/construction/planrepo/infrastructure-design/infrastructure-design.md`에 자원·경로·설정·저장·CLI·시작/종료·검증 명령을 작성했습니다.
- [x] `aidlc-docs/construction/planrepo/infrastructure-design/deployment-architecture.md`에 모듈/프로세스 배치·환경별 연결·흐름·실패 경계를 작성했습니다.
- [x] 단위 간 공유 인프라를 N/A로 판단했습니다. 단일 UOW 내부 공유는 두 필수 문서에 포함하며 별도 shared-infrastructure.md를 만들지 않습니다.
- [x] 독립 검토로 경로·저장 보존·네트워크·프로세스 복구·승인 설계와의 일치를 확인하고 보정했습니다.
- [x] Markdown·JSON·표·추적·내부 경로·설정/포트/명령 일치와 승인 입력 보존을 검증했습니다.
- [x] 계획·상태·시작 안내·감사 기록을 갱신하고 산출물 승인을 요청합니다.
- [x] 사용자 응답 “응 승인함 진행해”를 기록하고 Infrastructure Design을 완료 처리했습니다.

## 4. 검증과 다음 단계

문서는 저장 전에 파싱하고 표·JSON·경로를 확인합니다. 앱 파일로 오인할 실행 코드나 임시 DB는 만들지 않습니다. 기존 실행 계획의 Mermaid는 제한 문법·연결·현재 상태를 확인하고 글 설명을 유지합니다. 필수 문서를 별도 경로에 복사해 참조가 이 프로젝트 안에서 해결되는지 검사합니다. 정확한 명령·결과·실패·미실행은 `aidlc-docs/audit.md`에 추가합니다.

Security Baseline·Resiliency Baseline·PBT는 비활성이며 개별 규칙은 N/A입니다. opt-in 3개를 확인하고 전체 규칙의 로딩·적용을 생략합니다. opt-in 없는 강제 확장은 없습니다. 기본 NFR과 이후 행동 변경의 TDD를 유지합니다.

검토 가능한 두 문서를 작성·검증한 뒤 수정 요청 또는 Code Generation 진행을 제시합니다. 이때 다음 단계는 Code Generation Part 1의 상세 구현 계획 작성이며 앱 코드가 이미 구현됐다는 뜻이 아닙니다. 단계 규칙 Step 8에 따라 이번 산출물 승인 전 Code Generation으로 넘어가지 않습니다.
