'use strict';

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.resolve('./orders/_payment_methods.json');

const DEFAULT_METHODS = [
  { id: 'wallet', active: true, label: 'محفظة', emoji: '💼', instructions: 'يمكنك التحويل على رقم المحفظة: **01000000000**', order: 1 },
  { id: 'instapay', active: true, label: 'إنستا باي', emoji: '📲', instructions: 'يمكنك التحويل عبر إنستا باي على: **example@instapay**', order: 2 },
  { id: 'binance', active: true, label: 'بايننس', emoji: '🟡', instructions: 'يمكنك التحويل عبر Binance Pay على ID: **123456789**', order: 3 },
];

function ensureStore() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(DEFAULT_METHODS, null, 2), 'utf8');
  }
}

function readAll() {
  ensureStore();
  try {
    const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return Array.isArray(data) ? data.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [...DEFAULT_METHODS];
  } catch {
    return [...DEFAULT_METHODS];
  }
}

function writeAll(methods) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(methods, null, 2), 'utf8');
}

module.exports = {
  PAYMENT_METHODS: DEFAULT_METHODS,

  getAll() {
    return readAll().filter(m => m.active !== false);
  },

  getAllIncludingInactive() {
    return readAll();
  },

  get(id) {
    return readAll().find(m => m.id === id) ?? null;
  },

  label(id) {
    return this.get(id)?.label ?? id;
  },

  emoji(id) {
    return this.get(id)?.emoji ?? '💳';
  },

  labelWithEmoji(id) {
    const m = this.get(id);
    return m ? `${m.emoji} ${m.label}` : id;
  },

  add(method) {
    const methods = readAll();
    if (methods.some(m => m.id === method.id)) throw new Error('معرّف طريقة الدفع مستخدم بالفعل.');
    methods.push({
      id: method.id,
      active: method.active !== false,
      label: method.label,
      emoji: method.emoji || '💳',
      instructions: method.instructions || '',
      order: Math.max(0, ...methods.map(m => Number(m.order) || 0)) + 1,
    });
    writeAll(methods);
    return this.get(method.id);
  },

  update(id, patch) {
    const methods = readAll();
    const index = methods.findIndex(m => m.id === id);
    if (index === -1) return null;
    methods[index] = { ...methods[index], ...patch, id };
    writeAll(methods);
    return this.get(id);
  },

  remove(id) {
    const methods = readAll();
    const next = methods.filter(m => m.id !== id);
    if (next.length === methods.length) return false;
    writeAll(next);
    return true;
  },

  toggle(id) {
    const method = this.get(id);
    return method ? this.update(id, { active: method.active === false }) : null;
  },
};
