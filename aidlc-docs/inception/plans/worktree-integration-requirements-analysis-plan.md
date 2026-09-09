# Worktree 통합 요구사항 분석 계획

- [x] 기존 `aidlc-state.md`와 감사 로그를 읽고 세션 재개 지점 확인
- [x] 공통 프로세스·세션 연속성·내용 검증·질문 형식 규칙 로드
- [x] Reverse Engineering 승인 대기 상태를 사용자의 계속 진행 지시로 승인 처리
- [x] Reverse Engineering 필수 산출물과 원본·후속 요구사항 문서 로드
- [x] 확장 디렉터리와 세 가지 opt-in 문서 확인
- [x] 요청 의도·범위·복잡성 및 요구사항 깊이 평가
- [x] 기능·비기능·사용자 시나리오·비즈니스·기술·품질 완전성 분석
- [x] Worktree 통합 확인 질문 및 확장 opt-in 질문 작성
- [x] 모든 `[Answer]:` 응답 수신 및 형식 검증: 사용자 요청에 따라 권장안 22개 기록
- [x] 응답의 누락·모순·모호성 분석: 누락 없음, P0+P1/단일 문서 복원/P2 이관 등 범위 일치 확인
- [x] 확장 활성화 결정을 현재 개선 워크플로 기준으로 상태 파일에 기록: Security No, Resiliency No, PBT Partial
- [x] 승인된 답변을 반영한 Worktree 통합 요구사항 문서 작성
- [x] 요구사항 추적성·Markdown·링크·구문 검증
- [x] 요구사항 검토 질문과 승인 게이트 작성
- [x] 사용자 명시적 승인 기록: Q1 B, “권장안 대로 진행”

## 초기 분석

- **요청 유형**: 기존 제품의 시스템 전반 Enhancement
- **범위**: 저장소·worktree 수명주기, AI-DLC 프로필과 상태 파서, Claude 실행, 파일·체크포인트·blob, drift·복원, API·UI·SQLite 마이그레이션을 포함하는 System-wide 변경
- **복잡성**: Complex
- **요구사항 깊이**: Comprehensive
- **근거**: 18개 기능 요구사항과 6개 비기능 요구사항이 여러 신뢰 경계, 외부 프로세스, Git·파일시스템·DB 간 일관성, 장애 복구와 기존 데이터 호환성에 걸쳐 있다.

## 불러온 이전 단계 문맥

- 현재 앱은 React/Express/SQLite 단일 로컬 프로세스이며 고정된 9단계 planning policy를 사용한다.
- Claude runner는 임시 디렉터리에서 실행되고 프로젝트 설정·도구·hook·slash command·session을 비활성화한다.
- 문서 본문과 workflow 상태는 SQLite가 기준 원본이며, repository/worktree/profile/state parser/checkpoint/blob/drift/restore 도메인은 없다.
- 재사용 가능한 기반은 ports/adapters, 원자적 `ChangeSet`, 불변 이력, optimistic concurrency, operation receipt와 subprocess argument-array 실행이다.
- 기존 23개 테스트 파일·86개 테스트 통과 기록은 있으나 이 checkout에는 의존성이 없어 Reverse Engineering 시점의 재검증은 시작되지 못했다.

## 완전성 분석

| 영역 | 명확한 내용 | 확인이 필요한 내용 |
| --- | --- | --- |
| 기능 | SR별 worktree, 실제 AI-DLC 실행, 상태 파일 기반 진행, 체크포인트·문서 편집·복원 | 이번 구현 우선순위, 원격 clone, 생성 시점, 프로필·초기화 범위 |
| 비기능 | 경로 경계, shell 없는 subprocess, 원자성, 복구, 감사, harness 확장성 | 용량·보존·암호화, 동시 실행·timeout, 성능 수치 |
| 사용자 시나리오 | 등록부터 승인·수정·복원·인계까지 주요 흐름과 12개 인수 시나리오 | 기존 SR 전환, actor·관리자 의미, drift 기본 동작 |
| 비즈니스 | 실제 저장소 문맥에서 AI-DLC를 이어가고 Git commit 없이 이력을 보존 | P0/P1/P2 중 이번 워크플로의 완료 기준 |
| 기술 | Node/React/Express/SQLite/Claude CLI 유지, 파일 상태가 기준 원본 | blob 물리 저장, 공식/기존 프로필 조합, session과 UI 갱신 방식 |
| 품질 | symlink·path traversal·Git 쓰기 제한, 부분 결과 보존 | 정량 성능·용량, 확장 규칙 활성화, 테스트 전략 범위 |

## 확장 상태

이번 개선에서는 Security Baseline과 Resiliency Baseline을 비활성화하고 Property-Based Testing을 Partial 모드로 활성화한다. Security Baseline은 권장안 평가 중 전체 규칙을 대조했으나 managed-key 암호화, TLS/HSTS, 전면 인증과 중앙 로그·알림이 현재 로컬 MVP 범위를 크게 확장하여 최종 권장안에서 제외했다. 원문 NFR의 경로·subprocess·비밀정보 보호는 확장 비활성과 무관하게 필수다. PBT-02, PBT-03, PBT-07, PBT-08, PBT-09는 이후 적용 가능한 설계·구현·검증 단계에서 차단 조건으로 적용한다.
