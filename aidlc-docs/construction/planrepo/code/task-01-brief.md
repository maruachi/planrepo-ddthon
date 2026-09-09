# CG-01 구현 지시서

이 문서는 승인된 `aidlc-docs/construction/plans/planrepo-code-generation-plan.md`의 CG-01을 실행하기 위한 발췌입니다. 정확한 값과 경계는 아래 과제와 INF-03을 따릅니다. 기본 작업 폴더는 현재 프로젝트 루트입니다.

### CG-01 프로젝트 도구·루트 설정과 격리된 테스트 실행기

**구현 묶음**: B-01입니다. **선행**: 없습니다.

**연결 기준**: SCN-24, NQ-04, NQ-17, NQ-23, NQ-24, ND-13, INF-01, INF-02, INF-03, INF-09입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `package.json` | 생성합니다. | Node engine·정확한 의존성과 승인 CMD-01부터 CMD-12의 scripts입니다. |
| `package-lock.json` | 생성합니다. | 선택한 호환 버전과 설치 결과를 고정합니다. |
| `.gitignore` | 생성합니다. | node_modules·dist·.planrepo·테스트 결과를 제외합니다. |
| `tsconfig.json` | 생성합니다. | 공통 strict·별칭 설정입니다. |
| `tsconfig.server.json` | 생성합니다. | 서버와 명령 스크립트의 TypeScript 검사·빌드 범위입니다. |
| `tsconfig.web.json` | 생성합니다. | 브라우저 전용 DOM 타입·검사 범위입니다. |
| `vitest.config.ts` | 생성합니다. | unit/contract/integration 테스트와 명시 test mode입니다. |
| `vite.config.ts` | 생성합니다. | 5173 strictPort·정적 경계·4173 proxy입니다. |
| `config/planrepo.json` | 생성합니다. | INF-03의 기본 JSON을 그대로 구현합니다. |
| `src/runtime/config.ts` | 생성합니다. | RuntimeConfig·루트·환경 override·포트 검증입니다. |
| `src/runtime/paths.ts` | 생성합니다. | 프로젝트 내부 realpath와 경로 탈출 검사입니다. |
| `tests/helpers/root-fixture.ts` | 생성합니다. | createRootFixture(): {root:string;remove():void}로 빈 임시 프로젝트를 만들고 정리합니다. |
| `tests/unit/runtime-paths.test.ts` | 생성합니다. | 루트 이동·상위/절대경로·symlink 탈출·test DB 중첩 거절을 검사합니다. |
| `src/web/env.d.ts` | 생성합니다. | 브라우저 전용 타입 선언이며 서버 타입을 전역으로 노출하지 않습니다. |

**인터페이스와 입력 조건**

resolveProjectPath(root: string, configuredPath: string): string은 존재하는 가장 가까운 조상까지 realpath를 확인하고 루트 안의 정상 경로만 반환합니다. loadRuntimeConfig(root: string, env: Record<string,string | undefined>): RuntimeConfig는 INF-03 JSON schema·허용 override를 검사합니다. 루트 fixture는 테스트가 소유한 경로만 정리합니다. 코드 별칭 @는 프로젝트 루트로 정하고 앱·Vitest·TS·Vite의 해석을 일치시킵니다.

- [ ] **Step 001: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, test } from 'vitest';
import { resolveProjectPath } from '@/src/runtime/paths';
import { createRootFixture } from '@/tests/helpers/root-fixture';

test('설정 경로로 프로젝트 바깥을 선택하지 못한다', () => {
  const fixture = createRootFixture();
  try {
    expect(() => resolveProjectPath(fixture.root, ['..', 'outside'].join('/'))).toThrow();
  } finally { fixture.remove(); }
});
```

- [ ] **Step 002: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/unit/runtime-paths.test.ts
```

예상 결과는 다음과 같습니다. 테스트 실행기와 import 가능한 최소 모듈을 준비한 뒤 루트 밖 경로 거절 assertion이 실패하는지 확인합니다. 미구현 모듈의 import 오류·npm 자체 미설치·설정 파싱 오류는 행동 RED로 세지 않습니다.

- [ ] **Step 003: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

도구 설정은 행동 구현 전 준비합니다. npm view로 각 패키지의 version·engines·peerDependencies를 읽고 현재 Node 22.23.2와 Fastify 5의 호환성을 확인한 정확한 버전만 --save-exact로 설치합니다. manifest/lockfile을 함께 생성하며 native module과 Chromium 준비 조건을 기록합니다. 프로젝트 밖 경로·NUL·상위 성분·symlink 탈출을 검사한 뒤 INF-03 값을 검증합니다. 일반 실행에 테스트 경로를 허용하는 암묵 fallback을 두지 않습니다.

```ts
const segments = configuredPath.split(/[\\/]/u);
if (segments.includes('..') || configuredPath.includes('\0')) {
  throw new Error('프로젝트 내부 경로만 사용할 수 있습니다.');
}
```

이 검사는 paths.ts 함수의 첫 검사입니다. 이어 isAbsolute·realpath 경계를 검사하며 문자열 prefix만으로 경계를 판정하지 않습니다. 성공 뒤 npm run typecheck로 서버/브라우저 분리를 확인합니다.

- [ ] **Step 004: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/unit/runtime-paths.test.ts
```

통과 조건은 다음과 같습니다. 정상 내부 경로·새 루트 재배치·탈출 거절·testRunId 누락과 사용자 DB 중첩 거절이 통과합니다.

- [ ] **Step 005: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 006: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

프로젝트 도구로 Vitest와 타입 검사를 실행하고 INF-03 기본 설정을 파싱합니다. 실제 Claude는 호출하지 않습니다. 승인된 전체 package script 중 구현 전 명령은 성공으로 위장하지 않으며 소유 task에서 실제 파일을 연결합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

