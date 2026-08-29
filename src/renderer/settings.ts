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
import {
  clampScrollSteps,
  DEFAULT_SCROLL_STEPS,
  MAX_SCROLL_STEPS,
  MIN_SCROLL_STEPS,
} from "./term-view";
import { clampVolume, DEFAULT_DONE_SOUND_VOLUME } from "./completion-sound";
import {
  isPasteMarkerPaint,
  isPasteMarkerStyle,
  isPasteModeSetting,
  type PasteMarkerPaint,
  type PasteMarkerStyle,
  type PasteModeSetting,
} from "../shared/paste-attach";

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
  private pasteMode: PasteModeSetting;
  private onPasteModeChange: (mode: PasteModeSetting) => void;
  private pasteMarkerStyle: PasteMarkerStyle;
  private pasteMarkerPaint: PasteMarkerPaint;
  private pasteMarkerPulse: boolean;
  private onPasteMarkerStyleChange: (style: PasteMarkerStyle) => void;
  private onPasteMarkerPaintChange: (paint: PasteMarkerPaint) => void;
  private onTogglePasteMarkerPulse: (enabled: boolean) => void;
  private scrollSteps: number;
  private doneSoundEnabled: boolean;
  private doneSoundVolume: number;
  private onToggleDoneSound: (enabled: boolean) => void;
  private onDoneSoundVolumeChange: (volume: number) => void;
  private onPreviewDoneSound: () => void;
  private onScrollStepsChange: (steps: number) => void;

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
    initialScrollSteps: number | undefined;
    onScrollStepsChange: (steps: number) => void;
    pasteMode: PasteModeSetting | undefined;
    onPasteModeChange: (mode: PasteModeSetting) => void;
    doneSoundEnabled: boolean | undefined;
    doneSoundVolume: number | undefined;
    onToggleDoneSound: (enabled: boolean) => void;
    onDoneSoundVolumeChange: (volume: number) => void;
    onPreviewDoneSound: () => void;
    pasteMarkerStyle: PasteMarkerStyle | undefined;
    onPasteMarkerStyleChange: (style: PasteMarkerStyle) => void;
    pasteMarkerPaint: PasteMarkerPaint | undefined;
    onPasteMarkerPaintChange: (paint: PasteMarkerPaint) => void;
    pasteMarkerPulse: boolean | undefined;
    onTogglePasteMarkerPulse: (enabled: boolean) => void;
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
    this.scrollSteps = clampScrollSteps(opts.initialScrollSteps ?? DEFAULT_SCROLL_STEPS);
    this.onScrollStepsChange = opts.onScrollStepsChange;
    this.pasteMode = opts.pasteMode ?? "ask";
    this.onPasteModeChange = opts.onPasteModeChange;
    this.doneSoundEnabled = opts.doneSoundEnabled ?? true;
    this.doneSoundVolume = clampVolume(opts.doneSoundVolume ?? DEFAULT_DONE_SOUND_VOLUME);
    this.onToggleDoneSound = opts.onToggleDoneSound;
    this.onDoneSoundVolumeChange = opts.onDoneSoundVolumeChange;
    this.onPreviewDoneSound = opts.onPreviewDoneSound;

    this.pasteMarkerStyle = opts.pasteMarkerStyle ?? "content";
    this.onPasteMarkerStyleChange = opts.onPasteMarkerStyleChange;
    this.pasteMarkerPaint = opts.pasteMarkerPaint ?? "pill";
    this.onPasteMarkerPaintChange = opts.onPasteMarkerPaintChange;
    this.pasteMarkerPulse = opts.pasteMarkerPulse ?? true;
    this.onTogglePasteMarkerPulse = opts.onTogglePasteMarkerPulse;
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
    scrollSteps?: number;
    pasteMode?: PasteModeSetting;
    pasteMarkerStyle?: PasteMarkerStyle;
    pasteMarkerPaint?: PasteMarkerPaint;
    pasteMarkerPulse?: boolean;
    doneSoundEnabled?: boolean;
    doneSoundVolume?: number;
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
    if (typeof state.scrollSteps === "number") {
      this.scrollSteps = clampScrollSteps(state.scrollSteps);
    }
    if (isPasteModeSetting(state.pasteMode)) {
      this.pasteMode = state.pasteMode;
    }
    if (isPasteMarkerStyle(state.pasteMarkerStyle)) {
      this.pasteMarkerStyle = state.pasteMarkerStyle;
    }
    if (isPasteMarkerPaint(state.pasteMarkerPaint)) {
      this.pasteMarkerPaint = state.pasteMarkerPaint;
    }
    if (typeof state.pasteMarkerPulse === "boolean") {
      this.pasteMarkerPulse = state.pasteMarkerPulse;
    }
    if (typeof state.doneSoundEnabled === "boolean") {
      this.doneSoundEnabled = state.doneSoundEnabled;
    }
    if (typeof state.doneSoundVolume === "number") {
      this.doneSoundVolume = clampVolume(state.doneSoundVolume);
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

    // Option 6: Wheel scroll steps
    const scrollRow = document.createElement("div");
    scrollRow.className = "settings-slider-row";
    const scrollLabel = document.createElement("label");
    scrollLabel.className = "settings-pos-label";
    scrollLabel.textContent = "Scroll Wheel Steps";
    const scrollValue = document.createElement("span");
    scrollValue.className = "settings-slider-value";
    const rowWord = (n: number): string => (n === 1 ? "row" : "rows");
    scrollValue.textContent = `${this.scrollSteps} ${rowWord(this.scrollSteps)}`;
    const scrollInput = document.createElement("input");
    scrollInput.type = "range";
    scrollInput.className = "settings-slider";
    scrollInput.min = String(MIN_SCROLL_STEPS);
    scrollInput.max = String(MAX_SCROLL_STEPS);
    scrollInput.step = "1";
    scrollInput.value = String(this.scrollSteps);
    scrollInput.addEventListener("input", () => {
      this.scrollSteps = clampScrollSteps(Number(scrollInput.value));
      scrollValue.textContent = `${this.scrollSteps} ${rowWord(this.scrollSteps)}`;
      this.onScrollStepsChange(this.scrollSteps);
    });
    const scrollHead = document.createElement("div");
    scrollHead.className = "settings-slider-head";
    scrollHead.append(scrollLabel, scrollValue);
    scrollRow.append(scrollHead, scrollInput);

    // Option 7: How long pastes attach
    const pasteRow = document.createElement("div");
    pasteRow.className = "settings-pos-row";
    const pasteLabel = document.createElement("label");
    pasteLabel.className = "settings-pos-label";
    pasteLabel.textContent = "Long Paste";

    const pasteSelect = document.createElement("select");
    pasteSelect.className = "settings-select";
    const pasteOptions: { id: PasteModeSetting; label: string }[] = [
      { id: "ask", label: "Ask Each Time" },
      { id: "wrapped", label: "Always Attach as a Wrapped Block" },
      { id: "file", label: "Always Attach as a Local File" },
      { id: "inline", label: "Always Paste Inline" },
    ];
    for (const opt of pasteOptions) {
      const el = document.createElement("option");
      el.value = opt.id;
      el.textContent = opt.label;
      if (opt.id === this.pasteMode) el.selected = true;
      pasteSelect.appendChild(el);
    }
    pasteSelect.addEventListener("change", () => {
      if (!isPasteModeSetting(pasteSelect.value)) return;
      this.pasteMode = pasteSelect.value;
      this.onPasteModeChange(this.pasteMode);
    });
    pasteRow.append(pasteLabel, pasteSelect);

    // Option 8: How the collapsed paste looks in the composer
    const markerRow = document.createElement("div");
    markerRow.className = "settings-pos-row";
    const markerLabel = document.createElement("label");
    markerLabel.className = "settings-pos-label";
    markerLabel.textContent = "Paste Marker";

    const markerSelect = document.createElement("select");
    markerSelect.className = "settings-select";
    const markerOptions: { id: PasteMarkerStyle; label: string }[] = [
      { id: "content", label: "Content Tag  \u29c91 UserScript \u00b7 353 ln" },
      { id: "footnote", label: "Footnote  paste\u00b9" },
      { id: "brackets", label: "Brackets  \u27e6 paste 1 \u27e7" },
      { id: "local", label: "Local File  local://paste-1.md" },
      { id: "dot", label: "Dot  \u25cf paste 1" },
    ];
    for (const opt of markerOptions) {
      const el = document.createElement("option");
      el.value = opt.id;
      el.textContent = opt.label;
      if (opt.id === this.pasteMarkerStyle) el.selected = true;
      markerSelect.appendChild(el);
    }
    markerSelect.addEventListener("change", () => {
      if (!isPasteMarkerStyle(markerSelect.value)) return;
      this.pasteMarkerStyle = markerSelect.value;
      this.onPasteMarkerStyleChange(this.pasteMarkerStyle);
    });
    markerRow.append(markerLabel, markerSelect);

    // Option 9: How that marker is painted
    const paintRow = document.createElement("div");
    paintRow.className = "settings-pos-row";
    const paintLabel = document.createElement("label");
    paintLabel.className = "settings-pos-label";
    paintLabel.textContent = "Paste Marker Paint";

    const paintSelect = document.createElement("select");
    paintSelect.className = "settings-select";
    const paintOptions: { id: PasteMarkerPaint; label: string }[] = [
      { id: "pill", label: "Accent Pill" },
      { id: "fold", label: "Document Fold + Glow" },
      { id: "knockout", label: "Highlighter Knockout" },
      { id: "rail", label: "Underline Rail" },
      { id: "plain", label: "Plain Accent Text" },
    ];
    for (const opt of paintOptions) {
      const el = document.createElement("option");
      el.value = opt.id;
      el.textContent = opt.label;
      if (opt.id === this.pasteMarkerPaint) el.selected = true;
      paintSelect.appendChild(el);
    }
    paintSelect.addEventListener("change", () => {
      if (!isPasteMarkerPaint(paintSelect.value)) return;
      this.pasteMarkerPaint = paintSelect.value;
      this.onPasteMarkerPaintChange(this.pasteMarkerPaint);
    });
    paintRow.append(paintLabel, paintSelect);

    // Option 10: Flash the marker as it lands
    const pulseLabel = document.createElement("label");
    pulseLabel.className = "settings-check-label";
    const pulseCheck = document.createElement("input");
    pulseCheck.type = "checkbox";
    pulseCheck.checked = this.pasteMarkerPulse;
    pulseCheck.addEventListener("change", () => {
      this.pasteMarkerPulse = pulseCheck.checked;
      this.onTogglePasteMarkerPulse(this.pasteMarkerPulse);
    });
    const pulseText = document.createElement("span");
    pulseText.textContent = "Flash the Marker When a Paste Lands";
    pulseLabel.append(pulseCheck, pulseText);

    // Option 11: Completion chime + its volume
    const doneSoundLabel = document.createElement("label");
    doneSoundLabel.className = "settings-check-label";
    const doneSoundCheck = document.createElement("input");
    doneSoundCheck.type = "checkbox";
    doneSoundCheck.checked = this.doneSoundEnabled;
    doneSoundCheck.addEventListener("change", () => {
      this.doneSoundEnabled = doneSoundCheck.checked;
      volumeRow.hidden = !this.doneSoundEnabled;
      this.onToggleDoneSound(this.doneSoundEnabled);
    });
    const doneSoundText = document.createElement("span");
    doneSoundText.textContent = "Play a Sound When the Agent Finishes Working";
    doneSoundLabel.append(doneSoundCheck, doneSoundText);

    const volumeRow = document.createElement("div");
    volumeRow.className = "settings-slider-row";
    volumeRow.hidden = !this.doneSoundEnabled;
    const volumeLabel = document.createElement("label");
    volumeLabel.className = "settings-pos-label";
    volumeLabel.textContent = "Completion Sound Volume";
    const volumeValue = document.createElement("span");
    volumeValue.className = "settings-slider-value";
    volumeValue.textContent = `${Math.round(this.doneSoundVolume * 100)}%`;
    const volumeInput = document.createElement("input");
    volumeInput.type = "range";
    volumeInput.className = "settings-slider";
    volumeInput.min = "0";
    volumeInput.max = "100";
    volumeInput.step = "5";
    volumeInput.value = String(Math.round(this.doneSoundVolume * 100));
    volumeInput.addEventListener("input", () => {
      this.doneSoundVolume = clampVolume(Number(volumeInput.value) / 100);
      volumeValue.textContent = `${Math.round(this.doneSoundVolume * 100)}%`;
      this.onDoneSoundVolumeChange(this.doneSoundVolume);
    });
    // Preview on release only — every intermediate drag value would machine-gun.
    volumeInput.addEventListener("change", () => this.onPreviewDoneSound());
    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.className = "settings-sound-preview";
    previewBtn.textContent = "Test";
    previewBtn.addEventListener("click", () => this.onPreviewDoneSound());
    const volumeHead = document.createElement("div");
    volumeHead.className = "settings-slider-head";
    volumeHead.append(volumeLabel, volumeValue, previewBtn);
    volumeRow.append(volumeHead, volumeInput);

    optionsList.append(
      usageLabel,
      topLabelsLabel,
      bottomLabelsLabel,
      burgerMenuLabel,
      posRow,
      scrollRow,
      pasteRow,
      markerRow,
      paintRow,
      pulseLabel,
      doneSoundLabel,
      volumeRow,
    );
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
