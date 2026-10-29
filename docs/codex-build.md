# Built with Codex

Forkline was created on October 29, 2026, during the challenge’s new-project window, with OpenAI Codex 0.163.0.

Primary Codex session ID: `01a184eb-4651-77f0-ae8f-d23ce627d44e`

Primary Codex thread ID: `01a184eb-4651-77f0-ae8f-d23ce627d44e`

## The actual build

1. Codex planned a small robot studio with immutable one-instruction remixes, two synchronized executions and the earliest observable difference. The [design plan](../DESIGN.md) was written before the frontend.
2. Codex implemented the deterministic engine and a single runnable Node check, then the static SVG studio and native Twitch IRC connection.
3. A browser check found a saved-replay bug: opening a replay link in the same tab changed only the URL hash, so the startup-only loader kept the old page state. Codex confirmed the unchanged connection label and repaired the shared loader with a `hashchange` listener. The same-tab replay check then passed.
4. The browser check separately exercised an explicit IRC protocol fixture and a real public Twitch channel. Duplicate fixture messages produced one authored remix; the native sample received real ordinary chat. No fixture is presented as external participation.

The frontend, engine, maps and original SVG robot art were built in this thread with a parallel Codex engine task. Source files and the observable build results are public. Private account data, unrelated conversations and model-usage records remain outside this repository.
