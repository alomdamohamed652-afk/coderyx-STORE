'use strict';

const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const cfg = require('../config');
const db = require('../core/database');

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractUserId(value = '') {
  const match = String(value).match(/(?:<@!?)?(\d{17,20})/);
  return match ? match[1] : null;
}

function renderContent(content = '') {
  let text = escapeHtml(content);
  text = text.replace(/\`\`\`([\s\S]*?)\`\`\`/g, (_, code) => `<pre>${code}</pre>`);
  text = text.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/&lt;@!?(\d+)&gt;/g, '<span class="mention">@$1</span>');
  text = text.replace(/&lt;#(\d+)&gt;/g, '<span class="mention">#$1</span>');
  text = text.replace(/&lt;@&amp;(\d+)&gt;/g, '<span class="mention">@Role $1</span>');
  return text.replace(/\n/g, '<br>');
}

function renderEmbed(embed) {
  const color = embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : '#e11d48';
  let html = `<div class="embed" style="border-right-color:${color}">`;
  if (embed.author?.name) html += `<div class="embed-author">${escapeHtml(embed.author.name)}</div>`;
  if (embed.title) html += `<div class="embed-title">${escapeHtml(embed.title)}</div>`;
  if (embed.description) html += `<div class="embed-description">${renderContent(embed.description)}</div>`;
  if (embed.fields?.length) {
    html += '<div class="embed-fields">';
    for (const field of embed.fields) {
      html += `<div class="embed-field"><div class="embed-field-name">${escapeHtml(field.name)}</div><div class="embed-field-value">${renderContent(field.value)}</div></div>`;
    }
    html += '</div>';
  }
  if (embed.image?.url) html += `<img class="embed-image" src="${escapeHtml(embed.image.url)}">`;
  if (embed.thumbnail?.url) html += `<img class="embed-thumbnail" src="${escapeHtml(embed.thumbnail.url)}">`;
  if (embed.footer?.text) html += `<div class="embed-footer">${escapeHtml(embed.footer.text)}</div>`;
  html += '</div>';
  return html;
}

function renderComponents(components) {
  if (!components?.length) return '';
  let html = '<div class="components">';
  for (const row of components) {
    for (const comp of row.components ?? []) {
      if (comp.type === 2) {
        const label = comp.label ?? comp.emoji?.name ?? 'زر';
        html += `<span class="fake-button">${escapeHtml(label)}</span>`;
      } else if (comp.type === 3) {
        html += `<span class="fake-select">▾ ${escapeHtml(comp.placeholder ?? 'قائمة اختيار')}</span>`;
      }
    }
  }
  return html + '</div>';
}

async function resolveUserName(guild, rawValue, fallback = 'غير معروف') {
  const id = extractUserId(rawValue);
  if (!id || !guild) return fallback;
  try {
    const member = await guild.members.fetch(id);
    return member.displayName || member.user.globalName || member.user.username || fallback;
  } catch {
    try {
      const user = await guild.client.users.fetch(id);
      return user.globalName || user.username || fallback;
    } catch {
      return fallback;
    }
  }
}

function normalizeTypeKey(type) {
  const value = String(type || '').toLowerCase();
  if (['purchase', 'شراء منتج'].includes(value)) return 'purchase';
  if (['custom_dev', 'تطوير خاص'].includes(value)) return 'custom_dev';
  if (['support', 'دعم فني'].includes(value)) return 'support';
  if (['inquiry', 'استفسار'].includes(value)) return 'inquiry';
  if (['report', 'بلاغ'].includes(value)) return 'report';
  return 'support';
}

function getTeamType(type) {
  return ['purchase', 'custom_dev'].includes(type) ? 'dev' : 'support';
}

function getTeamLabel(type) {
  return getTeamType(type) === 'dev' ? 'فريق التطوير' : 'فريق الدعم';
}

function getTeamRoleIds(type) {
  return getTeamType(type) === 'dev' ? cfg.roles.dev : cfg.roles.support;
}

function getTeamRoleNames(guild, type) {
  return getTeamRoleIds(type)
    .map(id => guild.roles.cache.get(id)?.name)
    .filter(Boolean);
}

function buildTeamRatingRows(ticketId, hasStaff) {
  const makeRow = (category, label) => new ActionRowBuilder().addComponents(
    ...[1, 2, 3, 4, 5].map(stars =>
      new ButtonBuilder()
        .setCustomId(`teamrate|${category}|${ticketId}|${stars}`)
        .setLabel(`${stars} ⭐`)
        .setStyle(ButtonStyle.Secondary)
    )
  );

  const rows = [
    makeRow('team', 'الفريق'),
  ];

  if (hasStaff) rows.push(makeRow('staff', 'الموظف'));
  rows.push(makeRow('management', 'الإدارة'));
  return rows;
}

function ratingCategoryLabel(category, teamName, staffName) {
  if (category === 'team') return teamName;
  if (category === 'staff') return staffName ? `الموظف: ${staffName}` : 'الموظف';
  return 'الإدارة';
}

async function sendTeamFeedbackRequest(channel, meta, teamName, staffName) {
  const customerId = extractUserId(meta.openedBy);
  if (!customerId) return;

  try {
    const user = await channel.client.users.fetch(customerId);
    const embed = new EmbedBuilder()
      .setColor(0xe11d48)
      .setTitle('⭐ تقييم تجربتك مع الفريق')
      .setDescription(
        `نشكر لك ثقتك بنا. قبل إغلاق تجربتك، نريد معرفة رأيك بكل شفافية.\\n\\n` +
        `🛠️ **${teamName}** — قيّم الفريق الذي تعامل مع طلبك.\\n` +
        (staffName ? `👤 **${staffName}** — قيّم الموظف الذي استلم التذكرة.\\n` : '') +
        '🏢 **الإدارة** — قيّم التجربة الإدارية بشكل عام.\\n\\n' +
        'اختر عدد النجوم المناسب لكل قسم من الأزرار بالأسفل.'
      )
      .setFooter({ text: `${channel.guild?.name || 'Discord Server'} • Ticket Feedback` })
      .setTimestamp();

    await user.send({
      embeds: [embed],
      components: buildTeamRatingRows(channel.id, !!staffName),
    });
  } catch (err) {
    console.warn('[teamFeedback] تعذر إرسال DM للتقييم:', err.message);
  }
}

async function logTeamFeedback(client, feedback) {
  if (!cfg.channels.teamFeedbackChannel) return;

  try {
    const channel = await client.channels.fetch(cfg.channels.teamFeedbackChannel);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(0xe11d48)
      .setTitle(`⭐ تقييم فريق جديد • تذكرة #${feedback.ticketNumber}`)
      .addFields(
        { name: '👤 العميل', value: feedback.customerUsername || 'غير معروف', inline: true },
        { name: '🏷️ النوع', value: feedback.teamName || '—', inline: true },
        { name: '⭐ التقييم', value: `${'⭐'.repeat(feedback.rating)} (${feedback.rating}/5)`, inline: true },
        { name: '📌 القسم', value: ratingCategoryLabel(feedback.category, feedback.teamName, feedback.staffUsername), inline: true },
        { name: '👨‍💼 الموظف', value: feedback.staffUsername || 'لم يتم استلام التذكرة', inline: true },
      )
      .setFooter({ text: `${channel.guild?.name || 'Discord'} • Team Feedback` })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.warn('[teamFeedback] فشل إرسال لوق التقييم:', err.message);
  }
}

module.exports = {
  async fetchAllMessages(channel) {
    const messages = [];
    let lastId = null;

    while (true) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;

      const batch = await channel.messages.fetch(options);
      if (batch.size === 0) break;

      messages.push(...batch.values());
      lastId = batch.last().id;

      if (batch.size < 100) break;
    }

    return messages.reverse();
  },

  async buildTranscript(channel, meta = {}) {
    const messages = await this.fetchAllMessages(channel);

    const openedName = await resolveUserName(channel.guild, meta.openedBy, meta.openedByUsername || 'غير معروف');
    const claimedName = meta.claimedBy
      ? await resolveUserName(channel.guild, meta.claimedBy, meta.claimedByUsername || 'غير معروف')
      : 'لم تُستلم';
    const closedName = await resolveUserName(channel.guild, meta.closedBy, meta.closedByUsername || 'غير معروف');
    const typeKey = normalizeTypeKey(meta.typeKey || meta.type);
    const teamName = meta.teamRoleName || getTeamRoleNames(channel.guild, typeKey).join(' • ') || getTeamLabel(typeKey);

    const rows = messages.map(msg => {
      const time = new Date(msg.createdTimestamp).toLocaleString('ar-EG', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });

      const avatarUrl = msg.author.displayAvatarURL({ extension: 'png', size: 64 });
      const isBot = msg.author.bot;

      let bodyHtml = '';
      if (msg.content) bodyHtml += `<div class="msg-content">${renderContent(msg.content)}</div>`;
      for (const embed of msg.embeds ?? []) bodyHtml += renderEmbed(embed.data ?? embed);
      bodyHtml += renderComponents(msg.components);

      for (const att of msg.attachments?.values?.() ?? []) {
        if (att.contentType?.startsWith('image/')) {
          bodyHtml += `<img class="attachment-image" src="${escapeHtml(att.url)}">`;
        } else {
          bodyHtml += `<div class="attachment-file">📎 <a href="${escapeHtml(att.url)}">${escapeHtml(att.name)}</a></div>`;
        }
      }

      if (!bodyHtml) bodyHtml = '<div class="msg-content"><em>(رسالة بدون محتوى ظاهر)</em></div>';

      return `
        <div class="message">
          <img class="avatar" src="${escapeHtml(avatarUrl)}">
          <div class="message-body">
            <div class="message-header">
              <span class="username">${escapeHtml(msg.author.globalName || msg.author.username)}</span>
              ${isBot ? '<span class="bot-tag">APP</span>' : ''}
              <span class="timestamp">${time}</span>
            </div>
            ${bodyHtml}
          </div>
        </div>`;
    }).join('\\n');

    const serverName = channel.guild?.name || 'CODRYX STORE';
    const ticketTitle = meta.ticketNumber ?? channel.name;
    const statusLabel = meta.closedAt ? 'مغلقة' : 'مفتوحة';
    const messageCount = messages.length;
    const attachmentCount = messages.reduce((n, m) => n + (m.attachments?.size || 0), 0);

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(serverName)} • Transcript #${escapeHtml(ticketTitle)}</title>
<style>
  :root{
    --bg:#07080b;--panel:#101218;--panel2:#171922;--panel3:#1e212b;
    --line:#2b2e38;--text:#f5f5f6;--muted:#969aa7;
    --red:#e11d48;--red2:#ff4d6d;--red-soft:rgba(225,29,72,.13);
  }
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(circle at 78% -10%,rgba(225,29,72,.15),transparent 34%),var(--bg);color:var(--text);font-family:"Segoe UI",Tahoma,Arial,sans-serif}
  .shell{max-width:1240px;margin:auto;padding:26px 22px 44px}
  .hero{position:relative;overflow:hidden;background:linear-gradient(135deg,#1a1116,#101218 62%,#160d12);border:1px solid rgba(225,29,72,.42);border-radius:20px;padding:25px 28px;box-shadow:0 18px 60px rgba(0,0,0,.32)}
  .hero:after{content:"";position:absolute;right:-100px;bottom:-120px;width:300px;height:300px;border-radius:50%;background:rgba(225,29,72,.13);filter:blur(55px)}
  .brand{font-size:12px;font-weight:800;letter-spacing:.7px;color:var(--red2);margin-bottom:7px}
  .hero h1{margin:0;font-size:30px}
  .hero p{margin:8px 0 0;color:#a9adb8;font-size:14px}
  .status{position:absolute;left:28px;top:27px;background:var(--red-soft);border:1px solid rgba(255,77,109,.32);color:#ff9bb0;padding:7px 13px;border-radius:999px;font-size:12px;font-weight:800}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:14px 0}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:16px 18px}
  .stat small{display:block;color:var(--muted);font-size:12px;margin-bottom:7px}
  .stat strong{font-size:21px}
  .layout{display:grid;grid-template-columns:290px 1fr;gap:14px;align-items:start}
  .sidebar,.content-card{background:var(--panel);border:1px solid var(--line);border-radius:16px}
  .sidebar{padding:18px;position:sticky;top:18px}
  .side-title{font-size:20px;font-weight:800;margin-bottom:12px}
  .person{padding:12px 0;border-top:1px solid var(--line)}
  .label{font-size:11px;color:var(--muted);margin-bottom:5px}
  .value{font-size:14px;word-break:break-word}
  .value.primary{color:var(--red2);font-size:22px;font-weight:850}
  .content-card{padding:20px}
  .section-head{display:flex;justify-content:space-between;align-items:end;margin-bottom:15px}
  .section-head h2{font-size:19px;margin:0}.section-head span{font-size:12px;color:var(--muted)}
  .timeline{position:relative;padding-right:14px}
  .message{display:flex;gap:11px;margin:0 0 14px}
  .avatar{width:38px;height:38px;border-radius:50%;flex:0 0 38px}
  .message-body{min-width:0;flex:1}
  .message-header{display:flex;align-items:center;gap:7px;margin-bottom:3px}
  .username{font-weight:750;font-size:13px}.bot-tag{background:#5865f2;color:#fff;font-size:9px;padding:1px 5px;border-radius:4px;font-weight:700}.timestamp{font-size:10px;color:#777d8a}
  .msg-content{font-size:14px;line-height:1.55;word-wrap:break-word}
  .embed{border-right:3px solid #e11d48;background:#20222a;border-radius:7px;padding:10px 12px;margin-top:6px;max-width:760px}
  .embed-author{font-size:12px;font-weight:700;margin-bottom:3px}.embed-title{font-weight:800;margin-bottom:3px}.embed-description{font-size:13px;line-height:1.55;color:#dbdee1}
  .embed-fields{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}.embed-field{font-size:12px}.embed-field-name{font-weight:750}.embed-field-value{color:#c9ccd2}
  .embed-footer{font-size:10px;color:#949ba4;margin-top:7px}.embed-image,.attachment-image{max-width:520px;border-radius:8px;margin-top:8px;display:block}.embed-thumbnail{max-width:100px;border-radius:8px;margin-top:8px}
  .attachment-file{margin-top:7px;font-size:13px}.attachment-file a{color:#ff718b;text-decoration:none}
  .components{margin-top:7px;display:flex;flex-wrap:wrap;gap:5px}.fake-button{background:#30323a;color:#fff;font-size:11px;padding:5px 9px;border-radius:5px}.fake-select{background:#1a1c22;color:#dbdee1;font-size:11px;padding:5px 9px;border-radius:5px;border:1px solid #3a3d47}
  code{background:#0d0f14;padding:2px 5px;border-radius:4px;font-family:monospace;font-size:12px}pre{background:#0d0f14;padding:9px;border-radius:7px;font-family:monospace;font-size:12px;overflow:auto}.mention{background:rgba(225,29,72,.16);color:#ff8aa0;padding:1px 5px;border-radius:5px}
  .footer{text-align:center;color:#676c78;font-size:11px;margin-top:20px}
  @media(max-width:800px){.shell{padding:14px 10px 30px}.hero{padding:21px 17px}.hero h1{font-size:23px}.status{position:static;display:inline-block;margin-bottom:12px}.stats{grid-template-columns:repeat(2,1fr)}.layout{grid-template-columns:1fr}.sidebar{position:static}.content-card{padding:13px}}
</style>
</head>
<body>
<div class="shell">
  <section class="hero">
    <div class="brand">${escapeHtml(serverName)} • TICKET TRANSCRIPT</div>
    <h1>سجل التذكرة #${escapeHtml(ticketTitle)}</h1>
    <p>نسخة كاملة ومنظمة من بيانات الطلب، الإجراءات، الرسائل والمرفقات داخل التذكرة.</p>
    <span class="status">${escapeHtml(statusLabel)}</span>
  </section>

  <section class="stats">
    <div class="stat"><small>💬 الرسائل</small><strong>${messageCount}</strong></div>
    <div class="stat"><small>📎 المرفقات</small><strong>${attachmentCount}</strong></div>
    <div class="stat"><small>👤 صاحب التذكرة</small><strong>${escapeHtml(openedName)}</strong></div>
    <div class="stat"><small>🏷️ القسم</small><strong>${escapeHtml(teamName)}</strong></div>
  </section>

  <div class="layout">
    <aside class="sidebar">
      <div class="side-title">بيانات التذكرة</div>
      <div class="person"><div class="label">رقم التذكرة</div><div class="value primary">#${escapeHtml(meta.ticketNumber ?? '—')}</div></div>
      <div class="person"><div class="label">صاحب التذكرة</div><div class="value">${escapeHtml(openedName)}</div></div>
      <div class="person"><div class="label">المستلم</div><div class="value">${escapeHtml(claimedName)}</div></div>
      <div class="person"><div class="label">فريق التذكرة</div><div class="value">${escapeHtml(teamName)}</div></div>
      <div class="person"><div class="label">رتبة الفريق</div><div class="value">${escapeHtml(getTeamRoleNames(channel.guild, typeKey).join(' • ') || '—')}</div></div>
      <div class="person"><div class="label">وقت الإنشاء</div><div class="value">${escapeHtml(meta.openedAt ?? '—')}</div></div>
      <div class="person"><div class="label">أُغلقت بواسطة</div><div class="value">${escapeHtml(closedName)}</div></div>
      <div class="person"><div class="label">وقت الإغلاق</div><div class="value">${escapeHtml(meta.closedAt ?? '—')}</div></div>
    </aside>

    <main class="content-card">
      <div class="section-head"><h2>المحادثة الكاملة</h2><span>من الأقدم إلى الأحدث</span></div>
      <div class="timeline">${rows || '<div>لا توجد رسائل في هذه التذكرة.</div>'}</div>
    </main>
  </div>

  <div class="footer">${escapeHtml(serverName)} • Ticket System • Generated automatically</div>
</div>
</body>
</html>`;

    const tmpDir = path.join(__dirname, '..', 'orders', '_transcripts');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const filePath = path.join(tmpDir, `transcript-${channel.id}-${Date.now()}.html`);
    fs.writeFileSync(filePath, html, 'utf8');
    return filePath;
  },

  async sendTranscript(channel, meta = {}) {
    if (!cfg.channels.transcriptLog) {
      console.warn('[transcriptHandler] ⚠️ TRANSCRIPT_LOG_CHANNEL_ID غير محدد في .env — لن يُرسل أي لوق');
      return;
    }

    let filePath;
    try {
      filePath = await this.buildTranscript(channel, meta);

      const logChannel = await channel.client.channels.fetch(cfg.channels.transcriptLog);
      const ticketType = normalizeTypeKey(meta.typeKey || meta.type);
      const teamName = meta.teamRoleName || getTeamRoleNames(channel.guild, ticketType).join(' • ') || getTeamLabel(ticketType);
      const staffName = meta.claimedBy
        ? await resolveUserName(channel.guild, meta.claimedBy, meta.claimedByUsername || 'غير معروف')
        : null;

      await logChannel.send({
        content:
          `📜 **لوق تذكرة مغلقة:** `#${meta.channelName ?? channel.name}`\\n` +
          `**النوع:** ${meta.type ?? '—'} | **صاحبها:** ${meta.openedByUsername || '—'} | **الفريق:** ${teamName}`,
        files: [{ attachment: filePath, name: `transcript-${channel.name}.html` }],
      });

      // يرسل تقييم الفريق في الخاص للعميل بعد إغلاق التذكرة.
      await sendTeamFeedbackRequest(channel, meta, teamName, staffName);
    } catch (err) {
      console.error('[transcriptHandler] فشل بناء/إرسال الترانسكريبت:', err.message);
    } finally {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  },

  async handleTeamRating(interaction) {
    const parts = String(interaction.customId).split('|');
    if (parts.length !== 4 || parts[0] !== 'teamrate') return false;

    const [, category, ticketId, ratingRaw] = parts;
    const rating = Number(ratingRaw);
    if (!['team', 'staff', 'management'].includes(category) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return false;
    }

    const ticket = db.getTicket(ticketId);
    if (!ticket) {
      await interaction.reply({ content: '❌ انتهت صلاحية رابط التقييم.', ephemeral: true }).catch(() => {});
      return true;
    }

    if (interaction.user.id !== ticket.userId) {
      await interaction.reply({ content: '❌ هذا التقييم مخصص لصاحب التذكرة فقط.' }).catch(() => {});
      return true;
    }

    const teamName = getTeamLabel(ticket.type);
    let staffUsername = null;
    if (ticket.claimedBy) {
      staffUsername = await resolveUserName(interaction.client.guilds.cache.get(ticket.guildId) || null, ticket.claimedBy, ticket.claimedUsername || 'غير معروف');
    }

    const guild = interaction.client.guilds.cache.get(cfg.guildId);
    if (guild && !staffUsername && ticket.claimedUsername) staffUsername = ticket.claimedUsername;

    const feedback = db.saveTeamFeedback({
      ticketId,
      customerId: ticket.userId,
      customerUsername: ticket.userUsername,
      category,
      rating,
      staffId: ticket.claimedBy,
      staffUsername,
      teamName,
    });

    feedback.ticketNumber = ticket.displayNumber;
    await logTeamFeedback(interaction.client, feedback);

    await interaction.reply({
      content: `✅ تم تسجيل تقييمك: **${rating}/5 ⭐** — ${ratingCategoryLabel(category, teamName, staffUsername)}`,
    }).catch(() => {});

    return true;
  },
};