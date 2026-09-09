# CG-09 저장 초안 조회 연결 보고

## 구현 결과

- M-047 SR 상세에 `generationDrafts`를 추가했습니다. 각 항목은 `draftId`, `taskKind`, `basisInputSnapshotRef`, `basisFingerprint`, `provenance`, `freshness`, `application`만 반환합니다. 큰 draft body와 InputSnapshot 본문은 목록에 반복하지 않습니다.
- `{kind:'draft',draftId}` 조회는 같은 `readConsistent` 안에서 선택한 `DraftView`와 불변 `InputSnapshot`을 `draftReview`로 반환합니다. 정상 크기에서는 기존 `preparation`도 반환해 현재 basis ref와 규칙 version, target을 비교할 수 있습니다.
- 현재 생성 입력이 2 MiB를 넘으면 선택한 저장 초안과 snapshot은 계속 읽습니다. 이 경우 가짜 fingerprint를 만들지 않고 `preparation`을 생략하며 `preparationUnavailable.reason`을 반환합니다. M-018과 M-019의 현재 입력 검사는 바꾸지 않았습니다.
- provider와 human review 초안을 모두 현재 SR 범위로 읽습니다. 다른 SR의 draft ID는 `NOT_FOUND`입니다. application은 실제 `draft_applications`의 적용 결과를 사용하고, 목록·선택 조회는 snapshot, draft와 application 수를 바꾸지 않습니다.

## TDD와 검증

- `./node_modules/.bin/vitest run tests/integration/artifact-edit.test.ts -t '오래된 원 초안'`의 첫 실행은 exit 1입니다. M-019 뒤 M-047 응답에 `generationDrafts`가 없어 1개가 실패하고 12개를 선택 제외했습니다.
- `./node_modules/.bin/vitest run tests/integration/generation-preparation.test.ts -t '현재 입력이 생성 한도를'`의 첫 실행은 exit 1입니다. 저장 provider draft가 있어도 큰 현재 입력의 `{kind:'draft'}` 조회가 `ok:false`여서 1개가 실패하고 3개를 선택 제외했습니다.
- 최소 DTO와 저장 reader, M-047 조립을 연결한 뒤 첫 targeted 실행에서 큰 입력 회귀는 통과했습니다. 초안 목록 회귀는 생성 시각 순서를 고정 순서로 가정한 테스트가 실패해 항목 포함과 실제 정렬 책임을 분리했습니다. nested provenance의 추가 필드까지 exact object로 제한한 테스트도 보정했습니다. 이후 Artifact targeted 실행은 exit 0이며 1개가 통과하고 12개를 선택 제외했습니다.
- `./node_modules/.bin/vitest run tests/integration/artifact-edit.test.ts`는 exit 0이며 13개가 통과했습니다. `./node_modules/.bin/vitest run tests/integration/generation-preparation.test.ts`는 fixture의 과거 human review provenance 열 불일치를 새 strict 목록 reader가 드러내 처음 exit 1이었습니다. provider 성공 실행과 원 draft를 갖춘 정상 fixture로 고친 뒤 exit 0이며 4개가 통과했습니다.
- 관련 전체 검증 `./node_modules/.bin/vitest run tests/contract/public-methods.test.ts tests/unit/generation-snapshot.test.ts tests/unit/review-impact.test.ts tests/integration/version-review-impact.test.ts tests/integration/generation-preparation.test.ts tests/integration/artifact-edit.test.ts tests/integration/sr-services.test.ts tests/integration/context-source.test.ts tests/integration/question-decision-service.test.ts`는 exit 0입니다. 9개 파일의 104개 테스트가 통과했습니다.
- `./node_modules/.bin/tsc -p /tmp/tsconfig.planrepo-cg09-fix1.json --noEmit`, `./node_modules/.bin/tsc -p tsconfig.web.json --noEmit`과 `npm run typecheck`는 모두 exit 0입니다.

## 범위

`src/runtime/application-composition.ts`와 `src/web`은 병행 작업 소유를 유지해 수정하지 않았습니다. 기존 M-047 handler가 같은 query service를 호출하므로 새 endpoint나 브라우저 DB 접근은 추가하지 않았습니다. 실제 Claude와 브라우저 E2E는 실행하지 않았습니다.
