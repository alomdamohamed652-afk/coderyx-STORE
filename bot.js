'use strict';

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const client             = require('./core/client');
const registry           = require('./core/registry');
const cfg                = require('./config');
const permissions        = require('./core/permissions');
const interactionHandler = require('./handlers/interactionHandler');
const panelHandler       = require('./handlers/panelHandler');
const db                 = require('./core/database');
const embeds             = require('./core/embeds');

// ─────────────────────────────────────────
//   حماية من تشغيل أكثر من نسخة من البوت
//   في نفس الوقت (سبب شائع لمشاكل التفاعلات
//   المكررة وظهور البانل مرتين)
// ─────────────────────────────────────────

const LOCK_FILE = path.join(__dirname, '.bot.lock');

function checkSingleInstance() {
  if (fs.existsSync(LOCK_FILE)) {
    const oldPid = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    let stillRunning = false;

    // التحقق هل الـ process القديم لسه شغال فعليًا أم أنه lock قديم متبقٍ من إغلاق غير نظيف
    try {
      process.kill(Number(oldPid), 0); // لا يقتل العملية، فقط يفحص وجودها
      stillRunning = true;
    } catch {
      stillRunning = false;
    }

    if (stillRunning) {
      console.error('\n🔴 يوجد نسخة أخرى من البوت تعمل الآن بالفعل!');
      console.error(`   Process ID: ${oldPid}`);
      console.error('   هذا سبب شائع لمشاكل: ظهور البانل مرتين، وأخطاء "Unknown interaction".');
      console.error('   أغلق النسخة القديمة (Ctrl+C في نافذتها أو Task Manager) ثم أعد التشغيل.\n');
      process.exit(1);
    } else {
      console.warn('[Bot] ⚠️ تم العثور على lock قديم من إغلاق غير نظيف — يتم تجاوزه.');
    }
  }

  fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');

  // تنظيف الـ lock عند إغلاق البوت بشكل طبيعي
  const cleanup = () => {
    try { fs.unlinkSync(LOCK_FILE); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', () => {
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  });
}

checkSingleInstance();

// ─────────────────────────────────────────
//   Codryx Store Bot
//   النظام الداخلي لإدارة منتجات Codryx
// ─────────────────────────────────────────

// تحميل جميع المنتجات عند البدء
registry.load();

// ─── Validate Environment ─────────────────

function validateEnv() {
  const requiredSingle = {
    'BOT_TOKEN':                cfg.token,
    'CLIENT_ID':                cfg.clientId,
    'GUILD_ID':                 cfg.guildId,
    'TICKET_PANEL_CHANNEL_ID':  cfg.channels.ticketPanel,
    'TICKETS_CATEGORY_ID':      cfg.channels.ticketsCat,
    'ORDERS_CATEGORY_ID':       cfg.channels.ordersCat,
    'ORDERS_LOG_CHANNEL_ID':    cfg.channels.ordersLog,
  };

  const requiredLists = {
    'OWNER_ROLE_IDS':   cfg.roles.owner,
    'SUPPORT_ROLE_IDS': cfg.roles.support,
    'DEV_ROLE_IDS':     cfg.roles.dev,
    'CLOSE_ROLE_IDS':   cfg.roles.close,
    'FINANCE_ROLE_IDS': cfg.roles.finance,
    'DASHBOARD_ROLE_IDS': cfg.roles.dashboard,
  };

  const missing = [];

  for (const [k, v] of Object.entries(requiredSingle)) {
    if (!v || v.includes('your_')) missing.push(k);
  }
  for (const [k, v] of Object.entries(requiredLists)) {
    if (!v || v.length === 0) missing.push(k);
  }

  if (missing.length > 0) {
    console.warn('\n⚠️  تحذير: القيم التالية غير محددة بشكل صحيح في .env:');
    missing.forEach(k => console.warn(`   - ${k}`));
    console.warn('   البوت سيعمل، لكن بعض الميزات قد تفشل أو تُعطَّل.\n');
  }
}

validateEnv();

// ─── Load Slash Commands ──────────────────

client.commands = new Map();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command?.data?.name) {
    client.commands.set(command.data.name, command);
  }
}

// ─── Events ──────────────────────────────

client.once('clientReady', async () => {
  console.log(`\n╔══════════════════════════════════╗`);
  console.log(`║   Codryx Store Bot               ║`);
  console.log(`║   ${client.user.tag.padEnd(30)}║`);
  console.log(`║   Products: ${String(registry.count()).padEnd(21)}║`);
  console.log(`║   Slash Commands: ${String(client.commands.size).padEnd(15)}║`);
  console.log(`╚══════════════════════════════════╝\n`);
  console.log('Slash: /panel | /reload | /orders | /order');
  console.log('Prefix: !panel | !reload | !orders | !order <ID>');

  client.user.setPresence({
    activities: [{ name: '🛒 Codryx Store', type: 3 }],
    status: 'online',
  });

  // ─── فحص حقيقي: هل الـ IDs موجودة فعليًا في هذا السيرفر؟ ───
  try {
    const guild = await client.guilds.fetch(cfg.guildId);
    await guild.roles.fetch();
    await guild.channels.fetch();

    const roleChecks = [
      { label: 'OWNER_ROLE_IDS',   ids: cfg.roles.owner },
      { label: 'SUPPORT_ROLE_IDS', ids: cfg.roles.support },
      { label: 'DEV_ROLE_IDS',     ids: cfg.roles.dev },
      { label: 'CLOSE_ROLE_IDS',   ids: cfg.roles.close },
      { label: 'FINANCE_ROLE_IDS', ids: cfg.roles.finance },
      { label: 'DASHBOARD_ROLE_IDS', ids: cfg.roles.dashboard },
    ];

    const channelChecks = [
      { label: 'TICKETS_CATEGORY_ID',     id: cfg.channels.ticketsCat },
      { label: 'ORDERS_CATEGORY_ID',      id: cfg.channels.ordersCat },
      { label: 'ORDERS_LOG_CHANNEL_ID',   id: cfg.channels.ordersLog },
      { label: 'TICKET_PANEL_CHANNEL_ID', id: cfg.channels.ticketPanel },
      { label: 'CUSTOMERS_CHANNEL_ID',    id: cfg.channels.customersChannel },
      { label: 'FEEDBACK_CHANNEL_ID',     id: cfg.channels.feedbackChannel },
      { label: 'TRANSCRIPT_LOG_CHANNEL_ID', id: cfg.channels.transcriptLog },
      { label: 'DASHBOARD_LOG_CHANNEL_ID', id: cfg.channels.dashboardLog },
    ];

    const brokenRoles = [];
    for (const check of roleChecks) {
      for (const id of check.ids) {
        if (!guild.roles.cache.has(id)) brokenRoles.push(`${check.label}: ${id}`);
      }
    }

    const brokenChannels = channelChecks.filter(c => c.id && !guild.channels.cache.has(c.id));

    if (brokenRoles.length > 0 || brokenChannels.length > 0) {
      console.warn('\n🔴 تحذير مهم: الـ IDs التالية في .env غير موجودة في هذا السيرفر:');
      brokenRoles.forEach(r => console.warn(`   - ${r}  (رتبة غير موجودة)`));
      brokenChannels.forEach(c => console.warn(`   - ${c.label} = ${c.id}  (قناة/كاتيقوري غير موجودة)`));
      console.warn('   تحقق من: هل الـ ID صحيح؟ هل هو من سيرفر آخر؟\n');
    } else {
      console.log('✅ تم التحقق: جميع الـ IDs المحددة في .env موجودة وصحيحة في هذا السيرفر.\n');
    }
  } catch (err) {
    console.error('[Bot] فشل التحقق من السيرفر:', err.message);
    console.error('تحقق من أن GUILD_ID صحيح وأن البوت داخل هذا السيرفر.\n');
  }
});

// ─── Interactions ─────────────────────────

client.on('interactionCreate', async (interaction) => {
  try {
    // Slash Commands
    if (interaction.isChatInputCommand()) {
      // منع تنفيذ نفس الأمر مرتين بسرعة من نفس المستخدم (مثل الضغط مرتين على Enter)
      if (interactionHandler.isDuplicateInteraction(interaction)) {
        console.warn(`[Bot] تم تجاهل تنفيذ مكرر سريع لأمر /${interaction.commandName} من ${interaction.user.tag}`);
        return;
      }

      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      return await command.execute(interaction);
    }

    // Buttons / Select Menus
    await interactionHandler.handle(interaction, client);
  } catch (err) {
    // كود 10062 = Unknown interaction (انتهت صلاحيتها قبل الرد، عادة بسبب تأخير شبكة)
    // كود 40060 = already acknowledged (تم الرد عليها مرتين)
    // هذه الحالات لا فائدة من محاولة الرد عليها مجددًا — نتجاهلها بصمت بعد تسجيلها مرة واحدة
    if (err?.code === 10062 || err?.code === 40060) {
      console.warn(`[Bot] تفاعل منتهي الصلاحية (code ${err.code}) — تم تجاهله.`);
      return;
    }

    console.error('[Bot] Interaction error:', err);
    const reply = { content: '❌ حدث خطأ غير متوقع.', ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    } catch {
      // التفاعل انتهى أيضًا أثناء محاولة إرسال رسالة الخطأ — تجاهل
    }
  }
});

// ─── Messages (Prefix Commands فقط) ───────

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isOwner   = permissions.isOwner(message.member, cfg);
  const isDevTeam = permissions.isDev(message.member, cfg);
  const content   = message.content.trim();

  // ── !panel ──────────────────────────
  if (content === '!panel') {
    if (!isOwner) return;
    return panelHandler.send(message);
  }

  // ── !reload ──────────────────────────
  if (content === '!reload') {
    if (!isOwner) return;
    registry.load();
    message.reply(`✅ تم إعادة تحميل ${registry.count()} منتج`).then(m => {
      setTimeout(() => m.delete().catch(() => {}), 4000);
    });
    message.delete().catch(() => {});
    return;
  }

  // ── !orders ──────────────────────────
  if (content === '!orders') {
    if (!isOwner && !isDevTeam) return;
    message.delete().catch(() => {});

    const raw    = db._read();
    const orders = Object.values(raw.orders ?? {});

    if (orders.length === 0) {
      return message.channel.send({ embeds: [embeds.info('لا توجد أوردرات', 'لم يتم إنشاء أي طلب حتى الآن.')] });
    }

    const recent = orders.slice(-10).reverse();
    const orderStatus = require('./core/orderStatus');

    const lines = recent.map(o => {
      const emoji = orderStatus.emoji(o.status);
      const date  = new Date(o.createdAt).toLocaleDateString('ar-SA');
      return `${emoji} \`${o.id}\` — **${o.product?.id ?? '?'}** — ${o.customer?.username ?? '?'} — ${date}`;
    }).join('\n');

    await message.channel.send({
      embeds: [embeds.info(`📋 آخر ${recent.length} طلب`, lines)],
    });
    return;
  }

  // ── !order <ID> ───────────────────────
  if (content.startsWith('!order ')) {
    if (!isOwner && !isDevTeam) return;
    message.delete().catch(() => {});

    const orderId = content.split(' ')[1]?.toUpperCase();
    const order   = db.getOrder(orderId);

    if (!order) {
      return message.channel.send({ embeds: [embeds.error(`الأوردر \`${orderId}\` غير موجود.`)] });
    }

    const product = registry.getById(order.product?.id);
    const plan    = product?.plans[parseInt(order.product?.planId, 10)];

    await message.channel.send({
      embeds: [embeds.orderSummary(order, product ?? { name: order.product?.id }, plan ?? { name: order.product?.planId, price: '?', currency: '' })],
    });
    return;
  }
});

// ─── Error Handling ───────────────────────

client.on('error', (err) => {
  console.error('[Client] Error:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('[Process] Unhandled rejection:', err?.message ?? err);
});

// ─── Login ────────────────────────────────

client.login(cfg.token);
