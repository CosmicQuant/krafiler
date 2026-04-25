import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, Users, FileText, Settings, UploadCloud, LogOut, CheckCircle, PieChart, Activity } from 'lucide-react';

export default function AccountantDashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');

  const clients = [
    { id: 1, name: 'Acme Corp', pin: 'P000123456A', status: 'Active', vat: 'Filed', mri: 'Pending' },
    { id: 2, name: 'TechLabs Inc', pin: 'P000987654B', status: 'Active', vat: 'Pending', mri: 'Filed' },
  ];

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col">
        <div className="p-6 text-2xl font-bold tracking-tight text-blue-400">KRA Filer <span className="text-white text-sm">PRO</span></div>
        <nav className="flex-1 px-4 space-y-2">
          <button onClick={() => setActiveTab('overview')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg ${activeTab === 'overview' ? 'bg-blue-600' : 'hover:bg-slate-800'}`}>
            <PieChart size={20} /> Overview
          </button>
          <button onClick={() => setActiveTab('clients')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg ${activeTab === 'clients' ? 'bg-blue-600' : 'hover:bg-slate-800'}`}>
            <Users size={20} /> My Clients
          </button>
          <button onClick={() => setActiveTab('bulk')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg ${activeTab === 'bulk' ? 'bg-blue-600' : 'hover:bg-slate-800'}`}>
            <UploadCloud size={20} /> Bulk Filing
          </button>
          <button onClick={() => navigate('/payroll')} className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-slate-800">
            <FileText size={20} /> Payroll Engine
          </button>
        </nav>
        <div className="p-4 border-t border-slate-700">
          <div className="bg-slate-800 p-4 rounded-lg mb-4">
            <p className="text-xs text-gray-400 mb-1">Monthly Quota</p>
            <div className="flex justify-between text-sm mb-2"><span>120 / 500 Filings</span></div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div className="bg-blue-500 h-2 rounded-full" style={{ width: '24%' }}></div>
            </div>
          </div>
          <button onClick={() => navigate('/')} className="w-full flex items-center gap-3 px-4 py-2 text-slate-400 hover:text-white rounded-lg">
            <LogOut size={20} /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8">
        {activeTab === 'overview' && (
          <div>
            <h1 className="text-3xl font-bold mb-6">Hello, Accountant!</h1>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
                <div className="p-4 bg-blue-50 text-blue-600 rounded-lg"><Users size={24} /></div>
                <div><p className="text-gray-500 text-sm">Total Clients</p><p className="text-2xl font-bold">24</p></div>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
                <div className="p-4 bg-green-50 text-green-600 rounded-lg"><CheckCircle size={24} /></div>
                <div><p className="text-gray-500 text-sm">Successful Filings</p><p className="text-2xl font-bold">142</p></div>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
                <div className="p-4 bg-orange-50 text-orange-600 rounded-lg"><Activity size={24} /></div>
                <div><p className="text-gray-500 text-sm">Pending Filings</p><p className="text-2xl font-bold">12</p></div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'clients' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h1 className="text-3xl font-bold">Client Management</h1>
              <button className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Add New Client</button>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="p-4 font-semibold text-gray-600">Company Name</th>
                    <th className="p-4 font-semibold text-gray-600">KRA PIN</th>
                    <th className="p-4 font-semibold text-gray-600">Tax Status</th>
                    <th className="p-4 font-semibold text-gray-600">Statutory (NSSF/SHA)</th>
                    <th className="p-4 font-semibold text-gray-600">E-Levy</th>
                    <th className="p-4 font-semibold text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {clients.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="p-4">{c.name}</td>
                      <td className="p-4">{c.pin}</td>
                      <td className="p-4">
                        <span className={`px-2 py-1 text-xs rounded-full ${c.vat === 'Filed' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>VAT/TOT</span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-1 text-xs rounded-full bg-orange-100 text-orange-700`}>Pending</span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-1 text-xs rounded-full bg-green-100 text-green-700`}>Filed</span>
                      </td>
                      <td className="p-4">
                        <button className="text-blue-600 text-sm font-medium hover:underline">Manage</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'bulk' && (
          <div>
            <h1 className="text-3xl font-bold mb-6">Bulk Filing Hub</h1>
            <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-100 max-w-2xl">
              <h2 className="text-xl font-semibold mb-2">Upload Bulk CSV</h2>
              <p className="text-gray-500 mb-6 font-sm">Upload a CSV file containing multiple clients and their tax data.</p>
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center">
                <UploadCloud size={48} className="mx-auto text-gray-400 mb-4" />
                <p className="text-gray-600 mb-2">Drag and drop your spreadsheet here</p>
                <div className="mt-4">
                  <input type="file" className="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                </div>
              </div>
              <div className="mt-6">
                <button className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 transition">Start Bulk Filing Process</button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}