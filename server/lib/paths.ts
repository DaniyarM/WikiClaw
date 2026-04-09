import path from "node:path";

export const ROOT_DIR = process.cwd();
export const APP_STATE_DIR = path.join(ROOT_DIR, ".wikiclaw");
export const CHATS_DIR = path.join(APP_STATE_DIR, "chats");
export const SETTINGS_FILE = path.join(APP_STATE_DIR, "settings.json");
export const TEMP_UPLOAD_DIR = path.join(APP_STATE_DIR, "uploads");
export const WIKI_LIBRARY_FILE = path.join(APP_STATE_DIR, "wikis.json");
export const MANAGED_WIKIS_DIR = path.join(ROOT_DIR, "wikis");

export const WIKI_INTERNAL_DIRNAME = ".wikiclaw";
export const WIKI_INDEX_FILE = "index.md";
export const WIKI_LOG_FILE = "log.md";
export const WIKI_SCHEMA_FILE = "AGENTS.md";

export function resolveInside(basePath: string, relativePath: string): string {
  const resolved = path.resolve(basePath, relativePath);

  if (!resolved.startsWith(path.resolve(basePath))) {
    throw new Error(`Path escapes base directory: ${relativePath}`);
  }

  return resolved;
}
