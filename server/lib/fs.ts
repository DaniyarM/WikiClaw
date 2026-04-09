import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(targetPath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(targetPath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, JSON.stringify(value, null, 2), "utf8");
}

export async function writeTextFile(targetPath: string, value: string): Promise<void> {
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, value, "utf8");
}

export async function readTextFile(targetPath: string, fallback = ""): Promise<string> {
  try {
    return await fs.readFile(targetPath, "utf8");
  } catch {
    return fallback;
  }
}

export async function listFilesRecursive(basePath: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(basePath, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const fullPath = path.join(basePath, entry.name);

    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursive(fullPath)));
    } else {
      results.push(fullPath);
    }
  }

  return results;
}
