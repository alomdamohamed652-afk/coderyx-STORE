'use strict';

// ─────────────────────────────────────────
//   Order Status Definitions
//   مصدر واحد لكل حالات الأوردر، تسلسلها،
//   ورسائلها — أي تعديل هنا ينعكس في كل
//   مكان (الأزرار، الإيمبيدات، رسائل DM)
// ─────────────────────────────────────────

const ORDER_STATUSES = {
  pending_review: {
    order: 1,
    emoji: '🟡',
    label: 'بانتظار المراجعة',
    color: 0xFEE75C,
    customerDM: (order) =>
      `تم استلام طلبك \`${order.id}\` بنجاح ✅\n\nسيقوم فريقنا بمراجعته والبدء في التجهيز قريبًا.`,
    ticketMessage: (order) => `📥 تم استلام طلبك \`${order.id}\` وهو الآن بانتظار المراجعة.`,
  },

  in_progress: {
    order: 2,
    emoji: '🔵',
    label: 'جاري التجهيز',
    color: 0x5865F2,
    customerDM: (order) =>
      `🔧 جاري الآن تجهيز طلبك \`${order.id}\`.\n\nسنوافيك بأي تحديث جديد.`,
    ticketMessage: (order) => `🔧 بدأ فريق التطوير في تجهيز طلبك \`${order.id}\`.`,
  },

  testing: {
    order: 3,
    emoji: '🟣',
    label: 'مرحلة الاختبار',
    color: 0xEB459E,
    customerDM: (order) =>
      `🧪 طلبك \`${order.id}\` الآن في مرحلة الاختبار من قبلك.\n\nيرجى تجربة المنتج والتأكد من كل شيء يعمل كما هو متوقع.`,
    ticketMessage: (order) => `🧪 طلبك \`${order.id}\` أصبح في مرحلة الاختبار — يرجى تجربته والتأكيد.`,
  },

  testing_done: {
    order: 4,
    emoji: '✅',
    label: 'تم الانتهاء من الاختبار',
    color: 0x57F287,
    customerDM: (order) =>
      `✅ تم تسجيل انتهاء مرحلة الاختبار لطلبك \`${order.id}\`.\n\nالخطوة التالية: استكمال إجراءات الدفع.`,
    ticketMessage: (order) => `✅ تم الانتهاء من اختبار طلب \`${order.id}\` بنجاح.`,
  },

  awaiting_payment: {
    order: 5,
    emoji: '💰',
    label: 'بانتظار الدفع',
    color: 0xFEE75C,
    customerDM: (order) =>
      `💰 طلبك \`${order.id}\` جاهز — بانتظار إتمام عملية الدفع.\n\nيرجى التواصل مع الفريق داخل تذكرتك لإتمام الدفع.`,
    ticketMessage: (order) => `💰 طلب \`${order.id}\` جاهز الآن وبانتظار الدفع.`,
  },

  payment_pending: {
    order: 6,
    emoji: '🟠',
    label: 'جاري الدفع',
    color: 0xFEE75C,
    customerDM: (order) =>
      `🟠 جاري تأكيد عملية الدفع لطلبك \`${order.id}\`.\n\nسيتواصل معك المسؤول عن المالية قريبًا.`,
    ticketMessage: (order) => `🟠 طلب \`${order.id}\` الآن في انتظار تأكيد الدفع من المسؤول.`,
  },

  paid: {
    order: 7,
    emoji: '💳',
    label: 'تم الدفع',
    color: 0x57F287,
    customerDM: (order) =>
      `💳 تم تأكيد استلام دفعتك لطلب \`${order.id}\` بنجاح. شكرًا لثقتك بـ Codryx!`,
    ticketMessage: (order) => `💳 تم تأكيد الدفع لطلب \`${order.id}\`.`,
  },

  delivered: {
    order: 8,
    emoji: '📦',
    label: 'تم التسليم',
    color: 0x57F287,
    customerDM: (order) =>
      `📦 تم تسليم طلبك \`${order.id}\` بنجاح! نتمنى لك تجربة رائعة مع منتجك الجديد.`,
    ticketMessage: (order) => `📦 تم تسليم طلب \`${order.id}\` بنجاح.`,
  },

  cancelled: {
    order: 9,
    emoji: '🔴',
    label: 'ملغي',
    color: 0xED4245,
    customerDM: (order) =>
      `🔴 تم إلغاء طلبك \`${order.id}\`.\n\nلأي استفسار، يرجى التواصل معنا داخل تذكرتك.`,
    ticketMessage: (order) => `🔴 تم إلغاء طلب \`${order.id}\`.`,
  },
};

// الترتيب الطبيعي للحالات (يُستخدم في عرض الأزرار بترتيب منطقي)
const STATUS_ORDER = [
  'pending_review',
  'in_progress',
  'testing',
  'testing_done',
  'awaiting_payment',
  'payment_pending',
  'paid',
  'delivered',
  'cancelled',
];

module.exports = {
  ORDER_STATUSES,
  STATUS_ORDER,

  get(status) {
    return ORDER_STATUSES[status] ?? null;
  },

  label(status) {
    return ORDER_STATUSES[status]?.label ?? status;
  },

  emoji(status) {
    return ORDER_STATUSES[status]?.emoji ?? '⚪';
  },

  color(status) {
    return ORDER_STATUSES[status]?.color ?? 0x99AAB5;
  },
};
