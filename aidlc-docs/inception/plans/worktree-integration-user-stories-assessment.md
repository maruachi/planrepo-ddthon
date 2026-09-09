# Worktree 통합 User Stories 실행 평가

## 요청 분석

- **원본 요청**: 실제 Git 저장소를 연결하고 SR별 worktree에서 AI-DLC를 실행하며 파일·질문·승인·checkpoint를 UI에서 관리하는 PlanRepo 개선
- **사용자 영향**: Direct. 저장소 등록, AI-DLC 시작·진행, 질문 응답, 승인, 편집, drift 처리와 복원이 모두 신규 또는 변경된 사용자 흐름이다.
- **복잡성**: Complex. Git, filesystem, subprocess, SQLite와 UI 상태가 여러 실패·충돌 시나리오에서 일관되어야 한다.
- **이해관계자**: SR 작성자·저장소 운영자 역할의 로컬 사용자, peer reviewer, 구현·검증 담당 개발자

## 충족한 평가 기준

- [x] High Priority — 사용자가 직접 조작하는 저장소·worktree·AI-DLC·문서 UI 기능 추가
- [x] High Priority — 기존 고정 planning UI를 상태 파일 기반 흐름으로 변경
- [x] High Priority — drift, approval baseline, checkpoint와 복원에 복합 business rule 존재
- [x] Medium Priority — Git·Claude CLI·filesystem·SQLite 통합이 사용자 결과에 직접 영향
- [x] Medium Priority — 기존 SR migration과 문서·review 회귀 검증 필요
- [x] Benefits — 요구사항을 독립적인 사용자 가치와 testable acceptance criteria로 분해 가능

## 결정

**Execute User Stories**: Yes

사용자 여정과 상태 전이가 크고 실패·복구 행동의 기대 결과가 중요하므로 User Stories가 구현 범위, 인수 테스트와 팀 공통 이해를 구체화하는 데 명확한 가치가 있다. 단순 refactoring, isolated bug fix, infrastructure-only 또는 documentation-only 조건에 해당하지 않는다.

## 기대 결과

- 저장소 등록부터 구현 인계까지 end-to-end 흐름을 작은 수직 story로 분리한다.
- 정상·충돌·중단·복구 시나리오를 actor 관점의 acceptance criteria로 고정한다.
- P0/P1 범위와 P2 제외 항목이 story backlog에 섞이지 않도록 추적한다.
- FR-WT, NFR-WT와 AC-WT를 story 단위로 역추적할 수 있게 한다.

## Extension 적용성

- **Security Baseline**: Disabled, N/A.
- **Resiliency Baseline**: Disabled, N/A.
- **PBT Partial**: User Stories 단계에는 PBT-02, PBT-03, PBT-07, PBT-08, PBT-09의 직접 검증 대상이 없어 N/A. Acceptance criteria의 순수 변환·직렬화 대상은 이후 NFR Design과 Code Generation에서 연결한다.
