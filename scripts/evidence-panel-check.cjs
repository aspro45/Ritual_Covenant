const fs = require("fs");
const path = require("path");

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5178/";
const outputsDir = path.resolve(process.cwd(), "..", "..", "outputs");

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    const binDir = (process.env.PATH || "")
      .split(path.delimiter)
      .find((part) => part.includes("_npx") && part.toLowerCase().endsWith(`${path.sep}node_modules${path.sep}.bin`));

    if (!binDir) {
      throw new Error("Playwright is not installed locally and npm exec did not expose an _npx package path.");
    }

    return require(path.join(path.dirname(binDir), "playwright"));
  }
}

async function inspectPanel(page) {
  return page.locator(".enforcement-panel").evaluate((panel) => {
    const panelRect = panel.getBoundingClientRect();
    const cards = Array.from(panel.querySelectorAll(".evidence-grid > div")).map((card) => {
      const rect = card.getBoundingClientRect();
      const strong = card.querySelector("strong");

      return {
        label: card.querySelector("span")?.textContent?.trim() || "",
        value: strong?.textContent?.trim() || "",
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        scrollOverflow: strong ? Math.max(0, strong.scrollWidth - strong.clientWidth) : 0,
      };
    });

    return {
      panel: {
        width: Math.round(panelRect.width),
        height: Math.round(panelRect.height),
      },
      cards,
    };
  });
}

(async () => {
  fs.mkdirSync(outputsDir, { recursive: true });

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 720 } });

  await page.goto(`${baseUrl}#overview`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  const results = [];
  const failures = [];

  for (const action of [
    { name: "blocked", button: /test policy breach/i },
    { name: "inherited", button: /trigger inheritance/i },
  ]) {
    await page.getByRole("button", { name: action.button }).first().click();
    await page.waitForTimeout(350);

    const result = await inspectPanel(page);
    results.push({ name: action.name, ...result });

    if (result.cards.some((card) => card.scrollOverflow > 2)) {
      failures.push(`${action.name} evidence card has horizontal text overflow.`);
    }

    if (Math.max(...result.cards.map((card) => card.height)) > 118) {
      failures.push(`${action.name} evidence card is still too tall.`);
    }

    await page.locator(".enforcement-panel").screenshot({
      path: path.join(outputsDir, `ritual-evidence-panel-${action.name}-fixed.png`),
    });
  }

  await browser.close();

  const summary = {
    status: failures.length === 0 ? "PASS" : "FAIL",
    baseUrl,
    screenshots: [
      path.join(outputsDir, "ritual-evidence-panel-blocked-fixed.png"),
      path.join(outputsDir, "ritual-evidence-panel-inherited-fixed.png"),
    ],
    results,
    failures,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
})();
