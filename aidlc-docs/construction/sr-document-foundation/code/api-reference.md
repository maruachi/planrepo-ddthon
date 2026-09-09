# U1 로컬 API 참조

기본 주소는 http://127.0.0.1:4310 이다. API 응답은 Cache-Control: no-store이며, 실제 로컬 Host 및 동일 Origin을 확인한다. 로그인/권한 검증을 제공하는 서버가 아니다.

## 응답과 명령

성공은 ok=true/data, 실패는 ok=false/error이다. 오류에는 code/message 및 필요한 field/target/currentVersionRef/operationId가 포함될 수 있다. SQL·스택·원문 입력은 오류 응답에 포함하지 않는다.

```json
{"ok": false, "error": {"code": "VALIDATION_ERROR", "message": "필수 입력입니다.", "field": "title"}}
```

POST는 application/json, 압축 없음, X-Operation-Id UUID를 요구한다. U1 actor는 서버가 작성자 역할로 설정한다. fingerprint는 명령 종류·원래 입력·대상·역할의 고정 순서 SHA-256이며 서버에서 계산한다.

같은 operation ID와 같은 입력은 원래 저장 결과를 재사용한다. 다른 입력은 OPERATION_CONFLICT다. 저장된 성공을 최신 검사보다 먼저 확인하고 커밋 내부에서도 재검사한다. 응답 유실은 성공/실패를 추측하지 않고 operations 조회로 확인한다.

## 경로 13개

경로의 srId/documentId/versionId/eventId/operationId 및 버전 쿼리 값은 UUID다. 모든 버전 참조에서 SR·문서 소속을 검사한다.

| 메서드 | 경로 | 입력 및 data |
|---|---|---|
| GET | /api/config | 공개 입력·페이지·표시 상한, 서버 경로 제외 |
| GET | /api/board | limit/cursor → Page of SRSummary |
| POST | /api/srs | title, description, optional attachmentMarkdown/attachmentDisplayName → SR; 201 |
| GET | /api/srs/{srId} | SR 초기 입력·저장 column |
| GET | /api/srs/{srId}/documents | limit/cursor → Page of DocumentSummary; 본문 제외 |
| GET | /api/srs/{srId}/documents/{documentId}/versions | limit/cursor → Page of VersionSummary |
| GET | /api/srs/{srId}/documents/{documentId}/versions/{versionId} | 정확한 DocumentView; title/body/latestVersionRef/isLatest |
| GET | /api/srs/{srId}/history | optional documentId, limit/cursor → 사건 요약과 원래 versionRefs |
| GET | /api/srs/{srId}/history/{eventId} | 사건 전체, optional subject/details |
| POST | /api/srs/{srId}/documents/{documentId}/edits | versionId, body → view/changed; 200 |
| POST | /api/srs/{srId}/documents/{documentId}/restorations | versionId → view/changed; 200 |
| GET | /api/srs/{srId}/documents/{documentId}/compare | left/right 버전 UUID → DiffView |
| GET | /api/operations/{operationId} | committed와 원래 receipt 또는 in_progress/unknown |

## 목록과 비교

Page는 items와 nullable nextCursor이다. 기본 50/최대 100개이며 커서는 최대 1 KiB이고 조회 소속·필터에 묶인다. SR은 생성 시각/ID 역순, 문서는 생성 시각/ID 정순, 버전은 번호 역순, 사건은 sequence 역순이다. 목록은 영구 스냅샷이 아니며 새 내용은 새로고침으로 확인한다.

DiffView는 left/right의 정확한 참조·제목·번호, mode(detailed/coarse), optional reason, titleChanged/unchanged, blocks를 반환한다. 각 블록은 kind(equal/add/remove), text, count를 갖는다. add를 제외하고 text를 합치면 왼쪽 원문, remove를 제외하면 오른쪽 원문이다. 공백·CRLF/LF·끝 개행을 보존한다. 비교는 저장하지 않는다.

본문 합계 20,000줄 초과 또는 상세 diff 제한(250 ms, 편집 거리 2,000, 결과 블록 20,000)에서 간략 비교로 전환한다. 워커는 동시에 한 작업만 처리하며 전체 2초 한도는 고장 탐지용이다. 시간 초과·취소·고장은 오류로 반환한다.

## 주요 오류

| HTTP | 코드 | 의미 |
|---|---|---|
| 400 | VALIDATION_ERROR / REFERENCE_MISMATCH | 입력·ID·커서·소속 오류 |
| 404 | NOT_FOUND | 대상 또는 API 경로 없음 |
| 409 | VERSION_CONFLICT | 최신 기준 변경; 초안 보존 |
| 409 | OPERATION_CONFLICT / IN_PROGRESS | 요청 내용 충돌 또는 동일 요청 처리 중 |
| 413 | PAYLOAD_TOO_LARGE | JSON/필드별 UTF-8 상한 초과 |
| 415 | UNSUPPORTED_MEDIA_TYPE | 형식·압축 미지원 |
| 503 | STORAGE_BUSY / COMPARE_BUSY | DB 잠금 또는 비교 사용 중 |
| 503 | OUTCOME_UNKNOWN | 커밋 여부 확인 불가 |
| 500 | STORAGE_FAILED / READ_FAILED / COMPARE_FAILED | 명시적 저장 실패 또는 조회/비교 실패 |

제목·logicalKey·표시 파일명은 4 KiB, 설명·첨부·문서 본문은 각각 1 MiB, JSON 요청은 16 MiB다. 서버는 초과값을 잘라 저장하지 않는다. 빈 첨부와 빈 사람 편집은 유효하며, AI 본문과 SR 설명은 공백만이면 거절한다.

prepareGenerated/ChangeSet/C09는 서버 내부 계약이다. 브라우저에서 임의 SQL·사건·버전 번호·AI 출처·최신 포인터를 제출할 수 없다. [공통 타입](../../../../src/shared/contracts.ts)과 [HTTP 경계](../../../../src/sr-document-foundation/http/boundary.ts)를 참조한다.
