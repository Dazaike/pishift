<p align="center">
  <img src="build/icon.png" width="128" height="128" alt="PiShift Logo" style="border-radius: 28px;" />
</p>

<h1 align="center">PiShift</h1>

<p align="center">
  <strong>Modern, high-performance desktop terminal shell for Oh My Pi (<code>omp</code>).</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20ConPTY-blue.svg" alt="Platform: Windows" />
  <img src="https://img.shields.io/badge/Electron-43.x-47848F.svg" alt="Electron 43" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6.svg" alt="TypeScript" />
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License: MIT" />
</p>

---

## Overview

**PiShift** wraps the genuine `omp.exe` CLI inside a sleek, GPU-accelerated ConPTY terminal backed by `xterm.js`, pairing it with an integrated native control dock, live token/usage tracking, model switcher, plan mode toggle, tab management, and real-time bidirectional telemetry bridge.

---

## ✨ Features

### 🖥️ Native ConPTY Terminal Engine
- **Hardware-Accelerated xterm.js:** Powered by WebGL rendering with sub-millisecond input response.
- **iTerm2 Inline Images (IIP):** Full inline graphics and image rendering support.
- **Kitty Keyboard Protocol:** Full enhanced keyboard support with native chord passing and modifier keys.
- **Auto-Fit & Responsive Layout:** Dynamic terminal geometry syncing across window resizes.

### 🎛️ Native Dock & Composer
- **Smart Command Autocomplete:** Instant interactive `/` slash menu with full command descriptions.
- **Multi-Line Expanded Sheet:** Expand composer into a full-height drafting sheet with `Ctrl+Shift+E` or the `⤢` button.
- **Drag-and-Drop Attachments:** Drop images and files directly into the dock with automatic thumbnail generation.
- **Image Lightbox Preview:** Click any image thumbnail chip to view a full-resolution zoomed preview dialog with metadata.
- **Live Markdown Syntax Highlighting:** Real-time syntax styling in the composer mirror.

### 🧠 Model & Reasoning Control
- **Quick Model Switcher:** Grid and list views, drag-and-drop model reordering, custom model management (`+ Add Model`, `Reorder`, `Delete`).
- **One-Click Thinking Effort Cycle:** Cycle through `Auto → Off → Min → Low → Medium → High → XHigh → Max`.
- **Binary Plan Mode:** Solid emerald green status indicator with instant `OFF ↔ ON` switching.

### 🗂️ Tab & Workspace Management
- **Tab Context Menu:** Right-click tabs for:
  - 📁 *Open in File Explorer*
  - 📋 *Copy Directory Path*
  - ➕ *Duplicate Session in Folder*
  - 🏷️ *Project Color Badges (6 pastel tags)*
  - ✏️ *Inline Rename*
  - ❌ *Close Other Tabs / Tabs to Right*
- **Drag-to-Reorder:** Horizontally reorder active sessions with visual drop placement indicators.
- **Smart Title Sync:** Automatic tab title resolution from OSC sequences, omp auto-titles, and folder names.

### 🛠️ Dock Tools Popover
- Built-in quick utilities menu (`⚙ Tools`) providing:
  - Copy Selection (`Ctrl+C`) / Paste (`Ctrl+V`)
  - Clear Screen (`Ctrl+L` / `\x0c`)
  - Scrollback Find Bar (`Ctrl+F`)
  - Zoom Controls (`Ctrl+=`, `Ctrl+-`, `Ctrl+0`)
  - Session Restart (`Ctrl+Shift+R`)

### 🎨 28 Theme Presets
- Switch between 28 curated palettes (Tokyo Night, Catppuccin Mocha, Gruvbox, Nord, Solarized, Cyberpunk, Rose Pine, Synthwave, and more).
- Automatically syncs titlebar overlay and native window frame accents.

### ⚡ Real-Time Control Bridge
- Zero-polling UDP telemetry listener (`127.0.0.1:37991`) syncing active model, thinking level, plan state, agent busy/thinking activity, and token usage metrics.
- Multi-tab session isolation via unique `OMPHIF_SESSION_ID` routing.
- Automatically installs/updates `~/.omp/agent/extensions/control-bridge.ts` on launch.

---

## 🚀 Getting Started

### Prerequisites
- Windows 10/11 (64-bit)
- [Oh My Pi (`omp`)](https://github.com/oh-my-pi/pi) installed in your PATH (or standard `%USERPROFILE%\AppData\Local\Programs\omp`)
- [Bun](https://bun.sh/) or [Node.js](https://nodejs.org/) (v20+)

### Running from Source

```bash
# Clone the repository
git clone https://github.com/Dazaike/pishift.git
cd pishift

# Install dependencies
bun install

# Run in development mode
bun run dev
```

### Packaging & Building

```bash
# Typecheck & run unit tests
bun run typecheck
bun run test

# Build production bundle
bun run build

# Package Windows installer (.exe) and portable zip (.zip)
bun run dist
```

Output files will be generated in the `release/` directory:
- `release/PiShift Setup <version>.exe` (NSIS Installer)
- `release/PiShift-<version>-win.zip` (Portable ZIP archive)
- `release/win-unpacked/PiShift.exe` (Standalone binaries)

---

## 🔌 Bundled Control Bridge Extension

PiShift comes bundled with the **Control Bridge Extension** (`extensions/control-bridge.ts`). 

When PiShift starts, it automatically ensures this extension is present in your Oh My Pi extensions folder (`~/.omp/agent/extensions/control-bridge.ts`).

The bridge communicates with PiShift over a local UDP socket to stream:
- Agent state (`idle`, `working`, `thinking`)
- Active model & provider
- Thinking effort level
- Plan mode status
- Session token and cost metrics

---

## ⌨️ Default Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl+Shift+T` | Open New Tab in Current Folder |
| `Ctrl+Shift+W` | Close Active Tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / Previous Tab |
| `Ctrl+1` – `Ctrl+9` | Jump to Tab 1–9 |
| `Ctrl+Shift+E` | Toggle Fullsheet Composer Expand |
| `Ctrl+F` | Find in Terminal Scrollback |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom In / Zoom Out / Reset Zoom |
| `Ctrl+Shift+R` | Restart Current Session |
| `Esc` | Interrupt / Dismiss Overlay |

---

## 📄 License

MIT © [Dazaike](https://github.com/Dazaike)
