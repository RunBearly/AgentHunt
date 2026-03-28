import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { ServiceCatalog } from '../domain/serviceCatalog.js';

export function createAgentHuntMcpServer(catalog = new ServiceCatalog()) {
  const server = new McpServer(
    {
      name: 'agenthunt',
      version: '0.1.0'
    },
    {
      capabilities: { logging: {} }
    }
  );

  server.registerTool(
    'list_services',
    {
      description: 'List available MCP and agent-facing services from AgentHunt.',
      inputSchema: {
        category: z.string().optional().describe('Optional category filter.')
      }
    },
    async ({ category }) => {
      const services = await catalog.listServices(category);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ services }, null, 2)
          }
        ]
      };
    }
  );

  server.registerTool(
    'search_services',
    {
      description: 'Search AgentHunt listings by keyword, capability, category, or endpoint.',
      inputSchema: {
        query: z.string().describe('Search query for the service catalog.')
      }
    },
    async ({ query }) => {
      const services = await catalog.searchServices(query);
      return {
        content: [{ type: 'text', text: JSON.stringify({ services }, null, 2) }]
      };
    }
  );

  server.registerTool(
    'get_service_details',
    {
      description: 'Get the full details for one AgentHunt service listing.',
      inputSchema: {
        serviceId: z.string().describe('The unique service id.')
      }
    },
    async ({ serviceId }) => {
      const service = await catalog.getService(serviceId);
      if (!service) {
        return { content: [{ type: 'text', text: `No service found for id ${serviceId}.` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(service, null, 2) }] };
    }
  );

  server.registerTool(
    'get_service_reviews',
    {
      description: 'Get agent-written reviews for a specific AgentHunt service.',
      inputSchema: {
        serviceId: z.string().describe('The unique service id.')
      }
    },
    async ({ serviceId }) => {
      const reviews = await catalog.getReviews(serviceId);
      return { content: [{ type: 'text', text: JSON.stringify({ reviews }, null, 2) }] };
    }
  );

  server.registerTool(
    'get_service_trust_signals',
    {
      description: 'Get trust signals for a specific AgentHunt service, including verified and self-reported counts.',
      inputSchema: {
        serviceId: z.string().describe('The unique service id.')
      }
    },
    async ({ serviceId }) => {
      const trust = await catalog.getTrustSignals(serviceId);
      if (!trust) {
        return { content: [{ type: 'text', text: `No trust signals found for ${serviceId}.` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(trust, null, 2) }] };
    }
  );

  server.registerTool(
    'submit_service',
    {
      description: 'Submit a new service to AgentHunt. Services start as self-reported until verified.',
      inputSchema: {
        name: z.string(),
        tagline: z.string(),
        description: z.string(),
        mcpEndpoint: z.string(),
        category: z.string(),
        capabilities: z.array(z.string()).optional(),
        providerAgentName: z.string().optional(),
        providerAgentType: z.string().optional(),
        authMode: z.string().optional(),
        pricingModel: z.string().optional(),
        usageExample: z.string().optional()
      }
    },
    async (input) => {
      const service = await catalog.submitService(input);
      return { content: [{ type: 'text', text: JSON.stringify(service, null, 2) }] };
    }
  );

  server.registerTool(
    'submit_review',
    {
      description: 'Submit a review for an AgentHunt service.',
      inputSchema: {
        serviceId: z.string(),
        agent: z.string(),
        score: z.number().min(0).max(5),
        tested: z.string(),
        summary: z.string()
      }
    },
    async (input) => {
      const review = await catalog.submitReview(input);
      return { content: [{ type: 'text', text: JSON.stringify(review, null, 2) }] };
    }
  );

  server.registerTool(
    'record_verified_invocation',
    {
      description: 'Record a verified invocation for an AgentHunt service.',
      inputSchema: {
        serviceId: z.string(),
        agent: z.string().optional(),
        success: z.boolean().optional(),
        latencyMs: z.number().optional()
      }
    },
    async (input) => {
      const trust = await catalog.recordVerifiedInvocation(input);
      return { content: [{ type: 'text', text: JSON.stringify(trust, null, 2) }] };
    }
  );

  return server;
}
