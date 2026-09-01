'use strict';

const { EmbedBuilder } = require('discord.js');
const cfg = require('../config');
const db  = require('../core/database');

// ─────────────────────────────────────────
//   Customers Channel Handler
//   يعرض كل العملاء اللي أتموا الشراء
//   مع عدد طلباتهم وإجمالي ما دفعوه
//   في رسالة واحدة دائمة تُحدَّث في مكانها
// ─────────────────────────────────────────

const B = cfg.branding;

module.exports = {

  /**
   * يبني الإيمبيد الكامل لقائمة العملاء، مرتبة تنازليًا حسب الإجمالي المدفوع
   */
  buildEmbed() {
    const raw = db._read();
    const orders = Object.values(raw.orders ?? {}).filter(o => o.payment?.paid);

    if (orders.length === 0) {
      return new EmbedBuilder()
        .setColor(B.color)
        .setTitle('👥 عملاء Codryx')
        .setDescription('_لا يوجد عملاء بعد._')
        .setFooter({ text: B.footer })
        .setTimestamp();
    }

    // تجميع حسب العميل
    const byCustomer = new Map();
    for (const order of orders) {
      const id = order.customer.discordId;
      if (!byCustomer.has(id)) {
        byCustomer.set(id, {
          discordId: id,
          username: order.customer.username,
          totalOrders: 0,
          totalSpent: 0,
        });
      }
      const entry = byCustomer.get(id);
      entry.totalOrders += 1;
      entry.totalSpent  += order.payment?.finalPrice ?? 0;
    }

    const sorted = [...byCustomer.values()].sort((a, b) => b.totalSpent - a.totalSpent);

    const lines = sorted.slice(0, 25).map((c, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      return `${medal} <@${c.discordId}> — **${c.totalOrders}** طلب — **${c.totalSpent}** إجمالي`;
    });

    const totalRevenue = sorted.reduce((sum, c) => sum + c.totalSpent, 0);
    const totalOrders  = sorted.reduce((sum, c) => sum + c.totalOrders, 0);

    return new EmbedBuilder()
      .setColor(B.colorSuccess)
      .setTitle('👥 عملاء Codryx')
      .setDescription(lines.join('\n'))
      .addFields(
        { name: '📦 إجمالي الطلبات المدفوعة', value: String(totalOrders), inline: true },
        { name: '💰 إجمالي الإيرادات', value: String(totalRevenue), inline: true },
        { name: '👤 عدد العملاء', value: String(sorted.length), inline: true },
      )
      .setFooter({ text: `${B.footer} • آخر تحديث` })
      .setTimestamp();
  },

  /**
   * يحدّث رسالة قناة العملاء في مكانها، أو ينشئها لأول مرة لو غير موجودة
   */
  async refresh(client) {
    if (!cfg.channels.customersChannel) return; // الميزة معطّلة لو القناة غير محددة في .env

    try {
      const channel = await client.channels.fetch(cfg.channels.customersChannel);
      const raw = db._read();
      const existingMessageId = raw.customersMessageId;

      const embed = this.buildEmbed();

      if (existingMessageId) {
        try {
          const message = await channel.messages.fetch(existingMessageId);
          await message.edit({ embeds: [embed] });
          return;
        } catch {
          // الرسالة القديمة محذوفة — سننشئ رسالة جديدة بالأسفل
        }
      }

      const sent = await channel.send({ embeds: [embed] });
      const updatedRaw = db._read();
      updatedRaw.customersMessageId = sent.id;
      db._write(updatedRaw);
    } catch (err) {
      console.error('[customersChannelHandler] فشل تحديث روم العملاء:', err.message);
    }
  },
};
