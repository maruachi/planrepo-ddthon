import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../../src/sr-document-foundation/storage/database.js';
import { SQLiteStore } from '../../../src/sr-document-foundation/storage/sqlite-store.js';
import { SRService } from '../../../src/sr-document-foundation/services/sr-service.js';
import { DocumentService } from '../../../src/sr-document-foundation/services/document-service.js';
import { compareLines } from '../../../src/sr-document-foundation/compare/line-diff.js';
import { AUTHOR } from '../../../src/shared/contracts.js';
import { unwrap } from '../../../src/shared/errors.js';
import { emptyChanges } from '../../../src/sr-document-foundation/storage/store-port.js';
const dir = mkdtempSync(join(tmpdir(), 'planrepo-browser-')); const path = join(dir, 'fixture.sqlite');
const db = openDatabase(path); const store = new SQLiteStore(db); const srService = new SRService(store); const docs = new DocumentService(store, { compare: async input => compareLines(input), close: async () => {} });
const titles = ['고객 피드백 수집 개선', '알림 설정 관리', '검색 결과 정렬 개선', '프로젝트 문서 정리', '팀 작업 현황 대시보드', '온보딩 가이드 개선', '문서 내보내기 흐름', '계정 설정 접근성', '반복 작업 관리', '작업 변경 이력'];
const documentTitles = ['요구사항 명세', '사용자 여정', '기능 설계', '검증 계획', '구현 준비'];
let firstSR = ''; let firstRef; let latestRef;
for (let i = 0; i < 20; i++) {
  const sr = unwrap(srService.create({ title: `[검증 데이터] ${titles[i % titles.length]}${i >= 10 ? ' · 확장' : ''}`, description: '고객의 의견을 한곳에서 수집하고 우선순위에 따라 정리합니다.\n\n- 원본 의견 보존\n- 상태 변화 추적\n- 키보드 조작 지원', attachmentMarkdown: '# 참고 자료\n\n이 입력은 브라우저 검증용입니다.\n' }, AUTHOR)); if (i === 0) firstSR = sr.id;
  for (let j = 0; j < 5; j++) {
    let documentId: string | undefined;
    for (let v = 1; v <= 10; v++) {
      const body = `# ${documentTitles[j]}\n\n고객 피드백을 수집하고 팀이 실행 가능한 계획으로 정리합니다.\n\n## 목표\n\n1. 사용자가 의견을 쉽게 남길 수 있다.\n2. 이전 내용과 의사결정의 근거를 유지한다.\n\n## 수용 기준\n\n| 항목 | 기대 결과 |\n| --- | --- |\n| 의견 등록 | 입력 내용을 저장하고 다시 읽는다 |\n| 변경 이력 | 과거 기록을 보존한다 |\n\n- [x] 요구사항 확인\n- [ ] 구현 검증\n\n> 준비된 테스트 문서입니다. 실제 AI 생성 결과가 아닙니다.\n\n버전 ${v}\n` + '검증 문맥: 입력과 원본 기록을 보존합니다.\n'.repeat(150);
      const c = unwrap(docs.prepareGenerated(sr.id, randomUUID(), [{ logicalKey: `doc-${j}`, documentId, title: documentTitles[j], body }])); unwrap(store.commit(c)); documentId = c.pointers[0].documentId;
      if (i === 0 && j === 0) { if (v === 1) firstRef = c.pointers[0]; latestRef = c.pointers[0]; }
    }
  }
}
const events = emptyChanges(); events.events.push({ id: randomUUID(), srId: firstSR, kind: 'fixture_decision', actor: AUTHOR, occurredAt: new Date().toISOString(), summary: '본문 변경 없는 결정 · 검증 데이터', details: { decision: '승인 검증 예시', note: 'U2 실제 결정 기능 검증이 아닙니다.' }, versionRefs: [firstRef!] }); unwrap(store.commit(events));
const big = unwrap(docs.prepareGenerated(firstSR, randomUUID(), [{ logicalKey: 'large', title: '상한 본문 검증', body: 'a\n'.repeat(524288) }])); unwrap(store.commit(big));
const large1 = big.pointers[0]; const large2 = unwrap(docs.edit(large1, 'b\n'.repeat(524288), AUTHOR)).view;
const long = unwrap(docs.prepareGenerated(firstSR, randomUUID(), [{ logicalKey: 'long-line', title: '긴 한 줄 검증', body: 'x'.repeat(1048576) }])); unwrap(store.commit(long));
const unsafe = unwrap(docs.prepareGenerated(firstSR, randomUUID(), [{ logicalKey: 'markdown-safety', title: '마크다운 렌더링 검증', body: '# 안전한 문서 열람\n<script>window.PLANREPO_INJECTED=true</script>\n\n<img src="x" onerror="window.PLANREPO_INJECTED=true">\n\n![외부 이미지](https://example.invalid/image.png)\n[위험 링크](javascript:alert(1))\n[외부 링크](https://example.com)\n' }])); unwrap(store.commit(unsafe));
db.close(); const data = { dir, path, firstSR, firstRef, latestRef, large1, large2: { srId: large2.srId, documentId: large2.documentId, versionId: large2.versionId }, long: long.pointers[0], unsafe: unsafe.pointers[0], regularRecords: '20 SR × 5 documents × 10 versions; additional boundary fixtures' }; writeFileSync(join(dir, 'fixture.json'), JSON.stringify(data, null, 2)); console.log(JSON.stringify(data));
