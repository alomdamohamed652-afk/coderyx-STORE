'use strict';

// ─────────────────────────────────────────
//   Payment Methods Config
//   كل طريقة دفع = عنصر واحد في هذه القائمة
//
//   لإضافة طريقة دفع جديدة: أضف عنصرًا جديدًا بنفس الشكل.
//   لحذف طريقة: احذف العنصر أو غيّر "active" إلى false.
//   لا حاجة لتعديل أي كود آخر — الأزرار والرسائل تُبنى تلقائيًا من هنا.
// ─────────────────────────────────────────

const PAYMENT_METHODS = [
  {
    id: 'wallet',
    active: true,
    label: 'محفظة',
    emoji: '💼',
    // الوصف الذي يظهر للعميل بعد اختيار هذه الطريقة (تفاصيل التحويل)
    instructions: 'يمكنك التحويل على رقم المحفظة: **01000000000**',
  },
  {
    id: 'instapay',
    active: true,
    label: 'إنستا باي',
    emoji: '📲',
    instructions: 'يمكنك التحويل عبر إنستا باي على: **example@instapay**',
  },
  {
    id: 'binance',
    active: true,
    label: 'بايننس',
    emoji: '🟡',
    instructions: 'يمكنك التحويل عبر Binance Pay على ID: **123456789**',
  },

  // مثال لإضافة طريقة دفع جديدة (مفعّلة فورًا بعد /reload أو إعادة التشغيل):
  // {
  //   id: 'vodafone_cash',
  //   active: true,
  //   label: 'فودافون كاش',
  //   emoji: '🔴',
  //   instructions: 'يمكنك التحويل على رقم فودافون كاش: **01000000000**',
  // },
];

module.exports = {
  PAYMENT_METHODS,

  getAll() {
    return PAYMENT_METHODS.filter(m => m.active);
  },

  get(id) {
    return PAYMENT_METHODS.find(m => m.id === id) ?? null;
  },

  label(id) {
    return this.get(id)?.label ?? id;
  },

  emoji(id) {
    return this.get(id)?.emoji ?? '💳';
  },

  labelWithEmoji(id) {
    const m = this.get(id);
    return m ? `${m.emoji} ${m.label}` : id;
  },
};
