/**
 * Plan 리뷰 목록에 대응하는 Inception SR 2건을 보드에 추가한다.
 *
 * Workspace 칸반보드의 Inception 컬럼과 Plan 리뷰 목록은 SR 제목으로 매칭된다
 * (src/aidlc-planning/ui/plan-review-data.ts 의 title 과 동일). 기존 eSPEC SR 은 이미
 * 보드에 있으므로, 여기서는 나머지 2건만 만든다. 백엔드 계약/서비스 로직은 건드리지 않고
 * SRService.create 로 행을 만든 뒤 workflow_column 만 'inception' 으로 직접 갱신한다
 * (스토어가 스스로 쓰는 것과 동일한 UPDATE). 제목이 이미 있으면 건너뛴다(멱등).
 *
 * 실행: PATH="<linux-node-bin>:$PATH" node_modules/.bin/tsx scripts/seed-inception.ts
 */
import { resolve } from 'node:path';
import type { ActorContext } from '../src/shared/contracts.js';
import { openDatabase } from '../src/sr-document-foundation/storage/database.js';
import { SQLiteStore } from '../src/sr-document-foundation/storage/sqlite-store.js';
import { SRService } from '../src/sr-document-foundation/services/sr-service.js';
import { unwrap } from '../src/shared/errors.js';

const SEEDS: { title: string; description: string }[] = [
  {
    title: '주문 취소·환불 정책 자동 판정',
    description: '손님/매장이 요청한 주문 취소를 조리 단계와 결제 상태에 따라 승인·부분환불·거절로 자동 판정한다. 기존 주문 상태 머신과 PG 취소 API 를 재사용하며, 판정이 애매하거나 PG 오류가 나는 건은 운영자 대기열로 이관한다. 조리 착수 전까지만 자동 취소를 허용하고 이후는 매장 승인을 거친다.',
  },
  {
    title: '비회원 주문 시 전화번호 인증 도입',
    description: '비회원(게스트) 테이블 주문 시 전화번호 SMS 인증을 세션당 1회 거쳐 노쇼·장난 주문을 줄인다. 기존 세션/알림 발송 모듈을 재사용하고, 인증에 쓴 전화번호는 세션 종료 시 원문을 폐기하고 해시만 보관한다. SMS 장애 시에는 매장 직원 우회 코드로 주문을 허용한다.',
  },
];

function main() {
  const actor: ActorContext = { source: 'user', role: 'author' };
  const db = openDatabase(resolve('.planrepo/planrepo.sqlite'));
  try {
    const store = new SQLiteStore(db);
    const service = new SRService(store);
    const move = db.prepare('UPDATE srs SET workflow_column=? WHERE id=?');
    const exists = db.prepare('SELECT id FROM srs WHERE title=?');
    const created: { title: string; id?: string; skipped?: boolean }[] = [];
    for (const seed of SEEDS) {
      if (exists.get(seed.title)) { created.push({ title: seed.title, skipped: true }); continue; }
      const sr = unwrap(service.create({ title: seed.title, description: seed.description }, actor));
      move.run('inception', sr.id);
      created.push({ title: seed.title, id: sr.id.slice(0, 8) });
    }
    console.log(JSON.stringify({ ok: true, created }, null, 2));
  } finally {
    if (db.open) db.close();
  }
}

main();
