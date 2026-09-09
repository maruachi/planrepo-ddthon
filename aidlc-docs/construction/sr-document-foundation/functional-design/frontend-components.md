# U1 화면 구성과 상호작용

상태: 기능 설계 Q1 B 승인 완료. 프레임워크와 시각 스타일은 U1 NFR/Code Generation에서 결정한다. [도메인 모델](domain-entities.md), [업무 규칙](business-rules.md), [처리 흐름](business-logic-model.md)을 따른다.

## 컴포넌트 구조

WorkspaceShell 안에 BoardPage와 SRDetailPage를 둔다. BoardPage는 SRCreateForm과 여섯 KanbanColumn의 SRCard를 포함한다. SRDetailPage는 InitialInputPanel, DocumentList, DocumentWorkspace 및 HistoryPanel을 포함한다. DocumentWorkspace는 VersionPicker, DocumentReader, DocumentEditor, VersionCompare와 RestoreConfirm으로 구성한다. 공통 AsyncStatus와 ErrorNotice로 조회·저장 상태를 표시한다.

기본 보드와 상세 이동은 주소로 재열람 가능하게 한다. 상세 주소의 SR/document/version 식별 정보로 선택 대상을 복원한다. 정확한 브라우저 라우트 형식은 구현 프레임워크 선택 후 확정한다.

## 입력값·화면 상태·연결

| 컴포넌트 | Props 또는 입력 | 로컬 상태 | 연결·행동 |
|---|---|---|---|
| WorkspaceShell | 현재 경로와 SR/문서 식별 정보 | 현재 화면, 이동 확인 상태 | 보드/상세 링크, 후속 U3 역할 전환 위치 |
| BoardPage | SRSummary 목록 | loading/error | board 조회 후 고정 열 배치 |
| SRCreateForm | 초기 빈 SRDraft | title/description/attachment, fieldErrors, submitting | create, 첨부 선택·제거, 생성 성공 시 상세 이동 |
| KanbanColumn | column 식별자·표시명·카드 목록 | 없음 | 빈 열도 표시, 열 자체 상태 변경 없음 |
| SRCard | SRId/title/column, 후속 stage/cycle/run/review 요약 | 없음 | 상세 링크; 회차와 리뷰는 별도 텍스트 |
| SRDetailPage | SRId와 선택 document/version | 조회 상태 | 상세·문서·이력을 읽어 하위 컴포넌트 전달 |
| InitialInputPanel | 제목·설명·선택 첨부 | 첨부 펼침 여부 | 생성 입력 열람, 첨부 없음/빈 첨부 구분 |
| DocumentList | 최신 DocumentView 목록 | 선택 documentId | 문서 선택 후 정확한 최신 참조 열람 |
| VersionPicker | VersionSummary 목록·latestVersionRef | 선택 versionId | 과거 버전 열람, 최신으로 이동 |
| DocumentReader | 선택 DocumentView | 표시 모드 | 버전 번호/출처/시각/최신 여부와 본문 표시 |
| DocumentEditor | 기준 VersionRef·원본 본문 | draftBody, dirty, saving, error | 최신에서 편집 시작·저장·취소; 오류 시 초안 유지 |
| VersionCompare | 문서 버전 목록 | left/right VersionRef, loading/error | compare 호출, 줄별 차이·제목 차이·버전 정보 표시 |
| RestoreConfirm | source VersionRef·제목·번호 | open/submitting/error | 새 버전 복원 확인, restore 호출 |
| HistoryPanel | SRId, optional documentId, 사건 목록 | 필터·선택 사건·조회 상태 | 전체/문서 필터, 세부 내용과 정확한 대상 버전 링크 |
| AsyncStatus / ErrorNotice | 진행 여부·성공 결과·오류 | 없음 | 텍스트 상태와 필드/대상 오류, 다시 읽기 행동 |

서버에서 받은 데이터와 미저장 폼 초안을 분리한다. 조회가 갱신되어도 편집 중 draftBody를 덮어쓰지 않는다. dirty 상태에서 문서 전환·화면 이동·취소 시 저장되지 않은 변경을 버릴지 확인한다. 초안의 영구 저장이나 브라우저 종료 후 복구는 이번 기능으로 약속하지 않는다.

## 논리 API 계약

아래 경로는 C02에 연결할 기능 설계상의 HTTP 계약안이다. 라우팅 구현·직렬화·HTTP 상태 코드·본문 제한은 NFR/Code Generation에서 구체화한다. 모든 조회/명령은 성공 값 또는 업무 오류의 공통 응답 형태를 사용한다. 프레임워크 변경으로 경로가 달라지면 이 표를 함께 갱신한다.

| 요청 | 입력/응답 | C02 연결 메서드 | 사용 컴포넌트 |
|---|---|---|---|
| GET /api/board | SRSummary 목록 | C03.listBoard | BoardPage |
| POST /api/srs | SRDraft → SR | C03.create | SRCreateForm |
| GET /api/srs/{srId} | SRDetail | C03.getDetail | SRDetailPage |
| GET /api/srs/{srId}/documents | 최신 DocumentView 목록 | C04.listDocuments | DocumentList |
| GET /api/srs/{srId}/documents/{documentId}/versions | VersionSummary 목록 | C04.listVersions | VersionPicker, VersionCompare |
| GET /api/srs/{srId}/documents/{documentId}/versions/{versionId} | 정확한 DocumentView | C04.readVersion | DocumentReader |
| GET /api/srs/{srId}/history?documentId={optionalId} | 사건 목록; 필터 없으면 SR 전체 | C04.listHistory | HistoryPanel |
| POST /api/srs/{srId}/documents/{documentId}/edits | target versionId, body → DocumentView와 변경 여부 | C04.edit | DocumentEditor |
| GET /api/srs/{srId}/documents/{documentId}/compare?left={versionId}&right={versionId} | DiffView | C04.compare | VersionCompare |
| POST /api/srs/{srId}/documents/{documentId}/restorations | source versionId → 새 DocumentView | C04.restore | RestoreConfirm |

경로 ID와 본문의 versionId로 서버에서 VersionRef를 구성하고 소속을 확인한다. ActorContext는 C02의 로컬 역할 문맥에서 전달한다. U1 명령은 작성자 시연 역할을 사용하고 U3가 역할 선택을 연결한다. 역할을 로그인/권한 검증으로 설명하지 않는다. 클라이언트가 AI 출처·버전 번호·최신 포인터를 지정하지 않는다.

prepareGenerated, C09.read/commit, C10.normalize는 서버 내부 계약이며 브라우저의 직접 API가 아니다. U2/U3는 해당 단위의 UI와 명령을 같은 앱에 추가한다.

## 사용자 흐름

1. 보드에서 SR 만들기 폼에 제목·설명을 입력하고 필요하면 마크다운을 선택한다. 필수값 오류는 해당 입력에 표시한다. 생성 성공 후 상세에 저장된 입력을 표시하고 보드에 카드가 나타난다.
2. 생성 문서가 아직 없으면 “아직 생성된 계획 문서가 없습니다”를 표시한다. 구현되지 않은 AI 진행 버튼이나 Jira 연결을 사용할 수 있는 것처럼 표시하지 않는다. 실제 생성 흐름은 U2에서 연결한다.
3. 문서 선택 시 최신 버전을 연다. 과거 버전을 고르면 “과거 버전”과 현재 최신 참조를 구분한다. 비교/복원은 과거에서도 가능하고 편집은 최신으로 이동해 시작한다.
4. 편집 저장 중 버튼을 중복 제출하지 않게 하고 상태를 표시한다. 성공 후 새 버전·이력을 다시 읽는다. 동일 본문이면 “변경된 내용이 없습니다”를 표시한다. 충돌이면 초안을 유지하고 최신 버전 읽기·비교 후 재편집을 안내한다.
5. 비교에서 왼쪽/오른쪽 버전을 각각 선택한다. 추가/삭제 표식을 텍스트로 표시하고 색만으로 차이를 전달하지 않는다. 같은 버전, 빈 본문, 끝 개행 차이를 표현한다.
6. 복원 확인은 선택 원본과 “새 버전으로 복원됩니다”를 표시한다. 성공 후 새 최신으로 이동한다. 실패·충돌은 같은 대상과 오류를 유지하고 필요한 재조회를 제공한다.
7. 이력은 전체 SR과 선택 문서 필터를 제공한다. 사건 종류·출처·시각·내용 및 대상 링크를 표시한다. 본문 없는 사건을 빈 내용으로 누락하지 않는다.

## 보드와 후속 화면 경계

고정 6열은 처음부터 존재하고 저장된 column에 따라 카드를 배치한다. U1이 생성한 카드는 SR 목록에만 놓인다. 드래그로 임의 상태 전환하는 동작은 추가하지 않는다. 회차는 U2가 정의한 값만 표시하며 값이 없을 때 0회차나 하위 stage 완료 수를 발명하지 않는다. 리뷰 요약과 역할 전환·수동 완료는 U3에서 연결한다.

## 기본 사용성·입력 규칙

- 모든 입력에는 화면 레이블과 필수 표시를 두고 오류를 해당 필드와 연결한다. 설명·본문의 유효한 공백과 줄바꿈을 보존한다.
- 링크·버튼·선택 입력은 키보드로 조작 가능하게 한다. 보드/문서 전환은 클릭 전용 카드에 의존하지 않는다.
- 대화상자는 제목·확인·취소를 제공하고 열린 동안 초점을 관리하며 닫히면 호출한 조작으로 돌려준다. 편집 초안을 버리는 행동은 취소할 수 있다.
- 조회/저장 중과 오류·완료를 텍스트로 구분한다. 저장 여부가 불확실하면 확인 중임을 알리고 다시 읽어 판정한다.
- 마크다운 본문은 텍스트 데이터로 취급한다. 렌더링/HTML 처리 방식은 NFR 설계에서 선택한다. 내용 자체를 실행하거나 자동 명령으로 취급하지 않는다.
- 저장 실패 후 폼을 비우지 않는다. 자동 재시도·실시간 협업·원격 알림을 추가하지 않는다.

## 화면 검증 기준

US-01 입력 오류/첨부/저장, US-02 고정 열과 상세 링크, US-06 재열람, US-07 초안·편집·충돌, US-08 본문 없는 사건과 과거 버전, US-09 방향과 차이·저장 불변성, US-10 복원 대상과 새 버전 표시를 확인한다. 키보드로 해당 조작을 수행할 수 있어야 한다. 실제 AI 생성/리뷰 역할은 U2/U3 연결 후 확인한다. 현재는 설계만 수행했으며 화면 실행 결과는 없다.

## 확장 준수

Security Baseline, Resiliency Baseline, Property-Based Testing은 모두 Enabled No, N/A이며 전체 규칙과 적용을 생략한다. 기본 사용성과 저장 보존은 승인된 제품 NFR에 따라 유지한다.
