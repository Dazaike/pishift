// jsdom has no ResizeObserver implementation; real Chromium (Electron's
// renderer) has had native support since v64, so this stub only exists to
// let jsdom-environment tests exercise code that observes layout changes
// (e.g. the dock/toolbar sliding-pill indicators in motion-utils.ts).
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
}
