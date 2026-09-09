# U1 NFR 설계 검토

검토 대상: [설계 패턴](nfr-design-patterns.md), [논리 컴포넌트와 실행 구성](logical-components.md).

U1 NFR Requirements Q1 B 승인을 반영했다. 이번 검토는 그 요구사항을 구체화한 새 설계에 대한 승인이다.

- SQLite 복합 소속 FK·불변 버전/사건·최신 참조와 커밋 확인 기록을 한 트랜잭션으로 확정한다. WAL/FULL, 100 ms 잠금 대기, 데이터 보존 마이그레이션을 제안했다.
- 생성/편집/복원에 operation_id와 같은 트랜잭션의 확인 기록을 사용한다. 응답 유실은 재조회하고 기록이 없다는 이유만으로 미저장이라고 단정하지 않는다. 자동 재시도는 추가하지 않는다.
- 목록 계약을 Page와 메타데이터 조회로 구체화한다. 기본 50/최대 100개와 커서, 사건 상세/요청 결과/공개 상한 조회를 추가한다. 본문은 선택한 버전만 읽는다.
- 비교 워커 한 개, 상세 계산 250 ms/편집 거리 2000, 합계 20,000줄·변경 블록 20,000개 제한과 전체 작업 2초 고장 한도를 제안했다. 상세 한도를 넘으면 원문을 모두 포함하는 간략 비교, 고장은 명시적 실패로 표시한다.
- 비교/큰 원문 화면은 200줄씩 표시한다. 256 KiB 또는 5,000줄 초과 본문은 원본 모드로 열어 대규모 Markdown 렌더링을 피한다. 저장된 전체 내용과 편집은 유지한다.
- 기존 서버/브라우저 경계·입력 상한·키보드/초안 규칙을 구체화했다. 개발 서버 실행용 tsx와 사전 컴파일한 JS 워커, 단일 Express/Vite 실행 구성을 제안했다.

새 수치는 초기 구현 설계값이며 성능 측정이나 SLA가 아니다. 문서 표·링크·12 NFR 추적·실패 경로를 검토했으며, 패키지 설치·SQL DDL 실행·런타임 테스트는 아직 수행하지 않았다. U2 CLI·U3 리뷰는 해당 단위에서 진행한다.

Security Baseline, Resiliency Baseline, Property-Based Testing은 기존 Enabled No에 따라 모두 N/A이다. Infrastructure Design 생략을 유지한다.

## Question 1 — 설계 검토 결과

위 두 산출물의 저장·응답 확인·목록 계약·비교/화면 한도·실행 구성을 검토해 주세요. 이 질문은 construction/nfr-design.md의 두 가지 검토 행동을 따른다.

A) Request Changes — 수정할 설계·계약·설정값을 설명

B) Continue to Next Stage — NFR Design 산출물을 승인하고 U1 Code Generation 계획 단계로 진행

[Answer]: B

승인 근거: 2026-09-08T15:46:21Z, 사용자 채팅 “승인 후 진행”. NFR Design 산출물을 승인하고 U1 Code Generation 계획 작성으로 진행한다.
