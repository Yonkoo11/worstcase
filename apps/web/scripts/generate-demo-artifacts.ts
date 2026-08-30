import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildDemoArtifacts } from "./demo-artifacts.js";

const output = fileURLToPath(new URL("../src/generated/demo-artifacts.json", import.meta.url));
await writeFile(output, `${JSON.stringify(buildDemoArtifacts(), null, 2)}\n`, "utf8");
