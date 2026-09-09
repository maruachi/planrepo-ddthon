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

PLANREPO_PORT는 1–65535 정수, PLANREPO_DB_PATH는 DB 경로, PLANREPO_CLAUDE_PATH는 CLI 실행 파일, PLANREPO_RULES_PATH는 AI-DLC 규칙 루트다. 경로는 기본적으로 앱 루트 기준이다. CLI 기본값 claude는 PATH에서 찾는다. 실제 검증은 /Users/dgyim/.local/bin/claude를 사용했다.

빌드 산출물은 dist/client와 dist/server다. 개발 워커는 .dev/server에 생성된다. 최종 빌드의 JS 500.72 kB(gzip153.93 kB), CSS18.14 kB(gzip4.77 kB). Vite의 500 kB chunk 안내가 발생했지만 빌드는 성공했다. 크기 SLA나 오류로 판정하지 않았으며 압축되지 않은 번들 크기에 대한 안내다.

인증 실패 시 평소 사용하는 CLI가 같은 사용자 설정으로 동작하는지 확인한다. 앱은 사용자 설정의 기존 인증을 읽고 프로젝트 설정·훅·도구 실행을 비활성화한다. 규칙 경로가 잘못되면 생성 실패로 표시한다. 포트 충돌은 다른 PLANREPO_PORT로 실행한다. 미지원/손상 DB는 시작을 중단하므로 기존 DB를 초기화하지 말고 백업/원인을 확인한다.

Ctrl+C 또는 SIGTERM으로 종료한다. DB 백업은 앱 종료 후 DB와 남은 WAL/SHM 파일을 함께 보관한다. 실제 검증에서 기본 사용자 DB를 생성/초기화하지 않았다.
