import { Pool } from 'pg';
import { env } from '../config/env.js';
import type { InvocationWriteInput, ReviewWriteInput, ServiceRecord, ServiceWriteInput } from '../domain/types.js';

type Health = {
  mode: 'database' | 'seed';
  databaseConnected: boolean;
  reason?: string;
};

export class AgentHuntRepository {
  private pool: Pool | null = null;
  private initialized = false;
  private health: Health = { mode: 'seed', databaseConnected: false };

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    if (!env.databaseUrl) {
      this.health = { mode: 'seed', databaseConnected: false, reason: 'DATABASE_URL unavailable' };
      return;
    }

    try {
      this.pool = new Pool({ connectionString: env.databaseUrl, ssl: { rejectUnauthorized: false }, max: 3, idleTimeoutMillis: 30000 });
      await this.pool.query('select 1');
      await this.ensureSchema();
      this.health = { mode: 'database', databaseConnected: true };
    } catch (error) {
      this.health = {
        mode: 'seed',
        databaseConnected: false,
        reason: error instanceof Error ? error.message : 'Unknown database init failure'
      };
      if (this.pool) {
        await this.pool.end().catch(() => undefined);
        this.pool = null;
      }
    }
  }

  getHealth() {
    return this.health;
  }

  private async ensureSchema() {
    if (!this.pool) return;
    await this.pool.query(`
      create table if not exists services (
        id text primary key,
        payload jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table if not exists service_reviews (
        id bigserial primary key,
        service_id text not null,
        payload jsonb not null,
        created_at timestamptz not null default now()
      );
      create table if not exists verified_invocations (
        id bigserial primary key,
        service_id text not null,
        agent text,
        success boolean not null default true,
        latency_ms integer,
        created_at timestamptz not null default now()
      );
    `);
  }

  async listServices(category?: string) {
    await this.init();
    if (!this.pool) {
      return [];
    }

    const rows = await this.pool.query<{ payload: ServiceRecord }>('select payload from services order by coalesce((payload->>\'rank\')::int, 999) asc');
    const services = rows.rows.map((row: { payload: ServiceRecord }) => row.payload);
    return services.filter((service: ServiceRecord) => !category || service.category === category);
  }

  async getService(id: string) {
    await this.init();
    if (!this.pool) {
      return null;
    }

    const service = await this.pool.query<{ payload: ServiceRecord }>('select payload from services where id = $1', [id]);
    if (!service.rowCount) return null;
    const payload = service.rows[0].payload;
    return this.decorateWithCounts(payload);
  }

  async searchServices(query: string) {
    const normalized = query.trim().toLowerCase();
    const services = await this.listServices();
    return services.filter((service) => {
      return [service.name, service.tagline, service.description, service.category, ...service.capabilities, ...service.toolNames]
        .join(' ')
        .toLowerCase()
        .includes(normalized);
    });
  }

  async getReviews(serviceId: string) {
    await this.init();
    if (!this.pool) {
      return [];
    }
    const rows = await this.pool.query<{ payload: ServiceRecord['reviews'][number] }>(
      'select payload from service_reviews where service_id = $1 order by id desc',
      [serviceId]
    );
    return rows.rows.map((row: { payload: ServiceRecord['reviews'][number] }) => row.payload);
  }

  async getTrustSignals(serviceId: string) {
    const service = await this.getService(serviceId);
    if (!service) return null;
    return {
      serviceId,
      endpointStatus: service.endpointStatus,
      successRate: service.successRate,
      latencyMs: service.latencyMs,
      verifiedInvocationCount: service.verifiedInvocationCount ?? 0,
      selfReportedInvocationCount: service.selfReportedInvocationCount ?? 0,
      reviewCount: service.reviews.length,
      reviewedByAgent: service.reviewedByAgent,
      trustLabel: service.trustLabel ?? 'seeded'
    };
  }

  async submitService(input: ServiceWriteInput) {
    await this.init();
    const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const service: ServiceRecord = {
      id: slug || `service-${Date.now()}`,
      rank: 99,
      upvotes: 1,
      trend: 'new',
      name: input.name,
      tagline: input.tagline,
      description: input.description,
      humanNote: input.description,
      providerAgentName: input.providerAgentName || 'Unknown builder',
      providerAgentType: input.providerAgentType || 'provider',
      category: input.category,
      capabilities: input.capabilities || [],
      badges: ['Self-reported'],
      reviewedByAgent: 'Pending review',
      agentReviewScore: 0,
      testedByReviewBot: false,
      endpointStatus: 'Pending verification',
      successRate: 0,
      latencyMs: 0,
      lastCheckedAt: 'Not verified yet',
      mcpEndpoint: input.mcpEndpoint,
      toolCount: input.capabilities?.length || 0,
      toolNames: input.capabilities || [],
      schemaVersion: '2026.03',
      compatibleAgentTypes: 'unknown',
      inputFormats: 'json',
      outputFormats: 'json',
      authMode: input.authMode || 'unknown',
      autonomyLevel: 'unknown',
      pricingModel: input.pricingModel || 'unknown',
      usageExample: input.usageExample || input.tagline,
      launchNotes: [{ title: 'Self-reported', body: 'Pending verification by the platform.' }],
      reviews: [],
      timeline: [{ title: 'Submission received', meta: 'now / agenthunt', text: 'Awaiting first verification sweep.' }],
      verifiedInvocationCount: 0,
      selfReportedInvocationCount: 1,
      trustLabel: 'self-reported'
    };

    if (this.pool) {
      await this.pool.query(
        'insert into services (id, payload) values ($1, $2::jsonb) on conflict (id) do update set payload = excluded.payload, updated_at = now()',
        [service.id, JSON.stringify(service)]
      );
    }
    return service;
  }

  async submitReview(input: ReviewWriteInput) {
    await this.init();
    const review = {
      agent: input.agent,
      score: input.score,
      tested: input.tested,
      summary: input.summary
    };

    if (this.pool) {
      await this.pool.query('insert into service_reviews (service_id, payload) values ($1, $2::jsonb)', [input.serviceId, JSON.stringify(review)]);

      // Update service payload with review aggregates
      const serviceRow = await this.pool.query<{ payload: ServiceRecord }>('select payload from services where id = $1', [input.serviceId]);
      if (serviceRow.rowCount) {
        const payload = serviceRow.rows[0].payload;
        const allReviews = await this.pool.query<{ payload: { score: number; agent: string } }>(
          'select payload from service_reviews where service_id = $1 order by id desc',
          [input.serviceId]
        );
        const scores = allReviews.rows.map(r => r.payload.score);
        const avgScore = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;

        payload.agentReviewScore = avgScore;
        payload.reviewedByAgent = input.agent;
        payload.testedByReviewBot = true;
        payload.upvotes = (payload.upvotes || 0) + 1;

        await this.pool.query(
          'update services set payload = $1::jsonb, updated_at = now() where id = $2',
          [JSON.stringify(payload), input.serviceId]
        );
      }

      await this.recalcRanks();
    }
    return review;
  }

  async recordVerifiedInvocation(input: InvocationWriteInput) {
    await this.init();
    if (this.pool) {
      await this.pool.query(
        'insert into verified_invocations (service_id, agent, success, latency_ms) values ($1, $2, $3, $4)',
        [input.serviceId, input.agent || 'unknown-agent', input.success ?? true, input.latencyMs ?? null]
      );

      // Update service payload with invocation aggregates
      const serviceRow = await this.pool.query<{ payload: ServiceRecord }>('select payload from services where id = $1', [input.serviceId]);
      if (serviceRow.rowCount) {
        const payload = serviceRow.rows[0].payload;
        const stats = await this.pool.query<{ total: string; successful: string; avg_latency: string }>(
          `select count(*)::text as total,
                  count(*) filter (where success = true)::text as successful,
                  coalesce(avg(latency_ms) filter (where latency_ms is not null), 0)::text as avg_latency
           from verified_invocations where service_id = $1`,
          [input.serviceId]
        );
        const total = Number(stats.rows[0].total);
        const successful = Number(stats.rows[0].successful);
        const avgLatency = Math.round(Number(stats.rows[0].avg_latency));

        payload.successRate = total > 0 ? Math.round((successful / total) * 100) : 0;
        payload.latencyMs = avgLatency;
        payload.endpointStatus = (input.success ?? true) ? 'Live' : 'Degraded';
        payload.upvotes = (payload.upvotes || 0) + 1;
        payload.verifiedInvocationCount = successful;
        payload.lastCheckedAt = new Date().toISOString();

        await this.pool.query(
          'update services set payload = $1::jsonb, updated_at = now() where id = $2',
          [JSON.stringify(payload), input.serviceId]
        );
      }

      await this.recalcRanks();
    }
    return this.getTrustSignals(input.serviceId);
  }

  async voteService(serviceId: string, direction: 'up' | 'down') {
    await this.init();
    if (!this.pool) return null;

    const serviceRow = await this.pool.query<{ payload: ServiceRecord }>('select payload from services where id = $1', [serviceId]);
    if (!serviceRow.rowCount) return null;

    const payload = serviceRow.rows[0].payload;
    const current = payload.upvotes || 0;
    payload.upvotes = direction === 'up' ? current + 1 : Math.max(0, current - 1);

    await this.pool.query(
      'update services set payload = $1::jsonb, updated_at = now() where id = $2',
      [JSON.stringify(payload), serviceId]
    );

    await this.recalcRanks();
    // Re-read after rank recalc
    const updated = await this.pool.query<{ payload: ServiceRecord }>('select payload from services where id = $1', [serviceId]);
    return updated.rowCount ? updated.rows[0].payload : payload;
  }

  private async recalcRanks() {
    if (!this.pool) return;
    const rows = await this.pool.query<{ id: string; payload: ServiceRecord }>('select id, payload from services');
    const services = rows.rows.map(r => ({ id: r.id, payload: r.payload }));

    // Sort by composite score descending
    services.sort((a, b) => {
      const scoreA = (a.payload.agentReviewScore || 0) * 5 + (a.payload.verifiedInvocationCount || 0) + (a.payload.upvotes || 0) * 3;
      const scoreB = (b.payload.agentReviewScore || 0) * 5 + (b.payload.verifiedInvocationCount || 0) + (b.payload.upvotes || 0) * 3;
      return scoreB - scoreA;
    });

    // Update rank for each service
    for (let i = 0; i < services.length; i++) {
      const newRank = i + 1;
      if (services[i].payload.rank !== newRank) {
        services[i].payload.rank = newRank;
        await this.pool.query(
          'update services set payload = $1::jsonb, updated_at = now() where id = $2',
          [JSON.stringify(services[i].payload), services[i].id]
        );
      }
    }
  }

  private async decorateWithCounts(service: ServiceRecord): Promise<ServiceRecord> {
    if (!this.pool) return service;
    const [invocations, reviews] = await Promise.all([
      this.pool.query<{ count: string }>('select count(*)::text as count from verified_invocations where service_id = $1 and success = true', [service.id]),
      this.pool.query<{ payload: ServiceRecord['reviews'][number] }>('select payload from service_reviews where service_id = $1 order by id desc', [service.id])
    ]);

    return {
      ...service,
      reviews: reviews.rows.map((row: { payload: ServiceRecord['reviews'][number] }) => row.payload),
      verifiedInvocationCount: Number(invocations.rows[0]?.count || '0'),
      selfReportedInvocationCount: service.selfReportedInvocationCount ?? service.upvotes,
      trustLabel: Number(invocations.rows[0]?.count || '0') > 0 ? 'verified' : 'self-reported'
    };
  }
}
