const path = require("path");
const fs = require("fs");
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const multer = require("multer");
const XLSX = require("xlsx");

require("dotenv").config();

const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const MONGODB_DB = process.env.MONGODB_DB || "web_korean";
const ITEMS_COLLECTION = "items";

const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  if (origin) {
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    const requestedHeaders = req.headers["access-control-request-headers"];
    res.setHeader(
      "Access-Control-Allow-Headers",
      requestedHeaders || "Content-Type, Accept, Origin, X-Requested-With"
    );
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
    return res.sendStatus(204);
  }
  next();
});
app.use(express.json({ limit: "2mb" }));

const DIST_CLIENT = path.join(__dirname, "dist-client");
const DIST_INDEX = path.join(DIST_CLIENT, "index.html");
const spaReady = fs.existsSync(DIST_INDEX);

if (spaReady) {
  app.use(express.static(DIST_CLIENT));
} else {
  app.use(express.static(path.join(__dirname, "public")));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function toItem(doc) {
  if (!doc) {
    return null;
  }
  return {
    id: doc._id.toString(),
    korean: doc.korean,
    vietnamese: doc.vietnamese,
    topic: doc.topic,
    wrongCount: Number(doc.wrong_count) || 0,
  };
}

function parseItemObjectId(raw) {
  try {
    return new ObjectId(String(raw));
  } catch {
    return null;
  }
}

function parseTopicsQuery(raw) {
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }
  const s = String(raw).trim();
  if (s === "" || s.toLowerCase() === "all") {
    return "all";
  }
  return s.split(",").map((t) => t.trim()).filter(Boolean);
}

function isLikelyHeaderRow(row) {
  if (!Array.isArray(row) || row.length < 3) {
    return false;
  }
  const a = String(row[0] ?? "").trim().toLowerCase();
  const b = String(row[1] ?? "").trim().toLowerCase();
  const markers = [
    "korean",
    "hangul",
    "tiếng hàn",
    "han",
    "vietnamese",
    "tiếng việt",
    "chủ đề",
    "topic",
    "wrong",
    "sai",
  ];
  return markers.some((m) => a === m || b === m);
}

function sendSpaIndex(res) {
  res.sendFile(DIST_INDEX);
}

function mountApiRoutes(items) {
  app.get("/api/health", async (_req, res) => {
    try {
      await items.estimatedDocumentCount();
      res.json({ status: "ok", service: "web-korean-be" });
    } catch (err) {
      res.status(503).json({ status: "error", error: String(err.message || err) });
    }
  });
  app.get("/api/topics", async (_req, res) => {
    try {
      const topics = await items.distinct("topic");
      const sorted = topics
        .map((t) => String(t))
        .sort((a, b) => a.localeCompare(b, "vi", { sensitivity: "base" }));
      res.json({ topics: sorted });
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  app.get("/api/items", async (req, res) => {
    const topics = parseTopicsQuery(req.query.topics);
    if (topics === null) {
      res.status(400).json({ error: "Thiếu tham số topics (vd: ?topics=all hoặc ?topics=A,B)" });
      return;
    }
    try {
      let cursor;
      if (topics === "all") {
        cursor = items.find({});
      } else if (topics.length === 0) {
        res.json({ items: [] });
        return;
      } else {
        cursor = items.find({ topic: { $in: topics } });
      }
      const docs = await cursor.toArray();
      res.json({ items: docs.map((d) => toItem(d)) });
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  app.post("/api/items", async (req, res) => {
    const korean = String(req.body?.korean ?? "").trim();
    const vietnamese = String(req.body?.vietnamese ?? "").trim();
    const topic = String(req.body?.topic ?? "").trim();
    if (!korean || !vietnamese || !topic) {
      res.status(400).json({ error: "Cần đủ tiếng Hàn, tiếng Việt và chủ đề" });
      return;
    }
    try {
      const doc = { korean, vietnamese, topic, wrong_count: 0 };
      const result = await items.insertOne(doc);
      const row = toItem({ ...doc, _id: result.insertedId });
      res.status(201).json({ item: row });
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) });
    }
  });
  app.post("/api/topics/reset-wrong", async (req, res) => {
    const topic = String(req.body?.topic ?? "").trim();
    if (!topic) {
      res.status(400).json({ error: "Thiếu topic" });
      return;
    }
    try {
      const result = await items.updateMany({ topic }, { $set: { wrong_count: 0 } });
      res.json({ topic, updated: Number(result.modifiedCount) || 0 });
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  app.patch("/api/items/:id/wrong", async (req, res) => {
    const objectId = parseItemObjectId(req.params.id);
    if (!objectId) {
      res.status(400).json({ error: "id không hợp lệ" });
      return;
    }
    try {
      const updated = await items.findOneAndUpdate(
        { _id: objectId },
        { $inc: { wrong_count: 1 } },
        { returnDocument: "after" }
      );
      if (!updated) {
        res.status(404).json({ error: "Không tìm thấy item" });
        return;
      }
      res.json({ item: toItem(updated) });
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  app.post("/api/import/excel", upload.single("file"), async (req, res) => {
    if (!req.file || !req.file.buffer) {
      res.status(400).json({ error: "Thiếu file Excel (field name: file)" });
      return;
    }
    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    } catch {
      res.status(400).json({ error: "Không đọc được file Excel" });
      return;
    }
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      res.status(400).json({ error: "File không có sheet" });
      return;
    }
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    let start = 0;
    if (matrix.length > 0 && isLikelyHeaderRow(matrix[0])) {
      start = 1;
    }
    const batch = [];
    for (let i = start; i < matrix.length; i += 1) {
      const row = matrix[i];
      if (!Array.isArray(row) || row.length < 3) {
        continue;
      }
      const korean = String(row[0] ?? "").trim();
      const vietnamese = String(row[1] ?? "").trim();
      const topic = String(row[2] ?? "").trim();
      if (!korean || !vietnamese || !topic) {
        continue;
      }
      batch.push({ korean, vietnamese, topic, wrong_count: 0 });
    }
    try {
      let inserted = 0;
      if (batch.length > 0) {
        const result = await items.insertMany(batch);
        inserted = result.insertedCount;
      }
      res.json({ inserted, message: `Đã nhập ${inserted} dòng` });
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  if (spaReady) {
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api")) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      sendSpaIndex(res);
    });
  }
}

function startListening(port, attemptsLeft) {
  const server = app.listen(port, () => {
    const modeHint = spaReady ? " (React)" : " — chưa build client: npm run build:client";
    console.log(`WEB_Korean: http://localhost:${port}${modeHint}`);
    console.log(`MongoDB: ${MONGODB_DB}.${ITEMS_COLLECTION} @ ${MONGODB_URI.replace(/:[^:@]+@/, ":****@")}`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && attemptsLeft > 1) {
      console.warn(`Cổng ${port} đang bận — thử cổng ${port + 1}`);
      startListening(port + 1, attemptsLeft - 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);
  const items = db.collection(ITEMS_COLLECTION);
  await items.createIndex({ topic: 1 });
  mountApiRoutes(items);
  startListening(PORT, 20);
  process.on("SIGINT", async () => {
    await client.close().catch(() => {});
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await client.close().catch(() => {});
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Không kết nối được MongoDB:", err.message || err);
  console.error("Kiểm tra MONGODB_URI và dịch vụ mongod.");
  process.exit(1);
});
