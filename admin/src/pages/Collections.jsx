import React, { useEffect, useState } from 'react';
import { Table, Tag } from 'antd';
import api from '../api';

export default function Collections() {
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const fetchData = async (p = page) => {
    setLoading(true);
    try {
      const { data: res } = await api.get('/admin/collections', { params: { page: p, pageSize: 20 } });
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '用户', dataIndex: ['User', 'username'], width: 100 },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 140,
      render: (v, r) => <span style={{ fontWeight: 'bold' }}>{v} {r.token_type || 'USDT'}</span>,
    },
    {
      title: '币种',
      dataIndex: 'token_type',
      width: 80,
      render: (v) => <Tag color={v === 'USDC' ? 'cyan' : 'green'}>{v || 'USDT'}</Tag>,
    },
    {
      title: '链',
      dataIndex: 'chain_type',
      width: 90,
      render: (v) => <Tag color={v === 'TRC20' ? 'red' : 'blue'}>{v}</Tag>,
    },
    { title: 'TxID', dataIndex: 'txid', ellipsis: true },
    {
      title: '收款地址',
      dataIndex: ['Wallet', 'address'],
      ellipsis: true,
    },
    {
      title: '状态',
      width: 90,
      render: () => <Tag color="green">已归集</Tag>,
    },
    { title: '归集时间', dataIndex: 'updated_at', width: 170, render: (v) => new Date(v).toLocaleString('zh-CN') },
  ];

  return (
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
      scroll={{ x: 1000 }}
    />
  );
}
