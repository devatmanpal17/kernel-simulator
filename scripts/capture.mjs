import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { port: 4173, strictPort: false, host: "127.0.0.1" } });
await server.listen();
const address = server.httpServer.address();
if (!address || typeof address === "string") throw new Error("Vite did not start.");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${address.port}/`);
await page.screenshot({ path: "docs/screenshots/home.png", fullPage: true });
await page.getByRole("button", { name: "Live kernel", exact: true }).click();
await page.getByRole("button", { name: "Step one tick" }).click();
await page.screenshot({ path: "docs/screenshots/dashboard.png", fullPage: true });
await page.getByRole("button", { name: "Resources", exact: true }).click();
await page.screenshot({ path: "docs/screenshots/resources.png", fullPage: true });
await browser.close();
await server.close();
