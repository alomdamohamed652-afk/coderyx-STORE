'use strict';

const db          = require('../core/database');
const components  = require('../core/components');
const cfg         = require('../config');
const permissions = require('../core/permissions');

// ─────────────────────────────────────────
//   Order Interaction Handler
//   يعالج كل التفاعلات الخاصة بدورة حياة
//   الأوردر: تغيير الحالة، السعر، الدفع
// ─────────────────────────────────────────

function extractOrderId(customId, prefix) {
  return customId.slice(prefix.length);
}

module.exports = {

  // ─── تغيير حالة الأوردر من القائمة (روم اللوج) ───
  // لو الحالة الجديدة "بانتظار الدفع" → يفتح Modal لتحديد السعر فورًا
  // بدل تنفيذ تغيير الحالة العادي مباشرة

  async handleStatusSelect(interaction) {
    const orderId = extractOrderId(interaction.customId, 'order_status_');
    const order    = db.getOrder(orderId);

    if (!order) {
      return interaction.reply({ content: '❌ هذا الأوردر غير موجود.', ephemeral: true });
    }

    if (!permissions.isOwner(interaction.member, cfg) && !permissions.isDev(interaction.member, cfg)) {
      return interaction.reply({ content: '❌ هذا الإجراء لفريق التطوير فقط.', ephemeral: true });
    }

    const newStatus = interaction.values[0];

    // حالة خاصة: بانتظار الدفع → فتح Modal لتحديد السعر فورًا (بدون تغيير الحالة بعد)
    if (newStatus === 'awaiting_payment') {
      const modal = components.priceDetailsModal(orderId);
      return interaction.showModal(modal);
    }

    // حالة خاصة: تم الدفع → نفس منطق زر "تم الدفع" (يشمل DM + رسالة تفاصيل + التقييم)
    // حتى لو تم اختيارها من القائمة العادية بدل الزر المخصص
    if (newStatus === 'paid') {
      if (!permissions.isFinance(interaction.member, cfg)) {
        return interaction.reply({ content: '❌ تأكيد الدفع للمسؤول عن المالية فقط.', ephemeral: true });
      }
      if (order.payment?.paid) {
        return interaction.reply({ content: '✅ هذا الأوردر مدفوع بالفعل.', ephemeral: true });
      }

      await interaction.deferUpdate();
      const orderHandler = require('./orderHandler');
      return orderHandler.confirmPaymentReceived(interaction.client, orderId, interaction.user.id);
    }

    // باقي الحالات: تغيير عادي مباشر
    await interaction.deferUpdate();
    const orderHandler = require('./orderHandler');
    await orderHandler.changeOrderStatus(interaction.client, orderId, newStatus, interaction.user.id);
  },

  // ─── استلام بيانات Modal السعر وتحويل الحالة لبانتظار الدفع ───

  async handlePriceModalSubmit(interaction) {
    const orderId = extractOrderId(interaction.customId, 'price_modal_');
    const order    = db.getOrder(orderId);

    if (!order) {
      return interaction.reply({ content: '❌ هذا الأوردر غير موجود.', ephemeral: true });
    }

    const originalPriceRaw = interaction.fields.getTextInputValue('original_price');
    const discountRaw      = interaction.fields.getTextInputValue('discount_amount') || '0';
    const discountReason   = interaction.fields.getTextInputValue('discount_reason') || null;

    const originalPrice  = parseFloat(originalPriceRaw);
    const discountAmount = parseFloat(discountRaw) || 0;

    if (isNaN(originalPrice) || originalPrice < 0) {
      return interaction.reply({ content: '❌ السعر الأصلي غير صحيح.', ephemeral: true });
    }
    if (discountAmount < 0) {
      return interaction.reply({ content: '❌ قيمة الخصم غير صحيحة.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const orderHandler = require('./orderHandler');
    await orderHandler.setPriceAndRequestPayment(
      interaction.client,
      orderId,
      { originalPrice, discountAmount, discountReason },
      interaction.user.id
    );

    await interaction.editReply({ content: '✅ تم تحديد السعر وإرسال خيارات الدفع للعميل.' });
  },

  // ─── العميل يضغط على زر طريقة دفع داخل تذكرته ───

  async handleCustomerPaymentChoice(interaction, method) {
    const orderId = extractOrderId(interaction.customId, `pay_${method}_`);
    const order    = db.getOrder(orderId);

    if (!order) {
      return interaction.reply({ content: '❌ هذا الأوردر غير موجود.', ephemeral: true });
    }

    // فقط العميل صاحب الأوردر يقدر يختار طريقة الدفع
    if (interaction.user.id !== order.customer.discordId) {
      return interaction.reply({ content: '❌ هذا الإجراء خاص بصاحب الطلب فقط.', ephemeral: true });
    }

    if (order.payment?.method) {
      return interaction.reply({ content: '✅ تم اختيار طريقة الدفع بالفعل.', ephemeral: true });
    }

    await interaction.deferUpdate();

    // تعطيل الأزرار بعد الاختيار (منع الضغط المتكرر)
    await interaction.message.edit({ components: [] }).catch(() => {});

    const orderHandler = require('./orderHandler');
    await orderHandler.selectPaymentMethod(interaction.client, interaction, orderId, method);
  },

  // ─── المسؤول عن المالية يضغط "تم الدفع" في روم اللوج ───

  async handleConfirmPayment(interaction) {
    const orderId = extractOrderId(interaction.customId, 'confirm_payment_');
    const order    = db.getOrder(orderId);

    if (!order) {
      return interaction.reply({ content: '❌ هذا الأوردر غير موجود.', ephemeral: true });
    }

    if (!permissions.isFinance(interaction.member, cfg)) {
      return interaction.reply({ content: '❌ هذا الإجراء للمسؤول عن المالية فقط.', ephemeral: true });
    }

    if (order.payment?.paid) {
      return interaction.reply({ content: '✅ هذا الأوردر مدفوع بالفعل.', ephemeral: true });
    }

    await interaction.deferUpdate();

    const orderHandler = require('./orderHandler');
    await orderHandler.confirmPaymentReceived(interaction.client, orderId, interaction.user.id);
  },

  // ─── العميل يضغط على عدد نجوم معيّن ───

  async handleFeedbackStarClick(interaction, rating) {
    const orderId = extractOrderId(interaction.customId, `feedback_${rating}_`);
    const order    = db.getOrder(orderId);

    if (!order) {
      return interaction.reply({ content: '❌ هذا الأوردر غير موجود.', ephemeral: true });
    }

    // فقط العميل صاحب الأوردر يقدر يقيّم
    if (interaction.user.id !== order.customer.discordId) {
      return interaction.reply({ content: '❌ هذا الإجراء خاص بصاحب الطلب فقط.', ephemeral: true });
    }

    if (db.getFeedback(orderId)) {
      return interaction.reply({ content: '✅ تم تسجيل تقييمك بالفعل، شكرًا لك.', ephemeral: true });
    }

    const components = require('../core/components');
    const modal = components.feedbackCommentModal(orderId, rating);
    await interaction.showModal(modal);
  },

  // ─── استلام الملاحظات من Modal وحفظ التقييم ───

  async handleFeedbackModalSubmit(interaction) {
    // customId بصيغة: feedback_modal_<rating>_<orderId>
    const rest = interaction.customId.slice('feedback_modal_'.length);
    const firstUnderscore = rest.indexOf('_');
    const rating  = parseInt(rest.slice(0, firstUnderscore), 10);
    const orderId = rest.slice(firstUnderscore + 1);

    const order = db.getOrder(orderId);
    if (!order) {
      return interaction.reply({ content: '❌ هذا الأوردر غير موجود.', ephemeral: true });
    }

    if (db.getFeedback(orderId)) {
      return interaction.reply({ content: '✅ تم تسجيل تقييمك بالفعل، شكرًا لك.', ephemeral: true });
    }

    const comment = interaction.fields.getTextInputValue('feedback_comment') || null;

    await interaction.deferUpdate();

    const orderHandler = require('./orderHandler');
    await orderHandler.submitFeedback(interaction.client, {
      orderId,
      customerId: interaction.user.id,
      username: interaction.user.tag,
      rating,
      comment,
    });

    const embeds = require('../core/embeds');

    // تعطيل أزرار التقييم بعد الاستخدام
    await interaction.message.edit({ components: [] }).catch(() => {});

    await interaction.channel.send({ embeds: [embeds.feedbackThankYou(rating)] });
  },
};
