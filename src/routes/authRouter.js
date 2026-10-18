import { Router } from "express";
import registerUserValidator from "../validation/registerValidator.js";
import loginUserValidator from "../validation/loginValidator.js";
import authController from "../controllers/authController.js";
import asyncErrorHandler from "../utils/asyncErrorHandler.js";
import checkValidation from "../middleware/checkValidation.js";
import verifyRegistrationTurnstile from "../middleware/verifyRegistrationTurnstile.js";
import resetPasswordValidator from "../validation/resetPasswordValidator.js";
import updatePasswordValidator from "../validation/updatePasswordValidator.js";
import resendVerificationValidator from "../validation/resendVerificationValidator.js";
import {
  authLimiter,
  emailVerificationLimiter,
  newPasswordLimiter,
  passwordResetLimiter,
  registerLimiter,
  resendVerificationLimiter,
  sessionLimiter,
} from "../middleware/rateLimiters.js";

const router = Router();

router.get("/health", authController.health);
router.get("/ready", authController.readiness);

router.post(
  "/register",
  registerLimiter,
  asyncErrorHandler(verifyRegistrationTurnstile),
  registerUserValidator,
  checkValidation,
  asyncErrorHandler(authController.registerUser)
);

router.post(
  "/login",
  authLimiter,
  loginUserValidator,
  checkValidation,
  asyncErrorHandler(authController.loginUser)
);

router.post("/logout", sessionLimiter, asyncErrorHandler(authController.logoutUser));

router.post("/refresh", sessionLimiter, asyncErrorHandler(authController.refreshAccessToken));

router.get("/verify-email", emailVerificationLimiter, asyncErrorHandler(authController.verifyEmail));

router.post(
  "/resend-verification",
  resendVerificationLimiter,
  resendVerificationValidator,
  checkValidation,
  asyncErrorHandler(authController.resendVerificationEmail)
);

router.post(
  "/new-password",
  newPasswordLimiter,
  updatePasswordValidator,
  checkValidation,
  asyncErrorHandler(authController.processResetPassword)
);

router.post(
  "/reset-password",
  passwordResetLimiter,
  resetPasswordValidator,
  checkValidation,
  asyncErrorHandler(authController.resetPassword)
);

export default router;
