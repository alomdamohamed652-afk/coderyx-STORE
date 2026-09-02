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

    const serverName = channel.guild?.name || 'CODRYX STORE';
    const ticketTitle = meta.ticketNumber ?? channel.name;
    const statusLabel = meta.closedAt ? 'مغلقة' : 'مفتوحة';

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(serverName)} • Transcript #${escapeHtml(ticketTitle)}</title>
<style>
  :root {
    --bg:#08090d;
    --panel:#11131a;
    --panel2:#171923;
    --panel3:#1d202b;
    --line:#2a2d38;
    --text:#f4f4f5;
    --muted:#969aa7;
    --red:#e11d48;
    --red2:#f43f5e;
    --red-soft:rgba(225,29,72,.14);
  }
  *{box-sizing:border-box}
  body{
    margin:0;
    background:radial-gradient(circle at 78% -10%,rgba(225,29,72,.13),transparent 34%),var(--bg);
    color:var(--text);
    font-family:"Segoe UI",Tahoma,Arial,sans-serif;
  }
  .shell{max-width:1180px;margin:0 auto;padding:28px 24px 44px}
  .hero{
    position:relative;overflow:hidden;
    background:linear-gradient(135deg,#17131a,#0f1117 60%,#171016);
    border:1px solid rgba(225,29,72,.38);
    border-radius:20px;padding:26px 30px;
    box-shadow:0 18px 55px rgba(0,0,0,.28);
  }
  .hero:after{content:"";position:absolute;inset:auto -100px -100px auto;width:260px;height:260px;background:rgba(225,29,72,.12);filter:blur(50px);border-radius:50%}
  .brand{font-size:12px;font-weight:800;letter-spacing:.8px;color:var(--red2);text-transform:uppercase;margin-bottom:7px}
  .hero h1{margin:0;font-size:30px;line-height:1.2}
  .hero p{margin:9px 0 0;color:#a9adb8;font-size:14px}
  .status{position:absolute;left:28px;top:27px;background:var(--red-soft);border:1px solid rgba(244,63,94,.32);color:#ff8aa0;padding:7px 12px;border-radius:999px;font-size:12px;font-weight:700}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:14px 0}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:16px 18px}
  .stat small{display:block;color:var(--muted);font-size:12px;margin-bottom:7px}
  .stat strong{font-size:21px}
  .layout{display:grid;grid-template-columns:280px 1fr;gap:14px;align-items:start}
  .sidebar,.content-card{background:var(--panel);border:1px solid var(--line);border-radius:16px}
  .sidebar{padding:18px;position:sticky;top:18px}
  .side-title{font-weight:800;margin-bottom:14px}
  .person{padding:12px 0;border-top:1px solid var(--line)}
  .person:first-of-type{border-top:0}
  .label{font-size:11px;color:var(--muted);margin-bottom:5px}
  .value{font-size:14px;word-break:break-word}
  .value .mention{display:inline-block}
  .content-card{padding:20px}
  .section-head{display:flex;justify-content:space-between;align-items:end;margin-bottom:15px}
  .section-head h2{font-size:19px;margin:0}
  .section-head span{font-size:12px;color:var(--muted)}
  .timeline{position:relative;padding-right:18px}
  .timeline:before{content:"";position:absolute;right:5px;top:8px;bottom:8px;width:2px;background:linear-gradient(var(--red),rgba(225,29,72,.08))}
  .event{position:relative;padding:0 0 14px}
  .event:last-child{padding-bottom:0}
  .dot{position:absolute;right:-1px;top:8px;width:12px;height:12px;border-radius:50%;background:var(--red);box-shadow:0 0 0 4px rgba(225,29,72,.12)}
  .event-card{margin-right:22px;background:var(--panel2);border:1px solid var(--line);border-radius:13px;padding:13px 15px}
  .event-head{display:flex;gap:9px;align-items:center;margin-bottom:5px}
  .event-author{font-weight:750;font-size:14px}
  .event-time{font-size:11px;color:var(--muted)}
  .event-text{font-size:14px;line-height:1.65;color:#d7d9df;word-break:break-word}
  .message{display:flex;gap:11px;margin:10px 0;padding:0}
  .avatar{width:36px;height:36px;border-radius:50%;flex:0 0 36px}
  .message-body{min-width:0;flex:1}
  .message-header{display:flex;align-items:center;gap:7px;margin-bottom:2px}
  .username{font-weight:700;color:#fff;font-size:13px}
  .bot-tag{background:#5865f2;color:#fff;font-size:9px;padding:1px 5px;border-radius:4px;font-weight:700}
  .timestamp{font-size:10px;color:#777d8a}
  .msg-content{font-size:14px;line-height:1.55;word-wrap:break-word}
  .embed{border-right:3px solid #5865f2;border-left:0;background:#20222a;border-radius:7px;padding:9px 12px;margin-top:5px;max-width:700px}
  .embed-author{font-size:12px;font-weight:700;color:#fff;margin-bottom:3px}
  .embed-title{font-weight:750;color:#fff;margin-bottom:3px}
  .embed-description{font-size:13px;line-height:1.5;color:#dbdee1}
  .embed-fields{display:flex;flex-wrap:wrap;gap:9px;margin-top:7px}
  .embed-field{font-size:12px}
  .embed-field-name{font-weight:700;color:#fff}
  .embed-field-value{color:#c9ccd2}
  .embed-footer{font-size:10px;color:#949ba4;margin-top:7px}
  .embed-image,.attachment-image{max-width:420px;border-radius:7px;margin-top:7px;display:block}
  .attachment-file{margin-top:6px;font-size:13px}
  .attachment-file a{color:#ff6b86;text-decoration:none}
  .components{margin-top:7px;display:flex;flex-wrap:wrap;gap:5px}
  .fake-button{background:#30323a;color:#fff;font-size:11px;padding:5px 9px;border-radius:5px}
  .fake-select{background:#1a1c22;color:#dbdee1;font-size:11px;padding:5px 9px;border-radius:5px;border:1px solid #3a3d47}
  code{background:#0d0f14;padding:2px 5px;border-radius:4px;font-family:monospace;font-size:12px}
  pre{background:#0d0f14;padding:9px;border-radius:7px;font-family:monospace;font-size:12px;overflow:auto}
  .mention{background:rgba(225,29,72,.16);color:#ff8aa0;padding:1px 5px;border-radius:5px}
  .footer{text-align:center;color:#676c78;font-size:11px;margin-top:20px}
  @media(max-width:800px){
    .shell{padding:14px 10px 30px}.hero{padding:22px 18px}.hero h1{font-size:23px}.status{position:static;display:inline-block;margin-bottom:12px}
    .stats{grid-template-columns:repeat(2,1fr)}.layout{grid-template-columns:1fr}.sidebar{position:static}.content-card{padding:13px}
  }
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
    <div class="stat"><small>💬 الرسائل</small><strong>${messages.length}</strong></div>
    <div class="stat"><small>📎 المرفقات</small><strong>${messages.reduce((n,m)=>n+(m.attachments?.size||0),0)}</strong></div>
    <div class="stat"><small>⚙️ الإجراءات</small><strong>${messages.filter(m=>m.embeds?.some(e=>/إدارة|استلام|إغلاق|فتح|نقل/i.test(e.title||e.data?.title||''))).length}</strong></div>
    <div class="stat"><small>📌 النوع</small><strong>${escapeHtml(meta.type ?? '—')}</strong></div>
  </section>

  <div class="layout">
    <aside class="sidebar">
      <div class="side-title">بيانات التذكرة</div>
      <div class="person"><div class="label">رقم التذكرة</div><div class="value" style="color:var(--red2);font-size:22px;font-weight:800">#${escapeHtml(meta.ticketNumber ?? '—')}</div></div>
      <div class="person"><div class="label">صاحب التذكرة</div><div class="value">${escapeHtml(cleanMentionSyntax(meta.openedBy) ?? '—')}</div></div>
      <div class="person"><div class="label">المستلم</div><div class="value">${escapeHtml(cleanMentionSyntax(meta.claimedBy) ?? 'لم تُستلم')}</div></div>
      <div class="person"><div class="label">وقت الإنشاء</div><div class="value">${escapeHtml(meta.openedAt ?? '—')}</div></div>
      <div class="person"><div class="label">أُغلقت بواسطة</div><div class="value">${escapeHtml(meta.closedBy ?? '—')}</div></div>
      <div class="person"><div class="label">وقت الإغلاق</div><div class="value">${escapeHtml(meta.closedAt ?? '—')}</div></div>
    </aside>

    <main class="content-card">
      <div class="section-head"><h2>المحادثة الكاملة</h2><span>من الأقدم إلى الأحدث</span></div>
      <div class="timeline">
        ${rows || '<div class="event-card">لا توجد رسائل في هذه التذكرة.</div>'}
      </div>
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
