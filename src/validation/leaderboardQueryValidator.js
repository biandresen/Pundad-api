import { query } from "express-validator";

// Defaults are applied by the controller when these query parameters are absent.
const leaderboardQueryValidator = [
  query("period")
    .optional()
    .custom((value, { req }) => typeof value === "string" && !req.queryPolluted?.period)
    .withMessage("period must be 'week', 'month', or 'all'")
    .bail()
    .isIn(["week", "month", "all"])
    .withMessage("period must be 'week', 'month', or 'all'"),
  query("limit")
    .optional()
    .custom((value, { req }) => typeof value === "string" && !req.queryPolluted?.limit)
    .withMessage("limit must be an integer between 1 and 100")
    .bail()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be an integer between 1 and 100")
    .toInt(),
];

export default leaderboardQueryValidator;
