# CG-01 구현 보고

- 상태: DONE_WITH_CONCERNS
- 과제: CG-01 BOOT
- 범위: 프로젝트 도구, runtime 설정, 프로젝트 경로 경계, 격리된 unit test 실행기

## 단계별 결과

### Step 001

- `package.json`, lockfile, TypeScript/Vite/Vitest 설정, INF-03 기본 설정, runtime import 준비, root fixture와 행동 테스트를 작성했습니다.
- JSON은 Node `JSON.parse`, TypeScript는 `./node_modules/.bin/esbuild --loader=ts --format=esm --log-level=error`의 stdin 변환으로 저장 전에 검사했습니다. 모두 exit 0이었습니다.
- `npm view <package> version engines peerDependencies --json`을 runtime 7개와 dev 11개 패키지에 각각 실행했습니다. 모두 exit 0이었습니다.
- `npm install --save-exact react@19.2.8 react-dom@19.2.8 fastify@5.12.3 @fastify/static@10.1.3 better-sqlite3@13.0.3 react-markdown@10.1.0 rehype-sanitize@6.0.0`은 exit 0이었습니다.
- `npm install --save-dev --save-exact typescript@7.0.2 @types/node@22.20.0 @types/react@19.2.18 @types/react-dom@19.2.7 @types/better-sqlite3@9.6.0 vite@8.2.2 @vitejs/plugin-react@6.1.1 vitest@5.0.0 @playwright/test@1.63.0 tsx@4.23.13 esbuild@0.28.2`는 exit 0이었습니다.

### Step 002

- 첫 `npm test -- tests/unit/runtime-paths.test.ts`는 exit 1, 15개 중 13개 실패였습니다. 이 중 root override 사례 하나가 fixture 설정 누락으로 ENOENT를 내서 행동 RED로 인정하지 않았습니다.
- fixture를 바로잡은 뒤 같은 명령은 exit 1, 15개 중 13개가 예상한 assertion으로 실패했습니다. 경로 탈출, override, schema, test 저장소 격리가 미구현인 이유였습니다.
- 최신 model 선택을 반영하기 전에 `npm test -- tests/unit/runtime-paths.test.ts -t 'explicit modelId'`를 실행했습니다. exit 1, 선택한 1개 테스트가 `modelChoice keys` 검증으로 실패해 예상 RED를 확인했습니다.

### Step 003

- `resolveProjectPath`는 NUL과 상위 성분을 먼저 거절합니다. 이어 절대경로와 Windows 절대경로를 거절하고, 가장 가까운 기존 조상의 realpath와 `path.relative`로 루트 경계를 확인합니다.
- `loadRuntimeConfig`는 모든 JSON 객체의 키, 타입, 승인 제한값, 포트 범위, 허용 환경 override를 검사합니다. test mode에는 검증한 testRunId가 필요하며 사용자 dataDir와 같거나 중첩된 테스트 저장소를 거절합니다.
- 기본 model은 `{kind:'explicit', modelId:'global.anthropic.claude-opus-4-8'}`입니다. `{kind:'installed_default'}`도 유효합니다.
- 첫 `npm run typecheck`는 exit 1, TypeScript 7의 제거된 `baseUrl`에 대한 TS5102였습니다. `paths`가 프로젝트 루트 설정 파일 기준으로 같은 별칭을 유지하므로 `baseUrl`을 제거했습니다.
- 수정 후 `npm run typecheck`는 exit 0이었습니다.

### Step 004

- `npm test -- tests/unit/runtime-paths.test.ts`는 구현 직후 exit 0, 16개 통과였습니다.
- modelId 반영 뒤 같은 명령은 exit 0, 16개 통과였습니다.

### Step 005

- 한 테스트에 섞인 독립 실패 원인을 각각의 테스트로 분리했습니다. 제품 코드는 바꾸지 않았습니다.
- `npm test -- tests/unit/runtime-paths.test.ts`는 exit 0, 20개 통과였습니다.

### Step 006

- `npm ci`는 exit 0이었고 210개 패키지를 lockfile대로 설치했습니다. 감사 결과 취약점은 0개였습니다.
- `npm test`는 exit 0, 파일 1개와 테스트 20개가 모두 통과했습니다.
- `npm run typecheck`는 exit 0이었습니다. server/test와 web DOM 범위를 분리해 검사했습니다.
- `./node_modules/.bin/tsx -e <loadRuntimeConfig 확인 코드>`는 exit 0이었습니다. 실제 `config/planrepo.json`에서 schema 1, 127.0.0.1:4173/5173, explicit modelId, 프로젝트 내부 세 경로를 읽었습니다.
- 빈 임시 static root에 Fastify와 @fastify/static을 register하고 ready/close한 Node 명령은 exit 0이었습니다.
- better-sqlite3의 in-memory 연결과 `select sqlite_version()`은 exit 0이었습니다. 내장 SQLite는 3.53.4입니다.
- `node -e <manifest/lock JSON 검사>`와 exact dependency/script 계약 검사는 각각 exit 0이었습니다.

## self-review와 남은 조건

- fixture는 자신이 `mkdtemp`로 만든 root만 지웁니다. 애플리케이션 경로는 문자열 prefix가 아닌 realpath/relative 경계로 판단합니다.
- `@` 별칭은 TypeScript, Vite, Vitest에서 프로젝트 루트를 가리킵니다. Vite root는 `src/web`, port는 5173 strictPort이며 `/api`와 `/health`만 4173으로 proxy합니다.
- `.planrepo/`, `node_modules/`, `dist/`, `results/`와 테스트 결과 폴더를 git에서 제외했습니다.
- Fastify manifest는 5.12.3이지만 설치된 `fastify.js`의 `app.version`은 5.12.2로 보고됩니다. @fastify/static 10.1.3의 실제 register/ready는 통과했습니다. upstream package 내부 표기 차이를 concern으로 남깁니다.
- Playwright 패키지만 고정했습니다. 대응 Chromium 설치와 실제 시작은 후속 E2E 준비에서 `npx playwright install chromium` 계열 명령으로 확인해야 합니다.
- 실제 Claude, 브라우저, build, migration, seed, performance, acceptance는 실행하지 않았습니다. 소유 과제의 진입 파일이 아직 없으며 성공을 가장하는 임시 구현을 두지 않았습니다.
- Security, Resiliency, Property-Based Testing 확장은 state에서 모두 비활성화돼 이 과제의 개별 규칙은 N/A입니다.
- delegation 경계에 따라 `aidlc-docs/audit.md`, `aidlc-docs/aidlc-state.md`, `aidlc-docs/README.md`는 수정하지 않았습니다.

## Fix round 1/5

- 검토 결과: test 저장소의 최종 symlink realpath가 사용자 dataDir와 겹쳐도 사전 testRoot 검사만 통과하면 허용되는 결함을 확인했습니다.
- RED: `npm test -- tests/unit/runtime-paths.test.ts`는 exit 1이었습니다. 전체 23개 중 기존 20개는 통과했고, 최종 `data`, `runs`, `logs`가 사용자 dataDir symlink인 세 재현 테스트가 구체적인 overlap 오류를 내지 않아 실패했습니다.
- 수정: 세 test 경로를 먼저 `resolveProjectPath`로 해석했습니다. 각 최종 realpath와 appDataDir를 양방향 포함 관계로 비교하고 하나라도 같거나 중첩되면 `test and application data paths overlap` 오류로 거절합니다.
- GREEN: `npm test -- tests/unit/runtime-paths.test.ts`는 exit 0이었고 23개가 모두 통과했습니다.
- 타입 검사: `npm run typecheck`는 exit 0이었습니다.
- self-review: 세 경로 모두 같은 원인으로 사용자 자료를 읽거나 변경할 수 있으므로 동일 검사를 적용했습니다. 새 테스트는 `toThrowError(/test and application data paths overlap/u)`로 오류 종류까지 확인해 ENOENT 오탐을 허용하지 않습니다.
