/** Generic promise-based yes/no confirmation modal, styled to match the app's other dialogs. */
export class ConfirmDialog {
  private readonly el: HTMLDivElement;
  private readonly dialog: HTMLElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly messageEl: HTMLParagraphElement;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private resolveCallback: ((value: boolean) => void) | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.id = "confirm-backdrop";
    this.el.hidden = true;

    this.dialog = document.createElement("section");
    this.dialog.id = "confirm-dialog";
    this.dialog.setAttribute("role", "alertdialog");

    this.titleEl = document.createElement("h2");
    this.titleEl.className = "confirm-title";

    this.messageEl = document.createElement("p");
    this.messageEl.className = "confirm-message";

    const footer = document.createElement("footer");
    footer.className = "confirm-footer";

    this.cancelBtn = document.createElement("button");
    this.cancelBtn.type = "button";
    this.cancelBtn.className = "confirm-cancel";
    this.cancelBtn.textContent = "Cancel";
    this.cancelBtn.addEventListener("click", () => this.settle(false));

    this.confirmBtn = document.createElement("button");
    this.confirmBtn.type = "button";
    this.confirmBtn.className = "confirm-ok";
    this.confirmBtn.textContent = "Close Anyway";
    this.confirmBtn.addEventListener("click", () => this.settle(true));

    footer.append(this.cancelBtn, this.confirmBtn);
    this.dialog.append(this.titleEl, this.messageEl, footer);
    this.el.appendChild(this.dialog);

    this.el.addEventListener("mousedown", (ev) => {
      if (ev.target === this.el) this.settle(false);
    });

    document.addEventListener("keydown", (ev) => {
      if (this.el.hidden) return;
      if (ev.key === "Escape") this.settle(false);
      if (ev.key === "Enter") this.settle(true);
    });
  }

  get root(): HTMLDivElement {
    return this.el;
  }

  /** Resolves `true` if the user confirms, `false` on cancel/dismiss. */
  confirm(title: string, message: string, confirmLabel = "Close Anyway"): Promise<boolean> {
    this.titleEl.textContent = title;
    this.messageEl.textContent = message;
    this.confirmBtn.textContent = confirmLabel;
    this.el.hidden = false;
    this.confirmBtn.focus();
    const { promise, resolve } = Promise.withResolvers<boolean>();
    this.resolveCallback = resolve;
    return promise;
  }

  private settle(value: boolean): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    const resolve = this.resolveCallback;
    this.resolveCallback = null;
    resolve?.(value);
  }
}
