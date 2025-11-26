// models/Announcement.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const Announcement = sequelize.define(
  "Announcement",
  {
    message: { 
      type: DataTypes.STRING, 
      allowNull: false 
    },
    active: { 
      type: DataTypes.BOOLEAN, 
      defaultValue: true 
    },
  },
  { 
    tableName: "Announcements",
    timestamps: true, // includes createdAt, updatedAt
  }
);

module.exports = { Announcement };
