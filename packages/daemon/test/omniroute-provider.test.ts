import { describe, expect, it } from "vitest";
import {
	createOmniRouteProviderConfig,
	OMNIROUTE_DEFAULT_BASE_URL,
	OMNIROUTE_PROVIDER_ID,
} from "../src/extensions/omniroute-provider.ts";

describe("OmniRoute Provider", () => {
	it("declares the provider metadata and default baseUrl", () => {
		const provider = createOmniRouteProviderConfig();
		expect(provider.id).toBe(OMNIROUTE_PROVIDER_ID);
		expect(provider.name).toBe("OmniRoute");
		expect(provider.baseUrl).toBe(OMNIROUTE_DEFAULT_BASE_URL);
		expect(provider.auth.apiKey?.name).toBe("OmniRoute API token");
	});

	it("includes mi-combo-dev as the default catalog model", () => {
		const provider = createOmniRouteProviderConfig();
		const models = provider.getModels();
		const combo = models.find((m) => m.id === "mi-combo-dev");
		expect(combo).toBeDefined();
		expect(combo).toMatchObject({
			id: "mi-combo-dev",
			name: "mi-combo-dev",
			provider: "omniroute",
			baseUrl: OMNIROUTE_DEFAULT_BASE_URL,
			api: "openai-completions",
			contextWindow: 128_000,
			maxTokens: 16_384,
			input: ["text", "image"],
		});
	});

	it("prompts for API token and trims it", async () => {
		const provider = createOmniRouteProviderConfig();
		const login = provider.auth.apiKey?.login;
		expect(login).toBeDefined();

		const promptCalls: object[] = [];
		const result = await login?.({
			signal: new AbortController().signal,
			prompt: async (req) => {
				promptCalls.push(req);
				return "  sk-test-omniroute-token  ";
			},
			notify: () => {},
		});

		expect(promptCalls).toHaveLength(1);
		expect(promptCalls[0]).toMatchObject({
			type: "secret",
			message: "Enter OmniRoute API token",
			placeholder: "sk-...",
		});
		expect(result).toEqual({
			type: "api_key",
			key: "sk-test-omniroute-token",
		});
	});

	it("extracts token and sets base URL when user pastes both URL and token", async () => {
		const provider = createOmniRouteProviderConfig();
		const login = provider.auth.apiKey?.login;

		const result = await login?.({
			signal: new AbortController().signal,
			prompt: async () => "http://192.168.68.115:20128/v1 sk-test-omniroute-token",
			notify: () => {},
		});

		expect(result).toEqual({
			type: "api_key",
			key: "sk-test-omniroute-token",
			env: { OMNIROUTE_BASE_URL: "http://192.168.68.115:20128/v1" },
		});
	});

	it("prompts for token if user initially enters only a base URL", async () => {
		const provider = createOmniRouteProviderConfig();
		const login = provider.auth.apiKey?.login;

		const promptCalls: object[] = [];
		const result = await login?.({
			signal: new AbortController().signal,
			prompt: async (req) => {
				promptCalls.push(req);
				if (promptCalls.length === 1) return "http://192.168.68.115:20128/v1";
				return "sk-test-token-from-second-prompt";
			},
			notify: () => {},
		});

		expect(promptCalls).toHaveLength(2);
		expect(promptCalls[1]).toMatchObject({
			type: "secret",
			message: "Enter OmniRoute API token for http://192.168.68.115:20128/v1",
			placeholder: "sk-...",
		});
		expect(result).toEqual({
			type: "api_key",
			key: "sk-test-token-from-second-prompt",
			env: { OMNIROUTE_BASE_URL: "http://192.168.68.115:20128/v1" },
		});
	});

	it("resolves from stored credential or environment variable", async () => {
		const provider = createOmniRouteProviderConfig();
		const resolve = provider.auth.apiKey?.resolve;
		expect(resolve).toBeDefined();

		// Stored credential
		const fromStored = await resolve?.({
			ctx: { env: async () => undefined } as never,
			credential: { type: "api_key", key: "sk-stored-test" },
			signal: new AbortController().signal,
		});
		expect(fromStored).toEqual({
			auth: { apiKey: "sk-stored-test" },
			source: "API key",
		});

		// Environment variable
		const fromEnv = await resolve?.({
			ctx: {
				env: async (name: string) => (name === "OMNIROUTE_API_KEY" ? "sk-env-test" : undefined),
			} as never,
			credential: null as never,
			signal: new AbortController().signal,
		});
		expect(fromEnv).toEqual({
			auth: { apiKey: "sk-env-test" },
			source: "OMNIROUTE_API_KEY",
		});
	});

	it("supports custom baseUrl via options or environment variable", () => {
		const custom = createOmniRouteProviderConfig({ baseUrl: "http://10.0.0.5:20128/v1" });
		expect(custom.baseUrl).toBe("http://10.0.0.5:20128/v1");
		expect(custom.getModels()[0]?.baseUrl).toBe("http://10.0.0.5:20128/v1");

		const saved = process.env.OMNIROUTE_BASE_URL;
		try {
			process.env.OMNIROUTE_BASE_URL = "http://127.0.0.1:9000/v1";
			const envProvider = createOmniRouteProviderConfig();
			expect(envProvider.baseUrl).toBe("http://127.0.0.1:9000/v1");
			expect(envProvider.getModels()[0]?.baseUrl).toBe("http://127.0.0.1:9000/v1");
		} finally {
			if (saved === undefined) delete process.env.OMNIROUTE_BASE_URL;
			else process.env.OMNIROUTE_BASE_URL = saved;
		}
	});

	it("discovers live models when endpoint is available and retains mi-combo-dev", async () => {
		const fakeFetch: typeof fetch = async (url) => {
			if (String(url).endsWith("/models")) {
				return new Response(
					JSON.stringify({
						object: "list",
						data: [{ id: "mi-combo-dev" }, { id: "llama-3.3-70b" }],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response("Not found", { status: 404 });
		};

		const provider = createOmniRouteProviderConfig({ fetchImpl: fakeFetch });
		let updated = false;
		await provider.refreshModels?.({
			allowNetwork: true,
			credential: { type: "api_key", key: "sk-test" },
			signal: new AbortController().signal,
			publish: async ({ update }) => {
				update?.();
				updated = true;
				return true;
			},
		});

		expect(updated).toBe(true);
		const ids = provider.getModels().map((m) => m.id);
		expect(ids).toContain("mi-combo-dev");
		expect(ids).toContain("llama-3.3-70b");
	});

	it("falls back to default models without throwing if endpoint is unreachable", async () => {
		const failingFetch: typeof fetch = async () => {
			throw new Error("Connection refused");
		};

		const provider = createOmniRouteProviderConfig({ fetchImpl: failingFetch });
		await provider.refreshModels?.({
			allowNetwork: true,
			credential: { type: "api_key", key: "sk-test" },
			signal: new AbortController().signal,
			publish: async () => true,
		});

		const ids = provider.getModels().map((m) => m.id);
		expect(ids).toEqual(["mi-combo-dev"]);
	});
});
