# U1 구현 검증 결과

검증 환경: macOS, Node 24.7.0, npm 11.5.1, SQLite 3.53.4 / better-sqlite3 13.0.3, React 19.2.8, TypeScript 7.0.2, Vite 8.2.2, Vitest 5.0.0. 정확한 전체 의존성은 루트 잠금 파일에 고정했다. 모든 검증은 기존 사용자 DB와 분리했다.

## 설치·검사·빌드

| 확인 | 결과 |
|---|---|
| npm install --save-exact --engine-strict | 완료, package engines/peerDependencies 확인 |
| 실제 파일 SQLite 네이티브 로딩 | 성공, 한글/CRLF 저장·읽기 |
| npm ci --engine-strict | 잠금 파일 재설치 성공, 302 packages |
| npm run typecheck | 클라이언트/NodeNext 서버/테스트 통과 |
| npm run build | UI 299 modules 및 NodeNext 서버/워커 생성 |
| npm test | 전체 29개 통과 후 검증 공백 2개 추가 |
| 마지막 집중 재검증 | storage/client-state/http 16개 통과; 현재 총 31개 테스트 모두 최신 관련 실행에서 통과 |

마지막 빌드 JS는 473.95 kB(gzip 147.65 kB), CSS는 15.61 kB(gzip 4.31 kB)이다. bundle에는 브라우저 공통 계약과 UI만 포함되고 SQLite/서버 워커는 Node 산출물에 남는다.

## 집중 테스트 31개

| 파일 | 개수 | 확인한 의미 |
|---|---|---|
| storage.test.ts | 8 | 재열기 원문, 중간 오류/지연 FK 전체 롤백, 불변 기록, 소속/포인터, 실제 두 연결 잠금, receipt 재사용/충돌/재시작 |
| migrations.test.ts | 2 | 미지원·더 높은·손상 DB 원본 바이트 보존, 보호 트리거 누락 거절 |
| pagination.test.ts | 2 | 같은 시각 키셋, 중복/누락 없음, 다른 소속 커서 거절, 본문/상세 없는 목록 |
| services.test.ts | 2 | 입력/UTF-8 상한, 편집/과거 보존/복원/동일 편집/빈 편집/비교 저장 불변 |
| generated-changes.test.ts | 1 | 저장 없는 준비, 빈 결과, 중복/형식 오류, 준비 이후 최신 경합 |
| compare.test.ts | 2 | 양쪽 원문 재구성, 공백/CRLF/끝 개행/제목/반복/빈 본문, 간략 비교 |
| worker.test.ts | 2 | 실제 컴파일 워커, 사용 중/취소/고장/시간 초과 및 이후 명시적 회복 |
| http.test.ts | 2 | 실제 HTTP/DB 핵심 조회·명령, 잘못된 JSON/필드·형식·압축·JSON 16 MiB 상한 |
| operations.test.ts | 3 | 실제 응답 연결 파괴 뒤 확인, 최신 변경 후 원래 결과, 진행 중·준비 경합 확인 |
| client-state.test.ts | 6 | 불확실 응답/자동 재제출 없음/원래 결과, 초안/세대/페이지, UTF-8 첨부·BOM·상한 |
| config.test.ts | 1 | 앱 루트 기준 개발/빌드 워커·DB 경로, 유효한 포트 |

## 로컬 실행과 재시작

npm start(4310), npm run dev(4311), /private/tmp에서 절대 경로의 빌드 서버 실행(4312)을 순차 확인했다. 같은 임시 DB의 이전 SR/문서가 유지됐고 각 모드에서 SR 생성, v1 열람, 실제 비교 워커, SPA 재진입, 없는 API/화면 404가 동작했다. 각 실행은 SIGTERM 후 포트를 닫았다. 기본 DB 위치는 설정 테스트로 검증했으며 실제 사용자 .planrepo DB는 생성·초기화하지 않았다.

관찰용 초기 데이터는 20 SR × 5문서 × 10버전, 일반 본문 약 9.4 KiB다. 추가로 1 MiB 본문 2버전, 긴 한 줄, 콘텐츠 렌더링, 본문 없는 결정 예시를 넣었다. 런타임 테스트의 보드 HTTP 관찰값은 약 24.6 ms / 6.0 ms / 5.3 ms였으며 각 다른 실행의 단일 관찰이다. 성능 SLA나 부하 인증이 아니다.

## 실제 브라우저·키보드

Browser 스킬을 읽고 연결·복구·가용 목록을 확인했으나 연결된 브라우저가 없었다. 설치된 Playwright 1.62.1로 Chrome for Testing 150.0.7871.24를 새 임시 프로필에서 실행했다. 사용자 브라우저 프로필·세션·인증 저장소를 사용하지 않았다. 영구 E2E 프레임워크/의존성은 프로젝트에 추가하지 않았다.

빌드 및 개발 UI에서 다음을 확인했다.

- 고정 6열과 카드, SR 필수값 오류, UTF-8 첨부, Enter로 생성, 생성 상세 재진입.
- 문서/과거 버전 열람, 원문 편집 저장, dirty 이동 취소와 초안 유지.
- 두 버전 비교, 복원 원본/복원 전 최신 보존, 새 버전 생성.
- 복원 대화상자의 Escape 취소, 버튼 초점 복귀, Enter 확인.
- 최신 경합 후 초안 유지 및 실제 새 최신 버전과 비교.
- 서버 커밋 후 브라우저 응답 차단, receipt 재조회로 정확한 성공 확인; 중복 제출 없음.
- 불확실 복원의 확인 유지, 새 시도 준비의 명시적 확인·취소.
- raw HTML 비실행, 이미지 alt 표시, 외부 이미지 요청 없음.
- 1 MiB 본문 두 개의 완전한 간략 비교, 200줄 다음 구간과 키보드 버튼 조작.
- 1 MiB 긴 한 줄을 편집기에 열고 커서 조작·취소.
- 이력 상세·추가 페이지 및 본문 변경 없는 결정 예시의 상세/원래 참조.
- 390 px 폭에서 문서 조작이 잘리지 않음. 문서/보드 스크린샷을 직접 확인.

상한 비교 시나리오의 약 1,022.6 ms는 페이지 진입·구간 이동·비교까지 포함한 브라우저 관찰이며 순수 diff 시간 수치가 아니다. 확인한 시나리오에서 JavaScript pageerror는 없었다.

## 발견 사항과 수정

SQLite INSERT 매개변수 수와 TypeScript 타입 오류는 해당 계층 테스트 전에 수정했다. 브라우저에서 활동 이력이 화면을 과도하게 늘리지 않도록 영역 내 스크롤을 추가했고, 충돌 시 버전 목록을 다시 읽으면서 초안을 유지하도록 보완했다. 불확실한 복원의 새 시도 확인도 추가했다. 저장 I/O 불확실성을 명시적으로 반환하고 커서의 시각/ID를 검증한다.

마크다운 검증 첫 시도는 준비 문서의 HTML 블록 뒤 빈 줄 누락으로 이미지 Markdown이 원문 텍스트에 포함됐다. 준비 문단을 수정해 alt 처리/네트워크를 확인했다. 원문 버튼 선택자는 초기 요구사항의 숨겨진 영역과 중복되어 문서 영역으로 한정했다. 이 두 테스트 준비/선택 실패를 통과로 기록하지 않고 남은 항목을 재실행했다.

## 증거 위치와 범위

이번 실행의 원시 JSON/스크린샷은 OS 임시 디렉터리에 있다. 임시 파일은 시스템 정리 후 사라질 수 있으며 이 문서가 저장소에 남는 검증 기록이다.

- /var/folders/sl/_cj854550hz43z0tzd13kjw00000gn/T/planrepo-browser-DzhY3W/runtime-results.json
- 같은 디렉터리의 browser-final-results.json, board-final.png, document-final.png, comparison.png, mobile.png
- 일회성 검증 스크립트: /private/tmp/planrepo-runtime-check.mjs, /private/tmp/planrepo-browser-check.mjs

준비 문서는 U1 저장/표시 계약의 증거다. 실제 Claude Code 실행·Run 소속·늦은 AI 결과 정책, U2 질문/결정/회차, U3 리뷰/역할/수동 완료와 최종 통합은 해당 단위에서 확인해야 한다. 물리 디스크 장애·전원 손실·다중 사용자·클라우드 배포·전체 브라우저 호환성은 검증하지 않았다.

Security, Resiliency, Property-Based Testing은 기존 Enabled No에 따라 모두 N/A이며 전체 확장 규칙 적용을 생략했다. 승인된 제품 BR/NFR은 위 증거로 검증했다.
