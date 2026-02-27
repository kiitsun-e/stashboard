import { Hono } from "hono";
import { migrate } from "../db";
import { routes } from "./routes";

const app = new Hono();

// Auth middleware — skip if STASHBOARD_TOKEN is not set (local dev)
const token = process.env.STASHBOARD_TOKEN;
if (token) {
  app.use("*", async (c, next) => {
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${token}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });
}

app.route("/", routes);

// Initialize database
migrate();

const port = parseInt(process.env.PORT || "3000");
console.log(`Stashboard API running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
