/**
 * detector.js - Duplicate Finder and File Classification Engine (Local Refactored)
 * Processes lists of files to find duplicates, categorizes them, and prevents path conflicts.
 */

import { getActiveRules } from './rules.js';

/**
 * Groups files to identify duplicates.
 * A duplicate is defined by:
 * - Identical size (greater than 0) AND identical names/hashes.
 */
export function detectDuplicates(files) {
  const sizeMap = new Map();
  
  // Group by size first (fastest filter)
  files.forEach(file => {
    if (file.size && file.size > 0) {
      if (!sizeMap.has(file.size)) {
        sizeMap.set(file.size, []);
      }
      sizeMap.get(file.size).push(file);
    }
  });

  const duplicateGroups = [];
  let duplicateCount = 0;
  let savingPotentialBytes = 0;

  // Analyze size groups
  for (const [size, groupFiles] of sizeMap.entries()) {
    if (groupFiles.length > 1) {
      const checksumMap = new Map();
      
      groupFiles.forEach(file => {
        // Construct a proxy hash for local files (size + name pattern without copy suffixes)
        const nameKey = file.name.replace(/\s*\(copy\d*\)|\s*\(\d+\)|[-_]copy/gi, '');
        const hash = `${file.size}_${nameKey}`;
        
        if (!checksumMap.has(hash)) {
          checksumMap.set(hash, []);
        }
        checksumMap.get(hash).push(file);
      });

      // For checksum groups with >1 files, we have duplicates
      for (const [hash, dups] of checksumMap.entries()) {
        if (dups.length > 1) {
          // Sort: oldest/shortest path first (to keep as original)
          dups.sort((a, b) => {
            const cleanA = a.name.includes('copy') || /\(\d+\)/.test(a.name) ? 1 : 0;
            const cleanB = b.name.includes('copy') || /\(\d+\)/.test(b.name) ? 1 : 0;
            if (cleanA !== cleanB) return cleanA - cleanB;
            
            if (a.lastModified && b.lastModified) {
              return a.lastModified - b.lastModified;
            }
            return a.path.length - b.path.length;
          });

          const original = dups[0];
          original.isDuplicateOriginal = true;
          original.duplicateGroupId = hash;

          // Mark others as duplicates
          for (let i = 1; i < dups.length; i++) {
            const duplicate = dups[i];
            duplicate.isDuplicate = true;
            duplicate.duplicateGroupId = hash;
            duplicate.duplicateOriginalPath = original.path;
            duplicate.duplicateOriginalName = original.name;
            
            duplicateCount++;
            savingPotentialBytes += duplicate.size;
          }

          duplicateGroups.push({
            hash,
            original,
            duplicates: dups.slice(1)
          });
        }
      }
    }
  }

  return {
    duplicateGroups,
    duplicateCount,
    savingPotentialBytes
  };
}

/**
 * Classifies a file based on active rules.
 * Matches extension first, then keywords in the filename.
 */
export function classifyFile(filename) {
  const rules = getActiveRules();
  const lowerName = filename.toLowerCase();
  const dotIndex = filename.lastIndexOf('.');
  const ext = dotIndex !== -1 ? filename.substring(dotIndex).toLowerCase() : '';

  const extMatches = rules.filter(r => r.extensions.includes(ext));

  if (extMatches.length > 0) {
    for (const rule of extMatches) {
      if (rule.keywords.length > 0) {
        const matchesKeyword = rule.keywords.some(kw => lowerName.includes(kw.toLowerCase()));
        if (matchesKeyword) {
          return rule;
        }
      }
    }
    
    const specificExtMatch = extMatches.find(r => r.id !== 'other');
    if (specificExtMatch) {
      return specificExtMatch;
    }
  }

  return rules.find(r => r.id === 'other') || rules[rules.length - 1];
}

/**
 * Prevents name collisions by appending _1, _2 suffixes
 * if multiple files are scheduled to be moved to the exact same folder and name.
 */
export function resolveNamingConflicts(files) {
  const pathMap = new Map();

  files.forEach(file => {
    // Reset conflict status
    file.hasConflict = false;
    file.conflictReason = '';

    // If file is flagged to be skipped, or is duplicate and strategy is delete/trash, ignore conflicts
    if (file.shouldProcess === false || (file.isDuplicate && file.shouldProcess)) {
      return; 
    }

    const targetPath = `${file.proposedPath}/${file.proposedName}`;
    if (!pathMap.has(targetPath)) {
      pathMap.set(targetPath, []);
    }
    pathMap.get(targetPath).push(file);
  });

  // Check mapped groups
  for (const [targetPath, groupFiles] of pathMap.entries()) {
    if (groupFiles.length > 1) {
      // Conflict found. Resolve it by appending index values
      groupFiles.forEach((file, index) => {
        if (index > 0) {
          const dotIndex = file.proposedName.lastIndexOf('.');
          const base = dotIndex !== -1 ? file.proposedName.substring(0, dotIndex) : file.proposedName;
          const ext = dotIndex !== -1 ? file.proposedName.substring(dotIndex) : '';
          
          const oldName = file.proposedName;
          file.proposedName = `${base}_${index}${ext}`;
          file.hasConflict = true;
          file.conflictReason = `Name conflict: Another file would be named '${oldName}' in destination. Appended suffix to '${file.proposedName}' to avoid overwriting data.`;
        }
      });
    }
  }
}
