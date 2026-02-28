import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { migrate } from "../db";
import { routes } from "./routes";
import { web } from "./web";

const app = new Hono();

// Auth — skip if STASHBOARD_TOKEN is not set (local dev)
const token = process.env.STASHBOARD_TOKEN;

// API auth: accept Bearer header OR stashboard_auth cookie
const api = new Hono();
if (token) {
  api.use("*", async (c, next) => {
    const auth = c.req.header("Authorization");
    if (auth === `Bearer ${token}`) return next();
    const cookie = getCookie(c, "stashboard_auth");
    if (cookie === token) return next();
    return c.json({ error: "Unauthorized" }, 401);
  });
}
api.route("/", routes);

// Web auth: cookie check, redirect to /login if missing
if (token) {
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path === "/login" || path.startsWith("/public/")) return next();
    const cookie = getCookie(c, "stashboard_auth");
    if (cookie === token) return next();
    return c.redirect("/login");
  });
}

// Web pages first (serves HTML for browser)
app.route("/", web);

// API under /api prefix
app.route("/api", api);

// Also mount API at root for backward compat (POST/DELETE/PATCH don't conflict with web GET routes)
// The web routes are mounted first so GET /library and GET / serve HTML
app.route("/", api);

// Initialize database
migrate();

const port = parseInt(process.env.PORT || "3000");
console.log(`Stashboard running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
