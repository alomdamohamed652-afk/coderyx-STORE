'use strict';

const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const registry = require('./registry');

const FILE = path.resolve(cfg.products.folder, '_categories.json');

function normalize(input) {
  if (Array.isArray(input)) {
    return input.map(v => String(v).trim()).filter(Boolean);
  }
  return String(input || '')
    .split(/\s*(?:>|\/|→)\s*/)
    .map(v => v.trim())
    .filter(Boolean);
}

function key(parts) {
  return normalize(parts).join(' > ');
}

function readExplicit() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(raw) ? raw : (Array.isArray(raw.paths) ? raw.paths : []);
  } catch (err) {
    console.warn('[CategoryRegistry] فشل قراءة _categories.json:', err.message);
    return [];
  }
}

function writeExplicit(paths) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ paths: [...new Set(paths)].sort() }, null, 2), 'utf8');
}

function allPaths() {
  const paths = new Set();

  for (const raw of readExplicit()) {
    const parts = normalize(raw);
    for (let i = 1; i <= parts.length; i++) paths.add(key(parts.slice(0, i)));
  }

  for (const product of registry.getAll()) {
    const parts = normalize(product.categoryPath || product.category);
    if (!parts.length) continue;
    for (let i = 1; i <= parts.length; i++) paths.add(key(parts.slice(0, i)));
  }

  return [...paths].map(v => normalize(v));
}

function samePrefix(pathParts, parent) {
  return parent.every((v, i) => pathParts[i] === v);
}

module.exports = {
  normalize,
  key,

  getAllPaths() {
    return allPaths().sort((a, b) => key(a).localeCompare(key(b), 'ar'));
  },

  getRootCategories() {
    return this.getChildren([]);
  },

  getChildren(parentPath = []) {
    const parent = normalize(parentPath);
    const children = new Map();

    for (const parts of allPaths()) {
      if (parts.length <= parent.length || !samePrefix(parts, parent)) continue;
      const child = parts[parent.length];
      const childPath = [...parent, child];
      children.set(child, childPath);
    }

    return [...children.values()].sort((a, b) => a.at(-1).localeCompare(b.at(-1), 'ar'));
  },

  hasChildren(parentPath = []) {
    return this.getChildren(parentPath).length > 0;
  },

  getProducts(categoryPath = []) {
    const wanted = normalize(categoryPath);
    return registry.getVisible().filter(product => {
      const actual = normalize(product.categoryPath || product.category);
      return actual.length === wanted.length && actual.every((v, i) => v === wanted[i]);
    });
  },

  ensurePath(inputPath) {
    const parts = normalize(inputPath);
    if (!parts.length) throw new Error('مسار التصنيف فارغ.');

    const existing = readExplicit();
    const paths = new Set(existing);
    for (let i = 1; i <= parts.length; i++) paths.add(key(parts.slice(0, i)));
    writeExplicit([...paths]);
    return parts;
  },

  treeLines() {
    const paths = this.getAllPaths();
    if (!paths.length) return ['لا توجد تصنيفات بعد.'];

    return paths.map(parts => {
      const depth = Math.max(0, parts.length - 1);
      const prefix = depth ? '└─ '.repeat(depth) : '';
      const count = this.getProducts(parts).length;
      return `${prefix}📁 **${parts.at(-1)}**${count ? ` — ${count} منتج` : ''}`;
    });
  },
};
