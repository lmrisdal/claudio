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
      logo: { src: "./src/assets/icon.svg", replacesTitle: true },
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
          label: "Clients",
          items: [
            { label: "Installing on Windows", slug: "clients/windows" },
            { label: "Installing on Linux", slug: "clients/linux" },
            { label: "Web UI vs Desktop App", slug: "clients/web-ui" },
          ],
        },
        {
          label: "Configuration",
          items: [
            { label: "Environment Variables", slug: "configuration/environment-variables" },
            { label: "Configuration", slug: "configuration/config-file" },
            { label: "Database", slug: "configuration/database" },
          ],
        },
      ],
    }),
  ],
});
