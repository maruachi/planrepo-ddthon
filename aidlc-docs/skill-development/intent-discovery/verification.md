# intent-discovery 검증 결과

독립 스킬을 작성하고 개인 스킬 폴더에 설치했습니다. 스킬 파일 두 개가 테스트한 원본과 byte 단위로 일치합니다. PlanRepo 제품 코드·기존 요구사항·AI-DLC 원본·프로젝트 시작 규칙은 이번 작업에서 변경하지 않았습니다.

## 산출물

- 스킬 원본은 `aidlc-docs/skill-development/intent-discovery/skill/SKILL.md`입니다.
- UI 정보는 `aidlc-docs/skill-development/intent-discovery/skill/agents/openai.yaml`입니다.
- 사용법은 `aidlc-docs/skill-development/intent-discovery/usage.md`입니다.
- 계획과 실행 체크리스트는 `aidlc-docs/skill-development/intent-discovery/plan.md`입니다.
- 설치 위치는 Codex 개인 스킬 폴더 아래 `intent-discovery/`입니다.
- 스킬 본문의 SHA-256은 `2a5375115200c6d4ccb39698664d291f30d9398172d995002d034a3ce040bd23`입니다.

## RED·GREEN과 독립 검토

| 검증 | 결과 | 근거 |
|---|---|---|
| 스킬 없는 대조군 | 3/5 PASS입니다. | S2·S3의 원문·확인 근거 및 인계 경계가 부족했습니다. |
| 같은 시나리오의 새 적용군 | 5/5 PASS입니다. | 원문·의도·확인 버전·미결정·인계 경계를 유지했습니다. |
| 독립 결과 검토 | 실제 중요한 실패가 없습니다. | JSON 10개와 사용자 원문 11개를 대조했습니다. |
| 선택지 맥락 추가 검증 | PASS입니다. | “B로 할게”를 원 질문·선택지·현재 확인과 연결했습니다. |
| 저장 문서만 읽은 새 세션 재개 | PASS입니다. | 기존 결정을 유지하고 지정 권한의 미결정부터 질문했습니다. |
| 5턴 모의 인터뷰 | 5턴 모두 기준에 맞습니다. | 탐색 두 턴, 보류, 재개 후 확인 대기, 현재 버전 확인·인계를 실행했습니다. |

대조군과 적용군은 각각 다섯 독립 에이전트의 단일 응답입니다. root가 모든 답변과 문서 내용을 직접 읽었습니다. 대조군 실패를 확인한 뒤 스킬 본문을 작성했습니다. 상세 비교는 `aidlc-docs/skill-development/intent-discovery/tests/comparison.md`에 있습니다.

독립 검토는 선택형 답변의 질문 맥락 보존을 잠재적 공백으로 제기했습니다. 추가 대화에서 맥락이 보존돼 실패를 재현하지 못했습니다. 관찰된 실패 없이 규칙을 더 늘리지 않았습니다. 검토와 후속 결과는 `aidlc-docs/skill-development/intent-discovery/tests/independent-review.md`, `aidlc-docs/skill-development/intent-discovery/tests/followup-review.md`에 있습니다.

## 여러 턴의 실행

가상 독서모임 요구로 인터뷰를 시작했습니다. 매 턴 실제 에이전트 응답을 받은 뒤 다음 가상 사용자 입력을 전달했습니다. 에이전트가 미래 사용자 답변을 대신 작성하지 않았습니다.

1. 현재 관리 방식과 불편을 질문했습니다. 상태는 `exploring`입니다.
2. 운영자 역할·실물별 책 식별·중복 대여 거절·제외 범위를 반영하고 대여자 식별 방법을 질문했습니다. 상태는 `exploring`입니다.
3. 사용자가 중단하자 질문 없이 `paused`로 보관했습니다.
4. 재개 답변에서 별명·열람 범위를 반영하고 현재 v0.4를 보여줬습니다. 상태는 `awaiting_confirmation`입니다.
5. v0.4 확인을 받아 `confirmed`로 기록하고 AI-DLC 입력을 작성했습니다. 기술과 새로 발견한 보존 기간 정책은 미결정·후속 검토로 남겼습니다.

원문은 `aidlc-docs/skill-development/intent-discovery/tests/live/turn-01.json`부터 `aidlc-docs/skill-development/intent-discovery/tests/live/turn-05.json`까지 보존했습니다. 각 턴 문서에서 그때까지의 사용자 원문을 모두 찾았습니다. 마지막 응답은 재확인을 요구하지 않았습니다. 의도서와 인계서의 예시 본문은 결과 JSON의 `documents`에 있으며, 실제 독서모임 서비스를 만들거나 별도 프로젝트 상태를 바꾸지 않았습니다.

## 실행한 형식·설치 검증 명령

프로젝트 루트에서 다음 명령을 실행했습니다.

```sh
uv run --with PyYAML python "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py" aidlc-docs/skill-development/intent-discovery/skill
```

결과는 exit 0이며 `Skill is valid!`입니다.

```sh
uv run --with PyYAML python "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py" "${CODEX_HOME:-$HOME/.codex}/skills/intent-discovery"
```

결과는 exit 0이며 `Skill is valid!`입니다.

```sh
diff -r aidlc-docs/skill-development/intent-discovery/skill "${CODEX_HOME:-$HOME/.codex}/skills/intent-discovery"
```

결과는 exit 0이며 차이가 없습니다.

MarkdownIt과 PyYAML로 본문·frontmatter·UI YAML을 파싱했습니다. UI 설명 길이, 명시 호출 예시, 자동 발견 설정을 검사했습니다. JSON fixture·응답을 파싱했고 여러 턴의 현재 상태와 누적 원문 보존을 검사했습니다. 설치는 기존 경로가 없음을 확인한 뒤 파일 두 개만 복사했습니다.

처음 시스템 Python과 번들 Python의 PyYAML import가 실패했습니다. `uv run --with PyYAML --with markdown-it-py python`의 격리 실행 환경으로 해결했습니다. 제품 의존성이나 전역 Python 환경은 수정하지 않았습니다.

## 범위와 한계

- 사례 기반 관찰입니다. 의도 전달률 100%나 모든 대화에서의 완벽한 동작을 증명하지 않습니다.
- 동일 상황을 여러 모델에서 통계적으로 반복한 실험은 아닙니다. 다른 다섯 상황을 각각 한 번씩 비교했습니다.
- 실제 Codex 새 대화의 UI 노출·자동 스킬 선택은 이번 도구 실행으로 확인하지 않았습니다. 개인 스킬 위치의 파일과 명시적 스킬 적용 행동을 검증했습니다.
- 기존 프로젝트의 자동 진입 순서는 변경하지 않았습니다. 사용법에서 명시 호출과 필요한 프로젝트별 연결을 설명했습니다.
- 애플리케이션 코드를 변경하지 않아 PlanRepo 빌드·제품 테스트·실제 Claude 제품 호출은 실행하지 않았습니다.
- Git remote가 없어 외부 push나 PR을 만들지 않았습니다. 별도 commit도 만들지 않았습니다.
