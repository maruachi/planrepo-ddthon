import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import manifest from '@/config/demo/manifest.json' with { type: 'json' };
import {
  GENERATION_INPUT_MAX_BYTES,
  GenerationInputBasisError,
  GenerationInputTooLargeError,
  canonicalJson,
  prepareGenerationSnapshot,
} from '@/src/application/generation-snapshot';
import { artifactLogicalTarget } from '@/src/domain/artifact-target';
import type { VersionRef } from '@/src/contracts/context';
import {
  allowedGenerationSourceRefKeys,
  generationSourceRefKey,
} from '@/src/contracts/generation-source-refs';
import {
  GenerationBasisReadError,
  readGenerationBasis,
  type GenerationBasis,
} from '@/src/persistence/generation-input-repository';
import {
  decodeSnapshotContents,
  InputSnapshotRepositoryError,
  insertInputSnapshot,
  snapshotContents,
} from '@/src/persistence/input-snapshot-repository';
import { seedDemo } from '@/src/persistence/seed-demo';
import { loadProjectRuleSource } from '@/src/runtime/project-rule-source';
import { createTestDatabase } from '@/tests/helpers/test-database';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tempRoot(): Promise<string> {
  const root = join(tmpdir(), `planrepo-rule-source-${randomUUID()}`);
  await mkdir(join(root, 'config/generation'), { recursive: true });
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeRules(root: string, rules: readonly object[]): Promise<void> {
  await writeFile(
    join(root, 'config/generation/project-rules.json'),
    JSON.stringify({ schemaVersion: 1, rules }),
    'utf8',
  );
}

describe('ProjectRuleSource', () => {
  it('logical ID와 정확한 content hash를 고정하고 같은 source 인스턴스를 불변으로 유지합니다', async () => {
    const root = await tempRoot();
    const content = '첫 줄  \n둘째 줄\n';
    await writeRules(root, [{ logicalId: 'human-confirmation', content }]);
    const source = loadProjectRuleSource(root);
    const expectedVersion = `sha256:${createHash('sha256').update(content).digest('hex')}`;

    expect(source.rules).toEqual([{ logicalId: 'human-confirmation', version: expectedVersion, content }]);
    expect(Object.isFrozen(source.rules)).toBe(true);
    expect(Object.isFrozen(source.rules[0])).toBe(true);

    await writeRules(root, [{ logicalId: 'human-confirmation', content: 'changed' }]);
    expect(source.rules[0]?.content).toBe(content);
    expect(loadProjectRuleSource(root).rules[0]?.version).not.toBe(expectedVersion);
  });

  it('프로젝트 root 밖으로 나가는 규칙 symlink와 중복 logical ID를 거절합니다', async () => {
    const root = await tempRoot();
    const outside = join(tmpdir(), `planrepo-outside-rule-${randomUUID()}.json`);
    cleanups.push(() => rm(outside, { force: true }));
    await writeFile(outside, JSON.stringify({
      schemaVersion: 1,
      rules: [{ logicalId: 'outside', content: 'outside' }],
    }));
    await symlink(outside, join(root, 'config/generation/project-rules.json'));
    expect(() => loadProjectRuleSource(root)).toThrow(/프로젝트 root/);

    await rm(join(root, 'config/generation/project-rules.json'));
    await writeRules(root, [
      { logicalId: 'duplicate', content: 'one' },
      { logicalId: 'duplicate', content: 'two' },
    ]);
    expect(() => loadProjectRuleSource(root)).toThrow(/중복/);
  });

  it('제품 자산은 생성에 필요한 명시 규칙만 제공합니다', () => {
    const source = loadProjectRuleSource(resolve(import.meta.dirname, '../..'));

    expect(source.rules.map((rule) => rule.logicalId)).toEqual([
      'assumptions-and-evidence',
      'human-authority',
      'immutable-history',
      'review-gate-separation',
      'scope-and-traceability',
      'task-workflow',
    ]);
    expect(source.rules.map((rule) => rule.content).join('\n')).not.toMatch(/AGENTS|audit|개인 설정/u);
  });
});

describe('generation input canonical snapshot', () => {
  it('empty workspace의 신규 SR도 같은 프로젝트 참여자만 안정 순서로 생성 입력에 고정합니다', async () => {
    const { createTestApp } = await import('@/tests/helpers/test-app');
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const registered = await app.invoke('M-003', {
        actorId: manifest.defaultActorId,
        projectId: manifest.projectId,
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
      }, {
        key: `INPUT-${randomUUID()}`,
        title: '생성 참여자 입력',
        purpose: '질문 후보 담당자를 제공합니다.',
        description: 'empty workspace에서 등록한 SR입니다.',
        ownerId: manifest.defaultActorId,
      });
      if (!registered.ok) throw new Error(`SR 등록 실패: ${registered.error.code}`);
      const scope = registered.value.scope;
      const initial = readGenerationBasis(app.db, scope);
      if (initial === undefined) throw new Error('신규 SR basis가 없습니다.');
      expect(initial.participants.ownerId).toBe(manifest.defaultActorId);
      expect(initial.participants.members).toHaveLength(5);
      expect(initial.participants.members.map(({ userId }) => userId)).toEqual(
        [...initial.participants.members.map(({ userId }) => userId)].sort(),
      );
      expect(initial.participants.members.every((member) =>
        Object.keys(member).sort().join(',') === 'displayName,userId')).toBe(true);
      const initialSnapshot = prepareGenerationSnapshot(
        { taskKind: 'QUESTION_PROPOSALS' }, initial, Object.freeze([]),
      );

      app.db.prepare(
        `INSERT INTO workspace_projects(
           project_id,team_id,name,revision,default_policy_id,default_policy_version,provider_config_id
         ) VALUES ('other-project','other-team','Other',1,NULL,NULL,NULL)`,
      ).run();
      app.db.prepare(
        `INSERT INTO demo_user_memberships(project_id,user_id,display_name,roles_json,revision,demo)
         VALUES ('other-project','other-user','OTHER_PROJECT_SECRET',?,1,1)`,
      ).run(JSON.stringify(['credential-owner']));
      const otherProjectIgnored = readGenerationBasis(app.db, scope);
      if (otherProjectIgnored === undefined) throw new Error('다른 프로젝트 추가 후 basis가 없습니다.');
      expect(prepareGenerationSnapshot(
        { taskKind: 'QUESTION_PROPOSALS' }, otherProjectIgnored, Object.freeze([]),
      ).contentFingerprint).toBe(initialSnapshot.contentFingerprint);

      const insertMember = app.db.prepare(
        `INSERT INTO demo_user_memberships(project_id,user_id,display_name,roles_json,revision,demo)
         VALUES (?,?,?,?,1,1)`,
      );
      insertMember.run(manifest.projectId, 'zz-member', '마지막 후보', JSON.stringify(['PRIVATE_ROLE_SENTINEL']));
      insertMember.run(manifest.projectId, 'aa-member', '첫 후보', JSON.stringify(['PRIVATE_ROLE_SENTINEL']));
      const changed = readGenerationBasis(app.db, scope);
      if (changed === undefined) throw new Error('멤버 변경 후 basis가 없습니다.');
      expect(changed.participants.members.map(({ userId }) => userId)).toEqual(
        [...changed.participants.members.map(({ userId }) => userId)].sort(),
      );
      const changedSnapshot = prepareGenerationSnapshot(
        { taskKind: 'QUESTION_PROPOSALS' }, changed, Object.freeze([]),
      );
      expect(changedSnapshot.contentFingerprint).not.toBe(initialSnapshot.contentFingerprint);
      expect(changedSnapshot.canonicalJson).toContain('"participants"');
      expect(changedSnapshot.canonicalJson).not.toMatch(
        /roles|authority|credential|PRIVATE_ROLE_SENTINEL|OTHER_PROJECT_SECRET/u,
      );
    } finally {
      await app.close();
    }
  });

  it('저장 JSON/row codec 손상만 typed GenerationBasisReadError로 구분합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    cleanups.push(fixture.close);
    seedDemo(fixture.db);
    const srId = manifest.srIds['PAY-102'];
    fixture.db.transaction(() => {
      fixture.db.prepare(
        `INSERT INTO sr_description_versions(
           project_id,sr_id,description_id,version,title,purpose,description,author_id,
           created_at,previous_version,change_reason,payload_json
         ) SELECT project_id,sr_id,description_id,2,title,purpose,description,author_id,
                  '2026-09-09T09:00:00.000Z',1,'codec corruption fixture','[]'
             FROM sr_description_versions
            WHERE project_id=? AND sr_id=? AND version=1`,
      ).run(manifest.projectId, srId);
      fixture.db.prepare(
        `UPDATE srs SET current_description_version=2,revision=revision+1,
                        updated_at='2026-09-09T09:00:00.000Z'
          WHERE project_id=? AND sr_id=?`,
      ).run(manifest.projectId, srId);
    }).immediate();

    expect(() => readGenerationBasis(fixture.db, {
      kind: 'sr', projectId: manifest.projectId, srId,
    })).toThrow(GenerationBasisReadError);
  });

  it('예기치 않은 DB/programmer 오류는 codec 손상으로 감싸지 않습니다', () => {
    const unexpected = new TypeError('unexpected programmer error');
    const db = {
      prepare(): never {
        throw unexpected;
      },
    } as unknown as Parameters<typeof readGenerationBasis>[0];

    try {
      readGenerationBasis(db, { kind: 'sr', projectId: 'project', srId: 'sr' });
      throw new Error('예기치 않은 오류가 발생해야 합니다.');
    } catch (error) {
      expect(error).toBe(unexpected);
      expect(error).not.toBeInstanceOf(GenerationBasisReadError);
    }
  });

  it('실제 DB의 현재 원문·선택 답변·확정 결정·분류·문서 구조를 읽습니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    cleanups.push(fixture.close);
    seedDemo(fixture.db);
    const scope = {
      kind: 'sr' as const,
      projectId: manifest.projectId,
      srId: manifest.srIds['PAY-102'],
    };
    const basis = readGenerationBasis(fixture.db, scope);

    expect(basis).toMatchObject({
      scope,
      workflowVersion: 'v1.0.1',
      participants: {
        ownerId: manifest.defaultActorId,
        members: expect.arrayContaining([
          { userId: manifest.defaultActorId, displayName: expect.any(String) },
        ]),
      },
      currentDescription: {
        ref: { kind: 'sr_description', version: 1 },
        description: '고객이 승인된 결제를 취소할 수 있도록 합니다.',
      },
      questions: [{
        resultRef: { kind: 'question_result', version: 1 },
        text: expect.any(String),
        selectedAnswer: null,
        classificationRef: { kind: 'scope_classification', version: 1 },
      }],
      decisions: [{
        definition: { prompt: '결제 취소 가능 기간을 선택합니다.' },
        currentVersion: { ref: { kind: 'decision', version: 1 }, selectedOption: 'seven-days' },
      }],
      artifacts: [{
        ref: { kind: 'artifact', version: 1 },
        kind: 'requirements',
        markdown: expect.stringContaining('REQ-PAY-102'),
        sectionIndex: expect.any(Array),
        requirementLinks: expect.any(Array),
      }],
    });
    expect(basis?.classifications).toHaveLength(2);
    expect(basis?.artifacts[0]).not.toHaveProperty('payload');

    const planningBasis = readGenerationBasis(fixture.db, {
      kind: 'sr', projectId: manifest.projectId, srId: manifest.srIds['AUTH-331'],
    });
    expect(planningBasis?.artifacts.find((artifact) => artifact.kind === 'workflow_plan'))
      .toMatchObject({
        markdown: expect.any(String),
        sectionIndex: expect.any(Array),
        requirementLinks: expect.any(Array),
        workflowPlan: {
          workflowVersion: 'v1.0.1',
          stages: expect.any(Array),
          implementationUnitCount: 1,
          requirementTaskLinks: expect.any(Array),
        },
      });
  });

  it('현재 source의 확인 근거와 선택된 실제 answer 원문을 함께 읽습니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    cleanups.push(fixture.close);
    seedDemo(fixture.db);
    const srId = manifest.srIds['PAY-102'];
    const questionId = manifest.entityIds['PAY-102'].questionId;
    const requesterId = manifest.personaIds['P-02'];
    const classification = fixture.db.prepare(
      `SELECT classification_id,classification_version FROM questions
        WHERE project_id=? AND sr_id=? AND question_id=?`,
    ).get(manifest.projectId, srId, questionId) as {
      classification_id: string; classification_version: number;
    };
    fixture.db.transaction(() => {
      fixture.db.prepare(
        `INSERT INTO context_sources(
           project_id,sr_id,source_id,current_version,revision,created_by,created_at,display_name
         ) VALUES(?,?,?,1,1,?,?,?)`,
      ).run(manifest.projectId, srId, 'source-policy', requesterId, '2026-09-09T03:00:00.000Z', '정책 원문');
      fixture.db.prepare(
        `INSERT INTO context_source_versions(
           project_id,sr_id,source_id,version,kind,provenance,confirmation,created_by,created_at,
           content,target_url,confirmed_by,confirmed_at,confirmation_evidence,previous_version,payload_json
         ) VALUES(?,?,?,1,'markdown','customer-policy','confirmed',?,?,?,NULL,?,?,?,NULL,'{}')`,
      ).run(
        manifest.projectId, srId, 'source-policy', requesterId, '2026-09-09T03:00:00.000Z',
        ' 정책 첫 줄  \n둘째 줄\n', requesterId, '2026-09-09T03:01:00.000Z', '요청자 확인',
      );
      fixture.db.prepare(
        `INSERT INTO question_answer_versions(
           project_id,sr_id,question_id,answer_id,version,answered_snapshot_version,answer_text,
           evidence_json,answered_by,answered_at,previous_version,selected_option_id,payload_json
         ) VALUES(?,?,?,?,1,1,?,?,?, ?,NULL,NULL,'{}')`,
      ).run(
        manifest.projectId, srId, questionId, 'answer-policy', ' 답변 첫 줄  \n둘째 줄\n',
        JSON.stringify({ refs: [{ kind: 'context_source', projectId: manifest.projectId, srId,
          entityId: 'source-policy', version: 1 }] }),
        requesterId, '2026-09-09T03:02:00.000Z',
      );
      fixture.db.prepare(
        `INSERT INTO question_result_snapshots(
           project_id,sr_id,question_id,version,text,reason,assignee_id,answer_mode,options_json,status,
           classification_id,classification_version,evidence_refs_json,captured_at,
           selected_answer_id,selected_answer_version,payload_json
         ) SELECT project_id,sr_id,question_id,2,text,reason,assignee_id,answer_mode,options_json,'answered',
                  ?,?,?,'2026-09-09T03:03:00.000Z','answer-policy',1,payload_json
             FROM question_result_snapshots
            WHERE project_id=? AND sr_id=? AND question_id=? AND version=1`,
      ).run(
        classification.classification_id, classification.classification_version,
        JSON.stringify([{ kind: 'context_source', projectId: manifest.projectId, srId,
          entityId: 'source-policy', version: 1 }]),
        manifest.projectId, srId, questionId,
      );
      fixture.db.prepare(
        `UPDATE questions SET current_result_version=2,status='answered',revision=revision+1
          WHERE project_id=? AND sr_id=? AND question_id=?`,
      ).run(manifest.projectId, srId, questionId);
    }).immediate();

    const basis = readGenerationBasis(fixture.db, { kind: 'sr', projectId: manifest.projectId, srId });
    expect(basis?.sources).toEqual([expect.objectContaining({
      content: ' 정책 첫 줄  \n둘째 줄\n',
      confirmation: 'confirmed',
      confirmationEvidence: '요청자 확인',
    })]);
    expect(basis?.questions[0]?.selectedAnswer).toMatchObject({
      ref: { kind: 'question_answer', entityId: 'answer-policy', version: 1 },
      answerText: ' 답변 첫 줄  \n둘째 줄\n',
      evidence: { refs: [{ kind: 'context_source', entityId: 'source-policy', version: 1 }] },
    });
  });

  it('link source의 검증 가능성 정보를 보존하고 저장된 위험 URL을 거절합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    cleanups.push(fixture.close);
    seedDemo(fixture.db);
    const srId = manifest.srIds['PAY-102'];
    const requesterId = manifest.personaIds['P-02'];
    fixture.db.transaction(() => {
      fixture.db.prepare(
        `INSERT INTO context_sources(
           project_id,sr_id,source_id,current_version,revision,created_by,created_at,display_name
         ) VALUES(?,?,?,1,1,?,?,?)`,
      ).run(manifest.projectId, srId, 'source-link', requesterId, '2026-09-09T03:10:00.000Z', '외부 정책');
      fixture.db.prepare(
        `INSERT INTO context_source_versions(
           project_id,sr_id,source_id,version,kind,provenance,confirmation,created_by,created_at,
           content,target_url,confirmed_by,confirmed_at,confirmation_evidence,previous_version,payload_json
         ) VALUES(?,?,?,1,'link','customer-policy','unconfirmed',?,?,NULL,?,NULL,NULL,NULL,NULL,?)`,
      ).run(
        manifest.projectId,
        srId,
        'source-link',
        requesterId,
        '2026-09-09T03:10:00.000Z',
        'https://example.com/policy',
        JSON.stringify({
          verifiable: false,
          observedExternalVersion: 'policy-v1',
          unavailableReason: '오프라인 환경입니다.',
        }),
      );
    }).immediate();

    const scope = { kind: 'sr' as const, projectId: manifest.projectId, srId };
    expect(readGenerationBasis(fixture.db, scope)?.sources).toContainEqual(expect.objectContaining({
      kind: 'link',
      targetUrl: 'https://example.com/policy',
      verifiable: false,
      observedExternalVersion: 'policy-v1',
      unavailableReason: '오프라인 환경입니다.',
    }));

    fixture.db.transaction(() => {
      fixture.db.prepare(
        `INSERT INTO context_sources(
           project_id,sr_id,source_id,current_version,revision,created_by,created_at,display_name
         ) VALUES(?,?,?,1,1,?,?,?)`,
      ).run(manifest.projectId, srId, 'source-danger', requesterId, '2026-09-09T03:11:00.000Z', '위험 링크');
      fixture.db.prepare(
        `INSERT INTO context_source_versions(
           project_id,sr_id,source_id,version,kind,provenance,confirmation,created_by,created_at,
           content,target_url,confirmed_by,confirmed_at,confirmation_evidence,previous_version,payload_json
         ) VALUES(?,?,?,1,'link','customer-policy','unconfirmed',?,?,NULL,?,NULL,NULL,NULL,NULL,?)`,
      ).run(
        manifest.projectId,
        srId,
        'source-danger',
        requesterId,
        '2026-09-09T03:11:00.000Z',
        'javascript:alert(1)',
        JSON.stringify({ verifiable: false }),
      );
    }).immediate();
    expect(() => readGenerationBasis(fixture.db, scope)).toThrow(/허용 정책/u);
  });

  it('현재 결과가 참조하는 정확한 classification version만 입력에 포함합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    cleanups.push(fixture.close);
    seedDemo(fixture.db);
    const srId = manifest.srIds['PAY-102'];
    const questionId = manifest.entityIds['PAY-102'].questionId;
    const classification = fixture.db.prepare(
      `SELECT * FROM scope_classification_versions
        WHERE project_id=? AND sr_id=? AND target_kind='question'`,
    ).get(manifest.projectId, srId) as Record<string, unknown>;
    fixture.db.transaction(() => {
      fixture.db.prepare(
        `INSERT INTO scope_classification_versions(
           project_id,sr_id,classification_id,version,target_kind,target_id,scope,required_gate,
           reason,classified_by,classified_at,previous_version,owner_id,revisit_at,revisit_event,payload_json
         ) VALUES(?,?,?,2,?,?,?,?,'재분류 근거',?,'2026-09-09T03:10:00.000Z',1,?,?,?,?)`,
      ).run(
        manifest.projectId, srId, classification.classification_id,
        classification.target_kind, classification.target_id, classification.scope,
        classification.required_gate, classification.classified_by,
        classification.owner_id, classification.revisit_at, classification.revisit_event,
        classification.payload_json,
      );
      fixture.db.prepare(
        `INSERT INTO question_result_snapshots(
           project_id,sr_id,question_id,version,text,reason,assignee_id,answer_mode,options_json,status,
           classification_id,classification_version,evidence_refs_json,captured_at,
           selected_answer_id,selected_answer_version,payload_json
         ) SELECT project_id,sr_id,question_id,2,text,reason,assignee_id,answer_mode,options_json,status,
                  classification_id,2,evidence_refs_json,'2026-09-09T03:11:00.000Z',
                  selected_answer_id,selected_answer_version,payload_json
             FROM question_result_snapshots
            WHERE project_id=? AND sr_id=? AND question_id=? AND version=1`,
      ).run(manifest.projectId, srId, questionId);
      fixture.db.prepare(
        `UPDATE questions SET current_result_version=2,revision=revision+1
          WHERE project_id=? AND sr_id=? AND question_id=?`,
      ).run(manifest.projectId, srId, questionId);
    }).immediate();

    const basis = readGenerationBasis(fixture.db, { kind: 'sr', projectId: manifest.projectId, srId });
    const questionClassificationId = String(classification.classification_id);
    expect(basis?.questions[0]?.classificationRef).toMatchObject({
      kind: 'scope_classification', entityId: questionClassificationId, version: 2,
    });
    expect(basis?.classifications.filter((item) => {
      const ref = item.ref as { entityId: string; version: number };
      return ref.entityId === questionClassificationId;
    })).toEqual([expect.objectContaining({
      ref: expect.objectContaining({ entityId: questionClassificationId, version: 2 }),
      reason: '재분류 근거',
    })]);
  });

  it('JSON ref가 다른 SR을 가리키거나 실제 row kind와 맞지 않으면 거절합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    cleanups.push(fixture.close);
    seedDemo(fixture.db);
    const srId = manifest.srIds['PAY-102'];
    const invalidPayload = JSON.stringify({
      sourceRefs: [{
        kind: 'context_source', projectId: manifest.projectId,
        srId: manifest.srIds['CAT-093'], entityId: 'missing', version: 1,
      }],
    });
    fixture.db.transaction(() => {
      fixture.db.prepare(
        `INSERT INTO artifact_versions(
           project_id,sr_id,artifact_id,kind,version,markdown,section_index_json,
           requirement_links_json,author_origin,author_id,created_at,change_summary,
           previous_version,draft_application_id,input_snapshot_id,payload_json
         )
         SELECT project_id,sr_id,artifact_id,kind,2,markdown,section_index_json,
                requirement_links_json,author_origin,author_id,created_at,'invalid ref fixture',
                1,NULL,NULL,?
           FROM artifact_versions
          WHERE project_id=? AND sr_id=? AND kind='requirements' AND version=1`,
      ).run(invalidPayload, manifest.projectId, srId);
      fixture.db.prepare(
        `UPDATE artifacts SET current_version=2,revision=revision+1
          WHERE project_id=? AND sr_id=? AND kind='requirements'`,
      ).run(manifest.projectId, srId);
    }).immediate();

    expect(() => readGenerationBasis(fixture.db, {
      kind: 'sr', projectId: manifest.projectId, srId,
    })).toThrow(/같은 SR|실제 row/);
  });

  it('같은 SR의 실제 ID라도 ref kind와 row kind가 다르면 거절합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    cleanups.push(fixture.close);
    seedDemo(fixture.db);
    const srId = manifest.srIds['PAY-102'];
    const invalidPayload = JSON.stringify({
      decisionRefs: [{
        kind: 'decision', projectId: manifest.projectId, srId,
        entityId: manifest.entityIds['PAY-102'].questionId, version: 1,
      }],
    });
    fixture.db.transaction(() => {
      fixture.db.prepare(
        `INSERT INTO artifact_versions(
           project_id,sr_id,artifact_id,kind,version,markdown,section_index_json,
           requirement_links_json,author_origin,author_id,created_at,change_summary,
           previous_version,draft_application_id,input_snapshot_id,payload_json
         )
         SELECT project_id,sr_id,artifact_id,kind,2,markdown,section_index_json,
                requirement_links_json,author_origin,author_id,created_at,'wrong kind fixture',
                1,NULL,NULL,?
           FROM artifact_versions
          WHERE project_id=? AND sr_id=? AND kind='requirements' AND version=1`,
      ).run(invalidPayload, manifest.projectId, srId);
      fixture.db.prepare(
        `UPDATE artifacts SET current_version=2,revision=revision+1
          WHERE project_id=? AND sr_id=? AND kind='requirements'`,
      ).run(manifest.projectId, srId);
    }).immediate();

    expect(() => readGenerationBasis(fixture.db, {
      kind: 'sr', projectId: manifest.projectId, srId,
    })).toThrow(/실제 row/);
  });

  it('알 수 없는 kind와 다른 scope를 가진 known ref 필드를 조용히 모델 입력으로 통과시키지 않습니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    cleanups.push(fixture.close);
    seedDemo(fixture.db);
    const srId = manifest.srIds['PAY-102'];
    const invalidPayload = JSON.stringify({
      decisionRefs: [{
        kind: 'unknown_version_kind', projectId: 'other-project', srId: 'other-sr',
        entityId: 'missing', version: 1,
      }],
    });
    fixture.db.transaction(() => {
      fixture.db.prepare(
        `INSERT INTO artifact_versions(
           project_id,sr_id,artifact_id,kind,version,markdown,section_index_json,
           requirement_links_json,author_origin,author_id,created_at,change_summary,
           previous_version,draft_application_id,input_snapshot_id,payload_json
         )
         SELECT project_id,sr_id,artifact_id,kind,2,markdown,section_index_json,
                requirement_links_json,author_origin,author_id,created_at,'unknown ref fixture',
                1,NULL,NULL,?
           FROM artifact_versions
          WHERE project_id=? AND sr_id=? AND kind='requirements' AND version=1`,
      ).run(invalidPayload, manifest.projectId, srId);
      fixture.db.prepare(
        `UPDATE artifacts SET current_version=2,revision=revision+1
          WHERE project_id=? AND sr_id=? AND kind='requirements'`,
      ).run(manifest.projectId, srId);
    }).immediate();

    expect(() => readGenerationBasis(fixture.db, {
      kind: 'sr', projectId: manifest.projectId, srId,
    })).toThrow(/decision|참조|ref/i);
  });

  it('object key와 참조 집합 순서만 안정화하고 의미 배열·Unicode·공백·줄바꿈은 보존합니다', () => {
    expect(canonicalJson({ z: 1, a: ['둘', '하나'], text: ' 한글  \n' }))
      .toBe('{"a":["둘","하나"],"text":" 한글  \\n","z":1}');
    const firstRef = { kind: 'artifact', entityId: '가' };
    const secondRef = { kind: 'artifact', entityId: '나' };
    expect(canonicalJson({ sourceRefs: [secondRef, firstRef] }))
      .toBe(canonicalJson({ sourceRefs: [firstRef, secondRef] }));
    expect(canonicalJson({ options: ['둘', '하나'] }))
      .not.toBe(canonicalJson({ options: ['하나', '둘'] }));
  });

  it('현재 basis와 규칙 content를 지문에 넣고 provider/runtime/capturedAt 없이 같은 입력을 재현합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    cleanups.push(fixture.close);
    seedDemo(fixture.db);
    const basis = readGenerationBasis(fixture.db, {
      kind: 'sr', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
    });
    if (basis === undefined) throw new Error('basis missing');
    const rules = Object.freeze([Object.freeze({
      logicalId: 'human-confirmation', version: 'sha256:rule', content: '사람이 확정합니다.\n',
    })]);
    const input = { taskKind: 'QUESTION_PROPOSALS' as const, supplement: ' 공백  \n보존 ' };
    const first = prepareGenerationSnapshot(input, basis, rules);
    const second = prepareGenerationSnapshot(input, basis, rules);
    const typedRefs: readonly VersionRef[] = first.basisRefs;

    expect(first).toEqual(second);
    expect(first.contentFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.canonicalJson).toContain(' 공백  \\n보존 ');
    expect(first.canonicalJson).not.toMatch(/provider|runtime|capturedAt/);
    expect(first.projectRuleVersions).toEqual([
      { logicalId: 'human-confirmation', version: 'sha256:rule' },
    ]);
    expect(typedRefs.length).toBeGreaterThan(3);
  });

  it('canonical basis ref만 명시 snapshot ref로 고정하고 저장 content JSON을 재귀 해석하지 않습니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    cleanups.push(fixture.close);
    seedDemo(fixture.db);
    const scope = {
      kind: 'sr' as const,
      projectId: manifest.projectId,
      srId: manifest.srIds['PAY-102'],
    };
    const basis = readGenerationBasis(fixture.db, scope);
    if (basis === undefined) throw new Error('basis missing');
    const rules = loadProjectRuleSource(process.cwd()).rules;
    const prepared = prepareGenerationSnapshot({ taskKind: 'QUESTION_PROPOSALS' }, basis, rules);
    const legacyContents = snapshotContents(basis);
    const legacyJson = JSON.stringify(legacyContents);
    fixture.db.prepare(
      `INSERT INTO input_snapshots(
         project_id,sr_id,snapshot_id,workflow_version,task_kind,content_fingerprint,
         contents_json,project_rules_json,captured_at,document_kind,target_basis_json,supplement
       ) VALUES(?,?,?,'v1.0.1','QUESTION_PROPOSALS',?,?,?,'2026-09-09T09:59:00.000Z',NULL,NULL,NULL)`,
    ).run(
      scope.projectId,
      scope.srId,
      'legacy-snapshot-with-nested-refs',
      prepared.contentFingerprint,
      legacyJson,
      JSON.stringify(rules),
    );
    const stored = fixture.db.transaction(() => insertInputSnapshot(fixture.db, {
      basis,
      prepared,
      projectRules: rules,
      capturedAt: '2026-09-09T10:00:00.000Z',
    })).immediate();

    expect([...allowedGenerationSourceRefKeys(stored.contents)].sort()).toEqual(
      prepared.basisRefs.map(generationSourceRefKey).sort(),
    );
    expect(fixture.db.prepare(
      'SELECT contents_json FROM input_snapshots WHERE project_id=? AND sr_id=? AND snapshot_id=?',
    ).get(scope.projectId, scope.srId, 'legacy-snapshot-with-nested-refs')).toEqual({
      contents_json: legacyJson,
    });
    expect(allowedGenerationSourceRefKeys([{
      ref: { kind: 'sr', projectId: scope.projectId, srId: scope.srId, entityId: scope.srId },
      content: JSON.stringify({ nested: prepared.basisRefs[0] }),
      confirmation: 'not_applicable',
    }])).toEqual(new Set());
    expect(() => decodeSnapshotContents(JSON.stringify([{
      ref: {
        kind: 'review_policy', projectId: scope.projectId, srId: scope.srId,
        entityId: 'policy-with-sr-scope', version: 1,
      },
      content: 'SR scope가 섞인 project ref입니다.',
      confirmation: 'not_applicable',
    }]), scope)).toThrow(InputSnapshotRepositoryError);
  });

  it('artifact revision의 target은 같은 SR·종류의 정확한 current version이어야 합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    cleanups.push(fixture.close);
    seedDemo(fixture.db);
    const basis = readGenerationBasis(fixture.db, {
      kind: 'sr', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
    });
    if (basis === undefined) throw new Error('basis missing');
    const rules = Object.freeze([]);
    expect(() => prepareGenerationSnapshot({
      taskKind: 'ARTIFACT_REVISION', documentKind: 'requirements',
      targetBasis: {
        kind: 'version',
        ref: {
          kind: 'artifact', projectId: manifest.projectId,
          srId: manifest.srIds['PAY-102'], entityId: 'wrong', version: 1,
        },
      },
    }, basis, rules)).toThrow(GenerationInputBasisError);
  });

  it('설계 단계별 logical key와 정확한 현재 version target을 구분합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    cleanups.push(fixture.close);
    seedDemo(fixture.db);
    const basis = readGenerationBasis(fixture.db, {
      kind: 'sr', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
    });
    if (basis === undefined) throw new Error('basis missing');
    const requirements = basis.artifacts.find((artifact) => artifact.kind === 'requirements');
    if (requirements === undefined) throw new Error('requirements missing');
    const revision = prepareGenerationSnapshot({
      taskKind: 'ARTIFACT_REVISION', documentKind: 'requirements',
      targetBasis: { kind: 'version', ref: requirements.ref },
    }, basis, Object.freeze([]));
    const draft = prepareGenerationSnapshot({
      taskKind: 'ARTIFACT_DRAFT', documentKind: 'design',
      targetBasis: { kind: 'absent', logicalKey: 'design:functional' },
    }, basis, Object.freeze([]));

    expect(artifactLogicalTarget('requirements')).toEqual({
      kind: 'requirements', logicalKey: 'requirements',
    });
    expect(artifactLogicalTarget('design', 'functional')).toEqual({
      kind: 'design', designStage: 'functional', logicalKey: 'design:functional',
    });
    expect(() => artifactLogicalTarget('design')).toThrow(/단계|stage/i);
    expect(revision.canonicalJson).toContain(`"entityId":"${String((requirements.ref as { entityId: string }).entityId)}"`);
    expect(draft.targetArtifactKey).toBe('design:functional');
    expect(() => prepareGenerationSnapshot({
      taskKind: 'ARTIFACT_DRAFT', documentKind: 'design',
      targetBasis: { kind: 'absent', logicalKey: 'design' },
    }, basis, Object.freeze([]))).toThrow(GenerationInputBasisError);
    expect(() => prepareGenerationSnapshot({
      taskKind: 'ARTIFACT_DRAFT', documentKind: 'requirements',
      targetBasis: { kind: 'absent', logicalKey: 'requirements' },
    }, basis, Object.freeze([]))).toThrow(GenerationInputBasisError);

    const planningBasis = readGenerationBasis(fixture.db, {
      kind: 'sr', projectId: manifest.projectId, srId: manifest.srIds['AUTH-331'],
    });
    if (planningBasis === undefined) throw new Error('planning basis missing');
    const design = planningBasis.artifacts.find((artifact) => artifact.kind === 'design');
    if (design === undefined) throw new Error('design missing');
    expect(design.designStage).toBe('functional');
    expect(prepareGenerationSnapshot({
      taskKind: 'ARTIFACT_REVISION', documentKind: 'design',
      targetBasis: { kind: 'version', ref: design.ref },
    }, planningBasis, Object.freeze([])).targetArtifactKey).toBe('design:functional');
    expect(prepareGenerationSnapshot({
      taskKind: 'ARTIFACT_DRAFT', documentKind: 'design',
      targetBasis: { kind: 'absent', logicalKey: 'design:application' },
    }, planningBasis, Object.freeze([])).targetArtifactKey).toBe('design:application');
    expect(() => prepareGenerationSnapshot({
      taskKind: 'ARTIFACT_DRAFT', documentKind: 'design',
      targetBasis: { kind: 'absent', logicalKey: 'design:functional' },
    }, planningBasis, Object.freeze([]))).toThrow(GenerationInputBasisError);
  });

  it('canonical UTF-8 입력이 2 MiB를 넘으면 거절하고 byte 경계를 정확히 허용합니다', () => {
    const basis = {
      scope: { kind: 'sr' as const, projectId: 'p', srId: 's' },
      workflowVersion: 'v1.0.1',
      participants: {
        ownerId: 'owner',
        members: [{ userId: 'owner', displayName: '담당자' }],
      },
      currentDescription: {
        ref: { kind: 'sr_description', projectId: 'p', srId: 's', entityId: 'd', version: 1 },
        title: '', purpose: '', description: '',
      },
      sources: [], questions: [], decisions: [], classifications: [], artifacts: [],
    } satisfies GenerationBasis;
    const rules = Object.freeze([]);
    const withEmptySupplement = prepareGenerationSnapshot(
      { taskKind: 'QUESTION_PROPOSALS', supplement: '' }, basis, rules,
    );
    const room = GENERATION_INPUT_MAX_BYTES - withEmptySupplement.byteLength;
    expect(prepareGenerationSnapshot(
      { taskKind: 'QUESTION_PROPOSALS', supplement: 'a'.repeat(room) }, basis, rules,
    ).byteLength).toBe(GENERATION_INPUT_MAX_BYTES);
    expect(() => prepareGenerationSnapshot(
      { taskKind: 'QUESTION_PROPOSALS', supplement: 'a'.repeat(room + 1) }, basis, rules,
    )).toThrow(GenerationInputTooLargeError);
    expect(() => prepareGenerationSnapshot(
      { taskKind: 'QUESTION_PROPOSALS', supplement: '한'.repeat(GENERATION_INPUT_MAX_BYTES) },
      basis,
      rules,
    )).toThrow(GenerationInputTooLargeError);
  });

  it('canonical 경계 안이어도 명시 InputSnapshot 직렬화가 2 MiB를 넘으면 저장하지 않습니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    cleanups.push(fixture.close);
    seedDemo(fixture.db);
    const basis = readGenerationBasis(fixture.db, {
      kind: 'sr', projectId: manifest.projectId, srId: manifest.srIds['PAY-102'],
    });
    if (basis === undefined) throw new Error('basis missing');
    const rules = loadProjectRuleSource(process.cwd()).rules;
    const empty = prepareGenerationSnapshot(
      { taskKind: 'QUESTION_PROPOSALS', supplement: '' }, basis, rules,
    );
    const prepared = prepareGenerationSnapshot({
      taskKind: 'QUESTION_PROPOSALS',
      supplement: 'a'.repeat(GENERATION_INPUT_MAX_BYTES - empty.byteLength),
    }, basis, rules);

    expect(prepared.byteLength).toBe(GENERATION_INPUT_MAX_BYTES);
    expect(() => fixture.db.transaction(() => insertInputSnapshot(fixture.db, {
      basis,
      prepared,
      projectRules: rules,
      capturedAt: '2026-09-09T10:01:00.000Z',
    })).immediate()).toThrow(GenerationInputTooLargeError);
    expect(fixture.db.prepare(
      'SELECT count(*) AS count FROM input_snapshots WHERE project_id=? AND sr_id=?',
    ).get(basis.scope.projectId, basis.scope.srId)).toEqual({ count: 0 });
  });
});
