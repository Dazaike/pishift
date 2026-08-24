export type ThemeSettings = {
  bg: string;
  bgRaised: string;
  bgTab: string;
  border: string;
  fg: string;
  fgDim: string;
  accent: string;
  termCursor: string;
  termSelection: string;
};

export const DEFAULT_THEME: ThemeSettings = {
  bg: "#12131a",
  bgRaised: "#191b24",
  bgTab: "#1e2130",
  border: "#262a3a",
  fg: "#d7dae4",
  fgDim: "#8b93a8",
  accent: "#7aa2f7",
  termCursor: "#7aa2f7",
  termSelection: "#2b3350",
};
