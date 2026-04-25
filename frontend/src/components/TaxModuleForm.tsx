import React, { useState } from 'react';
import { UploadCloud, CheckCircle, FileText, Loader2, ArrowRight } from 'lucide-react';

export default function TaxModuleForm({ taxType }: { taxType: string }) {
  const [inputType, setInputType] = useState<'manual' | 'upload'>('manual');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('submitting');
    
    // Simulate API Call Mocking the Filing Flow (Phase 3)
    setTimeout(() => {
      setStatus('success');
      // Create a mock receipt blob url
      const blob = new Blob(['Mock Filing Receipt for ' + taxType.toUpperCase()], { type: 'text/plain' });
      setReceiptUrl(URL.createObjectURL(blob));
    }, 2500);
  };

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden font-sans">
      <div className="bg-blue-600 px-8 py-6 text-white text-center">
        <h2 className="text-3xl font-bold mb-2">File your {taxType.toUpperCase()} Return</h2>
        <p className="text-blue-100">Choose how you want to provide your data.</p>
      </div>

      {status === 'success' ? (
        <div className="p-12 text-center">
          <CheckCircle size={64} className="mx-auto text-green-500 mb-6" />
          <h3 className="text-2xl font-bold mb-4">Filing Successful!</h3>
          <p className="text-gray-600 mb-8">Your {taxType.toUpperCase()} return has been mocked and successfully generated.</p>
          <a
            href={receiptUrl!}
            download={`mock_receipt_${taxType}.txt`}
            className="inline-flex items-center gap-2 bg-blue-600 text-white font-medium px-6 py-3 rounded-lg hover:bg-blue-700 transition"
          >
            <FileText size={20} /> Download Receipt
          </a>
        </div>
      ) : (
        <div className="p-8">
          <div className="flex bg-gray-100 p-1 divide-x divide-gray-200 rounded-lg mb-8 text-sm font-medium">
            <button
              className={`flex-1 py-3 px-6 rounded-md transition-colors ${inputType === 'manual' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
              onClick={() => setInputType('manual')}
            >
              Manual Entry
            </button>
            <button
              className={`flex-1 py-3 px-6 rounded-md transition-colors ${inputType === 'upload' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
              onClick={() => setInputType('upload')}
            >
              CSV Upload
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {inputType === 'manual' && (
              <div className="space-y-4 animate-in fade-in">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">{['nssf', 'sha', 'elevy'].includes(taxType) ? 'Number of Employees' : 'Gross Sales / Revenue (KES)'}</label>
                  <input type="number" placeholder={['nssf', 'sha', 'elevy'].includes(taxType) ? 'e.g. 15' : 'e.g. 500000'} className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500" required />
                </div>
                {['nssf', 'sha'].includes(taxType) && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Total Gross Payroll (KES)</label>
                    <input type="number" placeholder="e.g. 800000" className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500" required />
                  </div>
                )}
                {taxType === 'elevy' && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Total Gross Tourism Receipts (KES)</label>
                    <input type="number" placeholder="e.g. 1500000" className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500" required />
                  </div>
                )}
                {taxType === 'vat' && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Total Purchases / Inputs (KES)</label>
                    <input type="number" placeholder="e.g. 200000" className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500" required />
                  </div>
                )}
                {taxType === 'mri' && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Number of Units Let</label>
                    <input type="number" placeholder="e.g. 4" className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500" required />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Period Year</label>
                    <select className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option>2026</option>
                      <option>2025</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Month</label>
                    <select className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option>January</option><option>February</option><option>March</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {inputType === 'upload' && (
              <div className="text-center p-8 border-2 border-dashed border-gray-300 rounded-xl hover:bg-gray-50 transition-colors animate-in fade-in">
                <UploadCloud size={48} className="mx-auto text-blue-500 mb-4" />
                <h3 className="font-semibold text-gray-800 mb-2">Connect your data</h3>
                <p className="text-gray-500 text-sm mb-6">Upload your sales Z-reports or accounting CSV securely.</p>
                <div className="flex justify-center">
                  <label className="cursor-pointer bg-blue-50 text-blue-700 font-semibold px-6 py-3 rounded-full hover:bg-blue-100 transition">
                    Browse Files
                    <input type="file" className="hidden" accept=".csv, .xlsx" required />
                  </label>
                </div>
              </div>
            )}

            <button
              disabled={status === 'submitting'}
              type="submit"
              className="w-full mt-4 flex items-center justify-center gap-2 bg-slate-900 text-white font-semibold py-4 rounded-xl hover:bg-slate-800 transition disabled:opacity-75 disabled:cursor-not-allowed"
            >
              {status === 'submitting' ? (
                <><Loader2 className="animate-spin" size={20} /> Processing...</>
              ) : (
                <>Submit {taxType.toUpperCase()} Filing <ArrowRight size={20} /></>
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}