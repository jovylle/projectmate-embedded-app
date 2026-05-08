<script lang="ts">
  import { onMount } from "svelte";
  import { marked } from "marked";
  import DOMPurify from "dompurify";
  import {
    hostToIframeMessageSchema,
    initConfigSchema,
    PROTOCOL_VERSION,
    type InitConfig,
  } from "@projectmate/shared-types";

  type Section = "about" | "feedback" | "updates" | "chat" | "issues";

  let config = $state<InitConfig | null>(null);
  let parentOrigin = $state<string | null>(null);
  let parentHref = $state<string | undefined>(undefined);
  let section = $state<Section>("about");
  let loadError = $state<string | null>(null);
  let feedbackBody = $state("");
  let feedbackEmail = $state("");
  let feedbackStatus = $state<"idle" | "sending" | "sent" | "error">("idle");
  let feedbackScreenshotName = $state<string | null>(null);
  let feedbackScreenshotDataUrl = $state<string | null>(null);
  let feedbackFileHint = $state<string | null>(null);

  const features = $derived(config?.features);

  const navItems = $derived.by(() => {
    if (!config || !features) return [];
    const items: { id: Section; label: string }[] = [];
    if (features.about) items.push({ id: "about", label: "About" });
    if (features.feedback) items.push({ id: "feedback", label: "Feedback" });
    if (features.updates) items.push({ id: "updates", label: "Updates" });
    if (features.chat) items.push({ id: "chat", label: "Chat" });
    if (features.issues) items.push({ id: "issues", label: "Issues" });
    return items;
  });

  $effect(() => {
    if (!config) return;
    const first = navItems[0]?.id;
    if (first && !navItems.some((n) => n.id === section)) {
      section = first;
    }
  });

  $effect(() => {
    const c = config;
    if (!c || c.theme !== "auto") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(c);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  });

  function applyTheme(c: InitConfig) {
    const root = document.documentElement;
    const mode = c.theme === "auto" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : c.theme;
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
    if (c.accentColor) {
      root.style.setProperty("--pm-accent", c.accentColor);
    } else {
      root.style.removeProperty("--pm-accent");
    }
  }

  function renderMd(text: string): string {
    const raw = marked.parse(text, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }

  function postToParent(msg: { type: string; v?: number; payload?: unknown }) {
    if (!parentOrigin) return;
    window.parent.postMessage({ v: PROTOCOL_VERSION, ...msg }, parentOrigin);
  }

  function requestClose() {
    postToParent({ type: "PM_REQUEST_CLOSE" });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      requestClose();
    }
  }

  const MAX_SCREENSHOT_BYTES = 350_000;

  function onScreenshotPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    feedbackFileHint = null;
    feedbackScreenshotDataUrl = null;
    feedbackScreenshotName = null;
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      feedbackFileHint = "Please choose an image file.";
      input.value = "";
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      feedbackFileHint = `Image must be under ${Math.round(MAX_SCREENSHOT_BYTES / 1024)} KB.`;
      input.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === "string") {
        feedbackScreenshotDataUrl = r;
        feedbackScreenshotName = file.name;
      }
    };
    reader.readAsDataURL(file);
  }

  async function submitFeedback() {
    if (!config?.feedbackEndpoint) {
      feedbackStatus = "error";
      return;
    }
    feedbackStatus = "sending";
    try {
      const body = {
        projectId: config.projectId,
        message: feedbackBody,
        email: feedbackEmail || undefined,
        screenshot:
          feedbackScreenshotDataUrl && feedbackScreenshotName
            ? { name: feedbackScreenshotName, dataUrl: feedbackScreenshotDataUrl }
            : undefined,
        meta: {
          userAgent: navigator.userAgent,
          viewport: { w: window.innerWidth, h: window.innerHeight },
          parentHref,
        },
      };
      const res = await fetch(config.feedbackEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      feedbackStatus = "sent";
      feedbackBody = "";
      feedbackScreenshotDataUrl = null;
      feedbackScreenshotName = null;
      feedbackFileHint = null;
    } catch {
      feedbackStatus = "error";
    }
  }

  onMount(() => {
    const handler = (event: MessageEvent) => {
      const parsed = hostToIframeMessageSchema.safeParse(event.data);
      if (!parsed.success) return;

      const msg = parsed.data;
      if (msg.type === "PM_CLOSE") {
        loadError = null;
        feedbackScreenshotDataUrl = null;
        feedbackScreenshotName = null;
        feedbackFileHint = null;
        return;
      }
      if (msg.type !== "PM_CONFIG") return;

      if (event.origin !== msg.payload.parentOrigin) {
        loadError = "Origin mismatch";
        return;
      }

      const cfg = initConfigSchema.safeParse(msg.payload.config);
      if (!cfg.success) {
        loadError = "Invalid configuration";
        return;
      }

      config = cfg.data;
      parentOrigin = msg.payload.parentOrigin;
      parentHref = msg.payload.parentHref;
      applyTheme(cfg.data);
      postToParent({ type: "PM_READY" });
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if loadError}
  <div class="pm-shell pm-error">
    <p>{loadError}</p>
  </div>
{:else if !config}
  <div class="pm-shell pm-loading">
    <p>Loading…</p>
  </div>
{:else}
  <div class="pm-shell" data-loaded="true">
    <aside class="pm-aside">
      <div class="pm-brand">
        <span class="pm-dot" style:background="var(--pm-accent, #6366f1)"></span>
        <div>
          <div class="pm-title">{config.about?.title ?? config.projectId}</div>
          <div class="pm-sub">Support</div>
        </div>
      </div>
      <nav class="pm-nav">
        {#each navItems as item}
          <button
            type="button"
            class="pm-nav-item"
            class:active={section === item.id}
            onclick={() => (section = item.id)}
          >
            {item.label}
          </button>
        {/each}
      </nav>
      <button type="button" class="pm-close" onclick={requestClose}>Close</button>
    </aside>
    <main class="pm-main">
      {#if section === "about" && features?.about}
        <h1>{config.about?.title ?? config.projectId}</h1>
        {#if config.about?.description}
          <p class="pm-lead">{config.about.description}</p>
        {/if}
        {#if config.github}
          <p class="pm-meta">GitHub: <code>{config.github}</code></p>
        {/if}
        {#if config.links && Object.keys(config.links).length}
          <h2>Links</h2>
          <ul>
            {#each Object.entries(config.links) as [label, href]}
              <li><a {href} target="_blank" rel="noreferrer">{label}</a></li>
            {/each}
          </ul>
        {/if}
        {#each config.customSections as s}
          <section class="pm-section">
            <h2>{s.title}</h2>
            <div class="pm-md">{@html renderMd(s.content)}</div>
          </section>
        {/each}
      {:else if section === "feedback" && features?.feedback}
        <h1>Feedback</h1>
        <p class="pm-lead">Tell us what broke, what confused you, or what you want next.</p>
        {#if !config.feedbackEndpoint}
          <p class="pm-note">No <code>feedbackEndpoint</code> configured — form is display-only for now.</p>
        {/if}
        <label class="pm-field">
          <span>Message</span>
          <textarea bind:value={feedbackBody} rows="6" placeholder="Your feedback…"></textarea>
        </label>
        <label class="pm-field">
          <span>Email (optional)</span>
          <input type="email" bind:value={feedbackEmail} placeholder="you@example.com" />
        </label>
        {#if config.feedbackEndpoint}
          <label class="pm-field">
            <span>Screenshot (optional)</span>
            <input type="file" accept="image/*" onchange={onScreenshotPick} />
            {#if feedbackScreenshotName}
              <span class="pm-file-meta">Attached: {feedbackScreenshotName}</span>
            {/if}
            {#if feedbackFileHint}
              <span class="pm-err">{feedbackFileHint}</span>
            {/if}
          </label>
        {/if}
        <div class="pm-actions">
          <button
            type="button"
            class="pm-primary"
            disabled={!config.feedbackEndpoint || !feedbackBody.trim() || feedbackStatus === "sending"}
            onclick={submitFeedback}
          >
            {feedbackStatus === "sending" ? "Sending…" : "Send"}
          </button>
          {#if feedbackStatus === "sent"}
            <span class="pm-success">Thanks — received.</span>
          {:else if feedbackStatus === "error"}
            <span class="pm-err">Could not send. Check endpoint or network.</span>
          {/if}
        </div>
      {:else if section === "updates" && features?.updates}
        <h1>Updates</h1>
        {#if !config.changelog?.length}
          <p class="pm-lead">No changelog entries yet. Pass <code>changelog</code> in <code>ProjectMate.init</code>.</p>
        {:else}
          <div class="pm-timeline">
            {#each config.changelog as entry}
              <article class="pm-release">
                <header>
                  <span class="pm-version">{entry.version}</span>
                  {#if entry.date}<time>{entry.date}</time>{/if}
                </header>
                <ul>
                  {#each entry.bullets as b}
                    <li>{b}</li>
                  {/each}
                </ul>
              </article>
            {/each}
          </div>
        {/if}
      {:else if section === "chat" && features?.chat}
        <h1>Chat</h1>
        <p class="pm-lead">AI chat is planned for Phase 2.</p>
      {:else if section === "issues" && features?.issues}
        <h1>Issues</h1>
        <p class="pm-lead">GitHub issues integration is planned for Phase 2.</p>
      {:else}
        <p class="pm-lead">This section is disabled.</p>
      {/if}
    </main>
  </div>
{/if}

<style>
  :global(html[data-theme="dark"]) {
    --pm-bg: #0b0f14;
    --pm-panel: #121826;
    --pm-text: #e8ecf2;
    --pm-muted: #9aa4b2;
    --pm-border: #243044;
  }
  :global(html[data-theme="light"]) {
    --pm-bg: #f6f7fb;
    --pm-panel: #ffffff;
    --pm-text: #0f172a;
    --pm-muted: #64748b;
    --pm-border: #e2e8f0;
  }

  .pm-shell {
    display: flex;
    height: 100%;
    min-height: 100%;
    background: var(--pm-bg);
    color: var(--pm-text);
    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      Segoe UI,
      Roboto,
      Helvetica,
      Arial,
      sans-serif;
  }

  .pm-loading,
  .pm-error {
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }

  .pm-aside {
    width: 220px;
    border-right: 1px solid var(--pm-border);
    background: var(--pm-panel);
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    box-sizing: border-box;
  }

  .pm-brand {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }

  .pm-dot {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    flex-shrink: 0;
  }

  .pm-title {
    font-weight: 600;
    font-size: 0.95rem;
  }

  .pm-sub {
    font-size: 0.75rem;
    color: var(--pm-muted);
  }

  .pm-nav {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
  }

  .pm-nav-item {
    text-align: left;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    padding: 0.5rem 0.65rem;
    border-radius: 0.5rem;
    cursor: pointer;
    font: inherit;
  }

  .pm-nav-item:hover {
    background: color-mix(in oklab, var(--pm-accent, #6366f1) 12%, transparent);
  }

  .pm-nav-item.active {
    border-color: var(--pm-border);
    background: color-mix(in oklab, var(--pm-accent, #6366f1) 18%, transparent);
  }

  .pm-close {
    margin-top: auto;
    border: 1px solid var(--pm-border);
    background: transparent;
    color: inherit;
    padding: 0.5rem;
    border-radius: 0.5rem;
    cursor: pointer;
    font: inherit;
  }

  .pm-main {
    flex: 1;
    overflow: auto;
    padding: 1.5rem 2rem;
    box-sizing: border-box;
  }

  .pm-main h1 {
    margin: 0 0 0.5rem;
    font-size: 1.35rem;
  }

  .pm-main h2 {
    margin: 1.25rem 0 0.5rem;
    font-size: 1.05rem;
  }

  .pm-lead {
    color: var(--pm-muted);
    margin: 0 0 1rem;
    line-height: 1.55;
  }

  .pm-meta {
    font-size: 0.9rem;
  }

  .pm-section {
    margin-top: 1rem;
  }

  .pm-md :global(a) {
    color: var(--pm-accent, #6366f1);
  }

  .pm-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }

  .pm-field input,
  .pm-field textarea {
    font: inherit;
    padding: 0.55rem 0.65rem;
    border-radius: 0.5rem;
    border: 1px solid var(--pm-border);
    background: var(--pm-panel);
    color: inherit;
  }

  .pm-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .pm-primary {
    border: none;
    border-radius: 0.5rem;
    padding: 0.55rem 1rem;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
    color: white;
    background: var(--pm-accent, #6366f1);
  }

  .pm-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .pm-success {
    color: #22c55e;
    font-size: 0.9rem;
  }

  .pm-err {
    color: #ef4444;
    font-size: 0.9rem;
  }

  .pm-note {
    font-size: 0.9rem;
    color: var(--pm-muted);
  }

  .pm-file-meta {
    font-size: 0.85rem;
    color: var(--pm-muted);
  }

  .pm-timeline {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .pm-release {
    border: 1px solid var(--pm-border);
    border-radius: 0.75rem;
    padding: 1rem;
    background: var(--pm-panel);
  }

  .pm-release header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .pm-version {
    font-weight: 700;
  }

  .pm-release time {
    color: var(--pm-muted);
    font-size: 0.85rem;
  }

  .pm-release ul {
    margin: 0;
    padding-left: 1.1rem;
  }
</style>
