/**
 * fs-local.js - Refactored File System Access Handler with Undo Support
 * Handles folder scans, moving/renaming, virtual trashing, and reversing actions (Undo).
 */

class LocalFSManager {
  constructor() {
    this.rootDirHandle = null;
    this.fileHandlesMap = new Map(); // relativePath -> FileSystemFileHandle
    this.parentHandlesMap = new Map(); // relativePath -> FileSystemDirectoryHandle (parent)
    this.createdDirectories = new Set(); // Keep track of directories created by us
    this.transactionHistory = []; // Log of operations performed in the last execution
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
      throw new Error("La API de Acceso a Archivos no está soportada por tu navegador.");
    }
    
    this.reset();
    this.rootDirHandle = await window.showDirectoryPicker({
      mode: 'readwrite'
    });
    return this.rootDirHandle;
  }

  /**
   * Recursively scan directories
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
          
          let contentSnippet = '';
          if (file.size < 5 * 1024 * 1024 && (file.type.startsWith('text/') || /\.(txt|json|js|py|html|css|csv|xml|md)$/i.test(entry.name))) {
            try {
              contentSnippet = await file.slice(0, 1000).text();
            } catch (err) {
              console.warn("Error reading snippet for text file", entry.name, err);
            }
          }

          filesList.push({
            name: entry.name,
            path: entryPath,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            relativePath: entryPath,
            source: 'local',
            contentSnippet: contentSnippet
          });
        } catch (e) {
          console.error("Error reading entry metadata", entry.name, e);
        }
      } else if (entry.kind === 'directory' && recursive) {
        // Ignore dot folders and virtual trash
        if (!entry.name.startsWith('.') && entry.name !== '_Trash') {
          const subFiles = await this.scan(entry, entryPath, recursive);
          filesList.push(...subFiles);
        }
      }
    }
    
    return filesList;
  }

  /**
   * Gets or creates a directory path recursively.
   * Tracks newly created folders so we can remove them if we Undo.
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
   * Run clean and record the transaction log
   */
  async execute(filesToOrganize, duplicateStrategy = 'trash', progressCallback = null) {
    if (!this.rootDirHandle) {
      throw new Error("Directorio raíz no seleccionado.");
    }

    this.transactionHistory = []; // Reset history
    const total = filesToOrganize.length;
    let count = 0;

    let trashDirHandle = null;
    if (duplicateStrategy === 'trash') {
      const containsDuplicates = filesToOrganize.some(f => f.shouldProcess && f.isDuplicate);
      if (containsDuplicates) {
        trashDirHandle = await this.rootDirHandle.getDirectoryHandle('_Trash', { create: true });
        this.createdDirectories.add('_Trash');
      }
    }

    for (const item of filesToOrganize) {
      if (!item.shouldProcess) {
        count++;
        continue;
      }

      const fileHandle = this.fileHandlesMap.get(item.originalPath);
      const parentHandle = this.parentHandlesMap.get(item.originalPath);

      if (!fileHandle || !parentHandle) {
        console.error("Handles missing for path:", item.originalPath);
        count++;
        continue;
      }

      if (progressCallback) {
        progressCallback(count, total, `Organizando: ${item.originalName}`);
      }

      try {
        if (item.isDuplicate) {
          // --- DUPLICATE CLEANING ---
          if (duplicateStrategy === 'trash') {
            await this.moveFile(fileHandle, parentHandle, trashDirHandle, item.originalName);
            // Record transaction for undo
            this.transactionHistory.push({
              type: 'trash',
              fileHandle,
              sourceParentHandle: parentHandle,
              targetParentHandle: trashDirHandle,
              sourceName: item.originalName,
              targetName: item.originalName,
              originalRelativePath: item.originalPath
            });
          } else if (duplicateStrategy === 'delete') {
            await parentHandle.removeEntry(fileHandle.name);
            // Can't undo permanent deletions, write no undo entry
          } else {
            // Rename with prefix
            const renamedName = `[DUPLICADO]_${item.originalName}`;
            await this.moveFile(fileHandle, parentHandle, parentHandle, renamedName);
            this.transactionHistory.push({
              type: 'rename',
              fileHandle,
              sourceParentHandle: parentHandle,
              targetParentHandle: parentHandle,
              sourceName: item.originalName,
              targetName: renamedName,
              originalRelativePath: item.originalPath
            });
          }
        } else {
          // --- NORMAL ORGANIZING ---
          const targetDirHandle = await this.getOrCreateDirectory(item.proposedPath);
          await this.moveFile(fileHandle, parentHandle, targetDirHandle, item.proposedName);
          
          this.transactionHistory.push({
            type: 'move',
            fileHandle,
            sourceParentHandle: parentHandle,
            targetParentHandle: targetDirHandle,
            sourceName: item.originalName,
            targetName: item.proposedName,
            originalRelativePath: item.originalPath
          });
        }
      } catch (err) {
        console.error(`Failed to process file ${item.originalPath}:`, err);
      }

      count++;
    }

    if (progressCallback) {
      progressCallback(total, total, "Completado");
    }
  }

  /**
   * Reverses the actions performed in the last execution.
   */
  async undo(progressCallback = null) {
    if (this.transactionHistory.length === 0) {
      throw new Error("No hay operaciones registradas para deshacer.");
    }

    const total = this.transactionHistory.length;
    let count = 0;

    // Loop backwards to reverse actions
    for (let i = total - 1; i >= 0; i--) {
      const transaction = this.transactionHistory[i];
      
      if (progressCallback) {
        progressCallback(count, total, `Deshaciendo: ${transaction.sourceName}`);
      }

      try {
        // Move the file back from its destination to its original source parent folder
        // The handle itself may have updated if moved, so we fetch the updated handle references
        let currentFileHandle = null;
        try {
          currentFileHandle = await transaction.targetParentHandle.getFileHandle(transaction.targetName);
        } catch (err) {
          // Fallback check: if it fails, try using original reference
          currentFileHandle = transaction.fileHandle;
        }

        await this.moveFile(currentFileHandle, transaction.targetParentHandle, transaction.sourceParentHandle, transaction.sourceName);
      } catch (err) {
        console.error("Error reversing transaction for", transaction.sourceName, err);
      }

      count++;
    }

    // Try to remove directories that we created, in reverse order of depth
    const dirsToRemove = Array.from(this.createdDirectories).sort((a, b) => b.split('/').length - a.split('/').length);
    for (const dirPath of dirsToRemove) {
      try {
        const parts = dirPath.split('/');
        const dirName = parts.pop();
        const parentPath = parts.join('/');
        
        const parentDirHandle = await this.getOrCreateDirectory(parentPath);
        // This will only succeed if the folder is empty (recursive: false), which prevents deleting folders with user data!
        await parentDirHandle.removeEntry(dirName, { recursive: false });
        this.createdDirectories.delete(dirPath);
      } catch (e) {
        // Directory wasn't empty, or already removed. Skip.
      }
    }

    this.transactionHistory = [];
    if (progressCallback) {
      progressCallback(total, total, "Deshecho completado");
    }
  }

  /**
   * Helper to write/move file
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
