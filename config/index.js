'use strict';
require('dotenv').config();

// ─────────────────────────────────────────
//   Codryx Store - Central Config
//   كل الـ IDs والإعدادات هنا فقط
// ─────────────────────────────────────────

// تحويل قيمة مفصولة بفواصل إلى Array
// مثال: "111,222,333" → ["111","222","333"]
function parseList(value) {
  if (!value) return [];
  return value.split(',').map(v => v.trim()).filter(Boolean);
}

module.exports = {

  // ─── Bot ─────────────────────────────
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,

  // ─── Channels ────────────────────────
  channels: {
    ticketPanel:  process.env.TICKET_PANEL_CHANNEL_ID,
    ticketsCat:   process.env.TICKETS_CATEGORY_ID,   // كاتيجوري احتياطية (fallback) لو نوع معين بدون كاتيجوري خاصة
    ordersCat:    process.env.ORDERS_CATEGORY_ID,
    ordersLog:    process.env.ORDERS_LOG_CHANNEL_ID,
    customersChannel: process.env.CUSTOMERS_CHANNEL_ID, // قناة تعرض إحصائيات العملاء (تحديث في رسالة واحدة دائمة)
    feedbackChannel: process.env.FEEDBACK_CHANNEL_ID,   // قناة تقييمات العملاء (تستقبل كل تقييم جديد)
    transcriptLog: process.env.TRANSCRIPT_LOG_CHANNEL_ID, // قناة تستقبل ملف HTML لكل تذكرة بعد إغلاقها
    dashboardLog: process.env.DASHBOARD_LOG_CHANNEL_ID, // قناة تستقبل لوج كل عملية تُنفَّذ من Dashboard إدارة المنتجات

    // كاتيجوري مستقلة لكل نوع تذكرة — اختيارية، لو فاضية يُستخدم ticketsCat
    categoryByType: {
      purchase:   process.env.PURCHASE_CATEGORY_ID,
      support:    process.env.SUPPORT_CATEGORY_ID,
      inquiry:    process.env.INQUIRY_CATEGORY_ID,
      custom_dev: process.env.CUSTOM_DEV_CATEGORY_ID,
      report:     process.env.REPORT_CATEGORY_ID,
    },
  },

  // ─── Roles ───────────────────────────
  // يمكن وضع أكثر من رتبة لكل نوع مفصولة بفاصلة
  // مثال في .env:  OWNER_ROLE_IDS=111111,222222,333333
  roles: {
    owner:   parseList(process.env.OWNER_ROLE_IDS),    // صلاحيات كاملة (إدارة)
    support: parseList(process.env.SUPPORT_ROLE_IDS),  // فريق الدعم الفني / الاستفسارات
    dev:     parseList(process.env.DEV_ROLE_IDS),      // فريق التطوير (يستلم طلبات الشراء)
    close:   parseList(process.env.CLOSE_ROLE_IDS),    // الرتب المسموح لها بحذف (إغلاق) التذاكر فعليًا
    finance: parseList(process.env.FINANCE_ROLE_IDS),  // المسؤول عن المالية (يستلم ويؤكد عمليات الدفع)
    dashboard: parseList(process.env.DASHBOARD_ROLE_IDS), // صلاحية إدارة المنتجات (Founder/CEO/Developer)
  },

  // ─── Branding ────────────────────────
  branding: {
    name:       'Codryx',
    tagline:    'أنظمة احترافية لسيرفرات Discord و FiveM',
    color:      0x5865F2,   // اللون الأساسي (Blurple)
    colorDanger: 0xED4245,  // أحمر للأخطاء
    colorSuccess: 0x57F287, // أخضر للنجاح
    colorWarn:  0xFEE75C,   // أصفر للتحذيرات
    logo:       'https://i.imgur.com/placeholder.png', // ← غير هذا
    footer:     'Codryx • أنظمة احترافية',
  },

  // ─── Orders ──────────────────────────
  orders: {
    folder: './orders',
    prefix: 'ORD',
  },

  // ─── Products ────────────────────────
  products: {
    folder: './products',
  },
};
