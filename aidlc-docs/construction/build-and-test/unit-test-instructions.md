# 집중 테스트

```sh
npm test
```

현재 최종 결과: 31개 파일/118개 테스트, 실패 0개. Vitest node 환경이며 비교 워커를 먼저 컴파일한다. 로컬 소켓을 막는 실행 샌드박스에서는 HTTP 검증에 실행 권한이 필요하다.

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
