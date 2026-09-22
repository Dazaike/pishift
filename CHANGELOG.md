# Changelog

All notable changes to PiShift are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.0.0] — 2026-09-21

### Added
- **Inline plan review.** A plan awaiting review now appears as a card at the conversation tail with the full plan, context stats, and its own buttons — **Approve and Execute**, **Approve in Compact Context**, **Approve and Keep Context**, **Refine Plan**, **Save and Quit**, **Quit** — including a spinner while the context is being compacted. The sheet is no longer the only way to answer a plan.
- **Inline questions.** Questions now appear as cards at the bottom of the conversation: single- and multi-select options, `(Recommended)` markers, an **Other** option with its own text field, a progress counter, and validation that blocks submission until every required question is answered. No floating modal steals the conversation.
- **Activity Orb.** The live activity header carries an animated orb whose motion follows what the agent is doing — solving while thinking, composing while replying, searching on reads, shaping on edits, working on shell commands — and it picks up the terminal's light or dark background automatically.
- **Composer beam.** In Chat View the composer is wrapped in a layered, drifting border beam with an orbiting traveler while the agent is thinking or working.
- **Context Window popover.** The dock's Context button opens a real breakdown: a circular usage ring, total and free tokens, the reserved auto-compaction buffer, and where the rest went — system overhead, your input, thinking, assistant output, and tool calls — plus buttons to refresh or run `/compact`.
- **Context Tracker settings section.** New sidebar section — "Track active conversation context tokens and limit percentage in the bottom dock" — with **Dock Display Mode**: *Dock Button + Popover*, *Combined into Usage Popover*, or *Hidden (Off)*.
- **Show Ask Question Popups** and **Show Plan Review Sheet** toggles under Settings → Interface. Off keeps questions and plan reviews in the terminal — no sheet, no chime, no notification.
- **Show Live Thinking Automatically** under Settings → Chat View unfolds reasoning while it is still being written; **Auto-expand Activity Sections** (Compact only) starts activity groups open.
- **Live tool activity.** Tool calls now appear the moment the agent starts writing them, before the tool has run, named by what they are acting on — the file, the command, the search — with a rolling preview of content as it is written. Chat View shows work as it happens rather than after it lands.
- **Model reordering in the Model popover.** Edit mode gains a **Reorder** toggle with drag handles and keyboard-reachable `▲`/`▼` buttons for resequencing custom models, plus a sliding highlight that tracks hover and arrow-key navigation across cards.
- **Kill jobs from the To-Do panel.** Running subagent and background rows carry an inline `×` that ends the job without opening terminal job controls.
- Provider icons for Antigravity, Vertex AI, OpenAI Codex, DeepSeek, xAI, OpenRouter, NanoGPT, Devin, and LiteLLM, plus the option to point a provider at your own image.
- Skeleton rows shimmer in the Usage popover while limits load, then cards stagger in and progress bars fill.
- Reopening a window picks up the current state of every active session immediately instead of waiting for the next update.
- Links to local files in a reply are now clickable.

### Changed
- **The view toggle and the working directory moved to the top bar.** Chat/Terminal switching now sits in the header next to the usage meter, and in Chat View the folder path moves up there too — leaving a centered composer that is only a message box.
- **Sliding highlights across the toolbars.** The dock and the top bar now run two indicators: a glass pill that locks onto whatever is active or open, and a faster one that follows your pointer. Buttons, window controls, session tabs, and attachment chips all move on springs.
- **Windows stop fighting over status.** Every session now tracks its own live state, so two PiShift windows running at once no longer overwrite each other's activity, tokens, or model.
- **Tool rows complete in place.** A running tool flips to finished or failed the moment its result arrives, instead of waiting for the next row to appear.
- Chat View renders the real saved plan rather than an excerpt of it.
- Rate-limit names drop redundant "(shared)" and "(pooled)" suffixes on compact cards — the full name stays in the tooltip — and cards sort by shortest reset window.
- Background job rows show `claude-opus-5`, not `anthropic/claude-opus-5`.
- Background job updates no longer overwrite the session's own activity status.

### Fixed
- **Questions with several parts.** Confirming **Other** text on a middle question no longer reopens the text editor, and the last question no longer wraps back around to the first. Pasted text with line breaks or escape characters can no longer submit or cancel the dialog on your behalf.
- **Context percentage after a compaction or `/clear`.** Compacted history no longer inflates the context bar, context cleared with `/clear` is never counted against the next prompt, and an interrupted turn no longer reports usage collapsing to zero.
- A missing or zero token limit shows 0% instead of `NaN%` in the context ring.
- Sliding highlights no longer jump when fonts or icons finish loading, or after the window is resized.
- A half-written status file no longer drops the other running sessions from view.

### Removed
- The old composer glow, replaced by the new border beam.
- The fixed telemetry port — each instance negotiates its own now, so concurrent windows never collide.

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
