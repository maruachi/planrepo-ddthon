# CG-05 구현 보고

CG-05의 로컬 HTTP 경계, 준비 상태, workspace 조회, 실제 TestApp, 제한된 macOS runtime identity 관찰, Vite 개발 경계와 빌드·개발 실행 조립을 구현했습니다.

## 구현 결과

- 공개 업무 route 44개를 고정 목록과 요청 schema로 등록했습니다. 내부 route 6개는 등록하지 않아 404를 반환합니다. 아직 업무 서비스가 없는 공개 route는 501 JSON 오류를 반환합니다.
- M-001은 현재 프로젝트와 현재 멤버십을 실제 SQLite 읽기 transaction에서 조회합니다. M-002는 actor header 없이도 선택값을 현재 ProjectScope와 멤버십으로 검증하며 서버 전역 상태를 바꾸지 않습니다.
- Fastify의 AJV는 `removeAdditional=false`를 사용합니다. 정확한 Host와 Origin, identity Content-Encoding, JSON Content-Type을 body parsing 전에 검사합니다. 전체 수신 본문은 8 MiB로 제한하며 문서와 generation 입력은 의미 값의 UTF-8 bytes를 별도로 검사합니다.
- readiness는 schema 확인과 원자적 runtime 등록 commit 뒤에만 storage ready가 됩니다. provider 준비는 별도이며 기본값은 false입니다. 일반 시작은 migration이나 DEMO-4 seed를 자동 실행하지 않습니다.
- 일반 정적 파일은 `dist/web` realpath 내부 파일만 제공합니다. dotfile, symlink 탈출, config, 문서, source, API와 health 경로는 SPA fallback에서 제외합니다.
- M-042 성공은 Markdown bytes와 안전한 Content-Disposition, base64url `X-PlanRepo-Command` metadata로 분리합니다. 과대 본문, 과대 metadata, 제어 문자가 든 파일 이름은 성공 응답으로 내보내지 않습니다.
- TestApp은 `.planrepo/test-runs/<testRunId>`의 실제 SQLite를 사용합니다. 정확히 예약한 loopback port에 실제 Fastify listener를 시작합니다. empty fixture는 config의 프로젝트와 사용자 5명만 넣으며 SR과 seed marker를 만들지 않습니다. DEMO-4 fixture는 `seedDemo(db)` 뒤 `readDemoManifest(db)`로 검증합니다.
- macOS 관찰은 `/usr/sbin/sysctl -n kern.bootsessionuuid`와 `/usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice`만 shell 없이 제한 실행합니다. UUID는 digest로 바꿉니다. 실패한 host와 boot 관찰은 runtime별 고유 unknown 값과 unavailable 상태로 남깁니다. `parentStartedAt`은 `unavailable`이며 강한 프로세스 identity로 사용하지 않습니다.
- Vite는 manifest의 `projectId`와 `defaultActorId` 두 값만 define합니다. 개발 서버는 실제 Vite Host와 Origin 하나만 허용하며 config와 허용 root 밖 `/@fs` 경로를 차단합니다.
- fix1에서 start-dev의 사용자 signal과 자식 실패 cleanup을 분리해 자식의 비정상 exit code를 보존했습니다. Vite의 기본 `VITE_` client 노출은 `envPrefix=[]`로 닫았습니다.
- 정적 root와 허용 parent 사이의 각 경로 요소가 symlink가 아닌지 확인합니다. 일반 시작은 검증·realpath 처리된 `config.root`의 `dist/web`만 사용하므로 명시적 `PLANREPO_ROOT`도 같은 경계를 따릅니다. M-019 artifact Markdown에는 1 MiB UTF-8 상한과 전체 명시 입력 2 MiB 상한을 함께 적용합니다.
- Content-Disposition은 이름과 CRLF까지 직렬화한 전체 header를 8,192 bytes로 제한합니다. 이는 `X-PlanRepo-Command`와 같은 보수적 상한이며 실행 중인 Node 22.23.2의 `http.maxHeaderSize` 16,384 bytes보다 작습니다.
- fix2에서 Content-Type, Content-Disposition, `X-PlanRepo-Command`의 직렬화 합계를 12 KiB로 제한했습니다. Node의 16 KiB 수신 상한 중 나머지 4 KiB는 Content-Length, Date, Connection 등 자동 header를 위한 여유입니다. 두 custom header의 개별 8,192 bytes 상한과 파일 이름 제어 문자 검사는 그대로 적용합니다.
- TestApp.invoke는 M-042의 Markdown Content-Type, RFC 5987 파일 이름, base64url command metadata와 raw response bytes를 해석합니다. unregister가 `SQLITE_BUSY`로 실패해도 connection을 닫고 활성 등록 상태를 성공으로 지우지 않습니다.

## TDD 기록

- `npm test -- tests/unit/runtime-identity.test.ts`의 첫 행동 RED는 2개 테스트가 실패했습니다. 고정 명령이 호출되지 않았고 서로 다른 runtime이 같은 placeholder identity를 받았습니다. 구현 뒤 2개가 통과했습니다.
- `npm test -- tests/contract/http-boundary.test.ts tests/integration/readiness.test.ts`의 첫 행동 RED는 5개 테스트가 실패했습니다. health와 schema route는 404였고 TestApp은 runtime을 등록하지 않았습니다. M-001도 placeholder 오류를 반환했습니다.
- 정적 realpath 테스트는 `/`가 404여서 1개가 RED였습니다. 정적 경계를 구현한 뒤 HTTP 계약 7개가 통과했습니다.
- UTF-8 문서 상한 테스트는 1 MiB를 넘는 한글 설명이 501로 진행돼 RED였습니다. 메서드별 byte 검사를 넣은 뒤 HTTP 계약 8개가 통과했습니다.
- DB 미준비 업무 차단 테스트는 501을 반환해 RED였습니다. storage readiness gate를 추가한 뒤 readiness 테스트 2개가 통과했습니다.
- build된 서버의 첫 격리 시작은 exit 1이었습니다. bundle의 `import.meta.dirname`이 `dist/server`를 프로젝트 root로 해석했습니다. 기본 root를 프로젝트 루트에서 실행한다는 계약에 맞춰 `process.cwd()`로 고친 뒤 같은 bundle이 시작됐습니다.
- 실제 Vite 개발 서버에서 허용해야 하는 `node_modules`의 `/@fs/…/env.mjs` 요청이 403이어서 RED였습니다. Vite 경로를 절대경로로 정규화한 뒤 같은 요청은 200이 됐고 config를 가리키는 단일·이중 슬래시 URL 형식은 모두 403을 유지했습니다.
- fix1의 `npm test -- tests/contract/http-boundary.test.ts tests/integration/readiness.test.ts` RED는 exit 1이었습니다. 19개 중 7개가 실패하고 12개가 통과했습니다. M-019는 413 대신 501, symlink 정적 root는 생성 허용, 긴 Content-Disposition은 200, TestApp M-042는 NOT_IMPLEMENTED, unregister busy 뒤 connection은 open, start-dev 부모는 exit 0이었습니다.
- 같은 RED 실행의 Vite 검사는 test 환경의 testRunId가 빠져 설정 오류로 먼저 멈췄습니다. 환경 격리를 보정한 `npm test -- tests/integration/readiness.test.ts -t 'Vite client'`는 exit 1이었고 transform 결과에 `VITE_PRIVATE_TOKEN` 이름과 sentinel 값이 모두 포함됐습니다.
- 7개를 수정한 뒤 `npm test -- tests/contract/http-boundary.test.ts tests/integration/readiness.test.ts`는 exit 0이었고 19개가 통과했습니다. Vite 검사는 실제 Vite `createServer`와 `transformRequest`를 사용하고 start-dev 검사는 실제 두 자식 프로세스의 실패와 종료를 사용합니다.
- fix2의 실제 listener fixture를 처음 실행한 `npm test -- tests/contract/http-boundary.test.ts -t 'header 합계'`는 기대 500 대신 200으로 exit 1이었습니다. 첫 fixture의 명시 header 합계가 Node 상한 아래였기 때문입니다. metadata를 늘린 두 번째 실행은 합계가 16,327 bytes여서 상한 초과 사전 assertion에서 exit 1이었습니다.
- Content-Disposition을 개별 상한 안에서 8,191 bytes로 조정한 세 번째 RED는 두 custom header와 Content-Type의 명시 합계가 16,384 bytes를 넘었습니다. 실제 `node:http` client가 `Parse Error: Header overflow`를 반환해 exit 1이었습니다. 12 KiB 합산 예산을 구현한 뒤 같은 명령은 exit 0이며 JSON 500 응답 1개가 통과했습니다.

## 최종 검증

- fix1 전 `npm run typecheck`는 exit 0이었고 `npm test`는 테스트 파일 7개와 테스트 103개가 통과했습니다.
- fix1 최종 대상 테스트는 HTTP boundary 12개와 readiness 7개입니다. `npm test -- tests/contract/http-boundary.test.ts tests/integration/readiness.test.ts`는 exit 0이며 19개가 통과했습니다.
- 완료된 CG-01~05 범위 명령 `npm test -- tests/contract/public-methods.test.ts tests/contract/http-boundary.test.ts tests/integration/demo-seed.test.ts tests/integration/readiness.test.ts tests/integration/storage-atomicity.test.ts tests/unit/runtime-identity.test.ts tests/unit/runtime-paths.test.ts`는 exit 0이었습니다. 테스트 파일 7개와 테스트 109개가 통과했습니다.
- fix1 중 첫 `npm run typecheck`는 CG-05의 M-042 header 타입 2건과 작성 중인 다른 과제 테스트 타입 2건으로 exit 1이었습니다. CG-05 타입을 수정한 뒤 같은 명령은 CG-06의 `tests/integration/sr-services.test.ts:56`과 CG-08의 `tests/unit/web/command-session.test.ts:51` 오류만 남겨 exit 1이었습니다.
- 저장소 밖 `/tmp/planrepo-cg05-tsconfig.json`으로 작성 중인 CG-06·CG-08 테스트를 제외하고 `./node_modules/.bin/tsc -p /tmp/planrepo-cg05-tsconfig.json --noEmit`을 실행했습니다. 첫 실행은 `/tmp` 기준 Node type 탐색 실패로 exit 1이었고 저장소의 `node_modules/@types`를 `typeRoots`로 명시한 재실행과 최종 재실행은 exit 0이었습니다.
- 병행 과제의 타입 오류가 정리된 최신 workspace에서 최종 `npm run typecheck`는 exit 0이었습니다.
- 최종 `npm test`는 작성 중인 CG-06 `tests/integration/sr-context.test.ts` 7개가 미구현 handler의 NOT_IMPLEMENTED 응답을 받아 exit 1이었습니다. 전체 12개 파일 중 11개와 전체 132개 테스트 중 125개가 통과했습니다. CG-05 및 완료된 선행 과제 실패는 없습니다.
- 실제 Vite RED 명령은 `PLANREPO_MODE=test PLANREPO_TEST_RUN_ID=8ae89244-df0f-42ba-9630-3d04f925949a PLANREPO_PORT=24176 PLANREPO_DEV_PORT=25176 ./node_modules/.bin/vite --host 127.0.0.1 --port 25176`이었습니다. 수정 후에는 새 testRunId `3ed2e266-8556-4cfc-989e-2d50eed6fd51`와 port 24177·25177로 같은 명령을 실행했습니다. 허용된 Vite `node_modules` 파일은 수정 전 403, 수정 후 200이었습니다. config 파일과 잘못된 Host·Origin은 403이었습니다. 앞선 port 24173·25173 검사에서도 `/@vite/client`는 200이었고 잘못된 Host·Origin, `/config/demo/manifest.json`, 허용 root 밖 `/@fs` config 요청은 403이었습니다. 직접 Vite 프로세스는 SIGINT 뒤 exit 1을 반환했습니다.
- `PLANREPO_MODE=test PLANREPO_TEST_RUN_ID=4857d600-fb04-4b08-9f1f-092a78568038 PLANREPO_PORT=24174 PLANREPO_DEV_PORT=25174 npm run dev`를 실행했습니다. backend ready는 준비되지 않은 격리 DB 때문에 503과 `generationReady=false`를 반환했습니다. Vite client는 200이었습니다. SIGINT 뒤 부모는 exit 0으로 두 자식의 종료를 기다렸습니다.
- fix1 뒤 `npm run build`는 서버 bundle을 생성한 뒤 exit 1을 반환했습니다. 원인은 CG-08이 아직 만들지 않은 `src/web/index.html`이며 기존 제한과 같습니다.
- fix2 뒤 `npm test -- tests/contract/http-boundary.test.ts`는 exit 0이며 13개가 통과했습니다. CG-06이 M-003을 연결한 최신 상태에 맞춰 미구현 공개 route 표본은 M-006 정상 요청으로 바꿨습니다.
- fix2 뒤 `npm run typecheck`는 exit 0이었습니다. 완료된 CG-01~05 범위의 7개 파일 명령은 exit 0이며 110개가 통과했습니다. 작성 중인 다른 과제 RED가 포함되는 전체 suite는 반복하지 않았습니다.
- build된 서버는 `PLANREPO_MODE=test PLANREPO_TEST_RUN_ID=b3b4e552-3c4f-4c02-9e6e-8e5bcb0a949f PLANREPO_PORT=24175 node dist/server/main.js --dev`로 시작했습니다. 격리 DB에 schema를 자동 생성하지 않아 ready는 503이었고 `generationReady=false`였습니다. SIGINT 뒤 exit 0이었습니다.

## 남은 검증

CG-08이 UI_BASE와 `src/web/index.html`을 구현한 뒤 `npm run build`, production `npm start`, 전체 `npm run dev`의 화면·정적 자산·proxy·HMR을 다시 검증해야 합니다. 현재 `npm start`는 실행하지 않았습니다. 실제 Claude, 브라우저 수용, 성능과 강한 process recovery는 이번 과제에서 실행하지 않았습니다.

Vite 8.2.2는 현재 동작에는 영향을 주지 않는 향후 native config loader 호환 경고를 출력했습니다. JSON import attribute와 extension 없는 TypeScript import가 경고 대상입니다. 후속 Vite config loader 변경 전에 다시 확인해야 합니다.

## 확장 규칙 준수

Security Baseline, Resiliency Baseline, Property-Based Testing 확장은 `aidlc-docs/aidlc-state.md`에서 모두 비활성화돼 이번 과제에는 N/A입니다. 기본 Host, Origin, 경로, 저장 원자성, TDD 요구는 적용해 검증했습니다.
