'use strict';

const fs   = require('fs');
const path = require('path');
const cfg  = require('../config');

// ─────────────────────────────────────────
//   Database (JSON-based)
//   بسيط وبدون dependencies خارجية
//   كل Order له Folder مستقل
// ─────────────────────────────────────────

class Database {

  constructor() {
    this._ensureDir(cfg.orders.folder);
    this._dbPath = path.join(cfg.orders.folder, '_db.json');

    // التأكد من وجود ملف الـ DB
    if (!fs.existsSync(this._dbPath)) {
      this._write({ orders: {}, tickets: {}, counter: 0 });
    }
  }

  // ─── Internal ───────────────────────

  _read() {
    return JSON.parse(fs.readFileSync(this._dbPath, 'utf8'));
  }

  _write(data) {
    fs.writeFileSync(this._dbPath, JSON.stringify(data, null, 2), 'utf8');
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // ─── Order ID Generator ─────────────

  _nextOrderId() {
    const db = this._read();
    db.counter = (db.counter || 0) + 1;
    this._write(db);
    return `${cfg.orders.prefix}-${String(db.counter).padStart(4, '0')}`;
  }

  // ─── Orders ─────────────────────────

  createOrder({ customerId, username, productId, planId, channelId }) {
    const orderId = this._nextOrderId(); // يقرأ، يزيد العداد، ويكتبه فورًا بشكل مستقل وآمن
    const db      = this._read();        // نقرأ النسخة المحدّثة بعد زيادة العداد
    const now     = new Date().toISOString();

    const order = {
      id:          orderId,
      status:      'pending_review', // انظر ORDER_STATUSES في core/orderStatus.js
      createdAt:   now,
      updatedAt:   now,
      customer: {
        discordId: customerId,
        username,
        ticketChannelId: channelId,
      },
      product: {
        id:     productId,
        planId: planId,
      },
      data:    {},  // يتملأ من الـ Wizard
      orderChannelId: null,
      logMessageId: null,   // رسالة الإيمبيد في روم لوج الأوردرات (تُحدَّث في مكانها)
      statusHistory: [
        { status: 'pending_review', at: now, by: null },
      ],
      payment: {
        method: null,      // wallet | instapay | binance
        paid: false,
        paidAt: null,
        originalPrice: null,
        discountAmount: 0,
        discountReason: null,
        finalPrice: null,
      },
    };

    db.orders[orderId] = order;
    this._write(db);

    // إنشاء Folder خاص بالأوردر
    const orderDir = path.join(cfg.orders.folder, orderId);
    this._ensureDir(orderDir);
    this._ensureDir(path.join(orderDir, 'attachments'));

    // حفظ order.json كامل داخل الفولدر
    fs.writeFileSync(
      path.join(orderDir, 'order.json'),
      JSON.stringify(order, null, 2),
      'utf8'
    );

    return order;
  }

  getOrder(orderId) {
    return this._read().orders[orderId] ?? null;
  }

  /**
   * كل الأوردرات الخاصة بعميل معيّن (لإحصائيات العملاء لاحقًا)
   */
  getOrdersByCustomer(customerId) {
    const db = this._read();
    return Object.values(db.orders).filter(o => o.customer.discordId === customerId);
  }

  /**
   * يحفظ بيانات الدفع الكاملة للأوردر (طريقة الدفع، الخصم، السعر النهائي)
   */
  setPayment(orderId, paymentData) {
    const order = this.getOrder(orderId);
    if (!order) return null;

    const payment = {
      ...order.payment,
      ...paymentData,
    };

    return this.updateOrder(orderId, { payment });
  }

  /**
   * إحصائيات شاملة لعميل: عدد الطلبات المدفوعة وإجمالي ما دفعه
   */
  getCustomerStats(customerId) {
    const orders = this.getOrdersByCustomer(customerId).filter(o => o.payment?.paid);
    const totalSpent = orders.reduce((sum, o) => sum + (o.payment?.finalPrice ?? 0), 0);
    return {
      totalOrders: orders.length,
      totalSpent,
      orders,
    };
  }

  updateOrder(orderId, patch) {
    const db = this._read();
    if (!db.orders[orderId]) return null;

    db.orders[orderId] = {
      ...db.orders[orderId],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this._write(db);

    // تحديث order.json في الفولدر كمان
    const orderDir = path.join(cfg.orders.folder, orderId);
    fs.writeFileSync(
      path.join(orderDir, 'order.json'),
      JSON.stringify(db.orders[orderId], null, 2),
      'utf8'
    );

    return db.orders[orderId];
  }

  // حفظ بيانات الـ Wizard
  /**
   * يغيّر حالة الأوردر ويسجلها في statusHistory
   * @param {string} orderId
   * @param {string} newStatus
   * @param {string|null} byUserId - من قام بالتغيير (null لو تلقائي)
   */
  changeStatus(orderId, newStatus, byUserId = null) {
    const order = this.getOrder(orderId);
    if (!order) return null;

    const now = new Date().toISOString();
    const history = [...(order.statusHistory ?? []), { status: newStatus, at: now, by: byUserId }];

    return this.updateOrder(orderId, { status: newStatus, statusHistory: history });
  }

  getOrderByChannel(channelId) {
    const db = this._read();
    return Object.values(db.orders).find(o => o.customer.ticketChannelId === channelId) ?? null;
  }

  // ─── Tickets ────────────────────────

  saveTicket({ channelId, userId, type, orderId = null }) {
    const db = this._read();
    db.tickets[channelId] = {
      channelId,
      userId,
      type,       // purchase | support | inquiry | custom_dev | report
      orderId,
      claimedBy: null,   // ID الشخص اللي استلم التذكرة
      createdAt: new Date().toISOString(),
      state: 'open',  // open | claimed | closed
    };
    this._write(db);
    return db.tickets[channelId];
  }

  getTicket(channelId) {
    return this._read().tickets[channelId] ?? null;
  }

  updateTicket(channelId, patch) {
    const db = this._read();
    if (!db.tickets[channelId]) return null;
    db.tickets[channelId] = { ...db.tickets[channelId], ...patch };
    this._write(db);
    return db.tickets[channelId];
  }

  /**
   * يبحث عن تيكت مفتوح لنفس المستخدم ونفس النوع
   * يُستخدم لمنع فتح أكثر من تيكت من نفس النوع
   */
  findOpenTicketByType(userId, type) {
    const db = this._read();
    return Object.values(db.tickets).find(
      t => t.userId === userId && t.type === type && t.state !== 'closed'
    ) ?? null;
  }

  /**
   * كل التذاكر المفتوحة لمستخدم معيّن (لمعرفة كل أنواع تذاكره الحالية)
   */
  getOpenTicketsByUser(userId) {
    const db = this._read();
    return Object.values(db.tickets).filter(
      t => t.userId === userId && t.state !== 'closed'
    );
  }

  // ─── Feedback (تقييمات العملاء) ─────

  saveFeedback({ orderId, customerId, username, rating, comment }) {
    const db = this._read();
    if (!db.feedback) db.feedback = {};

    const feedback = {
      orderId,
      customerId,
      username,
      rating,    // 1-5
      comment,   // قد تكون null لو العميل لم يكتب ملاحظة
      createdAt: new Date().toISOString(),
    };

    db.feedback[orderId] = feedback;
    this._write(db);
    return feedback;
  }

  getFeedback(orderId) {
    return (this._read().feedback ?? {})[orderId] ?? null;
  }

  getAllFeedback() {
    return Object.values(this._read().feedback ?? {});
  }

  // ─── Panel Message Tracking ─────────
  // لتتبع رسالة البانل لكل قناة (لإعادة إرسالها نظيفة بعد كل استخدام)

  savePanelMessage(channelId, messageId) {
    const db = this._read();
    if (!db.panels) db.panels = {};
    db.panels[channelId] = messageId;
    this._write(db);
  }

  getPanelMessage(channelId) {
    return (this._read().panels ?? {})[channelId] ?? null;
  }

  // ─── Dashboard Message Tracking ─────
  // Dashboard واحدة فقط لكل سيرفر — نخزّن channelId + messageId معًا

  saveDashboard(channelId, messageId) {
    const db = this._read();
    db.dashboard = { channelId, messageId, updatedAt: new Date().toISOString() };
    this._write(db);
    return db.dashboard;
  }

  getDashboard() {
    return this._read().dashboard ?? null;
  }

  clearDashboard() {
    const db = this._read();
    delete db.dashboard;
    this._write(db);
  }

  // ─── Wizard Session ─────────────────

  saveWizardSession(channelId, session) {
    const db = this._read();
    if (!db.wizardSessions) db.wizardSessions = {};
    db.wizardSessions[channelId] = session;
    this._write(db);
  }

  getWizardSession(channelId) {
    return (this._read().wizardSessions ?? {})[channelId] ?? null;
  }

  clearWizardSession(channelId) {
    const db = this._read();
    if (db.wizardSessions) delete db.wizardSessions[channelId];
    this._write(db);
  }
}

module.exports = new Database();
