import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB max
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    // Some browsers send octet-stream for .xlsx — allow by extension too
    const ext = file.originalname.split(".").pop()?.toLowerCase();
    if (allowed.includes(file.mimetype) || ext === "xlsx" || ext === "xls") {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files (.xlsx, .xls) are accepted"));
    }
  },
});

const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB — comfortably fits 200 × 30KB exports
  },
  fileFilter: (_req, file, cb) => {
    const ok = /\.zip$/i.test(file.originalname);
    if (!ok) {
      return cb(new Error("Only .zip files are allowed for bulk upload."));
    }
    cb(null, true);
  },
});

export { upload, zipUpload };
