# Receipts

Myth-busting Shorts app: **people say X — you drop the receipt.**

Talk (or paste) a viral claim and get a colour-graded vertical Short with punchy comic-ink animation, hard stamps, and captions. Built for science myths, money myths, and internet claims — dry, sharp, slightly smug. **Not** psychology / self-help.

Sibling of [Voice to Short](https://github.com/lhymite36-bot/voice-to-short), forked into its own brand, niche, and motion defaults. Same architecture (`gemini.js`, `scenes.js`, `render.js`, …); retuned defaults.

## Try it

- **Web (GitHub Pages):** https://lhymite36-bot.github.io/receipts/
- Android APK: optional later (separate keystore under `~/.secrets/receipts/` — not bundled here)

## Brand

| | |
|---|---|
| **Niche** | Myth-bust / “people say X but…” callouts |
| **Tone** | Deadpan receipts, sharp smug, stamp energy |
| **Palette** | Cream `#F5F0E8` · ink `#0D0D0D` · stamp red `#E23D28` |
| **Cast** | Skeptic + Claim Guy (no pink Brain) |
| **Captions (default)** | Hormozi (thick outline + shadow) |
| **Animation (default)** | `ANIM=2d`, `motion=classic` (harder cuts / punchier pops than Quiet Brain’s smooth psychology look). Smooth Motion 2.0 still available on the Render step. |
| **Grade (default)** | Comic Ink |

## Formats

People say… · Got receipts · Skeptic vs Claim Guy · Stamp it · Myth vs Fact · POV · Nobody:/Me: · Expectation vs Reality · Rating viral claims · 3 fake facts · Storytime · Hook + 3 receipts

## Dev

```bash
npm install
npm run vendor
npm run serve   # http://localhost:8080
```

Android: `com.receipts.app` / app name **Receipts**. `npm run sync` then Gradle as usual. Do not reuse Voice to Short signing secrets.

## Free stack

Capacitor, canvas 2D, Gemini (your key), Montserrat (OFL), Kenney / CC SFX where attributed in `www/sfx/`.

## Daily Shorts pipeline

6 Shorts/day straight to YouTube (@ReceiptsDaily): see [`pipeline/README.md`](pipeline/README.md). Workflow **Receipts daily Shorts** is disabled until YouTube credentials exist.
