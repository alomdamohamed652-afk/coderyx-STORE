'use strict';

/**
 * Codryx Store - Local JSON Database
 *
 * مصدر واحد لكل البيانات التشغيلية:
 *   data/database.json
 *
 * مميزات:
 * - تخزين داخل المشروع بدل توزيع البيانات بين ملفات مختلفة.
 * - تحميل مرة واحدة في الذاكرة وتقليل عمليات القراءة من القرص.
 * - كتابة ذرية عبر ملف مؤقت لتقليل تلف قاعدة البيانات.
 * - ترحيل تلقائي للقاعدة القديمة orders/_db.json إن وُجدت.
 * - الحفاظ على نفس API المستخدمة حاليًا في باقي البوت.
 *
 * ملاحظة Railway:
 * نظام الملفات في الخدمة بدون Volume قد يُمسح عند إعادة النشر.
 * لو مطلوب حفظ البيانات بين Deployments يجب ربط Volume دائم بمجلد /app/data
 * أو ضبط DATABASE_PATH لمسار Volume.
 */

const fs = require('fs');
const path = require('path');
const cfg = require('../config');

const DEFAULT_DB_PATH = path.resolve(process.env.DATABASE_PATH || './data/database.json');
const LEGACY_DB_PATH = path.resolve('./orders/_db.json');

const EMPTY_DB = () => ({
  version: 2,
  orders: {},
  tickets: {},
  feedback: {},
  teamFeedback: {},
  panels: {},
  wizardSessions: {},
  dashboard: null,
  counter: 0,
  ticketCounter: 0,
});

class Database {
  constructor() {
    this._dbPath = DEFAULT_DB_PATH;
    this._tmpPath = `${this._dbPath}.tmp`;
    this._ensureDir(path.dirname(this._dbPath));

    this._data = this._loadInitial();
    this._normalize();

    // حفظ القاعدة الجديدة بعد الترحيل/التصحيح.
    this._write(this._data);
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _loadInitial() {
    const candidates = [this._dbPath];

    // لا نستخدم القاعدة القديمة إلا إذا لم توجد القاعدة الجديدة.
    if (this._dbPath !== LEGACY_DB_PATH) candidates.push(LEGACY_DB_PATH);

    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;

      try {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw);

        if (file === LEGACY_DB_PATH && this._dbPath !== LEGACY_DB_PATH) {
          console.log('[Database] ↪️ Migrating legacy orders/_db.json → data/database.json');
        }

        return parsed;
      } catch (err) {
        console.error(`[Database] ❌ Failed to read ${file}: ${err.message}`);
      }
    }

    console.log('[Database] 🆕 Creating new local database.');
    return EMPTY_DB();
  }

  _normalize() {
    const base = EMPTY_DB();
    const current = this._data && typeof this._data === 'object' ? this._data : {};

    this._data = {
      ...base,
      ...current,
      orders: current.orders && typeof current.orders === 'object' ? current.orders : {},
      tickets: current.tickets && typeof current.tickets === 'object' ? current.tickets : {},
      feedback: current.feedback && typeof current.feedback === 'object' ? current.feedback : {},
      teamFeedback: current.teamFeedback && typeof current.teamFeedback === 'object' ? current.teamFeedback : {},
      panels: current.panels && typeof current.panels === 'object' ? current.panels : {},
      wizardSessions: current.wizardSessions && typeof current.wizardSessions === 'object' ? current.wizardSessions : {},
      counter: Number.isFinite(Number(current.counter)) ? Number(current.counter) : 0,
      ticketCounter: Number.isFinite(Number(current.ticketCounter)) ? Number(current.ticketCounter) : 0,
    };

    // إضافة الحقول التي ظهرت في الإصدارات الجديدة للطلبات القديمة.
    for (const order of Object.values(this._data.orders)) {
      order.payment ||= {
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
      };

      order.statusHistory ||= [];
      order.data ||= {};
    }
  }

  _read() {
    // API متوافق مع الكود القديم، لكن القراءة من نسخة الذاكرة.
    return this._data;
  }

  _write(data) {
    this._ensureDir(path.dirname(this._dbPath));

    const serialized = JSON.stringify(data, null, 2);

    // كتابة ذرية وآمنة حتى مع تزامن أكثر من Interaction:
    // كل عملية كتابة تستخدم ملفًا مؤقتًا مختلفًا، ثم تستبدله بالملف الأساسي.
    const tmpPath = this._dbPath + '.' + process.pid + '.' + Date.now() + '.' + Math.random().toString(16).slice(2) + '.tmp';
    try {
      fs.writeFileSync(tmpPath, serialized, 'utf8');
      fs.renameSync(tmpPath, this._dbPath);
      this._data = data;
    } finally {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {}
    }
  }

  _nextOrderId() {
    this._data.counter = Number(this._data.counter || 0) + 1;
    this._write(this._data);
    return `${cfg.orders.prefix}-${String(this._data.counter).padStart(4, '0')}`;
  }

  _nextTicketNumber() {
    this._data.ticketCounter = Number(this._data.ticketCounter || 0) + 1;
    this._write(this._data);
    return this._data.ticketCounter;
  }

  createOrder({ customerId, username, productId, planId, channelId }) {
    const orderId = this._nextOrderId();
    const now = new Date().toISOString();

    const order = {
      id: orderId,
      status: 'pending_review',
      createdAt: now,
      updatedAt: now,
      customer: {
        discordId: customerId,
        username,
        ticketChannelId: channelId,
      },
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
          completed: false,
        },
      },
    };

    this._data.orders[orderId] = order;
    this._write(this._data);

    // الاحتفاظ بملف الطلب الفردي للتوافق/النسخ الاحتياطي، بينما المصدر الأساسي هو database.json.
    const orderDir = path.join(cfg.orders.folder, orderId);
    this._ensureDir(orderDir);
    this._ensureDir(path.join(orderDir, 'attachments'));
    fs.writeFileSync(
      path.join(orderDir, 'order.json'),
      JSON.stringify(order, null, 2),
      'utf8'
    );

    return order;
  }

  getOrder(orderId) {
    return this._data.orders[orderId] ?? null;
  }

  getOrdersByCustomer(customerId) {
    return Object.values(this._data.orders).filter(
      o => o.customer?.discordId === customerId
    );
  }

  setPayment(orderId, paymentData) {
    const order = this.getOrder(orderId);
    if (!order) return null;

    return this.updateOrder(orderId, {
      payment: {
        ...(order.payment || {}),
        ...paymentData,
      },
    });
  }

  recordInstallmentPayment(orderId, { amount, byUserId, note = null }) {
    const order = this.getOrder(orderId);
    if (!order) return null;

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error('قيمة القسط يجب أن تكون رقمًا أكبر من صفر.');
    }

    const existing = order.payment?.installment || {};
    const payments = [
      ...(existing.payments || []),
      {
        amount: value,
        byUserId,
        at: new Date().toISOString(),
        note,
      },
    ];

    const installment = {
      ...existing,
      payments,
      paidCount: payments.length,
    };

    const target = Number(order.payment?.finalPrice || 0);
    const paidTotal = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

    installment.paidTotal = paidTotal;
    installment.remaining = Math.max(0, target - paidTotal);
    installment.completed =
      (target > 0 && paidTotal >= target) ||
      (installment.count > 0 && installment.paidCount >= installment.count);

    return this.updateOrder(orderId, {
      payment: {
        ...order.payment,
        installment,
      },
    });
  }

  getCustomerStats(customerId) {
    const orders = this.getOrdersByCustomer(customerId).filter(o => o.payment?.paid);
    const totalSpent = orders.reduce(
      (sum, o) => sum + Number(o.payment?.finalPrice || 0),
      0
    );

    return { totalOrders: orders.length, totalSpent, orders };
  }

  updateOrder(orderId, patch) {
    const order = this._data.orders[orderId];
    if (!order) return null;

    this._data.orders[orderId] = {
      ...order,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    this._write(this._data);

    const orderDir = path.join(cfg.orders.folder, orderId);
    this._ensureDir(orderDir);
    fs.writeFileSync(
      path.join(orderDir, 'order.json'),
      JSON.stringify(this._data.orders[orderId], null, 2),
      'utf8'
    );

    return this._data.orders[orderId];
  }

  changeStatus(orderId, newStatus, byUserId = null) {
    const order = this.getOrder(orderId);
    if (!order) return null;

    const now = new Date().toISOString();
    const history = [
      ...(order.statusHistory || []),
      { status: newStatus, at: now, by: byUserId },
    ];

    return this.updateOrder(orderId, {
      status: newStatus,
      statusHistory: history,
    });
  }

  getOrderByChannel(channelId) {
    return (
      Object.values(this._data.orders).find(
        o => o.customer?.ticketChannelId === channelId
      ) ?? null
    );
  }

  saveTicket({
    channelId,
    userId,
    type,
    orderId = null,
    userUsername = null,
  }) {
    const number = this._nextTicketNumber();
    const now = new Date().toISOString();

    this._data.tickets[channelId] = {
      channelId,
      number,
      displayNumber: String(number).padStart(3, '0'),
      userId,
      userUsername,
      type,
      orderId,
      claimedBy: null,
      claimedUsername: null,
      claimedAt: null,
      createdAt: now,
      reminderSentAt: null,
      state: 'open',
      history: [
        {
          action: 'created',
          at: now,
          byUserId: userId,
          byUsername: userUsername,
        },
      ],
    };

    this._write(this._data);
    return this._data.tickets[channelId];
  }

  getTicket(channelId) {
    return this._data.tickets[channelId] ?? null;
  }

  updateTicket(channelId, patch) {
    if (!this._data.tickets[channelId]) return null;

    this._data.tickets[channelId] = {
      ...this._data.tickets[channelId],
      ...patch,
    };

    this._write(this._data);
    return this._data.tickets[channelId];
  }

  recordTicketEvent(
    channelId,
    action,
    { byUserId = null, byUsername = null, details = {} } = {}
  ) {
    const ticket = this._data.tickets[channelId];
    if (!ticket) return null;

    ticket.history ||= [];
    ticket.history.push({
      action,
      at: new Date().toISOString(),
      byUserId,
      byUsername,
      details,
    });

    this._write(this._data);
    return ticket;
  }

  getTicketHistory(channelId) {
    return this._data.tickets[channelId]?.history || [];
  }

  getCustomerProfile(customerId) {
    const orders = this.getOrdersByCustomer(customerId);
    const tickets = Object.values(this._data.tickets).filter(
      t => t.userId === customerId
    );
    const productFeedback = Object.values(this._data.feedback).filter(
      f => f.customerId === customerId
    );
    const teamFeedback = Object.values(this._data.teamFeedback).filter(
      f => f.customerId === customerId
    );

    const installmentPayments = orders.flatMap(o =>
      (o.payment?.installment?.payments || []).map(p => ({
        ...p,
        orderId: o.id,
      }))
    );

    const paidOrders = orders.filter(o => o.payment?.paid);
    const totalSpent = paidOrders.reduce(
      (sum, o) => sum + Number(o.payment?.finalPrice || 0),
      0
    );
    const totalPaidInstallments = installmentPayments.reduce(
      (sum, p) => sum + Number(p.amount || 0),
      0
    );

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
          return (
            sum +
            (i?.enabled
              ? Math.max(
                  0,
                  Number(i.count || 0) - Number(i.paidCount || 0)
                )
              : 0)
          );
        }, 0),
      },
    };
  }

  getAnalytics() {
    const tickets = Object.values(this._data.tickets);
    const orders = Object.values(this._data.orders);
    const teamRatings = Object.values(this._data.teamFeedback);
    const paid = orders.filter(o => o.payment?.paid);

    const totalSales = paid.reduce(
      (sum, o) => sum + Number(o.payment?.finalPrice || 0),
      0
    );

    const staffClaims = {};
    for (const t of tickets) {
      if (t.claimedBy) {
        const key = t.claimedUsername || t.claimedBy;
        staffClaims[key] = (staffClaims[key] || 0) + 1;
      }
    }

    const responseTimes = tickets
      .filter(t => t.claimedAt)
      .map(
        t =>
          new Date(t.claimedAt).getTime() -
          new Date(t.createdAt).getTime()
      )
      .filter(Number.isFinite);

    const resolutionTimes = tickets
      .filter(t => t.closedAt)
      .map(
        t =>
          new Date(t.closedAt).getTime() -
          new Date(t.createdAt).getTime()
      )
      .filter(Number.isFinite);

    const avg = arr =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const ratingAvg = teamRatings.length
      ? teamRatings.reduce((s, r) => s + Number(r.rating || 0), 0) /
        teamRatings.length
      : 0;

    return {
      tickets,
      orders,
      totalTickets: tickets.length,
      openTickets: tickets.filter(t =>
        ['open', 'claimed', 'waiting', 'resolved'].includes(t.state)
      ).length,
      closedTickets: tickets.filter(t => t.state === 'closed').length,
      avgResponseMinutes: avg(responseTimes) / 60000,
      avgResolutionMinutes: avg(resolutionTimes) / 60000,
      topStaff:
        Object.entries(staffClaims).sort((a, b) => b[1] - a[1])[0] ||
        null,
      ratingAverage: ratingAvg,
      teamRatings: teamRatings.length,
      totalCustomers: new Set(
        tickets.map(t => t.userId).filter(Boolean)
      ).size,
      totalOrders: orders.length,
      paidOrders: paid.length,
      totalSales,
    };
  }

  findOpenTicketByType(userId, type) {
    return (
      Object.values(this._data.tickets).find(
        t =>
          t.userId === userId &&
          t.type === type &&
          t.state !== 'closed'
      ) ?? null
    );
  }

  getOpenTicketsByUser(userId) {
    return Object.values(this._data.tickets).filter(
      t => t.userId === userId && t.state !== 'closed'
    );
  }

  getOpenUnclaimedTickets() {
    return Object.values(this._data.tickets).filter(
      t => t.state === 'open' && !t.claimedBy && !t.reminderSentAt
    );
  }

  saveFeedback({ orderId, customerId, username, rating, comment }) {
    const feedback = {
      orderId,
      customerId,
      username,
      rating: Number(rating),
      comment,
      createdAt: new Date().toISOString(),
    };

    this._data.feedback[orderId] = feedback;
    this._write(this._data);
    return feedback;
  }

  getFeedback(orderId) {
    return this._data.feedback[orderId] ?? null;
  }

  getAllFeedback() {
    return Object.values(this._data.feedback);
  }

  saveTeamFeedback({
    ticketId,
    customerId,
    customerUsername,
    category,
    rating,
    staffId = null,
    staffUsername = null,
    teamName = null,
  }) {
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

    this._data.teamFeedback[key] = feedback;
    this._write(this._data);
    return feedback;
  }

  getTeamFeedback(ticketId, category) {
    return this._data.teamFeedback[`${ticketId}:${category}`] ?? null;
  }

  getAllTeamFeedback() {
    return Object.values(this._data.teamFeedback);
  }

  savePanelMessage(channelId, messageId) {
    this._data.panels[channelId] = messageId;
    this._write(this._data);
  }

  getPanelMessage(channelId) {
    return this._data.panels[channelId] ?? null;
  }

  saveDashboard(channelId, messageId) {
    this._data.dashboard = {
      channelId,
      messageId,
      updatedAt: new Date().toISOString(),
    };

    this._write(this._data);
    return this._data.dashboard;
  }

  getDashboard() {
    return this._data.dashboard ?? null;
  }

  clearDashboard() {
    this._data.dashboard = null;
    this._write(this._data);
  }

  saveWizardSession(channelId, session) {
    this._data.wizardSessions[channelId] = session;
    this._write(this._data);
  }

  getWizardSession(channelId) {
    return this._data.wizardSessions[channelId] ?? null;
  }

  clearWizardSession(channelId) {
    delete this._data.wizardSessions[channelId];
    this._write(this._data);
  }
}

module.exports = new Database();
