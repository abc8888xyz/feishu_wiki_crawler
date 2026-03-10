/**
 * NOTE: Feishu is a Single Page Application (SPA) that blocks headless browsers.
 * All API endpoints require authentication tokens.
 * This file is kept as a placeholder — public wiki scraping is not feasible.
 *
 * The recommended approach is to use the official Feishu API with credentials.
 */

export function getPublicWikiNotSupportedError(): string {
  return (
    "Feishu Wiki requires authentication to access its API, even for public wikis.\n\n" +
    "Please provide credentials using one of these methods:\n\n" +
    "Option 1 — App Credentials (recommended):\n" +
    "  1. Go to https://open.feishu.cn/app and create a new app\n" +
    "  2. Under 'Permissions & Scopes', enable: wiki:wiki:readonly\n" +
    "  3. Under 'Version Management', publish the app\n" +
    "  4. For public wikis: no additional setup needed\n" +
    "  5. Enter the App ID and App Secret in the form above\n\n" +
    "Option 2 — User Access Token:\n" +
    "  1. Go to https://open.feishu.cn/api-explorer\n" +
    "  2. Log in and copy your User Access Token\n" +
    "  3. Paste it in the 'User Access Token' field above"
  );
}
