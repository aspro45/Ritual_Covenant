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

async function readGalleryState(page) {
  return page.locator(".world-panel").evaluateAll((cards) =>
    cards.map((card, index) => {
      const rect = card.getBoundingClientRect();
      return {
        index,
        pressed: card.getAttribute("aria-pressed") === "true",
        text: (card.textContent || "").trim().replace(/\s+/g, " ").slice(0, 90),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }),
  );
}

(async () => {
  fs.mkdirSync(outputsDir, { recursive: true });

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const failures = [];
  const samples = [];

  await page.goto(`${baseUrl}#overview`, { waitUntil: "networkidle" });
  await page.locator(".world-gallery").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  const cards = page.locator(".world-panel");
  const count = await cards.count();

  if (count !== 4) {
    failures.push(`Expected 4 world gallery cards, found ${count}.`);
  }

  for (let index = 0; index < count; index += 1) {
    await cards.nth(index).click();
    await page.waitForTimeout(340);

    const state = await readGalleryState(page);
    const active = state.find((card) => card.pressed);
    const inactive = state.filter((card) => !card.pressed);
    const inDomOrder = state.every((card, cardIndex) => cardIndex === 0 || card.left >= state[cardIndex - 1].left - 2);

    samples.push({ clicked: index, active, state });

    if (!active || active.index !== index) {
      failures.push(`Click ${index} did not keep that same card active.`);
    }

    if (!inDomOrder) {
      failures.push(`Click ${index} changed the visual order instead of expanding in place.`);
    }

    if (active && inactive.length > 0 && active.width <= Math.max(...inactive.map((card) => card.width)) + 60) {
      failures.push(`Click ${index} did not visibly expand the selected card.`);
    }

    if (active && index > 0 && active.left <= state[0].left + 20) {
      failures.push(`Click ${index} moved the active card to the first slot.`);
    }
  }

  await cards.nth(1).click();
  await page.waitForTimeout(340);
  await page.locator(".world-gallery").screenshot({
    path: path.join(outputsDir, "ritual-covenant-gallery-in-place-preview.png"),
  });

  await browser.close();

  const summary = {
    status: failures.length === 0 ? "PASS" : "FAIL",
    baseUrl,
    screenshot: path.join(outputsDir, "ritual-covenant-gallery-in-place-preview.png"),
    samples,
    failures,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
})();
