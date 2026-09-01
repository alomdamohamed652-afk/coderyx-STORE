'use strict';

const ticketHandler = require('./ticketHandler');
const storeFlow     = require('../flows/storeFlow');
const orderInteractionHandler = require('./orderInteractionHandler');
const dashboardHandler   = require('./dashboardHandler');
const productEditHandler = require('./productEditHandler');
const planEditHandler    = require('./planEditHandler');
const productWizardHandler = require('./productWizardHandler');

// ─────────────────────────────────────────
//   Interaction Handler
//   يستقبل جميع الـ Interactions
//   ويوجهها للـ Flow الصحيح
// ─────────────────────────────────────────

// منع معالجة ضغطتين/أوامر متتالية بسرعة من نفس المستخدم (double-click أو ضغط مزدوج على Enter)
// يحفظ آخر وقت تفاعل لكل (مستخدم + نوع التفاعل) لمدة 2 ثانية
const recentInteractions = new Map();
const DEBOUNCE_MS = 2000;

function getInteractionKey(interaction) {
  if (interaction.isChatInputCommand()) {
    return `cmd:${interaction.commandName}`;
  }
  return `comp:${interaction.customId}`;
}

function isDuplicateInteraction(interaction) {
  const key = `${interaction.user.id}:${getInteractionKey(interaction)}`;
  const now = Date.now();
  const last = recentInteractions.get(key);

  recentInteractions.set(key, now);

  // تنظيف دوري للمفاتيح القديمة (تمنع تسرب الذاكرة)
  if (recentInteractions.size > 1000) {
    for (const [k, t] of recentInteractions) {
      if (now - t > DEBOUNCE_MS) recentInteractions.delete(k);
    }
  }

  return last && (now - last < DEBOUNCE_MS);
}

module.exports = {

  isDuplicateInteraction,

  async handle(interaction, client) {

    // ─── Modal Submit ──────────────────
    if (interaction.isModalSubmit()) {
      const id = interaction.customId;

      if (id.startsWith('price_modal_'))    return orderInteractionHandler.handlePriceModalSubmit(interaction);
      if (id.startsWith('feedback_modal_')) return orderInteractionHandler.handleFeedbackModalSubmit(interaction);

      // ─── Dashboard: Wizard إضافة منتج (3 خطوات متتالية) ───
      if (id === 'wizard_step1') return productWizardHandler.handleStep1(interaction);
      if (id === 'wizard_step2') return productWizardHandler.handleStep2(interaction);
      if (id === 'wizard_step3') return productWizardHandler.handleStep3(interaction);

      // ─── Dashboard: تعديل باقة (إضافة/تعديل) ───
      if (id.startsWith('dash_modal_plan_')) return planEditHandler.handlePlanModalSubmit(interaction);

      // ─── Dashboard: المميزات ───
      if (id.startsWith('dash_modal_features_')) return productEditHandler.handleFeaturesModalSubmit(interaction);

      // ─── Dashboard: الصور ───
      if (id.startsWith('dash_modal_images_')) return productEditHandler.handleImagesModalSubmit(interaction);

      // ─── Dashboard: الحقول النصية البسيطة (اسم/وصف/سعر/لون/إصدار) ───
      const textFieldMatch = id.match(/^dash_modal_(name|desc|price|color|version)_/);
      if (textFieldMatch) return productEditHandler.handleTextModalSubmit(interaction, textFieldMatch[1]);

      return;
    }

    // تجاهل الضغطات المزدوجة السريعة لمنع تفاعلات "ميتة" ورسائل/تذاكر مكررة
    if ((interaction.isButton() || interaction.isStringSelectMenu()) && isDuplicateInteraction(interaction)) {
      console.warn(`[interactionHandler] تم تجاهل ضغطة مكررة سريعة من ${interaction.user.tag} على ${interaction.customId}`);
      return;
    }

    // ─── Buttons ──────────────────────
    if (interaction.isButton()) {
      const id = interaction.customId;

      switch (id) {
        case 'claim_ticket':    return ticketHandler.claim(interaction);
        case 'request_close':   return ticketHandler.requestClose(interaction);
        case 'confirm_close':   return ticketHandler.confirmClose(interaction);
        case 'cancel_close':    return ticketHandler.cancelClose(interaction);

        // ─── Dashboard: الأزرار الرئيسية ───
        case 'dash_add_product':   return dashboardHandler.handleAddProduct(interaction);
        case 'dash_edit_product':  return dashboardHandler.handleEditProduct(interaction);
        case 'dash_view_products': return dashboardHandler.handleViewProducts(interaction);
        case 'dash_statistics':    return dashboardHandler.handleStatistics(interaction);
        case 'dash_settings':      return dashboardHandler.handleSettings(interaction);
        case 'dash_back_to_list':  return dashboardHandler.handleBackToList(interaction);

        // ─── Dashboard: أزرار "التالي" بين خطوات Wizard إضافة منتج ───
        // (لازم تكون أزرار لأن Modal Submit لا يقدر يفتح Modal تالية مباشرة)
        case 'wizard_open_step2': return productWizardHandler.openStep2(interaction);
        case 'wizard_open_step3': return productWizardHandler.openStep3(interaction);

        // ─── Customer-facing: زر "تحت الصيانة" ───
        case 'product_maintenance_notice':
          return interaction.reply({ content: '🛠️ هذا المنتج تحت الصيانة حاليًا ولا يمكن شراؤه في الوقت الحالي.', ephemeral: true });
      }

      // ─── Dashboard: أزرار لوحة منتج واحد (ديناميكية بـ productId) ───
      if (id.startsWith('dash_p_avail_'))    return productEditHandler.toggleAvailability(interaction);
      if (id.startsWith('dash_p_vis_'))      return productEditHandler.toggleVisibility(interaction);
      if (id.startsWith('dash_p_badge_'))    return productEditHandler.openBadgeSelect(interaction);
      if (id.startsWith('dash_p_name_'))     return productEditHandler.openTextModal(interaction, 'name');
      if (id.startsWith('dash_p_desc_'))     return productEditHandler.openTextModal(interaction, 'desc');
      if (id.startsWith('dash_p_price_'))    return productEditHandler.openTextModal(interaction, 'price');
      if (id.startsWith('dash_p_color_'))    return productEditHandler.openTextModal(interaction, 'color');
      if (id.startsWith('dash_p_version_'))  return productEditHandler.openTextModal(interaction, 'version');
      if (id.startsWith('dash_p_images_'))   return productEditHandler.openImagesModal(interaction);
      if (id.startsWith('dash_p_features_')) return productEditHandler.openFeaturesModal(interaction);
      if (id.startsWith('dash_p_plans_'))    return planEditHandler.openPlanSelect(interaction);
      if (id.startsWith('dash_p_order_up_'))   return productEditHandler.moveOrder(interaction, 'up');
      if (id.startsWith('dash_p_order_down_')) return productEditHandler.moveOrder(interaction, 'down');
      if (id.startsWith('dash_p_refresh_'))  return productEditHandler.refreshMessage(interaction);

      // أزرار اختيار طريقة الدفع للعميل (داخل تذكرته)
      // تُطابق ديناميكيًا مع config/paymentMethods.js — أي طريقة تُضاف هناك تعمل هنا تلقائيًا
      if (id.startsWith('pay_')) {
        const paymentMethods = require('../config/paymentMethods');
        const matched = paymentMethods.getAll().find(m => id.startsWith(`pay_${m.id}_`));
        if (matched) return orderInteractionHandler.handleCustomerPaymentChoice(interaction, matched.id);
      }

      // زر "تم الدفع" للمسؤول عن المالية (روم اللوج)
      if (id.startsWith('confirm_payment_')) return orderInteractionHandler.handleConfirmPayment(interaction);

      // أزرار تقييم النجوم (1-5) — تظهر للعميل بعد تأكيد الدفع
      const feedbackMatch = id.match(/^feedback_([1-5])_/);
      if (feedbackMatch) {
        const rating = parseInt(feedbackMatch[1], 10);
        return orderInteractionHandler.handleFeedbackStarClick(interaction, rating);
      }
    }

    // ─── Select Menus ─────────────────
    if (interaction.isStringSelectMenu()) {
      const id = interaction.customId;

      switch (id) {
        // اختيار نوع التيكت من البانل نفسه (خارج أي تيكت)
        case 'panel_ticket_type': return ticketHandler.createFromPanel(interaction);
        case 'select_product':    return storeFlow.handleProductSelect(interaction);
        case 'select_plan':       return storeFlow.handlePlanSelect(interaction);

        // ─── Dashboard: اختيار منتج للتعديل ───
        case 'dash_select_product': return dashboardHandler.handleProductSelected(interaction);
      }

      // قائمة تغيير حالة الأوردر (روم اللوج)
      if (id.startsWith('order_status_')) return orderInteractionHandler.handleStatusSelect(interaction);

      // ─── Dashboard: اختيار Badge ───
      if (id.startsWith('dash_badge_select_')) return productEditHandler.handleBadgeSelected(interaction);

      // ─── Dashboard: اختيار باقة للتعديل ───
      if (id.startsWith('dash_plan_select_')) return planEditHandler.handlePlanSelected(interaction);
    }
  },
};
