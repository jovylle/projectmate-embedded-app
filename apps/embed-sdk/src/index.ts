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
  changelog?: { version: string; date?: string; bullets?: string[] }[];
  launcher?: {
    position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
    offsetX?: number;
    offsetY?: number;
    label?: string;
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
  const links = raw.links ?? {};
  for (const [k, v] of Object.entries(links)) {
    if (typeof v !== "string" || !isHttpUrl(v)) {
      throw new Error(`ProjectMate.init: links.${k} must be http(s) URL`);
    }
  }
  return normalize(raw);
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
      z-index: 2147483000;
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
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .pm-launcher:hover { transform: translateY(-1px); }
    .pm-launcher:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
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

function init(raw: InitConfigInput): void {
  if (typeof document === "undefined") {
    return;
  }
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

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "pm-launcher";
  const label = config.launcher.label?.trim();
  launcher.textContent = label
    ? label.slice(0, 3)
    : config.projectId.slice(0, 1).toUpperCase();
  launcher.title = "Help & support";
  launcher.setAttribute("aria-haspopup", "dialog");
  launcher.setAttribute("aria-expanded", "false");
  const accent = config.accentColor && config.accentColor.trim() ? config.accentColor.trim() : "#6366f1";
  launcher.style.background = accent;
  positionLauncher(launcher, config);

  const overlay = document.createElement("div");
  overlay.className = "pm-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.hidden = true;

  const frameWrap = document.createElement("div");
  frameWrap.className = "pm-frame-wrap";
  overlay.appendChild(frameWrap);

  shadow.appendChild(launcher);
  shadow.appendChild(overlay);

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
    launcher.setAttribute("aria-expanded", "true");
    lockScroll(true);

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
    launcher.setAttribute("aria-expanded", "false");
    lockScroll(false);
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
    if (data.type === "PM_REQUEST_CLOSE") {
      closeOverlay();
    }
  }

  window.addEventListener("message", onMessage);

  launcher.addEventListener("click", () => {
    if (state.open) closeOverlay();
    else openOverlay();
  });

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
}

export { init };
