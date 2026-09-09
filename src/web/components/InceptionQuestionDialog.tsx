import { useEffect, useMemo, useRef, useState } from 'react';
import type { QuestionView } from '@/src/contracts/views';
import './InceptionQuestionDialog.css';

export interface InceptionQuestionDraft {
  readonly optionId: string;
  readonly text: string;
}

export function InceptionQuestionDialog({
  questions,
  initialQuestionId,
  drafts,
  busy,
  error,
  message,
  actorName,
  onChange,
  onSave,
  onExplain,
  onClose,
}: {
  readonly questions: readonly QuestionView[];
  readonly initialQuestionId?: string;
  readonly drafts: Readonly<Record<string, InceptionQuestionDraft>>;
  readonly busy: boolean;
  readonly error?: string;
  readonly message?: string;
  readonly actorName: (actorId: string) => string;
  onChange(question: QuestionView, patch: Partial<InceptionQuestionDraft>): void;
  onSave(question: QuestionView): void;
  onExplain?(question: QuestionView): void;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const firstQuestionId = useMemo(() => {
    if (initialQuestionId !== undefined && questions.some((question) => question.questionId === initialQuestionId)) {
      return initialQuestionId;
    }
    return questions.find((question) => question.status === 'open')?.questionId ?? questions[0]?.questionId;
  }, [initialQuestionId, questions]);
  const [activeQuestionId, setActiveQuestionId] = useState(firstQuestionId);

  useEffect(() => {
    if (activeQuestionId === undefined || !questions.some((question) => question.questionId === activeQuestionId)) {
      setActiveQuestionId(firstQuestionId);
    }
  }, [activeQuestionId, firstQuestionId, questions]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    if (dialog !== null && !dialog.open) dialog.showModal();
    const focusFrame = requestAnimationFrame(() => headingRef.current?.focus());
    return () => {
      cancelAnimationFrame(focusFrame);
      if (dialog?.open) dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const activeIndex = Math.max(0, questions.findIndex((question) => question.questionId === activeQuestionId));
  const question = questions[activeIndex];
  if (question === undefined) return null;

  const draft = drafts[question.questionId] ?? {
    optionId: question.options[0]?.optionId ?? '',
    text: '',
  };
  const storedAnswer = question.currentResult.selectedAnswer?.answer.text;
  const canAnswer = question.status === 'open';
  const answerReady = question.answerMode === 'choice'
    ? question.options.some((option) => option.optionId === draft.optionId)
    : draft.text.trim() !== '';
  const stateLabel = storedAnswer !== undefined
    ? '답변 저장됨'
    : question.status === 'resolved'
      ? '확인 완료'
      : question.status === 'converted_to_decision'
        ? '결정으로 전환됨'
        : '답변 대기';

  return <dialog ref={dialogRef} className="inception-question-dialog__backdrop" aria-labelledby="inception-question-dialog-title" onCancel={(event) => {
    event.preventDefault();
    onCloseRef.current();
  }} onMouseDown={(event) => {
    if (event.target === event.currentTarget) onCloseRef.current();
  }}>
    <section className="inception-question-dialog">
      <header>
        <div>
          <p className="eyebrow">문서를 더 정확하게 만드는 참고 질문</p>
          <h2 ref={headingRef} id="inception-question-dialog-title" tabIndex={-1}>질문에 답하기</h2>
        </div>
        <button className="inception-question-dialog__close" type="button" onClick={() => onCloseRef.current()} aria-label="질문 창 닫기">×</button>
      </header>

      <div className="inception-question-dialog__progress" aria-label={`${questions.length}개 질문 중 ${activeIndex + 1}번째`}>
        <span>{activeIndex + 1} / {questions.length}</span>
        <div aria-hidden="true">{questions.map((item, index) => <i
          className={index === activeIndex ? 'is-current' : item.currentResult.selectedAnswer === undefined ? '' : 'is-saved'}
          key={item.questionId}
        />)}</div>
      </div>

      <article className="inception-question-dialog__question">
        <div className="inception-question-dialog__meta"><span>{stateLabel}</span><span>답변 담당자 · {actorName(question.assigneeId)}</span></div>
        <h3>{question.text}</h3>
        <div className="inception-question-dialog__reason"><strong>왜 이 질문이 필요한가요?</strong><p>{question.reason}</p></div>

        {storedAnswer !== undefined && <blockquote><strong>저장된 답변</strong><br />{storedAnswer}</blockquote>}

        {canAnswer && question.answerMode === 'choice' && <fieldset className="inception-question-dialog__choices">
          <legend>가장 가까운 답을 선택하세요</legend>
          {question.options.map((option) => <label className={draft.optionId === option.optionId ? 'is-selected' : ''} key={option.optionId}>
            <input type="radio" name={`dialog-answer-${question.questionId}`} checked={draft.optionId === option.optionId} onChange={() => onChange(question, { optionId: option.optionId })} />
            <span>{option.text}</span>
          </label>)}
        </fieldset>}

        {canAnswer && question.answerMode === 'free_text' && <div className="inception-question-dialog__free-answer">
          {question.candidateAnswers.length > 0 && <fieldset className="inception-question-dialog__choices">
            <legend>가장 가까운 답을 고르거나 직접 적어 주세요</legend>
            {question.candidateAnswers.map((candidate, index) => <label className={draft.text === candidate ? 'is-selected' : ''} key={`${index}:${candidate}`}>
              <input type="radio" name={`dialog-candidate-${question.questionId}`} checked={draft.text === candidate} onChange={() => onChange(question, { text: candidate })} />
              <span>{candidate}</span>
            </label>)}
          </fieldset>}
          <label>내 답변<textarea rows={4} value={draft.text} placeholder="내 상황에 맞는 답을 적어 주세요." onChange={(event) => onChange(question, { text: event.target.value })} /></label>
        </div>}

        {!canAnswer && <p className="inception-question-dialog__saved-note">이 질문은 이미 처리됐습니다. 저장된 내용을 확인한 뒤 다른 질문으로 이동할 수 있습니다.</p>}
        {error !== undefined && <p className="inception-question-dialog__error" role="alert">{error}</p>}
        {message !== undefined && <p className="inception-question-dialog__success" role="status">{message}</p>}
      </article>

        {canAnswer && <div className="inception-question-dialog__question-actions">
          <button className="primary-button" type="button" disabled={busy || !answerReady} onClick={() => onSave(question)}>이 답변 저장</button>
          {onExplain !== undefined && <button type="button" disabled={busy} onClick={() => onExplain(question)}>AI로 질문 뜻 더 쉽게 보기</button>}
        </div>}
        {canAnswer && onExplain === undefined && <p className="inception-question-dialog__saved-note">질문 이유는 위 설명에서 확인할 수 있습니다. AI 문서 보완은 SR 담당자가 준비합니다.</p>}

      <footer>
        <button type="button" disabled={activeIndex === 0} onClick={() => setActiveQuestionId(questions[activeIndex - 1]?.questionId)}>이전</button>
        <button type="button" onClick={() => onCloseRef.current()}>나중에 닫기</button>
        <button type="button" disabled={activeIndex === questions.length - 1} onClick={() => setActiveQuestionId(questions[activeIndex + 1]?.questionId)}>다음</button>
      </footer>
    </section>
  </dialog>;
}
