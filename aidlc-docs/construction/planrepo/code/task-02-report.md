# CG-02 구현 보고

- 상태: DONE
- 과제: CG-02 CONTRACT
- 범위: 공통 자료형, 50개 서비스 계약, 공개 메서드 경계, Fastify JSON schema, provider 독립 계약

## 구현 결과

- `src/contracts/context.ts`에 ProjectScope, SrScope, ActorContext, RuntimeContext, VersionRef, BundleRef와 자원별 WriteGuard를 정의했습니다.
- `src/contracts/results.ts`에 Committed, Replayed, Rejected를 분리한 CommandResult와 CommandReceipt, DomainError, CurrentBasis, GateAssessment를 정의했습니다.
- `src/contracts/views.ts`에 승인된 입력 DTO와 조회·문서·검토·생성·인계 화면 DTO를 구체 타입으로 정의했습니다. 필수 배열은 NonEmpty로, 상태별 조건은 판별 union으로 표현했습니다.
- `src/contracts/methods.ts`에 M-001부터 M-050까지 승인 서비스·메서드·종류·범위·공개 여부·guard를 명시 등록했습니다. 공개 44개와 내부 6개를 분리했습니다.
- `src/contracts/schemas.ts`에 공개 44개 요청 schema와 정상 요청 예제를 등록했습니다. 모든 객체는 미지원 필드를 거절하고, 조건부 입력은 oneOf와 discriminator로 구분합니다.
- `src/providers/generation/provider-contract.ts`에 GenerationProvider, ProviderRequest, ExecutionControl, ProviderOutcome을 정의했습니다. DB, RuntimeContext, HTTP actor, ClaimRef를 provider 입력에서 제외했습니다.

M-003과 M-004는 신규 ID나 가짜 expectedRevision을 받지 않습니다. 서버가 원자적 고유성을 판정합니다. M-021은 정확한 BundleRef와 reviewEpoch만 guard로 받습니다. M-032는 expectedInputFingerprint를 meta.guard 한 곳에서만 받고 ProviderSelection은 wire에서 받지 않습니다. M-034는 client expectedRevision 없이 runId만 받고 서버 내부 CAS로 처리하게 했습니다. M-038의 ProviderFailure에는 ClaimRef가 필수이며 ProviderFailureCore에는 token이 없습니다. M-040과 M-042는 정확한 G2 BundleRef와 reviewEpoch를 요구합니다.

Fastify의 기본 AJV 설정은 additionalProperties를 삭제할 수 있습니다. CG-05 HTTP 조립에서는 `removeAdditional: false`를 사용해야 미지원 필드를 400으로 거절합니다. 이번 계약 테스트는 이 실제 설정으로 44개 schema를 컴파일하고 검증했습니다.

## TDD 결과

- 첫 `npm test -- tests/contract/public-methods.test.ts`는 exit 1이었고 모듈 부재로 테스트 0개가 수집됐습니다. 도구·수집 오류로 구분하고 행동 RED로 세지 않았습니다.
- 최소 import 가능 목록에서 같은 명령은 exit 1이었고 3개 assertion이 모두 실패했습니다. 공개 44개, 내부 6개, 전체 50개가 아직 비어 있는 예상 RED였습니다.
- 목록 최소 구현 뒤 같은 명령은 exit 0이었고 3개가 통과했습니다.
- 임시 등록표와 실제 Fastify가 컴파일한 허용 schema에서 같은 명령은 exit 1이었고 12개 중 8개가 예상대로 실패했습니다. 서비스 등록표, 상한, scope, guard, fingerprint 위치, 미지원 필드 경계의 RED였습니다.
- 계약 구현 뒤 같은 명령은 exit 0이었고 13개가 통과했습니다.
- 질문 제안 필수 필드 누락 재현은 exit 1이었고 잘못된 입력이 200을 반환해 assertion이 실패했습니다. 필수 필드를 schema에 연결한 뒤 지정 테스트는 exit 0이었습니다.
- 정책 개정의 changeReason 누락 재현은 exit 1이었고 잘못된 입력이 200을 반환해 assertion이 실패했습니다. 최초·개정 schema를 분리한 뒤 전체 계약 테스트는 exit 0이었고 15개가 통과했습니다.

## 최종 검증

- `npm test`는 exit 0이었습니다. 테스트 파일 2개와 테스트 38개가 모두 통과했습니다.
- `npm run typecheck`는 exit 0이었습니다. server/test와 web 계약 타입 검사가 모두 통과했습니다.
- `./node_modules/.bin/esbuild src/contracts/context.ts src/contracts/results.ts src/contracts/views.ts src/contracts/methods.ts src/contracts/schemas.ts src/providers/generation/provider-contract.ts tests/contract/public-methods.test.ts --outdir=/tmp/planrepo-cg02-esbuild --platform=node --format=esm --log-level=error`는 exit 0이었습니다.
- 계약·provider·테스트 경로의 `any`와 `unknown`, 공개 schema의 RuntimeContext·ClaimRef·ownershipToken·ProviderSelection, 내부 6개 schema 등록을 검색했습니다. 검색 결과는 모두 비어 있었습니다.

## self-review와 범위

- 44개 정상 입력 예제를 실제 Fastify validator에 통과시켰습니다. 중요 경계는 독립적으로 변형한 잘못된 입력이 400인지 검사했습니다.
- JSON schema의 maxLength는 문자 제한입니다. 1 MiB Markdown, 2 MiB 생성 입력, 8 MiB 요청의 실제 UTF-8 byte 검사는 상수로 분리했으며 HTTP·서비스 과제에서 수신 bytes 검사와 연결해야 합니다.
- 저장소, DB schema, 권한 판정, 실제 업무 변경, HTTP route, provider 구현은 만들지 않았습니다.
- Claude, 브라우저, native DB, 성능, 복구 검증은 이 과제 범위가 아니므로 실행하지 않았습니다.
- Security Baseline, Resiliency Baseline, PBT 확장은 비활성 상태이므로 개별 규칙 적용은 N/A입니다.
- 위임 경계에 따라 `aidlc-docs/audit.md`, `aidlc-docs/aidlc-state.md`, `aidlc-docs/README.md`는 수정하지 않았습니다.

## Fix round 1/5

- 독립 검토 결과: Spec 미준수, Critical 0개, Important 6개였습니다.
- runtime RED: `npm test -- tests/contract/public-methods.test.ts`는 exit 1이었습니다. 18개 중 4개가 실패했습니다. 잘못된 guard 대상 kind, `srId` 없는 질문 EntityRef, G1 인계 입력·guard는 기존 schema가 기대 400 대신 200으로 통과시켰습니다. target 없는 질문 제안 적용은 반대로 유효한 요청이 기대 200 대신 400으로 거절됐습니다.
- 타입 RED: `npm run typecheck`는 exit 1이었습니다. 조건부 계약 6개의 `@ts-expect-error`가 사용되지 않아 TS2578이 발생했습니다. 테스트 fixture의 union spread가 일으킨 TS2698도 함께 확인해 fixture를 객체로 좁혔습니다. `@ts-expect-error` 사례는 choice 질문의 options, artifact InputSnapshot의 documentKind·targetBasis, applied 상태의 applicationId, succeeded Run의 draft·finishedAt, failed Run의 error·finishedAt, completed 구현의 완료 사실 누락을 각각 겨냥했습니다.
- guard schema: 자원 kind별 revision expectation을 만들고 M-008 question, M-023 review_gate_state, M-028 sr를 포함한 모든 명령 등록에 구체 target schema를 연결했습니다. artifact 현재/absent guard도 artifact만 허용합니다.
- EntityRef: project·review_policy는 ProjectScope, SR 하위 kind는 필수 SrScope, activity는 project 또는 SR 문맥을 보존하는 판별 union으로 나눴습니다. Fastify schema도 같은 세 범위를 oneOf로 검사합니다.
- M-005: 변경 기준을 불변 SRDescriptionVersion이 아니라 ENT-03의 현재 SR revision으로 수정했습니다. 타입, schema, 정상 예제의 target kind가 모두 sr입니다.
- M-018: 질문·결정 제안 적용은 artifact target 없이 각 selectedContent kind와 같은 guard discriminator를 사용합니다. 문서 적용만 targetBasis와 artifact revision/absent guard를 요구합니다. 문서 결과에 없는 temporaryId는 artifact selectedContent에서 제거했습니다. PublicMethodRequest도 input과 guard kind를 같은 union 분기로 묶었습니다.
- M-040/M-042: HandoffRequest와 GuardFor를 `BundleRef<'G2'>`로 제한했습니다. runtime schema에서 입력과 guard의 gate=G2를 각각 강제하며 G1 변형을 400으로 거절합니다.
- 조건부 DTO: FollowupQuestion, InputSnapshot, DraftApplicationStatus, GenerationRunView, ImplementationView를 상태별 판별 union으로 바꿨습니다. Run에는 requestedBy·requestedAt과 running/succeeded/failed/cancelled별 필수 시각·결과·오류·취소 주체를 연결했습니다. 정상 타입 fixture도 함께 두었습니다.
- self-review 추가 RED: M-020의 G2 검토 요청에 G2 묶음을 g1BundleRef로 넣은 변형이 기대 400 대신 200으로 통과했습니다. g1BundleRef를 타입과 schema 모두 `BundleRef<'G1'>`로 제한했습니다.
- targeted GREEN: `npm test -- tests/contract/public-methods.test.ts`는 exit 0이었고 19개가 통과했습니다.
- 타입 GREEN: `npm run typecheck`는 exit 0이었습니다. server/test와 web 타입 검사가 모두 통과했고 6개 잘못된 상태의 `@ts-expect-error`가 실제 타입 오류를 소비했습니다.
- 관련 전체 검증: `npm test`는 exit 0이었습니다. 테스트 파일 2개와 테스트 42개가 모두 통과했습니다.
- 구문 검증: 소유 TypeScript 7개 경로의 esbuild 변환은 exit 0이었습니다.
- 설치, DB, Claude 검증은 반복하지 않았습니다. 내부 ClaimRef guard 메타데이터 표현과 일부 테스트 이름 범위의 Minor 2개는 이번 차단 조건이 아니어서 최종 검토 목록에 유지합니다.

## Fix round 2/5

- 열린 경계는 `PublicMethodRequest<'M-018'>`가 질문·결정 적용 요청을 표현하지 못하는 문제 한 가지였습니다.
- 타입 RED: 두 정상 할당 사례와 잘못 짝지은 input/guard 사례를 `tests/contract/public-methods.test.ts`에 먼저 추가했습니다. `npm run typecheck`는 exit 1이었습니다. 정상 질문·결정 요청의 `selectedContent.kind`와 `guard.kind` 네 곳에서 각각 `"questions"` 또는 `"decisions"`가 `"artifact"`에 할당될 수 없다는 TS2322가 발생했습니다. 수정 전에는 잘못 짝지은 사례의 `@ts-expect-error`도 선언 위치에서 오류를 소비하지 못해 TS2578이 함께 발생했습니다.
- 최소 수정: `DraftApplication`과 `DraftApplicationGuard`의 질문·결정 분기를 각각 독립된 최상위 union member로 분리했습니다. `PublicMethodRequest<'M-018'>`의 기존 `Extract`가 세 kind를 각각 추출하며 input과 guard의 kind를 같은 요청 분기에 묶습니다.
- 타입 GREEN: `npm run typecheck`는 exit 0이었습니다. 질문·결정 정상 요청이 모두 할당됐고, 잘못 짝지은 요청의 `@ts-expect-error`는 실제 타입 오류를 소비했습니다.
- 계약 GREEN: `npm test -- tests/contract/public-methods.test.ts`는 exit 0이었습니다. 테스트 파일 1개와 테스트 19개가 모두 통과했습니다.
- 다른 finding과 runtime schema는 변경하지 않았습니다. 재설치, 전체 smoke, Claude, 하위 agent, commit은 실행하지 않았습니다.
