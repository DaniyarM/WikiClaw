import fs from "node:fs/promises";
import path from "node:path";
import type { AppSettings, WikiSummary } from "../../shared/contracts.js";
import { ensureDir, listFilesRecursive, pathExists, readJsonFile, writeJsonFile } from "../lib/fs.js";
import { createId } from "../lib/ids.js";
import { APP_STATE_DIR, MANAGED_WIKIS_DIR, ROOT_DIR, WIKI_LIBRARY_FILE } from "../lib/paths.js";
import { ensureWikiScaffold } from "./wikiManager.js";

interface StoredWikiRecord {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  managed: boolean;
}

interface WikiLibraryState {
  entries: StoredWikiRecord[];
  activeEntry: StoredWikiRecord;
  activeWikiId: string;
  summaries: WikiSummary[];
}

function normalizePathKey(targetPath: string): string {
  return path.resolve(targetPath).replace(/\\/g, "/").toLowerCase();
}

function slugifyName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function titleCase(input: string): string {
  return input
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function deriveWikiName(wikiPath: string): string {
  const baseName = path.basename(path.resolve(wikiPath)).trim();
  return titleCase(baseName) || "Wiki";
}

function isManagedPath(wikiPath: string): boolean {
  const resolved = path.resolve(wikiPath);
  const managedRoot = path.resolve(MANAGED_WIKIS_DIR);
  return resolved.startsWith(`${managedRoot}${path.sep}`);
}

function isSafeDeleteTarget(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const driveRoot = path.parse(resolved).root;
  const workspaceRoot = path.resolve(ROOT_DIR);
  const appStateRoot = path.resolve(APP_STATE_DIR);
  const withSep = (value: string) => (value.endsWith(path.sep) ? value : `${value}${path.sep}`);

  if (resolved === driveRoot) {
    return false;
  }

  if (resolved === workspaceRoot || resolved === appStateRoot) {
    return false;
  }

  if (withSep(workspaceRoot).startsWith(withSep(resolved))) {
    return false;
  }

  if (withSep(appStateRoot).startsWith(withSep(resolved))) {
    return false;
  }

  return true;
}

async function countWikiPages(wikiPath: string): Promise<number> {
  const pagesPath = path.join(wikiPath, "pages");
  if (!(await pathExists(pagesPath))) {
    return 0;
  }

  const files = await listFilesRecursive(pagesPath);
  return files.filter((filePath) => filePath.toLowerCase().endsWith(".md")).length;
}

async function readWikiLibrary(): Promise<StoredWikiRecord[]> {
  await ensureDir(APP_STATE_DIR);
  return readJsonFile<StoredWikiRecord[]>(WIKI_LIBRARY_FILE, []);
}

async function writeWikiLibrary(entries: StoredWikiRecord[]): Promise<void> {
  await ensureDir(APP_STATE_DIR);
  await writeJsonFile(WIKI_LIBRARY_FILE, entries);
}

async function toWikiSummary(entry: StoredWikiRecord): Promise<WikiSummary> {
  return {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    pageCount: await countWikiPages(entry.path),
    managed: entry.managed,
    canDelete: isSafeDeleteTarget(entry.path),
  };
}

async function buildLibraryState(entries: StoredWikiRecord[], activeWikiId: string): Promise<WikiLibraryState> {
  const activeEntry = entries.find((entry) => entry.id === activeWikiId) ?? entries[0];
  if (!activeEntry) {
    throw new Error("Wiki library is empty");
  }

  const activePathKey = normalizePathKey(activeEntry.path);
  const ordered = [...entries].sort((left, right) => {
    const leftIsActive = normalizePathKey(left.path) === activePathKey;
    const rightIsActive = normalizePathKey(right.path) === activePathKey;
    if (leftIsActive !== rightIsActive) {
      return leftIsActive ? -1 : 1;
    }

    return right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name);
  });

  return {
    entries: ordered,
    activeEntry,
    activeWikiId: activeEntry.id,
    summaries: await Promise.all(ordered.map(toWikiSummary)),
  };
}

function uniqueWikiPath(basePath: string, existingEntries: StoredWikiRecord[]): string {
  const existing = new Set(existingEntries.map((entry) => normalizePathKey(entry.path)));
  let attempt = 1;
  let candidate = basePath;

  while (existing.has(normalizePathKey(candidate))) {
    attempt += 1;
    candidate = `${basePath}-${attempt}`;
  }

  return candidate;
}

export async function syncWikiLibrary(settings: AppSettings): Promise<WikiLibraryState> {
  await ensureDir(APP_STATE_DIR);
  await ensureDir(MANAGED_WIKIS_DIR);

  const currentPath = path.resolve(settings.wikiPath);
  const currentKey = normalizePathKey(currentPath);
  const library = await readWikiLibrary();
  const now = new Date().toISOString();
  const nextEntries = [...library];
  let activeEntry = nextEntries.find((entry) => normalizePathKey(entry.path) === currentKey);

  if (!activeEntry) {
    activeEntry = {
      id: createId("wiki_"),
      name: deriveWikiName(currentPath),
      path: currentPath,
      createdAt: now,
      updatedAt: now,
      managed: isManagedPath(currentPath),
    };
    nextEntries.push(activeEntry);
  } else if (activeEntry.path !== currentPath) {
    activeEntry.path = currentPath;
    activeEntry.updatedAt = now;
  }

  await writeWikiLibrary(nextEntries);
  return buildLibraryState(nextEntries, activeEntry.id);
}

export async function createManagedWiki(name: string, settings: AppSettings): Promise<StoredWikiRecord> {
  await ensureDir(MANAGED_WIKIS_DIR);
  const trimmedName = name.replace(/\s+/g, " ").trim().slice(0, 120) || "Wiki";
  const existingEntries = await readWikiLibrary();
  const baseName = slugifyName(trimmedName) || "wiki";
  const targetPath = uniqueWikiPath(path.join(MANAGED_WIKIS_DIR, baseName), existingEntries);
  const now = new Date().toISOString();

  await ensureWikiScaffold({ ...settings, wikiPath: targetPath });

  const entry: StoredWikiRecord = {
    id: createId("wiki_"),
    name: trimmedName,
    path: targetPath,
    createdAt: now,
    updatedAt: now,
    managed: true,
  };

  await writeWikiLibrary([entry, ...existingEntries]);
  return entry;
}

export async function activateWikiEntry(wikiId: string): Promise<StoredWikiRecord> {
  const entries = await readWikiLibrary();
  const target = entries.find((entry) => entry.id === wikiId);
  if (!target) {
    throw new Error("Wiki not found");
  }

  const updatedTarget: StoredWikiRecord = {
    ...target,
    updatedAt: new Date().toISOString(),
  };

  await writeWikiLibrary(entries.map((entry) => (entry.id === wikiId ? updatedTarget : entry)));
  return updatedTarget;
}

export async function deleteWikiEntry(wikiId: string, confirmationText: string): Promise<StoredWikiRecord[]> {
  const entries = await readWikiLibrary();
  const target = entries.find((entry) => entry.id === wikiId);
  if (!target) {
    throw new Error("Wiki not found");
  }

  if (confirmationText.replace(/\s+/g, " ").trim() !== target.name) {
    throw new Error("Confirmation text does not match the wiki name");
  }

  if (!isSafeDeleteTarget(target.path)) {
    throw new Error("This wiki cannot be deleted from the interface");
  }

  if (await pathExists(target.path)) {
    const resolvedPath = path.resolve(target.path);
    if (!isSafeDeleteTarget(resolvedPath)) {
      throw new Error("Unsafe wiki path");
    }
    await fs.rm(resolvedPath, { recursive: true, force: true });
  }

  const remaining = entries.filter((entry) => entry.id !== wikiId);
  await writeWikiLibrary(remaining);
  return remaining;
}

export async function createFallbackWiki(settings: AppSettings): Promise<StoredWikiRecord> {
  return createManagedWiki("Wiki", settings);
}
