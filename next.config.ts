import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The dev indicator sits over the mobile bottom tab bar.
  devIndicators: false,
};

export default withNextIntl(nextConfig);
