'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const panelHandler = require('../handlers/panelHandler');
const permissions  = require('../core/permissions');
const cfg = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('إرسال إيمبيد متجر Codryx في هذه القناة')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (cfg.roles.owner.length === 0) {
      console.warn('[panel] OWNER_ROLE_IDS غير محدد في .env');
      return interaction.reply({
        content: '⚠️ لم يتم تحديد `OWNER_ROLE_IDS` في ملف .env. تواصل مع المطور.',
        ephemeral: true,
      });
    }

    if (!permissions.isOwner(interaction.member, cfg)) {
      return interaction.reply({ content: '❌ هذا الأمر للمالك فقط.', ephemeral: true });
    }

    await panelHandler.sendSlash(interaction);
  },
};
