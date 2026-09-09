import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export interface ProjectRule {
  readonly logicalId: string;
  readonly version: string;
  readonly content: string;
}

export type ProjectRuleSnapshot = readonly ProjectRule[];

export interface ProjectRuleSource {
  readonly rules: ProjectRuleSnapshot;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

export function loadProjectRuleSource(root: string): ProjectRuleSource {
  const resolvedRoot = realpathSync(resolve(root));
  const configuredPath = resolve(resolvedRoot, 'config/generation/project-rules.json');
  const assetPath = realpathSync(configuredPath);
  if (!inside(resolvedRoot, assetPath)) {
    throw new Error('프로젝트 root 밖의 규칙 자산은 사용할 수 없습니다.');
  }
  if (!statSync(assetPath).isFile()) throw new Error('프로젝트 규칙 자산이 일반 파일이 아닙니다.');
  const parsed = JSON.parse(readFileSync(assetPath, 'utf8')) as unknown;
  if (!isObject(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.rules)) {
    throw new Error('프로젝트 규칙 자산 형식이 올바르지 않습니다.');
  }
  const seen = new Set<string>();
  const rules = parsed.rules.map((value): ProjectRule => {
    if (!isObject(value) || typeof value.logicalId !== 'string' || typeof value.content !== 'string') {
      throw new Error('프로젝트 규칙 항목 형식이 올바르지 않습니다.');
    }
    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(value.logicalId) || value.content.trim().length === 0) {
      throw new Error('프로젝트 규칙 ID 또는 content가 올바르지 않습니다.');
    }
    if (seen.has(value.logicalId)) throw new Error(`프로젝트 규칙 logical ID가 중복됩니다: ${value.logicalId}`);
    seen.add(value.logicalId);
    return Object.freeze({
      logicalId: value.logicalId,
      version: `sha256:${createHash('sha256').update(value.content).digest('hex')}`,
      content: value.content,
    });
  }).sort((left, right) => left.logicalId < right.logicalId ? -1 : left.logicalId > right.logicalId ? 1 : 0);
  return Object.freeze({ rules: Object.freeze(rules) });
}
