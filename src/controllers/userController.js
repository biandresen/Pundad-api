import { matchedData } from "express-validator";
import { hashPassword, matchPassword } from "../utils/passwordCrypt.js";
import CustomError from "../utils/CustomError.js";
import successResponse from "../utils/successResponse.js";
import userService from "../services/userService.js";
import { toClientUser } from "../utils/toClientUser.js";
import { moderateFields } from "../utils/moderation.js";
import logService from "../services/logService.js";
import authService from "../services/authService.js";
import crypto from "crypto";
import emailService from "../services/emailService.js";
import { FRONTEND_BASE_URL } from "../constants.js";

async function getMe(req, res, next) {
  const userId = Number(req.user?.id);
  if (isNaN(userId)) return next(new CustomError(401, "Unauthorized"));

  const language = req.language;
  const user = await userService.getUserById(userId, { language });

  if (!user) return next(new CustomError(404, "User not found"));

  const clientUser = toClientUser(user);

  return successResponse(res, 200, "User retrieved successfully", clientUser, 1);
}

async function getUserByNameOrEmail(req, res, next) {
  const userInput = req.params?.userInput?.trim();

  if (!userInput) {
    return next(new CustomError(400, "Username or email is required"));
  }

  const looksLikeEmail = userInput.includes("@");
  let user = null;

  if (looksLikeEmail) {
    user = await userService.getUserByEmail(userInput);
    if (!user) user = await userService.getUserByUsername(userInput);
  } else {
    user = await userService.getUserByUsername(userInput);
    if (!user) user = await userService.getUserByEmail(userInput);
  }

  if (!user) {
    return next(new CustomError(404, "User not found"));
  }

  return successResponse(
    res,
    200,
    "User retrieved successfully",
    { ...toClientUser(user), active: user.active },
    1,
  );
}

async function updateUserProfile(req, res, next) {
  const userId = Number(req.user?.id);
  if (isNaN(userId)) return next(new CustomError(401, "Unauthorized"));

  const updateData = matchedData(req);

  const currentUser = await userService.getUserByIdWithPassword(userId);
  if (!currentUser) return next(new CustomError(404, "User not found"));

  if (updateData.username) {
    const moderation = moderateFields({
      username: updateData.username.trim(),
    });

    if (moderation.blocked) {
      return next(
        new CustomError(400, "Content contains blocked language", [
          { field: "username", message: "Contains inappropriate language" },
        ]),
      );
    }

    updateData.username = updateData.username.trim();
  }

  if (updateData.email) {
    updateData.email = updateData.email.trim().toLowerCase();
  }

  if (req.processedImage?.relativeUrl) {
    updateData.avatar = req.processedImage.relativeUrl;
  }

  const emailChangeRequested =
    typeof updateData.email === "string" &&
    updateData.email.length > 0 &&
    updateData.email !== currentUser.email;

  const passwordChangeRequested =
    typeof updateData.password === "string" && updateData.password.trim().length > 0;

  const sensitiveChangeRequested = emailChangeRequested || passwordChangeRequested;

  if (sensitiveChangeRequested) {
    if (!updateData.currentPassword || typeof updateData.currentPassword !== "string") {
      return next(
        new CustomError(400, "Current password is required for this change", [
          { field: "currentPassword", message: "Current password is required" },
        ]),
      );
    }

    const passwordMatches = await matchPassword(updateData.currentPassword, currentUser.password);

    if (!passwordMatches) {
      return next(
        new CustomError(400, "Current password is incorrect", [
          { field: "currentPassword", message: "Current password is incorrect" },
        ]),
      );
    }
  }

  const fieldsToUpdate = {};

  if (updateData.username !== undefined) fieldsToUpdate.username = updateData.username;
  if (updateData.avatar !== undefined) fieldsToUpdate.avatar = updateData.avatar;
  if (updateData.preferredLanguage !== undefined)
    fieldsToUpdate.preferredLanguage = updateData.preferredLanguage;

  if (passwordChangeRequested) {
    fieldsToUpdate.password = await hashPassword(updateData.password);
  }

  if (emailChangeRequested) {
    // Ensure target email is not already in use
    const existingUserWithEmail = await userService.findUserByEmailOrPendingEmailExcludingId(
      updateData.email,
      userId,
    );

    if (existingUserWithEmail) {
      return next(
        new CustomError(400, "Email is already in use", [
          { field: "email", message: "Email is already in use" },
        ]),
      );
    }

    fieldsToUpdate.pendingEmail = updateData.email;
    fieldsToUpdate.pendingEmailRequestedAt = new Date();

    // keep current verified email active until new one is confirmed
  }

  const updated = await userService.updateUser(userId, fieldsToUpdate);

  if (passwordChangeRequested) {
    await authService.deleteAllRefreshTokensForUser(userId);
  }

  if (emailChangeRequested) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await authService.deleteAllEmailVerificationTokensForUser(userId);

    await authService.createEmailVerificationToken(userId, {
      token: hashedToken,
      issuedAt: new Date(),
      expiresAt,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || null,
    });

    const verificationUrl = `${FRONTEND_BASE_URL}/verify-email/${rawToken}`;

    await emailService.sendVerificationEmail(
      updateData.email,
      verificationUrl,
      updated.preferredLanguage || "EN",
    );

    return successResponse(
      res,
      200,
      "Profile updated. Verify your new email to complete the email change.",
      toClientUser(updated),
      1,
    );
  }

  return successResponse(res, 200, "User updated successfully", toClientUser(updated), 1);
}

async function deleteUser(req, res, next) {
  const userId = Number(req.params?.id);

  if (isNaN(userId)) {
    return next(new CustomError(400, "Invalid user id given"));
  }

  const targetUser = await userService.getUserById(userId);

  if (!targetUser) {
    return next(new CustomError(404, "User not found"));
  }

  const deletedUser = await userService.deleteUser(userId);

  await logService.createAuditLog({
    actorUserId: req.user?.id ?? null,
    targetUserId: targetUser.id,
    action: "USER_DEACTIVATED",
    entityType: "User",
    entityId: String(targetUser.id),
    summary: `User ${targetUser.username} was deactivated`,
    diff: {
      before: {
        active: true,
        deletedAt: targetUser.deletedAt,
      },
      after: {
        active: false,
        deletedAt: deletedUser.deletedAt?.toISOString?.() ?? deletedUser.deletedAt,
      },
    },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] || null,
  });

  return successResponse(
    res,
    200,
    "User deactivated successfully",
    {
      ...toClientUser(deletedUser),
      active: deletedUser.active,
      deletedAt: deletedUser.deletedAt,
    },
    1,
  );
}

async function reactivateUser(req, res, next) {
  const userId = Number(req.params?.id);

  if (isNaN(userId)) {
    return next(new CustomError(400, "Invalid user id given"));
  }

  await userService.getUserByIdIncludingInactive(userId);

  const updatedUser = await userService.reactivateUser(userId);

  if (!updatedUser) {
    return next(new CustomError(404, "User not found"));
  }

  await logService.createAuditLog({
    actorUserId: req.user?.id ?? null,
    targetUserId: updatedUser.id,
    action: "USER_REACTIVATED",
    entityType: "User",
    entityId: String(updatedUser.id),
    summary: `User ${updatedUser.username} was reactivated`,
    diff: {
      before: { active: false },
      after: { active: true },
    },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] || null,
  });

  return successResponse(
    res,
    200,
    "User reactivated successfully",
    {
      ...toClientUser(updatedUser),
      active: updatedUser.active,
      deletedAt: updatedUser.deletedAt,
    },
    1,
  );
}

async function resendEmailChangeVerification(req, res, next) {
  const userId = Number(req.user?.id);
  if (isNaN(userId)) {
    return next(new CustomError(401, "Unauthorized"));
  }

  const user = await userService.getUserById(userId);
  if (!user) {
    return next(new CustomError(404, "User not found"));
  }

  if (!user.active) {
    return next(new CustomError(403, "User is inactive", null, "USER_INACTIVE"));
  }

  if (!user.pendingEmail) {
    return next(new CustomError(400, "No pending email change found", null, "NO_PENDING_EMAIL_CHANGE"));
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await authService.deleteAllEmailVerificationTokensForUser(userId);

  await authService.createEmailVerificationToken(userId, {
    token: hashedToken,
    issuedAt: new Date(),
    expiresAt,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] || null,
  });

  const verificationUrl = `${FRONTEND_BASE_URL}/verify-email/${rawToken}`;

  await emailService.sendVerificationEmail(
    user.pendingEmail,
    verificationUrl,
    user.preferredLanguage || "EN",
  );

  return successResponse(res, 200, "Email change verification email sent", {
    pendingEmail: user.pendingEmail,
  });
}

export default {
  getMe,
  getUserByNameOrEmail,
  updateUserProfile,
  deleteUser,
  reactivateUser,
  resendEmailChangeVerification,
};
