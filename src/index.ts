import { Hono } from "hono";
import { api } from "./api.ts";
import { ui } from "./ui.tsx";

const app = new Hono();
app.route("/api", api);
app.route("/", ui);

export default app satisfies ExportedHandler;
