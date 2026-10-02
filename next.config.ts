import type { NextConfig } from "next";

const csp =
  "default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://github.com https://avatars.githubusercontent.com; font-src 'self'; connect-src 'self'";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    // Next's development overlay/HMR needs sources intentionally disallowed by the production CSP.
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ...(process.env.NODE_ENV === "development" ? [] : [{ key: "Content-Security-Policy", value: csp }]),
    ];
    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
