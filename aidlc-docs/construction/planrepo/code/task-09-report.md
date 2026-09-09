# CG-09 독립 경계 부분 보고

CG-09 전체 중 Artifact 입력 규칙, 문서 표시와 생성 입력 snapshot 계산의 독립 경계만 구현했습니다. 변경 서비스·snapshot 저장·HTTP·UI 연결과 CG-09 전체 완료 처리는 하지 않았습니다.

## 구현한 경계

- `src/domain/artifact-rules.ts`는 absent/version 현재 basis 대조, 문서 종류와 designStage 조합, Markdown UTF-8 1 MiB 상한을 검사합니다.
- section ID와 requirement ID의 고유성, 원문 offset·겹침·heading 일치, requirementLinks의 section·원문·완료 기준을 검사합니다.
- Artifact·DecisionVersion·ContextSourceVersion·QuestionResultSnapshot 참조의 project/SR 범위와 version을 검사합니다. WorkflowPlan의 stage·task·요구사항·검증·설계 문서 연결도 검사합니다.
- 반환한 `basisRecheck.mustRecheckUnderWriteLock=true`는 순수 검사를 저장 현재성 판정으로 사용하지 못하게 합니다. 서비스는 쓰기 lock 안에서 현재 version을 다시 읽어 `matchesArtifactBasis`로 대조해야 합니다.
- `src/presentation/documents.ts`는 저장 원문을 그대로 가진 render model과 원문 비교를 제공합니다. raw HTML 해석과 image 자동 요청은 정책으로 끄고, http/https 외부 링크와 문서 anchor만 분류합니다. HTML 문자열이나 `innerHTML` 입력은 만들지 않습니다.
- `src/persistence/generation-input-repository.ts`는 호출자가 제공한 DB connection에서 SQL 읽기만 수행합니다. 현재 설명 원문, source 내용·확인 근거, 질문 결과·선택한 실제 답변, 결정 정의·현재 확정 version, 실제 참조 classification과 모든 현재 Artifact 원문·index·trace·WorkflowPlan 전용 자료를 읽습니다. JSON ref는 같은 SR 범위와 실제 row kind를 검사합니다.
- `src/application/generation-snapshot.ts`는 GenerationInput, 현재 workflow와 전체 입력 자료, 고정 프로젝트 규칙을 schemaVersion 1 canonical envelope로 만듭니다. 의미 배열과 Unicode·공백·줄바꿈은 보존하고 참조 집합만 code-unit 비교로 정렬합니다. UTF-8 2 MiB를 넘는 입력은 거절하며 SHA-256 fingerprint, basisRefs와 projectRuleVersions를 반환합니다. provider, runtime, host와 capturedAt은 envelope에 넣지 않습니다.
- `src/runtime/project-rule-source.ts`는 프로젝트 root의 고정 `config/generation/project-rules.json`만 동기적으로 읽습니다. root 밖 symlink를 거절하고 logical ID 중복과 자산 형태를 검사합니다. 규칙 version은 schemaVersion·mtime이 아닌 정확한 content의 SHA-256입니다. 반환한 snapshot을 freeze하므로 같은 runtime source 인스턴스는 파일 변경으로 바뀌지 않습니다.
- `config/generation/project-rules.json`에는 가정과 근거, 사람 확정 권한, 개별 승인과 gate 분리, 불변 version 이력, 업무별 흐름과 SR 범위 추적 규칙만 명시했습니다. AI-DLC 지시, 감사 기록과 개인 설정을 자동 입력으로 사용하지 않습니다.

## TDD와 검증

- scaffold 뒤 `npm test -- tests/unit/artifact-rules.test.ts tests/unit/documents.test.ts`는 exit 1이었습니다. 10개 중 9개 행동 assertion이 실패하고 정책 형태 1개만 통과했습니다. basis가 항상 true였고 구조 위반을 받지 않았으며 비교 changed와 허용 링크가 구현되지 않은 것이 원인이었습니다.
- 최소 구현 뒤 같은 명령은 exit 0이었습니다. 테스트 파일 2개와 테스트 10개가 통과했습니다.
- `npm run typecheck`는 작성 중인 CG-08의 `src/web/api/client.ts:124` 구문 오류 TS1434·TS1109 때문에 exit 1이었습니다.
- CG-09 순수 도메인·표시 코드와 단위 테스트를 포함하는 `./node_modules/.bin/tsc -p tsconfig.server.json --noEmit`은 exit 0이었습니다.
- 생성 입력 scaffold 뒤 첫 `npm test -- tests/unit/generation-snapshot.test.ts`는 exit 1이었습니다. 8개가 실패했지만 symlink 정리와 append-only fixture 설정 오류 2건이 섞여 이 실행은 행동 RED 근거로 세지 않았습니다.
- fixture를 고친 뒤 같은 명령은 exit 1이었고 8개 행동 assertion이 모두 실패했습니다. 규칙 source, 현재 DB basis, canonical envelope와 2 MiB 검사가 scaffold의 명시적 미구현 오류 또는 빈 결과를 반환해 기대한 RED를 확인했습니다.
- 최소 구현과 자산·참조 집합 회귀를 추가한 실행은 exit 1이었고 10개 중 6개가 실패했습니다. 실제 프로젝트 규칙 자산 부재, classification의 version ref와 entity ref 혼동, 참조 집합 비정렬이 원인이었습니다. 고친 뒤 같은 명령은 exit 0이며 10개가 통과했습니다.
- 실제 confirmed source와 선택 answer 원문, 정확한 2 MiB 경계 fixture를 추가한 `npm test -- tests/unit/generation-snapshot.test.ts`는 exit 0이며 11개가 통과했습니다.
- 현재 질문 결과가 이전 classification pointer와 다른 정확한 version을 참조하는 회귀를 추가한 같은 명령은 exit 1이었습니다. 12개 중 1개가 실패했고 repository가 이전 classification version을 반환했습니다. current question result와 confirmed decision version의 참조를 직접 읽도록 고친 뒤 12개가 통과했습니다.
- 현재 Artifact version과 absent target, WorkflowPlan 전용 자료 검사를 더한 최종 `npm test -- tests/unit/generation-snapshot.test.ts`는 exit 0이며 13개가 통과했습니다.
- 생성 입력 repository·calculator·rule source와 기존 순수 경계를 포함한 최종 `./node_modules/.bin/tsc -p tsconfig.server.json --noEmit`은 exit 0이었습니다.

## 순수 문서 경계 독립 검토 fix round 1

- 독립 검토에서 `REQ-1`이 `REQ-10` heading과 본문에 포함되기만 해도 section·requirement 원문 검사가 통과하는 문제를 재현했습니다. blockquote와 fenced code 안의 heading도 index 원문으로 오인할 수 있었습니다.
- `workflow_plan` kind에 `workflowVersion`, `implementationUnitCount`, `stages`, `requirementTaskLinks`를 모두 생략하면 ENT-09의 ArtifactVersion 1:1 구조 없이 통과하는 문제도 재현했습니다.
- 회귀를 추가한 `npm test -- tests/unit/artifact-rules.test.ts`는 exit 1이었고 9개 중 이 두 행동 test가 실패했습니다. Markdown의 실제 H2 heading과 ID 경계를 검사하고 blockquote·fenced code를 제외했습니다. `workflow_plan` kind는 네 구조 필드를 항상 요구하고, 다른 kind에 WorkflowPlan 구조가 섞이는 경우도 거절하도록 고쳤습니다. 수정 후 같은 명령은 exit 0이며 9개가 통과했습니다.
- 정확한 section ID 뒤에 표시 제목이 붙은 유효한 heading을 보존하는 회귀를 추가한 같은 명령은 exit 1이었고 10개 중 1개가 실패했습니다. heading 전체 문자열 일치 대신 첫 ID의 정확한 경계를 검사하도록 좁힌 뒤 exit 0이며 10개가 통과했습니다.
- `npm test -- tests/unit/artifact-rules.test.ts tests/unit/documents.test.ts`는 exit 0이며 2개 파일의 13개가 통과했습니다.
- 병렬 실행한 첫 `./node_modules/.bin/tsc -p tsconfig.server.json --noEmit`은 exit 1이었습니다. nullable regex match의 heading indent를 직접 읽은 TS18047 1건을 optional access로 고쳤습니다. 재실행은 exit 0이었습니다. 이 타입 수정은 검증된 heading 값의 접근 방식만 좁혀 동작 test를 반복하지 않았습니다.

## 순수 문서 경계 독립 검토 fix round 2

- 독립 재검토에서 requirement ID 후보마다 앞뒤 문자열 전체를 `Array.from`으로 복사해 1 MiB보다 훨씬 작은 입력도 동기 검사가 오래 걸리는 문제를 재현했습니다.
- 35,009 bytes Markdown에 `REQ-10` 부분 후보 5,000개를 둔 bounded 회귀를 추가했습니다. `npm test -- tests/unit/artifact-rules.test.ts`는 exit 1이었고 11개 중 성능 test 1개가 실패했습니다. 검사 자체가 1,136.8 ms여서 500 ms 상한을 넘었습니다.
- 후보 바로 앞과 뒤의 Unicode code point만 상수 시간으로 읽도록 바꿨습니다. surrogate pair 경계도 인접 code unit으로 좁혀 읽으며 ID 의미 검사는 유지합니다. 같은 명령은 exit 0이며 11개가 통과했고 전체 파일 실행 시간은 126 ms였습니다.
- `npm test -- tests/unit/artifact-rules.test.ts tests/unit/documents.test.ts`는 exit 0이며 2개 파일의 14개가 통과했습니다. `./node_modules/.bin/tsc -p tsconfig.server.json --noEmit`도 exit 0이었습니다.

## 생성 입력 typed basis 독립 검토 fix round 1

- `implementation-decisions.md` 결정 24와 `task-09-brief.md`의 생성 입력 계약에 맞춰 `src/domain/artifact-target.ts`를 공통 logical target 경계로 추가했습니다. 일반 문서는 `requirements`, `workflow_plan`, `implementation_plan`을 사용합니다. 설계 문서는 `design:application`, `design:functional`, `design:nfr`, `design:infrastructure`만 허용하며 bare `design`은 거절합니다.
- `src/persistence/generation-input-repository.ts`의 `Readonly<Record<string, unknown>>` 기반 공개 입력을 현재 설명, source, 질문 결과와 실제 선택 답변, 결정 정의와 현재 확정 version, classification, Artifact와 WorkflowPlan의 명시 타입으로 바꿨습니다. 저장 JSON은 `unknown`으로 읽은 뒤 필드별 codec으로 좁힙니다. raw payload를 생성 모델 입력으로 복사하지 않습니다.
- Artifact payload의 `decisionRefs`, `sourceRefs`, `questionResultRefs`와 결정·질문·분류의 알려진 ref 필드는 기대 kind, project/SR scope, 양의 version, 실제 row를 검사합니다. 알려진 ref 필드 안의 알 수 없는 kind, 누락 shape와 다른 실제 row kind는 거절합니다.
- 현재 Artifact에는 정규화한 `logicalKey`를 포함합니다. 개정은 정확한 현재 ArtifactVersionRef에서 kind와 designStage를 읽고, absent는 같은 logical target의 존재만 검사합니다. 다른 design stage는 별도 absent target으로 처리합니다. canonical envelope에도 계산한 target key를 포함해 설계 단계를 fingerprint에 고정합니다.
- DEMO-4의 Artifact `design_stage` 값 한 곳을 이전 표기 `functional_design`에서 결정 24의 `functional`로 바꿨습니다. Workflow stage ID인 `functional_design`은 다른 계약이므로 유지했습니다. 기존 데이터 정규화는 후속 0002 migration 범위입니다.
- scaffold와 행동 assertion을 추가한 `npm test -- tests/unit/generation-snapshot.test.ts`는 exit 1이었습니다. 14개 중 3개가 실패했습니다. raw Artifact payload가 그대로 노출됐고, `decisionRefs`의 알 수 없는 kind가 거절되지 않았으며, `design:functional`이 기존 kind 문자열 비교에서 거절되는 기대한 RED였습니다.
- 최소 구현 뒤 같은 명령의 첫 실행은 exit 1이었고 14개 중 4개가 실패했습니다. 이 실행은 구현 보정 과정입니다. 숫자 `implementation_unit_count` codec 오류 2건, 유효한 이전 classification payload와 현재 직접 column을 과도하게 동일시한 오류 1건, 오류 문구 assertion 1건을 고쳤습니다. 재실행은 exit 0이며 14개가 통과했습니다.
- `npm test -- tests/unit/generation-snapshot.test.ts tests/integration/demo-seed.test.ts`는 exit 0이며 2개 파일의 27개가 통과했습니다. typed snapshot, exact design target, 새 seed 값과 기존 DEMO-4 회귀를 함께 확인했습니다.
- `npm run typecheck`는 exit 1이었습니다. 병행 CG-08 소유 `src/web/App.tsx:132`와 `src/web/components/SRDetailShell.tsx:25`부터 `src/web/components/SRDetailShell.tsx:38`의 optional prop·미정의 식별자 오류 6건에서 web 검사 중 멈췄습니다. 이 fix 범위를 포함하는 `npx tsc -p tsconfig.server.json --noEmit`은 exit 0이었습니다.

## 생성 참여자 입력 보완

- `GenerationBasis.participants`는 대상 SR의 `ownerId`와 같은 프로젝트의 현재 membership에서 읽은 `userId`, `displayName`만 포함합니다. member는 locale에 의존하지 않는 code-unit 비교로 `userId` 순서를 고정합니다. role과 권한, credential, runtime 정보는 조회하거나 canonical envelope에 넣지 않습니다.
- canonical envelope에 이 참여자 snapshot을 명시해 현재 프로젝트 member가 바뀌면 content fingerprint도 바뀍니다. 후속 InputSnapshot adapter는 별도 DTO나 열 없이 기존 SR content JSON에 같은 값을 저장해야 합니다.
- `PreparedGenerationSnapshot.basisRefs`는 `readonly VersionRef[]`로 좁혔습니다. 저장 JSON과 row를 정식 타입으로 해석하지 못하면 `GenerationBasisReadError`를 반환합니다. SQL 실행 오류나 예기치 않은 programmer 오류는 전체 `catch`로 감싸지 않아 후속 query가 codec 손상과 내부 오류를 구분할 수 있습니다.
- 첫 `npm test -- tests/unit/generation-snapshot.test.ts`는 exit 1이었고 17개 중 3개가 실패했습니다. 참여자 미구현 2건 외에 codec fixture가 append-only trigger에 먼저 막혔으므로 이 실행은 codec RED 근거로 세지 않습니다. 손상된 새 description version을 추가하고 current pointer를 옮기는 정상 저장 흐름으로 fixture를 고쳤습니다.
- fixture 보정 후 같은 명령은 exit 1이었고 17개 중 기대한 3개가 실패했습니다. 신규 empty workspace SR과 DEMO-4 basis에 `participants`가 없었고, 객체가 아닌 description payload이 일반 `Error`로 반환된 것이 원인이었습니다. 예기치 않은 DB/programmer 오류를 원본 그대로 반환하는 characterization test는 이 RED에서도 통과했습니다.
- 최소 구현 후 `npm test -- tests/unit/generation-snapshot.test.ts`는 exit 0이며 17개가 모두 통과했습니다. 실제 HTTP로 empty fixture에 SR을 등록한 후 소유자와 5명의 현재 member를 확인했습니다. 다른 프로젝트 member는 fingerprint에 영향을 주지 않았고, 같은 프로젝트 member가 바뀌면 fingerprint가 바뀌었습니다.
- `npx tsc -p tsconfig.server.json --noEmit`과 변경 범위 `git diff --check`는 모두 exit 0이었습니다. `npm run typecheck`는 exit 1이었습니다. 병행 CG-07 소유 `src/domain/source-url.ts:1`의 web type 검사에서 `node:url` type을 찾지 못한 TS2591과 CG-08 소유 `src/web/components/SRContextPanel.tsx:138`의 `actorName` 미정의 TS2304가 원인입니다. 이 파일은 수정하지 않았습니다.

## 남은 범위

Artifact 저장·현재 pointer·receipt·ReviewImpact의 원자적 처리와 질문·결정·초안 적용 서비스는 구현하지 않았습니다. InputSnapshot supplement migration은 별도 작성자가 구현·검토했고 근거는 `aidlc-docs/construction/planrepo/code/task-09-migration-report.md`에 있습니다. snapshot 저장, M-047 preparation DTO와 실제 `CurrentInputFingerprintPort` 조립은 아직 연결하지 않았습니다. React renderer와 ArtifactWorkspace·VersionComparison도 만들지 않았습니다. 이 순수 API를 소비하는 서비스는 권한·scope·guard·현재 basis를 같은 쓰기 transaction에서 다시 검사해야 합니다. filesystem 규칙 읽기는 bootstrap에서 끝내고 명령 transaction에는 선택된 불변 규칙 snapshot만 전달해야 합니다.

Security Baseline, Resiliency Baseline, Property-Based Testing 확장은 `aidlc-docs/aidlc-state.md`에서 비활성화돼 이 부분 구현에는 N/A입니다.
