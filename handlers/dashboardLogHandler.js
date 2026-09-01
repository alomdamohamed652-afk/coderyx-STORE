'use strict';

const { EmbedBuilder } = require('discord.js');
const cfg = require('../config');

// ─────────────────────────────────────────
//   Dashboard Log Handler
//   يسجّل كل عملية تُنفَّذ من لوحة إدارة
//   المنتجات: مين عملها، إيه بالتحديد، وفي
//   أي منتج، مع القيمة القديمة والجديدة لو وُجدت
// ─────────────────────────────────────────

const B = cfg.branding;

// تسميات عربية واضحة لكل نوع عملية (تُستخدم في عنوان اللوج)
const ACTION_LABELS = {
  create_product:        '➕ إنشاء منتج جديد',
  delete_product:        '🗑️ حذف منتج',
  toggle_availability:   '🟢/🛠️ تغيير الإتاحة',
  toggle_visibility:     '👁️/🔴 تغيير الظهور',
  change_badge:          '🏷️ تغيير Badge',
  edit_name:             '✏️ تعديل الاسم',
  edit_description:      '📝 تعديل الوصف',
  edit_price:            '💰 تعديل السعر',
  edit_color:            '🎨 تعديل اللون',
  edit_version:          '🔄 تعديل الإصدار',
  edit_images:           '🖼️ تعديل الصور',
  edit_features:         '⭐ تعديل المميزات',
  add_plan:              '📦 إضافة باقة',
  edit_plan:             '📦 تعديل باقة',
  move_order:            '↕️ تغيير الترتيب',
};

module.exports = {

  /**
   * يسجّل عملية إدارية في قناة DASHBOARD_LOG_CHANNEL_ID
   * @param {Client} client
   * @param {object} params
   * @param {User} params.actor - من قام بالعملية
   * @param {string} params.action - مفتاح من ACTION_LABELS
   * @param {object} [params.product] - المنتج المتأثر (لو وُجد)
   * @param {string} [params.before] - القيمة القديمة (نص قصير)
   * @param {string} [params.after] - القيمة الجديدة (نص قصير)
   * @param {string} [params.note] - ملاحظة إضافية حرة
   */
  async log(client, { actor, action, product = null, before = null, after = null, note = null }) {
    if (!cfg.channels.dashboardLog) {
      console.warn('[dashboardLogHandler] ⚠️ DASHBOARD_LOG_CHANNEL_ID غير محدد — لم يُسجَّل اللوج في أي قناة');
      return;
    }

    try {
      const title = ACTION_LABELS[action] ?? action;

      // التحقق من صحة رابط الصورة قبل استخدامه (يمنع كراش لو رجعت قيمة غير صالحة)
      let iconURL;
      try {
        const rawIcon = actor.displayAvatarURL?.();
        if (rawIcon) { new URL(rawIcon); iconURL = rawIcon; }
      } catch {
        iconURL = undefined;
      }

      const embed = new EmbedBuilder()
        .setColor(B.color)
        .setAuthor({ name: actor.tag ?? actor.username, iconURL })
        .setTitle(title)
        .setFooter({ text: B.footer })
        .setTimestamp();

      const fields = [];

      if (product) {
        fields.push({ name: '📦 المنتج', value: `${product.name} (\`${product.id}\`)`, inline: true });
      }
      fields.push({ name: '👤 بواسطة', value: `<@${actor.id}>`, inline: true });

      if (before !== null || after !== null) {
        const changeText = before !== null && after !== null
          ? `\`${before}\` ➡️ \`${after}\``
          : after !== null
            ? `\`${after}\``
            : `\`${before}\``;
        fields.push({ name: '🔄 التغيير', value: changeText });
      }

      if (note) {
        fields.push({ name: '📋 تفاصيل', value: note });
      }

      if (fields.length > 0) embed.addFields(...fields);

      const channel = await client.channels.fetch(cfg.channels.dashboardLog);
      await channel.send({ embeds: [embed] });
    } catch (err) {
      // أي خطأ هنا (بناء الإيمبيد، جلب القناة، الإرسال) لا يجب أن يكسر عملية الـ Dashboard الأساسية
      console.error('[dashboardLogHandler] فشل تسجيل اللوج:', err.message);
    }
  },
};
