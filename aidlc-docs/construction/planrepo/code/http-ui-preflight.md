# HTTP·첫 화면 연결 준비

CG-05와 CG-08에서 실제 선행 코드에 맞춰 검증합니다. 승인 기준은 `aidlc-docs/construction/plans/planrepo-code-generation-plan.md`, `aidlc-docs/construction/planrepo/infrastructure-design/infrastructure-design.md`, `aidlc-docs/construction/planrepo/functional-design/frontend-components.md`입니다.

## 첫 작업 공간 조회

이 제품은 한 프로젝트와 고정 가상 사용자 목록을 갖는 데모입니다. 첫 화면은 DEMO-4 manifest의 projectId와 기본 P-01 actorId를 사용해 M-001을 호출할 수 있습니다. manifest의 두 공개 ID만 Vite build/개발 define으로 전달하고 설정 파일 전체를 브라우저에 제공하지 않습니다. 원본은 `config/demo/manifest.json` 한곳으로 유지합니다. 다른 사용자가 선택돼 있으면 브라우저별 저장값을 M-002로 다시 검증합니다. 서버는 모든 요청에서 실제 프로젝트·현재 멤버십·배정을 읽으며 초기 ID를 권한 증명으로 사용하지 않습니다. 테스트의 empty fixture도 같은 가상 프로젝트·사용자를 준비하되 SR은 0개입니다.

M-002는 선택 전 actor header를 필수로 요구하지 않으며, 결과는 호출한 브라우저의 선택에만 적용합니다. M-001과 일반 업무 호출의 현재 actor 검사는 유지합니다. 새 bootstrap 업무 endpoint나 서버 전역 선택 사용자를 추가하지 않습니다.

## 반드시 이어야 할 계약

- CG-02의 실제 Fastify AJV 검증과 맞추려면 removeAdditional=false를 설정합니다. 미지원 입력을 삭제한 뒤 성공시키지 않습니다.
- 변경 여부와 무관하게 공개 메서드는 고정 44개 목록으로 등록합니다. 미구현 handler는 정상 업무 결과를 가장하지 않습니다. 내부 6개는 404입니다.
- M-042는 고정 Markdown bytes와 X-PlanRepo-Command의 base64url JSON 메타데이터를 분리합니다. 오류는 JSON입니다. 실제 인계 서비스와 연결할 때 현재 권한과 현재용 유효성을 다시 검사합니다.
- 요청의 UTF-8 byte 상한은 JSON schema maxLength와 별도로 검사합니다. 잘못된 Host/Origin은 body 파싱 전에 거절합니다.
- 일반 정적 경로는 dist/web의 realpath 안으로 제한합니다. 개발 Vite도 middleware 순서·HMR·/@fs·symlink를 실제로 검증합니다. .planrepo·config·문서·서버 소스는 정적 자산이 아닙니다.
- 테스트의 generation은 기본 manual/paused입니다. provider unavailable만으로 루프가 멈췄다고 추정하지 않습니다.
- 포트는 테스트가 미리 확보한 명시 loopback 주소로 사용합니다. 확보와 listen 사이 충돌이 나면 실패를 반환하며 다음 포트로 자동 이동하지 않습니다.

## 후속 조회 확장

현재 WorkspaceView는 프로젝트·멤버·연결·revision을 담습니다. UI-21의 필수 정책 목록·체크리스트·현재 기본 정책은 아직 없습니다. CG-17에서 정책 서비스·화면을 연결할 때 WorkspaceView와 M-001 조회를 함께 확장하고 실제 선택 가능 정책을 반환해야 합니다. 새 endpoint나 브라우저 DB 접근으로 보완하지 않습니다.

이 문서는 실행 결과가 아닙니다. CG-05/08/17의 테스트와 독립 검토로 위 연결을 확인합니다.
