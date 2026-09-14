/** Single source of product naming. Keep this object JSON-compatible for scripts/brand.mjs. */
export const BRAND = {
  "name": "Lumière",
  "tagline": "Light the spark. Streamline the build.",
  "description": "From first idea to field-ready robot, Lumière streamlines FTC programming, simulation, and deployment in one focused offline workspace.",
  "slug": "lumiere",
  "identifier": "dev.lumiere.desktop",
  "themeColor": "#17191b",
  "backgroundColor": "#17191b",
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
