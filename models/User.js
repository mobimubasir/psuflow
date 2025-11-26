// models/User.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const User = sequelize.define(
  "User",
  {
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    name:     { type: DataTypes.STRING },
    password: { type: DataTypes.STRING, allowNull: false },
    role:     { type: DataTypes.STRING, allowNull: false }, // student|faculty|staff|admin
    staffCategory: { type: DataTypes.STRING, allowNull: true }, // e.g. Registration, Accounting, Advising
  },

  { 
    tableName: "Users",
    indexes: [
      { fields: ["username"], unique: true },
      { fields: ["role"] },
      { fields: ["staffCategory"] },
    ],
  }
);

module.exports = { User };
