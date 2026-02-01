import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Statistic, Table, Tag, Button, Typography, Space, Spin, message } from 'antd';
import { WalletOutlined, DollarOutlined, CopyOutlined, LogoutOutlined, ReloadOutlined } from '@ant-design/icons';
import api from '../api';

const { Text, Title } = Typography;

export default function Dashboard() {
  const navigate = useNavigate();
  const [userInfo, setUserInfo] = useState(null);
  const [deposits, setDeposits] = useState([]);
  const [addresses, setAddresses] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rechargeLoading, setRechargeLoading] = useState(false);

  const fetchData = async () => {
    try {
      const [infoRes, depositsRes] = await Promise.all([
        api.get('/user/info'),
        api.get('/user/deposits'),
      ]);
      setUserInfo(infoRes.data.user);
      setDeposits(depositsRes.data.deposits);

      // If wallets exist, show addresses
      if (infoRes.data.user.erc20Wallet || infoRes.data.user.trc20Wallet) {
        setAddresses({
          erc20: infoRes.data.user.erc20Wallet?.address,
          trc20: infoRes.data.user.trc20Wallet?.address,
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleRecharge = async () => {
    setRechargeLoading(true);
    try {
      const { data } = await api.post('/user/recharge');
      setAddresses({ erc20: data.erc20_address, trc20: data.trc20_address });
      message.success('充值地址已生成');
      fetchData();
    } catch (err) {
      message.error('获取充值地址失败');
    } finally {
      setRechargeLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('user_token');
    navigate('/login');
  };

  const copyText = (text) => {
    navigator.clipboard.writeText(text);
    message.success('已复制到剪贴板');
  };

  const depositColumns = [
    { title: '金额', dataIndex: 'amount', width: 120, render: (v) => <span style={{ fontWeight: 'bold', color: '#52c41a' }}>{v} USDT</span> },
    { title: '链', dataIndex: 'chain_type', width: 80, render: (v) => <Tag color={v === 'TRC20' ? 'red' : 'blue'}>{v}</Tag> },
    { title: 'TxID', dataIndex: 'txid', ellipsis: true, render: (v) => <Text copyable={{ text: v }}>{v.slice(0, 16)}...</Text> },
    { title: '状态', dataIndex: 'status', width: 80, render: (v) => <Tag color={v === 'collected' ? 'green' : 'orange'}>{v === 'collected' ? '已确认' : '确认中'}</Tag> },
    { title: '时间', dataIndex: 'created_at', width: 170, render: (v) => new Date(v).toLocaleString('zh-CN') },
  ];

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 200 }}><Spin size="large" /></div>;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>USDT 充值系统</Title>
        <Space>
          <Text type="secondary">{userInfo?.username}</Text>
          <Button icon={<LogoutOutlined />} onClick={handleLogout}>退出</Button>
        </Space>
      </div>

      {/* Balance */}
      <Card style={{ marginBottom: 24 }}>
        <Statistic
          title="账户余额"
          value={userInfo?.balance || 0}
          precision={6}
          suffix="USDT"
          prefix={<DollarOutlined />}
          valueStyle={{ color: '#1677ff', fontSize: 32 }}
        />
      </Card>

      {/* Deposit Addresses */}
      <Card
        title={<span><WalletOutlined /> 充值地址</span>}
        style={{ marginBottom: 24 }}
        extra={
          !addresses ? (
            <Button type="primary" onClick={handleRecharge} loading={rechargeLoading}>
              获取充值地址
            </Button>
          ) : (
            <Button icon={<ReloadOutlined />} onClick={fetchData} size="small">刷新</Button>
          )
        }
      >
        {addresses ? (
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Card size="small" title={<Tag color="red">TRC20 (TRON)</Tag>} type="inner">
                <div style={{ wordBreak: 'break-all', fontSize: 13, fontFamily: 'monospace', marginBottom: 8 }}>
                  {addresses.trc20}
                </div>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => copyText(addresses.trc20)}
                >
                  复制地址
                </Button>
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card size="small" title={<Tag color="blue">ERC20 (Ethereum)</Tag>} type="inner">
                <div style={{ wordBreak: 'break-all', fontSize: 13, fontFamily: 'monospace', marginBottom: 8 }}>
                  {addresses.erc20}
                </div>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => copyText(addresses.erc20)}
                >
                  复制地址
                </Button>
              </Card>
            </Col>
          </Row>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px 0', color: '#999' }}>
            点击上方按钮生成专属充值地址
          </div>
        )}
      </Card>

      {/* Deposit History */}
      <Card title="充值记录">
        <Table
          columns={depositColumns}
          dataSource={deposits}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
          locale={{ emptyText: '暂无充值记录' }}
          scroll={{ x: 600 }}
        />
      </Card>
    </div>
  );
}
