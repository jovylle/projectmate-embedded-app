<script lang="ts">
  import { onMount } from "svelte";
  import { marked } from "marked";
  import DOMPurify from "dompurify";
  import {
    issueListResponseSchema,
    issueModerationResponseSchema,
    type IssueRecord,
    hostToIframeMessageSchema,
    initConfigSchema,
    PROTOCOL_VERSION,
    type InitConfig,
    type HostSession,
  } from "@projectmate/shared-types";
  import { submitWeb3FormsFeedback } from "./web3forms";

  type Section = "about" | "feedback" | "updates" | "chat" | "issues";

  let config = $state<InitConfig | null>(null);
  let parentOrigin = $state<string | null>(null);
  let parentHref = $state<string | undefined>(undefined);
  let section = $state<Section>("about");
  let loadError = $state<string | null>(null);
  let feedbackBody = $state("");
  let feedbackEmail = $state("");
  let feedbackInteractions = $state("");
  let feedbackStatus = $state<"idle" | "sending" | "sent" | "error">("idle");
  let feedbackScreenshotName = $state<string | null>(null);
  let feedbackScreenshotDataUrl = $state<string | null>(null);
  let feedbackFileHint = $state<string | null>(null);
  let feedbackErrorDetail = $state<string | null>(null);
  let issuesView = $state<"open" | "resolved" | "moderation">("open");
  let issuesLoading = $state(false);
  let issuesError = $state<string | null>(null);
  let openIssues = $state<IssueRecord[]>([]);
  let resolvedIssues = $state<IssueRecord[]>([]);
  let moderationIssues = $state<IssueRecord[]>([]);
  let moderationBusyId = $state<string | null>(null);
  let currentQuote = $state<string | null>(null);
  let hostSession = $state<HostSession | null>(null);
  let hostSessionBridgeActive = $state(false);

  const features = $derived(config?.features);
  const issuesEndpoint = $derived(config?.issuesEndpoint ?? config?.feedbackEndpoint ?? null);
  const web3formsAccessKey = $derived(config?.web3forms?.accessKey?.trim() || null);
  const useWeb3Forms = $derived(!!web3formsAccessKey);
  const feedbackConfigured = $derived(!!issuesEndpoint || !!web3formsAccessKey);
  const canAttachScreenshot = $derived(!!issuesEndpoint && !useWeb3Forms);
  const legacyCanModerate = $derived.by(() => {
    const perms = config?.host?.permissions;
    if (!perms) return false;
    if (!Object.prototype.hasOwnProperty.call(perms, "admin")) return false;
    const adminPerms = perms.admin ?? [];
    return adminPerms.length > 0;
  });

  const canPost = $derived.by(() => {
    if (hostSessionBridgeActive) return hostSession?.capabilities.canPost ?? false;
    return true;
  });

  const canModerate = $derived.by(() => {
    if (hostSessionBridgeActive) return hostSession?.capabilities.canModerate ?? false;
    return legacyCanModerate;
  });

  const canViewModeration = $derived.by(() => {
    if (hostSessionBridgeActive) return hostSession?.capabilities.canViewModeration ?? false;
    return legacyCanModerate;
  });

  const postingAsLabel = $derived.by(() => {
    if (!hostSessionBridgeActive) return null;
    if (!hostSession) return "Guest";
    return hostSession.user.displayName;
  });

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

  $effect(() => {
    if (!config || section !== "issues" || !features?.issues || !issuesEndpoint) return;
    void refreshIssues();
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

  async function submitIssueToEndpoint(c: InitConfig): Promise<void> {
    const endpoint = c.issuesEndpoint ?? c.feedbackEndpoint;
    if (!endpoint) throw new Error("missing issues endpoint");
    const interactions = feedbackInteractionLines();
    const body = {
      projectId: c.projectId,
      message: feedbackBody.trim(),
      email: feedbackEmail || undefined,
      interactions,
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
    const res = await fetch(`${endpoint.replace(/\/$/, "")}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new Error(json?.error || String(res.status));
  }

  function feedbackInteractionLines(): string[] {
    return feedbackInteractions
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function submitFeedback() {
    if (!config) return;
    if (!canPost) {
      feedbackStatus = "error";
      feedbackErrorDetail = hostSessionBridgeActive
        ? "You do not have permission to post from this account."
        : "Posting is not available.";
      return;
    }
    if (!feedbackConfigured) {
      feedbackStatus = "error";
      feedbackErrorDetail = "Feedback is not configured for this workspace.";
      return;
    }
    feedbackStatus = "sending";
    feedbackErrorDetail = null;
    try {
      if (useWeb3Forms) {
        await submitWeb3FormsFeedback(config, {
          message: feedbackBody.trim(),
          email: feedbackEmail || undefined,
          interactions: feedbackInteractionLines(),
          parentHref,
        });
      } else if (issuesEndpoint) {
        await submitIssueToEndpoint(config);
      } else {
        throw new Error("feedback not configured");
      }
      feedbackStatus = "sent";
      feedbackBody = "";
      feedbackInteractions = "";
      feedbackScreenshotDataUrl = null;
      feedbackScreenshotName = null;
      feedbackFileHint = null;
      if (section === "issues" && features?.issues && issuesEndpoint) {
        await refreshIssues();
      }
    } catch (err) {
      feedbackStatus = "error";
      const detail = err instanceof Error ? err.message : null;
      feedbackErrorDetail =
        detail && detail.length < 200
          ? detail
          : "Could not send your report. Check your connection and try again.";
    }
  }

  async function fetchIssueList(view: "open" | "resolved"): Promise<IssueRecord[]> {
    if (!issuesEndpoint || !config) return [];
    const url = new URL(`${issuesEndpoint.replace(/\/$/, "")}/issues`);
    url.searchParams.set("projectId", config.projectId);
    url.searchParams.set("view", view);
    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) throw new Error(`failed to load ${view} issues`);
    const json = issueListResponseSchema.parse(await res.json());
    return json.items;
  }

  async function refreshIssues() {
    if (!issuesEndpoint || !config) return;
    issuesLoading = true;
    issuesError = null;
    try {
      const [open, resolved] = await Promise.all([fetchIssueList("open"), fetchIssueList("resolved")]);
      openIssues = open;
      resolvedIssues = resolved;

      if (canViewModeration) {
        const url = new URL(`${issuesEndpoint.replace(/\/$/, "")}/issues/moderation`);
        url.searchParams.set("projectId", config.projectId);
        const moderationRes = await fetch(url.toString(), {
          method: "GET",
          headers: { "x-projectmate-role": "admin", "x-projectmate-admin": "true" },
        });
        if (moderationRes.ok) {
          const json = issueModerationResponseSchema.parse(await moderationRes.json());
          moderationIssues = json.items;
        } else {
          moderationIssues = [];
        }
      } else {
        moderationIssues = [];
      }
    } catch {
      issuesError = "Could not load issues right now.";
    } finally {
      issuesLoading = false;
    }
  }

  async function updateIssueStatus(issueId: string, status: "approved_open" | "resolved" | "rejected") {
    if (!issuesEndpoint || !canModerate) return;
    moderationBusyId = issueId;
    try {
      const res = await fetch(`${issuesEndpoint.replace(/\/$/, "")}/issues/${issueId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-projectmate-role": "admin",
          "x-projectmate-admin": "true",
        },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(String(res.status));
      await refreshIssues();
    } finally {
      moderationBusyId = null;
    }
  }

  onMount(() => {
    const handler = (event: MessageEvent) => {
      const parsed = hostToIframeMessageSchema.safeParse(event.data);
      if (!parsed.success) return;

      const msg = parsed.data;
      if (msg.type === "PM_HOST_SESSION") {
        hostSessionBridgeActive = true;
        hostSession = msg.payload.session;
        if (config && section === "issues" && config.features?.issues && issuesEndpoint) {
          void refreshIssues();
        }
        return;
      }

      if (msg.type === "PM_CLOSE") {
        loadError = null;
        feedbackBody = "";
        feedbackEmail = "";
        feedbackInteractions = "";
        feedbackStatus = "idle";
        feedbackScreenshotDataUrl = null;
        feedbackScreenshotName = null;
        feedbackFileHint = null;
        feedbackErrorDetail = null;
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
    <div
      class="pm-loading-indicator"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading"
    >
      <span class="pm-loading-spinner" aria-hidden="true"></span>
    </div>
  </div>
{:else}
  <div class="pm-shell" data-loaded="true">
    <aside class="pm-aside">
      <button type="button" class="pm-back" onclick={requestClose} aria-label="Back to site">Back</button>
      <div class="pm-brand">
        <span class="pm-dot" style:background="var(--pm-accent, #6366f1)"></span>
        <div>
          <div class="pm-title">{config.about?.title ?? config.projectId}</div>
          <div class="pm-sub">Community support</div>
        </div>
      </div>
      {#if postingAsLabel !== null}
        <div class="pm-session" class:pm-session--guest={!hostSession}>
          {#if hostSession?.user.avatarUrl}
            <img class="pm-session-avatar" src={hostSession.user.avatarUrl} alt="" />
          {:else}
            <span class="pm-session-avatar pm-session-avatar--placeholder" aria-hidden="true">
              {postingAsLabel.slice(0, 1).toUpperCase()}
            </span>
          {/if}
          <div class="pm-session-copy">
            <div class="pm-session-kicker">Posting as</div>
            <div class="pm-session-name">{postingAsLabel}</div>
            {#if !hostSession}
              <div class="pm-session-hint">Sign in on the host site to post.</div>
            {/if}
          </div>
        </div>
      {/if}
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
            <h2>Workspace details</h2>
            <div class="pm-meta-grid">
              {#if config.host?.name}
                <p class="pm-meta"><strong>Workspace:</strong> {config.host.name}</p>
              {/if}
              {#if config.host?.id}
                <p class="pm-meta"><strong>Workspace ID:</strong> <code>{config.host.id}</code></p>
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
                <p class="pm-meta"><strong>Portfolio mode:</strong> Enabled</p>
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
        <h1>Report an issue</h1>
        <p class="pm-lead">Share what happened, include reproduction steps, and attach a screenshot if needed.</p>
        {#if !feedbackConfigured}
          <p class="pm-note">Issue submission is not configured yet for this workspace.</p>
        {/if}
        <label class="pm-field">
          <span>Message</span>
          <textarea bind:value={feedbackBody} rows="6" placeholder="What went wrong?"></textarea>
        </label>
        <label class="pm-field">
          <span>Email (optional)</span>
          <input type="email" bind:value={feedbackEmail} placeholder="you@example.com" />
        </label>
        <label class="pm-field">
          <span>Interaction notes (optional)</span>
          <textarea
            bind:value={feedbackInteractions}
            rows="4"
            placeholder="One step per line, e.g.&#10;1) Opened dashboard&#10;2) Clicked Save&#10;3) Error appeared"
          ></textarea>
        </label>
        {#if feedbackConfigured && canAttachScreenshot}
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
            disabled={!canPost || !feedbackConfigured || !feedbackBody.trim() || feedbackStatus === "sending"}
            onclick={submitFeedback}
          >
            {feedbackStatus === "sending" ? "Sending…" : "Send"}
          </button>
          {#if feedbackStatus === "sent"}
            <span class="pm-success">Thanks — your issue has been received.</span>
          {:else if feedbackStatus === "error"}
            <span class="pm-err">{feedbackErrorDetail ?? "Could not send right now."}</span>
          {/if}
        </div>
      {:else if section === "updates" && features?.updates}
        <h1>Updates</h1>
        {#if !config.changelog?.length}
          <p class="pm-lead">No updates to show yet.</p>
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
        <p class="pm-lead">Track approved issues, resolved fixes, and moderation updates for this workspace.</p>
        {#if !issuesEndpoint}
          <p class="pm-note">Issue listing is not configured yet for this workspace.</p>
        {:else}
          <label class="pm-field">
            <span>Report a new issue</span>
            <textarea bind:value={feedbackBody} rows="4" placeholder="Share the problem you hit..."></textarea>
          </label>
          <label class="pm-field">
            <span>Interaction notes (optional)</span>
            <textarea bind:value={feedbackInteractions} rows="3" placeholder="Steps to reproduce"></textarea>
          </label>
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
          <div class="pm-actions">
            <button
              type="button"
              class="pm-primary"
              disabled={!canPost || !feedbackBody.trim() || feedbackStatus === "sending"}
              onclick={submitFeedback}
            >
              {feedbackStatus === "sending" ? "Sending…" : "Submit issue"}
            </button>
            {#if feedbackStatus === "sent"}
              <span class="pm-success">Issue submitted. Refreshing list…</span>
            {:else if feedbackStatus === "error"}
              <span class="pm-err">{feedbackErrorDetail ?? "Could not submit issue."}</span>
            {/if}
          </div>

          <div class="pm-tabs">
            <button
              type="button"
              class="pm-tab-btn"
              class:active={issuesView === "open"}
              onclick={() => (issuesView = "open")}
            >
              Open
            </button>
            <button
              type="button"
              class="pm-tab-btn"
              class:active={issuesView === "resolved"}
              onclick={() => (issuesView = "resolved")}
            >
              Resolved
            </button>
            {#if canViewModeration}
              <button
                type="button"
                class="pm-tab-btn"
                class:active={issuesView === "moderation"}
                onclick={() => (issuesView = "moderation")}
              >
                Moderation
              </button>
            {/if}
          </div>

          {#if issuesLoading}
            <p class="pm-note">Loading issues…</p>
          {:else if issuesError}
            <p class="pm-note">{issuesError}</p>
          {:else if issuesView === "open"}
            {#if !openIssues.length}
              <p class="pm-note">No open issues are public yet.</p>
            {:else}
              <div class="pm-issue-list">
                {#each openIssues as item}
                  <article class="pm-issue">
                    <p class="pm-issue-body">{item.message}</p>
                    <p class="pm-issue-meta">{new Date(item.createdAt).toLocaleString()}</p>
                    {#if item.interactions.length}
                      <ul class="pm-issue-steps">
                        {#each item.interactions as step}
                          <li>{step}</li>
                        {/each}
                      </ul>
                    {/if}
                    {#if item.hasScreenshot && item.screenshotPath}
                      <img
                        class="pm-issue-img"
                        src={`${issuesEndpoint.replace(/\/$/, "")}${item.screenshotPath}`}
                        alt="Issue screenshot"
                        loading="lazy"
                      />
                    {/if}
                  </article>
                {/each}
              </div>
            {/if}
          {:else if issuesView === "resolved"}
            {#if !resolvedIssues.length}
              <p class="pm-note">No resolved issues yet.</p>
            {:else}
              <div class="pm-issue-list">
                {#each resolvedIssues as item}
                  <article class="pm-issue">
                    <p class="pm-issue-body">{item.message}</p>
                    <p class="pm-issue-meta">
                      Resolved {item.resolvedAt ? new Date(item.resolvedAt).toLocaleString() : "recently"}
                    </p>
                    {#if item.hasScreenshot && item.screenshotPath}
                      <img
                        class="pm-issue-img"
                        src={`${issuesEndpoint.replace(/\/$/, "")}${item.screenshotPath}`}
                        alt="Resolved issue screenshot"
                        loading="lazy"
                      />
                    {/if}
                  </article>
                {/each}
              </div>
            {/if}
          {:else if !canViewModeration}
            <p class="pm-note">You do not have access to moderation for this workspace.</p>
          {:else if !canModerate}
            <p class="pm-note">Moderation is view-only for your account.</p>
            {#if !moderationIssues.length}
              <p class="pm-note">No moderation items pending.</p>
            {:else}
              <div class="pm-issue-list">
                {#each moderationIssues as item}
                  <article class="pm-issue">
                    <p class="pm-issue-body">{item.message}</p>
                    <p class="pm-issue-meta">Status: {item.status}</p>
                  </article>
                {/each}
              </div>
            {/if}
          {:else}
            {#if !moderationIssues.length}
              <p class="pm-note">No moderation items pending.</p>
            {:else}
              <div class="pm-issue-list">
                {#each moderationIssues as item}
                  <article class="pm-issue">
                    <p class="pm-issue-body">{item.message}</p>
                    <p class="pm-issue-meta">Status: {item.status}</p>
                    {#if item.hasScreenshot}
                      <p class="pm-note">Contains screenshot. Approve before it appears publicly.</p>
                    {/if}
                    <div class="pm-actions">
                      <button
                        type="button"
                        class="pm-primary"
                        disabled={moderationBusyId === item.id}
                        onclick={() => updateIssueStatus(item.id, "approved_open")}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        class="pm-secondary"
                        disabled={moderationBusyId === item.id}
                        onclick={() => updateIssueStatus(item.id, "resolved")}
                      >
                        Resolve
                      </button>
                      <button
                        type="button"
                        class="pm-secondary"
                        disabled={moderationBusyId === item.id}
                        onclick={() => updateIssueStatus(item.id, "rejected")}
                      >
                        Reject
                      </button>
                    </div>
                  </article>
                {/each}
              </div>
            {/if}
          {/if}
        {/if}
      {:else}
        <p class="pm-lead">This section is disabled.</p>
      {/if}
    </main>
  </div>
{/if}

<style>
  :global(html) {
    --pm-bg: #f6f8fa;
    --pm-panel: #ffffff;
    --pm-canvas: #f6f8fa;
    --pm-subtle: #f6f8fa;
    --pm-text: #0f172a;
    --pm-muted: #57606a;
    --pm-border: #d0d7de;
    --pm-shadow: rgba(31, 35, 40, 0.08);
  }

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

  .pm-loading-indicator {
    border: 1px solid var(--pm-border);
    border-radius: 0.85rem;
    background: var(--pm-panel);
    padding: 1.1rem;
    box-shadow: 0 1px 2px var(--pm-shadow);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pm-loading-spinner {
    width: 1rem;
    height: 1rem;
    border-radius: 999px;
    border: 2px solid color-mix(in oklab, var(--pm-accent, #6366f1) 28%, var(--pm-border));
    border-top-color: var(--pm-accent, #6366f1);
    animation: pm-spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  @keyframes pm-spin {
    to {
      transform: rotate(360deg);
    }
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

  .pm-session {
    display: flex;
    gap: 0.65rem;
    align-items: center;
    border: 1px solid var(--pm-border);
    border-radius: 0.75rem;
    background: var(--pm-panel);
    padding: 0.7rem 0.8rem;
    box-shadow: 0 1px 2px var(--pm-shadow);
  }

  .pm-session--guest {
    border-style: dashed;
  }

  .pm-session-avatar {
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .pm-session-avatar--placeholder {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in oklab, var(--pm-accent, #6366f1) 18%, var(--pm-subtle));
    color: var(--pm-text);
    font-size: 0.85rem;
    font-weight: 700;
  }

  .pm-session-copy {
    min-width: 0;
  }

  .pm-session-kicker {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--pm-muted);
  }

  .pm-session-name {
    font-size: 0.9rem;
    font-weight: 700;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pm-session-hint {
    margin-top: 0.15rem;
    font-size: 0.75rem;
    color: var(--pm-muted);
    line-height: 1.35;
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

  .pm-secondary {
    border: 1px solid var(--pm-border);
    border-radius: 0.45rem;
    padding: 0.6rem 1rem;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
    color: var(--pm-text);
    background: var(--pm-panel);
  }

  .pm-secondary:disabled {
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

  .pm-tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .pm-tab-btn {
    border: 1px solid var(--pm-border);
    border-radius: 0.5rem;
    background: var(--pm-panel);
    color: var(--pm-text);
    padding: 0.45rem 0.75rem;
    font: inherit;
    cursor: pointer;
  }

  .pm-tab-btn.active {
    border-color: color-mix(in oklab, var(--pm-accent, #6366f1) 45%, var(--pm-border));
    background: color-mix(in oklab, var(--pm-accent, #6366f1) 12%, var(--pm-panel));
  }

  .pm-issue-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .pm-issue {
    border: 1px solid var(--pm-border);
    border-radius: 0.75rem;
    background: var(--pm-panel);
    padding: 0.9rem 1rem;
    box-shadow: 0 1px 2px var(--pm-shadow);
  }

  .pm-issue-body {
    margin: 0;
    white-space: pre-wrap;
  }

  .pm-issue-meta {
    margin: 0.45rem 0 0;
    font-size: 0.83rem;
    color: var(--pm-muted);
  }

  .pm-issue-steps {
    margin: 0.55rem 0 0;
    padding-left: 1.15rem;
    color: var(--pm-muted);
    font-size: 0.88rem;
  }

  .pm-issue-img {
    display: block;
    margin-top: 0.7rem;
    width: 100%;
    max-width: 520px;
    border: 1px solid var(--pm-border);
    border-radius: 0.6rem;
    background: var(--pm-subtle);
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
