# U1 구현 요약과 후속 단위 인계

상태: 코드 생성·검증 완료. 코드 계획 Steps 1–20 완료, Step 21 산출물 승인 대기. U1 단계 전체 완료 및 U2 착수는 이번 산출물 승인 후 기록한다.

SR 직접 입력과 고정 6열 보드, 초기 입력 보존, 문서/버전/사건 조회, 편집·비교·새 버전 복원, SQLite 영속 저장과 로컬 앱 실행 기반을 구현했다. 저장 성공 전에는 성공 UI를 표시하지 않으며, 응답 유실은 원래 요청의 커밋 결과로 확인한다.

## 생성 경로

애플리케이션·설정·테스트는 작업공간 루트에 있다. 원본 requirements/와 사용자 파일, 루트 README.md 삭제를 유지했다. 사용자 .planrepo DB는 생성·초기화하지 않았다.

| 경로 | 구현 내용 |
|---|---|
| src/shared/ | 계약·입력 상한·오류·검증, 브라우저 ApiClient/OperationTracker |
| src/sr-document-foundation/storage/ | StorePort, 6개 테이블/마이그레이션, 타입별 조회·커밋·커서 |
| src/sr-document-foundation/services/ | SR 입력 포트, SRService, DocumentService |
| src/sr-document-foundation/compare/ | 순수 diff, 컴파일 워커, 단일 작업·고장/취소 어댑터 |
| src/sr-document-foundation/http/ | LocalAppBoundary, 13개 API, 검증·오류·operations |
| src/sr-document-foundation/ui/ | 보드·SR·문서·이력·편집·비교·복원과 공통 상태/키보드/페이지 |
| src/app/ | React 라우터·CSS, 설정·Express/Vite 조립·시작/종료 |
| tests/sr-document-foundation/ | 집중 테스트 11개 파일/31개 테스트 및 임시 DB·서버·브라우저 준비 도우미 |
| 루트 설정 | package.json/lock, TypeScript 설정 5개, Vite/Vitest, index.html, .nvmrc, .env.example, .gitignore |
| 현재 문서 디렉터리 | 저장·업무·API·프론트엔드 요약, 실행/API/검증/구현 문서, 산출물 검토 Q1 |

## 18개 메서드 대응

| 계약 | 구현 |
|---|---|
| C01.render | client.tsx의 createRoot.render, WorkspaceShell 및 UI 컴포넌트 |
| C01.submit | 폼·OperationTracker.submit·ApiClient.request |
| C02.query | LocalAppBoundary.query |
| C02.command | LocalAppBoundary.command |
| C03.create | SRService.create |
| C03.listBoard | SRService.listBoard |
| C03.getDetail | SRService.getDetail |
| C04.listDocuments | DocumentService.listDocuments |
| C04.readVersion | DocumentService.readVersion |
| C04.listVersions | DocumentService.listVersions |
| C04.listHistory | DocumentService.listHistory |
| C04.edit | DocumentService.edit |
| C04.compare | DocumentService.compare + DiffWorkerAdapter |
| C04.restore | DocumentService.restore |
| C04.prepareGenerated | DocumentService.prepareGenerated |
| C09.read | SQLiteStore.read + Queries |
| C09.commit | SQLiteStore.commit |
| C10.normalize | DirectSRInput.normalize |

## 스토리와 업무 규칙

| 기여 | U1 증거 | 이후 최종 확인 |
|---|---|---|
| US-01 | 직접 생성/필수값/첨부/보드·상세, UI·HTTP·입력 테스트 | U1 수용 확인 |
| US-02 기반 | 고정 6열/카드·상세, 브라우저 확인 | U2 회차·상태, U3 리뷰·완료 |
| US-06 기반 | 파일 재열기와 UI 재진입, 저장된 원문 | 실제 AI 생성 U2, 리뷰 역할 U3 |
| US-07 | 새 편집·과거 보존·충돌 초안과 최신 비교 | 실행 중 편집·늦은 AI 결과 U2 |
| US-08 기반 | 과거 버전/모든 사건·본문 없는 상세/원래 참조 | 실제 질문·결정·리뷰 생산 U2/U3 |
| US-09 | 두 정확한 버전 비교·원문 재구성·저장 불변 | 리뷰 역할 재사용 U3 |
| US-10 | 새 복원·원본/복원 전 최신 보존·키보드 | U1 수용 확인 |
| US-03/04 연결 | 생성 준비 중 저장 불변·잘못된 결과·이후 충돌 | 실제 CLI 성공/실패 U2 |

U1-BR01–06은 입력/보드/소속/빈 목록, BR07–13은 버전·편집·복원/경합, BR14–17은 비교·원래 사건 참조, BR18–22는 생성 준비·중복·전제·원자 커밋에 연결된다. [검증 결과](verification.md)의 저장/업무/비교/HTTP/브라우저 증거로 확인했다. 계획의 스토리 체크는 U1 기여만 의미하며 전체 U2/U3 스토리 완료를 뜻하지 않는다.

## NFR 대응

| NFR | 구현과 검증 |
|---|---|
| U1-NFR01 | loopback 로컬 서버, 앱 루트 설정, 세 실행 모드 |
| U1-NFR02 | BEGIN IMMEDIATE, 지연/복합 FK, 전체 롤백 테스트 |
| U1-NFR03 | 재열기·마이그레이션 원본 보존·receipt 재시작 |
| U1-NFR04 | 최신 전제/편집 충돌·준비 이후 경합·초안 유지 |
| U1-NFR05 | 상세/간략 워커 비교, 양쪽 원문, 상한/페이지 |
| U1-NFR06 | 레이블·키보드 생성/복원/페이지, 대화상자 초점 |
| U1-NFR07 | 저장 상태·실제 응답 유실/재조회·새 시도 확인 |
| U1-NFR08 | 입력 타입/소속, HTML 비실행·외부 이미지 요청 없음 |
| U1-NFR09 | 공유 TypeScript·정확한 잠금·타입 검사/빌드 |
| U1-NFR10 | 필요한 계약 집중 테스트, 실제 브라우저 확인 |
| U1-NFR11 | 시각/식별·범주 로그, 원문/인증값 미출력 |
| U1-NFR12 | UTF-8/한글/BOM/개행·경계/초과, 원본/초안 보존 |

## U2/U3 인계 계약

U2는 StorePort의 ReadQuery/ReadResults/ChangeSet 및 순차 마이그레이션을 확장한다. 현재 마이그레이션은 버전 1 구조를 정확히 검사하므로 스키마 버전·지원 검사도 함께 갱신해야 한다. U1 데이터/불변 트리거/복합 소속 관계와 테스트를 유지한다.

prepareGenerated는 자체 커밋하지 않는 ChangeSet을 반환한다. U2가 Run·질문·진행 변경과 결합해 같은 C09 경계에서 커밋한다. runId는 U1에서 UUID 연결 자리이며 실제 Run 테이블/FK와 같은 SR 소속 검증은 U2가 추가한다. 실행 입력 버전·늦게 도착한 AI 결과의 채택 정책을 기존 버전 보존과 연결해야 한다.

U2는 실제 CLI 호출, 결과 묶음/출력 한도, 실패/질문/결정·회차 및 구현 대기 전환을 구현한다. 현재 UI에는 기능 없는 AI/Jira/리뷰 버튼이 없다.

U3는 VersionRef를 원래 리뷰 대상으로 유지하고 Review/사건·시연 역할·수동 완료를 같은 저장/조회/화면에 연결한다. 사건 상세·요약·참조 수 상한과 타입 검증을 해당 단위에서 추가한다. C01 역할 선택과 C03.markImplemented는 아직 U3 책임이다.

모든 단위 이후 Build and Test에서 실제 CLI 포함 통합 시나리오와 실행 지침을 정리한다. 이번 U1 검증용 준비 데이터로 실제 AI·피어 리뷰 성공을 주장하지 않는다.

## 확장과 검토

Security Baseline, Resiliency Baseline, Property-Based Testing은 각각 Enabled No / N/A다. 전체 확장 규칙과 적용을 생략했고, 별도 Infrastructure Design 생략을 유지했다. 활성 확장 차단 항목은 없다.

[실행 안내](README.md), [API 참조](api-reference.md), [검증 결과](verification.md), [검토 Q1](code-generation-approval-questions.md)을 검토한다. 새 코드 산출물 승인은 기존 코드 계획 승인과 별도이며, 승인 후 U1 Code Generation을 완료하고 U2 Functional Design으로 진행한다.
