'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const registry = require('./registry');

// ─────────────────────────────────────────
//   Dashboard Components
//   كل الأزرار والقوائم الخاصة بلوحة الإدارة
// ─────────────────────────────────────────

module.exports = {

  // ───────────────────────────────────
  //   MAIN DASHBOARD BUTTONS
  // ───────────────────────────────────

  mainDashboardButtons() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('dash_add_product').setLabel('➕ إضافة منتج').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('dash_edit_product').setLabel('✏️ تعديل منتج').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('dash_view_products').setLabel('👁️ عرض المنتجات').setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('dash_statistics').setLabel('📊 الإحصائيات').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('dash_payment_methods').setLabel('💳 طرق الدفع').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('dash_categories').setLabel('🗂️ الفئات').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('dash_settings').setLabel('⚙️ الإعدادات').setStyle(ButtonStyle.Secondary),
      ),
    ];
  },

  // ───────────────────────────────────
  //   PRODUCT SELECT (للتعديل)
  // ───────────────────────────────────

  productSelectForEdit() {
    const products = registry.getAll();
    const options = products.map(p => ({
      label: p.name,
      value: p.id,
      description: `${p.visibility === 'visible' ? '👁️ ظاهر' : '👁️‍🗨️ مخفي'} • ${p.availability === 'active' ? '🟢 متاح' : '🛠️ صيانة'}`,
    }));

    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('dash_select_product')
        .setPlaceholder('اختر منتجًا لتعديله...')
        .addOptions(options.length ? options : [{ label: 'لا توجد منتجات', value: 'none' }])
    );
  },

  // ───────────────────────────────────
  //   PRODUCT CONTROL BUTTONS (لوحة منتج واحد)
  // ───────────────────────────────────

  productControlButtons(product) {
    const visToggleLabel = product.visibility === 'visible' ? '🔒 إخفاء' : '👁️ إظهار';
    const visToggleStyle = product.visibility === 'visible' ? ButtonStyle.Danger : ButtonStyle.Success;
    const availToggleLabel = product.availability === 'active' ? '🛠️ صيانة' : '🟢 تفعيل';
    const availToggleStyle = product.availability === 'active' ? ButtonStyle.Secondary : ButtonStyle.Success;

    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`dash_p_avail_${product.id}`).setLabel(availToggleLabel).setStyle(availToggleStyle),
        new ButtonBuilder().setCustomId(`dash_p_vis_${product.id}`).setLabel(visToggleLabel).setStyle(visToggleStyle),
        new ButtonBuilder().setCustomId(`dash_p_badge_${product.id}`).setLabel('🏷️ Badge').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`dash_p_category_${product.id}`).setLabel('🗂️ الفئة').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`dash_p_version_${product.id}`).setLabel('🔄 الإصدار').setStyle(ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`dash_p_name_${product.id}`).setLabel('✏️ الاسم').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`dash_p_desc_${product.id}`).setLabel('📝 الوصف').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`dash_p_price_${product.id}`).setLabel('💰 السعر').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`dash_p_color_${product.id}`).setLabel('🎨 اللون').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`dash_p_features_${product.id}`).setLabel('⭐ المميزات').setStyle(ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`dash_p_images_${product.id}`).setLabel('🖼️ الصور').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`dash_p_plans_${product.id}`).setLabel('📦 الباقات').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`dash_p_order_up_${product.id}`).setLabel('⬆️ ترتيب').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`dash_p_order_down_${product.id}`).setLabel('⬇️ ترتيب').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`dash_p_refresh_${product.id}`).setLabel('🔄 تحديث').setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('dash_back_to_list').setLabel('↩️ رجوع للمنتجات').setStyle(ButtonStyle.Secondary),
      ),
    ];
  },

  categoryAdminModal() {
    const modal = new ModalBuilder()
      .setCustomId('dash_modal_category_add')
      .setTitle('إضافة تصنيف');

    const input = new TextInputBuilder()
      .setCustomId('category_name')
      .setLabel('اسم التصنيف الجديد')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(80)
      .setPlaceholder('مثال: FiveM أو Systems');

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return modal;
  },

  categoryManagementButtons() {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('dash_category_add').setLabel('➕ إضافة').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('dash_category_mode').setLabel('🖥️ طريقة العرض').setStyle(ButtonStyle.Primary),
    );
  },

  categoryManageSelect(categories = []) {
    const options = categories.slice(0, 25).map(c => ({
      label: String(c.name).slice(0, 100),
      value: c.id,
      description: `${c.id} • ${c.path.join(' > ')}`.slice(0, 100),
    }));
    if (!options.length) options.push({ label: 'لا توجد تصنيفات', value: 'none' });

    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('dash_category_manage_select')
        .setPlaceholder('📁 اختر تصنيفًا لإدارته...')
        .addOptions(options)
    );
  },

  categoryParentSelect(categories = []) {
    const options = [
      { label: 'عام / بدون أب', value: 'root', emoji: '🏠', description: 'إنشاء التصنيف كمستوى رئيسي' },
      ...categories.slice(0, 24).map(c => ({
        label: String(c.name).slice(0, 100),
        value: c.id,
        description: c.path.join(' > ').slice(0, 100),
      })),
    ];
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('dash_category_parent_select')
        .setPlaceholder('📁 اختر التصنيف الأب...')
        .addOptions(options)
    );
  },

  categoryEditModal(category) {
    const modal = new ModalBuilder()
      .setCustomId(`dash_modal_category_edit_${category.id}`)
      .setTitle('تعديل اسم التصنيف');

    const input = new TextInputBuilder()
      .setCustomId('category_name')
      .setLabel('الاسم الجديد')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(80)
      .setValue(String(category.name).slice(0, 80));

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return modal;
  },

  categoryDeleteConfirm(category) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`dash_category_delete_confirm_${category.id}`).setLabel('🗑️ تأكيد الحذف').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('dash_category_delete_cancel').setLabel('↩️ إلغاء').setStyle(ButtonStyle.Secondary),
    );
  },

  productCategorySelect(productId, categories = []) {
    const options = [
      { label: 'عام / بدون تصنيف', value: 'none', emoji: '🏠', description: 'إظهار المنتج خارج التصنيفات' },
      ...categories.slice(0, 24).map(c => ({
        label: String(c.name).slice(0, 100),
        value: c.id,
        description: `${c.id} • ${c.path.join(' > ')}`.slice(0, 100),
        default: false,
      })),
    ];

    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`dash_product_category_select_${productId}`)
        .setPlaceholder('🗂️ اختر تصنيف المنتج...')
        .addOptions(options)
    );
  },

  // ───────────────────────────────────
  //   BADGE SELECT
  // ───────────────────────────────────

  badgeSelect(productId) {
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`dash_badge_select_${productId}`)
        .setPlaceholder('اختر Badge أو ألغِ التحديد...')
        .addOptions([
          { label: 'بدون Badge', value: 'none', emoji: '🚫' },
          { label: 'NEW', value: 'new', emoji: '🆕' },
          { label: 'POPULAR', value: 'popular', emoji: '🔥' },
          { label: 'FEATURED', value: 'featured', emoji: '⭐' },
          { label: 'PREMIUM', value: 'premium', emoji: '👑' },
          { label: 'UPDATED', value: 'updated', emoji: '⚡' },
        ])
    );
  },

  // ───────────────────────────────────
  //   TEXT MODALS (اسم / وصف / سعر / لون / إصدار)
  // ───────────────────────────────────

  textEditModal(productId, field, label, currentValue = '', style = TextInputStyle.Short) {
    const modal = new ModalBuilder()
      .setCustomId(`dash_modal_${field}_${productId}`)
      .setTitle(label);

    const input = new TextInputBuilder()
      .setCustomId('value')
      .setLabel(label)
      .setStyle(style)
      .setRequired(true)
      .setValue(String(currentValue ?? ''));

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return modal;
  },

  // ───────────────────────────────────
  //   FEATURES EDIT MODAL (كل ميزة في سطر)
  // ───────────────────────────────────

  featuresEditModal(productId, currentFeatures = []) {
    const modal = new ModalBuilder()
      .setCustomId(`dash_modal_features_${productId}`)
      .setTitle('تعديل المميزات');

    const input = new TextInputBuilder()
      .setCustomId('value')
      .setLabel('كل ميزة في سطر مستقل')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setValue(currentFeatures.join('\n'));

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return modal;
  },

  // ───────────────────────────────────
  //   IMAGES EDIT MODAL (Thumbnail + Banner)
  // ───────────────────────────────────

  imagesEditModal(productId, product) {
    const modal = new ModalBuilder()
      .setCustomId(`dash_modal_images_${productId}`)
      .setTitle('تعديل الصور');

    const thumbInput = new TextInputBuilder()
      .setCustomId('thumbnail')
      .setLabel('رابط الصورة المصغّرة (Thumbnail)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(product.thumbnail ?? '');

    const bannerInput = new TextInputBuilder()
      .setCustomId('banner')
      .setLabel('رابط صورة البانر (Banner)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(product.banner ?? '');

    modal.addComponents(
      new ActionRowBuilder().addComponents(thumbInput),
      new ActionRowBuilder().addComponents(bannerInput),
    );
    return modal;
  },

  wizardCategorySelect(categories = []) {
    const options = [
      { label: 'عام / بدون تصنيف', value: 'none', emoji: '🏠', description: 'وضع المنتج في التصنيف العام' },
      ...categories.slice(0, 24).map(c => ({
        label: String(c.name).slice(0, 100),
        value: c.id,
        description: c.path.join(' > ').slice(0, 100),
      })),
    ];

    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('wizard_category_select')
        .setPlaceholder('🗂️ اختر تصنيف المنتج...')
        .addOptions(options)
    );
  },

  // ───────────────────────────────────
  //   PLAN SELECT (لاختيار خطة للتعديل)
  // ───────────────────────────────────

  planSelectForEdit(productId, plans) {
    const options = plans.map((p, i) => ({
      label: `${p.name} — ${p.price} ${p.currency}`,
      value: String(i),
    }));
    options.push({ label: '➕ إضافة خطة جديدة', value: 'add_new' });

    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`dash_plan_select_${productId}`)
        .setPlaceholder('اختر خطة لتعديلها أو أضف جديدة...')
        .addOptions(options)
    );
  },

  // ───────────────────────────────────
  //   PLAN EDIT MODAL
  // ───────────────────────────────────

  planEditModal(productId, planIndex, plan = {}) {
    const modal = new ModalBuilder()
      .setCustomId(`dash_modal_plan_${planIndex}::${productId}`)
      .setTitle(planIndex === 'add_new' ? 'إضافة خطة جديدة' : 'تعديل الخطة');

    const nameInput = new TextInputBuilder()
      .setCustomId('plan_name').setLabel('اسم الخطة').setStyle(TextInputStyle.Short)
      .setRequired(true).setValue(plan.name ?? '');

    const priceInput = new TextInputBuilder()
      .setCustomId('plan_price').setLabel('السعر').setStyle(TextInputStyle.Short)
      .setRequired(true).setValue(plan.price !== undefined ? String(plan.price) : '');

    const currencyInput = new TextInputBuilder()
      .setCustomId('plan_currency').setLabel('العملة').setStyle(TextInputStyle.Short)
      .setRequired(true).setValue(plan.currency ?? 'SAR');

    const featuresInput = new TextInputBuilder()
      .setCustomId('plan_features').setLabel('مميزات الخطة (كل ميزة في سطر)').setStyle(TextInputStyle.Paragraph)
      .setRequired(false).setValue((plan.features ?? []).join('\n'));

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(priceInput),
      new ActionRowBuilder().addComponents(currencyInput),
      new ActionRowBuilder().addComponents(featuresInput),
    );
    return modal;
  },

  // ───────────────────────────────────
  //   CUSTOMER-FACING: زر "تحت الصيانة" بدل زر الشراء
  // ───────────────────────────────────

  maintenanceButton() {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('product_maintenance_notice')
        .setLabel('🛠️ تحت الصيانة')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false), // نتركه قابل للضغط لإظهار رسالة توضيحية
    );
  },
};
