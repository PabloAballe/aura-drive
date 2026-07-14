# AuraDrive

> **Reclaim the peace of mind of a clean workspace. No complex scripts, no cloud logins, and a complete safety net.**

We all know the stress of a chaotic Downloads or Desktop folder overflowing with files named `Invoice_temp_2026_final.pdf`, duplicate screenshots in three different subfolders, and miscellaneous code files. Cleaning it up is boring and time-consuming, and doing it quickly runs the risk of accidentally deleting something important.

**AuraDrive** is a minimalist, local-first web app that organizes your folder chaos in seconds, running entirely in your browser offline.

---

## ✨ Why AuraDrive?

* 🛡️ **Absolute Privacy (100% Offline)**: Your files never leave your computer. All analysis, renaming, and routing occur inside your browser using the native File System Access API.
* ↩️ **Safety Net (Interactive Undo)**: Organize without fear. If you don't like the new folder structure, click **Undo** to instantly restore every file back to its original name and path, and clean up empty folders created during the process.
* 🎯 **Smart Conflict Prevention**: If two different files would end up with the same proposed name (e.g. two separate utility bills from the same day), AuraDrive automatically appends numerical suffixes (`_1.pdf`) and alerts you in the preview grid to avoid overwriting data.
* 🗑️ **Duplicate Cleanup**: Group identical files by size and name similarity, allowing you to move them to a virtual trash folder (`_Trash/`) with a single click (reversible with Undo).
* ☁️ **Zero-API Cloud Sync**: Organize your cloud storage (Google Drive or OneDrive) without configuring OAuth consoles or developer credentials. Simply select your local Google Drive or OneDrive synced folder; your official desktop client will upload the organized structure automatically.

---

## 🛠️ How It Works (In 3 Steps)

1. **Drop Your Folder**: Drag any cluttered folder from your file manager and drop it into AuraDrive.
2. **Review Proposed Changes**: See a side-by-side preview of what will change, which folders will be created, and which duplicates will be trashed.
3. **Organize**: Click **Organize Folder** to execute the changes instantly on your drive.

---

## 🚀 Quick Start (React + Vite)

AuraDrive is live and hosted on GitHub Pages:
👉 **[Open AuraDrive Live](https://pabloaballe.github.io/aura-drive/)**

Alternatively, you can run it locally in development mode:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/PabloAballe/aura-drive.git
   ```
2. **Start the local server**:
   - On **Windows**: Double-click on `run.bat` (it automatically handles local node paths).
   - Alternatively (any OS): Run `npm install` and then `npm run dev`.
3. **Open in browser**:
   Navigate to: [http://localhost:5173](http://localhost:5173)

*Note: For the best local scanning experience, we recommend using Google Chrome, Microsoft Edge, or Opera.*
