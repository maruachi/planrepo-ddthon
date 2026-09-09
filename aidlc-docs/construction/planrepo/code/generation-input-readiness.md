# 생성 입력 준비 조회의 연결 점검

CG-09와 CG-10의 첫 소비 전에 확정하고 실제 테스트로 검증합니다. 이 문서는 구현 완료 증거가 아닙니다.

## 확인한 공백

M-032와 M-035는 expectedInputFingerprint를 meta.guard로 받습니다. M-018과 M-019도 현재 입력 지문을 검사합니다. 그러나 현재 M-047은 NoInput이며 SRDetailView에는 새 생성 요청의 taskKind·supplement·targetBasis를 반영한 지문이 없습니다. M-033은 이미 있는 runId 조회이므로 최초 생성 준비를 대신할 수 없습니다. 현재 초안의 basisFingerprint만으로 최신 입력을 가장해서는 안 됩니다. 브라우저가 DB나 내부 메서드를 호출하거나 시험용 helper가 최신 지문을 대신 주입하는 경로는 제품 연결 증거가 아닙니다.

입력 지문은 승인된 canonical envelope의 taskKind·documentKind·supplement·targetBasis와 현재 설명·근거·질문/답변·결정·분류·문서·규칙 버전/내용을 포함합니다. provider/model 선택과 runtime 값은 별도입니다. 요구 근거는 nfr-design-patterns.md의 고정 입력과 재검사 규칙입니다.

## 구현 제안

기존 공개 44개 메서드를 유지하면서 M-047의 선택적 준비 입력과 SRDetailView의 선택적 준비 결과를 확장합니다. 일반 상세의 빈 입력은 계속 허용합니다. 준비는 현재 actor·같은 SR을 검증한 읽기 전용 경로이며 snapshot·run·receipt·활동을 저장하지 않습니다.

준비 대상은 새 GenerationInput, 현재 재시도할 runId, 사람이 비교하거나 적용할 draftId를 구분해야 합니다. 결과는 요청한 작업과 정확한 현재 targetBasis, expectedInputFingerprint, 비교에 필요한 버전 참조를 명시합니다. 변경 명령은 이 값을 신뢰하는 대신 트랜잭션 안에서 같은 calculator로 다시 계산합니다. 준비 이후 자료가 바뀌면 INPUT_CHANGED 또는 해당 target 기준 오류로 거절합니다. stale 초안의 원 snapshot을 수정하지 않습니다.

CG-09는 초안 적용·사람 검토에서 calculator를 먼저 소비합니다. 따라서 generation-snapshot.ts의 순수 직렬화와 실제 저장 조회를 CG-10까지 미루지 않고 첫 소비 시점으로 앞당길 필요가 있습니다. S-09 조회와 S-07/초안 서비스가 같은 읽기 port를 쓰도록 C-09에서 연결합니다. C-02가 실행 루프나 Claude provider를 직접 호출하지 않습니다.

세부 준비 DTO는 독립 검토로 판별 타입과 참조 검사를 정한 뒤 구현합니다. 함수명이나 추가 필드를 이 제안만으로 구현 완료라고 표시하지 않습니다.

## 함께 수정할 계약

- CG-10의 승인된 11번째 접수 예시는 QUEUE_FULL을 요구하지만 현재 DomainErrorCode에는 없습니다. 코드·HTTP 상태·화면·계약 테스트를 같은 과제에서 보완해야 합니다. 오류를 FORBIDDEN이나 provider 실패로 치환하지 않습니다.
- 현재 CG-10 대표 테스트는 M-032의 필수 fingerprint guard를 생략합니다. fixture 준비 뒤 실제 준비 조회를 하고, 생성된 지문을 guard로 전달해야 의도한 포화 행동 RED가 됩니다.
- 첫 생성·현재 입력 변경 뒤 재시도·오래된 초안의 사람 비교·준비 이후 변경을 실제 HTTP로 검증합니다. private DB helper만 통과한 결과를 UI 연결 성공으로 보고하지 않습니다.
