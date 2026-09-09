import fc from 'fast-check';
import { beforeAll, expect, test } from 'vitest';
import { INITIAL_WORKFLOW_PROMPT_CLOSING, RESUME_PROMPT, buildInitialWorkflowPrompt, type WorktreeSrRequirements } from '../../../src/worktree-spike/contracts.js';

const PBT_SEED = 424242;
const PBT_PARAMETERS = { seed: PBT_SEED, numRuns: 150 } as const;
const alphabet = ['a', 'Z', '0', ' ', '\n', '#', '*', '`', '가', '힣', 'é', '中', '🚀'] as const;
const markdown = fc.array(fc.constantFrom(...alphabet), { minLength: 1, maxLength: 80 }).map(characters => characters.join(''));
const requirementsArbitrary = fc.record({
  marker: fc.uuid(),
  title: markdown,
  description: markdown,
  attachment: fc.option(fc.record({ displayName: markdown, body: markdown }), { nil: undefined }),
}).map(value => ({
  marker: value.marker,
  title: `[${value.marker}] ${value.title}`,
  description: value.description,
  ...(value.attachment ? { attachmentDisplayName: value.attachment.displayName, attachmentMarkdown: value.attachment.body } : {}),
}));

beforeAll(() => {
  console.info(`[PBT] initial-aidlc-prompt seed=${PBT_SEED}; shrinking=enabled`);
});

test('PBT-03 initial prompt is deterministic and preserves generated SR requirement fields', () => {
  fc.assert(fc.property(requirementsArbitrary, requirements => {
    const prompt = buildInitialWorkflowPrompt(requirements);
    expect(buildInitialWorkflowPrompt(requirements)).toBe(prompt);
    expect(prompt.startsWith('# SR 요구사항 명세서\n')).toBe(true);
    expect(prompt).toContain(requirements.title);
    expect(prompt).toContain(requirements.description);
    expect(prompt.endsWith(INITIAL_WORKFLOW_PROMPT_CLOSING)).toBe(true);
    expect(prompt.includes('## 첨부 요구사항 명세서')).toBe(requirements.attachmentMarkdown !== undefined);
    if (requirements.attachmentMarkdown !== undefined) {
      expect(prompt).toContain(requirements.attachmentDisplayName);
      expect(prompt).toContain(requirements.attachmentMarkdown);
    }
    expect(RESUME_PROMPT).toBe('aidlc-docs/aidlc-state.md를 확인하고, 첫 번째 미완료 항목부터 이어서 진행해주세요.');
  }), PBT_PARAMETERS);
});

test('PBT-03 prompts remain isolated between generated SRs', () => {
  fc.assert(fc.property(requirementsArbitrary, requirementsArbitrary, (left, right) => {
    fc.pre(left.marker !== right.marker);
    const leftPrompt = buildInitialWorkflowPrompt(left as WorktreeSrRequirements);
    const rightPrompt = buildInitialWorkflowPrompt(right as WorktreeSrRequirements);
    expect(leftPrompt).toContain(left.marker);
    expect(leftPrompt).not.toContain(right.marker);
    expect(rightPrompt).toContain(right.marker);
    expect(rightPrompt).not.toContain(left.marker);
  }), PBT_PARAMETERS);
});

