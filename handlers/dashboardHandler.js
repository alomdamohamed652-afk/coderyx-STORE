'use strict';

const db              = require('../core/database');
const registry        = require('../core/registry');
const permissions     = require('../core/permissions');
const cfg             = require('../config');
const dashEmbeds      = require('../core/dashboardEmbeds');
const dashComponents  = require('../core/dashboardComponents');

// ─────────────────────────────────────────
//   Dashboard Handler
//   إنشاء/تحديث لوحة الإدارة الثابتة
//   ولا يُنشئ أكثر من Dashboard واحدة في السيرفر
// ─────────────────────────────────────────

module.exports = {

  // ─── إنشاء/تحديث الـ Dashboard الرئيسية ───
  // يُستخدم عند تنفيذ /products

  async sendOrUpdate(interaction) {
    if (!permissions.isDashboardAdmin(interaction.member, cfg)) {
      return interaction.reply({ content: '❌ لا تملك صلاحية الوصول لهذه اللوحة.', ephemeral: true });
    }

    const existing = db.getDashboard();

    // محاولة تحديث الرسالة الموجودة فعليًا (لو موجودة في أي قناة بالسيرفر)
    if (existing) {
      try {
        const channel = await interaction.guild.channels.fetch(existing.channelId);
        const message = await channel.messages.fetch(existing.messageId);

        await message.edit({
          embeds: [dashEmbeds.overview()],
          components: dashComponents.mainDashboardButtons(),
        });

        // لو الأمر اتنفذ في قناة مختلفة عن مكان الـ Dashboard الأصلية
        if (channel.id !== interaction.channel.id) {
          return interaction.reply({
            content: `✅ لوحة الإدارة موجودة بالفعل في <#${channel.id}> وتم تحديثها.`,
            ephemeral: true,
          });
        }

        return interaction.reply({ content: '✅ تم تحديث لوحة الإدارة.', ephemeral: true });
      } catch {
        // الرسالة/القناة محذوفة — ننشئ واحدة جديدة بالأسفل
        db.clearDashboard();
      }
    }

    // إنشاء Dashboard جديدة
    const sent = await interaction.channel.send({
      embeds: [dashEmbeds.overview()],
      components: dashComponents.mainDashboardButtons(),
    });

    db.saveDashboard(interaction.channel.id, sent.id);

    return interaction.reply({ content: '✅ تم إنشاء لوحة الإدارة في هذه القناة.', ephemeral: true });
  },

  // ─── تحديث الـ Dashboard الرئيسية في مكانها (بعد أي تعديل منتج) ───

  async refreshMainDashboard(client) {
    const dashboard = db.getDashboard();
    if (!dashboard) return;

    try {
      const channel = await client.channels.fetch(dashboard.channelId);
      const message = await channel.messages.fetch(dashboard.messageId);
      await message.edit({
        embeds: [dashEmbeds.overview()],
        components: dashComponents.mainDashboardButtons(),
      });
    } catch (err) {
      console.warn('[dashboardHandler] فشل تحديث اللوحة الرئيسية:', err.message);
    }
  },

  // ─── التحقق من الصلاحية + جلب المنتج (Helper مشترك) ───

  checkAccess(interaction) {
    if (!permissions.isDashboardAdmin(interaction.member, cfg)) {
      interaction.reply({ content: '❌ لا تملك صلاحية الوصول لهذه اللوحة.', ephemeral: true });
      return false;
    }
    return true;
  },

  // ─── أزرار التنقل الرئيسية ───

  async handleAddProduct(interaction) {
    if (!this.checkAccess(interaction)) return;
    const wizardHandler = require('./productWizardHandler');
    return wizardHandler.start(interaction);
  },

  async handleEditProduct(interaction) {
    if (!this.checkAccess(interaction)) return;

    await interaction.reply({
      content: 'اختر المنتج الذي تريد تعديله:',
      components: [dashComponents.productSelectForEdit()],
      ephemeral: true,
    });
  },

  async handleViewProducts(interaction) {
    if (!this.checkAccess(interaction)) return;

    await interaction.reply({
      embeds: [dashEmbeds.adminProductList()],
      ephemeral: true,
    });
  },

  async handleStatistics(interaction) {
    if (!this.checkAccess(interaction)) return;

    await interaction.reply({
      embeds: [dashEmbeds.statistics()],
      ephemeral: true,
    });
  },

  async handlePaymentMethods(interaction) {
    const paymentAdminHandler = require('./paymentAdminHandler');
    return paymentAdminHandler.open(interaction);
  },

  async handleSettings(interaction) {
    if (!this.checkAccess(interaction)) return;

    await interaction.reply({
      content:
        '⚙️ **إعدادات Dashboard**\n\n' +
        `رتب الإدارة المخوّلة: ${cfg.roles.dashboard.length > 0 ? cfg.roles.dashboard.map(r => `<@&${r}>`).join(', ') : 'Owner فقط'}\n` +
        `عدد المنتجات: ${registry.count()}`,
      ephemeral: true,
    });
  },

  // ─── اختيار منتج من القائمة → عرض لوحته الخاصة ───

  async handleProductSelected(interaction) {
    if (!this.checkAccess(interaction)) return;

    const productId = interaction.values[0];
    if (productId === 'none') {
      return interaction.update({ content: 'لا توجد منتجات لعرضها.', components: [] });
    }

    const product = registry.getById(productId);
    if (!product) {
      return interaction.update({ content: '❌ المنتج غير موجود (قد يكون تم حذفه).', components: [] });
    }

    await interaction.update({
      content: null,
      embeds: [dashEmbeds.productDashboard(product)],
      components: dashComponents.productControlButtons(product),
    });
  },

  // ─── الرجوع لقائمة الاختيار من داخل لوحة منتج ───

  async handleBackToList(interaction) {
    if (!this.checkAccess(interaction)) return;

    await interaction.update({
      content: 'اختر المنتج الذي تريد تعديله:',
      embeds: [],
      components: [dashComponents.productSelectForEdit()],
    });
  },

  // ─── تحديث لوحة منتج واحد في مكانها بعد أي تعديل ───

  async refreshProductView(interaction, productId) {
    const product = registry.getById(productId);
    if (!product) {
      return interaction.editReply({ content: '❌ المنتج غير موجود.', embeds: [], components: [] }).catch(() => {});
    }

    await interaction.editReply({
      content: null,
      embeds: [dashEmbeds.productDashboard(product)],
      components: dashComponents.productControlButtons(product),
    }).catch(() => {});
  },
};
