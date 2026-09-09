import { useEffect, useRef, useState } from 'react';
import type { ArtifactDiffView, ArtifactView } from '@/src/contracts/views';
import { invoke } from '../api/client';

export function VersionComparison({ actorId, projectId, srId, artifact }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly srId: string;
  readonly artifact: ArtifactView;
}) {
  const [comparison, setComparison] = useState<ArtifactDiffView>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const requestSequence = useRef(0);

  useEffect(() => {
    requestSequence.current += 1;
    setComparison(undefined);
    setError(undefined);
    setLoading(false);
  }, [artifact.versionRef.version]);

  if (artifact.previousVersionRef === undefined) {
    return <p className="quiet">비교할 이전 version이 없습니다.</p>;
  }

  const compare = async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(undefined);
    try {
      const result = await invoke('M-016', { actorId, projectId, srId }, {
        before: artifact.previousVersionRef!,
        after: artifact.versionRef,
      });
      if (!result.ok) {
        if (sequence === requestSequence.current) setError(result.error.message);
        return;
      }
      if (sequence === requestSequence.current) setComparison(result.value);
    } catch (caught) {
      if (sequence === requestSequence.current) {
        setError(caught instanceof Error ? caught.message : '문서 비교를 읽지 못했습니다.');
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  };

  return <section className="version-comparison" data-testid="version-comparison" aria-label="문서 version 비교">
    <button type="button" onClick={() => { void compare(); }} disabled={loading}>
      {loading ? '비교 중…' : '이전 버전과 비교'}
    </button>
    {error !== undefined && <p role="alert">{error}</p>}
    {comparison !== undefined && <>
      <div className="comparison-grid">
        <section>
          <h4>이전 v{comparison.before.versionRef.version}</h4>
          <pre data-testid="comparison-before">{comparison.before.markdown}</pre>
        </section>
        <section>
          <h4>이후 v{comparison.after.versionRef.version}</h4>
          <pre data-testid="comparison-after">{comparison.after.markdown}</pre>
        </section>
      </div>
      <dl className="comparison-summary">
        <div><dt>변경 요구사항</dt><dd>{comparison.changedRequirementIds.length === 0 ? '없음' : comparison.changedRequirementIds.join(', ')}</dd></div>
        <div><dt>변경 section</dt><dd>{comparison.changedSectionIds.length === 0 ? '없음' : comparison.changedSectionIds.join(', ')}</dd></div>
        <div><dt>변경 결정</dt><dd>{comparison.changedDecisionRefs.length === 0 ? '없음' : comparison.changedDecisionRefs.map((ref) => `${ref.entityId} v${ref.version}`).join(', ')}</dd></div>
      </dl>
    </>}
  </section>;
}
