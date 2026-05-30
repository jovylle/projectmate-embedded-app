# projectmate-embedded-app

Universal **iframe overlay** widget: one script on the host (`embed.js`), full support-style UI in a hosted app, wired with `postMessage`.

For a **community hub / forum layer** with host auth, threads, and activity feed, see the separate project: [projectmate-hub](https://github.com/jovylle/projectmate-hub). This repo stays focused on the lightweight embed overlay for existing host integrations.

---

## Integrating on a host website (instructions for your project)

Use this section when you want another codebase (or an AI assistant there) to add ProjectMate **without** cloning this repo.

### What you need from whoever deploys ProjectMate

Two **HTTPS** URLs (same or different domains is fine):

1. **`embed.js`** — the bootstrap script (small, vanilla JS). Production: `https://projectmate.uft1.com/embed.js`
2. **Overlay app** — the static UI loaded inside the iframe. Production: `https://projectmate.uft1.com/overlay/` (must resolve to the built app’s `index.html` and its assets)

The embed validates `postMessage` using **`new URL(appUrl).origin`**, so `appUrl` must be the **canonical base URL** of that overlay deployment (usually the directory that contains `index.html`).

### Drop-in snippet

Add **once** per page (typically before `</body>`). Call **`ProjectMate.init(...)`** only in the browser (not during SSR without a guard).

```html
<script src="https://projectmate.uft1.com/embed.js"></script>
<script>
  ProjectMate.init({
    projectId: "YOUR_STABLE_ID",
    appUrl: "https://projectmate.uft1.com/overlay/",
    host: {
      id: "acme-prod",
      name: "Acme",
      version: "2.4.1",
      environment: "production",
      plan: "enterprise",
      region: "ap-southeast-1",
      locale: "en-PH",
      timezone: "Asia/Manila",
      supportEmail: "support@acme.com",
      modules: {
        feedback: true,
        updates: true,
        issues: true,
        chat: false,
      },
      permissions: {
        admin: ["view", "manage", "publish"],
        viewer: ["view"],
      },
    },
    multiHost: {
      enabled: true,
      activeHostId: "acme-prod",
      totalHosts: 6,
      canSwitchHosts: true,
      benchmarkLabel: "Top 25% response time this week",
    },
    about: {
      title: "Your product name",
      description: "One line about what this site/tool does.",
    },
    features: {
      chat: false,
      feedback: true,
      updates: true,
      issues: true,
      about: true,
    },
    theme: "auto",
    accentColor: "#4f46e5",
    links: {
      docs: "https://example.com/docs",
    },
    changelog: [
      {
        version: "Host v2.4.1",
        date: "2026-05-09",
        bullets: ["Current host-site version deployed", "ProjectMate multi-host metadata enabled"],
      },
      {
        version: "1.0.0",
        date: "2026-05-08",
        bullets: ["First public release"],
      },
    ],
    quotes: [
      "Great hosting is thoughtful consistency.",
      "Ship, learn, improve.",
      "Clarity beats cleverness.",
    ],
    // Cloudflare Worker endpoint for issue submission/listing/moderation.
    issuesEndpoint: "https://projectmate-issues-api.example.workers.dev",
    issueWorkflow: {
      requireImageApproval: true,
    },
    launcher: {
      position: "bottom-right",
      offsetX: 16,
      offsetY: 16,
      label: "Help",
    },
    autoOpen: {
      hash: "help",
      query: { name: "help", value: "1" },
      path: "/support",
      pathMatch: "prefix",
    },
  });
</script>
```

Remove or adjust optional blocks you do not use (`changelog`, `issuesEndpoint`, `feedbackEndpoint`, `autoOpen`, etc.). **`projectId`** and **`appUrl`** are required.

### Required fields

| Field | Type | Purpose |
|-------|------|---------|
| `projectId` | string | Stable id for your product (shown in payloads / future analytics). |
| `appUrl` | string (absolute `https://…` URL) | Iframe `src` base for the hosted overlay app. |

### Common optional fields

| Field | Purpose |
|-------|---------|
| `about` | `{ title, description }` for the About tab. |
| `features` | Booleans: `about`, `feedback`, `updates`, `issues`, `chat` — toggles nav sections. |
| `theme` | `"light"` \| `"dark"` \| `"auto"` (follows `prefers-color-scheme` when `auto`). |
| `accentColor` | CSS color for launcher / accents, e.g. `"#6366f1"`. |
| `links` | Object of label → absolute URL (e.g. docs, GitHub). |
| `customSections` | Array of `{ title, content }` — `content` is markdown, sanitized in the overlay. |
| `host` | Host metadata shown in About: `{ id, name, version, environment, plan, region, locale, timezone, supportEmail, modules, permissions }`. |
| `multiHost` | Aggregate context for multi-tenant pages: `{ enabled, activeHostId, totalHosts, canSwitchHosts, benchmarkLabel }`. |
| `changelog` | Static releases: `[{ version, date?, bullets: string[] }]`. |
| `quotes` | Array of strings; overlay picks one random quote for About on load. |
| `issuesEndpoint` | Absolute URL for issues API (`POST /issues`, `GET /issues`, moderation routes). |
| `issueWorkflow` | `{ requireImageApproval?: boolean }` for moderated image visibility defaults. |
| `feedbackEndpoint` | Backward-compatible fallback endpoint used if `issuesEndpoint` is not provided. |
| `launcher` | `{ hidden?, position, offsetX, offsetY, label? }` — set `hidden: true` to skip the floating button entirely (use `autoOpen` and/or `ProjectMate.open()` instead). |
| `autoOpen` | Open the overlay when the **current page URL** matches any rule (rules are **OR**’d). See below. |

### Minimum issue submission setup

If you see `Issue submission is not configured yet for this workspace.`, your init config is missing both `issuesEndpoint` and `feedbackEndpoint`.

Minimum working setup:

- Keep required fields: `projectId` and `appUrl`
- Enable at least one entry surface: `features.feedback: true` or `features.issues: true`
- Set one API base URL: `issuesEndpoint` (preferred) or `feedbackEndpoint`
- Your API must accept `POST /issues` (full issues UI also uses `GET /issues`)

```js
ProjectMate.init({
  projectId: "my-workspace",
  appUrl: "https://projectmate.uft1.com/overlay/",
  features: { feedback: true, issues: false },
  issuesEndpoint: "https://your-api.example.com",
});
```

### Cloudflare issues API

Use a Cloudflare Worker with D1 + R2 to support moderated issue reporting with screenshots.

```js
ProjectMate.init({
  projectId: "my-tool",
  appUrl: "https://projectmate.uft1.com/overlay/",
  features: { feedback: true, issues: true },
  issuesEndpoint: "https://projectmate-issues-api.example.workers.dev",
  issueWorkflow: {
    requireImageApproval: true,
  },
});
```

The overlay sends `POST /issues` for new reports and reads public lists from `GET /issues?projectId=:id&view=open|resolved`. Screenshot issues can stay `pending` until an admin approves them through moderation routes.

### URL deep links (`autoOpen`)

Optional. If **any** configured rule matches, the overlay opens automatically (also on `hashchange` / `popstate`).

- **`hash`**: e.g. `"help"` matches `#help` (leading `#` in the string is optional).
- **`query`**: `{ name: "help", value: "1" }` matches `?help=1`. Omit `value` to match whenever the param is present and non-empty.
- **`path`**: e.g. `"/support"` — must start with `/`. Default **`pathMatch`: `"prefix"`** matches `/support` and `/support/…`. Use **`"exact"`** for one pathname only. **`path: "/"` + `"prefix"`** is invalid (would match every page).

### Hide the floating button / open from your own UI

The default floating launcher is great for an always-visible "Help" affordance, but it can feel mismatched when the overlay is fullscreen. Hide it and open the overlay from a **URL fragment** or **your own button**:

```html
<a href="#help">Open help</a>
<button onclick="ProjectMate.open()">Open help</button>

<script>
  ProjectMate.init({
    projectId: "my-tool",
    appUrl: "https://projectmate.uft1.com/overlay/",
    launcher: { hidden: true },
    autoOpen: { hash: "help" },
  });
</script>
```

Programmatic API on the global, available right after `<script src=".../embed.js">` loads (calls before bootstrap finishes are queued):

- `ProjectMate.open()` — open the overlay
- `ProjectMate.close()` — close the overlay
- `ProjectMate.toggle()` — toggle state
- `ProjectMate.isOpen()` — current open state (false before bootstrap)

### Behaviour and constraints

- **Single init**: a second `ProjectMate.init` is ignored (warning in the console).
- **Deferred bootstrap**: the script waits for `DOMContentLoaded` and prefers `requestIdleCallback` when available so it does not block first paint aggressively.
- **Isolation**: launcher + overlay chrome use **shadow DOM**; the real UI runs in an **iframe** (`sandbox` includes scripts, same-origin, forms, popups as needed for the overlay app).
- **While open**: background `document.body` **siblings** get **`inert`**, scroll is locked, **Escape** closes, focus returns to the launcher when closed.
- **Back button at the launcher's corner**: when the overlay opens, the floating launcher transforms into a back arrow (`←`) at the same corner it was originally placed, so users can dismiss without travelling to the in-iframe Back button. Hidden when `launcher.hidden: true`.
- **Do not** pass secrets in `init` — the object is sent to the iframe via `postMessage` (serialized JSON).

### Content-Security-Policy on the **host** page

If you use CSP, you typically need at least:

- **`script-src`** — include the origin that serves **`embed.js`**.
- **`frame-src`** (or a compatible directive in your policy) — include the **overlay** origin from `appUrl`, or the browser may block the iframe.

The **overlay app** has its own CSP when you host it; tune `connect-src` there for `issuesEndpoint` (or `feedbackEndpoint` fallback) and any APIs the iframe calls.

### Full config schema (maintainers / advanced)

Authoritative TypeScript + Zod definitions live in this repo at [`packages/shared-types/src/init-config.ts`](packages/shared-types/src/init-config.ts) (field names, URLs, defaults).

---

## Monorepo layout

| Path | Role |
|------|------|
| [`apps/embed-sdk`](apps/embed-sdk) | Vanilla `embed.js` — `ProjectMate.init({...})`, launcher, fullscreen iframe |
| [`apps/overlay-app`](apps/overlay-app) | Svelte 5 + Vite + Tailwind — About, Report Issue, Updates, Issues/Resolved |
| [`packages/shared-types`](packages/shared-types) | Zod schemas + protocol types for host ↔ iframe |
| [`apps/api`](apps/api) | Cloudflare Worker API for issues + moderation (D1 + R2) |

## Deploying to Netlify

The site is built with **`pnpm run build:site`**, which writes **`site/out/`**:

- [`index.html`](index.html) — marketing homepage (what / demo / basic use)
- `demo.html` — sample host page with paths rewritten for production (`./embed.js`, `./overlay/…`)
- `embed.js` and `overlay/` (full Vite output of the iframe app)

[`netlify.toml`](netlify.toml) uses that command and publishes **`site/out`**. **Base directory** in the Netlify UI should stay the **repository root** (empty) so pnpm sees the whole workspace.

**TypeScript incremental gotcha (fixed in repo):** a committed `*.tsbuildinfo` could make `tsc` skip emitting `packages/shared-types/dist` on a clean clone; the shared-types package now clears that file before each build, and `*.tsbuildinfo` is gitignored.

**Node:** 20.x (`NODE_VERSION` in `netlify.toml`).

If you only need the **overlay bundle** elsewhere (no landing page), you can still run `pnpm run build:overlay` and upload `apps/overlay-app/dist` only.

## Quick start (this repo)

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

## Development

- Overlay app only: `pnpm dev:overlay` (Vite on port 5173). For cross-origin embed testing, point `appUrl` in init at `http://localhost:5173/` and allow that origin in your mental model for `postMessage` (the embed validates the iframe origin against `new URL(appUrl).origin`).

## Isolation and accessibility

- **Shadow DOM**: the launcher and overlay shell live in a shadow tree under a single `body` child, which limits accidental style leakage from the host page. If a host cannot use shadow DOM, treat that as an integration edge case (e.g. open the overlay app in a separate window instead of embedding).
- **While the overlay is open**, other direct children of `document.body` are marked **`inert`** so background content is skipped for focus and assistive tech, in addition to **scroll locking**. The ProjectMate host node is excluded.
- **`PM_READY`**: the iframe posts this after validating config; the embed accepts it for a forward-compatible handshake.

## CSP (hosted overlay app)

For the static Vite build, start from something like: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://your-api.example` and add any domains used by `issuesEndpoint` (or `feedbackEndpoint` fallback). Tighten `frame-ancestors` to known embedding origins when you can, instead of `*`.

## License

Private / TBD.
