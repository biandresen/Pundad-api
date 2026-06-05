import { body } from "express-validator";
import { MAX_CHARS } from "../constants.js";

const newJokeValidator = [
  body("title")
  .notEmpty().withMessage("Title cannot be empty")
  .trim()
  .isLength({ max: MAX_CHARS.TITLE }).withMessage(`Title is too long. Max ${MAX_CHARS.TITLE} characters`),

  body("body")
  .notEmpty().withMessage("Body cannot be empty")
  .trim()
  .isLength({ max: MAX_CHARS.BODY }).withMessage(`Text is too long. Max ${MAX_CHARS.BODY} characters`),

  body("tags")
  .optional()
  .isArray()
  .withMessage("Tags must be an array")
  .custom((tags) => tags.every((tag) => typeof tag === "string"))
  .withMessage("Tags must be an array of strings or empty")
  .custom((tags) => tags.every((tag) => tag.length <= MAX_CHARS.TAGS))
  .withMessage(`Tag text is too long. Max ${MAX_CHARS.TAGS} characters`),


  body("published").optional().isBoolean().withMessage("Published must be a boolean").toBoolean(),
];

export default newJokeValidator;
