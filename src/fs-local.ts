/**
 * fs-local.js - Refactored File System Access Handler with Archive & Undo Support
 * Handles scanning local folders, moving duplicates to trash, archiving old files, and reversing actions.
 */

class LocalFSManager {
  constructor() {
    this.rootDirHandle = null;
    this.fileHandlesMap = new Map(); // relativePath -> FileSystemFileHandle
    this.parentHandlesMap = new Map(); // relativePath -> FileSystemDirectoryHandle (parent)
    this.createdDirectories = new Set(); // Directories created by us during execution
    this.transactionHistory = []; // Transaction logs for Undo support
  }

  reset() {
    this.rootDirHandle = null;
    this.fileHandlesMap.clear();
    this.parentHandlesMap.clear();
    this.createdDirectories.clear();
    this.transactionHistory = [];
  }

  isSupported() {
    return 'showDirectoryPicker' in window;
  }

  async selectRootDirectory() {
    if (!this.isSupported()) {
      throw new Error("File System Access API is not supported by your browser.");
    }
    
    this.reset();
    this.rootDirHandle = await window.showDirectoryPicker({
      mode: 'readwrite'
    });
    return this.rootDirHandle;
  }

  /**
   * Recursively scans directories
   */
  async scan(dirHandle = this.rootDirHandle, currentRelativePath = '', recursive = true) {
    const filesList = [];
    
    for await (const entry of dirHandle.values()) {
      const entryPath = currentRelativePath ? `${currentRelativePath}/${entry.name}` : entry.name;
      
      if (entry.kind === 'file') {
        try {
          const file = await entry.getFile();
          
          this.fileHandlesMap.set(entryPath, entry);
          this.parentHandlesMap.set(entryPath, dirHandle);

          filesList.push({
            name: entry.name,
            path: entryPath,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            relativePath: entryPath,
            source: 'local'
          });
        } catch (e) {
          console.error("Error reading file metadata", entry.name, e);
        }
      } else if (entry.kind === 'directory' && recursive) {
        // Skip hidden folders, trash and archives
        if (!entry.name.startsWith('.') && entry.name !== '_Trash' && entry.name !== '_Archive') {
          const subFiles = await this.scan(entry, entryPath, recursive);
          filesList.push(...subFiles);
        }
      }
    }
    
    return filesList;
  }

  /**
   * Resolves or creates a nested subfolder structure starting from root.
   */
  async getOrCreateDirectory(pathString) {
    if (!pathString || pathString === '.' || pathString === '/') {
      return this.rootDirHandle;
    }

    const parts = pathString.split('/').filter(p => p.length > 0);
    let currentDir = this.rootDirHandle;
    let accumulatedPath = '';

    for (const part of parts) {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part;
      
      let exists = true;
      try {
        await currentDir.getDirectoryHandle(part, { create: false });
      } catch (e) {
        exists = false;
      }

      currentDir = await currentDir.getDirectoryHandle(part, { create: true });
      
      if (!exists) {
        this.createdDirectories.add(accumulatedPath);
      }
    }

    return currentDir;
  }

  /**
   * Cleans duplicates by trashing, deleting, or renaming them.
   */
  async cleanDuplicates(duplicatesToClean, strategy = 'trash', progressCallback = null) {
    if (!this.rootDirHandle) throw new Error("No root directory selected.");
    
    this.transactionHistory = []; // Reset history for this session
    const total = duplicatesToClean.length;
    let count = 0;

    let trashDirHandle = null;
    if (strategy === 'trash' && total > 0) {
      trashDirHandle = await this.rootDirHandle.getDirectoryHandle('_Trash', { create: true });
      this.createdDirectories.add('_Trash');
    }

    for (const file of duplicatesToClean) {
      const fileHandle = this.fileHandlesMap.get(file.path);
      const parentHandle = this.parentHandlesMap.get(file.path);

      if (!fileHandle || !parentHandle) {
        count++;
        continue;
      }

      if (progressCallback) {
        progressCallback(count, total, `Cleaning duplicate: ${file.name}`);
      }

      try {
        if (strategy === 'trash') {
          await this.moveFile(fileHandle, parentHandle, trashDirHandle, file.name);
          this.transactionHistory.push({
            type: 'trash',
            fileHandle,
            sourceParentHandle: parentHandle,
            targetParentHandle: trashDirHandle,
            sourceName: file.name,
            targetName: file.name
          });
        } else if (strategy === 'delete') {
          await parentHandle.removeEntry(fileHandle.name);
          // Can't undo permanent deletions
        } else {
          // Rename with prefix
          const renamedName = `[DUPLICATE]_${file.name}`;
          await this.moveFile(fileHandle, parentHandle, parentHandle, renamedName);
          this.transactionHistory.push({
            type: 'rename',
            fileHandle,
            sourceParentHandle: parentHandle,
            targetParentHandle: parentHandle,
            sourceName: file.name,
            targetName: renamedName
          });
        }
      } catch (e) {
        console.error("Failed to clean duplicate:", file.path, e);
      }
      count++;
    }

    if (progressCallback) progressCallback(total, total, "Completed");
  }

  /**
   * Archives selected old files to an _Archive folder, preserving their relative subpath.
   */
  async archiveFiles(filesToArchive, progressCallback = null) {
    if (!this.rootDirHandle) throw new Error("No root directory selected.");

    this.transactionHistory = []; // Reset history for this session
    const total = filesToArchive.length;
    let count = 0;

    // Create base _Archive directory
    const archiveRootHandle = await this.rootDirHandle.getDirectoryHandle('_Archive', { create: true });
    this.createdDirectories.add('_Archive');

    for (const file of filesToArchive) {
      const fileHandle = this.fileHandlesMap.get(file.path);
      const parentHandle = this.parentHandlesMap.get(file.path);

      if (!fileHandle || !parentHandle) {
        count++;
        continue;
      }

      if (progressCallback) {
        progressCallback(count, total, `Archiving: ${file.name}`);
      }

      try {
        // Resolve target folder path under _Archive matching original subdirectories
        const parentPathIndex = file.path.lastIndexOf('/');
        const subfolderPath = parentPathIndex !== -1 ? file.path.substring(0, parentPathIndex) : '';
        
        let targetDirHandle = archiveRootHandle;
        if (subfolderPath) {
          targetDirHandle = await this.getOrCreateDirectory(`_Archive/${subfolderPath}`);
        }

        await this.moveFile(fileHandle, parentHandle, targetDirHandle, file.name);

        this.transactionHistory.push({
          type: 'archive',
          fileHandle,
          sourceParentHandle: parentHandle,
          targetParentHandle: targetDirHandle,
          sourceName: file.name,
          targetName: file.name
        });
      } catch (e) {
        console.error("Failed to archive file:", file.path, e);
      }
      count++;
    }

    if (progressCallback) progressCallback(total, total, "Completed");
  }

  /**
   * Reverses operations recorded in the last execution (restoring original files).
   */
  async undo(progressCallback = null) {
    if (this.transactionHistory.length === 0) {
      throw new Error("No operations recorded to undo.");
    }

    const total = this.transactionHistory.length;
    let count = 0;

    // Process transactions in reverse order
    for (let i = total - 1; i >= 0; i--) {
      const tx = this.transactionHistory[i];

      if (progressCallback) {
        progressCallback(count, total, `Restoring: ${tx.sourceName}`);
      }

      try {
        let currentFileHandle = null;
        try {
          currentFileHandle = await tx.targetParentHandle.getFileHandle(tx.targetName);
        } catch (e) {
          currentFileHandle = tx.fileHandle;
        }

        await this.moveFile(currentFileHandle, tx.targetParentHandle, tx.sourceParentHandle, tx.sourceName);
      } catch (e) {
        console.error("Error undoing transaction for", tx.sourceName, e);
      }
      count++;
    }

    // Attempt to remove empty directories created by us
    const dirsToRemove = Array.from(this.createdDirectories).sort((a, b) => b.split('/').length - a.split('/').length);
    for (const dirPath of dirsToRemove) {
      try {
        const parts = dirPath.split('/');
        const dirName = parts.pop();
        const parentPath = parts.join('/');
        
        const parentDirHandle = await this.getOrCreateDirectory(parentPath);
        // Will fail silently if not empty, which is safe
        await parentDirHandle.removeEntry(dirName, { recursive: false });
        this.createdDirectories.delete(dirPath);
      } catch (e) {
        // Directory not empty or already removed, ignore
      }
    }

    this.transactionHistory = [];
    if (progressCallback) {
      progressCallback(total, total, "Undo completed");
    }
  }

  /**
   * Helper to write/move file handle
   */
  async moveFile(fileHandle, sourceDirHandle, targetDirHandle, targetName) {
    if (sourceDirHandle === targetDirHandle && fileHandle.name === targetName) {
      return;
    }

    if (typeof fileHandle.move === 'function') {
      try {
        await fileHandle.move(targetDirHandle, targetName);
        return;
      } catch (e) {
        console.warn("modern move() failed, falling back to copy+delete", e);
      }
    }

    const targetFileHandle = await targetDirHandle.getFileHandle(targetName, { create: true });
    const file = await fileHandle.getFile();
    const writable = await targetFileHandle.createWritable();
    await writable.write(file);
    await writable.close();
    
    await sourceDirHandle.removeEntry(fileHandle.name);
  }
}

export const localFS = new LocalFSManager();
