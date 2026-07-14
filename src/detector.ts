/**
 * detector.ts - Enhanced Duplicate Finder, Screenshots Identifier & Stale Files Ranking Engine
 * Identifies duplicate files, screens for images/screenshots, and handles sorting configurations.
 */

export interface ScannedFile {
  name: string;
  path: string;
  size: number;
  type: string;
  lastModified: number;
  relativePath: string;
  source: string;
  shouldProcess?: boolean;
  isDuplicate?: boolean;
  isDuplicateOriginal?: boolean;
  duplicateGroupId?: string;
  duplicateOriginalPath?: string;
  duplicateOriginalName?: string;
  ageDays?: number;
  isImage?: boolean;
  isScreenshot?: boolean;
}

/**
 * Checks if a filename belongs to a standard image format
 */
export function isImageFile(filename: string): boolean {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.tiff', '.bmp'].includes(ext);
}

/**
 * Checks if a filename resembles a screenshot name pattern (Windows, macOS, Linux naming)
 */
export function isScreenshotFile(filename: string): boolean {
  const nameLower = filename.toLowerCase();
  return (
    nameLower.includes('screenshot') ||
    nameLower.includes('captura de pantalla') ||
    nameLower.includes('captura') ||
    nameLower.includes('screen_') ||
    /screen\s*shot/i.test(nameLower) ||
    /capturadb/i.test(nameLower)
  );
}

/**
 * Groups files to identify duplicates based on identical size and name proxy.
 */
export function detectDuplicates(files: ScannedFile[]) {
  const sizeMap = new Map<number, ScannedFile[]>();
  
  // Group by size first
  files.forEach(file => {
    // Reset flags before re-detecting
    file.isDuplicate = false;
    file.isDuplicateOriginal = false;
    file.duplicateGroupId = undefined;
    file.duplicateOriginalPath = undefined;
    file.duplicateOriginalName = undefined;

    if (file.size && file.size > 0) {
      if (!sizeMap.has(file.size)) {
        sizeMap.set(file.size, []);
      }
      sizeMap.get(file.size)!.push(file);
    }
  });

  const duplicateGroups: Array<{ hash: string; original: ScannedFile; duplicates: ScannedFile[] }> = [];
  let duplicateCount = 0;
  let savingPotentialBytes = 0;
  let duplicateImagesCount = 0;
  let duplicateImagesBytes = 0;

  for (const [size, groupFiles] of sizeMap.entries()) {
    if (groupFiles.length > 1) {
      const checksumMap = new Map<string, ScannedFile[]>();
      
      groupFiles.forEach(file => {
        // Construct a proxy hash for local files (size + clean name without copy indicators)
        const nameKey = file.name.replace(/\s*\(copy\d*\)|\s*\(\d+\)|[-_]copy/gi, '').toLowerCase();
        const hash = `${file.size}_${nameKey}`;
        
        if (!checksumMap.has(hash)) {
          checksumMap.set(hash, []);
        }
        checksumMap.get(hash)!.push(file);
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

            if (isImageFile(duplicate.name) || isScreenshotFile(duplicate.name)) {
              duplicateImagesCount++;
              duplicateImagesBytes += duplicate.size;
            }
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
    savingPotentialBytes,
    duplicateImagesCount,
    duplicateImagesBytes
  };
}

/**
 * Filters files older than custom threshold days and sorts them.
 * Ignores files already flagged as duplicate to prevent overlapping selections.
 */
export function detectStaleFiles(
  files: ScannedFile[], 
  thresholdDays: number, 
  filterType: 'all' | 'images' | 'documents' = 'all'
): ScannedFile[] {
  const now = Date.now();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  
  const stale = files.filter(file => {
    // Ignore duplicates and files inside system trash/archives
    if (file.isDuplicate || file.path.startsWith('_Trash/') || file.path.startsWith('_Archive/')) {
      return false;
    }
    
    const ageMs = now - file.lastModified;
    if (ageMs <= thresholdMs) return false;

    // Apply filters
    if (filterType === 'images') {
      return isImageFile(file.name) || isScreenshotFile(file.name);
    }
    if (filterType === 'documents') {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      return ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'].includes(ext);
    }

    return true;
  });

  // Attach metadata fields
  stale.forEach(file => {
    file.ageDays = Math.floor((now - file.lastModified) / (24 * 60 * 60 * 1000));
    file.isImage = isImageFile(file.name);
    file.isScreenshot = isScreenshotFile(file.name);
  });

  return stale;
}
