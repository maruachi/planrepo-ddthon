# CG-15 Claude 실제 검증과 제한 실행 보고

## 구현 결과

현재 CLI 2.1.265와 고정 profile fingerprint를 일치시켰습니다. 설치·fixture·외부 JSON의 통과 모양만으로 제품 지원을 판정하지 않습니다. `evaluateClaudeEvidence`는 exact profile, CLI, preflight, 실제 생성, 실제 제한 실행을 모두 확인합니다. same-boot 복구 미지원은 별도 limitation으로 유지합니다.

repo-local C probe는 Darwin 25.6.0, macOS 26.6.2 build 25G83, arm64에서 `/usr/bin/sandbox-exec`의 `deny process-fork`를 확인합니다. 같은 wrapper PID에서 `fork`, `vfork`, `posix_spawn`, `posix_spawnp`가 모두 EPERM이어야 private capability를 발급합니다. restricted runner는 같은 `launchRef`의 owned child exit·close와 stdout·stderr close를 모두 관찰한 뒤에만 `restricted_scope_exited`를 냅니다. nonzero, 취소, timeout은 실행 결과와 종료 관찰을 분리합니다. wrapper나 profile이 맞지 않으면 일반 runner로 fallback하지 않습니다.

`main`은 현재 profile의 private 후보를 준비한 경우에만 provider를 등록합니다. recovery가 unresolved 없이 끝난 뒤 generation readiness를 켭니다. CLI/profile/provider 초기화가 실패하면 빈 registry와 generation paused 상태로 비AI HTTP와 storage를 유지합니다. 일반 TestApp은 계속 paused이며 명시 `startLiveCandidate`만 실제 provider loop를 시작합니다.

`npm run verify:claude`는 UUID별 `.planrepo/test-runs/<testRunId>`만 사용합니다. 일반 Vitest 수집과 retry에서 제외했습니다. raw prompt, stdout, stderr, credential, host UUID, ownership token은 보고서에 쓰지 않습니다. 실패도 정제한 이유와 nonzero exit로 남깁니다.

## TDD와 실제 실행

첫 readiness RED는 설치와 fixture만 통과한 보고서가 `eligibleForProduct:true`가 되어 예상 assertion으로 exit 1이었습니다. 실제 증거 분리 뒤 GREEN이 됐습니다. 다른 profile의 passed 보고서도 처음에는 eligibility를 켜 exit 1이었고, exact version·fingerprint 대조 뒤 `tests/unit/claude-readiness.test.ts` 4개가 통과했습니다.

제한 실행 첫 RED는 미구현 capability가 Unsupported를 반환했습니다. 다음 RED에서는 정상 child가 `Unknown(execution_scope_not_proven)`으로 끝났습니다. capability와 restricted 관찰을 연결한 뒤 실제 macOS probe, 정상 종료, nonzero, 취소, timeout, profile mismatch와 live preflight 7개가 통과했습니다. C-05 연결은 `restricted_scope_exited` M-050 저장 뒤 singleton slot을 해제하고 다음 M-032를 접수했습니다.

첫 `npm run verify:claude`는 모델 호출 전에 결과 폴더를 먼저 만들어 TestApp의 `mkdir`가 EEXIST가 되어 exit 1이었습니다. 이 실행은 9ms에 끝났고 모델 호출은 0회였습니다. TestApp이 업무 DB를 정리한 뒤 같은 UUID 결과 경로를 만드는 방식으로 고쳤습니다.

두 번째 `npm run verify:claude`는 exit 0이며 live 1개가 33.37초에 통과했습니다. 실제 CLI 2.1.265와 `global.anthropic.claude-opus-4-8`로 `QUESTION_PROPOSALS`를 생성했습니다. 사람이 M-018로 질문을 선택하고 M-008로 답변한 뒤, 그 답변 snapshot을 포함한 `ARTIFACT_REVISION`을 다시 생성했습니다. 사람이 구조와 원문을 확인해 M-018로 적용했고 M-016으로 불변 v1과 새 v2를 비교했습니다. 두 Run의 requested/actual model이 일치하고 status는 succeeded이며 종료는 `restricted_scope_exited`였습니다. 첫 Run slot 해제 뒤 두 번째 Run이 접수됐으므로 임의 slot 초기화는 없었습니다. 자동 retry와 provider fallback도 없었습니다.

정제 결과는 `.planrepo/test-runs/a30f1281-bc8a-4cc3-b62b-87f8322e24cb/results/claude-verification.json`에 있습니다. `actualIsolation:Passed`는 이 두 실행의 로컬 자손 생성 제한과 owned wrapper 종료만 뜻합니다. 파일·네트워크 격리, 전체 전역 customization 부재, XPC·launchd 위임, 원격 계산 종료는 증명하지 않습니다. 실제 취소는 두 bounded 호출이 먼저 완료되어 추가 호출 없이 NotRun으로 남깁니다. NQ-21 same-boot 복구도 `KnownUnsupported`입니다.

최종 `./node_modules/.bin/vitest run tests/unit/claude-readiness.test.ts tests/contract/claude-provider.test.ts tests/integration/provider-evidence.test.ts tests/integration/restricted-process-os.test.ts tests/integration/restricted-generation-loop.test.ts tests/integration/claude-startup.test.ts tests/integration/generation-loop.test.ts`는 exit 0이며 7개 파일 45개 테스트가 통과했습니다. `npm run typecheck`은 server와 web 모두 exit 0입니다. `npm run build`도 exit 0이며 207개 module을 변환했습니다. Vite의 기존 native config loader 경고와 500 kB chunk 경고는 남았습니다.

## 남은 범위

후속 프로토타입 우선 지시에 따라 새 `src/web/components/GenerationAssistant.tsx`와 전용 CSS를 만들었습니다. M-047의 exact preparation을 읽고 M-032를 접수하며 M-033을 polling합니다. 질문과 requirements/workflow_plan 초안을 구분하고, 현재 문서가 있으면 exact version을 대상으로 개정합니다. owner만 실행과 M-035 재시도를 시작할 수 있습니다. AI가 준비되지 않았거나 실패하면 수동 질문·문서 저장 경로를 안내하며 답변·적용·승인을 자동 변경하지 않습니다. root 소유 단계 화면에 연결하기 전 `npm run typecheck`과 `npm run build`는 exit 0이었습니다. optional callback 보정 뒤 마지막 전역 typecheck는 병행 중인 `src/web/App.tsx`가 아직 없는 `SRRegistrationForm`을 import하고 `srId`가 implicit any여서 exit 1이었습니다. CG-15 컴포넌트와 직접 의존만 넣은 `/tmp/tsconfig-cg15-assistant.json`은 exit 0입니다.

`tests/e2e/bundles/run_live.spec.ts`는 아직 만들거나 실행하지 않았습니다. 따라서 Step 088과 Step 090은 체크하지 않았습니다. G1/G2/Handoff 전체 AC-17, 실제 취소 관찰, same-boot crash NQ-21도 이번 backend/runtime 증거로 통과 처리하지 않습니다.
