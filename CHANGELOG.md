# Changelog

All notable changes to PiShift are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
