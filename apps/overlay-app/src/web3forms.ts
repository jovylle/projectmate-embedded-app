import type { InitConfig } from "@projectmate/shared-types";

const WEB3FORMS_SUBMIT_URL = "https://api.web3forms.com/submit";

export type Web3FormsFeedbackInput = {
  message: string;
  email?: string;
  interactions: string[];
  parentHref?: string;
};

type Web3FormsResponse = {
  success?: boolean;
  message?: string;
};

export function formatWeb3FormsMessage(
  projectId: string,
  input: Web3FormsFeedbackInput,
  meta: { userAgent: string; viewport: { w: number; h: number } }
): string {
  const lines: string[] = [`Project: ${projectId}`, "", input.message.trim()];
  if (input.email?.trim()) {
    lines.push("", `Reply-to: ${input.email.trim()}`);
  }
  if (input.interactions.length) {
    lines.push("", "Interactions:");
    for (const step of input.interactions) {
      lines.push(`- ${step}`);
    }
  }
  lines.push(
    "",
    "Meta:",
    `Page: ${input.parentHref ?? "(unknown)"}`,
    `Viewport: ${meta.viewport.w}×${meta.viewport.h}`,
    `UA: ${meta.userAgent}`
  );
  return lines.join("\n");
}

export async function submitWeb3FormsFeedback(
  config: InitConfig,
  input: Web3FormsFeedbackInput
): Promise<void> {
  const w = config.web3forms;
  if (!w?.accessKey) throw new Error("web3forms not configured");

  const body = formatWeb3FormsMessage(config.projectId, input, {
    userAgent: navigator.userAgent,
    viewport: { w: window.innerWidth, h: window.innerHeight },
  });

  const payload = {
    access_key: w.accessKey,
    subject: w.subject ?? `ProjectMate feedback — ${config.projectId}`,
    from_name: w.fromName ?? config.about?.title ?? config.projectId,
    message: body,
    ...(input.email?.trim() ? { replyto: input.email.trim() } : {}),
  };

  const res = await fetch(WEB3FORMS_SUBMIT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => null)) as Web3FormsResponse | null;
  if (!res.ok || !json?.success) {
    throw new Error(json?.message ?? `Web3Forms request failed (${res.status})`);
  }
}
