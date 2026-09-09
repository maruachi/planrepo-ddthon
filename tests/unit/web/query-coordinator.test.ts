import { describe, expect, it } from 'vitest';
import {
  QueryCoordinator,
  type QueryKey,
} from '@/src/web/state/query-coordinator';

const detailKey: QueryKey = {
  actorId: 'actor-a',
  projectId: 'project-a',
  srId: 'sr-a',
  target: 'detail',
  methodId: 'M-047',
};

describe('QueryCoordinator', () => {
  it('같은 key의 최신 발행만 받아 Q2보다 늦은 Q1을 버립니다', () => {
    const coordinator = new QueryCoordinator();
    const q1 = coordinator.issue(detailKey);
    const q2 = coordinator.issue(detailKey);

    expect(q1.seq).toBe(1);
    expect(q2.seq).toBe(2);
    expect(coordinator.accept(q2.key, q2.seq, 'new')).toEqual({
      accepted: true,
      value: 'new',
    });
    expect(coordinator.accept(q1.key, q1.seq, 'old')).toEqual({
      accepted: false,
    });
  });

  it('A에서 B를 거쳐 A를 재발행하면 이전 A와 B 응답을 모두 버립니다', () => {
    const coordinator = new QueryCoordinator();
    const a1 = coordinator.issue(detailKey);
    const b = coordinator.issue({ ...detailKey, srId: 'sr-b' });
    const a2 = coordinator.issue(detailKey);

    expect(a2.seq).toBe(2);
    expect(coordinator.accept(a1.key, a1.seq, 'old-a')).toEqual({ accepted: false });
    expect(coordinator.accept(b.key, b.seq, 'b')).toEqual({ accepted: false });
    expect(coordinator.accept(a2.key, a2.seq, 'new-a')).toEqual({
      accepted: true,
      value: 'new-a',
    });
  });

  it('actor, project, SR, target, method를 각각 query key에 포함합니다', () => {
    const coordinator = new QueryCoordinator();
    const keys: QueryKey[] = [
      detailKey,
      { ...detailKey, actorId: 'actor-b' },
      { ...detailKey, projectId: 'project-b' },
      { ...detailKey, srId: 'sr-b' },
      { ...detailKey, target: 'activity' },
      { ...detailKey, methodId: 'M-048' },
    ];

    expect(keys.map((key) => coordinator.issue(key).seq)).toEqual([1, 1, 1, 1, 1, 1]);
  });
});
