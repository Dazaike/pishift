import {
  DEFAULT_ACTIVITY_COLORS,
  GLOW_ACTIVITIES,
  GLOW_ACTIVITY_LABELS,
  type GlowActivity,
  type PanelPosition,
  type ProviderLimit,
  type ProviderUsageReport,
  type ViewMode,
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
import {
  DEFAULT_TAB_LAYOUT_MODE,
  isTabLayoutMode,
  TAB_LAYOUT_LABELS,
  TAB_LAYOUT_MODES,
  type TabLayoutMode,
} from "../shared/tab-layout";
import {
  MIN_USAGE_TRACKER_REFRESH_MS,
  USAGE_TRACKER_REFRESH_PRESETS,
  type SettingsSectionId,
  type UsageTrackerQuota,
  type UsageTrackerSettings,
  type UsageTrackerStyle,
  usageTrackerQuotaKey,
} from "../shared/usage-tracker";

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
  private defaultViewMode: ViewMode;
  private autoExpandTools: boolean;
  private autoExpandReasoning: boolean;
  private tabLayoutMode: TabLayoutMode;
  private usageTracker: UsageTrackerSettings;
  private usageReports: ProviderUsageReport[];
  private settingsSectionCollapsed: Partial<Record<SettingsSectionId, boolean>>;
  private usageIconError = "";
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
  private onDefaultViewModeChange: (mode: ViewMode) => void;
  private onToggleAutoExpandTools: (enabled: boolean) => void;
  private onToggleAutoExpandReasoning: (enabled: boolean) => void;
  private onTabLayoutModeChange: (mode: TabLayoutMode) => void;
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
  private onUsageTrackerChange: (settings: UsageTrackerSettings) => void;
  private onSettingsSectionCollapsedChange: (
    collapsed: Partial<Record<SettingsSectionId, boolean>>,
  ) => void;
  private onRefreshUsage: () => Promise<void>;

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
    defaultViewMode: ViewMode | undefined;
    autoExpandTools: boolean | undefined;
    autoExpandReasoning: boolean | undefined;
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
    onDefaultViewModeChange: (mode: ViewMode) => void;
    onToggleAutoExpandTools: (enabled: boolean) => void;
    onToggleAutoExpandReasoning: (enabled: boolean) => void;
    tabLayoutMode: TabLayoutMode | undefined;
    onTabLayoutModeChange: (mode: TabLayoutMode) => void;
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
    usageTracker: UsageTrackerSettings;
    usageReports: ProviderUsageReport[];
    settingsSectionCollapsed: Partial<Record<SettingsSectionId, boolean>>;
    onUsageTrackerChange: (settings: UsageTrackerSettings) => void;
    onSettingsSectionCollapsedChange: (
      collapsed: Partial<Record<SettingsSectionId, boolean>>,
    ) => void;
    onRefreshUsage: () => Promise<void>;
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
    this.defaultViewMode = opts.defaultViewMode ?? "terminal";
    this.autoExpandTools = opts.autoExpandTools ?? false;
    this.autoExpandReasoning = opts.autoExpandReasoning ?? true;
    this.tabLayoutMode = opts.tabLayoutMode ?? DEFAULT_TAB_LAYOUT_MODE;
    this.usageTracker = opts.usageTracker;
    this.usageReports = opts.usageReports;
    this.settingsSectionCollapsed = opts.settingsSectionCollapsed;
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
    this.onDefaultViewModeChange = opts.onDefaultViewModeChange;
    this.onToggleAutoExpandTools = opts.onToggleAutoExpandTools;
    this.onToggleAutoExpandReasoning = opts.onToggleAutoExpandReasoning;
    this.onTabLayoutModeChange = opts.onTabLayoutModeChange;
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
    this.onUsageTrackerChange = opts.onUsageTrackerChange;
    this.onSettingsSectionCollapsedChange = opts.onSettingsSectionCollapsedChange;
    this.onRefreshUsage = opts.onRefreshUsage;
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

  setUsageReports(reports: ProviderUsageReport[]): void {
    this.usageReports = reports;
    if (this.isOpen) this.render();
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
    defaultViewMode?: ViewMode;
    autoExpandTools?: boolean;
    autoExpandReasoning?: boolean;
    tabLayoutMode?: TabLayoutMode;
    scrollSteps?: number;
    pasteMode?: PasteModeSetting;
    pasteMarkerStyle?: PasteMarkerStyle;
    pasteMarkerPaint?: PasteMarkerPaint;
    pasteMarkerPulse?: boolean;
    doneSoundEnabled?: boolean;
    doneSoundVolume?: number;
    usageTracker?: UsageTrackerSettings;
    usageReports?: ProviderUsageReport[];
    settingsSectionCollapsed?: Partial<Record<SettingsSectionId, boolean>>;
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
    if (state.defaultViewMode) {
      this.defaultViewMode = state.defaultViewMode;
    }
    if (typeof state.autoExpandTools === "boolean") {
      this.autoExpandTools = state.autoExpandTools;
    }
    if (typeof state.autoExpandReasoning === "boolean") {
      this.autoExpandReasoning = state.autoExpandReasoning;
    }
    if (isTabLayoutMode(state.tabLayoutMode)) {
      this.tabLayoutMode = state.tabLayoutMode;
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
    if (state.usageTracker) {
      this.usageTracker = state.usageTracker;
    }
    if (state.usageReports) {
      this.usageReports = state.usageReports;
    }
    if (state.settingsSectionCollapsed) {
      this.settingsSectionCollapsed = state.settingsSectionCollapsed;
    }
  }

  private toggleSection(id: SettingsSectionId): void {
    const collapsed = !this.settingsSectionCollapsed[id];
    this.settingsSectionCollapsed = { ...this.settingsSectionCollapsed, [id]: collapsed };
    this.onSettingsSectionCollapsedChange(this.settingsSectionCollapsed);
    this.render();
    if (id === "usage-tracker" && !collapsed) {
      void this.onRefreshUsage().finally(() => this.render());
    }
  }

  private sectionHeader(id: SettingsSectionId, title: string, description: string): HTMLDivElement {
    const collapsed = this.settingsSectionCollapsed[id] === true;
    const header = document.createElement("div");
    header.className = "settings-section-header clickable-header";
    header.setAttribute("role", "button");
    header.tabIndex = 0;
    header.setAttribute("aria-expanded", String(!collapsed));

    const row = document.createElement("div");
    row.className = "settings-title-row";
    const chevron = document.createElement("span");
    chevron.className = "settings-chevron";
    chevron.textContent = collapsed ? "▶" : "▼";
    const heading = document.createElement("h3");
    heading.className = "settings-section-title";
    heading.textContent = title;
    row.append(chevron, heading);

    const desc = document.createElement("span");
    desc.className = "settings-desc";
    desc.textContent = collapsed ? `${title} collapsed (click to expand)` : description;
    header.append(row, desc);
    header.addEventListener("click", () => this.toggleSection(id));
    header.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.toggleSection(id);
      }
    });
    return header;
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

    // Appearance keeps color themes and typography together.
    const themeSection = document.createElement("section");
    themeSection.className = "settings-section";
    const themeHeader = this.sectionHeader(
      "appearance",
      "Appearance / Themes",
      "Choose the terminal palette and font family.",
    );

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

    themeSection.append(themeHeader);

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
    if (!this.settingsSectionCollapsed.appearance) {
      themeSection.append(themeList, fontSection);
    }

    // Section 3: Composer Glow Colors
    const activitySection = this.renderActivityColors();

    // Interface contains chrome, overflow, and completion behavior.
    const interfaceSection = document.createElement("section");
    interfaceSection.className = "settings-section";
    const interfaceHeader = this.sectionHeader(
      "interface",
      "Interface",
      "Configure chrome, menus, tab overflow, and completion feedback.",
    );

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

    // Option 5b: Which renderer new tabs open in (per-tab mode still toggles freely)
    const viewModeRow = document.createElement("div");
    viewModeRow.className = "settings-pos-row";
    const viewModeLabel = document.createElement("label");
    viewModeLabel.className = "settings-pos-label";
    viewModeLabel.textContent = "Default View for New Tabs";

    const viewModeSelect = document.createElement("select");
    viewModeSelect.className = "settings-select";
    const viewModeOptions: { id: ViewMode; label: string }[] = [
      { id: "terminal", label: "Terminal (Raw omp TUI)" },
      { id: "chat", label: "Chat View (Stylized Transcript)" },
    ];
    for (const opt of viewModeOptions) {
      const el = document.createElement("option");
      el.value = opt.id;
      el.textContent = opt.label;
      if (opt.id === this.defaultViewMode) el.selected = true;
      viewModeSelect.appendChild(el);
    }
    viewModeSelect.addEventListener("change", () => {
      this.defaultViewMode = viewModeSelect.value === "chat" ? "chat" : "terminal";
      this.onDefaultViewModeChange(this.defaultViewMode);
    });
    viewModeRow.append(viewModeLabel, viewModeSelect);

    const autoExpandToolsLabel = document.createElement("label");
    autoExpandToolsLabel.className = "settings-check-label";
    const autoExpandToolsCheck = document.createElement("input");
    autoExpandToolsCheck.type = "checkbox";
    autoExpandToolsCheck.checked = this.autoExpandTools;
    autoExpandToolsCheck.addEventListener("change", () => {
      this.autoExpandTools = autoExpandToolsCheck.checked;
      this.onToggleAutoExpandTools(this.autoExpandTools);
    });
    const autoExpandToolsText = document.createElement("span");
    autoExpandToolsText.textContent = "Auto-expand Tool Groups in Chat View";
    autoExpandToolsLabel.append(autoExpandToolsCheck, autoExpandToolsText);

    const autoExpandReasoningLabel = document.createElement("label");
    autoExpandReasoningLabel.className = "settings-check-label";
    const autoExpandReasoningCheck = document.createElement("input");
    autoExpandReasoningCheck.type = "checkbox";
    autoExpandReasoningCheck.checked = this.autoExpandReasoning;
    autoExpandReasoningCheck.addEventListener("change", () => {
      this.autoExpandReasoning = autoExpandReasoningCheck.checked;
      this.onToggleAutoExpandReasoning(this.autoExpandReasoning);
    });
    const autoExpandReasoningText = document.createElement("span");
    autoExpandReasoningText.textContent = "Auto-expand Reasoning in Chat View";
    autoExpandReasoningLabel.append(autoExpandReasoningCheck, autoExpandReasoningText);

    // Option 6: How the tab strip copes with many open sessions
    const tabLayoutRow = document.createElement("div");
    tabLayoutRow.className = "settings-pos-row";
    const tabLayoutLabel = document.createElement("label");
    tabLayoutLabel.className = "settings-pos-label";
    tabLayoutLabel.textContent = "Too Many Tabs";

    const tabLayoutSelect = document.createElement("select");
    tabLayoutSelect.className = "settings-select";
    for (const mode of TAB_LAYOUT_MODES) {
      const el = document.createElement("option");
      el.value = mode;
      el.textContent = TAB_LAYOUT_LABELS[mode];
      if (mode === this.tabLayoutMode) el.selected = true;
      tabLayoutSelect.appendChild(el);
    }
    tabLayoutSelect.addEventListener("change", () => {
      if (!isTabLayoutMode(tabLayoutSelect.value)) return;
      this.tabLayoutMode = tabLayoutSelect.value;
      this.onTabLayoutModeChange(this.tabLayoutMode);
    });
    tabLayoutRow.append(tabLayoutLabel, tabLayoutSelect);

    // Option 7: Wheel scroll steps
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

    // Option 8: How long pastes attach
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

    // Option 9: How the collapsed paste looks in the composer
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

    // Option 10: How that marker is painted
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

    // Option 11: Flash the marker as it lands
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

    // Option 12: Completion chime + its volume
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
      viewModeRow,
      autoExpandToolsLabel,
      autoExpandReasoningLabel,
      tabLayoutRow,
      scrollRow,
      doneSoundLabel,
      volumeRow,
    );
    if (!this.settingsSectionCollapsed.composer) {
      activitySection.append(pasteRow, markerRow, paintRow, pulseLabel);
    }
    interfaceSection.append(interfaceHeader);
    if (!this.settingsSectionCollapsed.interface) interfaceSection.append(optionsList);

    body.append(
      themeSection,
      activitySection,
      this.renderUsageTrackerSection(),
      interfaceSection,
    );

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

    const heading = this.sectionHeader(
      "composer",
      "Composer",
      "Customize composer glow and paste treatment.",
    );

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "settings-activity-reset";
    resetBtn.textContent = "Reset to defaults";
    resetBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      this.activityColors = { ...DEFAULT_ACTIVITY_COLORS };
      this.onResetActivityColors();
      this.render();
    });
    if (!this.settingsSectionCollapsed.composer) {
      heading.append(resetBtn);
    }
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

    section.append(heading);
    if (!this.settingsSectionCollapsed.composer) section.append(grid, tabsToggle);
    return section;
  }

  private updateUsageTracker(next: UsageTrackerSettings): void {
    this.usageTracker = next;
    this.onUsageTrackerChange(next);
  }

  private renderUsageTrackerSection(): HTMLElement {
    const section = document.createElement("section");
    section.className = "settings-section";
    section.append(
      this.sectionHeader(
        "usage-tracker",
        "Usage Tracker",
        "Select live provider quotas to show beside Recent Chats.",
      ),
    );
    if (this.settingsSectionCollapsed["usage-tracker"]) return section;

    const content = document.createElement("div");
    content.className = "settings-options-list";
    const enabledLabel = document.createElement("label");
    enabledLabel.className = "settings-check-label";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = this.usageTracker.enabled;
    enabled.addEventListener("change", () => {
      this.updateUsageTracker({ ...this.usageTracker, enabled: enabled.checked });
    });
    const enabledText = document.createElement("span");
    enabledText.textContent = "Show provider quota trackers in the top bar";
    enabledLabel.append(enabled, enabledText);
    const iconPlacementRow = document.createElement("div");
    iconPlacementRow.className = "settings-pos-row";
    const iconPlacementLabel = document.createElement("label");
    iconPlacementLabel.className = "settings-pos-label";
    iconPlacementLabel.textContent = "Provider Icon";
    const iconPlacement = document.createElement("select");
    iconPlacement.className = "settings-select";
    for (const [value, label] of [
      ["inside", "Inside tracker"] as const,
      ["beside", "Beside tracker"] as const,
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = this.usageTracker.iconPlacement === value;
      iconPlacement.append(option);
    }
    iconPlacement.addEventListener("change", () => {
      this.updateUsageTracker({
        ...this.usageTracker,
        iconPlacement: iconPlacement.value === "beside" ? "beside" : "inside",
      });
    });
    iconPlacementRow.append(iconPlacementLabel, iconPlacement);
    const percentLabel = document.createElement("label");
    percentLabel.className = "settings-check-label";
    const percent = document.createElement("input");
    percent.type = "checkbox";
    percent.checked = this.usageTracker.showPercent;
    percent.addEventListener("change", () => {
      this.updateUsageTracker({ ...this.usageTracker, showPercent: percent.checked });
    });
    const percentText = document.createElement("span");
    percentText.textContent = "Show percentage beside each tracker";
    percentLabel.append(percent, percentText);



    const intervalRow = document.createElement("div");
    intervalRow.className = "settings-pos-row";
    const intervalLabel = document.createElement("label");
    intervalLabel.className = "settings-pos-label";
    intervalLabel.textContent = "Refresh";
    const interval = document.createElement("select");
    interval.className = "settings-select";
    const custom = !(
      this.usageTracker.refreshIntervalMs === null ||
      USAGE_TRACKER_REFRESH_PRESETS.includes(
        this.usageTracker.refreshIntervalMs as (typeof USAGE_TRACKER_REFRESH_PRESETS)[number],
      )
    );
    for (const [value, label] of [
      ...USAGE_TRACKER_REFRESH_PRESETS.map((value) => [String(value), `${value / 1000}s`] as const),
      ["manual", "Manual"] as const,
      ["custom", "Custom"] as const,
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected =
        (value === "manual" && this.usageTracker.refreshIntervalMs === null) ||
        (value === "custom" && custom) ||
        value === String(this.usageTracker.refreshIntervalMs);
      interval.append(option);
    }
    interval.addEventListener("change", () => {
      if (interval.value === "manual") {
        this.updateUsageTracker({ ...this.usageTracker, refreshIntervalMs: null });
      } else if (interval.value === "custom") {
        this.updateUsageTracker({
          ...this.usageTracker,
          refreshIntervalMs: Math.max(MIN_USAGE_TRACKER_REFRESH_MS, 60_000),
        });
      } else {
        this.updateUsageTracker({
          ...this.usageTracker,
          refreshIntervalMs: Math.max(MIN_USAGE_TRACKER_REFRESH_MS, Number(interval.value)),
        });
      }
      this.render();
    });
    intervalRow.append(intervalLabel, interval);

    const customRow = document.createElement("div");
    customRow.className = "settings-pos-row";
    customRow.hidden = !custom;
    const customLabel = document.createElement("label");
    customLabel.className = "settings-pos-label";
    customLabel.textContent = `Custom seconds (minimum ${MIN_USAGE_TRACKER_REFRESH_MS / 1000})`;
    const customInput = document.createElement("input");
    customInput.type = "number";
    customInput.className = "settings-font-input";
    customInput.min = String(MIN_USAGE_TRACKER_REFRESH_MS / 1000);
    customInput.step = "1";
    customInput.value = String(Math.round((this.usageTracker.refreshIntervalMs ?? 60_000) / 1000));
    customInput.addEventListener("change", () => {
      const seconds = Math.max(MIN_USAGE_TRACKER_REFRESH_MS / 1000, Number(customInput.value) || 0);
      this.updateUsageTracker({ ...this.usageTracker, refreshIntervalMs: seconds * 1000 });
      customInput.value = String(seconds);
    });
    customRow.append(customLabel, customInput);

    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.className = "settings-sound-preview";
    refreshButton.textContent = "Refresh live quotas";
    refreshButton.addEventListener("click", () => void this.onRefreshUsage().finally(() => this.render()));
    content.append(
      enabledLabel,
      iconPlacementRow,
      percentLabel,
      intervalRow,
      customRow,
      refreshButton,
    );

    // Collect all available quotas from reports
    const reportQuotas = new Map<string, { report: ProviderUsageReport; limit: ProviderLimit }>();
    for (const report of this.usageReports) {
      if (report.limits.length === 0) continue;
      for (const limit of report.limits) {
        const key = usageTrackerQuotaKey({
          provider: report.provider,
          account: report.account,
          label: limit.label,
        });
        reportQuotas.set(key, { report, limit });
      }
    }

    type QuotaItem = {
      key: string;
      quota: UsageTrackerQuota;
      report: ProviderUsageReport;
      limit: ProviderLimit;
    };

    const orderedItems: QuotaItem[] = [];
    const seenKeys = new Set<string>();

    for (const quota of this.usageTracker.quotas) {
      const key = usageTrackerQuotaKey(quota);
      const match = reportQuotas.get(key);
      if (match) {
        orderedItems.push({ key, quota: { ...quota }, report: match.report, limit: match.limit });
        seenKeys.add(key);
      }
    }

    for (const [key, match] of reportQuotas) {
      if (!seenKeys.has(key)) {
        orderedItems.push({
          key,
          quota: {
            provider: match.report.provider,
            ...(match.report.account ? { account: match.report.account } : {}),
            label: match.limit.label,
            enabled: false,
            style: "bar",
          },
          report: match.report,
          limit: match.limit,
        });
      }
    }

    const saveAll = (nextItems: QuotaItem[]): void => {
      const quotas = nextItems.map((item) => item.quota);
      this.updateUsageTracker({ ...this.usageTracker, quotas });
      this.render();
    };

    const swapItems = (idxA: number, idxB: number): void => {
      if (idxA < 0 || idxA >= orderedItems.length || idxB < 0 || idxB >= orderedItems.length) return;
      const next = [...orderedItems];
      const temp = next[idxA];
      next[idxA] = next[idxB];
      next[idxB] = temp;
      saveAll(next);
    };

    // Live Preview Bar
    const previewContainer = document.createElement("div");
    previewContainer.className = "settings-usage-preview";

    const previewHead = document.createElement("div");
    previewHead.className = "settings-usage-preview-head";
    previewHead.textContent = "Live Top Bar Preview";

    const previewStrip = document.createElement("div");
    previewStrip.className = "settings-usage-preview-strip";

    const activeItems = orderedItems.filter((item) => item.quota.enabled);
    if (activeItems.length === 0) {
      const empty = document.createElement("div");
      empty.className = "settings-usage-preview-empty";
      empty.textContent = "No active providers in top bar — enable quotas below to show them.";
      previewStrip.append(empty);
    } else {
      activeItems.forEach((item, activeIndex) => {
        const chip = document.createElement("div");
        chip.className = "settings-usage-preview-chip";

        const leftBtn = document.createElement("button");
        leftBtn.type = "button";
        leftBtn.className = "settings-usage-preview-btn";
        leftBtn.title = "Move earlier in top bar";
        leftBtn.textContent = "◀";
        leftBtn.disabled = activeIndex === 0;
        leftBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const targetItem = activeItems[activeIndex - 1];
          const currIdx = orderedItems.indexOf(item);
          const targetIdx = orderedItems.indexOf(targetItem);
          swapItems(currIdx, targetIdx);
        });

        if (this.usageTracker.iconPlacement === "beside") {
          chip.append(this.renderMiniIcon(item.report.provider));
        }

        const usedPercent = Math.min(100, Math.max(0, item.limit.usedPercent));
        const tier = usedPercent >= 80 ? "high" : usedPercent >= 50 ? "med" : "low";
        if (this.usageTracker.showPercent) {
          const percent = document.createElement("span");
          percent.className = `usage-tracker-percent ${tier}`;
          percent.textContent = `${Math.round(usedPercent)}%`;
          chip.append(percent);
        }

        chip.append(this.renderPreviewGauge(item.quota, item.limit, item.report.provider));

        const title = document.createElement("span");
        title.className = "settings-usage-preview-chip-title";
        title.textContent = `${item.report.providerName} ${item.limit.label}`;
        chip.append(title);

        const rightBtn = document.createElement("button");
        rightBtn.type = "button";
        rightBtn.className = "settings-usage-preview-btn";
        rightBtn.title = "Move later in top bar";
        rightBtn.textContent = "▶";
        rightBtn.disabled = activeIndex === activeItems.length - 1;
        rightBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const targetItem = activeItems[activeIndex + 1];
          const currIdx = orderedItems.indexOf(item);
          const targetIdx = orderedItems.indexOf(targetItem);
          swapItems(currIdx, targetIdx);
        });

        const nav = document.createElement("div");
        nav.className = "settings-usage-preview-nav";
        nav.append(leftBtn, rightBtn);
        chip.append(nav);

        previewStrip.append(chip);
      });
    }

    previewContainer.append(previewHead, previewStrip);
    content.append(previewContainer);

    const listHead = document.createElement("div");
    listHead.className = "settings-usage-preview-head";
    listHead.style.marginTop = "8px";
    listHead.textContent = "Provider Quotas";
    content.append(listHead);

    orderedItems.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "settings-usage-quota";

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = `settings-usage-add-btn ${item.quota.enabled ? "active" : ""}`;
      addBtn.textContent = item.quota.enabled ? "✓" : "+";
      addBtn.title = item.quota.enabled ? "Enabled — click to disable" : "Disabled — click '+' to add to top bar";
      addBtn.addEventListener("click", () => {
        item.quota.enabled = !item.quota.enabled;
        saveAll(orderedItems);
      });

      const main = document.createElement("div");
      main.className = "settings-usage-quota-main";
      const text = document.createElement("span");
      text.textContent = `${item.report.providerName}${item.report.account ? ` (${item.report.account})` : ""} · ${item.limit.label} (${Math.round(item.limit.usedPercent)}%)`;
      main.append(addBtn, text);

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "settings-usage-reorder-btn";
      upBtn.textContent = "▲";
      upBtn.title = "Move up";
      upBtn.disabled = index === 0;
      upBtn.addEventListener("click", () => swapItems(index, index - 1));

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "settings-usage-reorder-btn";
      downBtn.textContent = "▼";
      downBtn.title = "Move down";
      downBtn.disabled = index === orderedItems.length - 1;
      downBtn.addEventListener("click", () => swapItems(index, index + 1));

      const reorderGroup = document.createElement("div");
      reorderGroup.className = "settings-usage-preview-nav";
      reorderGroup.append(upBtn, downBtn);

      const style = document.createElement("select");
      style.className = "settings-select";
      for (const value of ["bar", "circle", "battery"] as const) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value[0].toUpperCase() + value.slice(1);
        option.selected = item.quota.style === value;
        style.append(option);
      }
      style.addEventListener("change", () => {
        item.quota.style = style.value as UsageTrackerStyle;
        saveAll(orderedItems);
      });

      row.append(main, reorderGroup, style);
      content.append(row);
    });

    const providerIds = new Set([
      ...this.usageReports.map((report) => report.provider),
      ...Object.keys(this.usageTracker.providerIconUrls),
    ]);
    for (const provider of providerIds) {
      const providerRow = document.createElement("div");
      providerRow.className = "settings-usage-provider";
      const title = document.createElement("span");
      title.textContent = `${provider} icon`;
      const row = document.createElement("div");
      row.className = "settings-usage-icon-row";
      const url = document.createElement("input");
      url.type = "url";
      url.className = "settings-font-input";
      url.placeholder = "https://… or choose an image";
      url.value = this.usageTracker.providerIconUrls[provider] ?? "";
      url.addEventListener("change", () => {
        const providerIconUrls = { ...this.usageTracker.providerIconUrls };
        if (url.value.trim()) providerIconUrls[provider] = url.value.trim();
        else delete providerIconUrls[provider];
        this.updateUsageTracker({ ...this.usageTracker, providerIconUrls });
      });
      const file = document.createElement("input");
      file.type = "file";
      file.accept = "image/*";
      file.hidden = true;
      file.addEventListener("change", () => {
        const selected = file.files?.[0];
        if (!selected) return;
        const reader = new FileReader();
        reader.addEventListener("load", () => {
          if (typeof reader.result !== "string") return;
          this.usageIconError = "";
          this.updateUsageTracker({
            ...this.usageTracker,
            providerIconUrls: { ...this.usageTracker.providerIconUrls, [provider]: reader.result },
          });
          this.render();
        });
        reader.addEventListener("error", () => {
          this.usageIconError = "Could not read icon image.";
          this.render();
        });
        reader.readAsDataURL(selected);
      });
      const choose = document.createElement("button");
      choose.type = "button";
      choose.className = "settings-sound-preview";
      choose.textContent = "Select Image";
      choose.addEventListener("click", () => file.click());
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "settings-sound-preview";
      reset.textContent = "Reset";
      reset.addEventListener("click", () => {
        const providerIconUrls = { ...this.usageTracker.providerIconUrls };
        delete providerIconUrls[provider];
        this.updateUsageTracker({ ...this.usageTracker, providerIconUrls });
        this.render();
      });
      row.append(url, file, choose, reset);
      providerRow.append(title, row);
      content.append(providerRow);
    }
    if (this.usageIconError) {
      const status = document.createElement("p");
      status.className = "settings-inline-status";
      status.textContent = this.usageIconError;
      content.append(status);
    }
    section.append(content);
    return section;
  }

  private renderMiniIcon(provider: string): HTMLElement {
    const override = this.usageTracker.providerIconUrls[provider];
    if (override) {
      const img = document.createElement("img");
      img.className = "usage-tracker-icon";
      img.src = override;
      img.alt = "";
      return img;
    }
    const span = document.createElement("span");
    span.className = "usage-tracker-icon";
    span.textContent = provider.slice(0, 1).toUpperCase();
    return span;
  }

  private renderPreviewGauge(
    quota: UsageTrackerQuota,
    limit: ProviderLimit,
    provider: string,
  ): HTMLElement {
    const usedPercent = Math.min(100, Math.max(0, limit.usedPercent));
    const tier = usedPercent >= 80 ? "high" : usedPercent >= 50 ? "med" : "low";
    const gauge = document.createElement("span");
    gauge.className = `usage-tracker-gauge usage-tracker-${quota.style} ${tier}`;
    gauge.style.setProperty("--usage-fill", `${usedPercent}%`);
    gauge.style.setProperty("--usage-remaining-fill", `${100 - usedPercent}%`);
    gauge.style.setProperty("--usage-ring-offset", String(94.25 * (1 - usedPercent / 100)));

    if (quota.style === "circle") {
      const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      ring.setAttribute("class", "usage-tracker-ring");
      ring.setAttribute("viewBox", "0 0 36 36");
      ring.innerHTML = '<circle class="usage-tracker-ring-track" cx="18" cy="18" r="15" /><circle class="usage-tracker-ring-progress" cx="18" cy="18" r="15" />';
      gauge.append(ring);
    } else {
      const fill = document.createElement("span");
      fill.className = "usage-tracker-fill";
      gauge.append(fill);
    }
    if (this.usageTracker.iconPlacement === "inside") {
      gauge.append(this.renderMiniIcon(provider));
    }
    return gauge;
  }

}
