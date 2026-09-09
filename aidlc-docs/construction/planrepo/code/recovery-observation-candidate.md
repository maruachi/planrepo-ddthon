# macOS 복구 관찰 후보

이 기록은 CG-14 구현 준비 자료입니다. 현재 구현이나 NQ-21 통과를 주장하지 않습니다. 검토 환경은 macOS 26.6.2, Darwin 25.6.0, arm64입니다.

## 확인한 관찰 수단

현재 SDK와 자기 소유의 자연 종료 프로세스로 PROC_PIDTBSDINFO, KERN_PROC_PID/PGRP, 연속 관찰 중 kqueue NOTE_EXIT를 검사했습니다. 모두 exit 0이었습니다. PID와 microsecond 시작 시각, PGID, UID 및 host/boot를 함께 읽을 수 있었습니다. private 숫자 flavor인 PROC_PIDUNIQIDENTIFIERINFO의 ABI를 복제하지 않습니다.

작은 exec-gate에서 GO 뒤 exec해도 PID·시작 시각·PGID가 유지됐습니다. GO 없이 writer를 닫으면 대상 프로그램을 exec하지 않고 종료했습니다. 실제 Claude·앱 crash·reboot는 이 조사에서 실행하지 않았습니다. signal이나 전역 설정 변경도 하지 않았습니다.

## 후보와 한계

identity를 DB에 확정한 뒤 GO를 보내는 gate는 Claude가 시작되기 전 기준을 저장하는 후보입니다. 하지만 gate 자체가 생성됐다는 사실과 Claude를 아직 exec하지 않았다는 사실은 구분해야 합니다. GO가 없었다는 이유만으로 모든 자손이 종료됐다고 기록하지 않습니다. 실제 종료 관찰과 검증한 launch protocol의 범위를 따로 증명해야 합니다.

libproc와 KERN_PROC 정보는 Apple 소스의 private/SPI 범위입니다. 채택하려면 지원 OS·SDK 범위와 반환 길이·권한·동시 변화 검사를 구체화하고 실패를 Unknown으로 처리해야 합니다. 시작 시각 기반 세대 판정을 근거 없이 완전한 커널 고유 identity로 표현하지 않습니다.

kqueue는 crash 뒤 사라지므로 재시작 복구 증거가 아닙니다. macOS의 NOTE_TRACK/NOTE_CHILD는 지원되지 않습니다. 부모 사망 후 현재 parent 관계만으로 원래 자손을 복원할 수 없습니다. direct PID 부재와 빈 PGID만으로 setsid/setpgid로 벗어난 자손의 부재를 입증하지 않습니다.

## 자식 프로세스 생성 제한 후보

자기 소유 Node 프로세스를 `/usr/bin/sandbox-exec`의 `(version 1) (allow default) (deny process-fork)` 안에서 실행했습니다. 그 Node가 자기 executable로 spawnSync를 호출하면 childError=EPERM, childStatus=null이었고 대상 자식의 출력은 없었습니다. wrapper는 exit 0, stderr는 빈 값이었습니다. 5초 timeout과 4 KiB 출력 상한을 둔 제한 실험입니다. Claude·전역 설정·제품 profile은 이 실험에서 변경하지 않았습니다.

로컬 `sandbox-exec(1)` 문서는 이 명령을 DEPRECATED로 표시합니다. Apple의 현재 공개 fork1 구현은 fork와 spawn 분기 전에 `mac_proc_check_fork`의 거절 결과를 검사합니다. 이는 관찰한 생성 제한을 설명하는 근거이며 이 Mac의 모든 프로세스 생성 경로를 완전히 검증했다는 뜻은 아닙니다. [Apple fork1 구현](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/kern/kern_fork.c), [Apple MAC process 검사](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/security/mac_process.c).

이 후보는 원 실행 범위를 제한하는 방법을 검토하기 위한 자료입니다. 실제 Claude가 기존 provider 인증·모델 선택을 유지한 채 동작하는지, credential helper나 XPC를 포함한 외부 실행 위임이 있는지, 초기 launcher와 exec-gate의 범위를 어떻게 입증하는지는 아직 검증하지 않았습니다. 일반 fork·posix_spawn·vfork와 새 세션을 만드는 자손 시도도 별도 실제 검사가 필요합니다. 한 번의 EPERM만으로 no_process_created나 NQ-21 통과를 기록하지 않습니다. 지원하지 않거나 실행 환경이 달라지면 현재 Unknown·slot 보존 규칙을 유지합니다.

실제 사용한 Node 실험은 다음과 같습니다. 제품 코드가 아닌 재현 자료입니다.

```js
import { spawnSync } from 'node:child_process';
const program = `import {spawnSync} from 'node:child_process';const child=spawnSync(process.execPath,['-e','process.stdout.write("OWN_CHILD_STARTED")'],{encoding:'utf8',timeout:2000});process.stdout.write(JSON.stringify({childStatus:child.status,childError:child.error?.code,childOutput:child.stdout}));`;
const r = spawnSync('/usr/bin/sandbox-exec', [
  '-p', '(version 1) (allow default) (deny process-fork)',
  process.execPath, '--input-type=module', '-e', program,
], { encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
console.log(JSON.stringify({
  probe: 'owned_node_no_fork_candidate', status: r.status,
  signal: r.signal, error: r.error?.code, stdout: r.stdout, stderr: r.stderr,
}, null, 2));
```

위 코드를 `node --input-type=module`의 stdin으로 실행했습니다. 명령 exit 0과 wrapper status 0, childError EPERM을 확인했습니다.

## 구현 전 확인 조건

- claim·launch intent·identity commit·GO·exec·terminal commit·M-050 사이의 각 crash 지점을 검증합니다.
- FD 상속·partial GO·exec 실패·helper 교체·버퍼 포화·권한 실패·PID/PGID 재사용을 검사합니다.
- 원 실행과 helper의 실제 종료, scope를 벗어난 자손 가능성을 구분합니다.
- host/boot 미확인·DB 사본·VM restore·실제 reboot의 근거를 분리합니다.
- 현재 승인된 Unknown 유지와 slot 보존을 기본값으로 유지합니다. native 후보를 채택하거나 NQ-21 판정을 바꾸려면 실제 제품 연결과 장애 검증이 필요합니다.

## 근거

- [Apple process 정보 선언](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info.h)
- [Apple process 정보 구현](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/proc_info.c)
- [Apple fork 생성 정보](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_fork.c)
- [Apple kqueue process 필터](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_event.c)
- [Apple KERN_PROC 구현](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sysctl.c)
