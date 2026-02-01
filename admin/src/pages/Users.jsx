import React, { useEffect, useState } from 'react';
import { Table, Input, Tag, Modal, Descriptions, InputNumber, Button, message, Space } from 'antd';
import api from '../api';

export default function Users() {
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const [balanceModal, setBalanceModal] = useState(null);
  const [adjustAmount, setAdjustAmount] = useState(0);

  const fetchData = async (p = page, s = search) => {
    setLoading(true);
    try {
      const { data: res } = await api.get('/admin/users', { params: { page: p, pageSize: 20, search: s } });
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSearch = (value) => {
    setSearch(value);
    setPage(1);
    fetchData(1, value);
  };

  const handleAdjustBalance = async () => {
    if (!adjustAmount) return;
    try {
      await api.put(`/admin/users/${balanceModal.id}/balance`, { amount: adjustAmount });
      message.success('余额调整成功');
      setBalanceModal(null);
      setAdjustAmount(0);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '用户名', dataIndex: 'username', width: 120 },
    {
      title: '余额 (USDT)',
      dataIndex: 'balance',
      width: 130,
      render: (v) => <span style={{ fontWeight: 'bold' }}>{v}</span>,
    },
    {
      title: 'ERC20 地址',
      dataIndex: ['erc20Wallet', 'address'],
      ellipsis: true,
      render: (v) => v || <Tag>未生成</Tag>,
    },
    {
      title: 'TRC20 地址',
      dataIndex: ['trc20Wallet', 'address'],
      ellipsis: true,
      render: (v) => v || <Tag>未生成</Tag>,
    },
    {
      title: '角色',
      dataIndex: 'is_admin',
      width: 80,
      render: (v) => v ? <Tag color="red">管理员</Tag> : <Tag>用户</Tag>,
    },
    { title: '注册时间', dataIndex: 'created_at', width: 170, render: (v) => new Date(v).toLocaleString('zh-CN') },
    {
      title: '操作',
      width: 150,
      render: (_, record) => (
        <Space>
          <a onClick={() => setDetail(record)}>详情</a>
          <a onClick={() => { setBalanceModal(record); setAdjustAmount(0); }}>调余额</a>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="搜索用户名"
          allowClear
          onSearch={handleSearch}
          style={{ width: 300 }}
        />
      </div>

      <Table
        columns={columns}
        dataSource={data.rows}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          total: data.total,
          pageSize: 20,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p) => { setPage(p); fetchData(p); },
        }}
        size="small"
      />

      <Modal
        title="用户详情"
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={600}
      >
        {detail && (
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="ID">{detail.id}</Descriptions.Item>
            <Descriptions.Item label="用户名">{detail.username}</Descriptions.Item>
            <Descriptions.Item label="余额">{detail.balance} USDT</Descriptions.Item>
            <Descriptions.Item label="ERC20 地址">{detail.erc20Wallet?.address || '未生成'}</Descriptions.Item>
            <Descriptions.Item label="TRC20 地址">{detail.trc20Wallet?.address || '未生成'}</Descriptions.Item>
            <Descriptions.Item label="注册时间">{new Date(detail.created_at).toLocaleString('zh-CN')}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <Modal
        title={`调整余额 - ${balanceModal?.username}`}
        open={!!balanceModal}
        onOk={handleAdjustBalance}
        onCancel={() => setBalanceModal(null)}
        okText="确认"
        cancelText="取消"
      >
        <p>当前余额: {balanceModal?.balance} USDT</p>
        <InputNumber
          style={{ width: '100%' }}
          placeholder="输入调整金额（正数增加，负数减少）"
          value={adjustAmount}
          onChange={setAdjustAmount}
          step={0.01}
        />
      </Modal>
    </div>
  );
}
