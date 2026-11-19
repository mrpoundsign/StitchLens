import { CrochetDialect } from '../core/model/types';

export const STORAGE_KEY_BUFFERS = 'stitchlens.buffers.v1';
export const LEGACY_STORAGE_KEY_PATTERN = 'stitchlens.currentPattern.v1';
export const LEGACY_STORAGE_KEY_DIALECT = 'stitchlens.currentDialect.v1';

const MAX_BUFFER_NAME_LEN = 48;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface PatternBuffer {
  id: string;
  name: string;
  patternText: string;
  dialect: CrochetDialect;
  updatedAt: number;
  sourceExampleId?: string | null;
}

export interface PatternBufferStore {
  version: 1;
  activeBufferId: string;
  buffers: PatternBuffer[];
  legacyMigrated?: boolean;
}

export type SaveBufferStoreResult =
  | { ok: true }
  | { ok: false; error: 'quota' | 'unavailable' };

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function generateBufferId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return randomUUID.call(globalThis.crypto);
  }
  return `buf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sanitizeDialect(value: unknown): CrochetDialect {
  if (value === 'US' || value === 'UK' || value === 'ES') {
    return value;
  }
  return 'US';
}

export function sanitizeBufferName(raw: string, fallback = 'Untitled'): string {
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  if (!collapsed) return fallback;
  const clamped = collapsed.slice(0, MAX_BUFFER_NAME_LEN).trim();
  return clamped || fallback;
}

export function inferBufferNameFromPattern(patternText: string, fallback: string): string {
  const lines = patternText.split(/\r?\n/);
  let inspected = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    inspected++;
    if (inspected > 10) break;

    if (line.startsWith('//') || line.startsWith('#')) {
      const stripped = line.replace(/^(?:\/\/|#)+\s*/, '').trim();
      if (
        stripped.length >= 2 &&
        stripped.length <= 36 &&
        !/^(?:cc:|note:|@)/i.test(stripped)
      ) {
        return sanitizeBufferName(stripped, fallback);
      }
      continue;
    }

    const pieceMatch = /^([A-Za-z][A-Za-z0-9 _'-]{1,32}?)(?:\s*\[[^\]]+\])?\s*:$/.exec(line);
    if (pieceMatch) {
      const pieceName = pieceMatch[1].trim();
      if (!/^(?:rnd|round|row|r\d|cc|note|attach|glue|pin|sew)\b/i.test(pieceName)) {
        return sanitizeBufferName(pieceName, fallback);
      }
    }
  }

  return fallback;
}

export function makeUniqueBufferName(
  baseName: string,
  existingBuffers: PatternBuffer[],
  excludeId?: string
): string {
  const cleanBase = sanitizeBufferName(baseName, 'Untitled');
  const taken = new Set(
    existingBuffers
      .filter((b) => b.id !== excludeId)
      .map((b) => b.name.trim().toLowerCase())
  );

  if (!taken.has(cleanBase.toLowerCase())) {
    return cleanBase;
  }

  for (let suffixNum = 2; suffixNum < 10000; suffixNum++) {
    const suffix = ` ${suffixNum}`;
    const stem = cleanBase.slice(0, Math.max(1, MAX_BUFFER_NAME_LEN - suffix.length)).trimEnd();
    const candidate = `${stem}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `${cleanBase.slice(0, 40)} ${Date.now().toString(36).slice(-6)}`;
}

export function nextDefaultBufferName(existingBuffers: PatternBuffer[]): string {
  const taken = new Set(existingBuffers.map((b) => b.name.trim().toLowerCase()));
  for (let idx = 1; idx < 10000; idx++) {
    const candidate = `Pattern ${idx}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `Pattern ${existingBuffers.length + 1}`;
}

export function stripTxtExtension(fileName: string): string {
  const stem = fileName.trim().replace(/\.txt$/i, '');
  return sanitizeBufferName(stem, 'Imported Pattern');
}

export function toDownloadFileName(bufferName: string, fallbackPieceName?: string): string {
  const withoutExt = bufferName.trim().replace(/\.txt$/i, '');
  const slugFromBuffer = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slugFromBuffer) {
    return `${slugFromBuffer}.txt`;
  }

  if (fallbackPieceName) {
    const slugFromPiece = fallbackPieceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (slugFromPiece) {
      return `${slugFromPiece}.txt`;
    }
  }

  return 'crochet-pattern.txt';
}

export function getActiveBuffer(store: PatternBufferStore): PatternBuffer {
  return store.buffers.find((b) => b.id === store.activeBufferId) ?? store.buffers[0];
}

export function parseBufferStore(raw: string | null): PatternBufferStore | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.buffers)) return null;

  const seenIds = new Set<string>();
  const buffers: PatternBuffer[] = [];

  for (const item of record.buffers) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== 'string' || !entry.id.trim()) continue;
    if (seenIds.has(entry.id)) continue;
    if (typeof entry.patternText !== 'string') continue;

    seenIds.add(entry.id);
    const name = sanitizeBufferName(
      typeof entry.name === 'string' ? entry.name : '',
      `Pattern ${buffers.length + 1}`
    );
    const dialect = sanitizeDialect(entry.dialect);
    const updatedAt =
      typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
        ? entry.updatedAt
        : Date.now();
    const sourceExampleId =
      typeof entry.sourceExampleId === 'string'
        ? entry.sourceExampleId
        : entry.sourceExampleId === null
          ? null
          : undefined;

    buffers.push({
      id: entry.id,
      name,
      patternText: entry.patternText,
      dialect,
      updatedAt,
      ...(sourceExampleId !== undefined ? { sourceExampleId } : {}),
    });
  }

  if (buffers.length === 0) return null;

  const requestedActiveId =
    typeof record.activeBufferId === 'string' ? record.activeBufferId : '';
  const activeBufferId = seenIds.has(requestedActiveId) ? requestedActiveId : buffers[0].id;

  return {
    version: 1,
    activeBufferId,
    buffers,
    ...(typeof record.legacyMigrated === 'boolean'
      ? { legacyMigrated: record.legacyMigrated }
      : {}),
  };
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number };
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014
  );
}

export function saveBufferStore(
  store: PatternBufferStore,
  storage?: StorageLike | null
): SaveBufferStoreResult {
  const target = storage === undefined ? getDefaultStorage() : storage;
  if (!target) {
    return { ok: false, error: 'unavailable' };
  }

  try {
    const payload: PatternBufferStore = {
      ...store,
      version: 1,
      legacyMigrated: true,
    };
    target.setItem(STORAGE_KEY_BUFFERS, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    if (isQuotaError(err)) {
      return { ok: false, error: 'quota' };
    }
    return { ok: false, error: 'unavailable' };
  }
}

export function loadBufferStore(storage?: StorageLike | null): PatternBufferStore {
  const target = storage === undefined ? getDefaultStorage() : storage;

  let legacyPattern = '';
  let legacyDialectRaw: string | null = null;
  let rawBuffers: string | null = null;

  if (target) {
    try {
      legacyPattern = target.getItem(LEGACY_STORAGE_KEY_PATTERN) ?? '';
    } catch {
      legacyPattern = '';
    }
    try {
      legacyDialectRaw = target.getItem(LEGACY_STORAGE_KEY_DIALECT);
    } catch {
      legacyDialectRaw = null;
    }
    try {
      rawBuffers = target.getItem(STORAGE_KEY_BUFFERS);
    } catch {
      rawBuffers = null;
    }
  }

  const parsed = parseBufferStore(rawBuffers);
  const legacyDialect = sanitizeDialect(legacyDialectRaw);
  const hasLegacyContent = legacyPattern.trim().length > 0;

  // Case 1: New store missing, corrupt, or empty -> seed from legacy keys (non-destructively)
  if (!parsed) {
    const initialBuffer: PatternBuffer = {
      id: generateBufferId(),
      name: hasLegacyContent
        ? inferBufferNameFromPattern(legacyPattern, 'Saved Pattern')
        : 'Pattern 1',
      patternText: legacyPattern,
      dialect: legacyDialect,
      updatedAt: Date.now(),
      sourceExampleId: null,
    };
    const store: PatternBufferStore = {
      version: 1,
      activeBufferId: initialBuffer.id,
      buffers: [initialBuffer],
      legacyMigrated: true,
    };
    saveBufferStore(store, target);
    return store;
  }

  // Case 2: Existing store hasn't completed progressive upgrade yet
  if (parsed.legacyMigrated !== true) {
    let nextBuffers = parsed.buffers;

    if (hasLegacyContent) {
      const alreadyIncluded = parsed.buffers.some((b) => b.patternText === legacyPattern);
      if (!alreadyIncluded) {
        const inferredName = inferBufferNameFromPattern(legacyPattern, 'Saved Pattern');
        if (parsed.buffers.length === 1 && !parsed.buffers[0].patternText.trim()) {
          nextBuffers = [
            {
              ...parsed.buffers[0],
              name: inferredName,
              patternText: legacyPattern,
              dialect: legacyDialect,
              updatedAt: Date.now(),
              sourceExampleId: null,
            },
          ];
        } else {
          nextBuffers = [
            ...parsed.buffers,
            {
              id: generateBufferId(),
              name: makeUniqueBufferName(inferredName, parsed.buffers),
              patternText: legacyPattern,
              dialect: legacyDialect,
              updatedAt: Date.now(),
              sourceExampleId: null,
            },
          ];
        }
      }
    }

    const upgraded: PatternBufferStore = {
      ...parsed,
      buffers: nextBuffers,
      legacyMigrated: true,
    };
    saveBufferStore(upgraded, target);
    return upgraded;
  }

  // Case 3: Already upgraded
  return parsed;
}

export function createBuffer(
  store: PatternBufferStore,
  opts?: {
    name?: string;
    patternText?: string;
    dialect?: CrochetDialect;
    sourceExampleId?: string | null;
    now?: number;
  }
): { store: PatternBufferStore; buffer: PatternBuffer } {
  const now = opts?.now ?? Date.now();
  const active = getActiveBuffer(store);
  const dialect = opts?.dialect ?? active.dialect;
  const name = opts?.name
    ? makeUniqueBufferName(sanitizeBufferName(opts.name), store.buffers)
    : nextDefaultBufferName(store.buffers);

  const buffer: PatternBuffer = {
    id: generateBufferId(),
    name,
    patternText: opts?.patternText ?? '',
    dialect,
    updatedAt: now,
    sourceExampleId: opts?.sourceExampleId ?? null,
  };

  return {
    store: {
      ...store,
      activeBufferId: buffer.id,
      buffers: [...store.buffers, buffer],
    },
    buffer,
  };
}

export function updateBufferContent(
  store: PatternBufferStore,
  bufferId: string,
  patch: {
    patternText?: string;
    dialect?: CrochetDialect;
    sourceExampleId?: string | null;
    now?: number;
  }
): PatternBufferStore {
  const now = patch.now ?? Date.now();
  let changed = false;

  const buffers = store.buffers.map((b) => {
    if (b.id !== bufferId) return b;
    changed = true;
    return {
      ...b,
      ...(patch.patternText !== undefined ? { patternText: patch.patternText } : {}),
      ...(patch.dialect !== undefined ? { dialect: patch.dialect } : {}),
      ...(patch.sourceExampleId !== undefined ? { sourceExampleId: patch.sourceExampleId } : {}),
      updatedAt: now,
    };
  });

  if (!changed) return store;
  return { ...store, buffers };
}

export function renameBuffer(
  store: PatternBufferStore,
  bufferId: string,
  rawName: string,
  now = Date.now()
): PatternBufferStore {
  const cleaned = sanitizeBufferName(rawName, '');
  if (!cleaned) return store;

  const target = store.buffers.find((b) => b.id === bufferId);
  if (!target) return store;

  const uniqueName = makeUniqueBufferName(cleaned, store.buffers, bufferId);
  if (uniqueName === target.name) return store;

  return {
    ...store,
    buffers: store.buffers.map((b) =>
      b.id === bufferId ? { ...b, name: uniqueName, updatedAt: now } : b
    ),
  };
}

export function duplicateBuffer(
  store: PatternBufferStore,
  bufferId: string,
  now = Date.now()
): { store: PatternBufferStore; buffer: PatternBuffer } {
  const sourceIdx = store.buffers.findIndex((b) => b.id === bufferId);
  const resolvedIdx = sourceIdx >= 0 ? sourceIdx : 0;
  const source = store.buffers[resolvedIdx];

  const copyName = makeUniqueBufferName(`${source.name} (Copy)`, store.buffers);
  const copy: PatternBuffer = {
    id: generateBufferId(),
    name: copyName,
    patternText: source.patternText,
    dialect: source.dialect,
    updatedAt: now,
    sourceExampleId: null,
  };

  const nextBuffers = [
    ...store.buffers.slice(0, resolvedIdx + 1),
    copy,
    ...store.buffers.slice(resolvedIdx + 1),
  ];

  return {
    store: {
      ...store,
      activeBufferId: copy.id,
      buffers: nextBuffers,
    },
    buffer: copy,
  };
}

export function deleteBuffer(
  store: PatternBufferStore,
  bufferId: string,
  now = Date.now()
): { store: PatternBufferStore; clearedLast: boolean } {
  if (store.buffers.length <= 1) {
    const only = store.buffers[0];
    const blank: PatternBuffer = {
      id: generateBufferId(),
      name: 'Pattern 1',
      patternText: '',
      dialect: only?.dialect ?? 'US',
      updatedAt: now,
      sourceExampleId: null,
    };
    return {
      store: {
        ...store,
        activeBufferId: blank.id,
        buffers: [blank],
      },
      clearedLast: true,
    };
  }

  const removedIdx = store.buffers.findIndex((b) => b.id === bufferId);
  if (removedIdx < 0) {
    return { store, clearedLast: false };
  }

  const remaining = store.buffers.filter((b) => b.id !== bufferId);
  const nextActiveId =
    store.activeBufferId === bufferId
      ? remaining[Math.min(removedIdx, remaining.length - 1)].id
      : store.activeBufferId;

  return {
    store: {
      ...store,
      activeBufferId: nextActiveId,
      buffers: remaining,
    },
    clearedLast: false,
  };
}

export function openPatternInSmartBuffer(
  store: PatternBufferStore,
  incoming: {
    name: string;
    patternText: string;
    dialect: CrochetDialect;
    sourceExampleId?: string | null;
    reuseUnmodifiedExample?: boolean;
    reuseExactMatch?: boolean;
    now?: number;
  }
): {
  store: PatternBufferStore;
  buffer: PatternBuffer;
  mode: 'reused-existing' | 'replaced-active' | 'created-new';
} {
  const now = incoming.now ?? Date.now();

  if (incoming.sourceExampleId) {
    const existingExample = store.buffers.find(
      (b) =>
        b.sourceExampleId === incoming.sourceExampleId && b.patternText === incoming.patternText
    );
    if (existingExample) {
      return {
        store: {
          ...store,
          activeBufferId: existingExample.id,
        },
        buffer: existingExample,
        mode: 'reused-existing',
      };
    }
  } else if (incoming.reuseExactMatch && incoming.patternText.trim().length > 0) {
    const exactMatch = store.buffers.find(
      (b) => b.patternText === incoming.patternText && b.dialect === incoming.dialect
    );
    if (exactMatch) {
      return {
        store: {
          ...store,
          activeBufferId: exactMatch.id,
        },
        buffer: exactMatch,
        mode: 'reused-existing',
      };
    }
  }

  const active = getActiveBuffer(store);
  const canReplaceActive =
    !active.patternText.trim() ||
    (Boolean(incoming.reuseUnmodifiedExample) && Boolean(active.sourceExampleId));

  if (canReplaceActive) {
    const nextName = makeUniqueBufferName(
      sanitizeBufferName(incoming.name),
      store.buffers,
      active.id
    );
    const updatedBuf: PatternBuffer = {
      ...active,
      name: nextName,
      patternText: incoming.patternText,
      dialect: incoming.dialect,
      updatedAt: now,
      sourceExampleId: incoming.sourceExampleId ?? null,
    };
    return {
      store: {
        ...store,
        activeBufferId: updatedBuf.id,
        buffers: store.buffers.map((b) => (b.id === active.id ? updatedBuf : b)),
      },
      buffer: updatedBuf,
      mode: 'replaced-active',
    };
  }

  const created = createBuffer(store, {
    name: incoming.name,
    patternText: incoming.patternText,
    dialect: incoming.dialect,
    sourceExampleId: incoming.sourceExampleId ?? null,
    now,
  });

  return {
    store: created.store,
    buffer: created.buffer,
    mode: 'created-new',
  };
}

export function mergeExternalBufferStore(
  localStore: PatternBufferStore,
  externalStore: PatternBufferStore,
  localActiveText?: string
): PatternBufferStore {
  const localActive = getActiveBuffer(localStore);
  const effectiveActiveText = localActiveText !== undefined ? localActiveText : localActive.patternText;
  const isLocallyDirty = effectiveActiveText !== localActive.patternText;

  const preservedActive: PatternBuffer = isLocallyDirty
    ? {
        ...localActive,
        patternText: effectiveActiveText,
        sourceExampleId: null,
      }
    : localActive;

  let foundActive = false;
  const mergedBuffers = externalStore.buffers.map((extBuf) => {
    if (extBuf.id === localActive.id) {
      foundActive = true;
      return preservedActive;
    }
    return extBuf;
  });

  if (!foundActive) {
    mergedBuffers.push(preservedActive);
  }

  return {
    version: 1,
    activeBufferId: localActive.id,
    buffers: mergedBuffers,
    legacyMigrated: externalStore.legacyMigrated ?? localStore.legacyMigrated ?? true,
  };
}
