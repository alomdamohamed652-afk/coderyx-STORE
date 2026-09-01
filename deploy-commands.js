'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const cfg = require('./config');

// ─────────────────────────────────────────
//   Deploy Slash Commands
//   شغّل هذا الملف مرة واحدة (أو بعد إضافة
//   أي أمر جديد) لتسجيل الـ Slash Commands
//   عند Discord
//
//   الاستخدام: node deploy-commands.js
// ─────────────────────────────────────────

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command?.data) {
    commands.push(command.data.toJSON());
    console.log(`  → /${command.data.name}`);
  }
}

const rest = new REST().setToken(cfg.token);

(async () => {
  try {
    console.log(`\n[Deploy] تسجيل ${commands.length} أمر...`);

    await rest.put(
      Routes.applicationGuildCommands(cfg.clientId, cfg.guildId),
      { body: commands }
    );

    console.log(`[Deploy] ✅ تم تسجيل ${commands.length} أمر بنجاح في السيرفر.`);
    console.log('[Deploy] قد يستغرق ظهورها في Discord بضع ثوانٍ.\n');
  } catch (err) {
    console.error('[Deploy] ❌ فشل التسجيل:', err.message);
  }
})();
