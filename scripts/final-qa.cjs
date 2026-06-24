const fs = require("fs");
const path = require("path");

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5178/";
const outputsDir = path.resolve(process.cwd(), "..", "..", "outputs");
const routes = ["overview", "brief", "firewall", "bounty", "agents", "policy", "inheritance", "contracts", "pitch"];
const viewports = [
  {
    name: "desktop",
    width: 1440,
    height: 900,
    screenshot: "ritual-covenant-desktop-preview.png",
    firewallScreenshot: "ritual-covenant-firewall-desktop-preview.png",
    contractsScreenshot: "ritual-covenant-contracts-desktop-preview.png",
    contractsDetailScreenshot: "ritual-covenant-contracts-detail-desktop-preview.png",
    pitchScreenshot: "ritual-covenant-pitch-desktop-preview.png",
  },
  {
    name: "mobile",
    width: 390,
    height: 844,
    screenshot: "ritual-covenant-mobile-preview.png",
    firewallScreenshot: "ritual-covenant-firewall-mobile-preview.png",
    contractsScreenshot: "ritual-covenant-contracts-mobile-preview.png",
    contractsDetailScreenshot: "ritual-covenant-contracts-detail-mobile-preview.png",
    pitchScreenshot: "ritual-covenant-pitch-mobile-preview.png",
  },
  {
    name: "zoom-short",
    width: 1024,
    height: 300,
    screenshot: "ritual-covenant-zoom-preview.png",
    firewallScreenshot: "ritual-covenant-firewall-zoom-preview.png",
    contractsScreenshot: "ritual-covenant-contracts-zoom-preview.png",
    contractsDetailScreenshot: "ritual-covenant-contracts-detail-zoom-preview.png",
    pitchScreenshot: "ritual-covenant-pitch-zoom-preview.png",
  },
];

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

function parsePng(buffer) {
  const zlib = require("zlib");
  const signature = "89504e470d0a1a0a";

  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("Expected a PNG screenshot buffer.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    }

    if (type === "IDAT") {
      idatChunks.push(data);
    }

    if (type === "IEND") {
      break;
    }

    offset += 12 + length;
  }

  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}.`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const rowBytes = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(width * height * 4);
  let inputOffset = 0;
  let previous = Buffer.alloc(rowBytes);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const row = Buffer.from(inflated.subarray(inputOffset, inputOffset + rowBytes));
    inputOffset += rowBytes;
    const output = Buffer.alloc(rowBytes);

    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= channels ? output[x - channels] : 0;
      const up = previous[x] || 0;
      const upperLeft = x >= channels ? previous[x - channels] || 0 : 0;
      let predictor = 0;

      if (filter === 1) predictor = left;
      if (filter === 2) predictor = up;
      if (filter === 3) predictor = Math.floor((left + up) / 2);
      if (filter === 4) {
        const estimate = left + up - upperLeft;
        const distanceLeft = Math.abs(estimate - left);
        const distanceUp = Math.abs(estimate - up);
        const distanceUpperLeft = Math.abs(estimate - upperLeft);
        predictor =
          distanceLeft <= distanceUp && distanceLeft <= distanceUpperLeft
            ? left
            : distanceUp <= distanceUpperLeft
              ? up
              : upperLeft;
      }

      output[x] = (row[x] + predictor) & 255;
    }

    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      pixels[target] = output[source];
      pixels[target + 1] = output[source + 1];
      pixels[target + 2] = output[source + 2];
      pixels[target + 3] = channels === 4 ? output[source + 3] : 255;
    }

    previous = output;
  }

  return { width, height, pixels };
}

function analyzePng(buffer) {
  const { width, height, pixels } = parsePng(buffer);
  let nonDark = 0;
  let greenOrCyan = 0;
  let alpha = 0;
  let checksum = 0;

  for (let index = 0; index < pixels.length; index += 16) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const opacity = pixels[index + 3];

    if (opacity > 0) alpha += 1;
    if (red + green + blue > 70) nonDark += 1;
    if (green > 50 && (blue > 35 || red < 90)) greenOrCyan += 1;
    checksum = (checksum + red * 3 + green * 5 + blue * 7 + opacity) % 1000000007;
  }

  return { width, height, nonDark, greenOrCyan, alpha, checksum };
}

async function sampleCanvas(page) {
  const canvas = page.locator("canvas").first();
  const count = await canvas.count();

  if (count === 0) {
    return { present: false };
  }

  const box = await canvas.boundingBox();
  const buffer = await canvas.screenshot();

  return {
    present: true,
    readable: true,
    box,
    ...analyzePng(buffer),
  };
}

async function inspectRoute(page, route) {
  await page.goto(`${baseUrl}#${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  return page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(documentElement.scrollWidth, body.scrollWidth);
    const scrollHeight = Math.max(documentElement.scrollHeight, body.scrollHeight);
    const bannedText = document.body.innerText.match(/\b(mock|draft|placeholder|todo|lorem)\b/i)?.[0] || null;
    const visibleOutliers = Array.from(document.querySelectorAll("body *"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === "string" ? element.className : "",
          text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 64),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter((item) => item.width > 1 && item.height > 1 && (item.left < -2 || item.right > window.innerWidth + 2))
      .slice(0, 8);

    return {
      route: window.location.hash,
      title: document.querySelector("h1")?.textContent?.trim() || "",
      width: window.innerWidth,
      height: window.innerHeight,
      horizontalOverflow: Math.max(0, scrollWidth - window.innerWidth),
      verticalOverflow: Math.max(0, scrollHeight - window.innerHeight),
      navButtons: document.querySelectorAll(".side-nav button").length,
      buttons: document.querySelectorAll("button").length,
      ranges: document.querySelectorAll('input[type="range"]').length,
      modules: document.querySelectorAll(".contract-module").length,
      pitchRows: document.querySelectorAll(".pitch-row").length,
      trialButtons: document.querySelectorAll(".trial-button").length,
      receiptPanels: document.querySelectorAll(".receipt-panel").length,
      offlineKits: document.querySelectorAll(".offline-kit").length,
      deployRoutes: document.querySelectorAll(".deploy-route").length,
      bannedText,
      visibleOutliers,
    };
  });
}

(async () => {
  fs.mkdirSync(outputsDir, { recursive: true });

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of routes) {
      results.push({ viewport: viewport.name, ...(await inspectRoute(page, route)) });
    }

    await page.goto(`${baseUrl}#overview`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outputsDir, viewport.screenshot), fullPage: false });

    await page.goto(`${baseUrl}#firewall`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outputsDir, viewport.firewallScreenshot), fullPage: false });

    await page.goto(`${baseUrl}#contracts`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outputsDir, viewport.contractsScreenshot), fullPage: false });
    await page.locator(".contract-layout").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outputsDir, viewport.contractsDetailScreenshot), fullPage: false });

    await page.goto(`${baseUrl}#pitch`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outputsDir, viewport.pitchScreenshot), fullPage: false });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${baseUrl}#overview`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const desktopCanvas = await sampleCanvas(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}#overview`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const mobileCanvas = await sampleCanvas(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${baseUrl}#overview`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const beforeInteraction = await sampleCanvas(page);
  const inheritanceButton = page.getByRole("button", { name: /inheritance/i }).first();
  let clickedInheritance = false;
  let inheritanceRouteActive = false;

  try {
    await inheritanceButton.click({ timeout: 2500 });
    clickedInheritance = true;
    inheritanceRouteActive = await page.evaluate(
      () => window.location.hash === "#inheritance" && document.body.innerText.includes("Machine Inheritance"),
    );
  } catch {
    clickedInheritance = false;
  }

  await page.waitForTimeout(900);
  const afterInteraction = await sampleCanvas(page);

  await browser.close();

  const failures = [];

  for (const result of results) {
    if (result.horizontalOverflow > 2) {
      failures.push(`${result.viewport} ${result.route} has ${result.horizontalOverflow}px horizontal overflow.`);
    }

    if (result.navButtons !== routes.length) {
      failures.push(`${result.viewport} ${result.route} expected ${routes.length} navigation buttons, found ${result.navButtons}.`);
    }

    if (result.bannedText) {
      failures.push(`${result.viewport} ${result.route} still exposes banned wording: ${result.bannedText}.`);
    }
  }

  const policyDesktop = results.find((result) => result.viewport === "desktop" && result.route === "#policy");
  const overviewDesktop = results.find((result) => result.viewport === "desktop" && result.route === "#overview");
  const contractsDesktop = results.find((result) => result.viewport === "desktop" && result.route === "#contracts");
  const pitchDesktop = results.find((result) => result.viewport === "desktop" && result.route === "#pitch");

  if (!overviewDesktop || overviewDesktop.trialButtons < 2 || overviewDesktop.receiptPanels < 1) {
    failures.push("Overview should expose the Covenant trial controls and decision receipt.");
  }

  if (!policyDesktop || policyDesktop.ranges < 2) {
    failures.push("Policy Studio should expose at least 2 signed-limit sliders.");
  }

  if (!contractsDesktop || contractsDesktop.modules < 4) {
    failures.push("Contracts page should expose at least 4 contract cards.");
  }

  if (!contractsDesktop || contractsDesktop.offlineKits < 1) {
    failures.push("Contracts page should expose the no-faucet offline proof kit.");
  }

  if (!contractsDesktop || contractsDesktop.deployRoutes < 1) {
    failures.push("Contracts page should expose the manual deployment route.");
  }

  if (!pitchDesktop || pitchDesktop.pitchRows < 5) {
    failures.push("Pitch page should expose at least 5 differentiator rows.");
  }

  if (!desktopCanvas.present || !desktopCanvas.readable || desktopCanvas.nonDark < 25) {
    failures.push("Desktop Three.js canvas is blank or unreadable.");
  }

  if (!mobileCanvas.present || !mobileCanvas.readable || mobileCanvas.nonDark < 25) {
    failures.push("Mobile Three.js canvas is blank or unreadable.");
  }

  const interactionDelta =
    Math.abs((afterInteraction.checksum || 0) - (beforeInteraction.checksum || 0)) +
    Math.abs((afterInteraction.greenOrCyan || 0) - (beforeInteraction.greenOrCyan || 0));

  if (!clickedInheritance || !inheritanceRouteActive) {
    failures.push("Inheritance navigation was not clickable.");
  }

  if (interactionDelta < 1) {
    failures.push("Inheritance interaction did not change the rendered scene sample.");
  }

  const summary = {
    status: failures.length === 0 ? "PASS" : "FAIL",
    baseUrl,
    checkedRoutes: results.length,
    maxHorizontalOverflow: Math.max(...results.map((result) => result.horizontalOverflow)),
    screenshots: viewports.flatMap((viewport) => [
      path.join(outputsDir, viewport.screenshot),
      path.join(outputsDir, viewport.firewallScreenshot),
      path.join(outputsDir, viewport.contractsScreenshot),
      path.join(outputsDir, viewport.contractsDetailScreenshot),
      path.join(outputsDir, viewport.pitchScreenshot),
    ]),
    desktopCanvas,
    mobileCanvas,
    inheritanceInteraction: { clickedInheritance, inheritanceRouteActive, interactionDelta, beforeInteraction, afterInteraction },
    failures,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
})();
