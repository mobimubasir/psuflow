// models/BlockedSlot.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const { User } = require("./User");

const BlockedSlot = sequelize.define(
  "BlockedSlot",
  {
    facultyId: { type: DataTypes.INTEGER, allowNull: false },
    date:      { type: DataTypes.STRING,  allowNull: false }, // YYYY-MM-DD
    time:      { type: DataTypes.STRING,  allowNull: false }, // "12:15 PM"
    reason:    { type: DataTypes.STRING,  allowNull: true  },
  },
  {
    tableName: "BlockedSlots",
    indexes: [{ unique: true, fields: ["facultyId", "date", "time"] }],
  }
);

// (optional) association
User.hasMany(BlockedSlot, {
  foreignKey: { name: "facultyId", allowNull: false },
  as: "blockedSlots",
  onDelete: "CASCADE",
});
BlockedSlot.belongsTo(User, {
  foreignKey: { name: "facultyId", allowNull: false },
  as: "faculty",
  onDelete: "CASCADE",
});

module.exports = { BlockedSlot };
