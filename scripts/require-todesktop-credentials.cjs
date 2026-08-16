const required = ["TODESKTOP_EMAIL", "TODESKTOP_ACCESS_TOKEN"];
const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  console.error(`Missing ToDesktop environment variables: ${missing.join(", ")}`);
  console.error("Provide credentials through the environment; this repository never stores them.");
  process.exitCode = 1;
}
