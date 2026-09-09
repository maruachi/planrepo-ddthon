import type { ProviderSelection } from '@/src/contracts/views';
import type { GenerationProvider } from './provider-contract';

export class ProviderRegistryError extends Error {}

export interface RegisteredGenerationProvider {
  readonly providerId: string;
  readonly provider: GenerationProvider;
}

export class GenerationProviderRegistry {
  private readonly entries: ReadonlyMap<string, RegisteredGenerationProvider>;

  constructor(entries: readonly RegisteredGenerationProvider[]) {
    const indexed = new Map<string, RegisteredGenerationProvider>();
    for (const entry of entries) {
      if (entry.providerId.length === 0 || indexed.has(entry.providerId)) {
        throw new ProviderRegistryError('generation provider 등록이 비었거나 중복됐습니다.');
      }
      indexed.set(entry.providerId, Object.freeze({ ...entry }));
    }
    this.entries = indexed;
  }

  resolve(selection: ProviderSelection): RegisteredGenerationProvider {
    const selected = this.entries.get(selection.providerId);
    if (selected === undefined) {
      throw new ProviderRegistryError(`저장된 provider 선택 ${selection.providerId}을 사용할 수 없습니다.`);
    }
    return selected;
  }
}
