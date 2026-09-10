import fs from "node:fs";
import { chromium, type Browser } from "playwright-core";

const WINDOWS_BROWSER_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];

export function findBrowserExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }

  return WINDOWS_BROWSER_PATHS.find((candidate) => fs.existsSync(candidate));
}

export async function launchBrowser(): Promise<Browser> {
  const executablePath = findBrowserExecutable();

  if (!executablePath) {
    throw new Error("Chromium-compatible browser executable was not found");
  }

  return chromium.launch({
    executablePath,
    headless: true
  });
}
