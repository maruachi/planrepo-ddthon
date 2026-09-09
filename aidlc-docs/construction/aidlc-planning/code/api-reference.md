# U2 API

기존 loopback/Host/Origin·JSON 검증과 Result 응답을 재사용한다. POST에는 X-Operation-Id(UUID)가 필요하다. body의 revision은 직전 WorkflowView.revision이다. 같은 ID와 같은 본문 재전송은 원래 receipt를 조회하며 새 실행을 만들지 않는다. 같은 ID의 다른 본문은 409다.

| 메서드·경로 | 요청 | 성공 결과 |
|---|---|---|
| GET /api/srs/:srId/workflow | 없음 | WorkflowView, 가능한 행동·현재 검토 버전·최근 실행 |
| GET /api/srs/:srId/runs/:runId | 없음 | RunView, 문맥 본문은 제외 |
| POST /api/srs/:srId/planning/advance | action(generate/revise/next), revision | 202 RunView, 비동기 실행 시작 |
| POST /api/srs/:srId/planning/answers | questionSetId, answers(질문 ID→문자열), revision | WorkflowView |
| POST /api/srs/:srId/planning/decisions | kind(approve/request_changes), comment, targets(VersionRef 배열), revision | WorkflowView |
| POST /api/srs/:srId/planning/complete | revision | 구현 대기 WorkflowView |
| GET /api/operations/:operationId | 기존 경로 | committed receipt에 생성 시작의 runId 포함 |

응답 예시:

```json
{"ok":false,"error":{"code":"WORKFLOW_CONFLICT","message":"계획 상태가 변경되었습니다. 새로 확인해 주세요."}}
```

VALIDATION_ERROR/REFERENCE_MISMATCH는 400, 없는 대상 404, VERSION_CONFLICT/WORKFLOW_CONFLICT/APPROVAL_REQUIRED/PLANNING_ACTION_BLOCKED/OPERATION_CONFLICT는 409, 요청 상한 413, 저장소 사용 중/불확실 결과 503이다. CLI 실패는 저장된 RunView.status=failed와 error로 조회한다. 프로세스가 종료됐다는 사실만으로 succeeded를 반환하지 않는다.

구체적 타입은 src/shared/planning-contracts.ts, 입력 경계는 src/aidlc-planning/http/planning-routes.ts다. 리뷰와 수동 구현 완료는 U3에서 추가한다.
