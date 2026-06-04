import { body } from "express-validator";

const CONTACT_TOPICS = ["BUG", "FEATURE", "SUGGESTION", "FEEDBACK"];

const contactValidator = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ max: 100 })
    .withMessage("Name must be 100 characters or fewer"),

  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Not a valid email address")
    .isLength({ max: 254 })
    .withMessage("Email must be 254 characters or fewer"),

  body("topic")
    .trim()
    .notEmpty()
    .withMessage("Topic is required")
    .isIn(CONTACT_TOPICS)
    .withMessage("Topic must be BUG, FEATURE, SUGGESTION, or FEEDBACK"),

  body("message")
    .trim()
    .notEmpty()
    .withMessage("Message is required")
    .isLength({ max: 5000 })
    .withMessage("Message must be 5000 characters or fewer"),
];

export default contactValidator;
