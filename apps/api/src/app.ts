import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ReviewDecisionSchema, targetStatusForDecision } from '@ald/domain';
import { applications } from './data.js';

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' });

  app.get('/health', async () => ({ status: 'ok', service: 'ai-land-development-api' }));
  app.get('/api/applications', async () => applications);
  app.get('/api/applications/:id', async (request, reply) => {
    const item = applications.find((entry) => entry.id === (request.params as { id: string }).id);
    if (!item) return reply.code(404).send({ message: 'Application not found.' });
    return item;
  });
  app.post('/api/applications/:id/decisions', async (request, reply) => {
    const parsed = ReviewDecisionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: 'Invalid decision.', issues: parsed.error.flatten() });
    const item = applications.find((entry) => entry.id === (request.params as { id: string }).id);
    if (!item) return reply.code(404).send({ message: 'Application not found.' });

    const next = targetStatusForDecision(parsed.data.action);
    item.status = next;
    item.audit.unshift({
      id: crypto.randomUUID(), at: new Date().toISOString(), actor: 'Maria Santos',
      event: parsed.data.action === 'override' ? 'AI finding overridden' : `Decision: ${parsed.data.action.replace('_', ' ')}`,
      detail: parsed.data.overrideJustification ?? parsed.data.note,
    });
    return reply.code(201).send(item);
  });

  return app;
}
