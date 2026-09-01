'use strict';

const fs   = require('fs');
const path = require('path');
const cfg  = require('../config');

class Database {
  constructor() {
    this._ensureDir(cfg.orders.folder);
    this._dbPath = path.join(cfg.orders.folder, '_db.json');
    if (!fs.existsSync(this._dbPath)) {
      this._write({ orders: {}, tickets: {}, counter: 0, ticketCounter: 0 });
    }
  }

  _read() {
    const db = JSON.parse(fs.readFileSync(this._dbPath, 'utf8'));
    db.orders ||= {};
    db.tickets ||= {};
    db.counter ||= 0;
    db.ticketCounter ||= 0;
    return db;
  }

  _write(data) {
    fs.writeFileSync(this._dbPath, JSON.stringify(data, null, 2), 'utf8');
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _nextOrderId() {
    const db = this._read();
    db.counter = (db.counter || 0) + 1;
    this._write(db);
    return `${cfg.orders.prefix}-${String(db.counter).padStart(4, '0')}`;
  }

  _nextTicketNumber() {
    const db = this._read();
    db.ticketCounter = (db.ticketCounter || 0) + 1;
    this._write(db);
    return db.ticketCounter;
  }

  createOrder({ customerId, username, productId, planId, channelId }) {
    const orderId = this._nextOrderId();
    const db = this._read();
    const now = new Date().toISOString();

    const order = {
      id: orderId,
      status: 'pending_review',
      createdAt: now,
      updatedAt: now,
      customer: { discordId: customerId, username, ticketChannelId: channelId },
      product: { id: productId, planId },
      data: {},
      orderChannelId: null,
      logMessageId: null,
      statusHistory: [{ status: 'pending_review', at: now, by: null }],
      payment: {
        method: null,
        paid: false,
        paidAt: null,
        originalPrice: null,
        discountAmount: 0,
        discountReason: null,
        finalPrice: null,
        installment: {
          enabled: false,
          count: 0,
          amountPerInstallment: 0,
          paidCount: 0,
          payments: [],
        },
      },
    };

    db.orders[orderId] = order;
    this._write(db);

    const orderDir = path.join(cfg.orders.folder, orderId);
    this._ensureDir(orderDir);
    this._ensureDir(path.join(orderDir, 'attachments'));
    fs.writeFileSync(path.join(orderDir, 'order.json'), JSON.stringify(order, null, 2), 'utf8');
    return order;
  }

  getOrder(orderId) { return this._read().orders[orderId] ?? null; }

  getOrdersByCustomer(customerId) {
    return Object.values(this._read().orders).filter(o => o.customer?.discordId === customerId);
  }

  setPayment(orderId, paymentData) {
    const order = this.getOrder(orderId);
    if (!order) return null;
    return this.updateOrder(orderId, { payment: { ...order.payment, ...paymentData } });
  }

  recordInstallmentPayment(orderId, { amount, byUserId, note = null }) {
    const order = this.getOrder(orderId);
    if (!order) return null;
    const installment = {
      ...(order.payment?.installment || {}),
      payments: [...(order.payment?.installment?.payments || []), {
        amount: Number(amount),
        byUserId,
        at: new Date().toISOString(),
        note,
      }],
    };
    installment.paidCount = installment.payments.length;
    const paidTotal = installment.payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const target = Number(order.payment?.finalPrice || 0);
    if (installment.count > 0 && installment.paidCount >= installment.count) installment.enabled = true;
    return this.updateOrder(orderId, {
      payment: { ...order.payment, installment, installmentPaidTotal: paidTotal },
    });
  }

  getCustomerStats(customerId) {
    const orders = this.getOrdersByCustomer(customerId).filter(o => o.payment?.paid);
    const totalSpent = orders.reduce((sum, o) => sum + Number(o.payment?.finalPrice || 0), 0);
    return { totalOrders: orders.length, totalSpent, orders };
  }

  updateOrder(orderId, patch) {
    const db = this._read();
    if (!db.orders[orderId]) return null;
    db.orders[orderId] = { ...db.orders[orderId], ...patch, updatedAt: new Date().toISOString() };
    this._write(db);

    const orderDir = path.join(cfg.orders.folder, orderId);
    this._ensureDir(orderDir);
    fs.writeFileSync(path.join(orderDir, 'order.json'), JSON.stringify(db.orders[orderId], null, 2), 'utf8');
    return db.orders[orderId];
  }

  changeStatus(orderId, newStatus, byUserId = null) {
    const order = this.getOrder(orderId);
    if (!order) return null;
    const now = new Date().toISOString();
    const history = [...(order.statusHistory ?? []), { status: newStatus, at: now, by: byUserId }];
    return this.updateOrder(orderId, { status: newStatus, statusHistory: history });
  }

  getOrderByChannel(channelId) {
    return Object.values(this._read().orders).find(o => o.customer?.ticketChannelId === channelId) ?? null;
  }

  saveTicket({ channelId, userId, type, orderId = null, userUsername = null }) {
    const db = this._read();
    const number = this._nextTicketNumber();
    db.tickets[channelId] = {
      channelId,
      number,
      displayNumber: String(number).padStart(3, '0'),
      userId,
      userUsername,
      type,
      orderId,
      claimedBy: null,
      claimedUsername: null,
      createdAt: new Date().toISOString(),
      reminderSentAt: null,
      state: 'open',
    };
    this._write(db);
    return db.tickets[channelId];
  }

  getTicket(channelId) { return this._read().tickets[channelId] ?? null; }

  updateTicket(channelId, patch) {
    const db = this._read();
    if (!db.tickets[channelId]) return null;
    db.tickets[channelId] = { ...db.tickets[channelId], ...patch };
    this._write(db);
    return db.tickets[channelId];
  }

  findOpenTicketByType(userId, type) {
    return Object.values(this._read().tickets).find(t => t.userId === userId && t.type === type && t.state !== 'closed') ?? null;
  }

  getOpenTicketsByUser(userId) {
    return Object.values(this._read().tickets).filter(t => t.userId === userId && t.state !== 'closed');
  }

  getOpenUnclaimedTickets() {
    return Object.values(this._read().tickets).filter(t => t.state === 'open' && !t.claimedBy && !t.reminderSentAt);
  }

  saveFeedback({ orderId, customerId, username, rating, comment }) {
    const db = this._read();
    if (!db.feedback) db.feedback = {};
    const feedback = { orderId, customerId, username, rating, comment, createdAt: new Date().toISOString() };
    db.feedback[orderId] = feedback;
    this._write(db);
    return feedback;
  }

  getFeedback(orderId) { return (this._read().feedback ?? {})[orderId] ?? null; }
  getAllFeedback() { return Object.values(this._read().feedback ?? {}); }

  savePanelMessage(channelId, messageId) {
    const db = this._read();
    if (!db.panels) db.panels = {};
    db.panels[channelId] = messageId;
    this._write(db);
  }

  getPanelMessage(channelId) { return (this._read().panels ?? {})[channelId] ?? null; }

  saveDashboard(channelId, messageId) {
    const db = this._read();
    db.dashboard = { channelId, messageId, updatedAt: new Date().toISOString() };
    this._write(db);
    return db.dashboard;
  }

  getDashboard() { return this._read().dashboard ?? null; }
  clearDashboard() { const db = this._read(); delete db.dashboard; this._write(db); }

  saveWizardSession(channelId, session) {
    const db = this._read();
    if (!db.wizardSessions) db.wizardSessions = {};
    db.wizardSessions[channelId] = session;
    this._write(db);
  }

  getWizardSession(channelId) { return (this._read().wizardSessions ?? {})[channelId] ?? null; }
  clearWizardSession(channelId) {
    const db = this._read();
    if (db.wizardSessions) delete db.wizardSessions[channelId];
    this._write(db);
  }
}

module.exports = new Database();
