import prisma from "../config/prismaClient.js";

async function storeResetPasswordToken(userId, { token, issuedAt, expiresAt, userAgent, ipAddress }) {
  await prisma.resetPasswordToken.deleteMany({
    where: {
      userId,
      userAgent,
    },
  });

  const tokens = await prisma.resetPasswordToken.findMany({
    where: { userId },
    orderBy: { issuedAt: "asc" },
  });

  if (tokens.length >= 5) {
    await prisma.resetPasswordToken.delete({
      where: { id: tokens[0].id },
    });
  }

  return prisma.resetPasswordToken.create({
    data: {
      userId,
      token,
      issuedAt,
      expiresAt,
      userAgent,
      ipAddress,
    },
  });
}

async function getRecordFromResetPasswordToken(token) {
  return prisma.resetPasswordToken.findFirst({
    where: { token },
  });
}

async function deleteResetPasswordToken(id) {
  return prisma.resetPasswordToken.delete({
    where: { id },
  });
}

async function storeRefreshToken(userId, { token, issuedAt, expiresAt, userAgent, ipAddress }) {
  await prisma.refreshToken.deleteMany({
    where: {
      userId,
      userAgent,
    },
  });

  const tokens = await prisma.refreshToken.findMany({
    where: { userId },
    orderBy: { issuedAt: "asc" },
  });

  if (tokens.length >= 5) {
    await prisma.refreshToken.delete({
      where: { id: tokens[0].id },
    });
  }

  return prisma.refreshToken.create({
    data: {
      userId,
      token,
      issuedAt,
      expiresAt,
      userAgent,
      ipAddress,
    },
  });
}

async function deleteRefreshToken(userId, token) {
  return prisma.refreshToken.deleteMany({
    where: { userId, token },
  });
}

async function getRefreshToken(userId, token) {
  return prisma.refreshToken.findFirst({
    where: { userId, token },
  });
}

async function storeEmailVerificationToken(userId, { token, issuedAt, expiresAt, userAgent, ipAddress }) {
  await prisma.emailVerificationToken.deleteMany({
    where: {
      userId,
      userAgent,
    },
  });

  const tokens = await prisma.emailVerificationToken.findMany({
    where: { userId },
    orderBy: { issuedAt: "asc" },
  });

  if (tokens.length >= 5) {
    await prisma.emailVerificationToken.delete({
      where: { id: tokens[0].id },
    });
  }

  return prisma.emailVerificationToken.create({
    data: {
      userId,
      token,
      issuedAt,
      expiresAt,
      userAgent,
      ipAddress,
    },
  });
}

async function getRecordFromEmailVerificationToken(token) {
  return prisma.emailVerificationToken.findFirst({
    where: { token },
  });
}

async function deleteEmailVerificationToken(id) {
  return prisma.emailVerificationToken.delete({
    where: { id },
  });
}

async function deleteAllEmailVerificationTokensForUser(userId) {
  return prisma.emailVerificationToken.deleteMany({
    where: { userId },
  });
}

async function deleteAllRefreshTokensForUser(userId) {
  return prisma.refreshToken.deleteMany({
    where: { userId },
  });
}

async function createEmailVerificationToken(userId, tokenData) {
  return prisma.emailVerificationToken.create({
    data: {
      userId,
      token: tokenData.token,
      issuedAt: tokenData.issuedAt,
      expiresAt: tokenData.expiresAt,
      ipAddress: tokenData.ipAddress ?? null,
      userAgent: tokenData.userAgent ?? null,
    },
  });
}

export default {
  storeRefreshToken,
  deleteRefreshToken,
  getRefreshToken,
  storeResetPasswordToken,
  getRecordFromResetPasswordToken,
  deleteResetPasswordToken,
  storeEmailVerificationToken,
  getRecordFromEmailVerificationToken,
  deleteEmailVerificationToken,
  deleteAllEmailVerificationTokensForUser,
  deleteAllRefreshTokensForUser,
  createEmailVerificationToken,
};
