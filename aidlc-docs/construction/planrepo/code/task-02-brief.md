# CG-02 구현 지시서

먼저 아래 과제를 읽습니다. 공통 HTTP 해석은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`입니다. 승인된 50개 메서드와 ENT의 필수·조건부 필드를 읽고 구체적인 타입·JSON schema를 만듭니다. CG-01의 설치·별칭·타입 검사 설정을 재사용합니다.

### CG-02 공통 자료형·50개 서비스 계약과 공개 메서드 경계

**구현 묶음**: B-01입니다. **선행**: CG-01입니다.

**연결 기준**: M-001, M-002, M-003, M-004, M-005, M-006, M-007, M-008, M-009, M-010, M-011, M-012, M-013, M-014, M-015, M-016, M-017, M-018, M-019, M-020, M-021, M-022, M-023, M-024, M-025, M-026, M-027, M-028, M-029, M-030, M-031, M-032, M-033, M-034, M-035, M-036, M-037, M-038, M-039, M-040, M-041, M-042, M-043, M-044, M-045, M-046, M-047, M-048, M-049, M-050, SCN-12, NQ-07, NQ-08, NQ-10, NQ-22, ND-01, ND-04, INF-05입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/context.ts` | 생성합니다. | ProjectScope/SrScope·Actor 입력·WriteGuard·VersionRef/BundleRef입니다. |
| `src/contracts/results.ts` | 생성합니다. | Committed/Replayed/Rejected·DomainError·receipt DTO입니다. |
| `src/contracts/methods.ts` | 생성합니다. | M-001부터 M-050까지 입력/출력 타입과 공개 44개 목록입니다. |
| `src/contracts/schemas.ts` | 생성합니다. | JSON schema와 명령별 필수 guard·요청 상한입니다. |
| `src/contracts/views.ts` | 생성합니다. | 조회·문서·Run·검토·인계 화면의 wire DTO입니다. |
| `tests/contract/public-methods.test.ts` | 생성합니다. | 내부 6개 계약 비노출·명령 schema/guard 누락을 검사합니다. |
| `src/providers/generation/provider-contract.ts` | 생성합니다. | GenerationProvider와 ProviderRequest/결과의 provider 독립 계약입니다. |

**인터페이스와 입력 조건**

PublicMethodId와 InternalMethodId를 분리합니다. Methods[M]은 승인 component-methods의 input·output을 연결합니다. srId와 projectId는 wire에서 함께 받고 서버가 소속을 재확인합니다. CommandResult<T>의 kind는 Committed/Replayed/Rejected이며 조회·현재 유효성·이전 receipt를 합치지 않습니다. 시각·역할·실행 token은 서버에서만 만듭니다.

src/providers/generation/provider-contract.ts도 여기서 먼저 정의합니다. GenerationProvider.generate(ProviderRequest,ExecutionControl): Promise<ProviderOutcome>와 provider 독립 입력·초안/실패·제어·관찰 타입을 승인 C-06 경계로 구체화합니다. DB·RuntimeContext·HTTP 주체를 넘기지 않습니다. CG-12는 이 타입으로 C-05 루프를 구현하고 CG-13은 같은 계약의 실제 adapter를 구현합니다.

- [ ] **Step 007: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, test } from 'vitest';
import { PUBLIC_METHOD_IDS } from '@/src/contracts/methods';

test('내부 실행 계약 여섯 개를 공개하지 않는다', () => {
  expect(PUBLIC_METHOD_IDS).toHaveLength(44);
  for (const method of ['M-036', 'M-037', 'M-038', 'M-039', 'M-049', 'M-050']) {
    expect(PUBLIC_METHOD_IDS).not.toContain(method);
  }
});
```

- [ ] **Step 008: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/contract/public-methods.test.ts
```

예상 결과는 다음과 같습니다. 공개 계약 목록 구현 전 테스트가 실패합니다. 내부 6개를 공개로 추가한 변형도 실패해야 합니다.

- [ ] **Step 009: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

승인된 50행에서 서비스 이름·메서드 이름·필수 입력·결과를 하나의 명시 등록표로 옮깁니다. 조건부 필드는 ENT 정의와 WriteGuard 매핑으로 구체화하고 타입과 runtime schema를 같은 테스트로 검사합니다. 아래 구분을 results.ts에 사용합니다.

```ts
export type CommandResult<T> =
  | { kind: 'Committed'; value: T; receipt: CommandReceipt }
  | { kind: 'Replayed'; value: T; receipt: CommandReceipt; current: CurrentBasis }
  | { kind: 'Rejected'; error: DomainError; priorReceipt?: CommandReceipt };
```

CommandReceipt·DomainError는 승인 공통 계약을 그대로 타입화합니다. CurrentBasis는 현재 revision과 해당 대상의 현재 유효성·허용 행동이며 receipt의 과거 값으로 채우지 않습니다. 텍스트 코드를 eval하거나 임의 서비스 이름으로 dispatch하지 않습니다.

- [ ] **Step 010: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/contract/public-methods.test.ts
```

통과 조건은 다음과 같습니다. 50개 메서드가 고유하고 공개44/내부6이 분리됩니다. 각 명령 schema에 필요한 scope·guard·enum·크기·미지원 필드 거절 검증이 통과합니다.

- [ ] **Step 011: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 012: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

후속 task가 같은 DTO·서비스 반환을 사용합니다. wire DTO에 DB 핸들·RuntimeContext·ClaimRef token을 포함하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

