import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "agent-dashboard",
		compatibilityDate: "2026-10-01",
		entrypoint,
		env: {
			DB: bindings.d1({ name: "agent-dashboard", id: "acda78b5-e3e6-4f85-94ce-f4359dec9daa" }),
			ADMIN_PASSWORD: bindings.secret(),
			SESSION_SECRET: bindings.secret(),
		},
	},
});
