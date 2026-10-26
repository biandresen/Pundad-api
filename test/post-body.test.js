import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePostBody, getPostBodyError } from "../src/utils/postBody.js";

test("post bodies normalize mixed line endings without trimming paragraph formatting", () => {
  assert.equal(normalizePostBody("\r\nSetup\r\n\rPunchline\r"), "\nSetup\n\nPunchline\n");
  assert.equal(getPostBodyError("\r\nSetup\r\n\rPunchline\r"), null);
});

for (const ending of ["\n", "\r\n", "\r"]) {
  test(`body limits count normalized boundaries ${JSON.stringify(ending)}`, () => {
    assert.equal(getPostBodyError(Array(50).fill("x").join(ending)), null);
    assert.equal(getPostBodyError(Array(51).fill("x").join(ending)), "Body must have at most 50 logical lines");
    assert.equal(getPostBodyError(`Setup${ending}${ending}Punchline`), null);
    assert.equal(getPostBodyError(`Setup${ending}${ending}${ending}Punchline`), "Body must not contain three consecutive newlines");
  });
}
test("leading/trailing newlines count and invalid formatting is never trimmed to pass", () => {
  assert.equal(getPostBodyError("\n\nSetup\n\n"), null);
  assert.equal(getPostBodyError("\n\n\nSetup"), "Body must not contain three consecutive newlines");
  assert.equal(getPostBodyError("Setup\r\n\r\r\n"), "Body must not contain three consecutive newlines");
  assert.equal(getPostBodyError(Array(50).fill("x").join("\n") + "\n"), "Body must have at most 50 logical lines");
  assert.equal(getPostBodyError("x".repeat(10000)), null);
  assert.equal(getPostBodyError("x".repeat(10001)), "Text is too long. Max 10000 characters");
  assert.equal(getPostBodyError("x".repeat(9998) + "\r\n\r\n"), null);
  for (const value of [undefined, null, [], 123, "", " \r\n"]) assert.equal(getPostBodyError(value), "Body cannot be empty");
});
