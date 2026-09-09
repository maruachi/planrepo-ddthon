# PlanRepo Worktree 통합 요구사항 확인 질문

원문: [planrepo-aidlc-worktree-requirements.md](../../../requirements/planrepo-aidlc-worktree-requirements.md)

각 질문의 `[Answer]:` 뒤에 선택 문자를 입력해 주세요. 필요한 설명을 함께 적을 수 있습니다. 맞는 선택지가 없으면 마지막 `Other`를 선택하고 원하는 동작을 적어 주세요.

## Question 1
이번 AI-DLC 워크플로에서 구현 완료 대상으로 삼을 우선순위 범위는 무엇입니까?

A) P0만 구현하고 P1·P2는 후속 워크플로로 이관

B) P0와 P1을 구현하고 P2는 후속 워크플로로 이관

C) P0, P1, P2를 모두 구현

X) Other (please describe after `[Answer]:` tag below)

[Answer]: B — 핵심 실행 기반과 문서 운영까지 완결하고 고급 복구·운영은 후속 범위로 분리

## Question 2
이번 범위에서 기준 저장소 입력 방식은 어디까지 지원해야 합니까?

A) 서버가 접근 가능한 로컬 Git 저장소 경로만 지원

B) 로컬 경로와 서버 관리 영역으로의 HTTPS 원격 clone 지원

C) 로컬 경로와 HTTPS·SSH 원격 clone 모두 지원

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — 로컬 단일 사용자 MVP와 현재 배포 경계에 맞춰 로컬 Git 저장소만 지원

## Question 3
SR 전용 worktree는 언제 생성해야 합니까?

A) SR 생성 시 즉시 생성하고 실패 상태를 SR에 표시

B) 첫 AI-DLC 실행 직전에 지연 생성

C) SR별로 즉시 생성 또는 지연 생성을 사용자가 선택

X) Other (please describe after `[Answer]:` tag below)

[Answer]: B — 사용하지 않는 SR의 worktree 생성을 피하고 첫 실행 점검과 함께 원자적으로 준비

## Question 4
MVP에서 반드시 동작해야 하는 AI-DLC 프로필 조합은 무엇입니까?

A) 현재 프로젝트의 `aidlc-docs/aidlc-state.md` 구조만 지원

B) 현재 `aidlc-docs` 구조와 공식 intent별 상태 구조를 모두 기본 프로필로 지원

C) 프로필 인터페이스와 현재 `aidlc-docs` 기본 프로필만 구현하고 공식 intent별 프로필은 후속 추가

X) Other (please describe after `[Answer]:` tag below)

[Answer]: B — 기존 프로젝트와 공식 intent별 구조를 profile adapter로 분리해 모두 지원

## Question 5
등록 저장소에 선택한 AI-DLC가 구성되어 있지 않을 때 기본 정책은 무엇입니까?

A) 실행을 차단하고 설치 안내만 제공

B) 변경 미리보기를 보여준 뒤 사용자가 명시적으로 승인하면 초기화

C) 신뢰 확인된 저장소는 선택 프로필로 자동 초기화하고 이력을 남김

X) Other (please describe after `[Answer]:` tag below)

[Answer]: B — 프로젝트 파일 변경 전 미리보기와 명시적 승인을 요구

## Question 6
이번 개선에서도 사용자·관리자·actor 모델을 기존 로컬 데모 수준으로 유지합니까?

A) 단일 로컬 사용자와 author/reviewer 역할 전환을 유지하고 로그인은 제외

B) 로컬 다중 사용자 로그인과 관리자 권한을 추가

C) 인증은 제외하지만 고정 actor 프로필 여러 개와 관리자 설정 화면을 추가

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — 기존 단일 로컬 사용자와 데모 역할 전환을 유지하고 인증은 범위 제외

## Question 7
저장소 경로 신뢰와 허용 루트 정책은 어떻게 구성해야 합니까?

A) 서버 설정의 단일 허용 루트 아래 경로만 등록하고 저장소마다 최초 실행 전 명시적 신뢰 확인

B) 서버 설정의 복수 허용 루트를 지원하고 저장소마다 최초 실행 전 명시적 신뢰 확인

C) 임의 로컬 경로를 등록할 수 있지만 매 등록과 최초 실행 때 위험을 확인

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — 단일 허용 루트와 저장소별 최초 신뢰 확인으로 경계를 단순하고 명확하게 유지

## Question 8
Claude 실행에서 변경된 소스·테스트·설정 파일을 기본 체크포인트 관리 대상으로 포함합니까?

A) AI-DLC 상태·감사·계획 문서와 지침 파일만 blob으로 보관하고 기타 소스는 메타데이터만 기록

B) 실행에서 변경된 소스·테스트·설정 파일도 허용된 크기 내에서 blob과 버전 이력에 포함

C) 저장소별 include/exclude 패턴으로 관리 대상을 정하고 기본값은 AI-DLC 문서만 포함

X) Other (please describe after `[Answer]:` tag below)

[Answer]: B — 실제 AI-DLC 실행으로 변경된 소스·테스트·설정도 크기 제한 안에서 복원 가능하게 보관

## Question 9
파일·체크포인트 용량의 초기 기본값은 무엇으로 합니까?

A) 최대 20,000개 파일, 텍스트 파일당 10 MiB, 바이너리는 메타데이터만, 체크포인트당 500 MiB

B) 최대 100,000개 파일, 파일당 50 MiB, 바이너리 blob 포함, 체크포인트당 5 GiB

C) 구현 시 구성 가능한 상한만 제공하고 제품 기본값은 두지 않음

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — 로컬 MVP에 맞는 보수적 기본 상한을 적용하고 바이너리는 메타데이터만 기록

## Question 10
복원 가능한 blob의 물리 저장 방식과 암호화 범위는 무엇입니까?

A) 앱 관리 디렉터리의 content-addressed 파일 저장소와 SQLite 메타데이터를 사용하고 애플리케이션 계층 암호화는 제외

B) content-addressed 파일 저장소를 사용하고 blob을 애플리케이션 키로 암호화

C) blob 자체도 SQLite에 저장

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — content-addressed 파일 저장소와 SQLite 메타데이터를 사용하고 로컬 MVP의 별도 키 관리는 제외

## Question 11
체크포인트·transcript·blob의 보존 정책은 무엇입니까?

A) 사용자가 SR을 명시적으로 영구 삭제하기 전까지 모두 보존

B) 체크포인트와 승인 이력은 보존하고 원본 transcript만 30일 후 삭제

C) 저장소별 용량 quota와 보존 기간을 설정하며 만료 전 복원 가능성 경고를 제공

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — 자동 만료 없이 명시적 영구 삭제 전까지 복원·감사 자료를 보존

## Question 12
외부 drift가 발견됐을 때 기본 동작은 무엇입니까?

A) 항상 실행·승인을 차단하고 사용자가 가져오기·복원·파일별 결정을 선택

B) 허용된 관리 대상 텍스트 변경은 자동으로 `external_edit` 체크포인트에 가져오고 위험 변경만 차단

C) PlanRepo 최신 체크포인트로 자동 복원하고 충돌이 있을 때만 사용자에게 표시

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — 외부 변경을 자동 수용하거나 덮어쓰지 않고 실행·승인 전에 사용자가 결정

## Question 13
이번 구현에서 복원 기능은 어디까지 완료해야 합니까?

A) 단일 문서 복원만 구현하고 전체 체크포인트 복원은 후속 범위

B) 전체 체크포인트 미리보기와 충돌 없는 복원까지 구현하고 파일별 충돌 해결은 후속 범위

C) 단일 문서, 전체 체크포인트, 파일별 충돌 해결까지 모두 구현

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — P1의 단일 문서 복원까지 구현하고 전체 체크포인트 복원은 P2로 이관

## Question 14
Claude session과 transcript는 어떤 방식으로 이어가야 합니까?

A) 매 실행은 새 session으로 시작하고 파일 상태만 문맥으로 사용

B) 같은 SR에서는 Claude session을 재사용하되 실패 시 새 session으로 전환 가능

C) AI-DLC 프로필이 session 재사용 여부를 결정하고 PlanRepo는 session ID와 transcript 참조만 관리

X) Other (please describe after `[Answer]:` tag below)

[Answer]: C — session 정책은 AI-DLC profile이 결정하고 PlanRepo는 식별자와 transcript 참조를 관리

## Question 15
동시 실행 수와 기본 timeout은 어떻게 제한합니까?

A) SR당 1개, 전체 2개, 실행당 30분

B) SR당 1개, 전체 4개, 실행당 60분

C) SR당 1개만 강제하고 전체 동시 실행 수와 timeout은 서버 설정 필수값으로 둠

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — SR당 1개, 전체 2개, 30분 기본값으로 로컬 자원 사용을 제한

## Question 16
기본 Git 쓰기 정책에서 `git add`와 `git stash`는 어떻게 처리합니까?

A) 둘 다 금지

B) `git add`는 허용하고 `git stash`는 금지

C) 둘 다 저장소별 명시적 정책으로만 허용하며 기본값은 금지

X) Other (please describe after `[Answer]:` tag below)

[Answer]: C — 기본은 둘 다 금지하고 신뢰된 저장소의 명시적 정책에서만 선택적으로 허용

## Question 17
기존 PlanRepo SR과 SQLite 문서 이력은 새 worktree 모델로 어떻게 전환합니까?

A) 기존 SR은 legacy 읽기·검토 모드로 유지하고 새 SR부터 worktree를 필수화

B) 기존 SR도 저장소를 연결하면 기존 문서를 worktree baseline으로 내보내 전환

C) 애플리케이션 시작 시 모든 기존 SR을 자동 마이그레이션

X) Other (please describe after `[Answer]:` tag below)

[Answer]: B — 기존 이력을 보존하면서 사용자가 저장소를 연결할 때 baseline으로 내보내 명시적으로 전환

## Question 18
실행 상태 갱신 방식의 MVP 기준은 무엇입니까?

A) 기존 polling을 유지하되 동일 run 중복 제출 방지를 강화

B) Server-Sent Events로 run·수집 상태를 전달하고 polling을 fallback으로 유지

C) WebSocket 기반 양방향 상태·transcript 스트리밍을 구현

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — 검증된 polling과 operation receipt를 유지하고 중복 실행 방지를 강화

## Question 19
정량 성능 인수 기준은 어느 수준으로 설정합니까?

A) 20,000개 관리 파일에서 변경 manifest 계산 5초 이내, 일반 API 응답 1초 이내

B) 100,000개 관리 파일에서 변경 manifest 계산 15초 이내, 일반 API 응답 2초 이내

C) 이번 로컬 MVP에는 정량 SLA를 두지 않고 계측과 회귀 테스트만 요구

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — 20,000개 파일 기준 manifest 5초, 일반 API 1초의 로컬 인수 기준 적용

## Question 20
이번 개선에 Security Baseline 확장 규칙을 적용합니까?

A) Yes — 모든 Security 규칙을 차단 조건으로 적용 (production-grade 애플리케이션에 권장)

B) No — Security 확장 규칙을 적용하지 않음 (PoC, prototype, experimental project에 적합)

X) Other (please describe after `[Answer]:` tag below)

[Answer]: B — 로컬 loopback MVP에 managed-key 암호화, TLS/HSTS, 전면 인증, 중앙 로그·알림을 강제하는 확장은 제외하고 원문 NFR의 경로·subprocess·비밀정보 보호는 필수 적용

## Question 21
이번 개선에 Resiliency Baseline 확장 규칙을 적용합니까?

이 확장은 AWS Well-Architected Reliability Pillar 기반의 방향성 있는 설계 지침이며 production readiness나 가용성·RTO·RPO를 보증하지 않습니다.

A) Yes — 복원력 baseline을 설계 시점의 방향성 지침과 차단 조건으로 적용

B) No — 빠른 실험을 위해 Resiliency 확장 규칙을 적용하지 않음

X) Other (please describe after `[Answer]:` tag below)

[Answer]: B — 단일 로컬 MVP에는 확장 전체를 적용하지 않고 명시된 checkpoint·중단 복구 요구사항만 준수

## Question 22
이번 개선에 Property-Based Testing 확장 규칙을 적용합니까?

A) Yes — 비즈니스 로직, 데이터 변환, 직렬화와 상태 컴포넌트에 모든 PBT 규칙 적용

B) Partial — 순수 함수와 직렬화 round-trip에만 PBT 규칙 적용

C) No — PBT 확장 규칙을 적용하지 않음

X) Other (please describe after `[Answer]:` tag below)

[Answer]: B — 상태 parser, manifest/hash 및 직렬화 round-trip 같은 순수 경계에 부분 적용
