'use strict';

// ─────────────────────────────────────────
//   Permissions Helper
//   يدعم التحقق من رتب متعددة (Array)
// ─────────────────────────────────────────

module.exports = {

  /**
   * يتحقق إن العضو يمتلك رتبة واحدة على الأقل من القائمة
   * @param {GuildMember} member
   * @param {string[]} roleIds
   * @returns {boolean}
   */
  hasAnyRole(member, roleIds) {
    if (!member || !roleIds || roleIds.length === 0) return false;
    return roleIds.some(roleId => member.roles.cache.has(roleId));
  },

  isOwner(member, cfg) {
    return this.hasAnyRole(member, cfg.roles.owner);
  },

  isSupport(member, cfg) {
    return this.hasAnyRole(member, cfg.roles.support) || this.isOwner(member, cfg);
  },

  isDev(member, cfg) {
    return this.hasAnyRole(member, cfg.roles.dev) || this.isOwner(member, cfg);
  },

  // المسؤول عن المالية (يستلم ويؤكد عمليات الدفع)
  isFinance(member, cfg) {
    return this.hasAnyRole(member, cfg.roles.finance) || this.isOwner(member, cfg);
  },

  // صلاحية إدارة المنتجات (Dashboard) — Founder/CEO/Developer أو أي رتب محددة في DASHBOARD_ROLE_IDS
  isDashboardAdmin(member, cfg) {
    return this.hasAnyRole(member, cfg.roles.dashboard) || this.isOwner(member, cfg);
  },

  // إدارة التذاكر: أي عضو يملك واحدة على الأقل من الرتب المحددة
  // في OWNER/SUPPORT/DEV/CLOSE/FINANCE/DASHBOARD يستطيع استخدام لوحة الإدارة.
  isTicketManager(member, cfg) {
    if (!member) return false;
    const roleGroups = [
      cfg.roles.owner,
      cfg.roles.support,
      cfg.roles.dev,
      cfg.roles.close,
      cfg.roles.finance,
      cfg.roles.dashboard,
    ];
    return roleGroups.some(ids => this.hasAnyRole(member, ids));
  },

  // يستطيع استلام التذاكر (فريق الدعم + فريق التطوير + المالك) — استخدام عام
  canClaim(member, cfg) {
    return this.isOwner(member, cfg) || this.isSupport(member, cfg) || this.isDev(member, cfg);
  },

  /**
   * يحدد الفريق المخصص لاستلام تذكرة بناءً على نوعها:
   * شراء منتج / تطوير خاص → فريق التطوير
   * دعم فني / استفسار / بلاغ → فريق الدعم
   * المالك يستطيع استلام أي نوع دائمًا
   */
  canClaimType(member, cfg, ticketType) {
    if (this.isOwner(member, cfg)) return true;

    const devTypes = ['purchase', 'custom_dev'];
    if (devTypes.includes(ticketType)) {
      return this.isDev(member, cfg);
    }

    return this.isSupport(member, cfg);
  },

  // يستطيع الحذف الفعلي للتذكرة (رتب CLOSE_ROLE_IDS فقط، بالإضافة إلى المالك)
  isCloser(member, cfg) {
    return this.hasAnyRole(member, cfg.roles.close) || this.isOwner(member, cfg);
  },

  /**
   * يبني صف Permission Overwrites لقائمة رتب (للقنوات)
   * يتجاهل أي Role ID غير موجود فعليًا في السيرفر
   */
  buildRoleOverwrites(guild, roleIds, allowPerms) {
    const overwrites = [];
    for (const roleId of roleIds || []) {
      const role = guild.roles.cache.get(roleId);
      if (role) {
        overwrites.push({ id: role.id, allow: allowPerms });
      } else {
        console.warn(`[permissions] ⚠️ Role ID غير موجود في السيرفر: ${roleId}`);
      }
    }
    return overwrites;
  },

  /**
   * يبني نص منشن لكل الرتب الموجودة في القائمة
   */
  mentionRoles(guild, roleIds) {
    const valid = (roleIds || []).filter(id => guild.roles.cache.has(id));
    if (valid.length === 0) return '';
    return valid.map(id => `<@&${id}>`).join(' ');
  },
};
