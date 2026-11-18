import test from "node:test";
import assert from "node:assert/strict";

import { isAllowedHost, onRequest } from "../functions/_middleware.js";

function makeContext(url) {
  const state = { nextCalls: 0 };
  return {
    state,
    request: new Request(url),
    env: {},
    next: async () => {
      state.nextCalls += 1;
      return new Response("app", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  };
}

test("canonical domains are allowed", () => {
  assert.equal(isAllowedHost("bucksy.life"), true);
  assert.equal(isAllowedHost("www.bucksy.life"), true);
});

test("hostname matching ignores case and a trailing dot", () => {
  assert.equal(isAllowedHost("BUCKSY.LIFE"), true);
  assert.equal(isAllowedHost("WWW.Bucksy.Life"), true);
  assert.equal(isAllowedHost("bucksy.life."), true);
});

test("local development hosts are allowed", () => {
  assert.equal(isAllowedHost("localhost"), true);
  assert.equal(isAllowedHost("127.0.0.1"), true);
  assert.equal(isAllowedHost("[::1]"), true);
});

test("ports are stripped before matching", () => {
  assert.equal(isAllowedHost("localhost:8788"), true);
  assert.equal(isAllowedHost("127.0.0.1:8788"), true);
  assert.equal(isAllowedHost("[::1]:8788"), true);
  assert.equal(isAllowedHost("bucksy.life:443"), true);
  assert.equal(isAllowedHost("personal-finance-8ch.pages.dev:443"), false);
});

test("preview deployment hosts are allowed", () => {
  assert.equal(isAllowedHost("a1b2c3.personal-finance.pages.dev"), true);
  assert.equal(isAllowedHost("feature-branch.personal-finance.pages.dev"), true);
});

test("the production alias is not allowed", () => {
  assert.equal(isAllowedHost("personal-finance-8ch.pages.dev"), false);
});

test("unrelated hosts are not allowed", () => {
  assert.equal(isAllowedHost(""), false);
  assert.equal(isAllowedHost(null), false);
  assert.equal(isAllowedHost("evil.example.com"), false);
  assert.equal(isAllowedHost("bucksy.life.evil.example.com"), false);
  assert.equal(isAllowedHost("evil-personal-finance.pages.dev"), false);
  assert.equal(isAllowedHost("personal-finance.pages.dev"), false);
});

test("canonical host falls through to the app", async () => {
  const ctx = makeContext("https://bucksy.life/app");
  const response = await onRequest(ctx);
  assert.equal(response.status, 200);
  assert.equal(ctx.state.nextCalls, 1);
});

test("www host falls through to the app", async () => {
  const ctx = makeContext("https://www.bucksy.life/api/data");
  const response = await onRequest(ctx);
  assert.equal(response.status, 200);
  assert.equal(ctx.state.nextCalls, 1);
});

test("preview host falls through to the app", async () => {
  const ctx = makeContext("https://a1b2c3.personal-finance.pages.dev/app");
  const response = await onRequest(ctx);
  assert.equal(response.status, 200);
  assert.equal(ctx.state.nextCalls, 1);
});

test("local dev host falls through to the app", async () => {
  const ctx = makeContext("http://localhost:8788/app");
  const response = await onRequest(ctx);
  assert.equal(response.status, 200);
  assert.equal(ctx.state.nextCalls, 1);
});

test("the Host header wins over the URL origin", async () => {
  const ctx = {
    state: { nextCalls: 0 },
    request: { url: "https://internal.example/app", headers: new Headers({ host: "bucksy.life" }) },
    env: {},
    next: async () => {
      ctx.state.nextCalls += 1;
      return new Response("app", { status: 200 });
    },
  };
  const response = await onRequest(ctx);
  assert.equal(response.status, 200);
  assert.equal(ctx.state.nextCalls, 1);
});

test("a blocked Host header is denied even if the URL origin looks canonical", async () => {
  const ctx = {
    state: { nextCalls: 0 },
    request: {
      url: "https://bucksy.life/app",
      headers: new Headers({ host: "personal-finance-8ch.pages.dev" }),
    },
    env: {},
    next: async () => {
      ctx.state.nextCalls += 1;
      return new Response("app", { status: 200 });
    },
  };
  const response = await onRequest(ctx);
  assert.equal(response.status, 404);
  assert.equal(ctx.state.nextCalls, 0);
});

test("production alias gets a branded 404 for the app", async () => {
  const ctx = makeContext("https://personal-finance-8ch.pages.dev/app");
  const response = await onRequest(ctx);
  assert.equal(response.status, 404);
  assert.equal(ctx.state.nextCalls, 0);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.text();
  assert.match(body, /This page is not here/);
  assert.match(body, /bucksy\.life/);
  assert.doesNotMatch(body, /app-locked/);
});

test("production alias gets a JSON 404 for the API", async () => {
  const ctx = makeContext("https://personal-finance-8ch.pages.dev/api/data");
  const response = await onRequest(ctx);
  assert.equal(response.status, 404);
  assert.equal(ctx.state.nextCalls, 0);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.deepEqual(await response.json(), { ok: false, error: "Not found" });
});

test("unknown hosts are blocked on both app and API paths", async () => {
  const app = makeContext("https://evil.example.com/app");
  assert.equal((await onRequest(app)).status, 404);
  assert.equal(app.state.nextCalls, 0);

  const api = makeContext("https://evil.example.com/api/auth/status");
  assert.equal((await onRequest(api)).status, 404);
  assert.equal(api.state.nextCalls, 0);
});

test("non-API paths on a blocked host get HTML, not JSON", async () => {
  // `_routes.json` keeps `/` out of the Functions runtime, so the landing page
  // is still served statically on the alias. This covers any other non-API
  // path the runtime is ever asked to handle.
  const ctx = makeContext("https://personal-finance-8ch.pages.dev/some-page");
  const response = await onRequest(ctx);
  assert.equal(response.status, 404);
  assert.equal(ctx.state.nextCalls, 0);
  assert.match(response.headers.get("content-type"), /text\/html/);
});
