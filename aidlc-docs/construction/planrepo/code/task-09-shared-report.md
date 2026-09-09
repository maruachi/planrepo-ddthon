# CG-09 공유 backend 구현 보고

CG-09의 공개 계약, Artifact·초안 저장과 적용, 생성 입력 snapshot 저장·복원, M-047 준비 조회와 실제 composition 연결을 구현했습니다. 질문·결정 저장과 서비스는 병행 구현된 정확한 reader와 transaction API를 소비했습니다. UI와 실제 provider 실행은 이 보고 범위에 포함하지 않았습니다.

## 구현 결과

- `M-015`, `M-016`, `M-017`은 ArtifactVersion 원문과 구조, 현재 pointer, 변경 영향, activity와 receipt를 같은 `IMMEDIATE` transaction에서 저장합니다. 고정 receipt 결과와 현재 revision을 분리해 재생합니다.
- 같은 section, requirement와 Workflow task ID는 연속 version에서 유지합니다. 과거 version에서 삭제한 ID를 뒤 version의 다른 항목에 재사용하면 거절합니다.
- `M-016`은 같은 ID의 본문·완료 기준 변경과 decision ref 추가·제거를 모두 반환합니다.
- `M-018`은 초안의 불변 snapshot과 현재 fingerprint, artifact target guard를 함께 검사합니다. 질문과 결정은 사람이 고른 temporary ID를 서버 ID로 매핑하며, 결정권자와 classification을 명시 입력으로 받습니다. WorkflowPlan은 Markdown으로 추정하지 않고 정식 구조를 검사합니다.
- `M-019`은 사람이 본 원 초안을 보존하고 현재 입력과 현재 artifact target을 새 InputSnapshot에 고정합니다. 원 absent 대상이 생긴 경우 명시 검토한 새 초안만 `ARTIFACT_REVISION`으로 기록합니다. 잘못된 결과 구조는 `VALIDATION_ERROR`로 거절하며 snapshot·draft·receipt를 쓰지 않습니다.
- retry는 실패하거나 취소된 실행만 받습니다. 기존 `ARTIFACT_REVISION`은 같은 문서의 현재 exact version으로 준비하며, 원 absent 대상이 생기면 새 생성을 요구합니다.
- InputSnapshot은 원문, nullable supplement의 null·빈 문자열, participants, source 확인 상태, 질문·결정·classification·Artifact 참조와 project rule version을 복원합니다.
- M-047은 선택적 new generation, retry와 draft 준비 결과를 반환합니다. 현재 입력이 실행 상한 2 MiB를 넘으면 명시 생성 준비는 계속 거절하지만 일반 SR 상세의 기존 run은 freshness를 `unknown`으로 표시해 조회를 보존합니다.
- SOURCE 생성 입력은 CG-07 strict codec을 재사용합니다. link의 URL, 검증 가능성, 외부 version, 확인 불가 사유와 사람 확인 근거를 보존하며 저장 손상은 `STORE_UNAVAILABLE`로 변환합니다.
- `main`, `TestApp`과 공통 application composition은 같은 project rule snapshot과 M-008·M-010·M-012·M-015·M-016·M-017·M-018·M-019·M-047 handler를 사용합니다.

## 주요 TDD 근거

- SOURCE first consumer 회귀 `./node_modules/.bin/vitest run tests/unit/generation-snapshot.test.ts -t "link source"`의 첫 실행은 exit 1이었습니다. link의 `verifiable`, `observedExternalVersion`, `unavailableReason`가 생성 입력에서 빠졌습니다. strict source reader를 연결한 뒤 exit 0, 1개가 통과했습니다.
- Artifact 저장 scaffold의 첫 HTTP 회귀는 새 absent 문서를 저장하지 못해 기대한 RED였습니다. 최소 저장·guard·receipt·ReviewImpact 연결 뒤 동시 absent 제출에서 한 건만 확정하고 다른 한 건을 `STALE_VERSION`으로 거절했습니다.
- replay 현재성 및 역사 ID 회귀 세 건의 첫 실행은 exit 1이었고 두 건이 실패했습니다. 과거 receipt가 현재 revision을 고정값으로 반환했고 삭제한 ID를 뒤 version에서 다시 허용했습니다. history 조회와 현재 basis 분리 뒤 세 건이 통과했습니다.
- M-047 preparation 첫 실행은 빈 supplement를 계약이 거절해 exit 1이었습니다. 빈 문자열과 null을 구분하도록 schema와 snapshot codec을 맞춘 뒤 통과했습니다.
- 저장 WorkflowPlan strict 검사를 추가한 관련 실행은 exit 1이며 102개 중 정상 DEMO-4 M-047 세 건이 실패했습니다. 한국어 조사와 붙은 requirement ID까지 새 작성용 Markdown 규칙으로 재검사한 것이 원인이었습니다. 저장 codec을 JSON 구조·고유 ID·순서·requirement 관계 검사로 좁힌 뒤 정상 시드와 손상 fixture를 모두 구분했습니다.
- 대용량 source 두 건 뒤 평범한 M-047이 `VALIDATION_ERROR`가 되는 실제 HTTP RED를 확인했습니다. 현재 fingerprint port가 `GenerationInputTooLargeError`만 판정 불가로 처리하게 고친 뒤 `./node_modules/.bin/vitest run tests/integration/generation-preparation.test.ts -t "현재 입력이 생성 한도를"`는 exit 0이며 1개가 통과하고 2개를 선택 제외했습니다.
- 제거된 decision ref, 중복 검토 제안 무쓰기, revision retry의 현재 exact target, 손상 WorkflowPlan 503 회귀를 추가했습니다. `./node_modules/.bin/vitest run tests/integration/artifact-edit.test.ts tests/integration/generation-preparation.test.ts`는 exit 0이며 15개가 통과했습니다.

## 최종 검증

- `./node_modules/.bin/vitest run tests/contract/public-methods.test.ts tests/unit/generation-snapshot.test.ts tests/unit/review-impact.test.ts tests/integration/version-review-impact.test.ts tests/integration/generation-preparation.test.ts tests/integration/artifact-edit.test.ts tests/integration/sr-services.test.ts tests/integration/context-source.test.ts tests/integration/question-decision-service.test.ts`는 exit 0입니다. 9개 파일의 100개 테스트가 통과했습니다.
- 저장 Artifact의 범위·ID·이전 version·추적 ref·WorkflowPlan 관계 codec을 마지막으로 강화한 뒤 `./node_modules/.bin/vitest run tests/integration/artifact-edit.test.ts tests/integration/generation-preparation.test.ts tests/integration/context-source.test.ts`는 exit 0입니다. 3개 파일의 23개 테스트가 통과했습니다.
- `./node_modules/.bin/tsc -p /tmp/tsconfig.planrepo-cg09-shared.json --noEmit`은 exit 0입니다. 이 범위와 무관하게 작성 중인 CG-13 provider 계약 테스트와 Q/Decision UI E2E 파일만 제외했습니다.
- `./node_modules/.bin/tsc -p tsconfig.web.json --noEmit`은 exit 0입니다.
- `npm run typecheck`는 exit 1입니다. 병행 CG-13 소유 `tests/contract/claude-provider.test.ts:137`과 `tests/contract/claude-provider.test.ts:238`의 `ProviderRequest.snapshot` union narrowing 오류에서 서버 검사가 멈췄습니다. 이 파일은 수정하지 않았습니다.

실제 Claude, 브라우저, 성능과 복구 검사는 실행하지 않았습니다. 실제 provider 실행과 생성 접수는 후속 CG-10 이후 범위입니다.

## Fix round 1/5

- 독립 검토 결과는 Critical 0개, Important 2개였습니다. 현재 snapshot의 중첩 `question_answer` ref를 M-019가 입력 검증에서는 허용했지만 저장 draft 재조회가 top-level ref만 인정해 전체 transaction을 rollback했습니다. M-019 receipt 재생의 `current`는 새 사람 검토 초안이 아니라 원 source draft의 target과 fingerprint를 반환했습니다.
- `./node_modules/.bin/vitest run tests/integration/artifact-edit.test.ts -t '오래된 원 초안|명시 question answer ref'`의 RED는 exit 1이며 2개가 실패하고 11개를 선택 제외했습니다. 첫 회귀는 replay target과 fingerprint가 새 draft와 달랐고, 둘째 회귀는 유효한 선택 답변 근거를 포함한 M-019가 `ok:false`를 반환했습니다.
- `PreparedGenerationSnapshot.basisRefs`에서만 누락 ref를 명시 top-level snapshot item으로 저장합니다. 저장 content JSON은 재귀 해석하지 않습니다. 공통 ref key는 kind, project, SR scope, entity와 version을 모두 포함하며 strict InputSnapshot codec과 저장 draft reader가 같은 helper를 사용합니다. 기존 snapshot 행과 원 provider snapshot은 바꾸지 않습니다.
- canonical 입력이 정확히 2,097,152 bytes인 실제 fixture에서 marker를 포함한 InputSnapshot은 더 커졌습니다. `./node_modules/.bin/vitest run tests/unit/generation-snapshot.test.ts -t '명시 InputSnapshot 직렬화'`의 RED는 exit 1이며 1개가 기대한 크기 오류 없이 저장됐습니다. 실제 InputSnapshot 직렬화 크기를 insert 전에 검사하도록 고친 뒤 snapshot과 업무 행을 남기지 않고 거절합니다.
- M-019 재생은 receipt의 고정 `value`를 유지하면서 그 결과 draft의 현재 preparation을 다시 읽어 `current.target`과 `current.inputFingerprint`를 반환합니다. 두 핵심 회귀를 다시 실행한 결과 exit 0이며 2개가 통과하고 11개를 선택 제외했습니다. ref 집합과 크기 회귀는 exit 0이며 2개가 통과하고 18개를 선택 제외했습니다.
- 관련 검증 `./node_modules/.bin/vitest run tests/contract/public-methods.test.ts tests/unit/generation-snapshot.test.ts tests/unit/review-impact.test.ts tests/integration/version-review-impact.test.ts tests/integration/generation-preparation.test.ts tests/integration/artifact-edit.test.ts tests/integration/sr-services.test.ts tests/integration/context-source.test.ts tests/integration/question-decision-service.test.ts`는 exit 0입니다. 9개 파일의 103개 테스트가 통과했습니다.
- `./node_modules/.bin/tsc -p /tmp/tsconfig.planrepo-cg09-fix1.json --noEmit`과 `./node_modules/.bin/tsc -p tsconfig.web.json --noEmit`은 exit 0입니다. `npm run typecheck`는 exit 1입니다. 병행 CG-13 소유 `src/providers/generation/claude-profile.ts`의 WIP TS2322 두 건과 `tests/contract/claude-provider.test.ts`의 WIP TS2322 한 건이 원인입니다. CG-09 수정 경로와 직접 의존은 provider WIP만 제외한 scoped 검사에서 통과했습니다.
- 최종 ProviderRequest의 정확한 bytes는 서버 고정 ProviderSelection을 합친 뒤에만 계산할 수 있습니다. 현재 runner는 직렬화 요청이 2 MiB를 넘으면 spawn 전에 거절합니다. CG-10 M-032는 같은 정확한 직렬화 검사를 transaction 확정 전에 적용해 실패 Run 없이 입력 축소를 안내해야 합니다.

## Fix round 2/5

- fix1 재검토에서 원 Important 두 건은 해결됐고 새 Important 한 건이 확인됐습니다. 공통 snapshot decoder가 `question`과 `sr` 같은 entity 전용 kind에도 `version`을 허용해 잘못된 저장 ref를 정상 VersionRef로 반환했습니다.
- `./node_modules/.bin/vitest run tests/integration/generation-preparation.test.ts -t 'entity kind에 version'`의 RED는 exit 1입니다. 1개가 실패하고 3개를 선택 제외했으며, `question`에 version을 붙인 손상 snapshot과 succeeded draft를 M-047이 `ok:true`로 반환했습니다.
- snapshot codec의 SR entity kind와 SR version kind를 분리했습니다. `question`과 `sr`의 version을 거절하고 `review_policy`는 project 범위, `srId` 부재와 양의 version을 함께 검사합니다. 기존 top-level marker와 legacy snapshot 불변 처리는 유지합니다.
- 같은 회귀의 GREEN은 exit 0입니다. 1개가 통과하고 3개를 선택 제외했습니다. project ref에 `srId`가 섞인 저장 입력도 codec 단위에서 거절하도록 검사했습니다.
- 관련 검증 `./node_modules/.bin/vitest run tests/integration/generation-preparation.test.ts tests/integration/artifact-edit.test.ts tests/unit/generation-snapshot.test.ts`는 exit 0입니다. 3개 파일의 37개 테스트가 통과했습니다. `./node_modules/.bin/tsc -p /tmp/tsconfig.planrepo-cg09-fix1.json --noEmit`과 `./node_modules/.bin/tsc -p tsconfig.web.json --noEmit`도 exit 0입니다.
- M-019 선택 답변 회귀는 `selectedAnswer`가 없을 때 조용히 끝내지 않고 명시 assertion과 오류로 실패하도록 바꿨습니다. decision 30 조회 변경은 이 fix에 포함하지 않았습니다.
