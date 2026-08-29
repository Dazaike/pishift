/// <reference types="vite/client" />

import type { PiShiftApi } from "../preload/index";

declare global {
  interface Window {
    pishift: PiShiftApi;
  }
}
