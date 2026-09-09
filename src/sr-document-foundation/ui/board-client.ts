import type { SRSummary } from '../../shared/contracts.js';
import type { Column } from '../../shared/limits.js';
import { ApiClient, api, isSRSummary } from '../../shared/client/api-client.js';

export class BoardClient {
  constructor(private client: ApiClient = api, private operationId: () => string = () => crypto.randomUUID()) {}
  move(srId: string, expectedColumn: Column, targetColumn: Column, operationId = this.operationId()): Promise<SRSummary> {
    return this.client.request(`/api/srs/${encodeURIComponent(srId)}/board-movements`, isSRSummary, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Operation-Id': operationId },
      body: JSON.stringify({ expectedColumn, targetColumn }),
    });
  }
}

export const boardClient = new BoardClient();
