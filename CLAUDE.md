# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment

This workspace uses an OpenRouter API key stored in `.env`:

```
OPENROUTER_API_KEY=...
```

OpenRouter provides unified access to multiple LLM providers (OpenAI, Anthropic, Google, etc.) via an OpenAI-compatible API endpoint (`https://openrouter.ai/api/v1`).

## Claude Code Settings

`.claude/settings.local.json` whitelists common PowerShell/Bash file-listing and git commands so they run without permission prompts.
