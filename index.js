import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs-extra";
import archiver from "archiver";
import { exec } from "child_process";
import path from "path";
import { PDFDocument } from "pdf-lib";

// ---------------- APP SETUP ----------------
const app = express();
app.use(cors());

// ---------------- MULTER ----------------
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// ---------------- ROUTES ----------------
app.get("/", (req, res) => {
  res.send("PDF Backend Running");
});

// ---------- IMAGE → PDF ----------
app.post("/image-to-pdf", upload.array("images", 20), async (req, res) => {

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No images uploaded" });
    }

    const pdfDoc = await PDFDocument.create();

    const sortedFiles = req.files.sort(
      (a, b) => a.originalname.localeCompare(b.originalname)
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
    const outputPath = `output/${Date.now()}.pdf`;

    await fs.writeFile(outputPath, pdfBytes);

    res.download(outputPath, "images.pdf", () => {
      req.files.forEach((file) =>
        fs.remove(file.path).catch(console.error)
      );
      fs.remove(outputPath).catch(console.error);
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
    const outputDir = `output/${Date.now()}`;

    await fs.ensureDir(outputDir);

    const outputPrefix = path.join(outputDir, "page");
    const command = `pdftocairo -jpeg "${pdfPath}" "${outputPrefix}"`;

    exec(command, (error) => {
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

      output.on("close", () => {
        res.download(zipPath);

        // cleanup
        fs.remove(pdfPath).catch(console.error);
        fs.remove(outputDir).catch(console.error);
        fs.remove(zipPath).catch(console.error);
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

    app.listen(5000, () => {
      console.log("Server running on port 5000");
    });
  } catch (err) {
    console.error("Failed to start server:", err);
  }
};

startServer();
