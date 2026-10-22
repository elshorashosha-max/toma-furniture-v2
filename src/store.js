const CART_KEY = "toma-v2-cart";
const WISHLIST_KEY = "toma-v2-wishlist";

function read(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch (error) {
    console.error(`Unable to read ${key} from local storage`, error);
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Unable to save ${key} to local storage`, error);
    throw new Error("تعذر حفظ التغيير على هذا الجهاز.");
  }
}

export function getCart() {
  const cart = read(CART_KEY, []);
  return Array.isArray(cart) ? cart.filter((item) =>
    item && typeof item.id === "string" && Number.isInteger(item.quantity) && item.quantity > 0,
  ) : [];
}

export function setCart(cart) {
  write(CART_KEY, cart);
}

export function getWishlist() {
  const wishlist = read(WISHLIST_KEY, []);
  return Array.isArray(wishlist) ? wishlist.filter((id) => typeof id === "string") : [];
}

export function toggleWishlist(id) {
  const wishlist = getWishlist();
  const next = wishlist.includes(id) ? wishlist.filter((item) => item !== id) : [...wishlist, id];
  write(WISHLIST_KEY, next);
  return next;
}
