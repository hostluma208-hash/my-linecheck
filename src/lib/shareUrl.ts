const PUBLIC_APP_ORIGIN = "https://my-linecheck.lovable.app";

/** Keep the existing report ID while including its saved restaurant name. */
export function restaurantHistoryUrl(url: string, restaurant: string): string {
  const parsed = new URL(url, PUBLIC_APP_ORIGIN);
  parsed.searchParams.set("restaurant", restaurant.trim() || "LUMA");
  return `${PUBLIC_APP_ORIGIN}${parsed.pathname}${parsed.search}`;
}