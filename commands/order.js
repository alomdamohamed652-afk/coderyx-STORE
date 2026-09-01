'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db           = require('../core/database');
const registry      = require('../core/registry');
const embeds        = require('../core/embeds');
const permissions   = require('../core/permissions');
const cfg = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('order')
    .setDescription('عرض تفاصيل طلب معين')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('id')
        .setDescription('رقم الطلب — مثال: ORD-0001')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!permissions.isOwner(interaction.member, cfg) && !permissions.isDev(interaction.member, cfg)) {
      return interaction.reply({ content: '❌ هذا الأمر لفريق التطوير فقط.', ephemeral: true });
    }

    const orderId = interaction.options.getString('id').toUpperCase();
    const order = db.getOrder(orderId);

    if (!order) {
      return interaction.reply({
        embeds: [embeds.error(`الأوردر \`${orderId}\` غير موجود.`)],
        ephemeral: true,
      });
    }

    const product = registry.getById(order.product?.id);
    const plan    = product?.plans[parseInt(order.product?.planId, 10)];

    await interaction.reply({
      embeds: [embeds.orderSummary(
        order,
        product ?? { name: order.product?.id },
        plan ?? { name: order.product?.planId, price: '?', currency: '' }
      )],
      ephemeral: true,
    });
  },
};
