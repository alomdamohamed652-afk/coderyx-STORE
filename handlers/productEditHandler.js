'use strict';

const registry        = require('../core/registry');
const dashComponents   = require('../core/dashboardComponents');
const dashEmbeds       = require('../core/dashboardEmbeds');
const dashboardLogHandler = require('./dashboardLogHandler');

// ─────────────────────────────────────────
//   Product Edit Handler
//   كل أزرار التعديل الخاصة بمنتج واحد
//   كل عملية فعلية تُسجَّل في DASHBOARD_LOG_CHANNEL_ID
// ─────────────────────────────────────────

function extractProductId(customId, prefix) {
  return customId.slice(prefix.length);
}

async function refreshOriginalDashboardMessage(interaction, productId) {
  const product = registry.getById(productId);
  if (!product) return;

  await interaction.message.edit({
    embeds: [dashEmbeds.productDashboard(product)],
    components: dashComponents.productControlButtons(product),
  }).catch(() => {});
}

module.exports = {

  // ─── تبديل Availability (متاح/صيانة) ───

  async toggleAvailability(interaction) {
    const productId = extractProductId(interaction.customId, 'dash_p_avail_');
    const product = registry.getById(productId);
    if (!product) return interaction.reply({ content: '❌ المنتج غير موجود.', ephemeral: true });

    await interaction.deferUpdate();

    const oldValue = product.availability;
    const newAvailability = product.availability === 'active' ? 'maintenance' : 'active';
    registry.save(productId, { availability: newAvailability });

    await dashboardLogHandler.log(interaction.client, {
      actor: interaction.user,
      action: 'toggle_availability',
      product,
      before: oldValue,
      after: newAvailability,
    });

    const dashboardHandler = require('./dashboardHandler');
    await dashboardHandler.refreshMainDashboard(interaction.client);
    await refreshOriginalDashboardMessage(interaction, productId);
  },

  // ─── تبديل Visibility (ظاهر/مخفي) ───

  async toggleVisibility(interaction) {
    const productId = extractProductId(interaction.customId, 'dash_p_vis_');
    const product = registry.getById(productId);
    if (!product) return interaction.reply({ content: '❌ المنتج غير موجود.', ephemeral: true });

    await interaction.deferUpdate();

    const oldValue = product.visibility;
    const newVisibility = product.visibility === 'visible' ? 'hidden' : 'visible';
    registry.save(productId, { visibility: newVisibility });

    await dashboardLogHandler.log(interaction.client, {
      actor: interaction.user,
      action: 'toggle_visibility',
      product,
      before: oldValue,
      after: newVisibility,
    });

    const dashboardHandler = require('./dashboardHandler');
    await dashboardHandler.refreshMainDashboard(interaction.client);
    await refreshOriginalDashboardMessage(interaction, productId);
  },

  // ─── فتح قائمة اختيار Badge ───

  async openBadgeSelect(interaction) {
    const productId = extractProductId(interaction.customId, 'dash_p_badge_');
    await interaction.reply({
      content: 'اختر Badge للمنتج:',
      components: [dashComponents.badgeSelect(productId)],
      ephemeral: true,
    });
  },

  // ─── استلام اختيار Badge ───

  async handleBadgeSelected(interaction) {
    const productId = extractProductId(interaction.customId, 'dash_badge_select_');
    const product = registry.getById(productId);
    const oldBadge = product?.badge ?? null;
    const badge = interaction.values[0] === 'none' ? null : interaction.values[0];

    await interaction.deferUpdate();
    registry.save(productId, { badge });

    await dashboardLogHandler.log(interaction.client, {
      actor: interaction.user,
      action: 'change_badge',
      product,
      before: registry.badgeLabel(oldBadge) ?? 'بدون Badge',
      after: registry.badgeLabel(badge) ?? 'بدون Badge',
    });

    const dashboardHandler = require('./dashboardHandler');
    await dashboardHandler.refreshMainDashboard(interaction.client);

    const updatedProduct = registry.getById(productId);
    await interaction.editReply({
      content: `✅ تم تحديث Badge إلى: ${registry.badgeLabel(badge) ?? 'بدون Badge'}`,
      components: [],
    });

    await interaction.followUp({
      embeds: [dashEmbeds.productDashboard(updatedProduct)],
      components: dashComponents.productControlButtons(updatedProduct),
      ephemeral: true,
    }).catch(() => {});
  },

  // ─── فتح Modal للحقول النصية البسيطة (اسم/وصف/سعر/لون/إصدار) ───

  async openTextModal(interaction, field) {
    const prefix = `dash_p_${field}_`;
    const productId = extractProductId(interaction.customId, prefix);
    const product = registry.getById(productId);
    if (!product) return interaction.reply({ content: '❌ المنتج غير موجود.', ephemeral: true });

    const { TextInputStyle } = require('discord.js');

    const FIELD_CONFIG = {
      name:    { label: 'اسم المنتج', value: product.name, style: TextInputStyle.Short },
      desc:    { label: 'وصف المنتج', value: product.description, style: TextInputStyle.Paragraph },
      price:   { label: 'سعر أول خطة (الباقات الأخرى من زر 📦 الباقات)', value: String(product.plans[0]?.price ?? ''), style: TextInputStyle.Short },
      color:   { label: 'اللون (Hex مثل #5865F2)', value: product._colorHex ?? '#5865F2', style: TextInputStyle.Short },
      version: { label: 'رقم الإصدار', value: product.version ?? '1.0.0', style: TextInputStyle.Short },
    };

    const conf = FIELD_CONFIG[field];
    const modal = dashComponents.textEditModal(productId, field, conf.label, conf.value, conf.style);
    await interaction.showModal(modal);
  },

  // ─── استلام Modal الحقول النصية البسيطة ───

  async handleTextModalSubmit(interaction, field) {
    const prefix = `dash_modal_${field}_`;
    const productId = extractProductId(interaction.customId, prefix);
    const value = interaction.fields.getTextInputValue('value').trim();

    if (field === 'color' && !/^#[0-9A-Fa-f]{6}$/.test(value)) {
      return interaction.reply({ content: '❌ صيغة اللون غير صحيحة. استخدم مثل: #5865F2', ephemeral: true });
    }
    if (field === 'price' && isNaN(parseFloat(value))) {
      return interaction.reply({ content: '❌ السعر غير صحيح.', ephemeral: true });
    }

    const productBefore = registry.getById(productId);
    if (!productBefore) return interaction.reply({ content: '❌ المنتج غير موجود.', ephemeral: true });

    await interaction.deferUpdate();

    const ACTION_BY_FIELD = {
      name: 'edit_name', desc: 'edit_description', color: 'edit_color',
      version: 'edit_version', price: 'edit_price',
    };

    let patch = {};
    let beforeValue, afterValue;

    if (field === 'name') {
      beforeValue = productBefore.name; afterValue = value;
      patch = { name: value };
    } else if (field === 'desc') {
      beforeValue = productBefore.description; afterValue = value;
      patch = { description: value };
    } else if (field === 'color') {
      beforeValue = productBefore._colorHex ?? '—'; afterValue = value;
      patch = { color: value };
    } else if (field === 'version') {
      beforeValue = productBefore.version ?? '—'; afterValue = value;
      patch = { version: value };
    } else if (field === 'price') {
      const plans = [...productBefore.plans];
      beforeValue = `${plans[0]?.price ?? '—'} ${plans[0]?.currency ?? ''}`;
      afterValue = `${value} ${plans[0]?.currency ?? ''}`;
      if (plans[0]) plans[0] = { ...plans[0], price: parseFloat(value) };
      patch = { plans };
    }

    registry.save(productId, patch);

    await dashboardLogHandler.log(interaction.client, {
      actor: interaction.user,
      action: ACTION_BY_FIELD[field],
      product: productBefore,
      before: beforeValue,
      after: afterValue,
    });

    const dashboardHandler = require('./dashboardHandler');
    await dashboardHandler.refreshMainDashboard(interaction.client);

    const product = registry.getById(productId);
    await interaction.followUp({
      embeds: [dashEmbeds.productDashboard(product)],
      components: dashComponents.productControlButtons(product),
      ephemeral: true,
    }).catch(() => {});
  },

  // ─── فتح Modal تعديل الصور ───

  async openImagesModal(interaction) {
    const productId = extractProductId(interaction.customId, 'dash_p_images_');
    const product = registry.getById(productId);
    if (!product) return interaction.reply({ content: '❌ المنتج غير موجود.', ephemeral: true });

    const modal = dashComponents.imagesEditModal(productId, product);
    await interaction.showModal(modal);
  },

  // ─── استلام Modal الصور ───

  async handleImagesModalSubmit(interaction) {
    const productId = extractProductId(interaction.customId, 'dash_modal_images_');
    const product = registry.getById(productId);
    if (!product) return interaction.reply({ content: '❌ المنتج غير موجود.', ephemeral: true });

    const thumbnail = interaction.fields.getTextInputValue('thumbnail').trim() || null;
    const banner    = interaction.fields.getTextInputValue('banner').trim() || null;

    await interaction.deferUpdate();
    registry.save(productId, { thumbnail, banner });

    await dashboardLogHandler.log(interaction.client, {
      actor: interaction.user,
      action: 'edit_images',
      product,
      note: `**Thumbnail:** ${thumbnail ?? 'بدون تغيير/إزالة'}\n**Banner:** ${banner ?? 'بدون تغيير/إزالة'}`,
    });

    const dashboardHandler = require('./dashboardHandler');
    await dashboardHandler.refreshMainDashboard(interaction.client);

    const updatedProduct = registry.getById(productId);
    await interaction.followUp({
      embeds: [dashEmbeds.productDashboard(updatedProduct)],
      components: dashComponents.productControlButtons(updatedProduct),
      ephemeral: true,
    }).catch(() => {});
  },

  // ─── فتح Modal تعديل المميزات ───

  async openFeaturesModal(interaction) {
    const productId = extractProductId(interaction.customId, 'dash_p_features_');
    const product = registry.getById(productId);
    if (!product) return interaction.reply({ content: '❌ المنتج غير موجود.', ephemeral: true });

    const modal = dashComponents.featuresEditModal(productId, product.features ?? []);
    await interaction.showModal(modal);
  },

  // ─── استلام Modal المميزات ───

  async handleFeaturesModalSubmit(interaction) {
    const productId = extractProductId(interaction.customId, 'dash_modal_features_');
    const product = registry.getById(productId);
    if (!product) return interaction.reply({ content: '❌ المنتج غير موجود.', ephemeral: true });

    const raw = interaction.fields.getTextInputValue('value');
    const features = raw.split('\n').map(f => f.trim()).filter(Boolean);

    await interaction.deferUpdate();

    const oldCount = (product.features ?? []).length;
    registry.save(productId, { features });

    await dashboardLogHandler.log(interaction.client, {
      actor: interaction.user,
      action: 'edit_features',
      product,
      before: `${oldCount} ميزة`,
      after: `${features.length} ميزة`,
    });

    const dashboardHandler = require('./dashboardHandler');
    await dashboardHandler.refreshMainDashboard(interaction.client);

    const updatedProduct = registry.getById(productId);
    await interaction.followUp({
      embeds: [dashEmbeds.productDashboard(updatedProduct)],
      components: dashComponents.productControlButtons(updatedProduct),
      ephemeral: true,
    }).catch(() => {});
  },

  // ─── تغيير الترتيب (أعلى/أسفل) ───

  async moveOrder(interaction, direction) {
    const prefix = direction === 'up' ? 'dash_p_order_up_' : 'dash_p_order_down_';
    const productId = extractProductId(interaction.customId, prefix);
    const product = registry.getById(productId);

    await interaction.deferUpdate();

    const all = registry.getAll();
    const idx = all.findIndex(p => p.id === productId);
    if (idx === -1) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= all.length) {
      return; // بالفعل في أول/آخر القائمة
    }

    const otherProduct = all[targetIdx];
    registry.swapOrder(productId, otherProduct.id);

    await dashboardLogHandler.log(interaction.client, {
      actor: interaction.user,
      action: 'move_order',
      product,
      note: `${direction === 'up' ? '⬆️ تحرّك لأعلى' : '⬇️ تحرّك لأسفل'} (تبديل الترتيب مع: ${otherProduct.name})`,
    });

    const dashboardHandler = require('./dashboardHandler');
    await dashboardHandler.refreshMainDashboard(interaction.client);
    await refreshOriginalDashboardMessage(interaction, productId);
  },

  // ─── زر "تحديث الرسالة" اليدوي ───

  async refreshMessage(interaction) {
    const productId = extractProductId(interaction.customId, 'dash_p_refresh_');
    await interaction.deferUpdate();
    await refreshOriginalDashboardMessage(interaction, productId);
  },
};
