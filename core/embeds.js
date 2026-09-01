'use strict';

const { EmbedBuilder } = require('discord.js');
const cfg = require('../config');

// ─────────────────────────────────────────
//   Embed Builder
//   جميع الـ Embeds في مكان واحد
//   لا يوجد embed مكتوب خارج هذا الملف
// ─────────────────────────────────────────

const B = cfg.branding;

// Helper: embed أساسي بالـ branding
function base(color = B.color) {
  return new EmbedBuilder()
    .setColor(color)
    .setFooter({ text: B.footer })
    .setTimestamp();
}

module.exports = {

  // ───────────────────────────────────
  //   PANEL: الإيمبيد اللي يضغط عليه
  //           العميل في الروم الرئيسية
  // ───────────────────────────────────

  panel() {
    const embed = base()
      .setAuthor({ name: B.name, iconURL: this._safeImage(B.logo) })
      .setTitle('🛒 مرحبًا بك في متجر Codryx')
      .setDescription(
        '> نقدم أنظمة احترافية لسيرفرات **Discord** و **FiveM**\n' +
        '> كل نظام يتم تخصيصه بالكامل لسيرفرك\n\n' +
        '**اختر نوع طلبك من القائمة أدناه لفتح تذكرة 👇**'
      )
      .addFields(
        {
          name: '📋 أنواع الطلبات',
          value:
            '🛒 **شراء منتج** — تصفح منتجاتنا واشتر\n' +
            '🔧 **دعم فني** — مشكلة في منتج اشتريته\n' +
            '💬 **استفسار** — سؤال قبل الشراء\n' +
            '⚙️ **تطوير خاص** — طلب نظام مخصص\n' +
            '🚨 **بلاغ** — الإبلاغ عن مشكلة',
          inline: false,
        },
        {
          name: '⚡ لماذا Codryx؟',
          value: '✦ تخصيص كامل لهويتك\n✦ كود نظيف وقابل للتوسع\n✦ دعم فني مستمر',
          inline: false,
        }
      );

    // الصورة اختيارية — تُضاف فقط لو الرابط حقيقي (ليس placeholder وليس فاضيًا)
    const imageUrl = this._safeImage(B.logo);
    if (imageUrl) embed.setImage(imageUrl);

    return embed;
  },

  /**
   * يرجع رابط الصورة فقط لو كان صحيحًا وحقيقيًا (ليس placeholder افتراضي)
   * يمنع محاولة تحميل صورة لرابط وهمي غير موجود
   */
  _safeImage(url) {
    if (!url) return null;
    if (url.includes('placeholder')) return null;
    return url;
  },

  // ───────────────────────────────────
  //   TICKET OPENED: أول رسالة في التذكرة
  //   (النوع محدد مسبقًا من البانل)
  // ───────────────────────────────────

  ticketOpenedByType(user, type) {
    const types = {
      purchase:   { emoji: '🛒', label: 'شراء منتج',       color: B.color,       desc: 'سنعرض لك منتجاتنا المتاحة، اختر ما يناسبك.' },
      support:    { emoji: '🔧', label: 'دعم فني',         color: B.colorWarn,   desc: 'اشرح المشكلة بالتفصيل وسيتواصل معك فريق الدعم.' },
      inquiry:    { emoji: '💬', label: 'استفسار',         color: B.color,       desc: 'اطرح سؤالك وسنرد عليك في أقرب وقت.' },
      custom_dev: { emoji: '⚙️', label: 'تطوير خاص',       color: B.color,       desc: 'اشرح ما تحتاجه بالتفصيل وسيتواصل معك فريق التطوير.' },
      report:     { emoji: '🚨', label: 'بلاغ',            color: B.colorDanger, desc: 'اشرح المشكلة التي تريد الإبلاغ عنها بالتفصيل.' },
    };

    const t = types[type] ?? { emoji: '📩', label: 'طلب', color: B.color, desc: '' };

    return base(t.color)
      .setTitle(`${t.emoji} تذكرة ${t.label}`)
      .setDescription(
        `أهلًا ${user} 👋\n\n` +
        `تم فتح تذكرة **${t.label}** بنجاح.\n` +
        `> ${t.desc}`
      );
  },

  // ───────────────────────────────────
  //   STORE: عرض المنتجات
  // ───────────────────────────────────

  store(products) {
    const registry = require('./registry');

    const list = products.map((p, i) => {
      const minPrice = Math.min(...p.plans.map(pl => pl.price));
      const badge = registry.badgeLabel(p.badge);
      const nameWithBadge = badge ? `${badge} **${p.name}**` : `**${p.name}**`;
      const maintenanceNote = p.availability === 'maintenance' ? '\n> 🛠️ تحت الصيانة حاليًا' : '';
      return `\`${i + 1}\` ${nameWithBadge}\n> ${p.description}\n> 💰 يبدأ من **${minPrice} ${p.plans[0]?.currency ?? 'SAR'}**${maintenanceNote}`;
    }).join('\n\n');

    return base()
      .setTitle('📦 منتجات Codryx')
      .setDescription(
        'اختر المنتج الذي تريد شراؤه:\n\n' + list
      );
  },

  // ───────────────────────────────────
  //   PRODUCT DETAIL: تفاصيل منتج واحد
  // ───────────────────────────────────

  productDetail(product) {
    const plansText = product.plans.map((p, i) => {
      const features = p.features.slice(0, 4).map(f => `  ✓ ${f}`).join('\n');
      return `**${i + 1}. ${p.name}** — ${p.price} ${p.currency}\n${features}`;
    }).join('\n\n');

    const generalFeatures = (product.features ?? []).map(f => `✦ ${f}`).join('\n');

    return new EmbedBuilder()
      .setColor(product.color ?? B.color)
      .setTitle(`📦 ${product.name}`)
      .setDescription(`> ${product.description}`)
      .addFields(
        ...(generalFeatures ? [{ name: '⚡ المميزات العامة', value: generalFeatures }] : []),
        { name: '📋 الخطط المتاحة', value: plansText },
      )
      .setFooter({ text: B.footer })
      .setTimestamp();
  },

  // ───────────────────────────────────
  //   PLAN SELECTED: تأكيد الخطة
  // ───────────────────────────────────

  planSelected(product, plan) {
    const features = plan.features.map(f => `✓ ${f}`).join('\n');

    return new EmbedBuilder()
      .setColor(product.color ?? B.color)
      .setTitle(`✅ ${product.name} — خطة ${plan.name}`)
      .setDescription(`> اخترت خطة **${plan.name}** بسعر **${plan.price} ${plan.currency}**`)
      .addFields(
        { name: '📋 المميزات', value: features },
      )
      .setFooter({ text: B.footer })
      .setTimestamp();
  },

  // ───────────────────────────────────
  //   TICKET CLAIMED: تم استلام التذكرة
  // ───────────────────────────────────

  ticketClaimed(staffUser) {
    return base(B.colorSuccess)
      .setTitle('🙋 تم استلام التذكرة')
      .setDescription(`تم استلام هذه التذكرة من ${staffUser}\nسيتم التعامل مع طلبك الآن.`);
  },

  // ───────────────────────────────────
  //   CLOSE REQUESTED: طلب إغلاق
  // ───────────────────────────────────

  closeRequested(requester) {
    return base(B.colorWarn)
      .setTitle('🔒 طلب إغلاق التذكرة')
      .setDescription(
        `طلب ${requester} إغلاق هذه التذكرة.\n\n` +
        '> الحذف الفعلي يتطلب صلاحية خاصة من الفريق المخوّل.'
      );
  },

  // ───────────────────────────────────
  //   CLOSE DENIED: لا صلاحية للحذف
  // ───────────────────────────────────

  closeDenied() {
    return base(B.colorDanger)
      .setTitle('❌ لا تملك صلاحية الحذف')
      .setDescription('تم تسجيل طلب الإغلاق، لكن حذف التذكرة فعليًا يتطلب رتبة مخوّلة من الفريق.');
  },

  // ───────────────────────────────────
  //   ORDER SUMMARY: ملخص الطلب (للمطور)
  // ───────────────────────────────────

  orderSummary(order, product, plan) {
    const orderStatus = require('./orderStatus');
    const statusInfo  = orderStatus.get(order.status);
    const statusText  = statusInfo ? `${statusInfo.emoji} ${statusInfo.label}` : `⚪ ${order.status}`;

    const payment = order.payment ?? {};
    const paymentMethodsCfg = require('../config/paymentMethods');

    const paymentLines = [];
    if (payment.method) paymentLines.push(`**طريقة الدفع:** ${paymentMethodsCfg.labelWithEmoji(payment.method)}`);
    if (payment.originalPrice != null) paymentLines.push(`**السعر الأصلي:** ${payment.originalPrice}`);
    if (payment.discountAmount) paymentLines.push(`**الخصم:** -${payment.discountAmount} (${payment.discountReason ?? 'بدون سبب محدد'})`);
    if (payment.finalPrice != null) paymentLines.push(`**السعر النهائي:** ${payment.finalPrice}`);
    paymentLines.push(`**حالة الدفع:** ${payment.paid ? '✅ مدفوع' : '⏳ غير مدفوع'}`);

    const embed = new EmbedBuilder()
      .setColor(statusInfo?.color ?? B.colorWarn)
      .setTitle(`📋 طلب — ${order.id}`)
      .setDescription(`> ${statusText}`)
      .addFields(
        {
          name: '👤 العميل',
          value: `<@${order.customer.discordId}>\n\`${order.customer.username}\``,
          inline: true,
        },
        {
          name: '📦 المنتج',
          value: `**${product?.name ?? order.product?.id ?? '?'}**\nخطة: ${plan?.name ?? order.product?.planId ?? '?'}\nسعر: ${plan?.price ?? '?'} ${plan?.currency ?? ''}`,
          inline: true,
        },
        {
          name: '📅 التاريخ',
          value: `<t:${Math.floor(new Date(order.createdAt).getTime() / 1000)}:F>`,
          inline: true,
        },
        {
          name: '💳 معلومات الدفع',
          value: paymentLines.join('\n'),
        },
        {
          name: '🔗 التذكرة',
          value: order.customer.ticketChannelId ? `<#${order.customer.ticketChannelId}>` : '—',
          inline: true,
        },
        {
          name: '📊 الحالة الحالية',
          value: statusText,
          inline: true,
        },
      )
      .setFooter({ text: `${B.footer} • ${order.id}` })
      .setTimestamp();

    return embed;
  },

  // ───────────────────────────────────
  //   ORDER STATUS CHANGE: رسالة في التذكرة عند تغيير الحالة
  // ───────────────────────────────────

  orderStatusChanged(order, byUser) {
    const orderStatus = require('./orderStatus');
    const statusInfo  = orderStatus.get(order.status);

    return new EmbedBuilder()
      .setColor(statusInfo?.color ?? B.color)
      .setTitle(`${statusInfo?.emoji ?? '📌'} تحديث حالة الطلب`)
      .setDescription(statusInfo?.ticketMessage(order) ?? `تم تحديث حالة الطلب \`${order.id}\` إلى: ${order.status}`)
      .setFooter({ text: byUser ? `${B.footer} • بواسطة ${byUser}` : B.footer })
      .setTimestamp();
  },

  // ───────────────────────────────────
  //   PAYMENT CONFIRMED: تأكيد الدفع في التذكرة
  // ───────────────────────────────────

  // ───────────────────────────────────
  //   PRICE SET: تم تحديد السعر — اختر طريقة الدفع
  // ───────────────────────────────────

  priceSet(order) {
    const p = order.payment ?? {};
    const lines = [`**السعر:** ${p.originalPrice ?? '—'}`];
    if (p.discountAmount) {
      lines.push(`**الخصم:** -${p.discountAmount} (${p.discountReason ?? 'بدون سبب محدد'})`);
    }
    lines.push(`**السعر النهائي:** ${p.finalPrice ?? '—'}`);

    return base(B.colorWarn)
      .setTitle('💰 تم تحديد سعر طلبك')
      .setDescription(
        `${lines.join('\n')}\n\n` +
        '**اختر طريقة الدفع المناسبة لك من الأزرار أدناه:**'
      );
  },

  // ───────────────────────────────────
  //   PAYMENT METHOD CHOSEN: العميل اختار طريقة الدفع
  // ───────────────────────────────────

  paymentMethodChosen(order) {
    const paymentMethods = require('../config/paymentMethods');
    const method = paymentMethods.get(order.payment?.method);
    const methodLabel = method ? `${method.emoji} ${method.label}` : (order.payment?.method ?? '—');

    let description =
      `تم اختيار طريقة الدفع: **${methodLabel}**\n\n` +
      'سيتواصل معك المسؤول عن المالية قريبًا لإتمام عملية الدفع.';

    if (method?.instructions) {
      description += `\n\n${method.instructions}`;
    }

    return base(B.colorWarn)
      .setTitle('🟠 جاري تأكيد الدفع')
      .setDescription(description);
  },

  paymentConfirmed(order) {
    const paymentMethodsCfg = require('../config/paymentMethods');
    const p = order.payment ?? {};

    const lines = [
      `**طريقة الدفع:** ${p.method ? paymentMethodsCfg.labelWithEmoji(p.method) : '—'}`,
      `**السعر النهائي:** ${p.finalPrice ?? '—'}`,
    ];
    if (p.discountAmount) {
      lines.push(`**الخصم المطبّق:** -${p.discountAmount} (${p.discountReason ?? 'بدون سبب محدد'})`);
    }

    return base(B.colorSuccess)
      .setTitle('💳 تم تأكيد الدفع')
      .setDescription(lines.join('\n'));
  },

  // ───────────────────────────────────
  //   ERROR
  // ───────────────────────────────────

  error(message) {
    return base(B.colorDanger)
      .setTitle('❌ خطأ')
      .setDescription(message);
  },

  // ───────────────────────────────────
  //   SUCCESS
  // ───────────────────────────────────

  success(message) {
    return base(B.colorSuccess)
      .setTitle('✅ تم')
      .setDescription(message);
  },

  // ───────────────────────────────────
  //   INFO
  // ───────────────────────────────────

  info(title, message) {
    return base()
      .setTitle(`ℹ️ ${title}`)
      .setDescription(message);
  },

  // ───────────────────────────────────
  //   FEEDBACK INVITATION: دعوة التقييم
  //   تظهر للعميل بعد تأكيد الدفع
  // ───────────────────────────────────

  feedbackInvitation() {
    return base(B.color)
      .setTitle('⭐ Feedback System')
      .setDescription(
        'نشكرك على وقتك وثقتك بنا، ونرجو منك تقييم تجربتك معنا من خلال الأزرار الموجودة بالأسفل.\n\n' +
        'آراؤكم محل اهتمام كبير لدينا، حيث تساعدنا بشكل مباشر على تحسين جودة الخدمة وتطوير الأداء بشكل مستمر لتقديم تجربة أفضل للجميع.\n\n' +
        'لا تتردد في اختيار التقييم الذي يعكس تجربتك بكل شفافية.'
      );
  },

  // ───────────────────────────────────
  //   FEEDBACK THANK YOU: رسالة شكر للعميل
  //   بعد إرسال التقييم
  // ───────────────────────────────────

  feedbackThankYou(rating) {
    return base(B.colorSuccess)
      .setTitle('🙏 شكرًا لتقييمك')
      .setDescription(`تم استلام تقييمك: ${'⭐'.repeat(rating)}\n\nنقدّر وقتك ورأيك، ونسعى دائمًا لتقديم الأفضل.`);
  },

  // ───────────────────────────────────
  //   FEEDBACK LOG: الإيمبيد في روم تقييمات العملاء
  // ───────────────────────────────────

  feedbackLog(order, feedback) {
    return new EmbedBuilder()
      .setColor(B.colorSuccess)
      .setTitle(`⭐ تقييم جديد — ${order.id}`)
      .addFields(
        { name: '👤 العميل', value: `<@${feedback.customerId}>\n\`${feedback.username}\``, inline: true },
        { name: '📦 المنتج', value: order.product?.id ?? '—', inline: true },
        { name: '⭐ التقييم', value: `${'⭐'.repeat(feedback.rating)} (${feedback.rating}/5)`, inline: true },
        { name: '💬 الملاحظات', value: feedback.comment || '_بدون ملاحظات_' },
      )
      .setFooter({ text: `${B.footer} • ${order.id}` })
      .setTimestamp();
  },
};
