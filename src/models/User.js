const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  username: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  password_hash: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  erc20_wallet_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null,
  },
  trc20_wallet_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null,
  },
  balance: {
    type: DataTypes.DECIMAL(20, 6),
    allowNull: false,
    defaultValue: 0,
  },
  is_admin: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
}, {
  tableName: 'users',
  timestamps: true,
  underscored: true,
});

module.exports = User;
