/**
 * detector.ts - Advanced Duplicate Finder, Screenshots Identifier & Stale Files Ranking Engine
 * Performs cryptographic sparse binary hashing for real duplicate matching, screens for images/screenshots,
 * and handles age-based stale sorting configs.
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
 * Checks if a filename resembles a screenshot name pattern
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
 * Cryptographic helper to calculate sparse SHA-256 hash of a local file handle.
 * Reads full contents for files <= 8MB, and sparse chunks for larger files to prevent memory blockages.
 */
async function calculateFileHash(fileHandle: FileSystemFileHandle, size: number): Promise<string> {
  try {
    const file = await fileHandle.getFile();
    
    // If file is smaller than 8MB, hash the entire content
    if (size <= 8 * 1024 * 1024) {
      const buffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    // For larger files, read first 1MB, middle 1MB, and last 1MB to construct a secure sparse signature
    const chunkSize = 1024 * 1024; // 1MB
    const firstSlice = file.slice(0, chunkSize);
    const middleSlice = file.slice(Math.floor(size / 2) - chunkSize / 2, Math.floor(size / 2) + chunkSize / 2);
    const lastSlice = file.slice(size - chunkSize, size);
    
    const combinedBlob = new Blob([firstSlice, middleSlice, lastSlice]);
    const buffer = await combinedBlob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const signature = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    
    return `SPARSE_${size}_${signature}`;
  } catch (e) {
    console.error("Failed to calculate hash, falling back to metadata signature", fileHandle.name, e);
    return `FALLBACK_${size}_${fileHandle.name.toLowerCase()}`;
  }
}

/**
 * Groups files to identify duplicates based on exact cryptographic content hash comparison.
 * Maps file handles internally from the provided manager context.
 */
export async function detectDuplicates(
  files: ScannedFile[], 
  fileHandlesMap: Map<string, FileSystemFileHandle>
) {
  const sizeMap = new Map<number, ScannedFile[]>();
  
  // Group by size first (only files with matching sizes can be duplicates)
  files.forEach(file => {
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
      const hashGroupingMap = new Map<string, ScannedFile[]>();
      
      // Calculate true binary hashes for all candidates sharing this size
      for (const file of groupFiles) {
        const handle = fileHandlesMap.get(file.path);
        if (handle) {
          const hash = await calculateFileHash(handle, file.size);
          if (!hashGroupingMap.has(hash)) {
            hashGroupingMap.set(hash, []);
          }
          hashGroupingMap.get(hash)!.push(file);
        }
      }

      for (const [hash, dups] of hashGroupingMap.entries()) {
        if (dups.length > 1) {
          // Sort duplicates: oldest/shortest path first (keep as original)
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
 */
export function detectStaleFiles(
  files: ScannedFile[], 
  thresholdDays: number, 
  filterType: 'all' | 'images' | 'documents' = 'all'
): ScannedFile[] {
  const now = Date.now();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  
  const stale = files.filter(file => {
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

  stale.forEach(file => {
    file.ageDays = Math.floor((now - file.lastModified) / (24 * 60 * 60 * 1000));
    file.isImage = isImageFile(file.name);
    file.isScreenshot = isScreenshotFile(file.name);
  });

  return stale;
}
