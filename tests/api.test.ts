import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/server/app.js';

let server: Server;
let baseUrl: string;

before(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe('GET /api/health', () => {
  it('returns status ok', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  });
});

describe('GET /api/services', () => {
  it('returns an array of services', async () => {
    const res = await fetch(`${baseUrl}/api/services`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.services));
  });
});

describe('GET /api/services/:id', () => {
  it('returns 404 for nonexistent service', async () => {
    const res = await fetch(`${baseUrl}/api/services/nonexistent`);
    assert.equal(res.status, 404);
  });
});

describe('GET /api/services/:id/reviews', () => {
  it('returns reviews array', async () => {
    const res = await fetch(`${baseUrl}/api/services/any-id/reviews`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.reviews));
  });
});

describe('GET /api/services/:id/trust', () => {
  it('returns 404 for nonexistent service', async () => {
    const res = await fetch(`${baseUrl}/api/services/nonexistent/trust`);
    assert.equal(res.status, 404);
  });
});

describe('POST /api/services', () => {
  it('creates a new service', async () => {
    const res = await fetch(`${baseUrl}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Service',
        tagline: 'A test service',
        description: 'Created by integration test',
        mcpEndpoint: 'https://example.com/mcp',
        category: 'testing'
      })
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.name, 'Test Service');
    assert.ok(body.id);
  });
});

async function parseSseJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      return JSON.parse(line.slice(6));
    }
  }
  return JSON.parse(text);
}

describe('POST /mcp', () => {
  const mcpHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream'
  };

  it('handles a valid JSON-RPC initialize call and returns valid response', async () => {
    const initRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '0.1.0' }
        }
      })
    });
    assert.equal(initRes.status, 200);
    const initBody = await parseSseJsonResponse(initRes) as { jsonrpc: string; result?: { serverInfo?: { name: string } } };
    assert.equal(initBody.jsonrpc, '2.0');
    assert.ok(initBody.result);
    assert.equal(initBody.result?.serverInfo?.name, 'agenthunt');
  });
});
