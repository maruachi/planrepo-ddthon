# 통합 검증

사용자 DB와 분리된 PLANREPO_DB_PATH로 앱을 시작한다. 실제 CLI는 기존 인증과 사용자 설정을 사용한다.

1. SR을 생성하고 계획 생성을 시작한다. running에서 정상 결과 저장 또는 실패로 바뀌는지 확인한다. 실제 성공 문서의 본문·runId를 확인한다.
2. 필요한 질문에 답하고 문서 승인/수정 요청을 기록한다. 다음 단계와 같은 단계 재생성의 회차 차이를 확인한다.
3. 문서를 편집·비교·복원하고 과거 버전/본문 없는 결정 사건이 유지되는지 확인한다. 실행 중 편집은 늦은 AI 결과로 덮어쓰지 않아야 한다.
4. Inception/Construction에서 원래 버전에 리뷰를 요청하고 대기 중에도 자체 승인 후 진행한다. 리뷰어로 전환해 원래 버전 결과를 남기고 이후 버전의 승인으로 표시하지 않는지 확인한다.
5. 마지막 구현 계획을 승인해 구현 대기로 이동하고, 작성자가 수동 완료한다. CLI/빌드/Git 자동 실행이 없어야 한다.
6. 앱을 종료하고 같은 DB로 다시 시작해 SR·실제 생성 문서·이력·리뷰·수동 완료를 재열람한다. 주요 입력·확인을 키보드로 수행한다.

별도 실패 검증은 CLI 프로세스 실패, 잘못된 JSON/빈 출력, 실행 중 편집, 저장 롤백, 저장 후 응답 연결 유실을 포함한다. 자동 테스트는 임시 SQLite와 실제 Express 소켓으로 상태·원자성·receipt를 검증한다. 실인증 성공은 U2 verification.md의 별도 실행으로 확인했다.

최종 브라우저 흐름은 실제 생성된 초기 문서와 결정적 후속 단계 결과를 함께 사용했다. 전체 9단계를 실제 CLI로 반복 호출한 것은 아니다. 전체 E2E 프레임워크를 프로젝트 의존성으로 추가하지 않았다. 한 번의 실제 CLI 성공·실패와 단위/브라우저 연결을 구분한 증거는 각 단위 verification.md에 기록했다.

## Worktree Integration Spike Scenarios

### Scenario 1 — Git Worktree to Legacy State

- Setup: OS temporary directory에 local repository를 만들고 `AGENTS.md`, `aidlc-docs/aidlc-state.md`를 commit한다.
- Execute: `GitWorktreeManager.provision` 후 `LegacyAidlcStateParser.parse`를 호출한다.
- Expected: `planrepo/sr/<sr-id>`와 `<managed-root>/<sr-id>`가 일치하고 current stage와 첫 미완료 항목이 반환된다.
- Cleanup: test가 전체 temporary root를 삭제한다. 사용자 repository에는 접근하지 않는다.

### Scenario 2 — Runner to Manifest Delta

- Setup: provision된 worktree에서 pre-run manifest를 capture한다.
- Execute: injected fake launcher가 exact resume prompt와 worktree `cwd`를 확인하고 `aidlc-docs/generated.md`를 생성한다.
- Expected: post-run delta의 created path가 해당 파일이고 run status가 `succeeded`다.
- Boundary: 실제 Claude 인증/provider 성공을 증명하지 않는다.

### Scenario 3 — HTTP/API Composition

- Setup: in-memory fake ports를 사용하는 local Express test server를 시작한다.
- Execute: status, provision, resume를 호출하고 같은 `X-Operation-Id`를 재사용한다.
- Expected: unconfigured mutation은 bounded 409, 정상 resume은 202, duplicate operation은 runner 한 번만 실행한다.
- Cleanup: runner와 server를 닫는다.

```bash
npx vitest run tests/worktree-spike/integration.test.ts
```

자동 integration tests는 외부 서비스, remote clone, 사용자 DB와 실제 Claude CLI를 사용하지 않는다.
