export const PLAN_VISUALIZATION_PROMPT = `문서 Markdown 맨 끝에 다음 형식의 시각화 자료를 HTML comment로 추가하세요.
<!-- planrepo-visualization
{
  "schemaVersion": 1,
  "overview": {
    "headline": "Plan의 핵심을 설명하는 짧은 제목",
    "summary": "Plan 전체를 요약한 설명",
    "evidence": { "sectionId": "요구사항", "quote": "해당 section 본문에 실제로 있는 문구" }
  },
  "changes": {
    "before": [],
    "after": ["Plan으로 달라지는 상태"],
    "evidence": { "sectionId": "진행 계획", "quote": "해당 section 본문에 실제로 있는 문구" }
  },
  "nodes": [
    {
      "id": "node-1",
      "kind": "action",
      "title": "사용자가 이해할 수 있는 단계",
      "detail": "이 단계에서 일어나는 일",
      "evidence": { "sectionId": "사용자 시나리오", "quote": "해당 section 본문에 실제로 있는 문구" }
    },
    {
      "id": "node-2",
      "kind": "result",
      "title": "사용자가 얻는 결과",
      "detail": "이 흐름이 끝난 뒤의 상태",
      "evidence": { "sectionId": "사용자 시나리오", "quote": "해당 section 본문에 실제로 있는 문구" }
    }
  ],
  "edges": [
    {
      "from": "node-1",
      "to": "node-2",
      "label": "다음 단계로 이어지는 조건이나 관계",
      "evidence": { "sectionId": "주요 구조", "quote": "해당 section 본문에 실제로 있는 문구" }
    }
  ],
  "scenarios": [
    {
      "id": "scenario-1",
      "label": "상황 이름",
      "description": "사용자가 겪는 상황과 흐름",
      "nodeIds": ["node-1"],
      "outcome": "흐름의 결과",
      "evidence": { "sectionId": "사용자 시나리오", "quote": "해당 section 본문에 실제로 있는 문구" }
    }
  ],
  "rules": [
    {
      "id": "rule-1",
      "title": "지켜야 할 약속",
      "detail": "조건, 성공 기준 또는 예외",
      "category": "requirement",
      "evidence": { "sectionId": "요구사항", "quote": "해당 section 본문에 실제로 있는 문구" }
    }
  ]
}
-->

시각화 자료는 상황별 흐름, 화면, 지켜야 할 약속과 예외를 Plan의 확인된 내용만으로 표현하세요.
evidence.sectionId는 '요구사항', '사용자 시나리오', '진행 계획', '주요 구조', '주요 결정', '작업 단위' 중 하나여야 합니다.
evidence.quote는 HTML comment를 제외한 해당 section 본문에 그대로 있는 4글자 이상의 정확한 일부여야 합니다.
근거가 없는 관계, 조건, 성공 기준, 예외를 만들지 마세요.
기존 상태가 확인되지 않으면 changes.before는 빈 배열로 두세요.
구체적인 화면 문구를 사용자가 제공하지 않았다면 screen을 생략하세요. 화면을 제안해야 한다면 해당 section 본문에 반드시 '제안'이라고 표시한 문구를 먼저 쓰고 그 문구를 evidence.quote로 인용하세요.
scenario.screen을 쓸 때는 { "title": string, "body": string, "status": string 선택, "primaryAction": string 선택, "evidence": evidence } 구조를 지키세요.
node.kind는 'action', 'condition', 'result' 중 하나이고 rule.category는 'requirement', 'success', 'exception' 중 하나입니다.
nodes는 최대 12개, edges는 최대 18개, scenarios는 최대 6개, rules는 최대 12개입니다.
모든 node ID는 고유해야 하고 edge와 scenario.nodeIds는 실제 nodes의 ID만 참조해야 합니다.
JSON 문자열의 따옴표, 줄바꿈과 특수 문자를 올바르게 escape하세요.
이 시각화는 Plan을 설명하는 자료이며 실제 실행 결과나 측정 결과가 아닙니다.`;
