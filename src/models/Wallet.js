const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Wallet = sequelize.define('Wallet', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  address: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
  },
  encrypted_private_key: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  chain_type: {
    type: DataTypes.ENUM('ERC20', 'TRC20'),
    allowNull: false,
  },
}, {
  tableName: 'wallets',
  timestamps: true,
  underscored: true,
});

module.exports = Wallet;
