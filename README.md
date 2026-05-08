# projectmate-embedded-app

Universal **iframe overlay** widget: one script on the host (`embed.js`), full support-style UI in a hosted app, wired with `postMessage`.

## Monorepo layout

| Path | Role |
|------|------|
| [`apps/embed-sdk`](apps/embed-sdk) | Vanilla `embed.js` — `ProjectMate.init({...})`, launcher, fullscreen iframe |
| [`apps/overlay-app`](apps/overlay-app) | Svelte 5 + Vite + Tailwind — About, Feedback, Updates (Phase 1) |
| [`packages/shared-types`](packages/shared-types) | Zod schemas + protocol types for host ↔ iframe |
| [`apps/api`](apps/api) | Stub / placeholder for future feedback & AI proxy |

## Deploying to Netlify

The site is built with **`pnpm run build:site`**, which writes **`site/out/`**:

- [`index.html`](index.html) — marketing homepage (what / demo / basic use)
- `demo.html` — sample host page with paths rewritten for production (`./embed.js`, `./overlay/…`)
- `embed.js` and `overlay/` (full Vite output of the iframe app)

[`netlify.toml`](netlify.toml) uses that command and publishes **`site/out`**. **Base directory** in the Netlify UI should stay the **repository root** (empty) so pnpm sees the whole workspace.

**TypeScript incremental gotcha (fixed in repo):** a committed `*.tsbuildinfo` could make `tsc` skip emitting `packages/shared-types/dist` on a clean clone; the shared-types package now clears that file before each build, and `*.tsbuildinfo` is gitignored.

**Node:** 20.x (`NODE_VERSION` in `netlify.toml`).

If you only need the **overlay bundle** elsewhere (no landing page), you can still run `pnpm run build:overlay` and upload `apps/overlay-app/dist` only.

## Quick start

```bash
pnpm install
pnpm build
pnpm demo
```

This runs a static Vite server (see [`vite.demo.config.ts`](vite.demo.config.ts)) and opens the **homepage** ([`index.html`](index.html)). From there, use **Try the live demo** → [`demo.html`](demo.html). The demo expects **built** artifacts at:

- `./apps/embed-sdk/dist/embed.js`
- `./apps/overlay-app/dist/index.html` (and hashed assets beside it)

Use **HTTP** (the demo server), not `file://`, so the iframe and `postMessage` origins behave like production.

The legacy URL [`test.html`](test.html) redirects to **`demo.html`**.

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

See [`packages/shared-types/src/init-config.ts`](packages/shared-types/src/init-config.ts) for the full config surface (`changelog`, `links`, `theme`, `accentColor`, `feedbackEndpoint`, **`autoOpen`** for `#hash` / `?query` / `/path` triggers, …).

### URL triggers (`autoOpen`)

Optional `autoOpen` on `ProjectMate.init` opens the overlay when **any** configured rule matches the current URL (rules are **OR**’d):

- **`hash`** — e.g. `"help"` matches `#help` (leading `#` in config is optional).
- **`query`** — `{ name: "pm", value: "1" }` matches `?pm=1`; omit `value` to match any non-empty param value.
- **`path`** — e.g. `"/support"` with default `pathMatch: "prefix"` matches `/support` and `/support/…`; use `pathMatch: "exact"` for an exact pathname. Paths must start with `/`. Using `path: "/"` with `prefix` is rejected (would match everything).

Also reacts to **`hashchange`** and **`popstate`** so client navigations can open the overlay without a full reload.

## Development

- Overlay app only: `pnpm dev:overlay` (Vite on port 5173). For cross-origin embed testing, point `appUrl` in init at `http://localhost:5173/` and allow that origin in your mental model for `postMessage` (the embed validates the iframe origin against `new URL(appUrl).origin`).

## Isolation and accessibility

- **Shadow DOM**: the launcher and overlay shell live in a shadow tree under a single `body` child, which limits accidental style leakage from the host page. If a host cannot use shadow DOM, treat that as an integration edge case (e.g. open the overlay app in a separate window instead of embedding).
- **While the overlay is open**, other direct children of `document.body` are marked **`inert`** so background content is skipped for focus and assistive tech, in addition to **scroll locking**. The ProjectMate host node is excluded.
- **`PM_READY`**: the iframe posts this after validating config; the embed accepts it for a forward-compatible handshake.

## CSP (hosted overlay app)

For the static Vite build, start from something like: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://your-api.example` and add any domains used by `feedbackEndpoint`. Tighten `frame-ancestors` to known embedding origins when you can, instead of `*`.

## License

Private / TBD.
