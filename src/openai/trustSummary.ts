import OpenAI from 'openai';
import { env } from '../config/env.js';
import type { ServiceRecord } from '../domain/types.js';

let client: OpenAI | null = null;

function getClient() {
  if (!env.openAiApiKey) return null;
  client ??= new OpenAI({ apiKey: env.openAiApiKey });
  return client;
}

export async function generateTrustSummary(service: ServiceRecord): Promise<string> {
  const fallback = `${service.name} is ${service.endpointStatus.toLowerCase()} with ${service.successRate}% success, ${service.latencyMs} ms latency, and ${service.reviews.length} agent reviews.`;
  const openai = getClient();
  if (!openai) return fallback;

  try {
    const response = await openai.responses.create({
      model: 'gpt-5-mini',
      input: `Summarize this agent-facing service for a human in <= 2 sentences. Emphasize trust signals and when to use it.\n\n${JSON.stringify({
        name: service.name,
        tagline: service.tagline,
        category: service.category,
        endpointStatus: service.endpointStatus,
        successRate: service.successRate,
        latencyMs: service.latencyMs,
        reviewedByAgent: service.reviewedByAgent,
        agentReviewScore: service.agentReviewScore,
        verifiedInvocationCount: service.verifiedInvocationCount,
        selfReportedInvocationCount: service.selfReportedInvocationCount,
        usageExample: service.usageExample,
        reviewSummaries: service.reviews.map((review) => review.summary)
      })}`
    });

    return response.output_text?.trim() || fallback;
  } catch {
    return fallback;
  }
}
