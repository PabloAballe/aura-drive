# AuraDrive - Duplicate Cleaner & Stale Files Archiver

> **Reclaim disk space safely. No cloud logins, 100% private, offline, and with a complete Undo safety net.**

AuraDrive is a minimalist, local-first web utility designed to solve two main storage problems on your hard drive or cloud folders without complex scripts or privacy risks:

1. **Duplicate files**: Finding identical copies of files scattered across folders and safely cleaning them.
2. **Old / Forgotten files**: Ranking files that haven't been modified in a long time (e.g. 6 months or 1 year) by size, allowing you to archive them.

---

## ✨ Features

* 🛡️ **100% Offline & Private**: Runs entirely inside your web browser. Your directories and files never leave your computer.
* ↩️ **Session Undo (Safety Net)**: Every move or cleanup is fully reversible. If you delete duplicates or archive old files and regret it, one click on the **Undo** button restores them back to their exact original paths.
* 🗑️ **Duplicates Cleanup**: Automatically groups identical files (by name proxy and size) and moves copies to a `_Trash/` folder.
* 📅 **Stale Files Ranking**: Set your preferred age threshold (e.g., 90, 180, or 360 days) to see a list of old files ranked by size (largest first), showing you exactly what is wasting the most space. Click **Archive** to move them into an `_Archive/` folder preserving their original folder structure.

---

## 🚀 Quick Start (React + TypeScript + Vite)

AuraDrive is hosted on GitHub Pages:
👉 **[Open AuraDrive Live](https://pabloaballe.github.io/aura-drive/)**

To run it locally in development mode:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/PabloAballe/aura-drive.git
   ```
2. **Launch dev environment**:
   - On **Windows**: Double-click `run.bat` (automatically configures local node paths and opens the browser).
   - Alternatively (any OS): Run `npm install` and then `npm run dev`.

*Note: File System Access API is recommended on Google Chrome, Microsoft Edge, or Opera.*
