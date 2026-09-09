# 조회 DTO와 화면 연결 상태

현재 `src/contracts/views.ts`의 일부 View는 메서드 결과의 식별자·현재성 중심 계약입니다. 화면에 필요한 내용은 아래 과제에서 실제 저장 조회와 함께 구체 타입으로 확장해야 합니다. 브라우저 DB 접근, 새 임의 endpoint, any/타입 단언으로 누락을 우회하지 않습니다. 기준은 `aidlc-docs/construction/planrepo/functional-design/frontend-components.md`와 `aidlc-docs/construction/planrepo/functional-design/domain-entities.md`입니다.

| 첫 소비 과제 | 현재 상태 | 실제 연결 책임 |
|---|---|---|
| CG-06 | 제목과 최초·현재 설명 본문을 구현하고 검증했습니다. | 실제 보드 제목, original/current 설명과 Mock 출처를 반환합니다. 큰 설명 본문을 보드 카드에 중복하지 않습니다. |
| CG-07 | 원문·출처·링크·사람 확인 근거를 구현하고 검증했습니다. | 종류와 확인 상태별 구체 타입을 사용합니다. SOURCE UI도 이 실제 조회에 연결했고 CG08에서 충돌·입력 보존을 검증했습니다. |
| CG-09 | 질문·결정·문서·초안의 실제 저장과 typed 조회를 구현하고 독립 검토했습니다. | 문서 편집·비교와 DraftReview fix3의 저장·본문 비교·명령 격리 UI를 검증했습니다. 후속 CG16의 해결·전환·재결정·분류 폼을 연결하고 CG25에서 임의의 두 과거 문서 비교를 확대합니다. |
| CG-17 | M-001/M-047 실제 조회와 정책·배정 UI를 검증하고 독립 검토했습니다. | 현재 DTO와 실제 명령, 명시적 최신 기준 채택과 전송 중 편집 보존을 정책 E2E9개로 검증했습니다. |
| CG-18 | M-047에 검토 요청·승인·reviewConfigurations·reviewPreparations의 실제 읽기 전용 DTO를 연결하고 backend 검토를 마쳤습니다. | 공식 검토 화면에 exact prepared input과 현재 bundle·epoch를 연결하고 실제 E2E를 작성 중입니다. |
| CG-19 | 댓글·수정 요청과 처리 이벤트의 실제 저장 조회를 구현했고 backend 독립 검토 중입니다. | 원 대상과 현재 대상, 미해결 상태, 현재 확인 권한을 명시 DTO로 연결합니다. |
| CG-21 | SRDetailView에 선택할 Handoff 목록이 없습니다. | 작은 인계 목록/참조와 현재 유효성을 제공하고 선택한 고정 본문은 M-041로 읽습니다. 큰 본문 전체를 목록에 중복하지 않습니다. |
| CG-22 | ActivityItemView.targetRefs는 EntityRef만 표현합니다. | ENT-34의 정확한 VersionRef·BundleRef도 보존하고 표시할 수 있도록 추적 참조 타입을 확장합니다. |
| CG-23 | BoardCardView의 blockers·nextActions는 문자열 목록입니다. | 실제 차단 담당자와 대상 이동을 위한 구조화된 서버 자료를 연결합니다. 화면이 문자열을 파싱해 권한이나 대상을 추측하지 않습니다. |

보완은 해당 과제의 실제 화면/조회 테스트와 정상 타입 사례로 검증합니다. 필요한 `src/contracts/views.ts`와 계약 테스트 변경은 과제 시작 snapshot과 검토 diff에 포함합니다. 후속 과제를 구현하기 전에 기존 호출부와 새 필드를 함께 갱신합니다. 행에 검증 완료라고 명시한 범위만 실제 근거를 확보했습니다. 나머지 후속 연결과 전체 과제 완료를 뜻하지 않습니다.
