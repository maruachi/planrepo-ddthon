import referenceMocks from '@/config/demo/reference-mocks.json' with { type: 'json' };
import scenarios from '@/config/demo/scenarios.json' with { type: 'json' };

export interface MockTicket {
  readonly key: string;
  readonly url: string;
  readonly status: string;
  readonly title: string;
  readonly purpose: string;
  readonly description: string;
  readonly existingSystem: boolean;
  readonly mock: true;
}

export interface MockTicketProvider {
  find(key: string): MockTicket | undefined;
}

export function createMockTicketProvider(): MockTicketProvider {
  return {
    find(key) {
      const ticket = referenceMocks.jira.find((candidate) => candidate.key === key);
      const scenario = scenarios.scenarios.find((candidate) => candidate.key === key);
      if (ticket === undefined || scenario === undefined || ticket.mock !== true) return undefined;
      return {
        key: ticket.key,
        url: ticket.url,
        status: ticket.status,
        title: scenario.title,
        purpose: scenario.purpose,
        description: scenario.description,
        existingSystem: false,
        mock: true,
      };
    },
  };
}
