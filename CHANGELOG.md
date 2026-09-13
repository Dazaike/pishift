# Changelog

All notable changes to PiShift are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.9.27] — 2026-09-13

### Added
- Thinking-level tick marks on the horizontal and vertical sliders now show a small label above/beside each dot (Off/Min/Low/Medium/High/XHigh) so every stop is identifiable without hovering.
- The horizontal slider fill now has four selectable animation styles (shimmer, glow, diagonal stripes, drifting bubbles) via a `data-fx` attribute for quick visual tuning.

### Changed
- Removed the redundant icon+label header row above the thinking sliders; the active tick label now carries the directional motion-blur transition that row used to show.
- Increased top padding on the horizontal slider popover so tick labels have clear space above the top edge.

## [1.9.26] — 2026-09-13

### Added
- Added horizontal and vertical thinking-effort sliders alongside the original list control. The horizontal slider is the launch default; all three modes are selectable in Settings.
- Fresh installs now start from the curated Vesper configuration, including model favorites, usage-tracker presets, activity colors, terminal presentation, and layout defaults without copying local paths or session state.

### Changed
- Usage quota labels now include their reporting window where needed, so otherwise identical provider quotas remain distinguishable.

### Fixed
- Usage-tracker preset matching now falls back to the provider and base quota label when the reporting window changes.
- Moved the provider-usage popover out of the dock’s composited layer so its frosted-glass backdrop renders correctly and follows its dock or header trigger.

## [1.9.25] — 2026-09-12

### Changed
- Bottom dock view toggle now uses dedicated terminal and chat icons (`terminal.png` and `chat.png`) instead of a static glyph.
- Clarified long paste behavior and settings: omp only prompts for paste attachment mode on 100+ lines, so smaller pastes always collapse directly to inline.

### Fixed
- Fixed dock plan button randomly re-triggering its scale bounce animation on background agent and control-bridge status updates.

## [1.9.24] — 2026-09-11

### Fixed
- Stopped advertising iTerm2 graphics support to omp. The pinned xterm image
  pipeline can block the entire terminal write queue — not just its image
  callback — so the v1.9.23 per-handler timeout was insufficient. Sessions now
  use omp's safe text attachment fallback for images, matching Windows Terminal:
  later tool output and the input footer always continue rendering.
- Added a renderer write-queue watchdog. If a future xterm parser blocks the
  screen while the PTY is alive, the tab shows **Reset view**, which rebuilds
  the terminal around that live session and requests an omp repaint.

### Removed
- The unsafe IIP image addon and its stream rewriter.

## [1.9.23] — 2026-09-11

### Changed
- Added the initial per-handler IIP timeout mitigation. Superseded by v1.9.24:
  the image pipeline could still block before the guarded callback ran.
