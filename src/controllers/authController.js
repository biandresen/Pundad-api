import { matchedData } from "express-validator";
import jwt from "jsonwebtoken";
import crypto from "crypto";

import { hashPassword, matchPassword } from "../utils/passwordCrypt.js";
import userService from "../services/userService.js";
import CustomError from "../utils/CustomError.js";
import authService from "../services/authService.js";
import successResponse from "../utils/successResponse.js";
import createTokenData from "../utils/createTokenData.js";
import REFRESH_TOKEN_COOKIE_SETTINGS from "../utils/refreshTokenCookieSettings.js";
import CLEAR_COOKIE_SETTINGS from "../utils/clearCookieSettings.js";
import emailService from "../services/emailService.js";
import { toClientUser } from "../utils/toClientUser.js";
import { LEGAL_VERSIONS } from "../constants.js";
import { moderateFields } from "../utils/moderation.js";
import sendEmailVerificationFlow from "../utils/sendEmailVerificationFlow.js";
import createTokens from "../utils/createTokens.js";
import logService from "../services/logService.js";
import { getModerationLogData } from "../utils/moderationLogData.js";

async function health(req, res, next) {
  successResponse(res, 200, "Health is ok");
}

async function readiness(req, res) {
  try {
    await authService.checkDatabaseConnection();
    return successResponse(res, 200, "Service is ready");
  } catch {
    return res.status(503).json({ status: "error", statusCode: 503, message: "Service is not ready" });
  }
}

async function registerUser(req, res, next) {
  const { username, email, password, acceptedTerms } = matchedData(req);

  if (!acceptedTerms) {
    return next(new CustomError(400, "You must accept the Terms and Rules"));
  }

  const moderation = moderateFields({
    username: username?.trim(),
  });

  if (moderation.blocked) {
    const { matchedTerms, matchedVariants } = getModerationLogData(moderation);

    await logService.createModerationEvent({
      userId: Number(req.user?.id) || null,
      action: "register_username",
      blocked: true,
      fieldNames: ["username"],
      matchedTerms,
      matchedVariants,
      contentPreview: username?.trim()?.slice(0, 160) || null,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || null,
    });

    return next(
      new CustomError(400, "Username contains blocked language", [
        { field: "username", message: "Contains inappropriate language" },
      ]),
    );
  }

  const normalizedUsername = username.trim();
  const normalizedEmail = email.trim().toLowerCase();
  const hashedPassword = await hashPassword(password);

  const newUser = await userService.createUser(normalizedUsername, normalizedEmail, hashedPassword, {
    termsAcceptedAt: new Date(),
    termsVersion: LEGAL_VERSIONS.TERMS,
    emailVerified: false,
  });

  await sendEmailVerificationFlow(newUser, req);

  await logService.createProductEvent({
    userId: newUser.id,
    type: "REGISTER_SUCCESS",
    path: req.originalUrl,
    language: newUser.preferredLanguage,
    metadata: {
      emailVerified: newUser.emailVerified,
    },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] || null,
  });

  return successResponse(res, 201, "User created successfully. Please verify your email.", {
    needsEmailVerification: true,
    email: newUser.email,
  });
}

async function loginUser(req, res, next) {
  const { userInput, password } = matchedData(req);

  const normalizedUserInput = userInput.trim().toLowerCase();

  let user;
  if (normalizedUserInput.includes("@")) {
    user = await userService.getUserByEmail(normalizedUserInput);
  } else {
    user = await userService.getUserByUsername(normalizedUserInput);
  }

  if (!user) return next(new CustomError(401, "Invalid credentials"));

  if (!user.active) return next(new CustomError(403, "User is inactive", null, "USER_INACTIVE"));

  if (!user.emailVerified) {
    return next(
      new CustomError(
        403,
        "Account is not verified through email yet",
        [{ field: "email", message: "Email not verified" }],
        "EMAIL_NOT_VERIFIED",
      ),
    );
  }

  const isMatch = await matchPassword(password, user.password);
  if (!isMatch) return next(new CustomError(401, "Invalid credentials"));

  const { accessToken, refreshToken } = createTokens(user);

  const tokenData = createTokenData(req, refreshToken);

  await authService.storeRefreshToken(user.id, tokenData);

  res.cookie("refreshToken", refreshToken, REFRESH_TOKEN_COOKIE_SETTINGS);

  const language = req.language;
  const fullUser = await userService.getUserById(user.id, { language });

  if (!fullUser) return next(new CustomError(404, "User not found"));

  const clientUser = toClientUser(fullUser);

  await logService.createProductEvent({
    userId: user.id,
    type: "LOGIN_SUCCESS",
    path: req.originalUrl,
    language: fullUser.preferredLanguage,
    metadata: null,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] || null,
  });

  successResponse(res, 200, "Login successful", {
    accessToken,
    user: clientUser,
  });
}

async function logoutUser(req, res, next) {
  const token = req.cookies?.refreshToken;

  if (token) {
    const decodedUser = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    if (!decodedUser) return next(new CustomError(400, "Invalid refresh token. Please login"));
    await authService.deleteRefreshToken(decodedUser.id, token);
  }

  res.clearCookie("refreshToken", CLEAR_COOKIE_SETTINGS);

  successResponse(res, 200, "Logged out successfully");
}

async function refreshAccessToken(req, res, next) {
  const token = req.cookies?.refreshToken;
  if (!token) return next(new CustomError(400, "No refresh token. Please login"));

  const decodedUser = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  if (!decodedUser) return next(new CustomError(400, "Invalid refresh token. Please login"));

  const isValid = await authService.getRefreshToken(decodedUser.id, token);
  if (!isValid) return next(new CustomError(400, "Invalid refresh token. Please login"));

  const user = await userService.getUserById(decodedUser.id);
  if (!user) return next(new CustomError(404, "User not found"));
  if (!user.active) return next(new CustomError(403, "User is inactive", null, "USER_INACTIVE"));
  if (!user.emailVerified) {
    return next(
      new CustomError(403, "Account is not verified through email yet", null, "EMAIL_NOT_VERIFIED"),
    );
  }

  const { accessToken, refreshToken } = createTokens(user);

  const tokenData = createTokenData(req, refreshToken);

  await authService.storeRefreshToken(user.id, tokenData);

  res.cookie("refreshToken", refreshToken, REFRESH_TOKEN_COOKIE_SETTINGS);

  successResponse(res, 200, "New access token provided", accessToken);
}

async function resetPassword(req, res, next) {
  const { email } = matchedData(req);
  const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "https://pundad.app";

  const normalizedEmail = email.trim().toLowerCase();
  const user = await userService.getUserByEmail(normalizedEmail);

  if (!user) return next(new CustomError(404, "User not found"));
  if (!user.active) return next(new CustomError(403, "User is inactive"));

  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

  const issuedAt = new Date();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await authService.storeResetPasswordToken(user.id, {
    token: hashedToken,
    issuedAt,
    expiresAt,
    userAgent: req.headers["user-agent"] || null,
    ipAddress: req.ip,
  });

  const resetUrl = `${FRONTEND_BASE_URL}/reset-password/${rawToken}`;

  await emailService.sendResetPasswordEmail(user.email, resetUrl, req.language);

  return successResponse(res, 200, "Reset password email sent", email);
}

async function processResetPassword(req, res, next) {
  const { token } = req.body;
  const { password } = matchedData(req);

  if (!token) return next(new CustomError(400, "Invalid token"));

  const hashedPassword = await hashPassword(password);
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const record = await authService.getRecordFromResetPasswordToken(hashedToken);
  if (!record) return next(new CustomError(400, "Invalid or expired token"));

  const user = await userService.getUserById(record.userId);
  if (!user) return next(new CustomError(404, "User not found"));

  if (record.expiresAt < new Date()) return next(new CustomError(400, "Token expired"));

  await userService.updateUser(record.userId, { password: hashedPassword });
  await authService.deleteResetPasswordToken(record.id);

  return successResponse(res, 200, "Password updated");
}

async function verifyEmail(req, res, next) {
  const { token } = req.query;

  if (!token || typeof token !== "string") {
    return next(new CustomError(400, "Invalid token"));
  }

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const record = await authService.getRecordFromEmailVerificationToken(hashedToken);
  if (!record) {
    return next(new CustomError(400, "Invalid or expired token", null, "INVALID_VERIFICATION_TOKEN"));
  }

  if (record.expiresAt < new Date()) {
    return next(new CustomError(400, "Token expired", null, "EXPIRED_VERIFICATION_TOKEN"));
  }

  const user = await userService.getUserById(record.userId);
  if (!user) return next(new CustomError(404, "User not found"));

  if (!user.active) {
    return next(new CustomError(403, "User is inactive", null, "USER_INACTIVE"));
  }

  const isPendingEmailChange = typeof user.pendingEmail === "string" && user.pendingEmail.trim().length > 0;

  if (isPendingEmailChange) {
    await userService.updateUser(user.id, {
      email: user.pendingEmail.trim().toLowerCase(),
      pendingEmail: null,
      pendingEmailRequestedAt: null,
      emailVerified: true,
      emailVerifiedAt: new Date(),
    });
  } else if (!user.emailVerified) {
    await userService.updateUser(user.id, {
      emailVerified: true,
      emailVerifiedAt: new Date(),
    });
  }

  await authService.deleteEmailVerificationToken(record.id);
  await authService.deleteAllEmailVerificationTokensForUser(user.id);

  await logService.createProductEvent({
    userId: user.id,
    type: "EMAIL_VERIFIED",
    path: req.originalUrl,
    language: user.preferredLanguage,
    metadata: {
      verifiedPendingEmailChange: isPendingEmailChange,
    },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] || null,
  });

  return successResponse(
    res,
    200,
    isPendingEmailChange ? "Email change verified successfully" : "Email verified successfully",
  );
}

async function resendVerificationEmail(req, res, next) {
  const { email } = matchedData(req);
  const normalizedEmail = email.trim().toLowerCase();

  const user = await userService.getUserByEmail(normalizedEmail);
  if (!user) return next(new CustomError(404, "User not found"));

  if (!user.active) return next(new CustomError(403, "User is inactive", null, "USER_INACTIVE"));

  if (user.emailVerified) {
    return next(new CustomError(400, "Email is already verified", null, "EMAIL_ALREADY_VERIFIED"));
  }

  await sendEmailVerificationFlow(user, req);

  return successResponse(res, 200, "Verification email sent", {
    email: user.email,
  });
}

export default {
  health,
  readiness,
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  resetPassword,
  processResetPassword,
  verifyEmail,
  resendVerificationEmail,
};
