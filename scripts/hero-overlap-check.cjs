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

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

(async () => {
  fs.mkdirSync(outputsDir, { recursive: true });

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 300 } });

  await page.goto(`${baseUrl}#overview`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  const result = await page.evaluate(() => {
    const logo = document.querySelector(".hero-watermark");
    const eyebrow = document.querySelector(".command-hero > .eyebrow");

    if (!logo || !eyebrow) {
      return { found: false };
    }

    const toBox = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    return {
      found: true,
      logo: toBox(logo),
      eyebrow: toBox(eyebrow),
    };
  });

  const screenshot = path.join(outputsDir, "ritual-covenant-hero-kicker-fixed.png");
  await page.locator(".command-hero").screenshot({ path: screenshot });
  await browser.close();

  const failures = [];

  if (!result.found) {
    failures.push("Could not find hero logo or hero eyebrow.");
  } else if (intersects(result.logo, result.eyebrow)) {
    failures.push("Hero eyebrow still overlaps the Ritual logo.");
  }

  const summary = {
    status: failures.length === 0 ? "PASS" : "FAIL",
    baseUrl,
    screenshot,
    ...result,
    failures,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
})();
