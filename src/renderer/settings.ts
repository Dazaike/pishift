import {
  DEFAULT_ACTIVITY_COLORS,
  GLOW_ACTIVITIES,
  GLOW_ACTIVITY_LABELS,
  type GlowActivity,
  type PanelPosition,
} from "../shared/ipc";
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
  private fontFamily: string;
  private activityColors: Record<GlowActivity, string>;
  private activityColorsOnTabs: boolean;
  private hideTopButtonLabels: boolean;
  private hideBottomButtonLabels: boolean;
  private collapseTopBarToMenu: boolean;
  private panelPosition: PanelPosition;
  private themesCollapsed = false;
  private onSelectCallback: (preset: ThemePreset) => void;
  private onToggleUsageHeader: (show: boolean) => void;
  private onFontChange: (family: string) => void;
  private onActivityColorChange: (key: GlowActivity, color: string) => void;
  private onResetActivityColors: () => void;
  private onToggleActivityColorsOnTabs: (enabled: boolean) => void;
  private onToggleHideTopButtonLabels: (hide: boolean) => void;
  private onToggleHideBottomButtonLabels: (hide: boolean) => void;
  private onToggleCollapseTopBarToMenu: (collapse: boolean) => void;
  private onPanelPositionChange: (pos: PanelPosition) => void;

  constructor(opts: {
    initialThemeName: string | undefined;
    showUsageInHeader: boolean | undefined;
    initialFontFamily: string | undefined;
    initialActivityColors: Partial<Record<GlowActivity, string>> | undefined;
    initialActivityColorsOnTabs: boolean | undefined;
    hideTopButtonLabels: boolean | undefined;
    hideBottomButtonLabels: boolean | undefined;
    collapseTopBarToMenu: boolean | undefined;
    panelPosition: PanelPosition | undefined;
    onSelect: (preset: ThemePreset) => void;
    onToggleUsageHeader: (show: boolean) => void;
    onFontChange: (family: string) => void;
    onActivityColorChange: (key: GlowActivity, color: string) => void;
    onResetActivityColors: () => void;
    onToggleActivityColorsOnTabs: (enabled: boolean) => void;
    onToggleHideTopButtonLabels: (hide: boolean) => void;
    onToggleHideBottomButtonLabels: (hide: boolean) => void;
    onToggleCollapseTopBarToMenu: (collapse: boolean) => void;
    onPanelPositionChange: (pos: PanelPosition) => void;
  }) {
    this.currentPreset = getThemeByName(opts.initialThemeName ?? DEFAULT_THEME_NAME);
    this.showUsageInHeader = opts.showUsageInHeader ?? true;
    this.fontFamily = opts.initialFontFamily ?? "";
    this.activityColors = { ...DEFAULT_ACTIVITY_COLORS, ...opts.initialActivityColors };
    this.activityColorsOnTabs = opts.initialActivityColorsOnTabs ?? false;
    this.hideTopButtonLabels = opts.hideTopButtonLabels ?? false;
    this.hideBottomButtonLabels = opts.hideBottomButtonLabels ?? false;
    this.collapseTopBarToMenu = opts.collapseTopBarToMenu ?? false;
    this.panelPosition = opts.panelPosition ?? "top-right";
    this.onSelectCallback = opts.onSelect;
    this.onToggleUsageHeader = opts.onToggleUsageHeader;
    this.onFontChange = opts.onFontChange;
    this.onActivityColorChange = opts.onActivityColorChange;
    this.onResetActivityColors = opts.onResetActivityColors;
    this.onToggleActivityColorsOnTabs = opts.onToggleActivityColorsOnTabs;
    this.onToggleHideTopButtonLabels = opts.onToggleHideTopButtonLabels;
    this.onToggleHideBottomButtonLabels = opts.onToggleHideBottomButtonLabels;
    this.onToggleCollapseTopBarToMenu = opts.onToggleCollapseTopBarToMenu;
    this.onPanelPositionChange = opts.onPanelPositionChange;

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

  syncState(state: {
    themeName?: string;
    showUsageInHeader?: boolean;
    fontFamily?: string;
    activityColors?: Partial<Record<GlowActivity, string>>;
    activityColorsOnTabs?: boolean;
    hideTopButtonLabels?: boolean;
    hideBottomButtonLabels?: boolean;
    collapseTopBarToMenu?: boolean;
    panelPosition?: PanelPosition;
  }): void {
    if (state.themeName) {
      this.currentPreset = getThemeByName(state.themeName);
    }
    if (typeof state.showUsageInHeader === "boolean") {
      this.showUsageInHeader = state.showUsageInHeader;
    }
    if (typeof state.fontFamily === "string") {
      this.fontFamily = state.fontFamily;
    }
    if (state.activityColors) {
      this.activityColors = { ...DEFAULT_ACTIVITY_COLORS, ...state.activityColors };
    }
    if (typeof state.activityColorsOnTabs === "boolean") {
      this.activityColorsOnTabs = state.activityColorsOnTabs;
    }
    if (typeof state.hideTopButtonLabels === "boolean") {
      this.hideTopButtonLabels = state.hideTopButtonLabels;
    }
    if (typeof state.hideBottomButtonLabels === "boolean") {
      this.hideBottomButtonLabels = state.hideBottomButtonLabels;
    }
    if (typeof state.collapseTopBarToMenu === "boolean") {
      this.collapseTopBarToMenu = state.collapseTopBarToMenu;
    }
    if (state.panelPosition) {
      this.panelPosition = state.panelPosition;
    }
  }

  private render(): void {
    this.el.replaceChildren();

    const dialog = document.createElement("section");
    dialog.id = "settings-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Themes and Settings");

    // Fixed Header
    const header = document.createElement("header");
    header.className = "settings-header";
    const title = document.createElement("h2");
    title.textContent = "Themes & Settings";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "settings-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", () => this.close());
    header.append(title, closeBtn);

    // Scrollable Body
    const body = document.createElement("div");
    body.className = "settings-body";

    // Section 1: Themes (Collapsible)
    const themeSection = document.createElement("section");
    themeSection.className = "settings-section";

    const themeHeader = document.createElement("div");
    themeHeader.className = "settings-section-header clickable-header";
    themeHeader.setAttribute("role", "button");
    themeHeader.tabIndex = 0;

    const themeTitleRow = document.createElement("div");
    themeTitleRow.className = "settings-title-row";

    const chevron = document.createElement("span");
    chevron.className = "settings-chevron";
    chevron.textContent = this.themesCollapsed ? "\u25B6" : "\u25BC";

    const themeTitle = document.createElement("h3");
    themeTitle.className = "settings-section-title";
    themeTitle.textContent = "Color Themes";

    const activeThemeBadge = document.createElement("span");
    activeThemeBadge.className = "settings-active-theme-pill";
    activeThemeBadge.textContent = this.currentPreset.name;

    themeTitleRow.append(chevron, themeTitle, activeThemeBadge);

    const themeDesc = document.createElement("span");
    themeDesc.className = "settings-desc";
    themeDesc.textContent = this.themesCollapsed
      ? "Themes collapsed (click to expand)"
      : "Click a theme to apply it instantly to the window and terminal.";

    themeHeader.append(themeTitleRow, themeDesc);

    themeHeader.addEventListener("click", () => {
      this.themesCollapsed = !this.themesCollapsed;
      this.render();
    });

    themeHeader.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        this.themesCollapsed = !this.themesCollapsed;
        this.render();
      }
    });

    const themeList = document.createElement("div");
    themeList.className = "theme-list";

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

      themeList.appendChild(card);
    }

    if (!this.themesCollapsed) {
      themeSection.append(themeHeader, themeList);
    } else {
      themeSection.append(themeHeader);
    }

    // Section 2: Typography
    const fontSection = document.createElement("section");
    fontSection.className = "settings-section";

    const fontHeader = document.createElement("div");
    fontHeader.className = "settings-section-header";
    const fontTitle = document.createElement("h3");
    fontTitle.className = "settings-section-title";
    fontTitle.textContent = "Typography";
    fontHeader.append(fontTitle);

    const fontRow = document.createElement("div");
    fontRow.className = "settings-font-row";
    const fontLabel = document.createElement("label");
    fontLabel.className = "settings-font-label";
    fontLabel.textContent = "Terminal Font Family";
    const fontInput = document.createElement("input");
    fontInput.type = "text";
    fontInput.className = "settings-font-input";
    fontInput.placeholder = "Cascadia Code, Consolas, monospace";
    fontInput.value = this.fontFamily;
    fontInput.spellcheck = false;
    const onFontUpdate = (): void => {
      const next = fontInput.value.trim();
      if (next !== this.fontFamily) {
        this.fontFamily = next;
        this.onFontChange(this.fontFamily);
      }
    };
    fontInput.addEventListener("input", onFontUpdate);
    fontInput.addEventListener("change", onFontUpdate);
    fontRow.append(fontLabel, fontInput);
    fontSection.append(fontHeader, fontRow);

    // Section 3: Composer Glow Colors
    const activitySection = this.renderActivityColors();

    // Section 4: Interface Options
    const interfaceSection = document.createElement("section");
    interfaceSection.className = "settings-section";

    const interfaceHeader = document.createElement("div");
    interfaceHeader.className = "settings-section-header";
    const interfaceTitle = document.createElement("h3");
    interfaceTitle.className = "settings-section-title";
    interfaceTitle.textContent = "Interface Options";
    interfaceHeader.append(interfaceTitle);

    const optionsList = document.createElement("div");
    optionsList.className = "settings-options-list";

    // Option 1: Pinned usage
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

    // Option 2: Hide top button labels
    const topLabelsLabel = document.createElement("label");
    topLabelsLabel.className = "settings-check-label";
    const topLabelsCheck = document.createElement("input");
    topLabelsCheck.type = "checkbox";
    topLabelsCheck.checked = this.hideTopButtonLabels;
    topLabelsCheck.addEventListener("change", () => {
      this.hideTopButtonLabels = topLabelsCheck.checked;
      this.onToggleHideTopButtonLabels(this.hideTopButtonLabels);
    });
    const topLabelsText = document.createElement("span");
    topLabelsText.textContent = "Hide Button Names in Top Bar (Icons Only)";
    topLabelsLabel.append(topLabelsCheck, topLabelsText);

    // Option 3: Hide bottom button labels
    const bottomLabelsLabel = document.createElement("label");
    bottomLabelsLabel.className = "settings-check-label";
    const bottomLabelsCheck = document.createElement("input");
    bottomLabelsCheck.type = "checkbox";
    bottomLabelsCheck.checked = this.hideBottomButtonLabels;
    bottomLabelsCheck.addEventListener("change", () => {
      this.hideBottomButtonLabels = bottomLabelsCheck.checked;
      this.onToggleHideBottomButtonLabels(this.hideBottomButtonLabels);
    });
    const bottomLabelsText = document.createElement("span");
    bottomLabelsText.textContent = "Hide Button Names in Bottom Dock (Icons Only)";
    bottomLabelsLabel.append(bottomLabelsCheck, bottomLabelsText);

    // Option 4: Collapse top bar buttons into burger menu
    const burgerMenuLabel = document.createElement("label");
    burgerMenuLabel.className = "settings-check-label";
    const burgerMenuCheck = document.createElement("input");
    burgerMenuCheck.type = "checkbox";
    burgerMenuCheck.checked = this.collapseTopBarToMenu;
    burgerMenuCheck.addEventListener("change", () => {
      this.collapseTopBarToMenu = burgerMenuCheck.checked;
      this.onToggleCollapseTopBarToMenu(this.collapseTopBarToMenu);
    });
    const burgerMenuText = document.createElement("span");
    burgerMenuText.textContent = "Collapse Top Bar Buttons into Burger Menu (\u2630)";
    burgerMenuLabel.append(burgerMenuCheck, burgerMenuText);

    // Option 5: Placement of recent menus
    const posRow = document.createElement("div");
    posRow.className = "settings-pos-row";
    const posLabel = document.createElement("label");
    posLabel.className = "settings-pos-label";
    posLabel.textContent = "Recent Menus Placement";

    const posSelect = document.createElement("select");
    posSelect.className = "settings-select";
    const posOptions: { id: PanelPosition; label: string }[] = [
      { id: "top-right", label: "Top Right (Anchored to Top Bar)" },
      { id: "center", label: "Center Screen" },
      { id: "top-center", label: "Top Center" },
      { id: "bottom-center", label: "Bottom Center (Above Dock)" },
    ];
    for (const opt of posOptions) {
      const el = document.createElement("option");
      el.value = opt.id;
      el.textContent = opt.label;
      if (opt.id === this.panelPosition) el.selected = true;
      posSelect.appendChild(el);
    }
    posSelect.addEventListener("change", () => {
      this.panelPosition = posSelect.value as PanelPosition;
      this.onPanelPositionChange(this.panelPosition);
    });
    posRow.append(posLabel, posSelect);

    optionsList.append(usageLabel, topLabelsLabel, bottomLabelsLabel, burgerMenuLabel, posRow);
    interfaceSection.append(interfaceHeader, optionsList);

    body.append(themeSection, fontSection, activitySection, interfaceSection);

    // Fixed Footer
    const footer = document.createElement("footer");
    footer.className = "settings-footer";

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "settings-done";
    doneBtn.textContent = "Done";
    doneBtn.addEventListener("click", () => this.close());

    footer.append(doneBtn);

    dialog.append(header, body, footer);
    this.el.appendChild(dialog);
  }

  private renderActivityColors(): HTMLElement {
    const section = document.createElement("section");
    section.className = "settings-section";

    const heading = document.createElement("div");
    heading.className = "settings-section-header with-action";
    const headingTitle = document.createElement("h3");
    headingTitle.className = "settings-section-title";
    headingTitle.textContent = "Composer Glow Colors";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "settings-activity-reset";
    resetBtn.textContent = "Reset to defaults";
    resetBtn.addEventListener("click", () => {
      this.activityColors = { ...DEFAULT_ACTIVITY_COLORS };
      this.onResetActivityColors();
      this.render();
    });
    heading.append(headingTitle, resetBtn);

    const grid = document.createElement("div");
    grid.className = "settings-activity-grid";
    for (const key of GLOW_ACTIVITIES) {
      const row = document.createElement("label");
      row.className = "settings-activity-row";

      const swatch = document.createElement("input");
      swatch.type = "color";
      swatch.className = "settings-activity-swatch";
      swatch.value = this.activityColors[key];
      swatch.addEventListener("input", () => {
        this.activityColors = { ...this.activityColors, [key]: swatch.value };
        this.onActivityColorChange(key, swatch.value);
      });

      const label = document.createElement("span");
      label.textContent = GLOW_ACTIVITY_LABELS[key];

      row.append(swatch, label);
      grid.appendChild(row);
    }

    const tabsToggle = document.createElement("label");
    tabsToggle.className = "settings-check-label settings-tabs-color-toggle";
    const tabsCheck = document.createElement("input");
    tabsCheck.type = "checkbox";
    tabsCheck.checked = this.activityColorsOnTabs;
    tabsCheck.addEventListener("change", () => {
      this.activityColorsOnTabs = tabsCheck.checked;
      this.onToggleActivityColorsOnTabs(this.activityColorsOnTabs);
    });
    const tabsText = document.createElement("span");
    tabsText.textContent = "Also color tab busy indicators by activity";
    tabsToggle.append(tabsCheck, tabsText);

    section.append(heading, grid, tabsToggle);
    return section;
  }
}
