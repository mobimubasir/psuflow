
// middleware/upload.js
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure uploads directory exists
const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "appointments");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Allowed mime types
const allowedTypes = ["application/pdf", "image/png"];

// Multer storage configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix =
      Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

// File filter
function fileFilter(req, file, cb) {
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error("Only PDF and PNG files are allowed for attachments."),
      false
    );
  }
}

// Configure multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB max
  },
});

module.exports = { upload };
