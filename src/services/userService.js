import prisma from "../config/prismaClient.js";
import { normalizeLanguage } from "../utils/language.js";
import { activeCurrentBadgeWhere } from "../utils/activeBadges.js";

async function getUserById(id, { language } = {}) {
  const lang = normalizeLanguage(language);

  return prisma.user.findFirst({
    where: { id, active: true },
    include: {
      currentBadges: {
        where: activeCurrentBadgeWhere(lang),
        select: { id: true, badge: true, since: true, validTo: true, context: true, language: true },
      },
    },
  });
}

async function getUserByIdIncludingInactive(id) {
  return prisma.user.findUnique({
    where: { id },
  });
}

async function getUserByUsername(username) {
  return prisma.user.findFirst({
    where: {
      username: { equals: username, mode: "insensitive" },
    },
  });
}

async function getUserByEmail(email) {
  return prisma.user.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
    },
  });
}

async function createUser(username, email, password, meta = {}) {
  return prisma.user.create({
    data: {
      username,
      email,
      password,
      termsAcceptedAt: meta.termsAcceptedAt ?? null,
      termsVersion: meta.termsVersion ?? null,
      ...meta,
    },
  });
}

async function updateUser(userId, updateData = {}) {
  const fieldsToUpdate = {};

  if (updateData.username !== undefined) fieldsToUpdate.username = updateData.username;
  if (updateData.email !== undefined) fieldsToUpdate.email = updateData.email;
  if (updateData.pendingEmail !== undefined) fieldsToUpdate.pendingEmail = updateData.pendingEmail;
  if (updateData.pendingEmailRequestedAt !== undefined) {
    fieldsToUpdate.pendingEmailRequestedAt = updateData.pendingEmailRequestedAt;
  }
  if (updateData.password !== undefined) fieldsToUpdate.password = updateData.password;
  if (updateData.avatar !== undefined) fieldsToUpdate.avatar = updateData.avatar;

  if (updateData.preferredLanguage !== undefined) {
    fieldsToUpdate.preferredLanguage = updateData.preferredLanguage;
  }

  if (updateData.emailVerified !== undefined) {
    fieldsToUpdate.emailVerified = updateData.emailVerified;
  }

  if (updateData.emailVerifiedAt !== undefined) {
    fieldsToUpdate.emailVerifiedAt = updateData.emailVerifiedAt;
  }

  if (updateData.active !== undefined) {
    fieldsToUpdate.active = updateData.active;
  }

  if (updateData.deletedAt !== undefined) {
    fieldsToUpdate.deletedAt = updateData.deletedAt;
  }

  if (updateData.dailyJokeStreak !== undefined) fieldsToUpdate.dailyJokeStreak = updateData.dailyJokeStreak;
  if (updateData.dailyJokeBestStreak !== undefined)
    fieldsToUpdate.dailyJokeBestStreak = updateData.dailyJokeBestStreak;
  if (updateData.dailyJokeLastViewedAt !== undefined)
    fieldsToUpdate.dailyJokeLastViewedAt = updateData.dailyJokeLastViewedAt;

  return prisma.user.update({
    where: { id: userId },
    data: fieldsToUpdate,
  });
}

async function changeRole(userId, role) {
  return prisma.user.update({
    where: { id: userId },
    data: role,
  });
}

async function deleteUser(userId) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      deletedAt: new Date(),
      active: false,
    },
  });
}

async function reactivateUser(userId) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      deletedAt: null,
      active: true,
    },
  });
}

async function getUserByIdWithPassword(userId) {
  return prisma.user.findUnique({
    where: { id: userId },
  });
}

async function getUserByPendingEmail(email) {
  return prisma.user.findFirst({
    where: {
      pendingEmail: { equals: email, mode: "insensitive" },
    },
  });
}

async function findUserByEmailOrPendingEmailExcludingId(email, excludedUserId) {
  return prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: email, mode: "insensitive" } },
        { pendingEmail: { equals: email, mode: "insensitive" } },
      ],
      NOT: { id: excludedUserId },
    },
    select: { id: true },
  });
}

export default {
  getUserById,
  getUserByIdIncludingInactive,
  getUserByUsername,
  getUserByEmail,
  createUser,
  updateUser,
  changeRole,
  deleteUser,
  reactivateUser,
  getUserByIdWithPassword,
  getUserByPendingEmail,
  findUserByEmailOrPendingEmailExcludingId,
};
