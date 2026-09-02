'use strict';

const db              = require('../core/database');
const registry        = require('../core/registry');
const permissions     = require('../core/permissions');
const cfg             = require('../config');
const dashEmbeds      = require('../core/dashboardEmbeds');
const dashComponents  = require('../core/dashboardComponents');
const categories       = require('../core/categoryRegistry');

const pendingCategoryAdds = new Map();

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

  async handleCategoryAddModal(interaction) {
    if (!this.checkAccess(interaction)) return;
    const name = interaction.fields.getTextInputValue('category_name').trim();
    if (!name) return interaction.reply({ content: '❌ اسم التصنيف لا يمكن أن يكون فارغًا.', ephemeral: true });

    pendingCategoryAdds.set(interaction.user.id, { name, createdAt: Date.now() });
    const all = categories.getAllCategories();

    return interaction.reply({
      content: `📁 **إضافة تصنيف جديد: ${name}**\\nاختر المستوى الأب للتصنيف. يمكنك اختيار **عام** لإنشائه كتصنيف رئيسي.`,
      components: [require('../core/dashboardComponents').categoryParentSelect(all)],
      ephemeral: true,
    });
  },

  async handleCategoryParentSelect(interaction) {
    if (!this.checkAccess(interaction)) return;
    const pending = pendingCategoryAdds.get(interaction.user.id);
    if (!pending) return interaction.reply({ content: '❌ انتهت جلسة إضافة التصنيف. اضغط إضافة تصنيف من جديد.', ephemeral: true });

    const parentId = interaction.values[0] === 'root' ? null : interaction.values[0];
    const parent = parentId ? categories.getById(parentId) : null;
    if (parentId && !parent) {
      pendingCategoryAdds.delete(interaction.user.id);
      return interaction.reply({ content: '❌ التصنيف الأب غير موجود.', ephemeral: true });
    }

    try {
      const path = parent ? [...parent.path, pending.name] : [pending.name];
      const created = categories.ensurePath(path);
      pendingCategoryAdds.delete(interaction.user.id);

      const dashboardLogHandler = require('./dashboardLogHandler');
      await dashboardLogHandler.log(interaction.client, {
        actor: interaction.user,
        action: 'create_category',
        before: '—',
        after: `${created.id} • ${created.pathKey}`,
      });

      return interaction.update({
        content: `✅ تم إنشاء التصنيف **${created.name}**\\n🆔 ${created.id}\\n📁 ${created.pathKey}`,
        components: [require('../core/dashboardComponents').categoryManagementButtons()],
        embeds: [dashEmbeds.categories()],
      });
    } catch (err) {
      return interaction.update({ content: `❌ تعذر إنشاء التصنيف: ${err.message}` }).catch(() => {});
    }
  },

  async handleCategories(interaction) {
    if (!this.checkAccess(interaction)) return;
    const all = categories.getAllCategories();
    return interaction.reply({
      embeds: [dashEmbeds.categories()],
      components: [
        require('../core/dashboardComponents').categoryManagementButtons(),
        require('../core/dashboardComponents').categoryManageSelect(all),
      ],
      ephemeral: true,
    });
  },

  async handleCategoryManageSelect(interaction) {
    if (!this.checkAccess(interaction)) return;
    const id = interaction.values[0];
    if (id === 'none') return interaction.update({ content: 'لا توجد تصنيفات لإدارتها.' });

    const category = categories.getById(id);
    if (!category) return interaction.update({ content: '❌ التصنيف غير موجود.', components: [] });

    return interaction.update({
      content: `📁 **${category.name}**\\n🆔 ${category.id}\\n📍 ${category.pathKey}\\n📦 المنتجات: ${categories.getProducts(category.id).length}`,
      embeds: [dashEmbeds.categories()],
      components: [
        new (require('discord.js').ActionRowBuilder)().addComponents(
          new (require('discord.js').ButtonBuilder)().setCustomId(`dash_category_edit_${category.id}`).setLabel('✏️ تعديل الاسم').setStyle(require('discord.js').ButtonStyle.Primary),
          new (require('discord.js').ButtonBuilder)().setCustomId(`dash_category_delete_${category.id}`).setLabel('🗑️ حذف').setStyle(require('discord.js').ButtonStyle.Danger),
        ),
        require('../core/dashboardComponents').categoryManagementButtons(),
        require('../core/dashboardComponents').categoryManageSelect(categories.getAllCategories()),
      ],
    });
  },

  async openCategoryEdit(interaction) {
    if (!this.checkAccess(interaction)) return;
    const id = interaction.customId.replace('dash_category_edit_', '');
    const category = categories.getById(id);
    if (!category) return interaction.reply({ content: '❌ التصنيف غير موجود.', ephemeral: true });
    return interaction.showModal(require('../core/dashboardComponents').categoryEditModal(category));
  },

  async handleCategoryEditModal(interaction) {
    if (!this.checkAccess(interaction)) return;
    const id = interaction.customId.replace('dash_modal_category_edit_', '');
    const category = categories.getById(id);
    if (!category) return interaction.reply({ content: '❌ التصنيف غير موجود.', ephemeral: true });
    const name = interaction.fields.getTextInputValue('category_name').trim();
    if (!name) return interaction.reply({ content: '❌ الاسم الجديد غير صحيح.', ephemeral: true });

    try {
      await interaction.deferReply({ ephemeral: true });
      const updated = categories.rename(id, name);
      const dashboardLogHandler = require('./dashboardLogHandler');
      await dashboardLogHandler.log(interaction.client, {
        actor: interaction.user,
        action: 'rename_category',
        before: `${category.id} • ${category.pathKey}`,
        after: `${updated.id} • ${updated.pathKey}`,
      });
      await this.refreshMainDashboard(interaction.client);
      return interaction.editReply({
        content: `✅ تم تعديل التصنيف إلى **${updated.name}**\\n🆔 ${updated.id}\\n📍 ${updated.pathKey}`,
        embeds: [dashEmbeds.categories()],
        components: [require('../core/dashboardComponents').categoryManagementButtons(), require('../core/dashboardComponents').categoryManageSelect(categories.getAllCategories())],
      });
    } catch (err) {
      return interaction.editReply({ content: `❌ فشل تعديل التصنيف: ${err.message}` }).catch(() => {});
    }
  },

  async openCategoryDelete(interaction) {
    if (!this.checkAccess(interaction)) return;
    const id = interaction.customId.replace('dash_category_delete_', '');
    const category = categories.getById(id);
    if (!category) return interaction.reply({ content: '❌ التصنيف غير موجود.', ephemeral: true });
    return interaction.reply({
      content: `⚠️ سيتم حذف **${category.pathKey}** وجميع التصنيفات الفرعية.\\nالمنتجات التابعة لها ستُنقل تلقائيًا إلى **عام**.`,
      components: [require('../core/dashboardComponents').categoryDeleteConfirm(category)],
      ephemeral: true,
    });
  },

  async confirmCategoryDelete(interaction) {
    if (!this.checkAccess(interaction)) return;
    const id = interaction.customId.replace('dash_category_delete_confirm_', '');
    try {
      await interaction.deferUpdate();
      const result = categories.deleteCategory(id);
      await require('./dashboardLogHandler').log(interaction.client, {
        actor: interaction.user,
        action: 'delete_category',
        before: `${result.deletedId} • ${result.deletedPath.join(' > ')}`,
        after: `حذف ${result.deletedCount} تصنيف ونقل ${result.movedProducts.length} منتج إلى عام`,
      });
      await this.refreshMainDashboard(interaction.client);
      return interaction.editReply({
        content: `🗑️ تم حذف **${result.deletedPath.join(' > ')}**.\\n📦 تم نقل ${result.movedProducts.length} منتج إلى **عام**.`,
        embeds: [dashEmbeds.categories()],
        components: [require('../core/dashboardComponents').categoryManagementButtons(), require('../core/dashboardComponents').categoryManageSelect(categories.getAllCategories())],
      });
    } catch (err) {
      return interaction.editReply({ content: `❌ فشل حذف التصنيف: ${err.message}` }).catch(() => {});
    }
  },

  async cancelCategoryDelete(interaction) {
    if (!this.checkAccess(interaction)) return;
    return interaction.update({
      content: '↩️ تم إلغاء حذف التصنيف.',
      components: [require('../core/dashboardComponents').categoryManagementButtons(), require('../core/dashboardComponents').categoryManageSelect(categories.getAllCategories())],
    });
  },

  async toggleCategoryDisplayMode(interaction) {
    if (!this.checkAccess(interaction)) return;
    const next = categories.getDisplayMode() === 'grouped' ? 'categories_only' : 'grouped';
    categories.setDisplayMode(next);
    return interaction.update({
      content: `🖥️ طريقة عرض المتجر الآن: **${next === 'grouped' ? 'التصنيفات + المنتجات' : 'التصنيفات فقط'}**`,
      embeds: [dashEmbeds.categories()],
      components: [require('../core/dashboardComponents').categoryManagementButtons(), require('../core/dashboardComponents').categoryManageSelect(categories.getAllCategories())],
    });
  },

  async handleProductCategorySelect(interaction) {
    if (!this.checkAccess(interaction)) return;
    const productId = interaction.customId.replace('dash_product_category_select_', '');
    const product = registry.getById(productId);
    if (!product) return interaction.update({ content: '❌ المنتج غير موجود.', components: [] });

    const value = interaction.values[0];
    if (value === 'none') {
      registry.save(productId, { categoryId: null, categoryPath: ['عام'], category: 'عام' });
    } else {
      const category = categories.getById(value);
      if (!category) return interaction.update({ content: '❌ التصنيف غير موجود.', components: [] });
      registry.save(productId, { categoryId: category.id, categoryPath: category.path, category: category.pathKey });
    }

    const updated = registry.getById(productId);
    await this.refreshMainDashboard(interaction.client);
    return interaction.update({
      content: `✅ تم تحديث تصنيف **${updated.name}** إلى: **${updated.category || 'عام'}**`,
      embeds: [dashEmbeds.productDashboard(updated)],
      components: dashComponents.productControlButtons(updated),
    });
  },

  async openProductCategorySelector(interaction) {
    if (!this.checkAccess(interaction)) return;
    const productId = interaction.customId.replace('dash_p_category_', '');
    const product = registry.getById(productId);
    if (!product) return interaction.reply({ content: '❌ المنتج غير موجود.', ephemeral: true });
    return interaction.reply({
      content: `🗂️ **تصنيف المنتج: ${product.name}**\\nاختر التصنيف من القائمة بدل كتابة الاسم يدويًا.`,
      components: [dashComponents.productCategorySelect(productId, categories.getAllCategories())],
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
        `رتب الإدارة المخوّلة: ${cfg.roles.admin.length > 0 ? cfg.roles.admin.map(r => `<@&${r}>`).join(', ') : 'Owner فقط'}\n` +
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
