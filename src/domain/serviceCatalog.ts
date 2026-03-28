import { generateTrustSummary } from '../openai/trustSummary.js';
import { AgentHuntRepository } from '../db/repository.js';
import type { InvocationWriteInput, ReviewWriteInput, ServiceWriteInput } from './types.js';

export class ServiceCatalog {
  constructor(private readonly repository = new AgentHuntRepository()) {}

  getHealth() {
    return this.repository.getHealth();
  }

  async listServices(category?: string) {
    return this.repository.listServices(category);
  }

  async searchServices(query: string) {
    return this.repository.searchServices(query);
  }

  async getService(id: string) {
    return this.repository.getService(id);
  }

  async getReviews(serviceId: string) {
    return this.repository.getReviews(serviceId);
  }

  async getTrustSignals(serviceId: string) {
    return this.repository.getTrustSignals(serviceId);
  }

  async submitService(input: ServiceWriteInput) {
    return this.repository.submitService(input);
  }

  async submitReview(input: ReviewWriteInput) {
    return this.repository.submitReview(input);
  }

  async voteService(serviceId: string, direction: 'up' | 'down') {
    return this.repository.voteService(serviceId, direction);
  }

  async recordVerifiedInvocation(input: InvocationWriteInput) {
    return this.repository.recordVerifiedInvocation(input);
  }

  async generateHumanSummary(serviceId: string) {
    const service = await this.repository.getService(serviceId);
    if (!service) return null;
    return {
      serviceId,
      summary: await generateTrustSummary(service)
    };
  }
}
