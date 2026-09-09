import type { Result, SRDraft } from '../../shared/contracts.js';
import { result } from '../../shared/errors.js';
import { LIMITS } from '../../shared/limits.js';
import { object, text } from '../../shared/validation.js';
export interface SRInputPort { normalize(input: SRDraft): Result<SRDraft> }
export class DirectSRInput implements SRInputPort {
  normalize(input: SRDraft): Result<SRDraft> { return result(() => {
    const v = object(input, ['title', 'description', 'attachmentMarkdown', 'attachmentDisplayName']);
    return { title: text(v.title, 'title', LIMITS.title, true, true), description: text(v.description, 'description', LIMITS.text, true), ...(v.attachmentMarkdown !== undefined ? { attachmentMarkdown: text(v.attachmentMarkdown, 'attachmentMarkdown') } : {}), ...(v.attachmentDisplayName !== undefined ? { attachmentDisplayName: text(v.attachmentDisplayName, 'attachmentDisplayName', LIMITS.title) } : {}) };
  }); }
}
