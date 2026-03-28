import test from "node:test";
import assert from "node:assert/strict";
import { ServiceCatalog } from "../src/domain/serviceCatalog.js";

test("lists services returns empty array without database", async () => {
  const catalog = new ServiceCatalog();
  const services = await catalog.listServices();
  assert.ok(Array.isArray(services));
  assert.equal(services.length, 0);
});

test("search returns empty array without database", async () => {
  const catalog = new ServiceCatalog();
  const services = await catalog.searchServices("pdf");
  assert.ok(Array.isArray(services));
  assert.equal(services.length, 0);
});

test("getTrustSignals returns null for nonexistent service without database", async () => {
  const catalog = new ServiceCatalog();
  const result = await catalog.getTrustSignals("nonexistent");
  assert.equal(result, null);
});
