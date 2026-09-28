import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const version = manifest.version;
if (!/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(version))
  throw new Error(`Invalid Chrome extension version: ${version}`);

const before = process.env.BEFORE_SHA || "";
let previousVersion = null;
if (/^[a-f0-9]{40}$/i.test(before) && !/^0+$/.test(before)) {
  try {
    const previous = execFileSync("git", ["show", `${before}:manifest.json`], { encoding: "utf8" });
    previousVersion = JSON.parse(previous).version;
  } catch (error) {
    throw new Error(`Cannot read manifest.json from previous commit ${before}`, { cause: error });
  }
}

const release = previousVersion !== version;
console.log(`Manifest version: ${previousVersion ?? "none"} -> ${version}; release=${release}`);
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nrelease=${release}\n`);
