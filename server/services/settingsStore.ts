import path from "node:path";
import type { AppSettings } from "../../shared/contracts.js";
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from "../lib/fs.js";
import { APP_STATE_DIR, ROOT_DIR, SETTINGS_FILE } from "../lib/paths.js";
import { relocalizeDefaultChatTitles } from "./chatStore.js";
import { choosePreferredOllamaModel, listOllamaModels } from "./ollama.js";
import { syncWikiLibrary } from "./wikiLibrary.js";

export const DEFAULT_SETTINGS: AppSettings = {
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434",
  apiKey: "",
  model: "llama3.1:8b",
  wikiPath: path.join(ROOT_DIR, "vault"),
  language: "en",
  allowWebSearch: true,
  temperature: 0.2,
  maxContextPages: 6,
};

function sanitizeSettings(input: Partial<AppSettings>): AppSettings {
  return {
    provider: input.provider === "openai-compatible" ? "openai-compatible" : "ollama",
    baseUrl: `${input.baseUrl ?? DEFAULT_SETTINGS.baseUrl}`.trim() || DEFAULT_SETTINGS.baseUrl,
    apiKey: `${input.apiKey ?? ""}`.trim(),
    model: `${input.model ?? DEFAULT_SETTINGS.model}`.trim() || DEFAULT_SETTINGS.model,
    wikiPath: path.resolve(`${input.wikiPath ?? DEFAULT_SETTINGS.wikiPath}`),
    language: input.language === "en" ? "en" : "ru",
    allowWebSearch: input.allowWebSearch ?? DEFAULT_SETTINGS.allowWebSearch,
    temperature:
      typeof input.temperature === "number" && Number.isFinite(input.temperature)
        ? Math.max(0, Math.min(1.5, input.temperature))
        : DEFAULT_SETTINGS.temperature,
    maxContextPages:
      typeof input.maxContextPages === "number" && Number.isFinite(input.maxContextPages)
        ? Math.max(2, Math.min(12, Math.round(input.maxContextPages)))
        : DEFAULT_SETTINGS.maxContextPages,
  };
}

async function alignOllamaModel(settings: AppSettings): Promise<AppSettings> {
  if (settings.provider !== "ollama") {
    return settings;
  }

  try {
    const models = await listOllamaModels(settings.baseUrl);

    if (models.length === 0) {
      return settings;
    }

    if (models.includes(settings.model)) {
      return settings;
    }

    return {
      ...settings,
      model: choosePreferredOllamaModel(models),
    };
  } catch {
    return settings;
  }
}

export async function getSettings(): Promise<AppSettings> {
  await ensureDir(APP_STATE_DIR);

  if (!(await pathExists(SETTINGS_FILE))) {
    const initial = await alignOllamaModel(DEFAULT_SETTINGS);
    await writeJsonFile(SETTINGS_FILE, initial);
    await syncWikiLibrary(initial);
    return initial;
  }

  const stored = await readJsonFile<AppSettings>(SETTINGS_FILE, DEFAULT_SETTINGS);
  const merged = await alignOllamaModel(sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored }));

  if (JSON.stringify(stored) !== JSON.stringify(merged)) {
    await writeJsonFile(SETTINGS_FILE, merged);
  }

  await syncWikiLibrary(merged);

  return merged;
}

export async function updateSettings(nextSettings: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const merged = await alignOllamaModel(sanitizeSettings({ ...current, ...nextSettings }));
  await writeJsonFile(SETTINGS_FILE, merged);
  if (current.language !== merged.language) {
    await relocalizeDefaultChatTitles(merged.language);
  }
  await syncWikiLibrary(merged);
  return merged;
}
