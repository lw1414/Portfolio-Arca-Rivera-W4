# Aernest Lean Rivera — The Press Edition

A second, deliberately different-looking portfolio — the **print/press companion** to the dark, glassmorphic edition on the desktop. Same builder, a different press.

## The idea
Where the dark edition is neon glass and night-mode, this one is a **risograph press magazine**: warm newsprint paper, a dominant riso ink-blue with a red second ink, corner crop/registration marks, halftone dividers, "FIG." figure captions, and folio page numbers. It exists to **showcase design versatility** — two very different visual identities for the same body of work.

## How the work is organized
Projects are grouped as magazine **Departments**, one per AI tool used to build them:

- **Dept. 01 — Claude Cowork** *(from the Sandbox folder)* — Techno Hero storefront, Sales Automation Suite, TesterTech Wear campaign, PawPrint Tees social strategy, AI Inbox Manager.
- **Dept. 02 — Codex** — Capstone social-automation engine, Image Generation, Schedule Your Skill, and the W4D5 custom-skill builds.
- **Dept. 03 — Claude Code** — LeadBlaster security audit, the Freelancer-Toolkit plugin ecosystem, and live SEO/WordPress work via MCP.

Text-only projects (PawPrint, AI Inbox, Security Audit) are shown as typeset stat panels rather than screenshots.

## Running it
Fully self-contained — no build step. Just open `index.html` in a browser. All screenshots/outputs live under `assets/`:

```
assets/
  cowork/      # Sandbox projects (Claude Cowork)
  codex/       # Codex projects
  claudecode/  # Claude Code projects
```

## Design notes
- **Type:** Instrument Serif (display) · Newsreader (body) · Space Mono (labels/folios) — a different trio from the dark edition's Fraunces/Inter/JetBrains.
- **Palette:** newsprint `#ECE6D6`, ink `#16140F`, riso blue `#233CA6`, riso red `#D63A24`.
- Vanilla HTML/CSS/JS. Responsive to mobile, keyboard-focusable, and respects `prefers-reduced-motion`.
