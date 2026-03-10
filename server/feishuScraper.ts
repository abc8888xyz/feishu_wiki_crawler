/**
 * Feishu Wiki Scraper using Puppeteer
 * For public wikis that don't require API credentials.
 * Uses headless Chromium to render the page and intercept API calls.
 */

import puppeteer, { type Browser } from "puppeteer-core";
import type { FeishuNode } from "./feishuApi";
import { buildNodeUrl } from "./feishuApi";

const CHROMIUM_PATH = "/usr/bin/chromium-browser";

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }
  browserInstance = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
    ],
  });
  return browserInstance;
}

interface ScrapedNode {
  token: string;
  title: string;
  url: string;
  parentToken: string;
  depth: number;
  obj_type: string;
}

/**
 * Scrape wiki nodes from a public Feishu wiki page using Puppeteer.
 * Intercepts the Feishu internal API calls to get node data.
 */
export async function scrapePublicWiki(
  wikiUrl: string,
  domain: string,
  rootToken: string
): Promise<FeishuNode[]> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  const capturedNodes: FeishuNode[] = [];
  const capturedTokens = new Set<string>();
  let spaceId = "";

  try {
    // Set a realistic user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Intercept network responses to capture wiki API data
    page.on("response", async (response) => {
      const url = response.url();
      // Capture Feishu internal wiki API calls
      if (
        (url.includes("/wiki/v2/spaces/") || url.includes("/space/api/wiki")) &&
        url.includes("nodes")
      ) {
        try {
          const json = await response.json();
          if (json?.data?.items) {
            for (const item of json.data.items) {
              if (!capturedTokens.has(item.node_token)) {
                capturedTokens.add(item.node_token);
                if (item.space_id) spaceId = item.space_id;
                capturedNodes.push({
                  ...item,
                  url: buildNodeUrl(domain, item),
                  depth: 0,
                });
              }
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
    });

    // Navigate to the wiki page
    await page.goto(wikiUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait for the wiki tree to load
    await new Promise(r => setTimeout(r, 3000));

    // Try to extract data from the page's JavaScript state
    const pageData = await page.evaluate(() => {
      // Try to find wiki data in window.__INITIAL_STATE__ or similar
      const win = window as unknown as Record<string, unknown>;
      const initialState = win.__INITIAL_STATE__ || win.__REDUX_STATE__ || win.initialState;
      if (initialState) {
        return JSON.stringify(initialState);
      }

      // Try to find links in the sidebar/tree
      const links: Array<{ href: string; text: string }> = [];
      const anchors = document.querySelectorAll('a[href*="/wiki/"]');
      anchors.forEach((a) => {
        const href = (a as HTMLAnchorElement).href;
        const text = (a as HTMLAnchorElement).textContent?.trim() ?? "";
        if (href && text) {
          links.push({ href, text });
        }
      });
      return JSON.stringify({ links });
    });

    // Parse extracted page data
    try {
      const data = JSON.parse(pageData);
      if (data.links) {
        const seenUrls = new Set<string>();
        for (const link of data.links) {
          const tokenMatch = link.href.match(/\/wiki\/([A-Za-z0-9_-]+)/);
          if (!tokenMatch) continue;
          const token = tokenMatch[1];
          if (seenUrls.has(token) || token === rootToken) continue;
          seenUrls.add(token);

          if (!capturedTokens.has(token)) {
            capturedTokens.add(token);
            capturedNodes.push({
              space_id: spaceId || rootToken,
              node_token: token,
              obj_token: token,
              obj_type: "wiki",
              parent_node_token: rootToken,
              node_type: "origin",
              origin_node_token: token,
              origin_space_id: spaceId || rootToken,
              has_child: false,
              title: link.text || token,
              obj_create_time: "",
              obj_edit_time: "",
              node_create_time: "",
              creator: "",
              owner: "",
              url: link.href,
              depth: 1,
            });
          }
        }
      }
    } catch {
      // Ignore parse errors
    }

    // Click on sidebar items to trigger more API calls
    try {
      const sidebarItems = await page.$$('[class*="sidebar"] a, [class*="tree"] a, [class*="nav"] a[href*="/wiki/"]');
      for (const item of sidebarItems.slice(0, 20)) {
        try {
          await item.click();
          await new Promise(r => setTimeout(r, 500));
        } catch {
          // Ignore click errors
        }
      }
    } catch {
      // Ignore sidebar interaction errors
    }

    // Wait for any additional API calls to complete
    await new Promise(r => setTimeout(r, 2000));

  } finally {
    await page.close();
  }

  // Assign depths based on parent relationships
  const nodeMap = new Map(capturedNodes.map(n => [n.node_token, n]));
  for (const node of capturedNodes) {
    let depth = 0;
    let current = node;
    while (current.parent_node_token && nodeMap.has(current.parent_node_token)) {
      depth++;
      current = nodeMap.get(current.parent_node_token)!;
      if (depth > 20) break; // Prevent infinite loops
    }
    node.depth = depth;
  }

  return capturedNodes;
}
