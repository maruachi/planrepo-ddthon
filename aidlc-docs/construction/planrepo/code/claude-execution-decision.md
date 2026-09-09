# PlanRepo Claude 실행 결정

사용자의 최신 지시와 2026-09-09 실제 호출 결과를 기준으로 합니다. 이전 설계의 제한 옵션 후보와 미검증 모델 기본값은 아래 결정으로 대체합니다. 개발 도구는 Codex이며 제품의 생성 provider는 설치된 Claude CLI입니다.

## 기본 모델과 기존 환경

기본 modelChoice는 explicit이며 modelId는 `global.anthropic.claude-opus-4-8`입니다. provider와 modelChoice는 교체 가능한 계약으로 유지합니다. 최초 짧은 실제 호출은 Claude CLI 2.1.263과 Bedrock 연결에서 확인했습니다. 2026-09-09 후속 조회에서 현재 설치 버전은 2.1.265이며 version·help와 필수 옵션 15개를 확인했습니다. 제품 profile의 현재 후보 반영과 업무 생성 검증은 CG-15에서 진행합니다. 과거 호출 결과를 새 버전의 실제 생성 근거로 사용하지 않습니다.

기존 HOME과 PATH 및 인증 환경을 보존합니다. Claude가 자신의 전역 설정과 credential chain을 읽습니다. 앱은 credential 값을 읽거나 복사하지 않습니다. 전역 설정·로그인·자격 증명을 변경하지 않습니다.

## 검증한 실행 옵션

executable은 PATH에서 찾은 claude이며 shell 없이 argv와 stdin을 분리해 실행합니다. cwd는 앱 소유의 빈 실행 폴더입니다.

```json
[
  "--print", "--input-format", "text", "--output-format", "json",
  "--model", "global.anthropic.claude-opus-4-8",
  "--tools", "", "--disallowedTools", "mcp__*",
  "--strict-mcp-config", "--mcp-config", "<app-owned-empty-MCP-json>",
  "--no-session-persistence", "--disable-slash-commands", "--no-chrome",
  "--permission-mode", "dontAsk", "--permission-prompts", "none",
  "--settings", "{\"disableAllHooks\":true}",
  "--system-prompt", "<fixed-PlanRepo-system-prompt>"
]
```

safe-mode, restricted, setting-sources는 추가하지 않습니다. 이 옵션으로 기존 Bedrock 설정을 제외한 검증은 현재 환경의 연결 판정으로 사용하지 않습니다. 제품의 고정 system prompt와 출력 schema는 provider 구현에서 연결합니다.

## 실제 관찰과 범위

짧은 가상 prompt를 stdin으로 전달했습니다. 명령은 exit 0으로 끝났습니다. 응답은 정확히 PLANREPO_CLAUDE_OK였습니다. 결과의 actual model은 global.anthropic.claude-opus-4-8, canonical model은 claude-opus-4-8, provider는 bedrock이었습니다. 웹·도구·subagent 사용은 0이었습니다.

이 결과는 기존 환경을 이용한 실제 생성 호출의 근거입니다. AC-17의 업무 초안 반영, 취소, 자손 정리, timeout, 복구, 전체 customization 격리를 통과했다는 의미는 아닙니다. 각 항목은 후속 구현과 별도 검증에서 판정합니다.

표준 managed 설정 파일은 관찰되지 않았고 Bedrock에서는 remote managed policy fetch가 비활성이라고 CLI가 보고했습니다. 모든 MDM과 전역 문맥의 부재를 입증하지는 않았습니다. 이 관찰 한계를 실제 연결 실패로 바꾸거나 전체 격리 통과로 과장하지 않습니다.

## 기존 설계와 적용 순서

이 문서는 NFR·Infrastructure 설계의 실행 후보 중 모델 선택과 기존 환경 보존을 구체화합니다. 충돌하는 safe-mode·restricted 강제, installed_default 고정, 기존 인증 실패 판정은 최신 사용자 지시로 대체합니다. 출력 크기·timeout·취소·단일 실행 슬롯·원자적 저장·현재성·도구 제한의 기존 계약은 유지합니다.

실행 파일·버전·모델·argv·출력 schema가 바뀌면 짧은 실제 호출과 관련 provider 검사를 다시 실행합니다. 실패 시 다른 모델로 조용히 전환하지 않습니다. 검증 결과는 정제된 메타데이터로 기록합니다.
