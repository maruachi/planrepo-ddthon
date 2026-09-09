# Functional Design Plan — Unit U1: planrepo-mockup

> 표준 승인 위임(2026-09-08)으로 아래 설계 질문은 제품 오너 권장안으로 자동 채택([Answer] 기록).
> 단위 컨텍스트: Units Generation은 SKIP(단일 유닛). 컨텍스트 근거 = `../../inception/plans/execution-plan.md`(U1) + `../../inception/application-design/*`.

## 범위
클라이언트 전용(서버 없음) 목업의 **비즈니스 로직·도메인·규칙·프런트엔드 컴포넌트**를 기술 무관 수준으로 확정 → Code Generation 입력.

## 산출물 체크리스트 (Step 6)
- [x] `planrepo-mockup/functional-design/domain-entities.md` — §11 7엔티티 클라이언트 도메인
- [x] `planrepo-mockup/functional-design/business-logic-model.md` — 상태 머신·알고리즘(답변/버전/수정요청/게이트/AI/파서)
- [x] `planrepo-mockup/functional-design/business-rules.md` — 검증·제약·정책 규칙 + AC 매핑
- [x] `planrepo-mockup/functional-design/frontend-components.md` — 컴포넌트 계층·props/state·상호작용·검증(셸+4변형)

## 설계 질문 (권장안 자동 채택)

### Q-FD1. 상태 관리 방식
- A) 프레임워크 없는 단일 인메모리 스토어 + pub/sub 구독 (권장)
- B) 컴포넌트 지역 상태 분산
- X) 기타
- [Answer]: A — 단일 파일 자기완결(NFR-SELF-1)·재현성·새로고침 초기화(MK-6)에 가장 단순. `store` 모듈 단일 트리.

### Q-FD2. 버전 생성 트리거
- A) 답변 **확정** 시 문서 Answer 갱신 + 새 버전 생성; 미확정 제안(저장)은 초안·버전 미생성 (권장)
- B) 저장 시마다 버전 생성
- X) 기타
- [Answer]: A — requirements §8 가정과 일치(FR-VER-2). 저장≠확정≠승인 분리(AC-2) 보존.

### Q-FD3. 파서 충실도 (Q2=C 하이브리드 재확인)
- A) 구조화 시드가 기본, 소수 원본 Markdown 예시에만 `[Answer]` 파서/검증 경로 적용 (권장)
- B) 전체 문서를 Markdown 파싱
- X) 기타
- [Answer]: A — 범용 파서는 범위 밖(§6). AC-1(지정 Answer만 치환)·AC-12(오류 위치) 시연에 충분.

### Q-FD4. 게이트 평가 시점
- A) 파생(순수 함수) — 관련 상태 변경 시 `gateService.evaluate`로 매번 재계산, 별도 저장 없음 (권장)
- B) 게이트 상태를 엔티티에 저장·동기화
- X) 기타
- [Answer]: A — 무결성(단일 진실원)·재현성. 미충족 조건 목록을 항상 최신으로 노출(FR-GATE-*).

### Q-FD5. AI 실행 상태 표현 (표시만)
- A) 시드로 대표 상태(추가 답변 대기·중단·재개 등)를 심고, 상호작용은 안전장치(미저장 차단·중복 차단·입력 변경 초안) 위주 시뮬레이션 (권장)
- B) 타이머로 실제 진행 애니메이션
- X) 기타
- [Answer]: A — §3 실제 실행 없음. AC-3/9/10을 정적 시드 + 최소 상호작용으로 표현(FR-AI-*).

### Q-FD6. 4변형 상태 공유
- A) 4변형이 **동일 store·서비스** 공유, 배치만 상이 (권장)
- B) 변형별 상태 분리
- X) 기타
- [Answer]: A — "정보 배치만이 비교 변수"(NFR-VIS-1) 보장. 한 변형의 행동 결과가 다른 변형에서도 일관.

## 검증 (자체)
- [x] §12 AC-1..12 각각을 로직/규칙/컴포넌트로 매핑(business-rules.md 표)
- [x] 4변형이 네 행동·세 게이트·버전 고정 승인·수정 요청 라이프사이클·파서 오류·색 비의존 상태를 모두 표현
- [x] 확장 없음 → 차단 findings 없음
