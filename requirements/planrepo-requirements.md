# 문제 정의
SR 개발 진행 시에 aidlc를 쓰더라도 “git, claude 세션, jira” 등 다양한 업무툴을 활용하여 진행해야 하는 불편함이 있다.

# PlanRepo 목적
AI DLC PlanRepo를 사용하면 하나의 UI 내에서 AL DLC 구현 전 모든 플랜 문서 과정(inception -> construction)을 모두 편리하게 진행할 수 있다.
AI DLC와 git 종속성을 분리한다.
피어 리뷰를 원래는 코드 구현 레벨 진행을 했지만, aidlc 워크플로우에서는 검토에 대한 영역이 Inception으로 이동하기 때문에 피어 리뷰를 인셉션 단계로 진행한다.
기본적으로 명세는 코드 구현부보다 읽을 것이 적다.

# 전체 흐름
칸반보드 각 상태 정의
SR 목록: SR 생성 직후
요구사항 분석: 유저가 초기 상태의 처리 단위를 다음단계로 진행할 하면 aidlc와 코드 에이전트의 조합으로 문서 생성 단계를 진행한다.
Inception [3]
  - staged 진행 횟수만큼 표현
Construction [2]
  - staged 진행 횟수만큼 표현
Peer Review (Inception, Construction)
유저가 원하는 시점에 리뷰를 요청할 수 있다.
구현 대기
구현 완료
