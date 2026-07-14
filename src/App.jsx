import React, { useState, useEffect } from 'react';
import { localFS } from './fs-local';
import { detectDuplicates, classifyFile, resolveNamingConflicts } from './detector';
import { extractMetadataFromFilename, renderTemplate, getActiveRules, saveRules } from './rules';

export default function App() {
  // Application State
  const [files, setFiles] = useState([]);
  const [duplicateInfo, setDuplicateInfo] = useState({ duplicateGroups: [], duplicateCount: 0, savingPotentialBytes: 0 });
  const [activeFilter, setActiveFilter] = useState('all');
  
  // Settings
  const [duplicateStrategy, setDuplicateStrategy] = useState(localStorage.getItem('auradrive_dup_strategy') || 'trash');
  const [recursiveScan, setRecursiveScan] = useState(localStorage.getItem('auradrive_recursive') !== 'false');
  
  // Folder Context
  const [loadedFolderName, setLoadedFolderName] = useState('');
  const [isFolderLoaded, setIsFolderLoaded] = useState(false);
  
  // UI states
  const [isScanning, setIsScanning] = useState(false);
  const [progressText, setProgressText] = useState('Analyzing local folders...');
  const [progressSubtext, setProgressSubtext] = useState('Reading metadata...');
  const [showUndoBanner, setShowUndoBanner] = useState(false);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [rulesList, setRulesList] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [undoHistoryLength, setUndoHistoryLength] = useState(0);

  // Initial rules loader
  useEffect(() => {
    setRulesList(getActiveRules());
  }, []);

  // Update undo history indicator
  useEffect(() => {
    setUndoHistoryLength(localFS.transactionHistory.length);
  }, [showUndoBanner, files]);

  /**
   * Helper to format bytes into human readable format
   */
  const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  /**
   * Main processor pipeline
   */
  const evaluateProposedStructure = (scannedFiles) => {
    const processed = scannedFiles.map(file => {
      // Keep selected state if already defined, default to true
      const shouldProcess = file.shouldProcess !== undefined ? file.shouldProcess : true;
      
      const rule = classifyFile(file.name);
      const meta = extractMetadataFromFilename(file.name);
      
      return {
        ...file,
        shouldProcess,
        categoryName: rule.name,
        category: rule.category,
        proposedPath: renderTemplate(rule.folderPattern, meta),
        proposedName: renderTemplate(rule.namePattern, meta) + meta.ext,
        hasConflict: false,
        conflictReason: ''
      };
    });

    // Resolve naming collisions
    resolveNamingConflicts(processed);

    // Identify duplicates
    const dups = detectDuplicates(processed);
    
    // Auto-select duplicates to process by default
    processed.forEach(file => {
      if (file.isDuplicate) {
        file.shouldProcess = true;
      }
    });

    return { processedFiles: processed, dups };
  };

  /**
   * Folder Scanning
   */
  const scanAndLoadFolder = async (dirHandle) => {
    setShowUndoBanner(false);
    setLoadedFolderName(dirHandle.name);
    setIsFolderLoaded(true);
    
    setIsScanning(true);
    setProgressText("Scanning local structure...");
    setProgressSubtext("Reading file metadata securely...");

    try {
      localFS.rootDirHandle = dirHandle;
      const scanned = await localFS.scan(dirHandle, '', recursiveScan);
      
      if (scanned.length === 0) {
        setIsScanning(false);
        clearWorkspaceState();
        alert("The selected folder is empty.");
        return;
      }

      const { processedFiles, dups } = evaluateProposedStructure(scanned);
      setFiles(processedFiles);
      setDuplicateInfo(dups);
      setIsScanning(false);
    } catch (err) {
      console.error("Scan error:", err);
      setIsScanning(false);
      alert("Could not scan directory: " + err.message);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const dirHandle = await localFS.selectRootDirectory();
      await scanAndLoadFolder(dirHandle);
    } catch (e) {
      if (e.name !== 'AbortError') {
        alert("Error loading folder: " + e.message);
      }
    }
  };

  // Drag and Drop triggers
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragOver(false);

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const item = items[0];
      if (item.kind === 'file') {
        try {
          const handle = await item.getAsFileSystemHandle();
          if (handle.kind === 'directory') {
            await scanAndLoadFolder(handle);
          } else {
            alert("Please drop a FOLDER, not a file.");
          }
        } catch (err) {
          console.error("Drop retrieval failed:", err);
          alert("Could not read directory. Try using the select directory button.");
        }
      }
    }
  };

  /**
   * Rescans directory handle quietly to sync UI updates
   */
  const scanFolderQuietly = async () => {
    setIsScanning(true);
    setProgressText("Updating view...");
    setProgressSubtext("Syncing file system changes...");
    try {
      const dirHandle = localFS.rootDirHandle;
      const scanned = await localFS.scan(dirHandle, '', recursiveScan);
      const { processedFiles, dups } = evaluateProposedStructure(scanned);
      setFiles(processedFiles);
      setDuplicateInfo(dups);
      setIsScanning(false);
    } catch (e) {
      console.error("Quiet rescan failed:", e);
      setIsScanning(false);
    }
  };

  /**
   * Execution Triggers (Organize & Undo)
   */
  const handleExecuteOrganization = async () => {
    const filesToExecute = files.filter(f => f.shouldProcess !== false);
    const total = filesToExecute.length;

    if (total === 0) return;

    const confirmMsg = `Do you want to organize the ${total} selected files?\nThis will rename, relocate, or clean files on your local drive.`;
    if (!confirm(confirmMsg)) return;

    setIsScanning(true);
    setProgressText("Organizing files...");
    setProgressSubtext("Creating directories and moving files...");

    try {
      await localFS.execute(files, duplicateStrategy, (count, totalCount, msg) => {
        setProgressText(`Organizing: ${count} of ${totalCount}`);
        setProgressSubtext(msg);
      });

      setShowUndoBanner(true);
      await scanFolderQuietly();
    } catch (e) {
      console.error("Execution failed:", e);
      setIsScanning(false);
      alert("Error organizing files: " + e.message);
    }
  };

  const handleUndo = async () => {
    if (undoHistoryLength === 0) return;

    const confirmMsg = `Do you want to undo the organization?\nThis will restore all moved/renamed files back to their original locations.`;
    if (!confirm(confirmMsg)) return;

    setIsScanning(true);
    setProgressText("Undoing changes...");
    setProgressSubtext("Restoring files to original paths...");

    try {
      await localFS.undo((count, totalCount, msg) => {
        setProgressText(`Undoing: ${count} of ${totalCount}`);
        setProgressSubtext(msg);
      });

      alert("All changes successfully reverted!");
      setShowUndoBanner(false);
      await scanFolderQuietly();
    } catch (e) {
      console.error("Undo failed:", e);
      setIsScanning(false);
      alert("Error undoing changes: " + e.message);
    }
  };

  /**
   * Selection Checkbox Toggles
   */
  const handleToggleFile = (path) => {
    setFiles(prevFiles => {
      const updated = prevFiles.map(f => {
        if (f.path === path) {
          return { ...f, shouldProcess: !f.shouldProcess };
        }
        return f;
      });
      // Re-run conflict resolution and duplicate checks on toggle to verify paths live
      const { processedFiles, dups } = evaluateProposedStructure(updated);
      setDuplicateInfo(dups);
      return processedFiles;
    });
  };

  const handleToggleSelectAll = (e) => {
    const isChecked = e.target.checked;
    setFiles(prevFiles => {
      const updated = prevFiles.map(f => ({ ...f, shouldProcess: isChecked }));
      const { processedFiles, dups } = evaluateProposedStructure(updated);
      setDuplicateInfo(dups);
      return processedFiles;
    });
  };

  const clearWorkspaceState = () => {
    setFiles([]);
    setDuplicateInfo({ duplicateGroups: [], duplicateCount: 0, savingPotentialBytes: 0 });
    localFS.reset();
    setLoadedFolderName('');
    setIsFolderLoaded(false);
    setShowUndoBanner(false);
  };

  /**
   * Save rule changes
   */
  const handleSaveRule = (ruleId, folderPattern, namePattern) => {
    const updated = rulesList.map(r => {
      if (r.id === ruleId) {
        return { ...r, folderPattern: folderPattern.trim(), namePattern: namePattern.trim() };
      }
      return r;
    });
    setRulesList(updated);
    saveRules(updated);

    // Re-evaluate current loaded structure
    if (files.length > 0) {
      const { processedFiles, dups } = evaluateProposedStructure(files);
      setFiles(processedFiles);
      setDuplicateInfo(dups);
    }
  };

  /**
   * Save global configuration settings
   */
  const handleSaveSettings = (strategy, recursive) => {
    setDuplicateStrategy(strategy);
    setRecursiveScan(recursive);

    localStorage.setItem('auradrive_dup_strategy', strategy);
    localStorage.setItem('auradrive_recursive', recursive.toString());
    setShowSettings(false);

    // Trigger re-evaluate
    if (files.length > 0) {
      const { processedFiles, dups } = evaluateProposedStructure(files);
      setFiles(processedFiles);
      setDuplicateInfo(dups);
    }
  };

  // --- RENDERING VARS ---
  const activeItemsToProcess = files.some(f => f.shouldProcess !== false);
  
  // Filters count calculation
  const countAll = files.length;
  const countDups = files.filter(f => f.isDuplicate || f.isDuplicateOriginal).length;
  const countMove = files.filter(f => !f.isDuplicate && (f.proposedPath !== f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) || f.proposedName !== f.name)).length;
  const countClean = files.filter(f => !f.isDuplicate && f.proposedPath === f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) && f.proposedName === f.name).length;

  // Filtered files list for table
  let filteredFiles = files;
  if (activeFilter === 'duplicates') {
    filteredFiles = files.filter(f => f.isDuplicate || f.isDuplicateOriginal);
  } else if (activeFilter === 'renamed') {
    filteredFiles = files.filter(f => !f.isDuplicate && (f.proposedPath !== f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) || f.proposedName !== f.name));
  } else if (activeFilter === 'clean') {
    filteredFiles = files.filter(f => !f.isDuplicate && f.proposedPath === f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) && f.proposedName === f.name);
  }

  // Calculate size segments for stats
  let totalSize = 0;
  files.forEach(f => { totalSize += f.size; });

  const healthPercent = files.length > 0 ? Math.round(((files.length - duplicateInfo.duplicateCount) / files.length) * 100) : 0;
  
  let healthPhrase = "Load a directory to analyze health.";
  let healthColor = "var(--text-muted)";
  if (files.length > 0) {
    if (healthPercent === 100) {
      healthPhrase = "Folder completely clean. Excellent!";
      healthColor = "var(--secondary)";
    } else if (healthPercent > 85) {
      healthPhrase = "Good shape. Few duplicates to clean.";
      healthColor = "var(--accent)";
    } else {
      healthPhrase = "Requires attention: duplicates & messy files found.";
      healthColor = "var(--warning)";
    }
  }

  const getFileIcon = (filename) => {
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    if (['.pdf'].includes(ext)) return 'fa-solid fa-file-pdf text-danger';
    if (['.docx', '.doc', '.odt'].includes(ext)) return 'fa-solid fa-file-word text-primary';
    if (['.xlsx', '.xls', '.csv'].includes(ext)) return 'fa-solid fa-file-excel text-success';
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic'].includes(ext)) return 'fa-solid fa-file-image text-accent';
    if (['.mp4', '.mov', '.avi'].includes(ext)) return 'fa-solid fa-file-video text-accent';
    if (['.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css', '.json', '.go', '.rs'].includes(ext)) return 'fa-solid fa-file-code text-primary';
    return 'fa-solid fa-file-lines text-muted';
  };

  return (
    <div id="app-container">
      {/* HEADER */}
      <header class="glass">
        <div className="logo-container">
          <div className="logo-icon">
            <i className="fa-solid fa-folder-tree"></i>
          </div>
          <span className="logo-text">AuraDrive</span>
          <span className="badge badge-info" style={{ marginLeft: '8px', fontSize: '0.7rem', padding: '2px 6px' }}>Local Offline</span>
        </div>
        
        <div className="header-actions">
          <button className="icon-btn" onClick={() => setShowSettings(true)} title="Cleaning configurations">
            <i className="fa-solid fa-sliders"></i>
          </button>
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
              <span className="sync-banner-title" style={{ color: 'var(--text-main)' }}>Files organized successfully!</span>
              <span className="sync-banner-desc">
                Your files have been renamed and relocated. If you made a mistake, you can reverse all actions immediately.
              </span>
            </div>
            <button className="action-btn secondary-btn" onClick={handleUndo} style={{ borderColor: 'var(--secondary)', color: 'var(--secondary)', padding: '6px 12px', fontSize: '0.8rem' }}>
              <i className="fa-solid fa-rotate-left"></i> Undo Changes
            </button>
          </div>
        )}

        <div className="organizer-layout">
          {/* LEFT SIDEBAR: Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Load Card */}
            <div className="source-panel glass" style={{ padding: '20px' }}>
              <div className="selection-title">Select Directory</div>
              
              <div 
                id="drop-zone"
                className={isDragOver ? 'drag-over' : ''}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                style={{ border: '2px dashed var(--border-color)', borderRadius: '12px', padding: '24px 16px', textAlign: 'center', cursor: 'pointer', transition: 'var(--transition-normal)', marginBottom: '12px' }}
                onClick={handleSelectFolder}
              >
                <i className="fa-solid fa-folder-closed" style={{ fontSize: '2.5rem', color: 'var(--text-muted)', marginBottom: '12px', display: 'block' }} id="drop-icon"></i>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500, display: 'block', lineHeight: 1.4 }} id="drop-text">
                  Drop folder here or click to load
                </span>
              </div>

              <button className="action-btn" onClick={handleSelectFolder} style={{ width: '100%' }}>
                <i className="fa-solid fa-folder-open"></i> Select Folder
              </button>

              {isFolderLoaded && (
                <div id="loaded-folder-info" style={{ padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', fontSize: '0.8rem', border: '1px solid var(--border-color)', marginTop: '12px' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Active folder:</div>
                  <div id="loaded-folder-name" style={{ wordBreak: 'break-all', fontFamily: 'monospace', color: 'var(--accent)' }}>{loadedFolderName}</div>
                </div>
              )}
            </div>

            {/* Stats Card */}
            <div className="storage-card glass" style={{ padding: '20px' }}>
              <div className="selection-title" style={{ marginBottom: '15px' }}>Folder Stats</div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                  <span className="legend-header"><i className="fa-solid fa-file text-muted" style={{ width: '16px' }}></i> Total files:</span>
                  <span className="legend-val" style={{ padding: 0, fontFamily: 'monospace' }}>{countAll}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                  <span className="legend-header"><i className="fa-solid fa-clone text-warning" style={{ width: '16px' }}></i> Duplicates:</span>
                  <span className="legend-val" style={{ padding: 0, fontFamily: 'monospace', color: 'var(--warning)' }}>{duplicateInfo.duplicateCount}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                  <span className="legend-header"><i className="fa-solid fa-circle-down text-success" style={{ width: '16px' }}></i> Saving Space:</span>
                  <span className="legend-val" style={{ padding: 0, fontFamily: 'monospace', color: 'var(--secondary)' }}>{formatBytes(duplicateInfo.savingPotentialBytes)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                  <span className="legend-header"><i className="fa-solid fa-route text-accent" style={{ width: '16px' }}></i> To Organize:</span>
                  <span className="legend-val" style={{ padding: 0, fontFamily: 'monospace', color: 'var(--accent)' }}>{countMove}</span>
                </div>
              </div>

              <div style={{ marginTop: '15px', borderTop: '1px solid var(--border-color)', paddingTop: '15px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'Outfit, sans-serif' }} id="status-percent">{isFolderLoaded ? `${healthPercent}%` : '-%'}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.3 }} id="status-phrase" style={{ color: healthColor }}>{healthPhrase}</div>
              </div>
            </div>

            {/* Actions Card */}
            <div className="glass" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button className="action-btn" onClick={handleExecuteOrganization} style={{ width: '100%' }} disabled={!isFolderLoaded || !activeItemsToProcess}>
                <i className="fa-solid fa-bolt"></i> Organize Folder
              </button>
              <button className="action-btn secondary-btn" onClick={handleUndo} style={{ width: '100%' }} disabled={undoHistoryLength === 0}>
                <i className="fa-solid fa-rotate-left"></i> Undo ({undoHistoryLength})
              </button>
              <button className="action-btn secondary-btn" onClick={clearWorkspaceState} style={{ width: '100%' }} disabled={!isFolderLoaded}>
                <i className="fa-solid fa-xmark"></i> Close Folder
              </button>
            </div>
          </div>

          {/* RIGHT VIEW: Workspace List */}
          <div className="workspace-panel glass">
            <div className="workspace-header">
              <h3 className="workspace-title">
                <i className="fa-solid fa-list-check" style={{ color: 'var(--primary)' }}></i> Changes Preview
              </h3>
              
              <div className="filter-bar">
                <button className={`filter-btn ${activeFilter === 'all' ? 'active' : ''}`} onClick={() => setActiveFilter('all')}>All ({countAll})</button>
                <button className={`filter-btn ${activeFilter === 'duplicates' ? 'active' : ''}`} onClick={() => setActiveFilter('duplicates')}>Duplicates ({countDups})</button>
                <button className={`filter-btn ${activeFilter === 'renamed' ? 'active' : ''}`} onClick={() => setActiveFilter('renamed')}>To Organize ({countMove})</button>
                <button className={`filter-btn ${activeFilter === 'clean' ? 'active' : ''}`} onClick={() => setActiveFilter('clean')}>No Changes ({countClean})</button>
              </div>
            </div>

            <div id="workspace-content" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              {/* Empty state */}
              {!isFolderLoaded && !isScanning && (
                <div className="empty-state" id="empty-workspace-state">
                  <div className="empty-icon">
                    <i className="fa-solid fa-hard-drive"></i>
                  </div>
                  <h4 className="empty-title">No Folder Selected</h4>
                  <p className="empty-desc">
                    Load a directory from your local drive. AuraDrive will recursively scan it, group duplicate files, and suggest a clean, organized folder structure. No files are changed until you confirm.
                  </p>
                  <button className="action-btn" onClick={handleSelectFolder}>
                    <i className="fa-solid fa-folder-open"></i> Select Folder
                  </button>
                </div>
              )}

              {/* Progress loader */}
              {isScanning && (
                <div className="scan-progress-overlay" id="scan-progress-container">
                  <div className="spinner"></div>
                  <div className="progress-text" id="scan-progress-text">{progressText}</div>
                  <div className="progress-subtext" id="scan-progress-subtext">{progressSubtext}</div>
                </div>
              )}

              {/* Table */}
              {isFolderLoaded && !isScanning && (
                <div className="table-container" id="results-table-container">
                  <table>
                    <thead>
                      <tr>
                        <th width="30">
                          <input 
                            type="checkbox" 
                            id="select-all-files" 
                            className="checkbox-custom" 
                            onChange={handleToggleSelectAll}
                            checked={files.length > 0 && files.every(f => f.shouldProcess !== false)}
                          />
                        </th>
                        <th>Original File</th>
                        <th>Proposed Location</th>
                        <th>Category</th>
                        <th>Status</th>
                        <th>Size</th>
                      </tr>
                    </thead>
                    <tbody id="results-tbody">
                      {filteredFiles.length === 0 ? (
                        <tr>
                          <td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                            No files found in this category.
                          </td>
                        </tr>
                      ) : (
                        // Render group headers and files reactively
                        filteredFiles.map((file, idx) => {
                          const isChecked = file.shouldProcess !== false;
                          const hasPathChange = file.proposedPath !== file.relativePath.substring(0, file.relativePath.lastIndexOf('/'));
                          const hasNameChange = file.proposedName !== file.name;
                          const isOrganized = hasPathChange || hasNameChange;

                          let badgeClass = 'badge-success';
                          let badgeText = 'No changes';
                          if (file.isDuplicate) {
                            badgeClass = 'badge-danger';
                            badgeText = 'Duplicate';
                          } else if (file.hasConflict) {
                            badgeClass = 'badge-warning';
                            badgeText = 'Conflict Resolved';
                          } else if (isOrganized) {
                            badgeClass = 'badge-info';
                            badgeText = 'Organize';
                          }

                          return (
                            <React.Fragment key={file.path || idx}>
                              {/* If duplicate header is needed */}
                              {file.isDuplicateOriginal && activeFilter !== 'renamed' && (
                                <tr className="duplicate-group-header">
                                  <td colSpan="6">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                                      <span>
                                        <i className="fa-solid fa-clone text-warning" style={{ marginRight: '8px' }}></i>
                                        Duplicate Group: <strong>{file.name}</strong> ({formatBytes(file.size)})
                                      </span>
                                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                        Original: <code style={{ color: 'var(--secondary)' }}>{file.path}</code>
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              )}

                              {/* Normal row */}
                              <tr className={file.hasConflict ? 'conflict-warning' : (file.isDuplicate ? 'duplicate-child' : '')}>
                                <td>
                                  <input 
                                    type="checkbox" 
                                    className="checkbox-custom" 
                                    checked={file.isDuplicateOriginal ? true : isChecked} 
                                    disabled={file.isDuplicateOriginal}
                                    onChange={() => handleToggleFile(file.path)}
                                  />
                                </td>
                                <td>
                                  <div className="file-item">
                                    <i className={file.isDuplicateOriginal ? "fa-solid fa-circle-check text-success" : (file.isDuplicate ? "fa-solid fa-trash-can text-danger" : getFileIcon(file.name))}></i>
                                    <span className="file-name-cell" style={file.isDuplicate ? { color: 'var(--text-muted)', textDecoration: 'line-through' } : {}} title={file.path}>{file.name}</span>
                                  </div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '20px' }}>
                                    Path: {file.path}
                                  </div>
                                  {file.hasConflict && (
                                    <div style={{ fontSize: '0.75rem', color: 'var(--warning)', marginLeft: '20px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                      <i className="fa-solid fa-circle-exclamation"></i> {file.conflictReason}
                                    </div>
                                  )}
                                </td>
                                <td>
                                  {file.isDuplicate ? (
                                    <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Trash (_Trash/) / Delete</span>
                                  ) : (isOrganized ? (
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                      <span className="proposed-name" style={file.hasConflict ? { color: 'var(--warning)' } : {}}>{file.proposedName}</span>
                                      <span className="proposed-path">/ {file.proposedPath}</span>
                                    </div>
                                  ) : (
                                    <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No changes required</span>
                                  ))}
                                </td>
                                <td>
                                  <span className="badge badge-info">{file.isDuplicateOriginal ? 'Original' : (file.categoryName || 'Unknown')}</span>
                                </td>
                                <td>
                                  <span className={`badge ${file.isDuplicateOriginal ? 'badge-success' : badgeClass}`}>{file.isDuplicateOriginal ? 'Original' : badgeText}</span>
                                </td>
                                <td>{formatBytes(file.size)}</td>
                              </tr>
                            </React.Fragment>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RULES ACCORDION SECTION */}
        <section className="glass" style={{ marginTop: '24px', padding: '24px' }}>
          <h3 className="card-title" style={{ marginBottom: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => setRulesExpanded(!rulesExpanded)}>
            <i className="fa-solid fa-gears" style={{ color: 'var(--primary)', marginRight: '10px' }}></i> Classification and Renaming Rules
            <i className={`fa-solid ${rulesExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`} style={{ fontSize: '0.8rem', marginLeft: 'auto' }}></i>
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            Define how your files are classified and matched. You can use dynamic template values like <code>{`{{year}}`}</code> (Year), <code>{`{{month}}`}</code> (Month), <code>{`{{day}}`}</code> (Day), <code>{`{{vendor}}`}</code> (Vendor), <code>{`{{amount}}`}</code> (Amount), and <code>{`{{client}}`}</code> (Client).
          </p>
          <div className={`rules-container ${rulesExpanded ? 'expanded' : ''}`}>
            {rulesList.map(rule => (
              <RuleCard key={rule.id} rule={rule} onSave={handleSaveRule} />
            ))}
          </div>
        </section>
      </main>

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div className="modal-overlay active">
          <SettingsModal 
            strategy={duplicateStrategy} 
            recursive={recursiveScan} 
            onClose={() => setShowSettings(false)} 
            onSave={handleSaveSettings}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Child Component: Rule Card Editor
 */
function RuleCard({ rule, onSave }) {
  const [folderPattern, setFolderPattern] = useState(rule.folderPattern);
  const [namePattern, setNamePattern] = useState(rule.namePattern);
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = () => {
    onSave(rule.id, folderPattern, namePattern);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 1200);
  };

  const extList = rule.extensions.join(', ');
  const keywordList = rule.keywords.length > 0 ? rule.keywords.join(', ') : 'Any (by extension only)';

  return (
    <div className="rule-card glass glass-interactive">
      <div className="rule-meta">
        <span className="rule-title">
          <i className="fa-solid fa-folder-open text-muted" style={{ marginRight: '6px' }}></i> {rule.name}
        </span>
        <span className="rule-category">{rule.category}</span>
      </div>
      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
        <strong>Extensions:</strong> {extList}
      </div>
      <div className="rule-details">
        <div className="rule-detail-item">
          <span className="rule-label">Target folder:</span>
          <input 
            type="text" 
            className="rule-input-field" 
            value={folderPattern} 
            onChange={(e) => setFolderPattern(e.target.value)}
          />
        </div>
        <div className="rule-detail-item">
          <span className="rule-label">Name template:</span>
          <input 
            type="text" 
            className="rule-input-field" 
            value={namePattern} 
            onChange={(e) => setNamePattern(e.target.value)}
          />
        </div>
        <div className="rule-detail-item" style={{ alignItems: 'flex-start' }}>
          <span className="rule-label">Keyword filters:</span>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'monospace', lineHeight: 1.3 }}>{keywordList}</span>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
        <button className="action-btn secondary-btn" onClick={handleSave} style={{ padding: '6px 12px', fontSize: '0.8rem', borderRadius: '6px' }}>
          <i className={`fa-solid ${isSaved ? 'fa-circle-check text-success' : 'fa-floppy-disk'}`}></i> {isSaved ? 'Saved' : 'Save Rule'}
        </button>
      </div>
    </div>
  );
}

/**
 * Child Component: Settings Modal
 */
function SettingsModal({ strategy, recursive, onClose, onSave }) {
  const [localStrategy, setLocalStrategy] = useState(strategy);
  const [localRecursive, setLocalRecursive] = useState(recursive);

  return (
    <div className="modal-content glass" onClick={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <h3 className="modal-title">
          <i className="fa-solid fa-sliders"></i> AuraDrive Settings
        </h3>
        <button className="modal-close" onClick={onClose}>
          <i className="fa-solid fa-xmark"></i>
        </button>
      </div>
      
      <div className="settings-group">
        <label className="settings-label" htmlFor="setting-duplicate-strategy">Action for Duplicates</label>
        <select 
          id="setting-duplicate-strategy" 
          className="settings-input" 
          style={{ backgroundColor: 'var(--bg-secondary)' }}
          value={localStrategy}
          onChange={(e) => setLocalStrategy(e.target.value)}
        >
          <option value="trash">Move to virtual trash folder (_Trash/)</option>
          <option value="delete">Delete permanently from drive</option>
          <option value="mark">Rename and prefix with [DUPLICATE_]</option>
        </select>
        <span className="settings-help">
          Define what action to take when duplicates are selected during organization.
        </span>
      </div>

      <div className="settings-group">
        <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input 
            type="checkbox" 
            className="checkbox-custom" 
            checked={localRecursive}
            onChange={(e) => setLocalRecursive(e.target.checked)}
          /> 
          <span>Recursive scan (include subfolders)</span>
        </label>
        <span className="settings-help">
          When checked, AuraDrive scans all files in subfolders inside the chosen directory.
        </span>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
        <button className="action-btn" onClick={() => onSave(localStrategy, localRecursive)} style={{ flex: 1 }}>Save Settings</button>
        <button className="action-btn secondary-btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
