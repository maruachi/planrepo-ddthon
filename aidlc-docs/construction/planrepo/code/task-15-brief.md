# CG-15 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

### CG-15 초기 실제 Claude 가상 흐름·교체 증거와 지원 판정

**구현 묶음**: B-02입니다. **선행**: CG-09, CG-10, CG-11, CG-12, CG-13, CG-14입니다.

**연결 기준**: M-008, M-015, M-016, M-018, M-019, M-032, M-033, M-034, M-035, M-036, M-037, M-038, M-049, M-050, US-004, US-009, US-010, US-011, US-013, ENT-08, ENT-10, ENT-11, ENT-26, ENT-27, ENT-28, ENT-29, ENT-30, ENT-31, SCN-15, SCN-16, SCN-17, SCN-18, SCN-19, SCN-20, NQ-04, NQ-14, NQ-15, NQ-16, NQ-17, NQ-18, NQ-19, NQ-20, NQ-21, NQ-22, NQ-23, ND-07, ND-08, ND-09, ND-10, ND-11, ND-12, ND-13, ND-14, INF-03, INF-06, INF-07, INF-08, INF-09, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/runtime/claude-verification-status.ts` | 생성합니다. | 확인된 profile/실제 증거와 미검증·제한 상태를 분리합니다. |
| `tests/helpers/claude-evidence.ts` | 생성합니다. | 증거 fixture와 보고서 schema를 정의합니다. 실제 증거를 생성하지 않습니다. |
| `tests/unit/claude-readiness.test.ts` | 생성합니다. | 설치·mock 결과를 실제 생성/격리 통과로 바꾸지 못하게 합니다. |
| `tests/live/claude-live.test.ts` | 생성합니다. | 명시 실행에서만 설치 Claude의 가상 질문/후속 문서와 제한 경계를 검증합니다. |
| `vitest.claude-live.config.ts` | 생성합니다. | tests/live 한정·직렬 실행·300초 생성 기준에 맞는 테스트 외부 제한을 정의합니다. |
| `scripts/verify-claude.mjs` | 생성합니다. | npm run verify:claude의 명시 진입점입니다. 자동 설치/로그인/설정 변경/재호출을 하지 않습니다. |
| `package.json` | 갱신합니다. | verify:claude를 명시 live 설정에 연결하고 일반 test에서 live를 제외합니다. |
| `config/claude/launch-policy.json` | 갱신합니다. | 실제 확인한 호환 profile을 반영하되 credential과 개인 경로는 넣지 않습니다. |
| `src/web/components/GenerationPanel.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `tests/e2e/bundles/run_live.spec.ts` | 생성합니다. | 같은 묶음의 실제 서버·DB·브라우저 경로와 주요 키보드 행동을 검증합니다. |
| `tests/helpers/generation-controller.ts` | 갱신합니다. | 자동 인수를 기본 정지한 TestApp에서 명시한 테스트 adapter 또는 사전 검증한 live 후보의 C-05 루프를 제어합니다. |

#### 정상 실행의 제한된 로컬 scope 종료 증거

일반 `ControlledProcessRunner`의 정상 direct child 종료는 계속 `Unknown(execution_scope_not_proven)`입니다. CG-15는 별도 restricted runner만 `/usr/bin/sandbox-exec`와 정확한 `(version 1) (allow default) (deny process-fork)` profile을 사용합니다. wrapper 실패 때 일반 runner로 자동 전환하지 않습니다.

private capability는 외부 boolean·JSON·PID로 만들지 않습니다. 현재 Darwin 25.6.0, macOS 26.6.2 build 25G83, arm64와 `/usr/bin/sandbox-exec`, process-fork profile, Claude 2.1.265 profile fingerprint를 정확히 묶습니다. repository 안의 고정 C probe source를 현재 system compiler로 앱 소유 폴더에 만들고 같은 wrapper 아래에서 실행합니다. wrapper ChildProcess PID와 exec 뒤 probe PID가 같아야 합니다. `fork`, `vfork`, `posix_spawn`, `posix_spawnp`가 모두 거절되어야 capability를 발급합니다. compiler·wrapper·OS·probe가 지원되지 않거나 결과가 달라지면 AI 후보만 사용할 수 없고 비AI 기능은 유지됩니다.

capability를 가진 restricted runner가 같은 `launchRef`와 동일 owned ChildProcess의 spawn, exit, close, stdout close, stderr close를 모두 관찰한 경우에만 `restricted_scope_exited`를 발급합니다. cancellation, timeout, nonzero exit도 실제 close까지 기다린 뒤 같은 종료 증거를 만들 수 있습니다. spawn throw, profile mismatch, PID 불일치, pipe 미종료는 이 증거를 만들지 않습니다. M-050은 이 private 관찰을 내부 claim과 결합한 뒤에만 정확한 slot을 해제합니다.

이 증거는 제한된 로컬 자손 생성과 그 실행의 종료만 다룹니다. `sandbox-exec`는 deprecated이고 `allow default`이므로 파일·네트워크·credential·전역 customization 격리를 증명하지 않습니다. XPC·launchd 위임과 원격 provider 계산 종료도 증명하지 않습니다. 실제 Claude 업무 호출과 별도 canary로 해당 상태를 각각 기록합니다. 앱 crash로 ChildProcess handle과 capability를 잃는 same-boot 복구는 CG-14의 `Unknown`과 slot 보존을 유지하므로 NQ-21을 통과 처리하지 않습니다.

**인터페이스와 입력 조건**

evaluateClaudeEvidence(report) -> {actualGenerationVerified:boolean,isolationVerified:boolean,eligibleForProduct:boolean,limitations:string[]}를 src/runtime/claude-verification-status.ts에 정의합니다. report는 CLI/옵션 확인·정책 사전조건·실제 호출·실제 제한 관찰·fixture 계약·recovery 범위를 별도 필드로 가집니다. 테스트 helper의 evidenceFixture(overrides) 기본값은 모든 실제 항목 NotRun이며 프로파일을 활성화하지 않습니다.

scripts/verify-claude.mjs는 로컬 설치 Vitest의 고정 live 설정만 실행하고 최종 sanitized JSON 결과를 .planrepo/test-runs/<서버발급 testRunId>/results/claude-verification.json에 씁니다. testRunId는 외부 임의 경로가 아니며 앱 DB를 복사하지 않습니다. raw stdout/stderr·prompt·credential·host UUID·ownership token은 보고서에 넣지 않습니다. 실제 가상 초안은 의도한 격리 테스트 DB 결과로만 보존합니다.

live 설정은 일반 npm test/설치 hook에서 제외합니다. 테스트 함수 timeout은 각 승인 300초 생성과 후속 정리/검증에 충분한 외부 한도이며 제품 timeout을 늘리지 않습니다. Vitest retry와 provider 자동 재호출은 끕니다. quota/auth/network 실패는 실패/미실행이며 test adapter 성공으로 대체하지 않습니다.

첫 실제 검증 전 현재 CLI version·필수 옵션·고정 도구/hook 제어·strict empty MCP를 확인합니다. 기존 PATH·HOME·인증과 Bedrock 라우팅 환경을 보존하고 `global.anthropic.claude-opus-4-8`을 사용합니다. 전체 MDM·전역 문맥의 부재를 입증하지 못한 사실만으로 승인된 가상 호출을 막지 않습니다. 관찰된 자동 명령·managed MCP 충돌 또는 고정 profile을 적용할 수 없는 구체적 실패는 호출 전에 거절합니다. 이 기준은 `claude-execution-decision.md`와 최신 사용자 지시를 따릅니다. 실제 검증 전 일반 제품 eligibility를 켜지 않으며, 후보 검증 진입점은 HTTP/API에서 접근할 수 없습니다.

NQ-20/AC-17 전체 중 B-02는 질문·사람 답변·후속 문서·사람 적용의 초기 증거입니다. G1/G2/Handoff 완료는 B-05로 남깁니다. same-boot crash NQ-21 미통과는 실제 생성 성공과 무관하게 보고서 limitations에 유지합니다.

CG-12의 generation-controller에 startLiveCandidate(candidate)를 추가합니다. candidate는 CG-13의 비생성 사전 검사를 통과한 비공개 결과이며 임의 JSON이나 passed 플래그로 만들 수 없습니다. verify:claude의 명시 live 테스트만 이를 전달하고 실제 C-05 루프를 켭니다. 일반 TestApp은 manual/paused를 유지하며 제품 eligibility는 실제 검증 결과 전에는 바꾸지 않습니다. stop/close는 소유 실행 종료와 증거 보존 계약을 따릅니다.

- [x] **Step 085: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { evaluateClaudeEvidence } from '@/src/runtime/claude-verification-status';
import { evidenceFixture } from '@/tests/helpers/claude-evidence';

it('does not activate real Claude from installation and mock evidence alone', () => {
  const report = evidenceFixture({
    cliProbe: 'Passed', optionProbe: 'Passed', fixtureContract: 'Passed',
    policyPreflight: 'Passed', actualGeneration: 'NotRun',
    actualIsolation: 'NotRun', sameBootRecovery: 'KnownUnsupported'
  });
  const status = evaluateClaudeEvidence(report);
  expect(status).toMatchObject({
    actualGenerationVerified: false,
    isolationVerified: false,
    eligibleForProduct: false
  });
  expect(status.limitations).toContain('NQ21_SAME_BOOT_IDENTITY_UNAVAILABLE');
});
```

- [x] **Step 086: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/unit/claude-readiness.test.ts -t "does not activate real Claude"
```

예상 결과는 다음과 같습니다. 설치 확인/fixture 통과만으로 실제 연결을 활성화하거나 same-boot 복구 미지원 표시를 지우는 구현에서 assertion이 실패해야 합니다.

- [x] **Step 087: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

실제 검증은 계획 승인 범위의 가상 자료만 사용하고 package 설치/기본 테스트에서 자동 실행하지 않습니다. 현재 PATH의 Claude·version·help를 다시 확인하되 옵션이나 모델 ID를 추측하지 않습니다. 인증 정보 출력·quota/billing/auth/global settings 변경·새 로그인/설치는 하지 않습니다.

현재 고정 profile에 구체적인 충돌이나 필수 옵션 실패가 있으면 정제한 실패와 비AI 사용 가능을 기록하고 모델을 호출하지 않습니다. 전역 문맥의 검증 한계는 limitations에 따로 남기며 실제 생성 성공이나 전체 격리 성공으로 바꾸지 않습니다. profile 검증 전에 제품 eligibility를 true로 두는 순환 우회를 만들지 않습니다. 실제 검증 목적의 제한 진입점으로 승인된 가상 후보를 검증하며 모든 제한 인자는 동일합니다.

createTestApp(DEMO-4,testRunId)의 editable SR을 선택해 M-032 질문 생성, M-033 결과/실제 표시 확인, EDITOR의 M-018로 사람 선택 적용, M-008 가상 담당자의 명시 답변 저장, 현재 답변 버전을 포함한 새 M-032 문서 생성, M-018 적용, M-016 조회로 새 불변 버전과 provenance를 확인합니다. 질문 답변/적용은 테스트가 사람 행동을 명시 실행하는 것이며 모델이 자동 승인하지 않습니다.

가상 canary는 같은 testRunId 내부의 다른 SR·허용 밖 테스트 파일·진단 전용 비밀 문자열로 제한합니다. 위험 도구/파일/승인 지시 입력에 대해 tools/MCP/session/customization/managed 근거와 실제 관찰을 함께 확인합니다. canary 무변화만으로 no-spawn/격리를 증명하지 않습니다. 원 사용자 파일·credential에 접근하도록 유도하지 않습니다.

실제 제한 생성 중 M-033/기존 M-016 조회와 취소 M-034를 검사합니다. 취소 확정·signal 시각·direct child/pipe close·정리 범위·M-050을 각각 기록합니다. 이미 완료되어 취소 실행 사례를 얻지 못하면 skipped/not-observed로 남기며 의도적으로 무한 추가 호출하지 않습니다. 실제 종료를 확인하지 못하면 slot과 한계가 남습니다.

같은 provider 계약의 test adapter를 선택한 새 Run도 동일 적용/현재 입력 거절 규칙을 통과시킵니다. 기존 Claude Run 선택·실제 모델 표시·기존 문서/게이트는 설정 변경만으로 바꾸지 않습니다. 사람 적용 뒤 입력을 변경해 stale 적용 거절을 양쪽 경로에서 확인합니다.

정제 보고서에 CLI/profile 버전·사전조건 근거의 관련 지문·실제/fixture 구분·요청/확인된 model·작업 종류·입력/결과 참조·명령/exit code·지연·terminal/종료·시나리오별 Passed/Failed/NotRun/KnownUnsupported를 기록합니다. raw 결과나 허위 actualModelId를 넣지 않습니다. 실패/정책 변경 때 profile eligibility를 유지하지 않습니다.

NQ-21 same-boot known limitation과 실제 reboot 미검증은 별도로 남깁니다. B-02에서 실제 초기 흐름이 실패하면 AC-17 성공을 선언하지 않고 원인·환경 조정 필요사항을 구체적으로 보고합니다. 별도 사용자 결정이 필요한 인증/전역설정 변경을 자동 수행하지 않습니다.

- [ ] **Step 088: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/unit/claude-readiness.test.ts
npm run verify:claude
npm run test:e2e -- tests/e2e/bundles/run_live.spec.ts
```

통과 조건은 다음과 같습니다. 첫 명령은 증거 판정 단위 테스트 GREEN입니다. 둘째 명령은 명시 실제 실행이며 옵션/정책/인증/모델 조건과 가상 생성·제한 검증이 실제로 통과한 항목만 Passed입니다. 미실행/실패/known limitation이 있으면 모두 통과한 것처럼 exit 0이나 전체 완료로 보고하지 않습니다. same-boot NQ-21 known limitation은 별도 미통과로 유지합니다.

- [x] **Step 089: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 090: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

실제 Claude 질문·답변 반영 후속 문서의 초기 증거 또는 구체적 실패/미실행 근거가 있습니다. 실패/미실행이면 실제 연결 완료 checkbox를 체크하지 않습니다.

지원 eligibility는 실제 증거에 근거하며 fixture 성공과 구분됩니다.

G1/G2/Handoff 전체 AC-17·B-06 최종 스토리와 NQ-21 한계의 미완료를 보존합니다.

이 묶음의 화면과 tests/e2e/bundles/run_live.spec.ts도 연결합니다. 서비스 테스트만으로 해당 스토리의 UI 기준을 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
