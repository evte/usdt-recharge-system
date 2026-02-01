const sequelize = require('../config/database');
const User = require('./User');
const Wallet = require('./Wallet');
const Deposit = require('./Deposit');
const ScanState = require('./ScanState');

// User <-> Wallet associations
User.belongsTo(Wallet, { as: 'erc20Wallet', foreignKey: 'erc20_wallet_id' });
User.belongsTo(Wallet, { as: 'trc20Wallet', foreignKey: 'trc20_wallet_id' });
Wallet.belongsTo(User, { foreignKey: 'user_id' });
User.hasMany(Wallet, { foreignKey: 'user_id' });

// Deposit associations
Deposit.belongsTo(User, { foreignKey: 'user_id' });
Deposit.belongsTo(Wallet, { foreignKey: 'wallet_id' });
User.hasMany(Deposit, { foreignKey: 'user_id' });
Wallet.hasMany(Deposit, { foreignKey: 'wallet_id' });

module.exports = {
  sequelize,
  User,
  Wallet,
  Deposit,
  ScanState,
};
