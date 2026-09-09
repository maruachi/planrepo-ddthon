# 집중 테스트

```sh
npm test
```

현재 최종 결과: 40개 파일/146개 테스트, 실패 0개. Vitest node 환경이며 비교 워커를 먼저 컴파일한다. 로컬 소켓을 막는 실행 샌드박스에서는 HTTP 검증에 실행 권한이 필요하다.

U1은 저장/마이그레이션/페이지/문서/비교/워커/HTTP/응답 유실/초안/실행 설정 31개다. U2는 CLI/정책/문맥/서비스/HTTP/UI/마이그레이션 35개다. U3는 리뷰 서비스/UI/HTTP/단위 연결/마이그레이션 20개다.

특정 변경만 재확인할 때 `npx vitest run tests/aidlc-planning`, `npx vitest run tests/review-implementation` 또는 아래 spike 명령을 사용할 수 있다. 테스트 어댑터는 유효/잘못된 결과·프로세스 실패·경합을 재현하며 실제 인증 성공의 대체 증거가 아니다. 커버리지 백분율은 측정하지 않았다.

## Worktree Integration Spike Tests

```bash
npx vitest run tests/worktree-spike
npx vitest run tests/worktree-spike/manifest/scoped-manifest.property.test.ts --reporter verbose
```

- Expected focused result: 8 files, 32 tests, zero failures.
- Git/worktree: 12 example tests.
- State/manifest: 7 example tests와 3 property tests.
- Runner/client: 7 example tests.
- Vertical HTTP/Git integration: 3 tests.
- PBT seed: `424242`; property당 150 runs; shrinking enabled.
- PBT replay는 동일 test file과 source의 `PBT_SEED`를 유지해 수행한다. 실패 출력의 shrunk counterexample을 함께 보관한다.

실패 시 최초 failure와 seed를 기록하고 해당 focused file을 재실행한다. 수정 후 focused suite, `npm run typecheck`, 마지막으로 `npm test` 전체를 다시 실행한다. 별도 coverage reporter는 구성하지 않았으므로 coverage percentage를 주장하지 않는다.

## Manual Board Status Movement Tests

```bash
npx vitest run \
  tests/sr-document-foundation/board-movement.property.test.ts \
  tests/sr-document-foundation/board-client.test.ts \
  tests/sr-document-foundation/migrations.test.ts \
  tests/sr-document-foundation/storage.test.ts \
  tests/sr-document-foundation/services.test.ts \
  tests/sr-document-foundation/http.test.ts
```

현재 Hotfix focused 결과는 최신 shared schema 상태에서 6개 파일, 24개 테스트 통과다. 검증 항목은 정규 열의 이전/다음 계산, 양방향 역연산, boundary disabled, client contract, v5 migration 보존, restart persistence, stale/non-adjacent 거부, operation replay와 workflow non-mutation이다.

Property tests는 fast-check 4.9.0, seed 424242, property당 최소 150 runs와 기본 shrinking을 사용한다. 실패하면 출력된 seed와 shrunk counterexample을 유지해 동일 파일을 재실행한다. coverage reporter는 구성하지 않았으므로 백분율 목표는 N/A다.

## Worktree Document Edit and History Tests

```bash
./node_modules/.bin/vitest run tests/worktree-spike
./node_modules/.bin/vitest run tests/worktree-spike/document-history.property.test.ts
```

- 현재 focused 결과: 15파일, 50테스트 통과, 실패 0.
- 현재 전체 결과: 40파일, 146테스트 통과, 실패 0.
- 핵심 예제: v1 AI snapshot, v2 human edit, no-op, operation replay/conflict, immutable update/delete, restart, path/symlink/size/hash rejection, atomic replace와 compensation.
- PBT-02/PBT-03: fast-check 4.9.0, seed `424242`, property당 150 runs, shrinking enabled.
- 커버리지 reporter는 구성하지 않았으므로 백분율은 측정하지 않았고 합격 수치로 주장하지 않는다.

실패 시 focused file과 shrunk counterexample을 먼저 보존하고 동일 명령을 재실행한다. 수정 후 `npm run typecheck`, focused suite, `npm test`, `npm run build` 순으로 재확인한다.

## Initial SR Prompt Selection Hotfix Tests

- **Focused command**: `./node_modules/.bin/vitest run tests/worktree-spike/runner/aidlc-prompt.property.test.ts tests/worktree-spike/runner/worktree-aidlc-runner.test.ts tests/worktree-spike/integration.test.ts tests/worktree-spike/document-history.test.ts`.
- **Focused result**: 4 files, 18 tests passed, 0 failed.
- **Full command**: `npm test`.
- **Full result**: worker build plus 43 files, 160 tests passed, 0 failed.
- **Coverage percentage**: N/A; no coverage reporter or percentage gate is configured.

The focused tests pin the exact initial and resume prompts, optional attachment behavior, same-session resume, persisted restart, lookup failure, Worktree execution and document-history compatibility.

PBT-03 uses a structured SR requirements generator. PBT-07/08/09 are satisfied with Unicode and Markdown-shaped input, optional attachments, fast-check 4.9.0, fixed seed `424242`, 150 runs per property and shrinking. PBT-02 is N/A because prompt generation has no inverse transformation. On failure, preserve the logged seed and shrunk counterexample, then rerun the focused file before the full suite.
