# Changelog

All notable changes to PiShift are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.9.32] — 2026-09-18

### Added
- **Activity sections.** A run of thinking and tool calls is now one continuous, collapsible section headed by the work it did and how long it took — `ACTIVITY · 11 edits, 5 reads, 2 searches · 3m 04s` — instead of a separate card per event. The section spans consecutive assistant rows, so think → tool → think → tool → think reads as one sequence and ends when the reply's prose begins.
- **Tool Density** under Settings → Chat View, now a two-stop control: **Compact** (default) leaves every activity section, tool row, and reasoning block folded; **Detailed** opens them all. Density decides default expansion only — never layout.
- **Show Raw Text on Expand** (Compact only): manually expanding a tool prints a literal developer view — verb and path, `Lines 24–61`, the command, the diff, the content actually written or read — instead of the polished card. The preference persists and is hidden and ignored while Detailed is active.
- Disclosure animation on every collapsible in the transcript via `::details-content` + `interpolate-size`, plus hover/press feedback on each summary and a fade-slide for steps that arrive while you are watching.
- Live status is now inline muted subtext with a shimmer sweep; a change of activity slides the old word up and out and the new one in, and the elapsed counter ticks without restarting the animation.

### Changed
- **Markdown renders while the reply is being written.** Previously only the first delta was rendered and everything after it streamed as plain text until the persisted row replaced it. The in-flight reply is now split into fence-aware markdown blocks and only the changed tail block re-renders, so headings, bold, lists, and code fences appear as they are typed while finished blocks above are never touched.
- One expanded design for both densities. The per-call card border, the Compact one-line preview, and the burst-summary sentence are gone; every tool row is borderless and opens onto the same body.
- A **write** renders as an all-green diff of the content it wrote instead of dumping its arguments JSON and the harness acknowledgement.
- An **edit** shows only the change. Replaced spans are named from the patch (`− lines 4–13, 20 replaced (11)`) rather than a bare count; the raw patch text and the post-edit file echo are no longer printed.
- A **read** shows `Lines 24–61` (from the path selector, else derived from the printed numbering) plus its content, with no arguments JSON.
- Diffs and payloads scroll on both axes instead of truncating at ten lines with a `+N more lines` tail.
- omp's reclaimed-read placeholder renders as a muted note rather than as file content.
- Completed activity rows dropped the trailing success check-mark and the duplicate timestamp that floated inside the box; running and failed markers stay.
- Chat View tool calls render as readable activity lines built from the call's own payload (file names with `+added`/`−removed` counts, commands with their intent, search patterns with their target file) instead of raw name/JSON cards.
- Persisted reasoning rows read "Thought" instead of "Thinking"/"Reasoning"; the live row still says "Thinking" while it is being written.

### Fixed
- Chat View no longer blanks a few seconds after opening. The transcript watcher emits an empty replacement whenever it re-resolves a file that has not been written yet (late `ompSessionId`, `/resume`), and the old guard ignored those only when the resolved path was null — so the rendered conversation was wiped and came back only after switching to Terminal and away. An empty replacement can never clear rendered rows now; only a real session switch does.
- Resuming a chat from omp's own picker (or `/resume` typed in the terminal) shows the transcript immediately instead of waiting for your next keystroke. The control-bridge dedupe fingerprint omitted `ompSessionId` and `cwd`, and an omp-side resume changes nothing else, so the status was never broadcast to the renderer.

### Removed
- The **Balanced** density. Its behavior is the new Compact default.
- **Auto-expand Tool Activity in Chat View** and **Auto-expand Reasoning in Chat View**; Tool Density is now the only control over what opens automatically.

## [1.9.31] — 2026-09-17

### Added
- "Backup & Restore" section in Settings: **Export Settings** saves your theme, fonts, models, activity colors, interface layout, paste, and usage-tracker preferences to a JSON file; **Import Settings** loads them back in (from this machine or another). Window position, the active tab list, recent folders, and the local omp executable path are never included — only portable preferences travel.
- Linux packaging: PiShift now ships as an **AppImage** and a **.deb** alongside the Windows installer, built via electron-builder's `linux` target. A GitHub Actions workflow (`.github/workflows/build-linux.yml`) builds both on `ubuntu-latest` and attaches them to every tagged release automatically.

### Fixed
- The Windows installer no longer ships an unused `.exe.blockmap` file — NSIS `differentialPackage` support (for an in-app auto-updater PiShift doesn't have) is now disabled.

## [1.9.30] — 2026-09-16

### Added
- "Combined scale" setting under Settings → Usage Tracker → Combine multi-account usage, letting you choose how combined quotas are capped: **100%** (averages accounts down to a flat 0-100 scale, the original math) or **200%** (sums each account's percentage and raises the ceiling by 100 per account, the current default from 1.9.29).

## [1.9.29] — 2026-09-14

### Changed
- Combined multi-account usage now sums each account's percentage instead of averaging it. Combining accounts raises the ceiling by 100% per account (two accounts → 200% max), so one account at 100% plus another at 30% now correctly shows 130% used out of 200% instead of a misleading 21% average. Bars, rings, and tier coloring scale against the new per-combo ceiling instead of clipping at 100%.

## [1.9.28] — 2026-09-14

### Added
- Multi-account differentiation: Provider quotas in the popover and side panel now display the account email or account ID alongside provider names instead of showing duplicate bare titles.
- Combined multi-account usage option: Added a "Combine multi-account usage (e.g. Anthropic, OpenAI)" setting under Settings → Usage Tracker that aggregates usage across multiple accounts into a single average quota indicator for the top bar and settings list.
- Account details in top bar usage tooltips and accessibility labels for unambiguous identification.

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
