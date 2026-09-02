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
    if (installment.count > 0 && installment.paidCount >= installment.count) installment.completed = true;
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
      history: [{ action: 'created', at: new Date().toISOString(), byUserId: userId, byUsername: userUsername }],
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

  recordTicketEvent(channelId, action, { byUserId = null, byUsername = null, details = {} } = {}) {
    const db = this._read();
    const ticket = db.tickets[channelId];
    if (!ticket) return null;
    ticket.history ||= [];
    ticket.history.push({
      action,
      at: new Date().toISOString(),
      byUserId,
      byUsername,
      details,
    });
    this._write(db);
    return ticket;
  }

  getTicketHistory(channelId) {
    return this._read().tickets[channelId]?.history || [];
  }

  getCustomerProfile(customerId) {
    const db = this._read();
    const orders = Object.values(db.orders || {}).filter(o => o.customer?.discordId === customerId);
    const tickets = Object.values(db.tickets || {}).filter(t => t.userId === customerId);
    const productFeedback = Object.values(db.feedback || {}).filter(f => f.customerId === customerId);
    const teamFeedback = Object.values(db.teamFeedback || {}).filter(f => f.customerId === customerId);
    const installmentPayments = orders.flatMap(o => (o.payment?.installment?.payments || []).map(p => ({ ...p, orderId: o.id })));
    const paidOrders = orders.filter(o => o.payment?.paid);
    const totalSpent = paidOrders.reduce((sum, o) => sum + Number(o.payment?.finalPrice || 0), 0);
    const totalPaidInstallments = installmentPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    return {
      customerId,
      tickets,
      orders,
      productFeedback,
      teamFeedback,
      installmentPayments,
      stats: {
        tickets: tickets.length,
        orders: orders.length,
        paidOrders: paidOrders.length,
        totalSpent,
        totalPaidInstallments,
        openTickets: tickets.filter(t => t.state !== 'closed').length,
        pendingInstallments: orders.reduce((sum, o) => {
          const i = o.payment?.installment;
          return sum + (i?.enabled ? Math.max(0, Number(i.count || 0) - Number(i.paidCount || 0)) : 0);
        }, 0),
      },
    };
  }

  getAnalytics() {
    const db = this._read();
    const tickets = Object.values(db.tickets || {});
    const orders = Object.values(db.orders || {});
    const teamRatings = Object.values(db.teamFeedback || {});
    const paid = orders.filter(o => o.payment?.paid);
    const totalSales = paid.reduce((sum, o) => sum + Number(o.payment?.finalPrice || 0), 0);

    const staffClaims = {};
    for (const t of tickets) if (t.claimedBy) {
      const key = t.claimedUsername || t.claimedBy;
      staffClaims[key] = (staffClaims[key] || 0) + 1;
    }

    const responseTimes = tickets.filter(t => t.claimedAt).map(t => new Date(t.claimedAt).getTime() - new Date(t.createdAt).getTime()).filter(Number.isFinite);
    const resolutionTimes = tickets.filter(t => t.closedAt).map(t => new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime()).filter(Number.isFinite);
    const avg = arr => arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : 0;

    const ratingAvg = teamRatings.length ? teamRatings.reduce((s,r) => s + Number(r.rating || 0), 0) / teamRatings.length : 0;

    return {
      tickets,
      orders,
      totalTickets: tickets.length,
      openTickets: tickets.filter(t => ['open','claimed','waiting','resolved'].includes(t.state)).length,
      closedTickets: tickets.filter(t => t.state === 'closed').length,
      avgResponseMinutes: avg(responseTimes) / 60000,
      avgResolutionMinutes: avg(resolutionTimes) / 60000,
      topStaff: Object.entries(staffClaims).sort((a,b) => b[1]-a[1])[0] || null,
      ratingAverage: ratingAvg,
      teamRatings: teamRatings.length,
      totalCustomers: new Set(tickets.map(t => t.userId).filter(Boolean)).size,
      totalOrders: orders.length,
      paidOrders: paid.length,
      totalSales,
    };
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
    if (!db.teamFeedback) db.teamFeedback = {};
    const feedback = { orderId, customerId, username, rating, comment, createdAt: new Date().toISOString() };
    db.feedback[orderId] = feedback;
    this._write(db);
    return feedback;
  }

  getFeedback(orderId) { return (this._read().feedback ?? {})[orderId] ?? null; }
  getAllFeedback() { return Object.values(this._read().feedback ?? {}); }

  saveTeamFeedback({ ticketId, customerId, customerUsername, category, rating, staffId = null, staffUsername = null, teamName = null }) {
    const db = this._read();
    if (!db.teamFeedback) db.teamFeedback = {};
    const key = `${ticketId}:${category}`;
    const feedback = {
      ticketId,
      customerId,
      customerUsername,
      category,
      rating: Number(rating),
      staffId,
      staffUsername,
      teamName,
      createdAt: new Date().toISOString(),
    };
    db.teamFeedback[key] = feedback;
    this._write(db);
    return feedback;
  }

  getTeamFeedback(ticketId, category) {
    return (this._read().teamFeedback ?? {})[`${ticketId}:${category}`] ?? null;
  }

  getAllTeamFeedback() {
    return Object.values(this._read().teamFeedback ?? {});
  }

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
