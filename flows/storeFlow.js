'use strict';

const registry    = require('../core/registry');
const embeds      = require('../core/embeds');
const components  = require('../core/components');
const db           = require('../core/database');
const cfg          = require('../config');
const permissions  = require('../core/permissions');

// ─────────────────────────────────────────
//   Store Flow
//   رحلة الشراء: منتج → خطة → إنشاء أوردر
//   مباشرة (الفريق هو من يجهز دائمًا)
// ─────────────────────────────────────────

module.exports = {

  // ─── Step 1: عرض المنتجات ───────────

  async start(interaction, extraComponents = []) {
    const products = registry.getVisible();

    if (products.length === 0) {
      return interaction.channel.send({
        embeds: [embeds.info('لا توجد منتجات', 'لا توجد منتجات متاحة حاليًا. تواصل معنا مباشرة.')],
        components: extraComponents,
      });
    }

    return interaction.channel.send({
      embeds:     [embeds.store(products)],
      components: [components.productSelect(products), ...extraComponents],
    });
  },

  // ─── Step 2: اختيار المنتج ──────────

  async handleProductSelect(interaction) {
    await interaction.deferUpdate();

    const ticket = db.getTicket(interaction.channel.id);

    // منع إعادة اختيار المنتج بعد إنشاء الأوردر بالفعل
    if (ticket?.orderId) {
      return interaction.channel.send({
        embeds: [embeds.info('تم تسجيل طلبك مسبقًا', `رقم طلبك: \`${ticket.orderId}\`\n\nلو تريد طلب منتج آخر، افتح تذكرة شراء جديدة بعد إغلاق هذه.`)],
      });
    }

    const productId = interaction.values[0];
    const product   = registry.getById(productId);

    if (!product) {
      return interaction.channel.send({ embeds: [embeds.error('المنتج غير موجود.')] });
    }

    db.updateTicket(interaction.channel.id, { selectedProduct: productId });

    // تعطيل قائمة المنتجات بعد الاختيار
    const products = registry.getVisible();
    const disabledMenu = components.productSelect(products);
    disabledMenu.components[0].setDisabled(true);
    await interaction.message.edit({ components: [disabledMenu] }).catch(() => {});

    // المنتج تحت الصيانة → نعرض التفاصيل لكن بدون إمكانية شراء فعلية
    if (product.availability === 'maintenance') {
      const dashComponents = require('../core/dashboardComponents');
      return interaction.channel.send({
        embeds:     [embeds.productDetail(product)],
        components: [dashComponents.maintenanceButton()],
      });
    }

    await interaction.channel.send({
      embeds:     [embeds.productDetail(product)],
      components: [components.planSelect(product)],
    });
  },

  // ─── Step 3: اختيار الخطة → إنشاء الأوردر مباشرة ───

  async handlePlanSelect(interaction) {
    await interaction.deferUpdate();

    const ticket  = db.getTicket(interaction.channel.id);

    // منع إنشاء أكثر من أوردر لنفس التذكرة (لو ضغط على القائمة القديمة تاني)
    if (ticket?.orderId) {
      return interaction.channel.send({
        embeds: [embeds.info('تم تسجيل طلبك مسبقًا', `رقم طلبك: \`${ticket.orderId}\`\n\nلو تريد طلب منتج آخر، افتح تذكرة شراء جديدة بعد إغلاق هذه.`)],
      });
    }

    const product = registry.getById(ticket?.selectedProduct);

    if (!product) {
      return interaction.channel.send({ embeds: [embeds.error('حدث خطأ. يرجى البدء من جديد.')] });
    }

    if (product.availability === 'maintenance') {
      return interaction.channel.send({ embeds: [embeds.error('هذا المنتج أصبح تحت الصيانة، يرجى التواصل مع الدعم.')] });
    }

    const planIndex = parseInt(interaction.values[0], 10);
    const plan      = product.plans[planIndex];

    if (!plan) {
      return interaction.channel.send({ embeds: [embeds.error('الخطة غير موجودة.')] });
    }

    db.updateTicket(interaction.channel.id, { selectedPlanIndex: planIndex });

    // تعطيل القائمة بعد الاختيار (تظهر معطّلة بصريًا، تمنع اختيارات متكررة)
    const disabledMenu = components.planSelect(product);
    disabledMenu.components[0].setDisabled(true);
    await interaction.message.edit({ components: [disabledMenu] }).catch(() => {});

    await interaction.channel.send({
      embeds: [embeds.planSelected(product, plan)],
    });

    // إنشاء الأوردر مباشرة — الفريق هو من يجهز كل شيء، لا "تجهيز بالنفس"
    const order = db.createOrder({
      customerId: interaction.user.id,
      username:   interaction.user.tag,
      productId:  product.id,
      planId:     String(planIndex),
      channelId:  interaction.channel.id,
    });

    db.updateTicket(interaction.channel.id, { orderId: order.id });

    // منشن فريق التطوير (وليس الدعم) لطلبات الشراء — مدمج مع رسالة التأكيد لتقليل عدد الرسائل
    const devMention = permissions.mentionRoles(interaction.guild, cfg.roles.dev);
    if (!devMention) {
      console.warn('[storeFlow] ⚠️ لا توجد رتب فريق تطوير صالحة (DEV_ROLE_IDS) للمنشن');
    }

    await interaction.channel.send({
      content: devMention ? `${devMention} 📦 طلب شراء جديد — \`${order.id}\`` : undefined,
      embeds: [embeds.info(
        '✅ تم تسجيل طلبك',
        `رقم طلبك: \`${order.id}\`\n\nسيتواصل معك فريق التطوير قريبًا لإتمام التجهيز وأخذ التفاصيل المطلوبة منك.`
      )],
    });

    // إرسال DM فوري للعميل (تم استلام طلبك) + إرسال ملخص الطلب لقناة اللوج
    // لا ننتظرهما، غير حرجين لتجربة العميل داخل التذكرة
    const orderHandler = require('../handlers/orderHandler');

    interaction.user.send({
      embeds: [embeds.info(`تم استلام طلبك ${order.id}`, require('../core/orderStatus').get('pending_review').customerDM(order))],
    }).catch(err => {
      console.warn('[storeFlow] فشل إرسال DM الاستلام للعميل (قد يكون أغلق الخاص):', err.message);
    });

    if (cfg.channels.ordersLog) {
      orderHandler.sendSummary(interaction.client, order.id).catch(err => {
        console.error('[storeFlow] فشل إرسال لوق الأوردر:', err.message);
      });
    }
  },
};
