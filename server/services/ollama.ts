export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const normalized = baseUrl.replace(/\/+$/g, "");
  const response = await fetch(`${normalized}/api/tags`);

  if (!response.ok) {
    throw new Error(`Ollama tags request failed with ${response.status}`);
  }

  const payload = (await response.json()) as {
    models?: Array<{ name?: string }>;
  };

  return (payload.models ?? [])
    .map((model) => model.name?.trim())
    .filter((name): name is string => Boolean(name));
}

export function choosePreferredOllamaModel(models: string[]): string {
  const preferredFamilies = [/qwen/i, /mistral/i, /llama/i, /gemma/i, /phi/i];

  for (const family of preferredFamilies) {
    const match = models.find((model) => family.test(model));
    if (match) {
      return match;
    }
  }

  return models[0] ?? "";
}
