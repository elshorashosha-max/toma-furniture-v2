import { formatPrice, getCategories, getCategoryName, getProductPrice, normalizeProduct } from "./data.js";
import { getCart, getWishlist, setCart, toggleWishlist } from "./store.js";
import { isSupabaseConfigured, supabase } from "./supabase.js";
import "./style.css";

const app = document.querySelector("#app");
let searchValue = "";
let toastTimer;
let products = [];
let productLoadStatus = "loading";
let productLoadError = "";
let adminBootstrapStarted = false;
let adminRequestVersion = 0;
let checkoutSubmitting = false;
let checkoutSuccessOrderId = "";
let checkoutBlocked = false;
const adminState = {
  authorized: false,
  userId: null,
  products: [],
  orders: [],
  selectedOrder: null,
  orderItems: [],
  orderDetailStatus: "idle",
  orderDetailError: "",
  productsError: "",
  ordersError: "",
  activeTab: "orders",
  orderStatusTab: "all",
  deletingProductId: null,
  refreshingOrders: false,
  deletingOrderId: null,
  pendingOrderDeleteId: null,
  updatingOrderId: null,
  ordersLoading: false,
  productFilters: { search: "", category: "", active: "", pricing: "", sort: "newest" },
  productEditor: null,
};
const galleryState = { productId: null, index: 0, lightbox: false, pointerStart: null, suppressClickUntil: 0 };
let productImageId = 0;
const allowedProductImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxProductImageSize = 10 * 1024 * 1024;

const categories = () => getCategories(products);

function getProductTotal(product, quantity) {
  if (product.pricingType === "negotiated") return null;
  return product.price !== null && Number.isFinite(product.price)
    ? product.price * quantity
    : null;
}

function getItemsTotal(items) {
  let total = 0;
  for (const item of items) {
    const lineTotal = getProductTotal(item.product, item.quantity);
    if (lineTotal === null) return null;
    total += lineTotal;
  }
  return total;
}

function productStatusMessage() {
  if (productLoadStatus === "loading") return "جارٍ تحميل المنتجات...";
  if (productLoadStatus === "not-configured") {
    return "تأكد من إعداد VITE_SUPABASE_URL ومفتاح VITE_SUPABASE_ANON_KEY العام في .env.local.";
  }
  if (productLoadStatus === "error") {
    return productLoadError || "تعذرت قراءة المنتجات. تحقق من الاتصال وصلاحية SELECT وسياسة RLS.";
  }
  return "";
}

function productUnavailableMarkup() {
  return `<div class="empty-state" role="status"><p>${escapeHtml(productStatusMessage())}</p></div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function pathForCurrentPage() {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

function navigate(path) {
  history.pushState({}, "", path);
  window.scrollTo(0, 0);
  render();
}

function toast(message) {
  let element = document.querySelector(".toast");
  if (!element) {
    element = document.createElement("div");
    element.className = "toast";
    element.setAttribute("role", "status");
    document.body.append(element);
  }
  element.textContent = message;
  element.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove("is-visible"), 2600);
}

function cartCount() {
  return getCart().reduce((sum, item) => sum + item.quantity, 0);
}

function header() {
  return `
    <div class="announcement">أثاث يعيش معاك — توصيل وتركيب مضمون</div>
    <header class="site-header">
      <div class="header-inner wrap">
        <button class="menu-toggle icon-button" type="button" aria-label="فتح القائمة">☰</button>
        <a class="brand" href="/" data-link aria-label="تُومة للأثاث">
          <img class="brand-logo" src="/assets/toma-logo.png" alt="تُومة للأثاث — TOMA Furniture" />
          <span class="brand-copy"><b lang="en">TOMA Furniture</b><small>تُومة للأثاث</small></span>
        </a>
        <nav class="main-nav" aria-label="القائمة الرئيسية">
          <a href="/" data-link>الرئيسية</a>
          <a href="/collections" data-link>المجموعات</a>
          <a href="/products" data-link>منتجاتنا</a>
          <a href="/#about" data-link>عن تُومة</a>
        </nav>
        <div class="header-actions">
          <button class="icon-button" type="button" data-action="search" aria-label="البحث">⌕</button>
          <a class="icon-button wishlist-link" href="/wishlist" data-link aria-label="المفضلة">♡<span class="tiny-count">${getWishlist().length}</span></a>
          <a class="cart-link" href="/cart" data-link>السلة <span class="cart-count">${cartCount()}</span></a>
        </div>
      </div>
      <form class="search-box wrap ${searchValue ? "is-open" : ""}" role="search">
        <input name="q" type="search" placeholder="ابحث عن قطعة بتحبها..." value="${escapeHtml(searchValue)}" aria-label="ابحث عن منتج" />
        <button type="submit" aria-label="بحث">⌕</button>
      </form>
    </header>`;
}

function footer() {
  return `
    <footer class="site-footer" id="about">
      <div class="wrap footer-grid">
        <div class="footer-brand"><a class="brand" href="/" data-link aria-label="تُومة للأثاث"><img class="brand-logo" src="/assets/toma-logo.png" alt="تُومة للأثاث — TOMA Furniture" /></a><p>قطع مختارة لبيت له شخصية.</p></div>
        <div><h3>تصفّح</h3><a href="/collections" data-link>المجموعات</a><a href="/products" data-link>منتجاتنا</a></div>
        <div><h3>خدمتنا</h3><span>توصيل وتركيب</span><span>خامات مختارة</span></div>
        <div><h3>ابقَ قريباً</h3><a href="https://wa.me/966560943642" target="_blank" rel="noopener noreferrer">☏ واتساب</a><a href="https://www.facebook.com/people/%D8%AA%D9%88%D9%85%D8%A9-%D9%84%D9%84%D8%A3%D8%AB%D8%A7%D8%AB-Toma-Furniture/61593795855042/?rdid=cMPhHQrT8OyZ6bCP&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2F1b4RArqTc3%2F" target="_blank" rel="noopener noreferrer">f فيسبوك</a><a href="https://www.instagram.com/tomafurniture?stkn=MWZvdzd2eXF5eDM1ZQ%3D%3D" target="_blank" rel="noopener noreferrer">◎ إنستجرام</a><a href="https://www.tiktok.com/@tomafurniture?_r=1&_t=ZS-99UTlRlBI1J" target="_blank" rel="noopener noreferrer">♪ تيك توك</a><a href="https://www.snapchat.com/@tomafurniture?share_id=0fz2XdqIrUE&locale=ar-EG" target="_blank" rel="noopener noreferrer">◉ سناب شات</a></div>
      </div>
      <div class="footer-bottom wrap"><span>© تُومة للأثاث</span></div>
    </footer>`;
}

function layout(content, { admin = false } = {}) {
  app.innerHTML = `${admin ? "" : header()}${content}${admin ? "" : footer()}`;
}

function productCard(product) {
  const saved = getWishlist().includes(product.id);
  const image = product.images[0];
  const action = product.pricingType === "negotiated"
    ? `<a class="add-button whatsapp-inquiry" href="${whatsappProductUrl(product)}" target="_blank" rel="noopener noreferrer">استفسر عبر واتساب</a>`
    : `<button type="button" class="add-button" data-action="add" data-id="${escapeHtml(product.id)}">+ أضف للسلة</button>`;
  return `
    <article class="product-card">
      <a class="product-picture" href="/products/${encodeURIComponent(product.id)}" data-link>
        ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy" />` : ""}
        ${product.badge ? `<span class="product-badge">${escapeHtml(product.badge)}</span>` : ""}
      </a>
      <button class="favorite-button ${saved ? "is-saved" : ""}" type="button" data-action="wishlist" data-id="${escapeHtml(product.id)}" aria-label="${saved ? "إزالة من المفضلة" : "أضف للمفضلة"}">${saved ? "♥" : "♡"}</button>
      <div class="product-copy">
        <p>${escapeHtml(getCategoryName(product.category))}</p>
        <h3><a href="/products/${encodeURIComponent(product.id)}" data-link>${escapeHtml(product.name)}</a></h3>
        <div class="product-buy"><strong>${escapeHtml(getProductPrice(product))}</strong>${action}</div>
      </div>
    </article>`;
}

function whatsappProductUrl(product) {
  const pageUrl = new URL(`/products/${encodeURIComponent(product.id)}`, location.origin);
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(pageUrl.hostname);
  const text = `مرحبًا، أريد الاستفسار عن سعر المنتج: ${product.name}.${isLocal ? "" : ` رابط المنتج: ${pageUrl.href}`}`;
  return `https://wa.me/966560943642?text=${encodeURIComponent(text)}`;
}

function categoryCard(category, index) {
  return `
    <a class="category-card category-card-${index + 1}" href="/collections/${encodeURIComponent(category.id)}" data-link>
      ${category.imageUrl ? `<img src="${escapeHtml(category.imageUrl)}" alt="" loading="lazy" />` : ""}
      <span class="category-index">0${index + 1}</span><div><h3>${escapeHtml(category.name)}</h3><p>${escapeHtml(category.detail)}</p><span class="category-action">اكتشف المجموعة ↗</span></div>
    </a>`;
}

function homePage() {
  layout(`
    <main>
      <section class="hero wrap">
        <div class="hero-copy">
          <p class="eyebrow">أثاث يصنع المساحة</p>
          <h1>بيتك يحكي عنك.<br /><em>خلّي الحكاية تُومة.</em></h1>
          <p class="hero-description">قطع مصممة بحب، معمولة عشان تعيش معاك وتكبر جمالها كل يوم.</p>
          <div class="hero-actions"><a class="button button-primary" href="/products" data-link>اكتشف مجموعتنا <span>←</span></a><a class="text-link" href="/#about" data-link>اعرف حكايتنا ↗</a></div>
          <p class="hero-proof"><span class="proof-dots"><i></i><i></i><i></i></span> اختيارات صنعت بحب لبيوت حقيقية</p>
        </div>
        <div class="hero-visual" role="img" aria-label="أثاث مريح لغرفة المعيشة"><div class="hero-image"></div><div class="hero-caption"><span>01</span><div><b>ركنك المفضل</b><small>تفاصيل تصنع الفرق</small></div></div><span class="hero-spark">✳</span></div>
      </section>
      <section class="trust-strip"><div class="wrap trust-items"><span>✦ خامات مختارة بعناية</span><span>◌ تصميمات معمولة تعيش</span><span>⌁ توصيل وتركيب مضمون</span><span>♧ ضمان لحد 5 سنين</span></div></section>
      <section class="section wrap">
        <div class="section-heading"><div><p class="eyebrow">اختار مودك</p><h2>كل ركن له شخصية</h2></div><a class="text-link" href="/collections" data-link>شوف كل المجموعات ←</a></div>
        <div class="category-grid">${productLoadStatus === "ready" ? categories().map(categoryCard).join("") : productUnavailableMarkup()}</div>
      </section>
      <section class="section product-section">
        <div class="wrap"><div class="section-heading"><div><p class="eyebrow">اختيارات تُومة</p><h2>قطع تكمّل حكايتك</h2></div><a class="text-link" href="/products" data-link>كل المنتجات ←</a></div>${productLoadStatus === "ready" ? `<div class="product-grid">${products.slice(0, 12).map(productCard).join("")}</div><div class="home-products-more"><p>لسه في منتجات تانية كتير! اكتشف باقي تشكيلتنا من الأثاث.</p><a class="button button-outline" href="/products" data-link>عرض كل المنتجات</a></div>` : productUnavailableMarkup()}</div>
      </section>
      <section class="story-banner wrap"><div><p class="eyebrow">بيتك يستاهل الحكاية</p><h2>اختار قطعة<br />تشبهك.</h2><a class="button button-light" href="/products" data-link>تصفّح المنتجات ↗</a></div><span class="story-stamp">TOMA<br />MADE WITH CARE</span></section>
    </main>`);
}

function productListing({ category = null, wishlistOnly = false } = {}) {
  const currentCategory = categories().find((item) => item.id === category);
  const title = wishlistOnly ? "منتجاتك المفضلة" : currentCategory?.name ?? "كل المنتجات";
  const saved = getWishlist();
  const filtered = products.filter((product) =>
    (!category || product.category === category) &&
    (!wishlistOnly || saved.includes(product.id)) &&
    (!searchValue || `${product.name} ${getCategoryName(product.category)}`.includes(searchValue)),
  );
  layout(`<main class="wrap page-main">
    <nav class="breadcrumbs"><a href="/" data-link>الرئيسية</a><span> / </span><span>${escapeHtml(title)}</span></nav>
    <div class="listing-heading"><div><p class="eyebrow">${currentCategory ? "المجموعة" : "تُومة للأثاث"}</p><h1>${escapeHtml(title)}</h1><p>تفاصيل مختارة لتكمّل حكاية بيتك.</p></div><span>${filtered.length} منتجات</span></div>
    ${!wishlistOnly && !currentCategory ? `<div class="filter-row"><a class="filter-chip is-active" href="/products" data-link>الكل</a>${categories().map((item) => `<a class="filter-chip" href="/collections/${encodeURIComponent(item.id)}" data-link>${escapeHtml(item.name)}</a>`).join("")}</div>` : ""}
    ${productLoadStatus !== "ready" ? productUnavailableMarkup() : filtered.length ? `<div class="product-grid">${filtered.map(productCard).join("")}</div>` : `<div class="empty-state"><span>♡</span><h2>${wishlistOnly ? "لسه مفيش منتجات في المفضلة" : "مش لاقيين منتجات هنا"}</h2><p>${wishlistOnly ? "احفظ القطع اللي عجبتك عشان ترجع لها بسهولة." : "جرّب اختيار مجموعة تانية."}</p><a class="button button-primary" href="/products" data-link>تصفّح المنتجات</a></div>`}
  </main>`);
}

function productDetail(id) {
  const product = products.find((item) => item.id === id);
  if (!product && productLoadStatus !== "ready") {
    layout(`<main class="wrap page-main">${productUnavailableMarkup()}</main>`);
    return;
  }
  if (!product) return notFoundPage();
  const saved = getWishlist().includes(product.id);
  if (galleryState.productId !== product.id) {
    galleryState.productId = product.id;
    galleryState.index = 0;
    galleryState.lightbox = false;
  }
  const galleryIndex = Math.min(galleryState.index, Math.max(0, product.images.length - 1));
  const galleryCount = product.images.length;
  const productImages = product.images.map((image, index) => `
    <button class="gallery-thumbnail ${index === galleryIndex ? "is-active" : ""}" type="button" data-action="gallery-image" data-index="${index}" aria-label="عرض صورة المنتج ${index + 1}">
      <img src="${escapeHtml(image)}" alt="" loading="lazy" />
    </button>`).join("");
  const image = product.images[galleryIndex];
  const galleryControls = galleryCount > 1
    ? `<button class="gallery-arrow gallery-prev" type="button" data-action="gallery-step" data-delta="-1" aria-label="الصورة السابقة">‹</button><button class="gallery-arrow gallery-next" type="button" data-action="gallery-step" data-delta="1" aria-label="الصورة التالية">›</button><span class="gallery-counter">${galleryIndex + 1} من ${galleryCount}</span>`
    : "";
  const productAction = product.pricingType === "negotiated"
    ? `<a class="button button-primary" href="${whatsappProductUrl(product)}" target="_blank" rel="noopener noreferrer">استفسر عن السعر عبر واتساب</a>`
    : `<button class="button button-primary" type="button" data-action="add" data-id="${escapeHtml(product.id)}">أضف للسلة</button>`;
  const lightbox = galleryState.lightbox && image
    ? `<div class="gallery-lightbox" role="dialog" aria-modal="true" aria-label="عرض صورة المنتج" data-action="lightbox-backdrop"><button class="lightbox-close" type="button" data-action="gallery-close" aria-label="إغلاق">×</button>${galleryCount > 1 ? `<button class="gallery-arrow gallery-prev" type="button" data-action="gallery-step" data-delta="-1" aria-label="الصورة السابقة">‹</button><button class="gallery-arrow gallery-next" type="button" data-action="gallery-step" data-delta="1" aria-label="الصورة التالية">›</button>` : ""}<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" /><span class="gallery-counter">${galleryIndex + 1} من ${galleryCount}</span></div>`
    : "";
  layout(`<main class="wrap page-main">
    <nav class="breadcrumbs"><a href="/" data-link>الرئيسية</a><span> / </span><a href="/collections/${encodeURIComponent(product.category)}" data-link>${escapeHtml(getCategoryName(product.category))}</a><span> / </span><span>${escapeHtml(product.name)}</span></nav>
    <section class="detail-grid">
      <div><div class="detail-image" data-gallery-image>${image ? `<img class="detail-main-image" src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" />` : ""}${product.badge ? `<span class="product-badge">${escapeHtml(product.badge)}</span>` : ""}${galleryControls}</div>${galleryCount > 1 ? `<div class="gallery-thumbnails">${productImages}</div>` : ""}</div>
      <div class="detail-copy"><p class="eyebrow">${escapeHtml(getCategoryName(product.category))}</p><h1>${escapeHtml(product.name)}</h1><p class="detail-price">${escapeHtml(getProductPrice(product))}</p><p class="detail-description">${escapeHtml(product.description)}</p><div class="detail-benefits"><span>✓ خامات مختارة</span><span>✓ توصيل وتركيب</span></div><div class="detail-actions">${productAction}<button class="button button-outline" type="button" data-action="wishlist" data-id="${escapeHtml(product.id)}">${saved ? "♥ في المفضلة" : "♡ أضف للمفضلة"}</button></div></div>
    </section><section class="section"><div class="section-heading"><div><p class="eyebrow">اختيارات تُومة</p><h2>يمكن يعجبك كمان</h2></div></div><div class="product-grid">${products.filter((item) => item.id !== product.id).slice(0, 4).map(productCard).join("")}</div></section>
  </main>${lightbox}`);
}

function cartPage() {
  const cart = getCart();
  const cartItems = cart.map((item) => ({ ...item, product: products.find((product) => product.id === item.id) }))
    .filter((item) => item.product?.pricingType === "fixed" && Number.isFinite(item.product.price) && item.product.price >= 0);
  const total = getItemsTotal(cartItems);
  const totalText = total === null ? "يُحدّد لاحقاً" : formatPrice(total);
  layout(`<main class="wrap page-main"><nav class="breadcrumbs"><a href="/" data-link>الرئيسية</a><span> / </span><span>السلة</span></nav><div class="listing-heading"><div><p class="eyebrow">اختياراتك</p><h1>سلة المشتريات</h1></div></div>
    ${cartItems.length ? `<div class="cart-layout"><div class="cart-list">${cartItems.map(({ product, quantity }) => `<article class="cart-item"><a class="cart-thumb" href="/products/${encodeURIComponent(product.id)}" data-link>${product.images[0] ? `<img src="${escapeHtml(product.images[0])}" alt="" loading="lazy" />` : ""}</a><div class="cart-item-copy"><a href="/products/${encodeURIComponent(product.id)}" data-link><h2>${escapeHtml(product.name)}</h2></a><p>${escapeHtml(getProductPrice(product))}</p><div class="quantity-control"><button type="button" data-action="quantity" data-id="${escapeHtml(product.id)}" data-delta="-1" aria-label="تقليل الكمية">−</button><span>${quantity}</span><button type="button" data-action="quantity" data-id="${escapeHtml(product.id)}" data-delta="1" aria-label="زيادة الكمية">+</button></div></div><button class="remove-button" type="button" data-action="remove" data-id="${escapeHtml(product.id)}">إزالة</button></article>`).join("")}</div><aside class="order-summary"><h2>ملخص الطلب</h2><div><span>المجموع</span><strong>${totalText}</strong></div><div><span>التوصيل</span><span>يُحدّد لاحقاً</span></div><hr /><div class="summary-total"><span>الإجمالي التقديري</span><strong>${totalText}</strong></div><a class="button button-primary button-full" href="/checkout" data-link>إتمام الطلب</a></aside></div>` : `<div class="empty-state"><span>🛒</span><h2>سلتك لسه فاضية</h2><p>ابدأ باختيار القطع اللي تناسب بيتك.</p><a class="button button-primary" href="/products" data-link>اكتشف المنتجات</a></div>`}
  </main>`);
}

function checkoutPage() {
  if (checkoutSuccessOrderId) {
    layout(`<main class="wrap page-main"><div class="empty-state order-confirmation"><span>✓</span><p class="eyebrow">تم استلام طلبك</p><h1>شكراً لاختيارك تُومة</h1><p>تم حفظ الطلب بنجاح. رقم المتابعة:</p><b class="checkout-order-id" dir="ltr">${escapeHtml(checkoutSuccessOrderId)}</b><a class="button button-primary" href="/" data-link>العودة للرئيسية</a></div></main>`);
    return;
  }
  const cart = getCart();
  const cartItems = cart
    .map((item) => ({ ...item, product: products.find((product) => product.id === item.id) }))
    .filter((item) => item.product?.pricingType === "fixed" && Number.isFinite(item.product.price) && item.product.price >= 0);
  const total = getItemsTotal(cartItems);
  const totalText = total === null ? "غير متاح" : formatPrice(total);
  layout(`<main class="wrap page-main"><nav class="breadcrumbs"><a href="/" data-link>الرئيسية</a><span> / </span><a href="/cart" data-link>السلة</a><span> / </span><span>إتمام الطلب</span></nav><div class="listing-heading"><div><p class="eyebrow">خطوة أخيرة</p><h1>بيانات التوصيل</h1></div></div>
    ${cartItems.length && total !== null ? `<div class="checkout-layout"><form class="checkout-form" id="checkout-form"><div class="checkout-error admin-alert" id="checkout-error" role="alert" ${checkoutBlocked ? "" : "hidden"}>${checkoutBlocked ? "تعذر تأكيد اكتمال الطلب. لتجنب إنشاء طلب مكرر، لا ترسل الطلب مرة أخرى؛ تواصل معنا للتحقق من حالته." : ""}</div><p class="checkout-note">نحتاج الاسم ورقم الهاتف وعنوان التوصيل لإتمام الطلب. لا نطلب بريدًا إلكترونيًا.</p><label>الاسم<input name="name" autocomplete="name" required minlength="2" maxlength="180" placeholder="الاسم بالكامل" /></label><label>رقم الهاتف<input name="phone" type="tel" autocomplete="tel" inputmode="tel" required minlength="7" maxlength="20" placeholder="رقم للتواصل" /></label><label>المنطقة<input name="region" type="text" autocomplete="address-level2" required maxlength="120" placeholder="اكتب المنطقة أو المدينة" /></label><label>العنوان<textarea name="address" autocomplete="street-address" required minlength="5" maxlength="500" rows="3" placeholder="الشارع ورقم المبنى وأي تفاصيل إضافية"></textarea></label><button class="button button-primary" type="submit" ${checkoutSubmitting || checkoutBlocked ? "disabled" : ""}>${checkoutSubmitting ? "جارٍ إرسال الطلب..." : `تأكيد الطلب · ${totalText}`}</button><p class="checkout-note">لن نعرض بياناتك الشخصية في المتجر.</p></form><aside class="order-summary"><h2>طلبك</h2>${cartItems.map(({ product, quantity }) => `<div class="checkout-line"><span>${escapeHtml(product.name)} × ${quantity}</span><strong>${formatPrice(product.price * quantity)}</strong></div>`).join("")}<hr /><div class="summary-total"><span>الإجمالي التقديري</span><strong>${totalText}</strong></div></aside></div>` : `<div class="empty-state"><h2>لا توجد منتجات ثابتة السعر في السلة</h2><p>المنتجات ذات السعر حسب الاتفاق متاحة للاستفسار عبر واتساب فقط.</p><a class="button button-primary" href="/products" data-link>تصفّح المنتجات</a></div>`}
  </main>`);
}

function collectionsPage() {
  layout(`<main class="wrap page-main"><nav class="breadcrumbs"><a href="/" data-link>الرئيسية</a><span> / </span><span>المجموعات</span></nav><div class="listing-heading"><div><p class="eyebrow">اختار مودك</p><h1>مجموعات تُومة</h1><p>كل ركن له شخصية.</p></div></div>${productLoadStatus === "ready" ? `<div class="category-grid category-page-grid">${categories().map(categoryCard).join("")}</div>` : productUnavailableMarkup()}</main>`);
}

function notFoundPage() {
  layout(`<main class="wrap page-main"><div class="empty-state"><span>404</span><h1>الصفحة مش موجودة</h1><p>يمكن الرابط اتغيّر أو الصفحة غير متاحة.</p><a class="button button-primary" href="/" data-link>العودة للرئيسية</a></div></main>`);
}

function adminOrderDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "تاريخ غير متاح"
    : new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const orderStatusTabs = [
  { id: "all", label: "كل الطلبات", statuses: null },
  { id: "confirming", label: "قيد التأكيد", statuses: ["new", "confirmed"] },
  { id: "shipped", label: "قيد الشحن", statuses: ["shipped"] },
  { id: "completed", label: "مكتملة", statuses: ["completed"] },
  { id: "cancelled", label: "ملغية", statuses: ["cancelled"] },
];

function adminStatusLabel(status) {
  const labels = {
    new: "جديد",
    confirmed: "مؤكد",
    shipped: "تم الشحن",
    completed: "مكتمل",
    cancelled: "ملغي",
  };
  return labels[status] ?? status ?? "غير محدد";
}

function getAdminOrderMetrics() {
  const metrics = {
    all: { count: adminState.orders.length, total: 0 },
    confirming: { count: 0, total: 0 },
    shipped: { count: 0, total: 0 },
    completed: { count: 0, total: 0 },
    cancelled: { count: 0, total: 0 },
  };
  for (const order of adminState.orders) {
    const amount = Number(order.total);
    if (Number.isFinite(amount)) metrics.all.total += amount;
    const bucket = order.status === "new" || order.status === "confirmed"
      ? "confirming"
      : order.status === "shipped"
        ? "shipped"
        : order.status === "completed"
          ? "completed"
          : order.status === "cancelled"
            ? "cancelled"
            : null;
    if (!bucket) continue;
    metrics[bucket].count += 1;
    if (Number.isFinite(amount)) metrics[bucket].total += amount;
  }
  return metrics;
}

function visibleAdminOrders() {
  const tab = orderStatusTabs.find((item) => item.id === adminState.orderStatusTab) ?? orderStatusTabs[0];
  return tab.statuses
    ? adminState.orders.filter((order) => tab.statuses.includes(order.status))
    : adminState.orders;
}

function adminOrderDetailsMarkup() {
  const order = adminState.selectedOrder;
  if (!order) return `<div class="admin-empty">اختر طلباً لعرض تفاصيله.</div>`;
  if (adminState.orderDetailStatus === "loading") return `<div class="admin-empty" role="status">جارٍ تحميل تفاصيل الطلب...</div>`;
  if (adminState.orderDetailStatus === "error") return `<div class="admin-alert" role="status">${escapeHtml(adminState.orderDetailError)}</div>`;

  const statuses = ["new", "confirmed", "shipped", "completed", "cancelled"];
  return `
    <section class="admin-order-detail">
      <div class="admin-detail-heading"><div><p class="eyebrow">تفاصيل الطلب</p><h3>#${escapeHtml(order.id)}</h3></div><button class="button button-outline" type="button" data-action="admin-order-close">إغلاق التفاصيل</button></div>
      <div class="admin-detail-meta">
        <div><span>الاسم</span><b>${escapeHtml(order.customer_name)}</b></div>
        <div><span>الهاتف</span><b dir="ltr">${escapeHtml(order.phone)}</b></div>
        <div><span>البريد الإلكتروني</span><b dir="ltr">${escapeHtml(order.email || "غير متاح")}</b></div>
        <div class="admin-address"><span>المنطقة والعنوان</span><b>${escapeHtml(order.address)}</b></div>
        <div><span>الحالة</span><b>${escapeHtml(adminStatusLabel(order.status))}</b></div>
        <div><span>تاريخ الإنشاء</span><b>${escapeHtml(adminOrderDate(order.created_at))}</b></div>
        <div><span>الإجمالي</span><b>${escapeHtml(formatPrice(Number(order.total)))}</b></div>
      </div>
      <form class="admin-order-status-form" data-order-id="${escapeHtml(order.id)}">
        <label>تحديث الحالة
          <select name="status" aria-label="حالة الطلب">
            ${statuses.map((status) => `<option value="${status}" ${order.status === status ? "selected" : ""}>${escapeHtml(adminStatusLabel(status))}</option>`).join("")}
          </select>
        </label>
        <button class="button button-primary" type="submit" ${adminState.updatingOrderId === order.id ? "disabled" : ""}>${adminState.updatingOrderId === order.id ? "جارٍ التحديث..." : "حفظ الحالة"}</button>
      </form>
      <h4>عناصر الطلب</h4>
      ${adminState.orderItems.length
        ? `<div class="admin-items">${adminState.orderItems.map((item) => `<div class="admin-item-row"><span>${escapeHtml(item.product_name)}</span><span>الكمية: ${escapeHtml(item.quantity)}</span><strong>${escapeHtml(formatPrice(Number(item.price)))}</strong></div>`).join("")}</div>`
        : `<p class="admin-empty">لا توجد عناصر مسجلة لهذا الطلب.</p>`}
    </section>`;
}

function filteredAdminProducts() {
  const filters = adminState.productFilters;
  return adminState.products
    .filter((product) => !filters.search || product.name.toLocaleLowerCase("ar").includes(filters.search.toLocaleLowerCase("ar")))
    .filter((product) => !filters.category || product.category === filters.category)
    .filter((product) => !filters.active || String(product.isActive) === filters.active)
    .filter((product) => !filters.pricing || product.pricingType === filters.pricing)
    .sort((first, second) => filters.sort === "name"
      ? first.name.localeCompare(second.name, "ar")
      : (Date.parse(second.createdAt) || 0) - (Date.parse(first.createdAt) || 0));
}

function productImagePreviewMarkup(editor) {
  if (!editor.imageItems.length) return `<span class="admin-empty">اختر صورة رئيسية أو صورًا فرعية لعرض المعاينة</span>`;
  return editor.imageItems.map((image, index) => `
    <article class="product-image-preview-card" draggable="true" data-image-id="${escapeHtml(image.id)}">
      <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.name || `صورة المنتج ${index + 1}`)}" />
      <span class="product-image-preview-label">${index === 0 ? "الصورة الرئيسية" : image.file ? "جديدة — لم تُرفع" : "صورة فرعية محفوظة"}</span>
      ${index === 0 ? "" : `<button type="button" class="product-image-action" data-action="image-set-main" data-image-id="${escapeHtml(image.id)}">تعيين كرئيسية</button>`}
      <button type="button" class="product-image-action" data-action="image-crop" data-image-id="${escapeHtml(image.id)}">قص / ضبط</button>
      <button type="button" class="product-image-action" data-action="image-replace" data-image-id="${escapeHtml(image.id)}">استبدال</button>
      <button type="button" class="product-image-remove" data-action="image-remove" data-image-id="${escapeHtml(image.id)}" aria-label="حذف الصورة ${index + 1} من الاختيار">حذف</button>
    </article>`).join("");
}

function productImageCropperMarkup(editor) {
  const cropper = editor.cropper;
  if (!cropper) return "";
  return `
    <div class="image-cropper-backdrop">
      <section class="image-cropper" role="dialog" aria-modal="true" aria-labelledby="image-cropper-title">
        <header class="image-cropper-heading"><h3 id="image-cropper-title">قص الصورة وضبطها</h3><button class="icon-button" type="button" data-action="crop-cancel" aria-label="إلغاء القص">×</button></header>
        <p class="demo-note">إطار القص ثابت بنسبة 4:3. كبّر الصورة أو حرّكها لاختيار الجزء المطلوب؛ تُحفظ الصورة الأصلية دون تغيير حتى اعتماد النسخة المقصوصة.</p>
        <div class="image-cropper-workspace">
          <div class="image-cropper-stage" id="image-cropper-stage" style="aspect-ratio:4 / 3">
            ${cropper.ready ? `<img class="image-cropper-source" src="${escapeHtml(cropper.sourceUrl)}" alt="معاينة القص" draggable="false" />` : `<div class="image-cropper-loading">${escapeHtml(cropper.error || "جارٍ تجهيز الصورة...")}</div>`}
          </div>
          <div class="image-cropper-result">
            <span>معاينة النتيجة</span>
            <canvas id="image-cropper-preview" aria-label="معاينة الصورة بعد القص"></canvas>
          </div>
        </div>
        ${cropper.error ? `<p class="image-cropper-error" role="alert">${escapeHtml(cropper.error)}</p>` : ""}
        <label class="image-cropper-zoom">تكبير الصورة
          <input id="image-cropper-zoom" type="range" min="1" max="4" step="0.01" value="${cropper.zoom}" ${cropper.ready ? "" : "disabled"} />
          <span>${Math.round(cropper.zoom * 100)}%</span>
        </label>
        <div class="image-cropper-actions">
          <button class="button button-outline" type="button" data-action="crop-reset" ${cropper.ready ? "" : "disabled"}>إعادة الضبط</button>
          <button class="button button-outline" type="button" data-action="crop-cancel">إلغاء</button>
          <button class="button button-primary" type="button" data-action="crop-confirm" ${cropper.ready ? "" : "disabled"}>اعتماد القص</button>
        </div>
      </section>
    </div>`;
}

function productEditorMarkup() {
  const editor = adminState.productEditor;
  if (!editor) return "";
  const product = editor.product;
  const categoriesList = [...new Set(adminState.products.map((item) => item.category).filter(Boolean))];
  if (product?.category && !categoriesList.includes(product.category)) categoriesList.push(product.category);
  const negotiated = product?.pricingType === "negotiated";
  return `
    <div class="product-editor-backdrop" role="presentation" data-action="product-editor-backdrop">
      <form class="product-editor" id="admin-product-form" role="dialog" aria-modal="true" aria-labelledby="product-editor-title">
        <div class="product-editor-heading"><div><p class="eyebrow">CATALOG</p><h3 id="product-editor-title">${product ? "تعديل بيانات المنتج" : "إضافة منتج"}</h3></div><button type="button" class="icon-button" data-action="product-editor-close" aria-label="إغلاق">×</button></div>
        <div class="admin-alert" id="product-editor-error" role="status" ${editor.error ? "" : "hidden"}>${escapeHtml(editor.error ?? "")}</div>
        <section class="product-editor-section"><h4>البيانات الأساسية</h4><label>اسم المنتج<input name="name" required maxlength="180" value="${escapeHtml(product?.name ?? "")}" /></label><label>التصنيف<input name="category" list="admin-category-options" required value="${escapeHtml(product?.category ?? "")}" /><datalist id="admin-category-options">${categoriesList.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("")}</datalist></label><label>الوصف<textarea name="description" rows="3">${escapeHtml(product?.description ?? "")}</textarea></label><label>شارة المنتج<input name="badge" maxlength="80" value="${escapeHtml(product?.badge ?? "")}" placeholder="اختياري" /></label></section>
        <section class="product-editor-section product-image-section"><h4>صور المنتج</h4>
          <p class="demo-note">اختر صورًا من جهازك، ثم عيّن الرئيسية واسحب الصور لتغيير ترتيبها. JPG وPNG وWebP حتى 10 ميغابايت للصورة. يتطلب رفع الصور إلى Storage سياسة تسمح للمدير المصرح فقط.</p>
          <div class="product-image-picker-actions">
            <button type="button" class="button button-primary" data-action="choose-main-image">اختيار الصورة الرئيسية</button>
            <button type="button" class="button button-outline" data-action="choose-gallery-images">إضافة صور فرعية</button>
            <input class="product-image-input" id="product-main-image-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="اختيار الصورة الرئيسية" />
            <input class="product-image-input" id="product-gallery-image-input" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="اختيار الصور الفرعية" />
            <input class="product-image-input" id="product-replace-image-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="استبدال صورة مختارة" />
          </div>
          <p class="product-image-status" id="product-image-status" role="status" aria-live="polite">${escapeHtml(editor.imageStatus || "")}</p>
          <div class="product-editor-preview" id="product-editor-preview">${productImagePreviewMarkup(editor)}</div>
        </section>
        ${productImageCropperMarkup(editor)}
        <section class="product-editor-section"><h4>السعر والتصنيف</h4><label>نوع التسعير<select name="pricing_type"><option value="fixed" ${!negotiated ? "selected" : ""}>سعر ثابت</option><option value="negotiated" ${negotiated ? "selected" : ""}>السعر حسب الاتفاق</option></select></label><label class="product-fixed-price" ${negotiated ? "hidden" : ""}>السعر الرقمي<input name="price" type="number" min="0" step="0.01" ${negotiated ? "" : "required"} value="${product?.price !== null && product?.price !== undefined ? escapeHtml(product.price) : ""}" /></label><label class="product-negotiated-price" ${negotiated ? "" : "hidden"}>نص السعر<input name="price_text" maxlength="120" ${negotiated ? "required" : ""} value="${escapeHtml(product?.priceText ?? "")}" placeholder="مثال: السعر حسب المقاس" /></label></section>
        <section class="product-editor-section"><h4>حالة النشر</h4><label class="admin-checkbox"><input name="is_active" type="checkbox" ${product?.isActive ?? true ? "checked" : ""} /><span>المنتج ظاهر في المتجر</span></label></section>
        <div class="product-editor-actions"><button type="button" class="button button-outline" data-action="product-editor-close">إلغاء</button><button type="submit" class="button button-primary" ${editor.saving ? "disabled" : ""}>${editor.saving ? "جارٍ الحفظ..." : "حفظ المنتج"}</button></div>
      </form>
    </div>`;
}

function adminDashboardMarkup() {
  const activeTab = adminState.activeTab;
  const visibleProducts = filteredAdminProducts();
  const productFilters = adminState.productFilters;
  const orderMetrics = getAdminOrderMetrics();
  const visibleOrders = visibleAdminOrders();
  const productsContent = adminState.productsError
    ? `<div class="admin-alert" role="status">${escapeHtml(adminState.productsError)}</div>`
    : `<form id="admin-product-filters" class="admin-product-filters">
        <input type="search" name="search" placeholder="ابحث باسم المنتج" value="${escapeHtml(productFilters.search)}" aria-label="ابحث باسم المنتج" />
        <select name="category" aria-label="تصفية حسب التصنيف"><option value="">كل التصنيفات</option>${[...new Set(adminState.products.map((item) => item.category).filter(Boolean))].map((category) => `<option value="${escapeHtml(category)}" ${productFilters.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select>
        <select name="active" aria-label="تصفية حسب حالة النشر"><option value="">كل الحالات</option><option value="true" ${productFilters.active === "true" ? "selected" : ""}>منشور</option><option value="false" ${productFilters.active === "false" ? "selected" : ""}>مخفي</option></select>
        <select name="pricing" aria-label="تصفية حسب نوع التسعير"><option value="">كل الأسعار</option><option value="fixed" ${productFilters.pricing === "fixed" ? "selected" : ""}>سعر ثابت</option><option value="negotiated" ${productFilters.pricing === "negotiated" ? "selected" : ""}>حسب الاتفاق</option></select>
        <select name="sort" aria-label="ترتيب المنتجات"><option value="newest" ${productFilters.sort === "newest" ? "selected" : ""}>الأحدث</option><option value="name" ${productFilters.sort === "name" ? "selected" : ""}>الاسم</option></select>
        <button type="submit" class="button button-outline">تطبيق</button>
      </form>
      <div class="admin-products">${visibleProducts.map((product) => `
        <article class="admin-product">
          ${product.images[0] ? `<img src="${escapeHtml(product.images[0])}" alt="" loading="lazy" />` : `<div class="admin-product-placeholder" aria-hidden="true">تُومة</div>`}
          <div class="admin-product-copy"><span class="admin-product-category">${escapeHtml(getCategoryName(product.category))}</span><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(getProductPrice(product))} · ${escapeHtml(product.pricingType || "نوع التسعير غير محدد")}</p></div>
          <span class="admin-state-chip ${product.isActive ? "is-active" : "is-inactive"}">${product.isActive ? "نشط" : "مخفي"}</span>
          <div class="admin-product-actions"><button type="button" class="table-action" data-action="product-edit" data-id="${escapeHtml(product.id)}">تعديل</button><button type="button" class="table-action" data-action="product-toggle" data-id="${escapeHtml(product.id)}">${product.isActive ? "إخفاء" : "نشر"}</button><button type="button" class="table-action table-action-danger" data-action="product-delete" data-id="${escapeHtml(product.id)}" ${adminState.deletingProductId === product.id ? "disabled" : ""}>${adminState.deletingProductId === product.id ? "جارٍ الإزالة..." : "إزالة"}</button></div>
        </article>`).join("") || `<p class="admin-empty">لا توجد منتجات.</p>`}</div>`;
  const ordersContent = adminState.ordersError
    ? `<div class="admin-alert" role="status">${escapeHtml(adminState.ordersError)}</div>`
    : `<div class="admin-orders">
        ${adminState.ordersLoading ? `<p class="admin-empty" role="status">جارٍ تحميل الطلبات...</p>` : visibleOrders.length ? visibleOrders.map((order) => `
          <div class="admin-order-entry">
            <button class="admin-order-row ${adminState.selectedOrder?.id === order.id ? "is-selected" : ""}" type="button" data-action="admin-order-open" data-id="${escapeHtml(order.id)}">
              <span class="admin-order-id">#${escapeHtml(String(order.id).slice(0, 8))}</span>
              <span>${escapeHtml(adminOrderDate(order.created_at))}</span>
              <span class="admin-state-chip">${escapeHtml(adminStatusLabel(order.status))}</span>
              <strong>${escapeHtml(formatPrice(Number(order.total)))}</strong>
              <span class="admin-customer-name">${escapeHtml(order.customer_name)}</span>
            </button>
            <button class="admin-order-delete" type="button" data-action="admin-order-delete" data-id="${escapeHtml(order.id)}" aria-label="حذف الطلب ${escapeHtml(order.id)}" ${adminState.deletingOrderId === order.id ? "disabled" : ""}>${adminState.deletingOrderId === order.id ? "جارٍ الحذف..." : "حذف"}</button>
          </div>`).join("") : `<p class="admin-empty">${adminState.orders.length ? "لا توجد طلبات في هذه الحالة." : "لا توجد طلبات لعرضها."}</p>`}
      </div>
      ${adminOrderDetailsMarkup()}`;

  return `
    <div class="admin-dashboard-header"><div><p class="eyebrow">إدارة المتجر</p><h2>لوحة التحكم</h2></div><button type="button" class="button button-outline" data-action="admin-signout">تسجيل الخروج</button></div>
    <div class="admin-stats"><div><span>المنتجات</span><b>${adminState.products.length}</b></div><div><span>كل الطلبات</span><b>${orderMetrics.all.count}</b><small>القيمة الكلية ${escapeHtml(formatPrice(orderMetrics.all.total))}</small></div><div><span>قيد التأكيد</span><b>${orderMetrics.confirming.count}</b><small>${escapeHtml(formatPrice(orderMetrics.confirming.total))}</small></div><div><span>قيد الشحن</span><b>${orderMetrics.shipped.count}</b><small>${escapeHtml(formatPrice(orderMetrics.shipped.total))}</small></div><div><span>مكتملة · مبيعات محققة</span><b>${orderMetrics.completed.count}</b><small>${escapeHtml(formatPrice(orderMetrics.completed.total))}</small></div><div><span>ملغية · لا تدخل بالمبيعات</span><b>${orderMetrics.cancelled.count}</b><small>${escapeHtml(formatPrice(orderMetrics.cancelled.total))}</small></div></div>
    <nav class="admin-tabs" aria-label="أقسام لوحة الإدارة">
      <button type="button" class="${activeTab === "orders" ? "is-active" : ""}" data-action="admin-tab" data-tab="orders" aria-selected="${activeTab === "orders"}">الطلبات</button>
      <button type="button" class="${activeTab === "products" ? "is-active" : ""}" data-action="admin-tab" data-tab="products" aria-selected="${activeTab === "products"}">المنتجات</button>
    </nav>
    <section class="admin-section" ${activeTab !== "orders" ? "hidden" : ""}><div class="admin-section-heading"><h3>الطلبات</h3><div class="admin-section-tools"><button class="button button-outline" type="button" data-action="admin-orders-refresh" ${adminState.refreshingOrders ? "disabled" : ""}>${adminState.refreshingOrders ? "جارٍ التحديث..." : "تحديث الطلبات"}</button></div></div><nav class="admin-order-tabs" aria-label="تصفية الطلبات">${orderStatusTabs.map((tab) => `<button type="button" class="${adminState.orderStatusTab === tab.id ? "is-active" : ""}" data-action="admin-order-tab" data-tab="${tab.id}" aria-pressed="${adminState.orderStatusTab === tab.id}"><span>${tab.label}</span><b>${orderMetrics[tab.id].count}</b><small>${escapeHtml(formatPrice(orderMetrics[tab.id].total))}</small></button>`).join("")}</nav>${adminState.ordersError ? ordersContent : `<div class="admin-order-columns"><span>رقم الطلب</span><span>التاريخ</span><span>الحالة</span><span>الإجمالي</span><span>العميل</span><span>إجراء</span></div>${ordersContent}`}</section>
    <section class="admin-section" ${activeTab !== "products" ? "hidden" : ""}><div class="admin-section-heading"><div><h3>المنتجات الحالية</h3><span>${visibleProducts.length} من ${adminState.products.length} منتج</span></div><button type="button" class="button button-primary" data-action="product-new">+ منتج جديد</button></div>${productsContent}</section>
    <p class="admin-readonly-note">الطلبات للعرض فقط. يمكن إضافة المنتجات وتعديلها وإخفاؤها وفق صلاحيات RLS الحالية.</p>
    ${activeTab === "products" ? productEditorMarkup() : ""}
    ${adminState.pendingOrderDeleteId ? `<div class="order-delete-backdrop" role="presentation"><section class="order-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="order-delete-title"><h3 id="order-delete-title">تأكيد حذف الطلب #${escapeHtml(String(adminState.pendingOrderDeleteId).slice(0, 8))}</h3><p>هل أنت متأكد أنك تريد حذف هذا الطلب نهائيًا؟ سيتم حذف الطلب وعناصره المرتبطة، ولا يمكن التراجع عن ذلك.</p><div><button class="button button-outline" type="button" data-action="admin-order-delete-cancel" ${adminState.deletingOrderId ? "disabled" : ""}>إلغاء</button><button class="button button-danger" type="button" data-action="admin-order-delete-confirm" ${adminState.deletingOrderId ? "disabled" : ""}>${adminState.deletingOrderId ? "جارٍ الحذف..." : "تأكيد الحذف"}</button></div></section></div>` : ""}`;
}

function adminPage() {
  layout(`<main class="admin-shell"><section class="admin-card ${adminState.authorized ? "admin-card-wide" : ""}">
    <a class="admin-brand" href="/" data-link><img class="admin-brand-logo" src="/assets/toma-logo.png" alt="شعار تُومة للأثاث" /><span><small>TOMA CONTROL</small><b>لوحة إدارة تُومة للأثاث</b></span></a>
    <p class="admin-lead">${adminState.authorized ? "مرحباً بك في إدارة المتجر." : "سجّل الدخول بحساب إدارة مخوّل."}</p>
    ${adminState.authorized ? "" : `<div class="admin-alert" id="admin-message" role="status">${isSupabaseConfigured ? "سيتحقق النظام من صلاحية الإدارة وعضوية الحساب." : "المصادقة غير مهيأة. أضف عنوان Supabase ومفتاح anon العام إلى ملف البيئة المحلي."}</div>
    <form id="admin-login" class="admin-form">
      <label>البريد الإلكتروني<input type="email" name="email" autocomplete="username" required /></label>
      <label>كلمة المرور<input type="password" name="password" autocomplete="current-password" required /></label>
      <button class="button button-primary button-full" type="submit" ${isSupabaseConfigured ? "" : "disabled"}>دخول</button>
    </form>`}
    ${adminState.authorized ? `<div class="admin-dashboard" id="admin-dashboard">${adminDashboardMarkup()}</div>` : ""}
    ${adminState.authorized ? "" : `<p class="admin-footnote">يتطلب الدخول جلسة Supabase صالحة ووجود المستخدم الحالي في <code>admin_users</code>. تفرض سياسات RLS الصلاحيات على كل استعلام.</p>`}
  </section></main>`, { admin: true });
  if (isSupabaseConfigured && !adminBootstrapStarted) {
    adminBootstrapStarted = true;
    void restoreAdminSession();
  }
}

function clearAdminState() {
  adminRequestVersion += 1;
  revokeProductImagePreviews(adminState.productEditor);
  adminState.authorized = false;
  adminState.userId = null;
  adminState.products = [];
  adminState.orders = [];
  adminState.selectedOrder = null;
  adminState.orderItems = [];
  adminState.orderDetailStatus = "idle";
  adminState.orderDetailError = "";
  adminState.productsError = "";
  adminState.ordersError = "";
  adminState.ordersLoading = false;
  adminState.pendingOrderDeleteId = null;
  adminState.deletingOrderId = null;
  adminState.updatingOrderId = null;
  adminState.productEditor = null;
}

function render() {
  const path = pathForCurrentPage();
  if (path !== "/admin" && adminState.authorized) {
    clearAdminState();
    adminBootstrapStarted = false;
  }
  if (path === "/") return homePage();
  if (path === "/products") return productListing();
  if (path === "/collections") return collectionsPage();
  if (path.startsWith("/collections/")) return productListing({ category: decodeURIComponent(path.split("/")[2]) });
  if (path === "/cart") return cartPage();
  if (path === "/checkout") return checkoutPage();
  if (path === "/wishlist") return productListing({ wishlistOnly: true });
  if (path === "/admin") return adminPage();
  if (path.startsWith("/products/")) return productDetail(decodeURIComponent(path.split("/")[2]));
  return notFoundPage();
}

function changeCart(productId, amount = 1, replace = false) {
  const product = products.find((item) => item.id === productId);
  if (product?.pricingType === "negotiated") {
    toast("هذا المنتج يُسعّر حسب الاتفاق. تواصل معنا عبر واتساب.");
    return false;
  }
  const cart = getCart();
  const existing = cart.find((item) => item.id === productId);
  if (replace && existing) existing.quantity = amount;
  else if (existing) existing.quantity += amount;
  else if (amount > 0) cart.push({ id: productId, quantity: amount });
  setCart(cart.filter((item) => item.quantity > 0));
  render();
  return true;
}

async function submitCheckout(form) {
  if (checkoutSubmitting || checkoutBlocked || !form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const errorBox = form.querySelector("#checkout-error");
  const button = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  const phone = String(formData.get("phone") ?? "").trim();
  const phoneDigits = phone.replace(/\D/g, "");
  if (!/^[+()0-9\s-]+$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 20) {
    if (errorBox) {
      errorBox.textContent = "أدخل رقم هاتف صحيحًا من 7 إلى 20 رقمًا.";
      errorBox.hidden = false;
    }
    return;
  }
  const cartItems = getCart()
    .map((item) => ({ ...item }))
    .filter((item) => item.quantity > 0);
  if (!supabase || !cartItems.length) {
    if (errorBox) {
      errorBox.textContent = "تعذر الاتصال بخدمة الطلبات. لم يتم إرسال الطلب.";
      errorBox.hidden = false;
    }
    return;
  }

  checkoutSubmitting = true;
  if (button) {
    button.disabled = true;
    button.textContent = "جارٍ إرسال الطلب...";
  }
  let orderWriteStarted = false;
  try {
    const { data: currentProducts, error: productError } = await supabase
      .from("products")
      .select("id,name,price,pricing_type,is_active")
      .in("id", cartItems.map((item) => item.id))
      .eq("is_active", true);
    if (productError) throw new Error("تعذر التحقق من الأسعار الحالية.");
    const productById = new Map((currentProducts ?? []).map((product) => [product.id, product]));
    const verifiedItems = cartItems.map((item) => {
      const product = productById.get(item.id);
      const shownProduct = products.find((current) => current.id === item.id);
      if (!product || product.pricing_type !== "fixed" ||
          !Number.isFinite(Number(product.price)) || Number(product.price) < 0) {
        throw new Error("تغيرت حالة أحد المنتجات أو سعره. راجع السلة قبل إرسال الطلب.");
      }
      if (!shownProduct || Number(shownProduct.price) !== Number(product.price)) {
        throw new Error("تغير سعر أحد المنتجات منذ عرض السلة. راجع السعر الجديد قبل تأكيد الطلب.");
      }
      return {
        order_id: "",
        product_id: product.id,
        product_name: product.name,
        quantity: item.quantity,
        price: Number(product.price),
      };
    });
    if (productById.size !== cartItems.length) {
      throw new Error("لم تعد كل المنتجات في السلة متاحة. حدّث السلة وحاول مجددًا.");
    }

    const total = Number(verifiedItems.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2));
    if (!Number.isFinite(total) || total < 0) throw new Error("تعذر حساب إجمالي الطلب.");
    const orderId = crypto.randomUUID();
    orderWriteStarted = true;
    const { error: orderError } = await supabase.from("orders").insert({
      id: orderId,
      customer_name: String(formData.get("name") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim(),
      address: `${String(formData.get("region") ?? "").trim()} - ${String(formData.get("address") ?? "").trim()}`,
      total,
      status: "new",
      created_at: new Date().toISOString(),
    });
    if (orderError) throw new Error("تعذر حفظ الطلب. قد تمنع سياسات RLS إنشاء الطلبات.");

    const { error: itemsError } = await supabase.from("order_items").insert(
      verifiedItems.map((item) => ({ ...item, order_id: orderId })),
    );
    if (itemsError) {
      checkoutBlocked = true;
      throw new Error("حُفظ سجل الطلب لكن تعذر حفظ عناصره. لم نعرض نجاحًا؛ تواصل معنا للتحقق ولا تعِد الإرسال.");
    }

    checkoutSuccessOrderId = orderId;
    checkoutBlocked = false;
    setCart([]);
    render();
  } catch (error) {
    if (orderWriteStarted && !(error instanceof Error && error.message.includes("حُفظ سجل الطلب"))) {
      checkoutBlocked = true;
    }
    if (errorBox?.isConnected) {
      errorBox.textContent = error instanceof Error
        ? error.message
        : "تعذر إتمام الطلب. لم نتمكن من تأكيد الحفظ.";
      errorBox.hidden = false;
      if (checkoutBlocked && button) button.disabled = true;
    }
  } finally {
    checkoutSubmitting = false;
    if (button?.isConnected && !checkoutBlocked) button.disabled = false;
  }
}

async function handleAdminLogin(form) {
  const message = document.querySelector("#admin-message");
  const button = form.querySelector("button");
  const credentials = new FormData(form);
  button.disabled = true;
  message.textContent = "جارٍ التحقق من بيانات الدخول...";
  try {
    if (!supabase) throw new Error("المصادقة غير مهيأة.");
    const { error } = await supabase.auth.signInWithPassword({
      email: String(credentials.get("email") ?? ""),
      password: String(credentials.get("password") ?? ""),
    });
    if (error) throw new Error("تعذر تسجيل الدخول. تحقق من بيانات الحساب وحاول مجدداً.");
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error("تعذر التحقق من جلسة الدخول.");
    await authorizeAdmin(userData.user);
  } catch (error) {
    if (!adminState.authorized) {
      message.textContent = error instanceof Error ? error.message : "تعذر إكمال تسجيل الدخول.";
    }
    button.disabled = false;
  }
}

async function authorizeAdmin(user) {
  const message = document.querySelector("#admin-message");
  if (!supabase || !user?.id) {
    await supabase?.auth.signOut();
    throw new Error("تم رفض الدخول: تعذر التحقق من جلسة المستخدم.");
  }

  let membership;
  try {
    const result = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (result.error) throw result.error;
    membership = result.data;
  } catch {
    await supabase.auth.signOut();
    throw new Error("تعذر التحقق من عضوية الإدارة. لم يتم تحميل أي بيانات إدارية.");
  }

  if (!membership || membership.user_id !== user.id) {
    await supabase.auth.signOut();
    throw new Error("تم رفض الدخول: المستخدم غير مسجل في قائمة المديرين.");
  }

  adminState.authorized = true;
  adminState.userId = user.id;
  if (message) {
    message.textContent = "تم التحقق من صلاحية الإدارة.";
    message.hidden = false;
  }
  await loadAdminData();
  if (pathForCurrentPage() === "/admin") render();
}

async function restoreAdminSession() {
  if (pathForCurrentPage() !== "/admin" || !supabase) return;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return;
    await authorizeAdmin(data.user);
  } catch (error) {
    const message = document.querySelector("#admin-message");
    if (message && pathForCurrentPage() === "/admin") {
      message.textContent = error instanceof Error ? error.message : "تعذر التحقق من جلسة الإدارة.";
    }
  }
}

async function loadAdminData() {
  if (!supabase || !adminState.authorized) return;
  const requestVersion = ++adminRequestVersion;
  adminState.productsError = "";
  adminState.ordersError = "";
  adminState.ordersLoading = true;
  const [productsResult, ordersResult] = await Promise.all([
    supabase
      .from("products")
      .select("id,name,category,description,price,image_url,image_urls,badge,pricing_type,price_text,is_active,created_at"),
    fetchAllAdminOrders(),
  ]);
  if (!adminState.authorized || requestVersion !== adminRequestVersion) return;
  adminState.ordersLoading = false;

  if (productsResult.error) {
    adminState.products = [];
    adminState.productsError = "تعذر تحميل المنتجات. تحقق من صلاحية القراءة وسياسة RLS.";
  } else {
    adminState.products = (productsResult.data ?? []).map(normalizeProduct);
  }
  if (ordersResult.error) {
    adminState.orders = [];
    adminState.ordersError = "تعذر تحميل الطلبات. تحقق من صلاحية القراءة وسياسة RLS.";
  } else {
    adminState.orders = ordersResult.data ?? [];
  }
}

async function fetchAllAdminOrders() {
  const pageSize = 500;
  const orders = [];
  for (let from = 0; ; from += pageSize) {
    const result = await supabase
      .from("orders")
      .select("id,customer_name,total,status,created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (result.error) return result;
    orders.push(...(result.data ?? []));
    if ((result.data ?? []).length < pageSize) return { data: orders, error: null };
  }
}

async function refreshAdminOrders() {
  if (!adminState.authorized || adminState.refreshingOrders) return;
  adminState.refreshingOrders = true;
  render();
  try {
    await loadAdminData();
    if (adminState.ordersError) toast("تعذر تحديث الطلبات. تحقق من الاتصال وصلاحية القراءة.");
    else {
      if (adminState.selectedOrder && adminState.orders.some((order) => order.id === adminState.selectedOrder.id)) {
        await loadAdminOrderDetails(adminState.selectedOrder.id);
      }
      toast("تم تحديث الطلبات.");
    }
  } catch {
    adminState.ordersError = "تعذر تحديث الطلبات بسبب مشكلة في الاتصال.";
    toast(adminState.ordersError);
  } finally {
    adminState.refreshingOrders = false;
    if (adminState.authorized && pathForCurrentPage() === "/admin") render();
  }
}

async function deleteAdminOrder(orderId) {
  const order = adminState.orders.find((item) => item.id === orderId);
  if (!order || adminState.pendingOrderDeleteId !== orderId || !adminState.authorized || !supabase || adminState.deletingOrderId) return;
  adminState.deletingOrderId = orderId;
  render();
  try {
    await assertAdminMembership();
    const result = await supabase.from("orders").delete().eq("id", orderId).select("id").maybeSingle();
    if (result.error) throw new Error("تعذر حذف الطلب. قد تمنع سياسة RLS العملية؛ لم يتم تأكيد الحذف.");
    if (!result.data?.id) throw new Error("لم يؤكد Supabase حذف الطلب. تحقق من سياسة RLS وصلاحية الحذف.");
    if (adminState.selectedOrder?.id === orderId) {
      adminState.selectedOrder = null;
      adminState.orderItems = [];
      adminState.orderDetailStatus = "idle";
    }
    adminState.pendingOrderDeleteId = null;
    toast("تم حذف الطلب.");
    await loadAdminData();
  } catch (error) {
    if (adminState.authorized) toast(error instanceof Error ? error.message : "تعذر حذف الطلب.");
  } finally {
    adminState.deletingOrderId = null;
    if (adminState.authorized && pathForCurrentPage() === "/admin") render();
  }
}

async function updateAdminOrderStatus(form) {
  const orderId = form.dataset.orderId;
  const status = String(new FormData(form).get("status") ?? "");
  const allowedStatuses = new Set(["new", "confirmed", "shipped", "completed", "cancelled"]);
  if (!orderId || !allowedStatuses.has(status) || !adminState.authorized || !supabase || adminState.updatingOrderId) return;
  adminState.updatingOrderId = orderId;
  render();
  try {
    await assertAdminMembership();
    const result = await supabase
      .from("orders")
      .update({ status })
      .eq("id", orderId)
      .select("id,status")
      .maybeSingle();
    if (result.error) throw new Error("تعذر تحديث حالة الطلب. تحقق من صلاحية RLS والحالة المسموحة.");
    if (!result.data?.id || result.data.status !== status) throw new Error("لم يؤكد Supabase تحديث حالة الطلب.");
    if (adminState.selectedOrder?.id === orderId) adminState.selectedOrder.status = status;
    await loadAdminData();
    if (adminState.ordersError) throw new Error("تم تحديث الحالة لكن تعذر تحديث قائمة الطلبات؛ استخدم زر تحديث الطلبات.");
    toast("تم تحديث حالة الطلب.");
  } catch (error) {
    if (adminState.authorized) toast(error instanceof Error ? error.message : "تعذر تحديث حالة الطلب.");
  } finally {
    adminState.updatingOrderId = null;
    if (adminState.authorized && pathForCurrentPage() === "/admin") render();
  }
}

async function assertAdminMembership() {
  if (!supabase || !adminState.authorized) throw new Error("انتهت جلسة الإدارة. سجّل الدخول مرة أخرى.");
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || data.user.id !== adminState.userId) {
    clearAdminState();
    render();
    throw new Error("تعذر التحقق من جلسة الإدارة. سجّل الدخول مرة أخرى.");
  }
  const membership = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (membership.error || membership.data?.user_id !== data.user.id) {
    clearAdminState();
    render();
    throw new Error("تعذر التحقق من صلاحية الإدارة.");
  }
  return data.user.id;
}

function openProductEditor(product = null) {
  if (!adminState.authorized) return;
  adminState.activeTab = "products";
  adminState.productEditor = {
    product,
    saving: false,
    error: "",
    imageStatus: "",
    replacingImageId: null,
    cropper: null,
    imageItems: (product?.images ?? []).map((url) => ({
      id: `product-image-${++productImageId}`,
      url,
      name: "",
      file: null,
    })),
  };
  render();
}

function revokeProductImagePreviews(editor) {
  editor?.imageItems.forEach((image) => {
    if (image.file) URL.revokeObjectURL(image.url);
  });
}

async function uploadNewProductImages(editor) {
  let uploadedCount = 0;
  const pending = editor.imageItems.filter((image) => image.file);
  for (const image of pending) {
    editor.imageStatus = `جارٍ رفع الصورة ${uploadedCount + 1} من ${pending.length}...`;
    updateProductImagePreview(editor);
    try {
      await assertAdminMembership();
      const extensionByType = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
      const extension = extensionByType[image.file.type];
      if (!extension || image.file.size > maxProductImageSize) {
        throw new Error("Invalid image file");
      }
      const path = `products/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage
        .from("product-images")
        .upload(path, image.file, {
          cacheControl: "31536000",
          contentType: image.file.type,
          upsert: false,
        });
      if (error) throw error;
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      if (!data.publicUrl) throw new Error("Public URL unavailable");
      URL.revokeObjectURL(image.url);
      image.url = data.publicUrl;
      image.file = null;
      uploadedCount += 1;
      editor.imageStatus = `تم رفع ${uploadedCount} من ${pending.length} صورة.`;
      updateProductImagePreview(editor);
    } catch {
      editor.imageStatus = uploadedCount
        ? `تم رفع ${uploadedCount} صورة، وتعذر رفع البقية. لم تُحفظ بيانات المنتج؛ الصور والحقول ما زالت محفوظة في النموذج.`
        : "تعذر رفع الصورة. لم تُحفظ بيانات المنتج؛ الصور والحقول ما زالت محفوظة في النموذج. تحقق من سياسة Storage.";
      updateProductImagePreview(editor);
      throw new Error("تعذر رفع الصور إلى مخزن المنتج. راجع صلاحية المدير وسياسة Storage.");
    }
  }
  return uploadedCount;
}

function closeProductEditor() {
  if (adminState.productEditor?.saving) return;
  revokeProductImagePreviews(adminState.productEditor);
  adminState.productEditor = null;
  render();
}

function updateProductImagePreview(editor) {
  const preview = document.querySelector("#product-editor-preview");
  if (preview) preview.innerHTML = productImagePreviewMarkup(editor);
  const status = document.querySelector("#product-image-status");
  if (status) status.textContent = editor.imageStatus;
}

function addProductImageFiles(input, asMain) {
  const editor = adminState.productEditor;
  if (!editor) return;
  const selected = [...(input.files ?? [])];
  input.value = "";
  if (!selected.length) return;
  const invalid = selected.find((file) => !allowedProductImageTypes.has(file.type) || file.size > maxProductImageSize);
  if (invalid) {
    editor.imageStatus = !allowedProductImageTypes.has(invalid.type)
      ? "نوع ملف غير مدعوم. اختر JPG أو PNG أو WebP."
      : "حجم الصورة أكبر من الحد المسموح (10 ميغابايت). لم تُضف أي صورة.";
    updateProductImagePreview(editor);
    return;
  }

  const additions = selected.map((file) => ({
    id: `product-image-${++productImageId}`,
    url: URL.createObjectURL(file),
    name: file.name,
    file,
  }));
  editor.imageItems.push(...additions);
  if (asMain && additions.length) {
    const newMain = additions[0];
    editor.imageItems = [newMain, ...editor.imageItems.filter((image) => image.id !== newMain.id)];
  }
  editor.imageStatus = `${additions.length} صورة جاهزة للمعاينة على هذا الجهاز. لم يتم رفعها أو حفظها.`;
  updateProductImagePreview(editor);
}

function replaceProductImageFile(input) {
  const editor = adminState.productEditor;
  const selected = input.files?.[0];
  const imageId = editor?.replacingImageId;
  input.value = "";
  if (!editor || !selected || !imageId) return;
  const imageIndex = editor.imageItems.findIndex((image) => image.id === imageId);
  editor.replacingImageId = null;
  if (imageIndex < 0) return;
  if (!allowedProductImageTypes.has(selected.type)) {
    editor.imageStatus = "نوع ملف غير مدعوم. اختر JPG أو PNG أو WebP؛ لم تتغير الصورة الحالية.";
    updateProductImagePreview(editor);
    return;
  }
  if (selected.size > maxProductImageSize) {
    editor.imageStatus = "حجم الصورة أكبر من الحد المسموح (10 ميغابايت)؛ لم تتغير الصورة الحالية.";
    updateProductImagePreview(editor);
    return;
  }
  const current = editor.imageItems[imageIndex];
  if (current.file) URL.revokeObjectURL(current.url);
  editor.imageItems[imageIndex] = {
    id: current.id,
    url: URL.createObjectURL(selected),
    name: selected.name,
    file: selected,
  };
  editor.imageStatus = "استُبدلت الصورة في المعاينة المحلية فقط؛ لم تُرفع ولم يتغير المنتج المحفوظ.";
  updateProductImagePreview(editor);
}

function cropStageSize(cropper) {
  const ratio = 4 / 3;
  const width = Math.min(560, window.innerWidth * 0.66, window.innerHeight * 0.48 * ratio);
  return { width, height: width / ratio };
}

function cropImageGeometry(cropper, zoom = cropper.zoom) {
  const { width, height } = cropStageSize(cropper);
  const baseScale = Math.max(width / cropper.naturalWidth, height / cropper.naturalHeight);
  return {
    width,
    height,
    imageWidth: cropper.naturalWidth * baseScale * zoom,
    imageHeight: cropper.naturalHeight * baseScale * zoom,
  };
}

function drawCropPreview(editor) {
  const cropper = editor?.cropper;
  const image = cropper?.image;
  const stage = document.querySelector("#image-cropper-stage");
  const preview = document.querySelector("#image-cropper-preview");
  const zoomInput = document.querySelector("#image-cropper-zoom");
  if (!cropper || !image || !stage || !preview || !cropper.ready) return;

  const { width, height, imageWidth, imageHeight } = cropImageGeometry(cropper);
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  if (cropper.offsetX === null || cropper.offsetX === undefined) {
    cropper.offsetX = (width - imageWidth) / 2;
  }
  if (cropper.offsetY === null || cropper.offsetY === undefined) {
    cropper.offsetY = (height - imageHeight) / 2;
  }
  cropper.offsetX = Math.max(width - imageWidth, Math.min(0, cropper.offsetX));
  cropper.offsetY = Math.max(height - imageHeight, Math.min(0, cropper.offsetY));
  const source = stage.querySelector(".image-cropper-source");
  if (source) {
    source.style.width = `${imageWidth}px`;
    source.style.height = `${imageHeight}px`;
    source.style.left = `${cropper.offsetX}px`;
    source.style.top = `${cropper.offsetY}px`;
  }
  if (zoomInput) zoomInput.value = String(cropper.zoom);

  preview.width = 480;
  preview.height = 360;
  const sourceX = (-cropper.offsetX / imageWidth) * cropper.naturalWidth;
  const sourceY = (-cropper.offsetY / imageHeight) * cropper.naturalHeight;
  const sourceWidth = (width / imageWidth) * cropper.naturalWidth;
  const sourceHeight = (height / imageHeight) * cropper.naturalHeight;
  const context = preview.getContext("2d");
  context.clearRect(0, 0, preview.width, preview.height);
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, preview.width, preview.height);
}

async function openProductImageCropper(imageId) {
  const editor = adminState.productEditor;
  const selected = editor?.imageItems.find((image) => image.id === imageId);
  if (!editor || !selected) return;
  editor.cropper = {
    imageId,
    sourceUrl: selected.url,
    image: null,
    naturalWidth: 0,
    naturalHeight: 0,
    zoom: 1,
    offsetX: null,
    offsetY: null,
    ready: false,
    error: "",
    pointer: null,
  };
  render();
  const cropper = editor.cropper;
  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Image could not be loaded"));
      image.src = selected.url;
      if (image.complete && image.naturalWidth > 0) resolve();
    });
    if (adminState.productEditor !== editor || editor.cropper !== cropper) return;
    cropper.image = image;
    cropper.naturalWidth = image.naturalWidth;
    cropper.naturalHeight = image.naturalHeight;
    cropper.ready = true;
    render();
    drawCropPreview(editor);
  } catch {
    if (adminState.productEditor !== editor || editor.cropper !== cropper) return;
    cropper.error = "تعذر فتح الصورة للقص. احتفظنا بالنسخة المختارة دون تغيير.";
    render();
  }
}

function updateCropperZoom(value) {
  const cropper = adminState.productEditor?.cropper;
  const zoom = Number(value);
  if (!cropper?.ready || !Number.isFinite(zoom)) return;
  const previous = cropImageGeometry(cropper);
  const centerX = previous.width / 2;
  const centerY = previous.height / 2;
  const imagePointX = (centerX - cropper.offsetX) / previous.imageWidth * cropper.naturalWidth;
  const imagePointY = (centerY - cropper.offsetY) / previous.imageHeight * cropper.naturalHeight;
  cropper.zoom = Math.max(1, Math.min(4, zoom));
  const next = cropImageGeometry(cropper);
  cropper.offsetX = centerX - imagePointX / cropper.naturalWidth * next.imageWidth;
  cropper.offsetY = centerY - imagePointY / cropper.naturalHeight * next.imageHeight;
  const zoomLabel = document.querySelector(".image-cropper-zoom span");
  if (zoomLabel) zoomLabel.textContent = `${Math.round(cropper.zoom * 100)}%`;
  drawCropPreview(adminState.productEditor);
}

function resetProductImageCrop() {
  const cropper = adminState.productEditor?.cropper;
  if (!cropper) return;
  cropper.zoom = 1;
  cropper.offsetX = null;
  cropper.offsetY = null;
  cropper.error = "";
  drawCropPreview(adminState.productEditor);
}

function moveProductImageCrop(event) {
  const cropper = adminState.productEditor?.cropper;
  if (!cropper?.pointer || !cropper.ready) return;
  cropper.offsetX = cropper.pointer.offsetX + event.clientX - cropper.pointer.x;
  cropper.offsetY = cropper.pointer.offsetY + event.clientY - cropper.pointer.y;
  drawCropPreview(adminState.productEditor);
}

async function confirmProductImageCrop() {
  const editor = adminState.productEditor;
  const cropper = editor?.cropper;
  if (!editor || !cropper?.ready || !cropper.image) return;
  const current = editor.imageItems.find((image) => image.id === cropper.imageId);
  if (!current) return;
  try {
    const { width: stageWidth, height: stageHeight, imageWidth, imageHeight } = cropImageGeometry(cropper);
    const sourceX = (-cropper.offsetX / imageWidth) * cropper.naturalWidth;
    const sourceY = (-cropper.offsetY / imageHeight) * cropper.naturalHeight;
    const sourceWidth = (stageWidth / imageWidth) * cropper.naturalWidth;
    const sourceHeight = (stageHeight / imageHeight) * cropper.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1800;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(cropper.image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    const type = current.file?.type && allowedProductImageTypes.has(current.file.type)
      ? current.file.type
      : "image/webp";
    const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    const name = (current.name || "product-image").replace(/\.[^.]+$/, "");
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Canvas export failed")), type, 0.9);
    });
    if (blob.size > maxProductImageSize) {
      cropper.error = "حجم الصورة بعد القص أكبر من 10 ميغابايت. قلل التكبير أو اختر صورة أصغر.";
      render();
      return;
    }
    const croppedFile = new File([blob], `${name}-cropped.${extension}`, { type, lastModified: Date.now() });
    const croppedUrl = URL.createObjectURL(croppedFile);
    const image = editor.imageItems.find((item) => item.id === cropper.imageId);
    if (image.file) URL.revokeObjectURL(image.url);
    image.url = croppedUrl;
    image.name = croppedFile.name;
    image.file = croppedFile;
    editor.cropper = null;
    editor.imageStatus = "تم اعتماد القص محليًا. الصورة الناتجة لم تُرفع بعد.";
    render();
  } catch {
    cropper.error = "تعذر إنشاء ملف الصورة المقصوصة. بقيت الصورة الأصلية دون تغيير.";
    render();
  }
}

function reorderProductImages(draggedId, targetId) {
  const editor = adminState.productEditor;
  const from = editor?.imageItems.findIndex((image) => image.id === draggedId) ?? -1;
  const to = editor?.imageItems.findIndex((image) => image.id === targetId) ?? -1;
  if (!editor || from < 0 || to < 0 || from === to) return;
  const [image] = editor.imageItems.splice(from, 1);
  editor.imageItems.splice(to, 0, image);
  editor.imageStatus = "تم تغيير ترتيب المعاينة محليًا. لم يُحفظ الترتيب.";
  updateProductImagePreview(editor);
}

function setProductMainImage(imageId) {
  const editor = adminState.productEditor;
  const index = editor?.imageItems.findIndex((image) => image.id === imageId) ?? -1;
  if (!editor || index < 0 || index === 0) return;
  const [image] = editor.imageItems.splice(index, 1);
  editor.imageItems.unshift(image);
  editor.imageStatus = "تم تعيين الصورة الرئيسية للمعاينة المحلية؛ لم يتم حفظ التغيير.";
  updateProductImagePreview(editor);
}

function showProductEditorError(form, message) {
  const editor = adminState.productEditor;
  if (editor) editor.error = message;
  const errorBox = form.querySelector("#product-editor-error");
  if (errorBox) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }
}

async function saveAdminProduct(form) {
  const editor = adminState.productEditor;
  if (!editor || editor.saving || !adminState.authorized) return;
  const button = form.querySelector('button[type="submit"]');
  const fields = new FormData(form);
  const name = String(fields.get("name") ?? "").trim();
  const category = String(fields.get("category") ?? "").trim();
  const pricingType = String(fields.get("pricing_type") ?? "");
  const rawPrice = String(fields.get("price") ?? "").trim();
  const priceText = String(fields.get("price_text") ?? "").trim();
  if (!name || !category) {
    showProductEditorError(form, "اكتب اسم المنتج والتصنيف.");
    return;
  }
  if (pricingType !== "fixed" && pricingType !== "negotiated") {
    showProductEditorError(form, "اختر نوع تسعير صالح.");
    return;
  }
  if (pricingType === "fixed" && (!rawPrice || !Number.isFinite(Number(rawPrice)) || Number(rawPrice) < 0)) {
    showProductEditorError(form, "أدخل سعرًا رقميًا صحيحًا لا يقل عن صفر.");
    return;
  }
  if (pricingType === "negotiated" && !priceText) {
    showProductEditorError(form, "أدخل عبارة توضح أن السعر حسب الاتفاق.");
    return;
  }
  editor.saving = true;
  editor.error = "";
  [...form.elements].forEach((element) => { element.disabled = true; });
  let uploadedImages = 0;
  try {
    await assertAdminMembership();
    uploadedImages = await uploadNewProductImages(editor);
    const payload = {
      name,
      category,
      description: String(fields.get("description") ?? "").trim(),
      badge: String(fields.get("badge") ?? "").trim() || null,
      pricing_type: pricingType,
      price: pricingType === "fixed" ? Number(rawPrice) : null,
      price_text: pricingType === "negotiated" ? priceText : null,
      image_url: editor.imageItems[0]?.url ?? null,
      image_urls: editor.imageItems.slice(1).map((image) => image.url),
      is_active: fields.get("is_active") === "on",
    };
    const result = editor.product
      ? await supabase.from("products").update(payload).eq("id", editor.product.id).select("id").maybeSingle()
      : await supabase.from("products").insert(payload).select("id").single();
    if (result.error) throw result.error;
    if (!result.data?.id) throw new Error("Product save returned no row");
    revokeProductImagePreviews(editor);
    adminState.productEditor = null;
    toast(editor.product ? "تم تحديث المنتج." : "تمت إضافة المنتج.");
    await loadAdminData();
    if (pathForCurrentPage() === "/admin") render();
  } catch (error) {
    if (!adminState.authorized) return;
    editor.saving = false;
    const uploadFailed = error instanceof Error && error.message.includes("رفع الصور");
    const message = error instanceof Error && error.message.includes("جلسة")
      ? error.message
      : uploadFailed
        ? error.message
        : "تعذر حفظ المنتج. بيانات النموذج باقية؛ تحقق من صلاحيات RLS والحقول المطلوبة.";
    if (uploadedImages) {
      editor.imageStatus = "رُفعت الصور، لكن تعذر حفظ بيانات المنتج. احتفظنا بالروابط في النموذج؛ لم تُحذف الصور المرفوعة تلقائيًا.";
      updateProductImagePreview(editor);
    }
    showProductEditorError(form, message);
    [...form.elements].forEach((element) => { element.disabled = false; });
    if (button) button.disabled = false;
  }
}

async function loadAdminOrderDetails(orderId) {
  if (!supabase || !adminState.authorized) return;
  const requestVersion = ++adminRequestVersion;
  adminState.selectedOrder = adminState.orders.find((order) => order.id === orderId) ?? null;
  adminState.orderItems = [];
  adminState.orderDetailStatus = "loading";
  adminState.orderDetailError = "";
  render();
  if (!adminState.selectedOrder) return;

  const [orderResult, itemsResult] = await Promise.all([
    supabase
      .from("orders")
      .select("id,customer_name,phone,email,address,total,status,created_at")
      .eq("id", orderId)
      .maybeSingle(),
    supabase
      .from("order_items")
      .select("product_name,quantity,price")
      .eq("order_id", orderId),
  ]);
  if (!adminState.authorized || requestVersion !== adminRequestVersion) return;

  if (orderResult.error || !orderResult.data || itemsResult.error) {
    adminState.selectedOrder = null;
    adminState.orderItems = [];
    adminState.orderDetailStatus = "error";
    adminState.orderDetailError = "تعذر تحميل تفاصيل الطلب. لا تعرض البيانات حتى يُسمح بالوصول عبر RLS.";
    render();
    return;
  }
  adminState.selectedOrder = orderResult.data;
  adminState.orderItems = itemsResult.data ?? [];
  adminState.orderDetailStatus = "ready";
  render();
}

async function signOutAdmin() {
  if (!supabase) return;
  adminRequestVersion += 1;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    clearAdminState();
    render();
  } catch {
    toast("تعذر تسجيل الخروج. حاول مرة أخرى.");
  }
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-link]");
  if (link) {
    const destination = new URL(link.href);
    if (destination.origin === location.origin) {
      event.preventDefault();
      navigate(`${destination.pathname}${destination.hash}`);
      if (destination.hash) {
        requestAnimationFrame(() => document.querySelector(destination.hash)?.scrollIntoView({ behavior: "smooth" }));
      }
    }
    return;
  }

  const action = event.target.closest("[data-action]");
  if (!action) {
    if (event.target.closest(".detail-main-image")) {
      if (Date.now() < galleryState.suppressClickUntil) return;
      galleryState.lightbox = true;
      render();
    }
    return;
  }
  const id = action.dataset.id;
  if (action.dataset.action === "admin-signout") {
    void signOutAdmin();
  } else if (action.dataset.action === "admin-tab" && adminState.authorized) {
    adminState.activeTab = action.dataset.tab === "products" ? "products" : "orders";
    render();
  } else if (action.dataset.action === "admin-order-open" && adminState.authorized) {
    void loadAdminOrderDetails(id);
  } else if (action.dataset.action === "admin-order-tab" && adminState.authorized) {
    if (orderStatusTabs.some((tab) => tab.id === action.dataset.tab)) {
      adminState.orderStatusTab = action.dataset.tab;
      render();
    }
  } else if (action.dataset.action === "admin-orders-refresh" && adminState.authorized) {
    void refreshAdminOrders();
  } else if (action.dataset.action === "admin-order-delete" && adminState.authorized) {
    if (adminState.orders.some((order) => order.id === id) && !adminState.deletingOrderId) {
      adminState.pendingOrderDeleteId = id;
      render();
    }
  } else if (action.dataset.action === "admin-order-delete-cancel" && adminState.authorized) {
    if (!adminState.deletingOrderId) {
      adminState.pendingOrderDeleteId = null;
      render();
    }
  } else if (action.dataset.action === "admin-order-delete-confirm" && adminState.authorized) {
    if (adminState.pendingOrderDeleteId) void deleteAdminOrder(adminState.pendingOrderDeleteId);
  } else if (action.dataset.action === "admin-order-close" && adminState.authorized) {
    adminRequestVersion += 1;
    adminState.selectedOrder = null;
    adminState.orderItems = [];
    adminState.orderDetailStatus = "idle";
    render();
  } else if (action.dataset.action === "product-new" && adminState.authorized) {
    openProductEditor();
  } else if (action.dataset.action === "product-edit" && adminState.authorized) {
    const product = adminState.products.find((item) => item.id === id);
    if (product) openProductEditor(product);
  } else if (action.dataset.action === "product-toggle" && adminState.authorized) {
    void toggleAdminProduct(id);
  } else if (action.dataset.action === "product-delete" && adminState.authorized) {
    void deleteAdminProduct(id);
  } else if (action.dataset.action === "product-editor-close") {
    closeProductEditor();
  } else if (action.dataset.action === "choose-main-image") {
    document.querySelector("#product-main-image-input")?.click();
  } else if (action.dataset.action === "choose-gallery-images") {
    document.querySelector("#product-gallery-image-input")?.click();
  } else if (action.dataset.action === "image-replace") {
    const editor = adminState.productEditor;
    if (!editor?.imageItems.some((image) => image.id === action.dataset.imageId)) return;
    editor.replacingImageId = action.dataset.imageId;
    document.querySelector("#product-replace-image-input")?.click();
  } else if (action.dataset.action === "image-crop") {
    void openProductImageCropper(action.dataset.imageId);
  } else if (action.dataset.action === "crop-cancel") {
    if (adminState.productEditor) adminState.productEditor.cropper = null;
    render();
  } else if (action.dataset.action === "crop-reset") {
    resetProductImageCrop();
  } else if (action.dataset.action === "crop-confirm") {
    void confirmProductImageCrop();
  } else if (action.dataset.action === "image-remove") {
    const editor = adminState.productEditor;
    const index = editor?.imageItems.findIndex((image) => image.id === action.dataset.imageId) ?? -1;
    if (editor && index >= 0) {
      const [removed] = editor.imageItems.splice(index, 1);
      if (removed.file) URL.revokeObjectURL(removed.url);
      editor.imageStatus = "أُزيلت الصورة من الاختيار المحلي. لم يتغير المنتج المحفوظ.";
      updateProductImagePreview(editor);
    }
  } else if (action.dataset.action === "image-set-main") {
    setProductMainImage(action.dataset.imageId);
  } else if (action.dataset.action === "gallery-image") {
    const product = products.find((item) => item.id === pathForCurrentPage().split("/")[2]);
    if (!product || !Number.isInteger(Number(action.dataset.index))) return;
    galleryState.index = Number(action.dataset.index);
    galleryState.lightbox = false;
    render();
  } else if (action.dataset.action === "gallery-step") {
    moveGallery(Number(action.dataset.delta));
  } else if (action.dataset.action === "gallery-zoom") {
    galleryState.lightbox = true;
    render();
  } else if (action.dataset.action === "gallery-close" ||
    (action.dataset.action === "lightbox-backdrop" && event.target === action)) {
    galleryState.lightbox = false;
    render();
  } else if (action.dataset.action === "add") {
    if (changeCart(id)) toast("اتضاف للسلة بنجاح");
  } else if (action.dataset.action === "wishlist") {
    toggleWishlist(id);
    render();
    toast("تم تحديث المفضلة");
  } else if (action.dataset.action === "remove") {
    setCart(getCart().filter((item) => item.id !== id));
    render();
  } else if (action.dataset.action === "quantity") {
    if (!changeCart(id, Number(action.dataset.delta))) return;
  } else if (action.dataset.action === "search") {
    const box = document.querySelector(".search-box");
    box.classList.toggle("is-open");
    if (box.classList.contains("is-open")) box.querySelector("input").focus();
  }
});

document.addEventListener("submit", (event) => {
  if (event.target.matches(".search-box")) {
    event.preventDefault();
    searchValue = String(new FormData(event.target).get("q") ?? "").trim();
    navigate("/products");
  } else if (event.target.matches("#checkout-form")) {
    event.preventDefault();
    if (checkoutSubmitting || checkoutBlocked) return;
    void submitCheckout(event.target);
  } else if (event.target.matches("#admin-login")) {
    event.preventDefault();
    handleAdminLogin(event.target);
  } else if (event.target.matches("#admin-product-filters")) {
    event.preventDefault();
    const values = new FormData(event.target);
    adminState.productFilters = {
      search: String(values.get("search") ?? "").trim(),
      category: String(values.get("category") ?? ""),
      active: String(values.get("active") ?? ""),
      pricing: String(values.get("pricing") ?? ""),
      sort: values.get("sort") === "name" ? "name" : "newest",
    };
    render();
  } else if (event.target.matches("#admin-product-form")) {
    event.preventDefault();
    void saveAdminProduct(event.target);
  } else if (event.target.matches(".admin-order-status-form")) {
    event.preventDefault();
    void updateAdminOrderStatus(event.target);
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("#product-main-image-input")) {
    addProductImageFiles(event.target, true);
  } else if (event.target.matches("#product-gallery-image-input")) {
    addProductImageFiles(event.target, false);
  } else if (event.target.matches("#product-replace-image-input")) {
    replaceProductImageFile(event.target);
  } else if (event.target.matches("#image-cropper-zoom")) {
    updateCropperZoom(event.target.value);
  } else if (event.target.matches('#admin-product-form [name="pricing_type"]')) {
    const form = event.target.closest("#admin-product-form");
    const fixed = event.target.value === "fixed";
    const fixedField = form.querySelector(".product-fixed-price");
    const negotiatedField = form.querySelector(".product-negotiated-price");
    fixedField.hidden = !fixed;
    fixedField.querySelector("input").required = fixed;
    negotiatedField.hidden = fixed;
    negotiatedField.querySelector("input").required = !fixed;
  }
});

document.addEventListener("dragstart", (event) => {
  const card = event.target.closest(".product-image-preview-card");
  if (!card || !event.dataTransfer) return;
  event.dataTransfer.setData("text/plain", card.dataset.imageId);
  event.dataTransfer.effectAllowed = "move";
  card.classList.add("is-dragging");
});

document.addEventListener("dragend", (event) => {
  event.target.closest(".product-image-preview-card")?.classList.remove("is-dragging");
});

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("#image-cropper-stage")) return;
  const cropper = adminState.productEditor?.cropper;
  if (!cropper?.ready) return;
  event.preventDefault();
  cropper.pointer = {
    x: event.clientX,
    y: event.clientY,
    offsetX: cropper.offsetX,
    offsetY: cropper.offsetY,
  };
  event.target.setPointerCapture?.(event.pointerId);
});

document.addEventListener("pointermove", moveProductImageCrop);

document.addEventListener("pointerup", () => {
  if (adminState.productEditor?.cropper) adminState.productEditor.cropper.pointer = null;
});

document.addEventListener("dragover", (event) => {
  if (event.target.closest(".product-image-preview-card")) event.preventDefault();
});

window.addEventListener("resize", () => {
  if (adminState.productEditor?.cropper?.ready) drawCropPreview(adminState.productEditor);
});

document.addEventListener("drop", (event) => {
  const card = event.target.closest(".product-image-preview-card");
  if (!card || !event.dataTransfer) return;
  event.preventDefault();
  reorderProductImages(event.dataTransfer.getData("text/plain"), card.dataset.imageId);
});

async function toggleAdminProduct(productId) {
  const product = adminState.products.find((item) => item.id === productId);
  if (!product || !adminState.authorized || !supabase) return;
  const nextActive = !product.isActive;
  const action = nextActive ? "نشر" : "إخفاء";
  if (!window.confirm(`هل تريد ${action} المنتج «${product.name}»؟`)) return;
  try {
    await assertAdminMembership();
    const { error } = await supabase.from("products").update({ is_active: nextActive }).eq("id", product.id);
    if (error) throw error;
    toast(nextActive ? "تم نشر المنتج." : "تم إخفاء المنتج.");
    await loadAdminData();
    if (pathForCurrentPage() === "/admin") render();
  } catch (error) {
    if (adminState.authorized) toast(error instanceof Error && error.message.includes("جلسة")
      ? error.message
      : "تعذر تغيير حالة المنتج. تحقق من صلاحيات RLS.");
  }
}

async function deleteAdminProduct(productId) {
  const product = adminState.products.find((item) => item.id === productId);
  if (!product || !adminState.authorized || !supabase || adminState.deletingProductId) return;
  if (!window.confirm(`هل تريد إزالة المنتج «${product.name}» نهائيًا؟ لن تُحذف صوره من Storage. إذا كان مرتبطًا بطلب، ستُمنع الإزالة ويمكنك إخفاؤه بدلًا من ذلك.`)) return;
  adminState.deletingProductId = productId;
  render();
  try {
    await assertAdminMembership();
    const references = await supabase
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId);
    if (references.error || typeof references.count !== "number") {
      throw new Error("تعذر التحقق من ارتباطات الطلبات.");
    }
    if (references.count > 0) {
      toast("لا يمكن إزالة هذا المنتج لارتباطه بطلبات سابقة. يمكنك إخفاؤه بدلًا من ذلك.");
      return;
    }
    const result = await supabase
      .from("products")
      .delete()
      .eq("id", productId)
      .select("id")
      .maybeSingle();
    if (result.error) throw new Error("رفضت قاعدة البيانات إزالة المنتج. تحقق من صلاحية RLS وقيد العلاقات.");
    if (!result.data?.id) throw new Error("لم تتم إزالة المنتج؛ لم يُرجع Supabase صفًا محذوفًا.");
    toast("تمت إزالة المنتج. لم تُحذف أي صور من Storage.");
    await loadAdminData();
  } catch (error) {
    if (adminState.authorized) {
      toast(error instanceof Error && error.message.includes("جلسة")
        ? error.message
        : error instanceof Error && error.message.includes("ارتباطات")
          ? error.message
          : error instanceof Error && error.message.includes("صفًا محذوفًا")
            ? error.message
            : "تعذرت إزالة المنتج. تحقق من طلباته المرتبطة وصلاحيات RLS؛ لم تُحذف الصور.");
    }
  } finally {
    adminState.deletingProductId = null;
    if (adminState.authorized && pathForCurrentPage() === "/admin") render();
  }
}

function moveGallery(delta) {
  const product = products.find((item) => item.id === galleryState.productId);
  if (!product || product.images.length < 2) return;
  galleryState.index = (galleryState.index + delta + product.images.length) % product.images.length;
  render();
}

document.addEventListener("pointerdown", (event) => {
  const gallery = event.target.closest("[data-gallery-image]");
  if (!gallery || event.target.closest("button")) return;
  galleryState.pointerStart = { x: event.clientX, y: event.clientY };
});

document.addEventListener("pointerup", (event) => {
  if (!galleryState.pointerStart) return;
  const start = galleryState.pointerStart;
  galleryState.pointerStart = null;
  const horizontal = event.clientX - start.x;
  const vertical = event.clientY - start.y;
  if (Math.abs(horizontal) < 48 || Math.abs(horizontal) < Math.abs(vertical) * 1.3) return;
  galleryState.suppressClickUntil = Date.now() + 400;
  moveGallery(horizontal < 0 ? 1 : -1);
});

document.addEventListener("keydown", (event) => {
  if (!galleryState.lightbox) return;
  if (event.key === "Escape") {
    galleryState.lightbox = false;
    render();
  } else if (event.key === "ArrowRight") {
    moveGallery(-1);
  } else if (event.key === "ArrowLeft") {
    moveGallery(1);
  }
});

document.addEventListener("click", (event) => {
  if (event.target.closest(".menu-toggle")) document.querySelector(".main-nav")?.classList.toggle("is-open");
});

supabase?.auth.onAuthStateChange((event) => {
  if (event !== "SIGNED_OUT") return;
  const wasAuthorized = adminState.authorized;
  clearAdminState();
  if (wasAuthorized && pathForCurrentPage() === "/admin") render();
});

window.addEventListener("popstate", render);
window.addEventListener("hashchange", () => {
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ behavior: "smooth" });
});
render();

async function loadProducts() {
  if (!supabase) {
    productLoadStatus = "not-configured";
    render();
    return;
  }

  try {
    const { data, error } = await supabase
      .from("products")
      .select("id,name,category,description,price,image_url,image_urls,badge,pricing_type,price_text")
      .eq("is_active", true);
    if (error) throw error;
    products = data.map(normalizeProduct);
    productLoadStatus = "ready";
  } catch (error) {
    console.error("Unable to load active Supabase products", {
      code: error?.code,
      message: error?.message,
    });
    productLoadError = error?.code === "42501" || error?.status === 401 || error?.status === 403
      ? "رفض Supabase قراءة المنتجات. توقف التحميل؛ راجع صلاحية SELECT وسياسة RLS للمفتاح العام."
      : "تعذرت قراءة المنتجات من Supabase. تحقق من أسماء الحقول والاتصال وصلاحية SELECT وسياسة RLS.";
    productLoadStatus = "error";
  }
  render();
}

loadProducts();
