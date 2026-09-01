'use strict';

const fs   = require('fs');
const path = require('path');
const cfg  = require('../config');

// ─────────────────────────────────────────
//   Product Registry
//   يقرأ مجلد products تلقائيًا
//   كل منتج = ملف واحد فقط: product.json
//   يدعم: visibility / availability / badge / order
// ─────────────────────────────────────────

const VALID_VISIBILITY   = ['visible', 'hidden'];
const VALID_AVAILABILITY = ['active', 'maintenance'];
const VALID_BADGES = ['new', 'popular', 'featured', 'premium', 'updated', 'maintenance', null];

const BADGE_LABELS = {
  new:         '🆕 NEW',
  popular:     '🔥 POPULAR',
  featured:    '⭐ FEATURED',
  premium:     '👑 PREMIUM',
  updated:     '⚡ UPDATED',
  maintenance: '🛠️ MAINTENANCE',
};

class ProductRegistry {
  constructor() {
    /** @type {Map<string, Product>} */
    this.products = new Map();
  }

  // ─── Load All ────────────────────────

  load() {
    this.products.clear();

    const dir = path.resolve(cfg.products.folder);

    if (!fs.existsSync(dir)) {
      console.warn('[Registry] products/ folder not found');
      return;
    }

    const folders = fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const folder of folders) {
      try {
        this._loadProduct(path.join(dir, folder.name));
      } catch (err) {
        console.error(`[Registry] فشل تحميل المنتج "${folder.name}":`, err.message);
      }
    }

    console.log(`[Registry] ✓ Loaded ${this.products.size} product(s)`);
  }

  _loadProduct(productDir) {
    const filePath = path.join(productDir, 'product.json');
    if (!fs.existsSync(filePath)) {
      throw new Error('product.json غير موجود');
    }

    const product = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (!product.id)   throw new Error('الحقل "id" مطلوب');
    if (!product.name) throw new Error('الحقل "name" مطلوب');

    if (!Array.isArray(product.plans) || product.plans.length === 0) {
      throw new Error('يجب أن يحتوي المنتج على خطة واحدة على الأقل في "plans"');
    }

    // ─── توافق مع المنتجات القديمة (status: "active"/"غير ذلك") ───
    // النظام القديم كان يستخدم "status" فقط. النظام الجديد يفصلها لـ
    // visibility (ظهور) و availability (إمكانية الشراء).
    if (product.visibility === undefined) {
      product.visibility = (product.status === 'active' || product.status === undefined) ? 'visible' : 'hidden';
    }
    if (product.availability === undefined) {
      product.availability = 'active';
    }

    if (!VALID_VISIBILITY.includes(product.visibility)) {
      throw new Error(`visibility غير صحيحة: ${product.visibility}`);
    }
    if (!VALID_AVAILABILITY.includes(product.availability)) {
      throw new Error(`availability غير صحيحة: ${product.availability}`);
    }
    if (product.badge !== undefined && product.badge !== null && !VALID_BADGES.includes(product.badge)) {
      throw new Error(`badge غير معروفة: ${product.badge}`);
    }

    // ترتيب الظهور — لو غير محدد، يوضع بعد آخر منتج محمّل (بترتيب تصاعدي مستقر)
    if (typeof product.order !== 'number') {
      const maxOrder = this.products.size > 0
        ? Math.max(...[...this.products.values()].map(p => p.order))
        : -1;
      product.order = maxOrder + 1;
    }

    // تتبع آخر تحديث
    if (!product.updatedAt) {
      product.updatedAt = new Date().toISOString();
    }

    // تحويل اللون من Hex إلى Integer (لو موجود كنص)
    if (typeof product.color === 'string') {
      product._colorHex = product.color;
      product.color = parseInt(product.color.replace('#', ''), 16);
    } else if (typeof product.color === 'number') {
      product._colorHex = '#' + product.color.toString(16).padStart(6, '0');
    }

    product._dir  = productDir;
    product._file = path.join(productDir, 'product.json');

    this.products.set(product.id, product);
    console.log(`[Registry]   → ${product.name} (${product.plans.length} خطة) [${product.visibility}/${product.availability}]`);
  }

  // ─── Reload Single Product (بعد تعديل من Dashboard) ───

  reloadOne(productId) {
    const product = this.products.get(productId);
    if (!product) return null;
    this._loadProduct(product._dir);
    return this.getById(productId);
  }

  // ─── Getters ─────────────────────────

  /** كل المنتجات، مرتبة بحسب order */
  getAll() {
    return [...this.products.values()].sort((a, b) => a.order - b.order);
  }

  /** فقط المنتجات الظاهرة في المتجر للعميل */
  getVisible() {
    return this.getAll().filter(p => p.visibility === 'visible');
  }

  getById(id) {
    return this.products.get(id) ?? null;
  }

  count() {
    return this.products.size;
  }

  countByVisibility(visibility) {
    return this.getAll().filter(p => p.visibility === visibility).length;
  }

  countByAvailability(availability) {
    return this.getAll().filter(p => p.availability === availability).length;
  }

  // ─── Save (يكتب التعديلات في ملف المنتج مباشرة) ───

  /**
   * يحفظ تعديلات على منتج معيّن في ملفه على القرص، ثم يعيد تحميله في الذاكرة فورًا
   * @param {string} productId
   * @param {object} patch - الحقول المطلوب تعديلها
   */
  save(productId, patch) {
    const product = this.products.get(productId);
    if (!product) throw new Error(`المنتج غير موجود: ${productId}`);

    const filePath = product._file;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const updated = { ...raw, ...patch, updatedAt: new Date().toISOString() };

    // إزالة الحقول الداخلية لو دخلت بالغلط
    delete updated._dir;
    delete updated._file;
    delete updated._colorHex;

    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf8');

    // إعادة تحميل فورية بدون الحاجة لـ /reload كامل
    return this.reloadOne(productId);
  }

  /**
   * ينشئ منتجًا جديدًا بالكامل: مجلد + ملف product.json
   */
  create(productData) {
    const dir = path.resolve(cfg.products.folder);
    const productDir = path.join(dir, productData.id);

    if (fs.existsSync(productDir)) {
      throw new Error(`يوجد منتج بهذا الـ ID مسبقًا: ${productData.id}`);
    }

    fs.mkdirSync(productDir, { recursive: true });

    const fullData = {
      visibility: 'visible',
      availability: 'active',
      badge: null,
      order: this.getAll().length, // يُضاف في آخر القائمة تلقائيًا
      updatedAt: new Date().toISOString(),
      ...productData,
    };

    fs.writeFileSync(
      path.join(productDir, 'product.json'),
      JSON.stringify(fullData, null, 2),
      'utf8'
    );

    this._loadProduct(productDir);
    return this.getById(productData.id);
  }

  /** يبدّل ترتيب منتجين (نقل لأعلى/أسفل) */
  swapOrder(productIdA, productIdB) {
    const a = this.products.get(productIdA);
    const b = this.products.get(productIdB);
    if (!a || !b) return false;

    const orderA = a.order;
    const orderB = b.order;

    this.save(productIdA, { order: orderB });
    this.save(productIdB, { order: orderA });
    return true;
  }

  // ─── Helpers ─────────────────────────

  badgeLabel(badge) {
    return badge ? (BADGE_LABELS[badge] ?? badge) : null;
  }

  get BADGE_LABELS() { return BADGE_LABELS; }
  get VALID_BADGES() { return VALID_BADGES; }
}

module.exports = new ProductRegistry();

/**
 * @typedef {Object} Product
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} [category]
 * @property {string} [version]
 * @property {number} [color]
 * @property {string} [thumbnail]
 * @property {string} [banner]
 * @property {string[]} [features]
 * @property {Plan[]} plans
 * @property {'visible'|'hidden'} visibility
 * @property {'active'|'maintenance'} availability
 * @property {string|null} [badge]
 * @property {number} order
 * @property {string} updatedAt
 *
 * @typedef {Object} Plan
 * @property {string} name
 * @property {number} price
 * @property {string} currency
 * @property {string[]} features
 */
