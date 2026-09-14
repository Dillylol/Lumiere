/** Single source of product naming. Keep this object JSON-compatible for scripts/brand.mjs. */
export const BRAND = {
  "name": "Lumière",
  "tagline": "FTC programming studio",
  "description": "An offline-first studio for building, simulating, and deploying FTC robot programs.",
  "slug": "lumiere",
  "identifier": "dev.lumiere.desktop",
  "themeColor": "#38a1f2",
  "backgroundColor": "#0c141b",
  "projectExtension": "lum",
  "storageNamespace": "studio",
  "repository": {
    "owner": "Dillylol",
    "name": "Lumiere"
  },
  "java": {
    "package": "dev.lumiere.ftc",
    "simPackage": "dev.lumiere.sim",
    "classPrefix": "Lumiere",
    "generatedPackageSuffix": "lumiere.generated"
  }
} as const;

/** Persisted identifiers never change during a product rename. */
export const STORAGE = {
  namespace: BRAND.storageNamespace,
  key: (name: string) => `${BRAND.storageNamespace}.${name}`,
} as const;

export function repositoryUrl(repository: { owner: string; name: string } | null = BRAND.repository): string | undefined {
  return repository ? `https://github.com/${repository.owner}/${repository.name}` : undefined;
}
