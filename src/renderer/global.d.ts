import type { OmphifApi } from "../preload/index";

declare global {
  interface Window {
    omphif: OmphifApi;
  }
}
