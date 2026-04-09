import express from "express";
import fs from "node:fs";
import path from "node:path";
import { apiRouter } from "./routes/api.js";

const app = express();
const PORT = 8787;
const DIST_DIR = path.join(process.cwd(), "dist");

app.use(express.json({ limit: "2mb" }));
app.use("/api", apiRouter);

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.use((request, response, next) => {
    if (request.path.startsWith("/api")) {
      next();
      return;
    }

    response.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  response.status(500).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`WikiClaw server listening on http://localhost:${PORT}`);
});
