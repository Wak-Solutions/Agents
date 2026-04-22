/**
 * WAK Dashboard — screenshot capture script
 *
 * Usage:
 *   ADMIN_PASSWORD=yourpassword node screenshot.js
 *
 * Requirements:
 *   npm install playwright
 *   npx playwright install chromium
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://wak-agents.up.railway.app";
const EMAIL = "ak@wak-solutions.com";
const PASSWORD = process.env.ADMIN_PASSWORD;

if (!PASSWORD) {
  console.error("Error: ADMIN_PASSWORD environment variable is not set.");
  process.exit(1);
}

const SCREENSHOTS_DIR = path.join(__dirname, "screenshots");
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR);

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"], input[name="email"], input[placeholder*="email" i]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  // Wait until redirected away from /login
  await page.waitForURL(url => !url.toString().includes("/login"), { timeout: 15000 });
}

async function shot(page, filename) {
  // Wait for network to settle before capturing
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, filename),
    fullPage: true,
  });
  console.log(`  ✓  ${filename}`);
}

async function run() {
  const browser = await chromium.launch({ headless: true });

  // ── Desktop screenshots (1280×800) ─────────────────────────────────────────
  console.log("\n── Desktop (1280×800) ──────────────────────────────────────");
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await desktop.newPage();

  // Login page — capture before submitting
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await shot(page, "01-login.png");

  // Log in
  await page.fill('input[type="email"], input[name="email"], input[placeholder*="email" i]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(url => !url.toString().includes("/login"), { timeout: 15000 });

  // Dashboard / root (chat view)
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  await shot(page, "02-dashboard.png");

  // Inbox
  await page.goto(`${BASE_URL}/inbox`, { waitUntil: "networkidle" });
  await shot(page, "03-inbox.png");

  // Chat thread — click first chat card in the inbox if present
  const firstChat = page.locator("a[href*='phone='], button").filter({ hasText: /open|claim/i }).first();
  const firstChatCount = await firstChat.count();
  if (firstChatCount > 0) {
    // Try clicking the first "Open" link to navigate to that chat
    const openLinks = page.locator(`a[href*='phone=']`);
    if (await openLinks.count() > 0) {
      const href = await openLinks.first().getAttribute("href");
      await page.goto(`${BASE_URL}${href}`, { waitUntil: "networkidle" });
    } else {
      // Fall back: go to dashboard and click the first sidebar item
      await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
      const sidebarItem = page.locator("[data-testid='conversation-item'], .cursor-pointer").first();
      if (await sidebarItem.count() > 0) await sidebarItem.click();
      await page.waitForLoadState("networkidle").catch(() => {});
    }
  } else {
    // No chats available — still screenshot the dashboard with empty state
    await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  }
  await shot(page, "04-chat-thread.png");

  // Meetings
  await page.goto(`${BASE_URL}/meetings`, { waitUntil: "networkidle" });
  await shot(page, "05-meetings.png");

  // Agents (admin only)
  await page.goto(`${BASE_URL}/agents`, { waitUntil: "networkidle" });
  await shot(page, "06-agents.png");

  // Statistics
  await page.goto(`${BASE_URL}/statistics`, { waitUntil: "networkidle" });
  await shot(page, "07-statistics.png");

  // Surveys
  await page.goto(`${BASE_URL}/surveys`, { waitUntil: "networkidle" });
  await shot(page, "08-surveys.png");

  // Chatbot Config
  await page.goto(`${BASE_URL}/chatbot-config`, { waitUntil: "networkidle" });
  await shot(page, "09-chatbot-config.png");

  await desktop.close();

  // ── Mobile screenshot (375×812) ────────────────────────────────────────────
  console.log("\n── Mobile (375×812) ────────────────────────────────────────");
  const mobile = await browser.newContext({
    viewport: { width: 375, height: 812 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  });
  const mPage = await mobile.newPage();

  await login(mPage);

  // Inbox on mobile
  await mPage.goto(`${BASE_URL}/inbox`, { waitUntil: "networkidle" });
  await shot(mPage, "10-mobile-inbox.png");

  // Open the hamburger menu (on the dashboard page which has the hamburger)
  await mPage.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  const hamburger = mPage.locator('button[aria-label="Open menu"]');
  if (await hamburger.count() > 0) {
    await hamburger.click();
    // Wait for the drawer animation to finish
    await mPage.waitForTimeout(400);
    await shot(mPage, "11-mobile-hamburger-menu.png");
  } else {
    console.log("  ⚠  Hamburger button not found — skipping mobile menu screenshot");
  }

  await mobile.close();
  await browser.close();

  console.log(`\nAll screenshots saved to: ${SCREENSHOTS_DIR}\n`);
}

run().catch(err => {
  console.error("\nScript failed:", err.message);
  process.exit(1);
});
