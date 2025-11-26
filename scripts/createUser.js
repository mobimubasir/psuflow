// scripts/createUser.js
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { sequelize, connectToDB } = require("../config/database");
const { User } = require("../models/User");

const RESET_EXISTING = process.argv.includes("--reset"); // optional: node scripts/createUser.js --reset

// simple helper just to hide plain passwords in console
const mask = (s = "") => s.replace(/./g, "*").slice(0, 6);

/**
 * Staff seeding:
 *  Add/adjust categories here anytime. (SF-US7)
 *  Examples: "Registration", "Accounting", "Advising"
 */
const staffSeed = [
  { username: "MsMona", name: "Ms. Mona", role: "staff", password: "mona@123", staffCategory: "Registration" },
  { username: "MsSara", name: "Ms. Sara", role: "staff", password: "sara@123", staffCategory: "Accounting"  },
  { username: "MsMaha", name: "Ms. Maha", role: "staff", password: "maha@123", staffCategory: "Advising"    },
];

/**
 * Faculty seeding with categories (one per PSUFlow category)
 *  - Academic Advising
 *  - Registration
 *  - Financial Affairs
 *  - Senior Project
 */
const facultySeed = [
  { username: "Dr.Reem",   name: "Dr. Reem",    role: "faculty", password: "reem@222",  category: "Academic Advising" },
  { username: "Dr.Suad",   name: "Dr. Suad",    role: "faculty", password: "suadr@123", category: "Registration" },
  { username: "Dr.Basmah", name: "Dr. Basmah",  role: "faculty", password: "basmah@33", category: "Financial Affairs" },
  // Added to cover all four categories:
  { username: "Dr.Noura",  name: "Dr. Noura",   role: "faculty", password: "noura@44",  category: "Senior Project" },
];

const studentSeed = [
  { username: "sarah_alduhaim",  name: "Sarah Alduhaim",  role: "student", password: "sara@23"  },
  { username: "raghad_alamirah", name: "Raghad Alamirah", role: "student", password: "rghd@23"  },
  { username: "dana_ahmad",      name: "Danah Ahmad",     role: "student", password: "dana@22"  },
  { username: "haifa",           name: "Haifa",           role: "student", password: "haifa@111"},
  { username: "angie_alkanani",  name: "Angie",           role: "student", password: "angie@99" },
  { username: "dalal",           name: "Dalal",           role: "student", password: "dalal@22" },
];


const seedUsers = [...studentSeed, ...facultySeed, ...staffSeed];

(async () => {
  try {
    await connectToDB();
    // If your DB is missing new columns (e.g., staffCategory or category), run once with alter in DEV:
    // await sequelize.sync({ alter: true });
    await sequelize.sync();

    for (const u of seedUsers) {
      const existing = await User.findOne({ where: { username: u.username } });
      const hashed = await bcrypt.hash(u.password, 10);

      if (existing) {
        if (RESET_EXISTING) {
          // update all mutable fields; keep username fixed
          const updatePayload = {
            name: u.name,
            role: u.role,
            password: hashed,
          };
          if (u.role === "staff") {
            updatePayload.staffCategory = u.staffCategory || null;
          }
          if (u.role === "faculty") {
            updatePayload.category = u.category || null; // <-- ensure faculty category is stored
          }

          await existing.update(updatePayload);
          console.log(
            `Updated ${u.role}: ${u.username} / new password: ${mask(u.password)} / ` +
            `category: ${updatePayload.category ?? "-"} / staffCategory: ${updatePayload.staffCategory ?? "-"}`
          );
        } else {
          console.log(`Skipped (already exists): ${u.username}`);
        }
        continue;
      }

      const createPayload = {
        username: u.username,
        name: u.name,
        role: u.role,
        password: hashed,
      };
      if (u.role === "staff") {
        createPayload.staffCategory = u.staffCategory || null;
      }
      if (u.role === "faculty") {
        createPayload.category = u.category || null; // <-- set on create
      }

      await User.create(createPayload);
      console.log(
        `Created ${u.role}: ${u.username} / password: ${mask(u.password)} / ` +
        `category: ${createPayload.category ?? "-"} / staffCategory: ${createPayload.staffCategory ?? "-"}`
      );
    }

    console.log("Seeding complete.");
    process.exit(0);
  } catch (e) {
    console.error("Error seeding users:", e);
    process.exit(1);
  }
})();
