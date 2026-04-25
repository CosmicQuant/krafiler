import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, LogOut, Download, CheckCircle, Clock } from 'lucide-react';
import TaxModuleForm from './TaxModuleForm';

export default function IndividualDashboard() {
  const navigate = useNavigate();
  const [activeModule, setActiveModule] = useState<string | null>(null);

  if (activeModule) {
    return (
      <div className="p-8 bg-gray-50 min-h-screen">
        <button onClick={() => setActiveModule(null)} className="mb-6 text-blue-600 hover:underline font-medium">
          &larr; Back to Dashboard
        </button>
        <TaxModuleForm taxType={activeModule} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 py-4 px-8 flex justify-between items-center">
        <div className="text-xl font-bold tracking-tight text-blue-600">KRA Filer <span className="text-slate-800 text-sm font-normal">Individual</span></div>
        <div className="flex items-center gap-4">
          <span className="text-sm border bg-slate-100 px-3 py-1 rounded-full font-mono text-slate-600">PIN: A000123456Z</span>
          <button onClick={() => navigate('/')} className="text-gray-500 hover:text-red-500 flex items-center gap-2 text-sm">
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto p-8">
        <h1 className="text-3xl font-bold mb-8">Welcome back, John!</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {[
            { id: 'vat', title: 'VAT Return', color: 'blue' },
            { id: 'tot', title: 'Turnover Tax (TOT)', color: 'green' },
            { id: 'mri', title: 'Rental Income (MRI)', color: 'orange' },
            { id: 'dst', title: 'Digital Service (DST)', color: 'purple' },
            { id: 'nssf', title: 'NSSF Filing', color: 'teal' },
            { id: 'sha', title: 'SHA Filing', color: 'rose' },
            { id: 'elevy', title: 'E-Levy (Tourism Fund)', color: 'indigo' },
          ].map(module => (
            <div key={module.id} onClick={() => setActiveModule(module.id)} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 cursor-pointer hover:shadow-md transition-shadow group">
              <h3 className="text-lg font-semibold mb-2 group-hover:text-blue-600">{module.title}</h3>
              <p className="text-sm text-gray-500 mb-4">File your monthly {module.id.toUpperCase()} return securely.</p>
              <span className="text-blue-600 text-sm font-medium">Start Filing &rarr;</span>
            </div>
          ))}
        </div>

        <h2 className="text-2xl font-bold mb-4">Recent Filings</h2>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="p-4 font-semibold text-gray-600">Type</th>
                <th className="p-4 font-semibold text-gray-600">Period</th>
                <th className="p-4 font-semibold text-gray-600">Status</th>
                <th className="p-4 font-semibold text-gray-600">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr className="hover:bg-gray-50">
                <td className="p-4 font-medium">VAT</td>
                <td className="p-4 text-gray-600">March 2026</td>
                <td className="p-4"><span className="flex items-center gap-1 text-green-600 text-sm"><CheckCircle size={14} /> Filed</span></td>
                <td className="p-4"><button className="text-blue-600 flex items-center gap-1 text-sm"><Download size={14} /> PDF</button></td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="p-4 font-medium">TOT</td>
                <td className="p-4 text-gray-600">March 2026</td>
                <td className="p-4"><span className="flex items-center gap-1 text-orange-500 text-sm"><Clock size={14} /> Pending</span></td>
                <td className="p-4"><span className="text-gray-400 text-sm">Unavailable</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}