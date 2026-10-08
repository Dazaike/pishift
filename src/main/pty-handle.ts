/**
 * What `PtyManager` needs from a hosted process. node-pty's `IPty` satisfies it directly; the
 * pipe-backed handle for an elevated tab implements it so flow control, resize and kill share
 * one code path.
 */
export interface PtyHandle {
  readonly pid: number;
  /** True when the process runs in another privilege domain, so this process cannot signal or reap it. */
  readonly elevated?: boolean;
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  kill(): void;
}
