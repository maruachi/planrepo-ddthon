import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  NoGuard,
  RevisionAndBundleGuard,
  RevisionGuard,
  SrScope,
} from '@/src/contracts/context';
import type { PublicMethodId } from '@/src/contracts/methods';
import type { DomainError } from '@/src/contracts/results';
import type {
  ArtifactView,
  ChangeApplication,
  ChangeConfirmation,
  ChangeFeedback,
  ChangeRequestInput,
  ChangeRequestView,
  CommentInput,
  CommentView,
  ReviewBundleSnapshot,
  ReviewConfigurationView,
  SRDetailView,
} from '@/src/contracts/views';
import type { BrowserInvokeResult } from '../api/client';
import { asCommandResult, invoke, TransportUncertainError } from '../api/client';
import { CommandSession, type CommandAttempt } from '../state/command-session';
import { CommandFeedback, type CommandFeedbackState } from './CommandFeedback';
import { SafeMarkdown } from './SafeMarkdown';

interface ReviewContext {
  readonly configuration: ReviewConfigurationView;
  readonly bundle: ReviewBundleSnapshot;
}

interface CommandController<I, G> {
  readonly feedback: CommandFeedbackState;
  readonly locked: boolean;
  submit(input: I, guard: G): void;
}

function sameArtifactRef(
  left: { readonly projectId: string; readonly srId: string; readonly entityId: string; readonly version: number },
  right: { readonly projectId: string; readonly srId: string; readonly entityId: string; readonly version: number },
): boolean {
  return left.projectId === right.projectId && left.srId === right.srId &&
    left.entityId === right.entityId && left.version === right.version;
}

function sameBundle(
  left: ReviewBundleSnapshot['bundleRef'] | undefined,
  right: ReviewBundleSnapshot['bundleRef'] | undefined,
): boolean {
  return left !== undefined && right !== undefined && left.projectId === right.projectId &&
    left.srId === right.srId && left.gate === right.gate && left.bundleId === right.bundleId &&
    left.version === right.version;
}

function currentReviewContexts(detail: SRDetailView, artifact: ArtifactView): readonly ReviewContext[] {
  return detail.reviewConfigurations.flatMap((configuration) => {
    if (configuration.currentBundleRef === undefined || configuration.needsNewBundle) return [];
    const bundle = detail.bundles.find((candidate) =>
      sameBundle(candidate.bundleRef, configuration.currentBundleRef) &&
      candidate.reviewEpoch === configuration.reviewEpoch &&
      candidate.artifactVersionRefs.some((ref) => sameArtifactRef(ref, artifact.versionRef)));
    return bundle === undefined ? [] : [{ configuration, bundle }];
  });
}

function preferredContext(contexts: readonly ReviewContext[], artifact: ArtifactView): ReviewContext | undefined {
  const preferredGate = artifact.kind === 'requirements' ? 'G1' : 'G2';
  return contexts.find(({ configuration }) => configuration.gate === preferredGate) ?? contexts[0];
}

function localError(error: unknown, fallback: string): DomainError {
  return {
    code: 'STORE_UNAVAILABLE',
    message: error instanceof Error ? error.message : fallback,
    blockers: [],
    assigneeIds: [],
    targetRefs: [],
  };
}

function useCommand<I, G, T>({
  actorId,
  scope,
  target,
  command,
  run,
  onCommitted,
  onSaved,
  failureMessage,
  committedMessage,
  replayedMessage,
}: {
  readonly actorId: string;
  readonly scope: SrScope;
  readonly target: string;
  readonly command: PublicMethodId;
  run(attempt: CommandAttempt<I, G>): Promise<BrowserInvokeResult<T>>;
  onCommitted(value: T): void;
  onSaved(): void;
  readonly failureMessage: string;
  readonly committedMessage: string;
  readonly replayedMessage: string;
}): CommandController<I, G> {
  const identity = `${actorId}:${scope.projectId}:${scope.srId}:${target}:${command}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const mounted = useRef(false);
  const session = useMemo(() => new CommandSession(), [identity]);
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    setFeedback({ kind: 'idle' });
    setLocked(false);
  }, [identity]);

  const execute = async (attempt: CommandAttempt<I, G>) => {
    if (!session.beginExecution(attempt)) return;
    setLocked(true);
    setFeedback({ kind: 'processing' });
    try {
      const response = await run(attempt);
      if (!mounted.current || currentIdentity.current !== identity) return;
      const resolved = session.resolve(attempt, asCommandResult(response), {
        actorId,
        scope,
        target,
        command,
      });
      if (!resolved.appliesToCurrentForm) return;
      if (resolved.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolved.result.error });
        return;
      }
      onCommitted(resolved.result.value);
      setFeedback(resolved.result.kind === 'replayed'
        ? { kind: 'replayed', message: replayedMessage, receiptId: resolved.result.priorReceipt.receiptId }
        : { kind: 'committed', message: committedMessage });
      onSaved();
    } catch (error) {
      if (!mounted.current || currentIdentity.current !== identity) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt)); } });
      } else {
        setFeedback({ kind: 'rejected', error: localError(error, failureMessage) });
      }
    } finally {
      session.endExecution(attempt);
      if (mounted.current && currentIdentity.current === identity) setLocked(false);
    }
  };

  return {
    feedback,
    locked: locked || feedback.kind === 'confirmation-required',
    submit(input, guard) {
      void execute(session.submit({ actorId, scope, target, command, input, guard }));
    },
  };
}

function sectionTitle(artifact: ArtifactView, sectionId: string): string {
  return artifact.sectionIndex.find((section) => section.sectionId === sectionId)?.title ?? '이전 문서의 문단';
}

function documentTitle(artifact: ArtifactView): string {
  if (artifact.kind === 'requirements') return '요구사항';
  if (artifact.kind === 'workflow_plan') return '진행 계획';
  if (artifact.kind === 'implementation_plan') return '구현 계획';
  if (artifact.designStage === 'application') return '애플리케이션 설계';
  if (artifact.designStage === 'functional') return '기능 설계';
  if (artifact.designStage === 'nfr') return '비기능 설계';
  return '인프라 설계';
}

function CommentComposer({ actorId, projectId, detail, artifact, sectionId, reviewContext, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView;
  readonly artifact: ArtifactView;
  readonly sectionId: string;
  readonly reviewContext?: ReviewContext;
  onSaved(): void;
}) {
  const [body, setBody] = useState('');
  const scope = detail.sr.scope;
  const controller = useCommand<CommentInput, NoGuard, CommentView>({
    actorId,
    scope,
    target: `${artifact.artifactId}:${artifact.versionRef.version}:${sectionId}:comment`,
    command: 'M-022',
    run: (attempt) => invoke('M-022', {
      actorId,
      projectId,
      srId: scope.srId,
      idempotencyKey: attempt.idempotencyKey,
    }, attempt.submission.input),
    onCommitted: () => setBody(''),
    onSaved,
    failureMessage: '댓글을 저장하지 못했습니다.',
    committedMessage: '문단에 댓글을 남겼습니다.',
    replayedMessage: '이미 저장된 댓글을 확인했습니다.',
  });
  return <form onSubmit={(event) => {
    event.preventDefault();
    if (body.trim().length === 0) return;
    controller.submit({
      artifactVersionRef: artifact.versionRef,
      sectionId,
      body,
      ...(reviewContext === undefined ? {} : { bundleRef: reviewContext.bundle.bundleRef }),
    }, { kind: 'none' });
  }}>
    <label>이 문단에 의견 남기기<textarea rows={3} required disabled={controller.locked} value={body} onChange={(event) => setBody(event.target.value)} /></label>
    <button type="submit" disabled={controller.locked || body.trim().length === 0}>댓글 저장</button>
    <CommandFeedback state={controller.feedback} />
  </form>;
}

function ChangeRequestComposer({ actorId, projectId, detail, artifact, sectionId, context, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView;
  readonly artifact: ArtifactView;
  readonly sectionId: string;
  readonly context: ReviewContext;
  onSaved(): void;
}) {
  const [body, setBody] = useState('');
  const scope = detail.sr.scope;
  const gate = context.configuration.gate;
  const controller = useCommand<ChangeRequestInput, RevisionAndBundleGuard<'review_gate_state'>, ChangeRequestView>({
    actorId,
    scope,
    target: `${artifact.artifactId}:${artifact.versionRef.version}:${sectionId}:change:${context.configuration.revision}:${context.bundle.bundleRef.bundleId}:${context.bundle.bundleRef.version}:${context.bundle.reviewEpoch}`,
    command: 'M-023',
    run: (attempt) => invoke('M-023', {
      actorId,
      projectId,
      srId: scope.srId,
      idempotencyKey: attempt.idempotencyKey,
      guard: attempt.submission.guard,
    }, attempt.submission.input),
    onCommitted: () => setBody(''),
    onSaved,
    failureMessage: '수정 요청을 저장하지 못했습니다.',
    committedMessage: '이 문단의 수정 요청을 등록했습니다.',
    replayedMessage: '이미 저장된 수정 요청을 확인했습니다.',
  });
  return <form onSubmit={(event) => {
    event.preventDefault();
    if (body.trim().length === 0) return;
    controller.submit({
      bundleRef: context.bundle.bundleRef,
      artifactVersionRef: artifact.versionRef,
      sectionId,
      body,
      blocking: true,
      affectedGate: gate,
      assigneeId: detail.sr.ownerId,
    }, {
      resource: {
        target: { kind: 'review_gate_state', projectId, srId: scope.srId, entityId: gate },
        expectedRevision: context.configuration.revision,
      },
      expectedBundleRef: context.bundle.bundleRef,
      expectedReviewEpoch: context.bundle.reviewEpoch,
    });
  }}>
    <label>고쳐야 할 내용<textarea rows={3} required disabled={controller.locked} value={body} onChange={(event) => setBody(event.target.value)} /></label>
    <p className="quiet">현재 문서 검토에 연결되며, 문서 담당자가 해결하기 전까지 검토 완료를 막습니다.</p>
    <button type="submit" disabled={controller.locked || body.trim().length === 0}>수정 요청</button>
    <CommandFeedback state={controller.feedback} />
  </form>;
}

function ChangeRequestCard({ actorId, projectId, detail, artifact, request, actorName, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView;
  readonly artifact: ArtifactView;
  readonly request: ChangeRequestView;
  readonly actorName: (id: string) => string;
  onSaved(): void;
}) {
  const [applicationSummary, setApplicationSummary] = useState('');
  const [confirmationNote, setConfirmationNote] = useState('');
  const [furtherChange, setFurtherChange] = useState('');
  const scope = detail.sr.scope;
  const exactCurrentTarget = request.currentTargetRef.kind === 'artifact' &&
    sameArtifactRef(request.currentTargetRef, artifact.versionRef);
  const currentSection = artifact.sectionIndex.find((section) => section.sectionId === request.originalSectionId);
  const currentSectionText = currentSection === undefined
    ? ''
    : artifact.markdown.slice(currentSection.startOffset, currentSection.endOffset).trim();
  const currentSectionEvidence = currentSection === undefined || currentSectionText.length === 0
    ? undefined
    : `현재 문서 v${artifact.versionRef.version}의 "${currentSection.title}" 문단 본문:\n${currentSectionText.slice(0, 60_000)}`;
  const configuration = detail.reviewConfigurations.find((item) => item.gate === request.affectedGate);
  const canApply = request.status === 'open' && exactCurrentTarget && currentSectionEvidence !== undefined &&
    (request.assigneeId === actorId || detail.sr.ownerId === actorId);
  const canReview = request.status === 'awaiting_confirmation' && exactCurrentTarget &&
    (request.requesterId === actorId || configuration?.assignment?.reviewerIds.includes(actorId) === true);

  const application = useCommand<ChangeApplication, RevisionGuard<'change_request'>, ChangeRequestView>({
    actorId,
    scope,
    target: `${request.changeRequestId}:${request.revision}:apply`,
    command: 'M-024',
    run: (attempt) => invoke('M-024', { actorId, projectId, srId: scope.srId, idempotencyKey: attempt.idempotencyKey, guard: attempt.submission.guard }, attempt.submission.input),
    onCommitted: () => setApplicationSummary(''),
    onSaved,
    failureMessage: '수정 반영 결과를 저장하지 못했습니다.',
    committedMessage: '수정 반영 결과를 보냈습니다.',
    replayedMessage: '이미 보낸 수정 반영 결과를 확인했습니다.',
  });
  const confirmation = useCommand<ChangeConfirmation, RevisionGuard<'change_request'>, ChangeRequestView>({
    actorId,
    scope,
    target: `${request.changeRequestId}:${request.revision}:${request.currentApplicationEventRef?.entityId ?? 'none'}:confirm`,
    command: 'M-025',
    run: (attempt) => invoke('M-025', { actorId, projectId, srId: scope.srId, idempotencyKey: attempt.idempotencyKey, guard: attempt.submission.guard }, attempt.submission.input),
    onCommitted: () => setConfirmationNote(''),
    onSaved,
    failureMessage: '해결 확인을 저장하지 못했습니다.',
    committedMessage: '수정 요청이 해결됐음을 확인했습니다.',
    replayedMessage: '이미 저장된 해결 확인을 확인했습니다.',
  });
  const further = useCommand<ChangeFeedback, RevisionGuard<'change_request'>, ChangeRequestView>({
    actorId,
    scope,
    target: `${request.changeRequestId}:${request.revision}:${request.currentApplicationEventRef?.entityId ?? 'none'}:further`,
    command: 'M-026',
    run: (attempt) => invoke('M-026', { actorId, projectId, srId: scope.srId, idempotencyKey: attempt.idempotencyKey, guard: attempt.submission.guard }, attempt.submission.input),
    onCommitted: () => setFurtherChange(''),
    onSaved,
    failureMessage: '추가 수정 요청을 저장하지 못했습니다.',
    committedMessage: '남은 문제와 추가 수정 내용을 보냈습니다.',
    replayedMessage: '이미 저장된 추가 수정 요청을 확인했습니다.',
  });
  const guard: RevisionGuard<'change_request'> = {
    resource: {
      target: { kind: 'change_request', projectId, srId: scope.srId, entityId: request.changeRequestId },
      expectedRevision: request.revision,
    },
  };
  const historical = !exactCurrentTarget;

  return <article className="entity-card" data-testid={`change-request-${request.changeRequestId}`}>
    <div className="entity-heading"><h4>{sectionTitle(artifact, request.originalSectionId)}</h4><span>{request.status === 'open' ? '수정 중' : request.status === 'awaiting_confirmation' ? '확인 대기' : '해결됨'}</span></div>
    <p>{request.body}</p>
    <p className="quiet">요청자 {actorName(request.requesterId)} · 담당자 {actorName(request.assigneeId)}</p>
    {historical && <p className="quiet">이 요청은 이전 문서의 문단을 가리킵니다. 현재 문서에 이어진 요청만 여기서 처리할 수 있습니다.</p>}
    {request.events.length > 0 && <details><summary>처리 이력 {request.events.length}건</summary><ul>{request.events.map((event) => <li key={event.eventRef.entityId}>
      {event.kind === 'applied' ? `반영 보고: ${event.applicationSummary}` : event.kind === 'resolved' ? `해결 확인: ${event.verification}` : event.kind === 'further_change' ? `추가 수정: ${event.feedback}` : '새 문서에 요청을 이어갔습니다.'}
      {' · '}{actorName(event.actorId)}
    </li>)}</ul></details>}
    {canApply && <form onSubmit={(event) => {
      event.preventDefault();
      if (applicationSummary.trim().length === 0 || currentSectionEvidence === undefined) return;
      application.submit({
        changeRequestId: request.changeRequestId,
        appliedArtifactVersionRef: artifact.versionRef,
        applicationSummary,
        evidence: { text: currentSectionEvidence },
      }, guard);
    }}>
      <label>어떻게 반영했나요?<textarea required rows={2} disabled={application.locked} value={applicationSummary} onChange={(event) => setApplicationSummary(event.target.value)} /></label>
      <button type="submit" disabled={application.locked}>반영 결과 보내기</button>
      <CommandFeedback state={application.feedback} />
    </form>}
    {canReview && request.currentApplicationEventRef !== undefined && request.appliedArtifactVersionRef !== undefined && <div className="review-resolution-actions">
      <form onSubmit={(event) => {
        event.preventDefault();
        const verification = confirmationNote.trim().length === 0
          ? `현재 문서 v${artifact.versionRef.version}의 수정 내용을 확인했습니다.`
          : `현재 문서 v${artifact.versionRef.version}의 수정 내용을 확인했습니다. ${confirmationNote.trim()}`;
        confirmation.submit({
          changeRequestId: request.changeRequestId,
          applicationEventRef: request.currentApplicationEventRef!,
          appliedArtifactVersionRef: request.appliedArtifactVersionRef!,
          result: { kind: 'resolved', verification },
        }, guard);
      }}>
        <label>확인 메모 (선택)<textarea rows={2} disabled={confirmation.locked} value={confirmationNote} onChange={(event) => setConfirmationNote(event.target.value)} /></label>
        <button type="submit" disabled={confirmation.locked}>수정 내용 확인 완료</button>
        <CommandFeedback state={confirmation.feedback} />
      </form>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (furtherChange.trim().length === 0) return;
        further.submit({
          changeRequestId: request.changeRequestId,
          ...(request.currentApplicationEventRef === undefined ? {} : {
            currentApplicationEventRef: request.currentApplicationEventRef,
          }),
          unresolvedSummary: furtherChange,
          feedback: furtherChange,
        }, guard);
      }}>
        <label>추가로 고칠 내용<textarea required rows={3} disabled={further.locked} value={furtherChange} onChange={(event) => setFurtherChange(event.target.value)} /></label>
        <button type="submit" disabled={further.locked || furtherChange.trim().length === 0}>추가 수정 요청</button>
        <CommandFeedback state={further.feedback} />
      </form>
    </div>}
  </article>;
}

export function PlanDocumentReview({ actorId, projectId, detail, artifact, selectedSectionId, actorName, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView;
  readonly artifact: ArtifactView;
  readonly selectedSectionId?: string;
  readonly actorName: (id: string) => string;
  onSaved(): void;
}) {
  const requestedSectionId = selectedSectionId !== undefined &&
    artifact.sectionIndex.some((section) => section.sectionId === selectedSectionId)
    ? selectedSectionId
    : artifact.sectionIndex[0]?.sectionId ?? '';
  const [sectionId, setSectionId] = useState(requestedSectionId);
  useEffect(() => {
    setSectionId(requestedSectionId);
  }, [artifact.artifactId, artifact.versionRef.version, requestedSectionId]);
  const section = artifact.sectionIndex.find((candidate) => candidate.sectionId === sectionId) ?? artifact.sectionIndex[0];
  if (section === undefined) return <section className="entity-panel"><p>검토할 문서 문단이 없습니다.</p></section>;

  const contexts = currentReviewContexts(detail, artifact);
  const commentContext = preferredContext(contexts, artifact);
  const changeContext = preferredContext(
    contexts.filter(({ configuration }) => configuration.assignment?.reviewerIds.includes(actorId) === true),
    artifact,
  );
  const relatedComments = detail.comments.filter((comment) => comment.artifactVersionRef.entityId === artifact.artifactId);
  const currentComments = relatedComments.filter((comment) =>
    sameArtifactRef(comment.artifactVersionRef, artifact.versionRef) && comment.sectionId === section.sectionId);
  const historicalComments = relatedComments.filter((comment) => !sameArtifactRef(comment.artifactVersionRef, artifact.versionRef));
  const requests = detail.changeRequests.filter((request) => request.originalTargetVersionRef.entityId === artifact.artifactId);
  const selectedMarkdown = artifact.markdown.slice(section.startOffset, section.endOffset);

  return <section className="entity-panel plan-document-review" aria-labelledby={`document-review-${artifact.artifactId}`}>
    <p className="eyebrow">문서 검토</p>
    <h3 id={`document-review-${artifact.artifactId}`}>{documentTitle(artifact)} · 현재 문서 v{artifact.versionRef.version}</h3>
    {selectedSectionId === undefined && <label>검토할 문단<select value={section.sectionId} onChange={(event) => setSectionId(event.target.value)}>
      {artifact.sectionIndex.map((candidate) => <option key={candidate.sectionId} value={candidate.sectionId}>{candidate.title}</option>)}
    </select></label>}
    <article className="frozen-review-content"><SafeMarkdown>{selectedMarkdown}</SafeMarkdown></article>

    <section aria-label="문단 댓글">
      <h4>이 문단의 의견</h4>
      {currentComments.length === 0 ? <p className="empty-state">현재 문단에 남긴 댓글이 없습니다.</p> : currentComments.map((comment) => <article className="answer-record" key={comment.commentId}>
        <p>{comment.body}</p><small>{actorName(comment.authorId)} · {comment.createdAt}</small>
      </article>)}
      <CommentComposer key={`${artifact.artifactId}:${artifact.versionRef.version}:${section.sectionId}:comment`} actorId={actorId} projectId={projectId} detail={detail} artifact={artifact} sectionId={section.sectionId} {...(commentContext === undefined ? {} : { reviewContext: commentContext })} onSaved={onSaved} />
      {historicalComments.length > 0 && <details><summary>이전 문서에 남긴 댓글 {historicalComments.length}건</summary><ul>{historicalComments.map((comment) => <li key={comment.commentId}>
        <strong>이전 문서 v{comment.artifactVersionRef.version}</strong> · {comment.body} · {actorName(comment.authorId)}
      </li>)}</ul></details>}
    </section>

    <section aria-label="문서 수정 요청">
      <h4>수정 요청</h4>
      {changeContext === undefined
        ? <p className="quiet">현재 문서의 지정 검토자는 공식 검토본에서 수정을 요청할 수 있습니다.</p>
        : <ChangeRequestComposer key={`${artifact.artifactId}:${artifact.versionRef.version}:${section.sectionId}:change:${changeContext.configuration.revision}`} actorId={actorId} projectId={projectId} detail={detail} artifact={artifact} sectionId={section.sectionId} context={changeContext} onSaved={onSaved} />}
      {requests.length === 0 ? <p className="empty-state">이 문서에 연결된 수정 요청이 없습니다.</p> : requests.map((request) => <ChangeRequestCard
        key={request.changeRequestId}
        actorId={actorId}
        projectId={projectId}
        detail={detail}
        artifact={artifact}
        request={request}
        actorName={actorName}
        onSaved={onSaved}
      />)}
    </section>
  </section>;
}
