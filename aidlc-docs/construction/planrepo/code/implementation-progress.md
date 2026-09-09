# PlanRepo 구현 진행 기록

사용자 최신 지시에 따라 핵심 프로토타입을 우선 구현했습니다. 새 TDD와 전체 제품 완성도 작업은 후속 범위입니다. 현재 결과와 실행 근거는 `aidlc-docs/construction/planrepo/code/prototype-report.md`에 있습니다. 아래 CG 표는 범위 조정 전의 과제 이력을 보존한 기록이며 전체 제품 완료를 뜻하지 않습니다. 현재 계획은 `aidlc-docs/construction/plans/planrepo-prototype-plan.md`의 P1~P8을 마쳤습니다.

## 현재 과제

| 과제 | 상태 | 최신 근거와 남은 범위 |
|---|---|---|
| CG-01 BOOT | 완료 | 격리 경로 symlink 결함을 수정했습니다. 23개 테스트와 typecheck, 독립 재검토가 통과했습니다. |
| CG-02 CONTRACT | 완료 | 공개 44개·내부 6개 계약을 구현했습니다. M-018 판별 union까지 fix2에서 해결했고 계약 19개와 typecheck, 독립 재검토가 통과했습니다. |
| CG-03 STORAGE | 완료 | append-only·runtime 이력·순환·IOERR 결함을 수정했습니다. 저장 33개와 typecheck, 독립 재검토가 통과했습니다. |
| CG-04 SEED | 완료 | DEMO-4와 실제 manifest 관계를 검증했습니다. seed 13개·seed+storage 46개, typecheck와 독립 재검토가 통과했습니다. |
| CG-05 HTTP | 완료 | fix2까지 검토 항목을 해결했습니다. HTTP 13개·완료 기반 110개, typecheck와 독립 재검토가 통과했습니다. |
| CG-06 SR | 완료 | fix2 독립 재검토까지 통과했습니다. 저장 codec 오류는 STORE_UNAVAILABLE, 일반 오류는 INTERNAL_ERROR로 구분합니다. 관련 91개와 typecheck가 통과했습니다. |
| CG-07 SOURCE | 완료 | URL fix1과 browser 공통 helper를 독립 재검토했습니다. 관련 74개·URL 32개·typecheck·build가 통과했고 새 Critical/Important는 없습니다. |
| CG-08 UI_BASE | 완료 | SOURCE fix2의 충돌 비교·명시 기준 채택·입력 폐기를 독립 재검토했습니다. web unit 23개·E2E 24개·web typecheck·build가 통과했습니다. 후속 CG09 저장 연결 뒤 전역 typecheck도 통과했습니다. |
| CG-09 EDITOR | 완료 | 문서·질문·결정 저장, 입력 snapshot, 사람 초안 저장·적용과 UI를 구현했습니다. 각 저장·조회·비교·명령 격리의 독립 검토를 마쳤습니다. DraftReview fix1의 E2E38개 뒤 fix2의 DraftReview17개·typecheck·build가 통과했습니다. fix3의 비교 unit9개·관련 E2E1개·web typecheck와 3파일431줄 독립 재검토가 통과했습니다. 실제 DEMO-4 네 SR의 동일 자료 비교는 오탐0개입니다. 최신 전역 typecheck는 병행 CG18 오류3건으로 중단됐으며 그 작성자가 해결합니다. 임의의 두 과거 문서 비교는 CG25에서 확대합니다. |
| CG-10 REQUEST | 완료 | M032~M035의 실제 서비스·HTTP를 연결했습니다. fix1에서 confirmed 취소 재생, 중첩 추가 필드 비노출, 실제 모델·CLI 조회를 해결했습니다. 대상14개·관련139개·전역 typecheck·최종 public4개와 5파일 독립 재검토가 통과했습니다. 실제 실행·claim·provider 통합은 후속 과제입니다. |
| CG-11 CLAIM | 완료 | 마지막 저장 중 deadline 초과는 fix1에서 전체 rollback으로 고쳤습니다. fix2에서는 DB owner를 직접 소유한 Node ChildProcess의 exit·close로 종료를 확인합니다. timeout 오류 전파와 slot·runtime·control 보존을 실제 경합 테스트로 검증했습니다. 대상17개·scoped typecheck와 7파일933줄 독립 재검토가 통과했습니다. 관련182개는 앞선 구현에서 통과했습니다. 후속 UI fix2의 전역 typecheck도 통과했습니다. |
| CG-12 PROCESS | 완료 | C05 fix1의5파일675줄 독립 재검토를 마쳤습니다. 제어 오류의 abort·settle, 즉시·지연·사전 Confirmed의 bounded M050 저장과 shutdown drain을 고쳤습니다. loop13개·관련83개·scoped typecheck와 후속 UI 전역 typecheck가 통과했습니다. OS timeout은 실제 child39ms와 Buffer matcher3432ms로 구분했고 bytes 동등 비교로 해결했습니다. 전체 실행 범위 Unknown과 실제 복구·Claude 검증은 후속에 남습니다. |
| CG-13 PROVIDER | 완료 | 고정 Claude profile·결과 codec·공통 snapshot ref, exact provider registry·outcome identity evidence·정책 거절 no-process 관찰·실제 저장 통합의 독립 재검토를 마쳤습니다. C05 fix1 관련83개와 typecheck가 통과했습니다. 기본 global.anthropic.claude-opus-4-8 및 교체 계약을 유지합니다. 실제 CLI 업무 검증과 eligibility는 CG15에 남습니다. |
| CG-14 RECOVERY | 완료 | 복구 구현과 fix1의5파일533줄 독립 검토를 마쳤습니다. 실제 worker가 child를 만든 직후 PID 저장 전 중단을 검증합니다. targeted1개·관련11개·typecheck가 통과했고 이전46개 검증을 유지합니다. NQ21과 실제 재부팅 증거는 미통과로 남깁니다. |
| CG-15 LIVE | 구현 중 | 현재 CLI2.1.265에 맞춘 profile과 제한 실행 후보를 TDD로 검증합니다. 동일 macOS build의 fork 금지 probe와 소유한 실행의 관찰이 함께 있을 때만 별도 종료 근거를 인정합니다. 실제 질문·답변 뒤 문서 생성, 비AI readiness와 지원 판정이 남았습니다. |
| CG-16 QUESTION | 완료 | backend와 UI 독립 검토를 마쳤습니다. ref 범위·논리 관계와 전환 이전 origin snapshot 순서를 검증합니다. client18개·실제 M011 전환 E2E1개·typecheck가 통과했고 이전 fix1의 관련 E2E20개·build도 통과했습니다. fix2의3파일101줄을 독립 검토했습니다. 실제 unmount로 재현되지 않는 actor ABA와 origin/current 동일 버전 가정은 철회했습니다. |
| CG-17 POLICY | 완료 | backend와 UI 독립 검토를 마쳤습니다. fix1의4파일321줄에서 전송 중 수정한 정책 기준과 배정 사유를 보존합니다. 실제 RED2개 뒤 정책 E2E9개와 web typecheck가 통과했습니다. 이전 client21개·build와 backend26개·관련81개 검증을 유지합니다. |
| CG-18 G1 | UI 구현 중 | M020·21·27·28, GP01~09, M047 구성·준비 DTO를 연결했습니다. 새 bundle의 revision 증가와 stale guard 거절을 실제 probe로 확인했습니다. M021은 현재 멤버십·배정 검사 뒤 기존 receipt를 재생하고 신규 승인만 현재 bundle·epoch를 검사합니다. fix1의4파일187줄 독립 검토, 대상13개·관련119개·typecheck가 통과했습니다. 201경로 UI baseline에서 공식 검토·현재 묶음·승인·게이트 전환을 연결합니다. |
| CG-19 CHANGE | 독립 검토 수정 중 | 14파일2099줄 검토에서 과거 대상·해결 이력·M017/M018 승계의 세 경계 결함을 확인했습니다. 두 실제 공개 흐름을 재현했고 fix1 TDD로 보완합니다. 이전 관련70개·typecheck 결과와 후속 UI 범위를 구분합니다. |
| CG-20~28 | 미시작 | G2·인계·최종 UI·품질·수용 검증을 이어갑니다. |

과제별 정확한 RED, 중간 실패, GREEN, 명령, exit code와 미실행 범위는 `aidlc-docs/construction/planrepo/code/task-NN-report.md`에 있습니다. CG08은 web unit 23개·E2E 24개·web typecheck·build가 통과했습니다. CG09 작성 중 발생했던 전역 typecheck 오류는 저장 연결 뒤 해결됐습니다. 질문·결정 DB/application 33개 및 runner unit 13개·OS 7개 검증 뒤 각각 실행한 `npm run typecheck`가 exit 0입니다. 후속 UI·provider 작성 상태는 이 근거와 구분합니다. 이전 CG08 client codec 실패는 fix1에서 해결했습니다.

## 사용자 체험 서버

http://127.0.0.1:4173에서 핵심 프로토타입을 실행 중입니다. root 소유 PTY13872와 기존 사용자 DB를 유지합니다. 이전 PTY36148 체험본은 종료했고 새 dist 빌드로 교체했습니다. 초안 등록·단계별 작업·내 할 일·실제 Claude 연결을 제공합니다. 요구사항 정리 중에는 미래 단계 탭과 계획 검토 링크를 표시하지 않습니다. typecheck·build·관련 기존 39개 테스트와 별도 데이터의 실제 브라우저 흐름을 검증했습니다. 정확한 변경점과 미검증 범위는 `aidlc-docs/construction/planrepo/code/prototype-report.md`에 있습니다.

## 실행과 검토 원칙

- `feat/planrepo-implementation`의 기존 commit 없는 Greenfield에서 구현합니다. worktree를 위해 사용자 자산을 일괄 commit하지 않습니다.
- 공통 서비스·계약·저장 파일은 한 작성자만 수정합니다. 독립 파일의 구현과 읽기 검토는 병행합니다.
- 독립 검토는 변경 파일의 실제 snapshot diff와 승인 계약을 사용합니다. 검토 완료 선행 수정과 병행 과제의 변경을 구분합니다.
- AI-DLC 계획·진행·audit를 Superpowers의 작업 기록으로 사용합니다. 같은 내용을 별도 scratch ledger에 중복하지 않습니다.
- Claude CLI 2.1.263의 기존 환경과 `global.anthropic.claude-opus-4-8` 짧은 실제 호출을 확인했습니다. 업무 생성·취소·복구·전체 수용 검증은 남았습니다.
- web/server build와 격리 일반 실행·개발 서버 검증이 통과했습니다. 이전 web entry 부재와 dev API proxy 충돌은 해결됐습니다. 최신 후속 UI 수정의 검증은 별도로 기록합니다.
- Security Baseline, Resiliency Baseline, PBT는 비활성화해 N/A입니다.

## 후속 검토 항목

CG-01의 포괄적 toThrow assertion, Fastify manifest/runtime 버전 표시 차이, CG-02 내부 ClaimRef 메타데이터 일치와 schema 테스트명 범위, CG-03 중간 쓰기 실패 검증을 최종 품질 과제에서 확인합니다. 업무 서비스의 실제 rollback은 CG-06부터 확대했습니다. JSON refs는 각 소비 repository가 kind·scope·실재성을 검증해야 합니다. CG09 fix2에서 snapshot의 entity-only kind에 version을 붙인 자료와 SR scope가 섞인 review_policy를 거절하도록 보완했습니다. 영향 없음의 currentHandoffValid가 not_passed·실제 인계 없음에도 true가 될 수 있는 기존 helper 표현은 실제 현재 인계 validity가 아닙니다. CG09 Artifact UI fix1에서 이를 ‘인계 유효’로 표시한 부분을 제거하고 확정 M015의 영향만 ‘이번 저장 결과’로 분리했습니다. E2E와 독립 재검토가 통과했습니다. CG21/24에서 실제 현재 인계 조회를 연결합니다. 현재 gate 권한을 우회하는 조건으로 사용하지 않습니다. UI14는 현재·직전 문서의 고정 비교를 구현했습니다. 임의의 두 과거 버전 선택은 후속 전체 UI 검증에서 연결해야 합니다.

CG-07에서 M-006을 연결하며 CG-05의 미구현 경로 테스트를 명시적으로 handler가 없는 server fixture로 분리했습니다. 다음 미구현 메서드로 계속 이동시키지 않습니다. 과거 pending 검토 요청의 현재 epoch·bundle 필터는 CG-18/20/23에서 검증합니다. CG-09는 실제 calculator와 rule source를 연결해 현재 판정 포트의 fixture 검사를 제품 통합으로 확장합니다. same-boot strong identity와 NQ-21 한계는 실제 근거가 생기기 전까지 유지합니다.
