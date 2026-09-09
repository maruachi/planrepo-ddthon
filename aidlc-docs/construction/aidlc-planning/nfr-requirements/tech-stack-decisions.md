# U2 기술 결정

기존 잠금 의존성을 재사용한다. Node child_process.spawn으로 CLI를 shell 없이 실행하고 stdin으로 문맥을 보낸다. 설치된 CLI 도움말과 [공식 headless 문서](https://code.claude.com/docs/en/headless), [CLI 옵션](https://code.claude.com/docs/en/cli-usage)에서 print/JSON 출력·도구 비활성화 옵션을 확인했다. 별도 SDK나 서버는 추가하지 않는다.

호출은 --print, --output-format json, --json-schema, --tools 빈 문자열, --strict-mcp-config 및 빈 mcpServers, --disable-slash-commands, --no-session-persistence, --setting-sources user, --settings의 disableAllHooks=true를 사용한다. 첫 실제 실행에서 설정 소스를 모두 비우면 이 환경의 기존 third-party 인증 설정도 제외되는 문제를 발견했다. 사용자 설정만 읽고 프로젝트 설정·훅·도구 실행은 비활성화하도록 보완했다. 인증 값은 로그나 문서에 기록하지 않는다. 실제 성공 여부는 검증 문서에서 별도로 기록한다.

PLANREPO_CLAUDE_PATH는 실행 파일(기본 claude), PLANREPO_RULES_PATH는 서버의 규칙 디렉터리(기본 앱 루트 .aidlc-rule-details)다. 설정은 서버 소유이며 HTTP에서 임의 명령·경로를 받지 않는다. 기존 macOS 인증과 네트워크 접근은 실제 실행 검증에서 확인한다.
