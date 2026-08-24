export type CustomModelEntry = {
  id: string;
  name: string;
  provider: string;
  iconUrl?: string;
};

export type ProviderIconSvg = string;

export const PROVIDER_ICONS: Record<string, string> = {
  google: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm3.8 14.5a5.5 5.5 0 0 1-7.6-1.3 5.5 5.5 0 0 1 1.3-7.6 5.4 5.4 0 0 1 6.3 0l-1.4 1.4a3.5 3.5 0 0 0-4.1 0 3.6 3.6 0 0 0-.9 4.9 3.5 3.5 0 0 0 4.9.9 3.4 3.4 0 0 0 1.3-2.4H12v-2h5.8a5 5 0 0 1 0 1.2 5.5 5.5 0 0 1-2 4.9z"/></svg>`,
  "google-antigravity": `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zm0 8.7L4.7 7.5 12 3.9l7.3 3.6L12 10.7zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
  "google-vertex": `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zm0 8.7L4.7 7.5 12 3.9l7.3 3.6L12 10.7zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
  anthropic: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M13.8 3h-3.6L4.5 21h3.4l1.2-3.6h5.8l1.2 3.6h3.4L13.8 3zm-3.7 11.6l1.9-5.7 1.9 5.7h-3.8z"/></svg>`,
  openai: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20.5 9.8a5.5 5.5 0 0 0-.5-4.4 5.6 5.6 0 0 0-5.6-2.7 5.6 5.6 0 0 0-4.3 2.1 5.5 5.5 0 0 0-4.4 2.8 5.6 5.6 0 0 0 .7 6.1 5.5 5.5 0 0 0 .5 4.4 5.6 5.6 0 0 0 5.6 2.7 5.6 5.6 0 0 0 4.3-2.1 5.5 5.5 0 0 0 4.4-2.8 5.6 5.6 0 0 0-.7-6.1zm-8.5 10.7a3.8 3.8 0 0 1-2.4-.9l1.2-1.2a2.1 2.1 0 0 0 2.2.3l.7 1.8h-1.7zm5.5-2.6a3.8 3.8 0 0 1-2 .1l-.6-1.8a2.1 2.1 0 0 0 1.2-1.9v-1.7l1.7.6a3.8 3.8 0 0 1-.3 4.7zm1.3-6.5l-1.7-.6a2.1 2.1 0 0 0-1-1.9l.6-1.8a3.8 3.8 0 0 1 2.1 4.3zm-7.6-5.5a3.8 3.8 0 0 1 2.4.9l-1.2 1.2a2.1 2.1 0 0 0-2.2-.3l-.7-1.8h1.7zm-5.5 2.6a3.8 3.8 0 0 1 2-.1l.6 1.8a2.1 2.1 0 0 0-1.2 1.9v1.7l-1.7-.6a3.8 3.8 0 0 1 .3-4.7zm-1.3 6.5l1.7.6a2.1 2.1 0 0 0 1 1.9l-.6 1.8a3.8 3.8 0 0 1-2.1-4.3z"/></svg>`,
  "openai-codex": `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20.5 9.8a5.5 5.5 0 0 0-.5-4.4 5.6 5.6 0 0 0-5.6-2.7 5.6 5.6 0 0 0-4.3 2.1 5.5 5.5 0 0 0-4.4 2.8 5.6 5.6 0 0 0 .7 6.1 5.5 5.5 0 0 0 .5 4.4 5.6 5.6 0 0 0 5.6 2.7 5.6 5.6 0 0 0 4.3-2.1 5.5 5.5 0 0 0 4.4-2.8 5.6 5.6 0 0 0-.7-6.1z"/></svg>`,
  deepseek: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5h-2v-2h2v2zm0-4h-2V7h2v5.5z"/></svg>`,
  "xai-oauth": `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18.9 3h3.2L15.1 11l8.2 10h-6.4l-5-6.5L6.2 21H3l7.4-8.5L2.5 3h6.6l4.5 5.9L18.9 3zm-1.1 16.1h1.8L8.3 4.8H6.4l11.4 14.3z"/></svg>`,
  openrouter: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2L2 8.5v7L12 22l10-6.5v-7L12 2zm0 3.3l6.5 4.2L12 13.7 5.5 9.5 12 5.3zM4.5 11.2l6.5 4.2v5.3l-6.5-4.2v-5.3zm15 0v5.3l-6.5 4.2v-5.3l6.5-4.2z"/></svg>`,
  nanogpt: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
  devin: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`,
  litellm: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 6h16v3H4zm0 5h16v3H4zm0 5h10v3H4z"/></svg>`,
  generic: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.5h-2v-2h2v2zm0-4h-2V7h2v5.5z"/></svg>`,
};

export function getProviderIcon(provider: string): string {
  const p = (provider ?? "").toLowerCase();
  for (const [key, icon] of Object.entries(PROVIDER_ICONS)) {
    if (p.includes(key)) return icon;
  }
  return PROVIDER_ICONS.generic;
}
