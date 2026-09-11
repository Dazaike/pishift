/**
 * Guard for async xterm OSC handlers whose promise gates `term.write`'s
 * callback (and therefore the whole write queue behind it).
 *
 * `@xterm/addon-image@0.9.0` IIP `end()` returns `createImageBitmap(blob)`
 * with no timeout and no rejection handler — its `Image()` fallback has a 1s
 * sanity timer, the bitmap path has none. A decode that never settles holds
 * the write queue forever: every later frame (including omp's footer repaint)
 * queues behind the image, so the tab goes blank while the PTY keeps flowing.
 * Racing the handler bounds the damage to one degraded image instead of a
 * dead session.
 */

export type OscEnd = (success: boolean) => boolean | Promise<boolean>;

/** Long enough for a real phone-screencap decode, short enough to stay usable. */
export const IIP_END_GUARD_MS = 2500;

export function guardOscEnd(end: OscEnd, timeoutMs: number): OscEnd {
  return (success: boolean) => {
    let result: boolean | Promise<boolean>;
    try {
      result = end(success);
    } catch {
      return true;
    }
    if (!(result instanceof Promise)) return result;
    let timer: number | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = window.setTimeout(() => resolve(true), timeoutMs);
    });
    const clear = (): void => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };
    return Promise.race([
      result.then(
        (value) => {
          clear();
          return value;
        },
        () => {
          clear();
          return true;
        },
      ),
      timeout,
    ]);
  };
}

/** Narrowed view of the pinned addon's IIP protocol handler. */
export interface OscEndHandler {
  end: OscEnd;
}

export function asOscEndHandler(value: unknown): OscEndHandler | null {
  if (!value || typeof value !== "object") return null;
  if (!("end" in value) || typeof value.end !== "function") return null;
  // Pinned addon contract (0.9.0): end(success) -> boolean | Promise<boolean>.
  const handler: OscEndHandler = value as OscEndHandler;
  return handler;
}
