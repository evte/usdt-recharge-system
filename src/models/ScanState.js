const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ScanState = sequelize.define('ScanState', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  chain_type: {
    type: DataTypes.ENUM('ERC20', 'TRC20'),
    allowNull: false,
    unique: true,
  },
  last_block: {
    type: DataTypes.BIGINT,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'scan_state',
  timestamps: true,
  underscored: true,
});

module.exports = ScanState;
