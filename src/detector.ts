/**
 * detector.js - Duplicate Finder and Stale Files Ranking Engine
 * Identifies duplicate files and filters forgotten files based on custom age thresholds.
 */

/**
 * Groups files to identify duplicates based on identical size and name proxy.
 */
export function detectDuplicates(files) {
  const sizeMap = new Map();
  
  // Group by size first
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

  for (const [size, groupFiles] of sizeMap.entries()) {
    if (groupFiles.length > 1) {
      const checksumMap = new Map();
      
      groupFiles.forEach(file => {
        // Construct a proxy hash for local files (size + clean name without copy indicators)
        const nameKey = file.name.replace(/\s*\(copy\d*\)|\s*\(\d+\)|[-_]copy/gi, '').toLowerCase();
        const hash = `${file.size}_${nameKey}`;
        
        if (!checksumMap.has(hash)) {
          checksumMap.set(hash, []);
        }
        checksumMap.get(hash).push(file);
      });

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
 * Filters files older than custom threshold days and sorts them by size descending.
 * Ignores files already flagged as duplicate to prevent overlapping selections.
 */
export function detectStaleFiles(files, thresholdDays) {
  const now = Date.now();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  
  const stale = files.filter(file => {
    // Ignore duplicates, folders themselves, and files within _Trash or _Archive
    if (file.isDuplicate || file.path.startsWith('_Trash/') || file.path.startsWith('_Archive/')) {
      return false;
    }
    
    const ageMs = now - file.lastModified;
    return ageMs > thresholdMs;
  });

  // Calculate age in days and store in file object for UI display
  stale.forEach(file => {
    file.ageDays = Math.floor((now - file.lastModified) / (24 * 60 * 60 * 1000));
  });

  // Sort by size descending (largest old files ranked first)
  stale.sort((a, b) => b.size - a.size);

  return stale;
}
