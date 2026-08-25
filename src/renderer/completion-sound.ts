import doneSoundUrl from "./assets/done.mp3";

export const DEFAULT_DONE_SOUND_VOLUME = 0.6;

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DONE_SOUND_VOLUME;
  return Math.min(1, Math.max(0, value));
}

/**
 * One-shot chime for "the agent stopped working and the prompt is yours again".
 *
 * A single Audio element is reused: back-to-back completions rewind it instead
 * of stacking overlapping voices, and the file is decoded once on first play.
 */
export class CompletionSound {
  private readonly audio = new Audio(doneSoundUrl);
  private enabled: boolean;

  constructor(enabled: boolean, volume: number) {
    this.enabled = enabled;
    this.audio.preload = "auto";
    this.audio.volume = clampVolume(volume);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setVolume(volume: number): void {
    this.audio.volume = clampVolume(volume);
  }

  /** `force` bypasses the enabled flag — the settings preview always sounds. */
  play(force = false): void {
    if (!this.enabled && !force) return;
    this.audio.currentTime = 0;
    // Autoplay policy can reject before any user gesture; a missed chime is
    // never worth an unhandled rejection.
    void this.audio.play().catch(() => {});
  }
}
