# Changelog

All notable changes to PiShift are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.0.0] — 2026-09-21

### Added
- **Inline plan review.** A plan awaiting review now renders as a card at the conversation tail with the full markdown plan, context stats, and its own buttons — **Approve and Execute**, **Approve in Compact Context**, **Approve and Keep Context**, **Refine Plan**, **Save and Quit**, **Quit** — including a compacting spinner while omp rewrites the context. The sheet is no longer the only way to answer a plan. (`src/renderer/chat-view.ts`)
- **Inline questions.** `ask` prompts appear as in-flow cards at the bottom of the transcript: single- and multi-select options, `(Recommended)` markers, an **Other** option with its own text field, a progress counter, and validation that blocks submission until every required question is answered. No floating modal steals the conversation. (`src/renderer/chat-inline-ask.ts`)
- **Activity Orb.** The live activity header carries an animated orb whose gesture follows what the agent is doing — solving while thinking, composing while replying, searching on reads, shaping on edits, working on shell commands — and it picks up the terminal's light or dark background automatically. (`src/renderer/activity-orb.ts`)
- **Composer beam.** In Chat View the composer dock is wrapped in a layered, drifting border beam with an orbiting traveler while the agent is thinking or working. (`src/renderer/chat-composer-beam.ts`)
- **Context Window popover.** The dock's Context button opens a real breakdown: a circular utilization ring, total and free tokens, the reserved auto-compaction buffer, per-slice accounting for system overhead, your input, thinking, assistant output, and tool calls, plus buttons to refresh or run `/compact`. (`src/renderer/usage-modal.ts`, `src/renderer/usage-render.ts`)
- **Context Tracker settings section.** New sidebar section — "Track active conversation context tokens and limit percentage in the bottom dock" — with **Dock Display Mode**: *Dock Button + Popover*, *Combined into Usage Popover*, or *Hidden (Off)*. (`src/renderer/settings.ts`)
- **Show Ask Question Popups** and **Show Plan Review Sheet** toggles under Settings → Interface. Off keeps questions and plan reviews in the terminal — no sheet, no chime, no notification. (`src/renderer/settings.ts`)
- **Show Live Thinking Automatically** under Settings → Chat View unfolds reasoning while it is still being written; **Auto-expand Activity Sections** (Compact only) starts activity groups open. (`src/renderer/settings.ts`)
- **Live tool-call streaming.** The control bridge publishes in-flight steps as their arguments stream in, before the tool has run, with the subject extracted (`path`, `command`, or search pattern) and a rolling preview of the content being written. Chat View shows work as it happens rather than after it lands. (`extensions/control-bridge.ts`, `src/shared/ipc.ts`)
- **Model reordering in the Model popover.** Edit mode gains a **Reorder** toggle with drag handles (`⋮⋮`) and keyboard-reachable `▲`/`▼` buttons for resequencing custom models, plus a sliding pill that tracks hover and arrow-key navigation across cards. (`src/renderer/model-modal.ts`)
- **Kill jobs from the To-Do panel.** Running subagent and background rows carry an inline `×` that terminates the job without opening terminal job controls. (`src/renderer/todo-panel.ts`)
- Provider glyphs for `google-antigravity`, `google-vertex`, `openai-codex`, `deepseek`, `xai-oauth`, `openrouter`, `nanogpt`, `devin`, and `litellm`, with custom image URL overrides. (`src/renderer/provider-icons.ts`)
- Skeleton rows shimmer in the Usage popover while limits load, then cards stagger in and progress bars fill. (`src/renderer/usage-modal.ts`)
- `control-bridge:read-status` lets the renderer pull the last-known state of every active session straight from the main process instead of waiting for the next datagram. (`src/shared/ipc.ts`, `src/preload/index.ts`)
- Markdown links to `file:` URIs are treated as safe and render clickable. (`src/shared/markdown.ts`)

### Changed
- **The view toggle and the working directory moved to the top bar.** Chat/Terminal switching now sits in the header next to the usage meter, and in Chat View the cwd path moves up there too — leaving a centered 720px composer that is only a message box. (`src/renderer/index.html`, `src/renderer/main.ts`)
- **Dual sliding pills across the toolbars.** Dock control groups and the top bar actions row run two indicators: a glass pill that locks onto the active or open control with spring physics, and a faster hover pill that tracks the pointer. Buttons, window controls, session tabs, and attachment chips all move on springs. (`src/renderer/motion-utils.ts`, `src/renderer/dock.ts`)
- **Per-session runtime status.** The bridge writes `~/.omp/agent/runtime-status/<sessionId>.json` instead of one shared file, and PiShift binds an OS-assigned ephemeral UDP port passed to each session as `PISHIFT_CONTROL_BRIDGE_PORT`. Concurrent windows stop overwriting each other's state. (`extensions/control-bridge.ts`, `src/main/control-bridge-listener.ts`)
- **Tool rows complete in place.** Streaming now diffs full row content signatures rather than row IDs, so a running tool flips to completed or errored the moment the outcome hits disk. (`src/main/transcript.ts`)
- Plans referenced as `local://` artifacts are read from the session's own store, so Chat View renders the canonical plan instead of a transcript excerpt. (`src/main/transcript.ts`)
- Rate-limit names drop redundant `(shared)`/`(pooled)` suffixes on compact cards — the full qualifier stays in the tooltip — and cards sort by shortest reset window. (`src/renderer/usage-render.ts`)
- Background job rows show `claude-opus-5`, not `anthropic/claude-opus-5`. (`src/renderer/todo-panel.ts`)
- Bridge updates distinguish `session` telemetry from `jobs` updates, so job polling no longer clobbers session state. (`src/shared/ipc.ts`)

### Fixed
- **Ask dialogs with several questions.** After confirming **Other** text on an intermediate question the bridge sends `ArrowRight` instead of `Enter`, so the inline editor no longer reopens; the final question no longer sends a trailing `ArrowRight` that wrapped back to the first. Custom text is stripped of CR, LF, and ESC so a pasted newline can't submit or cancel the dialog. (`src/shared/ask-keys.ts`)
- **Context percentage after a compaction or `/clear`.** Tokens removed by a history rewrite are deducted from the prompt total instead of inflating the bar, and the parent-chain walk stops at a `/clear` boundary so wiped context is never attributed to the next prompt. Aborted turns with zeroed counts are skipped rather than reported as a collapse to zero. (`src/shared/transcript.ts`)
- A zero or missing token limit renders 0% and 0 tokens instead of `NaN%` in the context ring. (`src/renderer/usage-render.ts`)
- Sliding pills account for ancestor CSS transform scale and snap on reflow, so they stop jumping when fonts or icons finish loading. (`src/renderer/motion-utils.ts`)
- A malformed or half-written status file is skipped without dropping the other active sessions. (`src/main/control-bridge-listener.ts`)

### Removed
- `src/renderer/dock-glow.ts` and the `animejs` dependency; the composer glow is now the `border-beam` effect. (`src/renderer/dock.ts`)
- The fixed UDP port `37991` as the bridge's only channel — the port is negotiated per instance now.

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
