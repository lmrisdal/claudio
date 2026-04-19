// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  site: "https://lmrisdal.github.io",
  base: "/claudio",
  integrations: [
    starlight({
      title: "Claudio",
      customCss: ["./src/custom.css"],
      components: {
        Header: "./src/components/Header.astro",
      },
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/lmrisdal/claudio" }],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "getting-started/introduction" },
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Library Structure", slug: "getting-started/library-structure" },
          ],
        },
        {
          label: "Configuration",
          items: [
            { label: "Environment Variables", slug: "configuration/environment-variables" },
            { label: "Config File", slug: "configuration/config-file" },
            { label: "Database", slug: "configuration/database" },
          ],
        },
        {
          label: "Authentication",
          items: [
            { label: "Overview", slug: "authentication/overview" },
            { label: "OAuth Providers", slug: "authentication/oauth-providers" },
            { label: "Custom OIDC Provider", slug: "authentication/custom-oidc" },
            { label: "Proxy Authentication", slug: "authentication/proxy-auth" },
          ],
        },
        {
          label: "Development",
          items: [
            { label: "Setup", slug: "development/setup" },
            { label: "Architecture", slug: "development/architecture" },
          ],
        },
      ],
    }),
  ],
});
