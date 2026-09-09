import type {
  DecisionView,
  QuestionView,
  SnapshotContentItem,
  SRDetailView,
  WorkflowPlanView,
} from '@/src/contracts/views';

export type ComparisonState = '추가' | '삭제' | '변경' | '비교 범위 동일' | '현재값 미확인';

export interface ComparisonContent {
  readonly ref: SnapshotContentItem['ref'];
  readonly content: string;
  readonly confirmation?: SnapshotContentItem['confirmation'];
}

export interface InputComparisonEntry {
  readonly key: string;
  readonly label: string;
  readonly state: ComparisonState;
  readonly before?: ComparisonContent;
  readonly current?: ComparisonContent;
  readonly note?: string;
}

interface Projection extends ComparisonContent {
  readonly signature: string;
  readonly complete: boolean;
  readonly note?: string;
}

interface QuestionValue {
  readonly text: string;
  readonly reason: string;
  readonly assigneeId: string;
  readonly answerMode: string;
  readonly options: readonly unknown[];
  readonly status: string;
  readonly classificationRef: unknown;
  readonly evidenceRefs: readonly unknown[];
  readonly candidateAnswers: readonly unknown[];
  readonly selectedAnswer: {
    readonly ref: unknown;
    readonly answerText: string;
    readonly selectedOptionId: string | null;
    readonly evidence: unknown;
    readonly answeredBy: string;
  } | null;
  readonly resolution: {
    readonly selectedAnswerRef: unknown;
    readonly evidence: unknown;
    readonly documentDisposition: unknown;
    readonly resolvedBy: string;
    readonly resolvedAt: string;
  } | null;
  readonly convertedDecisionId: string | null;
}

interface DecisionValue {
  readonly definition: {
    readonly prompt: string;
    readonly alternatives: readonly unknown[];
    readonly impact: string;
    readonly decisionMakerId: string;
    readonly classificationRef: unknown;
    readonly originQuestionId: string | null;
    readonly originQuestionResultSnapshotRef: unknown | null;
  };
  readonly currentVersion: {
    readonly ref: unknown;
    readonly prompt: string;
    readonly alternatives: readonly unknown[];
    readonly impact: string;
    readonly selectedOption: string;
    readonly rationale: string;
    readonly evidence: unknown;
    readonly decisionMakerId: string;
    readonly classificationRef: unknown;
    readonly originQuestionId: string | null;
    readonly originQuestionResultSnapshotRef: unknown | null;
    readonly previousVersionRef: unknown | null;
    readonly changeReason: string | null;
  } | null;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function parseContent(value: string): Readonly<Record<string, unknown>> | undefined {
  try {
    return record(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
}

function refLabel(ref: { readonly kind: string; readonly entityId: string; readonly version?: number }): string {
  return `${ref.kind}:${ref.entityId}${ref.version === undefined ? '' : ` v${ref.version}`}`;
}

function refValue(value: unknown): string {
  const item = record(value);
  if (item === undefined) return '없음';
  const kind = text(item.kind);
  if (kind === 'external') {
    const url = typeof item.url === 'string' ? item.url : 'URL 없음';
    return `${text(item.label)} · ${url} · ${text(item.verificationSummary)}`;
  }
  const entityId = text(item.entityId);
  const version = typeof item.version === 'number' ? ` v${item.version}` : '';
  return kind.length === 0 || entityId.length === 0 ? '알 수 없음' : `${kind}:${entityId}${version}`;
}

function refList(value: unknown): string {
  const values = array(value).map(refValue);
  return values.length === 0 ? '없음' : values.join(', ');
}

function evidenceValue(value: unknown): unknown {
  const item = record(value);
  if (item === undefined) return null;
  if (typeof item.text === 'string') return { text: item.text };
  if (Array.isArray(item.refs)) return { refs: item.refs };
  return null;
}

function evidenceLabel(value: unknown): string {
  const item = record(value);
  if (typeof item?.text === 'string') return item.text;
  if (Array.isArray(item?.refs)) return refList(item.refs);
  return '없음';
}

function optionRows(values: readonly unknown[]): readonly { readonly optionId: string; readonly text: string }[] {
  return values.map(record).filter((item): item is Readonly<Record<string, unknown>> => item !== undefined).map((item) => ({
    optionId: text(item.optionId), text: text(item.text),
  }));
}

function alternativeRows(values: readonly unknown[]): readonly {
  readonly optionId: string; readonly label: string; readonly description: string;
}[] {
  return values.map(record).filter((item): item is Readonly<Record<string, unknown>> => item !== undefined).map((item) => ({
    optionId: text(item.optionId), label: text(item.label), description: text(item.description),
  }));
}

function questionFromSnapshot(value: Readonly<Record<string, unknown>>): QuestionValue {
  const answer = record(value.selectedAnswer);
  const resolution = record(value.resolution);
  return {
    text: text(value.text),
    reason: text(value.reason),
    assigneeId: text(value.assigneeId),
    answerMode: text(value.answerMode),
    options: optionRows(array(value.options)),
    status: text(value.status),
    classificationRef: value.classificationRef ?? null,
    evidenceRefs: array(value.evidenceRefs),
    candidateAnswers: array(value.candidateAnswers),
    selectedAnswer: answer === undefined ? null : {
      ref: answer.ref ?? null,
      answerText: text(answer.answerText),
      selectedOptionId: nullableText(answer.selectedOptionId),
      evidence: evidenceValue(answer.evidence),
      answeredBy: text(answer.answeredBy),
    },
    resolution: resolution === undefined ? null : {
      selectedAnswerRef: resolution.selectedAnswerRef ?? null,
      evidence: evidenceValue(resolution.evidence),
      documentDisposition: resolution.documentDisposition ?? null,
      resolvedBy: text(resolution.resolvedBy),
      resolvedAt: text(resolution.resolvedAt),
    },
    convertedDecisionId: nullableText(value.convertedDecisionId),
  };
}

function questionFromCurrent(question: QuestionView): QuestionValue {
  const answer = question.currentResult.selectedAnswer;
  const resolution = question.currentResult.resolution;
  return {
    text: question.text,
    reason: question.reason,
    assigneeId: question.assigneeId,
    answerMode: question.answerMode,
    options: question.options,
    status: question.status,
    classificationRef: question.classificationRef,
    evidenceRefs: question.currentResult.evidenceRefs,
    candidateAnswers: question.candidateAnswers,
    selectedAnswer: answer === undefined ? null : {
      ref: answer.ref,
      answerText: answer.answer.text,
      selectedOptionId: answer.answer.kind === 'choice' ? answer.answer.optionId : null,
      evidence: answer.evidence,
      answeredBy: answer.answeredBy,
    },
    resolution: resolution === undefined ? null : {
      selectedAnswerRef: resolution.selectedAnswerRef,
      evidence: resolution.evidence,
      documentDisposition: resolution.documentDisposition,
      resolvedBy: resolution.resolvedBy,
      resolvedAt: resolution.resolvedAt,
    },
    convertedDecisionId: question.convertedDecisionId ?? null,
  };
}

function questionText(value: QuestionValue): string {
  const lines = [
    `질문: ${value.text}`,
    `이유: ${value.reason}`,
    `담당자: ${value.assigneeId}`,
    `답변 방식: ${value.answerMode}`,
    `선택지: ${value.options.map((item) => {
      const option = record(item);
      return `${text(option?.optionId)} · ${text(option?.text)}`;
    }).join(', ') || '없음'}`,
    `상태: ${value.status}`,
    `분류: ${refValue(value.classificationRef)}`,
    `질문 근거: ${refList(value.evidenceRefs)}`,
    `답변 후보: ${value.candidateAnswers.map(text).join(', ') || '없음'}`,
  ];
  if (value.selectedAnswer === null) lines.push('현재 답변: 없음');
  else lines.push(
    `현재 답변: ${value.selectedAnswer.answerText}`,
    `선택 option: ${value.selectedAnswer.selectedOptionId ?? '직접 입력'}`,
    `답변 근거: ${evidenceLabel(value.selectedAnswer.evidence)}`,
    `답변자: ${value.selectedAnswer.answeredBy}`,
  );
  if (value.resolution === null) lines.push('해결 반영: 없음');
  else {
    const disposition = record(value.resolution.documentDisposition);
    const dispositionText = disposition?.kind === 'reflected'
      ? `문서 반영 ${refList(disposition.artifactVersionRefs)}`
      : disposition?.kind === 'not_required' ? `문서 반영 불필요 · ${text(disposition.reason)}` : '알 수 없음';
    lines.push(
      `해결 근거: ${evidenceLabel(value.resolution.evidence)}`,
      `해결 반영: ${dispositionText}`,
      `해결자: ${value.resolution.resolvedBy}`,
      `해결 시각: ${value.resolution.resolvedAt}`,
    );
  }
  lines.push(`전환 결정: ${value.convertedDecisionId ?? '없음'}`);
  return lines.join('\n');
}

function decisionFromSnapshot(value: Readonly<Record<string, unknown>>): {
  readonly value: DecisionValue; readonly unavailable: readonly string[];
} {
  const definition = record(value.definition) ?? value;
  const current = record(value.currentVersion);
  const alternatives = alternativeRows(array(current?.alternatives ?? definition.alternatives));
  const selected = text(current?.selectedOption);
  return {
    value: {
      definition: {
        prompt: text(definition.prompt),
        alternatives: alternativeRows(array(definition.alternatives)),
        impact: text(definition.impact),
        decisionMakerId: text(definition.decisionMakerId),
        classificationRef: definition.classificationRef ?? null,
        originQuestionId: nullableText(definition.originQuestionId),
        originQuestionResultSnapshotRef: definition.originQuestionResultSnapshotRef ?? null,
      },
      currentVersion: current === undefined ? null : {
        ref: current.ref ?? null,
        prompt: text(current.prompt),
        alternatives,
        impact: text(current.impact),
        selectedOption: selected,
        rationale: text(current.rationale),
        evidence: evidenceValue(current.evidence),
        decisionMakerId: text(current.decisionMakerId),
        classificationRef: current.classificationRef ?? null,
        originQuestionId: nullableText(current.originQuestionId),
        originQuestionResultSnapshotRef: current.originQuestionResultSnapshotRef ?? null,
        previousVersionRef: current.previousVersionRef ?? null,
        changeReason: nullableText(current.changeReason),
      },
    },
    unavailable: current === undefined ? [] : ['영향 요구사항', '연결 문서'],
  };
}

function decisionFromCurrent(decision: DecisionView): DecisionValue {
  const current = decision.currentConfirmation;
  return {
    definition: {
      prompt: decision.prompt,
      alternatives: decision.alternatives,
      impact: decision.impact,
      decisionMakerId: decision.decisionMakerId,
      classificationRef: decision.classificationRef,
      originQuestionId: decision.originQuestionId ?? null,
      originQuestionResultSnapshotRef: decision.originQuestionResultSnapshotRef ?? null,
    },
    currentVersion: current === undefined ? null : {
      ref: current.ref,
      prompt: decision.prompt,
      alternatives: decision.alternatives,
      impact: decision.impact,
      selectedOption: current.selection.optionId ?? current.selection.text,
      rationale: current.rationale,
      evidence: current.evidence,
      decisionMakerId: current.decidedBy,
      classificationRef: current.classificationRef,
      originQuestionId: current.originQuestionId ?? null,
      originQuestionResultSnapshotRef: current.originQuestionResultSnapshotRef ?? null,
      previousVersionRef: current.previousVersionRef ?? null,
      changeReason: current.changeReason ?? null,
    },
  };
}

function alternativesText(values: readonly unknown[]): string {
  return alternativeRows(values).map(({ optionId, label, description }) => `${optionId} · ${label} · ${description}`).join('\n') || '없음';
}

function decisionText(value: DecisionValue, unavailable: readonly string[] = []): string {
  const current = value.currentVersion;
  const lines = [
    `결정: ${value.definition.prompt}`,
    `대안:\n${alternativesText(value.definition.alternatives)}`,
    `영향: ${value.definition.impact}`,
    `결정권자: ${value.definition.decisionMakerId}`,
    `분류: ${refValue(value.definition.classificationRef)}`,
    `원 질문: ${value.definition.originQuestionId ?? '없음'}`,
  ];
  if (current === null) lines.push('확정: 미확정');
  else lines.push(
    `현재 결정문: ${current.prompt}`,
    `현재 대안:\n${alternativesText(current.alternatives)}`,
    `선택 값: ${current.selectedOption}`,
    '선택 방식: 고정 입력에서 option 선택과 직접 입력을 구분하지 않음',
    `근거: ${current.rationale}`,
    `확정 근거: ${evidenceLabel(current.evidence)}`,
    `확정자: ${current.decisionMakerId}`,
    `이전 결정: ${refValue(current.previousVersionRef)}`,
    `변경 이유: ${current.changeReason ?? '없음'}`,
  );
  if (unavailable.length > 0) lines.push(`현재 조회에서 확인할 수 없는 고정 필드: ${unavailable.join(', ')}`);
  return lines.join('\n');
}

function classificationFromSnapshot(value: Readonly<Record<string, unknown>>) {
  return {
    target: value.target ?? null,
    scope: text(value.scope),
    requiredGate: text(value.requiredGate),
    reason: text(value.reason),
    ownerId: nullableText(value.ownerId),
    revisitAt: nullableText(value.revisitAt),
    revisitEvent: nullableText(value.revisitEvent),
    basisRefs: array(value.basisRefs),
  };
}

function classificationFromCurrent(value: QuestionView['currentClassification'] | DecisionView['currentClassification']) {
  return {
    target: value.targetRef,
    scope: value.scope,
    requiredGate: value.requiredGate,
    reason: value.reason,
    ownerId: value.scope === 'followup' ? value.ownerId : null,
    revisitAt: value.scope === 'followup' && value.revisit.kind === 'at' ? value.revisit.at : null,
    revisitEvent: value.scope === 'followup' && value.revisit.kind === 'event' ? value.revisit.event : null,
    basisRefs: value.basisRefs,
  };
}

function classificationText(value: ReturnType<typeof classificationFromSnapshot>): string {
  return [
    `대상: ${refValue(value.target)}`,
    `범위: ${value.scope}`,
    `필요 gate: ${value.requiredGate}`,
    `이유: ${value.reason}`,
    `후속 담당자: ${value.ownerId ?? '없음'}`,
    `재검토 시각: ${value.revisitAt ?? '없음'}`,
    `재검토 조건: ${value.revisitEvent ?? '없음'}`,
    `분류 근거: ${refList(value.basisRefs)}`,
  ].join('\n');
}

function artifactValue(value: Readonly<Record<string, unknown>>) {
  return {
    kind: text(value.kind),
    designStage: nullableText(value.designStage),
    logicalKey: text(value.logicalKey),
    markdown: text(value.markdown),
    sectionIndex: array(value.sectionIndex),
    requirementLinks: array(value.requirementLinks),
    decisionRefs: array(value.decisionRefs),
    sourceRefs: array(value.sourceRefs),
    questionResultRefs: array(value.questionResultRefs),
    workflowPlan: value.workflowPlan ?? null,
  };
}

function artifactFromCurrent(value: SRDetailView['artifacts'][number]) {
  const logicalKey = value.kind === 'design' ? `design:${value.designStage ?? ''}` : value.kind;
  const workflow = value.kind === 'workflow_plan' ? value as WorkflowPlanView : undefined;
  return {
    kind: value.kind,
    designStage: value.designStage ?? null,
    logicalKey,
    markdown: value.markdown,
    sectionIndex: value.sectionIndex,
    requirementLinks: value.requirementLinks,
    decisionRefs: value.decisionRefs,
    sourceRefs: value.sourceRefs,
    questionResultRefs: value.questionResultRefs,
    workflowPlan: workflow === undefined ? null : {
      workflowVersion: workflow.workflowVersion,
      stages: workflow.stages,
      implementationUnitCount: workflow.implementationUnitCount,
      requirementTaskLinks: workflow.requirementTaskLinks,
    },
  };
}

function artifactText(value: ReturnType<typeof artifactValue>): string {
  const sections = value.sectionIndex.map((item) => {
    const section = record(item);
    return `${text(section?.sectionId)} · ${text(section?.title)} · offset ${String(section?.startOffset ?? '')}-${String(section?.endOffset ?? '')}`;
  });
  const requirements = value.requirementLinks.map((item) => {
    const requirement = record(item);
    return [
      `${text(requirement?.requirementId)} · section ${array(requirement?.sectionIds).map(text).join(', ') || '없음'}`,
      `수용 기준: ${array(requirement?.acceptanceCriteria).map(text).join(' / ') || '없음'}`,
    ].join('\n');
  });
  const workflow = record(value.workflowPlan);
  const stages = array(workflow?.stages).map((item) => {
    const stage = record(item);
    if (stage?.choice === 'executed') {
      return `${text(stage.stageId)} · 실행 · 설계 ${refList(stage.designArtifactRefs)}`;
    }
    return `${text(stage?.stageId)} · 생략 · ${text(stage?.reason)}`;
  });
  const tasks = array(workflow?.requirementTaskLinks).map((item) => {
    const task = record(item);
    return [
      `${text(task?.taskId)} · 순서 ${String(task?.order ?? '')} · 요구사항 ${array(task?.requirementIds).map(text).join(', ')}`,
      `검증: ${array(task?.verification).map(text).join(' / ')}`,
    ].join('\n');
  });
  return [
    `문서 종류: ${value.logicalKey}`,
    `문서 원문:\n${value.markdown}`,
    `section:\n${sections.join('\n') || '없음'}`,
    `요구사항:\n${requirements.join('\n') || '없음'}`,
    `결정 참조: ${refList(value.decisionRefs)}`,
    `출처 참조: ${refList(value.sourceRefs)}`,
    `질문 참조: ${refList(value.questionResultRefs)}`,
    ...(workflow === undefined ? [] : [
      `workflow version: ${text(workflow.workflowVersion)}`,
      `implementation unit: ${String(workflow.implementationUnitCount ?? '')}`,
      `단계:\n${stages.join('\n') || '없음'}`,
      `작업:\n${tasks.join('\n') || '없음'}`,
    ]),
  ].join('\n');
}

function sourceValue(value: Readonly<Record<string, unknown>>) {
  const kind = text(value.kind);
  return {
    displayName: typeof value.displayName === 'string' ? value.displayName : null,
    provenance: text(value.provenance),
    kind,
    content: kind === 'link' ? null : text(value.content),
    targetUrl: kind === 'link' ? text(value.targetUrl) : null,
    verifiable: kind === 'link' ? value.verifiable === true : null,
    observedExternalVersion: kind === 'link' ? nullableText(value.observedExternalVersion) : null,
    unavailableReason: kind === 'link' ? nullableText(value.unavailableReason) : null,
    confirmation: text(value.confirmation),
    confirmedBy: nullableText(value.confirmedBy),
    confirmedAt: nullableText(value.confirmedAt),
    confirmationEvidence: nullableText(value.confirmationEvidence),
  };
}

function sourceFromCurrent(value: SRDetailView['sources'][number]) {
  return sourceValue(value as unknown as Readonly<Record<string, unknown>>);
}

function sourceText(value: ReturnType<typeof sourceValue>): string {
  return [
    `자료: ${value.displayName ?? '이름 없음'}`,
    value.kind === 'link' ? `링크: ${value.targetUrl}` : `본문: ${value.content}`,
    ...(value.kind === 'link' ? [
      `검증 가능: ${value.verifiable ? '예' : '아니요'}`,
      `관찰 외부 버전: ${value.observedExternalVersion ?? '없음'}`,
      `이용 불가 이유: ${value.unavailableReason ?? '없음'}`,
    ] : []),
    `출처: ${value.provenance}`,
    `확인 상태: ${value.confirmation}`,
    ...(value.confirmation === 'confirmed' ? [
      `확인자: ${value.confirmedBy}`, `확인 시각: ${value.confirmedAt}`, `확인 근거: ${value.confirmationEvidence}`,
    ] : []),
  ].join('\n');
}

function projection(
  ref: SnapshotContentItem['ref'],
  value: unknown,
  content: string,
  options: { readonly confirmation?: SnapshotContentItem['confirmation']; readonly complete?: boolean; readonly note?: string } = {},
): Projection {
  return {
    ref,
    signature: stable(value),
    content,
    complete: options.complete ?? true,
    ...(options.confirmation === undefined ? {} : { confirmation: options.confirmation }),
    ...(options.note === undefined ? {} : { note: options.note }),
  };
}

function unreadable(item: SnapshotContentItem): Projection {
  return projection(item.ref, null, '고정 입력 본문을 해석할 수 없습니다.', {
    confirmation: item.confirmation,
    complete: false,
    note: '고정 입력의 typed 업무 본문을 해석할 수 없어 현재 값과 비교하지 않았습니다.',
  });
}

function snapshotProjection(item: SnapshotContentItem): Projection {
  const value = parseContent(item.content);
  if (value === undefined) return unreadable(item);
  switch (item.ref.kind) {
    case 'sr': {
      const participants = record(value.participants);
      if (participants === undefined) return unreadable(item);
      const members = array(participants.members).map(record)
        .filter((member): member is Readonly<Record<string, unknown>> => member !== undefined)
        .map((member) => ({ userId: text(member.userId), displayName: text(member.displayName) }));
      const normalized = { ownerId: text(participants.ownerId), members };
      return projection(item.ref, normalized, [
        `담당자: ${normalized.ownerId}`,
        ...members.map(({ userId, displayName }) => `${displayName} (${userId})`),
      ].join('\n'), { confirmation: item.confirmation });
    }
    case 'sr_description': {
      const normalized = { title: text(value.title), purpose: text(value.purpose), description: text(value.description) };
      return projection(item.ref, normalized, `제목: ${normalized.title}\n목적: ${normalized.purpose}\n설명: ${normalized.description}`, { confirmation: item.confirmation });
    }
    case 'context_source': {
      const normalized = sourceValue(value);
      return projection(item.ref, normalized, sourceText(normalized), { confirmation: item.confirmation });
    }
    case 'artifact': {
      const normalized = artifactValue(value);
      return projection(item.ref, normalized, artifactText(normalized), { confirmation: item.confirmation });
    }
    case 'question_result': {
      const normalized = questionFromSnapshot(value);
      return projection(item.ref, normalized, questionText(normalized), { confirmation: item.confirmation });
    }
    case 'decision': {
      const normalized = decisionFromSnapshot(value);
      const note = normalized.unavailable.length === 0 ? undefined :
        `현재 조회에 ${normalized.unavailable.join(', ')}가 없어 전체 동일 여부를 판단하지 않았습니다.`;
      return projection(item.ref, normalized.value, decisionText(normalized.value, normalized.unavailable), {
        confirmation: item.confirmation,
        complete: normalized.unavailable.length === 0,
        ...(note === undefined ? {} : { note }),
      });
    }
    case 'scope_classification': {
      const normalized = classificationFromSnapshot(value);
      return projection(item.ref, normalized, classificationText(normalized), { confirmation: item.confirmation });
    }
    default:
      return projection(item.ref, null, '이 참조의 현재 업무 본문은 조회 응답에 없습니다.', {
        confirmation: item.confirmation,
        complete: false,
        note: '현재 조회에 대응하는 typed 업무 본문이 없어 비교하지 않았습니다.',
      });
  }
}

function currentProjections(
  detail: SRDetailView,
  members: readonly { readonly actorId: string; readonly displayName: string }[],
): readonly Projection[] {
  const sortedMembers = [...members].sort((left, right) => left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0);
  const participants = { ownerId: detail.sr.ownerId, members: sortedMembers.map(({ actorId, displayName }) => ({ userId: actorId, displayName })) };
  const result: Projection[] = [
    projection(
      { kind: 'sr', projectId: detail.sr.scope.projectId, srId: detail.sr.scope.srId, entityId: detail.sr.scope.srId },
      participants,
      [`담당자: ${participants.ownerId}`, ...participants.members.map(({ userId, displayName }) => `${displayName} (${userId})`)].join('\n'),
    ),
    projection(
      detail.currentDescription.versionRef,
      { title: detail.currentDescription.title, purpose: detail.currentDescription.purpose, description: detail.currentDescription.description },
      `제목: ${detail.currentDescription.title}\n목적: ${detail.currentDescription.purpose}\n설명: ${detail.currentDescription.description}`,
    ),
  ];
  for (const source of detail.sources) {
    const normalized = sourceFromCurrent(source);
    result.push(projection(source.currentVersionRef, normalized, sourceText(normalized), { confirmation: source.confirmation }));
  }
  for (const artifact of detail.artifacts) {
    const normalized = artifactFromCurrent(artifact);
    result.push(projection(artifact.versionRef, normalized, artifactText(normalized)));
  }
  for (const question of detail.questions) {
    const normalized = questionFromCurrent(question);
    result.push(projection(question.currentResult.ref, normalized, questionText(normalized)));
    const classification = classificationFromCurrent(question.currentClassification);
    result.push(projection(question.currentClassification.ref, classification, classificationText(classification)));
  }
  for (const decision of detail.decisions) {
    const normalized = decisionFromCurrent(decision);
    const ref = decision.currentConfirmation?.ref ?? {
      kind: 'decision' as const,
      projectId: decision.scope.projectId,
      srId: decision.scope.srId,
      entityId: decision.decisionId,
    };
    const unavailable = decision.currentConfirmation === undefined ? [] : ['영향 요구사항', '연결 문서'];
    const note = unavailable.length === 0 ? undefined :
      `현재 조회에 ${unavailable.join(', ')}가 없어 전체 동일 여부를 판단하지 않았습니다.`;
    result.push(projection(ref, normalized, decisionText(normalized, unavailable), {
      complete: unavailable.length === 0,
      ...(note === undefined ? {} : { note }),
    }));
    const classification = classificationFromCurrent(decision.currentClassification);
    result.push(projection(decision.currentClassification.ref, classification, classificationText(classification)));
  }
  return result;
}

function comparisonKey(ref: SnapshotContentItem['ref']): string {
  return `${ref.kind}:${ref.entityId}`;
}

function contentOf(value: Projection): ComparisonContent {
  return {
    ref: value.ref,
    content: value.content,
    ...(value.confirmation === undefined ? {} : { confirmation: value.confirmation }),
  };
}

export function compareInputContents(
  snapshotContents: readonly SnapshotContentItem[],
  detail: SRDetailView,
  members: readonly { readonly actorId: string; readonly displayName: string }[],
): readonly InputComparisonEntry[] {
  const previous = snapshotContents.map(snapshotProjection);
  const current = currentProjections(detail, members);
  const currentByKey = new Map(current.map((item) => [comparisonKey(item.ref), item]));
  const previousKeys = new Set(previous.map((item) => comparisonKey(item.ref)));
  const rows = previous.map((before): InputComparisonEntry => {
    const key = comparisonKey(before.ref);
    const currentItem = currentByKey.get(key);
    if (currentItem === undefined) {
      const state: ComparisonState = before.complete ? '삭제' : '현재값 미확인';
      return {
        key, label: refLabel(before.ref), state, before: contentOf(before),
        ...(before.note === undefined ? {} : { note: before.note }),
      };
    }
    const sameVersion = ('version' in before.ref ? before.ref.version : undefined) ===
      ('version' in currentItem.ref ? currentItem.ref.version : undefined);
    const sameConfirmation = before.ref.kind !== 'context_source' || before.confirmation === currentItem.confirmation;
    const knownDifference = before.signature !== currentItem.signature || !sameVersion || !sameConfirmation;
    const state: ComparisonState = knownDifference ? '변경' :
      before.complete && currentItem.complete ? '비교 범위 동일' : '현재값 미확인';
    return {
      key,
      label: refLabel(before.ref),
      state,
      before: contentOf(before),
      current: contentOf(currentItem),
      ...(knownDifference ? {} : { note: before.note ?? currentItem.note ?? '생성 입력에 포함된 업무 필드만 비교했습니다.' }),
    };
  });
  for (const currentItem of current) {
    const key = comparisonKey(currentItem.ref);
    if (!previousKeys.has(key)) rows.push({
      key, label: refLabel(currentItem.ref), state: '추가', current: contentOf(currentItem),
      ...(currentItem.note === undefined ? {} : { note: currentItem.note }),
    });
  }
  return rows;
}
