import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { TestApp } from '@/tests/helpers/test-app';

export interface PersonaContext {
  readonly context: BrowserContext;
  readonly page: Page;
}

export async function openPersonaContext(
  browser: Browser,
  app: TestApp,
  personaId: string,
): Promise<PersonaContext> {
  const context = await browser.newContext({ baseURL: app.baseURL });
  const page = await context.newPage();
  try {
    await page.goto('/');
    const actor = page.getByLabel('가상 사용자');
    await actor.selectOption(personaId);
    await actor.locator(`option[value="${personaId}"]`).waitFor({ state: 'attached' });
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}
