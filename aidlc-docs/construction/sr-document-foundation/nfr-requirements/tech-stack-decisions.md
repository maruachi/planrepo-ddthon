# U1 공통 기술 선택

상태: NFR 산출물 Q1 B 승인 완료. 사용자 채팅 “승인 후 진행”으로 승인했다. 조사일: 2026-09-09 KST. 기존 승인 범위를 구현하기 위한 제안이며 설치·실행 성공 기록이 아니다.

근거: [비기능 요구사항](nfr-requirements.md), [단위 정의](../../../inception/application-design/unit-of-work.md), [승인된 기능 설계](../functional-design/business-logic-model.md).

## 선택 요약

| 영역 | 제안 | 이 프로젝트에서의 이유 |
|---|---|---|
| 런타임·패키지 관리 | Node 24 계열, npm, ESM | 로컬에 Node 24.7.0/npm 11.5.1 존재. UI/서버 TypeScript를 한 프로젝트로 관리 |
| 언어 | TypeScript, strict 검사 | VersionRef·Result·ChangeSet과 후속 타입 계약을 명시하고 서버/화면 경계 공유 |
| UI·빌드 | React 19 계열, Vite, 기본 CSS | 승인된 상태·폼·문서 컴포넌트를 구현하고 로컬 서버가 빌드 UI를 제공 |
| 라우팅·조회 | React Router, 브라우저 fetch와 공통 요청 모듈 | 보드/상세/선택 버전 주소와 명시적 loading/error/초안 상태 유지 |
| 앱 서버 | Express 5 | 기존 C02 논리 HTTP 계약을 서비스 메서드에 직접 연결 |
| 영속 저장 | SQLite + better-sqlite3, 직접 SQL과 버전별 마이그레이션 | 관련 레코드·참조·사건을 짧은 트랜잭션에서 함께 저장. 별도 DB 서버 불필요 |
| 마크다운 | react-markdown + remark-gfm, HTML 원문 실행 비활성 | 본문 원본을 보존하고 표·코드·일반 마크다운 표시 |
| 비교 | diff 패키지(jsdiff)의 줄 단위 비교 | 직접 복잡한 diff 알고리즘을 작성하지 않고 명확한 비교 계약에 맞춤 |
| 검증 | Vitest, TypeScript 검사, 실제 파일 DB를 사용하는 집중 테스트, 수동 UI 확인 | 필수 저장/복원/참조의 증거를 확보하고 제한된 테스트 범위 유지 |

정확한 패키지 패치는 Code Generation에서 engines/peerDependencies·네이티브 로딩·빌드를 확인한 조합으로 package-lock.json에 고정한다. 런타임 파일에 선택한 Node 패치를 기록한다. 조사 당시 설치된 24.7.0을 최신 패치라고 주장하지 않으며 사용자 전역 Node 설치를 임의로 교체하지 않는다. 호환 문제가 있으면 코드 생성 단계에서 원인과 필요한 변경을 구체화한다.

## 공식 근거와 판단

React 공식 문서는 제약에 맞춰 Vite의 react-ts 템플릿으로 SPA를 구성하는 경로와 프레임워크 기능을 직접 다뤄야 하는 비용을 설명한다. 이 앱은 로컬 도구이고 SSR/SEO 요구가 없으므로 SPA와 명시적 서버를 선택한다. 이는 프로젝트 요구에 따른 판단이다. [React 문서](https://react.dev/learn/build-a-react-app-from-scratch)

Vite 안내의 Node 조건은 20.19+, 22.12+이며 일부 템플릿은 더 높은 버전을 요구할 수 있다. Vitest 안내는 Vite 6.4 이상과 Node 22.12 이상을 명시한다. 설치된 Node 24.7.0은 안내의 최소 런타임 조건을 충족하지만 실제 선택할 패키지 조합의 호환성은 설치 시 다시 검증한다. [Vite 안내](https://vite.dev/guide/), [Vitest 안내](https://vitest.dev/guide/)

Express 5 설치 문서의 최소 Node 버전은 18이다. C02의 라우팅과 오류 응답을 명시적으로 구현할 서버로 선택한다. TypeScript strict는 여러 엄격한 타입 검사를 함께 활성화한다. 런타임 입력 검증은 별도로 수행한다. [Express 설치](https://expressjs.com/en/starter/installing/), [TypeScript strict](https://www.typescriptlang.org/tsconfig/strict.html)

better-sqlite3는 지원 중인 Node와 주요 플랫폼의 사전 빌드 바이너리를 안내한다. 해당 macOS/Node 조합의 설치 성공은 아직 확인하지 않았다. API의 transaction 함수는 정상 반환 시 커밋하고 예외 시 롤백하며 async 함수와 함께 사용하지 않아야 한다. 따라서 C09의 트랜잭션 안에는 동기 검증/SQL만 두고 CLI·네트워크를 기다리지 않는다. [better-sqlite3 설치](https://github.com/WiseLibs/better-sqlite3), [트랜잭션 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)

SQLite 외래 키 적용은 연결별로 명시적으로 활성화하고 확인해야 한다. NFR Design에서 FK·복합 소속 키·트랜잭션 전제조건을 함께 설계한다. DB의 ID 존재 확인만으로 SR/문서 소속의 전체 의미가 검증된다고 가정하지 않는다. [SQLite 외래 키](https://sqlite.org/foreignkeys.html)

react-markdown은 원문 HTML을 기본적으로 이스케이프하거나 skipHtml로 무시할 수 있다. 본 설계에서는 raw HTML 플러그인을 추가하지 않고 원본 텍스트 열람을 제공한다. jsdiff는 줄 비교와 계산 중단 옵션을 제공한다. 중단 시 반환값을 변경 없음으로 오해하지 않고 NFR의 명시적 간략 비교 정책으로 처리한다. [react-markdown](https://github.com/remarkjs/react-markdown), [jsdiff](https://github.com/kpdecker/jsdiff)

## 로컬 실행·데이터 기본값 제안

| 설정 | 기본값/위치 | 의미 |
|---|---|---|
| 앱 호스트 | 127.0.0.1 | 로컬 전용 기본 실행. 공용 인터페이스로 자동 대체하지 않음 |
| 앱 포트 | 4310, PLANREPO_PORT로 변경 가능 | 포트 충돌 시 원인 표시; 실제 사용 가능 여부는 구현 때 확인 |
| DB 파일 | 앱 루트의 .planrepo/planrepo.sqlite | Git 연결 없이 자체 저장. dist/·aidlc-docs/와 분리 |
| 대체 DB | PLANREPO_DB_PATH 서버 설정 | 상대 경로는 앱 루트 기준으로 해석, 해석한 위치를 시작 로그에 표시 |
| 앱 코드 | src/sr-document-foundation/, src/shared/, src/app/ | 승인된 모듈 배치, 후속 U2/U3 폴더 확장 |
| UI 소스/산출물 | 클라이언트 진입을 src/app/에 분리, 산출물 dist/client/ | 서버 전용 DB·CLI 코드를 브라우저 번들로 가져오지 않음 |
| 서버 산출물 | dist/server/ | Node가 실행하며 정적 UI와 /api를 같은 앱 서버에서 제공 |
| 개발 명령 목표 | npm run dev | 같은 Express 앱에 Vite 개발 미들웨어를 연결하는 방식으로 제안; DB 경계 유지 |
| 빌드/실행 목표 | npm run build, npm start | UI 빌드와 서버 타입/컴파일, 이후 단일 서버로 실행 |
| 검증 명령 목표 | npm run typecheck, npm test | 잠금 파일과 함께 재현 가능한 프로젝트 스크립트 |

위 명령은 아직 생성되지 않은 프로젝트 스크립트의 목표 계약이다. 현재 실행 가능한 것으로 안내하지 않는다. 개발 미들웨어 연결·정적 경로·서버 종료 순서는 NFR Design에서 구체화한다. 최초 실행 외부 패키지 다운로드·설치도 아직 수행하지 않았다.

애플리케이션 초기화/빌드/마이그레이션 실패 시 기존 DB를 초기화하지 않는다. 테스트 DB는 임시 경로를 명시하고 .planrepo/의 실제 데이터에 테스트 초기화를 수행하지 않는다. 코드 생성에서 .planrepo/ 및 빌드·의존성 산출물을 버전 관리 제외 대상으로 설정하되 앱 기능에 Git 설치를 요구하지 않는다.

## 저장과 콘텐츠 선택의 세부 경계

SQLite를 C09 어댑터 안에 두고 명시적 파라미터 바인딩과 동기 트랜잭션을 사용한다. 스키마·복합 FK·최신 참조 비교·마이그레이션 번호·저널/동기화 설정·잠금 대기 정책은 NFR Design에서 확정한다. 동기 쓰기와 큰 조회가 이벤트 루프를 오래 점유하지 않도록 해당 문서/버전만 읽고 커밋을 작게 유지한다.

SQLite 네이티브 바이너리는 번들 안에 합치지 않고 런타임 의존성으로 유지한다. 설치 후 실제 파일 DB 열기·쓰기·롤백·재열람을 확인한다. 설치 실패를 메모리 저장이나 JSON 성공으로 대체하지 않는다. 필요 시 같은 원자성 계약을 유지하는 드라이버 변경을 검토하고 문서를 갱신한다.

마크다운 원문은 그대로 저장하고 렌더러에서만 표현한다. raw HTML을 실행하지 않으며 이미지 요소는 기본적으로 대체 텍스트를 표시해 자동 외부 요청을 만들지 않는다. 허용 URL과 원본 보기 방식은 NFR Design에서 정의한다. 비교는 제목·본문·개행을 포함하고 오래 걸리는 상세 diff의 간략 비교를 명확히 표시한다.

React Router는 SPA 주소 상태에, fetch 공통 모듈은 요청/오류 처리에 사용한다. 데이터가 바뀌면 영향받는 조회를 명시적으로 갱신하되 편집 초안을 덮어쓰지 않는다. 전역 캐시 프레임워크나 상태 관리 패키지가 없어도 현재의 두 주요 화면과 문서 작업을 일관되게 구현할 수 있도록 요청 경계를 설계한다.

## 대안 검토

| 대안 | 선택하지 않은 이유 | 재검토 조건 |
|---|---|---|
| 별도 PostgreSQL 서버 | 단일 로컬 사용에서 서비스 설치/운영 경계가 늘어남 | 다중 사용자/원격 동시 작업이 새 범위로 승인될 때 |
| JSON/마크다운 파일만으로 저장 | 여러 레코드·최신 포인터·사건의 일관성을 직접 구현해야 함 | 파일 교환 중심의 새 요구가 명시될 때 |
| SSR을 포함한 전체 웹 프레임워크 | 현재 요구에 SSR/SEO가 없고 명시적 C02/CLI/DB 경계를 유지하기 쉬운 구성이 적합 | 외부 배포·서버 렌더링 요구가 생길 때 |
| 별도 Python 서버 | 현재 Node를 사용할 수 있고 공유 TypeScript 계약을 한 프로젝트에 둘 수 있음 | 기존 Python 자산/명시적 사용자 선호가 추가될 때 |
| 대형 ORM·분산 저장 계층 | 작은 로컬 스키마에서 직접 SQL/마이그레이션으로 계약을 분명히 할 수 있음 | 모델 복잡도·복수 DB 요구가 증가할 때 |

이는 프로젝트 적합성 판단이며 특정 대안이 일반적으로 열등하다는 평가가 아니다. 로그인·원격 배포·자동 재시도·전체 테스트 자동화는 이번 선택에 포함하지 않는다.

## 구현 때 확인할 항목

1. 선택 패키지들의 Node engines/peerDependencies와 잠금 파일, 타입 검사·UI 빌드·서버 시작.
2. macOS의 better-sqlite3 네이티브 로딩과 실제 파일 트랜잭션·참조 검증·롤백·재열람.
3. 기본/대체 DB 경로의 앱 루트 기준 해석, 개발/빌드 실행 간 동일 DB 유지, 테스트 데이터 격리.
4. 본문 상한·JSON 요청 상한·한글/개행 보존, HTML 비실행, 상세/간략 비교의 완전한 정보와 앱 조작성.
5. 승인된 집중 테스트와 주요 UI 키보드 동작. U2/U3 연결 후 최종 통합 흐름을 확인한다.

Claude 실행 파일 경로 발견은 설치 전체·인증 유효성·실제 생성 성공을 입증하지 않는다. U2에서 기존 인증을 사용하는 실제 CLI를 검증한다. U1에서 인증 파일을 읽거나 CLI를 호출하지 않았다.

## 확장 준수

Security Baseline, Resiliency Baseline, Property-Based Testing은 Enabled No로 모두 N/A이며 전체 규칙과 적용을 생략했다. 승인된 저장·사용성·입력/실행 경계는 유지한다. Infrastructure Design 생략도 유지한다.
