# CG-13 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

### CG-13 검증 가능한 Claude CLI 프로파일·결과 검증·동일 provider 교체 계약

**구현 묶음**: B-02입니다. **선행**: CG-10, CG-11, CG-12입니다.

**연결 기준**: M-032, M-033, M-036, M-037, M-038, US-009, US-010, US-011, US-013, ENT-26, ENT-27, ENT-28, ENT-30, SCN-15, SCN-18, SCN-19, SCN-20, NQ-04, NQ-17, NQ-18, NQ-19, NQ-20, NQ-22, ND-07, ND-09, ND-11, ND-12, ND-13, ND-14, INF-03, INF-06, INF-07, INF-08입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/providers/generation/provider-contract.ts` | 갱신합니다. | GenerationProvider와 ProviderRequest/결과의 provider 독립 계약입니다. |
| `src/contracts/views.ts` | 갱신합니다. | 기존 provider 판별 계약을 유지하며 명시 provider 오류의 PROVIDER_ERROR를 token 없는 실패 코드에 추가합니다. |
| `src/providers/generation/provider-registry.ts` | 생성합니다. | 요청 시 고정 providerSelection으로 adapter를 선택합니다. |
| `src/providers/generation/claude-cli.ts` | 생성합니다. | 제한 실행을 호출하고 실제 CLI envelope를 정규화합니다. |
| `src/providers/generation/claude-profile.ts` | 생성합니다. | 고정 argv·환경 allowlist·지원/정책 증거를 검사합니다. |
| `src/providers/generation/claude-result.ts` | 생성합니다. | exit/JSON error/schema/model 정보를 검증합니다. |
| `config/claude/mcp-empty.json` | 생성합니다. | 내용은 {"mcpServers":{}}입니다. |
| `config/claude/launch-policy.json` | 생성합니다. | 승인 ND-11 후보와 정책 지문/허용 환경 기준입니다. 성공 확인 플래그를 미리 만들지 않습니다. |
| `tests/helpers/provider-fixture.ts` | 생성합니다. | 가상 envelope·테스트 adapter·runner spy를 정의합니다. |
| `tests/contract/claude-provider.test.ts` | 생성합니다. | is_error·실행 인자 전달·정책 거절을 검증합니다. |
| `tests/integration/provider-swap.test.ts` | 생성합니다. | 실제 저장과 동일 계약의 Claude fixture/test adapter 교체를 검증합니다. |

**인터페이스와 입력 조건**

CG13 첫 실제 adapter 연결에서 ExecutionControl에 런타임이 만든 execution={launchRef,cwd}를 추가합니다. ProviderRequest에는 넣지 않습니다. ProcessResult는 최초 결과 확정 시점의 실제 stdout/stderr byte 수, pipe close 관측, 시작 시도·결과 확정 시각과 관측한 exit/signal을 정제 metrics로 제공합니다. 취소 뒤 늦은 close는 metrics를 소급 변경하지 않고 별도 observation으로 전달합니다. finishedAt은 전체 OS 실행 범위 종료의 증명이 아닙니다. deadline은 기존 monotonic clock을 유지합니다. C-05 관찰 연결은 adapter 생성자에 주입한 좁은 observer sink를 사용하며 ClaimRef·DB·RuntimeContext를 전달하지 않습니다.

GenerationProvider.generate(ProviderRequest,ExecutionControl) -> Promise<ProviderOutcome>를 모든 adapter가 구현합니다. CG-02의 기존 판별 계약인 {kind:'completed',result,execution} 또는 {kind:'failed',failure,execution}를 유지합니다. result는 GenerationResult, failure는 token 없는 ProviderFailureCore, execution은 ExecutionReport입니다. 유효한 CLI envelope가 is_error=true인 실패를 구분하도록 CG-13에서 ProviderFailureCore에 PROVIDER_ERROR를 추가합니다. RuntimeContext/DB/repository/API 주체를 ProviderRequest에 주지 않습니다. 테스트 adapter는 tests/helpers/provider-fixture.ts에서만 등록하며 실제 기본 연결을 조용히 대체하지 않습니다.

decodeClaudeResult({stdout,process,request}) -> ProviderOutcome는 src/providers/generation/claude-result.ts에 정의합니다. process는 RUN_PROCESS Completed 증거, request는 고정 snapshot/선택입니다. tests/helpers/provider-fixture.ts의 providerFixture()는 {request,closedProcess}를 반환하며 고정 가상 참조만 포함합니다. closedProcess는 테스트 증거이며 실제 Claude 실행으로 기록되지 않습니다.

프로파일은 설치 2.1.263과 최신 사용자 지시로 검증한 기존 환경 재사용 조합입니다. --print --input-format text --output-format json --tools '' --disallowedTools 'mcp__*' --strict-mcp-config --mcp-config <앱 empty 파일> --no-session-persistence --disable-slash-commands --no-chrome --permission-mode dontAsk --permission-prompts none --settings '{"disableAllHooks":true}' --system-prompt <고정 앱 문구>를 인자 배열로 전달합니다. --model은 explicit 선택일 때만 고정 modelId를 넣습니다. bare/bypass/resume/continue/불확실한 setting-sources는 추가하지 않습니다.

기본 선택은 explicit/global.anthropic.claude-opus-4-8입니다. installed_default는 교체 가능한 선택지로 유지하며 CLI가 실제 사용하는 기본값입니다. 사용자 설정 alias만 보고 실제 model ID를 추정하지 않습니다. 실제 model ID는 확인된 result 메타데이터만 쓰고 없으면 null/미확인입니다. CLI/정책 변경은 지원 상태를 미검증으로 내립니다.

- [x] **Step 073: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { decodeClaudeResult } from '@/src/providers/generation/claude-result';
import { providerFixture } from '@/tests/helpers/provider-fixture';

it('rejects an is_error result even when its subtype says success', () => {
  const { request, closedProcess } = providerFixture();
  const outcome = decodeClaudeResult({
    request,
    process: closedProcess,
    stdout: Buffer.from(JSON.stringify({
      type: 'result', subtype: 'success', is_error: true,
      result: 'provider failure with synthetic secret CANARY_DO_NOT_LOG'
    }))
  });
  expect(outcome).toMatchObject({ kind: 'failed', failure: { code: 'PROVIDER_ERROR' } });
  expect(JSON.stringify(outcome)).not.toContain('CANARY_DO_NOT_LOG');
});
```

- [x] **Step 074: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/contract/claude-provider.test.ts -t "rejects an is_error result"
```

예상 결과는 다음과 같습니다. subtype success만 신뢰하거나 raw result를 오류에 복제하는 구현에서 실패해야 합니다. 정상 error envelope를 알 수 없는 성공 초안으로 저장하면 안 됩니다.

- [x] **Step 075: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

PATH에서 실행 파일을 찾고 --version/--help로 현재 버전·지원 인자를 확인합니다. 개인 설치 경로를 config에 고정하지 않습니다. CLI version과 approved candidate/profile의 차이를 기록하며 새 옵션/패키지 버전을 근거 없이 추가하지 않습니다.

지원 사전조건은 검증한 tools/MCP 비활성·strict MCP 유효성·새로운 비저장 세션·CLI hook 제한입니다. 관찰된 자동 명령이나 managed MCP 충돌은 PROVIDER_UNAVAILABLE로 처리합니다. 모든 MDM·전역 문맥의 부재를 입증하지 못했다는 일반적 한계만으로 기존 연결을 차단하지 않습니다. 최신 사용자 지시와 aidlc-docs/construction/planrepo/code/claude-execution-decision.md의 실제 호출 근거를 적용합니다. credential 원문을 별도로 읽거나 기록하지 않고 global settings/login을 변경하지 않습니다. 검증 사전조건과 실제 업무 생성 검증 단계는 RUN_LIVE에서 구분합니다.

args는 빈 tools 문자열과 mcp__*를 각각 한 인자로 보존합니다. HOME·PATH와 기존 인증 및 provider 라우팅 환경을 유지하며 CLI가 자신의 user settings를 읽게 합니다. provider 구현에서 필요한 환경 이름을 명시하고 값을 로그·스냅샷·설정 파일로 복제하지 않습니다. 검증된 locale·작업별 TMPDIR를 사용하며 NODE_OPTIONS/NODE_PATH·업무 token·DB 경로를 전달하지 않습니다. CLI 도구·MCP·hook 제한은 고정 argv로 적용합니다. 모든 prompt bytes는 stdin 또는 고정 system prompt이며 외부 경로/명령을 사용자 문자열로 구성하지 않습니다.

stdout JSON은 error flag/subtype·결과 타입·본문 schemaVersion/taskKind·허용 참조·크기를 검사합니다. stdout error를 stderr 부재로 성공 처리하지 않습니다. 알려지지 않은 envelope·다른 SR 참조·모델 승인/명령·truncated JSON·정제 draft>2 MiB는 실패입니다. schema와 실제 envelope fixture는 최초 실제 검증에서 확인한 형식에 맞춰 고정합니다.

C-06은 provider 독립 draft/실패만 반환하고 C-02 M-037은 원 claim·상태·현재 fingerprint·deadline을 다시 확인합니다. 실제 model/CLI 표시는 근거가 있는 경우에만 채웁니다. AI 출력의 runId/claim/role은 내부 실행을 식별하는 권한이 아닙니다.

provider-swap 테스트는 요청 뒤 기본 설정 변경, explicit model 인자, 기존 선택 고정, 입력 지문 불변, 교체 전후 stale/결과 검증/업무 digest 불변을 실제 DB에서 확인합니다. Claude 쪽은 runner의 명시 envelope fixture를 쓰는 계약 테스트임을 표시합니다. 실제 Claude와 test adapter의 초기 공통 경로 증거는 RUN_LIVE에서 별도 수집합니다.

후속 EDITOR/B-06 연결에서 두 adapter 초안에 같은 사람 적용·충돌·게이트 규칙을 검증합니다. 이 task의 green만으로 US-013 C2/전체 AC-18을 완료하지 않습니다.

- [x] **Step 076: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/contract/claude-provider.test.ts tests/integration/provider-swap.test.ts tests/unit/controlled-process.test.ts
```

통과 조건은 다음과 같습니다. 프로파일 인자 transport·정책 fail-closed·error envelope·참조·정제·고정 선택·provider 교체 계약이 통과합니다. 실제 지원 활성화는 RUN_LIVE의 명시 검증 증거가 있어야 합니다.

- [x] **Step 077: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 078: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

첫 실제 연결은 설치 Claude이며 자동 test fallback이 없습니다.

관찰하지 못한 실제 model과 관리 정책을 추정하지 않습니다.

실제/fixture/test 결과를 구분한 계약 증거를 남깁니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
