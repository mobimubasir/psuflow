// server.js
require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const { sequelize, connectToDB } = require("./config/database");
const { upload } = require("./middleware/upload");     
// server.js
const { User }         = require("./models/User");
const { Appointment }  = require("./models/Appointment");
const { BlockedSlot }  = require("./models/BlockedSlot");
const { Announcement } = require("./models/Announcement");
const { Notification } = require("./models/Notification");


const app = express();
app.use("/js",    express.static(path.join(__dirname, "js")));                 // <-- add this
app.use("/lang",  express.static(path.join(__dirname, "public", "lang")));     // <-- and this
/* ---------------- Core middleware ---------------- */
app.use(cors());
app.use(express.json()); // must be before JSON POST routes

/* ---------------- Views & Static ------------------ */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use("/css", express.static(path.join(__dirname, "css")));
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use("/uploads", express.static(path.join(__dirname, "uploads"))); // serve uploaded files

/* ---------------- Config constants ---------------- */
const MAX_STUDENTS_PER_SLOT = 2;      // SF-US2: limit bookings per slot
const SLOT_LENGTH_MIN = 15;
const DEFAULT_SLOTS = ["12:00 PM", "12:15 PM", "12:30 PM", "12:45 PM"];

// What we consider “academic” for FC-US5
const ACADEMIC_CATEGORIES = [
  "advising",
  "senior-project",
  "course-advising",
  "thesis",
  "project",
  "academic",
];

/* ---------------- DB boot ------------------------- */
(async () => {
  try {
    await connectToDB();
    await sequelize.authenticate();
    console.log("✅ Database connected successfully");
    await sequelize.sync();



    /* ============== PAGE ROUTES (EJS) ============== */
    app.get("/", (req, res) => res.redirect("/login"));
    app.get("/login", (req, res) => res.render("login", { title: "Login | PSUFlow" }));
    app.get("/resetpass", (req, res) => res.render("resetPass", { title: "Reset Password | PSUFlow" }));

    // Student pages
    app.get("/studentdashboard", (req, res) => {
      res.render("studentdashboard", { title: "PSUFlow Student Dashboard" });
    });

    app.get("/bookappointment", async (req, res) => {
      try {
        const faculty = await User.findAll({
          where: { role: "faculty" },
          attributes: ["id", "name", "username"],
        });
        const staff = await User.findAll({
          where: { role: "staff" },
          attributes: ["id", "name", "username", "staffCategory"],
        });

        res.render("bookappointment", {
          title: "Book Appointment - PSUFlow",
          people: {
            faculty: faculty.map(f => ({ id: f.id, name: f.name || f.username })),
            staff: staff.map(s => ({
              id: s.id,
              name: s.name || s.username,
              category: s.staffCategory || null,
            })),
          },
        });
      } catch (e) {
        console.error("Error loading bookappointment people:", e);
        res.render("bookappointment", {
          title: "Book Appointment - PSUFlow",
          people: { faculty: [], staff: [] },
        });
      }
    });

    app.get("/myappointments", (req, res) => {
      res.render("myappointments", { title: "My Appointments - PSUFlow" });
    });

    // Faculty pages
    app.get("/facultydashboard", (req, res) => {
      res.render("Facultydashboard", { title: "PSUFlow Faculty Dashboard" });
    });
    app.get("/facultyappointment", (req, res) => {
      res.render("Facultyappointment", { title: "PSUFlow Faculty Appointments" });
    });
    app.get("/facultyinbox", (req, res) => {
      res.render("FacultyInbox", { title: "PSUFlow Faculty Inbox" });
    });

    // Staff pages
    app.get("/staffdashboard", (req, res) => {
      res.render("StaffDashboard", { title: "PSUFlow Staff Dashboard" });
    });
    app.get("/staffinbox", (req, res) => {
      res.render("StaffInbox", { title: "PSUFlow Staff Inbox" });
    });
    app.get("/staffqueueoverview", (req, res) => {
      res.render("Staffqueueoverview", { title: "PSUFlow Staff View Queue" });
    });

    /* ============== AUTH API ======================= */
    app.post("/auth/login", async (req, res) => {
      try {
        const { username, password } = req.body || {};
        if (!username || !password) {
          return res.status(400).json({ error: "Username and password are required." });
        }
        const user = await User.findOne({ where: { username } });
        if (!user) return res.status(400).json({ error: "Invalid username" });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ error: "Invalid password" });

        res.json({
          id: user.id,
          name: user.name || user.username,
          role: user.role,
          staffCategory: user.staffCategory || null,
        });
      } catch (e) {
        console.error("Login error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    app.post("/auth/change-password", async (req, res) => {
      try {
        const { userId, oldPassword, newPassword } = req.body || {};
        if (!userId || !oldPassword || !newPassword) {
          return res.status(400).json({ error: "Missing fields." });
        }
        const user = await User.findByPk(userId);
        if (!user) return res.status(404).json({ error: "User not found." });

        const ok = await bcrypt.compare(oldPassword, user.password);
        if (!ok) return res.status(400).json({ error: "Old password is incorrect." });

        const hash = await bcrypt.hash(newPassword, 10);
        user.password = hash;
        await user.save();

        res.json({ message: "Password updated." });
      } catch (e) {
        console.error("change-password error:", e);
        res.status(500).json({ error: "Server error." });
      }
    });
/**
 * POST /appointments/:id/decide
 * Body: { facultyId, decision: "APPROVED" | "REJECTED" }
 * - only the owning faculty can decide
 * - only when status === WAITING (prevents duplicates)
 * - stamps decidedById/decidedAt
 * - notifies the student
 */
// Approve/Reject with duplicate-guard + student notification
app.post("/appointments/:id/decide", async (req, res) => {
  try {
    const { facultyId, decision } = req.body || {};
    if (!facultyId || !["APPROVED", "REJECTED"].includes(String(decision).toUpperCase())) {
      return res.status(400).json({ error: "facultyId and decision (APPROVED|REJECTED) are required" });
    }
    const appt = await Appointment.findByPk(req.params.id, {
      include: [{ model: User, as: "student", attributes: ["id","name","username"] }],
    });
    if (!appt) return res.status(404).json({ error: "Appointment not found" });

    // only the assigned faculty can decide
    if (String(appt.facultyId) !== String(facultyId)) {
      return res.status(403).json({ error: "Not authorized for this appointment" });
    }

    // ✅ duplicate prevention: allow only when it is currently WAITING
    if (String(appt.status).toUpperCase() !== "WAITING") {
      return res.status(409).json({ error: `Already ${String(appt.status).toLowerCase()}` });
    }

    const DECISION = String(decision).toUpperCase(); // APPROVED | REJECTED
    appt.status = DECISION;
    if ("decidedById" in appt) appt.decidedById = facultyId;  // harmless if column exists
    if ("decidedAt"   in appt) appt.decidedAt   = new Date();
    await appt.save();

    // Best-effort student notification
    try {
      await Notification.create({
        toUserId: appt.studentId,
        title: DECISION === "APPROVED" ? "Appointment approved" : "Appointment rejected",
        body:  `Your ${appt.category || "appointment"} on ${appt.date} at ${appt.time} was ${DECISION.toLowerCase()}.`,
      });
    } catch (e) { console.warn("notify failed:", e.message); }

    res.json({
      message: `Appointment ${DECISION.toLowerCase()}.`,
      appointment: { id: appt.id, status: appt.status, decidedById: appt.decidedById, decidedAt: appt.decidedAt }
    });
  } catch (e) {
    console.error("POST /appointments/:id/decide", e);
    res.status(500).json({ error: "Server error" });
  }
});

/*********** APPROVAL / REJECTION + PENDING + NOTIFICATIONS ***********/
const { Transaction } = require("sequelize");

/**
 * GET /appointments/pending/:facultyId?category=advising
 * - Returns WAITING appointments filtered by category (optional).
 * - You can scope further to this faculty’s own appointments if you prefer.
 */
app.get("/appointments/pending/:facultyId", async (req, res) => {
  try {
    const { facultyId } = req.params;
    const { category } = req.query;

    const where = { status: "WAITING" };
    if (category) where.category = category;

    // If you want strictly the ones assigned to this faculty, uncomment:
    // where.facultyId = facultyId;

    const rows = await Appointment.findAll({
      where,
      order: [["date","ASC"],["time","ASC"]],
      include: [{ model: User, as: "student", attributes: ["id","name","username"] }],
    });

    res.json(rows);
  } catch (e) {
    console.error("GET /appointments/pending error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * PUT /appointments/:id/decision
 * Body: { action: "APPROVE" | "REJECT", facultyId }
 * - Atomic (transaction + row lock)
 * - Prevents duplicate approvals/rejections (only from WAITING)
 * - Notifies the student
 */
app.put("/appointments/:id/decision", async (req, res) => {
  const { id } = req.params;
  const { action, facultyId } = req.body || {};
  const act = String(action || "").toUpperCase();

  if (!["APPROVE","REJECT"].includes(act)) {
    return res.status(400).json({ error: "action must be APPROVE or REJECT" });
  }

  const t = await sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED });
  try {
    // Lock row for update to avoid race
    const appt = await Appointment.findOne({ where: { id }, transaction: t, lock: t.LOCK.UPDATE });
    if (!appt) { await t.rollback(); return res.status(404).json({ error: "Appointment not found" }); }

    // Ownership check (only the assigned faculty can decide)
    if (String(appt.facultyId) !== String(facultyId)) {
      await t.rollback();
      return res.status(403).json({ error: "Not your appointment" });
    }

    // Prevent duplicate decisions
    if (appt.status !== "WAITING") {
      await t.rollback();
      return res.status(409).json({ error: `Already ${appt.status}` });
    }

    // Decide
    appt.status = (act === "APPROVE") ? "APPROVED" : "REJECTED";
    appt.decidedById = facultyId || null;
    appt.decidedAt = new Date();
    await appt.save({ transaction: t });

    // Notify student
    await Notification.create({
      toUserId: appt.studentId,
      title: `Appointment ${appt.status}`,
      body: `Your ${appt.category || "appointment"} on ${appt.date} at ${appt.time} was ${appt.status.toLowerCase()}.`,
    }, { transaction: t });

    await t.commit();
    res.json({
      id: appt.id,
      status: appt.status,
      decidedById: appt.decidedById,
      decidedAt: appt.decidedAt,
    });
  } catch (e) {
    console.error("PUT /appointments/:id/decision error:", e);
    try { await t.rollback(); } catch {}
    res.status(500).json({ error: "Server error" });
  }
});
// Associations assumed:
// Appointment.belongsTo(User, { as: 'student', foreignKey: 'studentId' });
// Appointment.belongsTo(User, { as: 'faculty', foreignKey: 'facultyId' });

app.get('/staff/student-history', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ items: [], query: q });

    // If you want to restrict to staff's category, uncomment and use req.user:
    // const staffCategory = req.user?.staffCategory;  // however you store it

    const isNumericId = /^\d+$/.test(q);

    const whereStudent =
      isNumericId
        ? { id: Number(q) }
        : {
            [Op.or]: [
              { name:     { [Op.like]: `%${q}%` } },
              { username: { [Op.like]: `%${q}%` } }
            ]
          };

    const rows = await Appointment.findAll({
      include: [
        { model: User, as: 'student', attributes: ['id', 'name', 'username'], where: whereStudent },
        { model: User, as: 'faculty', attributes: ['id', 'name', 'username'] }
      ],
      // If you want category scoping per staff:
      // where: staffCategory ? { category: staffCategory } : undefined,
      order: [['date','DESC'], ['time','DESC']],
      // limit: 200 // optional
    });

    const items = rows.map(a => ({
      id: a.id,
      studentId: a.student?.id,
      studentName: a.student?.name || a.student?.username || '—',
      withName: a.faculty?.name || a.faculty?.username || '—',
      category: a.category || '—',
      date: a.date,         // ISO yyyy-mm-dd
      time: a.time || '—',  // "12:15 PM"
      status: a.status || 'WAITING'
    }));

    res.json({ items, query: q });
  } catch (e) {
    console.error('student-history error', e);
    res.status(500).json({ error: 'Failed to load student history' });
  }
});

/**
 * GET /notifications/user/:userId
 * - Student can fetch their notifications (e.g., for inbox/toasts)
 */
app.get("/notifications/user/:userId", async (req, res) => {
  try {
    const list = await Notification.findAll({
      where: { toUserId: req.params.userId },
      order: [["id","DESC"]],
    });
    res.json(list);
  } catch (e) {
    console.error("GET /notifications/user error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * PUT /notifications/:id/read   Body: { read: true }
 * - Mark notification as read
 */
app.put("/notifications/:id/read", async (req, res) => {
  try {
    const n = await Notification.findByPk(req.params.id);
    if (!n) return res.status(404).json({ error: "Notification not found" });
    n.read = (req.body && typeof req.body.read === "boolean") ? req.body.read : true;
    await n.save();
    res.json(n);
  } catch (e) {
    console.error("PUT /notifications/:id/read error:", e);
    res.status(500).json({ error: "Server error" });
  }
});
/*********** END APPROVAL / REJECTION ***********/

    /**
 * GET /appointments/:id/note
 * -> Returns the note/comments thread for this appointment
 */
app.get("/appointments/:id/note", async (req, res) => {
  try {
    const appt = await Appointment.findByPk(req.params.id, {
      attributes: ["id", "notes"],
    });
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    res.json({ note: appt.notes || "" });
  } catch (err) {
    console.error("GET /appointments/:id/note", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /appointments/:id/note
 * Body: { facultyId, text }
 * -> Overwrites or appends the notes field
 */
app.put("/appointments/:id/note", async (req, res) => {
  const { facultyId, text } = req.body || {};
  try {
    const appt = await Appointment.findByPk(req.params.id);
    if (!appt) return res.status(404).json({ error: "Appointment not found" });

    // Optional: Verify the facultyId matches this appointment’s facultyId
    if (facultyId && appt.facultyId && appt.facultyId !== facultyId)
      return res.status(403).json({ error: "Not authorized for this appointment" });

    appt.notes = text;
    await appt.save();
    res.json({ message: "Notes updated", note: appt.notes });
  } catch (err) {
    console.error("PUT /appointments/:id/note", err);
    res.status(500).json({ error: "Could not update notes" });
  }
});

/**
 * (Optional) POST /appointments/comment/:id
 * -> Legacy single-line comment append version
 * Body: { facultyId, text }
 */
app.post("/appointments/comment/:id", async (req, res) => {
  const { facultyId, text } = req.body || {};
  try {
    const appt = await Appointment.findByPk(req.params.id);
    if (!appt) return res.status(404).json({ error: "Appointment not found" });

    if (facultyId && appt.facultyId && appt.facultyId !== facultyId)
      return res.status(403).json({ error: "Not authorized for this appointment" });

    const now = new Date().toLocaleString();
    const who = `Faculty#${facultyId || "?"}`;
    const line = `[${now}] ${who}: ${text}`;
    appt.notes = (appt.notes || "") + (appt.notes ? "\n" : "") + line;
    await appt.save();
    res.json({ message: "Comment added", note: appt.notes });
  } catch (err) {
    console.error("POST /appointments/comment/:id", err);
    res.status(500).json({ error: "Failed to save comment" });
  }
});
    /* ============== APPOINTMENTS API =============== */

    // Availability for a faculty + date (respects BlockedSlot + per-slot max)
    app.get("/appointments/available/:facultyId/:date", async (req, res) => {
      try {
        const { facultyId, date } = req.params;

        // 1) blocked slots
        const blocked = await BlockedSlot.findAll({ where: { facultyId, date } });
        const blockedTimes = new Set(blocked.map(b => b.time));

        // 2) existing bookings
        const appts = await Appointment.findAll({
          attributes: ["time"],
          where: { facultyId, date },
        });
        const counts = appts.reduce((m, a) => {
          m[a.time] = (m[a.time] || 0) + 1;
          return m;
        }, {});

        // 3) compose response
        const result = DEFAULT_SLOTS.map(time => {
          const full = (counts[time] || 0) >= MAX_STUDENTS_PER_SLOT;
          const isBlocked = blockedTimes.has(time);
          return { time, available: !full && !isBlocked };
        });

        res.json(result);
      } catch (e) {
        console.error("availability error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    // Book an appointment (handles attachments via multer)
    app.post(
      "/appointments/book",
      upload.fields([
        { name: "transcripts", maxCount: 1 },
        { name: "paymentProof", maxCount: 1 },
      ]),
      async (req, res) => {
        try {
          const { studentId, personId, date, time, category, reason } = req.body || {};
          
          if (!studentId || !personId || !date || !time) {
            return res.status(400).json({ error: "studentId, personId, date and time are required." });
          }

          // Slot blocked?
          const blocked = await BlockedSlot.findOne({
            where: { facultyId: personId, date, time },
          });
          if (blocked) {
            return res.status(400).json({ error: "Slot is blocked by faculty." });
          }

          // Slot capacity? (SF-US2)
          const count = await Appointment.count({ where: { facultyId: personId, date, time } });
          if (count >= MAX_STUDENTS_PER_SLOT) {
            return res.status(400).json({ error: "Slot is full" });
          }

          const transcriptPath = req.files?.transcripts?.[0]?.path || null;
          const paymentProofPath = req.files?.paymentProof?.[0]?.path || null;

          const created = await Appointment.create({
            studentId,
            facultyId: personId,
            date,
            time,
            category: category || null,
            reason: reason || null,   // ✅ NEW: store reason
            transcriptPath,
            paymentProofPath,
            status: "WAITING",
          });

          res.json({
            message: "Appointment booked",
            appointment: {
              id: created.id,
              studentId,
              facultyId: personId,
              dateISO: date,
              timeLabel: time,
              category: category || "",
              reason: created.reason || "",
              status: created.status,
            },
          });
        } catch (e) {
          console.error("book error:", e);
          res.status(500).json({ error: "Server error" });
        }
      }
    );

    // Student’s appointments
    app.get("/appointments/my/:studentId", async (req, res) => {
      try {
        const appointments = await Appointment.findAll({
          where: { studentId: req.params.studentId },
          include: [{ model: User, as: "faculty", attributes: ["id", "name", "username"] }],
          order: [["date", "ASC"], ["time", "ASC"]],
        });
        res.json(appointments);
      } catch (e) {
        console.error("appointments/my error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    // Cancel
    app.post("/appointments/cancel/:id", async (req, res) => {
      try {
        const appt = await Appointment.findByPk(req.params.id);
        if (!appt) return res.status(404).json({ error: "Appointment not found" });
        appt.status = "CANCELED";
        await appt.save();
        res.json({ message: "Appointment canceled." });
      } catch (e) {
        console.error("cancel error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    // Reschedule
    app.post("/appointments/reschedule/:id", async (req, res) => {
      try {
        const { date, time } = req.body || {};
        const appt = await Appointment.findByPk(req.params.id);
        if (!appt) return res.status(404).json({ error: "Appointment not found" });

        // target blocked?
        const blocked = await BlockedSlot.findOne({
          where: { facultyId: appt.facultyId, date, time },
        });
        if (blocked) return res.status(400).json({ error: "Target slot is blocked." });

        // target full?
        const count = await Appointment.count({
          where: {
            facultyId: appt.facultyId,
            date,
            time,
            id: { [Op.ne]: appt.id },
          },
        });
        if (count >= MAX_STUDENTS_PER_SLOT) {
          return res.status(400).json({ error: "Target slot is full" });
        }

        appt.date = date;
        appt.time = time;
        appt.status = "RESCHEDULED";
        await appt.save();
        res.json({ message: "Appointment rescheduled." });
      } catch (e) {
        console.error("reschedule error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    /* ============== FACULTY API (FC-US5) =========== */

    // Upcoming for a faculty with filters:
    // GET /appointments/upcoming/:facultyId?onlyAcademic=true&category=advising
    app.get("/appointments/upcoming/:facultyId", async (req, res) => {
      try {
        const { facultyId } = req.params;
        const { onlyAcademic, category } = req.query;

        if (!facultyId) return res.status(400).json({ error: "facultyId required" });

        const where = { facultyId };

        if (category && category !== "all") {
          where.category = category;
        } else if (onlyAcademic === "true") {
          where.category = { [Op.in]: ACADEMIC_CATEGORIES };
        }

        const rows = await Appointment.findAll({
          where,
          order: [["date", "ASC"], ["time", "ASC"]],
          include: [{ model: User, as: "student", attributes: ["id", "name", "username"] }],
        });

        res.json(rows);
      } catch (e) {
        console.error("upcoming/faculty (filtered) error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    // Distinct categories used by this faculty (to populate UI dropdown)
    app.get("/appointments/categories/:facultyId", async (req, res) => {
      try {
        const { facultyId } = req.params;
        if (!facultyId) return res.status(400).json({ error: "facultyId required" });

        const rows = await Appointment.findAll({
          where: { facultyId },
          attributes: [[sequelize.fn("DISTINCT", sequelize.col("category")), "category"]],
          raw: true,
        });

        const list = rows
          .map(r => (r.category || "").toString().trim())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));

        res.json(list);
      } catch (e) {
        console.error("categories error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    /* ============== FC-US3: BLOCKED SLOTS ========= */

    // Create/confirm a blocked slot
    app.post("/faculty/blocks", async (req, res) => {
      try {
        const { facultyId, date, time, reason } = req.body || {};
        if (!facultyId || !date || !time) {
          return res.status(400).json({ error: "facultyId, date, time are required." });
        }
        const [row, created] = await BlockedSlot.findOrCreate({
          where: { facultyId, date, time },
          defaults: { reason: reason || null },
        });
        res.json({ message: created ? "Time blocked." : "Already blocked.", block: row });
      } catch (e) {
        console.error("block error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    // Alias (some frontends call /faculty/block)
    app.post("/faculty/block", async (req, res) => {
      try {
        const { facultyId, date, time, reason } = req.body || {};
        if (!facultyId || !date || !time) {
          return res.status(400).json({ error: "facultyId, date, time are required." });
        }
        const [row, created] = await BlockedSlot.findOrCreate({
          where: { facultyId, date, time },
          defaults: { reason: reason || null },
        });
        res.json({ message: created ? "Time blocked." : "Already blocked.", block: row });
      } catch (e) {
        console.error("block (alias) error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    // List blocked (optional date filter)
    app.get("/faculty/blocks", async (req, res) => {
      try {
        const { facultyId, date } = req.query || {};
        if (!facultyId) return res.status(400).json({ error: "facultyId required" });

        const where = { facultyId };
        if (date) where.date = date;

        const rows = await BlockedSlot.findAll({
          where,
          order: [["date", "ASC"], ["time", "ASC"]],
        });
        res.json(rows);
      } catch (e) {
        console.error("blocks list error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    // Unblock
    app.delete("/faculty/blocks", async (req, res) => {
      try {
        const { facultyId, date, time } = req.body || {};
        if (!facultyId || !date || !time) {
          return res.status(400).json({ error: "facultyId, date, time are required." });
        }
        const n = await BlockedSlot.destroy({ where: { facultyId, date, time } });
        res.json({ message: n ? "Unblocked." : "Nothing to unblock." });
      } catch (e) {
        console.error("unblock error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    /* ============== QUEUE API (stubs) ============== */

    // Simple summary for the student booking page
    app.get("/queues/summary", async (req, res) => {
      try {
        const { category, facultyId } = req.query || {};
        const where = { status: "WAITING" };
        if (category) where.category = category;
        if (facultyId) where.facultyId = facultyId;

        const waiting = await Appointment.count({ where });
        const eta_minutes = waiting * SLOT_LENGTH_MIN;

        res.json({ queue: Array.from({ length: waiting }, (_, i) => ({ position: i + 1 })), eta_minutes });
      } catch (e) {
        console.error("queues/summary error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    // Queue position for a student
    app.get("/queue/status/:studentId", async (req, res) => {
      try {
        const { studentId } = req.params;
        const appts = await Appointment.findAll({ where: { studentId, status: "WAITING" } });
        if (!appts.length) return res.json({ department: null, waiting: 0 });

        const dept = appts[0].category || "—";
        const waiting = await Appointment.count({ where: { category: dept, status: "WAITING" } });
        res.json({ department: dept, waiting });
      } catch (e) {
        console.error("queue/status error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    /* ============== STAFF API (SF-US5/6) =========== */

    // Rich staff upcoming list with sorting / filtering / search
    // Query:
    //   from, to (YYYY-MM-DD); category, status, q; sortBy=date|time|category|createdAt; order=ASC|DESC; limit, offset
    app.get("/staff/appointments/upcoming", async (req, res) => {
      try {
        const {
          from,
          to,
          category,
          status,
          q,
          sortBy,
          order = "ASC",
          limit,
          offset,
        } = req.query || {};

        const where = {};
        // "Upcoming" by default = today forward
        if (from || to) {
          const range = {};
          if (from) range[Op.gte] = from;
          if (to)   range[Op.lte] = to;
          if (Object.keys(range).length) where.date = range;
        } else {
          const todayIso = new Date().toISOString().slice(0,10);
          where.date = { [Op.gte]: todayIso };
        }

        if (category && category !== "all") where.category = category;
        if (status && status !== "all") where.status = status;

        const include = [
          { model: User, as: "student", attributes: ["id", "name", "username"] },
          { model: User, as: "faculty", attributes: ["id", "name", "username"] },
        ];

        if (q && q.trim()) {
          const like = { [Op.like]: `%${q.trim()}%` };
          where[Op.or] = [
            { category: like },
            { "$student.name$": like },
            { "$student.username$": like },
            { "$faculty.name$": like },
            { "$faculty.username$": like },
          ];
        }

        const ORD = (order || "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";
        const sort = [];
        switch ((sortBy || "").toLowerCase()) {
          case "time":      sort.push(["time", ORD]); break;
          case "category":  sort.push(["category", ORD]); break;
          case "createdat": sort.push(["createdAt", ORD]); break;
          case "date": default:
            sort.push(["date", ORD], ["time", ORD]);
        }

        const rows = await Appointment.findAll({
          where,
          include,
          order: sort,
          ...(limit ? { limit: Number(limit) } : {}),
          ...(offset ? { offset: Number(offset) } : {}),
        });
res.json(rows.map(a => ({
  id: a.id,
  date: a.date,
  time: a.time,
  category: a.category,
  status: a.status,
  reason: a.reason || "",       // ✅ added
  notes: a.notes || "",         // ✅ added (optional, if faculty added notes)
  studentName: a.student?.name || a.student?.username || "Student",
  facultyName: a.faculty?.name || a.faculty?.username || "Advisor",
  transcriptUrl: a.transcriptPath ? `/attachments/${a.id}/transcript` : null,
  paymentProofUrl: a.paymentProofPath ? `/attachments/${a.id}/paymentProof` : null,
})));

      } catch (e) {
        console.error("GET /staff/appointments/upcoming error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    // Optional: keep simple overview but allow basic sorting
// Optional: keep simple overview but allow basic sorting
app.get("/staff/overview", async (req, res) => {
  try {
    const { sortBy, order = "ASC" } = req.query || {};
    const ORD = order.toUpperCase() === "DESC" ? "DESC" : "ASC";
    const baseSort =
      (sortBy || "").toLowerCase() === "createdat" ? [["createdAt", ORD]]
      : (sortBy || "").toLowerCase() === "time"     ? [["time", ORD]]
      : (sortBy || "").toLowerCase() === "category" ? [["category", ORD]]
      : [["date", ORD], ["time", ORD]];

    // ✅ Only include today's and future appointments
    const todayIso = new Date().toISOString().slice(0, 10);

    const appts = await Appointment.findAll({
      where: { date: { [Op.gte]: todayIso } },
      include: [
        { model: User, as: "student", attributes: ["id", "name", "username"] },
        { model: User, as: "faculty", attributes: ["id", "name", "username"] },
      ],
      order: baseSort,
    });

    // ✅ Serialize relevant fields for staff dashboard
    res.json(
      appts.map(a => ({
        id: a.id,
        date: a.date,
        time: a.time,
        category: a.category,
        status: a.status,
        reason: a.reason || "",  // ✅ now visible
        notes: a.notes || "",    // optional
        studentName: a.student?.name || a.student?.username || "Student",
        facultyName: a.faculty?.name || a.faculty?.username || "Advisor",
        transcript: a.transcriptPath ? `/attachments/${a.id}/transcript` : null,
        payment: a.paymentProofPath ? `/attachments/${a.id}/paymentProof` : null,
      }))
    );
  } catch (e) {
    console.error("staff/overview error:", e);
    res.status(500).json({ error: "Server error" });
  }
});


    // Appointment details (click to view)
    app.get("/appointments/:id", async (req, res) => {
      try {
        const a = await Appointment.findByPk(req.params.id, {
          include: [
            { model: User, as: "student", attributes: ["id", "name", "username"] },
            { model: User, as: "faculty", attributes: ["id", "name", "username"] },
          ],
        });
        if (!a) return res.status(404).json({ error: "Appointment not found" });

        res.json({
          id: a.id,
          date: a.date,
          time: a.time,
          category: a.category,
          status: a.status,
          createdAt: a.createdAt,
          student: a.student ? { id: a.student.id, name: a.student.name || a.student.username } : null,
          faculty: a.faculty ? { id: a.faculty.id, name: a.faculty.name || a.faculty.username } : null,
          transcriptUrl: a.transcriptPath ? `/attachments/${a.id}/transcript` : null,
          paymentProofUrl: a.paymentProofPath ? `/attachments/${a.id}/paymentProof` : null,
        });
      } catch (e) {
        console.error("GET /appointments/:id error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    // (Kept) staff inbox Recent list with attachment URLs
    app.get("/staff/inbox/:staffId", async (req, res) => {
      try {
        const appts = await Appointment.findAll({
          order: [["createdAt", "DESC"]],
          limit: 20,
          include: [
            { model: User, as: "student", attributes: ["id", "name", "username"] },
            { model: User, as: "faculty", attributes: ["id", "name", "username"] },
          ],
        });
        res.json(
          appts.map(a => ({
            id: a.id,
            studentName: a.student?.name || a.student?.username || "Student",
            facultyName: a.faculty?.name || a.faculty?.username || "Faculty",
            dateISO: a.date,
            timeLabel: a.time,
            category: a.category || a.reason || "",
            status: a.status || "WAITING",
            transcript: a.transcriptPath ? `/attachments/${a.id}/transcript` : null,
            payment: a.paymentProofPath ? `/attachments/${a.id}/paymentProof` : null,
          }))
        );
      } catch (e) {
        console.error("staff/inbox error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    /* ============== ATTACHMENTS ===================== */

    // field = transcript | paymentProof  (SF-US6)
    app.get("/attachments/:appointmentId/:field", async (req, res) => {
      try {
        const { appointmentId, field } = req.params;
        const appt = await Appointment.findByPk(appointmentId);
        if (!appt) return res.status(404).json({ error: "Appointment not found" });

        const map = { transcript: "transcriptPath", paymentProof: "paymentProofPath" };
        const col = map[field];
        if (!col) return res.status(400).json({ error: "Invalid field" });

        const filePath = appt[col];
        if (!filePath) return res.status(404).json({ error: "File not found" });

        res.sendFile(path.resolve(filePath));
      } catch (e) {
        console.error("attachments error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    /* ============== ANNOUNCEMENTS (optional) ======= */
    app.get("/announcements/latest", async (req, res) => {
      try {
        const ann = await Announcement.findOne({ order: [["createdAt", "DESC"]] });
        if (!ann) return res.json({ message: "No announcements" });
        res.json(ann);
      } catch (e) {
        console.error("announcements error:", e);
        res.status(500).json({ error: "Server error" });
      }
    });

    /* ============== START SERVER ==================== */
    const PORT = process.env.PORT || 3303;
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
})();
