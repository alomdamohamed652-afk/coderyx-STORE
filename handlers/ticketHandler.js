'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const cfg = require('../config');
const embeds = require('../core/embeds');
const components = require('../core/components');
const db = require('../core/database');
const permissions = require('../core/permissions');

const TYPE_LABELS = {
  purchase: 'شراء منتج',
  support: 'دعم فني',
  inquiry: 'استفسار',
  custom_dev: 'تطوير خاص',
  report: 'بلاغ',
};

function safeChannelPart(value) {
  return String(value || 'staff').toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').slice(0, 18) || 'staff';
}

const TYPE_CODES = {
  purchase: 'p',
  support: 's',
  inquiry: 'i',
  custom_dev: 'cd',
  report: 'r',
};

function baseTicketName(ticket, claimer = null) {
  const number = ticket?.displayNumber || '000';
  const typeCode = TYPE_CODES[ticket?.type] || 't';

  // Discord text channels do not support the exact visual format
  // "P | 123•MUSHI-ER", so we use the closest clean Discord-safe format.
  // Open:    p-123-mushi-er
  // Claimed: p-123-claimer-mushi-er
  // The opener always stays in the name; the claimer is inserted before it.
  const opener = ticket?.userUsername || 'customer';

  if (claimer) {
    return `${typeCode}-${number}-${safeChannelPart(claimer.username)}-${safeChannelPart(opener)}`.slice(0, 100);
  }

  return `${typeCode}-${number}-${safeChannelPart(opener)}`.slice(0, 100);
}

function reminderDelayMs() {
  return cfg.tickets.unclaimedReminderMinutes * 60 * 1000;
}

function scheduleUnclaimedReminder(client, channelId, delay = reminderDelayMs()) {
  setTimeout(async () => {
    const ticket = db.getTicket(channelId);
    if (!ticket || ticket.state !== 'open' || ticket.claimedBy || ticket.reminderSentAt) return;

    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel) return;
      const roleIds = ['purchase', 'custom_dev'].includes(ticket.type) ? cfg.roles.dev : cfg.roles.support;
      const mention = permissions.mentionRoles(channel.guild, roleIds);
      await channel.send({
        content: mention || undefined,
        embeds: [embeds.unclaimedReminder(ticket)],
      });
      db.updateTicket(channelId, { reminderSentAt: new Date().toISOString() });
    } catch (err) {
      console.warn('[ticketHandler] فشل إرسال تذكير التذكرة:', err.message);
    }
  }, Math.max(1000, delay));
}

module.exports = {
  async createFromPanel(interaction) {
    try {
      await interaction.update({
        embeds: [embeds.panel()],
        components: [components.panelMenu()],
      });
    } catch (err) {
      console.error('[ticketHandler] فشل تحديث البانل:', err.message);
      return;
    }

    const guild = interaction.guild;
    const user = interaction.user;
    const type = interaction.values[0];

    const existing = db.findOpenTicketByType(user.id, type);
    if (existing) {
      let channel = guild.channels.cache.get(existing.channelId);
      if (!channel) {
        try { channel = await guild.channels.fetch(existing.channelId); } catch { channel = null; }
      }
      if (channel) {
        return interaction.followUp({
          content: `لديك تذكرة **${TYPE_LABELS[type] ?? type}** مفتوحة بالفعل: <#${existing.channelId}>`,
          ephemeral: true,
        });
      }
      db.updateTicket(existing.channelId, { state: 'closed' });
    }

    const overwrites = [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
      },
      ...permissions.buildRoleOverwrites(guild, cfg.roles.owner, [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels,
      ]),
      ...permissions.buildRoleOverwrites(guild, cfg.roles.support, [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      ]),
      ...permissions.buildRoleOverwrites(guild, cfg.roles.dev, [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      ]),
    ];

    const typeCategoryId = cfg.channels.categoryByType[type];
    const categoryIdToUse = typeCategoryId || cfg.channels.ticketsCat;
    let parentId;
    if (categoryIdToUse) {
      const category = guild.channels.cache.get(categoryIdToUse);
      if (category) parentId = category.id;
    }

    const channel = await guild.channels.create({
      name: 'ticket-pending',
      type: ChannelType.GuildText,
      parent: parentId,
      topic: `ticket:${user.id}:${type}`,
      permissionOverwrites: overwrites,
    });

    const ticket = db.saveTicket({ channelId: channel.id, userId: user.id, type, userUsername: user.username });
    await channel.setName(baseTicketName(ticket)).catch(() => {});

    interaction.followUp({
      content: `✅ تم فتح تذكرتك: <#${channel.id}>`,
      ephemeral: true,
    }).catch(() => {});

    const actionsMessage = await channel.send({ components: [components.ticketActions(false)] });
    db.updateTicket(channel.id, { actionsMessageId: actionsMessage.id });

    scheduleUnclaimedReminder(interaction.client, channel.id);

    if (type === 'purchase') {
      const storeFlow = require('../flows/storeFlow');
      return storeFlow.start({ channel, user, guild });
    }

    const supportFlow = require('../flows/supportFlow');
    return supportFlow.start({ channel, user, guild }, type);
  },

  async claim(interaction) {
    const channel = interaction.channel;
    const ticket = db.getTicket(channel.id);

    if (!ticket) return interaction.reply({ content: 'هذه ليست تذكرة.', ephemeral: true });

    if (!permissions.canClaimType(interaction.member, cfg, ticket.type)) {
      const teamLabel = ['purchase', 'custom_dev'].includes(ticket.type) ? 'فريق التطوير' : 'فريق الدعم';
      return interaction.reply({ content: `❌ هذه التذكرة مخصصة لـ ${teamLabel} فقط.`, ephemeral: true });
    }

    if (ticket.claimedBy) {
      const claimer = ticket.claimedBy === interaction.user.id ? 'أنت' : `<@${ticket.claimedBy}>`;
      return interaction.reply({ content: `هذه التذكرة مستلمة بالفعل من ${claimer}.`, ephemeral: true });
    }

    await interaction.deferUpdate();

    db.updateTicket(channel.id, {
      claimedBy: interaction.user.id,
      claimedUsername: interaction.user.username,
      claimedAt: new Date().toISOString(),
      state: 'claimed',
    });

    const updatedTicket = db.getTicket(channel.id);
    await channel.setName(baseTicketName(updatedTicket, interaction.user)).catch(() => {});
    await channel.send({ embeds: [embeds.ticketClaimed(interaction.user)] });

    const actionsMessageId = ticket.actionsMessageId ?? interaction.message?.id;
    if (actionsMessageId) {
      try {
        const actionsMessage = await channel.messages.fetch(actionsMessageId);
        await actionsMessage.edit({ components: [components.ticketActions(true)] });
      } catch (err) {
        console.warn('[ticketHandler] فشل تحديث رسالة الأزرار بعد الاستلام:', err.message);
      }
    }
  },

  async requestClose(interaction) {
    const channel = interaction.channel;
    const ticket = db.getTicket(channel.id);
    if (!ticket) return interaction.reply({ content: 'هذه ليست تذكرة.', ephemeral: true });

    await interaction.deferReply();
    await interaction.editReply({ embeds: [embeds.closeRequested(interaction.user)] });

    db.updateTicket(channel.id, {
      requestedCloseBy: `${interaction.user.tag} (${interaction.user.id})`,
      requestedCloseAt: new Date().toISOString(),
    });

    if (permissions.isCloser(interaction.member, cfg)) {
      await channel.send({ content: 'يمكنك تأكيد الحذف الآن:', components: [components.closeConfirm()] });
    } else {
      const closerMention = permissions.mentionRoles(interaction.guild, cfg.roles.close);
      await channel.send({
        content: closerMention ? `${closerMention} طلب إغلاق من ${interaction.user} — برجاء المراجعة والتأكيد.` : undefined,
        embeds: [embeds.closeDenied()],
        components: [components.closeConfirm()],
      });
    }
  },

  async confirmClose(interaction) {
    const channel = interaction.channel;
    const ticket = db.getTicket(channel.id);
    if (!ticket) return interaction.reply({ content: 'هذه ليست تذكرة.', ephemeral: true });
    if (ticket.state === 'closed' || ticket.state === 'closing') {
      return interaction.reply({ content: '⏳ التذكرة قيد الإغلاق بالفعل.', ephemeral: true });
    }
    if (!permissions.isCloser(interaction.member, cfg)) {
      return interaction.reply({ content: '❌ لا تملك صلاحية تأكيد الحذف.', ephemeral: true });
    }

    db.updateTicket(channel.id, { state: 'closing' });
    await interaction.deferUpdate();

    await channel.send({
      embeds: [embeds.info('إغلاق التذكرة', 'سيتم حذف هذه التذكرة خلال 5 ثوانٍ...')],
    }).catch(() => {});

    db.updateTicket(channel.id, { state: 'closed' });

    const transcriptHandler = require('./transcriptHandler');
    const TYPE_LABELS_FULL = {
      purchase: 'شراء منتج', support: 'دعم فني', inquiry: 'استفسار',
      custom_dev: 'تطوير خاص', report: 'بلاغ',
    };

    try {
      await transcriptHandler.sendTranscript(channel, {
        channelName: channel.name,
        ticketNumber: ticket.displayNumber,
        type: TYPE_LABELS_FULL[ticket.type] ?? ticket.type,
        openedBy: `<@${ticket.userId}> (${ticket.userId})`,
        openedAt: new Date(ticket.createdAt).toLocaleString('ar-EG'),
        requestedCloseBy: ticket.requestedCloseBy ?? null,
        requestedCloseAt: ticket.requestedCloseAt ? new Date(ticket.requestedCloseAt).toLocaleString('ar-EG') : null,
        closedAt: new Date().toLocaleString('ar-EG'),
        closedBy: `${interaction.user.tag} (${interaction.user.id})`,
        claimedBy: ticket.claimedBy ? `<@${ticket.claimedBy}> (${ticket.claimedBy})` : null,
        claimedAt: ticket.claimedAt ? new Date(ticket.claimedAt).toLocaleString('ar-EG') : null,
      });
    } catch (err) {
      console.error('[ticketHandler] فشل إرسال سجل التذكرة:', err.message);
    }

    setTimeout(() => {
      channel.delete().catch(err => {
        if (err?.code !== 10003) console.error(`[ticketHandler] فشل حذف القناة ${channel.id}:`, err.message);
      });
    }, 5000);
  },

  async cancelClose(interaction) {
    if (!permissions.isCloser(interaction.member, cfg)) {
      return interaction.reply({ content: '❌ لا تملك صلاحية إلغاء طلب الإغلاق.', ephemeral: true });
    }
    await interaction.update({
      content: `↩️ تم إلغاء طلب الإغلاق من ${interaction.user}.`,
      components: [],
    });
  },

  scheduleUnclaimedReminder,
  restoreReminderTimers(client) {
    for (const ticket of db.getOpenUnclaimedTickets()) {
      const elapsed = Date.now() - new Date(ticket.createdAt).getTime();
      const remaining = reminderDelayMs() - elapsed;
      scheduleUnclaimedReminder(client, ticket.channelId, Math.max(1000, remaining));
    }
  },
};
