# 빌드와 실행

macOS, Node 24, npm과 기존 인증을 가진 Claude Code CLI가 필요하다. 현재 저장소 루트에서 실행한다.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm start
```

개발 모드는 npm run dev다. 기본 URL은 http://127.0.0.1:4310 이며 기본 DB는 앱 루트 .planrepo/planrepo.sqlite다. CLI/규칙을 포함한 설정 예시는 루트 .env.example에 있고 자동 로드는 없다. 환경 변수는 쉘에서 설정한다.

PLANREPO_PORT는 1–65535 정수, PLANREPO_DB_PATH는 DB 경로, PLANREPO_CLAUDE_PATH는 CLI 실행 파일, PLANREPO_RULES_PATH는 AI-DLC 규칙 루트다. 경로는 기본적으로 앱 루트 기준이다. CLI 기본값 claude는 PATH에서 찾는다. 원래 MVP의 실제 검증은 `/Users/dgyim/.local/bin/claude`를 사용했다.

빌드 산출물은 dist/client와 dist/server다. 개발 워커는 .dev/server에 생성된다. 최종 빌드의 JS 500.72 kB(gzip153.93 kB), CSS18.14 kB(gzip4.77 kB). Vite의 500 kB chunk 안내가 발생했지만 빌드는 성공했다. 크기 SLA나 오류로 판정하지 않았으며 압축되지 않은 번들 크기에 대한 안내다.

인증 실패 시 평소 사용하는 CLI가 같은 사용자 설정으로 동작하는지 확인한다. 앱은 사용자 설정의 기존 인증을 읽고 프로젝트 설정·훅·도구 실행을 비활성화한다. 규칙 경로가 잘못되면 생성 실패로 표시한다. 포트 충돌은 다른 PLANREPO_PORT로 실행한다. 미지원/손상 DB는 시작을 중단하므로 기존 DB를 초기화하지 말고 백업/원인을 확인한다.

Ctrl+C 또는 SIGTERM으로 종료한다. DB 백업은 앱 종료 후 DB와 남은 WAL/SHM 파일을 함께 보관한다. 실제 검증에서 기본 사용자 DB를 생성/초기화하지 않았다.

## Worktree Integration Spike Addendum

### Prerequisites

- Node 24.x와 npm
- Git 2.39 이상이 설치된 local macOS/Linux environment
- `PLANREPO_REPOSITORY_PATH`: worktree를 만들 기존 non-bare local Git repository root
- `PLANREPO_WORKSPACE_ROOT`: managed worktree directory. 생략 시 `<app-root>/.planrepo/worktrees`
- 실제 실행 smoke를 할 때만 유효한 Claude CLI 설치·인증과 `PLANREPO_CLAUDE_PATH`

설정 예시에서 사용자 환경에 맞는 절대 경로를 사용한다.

```bash
export PLANREPO_REPOSITORY_PATH=/absolute/path/to/repository
export PLANREPO_WORKSPACE_ROOT=/absolute/path/to/managed-worktrees
npm ci
npm run typecheck
npm test
npm run build
```

성공 시 `dist/client/`과 `dist/server/`가 생성되고 comparison worker는 `.dev/server/` 또는 server build에 포함된다. 이번 build 결과는 JS 505.02 kB, gzip 154.90 kB와 CSS 18.14 kB, gzip 4.77 kB다. Vite의 500 kB 초과 chunk 안내는 허용된 warning이며 build failure가 아니다.

### Troubleshooting

- Repository 미설정: status API는 `configured: false`, provision은 409를 반환한다. `PLANREPO_REPOSITORY_PATH`를 설정하고 재시작한다.
- Repository root 오류: nested directory나 bare repository가 아니라 `git rev-parse --show-toplevel`과 일치하는 worktree root를 지정한다.
- 기존 branch가 다른 path에 연결됨: spike는 deterministic managed path만 허용한다. 기존 worktree를 자동 삭제하지 않으므로 수동 확인 후 별도 조치한다.
- HTTP test의 `listen EPERM`: 제품 실패가 아니라 실행 sandbox의 loopback 제한일 수 있다. 로컬 loopback test 권한이 있는 환경에서 다시 실행한다.
- Claude 실행 실패: fake test 성공은 인증 성공을 의미하지 않는다. 평소 shell에서 configured executable과 인증을 별도로 확인한다.

## Manual Board Status Movement Hotfix

추가 환경 변수나 외부 서비스는 필요하지 않다. Node 24.x 환경의 repository root에서 다음 최소 순서로 확인한다.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

성공 산출물은 `dist/client/`과 `dist/server/`다. Hotfix 검증 시 Vite가 309개 module을 변환했고 build를 완료했다. SQLite database를 열면 schema v5의 기존 row를 보존하면서 manual board column migration이 적용된다. 운영 DB에서 직접 시험하지 말고 먼저 복사본 또는 임시 `PLANREPO_DB_PATH`를 사용한다.

동시에 진행 중인 Worktree Document History 변경이 아직 미완료라면 전체 typecheck가 `src/worktree-spike/` 또는 관련 test fixture에서 실패할 수 있다. 이 경우 Manual Board focused suite를 먼저 확인하고, 동시 변경이 완료된 뒤 위 전체 순서를 다시 실행한다. Hotfix 검증을 위해 해당 범위 밖 파일을 임의 수정하지 않는다.

## Worktree Document Edit and History

추가 패키지나 외부 서비스는 필요하지 않다. Node 24.x, npm과 임시 SQLite/filesystem fixture를 사용할 수 있는 repository root에서 실행한다. 실제 SR Worktree 연결에는 `PLANREPO_REPOSITORY_PATH`와 선택적 `PLANREPO_WORKSPACE_ROOT`가 필요하지만 자동 테스트는 사용자 repository를 사용하지 않는다.

```bash
npm ci
npm run typecheck
./node_modules/.bin/vitest run tests/worktree-spike
npm test
npm run build
```

현재 검증에서 typecheck, Worktree focused 15파일/50테스트, 전체 40파일/146테스트와 production build가 모두 성공했다. Vite는 310개 module을 변환했으며 산출물은 `dist/client/`과 `dist/server/`다. 생성된 client bundle은 JS 497.05 kB(gzip 153.32 kB), CSS 18.80 kB(gzip 4.92 kB)였다.

운영 데이터 확인 시에는 먼저 DB 복사본이나 임시 `PLANREPO_DB_PATH`를 사용한다. 앱 시작 시 schema v6까지의 row를 보존하고 v7 Worktree document/history/receipt tables를 추가한다. 지원되지 않거나 변형된 schema는 기존 바이트를 변경하지 않고 시작을 중단한다.

## Initial SR Prompt Selection Hotfix

- **Runtime**: Node.js `>=24 <25`, npm lockfile install.
- **Dependencies**: 기존 `package-lock.json`; 새 package 없음.
- **Build environment**: 자동 검증에는 추가 환경 변수가 필요 없다. 실제 Claude/Worktree 실행에는 기존 `PLANREPO_REPOSITORY_PATH`, 선택적 `PLANREPO_WORKSPACE_ROOT`, `PLANREPO_CLAUDE_PATH` 설정을 그대로 사용한다.
- **Install**: clean checkout에서는 `npm ci`를 실행한다.
- **Typecheck**: `npm run typecheck`.
- **Build**: `npm run build`.
- **Expected artifacts**: `dist/client/`과 `dist/server/`.
- **Observed result**: Vite 309 modules transformed; client and server build success.
- **Acceptable warning**: 기존 client JS chunk가 약 501 kB로 500 kB advisory threshold를 넘는다. 이 server-side prompt Hotfix가 추가한 warning은 아니다.

Dependency 또는 compilation 오류가 발생하면 Node major version과 lockfile install을 먼저 확인하고 `npm run typecheck`의 최초 오류부터 해결한다. 범위 밖 dirty-worktree 파일을 되돌리지 말고 원인 파일을 확인한 뒤 focused tests와 full build를 다시 실행한다.
