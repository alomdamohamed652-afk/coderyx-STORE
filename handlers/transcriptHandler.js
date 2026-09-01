'use strict';

const fs   = require('fs');
const path = require('path');
const cfg  = require('../config');

// ─────────────────────────────────────────
//   Transcript Handler
//   يجمع كل رسائل التذكرة ويبنيها كملف HTML
//   منسّق يشبه واجهة Discord، ثم يرفعه
//   إلى قناة لوج مخصصة بعد إغلاق التذكرة
// ─────────────────────────────────────────

function cleanMentionSyntax(str = '') {
  if (!str) return str;
  return String(str)
    .replace(/<@!?(\d+)>/g, '@User($1)')
    .replace(/<@&(\d+)>/g, '@Role($1)')
    .replace(/<#(\d+)>/g, '#Channel($1)');
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// تحويل بعض صيغ Discord Markdown الأساسية إلى HTML (بدون مكتبات خارجية)
function renderContent(content = '') {
  let text = escapeHtml(content);

  // كتل الكود ```...```
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => `<pre>${code}</pre>`);
  // كود سطري `...`
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // عريض **...**
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // مائل *...* أو _..._
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // روابط Discord IDs الأساسية: <@id> <#id> <@&id>
  text = text.replace(/&lt;@!?(\d+)&gt;/g, '<span class="mention">@User($1)</span>');
  text = text.replace(/&lt;#(\d+)&gt;/g, '<span class="mention">#Channel($1)</span>');
  text = text.replace(/&lt;@&amp;(\d+)&gt;/g, '<span class="mention">@Role($1)</span>');
  // أسطر جديدة
  text = text.replace(/\n/g, '<br>');

  return text;
}

function renderEmbed(embed) {
  const color = embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : '#5865F2';
  let html = `<div class="embed" style="border-left-color:${color}">`;

  if (embed.author?.name) {
    html += `<div class="embed-author">${escapeHtml(embed.author.name)}</div>`;
  }
  if (embed.title) {
    html += `<div class="embed-title">${escapeHtml(embed.title)}</div>`;
  }
  if (embed.description) {
    html += `<div class="embed-description">${renderContent(embed.description)}</div>`;
  }
  if (embed.fields?.length) {
    html += '<div class="embed-fields">';
    for (const field of embed.fields) {
      html += `<div class="embed-field"><div class="embed-field-name">${escapeHtml(field.name)}</div><div class="embed-field-value">${renderContent(field.value)}</div></div>`;
    }
    html += '</div>';
  }
  if (embed.image?.url) {
    html += `<img class="embed-image" src="${escapeHtml(embed.image.url)}" />`;
  }
  if (embed.footer?.text) {
    html += `<div class="embed-footer">${escapeHtml(embed.footer.text)}</div>`;
  }

  html += '</div>';
  return html;
}

function renderComponents(components) {
  if (!components?.length) return '';
  let html = '<div class="components">';
  for (const row of components) {
    for (const comp of row.components ?? []) {
      if (comp.type === 2) { // Button
        const label = comp.label ?? comp.emoji?.name ?? 'زر';
        html += `<span class="fake-button">${escapeHtml(label)}</span>`;
      } else if (comp.type === 3) { // Select Menu
        const placeholder = comp.placeholder ?? 'قائمة اختيار';
        html += `<span class="fake-select">▾ ${escapeHtml(placeholder)}</span>`;
      }
    }
  }
  html += '</div>';
  return html;
}

module.exports = {

  /**
   * يجمع كل رسائل القناة (بالترتيب الزمني الصحيح)
   * @param {TextChannel} channel
   * @returns {Promise<Message[]>}
   */
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

    // ترتيب من الأقدم للأحدث (Discord بترجعهم من الأحدث للأقدم)
    return messages.reverse();
  },

  /**
   * يبني ملف HTML كامل من رسائل التذكرة
   * @param {TextChannel} channel
   * @param {object} meta - معلومات إضافية (نوع التذكرة، صاحبها، من أغلقها...)
   * @returns {Promise<string>} مسار الملف المؤقت
   */
  async buildTranscript(channel, meta = {}) {
    const messages = await this.fetchAllMessages(channel);

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
          bodyHtml += `<img class="attachment-image" src="${escapeHtml(att.url)}" />`;
        } else {
          bodyHtml += `<div class="attachment-file">📎 <a href="${escapeHtml(att.url)}">${escapeHtml(att.name)}</a></div>`;
        }
      }

      if (!bodyHtml) bodyHtml = '<div class="msg-content"><em>(رسالة بدون محتوى ظاهر)</em></div>';

      return `
        <div class="message">
          <img class="avatar" src="${escapeHtml(avatarUrl)}" />
          <div class="message-body">
            <div class="message-header">
              <span class="username">${escapeHtml(msg.author.username)}</span>
              ${isBot ? '<span class="bot-tag">APP</span>' : ''}
              <span class="timestamp">${time}</span>
            </div>
            ${bodyHtml}
          </div>
        </div>`;
    }).join('\n');

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>Transcript - ${escapeHtml(meta.channelName ?? channel.name)}</title>
<style>
  body { background:#313338; color:#dbdee1; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; margin:0; padding:0; }
  .header { background:#2b2d31; padding:20px 30px; border-bottom:1px solid #1e1f22; }
  .header h1 { margin:0 0 8px; font-size:20px; color:#fff; }
  .header .meta-row { font-size:13px; color:#949ba4; margin:2px 0; }
  .messages { max-width: 900px; margin: 0 auto; padding: 20px 30px; }
  .message { display:flex; gap:14px; padding:10px 0; }
  .avatar { width:40px; height:40px; border-radius:50%; flex-shrink:0; }
  .message-body { flex:1; min-width:0; }
  .message-header { display:flex; align-items:baseline; gap:8px; margin-bottom:2px; }
  .username { font-weight:600; color:#f2f3f5; }
  .bot-tag { background:#5865F2; color:#fff; font-size:10px; padding:1px 5px; border-radius:3px; font-weight:600; }
  .timestamp { font-size:12px; color:#949ba4; }
  .msg-content { font-size:15px; line-height:1.4; word-wrap:break-word; }
  .embed { border-left:4px solid #5865F2; background:#2b2d31; border-radius:4px; padding:10px 14px; margin-top:6px; max-width:520px; }
  .embed-author { font-size:13px; font-weight:600; color:#fff; margin-bottom:4px; }
  .embed-title { font-weight:700; color:#fff; margin-bottom:4px; }
  .embed-description { font-size:14px; line-height:1.4; color:#dbdee1; }
  .embed-fields { display:flex; flex-wrap:wrap; gap:10px; margin-top:8px; }
  .embed-field { font-size:13px; }
  .embed-field-name { font-weight:700; color:#fff; margin-bottom:2px; }
  .embed-field-value { color:#dbdee1; }
  .embed-footer { font-size:11px; color:#949ba4; margin-top:8px; }
  .embed-image { max-width:400px; border-radius:4px; margin-top:8px; display:block; }
  .attachment-image { max-width:400px; border-radius:4px; margin-top:6px; display:block; }
  .attachment-file { margin-top:6px; font-size:14px; }
  .attachment-file a { color:#00a8fc; text-decoration:none; }
  .components { margin-top:8px; display:flex; flex-wrap:wrap; gap:6px; }
  .fake-button { background:#4e5058; color:#fff; font-size:13px; padding:6px 12px; border-radius:4px; display:inline-block; }
  .fake-select { background:#1e1f22; color:#dbdee1; font-size:13px; padding:6px 12px; border-radius:4px; display:inline-block; border:1px solid #4e5058; }
  code { background:#1e1f22; padding:2px 5px; border-radius:3px; font-family:monospace; font-size:13px; }
  pre { background:#1e1f22; padding:10px; border-radius:4px; font-family:monospace; font-size:13px; overflow-x:auto; }
  .mention { background:rgba(88,101,242,0.3); color:#c9cdfb; padding:0 3px; border-radius:3px; }
</style>
</head>
<body>
  <div class="header">
    <h1>📜 سجل تذكرة — #${escapeHtml(meta.channelName ?? channel.name)}</h1>
    <div class="meta-row">نوع التذكرة: ${escapeHtml(meta.type ?? '—')}</div>
    <div class="meta-row">صاحب التذكرة: ${escapeHtml(cleanMentionSyntax(meta.openedBy) ?? '—')}</div>
    <div class="meta-row">تاريخ الفتح: ${escapeHtml(meta.openedAt ?? '—')}</div>
    ${meta.claimedBy ? `<div class="meta-row">استُلمت بواسطة: ${escapeHtml(cleanMentionSyntax(meta.claimedBy))}</div>` : ''}
    ${meta.requestedCloseBy ? `<div class="meta-row">طلب الإغلاق: ${escapeHtml(meta.requestedCloseBy)}${meta.requestedCloseAt ? ' — ' + escapeHtml(meta.requestedCloseAt) : ''}</div>` : ''}
    <div class="meta-row">تاريخ الإغلاق (الحذف الفعلي): ${escapeHtml(meta.closedAt ?? '—')}</div>
    <div class="meta-row">أكّد الحذف: ${escapeHtml(meta.closedBy ?? '—')}</div>
    <div class="meta-row">عدد الرسائل: ${messages.length}</div>
  </div>
  <div class="messages">
    ${rows || '<p style="color:#949ba4;">لا توجد رسائل في هذه التذكرة.</p>'}
  </div>
</body>
</html>`;

    const tmpDir = path.join(__dirname, '..', 'orders', '_transcripts');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const filePath = path.join(tmpDir, `transcript-${channel.id}-${Date.now()}.html`);
    fs.writeFileSync(filePath, html, 'utf8');

    return filePath;
  },

  /**
   * يبني الترانسكريبت ويرفعه لقناة اللوق المخصصة، ثم يحذف الملف المؤقت
   */
  async sendTranscript(channel, meta = {}) {
    if (!cfg.channels.transcriptLog) {
      console.warn('[transcriptHandler] ⚠️ TRANSCRIPT_LOG_CHANNEL_ID غير محدد في .env — لن يُرسل أي لوق');
      return;
    }

    let filePath;
    try {
      filePath = await this.buildTranscript(channel, meta);

      const logChannel = await channel.client.channels.fetch(cfg.channels.transcriptLog);
      await logChannel.send({
        content:
          `📜 **لوق تذكرة مغلقة:** \`#${meta.channelName ?? channel.name}\`\n` +
          `**النوع:** ${meta.type ?? '—'} | **صاحبها:** ${meta.openedBy ?? '—'} | **أُغلقت بواسطة:** ${meta.closedBy ?? '—'}`,
        files: [{ attachment: filePath, name: `transcript-${channel.name}.html` }],
      });
    } catch (err) {
      console.error('[transcriptHandler] فشل بناء/إرسال الترانسكريبت:', err.message);
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  },
};
