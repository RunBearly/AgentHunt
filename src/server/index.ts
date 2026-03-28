import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { env, assertLaunchEnv } from '../config/env.js';
import { ServiceCatalog } from '../domain/serviceCatalog.js';
import { createAgentHuntMcpServer } from '../mcp/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const webRoot = path.join(projectRoot, 'web');
const catalog = new ServiceCatalog();
const app = createMcpExpressApp();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', async (_req, res) => {
  await catalog.listServices();
  res.json({
    status: 'ok',
    service: 'AgentHunt',
    machineSurface: '/mcp',
    database: catalog.getHealth(),
    launchEnv: assertLaunchEnv()
  });
});

app.get('/api/services', async (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const services = typeof req.query.query === 'string'
    ? await catalog.searchServices(req.query.query)
    : await catalog.listServices(category);
  res.json({ services, source: catalog.getHealth() });
});

app.get('/api/services/:id', async (req, res) => {
  const service = await catalog.getService(req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  res.json(service);
});

app.get('/api/services/:id/reviews', async (req, res) => {
  const reviews = await catalog.getReviews(req.params.id);
  res.json({ reviews });
});

app.get('/api/services/:id/trust', async (req, res) => {
  const trust = await catalog.getTrustSignals(req.params.id);
  if (!trust) return res.status(404).json({ error: 'Trust signals not found' });
  res.json(trust);
});

app.get('/api/services/:id/summary', async (req, res) => {
  const summary = await catalog.generateHumanSummary(req.params.id);
  if (!summary) return res.status(404).json({ error: 'Service not found' });
  res.json(summary);
});

app.post('/api/services', async (req, res) => {
  if (env.adminWriteToken && req.header('x-admin-write-token') !== env.adminWriteToken) {
    return res.status(401).json({ error: 'Missing or invalid admin write token' });
  }
  const service = await catalog.submitService(req.body);
  res.status(201).json(service);
});

app.post('/api/reviews', async (req, res) => {
  if (env.adminWriteToken && req.header('x-admin-write-token') !== env.adminWriteToken) {
    return res.status(401).json({ error: 'Missing or invalid admin write token' });
  }
  const review = await catalog.submitReview(req.body);
  res.status(201).json(review);
});

app.post('/api/invocations', async (req, res) => {
  const trust = await catalog.recordVerifiedInvocation(req.body);
  res.status(201).json(trust);
});

app.post('/mcp', async (req, res) => {
  const server = createAgentHuntMcpServer(catalog);
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error('MCP request failed', error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

app.get('/mcp', (_req, res) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
});

app.delete('/mcp', (_req, res) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
});

app.get('/llms.txt', (_req, res) => {
  res.type('text/plain').sendFile(path.join(projectRoot, 'llms.txt'));
});

app.use(express.static(webRoot));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(webRoot, 'index.html'));
});

app.listen(env.port, () => {
  console.log(`AgentHunt listening on http://localhost:${env.port}`);
});
