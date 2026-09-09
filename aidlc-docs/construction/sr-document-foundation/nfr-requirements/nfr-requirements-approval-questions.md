# U1 NFR 요구사항 검토

검토 대상: [비기능 요구사항](nfr-requirements.md), [공통 기술 선택과 공식 근거](tech-stack-decisions.md).

기존 NFR-01–06을 U1의 비기능 기준 12개와 연결했다. 다음은 이번 단계에서 제안한 설정과 기술 선택이다.

- Node 24·TypeScript·React/Vite·Express 5·SQLite/better-sqlite3를 하나의 로컬 앱에서 사용한다. 정확한 패키지 패치는 구현 시 호환성을 검증해 잠금 파일에 고정한다.
- 기본 주소는 127.0.0.1:4310, DB는 앱 루트 .planrepo/planrepo.sqlite로 제안한다. 서버 설정으로 포트·DB 위치를 변경할 수 있다.
- 제목은 각각 UTF-8 4 KiB, 요구 설명·첨부·문서 본문은 각각 1 MiB, U1 JSON 요청은 16 MiB 상한을 제안한다. 이는 과거 합의값이나 실측값이 아니며 이번 검토 대상이다. 초과 시 명시적 오류로 처리하고 자동 절단하지 않는다.
- 저장·참조·사건을 함께 확정하고 재시작 후 보존한다. 오래 걸리는 상세 비교는 전체 변경 정보를 보존하는 간략 비교로 처리할 수 있으며 화면에 구분 표시한다. 실행 방식은 NFR Design에서 구체화한다.
- 기존 기능 설계와 단위 순서, 로그인 없는 로컬 범위, 제한된 검증 범위를 유지한다. CLI 실제 연동은 U2에서 검증한다.

확인한 환경은 Node v24.7.0, npm 11.5.1, Claude CLI 실행 파일 경로이다. 패키지 설치·빌드·SQLite 네이티브 로딩·CLI 인증/생성 성공은 미검증이다. 문서 링크·표·NFR 추적과 공식 호환 근거는 검토했다.

Security/Resiliency/Property-Based Testing은 기존 결정대로 Disabled, 모두 N/A이다. Infrastructure Design 생략도 유지한다.

## Question 1 — NFR 검토 결과

위 요구사항·스택·저장 위치·용량 제안에 대한 검토 결과를 남겨 주세요. 이 질문은 construction/nfr-requirements.md의 두 가지 검토 행동을 따른다.

A) Request Changes — 수정할 요구사항·스택·설정·지원 상한을 설명

B) Continue to Next Stage — NFR 산출물을 승인하고 U1 NFR Design으로 진행

[Answer]: B

승인 기록: 2026-09-08T15:23:43Z, 사용자 채팅 “승인 후 진행”. 위 NFR 산출물에 대한 승인과 U1 NFR Design 진행으로 반영했다.
