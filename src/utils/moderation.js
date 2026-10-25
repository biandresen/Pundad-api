import moderationService from "../services/moderationService.js";

const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF]/g;
const DIACRITICS_REGEX = /[\u0300-\u036f]/g;
const NON_ALNUM_REGEX = /[^\p{L}\p{N}\s]/gu;
const NON_ALNUM_NO_SPACE_REGEX = /[^\p{L}\p{N}]/gu;
const MULTISPACE_REGEX = /\s+/g;

const LEET_MAP = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  "$": "s",
};

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeUnicode(input = "") {
  return input
    .normalize("NFKD")
    .replace(DIACRITICS_REGEX, "")
    .replace(ZERO_WIDTH_REGEX, "");
}

function basicNormalize(input = "") {
  return normalizeUnicode(input)
    .toLowerCase()
    .replace(NON_ALNUM_REGEX, " ")
    .replace(MULTISPACE_REGEX, " ")
    .trim();
}

function joinedNormalize(input = "") {
  return normalizeUnicode(input)
    .toLowerCase()
    .replace(NON_ALNUM_NO_SPACE_REGEX, "");
}

function applyLeetMap(input = "") {
  return input
    .split("")
    .map((char) => LEET_MAP[char] ?? char)
    .join("");
}

function collapseRepeatedChars(input = "") {
  return input.replace(/(.)\1{2,}/g, "$1");
}

function buildBoundaryRegex(term) {
  const escaped = escapeRegex(term);
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i");
}

function buildObfuscatedBoundaryRegex(term) {
  const pattern = Array.from(term)
    .map((character) => escapeRegex(character))
    .join("[^\\p{L}\\p{N}]*");

  return new RegExp(`(^|[^\\p{L}\\p{N}])${pattern}([^\\p{L}\\p{N}]|$)`, "iu");
}

function buildTermVariants(term) {
  const normalized = basicNormalize(term);
  const joined = joinedNormalize(term);
  const leet = joinedNormalize(applyLeetMap(term));
  const collapsed = collapseRepeatedChars(joined);

  return Array.from(
    new Set([normalized, joined, leet, collapsed].filter(Boolean))
  );
}

function buildInputVariants(input) {
  const basic = basicNormalize(input);
  const normalized = normalizeUnicode(input).toLowerCase();
  const leet = applyLeetMap(normalized);
  const collapsed = collapseRepeatedChars(normalized);
  const leetCollapsed = collapseRepeatedChars(leet);

  return {
    basic,
    obfuscated: Array.from(new Set([normalized, leet, collapsed, leetCollapsed])),
  };
}

function matchesBlockedTerm(input, term, { aggressive = false } = {}) {
  const variants = buildInputVariants(input);
  const termVariants = buildTermVariants(term);

  for (const variant of termVariants) {
    if (!variant) continue;

    const regex = buildBoundaryRegex(variant);
    if (regex.test(variants.basic)) {
      return true;
    }
  }

  if (aggressive) {
    for (const variant of termVariants) {
      if (!variant) continue;

      const regex = buildObfuscatedBoundaryRegex(joinedNormalize(variant));
      if (variants.obfuscated.some((inputVariant) => regex.test(inputVariant))) {
        return true;
      }
    }
  }

  return false;
}

export function findBlockedTerms(input = "", { aggressive = false } = {}) {
  const blockedTerms = moderationService.getModerationTermsFromCache();

  return blockedTerms.filter((term) =>
    matchesBlockedTerm(input, term, { aggressive })
  );
}

export function moderateFields(fields = {}) {
  const result = {};

  const aggressiveFields = new Set([
    "username",
    "title",
    "body",
    "comment",
    "tags",
  ]);

  for (const [field, value] of Object.entries(fields)) {
    if (typeof value !== "string" || !value.trim()) continue;

    const aggressive = aggressiveFields.has(field);
    const matches = findBlockedTerms(value, { aggressive });

    if (matches.length > 0) {
      result[field] = matches;
    }
  }

  return {
    blocked: Object.keys(result).length > 0,
    matches: result,
  };
}
