import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs-extra";
import archiver from "archiver";
import { execFile, execFileSync } from "child_process";
import path from "path";
import { PDFDocument } from "pdf-lib";
import crypto from "crypto";
import "dotenv/config";

// ---------------- APP SETUP ----------------
const app = express();

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["https://pdf.olivez.in"];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error("CORS blocked"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    exposedHeaders: ["Content-Disposition"],
  })
);

app.options("*", cors());
// ---------------- MULTER ----------------
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === "application/pdf" ||
      file.mimetype.startsWith("image/")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type"));
    }
  },
});

// ---------------- ROUTES ----------------
app.get("/", (_, res) => {
  res.status(200).send("PDF Backend Running");
});

// ---------- IMAGE → PDF ----------
app.post("/image-to-pdf", upload.array("images", 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No images uploaded" });
    }

    const pdfDoc = await PDFDocument.create();

    const sortedFiles = req.files.sort((a, b) =>
      a.originalname.localeCompare(b.originalname)
    );

    for (const file of sortedFiles) {
      const imageBytes = await fs.readFile(file.path);

      let image;
      if (file.mimetype === "image/jpeg") {
        image = await pdfDoc.embedJpg(imageBytes);
      } else if (file.mimetype === "image/png") {
        image = await pdfDoc.embedPng(imageBytes);
      } else {
        continue;
      }

      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
    }

    const pdfBytes = await pdfDoc.save();
    const outputPath = `output/${crypto.randomUUID()}.pdf`;

    await fs.writeFile(outputPath, pdfBytes);

    res.download(outputPath, "images.pdf", async () => {
      for (const file of req.files) {
        await fs.remove(file.path).catch(console.error);
      }
      await fs.remove(outputPath).catch(console.error);
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Image to PDF failed" });
  }
});

// ---------- PDF → IMAGE ----------
app.post("/pdf-to-image", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    if (req.file.mimetype !== "application/pdf") {
      return res.status(400).json({ error: "Only PDF files allowed" });
    }

    const pdfPath = req.file.path;

    let pageCount;
    try {
      pageCount = parseInt(
        execFileSync("pdfinfo", [pdfPath])
          .toString()
          .match(/Pages:\s+(\d+)/)[1]
      );

      if (pageCount > 25) {
        await fs.remove(pdfPath);
        return res.status(400).json({ error: "PDF too large (max 25 pages)" });
      }
    } catch {
      await fs.remove(pdfPath);
      return res.status(400).json({ error: "Invalid PDF file" });
    }

    const jobId = crypto.randomUUID();
    const outputDir = `output/${jobId}`;
    await fs.ensureDir(outputDir);

    const outputPrefix = path.join(outputDir, "page");
    const format = req.query.format === "jpg" ? "-jpeg" : "-png";

    execFile("pdftocairo", [format, pdfPath, outputPrefix], (error) => {
      if (error) {
        console.error("Poppler error:", error);
        return res.status(500).json({ error: "Conversion failed" });
      }

      const zipPath = `${outputDir}.zip`;
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip");

      archive.pipe(output);
      archive.directory(outputDir, false);
      archive.finalize();

      archive.on("error", (err) => {
        console.error("Archive error:", err);
        res.status(500).json({ error: "ZIP creation failed" });
      });

      output.on("close", async () => {
        res.download(zipPath, "images.zip");

        await fs.remove(pdfPath).catch(console.error);
        await fs.remove(outputDir).catch(console.error);
        await fs.remove(zipPath).catch(console.error);
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- SERVER START ----------------
const startServer = async () => {
  try {
    await fs.ensureDir("uploads");
    await fs.ensureDir("output");

    const PORT = process.env.PORT || 5000;

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
  }
};

startServer();
