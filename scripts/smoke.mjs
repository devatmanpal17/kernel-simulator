import { chromium } from "playwright";
import { createServer } from "vite";
const server = await createServer({ server: { port: 4173, strictPort: false, host: "127.0.0.1" } });
await server.listen();
const address = server.httpServer.address();
if (!address || typeof address === "string") throw new Error("Could not start Vite for browser tests.");
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${address.port}/`);
await page.getByRole("button", { name: "Live kernel", exact: true }).click();
await page.getByRole("heading", { name: "Kernel dashboard" }).waitFor();
await page.getByRole("button", { name: "Step one tick" }).click();
await page.getByText("page 0 absent", { exact: false }).first().waitFor();
for (const [nav, heading] of [
  ["Scheduling", "Scheduling laboratory"],
  ["Memory", "Memory laboratory"],
  ["Resources", "Resource safety"],
  ["Synchronization", "Synchronization"],
  ["Analytics", "Kernel analytics"],
  ["Scenario lab", "Scenario laboratory"],
  ["Architecture", "Kernel architecture"],
  ["About", "About SmartOS Lab"],
  ["Overview", "See what happens"],
]) {
  await page.getByRole("button", { name: nav, exact: true }).first().click();
  await page.getByRole("heading", { name: new RegExp(heading) }).waitFor();
}
await page.getByRole("button", { name: "Live kernel", exact: true }).click();
await page.getByPlaceholder("Process name").fill("smoke-worker");
await page.getByRole("button", { name: "Create process" }).click();
await page.getByText("smoke-worker").first().waitFor();
await page.getByRole("button", { name: "Step one tick" }).click();
await page.getByRole("button", { name: "Reset experiment" }).click();
for (let i = 1; i <= 10; i++) {
  await page.getByRole("button", { name: "Scenario lab", exact: true }).click();
  await page
    .getByRole("button", {
      name: new RegExp(`SCENARIO ${String(i).padStart(2, "0")}`),
    })
    .click();
  await page.getByRole("heading").first().waitFor();
  if (i === 9)
    await page
      .getByText("Deadlock: every philosopher", { exact: false })
      .waitFor();
}
await page
  .getByRole("button", { name: "Synchronization", exact: true })
  .click();
await page.getByRole("button", { name: "Produce item" }).click();
await page.getByText("Producer acquired mutex").waitFor();
await page.getByRole("button", { name: "Memory", exact: true }).click();
await page.getByRole("button", { name: "Allocate", exact: true }).click();
await page.getByText("allocated at address").waitFor();
await page.getByRole("button", { name: "Apply & reset" }).click();
await page.getByRole("button", { name: "Live kernel", exact: true }).click();
await page.getByText("Kernel initialized").first().waitFor();
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("heading", { name: "Kernel dashboard" }).waitFor();
const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
if (mobileOverflow) throw new Error("Dashboard overflows the mobile viewport horizontally.");
if (errors.length) throw new Error(errors.join("\n"));
console.log(
  "Smoke check passed: dashboard clock, event log, all views, ten scenarios, process creation, reset, synchronization, allocation, no page errors.",
);
await browser.close();
await server.close();
