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
  let currentQuote = $state<string | null>(null);

  const features = $derived(config?.features);
  const feedbackConfigured = $derived(
    !!(config?.web3forms?.accessKey || config?.feedbackEndpoint)
  );

  const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";

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

  $effect(() => {
    const quotes = config?.quotes ?? [];
    if (!quotes.length) {
      currentQuote = null;
      return;
    }
    const idx = Math.floor(Math.random() * quotes.length);
    currentQuote = quotes[idx] ?? null;
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

  function dataUrlToBlob(dataUrl: string): Blob | null {
    const match = /^data:([^;,]+)(;base64)?,(.*)$/.exec(dataUrl);
    if (!match) return null;
    const mime = match[1] || "application/octet-stream";
    const isBase64 = !!match[2];
    const data = match[3] ?? "";
    try {
      if (isBase64) {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: mime });
      }
      return new Blob([decodeURIComponent(data)], { type: mime });
    } catch {
      return null;
    }
  }

  async function submitToWeb3Forms(c: InitConfig): Promise<void> {
    const w = c.web3forms;
    if (!w?.accessKey) throw new Error("missing access key");

    const subject = w.subject ?? `Feedback — ${c.about?.title ?? c.projectId}`;
    const fromName = w.fromName ?? "ProjectMate";
    const viewport = `${window.innerWidth}x${window.innerHeight}`;

    const hasScreenshot = !!(feedbackScreenshotDataUrl && feedbackScreenshotName);
    let res: Response;

    if (hasScreenshot) {
      const blob = dataUrlToBlob(feedbackScreenshotDataUrl!);
      const fd = new FormData();
      fd.append("access_key", w.accessKey);
      fd.append("subject", subject);
      fd.append("from_name", fromName);
      fd.append("message", feedbackBody);
      if (feedbackEmail) fd.append("email", feedbackEmail);
      fd.append("project_id", c.projectId);
      if (parentHref) fd.append("page", parentHref);
      fd.append("user_agent", navigator.userAgent);
      fd.append("viewport", viewport);
      fd.append("botcheck", "");
      if (blob) fd.append("attachment", blob, feedbackScreenshotName!);
      res = await fetch(WEB3FORMS_ENDPOINT, { method: "POST", body: fd });
    } else {
      const body = {
        access_key: w.accessKey,
        subject,
        from_name: fromName,
        message: feedbackBody,
        email: feedbackEmail || undefined,
        project_id: c.projectId,
        page: parentHref,
        user_agent: navigator.userAgent,
        viewport,
        botcheck: "",
      };
      res = await fetch(WEB3FORMS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
    }

    const json = (await res.json().catch(() => null)) as { success?: boolean; message?: string } | null;
    if (!res.ok || !json?.success) {
      throw new Error(json?.message || `Web3Forms ${res.status}`);
    }
  }

  async function submitToCustomEndpoint(c: InitConfig): Promise<void> {
    const url = c.feedbackEndpoint!;
    const body = {
      projectId: c.projectId,
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
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(String(res.status));
  }

  async function submitFeedback() {
    if (!config) return;
    if (!feedbackConfigured) {
      feedbackStatus = "error";
      return;
    }
    feedbackStatus = "sending";
    try {
      if (config.web3forms?.accessKey) {
        await submitToWeb3Forms(config);
      } else {
        await submitToCustomEndpoint(config);
      }
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
      <button type="button" class="pm-back" onclick={requestClose} aria-label="Back to host site">Back</button>
      <div class="pm-brand">
        <span class="pm-dot" style:background="var(--pm-accent, #6366f1)"></span>
        <div>
          <div class="pm-title">{config.about?.title ?? config.projectId}</div>
          <div class="pm-sub">Community support</div>
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
    </aside>
    <main class="pm-main">
      {#if section === "about" && features?.about}
        <h1>{config.about?.title ?? config.projectId}</h1>
        {#if config.about?.description}
          <p class="pm-lead">{config.about.description}</p>
        {/if}
        {#if config.host || config.multiHost}
          <section class="pm-section">
            <h2>Host details</h2>
            <div class="pm-meta-grid">
              {#if config.host?.name}
                <p class="pm-meta"><strong>Host:</strong> {config.host.name}</p>
              {/if}
              {#if config.host?.id}
                <p class="pm-meta"><strong>Host ID:</strong> <code>{config.host.id}</code></p>
              {/if}
              {#if config.host?.version}
                <p class="pm-meta"><strong>Version:</strong> <code>{config.host.version}</code></p>
              {/if}
              {#if config.host?.environment}
                <p class="pm-meta"><strong>Environment:</strong> {config.host.environment}</p>
              {/if}
              {#if config.host?.locale}
                <p class="pm-meta"><strong>Locale:</strong> {config.host.locale}</p>
              {/if}
              {#if config.host?.timezone}
                <p class="pm-meta"><strong>Timezone:</strong> {config.host.timezone}</p>
              {/if}
              {#if config.host?.plan}
                <p class="pm-meta"><strong>Plan:</strong> {config.host.plan}</p>
              {/if}
              {#if config.host?.region}
                <p class="pm-meta"><strong>Region:</strong> {config.host.region}</p>
              {/if}
              {#if config.host?.supportEmail}
                <p class="pm-meta"><strong>Support:</strong> {config.host.supportEmail}</p>
              {/if}
              {#if config.multiHost?.enabled}
                <p class="pm-meta"><strong>Multi-host:</strong> Enabled</p>
              {/if}
              {#if config.multiHost?.totalHosts}
                <p class="pm-meta"><strong>Total Hosts:</strong> {config.multiHost.totalHosts}</p>
              {/if}
              {#if config.multiHost?.activeHostId}
                <p class="pm-meta"><strong>Active Host:</strong> <code>{config.multiHost.activeHostId}</code></p>
              {/if}
              {#if config.multiHost?.benchmarkLabel}
                <p class="pm-meta"><strong>Benchmark:</strong> {config.multiHost.benchmarkLabel}</p>
              {/if}
            </div>
            {#if config.host?.modules && Object.keys(config.host.modules).length}
              <h3 class="pm-subhead">Modules</h3>
              <div class="pm-tag-row">
                {#each Object.entries(config.host.modules) as [module, enabled]}
                  <span class="pm-tag" class:enabled={enabled}>{module}: {enabled ? "on" : "off"}</span>
                {/each}
              </div>
            {/if}
            {#if config.host?.permissions && Object.keys(config.host.permissions).length}
              <h3 class="pm-subhead">Permissions</h3>
              <div class="pm-tag-row">
                {#each Object.entries(config.host.permissions) as [role, allowed]}
                  <span class="pm-tag">{role}: {allowed.join(", ")}</span>
                {/each}
              </div>
            {/if}
          </section>
        {/if}
        {#if currentQuote}
          <section class="pm-section pm-quote">
            <h2>Quote of the moment</h2>
            <blockquote>{currentQuote}</blockquote>
          </section>
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
        {#if !feedbackConfigured}
          <p class="pm-note">No feedback destination configured — form is display-only for now.</p>
        {/if}
        <label class="pm-field">
          <span>Message</span>
          <textarea bind:value={feedbackBody} rows="6" placeholder="Your feedback…"></textarea>
        </label>
        <label class="pm-field">
          <span>Email (optional)</span>
          <input type="email" bind:value={feedbackEmail} placeholder="you@example.com" />
        </label>
        {#if feedbackConfigured}
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
            disabled={!feedbackConfigured || !feedbackBody.trim() || feedbackStatus === "sending"}
            onclick={submitFeedback}
          >
            {feedbackStatus === "sending" ? "Sending…" : "Send"}
          </button>
          {#if feedbackStatus === "sent"}
            <span class="pm-success">Thanks — received.</span>
          {:else if feedbackStatus === "error"}
            <span class="pm-err">Could not send. Check the destination or your network.</span>
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
    --pm-bg: #0d1117;
    --pm-panel: #161b22;
    --pm-canvas: #010409;
    --pm-subtle: #0d1117;
    --pm-text: #e8ecf2;
    --pm-muted: #8b949e;
    --pm-border: #30363d;
    --pm-shadow: rgba(1, 4, 9, 0.24);
  }
  :global(html[data-theme="light"]) {
    --pm-bg: #f6f8fa;
    --pm-panel: #ffffff;
    --pm-canvas: #f6f8fa;
    --pm-subtle: #f6f8fa;
    --pm-text: #0f172a;
    --pm-muted: #57606a;
    --pm-border: #d0d7de;
    --pm-shadow: rgba(31, 35, 40, 0.08);
  }

  .pm-shell {
    display: flex;
    height: 100%;
    min-height: 100%;
    background: var(--pm-canvas);
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
    width: 260px;
    border-right: 1px solid var(--pm-border);
    background: var(--pm-bg);
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: 1rem 0.9rem;
    box-sizing: border-box;
  }

  .pm-back {
    width: 100%;
    border: 1px solid var(--pm-border);
    background: var(--pm-panel);
    color: var(--pm-text);
    padding: 0.6rem 0.75rem;
    border-radius: 0.5rem;
    cursor: pointer;
    font: inherit;
    font-weight: 700;
    text-align: left;
    box-shadow: 0 1px 2px var(--pm-shadow);
  }

  .pm-back:hover {
    border-color: var(--pm-accent, #6366f1);
    background: color-mix(in oklab, var(--pm-accent, #6366f1) 10%, var(--pm-panel));
  }

  .pm-brand {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    border: 1px solid var(--pm-border);
    border-radius: 0.75rem;
    background: var(--pm-panel);
    padding: 0.85rem;
    box-shadow: 0 1px 2px var(--pm-shadow);
  }

  .pm-dot {
    width: 14px;
    height: 14px;
    border-radius: 999px;
    flex-shrink: 0;
  }

  .pm-title {
    font-weight: 700;
    font-size: 0.95rem;
    line-height: 1.25;
  }

  .pm-sub {
    font-size: 0.75rem;
    color: var(--pm-muted);
    margin-top: 0.1rem;
  }

  .pm-nav {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    flex: 1;
    padding-top: 0.25rem;
  }

  .pm-nav-item {
    text-align: left;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    padding: 0.6rem 0.7rem;
    border-radius: 0.5rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .pm-nav-item:hover {
    background: var(--pm-panel);
    border-color: var(--pm-border);
  }

  .pm-nav-item.active {
    border-color: color-mix(in oklab, var(--pm-accent, #6366f1) 45%, var(--pm-border));
    background: color-mix(in oklab, var(--pm-accent, #6366f1) 12%, var(--pm-panel));
    box-shadow: inset 3px 0 0 var(--pm-accent, #6366f1);
  }

  .pm-main {
    flex: 1;
    overflow: auto;
    padding: 1.5rem;
    box-sizing: border-box;
    max-width: 960px;
    margin: 0 auto;
    width: 100%;
  }

  .pm-main h1 {
    margin: 0 0 1rem;
    font-size: 1.4rem;
    line-height: 1.25;
    border: 1px solid var(--pm-border);
    border-radius: 0.75rem;
    background: var(--pm-panel);
    padding: 1rem 1.1rem;
    box-shadow: 0 1px 2px var(--pm-shadow);
  }

  .pm-main h1:has(+ .pm-lead) {
    margin-bottom: 0;
    border-bottom: 0;
    border-radius: 0.75rem 0.75rem 0 0;
  }

  .pm-main h2 {
    margin: 1.25rem 0 0.5rem;
    font-size: 1.05rem;
  }

  .pm-subhead {
    margin: 0.9rem 0 0.45rem;
    font-size: 0.9rem;
    color: var(--pm-muted);
  }

  .pm-lead {
    color: var(--pm-muted);
    margin: 0 0 1rem;
    line-height: 1.55;
    border: 1px solid var(--pm-border);
    border-top: 0;
    border-radius: 0 0 0.75rem 0.75rem;
    background: var(--pm-panel);
    padding: 0 1.1rem 1rem;
  }

  .pm-meta {
    font-size: 0.9rem;
    border: 1px solid var(--pm-border);
    border-radius: 0.6rem;
    background: var(--pm-panel);
    padding: 0.75rem 0.9rem;
  }

  .pm-meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 0.6rem;
  }

  .pm-tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .pm-tag {
    border: 1px solid var(--pm-border);
    border-radius: 999px;
    padding: 0.22rem 0.65rem;
    font-size: 0.8rem;
    background: var(--pm-subtle);
  }

  .pm-tag.enabled {
    border-color: color-mix(in oklab, var(--pm-accent, #6366f1) 45%, var(--pm-border));
    background: color-mix(in oklab, var(--pm-accent, #6366f1) 12%, var(--pm-subtle));
  }

  .pm-quote blockquote {
    margin: 0;
    padding: 0.9rem 1rem;
    border-left: 3px solid var(--pm-accent, #6366f1);
    border-radius: 0.55rem;
    background: var(--pm-subtle);
    color: var(--pm-muted);
    font-style: italic;
  }

  .pm-section {
    margin-top: 1rem;
    border: 1px solid var(--pm-border);
    border-radius: 0.75rem;
    background: var(--pm-panel);
    padding: 0 1rem 1rem;
    box-shadow: 0 1px 2px var(--pm-shadow);
  }

  .pm-md :global(a) {
    color: var(--pm-accent, #6366f1);
  }

  .pm-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-bottom: 0;
    font-size: 0.9rem;
    border: 1px solid var(--pm-border);
    border-radius: 0.75rem;
    background: var(--pm-panel);
    padding: 1rem;
    box-shadow: 0 1px 2px var(--pm-shadow);
  }

  .pm-field + .pm-field,
  .pm-lead + .pm-field,
  .pm-note + .pm-field {
    margin-top: 0.75rem;
  }

  .pm-field input,
  .pm-field textarea {
    font: inherit;
    padding: 0.65rem 0.75rem;
    border-radius: 0.45rem;
    border: 1px solid var(--pm-border);
    background: var(--pm-subtle);
    color: inherit;
  }

  .pm-field textarea {
    resize: vertical;
  }

  .pm-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-top: 0.9rem;
    border: 1px solid var(--pm-border);
    border-radius: 0.75rem;
    background: var(--pm-panel);
    padding: 0.85rem 1rem;
    box-shadow: 0 1px 2px var(--pm-shadow);
  }

  .pm-primary {
    border: none;
    border-radius: 0.45rem;
    padding: 0.6rem 1rem;
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
    border: 1px solid var(--pm-border);
    border-radius: 0.75rem;
    background: var(--pm-panel);
    padding: 0.85rem 1rem;
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
    box-shadow: 0 1px 2px var(--pm-shadow);
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
