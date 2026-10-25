import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));

export const integrationEnabled = Boolean(process.env.TEST_DATABASE_URL);

// Each test process gets its own migrated schema. Never infer a URL from app env files.
export async function createIntegrationDatabase(suite) {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error("Integration tests require TEST_DATABASE_URL");
  const url = new URL(raw);
  if (!["postgresql:", "postgres:"].includes(url.protocol) || !url.pathname.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL must target a PostgreSQL database ending in _test");
  }
  const name = suite.replace(/[^a-z0-9]/gi, "_").slice(0, 24);
  const schema = `test_${name}_${randomUUID().replaceAll("-", "")}`;
  const admin = new PrismaClient({ datasources: { db: { url: raw } } });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set("schema", schema);
  process.env.DATABASE_URL = url.toString();
  let prisma;
  const close = async () => {
    try {
      await prisma?.$disconnect();
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await admin.$disconnect();
    }
  };
  try {
    await execute(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url.toString() },
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    return { prisma, close };
  } catch (error) {
    await close();
    throw error;
  }
}
