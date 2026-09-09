# PlanRepo Worktree 통합 User Stories

## 구성 원칙

- **범위**: 승인된 P0와 P1만 포함한다.
- **접근**: 사용자 여정 순서와 repository/worktree/profile/checkpoint/drift domain을 결합한 Hybrid다.
- **Persona**: [Local Planner와 Peer Reviewer](worktree-integration-personas.md)
- **형식**: 각 story는 사용자 가치 하나의 vertical slice이며 Given/When/Then acceptance criteria와 요구사항 trace를 가진다.
- **우선순위**: P0는 실제 AI-DLC 실행 기반, P1은 문서 운영과 호환성이다.

## Epic A — 저장소와 작업공간 준비

### US-WT-01 신뢰할 수 있는 로컬 저장소 등록

**As a** Local Planner, **I want** 허용 루트 아래의 Git 저장소를 검증하고 신뢰 여부와 함께 등록하고 싶다. **So that** PlanRepo가 잘못되거나 신뢰하지 않은 프로젝트를 실행하지 않도록 할 수 있다.

- **Priority**: P0
- **Dependencies**: 없음
- **Parallelization**: Profile 목록 조회 UI와 병렬 설계 가능
- **Trace**: FR-WT-01, NFR-WT-02, NFR-WT-05, AC-WT-13
- **INVEST**: I—독립 등록 흐름, N—검증 UI 세부는 설계 가능, V—안전한 시작점, E—한 resource 범위, S—clone 제외, T—경로·Git·trust 결과로 검증 가능

#### Acceptance Criteria

1. **Given** 서버에 단일 repository allowed root가 설정되어 있고 **When** 사용자가 그 아래의 유효한 Git 경로를 등록하면 **Then** canonical path, HEAD, 기본 branch, origin, profile과 검증 상태가 저장된다.
2. **Given** 경로가 allowed root 밖이거나 Git 저장소가 아니고 **When** 등록을 시도하면 **Then** 등록은 fail closed하고 내부 경로를 노출하지 않는 진단 코드를 표시한다.
3. **Given** 저장소가 검증되었지만 아직 신뢰되지 않았고 **When** 최초 실행을 준비하면 **Then** 프로젝트 지침·hook·실행 파일의 위험을 보여주고 명시적 trust 전에는 실행하지 않는다.

### US-WT-02 SR 연결과 기존 SR baseline 전환

**As a** Local Planner, **I want** SR을 저장소와 기준 SHA에 연결하고 기존 SR 문서를 안전하게 baseline으로 전환하고 싶다. **So that** 기존 이력을 잃지 않고 worktree 기반 흐름을 시작할 수 있다.

- **Priority**: P0
- **Dependencies**: US-WT-01
- **Parallelization**: 신규 SR 연결과 legacy export adapter를 분리 가능
- **Trace**: FR-WT-02, NFR-WT-01, NFR-WT-06, AC-WT-14
- **INVEST**: I—연결·전환 결과가 독립 가치, N—export 배치는 협의 가능, V—기존 사용자 보호, E—SR 한 개 경계, S—자동 일괄 migration 제외, T—성공·실패 rollback으로 검증 가능

#### Acceptance Criteria

1. **Given** 등록된 저장소가 있고 **When** 신규 SR 또는 미연결 SR에 repository와 base SHA를 선택하면 **Then** 한 SR에 하나의 immutable workspace binding 후보가 저장된다.
2. **Given** 기존 SQLite 문서가 있는 SR이고 **When** 사용자가 전환을 확인하면 **Then** profile 지정 경로에 문서를 내보내고 baseline checkpoint가 성공한 뒤에만 worktree mode로 전환한다.
3. **Given** export 또는 checkpoint가 실패하고 **When** 전환 transaction이 종료되면 **Then** 기존 문서·review·history와 legacy 조회가 유지되고 재시도 가능한 오류를 표시한다.

### US-WT-03 격리된 SR Worktree 준비

**As a** Local Planner, **I want** 첫 실행 직전에 SR 전용 branch와 worktree를 만들고 상태를 확인하고 싶다. **So that** 같은 저장소의 다른 SR과 파일 변경이 섞이지 않는다.

- **Priority**: P0
- **Dependencies**: US-WT-02
- **Parallelization**: Git adapter와 lifecycle UI 병렬 가능
- **Trace**: FR-WT-03, NFR-WT-01, NFR-WT-03, AC-WT-01
- **INVEST**: I—provisioning만 인수 가능, N—물리 경로는 설정 가능, V—SR 격리, E—Git worktree 명령 집합으로 추정 가능, S—삭제 lifecycle 제외, T—두 SR 격리와 실패 재시도로 검증 가능

#### Acceptance Criteria

1. **Given** 연결된 SR에 worktree가 없고 **When** 첫 실행을 요청하면 **Then** `planrepo/sr/<sr-id>` 충돌 없는 branch와 관리 root 아래 worktree를 생성한다.
2. **Given** 같은 repository에 SR A와 B가 있고 **When** 각각 provision하면 **Then** branch, directory, file manifest와 run context가 서로 다르다.
3. **Given** Git 작업이 부분 실패하고 **When** 상태를 다시 조회하면 **Then** `failed` 상태와 안전한 retry/cleanup 선택을 제공하며 ready로 표시하지 않는다.
4. **Given** 서버가 재시작되고 **When** workspace를 재검증하면 **Then** missing worktree와 branch mismatch를 구분해 표시한다.

### US-WT-04 AI-DLC Profile 탐색과 상태 판정

**As a** Local Planner, **I want** 저장소에 맞는 AI-DLC profile과 활성 상태 파일을 확인하고 싶다. **So that** PlanRepo 고정 단계가 아니라 실제 AI-DLC 진행 상태를 기준으로 작업할 수 있다.

- **Priority**: P0
- **Dependencies**: US-WT-01
- **Parallelization**: Legacy `aidlc-docs` parser와 official intent parser 병렬 가능
- **Trace**: FR-WT-04, FR-WT-07, NFR-WT-06, AC-WT-13
- **INVEST**: I—parser별 독립 검증 가능, N—profile registry 구현 선택 가능, V—정확한 진행 상태, E—두 profile로 범위 제한, S—추가 harness 제외, T—fixture와 ambiguity 사례로 검증 가능

#### Acceptance Criteria

1. **Given** `aidlc-docs/aidlc-state.md`가 유효하고 **When** legacy profile이 탐색하면 **Then** 현재 phase/stage, 첫 미완료 항목, 질문·승인·완료 상태를 파싱한다.
2. **Given** official space/intent 구조에 여러 상태 파일이 있고 **When** official profile이 탐색하면 **Then** 활성 intent의 상태 파일 하나를 결정하고 동일한 projection contract로 반환한다.
3. **Given** 후보가 없거나 둘 이상이라 활성 상태를 결정할 수 없고 **When** 사용자가 실행을 요청하면 **Then** `recovery_required`와 해결 지침을 표시하고 run을 만들지 않는다.
4. **Given** 상태와 필수 산출물이 모순되고 **When** 동기화하면 **Then** 진행·승인을 차단하고 원본 오류를 보존한다.

### US-WT-05 승인 기반 AI-DLC 초기화

**As a** Local Planner, **I want** AI-DLC 미구성 저장소의 초기화 변경을 미리 보고 승인하고 싶다. **So that** 기존 프로젝트 파일을 모르게 덮어쓰지 않고 필요한 harness를 설치할 수 있다.

- **Priority**: P0
- **Dependencies**: US-WT-03, US-WT-04
- **Parallelization**: 초기화 preview와 checkpoint adapter 병렬 가능
- **Trace**: FR-WT-04, NFR-WT-02, NFR-WT-03
- **INVEST**: I—초기화만 독립 인수, N—profile별 생성 파일 협의 가능, V—안전한 onboarding, E—두 profile command로 제한, S—업데이트 기능 제외, T—preview·취소·승인 결과로 검증 가능

#### Acceptance Criteria

1. **Given** 선택 profile이 설치되지 않았고 **When** 초기화를 선택하면 **Then** 생성·수정될 경로와 기존 충돌을 preview하고 아직 파일을 바꾸지 않는다.
2. **Given** preview가 있고 **When** 사용자가 명시적으로 승인하면 **Then** 전후 checkpoint를 만들고 profile initializer를 worktree에서 실행한다.
3. **Given** `AGENTS.md`, `CLAUDE.md`, `.gitignore` 또는 AI-DLC 설정이 이미 있고 **When** 초기화가 같은 경로를 요구하면 **Then** 자동 overwrite를 차단하고 파일별 해결을 요구한다.

## Epic B — 안전한 실행과 동적 진행

### US-WT-06 관리 파일 Checkpoint 생성

**As a** Local Planner, **I want** AI-DLC 실행과 문서 변경 전후의 관리 파일을 checkpoint로 보존하고 싶다. **So that** Git commit 없이 변경 원인과 복원 가능성을 추적할 수 있다.

- **Priority**: P0
- **Dependencies**: US-WT-03, US-WT-04
- **Parallelization**: Manifest walker, hash/blob adapter와 metadata schema 병렬 가능
- **Trace**: FR-WT-10, FR-WT-11, NFR-WT-01, NFR-WT-04, NFR-WT-05, AC-WT-07, AC-WT-15, AC-WT-16
- **INVEST**: I—checkpoint API로 독립 인수, N—hash·blob 내부 배치는 설계 가능, V—감사·복구 기반, E—20k/10MiB/500MiB 한도, S—전체 restore 제외, T—manifest·dedupe·PBT로 검증 가능

#### Acceptance Criteria

1. **Given** 준비된 worktree가 있고 **When** baseline 또는 작업 전후 checkpoint를 만들면 **Then** 상대 경로, change, hash, size, mode, blob, predecessor와 관련 actor/run을 불변 기록으로 저장한다.
2. **Given** 동일 content가 여러 checkpoint에 있고 **When** 수집하면 **Then** content-addressed blob은 재사용하지만 각 논리 version은 유지한다.
3. **Given** symlink가 worktree 밖을 가리키거나 경로가 `.git`, dependency cache, build output에 속하고 **When** manifest를 계산하면 **Then** content를 읽지 않고 제외 사유를 기록한다.
4. **Given** 파일 수·텍스트 크기·checkpoint 용량 상한을 넘거나 바이너리가 있고 **When** 수집하면 **Then** 원본은 유지하고 incomplete restorability와 오류를 표시하며 완전 성공으로 표시하지 않는다.

### US-WT-07 Git 쓰기 정책 적용

**As a** Local Planner, **I want** Claude와 AI-DLC의 Git 쓰기 동작을 저장소 정책으로 제한하고 싶다. **So that** 계획 실행이 commit graph, remote 또는 작업 파일을 파괴하지 않는다.

- **Priority**: P0
- **Dependencies**: US-WT-01, US-WT-03
- **Parallelization**: Policy evaluator와 process audit 병렬 가능
- **Trace**: FR-WT-15, NFR-WT-02, NFR-WT-05, AC-WT-12
- **INVEST**: I—policy 차단을 독립 시험 가능, N—enforcement mechanism은 설계 가능, V—저장소 안전, E—명령 allow/deny 표로 한정, S—commit 허용 미래 정책 제외, T—fake executable과 실제 repo로 검증 가능

#### Acceptance Criteria

1. **Given** 기본 policy이고 **When** Claude가 commit, push, force push, `reset --hard`, clean 또는 branch/worktree 삭제를 시도하면 **Then** 명령을 실행하지 않고 run을 fail/approval-required로 전환한다.
2. **Given** 기본 policy이고 **When** `git add` 또는 `git stash`를 요청하면 **Then** 금지하며 저장소별 명시적 허용 없이는 우회할 수 없다.
3. **Given** status, diff, log, show 또는 rev-parse가 필요하고 **When** 정확한 allowlist 인자로 호출하면 **Then** 읽기 전용 명령만 허용한다.
4. **Given** 금지 시도가 차단되고 **When** audit를 조회하면 **Then** actor/run, 명령 종류와 redacted 사유가 기록되고 commit graph와 remote는 변하지 않는다.

### US-WT-08 실제 Worktree에서 AI-DLC 시작·재개

**As a** Local Planner, **I want** SR worktree에서 실제 Claude Code CLI로 AI-DLC를 시작하거나 이어가고 싶다. **So that** 프로젝트 소스·지침·상태를 반영한 산출물을 얻을 수 있다.

- **Priority**: P0
- **Dependencies**: US-WT-03, US-WT-04, US-WT-06, US-WT-07
- **Parallelization**: Runner adapter와 command UI 병렬 가능, 최종 통합은 선행 story 필요
- **Trace**: FR-WT-05, FR-WT-06, FR-WT-07, NFR-WT-01, NFR-WT-02, NFR-WT-04, AC-WT-02, AC-WT-03
- **INVEST**: I—한 run 시작·완료 가치, N—CLI flag 조합은 설계 가능, V—핵심 제품 목표, E—Claude harness 하나, S—추가 harness 제외, T—cwd·prompt·files·receipt로 검증 가능

#### Acceptance Criteria

1. **Given** trust, worktree, profile, 상태, Claude 인증과 drift 점검이 통과했고 **When** 시작/재개를 누르면 **Then** 시작 checkpoint와 running state를 저장한 뒤 worktree root를 `cwd`로 shell 없이 Claude를 실행한다.
2. **Given** legacy `aidlc-docs` profile이고 **When** 재개하면 **Then** 승인된 정확한 한국어 resume 문구를 전송한다.
3. **Given** 한 SR에 running run이 있거나 전체 두 개가 실행 중이고 **When** 추가 실행을 요청하면 **Then** 중복 process를 만들지 않고 기존 run 또는 capacity 상태를 반환한다.
4. **Given** 같은 operation ID와 fingerprint로 응답을 재확인하고 **When** server receipt가 존재하면 **Then** 동일 run ID를 반환하고 prompt를 다시 보내지 않는다.

### US-WT-09 중단 실행과 부분 결과 복구

**As a** Local Planner, **I want** timeout·취소·서버 중단 후 변경 파일과 실행 상태를 확인하고 싶다. **So that** 부분 작업을 잃지 않고 유지·복원·재실행을 선택할 수 있다.

- **Priority**: P0
- **Dependencies**: US-WT-06, US-WT-08
- **Parallelization**: Startup recovery와 partial collector 병렬 가능
- **Trace**: FR-WT-06, NFR-WT-03, NFR-WT-05, AC-WT-10
- **INVEST**: I—실패 복구만 독립 가치, N—process termination 세부는 설계 가능, V—데이터 손실 방지, E—세 failure class, S—자동 rollback 제외, T—fault injection으로 검증 가능

#### Acceptance Criteria

1. **Given** run이 30분 timeout, 사용자 취소 또는 process 오류로 끝나고 **When** 종료 처리를 하면 **Then** 종료 원인·코드·transcript 참조와 partial checkpoint를 기록한다.
2. **Given** 서버가 running run 중 재시작하고 **When** startup recovery가 실행되면 **Then** run을 interrupted로 전환하고 실제 worktree 변경을 재수집한다.
3. **Given** partial 변경이 수집되었고 **When** 사용자가 SR을 열면 **Then** 유지·단일 문서 복원·재실행 선택을 제공하고 어떤 선택도 자동 실행하지 않는다.
4. **Given** 수집 자체가 실패하고 **When** 상태를 표시하면 **Then** 마지막 정상 checkpoint와 원본 진단을 보존하고 다음 실행을 차단한다.

### US-WT-10 실제 상태 기반 진행 화면

**As a** Local Planner, **I want** profile이 파싱한 현재 phase·stage와 가능한 다음 행동을 보고 싶다. **So that** 고정 단계와 실제 AI-DLC 상태가 어긋나는 문제 없이 진행할 수 있다.

- **Priority**: P0
- **Dependencies**: US-WT-04, US-WT-08
- **Parallelization**: Projection API와 UI 상태 카드 병렬 가능
- **Trace**: FR-WT-07, FR-WT-16, NFR-WT-07, AC-WT-03
- **INVEST**: I—read projection 독립 인수, N—시각 표현 협의 가능, V—정확한 다음 행동, E—상태 enum과 actions 경계, S—streaming 제외, T—profile fixture별 UI로 검증 가능

#### Acceptance Criteria

1. **Given** 상태 파일이 신규·진행·질문·승인·복구·완료 중 하나이고 **When** SR 상세를 열면 **Then** 실제 phase/stage, 첫 미완료 항목과 허용 action만 표시한다.
2. **Given** run이 진행 중이고 **When** polling하면 **Then** 동일 run을 재제출하지 않고 시작 시각, 상태, current activity와 취소 가능 여부를 갱신한다.
3. **Given** 상태 parser와 Claude 메시지가 다르고 **When** run 결과를 판정하면 **Then** 상태 파일·필수 산출물·process 결과를 우선하고 불일치를 진단한다.
4. **Given** 390 px viewport 또는 keyboard navigation을 사용하고 **When** 상태와 action을 탐색하면 **Then** 주요 정보와 focus 순서를 사용할 수 있다.

### US-WT-11 질문 응답과 결정 버전 관리

**As a** Local Planner, **I want** AI 질문의 원문을 보고 최종 응답을 편집·저장하고 싶다. **So that** 사람의 결정을 다음 AI-DLC 실행에 정확히 반영하고 과거 제안도 추적할 수 있다.

- **Priority**: P1
- **Dependencies**: US-WT-08, US-WT-10
- **Parallelization**: Interaction parser와 editor UI 병렬 가능
- **Trace**: FR-WT-09, NFR-WT-01, NFR-WT-05, AC-WT-05
- **INVEST**: I—질문 lifecycle 독립 가치, N—질문 source 조합은 profile로 협의, V—사람 통제, E—한 question set 경계, S—일반 chat 제외, T—원문·수정·version·후속 run으로 검증 가능

#### Acceptance Criteria

1. **Given** transcript 또는 질문 파일에 사용자 입력 요구가 있고 **When** SR 상세를 열면 **Then** 질문·선택지·권고안과 AI 원문을 표시한다.
2. **Given** 사용자가 선택지 또는 자유 텍스트를 편집했고 **When** 저장하면 **Then** 최종 응답을 새 immutable Interaction version으로 만들고 AI 원문을 유지한다.
3. **Given** 저장된 응답이 있고 **When** 다음 run을 시작하면 **Then** profile 규칙에 따라 worktree 질문 파일과 prompt context에 최종 응답을 반영한다.
4. **Given** 응답을 다시 수정하고 **When** 저장하면 **Then** 이전 값을 덮어쓰지 않고 질문·stage·문서·run 관계를 유지한 새 version을 만든다.

### US-WT-12 승인 기준본과 수정 요청

**As a** Local Planner, **I want** 현재 상태와 문서 hash에 묶인 승인을 하거나 수정 요청을 보내고 싶다. **So that** 검토하지 않은 변경이 기존 승인으로 다음 단계에 넘어가지 않는다.

- **Priority**: P1
- **Dependencies**: US-WT-10, US-WT-11, US-WT-13, US-WT-16
- **Parallelization**: Baseline fingerprint와 approval UI 병렬 가능
- **Trace**: FR-WT-08, NFR-WT-01, NFR-WT-03, NFR-WT-05, AC-WT-04, AC-WT-11
- **INVEST**: I—approval gate 독립 인수, N—fingerprint 표현은 설계 가능, V—stale 승인 방지, E—한 gate 경계, S—peer review는 별도, T—hash·revision·drift 사례로 검증 가능

#### Acceptance Criteria

1. **Given** profile이 approval awaiting을 판정하고 drift·draft가 없고 **When** 승인하면 **Then** 정확한 `승인 후 진행` 메시지와 path/hash set, state revision, actor, time을 기록한다.
2. **Given** 승인 대상 문서나 상태가 바뀌고 **When** 다음 action을 계산하면 **Then** 기존 승인을 invalid로 표시하고 재승인 전 진행을 차단한다.
3. **Given** 사용자가 승인 대신 수정 요청을 편집하고 **When** 전송하면 **Then** AI 원문, 최종 문구, 대상 baseline과 후속 run을 연결한다.
4. **Given** 미저장 draft 또는 unresolved drift가 있고 **When** 승인하려 하면 **Then** 승인 run을 만들지 않고 해결해야 할 항목을 표시한다.

## Epic C — Worktree 문서 운영

### US-WT-13 Worktree 파일과 이력 탐색

**As a** Local Planner, **I want** 현재 worktree 파일과 PlanRepo version·checkpoint 이력을 함께 탐색하고 싶다. **So that** 실제 파일과 과거 기록의 관계를 이해할 수 있다.

- **Priority**: P1
- **Dependencies**: US-WT-06, US-WT-08
- **Parallelization**: Artifact query API와 tree/list UI 병렬 가능
- **Trace**: FR-WT-10, FR-WT-11, FR-WT-16, NFR-WT-04, NFR-WT-07, AC-WT-07
- **INVEST**: I—read-only 탐색 독립 가치, N—tree/list UI 협의 가능, V—파일 기준 원본 가시성, E—managed files만, S—편집·복원 별도, T—path/version/checkpoint 조회로 검증 가능

#### Acceptance Criteria

1. **Given** 수집된 managed files가 있고 **When** 문서 목록을 열면 **Then** worktree 상대 경로, current hash, file kind, origin, latest version과 restorability를 표시한다.
2. **Given** 한 경로에 여러 version이 있고 **When** 이력을 조회하면 **Then** AI run, human edit, external edit, restore와 tombstone origin을 시간순으로 볼 수 있다.
3. **Given** transcript, 상태 또는 audit 파일이고 **When** 열면 **Then** read-only 분류와 redacted 내용을 표시한다.
4. **Given** 내부 절대 경로나 민감 환경 값이 저장 메타데이터에 있고 **When** 일반 UI 응답을 생성하면 **Then** 불필요한 값을 노출하지 않는다.

### US-WT-14 계획 문서 안전 편집

**As a** Local Planner, **I want** Worktree Markdown 계획 문서를 충돌 보호와 함께 편집하고 싶다. **So that** 다음 Claude 실행이 사람의 수정 내용을 실제 파일에서 읽을 수 있다.

- **Priority**: P1
- **Dependencies**: US-WT-06, US-WT-13, US-WT-16
- **Parallelization**: Atomic file writer와 editor state 병렬 가능
- **Trace**: FR-WT-12, NFR-WT-01, NFR-WT-07, AC-WT-06
- **INVEST**: I—한 문서 편집 독립 가치, N—editor widget 선택 가능, V—사람 수정 반영, E—Markdown만, S—binary·상태 편집 제외, T—hash conflict·atomic save·draft로 검증 가능

#### Acceptance Criteria

1. **Given** editable Markdown을 current hash와 함께 열었고 **When** 내용이 바뀌지 않은 상태에서 저장하면 **Then** pre-checkpoint, atomic rename, human-edit version과 post-checkpoint를 하나의 논리 작업으로 기록한다.
2. **Given** 마지막 read 이후 외부 변경이 있고 **When** 저장하면 **Then** write를 거부하고 사용자 draft를 보존하며 current file과 비교를 제공한다.
3. **Given** 상태·audit·runner instruction 또는 binary file이고 **When** 편집을 시도하면 **Then** server가 read-only policy로 거부한다.
4. **Given** 문서 편집이 성공하고 **When** approval·downstream 상태를 계산하면 **Then** 관련 항목을 stale로 표시하고 다음 Claude run은 새 파일을 읽는다.

### US-WT-15 문서 버전 비교와 복원

**As a** Local Planner, **I want** 한 문서의 과거 version을 비교하고 새 최신 version으로 복원하고 싶다. **So that** Git commit을 만들지 않고 잘못된 계획 변경을 되돌릴 수 있다.

- **Priority**: P1
- **Dependencies**: US-WT-06, US-WT-13, US-WT-14, US-WT-16
- **Parallelization**: 기존 diff worker 확장과 restore service 병렬 가능
- **Trace**: FR-WT-13, NFR-WT-01, NFR-WT-03, AC-WT-08
- **INVEST**: I—single-document restore 독립 가치, N—diff presentation 협의 가능, V—안전한 되돌림, E—한 path만, S—전체 checkpoint restore 제외, T—v1→v4와 conflict로 검증 가능

#### Acceptance Criteria

1. **Given** 동일 경로의 v1, v2, v3가 있고 **When** 두 version을 선택하면 **Then** Git commit과 무관한 bounded diff와 origin을 표시한다.
2. **Given** current hash가 마지막 인지 hash와 같고 **When** v1 복원을 확인하면 **Then** pre-checkpoint 후 v1 content를 atomic write하고 새 v4 restore version과 post-checkpoint를 만든다.
3. **Given** 복원 preview 이후 파일이 바뀌고 **When** 복원을 실행하면 **Then** overwrite를 차단하고 draft/drift 해결을 요구한다.
4. **Given** 상태·append-only audit·instruction file이고 **When** 일반 복원을 요청하면 **Then** 지원하지 않는 대상으로 거부한다.

### US-WT-16 외부 Drift 확인과 해결

**As a** Local Planner, **I want** PlanRepo 밖의 파일 변경을 유형별로 확인하고 처리 방법을 선택하고 싶다. **So that** 외부 작업을 자동 덮어쓰거나 승인하지 않을 수 있다.

- **Priority**: P0
- **Dependencies**: US-WT-06, US-WT-10
- **Parallelization**: Drift detector와 resolution UI 병렬 가능
- **Trace**: FR-WT-14, NFR-WT-03, NFR-WT-05, AC-WT-09
- **INVEST**: I—drift gate 독립 가치, N—diff batching 협의 가능, V—외부 변경 보호, E—가져오기·복원·파일별 결정, S—자동 merge 제외, T—외부 edit·missing·branch mismatch로 검증 가능

#### Acceptance Criteria

1. **Given** 마지막 checkpoint 이후 상태 파일·문서·worktree·branch가 바뀌고 **When** 상세 진입 또는 작업 전 sync를 실행하면 **Then** drift 유형과 영향 경로를 구분한다.
2. **Given** unresolved drift가 있고 **When** run 또는 approval을 요청하면 **Then** 동작을 차단하고 가져오기·최신 version 복원·파일별 결정을 제공한다.
3. **Given** 사용자가 외부 변경 가져오기를 선택하고 **When** 검증이 통과하면 **Then** 전후 checkpoint와 `external_edit` version을 기록한다.
4. **Given** 파일별 자동 병합이 필요한 충돌이고 **When** 해결 화면을 열면 **Then** 이번 범위에서 자동 merge하지 않고 수동 해결 지침을 제공한다.

## Epic D — 호환성, 리뷰와 인계

### US-WT-17 기존 Review와 Draft 보호 유지

**As a** Peer Reviewer, **I want** Worktree 전환 후에도 요청 당시 문서 version을 검토하고 역할별 draft를 보호받고 싶다. **So that** 기존 리뷰 의미와 작성 중 작업이 새 파일 모델에서도 유지된다.

- **Priority**: P1
- **Dependencies**: US-WT-02, US-WT-12, US-WT-13, US-WT-14
- **Parallelization**: Review compatibility adapter와 dirty-state UI regression 병렬 가능
- **Trace**: FR-WT-08, FR-WT-16, NFR-WT-06, NFR-WT-07
- **INVEST**: I—compatibility를 독립 인수, N—adapter 위치 협의 가능, V—기존 기능 회귀 방지, E—review·draft 두 경계, S—새 협업 모델 제외, T—원본 version·role switch·pending review로 검증 가능

#### Acceptance Criteria

1. **Given** worktree 문서 version에 review가 요청되고 **When** 파일이 이후 편집되면 **Then** review는 요청 당시 version에 남고 original/latest 비교를 제공한다.
2. **Given** peer review가 pending이고 **When** AI-DLC profile은 진행 가능하다고 판정하면 **Then** peer review가 run을 막지 않되 필수 AI-DLC approval gate는 우회하지 않는다.
3. **Given** 문서·질문·review draft가 저장되지 않았고 **When** role 또는 route를 바꾸면 **Then** 기존 dirty-state 보호가 전환을 막거나 명시적 폐기를 요구한다.
4. **Given** legacy SR이 baseline 전환되었고 **When** 과거 review/history를 조회하면 **Then** 기존 actor, target version과 terminal result가 보존된다.

### US-WT-18 실제 상태 기반 완료와 구현 인계

**As a** Local Planner, **I want** AI-DLC 완료를 실제 상태와 수집 결과로 확인하고 구현 인계 요약을 받고 싶다. **So that** 계획이 준비됐다는 근거와 수동 구현 상태를 혼동하지 않을 수 있다.

- **Priority**: P1
- **Dependencies**: US-WT-10, US-WT-12, US-WT-13, US-WT-17
- **Parallelization**: Handoff summary와 board projection 병렬 가능
- **Trace**: FR-WT-17, NFR-WT-01, NFR-WT-05, NFR-WT-07
- **INVEST**: I—completion/handoff 독립 가치, N—summary layout 협의 가능, V—명확한 인계, E—read-only bundle, S—build·merge 자동화 제외, T—complete/incomplete/collect-failed fixture로 검증 가능

#### Acceptance Criteria

1. **Given** profile 상태가 complete이고 필수 수집이 성공했고 **When** projection을 갱신하면 **Then** workflow를 complete로 표시하고 stop policy를 준수한다.
2. **Given** 상태는 complete지만 수집 실패·drift·stale approval이 있고 **When** 완료를 판정하면 **Then** complete로 표시하지 않고 해결 원인을 제시한다.
3. **Given** workflow가 완료되었고 **When** 구현 인계를 열면 **Then** current manifest, 최신 계획, approval baseline, run·Interaction 이력을 read-only 요약으로 제공한다.
4. **Given** 사용자가 수동 구현 완료를 표시하고 **When** 보드 상태를 갱신하면 **Then** 해당 선언을 실제 build·merge·push 검증과 구분하며 자동 Git 작업을 실행하지 않는다.

## Story Dependency와 병렬 가능성

| Story | 선행 Story | 병렬화 메모 |
| --- | --- | --- |
| US-WT-01 | 없음 | Profile catalog read model과 병렬 가능 |
| US-WT-02 | 01 | 신규 연결과 legacy export 분리 가능 |
| US-WT-03 | 02 | Git adapter와 lifecycle UI 분리 가능 |
| US-WT-04 | 01 | Legacy/official parser 병렬 가능 |
| US-WT-05 | 03, 04 | Preview와 initializer 분리 가능 |
| US-WT-06 | 03, 04 | Manifest/blob/schema 분리 가능 |
| US-WT-07 | 01, 03 | Policy evaluator와 audit 분리 가능 |
| US-WT-08 | 03, 04, 06, 07 | Runner/UI 병렬 후 통합 |
| US-WT-09 | 06, 08 | Startup recovery/collector 병렬 가능 |
| US-WT-10 | 04, 08 | Projection API/UI 병렬 가능 |
| US-WT-11 | 08, 10 | Parser/editor 병렬 가능 |
| US-WT-12 | 10, 11, 13, 16 | Fingerprint/UI 병렬 후 통합 |
| US-WT-13 | 06, 08 | Query/UI 병렬 가능 |
| US-WT-14 | 06, 13, 16 | Writer/editor 병렬 가능 |
| US-WT-15 | 06, 13, 14, 16 | Diff/restore 병렬 가능 |
| US-WT-16 | 06, 10 | Detector/UI 병렬 가능 |
| US-WT-17 | 02, 12, 13, 14 | Service/UI regression 병렬 가능 |
| US-WT-18 | 10, 12, 13, 17 | Summary/board projection 병렬 가능 |

의존 그래프는 순환하지 않는다. 문서상 번호는 사용자 여정을 나타내며, 구현 순서는 위 선행 관계를 우선한다.

## Requirements Coverage

| 요구사항 | Stories |
| --- | --- |
| FR-WT-01 | US-WT-01 |
| FR-WT-02 | US-WT-02 |
| FR-WT-03 | US-WT-03 |
| FR-WT-04 | US-WT-04, US-WT-05 |
| FR-WT-05 | US-WT-08 |
| FR-WT-06 | US-WT-08, US-WT-09 |
| FR-WT-07 | US-WT-04, US-WT-08, US-WT-10 |
| FR-WT-08 | US-WT-12, US-WT-17 |
| FR-WT-09 | US-WT-11 |
| FR-WT-10 | US-WT-06, US-WT-13 |
| FR-WT-11 | US-WT-06, US-WT-13 |
| FR-WT-12 | US-WT-14 |
| FR-WT-13 | US-WT-15 |
| FR-WT-14 | US-WT-16 |
| FR-WT-15 | US-WT-07 |
| FR-WT-16 | US-WT-10, US-WT-13, US-WT-17 |
| FR-WT-17 | US-WT-18 |
| NFR-WT-01 | US-WT-02, 03, 06, 08, 11, 12, 14, 15, 18 |
| NFR-WT-02 | US-WT-01, 05, 07, 08 |
| NFR-WT-03 | US-WT-03, 05, 09, 12, 15, 16 |
| NFR-WT-04 | US-WT-06, 08, 13 |
| NFR-WT-05 | US-WT-01, 06, 07, 09, 11, 12, 16, 18 |
| NFR-WT-06 | US-WT-02, 04, 17 |
| NFR-WT-07 | US-WT-10, 13, 14, 17, 18 |
| NFR-WT-08 | US-WT-04, 06, 07, 09, 16 |

## INVEST 검증 요약

| 기준 | 결과 | 근거 |
| --- | --- | --- |
| Independent | Pass | 각 story는 선행 계약 이후 독립 사용자 결과로 인수 가능하며 공통 domain은 별도 story다. |
| Negotiable | Pass | UI layout, adapter 내부 구조, hash·storage 구현은 후속 설계에서 선택 가능하다. |
| Valuable | Pass | 모든 story가 Local Planner 또는 Peer Reviewer의 명시적 목표와 위험을 해결한다. |
| Estimable | Pass | 로컬 저장소·Claude harness·P0/P1·정량 상한으로 범위가 한정된다. |
| Small | Pass | 전체 restore, remote clone, auth, streaming과 추가 harness를 포함하지 않는다. |
| Testable | Pass | 각 story가 Given/When/Then과 FR/NFR/AC trace를 가진다. |

## Deferred P2

- 전체 checkpoint rollback과 file-by-file merge
- 자동 worktree archive/delete lifecycle
- 고급 quota, retention과 자동 만료
- 원격 clone, 추가 AI harness와 복수 workspace root
- 실시간 transcript streaming

## Extension Compliance

| 확장/규칙 | 상태 | User Stories 판정 |
| --- | --- | --- |
| Security Baseline | Disabled | N/A |
| Resiliency Baseline | Disabled | N/A |
| PBT-01 | Advisory/N/A | Partial 모드이며 Functional Design 적용 규칙이다. |
| PBT-02 | N/A | Code Generation에서 parser·serialization round-trip story trace를 사용한다. |
| PBT-03 | N/A | Code Generation에서 manifest/hash invariants를 적용한다. |
| PBT-04 | Advisory/N/A | Partial 모드에서 차단 규칙이 아니다. |
| PBT-05 | Advisory/N/A | Partial 모드에서 차단 규칙이 아니다. |
| PBT-06 | Advisory/N/A | Partial 모드에서 차단 규칙이 아니다. |
| PBT-07 | N/A | Code Generation에서 domain generator 품질을 검증한다. |
| PBT-08 | N/A | Code Generation과 Build and Test에서 shrinking·seed 재현성을 검증한다. |
| PBT-09 | N/A | NFR Requirements에서 framework 선택을 검증한다. |
| PBT-10 | Advisory/N/A | Partial 모드에서 차단 규칙이 아니며 예제 기반 acceptance criteria가 모든 story에 있다. |

User Stories 단계에 직접 적용되는 blocking extension rule은 없으며 발견 사항도 없다.
