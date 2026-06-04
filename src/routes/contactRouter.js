import { Router } from "express";
import contactController from "../controllers/contactController.js";
import checkValidation from "../middleware/checkValidation.js";
import { contactLimiter } from "../middleware/rateLimiters.js";
import asyncErrorHandler from "../utils/asyncErrorHandler.js";
import contactValidator from "../validation/contactValidator.js";

const router = Router();

router.post(
  "/",
  contactLimiter,
  contactValidator,
  checkValidation,
  asyncErrorHandler(contactController.sendContactMessage)
);

export default router;
