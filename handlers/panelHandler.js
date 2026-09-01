'use strict';

const embeds     = require('../core/embeds');
const components = require('../core/components');
const db          = require('../core/database');

// ─────────────────────────────────────────
//   Panel
//   إرسال إيمبيد المتجر — العميل يختار
//   نوع التذكرة من القائمة مباشرة في البانل
//   يُستخدم عبر: /panel أو !panel
// ─────────────────────────────────────────

module.exports = {

  // عبر Prefix Command (!panel)
  async send(message) {
    message.delete().catch(() => {});

    const sent = await message.channel.send({
      embeds:     [embeds.panel()],
      components: [components.panelMenu()],
    });

    db.savePanelMessage(message.channel.id, sent.id);
  },

  // عبر Slash Command (/panel)
  async sendSlash(interaction) {
    const sent = await interaction.channel.send({
      embeds:     [embeds.panel()],
      components: [components.panelMenu()],
    });

    db.savePanelMessage(interaction.channel.id, sent.id);

    await interaction.reply({
      content: '✅ تم إرسال البانل في هذه القناة.',
      ephemeral: true,
    });
  },

  /**
   * يعيد إرسال البانل كرسالة جديدة نظيفة (قائمة بدون أي اختيار محدد)
   * ويحذف الرسالة القديمة إن وُجدت — أكثر ثباتًا من تعديل الرسالة في مكانها
   */
  async refresh(channel) {
    const oldMessageId = db.getPanelMessage(channel.id);

    const sent = await channel.send({
      embeds:     [embeds.panel()],
      components: [components.panelMenu()],
    });

    db.savePanelMessage(channel.id, sent.id);

    if (oldMessageId && oldMessageId !== sent.id) {
      try {
        const oldMessage = await channel.messages.fetch(oldMessageId);
        await oldMessage.delete();
      } catch {
        // الرسالة القديمة محذوفة بالفعل أو غير موجودة — تجاهل
      }
    }
  },
};
