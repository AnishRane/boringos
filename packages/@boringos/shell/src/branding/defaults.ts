// SPDX-License-Identifier: BUSL-1.1
//
// Default BoringOS brand. Used when a tenant has not customized any
// brand.* setting in tenant_settings.

import type { Brand } from "./types.js";

export const BORINGOS_BRAND: Brand = {
  productName: "BoringOS",
  productTagline: "",
  logoUrl: "",
  faviconUrl: "",
  // "Sun" — amber-700, the warm accent in the awake palette (Sun / Ink /
  // Paper / Moss / Signal / Spark, see index.css). Reserved for "agent
  // working / attention here"; the canvas itself is paper+ink so the
  // accent stays vivid-on-purpose. Tenants override via brand.primaryColor
  // in tenant_settings; BrandProvider's CSS-var bridge derives lighter
  // accents and tint via color-mix so any brand color works.
  primaryColor: "#B45309",
  secondaryColor: "#0B1220", // "Ink" — deep blue-black, anchors the dark band
  loginBackground: "",
  emailFromName: "BoringOS",
};

/**
 * Map a partial brand from tenant_settings (with brand.* keys) to a
 * fully-resolved Brand by filling in any missing field with the
 * BoringOS default.
 */
export function resolveBrand(partial: Partial<Brand>): Brand {
  return {
    productName: partial.productName?.trim() || BORINGOS_BRAND.productName,
    productTagline: partial.productTagline?.trim() ?? BORINGOS_BRAND.productTagline,
    logoUrl: partial.logoUrl?.trim() ?? BORINGOS_BRAND.logoUrl,
    faviconUrl: partial.faviconUrl?.trim() ?? BORINGOS_BRAND.faviconUrl,
    primaryColor: partial.primaryColor?.trim() || BORINGOS_BRAND.primaryColor,
    secondaryColor: partial.secondaryColor?.trim() || BORINGOS_BRAND.secondaryColor,
    loginBackground: partial.loginBackground?.trim() ?? BORINGOS_BRAND.loginBackground,
    emailFromName: partial.emailFromName?.trim() || BORINGOS_BRAND.emailFromName,
  };
}
