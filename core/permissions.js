'use strict';

module.exports = {
  hasAnyRole(member, roleIds) {
    if (!member || !roleIds || roleIds.length === 0) return false;
    return roleIds.some(roleId => member.roles.cache.has(roleId));
  },

  isOwner(member, cfg) {
    return this.hasAnyRole(member, cfg.roles.owner);
  },

  isAdmin(member, cfg) {
    return this.isOwner(member, cfg) || this.hasAnyRole(member, cfg.roles.admin);
  },

  isSupport(member, cfg) {
    return this.isOwner(member, cfg) || this.hasAnyRole(member, cfg.roles.support);
  },

  isDev(member, cfg) {
    return this.isOwner(member, cfg) || this.hasAnyRole(member, cfg.roles.dev);
  },

  isFinance(member, cfg) {
    return this.isOwner(member, cfg) || this.hasAnyRole(member, cfg.roles.finance);
  },

  isDashboardAdmin(member, cfg) {
    return this.isAdmin(member, cfg);
  },

  // إدارة التذاكر محصورة في الإدارة/الفاونر.
  // الدعم والتطوير يملكون الاستلام حسب القسم فقط.
  isTicketManager(member, cfg) {
    return this.isAdmin(member, cfg);
  },

  canClaim(member, cfg) {
    return this.isAdmin(member, cfg) || this.isSupport(member, cfg) || this.isDev(member, cfg);
  },

  canClaimType(member, cfg, ticketType) {
    if (this.isAdmin(member, cfg)) return true;

    const devTypes = ['purchase', 'custom_dev'];
    if (devTypes.includes(ticketType)) return this.isDev(member, cfg);

    return this.isSupport(member, cfg);
  },

  // حذف/تأكيد إغلاق التذكرة: الإدارة أو الفاونر فقط.
  isCloser(member, cfg) {
    return this.isAdmin(member, cfg);
  },

  buildRoleOverwrites(guild, roleIds, allowPerms) {
    const overwrites = [];
    for (const roleId of roleIds || []) {
      const role = guild.roles.cache.get(roleId);
      if (role) overwrites.push({ id: role.id, allow: allowPerms });
      else console.warn(`[permissions] ⚠️ Role ID غير موجود في السيرفر: ${roleId}`);
    }
    return overwrites;
  },

  mentionRoles(guild, roleIds) {
    const valid = (roleIds || []).filter(id => guild.roles.cache.has(id));
    return valid.map(id => `<@&${id}>`).join(' ');
  },
};
