/**
 * app.js - Main Application Controller (Local Simplified Refactored)
 * Connects folder drop/pick events, rule matching, conflicts, execution, and undo systems.
 */

import { localFS } from './fs-local.js';
import { detectDuplicates, classifyFile, resolveNamingConflicts } from './detector.js';
import { extractMetadataFromFilename, renderTemplate } from './rules.js';
import { updateDashboardMetrics, renderWorkspaceTable, renderRulesEditor } from './ui.js';

// Application State
const state = {
  files: [],
  duplicateInfo: { duplicateGroups: [], duplicateCount: 0, savingPotentialBytes: 0 },
  activeFilter: 'all',
  duplicateStrategy: localStorage.getItem('auradrive_dup_strategy') || 'trash',
  recursiveScan: localStorage.getItem('auradrive_recursive') !== 'false'
};

/**
 * Format bytes into human readable format
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Initial binding
document.addEventListener('DOMContentLoaded', () => {
  setupFolderLoaders();
  setupSettingsModal();
  setupWorkspaceFilters();
  setupActionTriggers();
  setupRulesAccordion();
  
  // Render rules initially
  renderRulesEditor();

  // Rules modified callback
  window.addEventListener('rules-updated', () => {
    if (state.files.length > 0) {
      evaluateProposedStructure().then(() => {
        refreshUI();
      });
    }
  });

  // Verify support
  if (!localFS.isSupported()) {
    alert("ADVERTENCIA: Tu navegador no soporta la API de Acceso a Archivos Locales. Usa Google Chrome o Microsoft Edge.");
    document.getElementById('btn-select-folder').disabled = true;
    document.getElementById('empty-select-folder-btn').disabled = true;
  }
});

/**
 * Folder Picker & Drag-and-Drop Binding
 */
function setupFolderLoaders() {
  const btnSelect = document.getElementById('btn-select-folder');
  const emptySelect = document.getElementById('empty-select-folder-btn');
  const dropZone = document.getElementById('drop-zone');

  const openPicker = async () => {
    try {
      const dirHandle = await localFS.selectRootDirectory();
      await scanAndLoadFolder(dirHandle);
    } catch (e) {
      if (e.name !== 'AbortError') {
        alert("Error al cargar la carpeta: " + e.message);
      }
    }
  };

  btnSelect.addEventListener('click', openPicker);
  emptySelect.addEventListener('click', openPicker);

  // Drag and drop events
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const item = items[0];
      if (item.kind === 'file') {
        try {
          // Check if item is directory using File System Access API entry retrieval
          const handle = await item.getAsFileSystemHandle();
          if (handle.kind === 'directory') {
            await scanAndLoadFolder(handle);
          } else {
            alert("Por favor suelta una CARPETA, no un archivo individual.");
          }
        } catch (err) {
          console.error("Drop retrieval failed:", err);
          alert("No se pudo leer la carpeta. Intenta usar el botón de selección.");
        }
      }
    }
  });
}

/**
 * Handles scanning, parsing rules, resolving conflicts, and UI updates
 */
async function scanAndLoadFolder(dirHandle) {
  // Hide undo banner when loading new directory
  document.getElementById('undo-banner').style.display = 'none';

  document.getElementById('loaded-folder-name').textContent = dirHandle.name;
  document.getElementById('loaded-folder-info').style.display = 'block';

  showLoading("Escaneando estructura local...", "Leyendo metadatos de archivos de forma segura...");

  try {
    localFS.rootDirHandle = dirHandle;
    const scanned = await localFS.scan(dirHandle, '', state.recursiveScan);
    state.files = scanned;

    if (state.files.length === 0) {
      hideLoading();
      clearWorkspaceState();
      alert("La carpeta seleccionada está vacía.");
      return;
    }

    await evaluateProposedStructure();
    refreshUI();
    hideLoading();
  } catch (err) {
    console.error("Scan error:", err);
    hideLoading();
    alert("No se pudo escanear el directorio: " + err.message);
  }
}

/**
 * Workspace Table Filters binding
 */
function setupWorkspaceFilters() {
  const filterBtns = document.querySelectorAll('.filter-bar .filter-btn');

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeFilter = btn.getAttribute('data-filter');
      
      if (state.files.length > 0) {
        renderWorkspaceTable(state.files, state.activeFilter, handleFileCheckboxToggle);
      }
    });
  });

  const selectAllCb = document.getElementById('select-all-files');
  selectAllCb.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    state.files.forEach(file => {
      file.shouldProcess = isChecked;
    });
    renderWorkspaceTable(state.files, state.activeFilter, handleFileCheckboxToggle);
    updateActionButtonsState();
  });
}

function handleFileCheckboxToggle(path, isChecked) {
  const file = state.files.find(f => f.path === path);
  if (file) {
    file.shouldProcess = isChecked;
    updateActionButtonsState();
  }
}

function updateActionButtonsState() {
  const btnRun = document.getElementById('btn-run-organize');
  const itemsToProcess = state.files.some(f => f.shouldProcess !== false);
  btnRun.disabled = state.files.length === 0 || !itemsToProcess;
  
  // Undo is active if history has transaction items
  const btnUndo = document.getElementById('btn-undo-clean');
  btnUndo.disabled = localFS.transactionHistory.length === 0;
}

/**
 * Settings configurations binding
 */
function setupSettingsModal() {
  const modal = document.getElementById('settings-modal');
  const btnOpen = document.getElementById('btn-settings');
  const btnClose = document.getElementById('btn-close-settings');
  const btnCancel = document.getElementById('btn-cancel-settings');
  const btnSave = document.getElementById('btn-save-settings');

  const strategySelect = document.getElementById('setting-duplicate-strategy');
  const recursiveCheck = document.getElementById('setting-recursive-scan');

  btnOpen.addEventListener('click', () => {
    strategySelect.value = state.duplicateStrategy;
    recursiveCheck.checked = state.recursiveScan;
    modal.classList.add('active');
  });

  const closeModal = () => modal.classList.remove('active');

  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);

  btnSave.addEventListener('click', async () => {
    state.duplicateStrategy = strategySelect.value;
    state.recursiveScan = recursiveCheck.checked;

    localStorage.setItem('auradrive_dup_strategy', state.duplicateStrategy);
    localStorage.setItem('auradrive_recursive', state.recursiveScan);

    closeModal();
    
    if (state.files.length > 0) {
      showLoading("Re-evaluando organización...");
      await evaluateProposedStructure();
      refreshUI();
      hideLoading();
    }
  });
}

/**
 * Expandable rules editor drawer toggle
 */
function setupRulesAccordion() {
  const trigger = document.getElementById('btn-toggle-rules');
  const chevron = document.getElementById('rules-chevron');
  const rulesContainer = document.getElementById('rules-cards-container');

  trigger.addEventListener('click', () => {
    const isExpanded = rulesContainer.classList.contains('expanded');
    
    if (isExpanded) {
      rulesContainer.classList.remove('expanded');
      chevron.className = 'fa-solid fa-chevron-down';
    } else {
      rulesContainer.classList.add('expanded');
      chevron.className = 'fa-solid fa-chevron-up';
    }
  });
}

/**
 * Core processor pipeline: runs offline classification, matches properties, checks collisions.
 */
async function evaluateProposedStructure() {
  // 1. Classify and parse heuristics
  state.files.forEach(file => {
    if (file.shouldProcess === undefined) {
      file.shouldProcess = true;
    }

    const rule = classifyFile(file.name);
    file.categoryName = rule.name;
    file.category = rule.category;

    const meta = extractMetadataFromFilename(file.name);
    file.proposedPath = renderTemplate(rule.folderPattern, meta);
    file.proposedName = renderTemplate(rule.namePattern, meta) + meta.ext;
  });

  // 2. Resolve naming duplicates/collisions
  resolveNamingConflicts(state.files);

  // 3. Detect duplicate files
  const dupResults = detectDuplicates(state.files);
  state.duplicateInfo = dupResults;

  // Autoselect duplicates to process by default
  state.files.forEach(file => {
    if (file.isDuplicate) {
      file.shouldProcess = true;
    }
  });
}

/**
 * Refresh stats, grids, metrics
 */
function refreshUI() {
  document.getElementById('count-all').textContent = state.files.length;
  document.getElementById('count-dups').textContent = state.files.filter(f => f.isDuplicate || f.isDuplicateOriginal).length;
  document.getElementById('count-move').textContent = state.files.filter(f => !f.isDuplicate && (f.proposedPath !== f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) || f.proposedName !== f.name)).length;
  document.getElementById('count-clean').textContent = state.files.filter(f => !f.isDuplicate && f.proposedPath === f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) && f.proposedName === f.name).length;

  renderWorkspaceTable(state.files, state.activeFilter, handleFileCheckboxToggle);
  
  document.getElementById('results-table-container').style.display = 'block';

  updateDashboardMetrics(state.files, state.duplicateInfo);
  updateActionButtonsState();
  
  document.getElementById('btn-clear-workspace').disabled = false;
}

/**
 * Clear/close folder state
 */
function clearWorkspaceState() {
  state.files = [];
  state.duplicateInfo = { duplicateGroups: [], duplicateCount: 0, savingPotentialBytes: 0 };
  
  localFS.reset();

  document.getElementById('results-tbody').innerHTML = '';
  document.getElementById('results-table-container').style.display = 'none';
  document.getElementById('empty-workspace-state').style.display = 'flex';
  document.getElementById('loaded-folder-info').style.display = 'none';
  document.getElementById('undo-banner').style.display = 'none';

  // Counts reset
  document.getElementById('count-all').textContent = '0';
  document.getElementById('count-dups').textContent = '0';
  document.getElementById('count-move').textContent = '0';
  document.getElementById('count-clean').textContent = '0';

  updateDashboardMetrics([], state.duplicateInfo);
  updateActionButtonsState();
  
  document.getElementById('btn-clear-workspace').disabled = true;
}

/**
 * Setup buttons: Organize, Undo, Close
 */
function setupActionTriggers() {
  const btnRun = document.getElementById('btn-run-organize');
  const btnUndo = document.getElementById('btn-undo-clean');
  const btnBannerUndo = document.getElementById('btn-banner-undo');
  const btnClear = document.getElementById('btn-clear-workspace');

  btnClear.addEventListener('click', () => {
    clearWorkspaceState();
  });

  // Action Clean Trigger
  btnRun.addEventListener('click', async () => {
    const filesToExecute = state.files.filter(f => f.shouldProcess !== false);
    const total = filesToExecute.length;

    if (total === 0) return;

    const confirmMsg = `¿Deseas aplicar la organización a los ${total} archivos seleccionados?\nEsta acción creará carpetas y renombrará/limpiará los archivos físicamente en tu disco.`;
    if (!confirm(confirmMsg)) return;

    showLoading("Organizando tus archivos locales...", "Creando carpetas y organizando ficheros...");

    try {
      await localFS.execute(state.files, state.duplicateStrategy, (count, total, msg) => {
        document.getElementById('scan-progress-text').textContent = `Progreso: ${count} de ${total} procesados`;
        document.getElementById('scan-progress-subtext').textContent = msg;
      });

      // Show Undo Banner
      document.getElementById('undo-banner').style.display = 'flex';
      
      // Rescan folder structure to see results
      await scanFolderQuietly();
    } catch (e) {
      console.error("Execution failed:", e);
      hideLoading();
      alert("Error al organizar archivos: " + e.message);
    }
  });

  // Action Undo Trigger
  const triggerUndo = async () => {
    if (localFS.transactionHistory.length === 0) return;

    const confirmMsg = `¿Deseas deshacer la organización?\nEsto restaurará todos los archivos movidos/renombrados a su estado y rutas originales.`;
    if (!confirm(confirmMsg)) return;

    showLoading("Deshaciendo cambios...", "Restaurando archivos a sus rutas originales...");

    try {
      await localFS.undo((count, total, msg) => {
        document.getElementById('scan-progress-text').textContent = `Restaurando: ${count} de ${total}`;
        document.getElementById('scan-progress-subtext').textContent = msg;
      });

      alert("¡Todos los cambios han sido revertidos con éxito!");
      document.getElementById('undo-banner').style.display = 'none';

      // Rescan structure
      await scanFolderQuietly();
    } catch (e) {
      console.error("Undo failed:", e);
      hideLoading();
      alert("Error al deshacer los cambios: " + e.message);
    }
  };

  btnUndo.addEventListener('click', triggerUndo);
  btnBannerUndo.addEventListener('click', triggerUndo);
}

/**
 * Quietly rescans directory handle after transaction completions
 */
async function scanFolderQuietly() {
  const dirHandle = localFS.rootDirHandle;
  const scanned = await localFS.scan(dirHandle, '', state.recursiveScan);
  state.files = scanned;
  await evaluateProposedStructure();
  refreshUI();
  hideLoading();
}

function showLoading(mainText, subText = '') {
  document.getElementById('empty-workspace-state').style.display = 'none';
  document.getElementById('results-table-container').style.display = 'none';
  
  const loader = document.getElementById('scan-progress-container');
  loader.style.display = 'flex';
  document.getElementById('scan-progress-text').textContent = mainText;
  document.getElementById('scan-progress-subtext').textContent = subText;
}

function hideLoading() {
  document.getElementById('scan-progress-container').style.display = 'none';
}
