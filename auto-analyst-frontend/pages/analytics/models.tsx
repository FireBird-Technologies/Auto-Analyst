import { useState, useEffect } from 'react';
import Head from 'next/head';
import AnalyticsLayout from '@/components/analytics/AnalyticsLayout';
import { 
  BarChart as RechartsBarChart, Bar, PieChart as RechartsPieChart, Pie, Cell,
  LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, Legend, ResponsiveContainer 
} from 'recharts';

// Styling consistent with the dashboard
const styles = {
  container: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8',
  header: 'text-2xl font-bold text-gray-800 mb-6',
  sectionTitle: 'text-xl font-semibold text-gray-700 mb-3',
  card: 'bg-white rounded-lg shadow-md overflow-hidden mb-8',
  cardHeader: 'bg-blue-50 px-4 py-3 border-b border-gray-200',
  cardTitle: 'text-lg font-medium text-gray-800',
  cardBody: 'p-6',
  chartContainer: 'h-80',
  table: 'min-w-full divide-y divide-gray-200',
  tableHeader: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider',
  tableRow: 'bg-white even:bg-gray-50',
  tableCell: 'px-6 py-4 whitespace-nowrap text-sm text-gray-500',
  loading: 'flex justify-center items-center h-64 text-gray-500',
  error: 'bg-red-50 text-red-600 p-4 rounded-md mb-4',
  statsGrid: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8',
  statCard: 'bg-white rounded-lg shadow-sm p-6',
  statNumber: 'text-2xl font-bold text-[#FF7F7F]',
  statLabel: 'text-sm text-gray-500',
};

// Color palette for charts
const COLORS = ['#FF7F7F', '#FF6666', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

export default function ModelUsagePage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modelData, setModelData] = useState<any[]>([]);
  const [modelHistory, setModelHistory] = useState<any[]>([]);
  const [modelMetrics, setModelMetrics] = useState<any[]>([]);

  useEffect(() => {
    fetchModelData();
  }, []);

  const fetchModelData = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const adminKey = localStorage.getItem('adminApiKey');
      if (!adminKey) {
        setError('Admin API key not found. Please authenticate from the main dashboard.');
        setIsLoading(false);
        return;
      }
      
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      
      // Fetch model usage breakdown
      const modelRes = await fetch(`${API_BASE_URL}/analytics/usage/models`, { 
        headers: { 'X-Admin-API-Key': adminKey }
      });
      
      if (!modelRes.ok) {
        throw new Error(`Failed to fetch model data: ${modelRes.status}`);
      }
      
      const modelData = await modelRes.json();
      setModelData(modelData.model_usage || []);
      
      // Fetch model history (simulated - this endpoint may need to be implemented)
      // This would typically show model usage over time
      const historyRes = await fetch(`${API_BASE_URL}/analytics/daily`, { 
        headers: { 'X-Admin-API-Key': adminKey }
      });
      
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        setModelHistory(historyData.daily_usage || []);
      }
      
      // Simulated model metrics data - replace with actual API call when available
      setModelMetrics([
        { name: 'gpt-3.5-turbo', avg_tokens: 1250, avg_response_time: 1.5, success_rate: 0.99 },
        { name: 'gpt-4', avg_tokens: 2800, avg_response_time: 3.2, success_rate: 0.98 },
        { name: 'claude-instant', avg_tokens: 1500, avg_response_time: 1.8, success_rate: 0.97 },
        { name: 'claude-3-opus', avg_tokens: 2900, avg_response_time: 2.7, success_rate: 0.99 },
      ]);
      
    } catch (err: any) {
      console.error('Error loading model data:', err);
      setError(err.message || 'Failed to load model usage data');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnalyticsLayout title="Model Usage Analytics">
      <div className={styles.container}>
        <h1 className={styles.header}>Model Usage Analytics</h1>
        
        {error && (
          <div className={styles.error}>{error}</div>
        )}
        
        {isLoading ? (
          <div className={styles.loading}>Loading model usage data...</div>
        ) : (
          <>
            {/* Model Usage Distribution */}
            <h2 className={styles.sectionTitle}>Model Distribution</h2>
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Token Usage by Model</h3>
              </div>
              <div className={styles.cardBody}>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Pie Chart */}
                  <div className={styles.chartContainer}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPieChart>
                        <Pie
                          data={modelData}
                          dataKey="tokens"
                          nameKey="model_name"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          fill="#8884d8"
                          label={({model_name, percent}) => `${model_name}: ${(percent * 100).toFixed(0)}%`}
                        >
                          {modelData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value, name, props) => [value.toLocaleString(), 'Tokens']}
                        />
                        <Legend />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  </div>
                  
                  {/* Cost Distribution */}
                  <div className={styles.chartContainer}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPieChart>
                        <Pie
                          data={modelData}
                          dataKey="cost"
                          nameKey="model_name"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          fill="#8884d8"
                          label={({model_name, percent}) => `${model_name}: ${(percent * 100).toFixed(0)}%`}
                        >
                          {modelData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value, name, props) => [`$${Number(value).toFixed(4)}`, 'Cost']}
                        />
                        <Legend />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Model Usage Table */}
            <h2 className={styles.sectionTitle}>Detailed Usage</h2>
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Model Usage Details</h3>
              </div>
              <div className={styles.cardBody}>
                <div className="overflow-x-auto">
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.tableHeader}>Model</th>
                        <th className={styles.tableHeader}>Tokens</th>
                        <th className={styles.tableHeader}>Requests</th>
                        <th className={styles.tableHeader}>Cost</th>
                        <th className={styles.tableHeader}>Avg. Cost per 1K Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelData.map((model, index) => (
                        <tr key={index} className={styles.tableRow}>
                          <td className={styles.tableCell}>{model.model_name}</td>
                          <td className={styles.tableCell}>{model.tokens.toLocaleString()}</td>
                          <td className={styles.tableCell}>{model.requests.toLocaleString()}</td>
                          <td className={styles.tableCell}>${model.cost.toFixed(4)}</td>
                          <td className={styles.tableCell}>
                            ${((model.cost / model.tokens) * 1000).toFixed(4)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            
            {/* Model Performance Metrics */}
            <h2 className={styles.sectionTitle}>Model Performance</h2>
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Performance Metrics</h3>
              </div>
              <div className={styles.cardBody}>
                <div className="overflow-x-auto">
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.tableHeader}>Model</th>
                        <th className={styles.tableHeader}>Avg. Tokens per Request</th>
                        <th className={styles.tableHeader}>Avg. Response Time (sec)</th>
                        <th className={styles.tableHeader}>Success Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelMetrics.map((model, index) => (
                        <tr key={index} className={styles.tableRow}>
                          <td className={styles.tableCell}>{model.name}</td>
                          <td className={styles.tableCell}>{model.avg_tokens.toLocaleString()}</td>
                          <td className={styles.tableCell}>{model.avg_response_time.toFixed(2)}</td>
                          <td className={styles.tableCell}>{(model.success_rate * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AnalyticsLayout>
  );
} 