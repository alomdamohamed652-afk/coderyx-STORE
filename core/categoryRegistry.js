'use strict';

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.resolve('./products/_categories.json');

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'category';
}

class CategoryRegistry {
  constructor() {
    this.categories = new Map();
    this.ensureStore();
    this.load();
  }

  ensureStore() {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(STORE_PATH)) {
      fs.writeFileSync(STORE_PATH, JSON.stringify([], null, 2), 'utf8');
    }
  }

  load() {
    this.ensureStore();
    try {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      this.categories.clear();
      for (const item of Array.isArray(data) ? data : []) {
        if (!item?.id || !item?.name) continue;
        this.categories.set(item.id, {
          id: item.id,
          name: item.name,
          emoji: item.emoji || '📁',
          parentId: item.parentId || null,
          order: Number.isFinite(item.order) ? item.order : this.categories.size,
          createdAt: item.createdAt || new Date().toISOString(),
          updatedAt: item.updatedAt || new Date().toISOString(),
        });
      }
    } catch {
      this.categories.clear();
    }
  }

  _write() {
    fs.writeFileSync(STORE_PATH, JSON.stringify(this.getAll(), null, 2), 'utf8');
  }

  getAll() {
    return [...this.categories.values()].sort((a, b) => {
      const parent = String(a.parentId || '').localeCompare(String(b.parentId || ''));
      return parent || a.order - b.order || a.name.localeCompare(b.name, 'ar');
    });
  }

  get(id) {
    return this.categories.get(id) || null;
  }

  getChildren(parentId = null) {
    return this.getAll().filter(c => (c.parentId || null) === (parentId || null));
  }

  getPath(id) {
    const parts = [];
    let current = this.get(id);
    const seen = new Set();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      parts.unshift(current.name);
      current = current.parentId ? this.get(current.parentId) : null;
    }
    return parts.join(' / ');
  }

  findByPath(pathValue) {
    const normalized = String(pathValue || '')
      .split('/')
      .map(v => v.trim())
      .filter(Boolean);

    if (!normalized.length) return null;

    let parentId = null;
    let found = null;

    for (const name of normalized) {
      found = this.getChildren(parentId).find(c => c.name.toLowerCase() === name.toLowerCase());
      if (!found) return null;
      parentId = found.id;
    }
    return found;
  }

  ensurePath(pathValue, emoji = '📁') {
    const names = String(pathValue || '')
      .split('/')
      .map(v => v.trim())
      .filter(Boolean);

    if (!names.length) return null;

    let parentId = null;
    let current = null;

    for (const name of names) {
      current = this.getChildren(parentId).find(c => c.name.toLowerCase() === name.toLowerCase()) || null;
      if (!current) {
        const baseId = slugify(name);
        let id = baseId;
        let n = 2;
        while (this.categories.has(id)) id = baseId + '-' + n++;
        current = {
          id,
          name,
          emoji: emoji || '📁',
          parentId,
          order: this.getChildren(parentId).length,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.categories.set(id, current);
      }
      parentId = current.id;
    }

    this._write();
    return current;
  }

  create({ name, parentId = null, emoji = '📁' }) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('اسم الفئة مطلوب.');
    if (parentId && !this.get(parentId)) throw new Error('الفئة الأب غير موجودة.');

    const duplicate = this.getChildren(parentId).find(c => c.name.toLowerCase() === cleanName.toLowerCase());
    if (duplicate) throw new Error('توجد فئة بنفس الاسم داخل هذا المستوى بالفعل.');

    const baseId = slugify(cleanName);
    let id = baseId;
    let n = 2;
    while (this.categories.has(id)) id = baseId + '-' + n++;

    const category = {
      id,
      name: cleanName,
      emoji: String(emoji || '📁').trim().slice(0, 10) || '📁',
      parentId: parentId || null,
      order: this.getChildren(parentId).length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.categories.set(id, category);
    this._write();
    return category;
  }

  update(id, patch = {}) {
    const category = this.get(id);
    if (!category) return null;
    const updated = { ...category, ...patch, id, updatedAt: new Date().toISOString() };
    this.categories.set(id, updated);
    this._write();
    return updated;
  }

  remove(id) {
    const category = this.get(id);
    if (!category) return false;
    if (this.getChildren(id).length) throw new Error('لا يمكن حذف فئة تحتوي على فئات فرعية.');
    this.categories.delete(id);
    this._write();
    return true;
  }

  pathForProduct(product) {
    if (product?.categoryId && this.get(product.categoryId)) return this.getPath(product.categoryId);
    if (product?.category) return String(product.category);
    return 'غير مصنف';
  }

  categoryIdForProduct(product) {
    if (product?.categoryId && this.get(product.categoryId)) return product.categoryId;
    if (product?.category) return this.ensurePath(product.category)?.id || null;
    return null;
  }

  getProducts(categoryId, registry) {
    return registry.getVisible().filter(p => this.categoryIdForProduct(p) === categoryId);
  }

  getDescendantIds(categoryId) {
    const ids = [];
    const walk = id => {
      for (const child of this.getChildren(id)) {
        ids.push(child.id);
        walk(child.id);
      }
    };
    walk(categoryId);
    return ids;
  }
}

module.exports = new CategoryRegistry();
