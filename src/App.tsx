import React, { useState, useEffect } from 'react';
import { localFS } from './fs-local';
import { detectDuplicates, detectStaleFiles, isImageFile, isScreenshotFile, ScannedFile } from './detector';

export default function App() {
  // Core State
  const [files, setFiles] = useState<ScannedFile[]>([]);
  const [staleFiles, setStaleFiles] = useState<ScannedFile[]>([]);
  const [duplicateInfo, setDuplicateInfo] = useState({ 
    duplicateGroups: [] as any[], 
    duplicateCount: 0, 
    savingPotentialBytes: 0,
    duplicateImagesCount: 0,
    duplicateImagesBytes: 0
  });

  // Settings
  const [staleDays, setStaleDays] = useState(180); // Default: 6 months
  const [duplicateStrategy, setDuplicateStrategy] = useState(localStorage.getItem('auradrive_dup_strategy') || 'trash');

  // Filter & Sort for Stale Files Tab
  const [staleFilterType, setStaleFilterType] = useState<'all' | 'images' | 'documents'>('all');
  const [staleSortType, setStaleSortType] = useState<'size' | 'age'>('size'); // size = largest first, age = oldest first

  // Folder Context
  const [loadedFolderName, setLoadedFolderName] = useState('');
  const [isFolderLoaded, setIsFolderLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<'duplicates' | 'stale'>('duplicates');

  // Progress Loading States
  const [isScanning, setIsScanning] = useState(false);
  const [progressText, setProgressText] = useState('Scanning...');
  const [progressSubtext, setProgressSubtext] = useState('');
  const [showUndoBanner, setShowUndoBanner] = useState(false);
  const [undoHistoryLength, setUndoHistoryLength] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  // Sync undo logs
  useEffect(() => {
    setUndoHistoryLength(localFS.transactionHistory.length);
  }, [showUndoBanner, files]);

  // Re-run stale filtering when staleDays, files, filterType, or sortType change
  useEffect(() => {
    if (files.length > 0) {
      const stale = detectStaleFiles(files, staleDays, staleFilterType);
      
      // Apply Sorting
      if (staleSortType === 'size') {
        stale.sort((a, b) => b.size - a.size); // Largest size first
      } else {
        stale.sort((a, b) => b.lastModified - a.lastModified); // Oldest age first (lower lastModified timestamp = older)
      }
      
      setStaleFiles(stale);
    }
  }, [files, staleDays, staleFilterType, staleSortType]);

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
    setProgressText("Scanning directory structure...");
    setProgressSubtext("Listing files recursively...");

    try {
      localFS.rootDirHandle = dirHandle;
      const scanned = await localFS.scan(dirHandle, '', true) as ScannedFile[];
      
      if (scanned.length === 0) {
        setIsScanning(false);
        clearWorkspaceState();
        alert("The selected folder is empty.");
        return;
      }

      // Detect duplicates
      const dups = detectDuplicates(scanned);
      
      // Auto-check duplicates for deletion
      scanned.forEach(file => {
        if (file.isDuplicate) {
          file.shouldProcess = true;
        } else {
          file.shouldProcess = false; // default false for stale archivals
        }
      });

      setFiles(scanned);
      setDuplicateInfo(dups);
      
      const stale = detectStaleFiles(scanned, staleDays, staleFilterType);
      if (staleSortType === 'size') {
        stale.sort((a, b) => b.size - a.size);
      } else {
        stale.sort((a, b) => b.lastModified - a.lastModified);
      }
      setStaleFiles(stale);
      
      setIsScanning(false);
    } catch (err: any) {
      console.error("Scan failed:", err);
      setIsScanning(false);
      alert("Failed to scan directory: " + err.message);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const dirHandle = await localFS.selectRootDirectory();
      await scanAndLoadFolder(dirHandle);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
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
            alert("Please drop a FOLDER, not a file.");
          }
        } catch (err) {
          console.error("Drop failed:", err);
          alert("Could not load folder. Try using the select folder button.");
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
      
      // Detect duplicates
      const dups = detectDuplicates(scanned);
      scanned.forEach(file => {
        if (file.isDuplicate) file.shouldProcess = true;
      });

      setFiles(scanned);
      setDuplicateInfo(dups);
      
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

      setShowUndoBanner(true);
      await scanFolderQuietly();
    } catch (e: any) {
      console.error("Cleanup failed:", e);
      setIsScanning(false);
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

      setShowUndoBanner(true);
      await scanFolderQuietly();
    } catch (e: any) {
      console.error("Archive failed:", e);
      setIsScanning(false);
      alert("Error archiving files: " + e.message);
    }
  };

  /**
   * Action Undo
   */
  const handleUndo = async () => {
    if (undoHistoryLength === 0) return;

    const confirmMsg = `Do you want to undo the last operation?\nThis will restore all moved or trashed files back to their original locations.`;
    if (!confirm(confirmMsg)) return;

    setIsScanning(true);
    setProgressText("Undoing last changes...");
    setProgressSubtext("Restoring file structures...");

    try {
      await localFS.undo((count, totalCount, msg) => {
        setProgressText(`Restoring: ${count} of ${totalCount}`);
        setProgressSubtext(msg);
      });

      alert("All files successfully restored!");
      setShowUndoBanner(false);
      await scanFolderQuietly();
    } catch (e: any) {
      console.error("Undo failed:", e);
      setIsScanning(false);
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
    setStaleFiles(prev => prev.map(f => ({ ...f, shouldProcess: isChecked })));
  };

  const clearWorkspaceState = () => {
    setFiles([]);
    setStaleFiles([]);
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
  };

  const handleSaveSettings = (strategy: string) => {
    setDuplicateStrategy(strategy);
    localStorage.setItem('auradrive_dup_strategy', strategy);
  };

  // Calculations for display
  const countAll = files.length;
  const countDups = duplicateInfo.duplicateCount;
  const countStale = staleFiles.length;

  const activeDupsToProcess = files.some(f => f.isDuplicate && f.shouldProcess !== false);
  const activeStaleToProcess = staleFiles.some(f => f.shouldProcess === true);

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
    <div id="app-container">
      {/* HEADER */}
      <header className="glass">
        <div className="logo-container">
          <div className="logo-icon">
            <i className="fa-solid fa-hard-drive"></i>
          </div>
          <span className="logo-text">AuraDrive</span>
          <span className="badge badge-info" style={{ marginLeft: '8px', fontSize: '0.7rem', padding: '2px 6px' }}>Local Cleaner</span>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main>
        {/* Undo Banner */}
        {showUndoBanner && (
          <div className="sync-banner glass" id="undo-banner" style={{ borderColor: 'var(--secondary)', background: 'rgba(16, 185, 129, 0.05)', marginBottom: '20px' }}>
            <div className="sync-banner-icon" style={{ color: 'var(--secondary)' }}>
              <i className="fa-solid fa-circle-check"></i>
            </div>
            <div className="sync-banner-text" style={{ flex: 1 }}>
              <span className="sync-banner-title" style={{ color: 'var(--text-main)' }}>Cleanup successfully executed!</span>
              <span className="sync-banner-desc">
                Your drive files have been updated. If you made a mistake, you can restore them instantly.
              </span>
            </div>
            <button className="action-btn secondary-btn" onClick={handleUndo} style={{ borderColor: 'var(--secondary)', color: 'var(--secondary)', padding: '6px 12px', fontSize: '0.8rem' }}>
              <i className="fa-solid fa-rotate-left"></i> Restore Files (Undo)
            </button>
          </div>
        )}

        <div className="organizer-layout">
          {/* LEFT COLUMN: Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Directory Selection */}
            <div className="source-panel glass" style={{ padding: '20px' }}>
              <div className="selection-title">Local Directory</div>
              
              <div 
                id="drop-zone"
                className={isDragOver ? 'drag-over' : ''}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                style={{ border: '2px dashed var(--border-color)', borderRadius: '12px', padding: '24px 16px', textAlign: 'center', cursor: 'pointer', transition: 'var(--transition-normal)', marginBottom: '12px' }}
                onClick={handleSelectFolder}
              >
                <i className="fa-solid fa-folder-closed" style={{ fontSize: '2.5rem', color: 'var(--text-muted)', marginBottom: '12px', display: 'block' }}></i>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500, display: 'block', lineHeight: 1.4 }}>
                  Drop folder here or click to scan
                </span>
              </div>

              <button className="action-btn" onClick={handleSelectFolder} style={{ width: '100%' }}>
                <i className="fa-solid fa-folder-open"></i> Select Folder
              </button>

              {isFolderLoaded && (
                <div style={{ padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', fontSize: '0.8rem', border: '1px solid var(--border-color)', marginTop: '12px' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Folder:</div>
                  <div style={{ wordBreak: 'break-all', fontFamily: 'monospace', color: 'var(--accent)' }}>{loadedFolderName}</div>
                </div>
              )}
            </div>

            {/* Folder Metrics & Space Saved */}
            {isFolderLoaded && (
              <div className="storage-card glass" style={{ padding: '20px' }}>
                <div className="selection-title" style={{ marginBottom: '15px' }}>Folder Statistics</div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span className="legend-header"><i className="fa-solid fa-file text-muted" style={{ width: '16px' }}></i> Total files:</span>
                    <span className="legend-val">{countAll}</span>
                  </div>
                  
                  <div style={{ borderTop: '1px solid var(--border-color)', margin: '4px 0' }}></div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span className="legend-header"><i className="fa-solid fa-clone text-warning" style={{ width: '16px' }}></i> Duplicate files:</span>
                    <span className="legend-val" style={{ color: 'var(--warning)', fontWeight: 600 }}>{countDups}</span>
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', paddingLeft: '16px' }}>
                    <span className="legend-header" style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}><i className="fa-solid fa-image" style={{ width: '12px', marginRight: '4px' }}></i> Images & Screenshots:</span>
                    <span className="legend-val" style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{duplicateInfo.duplicateImagesCount} ({formatBytes(duplicateInfo.duplicateImagesBytes)})</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span className="legend-header"><i className="fa-solid fa-circle-down text-success" style={{ width: '16px' }}></i> Savings potential:</span>
                    <span className="legend-val" style={{ color: 'var(--secondary)', fontWeight: 600 }}>{formatBytes(duplicateInfo.savingPotentialBytes)}</span>
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-color)', margin: '4px 0' }}></div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span className="legend-header"><i className="fa-solid fa-clock text-accent" style={{ width: '16px' }}></i> Old files found:</span>
                    <span className="legend-val" style={{ color: 'var(--accent)', fontWeight: 600 }}>{countStale}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Clean Configs (Inline Settings) */}
            {isFolderLoaded && (
              <div className="glass" style={{ padding: '20px' }}>
                <div className="selection-title" style={{ marginBottom: '12px' }}>Duplicates Cleanup Strategy</div>
                <select 
                  className="rule-input-field" 
                  style={{ backgroundColor: 'var(--bg-secondary)', marginBottom: '8px', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '8px', width: '100%', outline: 'none' }}
                  value={duplicateStrategy}
                  onChange={(e) => handleSaveSettings(e.target.value)}
                >
                  <option value="trash">Move to virtual trash folder (_Trash/)</option>
                  <option value="delete">Delete permanently from disk</option>
                  <option value="mark">Prefix filenames with [DUPLICATE_]</option>
                </select>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: '1.4', display: 'block' }}>
                  * Trashing is 100% reversible via Undo. Permanent deletions cannot be undone.
                </span>
              </div>
            )}

            {/* Stale Threshold Settings (Configurable Old Files Threshold) */}
            {isFolderLoaded && activeTab === 'stale' && (
              <div className="glass" style={{ padding: '20px' }}>
                <div className="selection-title" style={{ marginBottom: '12px' }}>Old Files Threshold</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <input 
                    type="range" 
                    min="30" 
                    max="365" 
                    step="30"
                    value={staleDays} 
                    onChange={(e) => setStaleDays(parseInt(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--primary)' }}
                  />
                  <span style={{ fontWeight: 600, fontSize: '0.88rem', width: '60px', textAlign: 'right' }}>{staleDays} days</span>
                </div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: '1.4', display: 'block' }}>
                  Filter files that haven't been modified in over {Math.round(staleDays/30)} months.
                </span>
              </div>
            )}

            {/* Actions Card */}
            {isFolderLoaded && (
              <div className="glass" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {activeTab === 'duplicates' ? (
                  <button className="action-btn" onClick={handleCleanDuplicates} style={{ width: '100%' }} disabled={!activeDupsToProcess}>
                    <i className="fa-solid fa-trash-can"></i> Clean Selected Duplicates
                  </button>
                ) : (
                  <button className="action-btn" onClick={handleArchiveStaleFiles} style={{ width: '100%' }} disabled={!activeStaleToProcess}>
                    <i className="fa-solid fa-box-archive"></i> Archive Selected Old Files
                  </button>
                )}
                <button className="action-btn secondary-btn" onClick={handleUndo} style={{ width: '100%' }} disabled={undoHistoryLength === 0}>
                  <i className="fa-solid fa-rotate-left"></i> Undo Last Action ({undoHistoryLength})
                </button>
                <button className="action-btn secondary-btn" onClick={clearWorkspaceState} style={{ width: '100%' }}>
                  <i className="fa-solid fa-xmark"></i> Close Folder
                </button>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Table previews */}
          <div className="workspace-panel glass">
            <div className="workspace-header">
              <div style={{ display: 'flex', gap: '16px' }}>
                <button 
                  className={`tab-btn ${activeTab === 'duplicates' ? 'active' : ''}`} 
                  onClick={() => setActiveTab('duplicates')}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: '1rem', paddingBottom: '4px' }}
                >
                  <i className="fa-solid fa-clone" style={{ color: 'var(--warning)' }}></i> Duplicates ({countDups})
                </button>
                <button 
                  className={`tab-btn ${activeTab === 'stale' ? 'active' : ''}`} 
                  onClick={() => setActiveTab('stale')}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: '1rem', paddingBottom: '4px' }}
                >
                  <i className="fa-solid fa-clock" style={{ color: 'var(--accent)' }}></i> Old Files Ranking ({countStale})
                </button>
              </div>
            </div>

            <div id="workspace-content" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              {/* Empty state */}
              {!isFolderLoaded && !isScanning && (
                <div className="empty-state">
                  <div className="empty-icon">
                    <i className="fa-solid fa-folder-tree"></i>
                  </div>
                  <h4 className="empty-title">No Folder Selected</h4>
                  <p className="empty-desc">
                    Drop a folder here or click to select. AuraDrive will scan your local files recursively to identify duplicates and rank your oldest/largest forgotten files, helping you reclaim space safely.
                  </p>
                  <button className="action-btn" onClick={handleSelectFolder}>
                    <i className="fa-solid fa-folder-open"></i> Select Folder
                  </button>
                </div>
              )}

              {/* Progress scanner */}
              {isScanning && (
                <div className="scan-progress-overlay">
                  <div className="spinner"></div>
                  <div className="progress-text">{progressText}</div>
                  <div className="progress-subtext" style={{ marginTop: '8px' }}>{progressSubtext}</div>
                </div>
              )}

              {/* Grid Tables */}
              {isFolderLoaded && !isScanning && (
                <div className="table-container">
                  {activeTab === 'duplicates' ? (
                    /* --- DUPLICATES PREVIEW TAB --- */
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
                          <th>Duplicate File Path</th>
                          <th>Action suggested</th>
                          <th>Status</th>
                          <th>Size</th>
                        </tr>
                      </thead>
                      <tbody>
                        {countDups === 0 ? (
                          <tr>
                            <td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                              No duplicate files found. Your workspace is clean!
                            </td>
                          </tr>
                        ) : (
                          // Render duplicate groups
                          files.filter(f => f.isDuplicateOriginal || f.isDuplicate).map((file, idx) => {
                            const isChecked = file.shouldProcess !== false;
                            const isScreenshot = isScreenshotFile(file.name);
                            const isImage = isImageFile(file.name);

                            if (file.isDuplicateOriginal) {
                              return (
                                <React.Fragment key={file.path || idx}>
                                  <tr className="duplicate-group-header">
                                    <td colSpan="5">
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                                        <span>
                                          <i className="fa-solid fa-clone text-warning" style={{ marginRight: '8px' }}></i>
                                          Duplicate Group: <strong>{file.name}</strong> ({formatBytes(file.size)})
                                          {isScreenshot && <span className="badge badge-warning" style={{ marginLeft: '8px', fontSize: '0.68rem' }}><i className="fa-solid fa-desktop"></i> Screenshot</span>}
                                          {!isScreenshot && isImage && <span className="badge badge-info" style={{ marginLeft: '8px', fontSize: '0.68rem' }}><i className="fa-solid fa-image"></i> Image</span>}
                                        </span>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                          Original: <code style={{ color: 'var(--secondary)' }}>{file.path}</code>
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
                                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '20px' }}>
                                        Original path: {file.path}
                                      </div>
                                    </td>
                                    <td>
                                      <span style={{ color: 'var(--secondary)', fontWeight: 500 }}>Keep Original</span>
                                    </td>
                                    <td>
                                      <span className="badge badge-success">Original</span>
                                    </td>
                                    <td>{formatBytes(file.size)}</td>
                                  </tr>
                                </React.Fragment>
                              );
                            }

                            // Duplicate copies
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
                                    <span className="file-name-cell" style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{file.name}</span>
                                  </div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '20px' }}>
                                    Duplicate path: {file.path}
                                  </div>
                                </td>
                                <td>
                                  <span style={{ color: 'var(--danger)', fontWeight: 500 }}>
                                    {duplicateStrategy === 'trash' ? 'Move to _Trash/' : (duplicateStrategy === 'delete' ? 'Delete Permanently' : 'Prefix Name')}
                                  </span>
                                </td>
                                <td>
                                  <span className="badge badge-danger">Duplicate</span>
                                </td>
                                <td>{formatBytes(file.size)}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  ) : (
                    /* --- OLD FILES RANKING PREVIEW --- */
                    <div>
                      {/* Sub-Filters and Sorters Controls */}
                      <div className="glass" style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', padding: '12px 16px', borderRadius: '8px', marginBottom: '16px', border: '1px solid var(--border-color)', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Filter files:</span>
                          <select 
                            className="rule-input-field" 
                            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '4px 8px', fontSize: '0.8rem', outline: 'none' }}
                            value={staleFilterType}
                            onChange={(e) => setStaleFilterType(e.target.value as any)}
                          >
                            <option value="all">All Old Files</option>
                            <option value="images">Images & Screenshots Only</option>
                            <option value="documents">Documents Only</option>
                          </select>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Sort by ranking:</span>
                          <select 
                            className="rule-input-field" 
                            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '4px 8px', fontSize: '0.8rem', outline: 'none' }}
                            value={staleSortType}
                            onChange={(e) => setStaleSortType(e.target.value as any)}
                          >
                            <option value="size">File Size (Largest First)</option>
                            <option value="age">File Age (Oldest First)</option>
                          </select>
                        </div>
                      </div>

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
                            <th>Old File Path</th>
                            <th>Age (Inactive)</th>
                            <th>Last Modified</th>
                            <th>Size Rank</th>
                          </tr>
                        </thead>
                        <tbody>
                          {countStale === 0 ? (
                            <tr>
                              <td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                                No inactive files found matching your criteria.
                              </td>
                            </tr>
                          ) : (
                            // Render stale files list ranked by criteria
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
                                      {file.isScreenshot && <span className="badge badge-warning" style={{ fontSize: '0.68rem', marginLeft: '6px', padding: '1px 4px' }}>Screenshot</span>}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '20px' }}>
                                      Path: {file.path}
                                    </div>
                                  </td>
                                  <td>
                                    <span className="badge badge-warning" style={{ fontSize: '0.78rem' }}>{file.ageDays} days old</span>
                                  </td>
                                  <td style={{ fontFamily: 'monospace' }}>{modDate}</td>
                                  <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>{formatBytes(file.size)}</td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
