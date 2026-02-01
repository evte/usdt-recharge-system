import React, { useEffect, useState } from 'react';
import { Table, Tag, message, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import api from '../api';

const { Text } = Typography;

export default function Wallets() {
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const fetchData = async (p = page) => {
    setLoading(true);
    try {
      const { data: res } = await api.get('/admin/wallets', { params: { page: p, pageSize: 20 } });
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const copyAddress = (addr) => {
    navigator.clipboard.writeText(addr);
    message.success('已复制');
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '用户', dataIndex: ['User', 'username'], width: 100 },
    {
      title: '地址',
      dataIndex: 'address',
      render: (v) => (
        <Text copyable={{ text: v, icon: <CopyOutlined /> }} ellipsis style={{ maxWidth: 400 }}>
          {v}
        </Text>
      ),
    },
    {
      title: '链类型',
      dataIndex: 'chain_type',
      width: 100,
      render: (v) => <Tag color={v === 'TRC20' ? 'red' : 'blue'}>{v}</Tag>,
    },
    { title: '创建时间', dataIndex: 'created_at', width: 170, render: (v) => new Date(v).toLocaleString('zh-CN') },
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
    />
  );
}
