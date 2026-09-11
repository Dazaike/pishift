# Changelog

All notable changes to PiShift are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.9.23] — 2026-09-11

### Fixed
- Terminal no longer goes permanently blank after an inline image lands in the
  session (e.g. `adb screencap` frames). The IIP handler's decode promise could
  dangle forever and hold xterm's write queue, so every later frame — including
  omp's input footer — queued behind the image while the PTY kept flowing with
  no stall banner. The handler is now raced against a 2.5s settle timeout
  (`src/renderer/iip-guard.ts`); worst case is one degraded image, never a dead
  session. Resume briefly looking normal then blanking was this same bug.

### Added
- `test/iip-guard.test.ts`: regression coverage for the handler guard
  (dangling promise, rejection, sync passthrough/throw, timer cleanup).
