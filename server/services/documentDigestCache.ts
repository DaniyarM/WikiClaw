import { createHash } from "node:crypto";
import path from "node:path";
import type { AppSettings } from "../../shared/contracts.js";
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from "../lib/fs.js";
import { WIKI_INTERNAL_DIRNAME, resolveInside } from "../lib/paths.js";
import type { AttachmentDocument } from "./wikiManager.js";
import type { DocumentKind } from "./documentIntelligence.js";

const DIGEST_CACHE_VERSION = 1;
const DIGEST_CACHE_DIRNAME = "attachment-digests";

export interface CachedChunkDigest {
  label: string;
  summary: string;
  keyPoints: string[];
  entities: string[];
  relationships: string[];
  missingContext: string[];
}

export interface CachedAttachmentDigest {
  inferredKind: DocumentKind;
  title: string;
  summary: string;
  keyTopics: string[];
  entities: string[];
  relationships: string[];
  highlights: string[];
  missingContext: string[];
  chunkDigests: CachedChunkDigest[];
}

interface PersistedAttachmentDigestRecord {
  version: number;
  key: string;
  savedAt: string;
  name: string;
  mimeType: string;
  size: number;
  digest: CachedAttachmentDigest;
}

function cacheRoot(settings: AppSettings): string {
  return resolveInside(settings.wikiPath, `${WIKI_INTERNAL_DIRNAME}/${DIGEST_CACHE_DIRNAME}`);
}

function cacheFilePath(settings: AppSettings, key: string): string {
  return path.join(cacheRoot(settings), `${key}.json`);
}

export function buildAttachmentDigestCacheKey(
  attachment: Pick<AttachmentDocument, "mimeType" | "extractedText">,
): string {
  return createHash("sha256")
    .update(`wikiclaw-digest-v${DIGEST_CACHE_VERSION}`)
    .update("\0")
    .update(attachment.mimeType || "application/octet-stream")
    .update("\0")
    .update(attachment.extractedText)
    .digest("hex")
    .slice(0, 40);
}

function sanitizeCachedDigest(input: CachedAttachmentDigest | null | undefined): CachedAttachmentDigest | null {
  if (!input) {
    return null;
  }

  const inferredKind =
    input.inferredKind === "code" ||
    input.inferredKind === "article" ||
    input.inferredKind === "notes" ||
    input.inferredKind === "mixed"
      ? input.inferredKind
      : "mixed";

  const normalizeStrings = (value: unknown, limit: number): string[] =>
    Array.isArray(value)
      ? value
          .map((item) => `${item ?? ""}`.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .slice(0, limit)
      : [];

  const chunkDigests = Array.isArray(input.chunkDigests)
    ? input.chunkDigests
        .map((chunk) => ({
          label: `${chunk?.label ?? ""}`.trim(),
          summary: `${chunk?.summary ?? ""}`.trim(),
          keyPoints: normalizeStrings(chunk?.keyPoints, 8),
          entities: normalizeStrings(chunk?.entities, 12),
          relationships: normalizeStrings(chunk?.relationships, 10),
          missingContext: normalizeStrings(chunk?.missingContext, 8),
        }))
        .filter((chunk) => chunk.label || chunk.summary)
    : [];

  const digest: CachedAttachmentDigest = {
    inferredKind,
    title: `${input.title ?? ""}`.trim(),
    summary: `${input.summary ?? ""}`.trim(),
    keyTopics: normalizeStrings(input.keyTopics, 16),
    entities: normalizeStrings(input.entities, 18),
    relationships: normalizeStrings(input.relationships, 16),
    highlights: normalizeStrings(input.highlights, 16),
    missingContext: normalizeStrings(input.missingContext, 12),
    chunkDigests,
  };

  if (!digest.title || !digest.summary || chunkDigests.length === 0) {
    return null;
  }

  return digest;
}

export async function loadAttachmentDigestCache(
  settings: AppSettings,
  attachment: Pick<AttachmentDocument, "mimeType" | "extractedText">,
): Promise<{ key: string; digest: CachedAttachmentDigest } | null> {
  const key = buildAttachmentDigestCacheKey(attachment);
  const targetPath = cacheFilePath(settings, key);
  if (!(await pathExists(targetPath))) {
    return null;
  }

  const record = await readJsonFile<PersistedAttachmentDigestRecord | null>(targetPath, null);
  if (!record || record.version !== DIGEST_CACHE_VERSION || record.key !== key) {
    return null;
  }

  const digest = sanitizeCachedDigest(record.digest);
  if (!digest) {
    return null;
  }

  return { key, digest };
}

export async function saveAttachmentDigestCache(
  settings: AppSettings,
  attachment: Pick<AttachmentDocument, "name" | "mimeType" | "size" | "extractedText">,
  digest: CachedAttachmentDigest,
): Promise<void> {
  const normalized = sanitizeCachedDigest(digest);
  if (!normalized) {
    return;
  }

  const key = buildAttachmentDigestCacheKey(attachment);
  const targetPath = cacheFilePath(settings, key);
  await ensureDir(cacheRoot(settings));
  await writeJsonFile(targetPath, {
    version: DIGEST_CACHE_VERSION,
    key,
    savedAt: new Date().toISOString(),
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    digest: normalized,
  } satisfies PersistedAttachmentDigestRecord);
}
