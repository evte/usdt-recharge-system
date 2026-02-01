import React, { useEffect, useState } from 'react';
import { Card, Col, Row, Statistic, Table, Tag, Spin } from 'antd';
import { UserOutlined, TransactionOutlined, DollarOutlined, ClockCircleOutlined } from '@ant-design/icons';
import api from '../api';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const { data: res } = await api.get('/admin/dashboard');
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 30000);
    return () => clearInterval(timer);
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', marginTop: 100 }} />;

  const { stats, recentDeposits, scanState } = data;

  const depositColumns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '用户', dataIndex: ['User', 'username'], width: 100 },
    { title: '金额', dataIndex: 'amount', width: 120, render: (v) => `${v} USDT` },
    {
      title: '链',
      dataIndex: 'chain_type',
      width: 80,
      render: (v) => <Tag color={v === 'TRC20' ? 'red' : 'blue'}>{v}</Tag>,
    },
    { title: 'TxID', dataIndex: 'txid', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (v) => <Tag color={v === 'collected' ? 'green' : 'orange'}>{v === 'collected' ? '已归集' : '待归集'}</Tag>,
    },
    { title: '时间', dataIndex: 'created_at', width: 170, render: (v) => new Date(v).toLocaleString('zh-CN') },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title="总用户数" value={stats.totalUsers} prefix={<UserOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="充值笔数" value={stats.totalDeposits} prefix={<TransactionOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="总余额 (USDT)" value={stats.totalBalance} precision={2} prefix={<DollarOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="待归集" value={stats.pendingCollection} prefix={<ClockCircleOutlined />} />
          </Card>
        </Col>
      </Row>

      <Card title="扫块状态" style={{ marginBottom: 24 }} size="small">
        <Row gutter={16}>
          {scanState.map((s) => (
            <Col span={12} key={s.chain_type}>
              <Statistic
                title={`${s.chain_type} 最新扫描区块`}
                value={Number(s.last_block)}
                groupSeparator=","
              />
              <div style={{ color: '#999', fontSize: 12 }}>
                更新于: {new Date(s.updated_at).toLocaleString('zh-CN')}
              </div>
            </Col>
          ))}
        </Row>
      </Card>

      <Card title="最近充值" size="small">
        <Table
          columns={depositColumns}
          dataSource={recentDeposits}
          rowKey="id"
          pagination={false}
          size="small"
        />
      </Card>
    </div>
  );
}
