# Forkline

**One change. Two futures.**

A tiny remix studio for Twitch. A viewer changes one robot instruction; the original and its remix replay on the same map, from the same start, on the same clock. The first changed beat lights up, and every version keeps its parent and author.

[Play Forkline](https://blucca.github.io/forkline/) · [Open a live round](https://blucca.github.io/forkline/?channel=twitchdev)

## Try it

1. Open the [studio](https://blucca.github.io/forkline/). The first example shows a robot stopped by a clock gate.
2. Keep version **0** and step **1** selected. Click **Wait a beat**.
3. Replay together: the original meets a closed gate on beat 3. The remix reaches that same gate on beat 4, when it is open, then delivers on beat 7.

Try the other two challenges. **Two cleanups** takes a turn repair followed by a timing repair, so one viewer can continue another viewer’s fix. Click a version to replay its immediate parent beside it. Copy a replay link or save/open a remix JSON to keep the whole creation.

## Play through Twitch chat

Enter your channel name and press **Listen**. A live round begins with version **0**; the local example is replaced. In that channel’s Twitch chat, send:

```text
!fix 0 1 W
```

This makes a remix of version 0, replacing instruction 1 with W. Commands use:

| Letter | Action | Time |
|---|---|---|
| F | Move one tile in the current direction | One beat |
| L | Turn left in place | One beat |
| R | Turn right in place | One beat |
| W | Wait in place | One beat |

Version IDs refer to immutable programs. A subsequent `!fix 1 4 L` changes step 4 of version 1. The stage prints a ready-to-copy command for the selected parent and step. Viewers keep their existing Twitch login; the studio connects as an anonymous, read-only IRC guest. It sends only the connection handshake and PONG responses. It creates versions from explicit `!fix` messages, using Twitch user IDs for authorship and message IDs for duplicate delivery.

Both robots are evaluated against the same gate phase. A crash freezes that robot at its last legal tile. The earliest difference compares position, heading and status on each beat. A change to an instruction that was never reached can leave the visible route unchanged.

### OBS

Listen to your channel, then click **Copy OBS URL**. Add it as an OBS Browser Source at **1280 × 720** or **1920 × 1080**. The URL includes the current challenge and round snapshot, including the existing version IDs. Fresh Twitch commands continue that round in the overlay.

For a live session, submit remixes through Twitch chat so the studio and overlay receive the same commands. Local buttons are for rehearsal; copy a fresh OBS URL after making a local change. The overlay keeps the stage, paired instructions and credits, with the editor removed.

## Run locally

A static server is enough. No runtime packages, application keys, model calls or backend service are required.

```sh
python3 -m http.server 8000
# Open http://localhost:8000
node check-core.mjs
```

`core.mjs` contains the three original maps, deterministic simulation, first-difference comparison, strict command/IRC parsing and immutable forks. `app.js` renders SVG traces and handles the read-only WebSocket. Fonts are self-hosted under their included OFL licenses. All robot/map art is drawn in the source.

## Scope and evidence

The first release has three short challenges, programs of at most 11 instructions, and a maximum of 128 versions per round. The stage queues six recent showpieces and displays the latest 24 versions; the parent selector keeps all accepted versions. JSON and replay links save display credits and program changes; raw chat, Twitch user IDs and message IDs stay in the running page. A disconnection preserves the current round and offers Reconnect.

- A runnable [core check](check-core.mjs) covers three repairs, a two-author chain, IRC identity tags, duplicate messages, invalid changes and a change with no observable effect.
- [Browser validation](docs/browser-validation.json) covers a local WAIT repair, same-tab saved replay, a 390px layout, a 1280×720 overlay, a protocol fixture, and one native Twitch read-only sample. The fixture and real network observations are labelled separately.
- [Codex build notes](docs/codex-build.md) identify the primary building thread and one actual implementation repair.

Built with OpenAI Codex during the Codex × TwitchCon Hackathon window. Fictional example credits are explicitly marked. Independent live playtests will be recorded when completed.

MIT license.
