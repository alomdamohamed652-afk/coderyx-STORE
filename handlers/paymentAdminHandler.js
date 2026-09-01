'use strict';

const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const paymentMethods = require('../config/paymentMethods');
const permissions = require('../core/permissions');
const cfg = require('../config');

function allowed(interaction) {
  return permissions.isDashboardAdmin(interaction.member, cfg);
}

function methodId(customId, prefix) {
  return customId.slice(prefix.length);
}

module.exports = {
  async open(interaction) {
    if (!allowed(interaction)) return interaction.reply({ content: '❌ لا تملك صلاحية إدارة طرق الدفع.', ephemeral: true });
    const methods = paymentMethods.getAllIncludingInactive();
    const lines = methods.map((m, i) => `${i + 1}. ${m.emoji} **${m.label}** — ${m.active === false ? '🔴 معطلة' : '🟢 مفعلة'}`).join('\n') || 'لا توجد طرق دفع.';
    return interaction.reply({
      embeds: [{
        color: cfg.branding.color,
        title: '💳 إدارة طرق الدفع',
        description: 'يمكنك إضافة وتعديل وتفعيل وتعطيل طرق الدفع من هنا بدون تعديل ملفات الإعدادات.\n\n' + lines,
        footer: { text: cfg.branding.footer },
      }],
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('payment_select')
            .setPlaceholder('اختر طريقة دفع لإدارتها...')
            .addOptions(methods.length ? methods.slice(0, 25).map(m => ({
              label: m.label.slice(0, 100),
              value: m.id,
              emoji: m.emoji,
              description: m.active === false ? 'معطلة' : 'مفعلة',
            })) : [{ label: 'لا توجد طرق دفع', value: 'none' }]),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('payment_add').setLabel('➕ إضافة طريقة').setStyle(ButtonStyle.Success),
        ),
      ],
      ephemeral: true,
    });
  },

  async openAdd(interaction) {
    if (!allowed(interaction)) return interaction.reply({ content: '❌ لا تملك صلاحية إدارة طرق الدفع.', ephemeral: true });
    const modal = new ModalBuilder().setCustomId('payment_modal_add').setTitle('إضافة طريقة دفع');
    const id = new TextInputBuilder().setCustomId('payment_id').setLabel('المعرّف الداخلي (إنجليزي)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('vodafone_cash');
    const label = new TextInputBuilder().setCustomId('payment_label').setLabel('اسم طريقة الدفع').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('فودافون كاش');
    const emoji = new TextInputBuilder().setCustomId('payment_emoji').setLabel('الإيموجي').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('🔴');
    const instructions = new TextInputBuilder().setCustomId('payment_instructions').setLabel('تعليمات الدفع').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('بيانات التحويل التي تظهر للعميل');
    modal.addComponents(
      new ActionRowBuilder().addComponents(id),
      new ActionRowBuilder().addComponents(label),
      new ActionRowBuilder().addComponents(emoji),
      new ActionRowBuilder().addComponents(instructions),
    );
    return interaction.showModal(modal);
  },

  async submitAdd(interaction) {
    if (!allowed(interaction)) return interaction.reply({ content: '❌ لا تملك صلاحية إدارة طرق الدفع.', ephemeral: true });
    const id = interaction.fields.getTextInputValue('payment_id').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const label = interaction.fields.getTextInputValue('payment_label').trim();
    const emoji = interaction.fields.getTextInputValue('payment_emoji').trim() || '💳';
    const instructions = interaction.fields.getTextInputValue('payment_instructions').trim();
    if (!id || !label) return interaction.reply({ content: '❌ المعرّف والاسم مطلوبان.', ephemeral: true });
    try {
      paymentMethods.add({ id, label, emoji, instructions });
      return interaction.reply({ content: `✅ تمت إضافة طريقة الدفع **${emoji} ${label}** وأصبحت متاحة فورًا.`, ephemeral: true });
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
    }
  },

  async select(interaction) {
    if (!allowed(interaction)) return interaction.reply({ content: '❌ لا تملك صلاحية إدارة طرق الدفع.', ephemeral: true });
    const id = interaction.values[0];
    const method = paymentMethods.get(id);
    if (!method) return interaction.reply({ content: '❌ طريقة الدفع غير موجودة.', ephemeral: true });
    return interaction.reply({
      content: `**${method.emoji} ${method.label}**\nالمعرّف: \`${method.id}\`\nالحالة: ${method.active === false ? '🔴 معطلة' : '🟢 مفعلة'}\nالتعليمات: ${method.instructions || '—'}`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`payment_edit_${id}`).setLabel('✏️ تعديل').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`payment_toggle_${id}`).setLabel(method.active === false ? '🟢 تفعيل' : '🟡 تعطيل').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`payment_delete_${id}`).setLabel('🗑️ حذف').setStyle(ButtonStyle.Danger),
        ),
      ],
      ephemeral: true,
    });
  },

  async edit(interaction) {
    if (!allowed(interaction)) return interaction.reply({ content: '❌ لا تملك صلاحية إدارة طرق الدفع.', ephemeral: true });
    const id = methodId(interaction.customId, 'payment_edit_');
    const method = paymentMethods.get(id);
    if (!method) return interaction.reply({ content: '❌ طريقة الدفع غير موجودة.', ephemeral: true });
    const modal = new ModalBuilder().setCustomId(`payment_modal_edit_${id}`).setTitle('تعديل طريقة الدفع');
    const label = new TextInputBuilder().setCustomId('payment_label').setLabel('اسم الطريقة').setStyle(TextInputStyle.Short).setRequired(true).setValue(method.label);
    const emoji = new TextInputBuilder().setCustomId('payment_emoji').setLabel('الإيموجي').setStyle(TextInputStyle.Short).setRequired(false).setValue(method.emoji);
    const instructions = new TextInputBuilder().setCustomId('payment_instructions').setLabel('تعليمات الدفع').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(method.instructions || '');
    modal.addComponents(new ActionRowBuilder().addComponents(label), new ActionRowBuilder().addComponents(emoji), new ActionRowBuilder().addComponents(instructions));
    return interaction.showModal(modal);
  },

  async submitEdit(interaction) {
    if (!allowed(interaction)) return interaction.reply({ content: '❌ لا تملك صلاحية إدارة طرق الدفع.', ephemeral: true });
    const id = methodId(interaction.customId, 'payment_modal_edit_');
    const label = interaction.fields.getTextInputValue('payment_label').trim();
    const emoji = interaction.fields.getTextInputValue('payment_emoji').trim() || '💳';
    const instructions = interaction.fields.getTextInputValue('payment_instructions').trim();
    if (!label) return interaction.reply({ content: '❌ الاسم مطلوب.', ephemeral: true });
    paymentMethods.update(id, { label, emoji, instructions });
    return interaction.reply({ content: `✅ تم تعديل طريقة الدفع **${emoji} ${label}**.`, ephemeral: true });
  },

  async toggle(interaction) {
    if (!allowed(interaction)) return interaction.reply({ content: '❌ لا تملك صلاحية إدارة طرق الدفع.', ephemeral: true });
    const id = methodId(interaction.customId, 'payment_toggle_');
    const method = paymentMethods.toggle(id);
    if (!method) return interaction.reply({ content: '❌ طريقة الدفع غير موجودة.', ephemeral: true });
    return interaction.reply({ content: `${method.active ? '🟢 تم تفعيل' : '🟡 تم تعطيل'} **${method.label}**.`, ephemeral: true });
  },

  async remove(interaction) {
    if (!allowed(interaction)) return interaction.reply({ content: '❌ لا تملك صلاحية إدارة طرق الدفع.', ephemeral: true });
    const id = methodId(interaction.customId, 'payment_delete_');
    const method = paymentMethods.get(id);
    if (!method) return interaction.reply({ content: '❌ طريقة الدفع غير موجودة.', ephemeral: true });
    paymentMethods.remove(id);
    return interaction.reply({ content: `🗑️ تم حذف طريقة الدفع **${method.label}**.`, ephemeral: true });
  },
};
