import React, { useEffect, useState } from 'react';
import { Table, Tag, Select, Space } from 'antd';
import api from '../api';

export default function Deposits() {
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});

  const fetchData = async (p = page, f = filters) => {
    setLoading(true);
    try {
      const params = { page: p, pageSize: 20, ...f };
      // Remove empty params
      Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
      const { data: res } = await api.get('/admin/deposits', { params });
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleFilter = (key, value) => {
    const newFilters = { ...filters, [key]: value || undefined };
    setFilters(newFilters);
    setPage(1);
    fetchData(1, newFilters);
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '用户', dataIndex: ['User', 'username'], width: 100 },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 140,
      render: (v, r) => <span style={{ fontWeight: 'bold', color: '#52c41a' }}>{v} {r.token_type || 'USDT'}</span>,
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
    { title: '来源地址', dataIndex: 'from_address', ellipsis: true },
    {
      title: '收款地址',
      dataIndex: ['Wallet', 'address'],
      ellipsis: true,
    },
    { title: '区块', dataIndex: 'block_number', width: 110, render: (v) => Number(v).toLocaleString() },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v) => <Tag color={v === 'collected' ? 'green' : 'orange'}>{v === 'collected' ? '已归集' : '待归集'}</Tag>,
    },
    { title: '时间', dataIndex: 'created_at', width: 170, render: (v) => new Date(v).toLocaleString('zh-CN') },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Select
          placeholder="币种"
          allowClear
          style={{ width: 120 }}
          onChange={(v) => handleFilter('token_type', v)}
          options={[
            { value: 'USDT', label: 'USDT' },
            { value: 'USDC', label: 'USDC' },
          ]}
        />
        <Select
          placeholder="链类型"
          allowClear
          style={{ width: 120 }}
          onChange={(v) => handleFilter('chain_type', v)}
          options={[
            { value: 'ERC20', label: 'ERC20' },
            { value: 'TRC20', label: 'TRC20' },
          ]}
        />
        <Select
          placeholder="状态"
          allowClear
          style={{ width: 120 }}
          onChange={(v) => handleFilter('status', v)}
          options={[
            { value: 'confirmed', label: '待归集' },
            { value: 'collected', label: '已归集' },
          ]}
        />
      </Space>

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
        scroll={{ x: 1200 }}
      />
    </div>
  );
}
