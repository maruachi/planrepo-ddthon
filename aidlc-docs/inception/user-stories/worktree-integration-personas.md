# Worktree 통합 Personas

## Persona 1 — Local Planner

### 역할

로컬 PlanRepo에서 SR을 작성하고 개발 저장소를 연결하며 AI-DLC 계획 과정을 운영하는 소프트웨어 작성자다. 저장소 운영자 책임도 함께 가지며, 어떤 프로젝트 지침과 실행 기능을 신뢰할지 결정한다.

### 목표

- 실제 프로젝트 소스와 지침을 읽은 AI-DLC 결과를 얻는다.
- 여러 SR의 변경을 서로 다른 worktree로 격리한다.
- 질문·승인·문서 편집을 한 UI에서 처리한다.
- Git commit 없이 계획과 파일 변경의 시점별 이력을 비교·복원한다.
- 중단·drift·충돌이 발생해도 파일을 잃지 않고 다음 행동을 선택한다.

### 동기

- Git, Claude session과 파일 탐색 도구를 오가는 비용을 줄이고 싶다.
- 자동화가 저장소를 예기치 않게 commit·push·reset하지 않는다는 확신이 필요하다.
- AI의 제안과 사람이 확정한 결정을 분리해 추적하고 싶다.

### 불편과 위험

- 현재 Claude 실행은 임시 디렉터리에서 이뤄져 실제 프로젝트 문맥을 사용하지 않는다.
- 고정된 9단계 UI가 실제 AI-DLC 상태와 다를 수 있다.
- 외부 편집, CLI 중단과 수집 실패가 DB projection과 파일을 어긋나게 할 수 있다.
- 저장소 지침·hook·민감한 환경 값은 신뢰 경계를 넓힌다.

### 행동과 환경

- macOS 로컬 브라우저와 loopback PlanRepo 서버를 사용한다.
- Claude Code CLI의 기존 사용자 인증을 사용한다.
- 한 번에 여러 SR을 볼 수 있지만 한 SR에는 하나의 쓰기 run만 허용한다.
- author/reviewer 역할 전환을 사용할 수 있으나 실제 로그인은 없다.

### 권한 경계

- 허용 루트 아래 저장소만 등록할 수 있다.
- 저장소 최초 실행과 AI-DLC 초기화를 명시적으로 승인한다.
- Drift 수용, 문서 복원과 저장소 정책 변경을 결정한다.
- 기본 정책에서 commit, push, destructive Git 명령을 허용할 수 없다.

### 관련 Stories

US-WT-01부터 US-WT-18까지 모든 story의 primary persona다. US-WT-17에서는 author 역할로 peer review를 요청하고 기존 draft 보호를 확인한다.

## Persona 2 — Peer Reviewer

### 역할

Local Planner가 선택한 정확한 계획 문서 버전을 검토하고 승인 또는 변경 요청을 남기는 동료 검토자다. 로컬 데모에서는 역할 전환으로 표현되지만 리뷰 결과는 별도 actor의 불변 결정으로 취급한다.

### 목표

- 검토 요청 당시 원본 문서와 이후 최신 문서를 구분한다.
- AI-DLC 승인 gate와 peer review 상태를 혼동하지 않는다.
- 자신의 리뷰 의견이 원본 버전에 영구 연결되도록 한다.
- 역할을 전환해도 작성 중인 draft가 유실되지 않게 한다.

### 동기

- 코드 구현 이전에 계획의 누락과 위험을 발견하고 싶다.
- 변경된 문서를 기존 승인으로 통과시키지 않도록 검증하고 싶다.
- 리뷰가 AI-DLC 진행을 불필요하게 막지는 않되 필수 승인 gate를 우회하지 않기를 원한다.

### 불편과 위험

- Worktree 문서가 외부에서 바뀌면 자신이 본 버전과 최신 버전이 달라질 수 있다.
- 같은 화면에서 AI-DLC 승인과 peer review가 함께 보이면 결정의 의미가 모호해질 수 있다.
- 역할 전환 시 저장하지 않은 리뷰·문서 draft가 손실될 수 있다.

### 권한 경계

- 요청된 정확한 document version에 대해 한 번의 terminal review 결과를 기록한다.
- Repository trust, AI-DLC 초기화, run 실행, drift 수용과 복원은 수행하지 않는다.
- Peer review 결과만으로 AI-DLC의 profile-defined 승인 gate를 통과시킬 수 없다.

### 관련 Stories

- **Primary**: US-WT-17
- **Supporting**: US-WT-10, US-WT-12, US-WT-13, US-WT-14, US-WT-18

## Persona-to-Story Mapping

| Story 범위 | Local Planner | Peer Reviewer |
| --- | --- | --- |
| US-WT-01..US-WT-09 | Primary | N/A |
| US-WT-10 | Primary | Supporting |
| US-WT-11 | Primary | N/A |
| US-WT-12..US-WT-14 | Primary | Supporting |
| US-WT-15..US-WT-16 | Primary | N/A |
| US-WT-17 | Author/Supporting | Primary |
| US-WT-18 | Primary | Supporting |

## 비-Persona Actor

Claude Code CLI, Git, AI-DLC profile parser와 PlanRepo background collector는 시스템 actor이며 persona가 아니다. 이들은 사용자의 목표를 수행하는 외부 실행기 또는 내부 컴포넌트로 acceptance criteria에만 등장한다.
