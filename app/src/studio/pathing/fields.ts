/**
 * Field backgrounds, as the Pedro Pathing Visualizer offers them (images from the Visualizer's
 * source, Apache-2.0). BIOBUZZ has light and dark versions; the others work in both themes.
 */
export const FIELD_OPTIONS = [
  { id: "biobuzz", label: "BIOBUZZ (2026–2027)", light: "biobuzz-light.webp", dark: "biobuzz-dark.webp" },
  { id: "decode", label: "DECODE (2025–2026)", light: "decode.webp", dark: "decode.webp" },
  { id: "intothedeep", label: "INTO THE DEEP (2024–2025)", light: "intothedeep.webp", dark: "intothedeep.webp" },
  { id: "centerstage", label: "CENTERSTAGE (2023–2024)", light: "centerstage.webp", dark: "centerstage.webp" },
  { id: "plain", label: "Plain tiles", light: "", dark: "" },
  { id: "custom", label: "Your own image", light: "", dark: "" },
] as const;

export type FieldId = typeof FIELD_OPTIONS[number]["id"];
export const DEFAULT_FIELD: FieldId = "biobuzz";

export const isFieldId = (value: string | null): value is FieldId => FIELD_OPTIONS.some((option) => option.id === value);

/** The picture to draw under the paths for a field and the app's theme, or null for plain tiles. */
export function fieldImageSource(id: FieldId, custom: string | null): string | null {
  if (id === "custom") return custom;
  const option = FIELD_OPTIONS.find((item) => item.id === id) ?? FIELD_OPTIONS[0];
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const file = option[theme];
  return file ? `${import.meta.env.BASE_URL}pathing/fields/${file}` : null;
}
