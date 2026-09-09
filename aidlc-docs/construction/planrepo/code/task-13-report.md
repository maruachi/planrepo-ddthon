# CG-13 독립 Claude provider 부분 구현 보고

이 보고는 고정 Claude CLI profile, 결과 codec, 제한 runner adapter, 정제된 process metrics만 기록합니다. provider registry·DB provider 교체·C-05 execution loop·CG-11 저장 연결과 실제 Claude 업무 호출은 시작하지 않았으며 CG-13 전체 완료를 표시하지 않습니다.

## 구현 경계

- `ExecutionControl`에는 runtime이 만든 `execution:{launchRef,cwd}`만 추가했습니다. ProviderRequest와 ProviderOutcome에는 DB, RuntimeContext, ClaimRef, ownership token을 넣지 않았습니다.
- Claude adapter는 PATH의 `claude`를 `shell:false`인 기존 `ControlledProcessRunner`로 호출합니다. explicit 선택은 고정된 선택 modelId를 `--model`의 단일 argv로 전달하고 `installed_default`만 이 두 argv를 생략합니다. 제품 기본값은 `global.anthropic.claude-opus-4-8`입니다.
- tools의 빈 문자열과 `mcp__*`, strict empty MCP, session·slash command·Chrome 비활성, `dontAsk`/`none`, `disableAllHooks`, 고정 PlanRepo system prompt를 각각 독립 argv로 보존합니다. bare, bypass, resume, continue, setting-sources를 추가하지 않았습니다.
- 고정 system prompt는 네 taskKind의 정확한 GenerationResult 구조, 두 VersionRef 형태, 비어 있지 않고 고유한 제안·선택 ID, snapshot sourceRef와 participant assignee 제한을 설명합니다. 사용자 snapshot과 규칙은 stdin JSON에만 둡니다.
- `launch-policy.json`은 후보 CLI 2.1.263, profile version, 실제 고정 prompt·argv·환경 이름에서 계산한 fingerprint, 허용 환경 이름과 한계를 담습니다. 모듈은 이 파일의 exact key와 fingerprint를 시작 시 검사합니다. 사전 성공·eligible·verified flag는 없습니다. `mcp-empty.json`은 정확히 `{"mcpServers":{}}`입니다.
- HOME·PATH와 이름을 명시한 Claude/AWS/provider routing·proxy 환경만 child에 전달합니다. locale은 `C.UTF-8`, TMPDIR는 실행별 소유 cwd로 고정합니다. NODE_OPTIONS, NODE_PATH, PLANREPO 경로, 업무 token과 임의 환경은 전달하지 않습니다. 전체 raw environment를 closure, 설정, 결과, 진단에 복제하지 않습니다.
- factory는 runner, MCP 경로, CLI version, observer, 허용 환경, wall clock을 생성 시점에 고정합니다. request, execution 경계, policy도 generate 시작 시 고정합니다. 이미 취소된 signal은 runner를 호출하지 않고 `CANCELLED`와 `Confirmed/no_process_created` 관찰을 반환합니다.

## 결과와 실행 증거

- `decodeClaudeResult({stdout,process,request})`는 exit 0과 두 pipe close를 확보한 `Completed`만 받습니다. outer `type=result`, `subtype=success`, boolean `is_error`, string result를 확인합니다. `is_error:true`는 subtype과 관계없이 `PROVIDER_ERROR`이며 raw result를 진단에 복제하지 않습니다.
- 질문·결정·문서 DTO의 exact key, non-empty/unique ID, non-empty required text, task/document 일치, participant assignee, snapshot에 실제 있는 VersionRef와 2 MiB 정제 결과 상한을 검사합니다. truncated JSON, extra claim/role 필드, 다른 SR ref와 model 불일치는 `INVALID_OUTPUT`입니다. command/tool 시도가 `permission_denials`에 있으면 `UNAVAILABLE`입니다.
- modelUsage의 단일 metadata key만 actual model로 기록합니다. 승인 근거의 routing/canonical pair인 requested `global.anthropic.claude-opus-4-8`와 observed `claude-opus-4-8`은 호환되지만 `ExecutionReport.actualModelId`에는 관찰한 canonical key를 그대로 둡니다. metadata가 없거나 모호하면 actualModelId를 만들지 않습니다.
- runner의 모든 최초 결과에는 시작 시도·결과 확정 wall-clock 시각, 현재 stdout/stderr byte 수와 close 상태, 그때까지 관찰한 exit code/signal의 정제 metrics가 고정됩니다. deadline은 기존 monotonic clock만 사용합니다. 취소나 실패 확정 뒤 늦은 close는 observer 상태만 갱신하고 이미 반환한 metrics를 바꾸지 않습니다. `finishedAt`은 결과 확정 시각이며 전체 실행 범위 종료 증명이 아닙니다.

## TDD와 검증

- 첫 행동 RED인 `npm test -- tests/contract/claude-provider.test.ts -t "rejects an is_error result"`는 import에 성공한 뒤 미구현 decoder가 throw해 exit 1이었습니다. 최소 codec 뒤 같은 명령은 1/1, exit 0이었습니다.
- process metrics RED인 `npm test -- tests/unit/controlled-process.test.ts -t "결과 확정 시점의 정제된 metrics"`는 CANCELLED 결과에 metrics가 없어 exit 1이었습니다. fake monotonic/wall clock을 분리해 주입하고 최초 결과 snapshot을 추가한 뒤 1/1, exit 0이었습니다.
- profile/adapter 첫 전체 계약 실행은 고정 argv와 provider/model 정책, 실제 runner 전달 세 동작이 실패해 3 RED였습니다. 구현 뒤 통과했습니다. explicit model mismatch와 command 시도, blank/duplicate ID도 각각 먼저 완료로 잘못 받아 RED였고 검증을 추가한 뒤 GREEN이었습니다.
- review-driven `already-aborted|snapshots the CLI` 실행은 pre-abort가 runner까지 가 `PROCESS_FAILED`이 되고 factory options 변조가 다음 호출에 반영돼 2 RED, exit 1이었습니다. 시작 전 취소와 factory snapshot 뒤 관련 3개 테스트가 exit 0이었습니다.
- 최종 `npm test -- tests/contract/claude-provider.test.ts tests/unit/controlled-process.test.ts tests/integration/controlled-process-os.test.ts`는 3개 파일 34개 테스트가 모두 통과했습니다. 실제 OS fixture의 정상 Node child에서 양쪽 close, stdout/stderr bytes, exit code, ISO wall-clock metrics를 확인했습니다.
- 최종 `npm run typecheck`은 server와 web 모두 exit 0이었습니다. `npm run build`도 exit 0이었습니다. Vite는 기존 native config loader의 JSON import attribute·확장자 경고를 냈지만 bundle은 완료됐습니다.

## 남은 검증

- 실제 Claude CLI 호출, 실제 envelope 고정, 설치 version/help preflight, managed 정책·자동 명령, credential/provider 호환, 실제 모델 응답은 CG-15 RUN_LIVE까지 실행하지 않았습니다. 현재 provider 계약 테스트와 Node fixture를 실제 Claude 성공 증거로 세지 않습니다.
- C-05는 process observer를 durable queue에 연결하고 sink 오류를 실행 lifecycle과 분리해야 합니다. 종료 관찰이 `Unknown`인 slot과 실행 폴더를 보존해야 하며 provider의 `finishedAt`을 전체 종료로 해석하면 안 됩니다.
- provider registry, 요청 뒤 기본값 변경에도 저장된 selection을 유지하는 실제 DB swap, C-05의 claim·현재 fingerprint·deadline 재검사, draft 원자 저장은 CG-10/11/12 통합 범위로 남습니다.

## 독립 검토 fix round 1

- `mcpConfigPath`는 이제 bootstrap이 지정한 절대 project root의 `config/claude/mcp-empty.json`과 정확히 일치해야 합니다. 일반 파일과 실제 경로, 고정 bytes `{"mcpServers":{}}`를 factory 생성 시 검증해 문자열 snapshot으로 고정합니다. non-empty 파일, config symlink와 project asset 밖의 임의 절대 경로는 provider를 만들기 전에 거절합니다.
- 각 `generate`는 고정 snapshot을 runtime 소유 cwd의 `mcp-empty.json`에 `O_EXCL|O_NOFOLLOW`, mode `0400`으로 생성합니다. runner에는 이 실행별 경로만 전달합니다. factory 생성 뒤 원 project config나 options를 바꿔도 child argv와 실행 사본은 바뀌지 않습니다. 실행 폴더에 같은 이름이나 symlink가 있으면 process를 시작하지 않고 `POLICY_CONFLICT`로 닫힙니다.
- Claude 결과의 필수 문자열은 `trim().length > 0`을 검사하지만 반환 원문은 바꾸지 않습니다. 질문의 ID·본문·이유·후보, 결정의 ID·prompt·impact·recommendation과 대안 필드, artifact의 Markdown·requirement ID·변경 요약, VersionRef 식별자의 공백-only 값을 `INVALID_OUTPUT`으로 거절합니다.
- 행동 RED `npm test -- tests/contract/claude-provider.test.ts -t "whitespace-only|required MCP config|exclusive owned empty MCP"`는 exit 1이었습니다. 2개가 실패했고 14개는 skip됐습니다. 공백-only 질문이 `completed`였고, factory 뒤 MCP 원본 변경이 runner argv에 그대로 노출됐습니다.
- 별도 MCP bootstrap RED `npm test -- tests/contract/claude-provider.test.ts -t "rejects non-empty, symlinked, and arbitrary MCP config paths"`도 exit 1이었습니다. provider factory가 잘못된 설정에서 throw하지 않아 1개가 실패했습니다.
- 결과 검증 최소 변경 뒤 `npm test -- tests/contract/claude-provider.test.ts -t "whitespace-only required strings"`는 exit 0, 1개 통과·15개 skip이었습니다. 두 수정 뒤 결합 검사 `npm test -- tests/contract/claude-provider.test.ts -t "whitespace-only|required MCP config|exclusive owned empty MCP|non-empty, symlinked"`는 exit 0, 3개 통과·13개 skip이었습니다.
- 전체 provider 계약 `npm test -- tests/contract/claude-provider.test.ts`는 exit 0이며 16개가 통과했습니다. 첫 `npm run typecheck`은 새 opaque marker literal 두 곳과 artifact task union 테스트 조립의 타입 오류 3개로 exit 1이었습니다. 런타임 동작 변경 없이 literal과 task별 typed fixture를 바로잡은 뒤 같은 명령은 server·web 모두 exit 0이었습니다.
- `npm run build`는 exit 0이며 Vite가 194개 module을 변환했습니다. 기존 native config loader의 JSON import attribute·확장자 경고는 유지됐습니다. 실제 Claude 호출, credential·전역 설정 변경과 provider 통합은 실행하지 않았습니다.

## 공통 생성 source ref 정책 연결

- `claude-result.ts`의 로컬 ref key와 허용 목록 계산을 제거하고 고정된 `generationSourceRefKey`와 `allowedGenerationSourceRefKeys`를 직접 사용합니다. provider는 top-level `snapshot.contents[].ref`에 명시된 version ref만 허용하며 content JSON을 재귀 탐색하지 않습니다.
- 실제 DEMO-4 SQLite에서 M-008 답변을 저장하고 현재 generation basis와 InputSnapshot을 만든 뒤 provider decoder까지 연결했습니다. participant content와 assignee 허용 목록을 그대로 둔 같은 변조 snapshot에서 명시 top-level `question_answer` marker는 계속 통과했습니다. content 안에만 추가한 임의 `question_answer` ref는 `INVALID_OUTPUT`이었습니다.
- 이 변경은 기존 중복 구현을 공통 정책으로 교체하는 동작 보존 통합이라 새 행동 RED를 만들지 않았습니다. 특성 검증 `npm test -- tests/contract/claude-provider.test.ts -t "explicit current M-008 answer snapshot ref"`는 1개 통과·16개 skip, exit 0이었습니다.
- 첫 전체 검증 `npm test -- tests/contract/claude-provider.test.ts && npm run typecheck && npm run build`는 provider 17/17 뒤 server typecheck에서 `ReadonlySet`을 mutable `Set` 매개변수로 받을 수 없어 오류 2개, exit 1이었습니다. 소비 함수 매개변수만 `ReadonlySet`으로 바로잡은 뒤 같은 명령은 provider 17/17, server·web typecheck, build 모두 exit 0이었습니다. Vite의 기존 native config loader 경고는 유지됐습니다.
- C-05 통합에서는 version·policy·MCP 사전 실패의 `no_process_created`를 실패 code에서 추정하지 않고 실제 process observation으로 전달해야 합니다. 현재 provider observer는 pre-abort 외의 사전 실패를 관찰 sink에 연결하지 않으므로 이 후속 연결 전에는 slot을 해제할 강한 근거로 쓰면 안 됩니다.
- 독립 검토에서 첫 음성 검사가 participant content를 덮어써 assignee 검증도 함께 실패하는 문제가 드러났습니다. 기존 participant JSON에 임의 ref 필드만 추가하고, 같은 snapshot과 정상 answer ref가 `completed`인 positive control을 앞에 두었습니다. 보완 뒤 `npm test -- tests/contract/claude-provider.test.ts -t "explicit current M-008 answer snapshot ref"`는 1개 통과·16개 skip, exit 0이었습니다.

## provider registry와 C-05 통합

`GenerationProviderRegistry`는 저장된 `ProviderSelection.providerId`와 정확히 일치하는 adapter만 반환합니다. 등록되지 않은 ID는 fallback하지 않고 provider를 호출하기 전에 `UNAVAILABLE` terminal과 `no_process_created` observation으로 닫습니다. provider 교체 통합 테스트는 같은 저장 selection을 유지한 채 성공·실패 test adapter가 동일 Run 계약과 정제된 공개 필드로 저장되는 것을 확인합니다.

Claude adapter에는 DB, RuntimeContext, ClaimRef를 전달하지 않았습니다. adapter 생성자에 private `ProviderOutcomeEvidenceSink`와 process observer만 주입합니다. `Completed.closedAtMono/deadlineMono`는 반환한 `ProviderOutcome` 객체 identity와 WeakMap으로 연결합니다. C-05가 같은 outcome에서 만든 `ProviderCompletion`만 M-037 증거를 얻습니다. 검증·최종 저장 시 deadline을 넘으면 성공 transaction을 rollback하고 같은 신뢰 outcome으로 `TIMEOUT` terminal을 저장합니다. wall time으로 deadline을 복원하지 않습니다.

정책 불일치, CLI version 불일치, MCP/profile 준비 실패, 시작 전 취소는 runner의 `start()`를 호출하지 않은 경로에서만 `Confirmed/no_process_created`를 냅니다. `runner.start()` throw는 `Unknown/spawn_crash_gap`으로 남깁니다. 정상 direct child와 pipe close의 기존 `execution_scope_not_proven`도 그대로 `Unknown`입니다. checked-in empty MCP 파일의 마지막 newline은 허용하되 실행별 파일에는 검증한 canonical `{"mcpServers":{}}` bytes만 O_EXCL로 씁니다.

provider evidence 회귀는 사전 정책 거절의 start 0회와 Confirmed, start throw의 Unknown을 각각 검증했습니다. C-05 회귀는 exact selection, private outcome identity, deadline TIMEOUT, post-commit 취소, 늦은 observation busy 재시도, Unknown 폴더·slot 보존, worker rejection 감독을 검증했습니다. 최종 검증은 task-12 report의 비OS 73개와 typecheck/build exit 0을 공유합니다. 별도 OS child timeout 결과도 그 보고서에 구분했습니다.

main은 runtime 등록과 HTTP listen 뒤 loop를 시작하지만 CG-15 eligibility가 아직 없으므로 claim gate와 generation readiness를 false로 유지합니다. 따라서 이 연결은 실제 Claude를 호출하지 않습니다. 실제 설치 version/help, managed 정책, credential 호환, 실제 model 응답과 generation 성공은 RUN_LIVE에서만 검증합니다. 전역 설정과 계정은 읽거나 바꾸지 않았습니다.
