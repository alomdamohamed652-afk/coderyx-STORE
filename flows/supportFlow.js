'use strict';

const embeds      = require('../core/embeds');
const cfg          = require('../config');
const permissions  = require('../core/permissions');

// ─────────────────────────────────────────
//   Support Flow
//   دعم فني / استفسار / تطوير خاص / بلاغ
// ─────────────────────────────────────────

module.exports = {

  async start(interaction, type, extraComponents = []) {
    const user = interaction.user;

    const message = await interaction.channel.send({
      embeds: [embeds.ticketOpenedByType(user, type)],
      components: extraComponents,
    });

    // تطوير خاص → فريق التطوير | باقي الأنواع → فريق الدعم
    const roleIds = type === 'custom_dev' ? cfg.roles.dev : cfg.roles.support;
    const mention = permissions.mentionRoles(interaction.guild, roleIds);

    if (mention) {
      // لا حاجة لانتظارها — رسالة منشن مستقلة عن أي خطوة تالية
      interaction.channel.send({ content: `${mention} تذكرة جديدة من ${user}` }).catch(() => {});
    } else {
      console.warn(`[supportFlow] ⚠️ لا توجد رتب صالحة للمنشن لنوع: ${type}`);
    }

    return message;
  },
};
