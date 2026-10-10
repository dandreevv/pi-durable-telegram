import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai";
import { AUTH_FILE } from "../agent/open.ts";
import { loadProvider } from "../agent/providers.ts";
import { FileCredentialStore } from "../auth/credential-store.ts";
import { createHeadlessInteraction } from "../auth/interaction.ts";
import { dataDirFromEnv } from "../config/schema.ts";
import { errorSummary } from "../runtime/log.ts";
import { ensurePrivateDir } from "../runtime/private-dir.ts";

/**
 * `login <provider>`: OAuth when the provider offers it (Anthropic: Claude Pro/Max with the headless copy-code flow),
 * else an API key prompt. Credentials go to `<PI_DATA_DIR>/auth.json` (mode 600) through the same store the daemon
 * uses, so it is safe while the daemon runs. Uses pi-ai's own login flows unchanged.
 */
export async function runLogin(provider: string, env: NodeJS.ProcessEnv = process.env): Promise<number> {
	const dataDir = dataDirFromEnv(env);
	const providerImpl = await loadProvider(provider);
	if (providerImpl === undefined) {
		process.stderr.write(`Unknown provider: ${provider}\n`);
		return 2;
	}
	await ensurePrivateDir(dataDir);
	const path = join(dataDir, AUTH_FILE);
	const models = createModels({ credentials: new FileCredentialStore(path) });
	models.setProvider(providerImpl);
	const interaction = createHeadlessInteraction();
	const type = providerImpl.auth.oauth === undefined ? "api_key" : "oauth";
	try {
		await models.login(provider, type, interaction);
		process.stdout.write(`\nLogged in to ${provider} (${type}); credentials stored in ${path} (mode 600).\n`);
		return 0;
	} catch (error) {
		process.stderr.write(`\nLogin failed: ${errorSummary(error)}\n`);
		return 1;
	} finally {
		interaction.close();
	}
}
