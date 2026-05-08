/** Protocol version — keep in sync with @projectmate/shared-types */
const PROTOCOL_VERSION = 1 as const;

export type InitConfigInput = {
  projectId: string;
  appUrl: string;
  github?: string;
  about?: { title: string; description: string };
  links?: Record<string, string>;
  customSections?: { title: string; content: string }[];
  features?: {
    chat?: boolean;
    feedback?: boolean;
    updates?: boolean;
    issues?: boolean;
    about?: boolean;
  };
  theme?: "light" | "dark" | "auto";
  accentColor?: string;
  feedbackEndpoint?: string;
  web3forms?: {
    accessKey: string;
    subject?: string;
    fromName?: string;
  };
  changelog?: { version: string; date?: string; bullets?: string[] }[];
  launcher?: {
    /** When true, the floating launcher button is not rendered. Pair with `autoOpen` or `ProjectMate.open()`. */
    hidden?: boolean;
    position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
    offsetX?: number;
    offsetY?: number;
    label?: string;
  };
  /** If the current URL matches any rule, open the overlay (also on `hashchange` / `popstate`). Rules are OR'd together. */
  autoOpen?: {
    hash?: string;
    query?: { name: string; value?: string };
    path?: string;
    pathMatch?: "exact" | "prefix";
  };
};

type NormalizedConfig = InitConfigInput & {
  links: Record<string, string>;
  customSections: { title: string; content: string }[];
  features: Required<NonNullable<InitConfigInput["features"]>>;
  changelog: { version: string; date?: string; bullets: string[] }[];
  launcher: Required<NonNullable<InitConfigInput["launcher"]>> & { label?: string };
};

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function normalize(raw: InitConfigInput): NormalizedConfig {
  const features = {
    chat: raw.features?.chat ?? false,
    feedback: raw.features?.feedback ?? true,
    updates: raw.features?.updates ?? true,
    issues: raw.features?.issues ?? false,
    about: raw.features?.about ?? true,
  };
  const launcher = {
    hidden: raw.launcher?.hidden ?? false,
    position: raw.launcher?.position ?? "bottom-right",
    offsetX: raw.launcher?.offsetX ?? 16,
    offsetY: raw.launcher?.offsetY ?? 16,
    label: raw.launcher?.label,
  };
  const changelog = (raw.changelog ?? []).map((e) => ({
    version: e.version,
    date: e.date,
    bullets: e.bullets ?? [],
  }));
  return {
    ...raw,
    links: raw.links ?? {},
    customSections: raw.customSections ?? [],
    features,
    changelog,
    launcher,
    theme: raw.theme ?? "auto",
    autoOpen: raw.autoOpen,
  };
}

function assertConfig(raw: InitConfigInput): NormalizedConfig {
  if (!raw || typeof raw !== "object") throw new Error("ProjectMate.init: config object required");
  if (!raw.projectId || typeof raw.projectId !== "string") {
    throw new Error("ProjectMate.init: projectId (string) required");
  }
  if (!raw.appUrl || typeof raw.appUrl !== "string" || !isHttpUrl(raw.appUrl)) {
    throw new Error("ProjectMate.init: appUrl must be http(s) URL");
  }
  if (raw.feedbackEndpoint !== undefined) {
    if (typeof raw.feedbackEndpoint !== "string" || !isHttpUrl(raw.feedbackEndpoint)) {
      throw new Error("ProjectMate.init: feedbackEndpoint must be http(s) URL when set");
    }
  }
  if (raw.web3forms !== undefined) {
    const w = raw.web3forms;
    if (!w || typeof w !== "object") {
      throw new Error("ProjectMate.init: web3forms must be an object when set");
    }
    if (typeof w.accessKey !== "string" || !w.accessKey.trim()) {
      throw new Error("ProjectMate.init: web3forms.accessKey (string) required");
    }
    if (raw.feedbackEndpoint) {
      console.warn(
        "ProjectMate.init: both `web3forms` and `feedbackEndpoint` set; web3forms takes precedence."
      );
    }
  }
  const links = raw.links ?? {};
  for (const [k, v] of Object.entries(links)) {
    if (typeof v !== "string" || !isHttpUrl(v)) {
      throw new Error(`ProjectMate.init: links.${k} must be http(s) URL`);
    }
  }
  if (raw.autoOpen?.path !== undefined) {
    const p = raw.autoOpen.path;
    if (typeof p !== "string" || !p.startsWith("/")) {
      throw new Error("ProjectMate.init: autoOpen.path must start with /");
    }
    if (p === "/" && (raw.autoOpen.pathMatch ?? "prefix") === "prefix") {
      throw new Error("ProjectMate.init: autoOpen.path '/' cannot use pathMatch 'prefix'");
    }
  }
  return normalize(raw);
}

function stripHash(s: string): string {
  return s.startsWith("#") ? s.slice(1) : s;
}

function trimPath(p: string): string {
  if (p.length > 1 && p.endsWith("/")) return p.replace(/\/+$/, "");
  return p;
}

/** True if any configured `autoOpen` rule matches the current `window.location` (OR semantics). */
function urlMatchesAutoOpen(auto: NonNullable<InitConfigInput["autoOpen"]>): boolean {
  let matched = false;

  if (auto.hash !== undefined && auto.hash !== "") {
    const want = stripHash(auto.hash);
    const cur = stripHash(window.location.hash || "");
    if (want !== "" && cur === want) matched = true;
  }

  if (auto.query?.name) {
    const params = new URLSearchParams(window.location.search);
    const v = params.get(auto.query.name);
    if (v !== null && v !== "") {
      if (auto.query.value !== undefined) {
        if (v === auto.query.value) matched = true;
      } else {
        matched = true;
      }
    }
  }

  if (auto.path !== undefined && auto.path !== "") {
    const pathname = trimPath(window.location.pathname);
    const want = trimPath(auto.path);
    const mode = auto.pathMatch ?? "prefix";
    if (mode === "exact") {
      if (pathname === want) matched = true;
    } else {
      if (pathname === want || pathname.startsWith(`${want}/`)) matched = true;
    }
  }

  return matched;
}

type EmbedState = {
  config: NormalizedConfig;
  iframeOrigin: string;
  hostElement: HTMLElement;
  shadow: ShadowRoot;
  overlay: HTMLElement;
  iframe: HTMLIFrameElement | null;
  open: boolean;
  previouslyFocused: HTMLElement | null;
};

const ATTR = "data-projectmate-root";

function createStyles(): string {
  return `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .pm-launcher {
      position: fixed;
      z-index: 2147483002;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      border: none;
      border-radius: 999px;
      width: 52px;
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
      color: #fff;
      font-weight: 700;
      font-size: 14px;
      letter-spacing: 0.02em;
      transition: transform 0.15s ease, box-shadow 0.15s ease, font-size 0.18s ease;
    }
    .pm-launcher:hover { transform: translateY(-1px); }
    .pm-launcher:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
    .pm-launcher--open {
      font-size: 22px;
      line-height: 1;
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.32), inset 0 0 0 2px rgba(255, 255, 255, 0.35);
    }
    .pm-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483001;
      background: rgba(15, 23, 42, 0.45);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease;
      display: flex;
      align-items: stretch;
      justify-content: stretch;
    }
    .pm-overlay.pm-open {
      opacity: 1;
      pointer-events: auto;
    }
    .pm-frame-wrap {
      flex: 1;
      margin: 0;
      padding: 0;
      display: flex;
    }
    .pm-frame {
      flex: 1;
      width: 100%;
      height: 100%;
      border: 0;
      background: #0b0f14;
    }
  `;
}

function positionLauncher(btn: HTMLButtonElement, cfg: NormalizedConfig): void {
  const { position, offsetX, offsetY } = cfg.launcher;
  btn.style.left = "auto";
  btn.style.right = "auto";
  btn.style.top = "auto";
  btn.style.bottom = "auto";
  if (position === "bottom-right") {
    btn.style.right = `${offsetX}px`;
    btn.style.bottom = `${offsetY}px`;
  } else if (position === "bottom-left") {
    btn.style.left = `${offsetX}px`;
    btn.style.bottom = `${offsetY}px`;
  } else if (position === "top-right") {
    btn.style.right = `${offsetX}px`;
    btn.style.top = `${offsetY}px`;
  } else {
    btn.style.left = `${offsetX}px`;
    btn.style.top = `${offsetY}px`;
  }
}

function lockScroll(lock: boolean): void {
  const b = document.body;
  if (lock) {
    b.dataset.pmScroll = b.style.overflow || "";
    b.style.overflow = "hidden";
  } else if (b.dataset.pmScroll !== undefined) {
    b.style.overflow = b.dataset.pmScroll;
    delete b.dataset.pmScroll;
  }
}

type InertRestore = { el: HTMLElement; prev: boolean };

function freezeBackground(hostElement: HTMLElement, on: boolean, restores: { list: InertRestore[] }): void {
  if (on) {
    restores.list = [];
    for (const node of Array.from(document.body.children)) {
      if (!(node instanceof HTMLElement) || node === hostElement) continue;
      restores.list.push({ el: node, prev: node.inert });
      node.inert = true;
    }
  } else {
    for (const { el, prev } of restores.list) {
      el.inert = prev;
    }
    restores.list = [];
  }
}

type EmbedAPI = {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
};

let currentInstance: EmbedAPI | null = null;
let pendingAction: "open" | "close" | "toggle" | null = null;

function applyPending(api: EmbedAPI): void {
  if (pendingAction === "open") api.open();
  else if (pendingAction === "close") api.close();
  else if (pendingAction === "toggle") api.toggle();
  pendingAction = null;
}

function scheduleBootstrap(raw: InitConfigInput): void {
  if (typeof document === "undefined") return;

  const run = () => bootstrap(raw);
  const ric = (
    globalThis as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }
  ).requestIdleCallback;

  const enqueue = () => {
    if (typeof ric === "function") ric(() => run(), { timeout: 2500 });
    else queueMicrotask(run);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enqueue, { once: true });
  } else {
    enqueue();
  }
}

function bootstrap(raw: InitConfigInput): void {
  if (document.querySelector(`[${ATTR}]`)) {
    console.warn("ProjectMate.init: already initialized");
    return;
  }

  const config = assertConfig(raw);
  const iframeOrigin = new URL(config.appUrl).origin;
  const parentOrigin = window.location.origin;

  const hostElement = document.createElement("div");
  hostElement.setAttribute(ATTR, "");
  document.body.appendChild(hostElement);

  const shadow = hostElement.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = createStyles();
  shadow.appendChild(style);

  const launcherHidden = config.launcher.hidden === true;
  const launcher = document.createElement("button");
  const launcherLabelText = (() => {
    const label = config.launcher.label?.trim();
    return label ? label.slice(0, 3) : config.projectId.slice(0, 1).toUpperCase();
  })();
  if (!launcherHidden) {
    launcher.type = "button";
    launcher.className = "pm-launcher";
    launcher.textContent = launcherLabelText;
    launcher.title = "Help & support";
    launcher.setAttribute("aria-haspopup", "dialog");
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-label", "Open help");
    const accent = config.accentColor && config.accentColor.trim() ? config.accentColor.trim() : "#6366f1";
    launcher.style.background = accent;
    positionLauncher(launcher, config);
  }

  const overlay = document.createElement("div");
  overlay.className = "pm-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.hidden = true;

  const frameWrap = document.createElement("div");
  frameWrap.className = "pm-frame-wrap";
  overlay.appendChild(frameWrap);

  if (!launcherHidden) shadow.appendChild(launcher);
  shadow.appendChild(overlay);

  if (launcherHidden && !config.autoOpen) {
    console.warn(
      "ProjectMate.init: launcher.hidden is true and no `autoOpen` rule is set. " +
        "Call ProjectMate.open() programmatically, or the overlay cannot be opened."
    );
  }

  const inertRestores: { list: InertRestore[] } = { list: [] };

  const state: EmbedState = {
    config,
    iframeOrigin,
    hostElement,
    shadow,
    overlay,
    iframe: null,
    open: false,
    previouslyFocused: null,
  };

  function sendToIframe(msg: unknown): void {
    const iframe = state.iframe;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(msg, iframeOrigin);
  }

  function sendConfigToIframe(): void {
    const serializable = JSON.parse(JSON.stringify(config)) as InitConfigInput;
    sendToIframe({
      v: PROTOCOL_VERSION,
      type: "PM_CONFIG",
      payload: {
        config: serializable,
        parentOrigin,
        parentHref: window.location.href,
      },
    });
  }

  function openOverlay(): void {
    if (state.open) return;
    state.previouslyFocused = document.activeElement as HTMLElement | null;
    state.open = true;
    overlay.hidden = false;
    overlay.classList.add("pm-open");
    if (!launcherHidden) {
      launcher.setAttribute("aria-expanded", "true");
      launcher.setAttribute("aria-label", "Back to site");
      launcher.title = "Back to site (Esc)";
      launcher.textContent = "\u2190";
      launcher.classList.add("pm-launcher--open");
    }
    lockScroll(true);
    freezeBackground(hostElement, true, inertRestores);

    if (!state.iframe) {
      const iframe = document.createElement("iframe");
      iframe.className = "pm-frame";
      iframe.src = config.appUrl;
      iframe.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      );
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      frameWrap.appendChild(iframe);
      state.iframe = iframe;

      iframe.addEventListener("load", () => {
        sendConfigToIframe();
      });
    } else {
      sendConfigToIframe();
    }

    requestAnimationFrame(() => {
      state.iframe?.focus();
    });
  }

  function closeOverlay(): void {
    if (!state.open) return;
    state.open = false;
    overlay.classList.remove("pm-open");
    overlay.hidden = true;
    if (!launcherHidden) {
      launcher.setAttribute("aria-expanded", "false");
      launcher.setAttribute("aria-label", "Open help");
      launcher.title = "Help & support";
      launcher.textContent = launcherLabelText;
      launcher.classList.remove("pm-launcher--open");
    }
    lockScroll(false);
    freezeBackground(hostElement, false, inertRestores);
    sendToIframe({ v: PROTOCOL_VERSION, type: "PM_CLOSE" });
    state.previouslyFocused?.focus?.();
    state.previouslyFocused = null;
  }

  function onMessage(event: MessageEvent): void {
    if (event.source !== state.iframe?.contentWindow) return;
    if (event.origin !== iframeOrigin) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.v !== PROTOCOL_VERSION) return;
    if (data.type === "PM_READY") {
      return;
    }
    if (data.type === "PM_REQUEST_CLOSE") {
      closeOverlay();
    }
  }

  window.addEventListener("message", onMessage);

  if (!launcherHidden) {
    launcher.addEventListener("click", () => {
      if (state.open) closeOverlay();
      else openOverlay();
    });
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeOverlay();
  });

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && state.open) {
        e.preventDefault();
        closeOverlay();
      }
    },
    true
  );

  function maybeAutoOpenFromUrl(): void {
    const rule = config.autoOpen;
    if (!rule) return;
    if (!urlMatchesAutoOpen(rule)) return;
    if (!state.open) openOverlay();
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      maybeAutoOpenFromUrl();
    });
  });

  window.addEventListener("hashchange", maybeAutoOpenFromUrl);
  window.addEventListener("popstate", maybeAutoOpenFromUrl);

  const api: EmbedAPI = {
    open: openOverlay,
    close: closeOverlay,
    toggle: () => (state.open ? closeOverlay() : openOverlay()),
    isOpen: () => state.open,
  };
  currentInstance = api;
  applyPending(api);
}

/** Public entry: SSR-safe, deferred until DOM ready and idle when available. */
function init(raw: InitConfigInput): void {
  if (typeof document === "undefined") return;
  scheduleBootstrap(raw);
}

/** Open the overlay programmatically. Queues until init/bootstrap completes. */
function open(): void {
  if (currentInstance) currentInstance.open();
  else pendingAction = "open";
}

/** Close the overlay programmatically. Queues until init/bootstrap completes. */
function close(): void {
  if (currentInstance) currentInstance.close();
  else pendingAction = "close";
}

/** Toggle the overlay. Queues until init/bootstrap completes. */
function toggle(): void {
  if (currentInstance) currentInstance.toggle();
  else pendingAction = "toggle";
}

/** Whether the overlay is currently open. Returns false before bootstrap. */
function isOpen(): boolean {
  return currentInstance ? currentInstance.isOpen() : false;
}

export { init, open, close, toggle, isOpen };
