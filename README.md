# WikiClaw

[![CI status](https://github.com/DaniyarM/WikiClaw/actions/workflows/ci.yml/badge.svg)](https://github.com/DaniyarM/WikiClaw/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/DaniyarM/WikiClaw?label=GitHub%20release)](https://github.com/DaniyarM/WikiClaw/releases)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

WikiClaw is an agent-first personal knowledge base that turns chat, files, and web research into a persistent Obsidian-compatible wiki.

It was inspired by Andrej Karpathy's LLM wiki / idea-file direction, but WikiClaw is not just a prompt or a thin demo. It is a standalone interface and workflow for running your own compounding knowledge base: live agent activity, natural-language ingest and maintenance, multi-wiki management, and clean markdown output you can open directly in Obsidian.

In other words: the inspiration came from the pattern, while WikiClaw is its own product direction for personal knowledge work.

Think of it as a knowledge-work counterpart to an agentic IDE: the agent maintains the wiki, you steer the research.

## Why WikiClaw

- Persistent knowledge instead of one-off answers. The agent compiles knowledge into markdown pages and keeps the wiki current over time.
- Natural language only. You can talk normally, attach files, ask questions, request updates, or ask what is missing.
- Obsidian-native output. Pages, links, notes, and sources stay editable and inspectable as plain markdown files.
- Local or cloud models. Works with Ollama and OpenAI-compatible APIs.
- Live UX. The chat shows agent activity, file edits, web lookups, and a streaming final answer.
- Built for compounding knowledge. Ingest, query, and maintenance all feed the same evolving knowledge base.

## What Makes It Different

Most document chat tools behave like RAG: retrieve chunks, answer the question, forget the work. WikiClaw follows a different pattern. It treats the wiki itself as the long-lived artifact.

When you add a source, the goal is not only to answer the next question. The goal is to improve the knowledge base:

- create or update grounded pages
- connect related concepts automatically
- preserve sources and provenance
- surface missing topics instead of inventing empty placeholders
- keep the result readable in Obsidian

That idea is strongly inspired by the LLM wiki pattern discussed by Karpathy, while WikiClaw pushes it into a full product concept: a chat-first, agentic UI for personal knowledge work.

## Features

- Chat UI with markdown rendering
- Live activity stream for thinking, file changes, and web research
- True streaming final answers
- Attach `.md`, `.txt`, and `.pdf` files directly in chat
- Natural-language ingest, query, refresh, and save flows
- Multi-chat history with persistence
- Multi-wiki library: create, switch, and delete wikis from the UI
- Obsidian-compatible vault layout
- Local web research with privacy-aware query generation
- English and Russian UI / reply support

## Tech Stack

- React + Vite frontend
- Express backend
- Ollama or OpenAI-compatible chat APIs
- Markdown-first storage on the local filesystem
- Obsidian-compatible vault structure

## Project Structure

```text
client/          React app
server/          Express API, agent logic, wiki services
shared/          Shared contracts between client and server
public/          Static assets
llm-wiki.md      Reference idea file included in the repo
WikiClaw.bat     Windows launcher
WikiClaw.sh      Linux launcher
```

At runtime, WikiClaw creates local state such as:

- `.wikiclaw/` for app state and chats
- `vault/` for the default wiki
- `wikis/` for managed additional wikis

These paths are ignored by git in this release template.

## Quick Start

Requirements:

- Node.js 20+
- one LLM provider:
  - a local Ollama instance, or
  - any OpenAI-compatible cloud API

### Windows

1. Install Node.js 20+.
2. Start your model provider:
   - Ollama example: make sure `ollama serve` is running and you have a chat model installed.
3. Run:

```bat
WikiClaw.bat
```

4. Open `http://localhost:8787` if the browser does not open automatically.
5. In Settings, choose your provider, base URL, model, and language if needed.

### Linux

1. Install Node.js 20+.
2. Start your model provider:
   - Ollama example: make sure `ollama serve` is running and you have a chat model installed.
3. Make the launcher executable:

```bash
chmod +x WikiClaw.sh
```

4. Run:

```bash
./WikiClaw.sh
```

5. Open `http://localhost:8787` if the browser does not open automatically.
6. In Settings, choose your provider, base URL, model, and language if needed.

### Manual Start

```bash
npm install
npm run build
npm start
```

## Using Cloud LLMs

WikiClaw is not limited to local models. It can also talk to cloud providers through an OpenAI-compatible API.

In Settings:

1. Set `Provider` to `OpenAI-compatible`.
2. Set `Base URL` to the provider's API root.
   - Example for the OpenAI API: `https://api.openai.com/v1`
3. Paste your API key into `API key`.
4. Enter the model name exposed by your provider.
5. Save settings and start chatting.

This also works with self-hosted gateways or compatible proxy services, as long as they expose the standard chat completions route.

## Recommended First Run

1. Open WikiClaw.
2. Confirm the model in Settings.
3. Create a new wiki or use the default one.
4. Attach a markdown note or PDF in chat.
5. Ask:

```text
Add the attached file to the wiki and connect it to existing pages.
```

6. Open the resulting vault in Obsidian and inspect the pages.

## Privacy

WikiClaw is designed to keep your knowledge base local-first and as private as possible.

- Your wiki is stored as local markdown files on your machine.
- Raw attachments are stored locally.
- The agent edits local files directly instead of pushing your knowledge base to an external hosted storage layer.
- Web search can be disabled in Settings.

For maximum privacy:

1. use a local LLM through Ollama
2. disable `Allow web search` in Settings

That gives you a fully local workflow with no intentional network lookups from the agent. If you use a cloud LLM, the visible context sent to the model necessarily leaves your machine, so local models remain the best choice for strict privacy.

## Obsidian Workflow

WikiClaw writes standard markdown and keeps the wiki readable outside the chat interface. The intended workflow is:

- use WikiClaw to ingest, query, refine, and maintain the wiki
- use Obsidian to browse the graph, inspect links, and read the generated pages
- keep the human in the loop for source curation and direction

The agent writes the wiki. You curate the inputs and challenge the outputs.

## Current Scope

WikiClaw is designed for personal knowledge bases and research workflows first. It already supports:

- personal notes and reading workflows
- topic research wikis
- file-backed knowledge accumulation
- iterative question-driven refinement

It is not trying to be a generic enterprise document platform or a hosted SaaS product.

## Inspiration

WikiClaw was inspired by the recent LLM wiki / idea-file discussions around Andrej Karpathy's approach to compounding knowledge bases.

- Included reference: [llm-wiki.md](./llm-wiki.md)

The core inspiration is the pattern. WikiClaw itself is a distinct implementation and product direction.

## License

[MIT](./LICENSE)
