import type { Provider, ProviderStreams, RefreshModelsContext } from "@earendil-works/pi-ai";
import * as piAi from "@earendil-works/pi-ai";
import * as piAiCompat from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export const OMNIROUTE_PROVIDER_ID = "omniroute";
export const OMNIROUTE_DEFAULT_BASE_URL = "http://192.168.68.115:20128/v1";
export const OMNIROUTE_MODELS_TIMEOUT_MS = 3_000;

export interface OmniRouteProviderOptions {
	baseUrl?: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}

type OmniRouteChatModelConfig = Extract<ProviderModelConfig, { type?: "chat" }>;

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const DEFAULT_MODELS: OmniRouteChatModelConfig[] = [
	{
		id: "mi-combo-dev",
		name: "mi-combo-dev",
		input: ["text", "image"],
		contextWindow: 128_000,
		maxTokens: 16_384,
		api: "openai-completions",
		reasoning: false,
		cost: ZERO_COST,
	},
];

function cloneModel(model: OmniRouteChatModelConfig): OmniRouteChatModelConfig {
	return {
		...model,
		input: [...model.input],
		cost: { ...model.cost },
		thinkingLevelMap: model.thinkingLevelMap ? { ...model.thinkingLevelMap } : undefined,
	};
}

function cloneCatalog(models: readonly OmniRouteChatModelConfig[]): OmniRouteChatModelConfig[] {
	return models.map(cloneModel);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchLiveModelIds(options: {
	baseUrl: string;
	apiKey?: string;
	signal: AbortSignal;
	fetchImpl: typeof fetch;
	timeoutMs: number;
}): Promise<string[] | undefined> {
	const { baseUrl, apiKey, signal, fetchImpl, timeoutMs } = options;
	if (signal.aborted) return undefined;

	const controller = new AbortController();
	const abort = () => controller.abort(signal.reason);
	if (signal.aborted) abort();
	else signal.addEventListener("abort", abort, { once: true });
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const headers: Record<string, string> = { Accept: "application/json" };
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
		const cleanBase = baseUrl.replace(/\/+$/, "");
		const response = await fetchImpl(`${cleanBase}/models`, {
			method: "GET",
			headers,
			signal: controller.signal,
			redirect: "error",
			cache: "no-store",
		});
		if (!response.ok) return undefined;

		const payload: unknown = await response.json();
		if (!isRecord(payload) || !Array.isArray(payload.data)) return undefined;

		const ids = new Set<string>();
		ids.add("mi-combo-dev");
		for (const row of payload.data) {
			if (!isRecord(row) || typeof row.id !== "string") continue;
			const id = row.id.trim();
			if (id) ids.add(id);
		}
		return [...ids];
	} catch {
		return undefined;
	} finally {
		clearTimeout(timeout);
		signal.removeEventListener("abort", abort);
	}
}

function modelsFromIds(ids: readonly string[]): OmniRouteChatModelConfig[] {
	return ids.map((id) => {
		const existing = DEFAULT_MODELS.find((m) => m.id === id);
		if (existing) return cloneModel(existing);
		return {
			id,
			name: id,
			input: ["text", "image"],
			contextWindow: 128_000,
			maxTokens: 16_384,
			api: "openai-completions",
			reasoning: false,
			cost: ZERO_COST,
		};
	});
}

function createCatalogConfig(options: OmniRouteProviderOptions = {}): {
	getModels(): OmniRouteChatModelConfig[];
	refreshModels(context: RefreshModelsContext): Promise<void>;
} {
	let catalog = cloneCatalog(DEFAULT_MODELS);
	let catalogKey: string | undefined;
	let credentialRevision = 0;
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;

	return {
		getModels: () => cloneCatalog(catalog),
		refreshModels: async (context: RefreshModelsContext) => {
			const apiKey = context.credential?.type === "api_key" ? context.credential.key : undefined;
			if (apiKey !== catalogKey) {
				catalogKey = apiKey;
				credentialRevision++;
				catalog = cloneCatalog(DEFAULT_MODELS);
			}
			const revision = credentialRevision;
			if (!context.allowNetwork || context.signal.aborted || typeof fetchImpl !== "function") {
				return;
			}

			const baseUrl =
				options.baseUrl ||
				(typeof process !== "undefined" && process.env?.OMNIROUTE_BASE_URL?.trim()) ||
				OMNIROUTE_DEFAULT_BASE_URL;

			const ids = await fetchLiveModelIds({
				baseUrl,
				apiKey,
				signal: context.signal,
				fetchImpl,
				timeoutMs: options.timeoutMs ?? OMNIROUTE_MODELS_TIMEOUT_MS,
			});
			if (revision !== credentialRevision || ids === undefined || context.signal.aborted) {
				return;
			}

			await context.publish({
				update: () => {
					if (revision === credentialRevision && !context.signal.aborted) {
						catalog = modelsFromIds(ids);
					}
				},
			});
		},
	};
}

export function createOmniRouteProviderConfig(
	options: OmniRouteProviderOptions = {},
): Provider<"openai-completions"> {
	const config = createCatalogConfig(options);
	const getBaseUrl = () =>
		options.baseUrl ||
		(typeof process !== "undefined" && process.env?.OMNIROUTE_BASE_URL?.trim()) ||
		OMNIROUTE_DEFAULT_BASE_URL;

	const api = piAi.lazyApi(async () => {
		const runtime = piAi as typeof piAi & { openAICompletionsApi?: () => ProviderStreams };
		const factory = runtime.openAICompletionsApi ?? piAiCompat.openAICompletionsApi;
		if (!factory) throw new Error("OmniRoute requires Pi's OpenAI completions API factory");
		return factory();
	});

	return {
		id: OMNIROUTE_PROVIDER_ID,
		name: "OmniRoute",
		get baseUrl() {
			return getBaseUrl();
		},
		auth: {
			apiKey: {
				name: "OmniRoute API token",
				async login(interaction) {
					interaction.signal.throwIfAborted();
					const entered = await interaction.prompt({
						type: "secret",
						message: "Enter OmniRoute API token",
						placeholder: "sk-...",
						signal: interaction.signal,
					});
					interaction.signal.throwIfAborted();
					let key = entered.trim();
					// Handle edge-case where user pasted both URL and token separated by spaces:
					if (key.includes(" ")) {
						const parts = key.split(/\s+/);
						const tokenPart = parts.find((p) => p.startsWith("sk-")) ?? parts[parts.length - 1];
						if (tokenPart) key = tokenPart;
					}
					if (!key) throw new Error("OmniRoute requires a non-empty API token");
					return { type: "api_key", key };
				},
				async resolve({ ctx, credential, signal }) {
					signal.throwIfAborted();
					const stored = credential?.key?.trim();
					const key = stored || (await ctx.env("OMNIROUTE_API_KEY"))?.trim();
					signal.throwIfAborted();
					return key
						? {
								auth: { apiKey: key },
								source: stored ? "API key" : "OMNIROUTE_API_KEY",
							}
						: undefined;
				},
			},
		},
		getModels: () => {
			const baseUrl = getBaseUrl();
			return config.getModels().map((model) => ({
				...cloneModel(model),
				provider: OMNIROUTE_PROVIDER_ID,
				baseUrl,
				api: "openai-completions" as const,
			}));
		},
		refreshModels: (context) => config.refreshModels(context),
		stream: api.stream,
		streamSimple: api.streamSimple,
	};
}

export default function registerOmniRouteProvider(pi: ExtensionAPI): void {
	pi.registerProvider(createOmniRouteProviderConfig());
}
