# PlanRepo AI-DLC Worktree 통합 요구사항 명세서

- 문서 상태: Draft
- 작성일: 2026-09-09
- 대상 제품: PlanRepo
- 우선 대상 실행기: Claude Code CLI
- 핵심 범위: SR별 Git worktree에서 실제 AI-DLC를 실행하고, 파일 기반 상태·산출물·의사결정을 PlanRepo에서 관리

## 1. 문서 목적

이 문서는 현재 PlanRepo의 격리된 임시 디렉터리·JSON 산출물 기반 계획 생성을 다음 구조로 개선하기 위한 기능 요구사항을 정의한다.

1. 사용자가 실제 개발 Git 저장소를 PlanRepo에 등록한다.
2. PlanRepo가 SR마다 독립된 Git branch와 worktree를 만든다.
3. Claude Code CLI와 AI-DLC를 해당 worktree 루트에서 실행한다.
4. AI-DLC의 파일 기반 상태, 지침, 계획 문서, 질문, 승인 결과를 worktree에 유지한다.
5. PlanRepo가 생성·수정된 파일을 수집하여 메타데이터와 불변 버전 이력을 별도로 보관한다.
6. Git commit을 PlanRepo의 이력 저장 수단으로 사용하지 않고도 문서 비교와 복원이 가능해야 한다.
7. 사용자가 AI-DLC가 제안한 의사결정과 계획 문서를 UI에서 수정한 뒤 다시 실행하거나 승인할 수 있어야 한다.

이 명세에서 “실제 AI-DLC 실행”은 PlanRepo가 자체적으로 고정 단계를 흉내 내는 것이 아니라, 대상 worktree에 설치·구성된 AI-DLC와 프로젝트 지침을 Claude가 직접 읽고 그 프로토콜에 따라 파일을 생성·수정하는 것을 의미한다.

## 2. 배경과 현재 문제

현재 PlanRepo는 SR별 workflow, run, 문서와 이력을 SQLite에 저장하지만 다음 한계가 있다.

- SR과 실제 개발 저장소·branch·worktree의 연결 정보가 없다.
- Claude CLI가 실제 저장소가 아닌 매 실행의 임시 디렉터리에서 동작한다.
- 프로젝트의 `AGENTS.md`, `CLAUDE.md`, AI-DLC 설치 파일과 기존 소스 문맥을 사용하지 않는다.
- Claude의 출력 JSON을 PlanRepo 문서로 저장할 뿐, worktree의 실제 AI-DLC 상태 파일과 산출물을 이어서 사용하지 않는다.
- PlanRepo가 고정한 단계 목록과 상태가 AI-DLC 자체 상태보다 우선한다.
- UI 문서 편집 결과가 실제 개발 worktree의 파일에 반영되지 않는다.
- Git commit 없이 worktree 파일을 시점별로 복원할 수 있는 독립적인 스냅샷 체계가 없다.

따라서 개선 후에는 **worktree의 AI-DLC 상태와 파일을 실행의 기준 원본으로 사용하고, PlanRepo DB·오브젝트 저장소는 검색·메타데이터·감사·버전·복원 계층으로 사용**해야 한다.

## 3. 설계 원칙

### 3.1 원본의 역할 분리

- 현재 작업 내용의 기준 원본은 SR worktree의 파일이다.
- AI-DLC 진행 위치의 기준 원본은 활성 AI-DLC 프로필이 지정한 상태 파일이다.
- PlanRepo DB의 workflow 상태는 상태 파일을 파싱한 투영 값이며 독립적으로 다음 단계를 결정하지 않는다.
- PlanRepo의 버전 스냅샷과 감사 이력은 불변 기록이며, worktree 복원과 장애 복구에 사용한다.

### 3.2 SR 격리

- 하나의 등록 저장소는 여러 SR에 연결될 수 있다.
- 각 SR은 하나의 전용 worktree를 가지며 다른 SR과 작업 파일을 공유하지 않는다.
- 같은 SR의 모든 AI-DLC 실행은 해당 SR worktree를 재사용한다.
- 기본 저장소의 현재 working tree를 SR 실행에 직접 사용하거나 수정해서는 안 된다.

### 3.3 Git과 이력 관리의 분리

- Git은 저장소 식별, 기준 revision 고정, branch와 worktree 격리에 사용한다.
- PlanRepo는 문서·파일 이력을 남기기 위해 `git add`, `git commit`, `git tag`, `git stash`를 실행해서는 안 된다.
- PlanRepo가 제공하는 복원은 Git commit을 생성하거나 `git reset --hard`, `git clean`을 실행하지 않아야 한다.
- Claude/AI-DLC의 Git 쓰기 권한은 실행 정책으로 통제하며 기본값은 commit·push 금지다.

### 3.4 AI-DLC 버전 독립성

- PlanRepo는 고정된 단계 수나 디렉터리 하나만을 전제로 해서는 안 된다.
- AI-DLC 프로필은 상태 파일 탐색 규칙, 관리 대상 경로, 실행 명령, 진행 프롬프트와 승인 프롬프트를 정의할 수 있어야 한다.
- 기존 `aidlc-docs/aidlc-state.md` 구조와 최신 공식 AI-DLC의 intent별 상태 구조를 어댑터로 수용할 수 있어야 한다.

## 4. 용어

| 용어 | 정의 |
| --- | --- |
| 기준 저장소 | 사용자가 PlanRepo에 등록한 실제 Git 저장소 또는 서버가 관리하는 clone |
| 기준 revision | SR worktree를 만들 때 선택한 commit SHA |
| SR worktree | 하나의 SR에만 귀속되어 AI-DLC와 Claude가 실행되는 Git worktree |
| AI-DLC 프로필 | 특정 AI-DLC 버전·harness의 상태 경로, 실행 방식, 관리 대상 파일과 프롬프트 규칙 |
| 관리 대상 파일 | PlanRepo가 수집·버전 관리하는 AI-DLC 상태, 감사, 계획, 지침 및 실행 중 변경 파일 |
| 체크포인트 | 특정 작업 전후의 관리 대상 파일 manifest와 content blob 집합 |
| 문서 버전 | 동일 상대 경로 문서가 생성·편집·AI 실행·복원으로 변경될 때마다 생성되는 불변 기록 |
| drift | PlanRepo 밖에서 worktree 파일이 변경되어 마지막 체크포인트와 달라진 상태 |
| 승인 기준본 | 사용자가 승인할 때의 문서 경로와 content hash 집합 |

## 5. 목표 사용자 흐름

```text
저장소 등록/검증
  → SR 생성 및 저장소·기준 revision 선택
  → SR 전용 branch/worktree 생성
  → AI-DLC 설치 상태 및 프로젝트 지침 검증
  → AI-DLC 시작 또는 이어서 진행
  → Claude가 worktree에서 상태·지침·기존 문서를 읽고 파일 생성/수정
  → PlanRepo가 실행 결과와 파일 변경을 스냅샷·색인
  → 질문 응답 또는 계획 문서 직접 편집
  → 변경된 문서 검토
  → 승인 후 진행
  → 다음 승인 지점까지 반복
  → 필요 시 문서 버전 또는 전체 체크포인트 복원
  → 구현 인계 또는 워크플로우 완료
```

하나의 “다음 단계” 실행이 반드시 한 개의 고정 stage만 처리한다고 가정하지 않는다. AI-DLC가 조건부 단계를 건너뛰거나 여러 내부 작업을 수행한 뒤 질문 또는 승인 지점에서 멈출 수 있으므로, PlanRepo는 실행 후 상태 파일을 다시 읽어 실제 결과를 판단해야 한다.

## 6. 기능 요구사항

### FR-01. 저장소 등록과 검증

1. 사용자는 PlanRepo에서 기준 저장소를 등록할 수 있어야 한다.
2. MVP는 서버가 접근 가능한 로컬 Git 저장소 경로를 지원해야 한다.
3. 원격 URL을 지원하는 경우 PlanRepo가 서버 관리 영역에 clone한 뒤 그 clone을 기준 저장소로 등록해야 하며, 임의 URL을 매 실행마다 직접 사용해서는 안 된다.
4. 등록 시 다음 항목을 저장해야 한다.
   - 저장소 ID와 표시 이름
   - canonical 저장소 경로
   - remote origin 정보가 있으면 그 URL
   - 기본 branch
   - 현재 HEAD와 사용 가능한 기준 revision
   - 선택한 AI-DLC 프로필과 harness
   - 등록·검증 시각 및 검증 상태
5. 등록 전 해당 경로가 실제 Git 저장소인지, 서버 허용 루트 아래인지, worktree 생성이 가능한지 확인해야 한다.
6. 저장소 경로 변경이나 삭제가 기존 SR worktree에 미치는 영향을 사용자에게 보여주고, 실행 중인 SR이 있으면 무효화 또는 삭제를 막아야 한다.

### FR-02. SR과 저장소 연결

1. SR 생성 시 또는 AI-DLC 시작 전에 기준 저장소와 기준 revision을 선택해야 한다.
2. 한 SR에는 동시에 하나의 기준 저장소만 연결할 수 있어야 한다.
3. 첫 AI-DLC 실행 후 저장소를 변경하려면 명시적인 “작업공간 이전” 절차와 검증이 필요하며 단순 필드 변경으로 허용해서는 안 된다.
4. SR 상세에서 저장소, 기준 revision, SR branch, worktree 경로, AI-DLC 프로필, 마지막 동기화 상태를 확인할 수 있어야 한다.
5. SR 입력 원문과 첨부는 최초 AI-DLC 시작 요청에 포함하거나 프로필이 지정한 프로젝트 설명 파일로 안전하게 전달해야 한다.

### FR-03. SR 전용 worktree 생성과 수명주기

1. PlanRepo는 서버 관리 루트 아래에 SR별 고유 디렉터리를 만들고 `git worktree`로 준비해야 한다.
2. worktree 예시는 다음 논리 구조를 따른다. 실제 물리 경로는 설정 가능해야 한다.

   ```text
   <PLANREPO_WORKSPACE_ROOT>/repositories/<repository-id>/srs/<sr-id>/worktree
   ```

3. 기본 branch 이름은 충돌하지 않는 `planrepo/sr/<sr-id>` 형식이어야 하며 사용자가 읽을 수 있는 별칭을 추가로 표시할 수 있다.
4. worktree는 SR 생성 시점에 즉시 만들거나 첫 실행 직전에 지연 생성할 수 있으나, UI에서 상태를 구분해야 한다.
5. 생성 과정은 `provisioning`, `ready`, `failed` 상태를 가져야 하며 부분 생성 실패를 재시도하거나 정리할 수 있어야 한다.
6. 서버 재시작 시 실제 worktree와 DB 연결 정보를 재검증하고 누락·이동·branch 충돌을 감지해야 한다.
7. SR 보관은 worktree 삭제와 분리되어야 한다. worktree 삭제는 영향 파일과 복구 가능 여부를 보여준 후 명시적으로 확인받아야 한다.
8. worktree를 삭제해도 PlanRepo의 불변 체크포인트와 메타데이터를 자동 삭제해서는 안 된다.

### FR-04. AI-DLC 설치 및 프로젝트 지침 인식

1. PlanRepo는 실행 전 선택한 AI-DLC 프로필에 필요한 설치 파일과 명령을 worktree 기준으로 검증해야 한다.
2. `CLAUDE.md`, `AGENTS.md`가 존재하면 둘 다 프로젝트 지침 파일로 색인해야 한다.
3. Claude Code 실행 시 해당 worktree와 프로젝트 설정을 사용해야 하며, 현재 구현처럼 프로젝트 설정·slash command·필요 도구를 무조건 비활성화해서는 안 된다.
4. 기존 `CLAUDE.md`, `AGENTS.md`, `.gitignore`, AI-DLC 설정을 자동으로 덮어써서는 안 된다.
5. AI-DLC가 구성되지 않은 저장소에는 다음 중 관리자가 선택한 정책을 적용해야 한다.
   - 실행 차단 후 설치 안내
   - 사용자의 명시적 확인을 받은 뒤 선택한 harness로 초기화
6. 초기화가 파일을 변경하면 일반 AI 실행과 동일하게 전후 체크포인트와 파일별 변경 이력을 남겨야 한다.
7. 실행 화면에는 감지한 AI-DLC 프로필, 버전, harness, 상태 파일과 활성 지침 파일을 표시해야 한다.

### FR-05. AI-DLC 프로필과 상태 파일 탐색

1. AI-DLC 프로필은 최소한 다음 값을 제공해야 한다.
   - 프로필 ID와 지원 버전 범위
   - 상태 파일 탐색·선택 규칙
   - 산출물 및 감사 파일 경로 규칙
   - 읽기 전용 지침 파일 규칙
   - Claude 실행 방식
   - 최초 시작, 이어서 진행, 승인, 수정 요청 프롬프트
   - 상태 파서와 완료·질문·승인 대기 판정 규칙
2. 기존 구조를 위한 기본 프로필은 `aidlc-docs/aidlc-state.md`를 상태 기준으로 사용해야 한다.
3. 최신 공식 구조를 위한 프로필은 space와 intent 아래의 활성 `aidlc-state.md`를 식별할 수 있어야 한다.
4. 상태 파일 후보가 없거나 둘 이상인데 활성 대상을 결정할 수 없으면 자동 진행하지 말고 사용자에게 해결 방법을 표시해야 한다.
5. 상태 파일이 손상되었거나 산출물과 모순되면 `recovery_required`로 표시하고 다음 실행·승인을 막아야 한다.
6. PlanRepo 칸반 단계와 진행률은 상태 파일 파싱 결과에서 계산해야 하며, 고정된 9단계 배열을 기준 원본으로 사용해서는 안 된다.

### FR-06. 실행 전 점검과 동시성 제어

1. 실행 전 다음 조건을 확인해야 한다.
   - SR과 worktree 연결이 유효함
   - worktree가 지정 branch와 기준 저장소에 연결됨
   - AI-DLC 프로필과 상태 파일이 유효함
   - Claude 실행 파일과 인증이 사용 가능함
   - PlanRepo 밖에서 발생한 drift 처리 여부가 결정됨
2. 한 SR에서는 동시에 하나의 쓰기 실행만 허용해야 한다.
3. 서로 다른 worktree의 SR은 서버 자원 한도 안에서 병렬 실행할 수 있어야 한다.
4. 실행은 고유 `runId`, 사용자 작업 ID, 시작 시 상태 revision, 시작 체크포인트를 가져야 한다.
5. 중복 요청이나 응답 유실 후 재확인은 같은 `runId`를 반환해야 하며 같은 프롬프트를 자동으로 중복 실행해서는 안 된다.

### FR-07. 실제 worktree에서 Claude 실행

1. Claude Code CLI의 `cwd`는 반드시 해당 SR worktree 루트여야 한다.
2. Claude는 worktree의 소스, AI-DLC 설치 파일, 상태 파일, `CLAUDE.md`와 `AGENTS.md`를 읽을 수 있어야 한다.
3. 실행은 선택된 AI-DLC 프로필이 요구하는 slash command, skill, hook와 프로젝트 설정을 사용할 수 있어야 한다.
4. PlanRepo는 실행별로 다음 정보를 보관해야 한다.
   - 실행 명령과 프롬프트 종류
   - 실제 전송한 사용자 메시지
   - Claude session 식별자가 있으면 그 값
   - 시작·종료 시각, 종료 코드, timeout·취소 원인
   - 구조화 가능한 assistant 메시지와 원본 transcript 참조
   - 시작·종료 체크포인트
   - 변경된 파일 목록
5. 로그의 비밀정보와 인증정보는 저장 전에 마스킹해야 한다.
6. timeout·취소·프로세스 장애가 발생해도 실행 중 생성된 파일을 숨기지 말고 `partial` 결과로 수집해야 한다.
7. 실패 후 자동 rollback하거나 자동 재실행해서는 안 된다. 사용자가 변경사항 확인 후 유지, 복원 또는 재실행을 선택해야 한다.
8. 서버 재시작 시 실행 중이던 프로세스를 `interrupted`로 전환하고 worktree 변경사항을 재수집해야 한다.

### FR-08. 다음 단계 진행

1. 상태 파일이 신규 또는 진행 가능한 상태일 때 UI에 `AI-DLC 시작/이어서 진행` 동작을 제공해야 한다.
2. `aidlc-docs` 프로필의 이어서 진행 기본 메시지는 아래 문구와 정확히 같아야 한다.

   ```text
   aidlc-docs/aidlc-state.md를 확인하고, 첫 번째 미완료 항목부터 이어서 진행해주세요.
   ```

3. 다른 프로필은 탐색된 실제 상태 파일 경로를 사용하는 동등한 템플릿 또는 해당 AI-DLC 버전의 native resume 명령을 정의할 수 있어야 한다.
4. PlanRepo는 프롬프트 전송 전 시작 체크포인트를 생성하고, 실행 종료 후 상태 파일과 파일 변경을 다시 수집해야 한다.
5. 다음 화면 상태는 Claude의 말만으로 결정하지 않고 상태 파일, 산출물 존재 여부와 실행 결과를 함께 검증해야 한다.
6. 실행이 질문 또는 승인 대기 상태에 도달하면 자동으로 추가 프롬프트를 보내지 말고 사용자 입력을 기다려야 한다.

### FR-09. 승인 후 진행과 수정 요청

1. 상태 파일이 승인 대기를 나타내는 경우에만 `승인 후 진행` 동작을 활성화해야 한다.
2. 승인 실행 시 Claude에 보내는 사용자 메시지는 아래 문구와 정확히 같아야 한다.

   ```text
   승인 후 진행
   ```

3. 승인에는 승인 기준본의 모든 문서 경로, content hash, 상태 revision, 사용자, 시각을 연결해야 한다.
4. 저장되지 않은 편집이나 미처리 drift가 있으면 승인 동작을 막아야 한다.
5. 승인 대상 문서가 승인 이후 변경되면 기존 승인은 자동으로 무효화되어야 한다.
6. 사용자는 승인 대신 수정 요청을 입력할 수 있어야 하며, PlanRepo는 사용자가 편집한 최종 요청 문구를 Claude에 전달해야 한다.
7. AI가 제시한 원문, 사용자가 편집한 최종 응답, 대상 문서 버전과 후속 실행을 함께 보관해야 한다.
8. peer review 상태와 AI-DLC 자체 승인 gate는 구분해야 한다. 제품 정책상 peer review가 비차단이어도 AI-DLC의 필수 승인 gate를 우회해서는 안 된다.

### FR-10. 질문과 의사결정 편집

1. PlanRepo는 Claude transcript와 AI-DLC 상태·질문 파일에서 사용자 입력이 필요한 질문, 선택지, 권고안과 승인 gate를 수집해야 한다.
2. 사용자는 AI가 제시한 선택지를 그대로 선택하거나 자유 텍스트로 수정할 수 있어야 한다.
3. 전송 전 화면에 “AI 원문”과 “사용자 최종 응답”을 구분해 표시해야 한다.
4. 사용자가 입력한 의사결정은 저장 후 해당 SR의 후속 Claude 실행 문맥과 worktree 산출물에 반영되어야 한다.
5. 변경 전 AI 제안과 변경 후 사용자 결정을 모두 불변 이력으로 남겨야 한다.
6. 사용자가 이미 저장한 응답을 수정하면 새 결정 버전을 만들고 이전 값을 덮어쓰지 않아야 한다.
7. 어떤 질문·문서·stage·run에 대한 결정인지 역추적할 수 있어야 한다.

### FR-11. 파일 수집과 문서 색인

1. 각 실행 전후에 worktree 파일 manifest를 비교하여 생성, 수정, 삭제, 이름 변경 후보를 식별해야 한다.
2. 최소 관리 대상은 다음과 같다.
   - AI-DLC 상태 파일
   - AI-DLC 산출물 디렉터리의 Markdown·JSON·텍스트 파일
   - AI-DLC 감사 파일
   - 루트 또는 프로필 지정 위치의 `AGENTS.md`, `CLAUDE.md`
   - 해당 실행에서 변경된 기타 프로젝트 문서
   - 실행 정책상 허용된 경우 해당 실행에서 변경된 소스·테스트·설정 파일
3. `.git/**`, PlanRepo 내부 스냅샷 저장소, dependency cache와 build output은 관리 대상에서 제외해야 한다.
4. symlink가 worktree 밖을 가리키면 내용을 읽거나 복원 대상으로 포함해서는 안 된다.
5. 각 파일은 worktree 상대 경로를 논리 식별자로 사용하고, content hash와 파일 종류를 기록해야 한다.
6. 동일 경로가 다시 생성·수정되면 새 문서 버전을 만들고 기존 버전을 보존해야 한다.
7. 파일 삭제도 tombstone 버전으로 기록하여 삭제 전 내용을 복원할 수 있어야 한다.
8. 파일 내용은 worktree에 그대로 보존하면서 PlanRepo의 버전 저장소에도 복원 가능한 blob으로 저장해야 한다.
9. 수집 완료 후에만 실행을 최종 성공으로 표시해야 한다.
10. UI 문서 목록은 DB에만 존재하는 가상 문서가 아니라 현재 worktree 경로와 버전 상태를 보여줘야 한다.

### FR-12. 계획 문서 편집

1. 사용자는 PlanRepo UI에서 AI-DLC가 생성한 Markdown 계획 문서를 열람하고 편집할 수 있어야 한다.
2. 상태 파일, 감사 파일과 실행기 지침 파일은 기본적으로 읽기 전용으로 분류하고, 일반 계획 산출물만 편집 가능해야 한다.
3. 저장할 때 마지막으로 읽은 content hash와 현재 worktree hash를 비교하여 충돌을 검사해야 한다.
4. 충돌이 없으면 다음 작업을 하나의 논리적 변경으로 처리해야 한다.
   - 변경 전 체크포인트 생성
   - 임시 파일과 atomic rename 방식으로 worktree 파일 저장
   - 변경 후 문서 버전과 체크포인트 생성
   - 사람 편집 이력 기록
5. 충돌이 있으면 사용자의 초안을 보존하고 현재 파일과 비교 화면을 제공해야 한다.
6. 문서 편집 후 연결된 승인과 downstream 산출물이 stale할 수 있음을 표시해야 한다.
7. 편집된 worktree 파일은 다음 Claude 실행에서 실제 입력으로 읽혀야 한다.
8. Markdown 미리보기, 버전 비교, AI 생성본과 사람 편집본의 origin 표시를 제공해야 한다.

### FR-13. Git commit 없는 체크포인트와 버전 이력

1. 다음 시점마다 체크포인트를 생성해야 한다.
   - SR worktree 생성 직후 baseline
   - Claude 실행 직전과 직후
   - UI 문서 저장 직전과 직후
   - 외부 drift 수용 전과 후
   - 복원 직전과 직후
2. 체크포인트는 최소한 다음 정보를 가져야 한다.
   - 체크포인트 ID, SR, worktree, 생성 원인, actor, 시각
   - 기준 revision과 현재 branch 정보
   - 각 파일의 상대 경로, 상태, content hash, 크기, mode, blob 참조
   - 이전 체크포인트 ID
   - 관련 run, 결정, 승인 또는 복원 ID
3. 동일 content는 hash 기반으로 중복 저장을 줄일 수 있지만 논리적 버전 이력은 각각 유지해야 한다.
4. 체크포인트와 문서 버전은 수정·삭제 불가능한 기록이어야 한다.
5. Git index나 commit graph를 변경하지 않고도 임의 두 체크포인트 또는 문서 버전을 비교할 수 있어야 한다.
6. PlanRepo 밖의 파일 변경은 다음 실행 전에 감지하여 `external_edit` 체크포인트로 가져오거나 사용자가 거부할 수 있어야 한다.
7. 바이너리와 크기 상한을 넘는 파일은 메타데이터만 기록할지, blob까지 저장할지 정책으로 명시하고 UI에 복원 가능 여부를 표시해야 한다.

### FR-14. 복원과 rollback

1. 사용자는 단일 문서를 과거 버전 내용으로 복원할 수 있어야 한다.
2. 단일 문서 복원은 과거 이력을 되감아 삭제하지 않고, 선택한 과거 내용을 현재 worktree의 새 버전으로 기록해야 한다.
3. 사용자는 전체 체크포인트 복원을 요청할 수 있어야 한다.
4. 복원 전에 변경될 파일과 생성·수정·삭제 결과를 diff로 미리 보여줘야 한다.
5. 현재 파일 hash가 마지막으로 인지한 체크포인트와 다르면 강제 덮어쓰지 말고 충돌 처리를 요구해야 한다.
6. 전체 복원은 대상 체크포인트에 포함된 관리 대상 파일만 변경하며 `.git`이나 관리 범위 밖의 파일을 삭제해서는 안 된다.
7. 복원 직전 상태 자체를 새 체크포인트로 보존하여 복원 작업도 다시 되돌릴 수 있어야 한다.
8. AI-DLC의 append-only 감사 파일을 조용히 잘라내거나 과거 내용으로 덮어써서는 안 된다.
9. 상태 rollback이 AI-DLC 감사·runtime graph와 충돌하는 프로필에서는 가능한 경우 AI-DLC native redo/recovery 절차를 사용해야 한다.
10. 일관된 복원이 불가능하면 `recovery_required`로 전환하고 다음 AI-DLC 실행을 막으며 수동 복구 지침을 제공해야 한다.
11. 복원 완료 후 상태 파일을 다시 파싱하고 칸반·진행률·승인 유효성을 재계산해야 한다.

### FR-15. 상태 동기화와 drift 처리

1. SR 상세 진입, 실행 직전, 실행 직후, 편집과 복원 후에 worktree와 DB 투영 상태를 동기화해야 한다.
2. 상태 파일 변경, 문서 변경, worktree 누락, branch 불일치를 서로 다른 drift 유형으로 표시해야 한다.
3. 사용자는 외부 변경을 다음 중 하나로 처리할 수 있어야 한다.
   - 현재 worktree 내용을 새 버전으로 가져오기
   - PlanRepo의 최신 체크포인트 내용으로 복원하기
   - 비교 후 파일별로 결정하기
4. drift가 해결되기 전에는 승인과 다음 단계 실행을 막아야 한다.
5. 동기화가 실패해도 마지막 정상 체크포인트와 원본 오류 정보를 잃지 않아야 한다.

### FR-16. 실행 정책과 Git 쓰기 제한

1. 기본 실행 정책은 Claude와 AI-DLC가 worktree 파일을 읽고 수정할 수 있도록 하되 다음 Git 명령은 차단해야 한다.
   - commit, push, force push
   - reset --hard, clean
   - branch 또는 worktree 삭제
2. status, diff, log, show, rev-parse 등 읽기 전용 Git 작업은 허용할 수 있다.
3. `git add`와 stash 허용 여부는 저장소 정책에서 명시해야 하며 기본값은 금지다.
4. AI-DLC가 금지된 작업을 요청하면 실행을 실패 또는 승인 대기로 전환하고 명령과 차단 사유를 기록해야 한다.
5. 향후 commit 허용 정책을 추가하더라도 PlanRepo 자체 문서 이력은 계속 체크포인트 저장소를 기준으로 해야 한다.

### FR-17. 조회와 UI 상태

1. 보드와 SR 상세는 최소한 다음 상태를 구분해야 한다.
   - 저장소 미연결
   - worktree 준비 중/준비 완료/실패
   - AI-DLC 미설정/복구 필요
   - 실행 중/실행 실패/중단됨
   - 질문 대기/승인 대기/수정 중
   - 다음 단계 진행 가능
   - 워크플로우 완료
2. SR 상세에는 다음 영역을 제공해야 한다.
   - 저장소·worktree·AI-DLC 상태
   - 현재 phase/stage와 다음 작업
   - 실행 transcript와 오류
   - 질문·의사결정 편집
   - worktree 기반 문서 탐색·편집
   - 문서 버전·체크포인트 비교와 복원
   - PlanRepo 이력과 AI-DLC 감사 이력
3. 실행 중에는 상태를 polling 또는 event stream으로 갱신하되 같은 실행을 다시 제출해서는 안 된다.
4. 내부 절대 경로와 민감한 실행 환경 값은 일반 사용자 화면에 불필요하게 노출하지 않아야 한다.

### FR-18. worktree 종료와 구현 인계

1. AI-DLC 상태 파일이 완료 상태를 나타낼 때만 PlanRepo에서 workflow 완료로 표시해야 한다.
2. 제품 정책이 특정 gate에서 구현 인계를 요구하는 경우, AI-DLC 프로필에 stop policy를 두어 그 지점에서 자동 실행을 멈출 수 있어야 한다.
3. 구현 인계 시 현재 파일 manifest, 최신 계획 문서, 승인 기준본, 실행·결정 이력을 묶은 읽기 전용 요약을 제공해야 한다.
4. PlanRepo는 자동 push, PR 생성, main branch merge를 기본 범위에 포함하지 않는다.
5. 외부 구현 완료 표시는 실제 build·merge 검증 결과와 구분되는 수동 선언이어야 한다.

## 7. 핵심 데이터 요구사항

다음은 논리 모델이며 실제 테이블 분할 방식은 설계 단계에서 결정한다.

| 엔터티 | 핵심 데이터 |
| --- | --- |
| Repository | ID, canonical path, origin, default branch, AI-DLC profile, trust 상태 |
| SRWorkspace | SR ID, repository ID, base SHA, branch, worktree path, lifecycle 상태 |
| AIDLCProfile | 상태 locator, 관리 경로, parser, runner, prompt templates, 지원 버전 |
| ExecutionRun | run ID, SR, session, prompt, 상태, 시작/종료 checkpoint, 로그 참조 |
| FileSnapshot | checkpoint, 상대 경로, 변경 종류, hash, blob, 크기, mode |
| ArtifactVersion | SR, 상대 경로, 버전 번호, origin, stage, run, 이전 버전 |
| Interaction | 질문/AI 제안, 사용자 최종 응답, 대상 stage·문서·run |
| Approval | 승인 문구, 사용자, 상태 revision, 승인 기준본 hash 집합 |
| RestoreEvent | 원본/대상 checkpoint, preview, 충돌, 결과 checkpoint |

모든 엔터티는 `srId`와 소속 검증을 통해 다른 SR의 worktree, 실행, 문서, 승인 또는 blob을 참조하지 못하게 해야 한다.

## 8. 비기능 요구사항

### NFR-01. 일관성과 원자성

- 실행 상태와 시작 체크포인트 저장이 완료된 후에만 Claude를 시작해야 한다.
- 실행 후 파일 수집, 문서 버전, 상태 투영과 종료 상태는 가능한 한 하나의 원자적 commit 단위로 기록해야 한다.
- DB 기록 도중 실패하면 worktree 파일을 삭제하지 않고 재수집 가능한 상태로 남겨야 한다.

### NFR-02. 보안

- 저장소와 worktree 경로는 canonicalize한 뒤 허용 루트 경계를 검증해야 한다.
- API가 임의 실행 파일, `cwd`, shell 문자열 또는 서버 절대 경로를 직접 지정하게 해서는 안 된다.
- subprocess는 shell interpolation 없이 인자 배열로 실행해야 한다.
- symlink 탈출, path traversal, `.git` 직접 조작과 다른 SR worktree 접근을 차단해야 한다.
- 저장소의 `CLAUDE.md`, `AGENTS.md`, hook와 실행 파일은 신뢰 경계에 포함되므로 최초 실행 전에 저장소 신뢰를 명시적으로 확인받아야 한다.
- 인증 토큰, 환경 변수, provider credential과 사용자 홈의 민감 파일을 transcript나 snapshot에 저장해서는 안 된다.

### NFR-03. 복구 가능성

- 서버나 Claude 프로세스가 비정상 종료되어도 마지막 정상 체크포인트를 식별할 수 있어야 한다.
- 부분 파일 변경은 손실시키지 않고 별도 체크포인트로 수집해야 한다.
- 저장소 재등록 없이 유효한 worktree를 다시 연결할 수 있는 복구 절차를 제공해야 한다.

### NFR-04. 성능과 용량

- 파일 manifest 비교는 전체 blob 재저장보다 hash와 변경 경로 중심으로 수행해야 한다.
- 저장소별 파일 수, 단일 파일 크기, 체크포인트 총용량, transcript 크기와 보존 기간을 설정할 수 있어야 한다.
- 용량 상한 때문에 일부 파일을 저장하지 못하면 실행을 정상 복원 가능으로 표시해서는 안 된다.

### NFR-05. 관찰 가능성과 감사

- 모든 worktree 생성·검증·실행·질문 응답·승인·편집·수집·복원·삭제 요청에 actor, 시각, SR, 대상과 결과를 기록해야 한다.
- PlanRepo 감사 이력은 AI-DLC 자체 audit 파일과 구분하되 서로의 run·stage·파일 버전을 연결할 수 있어야 한다.
- 실패 로그는 사용자 메시지와 진단 코드를 함께 제공해야 한다.

### NFR-06. 호환성

- MVP 실행 harness는 Claude Code CLI로 한정한다.
- AI-DLC 프로필 인터페이스는 Codex, Kiro 등 다른 harness를 후속 추가할 수 있어야 한다.
- AI-DLC 버전 차이로 상태 경로와 명령이 변경되어도 핵심 SR·문서·체크포인트 데이터 마이그레이션 없이 프로필을 교체할 수 있어야 한다.

## 9. 인수 시나리오

### AC-01. 동일 저장소의 SR 격리

주어진 상황: 하나의 저장소에 SR A와 SR B가 연결되어 있다.  
수행 행동: 두 SR의 worktree를 만들고 각각 다른 계획 문서를 생성한다.  
기대 결과: 서로 다른 branch와 디렉터리가 사용되며 A의 파일·문서·실행 문맥이 B에 나타나지 않는다.

### AC-02. 실제 worktree 실행

주어진 상황: AI-DLC와 `CLAUDE.md` 또는 `AGENTS.md`가 구성된 SR worktree가 있다.  
수행 행동: `AI-DLC 시작/이어서 진행`을 실행한다.  
기대 결과: Claude의 `cwd`가 해당 worktree이고 프로젝트 지침과 상태 파일을 읽어 산출물을 그 worktree에 생성한다.

### AC-03. 다음 미완료 항목 진행

주어진 상황: `aidlc-docs/aidlc-state.md`에 완료·미완료 항목이 함께 있다.  
수행 행동: 이어서 진행 버튼을 누른다.  
기대 결과: 지정된 기본 메시지가 정확히 전송되고 첫 미완료 항목부터 진행한 결과가 상태 파일과 문서에 반영된다.

### AC-04. 승인 후 진행

주어진 상황: 현재 stage가 승인 대기이며 대상 문서에 drift가 없다.  
수행 행동: 사용자가 승인 버튼을 누른다.  
기대 결과: `승인 후 진행`이 정확히 전송되고 승인 기준본 hash와 사용자 결정이 기록되며 AI-DLC가 다음 승인 지점까지 진행한다.

### AC-05. 의사결정 편집

주어진 상황: AI-DLC가 기술 선택지와 권고안을 제시했다.  
수행 행동: 사용자가 권고안을 수정해 최종 응답을 저장하고 전송한다.  
기대 결과: AI 원문과 최종 응답이 모두 보존되고, 후속 실행이 사용자 최종 응답을 사용한다.

### AC-06. 계획 문서 직접 편집

주어진 상황: Claude가 worktree에 계획 Markdown을 생성했다.  
수행 행동: 사용자가 PlanRepo에서 본문을 편집해 저장한다.  
기대 결과: worktree 파일이 변경되고 새 사람 편집 버전과 전후 체크포인트가 생성되며 다음 Claude 실행이 변경 내용을 읽는다.

### AC-07. Git commit 없는 버전 관리

주어진 상황: Claude 실행과 사용자 편집으로 동일 문서가 세 차례 변경되었다.  
수행 행동: 사용자가 이력과 diff를 조회한다.  
기대 결과: 세 버전을 모두 비교할 수 있고 PlanRepo가 Git commit, tag 또는 stash를 생성하지 않았다.

### AC-08. 문서 복원

주어진 상황: 계획 문서 v1, v2, v3가 존재한다.  
수행 행동: 사용자가 v1의 내용을 복원한다.  
기대 결과: v2와 v3 이력이 유지되고 v1 내용의 새 버전 v4가 worktree에 기록된다.

### AC-09. 전체 rollback 충돌 보호

주어진 상황: 마지막 체크포인트 이후 외부 편집이 발생했다.  
수행 행동: 사용자가 이전 체크포인트 전체 복원을 요청한다.  
기대 결과: PlanRepo가 변경 경로와 충돌을 먼저 표시하고 외부 편집을 자동 덮어쓰지 않는다.

### AC-10. 실행 중 서버 장애

주어진 상황: Claude가 문서를 수정한 뒤 서버가 종료되었다.  
수행 행동: 서버를 재시작하고 SR을 연다.  
기대 결과: 실행이 중단됨으로 표시되고 부분 변경 파일이 수집되며 사용자가 유지·복원·재실행을 선택할 수 있다.

### AC-11. 승인 무효화

주어진 상황: 사용자가 문서 묶음을 승인했다.  
수행 행동: 승인된 문서 중 하나를 편집한다.  
기대 결과: 기존 승인이 무효화되고 변경된 기준본에 대한 재검토 전에는 승인 후 진행이 차단된다.

### AC-12. Git 쓰기 차단

주어진 상황: 기본 no-commit 실행 정책이 적용되어 있다.  
수행 행동: Claude 또는 AI-DLC가 commit이나 push를 시도한다.  
기대 결과: 명령이 차단되고 실행 이력에 사유가 기록되며 저장소 commit graph와 remote가 변경되지 않는다.

## 10. 범위 제외

다음 기능은 이 개선의 기본 범위에 포함하지 않는다.

- main branch 자동 merge
- remote push와 Pull Request 자동 생성
- CI/CD 배포 자동화
- 서로 다른 SR worktree의 변경 자동 병합
- PlanRepo UI를 통한 임의 바이너리 파일 편집
- Git commit을 이용한 PlanRepo 문서 이력 저장
- AI-DLC 내부 방법론이나 stage 정의를 PlanRepo 코드에 복제하여 별도로 유지

## 11. 구현 우선순위

### P0 — 실제 AI-DLC 실행 기반

- 저장소 등록과 SR 연결
- SR branch/worktree 생성·복구
- Claude를 worktree `cwd`에서 실행
- `CLAUDE.md`/`AGENTS.md`와 AI-DLC 설치 검증
- 상태 파일 탐색과 동적 진행 상태 표시
- 이어서 진행·승인 후 진행 프롬프트
- 실행 전후 파일 수집과 기본 체크포인트

### P1 — 문서 운영

- worktree 문서 색인·열람·편집
- 질문·의사결정 응답 편집
- 문서 버전 비교
- 승인 기준본과 편집 후 승인 무효화
- 단일 문서 복원

### P2 — 고급 복구와 운영

- 전체 체크포인트 rollback
- 외부 drift 가져오기와 파일별 충돌 해결
- 저장소·worktree 보관/삭제 정책
- blob deduplication, quota와 retention
- 복수 AI-DLC 버전·harness 프로필

## 12. 결정된 정책과 후속 상세화 항목

### 결정된 정책

- SR마다 전용 Git worktree를 사용한다.
- Claude와 AI-DLC는 SR worktree에서 실행한다.
- worktree 파일이 현재 작업 내용의 기준 원본이다.
- PlanRepo는 Git commit 없이 별도 불변 체크포인트로 이력을 관리한다.
- 계획 문서는 PlanRepo에서 편집 가능하며 실제 worktree 파일에 반영한다.
- 승인과 다음 진행은 현재 문서 fingerprint에 묶는다.
- AI-DLC 상태 파일을 기준으로 진행하며 PlanRepo 고정 stage 상태를 우선하지 않는다.
- 기본 정책에서는 commit과 push를 허용하지 않는다.

### 설계 단계에서 상세화할 항목

- 로컬 저장소만 우선 지원할지 원격 clone까지 P0에 포함할지
- PlanRepo blob 저장소의 물리 형식과 암호화·보존 기간
- 대규모 또는 바이너리 소스 변경의 snapshot 상한
- Claude session 재사용 방식과 transcript event 파서
- 공식 최신 AI-DLC 프로필과 기존 `aidlc-docs` 프로필의 정확한 버전 매핑
- AI-DLC append-only audit와 전체 rollback을 조정하는 native recovery 방식

## 13. 참조

- 기존 PlanRepo 요구사항: [`planrepo-requirements.md`](./planrepo-requirements.md)
- AI-DLC 공식 저장소: <https://github.com/awslabs/aidlc-workflows>
- 공식 Quick Start 및 harness 구성: <https://github.com/awslabs/aidlc-workflows/blob/main/README.md>
- 공식 상태·감사 모델: <https://github.com/awslabs/aidlc-workflows/blob/main/docs/guide/10-state-and-audit.md>
- 공식 세션 재개 모델: <https://github.com/awslabs/aidlc-workflows/blob/main/docs/guide/11-session-management.md>

참고 시점의 공식 저장소 `main`은 AI-DLC 2.8.1, commit `c03f9e280be1d545e78e26641a4560677c82443e`였다. 이 버전은 intent별 `aidlc-state.md`와 audit shard 구조를 설명한다. 반면 현재 PlanRepo와 사용자 지정 진행 문구는 `aidlc-docs/aidlc-state.md` 구조를 사용하므로, 구현은 두 구조를 하드코딩으로 섞지 않고 AI-DLC 프로필로 분리해야 한다.
