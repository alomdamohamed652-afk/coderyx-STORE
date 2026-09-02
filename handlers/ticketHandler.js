'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const cfg = require('../config');
const embeds = require('../core/embeds');
const components = require('../core/components');
const db = require('../core/database');
const permissions = require('../core/permissions');
const audit = require('../core/audit');

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
  const typeCode = (TYPE_CODES[ticket?.type] || 't').toUpperCase();

  // Discord text channels do not support the exact visual format
  // "P | 123•MUSHI-ER", so we use the closest clean Discord-safe format.
  // Open:    p-123-mushi-er
  // Claimed: p-123-claimer-mushi-er
  // The opener always stays in the name; the claimer is inserted before it.
  const opener = ticket?.userUsername || 'customer';

  if (claimer) {
    return `🎫・${typeCode}-${number}•${safeChannelPart(claimer.username)}•${safeChannelPart(opener)}`.slice(0, 100);
  }

  return `🎫・${typeCode}-${number}•${safeChannelPart(opener)}`.slice(0, 100);
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
      const leaderMention = permissions.mentionRoles(channel.guild, cfg.roles.teamLeader);
      await channel.send({
        content: [mention, leaderMention].filter(Boolean).join(' ') || undefined,
        embeds: [embeds.unclaimedReminder(ticket)],
        allowedMentions: { roles: [...roleIds, ...cfg.roles.teamLeader] },
      });
      db.recordTicketEvent(channelId, 'unclaimed_reminder', { details: { minutes: cfg.tickets.unclaimedReminderMinutes } });
      await audit.log(client, { action: 'Ticket unclaimed reminder / escalation', ticket, details: { 'الانتظار': cfg.tickets.unclaimedReminderMinutes + ' دقيقة' } });
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
      ...permissions.buildRoleOverwrites(guild, cfg.roles.admin, [
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

    scheduleUnclaimedReminder(interaction.client, channel.id);

    let flowMessage = null;
    if (type === 'purchase') {
      const storeFlow = require('../flows/storeFlow');
      flowMessage = await storeFlow.start({ channel, user, guild }, [
        components.ticketActions(false),
        components.ticketAdminButton(),
      ]);
    } else {
      const supportFlow = require('../flows/supportFlow');
      flowMessage = await supportFlow.start({ channel, user, guild }, type);
    }

    // تذاكر الشراء تحتوي على أدوات التذكرة داخل نفس رسالة المتجر،
    // حتى لا يكون Claim واختيار المنتج مرتبطين برسالتين منفصلتين.
    if (type === 'purchase') {
      if (flowMessage?.id) db.updateTicket(channel.id, { actionsMessageId: flowMessage.id });
    } else {
      const actionsMessage = await channel.send({
        embeds: [embeds.info('🎫 إدارة التذكرة', 'استخدم الأزرار التالية لاستلام التذكرة أو طلب إغلاقها.')],
        components: [components.ticketActions(false), components.ticketAdminButton()],
      });
      db.updateTicket(channel.id, { actionsMessageId: actionsMessage.id });
    }
    db.recordTicketEvent(channel.id, 'created', { byUserId: user.id, byUsername: user.username, details: { type } });
    await audit.log(interaction.client, { action: 'Ticket Created', actorId: user.id, ticket: db.getTicket(channel.id), details: { 'النوع': TYPE_LABELS[type] || type } });
    return flowMessage;
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
    db.recordTicketEvent(channel.id, 'claimed', { byUserId: interaction.user.id, byUsername: interaction.user.username });

    const updatedTicket = db.getTicket(channel.id);
    await channel.setName(baseTicketName(updatedTicket, interaction.user)).catch(() => {});
    await channel.send({ embeds: [embeds.ticketClaimed(interaction.user)] });
    await audit.log(interaction.client, { action: 'Ticket Claimed', actorId: interaction.user.id, ticket: updatedTicket });

    const actionsMessageId = ticket.actionsMessageId ?? interaction.message?.id;
    if (actionsMessageId) {
      try {
        const actionsMessage = await channel.messages.fetch(actionsMessageId);
        // استبدال صف التحكم فقط مع الحفاظ على قائمة المنتجات/التصنيفات
        // والبحث وأي أدوات أخرى موجودة في نفس رسالة الشراء.
        const preservedRows = actionsMessage.components
          .map(row => row.toJSON ? row.toJSON() : row)
          .filter(raw => !raw.components?.some(comp =>
            ['claim_ticket', 'request_close', 'ticket_admin_open'].includes(comp.custom_id)
          ));

        await actionsMessage.edit({
          components: [
            ...preservedRows,
            components.ticketActions(true).toJSON(),
            components.ticketAdminButton().toJSON(),
          ].slice(0, 5),
        });
      } catch (err) {
        console.warn('[ticketHandler] فشل تحديث لوحة التذكرة بعد الاستلام:', err.message);
      }
    }
  },

  async openAdmin(interaction) {
    if (!permissions.isTicketManager(interaction.member, cfg)) return interaction.reply({ content: '❌ لا تملك صلاحية إدارة التذاكر.', ephemeral: true });
    return interaction.reply({ content: 'اختر الإجراء المطلوب:', components: [components.ticketAdminMenu()], ephemeral: true });
  },

  async handleAdminMenu(interaction) {
    if (!permissions.isTicketManager(interaction.member, cfg)) return interaction.reply({ content: '❌ لا تملك صلاحية إدارة التذاكر.', ephemeral: true });
    const action = interaction.values[0];
    if (action === 'add_member') return interaction.showModal(components.ticketMemberModal('add'));
    if (action === 'remove_member') return interaction.showModal(components.ticketMemberModal('remove'));
    if (action === 'rename') return interaction.showModal(components.ticketRenameModal());
    if (action === 'transfer') return interaction.update({ content: '📁 اختر القسم الجديد للتذكرة:', components: [components.ticketTransferMenu()] });
    if (action === 'status') {
      const ticket = db.getTicket(interaction.channel.id);
      return interaction.update({ content: '📌 اختر حالة التذكرة:', components: [components.ticketStatusMenu(ticket)] });
    }
    if (action === 'staff_transfer') return interaction.showModal(components.ticketStaffTransferModal());
    if (action === 'notify') {
      const ticket = db.getTicket(interaction.channel.id);
      if (!ticket) return interaction.update({ content: '❌ هذه ليست تذكرة.', components: [] });
      await interaction.channel.send({ content: `<@${ticket.userId}> 🔔 **تنبيه:** يوجد تحديث على تذكرتك، يرجى مراجعتها.` });
      return interaction.update({ content: '✅ تم إرسال التنبيه لصاحب التذكرة.', components: [] });
    }
  },

  async handleStatusSelect(interaction) {
    if (!permissions.isTicketManager(interaction.member, cfg)) return interaction.reply({ content: '❌ لا تملك صلاحية إدارة التذاكر.', ephemeral: true });
    const ticket = db.getTicket(interaction.channel.id);
    if (!ticket) return interaction.reply({ content: '❌ هذه ليست تذكرة.', ephemeral: true });
    const state = interaction.values[0];
    if (!['open','claimed','waiting','resolved'].includes(state)) return interaction.reply({ content: '❌ حالة غير صالحة.', ephemeral: true });

    await interaction.deferUpdate();
    db.updateTicket(interaction.channel.id, { state });
    db.recordTicketEvent(interaction.channel.id, 'status_changed', { byUserId: interaction.user.id, byUsername: interaction.user.username, details: { from: ticket.state, to: state } });
    const updated = db.getTicket(interaction.channel.id);
    await audit.log(interaction.client, { action: 'Ticket Status Changed', actorId: interaction.user.id, ticket: updated, details: { 'من': ticket.state, 'إلى': state } });
    return interaction.editReply({ content: `✅ تم تغيير حالة التذكرة إلى **${state}**.`, components: [] });
  },


  async handleStaffTransferModal(interaction) {
    if (!permissions.isTicketManager(interaction.member, cfg)) return interaction.reply({ content: '❌ لا تملك صلاحية إدارة التذاكر.', ephemeral: true });
    const ticket = db.getTicket(interaction.channel.id);
    if (!ticket) return interaction.reply({ content: '❌ هذه ليست تذكرة.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    const rawId = interaction.fields.getTextInputValue('staff_id').trim().replace(/[<@!>]/g, '');
    if (!/^\d{17,20}$/.test(rawId)) return interaction.editReply({ content: '❌ أرسل Discord User ID صحيح.' });

    const member = await interaction.guild.members.fetch(rawId).catch(() => null);
    if (!member) return interaction.editReply({ content: '❌ العضو غير موجود في السيرفر.' });
    if (!permissions.canClaimType(member, cfg, ticket.type)) return interaction.editReply({ content: '❌ هذا العضو ليس ضمن الفريق المختص بهذه التذكرة.' });

    const oldStaff = ticket.claimedBy;
    const oldName = ticket.claimedUsername || 'غير مستلم';
    db.updateTicket(interaction.channel.id, {
      claimedBy: member.id,
      claimedUsername: member.user.username,
      claimedAt: ticket.claimedAt || new Date().toISOString(),
      state: 'claimed',
    });
    db.recordTicketEvent(interaction.channel.id, 'staff_transferred', {
      byUserId: interaction.user.id,
      byUsername: interaction.user.username,
      details: { from: oldName, to: member.user.username },
    });

    const updated = db.getTicket(interaction.channel.id);
    await interaction.channel.setName(baseTicketName(updated, { username: member.user.username })).catch(() => {});
    await interaction.channel.send({ content: `🔄 تم نقل مسؤولية التذكرة إلى ${member}.` });
    await audit.log(interaction.client, {
      action: 'Ticket Staff Transferred',
      actorId: interaction.user.id,
      ticket: updated,
      details: { 'من': oldStaff ? `<@${oldStaff}>` : oldName, 'إلى': `<@${member.id}>` },
    });
    return interaction.editReply({ content: `✅ تم نقل التذكرة إلى ${member}.` });
  },


  async handleMemberModal(interaction, action) {
    if (!permissions.isTicketManager(interaction.member, cfg)) return interaction.reply({ content: '❌ لا تملك صلاحية إدارة التذاكر.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const rawId = interaction.fields.getTextInputValue('member_id').trim().replace(/[<@!>]/g, '');
    if (!/^\d{17,20}$/.test(rawId)) return interaction.editReply({ content: '❌ أرسل Discord User ID صحيح.' });
    const member = await interaction.guild.members.fetch(rawId).catch(() => null);
    if (!member) return interaction.editReply({ content: '❌ العضو غير موجود في السيرفر.' });
    if (action === 'add') {
      await interaction.channel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true, AttachFiles: true });
      return interaction.editReply({ content: `✅ تمت إضافة ${member} إلى التذكرة.` });
    }
    await interaction.channel.permissionOverwrites.delete(member.id).catch(() => {});
    return interaction.editReply({ content: `✅ تمت إزالة ${member} من التذكرة.` });
  },


  async handleRenameModal(interaction) {
    if (!permissions.isTicketManager(interaction.member, cfg)) return interaction.reply({ content: '❌ لا تملك صلاحية إدارة التذاكر.', ephemeral: true });
    const name = interaction.fields.getTextInputValue('ticket_name').trim();
    if (!name) return interaction.reply({ content: '❌ اسم التذكرة لا يمكن أن يكون فارغًا.', ephemeral: true });
    const clean = name.replace(/[\\/]/g, '-').slice(0, 100);
    await interaction.deferReply({ ephemeral: true });
    await interaction.channel.setName(clean);
    return interaction.editReply({ content: `✅ تم تغيير اسم التذكرة إلى: ${clean}` });
  },


  async transfer(interaction) {
    if (!permissions.isTicketManager(interaction.member, cfg)) return interaction.reply({ content: '❌ لا تملك صلاحية إدارة التذاكر.', ephemeral: true });
    const ticket = db.getTicket(interaction.channel.id);
    if (!ticket) return interaction.reply({ content: 'هذه ليست تذكرة.', ephemeral: true });
    const newType = interaction.values[0];
    const categoryId = cfg.channels.categoryByType[newType] || cfg.channels.ticketsCat;
    const category = interaction.guild.channels.cache.get(categoryId);
    if (!category) return interaction.reply({ content: '❌ كاتيجوري القسم الجديد غير موجودة.', ephemeral: true });

    await interaction.deferUpdate();
    await interaction.channel.setParent(category.id, { lockPermissions: false });
    const oldType = ticket.type;
    const currentClaimer = ticket.claimedBy ? interaction.guild.members.cache.get(ticket.claimedBy) : null;
    const claimerStillEligible = currentClaimer ? permissions.canClaimType(currentClaimer, cfg, newType) : false;
    db.updateTicket(interaction.channel.id, {
      type: newType,
      state: ticket.state === 'closed' ? 'closed' : (claimerStillEligible ? 'claimed' : 'open'),
      ...(claimerStillEligible ? {} : { claimedBy: null, claimedUsername: null, claimedAt: null }),
    });
    db.recordTicketEvent(interaction.channel.id, 'transferred', { byUserId: interaction.user.id, byUsername: interaction.user.username, details: { from: oldType, to: newType } });
    const updated = db.getTicket(interaction.channel.id);
    const claimer = updated.claimedBy ? { username: updated.claimedUsername } : null;
    await interaction.channel.setName(baseTicketName(updated, claimer)).catch(() => {});
    await audit.log(interaction.client, { action: 'Ticket Transferred', actorId: interaction.user.id, ticket: updated, details: { 'من': TYPE_LABELS[oldType] || oldType, 'إلى': TYPE_LABELS[newType] || newType } });
    return interaction.editReply({ content: `✅ تم نقل التذكرة إلى **${TYPE_LABELS[newType] || newType}**.`, components: [] });
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
    db.recordTicketEvent(channel.id, 'close_requested', { byUserId: interaction.user.id, byUsername: interaction.user.username });

    if (permissions.isCloser(interaction.member, cfg)) {
      await channel.send({ content: 'يمكنك تأكيد الحذف الآن:', components: [components.closeConfirm()] });
    } else {
      const closerMention = permissions.mentionRoles(interaction.guild, cfg.roles.admin);
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

    db.updateTicket(channel.id, { state: 'closed', closedAt: new Date().toISOString(), closedBy: interaction.user.id, closedByUsername: interaction.user.username });
    db.recordTicketEvent(channel.id, 'closed', { byUserId: interaction.user.id, byUsername: interaction.user.username });
    await audit.log(interaction.client, { action: 'Ticket Closed', actorId: interaction.user.id, ticket: db.getTicket(channel.id) });

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
        openedBy: ticket.userId,
        openedByUsername: ticket.userUsername,
        openedAt: new Date(ticket.createdAt).toLocaleString('ar-EG'),
        requestedCloseBy: ticket.requestedCloseBy ?? null,
        requestedCloseAt: ticket.requestedCloseAt ? new Date(ticket.requestedCloseAt).toLocaleString('ar-EG') : null,
        closedAt: new Date().toLocaleString('ar-EG'),
        closedBy: interaction.user.id,
        closedByUsername: interaction.user.username,
        claimedBy: ticket.claimedBy || null,
        claimedByUsername: ticket.claimedUsername || null,
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
