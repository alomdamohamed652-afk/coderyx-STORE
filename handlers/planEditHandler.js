'use strict';

const registry       = require('../core/registry');
const dashComponents  = require('../core/dashboardComponents');
const dashEmbeds      = require('../core/dashboardEmbeds');
const dashboardLogHandler = require('./dashboardLogHandler');

function extractProductId(customId, prefix) {
  return customId.slice(prefix.length);
}

module.exports = {

  async openPlanSelect(interaction) {
    const productId = extractProductId(interaction.customId, 'dash_p_plans_');
    const product = registry.getById(productId);
    if (!product) return interaction.reply({ content: '❌ المنتج غير موجود.', ephemeral: true });

    await interaction.reply({
      content: 'اختر خطة لتعديلها أو أضف خطة جديدة:',
      components: [dashComponents.planSelectForEdit(productId, product.plans)],
      ephemeral: true,
    });
  },

  async handlePlanSelected(interaction) {
    const productId = extractProductId(interaction.customId, 'dash_plan_select_');
    const product = registry.getById(productId);
    if (!product) return interaction.reply({ content: '❌ المنتج غير موجود.', ephemeral: true });

    const value = interaction.values[0];
    const planIndex = value === 'add_new' ? 'add_new' : parseInt(value, 10);
    const plan = planIndex === 'add_new' ? {} : product.plans[planIndex];

    const modal = dashComponents.planEditModal(productId, planIndex, plan);
    await interaction.showModal(modal);
  },

  async handlePlanModalSubmit(interaction) {
    // customId بصيغة: dash_modal_plan_<planIndex>::<productId>
    // نستخدم فاصل "::" غير قابل للالتباس لأن planIndex قد تكون "add_new" (تحتوي _ بالفعل)
    const rest = interaction.customId.slice('dash_modal_plan_'.length);
    const [planIndexRaw, productId] = rest.split('::');

    const product = registry.getById(productId);
    if (!product) return interaction.reply({ content: '❌ المنتج غير موجود.', ephemeral: true });

    const name     = interaction.fields.getTextInputValue('plan_name').trim();
    const priceRaw = interaction.fields.getTextInputValue('plan_price').trim();
    const currency = interaction.fields.getTextInputValue('plan_currency').trim();
    const featuresRaw = interaction.fields.getTextInputValue('plan_features') || '';

    const price = parseFloat(priceRaw);
    if (isNaN(price) || price < 0) {
      return interaction.reply({ content: '❌ السعر غير صحيح.', ephemeral: true });
    }

    const features = featuresRaw.split('\n').map(f => f.trim()).filter(Boolean);
    const newPlan = { name, price, currency, features };

    await interaction.deferUpdate();

    const isNewPlan = planIndexRaw === 'add_new';
    const oldPlan = isNewPlan ? null : product.plans[parseInt(planIndexRaw, 10)];

    const plans = [...product.plans];
    if (isNewPlan) {
      plans.push(newPlan);
    } else {
      const idx = parseInt(planIndexRaw, 10);
      if (plans[idx]) plans[idx] = newPlan;
    }

    registry.save(productId, { plans });

    await dashboardLogHandler.log(interaction.client, {
      actor: interaction.user,
      action: isNewPlan ? 'add_plan' : 'edit_plan',
      product,
      before: oldPlan ? `${oldPlan.name} — ${oldPlan.price} ${oldPlan.currency}` : null,
      after: `${newPlan.name} — ${newPlan.price} ${newPlan.currency}`,
    });

    const dashboardHandler = require('./dashboardHandler');
    await dashboardHandler.refreshMainDashboard(interaction.client);

    const updatedProduct = registry.getById(productId);
    await interaction.followUp({
      content: isNewPlan ? '✅ تمت إضافة الخطة بنجاح.' : '✅ تم تعديل الخطة بنجاح.',
      embeds: [dashEmbeds.productDashboard(updatedProduct)],
      components: dashComponents.productControlButtons(updatedProduct),
      ephemeral: true,
    }).catch(() => {});
  },
};
