/**
 * ui.js - User Interface Rendering and Layout Engine (Local Simplified)
 * Handles table previews, duplicate groups, conflict warnings, stats, and rule editing.
 */

import { formatBytes } from './app.js';
import { getActiveRules, saveRules } from './rules.js';

/**
 * Updates directory dashboard stats card
 */
export function updateDashboardMetrics(files, duplicateInfo) {
  let docsSize = 0;
  let mediaSize = 0;
  let codeSize = 0;
  let dupsSize = duplicateInfo.savingPotentialBytes;
  let otherSize = 0;
  let totalSize = 0;

  files.forEach(file => {
    totalSize += file.size;
    
    if (file.isDuplicate) return; 

    const ext = (file.name.substring(file.name.lastIndexOf('.')) || '').toLowerCase();
    
    if (['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.txt'].includes(ext)) {
      docsSize += file.size;
    } else if (['.jpg', '.jpeg', '.png', '.gif', '.mp4', '.mov', '.heic', '.webp'].includes(ext)) {
      mediaSize += file.size;
    } else if (['.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css', '.json', '.go', '.rs'].includes(ext)) {
      codeSize += file.size;
    } else {
      otherSize += file.size;
    }
  });

  // Calculate items proposed for rerouting/renaming
  const toOrganizeCount = files.filter(f => 
    !f.isDuplicate && 
    (f.proposedPath !== f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) || f.proposedName !== f.name)
  ).length;

  // Set metric labels
  document.getElementById('stat-total-files').textContent = files.length;
  document.getElementById('stat-duplicate-files').textContent = duplicateInfo.duplicateCount;
  document.getElementById('stat-saving-space').textContent = formatBytes(dupsSize);
  document.getElementById('stat-to-organize').textContent = toOrganizeCount;

  // Render Health
  const statusPercentEl = document.getElementById('status-percent');
  const statusPhraseEl = document.getElementById('status-phrase');

  if (files.length > 0) {
    const healthPercent = Math.round(((files.length - duplicateInfo.duplicateCount) / files.length) * 100);
    statusPercentEl.textContent = `${healthPercent}%`;
    
    if (healthPercent === 100) {
      statusPhraseEl.textContent = "Carpeta completamente limpia. ¡Excelente!";
      statusPhraseEl.style.color = "var(--secondary)";
    } else if (healthPercent > 85) {
      statusPhraseEl.textContent = "Buen estado. Pocos duplicados por limpiar.";
      statusPhraseEl.style.color = "var(--accent)";
    } else {
      statusPhraseEl.textContent = "Se requiere limpieza de duplicados y ordenar facturas.";
      statusPhraseEl.style.color = "var(--warning)";
    }
  } else {
    statusPercentEl.textContent = '-%';
    statusPhraseEl.textContent = "Carga un directorio para calcular limpieza.";
    statusPhraseEl.style.color = "var(--text-muted)";
  }
}

/**
 * Returns FontAwesome class names based on file name extension.
 */
function getFileIconClass(filename) {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  if (['.pdf'].includes(ext)) return 'fa-solid fa-file-pdf text-danger';
  if (['.docx', '.doc', '.odt'].includes(ext)) return 'fa-solid fa-file-word text-primary';
  if (['.xlsx', '.xls', '.csv'].includes(ext)) return 'fa-solid fa-file-excel text-success';
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic'].includes(ext)) return 'fa-solid fa-file-image text-accent';
  if (['.mp4', '.mov', '.avi'].includes(ext)) return 'fa-solid fa-file-video text-accent';
  if (['.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css', '.go', '.rs'].includes(ext)) return 'fa-solid fa-file-code text-primary';
  return 'fa-solid fa-file-lines text-muted';
}

/**
 * Renders the workspace file preview table based on files and current filter
 */
export function renderWorkspaceTable(files, activeFilter = 'all', onSelectChangeCallback) {
  const tbody = document.getElementById('results-tbody');
  tbody.innerHTML = '';

  let filteredFiles = files;

  if (activeFilter === 'duplicates') {
    filteredFiles = files.filter(f => f.isDuplicate || f.isDuplicateOriginal);
  } else if (activeFilter === 'renamed') {
    filteredFiles = files.filter(f => !f.isDuplicate && (f.proposedPath !== f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) || f.proposedName !== f.name));
  } else if (activeFilter === 'clean') {
    filteredFiles = files.filter(f => !f.isDuplicate && f.proposedPath === f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) && f.proposedName === f.name);
  }

  if (filteredFiles.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px; color: var(--text-muted);">
          No se encontraron archivos en esta categoría.
        </td>
      </tr>
    `;
    return;
  }

  const renderedDups = new Set();

  filteredFiles.forEach(file => {
    // --- DUPLICATE GROUP VIEW RENDER ---
    if (file.duplicateGroupId && !renderedDups.has(file.duplicateGroupId) && activeFilter !== 'renamed') {
      renderedDups.add(file.duplicateGroupId);
      
      const groupFiles = files.filter(f => f.duplicateGroupId === file.duplicateGroupId);
      const original = groupFiles.find(f => f.isDuplicateOriginal);
      const duplicatesOnly = groupFiles.filter(f => f.isDuplicate);

      const groupHeaderRow = document.createElement('tr');
      groupHeaderRow.className = 'duplicate-group-header';
      groupHeaderRow.innerHTML = `
        <td colspan="6">
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0;">
            <span>
              <i class="fa-solid fa-clone text-warning" style="margin-right: 8px;"></i>
              Grupo Duplicado: <strong>${original ? original.name : file.name}</strong> (${formatBytes(file.size)})
            </span>
            <span style="font-size: 0.8rem; color: var(--text-muted);">
              Original: <code style="color: var(--secondary);">${original ? original.path : 'Raíz'}</code>
            </span>
          </div>
        </td>
      `;
      tbody.appendChild(groupHeaderRow);

      if (original) {
        const origRow = document.createElement('tr');
        origRow.className = 'duplicate-child';
        origRow.innerHTML = `
          <td>
            <input type="checkbox" disabled class="checkbox-custom" checked>
          </td>
          <td>
            <div class="file-item">
              <i class="fa-solid fa-circle-check text-success"></i>
              <span class="file-name-cell">${original.name}</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-left: 20px;">
              Ruta: ${original.path}
            </div>
          </td>
          <td>
            <span class="proposed-name">${original.proposedName}</span>
            <div class="proposed-path">/ ${original.proposedPath}</div>
          </td>
          <td>
            <span class="badge badge-success">Original</span>
          </td>
          <td>
            <span class="badge badge-success">Original</span>
          </td>
          <td>${formatBytes(original.size)}</td>
        `;
        tbody.appendChild(origRow);
      }

      duplicatesOnly.forEach(dup => {
        const dupRow = document.createElement('tr');
        dupRow.className = 'duplicate-child';
        
        const isChecked = dup.shouldProcess !== false;

        dupRow.innerHTML = `
          <td>
            <input type="checkbox" class="checkbox-custom file-select-cb" data-path="${dup.path}" ${isChecked ? 'checked' : ''}>
          </td>
          <td>
            <div class="file-item">
              <i class="fa-solid fa-trash-can text-danger"></i>
              <span class="file-name-cell" style="color: var(--text-muted); text-decoration: line-through;">${dup.name}</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-left: 20px;">
              Ruta: ${dup.path}
            </div>
          </td>
          <td>
            <span style="color: var(--text-muted); font-style: italic;">Papelera (_Trash/) / Borrar</span>
          </td>
          <td>
            <span class="badge badge-danger">Duplicado</span>
          </td>
          <td>
            <span class="badge badge-danger">Limpiar</span>
          </td>
          <td>${formatBytes(dup.size)}</td>
        `;
        tbody.appendChild(dupRow);
      });

      return;
    }

    if (file.duplicateGroupId && activeFilter !== 'renamed') {
      return;
    }

    // --- STANDARD FILE PREVIEW ROW ---
    const row = document.createElement('tr');
    
    // Add collision styling classes if name collision occurred
    if (file.hasConflict) {
      row.className = 'conflict-warning';
    }

    const isChecked = file.shouldProcess !== false;

    const hasPathChange = file.proposedPath !== file.relativePath.substring(0, file.relativePath.lastIndexOf('/'));
    const hasNameChange = file.proposedName !== file.name;
    const isOrganized = hasPathChange || hasNameChange;

    let badgeClass = 'badge-success';
    let badgeText = 'Sin cambios';
    if (file.isDuplicate) {
      badgeClass = 'badge-danger';
      badgeText = 'Duplicado';
    } else if (file.hasConflict) {
      badgeClass = 'badge-warning';
      badgeText = 'Conflicto Resuelto';
    } else if (isOrganized) {
      badgeClass = 'badge-info';
      badgeText = 'Mover/Renombrar';
    }

    let fileIcon = getFileIconClass(file.name);

    row.innerHTML = `
      <td>
        <input type="checkbox" class="checkbox-custom file-select-cb" data-path="${file.path}" ${isChecked ? 'checked' : ''}>
      </td>
      <td>
        <div class="file-item">
          <i class="${fileIcon}"></i>
          <span class="file-name-cell" title="${file.path}">${file.name}</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-left: 20px;">
          Ruta: ${file.path}
        </div>
        ${file.hasConflict ? `
          <div style="font-size: 0.75rem; color: var(--warning); margin-left: 20px; margin-top: 4px; display: flex; align-items: center; gap: 4px;">
            <i class="fa-solid fa-circle-exclamation"></i> ${file.conflictReason}
          </div>
        ` : ''}
      </td>
      <td>
        ${isOrganized ? `
          <div style="display: flex; flex-direction: column;">
            <span class="proposed-name" style="${file.hasConflict ? 'color: var(--warning);' : ''}">${file.proposedName}</span>
            <span class="proposed-path">/ ${file.proposedPath}</span>
          </div>
        ` : `
          <span style="color: var(--text-muted); font-style: italic;">Sin cambios necesarios</span>
        `}
      </td>
      <td>
        <span class="badge badge-info">${file.categoryName || 'Desconocido'}</span>
      </td>
      <td>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </td>
      <td>${formatBytes(file.size)}</td>
    `;
    tbody.appendChild(row);
  });

  // Checkbox listeners
  const checkboxes = tbody.querySelectorAll('.file-select-cb');
  checkboxes.forEach(cb => {
    cb.addEventListener('change', (e) => {
      const path = e.target.getAttribute('data-path');
      const isChecked = e.target.checked;
      if (onSelectChangeCallback) {
        onSelectChangeCallback(path, isChecked);
      }
    });
  });
}

/**
 * Renders rules drawer contents
 */
export function renderRulesEditor() {
  const container = document.getElementById('rules-cards-container');
  container.innerHTML = '';

  const rules = getActiveRules();

  rules.forEach(rule => {
    const card = document.createElement('div');
    card.className = 'rule-card glass glass-interactive';
    
    const extList = rule.extensions.join(', ');
    const keywordList = rule.keywords.length > 0 ? rule.keywords.join(', ') : 'Cualquiera (sólo por extensión)';

    card.innerHTML = `
      <div class="rule-meta">
        <span class="rule-title"><i class="fa-solid fa-folder-open text-muted" style="margin-right: 6px;"></i> ${rule.name}</span>
        <span class="rule-category">${rule.category}</span>
      </div>
      <div style="font-size: 0.76rem; color: var(--text-muted);">
        <strong>Extensiones:</strong> ${extList}
      </div>
      <div class="rule-details">
        <div class="rule-detail-item">
          <span class="rule-label">Carpeta destino:</span>
          <input type="text" class="rule-input-field folder-pattern-input" data-rule-id="${rule.id}" value="${rule.folderPattern}">
        </div>
        <div class="rule-detail-item">
          <span class="rule-label">Plantilla nombre:</span>
          <input type="text" class="rule-input-field name-pattern-input" data-rule-id="${rule.id}" value="${rule.namePattern}">
        </div>
        <div class="rule-detail-item" style="align-items: flex-start;">
          <span class="rule-label">Filtros clave:</span>
          <span style="font-size: 0.78rem; color: var(--text-secondary); font-family: monospace; line-height: 1.3;">${keywordList}</span>
        </div>
      </div>
      <div style="display: flex; justify-content: flex-end; margin-top: 8px;">
        <button class="action-btn secondary-btn save-rule-btn" data-rule-id="${rule.id}" style="padding: 6px 12px; font-size: 0.8rem; border-radius: 6px;">
          <i class="fa-solid fa-floppy-disk"></i> Guardar Regra
        </button>
      </div>
    `;
    container.appendChild(card);
  });

  // Save rules handler
  container.querySelectorAll('.save-rule-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const ruleId = e.currentTarget.getAttribute('data-rule-id');
      const cardEl = e.currentTarget.closest('.rule-card');
      const folderPattern = cardEl.querySelector('.folder-pattern-input').value;
      const namePattern = cardEl.querySelector('.name-pattern-input').value;

      const updatedRules = rules.map(r => {
        if (r.id === ruleId) {
          return {
            ...r,
            folderPattern: folderPattern.trim(),
            namePattern: namePattern.trim()
          };
        }
        return r;
      });

      saveRules(updatedRules);

      // Save feedback
      btn.innerHTML = '<i class="fa-solid fa-circle-check text-success"></i> Guardado';
      btn.style.borderColor = 'var(--secondary)';
      setTimeout(() => {
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar Regra';
        btn.style.borderColor = 'var(--border-color)';
      }, 1200);

      // Re-evaluate preview table
      const event = new CustomEvent('rules-updated');
      window.dispatchEvent(event);
    });
  });
}
