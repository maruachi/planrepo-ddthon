import { describe, expect, it } from 'vitest';
import { FormDraft } from '@/src/web/state/form-draft';

const identity = {
  actorId: 'actor-a',
  scope: { kind: 'sr' as const, projectId: 'project-a', srId: 'sr-a' },
  target: 'description',
  form: 'edit-description',
};

describe('FormDraft', () => {
  it('새 서버 view가 와도 dirty 입력과 편집 기준을 덮어쓰지 않습니다', () => {
    const draft = new FormDraft(identity, { title: '저장본' }, { revision: 1 });
    draft.edit({ title: '작성 중' });
    draft.setFieldErrors({ title: '서버가 거절한 입력입니다.' });

    expect(draft.refreshFromServer({ title: '다른 저장본' }, { revision: 2 })).toBe(false);
    expect(draft.snapshot()).toMatchObject({
      input: { title: '작성 중' },
      basis: { revision: 1 },
      dirty: true,
      fieldErrors: { title: '서버가 거절한 입력입니다.' },
    });
  });

  it('확정된 저장본을 명시하면 dirty와 필드 오류를 지웁니다', () => {
    const draft = new FormDraft(identity, { title: '저장본' }, { revision: 1 });
    draft.edit({ title: '작성 중' });
    draft.setFieldErrors({ title: '이전 오류' });

    draft.markSaved({ title: '확정본' }, { revision: 2 });

    expect(draft.snapshot()).toMatchObject({
      input: { title: '확정본' },
      basis: { revision: 2 },
      dirty: false,
      fieldErrors: {},
    });
  });

  it('clean 폼은 새 서버 view를 반영하고 명시 폐기는 dirty 입력을 초기화합니다', () => {
    const draft = new FormDraft(identity, { title: '저장본' }, { revision: 1 });

    expect(draft.refreshFromServer({ title: '새 저장본' }, { revision: 2 })).toBe(true);
    draft.edit({ title: '작성 중' });
    draft.discard({ title: '최신 저장본' }, { revision: 3 });

    expect(draft.snapshot()).toMatchObject({
      input: { title: '최신 저장본' },
      basis: { revision: 3 },
      dirty: false,
      fieldErrors: {},
    });
  });

  it('identity와 입력을 deep snapshot해 다른 scope로 흘리지 않습니다', () => {
    const mutableIdentity = {
      ...identity,
      scope: { ...identity.scope },
    };
    const mutableInput = { nested: { value: '원본' } };
    const draft = new FormDraft(mutableIdentity, mutableInput, { revision: 1 });

    mutableIdentity.scope.srId = 'sr-b';
    mutableInput.nested.value = '변경';

    expect(draft.snapshot()).toMatchObject({
      identity: { scope: { srId: 'sr-a' } },
      input: { nested: { value: '원본' } },
    });
  });

  it('dirty 입력을 보존하며 최신 server view를 비교 후보로 저장합니다', () => {
    const draft = new FormDraft(identity, { title: '저장본' }, { revision: 1 });
    draft.edit({ title: '작성 중' });

    expect(draft.refreshFromServer({ title: '최신 저장본' }, { revision: 2 })).toBe(false);
    expect(draft.snapshot()).toMatchObject({
      input: { title: '작성 중' },
      basis: { revision: 1 },
      dirty: true,
      latestServer: {
        input: { title: '최신 저장본' },
        basis: { revision: 2 },
      },
    });
  });

  it('같은 identity에서만 최신 basis를 명시 채택하고 dirty 입력은 유지합니다', () => {
    const draft = new FormDraft(identity, { title: '저장본' }, { revision: 1 });
    draft.edit({ title: '작성 중' });
    draft.refreshFromServer({ title: '최신 저장본' }, { revision: 2 });

    expect(draft.adoptLatestBasis({ ...identity, target: 'other-source' })).toBe(false);
    expect(draft.adoptLatestBasis(identity)).toBe(true);
    expect(draft.snapshot()).toMatchObject({
      input: { title: '작성 중' },
      basis: { revision: 2 },
      dirty: true,
    });
    expect(draft.snapshot()).not.toHaveProperty('latestServer');
    expect(draft.adoptLatestBasis(identity)).toBe(false);
  });

  it('같은 identity의 최신 server view로 작성 중 입력을 명시 폐기합니다', () => {
    const draft = new FormDraft(identity, { title: '저장본' }, { revision: 1 });
    draft.edit({ title: '작성 중' });
    draft.refreshFromServer({ title: '최신 저장본' }, { revision: 2 });

    expect(draft.discardToLatest({ ...identity, actorId: 'actor-b' })).toBe(false);
    expect(draft.discardToLatest(identity)).toBe(true);
    expect(draft.snapshot()).toMatchObject({
      input: { title: '최신 저장본' },
      basis: { revision: 2 },
      dirty: false,
    });
    expect(draft.snapshot()).not.toHaveProperty('latestServer');
  });
});
