// The test suite runs TypeScript workers in child processes via
// --experimental-strip-types, which landed in Node 22.6.0. On an older Node the
// suite does not fail cleanly: five tests die with "bad option", which reads like
// a broken repo rather than a wrong toolchain. Fail here instead, with the reason.
const REQUIRED = [22, 6, 0];
const actual = process.versions.node.split(".").map(Number);
const ok = actual[0] > REQUIRED[0] || (actual[0] === REQUIRED[0] && actual[1] >= REQUIRED[1]);
if (!ok) {
  console.error(
    `\nWorstcase needs Node >= ${REQUIRED.join(".")}; this is ${process.versions.node}.\n` +
      `Reason: the isolated-adapter tests spawn TypeScript workers with\n` +
      `--experimental-strip-types, which does not exist before 22.6.0.\n` +
      `Fix: nvm install 22 && nvm use 22   (or: brew install node@22)\n`
  );
  process.exit(1);
}
