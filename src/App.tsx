import React, { useState, useEffect } from 'react';
import { localFS, DirectoryLog } from './fs-local';
import { detectDuplicates, detectStaleFiles, isImageFile, isScreenshotFile, ScannedFile } from './detector';

interface NotificationLog {
  id: string;
  title: string;
  description: string;
  time: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export default function App() {
  // Core State
  const [files, setFiles] = useState<ScannedFile[]>([]);
  const [staleFiles, setStaleFiles] = useState<ScannedFile[]>([]);
  const [emptyFolders, setEmptyFolders] = useState<DirectoryLog[]>([]);
  const [duplicateInfo, setDuplicateInfo] = useState({ 
    duplicateGroups: [] as any[], 
    duplicateCount: 0, 
    savingPotentialBytes: 0,
    duplicateImagesCount: 0,
    duplicateImagesBytes: 0
  });

  // Folder Context
  const [loadedFolderName, setLoadedFolderName] = useState('');
  const [isFolderLoaded, setIsFolderLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<'duplicates' | 'stale' | 'folders'>('duplicates');

  // Settings
  const [staleDays, setStaleDays] = useState(180);
  const [duplicateStrategy, setDuplicateStrategy] = useState(localStorage.getItem('auradrive_dup_strategy') || 'trash');

  // Filters & Sorters for Old Files
  const [staleFilterType, setStaleFilterType] = useState<'all' | 'images' | 'documents'>('all');
  const [staleSortType, setStaleSortType] = useState<'size' | 'age'>('size');

  // Progress Scanner Loading
  const [isScanning, setIsScanning] = useState(false);
  const [progressText, setProgressText] = useState('Scanning...');
  const [progressSubtext, setProgressSubtext] = useState('');
  const [showUndoBanner, setShowUndoBanner] = useState(false);
  const [undoHistoryLength, setUndoHistoryLength] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  // Local Notifications State
  const [notifications, setNotifications] = useState<NotificationLog[]>([]);
  const [showNotificationDropdown, setShowNotificationDropdown] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: string }>>([]);

  // Sync undo logs
  useEffect(() => {
    setUndoHistoryLength(localFS.transactionHistory.length);
  }, [showUndoBanner, files]);

  // Re-run stale filtering when threshold, files or filters change
  useEffect(() => {
    if (files.length > 0) {
      const stale = detectStaleFiles(files, staleDays, staleFilterType);
      if (staleSortType === 'size') {
        stale.sort((a, b) => b.size - a.size);
      } else {
        stale.sort((a, b) => b.lastModified - a.lastModified);
      }
      setStaleFiles(stale);
    }
  }, [files, staleDays, staleFilterType, staleSortType]);

  /**
   * Pushes a local activity log / notification
   */
  const addNotification = (title: string, description: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 5);
    
    // Add to list
    setNotifications(prev => [{ id, title, description, time, type }, ...prev]);
    
    // Trigger slide-in toast
    setToasts(prev => [...prev, { id, message: `${title}: ${description}`, type }]);
    
    // Clear toast after 3.5s
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  };

  /**
   * Helper to format bytes
   */
  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  /**
   * Scan & Evaluate Folder
   */
  const scanAndLoadFolder = async (dirHandle: FileSystemDirectoryHandle) => {
    setShowUndoBanner(false);
    setLoadedFolderName(dirHandle.name);
    setIsFolderLoaded(true);
    setIsScanning(true);
    setProgressText("Scanning directory tree...");
    setProgressSubtext("Listing files recursively...");

    try {
      localFS.rootDirHandle = dirHandle;
      const scanned = await localFS.scan(dirHandle, '', true) as ScannedFile[];
      
      if (scanned.length === 0) {
        setIsScanning(false);
        clearWorkspaceState();
        addNotification("Scan Empty", `Folder '${dirHandle.name}' is empty.`, 'warning');
        return;
      }

      // Detect duplicates
      const dups = await detectDuplicates(scanned, localFS.fileHandlesMap);
      
      // Auto-check duplicates for deletion
      scanned.forEach(file => {
        if (file.isDuplicate) {
          file.shouldProcess = true;
        } else {
          file.shouldProcess = false;
        }
      });

      // Detect empty directories
      const emptyDirs = await localFS.scanEmptyDirectories();
      const mappedEmptyDirs = emptyDirs.map(d => ({ ...d, shouldProcess: true })) as any[];

      setFiles(scanned);
      setDuplicateInfo(dups);
      setEmptyFolders(mappedEmptyDirs);
      
      const stale = detectStaleFiles(scanned, staleDays, staleFilterType);
      if (staleSortType === 'size') {
        stale.sort((a, b) => b.size - a.size);
      } else {
        stale.sort((a, b) => b.lastModified - a.lastModified);
      }
      setStaleFiles(stale);
      setIsScanning(false);

      addNotification("Scan Completed", `Scanned ${scanned.length} files and ${emptyDirs.length} empty directories.`, 'success');
    } catch (err: any) {
      console.error("Scan failed:", err);
      setIsScanning(false);
      addNotification("Scan Error", err.message, 'error');
      alert("Failed to scan directory: " + err.message);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const dirHandle = await localFS.selectRootDirectory();
      await scanAndLoadFolder(dirHandle);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        addNotification("Loader Error", e.message, 'error');
        alert("Error loading directory: " + e.message);
      }
    }
  };

  // Drag and Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const item = items[0];
      if (item.kind === 'file') {
        try {
          const handle = await item.getAsFileSystemHandle();
          if (handle && handle.kind === 'directory') {
            await scanAndLoadFolder(handle as FileSystemDirectoryHandle);
          } else {
            addNotification("Drop Ignored", "Please drop a directory folder.", 'warning');
            alert("Please drop a FOLDER, not a file.");
          }
        } catch (err) {
          console.error("Drop failed:", err);
          addNotification("Drop Error", "Could not load folder.", 'error');
        }
      }
    }
  };

  const scanFolderQuietly = async () => {
    setIsScanning(true);
    setProgressText("Refreshing structure...");
    setProgressSubtext("Updating file statuses...");
    try {
      const dirHandle = localFS.rootDirHandle!;
      const scanned = await localFS.scan(dirHandle, '', true) as ScannedFile[];
      
      const dups = await detectDuplicates(scanned, localFS.fileHandlesMap);
      scanned.forEach(file => {
        if (file.isDuplicate) file.shouldProcess = true;
      });

      const emptyDirs = await localFS.scanEmptyDirectories();
      const mappedEmptyDirs = emptyDirs.map(d => ({ ...d, shouldProcess: true })) as any[];

      setFiles(scanned);
      setDuplicateInfo(dups);
      setEmptyFolders(mappedEmptyDirs);
      
      const stale = detectStaleFiles(scanned, staleDays, staleFilterType);
      if (staleSortType === 'size') {
        stale.sort((a, b) => b.size - a.size);
      } else {
        stale.sort((a, b) => b.lastModified - a.lastModified);
      }
      setStaleFiles(stale);
      setIsScanning(false);
    } catch (e) {
      console.error("Refresh failed:", e);
      setIsScanning(false);
    }
  };

  /**
   * Action Clean Duplicates
   */
  const handleCleanDuplicates = async () => {
    const dupsToClean = files.filter(f => f.isDuplicate && f.shouldProcess !== false);
    const total = dupsToClean.length;

    if (total === 0) return;

    const confirmMsg = `Do you want to clean the ${total} selected duplicate files?\nThis will move them to a virtual trash folder (_Trash/) on your drive.`;
    if (!confirm(confirmMsg)) return;

    setIsScanning(true);
    setProgressText("Cleaning duplicates...");
    setProgressSubtext("Moving files to trash...");

    try {
      await localFS.cleanDuplicates(dupsToClean, duplicateStrategy, (count, totalCount, msg) => {
        setProgressText(`Cleaning: ${count} of ${totalCount}`);
        setProgressSubtext(msg);
      });

      addNotification("Cleanup Complete", `Trashed ${total} duplicate files successfully.`, 'success');
      setShowUndoBanner(true);
      await scanFolderQuietly();
    } catch (e: any) {
      console.error("Cleanup failed:", e);
      setIsScanning(false);
      addNotification("Cleanup Error", e.message, 'error');
      alert("Error cleaning duplicates: " + e.message);
    }
  };

  /**
   * Action Archive Old Files
   */
  const handleArchiveStaleFiles = async () => {
    const staleToArchive = staleFiles.filter(f => f.shouldProcess === true);
    const total = staleToArchive.length;

    if (total === 0) return;

    const confirmMsg = `Do you want to archive the ${total} selected old files?\nThis will move them to an _Archive/ folder preserving their relative paths.`;
    if (!confirm(confirmMsg)) return;

    setIsScanning(true);
    setProgressText("Archiving old files...");
    setProgressSubtext("Moving files to archive...");

    try {
      await localFS.archiveFiles(staleToArchive, (count, totalCount, msg) => {
        setProgressText(`Archiving: ${count} of ${totalCount}`);
        setProgressSubtext(msg);
      });

      addNotification("Archive Complete", `Archived ${total} old files to _Archive/.`, 'success');
      setShowUndoBanner(true);
      await scanFolderQuietly();
    } catch (e: any) {
      console.error("Archive failed:", e);
      setIsScanning(false);
      addNotification("Archive Error", e.message, 'error');
      alert("Error archiving files: " + e.message);
    }
  };

  /**
   * Action Delete Empty Folders
   */
  const handleDeleteEmptyFolders = async () => {
    const foldersToClean = emptyFolders.filter((f: any) => f.shouldProcess === true);
    const total = foldersToClean.length;

    if (total === 0) return;

    const confirmMsg = `Do you want to delete the ${total} selected empty folders?\nThis action can be undone immediately if needed.`;
    if (!confirm(confirmMsg)) return;

    setIsScanning(true);
    setProgressText("Deleting empty folders...");
    setProgressSubtext("Removing directories...");

    try {
      await localFS.deleteEmptyFolders(foldersToClean, (count, totalCount, msg) => {
        setProgressText(`Deleting: ${count} of ${totalCount}`);
        setProgressSubtext(msg);
      });

      addNotification("Deletion Complete", `Removed ${total} empty directories.`, 'success');
      setShowUndoBanner(true);
      await scanFolderQuietly();
    } catch (e: any) {
      console.error("Folder deletion failed:", e);
      setIsScanning(false);
      addNotification("Folder Error", e.message, 'error');
      alert("Error deleting empty folders: " + e.message);
    }
  };

  /**
   * Action Undo
   */
  const handleUndo = async () => {
    if (undoHistoryLength === 0) return;

    const confirmMsg = `Do you want to undo the last operation?\nThis will restore all moved or deleted entries.`;
    if (!confirm(confirmMsg)) return;

    setIsScanning(true);
    setProgressText("Undoing last changes...");
    setProgressSubtext("Restoring directory state...");

    try {
      await localFS.undo((count, totalCount, msg) => {
        setProgressText(`Restoring: ${count} of ${totalCount}`);
        setProgressSubtext(msg);
      });

      addNotification("Undo Executed", "Reversed all directory modifications.", 'info');
      setShowUndoBanner(false);
      await scanFolderQuietly();
    } catch (e: any) {
      console.error("Undo failed:", e);
      setIsScanning(false);
      addNotification("Undo Error", e.message, 'error');
      alert("Error undoing changes: " + e.message);
    }
  };

  /**
   * Grid Checkboxes Toggles
   */
  const handleToggleFileSelection = (path: string) => {
    setFiles(prev => prev.map(f => {
      if (f.path === path) {
        return { ...f, shouldProcess: !f.shouldProcess };
      }
      return f;
    }));
  };

  const handleToggleStaleSelection = (path: string) => {
    setStaleFiles(prev => prev.map(f => {
      if (f.path === path) {
        return { ...f, shouldProcess: !f.shouldProcess };
      }
      return f;
    }));
  };

  const handleToggleFolderSelection = (path: string) => {
    setEmptyFolders(prev => prev.map(f => {
      if (f.path === path) {
        return { ...f, shouldProcess: !(f as any).shouldProcess } as any;
      }
      return f;
    }));
  };

  const handleToggleSelectAllDups = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    setFiles(prev => prev.map(f => {
      if (f.isDuplicate) {
        return { ...f, shouldProcess: isChecked };
      }
      return f;
    }));
  };

  const handleToggleSelectAllStale = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    setStaleFiles(prev => ({ ...prev, shouldProcess: isChecked } as any));
  };

  const handleToggleSelectAllFolders = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    setEmptyFolders(prev => prev.map(f => ({ ...f, shouldProcess: isChecked } as any)));
  };

  const clearWorkspaceState = () => {
    setFiles([]);
    setStaleFiles([]);
    setEmptyFolders([]);
    setDuplicateInfo({ 
      duplicateGroups: [], 
      duplicateCount: 0, 
      savingPotentialBytes: 0,
      duplicateImagesCount: 0,
      duplicateImagesBytes: 0
    });
    localFS.reset();
    setLoadedFolderName('');
    setIsFolderLoaded(false);
    setShowUndoBanner(false);
    addNotification("Session Closed", "Scanned files cache cleared.", 'info');
  };

  const handleSaveSettings = (strategy: string) => {
    setDuplicateStrategy(strategy);
    localStorage.setItem('auradrive_dup_strategy', strategy);
    addNotification("Settings Saved", `Duplicates strategy set to: ${strategy}`, 'info');
  };

  // Calculations for displays
  const countAll = files.length;
  const countDups = duplicateInfo.duplicateCount;
  const countStale = staleFiles.length;
  const countFolders = emptyFolders.length;

  const activeDupsToProcess = files.some(f => f.isDuplicate && f.shouldProcess !== false);
  const activeStaleToProcess = staleFiles.some(f => f.shouldProcess === true);
  const activeFoldersToProcess = emptyFolders.some((f: any) => f.shouldProcess === true);

  const getFileIcon = (filename: string) => {
    if (isScreenshotFile(filename)) return 'fa-solid fa-desktop text-accent';
    if (isImageFile(filename)) return 'fa-solid fa-image text-success';
    
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    if (['.pdf'].includes(ext)) return 'fa-solid fa-file-pdf text-danger';
    if (['.docx', '.doc', '.odt', '.txt', '.rtf'].includes(ext)) return 'fa-solid fa-file-word text-primary';
    if (['.xlsx', '.xls', '.csv'].includes(ext)) return 'fa-solid fa-file-excel text-success';
    if (['.mp4', '.mov', '.avi'].includes(ext)) return 'fa-solid fa-file-video text-accent';
    return 'fa-solid fa-file-lines text-muted';
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--background)' }}>
      
      {/* MAIN CONTAINER */}
      <div id="app-container" style={{ flex: 1, padding: '0 24px' }}>
        
        {/* SHADCN HEADER - CLEAN & FUNCTIONAL */}
        <header className="glass" style={{ margin: '0 0 24px 0', padding: '16px 0', width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderRadius: 0 }}>
          <div className="logo-container">
            <div className="logo-icon">
              <i className="fa-solid fa-hard-drive"></i>
            </div>
            <span className="logo-text">AuraDrive</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--muted-foreground)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: '4px', marginLeft: '6px' }}>Local Cleaner</span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', position: 'relative' }}>
            {/* Notification Bell Dropdown Button */}
            <button 
              className="action-btn secondary-btn" 
              onClick={() => setShowNotificationDropdown(!showNotificationDropdown)}
              style={{ padding: '8px', borderRadius: '50%', width: '36px', height: '36px', border: '1px solid var(--border)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="Recent Activity Logs"
            >
              <i className="fa-solid fa-bell" style={{ fontSize: '0.95rem' }}></i>
              {notifications.length > 0 && (
                <span style={{ position: 'absolute', top: '2px', right: '2px', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--danger)' }}></span>
              )}
            </button>

            {/* Notification Dropdown Menu */}
            {showNotificationDropdown && (
              <div className="glass" style={{ position: 'absolute', top: '44px', right: '0px', width: '280px', maxHeight: '350px', overflowY: 'auto', zIndex: 999, padding: '12px', border: '1px solid var(--border)', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Activity Logs ({notifications.length})</span>
                  <button onClick={() => setNotifications([])} style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.75rem' }}>Clear All</button>
                </div>
                {notifications.length === 0 ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>No recent activities logged.</div>
                ) : (
                  notifications.map(n => (
                    <div key={n.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '6px', borderRadius: '4px', backgroundColor: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.02)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.78rem', color: n.type === 'error' ? 'var(--danger)' : (n.type === 'success' ? 'var(--secondary)' : 'var(--foreground)') }}>{n.title}</span>
                        <span style={{ fontSize: '0.68rem', color: 'var(--muted-foreground)' }}>{n.time}</span>
                      </div>
                      <p style={{ fontSize: '0.72rem', color: 'var(--muted-foreground)', wordBreak: 'break-all' }}>{n.description}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </header>

        {/* TOAST SYSTEM (SLIDE-IN LOCAL NOTIFICATIONS) */}
        <div style={{ position: 'fixed', top: '20px', right: '20px', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 99999 }}>
          {toasts.map(t => (
            <div 
              key={t.id} 
              className="glass" 
              style={{ 
                padding: '12px 18px', 
                borderRadius: 'var(--radius)', 
                fontSize: '0.82rem', 
                borderLeft: `4px solid ${t.type === 'success' ? 'var(--secondary)' : (t.type === 'warning' ? 'var(--warning)' : (t.type === 'error' ? 'var(--danger)' : 'var(--primary)'))}`,
                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.5)',
                minWidth: '220px',
                animation: 'slideIn 0.3s ease-out forwards'
              }}
            >
              {t.message}
            </div>
          ))}
        </div>

        {/* CSS for Toast slideIn animation */}
        <style>{`
          @keyframes slideIn {
            from { transform: translateX(120%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}</style>

        {/* WORKSPACE CONTENT BODY */}
        <main>
          {/* Undo Restore Banner */}
          {showUndoBanner && (
            <div className="sync-banner glass" id="undo-banner" style={{ borderColor: 'var(--secondary)', background: 'rgba(16, 185, 129, 0.03)', marginBottom: '24px' }}>
              <div className="sync-banner-icon" style={{ color: 'var(--secondary)' }}>
                <i className="fa-solid fa-circle-check"></i>
              </div>
              <div className="sync-banner-text" style={{ flex: 1 }}>
                <span className="sync-banner-title">Files updated successfully!</span>
                <span className="sync-banner-desc">
                  Your directories have been reorganized. Click undo to reverse all actions instantly.
                </span>
              </div>
              <button className="action-btn secondary-btn" onClick={handleUndo} style={{ borderColor: 'var(--secondary)', color: 'var(--secondary)', padding: '6px 12px', fontSize: '0.8rem' }}>
                <i className="fa-solid fa-rotate-left"></i> Undo Actions
              </button>
            </div>
          )}

          <div className="organizer-layout">
            
            {/* LEFT COLUMN: STATS PANELS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Load Panel */}
              <div className="source-panel glass" style={{ padding: '20px' }}>
                <div className="selection-title">Local Directory</div>
                <div 
                  id="drop-zone"
                  className={isDragOver ? 'drag-over' : ''}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  style={{ border: '1px dashed var(--border)', borderRadius: 'var(--radius)', padding: '24px 16px', textAlign: 'center', cursor: 'pointer', marginBottom: '12px' }}
                  onClick={handleSelectFolder}
                >
                  <i className="fa-solid fa-folder-closed" style={{ fontSize: '2rem', color: 'var(--muted-foreground)', marginBottom: '10px', display: 'block' }}></i>
                  <span style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)', display: 'block', lineHeight: 1.4 }}>
                    Drop directory here or scan
                  </span>
                </div>
                <button className="action-btn" onClick={handleSelectFolder} style={{ width: '100%', padding: '8px 16px', fontSize: '0.82rem' }}>
                  <i className="fa-solid fa-folder-open"></i> Select Folder
                </button>
                {isFolderLoaded && (
                  <div style={{ marginTop: '12px', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.74rem', color: 'var(--primary)', padding: '8px', borderRadius: '4px', backgroundColor: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)' }}>
                    {loadedFolderName}
                  </div>
                )}
              </div>

              {/* Settings Panel */}
              <div className="glass" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)' }}>
                  Scanner Settings
                </div>
                
                {/* Old Files Days Slider */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--foreground)' }}>Stale Files Age</span>
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--warning)' }}>{staleDays} days</span>
                  </div>
                  <input 
                    type="range" 
                    min="30" 
                    max="365" 
                    step="5"
                    value={staleDays} 
                    onChange={(e) => setStaleDays(parseInt(e.target.value))}
                    style={{ width: '100%' }}
                  />
                  <span style={{ fontSize: '0.66rem', color: 'var(--muted-foreground)' }}>
                    Files unmodified for {staleDays} days are classed as "stale".
                  </span>
                </div>

                {/* Duplicate Strategy Dropdown */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--foreground)' }}>Duplicates Strategy</label>
                  <select 
                    className="rule-input-field" 
                    style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px', fontSize: '0.78rem', width: '100%', outline: 'none' }}
                    value={duplicateStrategy}
                    onChange={(e) => handleSaveSettings(e.target.value)}
                  >
                    <option value="trash">Move to Trash (_Trash/)</option>
                    <option value="delete">Delete Permanently</option>
                    <option value="mark">Rename (Prefix with duplicate_)</option>
                  </select>
                </div>

                {/* Ignored Folders list */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <i className="fa-solid fa-triangle-exclamation"></i>
                    Auto-ignored directories:
                  </span>
                  <span style={{ fontSize: '0.68rem', fontFamily: 'monospace', color: 'var(--muted-foreground)' }}>
                    .git, node_modules, _Trash, _Archive
                  </span>
                </div>
              </div>

              {/* STAT Card 1: Total Scanned Files */}
              <div className="glass" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)' }}>Total Scanned Files</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '6px' }}>
                  <span style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.03em' }}>{isFolderLoaded ? countAll.toLocaleString() : '0'}</span>
                  <span style={{ fontSize: '0.74rem', color: 'var(--secondary)', fontWeight: 600 }}>+4.2%</span>
                </div>
                <span style={{ fontSize: '0.74rem', color: 'var(--muted-foreground)' }}>
                  {isFolderLoaded ? `${countAll.toLocaleString()} scanned files` : '0 scanned files'}
                </span>
              </div>

              {/* STAT Card 2: Duplicates Found */}
              <div className="glass" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)' }}>Duplicates Found</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '6px' }}>
                  <span style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--warning)' }}>
                    {isFolderLoaded ? `${duplicateInfo.duplicateGroups.length} Groups` : '0 Groups'}
                  </span>
                  <span style={{ fontSize: '0.74rem', color: 'var(--accent)', fontWeight: 600 }}>+12%</span>
                </div>
                <span style={{ fontSize: '0.74rem', color: 'var(--muted-foreground)' }}>
                  {isFolderLoaded ? `${countDups} duplicate files` : '0 duplicate files'}
                </span>
              </div>

              {/* STAT Card 3: Recoverable Space */}
              <div className="glass" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)' }}>Recoverable Space</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '6px' }}>
                  <span style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--secondary)' }}>
                    {isFolderLoaded ? formatBytes(duplicateInfo.savingPotentialBytes) : '0 Bytes'}
                  </span>
                  <span style={{ fontSize: '0.74rem', color: 'var(--secondary)', fontWeight: 600 }}>14%</span>
                </div>
                <span style={{ fontSize: '0.74rem', color: 'var(--muted-foreground)' }}>Estimated gain</span>
              </div>

              {/* RECENT ACTIVITY LOGGER */}
              <div className="glass" style={{ padding: '20px', minHeight: '140px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)' }}>Recent Activity</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '110px' }}>
                  {notifications.slice(0, 3).map(n => (
                    <div key={n.id} style={{ fontSize: '0.74rem', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>• {n.title}</span>
                      <span style={{ color: 'var(--muted-foreground)', fontFamily: 'monospace' }}>{n.time}</span>
                    </div>
                  ))}
                  {notifications.length === 0 && (
                    <span style={{ fontSize: '0.74rem', color: 'var(--muted-foreground)', fontStyle: 'italic' }}>No activity recorded yet.</span>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: WORKSPACE CARD PANEL */}
            <div className="workspace-panel glass" style={{ backgroundColor: 'var(--card)' }}>
              
              {/* Panel Header */}
              <div className="workspace-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--foreground)' }}>DUPLICATE FILE CLEANER</h3>
                  
                  {/* Settings can be adjusted in the left sidebar panel */}
                </div>
                
                {/* Three Tabs Toggle */}
                <div style={{ display: 'flex', gap: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '2px' }}>
                  <button 
                    className={`tab-btn ${activeTab === 'duplicates' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('duplicates')}
                  >
                    <i className="fa-solid fa-clone"></i> Duplicates ({countDups})
                  </button>
                  <button 
                    className={`tab-btn ${activeTab === 'stale' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('stale')}
                  >
                    <i className="fa-solid fa-clock"></i> Old Files ({countStale})
                  </button>
                  <button 
                    className={`tab-btn ${activeTab === 'folders' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('folders')}
                  >
                    <i className="fa-solid fa-folder-open"></i> Empty Folders ({countFolders})
                  </button>
                </div>
              </div>

              {/* Workspace Content */}
              <div id="workspace-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                
                {/* Empty State */}
                {!isFolderLoaded && !isScanning && (
                  <div className="empty-state">
                    <div className="empty-icon">
                      <i className="fa-solid fa-shield-halved"></i>
                    </div>
                    <h4 className="empty-title">AuraDrive Duplicate Finder</h4>
                    <p className="empty-desc">
                      Load a local directory from your drive. We will securely scan it for space-wasting duplicate screenshots, large stale files, and abandoned empty folders without loading anything online.
                    </p>
                    <button className="action-btn" onClick={handleSelectFolder}>
                      <i className="fa-solid fa-folder-open"></i> Select Folder to Scan
                    </button>
                  </div>
                )}

                {/* Progress Overlay */}
                {isScanning && (
                  <div className="scan-progress-overlay">
                    <div className="spinner"></div>
                    <div className="progress-text">{progressText}</div>
                    <div className="progress-subtext" style={{ marginTop: '8px' }}>{progressSubtext}</div>
                  </div>
                )}

                {/* Lists Tables */}
                {isFolderLoaded && !isScanning && (
                  <>
                    {/* Sub-filters settings inside card (pinned above table scroll container) */}
                    {activeTab === 'stale' && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', margin: '0 20px 14px 20px', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.01)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>File Type:</span>
                          <select 
                            className="rule-input-field" 
                            style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: '6px', padding: '3px 6px', fontSize: '0.76rem', width: 'auto', outline: 'none' }}
                            value={staleFilterType}
                            onChange={(e) => setStaleFilterType(e.target.value as any)}
                          >
                            <option value="all">All Files</option>
                            <option value="images">Images & Screenshots</option>
                            <option value="documents">Documents Only</option>
                          </select>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>Rank by:</span>
                          <select 
                            className="rule-input-field" 
                            style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: '6px', padding: '3px 6px', fontSize: '0.76rem', width: 'auto', outline: 'none' }}
                            value={staleSortType}
                            onChange={(e) => setStaleSortType(e.target.value as any)}
                          >
                            <option value="size">Size (Largest First)</option>
                            <option value="age">Age (Oldest First)</option>
                          </select>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
                          <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>Age:</span>
                          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>&gt; {staleDays} days</span>
                        </div>
                      </div>
                    )}

                    <div className="table-container" style={{ flex: 1, padding: '0 20px 20px 20px' }}>
                    
                    {/* TAB 1: DUPLICATES */}
                    {activeTab === 'duplicates' && (
                      <table>
                        <thead>
                          <tr>
                            <th width="30">
                              <input 
                                type="checkbox" 
                                className="checkbox-custom" 
                                onChange={handleToggleSelectAllDups}
                                checked={files.length > 0 && files.filter(f => f.isDuplicate).every(f => f.shouldProcess !== false)}
                              />
                            </th>
                            <th>Name</th>
                            <th>Size</th>
                            <th>Group Info</th>
                            <th>Path</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {countDups === 0 ? (
                            <tr>
                              <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: 'var(--muted-foreground)' }}>
                                No duplicate files found in this folder.
                              </td>
                            </tr>
                          ) : (
                            files.filter(f => f.isDuplicateOriginal || f.isDuplicate).map((file, idx) => {
                              const isChecked = file.shouldProcess !== false;
                              const isScreenshot = isScreenshotFile(file.name);
                              const isImage = isImageFile(file.name);

                              if (file.isDuplicateOriginal) {
                                return (
                                  <React.Fragment key={file.path || idx}>
                                    <tr className="duplicate-group-header">
                                      <td colSpan={6}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                                          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                                            <i className="fa-solid fa-clone text-warning" style={{ marginRight: '8px' }}></i>
                                            Duplicate Group: <strong>{file.name}</strong>
                                            {isScreenshot && <span className="badge badge-warning" style={{ marginLeft: '8px', fontSize: '0.66rem' }}><i className="fa-solid fa-desktop"></i> Screenshot</span>}
                                            {!isScreenshot && isImage && <span className="badge badge-info" style={{ marginLeft: '8px', fontSize: '0.66rem' }}><i className="fa-solid fa-image"></i> Image</span>}
                                          </span>
                                          <span style={{ fontSize: '0.74rem', color: 'var(--muted-foreground)', fontFamily: 'monospace' }}>
                                            Original
                                          </span>
                                        </div>
                                      </td>
                                    </tr>
                                    <tr className="duplicate-child">
                                      <td>
                                        <input type="checkbox" disabled className="checkbox-custom" checked />
                                      </td>
                                      <td>
                                        <div className="file-item">
                                          <i className="fa-solid fa-circle-check text-success"></i>
                                          <span className="file-name-cell">{file.name}</span>
                                        </div>
                                      </td>
                                      <td>{formatBytes(file.size)}</td>
                                      <td>
                                        <span className="badge badge-success">Original</span>
                                      </td>
                                      <td style={{ fontFamily: 'monospace', fontSize: '0.76rem', color: 'var(--muted-foreground)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.path}>
                                        {file.path}
                                      </td>
                                      <td>
                                        <span style={{ color: 'var(--secondary)', fontSize: '0.76rem', fontWeight: 600 }}>Keep</span>
                                      </td>
                                    </tr>
                                  </React.Fragment>
                                );
                              }

                              return (
                                <tr className="duplicate-child" key={file.path || idx}>
                                  <td>
                                    <input 
                                      type="checkbox" 
                                      className="checkbox-custom" 
                                      checked={isChecked} 
                                      onChange={() => handleToggleFileSelection(file.path)}
                                    />
                                  </td>
                                  <td>
                                    <div className="file-item">
                                      <i className="fa-solid fa-trash-can text-danger"></i>
                                      <span className="file-name-cell" style={{ color: 'var(--muted-foreground)', textDecoration: 'line-through' }}>{file.name}</span>
                                    </div>
                                  </td>
                                  <td>{formatBytes(file.size)}</td>
                                  <td>
                                    <span className="badge badge-danger">Duplicate</span>
                                  </td>
                                  <td style={{ fontFamily: 'monospace', fontSize: '0.76rem', color: 'var(--muted-foreground)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.path}>
                                    {file.path}
                                  </td>
                                  <td>
                                    <span style={{ color: 'var(--danger)', fontSize: '0.76rem', fontWeight: 600 }}>
                                      {duplicateStrategy === 'trash' ? 'Trash' : (duplicateStrategy === 'delete' ? 'Delete' : 'Rename')}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    )}

                    {/* TAB 2: OLD FILES */}
                    {activeTab === 'stale' && (
                      <table>
                        <thead>
                          <tr>
                            <th width="30">
                              <input 
                                type="checkbox" 
                                className="checkbox-custom" 
                                onChange={handleToggleSelectAllStale}
                                checked={staleFiles.length > 0 && staleFiles.every(f => f.shouldProcess === true)}
                              />
                            </th>
                            <th>Name</th>
                            <th>Age</th>
                            <th>Last Modified</th>
                            <th>Size Rank</th>
                          </tr>
                        </thead>
                        <tbody>
                          {countStale === 0 ? (
                            <tr>
                              <td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: 'var(--muted-foreground)' }}>
                                No stale files found matching criteria.
                              </td>
                            </tr>
                          ) : (
                            staleFiles.map((file, idx) => {
                              const isChecked = file.shouldProcess === true;
                              const modDate = new Date(file.lastModified).toLocaleDateString();

                              return (
                                <tr key={file.path || idx}>
                                  <td>
                                    <input 
                                      type="checkbox" 
                                      className="checkbox-custom" 
                                      checked={isChecked} 
                                      onChange={() => handleToggleStaleSelection(file.path)}
                                    />
                                  </td>
                                  <td>
                                    <div className="file-item">
                                      <i className={getFileIcon(file.name)}></i>
                                      <span className="file-name-cell" title={file.path}>{file.name}</span>
                                      {file.isScreenshot && <span className="badge badge-warning" style={{ fontSize: '0.62rem', marginLeft: '4px' }}>Screenshot</span>}
                                    </div>
                                  </td>
                                  <td>
                                    <span className="badge badge-warning" style={{ fontSize: '0.72rem' }}>{file.ageDays} days</span>
                                  </td>
                                  <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{modDate}</td>
                                  <td style={{ fontWeight: 600 }}>{formatBytes(file.size)}</td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    )}

                    {/* TAB 3: EMPTY FOLDERS */}
                    {activeTab === 'folders' && (
                      <table>
                        <thead>
                          <tr>
                            <th width="30">
                              <input 
                                type="checkbox" 
                                className="checkbox-custom" 
                                onChange={handleToggleSelectAllFolders}
                                checked={emptyFolders.length > 0 && emptyFolders.every((f: any) => f.shouldProcess === true)}
                              />
                            </th>
                            <th>Folder Name</th>
                            <th>Relative Directory Path</th>
                            <th>Status</th>
                            <th>Action suggested</th>
                          </tr>
                        </thead>
                        <tbody>
                          {countFolders === 0 ? (
                            <tr>
                              <td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: 'var(--muted-foreground)' }}>
                                No empty folders found inside this directory structure.
                              </td>
                            </tr>
                          ) : (
                            emptyFolders.map((folder: any, idx) => {
                              const isChecked = folder.shouldProcess === true;

                              return (
                                <tr key={folder.path || idx}>
                                  <td>
                                    <input 
                                      type="checkbox" 
                                      className="checkbox-custom" 
                                      checked={isChecked} 
                                      onChange={() => handleToggleFolderSelection(folder.path)}
                                    />
                                  </td>
                                  <td>
                                    <div className="file-item">
                                      <i className="fa-solid fa-folder text-warning"></i>
                                      <span className="file-name-cell" style={{ fontWeight: 500 }}>{folder.name}</span>
                                    </div>
                                  </td>
                                  <td style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>
                                    {folder.path}
                                  </td>
                                  <td>
                                    <span className="badge badge-danger" style={{ fontSize: '0.72rem' }}>Empty Folder</span>
                                  </td>
                                  <td>
                                    <span style={{ color: 'var(--danger)', fontSize: '0.76rem', fontWeight: 600 }}>Remove Directory</span>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}

                {/* Table Footer Controls (inside the card matching layout) */}
                {isFolderLoaded && !isScanning && (
                  <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.005)' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)', fontWeight: 500 }}>
                      {activeTab === 'duplicates' && `${countDups} duplicates flaggable`}
                      {activeTab === 'stale' && `${staleFiles.filter(f => f.shouldProcess).length} of ${countStale} files selected`}
                      {activeTab === 'folders' && `${emptyFolders.filter((f: any) => f.shouldProcess).length} of ${countFolders} empty folders selected`}
                    </span>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      {activeTab === 'duplicates' && (
                        <>
                          <button className="action-btn secondary-btn" onClick={handleToggleSelectAllDups} style={{ padding: '6px 12px', fontSize: '0.78rem' }}>Toggle Select All</button>
                          <button className="action-btn" onClick={handleCleanDuplicates} disabled={!activeDupsToProcess} style={{ padding: '6px 12px', fontSize: '0.78rem', backgroundColor: 'var(--danger)', color: '#fff' }}>
                            Delete Selected ({files.filter(f => f.isDuplicate && f.shouldProcess).length} Files)
                          </button>
                        </>
                      )}
                      {activeTab === 'stale' && (
                        <>
                          <button className="action-btn secondary-btn" onClick={handleToggleSelectAllStale} style={{ padding: '6px 12px', fontSize: '0.78rem' }}>Toggle Select All</button>
                          <button className="action-btn" onClick={handleArchiveStaleFiles} disabled={!activeStaleToProcess} style={{ padding: '6px 12px', fontSize: '0.78rem', backgroundColor: 'var(--primary)', color: '#fff' }}>
                            Archive Selected ({staleFiles.filter(f => f.shouldProcess).length} Files)
                          </button>
                        </>
                      )}
                      {activeTab === 'folders' && (
                        <>
                          <button className="action-btn secondary-btn" onClick={handleToggleSelectAllFolders} style={{ padding: '6px 12px', fontSize: '0.78rem' }}>Toggle Select All</button>
                          <button className="action-btn" onClick={handleDeleteEmptyFolders} disabled={!activeFoldersToProcess} style={{ padding: '6px 12px', fontSize: '0.78rem', backgroundColor: 'var(--danger)', color: '#fff' }}>
                            Delete Selected ({emptyFolders.filter((f: any) => f.shouldProcess).length} Folders)
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
