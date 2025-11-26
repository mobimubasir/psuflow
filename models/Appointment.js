// models/Appointment.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const { User } = require("./User");

/**
 * Appointment Model — PSUFlow
 * Sprint 2–3 unified version with approval/rejection fields.
 */

const Appointment = sequelize.define(
  "Appointment",
  {
    // ---------------- Foreign Keys ----------------
    studentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
    facultyId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },

    // ---------------- Core Fields -----------------
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false, // YYYY-MM-DD
    },
    time: {
      type: DataTypes.STRING,
      allowNull: false, // e.g. "12:15 PM"
    },

    // ---------------- Booking Meta ----------------
    category: {
      type: DataTypes.STRING,
      allowNull: true, // advising, registration, financial, etc.
    },

    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: "",
    },

    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "WAITING",
      validate: {
        isIn: [[
          "WAITING",
          "APPROVED",   // NEW
          "REJECTED",   // NEW
          "CONFIRMED",
          "IN_PROGRESS",
          "COMPLETED",
          "CANCELED",
          "RESCHEDULED",
          "BLOCKED",
        ]],
      },
    },

    // ---------------- Files -----------------------
    transcriptPath: { type: DataTypes.STRING, allowNull: true },
    paymentProofPath: { type: DataTypes.STRING, allowNull: true },

    // ---------------- Notes -----------------------
    notes: { type: DataTypes.TEXT, allowNull: true, defaultValue: "" },

    // ---------------- Decision Meta (NEW) ---------
    decidedById: { type: DataTypes.INTEGER, allowNull: true },
    decidedAt:   { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: "Appointments",
    indexes: [
      { fields: ["facultyId", "date", "time"] },
      { fields: ["studentId", "date"] },
      { fields: ["status"] },
      { fields: ["category"] },
    ],
  }
);

// ---------------- Associations ----------------

User.hasMany(Appointment, {
  foreignKey: { name: "studentId", allowNull: false },
  as: "studentAppointments",
  onDelete: "CASCADE",
});

User.hasMany(Appointment, {
  foreignKey: { name: "facultyId", allowNull: false },
  as: "facultyAppointments",
  onDelete: "CASCADE",
});

Appointment.belongsTo(User, {
  foreignKey: { name: "studentId", allowNull: false },
  as: "student",
  onDelete: "CASCADE",
});
Appointment.belongsTo(User, {
  foreignKey: { name: "facultyId", allowNull: false },
  as: "faculty",
  onDelete: "CASCADE",
});

module.exports = { Appointment };
