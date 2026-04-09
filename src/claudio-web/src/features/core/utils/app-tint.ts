import type { ResolvedTheme } from "../hooks/use-theme";
import type { AppTintPreference } from "./preferences";

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

const MINIMUM_INTERACTIVE_ACCENT_INTENSITY = 0.5;

const APP_TINT_VARIABLES = [
  "--bg",
  "--bg-blur",
  "--sidebar-blur",
  "--desktop-main-panel-bg",
  "--desktop-settings-panel-bg",
  "--desktop-settings-sidebar-bg",
  "--desktop-settings-sidebar-active-bg",
  "--desktop-settings-sidebar-hover-bg",
  "--hero-glass-bg",
  "--hero-glass-bg-hover",
  "--hero-glass-border",
  "--modal-backdrop",
  "--guide-backdrop",
  "--overlay-scrim",
  "--overlay-scrim-strong",
  "--glass-panel-bg",
  "--guide-panel-bg",
  "--surface",
  "--surface-raised",
  "--surface-overlay",
  "--border-color",
  "--accent",
  "--accent-hover",
  "--accent-dim",
  "--accent-foreground",
  "--focus-ring",
  "--sidebar-hover",
  "--sidebar-active-bg",
  "--settings-sidebar-bg",
  "--settings-sidebar-active-bg",
  "--settings-sidebar-hover-bg",
] as const;

const THEME_BASES: Record<
  ResolvedTheme,
  {
    bg: RgbColor;
    surface: RgbColor;
    surfaceRaised: RgbColor;
    surfaceOverlay: RgbColor;
    border: RgbColor;
    neutralAccent: RgbColor;
    accentForeground: string;
  }
> = {
  dark: {
    bg: { r: 15, g: 15, b: 17 },
    surface: { r: 24, g: 24, b: 27 },
    surfaceRaised: { r: 34, g: 34, b: 39 },
    surfaceOverlay: { r: 44, g: 44, b: 51 },
    border: { r: 58, g: 58, b: 66 },
    neutralAccent: { r: 142, g: 142, b: 148 },
    accentForeground: "#0a0a0f",
  },
  light: {
    bg: { r: 248, g: 248, b: 248 },
    surface: { r: 255, g: 255, b: 255 },
    surfaceRaised: { r: 237, g: 237, b: 240 },
    surfaceOverlay: { r: 227, g: 227, b: 232 },
    border: { r: 211, g: 211, b: 218 },
    neutralAccent: { r: 128, g: 128, b: 132 },
    accentForeground: "#ffffff",
  },
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function normalizeHue(value: number) {
  return ((Math.round(value) % 361) + 361) % 361;
}

function hslToRgb(hue: number, saturation: number, lightness: number): RgbColor {
  const s = clamp01(saturation);
  const l = clamp01(lightness);
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = normalizeHue(hue) / 60;
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
  const match = l - chroma / 2;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (segment >= 0 && segment < 1) {
    red = chroma;
    green = secondary;
  } else if (segment < 2) {
    red = secondary;
    green = chroma;
  } else if (segment < 3) {
    green = chroma;
    blue = secondary;
  } else if (segment < 4) {
    green = secondary;
    blue = chroma;
  } else if (segment < 5) {
    red = secondary;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondary;
  }

  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255),
  };
}

function mixColors(base: RgbColor, overlay: RgbColor, amount: number): RgbColor {
  const weight = clamp01(amount);

  return {
    r: Math.round(base.r + (overlay.r - base.r) * weight),
    g: Math.round(base.g + (overlay.g - base.g) * weight),
    b: Math.round(base.b + (overlay.b - base.b) * weight),
  };
}

function toHex(color: RgbColor) {
  return `#${color.r.toString(16).padStart(2, "0")}${color.g
    .toString(16)
    .padStart(2, "0")}${color.b.toString(16).padStart(2, "0")}`;
}

function withAlpha(color: RgbColor, alpha: number) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp01(alpha).toFixed(3)})`;
}

export function getTintPreviewColor(hue: number, intensity: number, theme: ResolvedTheme) {
  const base = THEME_BASES[theme];
  const color = hslToRgb(hue, theme === "dark" ? 0.74 : 0.66, theme === "dark" ? 0.56 : 0.48);
  return toHex(mixColors(base.neutralAccent, color, clamp01(intensity / 100)));
}

export function getAppTintVariables(
  theme: ResolvedTheme,
  tintPreference: AppTintPreference,
  reducedTransparency: boolean,
) {
  const base = THEME_BASES[theme];
  const intensity = clamp01(tintPreference.intensity / 100);
  const interactiveAccentIntensity = Math.max(intensity, MINIMUM_INTERACTIVE_ACCENT_INTENSITY);
  const hue = normalizeHue(tintPreference.hue);
  const tint = hslToRgb(hue, theme === "dark" ? 0.5 : 0.44, theme === "dark" ? 0.54 : 0.62);
  const glow = hslToRgb(hue, theme === "dark" ? 0.68 : 0.58, theme === "dark" ? 0.58 : 0.56);
  const accentTint = hslToRgb(hue, theme === "dark" ? 0.74 : 0.66, theme === "dark" ? 0.56 : 0.48);
  const accent = mixColors(base.neutralAccent, accentTint, interactiveAccentIntensity);
  const sidebarAccent = mixColors(base.neutralAccent, accentTint, intensity);
  const accentHover = mixColors(
    accent,
    theme === "dark" ? base.bg : { r: 0, g: 0, b: 0 },
    theme === "dark" ? 0.12 : 0.14,
  );

  const bg = mixColors(base.bg, tint, intensity * (theme === "dark" ? 0.08 : 0.05));
  const surface = mixColors(base.surface, tint, intensity * (theme === "dark" ? 0.18 : 0.12));
  const surfaceRaised = mixColors(
    base.surfaceRaised,
    tint,
    intensity * (theme === "dark" ? 0.22 : 0.14),
  );
  const surfaceOverlay = mixColors(
    base.surfaceOverlay,
    tint,
    intensity * (theme === "dark" ? 0.24 : 0.16),
  );
  const border = mixColors(base.border, tint, intensity * (theme === "dark" ? 0.16 : 0.1));
  const glass = mixColors(surfaceRaised, glow, intensity * (theme === "dark" ? 0.12 : 0.08));
  const panelBase = mixColors(bg, surface, 0.55);
  const sidebarBase = mixColors(surfaceRaised, tint, intensity * 0.08);

  if (reducedTransparency) {
    return {
      "--bg": toHex(bg),
      "--bg-blur": toHex(bg),
      "--sidebar-blur": theme === "dark" ? toHex(surface) : toHex(surfaceRaised),
      "--desktop-main-panel-bg": toHex(surface),
      "--desktop-settings-panel-bg": toHex(surface),
      "--desktop-settings-sidebar-bg": toHex(surfaceRaised),
      "--desktop-settings-sidebar-active-bg": toHex(surfaceOverlay),
      "--desktop-settings-sidebar-hover-bg": toHex(surfaceOverlay),
      "--hero-glass-bg": toHex(surfaceRaised),
      "--hero-glass-bg-hover": toHex(surfaceOverlay),
      "--hero-glass-border": toHex(border),
      "--modal-backdrop": toHex(bg),
      "--guide-backdrop": toHex(bg),
      "--overlay-scrim": toHex(surface),
      "--overlay-scrim-strong": toHex(surface),
      "--glass-panel-bg": toHex(surfaceRaised),
      "--guide-panel-bg": toHex(surface),
      "--surface": toHex(surface),
      "--surface-raised": toHex(surfaceRaised),
      "--surface-overlay": toHex(surfaceOverlay),
      "--border-color": toHex(border),
      "--accent": toHex(accent),
      "--accent-hover": toHex(accentHover),
      "--accent-dim": withAlpha(accent, 0.14 + intensity * 0.08),
      "--accent-foreground": base.accentForeground,
      "--focus-ring": toHex(accent),
      "--sidebar-hover": withAlpha(
        sidebarAccent,
        theme === "dark" ? 0.08 + intensity * 0.08 : 0.04 + intensity * 0.06,
      ),
      "--sidebar-active-bg": withAlpha(
        sidebarAccent,
        theme === "dark" ? 0.14 + intensity * 0.08 : 0.14 + intensity * 0.08,
      ),
      "--settings-sidebar-bg": toHex(surfaceRaised),
      "--settings-sidebar-active-bg": toHex(surface),
      "--settings-sidebar-hover-bg": toHex(surface),
    } satisfies Record<(typeof APP_TINT_VARIABLES)[number], string>;
  }

  return {
    "--bg": toHex(bg),
    "--bg-blur": withAlpha(
      bg,
      theme === "dark" ? 0.94 - intensity * 0.08 : 0.92 - intensity * 0.08,
    ),
    "--sidebar-blur":
      theme === "dark"
        ? withAlpha(panelBase, 0.9 - intensity * 0.04)
        : withAlpha(sidebarBase, 0.84 - intensity * 0.12),
    "--desktop-main-panel-bg": withAlpha(
      panelBase,
      theme === "dark" ? 0.9 - intensity * 0.04 : 0.84 - intensity * 0.06,
    ),
    "--desktop-settings-panel-bg": withAlpha(
      surface,
      theme === "dark" ? 0.9 - intensity * 0.08 : 0.92 - intensity * 0.1,
    ),
    "--desktop-settings-sidebar-bg": withAlpha(
      surfaceRaised,
      theme === "dark" ? 0.9 - intensity * 0.1 : 0.84 - intensity * 0.12,
    ),
    "--desktop-settings-sidebar-active-bg": withAlpha(
      surfaceOverlay,
      theme === "dark" ? 0.78 - intensity * 0.06 : 0.76 - intensity * 0.08,
    ),
    "--desktop-settings-sidebar-hover-bg": withAlpha(
      surfaceOverlay,
      theme === "dark" ? 0.72 - intensity * 0.08 : 0.72 - intensity * 0.1,
    ),
    "--hero-glass-bg": withAlpha(
      surfaceRaised,
      theme === "dark" ? 0.24 + intensity * 0.12 : 0.42 + intensity * 0.08,
    ),
    "--hero-glass-bg-hover": withAlpha(
      surfaceOverlay,
      theme === "dark" ? 0.34 + intensity * 0.12 : 0.52 + intensity * 0.08,
    ),
    "--hero-glass-border": withAlpha(
      accent,
      theme === "dark" ? 0.08 + intensity * 0.08 : 0.12 + intensity * 0.08,
    ),
    "--modal-backdrop": withAlpha(
      bg,
      theme === "dark" ? 0.62 + intensity * 0.08 : 0.44 + intensity * 0.06,
    ),
    "--guide-backdrop": withAlpha(
      bg,
      theme === "dark" ? 0.78 + intensity * 0.06 : 0.54 + intensity * 0.06,
    ),
    "--overlay-scrim": withAlpha(
      bg,
      theme === "dark" ? 0.56 + intensity * 0.08 : 0.38 + intensity * 0.06,
    ),
    "--overlay-scrim-strong": withAlpha(
      bg,
      theme === "dark" ? 0.68 + intensity * 0.08 : 0.46 + intensity * 0.06,
    ),
    "--glass-panel-bg": withAlpha(glass, theme === "dark" ? 0.94 : 0.92),
    "--guide-panel-bg": withAlpha(
      surface,
      theme === "dark" ? 0.08 + intensity * 0.08 : 0.62 + intensity * 0.08,
    ),
    "--surface": toHex(surface),
    "--surface-raised": toHex(surfaceRaised),
    "--surface-overlay": toHex(surfaceOverlay),
    "--border-color": toHex(border),
    "--accent": toHex(accent),
    "--accent-hover": toHex(accentHover),
    "--accent-dim": withAlpha(accent, 0.14 + intensity * 0.08),
    "--accent-foreground": base.accentForeground,
    "--focus-ring": toHex(accent),
    "--sidebar-hover": withAlpha(
      sidebarAccent,
      theme === "dark" ? 0.08 + intensity * 0.08 : 0.04 + intensity * 0.06,
    ),
    "--sidebar-active-bg": withAlpha(
      sidebarAccent,
      theme === "dark" ? 0.14 + intensity * 0.08 : 0.14 + intensity * 0.08,
    ),
    "--settings-sidebar-bg": toHex(surfaceRaised),
    "--settings-sidebar-active-bg": toHex(surface),
    "--settings-sidebar-hover-bg": toHex(surface),
  } satisfies Record<(typeof APP_TINT_VARIABLES)[number], string>;
}

export function applyAppTintVariables(
  root: HTMLElement,
  theme: ResolvedTheme,
  tintPreference: AppTintPreference,
  reducedTransparency: boolean,
) {
  const variables = getAppTintVariables(theme, tintPreference, reducedTransparency);

  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
}

export function clearAppTintVariables(root: HTMLElement) {
  for (const name of APP_TINT_VARIABLES) {
    root.style.removeProperty(name);
  }
}
