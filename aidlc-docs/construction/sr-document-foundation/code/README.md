# PlanRepo U1 실행 안내

U1은 SR 생성·보드·문서 열람/편집/버전 비교/새 버전 복원과 SQLite 이력을 제공한다. 생성·검증 완료, 코드 산출물 승인은 대기 중이다.

## 설치와 실행

작업공간 루트에서 Node 24를 사용한다. 구현 환경은 Node 24.7.0 / npm 11.5.1이다. 정확한 의존성은 [package.json](../../../../package.json)과 잠금 파일에 기록했다.

```sh
npm ci
npm run dev
```

브라우저에서 http://127.0.0.1:4310 을 연다. 처음에는 빈 보드이며 SR을 직접 만들 수 있다. 생성된 SR은 문서가 0개인 상태로 시작한다. 실제 계획 생성·CLI는 U2에서 연결된다.

빌드한 앱을 실행하려면 다음을 사용한다.

```sh
npm run typecheck
npm test
npm run build
npm start
```

개발 실행은 워커를 먼저 컴파일하고 Vite UI와 같은 Express 서버를 시작한다. 워커 소스를 바꾼 경우 개발 서버를 다시 시작한다. UI는 개발 중 HMR을 사용한다. 빌드는 dist/client 및 dist/server에 생성된다.

## 설정과 데이터

| 항목 | 기본값 | 변경 방법 |
|---|---|---|
| 주소 | 127.0.0.1:4310 | PLANREPO_PORT 환경 변수, 정수 1–65535 |
| DB | 앱 루트/.planrepo/planrepo.sqlite | PLANREPO_DB_PATH 환경 변수 |
| 상대 DB 경로 | 앱 루트 기준 | 실행 디렉터리와 무관 |
| 환경 예시 | 루트 .env.example | 예시만 제공하며 .env를 자동으로 읽지 않음 |

```sh
PLANREPO_PORT=4311 PLANREPO_DB_PATH=.planrepo/demo.sqlite npm run dev
```

DB는 빌드 산출물과 분리되어 있다. 기존 DB가 손상됐거나 지원하지 않는 스키마이면 시작을 중단하며 자동 초기화하지 않는다. 포트 충돌 시 다른 주소로 자동 전환하지 않는다. START_FAILED가 표시되면 포트·DB 경로/권한·스키마를 확인한다.

Ctrl+C 또는 SIGTERM으로 종료한다. 새 요청을 중단하고 워커·Vite·HTTP·DB를 정리하며, 5초 정리 한도 초과는 비정상 종료로 기록한다. 수동 보관은 앱이 완전히 종료된 뒤 데이터 디렉터리와 남아 있는 WAL/SHM 파일을 함께 복사한다. 실행 중 SQLite 파일 하나만 복사하는 방법을 일관된 백업으로 사용하지 않는다.

## 검증용 문서가 필요한 경우

아래 도우미는 OS 임시 디렉터리에 새 전용 DB를 생성하고 그 경로를 출력한다. 정상 앱 실행은 자동 seed를 하지 않는다. 준비된 데이터는 실제 AI 실행 결과가 아니다.

```sh
npx tsx tests/sr-document-foundation/helpers/prepare-browser-fixture.ts
```

출력된 path를 PLANREPO_DB_PATH로 지정하여 앱을 실행하면 20 SR × 5문서 × 10버전과 추가 상한/콘텐츠 검증 문서를 볼 수 있다. 기존 사용자 DB를 이 도우미에 전달하거나 초기화하지 않는다.

## 사용 흐름

1. 보드에서 새 SR을 만들고 초기 요구사항과 선택 첨부를 확인한다.
2. 저장된 계획 문서가 있으면 목록에서 선택해 최신/과거 버전을 연다.
3. 최신에서 본문을 편집해 새 버전으로 저장한다. 충돌 시 초안을 유지한 채 최신 버전과 비교한다.
4. 비교할 왼쪽/오른쪽 버전을 선택한다. 큰 비교는 전체 원문을 보존하는 간략 비교로 표시한다.
5. 과거 내용은 확인 후 새 버전으로 복원한다. 원본과 복원 전 최신도 유지된다.
6. 활동 이력에서 원래 대상 버전과 본문 없는 사건 상세를 확인한다.

저장 응답이 유실되면 입력을 유지하고 결과를 다시 확인한다. 불확실한 상태에서 새 시도는 이전 요청이 나중에 완료될 가능성을 확인받는다. 브라우저 종료 후 미저장 초안 복구는 제공하지 않는다.

[API 참조](api-reference.md) · [검증 결과](verification.md) · [구현과 인계](implementation-summary.md) · [산출물 검토 Q1](code-generation-approval-questions.md)
