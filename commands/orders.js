'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db           = require('../core/database');
const embeds       = require('../core/embeds');
const permissions  = require('../core/permissions');
const orderStatus  = require('../core/orderStatus');
const cfg = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('orders')
    .setDescription('عرض آخر 10 طلبات')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!permissions.isOwner(interaction.member, cfg) && !permissions.isDev(interaction.member, cfg)) {
      return interaction.reply({ content: '❌ هذا الأمر لفريق التطوير فقط.', ephemeral: true });
    }

    const raw    = db._read();
    const orders = Object.values(raw.orders ?? {});

    if (orders.length === 0) {
      return interaction.reply({
        embeds: [embeds.info('لا توجد أوردرات', 'لم يتم إنشاء أي طلب حتى الآن.')],
        ephemeral: true,
      });
    }

    const recent = orders.slice(-10).reverse();

    const lines = recent.map(o => {
      const emoji = orderStatus.emoji(o.status);
      const date  = new Date(o.createdAt).toLocaleDateString('ar-SA');
      const paidTag = o.payment?.paid ? ' 💳' : '';
      return `${emoji} \`${o.id}\` — **${o.product?.id ?? '?'}** — ${o.customer?.username ?? '?'} — ${date}${paidTag}`;
    }).join('\n');

    await interaction.reply({
      embeds: [embeds.info(`📋 آخر ${recent.length} طلب`, lines)],
      ephemeral: true,
    });
  },
};
