/**
 * 데모용 보드 시드: 칸반 각 컬럼에 예시 SR 을 하나 이상 채워 화면을 보기 좋게 만든다.
 *
 * table-order-ddthon 은 "구현 완료(implemented)" 로, 그 밖에 SR 목록 2건 · 요구사항 분석 1건 ·
 * Construction 1건 · 구현 대기 1건을 임의 데이터로 만든다. 백엔드 계약/서비스 로직은 건드리지
 * 않고, 기존 SRService.create 로 행을 만든 뒤 workflow_column 만 직접 갱신한다 (스토어가 스스로
 * 쓰는 것과 동일한 UPDATE, 차단 트리거 없음). 계획 워크플로 행은 만들지 않는다 — getWorkflow 가
 * 기본값(idle)을 돌려주므로 보드/상세 화면 모두 정상 렌더된다.
 *
 * 실행: PATH="<linux-node-bin>:$PATH" node_modules/.bin/tsx scripts/seed-demo.ts
 */
import { resolve } from 'node:path';
import type { ActorContext } from '../src/shared/contracts.js';
import { openDatabase } from '../src/sr-document-foundation/storage/database.js';
import { SQLiteStore } from '../src/sr-document-foundation/storage/sqlite-store.js';
import { SRService } from '../src/sr-document-foundation/services/sr-service.js';
import { unwrap } from '../src/shared/errors.js';

type Column = 'sr_list' | 'requirements_analysis' | 'inception' | 'construction' | 'implementation_ready' | 'implemented';
type Seed = { title: string; description: string; column: Column };

const SEEDS: Seed[] = [
  {
    title: '테이블 오더 주문 시스템 (table-order-ddthon)',
    column: 'implemented',
    description: [
      '# 테이블 오더 주문 시스템',
      '',
      '매장 테이블의 QR 코드를 스캔해 손님이 직접 메뉴를 주문하고, 주방에는 실시간으로 주문',
      '티켓이 전달되는 시스템. `C:\\Users\\82105\\git\\table-order-ddthon` 에 구현되어 있다.',
      '',
      '## 구현된 범위',
      '- QR 스캔 → 테이블 세션 생성, 장바구니, 주문 확정',
      '- 주방 실시간 티켓(WebSocket) 및 조리 상태 업데이트',
      '- 주문/결제 내역 조회, 매장 관리자 대시보드',
    ].join('\n'),
  },
  {
    title: '회원 등급별 할인 쿠폰 자동 발급',
    column: 'sr_list',
    description: '단골 회원 등급(Bronze/Silver/Gold)에 따라 월 1회 할인 쿠폰을 자동 발급한다. 등급 산정 기준과 쿠폰 유효기간, 중복 사용 정책을 정의해야 한다.',
  },
  {
    title: '주문 내역 CSV 내보내기',
    column: 'sr_list',
    description: '매장 관리자가 기간을 지정해 주문 내역을 CSV 로 내려받는 기능. 컬럼 구성(주문번호·테이블·메뉴·금액·시각)과 대용량 내보내기 시 페이징/스트리밍 방식을 검토한다.',
  },
  {
    title: '매장 리뷰 신고 및 블라인드 처리',
    column: 'requirements_analysis',
    description: '부적절한 매장 리뷰를 사용자가 신고하고, 누적 신고 수 또는 운영자 판단으로 블라인드 처리하는 기능. 신고 사유 분류와 자동 블라인드 임계값, 작성자 이의제기 흐름을 정한다.',
  },
  {
    title: '실시간 주방 알림(WebSocket) 재연결 개편',
    column: 'construction',
    description: '주방 디스플레이가 네트워크 순단 후에도 누락 없이 주문을 이어받도록 WebSocket 재연결과 미수신 티켓 재동기화를 개편한다. 하트비트, 재연결 백오프, 마지막 수신 시퀀스 기반 보정을 도입한다.',
  },
  {
    title: '포인트 적립·사용 정산 배치',
    column: 'implementation_ready',
    description: '결제 완료 시 적립되는 포인트와 사용분을 일 단위로 정산하는 배치. 적립률 정책, 사용/취소 정합성, 실패 건 재처리 큐 설계가 확정되어 구현 대기 상태다.',
  },
];

function main() {
  const actor: ActorContext = { source: 'user', role: 'author' };
  const db = openDatabase(resolve('.planrepo/planrepo.sqlite'));
  try {
    const store = new SQLiteStore(db);
    const service = new SRService(store);
    const move = db.prepare('UPDATE srs SET workflow_column=? WHERE id=?');
    const created: { id: string; column: Column; title: string }[] = [];
    for (const seed of SEEDS) {
      const sr = unwrap(service.create({ title: seed.title, description: seed.description }, actor));
      if (seed.column !== 'sr_list') move.run(seed.column, sr.id);
      created.push({ id: sr.id.slice(0, 8), column: seed.column, title: seed.title });
    }
    console.log(JSON.stringify({ ok: true, created }, null, 2));
  } finally {
    if (db.open) db.close();
  }
}

main();
