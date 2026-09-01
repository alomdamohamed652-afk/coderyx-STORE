'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const cfg          = require('../config');
const embeds       = require('../core/embeds');
const components   = require('../core/components');
const db           = require('../core/database');
const permissions  = require('../core/permissions');

// ─────────────────────────────────────────
//   Ticket Handler
//   نوع التيكت يتحدد من البانل مباشرة
//   لا يمكن فتح أكثر من تيكت من نفس النوع
// ─────────────────────────────────────────

const TYPE_LABELS = {
  purchase:   'شراء منتج',
  support:    'دعم فني',
  inquiry:    'استفسار',
  custom_dev: 'تطوير خاص',
  report:     'بلاغ',
};

module.exports = {

  // ─── إنشاء تيكت من اختيار البانل ─────

  async createFromPanel(interaction) {
    // نستخدم update لتحديث البانل في مكانه فورًا (تفريغ حالة القائمة بصريًا)
    // بدون حذف/إرسال رسالة جديدة — أكثر استقرارًا في واجهة Discord
    try {
      await interaction.update({
        embeds:     [embeds.panel()],
        components: [components.panelMenu()],
      });
    } catch (err) {
      // الـ interaction انتهت صلاحيتها (مثلًا بسبب تأخير شبكة) — لا فائدة من المحاولة
      console.error('[ticketHandler] فشل تحديث البانل (interaction منتهية):', err.message);
      return;
    }

    const guild = interaction.guild;
    const user  = interaction.user;
    const type  = interaction.values[0];

    // منع فتح أكثر من تيكت من نفس النوع
    // نستخدم الـ cache أولًا (سريع، بدون شبكة) ولا نلجأ لـ fetch
    // إلا لو القناة غير موجودة في الـ cache فعلاً (حالة نادرة)
    const existing = db.findOpenTicketByType(user.id, type);
    if (existing) {
      let channel = guild.channels.cache.get(existing.channelId);

      if (!channel) {
        // غير موجودة في الـ cache — تحقق فعلي عبر الشبكة كحل أخير فقط
        try {
          channel = await guild.channels.fetch(existing.channelId);
        } catch {
          channel = null;
        }
      }

      if (channel) {
        return interaction.followUp({
          content: `لديك تذكرة **${TYPE_LABELS[type] ?? type}** مفتوحة بالفعل: <#${existing.channelId}>`,
          ephemeral: true,
        });
      }

      // القناة محذوفة فعليًا لكن الـ DB لسه فيها كـ "مفتوحة" — ننظفها فورًا
      db.updateTicket(existing.channelId, { state: 'closed' });
    }

    // بناء صلاحيات الرتب (تدعم رتب متعددة، وتتجاهل أي ID غير موجود)
    const overwrites = [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
        ],
      },
      ...permissions.buildRoleOverwrites(guild, cfg.roles.owner, [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
      ]),
      ...permissions.buildRoleOverwrites(guild, cfg.roles.support, [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
      ]),
      ...permissions.buildRoleOverwrites(guild, cfg.roles.dev, [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
      ]),
    ];

    // اختيار الكاتيجوري المناسبة لنوع التذكرة، مع fallback للكاتيجوري العامة
    const typeCategoryId = cfg.channels.categoryByType[type];
    const categoryIdToUse = typeCategoryId || cfg.channels.ticketsCat;

    let parentId;
    if (categoryIdToUse) {
      const category = guild.channels.cache.get(categoryIdToUse);
      if (category) {
        parentId = category.id;
      } else {
        const envKey = typeCategoryId ? `${type.toUpperCase()}_CATEGORY_ID` : 'TICKETS_CATEGORY_ID';
        console.warn(`[ticketHandler] ⚠️ ${envKey} غير موجود في السيرفر: ${categoryIdToUse}`);
      }
    }

    const safeName = user.username.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20);
    const typeSlug = type.replace('_', '-');

    const channel = await guild.channels.create({
      name: `🎫・${typeSlug}-${safeName}`,
      type: ChannelType.GuildText,
      parent: parentId,
      topic: `ticket:${user.id}:${type}`,
      permissionOverwrites: overwrites,
    });

    db.saveTicket({ channelId: channel.id, userId: user.id, type });

    // لا ننتظر هذه الرسالة (ephemeral للعميل فقط) — مستقلة تمامًا عن باقي الخطوات
    interaction.followUp({
      content: `✅ تم فتح تذكرتك: <#${channel.id}>`,
      ephemeral: true,
    }).catch(() => {});

    // أزرار الاستلام وطلب الإغلاق تُرسل كرسالة مستقلة بمفردها
    // (وليس مدمجة مع رسائل الفلو) لأن تعديلها مستقبلاً (عند الاستلام) يجب
    // ألا يمسح أي مكونات أخرى (مثل قائمة اختيار المنتج) في رسالة مشتركة
    const actionsMessage = await channel.send({ components: [components.ticketActions(false)] });
    db.updateTicket(channel.id, { actionsMessageId: actionsMessage.id });

    // توجيه مباشر حسب النوع (لا حاجة لقائمة اختيار ثانية داخل التيكت)
    if (type === 'purchase') {
      const storeFlow = require('../flows/storeFlow');
      return storeFlow.start({ channel, user, guild });
    }

    const supportFlow = require('../flows/supportFlow');
    return supportFlow.start({ channel, user, guild }, type);
  },

  // ─── استلام التذكرة ──────────────────
  // أي حد من فريق الدعم/التطوير/المالك يقدر يستلم

  async claim(interaction) {
    const channel = interaction.channel;
    const ticket  = db.getTicket(channel.id);

    if (!ticket) {
      return interaction.reply({ content: 'هذه ليست تذكرة.', ephemeral: true });
    }

    if (!permissions.canClaimType(interaction.member, cfg, ticket.type)) {
      const teamLabel = ['purchase', 'custom_dev'].includes(ticket.type) ? 'فريق التطوير' : 'فريق الدعم';
      return interaction.reply({ content: `❌ هذه التذكرة مخصصة لـ ${teamLabel} فقط.`, ephemeral: true });
    }

    if (ticket.claimedBy) {
      const claimer = ticket.claimedBy === interaction.user.id ? 'أنت' : `<@${ticket.claimedBy}>`;
      return interaction.reply({ content: `هذه التذكرة مستلمة بالفعل من ${claimer}.`, ephemeral: true });
    }

    await interaction.deferUpdate();

    db.updateTicket(channel.id, { claimedBy: interaction.user.id, state: 'claimed' });

    await channel.send({ embeds: [embeds.ticketClaimed(interaction.user)] });

    // تحديث رسالة الأزرار المستقلة فقط (إزالة زر "استلام"، يبقى "طلب إغلاق")
    // نستخدم actionsMessageId المحفوظ بدل interaction.message لضمان عدم
    // التأثير على أي رسالة أخرى حتى لو تغيّر مصدر الضغطة مستقبلاً
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

  // ─── طلب إغلاق ───────────────────────
  // أي شخص شايف التذكرة يقدر يطلب الإغلاق
  // لكن الحذف الفعلي يتطلب صلاحية CLOSE_ROLE_IDS

  async requestClose(interaction) {
    const channel = interaction.channel;
    const ticket  = db.getTicket(channel.id);

    if (!ticket) {
      return interaction.reply({ content: 'هذه ليست تذكرة.', ephemeral: true });
    }

    await interaction.deferReply();

    await interaction.editReply({ embeds: [embeds.closeRequested(interaction.user)] });

    // تسجيل من طلب الإغلاق (قد يكون مختلفًا عن من سيؤكد الحذف فعليًا)
    db.updateTicket(channel.id, {
      requestedCloseBy: `${interaction.user.tag} (${interaction.user.id})`,
      requestedCloseAt: new Date().toISOString(),
    });

    if (permissions.isCloser(interaction.member, cfg)) {
      // الطالب نفسه يملك صلاحية الحذف → نعرض له زر التأكيد مباشرة
      await channel.send({
        content: 'يمكنك تأكيد الحذف الآن:',
        components: [components.closeConfirm()],
      });
    } else {
      // لا يملك صلاحية الحذف → ننبهه ونمنشن من يملكها في رسالة واحدة
      const closerMention = permissions.mentionRoles(interaction.guild, cfg.roles.close);

      await channel.send({
        content: closerMention
          ? `${closerMention} طلب إغلاق من ${interaction.user} — برجاء المراجعة والتأكيد.`
          : undefined,
        embeds: [embeds.closeDenied()],
        components: [components.closeConfirm()],
      });

      if (!closerMention) {
        console.warn('[ticketHandler] ⚠️ لا توجد رتب صالحة في CLOSE_ROLE_IDS للمنشن');
      }
    }
  },

  // ─── تأكيد الحذف الفعلي ──────────────

  async confirmClose(interaction) {
    const channel = interaction.channel;
    const ticket  = db.getTicket(channel.id);

    if (!ticket) {
      return interaction.reply({ content: 'هذه ليست تذكرة.', ephemeral: true });
    }

    // منع تكرار الحذف لو ضُغط الزر مرتين بسرعة من شخصين مختلفين
    if (ticket.state === 'closed' || ticket.state === 'closing') {
      return interaction.reply({ content: '⏳ التذكرة قيد الإغلاق بالفعل.', ephemeral: true });
    }

    if (!permissions.isCloser(interaction.member, cfg)) {
      return interaction.reply({ content: '❌ لا تملك صلاحية تأكيد الحذف.', ephemeral: true });
    }

    // قفل فوري قبل أي عملية async أخرى — يمنع أي محاولة موازية من المتابعة
    db.updateTicket(channel.id, { state: 'closing' });

    await interaction.deferUpdate();

    await channel.send({
      embeds: [embeds.info('إغلاق التذكرة', 'سيتم حذف هذه التذكرة خلال 5 ثوانٍ...')],
    }).catch(() => {});

    db.updateTicket(channel.id, { state: 'closed' });

    // بناء وإرسال ملف HTML بسجل التذكرة كاملًا قبل الحذف (لازم يحصل قبل أي حذف فعلي)
    const transcriptHandler = require('./transcriptHandler');
    const TYPE_LABELS_FULL = {
      purchase: 'شراء منتج', support: 'دعم فني', inquiry: 'استفسار',
      custom_dev: 'تطوير خاص', report: 'بلاغ',
    };

    try {
      await transcriptHandler.sendTranscript(channel, {
        channelName: channel.name,
        type: TYPE_LABELS_FULL[ticket.type] ?? ticket.type,
        openedBy: `<@${ticket.userId}> (${ticket.userId})`,
        openedAt: new Date(ticket.createdAt).toLocaleString('ar-EG'),
        requestedCloseBy: ticket.requestedCloseBy ?? null,
        requestedCloseAt: ticket.requestedCloseAt ? new Date(ticket.requestedCloseAt).toLocaleString('ar-EG') : null,
        closedAt: new Date().toLocaleString('ar-EG'),
        closedBy: `${interaction.user.tag} (${interaction.user.id})`,
        claimedBy: ticket.claimedBy ? `<@${ticket.claimedBy}> (${ticket.claimedBy})` : null,
      });
    } catch (err) {
      console.error('[ticketHandler] فشل إرسال سجل التذكرة:', err.message);
    }

    setTimeout(() => {
      channel.delete().catch(err => {
        // كود 10003 = القناة محذوفة بالفعل (Unknown Channel) — متوقع في حالة التزامن، لا حاجة لتسجيلها كخطأ
        if (err?.code !== 10003) {
          console.error(`[ticketHandler] فشل حذف القناة ${channel.id}:`, err.message);
        }
      });
    }, 5000);
  },

  // ─── إلغاء طلب الإغلاق ───────────────

  async cancelClose(interaction) {
    if (!permissions.isCloser(interaction.member, cfg)) {
      return interaction.reply({ content: '❌ لا تملك صلاحية إلغاء طلب الإغلاق.', ephemeral: true });
    }

    await interaction.update({
      content: `↩️ تم إلغاء طلب الإغلاق من ${interaction.user}.`,
      components: [],
    });
  },
};
