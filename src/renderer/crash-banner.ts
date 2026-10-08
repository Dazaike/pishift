import { safeAnimate, springPresets } from "./motion-utils";

export type CrashChoice = "reopen" | "dismiss";

const HIDDEN_Y = -80;

/** Non-blocking notice that slides down from the top of the window after a crash. */
export class CrashBanner {
  /** Resolves once the user picks. No backdrop: the app underneath stays usable. */
  show(tabCount: number): Promise<CrashChoice> {
    const { promise, resolve } = Promise.withResolvers<CrashChoice>();

    const el = document.createElement("div");
    el.id = "crash-banner";
    el.setAttribute("role", "alertdialog");
    el.setAttribute("aria-live", "assertive");

    const icon = document.createElement("span");
    icon.className = "crash-banner-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "\u26a0";

    const text = document.createElement("div");
    text.className = "crash-banner-text";
    const title = document.createElement("strong");
    title.textContent = "We detected a crash.";
    const detail = document.createElement("span");
    detail.textContent = tabCount > 1 ? `Do you want to reopen your ${tabCount} tabs?` : "Do you want to reopen your tab?";
    text.append(title, detail);

    const reopenBtn = document.createElement("button");
    reopenBtn.type = "button";
    reopenBtn.className = "crash-banner-reopen";
    reopenBtn.textContent = tabCount > 1 ? "Reopen tabs" : "Reopen tab";

    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "crash-banner-dismiss";
    dismissBtn.textContent = "Dismiss";

    el.append(icon, text, reopenBtn, dismissBtn);

    let settled = false;
    const settle = (choice: CrashChoice): void => {
      if (settled) return;
      settled = true;
      safeAnimate(el, { y: HIDDEN_Y, opacity: 0 }, { duration: 0.16, ease: "easeOut" }).then(() => el.remove());
      resolve(choice);
    };

    reopenBtn.addEventListener("click", () => settle("reopen"));
    dismissBtn.addEventListener("click", () => settle("dismiss"));
    // Scoped to the banner: a window-level Enter/Escape would steal keys from the terminal and composer.
    // Enter needs no handler; the focused Reopen button activates natively.
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      settle("dismiss");
    });

    document.body.appendChild(el);
    safeAnimate(el, { y: [HIDDEN_Y, 0], opacity: [0, 1] }, springPresets.smooth as unknown as Record<string, unknown>);
    reopenBtn.focus();
    return promise;
  }
}
