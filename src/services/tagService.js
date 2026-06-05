import prisma from "../config/prismaClient.js";
import { normalizeLanguage } from "../utils/language.js";

function normalizeTagName(name) {
  return name
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function getAllTags({
  language,
  page = 1,
  limit = 20,
  sort = "asc",
  sortType = "name",
} = {}) {
  const lang = normalizeLanguage(language);

  const parsedPage = Math.max(1, parseInt(page) || 1);
  const parsedLimit = Math.max(1, parseInt(limit) || 20);
  const skip = (parsedPage - 1) * parsedLimit;

  // Only allow sorting by fields that actually exist
  const validSortFields = ["name", "createdAt", "updatedAt"];
  const sortField = validSortFields.includes(sortType) ? sortType : "name";
  const order = sort.toLowerCase() === "desc" ? "desc" : "asc";

  const [items, total] = await Promise.all([
    prisma.tag.findMany({
      where: { language: lang },
      skip,
      take: parsedLimit,
      orderBy: { [sortField]: order },
    }),
    prisma.tag.count({ where: { language: lang } }),
  ]);

  return { items, total, page: parsedPage, limit: parsedLimit, language: lang };
}

/**
 * If you want strict "no mixing", be careful with lookups by id.
 * IDs are global. So ensure the found tag matches the current language.
 */
async function getTagById(tagId, { language } = {}) {
  const lang = normalizeLanguage(language);

  return prisma.tag.findFirst({
    where: { id: tagId, language: lang },
  });
}

async function getTagByName(tagName, { language } = {}) {
  const lang = normalizeLanguage(language);
  const name = normalizeTagName(tagName);

  return prisma.tag.findUnique({
    where: {
      // requires @@unique([language, name]) in schema
      language_name: { language: lang, name },
    },
  });
}

async function createTag(tagName, { language } = {}) {
  const lang = normalizeLanguage(language);
  const name = normalizeTagName(tagName);

  return prisma.tag.create({
    data: { language: lang, name },
  });
}

async function updateTag(tagId, tagName, { language } = {}) {
  const lang = normalizeLanguage(language);
  const name = normalizeTagName(tagName);

  // Use updateMany so language is part of WHERE.
  const res = await prisma.tag.updateMany({
    where: { id: tagId, language: lang },
    data: { name },
  });

  if (res.count === 0) return null;

  return prisma.tag.findFirst({ where: { id: tagId, language: lang } });
}

async function deleteTag(tagId, { language } = {}) {
  const lang = normalizeLanguage(language);

  // deleteMany prevents cross-language deletion by id
  const res = await prisma.tag.deleteMany({
    where: { id: tagId, language: lang },
  });

  return res.count > 0;
}

/**
 * Popular tags must be per language, and you probably only want tags used by
 * published jokes in that language, otherwise drafts skew it.
 */
async function getPopularTags({ language, limit = 10, publishedOnly = true } = {}) {
  const lang = normalizeLanguage(language);
  const take = Math.max(1, parseInt(limit) || 10);

  return prisma.tag.findMany({
    where: {
      language: lang,
      ...(publishedOnly
        ? {
            jokes: {
              some: { published: true, language: lang },
            },
          }
        : {}),
    },
    orderBy: {
      jokes: {
        _count: "desc",
      },
    },
    take,
    include: {
      _count: {
        select: { jokes: true },
      },
    },
  });
}

export default {
  getAllTags,
  getTagById,
  getTagByName,
  createTag,
  updateTag,
  deleteTag,
  getPopularTags,
};