import {
  DEFAULT_THEME_NAME,
  getThemeByName,
  THEME_PRESETS,
  type ThemePreset,
} from "./theme";

export class SettingsModal {
  readonly el: HTMLDivElement;
  private currentPreset: ThemePreset;
  private showUsageInHeader: boolean;
  private onSelectCallback: (preset: ThemePreset) => void;
  private onToggleUsageHeader: (show: boolean) => void;

  constructor(
    initialThemeName: string | undefined,
    showUsageInHeader: boolean | undefined,
    onSelect: (preset: ThemePreset) => void,
    onToggleUsageHeader: (show: boolean) => void,
  ) {
    this.currentPreset = getThemeByName(initialThemeName ?? DEFAULT_THEME_NAME);
    this.showUsageInHeader = showUsageInHeader ?? true;
    this.onSelectCallback = onSelect;
    this.onToggleUsageHeader = onToggleUsageHeader;

    this.el = document.createElement("div");
    this.el.id = "settings-backdrop";
    this.el.hidden = true;
    this.render();

    this.el.addEventListener("mousedown", (ev) => {
      if (ev.target === this.el) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(): void {
    this.render();
    this.el.hidden = false;
  }

  close(): void {
    this.el.hidden = true;
  }

  getPreset(): ThemePreset {
    return this.currentPreset;
  }

  setPreset(preset: ThemePreset): void {
    this.currentPreset = preset;
    this.render();
  }

  private render(): void {
    this.el.replaceChildren();

    const dialog = document.createElement("section");
    dialog.id = "settings-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Color Themes");

    const header = document.createElement("header");
    header.className = "settings-header";
    const title = document.createElement("h2");
    title.textContent = "Select Color Theme";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "settings-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.addEventListener("click", () => this.close());
    header.append(title, closeBtn);

    const list = document.createElement("div");
    list.className = "theme-list";

    for (const preset of THEME_PRESETS) {
      const isSelected = preset.name === this.currentPreset.name;
      const card = document.createElement("div");
      card.className = isSelected ? "theme-card active" : "theme-card";
      card.setAttribute("role", "button");
      card.tabIndex = 0;

      const headerRow = document.createElement("div");
      headerRow.className = "theme-card-header";

      const nameSpan = document.createElement("span");
      nameSpan.className = "theme-card-name";
      nameSpan.textContent = preset.name;

      if (isSelected) {
        const activeBadge = document.createElement("span");
        activeBadge.className = "theme-card-active-badge";
        activeBadge.textContent = "\u2713 Active";
        headerRow.append(nameSpan, activeBadge);
      } else {
        headerRow.appendChild(nameSpan);
      }

      // Preview swatches
      const preview = document.createElement("div");
      preview.className = "theme-preview";
      preview.style.background = preset.bg;
      preview.style.borderColor = preset.border;

      const sampleTab = document.createElement("div");
      sampleTab.className = "theme-preview-tab";
      sampleTab.style.background = preset.bgTab;
      sampleTab.style.color = preset.fg;
      sampleTab.textContent = "omp";

      const sampleText = document.createElement("div");
      sampleText.className = "theme-preview-text";
      sampleText.style.color = preset.fg;
      sampleText.innerHTML = `<span style="color:${preset.accent}">$</span> <span style="color:${preset.ansi.green}">omp</span> <span style="color:${preset.ansi.yellow}">run</span>`;

      const swatches = document.createElement("div");
      swatches.className = "theme-swatches";
      const colors = [
        preset.bg,
        preset.bgRaised,
        preset.accent,
        preset.ansi.red,
        preset.ansi.green,
        preset.ansi.yellow,
        preset.ansi.blue,
        preset.ansi.magenta,
        preset.ansi.cyan,
      ];
      for (const col of colors) {
        const dot = document.createElement("span");
        dot.className = "theme-dot";
        dot.style.background = col;
        swatches.appendChild(dot);
      }

      preview.append(sampleTab, sampleText, swatches);
      card.append(headerRow, preview);

      const pick = (): void => {
        this.currentPreset = preset;
        this.onSelectCallback(preset);
        this.render();
      };

      card.addEventListener("click", pick);
      card.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          pick();
        }
      });

      list.appendChild(card);
    }

    const footer = document.createElement("footer");
    footer.className = "settings-footer";

    const optionsWrap = document.createElement("div");
    optionsWrap.className = "settings-options-wrap";

    const usageLabel = document.createElement("label");
    usageLabel.className = "settings-check-label";
    const usageCheck = document.createElement("input");
    usageCheck.type = "checkbox";
    usageCheck.checked = this.showUsageInHeader;
    usageCheck.addEventListener("change", () => {
      this.showUsageInHeader = usageCheck.checked;
      this.onToggleUsageHeader(this.showUsageInHeader);
    });
    const usageText = document.createElement("span");
    usageText.textContent = "Show Pinned Token & Cost Usage in Header";
    usageLabel.append(usageCheck, usageText);

    const hint = document.createElement("span");
    hint.className = "settings-desc";
    hint.textContent = "Click a theme to apply it instantly to the window and terminal.";

    optionsWrap.append(usageLabel, hint);

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "settings-done";
    doneBtn.textContent = "Done";
    doneBtn.addEventListener("click", () => this.close());

    footer.append(optionsWrap, doneBtn);

    dialog.append(header, list, footer);
    this.el.appendChild(dialog);
  }
}
