'use strict';

const registry    = require('../core/registry');
const categories  = require('../core/categoryRegistry');
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

  buildPurchaseComponents(ticket, selectorRows = []) {
    return [
      ...selectorRows,
      components.ticketActions(!!ticket?.claimedBy),
      components.ticketAdminButton(),
    ].slice(0, 5);
  },

  async start(interaction, extraComponents = []) {
    const roots = categories.getRootCategories();
    const ticket = db.getTicket(interaction.channel.id);
    const controls = extraComponents.length
      ? extraComponents
      : [components.ticketActions(!!ticket?.claimedBy), components.ticketAdminButton()];
    const displayMode = categories.getDisplayMode();
    const generalProducts = displayMode === 'grouped' ? categories.getGeneralProducts() : [];

    if (roots.length > 0) {
      const rows = [components.categorySelect(roots)];
      if (generalProducts.length) rows.push(components.productSelect(generalProducts));
      rows.push(components.storeProductSearchButton(), ...controls);
      return interaction.channel.send({
        embeds: [embeds.storeCategories(roots, [], generalProducts)],
        components: rows.slice(0, 5),
      });
    }

    const products = registry.getVisible();
    return interaction.channel.send({
      embeds: [embeds.store(products)],
      components: this.buildPurchaseComponents(ticket, [components.productSelect(products), components.storeProductSearchButton()]),
    });
  },

  async handleCategorySelect(interaction) {
    await interaction.deferUpdate();

    const ticket = db.getTicket(interaction.channel.id);
    const currentPath = Array.isArray(ticket?.selectedCategoryPath) ? ticket.selectedCategoryPath : [];
    const selected = interaction.values[0];
    const child = categories.getChildren(currentPath).find(p => p.join(' › ') === selected);

    if (!child) {
      return interaction.editReply({ embeds: [embeds.error('التصنيف غير موجود.')], components: [] }).catch(() => {});
    }

    db.updateTicket(interaction.channel.id, { selectedCategoryPath: child });

    const updatedTicket = db.getTicket(interaction.channel.id);
    const children = categories.getChildren(child);
    const products = categories.getProducts(child);

    if (children.length === 0 && products.length === 0) {
      return interaction.editReply({
        embeds: [embeds.info('لا توجد منتجات', 'لا توجد منتجات متاحة داخل هذا التصنيف حاليًا.')],
        components: this.buildPurchaseComponents(updatedTicket, [components.storeCategoryNavigationButtons(true)]),
      });
    }

    const rows = [];
    if (children.length) rows.push(components.categorySelect(children));
    const showProducts = categories.getDisplayMode() === 'grouped' || children.length === 0;
    if (products.length && showProducts) rows.push(components.productSelect(products));
    rows.push(components.storeCategoryNavigationButtons(true));
    return interaction.editReply({
      embeds: [embeds.storeCategories(children, child, products)],
      components: this.buildPurchaseComponents(updatedTicket, rows),
    });
  },

  async handleCategoryBack(interaction) {
    await interaction.deferUpdate();

    const ticket = db.getTicket(interaction.channel.id);
    const currentPath = Array.isArray(ticket?.selectedCategoryPath) ? ticket.selectedCategoryPath : [];
    const parent = currentPath.slice(0, -1);

    db.updateTicket(interaction.channel.id, { selectedCategoryPath: parent });

    const updatedTicket = db.getTicket(interaction.channel.id);
    const children = categories.getChildren(parent);
    const products = categories.getProducts(parent);
    const rows = [];
    if (children.length) rows.push(components.categorySelect(children));
    const showProducts = categories.getDisplayMode() === 'grouped' || children.length === 0;
    if (products.length && showProducts) rows.push(components.productSelect(products));
    rows.push(components.storeCategoryNavigationButtons(parent.length > 0));

    return interaction.editReply({
      embeds: [embeds.storeCategories(children, parent, products)],
      components: this.buildPurchaseComponents(updatedTicket, rows),
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
    if (productId === 'none') return interaction.channel.send({ embeds: [embeds.info('لا توجد منتجات', 'لا توجد منتجات متاحة حاليًا داخل هذا القسم.')] });
    const product   = registry.getById(productId);

    if (!product) {
      return interaction.channel.send({ embeds: [embeds.error('المنتج غير موجود.')] });
    }

    db.updateTicket(interaction.channel.id, { selectedProduct: productId });

    // تعطيل قائمة المنتجات فقط مع الحفاظ على أي فئة/رجوع موجودة في نفس الرسالة.
    const disabledMenu = components.productSelect([product]);
    disabledMenu.components[0].setDisabled(true);
    const preservedRows = interaction.message.components
      .map(row => row.toJSON ? row.toJSON() : row)
      .map(raw => raw.components?.some(comp => comp.custom_id === interaction.customId)
        ? disabledMenu.toJSON()
        : raw);
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

  // ─── البحث المباشر عن منتج بالرقم ─────────────────

  async handleProductSearch(interaction) {
    const raw = interaction.fields.getTextInputValue('product_number').trim();
    const product = registry.findByNumber(raw);

    if (!product || product.visibility !== 'visible') {
      return interaction.reply({
        embeds: [embeds.error(`❌ لم يتم العثور على منتج متاح بالرقم أو الـID: **${raw}**`)],
        ephemeral: true,
      });
    }

    const ticket = db.getTicket(interaction.channel.id);
    if (!ticket) {
      return interaction.reply({ content: '❌ لا يمكن البحث عن المنتجات خارج التذكرة.', ephemeral: true });
    }

    if (ticket.orderId) {
      return interaction.reply({
        embeds: [embeds.info('تم تسجيل طلبك مسبقًا', `رقم طلبك: \`${ticket.orderId}\`

لو تريد طلب منتج آخر، افتح تذكرة شراء جديدة.`)],
        ephemeral: true,
      });
    }

    db.updateTicket(interaction.channel.id, { selectedProduct: product.id });

    if (product.availability === 'maintenance') {
      const dashComponents = require('../core/dashboardComponents');
      return interaction.reply({
        embeds: [embeds.productDetail(product)],
        components: [dashComponents.maintenanceButton()],
        ephemeral: true,
      });
    }

    return interaction.reply({
      embeds: [embeds.productDetail(product)],
      components: [components.planSelect(product)],
      ephemeral: true,
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
