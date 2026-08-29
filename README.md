<p align="center">
  <img src="build/icon.png" width="128" height="128" alt="PiShift Logo" style="border-radius: 28px;" />
</p>

<h1 align="center">PiShift</h1>

<p align="center">
  <strong>Because rawdogging a CLI agent inside a janky CMD prompt in 2026 is a cry for help.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/vibe-unapologetically%20fast-7aa2f7.svg" alt="Vibe" />
  <img src="https://img.shields.io/badge/ConPTY-native%20or%20bust-34d399.svg" alt="ConPTY" />
  <img src="https://img.shields.io/badge/BS%20level-0%25-f43f5e.svg" alt="No BS" />
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" />
</p>

---

## What is this?

Let’s be real for a second: **Oh My Pi (`omp`)** is great, but running it in a stock Windows terminal with broken image rendering, scuffed key chords, zero tab organization, and an input box that feels like typing into a toaster isn't it.

**PiShift** wraps the real `omp.exe` engine inside a sleek, GPU-accelerated ConPTY desktop shell that actually respects your time, your eyes, and your RAM.

No fake web-view wrappers pretending to be terminals. Just a genuine hardware-accelerated terminal with a native control dock that does what you actually want it to do.

---

## 🖼️ Screenshots

### Main Window
<p align="center">
  <img src="https://images.guns.lol/fb790494e15181d40c662760276c78639851a223/6eCNL1.jpg" alt="PiShift main window" width="900" />
</p>

### Settings Window
<p align="center">
  <img src="https://images.guns.lol/fb790494e15181d40c662760276c78639851a223/UnCqFr.png" alt="PiShift settings window" width="900" />
</p>

### Custom Theme
<p align="center">
  <img src="https://images.guns.lol/fb790494e15181d40c662760276c78639851a223/Iw58pF.jpg" alt="PiShift custom theme" width="900" />
</p>

---

## ⚡ What makes it not suck

### 🚀 Actual Terminal Hardware Acceleration
- **WebGL xterm.js under the hood:** You type, it appears. Sub-millisecond. Groundbreaking concept, we know.
- **iTerm2 Inline Graphics (IIP):** Images render *inside* the terminal. Not as a broken base64 dump, not as an ASCII smudge. Actual images.
- **Kitty Keyboard Protocol:** Your chords and modifier keys actually work instead of getting swallowed by Windows console legacy ghosts.

### 🎛️ A Dock That Doesn’t Get In Your Way
- **Interactive Slash Autocomplete:** Stop memorizing 60+ slash commands. Type `/` and let the UI do the thinking.
- **Multi-Line Expanded Sheet:** Hit `Ctrl+Shift+E` (or `⤢`) when you need to write a thesis prompt instead of squinting at a single-line input.
- **Long-Paste Attachments:** Large text pastes collapse into a readable marker and can be attached as a wrapped block, local file, or inline content—without turning the composer into a scrollback buffer.
- **Drag-and-Drop Image Chips + Lightbox:** Drag an image in, get a nice thumbnail chip. Click it to zoom in full resolution. Shocking, right?
- **Real-Time Markdown Highlighting:** Code blocks, bolding, URLs, and paths highlight as you type.
- **Clickable Workspace Path:** Click the current folder path in the dock to open it in File Explorer. Because copying paths into Explorer like it's 2008 was always a bad plan.

### 🧠 Model & Reasoning Control for the Indecisive
- **Model Switcher:** Grid view, list view, drag-and-drop reordering. Put your favorites at the top where they belong.
- **One-Click Thinking Effort Cycle:** Stop typing `/m high` like a caveman. Just click through `Auto → Off → Min → Low → Medium → High → XHigh → Max`.
- **Honest Plan Mode:** One click always drives toward ON or OFF, but the button shows what omp is *actually* in — emerald `Plan: ON`, amber `Plan: PAUSED`, or `Plan: OFF` — and follows a `/plan` typed straight into the terminal. No optimistic lying.

### 🗂️ Tabs That Don’t Make You Want to Alt+F4
- **Right-Click Power Context Menu:**
  - *Open in File Explorer* (because searching folders in terminal navigation gets old fast).
  - *Copy Directory Path* (one click, in your clipboard).
  - *Duplicate Session* (spawn identical workspace instantly).
  - *Project Color Badges* (tag your tabs with colors so you stop mixing up repos).
  - *Inline Rename & Close Others*.
- **Drag-to-Reorder:** Because the tab you opened 5 hours ago shouldn't be trapped on the left forever.

### 🔌 Zero-Config Telemetry Bridge
- Uses an asynchronous UDP bridge (`127.0.0.1:37991`) to stream live agent activity (`idle`, `working`, `thinking`), token usage, and model states with **zero polling**.
- **Auto-installs** `control-bridge.ts` into your `~/.omp/agent/extensions/` on launch. You don't have to touch a config file. You're welcome.

### 🎨 28 Themes Because Aesthetics Matter
- 28 built-in palettes (Tokyo Night, Catppuccin, Gruvbox, Nord, Cyberpunk, Rose Pine, Synthwave...).
- Syncs the entire Windows titlebar overlay and frame colors so your dark mode doesn't get ruined by a blinding white caption bar.

### 🗃️ Quick-Switch Everything
- **Recent Chats Popover:** Fuzzy-search and resume any past session by working directory without leaving the keyboard.
- **Recent Folders Popover:** Jump straight to any workspace you've opened before.
- **App Menu Popover:** The old "Usage" window is now a fast vertical popover (Todo, Settings, Relaunch, Quit) instead of a separate window — matches the Model/Thinking menu feel.
- **Native-Feeling Ask & Confirm Dialogs:** In-app modals replace blocking OS prompts for destructive actions and quick input.
- **Live Activity Sync:** Tab titles and status reflect the agent's actual state (`idle`, `working`, `thinking`) in real time instead of the generic "Temp" default.
- **Stall Recovery That Doesn’t Lie:** A frozen terminal output stream gets an explicit Resume or Kill action; long-running tools show elapsed time instead of pretending they vanished into the void.

---

## 🛠️ How to run it

### Download the binary (for people with places to be)
Grab the latest release from the **[Releases](https://github.com/Dazaike/pishift/releases)** tab:
- **`PiShift Setup <version>.exe`** — Standard installer.
- **`PiShift-<version>-win.zip`** — Portable zip if you have installer commitment issues.

### Build from source (for hackers & tinkerers)

```bash
# Clone the repo
git clone https://github.com/Dazaike/pishift.git
cd pishift

# Install dependencies (fast)
bun install

# Run the dev app
bun run dev

# Package production installer & portable zip
bun run dist
```

---

## ⌨️ Shortcuts You'll Actually Use

| Shortcut | What it does |
| :--- | :--- |
| `Ctrl+Shift+T` | New tab in current working directory |
| `Ctrl+Shift+W` | Close active tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Cycle tabs |
| `Ctrl+1` – `Ctrl+9` | Jump directly to tab N |
| `Ctrl+Shift+E` | Expand / collapse big prompt sheet |
| `Ctrl+F` | Find text in terminal output |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / Zoom out / Reset font size |
| `Ctrl+Shift+R` | Restart the session (when your agent goes rogue) |
| `Esc` | Cancel / dismiss overlay / stop thinking |

---

## 📜 License

MIT © [Dazaike](https://github.com/Dazaike). Do whatever you want with it, just don't make slow software.
