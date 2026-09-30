import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { port: 4173, strictPort: false, host: "127.0.0.1" } });
await server.listen();
const address = server.httpServer.address();
if (!address || typeof address === "string") throw new Error("Vite did not start.");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const check = (condition, description) => { if (!condition) throw new Error(description); };
try {
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.getByRole("button", { name: "Live kernel", exact: true }).click();
  await page.getByRole("button", { name: "Step one tick" }).click();
  check((await page.locator(".control-clock strong").textContent()) === "00:01", "Step must advance one tick");
  await page.getByRole("button", { name: "Reset experiment" }).click();
  check((await page.locator(".control-clock strong").textContent()) === "00:00", "Reset must clear the clock");

  await page.getByRole("combobox", { name: "System call" }).selectOption("fork");
  await page.getByRole("button", { name: "Invoke fork()" }).click();
  await page.getByText("browser-child").first().waitFor();
  await page.getByRole("combobox", { name: "System call" }).selectOption("open");
  await page.getByRole("textbox", { name: "System call argument" }).fill("notes.txt");
  await page.getByRole("button", { name: "Invoke open()" }).click();
  for (let i = 0; i < 12; i++) {
    const processState = await page.locator(".process-item").filter({ hasText: "browser" }).first().textContent();
    if (processState.includes("READY") || processState.includes("RUNNING")) break;
    await page.getByRole("button", { name: "Step one tick" }).click();
  }
  await page.getByRole("combobox", { name: "System call" }).selectOption("write");
  await page.getByRole("textbox", { name: "System call argument" }).fill("notes.txt hello-world");
  await page.getByRole("button", { name: "Invoke write()" }).click();
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Step one tick" }).click();
  await page.getByText("hello-world", { exact: true }).waitFor();
  await page.getByRole("button", { name: /P1 browser READY|P1 browser NEW/ }).first().click();
  await page.getByText("notes.txt").last().waitFor();
  await page.getByRole("button", { name: "Raise priority" }).waitFor();
  await page.locator(".pcb-header button").click();

  await page.getByRole("textbox", { name: "Kernel command" }).fill("malloc 1 12");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByText("P1 reserved 12 KB of virtual memory", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Kernel command" }).fill("ps");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByText("browser-child", { exact: false }).last().waitFor();

  await page.getByRole("button", { name: "Step one tick" }).click();
  const savedTick = await page.locator(".control-clock strong").textContent();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTitle("Export report JSON").click();
  const download = await downloadPromise;
  const savedPath = await download.path();
  await page.getByRole("button", { name: "Step one tick" }).click();
  await page.locator('input[type="file"]').setInputFiles(savedPath);
  await page.waitForFunction((expected) => document.querySelector(".control-clock strong")?.textContent === expected, savedTick);
  await page.getByText("browser-child").first().waitFor();
  await page.getByText("hello-world", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Resources", exact: true }).click();
  await page.getByRole("textbox", { name: "Available resources" }).fill("1 0");
  await page.getByText("NO DEADLOCK").first().waitFor();
  await page.getByRole("button", { name: "Live kernel", exact: true }).click();
  await page.getByRole("button", { name: "Resources", exact: true }).click();
  check((await page.getByRole("textbox", { name: "Available resources" }).inputValue()) === "1 0", "Resource edits must persist across navigation");
  await page.getByRole("textbox", { name: "Banker available vector" }).fill("0 0 0");
  await page.locator(".result-box.danger").getByText("Unsafe state", { exact: false }).waitFor();
  await page.getByRole("textbox", { name: "Banker available vector" }).fill("3 3 2");
  await page.locator(".result-box").getByText("Safe state", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Synchronization", exact: true }).click();
  await page.getByRole("combobox", { name: "Reader writer preference" }).selectOption("writer");
  await page.getByRole("button", { name: "Request read" }).click();
  await page.getByRole("button", { name: "Request write" }).click();
  await page.getByRole("button", { name: "Request read" }).click();
  await page.getByText("W2").waitFor();
  await page.getByRole("button", { name: "Release reader" }).click();
  check((await page.locator(".rw-lanes").textContent()).includes("ACTIVE WRITERW2"), "Queued writer should acquire lock");
  await page.getByRole("button", { name: "Produce item" }).click();
  await page.getByText("Producer acquired mutex", { exact: false }).waitFor();

  check(errors.length === 0, `Browser errors: ${errors.join("; ")}`);
  console.log("Feature audit passed: clock/reset, process calls, terminal, save/load snapshot, resource and Banker edits, synchronization, no page errors.");
} finally {
  await browser.close();
  await server.close();
}
