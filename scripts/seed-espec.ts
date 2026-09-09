/**
 * 테스트 데이터 시드: eSPEC 첨부파일 업로드 오류 조회/재처리 기능.
 *
 * requirements/plan.md 를 설명으로 하는 SR 을 만들고, 요구사항 분석(requirements-analysis)
 * 문서를 생성·승인한 뒤 다음 단계(user-stories)로 넘겨 확인 질문 10개를 생성한다. 이렇게 하면
 * 카드가 Inception 컬럼에 놓인 채 `awaiting_answers` 상태가 되어, 계획 패널의 grill-me 모달을
 * Inception 단계의 실제 질문으로 확인할 수 있다. 백엔드 계약은 그대로 두고, 실제 서비스 로직을
 * 태우되 CLI 대신 고정 산출물을 반환하는 stub runner 만 주입한다 (테스트 헬퍼와 동일한 방식).
 *
 * 실행: PATH="<linux-node-bin>:$PATH" node_modules/.bin/tsx scripts/seed-espec.ts [plan.md 경로]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ActorContext, Result } from '../src/shared/contracts.js';
import type { ContextSnapshot, GeneratedArtifact, PlanRunnerPort, RunnerOutcome } from '../src/shared/planning-contracts.js';
import { openDatabase } from '../src/sr-document-foundation/storage/database.js';
import { SQLiteStore } from '../src/sr-document-foundation/storage/sqlite-store.js';
import { SRService } from '../src/sr-document-foundation/services/sr-service.js';
import { DocumentService } from '../src/sr-document-foundation/services/document-service.js';
import { compareLines } from '../src/sr-document-foundation/compare/line-diff.js';
import { PlanningService } from '../src/aidlc-planning/services/planning-service.js';
import { PlanningContextBuilder } from '../src/aidlc-planning/context/planning-context-builder.js';
import { unwrap } from '../src/shared/errors.js';
import { TITLE, QUESTIONS } from './espec-data.js';

const QUESTION_SUMMARY = '요구사항을 정확히 이해하기 위해 확인이 필요한 항목 10가지입니다. 각 질문에서 의도에 가장 가까운 것을 골라 주세요.';
const REQUIREMENTS_SUMMARY = 'plan.md 를 바탕으로 요구사항 분석 초안을 정리했습니다. 확인 후 다음 단계로 진행해 주세요.';

// 요구사항 분석 단계 산출물(문서). user-stories 이후 단계에서는 확인 질문(QUESTIONS)을 반환한다.
const REQUIREMENTS_DOC: GeneratedArtifact = {
  logicalKey: 'inception/requirements/requirements-analysis.md',
  title: 'eSPEC 첨부파일 업로드 오류 조회/재처리 — 요구사항 분석',
  body: [
    '# 요구사항 분석 (초안)',
    '',
    '## 배경',
    'eSPEC 문서 첨부파일 업로드 과정에서 `FILE_UPLOAD_DTTM` 이 기록되지 않은 오류 건이 발생한다.',
    '운영자가 이러한 오류 건을 조회하고 필요 시 재처리할 수 있는 기능을 제공한다.',
    '',
    '## 확정된 범위',
    '- 오류 첨부파일 조회 화면 (조건 검색 + 페이징)',
    '- 오류 건 재처리 실행 (운영 권한 사용자 한정)',
    '- 재처리 성공/실패 이력 기록',
    '',
    '## 확인이 필요한 사항',
    '다음 단계에서 아래 항목을 사용자에게 확인한다: 기존 코드 제공 방식, 재처리 단위, 권한 판별,',
    '조회 조건 강제, 원본 파일 접근, 동시성 제어, 감사 이력, 그리고 Security/Resiliency/PBT 확장 적용 여부.',
    '',
    '> 이 문서는 테스트 시드 데이터로 자동 생성되었습니다.',
  ].join('\n'),
};

async function main() {
  const planPath = process.argv[2] ?? '/mnt/c/Users/82105/espec/requirements/plan.md';
  const description = readFileSync(planPath, 'utf8');
  const actor: ActorContext = { source: 'user', role: 'author' };

  // 단계별 stub runner: 요구사항 분석은 문서를, 이후 단계는 확인 질문을 반환한다.
  const runner: PlanRunnerPort = {
    execute: (context: ContextSnapshot): Promise<Result<RunnerOutcome>> =>
      Promise.resolve(context.stage === 'requirements-analysis'
        ? { ok: true, data: { artifacts: [REQUIREMENTS_DOC], questions: [], summary: REQUIREMENTS_SUMMARY } }
        : { ok: true, data: { artifacts: [], questions: QUESTIONS, summary: QUESTION_SUMMARY } }),
  };

  const db = openDatabase(resolve('.planrepo/planrepo.sqlite'));
  try {
    const store = new SQLiteStore(db);
    const diff = { compare: (input: Parameters<typeof compareLines>[0]) => Promise.resolve(compareLines(input)), close: () => Promise.resolve() };
    const docs = new DocumentService(store, diff);
    const planning = new PlanningService(store, docs, new PlanningContextBuilder(store, resolve('.aidlc-rule-details')), runner);

    const sr = unwrap(new SRService(store).create({ title: TITLE, description }, actor));

    // 1) 요구사항 분석 문서 생성 → 검토 대기
    unwrap(planning.advance(sr.id, 'generate', actor, 0));
    await planning.waitForIdle();
    let wf = unwrap(planning.getWorkflow(sr.id));
    if (wf.status !== 'awaiting_approval') throw new Error(`요구사항 생성 후 상태가 예상과 다릅니다: ${wf.status}`);

    // 2) 문서 승인
    unwrap(planning.decide(sr.id, { kind: 'approve', comment: '', targets: wf.reviewTargets, revision: wf.revision }, actor));
    wf = unwrap(planning.getWorkflow(sr.id));

    // 3) 다음 단계(user-stories, Inception)로 진행 → 확인 질문 10개 생성 → 응답 대기
    unwrap(planning.advance(sr.id, 'next', actor, wf.revision));
    await planning.waitForIdle();
    wf = unwrap(planning.getWorkflow(sr.id));

    await planning.close();
    const questions = wf.questionSet?.questions.length ?? 0;
    console.log(JSON.stringify({ ok: true, srId: sr.id, stage: wf.stage, status: wf.status, column: wf.column, questions }));
    if (wf.status !== 'awaiting_answers' || wf.column !== 'inception' || questions !== QUESTIONS.length) {
      throw new Error(`예상치 못한 최종 상태: ${wf.stage}/${wf.status}/${wf.column}, 질문 ${questions}개`);
    }
  } finally {
    if (db.open) db.close();
  }
}

main().catch((e: unknown) => { console.error(JSON.stringify({ ok: false, error: String(e) })); process.exitCode = 1; });
