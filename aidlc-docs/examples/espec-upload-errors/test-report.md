# eSPEC 초안 시연에 사용한 PlanRepo 검증

## 실행 범위

2026-09-09에 현재 프로젝트의 테스트와 빌드를 실행했습니다. eSPEC·Oracle의 동작 검증은 생성할 Inception Plan의 후속 과제입니다. 이 폴더에서 eSPEC 서버나 Oracle DB에 연결하지 않았습니다.

애플리케이션 소스는 수정하지 않았습니다. 작업 시작 전에 있던 변경을 유지했습니다. 테스트는 프로젝트의 격리된 테스트 DB를 사용했습니다. 화면 시연은 기존 로컬 앱에 새 SR을 추가해 진행했습니다.

## 명령과 결과

프로젝트 루트에서 실행했습니다.

| 명령 | 결과 | 증거 |
| --- | --- | --- |
| `npm run typecheck` | exit 0입니다. 서버·화면 타입 검사가 통과했습니다. | `aidlc-docs/examples/espec-upload-errors/evidence/typecheck.log` |
| `npm run build` | exit 0입니다. 서버·화면 빌드가 통과했습니다. | `aidlc-docs/examples/espec-upload-errors/evidence/build.log` |
| `npm test` 최초 | exit 1입니다. 48개 파일에서 442개 통과·1개 실패했습니다. | `aidlc-docs/examples/espec-upload-errors/evidence/npm-test.log` |
| `npm test -- tests/integration/generation-claim.test.ts` | exit 0입니다. 실패했던 파일의 7개 테스트가 통과했습니다. | `aidlc-docs/examples/espec-upload-errors/evidence/generation-claim-rerun.log` |
| `npm test` 재검증 | exit 0입니다. 48개 파일의 443개 테스트가 통과했습니다. | `aidlc-docs/examples/espec-upload-errors/evidence/npm-test-rerun.log` |
| `curl -fsS http://127.0.0.1:4173/health/ready` | HTTP 200이며 `ready=true`, `generationReady=true`입니다. | 시연 전 준비 상태 확인입니다. |

## 최초 실패와 재검증

`tests/integration/generation-claim.test.ts`의 두 Node worker 경합 사례에서 다음 오류가 발생했습니다.

```text
Error: 실제 DB owner process 종료를 확인하지 못했습니다.
tests/helpers/runtime-workers.ts:133
Test Files  1 failed | 47 passed (48)
Tests       1 failed | 442 passed (443)
```

이 테스트는 25ms 종료 확인 제한, 100ms 종료 지연, 이후 150ms 대기를 사용합니다. 첫 실행은 빌드와 화면 녹화 준비를 병행했습니다. 단독 재현과 전체 재검증에서는 실패가 재현되지 않았습니다. 타이밍에 민감한 조건을 확인했지만 환경 부하가 직접 원인이라고 확정하지 않았습니다. 원인 수정이나 회귀 수정 완료를 주장하지 않습니다.

## 빌드 경고

Vite의 향후 native config 로딩과 관련한 import 경고가 있습니다. 압축 전 JavaScript 묶음이 615.12kB로 500kB 안내 기준을 넘습니다. 둘 다 빌드 실패는 아닙니다. 이번 녹화 요청에서 번들 분할이나 설정 변경은 하지 않았습니다.

## 생략한 검증

- 별도의 Playwright 자동 e2e 전체 스위트는 재실행하지 않았습니다. 요청한 대표 흐름은 실제 Chrome과 실제 Claude 연결을 사용해 Computer Use로 실행하고 연속 영상에 기록했습니다.
- eSPEC의 실제 파일 업로드·Oracle 실행계획·응답시간·원본 접근·권한 코드는 검증하지 않았습니다. 최종 Plan에서 구현 전 확인 또는 후속 테스트로 남깁니다.
- 운영 배포·외부 시스템 변경은 하지 않았습니다.

## 확장 준수

Security Baseline, Resiliency Baseline, Property-Based Testing은 기존 `aidlc-docs/aidlc-state.md`에서 모두 Enabled=No입니다. opt-in 파일은 확인했고 전체 확장 규칙의 적용은 N/A로 남겼습니다.
