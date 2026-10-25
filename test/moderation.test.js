import assert from "node:assert/strict";
import { mock, test } from "node:test";

mock.module("../src/services/moderationService.js", {
  defaultExport: {
    getModerationTermsFromCache: () => ["fag"],
  },
});

const { moderateFields } = await import("../src/utils/moderation.js");

test("clean joke text is not blocked by a term embedded inside a word", () => {
  const moderation = moderateFields({
    title: "En faglig pappavits",
    body: "Denne handler om arbeidsdagen.",
  });

  assert.equal(moderation.blocked, false);
  assert.deepEqual(moderation.matches, {});
});

test("standalone and deliberately obfuscated blocked terms are still blocked", () => {
  assert.equal(moderateFields({ body: "Ikke skriv fag her" }).blocked, true);
  assert.equal(moderateFields({ body: "Ikke skriv f.a.g her" }).blocked, true);
});
