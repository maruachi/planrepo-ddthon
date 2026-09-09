// grill-me 터미널의 대화 엔진 + 예시 데이터 (프론트 전용, 백엔드/실시간 AI 호출 없음).
// 각 질문·선택지에 대해 사용자가 되물으면(차이/추천/뜻/왜/선택 등) 규칙 기반으로 응답한다.
// 실제 LLM 이 아니라 아래 큐레이션된 예시 데이터를 바탕으로 답한다는 점을 UI 상단에 명시한다.
import type { PlanningQuestion } from '../../shared/planning-contracts.js';

export type GrillReply = { text: string; select?: number };
type OptionInfo = { intent: string; when?: string };
type QScript = { gist: string; options: OptionInfo[]; recommend?: { index: number; why: string } };

const L = ['A', 'B', 'C', 'D', 'E'];

// 여러 질문에 공통으로 등장하는 용어 사전 ("~가 뭐야" 류 질문에 사용).
const GLOSSARY: { keys: string[]; def: string }[] = [
  { keys: ['페이징', '페이지네이션', 'paging'], def: '결과를 한 번에 다 불러오지 않고 예: 20건씩 나눠 불러오는 방식이에요. 화면과 DB 부하를 크게 줄여줘요.' },
  { keys: ['스캐폴드', 'scaffold', '뼈대'], def: '빈 뼈대 코드예요. 폴더 구조·기본 파일만 자동으로 만들어 두고, 실제 로직은 이후에 채우는 거죠.' },
  { keys: ['체크아웃', 'checkout'], def: 'git 저장소에서 특정 코드를 이 작업 폴더로 받아오는 걸 말해요.' },
  { keys: ['스테이징', '임시 저장소', '임시저장소', 'staging'], def: '파일이 최종 저장되기 전에 잠깐 머무는 중간 보관 장소예요.' },
  { keys: ['레이스', 'race', '동시성', '동시 요청'], def: '두 요청이 같은 데이터를 거의 동시에 건드려서, 순서가 꼬여 결과가 어긋나는 상황이에요.' },
  { keys: ['락', 'lock', '잠금'], def: '한 요청이 처리하는 동안 다른 요청이 같은 데이터를 못 건드리게 잠그는 거예요.' },
  { keys: ['for update', '행 잠금', '행잠금'], def: 'DB 가 그 행(row)을 읽는 순간부터 트랜잭션이 끝날 때까지 잠가, 다른 요청을 기다리게 하는 방식이에요. 가장 확실하지만 느려질 수 있어요.' },
  { keys: ['역할', 'role', '롤'], def: '사용자에게 붙는 묶음 권한 딱지예요. 예: "운영자" 역할. 역할만 지정하면 돼서 관리가 간단해요.' },
  { keys: ['permission', '퍼미션', '기능 권한', '권한 코드'], def: '특정 기능을 쓸 수 있는지 하나하나 지정한 권한이에요. 역할보다 더 잘게 나뉘어 세밀하지만 설정이 늘어요.' },
  { keys: ['file_upload_dttm', '업로드 시각', '업로드 일시'], def: '첨부파일이 업로드된 시각을 담는 컬럼이에요. 이게 비어 있으면 "업로드 후처리가 덜 끝난 오류 건"으로 봐요.' },
  { keys: ['rpt_doc', '문서 단위', '문서단위'], def: '여러 첨부파일을 묶는 상위 "문서" 단위예요.' },
  { keys: ['감사', '이력', 'audit', '오딧'], def: '누가·언제·무엇을 했는지 남기는 기록이에요. 문제가 생겼을 때 추적하는 용도죠.' },
  { keys: ['pbt', '속성 기반', '속성기반', 'property based'], def: '예시 몇 개로만 테스트하는 대신, "어떤 입력이든 이 성질은 항상 성립해야 한다"를 정하고 무작위 입력 수백 개로 자동 검증하는 방식이에요.' },
  { keys: ['라운드', 'round-trip', 'round trip', '왕복', '직렬화'], def: '데이터를 저장(직렬화)했다가 다시 읽어(역직렬화) 원래와 똑같은지 확인하는 거예요.' },
  { keys: ['복원력', 'resiliency', '레질리언'], def: '장애·부하가 와도 시스템이 버티고 회복하는 능력이에요 (재시도·타임아웃·폴백 등).' },
  { keys: ['보안 기준', 'security baseline', '보안 베이스라인', '시큐리티'], def: '지켜야 할 최소 보안 규칙 묶음이에요 (입력 검증·권한·비밀정보 관리 등).' },
  { keys: ['poc', '프로토타입', '피오씨'], def: '"되는지 빠르게 확인"이 목적인 실험용 버전이에요. 완성도·안정성보다 속도가 우선이죠.' },
  { keys: ['후처리'], def: '파일 자체를 다시 올리는 게 아니라, 업로드 뒤에 해야 할 뒷정리 작업(메타 기록·연계 처리 등)을 다시 수행하는 거예요.' },
];

const GRILL: Record<string, QScript> = {
  'source-code': {
    gist: '이 기능은 이미 있는 시스템(Vue 포털 + Spring Boot 서버)을 고쳐 쓰는 전제인데, 정작 그 소스 코드가 이 작업 폴더엔 없어요. 그래서 "AI 가 무엇을 근거로 설계하면 되냐"를 정하는 질문이에요.',
    options: [
      { intent: '실제 기존 코드를 이 폴더로 가져와요. AI 가 진짜 코드(클래스·함수·경로)를 보고 그 위에 맞춰 설계 — 가장 정확.', when: '기존 코드에 그대로 얹을 때' },
      { intent: '코드는 안 주고 plan.md 설명만으로 빈 새 프로젝트 뼈대를 만들어요. 기존 시스템과의 연결은 나중에 직접 맞춰야 해요.', when: '새로 시작하거나 PoC 일 때' },
      { intent: '코드 파일은 안 주지만 패키지 경로·Service 함수 모양·인증 방식을 글로 알려줘요. AI 가 그 설명에 맞춰 설계 — A 와 B 의 중간.', when: '코드 공유는 어렵지만 구조는 아는 경우' },
    ],
    recommend: { index: 0, why: '기존 시스템을 재사용·수정하는 기능이라, 실제 코드를 보고 설계해야 어긋나지 않아요. 그래서 A 를 권해요.' },
  },
  'retry-granularity': {
    gist: '오류 난 첨부파일을 다시 처리할 때, "한 번에 몇 개씩" 처리할지 정하는 질문이에요.',
    options: [
      { intent: '파일 한 건씩만 재처리. 각 파일 줄에 버튼 하나. 가장 단순하고 API 구조와도 맞아요.', when: '단순하게 시작할 때' },
      { intent: '체크박스로 여러 파일을 골라 한 번에 재처리. 오류가 많을 때 편해요.', when: '한 번에 여러 건 처리 수요가 있을 때' },
      { intent: '문서(RPT_DOC) 하나를 고르면 그 안의 오류 파일 전부를 한꺼번에 재처리.', when: '문서 단위로 관리·재처리하는 흐름일 때' },
    ],
    recommend: { index: 0, why: 'API 가 파일 1건 단위라, 우선 A 로 단순하게 맞추고 필요하면 다건을 얹는 게 안전해요.' },
  },
  'authorization': {
    gist: '"운영 권한이 있는 사람만 재처리 가능"이라고 했는데, 시스템이 그 "운영 권한"을 무엇으로 알아볼지 정하는 질문이에요.',
    options: [
      { intent: '사용자에게 붙은 "역할" 딱지(예: 운영자)로 판단. 역할 이름만 정하면 돼서 간단.', when: '역할 체계가 이미 있을 때' },
      { intent: '역할이 아니라 "이 기능을 쓸 권한"이 있는지 하나하나로 판단. 더 세밀하지만 설정이 필요.', when: '권한을 기능 단위로 잘게 관리할 때' },
      { intent: '보는 건 로그인한 누구나 OK, 다시 처리하는 것(변경)만 운영 권한으로 제한. 판별 방식은 A·B 중 하나와 함께 정해요.', when: '조회는 열고 변경만 막고 싶을 때' },
    ],
    recommend: { index: 2, why: '조회는 넓게 열고 위험한 재처리만 잠그는 게 실무에서 흔하고 안전해요. 판별은 보통 역할(A)과 함께 씁니다.' },
  },
  'query-bounding': {
    gist: '운영 DB 가 무거워지지 않게, 조회할 때 조건을 얼마나 강제로 요구할지 정하는 질문이에요.',
    options: [
      { intent: '기간을 반드시 입력해야 조회 가능 + 페이징. DB 보호가 가장 강해요.', when: '운영 DB 부하가 걱정될 때' },
      { intent: '조건은 선택이지만 조회 기간 최대 폭(예: 3개월)을 넘지 못하게 막고 페이징. 편의와 보호의 절충.', when: '유연하되 과부하는 막고 싶을 때' },
      { intent: '조건 없이 전체도 조회 가능, 대신 페이징만. 가장 편하지만 부하 위험 큼.', when: '데이터가 적거나 부하 걱정이 없을 때' },
    ],
    recommend: { index: 0, why: '"운영 DB 부하 방지"가 목적이라면 기간 필수(A)가 가장 확실해요.' },
  },
  'source-file-access': {
    gist: '업로드 시각(FILE_UPLOAD_DTTM)이 비어 있는 오류 건을 다시 처리할 때, "원본 파일"을 어디서 다시 읽어올지 정하는 질문이에요.',
    options: [
      { intent: '임시(스테이징) 저장소에 남은 원본을 다시 올려 처리. 원본이 임시 폴더에 남아 있다는 전제.', when: '업로드 중간 파일이 보관돼 있을 때' },
      { intent: '파일 자체는 최종 저장소에 이미 있고 "업로드 시각" 기록만 빠진 상황으로 보고, 파일은 다시 안 보내고 뒷정리(후처리)만 다시 함.', when: '파일은 멀쩡하고 메타만 누락됐을 때' },
      { intent: '원본 위치가 건마다 달라서, 재처리 전에 원본이 있는지 확인하고 없으면 실패로 처리 — 가장 방어적.', when: '케이스가 제각각이라 안전장치가 필요할 때' },
    ],
    recommend: { index: 1, why: '증상이 "FILE_UPLOAD_DTTM 만 비어 있음"이라면 파일은 있고 메타만 빠졌을 가능성이 커요. 그럼 B(후처리만 재수행)가 자연스럽습니다. 단, 실제 데이터 확인이 필요해요.' },
  },
  'concurrency': {
    gist: '같은 파일을 두 사람이 거의 동시에 재처리 누르면 꼬일 수 있어요(레이스 컨디션). 이걸 어떻게 막을지 정하는 질문이에요.',
    options: [
      { intent: '처리 직전에 "이미 처리됐나?" 다시 확인하고 됐으면 건너뜀. 새 컬럼 없이 가장 가벼움. 아주 드문 충돌은 못 막을 수 있어요.', when: '동시 재처리가 드물고 단순함이 우선일 때' },
      { intent: '"처리중" 상태 컬럼을 추가해 표시 → 동시에 들어와도 하나만 진행. 안정적이지만 컬럼 추가 필요.', when: '동시 요청이 종종 있을 때' },
      { intent: 'DB 가 해당 행을 잠가(FOR UPDATE) 확실히 한 건만 처리. 가장 엄격하지만 성능·복잡도 부담.', when: '정합성이 아주 중요할 때' },
    ],
    recommend: { index: 0, why: 'plan.md 가 "신규 테이블·컬럼 없음"을 지향하면 A(최소 구현)가 맞아요. 충돌이 잦아지면 B 로 올리면 됩니다.' },
  },
  'audit-trail': {
    gist: '재처리가 성공/실패했을 때 그 기록을 "어디에·얼마나" 남길지 정하는 질문이에요.',
    options: [
      { intent: '앱 로그 파일에만 성공/실패와 원인을 남김. 새 테이블 없이 가장 가벼움. 대신 화면에서 이력 조회는 어려움.', when: '신규 테이블을 만들지 않기로 했을 때' },
      { intent: '재처리 전용 이력 테이블을 새로 만들어 누가·언제·결과를 저장. 나중에 조회·감사에 좋지만 테이블 추가 필요.', when: '이력을 제대로 남기고 조회해야 할 때' },
      { intent: '새 테이블 없이, 기존 첨부파일 레코드에 "갱신 시각·처리자" 컬럼을 업데이트 + 로그. 절충안.', when: '테이블은 안 늘리되 최소 흔적은 남기고 싶을 때' },
    ],
    recommend: { index: 0, why: 'plan.md 가 "신규 테이블 없음"을 유지한다면 A 예요. 감사 요건이 있으면 B 로 올리세요.' },
  },
  'ext-security': {
    gist: '이 프로젝트에 보안 기준(SECURITY Baseline)을 강제로 적용할지 정하는 질문이에요.',
    options: [
      { intent: '보안 규칙을 전부 "반드시 지켜야 통과"하는 차단 제약으로 걸어요. 운영에 올릴 앱에 권장.', when: '실제 운영 서비스일 때' },
      { intent: '보안 규칙을 적용하지 않아요. 빠른 실험·PoC 엔 편하지만 운영엔 부적합.', when: '프로토타입·실험용일 때' },
    ],
    recommend: { index: 0, why: '운영에서 쓸 재처리 기능이고 권한·데이터가 걸려 있어, 보안 기준 적용(예)을 권해요.' },
  },
  'ext-resiliency': {
    gist: '장애·부하에도 잘 버티도록 하는 복원력 기준을 설계 지침으로 적용할지 정하는 질문이에요.',
    options: [
      { intent: '재시도·타임아웃·폴백 같은 복원력 모범사례를 설계 방향으로 반영. 중요한 업무엔 권장.', when: '장애가 업무에 크게 영향줄 때' },
      { intent: '복원력 기준 미적용. 빠르게 만들고 고치는 실험엔 편함.', when: 'PoC·빠른 반복이 우선일 때' },
    ],
    recommend: { index: 0, why: '재처리는 외부 저장소·후처리에 의존해 실패 가능성이 있어, 복원력 지침(예)을 권해요.' },
  },
  'ext-pbt': {
    gist: '속성 기반 테스트(PBT)를 이 프로젝트에 적용할지 정하는 질문이에요. PBT 는 무작위 입력을 잔뜩 넣어 "항상 성립해야 할 성질"을 자동 검증하는 방식이에요.',
    options: [
      { intent: '모든 대상에 PBT 를 필수로 강제. 로직·변환·직렬화·상태 컴포넌트가 많을 때 든든하지만 작성 부담 큼.', when: '핵심 비즈니스 로직이 복잡할 때' },
      { intent: '순수 함수와 저장→읽기 왕복(round-trip)에만 PBT 적용. 비용 대비 효과가 좋은 절충.', when: '일부만 견고히 검증하고 싶을 때' },
      { intent: 'PBT 미적용. 단순 CRUD·UI 위주면 굳이 필요 없을 수 있음.', when: '로직이 얇은 CRUD·UI 중심일 때' },
    ],
    recommend: { index: 1, why: '이 기능은 파일 재처리·상태 판정 같은 변환 로직이 있어, 순수 함수·왕복에만 적용하는 부분 적용(B)이 균형이 좋아요.' },
  },
};

// 등록되지 않은 질문(향후 다른 질문 세트)은 프롬프트·보기에서 일반 설명을 만들어 대응한다.
function scriptFor(q: PlanningQuestion): QScript {
  const known = GRILL[q.id];
  if (known) return known;
  return {
    gist: `이 질문은 "${q.prompt}" 을(를) 정하려는 거예요. 아래 보기 중 의도에 가장 가까운 것을 고르시면 돼요.`,
    options: q.options.map(o => ({ intent: o })),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const has = (s: string, ...keys: string[]) => keys.some(k => s.includes(k));

// 입력에서 언급된 보기 인덱스들을 찾는다 (A/B/C, 1/2/3, 1번, 첫·두·세·마지막 등).
function refIndices(input: string, count: number): number[] {
  const found = new Set<number>();
  for (let i = 0; i < count && i < L.length; i++) {
    const letter = L[i]!.toLowerCase();
    if (new RegExp(`(?:^|[^a-z0-9])${letter}(?:[^a-z0-9]|$)`, 'i').test(input)) found.add(i);
    if (new RegExp(`(?:^|[^0-9])${i + 1}\\s*(?:번|번째|째)?(?:[^0-9]|$)`).test(input)) found.add(i);
  }
  const ordinals: [string[], number][] = [[['첫', '처음'], 0], [['두번', '두 번', '둘째', '두째'], 1], [['세번', '세 번', '셋째', '세째'], 2], [['네번', '네 번', '넷째'], 3]];
  for (const [keys, idx] of ordinals) if (idx < count && has(input, ...keys)) found.add(idx);
  if (has(input, '마지막', '끝')) found.add(count - 1);
  return [...found].sort((a, b) => a - b);
}

const label = (q: PlanningQuestion, i: number) => `${L[i] ?? i + 1}) ${q.options[i]}`;
const optionLine = (q: PlanningQuestion, s: QScript, i: number) => `${L[i] ?? i + 1}) ${s.options[i]?.intent ?? q.options[i]}`;

function glossaryHits(input: string): { keys: string[]; def: string }[] {
  return GLOSSARY.filter(g => g.keys.some(k => input.includes(norm(k))));
}

// 초기 부팅 시 터미널에 뿌릴 안내 라인들.
export function grillBoot(q: PlanningQuestion): string[] {
  const s = scriptFor(q);
  const lines = [s.gist];
  if (q.options.length > 0) {
    lines.push('보기 요약 —');
    q.options.forEach((_, i) => lines.push('  ' + optionLine(q, s, i)));
    lines.push('이렇게 물어보실 수 있어요 → "A랑 B 차이" · "추천" · "왜?" · "페이징이 뭐야" · "A로 할게"');
  } else {
    lines.push('자유롭게 답하는 질문이에요. 무엇을 적으면 좋을지 궁금하면 편하게 물어보세요.');
  }
  return lines;
}

// 사용자 입력에 대한 규칙 기반 응답 (필요 시 select 로 보기 자동 선택).
export function grillRespond(q: PlanningQuestion, raw: string, pickedIndex: number | null): GrillReply {
  const s = scriptFor(q);
  const input = norm(raw);
  const count = q.options.length;
  const refs = refIndices(input, count);
  const one = refs.length === 1 ? refs[0]! : -1;
  const compareIntent = has(input, '차이', '비교', '다른', '구분', 'vs', '달라', '어떤 차', '무슨 차');
  const selectIntent = has(input, '선택', '정할', '정한', '이걸로', '이거로', '할게', '할래', '하자', '갈게', '결정', '고를', '고른다', '택할', '택한');
  const recommendIntent = has(input, '추천', '골라줘', '골라 줘', '정해줘', '뭐가 좋', '어떤 게 좋', '어느 게 좋', '알아서', 'best', '제일 좋', '가장 좋', '모르겠으면');
  const whyIntent = has(input, '왜', '이유', '근거', '때문', '어째서');
  const meaningIntent = has(input, '뭐', '무슨', '뜻', '의미', '몰라', '모르', '설명', '이해', '알려', '쉽게', '헷갈');
  const gloss = glossaryHits(input);

  // 도움말
  if (has(input, '뭐 물어', '어떻게 물어', '뭘 물어', '도움말', 'help', '무엇을 물어', '뭐라고 물어'))
    return { text: '이런 걸 물어보실 수 있어요:\n· "A랑 B 차이" — 보기끼리 비교\n· "추천" / "골라줘" — 이 프로젝트 기준 제 추천\n· "왜?" — 이 선택이 왜 중요한지\n· "페이징이 뭐야" — 어려운 용어 풀이\n· "A로 할게" — 그 보기로 답을 골라둠' };

  // 비교
  if (compareIntent) {
    if (gloss.length) return { text: gloss.map(g => `· ${g.keys[0]}: ${g.def}`).join('\n') };
    const targets = refs.length >= 2 ? refs : q.options.map((_, i) => i);
    return { text: '보기별로 이런 차이가 있어요 —\n' + targets.map(i => optionLine(q, s, i)).join('\n') + (s.recommend ? `\n\n제 추천은 ${L[s.recommend.index]} 예요. 이유가 궁금하면 "왜?"라고 물어보세요.` : '') };
  }

  // 용어 풀이
  if (gloss.length && (meaningIntent || input.length <= 12)) return { text: gloss.map(g => `${g.keys[0]} — ${g.def}`).join('\n\n') };

  // 보기 선택
  if (selectIntent && one >= 0) return { text: `좋아요, ${label(q, one)} 로 골라뒀어요.\n이 의도가 맞으면 모달에서 "다음"을 누르시면 됩니다. 마음이 바뀌면 다른 보기를 말해 주세요.`, select: one };
  if (selectIntent && one < 0 && pickedIndex != null && has(input, '이걸로', '이거로', '그걸로')) return { text: `네, 지금 고르신 ${label(q, pickedIndex)} 그대로 두겠습니다. "다음"으로 넘어가셔도 좋아요.` };

  // 추천
  if (recommendIntent) {
    if (s.recommend) return { text: `이 프로젝트 성격상 저라면 ${label(q, s.recommend.index)} 를 고르겠어요.\n이유: ${s.recommend.why}\n\n"${L[s.recommend.index]}로 할게"라고 하시면 골라둘게요. 최종 선택은 물론 본인 몫이에요.` };
    return { text: '이 질문은 정답이 딱 하나는 아니에요. 상황을 한두 줄 알려주시면 어떤 보기가 맞을지 같이 좁혀볼게요.' };
  }

  // 이유
  if (whyIntent) {
    const target = one >= 0 ? one : pickedIndex;
    if (target != null && target >= 0) { const o = s.options[target]; return { text: `${label(q, target)} 의 의미: ${o?.intent ?? q.options[target]}${o?.when ? `\n적합한 경우: ${o.when}` : ''}` }; }
    return { text: `이 질문이 중요한 이유는 — ${s.gist}\n보기를 하나 골라 "왜?"라고 물으면 그 선택의 득실을 짚어드릴게요.` };
  }

  // 특정 보기 설명
  if (one >= 0) { const o = s.options[one]; return { text: `${label(q, one)}\n→ ${o?.intent ?? q.options[one]}${o?.when ? `\n적합한 경우: ${o.when}` : ''}\n\n이걸로 정하려면 "${L[one]}로 할게"라고 말해 주세요.`, }; }

  // 확인
  if (has(input, '응', '맞아', '맞아요', '맞습니다', '맞네', '그래', '그럼', '네', 'ㅇㅇ', '오케', 'ok', 'okay', '좋아', '그거')) {
    if (pickedIndex != null) return { text: `네, ${label(q, pickedIndex)} 로 이해했어요. 이 방향이면 "다음"으로 넘어가셔도 좋아요.` };
    return { text: '아직 고른 보기가 없어요. "A로 할게"처럼 말씀해 주시면 골라둘게요.' };
  }

  // 다시 쉽게
  if (has(input, '쉽게', '다시', '이해가 안', '모르겠', '어려', '무슨 말', '잘 모르', '헷갈'))
    return { text: `쉽게 말하면 — ${s.gist}${count ? '\n"추천"이라고 하면 이 프로젝트 기준으로 하나 골라 드릴게요.' : ''}` };

  // 폴백
  return { text: `음, 그 부분은 이 예시 데이터로는 딱 답하기 어렵네요. 이렇게 물어봐 주시면 잘 도와드려요:\n· "A랑 B 차이"  · "추천"  · "왜?"  · "○○가 뭐야"  · "A로 할게"` };
}
