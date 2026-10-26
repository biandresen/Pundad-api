import { body } from "express-validator";
import { getPostBodyError, normalizePostBody } from "../utils/postBody.js";

export default function postBodyValidator() {
  return body("body")
    .custom((value) => {
      const message = getPostBodyError(value);
      if (message) throw new Error(message);
      return true;
    })
    .bail()
    .customSanitizer(normalizePostBody);
}
