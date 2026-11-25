import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: "light" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  async function inspect(name) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + " overflows horizontally");
    if (process.env.PREVIEW_DIR) await page.screenshot({ path: path.join(process.env.PREVIEW_DIR, name + ".png") });
  }
  await page.goto(process.env.BASE);
  await page.getByLabel("Setup token").fill(process.env.SETUP_TOKEN);
  await page.getByRole("button", { name: "Unlock setup" }).click();
  await page.getByRole("heading", { name: "Workspace overview" }).waitFor();
  await inspect("dashboard");
  for (const [url, type] of [["/favicon.ico", "image/x-icon"], ["/apple-touch-icon.png", "image/png"]]) {
    const icon = await page.request.get(process.env.BASE + url);
    assert.equal(icon.status(), 200);
    assert.equal(icon.headers()["content-type"], type);
  }
  await page.getByRole("link", { name: "Agent access" }).click();
  await page.getByRole("button", { name: /^Cloudflare Access/ }).click();
  await page.getByRole("button", { name: "Copy URL" }).waitFor();
  await inspect("agent-access");
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("link", { name: "Run a report" }).click();
  await page.getByRole("radio", { name: /Top Google searches/ }).check();
  await page.getByLabel("Verified site property").fill("sc-domain:example.com");
  await page.getByRole("button", { name: "Run report", exact: true }).click();
  await page.getByRole("cell", { name: "last search query" }).waitFor();
  await inspect("site-report");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("combobox", { name: "Choose a report" }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await inspect("mobile-report");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("link", { name: "Connections", exact: true }).click();
  await page.getByRole("heading", { name: "Connections", exact: true }).waitFor();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: /Setup session/ }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await inspect("mobile-account");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await inspect("mobile-connections");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("link", { name: "Agent access" }).click();
  await page.getByRole("button", { name: /^Agent tokens/ }).click();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.getByLabel("Token name").fill("mobile check");
  await page.getByRole("button", { name: "Create token", exact: true }).click();
  await page.getByRole("button", { name: "Revoke mobile check" }).waitFor();
  await page.getByRole("button", { name: "Revoke mobile check" }).click();
  await page.getByRole("button", { name: "Revoke mobile check" }).waitFor({ state: "detached" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await inspect("mobile-agent");
  assert.deepEqual(errors, []);
  console.log("PASS desktop and mobile Chrome navigation, Search Console report, and dark theme");
} finally {
  await browser.close();
}
