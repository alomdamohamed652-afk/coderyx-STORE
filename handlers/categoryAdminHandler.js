'use strict';

const { EmbedBuilder } = require('discord.js');
const cfg = require('../config');
const permissions = require('../core/permissions');
const categoryRegistry = require('../core/categoryRegistry');

function tree(parentId = null, depth = 0, lines = []) {
  for (const category of categoryRegistry.getChildren(parentId)) {
    lines.push(`${'  '.repeat(depth)}${category.emoji || '📁'} **${category.name}** — \`${category.id}\``);
    tree(category.id, depth + 1, lines);
  }
  return lines;
}

function view() {
  const lines = tree();
  return new EmbedBuilder()
    .setColor(cfg.branding.color)
    .setTitle('📁 إدارة فئات المنتجات')
    .setDescription(lines.length
      ? 'الفئات الحالية (يمكنك إنشاء فئة داخل فئة):\\n\\n' + lines.join('\\n')
      : 'لا توجد فئات حتى الآن. ابدأ بإنشاء أول فئة.')
    .addFields({
      name: '💡 مثال',
      value: 'FiveM → Police → Emergency Systems\\nويمكنك وضع المنتجات داخل أي مستوى.',
    })
    .setFooter({ text: cfg.branding.footer })
    .setTimestamp();
}

module.exports = {
  check(interaction) {
    return permissions.isDashboardAdmin(interaction.member, cfg);
  },

  async open(interaction) {
    if (!this.check(interaction)) return interaction.reply({ content: '❌ لوحة الفئات متاحة للإدارة فقط.', ephemeral: true });
    return interaction.reply({
      embeds: [view()],
      components: require('../core/components').categoryAdminButtons(),
      ephemeral: true,
    });
  },

  async refresh(interaction) {
    if (!this.check(interaction)) return interaction.reply({ content: '❌ لا تملك الصلاحية.', ephemeral: true });
    return interaction.update({
      embeds: [view()],
      components: require('../core/components').categoryAdminButtons(),
    });
  },

  async add(interaction) {
    if (!this.check(interaction)) return interaction.reply({ content: '❌ لا تملك الصلاحية.', ephemeral: true });
    return interaction.showModal(require('../core/components').categoryAddModal());
  },

  async submitAdd(interaction) {
    if (!this.check(interaction)) return interaction.reply({ content: '❌ لا تملك الصلاحية.', ephemeral: true });

    const name = interaction.fields.getTextInputValue('category_name').trim();
    const parentPath = interaction.fields.getTextInputValue('category_parent')?.trim() || '';
    const emoji = interaction.fields.getTextInputValue('category_emoji')?.trim() || '📁';

    try {
      let parentId = null;
      if (parentPath) {
        const parent = categoryRegistry.findByPath(parentPath);
        if (!parent) return interaction.reply({ content: '❌ مسار الفئة الأب غير موجود. استخدم الاسم أو المسار الصحيح كما يظهر في لوحة الفئات.', ephemeral: true });
        parentId = parent.id;
      }

      const category = categoryRegistry.create({ name, parentId, emoji });
      await require('./dashboardHandler').refreshMainDashboard(interaction.client);

      return interaction.reply({
        content: `✅ تم إنشاء الفئة **${category.name}**${parentId ? ' داخل الفئة الأب.' : ' كفئة رئيسية.'}`,
        ephemeral: true,
      });
    } catch (err) {
      return interaction.reply({ content: `❌ تعذر إنشاء الفئة: ${err.message}`, ephemeral: true });
    }
  },

  renderEmbed: view,
};
