// Plan 리뷰 탭의 예시 데이터 (프론트 전용, 백엔드/실시간 AI 호출 없음).
// "Inception 단계에서 사용자가 모든 질문에 답해 확정한 결과"를 리뷰 대상으로 제시한다.
// 각 리뷰는 Workspace 칸반보드의 Inception 컬럼에 있는 SR 하나와 제목으로 매칭된다
// (scripts/seed-inception.ts 로 시드되는 SR 들과 title 이 일치).

export type ReviewDecision = {
  id: string;
  topic: string; // 짧은 주제 (뱃지/제목용)
  question: string; // 사용자가 확인받은 질문
  choice: string; // 사용자가 최종 선택한 보기
  rationale: string; // 그 선택을 뒷받침하는 근거
  caution?: string; // 리뷰어가 특히 확인하면 좋을 지점 (선택)
};

export type InceptionReview = {
  key: string; // 로컬 안정 키
  title: string; // 매칭되는 SR 제목 (보드 Inception 카드와 동일)
  hasIcon: boolean; // true 면 칸반 카드에 리뷰 아이콘을 달고 Plan 리뷰 목록에 노출한다
  aiSummary: string; // AI 요약 (간단)
  decisions: ReviewDecision[]; // 확정된 결정들
};

export const INCEPTION_REVIEWS: InceptionReview[] = [
  {
    key: 'espec-upload',
    title: 'eSPEC 첨부파일 업로드 오류 조회/재처리 기능',
    hasIcon: true,
    aiSummary: 'eSPEC 첨부파일 업로드 오류(FILE_UPLOAD_DTTM 누락) 건을 운영자가 조회하고 재처리하는 기능입니다. 기존 시스템을 재사용하고 신규 테이블 없이 로그 중심으로 최소 침습적으로 설계합니다. 재처리는 파일 1건 단위로 운영 역할에게만 허용합니다.',
    decisions: [
      {
        id: 'source-code',
        topic: '코드 제공 방식',
        question: '기존 코드베이스를 어떻게 제공하는지',
        choice: '기존 코드베이스를 워크스페이스로 복사·체크아웃해 제공',
        rationale: '기존 Vue/Spring 시스템을 재사용·수정하는 기능이라, 실제 코드를 보고 설계해야 경로·시그니처가 어긋나지 않는다.',
      },
      {
        id: 'retry-granularity',
        topic: '재처리 단위',
        question: '재처리를 어떤 단위로 수행하는지',
        choice: '파일 1건 단위 재처리 (행마다 재처리 버튼)',
        rationale: 'API 가 파일 1건 단위라 우선 단순하게 맞추고, 다건 수요가 확인되면 일괄 처리를 얹는다.',
      },
      {
        id: 'authorization',
        topic: '권한 판별',
        question: '운영 권한을 무엇으로 판별하는지',
        choice: '조회는 로그인 사용자 전체 허용, 재처리(POST)만 운영 역할로 제한',
        rationale: '조회는 넓게 열고 위험한 변경만 잠그는 실무 표준. 판별은 역할(Role) 코드 기반으로 한다.',
      },
      {
        id: 'query-bounding',
        topic: '조회 조건 강제',
        question: '운영 DB 부하 방지를 위해 조회 조건을 얼마나 강제하는지',
        choice: '등록일자(기간) 입력 필수 + 페이징',
        rationale: '"운영 DB 부하 방지"가 목적이라면 기간 필수가 가장 확실하게 부하를 막는다.',
      },
      {
        id: 'source-file-access',
        topic: '원본 접근',
        question: '오류 건의 원본을 재처리 때 어디서 읽어오는지',
        choice: '파일 재전송 없이 후처리(메타 기록)만 재수행',
        rationale: '증상이 FILE_UPLOAD_DTTM 만 누락이라면 파일은 최종 저장소에 있고 메타만 빠졌을 가능성이 크다.',
        caution: '실제 데이터에서 "파일은 존재하고 메타만 누락"이 맞는지 표본 확인이 필요합니다. 반례가 있으면 옵션 C(존재 확인 후 실패 처리)로 재검토하세요.',
      },
      {
        id: 'concurrency',
        topic: '동시성 제어',
        question: '동일 파일 동시 재처리(Race)를 어떻게 막는지',
        choice: '재처리 직전 상태 재확인 후 이미 처리된 건은 Skip (최소 구현)',
        rationale: 'plan.md 의 "신규 테이블·컬럼 없음" 방침에 부합. 충돌이 잦아지면 상태 컬럼 기반 락으로 승급한다.',
        caution: '아주 드문 동시 요청은 놓칠 수 있습니다. 재처리 빈도가 높다면 옵션 B(상태 컬럼 락)를 권합니다.',
      },
      {
        id: 'audit-trail',
        topic: '감사 이력',
        question: '재처리 성공·실패 이력을 어디에 남기는지',
        choice: '애플리케이션 로그에만 성공·실패와 원인 기록',
        rationale: '"신규 테이블 없음"을 유지하는 가장 가벼운 방법. 감사 요건이 생기면 이력 테이블로 승급한다.',
      },
      {
        id: 'ext-security',
        topic: '보안 기준',
        question: '보안 확장(Security Baseline)을 적용하는지',
        choice: '예 — 보안 규칙을 필수(차단) 제약으로 적용',
        rationale: '운영급 기능이고 권한·개인정보가 걸려 있어 보안 기준을 강제 적용한다.',
      },
      {
        id: 'ext-resiliency',
        topic: '복원력 기준',
        question: '복원력 기준(Resiliency Baseline)을 적용하는지',
        choice: '예 — 복원력 기준을 설계 지침으로 적용',
        rationale: '외부 저장소·후처리에 의존해 실패 가능성이 있어, 재시도·타임아웃·폴백을 설계에 반영한다.',
      },
      {
        id: 'ext-pbt',
        topic: 'PBT 적용',
        question: '속성 기반 테스트(PBT)를 적용하는지',
        choice: '부분 적용 — 순수 함수·직렬화 왕복(round-trip)에만',
        rationale: '파일 재처리·상태 판정 같은 변환 로직이 있어, 비용 대비 효과가 좋은 부분 적용이 균형점이다.',
      },
    ],
  },
  {
    key: 'order-cancel-refund',
    title: '주문 취소·환불 정책 자동 판정',
    hasIcon: true,
    aiSummary: '손님/매장이 요청한 주문 취소를 조리 단계와 결제 상태에 따라 승인·부분환불·거절로 자동 판정하는 기능입니다. 기존 주문 상태 머신과 PG 취소 API 를 그대로 재사용합니다. 신규 컬럼 없이 현재 상태만으로 판정하며, 애매하거나 PG 오류가 나면 운영자 대기열로 넘깁니다.',
    decisions: [
      {
        id: 'cancel-window',
        topic: '취소 허용 시점',
        question: '자동 취소를 어느 단계까지 허용하는지',
        choice: '조리 시작(ACCEPTED) 전까지만 자동 취소, 이후는 매장 승인 필요',
        rationale: '조리 착수 후 취소는 원가 손실이 생기므로 사람 판단을 끼우는 것이 실무에 맞는다.',
      },
      {
        id: 'refund-calc',
        topic: '환불 금액 산정',
        question: '부분 취소 시 환불 금액을 어떻게 계산하는지',
        choice: '조리 미착수 품목은 전액, 착수 품목은 제외한 품목별 부분환불',
        rationale: '품목 단위 상태를 이미 추적하므로 별도 규칙 없이 정확한 부분환불이 가능하다.',
        caution: '세트/할인 쿠폰이 걸린 주문의 부분환불 금액이 맞는지 표본 검증이 필요합니다.',
      },
      {
        id: 'refund-channel',
        topic: '환불 수단',
        question: '환불을 어떤 경로로 처리하는지',
        choice: '원결제수단으로 자동 환불 (기존 PG 취소 API 재사용)',
        rationale: 'PG 취소 API 가 이미 있어 신규 연동 없이 재사용하는 것이 가장 안전하고 빠르다.',
      },
      {
        id: 'state-source',
        topic: '판정 근거',
        question: '취소 가능 여부를 무엇으로 판정하는지',
        choice: '주문 상태 머신의 현재 상태만으로 판정 (신규 컬럼 없음)',
        rationale: '기존 상태값이 이미 조리 단계를 정확히 반영하므로 별도 플래그를 추가하지 않는다.',
      },
      {
        id: 'cancel-notify',
        topic: '결과 통지',
        question: '취소 결과를 어떻게 알리는지',
        choice: '손님 앱 푸시 + 주방 티켓 자동 회수로 통지',
        rationale: '손님과 주방 양쪽에 동시에 반영돼야 유령 주문이 남지 않는다.',
      },
      {
        id: 'cancel-fallback',
        topic: '예외 처리',
        question: '자동 판정이 불가하거나 PG 오류가 날 때 어떻게 하는지',
        choice: '운영자 수동 처리 대기열로 이관하고 손님에게는 "확인 중" 안내',
        rationale: '애매한 건을 자동으로 밀어붙이면 이중환불·미환불 위험이 커서 사람에게 넘긴다.',
        caution: '대기열이 쌓였을 때의 SLA(응답 시간) 기준이 아직 정해지지 않았습니다.',
      },
    ],
  },
  {
    key: 'guest-phone-auth',
    title: '비회원 주문 시 전화번호 인증 도입',
    hasIcon: false,
    aiSummary: '비회원(게스트) 테이블 주문 시 전화번호 SMS 인증을 1회 거쳐 노쇼·장난 주문을 줄이는 기능입니다. 기존 세션/알림 발송 모듈을 재사용하고, 개인정보는 최소한만 보관합니다. SMS 장애 시에도 매장 직원 우회로 주문이 막히지 않도록 완화 정책을 둡니다.',
    decisions: [
      {
        id: 'auth-trigger',
        topic: '인증 시점',
        question: '전화번호 인증을 언제 요구하는지',
        choice: '테이블 세션당 첫 주문 확정 직전 1회만 인증',
        rationale: '주문마다 인증하면 이탈이 커지므로 세션 1회로 마찰을 최소화한다.',
      },
      {
        id: 'auth-method',
        topic: '인증 수단',
        question: '어떤 방식으로 인증하는지',
        choice: 'SMS OTP (기존 알림 발송기 재사용)',
        rationale: '이미 매장 알림용 SMS 발송 모듈이 있어 신규 연동 없이 재사용 가능하다.',
      },
      {
        id: 'auth-retry-limit',
        topic: '재시도 제한',
        question: 'OTP 재시도를 얼마나 허용하는지',
        choice: '5분 내 3회, 초과 시 매장 직원 호출 안내',
        rationale: '무제한 재시도는 SMS 비용·악용 위험이 커서 짧은 제한을 둔다.',
        caution: '직원 호출 안내가 실제 매장 운영 동선과 맞는지 현장 확인이 필요합니다.',
      },
      {
        id: 'auth-retention',
        topic: '개인정보 보관',
        question: '인증에 쓴 전화번호를 어떻게 보관하는지',
        choice: '세션 종료 시 원문 폐기, 통계·중복 판별용 해시만 보관',
        rationale: '개인정보 최소 수집 원칙에 따라 원문은 남기지 않는다.',
        caution: '해시만으로 마케팅 재활용이 불가함을 관련 부서와 합의했는지 확인이 필요합니다.',
      },
      {
        id: 'auth-fallback',
        topic: '인증 장애 대응',
        question: 'SMS 발송이 실패할 때 어떻게 하는지',
        choice: '매장 직원이 발급하는 우회 코드 입력으로 주문 허용',
        rationale: 'SMS 장애로 매출이 막히면 안 되므로 사람 개입 우회로를 반드시 둔다.',
      },
    ],
  },
];

// 칸반 카드에 리뷰 아이콘을 달고 Plan 리뷰 목록에 노출할 SR 제목 집합 (hasIcon === true).
// SRCard(보드)와 PlanReviewPage 가 이 집합을 공유해 "아이콘 있는 SR 만 리뷰 대상"을 일관되게 판단한다.
export const REVIEW_ICON_TITLES: ReadonlySet<string> = new Set(INCEPTION_REVIEWS.filter(r => r.hasIcon).map(r => r.title));
