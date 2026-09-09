# U3 API

기존 Result 래퍼와 loopback/Host/Origin/JSON 경계를 재사용한다. 변경 요청에는 X-Operation-Id(UUID), X-Planrepo-Role(author 또는 reviewer)가 필요하다. 역할은 동일 사용자 시연 모드이며 인증 체계가 아니다.

| API | 입력·결과 |
|---|---|
| GET /api/srs/:srId/reviews | limit/cursor → Page<ReviewView> |
| GET /api/srs/:srId/reviews/:reviewId | 원래 대상과 최신 참조를 포함한 ReviewView |
| POST /api/srs/:srId/reviews | author, target(VersionRef)/comment → 201 ReviewView |
| POST /api/srs/:srId/reviews/:reviewId/results | reviewer, kind(approve/request_changes)/comment → ReviewView |
| POST /api/srs/:srId/implementation | author, revision → 수동 완료 SR |
| GET /api/operations/:operationId | 리뷰 receipt의 reviewId 또는 mark_implemented 확인 |

요청·결과 comment는 필수이며 64 KiB 상한이다. 리뷰 목록 기본 50/최대100, 추가 조회 지원. 잘못된 역할 값/본문/소속은 400, 기대 역할 불일치는 403, 없는 대상은 404, 상태/리비전/중복 결과/operation 충돌은 409다. 정상 receipt 재전송은 기존 기록을 조회한다.

ReviewView는 원래 target, 원래 versionNumber, 현재 documentTitle, latestVersionRef/isLatest와 요청/결과 내용을 제공한다. 본문은 기존 정확한 버전 조회 API로 읽는다. 리뷰는 계획 열·revision을 바꾸지 않는다. 수동 완료는 SR/WorkflowState/사건/receipt를 함께 저장한다.
