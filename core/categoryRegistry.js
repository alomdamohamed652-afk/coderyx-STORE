'use strict';

const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const registry = require('./registry');

const FILE = path.resolve(cfg.products.folder, '_categories.json');
const VERSION = 2;
const GENERAL_NAME = 'عام';
let memoryStore = null;

function normalize(input) {
  if (Array.isArray(input)) return input.map(v => String(v).trim()).filter(Boolean);
  return String(input || '')
    .split(/\s*(?:>|\/|→|›)\s*/)
    .map(v => v.trim())
    .filter(Boolean);
}

function key(parts) {
  return normalize(parts).join(' > ');
}

function safeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
}

function readStore() {
  if (memoryStore) return memoryStore;
  try {
    if (!fs.existsSync(FILE)) {
      memoryStore = { version: VERSION, categories: [], displayMode: 'grouped', nextId: 1 };
      return memoryStore;
    }
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));

    // v2
    if (Array.isArray(raw.categories)) {
      memoryStore = {
        version: VERSION,
        categories: raw.categories.filter(Boolean).map(c => ({
          id: safeId(c.id) || null,
          name: String(c.name || '').trim(),
          parentId: c.parentId ? safeId(c.parentId) : null,
          order: Number.isFinite(Number(c.order)) ? Number(c.order) : 0,
          createdAt: c.createdAt || new Date().toISOString(),
          updatedAt: c.updatedAt || new Date().toISOString(),
        })).filter(c => c.name),
        displayMode: raw.displayMode === 'categories_only' ? 'categories_only' : 'grouped',
        nextId: Math.max(1, Number(raw.nextId) || 1),
      };
      return memoryStore;
    }

    // v1 migration: paths were stored as strings.
    const legacy = Array.isArray(raw) ? raw : (Array.isArray(raw.paths) ? raw.paths : []);
    const store = { version: VERSION, categories: [], displayMode: 'grouped', nextId: 1 };
    const pathToId = new Map();

    const ensureLegacy = parts => {
      let parentId = null;
      for (const name of parts) {
        const pathKey = parentId ? `${parentId}::${name}` : name;
        let category = store.categories.find(c => c.parentId === parentId && c.name === name);
        if (!category) {
          category = {
            id: `C-${String(store.nextId++).padStart(3, '0')}`,
            name,
            parentId,
            order: store.categories.length,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          store.categories.push(category);
        }
        pathToId.set(pathKey, category.id);
        parentId = category.id;
      }
    };

    for (const rawPath of legacy) {
      const parts = normalize(rawPath);
      if (parts.length) ensureLegacy(parts);
    }

    memoryStore = store;
    return memoryStore;
  } catch (err) {
    console.warn('[CategoryRegistry] فشل قراءة _categories.json:', err.message);
    memoryStore = { version: VERSION, categories: [], displayMode: 'grouped', nextId: 1 };
    return memoryStore;
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  memoryStore = store;
  fs.writeFileSync(FILE, JSON.stringify({
    version: VERSION,
    displayMode: store.displayMode === 'categories_only' ? 'categories_only' : 'grouped',
    nextId: store.nextId,
    categories: store.categories,
  }, null, 2), 'utf8');
}

function pathForCategory(store, categoryId) {
  const byId = new Map(store.categories.map(c => [c.id, c]));
  const parts = [];
  const seen = new Set();
  let current = byId.get(categoryId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return parts;
}

function childrenOf(store, parentId = null) {
  return store.categories
    .filter(c => (c.parentId || null) === (parentId || null))
    .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name, 'ar'));
}

function findCategory(store, id) {
  return store.categories.find(c => c.id === id) || null;
}

function categoryView(store, category) {
  if (!category) return null;
  const path = pathForCategory(store, category.id);
  return { ...category, path, pathKey: key(path), children: childrenOf(store, category.id) };
}

function createCategory(store, name, parentId = null) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('اسم التصنيف فارغ.');

  if (parentId && !findCategory(store, parentId)) throw new Error('التصنيف الأب غير موجود.');
  if (store.categories.some(c => c.parentId === (parentId || null) && c.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error('يوجد تصنيف بنفس الاسم داخل هذا المستوى.');
  }

  const category = {
    id: `C-${String(store.nextId++).padStart(3, '0')}`,
    name: clean,
    parentId: parentId || null,
    order: childrenOf(store, parentId).length,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.categories.push(category);
  return category;
}

function ensurePath(inputPath) {
  const parts = normalize(inputPath);
  if (!parts.length) throw new Error('مسار التصنيف فارغ.');

  const store = readStore();
  let parentId = null;
  let category = null;

  for (const name of parts) {
    category = store.categories.find(c => c.parentId === parentId && c.name.toLowerCase() === name.toLowerCase());
    if (!category) category = createCategory(store, name, parentId);
    parentId = category.id;
  }

  writeStore(store);
  syncProducts(store);
  return categoryView(store, category);
}

function syncProducts(store) {
  const byPath = new Map(store.categories.map(c => [key(pathForCategory(store, c.id)), c.id]));
  for (const product of registry.getAll()) {
    const parts = normalize(product.categoryPath || product.category || '');
    if (!parts.length || key(parts) === GENERAL_NAME) continue;
    const categoryId = byPath.get(key(parts));
    if (categoryId && product.categoryId !== categoryId) {
      try { registry.save(product.id, { categoryId, categoryPath: parts, category: parts.join(' > ') }); } catch {}
    }
  }
}

function getAllCategories() {
  const store = readStore();
  return store.categories
    .map(c => categoryView(store, c))
    .sort((a, b) => (a.order - b.order) || a.pathKey.localeCompare(b.pathKey, 'ar'));
}

function getById(id) {
  const store = readStore();
  return categoryView(store, findCategory(store, safeId(id)));
}

function getByPath(inputPath) {
  const wanted = normalize(inputPath);
  const store = readStore();
  const found = store.categories.find(c => key(pathForCategory(store, c.id)) === key(wanted));
  return categoryView(store, found);
}

function getChildCategories(parentPath = []) {
  const wanted = normalize(parentPath);
  const parent = wanted.length ? getByPath(wanted) : null;
  const store = readStore();
  return childrenOf(store, parent?.id || null).map(c => categoryView(store, c));
}

function getChildren(parentPath = []) {
  return getChildCategories(parentPath).map(c => c.path);
}

function getRootCategories() {
  return getChildren([]);
}

function getProducts(categoryRef = []) {
  const category = Array.isArray(categoryRef) ? getByPath(categoryRef) : getById(categoryRef);
  if (!category) return [];
  return registry.getVisible().filter(p => {
    if (p.categoryId) return p.categoryId === category.id;
    return key(normalize(p.categoryPath || p.category)) === category.pathKey;
  });
}

function getGeneralProducts() {
  return registry.getVisible().filter(p => {
    const parts = normalize(p.categoryPath || p.category || '');
    return !p.categoryId || !parts.length || key(parts) === GENERAL_NAME;
  });
}

function hasChildren(ref = []) {
  const category = Array.isArray(ref) ? getByPath(ref) : getById(ref);
  return !!category && getChildren(category.path).length > 0;
}

function rename(id, name) {
  const store = readStore();
  const category = findCategory(store, safeId(id));
  if (!category) throw new Error('التصنيف غير موجود.');
  const clean = String(name || '').trim();
  if (!clean) throw new Error('اسم التصنيف لا يمكن أن يكون فارغًا.');

  if (store.categories.some(c => c.id !== category.id && c.parentId === category.parentId && c.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error('يوجد تصنيف بنفس الاسم داخل هذا المستوى.');
  }

  const oldPath = pathForCategory(store, category.id);
  category.name = clean;
  category.updatedAt = new Date().toISOString();
  const newPath = pathForCategory(store, category.id);

  writeStore(store);

  // تحديث categoryPath للمنتجات المرتبطة بهذا التصنيف وبكل الفروع تحته.
  for (const product of registry.getAll()) {
    const parts = normalize(product.categoryPath || product.category || '');
    if (key(parts.slice(0, oldPath.length)) === key(oldPath)) {
      const suffix = parts.slice(oldPath.length);
      const updatedPath = [...newPath, ...suffix];
      const newCategory = getByPath(updatedPath);
      try {
        registry.save(product.id, {
          categoryId: newCategory?.id || category.id,
          categoryPath: updatedPath,
          category: updatedPath.join(' > '),
        });
      } catch {}
    }
  }

  return getById(id);
}

function deleteCategory(id) {
  const store = readStore();
  const category = findCategory(store, safeId(id));
  if (!category) throw new Error('التصنيف غير موجود.');

  const rootPath = pathForCategory(store, category.id);
  const ids = new Set([category.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of store.categories) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id);
        changed = true;
      }
    }
  }

  const movedProducts = [];
  for (const product of registry.getAll()) {
    const parts = normalize(product.categoryPath || product.category || '');
    const linked = product.categoryId ? ids.has(product.categoryId) : key(parts.slice(0, rootPath.length)) === key(rootPath);
    if (linked) {
      try {
        registry.save(product.id, { categoryId: null, categoryPath: [GENERAL_NAME], category: GENERAL_NAME });
        movedProducts.push(product.id);
      } catch {}
    }
  }

  store.categories = store.categories.filter(c => !ids.has(c.id));
  writeStore(store);

  return { deletedId: category.id, deletedPath: rootPath, deletedCount: ids.size, movedProducts };
}

function setDisplayMode(mode) {
  const store = readStore();
  store.displayMode = mode === 'categories_only' ? 'categories_only' : 'grouped';
  writeStore(store);
  return store.displayMode;
}

function getDisplayMode() {
  return readStore().displayMode === 'categories_only' ? 'categories_only' : 'grouped';
}

function treeLines() {
  const categories = getAllCategories();
  if (!categories.length) return ['لا توجد تصنيفات بعد.'];

  return categories.map(c => {
    const depth = Math.max(0, c.path.length - 1);
    const prefix = depth ? '│  '.repeat(depth) + '└─ ' : '';
    const count = getProducts(c.id).length;
    return `${prefix}📁 **${c.name}** ` + `(${c.id})` + (count ? ` — ${count} منتج` : '');
  });
}

function bootstrapFromProducts() {
  const store = readStore();
  let changed = false;

  for (const product of registry.getAll()) {
    const parts = normalize(product.categoryPath || product.category || '');
    if (!parts.length || key(parts) === GENERAL_NAME) continue;

    let parentId = null;
    for (const name of parts) {
      let category = store.categories.find(c => c.parentId === parentId && c.name.toLowerCase() === name.toLowerCase());
      if (!category) {
        category = createCategory(store, name, parentId);
        changed = true;
      }
      parentId = category.id;
    }
  }

  if (changed) writeStore(store);
  syncProducts(store);
}

bootstrapFromProducts();

module.exports = {
  normalize,
  key,
  getAllCategories,
  getAllPaths() { return getAllCategories().map(c => c.path); },
  getById,
  getByPath,
  getRootCategories,
  getChildren,
  getChildCategories,
  getProducts,
  getGeneralProducts,
  hasChildren,
  ensurePath,
  rename,
  deleteCategory,
  setDisplayMode,
  getDisplayMode,
  treeLines,
  GENERAL_NAME,
};
