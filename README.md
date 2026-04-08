# Basic Coding Agent

A very small terminal coding agent built with the Vercel AI SDK.

The goal is simple: if you ask it to create or change a file, it should use tools and do the work in the workspace instead of only replying with code blocks. The overall loop is loosely inspired by the structure of [`packages/coding-agent` in `pi-mono`](https://github.com/badlogic/pi-mono), but this project intentionally keeps only the bare minimum.

## What it does

- Runs in the terminal
- Uses `gpt-5.4` by default
- Lets the model call local tools
- Keeps all file access inside the current workspace
- Blocks `.git`, `.next`, and `node_modules`

## Tools

By default the CLI exposes the same core built-in tools that `pi` uses:

- `read`
- `bash`
- `edit`
- `write`

The repo also includes `pi`-style `grep`, `find`, and `ls` tool definitions for parity, but the CLI currently defaults to the core four.

## Setup

1. Copy `.env.example` to `.env.local`
2. Put your `OPENAI_API_KEY` in `.env.local`
3. Optionally change `OPENAI_MODEL`
4. Install dependencies:

```bash
pnpm install
```

## Run

Interactive mode:

```bash
pnpm tui
```

Interactive mode in a subdirectory:

```bash
pnpm tui -- --cwd playground/
```

Single prompt:

```bash
pnpm tui -- "build hello world in python"
```

## Notes

- The CLI loads `.env.local` automatically.
- If you ask for a file to be created and do not provide a filename, the agent is prompted to choose a sensible one and write it.
- This is intentionally much simpler than [`pi-mono`](https://github.com/badlogic/pi-mono).
