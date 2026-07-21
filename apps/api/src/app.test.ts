import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('API', () => {
  it('returns the reviewer queue', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/applications' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(4);
    await app.close();
  });

  it('rejects an override without justification', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/applications/app-0148/decisions', payload: {
      action: 'override', reviewerId: '11111111-1111-4111-8111-111111111111', note: 'Reviewer checked the evidence.'
    }});
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
