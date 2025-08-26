const { execSync } = require("child_process");

function sh(cmd) {
    return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function listRules() {
    try {
        const out = sh("aio rt rule list --json");
        return JSON.parse(out).map(r => r.name);
    } catch {
        const out = sh("aio rt rule list");
        return out
            .split("\n")
            .slice(2)
            .map(l => l.trim().split(/\s+/)[0])
            .filter(Boolean);
    }
}

try {
    const rules = listRules();

    if (!rules.length) {
        console.log("[post-app-deploy] No rules found.");
        process.exit(0);
    }

    for (const r of rules) {
        console.log(`[post-app-deploy] Disabling rule: ${r}`);
        sh(`aio rt rule disable ${r}`);
    }

    console.log("[post-app-deploy] Done.");
} catch (e) {
    console.error("[post-app-deploy] Fatal:", e?.message || e);
    process.exit(1);
}
