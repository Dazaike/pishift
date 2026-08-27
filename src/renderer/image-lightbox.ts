/** Bright, high-contrast marker colors — the only two the annotation tool offers. */
const DRAW_COLORS: Record<"red" | "green", string> = {
  red: "#ff1f3d",
  green: "#26ff6b",
};

const STROKE_WIDTH_CSS_PX = 4;
const ERASER_WIDTH_CSS_PX = 20;
const MAX_UNDO_STEPS = 50;

export class ImageLightbox {
  public el: HTMLDivElement;
  private imgEl: HTMLImageElement;
  private titleEl: HTMLSpanElement;
  private metaEl: HTMLSpanElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private drawToggle: HTMLButtonElement;
  private toolGroup: HTMLDivElement;
  private eraserBtn: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private swatchButtons: HTMLButtonElement[];
  private isOpen = false;
  private drawMode = false;
  private isDrawing = false;
  private eraserActive = false;
  private activeColor: "red" | "green" = "red";
  private undoStack: ImageData[] = [];
  private hasStrokes = false;
  private lastX = 0;
  private lastY = 0;
  private editPath: string | null = null;
  private onCloseCallback: (() => void) | null = null;

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
          <div class="lightbox-tools">
            <button type="button" class="lightbox-tool-toggle" title="Draw on image">&#9998; Draw</button>
            <div class="lightbox-tool-group" hidden>
              <button type="button" class="lightbox-swatch" data-color="red" title="Red"></button>
              <button type="button" class="lightbox-swatch" data-color="green" title="Green"></button>
              <button type="button" class="lightbox-eraser" title="Eraser (E)">&#9003;</button>
              <button type="button" class="lightbox-undo" title="Undo (Ctrl+Z)">&#8634;</button>
            </div>
          </div>
          <button type="button" class="lightbox-close" title="Close (Esc)">&times;</button>
        </div>
        <div class="lightbox-body">
          <div class="lightbox-canvas-wrap">
            <img class="lightbox-img" src="" alt="Full resolution preview" />
            <canvas class="lightbox-draw-canvas" hidden></canvas>
          </div>
        </div>
      </div>
    `;

    this.imgEl = this.el.querySelector(".lightbox-img") as HTMLImageElement;
    this.titleEl = this.el.querySelector(".lightbox-title") as HTMLSpanElement;
    this.metaEl = this.el.querySelector(".lightbox-meta") as HTMLSpanElement;
    this.canvas = this.el.querySelector(".lightbox-draw-canvas") as HTMLCanvasElement;
    this.drawToggle = this.el.querySelector(".lightbox-tool-toggle") as HTMLButtonElement;
    this.toolGroup = this.el.querySelector(".lightbox-tool-group") as HTMLDivElement;
    this.eraserBtn = this.el.querySelector(".lightbox-eraser") as HTMLButtonElement;
    this.undoBtn = this.el.querySelector(".lightbox-undo") as HTMLButtonElement;
    this.swatchButtons = Array.from(this.el.querySelectorAll<HTMLButtonElement>(".lightbox-swatch"));

    for (const [color, hex] of Object.entries(DRAW_COLORS) as Array<["red" | "green", string]>) {
      const btn = this.swatchButtons.find((b) => b.dataset.color === color);
      if (btn) btn.style.background = hex;
    }
    this.updateSwatchSelection();

    const closeBtn = this.el.querySelector(".lightbox-close") as HTMLButtonElement;
    closeBtn.addEventListener("click", () => this.close());

    this.el.addEventListener("click", (ev) => {
      if (ev.target === this.el) this.close();
    });

    this.drawToggle.addEventListener("click", () => this.setDrawMode(!this.drawMode));
    this.eraserBtn.addEventListener("click", () => this.setEraser(!this.eraserActive));
    this.undoBtn.addEventListener("click", () => this.undo());
    for (const btn of this.swatchButtons) {
      btn.addEventListener("click", () => {
        const color = btn.dataset.color as "red" | "green";
        this.activeColor = color;
        this.setEraser(false);
        this.updateSwatchSelection();
      });
    }

    this.canvas.addEventListener("pointerdown", (ev) => this.onPointerDown(ev));
    this.canvas.addEventListener("pointermove", (ev) => this.onPointerMove(ev));
    this.canvas.addEventListener("pointerup", (ev) => this.onPointerUp(ev));
    this.canvas.addEventListener("pointercancel", (ev) => this.onPointerUp(ev));
    this.imgEl.addEventListener("load", () => {
      if (this.drawMode) this.syncCanvasSize();
    });

    document.addEventListener("keydown", (ev) => {
      if (!this.isOpen) return;
      if (ev.key === "Escape") {
        this.close();
        return;
      }
      if (!this.drawMode) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        this.undo();
        return;
      }
      if (ev.key.toLowerCase() === "e" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        const target = ev.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        ev.preventDefault();
        this.setEraser(!this.eraserActive);
      }
    });

    document.body.appendChild(this.el);
  }

  /**
   * @param path Filesystem path backing this image; when present, drawn
   * strokes are baked into the file on close so submission picks them up.
   */
  public open(
    imageSrc: string,
    fileName?: string,
    dimensions?: { width: number; height: number },
    path?: string,
    onClose?: () => void,
  ): void {
    this.imgEl.src = imageSrc;
    this.titleEl.textContent = fileName || "Attachment Preview";
    if (dimensions && dimensions.width && dimensions.height) {
      this.metaEl.textContent = `${dimensions.width} × ${dimensions.height}px`;
    } else {
      this.metaEl.textContent = "";
    }
    this.editPath = path ?? null;
    this.onCloseCallback = onClose ?? null;
    this.isOpen = true;
    this.el.removeAttribute("hidden");
    this.setDrawMode(false);
  }

  public close(): void {
    if (!this.isOpen) return;
    const callback = this.onCloseCallback;
    void this.persistEdits().finally(() => callback?.());
    this.isOpen = false;
    this.el.setAttribute("hidden", "true");
    this.imgEl.src = "";
    this.setDrawMode(false);
    this.editPath = null;
    this.onCloseCallback = null;
  }

  private setDrawMode(on: boolean): void {
    this.drawMode = on && !!this.editPath;
    this.drawToggle.classList.toggle("active", this.drawMode);
    this.toolGroup.hidden = !this.drawMode;
    this.canvas.hidden = !this.drawMode;
    if (this.drawMode) {
      this.syncCanvasSize();
    } else {
      this.setEraser(false);
    }
  }

  private syncCanvasSize(): void {
    const w = this.imgEl.naturalWidth || this.imgEl.offsetWidth;
    const h = this.imgEl.naturalHeight || this.imgEl.offsetHeight;
    if (!w || !h) return;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx = this.canvas.getContext("2d");
      this.undoStack = [];
      this.hasStrokes = false;
    }
  }

  private updateSwatchSelection(): void {
    for (const btn of this.swatchButtons) {
      btn.classList.toggle("selected", !this.eraserActive && btn.dataset.color === this.activeColor);
    }
    this.eraserBtn.classList.toggle("selected", this.eraserActive);
  }

  private setEraser(on: boolean): void {
    this.eraserActive = on;
    this.updateSwatchSelection();
  }

  private canvasPoint(ev: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return { x: (ev.clientX - rect.left) * scaleX, y: (ev.clientY - rect.top) * scaleY };
  }

  private onPointerDown(ev: PointerEvent): void {
    if (!this.drawMode || !this.ctx) return;
    ev.preventDefault();
    this.canvas.setPointerCapture(ev.pointerId);
    this.undoStack.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    if (this.undoStack.length > MAX_UNDO_STEPS) this.undoStack.shift();
    const { x, y } = this.canvasPoint(ev);
    this.lastX = x;
    this.lastY = y;
    this.isDrawing = true;
    this.strokeDot(x, y);
  }

  private onPointerMove(ev: PointerEvent): void {
    if (!this.isDrawing || !this.ctx) return;
    const { x, y } = this.canvasPoint(ev);
    this.strokeLine(this.lastX, this.lastY, x, y);
    this.lastX = x;
    this.lastY = y;
  }

  private onPointerUp(ev: PointerEvent): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    if (this.canvas.hasPointerCapture(ev.pointerId)) this.canvas.releasePointerCapture(ev.pointerId);
    this.hasStrokes = true;
  }

  private brushWidth(): number {
    const scale = this.canvas.width / this.canvas.getBoundingClientRect().width;
    return (this.eraserActive ? ERASER_WIDTH_CSS_PX : STROKE_WIDTH_CSS_PX) * (Number.isFinite(scale) ? scale : 1);
  }

  private applyBrushStyle(): void {
    if (!this.ctx) return;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.lineWidth = this.brushWidth();
    if (this.eraserActive) {
      this.ctx.globalCompositeOperation = "destination-out";
      this.ctx.strokeStyle = "#000";
      this.ctx.fillStyle = "#000";
    } else {
      this.ctx.globalCompositeOperation = "source-over";
      this.ctx.strokeStyle = DRAW_COLORS[this.activeColor];
      this.ctx.fillStyle = DRAW_COLORS[this.activeColor];
    }
  }

  private strokeDot(x: number, y: number): void {
    if (!this.ctx) return;
    this.applyBrushStyle();
    this.ctx.beginPath();
    this.ctx.arc(x, y, this.brushWidth() / 2, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private strokeLine(x0: number, y0: number, x1: number, y1: number): void {
    if (!this.ctx) return;
    this.applyBrushStyle();
    this.ctx.beginPath();
    this.ctx.moveTo(x0, y0);
    this.ctx.lineTo(x1, y1);
    this.ctx.stroke();
  }

  private undo(): void {
    if (!this.ctx || this.undoStack.length === 0) return;
    const snapshot = this.undoStack.pop()!;
    this.ctx.putImageData(snapshot, 0, 0);
    this.hasStrokes = this.undoStack.length > 0;
  }

  private async persistEdits(): Promise<void> {
    if (!this.hasStrokes || !this.editPath || !this.imgEl.naturalWidth) return;
    const composite = document.createElement("canvas");
    composite.width = this.imgEl.naturalWidth;
    composite.height = this.imgEl.naturalHeight;
    const cctx = composite.getContext("2d");
    if (!cctx) return;
    cctx.drawImage(this.imgEl, 0, 0, composite.width, composite.height);
    cctx.drawImage(this.canvas, 0, 0, composite.width, composite.height);
    const dataUrl = composite.toDataURL("image/png");
    await window.omphif.saveImageEdit(this.editPath, dataUrl);
  }
}
