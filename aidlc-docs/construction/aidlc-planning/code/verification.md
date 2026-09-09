# U2 검증 결과

2026-09-09 검증. 실제 사용자 DB 대신 OS 임시 디렉터리의 SQLite를 사용했다.

| 검증 | 결과 |
|---|---|
| npm test | 18개 파일, 총 66개 통과 (기존 U1 31개 포함) |
| npm run typecheck | 클라이언트·서버·테스트 통과 |
| npm run build | React/Vite 및 Node 서버·워커 빌드 통과 |
| CLI 어댑터 | 출력 형식/중복/상한/실패/취소/종료 테스트 8개 통과 |
| 정책·문맥·서비스·마이그레이션 | 15개 통과, 9단계 승인/회차/질문/충돌/복구/v1 보존 포함 |
| UI 상태 | 9개 통과, 응답 유실/원래 Run 확인/명시적 새 시도 포함 |
| HTTP | 3개 통과, 실제 Express/DB/연결 파괴/중복 실행 방지/입력·소속 검증 |
| 실제 Claude 인증 호출 | 사용자 설정 사용 수정 후 structured_output 성공 |
| 실제 앱 생성·저장·열람 | 1개 문서 성공, DB의 runId 일치, 실제 브라우저 열람 확인 |

독립 검토에서 승인 확인과 문맥 수집 사이의 편집 경합을 발견해 승인 버전 전제를 트랜잭션에 추가했다. 문맥에 logicalKey가 누락되는 문제를 수정하고 재생성 시 기존 키를 전달한다. 새 결과로 전체 문서 수 상한을 넘지 않도록 검사한다.

첫 실제 앱 호출은 CLI_FAILED로 끝나 문서 0개, 성공 상태가 아님을 확인했다. 원인은 기존 third-party 인증이 사용자 설정에 있는데 --setting-sources 빈 값으로 이를 제외한 호출이다. user로 수정하고 도구·훅·프로젝트 설정 제한을 유지했다. 같은 옵션의 최소 실제 JSON 호출과 전체 앱 생성이 성공했다. 인증 값과 원시 진단 출력은 문서/로그에 기록하지 않는다.

실제 성공 SR: 606527a1-06d3-41b7-83cf-74013edf73e6. Run: 01271c36-7efd-48cc-b72f-5391415a02f5. 결과: succeeded, 문서 1개, 질문 0개. 임시 DB는 /var/folders/sl/_cj854550hz43z0tzd13kjw00000gn/T/planrepo-u2-TFj3UZ/runtime.sqlite다. 원시 요약 /private/tmp/planrepo-u2-live-result.json, 화면 /private/tmp/planrepo-u2-real-document.png. 임시 증거는 OS 정리 시 사라질 수 있다.

Browser 스킬의 연결·문서화된 복구·가용 목록 확인에서 연결된 브라우저가 없었다. 설치된 Playwright와 독립 Chrome for Testing 임시 프로필을 사용했다. 사용자 프로필/인증 저장소는 사용하지 않았다. 화면 테스트는 별도 준비 결과로 질문 응답, 키보드 생성/조회, 수정 요청/승인/다음 단계/회차, 독립 문서·계획 초안, 저장 후 응답 유실 확인, 390px 가로 넘침을 검증했다. pageerror는 0개. 별도 실제 생성 문서 열람도 확인했다.

화면 준비 결과는 실제 CLI 성공 근거로 사용하지 않았다. 화면 증거 디렉터리: /var/folders/sl/_cj854550hz43z0tzd13kjw00000gn/T/planrepo-u2-browser-mhY9iX. 데스크톱/모바일 스크린샷을 직접 확인했다.

비활성 Security/Resiliency/PBT 확장은 모두 N/A. 실제 U3 리뷰·수동 완료 및 전체 Build and Test는 다음 단위에서 수행한다. 운영 부하/고가용성/전체 브라우저 호환성을 검증했다는 주장은 없다.
