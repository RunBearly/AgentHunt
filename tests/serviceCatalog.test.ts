import test from "node:test";
import assert from "node:assert/strict";
import { ServiceCatalog } from "../src/domain/serviceCatalog.js";

test("lists seeded services", async () => {
  const catalog = new ServiceCatalog();
  const services = await catalog.listServices();
  assert.ok(services.length >= 3);
  assert.equal(typeof services[0].name, "string");
});

test("search returns matching service", async () => {
  const catalog = new ServiceCatalog();
  const services = await catalog.searchServices("pdf");
  assert.ok(services.some((service) => service.id === "pdf-ghost"));
});

test("records verified invocation in fallback mode", async () => {
  const catalog = new ServiceCatalog();
  const before = await catalog.getTrustSignals("mesh-router");
  const after = await catalog.recordVerifiedInvocation({ serviceId: "mesh-router", agent: "test-agent", success: true, latencyMs: 123 });
  assert.ok(before);
  assert.ok(after);
  assert.equal(after.serviceId, "mesh-router");
  assert.ok((after.verifiedInvocationCount ?? 0) >= (before?.verifiedInvocationCount ?? 0));
});
