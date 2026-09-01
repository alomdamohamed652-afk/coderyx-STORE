'use strict';

const cfg          = require('../config');
const embeds       = require('../core/embeds');
const components   = require('../core/components');
const registry      = require('../core/registry');
const db            = require('../core/database');
const permissions   = require('../core/permissions');
const orderStatus   = require('../core/orderStatus');

// ─────────────────────────────────────────
//   Order Handler
//   إرسال/تحديث ملخص الأوردر في قناة اللوق
//   مع منطق الحالات والدفع والإشعارات
// ─────────────────────────────────────────

function getProductAndPlan(order) {
  const product = registry.getById(order.product.id);
  const plan    = product?.plans[parseInt(order.product.planId, 10)];
  return { product, plan };
}

module.exports = {

  // ─── إرسال ملخص الأوردر لأول مرة في روم اللوج ───

  async sendSummary(client, orderId) {
    const order = db.getOrder(orderId);
    if (!order) return;

    const { product, plan } = getProductAndPlan(order);

    try {
      const logChannel = await client.channels.fetch(cfg.channels.ordersLog);
      const guild      = logChannel.guild;
      const devMention = permissions.mentionRoles(guild, cfg.roles.dev);

      const sent = await logChannel.send({
        content: devMention ? `${devMention} 📋 طلب جديد!` : '📋 طلب جديد!',
        embeds:  [embeds.orderSummary(order, product, plan)],
        components: this._buildLogComponents(order),
      });

      db.updateOrder(orderId, { logMessageId: sent.id });
    } catch (err) {
      console.error('[orderHandler] فشل إرسال الملخص:', err.message);
    }
  },

  // ─── بناء الأزرار/القوائم الصحيحة لرسالة اللوج حسب حالة الدفع ───

  _buildLogComponents(order) {
    const rows = [components.orderStatusSelect(order)];

    // زر "تم الدفع" يظهر فقط لو العميل اختار طريقة دفع وبانتظار التأكيد
    if (order.status === 'payment_pending' && !order.payment?.paid) {
      rows.push(components.confirmPaymentButton(order));
    }
    const installmentRow = components.installmentPaymentButton(order);
    if (installmentRow) rows.push(installmentRow);
    rows.push(components.customerHistoryButton(order.id));

    return rows;
  },

  // ─── تحديث رسالة اللوج في مكانها ───

  async refreshLogMessage(client, orderId) {
    const order = db.getOrder(orderId);
    if (!order?.logMessageId) return;

    const { product, plan } = getProductAndPlan(order);

    try {
      const logChannel = await client.channels.fetch(cfg.channels.ordersLog);
      const message    = await logChannel.messages.fetch(order.logMessageId);

      await message.edit({
        embeds: [embeds.orderSummary(order, product, plan)],
        components: this._buildLogComponents(order),
      });
    } catch (err) {
      console.warn('[orderHandler] فشل تحديث رسالة اللوج:', err.message);
    }
  },

  // ─── تغيير حالة الأوردر (عام) ───
  // يحدّث الحالة، يبعت رسالة في تيكت العميل، DM للعميل، ويحدّث رسالة اللوج

  async changeOrderStatus(client, orderId, newStatus, byUserId = null) {
    const order = db.changeStatus(orderId, newStatus, byUserId);
    if (!order) return null;

    const statusInfo = orderStatus.get(newStatus);

    // 1) رسالة في تيكت العميل
    if (order.customer.ticketChannelId) {
      try {
        const ticketChannel = await client.channels.fetch(order.customer.ticketChannelId);
        const byUser = byUserId ? `<@${byUserId}>` : null;
        await ticketChannel.send({ embeds: [embeds.orderStatusChanged(order, byUser)] });
      } catch (err) {
        console.warn('[orderHandler] فشل إرسال رسالة الحالة في التذكرة:', err.message);
      }
    }

    // 2) رسالة DM للعميل
    try {
      const customerUser = await client.users.fetch(order.customer.discordId);
      const dmText = statusInfo?.customerDM(order) ?? `تم تحديث حالة طلبك \`${order.id}\` إلى: ${newStatus}`;
      await customerUser.send({ embeds: [embeds.info(`تحديث طلبك ${order.id}`, dmText)] });
    } catch (err) {
      console.warn('[orderHandler] فشل إرسال DM للعميل (قد يكون أغلق الخاص):', err.message);
    }

    // 3) تحديث رسالة اللوج في مكانها
    await this.refreshLogMessage(client, orderId);

    return order;
  },

  // ─── الخطوة 1: تحديد السعر (بعد اختيار "بانتظار الدفع") ───
  // يحفظ السعر، يحوّل الحالة لـ awaiting_payment، ويرسل أزرار اختيار
  // طريقة الدفع للعميل داخل تذكرته

  async setPriceAndRequestPayment(client, orderId, { originalPrice, discountAmount = 0, discountReason = null }, byUserId) {
    const finalPrice = Math.max(0, originalPrice - discountAmount);

    let order = db.setPayment(orderId, {
      originalPrice,
      discountAmount,
      discountReason,
      finalPrice,
    });
    if (!order) return null;

    // تحويل الحالة لـ awaiting_payment (هذا يرسل DM + رسالة تذكرة + يحدّث اللوج)
    order = await this.changeOrderStatus(client, orderId, 'awaiting_payment', byUserId);

    // إرسال أزرار اختيار طريقة الدفع للعميل داخل تذكرته
    if (order?.customer?.ticketChannelId) {
      try {
        const ticketChannel = await client.channels.fetch(order.customer.ticketChannelId);
        await ticketChannel.send({
          embeds: [embeds.priceSet(order)],
          components: components.customerPaymentMethods(orderId),
        });
      } catch (err) {
        console.warn('[orderHandler] فشل إرسال أزرار طريقة الدفع للعميل:', err.message);
      }
    }

    return order;
  },

  // ─── الخطوة 2: العميل يختار طريقة الدفع ───
  // يحفظ الطريقة، يحوّل الحالة لـ payment_pending، يبعت منشن لفريق المالية

  async selectPaymentMethod(client, interaction, orderId, method) {
    let order = db.setPayment(orderId, { method });
    if (!order) return null;

    order = await this.changeOrderStatus(client, orderId, 'payment_pending', null);

    // رسالة في تذكرة العميل: سيتواصل معك المسؤول عن المالية + منشن الفريق
    const guild = interaction.guild;
    const financeMention = permissions.mentionRoles(guild, cfg.roles.finance);

    await interaction.channel.send({
      content: financeMention ? `${financeMention} 💰 طلب دفع جديد — \`${order.id}\`` : undefined,
      embeds: [embeds.paymentMethodChosen(order)],
    });

    return order;
  },

  // ─── الخطوة 3: المسؤول عن المالية يؤكد استلام الدفع ───

  async confirmPaymentReceived(client, orderId, byUserId) {
    let order = db.setPayment(orderId, {
      paid: true,
      paidAt: new Date().toISOString(),
    });
    if (!order) return null;

    order = await this.changeOrderStatus(client, orderId, 'paid', byUserId);

    // رسالة تفاصيل الدفع + دعوة التقييم في نفس الرسالة (تقليل عدد الرسائل)
    if (order?.customer?.ticketChannelId) {
      try {
        const components = require('../core/components');
        const ticketChannel = await client.channels.fetch(order.customer.ticketChannelId);
        await ticketChannel.send({ embeds: [embeds.paymentConfirmed(order)] });
        await ticketChannel.send({
          embeds: [embeds.feedbackInvitation()],
          components: [components.feedbackStars(orderId)],
        });
      } catch (err) {
        console.warn('[orderHandler] فشل إرسال رسالة تفاصيل الدفع/التقييم في التذكرة:', err.message);
      }
    }

    // تحديث روم العملاء بالإحصائيات الجديدة
    try {
      const customersChannelHandler = require('./customersChannelHandler');
      await customersChannelHandler.refresh(client);
    } catch (err) {
      console.warn('[orderHandler] فشل تحديث روم العملاء:', err.message);
    }

    return order;
  },

  // ─── حفظ تقييم العميل وإرساله لروم تقييمات العملاء ───

  async submitFeedback(client, { orderId, customerId, username, rating, comment }) {
    const feedback = db.saveFeedback({ orderId, customerId, username, rating, comment });
    const order = db.getOrder(orderId);
    if (!order) return feedback;

    if (cfg.channels.feedbackChannel) {
      try {
        const feedbackChannel = await client.channels.fetch(cfg.channels.feedbackChannel);
        await feedbackChannel.send({ embeds: [embeds.feedbackLog(order, feedback)] });
      } catch (err) {
        console.warn('[orderHandler] فشل إرسال التقييم لروم التقييمات:', err.message);
      }
    } else {
      console.warn('[orderHandler] ⚠️ FEEDBACK_CHANNEL_ID غير محدد في .env — لم يُرسل التقييم لأي قناة');
    }

    return feedback;
  },
};
