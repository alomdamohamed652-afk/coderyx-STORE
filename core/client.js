'use strict';

const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');

// ─────────────────────────────────────────
//   Discord Client
// ─────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
  ],
});

// تخزين الـ Wizard Sessions في الميموري (سريع)
client.wizardSessions = new Collection();

module.exports = client;
