'use strict';

const {
  ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle,
  ButtonBuilder, ButtonStyle,
} = require('discord.js');
const registry = require('../core/registry');
const dashEmbeds = require('../core/dashboardEmbeds');
const dashComponents = require('../core/dashboardComponents');

// ─────────────────────────────────────────
//   Product Wizard Handler
//   إنشاء منتج جديد عبر سلسلة Modals متتالية
//
//   ملاحظة مهمة: Discord لا يسمح بفتح Modal جديدة
//   مباشرة من رد على Modal Submit (showModal غير
//   متاحة على ModalSubmitInteraction). الحل: بعد كل
//   Modal نرد برسالة فيها زر "التالي ➡️"، والزر
//   (Button Interaction) هو الذي يفتح الـ Modal التالية.
//
//   الجلسات تُخزَّن في الذاكرة فقط (مؤقتة)
// ─────────────────────────────────────────

const sessions = new Map(); // userId -> { data: {...} }

function getSession(userId) {
  if (!sessions.has(userId)) sessions.set(userId, { data: {} });
  return sessions.get(userId);
}

function nextButton(customId, label = '➡️ التالي') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Primary)
  );
}

module.exports = {

  // ─── البدء: فتح Modal الخطوة 1 مباشرة (من زر "➕ إضافة منتج") ───

  async start(interaction) {
    sessions.delete(interaction.user.id);

    const modal = new ModalBuilder()
      .setCustomId('wizard_step1')
      .setTitle('إضافة منتج جديد (1/3)');

    const idInput = new TextInputBuilder()
      .setCustomId('id').setLabel('ID المنتج (إنجليزي بدون مسافات)').setStyle(TextInputStyle.Short)
      .setRequired(true).setPlaceholder('مثال: police-system');

    const nameInput = new TextInputBuilder()
      .setCustomId('name').setLabel('اسم المنتج').setStyle(TextInputStyle.Short).setRequired(true);

    const descInput = new TextInputBuilder()
      .setCustomId('description').setLabel('الوصف').setStyle(TextInputStyle.Paragraph).setRequired(true);

    const categoryInput = new TextInputBuilder()
      .setCustomId('category').setLabel('الفئة').setStyle(TextInputStyle.Short).setRequired(false)
      .setPlaceholder('مثال: FiveM / RP');

    const versionInput = new TextInputBuilder()
      .setCustomId('version').setLabel('رقم الإصدار').setStyle(TextInputStyle.Short).setRequired(false)
      .setPlaceholder('مثال: 1.0.0');

    modal.addComponents(
      new ActionRowBuilder().addComponents(idInput),
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(descInput),
      new ActionRowBuilder().addComponents(categoryInput),
      new ActionRowBuilder().addComponents(versionInput),
    );

    await interaction.showModal(modal);
  },

  // ─── استلام Modal الخطوة 1 → رد برسالة فيها زر "التالي" ───

  async handleStep1(interaction) {
    const id = interaction.fields.getTextInputValue('id').trim().toLowerCase().replace(/\s+/g, '-');
    const name = interaction.fields.getTextInputValue('name').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    const category = interaction.fields.getTextInputValue('category').trim() || null;
    const version = interaction.fields.getTextInputValue('version').trim() || '1.0.0';

    if (!/^[a-z0-9-]+$/.test(id)) {
      return interaction.reply({ content: '❌ الـ ID يجب أن يكون إنجليزي وأرقام وشرطات فقط (بدون مسافات).', ephemeral: true });
    }

    if (registry.getById(id)) {
      return interaction.reply({ content: `❌ يوجد منتج بهذا الـ ID مسبقًا: \`${id}\`. اختر ID آخر.`, ephemeral: true });
    }

    const session = getSession(interaction.user.id);
    session.data = { id, name, description, category, version };

    await interaction.reply({
      content: `✅ تم حفظ الخطوة 1 (${name}). اضغط للمتابعة للخطوة 2 (اللون والصور والمميزات):`,
      components: [nextButton('wizard_open_step2')],
      ephemeral: true,
    });
  },

  // ─── زر "التالي" بعد الخطوة 1 → يفتح Modal الخطوة 2 ───

  async openStep2(interaction) {
    const session = getSession(interaction.user.id);
    if (!session.data.id) {
      return interaction.reply({ content: '❌ انتهت صلاحية الجلسة، يرجى البدء من جديد بالضغط على ➕ إضافة منتج.', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId('wizard_step2')
      .setTitle('إضافة منتج جديد (2/3)');

    const colorInput = new TextInputBuilder()
      .setCustomId('color').setLabel('اللون (Hex)').setStyle(TextInputStyle.Short).setRequired(false)
      .setPlaceholder('#5865F2').setValue('#5865F2');

    const thumbInput = new TextInputBuilder()
      .setCustomId('thumbnail').setLabel('رابط صورة Thumbnail').setStyle(TextInputStyle.Short).setRequired(false);

    const bannerInput = new TextInputBuilder()
      .setCustomId('banner').setLabel('رابط صورة Banner').setStyle(TextInputStyle.Short).setRequired(false);

    const featuresInput = new TextInputBuilder()
      .setCustomId('features').setLabel('المميزات العامة (كل ميزة في سطر)').setStyle(TextInputStyle.Paragraph).setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(colorInput),
      new ActionRowBuilder().addComponents(thumbInput),
      new ActionRowBuilder().addComponents(bannerInput),
      new ActionRowBuilder().addComponents(featuresInput),
    );

    await interaction.showModal(modal);
  },

  // ─── استلام Modal الخطوة 2 → رد برسالة فيها زر "التالي" ───

  async handleStep2(interaction) {
    const session = getSession(interaction.user.id);
    if (!session.data.id) {
      return interaction.reply({ content: '❌ انتهت صلاحية الجلسة، يرجى البدء من جديد بالضغط على ➕ إضافة منتج.', ephemeral: true });
    }

    const color = interaction.fields.getTextInputValue('color').trim() || '#5865F2';
    const thumbnail = interaction.fields.getTextInputValue('thumbnail').trim() || null;
    const banner = interaction.fields.getTextInputValue('banner').trim() || null;
    const featuresRaw = interaction.fields.getTextInputValue('features') || '';
    const features = featuresRaw.split('\n').map(f => f.trim()).filter(Boolean);

    session.data = { ...session.data, color, thumbnail, banner, features };

    await interaction.reply({
      content: '✅ تم حفظ الخطوة 2. اضغط للمتابعة للخطوة الأخيرة (الباقة الأولى):',
      components: [nextButton('wizard_open_step3')],
      ephemeral: true,
    });
  },

  // ─── زر "التالي" بعد الخطوة 2 → يفتح Modal الخطوة 3 ───

  async openStep3(interaction) {
    const session = getSession(interaction.user.id);
    if (!session.data.id) {
      return interaction.reply({ content: '❌ انتهت صلاحية الجلسة، يرجى البدء من جديد بالضغط على ➕ إضافة منتج.', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId('wizard_step3')
      .setTitle('إضافة منتج جديد (3/3) — الباقة الأولى');

    const planNameInput = new TextInputBuilder()
      .setCustomId('plan_name').setLabel('اسم الباقة').setStyle(TextInputStyle.Short).setRequired(true)
      .setValue('Basic');

    const planPriceInput = new TextInputBuilder()
      .setCustomId('plan_price').setLabel('السعر').setStyle(TextInputStyle.Short).setRequired(true);

    const planCurrencyInput = new TextInputBuilder()
      .setCustomId('plan_currency').setLabel('العملة').setStyle(TextInputStyle.Short).setRequired(true)
      .setValue('SAR');

    const planFeaturesInput = new TextInputBuilder()
      .setCustomId('plan_features').setLabel('مميزات الباقة (كل ميزة في سطر)').setStyle(TextInputStyle.Paragraph).setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(planNameInput),
      new ActionRowBuilder().addComponents(planPriceInput),
      new ActionRowBuilder().addComponents(planCurrencyInput),
      new ActionRowBuilder().addComponents(planFeaturesInput),
    );

    await interaction.showModal(modal);
  },

  // ─── استلام Modal الخطوة 3 (النهائية) → إنشاء المنتج فعليًا ───

  async handleStep3(interaction) {
    const session = getSession(interaction.user.id);
    if (!session.data.id) {
      return interaction.reply({ content: '❌ انتهت صلاحية الجلسة، يرجى البدء من جديد بالضغط على ➕ إضافة منتج.', ephemeral: true });
    }

    const planName = interaction.fields.getTextInputValue('plan_name').trim();
    const planPriceRaw = interaction.fields.getTextInputValue('plan_price').trim();
    const planCurrency = interaction.fields.getTextInputValue('plan_currency').trim();
    const planFeaturesRaw = interaction.fields.getTextInputValue('plan_features') || '';

    const planPrice = parseFloat(planPriceRaw);
    if (isNaN(planPrice) || planPrice < 0) {
      return interaction.reply({ content: '❌ السعر غير صحيح. حاول مرة أخرى بالضغط على ➕ إضافة منتج.', ephemeral: true });
    }

    const planFeatures = planFeaturesRaw.split('\n').map(f => f.trim()).filter(Boolean);

    await interaction.deferReply({ ephemeral: true });

    const productData = {
      ...session.data,
      plans: [{ name: planName, price: planPrice, currency: planCurrency, features: planFeatures }],
    };

    try {
      const created = registry.create(productData);
      sessions.delete(interaction.user.id);

      const dashboardLogHandler = require('./dashboardLogHandler');
      await dashboardLogHandler.log(interaction.client, {
        actor: interaction.user,
        action: 'create_product',
        product: created,
        after: `${created.name} (\`${created.id}\`) — ${planPrice} ${planCurrency}`,
      });

      const dashboardHandler = require('./dashboardHandler');
      await dashboardHandler.refreshMainDashboard(interaction.client);

      await interaction.editReply({
        content: `✅ تم إنشاء المنتج **${created.name}** بنجاح!`,
        embeds: [dashEmbeds.productDashboard(created)],
        components: dashComponents.productControlButtons(created),
      });
    } catch (err) {
      console.error('[productWizardHandler] فشل إنشاء المنتج:', err.message);
      await interaction.editReply({ content: `❌ فشل إنشاء المنتج: ${err.message}` });
    }
  },
};
