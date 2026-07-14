/**
 * rules.js - AuraDrive Renaming and Routing Configuration Engine (English)
 * Defines default rules for matching categories, and handles renaming template parsing.
 */

// Default Rules Configuration
export const DEFAULT_RULES = [
  {
    id: 'invoices',
    name: 'Invoices and Receipts',
    category: 'invoices',
    extensions: ['.pdf', '.docx', '.jpg', '.jpeg', '.png'],
    keywords: ['invoice', 'factura', 'recibo', 'receipt', 'ticket', 'bill', 'compra'],
    folderPattern: 'Invoices/{{year}}/{{vendor}}',
    namePattern: '{{year}}{{month}}{{day}} - {{vendor}} - {{amount}}'
  },
  {
    id: 'contracts',
    name: 'Contracts and Agreements',
    category: 'contracts',
    extensions: ['.pdf', '.docx', '.doc', '.odt'],
    keywords: ['contrato', 'contract', 'nda', 'agreement', 'acuerdo', 'convenio', 'lease'],
    folderPattern: 'Documents/Contracts',
    namePattern: 'Contract - {{client}} - {{year}}'
  },
  {
    id: 'media',
    name: 'Photos and Videos',
    category: 'media',
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.mp4', '.mov', '.heic', '.webp'],
    keywords: ['img', 'dsc', 'photo', 'foto', 'video', 'vid', 'panorama'],
    folderPattern: 'Media/Photos/{{year}}-{{month}}',
    namePattern: 'Photo_{{year}}{{month}}{{day}}_{{hour}}{{minute}}{{second}}'
  },
  {
    id: 'code',
    name: 'Development Files',
    category: 'code',
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css', '.json', '.sh', '.go', '.rs', '.java'],
    keywords: ['code', 'script', 'main', 'test', 'index', 'app', 'utils', 'component'],
    folderPattern: 'Development/Projects',
    namePattern: '{{name}}'
  },
  {
    id: 'other',
    name: 'General Documents',
    category: 'other',
    extensions: ['.pdf', '.docx', '.xlsx', '.xls', '.pptx', '.ppt', '.txt', '.zip', '.rar'],
    keywords: [],
    folderPattern: 'Documents/General',
    namePattern: '{{name}}'
  }
];

// Load rules from localStorage or use defaults
export function getActiveRules() {
  const stored = localStorage.getItem('auradrive_rules');
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      console.error("Error loading stored rules, using defaults", e);
    }
  }
  return [...DEFAULT_RULES];
}

// Save rules to localStorage
export function saveRules(rules) {
  localStorage.setItem('auradrive_rules', JSON.stringify(rules));
}

// Reset rules to defaults
export function resetRules() {
  localStorage.removeItem('auradrive_rules');
  return [...DEFAULT_RULES];
}

/**
 * Heuristically parses a filename to extract variables: year, month, day, vendor, amount, client.
 * Returns an object with extracted metadata.
 */
export function extractMetadataFromFilename(filename) {
  const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;
  const extension = filename.substring(filename.lastIndexOf('.')) || '';
  
  // Initialize default metadata fields
  const meta = {
    name: nameWithoutExt,
    ext: extension,
    year: new Date().getFullYear().toString(),
    month: String(new Date().getMonth() + 1).padStart(2, '0'),
    day: String(new Date().getDate()).padStart(2, '0'),
    hour: '12',
    minute: '00',
    second: '00',
    vendor: 'Vendor',
    amount: '0.00',
    client: 'Client'
  };

  // 1. Try to extract Date (YYYY-MM-DD or DD-MM-YYYY)
  const isoDateRegex = /(20\d{2})[-_]?(0[1-9]|1[0-2])[-_]?(0[1-9]|[12]\d|3[01])/;
  const matchIso = nameWithoutExt.match(isoDateRegex);
  if (matchIso) {
    meta.year = matchIso[1];
    meta.month = matchIso[2];
    meta.day = matchIso[3];
  } else {
    // Try DD-MM-YYYY
    const dmyRegex = /(0[1-9]|[12]\d|3[01])[-_]?(0[1-9]|1[0-2])[-_]?(20\d{2})/;
    const matchDmy = nameWithoutExt.match(dmyRegex);
    if (matchDmy) {
      meta.day = matchDmy[1];
      meta.month = matchDmy[2];
      meta.year = matchDmy[3];
    } else {
      // Try YYYY alone
      const yearRegex = /\b(19\d{2}|20\d{2})\b/;
      const matchYear = nameWithoutExt.match(yearRegex);
      if (matchYear) {
        meta.year = matchYear[1];
      }
    }
  }

  // 2. Try to extract vendor (heuristics based on common file names)
  // Split name by separators, remove numbers/dates, find likely name
  const cleanTokens = nameWithoutExt
    .replace(/\b\d{4}[-_]?\d{2}[-_]?\d{2}\b/g, '') // remove iso dates
    .replace(/\b\d+\b/g, '') // remove numbers
    .split(/[-_\s]+/)
    .map(t => t.trim())
    .filter(t => t.length > 2 && !/invoice|factura|recibo|receipt|ticket|bill|pdf|docx|img/i.test(t));
  
  if (cleanTokens.length > 0) {
    // CamelCase formatting for vendor
    meta.vendor = cleanTokens[0].charAt(0).toUpperCase() + cleanTokens[0].slice(1).toLowerCase();
    if (cleanTokens.length > 1 && cleanTokens[1].length > 2) {
      meta.client = cleanTokens[1].charAt(0).toUpperCase() + cleanTokens[1].slice(1).toLowerCase();
    } else {
      meta.client = meta.vendor;
    }
  }

  // 3. Try to extract Amount (like 12.34 or 1234eur or $100)
  const currencyRegex = /(?:[\$€£]\s*|)\b(\d+(?:[.,]\d{2})?)\b(?:\s*[\$€£]|eur|usd|gbp|)/i;
  const matchAmount = nameWithoutExt.match(currencyRegex);
  if (matchAmount && matchAmount[1]) {
    if (matchAmount[1] !== meta.year) {
      meta.amount = matchAmount[1].replace(',', '.');
    }
  }

  // 4. Photos timestamp (e.g. IMG_20260714_174000)
  const photoTimestampRegex = /IMG_(\d{8})_(\d{6})/;
  const matchPhoto = nameWithoutExt.match(photoTimestampRegex);
  if (matchPhoto) {
    const dStr = matchPhoto[1];
    const tStr = matchPhoto[2];
    meta.year = dStr.substring(0, 4);
    meta.month = dStr.substring(4, 6);
    meta.day = dStr.substring(6, 8);
    meta.hour = tStr.substring(0, 2);
    meta.minute = tStr.substring(2, 4);
    meta.second = tStr.substring(4, 6);
  }

  return meta;
}

/**
 * Replaces double-curly braces templates with metadata variables.
 */
export function renderTemplate(template, metadata) {
  let rendered = template;
  for (const [key, value] of Object.entries(metadata)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
    rendered = rendered.replace(regex, value);
  }
  
  rendered = rendered
    .replace(/\/+/g, '/')
    .replace(/^\//, '')
    .replace(/\/$/, '');
    
  return rendered;
}
