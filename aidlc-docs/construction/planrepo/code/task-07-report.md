# CG-07 구현 보고

CG-07의 M-006/M-007과 M-047 source 조회를 실제 HTTP 경로에 연결했습니다. ContextSource 불변 version, 권한, guard, 멱등성, ReviewImpact, activity와 receipt는 하나의 저장 transaction에서 처리합니다.

## 구현 결과

- `src/persistence/context-source-repository.ts`는 caller가 연 transaction만 사용합니다. 새 자료는 서버 ID의 version 1 `unconfirmed`로 시작합니다. 사람 확인은 원 version을 보존한 채 version 2 `confirmed`를 만들고 current pointer와 source revision을 갱신합니다.
- text와 markdown은 전달된 content와 provenance를 그대로 보존합니다. link는 target URL, 확인 가능 여부, 관찰한 외부 version과 확인 불가 이유를 엄격히 저장하고 읽습니다. 미확인 자료에는 확인자 필드를 허용하지 않습니다.
- `ContextSourceView`는 identity·작성 정보·현재 version과 종류별 content 또는 link 자료를 반환합니다. confirmation 판별 union은 confirmed일 때만 확인자·시각·근거를 요구합니다. M-047은 실제 현재 version을 이 타입으로 조립합니다.
- M-006은 현재 프로젝트 멤버에게 허용하며 정확한 SR revision을 요구합니다. M-007은 현재 실제 SR owner에게만 허용하며 같은 SR의 현재 source version ref와 source revision을 모두 검사합니다.
- 두 명령의 fingerprint는 명령 종류, scope, guard와 명시 입력을 포함하고 request ID와 서버 시각은 제외합니다. 권한 재검사 뒤 같은 요청을 재생하고 같은 key의 다른 guard·입력은 `priorReceipt`와 함께 거절합니다.
- 내용·대상·확인 상태 변경은 G1과 종속 G2의 epoch와 새 bundle 필요 상태를 갱신하고 SR revision을 올립니다. 승인 기준이 있던 SR은 `requirements`로 돌아갑니다. 과거 bundle·승인·handoff는 보존합니다. 표시명만 바뀌고 근거·확인 내용이 같으면 순수 ReviewImpact는 재검토하지 않습니다.
- 저장된 source JSON이나 판별 열이 손상되면 typed `CORRUPT_DATA`로 식별합니다. M-047과 M-007은 이를 `STORE_UNAVAILABLE`로 정제하며 신규 입력 오류, 없는 대상과 stale version 오류는 기존 의미를 유지합니다.
- `src/runtime/application-composition.ts`가 M-006/M-007을 조립하므로 main과 TestApp이 같은 handler를 사용합니다. HTTP의 501 검사는 별도 `handlers: {}` fixture에 남겨 실제 후속 메서드로 옮기지 않았습니다.

## 변경 경로

- 계약과 도메인: `src/contracts/views.ts`, `src/domain/review-impact.ts`
- 저장과 서비스: `src/persistence/context-source-repository.ts`, `src/persistence/review-impact-repository.ts`, `src/persistence/sr-repository.ts`, `src/application/sr-context-service.ts`, `src/application/workspace-query-service.ts`
- 조립: `src/runtime/application-composition.ts`
- 테스트: `tests/integration/context-source.test.ts`, `tests/integration/context-source-repository.test.ts`, `tests/unit/review-impact.test.ts`, `tests/contract/public-methods.test.ts`, `tests/contract/http-boundary.test.ts`
- 문서와 추적: `aidlc-docs/construction/planrepo/code/api-summary.md`, `aidlc-docs/construction/planrepo/code/task-07-brief.md`, `aidlc-docs/construction/planrepo/code/task-07-report.md`, `aidlc-docs/construction/plans/planrepo-code-generation-plan.md`

## TDD와 검증 기록

- 초기 `npm test -- tests/integration/context-source.test.ts`는 exit 1이었습니다. 실제 M-006 HTTP 응답이 `NOT_IMPLEMENTED`라서 기대한 행동 RED를 확인했습니다.
- 저장소 구현 전 `npm test -- tests/integration/context-source-repository.test.ts`는 exit 1이며 3개가 미구현 오류로 실패했습니다. 최소 저장 구현 뒤 같은 명령은 exit 0이며 3개가 통과했습니다.
- 서비스 회귀를 확장한 `npm test -- tests/integration/context-source.test.ts tests/unit/review-impact.test.ts`는 exit 1이었습니다. M-006 501 실패 4개와 없는 순수 ReviewImpact 함수 실패 2개를 확인했고 기존 설명 영향 테스트 2개는 통과했습니다.
- 최소 서비스·DTO·ReviewImpact·composition 연결 뒤 `npm test -- tests/unit/review-impact.test.ts tests/integration/context-source-repository.test.ts tests/integration/context-source.test.ts`는 exit 0이며 11개가 통과했습니다.
- 첫 연결 뒤 `npm run typecheck`는 exit 1이었습니다. M-006/M-007의 서로 다른 guard union을 한 generic helper가 보존하지 못한 TypeScript 오류 3개를 확인했습니다. 두 typed command builder로 분리한 뒤 같은 명령은 exit 0이었습니다.
- 저장 codec 오류 회귀를 추가한 `npm test -- tests/integration/context-source.test.ts`는 exit 1이었습니다. M-047이 500 `INTERNAL_ERROR`를 반환해 기대한 RED를 확인했습니다. typed 손상 오류를 분리한 뒤 `npm test -- tests/integration/context-source.test.ts tests/integration/context-source-repository.test.ts tests/integration/sr-services.test.ts`는 exit 0이며 24개가 통과했습니다.
- 최종 관련 검증 `npm test -- tests/contract/http-boundary.test.ts tests/integration/context-source.test.ts tests/integration/context-source-repository.test.ts tests/integration/sr-services.test.ts tests/integration/sr-context.test.ts tests/unit/review-impact.test.ts tests/contract/public-methods.test.ts`는 exit 0이며 7개 파일의 70개 테스트가 통과했습니다.
- 전체 `npm run typecheck`는 구현 직후 exit 0을 확인했습니다. 병행 CG-09 파일이 추가된 중간 재실행은 exit 2이며 CG-09 소유 `generation-input-repository.ts` 2건과 `generation-snapshot.test.ts` 4건이 실패했습니다. 이 시점에도 CG-07 파일과 직접 의존만 포함한 `./node_modules/.bin/tsc -p /tmp/planrepo-cg07-tsconfig.json --noEmit`은 exit 0이었습니다. CG-09 변경이 정리된 뒤 최종 `npm run typecheck`를 다시 실행했고 exit 0입니다.
- generation snapshot을 함께 넣은 관련 suite의 첫 시도는 당시 아직 생성되지 않은 CG-09 `generation-input-repository` import 때문에 수집 단계 exit 1이었습니다. 병행 변경이 정리된 뒤 `npm test -- tests/unit/generation-snapshot.test.ts`를 실행했고 exit 0이며 14개가 통과했습니다. 중간 외부 WIP 실패를 CG-07 결함으로 숨기거나 수정하지 않았습니다.
- 최종 `npm test`는 exit 1이었습니다. 19개 파일 중 18개 파일의 191개 테스트가 통과했고 병행 CG-08 소유 `tests/unit/web/client.test.ts`의 새 응답 검증 테스트 4개가 실패했습니다. 실패는 null query·command value, 빈 receipt와 빈 replay current를 아직 거절하지 않는 UI client WIP이며 CG-07 source 경로 실패는 없습니다. CG-08 파일은 수정하지 않았습니다.
- `git diff --check`는 exit 0입니다. 문서의 Markdown fence 수를 검사한 첫 Node one-liner는 shell quoting 오류 `unmatched "`로 exit 1이었고 파일은 바뀌지 않았습니다. 같은 검사를 안전한 Python heredoc으로 다시 실행해 `markdown fence validation: PASS`, exit 0을 확인했습니다. 새 Mermaid나 ASCII diagram은 없습니다.

브라우저, 실제 외부 링크 조회, 성능, 복구, Claude는 실행하지 않았습니다. 이 과제는 외부 링크 내용을 자동 조회하지 않으며 실제 브라우저와 생성 calculator 연결은 각 후속 과제의 검증 범위입니다.

## 독립 검토 수정 1

- M-006 link 입력은 URL parser와 공개 JSON schema에서 함께 검사합니다. 자격 정보가 없는 절대 `http` 또는 `https` URL만 허용하며 상대 주소, 공백·역슬래시가 섞인 주소와 `javascript`, `data`, `file` scheme을 거절합니다. URL 문자열은 정규화하지 않고 승인된 입력 그대로 저장합니다.
- 같은 판별을 저장 경계와 읽기 codec에도 적용했습니다. 새 입력 위반은 `VALIDATION_ERROR`이고 저장된 현재 link URL 위반은 typed `CORRUPT_DATA`입니다. 후자는 M-047과 M-007에서 `STORE_UNAVAILABLE`로 반환합니다.
- 회귀 추가 뒤 `npm test -- tests/contract/public-methods.test.ts tests/integration/context-source-repository.test.ts tests/integration/context-source.test.ts`는 exit 1이었습니다. 32개 중 28개가 통과했고 4개가 기대한 이유로 실패했습니다. 공개 schema와 실제 M-006이 `not a URL`을 승인했고, 저장 경계가 userinfo URL을 승인했으며, M-047이 저장된 `javascript:` link를 정상 자료로 반환했습니다.
- 최소 구현 뒤 같은 명령은 exit 0이며 32개가 모두 통과했습니다.
- 관련 검증 `npm test -- tests/contract/http-boundary.test.ts tests/integration/context-source.test.ts tests/integration/context-source-repository.test.ts tests/integration/sr-services.test.ts tests/integration/sr-context.test.ts tests/unit/review-impact.test.ts tests/contract/public-methods.test.ts`는 exit 0이며 7개 파일의 74개 테스트가 통과했습니다.
- 병행 CG-09 participants 보완 중 실행한 `npm run typecheck`는 exit 1이었습니다. CG-09 소유 `src/persistence/generation-input-repository.ts`의 누락 필드 1건과 `tests/unit/generation-snapshot.test.ts`의 ref 타입 1건이 실패했으며 CG-07 URL 파일 오류는 없었습니다. 수정한 URL 정책 생산 파일과 직접 의존만 포함한 `./node_modules/.bin/tsc -p /tmp/planrepo-cg07-url-tsconfig.json --noEmit`은 exit 0입니다.
- `git diff --check`와 Markdown fence 검증은 각각 exit 0입니다. 새 diagram은 없습니다.
- 웹 타입 경계 회귀에서 `npm run typecheck`는 exit 1이었습니다. 웹에서도 소비하는 `schemas.ts`가 `source-url.ts`의 `node:url` import를 따라가 `TS2591`로 실패했습니다. helper를 표준 전역 `URL`만 사용하는 Node·브라우저 공통 순수 함수로 바꾼 뒤 `npm run typecheck`는 exit 0입니다.
- 이 변경 뒤 URL 대상 `npm test -- tests/contract/public-methods.test.ts tests/integration/context-source-repository.test.ts tests/integration/context-source.test.ts`는 exit 0이며 32개가 통과했습니다. `npm run build`도 exit 0입니다. build에는 기존 Vite native config loader의 JSON import attribute와 확장자 안내가 출력됐지만 산출물 생성은 완료됐습니다.
- URL protocol의 대소문자를 별도 정책으로 제한하지 않도록 대문자 `HTTPS` 호환 회귀를 추가했습니다. 첫 `npm test -- tests/contract/public-methods.test.ts`는 schema가 이를 400으로 거절해 exit 1이었고, parser와 schema를 대소문자 비구분으로 맞춘 뒤 URL 대상 32개와 전체 `npm run typecheck`가 각각 exit 0입니다.
