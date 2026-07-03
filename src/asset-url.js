// Build a site-root-absolute URL for a file served from public/.
export const asset = (p) => import.meta.env.BASE_URL + String(p).replace(/^\/+/, "");
