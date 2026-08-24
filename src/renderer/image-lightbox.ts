export class ImageLightbox {
  public el: HTMLDivElement;
  private imgEl: HTMLImageElement;
  private titleEl: HTMLSpanElement;
  private metaEl: HTMLSpanElement;
  private isOpen = false;

  constructor() {
    this.el = document.createElement("div");
    this.el.id = "image-lightbox-modal";
    this.el.className = "lightbox-backdrop";
    this.el.setAttribute("hidden", "true");

    this.el.innerHTML = `
      <div class="lightbox-card">
        <div class="lightbox-header">
          <div class="lightbox-title-wrap">
            <span class="lightbox-title">Image Preview</span>
            <span class="lightbox-meta"></span>
          </div>
          <button type="button" class="lightbox-close" title="Close (Esc)">&times;</button>
        </div>
        <div class="lightbox-body">
          <img class="lightbox-img" src="" alt="Full resolution preview" />
        </div>
      </div>
    `;

    this.imgEl = this.el.querySelector(".lightbox-img") as HTMLImageElement;
    this.titleEl = this.el.querySelector(".lightbox-title") as HTMLSpanElement;
    this.metaEl = this.el.querySelector(".lightbox-meta") as HTMLSpanElement;

    const closeBtn = this.el.querySelector(".lightbox-close") as HTMLButtonElement;
    closeBtn.addEventListener("click", () => this.close());

    this.el.addEventListener("click", (ev) => {
      if (ev.target === this.el) {
        this.close();
      }
    });

    document.addEventListener("keydown", (ev) => {
      if (this.isOpen && ev.key === "Escape") {
        this.close();
      }
    });

    document.body.appendChild(this.el);
  }

  public open(imageSrc: string, fileName?: string, dimensions?: { width: number; height: number }): void {
    this.imgEl.src = imageSrc;
    this.titleEl.textContent = fileName || "Attachment Preview";
    if (dimensions && dimensions.width && dimensions.height) {
      this.metaEl.textContent = `${dimensions.width} × ${dimensions.height}px`;
    } else {
      this.metaEl.textContent = "";
    }
    this.isOpen = true;
    this.el.removeAttribute("hidden");
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.setAttribute("hidden", "true");
    this.imgEl.src = "";
  }
}
