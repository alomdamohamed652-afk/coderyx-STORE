'use strict';

const { EmbedBuilder } = require('discord.js');
const cfg      = require('../config');
const registry = require('./registry');
const categories = require('./categoryRegistry');

// ─────────────────────────────────────────
//   Dashboard Embeds
//   كل واجهات لوحة إدارة المنتجات
// ─────────────────────────────────────────

const B = cfg.branding;
const number = value => Number(value || 0).toLocaleString('ar-EG');
const money = (value, currency = '') => `${number(value)}${currency ? ' ' + currency : ''}`;

function base(color = B.color) {
  return new EmbedBuilder()
    .setColor(color)
    .setFooter({ text: B.footer })
    .setTimestamp();
}

module.exports = {

  // ───────────────────────────────────
  //   MAIN OVERVIEW: لوحة الإدارة الرئيسية
  // ───────────────────────────────────

  overview() {
    const all = registry.getAll();
    const db  = require('./database');
    const raw = db._read();
    const orders = Object.values(raw.orders ?? {});
    const paidOrders = orders.filter(o => o.payment?.paid);
    const totalSales = paidOrders.reduce((sum, o) => sum + (o.payment?.finalPrice ?? 0), 0);
    const analytics = db.getAnalytics();

    return base()
      .setTitle('🛠️ Codryx Product Dashboard')
      .setDescription('لوحة إدارة شاملة لكل منتجات Codryx — كل التعديلات تُطبَّق فورًا بدون إعادة تشغيل البوت.')
      .addFields(
        { name: '📦 إجمالي المنتجات', value: number(all.length), inline: true },
        { name: '🟢 متاحة', value: number(registry.countByAvailability('active')), inline: true },
        { name: '🛠️ تحت الصيانة', value: number(registry.countByAvailability('maintenance')), inline: true },
        { name: '👁️‍🗨️ مخفية', value: number(registry.countByVisibility('hidden')), inline: true },
        { name: '🧾 إجمالي الطلبات', value: number(orders.length), inline: true },
        { name: '💰 إجمالي المبيعات', value: money(totalSales), inline: true },
        { name: '🎫 التذاكر المفتوحة', value: number(analytics.openTickets), inline: true },
        { name: '⭐ متوسط تقييم الفريق', value: analytics.ratingAverage ? analytics.ratingAverage.toFixed(2) + '/5' : '—', inline: true },
      )
      .setFooter({ text: `${B.footer} • آخر تحديث` });
  },

  categories() {
    const lines = categories.treeLines();
    return base()
      .setTitle('🗂️ إدارة تصنيفات المنتجات')
      .setDescription(
        'التصنيفات تدعم مستويات متداخلة، مثل: **FiveM > Systems > Management**.\\n\\n' +
        lines.join('\\n')
      )
      .addFields({
        name: '💡 طريقة الاستخدام',
        value: 'أضف تصنيفًا من زر **إضافة تصنيف**، ثم افتح أي منتج واضغط **🗂️ الفئة** لتحديد مساره.'
      });
  },

  // ───────────────────────────────────
  //   PRODUCT LIST (Admin View): قائمة كل المنتجات للإدارة
  // ───────────────────────────────────

  adminProductList() {
    const all = registry.getAll();

    if (all.length === 0) {
      return base().setTitle('👁️ قائمة المنتجات').setDescription('_لا توجد منتجات بعد._');
    }

    const lines = all.map((p, i) => {
      const badge = registry.badgeLabel(p.badge);
      const visIcon = p.visibility === 'visible' ? '👁️' : '👁️‍🗨️';
      const availIcon = p.availability === 'active' ? '🟢' : '🛠️';
      return `\`${i + 1}\` ${availIcon}${visIcon} **${p.name}**${badge ? ` ${badge}` : ''}\n` +
             `   ID: \`${p.id}\` | الترتيب: ${p.order} | الخطط: ${p.plans.length}`;
    });

    return base()
      .setTitle('👁️ قائمة المنتجات (عرض الإدارة)')
      .setDescription(lines.join('\n\n'));
  },

  // ───────────────────────────────────
  //   SINGLE PRODUCT DASHBOARD
  // ───────────────────────────────────

  productDashboard(product) {
    const badge = registry.badgeLabel(product.badge);
    const isActive = product.availability === 'active';
    const isVisible = product.visibility === 'visible';
    const statusLine = `${isActive ? '🟢 متاح' : '🛠️ تحت الصيانة'}  •  ${isVisible ? '👁️ ظاهر للعملاء' : '🔒 مخفي عن العملاء'}`;

    const db = require('./database');
    const raw = db._read();
    const productOrders = Object.values(raw.orders ?? {}).filter(o => o.product?.id === product.id);
    const paidOrders = productOrders.filter(o => o.payment?.paid);
    const sales = paidOrders.reduce((sum, o) => sum + Number(o.payment?.finalPrice || 0), 0);

    const prices = product.plans.map(p => Number(p.price)).filter(Number.isFinite);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const planSummary = product.plans.map((p, i) => `**${i + 1}. ${p.name}** — ${money(p.price, p.currency)}`).join('\n');

    const embed = new EmbedBuilder()
      .setColor(product.color ?? B.color)
      .setTitle(`📦 ${product.name}${badge ? ` • ${badge}` : ''}`)
      .setDescription(`> ${product.description || 'بدون وصف'}\n\n**الحالة**  ${statusLine}`)
      .addFields(
        { name: '💰 يبدأ من', value: money(minPrice, product.plans[0]?.currency ?? ''), inline: true },
        { name: '📦 الباقات', value: number(product.plans.length), inline: true },
        { name: '🧾 الطلبات', value: number(productOrders.length), inline: true },
        { name: '💳 مبيعات مدفوعة', value: money(sales), inline: true },
        { name: '🔖 الإصدار', value: product.version ?? '—', inline: true },
        { name: '🔢 الترتيب', value: number(Number(product.order || 0) + 1), inline: true },
        { name: '📋 تفاصيل الباقات', value: planSummary || 'لا توجد باقات.' },
      )
      .setFooter({ text: `${B.footer} • ${product.id} • لوحة الإدارة` })
      .setTimestamp();

    if (product.thumbnail) embed.setThumbnail(product.thumbnail);
    if (product.banner) embed.setImage(product.banner);

    return embed;
  },

  // ───────────────────────────────────
  //   STATISTICS PAGE
  // ───────────────────────────────────

  statistics() {
    const all = registry.getAll();
    const db = require('./database');
    const analytics = db.getAnalytics();

    const countByProduct = {};
    for (const o of analytics.orders) {
      const pid = o.product?.id;
      if (pid) countByProduct[pid] = (countByProduct[pid] || 0) + 1;
    }
    const ranked = all.map(p => ({ p, count: countByProduct[p.id] || 0 })).sort((a,b) => b.count-a.count);
    const top = ranked[0];

    return base(B.colorSuccess)
      .setTitle('📊 إحصائيات النظام')
      .setDescription('نظرة إدارية سريعة على التذاكر، الطلبات، الفريق والعملاء.')
      .addFields(
        { name: '🎫 إجمالي التذاكر', value: number(analytics.totalTickets), inline: true },
        { name: '🟡 مفتوحة', value: number(analytics.openTickets), inline: true },
        { name: '🔒 مغلقة', value: number(analytics.closedTickets), inline: true },
        { name: '⚡ متوسط الاستجابة', value: analytics.avgResponseMinutes ? analytics.avgResponseMinutes.toFixed(1) + ' دقيقة' : '—', inline: true },
        { name: '⏱️ متوسط الحل', value: analytics.avgResolutionMinutes ? analytics.avgResolutionMinutes.toFixed(1) + ' دقيقة' : '—', inline: true },
        { name: '👨‍💼 الأكثر استلامًا', value: analytics.topStaff ? analytics.topStaff[0] + ' (' + number(analytics.topStaff[1]) + ')' : '—', inline: true },
        { name: '⭐ متوسط التقييم', value: analytics.ratingAverage ? analytics.ratingAverage.toFixed(2) + '/5' : '—', inline: true },
        { name: '👥 العملاء', value: number(analytics.totalCustomers), inline: true },
        { name: '🧾 الطلبات', value: number(analytics.totalOrders), inline: true },
        { name: '💳 المدفوعة', value: number(analytics.paidOrders), inline: true },
        { name: '💰 المبيعات', value: money(analytics.totalSales), inline: true },
        { name: '🔥 الأكثر طلبًا', value: top ? top.p.name + ' (' + number(top.count) + ')' : '—', inline: true },
      );
  },
  // ───────────────────────────────────
  //   MAINTENANCE NOTICE: يظهر للعميل عند الضغط على منتج تحت الصيانة
  // ───────────────────────────────────

  maintenanceNotice(product) {
    return base(B.colorWarn)
      .setTitle('🛠️ المنتج غير متاح حاليًا')
      .setDescription(`**${product.name}** تحت الصيانة حاليًا ولا يمكن شراؤه في هذا الوقت.\n\nيمكنك العودة لاحقًا أو التواصل مع الدعم لمزيد من التفاصيل.`);
  },

  // ───────────────────────────────────
  //   ERROR / INFO (محلية لتجنب الاعتماد الدائري مع core/embeds.js)
  // ───────────────────────────────────

  error(message) {
    return base(B.colorDanger).setTitle('❌ خطأ').setDescription(message);
  },

  success(message) {
    return base(B.colorSuccess).setTitle('✅ تم').setDescription(message);
  },
};
