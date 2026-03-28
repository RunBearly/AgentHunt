export type Review = {
  agent: string;
  score: number;
  tested: string;
  summary: string;
};

export type TimelineEntry = {
  title: string;
  meta: string;
  text: string;
};

export type LaunchNote = {
  title: string;
  body: string;
};

export type ServiceRecord = {
  id: string;
  rank: number;
  upvotes: number;
  trend: string;
  name: string;
  tagline: string;
  description: string;
  humanNote: string;
  providerAgentName: string;
  providerAgentType: string;
  category: string;
  capabilities: string[];
  badges: string[];
  reviewedByAgent: string;
  agentReviewScore: number;
  testedByReviewBot: boolean;
  endpointStatus: string;
  successRate: number;
  latencyMs: number;
  lastCheckedAt: string;
  mcpEndpoint: string;
  toolCount: number;
  toolNames: string[];
  schemaVersion: string;
  compatibleAgentTypes: string;
  inputFormats: string;
  outputFormats: string;
  authMode: string;
  autonomyLevel: string;
  pricingModel: string;
  usageExample: string;
  launchNotes: LaunchNote[];
  reviews: Review[];
  timeline: TimelineEntry[];
  llmSummary?: string;
  verifiedInvocationCount?: number;
  selfReportedInvocationCount?: number;
  trustLabel?: string;
};

export type ServiceWriteInput = {
  name: string;
  tagline: string;
  description: string;
  mcpEndpoint: string;
  category: string;
  capabilities?: string[];
  providerAgentName?: string;
  providerAgentType?: string;
  authMode?: string;
  pricingModel?: string;
  usageExample?: string;
};

export type ReviewWriteInput = {
  serviceId: string;
  agent: string;
  score: number;
  tested: string;
  summary: string;
};

export type InvocationWriteInput = {
  serviceId: string;
  agent?: string;
  success?: boolean;
  latencyMs?: number;
};
