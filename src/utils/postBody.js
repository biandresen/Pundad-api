import CustomError from "./CustomError.js";
import { MAX_CHARS } from "../constants.js";

export function normalizePostBody(body) {
  return body.replace(/\r\n?/g, "\n");
}

// Count all LF boundaries, including leading/trailing empty lines. Never trim
// before checking: trimming could turn an invalid body into a valid one.
export function getPostBodyError(body) {
  if (typeof body !== "string" || !body.trim()) return "Body cannot be empty";
  const normalized = normalizePostBody(body);
  if (normalized.length > MAX_CHARS.BODY) return "Text is too long. Max 10000 characters";
  if (normalized.split("\n").length > 50) return "Body must have at most 50 logical lines";
  if (/\n{3}/.test(normalized)) return "Body must not contain three consecutive newlines";
  return null;
}

export function validatePostBody(body) {
  const message = getPostBodyError(body);
  if (message) throw new CustomError(400, "Validation failed", [{ field: "body", message }]);
  return normalizePostBody(body);
}
