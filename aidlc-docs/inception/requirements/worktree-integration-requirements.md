# PlanRepo Worktree 통합 요구사항

## 1. 의도 분석

- **사용자 요청**: 실제 개발 Git 저장소를 등록하고 SR별 worktree에서 Claude Code CLI와 AI-DLC를 실행하며, 파일 기반 상태·산출물·결정과 Git commit 없는 이력을 PlanRepo에서 관리한다.
- **요청 유형**: 기존 제품의 시스템 전반 Enhancement
- **범위**: Multiple components / System-wide
- **복잡성**: Complex
- **분석 깊이**: Comprehensive
- **기준 문서**: [Worktree 통합 원문](../../../requirements/planrepo-aidlc-worktree-requirements.md), [기존 PlanRepo 요구사항](../../../requirements/planrepo-requirements.md), [답변 검증](worktree-integration-requirement-answer-validation.md)

## 2. 목표와 성공 조건

PlanRepo는 임시 디렉터리·고정 9단계·SQLite 문서 원본 모델을 SR별 Git worktree와 AI-DLC 상태 파일 원본 모델로 전환한다. 사용자는 하나의 로컬 UI에서 저장소 연결, AI-DLC 실행, 질문과 승인, 계획 문서 편집, 변경 이력과 단일 문서 복원을 수행할 수 있어야 한다.

이번 워크플로의 완료 범위는 원문의 P0와 P1이다. P2의 전체 체크포인트 rollback, 파일별 drift 병합, 고급 삭제·quota·retention, 추가 harness 확장은 후속 범위다.

성공 조건은 다음과 같다.

- Claude가 SR 전용 worktree를 `cwd`로 사용하고 프로젝트 지침과 실제 AI-DLC 상태를 읽는다.
- PlanRepo가 고정 stage 배열이 아니라 profile parser 결과로 현재 단계와 가능한 동작을 표시한다.
- 실행·편집 전후 파일 변경이 Git commit 없이 불변 checkpoint와 artifact version으로 남는다.
- 질문·승인은 상태 revision과 문서 content hash에 묶이며 drift나 미저장 편집이 있으면 차단된다.
- 기존 SR은 사용자가 저장소를 연결할 때 기존 문서를 baseline으로 내보내 안전하게 전환할 수 있다.

## 3. 제품 범위와 사용자

### 3.1 사용자 모델

- 단일 로컬 사용자 제품을 유지하며 로그인과 원격 사용자 관리는 포함하지 않는다.
- 기존 author/reviewer 역할 전환은 피어 리뷰 데모와 actor 구분에 사용한다.
- 저장소 신뢰, AI-DLC 초기화와 파괴 가능 작업 확인은 서버에서 검증하며 클라이언트 표시만으로 권한을 대신하지 않는다.

### 3.2 이번 범위

- 서버가 접근 가능한 로컬 Git 저장소 등록과 검증
- 저장소별 최초 신뢰 확인과 단일 허용 루트 경계
- SR 연결, 기준 SHA·branch와 지연 생성 worktree 수명주기
- 기존 `aidlc-docs`와 공식 intent별 AI-DLC profile adapter
- 실제 worktree에서 Claude Code CLI 실행, 질문·승인·수정 요청
- 실행 전후 checkpoint, content-addressed blob, 파일·문서 버전과 drift 차단
- Worktree 기반 Markdown 문서 탐색·편집·비교·단일 문서 복원
- 기존 SR의 명시적 baseline 전환
- 기존 polling과 operation receipt 기반 진행 상태·중복 방지

### 3.3 범위 제외

- 원격 Git clone, push, Pull Request와 main branch 자동 merge
- 로그인, 다중 사용자 계정과 원격 배포
- 전체 checkpoint 복원과 파일별 drift 병합
- 자동 worktree 삭제, 고급 quota·retention과 자동 만료
- Codex·Kiro 등 Claude Code 이외 harness 구현
- 바이너리 내용 편집과 바이너리 blob 복원
- Server-Sent Events 또는 WebSocket streaming
- 애플리케이션 계층 blob·SQLite 암호화와 TLS loopback 전환

## 4. 원본과 불변성 원칙

| 대상 | 기준 원본 | PlanRepo 역할 |
| --- | --- | --- |
| 현재 작업 파일 | SR worktree 파일 | 안전한 읽기·쓰기, hash·manifest 수집 |
| AI-DLC 진행 상태 | 활성 profile이 선택한 상태 파일 | 파싱한 투영 상태와 가능한 동작 제공 |
| 문서·파일 과거 이력 | 불변 checkpoint와 content-addressed blob | 검색, 비교, 단일 문서 복원 |
| 실행·결정·승인 감사 | PlanRepo 불변 이력과 AI-DLC audit | 서로의 run·stage·파일 버전 연결 |
| Git | 기준 revision, branch, worktree 격리 | PlanRepo 이력용 commit·tag·stash 생성 금지 |

DB workflow 값은 상태 파일을 파싱한 projection이며 독립적으로 다음 단계를 결정하지 않는다. 파일 수집이 끝나기 전에는 실행을 최종 성공으로 표시하지 않는다.

## 5. 기능 요구사항

### FR-WT-01 저장소 등록과 신뢰

1. 사용자는 단일 서버 허용 루트 아래의 로컬 Git 저장소를 등록할 수 있어야 한다.
2. 서버는 입력 경로를 canonicalize하고 실제 Git 저장소, 허용 루트 경계, HEAD, 기본 branch, worktree 가능 여부를 검증해야 한다.
3. Repository는 ID, 표시 이름, canonical path, origin 정보, 기본 branch, HEAD, profile, harness, 검증 상태·시각과 trust 상태를 보관해야 한다.
4. 최초 AI-DLC 실행 전 사용자가 저장소 지침·hook·실행 파일을 신뢰한다는 명시적 확인을 받아야 한다.
5. 실행 중인 SR이나 연결된 worktree에 영향을 주는 저장소 변경·삭제는 차단하고 영향을 표시해야 한다.

### FR-WT-02 SR 연결과 기존 데이터 전환

1. SR 생성 시 또는 첫 AI-DLC 실행 전에 하나의 저장소와 기준 commit SHA를 선택해야 한다.
2. 첫 실행 후 단순 필드 수정으로 저장소를 바꿀 수 없고 별도 이전 절차가 필요하다.
3. 기존 SR은 사용자가 저장소를 연결할 때 기존 최신 문서를 worktree의 profile 지정 경로로 내보내 baseline checkpoint를 만든 뒤 전환해야 한다.
4. 전환 실패 시 기존 SQLite 문서와 legacy 조회 기능을 손상시키지 않아야 한다.
5. SR 상세는 repository, base SHA, branch, worktree 상태, profile과 마지막 sync 결과를 보여줘야 한다.

### FR-WT-03 Worktree 수명주기

1. Worktree는 첫 AI-DLC 실행 직전에 서버 관리 workspace root 아래 지연 생성한다.
2. 기본 branch 이름은 충돌하지 않는 `planrepo/sr/<sr-id>` 형식을 사용한다.
3. 수명주기 상태는 최소 `not_provisioned`, `provisioning`, `ready`, `failed`, `missing`, `conflicted`를 구분해야 한다.
4. 부분 생성 실패는 안전하게 재시도하거나 명시적으로 정리할 수 있어야 한다.
5. 시작 시 실제 worktree, 기준 저장소, branch와 DB 연결을 재검증하고 불일치를 drift로 처리해야 한다.
6. 이번 범위에서는 SR 보관과 자동 worktree 삭제를 구현하지 않으며 기존 checkpoint를 자동 삭제하지 않는다.

### FR-WT-04 AI-DLC Profile과 초기화

1. Profile은 ID, 지원 버전, 상태 locator, 관리 경로, 읽기 전용 지침, parser, runner, prompt template, session policy와 stop policy를 정의해야 한다.
2. 기본 profile은 현재 `aidlc-docs/aidlc-state.md` 구조와 공식 space/intent별 활성 상태 구조를 각각 지원해야 한다.
3. 상태 후보가 없거나 활성 후보를 하나로 결정할 수 없으면 자동 진행하지 않고 해결 지침을 제공해야 한다.
4. 상태와 산출물이 손상·모순되면 `recovery_required`로 표시하고 실행·승인을 차단해야 한다.
5. AI-DLC 미구성 저장소는 변경 미리보기와 사용자 승인을 받은 뒤에만 초기화할 수 있다.
6. 기존 `AGENTS.md`, `CLAUDE.md`, `.gitignore`와 AI-DLC 설정을 자동 덮어쓰지 않아야 한다.

### FR-WT-05 실행 전 점검과 동시성

1. 실행 전 workspace 연결, branch, profile, 상태 파일, Claude 실행 파일·인증, trust와 drift를 검사해야 한다.
2. 한 SR에는 동시에 하나의 쓰기 run만 허용하고 전체 동시 실행은 기본 2개로 제한해야 한다.
3. 기본 timeout은 30분이며 설정으로 더 낮출 수 있어야 한다.
4. Run은 run ID, operation ID, 시작 state revision과 시작 checkpoint를 가져야 한다.
5. 동일 operation ID·fingerprint 재조회는 기존 run을 반환하고 같은 prompt를 중복 실행하지 않아야 한다.

### FR-WT-06 실제 Worktree Claude 실행

1. Claude Code CLI의 `cwd`는 해당 SR worktree root여야 한다.
2. Runner는 shell interpolation 없이 executable과 argument array로 실행해야 한다.
3. Profile 정책이 허용한 source, 상태, `AGENTS.md`, `CLAUDE.md`, slash command, skill, hook와 프로젝트 설정을 사용할 수 있어야 한다.
4. Run은 prompt 종류, 실제 메시지, session ID, 시각, 종료 코드, timeout·취소, redacted transcript 참조, 전후 checkpoint와 변경 파일을 기록해야 한다.
5. Profile이 session 재사용 여부를 결정하며 PlanRepo는 session 식별자와 transcript 연결을 관리해야 한다.
6. timeout·취소·프로세스 실패에도 변경 파일을 `partial` checkpoint로 수집하고 자동 rollback·자동 재실행하지 않아야 한다.
7. 서버 재시작 시 실행 중 run을 `interrupted`로 전환하고 부분 파일을 다시 수집해야 한다.

### FR-WT-07 이어서 진행과 상태 판정

1. 시작 또는 진행 가능한 상태에 `AI-DLC 시작/이어서 진행` 동작을 제공해야 한다.
2. 현재 `aidlc-docs` profile은 이어서 진행 시 원문 FR-08의 정확한 한국어 메시지를 사용해야 한다.
3. 다른 profile은 실제 상태 경로를 넣은 동등한 template 또는 native resume 명령을 정의할 수 있다.
4. 종료 후 Claude 메시지만 신뢰하지 않고 상태 파일, 필수 산출물과 process 결과를 함께 검증해야 한다.
5. 질문 또는 승인 대기 상태가 감지되면 추가 prompt를 자동 전송하지 않아야 한다.

### FR-WT-08 승인과 수정 요청

1. Profile parser가 승인 대기를 판정한 경우에만 승인 동작을 활성화해야 한다.
2. 승인 run에는 정확히 `승인 후 진행` 메시지를 전달해야 한다.
3. 승인은 상태 revision, 승인 문서 경로·content hash 집합, actor와 시각에 묶어야 한다.
4. 미저장 편집이나 drift가 있으면 승인과 진행을 차단해야 한다.
5. 승인 기준 파일이 바뀌면 기존 승인을 무효화하고 재검토를 요구해야 한다.
6. AI 제안 원문, 사용자가 편집한 최종 수정 요청, 대상 버전과 후속 run을 불변 이력으로 보관해야 한다.
7. 비차단 peer review는 AI-DLC 필수 승인 gate를 우회하지 않아야 한다.

### FR-WT-09 질문과 Interaction

1. Transcript와 profile 지정 질문·상태 파일에서 질문, 선택지, 권고와 승인 gate를 수집해야 한다.
2. UI는 AI 원문과 사용자 최종 응답을 구분하고 자유 텍스트 수정을 허용해야 한다.
3. 응답 수정은 새 Interaction version을 만들고 이전 값을 덮어쓰지 않아야 한다.
4. Interaction은 SR, 질문, stage, 문서, run과 후속 run으로 추적 가능해야 한다.
5. 저장된 최종 응답은 profile 규칙에 따라 worktree 파일과 다음 Claude 문맥에 반영되어야 한다.

### FR-WT-10 파일 수집과 색인

1. 실행 전후 manifest를 비교하여 생성·수정·삭제와 이름 변경 후보를 식별해야 한다.
2. 상태·감사·AI-DLC 산출물·지침과 실행 중 변경된 source·test·config를 관리 대상에 포함해야 한다.
3. `.git`, PlanRepo blob 저장소, dependency cache와 build output은 제외해야 한다.
4. Worktree 밖을 가리키는 symlink는 읽거나 복원하지 않아야 한다.
5. 상대 경로, hash, 크기, mode, 종류, origin, run과 blob 참조를 기록해야 한다.
6. 삭제는 tombstone version으로 남겨 삭제 전 내용을 복원할 수 있어야 한다.
7. 바이너리는 메타데이터만 기록하고 checkpoint를 완전 복원 가능으로 표시하지 않아야 한다.
8. 수집 완료 후에만 run을 성공으로 표시해야 한다.

### FR-WT-11 Checkpoint와 Blob

1. Worktree baseline, run 전후, 문서 저장 전후, drift 수용 전후와 문서 복원 전후에 checkpoint를 생성해야 한다.
2. Checkpoint는 ID, SR/worktree, reason, actor, 시각, base SHA, branch, manifest, 이전 checkpoint와 관련 run·interaction·approval·restore를 보관해야 한다.
3. Blob은 애플리케이션 관리 디렉터리의 content-addressed 파일 저장소에 두고 SQLite에는 메타데이터와 참조를 저장해야 한다.
4. 동일 content는 blob을 중복 저장하지 않되 논리 버전 이력은 각각 유지해야 한다.
5. Checkpoint, artifact version과 audit record는 수정·삭제 불가능해야 한다.
6. 자동 만료 없이 SR의 명시적 영구 삭제 전까지 보존해야 한다.
7. 최대 관리 파일 수 20,000개, 텍스트 파일당 10 MiB, checkpoint당 500 MiB를 기본 상한으로 적용해야 한다.
8. 상한 초과 시 원본 파일을 삭제하지 않고 run을 정상 복원 가능 또는 완전 성공으로 표시하지 않아야 한다.

### FR-WT-12 계획 문서 편집

1. Worktree의 일반 Markdown 계획 산출물을 열람·미리보기·편집할 수 있어야 한다.
2. 상태, audit와 runner 지침 파일은 기본 읽기 전용이어야 한다.
3. 저장 시 마지막 read hash와 현재 worktree hash를 비교해야 한다.
4. 충돌이 없으면 저장 전 checkpoint, 임시 파일·atomic rename, artifact version과 저장 후 checkpoint를 하나의 논리 작업으로 기록해야 한다.
5. 충돌 시 사용자 draft를 보존하고 현재 파일과 비교 화면을 제공해야 한다.
6. 편집은 관련 승인과 downstream 산출물을 stale로 표시해야 한다.
7. 다음 Claude 실행은 편집된 worktree 파일을 실제 입력으로 읽어야 한다.

### FR-WT-13 단일 문서 비교와 복원

1. 동일 상대 경로의 문서 버전을 Git commit 없이 비교할 수 있어야 한다.
2. 과거 버전 복원은 기존 이력을 삭제하지 않고 선택한 내용을 새 현재 버전으로 기록해야 한다.
3. 복원 전 현재 hash와 마지막 checkpoint를 비교하고 변경 내용을 미리 보여줘야 한다.
4. 상태 파일, append-only audit와 실행 지침 파일은 일반 문서 복원 대상에서 제외해야 한다.
5. 복원 후 profile parser를 다시 실행해 단계·진행률·승인 유효성을 계산해야 한다.

### FR-WT-14 Drift와 동기화

1. SR 상세 진입, 실행 전후, 편집과 복원 후에 worktree와 DB projection을 동기화해야 한다.
2. 상태 파일 변경, 관리 문서 변경, worktree 누락과 branch 불일치를 별도 drift 유형으로 표시해야 한다.
3. Drift가 있으면 실행·승인을 차단하고 가져오기, PlanRepo 최신 버전 복원 또는 파일별 결정을 제공해야 한다.
4. 이번 범위에서 파일별 자동 병합은 제공하지 않는다.
5. 동기화 실패에도 마지막 정상 checkpoint와 원본 오류를 보존해야 한다.

### FR-WT-15 Git 실행 정책

1. 기본 정책은 `commit`, `push`, force push, `reset --hard`, `clean`, branch/worktree 삭제를 금지해야 한다.
2. `git add`와 `git stash`도 기본 금지하며 저장소별 명시적 정책에서만 허용할 수 있다.
3. `status`, `diff`, `log`, `show`, `rev-parse` 등 필요한 읽기 전용 명령만 allowlist로 허용해야 한다.
4. 금지 명령 시도는 fail closed하고 명령 종류와 차단 사유를 redacted audit에 기록해야 한다.
5. 향후 commit 정책과 무관하게 PlanRepo 파일 이력은 checkpoint를 기준으로 유지해야 한다.

### FR-WT-16 UI와 조회

1. 보드와 SR 상세는 미연결, worktree 준비 상태, AI-DLC 미설정·복구 필요, run 상태, 질문·승인·수정 대기, 진행 가능과 완료를 구분해야 한다.
2. 상세 화면은 저장소/worktree/profile, phase/stage, transcript·오류, interaction, 파일 탐색·편집, 버전·checkpoint, PlanRepo와 AI-DLC audit를 제공해야 한다.
3. 기존 polling으로 상태를 갱신하며 operation receipt로 동일 run 재제출을 막아야 한다.
4. 내부 절대 경로, token, 환경 값과 provider credential을 일반 UI에 노출하지 않아야 한다.

### FR-WT-17 완료와 구현 인계

1. Profile parser가 완료를 판정하고 필수 파일 수집이 끝난 경우에만 workflow 완료로 표시해야 한다.
2. Profile stop policy가 지정한 구현 인계 gate에서 자동 실행을 멈출 수 있어야 한다.
3. 인계는 현재 manifest, 최신 계획, 승인 baseline과 실행·interaction 이력을 읽기 전용 요약으로 제공해야 한다.
4. 수동 구현 완료 표시는 실제 build·merge 검증과 구분해야 한다.
5. 자동 push, PR 생성과 merge는 수행하지 않아야 한다.

## 6. 비기능 요구사항

### NFR-WT-01 일관성과 원자성

- 시작 checkpoint와 run 상태 저장이 끝난 후에만 Claude를 실행한다.
- 파일 수집, artifact version, 상태 projection과 run 종료를 재수집 가능한 원자적 경계로 기록한다.
- DB 실패 시 worktree 파일을 삭제하거나 자동 rollback하지 않는다.
- 기존 expected revision, operation receipt와 immutable history 패턴을 확장한다.

### NFR-WT-02 경로·실행·비밀정보 보안

- 모든 repository/worktree/file 경로는 canonicalize하고 단일 허용 루트와 SR 소속을 검증한다.
- Path traversal, symlink escape, `.git` 직접 수정과 다른 SR 접근을 차단한다.
- API에서 executable, `cwd`, shell 문자열과 임의 환경 변수를 직접 지정할 수 없게 한다.
- Subprocess는 argument array와 최소 환경 allowlist로 실행한다.
- Transcript, error, checkpoint와 audit에서 인증정보·token·민감 환경 값을 저장 전 마스킹한다.
- 등록 저장소의 지침·hook·실행 파일은 명시적 trust 이후에만 활성화한다.
- Security Baseline 확장은 비활성이나 본 NFR은 차단 요구사항이다.

### NFR-WT-03 복구 가능성과 fail-closed

- 중단 run과 부분 파일 변경을 식별하고 별도 checkpoint로 수집한다.
- Worktree·상태·수집 검증 실패는 실행과 승인을 차단한다.
- 실패 후 자동 재실행·자동 복원하지 않고 사용자의 유지·복원·재실행 결정을 요구한다.
- 유효한 worktree를 저장소 재등록 없이 다시 연결할 수 있어야 한다.

### NFR-WT-04 성능과 용량

- 20,000개 관리 파일에서 변경 manifest 계산은 목표 개발 환경에서 5초 이내여야 한다.
- Claude 실행 시간을 제외한 일반 조회·명령 API는 정상 데이터량에서 1초 이내여야 한다.
- Content hash와 변경 경로를 중심으로 비교하고 동일 blob을 중복 저장하지 않는다.
- 상한 초과와 저장 공간 부족은 명확한 오류와 복원 가능성 상태로 표시한다.

### NFR-WT-05 감사와 진단

- Worktree 생성·검증·run·interaction·approval·edit·collect·restore 요청에 actor, 시각, SR, 대상, 결과와 correlation ID를 기록한다.
- PlanRepo audit와 AI-DLC audit를 분리하되 run·stage·파일 버전으로 연결한다.
- 사용자 오류는 안전한 메시지와 진단 코드를 제공하고 내부 절대 경로·stack·credential을 숨긴다.
- 불변 이력은 애플리케이션의 일반 수정 API로 변경·삭제할 수 없어야 한다.

### NFR-WT-06 호환성과 마이그레이션

- Node 24, React, Express, SQLite, Vitest와 Claude Code CLI 기반의 현재 로컬 구조를 유지한다.
- SQLite schema 변경은 additive versioned migration으로 수행하고 기존 SR·문서·리뷰를 보존한다.
- 기존 `aidlc-docs`와 공식 intent별 profile이 동일 핵심 데이터 모델을 사용해야 한다.
- Profile 교체가 SR/checkpoint/artifact 데이터 migration을 요구하지 않아야 한다.

### NFR-WT-07 사용성과 접근성

- 긴 run은 polling 상태, 시작 시각, 현재 작업, 취소·실패와 복구 동작을 명확히 표시한다.
- Drift, stale approval, 미저장 draft와 destructive action은 서로 구분되는 상태와 확인 절차를 제공한다.
- 기존 keyboard focus, 390 px viewport, draft 보호와 오류 상태 기준을 회귀 검증한다.

### NFR-WT-08 테스트 가능성과 Partial PBT

- Git, filesystem, profile parser, runner, clock과 blob store는 port/adapter 경계로 격리한다.
- 단위 테스트는 임시 저장소와 fake Claude runner를 사용하며 실제 사용자 저장소를 수정하지 않는다.
- 통합 테스트는 worktree 격리, 재시작 복구, drift·승인 충돌과 실제 Git 명령 차단을 검증한다.
- `fast-check` 또는 동등한 Vitest 호환 framework를 NFR Design에서 결정한다.
- Partial PBT는 parse/format·serialize/deserialize round-trip, manifest/hash invariant와 도메인 generator에 적용한다.
- Shrinking을 유지하고 실패 seed를 출력해 재현 가능하게 한다.
- PBT는 핵심 예제 기반 회귀 테스트를 대체하지 않는다.

## 7. 인수 기준

| ID | 시나리오 | 기대 결과 |
| --- | --- | --- |
| AC-WT-01 | 같은 저장소에 SR A·B를 연결하고 각각 실행 | 서로 다른 branch/worktree/checkpoint를 사용하며 파일·문맥이 섞이지 않는다. |
| AC-WT-02 | 지침과 AI-DLC가 구성된 SR을 시작 | Claude `cwd`가 SR worktree이고 실제 상태·지침·소스를 읽어 파일을 변경한다. |
| AC-WT-03 | 완료·미완료가 섞인 `aidlc-docs` 상태에서 이어서 진행 | 정확한 기본 메시지를 보내고 첫 미완료 항목 결과를 다시 파싱한다. |
| AC-WT-04 | 승인 대기이며 drift가 없는 문서를 승인 | 정확한 승인 메시지와 baseline hash를 기록하고 다음 gate까지 진행한다. |
| AC-WT-05 | AI 제안을 사용자가 수정해 전송 | AI 원문, 최종 응답, 대상과 후속 run이 모두 연결된다. |
| AC-WT-06 | Worktree Markdown을 UI에서 편집 | Atomic file save, 전후 checkpoint, human-edit version과 승인 무효화가 발생한다. |
| AC-WT-07 | 동일 파일이 세 번 변경됨 | Git commit 없이 세 artifact version을 비교할 수 있다. |
| AC-WT-08 | 과거 문서 내용을 복원 | 과거 이력을 유지하고 선택 내용을 새 최신 버전으로 기록한다. |
| AC-WT-09 | 마지막 checkpoint 후 외부 수정 | 실행·승인을 차단하고 외부 변경을 자동 덮어쓰지 않는다. |
| AC-WT-10 | Claude 파일 변경 후 서버 중단 | Run은 interrupted, 변경은 partial checkpoint가 되며 사용자 복구 선택을 제공한다. |
| AC-WT-11 | 승인된 파일을 편집 | 기존 승인이 무효화되고 새 baseline 승인 전 진행을 차단한다. |
| AC-WT-12 | Claude가 금지 Git 명령 시도 | 명령을 차단하고 audit에 사유를 남기며 commit graph·remote는 변하지 않는다. |
| AC-WT-13 | 상태 파일 후보가 없거나 모호함 | Recovery 안내를 표시하고 자동 실행하지 않는다. |
| AC-WT-14 | 기존 SR에 저장소 연결 | 기존 문서를 baseline 파일·checkpoint로 내보내고 실패 시 원본 DB 이력을 보존한다. |
| AC-WT-15 | 20,000개 관리 파일 manifest 측정 | 목표 환경에서 5초 이내 완료하거나 성능 실패를 명시적으로 보고한다. |
| AC-WT-16 | Parser·manifest PBT 실패 | Shrunk input과 seed가 남아 동일 실패를 재현할 수 있다. |

## 8. 데이터 요구사항

| 엔터티 | 필수 내용 |
| --- | --- |
| Repository | canonical path, origin, default branch, HEAD, profile, harness, validation, trust |
| SRWorkspace | SR, repository, base SHA, branch, path, lifecycle, last sync |
| AIDLCProfile | locator, managed/read-only paths, parser, runner, prompts, session·stop policy |
| ExecutionRun | operation/run/session, prompt, revision, status, timing, error, transcript, checkpoints |
| Checkpoint | reason, actor, base SHA, branch, manifest, predecessor와 관련 이벤트 |
| FileSnapshot | relative path, change, hash, blob, size, mode, file kind, restorability |
| ArtifactVersion | relative path, version, origin, stage, run, prior version, tombstone |
| Interaction | AI 원문, 최종 응답, 질문·stage·문서·run 관계와 version |
| Approval | actor, state revision, baseline path/hash set, validity, downstream run |
| RestoreEvent | source version, preview, conflict, result version/checkpoint |

모든 엔터티는 `srId`와 repository/workspace 소속을 검증하여 다른 SR의 file, run, approval, interaction 또는 blob을 참조하지 못하게 해야 한다.

## 9. 추적성

| 원문 | 정규화 요구사항 | 우선순위 |
| --- | --- | --- |
| FR-01, FR-02 | FR-WT-01, FR-WT-02 | P0 |
| FR-03 | FR-WT-03 | P0 |
| FR-04, FR-05 | FR-WT-04 | P0 |
| FR-06, FR-07 | FR-WT-05, FR-WT-06 | P0 |
| FR-08, FR-09 | FR-WT-07, FR-WT-08 | P0/P1 |
| FR-10 | FR-WT-09 | P1 |
| FR-11, FR-13 | FR-WT-10, FR-WT-11 | P0/P1 |
| FR-12 | FR-WT-12 | P1 |
| FR-14 | FR-WT-13; 전체 checkpoint rollback은 후속 | P1/P2 |
| FR-15 | FR-WT-14; 파일별 병합은 후속 | P0/P2 |
| FR-16 | FR-WT-15 | P0 |
| FR-17 | FR-WT-16 | P0/P1 |
| FR-18 | FR-WT-17 | P1 |
| NFR-01..06 | NFR-WT-01..08 | P0/P1 |

## 10. Extension Compliance

| 확장 | 상태 | Requirements Analysis 판정 |
| --- | --- | --- |
| Security Baseline | Disabled | N/A. 확장 규칙은 비활성이나 원문 제품 보안 요구사항은 NFR-WT-02로 유지한다. |
| Resiliency Baseline | Disabled | N/A. 확장 규칙은 비활성이며 명시된 중단 복구·checkpoint 요구사항만 적용한다. |
| Property-Based Testing | Partial | Compliant. PBT-02, PBT-03, PBT-07, PBT-08, PBT-09를 NFR-WT-08과 AC-WT-16에 반영했다. 실제 framework·generator·seed 검증은 NFR Design, Code Generation과 Build and Test에서 차단 조건으로 확인한다. |

### PBT 규칙별 Requirements Analysis 판정

| 규칙 | 상태 | 근거 |
| --- | --- | --- |
| PBT-01 | N/A | Partial 모드에서 advisory이며 Functional Design에서 property 식별을 평가한다. |
| PBT-02 | N/A | Round-trip test 구현은 Code Generation에서 적용하며 NFR-WT-08에 선행 요구를 기록했다. |
| PBT-03 | N/A | Manifest/hash invariant test 구현은 Code Generation에서 적용하며 NFR-WT-08에 선행 요구를 기록했다. |
| PBT-04 | N/A | Partial 모드에서 advisory다. |
| PBT-05 | N/A | Partial 모드에서 advisory다. |
| PBT-06 | N/A | Partial 모드에서 advisory다. |
| PBT-07 | N/A | Domain generator 검증은 Code Generation에서 적용하며 NFR-WT-08에 선행 요구를 기록했다. |
| PBT-08 | N/A | Shrinking·seed·CI 검증은 Code Generation과 Build and Test에서 적용하며 NFR-WT-08과 AC-WT-16에 선행 요구를 기록했다. |
| PBT-09 | N/A | Framework 선택은 NFR Requirements에서 차단 조건으로 적용하며 Vitest 호환 후보 요구를 기록했다. |
| PBT-10 | N/A | Partial 모드에서 advisory이며 예제 기반 테스트 병행 요구는 NFR-WT-08에 반영했다. |

현재 Requirements Analysis 산출물에는 blocking extension finding이 없다.
