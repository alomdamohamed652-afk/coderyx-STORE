'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const registry     = require('../core/registry');
const permissions  = require('../core/permissions');
const cfg = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reload')
    .setDescription('إعادة تحميل جميع المنتجات بدون إعادة تشغيل البوت')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!permissions.isOwner(interaction.member, cfg)) {
      return interaction.reply({ content: '❌ هذا الأمر للمالك فقط.', ephemeral: true });
    }

    registry.load();
    await interaction.reply({
      content: `✅ تم إعادة تحميل ${registry.count()} منتج`,
      ephemeral: true,
    });
  },
};
