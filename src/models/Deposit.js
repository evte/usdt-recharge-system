const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Deposit = sequelize.define('Deposit', {
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
  wallet_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'wallets', key: 'id' },
  },
  txid: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
  },
  amount: {
    type: DataTypes.DECIMAL(20, 6),
    allowNull: false,
  },
  chain_type: {
    type: DataTypes.ENUM('ERC20', 'TRC20'),
    allowNull: false,
  },
  from_address: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  block_number: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('confirmed', 'collected'),
    allowNull: false,
    defaultValue: 'confirmed',
  },
}, {
  tableName: 'deposits',
  timestamps: true,
  underscored: true,
});

module.exports = Deposit;
