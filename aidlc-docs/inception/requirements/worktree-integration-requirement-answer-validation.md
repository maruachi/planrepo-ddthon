# Worktree 통합 요구사항 답변 검증

## 검증 결과

- **응답 출처**: 사용자의 “권장안으로 진행해줘.” 지시에 따른 AI 권장 선택
- **형식**: 22개 질문 모두 유효한 선택 문자와 근거를 포함
- **누락**: 없음
- **모순**: 없음
- **추가 질문**: 불필요
- **요구사항 생성 게이트**: 통과

## 결정 요약

| 질문 | 선택 | 결정 |
| --- | --- | --- |
| Q1 | B | 이번 구현은 P0와 P1, P2는 후속 범위 |
| Q2 | A | 로컬 Git 저장소만 지원 |
| Q3 | B | 첫 실행 직전 worktree 지연 생성 |
| Q4 | B | 기존 `aidlc-docs`와 공식 intent별 프로필 모두 지원 |
| Q5 | B | AI-DLC 초기화는 미리보기와 명시적 승인 필요 |
| Q6 | A | 단일 로컬 사용자, author/reviewer 역할 전환, 로그인 제외 |
| Q7 | A | 단일 허용 루트와 저장소별 신뢰 확인 |
| Q8 | B | 변경된 소스·테스트·설정도 한도 내 blob 보관 |
| Q9 | A | 20,000개 파일, 텍스트 10 MiB, 체크포인트 500 MiB 기본 상한 |
| Q10 | A | filesystem content-addressed blob과 SQLite 메타데이터, 별도 암호화 제외 |
| Q11 | A | 명시적 영구 삭제 전까지 자동 만료 없음 |
| Q12 | A | drift는 항상 실행·승인을 차단하고 사용자 결정 요구 |
| Q13 | A | 단일 문서 복원만 이번 범위, 전체 복원은 P2 |
| Q14 | C | profile이 session 재사용을 결정 |
| Q15 | A | SR당 1개, 전체 2개, 30분 timeout |
| Q16 | C | `git add`·`git stash` 기본 금지, 저장소 정책으로만 허용 가능 |
| Q17 | B | 기존 SR은 저장소 연결 시 명시적 baseline 전환 |
| Q18 | A | polling 유지와 중복 run 방지 강화 |
| Q19 | A | 20,000개 manifest 5초, 일반 API 1초 기준 |
| Q20 | B | Security Baseline 비활성; 명시된 제품 보안 NFR은 유지 |
| Q21 | B | Resiliency Baseline 비활성 |
| Q22 | B | PBT Partial 적용 |

## 일관성 검토

- P0+P1 범위와 단일 문서 복원 선택이 일치하며 전체 체크포인트 복원·파일별 충돌 해결은 P2로 남는다.
- 로컬 저장소, 단일 사용자, polling, 두 개의 전체 동시 실행 제한이 현재 loopback 단일 프로세스 구조와 일치한다.
- 변경된 소스 파일을 blob으로 보관하되 바이너리는 메타데이터만 기록하므로, 바이너리가 포함된 체크포인트는 완전 복원 가능으로 표시할 수 없다.
- 자동 만료는 없지만 파일 수·크기·체크포인트 상한은 적용한다. 상한 초과 시 실행 성공이나 완전 복원 가능 상태로 표시하지 않는다.
- Security Baseline 비활성은 명시된 경로 경계, symlink 차단, shell 없는 subprocess, 비밀정보 마스킹과 Git 쓰기 제한을 완화하지 않는다.
- PBT Partial은 parser·formatter, manifest serialization, cursor/receipt encoding 등 순수 변환과 직렬화 경계에만 적용하고 상태ful workflow 전체 PBT는 강제하지 않는다.
