import { describe, expect, it } from 'vitest';
import {
  createBuffer,
  deleteBuffer,
  duplicateBuffer,
  getActiveBuffer,
  inferBufferNameFromPattern,
  LEGACY_STORAGE_KEY_DIALECT,
  LEGACY_STORAGE_KEY_PATTERN,
  loadBufferStore,
  mergeExternalBufferStore,
  openPatternInSmartBuffer,
  parseBufferStore,
  PatternBufferStore,
  renameBuffer,
  saveBufferStore,
  STORAGE_KEY_BUFFERS,
  StorageLike,
  stripTxtExtension,
  toDownloadFileName,
  updateBufferContent,
} from '../patternBuffers';

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike & {
  dump: () => Record<string, string>;
} {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map.entries()),
  };
}

describe('patternBuffers progressive upgrade, CRUD & persistence', () => {
  it('starts fresh with a single blank "Pattern 1" US buffer when storage is empty', () => {
    const storage = createMemoryStorage();
    const store = loadBufferStore(storage);

    expect(store.version).toBe(1);
    expect(store.legacyMigrated).toBe(true);
    expect(store.buffers).toHaveLength(1);
    expect(store.buffers[0].name).toBe('Pattern 1');
    expect(store.buffers[0].patternText).toBe('');
    expect(store.buffers[0].dialect).toBe('US');
    expect(store.activeBufferId).toBe(store.buffers[0].id);
    expect(storage.getItem(STORAGE_KEY_BUFFERS)).not.toBeNull();
  });

  it('progressively upgrades existing legacy single-pattern storage without deleting legacy keys', () => {
    const legacyText = `Bunny Head [cream]:\nRnd 1: 6 pb in a magic ring (6)`;
    const storage = createMemoryStorage({
      [LEGACY_STORAGE_KEY_PATTERN]: legacyText,
      [LEGACY_STORAGE_KEY_DIALECT]: 'ES',
    });

    const firstLoad = loadBufferStore(storage);
    expect(firstLoad.buffers).toHaveLength(1);
    expect(firstLoad.buffers[0].name).toBe('Bunny Head');
    expect(firstLoad.buffers[0].patternText).toBe(legacyText);
    expect(firstLoad.buffers[0].dialect).toBe('ES');
    expect(firstLoad.legacyMigrated).toBe(true);

    // Non-destructive: legacy keys remain intact
    expect(storage.getItem(LEGACY_STORAGE_KEY_PATTERN)).toBe(legacyText);
    expect(storage.getItem(LEGACY_STORAGE_KEY_DIALECT)).toBe('ES');

    // Idempotent across repeated calls (React StrictMode safety)
    const secondLoad = loadBufferStore(storage);
    expect(secondLoad.buffers).toHaveLength(1);
    expect(secondLoad.buffers[0].id).toBe(firstLoad.buffers[0].id);
    expect(secondLoad.activeBufferId).toBe(firstLoad.activeBufferId);
  });

  it('falls back to "Saved Pattern" when legacy pattern has no piece header or title comment', () => {
    const legacyText = `1. 6 sc in a magic ring (6)\n2. 6 inc (12)`;
    const storage = createMemoryStorage({
      [LEGACY_STORAGE_KEY_PATTERN]: legacyText,
      [LEGACY_STORAGE_KEY_DIALECT]: 'UK',
    });

    const store = loadBufferStore(storage);
    expect(store.buffers[0].name).toBe('Saved Pattern');
    expect(store.buffers[0].dialect).toBe('UK');
    expect(store.buffers[0].patternText).toBe(legacyText);
  });

  it('progressively merges legacy pattern into an un-migrated v1 buffer list without losing existing buffers or duplicating', () => {
    const legacyText = `// Cozy Hat\n1. 6 sc in a magic ring (6)`;
    const existingStore: PatternBufferStore = {
      version: 1,
      activeBufferId: 'buf-a',
      buffers: [
        {
          id: 'buf-a',
          name: 'Scarf Draft',
          patternText: '1. Ch 12\n2. 11 sc',
          dialect: 'US',
          updatedAt: 1000,
        },
      ],
    };

    const storage = createMemoryStorage({
      [LEGACY_STORAGE_KEY_PATTERN]: legacyText,
      [LEGACY_STORAGE_KEY_DIALECT]: 'UK',
      [STORAGE_KEY_BUFFERS]: JSON.stringify(existingStore),
    });

    const upgraded = loadBufferStore(storage);
    expect(upgraded.legacyMigrated).toBe(true);
    expect(upgraded.buffers).toHaveLength(2);
    expect(upgraded.buffers[0].name).toBe('Scarf Draft');
    expect(upgraded.buffers[1].name).toBe('Cozy Hat');
    expect(upgraded.buffers[1].patternText).toBe(legacyText);
    expect(upgraded.buffers[1].dialect).toBe('UK');
    expect(upgraded.activeBufferId).toBe('buf-a');

    // Does not duplicate when pattern text already exists in the store
    const dupStore: PatternBufferStore = {
      version: 1,
      activeBufferId: 'buf-x',
      buffers: [
        {
          id: 'buf-x',
          name: 'Existing Cozy Hat',
          patternText: legacyText,
          dialect: 'UK',
          updatedAt: 2000,
        },
      ],
    };
    const storageNoDup = createMemoryStorage({
      [LEGACY_STORAGE_KEY_PATTERN]: legacyText,
      [LEGACY_STORAGE_KEY_DIALECT]: 'UK',
      [STORAGE_KEY_BUFFERS]: JSON.stringify(dupStore),
    });
    const noDupResult = loadBufferStore(storageNoDup);
    expect(noDupResult.buffers).toHaveLength(1);
    expect(noDupResult.buffers[0].name).toBe('Existing Cozy Hat');
  });

  it('populates a single blank v1 buffer during progressive upgrade instead of leaving an empty tab', () => {
    const legacyText = `Left Sleeve:\n1. 8 sc in a magic ring (8)`;
    const blankStore: PatternBufferStore = {
      version: 1,
      activeBufferId: 'empty-1',
      buffers: [
        {
          id: 'empty-1',
          name: 'Pattern 1',
          patternText: '   ',
          dialect: 'US',
          updatedAt: 1000,
        },
      ],
    };
    const storage = createMemoryStorage({
      [LEGACY_STORAGE_KEY_PATTERN]: legacyText,
      [LEGACY_STORAGE_KEY_DIALECT]: 'US',
      [STORAGE_KEY_BUFFERS]: JSON.stringify(blankStore),
    });

    const upgraded = loadBufferStore(storage);
    expect(upgraded.buffers).toHaveLength(1);
    expect(upgraded.buffers[0].id).toBe('empty-1');
    expect(upgraded.buffers[0].name).toBe('Left Sleeve');
    expect(upgraded.buffers[0].patternText).toBe(legacyText);
  });

  it('recovers cleanly from corrupt JSON, empty arrays, invalid dialects, and dangling activeBufferId', () => {
    const legacyText = `Body [blue]:\n1. 6 sc in a magic ring (6)`;
    const corruptStorage = createMemoryStorage({
      [LEGACY_STORAGE_KEY_PATTERN]: legacyText,
      [STORAGE_KEY_BUFFERS]: '{not valid json',
    });

    const recovered = loadBufferStore(corruptStorage);
    expect(recovered.buffers).toHaveLength(1);
    expect(recovered.buffers[0].patternText).toBe(legacyText);
    expect(recovered.buffers[0].name).toBe('Body');

    const emptyBuffersStorage = createMemoryStorage({
      [STORAGE_KEY_BUFFERS]: JSON.stringify({ version: 1, activeBufferId: 'missing', buffers: [] }),
    });
    const emptyRecovered = loadBufferStore(emptyBuffersStorage);
    expect(emptyRecovered.buffers).toHaveLength(1);
    expect(emptyRecovered.buffers[0].name).toBe('Pattern 1');

    const sanitized = parseBufferStore(
      JSON.stringify({
        version: 1,
        activeBufferId: 'does-not-exist',
        buffers: [
          {
            id: 'b1',
            name: 'Valid',
            patternText: '1. 6 sc',
            dialect: 'INVALID_DIALECT',
            updatedAt: 'nan',
          },
          {
            id: 'b1',
            name: 'Duplicate ID should skip',
            patternText: 'ignored',
            dialect: 'US',
          },
        ],
      })
    );
    expect(sanitized).not.toBeNull();
    expect(sanitized!.buffers).toHaveLength(1);
    expect(sanitized!.buffers[0].dialect).toBe('US');
    expect(sanitized!.activeBufferId).toBe('b1');
  });

  it('reports quota and unavailable errors safely from saveBufferStore', () => {
    const store = loadBufferStore(null);
    expect(saveBufferStore(store, null)).toEqual({ ok: false, error: 'unavailable' });

    const quotaStorage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        const err = new Error('Quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      },
    };
    expect(saveBufferStore(store, quotaStorage)).toEqual({ ok: false, error: 'quota' });
  });

  it('supports create, update, rename, duplicate, and delete CRUD operations', () => {
    let store = loadBufferStore(createMemoryStorage());
    const firstId = store.buffers[0].id;

    store = updateBufferContent(store, firstId, {
      patternText: '1. 6 sc in a magic ring (6)',
      dialect: 'UK',
      now: 200,
    });
    expect(getActiveBuffer(store).dialect).toBe('UK');

    // Create auto-increments name and inherits active dialect
    const created2 = createBuffer(store, { now: 300 });
    store = created2.store;
    expect(created2.buffer.name).toBe('Pattern 2');
    expect(created2.buffer.dialect).toBe('UK');
    expect(store.activeBufferId).toBe(created2.buffer.id);

    // Rename trims/clamps and ignores blank inputs
    const ignoredBlank = renameBuffer(store, created2.buffer.id, '   \t  ');
    expect(getActiveBuffer(ignoredBlank).name).toBe('Pattern 2');

    const longName = 'A'.repeat(60);
    store = renameBuffer(store, created2.buffer.id, `  ${longName}  `);
    expect(getActiveBuffer(store).name.length).toBe(48);

    store = renameBuffer(store, created2.buffer.id, '  Cozy   Mittens  ');
    expect(getActiveBuffer(store).name).toBe('Cozy Mittens');

    // Duplicate copies content, clears sourceExampleId, inserts next to source
    store = updateBufferContent(store, firstId, { sourceExampleId: 'amigurumi_sphere' });
    const dup = duplicateBuffer(store, firstId, 400);
    store = dup.store;
    expect(store.buffers).toHaveLength(3);
    expect(store.buffers[1].id).toBe(dup.buffer.id);
    expect(dup.buffer.name).toBe('Pattern 1 (Copy)');
    expect(dup.buffer.patternText).toBe('1. 6 sc in a magic ring (6)');
    expect(dup.buffer.sourceExampleId).toBeNull();

    // Delete selects neighbor cleanly
    const delDup = deleteBuffer(store, dup.buffer.id);
    expect(delDup.clearedLast).toBe(false);
    expect(delDup.store.buffers).toHaveLength(2);
    expect(delDup.store.activeBufferId).toBe(created2.buffer.id);

    // Deleting down to last buffer and clearing last resets to blank Pattern 1 keeping dialect
    const delSecond = deleteBuffer(delDup.store, created2.buffer.id);
    expect(delSecond.clearedLast).toBe(false);
    expect(delSecond.store.buffers).toHaveLength(1);

    const clearedLast = deleteBuffer(delSecond.store, firstId);
    expect(clearedLast.clearedLast).toBe(true);
    expect(clearedLast.store.buffers).toHaveLength(1);
    expect(clearedLast.store.buffers[0].name).toBe('Pattern 1');
    expect(clearedLast.store.buffers[0].patternText).toBe('');
    expect(clearedLast.store.buffers[0].dialect).toBe('UK');
  });

  it('opens examples, .txt files, and share links non-destructively via openPatternInSmartBuffer', () => {
    let store = loadBufferStore(createMemoryStorage());

    // 1. Empty active buffer gets replaced in-place
    const ex1 = openPatternInSmartBuffer(store, {
      name: 'Ideal Sphere',
      patternText: 'Sphere:\n1. 6 sc in a magic ring',
      dialect: 'US',
      sourceExampleId: 'amigurumi_sphere',
      reuseUnmodifiedExample: true,
    });
    store = ex1.store;
    expect(ex1.mode).toBe('replaced-active');
    expect(store.buffers).toHaveLength(1);
    expect(store.buffers[0].sourceExampleId).toBe('amigurumi_sphere');

    // 2. Browsing another example while on an unmodified example replaces it in-place (no tab spam)
    const ex2 = openPatternInSmartBuffer(store, {
      name: 'Shield & Sword',
      patternText: 'Shield:\n1. Ch 2, sc',
      dialect: 'US',
      sourceExampleId: 'shield_and_sword',
      reuseUnmodifiedExample: true,
    });
    store = ex2.store;
    expect(ex2.mode).toBe('replaced-active');
    expect(store.buffers).toHaveLength(1);

    // 3. Modifying the buffer clears sourceExampleId -> opening another example creates a NEW buffer!
    store = updateBufferContent(store, ex2.buffer.id, {
      patternText: 'Shield:\n1. Ch 2, sc\n2. 2 sc',
      sourceExampleId: null,
    });
    const ex3 = openPatternInSmartBuffer(store, {
      name: 'Ideal Sphere',
      patternText: 'Sphere:\n1. 6 sc in a magic ring',
      dialect: 'US',
      sourceExampleId: 'amigurumi_sphere',
      reuseUnmodifiedExample: true,
    });
    store = ex3.store;
    expect(ex3.mode).toBe('created-new');
    expect(store.buffers).toHaveLength(2);

    // 4. Selecting an already-open unmodified example simply switches to it
    store = { ...store, activeBufferId: ex2.buffer.id };
    const reused = openPatternInSmartBuffer(store, {
      name: 'Ideal Sphere',
      patternText: 'Sphere:\n1. 6 sc in a magic ring',
      dialect: 'US',
      sourceExampleId: 'amigurumi_sphere',
      reuseUnmodifiedExample: true,
    });
    expect(reused.mode).toBe('reused-existing');
    expect(reused.buffer.id).toBe(ex3.buffer.id);

    // 5. StrictMode / share link deduplication via reuseExactMatch
    const share1 = openPatternInSmartBuffer(reused.store, {
      name: 'Shared Flower',
      patternText: 'Flower:\n1. 5 sc in a magic ring',
      dialect: 'US',
      sourceExampleId: null,
      reuseExactMatch: true,
    });
    expect(share1.mode).toBe('created-new');
    const share2 = openPatternInSmartBuffer(share1.store, {
      name: 'Shared Flower',
      patternText: 'Flower:\n1. 5 sc in a magic ring',
      dialect: 'US',
      sourceExampleId: null,
      reuseExactMatch: true,
    });
    expect(share2.mode).toBe('reused-existing');
    expect(share2.store.buffers).toHaveLength(3);
  });

  it('merges cross-tab storage updates without losing active unsaved edits', () => {
    const localStore: PatternBufferStore = {
      version: 1,
      activeBufferId: 'tab-a',
      buffers: [
        { id: 'tab-a', name: 'Hat', patternText: '1. 6 sc', dialect: 'US', updatedAt: 10 },
        { id: 'tab-b', name: 'Scarf', patternText: '1. ch 10', dialect: 'US', updatedAt: 10 },
      ],
      legacyMigrated: true,
    };

    const externalStore: PatternBufferStore = {
      version: 1,
      activeBufferId: 'tab-c',
      buffers: [
        { id: 'tab-b', name: 'Scarf Renamed', patternText: '1. ch 20', dialect: 'UK', updatedAt: 50 },
        { id: 'tab-c', name: 'New From Other Tab', patternText: '1. 8 sc', dialect: 'ES', updatedAt: 60 },
      ],
      legacyMigrated: true,
    };

    // Tab A was deleted in external tab while local user has unsaved edits in Tab A
    const merged = mergeExternalBufferStore(localStore, externalStore, '1. 6 sc\n2. 6 inc');
    expect(merged.activeBufferId).toBe('tab-a');
    expect(merged.buffers.map((b) => b.name)).toEqual([
      'Scarf Renamed',
      'New From Other Tab',
      'Hat',
    ]);
    expect(getActiveBuffer(merged).patternText).toBe('1. 6 sc\n2. 6 inc');
  });

  it('infers titles and formats .txt filenames cleanly', () => {
    expect(inferBufferNameFromPattern('// CC: to red\nHead [tan]:\n1. 6 sc', 'Fallback')).toBe(
      'Head'
    );
    expect(inferBufferNameFromPattern('// Tiny Octopus\n1. 6 sc', 'Fallback')).toBe(
      'Tiny Octopus'
    );
    expect(stripTxtExtension('amigurumi-bear.TXT')).toBe('amigurumi-bear');
    expect(toDownloadFileName('My Bear (Copy)')).toBe('my-bear-copy.txt');
    expect(toDownloadFileName('   ', 'Octopus')).toBe('octopus.txt');
  });
});
