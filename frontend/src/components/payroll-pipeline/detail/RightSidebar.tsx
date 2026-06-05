import { useState, useEffect, useCallback } from 'react';
import {
  Calendar, Plus, ChevronRight, Banknote, X,
  CheckCircle2, XCircle, Pencil, Trash2, Search,
} from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { cn } from '../../../utils/cn';

interface Loan {
  id: number;
  employeeId: number;
  employeeName: string;
  loanType: string;
  principal: number;
  monthlyDeduction: number;
  installments: number;
  remainingInstallments: number;
  status: string;
  disbursedAt?: string | null;
  interestRate?: number;
}

interface LeaveRequest {
  id: number;
  employeeId: number;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  hours?: number;
  reason?: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  isPaid: number;
}

interface RightSidebarProps {
  clientId: string;
  period?: string;
  onRefresh: () => void;
}

export function RightSidebar({ clientId, period, onRefresh }: RightSidebarProps) {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loadingLoans, setLoadingLoans] = useState(true);
  const [loadingLeaves, setLoadingLeaves] = useState(true);

  const [showLoanModal, setShowLoanModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  const fetchLoans = useCallback(async () => {
    setLoadingLoans(true);
    try {
      const res = await apiFetch(`/clients/${clientId}/loans`);
      if (res.ok) {
        let data = await res.json();
        if (period) {
          const [year, month] = period.split('-');
          data = data.filter((l: Loan) => {
            if (!l.disbursedAt) return true;
            const d = new Date(l.disbursedAt);
            return d.getFullYear() === parseInt(year, 10) && d.getMonth() + 1 === parseInt(month, 10);
          });
        }
        setLoans(data);
      }
    } catch { /* ignore */ }
    setLoadingLoans(false);
  }, [clientId, period]);

  const fetchLeaves = useCallback(async () => {
    setLoadingLeaves(true);
    try {
      const res = await apiFetch(`/clients/${clientId}/leave`);
      if (res.ok) {
        let data = await res.json();
        if (period) {
          const [year, month] = period.split('-').map(Number);
          const monthStart = new Date(year, month - 1, 1);
          const monthEnd = new Date(year, month, 0);
          data = data.filter((r: LeaveRequest) => {
            const start = new Date(r.startDate);
            const end = new Date(r.endDate);
            return start <= monthEnd && end >= monthStart;
          });
        }
        setLeaves(data);
      }
    } catch { /* ignore */ }
    setLoadingLeaves(false);
  }, [clientId, period]);

  useEffect(() => {
    fetchLoans();
    fetchLeaves();
  }, [fetchLoans, fetchLeaves]);

  const topLoans = loans.slice(0, 5);
  const topLeaves = leaves.slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Loans */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
            <Banknote className="h-3.5 w-3.5 text-slate-500" /> Loans
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">{loans.length} total</span>
            <button onClick={() => setShowLoanModal(true)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition" title="Add loan">
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>

        {loadingLoans ? (
          <div className="text-[10px] text-slate-400 py-2">Loading...</div>
        ) : topLoans.length === 0 ? (
          <div className="text-[10px] text-slate-400 py-2">No loans</div>
        ) : (
          <div className="space-y-1.5">
            {topLoans.map((ln) => (
              <div key={ln.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-slate-700 truncate">{ln.employeeName}</p>
                  <p className="text-[9px] text-slate-500">{ln.loanType} — {ln.remainingInstallments}/{ln.installments} left</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] font-mono font-semibold text-slate-700">KES {Number(ln.monthlyDeduction || 0).toLocaleString()}</p>
                  <span className={cn(
                    'inline-flex rounded-full px-1.5 py-0 text-[8px] font-semibold',
                    ln.status === 'Approved' || ln.status === 'Active' ? 'bg-emerald-50 text-emerald-600' :
                    ln.status === 'Paid' ? 'bg-blue-50 text-blue-600' :
                    'bg-red-50 text-red-600'
                  )}>{ln.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {loans.length > 5 && (
          <button
            onClick={() => setShowLoanModal(true)}
            className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 transition"
          >
            View All <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Leaves */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-slate-500" /> Leave
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">{leaves.length} total</span>
            <button onClick={() => setShowLeaveModal(true)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition" title="Add leave">
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>

        {loadingLeaves ? (
          <div className="text-[10px] text-slate-400 py-2">Loading...</div>
        ) : topLeaves.length === 0 ? (
          <div className="text-[10px] text-slate-400 py-2">No leave requests</div>
        ) : (
          <div className="space-y-1.5">
            {topLeaves.map((req) => (
              <div key={req.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-slate-700 truncate">{req.employeeName}</p>
                  <p className="text-[9px] text-slate-500">{req.leaveType} · {req.daysCount}d · {req.startDate}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={cn(
                    'inline-flex rounded-full px-1.5 py-0 text-[8px] font-semibold',
                    req.status === 'Approved' ? 'bg-emerald-50 text-emerald-600' :
                    req.status === 'Rejected' ? 'bg-red-50 text-red-600' :
                    'bg-amber-50 text-amber-600'
                  )}>{req.status}</span>
                  {req.isPaid === 1 && <span className="text-[8px] text-slate-400">Paid</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {leaves.length > 5 && (
          <button
            onClick={() => setShowLeaveModal(true)}
            className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 transition"
          >
            View All <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {showLoanModal && (
        <LoanListModal clientId={clientId} period={period} onClose={() => setShowLoanModal(false)} onRefresh={() => { fetchLoans(); onRefresh(); }} />
      )}
      {showLeaveModal && (
        <LeaveListModal clientId={clientId} period={period} onClose={() => setShowLeaveModal(false)} onRefresh={() => { fetchLeaves(); onRefresh(); }} />
      )}
    </div>
  );
}

/* ─── LoanListModal ─────────────────────────────────────────────── */

function LoanListModal({ clientId, period, onClose, onRefresh }: { clientId: string; period?: string; onClose: () => void; onRefresh: () => void }) {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [employees, setEmployees] = useState<{ id: number; employeeName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [form, setForm] = useState<any>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [loansRes, empRes] = await Promise.all([
        apiFetch(`/clients/${clientId}/loans`),
        apiFetch(`/clients/${clientId}/employees`),
      ]);
      if (loansRes.ok) {
        let data = await loansRes.json();
        if (period) {
          const [year, month] = period.split('-');
          data = data.filter((l: Loan) => {
            if (!l.disbursedAt) return true;
            const d = new Date(l.disbursedAt);
            return d.getFullYear() === parseInt(year, 10) && d.getMonth() + 1 === parseInt(month, 10);
          });
        }
        setLoans(data);
      }
      if (empRes.ok) {
        const emps = await empRes.json();
        setEmployees(emps.filter((e: any) => e.employmentStatus === 'Active'));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [clientId, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = loans.filter((l) => {
    const matchesSearch = l.employeeName.toLowerCase().includes(search.toLowerCase()) || l.loanType.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'All' || l.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this loan?')) return;
    try {
      const res = await apiFetch(`/clients/${clientId}/loans/${id}`, { method: 'DELETE' });
      if (res.ok) { fetchData(); onRefresh(); }
    } catch { /* ignore */ }
  };

  const handleSave = async () => {
    try {
      const payload = { ...form, totalRepayable: (parseFloat(form.principal) || 0) + (parseFloat(form.totalInterest) || 0) };
      const url = editing ? `/clients/${clientId}/loans/${editing.id}` : `/clients/${clientId}/loans`;
      const method = editing ? 'PUT' : 'POST';
      const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) { setShowForm(false); setEditing(null); fetchData(); onRefresh(); }
    } catch { /* ignore */ }
  };

  const openForm = (rec?: Loan) => {
    if (rec) {
      setEditing(rec);
      setForm({ employeeId: String(rec.employeeId), loanType: rec.loanType, principal: rec.principal, monthlyDeduction: rec.monthlyDeduction, installments: rec.installments, remainingInstallments: rec.remainingInstallments, interestRate: rec.interestRate || 0, totalInterest: 0, status: rec.status, notes: '' });
    } else {
      setEditing(null);
      setForm({ employeeId: '', loanType: 'Salary Advance', principal: 0, monthlyDeduction: 0, installments: 1, remainingInstallments: 1, interestRate: 0, totalInterest: 0, status: 'Approved', notes: '' });
    }
    setShowForm(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="text-sm font-bold text-slate-900">All Loans</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 transition"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 space-y-3">
          {/* Filters */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search loans..." className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-slate-400 focus:outline-none" />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900">
              <option value="All">All Status</option>
              <option>Approved</option><option>Active</option><option>Paid</option><option>Defaulted</option>
            </select>
            <button onClick={() => openForm()} className="inline-flex items-center gap-1 rounded-lg bg-[#ff0613] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#d80000] transition">
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>

          {showForm && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <select value={form.employeeId || ''} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs">
                  <option value="">Employee</option>
                  {employees.map((e) => <option key={e.id} value={String(e.id)}>{e.employeeName}</option>)}
                </select>
                <select value={form.loanType} onChange={(e) => setForm({ ...form, loanType: e.target.value })} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs">
                  <option>Salary Advance</option><option>Emergency Loan</option><option>Normal Loan</option><option>Other</option>
                </select>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs">
                  <option>Approved</option><option>Active</option><option>Paid</option><option>Defaulted</option>
                </select>
                <input type="number" placeholder="Principal" value={form.principal} onChange={(e) => setForm({ ...form, principal: parseFloat(e.target.value) || 0 })} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs" />
                <input type="number" placeholder="Monthly Deduction" value={form.monthlyDeduction} onChange={(e) => setForm({ ...form, monthlyDeduction: parseFloat(e.target.value) || 0 })} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs" />
                <input type="number" placeholder="Installments" value={form.installments} onChange={(e) => setForm({ ...form, installments: parseInt(e.target.value) || 0 })} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs" />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setShowForm(false)} className="rounded border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">Cancel</button>
                <button onClick={handleSave} className="rounded bg-slate-950 px-3 py-1 text-xs font-bold text-white">Save</button>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-100 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Employee</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Principal</th>
                  <th className="px-3 py-2 text-right">Monthly</th>
                  <th className="px-3 py-2 text-center">Remaining</th>
                  <th className="px-3 py-2 text-center">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  <tr><td colSpan={7} className="py-4 text-center text-slate-400">Loading...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="py-4 text-center text-slate-400">No loans found</td></tr>
                ) : filtered.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">{l.employeeName}</td>
                    <td className="px-3 py-2 text-slate-600">{l.loanType}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(l.principal).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(l.monthlyDeduction).toLocaleString()}</td>
                    <td className="px-3 py-2 text-center">{l.remainingInstallments}/{l.installments}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold', l.status === 'Paid' ? 'bg-blue-50 text-blue-600' : l.status === 'Defaulted' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600')}>{l.status}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openForm(l)} className="p-1 rounded hover:bg-blue-50 text-blue-600"><Pencil className="h-3 w-3" /></button>
                        <button onClick={() => handleDelete(l.id)} className="p-1 rounded hover:bg-red-50 text-red-500"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── LeaveListModal ────────────────────────────────────────────── */

function LeaveListModal({ clientId, period, onClose, onRefresh }: { clientId: string; period?: string; onClose: () => void; onRefresh: () => void }) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<{ id: number; employeeName: string }[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<{ id: number; name: string; isPaid: number; maxDaysPerYear: number | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<any>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, typesRes, empRes] = await Promise.all([
        apiFetch(`/clients/${clientId}/leave`),
        apiFetch(`/clients/${clientId}/leave-types`),
        apiFetch(`/clients/${clientId}/employees`),
      ]);
      let reqs = [];
      if (reqRes.ok) reqs = await reqRes.json();
      if (period) {
        const [year, month] = period.split('-').map(Number);
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 0);
        reqs = reqs.filter((r: LeaveRequest) => {
          const start = new Date(r.startDate);
          const end = new Date(r.endDate);
          return start <= monthEnd && end >= monthStart;
        });
      }
      setRequests(reqs);
      if (typesRes.ok) setLeaveTypes(await typesRes.json());
      if (empRes.ok) setEmployees(await empRes.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [clientId, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = requests.filter((r) => {
    const matchesSearch = r.employeeName.toLowerCase().includes(search.toLowerCase()) || r.leaveType.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'All' || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleStatus = async (id: number, status: 'Approved' | 'Rejected') => {
    try {
      const res = await apiFetch(`/clients/${clientId}/leave/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      if (res.ok) fetchData();
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this leave request?')) return;
    try {
      const res = await apiFetch(`/clients/${clientId}/leave/${id}`, { method: 'DELETE' });
      if (res.ok) { fetchData(); onRefresh(); }
    } catch { /* ignore */ }
  };

  const handleSave = async () => {
    try {
      const payload = { employeeId: parseInt(form.employeeId), leaveType: form.leaveType, startDate: form.startDate, endDate: form.endDate, daysCount: parseInt(form.daysCount) || 1, hours: form.hours ? parseFloat(form.hours) : 0, reason: form.reason, isPaid: form.isPaid ? 1 : 0, status: editingId ? undefined : 'Pending' };
      const res = editingId
        ? await apiFetch(`/clients/${clientId}/leave/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await apiFetch(`/clients/${clientId}/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) { setShowForm(false); setEditingId(null); fetchData(); onRefresh(); }
    } catch { /* ignore */ }
  };

  const openForm = (req?: LeaveRequest) => {
    if (req) {
      setEditingId(req.id);
      setForm({ employeeId: String(req.employeeId), leaveType: req.leaveType, startDate: req.startDate, endDate: req.endDate, daysCount: String(req.daysCount), hours: req.hours ? String(req.hours) : '', reason: req.reason || '', isPaid: req.isPaid === 1 });
    } else {
      setEditingId(null);
      setForm({ employeeId: '', leaveType: leaveTypes[0]?.name || '', startDate: '', endDate: '', daysCount: '1', hours: '', reason: '', isPaid: true });
    }
    setShowForm(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="text-sm font-bold text-slate-900">All Leave Requests</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 transition"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leave..." className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-slate-400 focus:outline-none" />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900">
              <option value="All">All Status</option>
              <option>Pending</option><option>Approved</option><option>Rejected</option>
            </select>
            <button onClick={() => openForm()} className="inline-flex items-center gap-1 rounded-lg bg-[#ff0613] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#d80000] transition">
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>

          {showForm && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <select value={form.employeeId || ''} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs">
                  <option value="">Employee</option>
                  {employees.map((e) => <option key={e.id} value={String(e.id)}>{e.employeeName}</option>)}
                </select>
                <select value={form.leaveType || ''} onChange={(e) => setForm({ ...form, leaveType: e.target.value })} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs">
                  {leaveTypes.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
                <input type="text" placeholder="Start Date" value={form.startDate || ''} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs" />
                <input type="text" placeholder="End Date" value={form.endDate || ''} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs" />
                <input type="number" placeholder="Days" value={form.daysCount || ''} onChange={(e) => setForm({ ...form, daysCount: e.target.value })} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs" />
                <label className="flex items-center gap-1 text-xs text-slate-700">
                  <input type="checkbox" checked={!!form.isPaid} onChange={(e) => setForm({ ...form, isPaid: e.target.checked })} /> Paid Leave
                </label>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setShowForm(false)} className="rounded border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">Cancel</button>
                <button onClick={handleSave} className="rounded bg-slate-950 px-3 py-1 text-xs font-bold text-white">Save</button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-100 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Employee</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Dates</th>
                  <th className="px-3 py-2 text-center">Days</th>
                  <th className="px-3 py-2 text-center">Status</th>
                  <th className="px-3 py-2 text-center">Paid</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  <tr><td colSpan={7} className="py-4 text-center text-slate-400">Loading...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="py-4 text-center text-slate-400">No leave requests found</td></tr>
                ) : filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">{r.employeeName}</td>
                    <td className="px-3 py-2 text-slate-600">{r.leaveType}</td>
                    <td className="px-3 py-2 text-slate-500">{r.startDate} to {r.endDate}</td>
                    <td className="px-3 py-2 text-center">{r.daysCount}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold', r.status === 'Approved' ? 'bg-emerald-50 text-emerald-600' : r.status === 'Rejected' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600')}>{r.status}</span>
                    </td>
                    <td className="px-3 py-2 text-center">{r.isPaid === 1 ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {r.status === 'Pending' && (
                          <>
                            <button onClick={() => handleStatus(r.id, 'Approved')} className="p-1 rounded hover:bg-emerald-50 text-emerald-600" title="Approve"><CheckCircle2 className="h-3 w-3" /></button>
                            <button onClick={() => handleStatus(r.id, 'Rejected')} className="p-1 rounded hover:bg-red-50 text-red-500" title="Reject"><XCircle className="h-3 w-3" /></button>
                          </>
                        )}
                        <button onClick={() => openForm(r)} className="p-1 rounded hover:bg-blue-50 text-blue-600"><Pencil className="h-3 w-3" /></button>
                        <button onClick={() => handleDelete(r.id)} className="p-1 rounded hover:bg-red-50 text-red-500"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
