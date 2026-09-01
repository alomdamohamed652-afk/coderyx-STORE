'use strict';

const { EmbedBuilder } = require('discord.js');
const cfg      = require('../config');
const registry = require('./registry');

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
      )
      .setFooter({ text: `${B.footer} • آخر تحديث` });
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
    const statusLine = `${product.availability === 'active' ? '🟢 متاح' : '🛠️ تحت الصيانة'} • ${product.visibility === 'visible' ? '👁️ ظاهر' : '👁️‍🗨️ مخفي'}`;

    const db = require('./database');
    const raw = db._read();
    const productOrders = Object.values(raw.orders ?? {}).filter(o => o.product?.id === product.id);

    const minPrice = Math.min(...product.plans.map(p => p.price));
    const planSummary = product.plans.map(p => `${p.name}: ${p.price} ${p.currency}`).join(' | ');

    const embed = new EmbedBuilder()
      .setColor(product.color ?? B.color)
      .setTitle(`📦 ${product.name}${badge ? ` ${badge}` : ''}`)
      .setDescription(`> ${product.description}\n\n${statusLine}`)
      .addFields(
        { name: '🏷️ الفئة', value: product.category ?? '—', inline: true },
        { name: '🔖 الإصدار', value: product.version ?? '—', inline: true },
        { name: '💰 يبدأ من', value: money(minPrice, product.plans[0]?.currency ?? ''), inline: true },
        { name: '📋 الخطط', value: planSummary || '—' },
        { name: '🧾 عدد الطلبات', value: number(productOrders.length), inline: true },
        { name: '🔢 الترتيب', value: number(product.order + 1), inline: true },
        { name: '🕐 آخر تحديث', value: `<t:${Math.floor(new Date(product.updatedAt).getTime() / 1000)}:R>`, inline: true },
      )
      .setFooter({ text: `${B.footer} • ${product.id}` })
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
    const db  = require('./database');
    const raw = db._read();
    const orders = Object.values(raw.orders ?? {});
    const paidOrders = orders.filter(o => o.payment?.paid);
    const totalSales = paidOrders.reduce((sum, o) => sum + (o.payment?.finalPrice ?? 0), 0);

    // عدد الطلبات لكل منتج
    const countByProduct = {};
    for (const o of orders) {
      const pid = o.product?.id;
      if (!pid) continue;
      countByProduct[pid] = (countByProduct[pid] ?? 0) + 1;
    }

    let topProduct = null, leastProduct = null;
    let maxCount = -1, minCount = Infinity;
    for (const p of all) {
      const c = countByProduct[p.id] ?? 0;
      if (c > maxCount) { maxCount = c; topProduct = p; }
      if (c < minCount) { minCount = c; leastProduct = p; }
    }

    return base(B.colorSuccess)
      .setTitle('📊 إحصائيات المتجر')
      .addFields(
        { name: '📦 عدد المنتجات', value: number(all.length), inline: true },
        { name: '🧾 عدد الطلبات', value: number(orders.length), inline: true },
        { name: '💰 إجمالي المبيعات', value: money(totalSales), inline: true },
        { name: '🔥 الأكثر مبيعًا', value: topProduct ? `${topProduct.name} (${maxCount} طلب)` : '—', inline: true },
        { name: '📉 الأقل مبيعًا', value: leastProduct ? `${leastProduct.name} (${minCount} طلب)` : '—', inline: true },
        { name: '💳 طلبات مدفوعة', value: String(paidOrders.length), inline: true },
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
