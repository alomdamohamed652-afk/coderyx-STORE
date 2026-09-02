'use strict';
require('dotenv').config();

function parseList(value) {
  if (!value) return [];
  return value.split(',').map(v => v.trim()).filter(Boolean);
}

module.exports = {
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,

  channels: {
    ticketPanel:  process.env.TICKET_PANEL_CHANNEL_ID,
    ticketsCat:   process.env.TICKETS_CATEGORY_ID,
    ordersCat:    process.env.ORDERS_CATEGORY_ID,
    ordersLog:    process.env.ORDERS_LOG_CHANNEL_ID,
    customersChannel: process.env.CUSTOMERS_CHANNEL_ID,
    feedbackChannel: process.env.FEEDBACK_CHANNEL_ID,
    transcriptLog: process.env.TRANSCRIPT_LOG_CHANNEL_ID,
    dashboardLog: process.env.DASHBOARD_LOG_CHANNEL_ID,
    categoryByType: {
      purchase:   process.env.PURCHASE_CATEGORY_ID,
      support:    process.env.SUPPORT_CATEGORY_ID,
      inquiry:    process.env.INQUIRY_CATEGORY_ID,
      custom_dev: process.env.CUSTOM_DEV_CATEGORY_ID,
      report:     process.env.REPORT_CATEGORY_ID,
    },
  },

  roles: {
    owner:   parseList(process.env.OWNER_ROLE_IDS),
    support: parseList(process.env.SUPPORT_ROLE_IDS),
    dev:     parseList(process.env.DEV_ROLE_IDS),
    close:   parseList(process.env.CLOSE_ROLE_IDS),
    finance: parseList(process.env.FINANCE_ROLE_IDS),
    dashboard: parseList(process.env.DASHBOARD_ROLE_IDS),
  },

  branding: {
    name:       'Codryx',
    tagline:    'أنظمة احترافية لسيرفرات Discord و FiveM',
    color:      0x5865F2,
    colorDanger: 0xED4245,
    colorSuccess: 0x57F287,
    colorWarn:  0xFEE75C,
    logo:       process.env.STORE_LOGO_URL || 'https://i.imgur.com/placeholder.png',
    ticketBanner: process.env.TICKET_BANNER_URL || 'https://media.discordapp.net/attachments/1486029380802314380/1544325415965958207/CODRYX_animated.gif?ex=6a98c15f&is=6a976fdf&hm=36a9b668c3990d624a45f66ae6f36e13b42b544b53a6f9b096534aee31f18a16&=',
    footer:     'Codryx • أنظمة احترافية',
  },

  orders: {
    folder: './orders',
    prefix: 'ORD',
  },

  products: {
    folder: './products',
  },

  tickets: {
    prefix: 'TKT',
    unclaimedReminderMinutes: Math.max(1, Number(process.env.UNCLAIMED_TICKET_REMINDER_MINUTES || 10)),
  },
};
