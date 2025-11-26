// models/Notification.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const Notification = sequelize.define("Notification", {
  id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  toUserId:  { type: DataTypes.INTEGER, allowNull: false },
  title:     { type: DataTypes.STRING,  allowNull: false },
  body:      { type: DataTypes.TEXT,    allowNull: false },
  read:      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  tableName: "Notifications",
  indexes: [{ fields: ["toUserId", "read"] }],
});

module.exports = { Notification };
