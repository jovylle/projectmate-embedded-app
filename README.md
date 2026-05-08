# projectmate-embedded-app

Universal **iframe overlay** widget: one script on the host (`embed.js`), full support-style UI in a hosted app, wired with `postMessage`.

## Monorepo layout

| Path | Role |
|------|------|
| [`apps/embed-sdk`](apps/embed-sdk) | Vanilla `embed.js` — `ProjectMate.init({...})`, launcher, fullscreen iframe |
| [`apps/overlay-app`](apps/overlay-app) | Svelte 5 + Vite + Tailwind — About, Feedback, Updates (Phase 1) |
| [`packages/shared-types`](packages/shared-types) | Zod schemas + protocol types for host ↔ iframe |
| [`apps/api`](apps/api) | Stub / placeholder for future feedback & AI proxy |

## Quick start

```bash
pnpm install
pnpm build
pnpm demo
```

This runs a static Vite server (see [`vite.demo.config.ts`](vite.demo.config.ts)) and opens [`test.html`](test.html). The demo expects **built** artifacts at:

- `./apps/embed-sdk/dist/embed.js`
- `./apps/overlay-app/dist/index.html` (and hashed assets beside it)

Use **HTTP** (the demo server), not `file://`, so the iframe and `postMessage` origins behave like production.

## Host snippet (production shape)

```html
<script src="https://your-cdn.example.com/embed.js"></script>
<script>
  ProjectMate.init({
    projectId: "my-tool",
    appUrl: "https://your-app.example.com/",
    about: { title: "My tool", description: "…" },
    features: { chat: false, feedback: true, updates: true, issues: false, about: true },
  });
</script>
```

See [`packages/shared-types/src/init-config.ts`](packages/shared-types/src/init-config.ts) for the full config surface (`changelog`, `links`, `theme`, `accentColor`, `feedbackEndpoint`, etc.).

## Development

- Overlay app only: `pnpm dev:overlay` (Vite on port 5173). For cross-origin embed testing, point `appUrl` in init at `http://localhost:5173/` and allow that origin in your mental model for `postMessage` (the embed validates the iframe origin against `new URL(appUrl).origin`).

## License

Private / TBD.
