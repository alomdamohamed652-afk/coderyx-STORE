'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

// ─────────────────────────────────────────
//   Components Builder
//   جميع الأزرار والقوائم في مكان واحد
// ─────────────────────────────────────────

module.exports = {

  // ───────────────────────────────────
  //   PANEL: اختيار نوع التيكت من البانل
  //           مباشرة (بدون فتح تيكت أولاً)
  // ───────────────────────────────────

  panelMenu() {
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('panel_ticket_type')
        .setPlaceholder('📩 اختر نوع طلبك لفتح تذكرة...')
        .addOptions([
          { label: 'شراء منتج',        value: 'purchase',   emoji: '🛒', description: 'تصفح منتجاتنا واشتر' },
          { label: 'دعم فني',          value: 'support',    emoji: '🔧', description: 'مشكلة في منتج اشتريته' },
          { label: 'استفسار',          value: 'inquiry',    emoji: '💬', description: 'سؤال قبل الشراء' },
          { label: 'تطوير خاص',        value: 'custom_dev', emoji: '⚙️', description: 'طلب نظام مخصص' },
          { label: 'الإبلاغ عن مشكلة', value: 'report',     emoji: '🚨', description: 'الإبلاغ عن مشكلة' },
        ])
    );
  },

  // ───────────────────────────────────
  //   PRODUCT SELECT: اختيار منتج
  // ───────────────────────────────────

  productSelect(products) {
    const options = products.map(p => ({
      label: p.name,
      value: p.id,
      description: p.description.slice(0, 100),
    }));

    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('select_product')
        .setPlaceholder('اختر المنتج...')
        .addOptions(options)
    );
  },

  // ───────────────────────────────────
  //   PLAN SELECT: اختيار خطة
  // ───────────────────────────────────

  planSelect(product) {
    const options = product.plans.map((p, i) => ({
      label: `${p.name} — ${p.price} ${p.currency}`,
      value: String(i),
      description: (p.features ?? []).slice(0, 2).join(' • ').slice(0, 100) || undefined,
    }));

    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('select_plan')
        .setPlaceholder('اختر الخطة...')
        .addOptions(options)
    );
  },

  // ───────────────────────────────────
  //   WIZARD NAV: تنقل الـ Wizard
  // ───────────────────────────────────

  wizardNav(canSkip = false) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('wizard_cancel')
        .setLabel('❌ إلغاء')
        .setStyle(ButtonStyle.Danger),
    );

    if (canSkip) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('wizard_skip')
          .setLabel('⏭️ تخطي')
          .setStyle(ButtonStyle.Secondary),
      );
    }

    return row;
  },

  // ───────────────────────────────────
  //   WIZARD SELECT: قائمة اختيار داخل Wizard
  // ───────────────────────────────────

  wizardSelectMenu(step) {
    const options = step.options.map(o => ({
      label: o.label,
      value: o.value,
      description: o.description ?? undefined,
    }));

    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`wizard_select_${step.key}`)
        .setPlaceholder(step.placeholder ?? 'اختر...')
        .addOptions(options)
    );
  },

  // ───────────────────────────────────
  //   TICKET ACTIONS: استلام + طلب إغلاق
  // ───────────────────────────────────

  ticketActions(claimed = false) {
    const row = new ActionRowBuilder();

    if (!claimed) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('claim_ticket')
          .setLabel('🙋 استلام التذكرة')
          .setStyle(ButtonStyle.Success),
      );
    }

    row.addComponents(
      new ButtonBuilder()
        .setCustomId('request_close')
        .setLabel('🔒 طلب إغلاق')
        .setStyle(ButtonStyle.Danger),
    );

    return row;
  },

  // ───────────────────────────────────
  //   CLOSE CONFIRM: تأكيد الحذف الفعلي
  //   (يظهر فقط لمن يملك صلاحية الحذف)
  // ───────────────────────────────────

  closeConfirm() {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('confirm_close')
        .setLabel('✅ تأكيد الحذف')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('cancel_close')
        .setLabel('↩️ إلغاء')
        .setStyle(ButtonStyle.Secondary),
    );
  },

  // ───────────────────────────────────
  //   ORDER STATUS SELECT: قائمة تغيير حالة الأوردر
  //   (تظهر في روم لوج الأوردرات)
  // ───────────────────────────────────

  orderStatusSelect(order) {
    const orderStatus = require('./orderStatus');

    const options = orderStatus.STATUS_ORDER.map(statusKey => {
      const info = orderStatus.get(statusKey);
      return {
        label: info.label,
        value: statusKey,
        emoji: info.emoji,
        default: order.status === statusKey,
      };
    });

    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`order_status_${order.id}`)
        .setPlaceholder('تغيير حالة الطلب...')
        .addOptions(options)
    );
  },

  // ───────────────────────────────────
  //   PRICE MODAL: نافذة إدخال السعر والخصم
  //   تفتح فورًا عند اختيار "بانتظار الدفع"
  //   من قائمة حالة الأوردر
  // ───────────────────────────────────

  priceDetailsModal(orderId) {
    const modal = new ModalBuilder()
      .setCustomId(`price_modal_${orderId}`)
      .setTitle('تحديد سعر الطلب');

    const priceInput = new TextInputBuilder()
      .setCustomId('original_price')
      .setLabel('السعر الأصلي')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('مثال: 100');

    const discountInput = new TextInputBuilder()
      .setCustomId('discount_amount')
      .setLabel('قيمة الخصم (اتركه فاضي لو بدون خصم)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('مثال: 10');

    const reasonInput = new TextInputBuilder()
      .setCustomId('discount_reason')
      .setLabel('سبب الخصم (لو تم تطبيق خصم)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('مثال: عميل دائم');

    modal.addComponents(
      new ActionRowBuilder().addComponents(priceInput),
      new ActionRowBuilder().addComponents(discountInput),
      new ActionRowBuilder().addComponents(reasonInput),
    );

    return modal;
  },

  // ───────────────────────────────────
  //   CUSTOMER PAYMENT METHOD: أزرار اختيار
  //   طريقة الدفع — تظهر للعميل داخل تذكرته
  //   تُبنى ديناميكيًا من config/paymentMethods.js
  // ───────────────────────────────────

  customerPaymentMethods(orderId) {
    const paymentMethods = require('../config/paymentMethods');
    const methods = paymentMethods.getAll();

    const rows = [];
    for (let i = 0; i < methods.length; i += 5) {
      const chunk = methods.slice(i, i + 5);
      const row = new ActionRowBuilder().addComponents(
        chunk.map(m =>
          new ButtonBuilder()
            .setCustomId(`pay_${m.id}_${orderId}`)
            .setLabel(`${m.emoji} ${m.label}`)
            .setStyle(ButtonStyle.Primary)
        )
      );
      rows.push(row);
    }

    return rows;
  },

  // ───────────────────────────────────
  //   CONFIRM PAYMENT BUTTON: زر "تم الدفع"
  //   يظهر في روم لوج الأوردرات للمسؤول
  //   عن المالية بعد اختيار العميل طريقة الدفع
  // ───────────────────────────────────

  confirmPaymentButton(order) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirm_payment_${order.id}`)
        .setLabel('✅ تم الدفع')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!!order.payment?.paid),
    );
  },

  // ───────────────────────────────────
  //   FEEDBACK STARS: أزرار التقييم 1-5 نجوم
  //   تظهر للعميل بعد تأكيد الدفع
  // ───────────────────────────────────

  feedbackStars(orderId) {
    const row = new ActionRowBuilder();
    for (let stars = 1; stars <= 5; stars++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`feedback_${stars}_${orderId}`)
          .setLabel('⭐'.repeat(stars))
          .setStyle(ButtonStyle.Secondary)
      );
    }
    return row;
  },

  // ───────────────────────────────────
  //   FEEDBACK COMMENT MODAL: نافذة كتابة
  //   الملاحظات/سبب التقييم
  // ───────────────────────────────────

  feedbackCommentModal(orderId, rating) {
    const modal = new ModalBuilder()
      .setCustomId(`feedback_modal_${rating}_${orderId}`)
      .setTitle('شكرًا لتقييمك!');

    const commentInput = new TextInputBuilder()
      .setCustomId('feedback_comment')
      .setLabel('ملاحظاتك أو سبب التقييم (اختياري)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setPlaceholder('اكتب رأيك بكل شفافية...');

    modal.addComponents(
      new ActionRowBuilder().addComponents(commentInput),
    );

    return modal;
  },
};
