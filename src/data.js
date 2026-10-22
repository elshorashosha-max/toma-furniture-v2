export function normalizeProduct(row) {
  const imageUrls = Array.isArray(row.image_urls)
    ? row.image_urls
    : typeof row.image_urls === "string"
      ? parseImageUrls(row.image_urls)
      : [];
  const images = [
    ...(typeof row.image_url === "string" && row.image_url.trim() ? [row.image_url] : []),
    ...imageUrls.filter((url) => typeof url === "string" && url.trim()),
  ].filter((url, index, all) => all.indexOf(url) === index);

  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    category: String(row.category ?? ""),
    description: String(row.description ?? ""),
    price: row.price === null || row.price === undefined || row.price === "" ? null : Number(row.price),
    imageUrl: typeof row.image_url === "string" ? row.image_url : "",
    images,
    badge: typeof row.badge === "string" ? row.badge : "",
    pricingType: typeof row.pricing_type === "string" ? row.pricing_type : "",
    priceText: typeof row.price_text === "string" ? row.price_text : "",
    isActive: row.is_active === true,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

function parseImageUrls(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getCategories(products) {
  const seen = new Set();
  return products
    .filter((product) => product.category && !seen.has(product.category) && seen.add(product.category))
    .map((product, index) => ({
      id: product.category,
      name: product.category,
      detail: "اكتشف قطع المجموعة",
      imageUrl: product.images[0] ?? "",
      index: index + 1,
    }));
}

export function formatPrice(price) {
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(price) + " ج.م";
}

export function getProductPrice(product) {
  if (product.pricingType === "negotiated") return product.priceText || "السعر حسب الاتفاق";
  if (product.pricingType === "fixed" && product.price !== null && Number.isFinite(product.price)) {
    return formatPrice(product.price);
  }
  if (product.priceText) return product.priceText;
  if (product.price !== null && Number.isFinite(product.price)) return formatPrice(product.price);
  return product.pricingType || "السعر غير متاح";
}

export function getCategoryName(category) {
  return category || "أثاث";
}
