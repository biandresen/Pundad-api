import assert from "node:assert/strict";
import { mock, test } from "node:test";

let providerCalls = 0;
mock.module("resend", {
  namedExports: {
    Resend: class {
      constructor() { providerCalls++; }
    },
  },
});

const { default: emailService } = await import("../src/services/emailService.js");

test("development verification emails expose a local test link without contacting the provider", async () => {
  const oldEnv = process.env.NODE_ENV;
  const oldDelivery = process.env.EMAIL_DELIVERY;
  const messages = [];
  const output = mock.method(console, "info", (message) => messages.push(JSON.parse(message)));
  try {
    process.env.NODE_ENV = "development";
    process.env.EMAIL_DELIVERY = "console";
    const url = "http://localhost:5173/verify-email/test-token";
    const result = await emailService.sendVerificationEmail("tester@example.test", url, "EN");
    assert.equal(providerCalls, 0);
    assert.equal(result.data.id, "development-console-email");
    assert.equal(messages[0].to, "tester@example.test");
    assert.ok(messages[0].text.includes(url));

    process.env.NODE_ENV = "production";
    await assert.rejects(emailService.sendVerificationEmail("tester@example.test", url), /only available in development/);
    assert.equal(messages.length, 1);
    assert.equal(providerCalls, 0);
  } finally {
    output.mock.restore();
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    if (oldDelivery === undefined) delete process.env.EMAIL_DELIVERY;
    else process.env.EMAIL_DELIVERY = oldDelivery;
  }
});
