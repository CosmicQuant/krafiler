import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Download, Save, Plus, Trash2, RefreshCw, AlertCircle } from 'lucide-react';
import { ClientObligation } from '../../../types';
import { apiFetch } from '../../../services/api';

const STANDARD_HEADERS = [
  'Payroll Number', 'PIN of Employee', 'ID Number', 'Identity Type', 'Name of Employee',
  'SHA No', 'NSSF No', 'Residential Status', 'Type of Employee', 'Persons with Disability(PWD)',
  'Exemption Certificate', 'Total Cash Pay (A)', 'Value of Car Benefit (B)', 'Value of Meals (C)',
  'Non Cash Benefits (D)', 'Type of Housing', 'Housing Benefit (F)', 'Other Benefits (G)',
  'Total Gross Pay (Ksh) (H)', 'Social Health Insurance Fund (I)', 'NSSF Contribution (J)',
  'Other Pension Contribution (K)', 'Post Retirement Medical Fund (L)', 'Mortgage Interest (M)',
  'Affordable Housing Levy (N)', 'Taxable Pay(Ksh) (O)', 'Monthly Personal Relief (Ksh) (P)',
  'Amount of Insurance Relief (Q)', 'PAYE Tax (Ksh) (R)', 'Self Assessed PAYE Tax (Ksh) (S)',
];

const COMPUTED_COLUMNS = new Set([
  'Total Gross Pay (Ksh) (H)', 'Social Health Insurance Fund (I)', 'NSSF Contribution (J)',
  'Affordable Housing Levy (N)', 'Taxable Pay(Ksh) (O)', 'Monthly Personal Relief (Ksh) (P)',
  'PAYE Tax (Ksh) (R)', 'Self Assessed PAYE Tax (Ksh) (S)',
]);

type PayrollEmployee = Record<string, string | number>;

type PayloadPreamble = {
  companyName: string;
  companyPin: string;
  companyNssf: string;
  companyNssfPassword: string;
  companyShaLogin: string;
  companyShaPassword: string;
};

function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function calculateFields(emp: PayrollEmployee): void {
  const totalCashPay = parseFloat(String(emp[STANDARD_HEADERS[11]])) || 0;
  const carBenefit = parseFloat(String(emp[STANDARD_HEADERS[12]])) || 0;
  const meals = parseFloat(String(emp[STANDARD_HEADERS[13]])) || 0;
  const nonCash = parseFloat(String(emp[STANDARD_HEADERS[14]])) || 0;
  const housingBenefit = parseFloat(String(emp[STANDARD_HEADERS[16]])) || 0;
  const otherBenefits = parseFloat(String(emp[STANDARD_HEADERS[17]])) || 0;
  const otherPension = parseFloat(String(emp[STANDARD_HEADERS[21]])) || 0;
  const postRetMedical = parseFloat(String(emp[STANDARD_HEADERS[22]])) || 0;
  const mortgage = parseFloat(String(emp[STANDARD_HEADERS[23]])) || 0;
  const insuranceRelief = parseFloat(String(emp[STANDARD_HEADERS[27]])) || 0;
  const pwd = String(emp[STANDARD_HEADERS[9]] || '').toLowerCase() === 'yes';

  const grossSalary = roundMoney(totalCashPay + carBenefit + meals + nonCash + housingBenefit + otherBenefits);
  const shaContribution = grossSalary > 0 ? roundMoney(grossSalary * 0.0275) : 0;
  const nssfContribution = grossSalary > 0 ? roundMoney(Math.min(grossSalary * 0.06, 6480)) : 0;
  const ahl = grossSalary > 0 ? roundMoney(grossSalary * 0.015) : 0;
  const pwdExemption = pwd ? 150000 : 0;
  const taxablePay = roundMoney(Math.max(0, grossSalary - shaContribution - nssfContribution - otherPension - postRetMedical - mortgage - ahl - pwdExemption));
  const personalRelief = totalCashPay > 0 ? 2400 : 0;

  const paye = roundMoney(Math.max(0,
    Math.max(0, taxablePay * 0.1)
    + Math.max(0, (taxablePay - 24000) * 0.15)
    + Math.max(0, (taxablePay - 32333) * 0.05)
    + Math.max(0, (taxablePay - 500000) * 0.025)
    + Math.max(0, (taxablePay - 800000) * 0.025)
    - personalRelief
    - insuranceRelief,
  ));

  emp[STANDARD_HEADERS[18]] = grossSalary.toFixed(2);
  emp[STANDARD_HEADERS[19]] = shaContribution.toFixed(2);
  emp[STANDARD_HEADERS[20]] = nssfContribution.toFixed(2);
  emp[STANDARD_HEADERS[24]] = ahl.toFixed(2);
  emp[STANDARD_HEADERS[25]] = taxablePay.toFixed(2);
  emp[STANDARD_HEADERS[26]] = personalRelief.toFixed(2);
  emp[STANDARD_HEADERS[28]] = paye.toFixed(2);
  emp[STANDARD_HEADERS[29]] = paye.toFixed(2);
}

function createEmptyEmployee(index: number): PayrollEmployee {
  const emp: PayrollEmployee = {};
  STANDARD_HEADERS.forEach((h, i) => {
    if (i === 0) emp[h] = String(index);
    else if (i === 3) emp[h] = 'National ID';
    else if (i === 7) emp[h] = 'Resident';
    else if (i === 8) emp[h] = 'Primary Employee';
    else if (i === 9) emp[h] = 'No';
    else if (i === 10) emp[h] = '0';
    else if (i === 15) emp[h] = 'Benefit not given';
    else if (i >= 11 && i <= 17) emp[h] = '0';
    else if (i >= 21 && i <= 23) emp[h] = '0';
    else if (i === 27) emp[h] = '0';
    else emp[h] = '';
  });
  calculateFields(emp);
  return emp;
}

interface PayrollWebViewProps {
  client: ClientObligation;
  onBack: () => void;
  onEditClient?: () => void;
}

export function PayrollWebView({ client, onBack, onEditClient }: PayrollWebViewProps) {
  const [preamble, setPreamble] = useState<PayloadPreamble | null>(null);
  const [employees, setEmployees] = useState<PayrollEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [hasData, setHasData] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/clients/${client.id}/payroll-data`);
      if (!res.ok) {
        setError('Failed to load payroll data.');
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (!data.hasData || !data.employees?.length) {
        setHasData(false);
        setEmployees([]);
        setPreamble(null);
      } else {
        setHasData(true);
        setPreamble(data.preamble);
        setEmployees(data.employees);
      }
    } catch {
      setError('Network error loading payroll data.');
    } finally {
      setLoading(false);
    }
  }, [client.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateField = (empIndex: number, header: string, value: string) => {
    setEmployees(prev => {
      const updated = prev.map((emp, i) => {
        if (i !== empIndex) return emp;
        const next = { ...emp, [header]: value };
        if (!COMPUTED_COLUMNS.has(header)) {
          calculateFields(next);
        }
        return next;
      });
      return updated;
    });
  };

  const addRow = () => {
    setEmployees(prev => [...prev, createEmptyEmployee(prev.length + 1)]);
  };

  const removeRow = (index: number) => {
    setEmployees(prev => {
      const filtered = prev.filter((_, i) => i !== index);
      return filtered.map((emp, i) => ({ ...emp, [STANDARD_HEADERS[0]]: String(i + 1) }));
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMessage(null);
    setError(null);
    try {
      const res = await apiFetch(`/clients/${client.id}/payroll-data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employees }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Save failed.');
      }
      setStatusMessage('Payroll data saved and recalculated successfully.');
      await fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to save payroll data.');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadCsv = () => {
    const lines: string[] = [];
    if (preamble) {
      lines.push(`COMPANY NAME:,${preamble.companyName}`);
      lines.push(`COMPANY KRA PIN:,${preamble.companyPin}`);
      lines.push(`COMPANY NSSF NO:,${preamble.companyNssf}`);
      lines.push(`COMPANY NSSF PASSWORD:,${preamble.companyNssfPassword}`);
      lines.push(`COMPANY SHA LOGIN:,${preamble.companyShaLogin}`);
      lines.push(`COMPANY SHA PASSWORD:,${preamble.companyShaPassword}`);
    }
    lines.push('');
    lines.push(STANDARD_HEADERS.join(','));

    employees.forEach(emp => {
      const row = STANDARD_HEADERS.map(h => String(emp[h] ?? ''));
      lines.push(row.join(','));
    });

    const bom = '\ufeff';
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${client.name}_Payroll_Data.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
        <span className="ml-3 text-sm text-slate-500">Loading payroll data...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <h2 className="text-xl font-bold text-slate-900">{client.name}</h2>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-500">{client.pin}</span>
        </div>
        <div className="flex items-center gap-2">
          {onEditClient && (
            <button
              onClick={onEditClient}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Company Details
            </button>
          )}
          <button
            onClick={handleDownloadCsv}
            disabled={!hasData || employees.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-4 w-4" />
            Download CSV
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasData}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white hover:bg-slate-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {statusMessage}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!hasData ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-slate-500">No payroll data found</p>
          <p className="mt-2 text-xs text-slate-400">
            Upload a master CSV for this client from the Payroll Pipeline desk to enable the payroll editor.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 border-r border-slate-200 min-w-[3rem]">
                    #
                  </th>
                  {STANDARD_HEADERS.map((header, i) => {
                    const numeric = i >= 11 && i !== 15;
                    return (
                      <th
                        key={header}
                        className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${
                          COMPUTED_COLUMNS.has(header) ? 'text-slate-400' : 'text-slate-500'
                        } ${numeric ? 'text-right' : ''}`}
                      >
                        {header}
                      </th>
                    );
                  })}
                  <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 w-12">
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map((emp, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-slate-50/50 transition">
                    <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-xs text-slate-400 font-mono border-r border-slate-100">
                      {rowIdx + 1}
                    </td>
                    {STANDARD_HEADERS.map((header, colIdx) => {
                      const isComputed = COMPUTED_COLUMNS.has(header);
                      const isNumeric = colIdx >= 11 && colIdx !== 15;
                      const rawVal = emp[header];
                      const strVal = rawVal !== undefined && rawVal !== null ? String(rawVal) : '';

                      return (
                        <td key={header} className={`px-3 py-1.5 ${isNumeric ? 'text-right' : ''}`}>
                          {isComputed ? (
                            <span className="block w-full px-1.5 py-1 text-xs text-slate-500 bg-slate-50 rounded">
                              {strVal}
                            </span>
                          ) : colIdx === 9 ? (
                            <select
                              value={strVal}
                              onChange={e => updateField(rowIdx, header, e.target.value)}
                              className="w-full min-w-[4rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                            >
                              <option value="No">No</option>
                              <option value="Yes">Yes</option>
                            </select>
                          ) : colIdx === 3 ? (
                            <select
                              value={strVal}
                              onChange={e => updateField(rowIdx, header, e.target.value)}
                              className="w-full min-w-[6rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                            >
                              <option value="National ID">National ID</option>
                              <option value="Passport Number">Passport Number</option>
                              <option value="Alien ID">Alien ID</option>
                              <option value="Refugee ID">Refugee ID</option>
                            </select>
                          ) : colIdx === 7 ? (
                            <select
                              value={strVal}
                              onChange={e => updateField(rowIdx, header, e.target.value)}
                              className="w-full min-w-[5rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                            >
                              <option value="Resident">Resident</option>
                              <option value="Non-Resident">Non-Resident</option>
                            </select>
                          ) : colIdx === 8 ? (
                            <select
                              value={strVal}
                              onChange={e => updateField(rowIdx, header, e.target.value)}
                              className="w-full min-w-[7rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                            >
                              <option value="Primary Employee">Primary Employee</option>
                              <option value="Secondary Employee">Secondary Employee</option>
                            </select>
                          ) : colIdx === 15 ? (
                            <select
                              value={strVal}
                              onChange={e => updateField(rowIdx, header, e.target.value)}
                              className="w-full min-w-[8rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                            >
                              <option value="Benefit not given">Benefit not given</option>
                              <option value="Employer owns">Employer owns</option>
                              <option value="Employer rented">Employer rented</option>
                              <option value="Employer leased">Employer leased</option>
                            </select>
                          ) : isNumeric ? (
                            <input
                              type="number"
                              step="any"
                              value={strVal}
                              onChange={e => updateField(rowIdx, header, e.target.value)}
                              className="w-full min-w-[5rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 text-right focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                            />
                          ) : (
                            <input
                              type="text"
                              value={strVal}
                              onChange={e => updateField(rowIdx, header, e.target.value)}
                              className="w-full min-w-[5rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => removeRow(rowIdx)}
                        className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
                        title="Remove employee"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={addRow}
              className="inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400 hover:text-slate-900 transition"
            >
              <Plus className="h-4 w-4" />
              Add Employee
            </button>
            <span className="text-xs text-slate-400">
              {employees.length} employee{employees.length !== 1 ? 's' : ''}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
