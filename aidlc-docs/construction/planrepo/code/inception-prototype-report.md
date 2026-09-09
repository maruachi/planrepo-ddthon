# Inception Plan 프로토타입 반영 결과

최신 문서 중심 화면과 실제 예시 결과는 aidlc-docs/construction/planrepo/code/document-first-example-report.md를 따릅니다. 아래는 그 이전 구현 시점의 기록입니다.

기준 시각은 2026-09-09T05:29:06Z입니다. 사용자가 제공한 이미지의 조건별 흐름, 상황별 화면, 약속·예외, 승인 범위를 현재 Inception Plan에 연결했습니다. 사용자 화면과 API는 http://127.0.0.1:4173 에서 함께 실행합니다.

## localhost 접속 오류 수정

2026-09-09T05:34:02Z에 추가 수정했습니다. 최초 안내한 localhost:4173은 단일 Host 비교 때문에 403을 반환했습니다. 서버의 로컬 Host와 Origin에 정확한 localhost 별칭을 추가했습니다. 일반 실행과 개발 proxy의 localhost Origin을 함께 확인했습니다. 사용자 최신 지시에 따라 추가 보안 설계 없이 체험을 막는 접근 조건만 수정했습니다. 이전 설계의 localhost 별칭 제외 조건은 이 수정으로 대체합니다.

수정 전 localhost GET와 개발 Origin 회귀 사례 두 개의 실패를 확인했습니다. 수정 후 다음 명령이 통과했습니다.

```sh
npm test -- tests/contract/http-boundary.test.ts tests/integration/readiness.test.ts
npm run typecheck
npm run build
```

관련 테스트는 25개가 통과했습니다. 기존 Vite 경고는 유지됩니다. 실제 사용자 서버에서 localhost와 127.0.0.1의 루트 HTML·readiness·workspace 조회 API가 모두 200으로 응답했습니다. 브라우저에서 localhost 팀 보드와 기존 SR 5건을 확인했습니다. 최초 보조 API 검증은 잘못 적은 actor ID 때문에 거절됐으며, 프로젝트 manifest의 실제 actor ID로 다시 검증했습니다. SR 5건과 SQLite integrity ok를 확인했습니다. 백업은 .planrepo/previews/cg17-20260909/updates/localhost-20260909-053320/before-localhost.sqlite에 있습니다.

## 반영 범위

Plan은 SR 하나의 AI-DLC Inception 문서 전체입니다. 요구사항, 사용자 시나리오, 진행 계획, 주요 구조, 주요 결정, 작업 단위를 한 Plan 버전으로 보관합니다. Construction과 실제 코드 생성·개발 실행은 현재 플랫폼 범위에서 제외했습니다. 과거 전체 제품 요구사항과 미완료 계획은 후속 자산으로 보존했습니다.

- SR 등록자가 초안과 검토자를 함께 입력합니다. 현재 담당자와 관리자도 검토자를 바꿀 수 있습니다. 팀 정책 편집 권한은 유지합니다.
- AI와 정리에서 질문 생성, 질문 설명, 질문 선택, 답변, 문서 반영 확인, Plan 초안 확인과 반영을 이어갑니다.
- Plan 한눈에에서 여섯 문서의 요약과 현재 검토 상태를 보여 줍니다. 유효한 시각화 자료가 있으면 변화와 동작, 사용자가 보는 화면, 지킬 약속과 예외를 탐색합니다.
- 상황을 선택하면 관련 동작과 결과가 강조되고 화면 예시도 바뀝니다. 흐름의 연결, 조건, 규칙에는 원문 인용과 문서 이동을 제공합니다.
- 문서와 리뷰에서 원문을 읽고 문단별 댓글·수정 요청·반영 보고·해결 확인을 진행합니다.
- 공유·결재에서 검토자를 지정하고 현재 Plan 버전을 검토·승인합니다. 승인한 문서 범위, 검토자 의견과 승인 시각을 표시합니다. Plan을 수정하면 새 버전을 다시 검토합니다.

기존 G1/G2 결과만으로 새 Inception Plan 결재 완료를 표시하지 않습니다. 기존 개별 자료는 참고 자료로 보존합니다. 사용자가 제공한 시각화 예시의 핵심과 이미지 다섯 장은 aidlc-docs/inception/requirements/visual-reference/ 안에 포함했습니다. 다른 프로젝트나 개인 폴더를 실행 중 참조하지 않습니다.

## 체험 방법

1. http://localhost:4173 에서 SR로 Plan 시작을 누릅니다.
2. 제목·초안을 적고 함께 검토할 사람을 선택합니다.
3. AI와 정리에서 질문에 답한 뒤 Plan 문서 초안 작성을 요청합니다. 제안을 읽고 반영합니다.
4. Plan 한눈에에서 상황별 흐름과 화면 예시를 살펴봅니다. 원문에서 확인할 내용은 근거 문서 열기로 이동합니다.
5. 공유·결재에서 검토를 요청합니다. 체험할 역할을 동료 검토자로 바꾸면 문서 댓글·수정 요청·승인을 확인할 수 있습니다.
6. 담당자가 현재 Plan 버전의 결재를 완료합니다.

기존 SR을 여는 경우 AI와 정리에서 Inception Plan을 새로 작성하거나 보완해야 새 시각화 자료가 생깁니다. 기존 문서와 승인은 자동으로 다시 작성하지 않았습니다. AI가 시각화 자료를 만들지 않았거나 형식·인용 검증을 통과하지 못한 경우 원문 요약을 제공하고 보완 안내를 표시합니다.

## 실제 검증 결과

다음 명령을 실행했습니다.

```sh
npm run typecheck
npm run build
npm test -- tests/integration/review-policy.test.ts tests/integration/artifact-edit.test.ts tests/integration/g1-review.test.ts tests/integration/question-decision.test.ts
npm test -- tests/unit/web
```

typecheck와 build는 exit 0입니다. 관련 통합 테스트는 4개 파일의 45개 테스트가 통과했습니다. 화면 상태 단위 테스트는 6개 파일의 51개 테스트가 통과했습니다. 관련 테스트 합계는 96개입니다. 빌드는 222개 모듈을 처리했습니다. Vite의 기존 설정 안내와 500 kB를 넘는 JavaScript 청크 경고는 남아 있습니다. 최종 JavaScript 파일은 index-BQV2nFtb.js입니다.

보조 검증도 실행했습니다.

```sh
./node_modules/.bin/tsx /tmp/plan-visualization-probe.ts
./node_modules/.bin/tsx --tsconfig tsconfig.json /tmp/inception-plan-filter-probe.ts
./node_modules/.bin/tsx .planrepo/local-tools/inspect-visual-draft.ts
```

시각화 parser의 데이터 형식, 중복 ID, 연결 대상, 인용 근거와 크기 제한 검사를 통과했습니다. 구조 추출 보조 검증은 14개 assertion을 통과했습니다. 실제 Claude 초안에서 시각화 parser가 ready를 반환했습니다. 위 /tmp 검증 파일과 격리 DB 조회 명령은 이번 실행의 보조 증거이며 프로젝트 시작의 의존성이 아닙니다.

실제 설치 Claude CLI 2.1.265와 global.anthropic.claude-opus-4-8을 격리 서버에서 사용했습니다. 질문 제안 1회와 Plan 개정 2회가 모두 succeeded로 종료했습니다. 마지막 초안에서 동작 9개, 연결 7개, 상황 4개, 규칙 5개를 읽었습니다. provider adapter 교체 구조와 기존 실행 제한을 유지했습니다.

브라우저에서는 다음 흐름을 직접 확인했습니다.

- SR 등록과 검토자 지정, 실제 AI 질문 선택과 답변, 초안 반영과 답변 반영 확인을 진행했습니다.
- 동료의 문단 댓글과 차단 수정 요청, 담당자의 Plan v3 수정과 반영 보고, 동료의 해결 확인과 승인, 담당자의 결재를 진행했습니다.
- 시각화가 포함된 Plan v4를 반영한 뒤 이전 승인을 재사용하지 않는 상태를 확인했습니다. 현재 Plan v4의 검토와 결재를 다시 완료했습니다.
- 네 가지 상황 선택에 따라 강조 경로와 결과·화면이 달라졌습니다. 세 시각화 탭과 원문 이동을 확인했습니다.
- 1280px와 390px 화면에서 확인했습니다. 390px 화면의 페이지 폭은 390px로 가로 넘침이 없었습니다.
- SR 직접 링크 새로고침과 역할 변경 후 같은 SR 유지, 클립보드를 사용할 수 없을 때 URL 표시를 확인했습니다.
- 최종 페이지 새로고침 후 브라우저 console 오류가 없었습니다.

## 실패·생략과 제한

초기 격리 빈 fixture에는 검토 정책이 없어 등록 후 검토자 배정이 거절됐습니다. 격리 데이터에 demo 정책을 준비한 뒤 두 번째 SR 등록 전체가 통과했습니다. 사용자 DB의 정책을 변경한 검증은 아닙니다.

Markdown 다운로드 버튼 클릭은 확인했습니다. 브라우저 도구가 다운로드 경로 설정을 허용하지 않아 실제 파일 전달까지는 검증하지 못했습니다. 해당 브라우저 정책을 변경하지 않았습니다. 공유 링크는 같은 로컬 플랫폼 안에서 쓰며 공개 게시나 외부 메시지 발송은 구현하지 않았습니다.

사용자의 프로토타입 지시에 따라 새 기능 전체를 TDD로 확장하지 않았습니다. 등록자 권한 변경의 최소 DB 회귀는 실패를 확인한 후 수정했습니다. 전체 제품 수용성·성능·기존 E2E 전체 실행은 생략했습니다. 위 관련 테스트의 통과가 전체 제품 완성이나 전체 테스트 통과를 뜻하지 않습니다.

여섯 문서는 기존 requirements artifact 안의 H2 구역으로 저장됩니다. 각 문서를 독립 버전으로 관리하지 않습니다. 기존 검토 계약을 유지하기 위해 여섯 구역을 requirementLinks에 연결합니다. 각 항목은 사람의 문서 확인 기준이며 자동으로 의미의 완전성을 판정하지 않습니다.

시각화는 현재 Plan 버전에 포함한 설명용 자료입니다. 인용문과 연결 대상의 유효성을 검사하지만 AI 해석이 사실에 맞는지 자동으로 증명하지 않습니다. 화면 예시의 버튼은 실제 업무를 실행하지 않습니다. AI 초안과 답변 반영 여부, 미확인 결정은 사람이 원문을 읽고 확인해야 합니다.

현재 사용자·프로젝트 선택은 기존 로컬 체험 모델을 유지합니다. 실제 조직 인증과 운영 배포를 추가하지 않았습니다.

## 사용자 데이터 보존과 실행 상태

업데이트 전 SQLite 백업을 만들고 새 빌드로 포트 4173 서버를 다시 시작했습니다. 기존 SR 5건과 업무 테이블 37개의 row hash가 같았습니다. PRAGMA integrity_check는 ok였습니다. readiness는 HTTP 200과 ready=true, generationReady=true를 반환했습니다.

- 데이터 폴더: .planrepo/previews/cg17-20260909/.planrepo/data
- 백업: .planrepo/previews/cg17-20260909/updates/inception-20260909-0527/before-inception.sqlite
- 보존 결과: .planrepo/previews/cg17-20260909/updates/inception-20260909-0527/preservation-report.json

격리 검증용 포트 64243 서버는 SIGINT로 정상 종료했습니다. 테스트용 SR을 사용자 DB에 넣지 않았습니다. 포트 4173의 사용자 서버는 실행 상태를 유지했습니다.

## 화면과 검증 증거

다음 파일은 프로젝트 루트 기준입니다.

- aidlc-docs/construction/planrepo/code/inception-prototype-evidence/interactive-flow.png
- aidlc-docs/construction/planrepo/code/inception-prototype-evidence/scenario-screen.png
- aidlc-docs/construction/planrepo/code/inception-prototype-evidence/mobile.png
- aidlc-docs/construction/planrepo/code/inception-prototype-evidence/approval.png
- aidlc-docs/construction/planrepo/code/inception-prototype-evidence/verification-evidence.json

흐름과 화면 이미지는 Plan v4 검토 중, 결재 이미지는 Plan v4 결재 후의 화면입니다. 실행 상태·문서 버전·승인 결과는 verification-evidence.json에 기록했습니다.

## 확장 준수

Security Baseline, Resiliency Baseline, Property-Based Testing 확장은 기존 사용자 선택대로 비활성화해 모두 N/A입니다. 활성화하지 않은 규칙 본문을 새로 강제하지 않았습니다. 기존 권한·저장·버전 검증은 유지했습니다.
