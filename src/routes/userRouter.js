import { Router } from "express";
import jokeController from "../controllers/jokeController.js";
import userController from "../controllers/userController.js";
import asyncErrorHandler from "../utils/asyncErrorHandler.js";
import isAuthenticated from "../middleware/isAuthenticated.js";
import updateUserValidator from "../validation/updateUserValidator.js";
import isAdmin from "../middleware/isAdmin.js";
import changeRoleValidator from "../validation/changeRoleValidator.js";
import isSelfOrAdmin from "../middleware/isSelfOrAdmin.js";
import queryParametersValidator from "../validation/queryParametersValidator.js";
import checkValidation from "../middleware/checkValidation.js";
import avatarUpload from "../middleware/avatarUpload.js";
import { profileLimiter, readHeavyLimiter, uploadLimiter } from "../middleware/rateLimiters.js";

const router = Router();

router.get("/me", isAuthenticated, asyncErrorHandler(userController.getMe));
router.get("/:id", isAuthenticated, asyncErrorHandler(userController.getUserProfile));
router.get("/input/:userInput", isAuthenticated, asyncErrorHandler(userController.getUserByNameOrEmail));

router.patch(
  "/:id",
  profileLimiter,
  isAuthenticated,
  isSelfOrAdmin,
  ...avatarUpload,
  updateUserValidator,
  checkValidation,
  asyncErrorHandler(userController.updateUserProfile),
);

router.patch(
  "/:id/role",
  profileLimiter,
  isAuthenticated,
  isAdmin,
  changeRoleValidator,
  checkValidation,
  asyncErrorHandler(userController.changeUserRole),
);

router.patch(
  "/:id/reactivate",
  profileLimiter,
  isAuthenticated,
  isAdmin,
  asyncErrorHandler(userController.reactivateUser),
);

router.delete(
  "/:id",
  profileLimiter,
  isAuthenticated,
  isSelfOrAdmin,
  asyncErrorHandler(userController.deleteUser),
);

router.get(
  "/:id/jokes",
  readHeavyLimiter,
  queryParametersValidator,
  checkValidation,
  asyncErrorHandler(jokeController.getAllJokesFromUser),
);

router.post(
  "/resend-email-change-verification",
  profileLimiter,
  isAuthenticated,
  asyncErrorHandler(userController.resendEmailChangeVerification),
);

export default router;
