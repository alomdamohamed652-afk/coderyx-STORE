'use strict';

const { EmbedBuilder } = require('discord.js');
const cfg = require('../config');

function clean(value, fallback='—') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value).slice(0, 1024);
}

async function resolveName(client, id, fallback='غير معروف') {
  if (!id) return fallback;
  try {
    const user = await client.users.fetch(id);
    return user.globalName || user.username || fallback;
  } catch {
    return fallback;
  }
}

module.exports = {
  async log(client, { action, actorId=null, ticket=null, order=null, details={} }) {
    if (!cfg.channels.auditLog) return;
    try {
      const channel = await client.channels.fetch(cfg.channels.auditLog);
      if (!channel) return;

      const actorName = await resolveName(client, actorId, 'النظام');
      const customerId = ticket?.userId || order?.customer?.discordId;
      const staffId = ticket?.claimedBy || null;

      const embed = new EmbedBuilder()
        .setColor(cfg.branding.color)
        .setTitle('🛡️ Audit Log')
        .setDescription(`**${clean(action)}**`)
        .addFields(
          { name: '👤 المنفذ', value: actorId ? `<@${actorId}> • ${clean(actorName)}` : 'النظام', inline: true },
          { name: '🎫 التذكرة', value: ticket ? `#${clean(ticket.displayNumber)} • ${clean(ticket.type)}` : '—', inline: true },
          { name: '🧾 الطلب', value: order?.id ? `\`${clean(order.id)}\`` • ${clean(order.status)}` : '—', inline: true },
          { name: '👥 العميل', value: customerId ? `<@${customerId}>` : '—', inline: true },
          { name: '👨‍💼 المسؤول', value: staffId ? `<@${staffId}>` : '—', inline: true },
          { name: '📌 التفاصيل', value: Object.entries(details).map(([k,v]) => `**${k}:** ${clean(v)}`).join('\n').slice(0,1024) || '—', inline: false },
        )
        .setFooter({ text: cfg.branding.footer + ' • Audit' })
        .setTimestamp();

      await channel.send({
        embeds: [embed],
        allowedMentions: { users: [actorId, customerId, staffId].filter(Boolean) },
      });
    } catch (err) {
      console.warn('[audit] فشل إرسال Audit Log:', err.message);
    }
  }
};
