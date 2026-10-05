import { env } from "cloudflare:workers";
import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sha256 } from "./db.ts";

const COOKIE = "session";
const MAX_AGE = 60 * 60 * 24 * 30;

async function sign(payload: string): Promise<string> {
	return sha256(`${payload}.${env.SESSION_SECRET}`);
}

// Compares digests so the comparison takes the same time for any input.
async function safeEqual(a: string, b: string): Promise<boolean> {
	const [x, y] = await Promise.all([sha256(a), sha256(b)]);
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
	return diff === 0;
}

export async function login(c: Context, password: string): Promise<boolean> {
	if (!(await safeEqual(password, env.ADMIN_PASSWORD))) return false;
	const expires = String(Date.now() + MAX_AGE * 1000);
	setCookie(c, COOKIE, `${expires}.${await sign(expires)}`, {
		httpOnly: true,
		secure: new URL(c.req.url).protocol === "https:",
		sameSite: "Lax",
		path: "/",
		maxAge: MAX_AGE,
	});
	return true;
}

export function logout(c: Context) {
	deleteCookie(c, COOKIE, { path: "/" });
}

async function loggedIn(c: Context): Promise<boolean> {
	const [expires, signature] = (getCookie(c, COOKIE) ?? "").split(".");
	if (!expires || !signature || Number(expires) < Date.now()) return false;
	return safeEqual(signature, await sign(expires));
}

export async function requireLogin(c: Context, next: Next) {
	if (!(await loggedIn(c))) return c.redirect("/login");
	// Forms are same-origin only; reject cross-site posts.
	if (c.req.method !== "GET") {
		const origin = c.req.header("Origin");
		if (origin && origin !== new URL(c.req.url).origin) return c.text("Bad origin", 403);
	}
	await next();
}
