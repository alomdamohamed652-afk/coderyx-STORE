'use strict';

const registry    = require('../core/registry');
const embeds      = require('../core/embeds');
const components  = require('../core/components');
const db           = require('../core/database');
const cfg          = require('../config');
const permissions  = require('../core/permissions');
const categoryRegistry = require('../core/categoryRegistry');

// ─────────────────────────────────────────
//   Store Flow
//   رحلة الشراء: منتج → خطة → إنشاء أوردر
//   مباشرة (الفريق هو من يجهز دائمًا)
// ─────────────────────────────────────────

module.exports = {

  // ─── Step 1: عرض المنتجات ───────────

  async start(interaction, extraComponents = []) {
    const products = registry.getVisible();
    const categories = categoryRegistry.getChildren(null);
    const uncategorized = products.filter(p => !categoryRegistry.categoryIdForProduct(p));

    if (products.length === 0) {
      return interaction.channel.send({
        embeds: [embeds.info('لا توجد منتجات', 'لا توجد منتجات متاحة حاليًا. تواصل معنا مباشرة.')],
        components: extraComponents,
      });
    }

    // قبل إنشاء الفئات، نحافظ على المنتجات القديمة في واجهة مباشرة.
    if (!categories.length) {
      return interaction.channel.send({
        embeds: [embeds.store(products)],
        components: [components.productSelect(products), ...extraComponents],
      });
    }

    const root = [...categories];
    if (uncategorized.length) {
      root.push({ id: '__uncategorized', name: 'غير مصنف', emoji: '📦', parentId: null, order: 999999 });
    }

    return interaction.channel.send({
      embeds: [embeds.storeCategories(root, null, uncategorized)],
      components: [components.categorySelect(root, 'root'), ...extraComponents].slice(0, 5),
    });
  },

  async handleCategorySelect(interaction) {
    const categoryId = interaction.values[0];
    const category = categoryRegistry.get(categoryId);
    if (!category && categoryId !== '__uncategorized') {
      return interaction.reply({ content: '❌ الفئة غير موجودة أو تم حذفها.', ephemeral: true });
    }

    const children = categoryId === '__uncategorized' ? [] : categoryRegistry.getChildren(categoryId);
    const products = categoryId === '__uncategorized'
      ? registry.getVisible().filter(p => !categoryRegistry.categoryIdForProduct(p))
      : registry.getVisible().filter(p => categoryRegistry.categoryIdForProduct(p) === categoryId);

    const ticket = db.getTicket(interaction.channel.id);
    const rows = [];
    if (children.length) rows.push(components.categorySelect(children, categoryId));
    if (products.length) rows.push(components.productSelect(products, categoryId));
    rows.push(components.storeBackButton(category?.parentId || 'root'));
    rows.push(components.ticketActions(!!ticket?.claimedBy), components.ticketAdminButton());

    return interaction.update({
      embeds: [embeds.storeCategories(children, categoryId === '__uncategorized' ? null : categoryId, products)],
      components: rows.slice(0, 5),
    });
  },

  async handleCategoryBack(interaction) {
    const target = interaction.customId.slice('store_back_'.length);
    if (target === 'root') {
      const categories = categoryRegistry.getChildren(null);
      const products = registry.getVisible();
      const ticket = db.getTicket(interaction.channel.id);
      const uncategorized = products.filter(p => !categoryRegistry.categoryIdForProduct(p));
      const root = [...categories];
      if (uncategorized.length) root.push({ id: '__uncategorized', name: 'غير مصنف', emoji: '📦', parentId: null, order: 999999 });

      return interaction.update({
        embeds: [embeds.storeCategories(root, null, uncategorized)],
        components: [components.categorySelect(root, 'root'), components.ticketActions(!!ticket?.claimedBy), components.ticketAdminButton()],
      });
    }

    const category = categoryRegistry.get(target);
    if (!category) return interaction.reply({ content: '❌ الفئة غير موجودة.', ephemeral: true });

    const children = categoryRegistry.getChildren(target);
    const products = registry.getVisible().filter(p => categoryRegistry.categoryIdForProduct(p) === target);
    const ticket = db.getTicket(interaction.channel.id);
    const rows = [];
    if (children.length) rows.push(components.categorySelect(children, target));
    if (products.length) rows.push(components.productSelect(products, target));
    rows.push(components.storeBackButton(category.parentId || 'root'));
    rows.push(components.ticketActions(!!ticket?.claimedBy), components.ticketAdminButton());

    return interaction.update({
      embeds: [embeds.storeCategories(children, category.parentId, products, category.name, `المسار: **${categoryRegistry.getPath(target)}**`)],
      components: rows.slice(0, 5),
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

    // تعطيل قائمة المنتجات فقط، مع الحفاظ على صفوف الاستلام والإدارة والفئات.
    const disabledMenu = components.productSelect([product], ticket?.selectedProduct || 'selected');
    disabledMenu.components[0].setDisabled(true);
    const preservedRows = interaction.message.components.map(row => {
      const raw = row.toJSON ? row.toJSON() : row;
      if (raw.components?.some(comp => comp.custom_id === interaction.customId)) return disabledMenu.toJSON();
      return raw;
    });
    await interaction.message.edit({ components: preservedRows }).catch(() => {});

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
