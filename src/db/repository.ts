import { Pool } from 'pg';
import servicesSeed from '../seed/services.json' with { type: 'json' };
import { env } from '../config/env.js';
import type { InvocationWriteInput, ReviewWriteInput, ServiceRecord, ServiceWriteInput } from '../domain/types.js';

const defaultVerified = 12;
const defaultSelfReported = 42;

const seededServices: ServiceRecord[] = (servicesSeed as ServiceRecord[]).map((service, index) => ({
  ...service,
  verifiedInvocationCount: service.verifiedInvocationCount ?? Math.max(3, defaultVerified - index),
  selfReportedInvocationCount: service.selfReportedInvocationCount ?? service.upvotes,
  trustLabel: service.trustLabel ?? (service.endpointStatus === 'Live' ? 'verified-healthy' : 'watch')
}));

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
      this.pool = new Pool({ connectionString: env.databaseUrl, ssl: { rejectUnauthorized: false } });
      await this.pool.query('select 1');
      await this.ensureSchema();
      await this.seedIfEmpty();
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

  private async seedIfEmpty() {
    if (!this.pool) return;
    const existing = await this.pool.query<{ count: string }>('select count(*)::text as count from services');
    if (Number(existing.rows[0]?.count || '0') > 0) return;

    for (const service of seededServices) {
      await this.pool.query(
        'insert into services (id, payload) values ($1, $2::jsonb) on conflict (id) do nothing',
        [service.id, JSON.stringify(service)]
      );
      for (const review of service.reviews) {
        await this.pool.query(
          'insert into service_reviews (service_id, payload) values ($1, $2::jsonb)',
          [service.id, JSON.stringify(review)]
        );
      }
      for (let i = 0; i < (service.verifiedInvocationCount ?? 0); i += 1) {
        await this.pool.query(
          'insert into verified_invocations (service_id, agent, success, latency_ms) values ($1, $2, $3, $4)',
          [service.id, `seed-agent-${i + 1}`, true, service.latencyMs]
        );
      }
    }
  }

  async listServices(category?: string) {
    await this.init();
    if (!this.pool) {
      return seededServices.filter((service) => !category || service.category === category);
    }

    const rows = await this.pool.query<{ payload: ServiceRecord }>('select payload from services order by (payload->>\'rank\')::int asc');
    const services = rows.rows.map((row: { payload: ServiceRecord }) => row.payload);
    return services.filter((service: ServiceRecord) => !category || service.category === category);
  }

  async getService(id: string) {
    await this.init();
    if (!this.pool) {
      return seededServices.find((service) => service.id === id) ?? null;
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
      return seededServices.find((service: ServiceRecord) => service.id === serviceId)?.reviews ?? [];
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
    } else {
      seededServices.unshift(service);
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
    } else {
      const service = seededServices.find((entry) => entry.id === input.serviceId);
      service?.reviews.unshift(review);
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
    } else {
      const service = seededServices.find((entry) => entry.id === input.serviceId);
      if (service) service.verifiedInvocationCount = (service.verifiedInvocationCount ?? 0) + 1;
    }
    return this.getTrustSignals(input.serviceId);
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
