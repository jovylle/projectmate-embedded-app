# projectmate-embedded-app

Universal **iframe overlay** widget: one script on the host (`embed.js`), full support-style UI in a hosted app, wired with `postMessage`.

## Monorepo layout

| Path | Role |
|------|------|
| [`apps/embed-sdk`](apps/embed-sdk) | Vanilla `embed.js` — `ProjectMate.init({...})`, launcher, fullscreen iframe |
| [`apps/overlay-app`](apps/overlay-app) | Svelte 5 + Vite + Tailwind — About, Feedback, Updates (Phase 1) |
| [`packages/shared-types`](packages/shared-types) | Zod schemas + protocol types for host ↔ iframe |
| [`apps/api`](apps/api) | Stub / placeholder for future feedback & AI proxy |

## Deploying to Netlify (overlay app)

The failure you saw (`Failed to resolve entry for package "@projectmate/shared-types"`) happened because **`tsc` incremental state (`*.tsbuildinfo`) was committed**: on a clean clone `dist/` was missing, but TypeScript thought nothing changed and **emitted no files**, so Vite could not resolve the workspace package.

This repo now **deletes `tsconfig.build.tsbuildinfo` before each `shared-types` build** and ignores `*.tsbuildinfo`. Use **`pnpm run build:overlay`** (runs `shared-types` then `overlay-app` in order).

**Netlify settings:**

1. **Base directory**: leave **empty** (repository root) so the root [`netlify.toml`](netlify.toml) applies—or align your UI “build” settings with the same command and publish path.
2. **Build command** (if not using `netlify.toml`): `pnpm install --frozen-lockfile && pnpm run build:overlay`
3. **Publish directory**: `apps/overlay-app/dist`
4. **Node**: 20.x (set in `netlify.toml` as `NODE_VERSION`)

Do **not** set Netlify’s monorepo “package path” only to `apps/overlay-app` unless you also change the install/build to run from the **workspace root**; otherwise `pnpm` cannot see `@projectmate/shared-types`.

`embed.js` is a **separate artifact** (`apps/embed-sdk/dist/embed.js`): publish it as another Netlify site, or to any CDN, and point hosts at that URL.

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

## Isolation and accessibility

- **Shadow DOM**: the launcher and overlay shell live in a shadow tree under a single `body` child, which limits accidental style leakage from the host page. If a host cannot use shadow DOM, treat that as an integration edge case (e.g. open the overlay app in a separate window instead of embedding).
- **While the overlay is open**, other direct children of `document.body` are marked **`inert`** so background content is skipped for focus and assistive tech, in addition to **scroll locking**. The ProjectMate host node is excluded.
- **`PM_READY`**: the iframe posts this after validating config; the embed accepts it for a forward-compatible handshake.

## CSP (hosted overlay app)

For the static Vite build, start from something like: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://your-api.example` and add any domains used by `feedbackEndpoint`. Tighten `frame-ancestors` to known embedding origins when you can, instead of `*`.

## License

Private / TBD.
