# 브랜치 디자인 통합 검증 기록

## 반영 범위와 원본

2026-09-09에 `maruachi/planrepo-ddthon`의 `feature/feature-jy0620.choi`를 확인했습니다. 기준 commit은 `971044894d7e7dd061494166538bc8d771b515e8`입니다. `src/app/styles.css`, `WorkspaceShell.tsx`, `logo.png`, `PlanningPanel.tsx`, `grill-chat.ts`를 비교했습니다.

현재 브랜치와 기존 변경을 보존하고 화면 디자인을 이 프로젝트의 컴포넌트에 맞춰 옮겼습니다. 흰색 상단 메뉴, 파랑·보라 강조, 회색 배경, 공통 input/select/textarea, 초안 등록 폼, 문서와 검토 화면에 적용했습니다. 로고는 `src/web/assets/logo.png`에 포함했습니다. 원본 저장소나 개인 폴더는 실행에 필요하지 않습니다.

원본 질문 목업의 한 질문씩 확인하는 구성을 실제 답변 저장 흐름에 연결했습니다. 질문 후보 선택, 직접 수정, 명시적인 저장, 이전·다음 이동, 닫았다 다시 열기를 제공합니다. 결재 전 문서와 리뷰에서 AI 질문·보완안·시각화를 요청할 수 있습니다. 결재 완료 화면은 읽기 전용이며 사용자가 개정안 준비를 명시적으로 시작합니다.

원본 `grill-chat.ts`와 `plan-review-data.ts`의 정해진 응답과 화면 내부 승인 상태는 제품 로직으로 옮기지 않았습니다. 실제 질문·문서·승인 API와 교체 가능한 provider를 유지했습니다. 대화형 터미널 전체와 자유로운 되묻기 기능을 모두 이식한 것은 아닙니다.

## 실제 동작 수정

프로토타입에서 검토자 지정만으로 검토 요청이 발송되던 행동을 수정했습니다. documentReviewMode에서는 M-030이 배정만 저장합니다. 사용자가 M-020으로 요청할 때 현재 문서의 공식 검토가 시작됩니다. 기존 strict 모드 동작은 유지합니다.

등록 중에는 메뉴 이동, 역할 변경과 닫기를 잠급니다. 브라우저 뒤로 가기에도 등록 폼과 진행 중 명령을 유지합니다. 완료 뒤에는 생성한 SR을 열고 이동 제한을 해제합니다.

질문 후보 선택만으로 답변을 저장하지 않습니다. M-008로 저장한 답변만 기록되며 문서는 별도 반영 전까지 유지됩니다. AI 제안 생성과 기존 결재본 열람만으로 승인을 바꾸지 않습니다.

개발 서버에서 공유 모듈이 403으로 차단되던 문제는 Vite 허용 경로에 `src/domain`을 추가해 수정했습니다.

## 최종 명령 검증

- [x] `npm run typecheck`가 exit 0으로 끝났습니다.
- [x] `npm run build`가 exit 0으로 끝났습니다.
- [x] `git diff --check`가 exit 0으로 끝났습니다.
- [x] 다음 관련 테스트 10개 파일의 100개 테스트가 통과했습니다.

```sh
npm test -- tests/integration/review-policy.test.ts tests/integration/g1-review.test.ts tests/integration/generation-loop.test.ts tests/integration/readiness.test.ts tests/contract/http-boundary.test.ts
```

5개 파일, 65개 테스트가 통과했습니다.

```sh
npm test -- tests/integration/change-request.test.ts tests/integration/artifact-edit.test.ts tests/integration/version-review-impact.test.ts tests/unit/web/artifact-structure.test.ts tests/unit/web/plan-review-readiness.test.ts
```

5개 파일, 35개 테스트가 통과했습니다.

M-030 회귀는 먼저 테스트 실패를 확인했습니다. 검토자 변경 후 bundle과 review request가 1개에서 2개로 증가하는 것이 실패 원인이었습니다. 수정 후에는 배정만으로 추가되지 않고, 명시적 M-020이 각각 하나씩 추가하는 것을 확인했습니다.

최신 빌드는 `index-tgZ_yDh2.js`, `index-BFTfWiLX.css`, `logo-CT4ezL3m.png`를 생성했습니다. Vite의 향후 config 로딩 방식 안내와 500 kB 초과 chunk 경고는 남아 있습니다. 빌드 실패는 아닙니다.

## 격리 브라우저 검증

실제 서버·SQLite·HTTP API를 사용하는 별도 DEMO-4 앱에서 확인했습니다. 모델 결과만 fixture로 준비했습니다. 이번 UI 검증에서 실제 Claude를 새로 호출하지 않았습니다.

- [x] 초안을 등록하고 동료 검토자를 지정했습니다. 상태는 문서 작성 중으로 남았습니다.
- [x] 명시적으로 문서 검토를 요청했습니다. 검토자가 체크리스트와 의견을 저장하고 승인했습니다. 담당자가 문서 v1의 최종 결재를 마쳤습니다. AI와 시각화를 사용하지 않아도 통과했습니다.
- [x] 질문 후보 선택 후 닫고 다시 열면 입력이 유지됐습니다. 저장 전에는 서버 질문 두 개가 모두 미답변 상태였습니다.
- [x] 답변을 직접 수정하고 저장했습니다. 해당 질문만 답변 완료가 됐고 다른 질문과 artifact 버전은 유지됐습니다.
- [x] 모달의 초기 focus, Escape, 닫기 후 원래 버튼으로의 focus 복귀를 확인했습니다. 빈 답변의 저장 버튼은 비활성화됐습니다.
- [x] 승인된 문서의 기본 편집·AI 진입점이 숨겨졌습니다. 개정 준비를 열고 닫아도 기존 승인이 유지됐습니다.
- [x] 실제 M-003 응답만 8초 지연시켜 등록 중 이동을 확인했습니다. 메뉴·역할·닫기가 잠겼고 뒤로 가기에도 폼을 유지했습니다. 이후 M-006, M-015, M-030이 완료돼 새 문서 v1을 열었습니다.
- [x] desktop 1440px와 mobile 390×844에서 화면을 확인했습니다. 모바일 문서와 등록 폼의 페이지 너비는 390px였으며 입력 요소가 화면 밖으로 넘치지 않았습니다. 질문 모달의 저장 버튼과 하단 이동 버튼도 화면 안에 있었습니다.
- [x] 최종 빌드의 질문·등록 흐름과 localhost 화면에서 `browse console --errors` 결과는 `(no console errors)`였습니다.

초기 개발 환경의 공유 모듈 403과 격리 proxy Origin 설정 오류는 수정 후 다시 확인했습니다. 전체 세션에서 오류가 한 번도 없었다는 뜻은 아닙니다.

## 로컬 반영과 데이터 보존

`http://localhost:4173`에서 최신 빌드를 제공합니다. `/health/ready`의 ready와 generationReady는 모두 true입니다. 기존 SR 7건과 SR 범위 업무 테이블 30개를 백업과 비교했습니다. 27개 테이블은 행 수·SHA-256이 동일했습니다. input_snapshots 1행, execution_observations 1행, activity_events 2행이 추가됐습니다. 이 세 테이블을 포함해 30개 테이블의 기존 행은 값과 순서가 모두 보존됐습니다. 추가분은 회의실 SR의 질문 생성 이력이며 실행 주체는 이 기록만으로 단정하지 않습니다. 승인된 회의실 문서 v2와 최종 승인, 기존 예시 기록을 유지했습니다. 테스트용 SR은 격리 DB에만 생성했습니다.

## 화면 증거

PNG 원본을 이 프로젝트 안에 보관했습니다.

- [팀 보드](reference-design-evidence/board-desktop.png)
- [초안 등록 desktop](reference-design-evidence/registration-desktop.png)
- [초안 등록 mobile](reference-design-evidence/registration-mobile.png)
- [질문 답변 desktop](reference-design-evidence/question-desktop.png)
- [질문 답변 mobile](reference-design-evidence/question-mobile.png)
- [격리 앱 최종 결재](reference-design-evidence/approval-isolated.png)

## 남은 범위와 최신 논의

전체 제품 TDD 확대, 성능 검사와 운영 배포는 이번 범위에서 생략했습니다. Security, Resiliency, Property-Based Testing 확장은 기존 Enabled=No 설정에 따라 N/A입니다.

사용자가 초안 단계 Grill-me 필수화를 새로 제안했습니다. 현재 반영본은 기존 합의대로 AI 질문이 선택 기능입니다. 필수화의 권장 방향은 초안 저장을 허용한 뒤 검토 요청 전에 AI의 이해를 사람이 확인하는 것입니다. 문서에 이미 있는 내용은 다시 묻지 않고, 중요한 범위·업무 결정만 질문합니다. 질문 수를 채우거나 기술 세부를 사용자가 결정하도록 강제하지 않습니다. 이는 후속 흐름 제안이며 아직 필수 조건으로 구현하지 않았습니다.
