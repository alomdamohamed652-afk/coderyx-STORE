'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const dashboardHandler = require('../handlers/dashboardHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('products')
    .setDescription('إنشاء/تحديث لوحة إدارة المنتجات (Dashboard)')
    // إخفاء الأمر افتراضيًا عن الأعضاء العاديين — يظهر فقط لمن يملك صلاحية إدارة السيرفر
    // (التحقق الدقيق من الرتب المخصصة في DASHBOARD_ROLE_IDS يتم داخل الكود نفسه)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await dashboardHandler.sendOrUpdate(interaction);
  },
};
