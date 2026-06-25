/**
 * App version helper.
 *
 * IMPORTANT: keep this file outside any Expo Router `app/` directory.
 * Files inside `app/` or `src/app/` may be treated as routes and must export
 * React components. This helper is deliberately in `src/config/`.
 */
type PackageJson = { version?: string; name?: string };

function loadPackageJson(): PackageJson | null {
  try {
    // From src/config/appVersion.ts to project-root package.json.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../../package.json') as PackageJson;
  } catch {
    return null;
  }
}

const pkg = loadPackageJson();

export const AGA_APP_VERSION =
  pkg?.version ||
  process.env.EXPO_PUBLIC_AGA_APP_VERSION ||
  process.env.npm_package_version ||
  'dev';

export const AGA_APP_NAME = pkg?.name || 'aga';
